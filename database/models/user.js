const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true,
  },
  firstName: String,
  lastName: String,
  username: String,
  claimedPromos: [{
    promoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Promo',
    },
    code: String,
    claimedAt: {
      type: Date,
      default: Date.now,
    },
    activated: {
      type: Boolean,
      default: false
    },
    activatedAt: Date
  }],
  registeredAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('User', userSchema);