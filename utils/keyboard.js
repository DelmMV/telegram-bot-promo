const { Markup } = require('telegraf');

const mainKeyboard = Markup.keyboard([
  ['Промокоды', 'Мои промокоды']
]).resize();

const adminKeyboard = Markup.keyboard([
  ['Управление промокодами', 'Управление администраторами'],
  ['Активировать промокод вручную','История активаций'],
  ['Вернуться к обычному режиму']
]).resize();

const promoManagementKeyboard = Markup.keyboard([
  ['Добавить промокод', 'Список промокодов'],
  ['Назад']
]).resize();

const adminManagementKeyboard = Markup.keyboard([
  ['Добавить администратора', 'Список администраторов'],
  ['Назад']
]).resize();

const backButton = Markup.keyboard([['Назад']]).resize();
const cancelButton = Markup.keyboard([['Отмена']]).resize();

// Функция для генерации клавиатуры со списком промокодов
const generatePromoListKeyboard = (promos) => {
  return Markup.inlineKeyboard(
    promos.map(promo => [Markup.button.callback(promo.name, `promo:${promo._id}`)])
  );
};

module.exports = {
  mainKeyboard,
  adminKeyboard,
  promoManagementKeyboard,
  adminManagementKeyboard,
  backButton,
  cancelButton,
  generatePromoListKeyboard
};