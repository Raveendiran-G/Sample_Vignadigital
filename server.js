const { PORT, BASE_URL } = require('./lib/config');
const db = require('./lib/db');
const app = require('./app');

let initPromise;

function initializeDatabase() {
if (!initPromise) {
initPromise = db.init().catch((error) => {
initPromise = null;
throw error;
});
}

return initPromise;
}

// Vercel serverless entry point
if (process.env.VERCEL) {
app.use(async (req, res, next) => {
try {
await initializeDatabase();
next();
} catch (error) {
console.error('Database initialization failed:', error);
res.status(500).json({ error: 'Database initialization failed' });
}
});

module.exports = app;
} else {
// Local development / traditional server
initializeDatabase()
.then(() => {
const server = app.listen(PORT, () => {
console.log(
`Menu Card listening on :${PORT} (public URL ${BASE_URL})`
);
});

function shutdown(signal) {
    console.log(`${signal} received, shutting down`);

    server.close(async () => {
      try {
        await db.close();
      } finally {
        process.exit(0);
      }
    });

    setTimeout(() => process.exit(1), 10000).unref();
  }

  ['SIGTERM', 'SIGINT'].forEach((signal) => {
    process.on(signal, () => shutdown(signal));
  });
})
.catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});

}
