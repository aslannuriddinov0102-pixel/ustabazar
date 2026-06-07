const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const store = require('./store');
require('../telegram/env');
const { sendTelegram } = require('../telegram/notify');
const { VAPID_PUBLIC, sendPushAll } = require('./push');
const payments = require('./payments');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const uploadMw = multer({ dest: UPLOAD_DIR, limits: { fileSize: 5 * 1024 * 1024 } });

function notifyTelegramSubs(text) {
  const subs = store.data.telegram_subscribers || [];
  subs.forEach(s => sendTelegram(s.chat_id, text));
}

function notifyOrderUsers(order, text) {
  const { data } = store;
  const customer = data.users.find(u => u.id === order.customer_id);
  const master = data.masters.find(m => m.id === order.master_id);
  const masterUser = master ? data.users.find(u => u.id === master.user_id) : null;
  [customer, masterUser].forEach(u => {
    if (u?.telegram_chat_id) sendTelegram(u.telegram_chat_id, text);
  });
}

function pushNotify(title, body) {
  sendPushAll({ title, body, icon: '/manifest.webmanifest' });
}

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'ustabazar-dev-secret-change-in-production';
const ROOT = path.join(__dirname, '..');

app.use(cors());
app.use(express.json());
app.use(express.static(ROOT));
app.use('/uploads', express.static(UPLOAD_DIR));

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 9) return '+998' + digits;
  if (digits.startsWith('998') && digits.length === 12) return '+' + digits;
  return '+' + digits;
}

function findUserByPhone(phone) {
  const norm = normalizePhone(phone);
  return store.data.users.find(u => normalizePhone(u.phone) === norm);
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token kerak' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Yaroqsiz token' });
  }
}

function adminOnly(req, res, next) {
  const user = store.data.users.find(u => u.id === req.user.id);
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin huquqi kerak' });
  next();
}

function enrichOrder(o) {
  const { data } = store;
  const customer = data.users.find(u => u.id === o.customer_id);
  const master = data.masters.find(m => m.id === o.master_id);
  const masterUser = master ? data.users.find(u => u.id === master.user_id) : null;
  return {
    ...o,
    total: (o.price || 0) + (o.fee || 0),
    customer_name: customer?.name,
    master_title: master?.title,
    master_name: masterUser?.name,
    master_category: master?.category,
  };
}

function canAccessOrder(user, order) {
  if (!order) return false;
  if (user.role === 'admin') return true;
  if (order.customer_id === user.id) return true;
  const master = store.data.masters.find(m => m.id === order.master_id);
  return master?.user_id === user.id;
}

function getMasters({ city, q, category } = {}) {
  const { data } = store;
  const needle = (q || '').toLowerCase().trim();
  return data.masters
    .map(m => {
      const u = data.users.find(x => x.id === m.user_id);
      return { ...m, name: u?.name, phone: u?.phone };
    })
    .filter(m => !city || m.city === city)
    .filter(m => !category || m.category === category)
    .filter(m => !needle || [m.name, m.title, m.bio, m.category, m.city].join(' ').toLowerCase().includes(needle))
    .sort((a, b) => b.rating - a.rating);
}

app.get('/', (_, res) => res.redirect('/Usta%20Bazar.html'));

app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok', service: 'Usta Bazar API', version: '1.5.0', phase: 2,
    database: store.dbType,
    payments: { payme: payments.paymeLive() ? 'live' : 'demo', click: payments.clickLive() ? 'live' : 'demo' },
    features: ['auth', 'masters', 'orders', 'chat', 'reviews', 'referrals', 'payments-payme-click', 'escrow', 'admin', 'leads', 'telegram-bot', 'gps-map', 'push', 'uploads', 'postgresql', 'websocket', 'production-ready'],
    target: '$500K in 18 months',
  });
});

app.post('/api/auth/register', (req, res) => {
  const { name, phone, password, role = 'customer', referral_code } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'Ism, telefon, parol kerak' });
  const normPhone = normalizePhone(phone);
  const { data } = store;
  if (findUserByPhone(normPhone)) return res.status(409).json({ error: 'Telefon allaqachon ro\'yxatdan o\'tgan' });
  const hash = bcrypt.hashSync(password, 10);
  const ref = store.genRefCode();
  const user = { id: store.nextId('users'), name, phone: normPhone, password: hash, role, referral_code: ref, status: 'active', created_at: store.now() };
  data.users.push(user);
  if (referral_code) {
    const referrer = data.users.find(u => u.referral_code === referral_code);
    if (referrer) {
      data.referrals.push({ id: store.nextId('referrals'), referrer_id: referrer.id, referred_id: user.id, bonus: 50000, status: 'pending', created_at: store.now() });
      user.referred_by = referrer.id;
    }
  }
  if (role === 'master') {
    const { title, city, category, bio } = req.body;
    const coords = store.masterCoords(city || 'Toshkent', data.masters.length);
    data.masters.push({
      id: store.nextId('masters'), user_id: user.id,
      title: title || 'Usta', city: city || 'Toshkent', category: category || 'Umumiy',
      bio: bio || '', rating: 5, verified: 0, lat: coords.lat, lng: coords.lng,
    });
  }
  store.persist();
  const token = jwt.sign({ id: user.id, role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name, phone, role, referral_code: ref } });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;
  const user = findUserByPhone(phone);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Telefon yoki parol noto\'g\'ri' });
  }
  if (user.status === 'suspended') return res.status(403).json({ error: 'Hisob to\'xtatilgan' });
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role, referral_code: user.referral_code } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = store.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  res.json({ id: user.id, name: user.name, phone: user.phone, role: user.role, referral_code: user.referral_code });
});

app.get('/api/masters', (req, res) => res.json(getMasters(req.query)));

app.get('/api/masters/map', (req, res) => {
  res.json(getMasters(req.query).filter(m => m.lat != null && m.lng != null));
});

app.get('/api/masters/:id', (req, res) => {
  const m = getMasters().find(x => x.id === +req.params.id);
  if (!m) return res.status(404).json({ error: 'Usta topilmadi' });
  const reviews = store.data.reviews.filter(r => r.master_id === m.id).slice(-10);
  res.json({ ...m, reviews });
});

app.post('/api/orders', auth, (req, res) => {
  const { master_id, service, price, address } = req.body;
  if (!master_id || !service || !price) return res.status(400).json({ error: 'Usta, xizmat, narx kerak' });
  const code = 'ORD-' + Date.now().toString().slice(-6);
  const fee = Math.round(price * 0.125);
  const order = {
    id: store.nextId('orders'), order_code: code, customer_id: req.user.id, master_id,
    service, price, fee, address: address || '', status: 'pending', created_at: store.now(),
  };
  store.data.orders.push(order);
  store.persist();
  broadcast({ type: 'new_order', order_code: code });
  const note = `🆕 <b>Yangi buyurtma!</b>\n${code}\n${service}\n${fmtPrice(price)}`;
  notifyTelegramSubs(note);
  notifyOrderUsers(order, note);
  pushNotify('Yangi buyurtma', code + ' — ' + service);
  res.json({ id: order.id, order_code: code, status: 'pending', fee });
});

function fmtPrice(n) {
  return (Number(n) || 0).toLocaleString('uz-UZ') + " so'm";
}

app.get('/api/orders', auth, (req, res) => {
  const orders = store.data.orders
    .filter(o => canAccessOrder(req.user, o))
    .map(enrichOrder)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(orders);
});

app.get('/api/orders/:id', auth, (req, res) => {
  const order = store.data.orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!canAccessOrder(req.user, order)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  res.json(enrichOrder(order));
});

app.patch('/api/orders/:id/status', auth, (req, res) => {
  const order = store.data.orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!canAccessOrder(req.user, order)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  const allowed = ['pending', 'in_progress', 'completed', 'disputed'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Yaroqsiz holat' });
  order.status = req.body.status;
  if (req.body.status === 'completed') order.completed_at = store.now();
  store.persist();
  broadcast({ type: 'order_update', order_id: order.id, status: order.status });
  const note = `📦 ${order.order_code} → ${order.status}`;
  notifyOrderUsers(order, note);
  pushNotify('Buyurtma yangilandi', note);
  res.json({ ok: true, status: order.status });
});

app.get('/api/orders/:id/messages', auth, (req, res) => {
  const order = store.data.orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!canAccessOrder(req.user, order)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  res.json(store.data.messages.filter(m => m.order_id === +req.params.id));
});

app.post('/api/orders/:id/messages', auth, (req, res) => {
  const order = store.data.orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!canAccessOrder(req.user, order)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  if (!req.body.text?.trim()) return res.status(400).json({ error: 'Xabar matni kerak' });
  const msg = { id: store.nextId('messages'), order_id: +req.params.id, from_role: req.user.role, text: req.body.text.trim(), created_at: store.now() };
  store.data.messages.push(msg);
  store.persist();
  broadcast({ type: 'chat', order_id: msg.order_id, from: req.user.role, text: msg.text });
  res.json({ id: msg.id });
});

app.post('/api/reviews', auth, (req, res) => {
  const { order_id, master_id, rating, text } = req.body;
  store.data.reviews.push({ id: store.nextId('reviews'), order_id, master_id, customer_id: req.user.id, rating, text, created_at: store.now() });
  const master = store.data.masters.find(m => m.id === master_id);
  if (master) {
    const revs = store.data.reviews.filter(r => r.master_id === master_id);
    master.rating = revs.reduce((s, r) => s + r.rating, 0) / revs.length;
  }
  store.persist();
  res.json({ ok: true });
});

app.get('/api/referrals', auth, (req, res) => {
  const user = store.data.users.find(u => u.id === req.user.id);
  const count = store.data.referrals.filter(r => r.referrer_id === req.user.id).length;
  res.json({ code: user?.referral_code, invites: count, earned: count * 50000, bonus_per_invite: 50000 });
});

app.post('/api/disputes', auth, (req, res) => {
  const d = { id: store.nextId('disputes'), order_id: req.body.order_id, reason: req.body.reason, status: 'open', created_at: store.now() };
  store.data.disputes.push(d);
  const order = store.data.orders.find(o => o.id === req.body.order_id);
  if (order) order.status = 'disputed';
  store.persist();
  res.json({ id: d.id, status: 'open' });
});

app.post('/api/payments/payme', auth, (req, res) => {
  const order = store.data.orders.find(o => o.id === +req.body.order_id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Faqat mijoz to\'lay oladi' });
  const amount = req.body.amount || (order.price || 0) + (order.fee || 0);
  const session = payments.createPaymeSession(order.id, amount);
  res.json({ status: 'redirect', mode: session.mode, url: session.url, message: session.message, external_id: session.external_id });
});

app.post('/api/payments/click', auth, (req, res) => {
  const order = store.data.orders.find(o => o.id === +req.body.order_id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Faqat mijoz to\'lay oladi' });
  const amount = req.body.amount || (order.price || 0) + (order.fee || 0);
  const session = payments.createClickSession(order.id, amount);
  res.json({ status: 'redirect', mode: session.mode, url: session.url, message: session.message, external_id: session.external_id });
});

app.post('/api/payments/confirm', auth, (req, res) => {
  const { order_id, method = 'card' } = req.body;
  const order = store.data.orders.find(o => o.id === +order_id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Faqat mijoz to\'lay oladi' });
  const r = payments.completePayment(order_id, method);
  if (!r.ok) return res.status(400).json({ error: r.error });
  const note = `💳 ${order.order_code} to'landi`;
  notifyOrderUsers(order, note);
  pushNotify('To\'lov qabul qilindi', order.order_code);
  broadcast({ type: 'order_update', order_id: order.id, status: r.status, text: `${order.order_code} to'landi` });
  res.json({ ok: true, status: r.status, mode: 'demo' });
});

app.get('/api/payments/status/:order_id', auth, (req, res) => {
  const order = store.data.orders.find(o => o.id === +req.params.order_id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (order.customer_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Ruxsat yo\'q' });
  }
  res.json(payments.paymentStatus(order.id));
});

app.post('/api/payments/webhook/payme', (req, res) => {
  const result = payments.handlePaymeWebhook(req.body, req.headers.authorization || '');
  if (result.result && req.body?.params?.account?.order_id) {
    const order = store.data.orders.find(o => o.id === +req.body.params.account.order_id);
    if (order) {
      notifyOrderUsers(order, `💳 ${order.order_code} Payme orqali to'landi`);
      broadcast({ type: 'order_update', order_id: order.id, status: 'in_progress' });
    }
  }
  res.json(result);
});

app.get('/api/payments/webhook/click', (req, res) => {
  const result = payments.handleClickWebhook(req.query);
  if (result.error === 0 && req.query.merchant_trans_id) {
    const orderId = String(req.query.merchant_trans_id).replace(/^UB-/, '');
    const order = store.data.orders.find(o => o.id === +orderId);
    if (order) {
      notifyOrderUsers(order, `💳 ${order.order_code} Click orqali to'landi`);
      broadcast({ type: 'order_update', order_id: order.id, status: 'in_progress' });
    }
  }
  res.json(result);
});

app.get('/api/stats', (_, res) => {
  const { data } = store;
  res.json({
    users: data.users.length,
    masters: data.masters.length,
    orders: data.orders.length,
    reviews: data.reviews.length,
    leads: (data.leads || []).length,
    revenue_month: data.orders.filter(o => o.status === 'completed').reduce((s, o) => s + (o.fee || 0), 0),
    phase: 1,
    roadmap: '18 months → $500K+',
  });
});

app.get('/api/push/vapid-public', (_, res) => res.json({ publicKey: VAPID_PUBLIC }));

app.post('/api/push/subscribe', auth, (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Subscription kerak' });
  if (!store.data.push_subscriptions) store.data.push_subscriptions = [];
  const exists = store.data.push_subscriptions.find(s => s.endpoint === sub.endpoint);
  if (!exists) {
    store.data.push_subscriptions.push({ ...sub, user_id: req.user.id, created_at: store.now() });
    store.persist();
  }
  res.json({ ok: true });
});

app.post('/api/upload', auth, uploadMw.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fayl kerak' });
  const rec = {
    id: store.nextId('uploads'), user_id: req.user.id, type: req.body.type || 'document',
    original: req.file.originalname, path: '/uploads/' + req.file.filename,
    mime: req.file.mimetype, size: req.file.size, created_at: store.now(),
  };
  if (!store.data.uploads) store.data.uploads = [];
  store.data.uploads.push(rec);
  store.persist();
  res.json({ ok: true, id: rec.id, url: rec.path, name: rec.original });
});

app.get('/api/uploads', auth, (req, res) => {
  res.json((store.data.uploads || []).filter(u => u.user_id === req.user.id));
});

app.post('/api/bot/link', (req, res) => {
  const { chat_id, phone } = req.body;
  if (!chat_id || !phone) return res.status(400).json({ error: 'chat_id va telefon kerak' });
  const user = findUserByPhone(phone);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi. Avval saytda ro\'yxatdan o\'ting.' });
  user.telegram_chat_id = chat_id;
  store.persist();
  res.json({ ok: true, name: user.name, role: user.role });
});

app.get('/api/bot/orders', (req, res) => {
  const chatId = +req.query.chat_id;
  if (!chatId) return res.status(400).json({ error: 'chat_id kerak' });
  const user = store.data.users.find(u => u.telegram_chat_id === chatId);
  if (!user) return res.status(404).json({ error: 'Hisob ulanmagan. /link +998... yozing' });
  const orders = store.data.orders
    .filter(o => canAccessOrder({ id: user.id, role: user.role }, o))
    .map(enrichOrder)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);
  res.json({ user: { name: user.name, role: user.role }, orders });
});

app.post('/api/bot/subscribe', (req, res) => {
  const { chat_id, name } = req.body;
  if (!chat_id) return res.status(400).json({ error: 'chat_id kerak' });
  if (!store.data.telegram_subscribers) store.data.telegram_subscribers = [];
  const exists = store.data.telegram_subscribers.find(s => s.chat_id === chat_id);
  if (!exists) {
    store.data.telegram_subscribers.push({ chat_id, name: name || '', subscribed_at: store.now() });
    store.persist();
  }
  res.json({ ok: true });
});

app.post('/api/bot/sos', (req, res) => {
  const { chat_id, name, phone, message } = req.body;
  if (!store.data.leads) store.data.leads = [];
  store.data.leads.push({
    id: store.nextId('leads'), type: 'sos', contact: name || 'Telegram', phone: phone || String(chat_id),
    service: message || 'Favqulodda', city: '—', company: 'Telegram bot', status: 'urgent', created_at: store.now(),
  });
  store.persist();
  notifyTelegramSubs(`🆘 <b>SOS!</b>\n${name || 'Foydalanuvchi'}\n${message || 'Favqulodda yordam'}`);
  res.json({ ok: true });
});

app.post('/api/leads', (req, res) => {
  const { company, contact, phone, email, city, service, package: pkg } = req.body;
  if (!contact || !phone) return res.status(400).json({ error: 'Ism va telefon kerak' });
  if (!store.data.leads) store.data.leads = [];
  const lead = {
    id: store.nextId('leads'), company: company || '', contact, phone: normalizePhone(phone),
    email: email || '', city: city || '', service: service || '', package: pkg || '',
    status: 'new', created_at: store.now(),
  };
  store.data.leads.push(lead);
  store.persist();
  broadcast({ type: 'new_lead', text: `Yangi B2B so'rov: ${contact}` });
  res.json({ ok: true, id: lead.id });
});

app.get('/api/admin/dashboard', auth, adminOnly, (_, res) => {
  const { data } = store;
  const users = data.users.filter(u => u.role !== 'admin').map(u => {
    const orderCount = data.orders.filter(o => o.customer_id === u.id).length;
    const master = data.masters.find(m => m.user_id === u.id);
    const masterOrders = master ? data.orders.filter(o => o.master_id === master.id).length : 0;
    return { id: u.id, name: u.name, phone: u.phone, role: u.role, status: u.status || 'active', orders: orderCount + masterOrders };
  });
  const orders = data.orders.map(enrichOrder);
  const disputes = (data.disputes || []).map(d => {
    const order = data.orders.find(o => o.id === d.order_id);
    const enriched = order ? enrichOrder(order) : {};
    return { ...d, order_code: order?.order_code, customer_name: enriched.customer_name, master_name: enriched.master_name };
  });
  res.json({
    stats: {
      users: data.users.length,
      masters: data.masters.length,
      orders: data.orders.length,
      disputes: disputes.length,
      leads: (data.leads || []).filter(l => l.status === 'new').length,
      revenue: data.orders.filter(o => o.status === 'completed').reduce((s, o) => s + (o.fee || 0), 0),
    },
    users,
    orders,
    disputes,
    leads: data.leads || [],
  });
});

app.patch('/api/admin/masters/:id', auth, adminOnly, (req, res) => {
  const master = store.data.masters.find(m => m.id === +req.params.id);
  if (!master) return res.status(404).json({ error: 'Usta topilmadi' });
  if (req.body.verified !== undefined) master.verified = req.body.verified ? 1 : 0;
  if (req.body.title) master.title = req.body.title;
  store.persist();
  res.json({ ok: true, verified: master.verified });
});

app.patch('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const user = store.data.users.find(u => u.id === +req.params.id);
  if (!user || user.role === 'admin') return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  if (req.body.status) user.status = req.body.status;
  store.persist();
  res.json({ ok: true, status: user.status });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'connected', message: 'Usta Bazar real-time ulanish' }));
  ws.on('close', () => clients.delete(ws));
});

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

store.init().then(() => {
  server.listen(PORT, () => {
    const host = process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT;
    console.log('');
    console.log('========================================');
    console.log('  USTA BAZAR API v1.5 ISHLAYAPTI!');
    console.log('  DB: ' + store.dbType);
    console.log('  Payme: ' + (payments.paymeLive() ? 'LIVE' : 'demo'));
    console.log('  Click: ' + (payments.clickLive() ? 'LIVE' : 'demo'));
    console.log('  ' + host + '/api/health');
    console.log('  ' + host + '/Usta%20Bazar.html');
    console.log('========================================');
    console.log('');
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.RUN_TELEGRAM_BOT === 'true') {
      try { require('../telegram/bot').startBot(); } catch (e) { console.log('Bot:', e.message); }
    }
  });
}).catch(err => {
  console.error('Ishga tushirish xato:', err);
  process.exit(1);
});
