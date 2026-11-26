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

  console.log('4. Verificare sub-joc Rentz Pe Nevazute (800 / 400 / 200 / 0)...');
  assert.strictEqual(game.chooserId, 'p1');
  assert.strictEqual(game.chooseBlindMode('p1', true).ok, true);
  assert.strictEqual(game.getStateForPlayer('p1').myHand.length, 0);
  assert.strictEqual(game.chooseSubgame('p1', 'rentz').ok, true);
  assert.strictEqual(game.getStateForPlayer('p1').myHand.length, 8);

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

  console.log('5. Verificare server Express + Socket.IO si fisiere frontend...');
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
