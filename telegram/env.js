const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

function loadEnv() {
  if (process.env.RENDER_EXTERNAL_URL) {
    if (!process.env.SITE_URL) process.env.SITE_URL = process.env.RENDER_EXTERNAL_URL + '/Usta%20Bazar.html';
    if (!process.env.API_URL) process.env.API_URL = process.env.RENDER_EXTERNAL_URL + '/api';
  }
  if (!fs.existsSync(ENV_FILE)) return;
  fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const i = trimmed.indexOf('=');
    if (i < 1) return;
    const key = trimmed.slice(0, i).trim();
    const val = trimmed.slice(i + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  });
}

loadEnv();

module.exports = {
  TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  API_URL: process.env.API_URL || 'http://localhost:3001/api',
  SITE_URL: process.env.SITE_URL || 'http://localhost:3001/Usta%20Bazar.html',
};
