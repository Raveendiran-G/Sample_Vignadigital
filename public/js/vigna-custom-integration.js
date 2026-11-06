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
        const root = document.getElementById('vigna-menu-root');

        if (!root) return [];

        const selectors = [
            '[data-vigna-item]',
            '[data-menu-item]',
            '[data-item]',
            'article.card',
            '.m-card',
            '.order-card',
            '.menu-card',
            '.food-card',
            '.item-card',
            '.product-card'
        ];

        return [...new Set(
            selectors.flatMap(selector => [...root.querySelectorAll(selector)])
        )];
    }

    function getCardName(card) {
        const selectors = [
            '[data-name]',
            '[data-item-name]',
            '[itemprop="name"]',
            '.nm',
            '.item-name',
            '.menu-item-name',
            '.food-name',
            '.item-title',
            'h2',
            'h3',
            'h4'
        ];

        for (const selector of selectors) {
            const element = card.matches(selector)
                ? card
                : card.querySelector(selector);

            const value =
                element?.dataset?.name ||
                element?.dataset?.itemName ||
                element?.textContent;

            if (value?.trim()) return value.trim();
        }

        return '';
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

        container.innerHTML = `
        <div class="vigna-order-actions">

            <button
                type="button"
                class="vigna-add-button ${qty > 0 ? 'has-quantity' : ''}"
                data-vigna-add="${item.id}"
            >
                ${qty > 0
                ? `
                        <span
                            class="vigna-card-qty-control"
                            data-vigna-card-minus="${item.id}"
                        >−</span>

                        <span class="vigna-card-qty">
                            ${qty}
                        </span>

                        <span
                            class="vigna-card-qty-control"
                            data-vigna-card-plus="${item.id}"
                        >+</span>
                    `
                : '+ Add'
            }
            </button>

            <button
                type="button"
                class="vigna-order-now-button"
                data-vigna-order-now="${item.id}"
            >
                Order Now
            </button>

        </div>
    `;
    }

    function getCardName(card) {
        const selectors = [
            '[data-name]',
            '[data-item-name]',
            '[itemprop="name"]',
            '.nm',
            '.item-name',
            '.menu-item-name',
            '.food-name',
            '.item-title',
            'h2',
            'h3',
            'h4'
        ];

        for (const selector of selectors) {
            const element = card.matches(selector)
                ? card
                : card.querySelector(selector);

            const value =
                element?.dataset?.name ||
                element?.dataset?.itemName ||
                element?.textContent;

            if (value?.trim()) return value.trim();
        }

        return '';
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

    function orderNow(id) {
        const itemId = Number(id);

        if (!state.cart.has(itemId)) {
            addItem(itemId);
        }

        if (!state.cart.has(itemId)) return;

        openCart();
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

            .vigna-order-actions {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
            }

            .vigna-add-button {
                padding: 11px 16px;
                border: 0;
                border-radius: 8px;
                background: #d99b35;
                color: #17120b;
                font-weight: 700;
                cursor: pointer;
            }

            .vigna-order-now-button {
                padding: 11px 12px;
                border: 0;
                border-radius: 8px;
                background: #f58220;
                color: #fff;
                font-weight: 700;
                cursor: pointer;
            }

            .vigna-quantity {
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 18px;
            }

            .vigna-quantity-row {
                display: grid;
                grid-column: 1 / -1;
                grid-template-columns: auto minmax(24px, 1fr) auto;
                align-items: center;
                gap: 8px;
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
                background: #fffcf5;
                color: #493328;
                font: 11px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
                animation: vignaReceiptUnroll .8s cubic-bezier(.2,.8,.2,1) both;
            }

            .vigna-receipt-head,
            .vigna-receipt-foot {
                text-align: center;
            }

            .vigna-receipt-head h2 {
                margin: 4px 0;
                color: #603123;
                font-size: 15px;
            }

            .vigna-receipt-logo {
                display: block;
                width: 48px;
                height: 48px;
                margin: 0 auto 5px;
                object-fit: contain;
                border-radius: 6px;
            }

            .vigna-receipt-address {
                margin: 2px 0;
                color: #604d40;
                overflow-wrap: anywhere;
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
                color: #d9480f;
                font-size: 14px;
            }

            .vigna-receipt-upi {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 6px;
                margin: 14px 0 4px;
                padding: 10px;
                border-radius: 10px;
                background: #fff;
                text-align: center;
                overflow-wrap: anywhere;
                border: 1px solid #eee4d8;
                font-size: 10px;
            }

            .vigna-receipt-upi::before {
                content: "SCAN & PAY TO HOTEL OWNER";
                font-weight: 800;
                color: #603123;
            }

            .vigna-receipt-upi img {
                display: block;
                width: auto;
                height: auto;
                max-width: 140px;
                max-height: 140px;
                object-fit: contain;
            }

           /* CUSTOMER ORDER SUCCESS NOTIFICATION */
.vigna-order-success-notification {
    position: fixed !important;
    top: 16px !important;
    right: 16px !important;
    left: auto !important;
    z-index: 2147483647 !important;

    width: min(340px, calc(100vw - 32px));
    box-sizing: border-box;

    padding: 14px 38px 14px 15px;

    border: 1px solid #FFCA28;
    border-radius: 12px;

    background: #FFF3CD;
    color: #664D03;

    box-shadow: 0 8px 26px #0003;

    font: 14px/1.5 Arial, sans-serif;

    opacity: 0;
    transform: translateX(30px);

    pointer-events: auto;

    animation: vignaOrderSuccess .3s ease forwards;
}

.vigna-order-success-notification strong {
    display: block;
    margin-bottom: 4px;
    color: #f58220;
}

.vigna-order-success-notification p {
    margin: 0;
}

.vigna-order-success-close {
    position: absolute;
    top: 5px;
    right: 9px;

    border: 0;
    background: transparent;
    color: #664D03;

    font-size: 22px;
    cursor: pointer;
}

@keyframes vignaOrderSuccess {
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

@media(max-width:560px) {
    .vigna-order-success-notification {
        top: 10px !important;
        right: 10px !important;
        width: min(300px, calc(100vw - 20px));
        font-size: 12px;
    }
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

            .vigna-add-button.has-quantity {
    display: flex;
    align-items: center;
    justify-content: space-around;
    gap: 10px;
    padding: 0 8px;
}

.vigna-card-qty-control {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 18px;
    font-weight: 800;
    cursor: pointer;
    user-select: none;
}

.vigna-card-qty {
    min-width: 14px;
    text-align: center;
    font-weight: 800;
    font-size: 13px;
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

    function showOrderSuccessNotification(orderNumber) {

        document.querySelectorAll('.vigna-order-success-notification')
            .forEach(notification => notification.remove());

        const notification = document.createElement('div');

        notification.className = 'vigna-order-success-notification';

        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');

        const orderText = orderNumber
            ? ` Order No: ${orderNumber}.`
            : '';

        notification.innerHTML = `
        <button
            type="button"
            class="vigna-order-success-close"
            aria-label="Close notification"
        >×</button>

        <strong>✅ Order placed successfully!</strong>

        <p>
            Your order has been placed successfully!
            ${escapeHTML(orderText)}
            The hotel owner will confirm your order shortly.
        </p>
    `;

        // Append directly to BODY, not to the receipt popup.
        document.body.appendChild(notification);

        notification.querySelector('.vigna-order-success-close')
            .addEventListener('click', () => {
                notification.remove();
            });

        // Automatically disappear after 6 seconds.
        window.setTimeout(() => {
            notification.remove();
        }, 6000);
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

    function receiptUPIHTML() {
        const qrImage = String(
            state.restaurant?.upi_qr_image || ''
        ).trim();
        const upiId = String(
            state.restaurant?.upi_id || ''
        ).trim();

        if (!qrImage && !upiId) return '';

        return `
            <div class="vigna-receipt-upi">
                ${qrImage ? `
                    <img src="${escapeHTML(qrImage)}"
                        alt="Restaurant UPI QR Code"
                        loading="eager"
                        onerror="this.style.display='none'">
                ` : ''}
                ${upiId ? `
                    <div>UPI ID: ${escapeHTML(upiId)}</div>
                ` : ''}
                <small>Scan the QR code to make payment</small>
            </div>
        `;
    }

    function receiptHTML(order) {
        const restaurantName =
            state.restaurant?.name || 'Restaurant';

        const totals = order.totals;

        const itemsHTML = createReceiptItems(order.items);

        return `
            <div class="vigna-final-paper">

                <div class="vigna-receipt-head">

                    ${state.restaurant?.logo ? `
                        <img class="vigna-receipt-logo"
                            src="${escapeHTML(state.restaurant.logo)}"
                            alt="${escapeHTML(restaurantName)} logo"
                            onerror="this.style.display='none'">
                    ` : ''}

                    <h2>${escapeHTML(restaurantName)}</h2>

                    ${state.restaurant?.address ? `
                        <div class="vigna-receipt-address">
                            ${escapeHTML(state.restaurant.address)}
                        </div>
                    ` : ''}

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
                        <span>PRICE</span>
                        <span>TOTAL</span>
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

                ${receiptUPIHTML()}

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

            showOrderSuccessNotification(order.orderNo);

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

    /* =====================================================
   INITIAL MENU LOAD – CUSTOM HTML MENU
   ===================================================== */

    let menuRefreshRunning = false;

    function getRestaurantOrderingStatus(restaurant) {
        const value =
            restaurant?.order_enabled ??
            restaurant?.ordering_enabled ??
            restaurant?.orderingEnabled ??
            restaurant?.orderEnabled ??
            false;

        return !(
            value === false ||
            value === 0 ||
            value === '0' ||
            value === 'false' ||
            value === 'off' ||
            value === 'disabled' ||
            value === 'no'
        );
    }

    // =====================================================
    // INSTANT MENU CACHE
    // =====================================================

    function getMenuCacheKey() {
        return `vigna_menu_cache_${SLUG}`;
    }

    function saveMenuCache(data) {
        try {
            localStorage.setItem(
                getMenuCacheKey(),
                JSON.stringify({
                    savedAt: Date.now(),
                    data
                })
            );
        } catch (error) {
            console.warn('[Vigna] Menu cache save failed:', error);
        }
    }

    function loadMenuCache() {
        try {
            const cached = localStorage.getItem(getMenuCacheKey());

            if (!cached) return null;

            const parsed = JSON.parse(cached);

            if (!parsed.data || !parsed.data.restaurant ||
                !Array.isArray(parsed.data.categories)) {
                return null;
            }

            return parsed.data;
        } catch (error) {
            console.warn('[Vigna] Menu cache read failed:', error);
            return null;
        }
    }

    function getDatabaseItems(categories) {
        if (!Array.isArray(categories)) {
            return [];
        }

        return categories.flatMap(category => {
            if (!Array.isArray(category.items)) {
                return [];
            }

            return category.items.map(item => ({
                ...item,

                id: item.id ??
                    item._id ??
                    item.item_id ??
                    item.name,

                name: item.name ??
                    item.item_name ??
                    item.title ??
                    'Menu Item',

                price: Number(
                    item.price ??
                    item.selling_price ??
                    item.amount ??
                    0
                ),

                available: !(
                    item.available === false ||
                    item.available === 0 ||
                    item.available === '0' ||
                    item.available === 'false' ||
                    item.is_available === false ||
                    item.is_available === 0
                )
            }));
        });
    }

    function applyMenuData(data) {
        if (
            !data ||
            !data.restaurant ||
            !Array.isArray(data.categories)
        ) {
            return;
        }

        state.restaurant = data.restaurant;
        state.items = getDatabaseItems(data.categories);

        state.orderingEnabled =
            getRestaurantOrderingStatus(data.restaurant);

        if (!state.orderingEnabled) {
            state.cart.clear();

            document.getElementById('vigna-cart-modal')
                ?.classList.remove('open');

            document.body.style.overflow = '';
        }

        if (data.restaurant.name) {
            document.title = `${data.restaurant.name} | Menu`;
        }

        if (/^#[0-9a-fA-F]{6}$/.test(
            String(data.restaurant.theme_color || '')
        )) {
            window.VIGNA_THEME = data.restaurant.theme_color;
        }

        matchCards();
        renderCart();
    }
    /* =====================================================
       MATCH CUSTOM HTML CARDS WITH DATABASE ITEMS
       ===================================================== */

    function matchCards() {
        const cards = findCards();

        cards.forEach(card => {
            const cardName = normalizeName(getCardName(card));

            if (!cardName) return;

            const item = state.items.find(entry =>
                normalizeName(entry.name) === cardName
            );

            if (!item) {
                console.warn(
                    '[Vigna] Database item not matched:',
                    cardName
                );

                card.querySelector('.vigna-order-control')?.remove();
                return;
            }

            card.dataset.vignaItemId = String(item.id);

            renderCartButton(card, item);
        });
    }

    /* =====================================================
       LOAD RESTAURANT MENU FROM PUBLIC API
       ===================================================== */

    async function loadMenu() {
        if (menuRefreshRunning) return;

        menuRefreshRunning = true;

        try {
            const data = await api(
                `/public/menu/${encodeURIComponent(SLUG)}?include_unavailable=1&_=${Date.now()}`
            );

            if (
                !data ||
                !data.restaurant ||
                !Array.isArray(data.categories)
            ) {
                throw new Error('Invalid restaurant menu API response.');
            }

            // Update menu with the latest server data.
            applyMenuData(data);

            // Save the latest successful response.
            saveMenuCache(data);

            console.log('[Vigna] Live menu updated.', {
                restaurant: data.restaurant.name,
                items: state.items.length,
                orderingEnabled: state.orderingEnabled
            });

        } catch (error) {
            console.error('[Vigna] Menu refresh failed:', error);

        } finally {
            menuRefreshRunning = false;
        }
    }

    /* =====================================================
       CUSTOM MENU EVENT HANDLING
       ===================================================== */

    document.addEventListener('click', event => {
        const target = event.target instanceof Element
            ? event.target
            : event.target?.parentElement;

        if (!target) return;

        const add = target.closest('[data-vigna-add]');
        const cardPlus = target.closest('[data-vigna-card-plus]');
        const cardMinus = target.closest('[data-vigna-card-minus]');
        const orderNowButton = target.closest('[data-vigna-order-now]');
        const plus = target.closest('[data-vigna-plus]');
        const minus = target.closest('[data-vigna-minus]');
        const cartButton = target.closest('#vigna-cart-button');

        if (cardPlus) {
            event.preventDefault();
            event.stopPropagation();

            addItem(cardPlus.dataset.vignaCardPlus);
            return;
        }

        if (cardMinus) {
            event.preventDefault();
            event.stopPropagation();

            removeItem(cardMinus.dataset.vignaCardMinus);
            return;
        }
        if (add) {
            event.preventDefault();
            event.stopPropagation();

            addItem(add.dataset.vignaAdd);
            return;
        }

        if (orderNowButton) {
            event.preventDefault();
            event.stopPropagation();

            orderNow(orderNowButton.dataset.vignaOrderNow);
            return;
        }

        if (plus) {
            event.preventDefault();
            event.stopPropagation();

            addItem(plus.dataset.vignaPlus);
            return;
        }

        if (minus) {
            event.preventDefault();
            event.stopPropagation();

            removeItem(minus.dataset.vignaMinus);
            return;
        }

        if (cartButton) {
            event.preventDefault();
            event.stopPropagation();

            openCart();
        }

    }, true);

    /* =====================================================
       INITIALIZATION
       ===================================================== */
    function initialize() {
        addStyles();

        createModal();

        // Start observing custom menu cards immediately.
        const root = document.getElementById('vigna-menu-root');

        if (root) {
            const observer = new MutationObserver(() => {
                if (!state.items.length) return;

                matchCards();
            });

            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        }

        // FIRST: Load cached menu data immediately.
        const cachedMenu = loadMenuCache();

        if (cachedMenu) {
            applyMenuData(cachedMenu);

            console.log('[Vigna] Instant cached menu loaded.');
        }

        // THEN: Fetch the latest menu without blocking the page.
        loadMenu();

        // Keep restaurant ordering availability synchronized.
        setInterval(() => {
            if (document.visibilityState === 'visible') {
                loadMenu();
            }
        }, 2000);
    }

    /* =====================================================
       START
       ===================================================== */

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();