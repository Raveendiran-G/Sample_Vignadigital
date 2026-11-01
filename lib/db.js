const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const { UPLOAD_DIR, MONGODB_URI, MONGODB_DB, isProd } = require('./config');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const client = new MongoClient(MONGODB_URI, {
  serverSelectionTimeoutMS: 15000
});

const cols = {};

async function nextId(name) {
  const r = await cols.counters.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return r.seq;
}
function indiaDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).formatToParts(date);

    const values = Object.fromEntries(
        parts.map(part => [part.type, part.value])
    );

    return {
        dateKey: `${values.year}${values.month}${values.day}`,
        dateLabel: `${values.day}${values.month}${values.year}`
    };
}

async function nextDailyOrderNo(restaurantName, date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).formatToParts(date);

    const values = Object.fromEntries(
        parts.map(part => [part.type, part.value])
    );

    const monthNames = [
        'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
        'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
    ];

    const month = monthNames[Number(values.month) - 1];
    const dateKey = `${values.year}${values.month}${values.day}`;
    const dateLabel = `${values.day}${values.month}${values.year}`;

    const counterId = `daily-order:${dateKey}`;

    const result = await cols.counters.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
    );

    const counter = result?.value ?? result;

    if (!counter || !Number.isSafeInteger(counter.seq)) {
        throw new Error('Could not generate daily order number');
    }

    return `${month}-${dateLabel}-${String(counter.seq).padStart(3, '0')}`;
}

const isDuplicate = e => e?.code === 11000;

async function seedAdmin() {
  if (await cols.users.findOne({ role: 'admin' })) return;

  const email = (process.env.ADMIN_EMAIL || 'admin@menucard.local').toLowerCase();
  let pass = process.env.ADMIN_PASSWORD;

  if (!pass) {
    if (isProd) {
      throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in production.');
    }

    pass = crypto.randomBytes(6).toString('hex');
    console.log(`Super admin created: ${email} / ${pass}`);
  } else if (pass.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  }

  await cols.users.insertOne({
    _id: await nextId('users'),
    email,
    mobile: null,
    password_hash: bcrypt.hashSync(pass, 10),
    password_enc: null,
    role: 'admin',
    restaurant_id: null
  });
}

async function init({ seed = true } = {}) {
  try {
    await client.connect();
  } catch (e) {
    const msg = String(e.message).split('\n')[0].slice(0, 200);
    throw new Error(`Could not connect to MongoDB: ${msg}`);
  }

const d = client.db(MONGODB_DB);

const collectionNames = [
  'restaurants',
  'users',
  'categories',
  'items',
  'sessions',
  'counters',
  'orders',
  'order_archive'
];

for (const name of collectionNames) {
  cols[name] = d.collection(name);
}

await Promise.all([
  cols.restaurants.createIndex({ slug: 1 }, { unique: true }),
  cols.users.createIndex(
    { mobile: 1 },
    {
      unique: true,
      partialFilterExpression: { mobile: { $type: 'string' } }
    }
  ),
  cols.users.createIndex(
    { email: 1 },
    {
      unique: true,
      partialFilterExpression: { email: { $type: 'string' } }
    }
  ),
  cols.users.createIndex({ restaurant_id: 1 }),
  cols.categories.createIndex({ restaurant_id: 1, sort: 1 }),
  cols.items.createIndex({ restaurant_id: 1, category_id: 1 }),
  cols.orders.createIndex({ restaurant_id: 1, created_at: -1 }),
  cols.orders.createIndex({ order_no: 1 }, { unique: true }),
  cols.order_archive.createIndex({ original_id: 1 }, { unique: true }),
  cols.order_archive.createIndex({ restaurant_id: 1, archived_at: -1 }),
  cols.sessions.createIndex({ expires: 1 }, { expireAfterSeconds: 0 })
]);

  if (seed) await seedAdmin();
}

const ping = () => client.db('admin').command({ ping: 1 });
const close = () => client.close();

module.exports = {
    client,
    cols,
    init,
    nextId,
    nextDailyOrderNo,
    isDuplicate,
    ping,
    close
};