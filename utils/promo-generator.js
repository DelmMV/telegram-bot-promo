const crypto = require('crypto');

// Генерация случайного промокода
const generatePromoCode = (length = 8) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const charactersLength = characters.length;
  let result = '';
  
  // Используем более современный и безопасный способ генерации случайных значений
  const randomValues = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    result += characters.charAt(randomValues[i] % charactersLength);
  }
  
  return result;
};

module.exports = {
  generatePromoCode,
};