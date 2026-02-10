// 🧪 Тест для проверки getDirectionPriceStats и getGlobalStats
const db = require('../config/database');
const RouteResult = require('../models/RouteResult');

async function runTests() {
    console.log('\n🧪 ТЕСТИРОВАНИЕ СТАТИСТИКИ ЦЕН ПО НАПРАВЛЕНИЮ\n');
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✅ ${message}`);
            passed++;
        } else {
            console.log(`  ❌ FAIL: ${message}`);
            failed++;
        }
    }

    // 1. Направления в price_analytics с живыми маршрутами
    console.log('='.repeat(60));
    console.log('1. Направления в price_analytics (только живые маршруты):');
    console.log('='.repeat(60));

    const directions = await new Promise((resolve, reject) => {
        db.all(`
            SELECT pa.origin, pa.destination, ur.has_return,
                   COUNT(*) as cnt,
                   MIN(pa.price / (ur.adults + COALESCE(ur.children, 0))) as min_pp,
                   ROUND(AVG(pa.price / (ur.adults + COALESCE(ur.children, 0)))) as avg_pp
            FROM price_analytics pa
            JOIN unified_routes ur ON pa.route_id = ur.id
            WHERE pa.found_at > datetime('now', '-30 days')
            GROUP BY pa.origin, pa.destination, ur.has_return
            ORDER BY cnt DESC
            LIMIT 15
        `, (err, rows) => err ? reject(err) : resolve(rows || []));
    });

    if (directions.length === 0) {
        console.log('  ❌ Нет данных с живыми маршрутами!');
    } else {
        directions.forEach(d => {
            const rt = d.has_return ? 'RT' : 'OW';
            console.log(`  ${d.origin} → ${d.destination} [${rt}]: ${d.cnt} записей, min_pp=${Math.round(d.min_pp)}, avg_pp=${d.avg_pp}`);
        });
    }

    // 2. Orphan records
    console.log('\n' + '='.repeat(60));
    console.log('2. Orphan records (удалённые маршруты, исключаются из статистики):');
    console.log('='.repeat(60));

    const orphanStats = await new Promise((resolve, reject) => {
        db.get(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN ur.id IS NULL THEN 1 ELSE 0 END) as orphans
            FROM price_analytics pa
            LEFT JOIN unified_routes ur ON pa.route_id = ur.id
            WHERE pa.found_at > datetime('now', '-30 days')
        `, (err, row) => err ? reject(err) : resolve(row));
    });

    console.log(`  Всего: ${orphanStats.total}, orphan (игнорируются): ${orphanStats.orphans}`);

    // 3. getDirectionPriceStats — RT (туда-обратно)
    console.log('\n' + '='.repeat(60));
    console.log('3. getDirectionPriceStats — туда-обратно (has_return=true):');
    console.log('='.repeat(60));

    const dirRT = await new Promise((resolve, reject) => {
        db.get(`
            SELECT pa.origin, pa.destination
            FROM price_analytics pa
            JOIN unified_routes ur ON pa.route_id = ur.id
            WHERE pa.found_at > datetime('now', '-30 days') AND ur.has_return = 1
            GROUP BY pa.origin, pa.destination
            ORDER BY COUNT(*) DESC LIMIT 1
        `, (err, row) => err ? reject(err) : resolve(row));
    });

    if (dirRT) {
        console.log(`  Тестируем: ${dirRT.origin} → ${dirRT.destination} [RT]`);
        const stats = await RouteResult.getDirectionPriceStats(dirRT.origin, dirRT.destination, true);
        assert(stats !== null, 'Вернул данные для RT');
        assert(stats && stats.min_price_per_person > 0, `min_pp = ${stats?.min_price_per_person}`);
        assert(stats && stats.avg_price_per_person > 0, `avg_pp = ${stats?.avg_price_per_person}`);
        assert(stats && stats.min_price_per_person <= stats.avg_price_per_person, 'min <= avg');

        // Проверяем что OW для того же направления даёт другой результат (или null)
        const statsOW = await RouteResult.getDirectionPriceStats(dirRT.origin, dirRT.destination, false);
        if (statsOW) {
            console.log(`  Сравнение: RT min_pp=${Math.round(stats.min_price_per_person)} vs OW min_pp=${Math.round(statsOW.min_price_per_person)}`);
        } else {
            console.log(`  OW данных нет для этого направления (ожидаемо)`);
        }
    } else {
        console.log('  ⚠️ Нет RT направлений, пропускаем');
    }

    // 4. getDirectionPriceStats — OW (в одну сторону)
    console.log('\n' + '='.repeat(60));
    console.log('4. getDirectionPriceStats — в одну сторону (has_return=false):');
    console.log('='.repeat(60));

    const dirOW = await new Promise((resolve, reject) => {
        db.get(`
            SELECT pa.origin, pa.destination
            FROM price_analytics pa
            JOIN unified_routes ur ON pa.route_id = ur.id
            WHERE pa.found_at > datetime('now', '-30 days') AND ur.has_return = 0
            GROUP BY pa.origin, pa.destination
            ORDER BY COUNT(*) DESC LIMIT 1
        `, (err, row) => err ? reject(err) : resolve(row));
    });

    if (dirOW) {
        console.log(`  Тестируем: ${dirOW.origin} → ${dirOW.destination} [OW]`);
        const stats = await RouteResult.getDirectionPriceStats(dirOW.origin, dirOW.destination, false);
        assert(stats !== null, 'Вернул данные для OW');
        assert(stats && stats.min_price_per_person > 0, `min_pp = ${stats?.min_price_per_person}`);
    } else {
        console.log('  ⚠️ Нет OW направлений, пропускаем');
    }

    // 5. Несуществующее направление
    console.log('\n' + '='.repeat(60));
    console.log('5. getDirectionPriceStats — несуществующее направление:');
    console.log('='.repeat(60));

    const noStats = await RouteResult.getDirectionPriceStats('XXX', 'YYY', true);
    assert(noStats === null, 'Несуществующее направление → null');

    // 6. getGlobalStats
    console.log('\n' + '='.repeat(60));
    console.log('6. getGlobalStats:');
    console.log('='.repeat(60));

    const globalStats = await RouteResult.getGlobalStats();
    assert(typeof globalStats.totalCombinations === 'number', `totalCombinations = ${globalStats.totalCombinations}`);
    assert(typeof globalStats.belowBudgetCount === 'number', `belowBudgetCount = ${globalStats.belowBudgetCount}`);

    // 7. Активные маршруты
    console.log('\n' + '='.repeat(60));
    console.log('7. Активные маршруты — проверка getDirectionPriceStats:');
    console.log('='.repeat(60));

    const routes = await new Promise((resolve, reject) => {
        db.all(`
            SELECT id, origin, destination, adults, children, has_return
            FROM unified_routes
            WHERE is_archived = 0
            ORDER BY id DESC
            LIMIT 20
        `, (err, rows) => err ? reject(err) : resolve(rows || []));
    });

    let routesWithStats = 0;
    let routesWithoutStats = 0;
    for (const route of routes) {
        const stats = await RouteResult.getDirectionPriceStats(route.origin, route.destination, !!route.has_return);
        const rt = route.has_return ? 'RT' : 'OW';
        const totalPax = route.adults + (route.children || 0);
        if (stats) {
            routesWithStats++;
            const totalMin = Math.round(stats.min_price_per_person * totalPax);
            const totalAvg = Math.round(stats.avg_price_per_person * totalPax);
            console.log(`  ✅ #${route.id}: ${route.origin}→${route.destination} [${rt}] ${totalPax} пасс. | ${totalMin} - ${totalAvg}`);
        } else {
            routesWithoutStats++;
            console.log(`  ⚠️ #${route.id}: ${route.origin}→${route.destination} [${rt}] — нет данных → глобальная статистика`);
        }
    }
    console.log(`\n  Со статистикой: ${routesWithStats}, без: ${routesWithoutStats}`);

    // Итого
    console.log('\n' + '='.repeat(60));
    console.log(`ИТОГО: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('❌ Ошибка:', err);
    process.exit(1);
});
