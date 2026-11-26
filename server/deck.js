const crypto = require('crypto');
const {
  MIN_PLAYERS,
  MAX_PLAYERS,
  SUITS,
  SUIT_SYMBOLS,
  RANK_LABELS,
  RENTZ_RULES,
} = require('./rulesConfig');

function createDeck(numPlayers) {
  if (numPlayers < MIN_PLAYERS || numPlayers > MAX_PLAYERS) {
    throw new Error(`Număr invalid de jucători: ${numPlayers}`);
  }

  const minRank = RENTZ_RULES.getMinRank(numPlayers);
  const deck = [];

  for (const suit of SUITS) {
    for (let value = minRank; value <= 14; value++) {
      deck.push({
        id: `${suit}_${value}`,
        suit,
        value,
        label: RANK_LABELS[value],
        symbol: SUIT_SYMBOLS[suit],
      });
    }
  }

  return deck;
}

function shuffleDeck(deck) {
  const copy = deck.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function sortHand(cards) {
  const suitOrder = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
  return cards.slice().sort((a, b) => {
    if (suitOrder[a.suit] !== suitOrder[b.suit]) {
      return suitOrder[a.suit] - suitOrder[b.suit];
    }
    return a.value - b.value;
  });
}

module.exports = {
  createDeck,
  shuffleDeck,
  sortHand,
};
