const { cols, nextId } = require('./db');
const svc = require('./service');

const normalizeName = value => String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const decodeEntities = value => String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

function parseAttributes(source) {
    const attrs = {};
    const body = source
        .replace(/^<\/?[\w:-]+/, '')
        .replace(/\/?\s*>$/, '');
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match;

    while ((match = pattern.exec(body))) {
        attrs[match[1].toLowerCase()] = decodeEntities(
            match[2] ?? match[3] ?? match[4] ?? ''
        );
    }

    return attrs;
}

function parseHtml(html) {
    const root = { tag: '#root', attrs: {}, children: [], parent: null, text: '' };
    const stack = [root];
    const voidTags = new Set([
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'
    ]);
    const token = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+|</g;
    let match;

    while ((match = token.exec(html))) {
        const value = match[0];

        if (value.startsWith('<!--') || /^<!/i.test(value)) continue;

        if (/^<\//.test(value)) {
            const tag = /^<\/\s*([\w:-]+)/.exec(value)?.[1]?.toLowerCase();
            if (!tag) continue;
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tag === tag) {
                    stack.length = i;
                    break;
                }
            }
            continue;
        }

        if (/^<[A-Za-z]/.test(value)) {
            const tag = /^<\s*([\w:-]+)/.exec(value)?.[1]?.toLowerCase();
            if (!tag) continue;

            const node = {
                tag,
                attrs: parseAttributes(value),
                children: [],
                parent: stack[stack.length - 1],
                text: ''
            };
            node.parent.children.push(node);

            if (tag === 'script' || tag === 'style') {
                const closing = new RegExp(`<\\/${tag}\\s*>`, 'ig');
                closing.lastIndex = token.lastIndex;
                const end = closing.exec(html);
                if (end) token.lastIndex = closing.lastIndex;
                continue;
            }

            if (!voidTags.has(tag) && !/\/\s*>$/.test(value)) {
                stack.push(node);
            }
            continue;
        }

        stack[stack.length - 1].text += value;
    }

    return root;
}

function walk(node, visit) {
    for (const child of node.children || []) {
        visit(child);
        walk(child, visit);
    }
}

function isInsideTemplate(node) {
    let current = node.parent;
    while (current) {
        if (current.tag === 'template') return true;
        current = current.parent;
    }
    return false;
}

function textContent(node) {
    return decodeEntities(
        node.text + (node.children || []).map(textContent).join(' ')
    ).replace(/\s+/g, ' ').trim();
}

const classList = node => String(node.attrs.class || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const findDescendant = (node, predicate) => {
    let found = null;
    walk(node, child => {
        if (!found && predicate(child)) found = child;
    });
    return found;
};

const categoryMarker = node =>
    node.attrs['data-vigna-category'] ||
    node.attrs['data-menu-category'] ||
    node.attrs['data-category-name'] ||
    ((node.attrs.itemtype || '').toLowerCase().endsWith('menusection')
        ? node.attrs['data-name']
        : '');

const itemMarker = node =>
    Object.hasOwn(node.attrs, 'data-vigna-item') ||
    Object.hasOwn(node.attrs, 'data-menu-item') ||
    Object.hasOwn(node.attrs, 'data-item-name') ||
    (node.attrs.itemtype || '').toLowerCase().endsWith('menuitem') ||
    classList(node).some(name => [
        'menu-item', 'dish-card', 'food-card', 'food-item',
        'item-card', 'menu-card'
    ].includes(name));

function parsePrice(value) {
    if (/-\s*\d/.test(String(value || ''))) return NaN;
    const match = String(value || '')
        .replace(/,/g, '')
        .match(/(?:^|[^\d])([0-9]+(?:\.[0-9]{1,2})?)(?:$|[^\d])/);
    return match ? Number(match[1]) : NaN;
}

function itemFromNode(node, inheritedCategory) {
    const descendants = [];
    walk(node, child => descendants.push(child));
    const valueFrom = (names, attrs) => {
        const found = descendants.find(child => {
            const classes = classList(child);
            return names.some(name =>
                child.attrs.itemprop?.toLowerCase() === name ||
                classes.includes(name)
            );
        });
        for (const key of attrs) {
            if (node.attrs[key]) return node.attrs[key];
        }
        if (found) {
            return found.attrs.content || found.attrs.value || textContent(found);
        }
        return '';
    };

    const name = valueFrom(
        ['name', 'item-name', 'menu-item-name', 'dish-name', 'food-name'],
        ['data-name', 'data-item-name']
    );
    const priceValue = valueFrom(
        ['price', 'item-price', 'menu-item-price', 'dish-price', 'food-price'],
        ['data-price']
    );
    const imageNode = findDescendant(node, child => child.tag === 'img');
    const image = node.attrs['data-image'] || node.attrs['data-image-url'] ||
        imageNode?.attrs['data-src'] || imageNode?.attrs.src || '';
    const description = valueFrom(
        ['description', 'item-description', 'menu-item-description', 'dish-description'],
        ['data-description']
    );
    const category = node.attrs['data-category'] || inheritedCategory;
    const availability = node.attrs['data-available'];
    const classes = classList(node);
    const nearbyText = textContent(node).toLowerCase();
    const available = availability === undefined
        ? !classes.some(name => ['unavailable', 'sold-out', 'out-of-stock'].includes(name)) &&
            !/\b(sold out|unavailable|out of stock)\b/.test(nearbyText)
        : !['false', '0', 'off', 'no'].includes(String(availability).toLowerCase());

    return {
        name: decodeEntities(name),
        price: parsePrice(priceValue),
        description: decodeEntities(description),
        category: decodeEntities(category),
        image: decodeEntities(image),
        available
    };
}

function parseMarkedMenu(html) {
    const root = parseHtml(html);
    const categories = [];
    const markedCategories = [];
    walk(root, node => {
        if (!isInsideTemplate(node) && categoryMarker(node)) markedCategories.push(node);
    });

    const consumed = new Set();
    const addItem = (item, categoryName) => {
        const category = String(item.category || categoryName || '').trim();
        if (!category) {
            throw new Error('Every marked menu item must include a category name.');
        }
        let group = categories.find(candidate => normalizeName(candidate.name) === normalizeName(category));
        if (!group) {
            group = { name: category, items: [] };
            categories.push(group);
        }
        group.items.push(item);
    };

    for (const categoryNode of markedCategories) {
        const name = categoryMarker(categoryNode);
        const candidates = [];
        walk(categoryNode, node => {
            if (!isInsideTemplate(node) && itemMarker(node) && !consumed.has(node)) candidates.push(node);
        });
        for (const itemNode of candidates) {
            consumed.add(itemNode);
            addItem(itemFromNode(itemNode, name), name);
        }
    }

    walk(root, node => {
        if (isInsideTemplate(node) || !itemMarker(node) || consumed.has(node)) return;
        let parent = node.parent;
        let category = node.attrs['data-category'] || '';
        while (!category && parent) {
            category = categoryMarker(parent);
            if (!category && ['section', 'ul', 'ol', 'div'].includes(parent.tag)) {
                const heading = parent.children.find(child => /^h[1-6]$/.test(child.tag));
                category = heading ? textContent(heading) : '';
            }
            parent = parent.parent;
        }
        addItem(itemFromNode(node, category), category);
    });

    return { categories };
}

function validateMenuData(data) {
    if (!data || !Array.isArray(data.categories) || !data.categories.length || data.categories.length > 100) {
        throw new Error('Menu categories are missing or exceed the 100 category limit.');
    }

    const seen = new Set();
    let itemCount = 0;
    const categories = data.categories.map(category => {
        if (!category || typeof category !== 'object' || Array.isArray(category)) {
            throw new Error('Menu categories must be objects with a name and item list.');
        }
        const name = String(category?.name || '').trim();
        if (!name || name.length > 80 || !Array.isArray(category.items)) {
            throw new Error('Each menu category needs a name and an item list.');
        }

        const items = category.items.map(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error('Menu items must be objects with a name and price.');
            }
            const itemName = String(item?.name || '').trim();
            const price = parsePrice(item?.price);
            if (!itemName || itemName.length > 80) {
                throw new Error('Item names must contain 1 to 80 characters.');
            }
            if (!Number.isFinite(price) || price < 0 || price > 10000000) {
                throw new Error(`Invalid price for ${itemName}.`);
            }

            const key = normalizeName(itemName);
            if (seen.has(key)) {
                throw new Error(`The uploaded menu contains the item '${itemName}' more than once.`);
            }
            seen.add(key);

            const image = String(item.image || item.image_url || '').trim();
            if (image && !allowedImageReference(image)) {
                throw new Error(`The image for ${itemName} must be an HTTPS URL, a stored /uploads/ reference, or a supported image data URL.`);
            }

            return {
                name: itemName,
                price,
                description: String(item.description || '').trim().slice(0, 300),
                image,
                available: !['false', '0', 'off', 'no', 'unavailable', 'sold out'].includes(
                    String(item.available ?? true).toLowerCase()
                )
            };
        });

        itemCount += items.length;
        return { name, items };
    });

    if (!itemCount || itemCount > 500) {
        throw new Error('The uploaded menu must contain between 1 and 500 items.');
    }

    return { categories };
}

function extractMenuData(html) {
    const source = String(html || '');
    const hasMenuRoot = /<[a-z][\w:-]*\b(?=[^>]*(?:\bid\s*=\s*["']vigna-menu-root["']|\bdata-vigna-menu-root(?:\s|=|\/?>)))[^>]*>/i.test(source);
    if (!hasMenuRoot) {
        throw new Error('Add an empty <main id="vigna-menu-root"></main> where the live menu should appear.');
    }

    const match = source.match(
        /<script\b(?=[^>]*\bid\s*=\s*["']vigna-menu-data["'])[^>]*>([\s\S]*?)<\/script\s*>/i
    );

    if (match) {
        let data;
        try {
            data = JSON.parse(match[1]);
        } catch {
            throw new Error('The vigna-menu-data script must contain valid JSON.');
        }
        return validateMenuData(data);
    }

    const data = parseMarkedMenu(source);
    if (!data.categories.some(category => category.items.length)) {
        throw new Error(
            'Menu items were not detected. Add a vigna-menu-data JSON script or mark up categories and items with data-vigna-category and data-vigna-item.'
        );
    }
    return validateMenuData(data);
}

function injectMenuRuntime(html, slug) {
    const safeSlug = JSON.stringify(String(slug)).replace(/</g, '\\u003c');
    const base = /<base\b/i.test(html) ? '' : '<base href="/">';
    const bootstrap = `<script>window.VIGNA_SLUG=${safeSlug};window.VIGNA_API=window.location.origin+'/api/v1';</script>`;
    const hasRuntime = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*\/js\/vigna-custom-menu\.js(?:\?[^"']*)?["'][^>]*>/i.test(html);
    const runtime = hasRuntime
        ? ''
        : '<script defer src="/js/vigna-custom-menu.js"></script>';
    const injection = `${bootstrap}${runtime}`;
    const head = /<head\b[^>]*>/i;

    return head.test(html)
        ? html.replace(head, match => `${match}${base}${injection}`)
        : `${base}${injection}${html}`;
}

function allowedImageReference(value) {
    if (!value) return '';
    if (/^https:\/\//i.test(value)) return value;
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(value)) return value;

    if (!/^(?![a-z][a-z\d+.-]*:)(?:\/)?(?!\/)[\w./%~-]+$/i.test(value)) return '';
    let decoded;
    try {
        decoded = decodeURIComponent(
            value.replace(/^\.\//, '').replace(/^\/+/, '')
        ).replace(/\\/g, '/');
    } catch {
        return '';
    }
    const parts = decoded.split('/');
    if (
        !decoded ||
        decoded.startsWith('/') ||
        parts.some(part => !part || part === '.' || part === '..') ||
        ['api', 'admin', 'dashboard', 'login', 'health'].includes(parts[0].toLowerCase())
    ) return '';

    return '/' + value.replace(/^\.\//, '').replace(/^\/+/, '');
}

async function synchronizeMenu(restaurantId, data) {
    const rid = Number(restaurantId);
    const menu = validateMenuData(data);
    const [existingItems, existingCategories] = await Promise.all([
        cols.items.find({ restaurant_id: rid }).toArray(),
        cols.categories.find({ restaurant_id: rid }).toArray()
    ]);

    const existingMap = new Map(
        existingItems.map(item => [normalizeName(item.name), item])
    );
    const categoryMap = new Map(
        existingCategories.map(category => [normalizeName(category.name), category._id])
    );
    const reusableImageMap = new Map();

    for (const item of existingItems) {
        if (item.image && !reusableImageMap.has(normalizeName(item.name))) {
            reusableImageMap.set(normalizeName(item.name), item.image);
        }
    }

    const otherItems = await cols.items.find({
        restaurant_id: { $ne: rid },
        image: { $nin: [null, ''] }
    }).toArray();
    for (const item of otherItems) {
        const key = normalizeName(item.name);
        if (!reusableImageMap.has(key)) reusableImageMap.set(key, item.image);
    }

    const savedImages = new Map();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let processed = 0;
    let createdCategories = 0;
    let reusedImages = 0;
    let nextSort = existingCategories.reduce((n, category) => Math.max(n, Number(category.sort) || 0), 0) + 1;

    async function ensureCategory(name) {
        const key = normalizeName(name);
        if (categoryMap.has(key)) return categoryMap.get(key);

        const categoryId = await nextId('categories');
        await cols.categories.insertOne({
            _id: categoryId,
            restaurant_id: rid,
            name,
            sort: nextSort++
        });
        categoryMap.set(key, categoryId);
        createdCategories++;
        return categoryId;
    }

    for (const category of menu.categories) {
        const categoryId = await ensureCategory(category.name);

        for (const item of category.items) {
            processed++;
            const key = normalizeName(item.name);
            const oldItem = existingMap.get(key);
            const existingImage = oldItem?.image || reusableImageMap.get(key) || null;
            let image = existingImage;

            if (!image && item.image) {
                const reference = allowedImageReference(item.image);
                if (reference.startsWith('data:')) {
                    if (savedImages.has(reference)) {
                        image = savedImages.get(reference);
                    } else {
                        image = await svc.saveImageData(reference);
                        savedImages.set(reference, image);
                    }
                } else {
                    image = reference || null;
                }
            }

            if (existingImage) reusedImages++;

            const fields = {
                name: oldItem?.name || item.name.replace(/\s+/g, ' ').trim(),
                price: item.price,
                category_id: categoryId,
                description: item.description,
                image,
                available: item.available
            };

            if (oldItem) {
                const changed =
                    oldItem.name !== fields.name ||
                    Number(oldItem.price) !== fields.price ||
                    oldItem.category_id !== fields.category_id ||
                    String(oldItem.description || '') !== fields.description ||
                    (oldItem.image || null) !== fields.image ||
                    (oldItem.available !== false) !== fields.available;

                if (changed) {
                    await cols.items.updateOne(
                        { _id: oldItem._id, restaurant_id: rid },
                        { $set: fields }
                    );
                    updated++;
                } else {
                    unchanged++;
                }
                existingMap.set(key, { ...oldItem, ...fields });
            } else {
                const itemId = await nextId('items');
                const newItem = {
                    _id: itemId,
                    restaurant_id: rid,
                    ...fields,
                    created_at: new Date()
                };
                await cols.items.insertOne(newItem);
                existingMap.set(key, newItem);
                if (image) reusableImageMap.set(key, image);
                inserted++;
            }
        }
    }

    return {
        processed,
        inserted,
        added: inserted,
        updated,
        unchanged,
        created_categories: createdCategories,
        reused_images: reusedImages
    };
}

module.exports = {
    extractMenuData,
    injectMenuRuntime,
    synchronizeMenu
};
