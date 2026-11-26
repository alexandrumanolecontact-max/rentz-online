const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY, isAuthConfigured, verifyAccessToken } = require('./auth');

function createAuthedClient(accessToken) {
  if (!isAuthConfigured() || !accessToken) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function isValidUuid(str) {
  return (
    typeof str === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)
  );
}

/**
 * Salvează un meci finalizat în Supabase folosind sesiunea autentificată a unui jucător activ din cameră.
 */
async function saveCompletedMatch(room, summary) {
  if (!isAuthConfigured() || !room || !summary) return { ok: false, skipped: true };

  // Căutăm un jucător uman cu token valid în cameră
  const candidateTokens = room.players
    .filter((p) => !p.isBot && typeof p.accessToken === 'string' && p.accessToken.length > 20)
    .map((p) => p.accessToken);

  if (candidateTokens.length === 0) {
    return { ok: false, skipped: true };
  }

  const playersPayload = summary.players.map((sp) => ({
    user_id: isValidUuid(sp.userId) ? sp.userId : '',
    display_name: sp.displayName,
    place: sp.place,
    final_score: sp.finalScore,
    is_winner: sp.isWinner,
    is_zero_winner: sp.isZeroWinner,
    was_bot: sp.wasBot,
    blind_rounds_chosen: sp.blindRoundsChosen,
    blind_net_points: sp.blindNetPoints,
    king_of_hearts_taken: sp.kingOfHeartsTaken,
    ten_of_clubs_taken: sp.tenOfClubsTaken,
  }));

  const winnerUuid = isValidUuid(summary.winnerUserId) ? summary.winnerUserId : null;

  for (const token of candidateTokens) {
    const client = createAuthedClient(token);
    if (!client) continue;

    const { data, error } = await client.rpc('record_completed_match', {
      p_room_code: room.code,
      p_num_players: summary.numPlayers,
      p_total_rounds: summary.totalRounds,
      p_winner_user_id: winnerUuid,
      p_winner_name: summary.winnerName,
      p_won_by_zero: summary.wonByZero,
      p_players: playersPayload,
    });

    if (!error && data) {
      return { ok: true, matchId: data };
    }
  }

  return { ok: false };
}

/**
 * Calculează statisticile complete, evoluția, palmaresul cu prietenii, ultimele 20 de meciuri și clasamentul general.
 */
async function getProfileStats({ accessToken }) {
  const verified = await verifyAccessToken(accessToken);
  if (!verified.ok) {
    return verified;
  }

  const client = createAuthedClient(accessToken);
  if (!client) {
    return { ok: false, error: 'Baza de date nu este configurată.' };
  }

  const userId = verified.user.id;

  // 1. Preluăm toate participările utilizatorului (pentru statistici all-time exacte)
  const { data: myRows, error: myErr } = await client
    .from('match_players')
    .select(
      'match_id, place, final_score, is_winner, is_zero_winner, was_bot, blind_rounds_chosen, blind_net_points, king_of_hearts_taken, ten_of_clubs_taken, created_at'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (myErr) {
    return { ok: false, error: 'Nu s-au putut încărca statisticile profilului.' };
  }

  const allEntries = myRows || [];
  const totalMatches = allEntries.length;

  let wins = 0;
  let podiums = 0;
  let zeroWins = 0;
  let totalScore = 0;
  let bestScore = null;
  let worstScore = null;
  let blindRoundsChosen = 0;
  let blindNetPoints = 0;
  let kingOfHeartsTaken = 0;
  let tenOfClubsTaken = 0;

  for (const r of allEntries) {
    if (r.is_winner) wins += 1;
    if (r.place <= 3) podiums += 1;
    if (r.is_zero_winner) zeroWins += 1;
    totalScore += r.final_score;
    if (bestScore === null || r.final_score > bestScore) bestScore = r.final_score;
    if (worstScore === null || r.final_score < worstScore) worstScore = r.final_score;
    blindRoundsChosen += r.blind_rounds_chosen || 0;
    blindNetPoints += r.blind_net_points || 0;
    kingOfHeartsTaken += r.king_of_hearts_taken || 0;
    tenOfClubsTaken += r.ten_of_clubs_taken || 0;
  }

  // Calcul serie de victorii (curentă și maximă) — parcurgem cronologic de la cel mai vechi la cel mai nou
  const chronological = allEntries.slice().reverse();
  let currentWinStreak = 0;
  let bestWinStreak = 0;
  let runningStreak = 0;
  for (const r of chronological) {
    if (r.is_winner) {
      runningStreak += 1;
      if (runningStreak > bestWinStreak) bestWinStreak = runningStreak;
    } else {
      runningStreak = 0;
    }
  }
  currentWinStreak = runningStreak;

  const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;
  const avgScore = totalMatches > 0 ? Math.round(totalScore / totalMatches) : 0;

  // Evoluția pe ultimele 20 de meciuri (în ordine cronologică stânga -> dreapta pentru grafic)
  const last20Entries = allEntries.slice(0, 20);
  const evolution = last20Entries
    .slice()
    .reverse()
    .map((r, idx) => ({
      index: idx + 1,
      matchId: r.match_id,
      place: r.place,
      score: r.final_score,
      isWinner: r.is_winner,
      isZeroWinner: r.is_zero_winner,
      createdAt: r.created_at,
    }));

  // 2. Detaliile complete ale ultimelor 20 de meciuri (cine a jucat, cât a făcut fiecare)
  let recentMatches = [];
  const recentMatchIds = last20Entries.map((r) => r.match_id);

  if (recentMatchIds.length > 0) {
    const [{ data: matchHeaders }, { data: participants }] = await Promise.all([
      client
        .from('matches')
        .select('id, room_code, num_players, total_rounds, winner_name, won_by_zero, created_at')
        .in('id', recentMatchIds)
        .order('created_at', { ascending: false }),
      client
        .from('match_players')
        .select(
          'match_id, user_id, display_name, place, final_score, is_winner, is_zero_winner, was_bot, blind_rounds_chosen'
        )
        .in('match_id', recentMatchIds)
        .order('place', { ascending: true }),
    ]);

    const playersByMatch = {};
    for (const p of participants || []) {
      if (!playersByMatch[p.match_id]) playersByMatch[p.match_id] = [];
      playersByMatch[p.match_id].push({
        userId: p.user_id,
        displayName: p.display_name,
        place: p.place,
        finalScore: p.final_score,
        isWinner: p.is_winner,
        isZeroWinner: p.is_zero_winner,
        wasBot: p.was_bot,
        blindRoundsChosen: p.blind_rounds_chosen || 0,
        isMe: p.user_id === userId,
      });
    }

    recentMatches = (matchHeaders || []).map((m) => {
      const mPlayers = playersByMatch[m.id] || [];
      const meInMatch = mPlayers.find((pl) => pl.isMe) || null;
      return {
        id: m.id,
        roomCode: m.room_code,
        numPlayers: m.num_players,
        totalRounds: m.total_rounds,
        winnerName: m.winner_name,
        wonByZero: m.won_by_zero,
        createdAt: m.created_at,
        myPlace: meInMatch?.place || null,
        myScore: meInMatch?.finalScore ?? 0,
        myIsWinner: Boolean(meInMatch?.isWinner),
        myIsZeroWinner: Boolean(meInMatch?.isZeroWinner),
        players: mPlayers,
      };
    });
  }

  // 3. Palmares direct cu prietenii (din ultimele meciuri comune) + Clasament General (Leaderboard)
  const [{ data: allMpRows }, { data: allProfiles }] = await Promise.all([
    client
      .from('match_players')
      .select('match_id, user_id, display_name, place, final_score, is_winner, is_zero_winner')
      .not('user_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000),
    client.from('profiles').select('id, display_name, avatar_url'),
  ]);

  const latestNameById = {};
  const avatarById = {};
  for (const prof of allProfiles || []) {
    if (prof.display_name) latestNameById[prof.id] = prof.display_name;
    if (prof.avatar_url) avatarById[prof.id] = prof.avatar_url;
  }

  for (const m of recentMatches) {
    for (const pl of m.players) {
      pl.avatarUrl = pl.userId ? avatarById[pl.userId] || null : null;
    }
  }

  // Agregăm Clasamentul General între conturi
  const lbMap = new Map();
  for (const row of allMpRows || []) {
    if (!row.user_id) continue;
    let acc = lbMap.get(row.user_id);
    if (!acc) {
      acc = {
        userId: row.user_id,
        displayName: latestNameById[row.user_id] || row.display_name,
        avatarUrl: avatarById[row.user_id] || null,
        matches: 0,
        wins: 0,
        zeroWins: 0,
        totalScore: 0,
        bestScore: row.final_score,
      };
      lbMap.set(row.user_id, acc);
    }
    acc.matches += 1;
    if (row.is_winner) acc.wins += 1;
    if (row.is_zero_winner) acc.zeroWins += 1;
    acc.totalScore += row.final_score;
    if (row.final_score > acc.bestScore) acc.bestScore = row.final_score;
  }

  const leaderboard = Array.from(lbMap.values())
    .map((item) => ({
      ...item,
      winRate: item.matches > 0 ? Math.round((item.wins / item.matches) * 100) : 0,
      isMe: item.userId === userId,
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.totalScore - a.totalScore;
    })
    .slice(0, 20);

  // Agregăm rivalitățile directe din meciurile comune ale utilizatorului
  const myMatchSet = new Set(allEntries.map((e) => e.match_id));
  const myPlaceByMatch = new Map(allEntries.map((e) => [e.match_id, e.place]));
  const rivalsMap = new Map();

  for (const row of allMpRows || []) {
    if (!row.user_id || row.user_id === userId || !myMatchSet.has(row.match_id)) continue;
    let r = rivalsMap.get(row.user_id);
    if (!r) {
      r = {
        userId: row.user_id,
        displayName: latestNameById[row.user_id] || row.display_name,
        sharedMatches: 0,
        finishedAhead: 0,
        finishedBehind: 0,
      };
      rivalsMap.set(row.user_id, r);
    }
    r.sharedMatches += 1;
    const myPl = myPlaceByMatch.get(row.match_id);
    if (typeof myPl === 'number') {
      if (myPl < row.place) r.finishedAhead += 1;
      else if (myPl > row.place) r.finishedBehind += 1;
    }
  }

  const headToHead = Array.from(rivalsMap.values())
    .sort((a, b) => b.sharedMatches - a.sharedMatches)
    .slice(0, 6);

  return {
    ok: true,
    user: verified.user,
    overview: {
      totalMatches,
      wins,
      winRate,
      podiums,
      zeroWins,
      totalScore,
      avgScore,
      bestScore: bestScore ?? 0,
      worstScore: worstScore ?? 0,
      currentWinStreak,
      bestWinStreak,
      blindRoundsChosen,
      blindNetPoints,
      kingOfHeartsTaken,
      tenOfClubsTaken,
    },
    evolution,
    recentMatches,
    headToHead,
    leaderboard,
  };
}

module.exports = {
  saveCompletedMatch,
  getProfileStats,
};
