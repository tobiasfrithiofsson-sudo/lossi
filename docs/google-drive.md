# Välj filer från Google Drive

Under Filer, både på upplägget och i en aktivitet, finns knappen **Google Drive** bredvid Bläddra. Den öppnar Googles egen filväljare. Valda filer laddas ner i webbläsaren och läggs in i Lossi som kopior, med samma regler som en vanlig uppladdning (högst 25 MB och samma filtyper).

- Google Dokument, Presentationer, Kalkylark och Teckningar sparas som Word, PowerPoint, Excel och PDF. Google gör inte om filer som blir större än 10 MB.
- Kopian uppdateras inte om originalet ändras på Drive.
- Behörigheten är `drive.file`: Lossi kommer bara åt filer som läraren väljer, inte hela Drive. Inloggningen hos Google lever bara i minnet på sidan.
- Knappen visas inte förrän de tre Google-uppgifterna finns i `config.js`.

## Filer
- `google-drive.js`: filväljaren och nedladdningen (`LossiDrive`).
- `upplag.html`: `addDriveButtons()` och `pickFromDrive()`.
- `config.js`: `googleClientId`, `googleApiKey` och `googleProjectNumber`. Alla tre är publika med avsikt, och API-nyckeln är låst till Lossis adress hos Google. Det finns ingen client secret.

## Uppsättning i Google Cloud (görs en gång)
1. Skapa ett projekt på https://console.cloud.google.com/projectcreate, till exempel `Lossi`.
2. Slå på **Google Drive API** (https://console.cloud.google.com/apis/library/drive.googleapis.com) och **Google Picker API** (https://console.cloud.google.com/apis/library/picker.googleapis.com).
3. Under **Google Auth Platform** (https://console.cloud.google.com/auth/overview): fyll i appens namn och din e-post, och välj målgruppen External.
4. Under **Audience**: låt appen vara i läget Testing och lägg till din Gmail som testanvändare.
5. Under **Data Access**: lägg till behörigheten `.../auth/drive.file`.
6. Under **Clients**: skapa en OAuth-klient av typen Web application. Lägg till `https://lossi.tobias-frithiofsson.workers.dev` under Authorized JavaScript origins. Kopiera klient-id:t.
7. Under **APIs & Services › Credentials** (https://console.cloud.google.com/apis/credentials): skapa en API-nyckel. Begränsa den till webbadresserna `https://lossi.tobias-frithiofsson.workers.dev/*` och `https://docs.google.com/*`, och till Google Picker API.
8. Hämta **Project number** på projektets startsida (https://console.cloud.google.com/home/dashboard).
9. Klistra in de tre värdena i `config.js`, spara och pusha till `main`.

## Innan riktiga lärare använder det
I läget Testing fungerar det bara för testanvändare (högst 100), och inloggningen kan behöva göras om efter 7 dagar. För alla lärare krävs att appen publiceras och går igenom Googles enkla verifiering. Skolkonton kan dessutom vara låsta av skolans Google-administratör, så att appen måste godkännas av skolan. Lossis integritetstext behöver nämna kopplingen.

## Felsökning
- "API developer key is invalid": `https://docs.google.com/*` saknas bland webbadresserna för API-nyckeln (steg 7).
- "Error 400: redirect_uri_mismatch" eller "origin_mismatch": adressen saknas bland Authorized JavaScript origins (steg 6).
- "Access blocked": ditt konto saknas bland testanvändarna (steg 4).
- En fil kan inte hämtas: Drive API är inte påslaget (steg 2). Felet står i webbläsarens konsol.
