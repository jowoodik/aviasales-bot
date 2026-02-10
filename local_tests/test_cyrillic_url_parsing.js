/**
 * Тест парсинга URL с кириллическими IATA-кодами
 */

// Симуляция regex из AviasalesPricer.js
function testUrlParsing(url) {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  const searchPath = decodeURIComponent(pathParts[pathParts.length - 1]);

  console.log('URL:', url);
  console.log('searchPath (decoded):', searchPath);

  // Regex с поддержкой кириллицы
  const match = searchPath.match(/^([A-ZА-Я]{3})(\d{4})([A-ZА-Я]{3})(\d{4})?(\d)(\d)?(\d)?$/i);

  if (match) {
    const [, origin, depDate, destination, retDate, adults, children, infants] = match;
    console.log('✅ Успешно распарсено:');
    console.log('  origin:', origin);
    console.log('  depDate:', depDate);
    console.log('  destination:', destination);
    console.log('  retDate:', retDate || '(нет)');
    console.log('  adults:', adults);
    return true;
  } else {
    console.log('❌ Не удалось распарсить');
    return false;
  }
}

console.log('🧪 Тест парсинга URL с кириллицей\n');
console.log('═══════════════════════════════════════\n');

// Тест 1: URL с кириллицей (как в ошибке)
console.log('Тест 1: Кириллический код ХЖР');
testUrlParsing('https://www.aviasales.ru/search/UUD0508ХЖР12081');
console.log('');

// Тест 2: URL с латиницей
console.log('Тест 2: Латинский код LED');
testUrlParsing('https://www.aviasales.ru/search/MOW1503LED250321');
console.log('');

// Тест 3: URL с URL-encoded кириллицей (как приходит в реальности)
console.log('Тест 3: URL-encoded кириллица');
testUrlParsing('https://www.aviasales.ru/search/UUD0508%D0%A5%D0%96%D0%A0100');
console.log('');

// Тест 4: Без обратного билета
console.log('Тест 4: Без обратного билета');
testUrlParsing('https://www.aviasales.ru/search/MOW0801ХЖР1');
console.log('');

console.log('═══════════════════════════════════════');
