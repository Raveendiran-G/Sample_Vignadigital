const express = require('express');
const path = require('path');

const svc = require('../lib/service');

const router = express.Router();

const publicDir = path.join(__dirname, '..', 'public');

// Homepage
router.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

// Login page
router.get('/login', (req, res) => {
    res.sendFile(path.join(publicDir, 'login.html'));
});

// Admin page
router.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
});

// Dashboard
router.get('/dashboard', (req, res) => {
    res.sendFile(path.join(publicDir, 'dashboard.html'));
});

// Kitchen page
router.get('/kitchen', (req, res) => {
    res.sendFile(path.join(publicDir, 'kitchen.html'));
});

// API documentation
router.get('/api/docs', (req, res) => {
    res.sendFile(path.join(publicDir, 'api-docs.html'));
});

// Customer restaurant menu
router.get('/m/:slug', async (req, res, next) => {
    try {
        const menu = await svc.getMenu(req.params.slug);

        if (!menu) {
            return res.status(404).send('Menu not found');
        }

        res.sendFile(path.join(publicDir, 'menu.html'));

    } catch (error) {
        next(error);
    }
});

module.exports = router;