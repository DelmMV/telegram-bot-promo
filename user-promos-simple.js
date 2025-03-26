require('dotenv').config();
const { Telegraf, session, Scenes } = require('telegraf');
const mongoose = require('mongoose');
const connectDB = require('./database/connect');
const User = require('./database/models/user');
const { mainKeyboard } = require('./utils/keyboard');
const { formatDate } = require('./utils/helpers');

// Подключение к базе данных
connectDB();

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Использование сессии
bot.use(session());

// Обработчик команды /mypromos
bot.command('mypromos', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    // Получаем пользователя из базы данных
    const user = await User.findOne({ telegramId: userId })
      .populate('claimedPromos.promoId');
    
    if (!user || !user.claimedPromos || user.claimedPromos.length === 0) {
      return ctx.reply('У вас пока нет полученных промокодов.', mainKeyboard);
    }
    
    // Сортируем промокоды по дате получения (от новых к старым)
    const sortedPromos = [...user.claimedPromos].sort((a, b) => 
      new Date(b.claimedAt) - new Date(a.claimedAt)
    );
    
    // Формируем сообщение со списком промокодов
    let message = 'Ваши промокоды:\n\n';
    
    for (const promoItem of sortedPromos) {
      const { promoId, code, claimedAt } = promoItem;
      
      // Проверяем, существует ли еще промокод в базе
      if (!promoId) {
        message += `🔄 Код: ${code}\n`;
        message += `Промокод был удален из системы\n`;
        message += `Получен: ${formatDate(claimedAt)}\n\n`;
        continue;
      }
      
      // Определяем статус промокода
      let status = '';
      const isExpired = promoId.expiresAt < new Date();
      
      if (!promoId.isActive) {
        status = '❌ Неактивен';
      } else if (isExpired) {
        status = '⏱️ Истек';
      } else {
        status = '✅ Активен';
      }
      
      message += `${status} ${promoId.name}\n`;
      message += `Код: ${code}\n`;
      message += `Описание: ${promoId.description}\n`;
      message += `Действителен до: ${formatDate(promoId.expiresAt)}\n`;
      message += `Получен: ${formatDate(claimedAt)}\n\n`;
    }
    
    return ctx.reply(message, mainKeyboard);
  } catch (error) {
    console.error('Error in mypromos command:', error);
    return ctx.reply('Произошла ошибка при загрузке ваших промокодов.', mainKeyboard);
  }
});

// Обработчик для кнопки "Мои промокоды"
bot.hears('Мои промокоды', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    // Получаем пользователя из базы данных
    const user = await User.findOne({ telegramId: userId })
      .populate('claimedPromos.promoId');
    
    if (!user || !user.claimedPromos || user.claimedPromos.length === 0) {
      return ctx.reply('У вас пока нет полученных промокодов.', mainKeyboard);
    }
    
    // Сортируем промокоды по дате получения (от новых к старым)
    const sortedPromos = [...user.claimedPromos].sort((a, b) => 
      new Date(b.claimedAt) - new Date(a.claimedAt)
    );
    
    // Формируем сообщение со списком промокодов
    let message = 'Ваши промокоды:\n\n';
    
    for (const promoItem of sortedPromos) {
      const { promoId, code, claimedAt } = promoItem;
      
      // Проверяем, существует ли еще промокод в базе
      if (!promoId) {
        message += `🔄 Код: ${code}\n`;
        message += `Промокод был удален из системы\n`;
        message += `Получен: ${formatDate(claimedAt)}\n\n`;
        continue;
      }
      
      // Определяем статус промокода
      let status = '';
      const isExpired = promoId.expiresAt < new Date();
      
      if (!promoId.isActive) {
        status = '❌ Неактивен';
      } else if (isExpired) {
        status = '⏱️ Истек';
      } else {
        status = '✅ Активен';
      }
      
      message += `${status} ${promoId.name}\n`;
      message += `Код: ${code}\n`;
      message += `Описание: ${promoId.description}\n`;
      message += `Действителен до: ${formatDate(promoId.expiresAt)}\n`;
      message += `Получен: ${formatDate(claimedAt)}\n\n`;
    }
    
    return ctx.reply(message, mainKeyboard);
  } catch (error) {
    console.error('Error in mypromos button handler:', error);
    return ctx.reply('Произошла ошибка при загрузке ваших промокодов.', mainKeyboard);
  }
});

// Запуск бота
bot.launch()
  .then(() => console.log('User promos bot started'))
  .catch((err) => console.error('Error starting user promos bot:', err));

// Включение graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));