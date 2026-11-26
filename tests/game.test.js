const assert = require('assert');
const { createDeck } = require('../server/deck');
const { RoomManager } = require('../server/roomManager');
const { RentzGame } = require('../server/gameEngine');
const { TIMERS } = require('../server/rulesConfig');

// Reducem timerele pentru rularea rapidă a testelor
TIMERS.TRICK_RESOLVE_MS = 10;
TIMERS.ROUND_SUMMARY_AUTO_MS = 30;

async function runTests() {
  console.log('1. Verificare pachet de carti pentru 3, 4, 5, 6 jucatori...');
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

  // Nu poti da Ready cu 1 sau 2 jucatori
  assert.strictEqual(rm.toggleReady('p1').ok, false);
  assert.strictEqual(rm.joinRoom('p2', 'Mihai', code.toLowerCase(), 'sock2').ok, true);
  assert.strictEqual(rm.toggleReady('p1').ok, false);

  // Al 3-lea jucator intra -> minimul (3) este atins!
  assert.strictEqual(rm.joinRoom('p3', 'Elena', code, 'sock3').ok, true);
  assert.strictEqual(rm.toggleReady('p1').started, false);
  assert.strictEqual(rm.toggleReady('p2').started, false);

  // Intra al 4-lea jucator inainte ca p3 sa dea Ready -> jocul asteapta pe toti 4!
  assert.strictEqual(rm.joinRoom('p4', 'Vlad', code, 'sock4').ok, true);
  assert.strictEqual(rm.toggleReady('p3').started, false);
  const lastReady = rm.toggleReady('p4');
  assert.strictEqual(lastReady.ok, true);
  assert.strictEqual(lastReady.started, true, 'Jocul trebuie sa inceapa automat cand toti sunt Ready!');
  assert.strictEqual(c1.room.status, 'in_game');
  c1.room.game.destroy();

  console.log('3. Verificare sub-joc pe levate (Whist) si obligatia la culoare...');
  const players = [
    { id: 'p1', nickname: 'Andrei' },
    { id: 'p2', nickname: 'Mihai' },
    { id: 'p3', nickname: 'Elena' },
    { id: 'p4', nickname: 'Vlad' },
  ];
  const game = new RentzGame(players);
  assert.strictEqual(game.phase, 'choosing_subgame');
  assert.strictEqual(game.chooserId, 'p1');
  assert.strictEqual(game.chooseSubgame('p2', 'whist').ok, false, 'Doar chooser-ul poate alege');
  assert.strictEqual(game.chooseSubgame('p1', 'whist').ok, true);
  assert.strictEqual(game.phase, 'playing_tricks');

  // Simulam cele 8 levate la Whist respectand obligatia la culoare
  for (let t = 0; t < 8; t++) {
    for (let step = 0; step < 4; step++) {
      const turnId = game.currentTurnPlayerId;
      const validIds = game.getPlayableTrickCards(turnId);
      assert(validIds.length > 0, 'Trebuie sa existe cel putin o carte jucabila');
      const res = game.playCard(turnId, validIds[0]);
      assert.strictEqual(res.ok, true);
    }
    assert.strictEqual(game.phase, 'trick_complete');
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.strictEqual(game.phase, 'round_summary');
  const sumWhist = Object.values(game.scores).reduce((a, b) => a + b, 0);
  assert.strictEqual(sumWhist, 160, 'Suma punctelor la Whist (8 levate * 20) trebuie sa fie 160');

  // Trecem la runda 2 -> chooser devine p2, testam sub-jocul RENTZ complet!
  players.forEach((p) => game.acknowledgeRoundSummary(p.id));
  assert.strictEqual(game.roundNumber, 2);
  assert.strictEqual(game.chooserId, 'p2');
  assert.strictEqual(game.chooseSubgame('p2', 'rentz').ok, true);
  assert.strictEqual(game.phase, 'playing_rentz');

  console.log('4. Verificare sub-joc Rentz (etalare, As = extra mutare, capat mic = sare jucator, Pas)...');
  let safetyCounter = 0;
  while (game.phase === 'playing_rentz' && safetyCounter < 500) {
    safetyCounter++;
    const turnId = game.currentTurnPlayerId;
    const valid = game.getPlayableRentzCards(turnId);
    if (valid.length > 0) {
      // Verificam ca NU are voie sa spuna Pas daca are carte valida
      assert.strictEqual(game.passRentzTurn(turnId).ok, false);
      assert.strictEqual(game.playCard(turnId, valid[0]).ok, true);
    } else {
      assert.strictEqual(game.passRentzTurn(turnId).ok, true);
    }
  }

  assert.strictEqual(game.phase, 'round_summary', 'Sub-jocul Rentz trebuie sa se finalizeze curat');
  const rentzDeltaSum = Object.values(game.lastRoundSummary.deltas).reduce((a, b) => a + b, 0);
  assert.strictEqual(rentzDeltaSum, 600, 'In 4 jucatori la Rentz suma este 300+200+100+0 = 600');

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
