const { Scenes } = require('telegraf');
const User = require('../database/models/user');
const Promo = require('../database/models/promo');
const { mainKeyboard } = require('../utils/keyboard');
const { formatDate } = require('../utils/helpers');

module.exports = (bot) => {
  // Сцена для отображения списка промокодов пользователя
  const userPromosScene = new Scenes.BaseScene('user-promos');
  
  userPromosScene.enter(async (ctx) => {
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
        
        // Определяем статус типа промокода
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
      console.error('Error in user promos scene:', error);
      return ctx.reply('Произошла ошибка при загрузке ваших промокодов.', mainKeyboard);
    }
  });
  
  // Обработка выхода из сцены
  userPromosScene.hears('Назад', (ctx) => {
    return ctx.reply('Возвращаюсь в главное меню', mainKeyboard);
  });
  
  return {
    scene: userPromosScene
  };
};