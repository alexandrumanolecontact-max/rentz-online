const assert = require('assert');
const { createDeck } = require('../server/deck');
const { RoomManager } = require('../server/roomManager');
const { RentzGame } = require('../server/gameEngine');
const { TIMERS, SUBGAMES } = require('../server/rulesConfig');

// Reducem timerele pentru rularea rapidă a testelor
TIMERS.TRICK_RESOLVE_MS = 5;
TIMERS.ROUND_SUMMARY_AUTO_MS = 30;

async function playFullTrickRound(game) {
  while (game.phase === 'playing_tricks') {
    const numPlayers = game.numPlayers;
    for (let step = 0; step < numPlayers; step++) {
      const turnId = game.currentTurnPlayerId;
      const validIds = game.getPlayableTrickCards(turnId);
      assert(validIds.length > 0, 'Trebuie sa existe cel putin o carte jucabila');
      const res = game.playCard(turnId, validIds[0]);
      assert.strictEqual(res.ok, true);
    }
    assert.strictEqual(game.phase, 'trick_complete');
    await new Promise((r) => setTimeout(r, 15));
  }
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
  assert.strictEqual(code.length, 6);

  assert.strictEqual(rm.toggleReady('p1').ok, false);
  assert.strictEqual(rm.joinRoom('p2', 'Mihai', code.toLowerCase(), 'sock2').ok, true);
  assert.strictEqual(rm.toggleReady('p1').ok, false);

  assert.strictEqual(rm.joinRoom('p3', 'Elena', code, 'sock3').ok, true);
  assert.strictEqual(rm.toggleReady('p1').started, false);
  assert.strictEqual(rm.toggleReady('p2').started, false);

  assert.strictEqual(rm.joinRoom('p4', 'Vlad', code, 'sock4').ok, true);
  assert.strictEqual(rm.toggleReady('p3').started, false);
  const lastReady = rm.toggleReady('p4');
  assert.strictEqual(lastReady.ok, true);
  assert.strictEqual(lastReady.started, true, 'Jocul trebuie sa inceapa automat cand toti sunt Ready!');
  assert.strictEqual(c1.room.status, 'in_game');
  c1.room.game.destroy();

  console.log('3. Verificare punctaje noi (Whist, No Tricks, Popa -200, 10 Trefla +200, Dame -30, Romburi -20, Totale Plus +880, Totale Minus -880)...');
  const players = [
    { id: 'p1', nickname: 'Andrei' },
    { id: 'p2', nickname: 'Mihai' },
    { id: 'p3', nickname: 'Elena' },
    { id: 'p4', nickname: 'Vlad' },
  ];
  const game = new RentzGame(players);
  assert.strictEqual(game.totalRounds, 36, '4 jucatori * 9 sub-jocuri = 36 runde');

  const expectedRoundTotals4P = [
    { chooser: 'p1', subgame: 'whist', expectedSum: 400 },        // 8 * +50
    { chooser: 'p2', subgame: 'no_tricks', expectedSum: -400 },   // 8 * -50
    { chooser: 'p3', subgame: 'king_of_hearts', expectedSum: -200 },
    { chooser: 'p4', subgame: 'ten_of_clubs', expectedSum: 200 },
    { chooser: 'p1', subgame: 'queens', expectedSum: -120 },      // 4 * -30
    { chooser: 'p2', subgame: 'diamonds', expectedSum: -160 },    // 8 * -20
    { chooser: 'p3', subgame: 'totals_plus', expectedSum: 880 },  // 200 + 120 + 160 + 400
    { chooser: 'p4', subgame: 'totals_minus', expectedSum: -880 },// -200 - 120 - 160 - 400
  ];

  for (const tc of expectedRoundTotals4P) {
    assert.strictEqual(game.chooserId, tc.chooser);
    assert.strictEqual(game.chooseSubgame(tc.chooser, tc.subgame).ok, true);
    await playFullTrickRound(game);
    assert.strictEqual(game.phase, 'round_summary');
    const roundSum = Object.values(game.lastRoundSummary.deltas).reduce((a, b) => a + b, 0);
    assert.strictEqual(
      roundSum,
      tc.expectedSum,
      `Suma punctelor la ${tc.subgame} in 4 jucatori trebuie sa fie ${tc.expectedSum}, dar a fost ${roundSum}`
    );
    players.forEach((p) => game.acknowledgeRoundSummary(p.id));
  }

  console.log('4. Verificare sub-joc Rentz (400 / 200 / 100 / 0 = +700)...');
  assert.strictEqual(game.chooserId, 'p1');
  assert.strictEqual(game.chooseSubgame('p1', 'rentz').ok, true);
  assert.strictEqual(game.phase, 'playing_rentz');

  let safetyCounter = 0;
  while (game.phase === 'playing_rentz' && safetyCounter < 500) {
    safetyCounter++;
    const turnId = game.currentTurnPlayerId;
    const valid = game.getPlayableRentzCards(turnId);
    if (valid.length > 0) {
      assert.strictEqual(game.passRentzTurn(turnId).ok, false);
      assert.strictEqual(game.playCard(turnId, valid[0]).ok, true);
    } else {
      assert.strictEqual(game.passRentzTurn(turnId).ok, true);
    }
  }

  assert.strictEqual(game.phase, 'round_summary');
  const rentzDeltas = Object.values(game.lastRoundSummary.deltas).sort((a, b) => b - a);
  assert.deepStrictEqual(rentzDeltas, [400, 200, 100, 0], 'Punctajul la Rentz trebuie sa fie 400, 200, 100, 0');

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
