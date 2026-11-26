const SUIT_SYMBOLS = {
  spades: '♠',
  hearts: '♥',
  clubs: '♣',
  diamonds: '♦',
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

export function isRedSuit(suit) {
  return suit === 'hearts' || suit === 'diamonds';
}

export function getSuitSymbol(suit) {
  return SUIT_SYMBOLS[suit] || '';
}

export function getRankLabel(value) {
  return RANK_LABELS[value] || String(value);
}

export function createCardElement(card, { playable = false, disabled = false, onClick = null } = {}) {
  const el = document.createElement('div');
  const colorClass = isRedSuit(card.suit) ? 'red' : 'black';
  el.className = `playing-card ${colorClass}`;
  if (playable) el.classList.add('playable');
  if (disabled) el.classList.add('disabled-card');
  el.dataset.cardId = card.id;

  el.innerHTML = `
    <div class="card-corner top">
      <span class="card-rank">${card.label}</span>
      <span class="card-suit-sm">${card.symbol}</span>
    </div>
    <div class="card-center-pip">${card.symbol}</div>
    <div class="card-corner bottom">
      <span class="card-rank">${card.label}</span>
      <span class="card-suit-sm">${card.symbol}</span>
    </div>
  `;

  if (playable && typeof onClick === 'function') {
    el.addEventListener('click', () => onClick(card));
  }

  return el;
}

export function createFaceDownCardElement() {
  const el = document.createElement('div');
  el.className = 'playing-card card-back';
  el.innerHTML = `<div class="card-back-pattern"><span>R</span></div>`;
  return el;
}
