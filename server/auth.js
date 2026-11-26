const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();

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

function translateAuthError(message = '') {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'Nume de utilizator / email sau parolă incorectă.';
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
  if (m.includes('profiles_username_lower_key') || m.includes('duplicate key')) {
    return 'Acest nume de utilizator este deja folosit. Alege altul.';
  }
  if (m.includes('relation "public.profiles" does not exist') || m.includes('get_email_for_login')) {
    return 'Tabelul profiles nu a fost creat încă în Supabase. Rulează scriptul supabase/schema.sql în SQL Editor.';
  }
  return message || 'A apărut o eroare la autentificare.';
}

function validateUsername(raw) {
  const username = typeof raw === 'string' ? raw.trim() : '';
  if (username.length < 3 || username.length > 18) {
    return {
      ok: false,
      error: 'Numele de utilizator trebuie să aibă între 3 și 18 caractere.',
    };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return {
      ok: false,
      error: 'Numele de utilizator poate conține doar litere, cifre, punct (.), cratimă (-) sau underscore (_), fără spații.',
    };
  }
  return { ok: true, username };
}

function validateEmail(raw) {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Introdu o adresă de email validă.' };
  }
  return { ok: true, email };
}

async function registerAccount({ username: rawUsername, email: rawEmail, password, redirectTo }) {
  const client = createStatelessClient();
  if (!client) {
    return { ok: false, error: 'Autentificarea Supabase nu este configurată încă pe server.' };
  }

  const uCheck = validateUsername(rawUsername);
  if (!uCheck.ok) return uCheck;

  const eCheck = validateEmail(rawEmail);
  if (!eCheck.ok) return eCheck;

  if (typeof password !== 'string' || password.length < 6) {
    return { ok: false, error: 'Parola trebuie să aibă cel puțin 6 caractere.' };
  }

  // Verificăm dacă numele de utilizator este deja ocupat
  const { data: existingProfile, error: profileErr } = await client
    .from('profiles')
    .select('id')
    .eq('username_lower', uCheck.username.toLowerCase())
    .maybeSingle();

  if (profileErr) {
    return { ok: false, error: translateAuthError(profileErr.message) };
  }
  if (existingProfile) {
    return { ok: false, error: 'Acest nume de utilizator este deja folosit. Alege altul.' };
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

  // Dacă Email Enumeration Protection este activ și emailul există deja, identities este gol
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { ok: false, error: 'Există deja un cont înregistrat cu această adresă de email.' };
  }

  return {
    ok: true,
    needsEmailConfirmation: !data.session,
    session: data.session
      ? {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }
      : null,
    user: data.user
      ? {
          id: data.user.id,
          username: uCheck.username,
          email: data.user.email,
        }
      : null,
  };
}

async function loginAccount({ identifier: rawIdentifier, password }) {
  const client = createStatelessClient();
  if (!client) {
    return { ok: false, error: 'Autentificarea Supabase nu este configurată încă pe server.' };
  }

  const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
  if (!identifier || typeof password !== 'string' || !password) {
    return { ok: false, error: 'Completează numele de utilizator (sau emailul) și parola.' };
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
      return { ok: false, error: 'Nume de utilizator / email sau parolă incorectă.' };
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

  const username = await fetchUsernameForUser(client, data.user);

  return {
    ok: true,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
    user: {
      id: data.user.id,
      username,
      email: data.user.email,
    },
  };
}

async function requestPasswordReset({ identifier: rawIdentifier, redirectTo }) {
  const client = createStatelessClient();
  if (!client) {
    return { ok: false, error: 'Autentificarea Supabase nu este configurată încă pe server.' };
  }

  const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
  if (!identifier) {
    return { ok: false, error: 'Introdu adresa ta de email (sau numele de utilizator).' };
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
      // Răspuns neutru pentru confidențialitate
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

async function fetchUsernameForUser(client, user) {
  const { data: profile } = await client
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle();

  if (profile && profile.username) {
    return profile.username;
  }
  return user.user_metadata?.username || (user.email ? user.email.split('@')[0] : 'Jucător');
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

  const username = await fetchUsernameForUser(client, data.user);
  return {
    ok: true,
    user: {
      id: data.user.id,
      username,
      email: data.user.email,
    },
  };
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  isAuthConfigured,
  registerAccount,
  loginAccount,
  requestPasswordReset,
  verifyAccessToken,
};
