#!/usr/bin/env node
/**
 * Локальное тестирование генерации отчётов.
 *
 * Использование:
 *   node test-reports.js                  — все маршруты первого пользователя с маршрутами
 *   node test-reports.js 341508411        — маршруты конкретного chat_id
 *   node test-reports.js --all            — все пользователи с активными маршрутами
 */

require('dotenv').config();
const db = require('../config/database');
const RouteResult = require('../models/RouteResult');
const airportResolver = require('../utils/AirportCodeResolver');

// Мок-бот: вместо Telegram выводим в консоль
const mockBot = {
  sendMessage(chatId, text, opts = {}) {
    const silent = opts.disable_notification ? ' [SILENT]' : '';
    const buttons = opts.reply_markup?.inline_keyboard
      ?.map(row => row.map(b => `  [${b.text}] → ${b.url}`).join('\n'))
      .join('\n');

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📤 СООБЩЕНИЕ → chat_id: ${chatId}${silent}`);
    console.log('═'.repeat(60));
    console.log(text);
    if (buttons) {
      console.log('\n🔘 Кнопки:');
      console.log(buttons);
    }
    console.log('═'.repeat(60));
    return Promise.resolve();
  }
};

const NotificationService = require('../services/NotificationService');
// const TelegramBot = require("node-telegram-bot-api");
// const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// const bot = new TelegramBot(TOKEN, { polling: false });
// const notificationService = new NotificationService(bot);
const notificationService = new NotificationService(mockBot);

// ─── Хелперы ────────────────────────────────────────────────

function getAllUsersWithRoutes() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT DISTINCT chat_id FROM unified_routes WHERE is_paused = 0 ORDER BY chat_id`,
      (err, rows) => {
        if (err) reject(err);
        else resolve((rows || []).map(r => r.chat_id));
      }
    );
  });
}

function getUserActiveRoutes(chatId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM unified_routes WHERE chat_id = ? AND is_paused = 0 ORDER BY id`,
      [chatId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

function getUserSettings(chatId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM user_settings WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) reject(err);
      else resolve(row || {
        chat_id: chatId,
        timezone: 'Asia/Yekaterinburg',
        notifications_enabled: 1,
        night_mode: 1,
        digest_enabled: 1
      });
    });
  });
}

function getSubscription(chatId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT subscription_type FROM user_subscriptions
       WHERE chat_id = ? AND is_active = 1
       AND (valid_to IS NULL OR valid_to > datetime('now'))`,
      [chatId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row?.subscription_type || 'free');
      }
    );
  });
}

// ─── Основная логика ────────────────────────────────────────

async function testUserReport(chatId) {
  const routes = await getUserActiveRoutes(chatId);
  if (routes.length === 0) {
    console.log(`\n⚠️  Нет активных маршрутов для chat_id: ${chatId}`);
    return;
  }

  const userSettings = await getUserSettings(chatId);
  const subscriptionType = await getSubscription(chatId);
  const timezone = userSettings.timezone || 'Asia/Yekaterinburg';

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`👤 Пользователь: ${chatId}`);
  console.log(`📦 Подписка: ${subscriptionType}`);
  console.log(`🌍 Таймзона: ${timezone}`);
  console.log(`🔔 Уведомления: ${userSettings.notifications_enabled !== 0 ? 'вкл' : 'выкл'}`);
  console.log(`🌙 Ночной режим: ${userSettings.night_mode !== 0 ? 'вкл' : 'выкл'}`);
  console.log(`📊 Дайджест: ${userSettings.digest_enabled !== 0 ? 'вкл' : 'выкл'}`);
  console.log(`✈️  Маршрутов: ${routes.length}`);
  console.log('─'.repeat(60));

  const routeBlocks = [];

  for (const route of routes) {
    console.log(`\n🔍 Маршрут #${route.id}: ${route.origin} → ${route.destination} (бюджет: ${route.threshold_price}₽)`);

    // Лучший результат из БД
    const bestResults = await RouteResult.getTopResults(route.id, 1);
    const bestResult = bestResults[0] || null;

    // Аналитика
    const analytics = await notificationService.getRouteAnalytics(route.id);

    // Статистика комбинаций
    const checkStats = await notificationService.getRouteCheckStats(route.id);

    // Текущая цена
    const currentPrice = bestResult?.total_price;

    // Классификация приоритета
    let priority = 'LOW';
    let reasons = ['Нет данных о цене'];

    if (currentPrice) {
      const priceDropPercent = await notificationService.getPriceDropPercent(route.id, currentPrice);

      const classified = notificationService.classifyPriority({
        currentPrice,
        userBudget: route.threshold_price,
        avgPrice: analytics.avgPrice,
        historicalMin: analytics.minPrice,
        priceDropPercent
      });
      priority = classified.priority;
      reasons = classified.reasons;

      console.log(`   💰 Цена: ${currentPrice}₽`);
      console.log(`   📊 Средняя: ${analytics.avgPrice ? Math.round(analytics.avgPrice) + '₽' : 'н/д'} (${analytics.dataPoints} точек)`);
      console.log(`   📉 Минимум: ${analytics.minPrice ? Math.round(analytics.minPrice) + '₽' : 'н/д'}`);
      console.log(`   📉 Падение за 24ч: ${priceDropPercent ? Math.round(priceDropPercent) + '%' : '0%'}`);
    } else {
      console.log(`   ❌ Нет найденных цен`);
    }

    const priorityEmoji = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' };
    console.log(`   ${priorityEmoji[priority]} Приоритет: ${priority} — ${reasons.join(', ')}`);

    // Симуляция маршрутизации
    const routeResult = await notificationService.processAndRouteNotification({
      chatId,
      routeId: route.id,
      route,
      priority,
      reasons,
      currentPrice,
      analytics,
      bestResult,
      checkStats,
      userSettings,
      subscriptionType
    });
    console.log(`   📨 Решение: ${routeResult.action}${routeResult.reason ? ` (${routeResult.reason})` : ''}`);

    if (checkStats) {
      const cur = checkStats.current;
      console.log(`   📋 Комбинации: ${cur.successful_checks + cur.failed_checks}/${cur.total_combinations} (всего: ${checkStats.totalAllCombinations})`);
    }

    // Формируем блок
    const block = notificationService.formatSingleRouteBlock(route, bestResult, analytics, checkStats);
    routeBlocks.push({ block, route, priority });
  }

  // Сводный отчёт
  console.log(`\n\n${'▓'.repeat(60)}`);
  console.log('  📋 СВОДНЫЙ ОТЧЁТ (как получит пользователь)');
  console.log('▓'.repeat(60));

  await notificationService.sendConsolidatedReport(chatId, routeBlocks, timezone, true);

  // Показываем отдельный блок каждого маршрута для отладки
  console.log(`\n\n${'▓'.repeat(60)}`);
  console.log('  🔬 ОТДЕЛЬНЫЕ БЛОКИ (для отладки)');
  console.log('▓'.repeat(60));

  for (const { block, route, priority } of routeBlocks) {
    const emoji = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' };
    console.log(`\n${emoji[priority]} [${priority}] Маршрут #${route.id}:`);
    console.log('─'.repeat(40));
    console.log(block.text);
    if (block.searchLink) {
      console.log(`🔗 ${block.searchLink}`);
    }
  }
}

async function main() {
  try {
    await airportResolver.load();

    const arg = process.argv[2];

    if (arg === '--all') {
      const users = await getAllUsersWithRoutes();
      console.log(`\n📊 Найдено ${users.length} пользователей с маршрутами\n`);
      for (const chatId of users) {
        await testUserReport(chatId);
      }
    } else {
      let chatId;
      if (arg) {
        chatId = parseInt(arg);
      } else {
        const users = await getAllUsersWithRoutes();
        if (users.length === 0) {
          console.log('❌ Нет пользователей с активными маршрутами в БД');
          process.exit(1);
        }
        chatId = users[0];
        console.log(`ℹ️  chat_id не указан, используем первого пользователя: ${chatId}`);
      }
      await testUserReport(chatId);
    }

    console.log('\n✅ Тест завершён');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Ошибка:', error);
    process.exit(1);
  }
}

main();
