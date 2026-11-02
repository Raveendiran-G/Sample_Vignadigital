(() => {
    'use strict';

    const API = window.VIGNA_API || '/api/v1';
    const slug = window.VIGNA_SLUG || location.pathname.split('/').filter(Boolean).pop();
    const previewMode = window.VIGNA_PREVIEW_MODE === true;
    const cart = new Map();
    let menuData = null;
    let statusStream = null;
    let refreshTimer = null;

    if (!slug) return;

    const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const menuPrice = value => '₹' + Number(value || 0).toLocaleString('en-IN', {
        minimumFractionDigits: Number(value) % 1 ? 2 : 0,
        maximumFractionDigits: 2
    });

    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);

    function findRoot() {
        let root = document.querySelector('[data-vigna-menu-root], #vigna-menu-root');
        if (root) return root;

        root = document.createElement('main');
        root.id = 'vigna-menu-root';
        root.dataset.vignaGeneratedRoot = 'true';

        const header = document.querySelector('header');
        const footer = document.querySelector('footer');
        if (header) header.insertAdjacentElement('afterend', root);
        else if (footer) footer.insertAdjacentElement('beforebegin', root);
        else document.body.appendChild(root);

        return root;
    }

    const root = findRoot();

    function addStyles() {
        if (document.getElementById('vigna-custom-menu-styles')) return;
        const style = document.createElement('style');
        style.id = 'vigna-custom-menu-styles';
        style.textContent = `
            #vigna-menu-root, [data-vigna-menu-root] { --vigna-theme: #d9480f; }
            .vigna-menu-status { padding: 12px 16px; margin: 12px 0; border-radius: 10px; background: #fff3cd; color: #5f4700; }
            .vigna-category { margin: 22px 0; }
            .vigna-category-title { color: var(--vigna-theme); }
            .vigna-item-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,250px),1fr)); gap: 16px; }
            .vigna-menu-item { position: relative; display: flex; flex-direction: column; gap: 8px; min-width: 0; overflow: hidden; padding: 14px; border: 1px solid #e8e8e8; border-radius: 12px; background: #fff; color: #29231f; }
            .vigna-menu-item img { display: block; width: 100%; max-height: 220px; object-fit: cover; border-radius: 8px; }
            .vigna-menu-item h3, .vigna-menu-item p { margin: 0; }
            .vigna-item-price { font-weight: 700; }
            .vigna-item-unavailable { color: #a33; font-weight: 700; }
            .vigna-menu-item button, .vigna-cart-bar, .vigna-checkout button, .vigna-receipt button { cursor: pointer; }
            .vigna-menu-add { border: 0; border-radius: 8px; padding: 10px 14px; background: var(--orange, var(--vigna-theme)); color: #fff; font: inherit; cursor: pointer; }
            .vigna-menu-item button, .vigna-checkout button, .vigna-receipt button { border: 0; border-radius: 8px; padding: 10px 14px; background: var(--vigna-theme); color: #fff; font: inherit; }
            .vigna-menu-item button:disabled, .vigna-checkout button:disabled { opacity: .55; cursor: not-allowed; }
            .vigna-cart-bar { position: fixed; z-index: 9998; left: 50%; bottom: max(14px,env(safe-area-inset-bottom)); transform: translateX(-50%); width: min(620px,calc(100% - 24px)); display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px; border: 0; border-radius: 12px; background: #241b16; color: #fff; box-shadow: 0 6px 28px #0003; font: inherit; }
            .vigna-checkout-overlay, .vigna-receipt-overlay { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; overflow: auto; padding: 18px; background: #0009; }
            .vigna-checkout-box, .vigna-receipt-box { box-sizing: border-box; width: min(560px,100%); max-height: 94vh; overflow: auto; padding: 22px; border-radius: 14px; background: #fff; color: #2b241f; box-shadow: 0 18px 60px #0004; font: 15px/1.5 system-ui,sans-serif; }
            .vigna-checkout-box h2, .vigna-receipt-box h2, .vigna-receipt-box h3 { margin: 0 0 12px; }
            .vigna-cart-lines { display: grid; gap: 8px; margin: 14px 0; }
            .vigna-cart-line { display: grid; grid-template-columns: minmax(0,1fr) auto auto; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid #eee; }
            .vigna-cart-line button { min-width: 34px; padding: 6px 9px; }
            .vigna-checkout form { display: grid; gap: 10px; margin-top: 16px; }
            .vigna-checkout input, .vigna-checkout select, .vigna-checkout textarea { box-sizing: border-box; width: 100%; min-height: 42px; padding: 9px 11px; border: 1px solid #ccc; border-radius: 8px; background: #fff; color: inherit; font: inherit; }
            .vigna-checkout-actions { display: flex; gap: 10px; }
            .vigna-checkout-actions button { flex: 1; }
            .vigna-checkout-actions .vigna-secondary { background: #ece8e5; color: #332820; }
            .vigna-receipt-box { width: min(480px,100%); }
            .vigna-receipt-meta, .vigna-receipt-totals { display: grid; gap: 5px; margin: 12px 0; }
            .vigna-receipt-line, .vigna-receipt-total { display: flex; justify-content: space-between; gap: 12px; }
            .vigna-receipt-total { padding-top: 9px; border-top: 1px solid #aaa; font-size: 1.15em; font-weight: 700; }
            .vigna-receipt-actions { display: flex; gap: 8px; margin-top: 15px; }
            .vigna-receipt-actions button { flex: 1; }
            .vigna-receipt-actions .vigna-secondary { background: #ece8e5; color: #332820; }
            @media print { body * { visibility: hidden !important; } #vigna-receipt, #vigna-receipt * { visibility: visible !important; } #vigna-receipt { position: fixed; inset: 0 auto auto 0; width: 100%; max-height: none; overflow: visible; box-shadow: none; } .vigna-receipt-actions { display: none !important; } }
        `;
        document.head.appendChild(style);
    }

    function getOrderStatus() {
        let status = document.querySelector('[data-vigna-order-status]');
        if (!status) {
            status = document.createElement('p');
            status.className = 'vigna-menu-status';
            status.dataset.vignaOrderStatus = 'true';
            root.prepend(status);
        }
        return status;
    }

    function setRestaurantDetails() {
        if (!menuData?.restaurant) return;
        const restaurant = menuData.restaurant;
        document.title = `${restaurant.name || 'Menu'} · Menu`;
        root.style.setProperty('--vigna-theme', restaurant.theme_color || '#d9480f');
        document.querySelectorAll('[data-vigna-restaurant-name]').forEach(node => {
            node.textContent = restaurant.name || '';
        });
        document.querySelectorAll('[data-vigna-restaurant-tagline]').forEach(node => {
            node.textContent = restaurant.tagline || '';
        });
        document.querySelectorAll('[data-vigna-restaurant-logo]').forEach(node => {
            if (node.tagName === 'IMG') {
                node.src = restaurant.logo || '';
                node.alt = `${restaurant.name || 'Restaurant'} logo`;
                node.hidden = !restaurant.logo;
            }
        });
    }

    function getAllItems() {
        return (menuData?.categories || []).flatMap(category => category.items || []);
    }

    function itemCard(item) {
        const template = document.querySelector(
            'template[data-vigna-item-template], template#vigna-item-template'
        );
        const templateCard = template?.content?.firstElementChild;
        const canUseTemplate = templateCard &&
            templateCard.querySelector('[data-vigna-field="name"]') &&
            templateCard.querySelector('[data-vigna-field="price"]');
        const card = canUseTemplate
            ? templateCard.cloneNode(true)
            : document.createElement('article');
        if (!canUseTemplate) card.className = 'vigna-menu-item';
        card.dataset.vignaItemId = String(item.id);
        card.setAttribute('data-vigna-item', '');

        const imageUrl = item.image_url || item.image || '';
        const fields = card.querySelectorAll('[data-vigna-field]');
        fields.forEach(field => {
            const name = field.dataset.vignaField;
            const value = name === 'price'
                ? menuPrice(item.price)
                : name === 'image'
                    ? imageUrl
                    : name === 'available'
                        ? (item.available === false ? 'Currently unavailable' : 'Available')
                        : item[name] || '';
            if (name === 'image') {
                if (field.tagName === 'IMG') {
                    field.src = value;
                    field.alt = item.name || '';
                } else {
                    field.style.backgroundImage = value
                        ? `url(${JSON.stringify(value)})`
                        : '';
                }
                field.hidden = !value;
            } else {
                field.textContent = value;
            }
        });

        if (!canUseTemplate && imageUrl) {
            const image = document.createElement('img');
            image.src = imageUrl;
            image.alt = item.name || '';
            image.loading = 'lazy';
            card.appendChild(image);
        }

        if (!canUseTemplate) {
            const name = document.createElement('h3');
            name.className = 'vigna-item-name';
            name.dataset.vignaField = 'name';
            name.textContent = item.name || '';
            card.appendChild(name);

            if (item.description) {
                const description = document.createElement('p');
                description.className = 'vigna-item-description';
                description.dataset.vignaField = 'description';
                description.textContent = item.description;
                card.appendChild(description);
            }

            const price = document.createElement('p');
            price.className = 'vigna-item-price';
            price.dataset.vignaField = 'price';
            price.textContent = menuPrice(item.price);
            card.appendChild(price);
        }

        const available = item.available !== false;
        const ordering = menuData.restaurant.order_enabled !== false && !previewMode;
        let addButton = card.querySelector('[data-vigna-add]');
        if (addButton) {
            addButton.dataset.vignaAdd = String(item.id);
            addButton.hidden = !available || !ordering;
        } else if (available && ordering) {
            addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.textContent = 'Add to Cart';
            addButton.dataset.vignaAdd = String(item.id);
            card.appendChild(addButton);
        }

        const availability = card.querySelector('[data-vigna-availability]');
        if (availability) {
            availability.textContent = available ? '' : 'Currently unavailable';
            availability.hidden = available;
        } else if (!available) {
            const unavailable = document.createElement('p');
            unavailable.className = 'vigna-item-unavailable';
            unavailable.textContent = 'Currently unavailable';
            card.appendChild(unavailable);
        }

        return card;
    }

    function categorySection(name) {
        const template = document.querySelector(
            'template[data-vigna-category-template], template#vigna-category-template'
        );
        const templateSection = template?.content?.firstElementChild;
        if (!templateSection) {
            const section = document.createElement('section');
            section.className = 'vigna-category';
            section.dataset.vignaCategory = name || '';
            const heading = document.createElement('h2');
            heading.className = 'vigna-category-title';
            heading.dataset.vignaCategoryTitle = '';
            heading.textContent = name || '';
            section.appendChild(heading);
            const grid = document.createElement('div');
            grid.className = 'vigna-item-grid';
            section.appendChild(grid);
            return { section, items: grid };
        }

        const section = templateSection.cloneNode(true);
        section.dataset.vignaCategory = name || '';
        const heading = section.querySelector(
            '[data-vigna-category-name], [data-vigna-category-title], h1, h2, h3, h4, h5, h6'
        );
        if (heading) heading.textContent = name || '';
        const items = section.querySelector(
            '[data-vigna-category-items], [data-vigna-items]'
        );
        if (items) items.replaceChildren();
        return { section, items: items || section };
    }

    const normalizeName = value => String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    function designedCategoryName(section) {
        return section.getAttribute('data-vigna-category') ||
            section.getAttribute('data-category-name') ||
            section.querySelector('[data-vigna-category-name], [data-vigna-category-title], h1, h2, h3, h4, h5, h6')?.textContent ||
            '';
    }

    function designedItemName(card) {
        return card.getAttribute('data-name') ||
            card.getAttribute('data-item-name') ||
            card.querySelector('[data-vigna-field="name"], [itemprop="name"], h1, h2, h3, h4, h5, h6, .name, .item-name')?.textContent ||
            '';
    }

    function setDesignedText(card, field, value, fallbackSelector) {
        const marked = [...card.querySelectorAll(`[data-vigna-field="${field}"]`)];
        const nodes = marked.length ? marked : [...card.querySelectorAll(fallbackSelector)].slice(0, 1);
        nodes.forEach(node => { node.textContent = value; });
    }

    function updateDesignedCard(card, item, ordering, keepOriginalImage = true) {
        card.hidden = false;
        card.dataset.name = item.name || '';
        card.dataset.price = String(item.price ?? '');
        card.dataset.description = item.description || '';
        card.dataset.available = String(item.available !== false);
        card.dataset.vignaItemId = String(item.id);
        card.setAttribute('data-vigna-item', '');

        setDesignedText(
            card,
            'name',
            item.name || '',
            '[itemprop="name"], h1, h2, h3, h4, h5, h6, .name, .item-name'
        );
        setDesignedText(
            card,
            'description',
            item.description || '',
            '[itemprop="description"], .description, .item-description, p'
        );
        setDesignedText(
            card,
            'price',
            menuPrice(item.price),
            '[itemprop="price"], .price, .item-price, strong, b'
        );

        const imageUrl = item.image_url || item.image || '';
        const imageNodes = [...card.querySelectorAll('[data-vigna-field="image"], img')];
        for (const image of imageNodes) {
            const current = image.tagName === 'IMG'
                ? image.getAttribute('src')
                : image.style.backgroundImage;
            if (imageUrl) {
                if (image.tagName === 'IMG') {
                    image.src = imageUrl;
                    image.alt = item.name || '';
                } else {
                    image.style.backgroundImage = `url(${JSON.stringify(imageUrl)})`;
                }
                image.hidden = false;
            } else if (!keepOriginalImage || !current) {
                image.hidden = true;
            }
        }

        const available = item.available !== false;
        let addButton = card.querySelector(
            '[data-vigna-add], [data-add-to-cart], button.add-to-cart, button.add-button'
        ) || [...card.querySelectorAll('button')].find(button =>
            /\b(add|cart|order)\b/i.test(button.textContent || '')
        );
        if (!addButton && ordering && available && !previewMode) {
            addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.className = 'vigna-menu-add';
            addButton.textContent = 'Add to Cart';
            card.appendChild(addButton);
        }
        if (addButton) {
            addButton.dataset.vignaAdd = String(item.id);
            const showButton = ordering && available && !previewMode;
            addButton.hidden = !showButton;
            addButton.disabled = !showButton;
            addButton.style.display = showButton ? '' : 'none';
        }

        let availability = card.querySelector('[data-vigna-availability], .vigna-item-unavailable');
        if (!availability && !available) {
            availability = document.createElement('p');
            availability.className = 'vigna-item-unavailable';
            card.appendChild(availability);
        }
        if (availability) {
            availability.textContent = available ? '' : 'Currently unavailable';
            availability.hidden = available;
        }
    }

    function updateDesignedCategoryTitle(section, category) {
        const heading = section.querySelector(
            '[data-vigna-category-name], [data-vigna-category-title], h1, h2, h3, h4, h5, h6'
        );
        if (!heading) return;
        const oldText = heading.textContent || '';
        const hasCount = /\(\s*\d+\s*(?:items?)?\s*\)\s*$/i.test(oldText);
        heading.textContent = hasCount
            ? `${category.name} (${category.items.length})`
            : category.name;
    }

    function bindDesignedSearch() {
        for (const input of root.querySelectorAll('input[type="search"], [data-vigna-search]')) {
            if (input.dataset.vignaSearchBound !== 'true') {
                input.dataset.vignaSearchBound = 'true';
                input.addEventListener('input', () => filterDesignedMenu(input));
            }
            filterDesignedMenu(input);
        }
    }

    function filterDesignedMenu(input) {
        const term = normalizeName(input.value);
        const sections = [...root.querySelectorAll('[data-vigna-category]')];
        for (const section of sections) {
            const cards = [...section.querySelectorAll('[data-vigna-item]')];
            for (const card of cards) {
                const haystack = normalizeName(
                    `${card.dataset.name || designedItemName(card)} ${card.dataset.description || ''}`
                );
                card.hidden = !!term && !haystack.includes(term);
            }
            const anyVisible = cards.some(card => !card.hidden);
            section.hidden = !!term && !anyVisible;
        }
    }

    function renderDesignedMenu(ordering) {
        const sections = [...root.querySelectorAll('[data-vigna-category]')];
        const initialCards = [...root.querySelectorAll('[data-vigna-item]')];
        if (!sections.length || !initialCards.length) return false;

        const usedSections = new Set();
        let sectionTemplate = sections[0];
        const cardTemplate = initialCards[0];

        for (const category of menuData.categories) {
            if (!(category.items || []).length) continue;
            const categoryKey = normalizeName(category.name);
            let section = sections.find(candidate =>
                !usedSections.has(candidate) &&
                normalizeName(designedCategoryName(candidate)) === categoryKey
            );

            if (!section) {
                section = sectionTemplate.cloneNode(true);
                section.dataset.vignaCategory = category.name;
                section.hidden = false;
                section.querySelectorAll('[data-vigna-item]').forEach(card => card.remove());
                (sectionTemplate.parentElement || root).appendChild(section);
                sections.push(section);
                sectionTemplate ||= section;
            }

            usedSections.add(section);
            section.hidden = false;
            section.dataset.vignaCategory = category.name;
            updateDesignedCategoryTitle(section, category);

            let cards = [...section.querySelectorAll('[data-vigna-item]')];
            let container = cards[0]?.parentElement || section.querySelector(
                '[data-vigna-category-items], [data-vigna-items], .grid, [role="list"], ul'
            ) || section;

            for (const item of category.items) {
                const itemKey = normalizeName(item.name);
                let card = cards.find(candidate =>
                    !candidate.dataset.vignaMatched &&
                    normalizeName(designedItemName(candidate)) === itemKey
                );
                let keepOriginalImage = true;

                if (!card) {
                    const template = cards[0] || cardTemplate;
                    if (template) {
                        card = template.cloneNode(true);
                        card.hidden = false;
                        card.removeAttribute('data-vigna-matched');
                        container.appendChild(card);
                        cards.push(card);
                    } else {
                        card = itemCard(item);
                        container.appendChild(card);
                        cards.push(card);
                    }
                    keepOriginalImage = false;
                }

                card.dataset.vignaMatched = 'true';
                updateDesignedCard(card, item, ordering, keepOriginalImage);
            }

            for (const card of cards) {
                if (card.dataset.vignaMatched === 'true') {
                    delete card.dataset.vignaMatched;
                } else {
                    card.hidden = true;
                }
            }
        }

        for (const section of sections) {
            if (!usedSections.has(section)) section.hidden = true;
        }
        bindDesignedSearch();
        return true;
    }

    function renderMenu() {
        if (!menuData?.categories) throw new Error('The menu data is incomplete.');
        addStyles();
        setRestaurantDetails();

        const status = getOrderStatus();
        const ordering = menuData.restaurant?.order_enabled !== false;
        status.textContent = ordering
            ? ''
            : 'Online ordering is unavailable right now. Please contact the restaurant to place an order.';
        status.hidden = ordering;

        if (renderDesignedMenu(ordering)) {
            if (!ordering) {
                cart.clear();
                closeCheckout();
            } else {
                syncCartToMenu();
            }
            renderCartBar();
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const category of menuData.categories) {
            if (!(category.items || []).length) continue;
            const { section, items } = categorySection(category.name);
            for (const item of category.items) items.appendChild(itemCard(item));
            fragment.appendChild(section);
        }

        for (const child of [...root.childNodes]) {
            if (child !== status) child.remove();
        }
        root.appendChild(fragment);

        if (!ordering) {
            cart.clear();
            closeCheckout();
        } else {
            syncCartToMenu();
        }
        renderCartBar();
    }

    function syncCartToMenu() {
        const available = new Map(
            getAllItems()
                .filter(item => item.available !== false)
                .map(item => [Number(item.id), item])
        );
        for (const [id, cartItem] of cart) {
            const current = available.get(id);
            if (!current) {
                cart.delete(id);
                continue;
            }
            cartItem.name = current.name;
            cartItem.price = Number(current.price);
        }
    }

    const subtotal = () => [...cart.values()].reduce(
        (sum, item) => sum + item.price * item.qty,
        0
    );
    const tax = () => Math.round(subtotal() * 5) / 100;
    const total = () => subtotal() + tax();
    const count = () => [...cart.values()].reduce((sum, item) => sum + item.qty, 0);

    function renderCartBar() {
        document.getElementById('vigna-cart-bar')?.remove();
        if (!menuData?.restaurant || menuData.restaurant.order_enabled === false || previewMode || !cart.size) return;

        const button = document.createElement('button');
        button.id = 'vigna-cart-bar';
        button.className = 'vigna-cart-bar';
        button.type = 'button';
        button.innerHTML = `<span>${count()} item${count() === 1 ? '' : 's'}</span><strong>View cart · ${money(subtotal())}</strong>`;
        button.addEventListener('click', showCheckout);
        document.body.appendChild(button);
    }

    function addToCart(itemId) {
        if (menuData.restaurant.order_enabled === false || previewMode) return;
        const item = getAllItems().find(entry => Number(entry.id) === Number(itemId));
        if (!item || item.available === false) return;

        const current = cart.get(Number(item.id));
        if (current) current.qty = Math.min(99, current.qty + 1);
        else cart.set(Number(item.id), {
            id: Number(item.id),
            name: item.name,
            price: Number(item.price),
            qty: 1
        });
        renderCartBar();
    }

    function closeCheckout() {
        document.getElementById('vigna-checkout')?.remove();
        document.body.style.overflow = '';
    }

    function showCheckout() {
        if (!cart.size || menuData.restaurant.order_enabled === false) return;
        closeCheckout();
        const overlay = document.createElement('div');
        overlay.id = 'vigna-checkout';
        overlay.className = 'vigna-checkout-overlay';
        overlay.innerHTML = `
            <section class="vigna-checkout-box" role="dialog" aria-modal="true" aria-labelledby="vigna-checkout-title">
                <h2 id="vigna-checkout-title">Confirm your order</h2>
                <div class="vigna-cart-lines" id="vigna-cart-lines"></div>
                <div class="vigna-receipt-totals">
                    <div class="vigna-receipt-line"><span>Subtotal</span><strong id="vigna-subtotal"></strong></div>
                    <div class="vigna-receipt-line"><span>Tax (5%)</span><strong id="vigna-tax"></strong></div>
                    <div class="vigna-receipt-total"><span>Total</span><strong id="vigna-total"></strong></div>
                </div>
                <form id="vigna-order-form">
                    <input name="customer" autocomplete="name" maxlength="80" placeholder="Your name" required>
                    <input name="phone" type="tel" autocomplete="tel" maxlength="20" placeholder="Mobile number" required>
                    <select name="order_type" aria-label="Order type">
                        <option value="Dine In">Dine In</option>
                        <option value="Takeaway">Takeaway</option>
                        <option value="Delivery">Delivery</option>
                        <option value="Room Service">Room Service</option>
                    </select>
                    <input name="table_no" maxlength="30" placeholder="Table number (Dine In)">
                    <textarea name="note" maxlength="500" placeholder="Special instructions"></textarea>
                    <p class="vigna-order-error" role="alert" hidden></p>
                    <div class="vigna-checkout-actions">
                        <button type="submit">Confirm Order</button>
                        <button type="button" class="vigna-secondary" id="vigna-cancel-order">Cancel</button>
                    </div>
                </form>
            </section>
        `;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        drawCartLines(overlay);
        overlay.querySelector('#vigna-cancel-order').addEventListener('click', closeCheckout);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeCheckout();
        });
        overlay.querySelector('select[name="order_type"]').addEventListener('change', event => {
            const table = overlay.querySelector('input[name="table_no"]');
            table.required = event.target.value === 'Dine In';
            table.hidden = event.target.value !== 'Dine In';
        });
        overlay.querySelector('#vigna-order-form').addEventListener('submit', placeOrder);
    }

    function drawCartLines(overlay) {
        const list = overlay.querySelector('#vigna-cart-lines');
        list.replaceChildren();
        cart.forEach(item => {
            const row = document.createElement('div');
            row.className = 'vigna-cart-line';
            row.innerHTML = `
                <span>${escapeHTML(item.name)}<br><small>${money(item.price)} each</small></span>
                <span aria-label="Quantity">${item.qty}</span>
                <span>
                    <button type="button" data-qty-down="${item.id}" aria-label="Decrease ${escapeHTML(item.name)} quantity">−</button>
                    <button type="button" data-qty-up="${item.id}" aria-label="Increase ${escapeHTML(item.name)} quantity">+</button>
                    <button type="button" data-remove="${item.id}" aria-label="Remove ${escapeHTML(item.name)}">×</button>
                </span>
            `;
            list.appendChild(row);
        });
        overlay.querySelector('#vigna-subtotal').textContent = money(subtotal());
        overlay.querySelector('#vigna-tax').textContent = money(tax());
        overlay.querySelector('#vigna-total').textContent = money(total());
        list.onclick = event => {
            const up = event.target.closest('[data-qty-up]');
            const down = event.target.closest('[data-qty-down]');
            const remove = event.target.closest('[data-remove]');
            const id = Number((up || down || remove)?.dataset.qtyUp ?? (down || remove)?.dataset.qtyDown ?? remove?.dataset.remove);
            if (!Number.isSafeInteger(id)) return;
            const item = cart.get(id);
            if (!item) return;
            if (up) item.qty = Math.min(99, item.qty + 1);
            if (down) item.qty--;
            if (remove || item.qty <= 0) cart.delete(id);
            if (!cart.size) closeCheckout();
            else drawCartLines(overlay);
            renderCartBar();
        };
    }

    async function placeOrder(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('[type="submit"]');
        const error = form.querySelector('.vigna-order-error');
        error.hidden = true;

        if (menuData.restaurant.order_enabled === false) {
            error.textContent = 'Online ordering is currently disabled for this restaurant.';
            error.hidden = false;
            return;
        }

        if (!cart.size) {
            error.textContent = 'Your cart is empty.';
            error.hidden = false;
            return;
        }

        button.disabled = true;
        button.textContent = 'Submitting…';
        try {
            const values = Object.fromEntries(new FormData(form));
            const response = await fetch(`${API}/public/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slug,
                    customer: values.customer,
                    phone: values.phone,
                    order_type: values.order_type,
                    table_no: values.table_no,
                    note: values.note,
                    items: [...cart.values()].map(item => ({ id: item.id, qty: item.qty }))
                })
            });
            const result = await response.json();
            if (!response.ok || result.success !== true || !result.order) {
                throw new Error(result.error || 'The order could not be submitted.');
            }

            cart.clear();
            closeCheckout();
            renderCartBar();
            showReceipt(result);
            listenForOrderStatus(result.id);
        } catch (failure) {
            error.textContent = failure.message || 'The order could not be submitted.';
            error.hidden = false;
            button.disabled = false;
            button.textContent = 'Confirm Order';
        }
    }

    function showReceipt(result) {
        const order = result.order;
        const created = new Date(order.created_at || Date.now());
        const overlay = document.createElement('div');
        overlay.id = 'vigna-receipt-overlay';
        overlay.className = 'vigna-receipt-overlay';
        const rows = (order.items || []).map(item => `
            <div class="vigna-receipt-line">
                <span>${escapeHTML(item.name)} × ${Number(item.qty)}<br><small>${money(item.price)} each</small></span>
                <strong>${money(item.line_total)}</strong>
            </div>
        `).join('');
        overlay.innerHTML = `
            <section class="vigna-receipt-box" id="vigna-receipt" role="dialog" aria-modal="true" aria-labelledby="vigna-receipt-heading">
                <h2>${escapeHTML(order.restaurant_name || menuData.restaurant.name || '')}</h2>
                <h3 id="vigna-receipt-heading">Order receipt</h3>
                <div class="vigna-receipt-meta">
                    <div><strong>Order ID:</strong> ${escapeHTML(order.order_no || result.order_no || result.id)}</div>
                    <div><strong>Date and time:</strong> ${escapeHTML(created.toLocaleString())}</div>
                    <div><strong>Customer:</strong> ${escapeHTML(order.customer)}</div>
                    <div><strong>Phone:</strong> ${escapeHTML(order.phone)}</div>
                    <div><strong>Order type:</strong> ${escapeHTML(order.order_type)}${order.table_no ? ` · Table ${escapeHTML(order.table_no)}` : ''}</div>
                </div>
                <hr>
                <div class="vigna-receipt-items">${rows}</div>
                <div class="vigna-receipt-totals">
                    <div class="vigna-receipt-line"><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div>
                    <div class="vigna-receipt-line"><span>Tax (5%)</span><strong>${money(order.tax)}</strong></div>
                    <div class="vigna-receipt-total"><span>Total</span><strong>${money(order.total)}</strong></div>
                </div>
                <div class="vigna-receipt-meta">
                    <div><strong>Payment:</strong> To be completed with the restaurant</div>
                    <div><strong>Status:</strong> <span id="vigna-order-status">${escapeHTML(order.status || 'Pending')}</span></div>
                </div>
                <div class="vigna-receipt-actions">
                    <button type="button" id="vigna-print-receipt">Print receipt</button>
                    <button type="button" class="vigna-secondary" id="vigna-close-receipt">Close</button>
                </div>
            </section>
        `;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        overlay.querySelector('#vigna-print-receipt').addEventListener('click', () => window.print());
        overlay.querySelector('#vigna-close-receipt').addEventListener('click', () => {
            overlay.remove();
            document.body.style.overflow = '';
            statusStream?.close();
            statusStream = null;
        });
    }

    function listenForOrderStatus(orderId) {
        if (!orderId || !window.EventSource) return;
        statusStream?.close();
        statusStream = new EventSource(
            `${API}/public/orders/${encodeURIComponent(orderId)}/events`
        );
        statusStream.addEventListener('order-status', event => {
            try {
                const update = JSON.parse(event.data || '{}');
                const status = document.getElementById('vigna-order-status');
                if (status && update.status) status.textContent = update.status;
            } catch { /* Ignore malformed transient event data. */ }
        });
    }

    async function loadMenu() {
        if (window.VIGNA_PREVIEW_DATA) {
            menuData = window.VIGNA_PREVIEW_DATA;
            renderMenu();
            return;
        }

        const response = await fetch(
            `${API}/public/menu/${encodeURIComponent(slug)}?include_unavailable=1&_=${Date.now()}`,
            { cache: 'no-store' }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load this menu.');

        menuData = data;
        renderMenu();
    }

    root.addEventListener('click', event => {
        const add = event.target.closest('[data-vigna-add]');
        if (add) addToCart(add.dataset.vignaAdd);
    });

    addStyles();
    loadMenu().catch(error => {
        root.textContent = error.message || 'Unable to load this menu.';
    });

    if (!previewMode) {
        refreshTimer = window.setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            loadMenu().catch(() => {});
        }, 30000);
        window.addEventListener('pagehide', () => {
            clearInterval(refreshTimer);
            statusStream?.close();
        }, { once: true });
    }
})();
