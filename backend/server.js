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
const CONTINUE_TIMEOUT = 30_000;
const BOT_ID = '__bot__';
const BOT_NAME = 'Bot';

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function makePlayer(id, name) {
  return { id, name, currentDice: [], rollHistory: [], rollDiscardHistory: [], rollCount: 0, done: false, hand: null, wins: 0, pendingDiscards: [], breaks: 0, liberado: false };
}

function makeBotPlayer(n = 0) {
  return { ...makePlayer(`${BOT_ID}_${n}`, n === 0 ? BOT_NAME : `${BOT_NAME} ${n + 1}`), isBot: true };
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
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot ?? false,
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
    isPrivate: !!room.isPrivate,
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
  // El perdedor de la ronda anterior abre la siguiente
  const starterIdx = room.players.findIndex(p => p.id === room.nextStarterId);
  room.startingPlayerIndex = starterIdx !== -1 ? starterIdx : 0;
  room.currentPlayerIndex = room.startingPlayerIndex;
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
  awaitContinue(room);
}

function applyRoundLoss(room, loser) {
  room.roundLoserId = loser.id;
  room.nextStarterId = loser.id;
  if (loser.breaks >= 3) {
    room.gameLoserId = loser.id;
    room.endReason = 'capilla';
    room.phase = 'finished';
    trackEvent('game_end', { endReason: 'capilla', rounds: room.roundNumber, playerCount: room.players.length });
    return;
  }
  loser.breaks += 1;
  const maxRounds = room.maxRounds ?? 0;
  if (maxRounds > 0 && room.roundNumber >= maxRounds) {
    const worst = [...room.players].sort((a, b) => a.wins - b.wins || b.breaks - a.breaks)[0];
    room.gameLoserId = worst.id;
    room.endReason = 'rounds';
    room.phase = 'finished';
    trackEvent('game_end', { endReason: 'rounds', rounds: room.roundNumber, playerCount: room.players.length });
  } else {
    room.phase = 'results';
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
  // Si acaba de liberarse y solo queda 1 jugador no-liberado en total → fin
  if (player.liberado) {
    const nonLiberado = room.players.filter(p => !p.liberado);
    if (nonLiberado.length <= 1) {
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
  // Solo participan en ganador/perdedor los no-liberados que jugaron la ronda
  const participants = room.players.filter(p => p.hand);
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
    room.phase = 'finished';
    trackEvent('game_end', { endReason: room.endReason ?? 'liberado', rounds: room.roundNumber, playerCount: room.players.length });
    return;
  }

  if (participants.length === 0) {
    // Caso auto-pérdida: el jugador no-liberado pierde sin haber jugado
    const autoLoser = room.players.find(p => !p.liberado);
    if (!autoLoser) return; // no debería ocurrir
    if (liberadoWinner) {
      liberadoWinner.wins += 1;
      room.roundWinnerId = liberadoWinner.id;
    }
    applyRoundLoss(room, autoLoser);
    return;
  }

  let winner = participants[0];
  let loser = participants[0];
  for (const p of participants) {
    if (compareHands(p.hand, winner.hand) > 0) winner = p;
    if (compareHands(p.hand, loser.hand) < 0) loser = p;
  }
  winner.wins += 1;
  room.roundWinnerId = winner.id;
  if (loser.id === winner.id && participants.length > 1) {
    loser = participants.find(p => p.id !== winner.id);
  }
  applyRoundLoss(room, loser);
}

io.on('connection', (socket) => {

  socket.on('list_rooms', (cb) => {
    cb?.({ rooms: Object.values(rooms).filter(r => !r.vsBot).map(sanitizeForList) });
  });

  socket.on('create_room', ({ playerName, roomName, maxPlayers = 6, vsBot = false, maxRounds = 0, isPrivate = false }, cb) => {
    if (!playerName?.trim()) return cb?.({ ok: false, error: 'Faltan datos' });
    if (!vsBot && !roomName?.trim()) return cb?.({ ok: false, error: 'Faltan datos' });
    let code;
    do { code = genCode(); } while (rooms[code]);

    const room = {
      code,
      name: roomName.trim(),
      maxPlayers: vsBot ? Math.min(Math.max(2, parseInt(maxPlayers) || 2), 5) : Math.min(Math.max(2, parseInt(maxPlayers) || 6), 10),
      vsBot,
      isPrivate: !!isPrivate,
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
      const numBots = room.maxPlayers - 1;
      for (let i = 0; i < numBots; i++) room.players.push(makeBotPlayer(i));
      startRound(room); // skip lobby phase
    }

    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    console.log(`create_room: "${roomName}" code="${code}" host="${playerName}" vsBot=${vsBot}`);
    cb?.({ ok: true, code });
    trackEvent('room_create', { vsBot, isPrivate: !!isPrivate, maxPlayers: room.maxPlayers });
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
    trackEvent('game_start', { playerCount: room.players.length, vsBot: room.vsBot ?? false });
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
    player.rollSeed = Math.floor(Math.random() * 0xFFFFFFFF);
    player.pendingDiscards = [];

    cb?.({ ok: true });
    broadcast(room.code);
    startTurnTimer(room);
  });

  socket.on('report_faces', (data, rawCb) => {
    const { faces } = (data && typeof data === 'object') ? data : {};
    const cb = typeof rawCb === 'function' ? rawCb : null;
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
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('stand', (data, rawCb) => {
    const { faces } = (data && typeof data === 'object') ? data : {};
    const cb = typeof rawCb === 'function' ? rawCb : null;
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
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing' || !room.awaitingContinue) return cb?.({ ok: false });
    proceedTurn(room);
    cb?.({ ok: true });
    broadcast(room.code);
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
    // Reset wins y palillos — el perdedor de la partida abre la revancha
    const loser = room.players.find(p => p.id === room.gameLoserId)
      ?? room.players.reduce((l, p) => (p.wins < l.wins ? p : l), room.players[0]);
    room.nextStarterId = loser.id;
    room.gameLoserId = null;
    room.endReason = null;
    for (const p of room.players) { p.wins = 0; p.breaks = 0; p.liberado = false; }
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
