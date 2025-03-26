const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true,
  },
  firstName: String,
  lastName: String,
  username: String,
  role: {
    type: String,
    enum: ['admin', 'seller'],
    default: 'admin'
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  addedBy: {
    type: Number, // telegramId of admin who added this admin
    default: null,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
  // Статистика по активированным промокодам (для продавцов)
  activatedPromos: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Admin', adminSchema);