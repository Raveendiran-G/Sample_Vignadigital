// Page routes.
// Dashboards are static pages that communicate with /api/v1.

const router = require('express').Router();
const path = require('path');

const svc = require('../lib/service');
const { injectMenuRuntime } = require('../lib/custom-menu');

const file = name =>
    path.join(__dirname, '..', 'public', name);


/* =========================================================
   LANDING PAGE
   ========================================================= */

router.get('/', (req, res) => {
    res.render('landing', {
        contact: process.env.CONTACT_EMAIL || ''
    });
});


/* =========================================================
   LOGIN
   ========================================================= */

router.get('/login', (req, res) => {
    res.sendFile(file('login.html'));
});


/* =========================================================
   SUPER ADMIN
   ========================================================= */

router.get('/admin', (req, res) => {
    res.sendFile(file('admin.html'));
});


/* =========================================================
   API DOCUMENTATION
   ========================================================= */

router.get('/api/docs', (req, res) => {
    res.sendFile(file('api-docs.html'));
});


/* =========================================================
   RESTAURANT DASHBOARD
   ========================================================= */

router.get('/dashboard', (req, res) => {
    res.sendFile(file('dashboard.html'));
});


/* =========================================================
   CUSTOMER MENU
   ========================================================= */

router.get('/m/:slug', async (req, res) => {
    try {
        const slug = String(req.params.slug || '')
            .trim()
            .toLowerCase();

        if (!slug) {
            return res.status(400).send('Invalid restaurant menu.');
        }

        const menu = await svc.getMenu(slug);

        if (!menu || !menu.restaurant) {
            return res.status(404).send('Menu not available');
        }

        const restaurant = menu.restaurant;

        // Prevent stale customer menu HTML.
        res.set({
            'Cache-Control':
                'private, no-store, no-cache, must-revalidate',

            'Pragma': 'no-cache',

            'Expires': '0',

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

        // Use uploaded custom HTML when enabled.
        if (
            restaurant.custom_menu_enabled === true &&
            typeof restaurant.custom_menu_html === 'string' &&
            restaurant.custom_menu_html.trim()
        ) {
            const customHTML = injectMenuRuntime(
                restaurant.custom_menu_html,
                restaurant.slug
            );

            return res
                .status(200)
                .type('html')
                .send(customHTML);
        }

        // Otherwise load the standard customer menu.
        return res
            .status(200)
            .sendFile(file('menu.html'));

    } catch (error) {
        console.error(
            'Customer menu route error:',
            error
        );

        return res
            .status(500)
            .send('Unable to load menu');
    }
});


module.exports = router;