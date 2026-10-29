# Planera med AI: chatten (Claude Haiku)

Knappen **Planera med AI** i ett upplägg öppnar en chatt i en egen panel till höger. Läraren skriver vad hen vill ha hjälp med, och AI:n ser hela upplägget: grupperingar, aktiviteter, beskrivningar, kurs och vad som är kopplat till läroplanen. Svaret strömmas in medan det skrivs.

Vill AI:n ändra något visas det som ett **förslagskort** i chatten. Inget ändras förrän läraren väljer **Genomför**, och det senast genomförda förslaget går att **Ångra** så länge inget annat sparats efter det. AI:n kan föreslå att:
- lägga till grupperingar och aktiviteter (med typ, tid och beskrivning, även Förberedelse)
- ändra namn och tid på grupperingar, och titel, typ, tid och beskrivning på aktiviteter
- ta bort aktiviteter och grupperingar (bara om läraren ber om det; sådant med bifogade filer eller som ligger i kalendern tas aldrig bort av AI:n)
- koppla centralt innehåll till aktiviteter

Principen gäller: **AI:n skriver ingen läroplanstext.** Den får bara välja punkter (C1, C2 …) ur kursens lista, och Lossi lägger in Skolverkets text.

Medan chatten är öppen lämnar sidan plats för den. Öppnas en aktivitet lägger sig aktivitetspanelen ovanpå sidan till vänster om chatten, så att läraren ser ändringen. På mobil täcker chatten skärmen och aktiviteten öppnas ovanpå.

Det gamla flödet (kopiera en fråga till sin egen AI och klistra in svaret) finns kvar via länken **Använd din egen AI i stället** längst ner i chatten.

## Filer
- `supabase/functions/plan-chat/index.ts`: serverfunktionen (Deno). Kontrollerar inloggningen och gränsen på 100 svar per lärare och dygn (`DAILY_LIMIT`), skickar konversationen och upplägget till Claude Haiku med verktyget `propose_changes` (strikt schema), strömmar svaret som rader med JSON och sorterar bort ändringar som pekar på id som inte finns. Loggar tokens i `ai_requests` med `kind = 'plan-chat'`.
- `ai-chat.js`: panelen, meddelandena, förslagskorten och strömningen (`PlanChat`). Konversationen sparas per upplägg i webbläsaren (localStorage `lossi-ai-chat:<id>`); **Ny konversation** i panelens huvud tömmer den.
- `upplag.html`: `planForChat()` (upplägget med korta id: G1 gruppering, A1 aktivitet, C1 punkt) och `applyChatChanges()` / `undoChatChanges()`. Aktiviteter ändras via samma `writeActivityForm()` som Spara.
- `curriculum.js`: `chatContext()` (kursens punkter och kopplingar) och `linkActivities()` (delas med Föreslå kopplingar).
- `styles.css`: avsnittet "PLANERA MED AI – chatten i sidopanelen".

## Driftsättning (görs en gång)
Hemligheten `ANTHROPIC_API_KEY` och tabellen `ai_requests` finns redan sedan Föreslå kopplingar (`docs/ai-suggest-links.md`).
1. **Ny funktion:** Edge Functions (https://supabase.com/dashboard/project/mqzmtndjfgeujaqzqpeb/functions) › Deploy a new function › Via Editor. Döp den till `plan-chat` (exakt), klistra in hela `supabase/functions/plan-chat/index.ts` i stället för exempelkoden och välj Deploy. Låt "Verify JWT" vara påslaget.
2. **Uppdatera suggest-links:** öppna funktionen `suggest-links`, klistra in den nya `supabase/functions/suggest-links/index.ts` och välj Deploy. (Ändringen: dess gräns räknar bara sina egna förslag, så att chatten inte tar av dem.)

Kopiera koden med `LANG=en_US.UTF-8 pbcopy < fil`, annars blir åäö fel.

## Kostnad
Varje svar skickar med hela upplägget och, om kurs är vald, kursens centrala innehåll. Räkna med ungefär 5 000–20 000 tokens in och upp till 2 000 ut per svar, alltså runt 1–2 öre med Haiku 5.5. Förbrukningen syns i SQL:
```sql
select kind, user_id, count(*) as svar, sum(input_tokens) as in_tokens, sum(output_tokens) as ut_tokens
from ai_requests group by kind, user_id order by svar desc;
```

## Felmeddelanden i chatten
- "AI-chatten är inte påslagen än." betyder att tabellen `ai_requests` saknas (`supabase/ai.sql`).
- "Svaret gick inte att hämta." betyder oftast att funktionen saknas (steg 1). Läs loggen under Edge Functions › plan-chat › Logs.
- "Du har använt dagens 100 svar." visas när gränsen är nådd. Ändra `DAILY_LIMIT` om det behövs.

## Inte byggt än
- Ändra uppläggets titel, beskrivning, ämne och årskurs, och koppla betygskriterier.
- Konversationen följer inte med mellan datorer (den ligger i webbläsaren).
- Ångra för äldre förslag än det senaste.
