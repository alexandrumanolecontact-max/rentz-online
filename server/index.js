const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./roomManager');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
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

  socket.on('session:init', (data = {}, ack) => {
    const token =
      typeof data.playerToken === 'string' && data.playerToken.length >= 8
        ? data.playerToken
        : crypto.randomUUID();
    playerId = token;

    const recon = roomManager.reconnectSession(playerId, socket.id, data.nickname);
    if (recon.ok && recon.room) {
      broadcastRoomState(recon.room.code);
      if (typeof ack === 'function') {
        ack({
          ok: true,
          playerToken: playerId,
          reconnected: true,
          room: roomManager.serializeRoomForPlayer(recon.room, playerId),
        });
      }
      return;
    }

    if (typeof ack === 'function') {
      ack({
        ok: true,
        playerToken: playerId,
        reconnected: false,
      });
    }
  });

  socket.on('room:create', (data = {}, ack) => {
    if (!playerId) {
      playerId = crypto.randomUUID();
    }
    const res = roomManager.createRoom(playerId, data.nickname, socket.id);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    broadcastRoomState(res.room.code);
    if (typeof ack === 'function') {
      ack({
        ok: true,
        playerToken: playerId,
        room: roomManager.serializeRoomForPlayer(res.room, playerId),
      });
    }
  });

  socket.on('room:join', (data = {}, ack) => {
    if (!playerId) {
      playerId = crypto.randomUUID();
    }
    const res = roomManager.joinRoom(playerId, data.nickname, data.code, socket.id);
    if (!res.ok) {
      if (typeof ack === 'function') ack({ ok: false, error: res.error });
      return;
    }
    broadcastRoomState(res.room.code);
    if (typeof ack === 'function') {
      ack({
        ok: true,
        playerToken: playerId,
        room: roomManager.serializeRoomForPlayer(res.room, playerId),
      });
    }
  });

  socket.on('room:ready', (_data = {}, ack) => {
    if (!playerId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Sesiune neinițializată.' });
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
