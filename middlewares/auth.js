const Admin = require('../database/models/admin');

const isAdmin = async (ctx, next) => {
  try {
    const telegramId = ctx.from.id;
    const admin = await Admin.findOne({ 
      telegramId, 
      isActive: true,
      role: 'admin'  // Проверяем, что пользователь именно администратор
    });
    
    if (!admin) {
      return ctx.reply('У вас нет доступа к панели администратора.');
    }
    
    ctx.state.admin = admin;
    return next();
  } catch (error) {
    console.error('Authentication error:', error);
    return ctx.reply('Произошла ошибка аутентификации.');
  }
};

const isSeller = async (ctx, next) => {
  try {
    const telegramId = ctx.from.id;
    const seller = await Admin.findOne({ 
      telegramId, 
      isActive: true,
      $or: [{ role: 'seller' }, { role: 'admin' }]  // Разрешаем доступ и продавцам, и администраторам
    });
    
    if (!seller) {
      return ctx.reply('У вас нет доступа к панели продавца.');
    }
    
    ctx.state.seller = seller;
    return next();
  } catch (error) {
    console.error('Authentication error:', error);
    return ctx.reply('Произошла ошибка аутентификации.');
  }
};

module.exports = {
  isAdmin,
  isSeller
};