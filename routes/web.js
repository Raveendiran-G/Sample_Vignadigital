// Page routes. The dashboards are static pages that talk to /api/v1.

const router = require('express').Router();
const path = require('path');

const svc = require('../lib/service');
const { cols } = require('../lib/db');

const file = name => path.join(__dirname, '..', 'public', name);

router.get('/', (req, res) =>
res.render('landing', {
contact: process.env.CONTACT_EMAIL || ''
})
);

router.get('/login', (req, res) =>
res.sendFile(file('login.html'))
);

router.get('/admin', (req, res) =>
res.sendFile(file('admin.html'))
);

router.get('/api/docs', (req, res) =>
res.sendFile(file('api-docs.html'))
);

router.get('/dashboard', (req, res) =>
res.sendFile(file('dashboard.html'))
);

// Customer menu: custom HTML when activated, otherwise default menu.
router.get('/m/:slug', async (req, res) => {
const menu = await svc.getMenu(req.params.slug);


if (!menu) {
    return res.status(404).send('Menu not available');
}

const restaurant = menu.restaurant;

res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https:; " +
        "font-src 'self' data: https:; " +
        "connect-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "frame-ancestors 'none'"
});

if (
    restaurant.custom_menu_enabled === true &&
    typeof restaurant.custom_menu_html === 'string' &&
    restaurant.custom_menu_html.trim()
) {
    return res
        .status(200)
        .type('html')
        .send(restaurant.custom_menu_html);
}

return res.status(200).sendFile(file('menu.html'));


});

module.exports = router;
