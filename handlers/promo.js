const { Scenes } = require('telegraf');
const User = require('../database/models/user');
const Promo = require('../database/models/promo');
const { generatePromoListKeyboard, mainKeyboard } = require('../utils/keyboard');
const { checkGroupMembership } = require('../middlewares/membership');
const { generatePromoCode } = require('../utils/promo-generator');
const { formatDate } = require('../utils/helpers');

module.exports = (bot) => {
  // Сцена для отображения списка доступных промокодов
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
      
      return ctx.reply(
        'Выберите промокод из списка:',
        generatePromoListKeyboard(promos)
      );
    } catch (error) {
      console.error('Error in promo list scene:', error);
      return ctx.reply('Произошла ошибка при загрузке промокодов.', mainKeyboard);
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
        promo => promo.promoId.toString() === promoId
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
  
  // Регистрируем сцену
  const stage = new Scenes.Stage([promoListScene]);
  bot.use(stage.middleware());
};