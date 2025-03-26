require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./database/models/admin');

const telegramId = parseInt(process.argv[2]);

if (!telegramId) {
  console.error('Пожалуйста, укажите Telegram ID администратора');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(async () => {
  console.log('MongoDB connected');
  
  try {
    const admin = new Admin({
      telegramId,
      isActive: true,
    });
    
    await admin.save();
    console.log(`Администратор с ID ${telegramId} успешно добавлен`);
    process.exit(0);
  } catch (error) {
    console.error('Ошибка при добавлении администратора:', error);
    process.exit(1);
  }
})
.catch((err) => {
  console.error('Ошибка подключения к MongoDB:', err);
  process.exit(1);
});