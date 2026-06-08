const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { rollDie, evaluateHand, compareHands } = require('./gameLogic');

const app = express();
app.use(cors({ origin: '*' }));
app.get('/', (_, res) => res.send('OK'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
});

const rooms = {};

const VALUE_RANK = { AS: 6, K: 5, Q: 4, J: 3, '8': 2, '7': 1 };
const BOT_ID = '__bot__';
const BOT_NAME = 'Bot';

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function makePlayer(id, name) {
  return { id, name, currentDice: [], rollHistory: [], rollCount: 0, done: false, hand: null, wins: 0 };
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

function botAct(code) {
  const room = rooms[code];
  if (!room || room.phase !== 'playing') return;
  const bot = room.players[room.currentPlayerIndex];
  if (!bot?.isBot || bot.done) return;

  const maxAllowed = room.maxRolls ?? 3;

  if (bot.rollCount > 0) {
    const hand = evaluateHand(bot.currentDice);
    if (botShouldStand(hand, bot.rollCount, maxAllowed)) {
      finishTurn(room, bot);
      broadcast(code);
      return;
    }
    // Roll again keeping best dice
    const keptIndices = botPickKept(bot.currentDice);
    bot.rollHistory.push([...bot.currentDice]);
    bot.currentDice = bot.currentDice.map((d, i) => keptIndices.includes(i) ? d : rollDie());
    bot.rollCount++;
    broadcast(code);
    setTimeout(() => botAct(code), 1400);
  } else {
    // First roll
    bot.currentDice = Array.from({ length: 5 }, rollDie);
    bot.rollCount = 1;
    broadcast(code);
    setTimeout(() => botAct(code), 1400);
  }
}

function runBotTurn(code) {
  setTimeout(() => botAct(code), 1200);
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
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot ?? false,
      currentDice: p.currentDice,
      rollHistory: p.rollHistory,
      rollCount: p.rollCount,
      done: p.done,
      hand: p.hand,
      wins: p.wins,
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
  room.roundNumber = (room.roundNumber ?? 0) + 1;
  for (const p of room.players) {
    p.currentDice = [];
    p.rollHistory = [];
    p.rollCount = 0;
    p.done = false;
    p.hand = null;
  }
}

function finishTurn(room, player) {
  player.done = true;
  player.hand = evaluateHand(player.currentDice);
  if (room.currentPlayerIndex === 0) {
    room.maxRolls = player.rollCount;
  }
  const next = room.players.findIndex((p, i) => i > room.currentPlayerIndex && !p.done);
  if (next !== -1) {
    room.currentPlayerIndex = next;
  } else {
    endRound(room);
  }
}

function endRound(room) {
  room.phase = 'results';
  let winner = room.players[0];
  for (const p of room.players) {
    if (compareHands(p.hand, winner.hand) > 0) winner = p;
  }
  winner.wins += 1;
  room.roundWinnerId = winner.id;
}

io.on('connection', (socket) => {

  socket.on('list_rooms', (cb) => {
    cb?.({ rooms: Object.values(rooms).filter(r => !r.vsBot).map(sanitizeForList) });
  });

  socket.on('create_room', ({ playerName, roomName, maxPlayers = 6, vsBot = false }, cb) => {
    if (!playerName?.trim() || !roomName?.trim()) return cb?.({ ok: false, error: 'Faltan datos' });
    let code;
    do { code = genCode(); } while (rooms[code]);

    const room = {
      code,
      name: roomName.trim(),
      maxPlayers: vsBot ? 2 : Math.min(Math.max(2, parseInt(maxPlayers) || 6), 10),
      vsBot,
      hostId: socket.id,
      phase: 'lobby',
      roundNumber: 0,
      currentPlayerIndex: 0,
      maxRolls: null,
      roundWinnerId: null,
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

  socket.on('roll', ({ keptIndices = [] }, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing') return cb?.({ ok: false });
    const player = room.players[room.currentPlayerIndex];
    if (player.id !== socket.id || player.done) return cb?.({ ok: false });
    const maxAllowed = room.maxRolls ?? 3;
    if (player.rollCount >= maxAllowed) return cb?.({ ok: false, error: 'No puedes tirar más' });

    if (player.rollCount > 0) {
      player.rollHistory.push([...player.currentDice]);
      player.currentDice = player.currentDice.map((die, i) =>
        keptIndices.includes(i) ? die : rollDie()
      );
    } else {
      player.currentDice = Array.from({ length: 5 }, rollDie);
    }
    player.rollCount += 1;

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

  socket.on('next_round', (cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id || room.phase !== 'results') return cb?.({ ok: false });
    startRound(room);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('disconnect', () => {
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
