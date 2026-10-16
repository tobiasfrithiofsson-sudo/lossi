// ── Inloggning ──
// All inloggning går via LossiAuth. Sidorna vet inte vilken tjänst som sköter
// den: i dag Supabase Auth med e-postlänk (magic link), kanske Better Auth
// senare (se docs/migration-plan.md). Kräver supabase-js (CDN) och config.js.
//
// Skyddade sidor har class="auth-pending" på <html> (döljer sidan) och anropar
// LossiAuth.requireUser() först: utloggade skickas till login.html, inloggade
// får sidan visad.
const LossiAuth = (() => {
  const client = window.supabase.createClient(
    LOSSI_CONFIG.supabaseUrl,
    LOSSI_CONFIG.supabasePublishableKey,
  );

  // Bara sökvägar inom sajten, så att ?next= inte kan skicka vidare till en annan webbplats
  function safeNext(next) {
    return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null;
  }

  async function getUser() {
    const { data } = await client.auth.getSession();
    return data.session?.user || null;
  }

  // Skickar en inloggningslänk. Länken leder tillbaka till next (eller översikten).
  // Finns inget konto för adressen skapas det, så samma flöde gäller nya lärare.
  async function signIn(email, next) {
    const target = new URL(safeNext(next) || 'index.html', window.location.href);
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: target.href },
    });
    if (error) throw error;
  }

  async function signOut() {
    try {
      await client.auth.signOut();
    } finally {
      window.location.href = 'login.html';
    }
  }

  async function requireUser() {
    const user = await getUser();
    if (!user) {
      const next = window.location.pathname + window.location.search;
      // En utgången länk landar här med felet i #-delen; skicka med det så att login.html kan förklara
      const errorHash = /(^|[#&])error=/.test(window.location.hash) ? window.location.hash : '';
      window.location.replace('login.html?next=' + encodeURIComponent(next) + errorHash);
      return new Promise(() => {}); // sidan lämnas; inget mer ska köras
    }
    document.documentElement.classList.remove('auth-pending');
    return user;
  }

  // Senaste åtkomsttoken, för anrop som måste göras utan att vänta (data.js när sidan stängs)
  let currentToken = null;
  function accessToken() {
    return currentToken;
  }

  // Loggas man ut i en annan flik ska den här fliken inte fortsätta visa sidan
  client.auth.onAuthStateChange((event, session) => {
    currentToken = session?.access_token || null;
    if (event === 'SIGNED_OUT' && document.documentElement.dataset.authRequired !== undefined) {
      window.location.replace('login.html');
    }
  });

  return { client, getUser, signIn, signOut, requireUser, safeNext, accessToken };
})();
