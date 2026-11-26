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
    this.totalRounds = this.numPlayers * SUBGAMES.length;
    this.roundNumber = 0;

    this.scores = {};
    this.availableSubgames = {};
    for (const p of this.players) {
      this.scores[p.id] = 0;
      this.availableSubgames[p.id] = SUBGAMES.map((s) => s.id);
    }

    this.roundHistory = [];
    this.lastRoundSummary = null;
    this.summaryContinueSet = new Set();
    this.pendingTimer = null;

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
    this.statusBanner = '';

    // Stare specifică sub-jocului Rentz
    this.rentzBoard = null;
    this.rentzFinishOrder = [];
    this.rentzLastAction = '';

    this.startNextRound();
  }

  destroy() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  clearPendingTimer() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
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
    this.rentzBoard = null;
    this.rentzFinishOrder = [];
    this.rentzLastAction = '';
    this.summaryContinueSet.clear();

    this.phase = 'deciding_blind';
    this.statusBanner = `${chooser.nickname} alege modul rundei: Pe Văzute (×1) sau Pe Nevăzute (×2)...`;
  }

  chooseBlindMode(playerId, blind) {
    if (this.phase !== 'deciding_blind') {
      return { ok: false, error: 'Modul rundei a fost deja ales.' };
    }
    if (playerId !== this.chooserId) {
      return { ok: false, error: 'Nu este rândul tău să alegi modul rundei.' };
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

    return { ok: true };
  }

  chooseSubgame(playerId, subgameId) {
    if (this.phase !== 'choosing_subgame') {
      return { ok: false, error: 'Nu este momentul alegerii sub-jocului.' };
    }
    if (playerId !== this.chooserId) {
      return { ok: false, error: 'Nu este rândul tău să alegi sub-jocul.' };
    }

    const available = this.availableSubgames[playerId] || [];
    if (!available.includes(subgameId)) {
      return { ok: false, error: 'Acest sub-joc a fost deja jucat de tine sau nu este valid.' };
    }

    const subgame = SUBGAMES.find((s) => s.id === subgameId);
    if (!subgame) {
      return { ok: false, error: 'Sub-joc inexistent.' };
    }

    this.availableSubgames[playerId] = available.filter((id) => id !== subgameId);
    this.currentSubgame = subgame;
    this.cardsRevealed = true;
    const chooser = this.getPlayerById(playerId);
    const blindTag = this.isBlind ? ' PE NEVĂZUTE (×2)' : '';

    if (subgame.mode === 'rentz') {
      this.phase = 'playing_rentz';
      this.rentzBoard = {
        spades: null,
        hearts: null,
        clubs: null,
        diamonds: null,
      };
      this.rentzFinishOrder = [];
      this.currentTurnPlayerId = this.chooserId;
      const centerLabel = RANK_LABELS[this.centerRank];
      this.rentzLastAction = `${chooser.nickname} a ales Rentz${blindTag}! Fiecare culoare se deschide cu ${centerLabel}.`;
      this.statusBanner = this.rentzLastAction;
    } else {
      this.phase = 'playing_tricks';
      this.trickNumber = 1;
      this.leadPlayerId = this.chooserId;
      this.currentTurnPlayerId = this.chooserId;
      this.currentTrick = [];
      this.statusBanner = `${chooser.nickname} a ales ${subgame.name}${blindTag}. ${chooser.nickname} deschide mâna!`;
    }

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

  playTrickCard(playerId, cardId) {
    if (this.currentTurnPlayerId !== playerId) {
      return { ok: false, error: 'Nu este rândul tău!' };
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

    const [card] = hand.splice(cardIdx, 1);
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
    const trickPoints = this.calculateTrickPoints(trickCards);
    if (trickPoints !== 0) {
      this.scores[winnerId] += trickPoints;
      this.roundDeltas[winnerId] = (this.roundDeltas[winnerId] || 0) + trickPoints;
    }

    this.phase = 'trick_complete';
    this.trickWinnerId = winnerId;
    this.lastTrickPoints = trickPoints;
    this.currentTurnPlayerId = null;

    const ptsText =
      trickPoints > 0
        ? ` (+${trickPoints} pct)`
        : trickPoints < 0
        ? ` (${trickPoints} pct)`
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
    if (!this.currentSubgame) return 0;
    const subId = this.currentSubgame.id;

    const hasKH = trickCards.some((c) => c.suit === 'hearts' && c.value === 13);
    const has10C = trickCards.some((c) => c.suit === 'clubs' && c.value === 10);
    const queensCount = trickCards.filter((c) => c.value === 12).length;
    const diamondsCount = trickCards.filter((c) => c.suit === 'diamonds').length;

    let basePts = 0;
    if (subId === 'king_of_hearts') {
      basePts = hasKH ? SCORING.KING_OF_HEARTS : 0;
    } else if (subId === 'ten_of_clubs') {
      basePts = has10C ? SCORING.TEN_OF_CLUBS : 0;
    } else if (subId === 'queens') {
      basePts = queensCount * SCORING.QUEEN_MINUS;
    } else if (subId === 'diamonds') {
      basePts = diamondsCount * SCORING.DIAMOND_MINUS;
    } else if (subId === 'no_tricks') {
      basePts = SCORING.NO_TRICKS;
    } else if (subId === 'whist') {
      basePts = SCORING.WHIST_TRICK;
    } else if (subId === 'totals_plus') {
      basePts =
        (has10C ? SCORING.TEN_OF_CLUBS : 0) +
        queensCount * SCORING.QUEEN_PLUS +
        diamondsCount * SCORING.DIAMOND_PLUS +
        SCORING.WHIST_TRICK;
    } else if (subId === 'totals_minus') {
      basePts =
        (hasKH ? SCORING.KING_OF_HEARTS : 0) +
        queensCount * SCORING.QUEEN_MINUS +
        diamondsCount * SCORING.DIAMOND_MINUS +
        SCORING.NO_TRICKS;
    }

    const scaled = basePts * this.scoreMultiplier;
    return scaled === 0 ? 0 : scaled;
  }

  completeTrickTransition(winnerId) {
    this.lastTrick = {
      winnerId,
      winnerName: this.getPlayerById(winnerId)?.nickname || '',
      points: this.lastTrickPoints,
      cards: this.currentTrick.slice(),
    };
    this.currentTrick = [];
    this.trickWinnerId = null;
    this.lastTrickPoints = 0;

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

  scoreTrickRound() {
    const deltas = {};
    const subId = this.currentSubgame.id;

    for (const p of this.players) {
      const cards = this.capturedCards[p.id] || [];
      const tricks = this.tricksWon[p.id] || 0;
      const hasKH = cards.some((c) => c.suit === 'hearts' && c.value === 13);
      const has10C = cards.some((c) => c.suit === 'clubs' && c.value === 10);
      const queensCount = cards.filter((c) => c.value === 12).length;
      const diamondsCount = cards.filter((c) => c.suit === 'diamonds').length;

      let pts = 0;
      if (subId === 'king_of_hearts') {
        pts = hasKH ? SCORING.KING_OF_HEARTS : 0;
      } else if (subId === 'ten_of_clubs') {
        pts = has10C ? SCORING.TEN_OF_CLUBS : 0;
      } else if (subId === 'queens') {
        pts = queensCount * SCORING.QUEEN_MINUS;
      } else if (subId === 'diamonds') {
        pts = diamondsCount * SCORING.DIAMOND_MINUS;
      } else if (subId === 'no_tricks') {
        pts = tricks * SCORING.NO_TRICKS;
      } else if (subId === 'whist') {
        pts = tricks * SCORING.WHIST_TRICK;
      } else if (subId === 'totals_plus') {
        pts =
          (has10C ? SCORING.TEN_OF_CLUBS : 0) +
          queensCount * SCORING.QUEEN_PLUS +
          diamondsCount * SCORING.DIAMOND_PLUS +
          tricks * SCORING.WHIST_TRICK;
      } else if (subId === 'totals_minus') {
        pts =
          (hasKH ? SCORING.KING_OF_HEARTS : 0) +
          queensCount * SCORING.QUEEN_MINUS +
          diamondsCount * SCORING.DIAMOND_MINUS +
          tricks * SCORING.NO_TRICKS;
      }
      deltas[p.id] = pts;
    }

    return deltas;
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

  playRentzCard(playerId, cardId) {
    if (this.currentTurnPlayerId !== playerId) {
      return { ok: false, error: 'Nu este rândul tău!' };
    }

    const playableIds = this.getPlayableRentzCards(playerId);
    if (!playableIds.includes(cardId)) {
      return { ok: false, error: 'Această carte nu poate fi depusă încă pe masă.' };
    }

    const hand = this.hands[playerId];
    const cardIdx = hand.findIndex((c) => c.id === cardId);
    const [card] = hand.splice(cardIdx, 1);
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
    return { ok: true };
  }

  passRentzTurn(playerId) {
    if (this.phase !== 'playing_rentz') {
      return { ok: false, error: 'Pasul este disponibil doar la sub-jocul Rentz.' };
    }
    if (this.currentTurnPlayerId !== playerId) {
      return { ok: false, error: 'Nu este rândul tău!' };
    }
    const playableIds = this.getPlayableRentzCards(playerId);
    if (playableIds.length > 0) {
      return { ok: false, error: 'Nu poți spune Pas când ai cel puțin o carte validă de pus!' };
    }

    const player = this.getPlayerById(playerId);
    const next = this.getNextActiveRentzPlayer(playerId);
    this.currentTurnPlayerId = next ? next.id : null;
    this.rentzLastAction = `${player.nickname} a spus Pas (fără mutare validă).`;
    this.statusBanner = this.rentzLastAction;
    return { ok: true };
  }

  finishRound(inputDeltas, reason, { alreadyAppliedToScores = false } = {}) {
    this.clearPendingTimer();

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
      trickNumber: this.trickNumber,
      trickWinnerId: this.trickWinnerId,
      lastTrickPoints: this.lastTrickPoints,
      statusBanner: this.statusBanner,
      currentSubgame: this.currentSubgame,
      subgamesCatalog: SUBGAMES,
      minRank: this.minRank,
      minRankLabel: RANK_LABELS[this.minRank],
      centerRank: this.centerRank,
      centerRankLabel: RANK_LABELS[this.centerRank],
      suitsOrder: SUITS,
      myHand: this.cardsRevealed ? viewerHand : [],
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
        return {
          id: p.id,
          nickname: p.nickname,
          seatIndex: p.seatIndex,
          connected: connectionMap[p.id] !== false,
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
