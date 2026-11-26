/**
 * Configurația regulilor și punctajelor pentru Rentz Online.
 */

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 6;
const CARDS_PER_PLAYER = 8;

// Ordinea culorilor alternând negru/roșu pentru vizibilitate optimă în mână
const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];

const SUIT_SYMBOLS = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const SUIT_NAMES_RO = {
  spades: 'Pică',
  hearts: 'Cupă',
  diamonds: 'Romb',
  clubs: 'Treflă',
};

const RANK_LABELS = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

const SCORING = {
  // Jocuri negative
  KING_OF_HEARTS: -200,
  QUEEN_MINUS: -30,
  DIAMOND_MINUS: -20,
  NO_TRICKS: -50,

  // Jocuri pozitive
  TEN_OF_CLUBS: 200,
  QUEEN_PLUS: 30,
  DIAMOND_PLUS: 20,
  WHIST_TRICK: 50,

  // Punctaj fix pe podium la Rentz: Locul 1 = 400, Locul 2 = 200, Locul 3 = 100, restul = 0
  RENTZ_PLACE_POINTS: [400, 200, 100],

  getRentzPlacePoints(placeIndex) {
    return this.RENTZ_PLACE_POINTS[placeIndex] || 0;
  },
};

const RENTZ_RULES = {
  // Asul (14) oferă încă o mutare imediată jucătorului (dacă mai are cărți în mână)
  aceExtraTurn: true,
  // Cea mai mică carte din pachet sare următorul jucător activ
  minCardSkipsNext: true,

  /**
   * Cea mai mică valoare din pachet pentru N jucători (exact 8 * N cărți):
   * 3 jucători -> 9..A (24 cărți)
   * 4 jucători -> 7..A (32 cărți)
   * 5 jucători -> 5..A (40 cărți)
   * 6 jucători -> 3..A (48 cărți)
   */
  getMinRank(numPlayers) {
    return 15 - 2 * numPlayers;
  },

  /**
   * Cartea centrală care deschide fiecare culoare la sub-jocul Rentz:
   * 3 jucători -> Q (12)
   * 4 jucători -> J (11)
   * 5 jucători -> 10 (10)
   * 6 jucători -> 9 (9)
   */
  getCenterRank(numPlayers) {
    return 15 - numPlayers;
  },
};

const SUBGAMES = [
  {
    id: 'king_of_hearts',
    name: 'Popa de Inimă Roșie',
    badge: 'K♥',
    type: 'negative',
    mode: 'tricks',
    shortDesc: '-200 pct pentru K♥',
    description:
      'Dacă un jucător ia Popa de Inimă Roșie (K♥), i se scad 200 de puncte. Runda se încheie imediat ce K♥ este luat.',
  },
  {
    id: 'queens',
    name: 'Dame',
    badge: 'Q',
    type: 'negative',
    mode: 'tricks',
    shortDesc: '-30 pct / Damă',
    description: 'Sunt 4 Dame în joc. Pentru fiecare Damă luată se scad 30 de puncte.',
  },
  {
    id: 'diamonds',
    name: 'Romburi',
    badge: '♦',
    type: 'negative',
    mode: 'tricks',
    shortDesc: '-20 pct / Romb',
    description: 'Pentru fiecare Romb (♦) luat se scad 20 de puncte.',
  },
  {
    id: 'no_tricks',
    name: 'No Tricks',
    badge: '−M',
    type: 'negative',
    mode: 'tricks',
    shortDesc: '-50 pct / Mână',
    description: 'Pentru fiecare mână (levată) luată se scad 50 de puncte.',
  },
  {
    id: 'totals_minus',
    name: 'Totale Minus',
    badge: '∑−',
    type: 'negative',
    mode: 'tricks',
    shortDesc: 'K♥ -200 · Q -30 · ♦ -20 · Mână -50',
    description:
      'Cumulează penalizările: Popa de Inimă Roșie (-200), Dame (-30/buc), Romburi (-20/buc) și Mâini luate (-50/mână).',
  },
  {
    id: 'ten_of_clubs',
    name: '10 de Treflă',
    badge: '10♣',
    type: 'positive',
    mode: 'tricks',
    shortDesc: '+200 pct pentru 10♣',
    description:
      'Cine ia 10-le de Treflă (10♣) primește +200 de puncte. Runda se încheie imediat ce 10♣ este luat.',
  },
  {
    id: 'whist',
    name: 'Whist',
    badge: '+M',
    type: 'positive',
    mode: 'tricks',
    shortDesc: '+50 pct / Mână',
    description: 'Pentru fiecare mână (levată) luată se adaugă 50 de puncte.',
  },
  {
    id: 'totals_plus',
    name: 'Totale Plus',
    badge: '∑+',
    type: 'positive',
    mode: 'tricks',
    shortDesc: '10♣ +200 · Q +30 · ♦ +20 · Mână +50',
    description:
      'Cumulează pe plus: 10 de Treflă (+200), Dame (+30/buc), Romburi (+20/buc) și Whist (+50/mână luată).',
  },
  {
    id: 'rentz',
    name: 'Rentz',
    badge: '★',
    type: 'positive',
    mode: 'rentz',
    shortDesc: 'Loc 1: 400 · Loc 2: 200 · Loc 3: 100',
    description:
      'Etalare pe culori de la cartea de mijloc. Locul 1: +400 pct, Locul 2: +200 pct, Locul 3: +100 pct.',
  },
];

const TIMERS = {
  TRICK_RESOLVE_MS: 1600,
  ROUND_SUMMARY_AUTO_MS: 8000,
  LOBBY_DISCONNECT_GRACE_MS: 4500,
};

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  CARDS_PER_PLAYER,
  SUITS,
  SUIT_SYMBOLS,
  SUIT_NAMES_RO,
  RANK_LABELS,
  SCORING,
  RENTZ_RULES,
  SUBGAMES,
  TIMERS,
};
