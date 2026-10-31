// Load environment variables first
require('dotenv').config();

const { PORT, BASE_URL } = require('./lib/config');
const db = require('./lib/db');
const { startOrderCleanup } = require('./lib/order-retention');
const app = require('./app');

(async () => {
    try {
        // Connect to MongoDB
        await db.init();
        const orderCleanupTimer = startOrderCleanup();

        // Start the actual application from app.js
        const server = app.listen(PORT, () => {
            console.log(
                `Menu Card listening on :${PORT} (public URL ${BASE_URL})`
            );
        });

        // Graceful shutdown
        function shutdown(signal) {
            console.log(`${signal} received, shutting down`);
            clearInterval(orderCleanupTimer);

            server.close(async () => {
                await db.close();
                process.exit(0);
            });

            setTimeout(() => process.exit(1), 10000).unref();
        }

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        console.error('Application startup failed:', error);
        process.exit(1);
    }
})();