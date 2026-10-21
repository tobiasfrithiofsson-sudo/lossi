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
  - **Projekt:** flera projekt per användare; alla får ett första projekt "Sandlådan" (delbart som andra, kan bara inte tas bort). Projektmeny (Notion-lik, 28px rader) med Inställningar (namn, avatar, medlemmar, ta bort medlem, bjud in, ta bort projekt / lämna), Bjud in medlemmar, Nytt projekt, Gå med med kod. Översikten visar alla i projektet med Alla/Bara mina; andras upplägg öppnas i läsläge.
  - **Medskapare:** be om redigeringsrätt, skaparen godkänner/nekar eller lägger till medlemmar direkt (välj-lista som Klass), × tar bort. Raden Medskapare visas bara när projektet har ≥ 2 medlemmar.
  - **Inbjudan via e-post + notiser:** klockan i topbaren (inbjudan med Gå med/Avböj, begäran om redigering, blev medskapare, ny medlem). Inbjudan till adress utan konto sparas och räcker för att skapa konto utan kod.
  - **Skapa med AI / Fyll i med AI** (ai-import.js): läraren kopierar en instruktion till sin egen AI och klistrar in ett JSON-kodblock; Lossi anropar aldrig någon AI. Laddningssnurra i knappen.
  - **Filer** på upplägg och aktiviteter (Supabase Storage `plan-files`, 25 MB). Kodat och testat lokalt – **oklart om Tobias kört `supabase/files.sql`**; fråga.
  - **Brödsmulor** på uppläggssidan (projekt › Upplägg › titel).
  - **Kalender/Kommande** visar bara valt projekt.
  - **Designsystem:** typsnitt Open Sans; alla knappar 32px, vikt 500, padding 6px 8px, 6px ikongap, hörn `--radius-xs` (regeln "KNAPPAR" sist i styles.css före MOBIL; gäller även landing/login). Sidopanelen: grupper Kalender / Upplägg / Team med rubrik som fäller ihop (chevron syns vid hovring) och pil till sidan; "+ Skapa" under Upplägg; sidorna Upplägg (roller-coaster), Kalender, Material (Snart), Marknadsplats (candy, Snart) längst ner – flyttade från topbaren, som nu bara har Skapa.

## Nästa steg: Lossi har blivit långsam (Tobias vill åtgärda)
Mätt 2026-10-21 (låtsas-Supabase med räknare): en sidladdning gör ~14 databasanrop; uppläggen hämtas **4–5 gånger** (sidopanelen, översikten, Kommande, sidopanelens Kalender, demo-kontrollen) och varje gång med **hela `state`** – structureHTML är ~4,5 kB per aktivitet (hela redigeringsformuläret sparas), demo-upplägget ~55 kB, ett AI-upplägg med 27 aktiviteter ~150 kB. Delarna av sidan hämtas var för sig och poppar in; uppläggssidan visar demo-innehållet ("Demokrati …") innan det riktiga laddats; pptxgenjs (~160 kB) och lucide (`@latest` = omdirigering, cache 60 s) laddas synkront i `<head>` så sidan blir klickbar sent; Skapa väntar på `rememberChoice` (updateUser, långsamt) innan sidbytet.

Föreslagen städning (Tobias har inte svarat än – fråga om han vill köra 1–4):
1. **Hämta mindre och en gång:** listor väljer bara `id, owner_id, project_id, title, avatar` + `state->>subject`, `state->>grade`, `state->>demoKey` (PostgREST stödjer `alias:state->>fält`); hela state bara för det öppna upplägget och för upplägg som har kalenderhändelser (lektionsnamn). Dela ett hämtresultat per sida (cache i data.js) i stället för 4–5 anrop.
2. **Uppläggssidan:** neutral laddningsvy i stället för demo-HTML tills upplägget hämtats.
3. **Bibliotek:** lås lucide till fast version (t.ex. `lucide@1.61.0` – kontrollera att roller-coaster/candy finns), `defer` där det går, ladda pptxgenjs först vid export.
4. **Skapa:** kör `rememberChoice` i bakgrunden (theme.js `createPlan`, ai-import.js `createPlanFromAi`).
Större, senare: spara aktiviteter som data i stället för HTML.

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
- **Snabbhet** (ovan) – nästa steg.
- **Filer:** bekräfta att `supabase/files.sql` är körd och testad live.
- **Steg 5 projekt:** varning när någon annan redigerar samma upplägg + skydd mot att skriva över (sista sparning vinner i dag).
- **Kalender per lärare:** man kan bara schemalägga egna upplägg; medskapare ser inte kalenderknappen (`lesson_events` har `unique (plan_id, lesson_id)` och kräver ägare).
- **Feedback #4 (Albin):** nya konton har demo-upplägg utan sparade lektioner. Tobias: "låt det vara".
- **Frågor till Tobias:** "aktivitet" → "moment"? Ska `/` visa landningssidan? Gymnasiet som årskurs?
- **Steg 7:** testa export av databasen (`pg_dump`).
