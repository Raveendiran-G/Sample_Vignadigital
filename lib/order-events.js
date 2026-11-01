// In-process live order notification system.

const restaurantListeners = new Map();
const orderListeners = new Map();

function add(map, key, listener) {
    if (!map.has(key)) {
        map.set(key, new Set());
    }

    const listeners = map.get(key);
    listeners.add(listener);

    return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
            map.delete(key);
        }
    };
}

function emit(map, key, payload) {
    for (const listener of map.get(key) || []) {
        try {
            listener(payload);
        } catch (error) {
            console.error('Order event listener failed:', error);
        }
    }
}

module.exports = {
    subscribeRestaurant: (id, fn) =>
        add(restaurantListeners, String(id), fn),

    subscribeOrder: (id, fn) =>
        add(orderListeners, String(id), fn),

    publishNewOrder: (restaurantId, payload) =>
        emit(restaurantListeners, String(restaurantId), payload),

    publishOrderStatus: (orderId, payload) =>
        emit(orderListeners, String(orderId), payload)
};