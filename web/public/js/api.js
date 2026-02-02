// web/public/js/api.js

import CONFIG from './config.js';

class APIClient {
    constructor() {
        this.baseURL = CONFIG.API_BASE;
    }

    /**
     * Generic request handler
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;

        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'same-origin'
        };

        const finalOptions = { ...defaultOptions, ...options };

        try {
            const response = await fetch(url, finalOptions);

            // Handle non-JSON responses (like CSV exports)
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/csv')) {
                return await response.blob();
            }

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP error! status: ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('API Request Error:', error);
            throw error;
        }
    }

    /**
     * GET request
     */
    async get(endpoint, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${endpoint}?${queryString}` : endpoint;

        return this.request(url, {
            method: 'GET'
        });
    }

    /**
     * POST request
     */
    async post(endpoint, data = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    /**
     * PUT request
     */
    async put(endpoint, data = {}) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    /**
     * PATCH request
     */
    async patch(endpoint, data = {}) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }

    /**
     * DELETE request
     */
    async delete(endpoint) {
        return this.request(endpoint, {
            method: 'DELETE'
        });
    }

    // ============================================
    // USERS API
    // ============================================

    async getUsers() {
        return this.get(CONFIG.API.USERS);
    }

    async getUserById(chatId) {
        return this.get(CONFIG.API.USER_DETAIL(chatId));
    }

    async getUserStats(chatId) {
        return this.get(CONFIG.API.USER_STATS(chatId));
    }

    async updateUser(chatId, data) {
        return this.put(CONFIG.API.USER_DETAIL(chatId), data);
    }

    async deleteUser(chatId) {
        return this.delete(CONFIG.API.USER_DETAIL(chatId));
    }

    // ============================================
    // ROUTES API
    // ============================================

    async getRoutes() {
        return this.get(CONFIG.API.ROUTES);
    }

    async getRouteById(id) {
        return this.get(CONFIG.API.ROUTE_DETAIL(id));
    }

    async createRoute(data) {
        return this.post(CONFIG.API.ROUTES, data);
    }

    async updateRoute(id, data) {
        return this.put(CONFIG.API.ROUTE_DETAIL(id), data);
    }

    async deleteRoute(id) {
        return this.delete(CONFIG.API.ROUTE_DETAIL(id));
    }

    async pauseRoute(id, isPaused) {
        return this.patch(CONFIG.API.ROUTE_PAUSE(id), { is_paused: isPaused });
    }

    async updateRouteThreshold(id, thresholdPrice) {
        return this.patch(CONFIG.API.ROUTE_THRESHOLD(id), { threshold_price: thresholdPrice });
    }

    // ============================================
    // SUBSCRIPTIONS API
    // ============================================

    async getSubscriptions() {
        return this.get(CONFIG.API.SUBSCRIPTIONS);
    }

    async getSubscriptionById(id) {
        return this.get(CONFIG.API.SUBSCRIPTION_DETAIL(id));
    }

    async createSubscription(data) {
        return this.post(CONFIG.API.SUBSCRIPTIONS, data);
    }

    async updateSubscription(id, data) {
        return this.put(CONFIG.API.SUBSCRIPTION_DETAIL(id), data);
    }

    async deleteSubscription(id) {
        return this.delete(CONFIG.API.SUBSCRIPTION_DETAIL(id));
    }

    // ============================================
    // BROADCASTS API
    // ============================================
    async getBroadcasts() {
        return this.get(CONFIG.API.BROADCASTS);
    }

    async getBroadcastById(id) {
        return this.get(CONFIG.API.BROADCAST_DETAIL(id));
    }

    async createBroadcast(data) {
        return this.post(CONFIG.API.BROADCASTS, data);
    }

    async updateBroadcast(id, data) {
        return this.put(CONFIG.API.BROADCAST_DETAIL(id), data);
    }

    async deleteBroadcast(id) {
        return this.delete(CONFIG.API.BROADCAST_DETAIL(id));
    }

    async getBroadcastUsers() {
        return this.get(CONFIG.API.BROADCAST_USERS);
    }

    // ============================================
    // STATISTICS API
    // ============================================

    async getCheckStats() {
        return this.get(CONFIG.API.CHECK_STATS);
    }

    async getFailedChecks() {
        return this.get(CONFIG.API.FAILED_CHECKS);
    }

    async getAnalytics() {
        return this.get(CONFIG.API.ANALYTICS);
    }

    // ============================================
    // DATABASE API
    // ============================================

    async getDatabaseInfo() {
        return this.get(CONFIG.API.DATABASE_INFO);
    }

    async getTableData(tableName, limit = 50) {
        return this.get(CONFIG.API.TABLE_DATA(tableName), { limit });
    }

    async createBackup() {
        return this.post(CONFIG.API.BACKUP);
    }

    async vacuumDatabase() {
        return this.post(CONFIG.API.VACUUM);
    }

    async cleanupDatabase(days) {
        return this.post(CONFIG.API.CLEANUP, { days });
    }

    async executeSQLQuery(query) {
        return this.post(CONFIG.API.SQL_QUERY, { query });
    }

    // ============================================
    // EXPORT API
    // ============================================

    async exportData(type) {
        const blob = await this.get(CONFIG.API.EXPORT(type));
        return blob;
    }

    /**
     * Download exported file
     */
    downloadExport(blob, filename) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }
}

// Create singleton instance
const api = new APIClient();

export default api;
