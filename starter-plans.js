// ── Startupplägg för nya konton ──
// En ny lärare får två upplägg som visar hur Lossi fungerar, och en lektion
// inlagd i kalendern nästa vardag (så att kalendern inte är tom).
// data.js (ensureDemoPlans) lägger in dem en gång per konto, i den egna ytan.
// Uppläggen är vanliga upplägg (samma form som Skapa med AI, planStateFromAi
// i ai-import.js) och går att ändra i och ta bort.
// Kräver plan-markup.js, schedule.js (newLessonId) och ai-import.js; sidor
// utan dem lägger inte in något (det sker nästa gång översikten öppnas).

const STARTER_PLANS = [
  {
    title: 'Ditt första upplägg',
    avatar: 'sunrise',
    subject: 'Kom igång',
    grade: '',
    description: 'Det här är ett exempel som visar hur ett upplägg i Lossi fungerar. Klicka runt, ändra och flytta saker – och ta bort upplägget när du är klar.',
    goals: [
      'Här skriver du det centrala innehåll som upplägget arbetar med',
      'Tryck Enter för att lägga till en ny rad',
    ],
    criteria: ['Här skriver du vilka delar av betygskriterierna eleverna får chans att visa'],
    lessons: [
      {
        name: 'Lektion 1: Så är ett upplägg uppbyggt',
        minutes: 60,
        scheduled: true, // läggs in i kalendern
        activities: [
          { type: 'Genomgång', title: 'Upplägg, lektioner och aktiviteter', minutes: 10, desc: 'Ett upplägg är ett arbetsområde. Det består av lektioner, och varje lektion består av aktiviteter med typ och tid. Lossi räknar ihop tiden och varnar om aktiviteterna tar längre tid än lektionen.' },
          { type: 'Aktivitet', title: 'Öppna en aktivitet', minutes: 15, desc: 'Klicka på en aktivitet för att ändra titel, typ, tid och beskrivning. Här kan du också bifoga filer, till exempel en bild eller ett arbetsblad.' },
          { type: 'Aktivitet', title: 'Dra och släpp', minutes: 15, desc: 'Ta tag i prickarna till vänster om en aktivitet och dra den till en ny plats – även till en annan lektion.' },
          { type: 'Aktivitet', title: 'Lektionen i kalendern', minutes: 20, desc: 'Den här lektionen ligger redan i din kalender. Med kalenderknappen på lektionsraden flyttar du den eller lägger in andra lektioner.' },
        ],
      },
      {
        name: 'Lektion 2: Gör upplägget till ditt',
        minutes: 30,
        activities: [
          { type: 'Aktivitet', title: 'Byt titel, ämne och årskurs', minutes: 10, desc: 'Klicka på titeln för att ändra den. Ämne, årskurs och klass väljer du under Detaljer till höger.' },
          { type: 'Aktivitet', title: 'Lägg till en lektion', minutes: 15, desc: 'Plusknappen vid Struktur och tidslinje lägger till en lektion eller aktivitet. Lektionens ⋯-meny har fler val.' },
          { type: 'Exit ticket', title: 'Ta bort exemplet', minutes: 5, desc: 'När du är klar tar du bort upplägget via ⋯ längst upp till höger.' },
        ],
      },
    ],
  },
  {
    title: 'Planera enklare',
    avatar: 'compass',
    subject: 'Kom igång',
    grade: '',
    description: 'Tre sätt att spara tid: låt AI göra ett första utkast, planera tillsammans med kollegor och håll koll på klassens vecka i kalendern.',
    goals: [],
    criteria: [],
    lessons: [
      {
        name: 'Lektion 1: Låt AI göra första utkastet',
        minutes: 30,
        activities: [
          { type: 'Genomgång', title: 'Skapa med AI', minutes: 10, desc: 'Välj Skapa → Skapa med AI. Lossi ger dig en färdig fråga att klistra in i din egen AI, till exempel ChatGPT eller Copilot. Klistra in svaret, så blir det ett upplägg med lektioner och aktiviteter.' },
          { type: 'Aktivitet', title: 'Fyll i ett upplägg du redan har', minutes: 10, desc: 'I ett befintligt upplägg väljer du ⋯ → Fyll i med AI för att få förslag på det som saknas.' },
          { type: 'Exit ticket', title: 'Granska alltid förslaget', minutes: 10, desc: 'AI kan ha fel. Läs igenom och justera innan du använder upplägget med eleverna.' },
        ],
      },
      {
        name: 'Lektion 2: Planera tillsammans',
        minutes: 30,
        activities: [
          { type: 'Genomgång', title: 'Skapa ett projekt', minutes: 10, desc: 'Din egen yta är bara din. Skapa ett nytt projekt i projektväljaren uppe till vänster och bjud in kollegor med deras e-postadress.' },
          { type: 'Diskussion', title: 'Dela och be om att få redigera', minutes: 10, desc: 'Kollegornas upplägg öppnas i läsläge. Be om att få redigera om ni vill arbeta i samma upplägg, eller duplicera det till dina egna.' },
          { type: 'Aktivitet', title: 'Se klassens vecka', minutes: 10, desc: 'I kalendern väljer du Alla i projektet och en klass. Lossi varnar när klassen får många prov och inlämningar samma vecka.' },
        ],
      },
      {
        name: 'Lektion 3: Prov',
        minutes: 40,
        assessment: 'prov',
        activities: [
          { type: 'Aktivitet', title: 'Markera prov och inlämningar', minutes: 30, desc: 'Den här lektionen är markerad som prov. Det gör du i lektionens ⋯-meny, och då syns den som prov i kalendern.' },
          { type: 'Aktivitet', title: 'Exportera', minutes: 10, desc: 'Med Exportera uppe till höger får du upplägget som Word eller PowerPoint, eller skriver ut det.' },
        ],
      },
    ],
  },
];

// Nästa vardag klockan 10 (fredag–söndag: måndag). Alltid framåt i tiden,
// och i den vecka kalendern öppnar på (den visar nästa vecka på helgen), så
// att man ser lektionen direkt. Bara en fredag hamnar den veckan efter.
function starterEventStart(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0, 0);
  while (start.getDay() === 0 || start.getDay() === 6) start.setDate(start.getDate() + 1);
  return start;
}

// { rows: [{ title, avatar, state }], event: { index, lessonId, durationMin, start } }
// event.index = vilket av uppläggen (i rows) som har lektionen i kalendern
function buildStarterPlans() {
  let event = null;
  const rows = STARTER_PLANS.map((plan, i) => {
    const avatar = plan.avatar;
    const state = planStateFromAi(plan, avatar);
    // Lektionernas id finns i structureHTML i samma ordning som plan.lessons
    const ids = [...state.structureHTML.matchAll(/data-lesson-id="([^"]+)"/g)].map(m => m[1]);
    plan.lessons.forEach((lesson, j) => {
      if (lesson.assessment) {
        state.structureHTML = state.structureHTML.replace(`data-lesson-id="${ids[j]}"`, `data-lesson-id="${ids[j]}" data-assessment="${lesson.assessment}"`);
      }
      if (lesson.scheduled && !event) event = { index: i, lessonId: ids[j], durationMin: lesson.minutes, start: starterEventStart() };
    });
    return { title: plan.title, avatar, state };
  });
  return { rows, event };
}
