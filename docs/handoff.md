# Lossi – överlämning (2026-10-22)

Läs den här filen först i en ny session. Detaljer (databas, projekt, filer, notiser, AI) finns i `docs/migration-plan.md`; minnesanteckningarna (MEMORY.md m.fl.) laddas automatiskt.

## Vem och hur
- **Tobias** är UX-designer/systemvetare, inte kodare. Svara på **svenska**, förklara konkret och ge rekommendationer (en tydlig rekommendation, inte en lista med alternativ).
- Han skissar i Figma och skickar skärmbilder; matcha mått exakt. Han ger ofta korta CSS-önskemål ("ändra X till padding 6px 8px") – gör exakt det. Han vill ha designen så nära skisserna som möjligt.
- **Databasändringar:** skriv alltid ut hela SQL:en i ett kodblock **i chattmeddelandet, före wrap_up-rutan**, med direktlänk till SQL Editor: https://supabase.com/dashboard/project/mqzmtndjfgeujaqzqpeb/sql/new, och säg vad resultatet ska bli ("Success. No rows returned"). Lägg också SQL:en i urklipp (`pbcopy`). Hemligheter (feedbacknyckeln) visas aldrig i chatten.
- **Filer i `.github/workflows/`** kan inte pushas – Tobias skapar dem via GitHubs webb.
- **Committa och pusha till `main`** när en ändring är testad; Cloudflare deployar (~40–60 s). **Kontrollera alltid att ändringen faktiskt är live** (curl på en ny sträng i filen) innan du säger att den är klar. 2026-10-22 missade Cloudflare en push helt (ingen bock på commiten i GitHub); en tom commit (`git commit --allow-empty`) satte igång bygget igen.
- Feedback från testare: `bash scripts/feedback.sh list` (se minnet lossi-feedback).

## Välkomst och rundtur i appen (2026-10-23, efter Tobias skisser)
- Efter Starta i onboardingen (`localStorage['lossi-welcome'] = '1'`) visar översikten en **dialog i tre steg** (986 × 562 px, text till vänster, maskoten i en 423 × 482-bild till höger): Välkommen till Lossi → Använd inte riktiga personuppgifter (med blå infoplatta) → Få en rundtur (Hoppa över / Starta rundturen). Texterna är Tobias.
- **Rundturen**: pratbubbla (342 px, maskoten överst, Avsluta rundtur / Nästa, pil mot målet) och en markering runt målet, resten tonas ner. Steg: Projekt, Skapa, Upplägg, Kalender, Feedback (`TOUR_STEPS` i tour.js – lägg till steg där). Steg vars mål inte syns hoppas över (i mobil ligger sidopanelen undan). Esc avslutar.
- **Kom igång** i toppraden bredvid Feedback (theme.js `openOnboarding`) visar välkomstdialogen och rundturen igen; från andra sidor via `index.html?kom-igang` (`?rundtur` hoppar direkt till rundturen).
- **Maskoten** är nu gemensam: `mascot.js` (`createMascot`, `blinkNowAndThen`) + `mascot.css`, används av onboarding.js och tour.js. Den tittar mot det rundturen visar; bilderna har små svävande ikoner (`tour-prop`).
- Den gamla välkomstrutan (`#welcomeCard`) är borttagen.
- **Tips i upplägget** (2026-10-23): första gången man öppnar ett upplägg man får redigera visar samma bubblor sex tips – Lektioner, Aktiviteter, Lektionens meny, Lägg in i kalendern, Filer, Exportera (`PLAN_TIPS` i tour.js, `maybeShowPlanTips()` sist i upplag.html). Visas en gång (`localStorage['lossi-plan-tips']`), "Stäng tipsen" eller Klar. `scripts/drag-test.mjs` stänger tipsen innan den drar.
- Möjliga nästa steg: tomma lägen med hjälptext.

## SQL (Tobias har kört alla, bekräftat 2026-10-22)
Alla filer går att köra om. Ordning: efter `projects.sql`, `notifications.sql`, `feedback-admin.sql`.
1. `supabase/calendar-shared.sql` – medlemmar ser varandras kalenderhändelser (#9). Tobias testade kalendern men hade inte kollat kollegornas lektioner.
2. `supabase/project-classes.sql` – klasser tillhör projektet.
3. `supabase/access-codes.sql` – fristående koder, onboarding. **Utan den går det inte att skapa konto med kod live.**
4. Om (3) kördes före 2026-10-22 kl ~22: den lilla uppdateringen av `require_invite_code()` (kod krävs av alla, även inbjudna) – den finns redan i filen, så det räcker att köra om hela `access-codes.sql`.
Efter (3): skapa en kod på **Admin → Koder** för att testa onboardingen live.

## Läget
- **Live:** https://lossi.tobias-frithiofsson.workers.dev/ (app), `/landing`, `/login`, `/admin`. Repo: `tobiasfrithiofsson-sudo/lossi` (privat).
- **Stack:** statisk HTML/CSS/JS utan byggsteg (lucide 1.61.0, SortableJS, pptxgenjs vid export, supabase-js från CDN). Supabase för data/inloggning/fillagring, Cloudflare Workers (static assets) för hosting.
- **Konton:** Skapa konto är en onboarding i tre steg (`onboarding.js`, login.html; prickar visar steget):
  1. **Ange kod** – 6 rutor (större text, hopp till nästa ruta, klistra in, `login.html?kod=ABC123` fyller i). **Alla behöver en kod**, även den som bjudits in via e-post.
  2. **Skapa konto** – förnamn, efternamn, e-post (info: använd privat e-post under testperioden), lösenord. Kontot skapas här.
  3. **Ditt projekt** – den egna ytan "{Förnamn}s yta" (avatar + namn, inget fält) och inbjudningar till kollegors projekt (Gå med / Avstå). Ingen Tillbaka. **Starta** öppnar alltid den egna ytan.
  Högerytan: maskoten (min egen SVG efter Tobias bild; ögonen följer pekaren och fältet man skriver i, blundar vid lösenordet, blinkar, glad/ledsen vid rätt/fel kod) och i steg 3 en liten projektväljare som visar projekt man går med i. Bilden döljs under 900 px.
  Koderna skapas av administratörer på **admin.html → Koder** (gäller till ett datum eller tills vidare, kan avslutas/öppnas igen, kopiera kod/länk, visar vilka som skapat konto med koden). Inte kopplade till projekt, kan användas av flera. Databas: `supabase/access-codes.sql`. Tobias är admin (`app_metadata.role = 'admin'`). E-postbekräftelse avstängd; Lossi skickar inga mejl. "Add user" i Supabase-panelen fungerar inte (kontot saknar kod).
- **Admin-sidan** `admin.html` (vänstermeny: Feedback, Koder; `#koder` öppnar Koder). `feedbackboard.html` leder dit. Länken "Admin" i användarmenyn syns bara för administratörer.
- **Projekt:** flera projekt per användare; alla har ett första projekt (nya konton: "{Förnamn}s yta", äldre: "Sandlådan") som kan delas men inte tas bort. Projektmeny med Inställningar, Bjud in medlemmar, Nytt projekt. **Inställningar** är en dialog med vänstermeny (`PROJECT_SETTINGS_TABS` i theme.js – lägg nya delar där): Allmänt (namn, avatar, ta bort/lämna), Medlemmar (medlemmar, bjud in via e-post), Klasser (projektets klasser, antal upplägg per klass, ta bort). Översikten visar alla i projektet med Alla/Bara mina; andras upplägg öppnas i läsläge.
- **Inbjudan:** bara via e-post (Bjud in). Har personen konto får hen en notis under klockan; annars väntar inbjudan tills hen skapar konto **med kod** och samma adress (visas i steg 3). Projektkoder och "Gå med med kod" är borttagna.
- **Medskapare:** be om redigeringsrätt, skaparen godkänner/nekar eller lägger till direkt.
- **Klasser tillhör projektet:** `projects.classes` (+ RPC `add_project_class`/`remove_project_class`). Detaljer › Klass visar bara projektets lista (när den finns), så en borttagen klass kommer inte tillbaka via gamla upplägg.
- **Årskurs** är välj-eller-skriv som Ämne (förslag F–9, egna i profilen, `normalizeGrade`/`gradeLabel` i theme.js).
- **Kalender:** Mina / Alla i projektet, klassfilter, Prov/Inlämning-etiketter, kollegors lektioner grå och skrivskyddade, varning när en klass har ≥ 3 prov + inlämningar samma vecka (`LOAD_WARNING_AT` i calendar.html; räknar alla lärares inlagda lektioner hela veckan; klassen kommer från uppläggets Klass). Lektioner markeras som Prov/Inlämning i lektionens ⋯-meny (`data-assessment` på `.lesson-group`, `LESSON_ASSESSMENTS` i schedule.js). Kommande i sidopanelen/översikten = bara egna.
- **Uppläggssidan:** lektioner/aktiviteter, dra och släpp, fäll ihop, export Word/PowerPoint, brödsmulor, "Hämtar upplägget…" medan det laddas. **Aktivitetspanelen** svävar (12 px luft, 16 px hörn, skugga, ingen blur) med Ta bort / Avbryt / Spara i en fast rad i botten. Centralt innehåll/Betygskriterier: Enter sparar raden, tom rad tas bort, "magisk" ram när raden redigeras. Sektionsrubriker som sidopanelens grupper (rubriken är klickytan, pil vid hovring).
- **Filer:** bilder som miniatyr (stor i aktivitetspanelen); klick öppnar förhandsvisning i Lossi (bild, PDF, text; Office → Ladda ner); PowerPoint-exporten lägger in aktivitetens bilder (högst 4).
- **Marknadsplats:** `marknadsplats.html` är en teaser (knappen öppnar feedback).
- **Designsystem:** Open Sans. **Knappar** i `buttons.css` (alla sidor laddar den efter tokens.css): `.btn` + `.btn-solid` / `.btn-outline` / `.btn-subtle` / `.btn-text`, storlek `.btn-lg` 40 / standard 32 / `.btn-xs` 24, ton `.btn-danger`, `.btn-icon` kvadratisk. Upplägg sparade före knappsystemet uppgraderas när de öppnas (`upgradeSavedButtons` i plan-markup.js). Sidopanelen: Kalender / Upplägg / Team, sidorna Upplägg, Kalender, Material (Snart), Marknadsplats längst ner.
- **Snabbhet (2026-10-21):** smala listor en gång per sida (cache i data.js), hela state bara där det behövs, sidopanelen ritas från sessionStorage vid sidbyte, mjuka sidbyten med `@view-transition`. Detaljer i git-historiken (commits f34c9ab, c2537f0).

## Viktiga filer
- `theme.js` – app-skal (topbar, sidopanel, projektmeny + inställningar, notiser, inbjudan), profil, `createChoiceList`, ämnen/årskurser/klasser, Skapa-dialogen.
- `data.js` – all data via `LossiData` (upplägg, projekt, klasser, medskapare, inbjudningar, notiser, filer, kalender, feedback, koder). `auth.js` – `LossiAuth` (inloggning, `checkAccessCode`, `signUp`).
- `upplag.html` – uppläggssidan (mest logik). `plan-markup.js` – gemensam HTML för aktiviteter/lektioner/målrader. `ai-import.js`, `schedule.js`, `calendar.html`, `admin.html`, `login.html` + `onboarding.js`, `landing.html`, `marknadsplats.html`.
- `styles.css` (app; "KNAPPAR I APPEN" och "MOBIL" sist), `buttons.css`, `tokens.css`, `login.css` (inkl. ONBOARDING sist), `feedbackboard.css` (admin-sidan).
- `supabase/*.sql` – se "SQL som Tobias ska ha kört" ovan. `*.local.sql` och `.feedback-token` är git-ignorerade hemligheter.
- `scripts/feedback.sh`, `scripts/landing-screenshots.mjs`, `scripts/mock-supabase.js` (låtsas-Supabase: projekt, klasser, medskapare, inbjudningar, notiser, filer, koder, admin), `scripts/drag-test.mjs`, `scripts/sql-tests/*.test.mjs`.

## Testa lokalt
- Starta `lossi-static` (python http.server på 8765, `preview_start`). Låtsas-Supabase: kopiera `scripts/mock-supabase.js` till `_mock-supabase.js` och gör `_mobile-*.html`-kopior med supabase-taggen utbytt (sed: `s#<script src="https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@[^"]+"></script>#<script src="_mock-supabase.js"></script>#; s#upplag\.html\?id=#_mobile-upplag.html?id=#g`). Radera kopiorna efteråt (de är git-exkluderade).
  - Onboarding: `sessionStorage.mockLoggedOut = '1'` **innan** sidan laddas (annars skickas man vidare till index). Giltig kod i låtsasdatat: `ABC123`; utgången: `OLD999`. I login-kopian, byt `index.html` mot `_mobile-index.html` och `onboarding.js` mot en kopia med samma byte.
  - Låtsas-Supabase sparar inte profilen mellan sidladdningar och tappar uppladdade filer vid omladdning – det är inte buggar i appen.
- **SQL:** `scripts/sql-tests/` testar calendar-shared, project-classes och access-codes i lokal Postgres (PGlite). Kör: `npm install @electric-sql/pglite@0.2.17` i en scratchpad-mapp, kopiera dit testfilen och kör `node <test>.mjs "<sökväg till Lossi>"`. Testerna har hittat riktiga fel två gånger (parametrar som krockar med kolumnnamn – i SQL-funktioner vinner kolumnen).
- **Dra och släpp:** `node scripts/drag-test.mjs` (headless Chrome + riktiga mushändelser, kräver `_mobile-upplag.html` + `_mock-supabase.js` på 8765) – **alltid även efter spara + omladdning**. Vänta in vanliga sparningen (800 ms); `flushOnLeave` går förbi låtsas-Supabase.
- Kontrollera att dolda element verkligen döljs (computed `display`). Riktiga tangenttryck i webbläsarpanelen: `type` skickar hela strängen på en gång.
- Efter UI-ändringar som syns på landningssidan: `node scripts/landing-screenshots.mjs` och committa `landing/`.

## Öppna trådar
- **Onboarding i appen:** välkomst, rundtur och tips i upplägget byggda (ovan).
- **Feedback:** #9 markerad `done` 2026-10-22 (Tobias bekräftade live; alla SQL-filer körda). #7 markerad `done` 2026-10-22. #8 (Ida: koppla centralt innehåll till lektionen) är inte påbörjad.
- **Maskoten:** byt till Tobias Figma-export (SVG med separata lager: bakgrund, mun, ögonvitor, pupiller i mitten) om han skickar en.
- **Verktygsraden i Beskrivning** (T, B, lista, citat) gör ingenting när man klickar – fråga Tobias om den ska kopplas in eller tas bort.
- **Lektionsradens små kontroller** (kalender, ⋯, tid) är inte flyttade till knappsystemet.
- **Kalender:** klass gäller hela upplägget (inte per lektion); gränsen 3 för varningen är ett förslag; Skapa med AI kan inte markera prov.
- **Steg 5 projekt:** varning när någon annan redigerar samma upplägg (sista sparning vinner i dag).
- **Säkerhet senare:** e-postbekräftelse när Lossi får mejlutskick.
- **Frågor till Tobias:** "aktivitet" → "moment"? Ska `/` visa landningssidan?
- **Steg 7:** testa export av databasen (`pg_dump`).
