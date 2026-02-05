const db = require('../config/database');

class AirportCodeResolver {
  constructor() {
    this._cache = new Map();
    this._loaded = false;
  }

  async load() {
    if (this._loaded) return;

    return new Promise((resolve, reject) => {
      db.all(
        `SELECT iata_code, city_name, city_name_en, country_name
         FROM airports
         GROUP BY iata_code`,
        [],
        (err, rows) => {
          if (err) {
            console.error('❌ Ошибка загрузки аэропортов:', err.message);
            reject(err);
            return;
          }

          for (const row of (rows || [])) {
            this._cache.set(row.iata_code, {
              cityName: row.city_name,
              cityNameEn: row.city_name_en,
              countryName: row.country_name
            });
          }

          this._loaded = true;
          console.log(`✅ AirportCodeResolver: загружено ${this._cache.size} аэропортов`);
          resolve();
        }
      );
    });
  }

  getCityName(iataCode) {
    if (!iataCode) return iataCode;
    const entry = this._cache.get(iataCode);
    return entry ? entry.cityName : iataCode;
  }

  formatRoute(origin, destination) {
    return `${this.getCityName(origin)} → ${this.getCityName(destination)}`;
  }
}

// Синглтон
module.exports = new AirportCodeResolver();
