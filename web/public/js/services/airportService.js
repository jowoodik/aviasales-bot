// web/public/js/services/airportService.js

import CONFIG from '../config.js';

class AirportService {
    constructor() {
        this._cache = null;
        this._loading = null;
    }

    async load() {
        if (this._cache) return this._cache;
        if (this._loading) return this._loading;

        this._loading = (async () => {
            try {
                const response = await fetch(`${CONFIG.API_BASE}${CONFIG.API.AIRPORTS}`);
                if (!response.ok) {
                    throw new Error('Failed to load airports');
                }
                this._cache = await response.json();
                console.log(`✅ AirportService: загружено ${Object.keys(this._cache).length} аэропортов`);
                return this._cache;
            } catch (error) {
                console.error('❌ AirportService load error:', error);
                this._cache = {};
                return this._cache;
            } finally {
                this._loading = null;
            }
        })();

        return this._loading;
    }

    getCityName(code) {
        if (!code) return code;
        if (!this._cache) return code;
        return this._cache[code] || code;
    }

    formatCode(code) {
        if (!code) return code;
        const city = this.getCityName(code);
        if (city === code) return code;
        return `${city} (${code})`;
    }

    formatRoute(origin, destination) {
        return `${this.formatCode(origin)} → ${this.formatCode(destination)}`;
    }

    isLoaded() {
        return this._cache !== null;
    }
}

// Синглтон
const airportService = new AirportService();
export default airportService;
