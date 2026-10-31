Vigna / New Desi Tadka realtime orders patch

Files:
- routes/api.js: replace your existing API router file (keep it in the same routes folder as before).
- lib/db.js: replace your existing lib/db.js.
- lib/order-events.js: NEW file. Place beside db.js in lib/.
- public/admin.html: replace the restaurant admin page.
- public/index.html: replace the customer menu page.

IMPORTANT ROUTING:
The API router expects to be mounted at /api. It exposes owner endpoints at:
GET /api/orders
GET /api/orders/events
PATCH /api/orders/:orderId/status
POST /api/orders/delete-selected
POST /api/orders/delete-older-than-15-days
GET /api/public/orders/:id
GET /api/public/orders/:id/events

Archive copies are saved in MongoDB collection `order_archive` before deletion.

The admin/customer HTML pages supplied in the conversation use a legacy order submission contract (`/api/restaurants/new-desi-tadka/orders`) and legacy field names. The customer tracking code has been updated to use the new public status endpoint and supports `saved.id` or `saved.orderId`, but the order submission endpoint/payload still must be connected to the backend route in your actual app. The backend `/api/public/orders` currently expects {slug, customer, phone, order_type, table_no, items:[{id,qty}], note}; menu item IDs must be available in the browser for that contract.

SSE event hub is in-process. It works with one Node process/instance. For multiple server instances, use Redis pub/sub or MongoDB change streams.
