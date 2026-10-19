// ── Inloggning ──
// All inloggning går via LossiAuth. Sidorna vet inte vilken tjänst som sköter
// den: i dag Supabase Auth med e-post + lösenord, kanske Better Auth senare
// (se docs/migration-plan.md). Kräver supabase-js (CDN) och config.js.
//
// Prototypen skickar inga mail. Konton skapas med en inbjudningskod från ett
// projekt (login.html, Skapa konto); databasen stoppar konton utan giltig kod
// (supabase/projects.sql, steg 3).
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

  async function signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  // Projektnamnet som en inbjudningskod leder till, eller null om koden inte finns
  async function inviteProjectName(code) {
    const { data, error } = await client.rpc('invite_project_name', { code });
    if (error) throw error;
    return data || null;
  }

  // Nytt konto med inbjudningskod: databasen kontrollerar koden, skapar lärarens
  // egna projekt och gör hen till medlem i kodens projekt. Loggar in direkt.
  async function signUpWithCode({ code, displayName, email, password }) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { invite_code: code, display_name: displayName } },
    });
    if (error) throw error;
    if (!data.session) throw new Error('Email not confirmed');
    return data.user;
  }

  // Lärarens namn och avatar. Sparas i Supabase-användarens metadata
  // (display_name syns som "Display name" i Supabase-panelen).
  function profileOf(user) {
    const meta = user?.user_metadata || {};
    return {
      displayName: (meta.display_name || '').trim(),
      avatar: meta.avatar || null,
      email: user?.email || '',
    };
  }

  // Returnerar den uppdaterade användaren
  async function updateProfile({ displayName, avatar }) {
    const { data, error } = await client.auth.updateUser({
      data: { display_name: displayName, avatar },
    });
    if (error) throw error;
    return data.user;
  }

  // Lärarens egna listor, t.ex. klasser ('classes') och ämnen ('subjects'),
  // sparade i användarens metadata så att de finns i alla upplägg och på alla
  // enheter. Returnerar den uppdaterade användaren.
  async function saveUserList(key, values) {
    const { data, error } = await client.auth.updateUser({ data: { [key]: values } });
    if (error) throw error;
    return data.user;
  }

  // För inloggade: byt till ett eget lösenord
  async function changePassword(password) {
    const { error } = await client.auth.updateUser({ password });
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
      window.location.replace('login.html?next=' + encodeURIComponent(next));
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

  return { client, getUser, signIn, inviteProjectName, signUpWithCode, profileOf, updateProfile, saveUserList, changePassword, signOut, requireUser, safeNext, accessToken };
})();
