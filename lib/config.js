const path = require('path');
const os = require('os');
const dotenv = require('dotenv');

// Load .env from the project root directory
dotenv.config({
    path: path.resolve(__dirname, '..', '.env')
});

// Environment
const isProd = process.env.NODE_ENV === 'production';

// Server port
const PORT = Number(process.env.PORT) || 3000;

// Detect local network IPv4 address
const lanIp = () => {
    const interfaces = Object.values(
        os.networkInterfaces()
    ).flat();

    const network = interfaces.find(
        i =>
            i &&
            (i.family === 'IPv4' || i.family === 4) &&
            !i.internal
    );

    return network?.address || null;
};

// Base website URL
const BASE_URL = (
    process.env.BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://${(!isProd && lanIp()) || 'localhost'}:${PORT}`
).replace(/\/+$/, '');

// Data directory
const DATA_DIR = path.resolve(
    process.env.DATA_DIR ||
    path.join(__dirname, '..', 'data')
);

// Upload directory
const UPLOAD_DIR = path.join(
    DATA_DIR,
    'uploads'
);

// Session secret
const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    (isProd ? '' : 'dev-secret-change-me');

// MongoDB database name
const MONGODB_DB =
    process.env.MONGODB_DB || 'digitalmenu';

// MongoDB connection URI
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

// Validate MongoDB configuration
if (!MONGODB_URI) {
    throw new Error(
        'MONGODB_URI is missing. Check your root .env file.'
    );
}

// Production environment validation
if (isProd) {
    const missing = [];

    if (SESSION_SECRET.length < 32) {
        missing.push('SESSION_SECRET');
    }

    if (!process.env.BASE_URL) {
        missing.push('BASE_URL');
    }

    if (missing.length > 0) {
        throw new Error(
            'Missing production variables: ' +
            missing.join(', ')
        );
    }
}

// Export configuration
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