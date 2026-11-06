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
        <div class="hero-brand">
            <h1>${escapeHTML(restaurantName)}</h1>

            <p>
                ${escapeHTML(
            restaurant.tagline || 'Multi Cuisine Restaurant'
        )}
            </p>

            <div class="hero-location">
                ${restaurant.city || restaurant.address
                ? escapeHTML(restaurant.city || restaurant.address)
                : 'Dine In · Takeaway · Delivery'
            }
            </div>
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
   PREMIUM MENU CSS
   ========================================================= */

    function addStyles() {

        let style = document.getElementById('vigna-premium-menu-styles');

        if (!style) {
            style = document.createElement('style');
            style.id = 'vigna-premium-menu-styles';
            document.head.appendChild(style);
        }

        style.textContent = `

/* =========================================
   ORIGINAL PEARL WHITE MENU DESIGN
   ========================================= */

:root {
    --bg: #ffffff;
    --surface: #ffffff;
    --surface-2: #f5f5f5;
    --border: #e5e5e5;

    --text: #242424;
    --muted: #777777;

    --theme: #f06423;
    --theme-dark: #bd4314;
    --theme-light: #ffb17e;
    --theme-soft: rgba(240,100,35,.12);
    --theme-rgb: 240,100,35;

    --menu-orange: #f06423;
    --menu-card: #ffffff;
    --menu-card-border: #e5e5e5;
}

/* PAGE */

html,
body,
body.menu-page {
    background: #ffffff !important;
    color: #242424 !important;
}

#app {
    width: min(1440px,100%);
    margin: auto;
    padding: 20px 20px 120px;
    background: #ffffff !important;
    color: #242424 !important;
}

/* =========================================
   RESTAURANT HEADER
   ========================================= */

#app .m-hero {
    min-height: 160px !important;
    padding: 25px !important;
    margin-bottom: 12px !important;

    background: linear-gradient(
        135deg,
        #ffffff 0%,
        #fafafa 55%,
        #eeeeef 100%
    ) !important;

    border: 1px solid #e5e5e5 !important;
    border-radius: 0 0 20px 20px !important;

    box-shadow: 0 5px 20px rgba(0,0,0,.045) !important;
}

#app .hero-background {
    background: transparent !important;
}

#app .hero-content {
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    width: 100% !important;
    min-height: 110px !important;
    padding: 10px !important;
    text-align: center !important;
}

#app .hero-brand {
    width: 100% !important;
    text-align: center !important;
    margin: 0 auto !important;
}

#app .hero-brand h1,
#app .m-hero h1 {
    margin: 0 !important;
    color: #292929 !important;
    font-size: clamp(26px,4vw,38px) !important;
    font-weight: 850 !important;
    line-height: 1.15 !important;
    text-shadow: none !important;
}

#app .hero-brand p,
#app .m-hero p {
    margin: 7px 0 !important;
    color: #777777 !important;
    font-size: 12px !important;
}

#app .hero-location {
    color: #999999 !important;
    font-size: 11px !important;
    margin-top: 8px !important;
}

#app .hero-logo,
#app .hero-food-decoration {
    display: none !important;
}

/* =========================================
   SEARCH BAR
   ========================================= */

#app .menu-toolbar {
    display: flex !important;
    gap: 12px !important;
    margin: 10px auto 20px !important;
    background: transparent !important;
}

#app .search-wrapper,
#app .m-search {
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    flex: 1 !important;
    min-width: 0 !important;
    height: 40px !important;
    padding: 0 13px !important;

    background: #ffffff !important;
    border: 1px solid #e5e5e5 !important;
    border-radius: 25px !important;

    box-shadow: none !important;
}

#app .search-wrapper input,
#app #q {
    flex: 1 !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    padding: 0 12px !important;

    background: #f7f7f8 !important;
    border: 1px solid #e1e1e1 !important;
    border-radius: 12px !important;

    color: #292929 !important;
    font-size: 12px !important;
    outline: none !important;
}

#app .search-wrapper input::placeholder,
#app #q::placeholder {
    color: #999999 !important;
}

#app .search-icon {
    color: #777777 !important;
}

#app #clearSearch {
    color: #777777 !important;
    background: transparent !important;
}

/* =========================================
   GRID / LIST BUTTONS
   ========================================= */

#app .view-switch,
#app .vigna-view-switch {
    display: flex !important;
    align-items: center !important;
    gap: 3px !important;
    padding: 3px !important;

    background: #f1f2f4 !important;
    border: 1px solid #e1e1e1 !important;
    border-radius: 20px !important;
}

#app .view-btn,
#app .view-toggle {
    width: 30px !important;
    height: 30px !important;

    color: #555555 !important;
    background: transparent !important;
    border: 0 !important;
    border-radius: 8px !important;
}

#app .view-btn.active,
#app .view-toggle.active {
    background: #87564b !important;
    color: #ffffff !important;
}

/* =========================================
   CATEGORY NAVIGATION
   ========================================= */

#app .category-navigation,
#app .m-chips {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;

    max-width: 100% !important;
    margin: 0 0 28px !important;
    padding: 10px 0 !important;

    overflow-x: auto !important;
    scrollbar-width: none !important;

    background: #ffffff !important;
    border: 0 !important;
    box-shadow: none !important;
}

#app .category-navigation::-webkit-scrollbar,
#app .m-chips::-webkit-scrollbar {
    display: none !important;
}

#app .category-pill,
#app .chip {
    display: inline-flex !important;
    flex: 0 0 auto !important;
    align-items: center !important;
    justify-content: center !important;
    flex-direction: column !important;
    gap: 4px !important;

    min-width: 70px !important;
    min-height: 63px !important;
    padding: 7px 10px !important;

    background: linear-gradient(
        145deg,
        #ffffff,
        #f5f5f5
    ) !important;

    color: #333333 !important;

    border: 1px solid #e0e0e0 !important;
    border-radius: 12px !important;

    box-shadow: 0 2px 7px rgba(0,0,0,.04) !important;

    font-size: 10px !important;
    font-weight: 750 !important;
    text-align: center !important;
    white-space: nowrap !important;
}

#app .category-pill.active,
#app .category-pill.on,
#app .chip.active,
#app .chip.on {
    background: #87564b !important;
    color: #ffffff !important;
    border-color: #87564b !important;

    box-shadow: 0 4px 12px rgba(0,0,0,.13) !important;
}

#app .category-pill > span,
#app .chip > span {
    color: inherit !important;
    opacity: 1 !important;
    visibility: visible !important;
}

/* CATEGORY EMOJIS — SMALLER THAN LABEL TEXT */

#app .category-pill .category-icon,
#app .chip .category-icon {
    display: block !important;
    flex: 0 0 8px !important;
    width: 8px !important;
    height: 8px !important;
    min-height: 8px !important;
    margin: 0 auto !important;
    padding: 0 !important;
    font-size: 6px !important;
    line-height: 8px !important;
    text-align: center !important;
    transform: none !important;
}

/* REMOVE DARK/BLACK BACKGROUNDS FROM CUSTOMER MENU */

html,
body,
body.menu-page,
body.menu-page #app,
#app,
#app main,
#app .menu-content,
#app #menuContent,
#app #sections,
#app .m-wrap,
#app .m-sec,
#app .menu-category,
#app .category-navigation,
#app .m-chips {
    background-color: #ffffff !important;
    color: #242424 !important;
    background-image: none !important;
}

/* KEEP MENU SECTIONS TRANSPARENT */

#app .m-wrap,
#app .m-sec,
#app .menu-content,
#app #menuContent,
#app #sections,
#app .menu-category {
    box-shadow: none !important;
}

/* =========================================
   MENU SECTIONS
   ========================================= */

#app .m-wrap {
    background: transparent !important;
}

#app .m-sec {
    margin-bottom: 20px !important;
    background: transparent !important;
}

#app .category-heading {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    width: 100% !important;
    margin-bottom: 14px !important;
}

#app .category-heading-left {
    display: flex !important;
    align-items: center !important;
    gap: 10px !important;
}

#app .category-heading h2,
#app .category-heading-left h2,
#app .m-sec h2 {
    display: block !important;
    margin: 0 !important;
    color: #252525 !important;
    font-size: 16px !important;
    font-weight: 850 !important;
    line-height: 1.4 !important;
    text-shadow: none !important;
    visibility: visible !important;
}

#app .category-count {
    display: block !important;
    margin-top: 3px !important;
    color: #777777 !important;
    font-size: 10px !important;
}

#app .category-accent {
    display: block !important;
    width: 4px !important;
    min-width: 4px !important;
    height: 27px !important;
    background: #87564b !important;
    border-radius: 5px !important;
}

/* VIEW ALL */

#app .view-all-btn,
#app .m-sec .view-all {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;

    min-width: 70px !important;
    min-height: 28px !important;
    padding: 5px 10px !important;

    background: #ffffff !important;
    color: #444444 !important;

    border: 1px solid #dddddd !important;
    border-radius: 9px !important;

    font-size: 10px !important;
    font-weight: 750 !important;

    opacity: 1 !important;
    visibility: visible !important;
}

/* =========================================
   FOOD GRID
   ========================================= */

#app .m-grid {
    display: grid !important;
    grid-template-columns: repeat(4,minmax(0,1fr)) !important;
    gap: 15px !important;
}

/* =========================================
   FOOD CARDS
   ========================================= */

#app .premium-food-card {
    overflow: hidden !important;

    background: #ffffff !important;
    border: 1px solid #e5e5e5 !important;
    border-radius: 14px !important;

    box-shadow: 0 3px 12px rgba(0,0,0,.045) !important;

    transition: transform .2s ease,box-shadow .2s ease !important;
}

#app .premium-food-card:hover {
    background: #ffffff !important;
    transform: translateY(-2px) !important;
    box-shadow: 0 7px 18px rgba(0,0,0,.08) !important;
}

/* SQUARE FOOD ITEM IMAGES — 1:1 */

#app .food-image-wrap,
#app .thumb {
    position: relative !important;
    width: 100% !important;
    height: auto !important;
    aspect-ratio: 1 / 1 !important;
    overflow: hidden !important;
    background: #eeeeee !important;
}

#app .food-image,
#app .thumb img {
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: 1 / 1 !important;
    object-fit: cover !important;
    object-position: center !important;
}

/* =========================================
   FOOD CARD DETAILS
   ========================================= */

#app .food-card-content {
    padding: 10px 12px !important;
    background: #ffffff !important;
}

#app .food-name {
    color: #292929 !important;
    font-size: 13px !important;
    font-weight: 800 !important;
}

#app .food-description {
    color: #777777 !important;
    font-size: 10px !important;
}

#app .food-price {
    color: #a6533d !important;
    font-size: 14px !important;
    font-weight: 850 !important;
}

/* =========================================
   ADD BUTTON
   ========================================= */

#app .menu-card-actions {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 6px !important;
    margin-top: 9px !important;
}

#app .order-add {
    background: linear-gradient(
        145deg,
        #ffffff,
        #f1f1f1
    ) !important;

    color: #414141 !important;
    border: 1px solid #dedede !important;
    border-radius: 9px !important;

    font-size: 10px !important;
    font-weight: 800 !important;
}

#app .order-add:hover {
    background: #fff8f5 !important;
    border-color: #87564b !important;
    color: #87564b !important;
}

/* =========================================
   ORDER NOW BUTTON
   ========================================= */

#app .order-now-btn {
    background: #87564b !important;
    color: #ffffff !important;

    border: 1px solid #87564b !important;
    border-radius: 9px !important;

    font-size: 10px !important;
    font-weight: 800 !important;
}

#app .order-now-btn:hover {
    background: #714438 !important;
}

/* =========================================
   QUANTITY CONTROL
   ========================================= */

#app .menu-qty-control {
    background: #f5f5f5 !important;
    color: #333333 !important;
    border: 1px solid #dedede !important;
    border-radius: 9px !important;
}

#app .menu-qty-control button {
    background: #ffffff !important;
    color: #333333 !important;
}

/* =========================================
   GRID / LIST VIEW
   ========================================= */

#app #sections.as-list .m-grid,
#app .m-grid.list-view {
    grid-template-columns: 1fr !important;
}

#app #sections.as-list .premium-food-card,
#app .m-grid.list-view .premium-food-card {
    display: grid !important;
    grid-template-columns: 145px minmax(0,1fr) !important;
}

#app #sections.as-list .food-image-wrap,
#app .m-grid.list-view .food-image-wrap {
    height: 100% !important;
    aspect-ratio: 4 / 3 !important;
}

/* =========================================
   CHECKOUT
   ========================================= */

.checkout-panel,
#checkoutSheet .checkout-panel {
    background: #ffffff !important;
    color: #292929 !important;
    border: 1px solid #e6e6e6 !important;
    border-radius: 20px !important;
    box-shadow: 0 18px 55px rgba(0,0,0,.16) !important;
}

#checkoutSheet input,
#checkoutSheet select,
#checkoutSheet textarea {
    background: #ffffff !important;
    color: #292929 !important;
    border: 1px solid #dedede !important;
}

#placeOrderForm .checkout-location-field[hidden] {
    display: none !important;
}

/* =========================================
   RECEIPT VISIBILITY
   ========================================= */

#vignaReceiptOverlay {
    position: fixed !important;
    inset: 0 !important;
    z-index: 999999 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    overflow-y: auto !important;
}

#vignaReceiptOverlay .receipt-hidden {
    display: none !important;
}

#vignaReceiptOverlay .receipt-mode {
    position: relative !important;
    z-index: 1000000 !important;
    max-height: 92vh !important;
    overflow-y: auto !important;
}

/* =========================================
   FLOATING VIEW CART — GRADIENT THEME
   ========================================= */

body.menu-page #cartBar,
#cartBar.cart-bar {
    position: fixed !important;
    z-index: 999999 !important;

    left: 50% !important;
    right: auto !important;
    bottom: max(12px, env(safe-area-inset-bottom)) !important;
    transform: translateX(-50%) !important;

    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;

    width: calc(100% - 30px) !important;
    max-width: 520px !important;
    min-height: 52px !important;

    padding: 10px 16px !important;

    background: linear-gradient(
        135deg,
        var(--theme, #f06423),
        var(--theme-dark, #bd4314)
    ) !important;

    color: #ffffff !important;
    border: none !important;
    border-radius: 12px !important;

    box-shadow: 0 6px 22px rgba(var(--theme-rgb,240,100,35),.30) !important;

    font-weight: 800 !important;
}

#cartBar .cart-bar-summary,
#cartBar .cart-bar-summary b,
#cartBar .cart-bar-summary small {
    color: #ffffff !important;
}

#cartBar > strong {
    background: rgba(255,255,255,.20) !important;
    color: #ffffff !important;
    border: 1px solid rgba(255,255,255,.25) !important;
    border-radius: 8px !important;
    padding: 8px 12px !important;
}

#cartBar[hidden],
#cartBar.cart-bar[hidden] {
    display: none !important;
}

/* =========================================
   MOBILE
   ========================================= */

@media (max-width: 600px) {

    #app {
        padding: 10px 12px 90px !important;
    }

    #app .m-hero {
        min-height: 150px !important;
        padding: 15px !important;
    }

    #app .hero-brand h1 {
        font-size: 26px !important;
    }

    #app .menu-toolbar {
        gap: 8px !important;
        margin: 10px 0 15px !important;
    }

    #app .category-navigation,
    #app .m-chips {
        gap: 7px !important;
        margin-bottom: 20px !important;
    }

    #app .category-pill,
    #app .chip {
        min-width: 70px !important;
        min-height: 62px !important;
    }

    #app .category-pill .category-icon,
    #app .chip .category-icon {
        width: 8px !important;
        height: 8px !important;
        min-height: 8px !important;
        font-size: 6px !important;
        line-height: 8px !important;
    }

    #app .m-grid {
        grid-template-columns: repeat(2,minmax(0,1fr)) !important;
        gap: 12px !important;
    }

    #app .food-card-content {
        padding: 9px !important;
    }

    #app .food-name {
        font-size: 12px !important;
    }

    #app .food-price {
        font-size: 13px !important;
    }

    #app .menu-card-actions {
        grid-template-columns: 1fr 1fr !important;
        gap: 5px !important;
    }

    #app .order-add,
    #app .order-now-btn {
        min-height: 31px !important;
        font-size: 9px !important;
    }

    #app #sections.as-list .premium-food-card,
    #app .m-grid.list-view .premium-food-card {
        grid-template-columns: 110px minmax(0,1fr) !important;
    }
}

/* =========================================
   SMALL MOBILE
   ========================================= */

@media (max-width: 360px) {

    #app {
        padding-left: 8px !important;
        padding-right: 8px !important;
    }

    #app .m-grid {
        gap: 8px !important;
    }
}

    `;
    }

    /* =========================================
   FOOD IMAGE CLICK PREVIEW
   ========================================= */

    function enableFoodImagePreview() {

        if (window.vignaImagePreviewEnabled) return;
        window.vignaImagePreviewEnabled = true;

        const style = document.createElement('style');

        style.textContent = `
        #vignaFoodImagePreview {
            position: fixed;
            inset: 0;
            z-index: 9999999;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: rgba(0,0,0,.88);
            backdrop-filter: blur(5px);
        }

        #vignaFoodImagePreview.active {
            display: flex;
        }

        #vignaFoodImagePreview img {
            display: block;
            max-width: 95%;
            max-height: 85vh;
            width: auto;
            height: auto;
            object-fit: contain;
            border-radius: 12px;
            background: #ffffff;
            box-shadow: 0 15px 50px rgba(0,0,0,.4);
            animation: vignaImageZoom .25s ease;
        }

       #vignaFoodImagePreview .vigna-image-close {
    position: fixed !important;
    top: 24px !important;
    right: 24px !important;

    width: 42px !important;
    height: 42px !important;
    padding: 0 !important;
    margin: 0 !important;

    display: flex !important;
    align-items: center !important;
    justify-content: center !important;

    border: none !important;
    border-radius: 50% !important;

    background: #444444 !important;
    color: #ffffff !important;

    font-family: Arial, sans-serif !important;
    font-size: 25px !important;
    font-weight: 600 !important;
    line-height: 1 !important;

    cursor: pointer !important;
    z-index: 10000001 !important;
    box-sizing: border-box !important;
}

#vignaFoodImagePreview .vigna-image-close:hover {
    background: #87564b !important;
}

@media (max-width: 600px) {
    #vignaFoodImagePreview .vigna-image-close {
        top: 15px !important;
        right: 15px !important;
        width: 38px !important;
        height: 38px !important;
    }
}

        #vignaFoodImagePreview .vigna-image-caption {
            position: absolute;
            bottom: 20px;
            left: 15px;
            right: 15px;
            color: #ffffff;
            text-align: center;
            font-size: 14px;
            font-weight: 700;
        }

        @keyframes vignaImageZoom {
            from {
                opacity: 0;
                transform: scale(.88);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }

        #app .food-image,
        #app .thumb img {
            cursor: zoom-in !important;
        }

        @media(max-width:600px) {
            #vignaFoodImagePreview img {
                max-width: 100%;
                max-height: 78vh;
            }

        }
    `;

        document.head.appendChild(style);

        const preview = document.createElement('div');

        preview.id = 'vignaFoodImagePreview';

        preview.innerHTML = `
        <button type="button"
                class="vigna-image-close"
                aria-label="Close image preview">
            &times;
        </button>

        <img src="" alt="Food image preview">

        <div class="vigna-image-caption"></div>
    `;

        document.body.appendChild(preview);

        const previewImage = preview.querySelector('img');
        const caption = preview.querySelector('.vigna-image-caption');
        const closeButton = preview.querySelector('.vigna-image-close');

        function closePreview() {
            preview.classList.remove('active');
            previewImage.src = '';
            document.body.style.overflow = '';
        }

        // Open image when a food image is clicked
        document.addEventListener('click', function (event) {

            const image = event.target.closest(
                '#app .food-image, #app .thumb img'
            );

            if (!image) return;

            event.preventDefault();
            event.stopPropagation();

            const imageURL = image.currentSrc || image.src;

            if (!imageURL) return;

            previewImage.src = imageURL;
            previewImage.alt = image.alt || 'Food image preview';

            const card = image.closest('.premium-food-card, .m-card');

            const nameElement = card?.querySelector(
                '.food-name, .nm'
            );

            caption.textContent = nameElement
                ? nameElement.textContent.trim()
                : '';

            preview.classList.add('active');
            document.body.style.overflow = 'hidden';

        }, true);

        // Close button
        closeButton.addEventListener('click', closePreview);

        // Close when clicking outside the image
        preview.addEventListener('click', function (event) {
            if (event.target === preview) {
                closePreview();
            }
        });

        // Close using Escape key
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && preview.classList.contains('active')) {
                closePreview();
            }
        });
    }


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

            '<label>Customer name',
            '<input id="customerName" name="customer" type="text" required minlength="2" maxlength="80" autocomplete="name" placeholder="Your name">',
            '</label>',

            '<label>Mobile number',
            '<input name="phone" type="tel" required maxlength="30" autocomplete="tel" inputmode="tel" placeholder="Mobile number">',
            '</label>',

            '<label>Order type',
            '<select name="order_type" id="orderType" required>',
            '<option value="Dine In">Dine In</option>',
            '<option value="Takeaway">Takeaway</option>',
            '<option value="Delivery">Delivery</option>',
            '<option value="Room Service">Room Service</option>',
            '</select>',
            '</label>',

            // DINE IN: TABLE NUMBER
            '<label class="checkout-location-field" id="tableField">',
            'Table number',
            '<input name="table_no" id="tableNo" type="text" required maxlength="30" placeholder="Enter table number">',
            '</label>',

            // ROOM SERVICE: ROOM NUMBER
            '<label class="checkout-location-field" id="roomField" hidden>',
            'Room number',
            '<input name="room_no" id="roomNo" type="text" maxlength="30" placeholder="Enter room number">',
            '</label>',

            // DELIVERY: DELIVERY ADDRESS
            '<label class="checkout-location-field" id="deliveryField" hidden>',
            'Delivery address',
            '<textarea name="delivery_address" id="deliveryAddress" maxlength="200" rows="2" placeholder="Enter complete delivery address"></textarea>',
            '</label>',

            '<label>Special instructions (optional)',
            '<textarea name="note" maxlength="500" rows="3" placeholder="Allergies or other requests"></textarea>',
            '</label>',

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

        const modal = currentCheckout;
        const container = $('#checkoutLines', modal);

        if (!container) return;

        container.innerHTML = [...cart.values()].map(item => [
            '<div class="checkout-line">',
            '<div class="checkout-line-info"><b>',
            escapeHTML(item.name),
            '</b><div class="muted">',
            money(item.price),
            ' each</div></div>',
            '<div class="checkout-qty">',
            '<button type="button" data-checkout-dec="',
            escapeHTML(item.id),
            '" aria-label="Decrease quantity">−</button>',
            '<span aria-live="polite">',
            String(item.qty),
            '</span>',
            '<button type="button" data-checkout-inc="',
            escapeHTML(item.id),
            '" aria-label="Increase quantity">+</button>',
            '</div>',
            '<strong>',
            money(item.price * item.qty),
            '</strong>',
            '</div>'
        ].join('')).join('');

        $('#subtotalValue', modal).textContent = money(subtotal());
        $('#taxValue', modal).textContent = money(taxAmount());
        $('#totalValue', modal).textContent = money(payableTotal());

        const confirmButton = $('#confirmOrder', modal);

        if (confirmButton && !confirmButton.disabled) {
            confirmButton.textContent =
                'Confirm Order · ' + money(payableTotal());
        }

        updateOrderTypeFields();
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

        const form = document.getElementById('placeOrderForm')
            || document.getElementById('vigna-checkout-form')
            || event.target.closest('form');

        if (!(form instanceof HTMLFormElement)) {
            console.error('Checkout form not found or invalid:', form);
            alert('Unable to process checkout. Please refresh and try again.');
            return;
        }

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }
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
        try {
            // Remove any previous receipt.
            document.getElementById('vignaReceiptOverlay')?.remove();

            const restaurant = data.restaurant || {};

            const overlay = document.createElement('div');

            overlay.id = 'vignaReceiptOverlay';
            overlay.className = 'checkout-overlay';

            overlay.innerHTML = [
                '<section class="checkout-panel receipt-mode">',

                // Receipt printer animation
                '<div class="receipt-animation-wrap" id="receiptAnimation">',

                '<section class="receipt-printer-stage">',

                '<div class="printer-brand">VIGNADIGITAL</div>',

                '<div class="receipt-printing-paper">',

                restaurant.logo
                    ? '<img class="receipt-icon" src="' +
                    escapeHTML(restaurant.logo) +
                    '" width="48" alt="">'
                    : '',

                '<h2>' + escapeHTML(restaurant.name || 'Restaurant') + '</h2>',

                '<p>ORDER CONFIRMED</p>',

                '<p>Order #' +
                escapeHTML(data.order_number || data.order_no || '') +
                '</p>',

                '<p>Printing your receipt…</p>',

                '</div>',

                '<div class="printer-machine">',
                '<span></span>THERMAL RECEIPT PRINTER',
                '</div>',

                '<div class="printer-icon">🧾</div>',

                '</section>',

                '</div>',

                // Final animated receipt
                '<div id="receiptResult" class="receipt-hidden">',

                receiptHTML(data),

                '<div class="receipt-actions">',

                '<button type="button" id="printReceipt">',
                'Print Receipt',
                '</button>',

                '<button type="button" class="receipt-secondary" id="backMenu">',
                'Back to Menu',
                '</button>',

                '</div>',

                '<p class="order-status" id="liveStatus">Status: Pending</p>',

                '</div>',

                '</section>'
            ].join('');

            if (receiptPreviousBodyOverflow === null) {
                receiptPreviousBodyOverflow = document.body.style.overflow;
            }

            // Add receipt above the entire menu.
            document.body.appendChild(overlay);

            document.body.style.overflow = 'hidden';

            // Start receipt animation.
            const animation = document.getElementById('receiptAnimation');
            const result = document.getElementById('receiptResult');

            if (!animation || !result) {
                throw new Error('Receipt animation elements could not be created.');
            }

            window.setTimeout(() => {
                if (!overlay.isConnected) return;

                animation.remove();

                result.classList.remove('receipt-hidden');

                // Ensure receipt is visible.
                result.style.display = 'block';

                result.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });

            }, 2200);

            console.log('[Vigna] Receipt displayed successfully.');

        } catch (error) {
            console.error('[Vigna] Receipt display error:', error);

            showCustomerNotification(
                'Your order was placed successfully, but the receipt could not be displayed.',
                'error'
            );
        }
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
        enableFoodImagePreview();
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
