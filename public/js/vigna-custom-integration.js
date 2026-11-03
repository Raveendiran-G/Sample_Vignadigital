(() => {
    'use strict';

    const API = `${window.location.origin}/api/v1`;
    const SLUG = window.VIGNA_SLUG;

    if (!SLUG) {
        console.error('[Vigna] Restaurant slug is missing.');
        return;
    }

    const state = {
        restaurant: null,
        items: [],
        cart: new Map(),
        orderingEnabled: false,
        loading: false,
        lastOrder: null
    };

    const money = value =>
        new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 2
        }).format(Number(value) || 0);

    const escapeHTML = value =>
        String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);

    const normalizeName = value =>
        String(value ?? '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

    async function api(url, options = {}) {
        const endpoint =
            `${API}${url.startsWith('/') ? url : '/' + url}`;

        const response = await fetch(endpoint, {
            ...options,
            cache: 'no-store',
            headers: {
                ...(options.body ? {
                    'Content-Type': 'application/json'
                } : {}),
                ...(options.headers || {})
            }
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                `HTTP ${response.status}`
            );
        }

        return data;
    }

    function findCards() {
        return [
            ...document.querySelectorAll(
                '#vigna-menu-root [data-vigna-item], ' +
                '#vigna-menu-root [data-menu-item], ' +
                '#vigna-menu-root article.card'
            )
        ];
    }

    function getCardName(card) {
        return (
            card.dataset.name ||
            card.dataset.itemName ||
            card.querySelector('[itemprop="name"]')?.textContent ||
            card.querySelector('h2, h3, h4')?.textContent ||
            ''
        ).trim();
    }

    function renderCartButton(card, item) {
        let container = card.querySelector('.vigna-order-control');

        if (!state.orderingEnabled || item.available === false) {
            container?.remove();
            return;
        }

        const isNew = !container;

        if (isNew) {
            container = document.createElement('div');
            container.className = 'vigna-order-control';
            card.appendChild(container);
        }

        const qty = state.cart.get(Number(item.id)) || 0;
        const renderedQty = Number(container.dataset.qty || 0);

        if (!isNew && renderedQty === qty) {
            return;
        }

        container.dataset.qty = String(qty);

        if (qty > 0) {
            container.innerHTML = `
                <div class="vigna-quantity">
                    <button type="button"
                        data-vigna-minus="${item.id}">−</button>

                    <span>${qty}</span>

                    <button type="button"
                        data-vigna-plus="${item.id}">+</button>
                </div>
            `;
        } else {
            container.innerHTML = `
                <button type="button"
                    class="vigna-add-button"
                    data-vigna-add="${item.id}">
                    Add to Cart
                </button>
            `;
        }
    }

    function matchCards() {
        findCards().forEach(card => {
            const name = normalizeName(getCardName(card));

            const item = state.items.find(
                entry => normalizeName(entry.name) === name
            );

            if (item) {
                card.dataset.vignaItemId = String(item.id);
                renderCartButton(card, item);
            }
        });
    }

    function cartCount() {
        return [...state.cart.values()].reduce(
            (total, qty) => total + qty,
            0
        );
    }

    function cartSubtotal() {
        return [...state.cart.entries()].reduce(
            (total, [id, qty]) => {
                const item = state.items.find(
                    entry => Number(entry.id) === Number(id)
                );

                return total +
                    (Number(item?.price) || 0) * qty;
            },
            0
        );
    }

    function calculateTotals() {
        const subtotal = cartSubtotal();
        const tax = Math.round(subtotal * 0.05 * 100) / 100;

        return {
            subtotal,
            tax,
            total: subtotal + tax
        };
    }

    function renderCart() {
        let button = document.getElementById('vigna-cart-button');

        if (!button) {
            button = document.createElement('button');
            button.id = 'vigna-cart-button';
            button.type = 'button';

            document.body.appendChild(button);
        }

        button.innerHTML = `
            <span>🛒 ${cartCount()} Items</span>
            <strong>View Cart · ${money(cartSubtotal())}</strong>
        `;

        button.style.display =
            state.orderingEnabled && cartCount() > 0
                ? 'flex'
                : 'none';

        matchCards();
    }

    function addItem(id) {
        id = Number(id);

        const item = state.items.find(
            entry => Number(entry.id) === id
        );

        if (!item) {
            console.error('[Vigna] Item ID not found:', id);
            return;
        }

        if (!state.orderingEnabled) {
            alert('Online ordering is currently disabled.');
            return;
        }

        if (item.available === false) {
            alert('This item is currently unavailable.');
            return;
        }

        const current = state.cart.get(id) || 0;

        if (current >= 99) return;

        state.cart.set(id, current + 1);

        renderCart();
    }

    function removeItem(id) {
        id = Number(id);

        const current = state.cart.get(id) || 0;

        if (current <= 1) {
            state.cart.delete(id);
        } else {
            state.cart.set(id, current - 1);
        }

        renderCart();
    }

    // =====================================================
    // STYLES
    // =====================================================

    function addStyles() {
        if (document.getElementById('vigna-custom-order-styles')) {
            return;
        }

        const style = document.createElement('style');

        style.id = 'vigna-custom-order-styles';

        style.textContent = `

            .vigna-order-control {
                margin-top: 12px;
                position: relative;
                z-index: 5;
            }

            .vigna-add-button {
                width: 100%;
                padding: 11px 16px;
                border: 0;
                border-radius: 8px;
                background: #d99b35;
                color: #17120b;
                font-weight: 700;
                cursor: pointer;
            }

            .vigna-quantity {
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 18px;
            }

            .vigna-quantity button {
                width: 34px;
                height: 34px;
                border: 0;
                border-radius: 7px;
                background: #d99b35;
                font-size: 20px;
                cursor: pointer;
            }

            /* FLOATING CART */

            #vigna-cart-button {
                position: fixed;
                z-index: 999990;
                bottom: max(16px, env(safe-area-inset-bottom));
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 20px;
                width: min(520px, calc(100% - 24px));
                padding: 15px 20px;
                border: 0;
                border-radius: 14px;
                background: #ffffff;
                color: #493328;
                font-size: 14px;
                font-weight: 800;
                box-shadow: 0 5px 25px #0003;
                cursor: pointer;
            }

            #vigna-cart-button strong {
                white-space: nowrap;
            }

            /* POPUP OVERLAY */

            #vigna-cart-modal {
                position: fixed !important;
                inset: 0 !important;
                z-index: 999999 !important;
                display: none !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 14px !important;
                box-sizing: border-box !important;
                background: rgba(0, 0, 0, .58) !important;
                overflow-y: auto !important;
            }

            #vigna-cart-modal.open {
                display: flex !important;
            }

            .vigna-modal-box {
                position: relative;
                width: min(520px, 100%);
                max-height: min(92dvh, 900px);
                overflow-y: auto;
                box-sizing: border-box;
                margin: auto;
                padding: 24px 20px;
                background: #fffaf1;
                color: #493328;
                border: 1px solid #e7d4c2;
                border-radius: 18px;
                box-shadow: 0 20px 70px #0005;
                animation: vignaPopup .25s ease both;
            }

            @keyframes vignaPopup {
                from {
                    opacity: 0;
                    transform: translateY(18px) scale(.97);
                }

                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            .vigna-checkout-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid #e7d8cb;
                padding-bottom: 14px;
                margin-bottom: 16px;
            }

            .vigna-checkout-header h2 {
                margin: 0 0 5px;
                color: #603123;
                font-size: 22px;
            }

            .vigna-checkout-header p {
                margin: 0;
                font-size: 12px;
                color: #806c5e;
            }

            .vigna-close {
                flex-shrink: 0;
                border: 0;
                background: #f4e7dc;
                color: #603123;
                border-radius: 50%;
                width: 36px;
                height: 36px;
                font-size: 22px;
                cursor: pointer;
            }

            .vigna-checkout-section {
                background: #fffdf9;
                border: 1px solid #eaded2;
                border-radius: 12px;
                padding: 15px;
                margin-bottom: 12px;
            }

            .vigna-checkout-section h3 {
                margin: 0 0 12px;
                color: #603123;
                font-size: 14px;
            }

            .vigna-cart-line {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                padding: 12px 0;
                border-bottom: 1px solid #e7d8cb;
            }

            .vigna-cart-line p {
                margin: 6px 0 0;
                font-size: 12px;
            }

            .vigna-cart-line strong:last-child {
                color: #e86b16;
                white-space: nowrap;
            }

            .vigna-checkout-total {
                margin-top: 12px;
                padding-top: 12px;
                border-top: 1px dashed #bba18d;
            }

            .vigna-checkout-total p {
                display: flex;
                justify-content: space-between;
                gap: 10px;
                margin: 7px 0;
                font-size: 13px;
            }

            .vigna-grand-total {
                display: flex;
                justify-content: space-between;
                border-top: 1px solid #9c806c;
                border-bottom: 1px dashed #9c806c;
                padding: 10px 0;
                margin-top: 8px;
                font-size: 18px;
                font-weight: 900;
            }

            .vigna-modal-box label {
                display: block;
                margin: 10px 0 5px;
                font-size: 13px;
                font-weight: 600;
                color: #603123;
            }

            .vigna-modal-box input,
            .vigna-modal-box select,
            .vigna-modal-box textarea {
                display: block;
                width: 100%;
                box-sizing: border-box;
                margin: 0;
                padding: 11px 12px;
                border: 1px solid #d9c4b4;
                border-radius: 9px;
                background: #fff;
                color: #3d2a22;
                font-size: 14px;
            }

            .vigna-modal-box input:focus,
            .vigna-modal-box select:focus,
            .vigna-modal-box textarea:focus {
                outline: 2px solid #f58220;
                outline-offset: 1px;
            }

            .vigna-checkout-button {
                width: 100%;
                min-height: 46px;
                margin-top: 14px;
                padding: 13px;
                border: 0;
                border-radius: 9px;
                background: #e09b2f;
                color: #17120b;
                font-weight: 800;
                cursor: pointer;
            }

            .vigna-checkout-button:disabled {
                opacity: .6;
                cursor: wait;
            }

            /* RECEIPT PRINTER ANIMATION */

            .vigna-receipt-screen {
                width: 100%;
                min-height: 440px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 12px 0;
                box-sizing: border-box;
            }

            .vigna-printer-stage {
                width: min(100%, 360px);
                text-align: center;
                animation: vignaPrinterEnter .55s ease both;
            }

            .vigna-printer-brand {
                color: #fff4e8;
                font-weight: 900;
                letter-spacing: 2px;
                margin-bottom: 12px;
                text-shadow: 0 2px 8px #0008;
            }

            .vigna-printing-paper {
                width: 78%;
                min-height: 210px;
                margin: 0 auto -3px;
                padding: 18px 14px 12px;
                box-sizing: border-box;
                background: #fffdf7;
                color: #493328;
                font: 12px/1.5 monospace;
                animation: vignaPaperFeed 1.8s ease-in-out both;
            }

            .vigna-printing-paper h2 {
                color: #603123;
                font-size: 17px;
            }

            .vigna-printing-paper::after,
            .vigna-final-paper::after {
                content: "";
                display: block;
                height: 12px;
                margin: 8px -18px -12px;
                background: inherit;
                clip-path: polygon(
                    0 0, 7.5% 100%, 15% 0,
                    22.5% 100%, 30% 0,
                    37.5% 100%, 45% 0,
                    52.5% 100%, 60% 0,
                    67.5% 100%, 75% 0,
                    82.5% 100%, 90% 0,
                    97.5% 100%, 100% 0
                );
            }

            .vigna-printer-machine {
                position: relative;
                z-index: 1;
                background: linear-gradient(#555, #222);
                color: #f5d6b7;
                padding: 18px 10px;
                border-radius: 12px 12px 18px 18px;
                box-shadow: 0 10px 20px #0003;
                font-size: 11px;
                letter-spacing: 1px;
            }

            .vigna-printer-machine span {
                display: block;
                height: 8px;
                background: #111;
                border-radius: 8px;
                margin: -10px 12px 12px;
            }

            .vigna-printing-logo {
                font-size: 34px;
            }

            .vigna-final-paper {
                width: min(100%, 360px);
                max-height: calc(92dvh - 30px);
                overflow-y: auto;
                box-sizing: border-box;
                margin: 0 auto;
                padding: 20px 18px 28px;
                background: #fffdf7;
                color: #493328;
                font: 12px/1.5 monospace;
                animation: vignaReceiptUnroll .8s cubic-bezier(.2,.8,.2,1) both;
            }

            .vigna-receipt-head,
            .vigna-receipt-foot {
                text-align: center;
            }

            .vigna-receipt-head h2 {
                margin: 5px 0;
                color: #603123;
            }

            .vigna-receipt-label {
                border-top: 1px dashed #9c8b7d;
                margin-top: 10px;
                padding-top: 8px;
                font-weight: 800;
            }

            .vigna-receipt-meta {
                margin: 10px 0;
                font-size: 11px;
            }

            .vigna-meta-line {
                display: grid;
                grid-template-columns: 75px 8px minmax(0, 1fr);
                gap: 4px;
                overflow-wrap: anywhere;
            }

            .vigna-receipt-items {
                border-top: 1px dashed #9c8b7d;
                border-bottom: 1px dashed #9c8b7d;
                margin: 10px 0;
                padding: 8px 0;
            }

            .vigna-receipt-table-head,
            .vigna-receipt-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) 25px 48px 55px;
                gap: 3px;
                font-size: 9px;
                padding: 5px 0;
            }

            .vigna-receipt-table-head {
                font-weight: 800;
                border-bottom: 1px solid #ddd;
            }

            .vigna-receipt-table-head span:not(:first-child),
            .vigna-receipt-row span:not(:first-child) {
                text-align: right;
            }

            .vigna-receipt-row span:first-child {
                overflow-wrap: anywhere;
            }

            .vigna-receipt-summary {
                display: flex;
                justify-content: space-between;
                gap: 10px;
                padding: 5px 0;
            }

            .vigna-receipt-total {
                display: flex;
                justify-content: space-between;
                gap: 10px;
                border-top: 1px dashed #493328;
                border-bottom: 1px dashed #493328;
                margin-top: 5px;
                padding: 9px 0;
                font-weight: 900;
                font-size: 14px;
            }

            .vigna-receipt-foot {
                padding-top: 12px;
                line-height: 1.8;
            }

            .vigna-receipt-actions {
                display: flex;
                gap: 10px;
                margin-top: 15px;
            }

            .vigna-receipt-actions button {
                flex: 1;
                min-height: 42px;
                border: 0;
                border-radius: 9px;
                background: #f58220;
                color: white;
                cursor: pointer;
                font-weight: 700;
            }

            .vigna-receipt-actions .vigna-receipt-secondary {
                background: #f4e7dc;
                color: #603123;
            }

            @keyframes vignaPrinterEnter {
                from {
                    opacity: 0;
                    transform: translateY(25px) scale(.96);
                }

                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            @keyframes vignaPaperFeed {
                0% {
                    transform: translateY(-90px);
                    opacity: 0;
                }

                35% {
                    opacity: 1;
                }

                100% {
                    transform: translateY(0);
                    opacity: 1;
                }
            }

            @keyframes vignaReceiptUnroll {
                from {
                    opacity: 0;
                    transform: translateY(-35px) scaleY(.15);
                    transform-origin: top;
                }

                to {
                    opacity: 1;
                    transform: translateY(0) scaleY(1);
                }
            }

            @media(max-width:560px) {
                #vigna-cart-modal {
                    padding: 7px !important;
                }

                .vigna-modal-box {
                    max-height: 94dvh;
                    padding: 18px 14px;
                    border-radius: 14px;
                }

                #vigna-cart-button {
                    width: calc(100% - 16px);
                    bottom: max(8px, env(safe-area-inset-bottom));
                    padding: 13px 12px;
                    gap: 8px;
                    font-size: 13px;
                }

                .vigna-final-paper {
                    max-height: 88dvh;
                }
            }

            @media(prefers-reduced-motion:reduce) {
                .vigna-modal-box,
                .vigna-printer-stage,
                .vigna-printing-paper,
                .vigna-final-paper {
                    animation: none !important;
                }
            }
        `;

        document.head.appendChild(style);
    }

    // =====================================================
    // CHECKOUT MODAL
    // =====================================================

    function createModal() {
        if (document.getElementById('vigna-cart-modal')) {
            return;
        }

        const modal = document.createElement('div');

        modal.id = 'vigna-cart-modal';

        modal.innerHTML = `
            <div class="vigna-modal-box">

                <div id="vigna-checkout-content">

                    <div class="vigna-checkout-header">
                        <div>
                            <h2>Checkout</h2>
                            <p id="vigna-restaurant-name">
                                Restaurant
                            </p>
                        </div>

                        <button class="vigna-close"
                            type="button"
                            id="vigna-close-cart">×</button>
                    </div>

                    <div class="vigna-checkout-section">
                        <h3>Your Order</h3>

                        <div id="vigna-cart-items"></div>

                        <div id="vigna-cart-totals"
                            class="vigna-checkout-total"></div>
                    </div>

                    <div class="vigna-checkout-section">
                        <h3>Customer Details</h3>

                        <form id="vigna-checkout-form">

                            <label>Full Name</label>
                            <input name="customer"
                                required
                                minlength="2"
                                placeholder="Enter your name">

                            <label>Mobile Number</label>
                            <input name="phone"
                                required
                                inputmode="tel"
                                pattern="[0-9+() -]{7,20}"
                                placeholder="Enter mobile number">

                            <label>Order Type</label>

                            <select name="order_type"
                                id="vigna-order-type">

                                <option>Dine In</option>
                                <option>Takeaway</option>
                                <option>Delivery</option>
                                <option>Room Service</option>

                            </select>

                            <div id="vigna-location-field">
                                <label>Table Number</label>
                                <input name="location"
                                    required
                                    placeholder="Enter table number">
                            </div>

                            <label>Special Instructions</label>

                            <textarea name="note"
                                rows="3"
                                placeholder="Special instructions"></textarea>

                            <button class="vigna-checkout-button"
                                type="submit">
                                Confirm Order
                            </button>

                        </form>
                    </div>

                </div>

                <div id="vigna-receipt-content"
                    style="display:none"></div>

            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('vigna-close-cart')
            .addEventListener('click', closeCart);

        document.getElementById('vigna-order-type')
            .addEventListener('change', updateLocationField);

        document.getElementById('vigna-checkout-form')
            .addEventListener('submit', submitOrder);

        modal.addEventListener('click', event => {
            if (event.target === modal) {
                closeCart();
            }
        });

        document.addEventListener('keydown', event => {
            if (
                event.key === 'Escape' &&
                modal.classList.contains('open')
            ) {
                closeCart();
            }
        });
    }

    function updateLocationField() {
        const type =
            document.getElementById('vigna-order-type').value;

        const field =
            document.getElementById('vigna-location-field');

        if (type === 'Delivery') {
            field.innerHTML = `
                <label>Delivery Address</label>
                <textarea name="location" required
                    placeholder="Enter delivery address"></textarea>
            `;
        } else if (type === 'Room Service') {
            field.innerHTML = `
                <label>Room Number</label>
                <input name="location" required
                    placeholder="Enter room number">
            `;
        } else if (type === 'Dine In') {
            field.innerHTML = `
                <label>Table Number</label>
                <input name="location" required
                    placeholder="Enter table number">
            `;
        } else {
            field.innerHTML = '';
        }
    }

    function renderCheckout() {
        const lines =
            document.getElementById('vigna-cart-items');

        let html = '';

        for (const [id, qty] of state.cart.entries()) {
            const item = state.items.find(
                entry => Number(entry.id) === Number(id)
            );

            if (!item) continue;

            html += `
                <div class="vigna-cart-line">
                    <div>
                        <strong>${escapeHTML(item.name)}</strong>
                        <p>${money(item.price)} × ${qty}</p>
                    </div>

                    <strong>
                        ${money(item.price * qty)}
                    </strong>
                </div>
            `;
        }

        const totals = calculateTotals();

        lines.innerHTML = html;

        document.getElementById('vigna-cart-totals').innerHTML = `
            <p>
                <span>Subtotal:</span>
                <span>${money(totals.subtotal)}</span>
            </p>

            <p>
                <span>Tax (5%):</span>
                <span>${money(totals.tax)}</span>
            </p>

            <div class="vigna-grand-total">
                <span>Grand Total</span>
                <span>${money(totals.total)}</span>
            </div>
        `;

        document.getElementById('vigna-restaurant-name')
            .textContent =
            state.restaurant?.name || 'Restaurant';
    }

    function openCart() {
        if (!state.cart.size) {
            alert('Your cart is empty.');
            return;
        }

        createModal();

        const modal =
            document.getElementById('vigna-cart-modal');

        document.getElementById('vigna-checkout-content')
            .style.display = 'block';

        document.getElementById('vigna-receipt-content')
            .style.display = 'none';

        renderCheckout();

        modal.classList.add('open');

        document.body.style.overflow = 'hidden';
    }

    function closeCart() {
        document.getElementById('vigna-cart-modal')
            ?.classList.remove('open');

        document.body.style.overflow = '';
    }

    // =====================================================
    // RECEIPT DATA
    // =====================================================

    function createReceiptItems(items) {
        return items.map(entry => `
            <div class="vigna-receipt-row">
                <span>${escapeHTML(entry.name)}</span>
                <span>${entry.qty}</span>
                <span>${money(entry.price)}</span>
                <span>${money(entry.price * entry.qty)}</span>
            </div>
        `).join('');
    }

    
    function receiptHTML(order) {
        const restaurantName =
            state.restaurant?.name || 'Restaurant';

        const totals = order.totals;

        const itemsHTML = createReceiptItems(order.items);

        return `
            <div class="vigna-final-paper">

                <div class="vigna-receipt-head">

                    <div style="font-size:30px">🍽️</div>

                    <h2>${escapeHTML(restaurantName)}</h2>

                    <div>ORDER RECEIPT</div>

                    <div class="vigna-receipt-label">
                        CUSTOMER COPY
                    </div>

                </div>

                <div class="vigna-receipt-meta">

                    <div class="vigna-meta-line">
                        <span>Order No</span>
                        <span>:</span>
                        <strong>${escapeHTML(order.orderNo)}</strong>
                    </div>

                    <div class="vigna-meta-line">
                        <span>Date</span>
                        <span>:</span>
                        <span>${escapeHTML(order.date)}</span>
                    </div>

                    <div class="vigna-meta-line">
                        <span>Customer</span>
                        <span>:</span>
                        <span>${escapeHTML(order.customer)}</span>
                    </div>

                    <div class="vigna-meta-line">
                        <span>Mobile</span>
                        <span>:</span>
                        <span>${escapeHTML(order.phone)}</span>
                    </div>

                    <div class="vigna-meta-line">
                        <span>Order Type</span>
                        <span>:</span>
                        <span>${escapeHTML(order.orderType)}</span>
                    </div>

                    ${order.location ? `
                        <div class="vigna-meta-line">
                            <span>Location</span>
                            <span>:</span>
                            <span>${escapeHTML(order.location)}</span>
                        </div>
                    ` : ''}

                </div>

                <div class="vigna-receipt-items">

                    <div class="vigna-receipt-table-head">
                        <span>ITEM</span>
                        <span>QTY</span>
                        <span>RATE</span>
                        <span>AMOUNT</span>
                    </div>

                    ${itemsHTML}

                </div>

                <div class="vigna-receipt-summary">
                    <span>Subtotal</span>
                    <strong>${money(totals.subtotal)}</strong>
                </div>

                <div class="vigna-receipt-summary">
                    <span>Tax (5%)</span>
                    <strong>${money(totals.tax)}</strong>
                </div>

                <div class="vigna-receipt-total">
                    <span>GRAND TOTAL</span>
                    <strong>${money(order.total)}</strong>
                </div>

                ${order.note ? `
                    <div class="vigna-receipt-summary">
                        <span>Instructions</span>
                        <span>${escapeHTML(order.note)}</span>
                    </div>
                ` : ''}

                <div class="vigna-receipt-foot">
                    <strong>ORDER PLACED SUCCESSFULLY!</strong>

                    <div>Thank you for ordering.</div>

                    <div>Please visit again!</div>

                    <div>*** CUSTOMER COPY ***</div>
                </div>

                <div class="vigna-receipt-actions">

                    <button type="button"
                        id="vigna-receipt-close">
                        Done
                    </button>

                    <button type="button"
                        class="vigna-receipt-secondary"
                        id="vigna-receipt-print">
                        Print Receipt
                    </button>

                </div>

            </div>
        `;
    }

    // =====================================================
    // RECEIPT PRINTER ANIMATION
    // =====================================================

    function showReceiptAnimation(order) {
        const checkout =
            document.getElementById('vigna-checkout-content');

        const receipt =
            document.getElementById('vigna-receipt-content');

        const panel =
            document.querySelector('.vigna-modal-box');

        checkout.style.display = 'none';

        receipt.style.display = 'block';

        panel.style.background = 'transparent';
        panel.style.border = '0';
        panel.style.boxShadow = 'none';
        panel.style.padding = '0';
        panel.style.overflow = 'visible';

        receipt.innerHTML = `
            <div class="vigna-receipt-screen">

                <div class="vigna-printer-stage">

                    <div class="vigna-printer-brand">
                        ${escapeHTML(
            state.restaurant?.name || 'RESTAURANT'
        )}
                    </div>

                    <div class="vigna-printing-paper">

                        <div class="vigna-printing-logo">
                            🍽️
                        </div>

                        <h2>ORDER RECEIPT</h2>

                        <p>ORDER: ${escapeHTML(order.orderNo)}</p>

                        <p>Preparing your receipt...</p>

                        <p>PLEASE WAIT</p>

                    </div>

                    <div class="vigna-printer-machine">
                        <span></span>
                        THERMAL RECEIPT PRINTER
                    </div>

                </div>

            </div>
        `;

        setTimeout(() => {
            if (!receipt.isConnected) return;

            receipt.innerHTML = receiptHTML(order);

            document.getElementById('vigna-receipt-close')
                ?.addEventListener('click', () => {
                    const modal =
                        document.getElementById('vigna-cart-modal');

                    modal.classList.remove('open');

                    document.body.style.overflow = '';

                    panel.removeAttribute('style');

                    receipt.style.display = 'none';
                    checkout.style.display = 'block';
                });

            document.getElementById('vigna-receipt-print')
                ?.addEventListener('click', printReceipt);

        }, 2100);
    }

    function printReceipt() {
        const receipt =
            document.querySelector('.vigna-final-paper');

        if (!receipt) return;

        const printWindow = window.open('', '_blank');

        if (!printWindow) {
            alert('Please allow popups to print the receipt.');
            return;
        }

        printWindow.document.write(`
            <!doctype html>
            <html>
            <head>
                <title>Order Receipt</title>

                <style>
                    @page {
                        size: 80mm auto;
                        margin: 3mm;
                    }

                    body {
                        margin: 0;
                        padding: 0;
                        color: #000;
                        background: #fff;
                        font: 11px/1.5 monospace;
                    }

                    .vigna-final-paper {
                        width: 72mm;
                        margin: auto;
                    }

                    .vigna-receipt-head,
                    .vigna-receipt-foot {
                        text-align: center;
                    }

                    .vigna-receipt-items {
                        border-top: 1px dashed #000;
                        border-bottom: 1px dashed #000;
                        margin: 10px 0;
                    }

                    .vigna-receipt-table-head,
                    .vigna-receipt-row {
                        display: grid;
                        grid-template-columns: 1fr 25px 45px 48px;
                        gap: 3px;
                        font-size: 9px;
                        padding: 5px 0;
                    }

                    .vigna-receipt-summary,
                    .vigna-receipt-total {
                        display: flex;
                        justify-content: space-between;
                        padding: 5px 0;
                    }

                    .vigna-receipt-total {
                        border-top: 1px dashed #000;
                        border-bottom: 1px dashed #000;
                        font-weight: bold;
                    }

                    .vigna-receipt-actions {
                        display: none !important;
                    }
                </style>
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

    // =====================================================
    // PLACE ORDER
    // =====================================================

    async function submitOrder(event) {
        event.preventDefault();

        if (!state.cart.size) {
            alert('Your cart is empty.');
            return;
        }

        if (!state.orderingEnabled) {
            alert('Online ordering is currently disabled.');
            return;
        }

        const form = event.currentTarget;

        if (!form.reportValidity()) return;

        const formData = new FormData(form);

        const orderType = String(
            formData.get('order_type') || ''
        );

        const location = String(
            formData.get('location') || ''
        ).trim();

        if (
            ['Dine In', 'Delivery', 'Room Service'].includes(orderType) &&
            !location
        ) {
            alert('Please enter the required location.');
            return;
        }

        const items = [...state.cart.entries()].map(([id, qty]) => ({
            id: Number(id),
            qty
        }));

        const receiptItems = items.map(entry => {
            const item = state.items.find(
                current => Number(current.id) === entry.id
            );

            return {
                id: entry.id,
                name: item?.name || 'Item',
                price: Number(item?.price) || 0,
                qty: entry.qty
            };
        });

        const totals = calculateTotals();

        const payload = {
            slug: SLUG,
            customer: String(formData.get('customer') || '').trim(),
            phone: String(formData.get('phone') || '').trim(),
            order_type: orderType,
            note: String(formData.get('note') || '').trim(),
            items
        };

        if (orderType === 'Dine In') {
            payload.table_no = location;
        }

        if (orderType === 'Delivery') {
            payload.delivery_address = location;
        }

        if (orderType === 'Room Service') {
            payload.room_no = location;
        }

        const submitButton =
            form.querySelector('button[type="submit"]');

        submitButton.disabled = true;
        submitButton.textContent = 'Placing Order...';

        try {
            const result = await api('/public/orders', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            const order = {
                orderNo: result.order_no || result.order_number || 'Confirmed',
                customer: payload.customer,
                phone: payload.phone,
                orderType,
                location,
                note: payload.note,
                items: receiptItems,
                totals,
                total: Number(result.total ?? totals.total),
                date: new Date().toLocaleString('en-IN')
            };

            state.lastOrder = order;

            state.cart.clear();

            renderCart();

            form.reset();

            updateLocationField();

            showReceiptAnimation(order);

        } catch (error) {
            console.error(
                '[Vigna] Order submission failed:',
                error
            );

            alert(
                error.message ||
                'Unable to place your order. Please try again.'
            );

            submitButton.disabled = false;
            submitButton.textContent = 'Confirm Order';
        }
    }
    /* =========================================================
       INITIAL MENU LOAD
       ========================================================= */

    async function loadMenu() {
        const data = await apiRequest(
            `${API}/public/menu/${encodeURIComponent(slug)}?include_unavailable=1&_=${Date.now()}`
        );

        if (!data.restaurant || !Array.isArray(data.categories)) {
            throw new Error('Invalid menu response from server.');
        }

        menuData = data;

        const restaurant = getRestaurant();

        document.title = `${restaurant.name || 'Menu'} · Menu`;

        // Get the restaurant's saved theme color.
        const themeColor = /^#[0-9a-fA-F]{6}$/.test(
            String(restaurant.theme_color || '')
        )
            ? restaurant.theme_color
            : '#d9480f';

        // Apply the theme to the customer menu.
        applyRestaurantTheme(themeColor);

        // Make the theme available to custom menu integrations.
        window.VIGNA_THEME = themeColor;
        window.theme = themeColor;

        // Update the browser theme color.
        const themeMeta = $('#themeMeta');

        if (themeMeta) {
            themeMeta.content = themeColor;
        }

        // Render the menu.
        renderMenu();

        // Remember the current ordering availability.
        lastOrderingState = orderingEnabled();
    }
    // =====================================================
    // EVENT HANDLING
    // =====================================================

    document.addEventListener('click', event => {
        const target = event.target instanceof Element
            ? event.target
            : event.target?.parentElement;

        if (!target) return;

        const add = target.closest('[data-vigna-add]');
        const plus = target.closest('[data-vigna-plus]');
        const minus = target.closest('[data-vigna-minus]');
        const cart = target.closest('#vigna-cart-button');

        if (add) {
            event.preventDefault();
            event.stopImmediatePropagation();

            addItem(add.dataset.vignaAdd);
            return;
        }

        if (plus) {
            event.preventDefault();
            event.stopImmediatePropagation();

            addItem(plus.dataset.vignaPlus);
            return;
        }

        if (minus) {
            event.preventDefault();
            event.stopImmediatePropagation();

            removeItem(minus.dataset.vignaMinus);
            return;
        }

        if (cart) {
            event.preventDefault();
            event.stopImmediatePropagation();

            openCart();
        }
    }, true);

    // =====================================================
    // INITIALIZATION
    // =====================================================

    async function initialize() {
        addStyles();

        createModal();

        try {
            await loadMenu();
        } catch (error) {
            console.error(
                '[Vigna] Menu loading failed:',
                error
            );
        }

        setInterval(async () => {
            try {
                await loadMenu();
            } catch (error) {
                console.warn(
                    '[Vigna] Menu refresh failed:',
                    error.message
                );
            }
        }, 10000);

        const root =
            document.getElementById('vigna-menu-root');

        if (root) {
            const observer = new MutationObserver(() => {
                matchCards();
            });

            observer.observe(root, {
                childList: true,
                subtree: true
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            initialize
        );
    } else {
        initialize();
    }

})();