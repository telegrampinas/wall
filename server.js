const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATA_DIR = process.env.DATA_DIR || __dirname;
const FILE = path.join(DATA_DIR, 'data.json');

let db = {
  settings: { appName: 'Luzon Hub', txBase: 343, txBaseTime: Date.now(), txInterval: 5, txStep: 1 },
  employees: {},
  users: {}
};
try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  db = { ...db, ...saved, settings: { ...db.settings, ...saved.settings } };
} catch {}
const save = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
};
save();

const int = (v, min, max, d) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d; };
const txNow = s => s.txBase + Math.max(0, Math.floor((Date.now() - s.txBaseTime) / (s.txInterval * 60000))) * s.txStep;
const pub = u => ({ settings: db.settings, employees: db.employees, user: u ? { username: u, ...db.users[u] } : null, now: Date.now() });
const adminView = () => ({ ...pub(null), users: db.users });

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
  const u = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_.]{3,32}$/.test(u) || u === 'admin')
    return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, _ or .' });
  if (!db.users[u]) { db.users[u] = { vip: 0, joined: Date.now() }; save(); }
  res.json(pub(u));
});

app.get('/api/state', (req, res) => {
  const u = String(req.query.u || '').toLowerCase();
  res.json(pub(db.users[u] ? u : null));
});

const isAdmin = (req, res, next) =>
  req.get('x-admin-key') === ADMIN_PASSWORD ? next() : res.status(401).json({ error: 'Wrong admin password' });

app.post('/api/admin/login', isAdmin, (req, res) => res.json(adminView()));

app.post('/api/admin/save', isAdmin, (req, res) => {
  const b = req.body || {}, s = db.settings;
  if (b.settings) {
    const name = String(b.settings.appName || '').trim().slice(0, 40);
    if (name) s.appName = name;
    const cur = txNow(s);
    const iv = int(b.settings.txInterval, 1, 1440, s.txInterval);
    const st = int(b.settings.txStep, 1, 100000, s.txStep);
    const to = int(b.settings.txSetTo, 0, 1e12, cur);
    if (to !== cur || iv !== s.txInterval || st !== s.txStep)
      Object.assign(s, { txBase: to, txBaseTime: Date.now(), txInterval: iv, txStep: st });
  }
  for (const [k, v] of Object.entries(b.employees || {}))
    if (k.length <= 60) db.employees[k] = int(v, 0, 1e9, 0);
  for (const [k, v] of Object.entries(b.users || {}))
    if (db.users[k]) db.users[k].vip = int(v, 0, 6, 0);
  save();
  res.json(adminView());
});

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
