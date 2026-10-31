// JSON API used by dashboards (login cookie) and external clients (bearer token).
// Handlers are async (MongoDB); Express 5 forwards thrown errors to app.js error handler.
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const { BASE_URL, SESSION_SECRET } = require('../lib/config');
const { upload } = require('../lib/uploads');
const { sign, verify } = require('../lib/token');
const { cols, nextDailyOrderNo } = require('../lib/db');
const orderEvents = require('../lib/order-events');
const { archiveThenDelete, deleteOrdersOlderThan15Days } = require('../lib/order-retention');
const svc = require('../lib/service');
const { HttpError } = svc;

const router = express.Router();
router.use(express.json({ limit: '3mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.ORDER_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many order attempts. Please try again later.' },
});

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const sameOrigin = req => {
  const o = req.get('origin');
  if (!o) return true;

  try {
    return new URL(o).host === req.get('host');
  } catch {
    return false;
  }
};

// Accept either Authorization: Bearer <token> or the dashboard login cookie.
const auth = role => async (req, res, next) => {
  let u = null;
  let viaCookie = false;

  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');

  if (m) {
    const p = verify(m[1], SESSION_SECRET);
    u = p && await svc.userIsActive(p.uid);
  } else if (req.session?.user) {
    u = await svc.userIsActive(req.session.user.id);
    viaCookie = !!u;
  }

  if (!u) {
    throw new HttpError(401, 'Missing, invalid or expired login');
  }

  if (viaCookie && !SAFE.has(req.method) && !sameOrigin(req)) {
    throw new HttpError(403, 'Cross-site request blocked');
  }

  if (role && u.role !== role) {
    throw new HttpError(403, 'Forbidden');
  }

  req.user = u;
  next();
};

const rid = req => req.user.restaurant_id;
const id = req => Number(req.params.id);

const photo = req =>
  req.file?.filename ||
  (typeof req.body.image === 'string' && req.body.image.startsWith('data:')
    ? svc.saveImageData(req.body.image)
    : null);

const cleanText = (v, max = 200) =>
  String(v ?? '').trim().slice(0, max);

const cleanPhone = v =>
  String(v ?? '').replace(/[\s()-]/g, '').slice(0, 20);

const roundMoney = n =>
  Math.round((n + Number.EPSILON) * 100) / 100;

// ---- docs ----
router.get('/openapi.json', (req, res) => {
  res.json(require('../lib/openapi'));
});

// ---- public menu ----
router.get('/public/menu/:slug', async (req, res) => {
  const m = await svc.getMenu(req.params.slug);

  if (!m) {
    throw new HttpError(404, 'Menu not available');
  }

  const r = m.restaurant;

  res.set('Cache-Control', 'public, max-age=30');

  res.json({
    restaurant: {
      name: r.name,
      slug: r.slug,
      tagline: r.tagline,
      theme_color: r.theme_color,
      city: r.city,
      address: r.address,
      phone: r.contact_phone,
      logo: r.logo ? `/uploads/${r.logo}` : null,
      order_enabled: r.order_enabled !== false,
    },
    categories: m.sections.map(s => ({
      id: s.id,
      name: s.name,
      items: s.items.map(svc.itemOut),
    })),
  });
});

// ---- customer order status tracking ----

// Public order status tracking.
router.get('/public/orders/:id', async (req, res) => {
  const order = await svc.getPublicOrder(req.params.id);
  res.set('Cache-Control', 'no-store');
  res.json(order);
});

// Live customer status stream. The order ID is the subscription key.
router.get('/public/orders/:id/events', async (req, res) => {
  // Confirm the order exists before opening a public stream.
  await svc.getPublicOrder(req.params.id);
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`event: connected\ndata: ${JSON.stringify({ orderId: req.params.id })}\n\n`);
  const unsubscribe = orderEvents.subscribeOrder(String(req.params.id), payload => {
    res.write(`event: order-status\ndata: ${JSON.stringify(payload)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

// ---- customer order submission ----
// Expected body:
// {
//   slug: "restaurant-slug",
//   customer: "Customer name",
//   phone: "9876543210",
//   items: [{ id: 1, qty: 2 }],
//   note: "Less spicy",
//   order_type: "Dine In",
//   table_no: "5"
// }
//
// Item prices are fetched from MongoDB. Client totals are never trusted.
router.post('/public/orders', orderLimiter, async (req, res) => {
  const body = req.body || {};

  const slug = cleanText(body.slug, 100).toLowerCase();

  if (!slug) {
    throw new HttpError(400, 'Restaurant slug is required');
  }

  const menu = await svc.getMenu(slug);

  if (!menu) {
    throw new HttpError(404, 'Restaurant menu not found or unavailable');
  }

  const restaurant = menu.restaurant;

  if (restaurant.order_enabled === false) {
    throw new HttpError(403, 'Online ordering is currently disabled for this restaurant');
  }

  const customer = cleanText(body.customer ?? body.name, 80);
  const phone = cleanPhone(body.phone ?? body.mobile);

  if (customer.length < 2) {
    throw new HttpError(400, 'Please enter your name');
  }

  if (!/^\+?\d{7,15}$/.test(phone)) {
    throw new HttpError(400, 'Please enter a valid mobile number');
  }

  const orderType = cleanText(body.order_type || 'Dine In', 30);

  const allowedTypes = new Set([
    'Dine In',
    'Takeaway',
    'Delivery',
    'Room Service',
  ]);

  if (!allowedTypes.has(orderType)) {
    throw new HttpError(400, 'Invalid order type');
  }

  const tableNo = cleanText(
    body.table_no ?? body.table_number,
    30
  );

  if (orderType === 'Dine In' && !tableNo) {
    throw new HttpError(400, 'Table number is required for Dine In orders');
  }

  if (
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    body.items.length > 50
  ) {
    throw new HttpError(400, 'Your cart is empty or contains too many different items');
  }

  const availableItems = new Map(
    menu.sections
      .flatMap(section => section.items)
      .map(item => [Number(item.id), item])
  );

  const lines = [];

  for (const requested of body.items) {
    const itemId = Number(requested?.id ?? requested?.item_id);
    const qty = Number(requested?.qty ?? requested?.quantity);

    if (
      !Number.isSafeInteger(itemId) ||
      !Number.isSafeInteger(qty) ||
      qty < 1 ||
      qty > 99
    ) {
      throw new HttpError(400, 'One or more cart items have an invalid item ID or quantity');
    }

    const item = availableItems.get(itemId);

    if (!item || !item.available) {
      throw new HttpError(
        409,
        'An item in your cart is no longer available. Please refresh the menu.'
      );
    }

    lines.push({
      item_id: item.id,
      name: item.name,
      price: Number(item.price),
      qty,
      line_total: roundMoney(Number(item.price) * qty),
    });
  }

  const subtotal = roundMoney(
    lines.reduce((sum, line) => sum + line.line_total, 0)
  );

  const tax = roundMoney(subtotal * 0.05);
  const total = roundMoney(subtotal + tax);

  const createdAt = new Date();

  // Example: DES-30102026-001. The daily counter is atomic in MongoDB
  // and resets automatically when the India-local calendar date changes.
  const orderNo = await nextDailyOrderNo(restaurant.name, createdAt);

  const order = {
    order_no: orderNo,
    restaurant_id: restaurant._id,
    restaurant_slug: restaurant.slug,
    restaurant_name: restaurant.name,
    customer,
    phone,
    order_type: orderType,
    table_no: tableNo,
    note: cleanText(body.note ?? body.instructions, 500),
    items: lines,
    subtotal,
    tax_percent: 5,
    tax,
    total,
    status: 'Pending',
    created_at: createdAt,
    updated_at: createdAt,
  };

  try {
    const result = await cols.orders.insertOne(order);
    orderEvents.publishNewOrder(String(restaurant._id), {
      id: String(result.insertedId), order_no: orderNo, status: order.status,
      customer, total, created_at: createdAt,
    });

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      id: result.insertedId,
      order_no: orderNo,
      order: {
        ...order,
        id: result.insertedId,
        _id: undefined,
      },
      subtotal,
      tax,
      total,
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new HttpError(
        503,
        'Could not create an order number. Please try again.'
      );
    }

    throw err;
  }
});

// ---- authentication ----
router.post('/auth/login', loginLimiter, async (req, res) => {
  const u = await svc.authenticate(
    req.body.identifier ?? req.body.email,
    req.body.password
  );

  res.json({
    token: sign({ uid: u.id }, SESSION_SECRET),
    expires_in: 12 * 3600,
    user: svc.publicUser(u),
  });
});

router.post('/auth/session', loginLimiter, async (req, res, next) => {
  const u = await svc.authenticate(
    req.body.identifier ?? req.body.email,
    req.body.password
  );

  req.session.regenerate(err => {
    if (err) return next(err);

    req.session.user = { id: u.id };

    res.json({
      role: u.role,
      user: svc.publicUser(u),
    });
  });
});

router.delete('/auth/session', (req, res) => {
  const done = () => {
    res.clearCookie('sid');
    res.status(204).end();
  };

  req.session ? req.session.destroy(done) : done();
});

router.get('/auth/me', auth(), (req, res) => {
  res.json({ user: svc.publicUser(req.user) });
});

router.post('/auth/password', auth(), async (req, res) => {
  await svc.changePassword(
    req.user.id,
    req.body.current_password,
    req.body.new_password
  );

  res.status(204).end();
});

// ---- shared category and item routes ----
function menuRoutes(r, restaurantOf) {
  const ref = req => Number(req.params.ref);

  r.get('/categories', async (req, res) => {
    res.json({
      categories: await svc.listCategories(restaurantOf(req)),
    });
  });

  r.post('/categories', async (req, res) => {
    res.status(201).json(
      await svc.createCategory(restaurantOf(req), req.body.name)
    );
  });

  r.put('/categories/:ref', async (req, res) => {
    res.json(
      await svc.renameCategory(
        restaurantOf(req),
        ref(req),
        req.body.name
      )
    );
  });

  r.delete('/categories/:ref', async (req, res) => {
    await svc.deleteCategory(restaurantOf(req), ref(req));
    res.status(204).end();
  });

  r.get('/items', async (req, res) => {
    const items = await svc.listItems(
      restaurantOf(req),
      Number(req.query.category_id) || null
    );

    res.json({ items: items.map(svc.itemOut) });
  });

  r.post('/items', upload.single('image'), async (req, res) => {
    const item = await svc.saveItem(
      restaurantOf(req),
      req.body,
      photo(req)
    );

    res.status(201).json(svc.itemOut(item));
  });

  r.get('/items/:ref', async (req, res) => {
    res.json(
      svc.itemOut(
        await svc.getItem(restaurantOf(req), ref(req))
      )
    );
  });

  r.put('/items/:ref', upload.single('image'), async (req, res) => {
    const item = await svc.saveItem(
      restaurantOf(req),
      { ...req.body, id: ref(req) },
      photo(req)
    );

    res.json(svc.itemOut(item));
  });

  r.patch('/items/:ref/availability', async (req, res) => {
    const a = req.body.available;

    const available =
      a === undefined
        ? undefined
        : (
          a === true ||
          a === 'true' ||
          a === 1 ||
          a === '1'
        );

    res.json(
      svc.itemOut(
        await svc.setItemAvailable(
          restaurantOf(req),
          ref(req),
          available
        )
      )
    );
  });

  r.delete('/items/:ref', async (req, res) => {
    await svc.deleteItem(restaurantOf(req), ref(req));
    res.status(204).end();
  });

  r.get('/library/categories', async (req, res) => {
    res.json({
      categories: await svc.libraryCategories(restaurantOf(req)),
    });
  });

  r.get('/library/items', async (req, res) => {
    res.json(
      await svc.libraryItems(restaurantOf(req), req.query)
    );
  });

  r.post('/library/import', async (req, res) => {
    res.json(
      await svc.importFromLibrary(restaurantOf(req), req.body)
    );
  });
}

// ---- super admin ----
const admin = express.Router();

admin.use(auth('admin'));

admin.get('/summary', async (req, res) => {
  res.json(await svc.summary());
});

admin.get('/restaurants', async (req, res) => {
  const restaurants = await svc.listRestaurants();

  res.json({
    restaurants: restaurants.map(svc.restaurantOut),
  });
});

admin.post('/restaurants', async (req, res) => {
  const restaurant = await svc.createRestaurant(req.body);

  res.status(201).json(svc.restaurantOut(restaurant));
});

admin.get('/restaurants/:id', async (req, res) => {
  res.json(
    svc.restaurantOut(
      await svc.getRestaurant(id(req))
    )
  );
});

admin.patch('/restaurants/:id', async (req, res) => {
  res.json(
    svc.restaurantOut(
      await svc.updateRestaurant(id(req), req.body)
    )
  );
});

admin.post('/restaurants/:id/password', async (req, res) => {
  await svc.resetOwnerPassword(id(req), req.body.password);
  res.status(204).end();
});

admin.post('/restaurants/:id/reset-password', async (req, res) => {
  const r = await svc.getRestaurant(id(req));
  const password = svc.generatePassword();

  await svc.resetOwnerPassword(r.id, password);

  res.json({
    mobile: r.mobile,
    email: r.email,
    password,
  });
});

admin.post('/restaurants/:id/reveal-password', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    password: await svc.revealOwnerPassword(id(req)),
  });
});

admin.delete('/restaurants/:id', async (req, res) => {
  await svc.deleteRestaurant(id(req));
  res.status(204).end();
});

// Admin can inspect orders for a selected onboarded restaurant.
admin.get('/restaurants/:id/orders', async (req, res) => {
  const restaurant = await svc.getRestaurant(id(req));

  const orders = await cols.orders
    .find({ restaurant_id: restaurant.id })
    .sort({ created_at: -1 })
    .limit(500)
    .toArray();

  res.json({
    orders: orders.map(o => ({
      ...o,
      id: String(o._id),
      _id: undefined,
    })),
  });
});

const adminMenu = express.Router({ mergeParams: true });

adminMenu.use(async (req, res, next) => {
  await svc.getRestaurant(Number(req.params.id));
  next();
});

menuRoutes(adminMenu, req => Number(req.params.id));

admin.use('/restaurants/:id', adminMenu);

router.use('/admin', admin);

// ---- restaurant owner ----
const owner = express.Router();

owner.use(auth('owner'));

owner.get('/restaurant', async (req, res) => {
  res.json(
    svc.restaurantOut(
      await svc.getRestaurant(rid(req))
    )
  );
});

owner.patch('/restaurant', async (req, res) => {
  res.json(
    svc.restaurantOut(
      await svc.updateProfile(rid(req), req.body)
    )
  );
});

menuRoutes(owner, rid);

// Live stream for the authenticated restaurant dashboard.
owner.get('/orders/events', (req, res) => {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`event: connected\ndata: ${JSON.stringify({ restaurantId: String(rid(req)) })}\n\n`);
  const unsubscribe = orderEvents.subscribeRestaurant(String(rid(req)), payload => {
    res.write(`event: new-order\ndata: ${JSON.stringify(payload)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

// Restaurant owner order list.
owner.get('/orders', async (req, res) => {
  const orders = await cols.orders
    .find({ restaurant_id: rid(req) })
    .sort({ created_at: -1 })
    .limit(500)
    .toArray();

  res.set('Cache-Control', 'no-store');
  res.json({ orders: orders.map(o => ({ ...o, id: String(o._id), _id: undefined })) });
});

// Update order status and notify the customer immediately.
// Update order status and immediately notify the customer.
owner.patch('/orders/:orderId/status', async (req, res) => {

    // Accept lowercase, uppercase and mixed-case status values.
    const requestedStatus = String(req.body.status || '')
        .trim()
        .toLowerCase();

    const statusMap = {
        pending: 'Pending',
        accepted: 'Accepted',

        active: 'Preparing',
        preparing: 'Preparing',

        prepared: 'Ready',
        ready: 'Ready',

        completed: 'Completed',
        delivered: 'Completed',

        rejected: 'Rejected',
        cancelled: 'Cancelled',
        canceled: 'Cancelled'
    };

    const status = statusMap[requestedStatus];

    if (!status) {
        throw new HttpError(
            400,
            'Invalid order status: ' + requestedStatus
        );
    }

    // Validate MongoDB order ID.
    const { ObjectId } = require('mongodb');

    let orderId;

    try {
        orderId = new ObjectId(req.params.orderId);
    } catch {
        throw new HttpError(400, 'Invalid order ID');
    }

    // Update the order belonging to the logged-in restaurant.
    const result = await cols.orders.findOneAndUpdate(
        {
            _id: orderId,
            restaurant_id: rid(req)
        },
        {
            $set: {
                status: status,
                updated_at: new Date()
            }
        },
        {
            returnDocument: 'after'
        }
    );

    const updatedOrder = result?.value ?? result;

    if (!updatedOrder) {
        throw new HttpError(404, 'Order not found');
    }

    // Notify customer through the live event stream.
    const event = {
        orderId: String(updatedOrder._id),
        order_no: updatedOrder.order_no,
        status: status,
        updated_at: updatedOrder.updated_at
    };

    orderEvents.publishOrderStatus(
        String(updatedOrder._id),
        event
    );

    res.json({
        success: true,
        message: 'Order status updated successfully',
        status: status,

        order: {
            id: String(updatedOrder._id),
            order_no: updatedOrder.order_no,
            status: status
        }
    });

});

owner.post('/orders/delete-selected', async (req, res) => {

    const rawIds = req.body.ids || req.body.orderIds;

    if (!Array.isArray(rawIds) || rawIds.length === 0) {
        throw new HttpError(400, 'Select at least one order');
    }

    if (rawIds.length > 500) {
        throw new HttpError(400, 'Maximum 500 orders can be deleted at once');
    }

    const uniqueIds = [...new Set(rawIds.map(String))];

    const { ObjectId } = require('mongodb');

    const ids = uniqueIds.map(value => {

        if (!ObjectId.isValid(value)) {
            throw new HttpError(400, 'Invalid order ID');
        }

        return new ObjectId(value);
    });

    const deleted = await archiveThenDelete(
        {
            _id: { $in: ids },
            restaurant_id: rid(req)
        },
        'manually-deleted'
    );

    res.json({
        success: true,
        deleted,
        archived: deleted
    });
});

// Owner QR code.
owner.get('/qr.png', async (req, res) => {
  const r = await svc.getRestaurant(rid(req));

  res
    .type('png')
    .set(
      'Content-Disposition',
      req.query.download
        ? `attachment; filename="${r.slug}-menu-qr.png"`
        : 'inline'
    );

  const level = ['L', 'M', 'Q', 'H'].includes(
    String(req.query.level).toUpperCase()
  )
    ? String(req.query.level).toUpperCase()
    : 'M';

  res.send(
    await QRCode.toBuffer(
      `${BASE_URL}/m/${r.slug}`,
      {
        width: Math.min(
          Math.max(Number(req.query.size) || 800, 128),
          2048
        ),
        margin: 2,
        errorCorrectionLevel: level,
      }
    )
  );
});

router.use('/', owner);

// ---- not found ----
router.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = router;