const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  totalLimit: {
    type: Number,
    required: true,
  },
  usedCount: {
    type: Number,
    default: 0,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

promoSchema.virtual('isExpired').get(function() {
  return this.expiresAt < new Date();
});

promoSchema.virtual('isLimitReached').get(function() {
  return this.usedCount >= this.totalLimit;
});

promoSchema.virtual('isAvailable').get(function() {
  return this.isActive && !this.isExpired && !this.isLimitReached;
});

module.exports = mongoose.model('Promo', promoSchema);