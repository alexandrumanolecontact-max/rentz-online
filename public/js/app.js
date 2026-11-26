import {
  createCardElement,
  createFaceDownCardElement,
  getRankLabel,
  getSuitSymbol,
  isRedSuit,
} from './cards.js';

const state = {
  user: null, // { id, username, email }
  accessToken: '',
  room: null,
  authConfigured: true,
  inPasswordRecovery: false,
  turnDeadlinePerf: null,
  turnTotalMs: 30000,
  turnIsAfkWarning: false,
};

let turnTickerInterval = null;

let supabaseClient = null;
const socket = window.io({ autoConnect: false });

// Menține serverul cloud activ (ex. Render Free) cât timp jucătorul se află într-un lobby sau meci
setInterval(() => {
  if (state.room) {
    fetch('/api/health').catch(() => {});
  }
}, 4 * 60 * 1000);

// Referințe DOM Ecrane
const screens = {
  auth: document.getElementById('screen-auth'),
  setupName: document.getElementById('screen-setup-name'),
  menu: document.getElementById('screen-menu'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
};

const formSetupName = document.getElementById('form-setup-name');
const inputDisplayName = document.getElementById('input-display-name');
const btnSubmitDisplayName = document.getElementById('btn-submit-display-name');
const btnSetupLogout = document.getElementById('btn-setup-logout');

// Referințe DOM Autentificare
const authSetupBanner = document.getElementById('auth-setup-banner');
const authTabs = document.getElementById('auth-tabs');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');

const formLogin = document.getElementById('form-login');
const loginIdentifier = document.getElementById('login-identifier');
const loginPassword = document.getElementById('login-password');
const btnSubmitLogin = document.getElementById('btn-submit-login');
const btnGotoForgot = document.getElementById('btn-goto-forgot');

const formRegister = document.getElementById('form-register');
const regUsername = document.getElementById('reg-username');
const regEmail = document.getElementById('reg-email');
const regPassword = document.getElementById('reg-password');
const regPasswordConfirm = document.getElementById('reg-password-confirm');
const btnSubmitRegister = document.getElementById('btn-submit-register');

const formForgot = document.getElementById('form-forgot');
const forgotIdentifier = document.getElementById('forgot-identifier');
const btnSubmitForgot = document.getElementById('btn-submit-forgot');
const btnBackToLogin = document.getElementById('btn-back-to-login');

const formResetPassword = document.getElementById('form-reset-password');
const resetNewPassword = document.getElementById('reset-new-password');
const resetConfirmPassword = document.getElementById('reset-confirm-password');
const btnSubmitReset = document.getElementById('btn-submit-reset');

// Referințe DOM Meniu, Lobby & Joc
const displayNickname = document.getElementById('display-nickname');
const btnLogout = document.getElementById('btn-logout');
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
const hudBlind = document.getElementById('hud-blind');
const hudBanner = document.getElementById('hud-banner');
const opponentsRing = document.getElementById('opponents-ring');
const tableCenter = document.getElementById('table-center');
const lastTrickBox = document.getElementById('last-trick-box');
const mySeatBar = document.getElementById('my-seat-bar');
const afkResumeBanner = document.getElementById('afk-resume-banner');
const btnResumeAfk = document.getElementById('btn-resume-afk');
const rentzPassRow = document.getElementById('rentz-pass-row');
const btnPassRentz = document.getElementById('btn-pass-rentz');
const myHandContainer = document.getElementById('my-hand');

const modalScores = document.getElementById('modal-scores');
const scoresModalBody = document.getElementById('scores-modal-body');
const modalRules = document.getElementById('modal-rules');
const modalProfileStats = document.getElementById('modal-profile-stats');
const btnOpenProfileStats = document.getElementById('btn-open-profile-stats');
const statsPlayerTitle = document.getElementById('stats-player-title');
const profileStatsBody = document.getElementById('profile-stats-body');
const modalAccountSettings = document.getElementById('modal-account-settings');
const btnOpenAccountSettings = document.getElementById('btn-open-account-settings');
const settingsAccountUsername = document.getElementById('settings-account-username');
const settingsAccountEmail = document.getElementById('settings-account-email');
const settingsCurrentNickname = document.getElementById('settings-current-nickname');
const settingsCooldownBadge = document.getElementById('settings-cooldown-badge');
const settingsCooldownHint = document.getElementById('settings-cooldown-hint');
const formChangeNickname = document.getElementById('form-change-nickname');
const inputSettingsNickname = document.getElementById('input-settings-nickname');
const btnSaveSettingsNickname = document.getElementById('btn-save-settings-nickname');

function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
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

function switchAuthView(view) {
  // view: 'login' | 'register' | 'forgot' | 'reset'
  const showTabs = view === 'login' || view === 'register';
  authTabs.classList.toggle('hidden', !showTabs);
  tabLogin.classList.toggle('active', view === 'login');
  tabRegister.classList.toggle('active', view === 'register');

  formLogin.classList.toggle('hidden', view !== 'login');
  formRegister.classList.toggle('hidden', view !== 'register');
  formForgot.classList.toggle('hidden', view !== 'forgot');
  formResetPassword.classList.toggle('hidden', view !== 'reset');
}

function syncMenuHeader() {
  displayNickname.textContent = state.user?.displayName || 'Jucător';
}

/* ==================== INIȚIALIZARE SUPABASE & SESIUNE ==================== */

async function initAuth() {
  const hashIndicatesRecovery = window.location.hash.includes('type=recovery');
  if (hashIndicatesRecovery) {
    state.inPasswordRecovery = true;
  }

  try {
    const res = await fetch('/api/auth/config');
    const cfg = await res.json();
    state.authConfigured = Boolean(cfg.configured);

    if (!state.authConfigured) {
      authSetupBanner.classList.remove('hidden');
      showScreen('auth');
      switchAuthView('login');
      return;
    }

    authSetupBanner.classList.add('hidden');
    supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        state.inPasswordRecovery = true;
        showScreen('auth');
        switchAuthView('reset');
        return;
      }

      if (session?.access_token) {
        state.accessToken = session.access_token;
        if (!state.inPasswordRecovery) {
          connectAuthenticatedSocket(session.access_token);
        }
      } else if (event === 'SIGNED_OUT') {
        state.user = null;
        state.accessToken = '';
        state.room = null;
        showScreen('auth');
        switchAuthView('login');
      }
    });

    const { data } = await supabaseClient.auth.getSession();
    if (state.inPasswordRecovery) {
      showScreen('auth');
      switchAuthView('reset');
      return;
    }

    if (data?.session?.access_token) {
      state.accessToken = data.session.access_token;
      connectAuthenticatedSocket(data.session.access_token);
    } else {
      showScreen('auth');
      switchAuthView('login');
    }
  } catch {
    showToast('Nu s-a putut încărca configurația serverului.', true);
  }
}

function connectAuthenticatedSocket(accessToken) {
  state.accessToken = accessToken;
  if (!socket.connected) {
    socket.connect();
  } else {
    emitSessionInit();
  }
}

function emitSessionInit() {
  if (!state.accessToken) return;
  socket.emit('session:init', { accessToken: state.accessToken }, (res) => {
    if (!res || !res.ok) {
      if (res?.authRequired) {
        supabaseClient?.auth.signOut();
        showScreen('auth');
        switchAuthView('login');
      }
      return;
    }
    state.user = res.user;

    // La primul login (când display_name nu a fost încă setat), cerem alegerea numelui de jucător
    if (res.needsDisplayName || res.user?.needsDisplayName) {
      inputDisplayName.value = '';
      showScreen('setupName');
      inputDisplayName.focus();
      return;
    }

    syncMenuHeader();

    if (res.reconnected && res.room) {
      handleRoomState(res.room);
    } else if (!state.room) {
      showScreen('menu');
    }
  });
}

socket.on('connect', () => {
  if (state.accessToken && !state.inPasswordRecovery) {
    emitSessionInit();
  }
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
    stopTurnTicker();
    renderLobby(room);
    showScreen('lobby');
  } else if (room.status === 'in_game' && room.game) {
    syncTurnTimerFromGame(room.game);
    renderGame(room);
    showScreen('game');
    if (!modalScores.classList.contains('hidden')) {
      renderScoresModal(room.game);
    }
  }
}

function stopTurnTicker() {
  state.turnDeadlinePerf = null;
  if (turnTickerInterval) {
    clearInterval(turnTickerInterval);
    turnTickerInterval = null;
  }
}

function syncTurnTimerFromGame(g) {
  if (typeof g.turnRemainingMs === 'number' && g.turnTotalMs) {
    state.turnDeadlinePerf = performance.now() + g.turnRemainingMs;
    state.turnTotalMs = g.turnTotalMs;
    state.turnIsAfkWarning = Boolean(g.turnIsAfkWarning);
    if (!turnTickerInterval) {
      turnTickerInterval = setInterval(updateLiveTurnTimerDOM, 200);
    }
  } else {
    stopTurnTicker();
  }
}

function getTurnTimerSnapshot() {
  if (state.turnDeadlinePerf === null) return null;
  const remMs = Math.max(0, state.turnDeadlinePerf - performance.now());
  const secs = Math.ceil(remMs / 1000);
  const displaySecs = remMs <= 50 ? 0 : secs;
  const pct = Math.max(0, Math.min(100, (remMs / (state.turnTotalMs || 30000)) * 100));
  let tone = '';
  if (state.turnIsAfkWarning) {
    tone = displaySecs <= 23 ? 'urgent' : 'warn';
  } else {
    tone = displaySecs <= 5 ? 'urgent' : displaySecs <= 10 ? 'warn' : '';
  }
  const label = state.turnIsAfkWarning ? `⏱ ${displaySecs}s (AFK la 20s)` : `⏱ ${displaySecs}s`;
  return { displaySecs, pct, tone, label };
}

function updateLiveTurnTimerDOM() {
  const snap = getTurnTimerSnapshot();
  if (!snap) return;

  document.querySelectorAll('.js-turn-timer-pill').forEach((pill) => {
    pill.textContent = snap.label;
    pill.className = `turn-timer-pill js-turn-timer-pill${snap.tone ? ` ${snap.tone}` : ''}`;
  });

  const fill = document.getElementById('active-turn-progress-fill');
  if (fill) {
    fill.style.width = `${snap.pct}%`;
    fill.className = `turn-progress-fill${snap.tone ? ` ${snap.tone}` : ''}`;
  }
}

/* ==================== EVENIMENTE AUTENTIFICARE ==================== */

tabLogin.addEventListener('click', () => switchAuthView('login'));
tabRegister.addEventListener('click', () => switchAuthView('register'));
btnGotoForgot.addEventListener('click', () => switchAuthView('forgot'));
btnBackToLogin.addEventListener('click', () => switchAuthView('login'));

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  btnSubmitLogin.disabled = true;
  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: loginIdentifier.value.trim(),
        password: loginPassword.value,
      }),
    });
    const data = await resp.json();
    if (!data.ok) {
      showToast(data.error || 'Autentificare eșuată.', true);
      return;
    }

    state.user = data.user;
    loginPassword.value = '';
    if (supabaseClient && data.session) {
      await supabaseClient.auth.setSession(data.session);
    }
    connectAuthenticatedSocket(data.session.access_token);
  } catch {
    showToast('Eroare de conexiune la autentificare.', true);
  } finally {
    btnSubmitLogin.disabled = false;
  }
});

formRegister.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (regPassword.value !== regPasswordConfirm.value) {
    showToast('Parolele introduse nu coincid!', true);
    return;
  }

  btnSubmitRegister.disabled = true;
  try {
    const resp = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: regUsername.value.trim(),
        email: regEmail.value.trim(),
        password: regPassword.value,
        redirectTo: `${window.location.origin}/`,
      }),
    });
    const data = await resp.json();
    if (!data.ok) {
      showToast(data.error || 'Înregistrare eșuată.', true);
      return;
    }

    const createdUsername = regUsername.value.trim();
    regUsername.value = '';
    regEmail.value = '';
    regPassword.value = '';
    regPasswordConfirm.value = '';

    if (data.needsEmailConfirmation) {
      showToast(
        'Cont creat! Verifică adresa de email pentru confirmare, apoi autentifică-te.',
        false
      );
    } else {
      showToast(
        'Contul a fost creat cu succes! Autentifică-te acum pentru a-ți alege numele de jucător.',
        false
      );
    }

    loginIdentifier.value = createdUsername;
    switchAuthView('login');
    loginPassword.focus();
  } catch {
    showToast('Eroare de conexiune la înregistrare.', true);
  } finally {
    btnSubmitRegister.disabled = false;
  }
});

formSetupName.addEventListener('submit', async (e) => {
  e.preventDefault();
  const chosen = inputDisplayName.value.trim().replace(/\s+/g, ' ');
  if (chosen.length < 2) {
    showToast('Numele de jucător trebuie să aibă cel puțin 2 caractere.', true);
    return;
  }

  btnSubmitDisplayName.disabled = true;
  try {
    const resp = await fetch('/api/auth/display-name', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.accessToken}`,
      },
      body: JSON.stringify({ displayName: chosen }),
    });
    const data = await resp.json();
    if (!data.ok) {
      showToast(data.error || 'Nu s-a putut salva numele de jucător.', true);
      return;
    }

    state.user = data.user;
    showToast(`Numele tău de jucător (${data.user.displayName}) a fost salvat!`, false);
    emitSessionInit();
  } catch {
    showToast('Eroare de conexiune la salvarea numelui.', true);
  } finally {
    btnSubmitDisplayName.disabled = false;
  }
});

async function performLogout() {
  socket.emit('session:logout', {}, async () => {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    state.user = null;
    state.accessToken = '';
    state.room = null;
    showScreen('auth');
    switchAuthView('login');
  });
}

btnSetupLogout.addEventListener('click', performLogout);

formForgot.addEventListener('submit', async (e) => {
  e.preventDefault();
  btnSubmitForgot.disabled = true;
  try {
    const resp = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: forgotIdentifier.value.trim(),
        redirectTo: `${window.location.origin}/`,
      }),
    });
    const data = await resp.json();
    if (!data.ok) {
      showToast(data.error || 'Nu s-a putut trimite emailul de resetare.', true);
      return;
    }
    showToast(data.message, false);
    forgotIdentifier.value = '';
    switchAuthView('login');
  } catch {
    showToast('Eroare de conexiune.', true);
  } finally {
    btnSubmitForgot.disabled = false;
  }
});

formResetPassword.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (resetNewPassword.value.length < 6) {
    showToast('Parola nouă trebuie să aibă cel puțin 6 caractere.', true);
    return;
  }
  if (resetNewPassword.value !== resetConfirmPassword.value) {
    showToast('Parolele nu coincid!', true);
    return;
  }
  if (!supabaseClient) return;

  btnSubmitReset.disabled = true;
  try {
    const { error } = await supabaseClient.auth.updateUser({
      password: resetNewPassword.value,
    });
    if (error) {
      showToast(error.message || 'Nu s-a putut actualiza parola.', true);
      return;
    }

    state.inPasswordRecovery = false;
    resetNewPassword.value = '';
    resetConfirmPassword.value = '';
    window.history.replaceState({}, document.title, window.location.pathname);
    showToast('Parola a fost schimbată cu succes!', false);

    const { data } = await supabaseClient.auth.getSession();
    if (data?.session?.access_token) {
      connectAuthenticatedSocket(data.session.access_token);
    } else {
      switchAuthView('login');
    }
  } catch {
    showToast('Eroare la salvarea noii parole.', true);
  } finally {
    btnSubmitReset.disabled = false;
  }
});

btnLogout.addEventListener('click', performLogout);

/* ==================== ECRAN 2: MENIU CAMERE ==================== */

btnCreateRoom.addEventListener('click', () => {
  btnCreateRoom.disabled = true;
  socket.emit('room:create', {}, (res) => {
    btnCreateRoom.disabled = false;
    if (!res || !res.ok) {
      showToast(res?.error || 'Nu s-a putut crea camera.', true);
      return;
    }
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
  socket.emit('room:join', { code }, (res) => {
    if (!res || !res.ok) {
      showToast(res?.error || 'Nu s-a putut intra în cameră.', true);
      return;
    }
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
  const myId = state.user?.id;
  lobbyRoomCode.textContent = room.code;
  lobbyCountBadge.textContent = `Jucători: ${room.players.length} / ${room.maxPlayers} (minim ${room.minPlayers})`;

  lobbyPlayersGrid.innerHTML = '';
  for (let i = 0; i < room.maxPlayers; i++) {
    const p = room.players[i];
    const seat = document.createElement('div');

    if (p) {
      seat.className = `lobby-seat${p.ready ? ' ready' : ''}`;
      const isMe = p.id === myId;
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

  const me = room.players.find((p) => p.id === myId);
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

  const id = subgame.id;
  const badges = [];

  if (id === 'whist' || id === 'totals_plus') {
    badges.push(
      `<span class="mini-chip${p.tricksWon > 0 ? ' good-chip' : ''}">Mâini: ${p.tricksWon}</span>`
    );
  } else if (id === 'no_tricks' || id === 'totals_minus') {
    badges.push(
      `<span class="mini-chip${p.tricksWon > 0 ? ' danger-chip' : ''}">Mâini: ${p.tricksWon}</span>`
    );
  } else {
    badges.push(`<span class="mini-chip">Mâini: ${p.tricksWon}</span>`);
  }

  if ((id === 'king_of_hearts' || id === 'totals_minus') && p.captured.hasKingOfHearts) {
    badges.push('<span class="mini-chip danger-chip">K♥</span>');
  }
  if ((id === 'ten_of_clubs' || id === 'totals_plus') && p.captured.hasTenOfClubs) {
    badges.push('<span class="mini-chip good-chip">10♣</span>');
  }
  if (p.captured.queensCount > 0) {
    if (id === 'queens' || id === 'totals_minus') {
      badges.push(`<span class="mini-chip danger-chip">Q×${p.captured.queensCount}</span>`);
    } else if (id === 'totals_plus') {
      badges.push(`<span class="mini-chip good-chip">Q×${p.captured.queensCount}</span>`);
    }
  }
  if (p.captured.diamondsCount > 0) {
    if (id === 'diamonds' || id === 'totals_minus') {
      badges.push(`<span class="mini-chip danger-chip">♦×${p.captured.diamondsCount}</span>`);
    } else if (id === 'totals_plus') {
      badges.push(`<span class="mini-chip good-chip">♦×${p.captured.diamondsCount}</span>`);
    }
  }

  return badges.join('');
}

function renderGame(room) {
  const g = room.game;
  const myId = state.user?.id;

  hudRound.textContent = `Runda ${g.roundNumber} / ${g.totalRounds}`;
  if (g.currentSubgame) {
    hudSubgame.textContent = `${g.currentSubgame.badge} ${g.currentSubgame.name}`;
    hudSubgame.className = `hud-pill hud-subgame ${
      g.currentSubgame.type === 'negative' ? 'neg' : 'pos'
    }`;
  } else if (g.phase === 'deciding_blind') {
    hudSubgame.textContent = 'Pe Văzute / Pe Nevăzute...';
    hudSubgame.className = 'hud-pill hud-subgame';
  } else {
    hudSubgame.textContent = 'Alegere sub-joc...';
    hudSubgame.className = 'hud-pill hud-subgame';
  }
  hudBlind.classList.toggle('hidden', !g.isBlind);
  hudBanner.textContent = g.statusBanner || '';

  const rotated = getRotatedPlayers(g.players, myId);
  const me = rotated[0];
  const opponents = rotated.slice(1);

  const timerSnap = getTurnTimerSnapshot();

  opponentsRing.innerHTML = '';
  for (const opp of opponents) {
    const isTurn = g.currentTurnPlayerId === opp.id;
    const isChooser = g.chooserId === opp.id;
    const scoreClass = opp.score > 0 ? 'pos' : opp.score < 0 ? 'neg' : '';
    const seatEl = document.createElement('div');
    seatEl.className = `opponent-seat${isTurn ? ' active-turn' : ''}`;
    const timerBadgeHtml =
      isTurn && timerSnap
        ? `<span class="turn-timer-pill js-turn-timer-pill${
            timerSnap.tone ? ` ${timerSnap.tone}` : ''
          }">${escapeHtml(timerSnap.label)}</span>`
        : '';
    const timerBarHtml =
      isTurn && timerSnap
        ? `<div class="turn-progress-track"><div id="active-turn-progress-fill" class="turn-progress-fill${
            timerSnap.tone ? ` ${timerSnap.tone}` : ''
          }" style="width:${timerSnap.pct}%"></div></div>`
        : '';
    const seatStateChip = opp.isBot
      ? '<span class="mini-chip bot-chip">🤖 Bot</span>'
      : opp.isAfk
      ? '<span class="mini-chip afk-chip">💤 AFK (Bot)</span>'
      : !opp.connected
      ? '<span class="mini-chip danger-chip">Deconectat</span>'
      : '';

    seatEl.innerHTML = `
      <div class="seat-top-line">
        <span>${escapeHtml(opp.nickname)}</span>
        <span class="seat-score ${scoreClass}">${opp.score}p</span>
      </div>
      <div class="seat-meta-line">
        <span class="mini-chip">🂠 ${opp.cardCount}</span>
        ${seatStateChip}
        ${isChooser ? '<span class="mini-chip">Alege</span>' : ''}
        ${isTurn ? '<span class="mini-chip turn-chip">La rând</span>' : ''}
        ${timerBadgeHtml}
        ${renderCapturedBadges(opp, g.currentSubgame)}
      </div>
      ${timerBarHtml}
    `;
    opponentsRing.appendChild(seatEl);
  }

  if (me) {
    afkResumeBanner.classList.toggle('hidden', !me.isAfk);
    const myTurn = g.currentTurnPlayerId === me.id && !me.isAfk;
    const myScoreClass = me.score > 0 ? 'pos' : me.score < 0 ? 'neg' : '';
    const myTimerHtml =
      myTurn && timerSnap
        ? `<span class="turn-timer-pill js-turn-timer-pill${
            timerSnap.tone ? ` ${timerSnap.tone}` : ''
          }">${escapeHtml(timerSnap.label)}</span>`
        : '';
    mySeatBar.className = `my-seat-bar${myTurn ? ' my-turn' : ''}`;
    mySeatBar.innerHTML = `
      <strong>${escapeHtml(me.nickname)} (Tu)</strong>
      <span class="seat-score ${myScoreClass}">Scor: ${me.score}p</span>
      ${me.isAfk ? '<span class="mini-chip afk-chip">💤 Mod AFK</span>' : ''}
      ${g.chooserId === me.id ? '<span class="mini-chip">Alegătorul rundei</span>' : ''}
      ${myTurn ? '<span class="mini-chip turn-chip">Este rândul tău!</span>' : ''}
      ${myTimerHtml}
      ${renderCapturedBadges(me, g.currentSubgame)}
    `;
  }

  if (g.lastTrick && (g.phase === 'playing_tricks' || g.phase === 'trick_complete')) {
    lastTrickBox.classList.remove('hidden');
    const cardsHtml = g.lastTrick.cards
      .map((entry) => {
        const col = isRedSuit(entry.card.suit) ? 'suit-red' : 'suit-black';
        return `<span class="${col}">${entry.card.label}${entry.card.symbol}</span>`;
      })
      .join(' ');
    const breakdownHint = g.lastTrick.breakdown ? ` (${escapeHtml(g.lastTrick.breakdown)})` : '';
    const lastPts = g.lastTrick.points
      ? ` · <strong>${formatSigned(g.lastTrick.points)}p</strong>${breakdownHint}`
      : '';
    lastTrickBox.innerHTML = `
      <div>Ultima mână (${escapeHtml(g.lastTrick.winnerName)}${lastPts}):</div>
      <div class="last-trick-cards">${cardsHtml}</div>
    `;
  } else {
    lastTrickBox.classList.add('hidden');
  }

  renderTableCenter(g, me);
  rentzPassRow.classList.toggle('hidden', Boolean(!g.canPassRentz || me?.isAfk));
  renderMyHand(g, me);
}

function scaleSubgameDesc(shortDesc, multiplier) {
  if (multiplier <= 1) return shortDesc;
  return shortDesc.replace(/([+-]?\d+)/g, (match, numStr, offset, full) => {
    // Nu dublăm cifrele care fac parte din numele cărții/locului (ex. "10♣", "Loc 1", "Loc 2", "Loc 3")
    const after = full.slice(offset + match.length);
    const before = full.slice(Math.max(0, offset - 4), offset);
    if (after.startsWith('♣') || before.endsWith('Loc ')) {
      return match;
    }
    const n = parseInt(numStr, 10);
    const doubled = n * multiplier;
    return match.startsWith('+') ? `+${doubled}` : String(doubled);
  });
}

function renderTableCenter(g, me) {
  const myId = state.user?.id;
  const timerSnap = getTurnTimerSnapshot();
  const centerTimerHtml = timerSnap
    ? ` <span class="turn-timer-pill js-turn-timer-pill${
        timerSnap.tone ? ` ${timerSnap.tone}` : ''
      }">${escapeHtml(timerSnap.label)}</span>`
    : '';
  tableCenter.innerHTML = '';

  if (g.phase === 'deciding_blind') {
    if (g.chooserId === myId && me) {
      const box = document.createElement('div');
      box.className = 'blind-mode-picker';
      const remainingChips = g.subgamesCatalog
        .filter((s) => me.availableSubgames.includes(s.id))
        .map((s) => `<span class="mini-chip">${escapeHtml(s.badge)} ${escapeHtml(s.name)}</span>`)
        .join('');

      box.innerHTML = `
        <div class="picker-title">Este rândul tău să alegi modul și jocul!${centerTimerHtml}</div>
        <p class="subgame-desc">Jocurile tale rămase disponibile:</p>
        <div class="avail-chips" style="margin-bottom: 12px">${remainingChips}</div>
        <div class="blind-mode-grid">
          <button type="button" id="btn-choose-seen" class="blind-choice-btn">
            <span class="blind-choice-title">👁️ Pe Văzute (×1)</span>
            <span class="blind-choice-desc">Îți vezi mai întâi cele 8 cărți, apoi alegi jocul la punctaj normal.</span>
          </button>
          <button type="button" id="btn-choose-blind" class="blind-choice-btn blind-double">
            <span class="blind-choice-title">🔥 Pe Nevăzute (×2)</span>
            <span class="blind-choice-desc">Alegi mai întâi jocul fără să îți vezi cărțile — punctajul se dublează!</span>
          </button>
        </div>
      `;
      tableCenter.appendChild(box);

      document.getElementById('btn-choose-seen')?.addEventListener('click', () => {
        socket.emit('game:choose_blind_mode', { blind: false }, (res) => {
          if (res && !res.ok) showToast(res.error, true);
        });
      });
      document.getElementById('btn-choose-blind')?.addEventListener('click', () => {
        socket.emit('game:choose_blind_mode', { blind: true }, (res) => {
          if (res && !res.ok) showToast(res.error, true);
        });
      });
    } else {
      const chooser = g.players.find((p) => p.id === g.chooserId);
      const box = document.createElement('div');
      box.className = 'waiting-chooser-box';
      const remainingNames = g.subgamesCatalog
        .filter((s) => chooser?.availableSubgames.includes(s.id))
        .map((s) => `<span class="mini-chip">${escapeHtml(s.badge)} ${escapeHtml(s.name)}</span>`)
        .join('');
      box.innerHTML = `
        <h3>${escapeHtml(chooser?.nickname || 'Jucătorul')} decide modul rundei...</h3>
        <p class="subgame-desc">Alege între <strong>Pe Văzute (×1)</strong> și <strong>Pe Nevăzute (×2)</strong>.</p>
        <div class="avail-chips">${remainingNames}</div>
      `;
      tableCenter.appendChild(box);
    }
    return;
  }

  if (g.phase === 'choosing_subgame') {
    if (g.chooserId === myId && me) {
      const box = document.createElement('div');
      box.className = 'subgame-picker';
      const pickerHeading = g.isBlind
        ? `🔥 PE NEVĂZUTE (Punctaj Dublu ×2) — Alege sub-jocul:${centerTimerHtml}`
        : `Privește-ți cărțile de jos și alege sub-jocul rundei (×1):${centerTimerHtml}`;
      box.innerHTML = `<div class="picker-title">${pickerHeading}</div>`;
      const grid = document.createElement('div');
      grid.className = 'subgame-grid';

      for (const sub of g.subgamesCatalog) {
        const available = me.availableSubgames.includes(sub.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `subgame-btn ${sub.type}`;
        btn.disabled = !available;
        const descText = available
          ? scaleSubgameDesc(sub.shortDesc, g.scoreMultiplier || 1)
          : 'Deja ales de tine';
        btn.innerHTML = `
          <div class="subgame-btn-top">
            <span>${escapeHtml(sub.name)}</span>
            <span class="subgame-badge">${available ? escapeHtml(sub.badge) : '✓'}</span>
          </div>
          <div class="subgame-desc">${escapeHtml(descText)}</div>
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
      const modeTag = g.isBlind ? '🔥 PE NEVĂZUTE (×2)' : 'Pe Văzute (×1)';
      box.innerHTML = `
        <h3>${escapeHtml(chooser?.nickname || 'Jucătorul')} alege sub-jocul (${modeTag})...</h3>
        <p class="subgame-desc">Sub-jocuri disponibile pentru ${escapeHtml(
          chooser?.nickname || ''
        )}:</p>
        <div class="avail-chips">${remainingNames}</div>
      `;
      tableCenter.appendChild(box);
    }
    return;
  }

  if (g.phase === 'checking_rentz_refusal') {
    if (g.currentTurnPlayerId === myId && me) {
      const box = document.createElement('div');
      box.className = 'blind-mode-picker';
      const chooser = g.players.find((p) => p.id === g.chooserId);
      const explainHtml = g.isBlind
        ? `Se joacă <strong>Rentz PE NEVĂZUTE (×2)</strong>. Dacă alegi să refuzi, se va da <strong>reshuffle la cărți</strong> și se va juca tot Rentz (×2).`
        : `Se joacă <strong>Rentz Pe Văzute (×1)</strong>. Dacă alegi să refuzi, se dă <strong>reshuffle la cărți</strong> și ${escapeHtml(
            chooser?.nickname || 'alegătorul'
          )} va putea alege din nou jocul (tot Pe Văzute).`;

      const refuseTitle = g.isBlind
        ? '🔄 Nu continua (Reshuffle Rentz ×2)'
        : '🔄 Nu juca (Reshuffle & Schimbare Joc)';
      const refuseDesc = g.isBlind
        ? 'Se reîmpart cărțile pentru toți și rămâne tot Rentz la dublu.'
        : 'Se reîmpart cărțile, iar alegătorul poate păstra sau schimba jocul.';

      box.innerHTML = `
        <div class="picker-title">Ai ${g.myCapeteCount} capete în mână (Ași / ${escapeHtml(
        g.minRankLabel
      )})!${centerTimerHtml}</div>
        <p class="subgame-desc" style="margin-bottom: 12px">${explainHtml}</p>
        <div class="blind-mode-grid">
          <button type="button" id="btn-rentz-refuse" class="blind-choice-btn blind-double">
            <span class="blind-choice-title">${refuseTitle}</span>
            <span class="blind-choice-desc">${refuseDesc}</span>
          </button>
          <button type="button" id="btn-rentz-continue" class="blind-choice-btn">
            <span class="blind-choice-title">▶ Continuă Jocul</span>
            <span class="blind-choice-desc">Păstrează cărțile actuale din mână și începe runda de Rentz.</span>
          </button>
        </div>
      `;
      tableCenter.appendChild(box);

      document.getElementById('btn-rentz-refuse')?.addEventListener('click', () => {
        socket.emit('game:decide_rentz_refusal', { refuse: true }, (res) => {
          if (res && !res.ok) showToast(res.error, true);
        });
      });
      document.getElementById('btn-rentz-continue')?.addEventListener('click', () => {
        socket.emit('game:decide_rentz_refusal', { refuse: false }, (res) => {
          if (res && !res.ok) showToast(res.error, true);
        });
      });
    } else {
      const decidingPlayer = g.players.find((p) => p.id === g.currentTurnPlayerId);
      const box = document.createElement('div');
      box.className = 'waiting-chooser-box';
      box.innerHTML = `
        <h3>${escapeHtml(decidingPlayer?.nickname || 'Un jucător')} are ${
        g.minCapeteForRefusal || 4
      }+ capete!${centerTimerHtml}</h3>
        <p class="subgame-desc">Decide dacă joacă cu cărțile din mână sau cere reîmpărțirea cărților...</p>
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
        const isWinner = g.trickWinnerId === entry.playerId;
        const slot = document.createElement('div');
        slot.className = `played-card-slot${isWinner ? ' winner' : ''}`;
        if (isWinner && g.lastTrickPoints) {
          const pop = document.createElement('div');
          pop.className = `trick-pts-pop ${g.lastTrickPoints > 0 ? 'pos' : 'neg'}`;
          pop.textContent = g.lastTrickBreakdown
            ? `${formatSigned(g.lastTrickPoints)}p (${g.lastTrickBreakdown})`
            : `${formatSigned(g.lastTrickPoints)} pct`;
          slot.appendChild(pop);
        }
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
            <td>${escapeHtml(p.nickname)}</td>
            <td class="${dColor}">${formatSigned(d)}</td>
            <td><strong>${s.totalsAfter[p.id]}</strong></td>
          </tr>
        `;
      })
      .join('');

    const blindBadge = s.isBlind ? ' 🔥 (Pe Nevăzute ×2)' : '';
    panel.innerHTML = `
      <h3>Runda ${s.roundNumber} încheiată — ${escapeHtml(s.subgameName)}${blindBadge}</h3>
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
      <p class="subgame-desc">Trecere automată la alegerea următorului joc...</p>
    `;

    tableCenter.appendChild(panel);
    return;
  }

  if (g.phase === 'game_over') {
    const panel = document.createElement('div');
    panel.className = 'summary-panel';
    const medals = ['🥇', '🥈', '🥉'];
    const rowsHtml = g.standings
      .map((st, idx) => {
        const medal = medals[idx] || `${idx + 1}.`;
        const zeroBadge = st.isZeroWinner
          ? ' <span class="mini-chip turn-chip">🎯 0 Exact!</span>'
          : '';
        return `
          <tr>
            <td>${medal} <strong>${escapeHtml(st.nickname)}</strong>${zeroBadge}</td>
            <td></td>
            <td><strong>${st.score} pct</strong></td>
          </tr>
        `;
      })
      .join('');

    const topEntry = g.standings[0];
    const winners = g.standings.filter((st) =>
      topEntry?.isZeroWinner ? st.isZeroWinner : st.score === topEntry?.score
    );
    const winnersNames = winners.map((w) => escapeHtml(w.nickname)).join(', ');
    const zeroNote = topEntry?.isZeroWinner ? ' — Victorie specială cu 0 puncte exact!' : '';

    panel.innerHTML = `
      <h3>🏆 Partidă Încheiată!</h3>
      <p class="summary-reason">Câștigător: <strong>${winnersNames}</strong>${zeroNote}</p>
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
      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap">
        <button id="btn-gameover-stats" type="button" class="btn btn-outline">
          📊 Vezi Statistici
        </button>
        <button id="btn-back-lobby" type="button" class="btn btn-primary">
          Înapoi în Lobby (Joc Nou)
        </button>
      </div>
    `;

    tableCenter.appendChild(panel);
    document.getElementById('btn-gameover-stats')?.addEventListener('click', () => {
      openProfileStatsModal();
    });
    document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
      socket.emit('room:return_to_lobby', {}, (res) => {
        if (res && !res.ok) showToast(res.error, true);
      });
    });
  }
}

function renderMyHand(g, me) {
  myHandContainer.innerHTML = '';

  // Dacă suntem înainte de dezvăluirea cărților (alegere Pe Văzute / Pe Nevăzute), afișăm cărțile cu fața în jos
  if (!g.cardsRevealed && g.hiddenHandCount > 0) {
    for (let i = 0; i < g.hiddenHandCount; i++) {
      myHandContainer.appendChild(createFaceDownCardElement());
    }
    return;
  }

  const isAfk = Boolean(me?.isAfk);
  const isActionPhase = g.phase === 'playing_tricks' || g.phase === 'playing_rentz';
  const isMyTurn = !isAfk && g.currentTurnPlayerId === state.user?.id;
  const playableSet = new Set(g.playableCardIds || []);
  const highlightCapete =
    g.phase === 'checking_rentz_refusal' && g.currentTurnPlayerId === state.user?.id;

  for (const card of g.myHand) {
    const playable = isActionPhase && isMyTurn && playableSet.has(card.id);
    const disabled = isAfk || (isActionPhase && isMyTurn && !playableSet.has(card.id));

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
    if (highlightCapete && (card.value === 14 || card.value === g.minRank)) {
      cardEl.classList.add('capat-highlight');
    }
    myHandContainer.appendChild(cardEl);
  }
}

btnResumeAfk.addEventListener('click', () => {
  socket.emit('game:resume_from_afk', {}, (res) => {
    if (res && !res.ok) {
      showToast(res.error || 'Nu s-a putut relua jocul.', true);
    } else {
      showToast('Ai revenit în joc!', false);
    }
  });
});

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
      const blindLabel = h.isBlind ? ' <span class="mini-chip turn-chip">×2</span>' : '';
      return `
        <tr>
          <td>#${h.roundNumber} — <strong>${escapeHtml(h.subgameName)}</strong>${blindLabel} (${escapeHtml(
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
  if (
    !window.confirm(
      'Sigur vrei să părăsești meciul? Jocul va continua pentru ceilalți jucători, iar locul și scorul tău vor fi preluate de un Bot.'
    )
  ) {
    return;
  }
  socket.emit('room:leave', {}, () => {
    state.room = null;
    stopTurnTicker();
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

[modalScores, modalRules, modalAccountSettings, modalProfileStats].forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.add('hidden');
  });
});

let cachedProfileStats = null;
let activeStatsTab = 'overview';

function buildEvolutionSvg(evolution) {
  if (!evolution || evolution.length === 0) {
    return `<p class="settings-hint">Joacă primul tău meci complet pentru a vedea graficul de evoluție a punctajului!</p>`;
  }

  const width = 760;
  const height = 165;
  const padX = 42;
  const padY = 24;

  const scores = evolution.map((e) => e.score);
  const minVal = Math.min(0, ...scores);
  const maxVal = Math.max(100, ...scores);
  const span = Math.max(100, maxVal - minVal);

  const toX = (idx) =>
    evolution.length === 1
      ? width / 2
      : padX + (idx / (evolution.length - 1)) * (width - padX * 2);
  const toY = (val) =>
    height - padY - ((val - minVal) / span) * (height - padY * 2);

  const zeroY = toY(0);
  const pointsAttr = evolution.map((e, i) => `${toX(i).toFixed(1)},${toY(e.score).toFixed(1)}`).join(' ');

  const circlesHtml = evolution
    .map((e, i) => {
      const cx = toX(i).toFixed(1);
      const cy = toY(e.score).toFixed(1);
      const fill = e.isWinner ? '#f7d683' : e.score >= 0 ? '#26b877' : '#e04856';
      const dateShort = new Date(e.createdAt).toLocaleDateString('ro-RO', {
        day: '2-digit',
        month: '2-digit',
      });
      const tip = `Meci #${e.index} (${dateShort}) — Locul ${e.place} · ${formatSigned(e.score)} pct`;
      return `
        <g>
          <title>${escapeHtml(tip)}</title>
          <circle cx="${cx}" cy="${cy}" r="5" fill="${fill}" stroke="#091712" stroke-width="2" />
          <text x="${cx}" y="${Math.max(13, cy - 9)}" text-anchor="middle" fill="#dce8e2" font-size="10" font-family="JetBrains Mono, monospace">${formatSigned(
        e.score
      )}</text>
        </g>
      `;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="evolution-svg" role="img" aria-label="Evoluție scoruri">
      <line x1="${padX}" y1="${zeroY.toFixed(1)}" x2="${width - padX}" y2="${zeroY.toFixed(
    1
  )}" stroke="rgba(255,255,255,0.22)" stroke-dasharray="4 4" />
      <text x="8" y="${(zeroY + 4).toFixed(
        1
      )}" fill="rgba(255,255,255,0.45)" font-size="10" font-family="JetBrains Mono, monospace">0p</text>
      ${
        evolution.length > 1
          ? `<polyline fill="none" stroke="#eabf60" stroke-width="2.5" points="${pointsAttr}" />`
          : ''
      }
      ${circlesHtml}
    </svg>
  `;
}

function renderProfileStatsTab() {
  if (!cachedProfileStats) return;
  const { overview: o, evolution, recentMatches, headToHead, leaderboard } = cachedProfileStats;

  document.querySelectorAll('.stats-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-stats-tab') === activeStatsTab);
  });

  if (activeStatsTab === 'overview') {
    const rivalsHtml =
      headToHead && headToHead.length > 0
        ? `<table class="summary-table" style="margin-bottom:0">
            <thead>
              <tr>
                <th>Adversar frecvent</th>
                <th>Meciuri comune</th>
                <th>Palmares direct (Tu vs El)</th>
              </tr>
            </thead>
            <tbody>
              ${headToHead
                .map(
                  (r) => `
                <tr>
                  <td><strong>${escapeHtml(r.displayName)}</strong></td>
                  <td>${r.sharedMatches}</td>
                  <td><span class="suit-black">${r.finishedAhead}W</span> – <span class="suit-red">${r.finishedBehind}L</span></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>`
        : `<p class="settings-hint">Palmaresul direct cu prietenii va apărea după primele meciuri finalizate împreună.</p>`;

    profileStatsBody.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">Meciuri Jucate</span>
          <span class="kpi-value">${o.totalMatches}</span>
          <span class="kpi-sub">Podium (Top 3): ${o.podiums}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Locul 1 (Victorii)</span>
          <span class="kpi-value gold">🏆 ${o.wins}</span>
          <span class="kpi-sub">Rată de câștig: ${o.winRate}%</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Cel Mai Mare Scor</span>
          <span class="kpi-value pos">${o.totalMatches ? formatSigned(o.bestScore) : '0'}p</span>
          <span class="kpi-sub">Minim: ${o.totalMatches ? formatSigned(o.worstScore) : '0'}p</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Scor Mediu / Meci</span>
          <span class="kpi-value ${o.avgScore >= 0 ? 'pos' : 'neg'}">${formatSigned(o.avgScore)}p</span>
          <span class="kpi-sub">Total acumulat: ${formatSigned(o.totalScore)}p</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Serie Victorii</span>
          <span class="kpi-value gold">🔥 ${o.currentWinStreak}</span>
          <span class="kpi-sub">Record serie: ${o.bestWinStreak} la rând</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Victorii cu „0 Exact!”</span>
          <span class="kpi-value gold">🎯 ${o.zeroWins}</span>
          <span class="kpi-sub">Regula specială de 0 puncte</span>
        </div>
      </div>

      <div class="evolution-card">
        <div class="settings-title-row">
          <h4 class="settings-section-title">📈 Evoluția Scorului (Ultimele ${evolution.length} meciuri)</h4>
          <span class="kpi-sub">Treci cu mouse-ul peste puncte pentru detalii</span>
        </div>
        ${buildEvolutionSvg(evolution)}
      </div>

      <div class="fun-stats-grid">
        <div class="settings-section">
          <h4 class="settings-section-title">🎲 Curaj „Pe Nevăzute (×2)”</h4>
          <p class="settings-hint">
            Ai ales <strong>${o.blindRoundsChosen}</strong> runde Pe Nevăzute, cu un bilanț net în acele runde de
            <strong>${formatSigned(o.blindNetPoints)} pct</strong>.
          </p>
        </div>
        <div class="settings-section">
          <h4 class="settings-section-title">🃏 Cărți Speciale (K♥ vs 10♣)</h4>
          <p class="settings-hint">
            🍀 <strong>10♣</strong> câștigați: <strong>${o.tenOfClubsTaken}</strong> &nbsp;·&nbsp;
            👑 <strong>K♥</strong> încasați: <strong>${o.kingOfHeartsTaken}</strong>
          </p>
        </div>
      </div>

      <div class="settings-section">
        <h4 class="settings-section-title">⚔️ Palmares Direct cu Prietenii</h4>
        ${rivalsHtml}
      </div>
    `;
    return;
  }

  if (activeStatsTab === 'history') {
    if (!recentMatches || recentMatches.length === 0) {
      profileStatsBody.innerHTML = `<p class="settings-hint">Nu ai încă niciun meci finalizat în istoric. Ultimele 20 de partide vor apărea automat aici!</p>`;
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const cardsHtml = recentMatches
      .map((m) => {
        const dt = new Date(m.createdAt).toLocaleString('ro-RO', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const myMedal = m.myPlace ? medals[m.myPlace - 1] || `#${m.myPlace}` : '-';
        const zeroTag = m.myIsZeroWinner
          ? ' <span class="mini-chip turn-chip">🎯 0 Exact!</span>'
          : '';
        const myScoreClass = m.myScore >= 0 ? 'pos' : 'neg';

        const pillsHtml = m.players
          .map((pl) => {
            const pm = medals[pl.place - 1] || `${pl.place}.`;
            const z = pl.isZeroWinner ? ' 🎯' : '';
            const b = pl.wasBot ? ' 🤖' : '';
            return `<span class="match-player-pill${pl.isMe ? ' me' : ''}">${pm} <strong>${escapeHtml(
              pl.displayName
            )}</strong>: ${formatSigned(pl.finalScore)}p${z}${b}</span>`;
          })
          .join('');

        return `
          <div class="match-history-card${m.myIsWinner ? ' won' : ''}">
            <div class="match-history-top">
              <div>
                <strong>${myMedal} Locul ${m.myPlace || '-'}</strong>${zeroTag}
                &nbsp;·&nbsp;
                <span class="seat-score ${myScoreClass}">${formatSigned(m.myScore)} pct</span>
              </div>
              <span class="match-history-meta">${dt} · ${m.numPlayers} jucători (${m.totalRounds} runde)</span>
            </div>
            <div class="match-players-pills">${pillsHtml}</div>
          </div>
        `;
      })
      .join('');

    profileStatsBody.innerHTML = `<div class="match-history-list">${cardsHtml}</div>`;
    return;
  }

  if (activeStatsTab === 'leaderboard') {
    if (!leaderboard || leaderboard.length === 0) {
      profileStatsBody.innerHTML = `<p class="settings-hint">Clasamentul general se va popula automat după primul meci încheiat!</p>`;
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const rowsHtml = leaderboard
      .map((item, idx) => {
        const medal = medals[idx] || `${idx + 1}.`;
        return `
          <tr>
            <td>${medal} <strong>${escapeHtml(item.displayName)}</strong>${
          item.isMe ? ' <span class="tag-badge">Tu</span>' : ''
        }</td>
            <td style="text-align:right"><strong>${item.wins}</strong> (${item.winRate}%) &nbsp;·&nbsp; ${
          item.matches
        } meciuri</td>
            <td><strong>${formatSigned(item.totalScore)}p</strong> <span class="kpi-sub">(max ${formatSigned(
          item.bestScore
        )}p)</span></td>
          </tr>
        `;
      })
      .join('');

    profileStatsBody.innerHTML = `
      <table class="summary-table">
        <thead>
          <tr>
            <th>Jucător</th>
            <th>Victorii / Meciuri</th>
            <th>Puncte Totale (Record)</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }
}

async function openProfileStatsModal(defaultTab = 'overview') {
  activeStatsTab = defaultTab;
  statsPlayerTitle.textContent = state.user?.displayName || 'Jucător';
  profileStatsBody.innerHTML = `<p class="settings-hint">Se încarcă statisticile profilului...</p>`;
  modalProfileStats.classList.remove('hidden');

  try {
    const resp = await fetch('/api/stats/me', {
      headers: {
        Authorization: `Bearer ${state.accessToken}`,
      },
    });
    const data = await resp.json();
    if (!data.ok) {
      profileStatsBody.innerHTML = `<p class="settings-hint">${escapeHtml(
        data.error || 'Nu s-au putut încărca statisticile.'
      )}</p>`;
      return;
    }
    cachedProfileStats = data;
    renderProfileStatsTab();
  } catch {
    profileStatsBody.innerHTML = `<p class="settings-hint">Eroare de conexiune la încărcarea statisticilor.</p>`;
  }
}

btnOpenProfileStats.addEventListener('click', () => {
  openProfileStatsModal('overview');
});

document.querySelectorAll('.stats-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeStatsTab = btn.getAttribute('data-stats-tab') || 'overview';
    renderProfileStatsTab();
  });
});

function formatRemainingTimeRo(nextIso) {
  const diffMs = Math.max(0, new Date(nextIso).getTime() - Date.now());
  const totalHours = Math.ceil(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0 && hours > 0) {
    return `${days} ${days === 1 ? 'zi' : 'zile'} și ${hours} ${hours === 1 ? 'oră' : 'ore'}`;
  }
  if (days > 0) {
    return `${days} ${days === 1 ? 'zi' : 'zile'}`;
  }
  return `${Math.max(1, hours)} ${hours === 1 ? 'oră' : 'ore'}`;
}

function renderAccountSettingsModal() {
  const u = state.user;
  if (!u) return;

  settingsAccountUsername.textContent = u.accountUsername || '-';
  settingsAccountEmail.textContent = u.email || '-';
  settingsCurrentNickname.textContent = u.displayName || '-';
  inputSettingsNickname.value = '';

  const nextIso = u.nextDisplayNameChangeAt;
  const isLocked = Boolean(nextIso && new Date(nextIso).getTime() > Date.now());

  if (isLocked) {
    const remaining = formatRemainingTimeRo(nextIso);
    const formattedDate = new Date(nextIso).toLocaleString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    settingsCooldownBadge.textContent = `Blocat (${remaining})`;
    settingsCooldownBadge.className = 'cooldown-badge locked';
    settingsCooldownHint.textContent = `Ai schimbat recent nickname-ul. Îl vei putea modifica din nou peste ${remaining} (pe ${formattedDate}).`;
    inputSettingsNickname.disabled = true;
    btnSaveSettingsNickname.disabled = true;
  } else {
    const days = u.cooldownDays || 5;
    settingsCooldownBadge.textContent = 'Disponibil acum';
    settingsCooldownBadge.className = 'cooldown-badge available';
    settingsCooldownHint.textContent = `Poți schimba nickname-ul acum. După salvare, următoarea modificare va fi disponibilă peste ${days} zile.`;
    inputSettingsNickname.disabled = false;
    btnSaveSettingsNickname.disabled = false;
  }
}

btnOpenAccountSettings.addEventListener('click', () => {
  renderAccountSettingsModal();
  modalAccountSettings.classList.remove('hidden');
});

formChangeNickname.addEventListener('submit', async (e) => {
  e.preventDefault();
  const chosen = inputSettingsNickname.value.trim().replace(/\s+/g, ' ');
  if (chosen.length < 2) {
    showToast('Noul nickname trebuie să aibă cel puțin 2 caractere.', true);
    return;
  }

  btnSaveSettingsNickname.disabled = true;
  try {
    const resp = await fetch('/api/auth/display-name', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.accessToken}`,
      },
      body: JSON.stringify({ displayName: chosen }),
    });
    const data = await resp.json();
    if (!data.ok) {
      if (data.nextDisplayNameChangeAt && state.user) {
        state.user.nextDisplayNameChangeAt = data.nextDisplayNameChangeAt;
      }
      renderAccountSettingsModal();
      showToast(data.error || 'Nu s-a putut actualiza nickname-ul.', true);
      return;
    }

    state.user = data.user;
    syncMenuHeader();
    renderAccountSettingsModal();
    emitSessionInit();
    showToast(`Nickname-ul a fost schimbat în „${data.user.displayName}”!`, false);
  } catch {
    showToast('Eroare de conexiune la salvarea nickname-ului.', true);
    renderAccountSettingsModal();
  }
});

initAuth();
