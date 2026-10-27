# Föreslå kopplingar med AI (Claude Haiku)

Läraren väljer **Centralt innehåll › plus › Föreslå kopplingar till aktiviteter**. Sidopanelen öppnas med maskoten (som följer pekaren, och tänker med siffror och tecken ovanför sig medan Haiku arbetar: `setThinking` i mascot.js) och frågar om läraren vill koppla läroplanen; först när läraren väljer **Koppla** där skickar Lossi kursens hela centrala innehåll (Skolverkets text ur `curriculum/`) och uppläggets aktiviteter (namn, typ, gruppering, beskrivning) till serverfunktionen `suggest-links`. Funktionen frågar Claude Haiku (`claude-haiku-5-5`), och panelen visar förslagen per aktivitet med en kort motivering. Inget kopplas förrän läraren väljer **Koppla**. Punkter som inte var valda än läggs då till under Centralt innehåll, med Skolverkets text.

Principen gäller fortfarande: **AI:n skriver ingen läroplanstext.** Den får bara välja bland punkternas id, och funktionen sorterar bort id som inte finns.

## Filer
- `supabase/functions/suggest-links/index.ts`: serverfunktionen (Deno). Kontrollerar inloggningen och gränsen på 30 förslag per lärare och dygn (`DAILY_LIMIT`), anropar Claude med ett fast JSON-schema (structured outputs) och loggar tokens i `ai_requests`.
- `supabase/ai.sql`: tabellen `ai_requests`. RLS är på utan regler, så bara funktionen kommer åt den.
- `curriculum.js`: `suggestLinks()` (öppnar panelen), `runSuggestions()` (anropet), `acceptSuggestions()` och `renderAi(läge)` i `PlanCurriculum`. Lägen: intro → loading → results (eller error/none) → done. Stilar under "Sidopanelen: Föreslå kopplingar" i styles.css.
- `upplag.html`: menyvalet, och `lessons()`-kroken skickar med aktivitetens typ och beskrivning.

## Driftsättning (görs en gång)
1. **Anthropic:** skapa ett konto på https://console.anthropic.com, lägg in betalkort och sätt en månadsgräns under Billing › Limits. Skapa en API-nyckel under API Keys och kopiera den.
2. **Hemligheten:** i Supabase, gå till Edge Functions › Secrets (https://supabase.com/dashboard/project/mqzmtndjfgeujaqzqpeb/functions/secrets). Lägg till `ANTHROPIC_API_KEY` med nyckeln som värde. Nyckeln ska bara finnas där, aldrig i koden.
3. **Tabellen:** kör `supabase/ai.sql` i SQL Editor (https://supabase.com/dashboard/project/mqzmtndjfgeujaqzqpeb/sql/new). Resultatet ska bli "Success. No rows returned".
4. **Funktionen:** Edge Functions (https://supabase.com/dashboard/project/mqzmtndjfgeujaqzqpeb/functions) › Deploy a new function › Via Editor. Döp den till `suggest-links` (exakt), klistra in hela `index.ts` i stället för exempelkoden och välj Deploy. Låt "Verify JWT" vara påslaget.
5. **Appen:** pusha till `main`. Testa på ett upplägg som har kurs och några aktiviteter med beskrivning.

Ändras `index.ts`: öppna funktionen i Supabase, klistra in den nya koden och välj Deploy igen.

## Kostnad och uppföljning
Haiku 5.5 kostar 0,10 dollar per miljon tokens in och 0,50 dollar per miljon ut. Ett förslag blir ungefär 5 000–15 000 tokens in och under 2 000 ut, alltså runt 1–2 öre. Förbrukningen per lärare syns i SQL:

```sql
select user_id, count(*) as forslag, sum(input_tokens) as in_tokens, sum(output_tokens) as ut_tokens
from ai_requests group by user_id order by forslag desc;
```

## Felmeddelanden i panelen
- "AI-förslagen är inte påslagna än." betyder att tabellen saknas (steg 3).
- "Förslagen gick inte att hämta." betyder oftast att funktionen saknas (steg 4) eller att nyckeln är fel (steg 2). Läs loggen under Edge Functions › suggest-links › Logs.
- "Du har använt dagens 30 förslag." visas när gränsen är nådd. Ändra `DAILY_LIMIT` om det behövs.

## Inte byggt än
- Betygskriterier (bara centralt innehåll i den här versionen).
- Kopplingar till hela grupperingar (bara enskilda aktiviteter).
- En chatt. Den kan återanvända samma upplägg: en serverfunktion som har nyckeln och gränsen.
