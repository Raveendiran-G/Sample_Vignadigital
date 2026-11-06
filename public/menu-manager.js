// ============================================================
// VIGNADIGITAL - MENU MANAGER
// Super Admin and Restaurant Dashboard Menu Editor
// ============================================================

window.MenuManager = (() => {

    function mount(el, {
        base,
        themeColor = '#d9480f',
        onChange
    } = {}) {

        // ----------------------------------------------------
        // VALIDATE CONTAINER BEFORE USING IT
        // ----------------------------------------------------

        if (!el || !(el instanceof Element)) {
            throw new Error(
                'Menu editor container was not found. Check #menuMount.'
            );
        }

        if (!base) {
            throw new Error('Menu API base URL is missing.');
        }

        let categories = [];
        let items = [];

        const q = (selector, root = el) =>
            root ? root.querySelector(selector) : null;

        // ----------------------------------------------------
        // INITIAL MENU EDITOR HTML
        // ----------------------------------------------------

        el.innerHTML = `
            <div class="stats" data-stats>
                ${skelStats(4)}
            </div>

            <div class="toolbar">

                <div class="filters">
                    <input
                        type="search"
                        data-q
                        placeholder="Search items..."
                        aria-label="Search items"
                    >

                    <select
                        data-cat
                        aria-label="Filter by category"
                    >
                        <option value="">All categories</option>
                    </select>
                </div>

                <div class="actions">

                    <div data-view></div>

                    <button
                        type="button"
                        class="ghost"
                        data-cats
                    >
                        ${ico('tag')} Categories
                    </button>

                    <button
                        type="button"
                        class="ghost"
                        data-library
                    >
                        ${ico('store')} Add menu
                    </button>

                    <button
                        type="button"
                        class="ghost"
                        data-bulk-images
                    >
                        📸 Bulk Upload Images
                    </button>

                    <button
                        type="button"
                        data-add
                    >
                        ${ico('plus')} Add item
                    </button>

                </div>

            </div>

            <div class="items" data-list>
                ${skelCards(4)}
            </div>
        `;

        // ----------------------------------------------------
        // HELPERS
        // ----------------------------------------------------

        const thumb = (img, name) => {

            if (img) {
                return `
                    <img
                        src="${esc(img)}"
                        alt="${esc(name || '')}"
                        loading="lazy"
                    >
                `;
            }

            return esc(
                (name || '?').trim().charAt(0).toUpperCase()
            );
        };

        const getErrorMessage = error =>
            error?.message || 'Something went wrong.';

        // ----------------------------------------------------
        // RENDER MENU ITEMS
        // ----------------------------------------------------

        function paint() {

            const stats = q('[data-stats]');
            const categoryFilter = q('[data-cat]');
            const searchInput = q('[data-q]');
            const list = q('[data-list]');

            if (!stats || !categoryFilter || !searchInput || !list) {
                console.error(
                    'MenuManager: Required menu editor elements are missing.'
                );
                return;
            }

            const availableCount =
                items.filter(item => item.available).length;

            stats.innerHTML = [
                ['Total items', items.length, 'hl big'],
                ['Available', availableCount],
                ['Hidden', items.length - availableCount],
                ['Categories', categories.length]
            ].map(([label, value, className]) => `
                <div class="stat ${className || ''}">
                    <span>${label}</span>
                    <b>${value}</b>
                </div>
            `).join('');

            const selectedCategory = categoryFilter.value;

            categoryFilter.innerHTML = `
                <option value="">All categories</option>
                ${categories.map(category => `
                    <option value="${category.id}">
                        ${esc(category.name)}
                    </option>
                `).join('')}
            `;

            categoryFilter.value = selectedCategory;

            const term = searchInput.value.trim().toLowerCase();
            const category = categoryFilter.value;

            const filteredItems = items.filter(item => {

                const categoryMatch =
                    !category ||
                    String(item.category_id) === String(category);

                const name = String(item.name || '').toLowerCase();
                const description =
                    String(item.description || '').toLowerCase();

                const searchMatch =
                    !term ||
                    name.includes(term) ||
                    description.includes(term);

                return categoryMatch && searchMatch;
            });

            list.innerHTML = filteredItems.length
                ? filteredItems.map(item => `
                    <div
                        class="item ${item.available ? '' : 'off'}"
                        style="--tc:${esc(themeColor)}"
                    >

                        <div class="thumb">
                            ${thumb(item.image, item.name)}
                        </div>

                        <div class="item-body">

                            <div class="nm">
                                ${esc(item.name)}
                            </div>

                            <div>
                                <span class="pill">
                                    ${esc(item.category || '')}
                                </span>

                                ${item.available ? '' : `
                                    <span class="pill warn">
                                        Hidden
                                    </span>
                                `}
                            </div>

                            <div class="ds">
                                ${esc(item.description || '')}
                            </div>

                            <div class="price">
                                ${rupees(item.price)}
                            </div>

                            <div class="item-foot">

                                <button
                                    type="button"
                                    class="sm ghost"
                                    data-act="edit"
                                    data-id="${esc(String(item.id))}"
                                >
                                    Edit
                                </button>

                                <button
                                    type="button"
                                    class="sm ghost"
                                    data-act="toggle"
                                    data-id="${esc(String(item.id))}"
                                >
                                    ${item.available ? 'Hide' : 'Show'}
                                </button>

                                <button
                                    type="button"
                                    class="sm danger"
                                    data-act="del"
                                    data-id="${esc(String(item.id))}"
                                >
                                    Delete
                                </button>

                            </div>

                        </div>

                    </div>
                `).join('')

                : `
                    <div
                        class="card empty"
                        style="grid-column:1/-1"
                    >
                        ${items.length
                            ? 'No items match your search.'
                            : 'No items yet. Click "Add item" to create the first dish.'
                        }
                    </div>
                `;
        }

        // ----------------------------------------------------
        // LOAD CATEGORIES AND ITEMS
        // ----------------------------------------------------

        async function reload() {

            if (!el || !el.isConnected) {
                throw new Error(
                    'Menu editor container is unavailable. Reopen the menu.'
                );
            }

            const list = q('[data-list]');
            const stats = q('[data-stats]');
            const categoryFilter = q('[data-cat]');
            const searchInput = q('[data-q]');

            if (!list || !stats || !categoryFilter || !searchInput) {
                throw new Error(
                    'Menu editor HTML is incomplete. Please refresh the page.'
                );
            }

            list.classList.add('is-busy');

            try {

                const [categoryResponse, itemResponse] =
                    await Promise.all([
                        api(`${base}/categories`),
                        api(`${base}/items`)
                    ]);

                categories = Array.isArray(
                    categoryResponse?.categories
                )
                    ? categoryResponse.categories
                    : [];

                items = Array.isArray(itemResponse?.items)
                    ? itemResponse.items
                    : [];

                paint();

            } finally {

                if (list.isConnected) {
                    list.classList.remove('is-busy');
                }

            }
        }

        const changed = async () => {

            await reload();

            if (typeof onChange === 'function') {
                await onChange();
            }

        };

        // ====================================================
        // ADD / EDIT ITEM
        // ====================================================

        function itemModal(item) {

            if (!categories.length) {

                toast('Create a category first.');

                categoriesModal();

                return;
            }

            let image;
            let removeImg = false;

            const modal = openModal({

                title: item ? 'Edit item' : 'Add item',

                wide: true,

                html: `
                    <form data-itemform>

                        <div class="img-pick">

                            <div
                                class="thumb"
                                data-prev
                                style="--tc:${esc(themeColor)}"
                            >
                                ${thumb(
                                    item?.image,
                                    item?.name || '?'
                                )}
                            </div>

                            <div>

                                <input
                                    type="file"
                                    data-file
                                    accept="image/png,image/jpeg,image/webp"
                                >

                                <button
                                    type="button"
                                    class="ghost sm"
                                    data-rm
                                    style="margin-top:8px"
                                >
                                    Remove image
                                </button>

                                <div
                                    class="small muted"
                                    style="margin-top:6px"
                                >
                                    Photos are resized automatically.
                                </div>

                            </div>

                        </div>

                        <label>Item name</label>

                        <input
                            name="name"
                            required
                            maxlength="80"
                            value="${esc(item?.name || '')}"
                        >

                        <div class="row">

                            <div>

                                <label>Price (₹)</label>

                                <input
                                    name="price"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    inputmode="decimal"
                                    required
                                    value="${item ? item.price : ''}"
                                >

                            </div>

                            <div>

                                <label>Category</label>

                                <select
                                    name="category_id"
                                    required
                                >
                                    ${categories.map(category => `
                                        <option
                                            value="${category.id}"
                                            ${String(item?.category_id) === String(category.id)
                                                ? 'selected'
                                                : ''
                                            }
                                        >
                                            ${esc(category.name)}
                                        </option>
                                    `).join('')}
                                </select>

                            </div>

                        </div>

                        <label>Description</label>

                        <textarea
                            name="description"
                            maxlength="300"
                            placeholder="What is in it? Any note for guests?"
                        >${esc(item?.description || '')}</textarea>

                        <label class="check">

                            <input
                                type="checkbox"
                                name="available"
                                ${!item || item.available ? 'checked' : ''}
                            >

                            Show this item on the menu

                        </label>

                        <div
                            class="err"
                            data-err
                            role="alert"
                        ></div>

                        <div class="card-foot">

                            <button
                                type="button"
                                class="ghost"
                                data-close
                            >
                                Cancel
                            </button>

                            <button data-save>
                                ${item ? 'Save changes' : 'Add item'}
                            </button>

                        </div>

                    </form>
                `
            });

            if (!modal) {
                toast('Unable to open item editor.');
                return;
            }

            const preview = q('[data-prev]', modal);
            const fileInput = q('[data-file]', modal);
            const removeButton = q('[data-rm]', modal);
            const form = q('[data-itemform]', modal);
            const errorBox = q('[data-err]', modal);
            const saveButton = q('[data-save]', modal);

            if (
                !preview ||
                !fileInput ||
                !removeButton ||
                !form ||
                !errorBox ||
                !saveButton
            ) {
                toast('Item editor could not be initialized.');
                return;
            }

            // IMAGE PREVIEW

            fileInput.addEventListener('change', async event => {

                const file = event.target.files?.[0];

                if (!file) return;

                try {

                    image = await resizeImage(file);

                    removeImg = false;

                    preview.innerHTML = `
                        <img src="${image}" alt="">
                    `;

                } catch (error) {

                    errorBox.textContent = getErrorMessage(error);

                }

            });

            // REMOVE IMAGE

            removeButton.addEventListener('click', () => {

                image = undefined;

                removeImg = true;

                preview.textContent =
                    (q('[name="name"]', modal)?.value || '?')
                        .trim()
                        .charAt(0)
                        .toUpperCase();

                fileInput.value = '';

            });

            // SAVE ITEM

            form.addEventListener('submit', async event => {

                event.preventDefault();

                errorBox.textContent = '';

                saveButton.disabled = true;

                const fields = event.target.elements;

                const body = {
                    name: fields.name.value,
                    price: fields.price.value,
                    category_id: fields.category_id.value,
                    description: fields.description.value,
                    available: fields.available.checked,
                    image,
                    remove_image: removeImg
                };

                try {

                    const endpoint = item
                        ? `${base}/items/${item.id}`
                        : `${base}/items`;

                    await api(
                        endpoint,
                        item ? 'PUT' : 'POST',
                        body
                    );

                    closeModal();

                    toast(item ? 'Item saved.' : 'Item added.');

                    await changed();

                } catch (error) {

                    errorBox.textContent = getErrorMessage(error);

                    saveButton.disabled = false;

                }

            });

        }

        // ====================================================
        // CATEGORY MANAGEMENT
        // ====================================================

        function categoriesModal() {

            const modal = openModal({

                title: 'Categories',

                sub: 'Group dishes, for example Starters or Drinks.',

                html: `
                    <form data-catform class="actions">

                        <input
                            name="name"
                            placeholder="New category, e.g. Starters"
                            maxlength="40"
                            required
                            style="flex:1;min-width:180px"
                            aria-label="Category name"
                        >

                        <button>Add</button>

                    </form>

                    <div
                        class="err"
                        data-err
                        role="alert"
                    ></div>

                    <div
                        data-catlist
                        style="margin-top:6px"
                    ></div>

                    <div class="card-foot">

                        <button
                            type="button"
                            class="ghost"
                            data-close
                        >
                            Done
                        </button>

                    </div>
                `
            });

            if (!modal) return;

            const list = q('[data-catlist]', modal);
            const form = q('[data-catform]', modal);
            const errorBox = q('[data-err]', modal);

            if (!list || !form || !errorBox) return;

            // DRAW CATEGORY TABLE

            const draw = () => {

                list.innerHTML = categories.length
                    ? `
                        <table>

                            <thead>
                                <tr>
                                    <th>Category</th>
                                    <th>Items</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>

                            <tbody>

                                ${categories.map(category => `
                                    <tr>

                                        <td>
                                            <b>${esc(category.name)}</b>
                                        </td>

                                        <td>
                                            ${Number(category.items || 0)}
                                        </td>

                                        <td>

                                            <div class="actions">

                                                <button
                                                    class="sm ghost"
                                                    data-catren="${esc(String(category.id))}"
                                                >
                                                    Rename
                                                </button>

                                                <button
                                                    class="sm danger"
                                                    data-catdel="${esc(String(category.id))}"
                                                >
                                                    Delete
                                                </button>

                                            </div>

                                        </td>

                                    </tr>
                                `).join('')}

                            </tbody>

                        </table>
                    `
                    : `
                        <p class="empty">
                            No categories yet. Add the first one above.
                        </p>
                    `;

            };

            draw();

            // CREATE CATEGORY

            form.addEventListener('submit', async event => {

                event.preventDefault();

                errorBox.textContent = '';

                try {

                    await api(
                        `${base}/categories`,
                        'POST',
                        {
                            name: event.target.elements.name.value
                        }
                    );

                    event.target.reset();

                    await changed();

                    draw();

                    toast('Category added.');

                } catch (error) {

                    errorBox.textContent = getErrorMessage(error);

                }

            });

            // RENAME / DELETE CATEGORY

            list.addEventListener('click', async event => {

                const renameButton =
                    event.target.closest('[data-catren]');

                const deleteButton =
                    event.target.closest('[data-catdel]');

                try {

                    // RENAME

                    if (renameButton) {

                        const category = categories.find(
                            entry =>
                                String(entry.id) ===
                                String(renameButton.dataset.catren)
                        );

                        if (!category) return;

                        const renameModal = openModal({

                            title: 'Rename category',

                            html: `
                                <form data-renform>

                                    <label>Name</label>

                                    <input
                                        name="name"
                                        value="${esc(category.name)}"
                                        maxlength="40"
                                        required
                                    >

                                    <div
                                        class="err"
                                        data-err
                                        role="alert"
                                    ></div>

                                    <div class="card-foot">

                                        <button
                                            type="button"
                                            class="ghost"
                                            data-close
                                        >
                                            Cancel
                                        </button>

                                        <button>Save</button>

                                    </div>

                                </form>
                            `
                        });

                        const renameForm =
                            q('[data-renform]', renameModal);

                        if (!renameForm) return;

                        renameForm.addEventListener(
                            'submit',
                            async renameEvent => {

                                renameEvent.preventDefault();

                                try {

                                    await api(
                                        `${base}/categories/${category.id}`,
                                        'PUT',
                                        {
                                            name: renameEvent.target
                                                .elements.name.value
                                        }
                                    );

                                    await changed();

                                    closeModal();

                                    categoriesModal();

                                    toast('Category renamed.');

                                } catch (error) {

                                    q('[data-err]', renameModal).textContent =
                                        getErrorMessage(error);

                                }

                            }
                        );

                    }

                    // DELETE

                    else if (deleteButton) {

                        const category = categories.find(
                            entry =>
                                String(entry.id) ===
                                String(deleteButton.dataset.catdel)
                        );

                        if (!category) return;

                        const confirmed = await confirmDialog({

                            title: `Delete ${category.name}?`,

                            message:
                                'The category will be removed. A category that still has items cannot be deleted.',

                            confirmText: 'Delete category',

                            danger: true

                        });

                        if (!confirmed) return;

                        await api(
                            `${base}/categories/${category.id}`,
                            'DELETE'
                        );

                        await changed();

                        draw();

                        toast('Category deleted.');

                    }

                } catch (error) {

                    toast(getErrorMessage(error));

                }

            });

        }

        // ====================================================
        // BULK IMAGE UPLOAD
        // ====================================================

        function bulkImagesModal() {

            const modal = openModal({

                title: 'Bulk Upload Food Images',

                sub: 'Match image filenames with existing menu item names.',

                wide: true,

                html: `
                    <div class="bulk-image-upload">

                        <div class="card" style="padding:20px">

                            <h3>Choose your food images</h3>

                            <p class="muted">
                                Select images or an extracted folder.
                                Image filenames must match existing dish names.
                                Example: Gobi 65.jpg
                            </p>

                            <label class="bulk-drop">

                                <div style="font-size:36px">
                                    📸
                                </div>

                                <strong>Choose image folder</strong>

                                <span class="muted">
                                    JPEG, PNG, WebP and GIF.
                                    Maximum 5 MB per image.
                                </span>

                                <input
                                    type="file"
                                    data-bulk-files
                                    accept="image/jpeg,image/png,image/webp,image/gif"
                                    multiple
                                    webkitdirectory
                                    directory
                                    hidden
                                >

                            </label>

                            <div
                                data-bulk-count
                                class="muted"
                                style="margin-top:15px"
                            >
                                No images selected.
                            </div>

                        </div>

                        <div
                            data-bulk-progress
                            style="margin-top:15px"
                        ></div>

                        <div
                            data-bulk-report
                            style="margin-top:15px"
                        ></div>

                        <div class="card-foot">

                            <button
                                type="button"
                                class="ghost"
                                data-close
                            >
                                Close
                            </button>

                            <button
                                type="button"
                                data-bulk-submit
                                disabled
                            >
                                Upload Images
                            </button>

                        </div>

                    </div>
                `
            });

            if (!modal) return;

            const fileInput = q('[data-bulk-files]', modal);
            const submit = q('[data-bulk-submit]', modal);
            const count = q('[data-bulk-count]', modal);
            const progress = q('[data-bulk-progress]', modal);
            const reportBox = q('[data-bulk-report]', modal);

            if (
                !fileInput ||
                !submit ||
                !count ||
                !progress ||
                !reportBox
            ) {
                toast('Bulk image upload could not be initialized.');
                return;
            }

            const validImage = file =>
                /^image\/(jpeg|png|webp|gif)$/i.test(file.type);

            // FILE SELECTION

            fileInput.addEventListener('change', () => {

                const files = [...fileInput.files];

                const validFiles = files.filter(validImage);

                count.textContent =
                    `${validFiles.length} valid images selected.`;

                submit.disabled = validFiles.length === 0;

            });

            // UPLOAD

            submit.addEventListener('click', async () => {

                const files = [...fileInput.files].filter(validImage);

                if (!files.length) return;

                const oversized = files.filter(
                    file => file.size > 5 * 1024 * 1024
                );

                if (oversized.length) {

                    reportBox.innerHTML = `
                        <div class="err">
                            ${oversized.length}
                            images exceed the 5 MB limit.
                        </div>
                    `;

                    return;
                }

                const BATCH_SIZE = 10;

                const totalBatches =
                    Math.ceil(files.length / BATCH_SIZE);

                submit.disabled = true;

                submit.textContent = 'Uploading...';

                const finalReport = {

                    total: files.length,

                    updated: 0,

                    synchronized_items: 0,

                    unmatched: [],

                    ambiguous: [],

                    failed: []

                };

                try {

                    for (
                        let batchIndex = 0;
                        batchIndex < totalBatches;
                        batchIndex++
                    ) {

                        const batch = files.slice(
                            batchIndex * BATCH_SIZE,
                            (batchIndex + 1) * BATCH_SIZE
                        );

                        progress.innerHTML = `
                            <div
                                class="card"
                                style="padding:18px"
                            >

                                <strong>
                                    Uploading batch
                                    ${batchIndex + 1}
                                    of ${totalBatches}
                                </strong>

                                <p class="muted">
                                    ${Math.min(
                                        (batchIndex + 1) * BATCH_SIZE,
                                        files.length
                                    )}
                                    of ${files.length} images processed.
                                </p>

                                <div style="
                                    height:8px;
                                    background:#333;
                                    border-radius:10px;
                                    overflow:hidden;
                                ">

                                    <div style="
                                        width:${((batchIndex + 1) / totalBatches) * 100}%;
                                        height:100%;
                                        background:var(--theme-color,#e65b18);
                                        transition:width .3s;
                                    "></div>

                                </div>

                            </div>
                        `;

                        const formData = new FormData();

                        batch.forEach(file => {
                            formData.append(
                                'images',
                                file,
                                file.name
                            );
                        });

                        const response = await fetch(
                            `${base}/items/bulk-images`,
                            {
                                method: 'POST',
                                credentials: 'same-origin',
                                body: formData,
                                cache: 'no-store'
                            }
                        );

                        const responseText = await response.text();

                        let result;

                        try {

                            result = JSON.parse(responseText);

                        } catch {

                            throw new Error(
                                `Batch ${batchIndex + 1} failed. ` +
                                'Server returned: ' +
                                responseText.slice(0, 250)
                            );

                        }

                        if (!response.ok) {

                            throw new Error(
                                result.error ||
                                `Batch ${batchIndex + 1} failed with HTTP ${response.status}`
                            );

                        }

                        const report = result.report || {};

                        finalReport.updated +=
                            Number(report.updated || 0);

                        finalReport.synchronized_items +=
                            Number(report.synchronized_items || 0);

                        finalReport.unmatched.push(
                            ...(report.unmatched || [])
                        );

                        finalReport.ambiguous.push(
                            ...(report.ambiguous || [])
                        );

                        finalReport.failed.push(
                            ...(report.failed || [])
                        );

                    }

                    progress.innerHTML = '';

                    // DISPLAY FINAL REPORT

                    reportBox.innerHTML = `

                        <div
                            class="card"
                            style="padding:18px"
                        >

                            <h3>Image upload completed</h3>

                            <div class="stats">

                                <div class="stat">
                                    <span>Total images</span>
                                    <b>${finalReport.total}</b>
                                </div>

                                <div class="stat">
                                    <span>Successfully updated</span>
                                    <b style="color:#22c55e">
                                        ${finalReport.updated}
                                    </b>
                                </div>

                                <div class="stat">
                                    <span>Matching menu items</span>
                                    <b>
                                        ${finalReport.synchronized_items}
                                    </b>
                                </div>

                                <div class="stat">
                                    <span>Unmatched</span>
                                    <b>${finalReport.unmatched.length}</b>
                                </div>

                                <div class="stat">
                                    <span>Ambiguous</span>
                                    <b>${finalReport.ambiguous.length}</b>
                                </div>

                                <div class="stat">
                                    <span>Failed</span>
                                    <b>${finalReport.failed.length}</b>
                                </div>

                            </div>

                            ${finalReport.unmatched.length ? `

                                <h4>Unmatched images</h4>

                                <ul>
                                    ${finalReport.unmatched.map(name => `
                                        <li>${esc(name)}</li>
                                    `).join('')}
                                </ul>

                            ` : ''}

                            ${finalReport.ambiguous.length ? `

                                <h4>Ambiguous matches</h4>

                                <ul>
                                    ${finalReport.ambiguous.map(entry => `
                                        <li>
                                            ${esc(entry.filename)}:
                                            ${(entry.matching_items || [])
                                                .map(name => esc(name))
                                                .join(', ')
                                            }
                                        </li>
                                    `).join('')}
                                </ul>

                            ` : ''}

                            ${finalReport.failed.length ? `

                                <h4>Failed uploads</h4>

                                <ul>
                                    ${finalReport.failed.map(entry => `
                                        <li>
                                            ${esc(entry.filename || '')}:
                                            ${esc(entry.reason || '')}
                                        </li>
                                    `).join('')}
                                </ul>

                            ` : ''}

                        </div>

                    `;

                    submit.textContent = 'Upload completed';

                    await changed();

                } catch (error) {

                    reportBox.innerHTML = `
                        <div class="err">
                            ${esc(getErrorMessage(error))}
                        </div>
                    `;

                    submit.disabled = false;

                    submit.textContent = 'Retry Upload';

                }

            });

        }

        // ====================================================
        // EVENT LISTENERS
        // ====================================================

        const searchInput = q('[data-q]');
        const categoryFilter = q('[data-cat]');
        const addButton = q('[data-add]');
        const categoryButton = q('[data-cats]');
        const libraryButton = q('[data-library]');
        const bulkButton = q('[data-bulk-images]');
        const list = q('[data-list]');

        if (
            !searchInput ||
            !categoryFilter ||
            !addButton ||
            !categoryButton ||
            !libraryButton ||
            !bulkButton ||
            !list
        ) {
            throw new Error(
                'Menu editor controls could not be initialized.'
            );
        }

        // SEARCH AND FILTER

        ['input', 'change'].forEach(eventName => {

            searchInput.addEventListener(eventName, paint);

            categoryFilter.addEventListener(eventName, paint);

        });

        // ADD ITEM

        addButton.addEventListener('click', () => {
            itemModal(null);
        });

        // CATEGORIES

        categoryButton.addEventListener(
            'click',
            categoriesModal
        );

        // MENU LIBRARY

        libraryButton.addEventListener('click', () => {

            if (window.MenuLibrary) {

                MenuLibrary.open({
                    base,
                    onDone: changed
                });

            } else {

                toast(
                    'Menu Library is unavailable. Refresh the page and try again.'
                );

            }

        });

        // BULK IMAGE UPLOAD

        bulkButton.addEventListener(
            'click',
            bulkImagesModal
        );

        // ITEM ACTIONS: EDIT / HIDE / SHOW / DELETE

        list.addEventListener('click', async event => {

            const button = event.target.closest('button[data-act]');

            if (!button) return;

            const item = items.find(
                entry =>
                    String(entry.id) === String(button.dataset.id)
            );

            if (!item) {
                toast('Menu item not found. Please refresh.');
                return;
            }

            try {

                // EDIT

                if (button.dataset.act === 'edit') {

                    itemModal(item);

                }

                // HIDE / SHOW

                else if (button.dataset.act === 'toggle') {

                    await api(
                        `${base}/items/${item.id}/availability`,
                        'PATCH',
                        {
                            available: !item.available
                        }
                    );

                    await changed();

                    toast(
                        item.available
                            ? 'Item hidden from menu.'
                            : 'Item is visible again.'
                    );

                }

                // DELETE

                else if (button.dataset.act === 'del') {

                    const confirmed = await confirmDialog({

                        title: 'Delete this item?',

                        message:
                            `"${item.name}" will be removed from the menu. This cannot be undone.`,

                        confirmText: 'Delete item',

                        danger: true

                    });

                    if (!confirmed) return;

                    await api(
                        `${base}/items/${item.id}`,
                        'DELETE'
                    );

                    await changed();

                    toast('Item deleted.');

                }

            } catch (error) {

                toast(getErrorMessage(error));

            }

        });

        // ====================================================
        // GRID / LIST VIEW
        // ====================================================

        const viewHost = q('[data-view]');

        if (
            viewHost &&
            typeof window.viewToggle === 'function'
        ) {

            window.viewToggle(
                viewHost,
                'dm_view_items',
                mode => {

                    const currentList = q('[data-list]');

                    if (currentList) {

                        currentList.classList.toggle(
                            'as-list',
                            mode === 'list'
                        );

                    }

                }
            );

        }

        // ====================================================
        // INITIAL LOAD
        // ====================================================

        const loaded = reload().then(() => ({
            reload
        }));

        return loaded;

    }

    return {
        mount
    };

})();