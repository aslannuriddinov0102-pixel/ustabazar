const webpush = require('web-push');
const store = require('./store');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'BHNkSxckFLxjS-cYvdAlRcySazOcRCyQ1LWeiLLHrUg2GfpXrYuUJI47lBproWS5HCeUeY29LENJP_6d-XeRAwI';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'J5UKrymuDWgplr48J-B0e6eyPzn9xc3YvS7JX4ysUKA';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:info@ustabazar.uz';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

function sendPushAll(payload) {
  const subs = store.data.push_subscriptions || [];
  const body = JSON.stringify(payload);
  subs.forEach((sub) => {
    webpush.sendNotification(sub, body).catch(() => {});
  });
}

module.exports = { VAPID_PUBLIC, sendPushAll };
