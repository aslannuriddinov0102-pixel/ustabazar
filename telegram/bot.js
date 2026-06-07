/**
 * Usta Bazar Telegram Bot — @UstaBazar_bot
 * Lokal: START_BOT.bat (serverda RUN_TELEGRAM_BOT bo'lmasin)
 * Deploy: RUN_TELEGRAM_BOT=true — server ichida ishga tushadi
 */
const { TOKEN, API_URL, SITE_URL } = require('./env');

const CITIES = ['Toshkent', 'Samarqand', 'Andijon', 'Buxoro', "Farg'ona", 'Namangan', 'Qarshi'];
const IS_LOCAL = /localhost|127\.0\.0\.1/i.test(SITE_URL);

let offset = 0;
const userCity = new Map();

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) console.error('TG xato [' + method + ']:', data.description);
  return data;
}

async function ubApi(path, opts = {}) {
  try {
    const res = await fetch(API_URL + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || 'API xato' };
    return data;
  } catch (e) {
    console.error('API xato:', e.message);
    return { error: e.message };
  }
}

function siteButtons(extraRows) {
  const rows = [];
  if (!IS_LOCAL) rows.push([{ text: '🌐 Saytni ochish', url: SITE_URL }]);
  if (extraRows) rows.push(...(Array.isArray(extraRows[0]) ? extraRows : [extraRows]));
  return rows.length ? { inline_keyboard: rows } : undefined;
}

function cityKeyboard() {
  const rows = [];
  for (let i = 0; i < CITIES.length; i += 3) {
    rows.push(CITIES.slice(i, i + 3).map(c => ({ text: c, callback_data: 'city_' + c })));
  }
  return { inline_keyboard: rows };
}

async function subscribe(chatId, name) {
  await ubApi('/bot/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, name }),
  });
}

async function sendWelcome(chatId, name) {
  await subscribe(chatId, name);
  const localHint = IS_LOCAL
    ? `\n\n💻 <b>Sayt:</b>\n<code>${SITE_URL}</code>`
    : '';
  await tg('sendMessage', {
    chat_id: chatId,
    text: `Salom${name ? ', ' + name : ''}! 👋\n\n<b>Usta Bazar</b> — usta topish va buyurtma platformasi.\n\n📌 Buyruqlar:\n/usta — Ustalar\n/order — Buyurtma\n/status — Buyurtmalarim\n/link +998... — Hisob ulash\n/sos — Favqulodda\n/help — Yordam${localHint}`,
    parse_mode: 'HTML',
    reply_markup: siteButtons([
      [{ text: '🔧 Ustalar', callback_data: 'masters' }, { text: '📋 Buyurtma', callback_data: 'order' }],
      [{ text: '📊 Status', callback_data: 'status' }, { text: '🆘 SOS', callback_data: 'sos' }],
    ]),
  });
}

async function sendMasters(chatId, city = 'Toshkent') {
  const masters = await ubApi('/masters?city=' + encodeURIComponent(city));
  if (!Array.isArray(masters) || !masters.length) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `❌ ${city} da usta topilmadi.`,
      reply_markup: cityKeyboard(),
    });
    return;
  }
  const top = masters.slice(0, 6);
  let text = `🔧 <b>${city}</b> — ${masters.length} ta usta:\n\n`;
  top.forEach((m, i) => {
    const v = m.verified ? '✅' : '⏳';
    text += `${i + 1}. ${v} <b>${m.name}</b>\n   ${m.title} · ⭐ ${m.rating}\n   ${m.category || 'Umumiy'}\n\n`;
  });
  if (IS_LOCAL) text += `\n💻 Sayt: <code>${SITE_URL}</code>`;
  else text += `\nUsta tanlash uchun tugmani bosing 👇`;

  const pickRows = top.slice(0, 4).map(m => [{
    text: `${m.name} (${m.rating}⭐)`,
    callback_data: 'pick_' + m.id,
  }]);

  await tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [...pickRows, [{ text: '📍 Boshqa shahar', callback_data: 'cities' }], ...(IS_LOCAL ? [] : [[{ text: '🌐 Sayt', url: SITE_URL }]])] },
  });
}

async function sendOrderMenu(chatId, city) {
  const c = city || userCity.get(chatId) || 'Toshkent';
  const masters = await ubApi('/masters?city=' + encodeURIComponent(c));
  if (!Array.isArray(masters) || !masters.length) {
    return tg('sendMessage', { chat_id: chatId, text: 'Usta topilmadi. /usta yozing.' });
  }
  const rows = masters.slice(0, 5).map(m => [{
    text: `${m.name} — ${m.title}`,
    callback_data: 'pick_' + m.id,
  }]);
  const hint = IS_LOCAL ? `\n\n💻 Sayt: <code>${SITE_URL}</code>` : '';
  await tg('sendMessage', {
    chat_id: chatId,
    text: `📋 <b>Buyurtma</b>\n\nUsta tanlang, keyin saytda xizmat va manzilni kiriting:${hint}`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows },
  });
}

async function sendStatus(chatId) {
  const data = await ubApi('/bot/orders?chat_id=' + chatId);
  if (data.error) {
    return tg('sendMessage', {
      chat_id: chatId,
      text: `❌ ${data.error}\n\nHisob ulash: <code>/link +998...</code>\n(Saytdagi telefon raqamingiz)`,
      parse_mode: 'HTML',
    });
  }
  if (!data.orders?.length) {
    return tg('sendMessage', { chat_id: chatId, text: `📭 ${data.user.name}, hozircha buyurtma yo'q.` });
  }
  let text = `📊 <b>${data.user.name}</b> — buyurtmalar:\n\n`;
  data.orders.forEach((o, i) => {
    text += `${i + 1}. <b>${o.order_code}</b>\n   ${o.service}\n   ${o.status} · ${(o.price || 0).toLocaleString()} so'm\n\n`;
  });
  await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: siteButtons() });
}

async function linkAccount(chatId, phone) {
  const data = await ubApi('/bot/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, phone }),
  });
  if (data.error) {
    return tg('sendMessage', { chat_id: chatId, text: '❌ ' + data.error });
  }
  await tg('sendMessage', {
    chat_id: chatId,
    text: `✅ <b>Ulandi!</b>\n${data.name} (${data.role})\n\nEndi /status — buyurtmalaringizni ko'rasiz.\nYangi buyurtma haqida xabar keladi.`,
    parse_mode: 'HTML',
  });
}

async function sendSOS(chatId, from) {
  await ubApi('/bot/sos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      name: from.first_name || 'Foydalanuvchi',
      message: 'Favqulodda yordam (Telegram bot)',
    }),
  });
  await tg('sendMessage', {
    chat_id: chatId,
    text: `🆘 <b>Favqulodda so'rov qabul qilindi!</b>\n\nTez orada bog'lanamiz.\nSantexnik, elektr, qulf — 24/7`,
    parse_mode: 'HTML',
  });
}

async function sendHelp(chatId) {
  await tg('sendMessage', {
    chat_id: chatId,
    text: `<b>Usta Bazar — yordam</b>\n\n/start — Boshlash\n/usta [shahar] — Ustalar\n/order — Buyurtma berish\n/status — Buyurtmalarim\n/link +998... — Hisob ulash\n/sos — Favqulodda\n/help — Yordam\n\n🌐 ${SITE_URL}`,
    parse_mode: 'HTML',
    reply_markup: cityKeyboard(),
  });
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/@\w+$/, '');

  try {
    if (cmd === '/start') return await sendWelcome(chatId, msg.from?.first_name);
    if (cmd === '/help') return await sendHelp(chatId);
    if (cmd === '/sos') return await sendSOS(chatId, msg.from || {});
    if (cmd === '/status') return await sendStatus(chatId);

    if (cmd === '/link') {
      const phone = parts[1];
      if (!phone) {
        return tg('sendMessage', {
          chat_id: chatId,
          text: 'Telefon kiriting:\n<code>/link +998888602533</code>\n\nSaytda ro\'yxatdan o\'tgan raqam bo\'lishi kerak.',
          parse_mode: 'HTML',
        });
      }
      return await linkAccount(chatId, phone);
    }

    if (cmd === '/usta') {
      if (!parts[1]) {
        return tg('sendMessage', {
          chat_id: chatId,
          text: '📍 Shaharni tanlang:',
          reply_markup: cityKeyboard(),
        });
      }
      const city = parts.slice(1).join(' ');
      userCity.set(chatId, city);
      return await sendMasters(chatId, city);
    }

    if (cmd === '/order') return await sendOrderMenu(chatId);

    if (text) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Buyruq tushunilmadi. /help yozing.',
      });
    }
  } catch (e) {
    console.error('handleMessage xato:', e.message);
    await tg('sendMessage', { chat_id: chatId, text: 'Xatolik. Qayta /start yozing.' });
  }
}

async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  await tg('answerCallbackQuery', { callback_query_id: cb.id });
  try {
    if (cb.data === 'masters') return await sendMasters(chatId, userCity.get(chatId) || 'Toshkent');
    if (cb.data === 'sos') return await sendSOS(chatId, cb.from || {});
    if (cb.data === 'status') return await sendStatus(chatId);
    if (cb.data === 'order') return await sendOrderMenu(chatId);
    if (cb.data === 'cities') {
      return tg('sendMessage', { chat_id: chatId, text: '📍 Shahar tanlang:', reply_markup: cityKeyboard() });
    }
    if (cb.data.startsWith('city_')) {
      const city = cb.data.slice(5);
      userCity.set(chatId, city);
      return await sendMasters(chatId, city);
    }
    if (cb.data.startsWith('pick_')) {
      const id = cb.data.slice(5);
      const m = await ubApi('/masters/' + id);
      const hint = IS_LOCAL ? `\n\n💻 Sayt: <code>${SITE_URL}</code>` : `\n\nSaytda usta profilini oching va "Buyurtma" bosing.`;
      return tg('sendMessage', {
        chat_id: chatId,
        text: `✅ <b>${m.name || 'Usta'}</b>\n${m.title || ''} · ⭐ ${m.rating || '—'}\n📍 ${m.city || ''}${hint}`,
        parse_mode: 'HTML',
        reply_markup: IS_LOCAL ? undefined : siteButtons(),
      });
    }
  } catch (e) {
    console.error('callback xato:', e.message);
  }
}

async function poll() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${offset}&timeout=25`);
    const data = await res.json();
    if (!data.ok) {
      console.error('getUpdates xato:', data.description);
    } else if (data.result?.length) {
      for (const u of data.result) {
        offset = u.update_id + 1;
        if (u.message) await handleMessage(u.message);
        if (u.callback_query) await handleCallback(u.callback_query);
      }
    }
  } catch (e) {
    console.error('Poll xato:', e.message);
  }
  setTimeout(poll, 300);
}

async function startBot() {
  if (!TOKEN) {
    console.log('TELEGRAM_BOT_TOKEN topilmadi');
    return;
  }
  const me = await tg('getMe', {});
  if (!me.ok) {
    console.log('\nXATO: Token yaroqsiz!\n', me.description);
    if (require.main === module) process.exit(1);
    return;
  }
  await tg('deleteWebhook', { drop_pending_updates: false });
  console.log('');
  console.log('========================================');
  console.log('  USTA BAZAR TELEGRAM BOT ISHLAYAPTI');
  console.log('  @' + me.result.username);
  console.log('  API:', API_URL);
  console.log('========================================');
  console.log('');
  poll();
}

if (require.main === module) {
  if (!TOKEN) {
    console.log('TELEGRAM_BOT_TOKEN topilmadi — .env faylini tekshiring');
    process.exit(1);
  }
  startBot();
}

module.exports = { startBot };
