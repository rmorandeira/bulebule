require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const { rollDie, evaluateHand, compareHands } = require('./gameLogic');

let VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
let VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  const keys = webpush.generateVAPIDKeys();
  VAPID_PUBLIC = keys.publicKey;
  VAPID_PRIVATE = keys.privateKey;
  console.warn('VAPID keys not configured. Generated for this session (push subscriptions reset on restart).');
  console.warn('Set these env vars to persist them:');
  console.warn(`  VAPID_PUBLIC_KEY=${VAPID_PUBLIC}`);
  console.warn(`  VAPID_PRIVATE_KEY=${VAPID_PRIVATE}`);
}
webpush.setVapidDetails('mailto:rmorandeira@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

// Firebase Admin for FCM native push notifications
let messaging = null;
try {
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getMessaging } = require('firebase-admin/messaging');
  const svcAcct = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (svcAcct && !getApps().length) {
    initializeApp({ credential: cert(JSON.parse(svcAcct)) });
    messaging = getMessaging();
    console.log('Firebase Admin initialized (FCM ready)');
  }
} catch (e) {
  console.warn('Firebase Admin init failed (FCM unavailable):', e.message);
}

async function sendFcm(fcmToken, { title, body, roomCode }, userId = null) {
  if (!messaging) { console.warn('FCM: messaging not initialized (check FIREBASE_SERVICE_ACCOUNT)'); return; }
  if (!fcmToken)  { console.warn('FCM: no token for user', userId ?? '?'); return; }
  try {
    await messaging.send({
      token: fcmToken,
      notification: { title, body },
      data: { roomCode: roomCode ?? '' },
      android: { priority: 'high' },
    });
    console.log('FCM sent to', userId ?? fcmToken.slice(0, 12) + '…');
  } catch (e) {
    console.warn('FCM send error:', e.message);
    // Token expirado/inválido → limpiar de memoria y BD
    if (userId && (e.code === 'messaging/invalid-registration-token' || e.code === 'messaging/registration-token-not-registered')) {
      if (registeredUsers[userId]) registeredUsers[userId].fcmToken = null;
      stmts.deleteFcmToken.run(userId);
    }
  }
}

const UMAMI_URL = process.env.UMAMI_URL;
const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID;

async function trackEvent(name, data = {}) {
  if (!UMAMI_URL || !UMAMI_WEBSITE_ID) return;
  try {
    await fetch(`${UMAMI_URL}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: UMAMI_WEBSITE_ID,
          name,
          data,
          url: '/server',
          hostname: 'bule-bule-server',
          language: 'es',
          screen: '0x0',
        },
      }),
    });
  } catch { /* analytics never breaks gameplay */ }
}

const registeredUsers = {};
const socketToUser = {}; // socketId → userId, O(1) lookup

// ── SQLite persistence ────────────────────────────────────────────────────────
const Database = require('better-sqlite3');
const DB_PATH  = path.join(__dirname, 'data', 'bulebule.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id    TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    email      TEXT,
    picture    TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    visible    INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    user_id    TEXT PRIMARY KEY REFERENCES users(user_id),
    endpoint   TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS fcm_tokens (
    user_id    TEXT PRIMARY KEY REFERENCES users(user_id),
    token      TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS player_stats (
    user_id      TEXT PRIMARY KEY,
    name         TEXT NOT NULL DEFAULT '',
    picture      TEXT,
    score        INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    games_won    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS game_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT    NOT NULL,
    result      TEXT    NOT NULL,
    score_delta INTEGER NOT NULL DEFAULT 0,
    played_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS hand_stats (
    user_id   TEXT    NOT NULL,
    hand_desc TEXT    NOT NULL,
    hand_rank INTEGER NOT NULL DEFAULT 0,
    count     INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, hand_desc),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS roll_stats (
    user_id TEXT    NOT NULL,
    rolls   INTEGER NOT NULL,
    count   INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, rolls),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS items (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT,
    price       INTEGER NOT NULL DEFAULT 0,
    image_url   TEXT,
    category    TEXT    DEFAULT 'collectible',
    active      INTEGER DEFAULT 1,
    visible     INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS user_items (
    user_id   TEXT    NOT NULL,
    item_id   TEXT    NOT NULL,
    bought_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (item_id) REFERENCES items(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS pending_challenges (
    from_user_id TEXT NOT NULL,
    to_user_id   TEXT NOT NULL,
    room_code    TEXT NOT NULL PRIMARY KEY,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// ── Schema migrations ─────────────────────────────────────────────────────────
;(function migrateItemsSchema() {
  const cols = db.prepare('PRAGMA table_info(items)').all().map(c => c.name);
  if (!cols.includes('sale_start'))  db.prepare('ALTER TABLE items ADD COLUMN sale_start  INTEGER').run();
  if (!cols.includes('sale_end'))    db.prepare('ALTER TABLE items ADD COLUMN sale_end    INTEGER').run();
  if (!cols.includes('texture_url')) db.prepare('ALTER TABLE items ADD COLUMN texture_url TEXT').run();
  if (!cols.includes('sort_order'))  db.prepare('ALTER TABLE items ADD COLUMN sort_order  INTEGER DEFAULT 0').run();
  // `available` split into independent `active` (comprable) + `visible` (aparece en el marketplace) flags
  if (cols.includes('available') && !cols.includes('active')) {
    db.prepare('ALTER TABLE items RENAME COLUMN available TO active').run();
  }
  const cols2 = db.prepare('PRAGMA table_info(items)').all().map(c => c.name);
  if (!cols2.includes('visible')) db.prepare('ALTER TABLE items ADD COLUMN visible INTEGER DEFAULT 1').run();
})();

;(function migrateUsersSchema() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('active'))  db.prepare('ALTER TABLE users ADD COLUMN active  INTEGER NOT NULL DEFAULT 1').run();
  if (!cols.includes('visible')) db.prepare('ALTER TABLE users ADD COLUMN visible INTEGER NOT NULL DEFAULT 1').run();
})();

db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL,
    description   TEXT,
    tier          TEXT    NOT NULL DEFAULT 'Bronce',
    type          TEXT    NOT NULL DEFAULT 'tier',
    min_score     INTEGER NOT NULL DEFAULT 0,
    max_score     INTEGER NOT NULL DEFAULT -1,
    required_item TEXT,
    rules         TEXT,
    starts_at     INTEGER,
    ends_at       INTEGER,
    active        INTEGER NOT NULL DEFAULT 1,
    visible       INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

;(function migrateTournamentsSchema() {
  const cols = db.prepare('PRAGMA table_info(tournaments)').all().map(c => c.name);
  if (!cols.includes('visible')) db.prepare('ALTER TABLE tournaments ADD COLUMN visible INTEGER NOT NULL DEFAULT 1').run();
})();

// ── Migrate from old JSON file if it exists ───────────────────────────────────
(function migrateFromJson() {
  const jsonFile = path.join(__dirname, 'data', 'playerStats.json');
  if (!fs.existsSync(jsonFile)) return;
  try {
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const insUser  = db.prepare(`INSERT OR IGNORE INTO users (user_id, name) VALUES (?, ?)`);
    const insStats = db.prepare(`INSERT OR IGNORE INTO player_stats (user_id, score, games_played, games_won) VALUES (?, ?, ?, ?)`);
    db.transaction(() => {
      for (const [uid, s] of Object.entries(data)) {
        insUser.run(uid, uid);
        insStats.run(uid, s.score ?? 0, s.gamesPlayed ?? 0, s.gamesWon ?? 0);
      }
    })();
    fs.renameSync(jsonFile, jsonFile + '.migrated');
    console.log(`Migrated ${Object.keys(data).length} player entries from JSON to SQLite`);
  } catch (e) {
    console.error('JSON→SQLite migration failed:', e);
  }
})();

// ── Migrate player_stats name/picture → users (one-time) ──────────────────────
(function migratePlayerStatsToUsers() {
  const hasNameCol = db.prepare("PRAGMA table_info(player_stats)").all().some(c => c.name === 'name');
  if (!hasNameCol) return;
  const { changes } = db.prepare(`
    INSERT OR IGNORE INTO users (user_id, name, picture, created_at)
    SELECT user_id, COALESCE(NULLIF(name,''), user_id), picture, created_at
    FROM player_stats
  `).run();
  if (changes > 0) console.log(`Migrated ${changes} users from player_stats to users table`);
})();

// ── Load persisted users + push subscriptions into memory ─────────────────────
(function loadPersistedData() {
  for (const u of db.prepare('SELECT user_id, name, email, picture FROM users').all()) {
    registeredUsers[u.user_id] = { userId: u.user_id, name: u.name, email: u.email ?? null, picture: u.picture ?? null, socketId: null, pushSubscription: null, isGoogleUser: true };
  }
  let subCount = 0;
  for (const s of db.prepare('SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions').all()) {
    if (registeredUsers[s.user_id]) {
      registeredUsers[s.user_id].pushSubscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      subCount++;
    }
  }
  let fcmCount = 0;
  for (const f of db.prepare('SELECT user_id, token FROM fcm_tokens').all()) {
    if (registeredUsers[f.user_id]) {
      registeredUsers[f.user_id].fcmToken = f.token;
      fcmCount++;
    }
  }
  console.log(`Loaded ${Object.keys(registeredUsers).length} users, ${subCount} push subscriptions, ${fcmCount} FCM tokens from DB`);
})();

// Puntos por ronda: base + rank * multiplicador (rank 0–7)
const ROUND_PTS_BASE = 8;
const ROUND_PTS_MULT = 4;   // pareja=12, dos pares=16, trío=20, full=24, póker=28, repóker=32
const POINTS = { GAME_WIN: 80, GAME_PARTICIPATE: 10 };
const TIERS = [
  { name: 'Diamante', min: 700 },
  { name: 'Oro',      min: 300 },
  { name: 'Plata',    min: 100 },
  { name: 'Bronce',   min: 0   },
];

function getTier(score) { return TIERS.find(t => score >= t.min) ?? TIERS[TIERS.length - 1]; }

// Guests have no `users` row (not persisted) — only Google-authenticated accounts can be banned/hidden
function isUserBanned(userId) {
  if (!userId) return false;
  const row = stmts.getUserFlags.get(userId);
  return !!row && row.active === 0;
}

// ── Tournaments ───────────────────────────────────────────────────────────────
// Seed default tournament definitions on first run
;(function seedTournamentDefs() {
  const ins = db.prepare(`INSERT OR IGNORE INTO tournaments (id, name, tier, type, min_score, max_score, required_item, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    ins.run('bronce',     'Torneo Bronce',   'Bronce',   'tier',    0,   99,  null,       0);
    ins.run('plata',      'Torneo Plata',    'Plata',    'tier',    100, 299, null,       1);
    ins.run('oro',        'Torneo Oro',      'Oro',      'tier',    300, 699, null,       2);
    ins.run('diamante',   'Torneo Diamante', 'Diamante', 'tier',    700, -1,  null,       3);
    ins.run('bar-o-doce', 'Bar Doce',        'Especial', 'special', 0,   -1,  'bar-doce', 4);
  })();
})();

const tournamentPlayers = {};
let TOURNAMENT_DEFS = [];

function reloadTournamentDefs() {
  TOURNAMENT_DEFS = db.prepare('SELECT * FROM tournaments ORDER BY sort_order ASC, created_at ASC').all().map(t => ({
    id:           t.id,
    name:         t.name,
    description:  t.description ?? null,
    tier:         t.tier,
    type:         t.type,
    minScore:     t.min_score,
    maxScore:     t.max_score === -1 ? Infinity : t.max_score,
    requiredItem: t.required_item ?? null,
    active:       t.active === 1,
    visible:      t.visible === 1,
    starts_at:    t.starts_at,
    ends_at:      t.ends_at,
  }));
  TOURNAMENT_DEFS.forEach(t => { if (!tournamentPlayers[t.id]) tournamentPlayers[t.id] = {}; });
}
reloadTournamentDefs();

function getTournamentDef(id) { return TOURNAMENT_DEFS.find(t => t.id === id); }

function broadcastTournament(tournamentId) {
  const players = Object.values(tournamentPlayers[tournamentId] ?? {});
  const tournamentRooms = Object.values(rooms)
    .filter(r => r.tournamentId === tournamentId)
    .map(r => ({
      code: r.code,
      name: r.name,
      playerCount: r.players.filter(p => !p.isBot).length,
      maxPlayers: r.maxPlayers,
      phase: r.phase,
    }));
  io.to(`tournament:${tournamentId}`).emit('tournament_state', {
    tournamentId,
    players,
    rooms: tournamentRooms,
  });
}

const stmts = {
  upsertUser:    db.prepare(`INSERT INTO users (user_id, name, email, picture)
                               VALUES (?, ?, ?, ?)
                               ON CONFLICT(user_id) DO UPDATE
                                 SET name=excluded.name, email=excluded.email, picture=excluded.picture, updated_at=unixepoch()`),
  ensureUser:    db.prepare(`INSERT OR IGNORE INTO users (user_id, name, picture) VALUES (?, ?, ?)`),
  ensureStats:   db.prepare(`INSERT OR IGNORE INTO player_stats (user_id) VALUES (?)`),
  getStats:      db.prepare(`SELECT * FROM player_stats WHERE user_id = ?`),
  updateStats:   db.prepare(`UPDATE player_stats
                               SET score=?, games_played=?, games_won=?, updated_at=unixepoch()
                               WHERE user_id=?`),
  insertSession: db.prepare(`INSERT INTO game_sessions (user_id, result, score_delta) VALUES (?, ?, ?)`),
  upsertPushSub: db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
                               VALUES (?, ?, ?, ?)
                               ON CONFLICT(user_id) DO UPDATE
                                 SET endpoint=excluded.endpoint, p256dh=excluded.p256dh, auth=excluded.auth, updated_at=unixepoch()`),
  deletePushSub:  db.prepare(`DELETE FROM push_subscriptions WHERE user_id=?`),
  upsertFcmToken: db.prepare(`INSERT INTO fcm_tokens (user_id, token) VALUES (?, ?)
                               ON CONFLICT(user_id) DO UPDATE SET token=excluded.token, updated_at=unixepoch()`),
  deleteFcmToken:          db.prepare(`DELETE FROM fcm_tokens WHERE user_id=?`),
  insertPendingChallenge:  db.prepare(`INSERT OR REPLACE INTO pending_challenges (from_user_id, to_user_id, room_code) VALUES (?,?,?)`),
  deletePendingChallenge:  db.prepare(`DELETE FROM pending_challenges WHERE room_code=?`),
  getPendingChallenges:    db.prepare(`SELECT from_user_id, room_code FROM pending_challenges WHERE to_user_id=?`),
  rankings:       db.prepare(`SELECT ps.user_id, u.name, u.picture, ps.score, ps.games_played, ps.games_won
                               FROM player_stats ps JOIN users u ON ps.user_id=u.user_id
                               WHERE u.visible = 1
                               ORDER BY ps.score DESC LIMIT 100`),
  getUserFlags:   db.prepare(`SELECT active, visible FROM users WHERE user_id = ?`),
  upsertHandStat: db.prepare(`INSERT INTO hand_stats (user_id, hand_desc, hand_rank, count)
                               VALUES (?, ?, ?, 1)
                               ON CONFLICT(user_id, hand_desc) DO UPDATE SET count = count + 1`),
  upsertRollStat: db.prepare(`INSERT INTO roll_stats (user_id, rolls, count)
                               VALUES (?, ?, 1)
                               ON CONFLICT(user_id, rolls) DO UPDATE SET count = count + 1`),
  getHandStats:   db.prepare(`SELECT hand_desc, hand_rank, count FROM hand_stats WHERE user_id = ? ORDER BY count DESC`),
  getRollStats:   db.prepare(`SELECT rolls, count FROM roll_stats WHERE user_id = ? ORDER BY rolls`),
  getItems:       db.prepare(`SELECT * FROM items WHERE visible = 1 ORDER BY price ASC`),
  getItemById:    db.prepare(`SELECT * FROM items WHERE id = ?`),
  getUserItems:   db.prepare(`SELECT item_id FROM user_items WHERE user_id = ?`),
  insertUserItem: db.prepare(`INSERT OR IGNORE INTO user_items (user_id, item_id) VALUES (?, ?)`),
  deductScore:    db.prepare(`UPDATE player_stats SET score = score - ? WHERE user_id = ? AND score >= ?`),
};

// ── Seed marketplace items ─────────────────────────────────────────────────────
;(function seedItems() {
  const SEED = [
    { id: 'torre-hercules',  name: 'Torre de Hércules',  description: 'El faro romano más antiguo en uso del mundo, símbolo de A Coruña.', price: 200000, image_url: '/assets/items/torre-hercules.png',  category: 'landmark' },
    { id: 'maria-pita',      name: 'Maria Pita',          description: 'Heroína coruñesa que defendió la ciudad ante el ataque inglés en 1589.', price: 50000, image_url: '/assets/items/maria-pita.png',      category: 'figure'   },
    { id: 'plaza-maria-pita',name: 'Pza. Maria Pita',     description: 'La emblemática plaza del ayuntamiento, corazón de A Coruña.', price: 200000, image_url: '/assets/items/plaza-maria-pita.png', category: 'landmark' },
    { id: 'cubata',          name: 'Cubata',              description: 'El clásico del verano gallego.', price: 5000,   image_url: '/assets/items/cubata.png',          category: 'collectible' },
    { id: 'churros',         name: 'Churros',             description: 'Para los jugadores más dulces.', price: 3000,   image_url: '/assets/items/churros.png',         category: 'collectible' },
    { id: 'balon',           name: 'Balón',               description: 'Para los campeones del tablero.', price: 10000, image_url: '/assets/items/balon.png',           category: 'collectible' },
    { id: 'dice-standard',   name: 'Dados Estándar',      description: 'El conjunto de dados clásico. Gratuito para todos los jugadores.', price: 0, image_url: '/assets/dice/standard.png', category: 'dice' },
    { id: 'dice-marble',       name: 'Mármol Azul',           description: 'Conjunto de dados con textura de mármol azul. Actívalos desde tu colección.',   price: 3000, image_url: '/assets/dice/marble.png',       category: 'dice' },
    { id: 'dice-marble-black', name: 'Mármol Negro',          description: 'Dados con textura de mármol negro. Elegancia oscura para los mejores jugadores.', price: 3000, image_url: '/assets/dice/marble-black.png', category: 'dice' },
    { id: 'dice-marble-red',   name: 'Mármol Rojo',           description: 'Dados con textura de mármol rojo. Para los jugadores más apasionados.',           price: 3000, image_url: '/assets/dice/marble-red.png',   category: 'dice' },
    { id: 'dice-marble-green', name: 'Mármol Verde',          description: 'Dados con textura de mármol verde. La suerte del tablero está de tu lado.',        price: 3000, image_url: '/assets/dice/marble-green.png', category: 'dice' },
    { id: 'dice-transp-red',   name: 'Dados Rojos Transparentes', description: 'Dados con acabado traslúcido en rojo. Minimalismo con estilo.', price: 3000, image_url: '/assets/dice/transparent-red.png', category: 'dice' },
    { id: 'pack-1000-bules',   name: '1.000 Bules',           description: 'Recarga tu saldo con 1.000 Bules. Pago único de 1 € por Bizum.',                   price: 0,    image_url: '/assets/items/pack-1000-bules.png', category: 'pack', active: 0 },
    { id: 'bar-el-polvorin',   name: 'Bar El Polvorín',       description: 'El bar más icónico del barrio. Un clásico para los jugadores de Bule Bule.',         price: 45000, image_url: '/assets/items/bar-el-polvorin.png', category: 'landmark' },
    { id: 'bar-el-olimpico',   name: 'Bar El Olímpico',       description: 'Un referente del barrio donde el tiempo se detiene entre partida y partida.<br><em>Especialidad en café, no café de especialidad.</em>', price: 45000, image_url: '/assets/items/bar-el-olimpico.png', category: 'landmark' },
    { id: 'bar-doce',          name: 'Bar Doce',              description: 'El número doce de la calle y el primero en tu corazón. Pintxos, conversación y alguna que otra mano ganada en la barra.', price: 45000, image_url: '/assets/items/bar-doce.png', category: 'landmark' },
    { id: 'bar-el-ocho',       name: 'Bar El Ocho',           description: 'Café-bar de Monte Alto con solera. Donde el barrio se sienta, se sirve el mejor café y las partidas duran lo que tienen que durar.', price: 45000, image_url: '/assets/items/bar-el-ocho.png', category: 'landmark' },
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO items (id, name, description, price, image_url, category) VALUES (?, ?, ?, ?, ?, ?)`);
  const tx  = db.transaction(() => SEED.forEach(i => ins.run(i.id, i.name, i.description, i.price, i.image_url, i.category)));
  tx();
  // Fix image_url for items that existed before the path was updated
  db.prepare(`UPDATE items SET image_url = '/assets/dice/transparent-red.png' WHERE id = 'dice-transp-red' AND image_url = '/assets/dice/transparent-red.svg'`).run();
  // Update Bar El Olímpico description to use <br> before italic line
  db.prepare(`UPDATE items SET description = 'Un referente del barrio donde el tiempo se detiene entre partida y partida.<br><em>Especialidad en café, no café de especialidad.</em>' WHERE id = 'bar-el-olimpico'`).run();
  // Ensure Bar El Ocho and Bar Doce exist with correct data
  db.prepare(`INSERT OR IGNORE INTO items (id, name, description, price, image_url, category) VALUES ('bar-el-ocho', 'Bar El Ocho', 'Café-bar de Monte Alto con solera. Donde el barrio se sienta, se sirve el mejor café y las partidas duran lo que tienen que durar.', 45000, '/assets/items/bar-el-ocho.png', 'landmark')`).run();
  db.prepare(`INSERT OR IGNORE INTO items (id, name, description, price, image_url, category) VALUES ('bar-el-olimpico', 'Bar El Olímpico', 'Un referente del barrio donde el tiempo se detiene entre partida y partida.<br><em>Especialidad en café, no café de especialidad.</em>', 45000, '/assets/items/bar-el-olimpico.png', 'landmark')`).run();
  db.prepare(`UPDATE items SET image_url = '/assets/items/bar-el-ocho.png' WHERE id = 'bar-el-ocho'`).run();
})();

// ── Superuser bootstrap ────────────────────────────────────────────────────────
;(function seedSuperUser() {
  const id = 'rmorandeira@gmail.com'
  const score = 12_000_000
  db.prepare(`INSERT OR IGNORE INTO users (user_id, name, email, picture, created_at, updated_at) VALUES (?, ?, ?, NULL, strftime('%s','now'), strftime('%s','now'))`).run(id, 'Roi Vázquez', id)
  db.prepare(`INSERT OR IGNORE INTO player_stats (user_id, name, score, games_played, games_won, created_at, updated_at) VALUES (?, ?, ?, 0, 0, strftime('%s','now'), strftime('%s','now'))`).run(id, 'Roi Vázquez', score)
  db.prepare(`UPDATE player_stats SET score = ? WHERE user_id = ? AND score < ?`).run(score, id, score)
})();

function ensureStats(userId) {
  const u = registeredUsers[userId];
  stmts.ensureUser.run(userId, u?.name ?? userId, u?.picture ?? null);
  stmts.ensureStats.run(userId);
  return stmts.getStats.get(userId);
}

const commitGamePoints = db.transaction((uid, roundDelta, result) => {
  const row = stmts.getStats.get(uid);
  if (!row) return 0;
  let score = row.score + roundDelta;
  let gamesWon = row.games_won;
  if (result === 'win')  { score += POINTS.GAME_WIN; gamesWon++; }
  else                   { score += POINTS.GAME_PARTICIPATE; }
  const delta = score - row.score;
  stmts.updateStats.run(score, row.games_played + 1, gamesWon, uid);
  stmts.insertSession.run(uid, result, delta);
  return delta;
});

function getUserIdForPlayer(player) {
  if (player.isBot) return null;
  return socketToUser[player.id] ?? null;
}

function awardRoundPoints(room) {
  if (!room.pendingScores) room.pendingScores = {};
  for (const player of room.players) {
    if (player.isBot) continue;
    const uid = getUserIdForPlayer(player);
    if (!uid) continue; // guests: shown as — in UI
    const handRank = player.hand?.rank ?? 0;
    const roundPts = ROUND_PTS_BASE + handRank * ROUND_PTS_MULT;
    room.pendingScores[uid] = (room.pendingScores[uid] ?? 0) + roundPts;

    // Track final hand (repóker players have hand=null, re-evaluate from dice)
    const hand = player.hand ?? (player.liberado ? evaluateHand(player.currentDice) : null);
    if (hand) stmts.upsertHandStat.run(uid, hand.desc, hand.rank);

    // Track rolls used this round
    if (player.rollCount > 0) stmts.upsertRollStat.run(uid, player.rollCount);
  }
}

function awardGamePoints(room, gameWinnerId, gameLoserId) {
  if (!room.pendingScores)   room.pendingScores   = {};
  if (!room.lastGameScores)  room.lastGameScores  = {};
  for (const player of room.players) {
    if (player.isBot) continue;
    const uid = getUserIdForPlayer(player);
    if (uid) {
      const result = player.id === gameWinnerId ? 'win' : player.id === gameLoserId ? 'loss' : 'participate';
      const delta = commitGamePoints(uid, room.pendingScores[uid] ?? 0, result);
      room.lastGameScores[uid] = delta; // shown on finished screen
    }
    // Guests: not persisted, shown as — in UI
  }
  room.pendingScores = {};
}

function buildRankings() {
  return stmts.rankings.all().map((row, i) => {
    const registered = registeredUsers[row.user_id];
    const isPlaying = Object.values(rooms).some(r =>
      !r.vsBot && r.phase !== 'lobby' && r.players.some(p => p.id === row.user_id)
    );
    return {
      userId:      row.user_id,
      name:        registered?.name    ?? row.name,
      picture:     registered?.picture ?? row.picture ?? null,
      score:       row.score,
      gamesPlayed: row.games_played,
      gamesWon:    row.games_won,
      tier:        getTier(row.score).name,
      rank:        i + 1,
      isPlaying,
      online:      !!registered?.socketId,
    };
  });
}

const _ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
const ALLOWED_ORIGIN = _ALLOWED_ORIGIN === '*'
  ? '*'
  : (origin, cb) => {
      const allowed = [
        ..._ALLOWED_ORIGIN.split(',').map(o => o.trim()),
        'capacitor://localhost',
        'http://localhost',
      ]
      if (!origin || allowed.includes(origin)) cb(null, true)
      else cb(new Error('Not allowed by CORS'))
    }

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '12mb' }));
app.get('/', (_, res) => res.send('OK'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));
// ── Uploads ───────────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Backoffice static files ───────────────────────────────────────────────────
const BACKOFFICE_DIST = path.join(__dirname, 'backoffice-dist');
if (fs.existsSync(BACKOFFICE_DIST)) {
  app.use('/backoffice', express.static(BACKOFFICE_DIST));
  app.get('/backoffice/*', (_, res) => res.sendFile(path.join(BACKOFFICE_DIST, 'index.html')));
}
app.get('/api/vapid-public-key', (_, res) => res.json({ key: VAPID_PUBLIC }));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
});

const rooms = {};

const { VALUE_RANK } = require('./gameLogic');
const TURN_TIMEOUT      = 30_000;
const CONTINUE_TIMEOUT  = 30_000;
const TIEBREAK_TIMEOUT  = 30_000;
const BOT_ID = '__bot__';
const BOT_NAME = 'Bot';

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
function makeRateLimiter(maxCalls, windowMs) {
  const timestamps = [];
  return function() {
    const now = Date.now();
    while (timestamps.length && timestamps[0] <= now - windowMs) timestamps.shift();
    if (timestamps.length >= maxCalls) return false;
    timestamps.push(now);
    return true;
  };
}

function makePlayer(id, name) {
  return { id, name, diceSkin: null, currentDice: [], rollHistory: [], rollDiscardHistory: [], rollCount: 0, done: false, hand: null, wins: 0, pendingDiscards: [], breaks: 0, liberado: false };
}

function makeBotPlayer(n = 0) {
  return { ...makePlayer(`${BOT_ID}_${n}`, n === 0 ? BOT_NAME : `${BOT_NAME} ${n + 1}`), isBot: true };
}

// POC de mensajería: los bots que no están jugando reaccionan de vez en cuando,
// en plan koruño, según si el otro jugador acaba de tirar o de descartar
const BOT_CHAT_CHANCE = 0.25;
const BOT_EMOJIS = ['👍', '😂', '🔥', '😮', '👏'];
const BOT_ROLL_PHRASES = [
  '¡Buah neno, flipas con esa tirada!',
  'Mazo kies esos dados, chorbo',
  'De risas esa tirada, eh',
  '¡Vaya tirada, neno!',
  'Achanta, que menuda tirada te ha salido',
];
const BOT_DISCARD_PHRASES = [
  '¿Descartas eso? Flipas, chorbo',
  'Buah, ese descarte es mazo kies',
  '¡De risas ese cambio, neno!',
  'A pillar dados nuevos, a ver qué sale',
  'Vaya jugada te traes con el descarte',
];

function maybeBotChatter(room, player) {
  const current = room.players[room.currentPlayerIndex];
  const phrasePool = (player?.rollCount ?? 0) > 1 ? BOT_DISCARD_PHRASES : BOT_ROLL_PHRASES;
  for (const p of room.players) {
    if (!p.isBot || p.done || p.id === current?.id) continue;
    if (Math.random() >= BOT_CHAT_CHANCE) continue;
    const text = Math.random() < 0.5
      ? BOT_EMOJIS[Math.floor(Math.random() * BOT_EMOJIS.length)]
      : phrasePool[Math.floor(Math.random() * phrasePool.length)];
    const code = room.code;
    const botId = p.id;
    setTimeout(() => {
      const r = rooms[code];
      const bot = r?.players.find(pl => pl.id === botId);
      if (!bot) return;
      io.to(code).emit('player_message', { fromId: bot.id, fromName: bot.name, text });
    }, 400 + Math.random() * 1600);
  }
}

// Returns indices of dice the bot wants to keep
function botPickKept(dice) {
  const counts = {};
  dice.forEach(d => { counts[d] = (counts[d] || 0) + 1; });

  const ranked = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || VALUE_RANK[b[0]] - VALUE_RANK[a[0]])
    .map(([val]) => val);

  const best = ranked[0];
  const bestCount = counts[best];

  // Keep triples (+ pair if present → towards full/poker)
  if (bestCount >= 3) {
    const keep = new Set([best]);
    if (ranked[1] && counts[ranked[1]] >= 2) keep.add(ranked[1]);
    return dice.map((d, i) => keep.has(d) ? i : -1).filter(i => i !== -1);
  }

  // Keep pairs (up to two)
  if (bestCount === 2) {
    const keep = new Set([best]);
    if (ranked[1] && counts[ranked[1]] >= 2) keep.add(ranked[1]);
    return dice.map((d, i) => keep.has(d) ? i : -1).filter(i => i !== -1);
  }

  // No groups: keep highest die
  const highVal = dice.reduce((b, d) => VALUE_RANK[d] > VALUE_RANK[b] ? d : b);
  return [dice.indexOf(highVal)];
}

function botShouldStand(hand, rollCount, maxRolls) {
  if (rollCount >= maxRolls) return true;
  if (hand.rank >= 5) return true;                               // Full o mejor
  if (hand.rank >= 3 && rollCount >= maxRolls - 1) return true; // Trío con 1 tiro restante
  if (hand.rank >= 2 && rollCount >= maxRolls - 1) return true; // Dobles parejas con 1 tiro restante
  return false;
}

// Bot phases driven by frontend signals:
// 'rolled'  – bot just rolled, waiting for frontend to emit bot_ready after animation
// 'picking' – bot decided to keep some dice, frontend shows selection then emits bot_ready
// null      – bot not waiting

function botAct(code) {
  const room = rooms[code];
  if (!room || room.phase !== 'playing') return;
  const bot = room.players[room.currentPlayerIndex];
  if (!bot?.isBot || bot.done) return;

  const maxAllowed = room.maxRolls ?? 3;

  if (room.botPhase === 'picking') {
    // Frontend finished showing selection — do the re-roll now
    const keptIndices = room.botKeptIndices || [];
    const discarded = bot.currentDice.map((_, i) => i).filter(i => !keptIndices.includes(i));
    bot.rollHistory.push([...bot.currentDice]);
    bot.rollDiscardHistory.push(discarded);
    bot.currentDice = bot.currentDice.map((d, i) => keptIndices.includes(i) ? d : rollDie());
    bot.rollCount++;
    bot.rollSeed = Math.floor(Math.random() * 0xFFFFFFFF);
    room.botPhase = 'rolled';
    room.botKeptIndices = [];
    broadcast(code);
    return;
  }

  if (bot.rollCount > 0) {
    const hand = evaluateHand(bot.currentDice);
    if (botShouldStand(hand, bot.rollCount, maxAllowed)) {
      room.botPhase = null;
      room.botKeptIndices = [];
      finishTurn(room, bot);
      broadcast(code);
      return;
    }
    // Show selection to frontend, then wait for bot_ready to do re-roll
    room.botKeptIndices = botPickKept(bot.currentDice);
    room.botPhase = 'picking';
    broadcast(code);
    return;
  }

  // First roll
  bot.currentDice = Array.from({ length: 5 }, rollDie);
  bot.rollCount = 1;
  bot.rollSeed = Math.floor(Math.random() * 0xFFFFFFFF);
  room.botPhase = 'rolled';
  room.botKeptIndices = [];
  broadcast(code);
}

function runBotTurn(code) {
  // Small delay to let room state propagate before first action
  setTimeout(() => botAct(code), 300);
}

function clearTurnTimer(room) {
  if (room.turnTimerId) {
    clearTimeout(room.turnTimerId);
    room.turnTimerId = null;
  }
}

function clearContinueTimer(room) {
  if (room.continueTimerId) {
    clearTimeout(room.continueTimerId);
    room.continueTimerId = null;
  }
}

function clearTiebreakerTimer(room) {
  if (room.tiebreakerTimerId) {
    clearTimeout(room.tiebreakerTimerId);
    room.tiebreakerTimerId = null;
  }
}

// ── Desempate a la caída (mini-ronda con los dados normales) ──────────────────

function startDesempate(room, playerIds, provisionalWinnerId) {
  clearTurnTimer(room);
  room.roundWinnerId = provisionalWinnerId;
  room.desempate = true;

  for (const p of room.players) {
    if (playerIds.includes(p.id)) {
      p.inDesempate = true;
      p.done        = false;
      p.rollCount   = 0;
      p.currentDice = [];
      p.hand        = null;
      p.pendingDiscards  = [];
      p.rollHistory      = [];
      p.rollDiscardHistory = [];
    } else {
      p.inDesempate = false;
      // non-desempate players keep done=true from the main round
    }
  }

  const firstIdx = room.players.findIndex(p => p.id === playerIds[0]);
  room.startingPlayerIndex = firstIdx !== -1 ? firstIdx : 0;
  room.currentPlayerIndex  = room.startingPlayerIndex;
  room.maxRolls    = 1;    // desempate a la caída: una sola tirada
  room.turnDeadline = null;

  awaitContinue(room);
}

// Pausa entre jugadores: el siguiente (bot o humano) no empieza hasta que
// alguien pulse Continuar o expire el contador de 30s
const BOT_CONTINUE_TIMEOUT = 3_000;

function awaitContinue(room) {
  clearContinueTimer(room);
  room.awaitingContinue = true;
  const nextPlayer = room.players[room.currentPlayerIndex];
  const timeout = nextPlayer?.isBot ? BOT_CONTINUE_TIMEOUT : CONTINUE_TIMEOUT;
  room.continueDeadline = Date.now() + timeout;
  const code = room.code;
  room.continueTimerId = setTimeout(() => {
    const r = rooms[code];
    if (!r || r.phase !== 'playing' || !r.awaitingContinue) return;
    proceedTurn(r);
    broadcast(code);
  }, timeout);
}

function proceedTurn(room) {
  clearContinueTimer(room);
  room.awaitingContinue = false;
  room.continueDeadline = null;
  const p = room.players[room.currentPlayerIndex];
  if (p?.isBot) runBotTurn(room.code);
  else startTurnTimer(room);
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  const p = room.players[room.currentPlayerIndex];
  if (!p || p.isBot || p.done || room.phase !== 'playing') return;

  room.turnDeadline = Date.now() + TURN_TIMEOUT;
  const capturedIndex = room.currentPlayerIndex;
  const code = room.code;

  room.turnTimerId = setTimeout(() => {
    const r = rooms[code];
    if (!r || r.phase !== 'playing' || r.currentPlayerIndex !== capturedIndex) return;
    const player = r.players[r.currentPlayerIndex];
    if (!player || player.done || player.isBot) return;

    if (player.rollCount === 0) {
      player.currentDice = Array.from({ length: 5 }, rollDie);
      player.rollCount = 1;
      player.rollSeed = Math.floor(Math.random() * 0xFFFFFFFF);
      r.turnDeadline = null;
      broadcast(code);
      startTurnTimer(r);
    } else {
      finishTurn(r, player);
      broadcast(code);
    }
  }, TURN_TIMEOUT);
}

function sanitize(room) {
  return {
    code: room.code,
    name: room.name,
    maxPlayers: room.maxPlayers,
    vsBot: room.vsBot ?? false,
    isPrivate: !!room.isPrivate,
    isChallenge: !!room.isChallenge,
    challengedUserId: room.challengedUserId ?? null,
    challengedName: room.challengedName ?? null,
    hostId: room.hostId,
    phase: room.phase,
    roundNumber: room.roundNumber,
    currentPlayerIndex: room.currentPlayerIndex,
    maxRolls: room.maxRolls,
    roundWinnerId: room.roundWinnerId,
    roundLoserId: room.roundLoserId ?? null,
    gameLoserId: room.gameLoserId ?? null,
    endReason: room.endReason ?? null,
    botPhase: room.botPhase ?? null,
    botKeptIndices: room.botKeptIndices ?? [],
    turnDeadline: room.turnDeadline ?? null,
    awaitingContinue: room.awaitingContinue ?? false,
    continueDeadline: room.continueDeadline ?? null,
    maxRounds: room.maxRounds ?? 0,
    desempate: room.desempate ?? false,
    players: room.players.map(p => {
      const uid = getUserIdForPlayer(p);
      return {
        id: p.id,
        userId: uid ?? null,
        name: p.name,
        isBot: p.isBot ?? false,
        diceSkin: p.isBot ? null : (p.diceSkin ?? null),
        currentDice: p.currentDice,
        rollHistory: p.rollHistory,
        rollDiscardHistory: p.rollDiscardHistory ?? [],
        rollCount: p.rollCount,
        rollSeed: p.rollSeed ?? null,
        done: p.done,
        hand: p.hand,
        wins: p.wins,
        breaks: p.breaks ?? 0,
        liberado: p.liberado ?? false,
        pendingDiscards: p.pendingDiscards ?? [],
        score: (!uid || p.isBot) ? null : (room.phase === 'finished'
          ? (room.lastGameScores?.[uid] ?? 0)
          : (room.pendingScores?.[uid] ?? 0)),
        inDesempate: p.inDesempate ?? false,
      };
    }),
  };
}

function sanitizeForList(room) {
  return {
    code: room.code,
    name: room.name,
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    phase: room.phase,
    isPrivate: !!room.isPrivate,
    isChallenge: !!room.isChallenge,
    tournamentId: room.tournamentId ?? null,
    playerIds: room.players.map(p => p.id),
  };
}

function broadcast(code) {
  const room = rooms[code];
  if (!room) return;
  room.lastActivityAt = Date.now();
  io.to(code).emit('room_state', sanitize(room));
}

function broadcastRoomList() {
  const allRooms = Object.values(rooms).filter(r => !r.vsBot && !r.tournamentId);
  // Las salas de reto solo son visibles para el usuario retado — el resto no debe verlas en el listado
  for (const sock of io.sockets.sockets.values()) {
    const uid = sock.data.userId;
    const visible = allRooms.filter(r => !r.isChallenge || r.challengedUserId === uid);
    sock.emit('rooms_list', visible.map(sanitizeForList));
  }
}

// ── Stale room cleanup (runs every 5 minutes) ─────────────────────────────────
const ROOM_TTL = {
  finished: 10 * 60 * 1000,   // 10 min — enough time for rematch
  lobby:    30 * 60 * 1000,   // 30 min — abandoned before starting
  playing: 120 * 60 * 1000,   // 2 h    — stuck game safety net
  results: 120 * 60 * 1000,
  tiebreak: 120 * 60 * 1000,
};

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [code, room] of Object.entries(rooms)) {
    const ttl = ROOM_TTL[room.phase] ?? ROOM_TTL.playing;
    const idle = now - (room.lastActivityAt ?? now);
    if (idle < ttl) continue;
    clearTurnTimer(room);
    clearContinueTimer(room);
    clearTiebreakerTimer(room);
    io.to(code).emit('room_destroyed', { byPlayer: null });
    stmts.deletePendingChallenge.run(code);
    delete rooms[code];
    cleaned++;
  }
  if (cleaned > 0) {
    console.log(`[cleanup] Removed ${cleaned} stale room(s)`);
    broadcastRoomList();
  }
}, 5 * 60 * 1000);

function startRound(room) {
  room.phase = 'playing';
  // El perdedor de la ronda anterior abre la siguiente
  const starterIdx = room.players.findIndex(p => p.id === room.nextStarterId);
  room.startingPlayerIndex = starterIdx !== -1 ? starterIdx : 0;
  room.maxRolls = null;
  room.roundWinnerId = null;
  room.botPhase = null;
  room.botKeptIndices = [];
  room.turnDeadline = null;
  clearContinueTimer(room);
  room.awaitingContinue = false;
  room.continueDeadline = null;
  room.roundNumber = (room.roundNumber ?? 0) + 1;
  room.roundLoserId = null;
  for (const p of room.players) {
    p.currentDice = [];
    p.rollHistory = [];
    p.rollDiscardHistory = [];
    p.rollCount = 0;
    p.done = !!p.liberado; // los liberados ya no juegan
    p.hand = null;
    p.pendingDiscards = [];
  }
  // Si quien abriría la ronda ya está liberado, pasa al siguiente jugador disponible
  const n = room.players.length;
  let idx = room.startingPlayerIndex;
  for (let step = 0; step < n && room.players[idx].done; step++) {
    idx = (idx + 1) % n;
  }
  room.currentPlayerIndex = idx;
  awaitContinue(room);
}

function applyRoundLoss(room, loser) {
  if (room.desempate) {
    room.desempate = false;
    for (const p of room.players) p.inDesempate = false;
  }
  room.roundLoserId = loser.id;
  room.nextStarterId = loser.id;
  if (loser.breaks >= 3) {
    room.gameLoserId = loser.id;
    room.endReason = 'capilla';
    const gameWinner = room.players.find(p => p.id === room.roundWinnerId);
    if (gameWinner) gameWinner.wins += 1;
    awardRoundPoints(room);
    awardGamePoints(room, room.roundWinnerId, loser.id);
    room.phase = 'finished';
    trackEvent('game_end', { endReason: 'capilla', rounds: room.roundNumber, playerCount: room.players.length });
    return;
  }
  loser.breaks += 1;
  const maxRounds = room.maxRounds ?? 0;
  if (maxRounds > 0 && room.roundNumber >= maxRounds) {
    const worst = [...room.players].sort((a, b) => b.breaks - a.breaks)[0];
    room.gameLoserId = worst.id;
    room.endReason = 'rounds';
    const gameWinner = room.players.filter(p => p.id !== worst.id).sort((a, b) => a.breaks - b.breaks)[0];
    if (gameWinner) gameWinner.wins += 1;
    awardRoundPoints(room);
    awardGamePoints(room, gameWinner?.id ?? null, worst.id);
    room.phase = 'finished';
    trackEvent('game_end', { endReason: 'rounds', rounds: room.roundNumber, playerCount: room.players.length });
  } else {
    awardRoundPoints(room);
    room.phase = 'results';
    clearContinueTimer(room);
    room.continueDeadline = Date.now() + CONTINUE_TIMEOUT;
    const code = room.code;
    room.continueTimerId = setTimeout(() => {
      const r = rooms[code];
      if (!r || r.phase !== 'results') return;
      startRound(r);
      broadcast(code);
    }, CONTINUE_TIMEOUT);
  }
}

function finishTurn(room, player) {
  clearTurnTimer(room);
  player.done = true;
  player.hand = evaluateHand(player.currentDice);
  if (player.hand.rank === 7) {
    player.liberado = true;
    player.hand = null; // el liberado no compite por el peor puesto
  }
  if (room.currentPlayerIndex === (room.startingPlayerIndex ?? 0)) {
    room.maxRolls = player.rollCount;
  }
  // Si acaba de liberarse: terminar ronda solo si no quedan no-liberados pendientes de jugar
  if (player.liberado) {
    const nonLiberado = room.players.filter(p => !p.liberado);
    const pendingPlay = nonLiberado.some(p => !p.done);
    if (!pendingPlay && nonLiberado.length <= 1) {
      endRound(room);
      return;
    }
  }
  // Orden circular: el que abre la ronda puede no ser el índice 0
  const n = room.players.length;
  let next = -1;
  for (let step = 1; step < n; step++) {
    const idx = (room.currentPlayerIndex + step) % n;
    if (!room.players[idx].done) { next = idx; break; }
  }
  if (next !== -1) {
    room.currentPlayerIndex = next;
    awaitContinue(room);
  } else {
    endRound(room);
  }
}

function endRound(room) {
  // En desempate solo compiten los jugadores marcados con inDesempate
  const participants = room.desempate
    ? room.players.filter(p => p.inDesempate && p.hand)
    : room.players.filter(p => p.hand);
  const liberadoWinner = room.players.find(p => p.liberado);
  const nonLiberado = room.players.filter(p => !p.liberado);

  // Si hay un liberado y solo queda 1 jugador sin liberar → la partida termina
  if (liberadoWinner && nonLiberado.length <= 1) {
    liberadoWinner.wins += 1;
    room.roundWinnerId = liberadoWinner.id;
    if (nonLiberado.length === 1) {
      room.gameLoserId = nonLiberado[0].id;
      room.endReason = 'liberado';
    }
    awardGamePoints(room, liberadoWinner.id, nonLiberado[0]?.id ?? null);
    room.phase = 'finished';
    trackEvent('game_end', { endReason: room.endReason ?? 'liberado', rounds: room.roundNumber, playerCount: room.players.length });
    return;
  }

  if (participants.length === 0) {
    // Caso auto-pérdida: el jugador no-liberado pierde sin haber jugado
    const autoLoser = room.players.find(p => !p.liberado);
    if (!autoLoser) return; // no debería ocurrir
    if (liberadoWinner) {
      room.roundWinnerId = liberadoWinner.id;
    }
    applyRoundLoss(room, autoLoser);
    return;
  }

  let winner = participants[0];
  let loser  = participants[0];
  for (const p of participants) {
    if (compareHands(p.hand, winner.hand) > 0) winner = p;
    if (compareHands(p.hand, loser.hand)  < 0) loser  = p;
  }

  // Detect tie for last place → desempate a la caída
  const worstHand  = loser.hand;
  const tiedLosers = participants.filter(p => compareHands(p.hand, worstHand) === 0);
  if (tiedLosers.length > 1) {
    const notTied = participants.filter(p => !tiedLosers.includes(p));
    const provisionalWinner = notTied.length > 0
      ? notTied.reduce((best, p) => compareHands(p.hand, best.hand) > 0 ? p : best)
      : winner;
    startDesempate(room, tiedLosers.map(p => p.id), provisionalWinner.id);
    return;
  }

  // En desempate el roundWinnerId ya apunta al ganador provisional de la ronda completa
  if (!room.desempate) {
    room.roundWinnerId = winner.id;
  }
  if (loser.id === winner.id && participants.length > 1) {
    loser = participants.find(p => p.id !== winner.id);
  }
  applyRoundLoss(room, loser);
}

app.get('/api/rankings', (_, res) => res.json({ rankings: buildRankings().slice(0, 100) }));

// ── Backoffice admin token (persisted in SQLite) ──────────────────────────────
const crypto = require('crypto');
const ADMIN_TOKEN = (() => {
  const row = db.prepare('SELECT value FROM config WHERE key=?').get('admin_token');
  if (row) return row.value;
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('admin_token', token);
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  BACKOFFICE ADMIN TOKEN (cópialo, no cambiará)                  ║');
  console.log(`║  ${token}  ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  return token;
})();

// ── Backoffice admin API ──────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const expected = process.env.BACKOFFICE_SECRET || ADMIN_TOKEN;
  if (req.headers.authorization !== `Bearer ${expected}`) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// Image upload (base64 JSON → saved to data/uploads/)
app.post('/api/admin/upload', requireAdmin, (req, res) => {
  const { data, filename } = req.body;
  if (!data || !filename) return res.status(400).json({ error: 'Faltan datos' });
  const ext = path.extname(filename).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext))
    return res.status(400).json({ error: 'Formato no permitido' });
  const name = `${Date.now()}-${path.basename(filename, ext).replace(/[^a-z0-9_-]/gi, '_')}${ext}`;
  const buffer = Buffer.from(data, 'base64');
  if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Imagen demasiado grande (máx 5 MB)' });
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer);
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const base  = `${proto}://${req.get('host')}`;
  res.json({ ok: true, url: `${base}/uploads/${name}` });
});

// Items CRUD
app.get('/api/admin/items', requireAdmin, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM items ORDER BY sort_order ASC, price ASC').all() });
});

app.post('/api/admin/items', requireAdmin, (req, res) => {
  const { id, name, description, price, image_url, texture_url, category, active, visible, sale_start, sale_end, sort_order } = req.body;
  if (!id?.trim() || !name?.trim()) return res.status(400).json({ error: 'id y name son obligatorios' });
  try {
    db.prepare(`INSERT INTO items (id, name, description, price, image_url, texture_url, category, active, visible, sale_start, sale_end, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id.trim(), name.trim(), description ?? null, price ?? 0, image_url ?? null, texture_url ?? null, category ?? 'collectible', active !== false ? 1 : 0, visible !== false ? 1 : 0, sale_start ?? null, sale_end ?? null, sort_order ?? 0);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return res.status(409).json({ error: 'Ya existe un item con ese ID' });
    throw e;
  }
});

app.put('/api/admin/items/:id', requireAdmin, (req, res) => {
  const { name, description, price, image_url, texture_url, category, active, visible, sale_start, sale_end, sort_order } = req.body;
  const r = db.prepare(`UPDATE items SET name=?, description=?, price=?, image_url=?, texture_url=?, category=?, active=?, visible=?, sale_start=?, sale_end=?, sort_order=? WHERE id=?`)
    .run(name, description ?? null, price ?? 0, image_url ?? null, texture_url ?? null, category ?? 'collectible', active !== false ? 1 : 0, visible !== false ? 1 : 0, sale_start ?? null, sale_end ?? null, sort_order ?? 0, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Item no encontrado' });
  res.json({ ok: true });
});

app.delete('/api/admin/items/:id', requireAdmin, (req, res) => {
  const owners = db.prepare('SELECT COUNT(*) as c FROM user_items WHERE item_id=?').get(req.params.id).c;
  if (owners > 0) return res.status(409).json({ error: `${owners} usuario(s) poseen este item. Desactívalo en su lugar.` });
  db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Tournaments CRUD
app.get('/api/admin/tournaments', requireAdmin, (req, res) => {
  res.json({ tournaments: db.prepare('SELECT * FROM tournaments ORDER BY sort_order ASC, created_at ASC').all() });
});

app.post('/api/admin/tournaments', requireAdmin, (req, res) => {
  const { id, name, description, tier, type, min_score, max_score, required_item, rules, starts_at, ends_at, active, visible, sort_order } = req.body;
  if (!id?.trim() || !name?.trim()) return res.status(400).json({ error: 'id y name son obligatorios' });
  try {
    db.prepare(`INSERT INTO tournaments (id, name, description, tier, type, min_score, max_score, required_item, rules, starts_at, ends_at, active, visible, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id.trim(), name.trim(), description ?? null, tier ?? 'Bronce', type ?? 'tier', min_score ?? 0, max_score ?? -1, required_item ?? null, rules ? (typeof rules === 'string' ? rules : JSON.stringify(rules)) : null, starts_at ?? null, ends_at ?? null, active !== false ? 1 : 0, visible !== false ? 1 : 0, sort_order ?? 0);
    reloadTournamentDefs();
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return res.status(409).json({ error: 'Ya existe un torneo con ese ID' });
    throw e;
  }
});

app.put('/api/admin/tournaments/:id', requireAdmin, (req, res) => {
  const { name, description, tier, type, min_score, max_score, required_item, rules, starts_at, ends_at, active, visible, sort_order } = req.body;
  const r = db.prepare(`UPDATE tournaments SET name=?, description=?, tier=?, type=?, min_score=?, max_score=?, required_item=?, rules=?, starts_at=?, ends_at=?, active=?, visible=?, sort_order=? WHERE id=?`)
    .run(name, description ?? null, tier ?? 'Bronce', type ?? 'tier', min_score ?? 0, max_score ?? -1, required_item ?? null, rules ? (typeof rules === 'string' ? rules : JSON.stringify(rules)) : null, starts_at ?? null, ends_at ?? null, active !== false ? 1 : 0, visible !== false ? 1 : 0, sort_order ?? 0, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Torneo no encontrado' });
  reloadTournamentDefs();
  res.json({ ok: true });
});

app.delete('/api/admin/tournaments/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tournaments WHERE id=?').run(req.params.id);
  delete tournamentPlayers[req.params.id];
  reloadTournamentDefs();
  res.json({ ok: true });
});

// Users management
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const { q, limit = 50, offset = 0 } = req.query;
  const base = `SELECT u.user_id, u.name, u.email, u.picture, u.active, u.visible, u.created_at, ps.score, ps.games_played, ps.games_won
    FROM users u LEFT JOIN player_stats ps ON u.user_id=ps.user_id`;
  if (q) {
    const like = `%${q}%`;
    const users = db.prepare(`${base} WHERE u.name LIKE ? OR u.email LIKE ? OR u.user_id LIKE ? ORDER BY COALESCE(ps.score,0) DESC LIMIT ? OFFSET ?`).all(like, like, like, +limit, +offset);
    const total = db.prepare('SELECT COUNT(*) as c FROM users WHERE name LIKE ? OR email LIKE ? OR user_id LIKE ?').get(like, like, like).c;
    return res.json({ users, total });
  }
  const users = db.prepare(`${base} ORDER BY COALESCE(ps.score,0) DESC LIMIT ? OFFSET ?`).all(+limit, +offset);
  const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  res.json({ users, total });
});

app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = db.prepare(`SELECT u.*, ps.score, ps.games_played, ps.games_won FROM users u LEFT JOIN player_stats ps ON u.user_id=ps.user_id WHERE u.user_id=?`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const items    = db.prepare(`SELECT i.*, ui.bought_at FROM user_items ui JOIN items i ON ui.item_id=i.id WHERE ui.user_id=? ORDER BY ui.bought_at DESC`).all(req.params.id);
  const sessions = db.prepare(`SELECT result, score_delta, played_at FROM game_sessions WHERE user_id=? ORDER BY played_at DESC LIMIT 20`).all(req.params.id);
  res.json({ user, items, sessions });
});

app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { name, email, score, active, visible } = req.body;
  const uid = req.params.id;
  if (name    !== undefined) db.prepare('UPDATE users SET name=?, updated_at=unixepoch() WHERE user_id=?').run(name, uid);
  if (email   !== undefined) db.prepare('UPDATE users SET email=?, updated_at=unixepoch() WHERE user_id=?').run(email, uid);
  if (active  !== undefined) db.prepare('UPDATE users SET active=?, updated_at=unixepoch() WHERE user_id=?').run(active !== false ? 1 : 0, uid);
  if (visible !== undefined) db.prepare('UPDATE users SET visible=?, updated_at=unixepoch() WHERE user_id=?').run(visible !== false ? 1 : 0, uid);
  if (score !== undefined) {
    if (db.prepare('SELECT 1 FROM player_stats WHERE user_id=?').get(uid))
      db.prepare('UPDATE player_stats SET score=?, updated_at=unixepoch() WHERE user_id=?').run(score, uid);
  }
  if (registeredUsers[uid]) {
    if (name  !== undefined) registeredUsers[uid].name  = name;
    if (email !== undefined) registeredUsers[uid].email = email;
  }
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const uid = req.params.id;
  db.transaction(() => {
    db.prepare('DELETE FROM user_items          WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM hand_stats          WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM roll_stats          WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM game_sessions       WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM push_subscriptions  WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM player_stats        WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM users               WHERE user_id=?').run(uid);
  })();
  delete registeredUsers[uid];
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  const rl = {
    action: makeRateLimiter(15, 5_000),   // roll/stand/discard: 15 per 5s
    room:   makeRateLimiter(5,  60_000),  // create/join/leave/start: 5 per min
    social: makeRateLimiter(10, 60_000),  // challenge/invite/search: 10 per min
    buy:    makeRateLimiter(5,  60_000),  // buy_item: 5 per min
    read:   makeRateLimiter(30, 10_000),  // stats/list queries: 30 per 10s
  };

  socket.on('get_stats', (cb) => {
    if (!rl.read()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const uid      = socket.data.userId;
    const rankings = buildRankings();
    const myRank   = uid ? (rankings.findIndex(r => r.userId === uid) + 1) || null : null;
    let stats = null;
    let handStats = null;
    let rollStats = null;
    if (uid) {
      const row = stmts.getStats.get(uid);
      if (row) stats = { score: row.score, gamesPlayed: row.games_played, gamesWon: row.games_won, tier: getTier(row.score).name };
      handStats = stmts.getHandStats.all(uid);
      rollStats  = stmts.getRollStats.all(uid);
    }
    cb?.({ ok: true, stats, rankings, myRank, total: rankings.length, handStats, rollStats });
  });

  socket.on('get_marketplace', (cb) => {
    if (!rl.read()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const uid       = socket.data.userId;
    const userItems = uid ? stmts.getUserItems.all(uid).map(r => r.item_id) : [];
    const items     = stmts.getItems.all();
    // Los items ocultos no deben verse en la tienda, pero si el usuario ya
    // los posee (comprados antes de ocultarse) siguen visibles en su inventario
    const shownIds  = new Set(items.map(i => i.id));
    const ownedHidden = userItems
      .filter(id => !shownIds.has(id))
      .map(id => stmts.getItemById.get(id))
      .filter(Boolean);
    const credits   = uid ? (stmts.getStats.get(uid)?.score ?? 0) : 0;
    cb?.({ ok: true, items: [...items, ...ownedHidden], userItems, credits });
  });

  socket.on('buy_item', ({ itemId } = {}, cb) => {
    if (!rl.buy()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const uid  = socket.data.userId;
    if (!uid)    return cb?.({ ok: false, error: 'Debes iniciar sesión' });
    const item = stmts.getItemById.get(itemId);
    if (!item)   return cb?.({ ok: false, error: 'Item no encontrado' });
    if (!item.active || !item.visible) return cb?.({ ok: false, error: 'Item no disponible' });
    const result = stmts.deductScore.run(item.price, uid, item.price);
    if (result.changes === 0) return cb?.({ ok: false, error: 'Créditos insuficientes' });
    stmts.insertUserItem.run(uid, itemId);
    const newCredits = stmts.getStats.get(uid)?.score ?? 0;
    cb?.({ ok: true, credits: newCredits });
  });

  socket.on('buy_bules_pack', ({ packId } = {}, cb) => {
    if (!rl.buy()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const uid = socket.data.userId;
    if (!uid) return cb?.({ ok: false, error: 'Debes iniciar sesión' });
    const pack = stmts.getItemById.get(packId);
    if (!pack || pack.category !== 'pack') return cb?.({ ok: false, error: 'Pack no válido' });
    if (!pack.active || !pack.visible) return cb?.({ ok: false, error: 'Item no disponible' });
    db.prepare('UPDATE player_stats SET score = score + 1000 WHERE user_id = ?').run(uid);
    const newScore = stmts.getStats.get(uid)?.score ?? 0;
    cb?.({ ok: true, score: newScore });
  });

  socket.on('get_user_items', (cb) => {
    if (!rl.read()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const uid       = socket.data.userId;
    if (!uid) return cb?.({ ok: true, items: [] });
    const itemIds   = stmts.getUserItems.all(uid).map(r => r.item_id);
    const items     = itemIds.map(id => stmts.getItemById.get(id)).filter(Boolean);
    cb?.({ ok: true, items });
  });

  socket.on('get_user_history', (cb) => {
    if (!rl.read()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const uid = socket.data.userId;
    if (!uid) return cb?.({ ok: false, error: 'Debes iniciar sesión' });
    const sessions = db.prepare(
      `SELECT result, score_delta, played_at FROM game_sessions WHERE user_id = ? ORDER BY played_at DESC LIMIT 50`
    ).all(uid);
    const purchases = db.prepare(
      `SELECT i.id, i.name, i.image_url, i.price, i.category, ui.bought_at
       FROM user_items ui JOIN items i ON ui.item_id = i.id
       WHERE ui.user_id = ? ORDER BY ui.bought_at DESC LIMIT 50`
    ).all(uid);
    cb?.({ ok: true, sessions, purchases });
  });

  socket.on('list_rooms', (cb) => {
    if (!rl.read()) return cb?.({ rooms: [] });
    cb?.({ rooms: Object.values(rooms).filter(r => !r.vsBot && !r.tournamentId).map(sanitizeForList) });
  });

  socket.on('get_tournaments', (cb) => {
    if (!rl.read()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const now = Math.floor(Date.now() / 1000);
    const result = TOURNAMENT_DEFS.filter(t =>
      t.visible &&
      (t.starts_at == null || t.starts_at <= now) &&
      (t.ends_at   == null || t.ends_at   >= now)
    ).map(t => {
      const requiredItemData = t.requiredItem
        ? db.prepare(`SELECT id, name, image_url FROM items WHERE id = ?`).get(t.requiredItem)
        : null;
      return {
        ...t,
        requiredItemName:     requiredItemData?.name ?? null,
        requiredItemImageUrl: requiredItemData?.image_url ?? null,
        playerCount:  Object.keys(tournamentPlayers[t.id]).length,
        openRooms:    Object.values(rooms).filter(r => r.tournamentId === t.id && r.phase === 'lobby').length,
        activeGames:  Object.values(rooms).filter(r => r.tournamentId === t.id && r.phase !== 'lobby').length,
      };
    });
    cb?.({ ok: true, tournaments: result });
  });

  socket.on('join_tournament', ({ tournamentId, userId, name, picture }, cb) => {
    if (!rl.room()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const def = getTournamentDef(tournamentId);
    if (!def || !def.visible) return cb?.({ ok: false, error: 'Torneo no encontrado' });

    // Leave current tournament if any
    const prevTid = socket.data.tournamentId;
    if (prevTid && prevTid !== tournamentId) {
      delete tournamentPlayers[prevTid][socket.id];
      socket.leave(`tournament:${prevTid}`);
      broadcastTournament(prevTid);
    }

    let score = 0;
    let tier = 'Bronce';
    let canPlay = false;
    if (userId) {
      const row = stmts.getStats.get(userId);
      if (row) {
        score = row.score;
        tier = getTier(score).name;
        if (def.requiredItem) {
          const owned = db.prepare(`SELECT 1 FROM user_items WHERE user_id = ? AND item_id = ?`).get(userId, def.requiredItem);
          canPlay = !!owned;
        } else {
          canPlay = score >= def.minScore;
        }
      }
    }
    if (!def.active) canPlay = false;

    tournamentPlayers[tournamentId][socket.id] = { socketId: socket.id, userId: userId ?? null, name, tier, score, picture: picture ?? null, canPlay };
    socket.join(`tournament:${tournamentId}`);
    socket.data.tournamentId = tournamentId;

    broadcastTournament(tournamentId);
    cb?.({ ok: true, canPlay, tier, score });
  });

  socket.on('leave_tournament', (cb) => {
    const tid = socket.data.tournamentId;
    if (tid) {
      delete tournamentPlayers[tid][socket.id];
      socket.leave(`tournament:${tid}`);
      socket.data.tournamentId = null;
      broadcastTournament(tid);
    }
    cb?.({ ok: true });
  });

  socket.on('create_room', ({ playerName, roomName, maxPlayers = 6, vsBot = false, maxRounds = 0, isPrivate = false, tournamentId = null, userId = null, diceSkin = null }, cb) => {
    if (!rl.room()) return cb?.({ ok: false, error: 'Demasiadas peticiones, espera un momento' });
    if (isUserBanned(socket.data.userId)) return cb?.({ ok: false, error: 'Tu cuenta está inactiva' });
    if (!playerName?.trim()) return cb?.({ ok: false, error: 'Faltan datos' });
    if (!vsBot && !roomName?.trim()) return cb?.({ ok: false, error: 'Faltan datos' });

    const MAX_ROOMS_PER_USER = 2;
    const activeRooms = Object.values(rooms).filter(r => r.hostId === socket.id).length;
    if (activeRooms >= MAX_ROOMS_PER_USER) {
      return cb?.({ ok: false, error: 'Ya tienes demasiadas salas abiertas' });
    }

    if (tournamentId) {
      const def = getTournamentDef(tournamentId);
      if (!def || !def.visible) return cb?.({ ok: false, error: 'Torneo no encontrado' });
      if (!def.active) return cb?.({ ok: false, error: 'Torneo no disponible' });
      if (!userId) return cb?.({ ok: false, error: 'Debes iniciar sesión para jugar en torneos' });
      if (def.requiredItem) {
        const owned = db.prepare(`SELECT 1 FROM user_items WHERE user_id = ? AND item_id = ?`).get(userId, def.requiredItem);
        if (!owned) return cb?.({ ok: false, error: `Necesitas el item "${def.name}" para jugar en este torneo` });
      } else {
        const row = stmts.getStats.get(userId);
        const score = row?.score ?? 0;
        if (score < def.minScore) {
          return cb?.({ ok: false, error: `Necesitas nivel ${def.tier} para crear salas en este torneo` });
        }
      }
    }

    let code;
    do { code = genCode(); } while (rooms[code]);

    const room = {
      code,
      name: roomName?.trim() ?? '',
      maxPlayers: vsBot ? Math.min(Math.max(2, parseInt(maxPlayers) || 2), 5) : Math.min(Math.max(2, parseInt(maxPlayers) || 6), 10),
      vsBot,
      isPrivate: !!isPrivate,
      maxRounds: Math.max(0, parseInt(maxRounds) || 0),
      hostId: socket.id,
      phase: 'lobby',
      roundNumber: 0,
      currentPlayerIndex: 0,
      maxRolls: null,
      lastActivityAt: Date.now(),
      roundWinnerId: null,
      turnDeadline: null,
      tournamentId: tournamentId ?? null,
      players: [{ ...makePlayer(socket.id, playerName.trim()), diceSkin: diceSkin ?? null }],
    };

    if (vsBot) {
      const numBots = room.maxPlayers - 1;
      for (let i = 0; i < numBots; i++) room.players.push(makeBotPlayer(i));
      startRound(room);
    }

    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    console.log(`create_room: "${room.name}" code="${code}" host="${playerName}" vsBot=${vsBot} tournament=${tournamentId}`);
    cb?.({ ok: true, code });
    trackEvent('room_create', { vsBot, isPrivate: !!isPrivate, maxPlayers: room.maxPlayers, tournamentId });
    broadcast(code);
    if (tournamentId) broadcastTournament(tournamentId);
    else if (!vsBot) broadcastRoomList();
  });

  socket.on('join_room', ({ code, playerName, diceSkin = null }, cb) => {
    if (!rl.room()) return cb?.({ ok: false, error: 'Demasiadas peticiones, espera un momento' });
    if (isUserBanned(socket.data.userId)) return cb?.({ ok: false, error: 'Tu cuenta está inactiva' });
    if (!playerName?.trim()) return cb?.({ ok: false, error: 'Introduce tu nombre' });
    const normalCode = code?.toUpperCase();
    const room = rooms[normalCode];
    if (!room) return cb?.({ ok: false, error: 'Sala no encontrada' });
    if (room.vsBot) return cb?.({ ok: false, error: 'No se puede unir a esta sala' });
    if (room.phase !== 'lobby') return cb?.({ ok: false, error: 'La partida ya ha comenzado' });

    // Rejoin: player with same name already in the lobby (e.g. mobile reconnect)
    const existing = room.players.find(p => p.name === playerName.trim());
    if (existing) {
      const oldId = existing.id;
      existing.id = socket.id;
      if (room.hostId === oldId) room.hostId = socket.id;
      const prevSocket = io.sockets.sockets.get(oldId);
      if (prevSocket) prevSocket.leave(normalCode);
      socket.join(normalCode);
      socket.data.roomCode = normalCode;
      console.log(`join_room rejoin: "${room.name}" player="${playerName}"`);
      cb?.({ ok: true, code: normalCode });
      broadcast(normalCode);
      broadcastRoomList();
      return;
    }

    if (room.isChallenge && room.challengedUserId && socket.data.userId !== room.challengedUserId) {
      return cb?.({ ok: false, error: 'Esta sala es un reto privado' });
    }
    if (room.players.length >= room.maxPlayers) return cb?.({ ok: false, error: 'Sala llena' });
    room.players.push({ ...makePlayer(socket.id, playerName.trim()), diceSkin: diceSkin ?? null });
    socket.join(normalCode);
    socket.data.roomCode = normalCode;
    if (room.isChallenge && socket.data.userId === room.challengedUserId) {
      stmts.deletePendingChallenge.run(normalCode);
    }
    console.log(`join_room: "${room.name}" player="${playerName}"`);
    cb?.({ ok: true, code: normalCode });
    broadcast(normalCode);
    broadcastRoomList();
  });

  socket.on('set_dice_skin', ({ skinId = null } = {}) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.isBot) return;
    player.diceSkin = skinId ?? null;
    broadcast(code);
  });

  socket.on('destroy_room', (cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return cb?.({ ok: false });

    io.to(code).emit('room_destroyed');
    stmts.deletePendingChallenge.run(code);
    delete rooms[code];
    socket.data.roomCode = null;
    cb?.({ ok: true });
    broadcastRoomList();
  });

  socket.on('leave_room', (cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return cb?.({ ok: false });

    clearTurnTimer(room);
    clearTiebreakerTimer(room);
    const leavingPlayer = room.players.find(p => p.id === socket.id);
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(code);
    socket.data.roomCode = null;

    if (room.vsBot || room.players.length === 0 || (room.phase !== 'lobby' && room.players.filter(p => !p.isBot).length < 2)) {
      clearContinueTimer(room);
      const byPlayer = room.phase !== 'lobby' ? (leavingPlayer?.name ?? null) : null;
      io.to(code).emit('room_destroyed', { byPlayer });
      stmts.deletePendingChallenge.run(code);
      delete rooms[code];
    } else {
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      broadcast(code);
      broadcastRoomList();
    }
    cb?.({ ok: true });
  });

  socket.on('start_game', (cb) => {
    if (!rl.room()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id) return cb?.({ ok: false });
    if (room.players.length < 2) return cb?.({ ok: false, error: 'Necesitas al menos 2 jugadores' });
    startRound(room);
    cb?.({ ok: true });
    trackEvent('game_start', { playerCount: room.players.length, vsBot: room.vsBot ?? false });
    broadcast(room.code);
    broadcastRoomList();
  });

  socket.on('discard', ({ indices }, cb) => {
    if (!rl.action()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const player = room.players[room.currentPlayerIndex];
    if (player.id !== socket.id || player.done) return cb?.({ ok: false });
    if (!Array.isArray(indices)) return cb?.({ ok: false });
    player.pendingDiscards = indices.filter(i => typeof i === 'number' && i >= 0 && i < 5);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('roll', ({ keptIndices = [] }, cb) => {
    if (!rl.action()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const player = room.players[room.currentPlayerIndex];
    if (player.id !== socket.id || player.done) return cb?.({ ok: false });
    const maxAllowed = room.maxRolls ?? 3;
    if (player.rollCount >= maxAllowed) return cb?.({ ok: false, error: 'No puedes tirar más' });

    if (player.rollCount > 0) {
      const diceCount = player.currentDice.length;
      const discarded = Array.from({ length: diceCount }, (_, i) => i).filter(i => !keptIndices.includes(i));
      player.rollHistory.push([...player.currentDice]);
      player.rollDiscardHistory.push(discarded);
      player.currentDice = player.currentDice.map((die, i) =>
        keptIndices.includes(i) ? die : rollDie()
      );
    } else {
      player.currentDice = Array.from({ length: 5 }, rollDie);
    }
    player.rollCount += 1;
    player.rollSeed = Math.floor(Math.random() * 0xFFFFFFFF);
    player.pendingDiscards = [];
    // El contador de 30s se reinicia cuando los dados se paran (report_faces),
    // no al lanzar — así no cuenta el tiempo de animación con los botones disabled
    clearTurnTimer(room);
    room.turnDeadline = null;

    cb?.({ ok: true });
    broadcast(room.code);
    maybeBotChatter(room, player);
  });

  socket.on('report_faces', (data, rawCb) => {
    const cb = typeof rawCb === 'function' ? rawCb : null;
    if (!rl.action()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const { faces } = (data && typeof data === 'object') ? data : {};
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const player = room.players[room.currentPlayerIndex];
    // En salas vsBot el cliente del humano reporta también las caras físicas del bot
    const canReport = player.id === socket.id || (room.vsBot && player.isBot);
    if (!canReport || player.done || player.rollCount === 0) return cb?.({ ok: false });
    const VALID = new Set(['AS', 'K', 'Q', 'J', '8', '7']);
    if (!Array.isArray(faces) || faces.length !== 5 || !faces.every(f => VALID.has(f))) return cb?.({ ok: false });
    player.currentDice = faces;
    player.hand = evaluateHand(faces);
    startTurnTimer(room);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('stand', (data, rawCb) => {
    const cb = typeof rawCb === 'function' ? rawCb : null;
    if (!rl.action()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const { faces } = (data && typeof data === 'object') ? data : {};
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const player = room.players[room.currentPlayerIndex];
    if (player.id !== socket.id || player.done) return cb?.({ ok: false });
    if (player.rollCount === 0) return cb?.({ ok: false, error: 'Debes tirar al menos una vez' });
    const VALID = new Set(['AS', 'K', 'Q', 'J', '8', '7']);
    if (Array.isArray(faces) && faces.length === 5 && faces.every(f => VALID.has(f))) {
      player.currentDice = faces;
    }
    finishTurn(room, player);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('continue_turn', (cb) => {
    if (!rl.action()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing' || !room.awaitingContinue) return cb?.({ ok: false });
    proceedTurn(room);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  // POC de mensajería: reacciones/mensajes cortos entre jugadores de la misma sala
  socket.on('send_message', ({ text } = {}, cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return cb?.({ ok: false });
    const sender = room.players.find(p => p.id === socket.id);
    if (!sender) return cb?.({ ok: false });
    const clean = typeof text === 'string' ? text.trim().slice(0, 40) : '';
    if (!clean) return cb?.({ ok: false });
    cb?.({ ok: true });
    io.to(code).emit('player_message', { fromId: socket.id, fromName: sender.name, text: clean });
  });

  socket.on('bot_ready', (cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const bot = room.players[room.currentPlayerIndex];
    if (!bot?.isBot) return cb?.({ ok: false });
    cb?.({ ok: true });
    botAct(code);
  });

  socket.on('next_round', (cb) => {
    if (!rl.room()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'results') return cb?.({ ok: false });
    const loserIsBot = room.players.find(p => p.id === room.roundLoserId)?.isBot;
    if (socket.id !== room.roundLoserId && !loserIsBot) return cb?.({ ok: false });
    clearContinueTimer(room);
    startRound(room);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('rematch', (cb) => {
    if (!rl.room()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id || room.phase !== 'finished') return cb?.({ ok: false });
    // El perdedor de la partida abre la revancha; wins se acumulan entre partidas
    const loser = room.players.find(p => p.id === room.gameLoserId)
      ?? [...room.players].sort((a, b) => b.breaks - a.breaks)[0];
    room.nextStarterId = loser.id;
    room.gameLoserId = null;
    room.endReason = null;
    for (const p of room.players) { p.breaks = 0; p.liberado = false; }
    room.roundNumber = 0;
    room.pendingScores  = {};
    room.lastGameScores = {};
    startRound(room);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('register_user', async ({ userId, name, email, picture, idToken }) => {
    if (!userId || !name) return;

    let isGoogleUser = false;
    if (idToken) {
      try {
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
        if (!res.ok) return;
        const payload = await res.json();
        if (payload.error || !payload.email) return;
        userId = payload.email;
        name   = payload.name   || name;
        email  = payload.email;
        picture = payload.picture || picture;
        isGoogleUser = true;
      } catch (_) {
        return;
      }
    }

    const prev = registeredUsers[userId];
    if (prev?.socketId) delete socketToUser[prev.socketId];
    registeredUsers[userId] = { ...(prev || {}), userId, name, email: email ?? null, picture: picture ?? null, socketId: socket.id, isGoogleUser };
    socketToUser[socket.id] = userId;
    socket.data.userId = userId;

    // Si el token FCM no está en memoria, cargarlo de BD (puede llegar register_fcm_token antes que register_user)
    if (!registeredUsers[userId].fcmToken) {
      const fcmRow = db.prepare('SELECT token FROM fcm_tokens WHERE user_id=?').get(userId);
      if (fcmRow) registeredUsers[userId].fcmToken = fcmRow.token;
    }

    // Solo persistir en BD los usuarios autenticados con Google
    if (isGoogleUser) {
      stmts.upsertUser.run(userId, name, email ?? null, picture ?? null);
      stmts.ensureStats.run(userId);
    }

    // Emitir retos pendientes (llegaron cuando estaba offline)
    const pending = stmts.getPendingChallenges.all(userId);
    for (const p of pending) {
      const pendingRoom = rooms[p.room_code];
      if (pendingRoom) {
        const fromUser = registeredUsers[p.from_user_id];
        socket.emit('room_invite', {
          roomCode: p.room_code,
          roomName: pendingRoom.name,
          inviterName: fromUser?.name ?? 'Alguien',
        });
      } else {
        stmts.deletePendingChallenge.run(p.room_code);
      }
    }
  });

  socket.on('subscribe_push', ({ userId, subscription }) => {
    if (!userId || !subscription) return;
    if (registeredUsers[userId]) registeredUsers[userId].pushSubscription = subscription;
    const { endpoint, keys: { p256dh, auth } = {} } = subscription;
    if (endpoint && p256dh && auth) stmts.upsertPushSub.run(userId, endpoint, p256dh, auth);
  });

  socket.on('register_fcm_token', ({ userId, token }) => {
    if (!userId || !token) return;
    if (registeredUsers[userId]) registeredUsers[userId].fcmToken = token;
    stmts.upsertFcmToken.run(userId, token);
  });

  socket.on('search_users', ({ query = '' }, cb) => {
    if (!rl.social()) return cb?.({ users: [] });
    const q = query.toLowerCase();
    const myUserId = socket.data.userId;
    const results = Object.values(registeredUsers)
      .filter(u => u.userId !== myUserId && (!q || u.name.toLowerCase().includes(q)))
      .filter(u => stmts.getUserFlags.get(u.userId)?.visible !== 0)
      .slice(0, 20)
      .map(u => ({ userId: u.userId, name: u.name, picture: u.picture }));
    cb?.({ users: results });
  });

  socket.on('invite_to_room', ({ toUserId, roomCode, roomName }, cb) => {
    if (!rl.social()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const invitee = registeredUsers[toUserId];
    if (!invitee) return cb?.({ ok: false, error: 'Usuario no encontrado' });
    const inviterName = (socket.data.userId && registeredUsers[socket.data.userId]?.name) || 'Alguien';

    if (invitee.socketId) {
      io.to(invitee.socketId).emit('room_invite', { roomCode, roomName, inviterName });
    }
    if (invitee.pushSubscription) {
      const payload = JSON.stringify({
        title: '¡Te han invitado!',
        body: `${inviterName} te invita a "${roomName}"`,
        url: `/?join=${roomCode}`,
      });
      webpush.sendNotification(invitee.pushSubscription, payload).catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          if (registeredUsers[toUserId]) registeredUsers[toUserId].pushSubscription = null;
          stmts.deletePushSub.run(toUserId);
        } else {
          console.error('Push error:', err);
        }
      });
    }
    sendFcm(invitee.fcmToken, {
      title: '¡Te han invitado!',
      body: `${inviterName} te invita a "${roomName}"`,
      roomCode,
    }, toUserId);
    cb?.({ ok: true });
  });

  socket.on('get_user_profile', ({ userId } = {}, cb) => {
    if (!rl.read()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    if (!userId) return cb?.({ ok: false, error: 'Falta userId' });
    const user = registeredUsers[userId];
    const row  = stmts.getStats.get(userId);
    if (!row && !user) return cb?.({ ok: false, error: 'Usuario no encontrado' });
    const stats = row
      ? { score: row.score, gamesPlayed: row.games_played, gamesWon: row.games_won, tier: getTier(row.score).name }
      : null;
    const itemIds   = stmts.getUserItems.all(userId).map(r => r.item_id);
    const items     = itemIds.map(id => stmts.getItemById.get(id)).filter(Boolean);
    const handStats = stmts.getHandStats.all(userId);
    const rollStats = stmts.getRollStats.all(userId);
    cb?.({ ok: true, name: user?.name ?? userId, picture: user?.picture ?? null, stats, items, handStats, rollStats });
  });

  socket.on('challenge_user', ({ toUserId, playerName, diceSkin = null } = {}, cb) => {
    if (!rl.social()) return cb?.({ ok: false, error: 'Demasiadas peticiones' });
    const uid = socket.data.userId;
    if (!uid)     return cb?.({ ok: false, error: 'Debes iniciar sesión para retar a otros jugadores' });

    // Buscar en memoria primero; si no está (guest desconectado o sesión expirada),
    // intentar reconstruir desde BD para Google users con push/FCM registrado.
    let target = registeredUsers[toUserId];
    if (!target) {
      const dbUser  = db.prepare('SELECT user_id, name FROM users WHERE user_id=?').get(toUserId);
      const fcmRow  = dbUser && db.prepare('SELECT token FROM fcm_tokens WHERE user_id=?').get(toUserId);
      const pushRow = dbUser && db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?').get(toUserId);
      if (!dbUser || (!fcmRow && !pushRow)) return cb?.({ ok: false, error: 'Usuario no disponible' });
      target = {
        userId: dbUser.user_id,
        name: dbUser.name,
        socketId: null,
        fcmToken: fcmRow?.token ?? null,
        pushSubscription: pushRow
          ? { endpoint: pushRow.endpoint, keys: { p256dh: pushRow.p256dh, auth: pushRow.auth } }
          : null,
      };
    }

    let code;
    do { code = genCode(); } while (rooms[code]);

    const myName  = playerName?.trim() || registeredUsers[uid]?.name || 'Jugador';
    const roomName = `Reto de ${myName}`;
    const room = {
      code,
      name: roomName,
      maxPlayers: 2,
      vsBot: false,
      isPrivate: true,
      isChallenge: true,
      challengedUserId: toUserId,
      challengedName: target.name ?? null,
      maxRounds: 0,
      hostId: socket.id,
      phase: 'lobby',
      roundNumber: 0,
      currentPlayerIndex: 0,
      maxRolls: null,
      roundWinnerId: null,
      turnDeadline: null,
      tournamentId: null,
      players: [{ ...makePlayer(socket.id, myName), diceSkin: diceSkin ?? null }],
    };

    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    stmts.insertPendingChallenge.run(uid, toUserId, code);

    if (target.socketId) {
      io.to(target.socketId).emit('room_invite', { roomCode: code, roomName, inviterName: myName });
    }
    if (target.pushSubscription) {
      const payload = JSON.stringify({
        title: '¡Te han retado!',
        body: `${myName} te reta a una partida`,
        url: `/?join=${code}`,
      });
      webpush.sendNotification(target.pushSubscription, payload).catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          if (registeredUsers[toUserId]) registeredUsers[toUserId].pushSubscription = null;
          stmts.deletePushSub.run(toUserId);
        }
      });
    }
    console.log(`challenge_user: ${uid} → ${toUserId} | socketId=${target.socketId ?? 'null'} fcmToken=${target.fcmToken ? target.fcmToken.slice(0,16)+'…' : 'NONE'} pushSub=${!!target.pushSubscription}`);
    sendFcm(target.fcmToken, {
      title: '¡Te han retado!',
      body: `${myName} te reta a una partida`,
      roomCode: code,
    }, toUserId);

    cb?.({ ok: true, code, roomName });
    broadcast(code);
    broadcastRoomList();
  });

  socket.on('disconnect', () => {
    if (socket.data.userId) {
      const ru = registeredUsers[socket.data.userId];
      if (ru) {
        if (ru.isGoogleUser) {
          ru.socketId = null;
        } else {
          delete registeredUsers[socket.data.userId];
        }
      }
    }
    delete socketToUser[socket.id];
    const tid = socket.data.tournamentId;
    if (tid && tournamentPlayers[tid]) {
      delete tournamentPlayers[tid][socket.id];
      broadcastTournament(tid);
    }
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;

    if (room.vsBot) {
      clearTiebreakerTimer(room);
      stmts.deletePendingChallenge.run(code);
      delete rooms[code];
      return;
    }

    const disconnectingName = room.players.find(p => p.id === socket.id)?.name ?? null;
    setTimeout(() => {
      const r = rooms[code];
      if (!r) return;
      r.players = r.players.filter(p => p.id !== socket.id);
      if (r.players.length === 0 || (r.phase !== 'lobby' && r.players.filter(p => !p.isBot).length < 2)) {
        clearContinueTimer(r);
        const byPlayer = r.phase !== 'lobby' ? disconnectingName : null;
        io.to(code).emit('room_destroyed', { byPlayer });
        const tId = r.tournamentId;
        stmts.deletePendingChallenge.run(code);
        delete rooms[code];
        if (tId) broadcastTournament(tId);
        else broadcastRoomList();
        return;
      }
      if (r.hostId === socket.id) r.hostId = r.players[0].id;
      broadcast(code);
      broadcastRoomList();
    }, 20_000);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => console.log(`Servidor en http://0.0.0.0:${PORT}`));
