const dotenv = require('dotenv');
dotenv.config({ path: require('path').resolve(__dirname, '..', '.env') });

const os = require('os');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

const PORT = Number(process.env.PORT) || 3000;

const lanIp = () =>
    Object.values(os.networkInterfaces())
        .flat()
        .find(i =>
            i &&
            i.family === 'IPv4' &&
            !i.internal
        )?.address;

const BASE_URL = (
    process.env.BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://${(!isProd && lanIp()) || 'localhost'}:${PORT}`
).replace(/\/+$/, '');

const DATA_DIR = path.resolve(
    process.env.DATA_DIR ||
    path.join(__dirname, '..', 'data')
);

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    (isProd ? '' : 'dev-secret-change-me');

const MONGODB_DB =
    process.env.MONGODB_DB || 'digitalmenu';

let MONGODB_URI = process.env.MONGODB_URI || '';

if (
    !MONGODB_URI &&
    process.env.MONGODB_USER &&
    process.env.MONGODB_PASSWORD &&
    process.env.MONGODB_HOST
) {
    MONGODB_URI =
        `mongodb+srv://${encodeURIComponent(process.env.MONGODB_USER)}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${process.env.MONGODB_HOST}/?retryWrites=true&w=majority`;
}

if (!MONGODB_URI) {
    throw new Error(
        'MONGODB_URI is missing. Check your root .env file.'
    );
}

if (isProd) {
    const missing = [];

    if (SESSION_SECRET.length < 32) {
        missing.push('SESSION_SECRET');
    }

    if (!process.env.BASE_URL) {
        missing.push('BASE_URL');
    }

    if (missing.length) {
        throw new Error(
            'Missing production variables: ' +
            missing.join(', ')
        );
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