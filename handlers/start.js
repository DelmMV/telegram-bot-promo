const User = require('../database/models/user');
const { mainKeyboard } = require('../utils/keyboard');

module.exports = (bot) => {
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
      console.error('Error in start handler:', error);
      return ctx.reply('Произошла ошибка при запуске бота. Пожалуйста, попробуйте позже.');
    }
  });
  
  // Обработка кнопки "Промокоды" с главной клавиатуры
  bot.hears('Промокоды', (ctx) => {
    // Проверяем существование сцены перед попыткой войти в неё
    if (ctx.scene) {
      return ctx.scene.enter('promo-list');
    } else {
      console.error('Scene manager not available');
      return ctx.reply('Извините, произошла ошибка. Пожалуйста, попробуйте позже.');
    }
  });
};