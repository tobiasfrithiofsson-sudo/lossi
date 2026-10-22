# Lossi – överlämning (2026-10-21)

Läs den här filen först i en ny session. Detaljer (databas, projekt, filer, notiser, AI) finns i `docs/migration-plan.md`; minnesanteckningarna (MEMORY.md m.fl.) laddas automatiskt.

## Vem och hur
- **Tobias** är UX-designer/systemvetare, inte kodare. Svara på **svenska**, förklara konkret och ge rekommendationer.
- Han skissar i Figma och skickar skärmbilder; matcha mått exakt. Han ger ofta korta CSS-önskemål ("ändra X till padding 6px 8px") – gör exakt det.
- **Databasändringar:** skriv alltid ut hela SQL:en i ett kodblock **i chattmeddelandet, före wrap_up-rutan**, med direktlänk till SQL Editor: https://supabase.com/dashboard/project/mqzmtndjfgeujaqzqpeb/sql/new, och säg vad resultatet ska bli ("Success. No rows returned"). Lägg gärna också SQL:en i urklipp (`pbcopy`). Detta har missats två gånger – Tobias har bett om det uttryckligen. Hemligheter (feedbacknyckeln) visas aldrig i chatten.
- **Filer i `.github/workflows/`** kan inte pushas – Tobias skapar dem via GitHubs webb.
- Committa och pusha till `main` när en ändring är testad; Cloudflare deployar automatiskt (~30 s).

## Läget
- **Live:** https://lossi.tobias-frithiofsson.workers.dev/ (app), `/landing`, `/login`. Repo: `tobiasfrithiofsson-sudo/lossi` (privat).
- **Stack:** statisk HTML/CSS/JS utan byggsteg (lucide, SortableJS, pptxgenjs, supabase-js från CDN). Supabase för data/inloggning/fillagring, Cloudflare Workers (static assets) för hosting.
- **Konton:** registrering öppen men databasen kräver en inbjudningskod eller en väntande inbjudan till e-postadressen; e-postbekräftelse avstängd. "Add user" i Supabase-panelen fungerar inte längre (kontot saknar kod). Tobias är admin (`app_metadata.role = 'admin'`).
- **Byggt (allt testat live om inget annat sägs):**
  - Översikt, uppläggssida (lektioner/aktiviteter, dra och släpp, fäll ihop, ⋯-meny, duplicera/ta bort, export Word/PowerPoint), kalender, profiler, egna klasser/ämnen, feedback + admin-sida, mobil, landningssida med riktiga skärmbilder.
  - **Projekt:** flera projekt per användare; alla får ett första projekt "Sandlådan" (delbart som andra, kan bara inte tas bort). Projektmeny (Notion-lik, 28px rader) med Inställningar – sedan 2026-10-22 en dialog med vänstermeny (`PROJECT_SETTINGS_TABS` i theme.js; lägg nya delar där): Allmänt (namn, avatar, ta bort / lämna), Medlemmar (medlemmar, bjud in), Klasser (lägg till/ta bort projektets klasser, antal upplägg per klass); `openProjectSettings('classes')` öppnar en viss del, Bjud in medlemmar, Nytt projekt, Gå med med kod. Översikten visar alla i projektet med Alla/Bara mina; andras upplägg öppnas i läsläge.
  - **Medskapare:** be om redigeringsrätt, skaparen godkänner/nekar eller lägger till medlemmar direkt (välj-lista som Klass), × tar bort. Raden Medskapare visas bara när projektet har ≥ 2 medlemmar.
  - **Inbjudan via e-post + notiser:** klockan i topbaren (inbjudan med Gå med/Avböj, begäran om redigering, blev medskapare, ny medlem). Inbjudan till adress utan konto sparas och räcker för att skapa konto utan kod.
  - **Skapa med AI / Fyll i med AI** (ai-import.js): läraren kopierar en instruktion till sin egen AI och klistrar in ett JSON-kodblock; Lossi anropar aldrig någon AI. Laddningssnurra i knappen.
  - **Filer** på upplägg och aktiviteter (Supabase Storage `plan-files`, 25 MB). Bilder visas som miniatyr (stor i aktivitetspanelen); klick på en fil öppnar förhandsvisning i Lossi (`openFileViewer`: bild, PDF, text; Office-filer → Ladda ner). PowerPoint-exporten lägger in aktivitetens bilder (högst 4, omgjorda till PNG/JPEG, `loadExportImages`). `supabase/files.sql` körd; fungerar live (Tobias 2026-10-21).
  - **Brödsmulor** på uppläggssidan (projekt › Upplägg › titel).
  - **Kalender/Kommande** visar bara valt projekt. **Projektets kalender (feedback #9, 2026-10-22):** medlemmar ser varandras inlagda lektioner (`supabase/calendar-shared.sql`, bara läsa – ändra/ta bort gäller egna). Kalendern har Mina / Alla i projektet, klassfilter (uppläggets klass), Prov/Inlämning-märkning och en varning när en klass har ≥ 3 prov + inlämningar samma vecka (`LOAD_WARNING_AT` i calendar.html, räknar alla lärare). Lektioner markeras som Prov/Inlämning i lektionens ⋯-meny (`data-assessment` på `.lesson-group`, `LESSON_ASSESSMENTS` i schedule.js). Kommande i sidopanelen/översikten är fortfarande bara egna. **Klasser tillhör projektet (2026-10-22):** `projects.classes` + RPC `add_project_class`/`remove_project_class` (`supabase/project-classes.sql`, flyttar in medlemmarnas profilklasser och uppläggens klasser en gång). Klasslistan i Detaljer visar projektets klasser + klasser på projektets upplägg; utan SQL:en används profilens klasser som förut.
  - **Designsystem:** typsnitt Open Sans. **Knappar (2026-10-22):** `.btn` + variant `.btn-solid` / `.btn-outline` / `.btn-subtle` / `.btn-text`, storlek `.btn-lg` 40px / standard (sm) 32px / `.btn-xs` 24px, ton `.btn-danger`, form `.btn-icon` (kvadratisk). Vikt 500, hörn `--radius-xs`, 1px ram på alla. Systemet bor i `buttons.css`, som alla sidor (även landning och inloggning) laddar direkt efter tokens.css och före sina egna stilar. Landningen använder `.btn-lg`, inloggningens Logga in/Skapa konto också (fälten är 48px). De gamla klasserna (btn-primary, btn-ghost, btn-danger-solid, icon-btn, lp-btn) finns inte längre. Sidopanelen: grupper Kalender / Upplägg / Team med rubrik som fäller ihop (chevron syns vid hovring) och pil till sidan; "+ Skapa" under Upplägg; sidorna Upplägg (roller-coaster), Kalender, Material (Snart), Marknadsplats (candy; `marknadsplats.html` är en teaser med påhittad förhandsvisning, knappen öppnar feedback) längst ner – flyttade från topbaren, som nu bara har Skapa.

## Snabbhet (steg 1–4 gjorda 2026-10-21)
Mätt före: ~14 databasanrop per sidladdning, uppläggen hämtades 4–5 gånger med hela `state` (structureHTML ~4,5 kB per aktivitet, AI-upplägg ~150 kB). Gjort:
1. **Hämta mindre och en gång:** `LossiData.listPlans` hämtar bara `id, owner_id, project_id` + `title/subject/grade/klass/avatar/demoKey/demo` ur state (`alias:state->>fält`), en gång per sida (delad cache i data.js som hålls aktuell vid spara/ta bort/skapa/projektbyte). Hela state bara för det öppna upplägget och via `loadPlanStates/withFullStates` (kalenderns lektionsnamn: `withEventStates` i schedule.js; kalenderns "Lägg in lektion" hämtar vid klick). Samtidiga anrop delas (Kommande, redigeringsförfrågningar). Översikten: 7 anrop.
2. **Uppläggssidan** visar "Hämtar upplägget…" (`body.plan-loading`) i stället för demo-innehållet tills upplägget är hämtat.
3. **Bibliotek:** lucide låst till `1.61.0` (cachas ett år; roller-coaster/candy finns). pptxgenjs laddas först vid PowerPoint-export (`loadPptxLibrary`). `defer` på lucide går inte – sidornas skript anropar `lucide.createIcons()` direkt.
4. **Skapa** väntar inte på profilen: nytt ämne läggs i sessionStorage (`rememberChoiceLater`) och sparas av `applyUserProfile` på nästa sida.
5. **Sidbyten (2026-10-21):** sidopanelen ritas direkt från det senast ritade innehållet (sessionStorage `lossi-aside-cache`, per användare + valt projekt, rensas vid utloggning; `paintAsideFromCache/rememberAsidePart` i theme.js) och uppdateras när datan kommit. `auth.js` visar sidan direkt om en sparad inloggning finns (`storedUserId`). Mjuka sidbyten med `@view-transition` (styles.css): topbar och sidopanel står stilla, innehållet tonar 150 ms. Att bara byta page-frame (ensidesapp) valdes bort – för stort ingrepp i upplag.html.
Större, senare: spara aktiviteter som data i stället för HTML. Låtsas-Supabase förstår nu kolumnlistor och räknar anrop (`window.__mockCalls`). OBS i test: `flushOnLeave` går till riktiga Supabase, vänta i stället in vanliga sparningen (800 ms).

## Viktiga filer
- `theme.js` – app-skal (topbar, sidopanel med grupper/sidor, projektmeny + inställningar, notiser, inbjudningar), profil, `createChoiceList`, Skapa-dialogen.
- `data.js` – all data via `LossiData` (upplägg, projekt, medskapare, inbjudningar, notiser, filer, kalender, feedback). `auth.js` – `LossiAuth`.
- `upplag.html` – uppläggssidan (mest logik: läsläge, medskapare, filer, Fyll i med AI, brödsmulor). `plan-markup.js` – gemensam HTML för aktiviteter/lektioner/målrader (escapar text). `ai-import.js` – Skapa/Fyll i med AI. `schedule.js` – kalenderdialog, Kommande. `calendar.html`, `feedbackboard.html`, `login.html` (Skapa konto med kod/inbjudan), `landing.html`.
- `styles.css` – app-stilar; "KNAPPAR" och "MOBIL" sist. `tokens.css` – färger, typsnitt, radier.
- `supabase/projects.sql` (steg 1–4f, kör i ordning), `supabase/notifications.sql` (ersätter `require_invite_code` – kör om efter projects.sql), `supabase/files.sql`, m.fl. `*.local.sql` och `.feedback-token` är git-ignorerade hemligheter.
- `scripts/feedback.sh` – läs/markera feedback. `scripts/landing-screenshots.mjs` – nya skärmbilder (lokal server på 8765). `scripts/mock-supabase.js` – låtsas-Supabase (projekt, medskapare, inbjudningar, notiser, filer).

## Testa lokalt
- Starta `lossi-static` (python http.server på 8765, `preview_start`). Låtsas-Supabase: kopiera `scripts/mock-supabase.js` till `_mock-supabase.js` och gör `_mobile-*.html`-kopior med supabase-taggen utbytt (sed-mönstret: `s#<script src="https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@[^"]+"></script>#<script src="_mock-supabase.js"></script>#; s#upplag\.html\?id=#_mobile-upplag.html?id=#g`). Radera kopiorna efteråt.
- SQL testas i lokal Postgres (PGlite) med scratchpad-skriptet `pgtest/test.mjs` (172 kontroller) – det försvinner med sessionen; skriv ett nytt vid behov (auth-schema + roller anon/authenticated + `request.jwt.claim.sub`).
- Dra och släpp: riktiga mushändelser via headless Chrome + CDP, **alltid även efter spara + omladdning**.
- Kontrollera att dolda element verkligen döljs (computed `display`, inte bara `hidden`-attributet) – `.read-field { display:flex }` lurade oss en gång.
- Efter UI-ändringar som syns på landningssidan: `node scripts/landing-screenshots.mjs` och committa `landing/`.

## Öppna trådar
- **Snabbhet:** steg 1–4 gjorda (ovan); testa live att allt känns snabbare.
- **Steg 5 projekt:** varning när någon annan redigerar samma upplägg + skydd mot att skriva över (sista sparning vinner i dag).
- **Kalender per lärare:** man ser kollegornas lektioner men kan bara schemalägga egna upplägg; medskapare ser inte kalenderknappen (`lesson_events` har `unique (plan_id, lesson_id)` och kräver ägare).
- **Feedback #4 (Albin):** nya konton har demo-upplägg utan sparade lektioner. Tobias: "låt det vara".
- **Frågor till Tobias:** "aktivitet" → "moment"? Ska `/` visa landningssidan? (Gymnasiet som årskurs: löst 2026-10-21, läraren skriver årskursen själv.)
- **Steg 7:** testa export av databasen (`pg_dump`).
