// ── Google Drive: välj filer i Googles egen filväljare (Picker) ──
// Valda filer laddas ner i webbläsaren och läggs in i Lossi som kopior, med
// samma regler som en vanlig uppladdning (upplag.html, uploadFiles). Behörigheten
// drive.file ger bara åtkomst till filer som läraren väljer här, inte hela Drive.
// Inloggningen hos Google lever bara i minnet på sidan. Google-dokument sparas
// som Word, PowerPoint och Excel. Knappen visas bara när uppgifterna finns i
// config.js. Uppsättning: docs/google-drive.md.
const LossiDrive = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/files/';
  const { googleClientId: clientId, googleApiKey: apiKey, googleProjectNumber: projectNumber } = LOSSI_CONFIG;

  // Googles egna format finns bara på Drive och måste göras om för att laddas ner
  const EXPORTS = {
    'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
    'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
    'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
    'application/vnd.google-apps.drawing': { mime: 'application/pdf', ext: 'pdf' },
  };

  let token = null; // { value, until }
  let scripts = null;

  const enabled = () => Boolean(clientId && apiKey && projectNumber);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Kunde inte hämta ' + src));
      document.head.appendChild(script);
    });
  }

  // Hämtas i förväg, så att Googles inloggningsruta hinner öppnas direkt på klicket
  function preload() {
    scripts = scripts || Promise.all([
      window.google?.accounts ? null : loadScript('https://accounts.google.com/gsi/client'),
      window.gapi ? null : loadScript('https://apis.google.com/js/api.js'),
    ]).then(() => new Promise((resolve, reject) => {
      gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Kunde inte hämta filväljaren')) });
    })).catch(e => { scripts = null; throw e; });
    return scripts;
  }

  // Inloggning hos Google: frågar om lov första gången. → null om läraren avbryter.
  function requestToken() {
    if (token && token.until > Date.now()) return Promise.resolve(token.value);
    return new Promise((resolve, reject) => {
      google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: res => {
          if (res.error) return reject(new Error(res.error));
          token = { value: res.access_token, until: Date.now() + (Number(res.expires_in) - 60) * 1000 };
          resolve(token.value);
        },
        error_callback: err => (err?.type === 'popup_closed' ? resolve(null) : reject(new Error(err?.type || 'Inloggningen misslyckades'))),
      }).requestAccessToken({ prompt: '' });
    });
  }

  // Öppnar filväljaren. → de valda filerna, tom lista om läraren avbryter.
  async function pick() {
    await preload();
    const accessToken = await requestToken();
    if (!accessToken) return [];
    return new Promise(resolve => {
      new google.picker.PickerBuilder()
        .addView(new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true))
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setAppId(projectNumber)
        .setLocale('sv')
        .setTitle('Välj filer från Google Drive')
        .setCallback(data => {
          const action = data[google.picker.Response.ACTION];
          if (action === google.picker.Action.CANCEL) resolve([]);
          if (action !== google.picker.Action.PICKED) return;
          resolve(data[google.picker.Response.DOCUMENTS].map(doc => ({
            id: doc[google.picker.Document.ID],
            name: doc[google.picker.Document.NAME],
            mime: doc[google.picker.Document.MIME_TYPE],
            size: Number(doc.sizeBytes) || 0,
          })));
        })
        .build()
        .setVisible(true);
    });
  }

  // Filnamnet avgör filtypen i Lossi, och på Drive saknar det ofta ändelse
  function fileName(doc, ext) {
    if (!ext || doc.name.toLowerCase().endsWith('.' + ext)) return doc.name;
    return /\.[a-z0-9]{2,5}$/i.test(doc.name) ? doc.name : `${doc.name}.${ext}`;
  }

  // Hämtar en vald fil som en File, redo att laddas upp. Fel har en text att visa.
  async function download(doc) {
    const exported = EXPORTS[doc.mime];
    if (!exported && doc.mime.startsWith('application/vnd.google-apps.')) {
      throw new Error(`${doc.name}: den typen av Google-fil går inte att hämta.`);
    }
    const ext = exported?.ext || LossiData.fileExtension(doc.mime);
    const name = fileName(doc, ext);
    const problem = LossiData.fileProblem({ name, size: doc.size });
    if (problem) throw new Error(problem);

    const url = exported
      ? `${API}${encodeURIComponent(doc.id)}/export?mimeType=${encodeURIComponent(exported.mime)}`
      : `${API}${encodeURIComponent(doc.id)}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token.value}` } });
    if (!res.ok) {
      console.warn('Kunde inte hämta från Drive:', res.status, await res.text().catch(() => ''));
      // Google gör inte om filer som blir större än 10 MB
      throw new Error(`${doc.name} kunde inte hämtas från Drive.${exported && res.status === 403 ? ' Google-filen kan vara för stor (högst 10 MB). Spara den som PDF och försök igen.' : ''}`);
    }
    const blob = await res.blob();
    return new File([blob], name, { type: exported?.mime || doc.mime });
  }

  return { enabled, preload, pick, download };
})();
