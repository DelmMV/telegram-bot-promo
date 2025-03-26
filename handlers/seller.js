const { Scenes, Markup } = require('telegraf');
const Admin = require('../database/models/admin');
const ActivatedPromo = require('../database/models/activatedPromo');
const User = require('../database/models/user');
const Promo = require('../database/models/promo');
const { sellerKeyboard, mainKeyboard, cancelButton } = require('../utils/keyboard');
const { isSeller } = require('../middlewares/auth');
const { formatDate } = require('../utils/helpers');

module.exports = (bot) => {
  // Команда для входа в панель продавца
  bot.command('seller', async (ctx) => {
    try {
      const telegramId = ctx.from.id;
      console.log(`Пользователь ${telegramId} запустил команду /seller`);
      
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
  
  // Сцена активации промокода для продавца
  const sellerActivatePromoScene = new Scenes.WizardScene(
    'seller-activate-code', // Новое уникальное имя сцены
    // Шаг 1: Запрос кода промокода для активации
    (ctx) => {
      console.log('Продавец запустил активацию, шаг 1');
      ctx.reply('Введите индивидуальный код промокода для активации:', cancelButton);
      return ctx.wizard.next();
    },
    // Шаг 2: Поиск и активация промокода
    async (ctx) => {
      console.log('Продавец, шаг 2, получен текст:', ctx.message?.text);
      
      if (!ctx.message || !ctx.message.text) {
        ctx.reply('Пожалуйста, введите текстовый код промокода.');
        return;
      }
      
      if (ctx.message.text === 'Отмена') {
        ctx.reply('Операция отменена.', sellerKeyboard);
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
            sellerKeyboard
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
            sellerKeyboard
          );
          return ctx.scene.leave();
        }
        
        // Находим промокод в массиве промокодов пользователя
        const claimedPromoIndex = user.claimedPromos.findIndex(p => p.code === promoCode);
        
        if (claimedPromoIndex === -1) {
          ctx.reply(
            `❌ Не удалось найти информацию о промокоде "${promoCode}".`,
            sellerKeyboard
          );
          return ctx.scene.leave();
        }
        
        const claimedPromo = user.claimedPromos[claimedPromoIndex];
        
        // Получаем информацию о типе промокода
        const promo = await Promo.findById(claimedPromo.promoId);
        
        if (!promo) {
          ctx.reply(
            `❌ Промокод "${promoCode}" найден у пользователя, но информация о типе промокода отсутствует.`,
            sellerKeyboard
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
        
        // Обновляем статистику продавца
        await Admin.findOneAndUpdate(
          { telegramId: ctx.from.id },
          { $inc: { activatedPromos: 1 } }
        );
        
        ctx.reply(
          `✅ Промокод "${promoCode}" успешно активирован!\n\n` +
          `Пользователь: ${user.firstName} ${user.lastName} ${user.username ? `(@${user.username})` : ''}\n` +
          `ID пользователя: ${user.telegramId}\n` +
          `Тип промокода: ${promo.name}\n` +
          `Описание: ${promo.description}\n` +
          `Выдан: ${formatDate(claimedPromo.claimedAt)}\n` +
          `Активирован: ${formatDate(new Date())}\n\n` +
          `Статистика по типу "${promo.name}":\n` +
          `Использовано всего: ${promo.usedCount}/${promo.totalLimit}`,
          sellerKeyboard
        );
        
        
        return ctx.scene.leave();
      } catch (error) {
        console.error('Error in promo activation by seller:', error);
        ctx.reply(`Произошла ошибка при активации промокода: ${error.message}`, sellerKeyboard);
        return ctx.scene.leave();
      }
    }
  );
  
  // Добавляем обработчик для кнопки "Отмена" в сцене
  sellerActivatePromoScene.hears('Отмена', (ctx) => {
    console.log('Продавец отменил активацию');
    ctx.reply('Операция отменена.', sellerKeyboard);
    return ctx.scene.leave();
  });
  
  // Функция регистрации обработчиков для продавца
  const registerSellerHandlers = () => {
    // Обработчик для активации промокода
    bot.hears('Активировать код клиента', async (ctx) => {
      try {
        const telegramId = ctx.from.id;
        console.log(`Пользователь ${telegramId} нажал "Активировать код клиента"`);
        
        // Проверяем, имеет ли пользователь роль продавца или администратора
        const seller = await Admin.findOne({ 
          telegramId, 
          isActive: true,
          $or: [{ role: 'seller' }, { role: 'admin' }]
        });
        
        if (!seller) {
          return ctx.reply('У вас нет доступа к функции активации промокодов.');
        }
        
        // Входим в сцену активации
        return ctx.scene.enter('seller-activate-code');
      } catch (error) {
        console.error('Error entering seller activation scene:', error);
        return ctx.reply('Произошла ошибка при запуске активации промокода.');
      }
    });
    
    // Обработчик для кнопки "Моя статистика"
    bot.hears('Моя статистика', async (ctx) => {
      try {
        const telegramId = ctx.from.id;
        console.log(`Пользователь ${telegramId} нажал "Моя статистика"`);
        
        // Проверяем роль
        const seller = await Admin.findOne({ 
          telegramId, 
          isActive: true,
          $or: [{ role: 'seller' }, { role: 'admin' }]
        });
        
        if (!seller) {
          return ctx.reply('У вас нет доступа к функции просмотра статистики продавца.');
        }
        
        // Получаем статистику продавца
        const recentActivations = await ActivatedPromo.find({ activatedBy: telegramId })
          .sort({ activatedAt: -1 })
          .limit(10)
          .populate('promoId');
        
        // Группируем активации по типам промокодов для статистики
        const promoStats = {};
        
        const allActivations = await ActivatedPromo.find({ activatedBy: telegramId });
        
        for (const activation of allActivations) {
          if (!promoStats[activation.promoId]) {
            promoStats[activation.promoId] = 0;
          }
          promoStats[activation.promoId]++;
        }
        
        // Получаем названия промокодов по их ID для статистики
        const promoNames = {};
        const promoIds = Object.keys(promoStats);
        
        for (const promoId of promoIds) {
          const promo = await Promo.findById(promoId);
          promoNames[promoId] = promo ? promo.name : 'Удаленный промокод';
        }
        
        // Формируем сообщение со статистикой
        let message = `📊 Статистика продавца: ${seller.firstName || ''} ${seller.lastName || ''}\n\n`;
        message += `Всего активировано промокодов: ${seller.activatedPromos || allActivations.length}\n\n`;
        
        message += '🔍 Статистика по типам промокодов:\n';
        if (Object.keys(promoStats).length === 0) {
          message += 'Нет активированных промокодов\n';
        } else {
          for (const promoId in promoStats) {
            message += `- ${promoNames[promoId]}: ${promoStats[promoId]} шт.\n`;
          }
        }
        
        message += '\n🕒 Последние активации:\n';
        if (recentActivations.length === 0) {
          message += 'Нет недавних активаций\n';
        } else {
          for (const activation of recentActivations) {
            const promoName = activation.promoId ? activation.promoId.name : 'Удаленный промокод';
            message += `- ${formatDate(activation.activatedAt)}: ${promoName} (${activation.code})\n`;
          }
        }
        
        return ctx.reply(message, sellerKeyboard);
      } catch (error) {
        console.error('Error getting seller stats:', error);
        return ctx.reply('Произошла ошибка при загрузке статистики.', sellerKeyboard);
      }
    });
    
    // Обработчик для возврата к обычному режиму
    bot.hears('Вернуться в обычный режим', (ctx) => {
      ctx.reply('Вы вышли из режима продавца.', mainKeyboard);
    });
  };
  
  // Возвращаем сцены и функцию для регистрации обработчиков
  return {
    scenes: [sellerActivatePromoScene],
    registerSellerHandlers
  };
};