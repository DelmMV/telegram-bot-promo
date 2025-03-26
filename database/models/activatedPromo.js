const mongoose = require('mongoose');

const activatedPromoSchema = new mongoose.Schema({
  promoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Promo',
    required: true
  },
  code: {
    type: String,
    required: true,
    unique: true
  },
  activatedBy: {
    type: Number, // telegramId администратора
    required: true
  },
  activatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ActivatedPromo', activatedPromoSchema);