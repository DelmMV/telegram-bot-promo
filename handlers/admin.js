const { Scenes, Markup } = require('telegraf');
const ActivatedPromo = require('../database/models/activatedPromo');
const Admin = require('../database/models/admin');
const Promo = require('../database/models/promo');
const { 
  adminKeyboard, 
  promoManagementKeyboard, 
  adminManagementKeyboard,
  mainKeyboard,
  backButton,
  cancelButton
} = require('../utils/keyboard');
const User = require('../database/models/user');
const { isAdmin } = require('../middlewares/auth');
const { parseDateString, isValidDateFormat, formatDate } = require('../utils/helpers');

module.exports = (bot) => {
  
  // Команда для входа в админ-панель
  bot.command('admin', async (ctx) => {
    try {
      const telegramId = ctx.from.id;
      const admin = await Admin.findOne({ telegramId, isActive: true });
      
      if (!admin) {
        return ctx.reply('У вас нет доступа к админ-панели.');
      }
      
      return ctx.reply('Добро пожаловать в админ-панель.', adminKeyboard);
    } catch (error) {
      console.error('Error in admin command:', error);
      return ctx.reply('Произошла ошибка при входе в админ-панель.');
    }
  });
  
  // Команда для прямого доступа к списку промокодов
  bot.command('promo_list', isAdmin, (ctx) => {
    ctx.scene.enter('promo-list-admin');
  });

  // Команда для быстрого добавления тестового промокода
  bot.command('add_test_promo', isAdmin, async (ctx) => {
    try {
      // Создаем тестовый промокод со сроком действия +30 дней от текущей даты
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      const newPromo = new Promo({
        name: 'Тестовый промокод',
        description: 'Это тестовый промокод для проверки функциональности',
        totalLimit: 10,
        expiresAt,
      });
      
      await newPromo.save();
      
      ctx.reply(
        `Тестовый промокод успешно создан!\n\n` +
        `Название: ${newPromo.name}\n` +
        `Описание: ${newPromo.description}\n` +
        `Лимит: ${newPromo.totalLimit}\n` +
        `Действителен до: ${formatDate(newPromo.expiresAt)}`
      );
      
      // Переходим к списку промокодов
      setTimeout(() => {
        ctx.scene.enter('promo-list-admin');
      }, 1000);
      
    } catch (error) {
      console.error('Error creating test promo:', error);
      ctx.reply('Произошла ошибка при создании тестового промокода.');
    }
  });
  
  const activatePromoScene = new Scenes.WizardScene(
    'activate-promo',
    // Шаг 1: Запрос кода промокода для активации
    (ctx) => {
      ctx.reply('Введите индивидуальный код промокода для активации:', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 2: Поиск и активация промокода
    async (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', adminKeyboard);
        return ctx.scene.leave();
      }
      
      const promoCode = ctx.message.text.toUpperCase().trim();
      
      try {
        // Проверяем, был ли этот код уже активирован
        const existingActivation = await ActivatedPromo.findOne({ code: promoCode });
        
        if (existingActivation) {
          // Получаем информацию о промокоде
          const promo = await Promo.findById(existingActivation.promoId);
          const promoName = promo ? promo.name : 'Неизвестный промокод';
          
          ctx.reply(
            `⚠️ Промокод "${promoCode}" уже был активирован!\n\n` +
            `Название типа: ${promoName}\n` +
            `Дата активации: ${formatDate(existingActivation.activatedAt)}`,
            adminKeyboard
          );
          return ctx.scene.leave();
        }
        
        // Ищем пользователя, у которого есть этот промокод
        const user = await User.findOne({ 
          "claimedPromos.code": promoCode 
        });
        
        if (!user) {
          ctx.reply(
            `❌ Промокод "${promoCode}" не найден ни у одного пользователя.`,
            adminKeyboard
          );
          return ctx.scene.leave();
        }
        
        // Находим промокод в массиве промокодов пользователя
        const claimedPromoIndex = user.claimedPromos.findIndex(p => p.code === promoCode);
        
        if (claimedPromoIndex === -1) {
          ctx.reply(
            `❌ Не удалось найти информацию о промокоде "${promoCode}".`,
            adminKeyboard
          );
          return ctx.scene.leave();
        }
        
        const claimedPromo = user.claimedPromos[claimedPromoIndex];
        
        // Получаем информацию о типе промокода
        const promo = await Promo.findById(claimedPromo.promoId);
        
        if (!promo) {
          ctx.reply(
            `❌ Промокод "${promoCode}" найден у пользователя, но информация о типе промокода отсутствует.`,
            adminKeyboard
          );
          return ctx.scene.leave();
        }
        
        // Создаем запись об активации
        const newActivation = new ActivatedPromo({
          promoId: claimedPromo.promoId,
          code: promoCode,
          activatedBy: ctx.from.id
        });
        
        await newActivation.save();
        
        // Отмечаем промокод как активированный в записи пользователя
        user.claimedPromos[claimedPromoIndex].activated = true;
        user.claimedPromos[claimedPromoIndex].activatedAt = new Date();
        await user.save();
        
        ctx.reply(
          `✅ Промокод "${promoCode}" успешно активирован!\n\n` +
          `Пользователь: ${user.firstName} ${user.lastName} ${user.username ? `(@${user.username})` : ''}\n` +
          `ID пользователя: ${user.telegramId}\n` +
          `Тип промокода: ${promo.name}\n` +
          `Описание: ${promo.description}\n` +
          `Выдан: ${formatDate(claimedPromo.claimedAt)}\n` +
          `Активирован: ${formatDate(new Date())}\n\n` +
          `Статистика по типу "${promo.name}":\n` +
          `Использовано: ${promo.usedCount + 1}/${promo.totalLimit}`,
          adminKeyboard
        );
        
        // Инкрементируем счетчик использований типа промокода
        await Promo.findByIdAndUpdate(claimedPromo.promoId, { $inc: { usedCount: 1 } });
        
        return ctx.scene.leave();
      } catch (error) {
        console.error('Error in promo activation:', error);
        ctx.reply(`Произошла ошибка при активации промокода: ${error.message}`, adminKeyboard);
        return ctx.scene.leave();
      }
    }
  );
  
  const activatedPromosScene = new Scenes.BaseScene('activated-promos');

  activatedPromosScene.enter(async (ctx) => {
    try {
      // Получаем список активированных промокодов с сортировкой от новых к старым
      const activations = await ActivatedPromo.find()
        .sort({ activatedAt: -1 })
        .populate('promoId')
        .limit(20); // Ограничим список 20 последними активациями
      
      if (activations.length === 0) {
        ctx.reply('Еще не было активировано ни одного промокода.', adminKeyboard);
        return ctx.scene.leave();
      }
      
      let message = '📋 Последние активированные промокоды:\n\n';
      
      for (const activation of activations) {
        const promoName = activation.promoId ? activation.promoId.name : 'Удаленный промокод';
        
        // Ищем пользователя, у которого был этот промокод
        const user = await User.findOne({ "claimedPromos.code": activation.code });
        const userInfo = user 
          ? `${user.firstName} ${user.lastName} ${user.username ? `(@${user.username})` : ''}`
          : 'Пользователь не найден';
        
        message += `🔑 Код: ${activation.code}\n`;
        message += `📦 Тип промокода: ${promoName}\n`;
        message += `👤 Пользователь: ${userInfo}\n`;
        message += `🕒 Активирован: ${formatDate(activation.activatedAt)}\n\n`;
      }
      
      ctx.reply(message, adminKeyboard);
      return ctx.scene.leave();
    } catch (error) {
      console.error('Error in activated promos scene:', error);
      ctx.reply('Произошла ошибка при загрузке списка активированных промокодов.', adminKeyboard);
      return ctx.scene.leave();
    }
  });
  
  const activateUserPromoScene = new Scenes.WizardScene(
    'activate-user-promo',
    // Шаг 1: Запрос Telegram ID пользователя
    (ctx) => {
      ctx.reply('Введите Telegram ID пользователя, чей промокод вы хотите активировать:', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 2: Запрос кода промокода
    async (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', adminKeyboard);
        return ctx.scene.leave();
      }
      
      const promoCode = ctx.message.text.toUpperCase().trim();
      
      try {
        // Проверяем, был ли этот код уже активирован
        const existingActivation = await ActivatedPromo.findOne({ code: promoCode });
        
        if (existingActivation) {
          // Получаем информацию о промокоде
          const promo = await Promo.findById(existingActivation.promoId);
          const promoName = promo ? promo.name : 'Неизвестный промокод';
          
          ctx.reply(
            `⚠️ Промокод "${promoCode}" уже был активирован!\n\n` +
            `Название: ${promoName}\n` +
            `Дата активации: ${formatDate(existingActivation.activatedAt)}`,
            adminKeyboard
          );
          return ctx.scene.leave();
        }
        
        // Получаем список активных промокодов
        const currentDate = new Date();
        const availablePromos = await Promo.find({
          isActive: true,
          expiresAt: { $gt: currentDate },
          $expr: { $lt: ["$usedCount", "$totalLimit"] }
        });
        
        if (availablePromos.length === 0) {
          ctx.reply('На данный момент нет доступных для активации промокодов.', adminKeyboard);
          return ctx.scene.leave();
        }
        
        // Создаем клавиатуру с доступными промокодами - исправим callback_data
        const keyboard = availablePromos.map(promo => [
          Markup.button.callback(
            `${promo.name} (${promo.usedCount}/${promo.totalLimit})`, 
            `activate_promo:${promo._id.toString()}:${promoCode}`
          )
        ]);
        
        // Добавляем кнопку отмены
        keyboard.push([Markup.button.callback('Отмена', 'cancel_activation')]);
        
        ctx.reply(
          `Выберите промокод для активации с кодом "${promoCode}":`,
          Markup.inlineKeyboard(keyboard)
        );
        
        return ctx.scene.leave();
      } catch (error) {
        console.error('Error in promo activation:', error);
        ctx.reply(`Произошла ошибка при активации промокода: ${error.message}`, adminKeyboard);
        return ctx.scene.leave();
      }
    },
    // Шаг 3: Выбор промокода для активации
    async (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', adminKeyboard);
        return ctx.scene.leave();
      }
      
      const promoCode = ctx.message.text.toUpperCase().trim();
      ctx.wizard.state.promoCode = promoCode;
      
      try {
        // Получаем список активных промокодов
        const currentDate = new Date();
        const availablePromos = await Promo.find({
          isActive: true,
          expiresAt: { $gt: currentDate },
          $expr: { $lt: ["$usedCount", "$totalLimit"] }
        });
        
        if (availablePromos.length === 0) {
          ctx.reply('На данный момент нет доступных для активации промокодов.', adminKeyboard);
          return ctx.scene.leave();
        }
        
        // Создаем клавиатуру с доступными промокодами
        const keyboard = availablePromos.map(promo => [
          Markup.button.callback(
            `${promo.name} (${promo.usedCount}/${promo.totalLimit})`, 
            `activate_promo:${promo._id}:${ctx.wizard.state.userId}:${promoCode}`
          )
        ]);
        
        // Добавляем кнопку отмены
        keyboard.push([Markup.button.callback('Отмена', 'cancel_activation')]);
        
        ctx.reply(
          `Выберите промокод для активации пользователю с ID ${ctx.wizard.state.userId}:`,
          Markup.inlineKeyboard(keyboard)
        );
        
        return ctx.scene.leave();
      } catch (error) {
        console.error('Error selecting promo for activation:', error);
        ctx.reply('Произошла ошибка при выборе промокода.', adminKeyboard);
        return ctx.scene.leave();
      }
    }
  );
  
  // Сцена аутентификации администратора
  const adminAuthScene = new Scenes.BaseScene('admin-auth');
  
  adminAuthScene.enter(async (ctx) => {
    try {
      const telegramId = ctx.from.id;
      const admin = await Admin.findOne({ telegramId, isActive: true });
      
      if (!admin) {
        return ctx.reply('У вас нет доступа к админ-панели.');
      }
      
      ctx.reply('Добро пожаловать в админ-панель.', adminKeyboard);
      return ctx.scene.leave();
    } catch (error) {
      console.error('Error in admin auth scene:', error);
      return ctx.reply('Произошла ошибка аутентификации.');
    }
  });
  
  // Сцена добавления промокода
  const addPromoScene = new Scenes.WizardScene(
    'add-promo',
    // Шаг 1: Запрос названия промокода
    (ctx) => {
      ctx.reply('Введите название промокода:', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 2: Запрос описания промокода
    (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
      
      ctx.wizard.state.promoName = ctx.message.text;
      ctx.reply('Введите описание промокода:', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 3: Запрос количества промокодов
    (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
      
      ctx.wizard.state.promoDescription = ctx.message.text;
      ctx.reply('Введите количество промокодов (лимит):', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 4: Запрос даты истечения
    (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
      
      const limit = parseInt(ctx.message.text);
      if (isNaN(limit) || limit <= 0) {
        ctx.reply('Пожалуйста, введите корректное положительное число.');
        return;
      }
      
      ctx.wizard.state.promoLimit = limit;
      ctx.reply('Введите дату истечения промокода в формате ДД.ММ.ГГГГ:', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 5: Создание промокода
    async (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
      
      const dateString = ctx.message.text;
      if (!isValidDateFormat(dateString)) {
        ctx.reply('Неверный формат даты. Пожалуйста, используйте формат ДД.ММ.ГГГГ.');
        return;
      }
      
      const expiresAt = parseDateString(dateString);
      if (expiresAt < new Date()) {
        ctx.reply('Дата истечения промокода не может быть в прошлом.');
        return;
      }
      
      try {
        const newPromo = new Promo({
          name: ctx.wizard.state.promoName,
          description: ctx.wizard.state.promoDescription,
          totalLimit: ctx.wizard.state.promoLimit,
          expiresAt,
        });
        
        await newPromo.save();
        
        ctx.reply(
          `Промокод успешно создан!\n\n` +
          `Название: ${newPromo.name}\n` +
          `Описание: ${newPromo.description}\n` +
          `Лимит: ${newPromo.totalLimit}\n` +
          `Действителен до: ${formatDate(newPromo.expiresAt)}`,
          promoManagementKeyboard
        );
        
        return ctx.scene.leave();
      } catch (error) {
        console.error('Error creating promo:', error);
        ctx.reply('Произошла ошибка при создании промокода.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
    }
  );
  
  // Сцена добавления администратора
  const addAdminScene = new Scenes.WizardScene(
    'add-admin',
    // Шаг 1: Запрос Telegram ID нового администратора
    (ctx) => {
      ctx.reply('Введите Telegram ID нового администратора:', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 2: Создание нового администратора
    async (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', adminManagementKeyboard);
        return ctx.scene.leave();
      }
      
      const newAdminId = parseInt(ctx.message.text);
      if (isNaN(newAdminId)) {
        ctx.reply('Пожалуйста, введите корректный Telegram ID (число).');
        return;
      }
      
      try {
        // Проверяем, существует ли уже такой администратор
        const existingAdmin = await Admin.findOne({ telegramId: newAdminId });
        if (existingAdmin) {
          if (existingAdmin.isActive) {
            ctx.reply('Этот пользователь уже является администратором.', adminManagementKeyboard);
          } else {
            // Если админ был деактивирован, активируем его снова
            existingAdmin.isActive = true;
            existingAdmin.addedBy = ctx.from.id;
            existingAdmin.addedAt = new Date();
            await existingAdmin.save();
            ctx.reply('Администратор успешно восстановлен.', adminManagementKeyboard);
          }
          return ctx.scene.leave();
        }
        
        // Создаем нового администратора с полной информацией
        try {
          // Получаем информацию о пользователе через Telegram API
          const userInfo = await ctx.telegram.getChat(newAdminId);
          
          const newAdmin = new Admin({
            telegramId: newAdminId,
            firstName: userInfo.first_name || '',
            lastName: userInfo.last_name || '',
            username: userInfo.username || '',
            addedBy: ctx.from.id,
            isActive: true,
            addedAt: new Date()
          });
          
          await newAdmin.save();
          
          ctx.reply(
            `Администратор успешно добавлен!\n\n` +
            `ID: ${newAdmin.telegramId}\n` +
            `Имя: ${newAdmin.firstName || 'Не указано'}\n` +
            `Фамилия: ${newAdmin.lastName || 'Не указана'}\n` +
            `Юзернейм: ${newAdmin.username ? '@' + newAdmin.username : 'Не указан'}`,
            adminManagementKeyboard
          );
        } catch (telegramError) {
          console.error('Error getting user info from Telegram:', telegramError);
          
          // Если не удалось получить информацию через Telegram API, просим ввести данные вручную
          ctx.wizard.state.newAdminId = newAdminId;
          ctx.reply('Не удалось получить информацию о пользователе через Telegram. Пожалуйста, введите имя администратора:', cancelButton);
          return ctx.wizard.next();
        }
        
        return ctx.scene.leave();
      } catch (error) {
        console.error('Error adding admin:', error);
        ctx.reply('Произошла ошибка при добавлении администратора.', adminManagementKeyboard);
        return ctx.scene.leave();
      }
    },
    // Шаг 3: Ввод имени (если не удалось получить через API)
    (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', adminManagementKeyboard);
        return ctx.scene.leave();
      }
      
      ctx.wizard.state.firstName = ctx.message.text;
      ctx.reply('Введите фамилию администратора (или "Нет", если не требуется):', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 4: Ввод фамилии
    (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', adminManagementKeyboard);
        return ctx.scene.leave();
      }
      
      ctx.wizard.state.lastName = ctx.message.text === 'Нет' ? '' : ctx.message.text;
      ctx.reply('Введите юзернейм администратора (без @ в начале, или "Нет", если не требуется):', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 5: Ввод юзернейма и сохранение
    async (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', adminManagementKeyboard);
        return ctx.scene.leave();
      }
      
      try {
        const username = ctx.message.text === 'Нет' ? '' : ctx.message.text;
        
        const newAdmin = new Admin({
          telegramId: ctx.wizard.state.newAdminId,
          firstName: ctx.wizard.state.firstName,
          lastName: ctx.wizard.state.lastName,
          username: username,
          addedBy: ctx.from.id,
          isActive: true,
          addedAt: new Date()
        });
        
        await newAdmin.save();
        
        ctx.reply(
          `Администратор успешно добавлен!\n\n` +
          `ID: ${newAdmin.telegramId}\n` +
          `Имя: ${newAdmin.firstName || 'Не указано'}\n` +
          `Фамилия: ${newAdmin.lastName || 'Не указана'}\n` +
          `Юзернейм: ${newAdmin.username ? '@' + newAdmin.username : 'Не указан'}`,
          adminManagementKeyboard
        );
        
        return ctx.scene.leave();
      } catch (error) {
        console.error('Error adding admin with manual info:', error);
        ctx.reply('Произошла ошибка при добавлении администратора.', adminManagementKeyboard);
        return ctx.scene.leave();
      }
    }
  );
  
  // Сцена для списка промокодов с возможностью удаления и редактирования
  const promoListAdminScene = new Scenes.BaseScene('promo-list-admin');
  
  promoListAdminScene.enter(async (ctx) => {
    try {
      const promos = await Promo.find().sort({ createdAt: -1 });
      
      if (promos.length === 0) {
        ctx.reply('Промокодов пока нет.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
      
      // Отправляем список промокодов с кнопками для каждого промокода
      const keyboard = [];
      promos.forEach((promo) => {
        const status = promo.isActive ? 
          (promo.expiresAt < new Date() ? '⏱️' : 
            (promo.usedCount >= promo.totalLimit ? '🔒' : '✅')) 
          : '❌';
          
        keyboard.push([
          Markup.button.callback(
            `${status} ${promo.name} (${promo.usedCount}/${promo.totalLimit})`, 
            `promo_view:${promo._id}`
          )
        ]);
      });
      
      // Добавляем кнопку "Назад"
      keyboard.push([Markup.button.callback('◀️ Назад', 'back_to_promo_management')]);
      
      ctx.reply(
        'Список промокодов:\nВыберите промокод для управления:', 
        Markup.inlineKeyboard(keyboard)
      );
      
      ctx.session.listMode = 'promos';
    } catch (error) {
      console.error('Error in promo list admin scene:', error);
      ctx.reply('Произошла ошибка при загрузке промокодов.', promoManagementKeyboard);
      return ctx.scene.leave();
    }
  });
  
  promoListAdminScene.hears('Назад', (ctx) => {
    ctx.reply('Возвращаюсь в меню управления промокодами.', promoManagementKeyboard);
    return ctx.scene.leave();
  });
  
  promoListAdminScene.on('text', async (ctx) => {
    try {
      const text = ctx.message.text;
      
      // Если пользователь отправил "Назад" или другую системную команду
      if (text === 'Назад' || text === 'Список промокодов' || text === 'Добавить промокод') {
        // Обрабатываем как системную команду
        if (text === 'Назад') {
          ctx.reply('Возвращаюсь в меню управления промокодами.', promoManagementKeyboard);
          return ctx.scene.leave();
        } else if (text === 'Список промокодов') {
          // Просто перезагружаем текущую сцену
          return ctx.scene.reenter();
        } else if (text === 'Добавить промокод') {
          ctx.scene.leave();
          return ctx.scene.enter('add-promo');
        }
        return;
      }
      
      // Проверяем, похоже ли сообщение на MongoDB ObjectId
      // ObjectId в MongoDB - это 24-символьная шестнадцатеричная строка
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(text);
      
      if (!isObjectId) {
        return ctx.reply('Пожалуйста, выберите промокод из списка, используя inline-кнопки.');
      }
      
      // Если это ObjectId, продолжаем как раньше
      const promoId = text;
      
      const promo = await Promo.findById(promoId);
      if (!promo) {
        return ctx.reply('Промокод с таким ID не найден. Пожалуйста, проверьте ID и попробуйте снова.');
      }
      
      // ... остальной код для отображения деталей промокода ...
    } catch (error) {
      console.error('Error handling promo ID:', error);
      ctx.reply('Произошла ошибка при обработке ID промокода.');
    }
  });
  
  // Сцена для списка администраторов
  const adminListScene = new Scenes.BaseScene('admin-list');
  
  adminListScene.enter(async (ctx) => {
    try {
      const admins = await Admin.find().sort({ addedAt: -1 });
      
      if (admins.length === 0) {
        ctx.reply('Администраторов пока нет.', adminManagementKeyboard);
        return ctx.scene.leave();
      }
      
      // Отправляем список администраторов с кнопками для каждого администратора
      const keyboard = [];
      admins.forEach((admin) => {
        const status = admin.isActive ? '✅' : '❌';
        keyboard.push([
          Markup.button.callback(
            `${status} ${admin.firstName} ${admin.lastName} ${admin.username ? '@' + admin.username : ''}`,
            `admin_view:${admin.telegramId}`
          )
        ]);
      });
      
      // Добавляем кнопку "Назад"
      keyboard.push([Markup.button.callback('◀️ Назад', 'back_to_admin_management')]);
      
      ctx.reply(
        'Список администраторов:\nВыберите администратора для управления:',
        Markup.inlineKeyboard(keyboard)
      );
      
      ctx.session.listMode = 'admins';
    } catch (error) {
      console.error('Error in admin list scene:', error);
      ctx.reply('Произошла ошибка при загрузке администраторов.', adminManagementKeyboard);
      return ctx.scene.leave();
    }
  });
  
  adminListScene.hears('Назад', (ctx) => {
    ctx.reply('Возвращаюсь в меню управления администраторами.', adminManagementKeyboard);
    return ctx.scene.leave();
  });
  
  adminListScene.on('text', async (ctx) => {
    try {
      const adminId = parseInt(ctx.message.text);
      
      if (isNaN(adminId)) {
        return ctx.reply('Пожалуйста, введите корректный Telegram ID (число).');
      }
      
      const admin = await Admin.findOne({ telegramId: adminId });
      if (!admin) {
        return ctx.reply('Администратор с таким ID не найден. Пожалуйста, проверьте ID и попробуйте снова.');
      }
      
      // Запрещаем удалять самого себя
      const isSelf = admin.telegramId === ctx.from.id;
      
      ctx.reply(
        `Администратор: ${admin.firstName} ${admin.lastName} ${admin.username ? '@' + admin.username : ''}\n\n` +
        `ID: ${admin.telegramId}\n` +
        `Статус: ${admin.isActive ? '✅ Активен' : '❌ Неактивен'}\n` +
        `Добавлен: ${formatDate(admin.addedAt)}\n\n` +
        'Выберите действие:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              admin.isActive ? '🔴 Деактивировать' : '🟢 Активировать',
              `admin_toggle:${admin.telegramId}`,
              isSelf // Disable button if it's the current admin
            )
          ],
          [
            Markup.button.callback(
              '🗑️ Удалить',
              `admin_delete:${admin.telegramId}`,
              isSelf // Disable button if it's the current admin
            )
          ],
          [Markup.button.callback('◀️ Назад к списку', 'admin_back_to_list')]
        ])
      );
    } catch (error) {
      console.error('Error handling admin ID:', error);
      ctx.reply('Произошла ошибка при обработке ID администратора.');
    }
  });
  
  // Сцена для редактирования промокода
  const editPromoScene = new Scenes.WizardScene(
    'edit-promo',
    // Инициализация сцены
    (ctx) => {
      const promoId = ctx.scene.state.promoId;
      
      if (!promoId) {
        ctx.reply('Ошибка: ID промокода не найден.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
      
      ctx.reply(
        'Что вы хотите изменить?\n\n' +
        '1. Название\n' +
        '2. Описание\n' +
        '3. Лимит\n' +
        '4. Дата истечения\n\n' +
        'Введите номер пункта или нажмите "Отмена"',
        cancelButton
      );
      
      return ctx.wizard.next();
    },
    // Обработка выбора поля для редактирования
    async (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Редактирование отменено.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
      
      const choice = ctx.message.text;
      ctx.wizard.state.editField = null;
      
      switch (choice) {
        case '1':
          ctx.wizard.state.editField = 'name';
          ctx.reply('Введите новое название промокода:', cancelButton);
          break;
        case '2':
          ctx.wizard.state.editField = 'description';
          ctx.reply('Введите новое описание промокода:', cancelButton);
          break;
        case '3':
          ctx.wizard.state.editField = 'totalLimit';
          ctx.reply('Введите новый лимит промокодов:', cancelButton);
          break;
        case '4':
          ctx.wizard.state.editField = 'expiresAt';
          ctx.reply('Введите новую дату истечения в формате ДД.ММ.ГГГГ:', cancelButton);
          break;
        default:
          ctx.reply('Неверный выбор. Пожалуйста, выберите номер от 1 до 4.');
          return;
      }
      
      return ctx.wizard.next();
    },
    // Обновление выбранного поля
    async (ctx) => {
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Редактирование отменено.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
      
      const { promoId, editField } = ctx.wizard.state;
      const newValue = ctx.message.text;
      
      try {
        // Получаем текущий промокод
        const promo = await Promo.findById(promoId);
        if (!promo) {
          ctx.reply('Ошибка: промокод не найден.', promoManagementKeyboard);
          return ctx.scene.leave();
        }
        
        // Обновляем поле в зависимости от выбора
        switch (editField) {
          case 'name':
            promo.name = newValue;
            break;
          case 'description':
            promo.description = newValue;
            break;
          case 'totalLimit':
            const limit = parseInt(newValue);
            if (isNaN(limit) || limit <= 0) {
              ctx.reply('Пожалуйста, введите корректное положительное число.');
              return;
            }
            
            // Проверяем, чтобы новый лимит был не меньше уже использованных промокодов
            if (limit < promo.usedCount) {
              ctx.reply(`Ошибка: лимит не может быть меньше количества уже использованных промокодов (${promo.usedCount}).`);
              return;
            }
            
            promo.totalLimit = limit;
            break;
          case 'expiresAt':
            if (!isValidDateFormat(newValue)) {
              ctx.reply('Неверный формат даты. Пожалуйста, используйте формат ДД.ММ.ГГГГ.');
              return;
            }
            
            promo.expiresAt = parseDateString(newValue);
            break;
        }
        
        await promo.save();
        
        ctx.reply(
          `Промокод успешно обновлен!\n\n` +
          `Название: ${promo.name}\n` +
          `Описание: ${promo.description}\n` +
          `Лимит: ${promo.usedCount}/${promo.totalLimit}\n` +
          `Действителен до: ${formatDate(promo.expiresAt)}`
        );
        
        setTimeout(() => {
          const scene = bot.scenes.get('promo-list-admin');
          if (scene) {
            scene.enter(ctx);
          } else {
            ctx.reply('Выберите действие:', promoManagementKeyboard);
          }
        }, 1000);
        
        return ctx.scene.leave();
      } catch (error) {
        console.error('Error updating promo:', error);
        ctx.reply('Произошла ошибка при обновлении промокода.', promoManagementKeyboard);
        return ctx.scene.leave();
      }
    }
  );
  
  // Регистрируем сцены
  const stage = new Scenes.Stage([
    adminAuthScene,
    addPromoScene,
    addAdminScene,
    promoListAdminScene,
    adminListScene,
    editPromoScene,
    activatePromoScene,      // Добавляем новую сцену для активации
    activatedPromosScene     // Добавляем сцену истории активаций
  ]);
  
  bot.use(stage.middleware());
  
  
  
  bot.action(/activate_promo:(.+):(.+)/, isAdmin, async (ctx) => {
    try {
      const promoId = ctx.match[1];
      const promoCode = ctx.match[2];
      
      console.log('Активация промокода:', { promoId, promoCode }); // Для отладки
      
      // Еще раз проверяем, не был ли промокод активирован пока выбирали опцию
      const existingActivation = await ActivatedPromo.findOne({ code: promoCode });
      if (existingActivation) {
        return ctx.answerCbQuery('Этот промокод уже был активирован!').then(() => {
          ctx.editMessageText('Этот промокод уже был активирован кем-то другим!', adminKeyboard);
        });
      }
      
      // Получаем промокод из базы данных
      const promo = await Promo.findById(promoId);
      if (!promo) {
        return ctx.answerCbQuery('Промокод не найден.').then(() => {
          ctx.editMessageText('Промокод не найден в базе данных.', adminKeyboard);
        });
      }
      
      // Проверяем, активен ли промокод
      if (!promo.isActive) {
        return ctx.answerCbQuery('Этот промокод больше не активен.').then(() => {
          ctx.editMessageText('Этот промокод больше не активен.', adminKeyboard);
        });
      }
      
      // Проверяем, не истек ли срок действия промокода
      if (promo.expiresAt < new Date()) {
        return ctx.answerCbQuery('Срок действия этого промокода истек.').then(() => {
          ctx.editMessageText('Срок действия этого промокода истек.', adminKeyboard);
        });
      }
      
      // Проверяем, не достигнут ли лимит использования промокода
      if (promo.usedCount >= promo.totalLimit) {
        return ctx.answerCbQuery('Лимит использования этого промокода исчерпан.').then(() => {
          ctx.editMessageText('Лимит использования этого промокода исчерпан.', adminKeyboard);
        });
      }
      
      // Обновляем счетчик использования промокода
      await Promo.findByIdAndUpdate(promoId, { $inc: { usedCount: 1 } });
      
      // Сохраняем информацию об активированном промокоде
      const newActivation = new ActivatedPromo({
        promoId: promoId,
        code: promoCode,
        activatedBy: ctx.from.id
      });
      await newActivation.save();
      
      // Отмечаем промокод как активированный
      await ctx.answerCbQuery('Промокод успешно активирован!');
      
      ctx.editMessageText(
        `✅ Промокод "${promoCode}" успешно активирован!\n\n` +
        `Название: ${promo.name}\n` +
        `Описание: ${promo.description}\n` +
        `Действителен до: ${formatDate(promo.expiresAt)}\n\n` +
        `Использовано: ${promo.usedCount + 1}/${promo.totalLimit}`,
        adminKeyboard
      );
    } catch (error) {
      console.error('Error activating promo:', error);
      ctx.answerCbQuery('Произошла ошибка при активации промокода.');
      ctx.editMessageText(`Произошла ошибка при активации промокода: ${error.message}`, adminKeyboard);
    }
  });
  
  // Обработчик для отмены активации
  bot.action('cancel_activation', isAdmin, (ctx) => {
    ctx.answerCbQuery('Активация отменена.');
    ctx.editMessageText('Активация промокода отменена.', adminKeyboard);
  });
  
  bot.action('back_to_promo_management', isAdmin, (ctx) => {
    ctx.answerCbQuery();
    ctx.deleteMessage();
    ctx.reply('Выберите действие:', promoManagementKeyboard);
  });
  
  bot.action(/promo_view:(.+)/, isAdmin, async (ctx) => {
    try {
      const promoId = ctx.match[1];
      
      const promo = await Promo.findById(promoId);
      if (!promo) {
        return ctx.answerCbQuery('Промокод не найден.');
      }
      
      const status = promo.isActive ? 
        (promo.expiresAt < new Date() ? '⏱️ Истек' : 
          (promo.usedCount >= promo.totalLimit ? '🔒 Лимит исчерпан' : '✅ Активен')) 
        : '❌ Неактивен';
      
      await ctx.answerCbQuery();
      
      await ctx.editMessageText(
        `Промокод: ${promo.name}\n\n` +
        `Описание: ${promo.description}\n` +
        `Статус: ${status}\n` +
        `Использовано: ${promo.usedCount}/${promo.totalLimit}\n` +
        `Действителен до: ${formatDate(promo.expiresAt)}\n` +
        `ID: ${promo._id}\n\n` +
        'Выберите действие:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              promo.isActive ? '🔴 Деактивировать' : '🟢 Активировать',
              `promo_toggle:${promo._id}`
            )
          ],
          [Markup.button.callback('🗑️ Удалить', `promo_delete:${promo._id}`)],
          [Markup.button.callback('✏️ Редактировать', `promo_edit:${promo._id}`)],
          [Markup.button.callback('◀️ Назад к списку', 'promo_back_to_list')]
        ])
      );
    } catch (error) {
      console.error('Error viewing promo:', error);
      ctx.answerCbQuery('Произошла ошибка при просмотре промокода.');
    }
  });
  // Обработка inline кнопок для управления промокодами
  bot.action(/promo_toggle:(.+)/, isAdmin, async (ctx) => {
    try {
      const promoId = ctx.match[1];
      
      const promo = await Promo.findById(promoId);
      if (!promo) {
        return ctx.answerCbQuery('Промокод не найден.');
      }
      
      promo.isActive = !promo.isActive;
      await promo.save();
      
      await ctx.answerCbQuery(`Промокод ${promo.isActive ? 'активирован' : 'деактивирован'}.`);
      
      // Обновляем сообщение
      const status = promo.isActive ? 
        (promo.expiresAt < new Date() ? '⏱️ Истек' : 
          (promo.usedCount >= promo.totalLimit ? '🔒 Лимит исчерпан' : '✅ Активен')) 
        : '❌ Неактивен';
      
      await ctx.editMessageText(
        `Промокод: ${promo.name}\n\n` +
        `Описание: ${promo.description}\n` +
        `Статус: ${status}\n` +
        `Использовано: ${promo.usedCount}/${promo.totalLimit}\n` +
        `Истекает: ${formatDate(promo.expiresAt)}\n` +
        `ID: ${promo._id}\n\n` +
        'Выберите действие:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              promo.isActive ? '🔴 Деактивировать' : '🟢 Активировать',
              `promo_toggle:${promo._id}`
            )
          ],
          [Markup.button.callback('🗑️ Удалить', `promo_delete:${promo._id}`)],
          [Markup.button.callback('✏️ Редактировать', `promo_edit:${promo._id}`)],
          [Markup.button.callback('◀️ Назад к списку', 'promo_back_to_list')]
        ])
      );
    } catch (error) {
      console.error('Error toggling promo:', error);
      ctx.answerCbQuery('Произошла ошибка при изменении статуса промокода.');
    }
  });
  
  bot.action(/promo_delete:(.+)/, isAdmin, async (ctx) => {
    try {
      const promoId = ctx.match[1];
      
      await Promo.findByIdAndDelete(promoId);
      
      await ctx.answerCbQuery('Промокод успешно удален.');
      await ctx.deleteMessage();
      
      // Возвращаем пользователя к списку промокодов
      ctx.scene.enter('promo-list-admin');
    } catch (error) {
      console.error('Error deleting promo:', error);
      ctx.answerCbQuery('Произошла ошибка при удалении промокода.');
    }
  });
  
  bot.action(/promo_edit:(.+)/, isAdmin, async (ctx) => {
    try {
      const promoId = ctx.match[1];
      
      ctx.scene.state.promoId = promoId;
      await ctx.answerCbQuery('Переход к редактированию промокода.');
      await ctx.deleteMessage();
      
      ctx.scene.enter('edit-promo');
    } catch (error) {
      console.error('Error initiating promo edit:', error);
      ctx.answerCbQuery('Произошла ошибка при инициализации редактирования.');
    }
  });
  
  bot.action('promo_back_to_list', isAdmin, (ctx) => {
    ctx.answerCbQuery('Возвращаюсь к списку промокодов.');
    ctx.deleteMessage();
    ctx.scene.enter('promo-list-admin');
  });
  
  // Обработка inline кнопок для управления администраторами
  bot.action(/admin_toggle:(.+)/, isAdmin, async (ctx) => {
    try {
      const adminId = parseInt(ctx.match[1]);
      
      // Запрещаем деактивировать самого себя
      if (adminId === ctx.from.id) {
        return ctx.answerCbQuery('Вы не можете деактивировать самого себя.');
      }
      
      const admin = await Admin.findOne({ telegramId: adminId });
      if (!admin) {
        return ctx.answerCbQuery('Администратор не найден.');
      }
      
      admin.isActive = !admin.isActive;
      await admin.save();
      
      await ctx.answerCbQuery(`Администратор ${admin.isActive ? 'активирован' : 'деактивирован'}.`);
      
      // Обновляем сообщение
      await ctx.editMessageText(
        `Администратор: ${admin.firstName} ${admin.lastName} ${admin.username ? '@' + admin.username : ''}\n\n` +
        `ID: ${admin.telegramId}\n` +
        `Статус: ${admin.isActive ? '✅ Активен' : '❌ Неактивен'}\n` +
        `Добавлен: ${formatDate(admin.addedAt)}\n\n` +
        'Выберите действие:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              admin.isActive ? '🔴 Деактивировать' : '🟢 Активировать',
              `admin_toggle:${admin.telegramId}`
            )
          ],
          [Markup.button.callback('🗑️ Удалить', `admin_delete:${admin.telegramId}`)],
          [Markup.button.callback('◀️ Назад к списку', 'admin_back_to_list')]
        ])
      );
    } catch (error) {
      console.error('Error toggling admin:', error);
      ctx.answerCbQuery('Произошла ошибка при изменении статуса администратора.');
    }
  });
  
  bot.action(/admin_delete:(.+)/, isAdmin, async (ctx) => {
    try {
      const adminId = parseInt(ctx.match[1]);
      
      // Запрещаем удалять самого себя
      if (adminId === ctx.from.id) {
        return ctx.answerCbQuery('Вы не можете удалить самого себя.');
      }
      
      await Admin.findOneAndDelete({ telegramId: adminId });
      
      await ctx.answerCbQuery('Администратор успешно удален.');
      await ctx.deleteMessage();
      
      // Возвращаем пользователя к списку администраторов
      ctx.scene.enter('admin-list');
    } catch (error) {
      console.error('Error deleting admin:', error);
      ctx.answerCbQuery('Произошла ошибка при удалении администратора.');
    }
  });
  
  bot.action('admin_back_to_list', isAdmin, (ctx) => {
    ctx.answerCbQuery('Возвращаюсь к списку администраторов.');
    ctx.deleteMessage();
    ctx.scene.enter('admin-list');
  });
  
  bot.action('back_to_admin_management', isAdmin, (ctx) => {
    ctx.answerCbQuery();
    ctx.deleteMessage();
    ctx.reply('Выберите действие:', adminManagementKeyboard);
  });
  
  // Обработчик для просмотра администратора
  bot.action(/admin_view:(.+)/, isAdmin, async (ctx) => {
    try {
      const adminId = parseInt(ctx.match[1]);
      
      const admin = await Admin.findOne({ telegramId: adminId });
      if (!admin) {
        return ctx.answerCbQuery('Администратор не найден.');
      }
      
      // Запрещаем удалять самого себя
      const isSelf = admin.telegramId === ctx.from.id;
      
      await ctx.answerCbQuery();
      
      await ctx.editMessageText(
        `Администратор: ${admin.firstName} ${admin.lastName} ${admin.username ? '@' + admin.username : ''}\n\n` +
        `ID: ${admin.telegramId}\n` +
        `Статус: ${admin.isActive ? '✅ Активен' : '❌ Неактивен'}\n` +
        `Добавлен: ${formatDate(admin.addedAt)}\n\n` +
        'Выберите действие:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              admin.isActive ? '🔴 Деактивировать' : '🟢 Активировать',
              `admin_toggle:${admin.telegramId}`,
              isSelf // Disable button if it's the current admin
            )
          ],
          [
            Markup.button.callback(
              '🗑️ Удалить',
              `admin_delete:${admin.telegramId}`,
              isSelf // Disable button if it's the current admin
            )
          ],
          [Markup.button.callback('◀️ Назад к списку', 'admin_back_to_list')]
        ])
      );
    } catch (error) {
      console.error('Error viewing admin:', error);
      ctx.answerCbQuery('Произошла ошибка при просмотре администратора.');
    }
  });

  
  bot.hears('Активировать промокод вручную', isAdmin, (ctx) => {
    ctx.scene.enter('activate-promo');
  });
  
  // Обработчик для кнопки "История активаций"
  bot.hears('История активаций', isAdmin, (ctx) => {
    ctx.scene.enter('activated-promos');
  });
  
  bot.hears('Активировать промокод', isAdmin, (ctx) => {
    ctx.scene.enter('activate-user-promo');
  });
  
  // Обработка кнопок меню админ-панели
  bot.hears('Управление промокодами', isAdmin, (ctx) => {
    ctx.reply('Выберите действие:', promoManagementKeyboard);
  });
  
  bot.hears('Управление администраторами', isAdmin, (ctx) => {
    ctx.reply('Выберите действие:', adminManagementKeyboard);
  });
  
  bot.hears('Вернуться к обычному режиму', isAdmin, (ctx) => {
    ctx.reply('Вы вышли из режима администратора.', mainKeyboard);
  });
  
  bot.hears('Добавить промокод', isAdmin, (ctx) => {
    ctx.scene.enter('add-promo');
  });
  
  bot.hears('Список промокодов', isAdmin, (ctx) => {
    ctx.scene.enter('promo-list-admin');
  });
  
  bot.hears('Добавить администратора', isAdmin, (ctx) => {
    ctx.scene.enter('add-admin');
  });
  
  bot.hears('Список администраторов', isAdmin, (ctx) => {
    ctx.scene.enter('admin-list');
  });
  
  bot.hears('Назад', isAdmin, (ctx) => {
    ctx.reply('Выберите раздел:', adminKeyboard);
  });

  return {
    // Возвращаем сцены для регистрации в index.js
    scenes: [
      adminAuthScene,
      addPromoScene,
      addAdminScene,
      promoListAdminScene,
      adminListScene,
      editPromoScene,
      activatePromoScene,      // Добавляем новую сцену для активации
      activatedPromosScene     // Добавляем сцену истории активаций
    ]
  };
};