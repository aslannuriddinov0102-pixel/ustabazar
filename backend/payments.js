const crypto = require('crypto');
const store = require('./store');

const PAYME_MERCHANT = process.env.PAYME_MERCHANT_ID || '';
const PAYME_KEY = process.env.PAYME_KEY || '';
const CLICK_MERCHANT = process.env.CLICK_MERCHANT_ID || '';
const CLICK_SERVICE = process.env.CLICK_SERVICE_ID || '';
const CLICK_SECRET = process.env.CLICK_SECRET_KEY || '';

function siteBase() {
  return process.env.RENDER_EXTERNAL_URL || process.env.SITE_BASE || 'http://localhost:3001';
}

function paymeLive() { return !!(PAYME_MERCHANT && PAYME_KEY); }
function clickLive() { return !!(CLICK_MERCHANT && CLICK_SERVICE && CLICK_SECRET); }

function completePayment(orderId, method, externalId) {
  const order = store.data.orders.find(o => o.id === +orderId);
  if (!order) return { ok: false, error: 'Buyurtma topilmadi' };
  if (order.status === 'in_progress' || order.status === 'completed') return { ok: true, status: order.status, already: true };
  order.status = 'in_progress';
  order.paid_at = store.now();
  store.data.payments.push({
    id: store.nextId('payments'), order_id: order.id, method,
    amount: (order.price || 0) + (order.fee || 0), status: 'completed',
    external_id: externalId || null, created_at: store.now(),
  });
  store.persist();
  return { ok: true, status: order.status, order };
}

function paymeCheckoutUrl(orderId, amountSom) {
  const tiyin = Math.round(Number(amountSom) * 100);
  const returnUrl = siteBase() + '/Usta%20Bazar.html';
  const params = `m=${PAYME_MERCHANT};ac.order_id=${orderId};a=${tiyin};c=${returnUrl}`;
  return `https://checkout.paycom.uz/${Buffer.from(params).toString('base64')}`;
}

function clickCheckoutUrl(orderId, amountSom) {
  const amount = Number(amountSom).toFixed(2);
  const sign = crypto.createHash('md5')
    .update([CLICK_SECRET, CLICK_SERVICE, orderId, amount].join(''))
    .digest('hex');
  const returnUrl = encodeURIComponent(siteBase() + '/Usta%20Bazar.html');
  return `https://my.click.uz/services/pay?service_id=${CLICK_SERVICE}&merchant_id=${CLICK_MERCHANT}&amount=${amount}&transaction_param=${orderId}&return_url=${returnUrl}&sign_time=${Date.now()}&sign_string=${sign}`;
}

function createPaymeSession(orderId, amount) {
  const ext = 'PAYME-' + orderId + '-' + Date.now();
  store.data.payments.push({
    id: store.nextId('payments'), order_id: +orderId, method: 'payme',
    amount, status: 'pending', external_id: ext, created_at: store.now(),
  });
  store.persist();
  if (paymeLive()) {
    return { mode: 'live', url: paymeCheckoutUrl(orderId, amount), external_id: ext };
  }
  return { mode: 'demo', message: 'Payme merchant ID va KEY .env ga qo\'shing', external_id: ext };
}

function createClickSession(orderId, amount) {
  const ext = 'CLICK-' + orderId + '-' + Date.now();
  store.data.payments.push({
    id: store.nextId('payments'), order_id: +orderId, method: 'click',
    amount, status: 'pending', external_id: ext, created_at: store.now(),
  });
  store.persist();
  if (clickLive()) {
    return { mode: 'live', url: clickCheckoutUrl(orderId, amount), external_id: ext };
  }
  return { mode: 'demo', message: 'Click MERCHANT_ID, SERVICE_ID, SECRET_KEY qo\'shing', external_id: ext };
}

function verifyPaymeAuth(authHeader) {
  if (!PAYME_KEY) return false;
  const expected = 'Basic ' + Buffer.from(`Paycom:${PAYME_KEY}`).toString('base64');
  return authHeader === expected;
}

function handlePaymeWebhook(body, authHeader) {
  if (!verifyPaymeAuth(authHeader)) {
    return { error: { code: -32504, message: 'Avtorizatsiya xato' } };
  }
  const { method, params, id } = body;
  const orderId = params?.account?.order_id;

  if (method === 'CheckPerformTransaction') {
    const order = store.data.orders.find(o => o.id === +orderId);
    if (!order) return { error: { code: -31050, message: 'Buyurtma topilmadi' }, id };
    return { result: { allow: true }, id };
  }

  if (method === 'PerformTransaction' || method === 'CreateTransaction') {
    const r = completePayment(orderId, 'payme', params?.id || params?.transaction);
    if (!r.ok) return { error: { code: -31050, message: r.error }, id };
    return { result: { transaction: String(params?.id || Date.now()), state: 2 }, id };
  }

  return { error: { code: -32601, message: 'Method topilmadi' }, id };
}

function handleClickWebhook(query) {
  const { click_trans_id, merchant_trans_id, amount, sign_string, action } = query;
  if (!clickLive()) return { error: -1, error_note: 'Click sozlanmagan' };

  const expected = crypto.createHash('md5')
    .update([click_trans_id, CLICK_SERVICE, CLICK_SECRET, merchant_trans_id, amount, action, '0'].join(''))
    .digest('hex');

  if (sign_string && sign_string !== expected) {
    return { error: -1, error_note: 'Imzo xato' };
  }

  if (+action === 1) {
    return { click_trans_id, merchant_trans_id, merchant_prepare_id: merchant_trans_id, error: 0, error_note: 'Success' };
  }

  if (+action === 0) {
    const orderId = String(merchant_trans_id).replace(/^UB-/, '');
    completePayment(orderId, 'click', click_trans_id);
    return { click_trans_id, merchant_trans_id, error: 0, error_note: 'OK' };
  }

  return { error: -3, error_note: 'Action xato' };
}

function paymentStatus(orderId) {
  const order = store.data.orders.find(o => o.id === +orderId);
  if (!order) return { paid: false, status: 'not_found' };
  const paid = order.status === 'in_progress' || order.status === 'completed' || !!order.paid_at;
  return { paid, status: order.status, order_code: order.order_code };
}

module.exports = {
  paymeLive, clickLive, completePayment,
  createPaymeSession, createClickSession,
  handlePaymeWebhook, handleClickWebhook, paymentStatus,
};
