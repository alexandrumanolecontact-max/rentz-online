import { createCardElement, getRankLabel, getSuitSymbol, isRedSuit } from './cards.js';

const STORAGE_TOKEN_KEY = 'rentz_player_token';
const STORAGE_NICK_KEY = 'rentz_nickname';

const state = {
  playerToken: sessionStorage.getItem(STORAGE_TOKEN_KEY) || '',
  nickname: sessionStorage.getItem(STORAGE_NICK_KEY) || '',
  room: null,
};

const socket = window.io();

// Mentine serverul cloud activ (ex. Render Free) cat timp jucatorul se afla intr-un lobby sau meci
setInterval(() => {
  if (state.room) {
    fetch('/api/health').catch(() => {});
  }
}, 4 * 60 * 1000);

// Referințe DOM
const screens = {
  nickname: document.getElementById('screen-nickname'),
  menu: document.getElementById('screen-menu'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
};

const formNickname = document.getElementById('form-nickname');
const inputNickname = document.getElementById('input-nickname');
const displayNickname = document.getElementById('display-nickname');
const btnChangeNick = document.getElementById('btn-change-nick');
const btnCreateRoom = document.getElementById('btn-create-room');
const formJoinRoom = document.getElementById('form-join-room');
const inputRoomCode = document.getElementById('input-room-code');

const btnLeaveLobby = document.getElementById('btn-leave-lobby');
const lobbyCountBadge = document.getElementById('lobby-count-badge');
const lobbyRoomCode = document.getElementById('lobby-room-code');
const btnCopyCode = document.getElementById('btn-copy-code');
const lobbyPlayersGrid = document.getElementById('lobby-players-grid');
const lobbyStatusMsg = document.getElementById('lobby-status-msg');
const btnToggleReady = document.getElementById('btn-toggle-ready');

const hudRound = document.getElementById('hud-round');
const hudSubgame = document.getElementById('hud-subgame');
const hudBanner = document.getElementById('hud-banner');
const opponentsRing = document.getElementById('opponents-ring');
const tableCenter = document.getElementById('table-center');
const lastTrickBox = document.getElementById('last-trick-box');
const mySeatBar = document.getElementById('my-seat-bar');
const rentzPassRow = document.getElementById('rentz-pass-row');
const btnPassRentz = document.getElementById('btn-pass-rentz');
const myHandContainer = document.getElementById('my-hand');

const modalScores = document.getElementById('modal-scores');
const scoresModalBody = document.getElementById('scores-modal-body');
const modalRules = document.getElementById('modal-rules');

function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

function syncMenuHeader() {
  displayNickname.textContent = state.nickname;
}

// Inițializare sesiune pe conexiune Socket.IO
socket.on('connect', () => {
  socket.emit(
    'session:init',
    {
      playerToken: state.playerToken,
      nickname: state.nickname,
    },
    (res) => {
      if (!res || !res.ok) return;
      state.playerToken = res.playerToken;
      sessionStorage.setItem(STORAGE_TOKEN_KEY, state.playerToken);

      if (res.reconnected && res.room) {
        handleRoomState(res.room);
      } else if (state.nickname.length >= 2) {
        syncMenuHeader();
        showScreen('menu');
      } else {
        showScreen('nickname');
      }
    }
  );
});

socket.on('room:state', (roomPayload) => {
  handleRoomState(roomPayload);
});

function handleRoomState(room) {
  state.room = room;
  if (room.notice) {
    showToast(room.notice, false);
  }
  if (room.status === 'lobby') {
    renderLobby(room);
    showScreen('lobby');
  } else if (room.status === 'in_game' && room.game) {
    renderGame(room);
    showScreen('game');
    if (!modalScores.classList.contains('hidden')) {
      renderScoresModal(room.game);
    }
  }
}

/* ==================== ECRAN 1 & 2: NICKNAME + MENIU ==================== */

formNickname.addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = inputNickname.value.trim().replace(/\s+/g, ' ');
  if (nick.length < 2) {
    showToast('Nickname-ul trebuie să aibă minim 2 caractere.', true);
    return;
  }
  state.nickname = nick;
  sessionStorage.setItem(STORAGE_NICK_KEY, nick);
  syncMenuHeader();
  showScreen('menu');
});

btnChangeNick.addEventListener('click', () => {
  inputNickname.value = state.nickname;
  showScreen('nickname');
  inputNickname.focus();
});

btnCreateRoom.addEventListener('click', () => {
  btnCreateRoom.disabled = true;
  socket.emit('room:create', { nickname: state.nickname }, (res) => {
    btnCreateRoom.disabled = false;
    if (!res || !res.ok) {
      showToast(res?.error || 'Nu s-a putut crea camera.', true);
      return;
    }
    state.playerToken = res.playerToken;
    sessionStorage.setItem(STORAGE_TOKEN_KEY, state.playerToken);
    handleRoomState(res.room);
  });
});

inputRoomCode.addEventListener('input', () => {
  inputRoomCode.value = inputRoomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

formJoinRoom.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = inputRoomCode.value.trim().toUpperCase();
  if (!code) {
    showToast('Introdu codul de invitație!', true);
    return;
  }
  socket.emit('room:join', { nickname: state.nickname, code }, (res) => {
    if (!res || !res.ok) {
      showToast(res?.error || 'Nu s-a putut intra în cameră.', true);
      return;
    }
    state.playerToken = res.playerToken;
    sessionStorage.setItem(STORAGE_TOKEN_KEY, state.playerToken);
    inputRoomCode.value = '';
    handleRoomState(res.room);
  });
});

/* ==================== ECRAN 3: LOBBY ==================== */

btnCopyCode.addEventListener('click', async () => {
  if (!state.room) return;
  try {
    await navigator.clipboard.writeText(state.room.code);
    btnCopyCode.textContent = 'Copiat! ✓';
    setTimeout(() => {
      btnCopyCode.textContent = 'Copiază codul';
    }, 1800);
  } catch {
    showToast(`Codul camerei este: ${state.room.code}`);
  }
});

btnLeaveLobby.addEventListener('click', () => {
  socket.emit('room:leave', {}, () => {
    state.room = null;
    syncMenuHeader();
    showScreen('menu');
  });
});

btnToggleReady.addEventListener('click', () => {
  socket.emit('room:ready', {}, (res) => {
    if (res && !res.ok) {
      showToast(res.error || 'Nu s-a putut schimba starea Ready.', true);
    }
  });
});

function renderLobby(room) {
  lobbyRoomCode.textContent = room.code;
  lobbyCountBadge.textContent = `Jucători: ${room.players.length} / ${room.maxPlayers} (minim ${room.minPlayers})`;

  lobbyPlayersGrid.innerHTML = '';
  for (let i = 0; i < room.maxPlayers; i++) {
    const p = room.players[i];
    const seat = document.createElement('div');

    if (p) {
      seat.className = `lobby-seat${p.ready ? ' ready' : ''}`;
      const isMe = p.id === state.playerToken;
      const initial = p.nickname.charAt(0).toUpperCase();
      seat.innerHTML = `
        <div class="seat-user">
          <div class="avatar-circle">${escapeHtml(initial)}</div>
          <span class="seat-name">${escapeHtml(p.nickname)}${isMe ? ' (Tu)' : ''}</span>
          ${p.isHost ? '<span class="tag-badge">Host</span>' : ''}
        </div>
        <span class="ready-pill ${p.ready ? 'is-ready' : 'not-ready'}">
          ${p.ready ? '✓ Ready' : 'În așteptare'}
        </span>
      `;
    } else {
      seat.className = 'lobby-seat empty';
      const slotHint =
        i < room.minPlayers ? 'Se așteaptă jucător...' : 'Loc disponibil (opțional)';
      seat.innerHTML = `<span>Locul ${i + 1} — ${slotHint}</span>`;
    }

    lobbyPlayersGrid.appendChild(seat);
  }

  const me = room.players.find((p) => p.id === state.playerToken);
  const readyCount = room.players.filter((p) => p.ready).length;

  if (!room.canReady) {
    const needed = room.minPlayers - room.players.length;
    lobbyStatusMsg.textContent = `Mai trebuie cel puțin ${needed} ${
      needed === 1 ? 'jucător' : 'jucători'
    } în lobby pentru a activa butonul Ready (minim ${room.minPlayers}, maxim ${room.maxPlayers}).`;
    btnToggleReady.disabled = true;
    btnToggleReady.classList.remove('is-ready');
    btnToggleReady.textContent = 'Sunt Gata (Ready)';
  } else {
    lobbyStatusMsg.textContent = `Ready: ${readyCount} / ${room.players.length} jucători — când toți sunt Ready, jocul începe automat!`;
    btnToggleReady.disabled = false;
    if (me && me.ready) {
      btnToggleReady.classList.add('is-ready');
      btnToggleReady.textContent = 'Ești Ready ✓ (Anulează)';
    } else {
      btnToggleReady.classList.remove('is-ready');
      btnToggleReady.textContent = 'Sunt Gata (Ready)';
    }
  }
}

/* ==================== ECRAN 4: JOCUL RENTZ ==================== */

function getRotatedPlayers(players, myId) {
  const myIndex = players.findIndex((p) => p.id === myId);
  if (myIndex === -1) return players;
  return [...players.slice(myIndex), ...players.slice(0, myIndex)];
}

function formatSigned(val) {
  if (val > 0) return `+${val}`;
  return `${val}`;
}

function renderCapturedBadges(p, subgame) {
  if (!subgame || subgame.mode !== 'tricks') {
    if (p.rentzPlace) {
      return `<span class="mini-chip good-chip">Locul ${p.rentzPlace}</span>`;
    }
    return '';
  }
  const badges = [`<span class="mini-chip">Levate: ${p.tricksWon}</span>`];
  if (p.captured.hasKingOfHearts) {
    badges.push('<span class="mini-chip danger-chip">K♥</span>');
  }
  if (p.captured.hasTenOfClubs) {
    badges.push('<span class="mini-chip good-chip">10♣</span>');
  }
  if (p.captured.queensCount > 0) {
    badges.push(`<span class="mini-chip danger-chip">Q×${p.captured.queensCount}</span>`);
  }
  if (p.captured.diamondsCount > 0) {
    badges.push(`<span class="mini-chip danger-chip">♦×${p.captured.diamondsCount}</span>`);
  }
  return badges.join('');
}

function renderGame(room) {
  const g = room.game;
  const myId = state.playerToken;

  // HUD sus
  hudRound.textContent = `Runda ${g.roundNumber} / ${g.totalRounds}`;
  if (g.currentSubgame) {
    hudSubgame.textContent = `${g.currentSubgame.badge} ${g.currentSubgame.name}`;
    hudSubgame.className = `hud-pill hud-subgame ${
      g.currentSubgame.type === 'negative' ? 'neg' : 'pos'
    }`;
  } else {
    hudSubgame.textContent = 'Alegere sub-joc...';
    hudSubgame.className = 'hud-pill hud-subgame';
  }
  hudBanner.textContent = g.statusBanner || '';

  // Rotim jucătorii astfel încât EU să fiu mereu jos (index 0), iar ceilalți în sens orar sus
  const rotated = getRotatedPlayers(g.players, myId);
  const me = rotated[0];
  const opponents = rotated.slice(1);

  // Randare adversari
  opponentsRing.innerHTML = '';
  for (const opp of opponents) {
    const isTurn = g.currentTurnPlayerId === opp.id;
    const isChooser = g.chooserId === opp.id;
    const scoreClass = opp.score > 0 ? 'pos' : opp.score < 0 ? 'neg' : '';
    const seatEl = document.createElement('div');
    seatEl.className = `opponent-seat${isTurn ? ' active-turn' : ''}`;
    seatEl.innerHTML = `
      <div class="seat-top-line">
        <span>${escapeHtml(opp.nickname)}${!opp.connected ? ' (offline)' : ''}</span>
        <span class="seat-score ${scoreClass}">${opp.score}p</span>
      </div>
      <div class="seat-meta-line">
        <span class="mini-chip">🂠 ${opp.cardCount}</span>
        ${isChooser ? '<span class="mini-chip">Alege</span>' : ''}
        ${isTurn ? '<span class="mini-chip turn-chip">La rând</span>' : ''}
        ${renderCapturedBadges(opp, g.currentSubgame)}
      </div>
    `;
    opponentsRing.appendChild(seatEl);
  }

  // Randare bară proprie (jos)
  if (me) {
    const myTurn = g.currentTurnPlayerId === me.id;
    const myScoreClass = me.score > 0 ? 'pos' : me.score < 0 ? 'neg' : '';
    mySeatBar.className = `my-seat-bar${myTurn ? ' my-turn' : ''}`;
    mySeatBar.innerHTML = `
      <strong>${escapeHtml(me.nickname)} (Tu)</strong>
      <span class="seat-score ${myScoreClass}">Scor: ${me.score}p</span>
      ${g.chooserId === me.id ? '<span class="mini-chip">Alegătorul rundei</span>' : ''}
      ${myTurn ? '<span class="mini-chip turn-chip">Este rândul tău!</span>' : ''}
      ${renderCapturedBadges(me, g.currentSubgame)}
    `;
  }

  // Ultima levată (dacă suntem în joc pe levate și există o levată precedentă)
  if (g.lastTrick && (g.phase === 'playing_tricks' || g.phase === 'trick_complete')) {
    lastTrickBox.classList.remove('hidden');
    const cardsHtml = g.lastTrick.cards
      .map((entry) => {
        const col = isRedSuit(entry.card.suit) ? 'suit-red' : 'suit-black';
        return `<span class="${col}">${entry.card.label}${entry.card.symbol}</span>`;
      })
      .join(' ');
    lastTrickBox.innerHTML = `
      <div>Ultima levată (${escapeHtml(g.lastTrick.winnerName)}):</div>
      <div class="last-trick-cards">${cardsHtml}</div>
    `;
  } else {
    lastTrickBox.classList.add('hidden');
  }

  // Randare centru masă în funcție de fază
  renderTableCenter(g, me);

  // Buton Pas la Rentz (vizibil doar când e rândul meu și nu am mutare validă)
  rentzPassRow.classList.toggle('hidden', !g.canPassRentz);

  // Randare cărți în mână
  renderMyHand(g);
}

function renderTableCenter(g, me) {
  tableCenter.innerHTML = '';

  if (g.phase === 'choosing_subgame') {
    if (g.chooserId === state.playerToken && me) {
      const box = document.createElement('div');
      box.className = 'subgame-picker';
      box.innerHTML = `<div class="picker-title">Privește-ți cărțile de jos și alege sub-jocul rundei:</div>`;
      const grid = document.createElement('div');
      grid.className = 'subgame-grid';

      for (const sub of g.subgamesCatalog) {
        const available = me.availableSubgames.includes(sub.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `subgame-btn ${sub.type}`;
        btn.disabled = !available;
        btn.innerHTML = `
          <div class="subgame-btn-top">
            <span>${escapeHtml(sub.name)}</span>
            <span class="subgame-badge">${available ? escapeHtml(sub.badge) : '✓'}</span>
          </div>
          <div class="subgame-desc">${
            available ? escapeHtml(sub.shortDesc) : 'Deja ales de tine'
          }</div>
        `;
        if (available) {
          btn.addEventListener('click', () => {
            socket.emit('game:choose_subgame', { subgameId: sub.id }, (res) => {
              if (res && !res.ok) showToast(res.error, true);
            });
          });
        }
        grid.appendChild(btn);
      }

      box.appendChild(grid);
      tableCenter.appendChild(box);
    } else {
      const chooser = g.players.find((p) => p.id === g.chooserId);
      const box = document.createElement('div');
      box.className = 'waiting-chooser-box';
      const remainingNames = g.subgamesCatalog
        .filter((s) => chooser?.availableSubgames.includes(s.id))
        .map((s) => `<span class="mini-chip">${escapeHtml(s.badge)} ${escapeHtml(s.name)}</span>`)
        .join('');
      box.innerHTML = `
        <h3>${escapeHtml(chooser?.nickname || 'Jucătorul')} alege sub-jocul...</h3>
        <p class="subgame-desc">Sub-jocuri disponibile pentru ${escapeHtml(
          chooser?.nickname || ''
        )}:</p>
        <div class="avail-chips">${remainingNames}</div>
      `;
      tableCenter.appendChild(box);
    }
    return;
  }

  if (g.phase === 'playing_tricks' || g.phase === 'trick_complete') {
    const arena = document.createElement('div');
    arena.className = 'trick-arena';

    if (g.currentTrick.length === 0) {
      const lead = g.players.find((p) => p.id === g.leadPlayerId);
      arena.innerHTML = `<div class="empty-trick-hint">Levata ${g.trickNumber} / 8 — ${escapeHtml(
        lead?.nickname || ''
      )} deschide mâna</div>`;
    } else {
      const leadCard = g.currentTrick[0].card;
      const leadHint = document.createElement('div');
      leadHint.className = 'hud-pill';
      leadHint.textContent = `Culoarea cerută: ${leadCard.symbol}`;
      arena.appendChild(leadHint);

      const row = document.createElement('div');
      row.className = 'trick-cards-row';
      for (const entry of g.currentTrick) {
        const slot = document.createElement('div');
        slot.className = `played-card-slot${
          g.trickWinnerId === entry.playerId ? ' winner' : ''
        }`;
        slot.appendChild(createCardElement(entry.card));
        const by = document.createElement('div');
        by.className = 'played-by';
        by.textContent = entry.nickname;
        slot.appendChild(by);
        row.appendChild(slot);
      }
      arena.appendChild(row);
    }

    tableCenter.appendChild(arena);
    return;
  }

  if (g.phase === 'playing_rentz') {
    const boardEl = document.createElement('div');
    boardEl.className = 'rentz-board';

    for (const suit of g.suitsOrder) {
      const track = g.rentzBoard ? g.rentzBoard[suit] : null;
      const row = document.createElement('div');
      row.className = 'rentz-suit-row';

      const suitHead = document.createElement('div');
      suitHead.className = `rentz-suit-header ${isRedSuit(suit) ? 'suit-red' : 'suit-black'}`;
      suitHead.textContent = getSuitSymbol(suit);
      row.appendChild(suitHead);

      const slots = document.createElement('div');
      slots.className = 'rentz-slots';

      for (let val = g.minRank; val <= 14; val++) {
        const slot = document.createElement('div');
        const label = getRankLabel(val);
        const isPlaced = track && val >= track.low && val <= track.high;
        const isNextOpen =
          (!track && val === g.centerRank) ||
          (track && (val === track.low - 1 || val === track.high + 1));

        slot.className = 'rentz-slot';
        if (isPlaced) {
          slot.classList.add('placed', isRedSuit(suit) ? 'red' : 'black');
          slot.innerHTML = `<span>${label}${getSuitSymbol(suit)}</span>`;
        } else {
          if (val === g.centerRank) slot.classList.add('center-slot');
          if (isNextOpen) slot.classList.add('next-open');
          let extraTag = '';
          if (val === 14) extraTag = '<span class="slot-tag">+1</span>';
          else if (val === g.minRank) extraTag = '<span class="slot-tag">stop</span>';
          slot.innerHTML = `<span>${label}</span>${extraTag}`;
        }

        slots.appendChild(slot);
      }

      row.appendChild(slots);
      boardEl.appendChild(row);
    }

    tableCenter.appendChild(boardEl);
    return;
  }

  if (g.phase === 'round_summary' && g.lastRoundSummary) {
    const s = g.lastRoundSummary;
    const panel = document.createElement('div');
    panel.className = 'summary-panel';

    const rowsHtml = g.players
      .map((p) => {
        const d = s.deltas[p.id] || 0;
        const dColor = d > 0 ? 'suit-black' : d < 0 ? 'suit-red' : '';
        return `
          <tr>
            <td>${escapeHtml(p.nickname)}${p.continuedSummary ? ' ✓' : ''}</td>
            <td class="${dColor}">${formatSigned(d)}</td>
            <td><strong>${s.totalsAfter[p.id]}</strong></td>
          </tr>
        `;
      })
      .join('');

    const continuedCount = g.players.filter((p) => p.continuedSummary).length;
    const iContinued = me?.continuedSummary;

    panel.innerHTML = `
      <h3>Runda ${s.roundNumber} încheiată — ${escapeHtml(s.subgameName)}</h3>
      <p class="summary-reason">${escapeHtml(s.reason)}</p>
      <table class="summary-table">
        <thead>
          <tr>
            <th>Jucător</th>
            <th>Puncte rundă</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <button id="btn-continue-round" type="button" class="btn btn-primary" ${
        iContinued ? 'disabled' : ''
      }>
        ${
          iContinued
            ? `Așteptare ceilalți (${continuedCount}/${g.players.length})...`
            : `Continuă (${continuedCount}/${g.players.length})`
        }
      </button>
    `;

    tableCenter.appendChild(panel);
    const btnCont = document.getElementById('btn-continue-round');
    if (btnCont && !iContinued) {
      btnCont.addEventListener('click', () => {
        socket.emit('game:continue_summary', {});
      });
    }
    return;
  }

  if (g.phase === 'game_over') {
    const panel = document.createElement('div');
    panel.className = 'summary-panel';
    const medals = ['🥇', '🥈', '🥉'];
    const rowsHtml = g.standings
      .map((st, idx) => {
        const medal = medals[idx] || `${idx + 1}.`;
        return `
          <tr>
            <td>${medal} <strong>${escapeHtml(st.nickname)}</strong></td>
            <td></td>
            <td><strong>${st.score} pct</strong></td>
          </tr>
        `;
      })
      .join('');

    panel.innerHTML = `
      <h3>🏆 Partidă Încheiată!</h3>
      <p class="summary-reason">Câștigător: <strong>${escapeHtml(
        g.standings[0]?.nickname || ''
      )}</strong></p>
      <table class="summary-table">
        <thead>
          <tr>
            <th>Clasament</th>
            <th></th>
            <th>Scor Final</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <button id="btn-back-lobby" type="button" class="btn btn-primary">
        Înapoi în Lobby (Joc Nou)
      </button>
    `;

    tableCenter.appendChild(panel);
    document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
      socket.emit('room:return_to_lobby', {}, (res) => {
        if (res && !res.ok) showToast(res.error, true);
      });
    });
  }
}

function renderMyHand(g) {
  myHandContainer.innerHTML = '';
  const isActionPhase = g.phase === 'playing_tricks' || g.phase === 'playing_rentz';
  const isMyTurn = g.currentTurnPlayerId === state.playerToken;
  const playableSet = new Set(g.playableCardIds || []);

  for (const card of g.myHand) {
    const playable = isActionPhase && isMyTurn && playableSet.has(card.id);
    const disabled = isActionPhase && isMyTurn && !playableSet.has(card.id);

    const cardEl = createCardElement(card, {
      playable,
      disabled,
      onClick: (clicked) => {
        socket.emit('game:play_card', { cardId: clicked.id }, (res) => {
          if (res && !res.ok) {
            showToast(res.error, true);
          }
        });
      },
    });
    myHandContainer.appendChild(cardEl);
  }
}

btnPassRentz.addEventListener('click', () => {
  socket.emit('game:pass_rentz', {}, (res) => {
    if (res && !res.ok) showToast(res.error, true);
  });
});

/* ==================== MODALE & ACȚIUNI HUD ==================== */

function renderScoresModal(g) {
  const standingsRows = g.standings
    .map((s, idx) => {
      const p = g.players.find((pl) => pl.id === s.id);
      const remChips = g.subgamesCatalog
        .filter((sub) => p?.availableSubgames.includes(sub.id))
        .map((sub) => `<span class="mini-chip">${escapeHtml(sub.badge)}</span>`)
        .join(' ');
      return `
        <tr>
          <td>${idx + 1}. <strong>${escapeHtml(s.nickname)}</strong></td>
          <td style="text-align:left">${remChips || '<em>Toate jucate</em>'}</td>
          <td><strong>${s.score}</strong></td>
        </tr>
      `;
    })
    .join('');

  const historyRows = g.roundHistory
    .slice()
    .reverse()
    .map((h) => {
      const perPlayer = g.players
        .map((p) => `${escapeHtml(p.nickname)}: ${formatSigned(h.deltas[p.id] || 0)}`)
        .join(' · ');
      return `
        <tr>
          <td>#${h.roundNumber} — <strong>${escapeHtml(h.subgameName)}</strong> (${escapeHtml(
        h.chooserName
      )})</td>
          <td colspan="2" style="text-align:right; font-size:0.82rem">${perPlayer}</td>
        </tr>
      `;
    })
    .join('');

  scoresModalBody.innerHTML = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Jucător</th>
          <th style="text-align:left">Sub-jocuri rămase</th>
          <th>Scor Total</th>
        </tr>
      </thead>
      <tbody>${standingsRows}</tbody>
    </table>
    <h4 style="color:var(--gold-bright)">Istoric Runde (${g.roundHistory.length})</h4>
    ${
      historyRows
        ? `<table class="summary-table"><tbody>${historyRows}</tbody></table>`
        : '<p style="color:var(--text-muted); font-size:0.9rem">Nicio rundă finalizată încă.</p>'
    }
  `;
}

document.getElementById('btn-open-scores').addEventListener('click', () => {
  if (state.room?.game) {
    renderScoresModal(state.room.game);
  }
  modalScores.classList.remove('hidden');
});

document.getElementById('btn-open-rules').addEventListener('click', () => {
  modalRules.classList.remove('hidden');
});

document.getElementById('btn-leave-game').addEventListener('click', () => {
  if (!window.confirm('Sigur vrei să părăsești masa? Jocul curent se va opri pentru toți jucătorii.')) {
    return;
  }
  socket.emit('room:leave', {}, () => {
    state.room = null;
    syncMenuHeader();
    showScreen('menu');
  });
});

document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-close-modal');
    document.getElementById(id)?.classList.add('hidden');
  });
});

[modalScores, modalRules].forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.add('hidden');
  });
});
