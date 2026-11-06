// JSON API used by dashboards (login cookie) and external clients (bearer token).
// Express 5 forwards async errors to the app.js error handler.

const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const { ObjectId } = require('mongodb');

const {
    extractMenuData,
    injectMenuRuntime,
    synchronizeMenu
} = require('../lib/custom-menu');

const { BASE_URL, SESSION_SECRET } = require('../lib/config');
const { upload, saveUploadedFile } = require('../lib/uploads');
const { sign, verify } = require('../lib/token');
const { cols, nextDailyOrderNo } = require('../lib/db');

const {
    subscribeRestaurant,
    subscribeOrder,
    publishNewOrder,
    publishOrderStatus
} = require('../lib/order-events');

const svc = require('../lib/service');
const { HttpError } = svc;

const router = express.Router();


router.use(express.json({ limit: '3mb' }));

// ======================================================
// COMMON HELPERS
// ======================================================

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const cleanText = (value, max = 200) =>
    String(value ?? '').trim().slice(0, max);

const cleanPhone = value =>
    String(value ?? '')
        .replace(/[\s()-]/g, '')
        .slice(0, 20);

const roundMoney = number =>
    Math.round((number + Number.EPSILON) * 100) / 100;

const rid = req => req.user.restaurant_id;

const id = req => Number(req.params.id);

const sameOrigin = req => {
    const origin = req.get('origin');

    if (!origin) return true;

    try {
        return new URL(origin).host === req.get('host');
    } catch {
        return false;
    }
};

const photo = async req => {
    if (req.file) {
        return await saveUploadedFile(req.file);
    }

    if (
        typeof req.body.image === 'string' &&
        req.body.image.startsWith('data:')
    ) {
        return await svc.saveImageData(req.body.image);
    }

    return null;
};

function parsePublicOrderId(value) {
    if (!/^[a-f\d]{24}$/i.test(String(value || ''))) {
        throw new HttpError(400, 'Invalid order ID');
    }

    return new ObjectId(value);
}

function imageUrl(image) {
    if (!image) return null;

    const value = String(image).trim();

    if (/^https?:\/\//i.test(value)) {
        return value;
    }

    if (value.startsWith('/') && !value.startsWith('//')) {
        return value.split('/').map((part, index) => {
            if (index === 0 || !part) return part;

            try {
                return encodeURIComponent(decodeURIComponent(part));
            } catch {
                return encodeURIComponent(part);
            }
        }).join('/');
    }

    const filename = value.replace(/^\/+/, '');

    if (!filename) return null;

    if (/^uploads\//i.test(filename)) {
        return '/' + filename
            .split('/')
            .map(part => encodeURIComponent(part))
            .join('/');
    }

    return '/uploads/' + filename
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');
}

// ======================================================
// LIVE ORDER NOTIFICATIONS
// ======================================================

function streamEvents(req, res, subscribe, eventName) {
    res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    res.flushHeaders?.();
    res.write(': connected\n\n');
    res.flush?.();

    const unsubscribe = subscribe(payload => {
        if (!res.destroyed && !res.writableEnded) {
            res.write(
                `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
            );
            res.flush?.();
        }
    });

    const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) {
            res.write(': keep-alive\n\n');
            res.flush?.();
        }
    }, 15000);

    const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
    };

    req.on('close', cleanup);
    res.on('error', cleanup);
}

// ======================================================
// RATE LIMITERS
// ======================================================

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_RATE_LIMIT) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many attempts. Try again in 15 minutes.'
    }
});

const orderLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.ORDER_RATE_LIMIT) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many order attempts. Please try again later.'
    }
});

// ======================================================
// AUTHENTICATION
// ======================================================

const auth = role => async (req, res, next) => {
    let user = null;
    let viaCookie = false;

    const match = /^Bearer (.+)$/.exec(
        req.get('authorization') || ''
    );

    if (match) {
        const payload = verify(match[1], SESSION_SECRET);
        user = payload && await svc.userIsActive(payload.uid);
    } else if (req.session?.user) {
        user = await svc.userIsActive(req.session.user.id);
        viaCookie = !!user;
    }

    if (!user) {
        throw new HttpError(
            401,
            'Missing, invalid or expired login'
        );
    }

    if (
        viaCookie &&
        !SAFE.has(req.method) &&
        !sameOrigin(req)
    ) {
        throw new HttpError(
            403,
            'Cross-site request blocked'
        );
    }

    if (role && user.role !== role) {
        throw new HttpError(403, 'Forbidden');
    }

    req.user = user;
    next();
};

// ======================================================
// API DOCUMENTATION
// ======================================================

router.get('/openapi.json', (req, res) => {
    res.json(require('../lib/openapi'));
});

// ======================================================
// PUBLIC MENU API
// ======================================================

router.get('/public/menu/:slug', async (req, res) => {
    res.set({
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
    });

    const menu = await svc.getMenu(req.params.slug, {
        includeUnavailable: req.query.include_unavailable === '1'
    });

    if (!menu) {
        throw new HttpError(404, 'Menu not available');
    }

    const restaurant = menu.restaurant;

    res.json({
        restaurant: {
            name: restaurant.name,
            slug: restaurant.slug,
            tagline: restaurant.tagline,
            theme_color: restaurant.theme_color,
            city: restaurant.city,
            address: restaurant.address,
            phone: restaurant.contact_phone,
            logo: imageUrl(restaurant.logo),

            // Canonical ordering status.
            order_enabled: restaurant.order_enabled !== false,

            // Compatibility aliases for older frontend versions.
            ordering_enabled: restaurant.order_enabled !== false,
            orderingEnabled: restaurant.order_enabled !== false,

            // Custom HTML menu status.
            custom_menu_enabled:
                restaurant.custom_menu_enabled === true,

            // Payment details.
            upi_id: restaurant.upi_id || '',
            upi_qr_image: imageUrl(restaurant.upi_qr_image)
        },

        categories: menu.sections.map(section => ({
            id: section.id,
            name: section.name,

            items: section.items.map(item => ({
                ...svc.itemOut(item),
                image: imageUrl(item.image),
                image_url: imageUrl(item.image)
            }))
        }))
    });
});

// ======================================================
// PUBLIC CUSTOM HTML MENU
// ======================================================

router.get('/public/custom-menu/:slug', async (req, res) => {
    res.set({
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
    });

    const menu = await svc.getMenu(req.params.slug);

    if (!menu) {
        throw new HttpError(404, 'Restaurant menu not found');
    }

    const restaurant = menu.restaurant;

    if (
        restaurant.custom_menu_enabled !== true ||
        !restaurant.custom_menu_html
    ) {
        throw new HttpError(404, 'Custom menu is not enabled');
    }

    res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff'
    });

    res.send(
        injectMenuRuntime(
            restaurant.custom_menu_html,
            restaurant.slug
        )
    );
});

// ======================================================
// PUBLIC ORDER STATUS
// ======================================================

router.get('/public/orders/:orderId', async (req, res) => {
    const orderId = parsePublicOrderId(req.params.orderId);

    const order = await cols.orders.findOne(
        { _id: orderId },
        {
            projection: {
                order_no: 1,
                status: 1,
                updated_at: 1
            }
        }
    );

    if (!order) {
        throw new HttpError(404, 'Order not found');
    }

    res.set('Cache-Control', 'no-store').json({
        id: String(order._id),
        order_no: order.order_no,
        status: order.status,
        updated_at: order.updated_at
    });
});

router.get('/public/orders/:orderId/events', async (req, res) => {
    const orderId = parsePublicOrderId(req.params.orderId);

    const exists = await cols.orders.findOne(
        { _id: orderId },
        { projection: { _id: 1 } }
    );

    if (!exists) {
        throw new HttpError(404, 'Order not found');
    }

    streamEvents(
        req,
        res,
        listener => subscribeOrder(orderId, listener),
        'order-status'
    );
});

// ======================================================
// CUSTOMER PLACES NEW ORDER
// ======================================================

router.post(
    '/public/orders',
    orderLimiter,
    async (req, res) => {
        const body = req.body || {};

        const slug = cleanText(body.slug, 100).toLowerCase();

        if (!slug) {
            throw new HttpError(400, 'Restaurant slug is required');
        }

        const menu = await svc.getMenu(slug);

        if (!menu) {
            throw new HttpError(
                404,
                'Restaurant menu not found or unavailable'
            );
        }

        const restaurant = menu.restaurant;

        if (restaurant.order_enabled === false) {
            throw new HttpError(
                403,
                'Online ordering is currently disabled for this restaurant'
            );
        }

        const customer = cleanText(
            body.customer ?? body.name,
            80
        );

        const phone = cleanPhone(
            body.phone ?? body.mobile
        );

        if (customer.length < 2) {
            throw new HttpError(400, 'Please enter your name');
        }

        if (!/^\+?\d{7,15}$/.test(phone)) {
            throw new HttpError(
                400,
                'Please enter a valid mobile number'
            );
        }

        const orderType = cleanText(
            body.order_type || 'Dine In',
            30
        );

        const allowedTypes = new Set([
            'Dine In',
            'Takeaway',
            'Delivery',
            'Room Service'
        ]);

        if (!allowedTypes.has(orderType)) {
            throw new HttpError(400, 'Invalid order type');
        }

        const locationValue = cleanText(
            body.delivery_address ??
            body.room_no ??
            body.location ??
            body.table_no ??
            body.table_number,
            200
        );

        let tableNo = '';

        if (orderType === 'Dine In') {
            tableNo = cleanText(
                body.table_no ?? body.table_number,
                30
            );

            if (!tableNo) {
                throw new HttpError(
                    400,
                    'Table number is required for Dine In orders'
                );
            }
        }

        if (orderType === 'Delivery' && !locationValue) {
            throw new HttpError(
                400,
                'Delivery address is required'
            );
        }

        if (orderType === 'Room Service' && !locationValue) {
            throw new HttpError(
                400,
                'Room number is required'
            );
        }

        if (
            !Array.isArray(body.items) ||
            body.items.length === 0 ||
            body.items.length > 50
        ) {
            throw new HttpError(
                400,
                'Your cart is empty or contains too many different items'
            );
        }

        const availableItems = new Map(
            menu.sections
                .flatMap(section => section.items)
                .map(item => [Number(item.id), item])
        );

        const lines = [];

        for (const requested of body.items) {
            const itemId = Number(
                requested?.id ?? requested?.item_id
            );

            const qty = Number(
                requested?.qty ?? requested?.quantity
            );

            if (
                !Number.isSafeInteger(itemId) ||
                !Number.isSafeInteger(qty) ||
                qty < 1 ||
                qty > 99
            ) {
                throw new HttpError(
                    400,
                    'One or more cart items have an invalid item ID or quantity'
                );
            }

            const item = availableItems.get(itemId);

            if (!item || !item.available) {
                throw new HttpError(
                    409,
                    'An item in your cart is no longer available. Please refresh the menu.'
                );
            }

            lines.push({
                item_id: item.id,
                name: item.name,
                price: Number(item.price),
                qty,
                line_total: roundMoney(
                    Number(item.price) * qty
                )
            });
        }

        const subtotal = roundMoney(
            lines.reduce(
                (sum, line) => sum + line.line_total,
                0
            )
        );

        const tax = roundMoney(subtotal * 0.05);
        const total = roundMoney(subtotal + tax);

        const createdAt = new Date();

        const orderNo = await nextDailyOrderNo(
            restaurant.name,
            createdAt
        );

        const order = {
            order_no: orderNo,
            restaurant_id: restaurant._id,
            restaurant_slug: restaurant.slug,
            restaurant_name: restaurant.name,

            customer,
            phone,

            order_type: orderType,

            table_no: tableNo,

            // Keep dedicated location fields for dashboard/receipt.
            delivery_address:
                orderType === 'Delivery' ? locationValue : '',

            room_no:
                orderType === 'Room Service' ? locationValue : '',

            location: locationValue,

            note: cleanText(
                body.note ?? body.instructions,
                500
            ),

            items: lines,
            subtotal,
            tax_percent: 5,
            tax,
            total,

            status: 'Pending',
            created_at: createdAt,
            updated_at: createdAt
        };

        try {
            const result = await cols.orders.insertOne(order);

            const savedOrder = {
                ...order,
                _id: result.insertedId,
                id: String(result.insertedId)
            };

            publishNewOrder(
                restaurant._id,
                savedOrder
            );

            res.status(201).json({
                success: true,
                message: 'Order placed successfully',
                id: result.insertedId,
                order_no: orderNo,
                order: {
                    ...order,
                    id: result.insertedId
                },
                subtotal,
                tax,
                total
            });

        } catch (error) {
            if (error?.code === 11000) {
                throw new HttpError(
                    503,
                    'Could not create an order number. Please try again.'
                );
            }

            throw error;
        }
    }
);

// ======================================================
// LOGIN
// ======================================================

router.post('/auth/login', loginLimiter, async (req, res) => {
    const user = await svc.authenticate(
        req.body.identifier ?? req.body.email,
        req.body.password
    );

    res.json({
        token: sign(
            { uid: user.id },
            SESSION_SECRET
        ),
        expires_in: 12 * 3600,
        user: svc.publicUser(user)
    });
});

router.post(
    '/auth/session',
    loginLimiter,
    async (req, res, next) => {
        const user = await svc.authenticate(
            req.body.identifier ?? req.body.email,
            req.body.password
        );

        req.session.regenerate(error => {
            if (error) return next(error);

            req.session.user = {
                id: user.id
            };

            res.json({
                role: user.role,
                user: svc.publicUser(user)
            });
        });
    }
);

router.delete('/auth/session', (req, res) => {
    const done = () => {
        res.clearCookie('sid');
        res.status(204).end();
    };

    req.session
        ? req.session.destroy(done)
        : done();
});

router.get('/auth/me', auth(), (req, res) => {
    res.json({
        user: svc.publicUser(req.user)
    });
});

router.post('/auth/password', auth(), async (req, res) => {
    await svc.changePassword(
        req.user.id,
        req.body.current_password,
        req.body.new_password
    );

    res.status(204).end();
});

// ======================================================
// CATEGORY AND ITEM ROUTES
// ======================================================

function libraryRoutes(route, restaurantOf) {

    // --------------------------------------------------
    // MENU LIBRARY
    // Available only within the authenticated owner/admin
    // restaurant context supplied by the caller.
    // --------------------------------------------------

    route.get('/library/categories', async (req, res) => {
        const restaurantId = Number(restaurantOf(req));

        if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) {
            throw new HttpError(400, 'Invalid restaurant ID');
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json({
            categories: await svc.libraryCategories(restaurantId)
        });
    });

    route.get('/library/items', async (req, res) => {
        const restaurantId = Number(restaurantOf(req));

        if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) {
            throw new HttpError(400, 'Invalid restaurant ID');
        }

        const queryRestaurant = req.query.restaurant_id;

        if (
            queryRestaurant !== undefined &&
            (!/^\d+$/.test(String(queryRestaurant)) ||
                Number(queryRestaurant) <= 0)
        ) {
            throw new HttpError(400, 'Invalid library restaurant ID');
        }

        const result = await svc.libraryItems(restaurantId, {
            q: req.query.q,
            category: req.query.category,
            restaurant_id: queryRestaurant,
            limit: req.query.limit,
            offset: req.query.offset
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json(result);
    });

    route.post('/library/import', async (req, res) => {
        const restaurantId = Number(restaurantOf(req));

        if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) {
            throw new HttpError(400, 'Invalid restaurant ID');
        }

        res.json(
            await svc.importFromLibrary(restaurantId, req.body)
        );
    });
}

function menuRoutes(route, restaurantOf) {

    const ref = req => Number(req.params.ref);

    // --------------------------------------------------
    // GET MENU ITEMS
    // Works for Super Admin and Restaurant Owner
    // --------------------------------------------------

    route.get('/items', async (req, res) => {
        try {
            const restaurantId = restaurantOf(req);

            if (
                restaurantId === undefined ||
                restaurantId === null ||
                !Number.isFinite(Number(restaurantId))
            ) {
                throw new HttpError(
                    400,
                    'Invalid restaurant ID'
                );
            }

            const categoryId = req.query.category_id
                ? Number(req.query.category_id)
                : null;

            if (
                categoryId !== null &&
                (!Number.isSafeInteger(categoryId) || categoryId <= 0)
            ) {
                throw new HttpError(
                    400,
                    'Invalid category ID'
                );
            }

            const items = await svc.listItems(
                Number(restaurantId),
                categoryId
            );

            res.set({
                'Cache-Control': 'private, no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });

            return res.json({
                items
            });

        } catch (error) {
            console.error(
                '[GET ITEMS ERROR]',
                error
            );

            throw error;
        }
    });

    // ==================================================
    // CREATE MENU ITEM
    // ==================================================

    route.post('/items', async (req, res) => {
        const restaurantId = restaurantOf(req);
        const image = await photo(req);

        const item = await svc.saveItem(
            restaurantId,
            {
                name: req.body.name,
                description: req.body.description,
                price: req.body.price,
                category_id: req.body.category_id,
                available: req.body.available,
                remove_image: req.body.remove_image
            },
            image
        );

        res.status(201).json({
            success: true,
            item
        });
    });


    // ==================================================
    // UPDATE MENU ITEM
    // ==================================================

    route.put('/items/:ref', async (req, res) => {
        const restaurantId = restaurantOf(req);
        const itemId = ref(req);
        const image = await photo(req);

        const item = await svc.saveItem(
            restaurantId,
            {
                id: itemId,
                name: req.body.name,
                description: req.body.description,
                price: req.body.price,
                category_id: req.body.category_id,
                available: req.body.available,
                remove_image: req.body.remove_image
            },
            image
        );

        res.json({
            success: true,
            item
        });
    });


    // ==================================================
    // HIDE / SHOW MENU ITEM
    // ==================================================

    route.patch('/items/:ref/availability', async (req, res) => {
        const restaurantId = restaurantOf(req);
        const itemId = ref(req);

        if (!Number.isSafeInteger(itemId) || itemId <= 0) {
            throw new HttpError(400, 'Invalid item ID');
        }

        if (typeof req.body?.available !== 'boolean') {
            throw new HttpError(400, 'Available must be true or false');
        }

        const item = await svc.setItemAvailable(
            restaurantId,
            itemId,
            req.body.available
        );

        res.set('Cache-Control', 'no-store');

        res.json({
            success: true,
            message: item.available
                ? 'Item is now visible'
                : 'Item is now hidden',
            item
        });
    });


    // ==================================================
    // DELETE MENU ITEM
    // ==================================================

    route.delete('/items/:ref', async (req, res) => {
        const restaurantId = restaurantOf(req);
        const itemId = ref(req);

        await svc.deleteItem(restaurantId, itemId);

        res.json({
            success: true,
            message: 'Item deleted successfully'
        });
    });
    // --------------------------------------------------
    // GET CATEGORIES
    // --------------------------------------------------

    route.get('/categories', async (req, res) => {

        res.set(
            'Cache-Control',
            'no-store, no-cache, must-revalidate'
        );

        res.json({
            categories: await svc.listCategories(
                restaurantOf(req)
            )
        });

    });


    // --------------------------------------------------
    // CREATE CATEGORY
    // --------------------------------------------------

    route.post('/categories', async (req, res) => {

        res.status(201).json(
            await svc.createCategory(
                restaurantOf(req),
                req.body.name
            )
        );

    });


    // --------------------------------------------------
    // RENAME CATEGORY
    // --------------------------------------------------

    route.put('/categories/:ref', async (req, res) => {

        res.json(
            await svc.renameCategory(
                restaurantOf(req),
                ref(req),
                req.body.name
            )
        );

    });


    // --------------------------------------------------
    // DELETE CATEGORY
    // --------------------------------------------------

    route.delete('/categories/:ref', async (req, res) => {

        await svc.deleteCategory(
            restaurantOf(req),
            ref(req)
        );

        res.status(204).end();

    });


    // --------------------------------------------------
    // GLOBAL DISH IMAGE SYNCHRONIZATION
    // --------------------------------------------------

    route.post(
        '/items/bulk-images',
        upload.array('images', 120),
        async (req, res) => {

            const restaurantId = restaurantOf(req);
            const files = req.files || [];

            if (!files.length) {
                throw new HttpError(
                    400,
                    'Please select image files.'
                );
            }

            const normalize = value =>
                String(value || '')
                    .replace(/\.[^.]+$/, '')
                    .normalize('NFKD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '');

            // Load the current restaurant's items.
            const existingItems = await cols.items
                .find({
                    restaurant_id: restaurantId
                })
                .toArray();

            const itemMap = new Map();

            for (const item of existingItems) {

                const key = normalize(item.name);

                if (!itemMap.has(key)) {
                    itemMap.set(key, []);
                }

                itemMap.get(key).push(item);

            }

            const report = {
                total: files.length,
                uploaded: 0,
                updated: 0,
                synchronized_items: 0,
                unmatched: [],
                ambiguous: [],
                failed: []
            };

            for (const file of files) {

                const filename = String(file.originalname || '')
                    .replace(/\\/g, '/')
                    .split('/')
                    .pop();

                const key = normalize(filename);

                const matches = itemMap.get(key) || [];

                if (!matches.length) {

                    report.unmatched.push(filename);

                    continue;
                }

                if (matches.length > 1) {

                    report.ambiguous.push({
                        filename,
                        matching_items: matches.map(
                            item => item.name
                        )
                    });

                    continue;
                }

                const item = matches[0];

                let image = null;

                try {

                    // Upload the image once.
                    image = await saveUploadedFile(file);

                    if (!image) {
                        throw new Error(
                            'Image upload returned an empty path.'
                        );
                    }

                    // Update matching dishes across ALL restaurants.
                    const syncResult =
                        await svc.syncDishImageEverywhere(
                            item.name,
                            image
                        );

                    if (!syncResult || !syncResult.matched) {
                        throw new Error(
                            'No matching dishes were found.'
                        );
                    }

                    report.uploaded++;

                    report.updated += syncResult.updated;

                    report.synchronized_items +=
                        syncResult.matched;

                } catch (error) {

                    console.error(
                        'Global image synchronization failed:',
                        filename,
                        error
                    );

                    report.failed.push({
                        filename,
                        reason: error.message
                    });

                }

            }

            res.json({
                success: report.failed.length === 0,
                message: 'Global image synchronization completed.',
                report
            });

        }
    );

}
// ======================================================
// SUPER ADMIN
// ======================================================

const admin = express.Router();

admin.use(auth('admin'));

admin.get('/summary', async (req, res) => {
    res.json(await svc.summary());
});

admin.get('/restaurants', async (req, res) => {
    const restaurants = await svc.listRestaurants();

    res.json({
        restaurants: restaurants.map(svc.restaurantOut)
    });
});

admin.post('/restaurants', async (req, res) => {
    res.status(201).json(
        svc.restaurantOut(
            await svc.createRestaurant(req.body)
        )
    );
});

admin.get('/restaurants/:id', async (req, res) => {
    res.json(
        svc.restaurantOut(
            await svc.getRestaurant(id(req))
        )
    );
});

admin.patch('/restaurants/:id', async (req, res) => {
    res.json(
        svc.restaurantOut(
            await svc.updateRestaurant(
                id(req),
                req.body
            )
        )
    );
});

admin.post('/restaurants/:id/password', async (req, res) => {
    await svc.resetOwnerPassword(
        id(req),
        req.body.password
    );

    res.status(204).end();
});

admin.post('/restaurants/:id/reset-password', async (req, res) => {
    const restaurant = await svc.getRestaurant(id(req));
    const password = svc.generatePassword();

    await svc.resetOwnerPassword(
        restaurant.id,
        password
    );

    res.json({
        mobile: restaurant.mobile,
        email: restaurant.email,
        password
    });
});

admin.post('/restaurants/:id/reveal-password', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    res.json({
        password: await svc.revealOwnerPassword(id(req))
    });
});

admin.delete('/restaurants/:id', async (req, res) => {
    await svc.deleteRestaurant(id(req));

    res.status(204).end();
});

// ======================================================
// CUSTOM HTML MENU SYSTEM
// ======================================================

const CUSTOM_MENU_MAX_SIZE = 1024 * 1024;

// GET CUSTOM MENU STATUS

admin.get('/restaurants/:id/custom-menu', async (req, res) => {
    const restaurant = await svc.getRestaurant(id(req));

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    res.json({
        exists: !!restaurant.custom_menu_html,
        enabled: restaurant.custom_menu_enabled === true,
        updated_at: restaurant.custom_menu_updated_at || null,
        html: restaurant.custom_menu_html || ''
    });
});

// UPLOAD HTML AND SYNCHRONIZE DATABASE

admin.put('/restaurants/:id/custom-menu', async (req, res) => {
    const restaurant = await svc.getRestaurant(id(req));
    const html = req.body?.html;

    if (typeof html !== 'string' || !html.trim()) {
        throw new HttpError(400, 'HTML file is required.');
    }

    if (Buffer.byteLength(html, 'utf8') > CUSTOM_MENU_MAX_SIZE) {
        throw new HttpError(
            413,
            'HTML file must be smaller than 1 MB.'
        );
    }

    if (
        !/<html[\s>]/i.test(html) ||
        !/<\/html>/i.test(html)
    ) {
        throw new HttpError(400, 'Invalid HTML document.');
    }

    let menuData;

    try {
        menuData = extractMenuData(html);
    } catch (error) {
        throw new HttpError(
            400,
            error.message || 'Could not read menu data from HTML.'
        );
    }

    if (
        !menuData ||
        !Array.isArray(menuData.categories) ||
        menuData.categories.length === 0
    ) {
        throw new HttpError(
            400,
            'No menu categories or items were found in the uploaded HTML.'
        );
    }

    const totalItems = menuData.categories.reduce(
        (total, category) =>
            total + (Array.isArray(category.items) ? category.items.length : 0),
        0
    );

    if (totalItems === 0) {
        throw new HttpError(
            400,
            'The uploaded HTML does not contain any menu items.'
        );
    }

    let sync;

    try {
        sync = await synchronizeMenu(
            restaurant.id,
            menuData
        );
    } catch (error) {
        console.error(
            'Custom menu synchronization failed:',
            error
        );

        if (error.status && error.status < 500) {
            throw new HttpError(error.status, error.message);
        }

        throw error;
    }

    // Activate the uploaded custom design immediately.
    // This makes the uploaded HTML replace the default menu page.
    await cols.restaurants.updateOne(
        { _id: restaurant.id },
        {
            $set: {
                custom_menu_html: html,
                custom_menu_enabled: true,
                custom_menu_updated_at: new Date()
            }
        }
    );

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    res.json({
        success: true,
        message: 'Custom menu uploaded, activated and database synchronized.',
        enabled: true,
        synchronization: {
            ...sync,
            uploaded_categories: menuData.categories.length,
            uploaded_items: totalItems
        }
    });
});

// ACTIVATE OR DEACTIVATE CUSTOM MENU

admin.patch('/restaurants/:id/custom-menu', async (req, res) => {
    const restaurant = await svc.getRestaurant(id(req));

    const enabled =
        req.body?.enabled === true ||
        req.body?.enabled === 'true' ||
        req.body?.enabled === 1;

    if (enabled && !restaurant.custom_menu_html) {
        throw new HttpError(
            400,
            'Upload a custom menu first.'
        );
    }

    await cols.restaurants.updateOne(
        { _id: restaurant.id },
        {
            $set: {
                custom_menu_enabled: enabled,
                custom_menu_updated_at: new Date()
            }
        }
    );

    res.set('Cache-Control', 'no-store');

    res.json({
        success: true,
        enabled
    });
});

// RESTORE DEFAULT MENU

admin.delete('/restaurants/:id/custom-menu', async (req, res) => {
    const restaurant = await svc.getRestaurant(id(req));

    await cols.restaurants.updateOne(
        { _id: restaurant.id },
        {
            $unset: {
                custom_menu_html: '',
                custom_menu_enabled: '',
                custom_menu_updated_at: ''
            }
        }
    );

    res.json({
        success: true,
        message: 'Default menu restored.',
        enabled: false
    });
});

// ======================================================
// ADMIN ORDERS
// ======================================================

admin.get('/restaurants/:id/orders', async (req, res) => {
    const restaurant = await svc.getRestaurant(id(req));

    const orders = await cols.orders
        .find({ restaurant_id: restaurant.id })
        .sort({ created_at: -1 })
        .limit(500)
        .toArray();

    res.json({
        orders: orders.map(order => ({
            ...order,
            id: String(order._id),
            _id: undefined
        }))
    });
});

// ADMIN RESTAURANT MENU ROUTES

const adminLibrary = express.Router({ mergeParams: true });

adminLibrary.use(async (req, res, next) => {
    await svc.getRestaurant(Number(req.params.id));
    next();
});

libraryRoutes(adminLibrary, req => Number(req.params.id));
admin.use('/restaurants/:id', adminLibrary);

const adminMenu = express.Router({ mergeParams: true });

adminMenu.use(async (req, res, next) => {
    await svc.getRestaurant(Number(req.params.id));
    next();
});

menuRoutes(adminMenu, req => Number(req.params.id));

admin.use('/restaurants/:id', adminMenu);

// MOUNT ADMIN ROUTER

router.use('/admin', admin);

// ======================================================
// RESTAURANT OWNER
// ======================================================

const owner = express.Router();

owner.use(auth('owner'));

// ======================================================
// LIVE ORDER EVENTS
// ======================================================

owner.get('/orders/events', (req, res) =>
    streamEvents(
        req,
        res,
        listener => subscribeRestaurant(rid(req), listener),
        'new-order'
    )
);

// ======================================================
// RESTAURANT PROFILE
// ======================================================

owner.get('/restaurant', async (req, res) => {
    res.json(
        svc.restaurantOut(
            await svc.getRestaurant(rid(req))
        )
    );
});

owner.patch('/restaurant', async (req, res) => {
    res.json(
        svc.restaurantOut(
            await svc.updateProfile(
                rid(req),
                req.body
            )
        )
    );
});

// ======================================================
// OWNER CATEGORY AND ITEM ROUTES
// ======================================================

libraryRoutes(owner, rid);
menuRoutes(owner, rid);

// ======================================================
// GET ORDERS
// ======================================================

owner.get('/orders', async (req, res) => {
    const orders = await cols.orders
        .find({
            restaurant_id: rid(req)
        })
        .sort({
            created_at: -1
        })
        .limit(500)
        .toArray();

    res.json({
        orders: orders.map(order => ({
            ...order,
            id: String(order._id),
            _id: undefined
        }))
    });
});

// ======================================================
// UPDATE ORDER STATUS
// ======================================================

owner.patch('/orders/:orderId/status', async (req, res) => {
    const allowed = new Set([
        'Pending',
        'Accepted',
        'Preparing',
        'Ready',
        'Completed',
        'Rejected',
        'Cancelled'
    ]);

    const status = cleanText(req.body.status, 30);

    if (!allowed.has(status)) {
        throw new HttpError(400, 'Invalid order status');
    }

    let orderId;

    try {
        orderId = new ObjectId(req.params.orderId);
    } catch {
        throw new HttpError(400, 'Invalid order ID');
    }

    const updatedAt = new Date();

    const result = await cols.orders.updateOne(
        {
            _id: orderId,
            restaurant_id: rid(req)
        },
        {
            $set: {
                status,
                updated_at: updatedAt
            }
        }
    );

    if (!result.matchedCount) {
        throw new HttpError(404, 'Order not found');
    }

    publishOrderStatus(orderId, {
        id: String(orderId),
        status,
        updated_at: updatedAt
    });

    res.json({
        success: true,
        status,
        updated_at: updatedAt
    });
});

// ======================================================
// QR CODE
// ======================================================

owner.get('/qr.png', async (req, res) => {
    const restaurant = await svc.getRestaurant(rid(req));

    res.type('png').set(
        'Content-Disposition',
        req.query.download
            ? `attachment; filename="${restaurant.slug}-menu-qr.png"`
            : 'inline'
    );

    const requestedLevel = String(
        req.query.level || 'M'
    ).toUpperCase();

    const level = ['L', 'M', 'Q', 'H'].includes(requestedLevel)
        ? requestedLevel
        : 'M';

    res.send(
        await QRCode.toBuffer(
            `${BASE_URL}/m/${restaurant.slug}`,
            {
                width: Math.min(
                    Math.max(Number(req.query.size) || 800, 128),
                    2048
                ),
                margin: 4,
                errorCorrectionLevel: level
            }
        )
    );
});

// ======================================================
// REGISTER OWNER ROUTES
// ======================================================

router.use('/', owner);

// ======================================================
// 404
// ======================================================

router.use((req, res) => {
    res.status(404).json({
        error: 'Not found'
    });
});

module.exports = router;