const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const FILE = path.join(__dirname, 'data.json');

const empty = () => ({
  users: [], masters: [], orders: [], messages: [],
  reviews: [], referrals: [], disputes: [], payments: [], leads: [],
  telegram_subscribers: [], push_subscriptions: [], uploads: [],
  _seq: { users: 0, masters: 0, orders: 0, messages: 0, reviews: 0, referrals: 0, disputes: 0, payments: 0, leads: 0, uploads: 0 },
});

function load() {
  if (!fs.existsSync(FILE)) return empty();
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

let data = load();

function persist() { save(data); }

function nextId(table) {
  data._seq[table] = (data._seq[table] || 0) + 1;
  return data._seq[table];
}

function genRefCode() {
  return 'UB' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function now() { return new Date().toISOString(); }

const CITY_COORDS = {
  Toshkent: { lat: 41.2995, lng: 69.2401 },
  Samarqand: { lat: 39.6542, lng: 66.9597 },
  Andijon: { lat: 40.7821, lng: 72.3442 },
  Buxoro: { lat: 39.7747, lng: 64.4286 },
  "Farg'ona": { lat: 40.3864, lng: 71.7864 },
  Namangan: { lat: 40.9983, lng: 71.6726 },
  Qarshi: { lat: 38.8606, lng: 65.7891 },
};

function masterCoords(city, idx) {
  const base = CITY_COORDS[city] || CITY_COORDS.Toshkent;
  return { lat: +(base.lat + (idx % 4) * 0.012).toFixed(5), lng: +(base.lng + (idx % 3) * 0.015).toFixed(5) };
}

const ADMIN_USER = {
  name: 'Nuriddinov Aslan Adhamovich',
  phone: '+998888602533',
  telegram: 'AslanNuriddinov',
};

const DEMO_MASTERS = [
  { name: 'Jamshid Karimov', phone: '+998901234567', title: 'Santexnik usta', city: 'Toshkent', category: 'Santexnika', bio: '12 yillik tajriba, favqulodda xizmat', rating: 4.9, verified: 1 },
  { name: 'Abdulloh Karimov', phone: '+998901111111', title: 'Elektrik usta', city: 'Toshkent', category: 'Elektrik', bio: '8 yil, uy va ofis elektr montaji', rating: 4.8, verified: 1 },
  { name: 'Sanjar Rahimov', phone: '+998902222222', title: 'Santexnik', city: 'Toshkent', category: 'Santexnika', bio: 'Quvur, hammom, suv isitgich', rating: 4.8, verified: 1 },
  { name: 'Farida Toshmatova', phone: '+998903333333', title: 'Tozalash xizmati', city: 'Toshkent', category: 'Tozalash', bio: 'Uy va ofis chuqur tozalash', rating: 4.9, verified: 1 },
  { name: 'Dilnoza Mirzayeva', phone: '+998904444444', title: "Bo'yoqchi", city: 'Samarqand', category: "Bo'yoqchi", bio: 'Ichki va tashqi bo\'yoq ishlar', rating: 4.7, verified: 1 },
  { name: 'Rustam Aliyev', phone: '+998905555555', title: 'Duradgor', city: 'Andijon', category: 'Duradgorlik', bio: 'Mebel va eshik o\'rnatish', rating: 4.6, verified: 1 },
  { name: 'Nigora Saidova', phone: '+998906666666', title: 'Konditsioner usta', city: 'Buxoro', category: 'Konditsioner', bio: 'O\'rnatish va ta\'mirlash', rating: 4.9, verified: 1 },
  { name: 'Bobur Nazarov', phone: '+998907777777', title: 'Elektrik', city: "Farg'ona", category: 'Elektrik', bio: 'Simyog\'och va rozetka', rating: 4.7, verified: 0 },
  { name: 'Malika Karimova', phone: '+998908888888', title: 'Tozalash', city: 'Namangan', category: 'Tozalash', bio: 'Kundalik va haftalik tozalash', rating: 4.8, verified: 1 },
  { name: 'Zarina Husanova', phone: '+998909999999', title: 'Santexnik', city: 'Qarshi', category: 'Santexnika', bio: 'Kanalizatsiya va quvur', rating: 4.5, verified: 0 },
];

function ensureDemo() {
  const hash = bcrypt.hashSync('demo1234', 10);

  if (!data.users.find(u => u.phone === '+998912345678')) {
    const customer = { id: nextId('users'), name: 'Sardor Karimov', phone: '+998912345678', password: hash, role: 'customer', referral_code: genRefCode(), created_at: now() };
    data.users.push(customer);
  }

  DEMO_MASTERS.forEach(dm => {
    if (data.users.find(u => u.phone === dm.phone)) return;
    const user = { id: nextId('users'), name: dm.name, phone: dm.phone, password: hash, role: 'master', referral_code: genRefCode(), created_at: now() };
    data.users.push(user);
    const coords = masterCoords(dm.city, data.masters.length);
    data.masters.push({
      id: nextId('masters'), user_id: user.id, title: dm.title, city: dm.city,
      category: dm.category, bio: dm.bio, rating: dm.rating, verified: dm.verified,
      lat: coords.lat, lng: coords.lng,
    });
  });

  const jamshid = data.users.find(u => u.phone === '+998901234567');
  if (jamshid && !data.masters.find(m => m.user_id === jamshid.id)) {
    data.masters.push({ id: nextId('masters'), user_id: jamshid.id, title: 'Santexnik usta', city: 'Toshkent', category: 'Santexnika', bio: '12 yillik tajriba', rating: 4.9, verified: 1 });
  }

  if (jamshid) {
    const m = data.masters.find(x => x.user_id === jamshid.id);
    if (m && !m.category) { m.category = 'Santexnika'; }
  }

  let admin = data.users.find(u => u.role === 'admin');
  if (!admin) {
    admin = {
      id: nextId('users'), name: ADMIN_USER.name, phone: ADMIN_USER.phone,
      telegram: ADMIN_USER.telegram, password: hash, role: 'admin',
      referral_code: genRefCode(), status: 'active', created_at: now(),
    };
    data.users.push(admin);
  } else {
    admin.name = ADMIN_USER.name;
    admin.phone = ADMIN_USER.phone;
    admin.telegram = ADMIN_USER.telegram;
  }

  if (!data.leads) data.leads = [];
  if (!data.telegram_subscribers) data.telegram_subscribers = [];
  if (!data.push_subscriptions) data.push_subscriptions = [];
  if (!data.uploads) data.uploads = [];
  if (!data._seq.leads) data._seq.leads = 0;
  if (!data._seq.uploads) data._seq.uploads = 0;

  data.masters.forEach((m, i) => {
    if (m.lat == null || m.lng == null) {
      const c = masterCoords(m.city || 'Toshkent', i);
      m.lat = c.lat;
      m.lng = c.lng;
    }
  });

  persist();
  console.log('Demo: +998901234567 (usta) / +998912345678 (mijoz) — parol: demo1234');
  console.log(`Admin: ${ADMIN_USER.phone} (${ADMIN_USER.name}) — parol: demo1234`);
  console.log(`Ustalar: ${data.masters.length} ta`);
}

ensureDemo();

module.exports = {
  genRefCode, now, persist, masterCoords, CITY_COORDS,
  get data() { return data; },
  nextId,
  reload() { data = load(); },
};
