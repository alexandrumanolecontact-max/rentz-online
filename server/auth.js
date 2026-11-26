const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();

const NICKNAME_COOLDOWN_DAYS = 5;
const NICKNAME_COOLDOWN_MS = NICKNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

function isAuthConfigured() {
  return (
    SUPABASE_URL.startsWith('http') &&
    !SUPABASE_URL.includes('proiectul-tau') &&
    SUPABASE_ANON_KEY.length > 20
  );
}

function createStatelessClient() {
  if (!isAuthConfigured()) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createAuthenticatedClient(accessToken) {
  if (!isAuthConfigured()) return null;
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

function formatRemainingCooldown(nextIso) {
  const diffMs = Math.max(0, new Date(nextIso).getTime() - Date.now());
  const totalHours = Math.ceil(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0 && hours > 0) {
    return `${days} ${days === 1 ? 'zi' : 'zile'} și ${hours} ${hours === 1 ? 'oră' : 'ore'}`;
  }
  if (days > 0) {
    return `${days} ${days === 1 ? 'zi' : 'zile'}`;
  }
  return `${ Math.max(1, hours) } ${hours === 1 ? 'oră' : 'ore'}`;
}

function computeNextChangeIso(changedAtIso) {
  if (!changedAtIso) return null;
  const nextMs = new Date(changedAtIso).getTime() + NICKNAME_COOLDOWN_MS;
  return nextMs > Date.now() ? new Date(nextMs).toISOString() : null;
}

function translateAuthError(message = '') {
  const m = message.toLowerCase();
  if (m.includes('nickname_cooldown_active')) {
    return `Poți schimba nickname-ul doar o dată la ${NICKNAME_COOLDOWN_DAYS} zile.`;
  }
  if (m.includes('invalid login credentials')) {
    return 'Username cont / email sau parolă incorectă.';
  }
  if (m.includes('email not confirmed')) {
    return 'Adresa de email nu a fost confirmată încă. Verifică emailul (inclusiv Spam) sau dezactivează opțiunea Confirm Email în Supabase.';
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Există deja un cont înregistrat cu această adresă de email.';
  }
  if (m.includes('password should be at least')) {
    return 'Parola trebuie să aibă cel puțin 6 caractere.';
  }
  if (m.includes('rate limit') || m.includes('security purposes')) {
    return 'Prea multe încercări într-un interval scurt. Te rugăm să aștepți un minut.';
  }
  if (m.includes('different from the old password') || m.includes('same_password')) {
    return 'Parola nouă trebuie să fie diferită de parola veche.';
  }
  if (m.includes('profiles_display_name_lower_key')) {
    return 'Acest nume de jucător este deja folosit. Alege altul.';
  }
  if (m.includes('profiles_username_lower_key') || m.includes('duplicate key')) {
    return 'Acest username de cont este deja folosit. Alege altul.';
  }
  if (m.includes('relation "public.profiles" does not exist') || m.includes('get_email_for_login')) {
    return 'Tabelul profiles nu a fost creat încă în Supabase. Rulează scriptul supabase/schema.sql în SQL Editor.';
  }
  return message || 'A apărut o eroare la autentificare.';
}

function validateAccountUsername(raw) {
  const username = typeof raw === 'string' ? raw.trim() : '';
  if (username.length < 3 || username.length > 18) {
    return {
      ok: false,
      error: 'Username-ul contului trebuie să aibă între 3 și 18 caractere.',
    };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return {
      ok: false,
      error:
        'Username-ul contului poate conține doar litere, cifre, punct (.), cratimă (-) sau underscore (_), fără spații.',
    };
  }
  return { ok: true, username };
}

function validateDisplayName(raw) {
  const displayName =
    typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (displayName.length < 2 || displayName.length > 18) {
    return {
      ok: false,
      error: 'Numele afișat în joc trebuie să aibă între 2 și 18 caractere.',
    };
  }
  if (!/^[a-zA-Z0-9ăâîșțĂÂÎȘȚ _.-]+$/.test(displayName)) {
    return {
      ok: false,
      error:
        'Numele de jucător poate conține litere, cifre, spații, punct (.), cratimă (-) sau underscore (_).',
    };
  }
  return { ok: true, displayName };
}

function validateEmail(raw) {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Introdu o adresă de email validă.' };
  }
  return { ok: true, email };
}

function sanitizePreferences(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const validThemes = ['emerald', 'royal', 'burgundy', 'noir'];
  return {
    soundEnabled: src.soundEnabled !== false,
    soundVolume:
      typeof src.soundVolume === 'number'
        ? Math.max(0, Math.min(100, Math.round(src.soundVolume)))
        : 70,
    turnAlert: src.turnAlert !== false,
    vibrateOnTurn: src.vibrateOnTurn !== false,
    confirmCardPlay: src.confirmCardPlay === 'double' ? 'double' : 'single',
    handSort: src.handSort === 'desc' ? 'desc' : 'asc',
    tableTheme: validThemes.includes(src.tableTheme) ? src.tableTheme : 'emerald',
  };
}

function buildUserPayload(user, profile) {
  const accountUsername =
    profile?.username ||
    user.user_metadata?.username ||
    (user.email ? user.email.split('@')[0] : 'cont');
  const displayName = profile?.display_name || null;
  const displayNameChangedAt = profile?.display_name_changed_at || null;
  const nextDisplayNameChangeAt = computeNextChangeIso(displayNameChangedAt);

  return {
    id: user.id,
    email: user.email,
    accountUsername,
    displayName,
    needsDisplayName: !displayName,
    displayNameChangedAt,
    nextDisplayNameChangeAt,
    cooldownDays: NICKNAME_COOLDOWN_DAYS,
    preferences: sanitizePreferences(profile?.preferences),
  };
}

async function fetchUserProfile(client, user) {
  const { data: profile } = await client
    .from('profiles')
    .select('username, display_name, display_name_changed_at, preferences')
    .eq('id', user.id)
    .maybeSingle();

  return buildUserPayload(user, profile);
}

async function registerAccount({ username: rawUsername, email: rawEmail, password, redirectTo }) {
  const client = createStatelessClient();
  if (!client) {
    return { ok: false, error: 'Autentificarea Supabase nu este configurată încă pe server.' };
  }

  const uCheck = validateAccountUsername(rawUsername);
  if (!uCheck.ok) return uCheck;

  const eCheck = validateEmail(rawEmail);
  if (!eCheck.ok) return eCheck;

  if (typeof password !== 'string' || password.length < 6) {
    return { ok: false, error: 'Parola trebuie să aibă cel puțin 6 caractere.' };
  }

  const { data: existingProfile, error: profileErr } = await client
    .from('profiles')
    .select('id')
    .eq('username_lower', uCheck.username.toLowerCase())
    .maybeSingle();

  if (profileErr) {
    return { ok: false, error: translateAuthError(profileErr.message) };
  }
  if (existingProfile) {
    return { ok: false, error: 'Acest username de cont este deja folosit. Alege altul.' };
  }

  const { data, error } = await client.auth.signUp({
    email: eCheck.email,
    password,
    options: {
      data: { username: uCheck.username },
      emailRedirectTo: redirectTo || undefined,
    },
  });

  if (error) {
    return { ok: false, error: translateAuthError(error.message) };
  }

  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { ok: false, error: 'Există deja un cont înregistrat cu această adresă de email.' };
  }

  return {
    ok: true,
    needsEmailConfirmation: !data.session,
    accountUsername: uCheck.username,
  };
}

async function loginAccount({ identifier: rawIdentifier, password }) {
  const client = createStatelessClient();
  if (!client) {
    return { ok: false, error: 'Autentificarea Supabase nu este configurată încă pe server.' };
  }

  const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
  if (!identifier || typeof password !== 'string' || !password) {
    return { ok: false, error: 'Completează username-ul contului (sau emailul) și parola.' };
  }

  let email = identifier.toLowerCase();
  if (!identifier.includes('@')) {
    const { data: resolvedEmail, error: rpcErr } = await client.rpc('get_email_for_login', {
      p_username: identifier,
    });
    if (rpcErr) {
      return { ok: false, error: translateAuthError(rpcErr.message) };
    }
    if (!resolvedEmail) {
      return { ok: false, error: 'Username cont / email sau parolă incorectă.' };
    }
    email = resolvedEmail;
  }

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data?.session || !data?.user) {
    return { ok: false, error: translateAuthError(error?.message) };
  }

  const userProfile = await fetchUserProfile(client, data.user);

  return {
    ok: true,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
    user: userProfile,
  };
}

async function setDisplayName({ accessToken, displayName: rawDisplayName }) {
  const verified = await verifyAccessToken(accessToken);
  if (!verified.ok) {
    return verified;
  }

  const dCheck = validateDisplayName(rawDisplayName);
  if (!dCheck.ok) return dCheck;

  const currentUser = verified.user;

  if (currentUser.displayName && currentUser.displayName === dCheck.displayName) {
    return { ok: false, error: 'Noul nickname este identic cu cel actual.' };
  }

  // Dacă are deja un nickname setat, verificăm restricția de 5 zile
  if (currentUser.displayName && currentUser.nextDisplayNameChangeAt) {
    const remaining = formatRemainingCooldown(currentUser.nextDisplayNameChangeAt);
    return {
      ok: false,
      error: `Poți schimba nickname-ul doar o dată la ${NICKNAME_COOLDOWN_DAYS} zile. Mai ai de așteptat ${remaining}.`,
      nextDisplayNameChangeAt: currentUser.nextDisplayNameChangeAt,
    };
  }

  const authedClient = createAuthenticatedClient(accessToken);
  if (!authedClient) {
    return { ok: false, error: 'Autentificare neconfigurată.' };
  }

  const { data: taken, error: checkErr } = await authedClient
    .from('profiles')
    .select('id')
    .eq('display_name_lower', dCheck.displayName.toLowerCase())
    .neq('id', currentUser.id)
    .maybeSingle();

  if (checkErr) {
    return { ok: false, error: translateAuthError(checkErr.message) };
  }
  if (taken) {
    return {
      ok: false,
      error: 'Acest nume de jucător este deja folosit de altcineva. Alege altul.',
    };
  }

  const { data: updated, error: updateErr } = await authedClient
    .from('profiles')
    .update({ display_name: dCheck.displayName })
    .eq('id', currentUser.id)
    .select('username, display_name, display_name_changed_at, preferences')
    .single();

  if (updateErr || !updated) {
    return { ok: false, error: translateAuthError(updateErr?.message) };
  }

  return {
    ok: true,
    user: buildUserPayload(
      { id: currentUser.id, email: currentUser.email },
      updated
    ),
  };
}

async function updateUserPreferences({ accessToken, preferences }) {
  const verified = await verifyAccessToken(accessToken);
  if (!verified.ok) return verified;

  const authedClient = createAuthenticatedClient(accessToken);
  if (!authedClient) {
    return { ok: false, error: 'Autentificare neconfigurată.' };
  }

  const cleanPrefs = sanitizePreferences({
    ...(verified.user.preferences || {}),
    ...(preferences || {}),
  });

  const { data: updated, error } = await authedClient
    .from('profiles')
    .update({ preferences: cleanPrefs })
    .eq('id', verified.user.id)
    .select('username, display_name, display_name_changed_at, preferences')
    .single();

  if (error || !updated) {
    return { ok: false, error: translateAuthError(error?.message) };
  }

  return {
    ok: true,
    preferences: sanitizePreferences(updated.preferences),
  };
}

async function requestPasswordReset({ identifier: rawIdentifier, redirectTo }) {
  const client = createStatelessClient();
  if (!client) {
    return { ok: false, error: 'Autentificarea Supabase nu este configurată încă pe server.' };
  }

  const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
  if (!identifier) {
    return { ok: false, error: 'Introdu adresa ta de email (sau username-ul contului).' };
  }

  let email = identifier.toLowerCase();
  if (!identifier.includes('@')) {
    const { data: resolvedEmail, error: rpcErr } = await client.rpc('get_email_for_login', {
      p_username: identifier,
    });
    if (rpcErr) {
      return { ok: false, error: translateAuthError(rpcErr.message) };
    }
    if (!resolvedEmail) {
      return {
        ok: true,
        message:
          'Dacă există un cont asociat, am trimis pe email linkul pentru resetarea parolei (verifică și Spam).',
      };
    }
    email = resolvedEmail;
  } else {
    const eCheck = validateEmail(email);
    if (!eCheck.ok) return eCheck;
  }

  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: redirectTo || undefined,
  });

  if (error) {
    return { ok: false, error: translateAuthError(error.message) };
  }

  return {
    ok: true,
    message:
      'Am trimis linkul de resetare a parolei pe email! Verifică Inbox-ul (și folderul Spam) și accesează linkul primit.',
  };
}

async function verifyAccessToken(accessToken) {
  const client = createStatelessClient();
  if (!client) {
    return { ok: false, error: 'Autentificare neconfigurată.' };
  }
  if (typeof accessToken !== 'string' || accessToken.length < 16) {
    return { ok: false, error: 'Sesiune invalidă.' };
  }

  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data?.user) {
    return { ok: false, error: 'Sesiunea a expirat. Autentifică-te din nou.' };
  }

  const userProfile = await fetchUserProfile(client, data.user);
  return {
    ok: true,
    user: userProfile,
  };
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  NICKNAME_COOLDOWN_DAYS,
  isAuthConfigured,
  registerAccount,
  loginAccount,
  setDisplayName,
  updateUserPreferences,
  requestPasswordReset,
  verifyAccessToken,
};
