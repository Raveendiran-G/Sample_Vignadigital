const app = require('../app');
const db = require('../lib/db');
const { startOrderCleanup } = require('../lib/order-retention');

let initPromise;

function initializeDatabase() {
  if (!initPromise) {
    initPromise = db.init()
      .then(() => {
        startOrderCleanup();
      })
      .catch((error) => {
        initPromise = null;
        throw error;
      });
  }

  return initPromise;
}

module.exports = async (req, res) => {
  try {
    await initializeDatabase();
    return app(req, res);
  } catch (error) {
    console.error('Application initialization failed:', error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Application initialization failed'
      });
    }
  }
};