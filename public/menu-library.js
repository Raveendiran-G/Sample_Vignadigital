/* =========================================================
   VIGNA DIGITAL - MENU LIBRARY
   Used by Owner Dashboard and Super Admin
   ========================================================= */

window.MenuLibrary = (() => {
  'use strict';

  const PAGE_SIZE = 30;

  const state = {
    base: '',
    onDone: null,
    categories: [],
    items: [],
    selectedItems: new Set(),
    selectedCategories: new Map(),
    query: '',
    category: '',
    restaurant: '',
    offset: 0,
    total: 0,
    loading: false
  };

  const esc = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);

  const money = value =>
    '₹' + Number(value || 0).toFixed(2);

  const request = async (url, method = 'GET', body = null) => {
    const options = {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    };

    if (body !== null) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const base = String(state.base || '').replace(/\/+$/, '');
    const endpoint = `${base}${url}`;

    let response;

    try {
      response = await fetch(endpoint, options);
    } catch (error) {
      throw new Error(
        `Cannot connect to Menu Library: ${error.message}`
      );
    }

    const text = await response.text();

    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `Invalid server response (${response.status}): ${text.slice(0, 200)}`
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
        data.message ||
        `Menu Library request failed: HTTP ${response.status}`
      );
    }

    return data;
  };

  let modal = null;

  function open({ base, onDone } = {}) {
    if (!base) {
      toast('Menu API path is missing.');
      return;
    }

    state.base = base.replace(/\/$/, '');
    state.onDone = onDone || null;

    state.categories = [];
    state.items = [];
    state.selectedItems.clear();
    state.selectedCategories.clear();

    state.query = '';
    state.category = '';
    state.restaurant = '';
    state.offset = 0;
    state.total = 0;

    modal = openModal({
      title: 'Add dishes from Menu Library',
      sub: 'Browse dishes from other restaurants and add them to this menu.',
      wide: true,
      html: `
                <div class="ml-wrap">

                    <div class="ml-filters">

                        <input
                            type="search"
                            data-ml-search
                            placeholder="Search dishes..."
                            aria-label="Search dishes"
                        >

                        <select data-ml-category>
                            <option value="">All categories</option>
                        </select>

                        <select data-ml-restaurant>
                            <option value="">All restaurants</option>
                        </select>

                    </div>

                    <div class="ml-selection-bar">

                        <div>
                            <strong data-ml-selected>0 selected</strong>
                            <span>Choose dishes or categories to import.</span>
                        </div>

                        <button
                            type="button"
                            class="ghost sm"
                            data-ml-clear
                        >
                            Clear selection
                        </button>

                    </div>

                    <div class="ml-category-section">

                        <h3>Browse categories</h3>

                        <div data-ml-categories class="ml-category-grid">
                            <div class="muted">Loading categories...</div>
                        </div>

                    </div>

                    <div class="ml-items-section">

                        <div class="ml-section-heading">
                            <h3>Available dishes</h3>
                            <span data-ml-count></span>
                        </div>

                        <div data-ml-items class="ml-item-grid">
                            <div class="muted">Loading dishes...</div>
                        </div>

                    </div>

                    <div class="ml-pagination">

                        <button
                            type="button"
                            class="ghost sm"
                            data-ml-prev
                        >
                            Previous
                        </button>

                        <span data-ml-page>Page 1</span>

                        <button
                            type="button"
                            class="ghost sm"
                            data-ml-next
                        >
                            Next
                        </button>

                    </div>

                    <div class="ml-error" data-ml-error></div>

                    <div class="card-foot ml-footer">

                        <button
                            type="button"
                            class="ghost"
                            data-ml-close
                        >
                            Cancel
                        </button>

                        <button
                            type="button"
                            data-ml-import
                        >
                            Import selected
                        </button>

                    </div>

                </div>
            `
    });

    bindEvents();
    loadInitial();
  }

  const el = selector => modal?.querySelector(selector);

  function selectedCount() {
    return state.selectedItems.size +
      state.selectedCategories.size;
  }

  function updateSelectionCount() {
    const count = selectedCount();

    el('[data-ml-selected]').textContent =
      `${count} selected`;

    el('[data-ml-import]').disabled = count === 0;
  }

  function showError(message = '') {
    const error = el('[data-ml-error]');
    if (error) error.textContent = message;
  }

  async function loadInitial() {
    showError('');

    try {
      const result = await request('/library/categories');

      state.categories = Array.isArray(result.categories)
        ? result.categories
        : [];

      renderCategories();
      populateFilters();

      await loadItems();

    } catch (error) {
      el('[data-ml-categories]').innerHTML = `
        <div class="ml-empty ml-error-state">${esc(error.message)}</div>
      `;
      el('[data-ml-items]').innerHTML = `
        <div class="ml-empty ml-error-state">${esc(error.message)}</div>
      `;
      showError(error.message);
    }
  }

  function populateFilters() {
    const categorySelect = el('[data-ml-category]');
    const restaurantSelect = el('[data-ml-restaurant]');

    const currentCategory = categorySelect.value;
    const currentRestaurant = restaurantSelect.value;

    const categories = [
      ...new Set(state.categories.map(c => c.name))
    ].sort();

    const restaurants = new Map();

    state.categories.forEach(category => {
      restaurants.set(
        String(category.restaurant_id),
        category.restaurant
      );
    });

    categorySelect.innerHTML = `
            <option value="">All categories</option>
            ${categories.map(name => `
                <option value="${esc(name)}">
                    ${esc(name)}
                </option>
            `).join('')}
        `;

    restaurantSelect.innerHTML = `
            <option value="">All restaurants</option>
            ${[...restaurants.entries()].map(([id, name]) => `
                <option value="${esc(id)}">
                    ${esc(name)}
                </option>
            `).join('')}
        `;

    categorySelect.value = currentCategory;
    restaurantSelect.value = currentRestaurant;
  }

  function renderCategories() {
    const container = el('[data-ml-categories]');

    if (!state.categories.length) {
      container.innerHTML = `
                <div class="ml-empty">
                    No categories are available from other restaurants.
                </div>
            `;
      return;
    }

    container.innerHTML = state.categories.map(category => {
      const id = String(category.category_id);
      const selected = state.selectedCategories.has(id);

      return `
                <label class="ml-category-card">

                    <input
                        type="checkbox"
                        data-ml-cat="${esc(id)}"
                        ${selected ? 'checked' : ''}
                    >

                    <span class="ml-category-content">

                        <strong>${esc(category.name)}</strong>

                        <small>
                            ${esc(category.restaurant || 'Restaurant')}
                        </small>

                        <small>
                            ${Number(category.items || 0)} available dishes
                        </small>

                    </span>

                    <span class="ml-category-check">
                        ✓
                    </span>

                    <span class="ml-category-options">

                        <label>
                            <input
                                type="checkbox"
                                data-ml-cat-items="${esc(id)}"
                                ${state.selectedCategories.get(id) === true ? 'checked' : ''}
                            >
                            Include all dishes
                        </label>

                    </span>

                </label>
            `;
    }).join('');
  }

  async function loadItems() {
    if (state.loading) return;

    state.loading = true;

    const container = el('[data-ml-items]');

    container.innerHTML = `
            <div class="muted">Loading dishes...</div>
        `;

    const params = new URLSearchParams({
      limit: PAGE_SIZE,
      offset: state.offset
    });

    if (state.query) {
      params.set('q', state.query);
    }

    if (state.category) {
      params.set('category', state.category);
    }

    if (state.restaurant) {
      params.set('restaurant_id', state.restaurant);
    }

    try {
      const result = await request(
        `/library/items?${params.toString()}`
      );

      state.items = Array.isArray(result.items)
        ? result.items
        : [];

      state.total = Number(result.total || 0);

      renderItems();
      updatePagination();

    } catch (error) {
      container.innerHTML = `
                <div class="ml-empty ml-error-state">
                    ${esc(error.message)}
                </div>
            `;
    } finally {
      state.loading = false;
    }
  }

  function renderItems() {
    const container = el('[data-ml-items]');

    el('[data-ml-count]').textContent =
      `${state.total} dishes found`;

    if (!state.items.length) {
      container.innerHTML = `
                <div class="ml-empty">
                    No dishes found. Try another search.
                </div>
            `;
      return;
    }

    container.innerHTML = state.items.map(item => {
      const id = String(item.id);
      const selected = state.selectedItems.has(id);

      return `
                <label class="ml-item-card ${selected ? 'selected' : ''}">

                    <input
                        type="checkbox"
                        data-ml-item="${esc(id)}"
                        ${selected ? 'checked' : ''}
                    >

                    <div class="ml-item-image">

                        ${item.image
          ? `
                                <img
                                    src="${esc(item.image)}"
                                    alt="${esc(item.name)}"
                                    loading="lazy"
                                >
                            `
          : '🍽️'
        }

                    </div>

                    <div class="ml-item-details">

                        <strong>${esc(item.name)}</strong>

                        <span>${esc(item.category || 'Menu')}</span>

                        <small>${esc(item.restaurant || '')}</small>

                        <b>${money(item.price)}</b>

                    </div>

                </label>
            `;
    }).join('');

    updateSelectionCount();
  }

  function updatePagination() {
    const currentPage =
      Math.floor(state.offset / PAGE_SIZE) + 1;

    const totalPages = Math.max(
      1,
      Math.ceil(state.total / PAGE_SIZE)
    );

    el('[data-ml-page]').textContent =
      `Page ${currentPage} of ${totalPages}`;

    el('[data-ml-prev]').disabled =
      state.offset <= 0;

    el('[data-ml-next]').disabled =
      state.offset + PAGE_SIZE >= state.total;
  }

  function bindEvents() {

    let searchTimer;

    el('[data-ml-search]').addEventListener('input', event => {
      clearTimeout(searchTimer);

      searchTimer = setTimeout(() => {
        state.query = event.target.value.trim();
        state.offset = 0;
        loadItems();
      }, 250);
    });

    el('[data-ml-category]').addEventListener('change', event => {
      state.category = event.target.value;
      state.offset = 0;
      loadItems();
    });

    el('[data-ml-restaurant]').addEventListener('change', event => {
      state.restaurant = event.target.value;
      state.offset = 0;
      loadItems();
    });

    el('[data-ml-categories]').addEventListener('change', event => {

      const checkbox = event.target.closest('[data-ml-cat]');

      if (checkbox) {
        const id = checkbox.dataset.mlCat;

        if (checkbox.checked) {
          if (!state.selectedCategories.has(id)) {
            state.selectedCategories.set(id, false);
          }
        } else {
          state.selectedCategories.delete(id);
        }

        updateSelectionCount();
        return;
      }

      const includeItems = event.target.closest(
        '[data-ml-cat-items]'
      );

      if (includeItems) {
        const id = includeItems.dataset.mlCatItems;

        const categoryCheckbox = el(
          `[data-ml-cat="${CSS.escape(id)}"]`
        );

        if (includeItems.checked) {
          state.selectedCategories.set(id, true);

          if (categoryCheckbox) {
            categoryCheckbox.checked = true;
          }
        } else if (state.selectedCategories.has(id)) {
          state.selectedCategories.set(id, false);
        }

        updateSelectionCount();
      }
    });

    el('[data-ml-items]').addEventListener('change', event => {
      const checkbox = event.target.closest('[data-ml-item]');

      if (!checkbox) return;

      const id = checkbox.dataset.mlItem;

      if (checkbox.checked) {
        state.selectedItems.add(id);
      } else {
        state.selectedItems.delete(id);
      }

      checkbox.closest('.ml-item-card')
        ?.classList.toggle('selected', checkbox.checked);

      updateSelectionCount();
    });

    el('[data-ml-clear]').addEventListener('click', () => {
      state.selectedItems.clear();
      state.selectedCategories.clear();

      renderCategories();
      renderItems();
      updateSelectionCount();
    });

    el('[data-ml-prev]').addEventListener('click', () => {
      if (state.offset <= 0) return;

      state.offset = Math.max(
        0,
        state.offset - PAGE_SIZE
      );

      loadItems();
    });

    el('[data-ml-next]').addEventListener('click', () => {
      if (state.offset + PAGE_SIZE >= state.total) return;

      state.offset += PAGE_SIZE;
      loadItems();
    });

    el('[data-ml-close]').addEventListener('click', () => {
      closeModal();
    });

    el('[data-ml-import]').addEventListener('click', importSelected);
  }

  async function importSelected() {
    const button = el('[data-ml-import]');

    const items = [...state.selectedItems]
      .map(Number)
      .filter(Number.isSafeInteger);

    const categories = [...state.selectedCategories.entries()]
      .map(([category_id, with_items]) => ({
        category_id: Number(category_id),
        with_items
      }))
      .filter(category =>
        Number.isSafeInteger(category.category_id)
      );

    if (!items.length && !categories.length) {
      showError('Select at least one dish or category.');
      return;
    }

    button.disabled = true;
    button.textContent = 'Importing...';
    showError('');

    try {
      const result = await request(
        '/library/import',
        'POST',
        {
          items,
          categories
        }
      );

      closeModal();

      toast(
        `Import complete: ${result.added_items || 0} dishes added, ` +
        `${result.skipped_items || 0} skipped, ` +
        `${result.added_categories || 0} categories created.`
      );

      if (typeof state.onDone === 'function') {
        await state.onDone();
      }

    } catch (error) {
      showError(error.message);

      button.disabled = false;
      button.textContent = 'Import selected';
    }
  }

  return { open };

})();