// JSON API used by dashboards (login cookie) and external clients (bearer token).
// Handlers are async (MongoDB); Express 5 forwards thrown errors to app.js error handler.

const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const crypto = require('crypto');

const { BASE_URL, SESSION_SECRET } = require('../lib/config');
const { upload } = require('../lib/uploads');
const { sign, verify } = require('../lib/token');
const { cols } = require('../lib/db');
const svc = require('../lib/service');
const { HttpError } = svc;

const router = express.Router();

router.use(express.json({ limit: '3mb' }));

// ======================================================
// LIVE ORDER NOTIFICATIONS (SERVER-SENT EVENTS)
// ======================================================

const orderEventClients = new Map();

function publishNewOrder(restaurantId, order) {
    const clients = orderEventClients.get(String(restaurantId));

    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify({
        id: String(order._id || order.id || ''),
        order_no: order.order_no,
        customer: order.customer,
        total: order.total,
        created_at: order.created_at
    });

    for (const client of clients) {
        try {
            if (!client.destroyed && !client.writableEnded) {
                client.write(`event: new-order\ndata: ${payload}\n\n`);
            }
        } catch (error) {
            clients.delete(client);
        }
    }
}

// ======================================================
// RATE LIMITERS
// ======================================================

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_RATE_LIMIT) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many attempts. Try again in 15 minutes.'
    }
});

const orderLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.ORDER_RATE_LIMIT) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many order attempts. Please try again later.'
    }
});

// ======================================================
// AUTHENTICATION
// ======================================================

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const sameOrigin = req => {
    const origin = req.get('origin');

    if (!origin) return true;

    try {
        return new URL(origin).host === req.get('host');
    } catch {
        return false;
    }
};

const auth = role => async (req, res, next) => {
    let user = null;
    let viaCookie = false;

    const match = /^Bearer (.+)$/.exec(
        req.get('authorization') || ''
    );

    if (match) {
        const payload = verify(match[1], SESSION_SECRET);
        user = payload && await svc.userIsActive(payload.uid);

    } else if (req.session?.user) {
        user = await svc.userIsActive(req.session.user.id);
        viaCookie = !!user;
    }

    if (!user) {
        throw new HttpError(
            401,
            'Missing, invalid or expired login'
        );
    }

    if (
        viaCookie &&
        !SAFE.has(req.method) &&
        !sameOrigin(req)
    ) {
        throw new HttpError(
            403,
            'Cross-site request blocked'
        );
    }

    if (role && user.role !== role) {
        throw new HttpError(403, 'Forbidden');
    }

    req.user = user;

    next();
};

const rid = req => req.user.restaurant_id;

const id = req => Number(req.params.id);

const photo = req =>
    req.file?.filename ||
    (
        typeof req.body.image === 'string' &&
        req.body.image.startsWith('data:')
            ? svc.saveImageData(req.body.image)
            : null
    );

const cleanText = (value, max = 200) =>
    String(value ?? '').trim().slice(0, max);

const cleanPhone = value =>
    String(value ?? '')
        .replace(/[\s()-]/g, '')
        .slice(0, 20);

const roundMoney = number =>
    Math.round((number + Number.EPSILON) * 100) / 100;

// ======================================================
// API DOCUMENTATION
// ======================================================

router.get('/openapi.json', (req, res) => {
    res.json(require('../lib/openapi'));
});

// ======================================================
// PUBLIC MENU
// ======================================================

router.get('/public/menu/:slug', async (req, res) => {

    const menu = await svc.getMenu(req.params.slug);

    if (!menu) {
        throw new HttpError(404, 'Menu not available');
    }

    const restaurant = menu.restaurant;

    res.set('Cache-Control', 'public, max-age=30');

    res.json({
        restaurant: {
            name: restaurant.name,
            slug: restaurant.slug,
            tagline: restaurant.tagline,
            theme_color: restaurant.theme_color,
            city: restaurant.city,
            address: restaurant.address,
            phone: restaurant.contact_phone,
            logo: restaurant.logo
                ? `/uploads/${restaurant.logo}`
                : null,
            order_enabled: restaurant.order_enabled !== false
        },

        categories: menu.sections.map(section => ({
            id: section.id,
            name: section.name,
            items: section.items.map(svc.itemOut)
        }))
    });
});

// ======================================================
// CUSTOMER PLACES NEW ORDER
// ======================================================

router.post(
    '/public/orders',
    orderLimiter,
    async (req, res) => {

        const body = req.body || {};

        const slug = cleanText(
            body.slug,
            100
        ).toLowerCase();

        if (!slug) {
            throw new HttpError(
                400,
                'Restaurant slug is required'
            );
        }

        const menu = await svc.getMenu(slug);

        if (!menu) {
            throw new HttpError(
                404,
                'Restaurant menu not found or unavailable'
            );
        }

        const restaurant = menu.restaurant;

        if (restaurant.order_enabled === false) {
            throw new HttpError(
                403,
                'Online ordering is currently disabled for this restaurant'
            );
        }

        const customer = cleanText(
            body.customer ?? body.name,
            80
        );

        const phone = cleanPhone(
            body.phone ?? body.mobile
        );

        if (customer.length < 2) {
            throw new HttpError(
                400,
                'Please enter your name'
            );
        }

        if (!/^\+?\d{7,15}$/.test(phone)) {
            throw new HttpError(
                400,
                'Please enter a valid mobile number'
            );
        }

        const orderType = cleanText(
            body.order_type || 'Dine In',
            30
        );

        const allowedTypes = new Set([
            'Dine In',
            'Takeaway',
            'Delivery',
            'Room Service'
        ]);

        if (!allowedTypes.has(orderType)) {
            throw new HttpError(
                400,
                'Invalid order type'
            );
        }

        const tableNo = cleanText(
            body.table_no ?? body.table_number,
            30
        );

        if (orderType === 'Dine In' && !tableNo) {
            throw new HttpError(
                400,
                'Table number is required for Dine In orders'
            );
        }

        if (
            !Array.isArray(body.items) ||
            body.items.length === 0 ||
            body.items.length > 50
        ) {
            throw new HttpError(
                400,
                'Your cart is empty or contains too many different items'
            );
        }

        const availableItems = new Map(
            menu.sections
                .flatMap(section => section.items)
                .map(item => [Number(item.id), item])
        );

        const lines = [];

        for (const requested of body.items) {

            const itemId = Number(
                requested?.id ?? requested?.item_id
            );

            const qty = Number(
                requested?.qty ?? requested?.quantity
            );

            if (
                !Number.isSafeInteger(itemId) ||
                !Number.isSafeInteger(qty) ||
                qty < 1 ||
                qty > 99
            ) {
                throw new HttpError(
                    400,
                    'One or more cart items have an invalid item ID or quantity'
                );
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
                line_total: roundMoney(
                    Number(item.price) * qty
                )
            });
        }

        const subtotal = roundMoney(
            lines.reduce(
                (sum, line) => sum + line.line_total,
                0
            )
        );

        const tax = roundMoney(subtotal * 0.05);

        const total = roundMoney(subtotal + tax);

        const orderNo =
            `${
                String(restaurant.name || 'ORD')
                    .replace(/[^A-Za-z]/g, '')
                    .slice(0, 3)
                    .toUpperCase() || 'ORD'
            }-${crypto.randomInt(10000000, 99999999)}`;

        const createdAt = new Date();

        const order = {
            order_no: orderNo,
            restaurant_id: restaurant._id,
            restaurant_slug: restaurant.slug,
            restaurant_name: restaurant.name,
            customer,
            phone,
            order_type: orderType,
            table_no: tableNo,
            note: cleanText(
                body.note ?? body.instructions,
                500
            ),
            items: lines,
            subtotal,
            tax_percent: 5,
            tax,
            total,
            status: 'Pending',
            created_at: createdAt,
            updated_at: createdAt
        };

        try {

            // Save order first.
            const result = await cols.orders.insertOne(order);

            // Immediately notify the correct restaurant dashboard.
            publishNewOrder(
                restaurant._id,
                {
                    ...order,
                    _id: result.insertedId
                }
            );

            // Respond to customer.
            res.status(201).json({
                success: true,
                message: 'Order placed successfully',
                id: result.insertedId,
                order_no: orderNo,
                order: {
                    ...order,
                    id: result.insertedId,
                    _id: undefined
                },
                subtotal,
                tax,
                total
            });

        } catch (error) {

            if (error?.code === 11000) {
                throw new HttpError(
                    503,
                    'Could not create an order number. Please try again.'
                );
            }

            throw error;
        }
    }
);

// ======================================================
// LOGIN
// ======================================================

router.post('/auth/login', loginLimiter, async (req, res) => {

    const user = await svc.authenticate(
        req.body.identifier ?? req.body.email,
        req.body.password
    );

    res.json({
        token: sign(
            { uid: user.id },
            SESSION_SECRET
        ),
        expires_in: 12 * 3600,
        user: svc.publicUser(user)
    });
});

router.post(
    '/auth/session',
    loginLimiter,
    async (req, res, next) => {

        const user = await svc.authenticate(
            req.body.identifier ?? req.body.email,
            req.body.password
        );

        req.session.regenerate(error => {

            if (error) return next(error);

            req.session.user = {
                id: user.id
            };

            res.json({
                role: user.role,
                user: svc.publicUser(user)
            });
        });
    }
);

router.delete('/auth/session', (req, res) => {

    const done = () => {
        res.clearCookie('sid');
        res.status(204).end();
    };

    req.session
        ? req.session.destroy(done)
        : done();
});

router.get('/auth/me', auth(), (req, res) => {
    res.json({
        user: svc.publicUser(req.user)
    });
});

router.post('/auth/password', auth(), async (req, res) => {

    await svc.changePassword(
        req.user.id,
        req.body.current_password,
        req.body.new_password
    );

    res.status(204).end();
});

// ======================================================
// CATEGORY AND ITEM ROUTES
// ======================================================

function menuRoutes(route, restaurantOf) {

    const ref = req => Number(req.params.ref);

    route.get('/categories', async (req, res) => {
        res.json({
            categories: await svc.listCategories(
                restaurantOf(req)
            )
        });
    });

    route.post('/categories', async (req, res) => {
        res.status(201).json(
            await svc.createCategory(
                restaurantOf(req),
                req.body.name
            )
        );
    });

    route.put('/categories/:ref', async (req, res) => {
        res.json(
            await svc.renameCategory(
                restaurantOf(req),
                ref(req),
                req.body.name
            )
        );
    });

    route.delete('/categories/:ref', async (req, res) => {

        await svc.deleteCategory(
            restaurantOf(req),
            ref(req)
        );

        res.status(204).end();
    });

    route.get('/items', async (req, res) => {

        const items = await svc.listItems(
            restaurantOf(req),
            Number(req.query.category_id) || null
        );

        res.json({
            items: items.map(svc.itemOut)
        });
    });

    route.post(
        '/items',
        upload.single('image'),
        async (req, res) => {

            res.status(201).json(
                svc.itemOut(
                    await svc.saveItem(
                        restaurantOf(req),
                        req.body,
                        photo(req)
                    )
                )
            );
        }
    );

    route.get('/items/:ref', async (req, res) => {
        res.json(
            svc.itemOut(
                await svc.getItem(
                    restaurantOf(req),
                    ref(req)
                )
            )
        );
    });

    route.put(
        '/items/:ref',
        upload.single('image'),
        async (req, res) => {

            res.json(
                svc.itemOut(
                    await svc.saveItem(
                        restaurantOf(req),
                        {
                            ...req.body,
                            id: ref(req)
                        },
                        photo(req)
                    )
                )
            );
        }
    );

    route.patch('/items/:ref/availability', async (req, res) => {

        const available = req.body.available;

        res.json(
            svc.itemOut(
                await svc.setItemAvailable(
                    restaurantOf(req),
                    ref(req),
                    available === undefined
                        ? undefined
                        : (
                            available === true ||
                            available === 'true' ||
                            available === 1 ||
                            available === '1'
                        )
                )
            )
        );
    });

    route.delete('/items/:ref', async (req, res) => {

        await svc.deleteItem(
            restaurantOf(req),
            ref(req)
        );

        res.status(204).end();
    });

    route.get('/library/categories', async (req, res) => {
        res.json(
            await svc.libraryCategories(
                restaurantOf(req)
            )
        );
    });

    route.get('/library/items', async (req, res) => {
        res.json(
            await svc.libraryItems(
                restaurantOf(req),
                req.query
            )
        );
    });

    route.post('/library/import', async (req, res) => {
        res.json(
            await svc.importFromLibrary(
                restaurantOf(req),
                req.body
            )
        );
    });
}

// ======================================================
// SUPER ADMIN
// ======================================================

const admin = express.Router();

admin.use(auth('admin'));

admin.get('/summary', async (req, res) => {
    res.json(await svc.summary());
});

admin.get('/restaurants', async (req, res) => {

    const restaurants = await svc.listRestaurants();

    res.json({
        restaurants: restaurants.map(svc.restaurantOut)
    });
});

admin.post('/restaurants', async (req, res) => {

    res.status(201).json(
        svc.restaurantOut(
            await svc.createRestaurant(req.body)
        )
    );
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
            await svc.updateRestaurant(
                id(req),
                req.body
            )
        )
    );
});

admin.post('/restaurants/:id/password', async (req, res) => {

    await svc.resetOwnerPassword(
        id(req),
        req.body.password
    );

    res.status(204).end();
});

admin.post('/restaurants/:id/reset-password', async (req, res) => {

    const restaurant = await svc.getRestaurant(id(req));

    const password = svc.generatePassword();

    await svc.resetOwnerPassword(
        restaurant.id,
        password
    );

    res.json({
        mobile: restaurant.mobile,
        email: restaurant.email,
        password
    });
});

admin.post('/restaurants/:id/reveal-password', async (req, res) => {

    res.set('Cache-Control', 'no-store');

    res.json({
        password: await svc.revealOwnerPassword(id(req))
    });
});

admin.delete('/restaurants/:id', async (req, res) => {

    await svc.deleteRestaurant(id(req));

    res.status(204).end();
});

admin.get('/restaurants/:id/orders', async (req, res) => {

    const restaurant = await svc.getRestaurant(id(req));

    const orders = await cols.orders
        .find({
            restaurant_id: restaurant.id
        })
        .sort({
            created_at: -1
        })
        .limit(500)
        .toArray();

    res.json({
        orders: orders.map(order => ({
            ...order,
            id: String(order._id),
            _id: undefined
        }))
    });
});

const adminMenu = express.Router({
    mergeParams: true
});

adminMenu.use(async (req, res, next) => {

    await svc.getRestaurant(
        Number(req.params.id)
    );

    next();
});

menuRoutes(
    adminMenu,
    req => Number(req.params.id)
);

admin.use(
    '/restaurants/:id',
    adminMenu
);

router.use('/admin', admin);

// ======================================================
// RESTAURANT OWNER
// ======================================================

const owner = express.Router();

owner.use(auth('owner'));

// Live notifications for new orders
owner.get('/orders/events', (req, res) => {
    res.status(200);
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    res.flushHeaders?.();
    res.write(': connected\n\n');

    const restaurantId = String(rid(req));

    let clients = orderEventClients.get(restaurantId);

    if (!clients) {
        clients = new Set();
        orderEventClients.set(restaurantId, clients);
    }

    clients.add(res);

    const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) {
            res.write(': keep-alive\n\n');
        }
    }, 15000);

    const cleanup = () => {
        clearInterval(heartbeat);
        clients.delete(res);

        if (clients.size === 0) {
            orderEventClients.delete(restaurantId);
        }
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
});

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
            await svc.updateProfile(
                rid(req),
                req.body
            )
        )
    );
});

menuRoutes(owner, rid);

// ======================================================
// LIVE ORDER EVENT CONNECTION
// ======================================================

owner.get('/orders/events', (req, res) => {

    res.status(200);

    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    res.flushHeaders?.();

    res.write(': connected\n\n');

    const restaurantId = String(rid(req));

    let clients = orderEventClients.get(restaurantId);

    if (!clients) {
        clients = new Set();
        orderEventClients.set(restaurantId, clients);
    }

    clients.add(res);

    // Keep the connection alive.
    const heartbeat = setInterval(() => {

        if (!res.destroyed && !res.writableEnded) {
            res.write(': keep-alive\n\n');
        }

    }, 15000);

    const cleanup = () => {

        clearInterval(heartbeat);

        clients.delete(res);

        if (clients.size === 0) {
            orderEventClients.delete(restaurantId);
        }
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
});

// ======================================================
// GET ORDERS
// ======================================================

owner.get('/orders', async (req, res) => {

    const orders = await cols.orders
        .find({
            restaurant_id: rid(req)
        })
        .sort({
            created_at: -1
        })
        .limit(500)
        .toArray();

    res.json({
        orders: orders.map(order => ({
            ...order,
            id: String(order._id),
            _id: undefined
        }))
    });
});

// ======================================================
// UPDATE ORDER STATUS
// ======================================================

owner.patch('/orders/:orderId/status', async (req, res) => {

    const allowed = new Set([
        'Pending',
        'Accepted',
        'Preparing',
        'Ready',
        'Completed',
        'Rejected',
        'Cancelled'
    ]);

    const status = cleanText(
        req.body.status,
        30
    );

    if (!allowed.has(status)) {
        throw new HttpError(
            400,
            'Invalid order status'
        );
    }

    const { ObjectId } = require('mongodb');

    let orderId;

    try {
        orderId = new ObjectId(req.params.orderId);
    } catch {
        throw new HttpError(
            400,
            'Invalid order ID'
        );
    }

    const result = await cols.orders.updateOne(
        {
            _id: orderId,
            restaurant_id: rid(req)
        },
        {
            $set: {
                status,
                updated_at: new Date()
            }
        }
    );

    if (!result.matchedCount) {
        throw new HttpError(
            404,
            'Order not found'
        );
    }

    res.json({
        success: true,
        status
    });
});

// ======================================================
// QR CODE
// ======================================================

owner.get('/qr.png', async (req, res) => {

    const restaurant = await svc.getRestaurant(
        rid(req)
    );

    res.type('png').set(
        'Content-Disposition',
        req.query.download
            ? `attachment; filename="${restaurant.slug}-menu-qr.png"`
            : 'inline'
    );

    const level = ['L', 'M', 'Q', 'H'].includes(
        String(req.query.level).toUpperCase()
    )
        ? String(req.query.level).toUpperCase()
        : 'M';

    res.send(
        await QRCode.toBuffer(
            `${BASE_URL}/m/${restaurant.slug}`,
            {
                width: Math.min(
                    Math.max(Number(req.query.size) || 800, 128),
                    2048
                ),
                margin: 2,
                errorCorrectionLevel: level
            }
        )
    );
});

// ======================================================
// REGISTER OWNER ROUTES
// ======================================================

router.use('/', owner);

// ======================================================
// 404
// ======================================================

router.use((req, res) => {

    res.status(404).json({
        error: 'Not found'
    });

});

module.exports = router;