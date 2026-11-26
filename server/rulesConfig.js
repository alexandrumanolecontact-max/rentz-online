/**
 * Configurația regulilor de bază pentru Rentz.
 * Toate punctajele și regulile sunt centralizate aici pentru a putea fi modificate ușor ulterior.
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
  diamonds: 'Caro',
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
  KING_OF_HEARTS: -100,
  QUEEN: -25,
  DIAMOND: -20,
  TRICK_NEGATIVE: -20,
  TEN_OF_CLUBS: 100,
  WHIST_TRICK: 20,

  /**
   * Punctajul în sub-jocul Rentz în funcție de ordinea terminării cărților (0 = locul 1).
   * Ex. în 4 jucători: Locul 1 = +300, Locul 2 = +200, Locul 3 = +100, Locul 4 = 0.
   */
  getRentzPlacePoints(placeIndex, numPlayers) {
    return Math.max(0, (numPlayers - 1 - placeIndex) * 100);
  },
};

const RENTZ_RULES = {
  // Asul (14) oferă încă o mutare imediată jucătorului (dacă mai are cărți în mână)
  aceExtraTurn: true,
  // Cea mai mică carte din pachet sare următorul jucător activ
  minCardSkipsNext: true,

  /**
   * Cea mai mică valoare din pachet pentru N jucători (astfel încât să fie exact 8 * N cărți):
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
    name: 'Popa de Roșu',
    badge: 'K♥',
    type: 'negative',
    mode: 'tricks',
    shortDesc: '-100 pct pentru K♥',
    description: 'Evită levata care conține Regele de Cupă (K♥). Runda se încheie imediat ce K♥ este luat.',
  },
  {
    id: 'queens',
    name: 'Dame',
    badge: 'Q',
    type: 'negative',
    mode: 'tricks',
    shortDesc: '-25 pct / Damă',
    description: 'Evită luarea Damelor (Q). Fiecare Damă luată scade 25 de puncte.',
  },
  {
    id: 'diamonds',
    name: 'Carouri',
    badge: '♦',
    type: 'negative',
    mode: 'tricks',
    shortDesc: '-20 pct / Carou',
    description: 'Evită cărțile de Caro (♦). Fiecare Carou luat scade 20 de puncte.',
  },
  {
    id: 'tricks',
    name: 'Levate',
    badge: '−M',
    type: 'negative',
    mode: 'tricks',
    shortDesc: '-20 pct / Levată',
    description: 'Evită câștigarea levatelor (mâinilor). Fiecare levată luată scade 20 de puncte.',
  },
  {
    id: 'totals',
    name: 'Totale',
    badge: '∑−',
    type: 'negative',
    mode: 'tricks',
    shortDesc: 'K♥ + Dame + ♦ + Levate',
    description: 'Cumulează toate penalizările negative: K♥ (-100), Dame (-25), Carouri (-20) și Levate (-20).',
  },
  {
    id: 'ten_of_clubs',
    name: '10 de Treflă',
    badge: '10♣',
    type: 'positive',
    mode: 'tricks',
    shortDesc: '+100 pct pentru 10♣',
    description: 'Câștigă levata care conține 10 de Treflă (10♣) pentru +100 de puncte.',
  },
  {
    id: 'whist',
    name: 'Whist',
    badge: '+M',
    type: 'positive',
    mode: 'tricks',
    shortDesc: '+20 pct / Levată',
    description: 'Câștigă cât mai multe levate. Fiecare levată câștigată aduce +20 de puncte.',
  },
  {
    id: 'rentz',
    name: 'Rentz',
    badge: '★',
    type: 'positive',
    mode: 'rentz',
    shortDesc: 'Etalare pe culori',
    description: 'Depune cărțile în ordine de la cartea de mijloc în sus și în jos. Asul oferă încă o mutare, iar cartea minimă blochează următorul jucător.',
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
