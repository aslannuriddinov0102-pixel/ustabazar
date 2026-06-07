require('./env');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendTelegram(chatId, text, extra = {}) {
  if (!TOKEN || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
    });
    const data = await res.json();
    return data.ok;
  } catch {
    return false;
  }
}

module.exports = { sendTelegram };
