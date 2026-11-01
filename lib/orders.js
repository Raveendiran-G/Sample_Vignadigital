// lib/orders.js

const { cols, nextId } = require('./db');

const streams = new Map();

const timestamp = () => new Date().toISOString();

function emit(restaurantId, event, data) {
  const clients = streams.get(Number(restaurantId));
  if (!clients) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {
    client.write(message);
  }
}

function cleanOrder(order) {
  const { _id, ...data } = order;
  return { ...data, id: _id };
}

async function createOrder(body) {
  const restaurant = await cols.restaurants.findOne({
    slug: String(body.slug || '')
  });

  if (!restaurant || !restaurant.active) {
    throw new Error('Restaurant is unavailable');
  }

  if (!Array.isArray(body.items) || !body.items.length) {
    throw new Error('Your cart is empty');
  }

  const requested = body.items
    .map(item => ({
      id: Number(item.id),
      qty: Number(item.qty)
    }))
    .filter(item =>
      Number.isInteger(item.id) &&
      Number.isInteger(item.qty) &&
      item.qty >= 1 &&
      item.qty <= 20
    );

  if (!requested.length) {
    throw new Error('Invalid order items');
  }

  const ids = [...new Set(requested.map(item => item.id))];

  const menuItems = await cols.items.find({
    _id: { $in: ids },
    restaurant_id: restaurant._id,
    available: true
  }).toArray();

  if (menuItems.length !== ids.length) {
    throw new Error('Some menu items are unavailable');
  }

  const itemMap = new Map(menuItems.map(item => [item._id, item]));

  const items = requested.map(request => {
    const item = itemMap.get(request.id);

    if (!item) throw new Error('Invalid menu item');

    const price = Number(item.price);
    const lineTotal = price * request.qty;

    return {
      id: item._id,
      name: item.name,
      price,
      qty: request.qty,
      line_total: lineTotal
    };
  });

  const subtotal = items.reduce(
    (sum, item) => sum + item.line_total,
    0
  );

  const tax = Math.round(subtotal * 0.05 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  const id = await nextId('orders');
  const orderNo = `ORD-${String(id).padStart(5, '0')}`;

  const order = {
    _id: id,
    restaurant_id: restaurant._id,
    order_no: orderNo,
    customer: String(body.customer || '').trim().slice(0, 100),
    phone: String(body.phone || '').trim().slice(0, 20),
    note: String(body.note || '').trim().slice(0, 500),
    order_type: String(body.order_type || 'Dine In'),
    table_no: String(body.table_no || '').trim().slice(0, 30),
    items,
    subtotal,
    tax,
    total,
    status: 'New',
    created_at: timestamp(),
    updated_at: timestamp()
  };

  if (!order.customer || !order.phone) {
    throw new Error('Customer name and phone are required');
  }

  await cols.orders.insertOne(order);

  emit(restaurant._id, 'new-order', cleanOrder(order));

  return cleanOrder(order);
}

async function listOrders(restaurantId) {
  const orders = await cols.orders
    .find({ restaurant_id: Number(restaurantId) })
    .sort({ created_at: -1 })
    .toArray();

  return orders.map(cleanOrder);
}

async function updateStatus(restaurantId, orderId, status) {
  const allowed = {
    active: 'Preparing',
    preparing: 'Preparing',
    prepared: 'Ready',
    ready: 'Ready',
    served: 'Served',
    cancelled: 'Cancelled'
  };

  const nextStatus = allowed[String(status || '').toLowerCase()];

  if (!nextStatus) {
    throw new Error('Invalid order status');
  }

  const id = Number(orderId);

  const order = await cols.orders.findOne({
    _id: id,
    restaurant_id: Number(restaurantId)
  });

  if (!order) throw new Error('Order not found');

  await cols.orders.updateOne(
    { _id: id, restaurant_id: Number(restaurantId) },
    {
      $set: {
        status: nextStatus,
        updated_at: timestamp()
      }
    }
  );

  const updated = cleanOrder({
    ...order,
    status: nextStatus,
    updated_at: timestamp()
  });

  emit(restaurantId, 'order-updated', updated);

  return updated;
}

async function deleteOrders(restaurantId, ids) {
  const validIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map(Number)
      .filter(Number.isInteger)
  )];

  if (!validIds.length) {
    throw new Error('Select at least one order');
  }

  const orders = await cols.orders.find({
    restaurant_id: Number(restaurantId),
    _id: { $in: validIds }
  }).toArray();

  if (orders.length) {
    await cols.ordersArchive.insertMany(
      orders.map(order => ({
        ...order,
        archived_at: timestamp(),
        archive_reason: 'Manual deletion'
      }))
    );

    await cols.orders.deleteMany({
      restaurant_id: Number(restaurantId),
      _id: { $in: orders.map(order => order._id) }
    });
  }

  return { deleted: orders.length };
}

async function deleteOldOrders(restaurantId) {
  const cutoff = new Date(
    Date.now() - 15 * 24 * 60 * 60 * 1000
  ).toISOString();

  const oldOrders = await cols.orders.find({
    restaurant_id: Number(restaurantId),
    created_at: { $lt: cutoff }
  }).toArray();

  if (oldOrders.length) {
    await cols.ordersArchive.insertMany(
      oldOrders.map(order => ({
        ...order,
        archived_at: timestamp(),
        archive_reason: 'Older than 15 days'
      }))
    );

    await cols.orders.deleteMany({
      restaurant_id: Number(restaurantId),
      _id: { $in: oldOrders.map(order => order._id) }
    });
  }

  return { deleted: oldOrders.length };
}

function orderEvents(req, res, restaurantId) {
  restaurantId = Number(restaurantId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write(': connected\n\n');

  if (!streams.has(restaurantId)) {
    streams.set(restaurantId, new Set());
  }

  const clients = streams.get(restaurantId);
  clients.add(res);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);

    if (!clients.size) {
      streams.delete(restaurantId);
    }
  });
}

function publicOrderEvents(req, res, orderId) {
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const listener = async () => {
    const order = await cols.orders.findOne({
      _id: Number(orderId)
    });

    if (order) {
      res.write(
        `event: order-status\ndata: ${JSON.stringify({
          status: order.status
        })}\n\n`
      );
    }
  };

  const timer = setInterval(listener, 3000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(timer);
  });
}

module.exports = {
  createOrder,
  listOrders,
  updateStatus,
  deleteOrders,
  deleteOldOrders,
  orderEvents,
  publicOrderEvents
};