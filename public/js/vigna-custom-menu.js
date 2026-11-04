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
    let currentCheckout = null;

    let categoryObserver = null;
    let categoryLockUntil = 0;

    /* =========================================================
       MENU DATA HELPERS
       ========================================================= */

    function getRestaurant() {
        return menuData?.restaurant || {};
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
        return item.image_url ||
            item.image ||
            item.photo ||
            item.imageUrl ||
            '';
    }

    function isItemAvailable(item) {
        return !(
            item.available === false ||
            item.is_available === false ||
            item.availability === false ||
            item.status === 'unavailable' ||
            item.status === 'out_of_stock'
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
        return [...cart.values()].reduce(
            (sum, item) => sum + item.price * item.qty,
            0
        );
    }

    function taxAmount() {
        return Math.round(subtotal() * 5) / 100;
    }

    function payableTotal() {
        return subtotal() + taxAmount();
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

        if (
            !data ||
            !data.restaurant ||
            !Array.isArray(data.categories)
        ) {
            throw new Error('Invalid menu response from server.');
        }

        // Store the latest menu data.
        menuData = data;

        const restaurant = getRestaurant();

        // Update browser title.
        document.title = `${restaurant.name || 'Menu'} · Menu`;

        // Get the restaurant's saved theme color.
        const themeColor =
            /^#[0-9a-fA-F]{6}$/.test(
                String(restaurant.theme_color || '')
            )
                ? restaurant.theme_color
                : '#d9480f';

        // Apply restaurant theme.
        applyRestaurantTheme(themeColor);

        // Keep theme available to custom menu integrations.
        window.VIGNA_THEME = themeColor;

        // Update browser theme color.
        const themeMeta = document.querySelector('#themeMeta');

        if (themeMeta) {
            themeMeta.setAttribute('content', themeColor);
        }

        // Render customer menu.
        renderMenu();

        // Store current ordering status.
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

        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

        const textColor = luminance > 0.62 ? '#211711' : '#ffffff';

        const root = document.documentElement;

        root.style.setProperty('--theme', validColor);
        root.style.setProperty('--theme-dark',
            `color-mix(in srgb, ${validColor} 78%, #000000)`
        );
        root.style.setProperty('--theme-light',
            `color-mix(in srgb, ${validColor} 14%, #ffffff)`
        );
        root.style.setProperty('--theme-soft',
            `color-mix(in srgb, ${validColor} 8%, #ffffff)`
        );
        root.style.setProperty('--theme-border',
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
                class="m-card order-card"
                data-item="${escapeHTML(id)}"
            >

                ${image
                ? `
                            <div class="thumb">
                                <img
                                    src="${escapeHTML(image)}"
                                    alt="${escapeHTML(name)}"
                                    loading="lazy"
                                    decoding="async"
                                >
                            </div>
                        `
                : `
                            <div class="thumb" aria-hidden="true">
                                ${escapeHTML(name.charAt(0).toUpperCase())}
                            </div>
                        `
            }

                <div class="b">

                    <div class="nm">
                        ${escapeHTML(name)}
                    </div>

                    ${item.description
                ? `
                                <div class="ds">
                                    ${escapeHTML(item.description)}
                                </div>
                            `
                : ''
            }

                    <div class="pr">
                        ${money(price)}
                    </div>

                    ${!available
                ? `
                                <span class="item-unavailable">
                                    Currently unavailable
                                </span>
                            `
                : enabled
                    ? `
                                    <div class="menu-card-actions">

    <button
        class="order-add"
        type="button"
        data-add="${escapeHTML(id)}"
    >
        ${cartItem
                        ? `Added · ${cartItem.qty}`
                        : '+ Add'
                    }
    </button>

    <button
        class="order-now-btn"
        type="button"
        data-order-now="${escapeHTML(id)}"
    >
        Order Now
    </button>

</div>
                                `
                    : ''
            }

                </div>

            </article>
        `;
    }

    /* =========================================================
       MENU RENDERING
       ========================================================= */

    function renderMenu(filter = '') {
        if (!menuData) return;

        const app = $('#app');

        if (!app) return;

        const query = normalize(filter);

        const categories = getCategories()
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

        app.innerHTML = `
            <header class="m-hero">

                ${getRestaurant().logo
                ? `
                            <img
                                src="${escapeHTML(getRestaurant().logo)}"
                                alt=""
                            >
                        `
                : ''
            }

                <h1>
                    ${escapeHTML(getRestaurant().name || 'Menu')}
                </h1>

                ${getRestaurant().tagline
                ? `<p>${escapeHTML(getRestaurant().tagline)}</p>`
                : ''
            }

                ${getRestaurant().city
                ? `<div class="small">${escapeHTML(getRestaurant().city)}</div>`
                : ''
            }

            </header>

            <div class="m-bar">

                <div class="m-search">

                    <input
                        type="search"
                        id="q"
                        placeholder="Search dishes"
                        aria-label="Search dishes"
                        autocomplete="off"
                        value="${escapeHTML(filter)}"
                    >

                    <div id="layout"></div>

                </div>

                <div
                    class="m-chips"
                    id="chips"
                    role="tablist"
                ></div>

            </div>

            <main class="m-wrap" id="sections">

                ${categories.length
                ? categories.map(category => `
                            <section
                                class="m-sec"
                                id="cat-${escapeHTML(category.id ?? normalize(category.name))}"
                                data-cat="${escapeHTML(category.id ?? normalize(category.name))}"
                            >

                                <h2>
                                    ${escapeHTML(category.name || 'Menu')}

                                    <span>
                                        ${category.items.length}
                                        item${category.items.length === 1 ? '' : 's'}
                                    </span>
                                </h2>

                                <div class="m-grid">
                                    ${category.items.map(renderItemCard).join('')}
                                </div>

                            </section>
                        `).join('')
                : `
                            <p class="muted" style="text-align:center;padding:48px 0">
                                ${query
                    ? 'No dishes match your search.'
                    : 'The menu is being updated. Please check back soon.'
                }
                            </p>
                        `
            }

            </main>

            <footer class="m-foot">

                ${getRestaurant().address
                ? escapeHTML(getRestaurant().address) + '<br>'
                : ''
            }

                ${getRestaurant().phone
                ? `
                            <a href="tel:${escapeHTML(getRestaurant().phone)}">
                                ${escapeHTML(getRestaurant().phone)}
                            </a>
                        `
                : ''
            }

            </footer>
        `;

        renderCategoryChips(categories);

        setupSearch();
        setupViewToggle();
        setupCategoryObserver();

        updateCartBar();
    }

    /* =========================================================
       CATEGORY NAVIGATION
       ========================================================= */

    function renderCategoryChips(categories) {
        const chips = $('#chips');

        if (!chips) return;

        chips.innerHTML = categories.map((category, index) => {
            const id = String(
                category.id ?? normalize(category.name)
            );

            return `
                <button
                    class="chip ${index === 0 ? 'on' : ''}"
                    data-cat="${escapeHTML(id)}"
                    type="button"
                >
                    ${escapeHTML(category.name)}
                </button>
            `;
        }).join('');

        chips.addEventListener('click', event => {
            const button = event.target.closest('.chip');

            if (!button) return;

            const id = button.dataset.cat;

            categoryLockUntil = Date.now() + 1200;

            setActiveCategory(id);

            const section = $$('[data-cat]', $('#sections'))
                .find(node => node.dataset.cat === id);

            section?.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        });
    }

    function setActiveCategory(id) {
        $$('.chip').forEach(chip => {
            chip.classList.toggle(
                'on',
                chip.dataset.cat === String(id)
            );
        });

        const active = $('.chip.on');

        active?.scrollIntoView({
            inline: 'center',
            block: 'nearest',
            behavior: 'smooth'
        });
    }

    function setupCategoryObserver() {
        categoryObserver?.disconnect();

        if (!('IntersectionObserver' in window)) return;

        categoryObserver = new IntersectionObserver(entries => {
            if (Date.now() < categoryLockUntil) return;

            const visible = entries
                .filter(entry => entry.isIntersecting)
                .sort((a, b) =>
                    a.boundingClientRect.top -
                    b.boundingClientRect.top
                )[0];

            if (visible) {
                setActiveCategory(
                    visible.target.dataset.cat
                );
            }

        }, {
            rootMargin: '-120px 0px -65% 0px'
        });

        $$('.m-sec').forEach(section => {
            categoryObserver.observe(section);
        });
    }

    /* =========================================================
       SEARCH
       ========================================================= */

    function setupSearch() {
        const search = $('#q');

        if (!search) return;

        search.addEventListener('input', () => {
            const value = search.value;

            const cursor = search.selectionStart;

            renderMenu(value);

            const newSearch = $('#q');

            if (newSearch) {
                newSearch.focus();
                newSearch.setSelectionRange(cursor, cursor);
            }
        });
    }

    /* =========================================================
       VIEW TOGGLE
       ========================================================= */

    function setupViewToggle() {
        const layout = $('#layout');

        if (!layout) return;

        layout.innerHTML = `
        <div class="vigna-view-switch">

            <button
                type="button"
                class="view-toggle active"
                id="vigna-grid-view"
                aria-label="Grid view"
                title="Grid view"
            >
                <svg viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="7" height="7" rx="1"/>
                    <rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/>
                    <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
            </button>

            <button
                type="button"
                class="view-toggle"
                id="vigna-list-view"
                aria-label="List view"
                title="List view"
            >
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M8 6H21"/>
                    <path d="M8 12H21"/>
                    <path d="M8 18H21"/>
                    <circle cx="3.5" cy="6" r="0.8"/>
                    <circle cx="3.5" cy="12" r="0.8"/>
                    <circle cx="3.5" cy="18" r="0.8"/>
                </svg>
            </button>

        </div>
    `;

        const gridButton = $('#vigna-grid-view');
        const listButton = $('#vigna-list-view');

        gridButton.onclick = () => {
            $('#sections')?.classList.remove('as-list');

            gridButton.classList.add('active');
            listButton.classList.remove('active');
        };

        listButton.onclick = () => {
            $('#sections')?.classList.add('as-list');

            listButton.classList.add('active');
            gridButton.classList.remove('active');
        };
    }

    /* =========================================================
       CART ADD / REMOVE
       ========================================================= */

    function addToCart(id) {
        if (!orderingEnabled()) {
            alert('Online ordering is currently unavailable.');
            return;
        }

        const item = getItems().find(
            entry => getItemId(entry) === String(id)
        );

        if (!item || !isItemAvailable(item)) {
            alert('This item is currently unavailable.');
            return;
        }

        const key = getItemId(item);

        const existing = cart.get(key);

        if (existing) {
            existing.qty = Math.min(20, existing.qty + 1);
        } else {
            cart.set(key, {
                id: key,
                name: getItemName(item),
                price: getItemPrice(item),
                qty: 1
            });
        }

        updateCartBar();

        updateAddButtons();
    }
    function orderNow(id) {
        addToCart(id);

        if (cart.has(String(id))) {
            openCheckout();
        }
    }

    function updateAddButtons() {
        $$('[data-add]').forEach(button => {
            const item = cart.get(String(button.dataset.add));

            button.textContent = item
                ? `Added · ${item.qty}`
                : '＋ Add to cart';

            button.hidden = !orderingEnabled();
        });
    }

    /* =========================================================
       CART BAR
       ========================================================= */

    function updateCartBar() {
        let bar = $('#cartBar');

        if (!bar) {
            bar = document.createElement('button');

            bar.id = 'cartBar';
            bar.className = 'cart-bar';
            bar.type = 'button';

            document.body.appendChild(bar);
        }

        const enabled = orderingEnabled();

        bar.hidden = !enabled || cartCount() === 0;

        bar.disabled = !enabled || cartCount() === 0;

        bar.innerHTML = `
            <span>
                ${cartCount()}
                item${cartCount() === 1 ? '' : 's'}
                · ${money(subtotal())}

                <small style="display:block;font-weight:400;opacity:.9">
                    Review your items and confirm your order
                </small>
            </span>

            <strong>View Cart / Order →</strong>
        `;

        bar.onclick = openCheckout;
    }


    /* =========================================================
       CHECKOUT
       ========================================================= */

    function openCheckout() {
        if (!orderingEnabled() || !cartCount()) return;

        $('#checkoutSheet')?.remove();

        const overlay = document.createElement('div');

        overlay.className = 'checkout-overlay';
        overlay.id = 'checkoutSheet';

        currentCheckout = overlay;

        overlay.innerHTML = `
            <section class="checkout-panel">

                <button
                    type="button"
                    class="checkout-close"
                    aria-label="Close"
                >
                    ✕
                </button>

                <h2>Your Order</h2>

                <div id="checkoutLines"></div>

                <div class="checkout-totals">

                    <div>
                        <span>Food Subtotal</span>
                        <strong id="subtotalValue"></strong>
                    </div>

                    <div>
                        <span>Tax (5%)</span>
                        <strong id="taxValue"></strong>
                    </div>

                    <div class="checkout-total">
                        <span>Total</span>
                        <strong id="totalValue"></strong>
                    </div>

                </div>

                <form id="placeOrderForm">

                    <label>
                        Your name
                        <input
                            name="customer"
                            required
                            maxlength="100"
                            autocomplete="name"
                        >
                    </label>

                    <label>
                        Mobile number
                        <input
                            name="phone"
                            required
                            maxlength="30"
                            autocomplete="tel"
                            inputmode="tel"
                        >
                    </label>

                    <label>
                        Order type

                        <select name="order_type" id="orderType" required>
                            <option value="Dine In">Dine In</option>
                            <option value="Takeaway">Takeaway</option>
                            <option value="Delivery">Delivery</option>
                            <option value="Room Service">Room Service</option>
                        </select>
                    </label>

                    <label id="tableField">

                        <span id="tableFieldLabel">
                            Table Number
                        </span>

                        <input
                            name="table_no"
                            id="tableNo"
                            required
                            maxlength="300"
                            placeholder="Enter table number"
                        >

                    </label>

                    <label>
                        Special instructions (optional)

                        <textarea
                            name="note"
                            maxlength="500"
                            placeholder="Special instructions"
                        ></textarea>
                    </label>

                    <button
                        class="place-order"
                        type="submit"
                    >
                        Confirm Order
                    </button>

                    <p class="muted checkout-hint">
                        Confirm to generate your animated order receipt.
                    </p>

                    <div id="orderMessage" role="status"></div>

                </form>

            </section>
        `;

        document.body.appendChild(overlay);

        document.body.style.overflow = 'hidden';

        renderCheckoutLines();

        overlay.querySelector('.checkout-close').onclick =
            closeCheckout;

        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                closeCheckout();
            }
        });

        const orderType = $('#orderType', overlay);
        const tableNo = $('#tableNo', overlay);
        const tableLabel = $('#tableFieldLabel', overlay);
        const tableField = $('#tableField', overlay);

        function updateOrderType() {
            const type = orderType.value;

            tableNo.value = '';
            tableField.hidden = false;
            tableNo.required = true;

            if (type === 'Dine In') {
                tableLabel.textContent = 'Table Number';
                tableNo.placeholder = 'Enter table number';
                tableNo.name = 'table_no';
            }

            if (type === 'Room Service') {
                tableLabel.textContent = 'Room Number';
                tableNo.placeholder = 'Enter room number';
                tableNo.name = 'room_no';
            }

            if (type === 'Delivery') {
                tableLabel.textContent = 'Delivery Address';
                tableNo.placeholder = 'Enter complete delivery address';
                tableNo.name = 'delivery_address';
            }

            if (type === 'Takeaway') {
                tableField.hidden = true;
                tableNo.required = false;
                tableNo.name = 'table_no';
            }
        }

        orderType.addEventListener('change', updateOrderType);

        updateOrderType();

        overlay.addEventListener('click', event => {
            const decrease = event.target.closest('[data-dec]');
            const increase = event.target.closest('[data-inc]');

            if (!decrease && !increase) return;

            const id = String(
                (decrease || increase).dataset[
                decrease ? 'dec' : 'inc'
                ]
            );

            const item = cart.get(id);

            if (!item) return;

            if (decrease) {
                item.qty--;

                if (item.qty <= 0) {
                    cart.delete(id);
                }
            } else {
                item.qty = Math.min(20, item.qty + 1);
            }

            if (!cartCount()) {
                closeCheckout();
                updateCartBar();
                return;
            }

            renderCheckoutLines();
            updateCartBar();
        });

        $('#placeOrderForm', overlay).addEventListener(
            'submit',
            submitOrder
        );
    }

    function renderCheckoutLines() {
        if (!currentCheckout) return;

        const lines = $('#checkoutLines', currentCheckout);

        if (!lines) return;

        lines.innerHTML = [...cart.values()].map(item => `
            <div class="checkout-line">

                <div>
                    <b>${escapeHTML(item.name)}</b>
                    <div class="muted">${money(item.price)} each</div>
                </div>

                <div class="checkout-qty">

                    <button
                        type="button"
                        data-dec="${escapeHTML(item.id)}"
                    >−</button>

                    <span>${item.qty}</span>

                    <button
                        type="button"
                        data-inc="${escapeHTML(item.id)}"
                    >+</button>

                </div>

                <b>${money(item.price * item.qty)}</b>

            </div>
        `).join('');

        $('#subtotalValue', currentCheckout).textContent =
            money(subtotal());

        $('#taxValue', currentCheckout).textContent =
            money(taxAmount());

        $('#totalValue', currentCheckout).textContent =
            money(payableTotal());
    }

    function closeCheckout() {
        $('#checkoutSheet')?.remove();

        currentCheckout = null;

        document.body.style.overflow = '';
    }

    /* =========================================================
       ORDER SUBMISSION
       ========================================================= */

    async function submitOrder(event) {
        event.preventDefault();

        if (!orderingEnabled()) {
            alert('Online ordering is currently unavailable.');
            closeCheckout();
            return;
        }

        if (!cartCount()) {
            alert('Your cart is empty.');
            return;
        }

        const form = event.currentTarget;

        if (!form.reportValidity()) return;

        const button = form.querySelector('[type="submit"]');
        const message = $('#orderMessage', currentCheckout);

        button.disabled = true;
        button.textContent = 'Placing order...';

        message.textContent = '';

        const formData = new FormData(form);

        const orderType = String(
            formData.get('order_type') || 'Dine In'
        );

        const locationValue = String(
            formData.get('table_no') ||
            formData.get('room_no') ||
            formData.get('delivery_address') ||
            ''
        ).trim();

        const items = [...cart.values()].map(item => ({
            id: item.id,
            item_id: item.id,
            name: item.name,
            price: item.price,
            qty: item.qty,
            quantity: item.qty,
            subtotal: item.price * item.qty
        }));

        const payload = {
            slug: getRestaurant().slug || slug,

            customer: String(
                formData.get('customer') || ''
            ).trim(),

            customer_name: String(
                formData.get('customer') || ''
            ).trim(),

            phone: String(
                formData.get('phone') || ''
            ).trim(),

            order_type: orderType,

            table_no: orderType === 'Dine In'
                ? locationValue
                : '',

            room_no: orderType === 'Room Service'
                ? locationValue
                : '',

            delivery_address: orderType === 'Delivery'
                ? locationValue
                : '',

            note: String(
                formData.get('note') || ''
            ).trim(),

            items,

            subtotal: subtotal(),
            tax: taxAmount(),
            tax_rate: 5,
            total: payableTotal()
        };

        try {
            const response = await apiRequest(
                `${API}/public/orders`,
                {
                    method: 'POST',
                    body: JSON.stringify(payload)
                }
            );

            const order = response.order ||
                response.data ||
                response;

            const orderId =
                order.id ||
                order._id ||
                order.order_id;

            const orderNumber =
                order.order_no ||
                order.order_number ||
                order.orderNumber ||
                orderId ||
                'Pending';
            const restaurantData = getRestaurant();

            const receiptData = {
                ...payload,
                ...order,

                id: orderId,
                order_number: orderNumber,

                items: Array.isArray(order.items) &&
                    order.items.length
                    ? order.items
                    : items,

                subtotal: order.subtotal ?? payload.subtotal,
                tax: order.tax ?? payload.tax,
                total: order.total ?? payload.total,

                restaurant: {
                    ...restaurantData,

                    upi_id: restaurantData.upi_id || '',

                    upi_qr_image: restaurantData.upi_qr_image || ''
                }
            };

            cart.clear();

            closeCheckout();

            updateCartBar();

            showReceipt(receiptData);

            if (orderId) {
                listenForOrderUpdates(orderId, orderNumber);
            }

        } catch (error) {
            console.error('Vigna order error:', error);

            message.textContent =
                error.message || 'Unable to place order.';

            button.disabled = false;
            button.textContent = 'Confirm Order';
        }
    }
    /* =========================================================
       RECEIPT
       ========================================================= */

    function receiptItemRows(items) {
        return (items || []).map(item => {
            const quantity = Number(
                item.quantity ?? item.qty ?? 1
            );

            const price = Number(item.price || 0);

            const amount = Number(
                item.line_total ??
                item.subtotal ??
                price * quantity
            );

            return `
            <div class="receipt-row">
                <span>
                    ${escapeHTML(item.name || item.item_name || 'Item')}
                </span>

                <span>${quantity}</span>

                <span>${money(price)}</span>

                <strong>${money(amount)}</strong>
            </div>
        `;
        }).join('');
    }


    /* =========================================================
       RESTAURANT UPI QR
       ========================================================= */

    function getReceiptUPI(restaurant = {}) {
        const qrImage = String(
            restaurant.upi_qr_image || ''
        ).trim();

        const upiId = String(
            restaurant.upi_id || ''
        ).trim();

        // Do not show an empty payment section.
        if (!qrImage && !upiId) {
            return '';
        }

        return `
        <section class="receipt-upi">

            <h3>SCAN & PAY</h3>

            ${qrImage
                ? `
                        <img
                            class="receipt-upi-image"
                            src="${escapeHTML(qrImage)}"
                            alt="Restaurant UPI QR Code"
                            loading="eager"
                            onerror="this.style.display='none'; this.parentElement.classList.add('qr-error');"
                        >
                    `
                : `
                        <div class="receipt-qr-missing">
                            QR image not available
                        </div>
                    `
            }

            ${upiId
                ? `
                        <div class="receipt-upi-id">
                            UPI ID: ${escapeHTML(upiId)}
                        </div>
                    `
                : ''
            }

            <small>Scan the QR code to make payment</small>

        </section>
    `;
    }


    /* =========================================================
       RECEIPT HTML
       ========================================================= */

    function receiptHTML(data) {

        const restaurant = data.restaurant || {};

        const type = data.order_type || '';

        const location =
            type === 'Dine In'
                ? data.table_no
                : type === 'Room Service'
                    ? data.room_no
                    : type === 'Delivery'
                        ? data.delivery_address
                        : '';

        const locationLabel =
            type === 'Dine In'
                ? 'Table No.'
                : type === 'Room Service'
                    ? 'Room No.'
                    : 'Delivery Address';

        return `
        <div class="receipt-final-paper" id="receiptFinalPaper">

            <!-- RESTAURANT HEADER -->

            <header class="receipt-head">

                ${restaurant.logo
                ? `
                            <img
                                class="receipt-icon"
                                src="${escapeHTML(restaurant.logo)}"
                                alt="Restaurant Logo"
                            >
                        `
                : ''
            }

                <h2>
                    ${escapeHTML(restaurant.name || 'Restaurant')}
                </h2>

                <p>${escapeHTML(restaurant.address || '')}</p>

                <p>${escapeHTML(restaurant.phone || '')}</p>

                <p class="receipt-label">
                    ORDER RECEIPT
                </p>

            </header>


            <!-- ORDER DETAILS -->

            <div class="receipt-meta">

                <div class="meta-line">
                    <span>Order No</span>
                    <span>:</span>
                    <strong>
                        ${escapeHTML(data.order_number || 'Pending')}
                    </strong>
                </div>

                <div class="meta-line">
                    <span>Date</span>
                    <span>:</span>
                    <span>
                        ${escapeHTML(new Date().toLocaleString('en-IN'))}
                    </span>
                </div>

                <div class="meta-line">
                    <span>Customer</span>
                    <span>:</span>
                    <span>
                        ${escapeHTML(data.customer || data.customer_name || '')}
                    </span>
                </div>

                <div class="meta-line">
                    <span>Phone</span>
                    <span>:</span>
                    <span>${escapeHTML(data.phone || '')}</span>
                </div>

                <div class="meta-line">
                    <span>Order Type</span>
                    <span>:</span>
                    <span>${escapeHTML(type)}</span>
                </div>

                ${location
                ? `
                            <div class="meta-line">
                                <span>${escapeHTML(locationLabel)}</span>
                                <span>:</span>
                                <span>${escapeHTML(location)}</span>
                            </div>
                        `
                : ''
            }

            </div>


            <!-- ORDER ITEMS -->

            <div class="receipt-items">

                <div class="receipt-table-head">
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Price</span>
                    <span>Total</span>
                </div>

                ${receiptItemRows(data.items) || ''}

            </div>


            <!-- BILL SUMMARY -->

            <div class="receipt-summary-line">
                <span>Food Subtotal</span>
                <strong>${money(data.subtotal)}</strong>
            </div>

            <div class="receipt-summary-line">
                <span>Tax (5%)</span>
                <strong>${money(data.tax)}</strong>
            </div>

            <div class="receipt-total">
                <span>GRAND TOTAL</span>
                <strong>${money(data.total)}</strong>
            </div>

            <!-- UPI QR - ONLY INSIDE THE RECEIPT -->
                ${getReceiptUPI(restaurant)}


            <!-- FOOTER -->

            <footer class="receipt-foot">

                <strong>Thank you for ordering!</strong>

                <div>We will confirm your order shortly.</div>

                <div class="leaf-divider">◆</div>

                <strong>
                    ${escapeHTML(restaurant.name || '')}
                </strong>

                <div>Good Food Brings People Together</div>

                <div class="receipt-hearts">♥ ♥ ♥</div>

                <div>Powered by VignaDigital</div>

            </footer>

        </div>
    `;
    }


    /* =========================================================
       SHOW ANIMATED RECEIPT
       ========================================================= */

    function showReceipt(data) {

        $('#vignaReceiptOverlay')?.remove();

        const overlay = document.createElement('div');

        overlay.id = 'vignaReceiptOverlay';
        overlay.className = 'checkout-overlay';

        overlay.innerHTML = `
        <section class="checkout-panel receipt-mode">

            <!-- RECEIPT PRINTING ANIMATION -->

            <div
                class="receipt-animation-wrap"
                id="receiptAnimation"
            >

                <section class="receipt-printer-stage">

                    <div class="printer-brand">
                        VIGNADIGITAL
                    </div>

                    <div class="receipt-printing-paper">

                        ${data.restaurant?.logo
                ? `
                                    <img
                                        src="${escapeHTML(data.restaurant.logo)}"
                                        width="48"
                                        alt=""
                                    >
                                `
                : ''
            }

                        <h2>
                            ${escapeHTML(data.restaurant?.name || 'Restaurant')}
                        </h2>

                        <p>ORDER CONFIRMED</p>

                        <p>
                            Order #${escapeHTML(data.order_number || '')}
                        </p>

                        <p>Printing your receipt...</p>

                    </div>

                    <div class="printer-machine">
                        <span></span>
                        THERMAL RECEIPT PRINTER
                    </div>

                    <div class="printer-icon">🧾</div>

                </section>

            </div>


            <!-- FINAL RECEIPT -->

            <div id="receiptResult" class="receipt-hidden">

                ${receiptHTML(data)}

                <div class="receipt-actions">

                    <button
                        type="button"
                        id="printReceipt"
                    >
                        Print Receipt
                    </button>

                    <button
                        type="button"
                        class="receipt-secondary"
                        id="backMenu"
                    >
                        Back to Menu
                    </button>

                </div>

                <p class="order-status" id="liveStatus">
                    Status: Pending
                </p>

            </div>

        </section>
    `;

        document.body.appendChild(overlay);

        document.body.style.overflow = 'hidden';


        // Back to menu

        $('#backMenu', overlay).onclick = () => {

            overlay.remove();

            document.body.style.overflow = '';

            currentOrderEventSource?.close();

            currentOrderEventSource = null;
        };


        // Print receipt

        $('#printReceipt', overlay).onclick = () => {
            printReceipt();
        };


        // Show final receipt after animation

        window.setTimeout(() => {

            $('#receiptAnimation', overlay)?.remove();

            $('#receiptResult', overlay)?.classList.remove(
                'receipt-hidden'
            );

        }, 2200);
    }
    /* =========================================================
       PRINT RECEIPT
       ========================================================= */

    function printReceipt() {
        const receipt = $('#receiptFinalPaper');

        if (!receipt) return;

        const printWindow = window.open(
            '',
            '_blank',
            'width=420,height=700'
        );

        if (!printWindow) {
            alert('Please allow popups to print the receipt.');
            return;
        }

        const styles = `
            * {
                box-sizing: border-box;
            }

            body {
                margin: 0;
                padding: 3mm;
                background: white;
                font-family: Arial, sans-serif;
            }

            .receipt-final-paper {
                width: 72mm;
                margin: auto;
                padding: 4mm;
                color: #29241f;
                background: white;
                font-size: 10px;
                font-family: monospace;
            }

            .receipt-head,
            .receipt-foot {
                text-align: center;
            }

            .receipt-icon {
                width: 48px;
                height: 48px;
                object-fit: contain;
            }

            .receipt-meta {
                font-size: 10px;
                line-height: 1.7;
            }

            .meta-line {
                display: grid;
                grid-template-columns: 68px 8px 1fr;
                gap: 3px;
                overflow-wrap: anywhere;
            }

            .receipt-items {
                border-top: 1px dashed #999;
                border-bottom: 1px dashed #999;
                margin: 8px 0;
                padding: 6px 0;
            }

            .receipt-table-head,
            .receipt-row {
                display: grid;
                grid-template-columns: minmax(0,1fr) 18px 37px 40px;
                gap: 2px;
                font-size: 8px;
                padding: 4px 0;
            }

            .receipt-table-head {
                font-weight: bold;
            }

            .receipt-table-head span:not(:first-child),
            .receipt-row span:not(:first-child),
            .receipt-row strong {
                text-align: right;
            }

            .receipt-summary-line,
            .receipt-total {
                display: flex;
                justify-content: space-between;
                padding: 4px 0;
            }

            .receipt-total {
                border-top: 1px dashed #333;
                border-bottom: 1px dashed #333;
                font-weight: bold;
                margin-top: 5px;
                padding: 8px 0;
            }

            .receipt-upi {
                text-align: center;
                padding: 8px 0;
                border-top: 1px dashed #999;
                border-bottom: 1px dashed #999;
            }

            .receipt-upi img {
                display: block;
                width: 100px;
                height: 100px;
                object-fit: contain;
                margin: 5px auto;
            }

            .receipt-actions,
            .order-status {
                display: none !important;
            }

            @page {
                size: 80mm auto;
                margin: 3mm;
            }
        `;

        printWindow.document.open();

        printWindow.document.write(`
            <!doctype html>
            <html>
            <head>
                <title>VignaDigital Receipt</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>${styles}</style>
            </head>

            <body>
                ${receipt.outerHTML}
            </body>

            </html>
        `);

        printWindow.document.close();

        printWindow.onload = () => {
            printWindow.focus();
            printWindow.print();
        };
    }

    /* =========================================================
       CUSTOMER ORDER STATUS NOTIFICATIONS
       ========================================================= */

    function showCustomerNotification(message, ready = false) {
        let stack = $('#customerOrderNotifications');

        if (!stack) {
            stack = document.createElement('div');

            stack.id = 'customerOrderNotifications';

            stack.setAttribute('aria-live', 'polite');

            Object.assign(stack.style, {
                position: 'fixed',
                top: '18px',
                right: '18px',
                zIndex: '999999',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                width: 'min(360px, calc(100vw - 36px))'
            });

            document.body.appendChild(stack);
        }

        const notification = document.createElement('div');

        notification.className =
            'customer-order-notification' +
            (ready ? ' ready' : '');

        notification.style.cssText = `
            background:white;
            color:#33251e;
            border-left:5px solid ${ready ? '#239b61' : '#e99a32'};
            border-radius:12px;
            padding:16px;
            box-shadow:0 8px 28px #0002;
            font-family:Arial,sans-serif;
        `;

        notification.innerHTML = `
            <strong>
                ${ready ? '✅ Order Ready!' : '🍳 Order Update'}
            </strong>

            <p></p>

            <button type="button" aria-label="Close">
                ×
            </button>
        `;

        $('p', notification).textContent = message;

        $('button', notification).onclick = () => {
            notification.remove();

            if (!stack.children.length) {
                stack.remove();
            }
        };

        stack.appendChild(notification);

        window.setTimeout(() => {
            notification.remove();

            if (!stack.children.length) {
                stack.remove();
            }
        }, 10000);
    }

    function listenForOrderUpdates(orderId, orderNumber) {
        if (!orderId || !window.EventSource) return;

        currentOrderEventSource?.close();

        const eventSource = new EventSource(
            `${API}/public/orders/${encodeURIComponent(orderId)}/events`
        );

        currentOrderEventSource = eventSource;

        eventSource.addEventListener('order-status', event => {
            try {
                const update = JSON.parse(event.data || '{}');

                const status = String(
                    update.status || ''
                ).toLowerCase();

                const liveStatus = $('#liveStatus');

                if (liveStatus) {
                    liveStatus.textContent =
                        'Status: ' + status.replace(/_/g, ' ');
                }

                if (
                    status === 'preparing' ||
                    status === 'preparing_order'
                ) {
                    showCustomerNotification(
                        `Your order #${orderNumber} is now being prepared!`
                    );
                }

                if (
                    status === 'ready' ||
                    status === 'prepared' ||
                    status === 'completed'
                ) {
                    showCustomerNotification(
                        `Your order #${orderNumber} is ready!`,
                        true
                    );

                    eventSource.close();

                    if (currentOrderEventSource === eventSource) {
                        currentOrderEventSource = null;
                    }
                }

            } catch (error) {
                console.error('Order status event error:', error);
            }
        });

        eventSource.onerror = error => {
            console.warn('Order status connection interrupted:', error);
        };
    }

    /* =========================================================
       ORDERING STATUS REFRESH
       ========================================================= */

    async function refreshOrderingStatus() {
        if (
            orderingCheckRunning ||
            document.visibilityState === 'hidden'
        ) {
            return;
        }

        orderingCheckRunning = true;

        try {
            const latest = await apiRequest(
                `${API}/public/menu/${encodeURIComponent(slug)}?include_unavailable=1&_=${Date.now()}`
            );

            if (!latest.restaurant) return;

            const previousState = lastOrderingState;

            menuData.restaurant = {
                ...menuData.restaurant,
                ...latest.restaurant
            };

            const newState = orderingEnabled();

            if (newState !== previousState) {
                lastOrderingState = newState;

                if (!newState) {
                    cart.clear();
                    closeCheckout();
                }

                // Rebuild menu cards so Add to Cart buttons
                // are created or removed when ordering changes.
                renderMenu($('#q')?.value || '');

                updateCartBar();

                let status = $('#vignaOrderingStatus');

                if (!status) {
                    status = document.createElement('div');
                    status.id = 'vignaOrderingStatus';
                    status.className = 'muted';
                    $('#app')?.prepend(status);
                }

                status.textContent = newState
                    ? ''
                    : 'Online ordering is currently unavailable. Please contact the restaurant.';

                status.hidden = newState;
            }

        } catch (error) {
            console.warn('Ordering status refresh failed:', error);

        } finally {
            orderingCheckRunning = false;
        }
    }

    /* =========================================================
       PERIODIC MENU REFRESH
       ========================================================= */

    async function refreshMenuData() {
        if (document.visibilityState === 'hidden') return;

        try {
            const latest = await apiRequest(
                `${API}/public/menu/${encodeURIComponent(slug)}?include_unavailable=1&_=${Date.now()}`
            );

            if (
                !latest.restaurant ||
                !Array.isArray(latest.categories)
            ) {
                return;
            }

            const previousOrderingState = orderingEnabled();

            menuData = latest;

            const newOrderingState = orderingEnabled();

            if (previousOrderingState && !newOrderingState) {
                cart.clear();
                closeCheckout();
            }

            lastOrderingState = newOrderingState;

            renderMenu($('#q')?.value || '');

        } catch (error) {
            console.warn('Menu refresh failed:', error);
        }
    }

    /* =========================================================
       GLOBAL CLICK HANDLER
       ========================================================= */

    document.addEventListener('click', event => {
        const orderButton = event.target.closest('[data-order-now]');

        if (orderButton) {
            event.preventDefault();
            orderNow(orderButton.dataset.orderNow);
            return;
        }
    });

    /* =========================================================
       CLEANUP
       ========================================================= */

    function cleanup() {
        clearInterval(orderingTimer);
        clearInterval(menuRefreshTimer);

        categoryObserver?.disconnect();

        currentOrderEventSource?.close();

        currentOrderEventSource = null;
    }

    window.addEventListener('pagehide', cleanup, {
        once: true
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshOrderingStatus();
        }
    });

    /* =========================================================
       INITIALIZE
       ========================================================= */

    async function initialize() {
        try {
            await loadMenu();

            orderingTimer = window.setInterval(() => {
                refreshOrderingStatus();
            }, 1000);

            menuRefreshTimer = window.setInterval(() => {
                refreshMenuData();
            }, 30000);

        } catch (error) {
            console.error('Vigna menu initialization error:', error);

            const app = $('#app');

            if (app) {
                app.innerHTML = `
                    <div style="
                        text-align:center;
                        padding:96px 20px;
                    ">
                        <h2>Unable to load menu</h2>

                        <p>
                            ${escapeHTML(error.message)}
                        </p>

                        <button
                            type="button"
                            onclick="location.reload()"
                        >
                            Try Again
                        </button>
                    </div>
                `;
            }
        }
    }

    initialize();

})();