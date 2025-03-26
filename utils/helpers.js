const moment = require('moment');

// Форматирование даты
const formatDate = (date) => {
  return moment(date).format('DD.MM.YYYY HH:mm');
};

// Проверить, является ли строка действительной датой в формате DD.MM.YYYY
const isValidDateFormat = (dateString) => {
  return moment(dateString, 'DD.MM.YYYY', true).isValid();
};

// Преобразовать строку в формате DD.MM.YYYY в объект Date
const parseDateString = (dateString) => {
  return moment(dateString, 'DD.MM.YYYY').toDate();
};

module.exports = {
  formatDate,
  isValidDateFormat,
  parseDateString
};