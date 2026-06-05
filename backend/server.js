const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { rollDice, evaluateHand, compareHands } = require('./gameLogic');

const app = express();
app.use(cors({ origin: '*' }));
app.get('/', (_, res) => res.send('OK'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
});

const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function makePlayer(id, name) {
  return { id, name, currentDice: [], rollHistory: [], rollCount: 0, done: false, hand: null, wins: 0 };
}

function sanitize(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    roundNumber: room.roundNumber,
    currentPlayerIndex: room.currentPlayerIndex,
    maxRolls: room.maxRolls,
    roundWinnerId: room.roundWinnerId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      currentDice: p.currentDice,
      rollHistory: p.rollHistory,
      rollCount: p.rollCount,
      done: p.done,
      hand: p.hand,
      wins: p.wins,
    })),
  };
}

function broadcast(code) {
  const room = rooms[code];
  if (room) io.to(code).emit('room_state', sanitize(room));
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

  socket.on('create_room', ({ playerName }, cb) => {
    let code;
    do { code = genCode(); } while (rooms[code]);
    console.log(`create_room: code="${code}" host="${playerName}"`);
    rooms[code] = {
      code, hostId: socket.id, phase: 'lobby',
      roundNumber: 0, currentPlayerIndex: 0, maxRolls: null, roundWinnerId: null,
      players: [makePlayer(socket.id, playerName)],
    };
    socket.join(code);
    socket.data.roomCode = code;
    cb({ ok: true, code });
    broadcast(code);
  });

  socket.on('join_room', ({ code, playerName }, cb) => {
    console.log(`join_room: code="${code}" name="${playerName}" rooms=[${Object.keys(rooms).join(',')}]`);
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'Sala no encontrada' });

    // Allow reconnection: same name already in the room
    const existing = room.players.find(p => p.name === playerName);
    if (existing) {
      existing.id = socket.id;
      if (room.hostId === existing.id) room.hostId = socket.id;
      socket.join(code);
      socket.data.roomCode = code;
      cb({ ok: true, code });
      broadcast(code);
      return;
    }

    if (room.phase !== 'lobby') return cb({ ok: false, error: 'La partida ya ha comenzado' });
    room.players.push(makePlayer(socket.id, playerName));
    socket.join(code);
    socket.data.roomCode = code;
    cb({ ok: true, code });
    broadcast(code);
  });

  socket.on('start_game', (cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id) return cb?.({ ok: false });
    if (room.players.length < 2) return cb?.({ ok: false, error: 'Necesitas al menos 2 jugadores' });
    startRound(room);
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
      player.rollHistory.push([...player.currentDice]);
    }
    const keptDice = keptIndices
      .filter(i => i >= 0 && i < player.currentDice.length)
      .map(i => player.currentDice[i]);
    player.currentDice = rollDice(keptDice);
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

    setTimeout(() => {
      const r = rooms[code];
      if (!r) return;
      r.players = r.players.filter(p => p.id !== socket.id);
      if (r.players.length === 0) { delete rooms[code]; return; }
      if (r.hostId === socket.id) r.hostId = r.players[0].id;
      broadcast(code);
    }, 20_000);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => console.log(`Servidor en http://0.0.0.0:${PORT}`));
