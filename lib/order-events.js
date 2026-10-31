// In-process SSE event hub. Run one Node process/instance, or replace with Redis pub/sub for multi-instance deployments.
const restaurantListeners = new Map();
const orderListeners = new Map();
function add(map, key, listener) {
  if (!map.has(key)) map.set(key, new Set());
  const set = map.get(key); set.add(listener);
  return () => { set.delete(listener); if (!set.size) map.delete(key); };
}
function emit(map, key, payload) {
  for (const listener of map.get(key) || []) {
    try { listener(payload); } catch (error) { console.error('Order event listener failed:', error); }
  }
}
module.exports = {
  subscribeRestaurant: (id, fn) => add(restaurantListeners, String(id), fn),
  subscribeOrder: (id, fn) => add(orderListeners, String(id), fn),
  publishNewOrder: (restaurantId, payload) => emit(restaurantListeners, String(restaurantId), payload),
  publishOrderStatus: (orderId, payload) => emit(orderListeners, String(orderId), payload),
};
