const { cols } = require('./db');

const ORDER_RETENTION_MS = 15 * 24 * 60 * 60 * 1000;

async function archiveThenDelete(filter, reason) {
  const orders = await cols.orders.find(filter).limit(1000).toArray();
  if (!orders.length) return 0;

  const archivedAt = new Date();
  await cols.order_archive.bulkWrite(orders.map(order => ({
    replaceOne: {
      filter: { original_id: String(order._id) },
      replacement: {
        ...order,
        original_id: String(order._id),
        archived_at: archivedAt,
        archive_reason: reason,
      },
      upsert: true,
    },
  })), { ordered: true });

  const deleted = await cols.orders.deleteMany({
    _id: { $in: orders.map(order => order._id) },
  });
  return deleted.deletedCount || 0;
}

async function deleteOrdersOlderThan15Days(filter = {}) {
  const cutoff = new Date(Date.now() - ORDER_RETENTION_MS);
  let deleted = 0;
  let batch;

  do {
    batch = await archiveThenDelete(
      { ...filter, created_at: { $lt: cutoff } },
      'older-than-15-days'
    );
    deleted += batch;
  } while (batch === 1000);

  return { deleted, archived: deleted, cutoff };
}

function startOrderCleanup({ intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  const run = async () => {
    try {
      const result = await deleteOrdersOlderThan15Days();
      if (result.deleted) {
        console.log(`Archived and deleted ${result.deleted} order(s) older than 15 days.`);
      }
    } catch (error) {
      console.error('Automatic order cleanup failed:', error);
    }
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  archiveThenDelete,
  deleteOrdersOlderThan15Days,
  startOrderCleanup,
};
