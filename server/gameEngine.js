const crypto = require('crypto');
const {
  CARDS_PER_PLAYER,
  SUITS,
  RANK_LABELS,
  SCORING,
  RENTZ_RULES,
  SUBGAMES,
  TIMERS,
} = require('./rulesConfig');
const { createDeck, shuffleDeck, sortHand } = require('./deck');

class RentzGame {
  /**
   * @param {Array<{id: string, nickname: string}>} players
   * @param {() => void} onStateChange Callback apelat când starea jocului se modifică asincron (ex. după finalizarea levatei)
   */
  constructor(players, onStateChange) {
    this.players = players.map((p, idx) => ({
      id: p.id,
      nickname: p.nickname,
      seatIndex: idx,
    }));
    this.numPlayers = this.players.length;
    this.onStateChange = onStateChange || (() => {});

    this.minRank = RENTZ_RULES.getMinRank(this.numPlayers);
    this.centerRank = RENTZ_RULES.getCenterRank(this.numPlayers);
    this.minCapeteForRefusal = RENTZ_RULES.getMinCapeteForRefusal(this.numPlayers);
    this.totalRounds = this.numPlayers * SUBGAMES.length;
    this.roundNumber = 0;

    this.scores = {};
    this.availableSubgames = {};
    this.seatMeta = {};
    for (const p of this.players) {
      this.scores[p.id] = 0;
      this.availableSubgames[p.id] = SUBGAMES.map((s) => s.id);
      this.seatMeta[p.id] = {
        isBot: Boolean(p.isBot),
        isAfk: false,
        consecutiveTimeouts: 0,
      };
    }

    this.roundHistory = [];
    this.lastRoundSummary = null;
    this.summaryContinueSet = new Set();
    this.pendingTimer = null;
    this.turnTimer = null;
    this.turnStartedAt = null;
    this.turnIsAfkWarning = false;
    this.botTimer = null;

    // Stare curentă de rundă
    this.phase = 'deciding_blind';
    this.chooserId = this.players[0].id;
    this.isBlind = false;
    this.scoreMultiplier = 1;
    this.cardsRevealed = false;
    this.currentSubgame = null;
    this.hands = {};
    this.tricksWon = {};
    this.capturedCards = {};
    this.roundDeltas = {};
    this.trickNumber = 1;
    this.leadPlayerId = null;
    this.currentTurnPlayerId = null;
    this.currentTrick = [];
    this.lastTrick = null;
    this.trickWinnerId = null;
    this.lastTrickPoints = 0;
    this.lastTrickBreakdown = '';
    this.statusBanner = '';

    // Stare specifică sub-jocului Rentz
    this.rentzBoard = null;
    this.rentzFinishOrder = [];
    this.rentzLastAction = '';
    this.rentzRefusalCandidates = [];

    this.startNextRound();
  }

  destroy() {
    this.clearPendingTimer();
    this.clearTurnTimer();
    this.clearBotTimer();
  }

  clearPendingTimer() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnStartedAt = null;
    this.turnIsAfkWarning = false;
  }

  clearBotTimer() {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  isSeatAutomated(playerId) {
    const meta = this.seatMeta[playerId];
    return Boolean(meta && (meta.isBot || meta.isAfk));
  }

  hasAnyActiveHuman() {
    return this.players.some((p) => !this.isSeatAutomated(p.id));
  }

  recordManualAction(playerId) {
    const meta = this.seatMeta[playerId];
    if (meta && !meta.isBot) {
      meta.consecutiveTimeouts = 0;
    }
  }

  convertPlayerToBot(playerId) {
    const meta = this.seatMeta[playerId];
    if (!meta) return;
    meta.isBot = true;
    meta.isAfk = false;
    meta.consecutiveTimeouts = 0;

    if (this.phase === 'round_summary') {
      this.summaryContinueSet.add(playerId);
      if (this.summaryContinueSet.size >= this.numPlayers) {
        this.startNextRound();
        return;
      }
    }

    if (
      this.currentTurnPlayerId === playerId ||
      ((this.phase === 'deciding_blind' || this.phase === 'choosing_subgame') &&
        this.chooserId === playerId)
    ) {
      this.clearTurnTimer();
    }
    this.scheduleBotActionIfNeeded();
  }

  resumeFromAfk(playerId) {
    const meta = this.seatMeta[playerId];
    if (!meta || meta.isBot) {
      return { ok: false, error: 'Acest loc nu poate fi reluat.' };
    }
    if (!meta.isAfk) {
      return { ok: true };
    }

    meta.isAfk = false;
    meta.consecutiveTimeouts = 0;

    const player = this.getPlayerById(playerId);
    // Dacă urma chiar mutarea acestui jucător și botul încă nu mutase, îi redăm controlul cu timer normal
    if (
      (this.phase === 'playing_tricks' || this.phase === 'playing_rentz') &&
      this.currentTurnPlayerId === playerId
    ) {
      this.clearBotTimer();
      this.statusBanner = `${player.nickname} a revenit în joc — Rândul lui ${player.nickname}!`;
      this.armTurnTimer();
    } else if (
      this.phase === 'checking_rentz_refusal' &&
      this.currentTurnPlayerId === playerId
    ) {
      this.clearBotTimer();
      this.armRentzRefusalTimer();
    } else if (
      (this.phase === 'deciding_blind' || this.phase === 'choosing_subgame') &&
      this.chooserId === playerId
    ) {
      this.clearBotTimer();
      this.armSelectionTimer();
    } else {
      // Dacă masa era în pauză fiindcă toți erau AFK, repornim fluxul pentru cine e la rând
      this.scheduleBotActionIfNeeded();
    }

    return { ok: true };
  }

  scheduleBotActionIfNeeded() {
    this.clearBotTimer();
    if (!this.hasAnyActiveHuman()) {
      return;
    }

    if (this.phase === 'deciding_blind' && this.isSeatAutomated(this.chooserId)) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (this.phase === 'deciding_blind' && this.isSeatAutomated(this.chooserId)) {
          this.chooseBlindMode(this.chooserId, false, { automated: true });
          this.onStateChange();
        }
      }, TIMERS.BOT_ACTION_DELAY_MS);
      return;
    }

    if (this.phase === 'choosing_subgame' && this.isSeatAutomated(this.chooserId)) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (this.phase === 'choosing_subgame' && this.isSeatAutomated(this.chooserId)) {
          const avail = this.availableSubgames[this.chooserId] || [];
          if (avail.length > 0) {
            const randomSub = avail[crypto.randomInt(0, avail.length)];
            this.chooseSubgame(this.chooserId, randomSub, { automated: true });
            this.onStateChange();
          }
        }
      }, TIMERS.BOT_ACTION_DELAY_MS);
      return;
    }

    if (
      this.phase === 'checking_rentz_refusal' &&
      this.currentTurnPlayerId &&
      this.isSeatAutomated(this.currentTurnPlayerId)
    ) {
      this.clearTurnTimer();
      const targetId = this.currentTurnPlayerId;
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (this.phase === 'checking_rentz_refusal' && this.currentTurnPlayerId === targetId) {
          this.decideRentzRefusal(targetId, false, { automated: true });
          this.onStateChange();
        }
      }, TIMERS.BOT_ACTION_DELAY_MS);
      return;
    }

    if (
      (this.phase === 'playing_tricks' || this.phase === 'playing_rentz') &&
      this.currentTurnPlayerId &&
      this.isSeatAutomated(this.currentTurnPlayerId)
    ) {
      this.clearTurnTimer();
      const targetId = this.currentTurnPlayerId;
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (this.currentTurnPlayerId === targetId && this.isSeatAutomated(targetId)) {
          const meta = this.seatMeta[targetId];
          const p = this.getPlayerById(targetId);
          const tag = meta?.isBot ? `${p.nickname} (Bot)` : `${p.nickname} (AFK Bot)`;
          this.executeRandomMoveForSeat(targetId, `🤖 ${tag} a jucat o carte`);
          this.onStateChange();
        }
      }, TIMERS.BOT_ACTION_DELAY_MS);
    }
  }

  armSelectionTimer() {
    this.clearTurnTimer();
    this.clearBotTimer();
    if (
      (this.phase !== 'deciding_blind' && this.phase !== 'choosing_subgame') ||
      !this.chooserId
    ) {
      return;
    }

    if (this.isSeatAutomated(this.chooserId)) {
      this.scheduleBotActionIfNeeded();
      return;
    }

    const meta = this.seatMeta[this.chooserId] || { consecutiveTimeouts: 0 };
    const isThirdStrike = meta.consecutiveTimeouts >= 2;

    this.turnStartedAt = Date.now();
    this.turnIsAfkWarning = isThirdStrike;
    const totalTimeoutMs = isThirdStrike
      ? TIMERS.AFK_THIRD_STRIKE_MS
      : TIMERS.TURN_VISIBLE_MS + TIMERS.TURN_GRACE_MS;

    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      this.handleSelectionTimeout();
    }, totalTimeoutMs);
  }

  handleSelectionTimeout() {
    if (this.phase !== 'deciding_blind' && this.phase !== 'choosing_subgame') {
      return;
    }

    const chooserId = this.chooserId;
    const chooser = this.getPlayerById(chooserId);
    const meta = this.seatMeta[chooserId];
    if (!meta) return;

    meta.consecutiveTimeouts += 1;
    if (meta.consecutiveTimeouts >= 3) {
      meta.isAfk = true;
    }

    // Dacă nu a reușit să finalizeze ambele alegeri în timp util, se forțează PE NEVĂZUTE (la dublu ×2) și un joc random!
    this.isBlind = true;
    this.scoreMultiplier = 2;
    this.phase = 'choosing_subgame';

    const avail = this.availableSubgames[chooserId] || [];
    if (avail.length === 0) return;
    const randomSubId = avail[crypto.randomInt(0, avail.length)];

    const res = this.chooseSubgame(chooserId, randomSubId, { automated: true });
    if (res.ok) {
      const afkNote = meta.isAfk ? ' (intrat în AFK)' : '';
      this.statusBanner = `⏱️ Timpul de alegere a expirat${afkNote} — ${chooser.nickname} joacă automat PE NEVĂZUTE (×2): ${this.currentSubgame.name}!`;
      this.onStateChange();
    }
  }

  armTurnTimer() {
    this.clearTurnTimer();
    this.clearBotTimer();
    if (
      (this.phase !== 'playing_tricks' && this.phase !== 'playing_rentz') ||
      !this.currentTurnPlayerId
    ) {
      return;
    }

    if (this.isSeatAutomated(this.currentTurnPlayerId)) {
      this.scheduleBotActionIfNeeded();
      return;
    }

    const meta = this.seatMeta[this.currentTurnPlayerId] || { consecutiveTimeouts: 0 };
    const isThirdStrike = meta.consecutiveTimeouts >= 2;

    this.turnStartedAt = Date.now();
    this.turnIsAfkWarning = isThirdStrike;
    const totalTimeoutMs = isThirdStrike
      ? TIMERS.AFK_THIRD_STRIKE_MS
      : TIMERS.TURN_VISIBLE_MS + TIMERS.TURN_GRACE_MS;

    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      this.handleTurnTimeout();
    }, totalTimeoutMs);
  }

  executeRandomMoveForSeat(playerId, bannerPrefix = null) {
    if (this.phase === 'playing_tricks') {
      const validIds = this.getPlayableTrickCards(playerId);
      if (validIds.length === 0) return false;
      const chosenCardId = validIds[crypto.randomInt(0, validIds.length)];
      const prevTrickLen = this.currentTrick.length;
      const res = this.playTrickCard(playerId, chosenCardId, { automated: true });
      if (res.ok && bannerPrefix && prevTrickLen + 1 < this.numPlayers && this.phase === 'playing_tricks') {
        const nextPlayer = this.getPlayerById(this.currentTurnPlayerId);
        this.statusBanner = `${bannerPrefix} — Rândul lui ${nextPlayer.nickname}`;
      }
      return res.ok;
    }

    if (this.phase === 'playing_rentz') {
      const validIds = this.getPlayableRentzCards(playerId);
      if (validIds.length > 0) {
        const chosenCardId = validIds[crypto.randomInt(0, validIds.length)];
        const res = this.playRentzCard(playerId, chosenCardId, { automated: true });
        return res.ok;
      }
      const res = this.passRentzTurn(playerId, { automated: true });
      return res.ok;
    }

    return false;
  }

  handleTurnTimeout() {
    if (
      (this.phase !== 'playing_tricks' && this.phase !== 'playing_rentz') ||
      !this.currentTurnPlayerId
    ) {
      return;
    }

    const playerId = this.currentTurnPlayerId;
    const player = this.getPlayerById(playerId);
    const meta = this.seatMeta[playerId];
    if (!meta) return;

    meta.consecutiveTimeouts += 1;

    if (meta.consecutiveTimeouts >= 3) {
      meta.isAfk = true;
      const moved = this.executeRandomMoveForSeat(
        playerId,
        `💤 ${player.nickname} a intrat în AFK — Botul a preluat locul`
      );
      if (moved) {
        this.onStateChange();
      }
      return;
    }

    const moved = this.executeRandomMoveForSeat(
      playerId,
      `⏱️ Timp expirat (${meta.consecutiveTimeouts}/2) — carte aleasă automat pentru ${player.nickname}`
    );
    if (moved) {
      this.onStateChange();
    }
  }

  getPlayerById(playerId) {
    return this.players.find((p) => p.id === playerId) || null;
  }

  getPlayerIndex(playerId) {
    return this.players.findIndex((p) => p.id === playerId);
  }

  getNextPlayerId(playerId) {
    const idx = this.getPlayerIndex(playerId);
    const nextIdx = (idx + 1) % this.numPlayers;
    return this.players[nextIdx].id;
  }

  startNextRound() {
    this.clearPendingTimer();
    this.clearTurnTimer();
    this.clearBotTimer();

    if (this.roundNumber >= this.totalRounds) {
      this.phase = 'game_over';
      this.statusBanner = 'Partida s-a încheiat!';
      return;
    }

    this.roundNumber += 1;
    const chooserIdx = (this.roundNumber - 1) % this.numPlayers;
    this.chooserId = this.players[chooserIdx].id;
    const chooser = this.players[chooserIdx];

    // Împarte câte 8 cărți fiecărui jucător înainte de alegerea sub-jocului
    const deck = shuffleDeck(createDeck(this.numPlayers));
    this.hands = {};
    this.tricksWon = {};
    this.capturedCards = {};
    this.roundDeltas = {};

    this.players.forEach((p, idx) => {
      const slice = deck.slice(idx * CARDS_PER_PLAYER, (idx + 1) * CARDS_PER_PLAYER);
      this.hands[p.id] = sortHand(slice);
      this.tricksWon[p.id] = 0;
      this.capturedCards[p.id] = [];
      this.roundDeltas[p.id] = 0;
    });

    this.currentSubgame = null;
    this.isBlind = false;
    this.scoreMultiplier = 1;
    this.cardsRevealed = false;
    this.trickNumber = 1;
    this.leadPlayerId = this.chooserId;
    this.currentTurnPlayerId = this.chooserId;
    this.currentTrick = [];
    this.lastTrick = null;
    this.trickWinnerId = null;
    this.lastTrickPoints = 0;
    this.lastTrickBreakdown = '';
    this.rentzBoard = null;
    this.rentzFinishOrder = [];
    this.rentzLastAction = '';
    this.rentzRefusalCandidates = [];
    this.summaryContinueSet.clear();

    this.phase = 'deciding_blind';
    this.statusBanner = `${chooser.nickname} alege modul rundei: Pe Văzute (×1) sau Pe Nevăzute (×2)...`;
    this.armSelectionTimer();
  }

  chooseBlindMode(playerId, blind, { automated = false } = {}) {
    if (this.phase !== 'deciding_blind') {
      return { ok: false, error: 'Modul rundei a fost deja ales.' };
    }
    if (playerId !== this.chooserId) {
      return { ok: false, error: 'Nu este rândul tău să alegi modul rundei.' };
    }
    if (!automated && this.seatMeta[playerId]?.isAfk) {
      return { ok: false, error: 'Apasă mai întâi pe „Reia Jocul” pentru a ieși din AFK.' };
    }

    const chooser = this.getPlayerById(playerId);
    this.isBlind = Boolean(blind);
    this.scoreMultiplier = this.isBlind ? 2 : 1;
    this.cardsRevealed = !this.isBlind;
    this.phase = 'choosing_subgame';

    if (this.isBlind) {
      this.statusBanner = `🔥 ${chooser.nickname} joacă PE NEVĂZUTE (Punctaj Dublu ×2) și alege sub-jocul!`;
    } else {
      this.statusBanner = `${chooser.nickname} joacă Pe Văzute (×1) — își privește cărțile și alege sub-jocul...`;
    }

    // IMPORTANT: Pentru un jucător uman NU resetăm timerul — aceleași 30 (+3) secunde continuă pentru alegerea sub-jocului!
    if (automated || this.isSeatAutomated(playerId)) {
      this.scheduleBotActionIfNeeded();
    }
    return { ok: true };
  }

  chooseSubgame(playerId, subgameId, { automated = false } = {}) {
    if (this.phase !== 'choosing_subgame') {
      return { ok: false, error: 'Nu este momentul alegerii sub-jocului.' };
    }
    if (playerId !== this.chooserId) {
      return { ok: false, error: 'Nu este rândul tău să alegi sub-jocul.' };
    }
    if (!automated && this.seatMeta[playerId]?.isAfk) {
      return { ok: false, error: 'Apasă mai întâi pe „Reia Jocul” pentru a ieși din AFK.' };
    }

    const available = this.availableSubgames[playerId] || [];
    if (!available.includes(subgameId)) {
      return { ok: false, error: 'Acest sub-joc a fost deja jucat de tine sau nu este valid.' };
    }

    const subgame = SUBGAMES.find((s) => s.id === subgameId);
    if (!subgame) {
      return { ok: false, error: 'Sub-joc inexistent.' };
    }

    if (!automated) {
      this.recordManualAction(playerId);
    }

    this.availableSubgames[playerId] = available.filter((id) => id !== subgameId);
    this.currentSubgame = subgame;
    this.cardsRevealed = true;
    const chooser = this.getPlayerById(playerId);
    const blindTag = this.isBlind ? ' PE NEVĂZUTE (×2)' : '';

    if (subgame.mode === 'rentz') {
      const capeteCandidates = this.getOrderedCapeteCandidates();
      if (capeteCandidates.length > 0) {
        this.rentzRefusalCandidates = capeteCandidates;
        this.enterRentzRefusalPhase(`${chooser.nickname} a ales Rentz${blindTag}. `);
      } else {
        const centerLabel = RANK_LABELS[this.centerRank];
        this.startRentzPlayPhase(
          `${chooser.nickname} a ales Rentz${blindTag}! Fiecare culoare se deschide cu ${centerLabel}.`
        );
      }
    } else {
      this.phase = 'playing_tricks';
      this.trickNumber = 1;
      this.leadPlayerId = this.chooserId;
      this.currentTurnPlayerId = this.chooserId;
      this.currentTrick = [];
      this.statusBanner = `${chooser.nickname} a ales ${subgame.name}${blindTag}. ${chooser.nickname} deschide mâna!`;
      this.armTurnTimer();
    }

    return { ok: true };
  }

  countCapete(hand = []) {
    return hand.filter((c) => c.value === 14 || c.value === this.minRank).length;
  }

  getOrderedCapeteCandidates() {
    const startIdx = Math.max(0, this.getPlayerIndex(this.chooserId));
    const candidates = [];
    for (let step = 0; step < this.numPlayers; step++) {
      const p = this.players[(startIdx + step) % this.numPlayers];
      if (this.countCapete(this.hands[p.id] || []) >= this.minCapeteForRefusal) {
        candidates.push(p.id);
      }
    }
    return candidates;
  }

  redealFreshHands() {
    const deck = shuffleDeck(createDeck(this.numPlayers));
    this.players.forEach((p, idx) => {
      const slice = deck.slice(idx * CARDS_PER_PLAYER, (idx + 1) * CARDS_PER_PLAYER);
      this.hands[p.id] = sortHand(slice);
    });
  }

  startRentzPlayPhase(bannerMsg) {
    this.phase = 'playing_rentz';
    this.rentzRefusalCandidates = [];
    this.rentzBoard = {
      spades: null,
      hearts: null,
      clubs: null,
      diamonds: null,
    };
    this.rentzFinishOrder = [];
    this.currentTurnPlayerId = this.chooserId;
    this.rentzLastAction = bannerMsg;
    this.statusBanner = bannerMsg;
    this.armTurnTimer();
  }

  enterRentzRefusalPhase(prefixMsg = '') {
    this.phase = 'checking_rentz_refusal';
    this.currentTurnPlayerId = this.rentzRefusalCandidates[0];
    const candidate = this.getPlayerById(this.currentTurnPlayerId);
    const capeteCount = this.countCapete(this.hands[this.currentTurnPlayerId] || []);
    this.statusBanner = `${prefixMsg}${candidate.nickname} are ${capeteCount} capete în mână și decide dacă joacă sau refuză mâna...`;
    this.armRentzRefusalTimer();
  }

  armRentzRefusalTimer() {
    this.clearTurnTimer();
    this.clearBotTimer();
    if (this.phase !== 'checking_rentz_refusal' || !this.currentTurnPlayerId) {
      return;
    }

    if (this.isSeatAutomated(this.currentTurnPlayerId)) {
      this.scheduleBotActionIfNeeded();
      return;
    }

    const meta = this.seatMeta[this.currentTurnPlayerId] || { consecutiveTimeouts: 0 };
    const isThirdStrike = meta.consecutiveTimeouts >= 2;

    this.turnStartedAt = Date.now();
    this.turnIsAfkWarning = isThirdStrike;
    const totalTimeoutMs = isThirdStrike
      ? TIMERS.AFK_THIRD_STRIKE_MS
      : TIMERS.TURN_VISIBLE_MS + TIMERS.TURN_GRACE_MS;

    const targetId = this.currentTurnPlayerId;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      if (this.phase !== 'checking_rentz_refusal' || this.currentTurnPlayerId !== targetId) {
        return;
      }
      const m = this.seatMeta[targetId];
      if (m) {
        m.consecutiveTimeouts += 1;
        if (m.consecutiveTimeouts >= 3) {
          m.isAfk = true;
        }
      }
      const res = this.decideRentzRefusal(targetId, false, { automated: true });
      if (res.ok) {
        this.onStateChange();
      }
    }, totalTimeoutMs);
  }

  decideRentzRefusal(playerId, refuse, { automated = false } = {}) {
    if (this.phase !== 'checking_rentz_refusal') {
      return { ok: false, error: 'Nu există o decizie de refuz activă.' };
    }
    if (this.currentTurnPlayerId !== playerId) {
      return { ok: false, error: 'Nu este rândul tău să decizi.' };
    }
    if (!automated && this.seatMeta[playerId]?.isAfk) {
      return { ok: false, error: 'Apasă mai întâi pe „Reia Jocul” pentru a ieși din AFK.' };
    }

    this.clearTurnTimer();
    this.clearBotTimer();
    if (!automated) {
      this.recordManualAction(playerId);
    }

    const player = this.getPlayerById(playerId);
    const chooser = this.getPlayerById(this.chooserId);
    const centerLabel = RANK_LABELS[this.centerRank];
    const blindTag = this.isBlind ? ' PE NEVĂZUTE (×2)' : '';

    // Dacă jucătorul alege să CONTINUE cu cărțile actuale
    if (!refuse) {
      this.rentzRefusalCandidates = this.rentzRefusalCandidates.filter((id) => id !== playerId);
      if (this.rentzRefusalCandidates.length > 0) {
        this.enterRentzRefusalPhase(`${player.nickname} a ales să continue. `);
        return { ok: true };
      }
      this.startRentzPlayPhase(
        `${player.nickname} a ales să continue! Începe Rentz${blindTag} — fiecare culoare se deschide cu ${centerLabel}.`
      );
      return { ok: true };
    }

    // Jucătorul a ales să REFUZE mâna (are 4+ capete) -> reîmpărțim cărțile!
    this.rentzRefusalCandidates = [];
    this.redealFreshHands();
    this.cardsRevealed = true;

    const capLabel = `${this.minCapeteForRefusal}+ capete`;

    // CAZUL 1: Se juca PE NEVĂZUTE (×2) -> rămâne tot Rentz Pe Nevăzute, doar reshuffle (cu verificare din nou pt pragul de capete!)
    if (this.isBlind) {
      const nextCandidates = this.getOrderedCapeteCandidates();
      if (nextCandidates.length > 0) {
        this.rentzRefusalCandidates = nextCandidates;
        this.enterRentzRefusalPhase(
          `🔄 ${player.nickname} a cerut reshuffle (${capLabel})! Cărți noi împărțite — `
        );
        return { ok: true };
      }

      this.startRentzPlayPhase(
        `🔄 ${player.nickname} a cerut reshuffle (${capLabel})! Cărți noi — se joacă tot Rentz PE NEVĂZUTE (×2), deschidere cu ${centerLabel}!`
      );
      return { ok: true };
    }

    // CAZUL 2: Se juca PE VĂZUTE (×1) -> reshuffle + alegătorul poate schimba jocul (inclusiv să aleagă iar Rentz dacă dorește)
    if (!this.availableSubgames[this.chooserId].includes('rentz')) {
      this.availableSubgames[this.chooserId].push('rentz');
    }
    this.currentSubgame = null;
    this.isBlind = false;
    this.scoreMultiplier = 1;
    this.phase = 'choosing_subgame';
    this.currentTurnPlayerId = this.chooserId;
    this.statusBanner = `🔄 ${player.nickname} a refuzat Rentz (${capLabel})! Cărțile au fost reîmpărțite — ${chooser.nickname} poate alege din nou jocul (Pe Văzute ×1).`;
    this.armSelectionTimer();
    return { ok: true };
  }

  getPlayableTrickCards(playerId) {
    if (this.phase !== 'playing_tricks' || this.currentTurnPlayerId !== playerId) {
      return [];
    }
    const hand = this.hands[playerId] || [];
    if (this.currentTrick.length === 0) {
      return hand.map((c) => c.id);
    }

    const leadSuit = this.currentTrick[0].card.suit;
    const matchingSuit = hand.filter((c) => c.suit === leadSuit);
    if (matchingSuit.length > 0) {
      return matchingSuit.map((c) => c.id);
    }
    return hand.map((c) => c.id);
  }

  getPlayableRentzCards(playerId) {
    if (this.phase !== 'playing_rentz' || this.currentTurnPlayerId !== playerId) {
      return [];
    }
    const hand = this.hands[playerId] || [];
    return hand
      .filter((card) => {
        const track = this.rentzBoard[card.suit];
        if (!track) {
          return card.value === this.centerRank;
        }
        return card.value === track.low - 1 || card.value === track.high + 1;
      })
      .map((c) => c.id);
  }

  playCard(playerId, cardId) {
    if (this.phase === 'playing_tricks') {
      return this.playTrickCard(playerId, cardId);
    }
    if (this.phase === 'playing_rentz') {
      return this.playRentzCard(playerId, cardId);
    }
    return { ok: false, error: 'Nu se pot juca cărți în acest moment.' };
  }

  playTrickCard(playerId, cardId, { automated = false } = {}) {
    if (this.currentTurnPlayerId !== playerId) {
      return { ok: false, error: 'Nu este rândul tău!' };
    }
    if (!automated && this.seatMeta[playerId]?.isAfk) {
      return { ok: false, error: 'Ești marcat AFK. Apasă „Reia Jocul” pentru a continua!' };
    }

    const playableIds = this.getPlayableTrickCards(playerId);
    if (!playableIds.includes(cardId)) {
      return { ok: false, error: 'Ești obligat să răspunzi la culoare!' };
    }

    const hand = this.hands[playerId];
    const cardIdx = hand.findIndex((c) => c.id === cardId);
    if (cardIdx === -1) {
      return { ok: false, error: 'Cartea nu se află în mâna ta.' };
    }

    if (!automated) {
      this.recordManualAction(playerId);
    }

    const [card] = hand.splice(cardIdx, 1);
    this.clearTurnTimer();
    const player = this.getPlayerById(playerId);
    this.currentTrick.push({
      playerId,
      nickname: player.nickname,
      card,
    });

    // Dacă încă nu au pus toți jucătorii în levata curentă
    if (this.currentTrick.length < this.numPlayers) {
      this.currentTurnPlayerId = this.getNextPlayerId(playerId);
      const nextPlayer = this.getPlayerById(this.currentTurnPlayerId);
      this.statusBanner = `Rândul lui ${nextPlayer.nickname}`;
      this.armTurnTimer();
      return { ok: true };
    }

    // Levata este completă: determinăm câștigătorul levatei
    const leadSuit = this.currentTrick[0].card.suit;
    let winningEntry = this.currentTrick[0];
    for (const entry of this.currentTrick) {
      if (entry.card.suit === leadSuit && entry.card.value > winningEntry.card.value) {
        winningEntry = entry;
      }
    }

    const winnerId = winningEntry.playerId;
    const winner = this.getPlayerById(winnerId);

    this.tricksWon[winnerId] += 1;
    const trickCards = this.currentTrick.map((entry) => entry.card);
    for (const c of trickCards) {
      this.capturedCards[winnerId].push(c);
    }

    // Calculăm și aplicăm IMEDIAT punctele acestei mâini la scorul câștigătorului levatei
    const { total: trickPoints, breakdown } = this.calculateTrickPoints(trickCards);
    if (trickPoints !== 0) {
      this.scores[winnerId] += trickPoints;
      this.roundDeltas[winnerId] = (this.roundDeltas[winnerId] || 0) + trickPoints;
    }

    this.phase = 'trick_complete';
    this.trickWinnerId = winnerId;
    this.lastTrickPoints = trickPoints;
    this.lastTrickBreakdown = breakdown;
    this.currentTurnPlayerId = null;

    const breakdownSuffix = breakdown ? `: ${breakdown}` : '';
    const ptsText =
      trickPoints > 0
        ? ` (+${trickPoints} pct${breakdownSuffix})`
        : trickPoints < 0
        ? ` (${trickPoints} pct${breakdownSuffix})`
        : '';
    this.statusBanner = `${winner.nickname} ia mâna cu ${winningEntry.card.label}${winningEntry.card.symbol}!${ptsText}`;

    this.clearPendingTimer();
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.completeTrickTransition(winnerId);
      this.onStateChange();
    }, TIMERS.TRICK_RESOLVE_MS);

    return { ok: true };
  }

  calculateTrickPoints(trickCards) {
    if (!this.currentSubgame) return { total: 0, breakdown: '' };
    const subId = this.currentSubgame.id;
    const mult = this.scoreMultiplier || 1;

    const hasKH = trickCards.some((c) => c.suit === 'hearts' && c.value === 13);
    const has10C = trickCards.some((c) => c.suit === 'clubs' && c.value === 10);
    const queensCount = trickCards.filter((c) => c.value === 12).length;
    const diamondsCount = trickCards.filter((c) => c.suit === 'diamonds').length;

    let basePts = 0;
    const parts = [];

    if (subId === 'king_of_hearts') {
      if (hasKH) {
        basePts = SCORING.KING_OF_HEARTS;
        parts.push(`K♥ ${SCORING.KING_OF_HEARTS * mult}`);
      }
    } else if (subId === 'ten_of_clubs') {
      if (has10C) {
        basePts = SCORING.TEN_OF_CLUBS;
        parts.push(`10♣ +${SCORING.TEN_OF_CLUBS * mult}`);
      }
    } else if (subId === 'queens') {
      basePts = queensCount * SCORING.QUEEN_MINUS;
      if (queensCount > 0) {
        parts.push(`Q×${queensCount} ${basePts * mult}`);
      }
    } else if (subId === 'diamonds') {
      basePts = diamondsCount * SCORING.DIAMOND_MINUS;
      if (diamondsCount > 0) {
        parts.push(`♦×${diamondsCount} ${basePts * mult}`);
      }
    } else if (subId === 'no_tricks') {
      basePts = SCORING.NO_TRICKS;
    } else if (subId === 'whist') {
      basePts = SCORING.WHIST_TRICK;
    } else if (subId === 'totals_plus') {
      // La Totale Plus: K♥ NU valorează nimic (0 pct)! Se punctează doar: Mâna (+50), 10♣ (+200), Dame (+30/buc), Romburi (+20/buc)
      basePts += SCORING.WHIST_TRICK;
      parts.push(`Mână +${SCORING.WHIST_TRICK * mult}`);
      if (has10C) {
        basePts += SCORING.TEN_OF_CLUBS;
        parts.push(`10♣ +${SCORING.TEN_OF_CLUBS * mult}`);
      }
      if (queensCount > 0) {
        const qPts = queensCount * SCORING.QUEEN_PLUS;
        basePts += qPts;
        parts.push(`Q×${queensCount} +${qPts * mult}`);
      }
      if (diamondsCount > 0) {
        const dPts = diamondsCount * SCORING.DIAMOND_PLUS;
        basePts += dPts;
        parts.push(`♦×${diamondsCount} +${dPts * mult}`);
      }
    } else if (subId === 'totals_minus') {
      // La Totale Minus: 10♣ NU valorează nimic (0 pct)! Se scad doar: Mâna (-50), K♥ (-200), Dame (-30/buc), Romburi (-20/buc)
      basePts += SCORING.NO_TRICKS;
      parts.push(`Mână ${SCORING.NO_TRICKS * mult}`);
      if (hasKH) {
        basePts += SCORING.KING_OF_HEARTS;
        parts.push(`K♥ ${SCORING.KING_OF_HEARTS * mult}`);
      }
      if (queensCount > 0) {
        const qPts = queensCount * SCORING.QUEEN_MINUS;
        basePts += qPts;
        parts.push(`Q×${queensCount} ${qPts * mult}`);
      }
      if (diamondsCount > 0) {
        const dPts = diamondsCount * SCORING.DIAMOND_MINUS;
        basePts += dPts;
        parts.push(`♦×${diamondsCount} ${dPts * mult}`);
      }
    }

    const scaled = basePts * mult;
    return {
      total: scaled === 0 ? 0 : scaled,
      breakdown: parts.join(', '),
    };
  }

  completeTrickTransition(winnerId) {
    this.lastTrick = {
      winnerId,
      winnerName: this.getPlayerById(winnerId)?.nickname || '',
      points: this.lastTrickPoints,
      breakdown: this.lastTrickBreakdown,
      cards: this.currentTrick.slice(),
    };
    this.currentTrick = [];
    this.trickWinnerId = null;
    this.lastTrickPoints = 0;
    this.lastTrickBreakdown = '';

    const earlyEndReason = this.checkTrickEarlyEnd();
    if (earlyEndReason || this.trickNumber >= CARDS_PER_PLAYER) {
      const reason = earlyEndReason || 'Cele 8 mâini s-au încheiat.';
      // Punctele au fost deja aplicate în timp real după fiecare mână!
      this.finishRound(this.roundDeltas, reason, { alreadyAppliedToScores: true });
      return;
    }

    this.trickNumber += 1;
    this.leadPlayerId = winnerId;
    this.currentTurnPlayerId = winnerId;
    this.phase = 'playing_tricks';
    const winner = this.getPlayerById(winnerId);
    this.statusBanner = `Mâna ${this.trickNumber}/${CARDS_PER_PLAYER} — ${winner.nickname} deschide!`;
    this.armTurnTimer();
  }

  checkTrickEarlyEnd() {
    if (!this.currentSubgame) return null;
    const allCaptured = Object.values(this.capturedCards).flat();

    switch (this.currentSubgame.id) {
      case 'king_of_hearts': {
        if (allCaptured.some((c) => c.suit === 'hearts' && c.value === 13)) {
          return 'Popa de Inimă Roșie (K♥) a fost luat!';
        }
        return null;
      }
      case 'ten_of_clubs': {
        if (allCaptured.some((c) => c.suit === 'clubs' && c.value === 10)) {
          return '10-le de Treflă (10♣) a fost luat!';
        }
        return null;
      }
      case 'queens': {
        const queens = allCaptured.filter((c) => c.value === 12).length;
        if (queens >= 4) {
          return 'Toate cele 4 Dame au fost luate!';
        }
        return null;
      }
      case 'diamonds': {
        const totalDiamondsInDeck = 2 * this.numPlayers;
        const diamonds = allCaptured.filter((c) => c.suit === 'diamonds').length;
        if (diamonds >= totalDiamondsInDeck) {
          return 'Toate Romburile au fost luate!';
        }
        return null;
      }
      default:
        return null;
    }
  }

  getNextActiveRentzPlayer(fromPlayerId) {
    let idx = this.getPlayerIndex(fromPlayerId);
    for (let step = 1; step <= this.numPlayers; step++) {
      const candidate = this.players[(idx + step) % this.numPlayers];
      if ((this.hands[candidate.id] || []).length > 0) {
        return candidate;
      }
    }
    return null;
  }

  playRentzCard(playerId, cardId, { automated = false } = {}) {
    if (this.currentTurnPlayerId !== playerId) {
      return { ok: false, error: 'Nu este rândul tău!' };
    }
    if (!automated && this.seatMeta[playerId]?.isAfk) {
      return { ok: false, error: 'Ești marcat AFK. Apasă „Reia Jocul” pentru a continua!' };
    }

    const playableIds = this.getPlayableRentzCards(playerId);
    if (!playableIds.includes(cardId)) {
      return { ok: false, error: 'Această carte nu poate fi depusă încă pe masă.' };
    }

    if (!automated) {
      this.recordManualAction(playerId);
    }

    const hand = this.hands[playerId];
    const cardIdx = hand.findIndex((c) => c.id === cardId);
    const [card] = hand.splice(cardIdx, 1);
    this.clearTurnTimer();
    const player = this.getPlayerById(playerId);

    // Actualizăm coloana culorii pe masă
    const track = this.rentzBoard[card.suit];
    if (!track) {
      this.rentzBoard[card.suit] = {
        low: card.value,
        high: card.value,
      };
    } else {
      if (card.value < track.low) track.low = card.value;
      if (card.value > track.high) track.high = card.value;
    }

    const justFinished = hand.length === 0;
    if (justFinished && !this.rentzFinishOrder.includes(playerId)) {
      this.rentzFinishOrder.push(playerId);
    }

    // Verificăm câți jucători mai au cărți în mână
    const activePlayers = this.players.filter((p) => (this.hands[p.id] || []).length > 0);
    if (activePlayers.length <= 1) {
      if (activePlayers.length === 1) {
        this.rentzFinishOrder.push(activePlayers[0].id);
      }
      const deltas = {};
      this.rentzFinishOrder.forEach((pid, placeIdx) => {
        deltas[pid] = SCORING.getRentzPlacePoints(placeIdx, this.numPlayers);
      });
      this.finishRound(deltas, 'Sub-jocul Rentz s-a încheiat!');
      return { ok: true };
    }

    // Determinăm cine urmează la mutare
    if (card.value === 14 && !justFinished && RENTZ_RULES.aceExtraTurn) {
      this.currentTurnPlayerId = playerId;
      this.rentzLastAction = `${player.nickname} a jucat ${card.label}${card.symbol} (As) și primește încă o mutare!`;
    } else if (card.value === this.minRank && RENTZ_RULES.minCardSkipsNext) {
      const skipped = this.getNextActiveRentzPlayer(playerId);
      const nextAfterSkipped = this.getNextActiveRentzPlayer(skipped.id);
      this.currentTurnPlayerId = nextAfterSkipped.id;
      const finishNote = justFinished
        ? ` (${player.nickname} a terminat pe locul ${this.rentzFinishOrder.length}!)`
        : '';
      this.rentzLastAction = `${player.nickname} a pus ${card.label}${card.symbol} — ${skipped.nickname} stă o tură!${finishNote}`;
    } else {
      const next = this.getNextActiveRentzPlayer(playerId);
      this.currentTurnPlayerId = next.id;
      if (justFinished) {
        this.rentzLastAction = `${player.nickname} a pus ${card.label}${card.symbol} și a terminat pe locul ${this.rentzFinishOrder.length}!`;
      } else {
        this.rentzLastAction = `${player.nickname} a pus ${card.label}${card.symbol}.`;
      }
    }

    this.statusBanner = this.rentzLastAction;
    this.armTurnTimer();
    return { ok: true };
  }

  passRentzTurn(playerId, { automated = false } = {}) {
    if (this.phase !== 'playing_rentz') {
      return { ok: false, error: 'Pasul este disponibil doar la sub-jocul Rentz.' };
    }
    if (this.currentTurnPlayerId !== playerId) {
      return { ok: false, error: 'Nu este rândul tău!' };
    }
    if (!automated && this.seatMeta[playerId]?.isAfk) {
      return { ok: false, error: 'Ești marcat AFK. Apasă „Reia Jocul” pentru a continua!' };
    }
    const playableIds = this.getPlayableRentzCards(playerId);
    if (playableIds.length > 0) {
      return { ok: false, error: 'Nu poți spune Pas când ai cel puțin o carte validă de pus!' };
    }

    if (!automated) {
      this.recordManualAction(playerId);
    }

    this.clearTurnTimer();
    const player = this.getPlayerById(playerId);
    const next = this.getNextActiveRentzPlayer(playerId);
    this.currentTurnPlayerId = next ? next.id : null;
    this.rentzLastAction = `${player.nickname} a spus Pas (fără mutare validă).`;
    this.statusBanner = this.rentzLastAction;
    this.armTurnTimer();
    return { ok: true };
  }

  finishRound(inputDeltas, reason, { alreadyAppliedToScores = false } = {}) {
    this.clearPendingTimer();
    this.clearTurnTimer();

    const deltas = {};
    const totalsAfter = {};
    for (const p of this.players) {
      if (alreadyAppliedToScores) {
        const d = inputDeltas[p.id] || 0;
        deltas[p.id] = d === 0 ? 0 : d;
      } else {
        const rawDelta = (inputDeltas[p.id] || 0) * this.scoreMultiplier;
        const delta = rawDelta === 0 ? 0 : rawDelta;
        deltas[p.id] = delta;
        this.scores[p.id] += delta;
      }
      totalsAfter[p.id] = this.scores[p.id];
    }

    const chooser = this.getPlayerById(this.chooserId);
    const summary = {
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      chooserId: this.chooserId,
      chooserName: chooser ? chooser.nickname : '',
      subgameId: this.currentSubgame.id,
      subgameName: this.currentSubgame.name,
      subgameBadge: this.currentSubgame.badge,
      isBlind: this.isBlind,
      scoreMultiplier: this.scoreMultiplier,
      reason,
      deltas,
      totalsAfter,
      rentzFinishOrder: this.rentzFinishOrder.slice(),
    };

    this.roundHistory.push(summary);
    this.lastRoundSummary = summary;
    this.summaryContinueSet.clear();
    // Jucătorii preluați de Bot / AFK bifează automat Continuă la rezumat
    for (const p of this.players) {
      if (this.isSeatAutomated(p.id)) {
        this.summaryContinueSet.add(p.id);
      }
    }

    if (this.roundNumber >= this.totalRounds) {
      this.phase = 'game_over';
      this.currentTurnPlayerId = null;
      this.statusBanner = 'Toate rundele s-au încheiat! Clasament final:';
      return;
    }

    this.phase = 'round_summary';
    this.currentTurnPlayerId = null;
    this.statusBanner = reason;

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      if (this.phase === 'round_summary') {
        this.startNextRound();
        this.onStateChange();
      }
    }, TIMERS.ROUND_SUMMARY_AUTO_MS);
  }

  acknowledgeRoundSummary(playerId) {
    if (this.phase !== 'round_summary') {
      return { ok: false, error: 'Nu suntem în ecranul de rezumat al rundei.' };
    }
    this.summaryContinueSet.add(playerId);
    if (this.summaryContinueSet.size >= this.numPlayers) {
      this.startNextRound();
    }
    return { ok: true };
  }

  getCapturedSummary(playerId) {
    const cards = this.capturedCards[playerId] || [];
    return {
      hasKingOfHearts: cards.some((c) => c.suit === 'hearts' && c.value === 13),
      hasTenOfClubs: cards.some((c) => c.suit === 'clubs' && c.value === 10),
      queensCount: cards.filter((c) => c.value === 12).length,
      diamondsCount: cards.filter((c) => c.suit === 'diamonds').length,
    };
  }

  getStandings() {
    return this.players
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        score: this.scores[p.id] || 0,
      }))
      .sort((a, b) => b.score - a.score);
  }

  getStateForPlayer(viewerId, connectionMap = {}) {
    const playableCardIds =
      this.phase === 'playing_tricks'
        ? this.getPlayableTrickCards(viewerId)
        : this.phase === 'playing_rentz'
        ? this.getPlayableRentzCards(viewerId)
        : [];

    const canPassRentz =
      this.phase === 'playing_rentz' &&
      this.currentTurnPlayerId === viewerId &&
      playableCardIds.length === 0;

    const viewerHand = this.hands[viewerId] || [];
    const hasActiveTurnTimer =
      (this.phase === 'deciding_blind' ||
        this.phase === 'choosing_subgame' ||
        this.phase === 'checking_rentz_refusal' ||
        this.phase === 'playing_tricks' ||
        this.phase === 'playing_rentz') &&
      Boolean(this.currentTurnPlayerId) &&
      Boolean(this.turnStartedAt);

    const turnRemainingMs = hasActiveTurnTimer
      ? Math.max(0, TIMERS.TURN_VISIBLE_MS - (Date.now() - this.turnStartedAt))
      : null;

    return {
      phase: this.phase,
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      chooserId: this.chooserId,
      isBlind: this.isBlind,
      scoreMultiplier: this.scoreMultiplier,
      cardsRevealed: this.cardsRevealed,
      leadPlayerId: this.leadPlayerId,
      currentTurnPlayerId: this.currentTurnPlayerId,
      turnRemainingMs,
      turnTotalMs: hasActiveTurnTimer ? TIMERS.TURN_VISIBLE_MS : null,
      turnIsAfkWarning: hasActiveTurnTimer ? this.turnIsAfkWarning : false,
      trickNumber: this.trickNumber,
      trickWinnerId: this.trickWinnerId,
      lastTrickPoints: this.lastTrickPoints,
      lastTrickBreakdown: this.lastTrickBreakdown,
      statusBanner: this.statusBanner,
      currentSubgame: this.currentSubgame,
      subgamesCatalog: SUBGAMES,
      minRank: this.minRank,
      minRankLabel: RANK_LABELS[this.minRank],
      centerRank: this.centerRank,
      centerRankLabel: RANK_LABELS[this.centerRank],
      minCapeteForRefusal: this.minCapeteForRefusal,
      suitsOrder: SUITS,
      myHand: this.cardsRevealed ? viewerHand : [],
      myCapeteCount: this.cardsRevealed ? this.countCapete(viewerHand) : 0,
      hiddenHandCount: this.cardsRevealed ? 0 : viewerHand.length,
      playableCardIds,
      canPassRentz,
      currentTrick: this.currentTrick,
      lastTrick: this.lastTrick,
      rentzBoard: this.rentzBoard,
      rentzFinishOrder: this.rentzFinishOrder,
      rentzLastAction: this.rentzLastAction,
      lastRoundSummary: this.lastRoundSummary,
      roundHistory: this.roundHistory,
      standings: this.getStandings(),
      players: this.players.map((p) => {
        const placeIdx = this.rentzFinishOrder.indexOf(p.id);
        const meta = this.seatMeta[p.id] || {};
        return {
          id: p.id,
          nickname: p.nickname,
          seatIndex: p.seatIndex,
          connected: connectionMap[p.id] !== false,
          isBot: Boolean(meta.isBot),
          isAfk: Boolean(meta.isAfk),
          consecutiveTimeouts: meta.consecutiveTimeouts || 0,
          cardCount: (this.hands[p.id] || []).length,
          score: this.scores[p.id] || 0,
          roundDelta: this.roundDeltas[p.id] || 0,
          availableSubgames: this.availableSubgames[p.id] || [],
          tricksWon: this.tricksWon[p.id] || 0,
          captured: this.getCapturedSummary(p.id),
          rentzPlace: placeIdx !== -1 ? placeIdx + 1 : null,
          continuedSummary: this.summaryContinueSet.has(p.id),
        };
      }),
    };
  }
}

module.exports = { RentzGame };
