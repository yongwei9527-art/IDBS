const { AppError } = require('../../lib/app-error');

function assertText(value, label, max = 200) {
  const text = String(value || '').trim();
  if (!text) throw new AppError(`${label} is required`, { status: 400, code: 2001 });
  if (text.length > max) throw new AppError(`${label} is too long`, { status: 400, code: 2001 });
  return text;
}

function assertPhone(value) {
  const phone = assertText(value, 'phone', 20);
  if (!/^\+?[0-9-]{6,20}$/.test(phone)) {
    throw new AppError('Invalid phone format', { status: 400, code: 2001 });
  }
  return phone;
}

function assertOptionalEmail(value) {
  const email = String(value || '').trim();
  if (!email) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('Invalid email format', { status: 400, code: 2001 });
  }
  return email.slice(0, 120);
}

function assertPassword(value) {
  const password = assertText(value, 'password', 100);
  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters', { status: 400, code: 2001 });
  }
  return password;
}

module.exports = {
  assertOptionalEmail,
  assertPassword,
  assertPhone,
  assertText
};
