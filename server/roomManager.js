const crypto = require('crypto');
const { MIN_PLAYERS, MAX_PLAYERS, TIMERS } = require('./rulesConfig');
const { RentzGame } = require('./gameEngine');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

class RoomManager {
  /**
   * @param {(roomCode: string) => void} onRoomUpdated Callback apelat când o cameră se modifică (inclusiv din timere asincrone)
   */
  constructor(onRoomUpdated) {
    this.rooms = new Map(); // code -> room
    this.playerRoomMap = new Map(); // playerId -> roomCode
    this.disconnectTimers = new Map(); // playerId -> Timeout
    this.onRoomUpdated = onRoomUpdated || (() => {});
  }

  generateInviteCode() {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  sanitizeNickname(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().replace(/\s+/g, ' ').slice(0, 18);
  }

  clearDisconnectTimer(playerId) {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }
  }

  getRoomByPlayer(playerId) {
    const code = this.playerRoomMap.get(playerId);
    if (!code) return null;
    return this.rooms.get(code) || null;
  }

  createRoom(playerId, rawNickname, socketId) {
    const nickname = this.sanitizeNickname(rawNickname);
    if (nickname.length < 2) {
      return { ok: false, error: 'Nickname-ul trebuie să aibă cel puțin 2 caractere.' };
    }

    // Dacă jucătorul era într-o cameră anterioară, îl scoatem mai întâi
    this.leaveRoom(playerId);

    const code = this.generateInviteCode();
    const room = {
      code,
      hostId: playerId,
      status: 'lobby', // 'lobby' | 'in_game'
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      players: [
        {
          id: playerId,
          nickname,
          socketId,
          ready: false,
          connected: true,
        },
      ],
      game: null,
      createdAt: Date.now(),
    };

    this.rooms.set(code, room);
    this.playerRoomMap.set(playerId, code);
    return { ok: true, room };
  }

  joinRoom(playerId, rawNickname, rawCode, socketId) {
    const nickname = this.sanitizeNickname(rawNickname);
    if (nickname.length < 2) {
      return { ok: false, error: 'Nickname-ul trebuie să aibă cel puțin 2 caractere.' };
    }

    const code = (rawCode || '').trim().toUpperCase();
    if (!code) {
      return { ok: false, error: 'Introdu codul de invitație al camerei.' };
    }

    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, error: 'Nu există nicio cameră activă cu acest cod.' };
    }

    // Dacă același jucător reconectează în aceeași cameră
    const existing = room.players.find((p) => p.id === playerId);
    if (existing) {
      this.clearDisconnectTimer(playerId);
      existing.socketId = socketId;
      existing.connected = true;
      existing.nickname = nickname;
      return { ok: true, room };
    }

    if (room.status !== 'lobby') {
      return { ok: false, error: 'Jocul din această cameră a început deja.' };
    }

    if (room.players.length >= room.maxPlayers) {
      return { ok: false, error: `Camera este plină (maxim ${room.maxPlayers} jucători).` };
    }

    const duplicateNick = room.players.some(
      (p) => p.nickname.toLowerCase() === nickname.toLowerCase()
    );
    if (duplicateNick) {
      return { ok: false, error: 'Există deja un jucător cu acest nickname în cameră.' };
    }

    this.leaveRoom(playerId);

    room.players.push({
      id: playerId,
      nickname,
      socketId,
      ready: false,
      connected: true,
    });
    this.playerRoomMap.set(playerId, code);

    return { ok: true, room };
  }

  reconnectSession(playerId, socketId, rawNickname) {
    this.clearDisconnectTimer(playerId);
    const room = this.getRoomByPlayer(playerId);
    if (!room) {
      return { ok: false };
    }
    this.clearDisconnectTimer(`room_${room.code}`);
    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      this.playerRoomMap.delete(playerId);
      return { ok: false };
    }

    player.socketId = socketId;
    player.connected = true;
    const cleanNick = this.sanitizeNickname(rawNickname);
    if (cleanNick.length >= 2 && room.status === 'lobby') {
      const collision = room.players.some(
        (p) => p.id !== playerId && p.nickname.toLowerCase() === cleanNick.toLowerCase()
      );
      if (!collision) {
        player.nickname = cleanNick;
      }
    }

    return { ok: true, room };
  }

  toggleReady(playerId) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) {
      return { ok: false, error: 'Nu te afli în nicio cameră.' };
    }
    if (room.status !== 'lobby') {
      return { ok: false, error: 'Jocul este deja în desfășurare.' };
    }
    if (room.players.length < room.minPlayers) {
      return {
        ok: false,
        error: `Sunt necesari minim ${room.minPlayers} jucători pentru a fi gata.`,
      };
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      return { ok: false, error: 'Jucător negăsit în cameră.' };
    }

    player.ready = !player.ready;

    // Dacă sunt între minim și maxim jucători și TOȚI sunt Ready, jocul începe automat!
    const canAutoStart =
      room.players.length >= room.minPlayers &&
      room.players.length <= room.maxPlayers &&
      room.players.every((p) => p.ready && p.connected);

    if (canAutoStart) {
      this.startGame(room);
    }

    return { ok: true, room, started: room.status === 'in_game' };
  }

  startGame(room) {
    room.status = 'in_game';
    if (room.game) {
      room.game.destroy();
    }
    room.game = new RentzGame(room.players, () => {
      this.onRoomUpdated(room.code);
    });
  }

  returnToLobby(playerId) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) {
      return { ok: false, error: 'Camera nu a fost găsită.' };
    }
    if (room.status !== 'in_game' || !room.game || room.game.phase !== 'game_over') {
      return { ok: false, error: 'Partida încă nu s-a încheiat.' };
    }

    room.game.destroy();
    room.game = null;
    room.status = 'lobby';
    // Eliminăm boții (jucătorii ieșiți voluntar) și jucătorii deconectați definitiv, și resetăm starea Ready
    room.players = room.players.filter((p) => {
      if (p.isBot || !p.connected) {
        this.playerRoomMap.delete(p.id);
        return false;
      }
      p.ready = false;
      return true;
    });

    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return { ok: true, deleted: true };
    }

    if (!room.players.some((p) => p.id === room.hostId)) {
      room.hostId = room.players[0].id;
    }

    return { ok: true, room };
  }

  leaveRoom(playerId) {
    this.clearDisconnectTimer(playerId);
    const code = this.playerRoomMap.get(playerId);
    if (!code) return null;

    const room = this.rooms.get(code);
    this.playerRoomMap.delete(playerId);
    if (!room) return null;

    if (room.status === 'lobby') {
      room.players = room.players.filter((p) => p.id !== playerId);
      // Resetăm starea ready când se schimbă componența camerei ca să nu pornească accidental
      for (const p of room.players) {
        p.ready = false;
      }
      if (room.players.length === 0) {
        this.rooms.delete(code);
        return { code, deleted: true };
      }
      if (room.hostId === playerId) {
        room.hostId = room.players[0].id;
      }
      return { code, room };
    }

    // Dacă părăsește voluntar în timpul jocului, locul și tot progresul lui sunt preluate de un Bot!
    const leavingPlayer = room.players.find((p) => p.id === playerId);
    if (leavingPlayer) {
      leavingPlayer.isBot = true;
      leavingPlayer.connected = false;
      leavingPlayer.socketId = null;
    }

    // Dacă toți jucătorii umani au ieșit definitiv, închidem și curățăm camera
    const anyHumanRemaining = room.players.some((p) => !p.isBot);
    if (!anyHumanRemaining) {
      if (room.game) {
        room.game.destroy();
        room.game = null;
      }
      for (const p of room.players) {
        this.playerRoomMap.delete(p.id);
      }
      this.rooms.delete(code);
      return { code, deleted: true };
    }

    if (room.hostId === playerId) {
      const nextHost = room.players.find((p) => !p.isBot);
      if (nextHost) room.hostId = nextHost.id;
    }

    if (room.game) {
      room.game.convertPlayerToBot(playerId);
    }

    return {
      code,
      room,
      abortedNotice: `${
        leavingPlayer?.nickname || 'Un jucător'
      } a părăsit meciul — Botul a preluat locul și continuă jocul.`,
    };
  }

  handleSocketDisconnect(socketId) {
    for (const [code, room] of this.rooms.entries()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (!player) continue;

      player.connected = false;

      if (room.status === 'lobby') {
        // Perioadă de grație scurtă pentru refresh (F5) în lobby
        this.clearDisconnectTimer(player.id);
        const timer = setTimeout(() => {
          this.disconnectTimers.delete(player.id);
          const currentRoom = this.getRoomByPlayer(player.id);
          const currentPlayer = currentRoom?.players.find((p) => p.id === player.id);
          if (currentRoom && currentRoom.status === 'lobby' && currentPlayer && !currentPlayer.connected) {
            const res = this.leaveRoom(player.id);
            if (res && !res.deleted) {
              this.onRoomUpdated(code);
            }
          }
        }, TIMERS.LOBBY_DISCONNECT_GRACE_MS);
        this.disconnectTimers.set(player.id, timer);
      } else {
        // În timpul jocului, păstrăm locul jucătorului ca să se poată reconecta automat când intră în cont;
        // doar dacă toți jucătorii umani s-au deconectat timp de 15 minute curățăm camera.
        const everyoneOffline = room.players.every((p) => p.isBot || !p.connected);
        if (everyoneOffline) {
          this.clearDisconnectTimer(`room_${code}`);
          const roomTimer = setTimeout(() => {
            this.disconnectTimers.delete(`room_${code}`);
            const r = this.rooms.get(code);
            if (r && r.players.every((p) => p.isBot || !p.connected)) {
              if (r.game) r.game.destroy();
              for (const p of r.players) this.playerRoomMap.delete(p.id);
              this.rooms.delete(code);
            }
          }, 15 * 60 * 1000);
          this.disconnectTimers.set(`room_${code}`, roomTimer);
        }
      }

      return { code, room };
    }
    return null;
  }

  serializeRoomForPlayer(room, viewerId) {
    const connectionMap = {};
    for (const p of room.players) {
      connectionMap[p.id] = p.connected;
    }

    return {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      minPlayers: room.minPlayers,
      maxPlayers: room.maxPlayers,
      canReady:
        room.status === 'lobby' &&
        room.players.length >= room.minPlayers &&
        room.players.length <= room.maxPlayers,
      players: room.players.map((p, index) => ({
        id: p.id,
        nickname: p.nickname,
        ready: p.ready,
        connected: p.connected,
        isHost: p.id === room.hostId,
        seatIndex: index,
      })),
      game: room.game ? room.game.getStateForPlayer(viewerId, connectionMap) : null,
    };
  }
}

module.exports = { RoomManager };
