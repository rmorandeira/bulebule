const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const webpush = require('web-push');
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

const registeredUsers = {};

const app = express();
app.use(cors({ origin: '*' }));
app.get('/', (_, res) => res.send('OK'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.get('/api/vapid-public-key', (_, res) => res.json({ key: VAPID_PUBLIC }));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
});

const rooms = {};

const { VALUE_RANK } = require('./gameLogic');
const TURN_TIMEOUT = 30_000;
const BOT_ID = '__bot__';
const BOT_NAME = 'Bot';

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function makePlayer(id, name) {
  return { id, name, currentDice: [], rollHistory: [], rollDiscardHistory: [], rollCount: 0, done: false, hand: null, wins: 0, pendingDiscards: [] };
}

function makeBotPlayer() {
  return { ...makePlayer(BOT_ID, BOT_NAME), isBot: true };
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
    bot.rollHistory.push([...bot.currentDice]);
    bot.currentDice = bot.currentDice.map((d, i) => keptIndices.includes(i) ? d : rollDie());
    bot.rollCount++;
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
    hostId: room.hostId,
    phase: room.phase,
    roundNumber: room.roundNumber,
    currentPlayerIndex: room.currentPlayerIndex,
    maxRolls: room.maxRolls,
    roundWinnerId: room.roundWinnerId,
    botPhase: room.botPhase ?? null,
    botKeptIndices: room.botKeptIndices ?? [],
    turnDeadline: room.turnDeadline ?? null,
    maxRounds: room.maxRounds ?? 0,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot ?? false,
      currentDice: p.currentDice,
      rollHistory: p.rollHistory,
      rollDiscardHistory: p.rollDiscardHistory ?? [],
      rollCount: p.rollCount,
      done: p.done,
      hand: p.hand,
      wins: p.wins,
      pendingDiscards: p.pendingDiscards ?? [],
    })),
  };
}

function sanitizeForList(room) {
  return {
    code: room.code,
    name: room.name,
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    phase: room.phase,
  };
}

function broadcast(code) {
  const room = rooms[code];
  if (room) io.to(code).emit('room_state', sanitize(room));
}

function broadcastRoomList() {
  const list = Object.values(rooms).filter(r => !r.vsBot).map(sanitizeForList);
  io.emit('rooms_list', list);
}

function startRound(room) {
  room.phase = 'playing';
  room.currentPlayerIndex = 0;
  room.maxRolls = null;
  room.roundWinnerId = null;
  room.botPhase = null;
  room.botKeptIndices = [];
  room.turnDeadline = null;
  room.roundNumber = (room.roundNumber ?? 0) + 1;
  for (const p of room.players) {
    p.currentDice = [];
    p.rollHistory = [];
    p.rollDiscardHistory = [];
    p.rollCount = 0;
    p.done = false;
    p.hand = null;
    p.pendingDiscards = [];
  }
  startTurnTimer(room);
}

function finishTurn(room, player) {
  clearTurnTimer(room);
  player.done = true;
  player.hand = evaluateHand(player.currentDice);
  if (room.currentPlayerIndex === 0) {
    room.maxRolls = player.rollCount;
  }
  const next = room.players.findIndex((p, i) => i > room.currentPlayerIndex && !p.done);
  if (next !== -1) {
    room.currentPlayerIndex = next;
    startTurnTimer(room);
  } else {
    endRound(room);
  }
}

function endRound(room) {
  let winner = room.players[0];
  for (const p of room.players) {
    if (compareHands(p.hand, winner.hand) > 0) winner = p;
  }
  winner.wins += 1;
  room.roundWinnerId = winner.id;

  const maxRounds = room.maxRounds ?? 0;
  if (maxRounds > 0 && room.roundNumber >= maxRounds) {
    room.phase = 'finished';
  } else {
    room.phase = 'results';
  }
}

io.on('connection', (socket) => {

  socket.on('list_rooms', (cb) => {
    cb?.({ rooms: Object.values(rooms).filter(r => !r.vsBot).map(sanitizeForList) });
  });

  socket.on('create_room', ({ playerName, roomName, maxPlayers = 6, vsBot = false, maxRounds = 5 }, cb) => {
    if (!playerName?.trim() || !roomName?.trim()) return cb?.({ ok: false, error: 'Faltan datos' });
    let code;
    do { code = genCode(); } while (rooms[code]);

    const room = {
      code,
      name: roomName.trim(),
      maxPlayers: vsBot ? 2 : Math.min(Math.max(2, parseInt(maxPlayers) || 6), 10),
      vsBot,
      maxRounds: Math.max(0, parseInt(maxRounds) || 0),
      hostId: socket.id,
      phase: 'lobby',
      roundNumber: 0,
      currentPlayerIndex: 0,
      maxRolls: null,
      roundWinnerId: null,
      turnDeadline: null,
      players: [makePlayer(socket.id, playerName.trim())],
    };

    if (vsBot) {
      room.players.push(makeBotPlayer());
      startRound(room); // skip lobby phase
    }

    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    console.log(`create_room: "${roomName}" code="${code}" host="${playerName}" vsBot=${vsBot}`);
    cb?.({ ok: true, code });
    broadcast(code);
    if (!vsBot) broadcastRoomList();
  });

  socket.on('join_room', ({ code, playerName }, cb) => {
    if (!playerName?.trim()) return cb?.({ ok: false, error: 'Introduce tu nombre' });
    const room = rooms[code?.toUpperCase()];
    if (!room) return cb?.({ ok: false, error: 'Sala no encontrada' });
    if (room.vsBot) return cb?.({ ok: false, error: 'No se puede unir a esta sala' });
    if (room.phase !== 'lobby') return cb?.({ ok: false, error: 'La partida ya ha comenzado' });
    if (room.players.length >= room.maxPlayers) return cb?.({ ok: false, error: 'Sala llena' });

    room.players.push(makePlayer(socket.id, playerName.trim()));
    socket.join(code);
    socket.data.roomCode = code;
    console.log(`join_room: "${room.name}" player="${playerName}"`);
    cb?.({ ok: true, code });
    broadcast(code);
    broadcastRoomList();
  });

  socket.on('destroy_room', (cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return cb?.({ ok: false });

    io.to(code).emit('room_destroyed');
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
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(code);
    socket.data.roomCode = null;

    if (room.vsBot || room.players.length === 0) {
      delete rooms[code];
    } else {
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      broadcast(code);
      broadcastRoomList();
    }
    cb?.({ ok: true });
  });

  socket.on('start_game', (cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id) return cb?.({ ok: false });
    if (room.players.length < 2) return cb?.({ ok: false, error: 'Necesitas al menos 2 jugadores' });
    startRound(room);
    cb?.({ ok: true });
    broadcast(room.code);
    broadcastRoomList();
  });

  socket.on('discard', ({ index }, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const player = room.players[room.currentPlayerIndex];
    if (player.id !== socket.id || player.done) return cb?.({ ok: false });
    if (typeof index !== 'number') return cb?.({ ok: false });
    if (!player.pendingDiscards.includes(index)) player.pendingDiscards.push(index);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('roll', ({ keptIndices = [] }, cb) => {
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
    player.pendingDiscards = [];

    cb?.({ ok: true });
    broadcast(room.code);
    startTurnTimer(room);
  });

  socket.on('report_faces', ({ faces } = {}, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const player = room.players[room.currentPlayerIndex];
    if (player.id !== socket.id || player.done || player.rollCount === 0) return cb?.({ ok: false });
    const VALID = new Set(['AS', 'K', 'Q', 'J', '8', '7']);
    if (!Array.isArray(faces) || faces.length !== 5 || !faces.every(f => VALID.has(f))) return cb?.({ ok: false });
    player.currentDice = faces;
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('stand', (cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const player = room.players[room.currentPlayerIndex];
    if (player.id !== socket.id || player.done) return cb?.({ ok: false });
    if (player.rollCount === 0) return cb?.({ ok: false, error: 'Debes tirar al menos una vez' });
    finishTurn(room, player);
    cb?.({ ok: true });
    broadcast(room.code);

    // Trigger bot if it's now its turn
    const next = room.players[room.currentPlayerIndex];
    if (next?.isBot && !next.done && room.phase === 'playing') {
      runBotTurn(room.code);
    }
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
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id || room.phase !== 'results') return cb?.({ ok: false });
    startRound(room);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('rematch', (cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id || room.phase !== 'finished') return cb?.({ ok: false });
    // Reset wins and start fresh
    for (const p of room.players) p.wins = 0;
    room.roundNumber = 0;
    startRound(room);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('register_user', ({ userId, name, email, picture }) => {
    if (!userId || !name) return;
    registeredUsers[userId] = { ...(registeredUsers[userId] || {}), userId, name, email, picture, socketId: socket.id };
    socket.data.userId = userId;
  });

  socket.on('subscribe_push', ({ userId, subscription }) => {
    if (!userId || !subscription) return;
    if (registeredUsers[userId]) registeredUsers[userId].pushSubscription = subscription;
  });

  socket.on('search_users', ({ query = '' }, cb) => {
    const q = query.toLowerCase();
    const myUserId = socket.data.userId;
    const results = Object.values(registeredUsers)
      .filter(u => u.userId !== myUserId && (!q || u.name.toLowerCase().includes(q)))
      .slice(0, 20)
      .map(u => ({ userId: u.userId, name: u.name, picture: u.picture }));
    cb?.({ users: results });
  });

  socket.on('invite_to_room', ({ toUserId, roomCode, roomName }, cb) => {
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
      webpush.sendNotification(invitee.pushSubscription, payload).catch(err => console.error('Push error:', err));
    }
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    if (socket.data.userId && registeredUsers[socket.data.userId]) {
      registeredUsers[socket.data.userId].socketId = null;
    }
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;

    if (room.vsBot) {
      delete rooms[code];
      return;
    }

    setTimeout(() => {
      const r = rooms[code];
      if (!r) return;
      r.players = r.players.filter(p => p.id !== socket.id);
      if (r.players.length === 0) {
        delete rooms[code];
        broadcastRoomList();
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
