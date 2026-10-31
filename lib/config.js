const os = require('os');
const path = require('path');
const fs = require('fs');

const isProd = process.env.NODE_ENV === 'production';

const PORT = Number(process.env.PORT) || 3000;

const lanIp = () =>
    Object.values(os.networkInterfaces())
        .flat()
        .find(i => i && i.family === 'IPv4' && !i.internal)?.address;

const BASE_URL = (
    process.env.BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://${(!isProd && lanIp()) || 'localhost'}:${PORT}`
).replace(/\/+$/, '');

const DATA_DIR = path.resolve(
    process.env.DATA_DIR || path.join(__dirname, '..', 'data')
);

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// Create upload directories.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    (isProd ? '' : 'dev-secret-change-me');

const MONGODB_DB = process.env.MONGODB_DB || 'digitalmenu';

const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) {
    console.error('MONGODB_URI is missing in .env');
    process.exit(1);
}

if (isProd) {
    const missing = [];

    if (SESSION_SECRET.length < 32) {
        missing.push('SESSION_SECRET');
    }

    if (!process.env.BASE_URL && !process.env.RENDER_EXTERNAL_URL) {
        missing.push('BASE_URL');
    }

    if (missing.length) {
        console.error('Missing environment variables:', missing.join(', '));
        process.exit(1);
    }
}

module.exports = {
    isProd,
    PORT,
    BASE_URL,
    DATA_DIR,
    UPLOAD_DIR,
    SESSION_SECRET,
    MONGODB_URI,
    MONGODB_DB
};