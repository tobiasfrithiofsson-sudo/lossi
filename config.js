// ── Supabase-projektet ──
// Används av data.js och auth.js (steg 5–6 i docs/migration-plan.md).
// Båda värdena är publika med avsikt: de skickas till varje besökares
// webbläsare. Skyddet sitter i databasens regler (supabase/schema.sql).
// Google-uppgifterna (docs/google-drive.md) är också publika: de är låsta till
// Lossis adress hos Google. Tomma = knappen Google Drive visas inte.
// Lägg ALDRIG secret/service_role-nyckeln eller databaslösenordet här.
const LOSSI_CONFIG = {
  supabaseUrl: 'https://mqzmtndjfgeujaqzqpeb.supabase.co',
  supabasePublishableKey: 'sb_publishable__AjC-8yqjsBivM-xgN4DHQ__zZQ2sNa',
  googleClientId: '344318887994-6orcbdm06nt0igukr5r0ie2lrqmt3s0v.apps.googleusercontent.com',
  googleApiKey: 'AIzaSyAXb_Wp-QZAjnM5VHoo1h56xanTuRg37Kw',
  googleProjectNumber: '344318887994',
};
