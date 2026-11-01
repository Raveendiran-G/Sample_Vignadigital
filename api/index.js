const app = require('../app');
const db = require('../lib/db');

let dbInitPromise;

async function initializeDatabase() {
    if (!dbInitPromise) {
        dbInitPromise = db.init().catch(error => {
            dbInitPromise = null;
            throw error;
        });
    }

    await dbInitPromise;
}

module.exports = async (req, res) => {
    try {
        // Always initialize MongoDB before handling requests.
        await initializeDatabase();

        // Forward the request to Express.
        return app(req, res);

    } catch (error) {
        console.error('Vercel application initialization failed:', error);

        if (!res.headersSent) {
            return res.status(500).json({
                error: 'Application initialization failed',
                message: error.message
            });
        }
    }
};