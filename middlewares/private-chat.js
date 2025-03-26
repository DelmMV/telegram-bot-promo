const isPrivateChat = (ctx, next) => {
  // Проверяем, существует ли объект ctx.chat и является ли чат приватным
  if (!ctx.chat || ctx.chat.type !== 'private') {
    // Если это не приватный чат, логируем и полностью блокируем выполнение
    console.log(`Блокирована команда в групповом чате: ${ctx.message?.text || 'неизвестная команда'}, 
                 тип чата: ${ctx.chat?.type || 'неизвестный'}`);
    // Возвращаем undefined, чтобы прервать цепочку выполнения middleware
    return;
  }
  
  // Если это приватный чат, продолжаем выполнение
  return next();
};

module.exports = {
  isPrivateChat
};