require('dotenv').config();
const { Telegraf, session, Scenes, Markup } = require('telegraf');
const mongoose = require('mongoose');
const connectDB = require('./database/connect');
const User = require('./database/models/user');
const Admin = require('./database/models/admin');
const Promo = require('./database/models/promo');
const ActivatedPromo = require('./database/models/activatedPromo');
const { mainKeyboard, sellerKeyboard, adminKeyboard } = require('./utils/keyboard');
const { formatDate } = require('./utils/helpers');
const { checkGroupMembership } = require('./middlewares/membership');
const { generatePromoCode } = require('./utils/promo-generator');
const { isAdmin, isSeller } = require('./middlewares/auth');
const { isPrivateChat } = require('./middlewares/private-chat');

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Подключение к базе данных
connectDB();

// Устраняем предупреждение Mongoose
mongoose.set('strictQuery', false);

// Настройка сессии
bot.use(session());
bot.use((ctx, next) => {
  // Пропускаем обновления без сообщений или без текста
  if (!ctx.message || !ctx.message.text) {
    return next();
  }
  
  // Если это команда (/command) и не приватный чат - игнорируем
  if (ctx.message.text.startsWith('/') && ctx.chat && ctx.chat.type !== 'private') {
    console.log(`Блокирована команда в групповом чате: ${ctx.message.text}, тип чата: ${ctx.chat.type}`);
    return; // Прерываем выполнение middleware
  }
  
  // В других случаях продолжаем обработку
  return next();
});

// Импортируем обработчики
const adminHandler = require('./handlers/admin');
const sellerHandler = require('./handlers/seller');

// Получаем сцены из обработчиков
const { scenes: adminScenes } = adminHandler(bot);
const { scenes: sellerScenes, registerSellerHandlers } = sellerHandler(bot);

// Выводим информацию о сценах для отладки
console.log('Admin scenes:', adminScenes.map(scene => scene.id));
console.log('Seller scenes:', sellerScenes.map(scene => scene.id));

// Базовая сцена для списка промокодов
const promoListScene = new Scenes.BaseScene('promo-list');
promoListScene.enter(async (ctx) => {
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
    const keyboard = Markup.inlineKeyboard(
      promos.map(promo => [Markup.button.callback(promo.name, `promo:${promo._id}`)])
    );
    
    return ctx.reply('Выберите промокод из списка:', keyboard);
  } catch (error) {
    console.error('Error in promos list:', error);
    return ctx.reply('Произошла ошибка при загрузке промокодов.', mainKeyboard);
  }
});

// Все сцены вместе
const allScenes = [...adminScenes, ...sellerScenes, promoListScene];

// Проверяем наличие дубликатов
const sceneIds = {};
const uniqueScenes = [];

for (const scene of allScenes) {
  if (!sceneIds[scene.id]) {
    sceneIds[scene.id] = true;
    uniqueScenes.push(scene);
    console.log(`Регистрируем сцену: ${scene.id}`);
  } else {
    console.log(`Дубликат сцены обнаружен и пропущен: ${scene.id}`);
  }
}

console.log('Зарегистрированные сцены:', uniqueScenes.map(scene => scene.id));

// Создаем Stage
const stage = new Scenes.Stage(uniqueScenes);
bot.use(stage.middleware());

// Регистрируем обработчики продавца
registerSellerHandlers();

// Обработчик команды start - только для приватных чатов
bot.command('start', isPrivateChat, async (ctx) => {
  try {
    const { id, first_name, last_name, username } = ctx.from;
    
    // Сохраняем или обновляем пользователя в базе данных
    const user = await User.findOneAndUpdate(
      { telegramId: id },
      {
        firstName: first_name,
        lastName: last_name,
        username,
      },
      { upsert: true, new: true }
    );
    
    // Также обновляем информацию, если пользователь - продавец или администратор
    const admin = await Admin.findOne({ telegramId: id });
    if (admin) {
      admin.firstName = first_name || admin.firstName;
      admin.lastName = last_name || admin.lastName;
      admin.username = username || admin.username;
      await admin.save();
    }
    
    return ctx.reply(`Привет, ${first_name}! Добро пожаловать в бот промокодов.`, mainKeyboard);
  } catch (error) {
    console.error('Error in start command:', error);
    return ctx.reply('Произошла ошибка при запуске бота. Пожалуйста, попробуйте позже.');
  }
});

// Команда для получения ID пользователя - доступна и в группах
bot.command('myid', (ctx) => {
  ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`);
});

// Обработчик для команды /admin - только для приватных чатов
bot.command('admin', isPrivateChat, async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const admin = await Admin.findOne({ telegramId, isActive: true, role: 'admin' });
    
    if (!admin) {
      return ctx.reply('У вас нет доступа к админ-панели.');
    }
    
    return ctx.reply('Добро пожаловать в админ-панель.', adminKeyboard);
  } catch (error) {
    console.error('Error in admin command:', error);
    return ctx.reply('Произошла ошибка при входе в админ-панель.');
  }
});

// Обработчик команды /seller - только для приватных чатов
bot.command('seller', isPrivateChat, async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    console.log(`Пользователь ${telegramId} запустил команду /seller в приватном чате`);
    
    const seller = await Admin.findOne({ 
      telegramId, 
      isActive: true,
      $or: [{ role: 'seller' }, { role: 'admin' }]
    });
    
    if (!seller) {
      return ctx.reply('У вас нет доступа к панели продавца.');
    }
    
    return ctx.reply('Добро пожаловать в панель продавца.', sellerKeyboard);
  } catch (error) {
    console.error('Error in seller command:', error);
    return ctx.reply('Произошла ошибка при входе в панель продавца.');
  }
});

// Обработчик для списка промокодов - проверяем только в приватном чате
bot.hears('Промокоды', isPrivateChat, (ctx) => {
  return ctx.scene.enter('promo-list');
});

// Обработчик для моих промокодов - проверяем только в приватном чате
bot.hears('Мои промокоды', isPrivateChat, async (ctx) => {
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
          message += `Статус: ✅ Использован ${formatDate(activatedAt)}\n`;
        } else {
          message += `Статус: ⏳ Доступен для использования\n`;
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
      
      // Добавляем статус активации этого конкретного промокода
      if (activated) {
        message += `Статус: 🔐 Использован ${formatDate(activatedAt)}\n`;
      } else {
        // Проверяем тип промокода - если он истек или неактивен, отражаем это
        if (!promoId.isActive) {
          message += `Статус: ❌ Недоступен (промоакция отменена)\n`;
        } else if (isExpired) {
          message += `Статус: ⏱️ Недоступен (срок действия истек)\n`;
        } else {
          message += `Статус: 🔓 Доступен для использования\n`;
        }
      }
      
      message += `\n`;
    }
    
    return ctx.reply(message, mainKeyboard);
  } catch (error) {
    console.error('Error in my promos handler:', error);
    return ctx.reply('Произошла ошибка при загрузке ваших промокодов.', mainKeyboard);
  }
});

// Обработчик для кнопки администратора "Активировать промокод вручную" - только в приватном чате
bot.hears('Активировать промокод вручную', isPrivateChat, isAdmin, (ctx) => {
  ctx.scene.enter('activate-promo');
});

// Обработчик для кнопки "История активаций" - только в приватном чате
bot.hears('История активаций', isPrivateChat, isAdmin, (ctx) => {
  ctx.scene.enter('activated-promos');
});

// Обработка выбора промокода пользователем - inline кнопки работают и в группах
bot.action(/promo:(.+)/, async (ctx) => {
  try {
    // Проверяем, что это приватный чат
    if (ctx.chat.type !== 'private') {
      await ctx.answerCbQuery('Эта функция доступна только в приватном чате с ботом.');
      return;
    }
    
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
      claimedAt: new Date(),
      activated: false,
      activatedAt: null
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

// Обработка кнопок меню админ-панели - только в приватном чате
bot.hears('Управление промокодами', isPrivateChat, isAdmin, (ctx) => {
  ctx.reply('Выберите действие:', Markup.keyboard([
    ['Добавить промокод', 'Список промокодов'],
    ['Назад']
  ]).resize());
});

bot.hears('Управление администраторами', isPrivateChat, isAdmin, (ctx) => {
  ctx.reply('Выберите действие:', Markup.keyboard([
    ['Добавить администратора', 'Добавить продавца'],
    ['Список администраторов', 'Список продавцов'],
    ['Назад']
  ]).resize());
});

bot.hears('Вернуться к обычному режиму', isPrivateChat, (ctx) => {
  ctx.reply('Вы вышли из режима администратора/продавца.', mainKeyboard);
});

// Обработчик для кнопки "Добавить промокод" - только в приватном чате
bot.hears('Добавить промокод', isPrivateChat, isAdmin, (ctx) => {
  ctx.scene.enter('add-promo');
});

// Обработчик для кнопки "Список промокодов" - только в приватном чате
bot.hears('Список промокодов', isPrivateChat, isAdmin, (ctx) => {
  ctx.scene.enter('promo-list-admin');
});

// Обработчик для кнопки "Добавить администратора" - только в приватном чате
bot.hears('Добавить администратора', isPrivateChat, isAdmin, (ctx) => {
  ctx.scene.enter('add-admin');
});

// Обработчик для кнопки "Список администраторов" - только в приватном чате
bot.hears('Список администраторов', isPrivateChat, isAdmin, (ctx) => {
  ctx.scene.enter('admin-list');
});

// Обработчик для кнопки "Добавить продавца" - только в приватном чате
bot.hears('Добавить продавца', isPrivateChat, isAdmin, (ctx) => {
  ctx.scene.enter('add-seller');
});

// Обработчик для кнопки "Список продавцов" - только в приватном чате
bot.hears('Список продавцов', isPrivateChat, isAdmin, (ctx) => {
  ctx.scene.enter('seller-list');
});

// Обработчик для кнопки "Назад" в меню управления - только в приватном чате
bot.hears('Назад', isPrivateChat, isAdmin, (ctx) => {
  ctx.reply('Выберите раздел:', adminKeyboard);
});

// Отслеживание ошибок
bot.catch((err, ctx) => {
  console.error(`Ошибка для ${ctx.updateType}`, err);
  ctx.reply('Произошла ошибка при обработке запроса. Пожалуйста, попробуйте позже.').catch(e => {
    console.error('Ошибка при отправке сообщения об ошибке:', e);
  });
});

// Запуск бота
bot.launch()
  .then(() => console.log('Bot started successfully'))
  .catch((err) => console.error('Error starting bot:', err));

// Включение graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));