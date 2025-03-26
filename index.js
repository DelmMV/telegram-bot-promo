require('dotenv').config();
const { Telegraf, session, Scenes } = require('telegraf');
const mongoose = require('mongoose');
const connectDB = require('./database/connect');
const User = require('./database/models/user');
const Promo = require('./database/models/promo');
const { mainKeyboard } = require('./utils/keyboard');
const { formatDate } = require('./utils/helpers');
const { checkGroupMembership } = require('./middlewares/membership');
const { generatePromoCode } = require('./utils/promo-generator');

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Подключение к базе данных
connectDB();

// Добавляем строку для устранения предупреждения Mongoose
mongoose.set('strictQuery', false);

// Использование сессии
bot.use(session());

// Обработчик команды start
bot.start(async (ctx) => {
  try {
    const { id, first_name, last_name, username } = ctx.from;
    
    // Сохраняем или обновляем пользователя в базе данных
    await User.findOneAndUpdate(
      { telegramId: id },
      {
        firstName: first_name,
        lastName: last_name,
        username,
      },
      { upsert: true, new: true }
    );
    
    return ctx.reply(`Привет, ${first_name}! Добро пожаловать в бот промокодов.`, mainKeyboard);
  } catch (error) {
    console.error('Error in start command:', error);
    return ctx.reply('Произошла ошибка при запуске бота. Пожалуйста, попробуйте позже.');
  }
});

// Обработчик для списка промокодов
bot.hears('Промокоды', async (ctx) => {
  try {
    // Получаем все активные и не истекшие промокоды
    const currentDate = new Date();
    const promos = await Promo.find({
      isActive: true,
      expiresAt: { $gt: currentDate },
      $expr: { $lt: ["$usedCount", "$totalLimit"] }
    });
    
    if (promos.length === 0) {
      return ctx.reply('На данный момент активных промокодов нет.', mainKeyboard);
    }
    
    // Создаем клавиатуру с промокодами
    const { Markup } = require('telegraf');
    const keyboard = Markup.inlineKeyboard(
      promos.map(promo => [Markup.button.callback(promo.name, `promo:${promo._id}`)])
    );
    
    return ctx.reply('Выберите промокод из списка:', keyboard);
  } catch (error) {
    console.error('Error in promos list:', error);
    return ctx.reply('Произошла ошибка при загрузке промокодов.', mainKeyboard);
  }
});

// Обработчик для моих промокодов
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
      const { promoId, code, claimedAt, activated, activatedAt } = promoItem;
      
      // Проверяем, существует ли еще промокод в базе
      if (!promoId) {
        message += `🔄 Код: ${code}\n`;
        message += `Промокод был удален из системы\n`;
        message += `Получен: ${formatDate(claimedAt)}\n`;
        
        // Добавляем статус активации
        if (activated) {
          message += `Статус: ✅ Активирован ${formatDate(activatedAt)}\n`;
        } else {
          message += `Статус: ⏳ Ожидает активации\n`;
        }
        
        message += `\n`;
        continue;
      }
      
      // Определяем статус промокода
      let statusIcon = '';
      const isExpired = promoId.expiresAt < new Date();
      
      if (!promoId.isActive) {
        statusIcon = '❌'; // Неактивен
      } else if (isExpired) {
        statusIcon = '⏱️'; // Истек
      } else {
        statusIcon = '✅'; // Активен
      }
      
      message += `${statusIcon} ${promoId.name}\n`;
      message += `Код: ${code}\n`;
      message += `Описание: ${promoId.description}\n`;
      message += `Действителен до: ${formatDate(promoId.expiresAt)}\n`;
      message += `Получен: ${formatDate(claimedAt)}\n`;
      
      // Добавляем статус активации
      if (activated) {
        message += `Статус: 🔐 Использован ${formatDate(activatedAt)}\n`;
      } else {
        message += `Статус: 🔓 Доступен для использования\n`;
      }
      
      message += `\n`;
    }
    
    return ctx.reply(message, mainKeyboard);
  } catch (error) {
    console.error('Error in my promos handler:', error);
    return ctx.reply('Произошла ошибка при загрузке ваших промокодов.', mainKeyboard);
  }
});

// Обработка выбора промокода пользователем
bot.action(/promo:(.+)/, async (ctx) => {
  try {
    const promoId = ctx.match[1];
    const userId = ctx.from.id;
    
    // Получаем пользователя из базы данных
    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      return ctx.reply('Пользователь не найден. Пожалуйста, запустите бота с команды /start.');
    }
    
    // Проверяем, получал ли пользователь уже этот промокод
    const hasClaimedPromo = user.claimedPromos.some(
      promo => promo.promoId && promo.promoId.toString() === promoId
    );
    
    if (hasClaimedPromo) {
      return ctx.reply('Вы уже получили этот промокод.', mainKeyboard);
    }
    
    // Проверяем членство в группе
    const isMember = await checkGroupMembership(ctx);
    if (!isMember) {
      return ctx.reply(
        'Чтобы получить промокод, вы должны быть участником нашей группы.',
        mainKeyboard
      );
    }
    
    // Получаем промокод из базы данных
    const promo = await Promo.findById(promoId);
    if (!promo) {
      return ctx.reply('Промокод не найден.', mainKeyboard);
    }
    
    // Проверяем, активен ли промокод
    if (!promo.isActive) {
      return ctx.reply('Этот промокод больше не активен.', mainKeyboard);
    }
    
    // Проверяем, не истек ли срок действия промокода
    if (promo.expiresAt < new Date()) {
      return ctx.reply('Срок действия этого промокода истек.', mainKeyboard);
    }
    
    // Проверяем, не достигнут ли лимит использования промокода
    if (promo.usedCount >= promo.totalLimit) {
      return ctx.reply('Лимит использования этого промокода исчерпан.', mainKeyboard);
    }
    
    // Генерируем уникальный промокод для пользователя
    const generatedCode = generatePromoCode();
    
    // Обновляем счетчик использования промокода
    await Promo.findByIdAndUpdate(promoId, { $inc: { usedCount: 1 } });
    
    // Добавляем промокод в список полученных пользователем
    user.claimedPromos.push({
      promoId,
      code: generatedCode,
    });
    
    await user.save();
    
    // Отправляем пользователю промокод
    return ctx.reply(
      `Ваш промокод: ${generatedCode}\n\n` +
      `Описание: ${promo.description}\n` + 
      `Действителен до: ${formatDate(promo.expiresAt)}`,
      mainKeyboard
    );
  } catch (error) {
    console.error('Error handling promo action:', error);
    return ctx.reply('Произошла ошибка при получении промокода.', mainKeyboard);
  }
});

// Загружаем обработчики для админ-панели
const adminHandler = require('./handlers/admin');
adminHandler(bot);

// Запуск бота
bot.launch()
  .then(() => console.log('Bot started'))
  .catch((err) => console.error('Error starting bot:', err));

// Включение graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));