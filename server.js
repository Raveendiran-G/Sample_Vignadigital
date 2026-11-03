require('dotenv').config();

const { PORT, BASE_URL } = require('./lib/config');

const db = require('./lib/db');
const app = require('./app');

(async () => {
    try {
        // Connect to MongoDB before starting the server
        await db.init();

        const server = app.listen(PORT, () => {
            console.log(`VignaDigital running on port ${PORT}`);
            console.log(`Website: ${BASE_URL}`);
        });

        server.on('error', error => {
            console.error('Server error:', error);
            process.exit(1);
        });

    } catch (error) {
        console.error(
            'Failed to start VignaDigital:',
            error
        );

        process.exit(1);
    }
})();