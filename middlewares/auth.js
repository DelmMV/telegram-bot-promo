const Admin = require('../database/models/admin');

const isAdmin = async (ctx, next) => {
  try {
    const telegramId = ctx.from.id;
    const admin = await Admin.findOne({ telegramId, isActive: true });
    
    if (!admin) {
      return ctx.reply('У вас нет доступа к админ-панели.');
    }
    
    ctx.state.admin = admin;
    return next();
  } catch (error) {
    console.error('Authentication error:', error);
    return ctx.reply('Произошла ошибка аутентификации.');
  }
};

module.exports = {
  isAdmin
};