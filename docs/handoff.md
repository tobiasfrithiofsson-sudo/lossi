# Lossi – överlämning (2026-10-19)

Läs den här filen först i en ny session. Detaljer om backend, kalender och feedback finns i `docs/migration-plan.md`.

## Vem och hur
- **Tobias** är UX-designer/systemvetare, inte kodare. Svara på **svenska**, förklara steg konkret och ge rekommendationer.
- Han skissar i Figma och skickar skärmbilder; matcha mått exakt (t.ex. 24px höjder, 4px hörn).
- **Databasändringar:** visa alltid SQL:en i ett kodblock + direktlänk till SQL Editor: https://supabase.com/dashboard/project/mqzmtndjfgeujaqzqpeb/sql/new. Hemligheter (feedbacknyckeln) visas aldrig i chatten – lägg dem i urklipp (`pbcopy`).
- **Filer i `.github/workflows/`** kan inte pushas (token saknar behörighet) – Tobias skapar dem via GitHubs webb.
- Committa och pusha till `main` när en ändring är testad; Cloudflare deployar automatiskt (~30 s).

## Läget
- **Live:** https://lossi.tobias-frithiofsson.workers.dev/ (app) och `/landing` (landningssida). Repo: `tobiasfrithiofsson-sudo/lossi` (privat).
- **Stack:** statisk HTML/CSS/JS utan byggsteg (lucide, SortableJS, pptxgenjs, supabase-js från CDN). Supabase för data/inloggning, Cloudflare Workers (static assets) för hosting.
- **Inloggning:** e-post + lösenord, stängd registrering. testare skapar konto själva med en inbjudningskod (se "Add a tester" i migration-plan.md). Tobias är admin (`app_metadata.role = 'admin'`).
- **Byggt:** översikt, uppläggssida (struktur med lektioner/aktiviteter, dra och släpp, fäll ihop, ⋯-meny per lektion, duplicera/ta bort upplägg, export Word/PowerPoint), kalender (veckovy + koppla lektioner till tider), profiler (namn + avatar), egna klasser och ämnen (välj-eller-skriv-lista), feedbackknapp + feedbacksida för admin, mobilanpassning, favicon, ny landningssida med riktiga skärmbilder.

## Viktiga filer
- `theme.js` – app-skal (topbar, sidopanel), profil, välj-eller-skriv (`createChoiceList`), Skapa-dialogen.
- `data.js` – all data via `LossiData` (upplägg, kalender, feedback). `auth.js` – `LossiAuth`.
- `upplag.html` – uppläggssidan (mest logik). `plan-markup.js` – gemensam HTML för aktiviteter/lektioner/målrader. `ai-import.js` – Skapa med AI. `schedule.js` – kalenderdialog och gemensam kalenderkod. `calendar.html`, `feedbackboard.html`, `login.html`, `landing.html`.
- `styles.css` – app-stilar; mobil sist under "MOBIL", lektionsboxen under "STRUKTUR OCH TIDSLINJE – lektionen som box".
- `supabase/*.sql` – schema (plans, lesson_events, feedback, admin, projects, files). `*.local.sql` och `.feedback-token` är git-ignorerade hemligheter.
- `scripts/feedback.sh` – läs/markera testarnas feedback. `scripts/landing-screenshots.mjs` – ta nya skärmbilder till landningssidan (kräver lokal server på 8765). `scripts/mock-supabase.js` – låtsas-Supabase för lokala tester.

## Testa lokalt
- Starta `lossi-static` (python http.server på 8765). Inloggade sidor går inte att öppna utan konto – använd låtsas-Supabase: kopiera `scripts/mock-supabase.js` till `_mock-supabase.js` och gör tillfälliga `_mobile-*.html`-kopior där supabase-js-taggen byts mot `_mock-supabase.js` (se `scripts/landing-screenshots.mjs` för exakt hur). Radera kopiorna efteråt (de är git-exkluderade).
- Dra och släpp: testa med betrodda mushändelser (headless Chrome + CDP, se minnesanteckningarna), och **alltid även efter spara + omladdning** – allt i `#structureList` sparas som HTML.
- Testwebbläsaren cachar hårt: `fetch(fil, {cache:'reload'})` innan omladdning.

## Öppna trådar
- **Filer** byggt 2026-10-20 (se migration-plan.md "Files") – Tobias ska köra `supabase/files.sql`. Gratisnivån har ca 1 GB lagring; håll koll på utrymmet.
- **Skapa med AI / Fyll i med AI** byggt 2026-10-20 (se migration-plan.md "Skapa med AI"), testat lokalt – Tobias har inte testat live än. Gymnasiet saknas som årskurs (AI-importen lämnar den tom).
- **Delade projekt (pågår):** modell och steg i `docs/migration-plan.md` under "Projects". Steg 1 klart och körd. Steg 2 (projektväljare, Alla/Bara mina, personlig sidopanel, läsläge) byggt och testat live 2026-10-19 (Sandlådan är skapat som delat projekt via SQL). Steg 3 + 3b (inbjudningskod, Skapa projekt) klara och testade live 2026-10-19; registrering påslagen, e-postbekräftelse av; feedback #2 markerad klar. Steg 4 (medskapare: be om/godkänn/neka/ta bort redigeringsrätt) byggt och testat live 2026-10-19. Steg 4b (Ta bort projekt, uppläggen flyttas till skaparnas egna) klart och testat live 2026-10-20. Nästa: steg 5 varning vid samtidig redigering, och kalendern per lärare (schemalägga kollegors lektioner).
- **Feedback #4 (Albin Ljung):** fick inte fram lektioner i kalendern – nya konton har demo-upplägg utan sparade lektioner och nya upplägg saknar lektioner. Tobias sa "låt det vara" tills vidare.
- **Fråga till Tobias:** ska "aktivitet" byta namn till "moment" i hela appen (hans Figma säger moment)?
- **Fråga till Tobias:** ska sajtens startadress (`/`) visa landningssidan i stället för appen?
- **Steg 7 kvar:** testa export av databasen (`pg_dump`).
- Efter UI-ändringar som syns på landningssidan: kör `node scripts/landing-screenshots.mjs` och committa `landing/`.
