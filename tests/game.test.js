const assert = require('assert');
const { createDeck } = require('../server/deck');
const { RoomManager } = require('../server/roomManager');
const { RentzGame } = require('../server/gameEngine');
const { TIMERS, SUBGAMES } = require('../server/rulesConfig');

// Reducem timerele pentru rularea rapidă a testelor
TIMERS.TRICK_RESOLVE_MS = 5;
TIMERS.ROUND_SUMMARY_AUTO_MS = 30;

async function playFullTrickRound(game) {
  let cumulativeTrickPoints = 0;
  const scoresBeforeRound = Object.values(game.scores).reduce((a, b) => a + b, 0);

  while (game.phase === 'playing_tricks') {
    const scoresBeforeTrick = Object.values(game.scores).reduce((a, b) => a + b, 0);
    const numPlayers = game.numPlayers;
    for (let step = 0; step < numPlayers; step++) {
      const turnId = game.currentTurnPlayerId;
      const validIds = game.getPlayableTrickCards(turnId);
      assert(validIds.length > 0, 'Trebuie sa existe cel putin o carte jucabila');
      const res = game.playCard(turnId, validIds[0]);
      assert.strictEqual(res.ok, true);
    }
    assert.strictEqual(game.phase, 'trick_complete');
    // Verificam ca scorul s-a actualizat IMEDIAT la finalul mainii (trick_complete)!
    const scoresAfterTrick = Object.values(game.scores).reduce((a, b) => a + b, 0);
    assert.strictEqual(
      scoresAfterTrick - scoresBeforeTrick,
      game.lastTrickPoints,
      'Scorul total trebuie sa se actualizeze imediat dupa fiecare mana!'
    );
    cumulativeTrickPoints += game.lastTrickPoints;
    await new Promise((r) => setTimeout(r, 15));
  }

  // Verificam ca la finalul sub-jocului NU s-au dublat punctele deja adaugate pe parcurs!
  const scoresAfterRound = Object.values(game.scores).reduce((a, b) => a + b, 0);
  assert.strictEqual(
    scoresAfterRound - scoresBeforeRound,
    cumulativeTrickPoints,
    'Scorul final al rundei trebuie sa fie exact suma punctelor pe fiecare mana, fara dubla adunare!'
  );
}

async function runTests() {
  console.log('1. Verificare pachet de carti pentru 3, 4, 5, 6 jucatori si cele 9 sub-jocuri...');
  assert.strictEqual(SUBGAMES.length, 9, 'Trebuie sa fie exact 9 sub-jocuri');
  for (const n of [3, 4, 5, 6]) {
    const deck = createDeck(n);
    assert.strictEqual(deck.length, n * 8, `Pachetul pentru ${n} jucatori trebuie sa aiba ${n * 8} carti`);
  }

  console.log('2. Verificare creare camera, cod invitatie, join, min/max si auto-start la Ready...');
  const rm = new RoomManager();
  const c1 = rm.createRoom('p1', 'Andrei', 'sock1');
  assert.strictEqual(c1.ok, true);
  const code = c1.room.code;

  assert.strictEqual(rm.joinRoom('p2', 'Mihai', code.toLowerCase(), 'sock2').ok, true);
  assert.strictEqual(rm.joinRoom('p3', 'Elena', code, 'sock3').ok, true);
  assert.strictEqual(rm.joinRoom('p4', 'Vlad', code, 'sock4').ok, true);
  rm.toggleReady('p1');
  rm.toggleReady('p2');
  rm.toggleReady('p3');
  assert.strictEqual(rm.toggleReady('p4').started, true);
  c1.room.game.destroy();

  console.log('3. Verificare Pe Vazute (x1) vs Pe Nevazute (x2) + ascunderea cartilor pe server...');
  const players = [
    { id: 'p1', nickname: 'Andrei' },
    { id: 'p2', nickname: 'Mihai' },
    { id: 'p3', nickname: 'Elena' },
    { id: 'p4', nickname: 'Vlad' },
  ];
  const game = new RentzGame(players);

  // La inceputul rundei nimeni nu isi vede cartile pe fir (anti-cheat)
  assert.strictEqual(game.phase, 'deciding_blind');
  const preState = game.getStateForPlayer('p1');
  assert.strictEqual(preState.myHand.length, 0, 'Cartile nu trebuie trimise inainte de decizia Pe Vazute / Pe Nevazute');
  assert.strictEqual(preState.hiddenHandCount, 8);

  // Testam toate cele 8 jocuri pe maini: primele 4 Pe Vazute (x1), urmatoarele 4 Pe Nevazute (x2)!
  const testCases4P = [
    { chooser: 'p1', blind: false, subgame: 'whist', expectedSum: 400 },
    { chooser: 'p2', blind: false, subgame: 'no_tricks', expectedSum: -400 },
    { chooser: 'p3', blind: true, subgame: 'king_of_hearts', expectedSum: -400 }, // -200 * 2
    { chooser: 'p4', blind: true, subgame: 'ten_of_clubs', expectedSum: 400 },    // +200 * 2
    { chooser: 'p1', blind: false, subgame: 'queens', expectedSum: -120 },
    { chooser: 'p2', blind: true, subgame: 'diamonds', expectedSum: -320 },       // -160 * 2
    { chooser: 'p3', blind: true, subgame: 'totals_plus', expectedSum: 1760 },    // +880 * 2
    { chooser: 'p4', blind: true, subgame: 'totals_minus', expectedSum: -1760 },  // -880 * 2
  ];

  for (const tc of testCases4P) {
    assert.strictEqual(game.phase, 'deciding_blind');
    assert.strictEqual(game.chooserId, tc.chooser);
    assert.strictEqual(game.chooseBlindMode(tc.chooser, tc.blind).ok, true);
    assert.strictEqual(game.phase, 'choosing_subgame');

    const chooserState = game.getStateForPlayer(tc.chooser);
    if (tc.blind) {
      assert.strictEqual(
        chooserState.myHand.length,
        0,
        'La Pe Nevazute cartile trebuie sa ramana ascunse pana dupa alegerea sub-jocului!'
      );
      assert.strictEqual(chooserState.hiddenHandCount, 8);
    } else {
      assert.strictEqual(chooserState.myHand.length, 8, 'La Pe Vazute cartile trebuie sa fie vizibile!');
    }

    assert.strictEqual(game.chooseSubgame(tc.chooser, tc.subgame).ok, true);
    assert.strictEqual(
      game.getStateForPlayer(tc.chooser).myHand.length,
      8,
      'Dupa alegerea sub-jocului cartile trebuie sa devina vizibile!'
    );

    await playFullTrickRound(game);
    assert.strictEqual(game.phase, 'round_summary');
    const roundSum = Object.values(game.lastRoundSummary.deltas).reduce((a, b) => a + b, 0);
    assert.strictEqual(
      roundSum,
      tc.expectedSum,
      `Suma la ${tc.subgame} (blind=${tc.blind}) trebuie sa fie ${tc.expectedSum}, dar a fost ${roundSum}`
    );
    players.forEach((p) => game.acknowledgeRoundSummary(p.id));
  }

  console.log('4. Verificare directa pe carte la Totale Plus si Totale Minus (K♥ = 0 la Plus, 10♣ = 0 la Minus, x1 si x2)...');
  const cardCheckGame = new RentzGame(players);
  const trickWithKH = [
    { suit: 'hearts', value: 14 },
    { suit: 'hearts', value: 13 }, // K♥
    { suit: 'hearts', value: 9 },
    { suit: 'hearts', value: 8 },
  ];
  const trickWith10C = [
    { suit: 'clubs', value: 14 },
    { suit: 'clubs', value: 10 }, // 10♣
    { suit: 'clubs', value: 9 },
    { suit: 'clubs', value: 8 },
  ];

  // Totale Plus x1 (Pe Vazute)
  cardCheckGame.currentSubgame = { id: 'totals_plus' };
  cardCheckGame.scoreMultiplier = 1;
  assert.strictEqual(
    cardCheckGame.calculateTrickPoints(trickWithKH).total,
    50,
    'La Totale Plus x1, K♥ trebuie sa valoreze 0 (doar +50 mana Whist)!'
  );
  assert.strictEqual(
    cardCheckGame.calculateTrickPoints(trickWith10C).total,
    250,
    'La Totale Plus x1, 10♣ trebuie sa adauge +200 (+50 mana = +250)!'
  );

  // Totale Plus x2 (Pe Nevazute)
  cardCheckGame.scoreMultiplier = 2;
  assert.strictEqual(
    cardCheckGame.calculateTrickPoints(trickWithKH).total,
    100,
    'La Totale Plus x2, K♥ trebuie sa valoreze 0 (doar +100 mana Whist)!'
  );
  assert.strictEqual(
    cardCheckGame.calculateTrickPoints(trickWith10C).total,
    500,
    'La Totale Plus x2, 10♣ trebuie sa adauge +400 (+100 mana = +500)!'
  );

  // Totale Minus x1 (Pe Vazute)
  cardCheckGame.currentSubgame = { id: 'totals_minus' };
  cardCheckGame.scoreMultiplier = 1;
  assert.strictEqual(
    cardCheckGame.calculateTrickPoints(trickWith10C).total,
    -50,
    'La Totale Minus x1, 10♣ trebuie sa valoreze 0 (doar -50 mana No Tricks)!'
  );
  assert.strictEqual(
    cardCheckGame.calculateTrickPoints(trickWithKH).total,
    -250,
    'La Totale Minus x1, K♥ trebuie sa scada -200 (-50 mana = -250)!'
  );

  // Totale Minus x2 (Pe Nevazute)
  cardCheckGame.scoreMultiplier = 2;
  assert.strictEqual(
    cardCheckGame.calculateTrickPoints(trickWith10C).total,
    -100,
    'La Totale Minus x2, 10♣ trebuie sa valoreze 0 (doar -100 mana No Tricks)!'
  );
  assert.strictEqual(
    cardCheckGame.calculateTrickPoints(trickWithKH).total,
    -500,
    'La Totale Minus x2, K♥ trebuie sa scada -400 (-100 mana = -500)!'
  );
  cardCheckGame.destroy();

  console.log('4b. Verificare sub-joc Rentz Pe Nevazute (800 / 400 / 200 / 0)...');
  assert.strictEqual(game.chooserId, 'p1');
  assert.strictEqual(game.chooseBlindMode('p1', true).ok, true);
  assert.strictEqual(game.getStateForPlayer('p1').myHand.length, 0);
  assert.strictEqual(game.chooseSubgame('p1', 'rentz').ok, true);
  assert.strictEqual(game.getStateForPlayer('p1').myHand.length, 8);
  // Daca din intamplare cineva a primit 4+ capete la aceasta impartire aleatorie, alege sa continue pentru testul 4b
  while (game.phase === 'checking_rentz_refusal') {
    assert.strictEqual(game.decideRentzRefusal(game.currentTurnPlayerId, false).ok, true);
  }

  let safetyCounter = 0;
  while (game.phase === 'playing_rentz' && safetyCounter < 500) {
    safetyCounter++;
    const turnId = game.currentTurnPlayerId;
    const valid = game.getPlayableRentzCards(turnId);
    if (valid.length > 0) {
      assert.strictEqual(game.playCard(turnId, valid[0]).ok, true);
    } else {
      assert.strictEqual(game.passRentzTurn(turnId).ok, true);
    }
  }

  assert.strictEqual(game.phase, 'round_summary');
  const rentzDeltas = Object.values(game.lastRoundSummary.deltas).sort((a, b) => b - a);
  assert.deepStrictEqual(
    rentzDeltas,
    [800, 400, 200, 0],
    'Punctajul la Rentz Pe Nevazute trebuie sa fie 800, 400, 200, 0'
  );

  game.destroy();

  console.log('5. Verificare timer 30s + delay 3s si alegere automata de carte valida...');
  TIMERS.TURN_VISIBLE_MS = 60;
  TIMERS.TURN_GRACE_MS = 60;
  const timerGame = new RentzGame(players);
  timerGame.chooseBlindMode('p1', false);
  timerGame.chooseSubgame('p1', 'whist');
  assert.strictEqual(timerGame.currentTurnPlayerId, 'p1');

  // La 75ms suntem deja la secunda 0 vizibila (60ms), DAR inauntrul ferestrei de gratie (+60ms)!
  await new Promise((r) => setTimeout(r, 75));
  assert.strictEqual(
    timerGame.getStateForPlayer('p1').turnRemainingMs,
    0,
    'Timerul vizibil a ajuns la 0'
  );
  assert.strictEqual(
    timerGame.currentTrick.length,
    0,
    'In timpul delay-ului de gratie de dupa secunda 0 cartea NU trebuie jucata fortat inca!'
  );
  // Jucatorul p1 pune manual chiar in fereastra de gratie -> reuseste!
  const p1Valid = timerGame.getPlayableTrickCards('p1');
  assert.strictEqual(timerGame.playCard('p1', p1Valid[0]).ok, true);
  assert.strictEqual(timerGame.currentTurnPlayerId, 'p2');

  // Acum p2 NU pune nicio carte nici dupa expirarea completa (60ms + 60ms = 120ms) -> serverul joaca automat o carte valida!
  const p2ValidBefore = timerGame.getPlayableTrickCards('p2');
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(timerGame.currentTrick.length, 2, 'p2 trebuia sa puna automat o carte!');
  assert(
    p2ValidBefore.includes(timerGame.currentTrick[1].card.id),
    'Cartea aleasa automat trebuie sa fie din cartile valide disponibile acelei maini!'
  );
  assert.strictEqual(timerGame.currentTurnPlayerId, 'p3');
  timerGame.destroy();
  TIMERS.TURN_VISIBLE_MS = 30000;
  TIMERS.TURN_GRACE_MS = 3000;

  console.log('6. Verificare Bot la iesire voluntara + sistem AFK (2x timeout -> a 3-a oara 10s intra in AFK -> Reia Jocul)...');
  TIMERS.TURN_VISIBLE_MS = 90;
  TIMERS.TURN_GRACE_MS = 20;
  TIMERS.AFK_THIRD_STRIKE_MS = 40;
  TIMERS.BOT_ACTION_DELAY_MS = 15;

  const rmBot = new RoomManager();
  rmBot.createRoom('u1', 'Alex', 's1');
  const bCode = rmBot.getRoomByPlayer('u1').code;
  rmBot.joinRoom('u2', 'Mihai', bCode, 's2');
  rmBot.joinRoom('u3', 'Elena', bCode, 's3');
  rmBot.toggleReady('u1');
  rmBot.toggleReady('u2');
  rmBot.toggleReady('u3');

  const activeRoom = rmBot.rooms.get(bCode);
  assert.strictEqual(activeRoom.status, 'in_game');

  // u1 alege Pe Vazute -> Whist
  activeRoom.game.chooseBlindMode('u1', false);
  activeRoom.game.chooseSubgame('u1', 'whist');

  // u2 paraseste voluntar meciul -> jocul NU se opreste, iar cand ii vine randul u2 (Bot) muta automat!
  const leaveRes = rmBot.leaveRoom('u2');
  assert.strictEqual(activeRoom.status, 'in_game', 'Meciul trebuie sa continue cand iese un jucator!');
  assert.strictEqual(leaveRes.deleted, undefined);
  assert.strictEqual(rmBot.getRoomByPlayer('u2'), null, 'u2 a iesit voluntar si nu mai e legat de camera');

  // u1 joaca prima carte -> randul trece la u2 (Bot), care pune automat o carte valida in ~15ms!
  activeRoom.game.playCard('u1', activeRoom.game.getPlayableTrickCards('u1')[0]);
  await new Promise((r) => setTimeout(r, 35));
  assert.strictEqual(activeRoom.game.currentTurnPlayerId, 'u3', 'Botul lui u2 trebuia sa fi jucat automat!');

  // Testam acum cele 3 abateri consecutive pe u3:
  // Abaterea 1: expira timerul complet -> consecutiveTimeouts devine 1, isAfk ramane false
  await new Promise((r) => setTimeout(r, 130));
  assert.strictEqual(activeRoom.game.seatMeta['u3'].consecutiveTimeouts, 1);
  assert.strictEqual(activeRoom.game.seatMeta['u3'].isAfk, false);

  // Asteptam rezolvarea mainii 1 + deschiderea mainii 2 pana ajunge iar randul la u3
  await new Promise((r) => setTimeout(r, 30));
  while (activeRoom.game.currentTurnPlayerId !== 'u3') {
    const cur = activeRoom.game.currentTurnPlayerId;
    if (!activeRoom.game.isSeatAutomated(cur)) {
      activeRoom.game.playCard(cur, activeRoom.game.getPlayableTrickCards(cur)[0]);
    }
    await new Promise((r) => setTimeout(r, 25));
  }

  // Abaterea 2 pe u3: expira iar timerul complet -> consecutiveTimeouts devine 2, isAfk inca false
  await new Promise((r) => setTimeout(r, 130));
  assert.strictEqual(activeRoom.game.seatMeta['u3'].consecutiveTimeouts, 2);
  assert.strictEqual(activeRoom.game.seatMeta['u3'].isAfk, false);

  // Ajungem la a 3-a tura a lui u3 -> turnIsAfkWarning trebuie sa fie true, iar dupa doar AFK_THIRD_STRIKE_MS (40ms < 110ms!) intra in AFK!
  await new Promise((r) => setTimeout(r, 30));
  while (activeRoom.game.currentTurnPlayerId !== 'u3') {
    const cur = activeRoom.game.currentTurnPlayerId;
    if (!activeRoom.game.isSeatAutomated(cur)) {
      activeRoom.game.playCard(cur, activeRoom.game.getPlayableTrickCards(cur)[0]);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.strictEqual(activeRoom.game.getStateForPlayer('u3').turnIsAfkWarning, true);
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(activeRoom.game.seatMeta['u3'].isAfk, true, 'La a 3-a abatere trebuia sa intre in AFK la pragul de 20s!');

  // u3 inca este in camera (reconectare la login il baga direct in meci!) si apasa Reia Jocul -> iese din AFK!
  const reconU3 = rmBot.reconnectSession('u3', 's3_new', 'Elena');
  assert.strictEqual(reconU3.ok, true, 'Jucatorul AFK reconectat la cont intra automat inapoi in meciul activ!');
  assert.strictEqual(activeRoom.game.resumeFromAfk('u3').ok, true);
  assert.strictEqual(activeRoom.game.seatMeta['u3'].isAfk, false);
  assert.strictEqual(activeRoom.game.seatMeta['u3'].consecutiveTimeouts, 0);

  activeRoom.game.destroy();
  TIMERS.TURN_VISIBLE_MS = 30000;
  TIMERS.TURN_GRACE_MS = 3000;
  TIMERS.AFK_THIRD_STRIKE_MS = 10000;
  TIMERS.BOT_ACTION_DELAY_MS = 400;

  console.log('7. Verificare timer comun 30s (+3s) pentru alegerea Pe Vazute / Nevazute + sub-joc -> fallback Nevazute (x2) + joc random...');
  TIMERS.TURN_VISIBLE_MS = 80;
  TIMERS.TURN_GRACE_MS = 30;
  const selGame = new RentzGame(players);
  assert.strictEqual(selGame.phase, 'deciding_blind');
  const startRem = selGame.getStateForPlayer('p1').turnRemainingMs;
  assert(typeof startRem === 'number' && startRem > 0, 'Timerul de selectie trebuie sa fie pornit inca de la deciding_blind');

  // Chiar daca p1 da click pe "Pe Vazute" dupa 40ms, timerul NU se reseteaza (continua aceleasi secunde),
  // iar daca nu alege si sub-jocul pana la expirare (80+30=110ms), intra fortat pe NEVAZUTE (x2) + sub-joc random!
  await new Promise((r) => setTimeout(r, 40));
  selGame.chooseBlindMode('p1', false);
  const afterModeRem = selGame.getStateForPlayer('p1').turnRemainingMs;
  assert(afterModeRem < 55, 'Timerul NU trebuie resetat intre alegerea Pe Vazute si alegerea sub-jocului!');

  // Asteptam restul timpului (~90ms) fara sa alegem sub-jocul
  await new Promise((r) => setTimeout(r, 95));
  assert.strictEqual(selGame.isBlind, true, 'Daca expira timpul de selectie, jocul trebuie fortat pe NEVAZUTE!');
  assert.strictEqual(selGame.scoreMultiplier, 2, 'Multiplicatorul trebuie sa fie 2 (la dublu)!');
  assert(selGame.currentSubgame !== null, 'Un sub-joc random din cele disponibile trebuie sa fi fost ales!');
  assert(
    selGame.phase === 'playing_tricks' || selGame.phase === 'playing_rentz',
    'Runda trebuie sa fi inceput automat!'
  );
  selGame.destroy();
  TIMERS.TURN_VISIBLE_MS = 30000;
  TIMERS.TURN_GRACE_MS = 3000;

  console.log('8. Verificare regula capete la Rentz (5+ capete in 3 jucatori, 4+ capete in 4-6 jucatori; Cazul 1 & Cazul 2)...');
  const threePlayers = [
    { id: 'a1', nickname: 'Alex' },
    { id: 'a2', nickname: 'Bogdan' },
    { id: 'a3', nickname: 'Cristi' },
  ];

  // Verificam mai intai ca in 3 jucatori cu DOAR 4 capete NU se declanseaza refuzul (trebuie 5+)!
  const cap3Only4 = new RentzGame(threePlayers);
  assert.strictEqual(cap3Only4.minCapeteForRefusal, 5);
  cap3Only4.chooseBlindMode('a1', false);
  cap3Only4.hands['a2'] = [
    { id: 'spades_14', suit: 'spades', value: 14, label: 'A', symbol: '♠' },
    { id: 'hearts_14', suit: 'hearts', value: 14, label: 'A', symbol: '♥' },
    { id: 'clubs_9', suit: 'clubs', value: 9, label: '9', symbol: '♣' },
    { id: 'diamonds_9', suit: 'diamonds', value: 9, label: '9', symbol: '♦' },
    { id: 'spades_11', suit: 'spades', value: 11, label: 'J', symbol: '♠' },
    { id: 'hearts_11', suit: 'hearts', value: 11, label: 'J', symbol: '♥' },
    { id: 'clubs_11', suit: 'clubs', value: 11, label: 'J', symbol: '♣' },
    { id: 'diamonds_11', suit: 'diamonds', value: 11, label: 'J', symbol: '♦' },
  ];
  cap3Only4.hands['a1'] = [
    { id: 'spades_12', suit: 'spades', value: 12, label: 'Q', symbol: '♠' },
    { id: 'hearts_12', suit: 'hearts', value: 12, label: 'Q', symbol: '♥' },
    { id: 'clubs_12', suit: 'clubs', value: 12, label: 'Q', symbol: '♣' },
    { id: 'diamonds_12', suit: 'diamonds', value: 12, label: 'Q', symbol: '♦' },
    { id: 'spades_10', suit: 'spades', value: 10, label: '10', symbol: '♠' },
    { id: 'hearts_10', suit: 'hearts', value: 10, label: '10', symbol: '♥' },
    { id: 'clubs_14', suit: 'clubs', value: 14, label: 'A', symbol: '♣' },
    { id: 'spades_9', suit: 'spades', value: 9, label: '9', symbol: '♠' },
  ];
  cap3Only4.hands['a3'] = [
    { id: 'spades_13', suit: 'spades', value: 13, label: 'K', symbol: '♠' },
    { id: 'hearts_13', suit: 'hearts', value: 13, label: 'K', symbol: '♥' },
    { id: 'clubs_13', suit: 'clubs', value: 13, label: 'K', symbol: '♣' },
    { id: 'diamonds_13', suit: 'diamonds', value: 13, label: 'K', symbol: '♦' },
    { id: 'clubs_10', suit: 'clubs', value: 10, label: '10', symbol: '♣' },
    { id: 'diamonds_10', suit: 'diamonds', value: 10, label: '10', symbol: '♦' },
    { id: 'diamonds_14', suit: 'diamonds', value: 14, label: 'A', symbol: '♦' },
    { id: 'hearts_9', suit: 'hearts', value: 9, label: '9', symbol: '♥' },
  ];
  assert.strictEqual(cap3Only4.chooseSubgame('a1', 'rentz').ok, true);
  assert.strictEqual(cap3Only4.phase, 'playing_rentz', 'In 3 jucatori 4 capete NU trebuie sa declanseze refuzul!');
  cap3Only4.destroy();

  // --- CAZUL 1 in 3 jucatori cu 5 capete: Pe Nevazute (x2) ---
  const capGame = new RentzGame(threePlayers);
  capGame.chooseBlindMode('a1', true);
  capGame.hands['a2'] = [
    { id: 'spades_14', suit: 'spades', value: 14, label: 'A', symbol: '♠' },
    { id: 'hearts_14', suit: 'hearts', value: 14, label: 'A', symbol: '♥' },
    { id: 'clubs_14', suit: 'clubs', value: 14, label: 'A', symbol: '♣' },
    { id: 'clubs_9', suit: 'clubs', value: 9, label: '9', symbol: '♣' },
    { id: 'diamonds_9', suit: 'diamonds', value: 9, label: '9', symbol: '♦' }, // 5 capete!
    { id: 'hearts_11', suit: 'hearts', value: 11, label: 'J', symbol: '♥' },
    { id: 'clubs_11', suit: 'clubs', value: 11, label: 'J', symbol: '♣' },
    { id: 'diamonds_11', suit: 'diamonds', value: 11, label: 'J', symbol: '♦' },
  ];
  capGame.hands['a1'] = [
    { id: 'spades_12', suit: 'spades', value: 12, label: 'Q', symbol: '♠' },
    { id: 'hearts_12', suit: 'hearts', value: 12, label: 'Q', symbol: '♥' },
    { id: 'clubs_12', suit: 'clubs', value: 12, label: 'Q', symbol: '♣' },
    { id: 'diamonds_12', suit: 'diamonds', value: 12, label: 'Q', symbol: '♦' },
    { id: 'spades_10', suit: 'spades', value: 10, label: '10', symbol: '♠' },
    { id: 'hearts_10', suit: 'hearts', value: 10, label: '10', symbol: '♥' },
    { id: 'clubs_10', suit: 'clubs', value: 10, label: '10', symbol: '♣' },
    { id: 'diamonds_10', suit: 'diamonds', value: 10, label: '10', symbol: '♦' },
  ];
  capGame.hands['a3'] = [
    { id: 'spades_13', suit: 'spades', value: 13, label: 'K', symbol: '♠' },
    { id: 'hearts_13', suit: 'hearts', value: 13, label: 'K', symbol: '♥' },
    { id: 'clubs_13', suit: 'clubs', value: 13, label: 'K', symbol: '♣' },
    { id: 'diamonds_13', suit: 'diamonds', value: 13, label: 'K', symbol: '♦' },
    { id: 'spades_11', suit: 'spades', value: 11, label: 'J', symbol: '♠' },
    { id: 'diamonds_14', suit: 'diamonds', value: 14, label: 'A', symbol: '♦' },
    { id: 'spades_9', suit: 'spades', value: 9, label: '9', symbol: '♠' },
    { id: 'hearts_9', suit: 'hearts', value: 9, label: '9', symbol: '♥' },
  ];

  assert.strictEqual(capGame.chooseSubgame('a1', 'rentz').ok, true);
  assert.strictEqual(capGame.phase, 'checking_rentz_refusal');
  assert.strictEqual(capGame.currentTurnPlayerId, 'a2');

  assert.strictEqual(capGame.decideRentzRefusal('a2', true).ok, true);
  assert.strictEqual(capGame.isBlind, true);
  assert.strictEqual(capGame.scoreMultiplier, 2);
  assert.strictEqual(capGame.currentSubgame.id, 'rentz');
  while (capGame.phase === 'checking_rentz_refusal') {
    assert.strictEqual(capGame.decideRentzRefusal(capGame.currentTurnPlayerId, false).ok, true);
  }
  assert.strictEqual(capGame.phase, 'playing_rentz');
  capGame.destroy();

  // --- CAZUL 2 in 4 jucatori cu 4 capete: Pe Vazute (x1) ---
  const capGame2 = new RentzGame(players);
  assert.strictEqual(capGame2.minCapeteForRefusal, 4);
  capGame2.chooseBlindMode('p1', false);
  // Fortam 4 capete (doi Asi + doi de 7) in mana lui p2, si restul fara 4 capete
  capGame2.hands['p2'] = [
    { id: 'spades_14', suit: 'spades', value: 14, label: 'A', symbol: '♠' },
    { id: 'hearts_14', suit: 'hearts', value: 14, label: 'A', symbol: '♥' },
    { id: 'clubs_7', suit: 'clubs', value: 7, label: '7', symbol: '♣' },
    { id: 'diamonds_7', suit: 'diamonds', value: 7, label: '7', symbol: '♦' }, // 4 capete in 4p!
    { id: 'spades_11', suit: 'spades', value: 11, label: 'J', symbol: '♠' },
    { id: 'hearts_11', suit: 'hearts', value: 11, label: 'J', symbol: '♥' },
    { id: 'clubs_11', suit: 'clubs', value: 11, label: 'J', symbol: '♣' },
    { id: 'diamonds_11', suit: 'diamonds', value: 11, label: 'J', symbol: '♦' },
  ];
  capGame2.hands['p1'] = capGame2.hands['p1'].map((c, idx) => ({
    id: `spades_${8 + (idx % 4)}`,
    suit: 'spades',
    value: 9,
    label: '9',
    symbol: '♠',
  }));
  capGame2.hands['p3'] = capGame2.hands['p1'];
  capGame2.hands['p4'] = capGame2.hands['p1'];

  assert.strictEqual(capGame2.chooseSubgame('p1', 'rentz').ok, true);
  assert.strictEqual(capGame2.phase, 'checking_rentz_refusal');
  assert.strictEqual(capGame2.decideRentzRefusal('p2', true).ok, true);
  assert.strictEqual(capGame2.phase, 'choosing_subgame');
  assert.strictEqual(capGame2.isBlind, false);
  assert.strictEqual(capGame2.scoreMultiplier, 1);
  assert.strictEqual(capGame2.cardsRevealed, true);
  assert(
    capGame2.availableSubgames['p1'].includes('rentz'),
    'Rentz trebuie sa redevina disponibil ca p1 sa poata alege tot Rentz sau alt joc!'
  );
  assert.strictEqual(capGame2.chooseSubgame('p1', 'whist').ok, true);
  assert.strictEqual(capGame2.phase, 'playing_tricks');
  capGame2.destroy();

  console.log('9. Verificare ultimul joc ramas al unui jucator -> porneste direct pe puncte normale (x1, fara Pe Nevazute)...');
  const lastSubGame = new RentzGame(players);
  // Simulam ca p2 mai are doar 1 singur joc disponibil ('whist') si urmeaza runda lui p2
  lastSubGame.availableSubgames['p2'] = ['whist'];
  lastSubGame.roundNumber = 1; // startNextRound il va incrementa la 2 -> chooserIdx = 1 ('p2')
  lastSubGame.startNextRound();

  assert.strictEqual(lastSubGame.chooserId, 'p2');
  assert.strictEqual(lastSubGame.isBlind, false, 'Ultimul joc nu poate fi jucat Pe Nevazute!');
  assert.strictEqual(lastSubGame.scoreMultiplier, 1, 'Ultimul joc trebuie jucat la punctaj normal (x1)!');
  assert.strictEqual(lastSubGame.cardsRevealed, true, 'Cartile trebuie sa fie direct vizibile!');
  assert.strictEqual(lastSubGame.currentSubgame.id, 'whist');
  assert.strictEqual(lastSubGame.phase, 'playing_tricks', 'Ultimul joc trebuie sa inceapa direct!');
  lastSubGame.destroy();

  console.log('10. Verificare regula speciala de final: 0 puncte exact la game_over = Locul 1 Castigator...');
  const zeroWinGame = new RentzGame(players);
  zeroWinGame.scores = { p1: 850, p2: 0, p3: 420, p4: -150 };
  // In timpul partidei (nu e game_over), p1 (850) este pe primul loc
  assert.strictEqual(zeroWinGame.getStandings()[0].id, 'p1');
  // La finalul partidei (game_over), p2 (cu 0 puncte exact!) urca pe Locul 1 peste 850!
  zeroWinGame.phase = 'game_over';
  const finalStandings = zeroWinGame.getStandings();
  assert.strictEqual(finalStandings[0].id, 'p2', 'Jucatorul cu exact 0 puncte la final trebuie sa fie pe Locul 1!');
  assert.strictEqual(finalStandings[0].isZeroWinner, true);
  assert.strictEqual(finalStandings[1].id, 'p1');
  assert.strictEqual(finalStandings[2].id, 'p3');
  assert.strictEqual(finalStandings[3].id, 'p4');
  // Iar daca nimeni nu are 0 la final, castiga cel cu punctajul cel mai mare
  zeroWinGame.scores = { p1: 850, p2: 100, p3: 920, p4: -150 };
  assert.strictEqual(zeroWinGame.getStandings()[0].id, 'p3');

  // Verificam si buildMatchEndSummary() folosit pentru istoricul meciurilor si statistici
  zeroWinGame.scores = { p1: 600, p2: 0, p3: 600, p4: -200 };
  zeroWinGame.blindRoundsChosen['p1'] = 3;
  zeroWinGame.blindNetPoints['p1'] = 420;
  zeroWinGame.kingOfHeartsTakenCount['p4'] = 2;
  zeroWinGame.tenOfClubsTakenCount['p2'] = 1;
  const matchEndSummary = zeroWinGame.buildMatchEndSummary();
  assert.strictEqual(matchEndSummary.wonByZero, true);
  assert.strictEqual(matchEndSummary.winnerUserId, 'p2');
  assert.strictEqual(matchEndSummary.players[0].place, 1);
  assert.strictEqual(matchEndSummary.players[0].isZeroWinner, true);
  assert.strictEqual(matchEndSummary.players[1].place, 2);
  assert.strictEqual(matchEndSummary.players[2].place, 2, 'Egalitatea la 600p primeste acelasi loc 2!');
  assert.strictEqual(matchEndSummary.players[3].place, 4);
  zeroWinGame.destroy();

  console.log('11. Verificare avatare profil in lobby, in timpul meciului si actualizare live la schimbarea pozei...');
  const rmAv = new RoomManager();
  const av1 = 'https://rziznxiotbnzexktzxgd.supabase.co/storage/v1/object/public/avatars/u1/avatar.webp?v=1';
  const av2 = 'https://rziznxiotbnzexktzxgd.supabase.co/storage/v1/object/public/avatars/u2/avatar.webp?v=1';
  rmAv.createRoom('u1', 'Alex', 's1', '', av1);
  const avCode = rmAv.getRoomByPlayer('u1').code;
  rmAv.joinRoom('u2', 'Mihai', avCode, 's2', '', av2);
  rmAv.joinRoom('u3', 'Elena', avCode, 's3', '', null);

  const lobbyView = rmAv.serializeRoomForPlayer(rmAv.rooms.get(avCode), 'u1');
  assert.strictEqual(lobbyView.players[0].avatarUrl, av1);
  assert.strictEqual(lobbyView.players[1].avatarUrl, av2);
  assert.strictEqual(lobbyView.players[2].avatarUrl, null);

  rmAv.toggleReady('u1');
  rmAv.toggleReady('u2');
  rmAv.toggleReady('u3');
  const avRoom = rmAv.rooms.get(avCode);
  avRoom.game.chooseBlindMode('u1', false);
  avRoom.game.chooseSubgame('u1', 'whist');
  avRoom.game.playCard('u1', avRoom.game.getPlayableTrickCards('u1')[0]);

  const gameViewBefore = avRoom.game.getStateForPlayer('u2');
  assert.strictEqual(gameViewBefore.players.find((p) => p.id === 'u1').avatarUrl, av1);
  assert.strictEqual(gameViewBefore.currentTrick[0].avatarUrl, av1);

  // u1 isi schimba avatarul in timpul meciului -> se propaga instant in camera si in joc
  const av1Updated = 'https://rziznxiotbnzexktzxgd.supabase.co/storage/v1/object/public/avatars/u1/avatar.webp?v=2';
  rmAv.reconnectSession('u1', 's1', 'Alex', '', av1Updated);
  const gameViewAfter = avRoom.game.getStateForPlayer('u2');
  assert.strictEqual(gameViewAfter.players.find((p) => p.id === 'u1').avatarUrl, av1Updated);
  assert.strictEqual(gameViewAfter.standings.find((p) => p.id === 'u1').avatarUrl, av1Updated);
  avRoom.game.destroy();

  console.log('12. Verificare server Express + Socket.IO si fisiere frontend...');
  const { server, io } = require('../server/index');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  for (const route of [
    '/',
    '/api/health',
    '/api/auth/config',
    '/css/styles.css',
    '/js/app.js',
    '/js/cards.js',
    '/js/sound.js',
    '/manifest.webmanifest',
    '/sw.js',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/socket.io/socket.io.js',
    '/vendor/supabase/supabase.js',
  ]) {
    const res = await fetch(`${baseUrl}${route}`);
    assert.strictEqual(res.status, 200, `Ruta ${route} trebuie sa raspunda cu 200 OK`);
  }

  io.close();
  await new Promise((resolve) => server.close(resolve));

  console.log('TOATE TESTELE AU TRECUT CU SUCCES!');
}

runTests().catch((err) => {
  console.error('Eroare in teste:', err);
  process.exit(1);
});
