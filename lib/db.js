// MongoDB connection and collections. Ids stay small integers (see nextId) so the API shapes did not change.
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const { UPLOAD_DIR, MONGODB_URI, MONGODB_DB, isProd } = require('./config');

fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // photos stay on disk (DATA_DIR/uploads); everything else is in MongoDB

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
const cols = {}; // filled in by init(): restaurants, users, categories, items, sessions, counters, orders

// Auto-increment ids per collection (restaurants, users, categories, items).
async function nextId(name) {
  const result = await cols.counters.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );

  // Supports both MongoDB driver response shapes:
  // a document (newer drivers) or { value: document } (older drivers).
  const counter = result?.value ?? result;
  return counter.seq;
}

// Generate a daily order number using India time.
// Format: RESTAURANT-PREFIX-DDMMYYYY-001
// Example: DES-30102026-001, DES-30102026-002.
// The counter key is shared by prefix + date so the existing globally
// unique orders.order_no index cannot collide across restaurants.
function indiaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    dateKey: `${values.year}${values.month}${values.day}`,
    dateLabel: `${values.day}${values.month}${values.year}`,
  };
}

async function nextDailyOrderNo(restaurantName, date = new Date()) {
  const prefix =
    String(restaurantName || 'ORD')
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 3)
      .toUpperCase() || 'ORD';

  const { dateKey, dateLabel } = indiaDateParts(date);
  const counterId = `daily-order:${prefix}:${dateKey}`;

  // Concurrent first orders can race to create the counter document.
  // If one gets E11000, retry without upsert and increment the winner's doc.
  let result;
  try {
    result = await cols.counters.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;

    result = await cols.counters.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { returnDocument: 'after' }
    );
  }

  const counter = result?.value ?? result;
  if (!counter || !Number.isSafeInteger(counter.seq)) {
    throw new Error('Could not generate the daily order number');
  }

  return `${prefix}-${dateLabel}-${String(counter.seq).padStart(3, '0')}`;
}

const isDuplicate = e => e?.code === 11000;

async function seedAdmin() {
  if (await cols.users.findOne({ role: 'admin' })) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@menucard.local').toLowerCase();
  let pass = process.env.ADMIN_PASSWORD;
  if (!pass) {
    if (isProd) throw new Error('First run in production: set ADMIN_EMAIL and ADMIN_PASSWORD (min 8 chars).');
    pass = crypto.randomBytes(6).toString('hex');
    console.log(`\n>>> Super admin created: ${email} / ${pass}\n`);
  } else if (pass.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  }
  await cols.users.insertOne({ _id: await nextId('users'), email, mobile: null, password_hash: bcrypt.hashSync(pass, 10), password_enc: null, role: 'admin', restaurant_id: null });
}

// Connect, create indexes (safe to repeat) and make sure a super admin exists.
async function init({ seed = true } = {}) {
  try {
    await client.connect();
  } catch (e) {
    const msg = String(e.message).split('\n')[0].slice(0, 200);
    // a wrong login reaches Atlas fine (so the network rule is OK); a blocked IP shows up as a TLS/timeout error
    const hint = /bad auth|authentication failed/i.test(msg)
      ? '  -> The username or password in MONGODB_URI is wrong. Symbols in the password (@ : / # ?) must be URL-encoded, or use a simpler password.'
      : '  -> Atlas: Security > Network Access must allow this server\'s IP address (and check the host in MONGODB_URI).';
    throw new Error(`Could not connect to MongoDB: ${msg}\n${hint}`);
  }
  const d = client.db(MONGODB_DB);
  for (const n of ['restaurants', 'users', 'categories', 'items', 'sessions', 'counters', 'orders', 'order_archive']) cols[n] = d.collection(n);
  await Promise.all([
    cols.restaurants.createIndex({ slug: 1 }, { unique: true }),
    // partial indexes: owners without an email (or legacy ones without a mobile) don't collide on null
    cols.users.createIndex({ mobile: 1 }, { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } }),
    cols.users.createIndex({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } }),
    cols.users.createIndex({ restaurant_id: 1 }),
    cols.categories.createIndex({ restaurant_id: 1, sort: 1 }),
    cols.items.createIndex({ restaurant_id: 1, category_id: 1 }),
    cols.orders.createIndex({ restaurant_id: 1, created_at: -1 }),
    cols.orders.createIndex({ order_no: 1 }, { unique: true }),
    cols.order_archive.createIndex({ original_id: 1 }, { unique: true }),
    cols.order_archive.createIndex({ restaurant_id: 1, archived_at: -1 }),
    cols.sessions.createIndex({ expires: 1 }, { expireAfterSeconds: 0 }), // MongoDB deletes expired sessions itself
  ]);
  if (seed) await seedAdmin();
}

const ping = () => client.db('admin').command({ ping: 1 });
const close = () => client.close();

module.exports = { client, cols, init, nextId, nextDailyOrderNo, isDuplicate, ping, close };
