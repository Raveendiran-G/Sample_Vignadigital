# Custom HTML Menus

The custom menu belongs to one restaurant record. Uploading it synchronizes items into the existing `categories` and `items` collections, using the existing numeric ID counters. It does not create a shared dish collection. The public menu API remains the source of truth for names, prices, images, categories, and availability.

## HTML integration

Place this mount in the page where the live menu should appear. The server adds the VignaDigital runtime to the uploaded page when it serves the restaurant's existing `/m/:slug` URL.

```html
<main id="vigna-menu-root"></main>
```

The runtime keeps the uploaded page's CSS, layout, colors, and other page content. If the mount already contains category sections marked with `data-vigna-category` and item cards marked with `data-vigna-item`, it updates those cards in place with the current database names, prices, images, availability, and ordering controls. It keeps the card markup and styles, hides cards no longer present in the database, and clones a marked card when the database has a new item without a matching card.

If the mount is empty, the runtime builds it from the database. Keep item and category templates outside the mount to supply the card design. Item templates use `data-vigna-field` placeholders. A category template is optional; its item container needs `data-vigna-category-items` or `data-vigna-items`.

```html
<template id="vigna-item-template">
  <article class="designed-dish-card">
    <img data-vigna-field="image" alt="">
    <h3 data-vigna-field="name"></h3>
    <p data-vigna-field="description"></p>
    <strong data-vigna-field="price"></strong>
    <span data-vigna-availability hidden>Currently unavailable</span>
    <button type="button" data-vigna-add>Add to Cart</button>
  </article>
</template>

<template id="vigna-category-template">
  <section class="designed-category">
    <h2 data-vigna-category-name></h2>
    <div data-vigna-category-items></div>
  </section>
</template>
```

The current Content Security Policy allows inline and same-origin scripts. Remote JavaScript remains blocked; inline CSS/animations, same-origin assets, HTTPS images, and the injected VignaDigital runtime are supported.

## Menu data format

The recommended format is a JSON script in the HTML file:

```html
<script id="vigna-menu-data" type="application/json">
{
  "categories": [
    {
      "name": "Mains",
      "items": [
        {
          "name": "Chicken Briyani",
          "price": 250,
          "description": "Basmati rice with chicken",
          "image": "https://example.com/chicken-briyani.jpg",
          "available": true
        }
      ]
    }
  ]
}
</script>
```

An item may also have `image_url` instead of `image`. Prices may be numbers or currency-formatted text. Item names must be unique within an uploaded file after case and whitespace normalization. Uploads are limited to 1 MB, 100 categories, and 500 items.

Images may be HTTPS URLs, stored `/uploads/...` or other safe site-relative public paths, or PNG/JPEG/WebP/GIF data URLs. When an item with the same normalized name already has an image, synchronization keeps and reuses that image.

Alternatively, HTML can mark categories and cards for import:

```html
<section data-vigna-category="Mains">
  <article
    data-vigna-item
    data-name="Dragon Chicken"
    data-price="260"
    data-description="Crispy chicken in a spicy sauce"
    data-image="/uploads/dragon-chicken.jpg"
    data-available="true">
    <h3>Dragon Chicken</h3>
    <p>₹260</p>
  </article>
</section>
```

## Admin workflow

1. Open the Admin Dashboard and select **Manage Menu** for a restaurant.
2. Choose an HTML file under 1 MB and select **Upload HTML**. The server validates and synchronizes the item data. Uploading leaves the custom page disabled.
3. Select **Preview** to review the uploaded design with that restaurant's current database menu data. Preview does not submit orders.
4. Select **Activate** to serve the custom HTML at the restaurant's existing `/m/:slug` URL. Uploading alone leaves the default guest menu active.
5. Select **Disable** to return to the default menu while keeping the uploaded HTML and synchronized menu data.
6. Select **Restore Default** to remove the custom HTML configuration. Menu items, images, and order history remain in MongoDB.

The public runtime reads `GET /api/v1/public/menu/:slug?include_unavailable=1` and submits orders to the existing `POST /api/v1/public/orders` endpoint. The server checks the current restaurant ordering setting and item prices before saving an order.
