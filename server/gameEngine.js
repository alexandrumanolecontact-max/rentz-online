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
    this.phase = 'choosing_subgame';
    this.chooserId = this.players[0].id;
    this.currentSubgame = null;
    this.hands = {};
    this.tricksWon = {};
    this.capturedCards = {};
    this.trickNumber = 1;
    this.leadPlayerId = null;
    this.currentTurnPlayerId = null;
    this.currentTrick = [];
    this.lastTrick = null;
    this.trickWinnerId = null;
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

    this.players.forEach((p, idx) => {
      const slice = deck.slice(idx * CARDS_PER_PLAYER, (idx + 1) * CARDS_PER_PLAYER);
      this.hands[p.id] = sortHand(slice);
      this.tricksWon[p.id] = 0;
      this.capturedCards[p.id] = [];
    });

    this.currentSubgame = null;
    this.trickNumber = 1;
    this.leadPlayerId = this.chooserId;
    this.currentTurnPlayerId = this.chooserId;
    this.currentTrick = [];
    this.lastTrick = null;
    this.trickWinnerId = null;
    this.rentzBoard = null;
    this.rentzFinishOrder = [];
    this.rentzLastAction = '';
    this.summaryContinueSet.clear();

    this.phase = 'choosing_subgame';
    this.statusBanner = `${chooser.nickname} își privește cărțile și alege sub-jocul...`;
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
    const chooser = this.getPlayerById(playerId);

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
      this.rentzLastAction = `${chooser.nickname} a ales Rentz! Fiecare culoare se deschide cu ${centerLabel}.`;
      this.statusBanner = this.rentzLastAction;
    } else {
      this.phase = 'playing_tricks';
      this.trickNumber = 1;
      this.leadPlayerId = this.chooserId;
      this.currentTurnPlayerId = this.chooserId;
      this.currentTrick = [];
      this.statusBanner = `${chooser.nickname} a ales ${subgame.name}. ${chooser.nickname} deschide mâna!`;
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
    for (const entry of this.currentTrick) {
      this.capturedCards[winnerId].push(entry.card);
    }

    this.phase = 'trick_complete';
    this.trickWinnerId = winnerId;
    this.currentTurnPlayerId = null;
    this.statusBanner = `${winner.nickname} ia levata cu ${winningEntry.card.label}${winningEntry.card.symbol}!`;

    this.clearPendingTimer();
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.completeTrickTransition(winnerId);
      this.onStateChange();
    }, TIMERS.TRICK_RESOLVE_MS);

    return { ok: true };
  }

  completeTrickTransition(winnerId) {
    this.lastTrick = {
      winnerId,
      winnerName: this.getPlayerById(winnerId)?.nickname || '',
      cards: this.currentTrick.slice(),
    };
    this.currentTrick = [];
    this.trickWinnerId = null;

    const earlyEndReason = this.checkTrickEarlyEnd();
    if (earlyEndReason || this.trickNumber >= CARDS_PER_PLAYER) {
      const deltas = this.scoreTrickRound();
      const reason = earlyEndReason || 'Cele 8 levate s-au încheiat.';
      this.finishRound(deltas, reason);
      return;
    }

    this.trickNumber += 1;
    this.leadPlayerId = winnerId;
    this.currentTurnPlayerId = winnerId;
    this.phase = 'playing_tricks';
    const winner = this.getPlayerById(winnerId);
    this.statusBanner = `Levata ${this.trickNumber}/${CARDS_PER_PLAYER} — ${winner.nickname} deschide!`;
  }

  checkTrickEarlyEnd() {
    if (!this.currentSubgame) return null;
    const allCaptured = Object.values(this.capturedCards).flat();

    switch (this.currentSubgame.id) {
      case 'king_of_hearts': {
        if (allCaptured.some((c) => c.suit === 'hearts' && c.value === 13)) {
          return 'Regele de Cupă (K♥) a fost luat!';
        }
        return null;
      }
      case 'ten_of_clubs': {
        if (allCaptured.some((c) => c.suit === 'clubs' && c.value === 10)) {
          return '10 de Treflă (10♣) a fost câștigat!';
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
          return 'Toate Carourile au fost luate!';
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
      } else if (subId === 'queens') {
        pts = queensCount * SCORING.QUEEN;
      } else if (subId === 'diamonds') {
        pts = diamondsCount * SCORING.DIAMOND;
      } else if (subId === 'tricks') {
        pts = tricks * SCORING.TRICK_NEGATIVE;
      } else if (subId === 'ten_of_clubs') {
        pts = has10C ? SCORING.TEN_OF_CLUBS : 0;
      } else if (subId === 'whist') {
        pts = tricks * SCORING.WHIST_TRICK;
      } else if (subId === 'totals') {
        pts =
          (hasKH ? SCORING.KING_OF_HEARTS : 0) +
          queensCount * SCORING.QUEEN +
          diamondsCount * SCORING.DIAMOND +
          tricks * SCORING.TRICK_NEGATIVE;
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

  finishRound(deltas, reason) {
    this.clearPendingTimer();

    const totalsAfter = {};
    for (const p of this.players) {
      const delta = deltas[p.id] || 0;
      this.scores[p.id] += delta;
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

    return {
      phase: this.phase,
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      chooserId: this.chooserId,
      leadPlayerId: this.leadPlayerId,
      currentTurnPlayerId: this.currentTurnPlayerId,
      trickNumber: this.trickNumber,
      trickWinnerId: this.trickWinnerId,
      statusBanner: this.statusBanner,
      currentSubgame: this.currentSubgame,
      subgamesCatalog: SUBGAMES,
      minRank: this.minRank,
      minRankLabel: RANK_LABELS[this.minRank],
      centerRank: this.centerRank,
      centerRankLabel: RANK_LABELS[this.centerRank],
      suitsOrder: SUITS,
      myHand: this.hands[viewerId] || [],
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
