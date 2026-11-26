require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./roomManager');
const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  isAuthConfigured,
  registerAccount,
  loginAccount,
  requestPasswordReset,
  verifyAccessToken,
} = require('./auth');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(
  '/vendor/supabase',
  express.static(
    path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd')
  )
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({
    ok: true,
    configured: isAuthConfigured(),
    supabaseUrl: isAuthConfigured() ? SUPABASE_URL : '',
    supabaseAnonKey: isAuthConfigured() ? SUPABASE_ANON_KEY : '',
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get('host')}/`;
    const result = await registerAccount({
      username: req.body?.username,
      email: req.body?.email,
      password: req.body?.password,
      redirectTo: req.body?.redirectTo || origin,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Eroare internă la înregistrare.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await loginAccount({
      identifier: req.body?.identifier,
      password: req.body?.password,
    });
    res.status(result.ok ? 200 : 401).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Eroare internă la autentificare.' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get('host')}/`;
    const result = await requestPasswordReset({
      identifier: req.body?.identifier,
      redirectTo: req.body?.redirectTo || origin,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Eroare internă la resetarea parolei.' });
  }
});

const roomManager = new RoomManager((roomCode) => {
  broadcastRoomState(roomCode);
});

function broadcastRoomState(roomCode, notice = null) {
  const room = roomManager.rooms.get(roomCode);
  if (!room) return;

  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const payload = roomManager.serializeRoomForPlayer(room, player.id);
    if (notice) {
      payload.notice = notice;
    }
    io.to(player.socketId).emit('room:state', payload);
  }
}

io.on('connection', (socket) => {
  let playerId = null;
  let verifiedUsername = null;

  socket.on('session:init', async (data = {}, ack) => {
    if (!isAuthConfigured()) {
      if (typeof ack === 'function') {
        ack({ ok: false, authNotConfigured: true });
      }
      return;
    }

    const verified = await verifyAccessToken(data.accessToken);
    if (!verified.ok) {
      playerId = null;
      verifiedUsername = null;
      if (typeof ack === 'function') {
        ack({ ok: false, authRequired: true, error: verified.error });
      }
      return;
    }

    playerId = verified.user.id;
    verifiedUsername = verified.user.username;

    const recon = roomManager.reconnectSession(playerId, socket.id, verifiedUsername);
    if (recon.ok && recon.room) {
      broadcastRoomState(recon.room.code);
      if (typeof ack === 'function') {
        ack({
          ok: true,
          user: verified.user,
          reconnected: true,
          room: roomManager.serializeRoomForPlayer(recon.room, playerId),
        });
      }
      return;
    }

    if (typeof ack === 'function') {
      ack({
        ok: true,
        user: verified.user,
        reconnected: false,
      });
    }
  });

  socket.on('session:logout', (_data = {}, ack) => {
    if (playerId) {
      const res = roomManager.leaveRoom(playerId);
      if (res && !res.deleted && res.room) {
        broadcastRoomState(res.code, res.abortedNotice || null);
      }
    }
    playerId = null;
    verifiedUsername = null;
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('room:create', (_data = {}, ack) => {
    if (!playerId || !verifiedUsername) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Trebuie să fii autentificat în cont pentru a crea o cameră.' });
      }
      return;
    }
    const res = roomManager.createRoom(playerId, verifiedUsername, socket.id);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    broadcastRoomState(res.room.code);
    if (typeof ack === 'function') {
      ack({
        ok: true,
        room: roomManager.serializeRoomForPlayer(res.room, playerId),
      });
    }
  });

  socket.on('room:join', (data = {}, ack) => {
    if (!playerId || !verifiedUsername) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Trebuie să fii autentificat în cont pentru a intra într-o cameră.' });
      }
      return;
    }
    const res = roomManager.joinRoom(playerId, verifiedUsername, data.code, socket.id);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    broadcastRoomState(res.room.code);
    if (typeof ack === 'function') {
      ack({
        ok: true,
        room: roomManager.serializeRoomForPlayer(res.room, playerId),
      });
    }
  });

  socket.on('room:ready', (_data = {}, ack) => {
    if (!playerId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Sesiune neautentificată.' });
      return;
    }
    const res = roomManager.toggleReady(playerId);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    broadcastRoomState(res.room.code);
    if (typeof ack === 'function') ack({ ok: true, started: res.started });
  });

  socket.on('room:leave', (_data = {}, ack) => {
    if (!playerId) {
      if (typeof ack === 'function') ack({ ok: true });
      return;
    }
    const res = roomManager.leaveRoom(playerId);
    if (res && !res.deleted && res.room) {
      broadcastRoomState(res.code, res.abortedNotice || null);
    }
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('room:return_to_lobby', (_data = {}, ack) => {
    if (!playerId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Sesiune invalidă.' });
      return;
    }
    const res = roomManager.returnToLobby(playerId);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    if (!res.deleted && res.room) {
      broadcastRoomState(res.room.code);
    }
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('game:choose_subgame', (data = {}, ack) => {
    const room = playerId ? roomManager.getRoomByPlayer(playerId) : null;
    if (!room || !room.game) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Jocul nu este activ.' });
      return;
    }
    const res = room.game.chooseSubgame(playerId, data.subgameId);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    broadcastRoomState(room.code);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('game:play_card', (data = {}, ack) => {
    const room = playerId ? roomManager.getRoomByPlayer(playerId) : null;
    if (!room || !room.game) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Jocul nu este activ.' });
      return;
    }
    const res = room.game.playCard(playerId, data.cardId);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    broadcastRoomState(room.code);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('game:pass_rentz', (_data = {}, ack) => {
    const room = playerId ? roomManager.getRoomByPlayer(playerId) : null;
    if (!room || !room.game) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Jocul nu este activ.' });
      return;
    }
    const res = room.game.passRentzTurn(playerId);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    broadcastRoomState(room.code);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('game:continue_summary', (_data = {}, ack) => {
    const room = playerId ? roomManager.getRoomByPlayer(playerId) : null;
    if (!room || !room.game) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Jocul nu este activ.' });
      return;
    }
    const res = room.game.acknowledgeRoundSummary(playerId);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    broadcastRoomState(room.code);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const res = roomManager.handleSocketDisconnect(socket.id);
    if (res && res.room) {
      broadcastRoomState(res.code);
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Serverul Rentz ruleaza la adresa: http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, roomManager };
