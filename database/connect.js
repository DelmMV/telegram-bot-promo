const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Добавьте эту строку для устранения предупреждения
    mongoose.set('strictQuery', false); // или true, в зависимости от ваших предпочтений
    
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected');
  } catch (error) {
    console.error('Error connecting to MongoDB:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;