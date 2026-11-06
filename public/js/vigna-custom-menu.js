(() => {
    'use strict';

    /* =========================================================
       VIGNADIGITAL CUSTOMER MENU
       ========================================================= */

    const API = '/api/v1';

    const slug = decodeURIComponent(
        location.pathname.split('/').filter(Boolean).pop() || ''
    );

    if (!slug) return;

    const $ = (selector, parent = document) =>
        parent.querySelector(selector);

    const $$ = (selector, parent = document) =>
        [...parent.querySelectorAll(selector)];

    const money = value =>
        '₹' + Number(value || 0).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

    const escapeHTML = value =>
        String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);

    const normalize = value =>
        String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');

    const cart = new Map();

    let menuData = null;
    let currentOrderEventSource = null;
    let orderingTimer = null;
    let menuRefreshTimer = null;
    let lastOrderingState = null;
    let orderingCheckRunning = false;
    let menuRefreshRunning = false;
    let currentCheckout = null;
    let previousBodyOverflow = null;
    let initialized = false;

    let categoryObserver = null;
    let categoryLockUntil = 0;

    /* =========================================================
       MENU DATA HELPERS
       ========================================================= */

    function getRestaurant() {
        return menuData?.restaurant ||
            menuData?.data?.restaurant ||
            {};
    }

    function getCategories() {
        return Array.isArray(menuData?.categories)
            ? menuData.categories
            : [];
    }

    function getItems() {
        return getCategories().flatMap(category =>
            Array.isArray(category.items) ? category.items : []
        );
    }

    function getItemId(item) {
        return String(
            item.id ??
            item._id ??
            item.item_id ??
            item.name ??
            ''
        );
    }

    function getItemName(item) {
        return item.name ||
            item.item_name ||
            item.title ||
            'Menu Item';
    }

    function getItemPrice(item) {
        return Number(
            item.price ??
            item.selling_price ??
            item.amount ??
            0
        );
    }

    function getItemImage(item) {
        const image = item.image_url ||
            item.image ||
            item.photo ||
            item.imageUrl ||
            '';

        if (!image || /^(data:|https?:|blob:|\/)/i.test(String(image))) {
            return image;
        }

        return `/${String(image).replace(/^\.?\//, '')}`;
    }

    function isItemAvailable(item) {
        const status = String(item.status || '').trim().toLowerCase();

        return !(
            item.available === false ||
            item.is_available === false ||
            item.availability === false ||
            ['unavailable', 'out_of_stock', 'sold_out'].includes(status)
        );
    }

    function isFalse(value) {
        return value === false ||
            value === 0 ||
            value === '0' ||
            value === 'false' ||
            value === 'off' ||
            value === 'disabled' ||
            value === 'no';
    }

    function orderingEnabled() {
        const restaurant = getRestaurant();

        const value =
            restaurant.order_enabled ??
            restaurant.ordering_enabled ??
            restaurant.orderingEnabled ??
            restaurant.orderEnabled;

        return !isFalse(value);
    }

    /* =========================================================
       CART CALCULATIONS
       ========================================================= */

    function cartCount() {
        return [...cart.values()].reduce(
            (sum, item) => sum + item.qty,
            0
        );
    }

    function subtotal() {
        const paise = [...cart.values()].reduce(
            (sum, item) => sum + Math.round(
                (Number(item.price || 0) * item.qty + Number.EPSILON) * 100
            ),
            0
        );

        return paise / 100;
    }

    function taxAmount() {
        return Math.round((subtotal() * 0.05 + Number.EPSILON) * 100) / 100;
    }

    function payableTotal() {
        return Math.round((subtotal() + taxAmount() + Number.EPSILON) * 100) / 100;
    }

    /* =========================================================
       API REQUEST
       ========================================================= */

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            cache: 'no-store',
            headers: {
                Accept: 'application/json',
                ...(options.body
                    ? { 'Content-Type': 'application/json' }
                    : {}),
                ...options.headers
            }
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || result.success === false) {
            throw new Error(
                result.message ||
                result.error ||
                'Something went wrong. Please try again.'
            );
        }

        return result;
    }

    /* =========================================================
       INITIAL MENU LOAD
       ========================================================= */

    async function loadMenu() {
        const data = await apiRequest(
            `${API}/public/menu/${encodeURIComponent(slug)}?include_unavailable=1&_=${Date.now()}`
        );

        const payload = data?.data?.restaurant
            ? data.data
            : data;

        if (
            !payload ||
            !payload.restaurant ||
            !Array.isArray(payload.categories)
        ) {
            throw new Error('Invalid menu response from server.');
        }

        menuData = payload;

        const restaurant = getRestaurant();

        document.title = `${restaurant.name || 'Menu'} · Menu`;

        const themeColor =
            /^#[0-9a-fA-F]{6}$/.test(
                String(
                    restaurant.theme_color ||
                    data.theme_color ||
                    ''
                )
            )
                ? (
                    restaurant.theme_color ||
                    data.theme_color
                )
                : '#d9480f';

        applyRestaurantTheme(themeColor);

        window.VIGNA_THEME = themeColor;

        const themeMeta = document.querySelector('#themeMeta');

        if (themeMeta) {
            themeMeta.setAttribute('content', themeColor);
        }

        renderMenu();

        lastOrderingState = orderingEnabled();
    }

    /* ==========================================
       RESTAURANT DYNAMIC THEME SYSTEM
    ========================================== */

    function applyRestaurantTheme(color) {

        const validColor = /^#[0-9a-fA-F]{6}$/.test(color || '')
            ? color
            : '#d9480f';

        const hex = validColor.replace('#', '');

        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        const rgb = `${r}, ${g}, ${b}`;

        const luminance =
            (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

        const textColor =
            luminance > 0.62 ? '#211711' : '#ffffff';

        const root = document.documentElement;

        root.style.setProperty('--theme', validColor);

        root.style.setProperty(
            '--theme-dark',
            `color-mix(in srgb, ${validColor} 78%, #000000)`
        );

        root.style.setProperty(
            '--theme-light',
            `color-mix(in srgb, ${validColor} 14%, #ffffff)`
        );

        root.style.setProperty(
            '--theme-soft',
            `color-mix(in srgb, ${validColor} 8%, #ffffff)`
        );

        root.style.setProperty(
            '--theme-border',
            `color-mix(in srgb, ${validColor} 35%, #777777)`
        );

        root.style.setProperty('--theme-text', textColor);
        root.style.setProperty('--theme-rgb', rgb);

        const meta = document.querySelector('#themeMeta');

        if (meta) {
            meta.content = validColor;
        }
    }

    /* =========================================================
       MENU HEADER
       ========================================================= */

    function renderHeader() {
        const restaurant = getRestaurant();

        const app = $('#app');

        if (!app) return;

        const existingHeader = $('.m-hero', app);

        if (existingHeader) {
            existingHeader.innerHTML = `
                ${restaurant.logo
                    ? `<img src="${escapeHTML(restaurant.logo)}"
                            alt="${escapeHTML(restaurant.name || 'Restaurant')}">`
                    : ''
                }

                <h1>${escapeHTML(restaurant.name || 'Menu')}</h1>

                ${restaurant.tagline
                    ? `<p>${escapeHTML(restaurant.tagline)}</p>`
                    : ''
                }

                ${restaurant.city
                    ? `<div class="small">${escapeHTML(restaurant.city)}</div>`
                    : ''
                }
            `;
        }
    }

    /* =========================================================
       MENU ITEM CARD
       ========================================================= */

    function renderItemCard(item) {
        const id = getItemId(item);
        const name = getItemName(item);
        const price = getItemPrice(item);
        const image = getItemImage(item);

        const available = isItemAvailable(item);
        const enabled = orderingEnabled();
        const cartItem = cart.get(id);

        return `
        <article
            class="m-card order-card premium-food-card"
            data-item="${escapeHTML(id)}"
        >

            <div class="food-image-wrap">

                ${image ? `
                    <img
                        class="food-image"
                        src="${escapeHTML(image)}"
                        alt="${escapeHTML(name)}"
                        loading="lazy"
                        decoding="async"
                        onerror="
                            this.style.display='none';
                            this.parentElement.classList.add('image-error');
                        "
                    >
                ` : `
                    <div class="food-image-placeholder">
                        🍽️
                    </div>
                `}

                <span class="food-image-overlay"></span>

                ${!available ? `
                    <span class="food-unavailable-badge">
                        Currently unavailable
                    </span>
                ` : `
                    <span class="food-available-badge">
                        ● Available
                    </span>
                `}

            </div>

            <div class="b food-card-content">

                <div class="food-card-heading">

                    <div class="nm food-name">
                        ${escapeHTML(name)}
                    </div>

                </div>

                ${item.description ? `
                    <div class="ds food-description">
                        ${escapeHTML(item.description)}
                    </div>
                ` : `
                    <div class="ds food-description">
                        Freshly prepared for you.
                    </div>
                `}

                <div class="food-card-bottom">

                    <div class="pr food-price">
                        ${money(price)}
                    </div>

                    ${available && enabled ? `
                        <div class="menu-card-actions">

                            ${cartItem
                    ? `
                                <div class="menu-qty-control" aria-label="Quantity controls for ${escapeHTML(name)}">
                                    <button type="button" data-cart-dec="${escapeHTML(id)}" aria-label="Decrease ${escapeHTML(name)} quantity">−</button>
                                    <strong aria-live="polite">${cartItem.qty}</strong>
                                    <button type="button" data-cart-inc="${escapeHTML(id)}" aria-label="Increase ${escapeHTML(name)} quantity">+</button>
                                </div>
                            `
                    : `
                                <button
                                    class="order-add"
                                    type="button"
                                    data-add="${escapeHTML(id)}"
                                >
                                    + Add
                                </button>
                            `
                }

                            <button
                                class="order-now-btn"
                                type="button"
                                data-order-now="${escapeHTML(id)}"
                            >
                                Order Now
                            </button>

                        </div>
                    ` : ''}

                </div>

            </div>

        </article>
    `;
    }
    /* =========================================================
       END OF PART 1
       ========================================================= */
    /* =========================================================
   MAIN MENU RENDERING
   ========================================================= */

    function renderMenu(searchQuery = '') {
        const app = $('#app');

        if (!app || !menuData) return;

        const restaurant = getRestaurant();
        const categories = getCategories();

        const query = normalize(searchQuery);
        const heroImage = getItems()
            .map(getItemImage)
            .find(image => Boolean(image)) || '';

        const filteredCategories = categories
            .map(category => ({
                ...category,

                items: (category.items || []).filter(item => {
                    const name = normalize(getItemName(item));
                    const description = normalize(item.description);

                    return !query ||
                        name.includes(query) ||
                        description.includes(query);
                })
            }))
            .filter(category => category.items.length);

        const restaurantName = restaurant.name || 'Restaurant Menu';

        app.innerHTML = `

            <!-- RESTAURANT HERO -->

            <header class="m-hero">

                <div class="hero-background"></div>

                <div class="hero-content">

                    <div class="hero-logo">

                        ${restaurant.logo
                ? `
                                    <img
                                        src="${escapeHTML(restaurant.logo)}"
                                        alt="${escapeHTML(restaurantName)}"
                                    >
                                `
                : `<span class="hero-logo-placeholder">🍽</span>`
            }

                    </div>

                    <div class="hero-brand">

                        <div class="hero-eyebrow">
                            FRESH · AUTHENTIC · DELICIOUS
                        </div>

                        <h1>
                            ${escapeHTML(restaurantName)}
                        </h1>

                        <p>
                            ${escapeHTML(
                restaurant.tagline ||
                'Multi Cuisine Restaurant'
            )}
                        </p>

                        <div class="hero-location">
                            ${restaurant.city || restaurant.address
                ? escapeHTML(restaurant.city || restaurant.address)
                : 'Dine In · Takeaway · Delivery'
            }
                        </div>

                    </div>

                    <div class="hero-food-decoration">
                        ${heroImage
                ? `<img src="${escapeHTML(heroImage)}" alt="" loading="eager" onerror="this.style.display='none'">`
                : '🍛'
            }
                    </div>

                </div>

            </header>


            <!-- SEARCH AND VIEW CONTROLS -->

            <section class="menu-toolbar">

                <div class="search-wrapper">

                    <span class="search-icon">⌕</span>

                    <input
                        type="search"
                        id="q"
                        placeholder="Search dishes, e.g., Biryani, Paneer, Chicken..."
                        value="${escapeHTML(searchQuery)}"
                        autocomplete="off"
                    >

                    <button
                        type="button"
                        id="clearSearch"
                        aria-label="Clear search"
                    >
                        ×
                    </button>

                </div>

                <div class="view-switch">

                    <button
                        type="button"
                        class="view-btn active"
                        data-view="grid"
                        aria-label="Grid view"
                    >
                        ▦
                    </button>

                    <button
                        type="button"
                        class="view-btn"
                        data-view="list"
                        aria-label="List view"
                    >
                        ☰
                    </button>

                </div>

            </section>

            ${orderingEnabled() ? '' : `
                <div class="ordering-unavailable" role="status">
                    Online ordering is currently unavailable. Please contact the restaurant.
                </div>
            `}


            <!-- CATEGORY NAVIGATION -->

            <nav class="category-navigation" id="categoryNavigation">

                ${categories.map((category, index) => `

                    <button
                        type="button"
                        class="category-pill ${index === 0 ? 'active' : ''}"
                        data-category="${escapeHTML(category.name)}"
                    >

                        <span class="category-icon">
                            ${getCategoryIcon(category.name)}
                        </span>

                        <span>
                            ${escapeHTML(category.name)}
                        </span>

                    </button>

                `).join('')}

            </nav>


            <!-- MENU CONTENT -->

            <main class="menu-content" id="menuContent">

                ${filteredCategories.length
                ? filteredCategories.map(category => `

                            <section
                                class="menu-category"
                                id="category-${escapeHTML(
                    normalize(category.name)
                )}"
                            >

                                <div class="category-heading">

                                    <div class="category-heading-left">

                                        <span class="category-accent"></span>

                                        <div>

                                            <h2>
                                                ${escapeHTML(category.name)}
                                            </h2>

                                            <span class="category-count">
                                                ${category.items.length} items
                                            </span>

                                        </div>

                                    </div>

                                    <button
                                        type="button"
                                        class="view-all-btn"
                                        data-view-all="${escapeHTML(category.name)}"
                                    >
                                        View All →
                                    </button>

                                </div>


                                <div class="m-grid">

                                    ${category.items.map(renderItemCard).join('')}

                                </div>

                            </section>

                        `).join('')

                : `
                            <div class="empty-menu">

                                <div class="empty-icon">🍽️</div>

                                <h2>No dishes found</h2>

                                <p>
                                    Try searching with another dish name.
                                </p>

                            </div>
                        `
            }

            </main>

        `;

        renderCartBar();

        applyCurrentView();

        setupCategoryNavigation();
    }


    /* =========================================================
       CATEGORY ICONS
       ========================================================= */

    function getCategoryIcon(name = '') {

        const value = String(name).toLowerCase();

        const icons = [
            ['starter indian', '🍽️'],
            ['starter chinese', '🥢'],
            ['starter', '🍟'],
            ['chinese', '🥡'],
            ['biryani', '🍛'],
            ['rice', '🍚'],
            ['noodle', '🍜'],
            ['grill', '🔥'],
            ['roll', '🌯'],
            ['paratha', '🫓'],
            ['bread', '🥖'],
            ['soup', '🍲'],
            ['dessert', '🍰'],
            ['sweet', '🍮'],
            ['beverage', '🥤'],
            ['juice', '🧃'],
            ['drink', '🥤'],
            ['pizza', '🍕'],
            ['burger', '🍔'],
            ['sandwich', '🥪'],
            ['salad', '🥗'],
            ['paneer', '🧀'],
            ['chicken', '🍗'],
            ['seafood', '🍤'],
            ['fish', '🐟'],
            ['egg', '🥚'],
            ['veg', '🥦']
        ];

        for (const [keyword, icon] of icons) {
            if (value.includes(keyword)) {
                return icon;
            }
        }

        return '🍴';
    }


    /* =========================================================
       SEARCH
       ========================================================= */

    let searchTimer = null;

    function setupSearch() {

        document.addEventListener('input', event => {

            if (event.target.id !== 'q') return;

            clearTimeout(searchTimer);

            const value = event.target.value;
            const selectionStart = event.target.selectionStart;
            const selectionEnd = event.target.selectionEnd;

            searchTimer = setTimeout(() => {
                renderMenu(value);

                const input = $('#q');

                if (input) {
                    input.focus({ preventScroll: true });

                    if (selectionStart !== null && selectionEnd !== null) {
                        input.setSelectionRange(selectionStart, selectionEnd);
                    }
                }
            }, 180);

        });

        document.addEventListener('click', event => {

            if (event.target.closest('#clearSearch')) {

                renderMenu('');
                $('#q')?.focus({ preventScroll: true });

            }

        });

    }


    /* =========================================================
       GRID / LIST VIEW
       ========================================================= */

    let currentView = 'grid';

    function applyCurrentView() {

        const grids = $$('.m-grid');

        grids.forEach(grid => {

            grid.classList.toggle(
                'list-view',
                currentView === 'list'
            );

        });

        $$('[data-view]').forEach(button => {

            button.classList.toggle(
                'active',
                button.dataset.view === currentView
            );

        });

    }


    function setupViewSwitch() {

        document.addEventListener('click', event => {

            const button = event.target.closest('[data-view]');

            if (!button) return;

            currentView = button.dataset.view;

            applyCurrentView();

        });

    }


    /* =========================================================
       CATEGORY NAVIGATION
       ========================================================= */

    function setupCategoryNavigation() {

        const navigation = $('#categoryNavigation');

        if (!navigation) return;

        $$('.category-pill', navigation).forEach(button => {

            button.addEventListener('click', () => {

                const categoryName = button.dataset.category;

                const target = $(
                    `#category-${CSS.escape(normalize(categoryName))}`
                );

                if (!target) return;

                $$('.category-pill', navigation).forEach(pill => {
                    pill.classList.remove('active');
                });

                button.classList.add('active');

                categoryLockUntil = Date.now() + 1200;

                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });

            });

        });


        $$('.view-all-btn').forEach(button => {

            button.addEventListener('click', () => {

                const categoryName = button.dataset.viewAll;

                const target = $(
                    `#category-${CSS.escape(normalize(categoryName))}`
                );

                target?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });

            });

        });


        observeActiveCategory();

    }


    /* =========================================================
       ACTIVE CATEGORY ON SCROLL
       ========================================================= */

    function observeActiveCategory() {

        categoryObserver?.disconnect();

        const sections = $$('.menu-category');

        const navigation = $('#categoryNavigation');

        if (!sections.length || !navigation) return;

        categoryObserver = new IntersectionObserver(entries => {

            if (Date.now() < categoryLockUntil) return;

            const visible = entries
                .filter(entry => entry.isIntersecting)
                .sort((a, b) =>
                    b.intersectionRatio - a.intersectionRatio
                );

            if (!visible.length) return;

            const activeId = visible[0].target.id;

            const activeName = activeId.replace('category-', '');

            $$('.category-pill', navigation).forEach(button => {

                const buttonName = normalize(button.dataset.category);

                button.classList.toggle(
                    'active',
                    buttonName === activeName
                );

            });

        }, {
            rootMargin: '-20% 0px -65% 0px',
            threshold: [0, 0.2, 0.5]
        });

        sections.forEach(section => {
            categoryObserver.observe(section);
        });

    }


    /* =========================================================
       END OF PART 2
       ========================================================= */
    /* =========================================================
   PREMIUM MENU CSS
   ========================================================= */

    function addStyles() {

        if ($('#vigna-premium-menu-styles')) return;

        const style = document.createElement('style');

        style.id = 'vigna-premium-menu-styles';

        style.textContent = `

        /* =========================================
           ROOT THEME
        ========================================= */

        :root {
            --theme: #f06423;
            --theme-dark: #bd4314;
            --theme-light: #ffb17e;
            --theme-soft: rgba(240,100,35,.12);
            --theme-rgb: 240,100,35;

            --bg: #101010;
            --surface: #191919;
            --surface-2: #222222;
            --border: rgba(255,255,255,.09);

            --text: #f7f4f0;
            --muted: #aaa39c;

            --radius: 18px;
        }

        * {
            box-sizing: border-box;
        }

        html {
            scroll-behavior: smooth;
            scroll-padding-top: 100px;
        }

        body {
            margin: 0;
            background: var(--bg);
            color: var(--text);
            font-family:
                Inter,
                system-ui,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
        }

        button,
        input {
            font: inherit;
        }

        button {
            cursor: pointer;
        }

        #app {
            width: min(1440px, 100%);
            margin: auto;
            padding: 20px 34px 120px;
        }


        /* =========================================
           RESTAURANT HERO
        ========================================= */

        .m-hero {
            position: relative;
            overflow: hidden;
            min-height: 220px;
            padding: 34px;
            border-radius: 26px;
            background:
                radial-gradient(
                    circle at 90% 20%,
                    rgba(var(--theme-rgb),.28),
                    transparent 35%
                ),
                linear-gradient(
                    115deg,
                    #211b17,
                    #171310 60%,
                    #26180f
                );
            border: 1px solid rgba(255,255,255,.08);
            margin-bottom: 25px;
        }

        .hero-background {
            position: absolute;
            inset: 0;
            pointer-events: none;
            background:
                linear-gradient(
                    90deg,
                    rgba(0,0,0,.15),
                    transparent
                );
        }

        .hero-content {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 24px;
        }

        .hero-logo {
            width: 100px;
            height: 100px;
            flex-shrink: 0;
            border-radius: 23px;
            background: #fff;
            display: grid;
            place-items: center;
            overflow: hidden;
            box-shadow: 0 10px 35px rgba(0,0,0,.3);
        }

        .hero-logo img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            padding: 8px;
        }

        .hero-logo-placeholder {
            font-size: 45px;
        }

        .hero-brand {
            min-width: 0;
        }

        .hero-eyebrow {
            color: var(--theme-light);
            font-size: 10px;
            letter-spacing: 3px;
            font-weight: 800;
            margin-bottom: 9px;
        }

        .hero-brand h1 {
            margin: 0;
            font-size: clamp(26px, 4vw, 43px);
            line-height: 1.12;
            font-weight: 850;
            letter-spacing: -.9px;
            color: #fff;
        }

        .hero-brand p {
            margin: 9px 0;
            color: #d4c7bc;
            font-size: 14px;
        }

        .hero-location {
            color: var(--theme-light);
            font-size: 12px;
            margin-top: 13px;
        }

        .hero-food-decoration {
            margin-left: auto;
            font-size: clamp(65px, 10vw, 120px);
            opacity: .85;
            filter: drop-shadow(0 12px 20px rgba(0,0,0,.4));
            transform: rotate(-12deg);
        }


        /* =========================================
           SEARCH TOOLBAR
        ========================================= */

        .menu-toolbar {
            display: flex;
            gap: 12px;
            margin: 24px 0;
        }

        .search-wrapper {
            display: flex;
            align-items: center;
            gap: 12px;
            flex: 1;
            min-width: 0;
            height: 54px;
            padding: 0 17px;
            border-radius: 15px;
            background: var(--surface);
            border: 1px solid var(--border);
            transition: border-color .2s, box-shadow .2s;
        }

        .search-wrapper:focus-within {
            border-color: var(--theme);
            box-shadow: 0 0 0 3px var(--theme-soft);
        }

        .search-icon {
            font-size: 27px;
            color: var(--theme-light);
        }

        .search-wrapper input {
            flex: 1;
            width: 100%;
            min-width: 0;
            border: 0;
            outline: 0;
            background: transparent;
            color: white;
            font-size: 14px;
        }

        .search-wrapper input::placeholder {
            color: #827d77;
        }

        #clearSearch {
            border: 0;
            background: transparent;
            color: #aaa;
            font-size: 24px;
        }

        .view-switch {
            display: flex;
            gap: 5px;
            align-items: center;
            padding: 5px;
            border-radius: 14px;
            background: var(--surface);
            border: 1px solid var(--border);
        }

        .view-btn {
            width: 40px;
            height: 40px;
            border: 0;
            border-radius: 10px;
            color: #aaa;
            background: transparent;
            font-size: 20px;
        }

        .view-btn.active {
            background: var(--theme);
            color: white;
        }


        /* =========================================
           CATEGORY PILLS
        ========================================= */

        .category-navigation {
            display: flex;
            align-items: center;
            gap: 11px;
            overflow-x: auto;
            padding: 5px 1px 16px;
            margin-bottom: 23px;
            scrollbar-width: none;
            position: sticky;
            top: 0;
            z-index: 20;
            background: rgba(16,16,16,.94);
            backdrop-filter: blur(15px);
        }

        .category-navigation::-webkit-scrollbar {
            display: none;
        }

        .category-pill {
            display: inline-flex;
            flex-shrink: 0;
            align-items: center;
            gap: 9px;
            padding: 11px 17px;
            border: 1px solid var(--border);
            border-radius: 30px;
            background: var(--surface);
            color: #c6c0ba;
            font-size: 13px;
            font-weight: 650;
            white-space: nowrap;
            transition: .2s ease;
        }

        .category-pill:hover {
            border-color: var(--theme);
            color: white;
        }

        .category-pill.active {
            background: var(--theme);
            border-color: var(--theme);
            color: white;
            box-shadow: 0 5px 18px rgba(var(--theme-rgb),.28);
        }

        .category-icon {
            font-size: 17px;
        }


        /* =========================================
           CATEGORY HEADINGS
        ========================================= */

        .menu-category {
            margin-bottom: 45px;
            scroll-margin-top: 100px;
        }

        .category-heading {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 15px;
            margin-bottom: 20px;
        }

        .category-heading-left {
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .category-accent {
            width: 5px;
            height: 43px;
            border-radius: 10px;
            background: var(--theme);
            box-shadow: 0 0 15px rgba(var(--theme-rgb),.4);
        }

        .category-heading h2 {
            margin: 0;
            font-size: 23px;
            font-weight: 800;
            color: white;
        }

        .category-count {
            display: block;
            margin-top: 5px;
            font-size: 12px;
            color: var(--muted);
        }

        .view-all-btn {
            border: 0;
            background: transparent;
            color: var(--theme-light);
            font-size: 13px;
            font-weight: 700;
        }


        /* =========================================
           FOOD CARD GRID
        ========================================= */

        .m-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 19px;
        }

        .m-card {
            position: relative;
            overflow: hidden;
            min-width: 0;
            border-radius: 19px;
            background: var(--surface);
            border: 1px solid var(--border);
            transition:
                transform .25s ease,
                border-color .25s ease,
                box-shadow .25s ease;
        }

        .m-card:hover {
            transform: translateY(-5px);
            border-color: rgba(var(--theme-rgb),.55);
            box-shadow: 0 14px 30px rgba(0,0,0,.25);
        }

        .thumb {
            position: relative;
            height: 185px;
            overflow: hidden;
            background: #28231f;
        }

        .thumb img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform .4s ease;
        }

        .m-card:hover .thumb img {
            transform: scale(1.06);
        }

        .thumb-fallback {
            display: none;
            position: absolute;
            inset: 0;
            place-items: center;
            color: #92877d;
            font-size: 12px;
            background:
                radial-gradient(
                    circle,
                    #39302a,
                    #211c18
                );
        }

        .thumb.image-error .thumb-fallback {
            display: grid;
        }

        .m-card .b {
            padding: 17px;
        }

        .m-card .nm {
            color: #fff;
            font-size: 16px;
            line-height: 1.4;
            font-weight: 750;
            min-height: 23px;
        }

        .m-card .ds {
            margin-top: 7px;
            color: #a9a19a;
            font-size: 12px;
            line-height: 1.6;
            min-height: 36px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .m-card .pr {
            margin: 13px 0;
            font-size: 19px;
            color: var(--theme-light);
            font-weight: 850;
        }


        /* =========================================
           ADD / ORDER BUTTONS
        ========================================= */

        .menu-card-actions {
            display: grid;
            grid-template-columns: 1fr 1.15fr;
            gap: 9px;
            margin-top: 13px;
        }

        .order-add,
        .order-now-btn {
            min-width: 0;
            min-height: 42px;
            padding: 8px 10px;
            border-radius: 11px;
            font-size: 12px;
            font-weight: 800;
            transition: .2s ease;
        }

        .order-add {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 9px;
            background: var(--theme-soft);
            border: 1px solid var(--theme);
            color: var(--theme-light);
        }

        .order-add:hover {
            background: var(--theme);
            color: white;
        }

        .order-add.has-quantity {
            justify-content: space-around;
            padding: 5px 8px;
        }

        .order-add.has-quantity span {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            font-size: 19px;
            line-height: 1;
            cursor: pointer;
            user-select: none;
        }

        .order-add.has-quantity strong {
            min-width: 15px;
            font-size: 13px;
            text-align: center;
        }

        .order-now-btn {
            border: 1px solid var(--theme);
            background: var(--theme);
            color: white;
        }

        .order-now-btn:hover {
            background: var(--theme-dark);
            transform: translateY(-1px);
        }

        .item-unavailable {
            display: inline-block;
            margin-top: 8px;
            color: #ff7777;
            font-size: 12px;
            font-weight: 700;
        }


        /* =========================================
           LIST VIEW
        ========================================= */

        .m-grid.list-view {
            grid-template-columns: 1fr;
        }

        .m-grid.list-view .m-card {
            display: grid;
            grid-template-columns: 150px minmax(0, 1fr);
        }

        .m-grid.list-view .thumb {
            height: 100%;
            min-height: 160px;
        }

        .m-grid.list-view .m-card .b {
            display: flex;
            flex-direction: column;
            justify-content: center;
        }


        /* =========================================
           EMPTY SEARCH
        ========================================= */

        .empty-menu {
            padding: 75px 20px;
            text-align: center;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 20px;
        }

        .empty-icon {
            font-size: 55px;
            margin-bottom: 15px;
        }

        .empty-menu h2 {
            color: white;
            margin: 0 0 9px;
        }

        .empty-menu p {
            color: var(--muted);
            font-size: 13px;
        }


        /* =========================================
           CART BAR
        ========================================= */

        .cart-bar {
            position: fixed;
            z-index: 1000;
            left: 50%;
            bottom: 20px;
            transform: translateX(-50%);
            width: min(570px, calc(100% - 30px));
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 15px;
            padding: 15px 20px;
            border: 1px solid rgba(255,255,255,.15);
            border-radius: 17px;
            background: var(--theme);
            color: white;
            box-shadow: 0 12px 40px rgba(0,0,0,.4);
            font-weight: 750;
        }

        .cart-bar[hidden] {
            display: none !important;
        }

        .cart-bar span {
            font-size: 13px;
        }

        .cart-bar strong {
            font-size: 14px;
        }


        /* =========================================
           MOBILE RESPONSIVE
        ========================================= */

        @media(max-width: 1100px) {

            .m-grid {
                grid-template-columns: repeat(3, minmax(0, 1fr));
            }

        }

        @media(max-width: 760px) {

            #app {
                padding: 12px 14px 110px;
            }

            .m-hero {
                min-height: 165px;
                padding: 21px;
                border-radius: 20px;
            }

            .hero-content {
                gap: 15px;
            }

            .hero-logo {
                width: 68px;
                height: 68px;
                border-radius: 16px;
            }

            .hero-brand h1 {
                font-size: 23px;
            }

            .hero-brand p {
                font-size: 12px;
            }

            .hero-eyebrow {
                font-size: 8px;
                letter-spacing: 1.5px;
            }

            .hero-food-decoration {
                font-size: 48px;
            }

            .menu-toolbar {
                margin: 18px 0;
            }

            .search-wrapper {
                height: 48px;
                padding: 0 12px;
            }

            .search-wrapper input {
                font-size: 12px;
            }

            .view-btn {
                width: 34px;
                height: 34px;
            }

            .category-pill {
                padding: 9px 13px;
                font-size: 12px;
            }

            .category-heading h2 {
                font-size: 19px;
            }

            .m-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 12px;
            }

            .thumb {
                height: 135px;
            }

            .m-card .b {
                padding: 12px;
            }

            .m-card .nm {
                font-size: 14px;
            }

            .m-card .ds {
                font-size: 11px;
                min-height: 32px;
            }

            .m-card .pr {
                font-size: 17px;
            }

            .menu-card-actions {
                grid-template-columns: 1fr;
                gap: 7px;
            }

            .order-add,
            .order-now-btn {
                min-height: 38px;
                font-size: 11px;
            }

            .m-grid.list-view .m-card {
                grid-template-columns: 105px minmax(0, 1fr);
            }

            .m-grid.list-view .thumb {
                min-height: 145px;
            }

            .cart-bar {
                bottom: 12px;
                padding: 13px 15px;
            }

        }

        @media(max-width: 380px) {

            .hero-food-decoration {
                display: none;
            }

            .hero-brand h1 {
                font-size: 20px;
            }

            .m-grid {
                gap: 9px;
            }

            .thumb {
                height: 115px;
            }

            .m-card .b {
                padding: 10px;
            }

        }
            /* =========================================
   VIGNADIGITAL PREMIUM DARK MENU
========================================= */

#app {
    --menu-bg: #101010;
    --menu-card: #1b1b1b;
    --menu-card-border: #303030;
    --menu-text: #f8f5f0;
    --menu-muted: #aaa39b;
    --menu-orange: var(--theme, #f58220);

    width: 100%;
    min-height: 100vh;
    padding-bottom: 110px;
    background: var(--menu-bg);
    color: var(--menu-text);
    font-family: Inter, Arial, sans-serif;
}

/* RESTAURANT HERO */

#app .m-hero {
    position: relative;
    overflow: hidden;
    padding: 55px 20px 45px;
    text-align: center;
    background:
        radial-gradient(
            ellipse at top,
            color-mix(in srgb, var(--menu-orange) 22%, #171717),
            #101010 72%
        );
    border-bottom: 1px solid #292929;
}

#app .m-hero img {
    width: 82px;
    height: 82px;
    object-fit: contain;
    border-radius: 20px;
    padding: 7px;
    background: #fff;
    margin-bottom: 16px;
    box-shadow: 0 8px 30px #0008;
}

#app .m-hero h1 {
    margin: 0;
    color: #fff;
    font-size: clamp(27px, 5vw, 42px);
    font-weight: 900;
    letter-spacing: -1px;
}

#app .m-hero p {
    margin: 10px 0 0;
    color: #c4bcb4;
    font-size: 14px;
}

#app .m-hero .small {
    margin-top: 9px;
    color: var(--menu-orange);
    font-size: 12px;
}

/* SEARCH AND CATEGORY BAR */

#app .m-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    padding: 15px 18px;
    background: rgba(16, 16, 16, .94);
    border-bottom: 1px solid #292929;
    backdrop-filter: blur(16px);
}

#app .m-search {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 1000px;
    margin: auto;
}

#app #q {
    flex: 1;
    min-width: 0;
    height: 48px;
    padding: 0 17px;
    color: white;
    background: #202020;
    border: 1px solid #363636;
    border-radius: 13px;
    outline: none;
    font-size: 14px;
}

#app #q:focus {
    border-color: var(--menu-orange);
    box-shadow: 0 0 0 3px
        color-mix(in srgb, var(--menu-orange) 16%, transparent);
}

#app #q::placeholder {
    color: #8c8c8c;
}

/* GRID / LIST VIEW BUTTONS */

#app .vigna-view-switch {
    display: flex;
    gap: 5px;
    padding: 4px;
    border-radius: 11px;
    background: #242424;
}

#app .view-toggle {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 7px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #aaa;
    cursor: pointer;
}

#app .view-toggle svg {
    width: 19px;
    height: 19px;
    stroke: currentColor;
    stroke-width: 1.8;
}

#app .view-toggle.active {
    background: var(--menu-orange);
    color: white;
}

/* CATEGORY PILLS */

#app .m-chips {
    display: flex;
    gap: 9px;
    max-width: 1000px;
    margin: 15px auto 0;
    overflow-x: auto;
    scrollbar-width: none;
}

#app .m-chips::-webkit-scrollbar {
    display: none;
}

#app .chip {
    flex: 0 0 auto;
    padding: 10px 17px;
    color: #c8c1b9;
    background: #222;
    border: 1px solid #383838;
    border-radius: 30px;
    font-size: 12px;
    font-weight: 750;
    cursor: pointer;
    transition: .2s ease;
}

#app .chip.on {
    color: white;
    background: var(--menu-orange);
    border-color: var(--menu-orange);
}

/* MENU CONTENT */

#app .m-wrap {
    width: min(1100px, calc(100% - 36px));
    margin: 30px auto;
}

#app .m-sec {
    margin-bottom: 42px;
    scroll-margin-top: 150px;
}

#app .m-sec h2 {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 0 20px;
    color: white;
    font-size: 23px;
    font-weight: 850;
}

#app .m-sec h2 span {
    padding: 5px 10px;
    color: var(--menu-orange);
    background: color-mix(
        in srgb,
        var(--menu-orange) 12%,
        #1b1b1b
    );
    border-radius: 20px;
    font-size: 11px;
}

/* FOOD CARD GRID */

#app .m-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
}

/* FOOD CARD */

#app .premium-food-card {
    min-width: 0;
    overflow: hidden;
    background: var(--menu-card);
    border: 1px solid var(--menu-card-border);
    border-radius: 19px;
    transition:
        transform .22s ease,
        border-color .22s ease,
        box-shadow .22s ease;
}

#app .premium-food-card:hover {
    transform: translateY(-4px);
    border-color: color-mix(
        in srgb,
        var(--menu-orange) 55%,
        #333
    );
    box-shadow: 0 12px 30px #0006;
}

/* FOOD IMAGE */

#app .food-image-wrap {
    position: relative;
    height: 205px;
    overflow: hidden;
    background: #282828;
}

#app .food-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform .45s ease;
}

#app .premium-food-card:hover .food-image {
    transform: scale(1.06);
}

#app .food-image-overlay {
    position: absolute;
    inset: 45% 0 0;
    pointer-events: none;
    background: linear-gradient(
        to bottom,
        transparent,
        rgba(0, 0, 0, .35)
    );
}

#app .food-image-placeholder,
#app .food-image-wrap.image-error {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    color: #777;
    font-size: 40px;
}

#app .food-available-badge,
#app .food-unavailable-badge {
    position: absolute;
    top: 12px;
    left: 12px;
    padding: 6px 10px;
    border-radius: 20px;
    font-size: 10px;
    font-weight: 800;
}

#app .food-available-badge {
    color: #b9f5c9;
    background: #143b25e8;
}

#app .food-unavailable-badge {
    color: white;
    background: #8c2525e8;
}

/* CARD CONTENT */

#app .food-card-content {
    padding: 17px;
}

#app .food-name {
    color: #fff;
    font-size: 17px;
    font-weight: 850;
    line-height: 1.35;
}

#app .food-description {
    min-height: 34px;
    margin-top: 8px;
    color: var(--menu-muted);
    font-size: 12px;
    line-height: 1.55;
}

#app .food-card-bottom {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 15px;
    margin-top: 16px;
}

#app .food-price {
    color: var(--menu-orange);
    font-size: 20px;
    font-weight: 900;
}

/* ADD AND ORDER BUTTONS */

#app .menu-card-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
}

#app .order-add,
#app .order-now-btn {
    min-width: 0;
    min-height: 42px;
    padding: 9px 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 850;
    cursor: pointer;
    transition: .2s ease;
}

#app .order-add {
    color: white;
    background: #292929;
    border: 1px solid #555;
}

#app .order-add:hover {
    border-color: var(--menu-orange);
    color: var(--menu-orange);
}

#app .order-now-btn {
    color: white;
    background: var(--menu-orange);
    border: 1px solid var(--menu-orange);
}

#app .order-now-btn:hover {
    filter: brightness(1.12);
    transform: translateY(-1px);
}

/* LIST VIEW */

#app #sections.as-list .m-grid {
    grid-template-columns: 1fr;
    gap: 12px;
}

#app #sections.as-list .premium-food-card {
    display: grid;
    grid-template-columns: 145px minmax(0, 1fr);
}

#app #sections.as-list .food-image-wrap {
    height: 100%;
    min-height: 155px;
}

#app #sections.as-list .food-card-bottom {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
}

#app #sections.as-list .menu-card-actions {
    min-width: 210px;
}

/* FLOATING CART */

#cartBar {
    position: fixed;
    z-index: 9999;
    right: 50%;
    bottom: max(18px, env(safe-area-inset-bottom));
    transform: translateX(50%);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    width: min(520px, calc(100% - 28px));
    min-height: 64px;
    padding: 13px 20px;
    color: white;
    background: var(--menu-orange);
    border: 0;
    border-radius: 16px;
    box-shadow: 0 12px 35px #0009;
    font-size: 13px;
    cursor: pointer;
}

#cartBar strong {
    white-space: nowrap;
    font-size: 13px;
}

/* FOOTER */

#app .m-foot {
    padding: 30px 18px;
    color: #999;
    text-align: center;
    border-top: 1px solid #292929;
    font-size: 12px;
    line-height: 1.8;
}

#app .m-foot a {
    color: var(--menu-orange);
    text-decoration: none;
}

/* RESPONSIVE */

@media (max-width: 850px) {
    #app .m-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
    }

    #app .food-image-wrap {
        height: 175px;
    }
}

@media (max-width: 560px) {
    #app .m-hero {
        padding: 38px 15px 30px;
    }

    #app .m-bar {
        padding: 11px 12px;
    }

    #app .m-wrap {
        width: calc(100% - 24px);
        margin-top: 22px;
    }

    #app .m-sec h2 {
        font-size: 20px;
    }

    #app .m-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 11px;
    }

    #app .food-image-wrap {
        height: 135px;
    }

    #app .food-card-content {
        padding: 11px;
    }

    #app .food-name {
        font-size: 14px;
    }

    #app .food-description {
        font-size: 11px;
        min-height: 32px;
    }

    #app .food-price {
        font-size: 17px;
    }

    #app .food-card-bottom {
        gap: 10px;
        margin-top: 12px;
    }

    #app .menu-card-actions {
        grid-template-columns: 1fr;
        gap: 7px;
    }

    #app .order-add,
    #app .order-now-btn {
        min-height: 38px;
        font-size: 11px;
    }

    #app #sections.as-list .m-grid {
        gap: 10px;
    }

    #app #sections.as-list .premium-food-card {
        grid-template-columns: 105px minmax(0, 1fr);
    }

    #app #sections.as-list .food-image-wrap {
        min-height: 145px;
    }

    #app #sections.as-list .food-card-bottom {
        flex-direction: column;
        align-items: stretch;
    }

    #app #sections.as-list .menu-card-actions {
        min-width: 0;
    }

    #cartBar {
        bottom: max(10px, env(safe-area-inset-bottom));
        min-height: 58px;
        padding: 11px 14px;
        font-size: 12px;
    }
}

@media (max-width: 360px) {
    #app .m-grid {
        grid-template-columns: 1fr;
    }

    #app .food-image-wrap {
        height: 190px;
    }
}

@media (prefers-reduced-motion: reduce) {
    #app .premium-food-card,
    #app .food-image,
    #app .order-add,
    #app .order-now-btn {
        transition: none !important;
    }
}

/* Compact, image-led menu layout used by the restaurant ordering view. */
#app {
    width: min(1240px, 100%);
    margin: 0 auto;
    padding: 8px 18px 100px;
}

#app .m-hero {
    min-height: 0;
    margin-bottom: 9px;
    padding: 12px 18px;
    border-radius: 14px;
    background:
        radial-gradient(ellipse at 82% 8%, rgba(var(--theme-rgb), .35), transparent 40%),
        linear-gradient(110deg, #17130f, #0d0d0d 68%, #24130c);
}

#app .hero-content {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 34px;
    justify-items: center;
    gap: 9px;
}

#app .hero-logo {
    width: 38px;
    height: 38px;
    border-radius: 10px;
}

#app .hero-logo img {
    padding: 3px;
}

#app .hero-brand {
    text-align: center;
}

#app .hero-eyebrow {
    display: none;
}

#app .hero-brand h1 {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(19px, 3vw, 30px);
    line-height: 1.05;
    letter-spacing: -.25px;
}

#app .hero-brand p {
    margin: 3px 0 0;
    font-size: 10px;
}

#app .hero-location {
    margin-top: 3px;
    font-size: 9px;
}

#app .hero-food-decoration {
    margin: 0;
    width: 46px;
    height: 36px;
    display: grid;
    place-items: center;
    font-size: 30px;
}

#app .hero-food-decoration img {
    display: block;
    width: 100%;
    height: 100%;
    border: 1px solid rgba(255, 255, 255, .2);
    border-radius: 50% 11px 50% 11px;
    object-fit: cover;
    box-shadow: 0 4px 12px rgba(0, 0, 0, .45);
}

#app .menu-toolbar {
    gap: 8px;
    margin: 8px 0;
}

#app .search-wrapper {
    height: 36px;
    gap: 7px;
    padding: 0 10px;
    border-radius: 10px;
}

#app .search-icon {
    font-size: 16px;
}

#app .search-wrapper input {
    font-size: 11px;
}

#app #clearSearch {
    font-size: 18px;
}

#app .view-switch {
    gap: 2px;
    padding: 2px;
    border-radius: 9px;
}

#app .view-btn {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    font-size: 15px;
}

#app .category-navigation {
    top: 0;
    gap: 6px;
    margin: 0 0 10px;
    padding: 4px 0 7px;
}

#app .category-pill {
    flex: 0 0 48px;
    min-height: 45px;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    padding: 4px 3px;
    border-radius: 9px;
    font-size: 8px;
    line-height: 1.05;
    text-align: center;
    white-space: normal;
}

#app .category-icon {
    font-size: 15px;
    line-height: 1;
}

#app .menu-content {
    max-width: 1100px;
    margin: 0 auto;
}

#app .menu-category {
    margin-bottom: 18px;
    scroll-margin-top: 70px;
}

#app .category-heading {
    margin-bottom: 8px;
}

#app .category-heading h2 {
    margin: 0;
    font-size: 16px;
}

#app .category-count {
    font-size: 9px;
}

#app .view-all-btn {
    padding: 5px 8px;
    font-size: 9px;
}

#app .m-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
}

#app .premium-food-card {
    border-radius: 12px;
}

#app .food-image-wrap {
    height: clamp(100px, 18vw, 190px);
}

#app .food-available-badge,
#app .food-unavailable-badge {
    top: 6px;
    left: 6px;
    padding: 4px 6px;
    font-size: 8px;
}

#app .food-card-content {
    padding: 10px;
}

#app .food-name {
    font-size: 13px;
    line-height: 1.25;
}

#app .food-description {
    min-height: 28px;
    margin-top: 5px;
    font-size: 10px;
    line-height: 1.35;
}

#app .food-card-bottom {
    gap: 8px;
    margin-top: 8px;
}

#app .food-price {
    margin: 0;
    font-size: 15px;
}

#app .menu-card-actions {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 5px;
}

#app .order-add,
#app .order-now-btn,
#app .menu-qty-control {
    min-height: 30px;
    padding: 4px 5px;
    border-radius: 8px;
    font-size: 9px;
}

#app .menu-qty-control {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2px;
    min-width: 0;
    color: #fff;
    background: #292929;
    border: 1px solid #4b4b4b;
}

#app .menu-qty-control button {
    display: grid;
    place-items: center;
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    color: #fff;
    background: color-mix(in srgb, var(--theme) 75%, #222);
    font-size: 14px;
    line-height: 1;
}

#app .menu-qty-control strong {
    min-width: 12px;
    text-align: center;
    font-size: 10px;
}

#app .ordering-unavailable {
    margin: 7px 0 10px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--theme) 45%, #333);
    border-radius: 9px;
    color: #f1c7a8;
    background: #211711;
    font-size: 11px;
    text-align: center;
}

#app .empty-menu {
    padding: 36px 15px;
    text-align: center;
}

#app .m-grid.list-view {
    grid-template-columns: 1fr;
}

#app .m-grid.list-view .premium-food-card {
    grid-template-columns: minmax(95px, 25%) minmax(0, 1fr);
}

#app .m-grid.list-view .food-image-wrap {
    height: 100%;
    min-height: 125px;
}

#app .m-grid.list-view .food-card-bottom {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
}

#app .m-grid.list-view .menu-card-actions {
    min-width: min(210px, 55%);
}

@media (max-width: 560px) {
    #app {
        padding: 5px 8px 86px;
    }

    #app .m-hero {
        padding: 9px 10px;
    }

    #app .hero-content {
        grid-template-columns: 34px minmax(0, 1fr) 23px;
        gap: 5px;
    }

    #app .hero-logo {
        width: 31px;
        height: 31px;
        border-radius: 8px;
    }

    #app .hero-brand h1 {
        font-size: clamp(17px, 4.5vw, 22px);
    }

    #app .hero-brand p {
        font-size: 8px;
    }

    #app .hero-location {
        font-size: 7px;
    }

    #app .hero-food-decoration {
        width: 32px;
        height: 27px;
        font-size: 20px;
    }

    #app .menu-toolbar {
        gap: 5px;
        margin: 6px 0;
    }

    #app .search-wrapper {
        height: 31px;
        gap: 5px;
        padding: 0 7px;
    }

    #app .search-wrapper input {
        font-size: 9px;
    }

    #app .view-btn {
        width: 24px;
        height: 25px;
        font-size: 13px;
    }

    #app .category-navigation {
        gap: 5px;
        margin-bottom: 7px;
        padding-bottom: 5px;
    }

    #app .category-pill {
        flex-basis: 42px;
        min-height: 41px;
        font-size: 7px;
    }

    #app .category-icon {
        font-size: 13px;
    }

    #app .menu-category {
        margin-bottom: 14px;
    }

    #app .category-heading {
        margin-bottom: 6px;
    }

    #app .category-heading h2 {
        font-size: 13px;
    }

    #app .category-count,
    #app .view-all-btn {
        font-size: 7px;
    }

    #app .m-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
    }

    #app .premium-food-card {
        border-radius: 9px;
    }

    #app .food-image-wrap {
        height: clamp(58px, 17vw, 88px);
    }

    #app .food-available-badge,
    #app .food-unavailable-badge {
        top: 4px;
        left: 4px;
        padding: 3px 4px;
        font-size: 6px;
    }

    #app .food-card-content {
        padding: 6px;
    }

    #app .food-name {
        font-size: clamp(8px, 2.4vw, 10px);
        line-height: 1.2;
    }

    #app .food-description {
        min-height: 17px;
        margin-top: 3px;
        font-size: 7px;
        line-height: 1.25;
    }

    #app .food-card-bottom {
        gap: 4px;
        margin-top: 5px;
    }

    #app .food-price {
        font-size: 10px;
    }

    #app .menu-card-actions {
        gap: 3px;
    }

    #app .order-add,
    #app .order-now-btn,
    #app .menu-qty-control {
        min-height: 23px;
        padding: 2px 3px;
        border-radius: 6px;
        font-size: 7px;
    }

    #app .menu-qty-control {
        gap: 1px;
    }

    #app .menu-qty-control button {
        flex-basis: 14px;
        width: 14px;
        height: 16px;
        border-radius: 4px;
        font-size: 11px;
    }

    #app .menu-qty-control strong {
        min-width: 8px;
        font-size: 7px;
    }

    #app .m-grid.list-view .premium-food-card {
        grid-template-columns: 88px minmax(0, 1fr);
    }

    #app .m-grid.list-view .food-image-wrap {
        min-height: 112px;
    }

    #app .m-grid.list-view .food-card-bottom {
        flex-direction: column;
        align-items: stretch;
    }

    #app .m-grid.list-view .menu-card-actions {
        min-width: 0;
    }
}

@media (max-width: 340px) {
    #app .m-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    #app .food-image-wrap {
        height: 105px;
    }
}

body.menu-page #cartBar.cart-bar {
    min-height: 44px;
    padding: 6px 8px 6px 12px;
    border: 1px solid color-mix(in srgb, var(--theme) 60%, #50301c);
    border-radius: 10px;
    background: linear-gradient(90deg, #201710 0%, #201710 66%, var(--theme) 66%, var(--theme) 100%);
}

#cartBar .cart-bar-summary {
    display: grid;
    gap: 1px;
    min-width: 0;
    color: #fff;
}

#cartBar .cart-bar-summary b {
    font-size: 11px;
}

#cartBar .cart-bar-summary small {
    overflow: hidden;
    color: #d2c2b5;
    font-size: 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#cartBar > strong {
    padding: 8px 9px;
    border-radius: 7px;
    color: #fff;
    background: var(--theme);
    font-size: 10px;
}

#placeOrderForm [hidden] {
    display: none !important;
}

body.menu-page .checkout-panel .place-order,
body.menu-page .receipt-actions button:not(.receipt-secondary) {
    background: var(--theme) !important;
}

body.menu-page .checkout-panel .place-order:hover,
body.menu-page .receipt-actions button:not(.receipt-secondary):hover {
    filter: brightness(1.08);
}

        `;

        document.head.appendChild(style);
    }


    /* =========================================================
       END OF PART 3
       ========================================================= */
    /* =========================================================
   CART ADD / REMOVE
   ========================================================= */

    function addToCart(id) {
        if (!orderingEnabled()) {
            showCustomerNotification('Online ordering is currently unavailable.', 'error');
            return false;
        }

        const item = getItems().find(entry => getItemId(entry) === String(id));

        if (!item || !isItemAvailable(item)) {
            showCustomerNotification('This menu item is no longer available.', 'error');
            return false;
        }

        const key = getItemId(item);
        const existing = cart.get(key);

        if (existing) {
            if (existing.qty >= 20) return true;
            existing.qty = Math.min(20, existing.qty + 1);
            existing.name = getItemName(item);
            existing.price = getItemPrice(item);
            existing.image = getItemImage(item);
        } else {
            cart.set(key, {
                id: key,
                name: getItemName(item),
                price: getItemPrice(item),
                image: getItemImage(item),
                qty: 1
            });
        }

        updateCartViews();
        return true;
    }

    function decreaseCartItem(id) {
        const key = String(id);
        const item = cart.get(key);

        if (!item) return;

        if (item.qty <= 1) {
            cart.delete(key);
        } else {
            item.qty -= 1;
        }

        updateCartViews();
    }

    function quantityControlMarkup(id, qty, name) {
        const safeId = escapeHTML(id);
        const safeName = escapeHTML(name || 'menu item');

        return [
            '<div class="menu-qty-control" aria-label="Quantity controls for ', safeName, '">',
            '<button type="button" data-cart-dec="', safeId, '" aria-label="Decrease ', safeName, ' quantity">−</button>',
            '<strong aria-live="polite">', String(qty), '</strong>',
            '<button type="button" data-cart-inc="', safeId, '" aria-label="Increase ', safeName, ' quantity">+</button>',
            '</div>'
        ].join('');
    }

    function updateAddButtons() {
        $$('.m-card[data-item]').forEach(card => {
            const id = String(card.dataset.item || '');
            const item = getItems().find(entry => getItemId(entry) === id);
            const actions = $('.menu-card-actions', card);

            if (!actions) return;

            if (!orderingEnabled() || !item || !isItemAvailable(item)) {
                actions.innerHTML = '';
                return;
            }

            const cartItem = cart.get(id);
            const addControl = cartItem
                ? quantityControlMarkup(id, cartItem.qty, getItemName(item))
                : '<button class="order-add" type="button" data-add="' +
                escapeHTML(id) + '">+ Add</button>';

            actions.innerHTML = addControl +
                '<button class="order-now-btn" type="button" data-order-now="' +
                escapeHTML(id) + '">Order Now</button>';
        });
    }

    function updateCartViews() {
        updateCartBar();
        updateAddButtons();

        if (currentCheckout) {
            if (!cartCount()) {
                closeCheckout();
            } else {
                renderCheckoutItems();
            }
        }
    }

    function orderNow(id) {
        const item = getItems().find(entry => getItemId(entry) === String(id));

        if (!orderingEnabled() || !item || !isItemAvailable(item)) {
            addToCart(id);
            return;
        }

        addToCart(id);

        if (cart.has(String(id)) && orderingEnabled()) {
            openCheckout();
        }
    }
    function renderCartBar() {
        let bar = $('#cartBar');

        if (!bar) {
            bar = document.createElement('button');

            bar.id = 'cartBar';
            bar.className = 'cart-bar';
            bar.type = 'button';

            // Hide immediately before inserting into the page.
            bar.hidden = true;
            bar.style.setProperty('display', 'none', 'important');

            document.body.appendChild(bar);
        }

        updateCartBar();
    }
    function updateCartBar() {
        let bar = $('#cartBar');

        if (!bar) {
            renderCartBar();
            return;
        }

        const count = cartCount();
        const shouldShow = orderingEnabled() && count > 0;

        // Always update the cart contents.
        bar.innerHTML = `
        <span>
            🛒 ${count} ${count === 1 ? 'Item' : 'Items'}
        </span>

        <strong>
            View Cart · ${money(subtotal())}
        </strong>
    `;

        if (shouldShow) {
            bar.hidden = false;

            bar.style.setProperty(
                'display',
                'flex',
                'important'
            );

            bar.disabled = false;
        } else {
            bar.hidden = true;

            bar.style.setProperty(
                'display',
                'none',
                'important'
            );

            bar.disabled = true;
        }

        updateAddButtons();
    }
    function createCheckoutModal() {
        let modal = $('#checkoutSheet');

        if (modal) {
            currentCheckout = modal;
            return modal;
        }

        modal = document.createElement('div');
        modal.id = 'checkoutSheet';
        modal.className = 'checkout-overlay';
        modal.setAttribute('role', 'presentation');
        modal.innerHTML = [
            '<section class="checkout-panel" role="dialog" aria-modal="true" aria-labelledby="checkoutTitle">',
            '<button type="button" class="checkout-close" id="closeCheckout" aria-label="Close checkout">×</button>',
            '<span class="checkout-eyebrow">YOUR ORDER</span>',
            '<h2 id="checkoutTitle">Checkout</h2>',
            '<div id="checkoutLines" aria-live="polite"></div>',
            '<div class="checkout-totals">',
            '<div><span>Food Subtotal</span><strong id="subtotalValue"></strong></div>',
            '<div><span>Tax (5%)</span><strong id="taxValue"></strong></div>',
            '<div class="checkout-total"><span>Grand Total</span><strong id="totalValue"></strong></div>',
            '</div>',
            '<form id="placeOrderForm">',
            '<label>Customer name<input id="customerName" name="customer" type="text" required minlength="2" maxlength="80" autocomplete="name" placeholder="Your name"></label>',
            '<label>Mobile number<input name="phone" type="tel" required maxlength="30" autocomplete="tel" inputmode="tel" placeholder="Mobile number"></label>',
            '<label>Order type<select name="order_type" id="orderType" required>',
            '<option value="Dine In">Dine In</option>',
            '<option value="Takeaway">Takeaway</option>',
            '<option value="Delivery">Delivery</option>',
            '<option value="Room Service">Room Service</option>',
            '</select></label>',
            '<label class="checkout-location-field" id="tableField">Table number<input name="table_no" id="tableNo" type="text" required maxlength="30" placeholder="Enter table number"></label>',
            '<label class="checkout-location-field" id="roomField" hidden>Room number<input name="room_no" id="roomNo" type="text" maxlength="30" placeholder="Enter room number"></label>',
            '<label class="checkout-location-field" id="deliveryField" hidden>Delivery address<textarea name="delivery_address" id="deliveryAddress" maxlength="200" rows="2" placeholder="Enter complete delivery address"></textarea></label>',
            '<label>Special instructions (optional)<textarea name="note" maxlength="500" rows="3" placeholder="Allergies or other requests"></textarea></label>',
            '<button class="place-order" type="submit" id="confirmOrder">Confirm Order</button>',
            '<p class="muted checkout-hint">Review your items before confirming your order.</p>',
            '<div id="orderMessage" role="alert" aria-live="polite"></div>',
            '</form>',
            '</section>'
        ].join('');

        document.body.appendChild(modal);
        currentCheckout = modal;
        return modal;
    }
    function renderCheckoutItems() {
        if (!currentCheckout) return;

        const container = $('#checkoutLines', currentCheckout);
        if (!container) return;

        container.innerHTML = [...cart.values()].map(item => [
            '<div class="checkout-line">',
            '<div class="checkout-line-info"><b>', escapeHTML(item.name), '</b>',
            '<div class="muted">', money(item.price), ' each</div></div>',
            '<div class="checkout-qty">',
            '<button type="button" data-checkout-dec="', escapeHTML(item.id), '" aria-label="Decrease ', escapeHTML(item.name), '">−</button>',
            '<span aria-live="polite">', String(item.qty), '</span>',
            '<button type="button" data-checkout-inc="', escapeHTML(item.id), '" aria-label="Increase ', escapeHTML(item.name), '">+</button>',
            '</div>',
            '<strong>', money(item.price * item.qty), '</strong>',
            '</div>'
        ].join('')).join('');

        $('#subtotalValue', currentCheckout).textContent = money(subtotal());
        $('#taxValue', currentCheckout).textContent = money(taxAmount());
        $('#totalValue', currentCheckout).textContent = money(payableTotal());

        const confirmButton = $('#confirmOrder', currentCheckout);
        if (confirmButton && !confirmButton.disabled) {
            confirmButton.textContent = 'Confirm Order · ' + money(payableTotal());
        }
    }

    function updateOrderTypeFields() {
        const form = $('#placeOrderForm', currentCheckout || document);
        if (!form) return;

        const type = $('#orderType', form)?.value || 'Dine In';
        const tableField = $('#tableField', form);
        const roomField = $('#roomField', form);
        const deliveryField = $('#deliveryField', form);
        const tableNo = $('#tableNo', form);
        const roomNo = $('#roomNo', form);
        const deliveryAddress = $('#deliveryAddress', form);

        if (tableField) tableField.hidden = type !== 'Dine In';
        if (roomField) roomField.hidden = type !== 'Room Service';
        if (deliveryField) deliveryField.hidden = type !== 'Delivery';

        if (tableNo) tableNo.required = type === 'Dine In';
        if (roomNo) roomNo.required = type === 'Room Service';
        if (deliveryAddress) deliveryAddress.required = type === 'Delivery';
    }

    function openCheckout() {
        if (!orderingEnabled()) {
            showCustomerNotification('Online ordering is currently disabled.', 'error');
            return;
        }

        if (!cartCount()) {
            showCustomerNotification('Add an item before opening your cart.', 'error');
            return;
        }

        const modal = createCheckoutModal();

        if (previousBodyOverflow === null) {
            previousBodyOverflow = document.body.style.overflow;
        }

        renderCheckoutItems();
        updateOrderTypeFields();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';

        window.setTimeout(() => {
            $('#customerName', modal)?.focus({ preventScroll: true });
        }, 0);
    }

    function closeCheckout() {
        $('#checkoutSheet')?.remove();
        currentCheckout = null;

        if (!$('#vignaReceiptOverlay') && previousBodyOverflow !== null) {
            document.body.style.overflow = previousBodyOverflow;
            previousBodyOverflow = null;
        }
    }

    async function submitOrder(event) {
        event.preventDefault();

        const form = event.currentTarget;
        const message = $('#orderMessage', currentCheckout || document);
        const button = $('#confirmOrder', currentCheckout || document);

        if (!orderingEnabled()) {
            showCustomerNotification('Online ordering is currently unavailable.', 'error');
            closeCheckout();
            return;
        }

        if (!cartCount()) {
            if (message) message.textContent = 'Your cart is empty.';
            return;
        }

        if (!form.reportValidity()) return;

        const formData = new FormData(form);
        const orderType = String(formData.get('order_type') || 'Dine In');
        const customerName = String(formData.get('customer') || '').trim();
        const phone = String(formData.get('phone') || '').trim();
        const tableNo = orderType === 'Dine In'
            ? String(formData.get('table_no') || '').trim()
            : '';
        const roomNo = orderType === 'Room Service'
            ? String(formData.get('room_no') || '').trim()
            : '';
        const deliveryAddress = orderType === 'Delivery'
            ? String(formData.get('delivery_address') || '').trim()
            : '';
        const location = tableNo || roomNo || deliveryAddress;

        const items = [...cart.values()].map(item => ({
            id: item.id,
            item_id: item.id,
            name: item.name,
            price: Number(item.price),
            qty: item.qty,
            quantity: item.qty,
            subtotal: Math.round((item.price * item.qty + Number.EPSILON) * 100) / 100
        }));

        const payload = {
            slug: getRestaurant().slug || slug,
            customer: customerName,
            customer_name: customerName,
            phone,
            mobile: phone,
            order_type: orderType,
            ...(orderType === 'Dine In'
                ? { table_no: tableNo, table_number: tableNo, location: location }
                : {}),
            ...(orderType === 'Room Service'
                ? { room_no: roomNo, location: location }
                : {}),
            ...(orderType === 'Delivery'
                ? { delivery_address: deliveryAddress, location: location }
                : {}),
            note: String(formData.get('note') || '').trim(),
            items,
            subtotal: subtotal(),
            tax: taxAmount(),
            tax_rate: 5,
            total: payableTotal()
        };

        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            button.textContent = 'Placing order…';
        }

        if (message) message.textContent = '';

        try {
            const response = await apiRequest(API + '/public/orders', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            const order = response?.order ||
                response?.data?.order ||
                response?.data ||
                response;

            const orderId = order.id ||
                order._id ||
                order.order_id ||
                response.id;

            const orderNumber = order.order_no ||
                order.order_number ||
                order.orderNumber ||
                response.order_no ||
                response.order_number ||
                orderId ||
                'Pending';

            const restaurant = getRestaurant();
            const receiptData = {
                ...payload,
                ...order,
                id: orderId,
                order_number: orderNumber,
                order_no: order.order_no || response.order_no || orderNumber,
                items: Array.isArray(order.items) && order.items.length
                    ? order.items
                    : items,
                subtotal: response.subtotal ?? order.subtotal ?? payload.subtotal,
                tax: response.tax ?? order.tax ?? payload.tax,
                total: response.total ?? order.total ?? payload.total,
                restaurant: {
                    ...restaurant,
                    upi_id: restaurant.upi_id || '',
                    upi_qr_image: restaurant.upi_qr_image || ''
                }
            };

            cart.clear();
            closeCheckout();
            updateCartBar();

            showOrderPlacedNotification(orderNumber);
            showReceipt(receiptData);

            if (orderId) {
                listenForOrderUpdates(orderId, orderNumber);
            }
        } catch (error) {
            console.error('Vigna order submission failed:', error);

            const failureMessage = error.message ||
                'We could not submit your order. Please try again.';

            if (message?.isConnected) {
                message.textContent = failureMessage;
            } else {
                showCustomerNotification(failureMessage, 'error');
            }

            if (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
                button.textContent = 'Confirm Order · ' + money(payableTotal());
            }
        }
    }

    function receiptItemRows(items) {
        return (Array.isArray(items) ? items : []).map(item => {
            const quantity = Number(item.quantity ?? item.qty ?? 1);
            const price = Number(item.price || 0);
            const amount = Number(
                item.line_total ??
                item.subtotal ??
                Math.round((price * quantity + Number.EPSILON) * 100) / 100
            );

            return [
                '<div class="receipt-row">',
                '<span>', escapeHTML(item.name || item.item_name || 'Item'), '</span>',
                '<span>', String(quantity), '</span>',
                '<span>', money(price), '</span>',
                '<strong>', money(amount), '</strong>',
                '</div>'
            ].join('');
        }).join('');
    }

    function getReceiptUPI(restaurant) {
        const qrImage = String(restaurant?.upi_qr_image || '').trim();
        const upiId = String(restaurant?.upi_id || '').trim();

        if (!qrImage && !upiId) return '';

        const qrMarkup = qrImage
            ? '<img class="receipt-upi-image" src="' + escapeHTML(qrImage) +
            '" alt="Restaurant UPI QR Code" loading="eager" onerror="this.style.display=\'none\'; this.parentElement.classList.add(\'qr-error\');">'
            : '<div class="receipt-qr-missing">Restaurant QR image is not configured.</div>';

        const upiMarkup = upiId
            ? '<div class="receipt-upi-id">UPI ID: ' + escapeHTML(upiId) + '</div>'
            : '';

        return [
            '<section class="receipt-upi">',
            '<h3>SCAN &amp; PAY</h3>',
            qrMarkup,
            upiMarkup,
            '<small>Scan the restaurant QR code to make payment</small>',
            '</section>'
        ].join('');
    }
    let receiptPreviousBodyOverflow = null;

    function receiptHTML(data) {
        const restaurant = data.restaurant || {};
        const type = String(data.order_type || '');
        const location = type === 'Dine In'
            ? data.table_no || data.table_number
            : type === 'Room Service'
                ? data.room_no
                : type === 'Delivery'
                    ? data.delivery_address
                    : '';
        const locationLabel = type === 'Dine In'
            ? 'Table No.'
            : type === 'Room Service'
                ? 'Room No.'
                : 'Delivery Address';
        const createdAt = data.created_at ? new Date(data.created_at) : new Date();
        const dateLabel = Number.isNaN(createdAt.getTime())
            ? new Date().toLocaleString('en-IN')
            : createdAt.toLocaleString('en-IN');
        const locationMarkup = location
            ? '<div class="meta-line"><span>' + escapeHTML(locationLabel) +
            '</span><span>:</span><span>' + escapeHTML(location) + '</span></div>'
            : '';
        const noteMarkup = data.note
            ? '<div class="meta-line"><span>Note</span><span>:</span><span>' +
            escapeHTML(data.note) + '</span></div>'
            : '';

        return [
            '<div class="receipt-final-paper" id="receiptFinalPaper">',
            '<header class="receipt-head">',
            restaurant.logo
                ? '<img class="receipt-icon" src="' + escapeHTML(restaurant.logo) +
                '" alt="' + escapeHTML(restaurant.name || 'Restaurant') + '">'
                : '',
            '<h2>', escapeHTML(restaurant.name || 'Restaurant'), '</h2>',
            restaurant.address ? '<p>' + escapeHTML(restaurant.address) + '</p>' : '',
            restaurant.phone ? '<p>' + escapeHTML(restaurant.phone) + '</p>' : '',
            '<p class="receipt-label">ORDER RECEIPT</p>',
            '</header>',
            '<div class="receipt-meta">',
            '<div class="meta-line"><span>Order No</span><span>:</span><strong>',
            escapeHTML(data.order_number || data.order_no || 'Pending'),
            '</strong></div>',
            '<div class="meta-line"><span>Date</span><span>:</span><span>',
            escapeHTML(dateLabel),
            '</span></div>',
            '<div class="meta-line"><span>Customer</span><span>:</span><span>',
            escapeHTML(data.customer || data.customer_name || ''),
            '</span></div>',
            '<div class="meta-line"><span>Phone</span><span>:</span><span>',
            escapeHTML(data.phone || ''),
            '</span></div>',
            '<div class="meta-line"><span>Order Type</span><span>:</span><span>',
            escapeHTML(type),
            '</span></div>',
            locationMarkup,
            noteMarkup,
            '</div>',
            '<div class="receipt-items">',
            '<div class="receipt-table-head"><span>Item</span><span>Qty</span><span>Price</span><span>Total</span></div>',
            receiptItemRows(data.items),
            '</div>',
            '<div class="receipt-summary-line"><span>Food Subtotal</span><strong>',
            money(data.subtotal),
            '</strong></div>',
            '<div class="receipt-summary-line"><span>Tax (5%)</span><strong>',
            money(data.tax),
            '</strong></div>',
            '<div class="receipt-total"><span>GRAND TOTAL</span><strong>',
            money(data.total),
            '</strong></div>',
            getReceiptUPI(restaurant),
            '<footer class="receipt-foot">',
            '<strong>Thank you for ordering!</strong>',
            '<div>We will confirm your order shortly.</div>',
            '<div class="leaf-divider">◆</div>',
            '<strong>', escapeHTML(restaurant.name || ''), '</strong>',
            '<div>Good Food Brings People Together</div>',
            '<div class="receipt-hearts">♥ ♥ ♥</div>',
            '<div>Powered by VignaDigital</div>',
            '</footer>',
            '</div>'
        ].join('');
    }

    function showReceipt(data) {
        $('#vignaReceiptOverlay')?.remove();

        const restaurant = data.restaurant || {};
        const overlay = document.createElement('div');
        overlay.id = 'vignaReceiptOverlay';
        overlay.className = 'checkout-overlay';
        overlay.innerHTML = [
            '<section class="checkout-panel receipt-mode">',
            '<div class="receipt-animation-wrap" id="receiptAnimation">',
            '<section class="receipt-printer-stage">',
            '<div class="printer-brand">VIGNADIGITAL</div>',
            '<div class="receipt-printing-paper">',
            restaurant.logo
                ? '<img class="receipt-icon" src="' + escapeHTML(restaurant.logo) +
                '" width="48" alt="">'
                : '',
            '<h2>', escapeHTML(restaurant.name || 'Restaurant'), '</h2>',
            '<p>ORDER CONFIRMED</p>',
            '<p>Order #', escapeHTML(data.order_number || data.order_no || ''), '</p>',
            '<p>Printing your receipt…</p>',
            '</div>',
            '<div class="printer-machine"><span></span>THERMAL RECEIPT PRINTER</div>',
            '<div class="printer-icon">🧾</div>',
            '</section>',
            '</div>',
            '<div id="receiptResult" class="receipt-hidden">',
            receiptHTML(data),
            '<div class="receipt-actions">',
            '<button type="button" id="printReceipt">Print Receipt</button>',
            '<button type="button" class="receipt-secondary" id="backMenu">Back to Menu</button>',
            '</div>',
            '<p class="order-status" id="liveStatus">Status: Pending</p>',
            '</div>',
            '</section>'
        ].join('');

        if (receiptPreviousBodyOverflow === null) {
            receiptPreviousBodyOverflow = document.body.style.overflow;
        }

        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        window.setTimeout(() => {
            if (!overlay.isConnected) return;

            $('#receiptAnimation', overlay)?.remove();
            $('#receiptResult', overlay)?.classList.remove('receipt-hidden');
        }, 2200);
    }

    function printReceipt() {
        const receipt = $('#receiptFinalPaper');
        if (!receipt) return;

        const printWindow = window.open('', '_blank', 'width=420,height=700');

        if (!printWindow) {
            alert('Please allow popups to print the receipt.');
            return;
        }

        const styles = [
            '*{box-sizing:border-box}',
            'body{margin:0;padding:3mm;background:#fff;font-family:Arial,sans-serif}',
            '.receipt-final-paper{position:relative;width:72mm;margin:auto;padding:4mm;color:#29241f;background:#fff;font:10px monospace}',
            '.receipt-head,.receipt-foot{text-align:center}',
            '.receipt-icon{width:48px;height:48px;object-fit:contain}',
            '.receipt-meta{font-size:10px;line-height:1.7}',
            '.meta-line{display:grid;grid-template-columns:68px 8px 1fr;gap:3px;overflow-wrap:anywhere}',
            '.receipt-items{border-top:1px dashed #999;border-bottom:1px dashed #999;margin:8px 0;padding:6px 0}',
            '.receipt-table-head,.receipt-row{display:grid;grid-template-columns:minmax(0,1fr) 18px 37px 40px;gap:2px;font-size:8px;padding:4px 0}',
            '.receipt-table-head{font-weight:bold}',
            '.receipt-table-head span:not(:first-child),.receipt-row span:not(:first-child),.receipt-row strong{text-align:right}',
            '.receipt-summary-line,.receipt-total{display:flex;justify-content:space-between;padding:4px 0}',
            '.receipt-total{border-top:1px dashed #333;border-bottom:1px dashed #333;font-weight:bold;margin-top:5px;padding:8px 0}',
            '.receipt-upi{text-align:center;padding:8px 0;border-top:1px dashed #999;border-bottom:1px dashed #999}',
            '.receipt-upi img{display:block;width:100px;height:100px;object-fit:contain;margin:5px auto}',
            '.receipt-actions,.order-status{display:none!important}',
            '@page{size:80mm auto;margin:3mm}'
        ].join('');

        printWindow.document.open();
        printWindow.document.write(
            '<!doctype html><html><head><title>VignaDigital Receipt</title>' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<style>' + styles + '</style></head><body>' +
            receipt.outerHTML +
            '</body></html>'
        );
        printWindow.document.close();
        printWindow.onload = () => {
            printWindow.focus();
            printWindow.print();
        };
    }
    function notificationStack() {
        let stack = $('#customerOrderNotifications');

        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'customerOrderNotifications';
            stack.setAttribute('aria-live', 'polite');
            stack.setAttribute('aria-relevant', 'additions');
            Object.assign(stack.style, {
                position: 'fixed',
                top: '14px',
                right: '14px',
                zIndex: '30000',
                display: 'flex',
                flexDirection: 'column',
                gap: '9px',
                width: 'min(340px, calc(100vw - 28px))',
                pointerEvents: 'none'
            });
            document.body.appendChild(stack);
        }

        return stack;
    }

    function showCustomerNotification(message, tone) {
        const color = tone === 'ready'
            ? '#208451'
            : tone === 'error'
                ? '#b7352d'
                : tone === 'placed'
                    ? '#ba7916'
                    : '#d5651c';
        const stack = notificationStack();
        const notification = document.createElement('div');
        const heading = document.createElement('strong');
        const body = document.createElement('p');
        const close = document.createElement('button');

        notification.className = 'customer-order-notification ' + (tone || 'info');
        notification.style.cssText =
            'position:relative;box-sizing:border-box;width:100%;padding:13px 40px 13px 14px;' +
            'border:1px solid #e5d4c4;border-left:5px solid ' + color + ';border-radius:12px;' +
            'background:#fffaf1;color:#33251e;box-shadow:0 8px 26px rgba(0,0,0,.24);' +
            'font:13px/1.45 Inter,Arial,sans-serif;pointer-events:auto;animation:customerNoticeIn .25s ease;';

        heading.textContent = tone === 'placed'
            ? 'Order placed successfully'
            : tone === 'accepted'
                ? 'Restaurant accepted your order'
                : tone === 'preparing'
                    ? 'Your order is being prepared'
                    : tone === 'ready'
                        ? 'Your order is ready'
                        : tone === 'error'
                            ? 'Ordering update'
                            : 'Order update';
        heading.style.cssText = 'display:block;margin:0 0 4px;color:' + color + ';font-size:14px;';
        body.textContent = String(message || '');
        body.style.cssText = 'margin:0;color:#493a31;';
        close.type = 'button';
        close.textContent = '×';
        close.setAttribute('aria-label', 'Dismiss notification');
        close.style.cssText =
            'position:absolute;top:4px;right:7px;width:28px;height:28px;border:0;' +
            'background:transparent;color:#6b5a50;font-size:21px;cursor:pointer;';
        close.addEventListener('click', () => {
            notification.remove();
            if (stack.isConnected && !stack.children.length) stack.remove();
        });

        notification.append(heading, body, close);
        stack.appendChild(notification);

        window.setTimeout(() => {
            notification.remove();
            if (stack.isConnected && !stack.children.length) stack.remove();
        }, 9000);
    }

    function showOrderPlacedNotification(orderNumber) {
        showCustomerNotification(
            'Your order #' + String(orderNumber) +
            ' has been placed. Please wait while the restaurant confirms it.',
            'placed'
        );
    }

    function listenForOrderUpdates(orderId, orderNumber) {
        if (!orderId || !window.EventSource) return;

        currentOrderEventSource?.close();

        const eventSource = new window.EventSource(
            API + '/public/orders/' + encodeURIComponent(orderId) + '/events'
        );
        currentOrderEventSource = eventSource;
        const notifiedStatuses = new Set();

        eventSource.addEventListener('order-status', event => {
            let update;

            try {
                update = JSON.parse(event.data || '{}');
            } catch (error) {
                console.warn('Invalid order status update:', error);
                return;
            }

            const rawStatus = String(update.status || '').trim();
            const status = rawStatus.toLowerCase().replace(/[\s-]+/g, '_');
            const liveStatus = $('#liveStatus');

            if (liveStatus && rawStatus) {
                liveStatus.textContent = 'Status: ' + rawStatus;
            }

            if (!status || notifiedStatuses.has(status)) return;
            notifiedStatuses.add(status);

            if (status === 'accepted') {
                showCustomerNotification(
                    'The restaurant accepted order #' + orderNumber + '.',
                    'accepted'
                );
                return;
            }

            if (['preparing', 'preparing_order', 'in_preparation', 'started'].includes(status)) {
                showCustomerNotification(
                    'The kitchen has started preparing order #' + orderNumber + '.',
                    'preparing'
                );
                return;
            }

            if (['ready', 'prepared', 'completed', 'served'].includes(status)) {
                showCustomerNotification(
                    'Order #' + orderNumber + ' is ready. Please collect it.',
                    'ready'
                );
                eventSource.close();
                if (currentOrderEventSource === eventSource) currentOrderEventSource = null;
                return;
            }

            if (['rejected', 'cancelled', 'canceled'].includes(status)) {
                showCustomerNotification(
                    'The restaurant could not fulfill order #' + orderNumber + '. Please contact the restaurant.',
                    'error'
                );
                eventSource.close();
                if (currentOrderEventSource === eventSource) currentOrderEventSource = null;
            }
        });

        eventSource.onerror = error => {
            console.warn('Customer order status connection interrupted:', error);
        };
    }
    function getMenuPayload(response) {
        return response?.data?.restaurant ? response.data : response;
    }

    function applyLatestRestaurant(restaurant) {
        if (!menuData || !restaurant) return;

        const oldTheme = String(getRestaurant().theme_color || '');
        menuData.restaurant = {
            ...getRestaurant(),
            ...restaurant
        };

        const newTheme = String(getRestaurant().theme_color || '#d9480f');

        if (newTheme !== oldTheme) {
            applyRestaurantTheme(newTheme);
            window.VIGNA_THEME = newTheme;
        }
    }

    async function refreshOrderingStatus() {
        if (
            orderingCheckRunning ||
            !menuData ||
            document.visibilityState === 'hidden'
        ) {
            return;
        }

        orderingCheckRunning = true;

        try {
            const response = await apiRequest(
                API + '/public/menu/' + encodeURIComponent(slug) +
                '?include_unavailable=1&_=' + Date.now()
            );
            const payload = getMenuPayload(response);

            if (!payload?.restaurant) return;

            const previousState = lastOrderingState ?? orderingEnabled();
            applyLatestRestaurant(payload.restaurant);

            const currentState = orderingEnabled();

            if (!currentState) {
                cart.clear();
                closeCheckout();
            }

            if (currentState !== previousState) {
                lastOrderingState = currentState;
                renderMenu($('#q')?.value || '');
                updateCartBar();
            }
        } catch (error) {
            console.warn('Ordering status refresh failed:', error);
        } finally {
            orderingCheckRunning = false;
        }
    }

    function reconcileCartWithMenu() {
        const items = new Map(getItems().map(item => [getItemId(item), item]));
        let changed = false;

        for (const [id, cartItem] of cart) {
            const latest = items.get(id);

            if (!latest || !isItemAvailable(latest)) {
                cart.delete(id);
                changed = true;
                continue;
            }

            const latestPrice = getItemPrice(latest);
            const latestName = getItemName(latest);
            const latestImage = getItemImage(latest);

            if (
                cartItem.price !== latestPrice ||
                cartItem.name !== latestName ||
                cartItem.image !== latestImage
            ) {
                cartItem.price = latestPrice;
                cartItem.name = latestName;
                cartItem.image = latestImage;
                changed = true;
            }
        }

        return changed;
    }

    async function refreshMenuData() {
        if (menuRefreshRunning || document.visibilityState === 'hidden') return;
        menuRefreshRunning = true;

        try {
            const response = await apiRequest(
                API + '/public/menu/' + encodeURIComponent(slug) +
                '?include_unavailable=1&_=' + Date.now()
            );
            const payload = getMenuPayload(response);

            if (!payload?.restaurant || !Array.isArray(payload.categories)) return;

            const previousJson = menuData ? JSON.stringify(menuData) : '';
            const previousState = menuData ? orderingEnabled() : true;
            const searchQuery = $('#q')?.value || '';

            menuData = payload;
            const currentState = orderingEnabled();

            if (!currentState) {
                cart.clear();
                closeCheckout();
            } else {
                reconcileCartWithMenu();
            }

            lastOrderingState = currentState;

            const restaurant = getRestaurant();
            const themeColor = /^#[0-9a-fA-F]{6}$/.test(
                String(restaurant.theme_color || '')
            )
                ? restaurant.theme_color
                : '#d9480f';
            applyRestaurantTheme(themeColor);
            window.VIGNA_THEME = themeColor;

            const changed = previousJson !== JSON.stringify(menuData);

            if (changed || previousState !== currentState) {
                renderMenu(searchQuery);
            } else {
                updateCartViews();
            }
        } catch (error) {
            console.warn('Menu refresh failed:', error);
        } finally {
            menuRefreshRunning = false;
        }
    }

    function handleDocumentClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const decrease = target.closest('[data-cart-dec], [data-checkout-dec]');
        if (decrease) {
            event.preventDefault();
            event.stopPropagation();
            decreaseCartItem(
                decrease.dataset.cartDec || decrease.dataset.checkoutDec
            );
            return;
        }

        const increase = target.closest('[data-cart-inc], [data-checkout-inc]');
        if (increase) {
            event.preventDefault();
            event.stopPropagation();
            addToCart(
                increase.dataset.cartInc || increase.dataset.checkoutInc
            );
            return;
        }

        const addButton = target.closest('[data-add]');
        if (addButton) {
            event.preventDefault();
            event.stopPropagation();
            addToCart(addButton.dataset.add);
            return;
        }

        const orderButton = target.closest('[data-order-now]');
        if (orderButton) {
            event.preventDefault();
            event.stopPropagation();
            orderNow(orderButton.dataset.orderNow);
            return;
        }

        if (target.closest('#cartBar')) {
            event.preventDefault();
            openCheckout();
            return;
        }

        if (target.closest('#closeCheckout, .checkout-close')) {
            event.preventDefault();
            closeCheckout();
            return;
        }

        if (target.id === 'checkoutSheet') {
            closeCheckout();
            return;
        }

        if (target.closest('#printReceipt')) {
            event.preventDefault();
            printReceipt();
            return;
        }

        if (target.closest('#backMenu')) {
            event.preventDefault();
            $('#vignaReceiptOverlay')?.remove();
            currentOrderEventSource?.close();
            currentOrderEventSource = null;

            if (receiptPreviousBodyOverflow !== null) {
                document.body.style.overflow = receiptPreviousBodyOverflow;
                receiptPreviousBodyOverflow = null;
            }
            return;
        }

        if (target.closest('#retryMenu')) {
            event.preventDefault();
            loadMenu().catch(showMenuLoadError);
        }
    }

    function showMenuLoadError(error) {
        console.error('Vigna menu initialization error:', error);

        const app = $('#app');
        if (!app) return;

        app.innerHTML = [
            '<div class="empty-menu" role="alert">',
            '<h2>Unable to load menu</h2>',
            '<p>', escapeHTML(error?.message || 'Please try again.'), '</p>',
            '<button type="button" id="retryMenu" class="order-now-btn">Try Again</button>',
            '</div>'
        ].join('');
    }

    function cleanup() {
        window.clearInterval(orderingTimer);
        window.clearInterval(menuRefreshTimer);
        window.clearTimeout(searchTimer);

        categoryObserver?.disconnect();
        currentOrderEventSource?.close();
        currentOrderEventSource = null;
    }

    async function initialize() {
        if (initialized) return;
        initialized = true;

        addStyles();
        setupSearch();
        setupViewSwitch();

        document.addEventListener('click', handleDocumentClick);
        document.addEventListener('submit', event => {
            if (event.target?.id === 'placeOrderForm') {
                submitOrder(event);
            }
        });
        document.addEventListener('change', event => {
            if (event.target?.id === 'orderType') {
                updateOrderTypeFields();
            }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && currentCheckout) {
                closeCheckout();
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                refreshOrderingStatus();
                refreshMenuData();
            }
        });
        window.addEventListener('pagehide', cleanup, { once: true });

        try {
            await loadMenu();
        } catch (error) {
            showMenuLoadError(error);
        }

        orderingTimer = window.setInterval(refreshOrderingStatus, 1000);
        menuRefreshTimer = window.setInterval(refreshMenuData, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }

})();
