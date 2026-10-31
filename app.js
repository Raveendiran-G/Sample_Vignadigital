const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const multer = require('multer');

const db = require('./lib/db');
const { isProd, UPLOAD_DIR, SESSION_SECRET } = require('./lib/config');
const { MongoStore } = require('./lib/store');
const { HttpError } = require('./lib/service');

const app = express();

app.disable('x-powered-by');

// Reverse proxy configuration
app.set(
    'trust proxy',
    process.env.TRUST_PROXY
        ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY
        : 1
);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            upgradeInsecureRequests: isProd ? [] : null,
        },
    },
}));

app.use(compression());

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.ping();
        res.json({ status: 'ok' });
    } catch {
        res.status(503).json({ status: 'error' });
    }
});

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, file) => {
        res.setHeader(
            'Cache-Control',
            /[\\/]fonts[\\/]/.test(file)
                ? 'public, max-age=31536000, immutable'
                : 'no-cache'
        );
    },
}));

// Uploaded images
app.use('/uploads', express.static(UPLOAD_DIR, {
    maxAge: '30d',
    immutable: true
}));

// Swagger assets
app.use(
    '/api/docs/assets',
    express.static(
        path.dirname(require.resolve('swagger-ui-dist/package.json')),
        {
            index: false,
            maxAge: isProd ? '7d' : 0
        }
    )
);

// Session configuration
app.use(session({
    name: 'sid',
    secret: SESSION_SECRET,
    store: new MongoStore(() => db.cols.sessions),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd ? 'auto' : false,
        maxAge: 1000 * 60 * 60 * 12
    }
}));

// =======================================
// API ROUTES
// =======================================

const apiRouter = require('./routes/api');

// IMPORTANT: Mount the longer path first.
app.use('/api/v1', apiRouter);

// Support the dashboard's /api/... requests too.
app.use('/api', apiRouter);

// Website routes
app.use(require('./routes/web'));

// 404 handler
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            error: 'Not found'
        });
    }

    res.status(404).type('text').send('Page not found');
});

// Error handler
app.use((err, req, res, next) => {

    let status = err.status || 500;
    let message = err.message;

    if (err instanceof multer.MulterError) {

        status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;

        message = err.code === 'LIMIT_FILE_SIZE'
            ? 'Image too large (max 5MB)'
            : err.message;

    } else if (err.type === 'entity.parse.failed') {

        status = 400;
        message = 'Invalid JSON';

    } else if (err.type === 'entity.too.large') {

        status = 413;
        message = 'That image is too large';

    } else if (db.isDuplicate(err)) {

        status = 409;
        message = 'That value is already in use';

    } else if (!(err instanceof HttpError) && !(status < 500)) {

        console.error(err);
        message = 'Internal server error';
    }

    if (req.path.startsWith('/api/')) {
        return res.status(status).json({
            error: message
        });
    }

    res.status(status).send(
        status < 500 ? message : 'Something went wrong'
    );
});

module.exports = app;