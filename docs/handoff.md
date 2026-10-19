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
- **Inloggning:** e-post + lösenord, stängd registrering. Tobias skapar testkonton i Supabase (se "Add a tester" i migration-plan.md). Tobias är admin (`app_metadata.role = 'admin'`).
- **Byggt:** översikt, uppläggssida (struktur med lektioner/aktiviteter, dra och släpp, fäll ihop, ⋯-meny per lektion, duplicera/ta bort upplägg, export Word/PowerPoint), kalender (veckovy + koppla lektioner till tider), profiler (namn + avatar), egna klasser och ämnen (välj-eller-skriv-lista), feedbackknapp + feedbacksida för admin, mobilanpassning, favicon, ny landningssida med riktiga skärmbilder.

## Viktiga filer
- `theme.js` – app-skal (topbar, sidopanel), profil, välj-eller-skriv (`createChoiceList`), Skapa-dialogen.
- `data.js` – all data via `LossiData` (upplägg, kalender, feedback). `auth.js` – `LossiAuth`.
- `upplag.html` – uppläggssidan (mest logik). `schedule.js` – kalenderdialog och gemensam kalenderkod. `calendar.html`, `feedbackboard.html`, `login.html`, `landing.html`.
- `styles.css` – app-stilar; mobil sist under "MOBIL", lektionsboxen under "STRUKTUR OCH TIDSLINJE – lektionen som box".
- `supabase/*.sql` – schema (plans, lesson_events, feedback, admin). `*.local.sql` och `.feedback-token` är git-ignorerade hemligheter.
- `scripts/feedback.sh` – läs/markera testarnas feedback. `scripts/landing-screenshots.mjs` – ta nya skärmbilder till landningssidan (kräver lokal server på 8765). `scripts/mock-supabase.js` – låtsas-Supabase för lokala tester.

## Testa lokalt
- Starta `lossi-static` (python http.server på 8765). Inloggade sidor går inte att öppna utan konto – använd låtsas-Supabase: kopiera `scripts/mock-supabase.js` till `_mock-supabase.js` och gör tillfälliga `_mobile-*.html`-kopior där supabase-js-taggen byts mot `_mock-supabase.js` (se `scripts/landing-screenshots.mjs` för exakt hur). Radera kopiorna efteråt (de är git-exkluderade).
- Dra och släpp: testa med betrodda mushändelser (headless Chrome + CDP, se minnesanteckningarna), och **alltid även efter spara + omladdning** – allt i `#structureList` sparas som HTML.
- Testwebbläsaren cachar hårt: `fetch(fil, {cache:'reload'})` innan omladdning.

## Öppna trådar
- **Delade projekt (pågår):** modell och steg i `docs/migration-plan.md` under "Projects". Steg 1 = `supabase/projects.sql` (Tobias kör den i SQL Editor). Nästa: steg 2, projekt i appen.
- **Feedback #2 (Mange W):** onboarding otydlig – förslag finns (tydlig text om sluten testperiod på inloggning/landning, eller "Skapa konto" med inbjudningskod). Tobias ville vänta.
- **Feedback #4 (Albin Ljung):** fick inte fram lektioner i kalendern – nya konton har demo-upplägg utan sparade lektioner och nya upplägg saknar lektioner. Tobias sa "låt det vara" tills vidare.
- **Fråga till Tobias:** ska "aktivitet" byta namn till "moment" i hela appen (hans Figma säger moment)?
- **Fråga till Tobias:** ska sajtens startadress (`/`) visa landningssidan i stället för appen?
- **Steg 7 kvar:** testa export av databasen (`pg_dump`).
- Efter UI-ändringar som syns på landningssidan: kör `node scripts/landing-screenshots.mjs` och committa `landing/`.
