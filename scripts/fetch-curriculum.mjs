// ── Skolverkets kurs- och ämnesplaner till Lossi ──
// Hämtar centralt innehåll och betygskriterier ur Skolverkets öppna Syllabus
// API och sparar dem i curriculum/ (index.json + en fil per ämne). Förskolan
// har inga ämnen: där hämtas målen ur Lpfö 18 (avsnitt 2, rubrikerna "Mål"). API:t
// tillåter inte anrop direkt från webbläsaren, så Lossi läser de här filerna.
//
// Texten sparas ordagrant: bara HTML-taggarna tas bort (fetstil i
// betygskriterierna behålls som <strong>). Inget skrivs om eller läggs till.
//
// Kör:  node scripts/fetch-curriculum.mjs   (tar några minuter)
// Kör om när Skolverket ändrar något; varje ämne har ett versionsnummer och
// upplägg som valt punkter ur en äldre version får en markering i Lossi.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.skolverket.se/syllabus/v1';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'curriculum');
const SCHOOL_TYPES = { GY: 'Gymnasieskola', GR: 'Grundskola' };
const TODAY = new Date().toISOString().slice(0, 10);

async function getJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

// ── Text ur Skolverkets HTML ──
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', ndash: '–', mdash: '—', hellip: '…' };

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
}

function clean(s) {
  return decode(s).replace(/­/g, '').replace(/[ \s]+/g, ' ').trim();
}

const plain = html => clean(html.replace(/<[^>]+>/g, ' '));

// Behåller bara <strong> (värdeorden i betygskriterierna)
function withStrong(html) {
  const marked = html.replace(/<\s*(strong|b)\b[^>]*>/gi, '\u0001').replace(/<\s*\/\s*(strong|b)\s*>/gi, '\u0002');
  return plain(marked)
    .replace(/\u0001\s*\u0002/g, '')
    .replace(/\u0001/g, '<strong>').replace(/\u0002/g, '</strong>')
    .replace(/\s+<\/strong>/g, '</strong> ').replace(/<strong>\s+/g, ' <strong>')
    .replace(/\s+/g, ' ').trim();
}

// Centralt innehåll → [{ section, heading, text }]. section = <h3> (grundskolans
// "I årskurs 4–6"), heading = mellanrubrik (<h4> eller <p><em>). Inledningen
// "Undervisningen … ska behandla följande centrala innehåll" är ingen punkt.
// Punkter i en lista inuti en punkt följer med i samma punkt.
function parseContent(html) {
  const items = [];
  let section = null, heading = null, depth = 0, buf = null, inBlock = null, blockBuf = '';
  for (const tok of html.split(/(<[^>]+>)/)) {
    const tag = tok.match(/^<\s*(\/)?\s*([a-z0-9]+)/i);
    if (!tag) {
      if (buf !== null) buf += tok;
      else if (inBlock) blockBuf += tok;
      continue;
    }
    const closing = !!tag[1], name = tag[2].toLowerCase();
    if (name === 'li') {
      if (!closing) { depth++; if (depth === 1) buf = ''; else buf += ' – '; }
      else { depth--; if (depth === 0 && buf !== null) { const text = plain(buf); if (text) items.push({ section, heading, text }); buf = null; } }
      continue;
    }
    if (buf !== null) { buf += ' '; continue; }
    if (['h2', 'h3', 'h4', 'h5', 'p'].includes(name)) {
      if (!closing) { inBlock = name; blockBuf = ''; continue; }
      if (inBlock === name) {
        const text = plain(blockBuf);
        const isIntro = /^undervisningen\b/i.test(text) || /centrala innehåll/i.test(text);
        if (text && !isIntro) {
          if (name === 'h2' || name === 'h3') { section = text; heading = null; }
          else heading = text.replace(/:$/, '');
        }
        inBlock = null;
      }
    }
  }
  return items;
}

const paragraphs = html => [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => withStrong(m[1])).filter(Boolean);
const headingOf = html => { const m = html.match(/<h[2-5]\b[^>]*>([\s\S]*?)<\/h[2-5]>/i); return m ? plain(m[1]) : null; };

// Betygskriterier → [{ id, E, C, A }] (ett stycke per kriterium, E, C och A
// i samma ordning hos Skolverket), eller [{ id, text }] när det bara finns en
// nivå (grundskolans årskurs 3). Går styckena inte att para ihop blir hela
// texten ett kriterium, så att inget tolkas.
function parseCriteria(reqs) {
  const byStep = {};
  reqs.forEach(r => { byStep[r.gradeStep || '-'] = r.text; });
  if (byStep.E && byStep.C && byStep.A) {
    const E = paragraphs(byStep.E), C = paragraphs(byStep.C), A = paragraphs(byStep.A);
    if (E.length && E.length === C.length && E.length === A.length) return E.map((e, i) => ({ id: 'k' + (i + 1), E: e, C: C[i], A: A[i] }));
    return [{ id: 'k1', E: E.join(' '), C: C.join(' '), A: A.join(' ') }];
  }
  const only = byStep['-'] || byStep.E || Object.values(byStep)[0] || '';
  return paragraphs(only).map((text, i) => ({ id: 'k' + (i + 1), text }));
}

const numbered = (items, prefix) => items.map((it, i) => ({ id: prefix + (i + 1), ...it }));

// ── Ett ämne ──
function gymnasiumSubject(s) {
  const reform = s.reform || (s.typeOfSyllabus === 'SUBJECT_SYLLABUS' ? 'GY11' : 'GY25');
  const criteria = {};
  if (s.knowledgeRequirements?.length) criteria.subject = { heading: 'Betygskriterier för ämnet', items: parseCriteria(s.knowledgeRequirements) };
  const levels = (s.courses || []).map(c => {
    if (c.knowledgeRequirements?.length) criteria[c.code] = { heading: 'Betygskriterier för ' + c.name, items: parseCriteria(c.knowledgeRequirements) };
    const content = parseContent(c.centralContent?.text || '').map(({ heading, text }) => ({ heading, text }));
    return {
      code: c.code, name: c.name, points: c.points || null,
      content: numbered(content, 'c'),
      criteria: criteria[c.code] ? c.code : (criteria.subject ? 'subject' : null),
    };
  });
  return { reform, levels, criteria };
}

// Grundskolan: centralt innehåll per årskursintervall, kriterier för årskurs 3, 6 och 9
function compulsorySubject(s) {
  const content = (s.centralContents || []).flatMap(c => parseContent(c.text || ''));
  const sections = [...new Set(content.map(c => c.section).filter(Boolean))];
  const criteria = {};
  const groups = {};
  (s.knowledgeRequirements || []).forEach(r => {
    const year = r.year || (r.text.match(/årskurs (\d)/) || [])[1] || 'x';
    (groups[year] ||= []).push(r);
  });
  Object.entries(groups).forEach(([year, reqs]) => {
    criteria['ak' + year] = { heading: headingOf(reqs[0].text)?.replace(/ för betyget [A-E]/i, '') || `Betygskriterier i slutet av årskurs ${year}`, items: parseCriteria(reqs) };
  });
  const levels = (sections.length ? sections : [null]).map((section, i) => {
    const last = (section?.match(/(\d+)\D*$/) || [])[1];
    return {
      code: 'n' + (i + 1),
      name: section ? section.replace(/^I /, '').replace(/^å/, 'Å') : s.name,
      content: numbered(content.filter(c => c.section === section).map(({ heading, text }) => ({ heading, text })), 'c'),
      criteria: criteria['ak' + last] ? 'ak' + last : null,
    };
  });
  return { reform: 'Lgr22', levels, criteria };
}

async function fetchSubject(schoolType, code) {
  const s = (await getJSON(`${API}/subjects/${encodeURIComponent(code)}`)).subject;
  const body = schoolType === 'GR' ? compulsorySubject(s) : gymnasiumSubject(s);
  return {
    schoolType, code: s.code, name: s.name, version: s.version ?? null,
    modifiedDate: s.modifiedDate || null, versionInfo: s.versionInfo || null,
    ...body,
  };
}

// Förskolan: målen i läroplanens avsnitt 2 ("Förskolan ska ge varje barn
// förutsättningar att utveckla" + en lista). Blir ett "ämne" med en nivå, så
// att uppläggen och Läroplan-sidan fungerar som för skolan. Inga betygskriterier.
async function fetchPreschool() {
  const cur = (await getJSON(`${API}/curriculums/${encodeURIComponent('FÖ2011')}`)).curriculum;
  const content = [];
  cur.sections.forEach(section => {
    let title = null;
    for (const part of section.content.split(/(?=<h3\b)/i)) {
      const h = plain(part.match(/^<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');
      if (/^\d+\.\d+/.test(h)) title = h;
      if (h !== 'Mål') continue;
      const lead = plain(part.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '') || null;
      const list = part.slice(part.search(/<ul\b/i));
      parseContent(list).forEach(({ text }) => content.push({ heading: title, lead, text }));
    }
  });
  return {
    schoolType: 'FS', code: cur.code, name: 'Läroplan för förskolan', reform: 'Lpfö 18', version: cur.version ?? null,
    modifiedDate: cur.modifiedDate || null, versionInfo: null,
    levels: [{ code: 'mal', name: 'Mål', content: numbered(content, 'c'), criteria: null }],
    criteria: {},
  };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const index = { source: 'Skolverkets Syllabus API (api.skolverket.se/syllabus)', fetchedAt: TODAY, schoolTypes: {} };
await rm(OUT, { recursive: true, force: true });

for (const [schoolType, label] of Object.entries(SCHOOL_TYPES)) {
  const list = (await getJSON(`${API}/subjects?schooltype=${schoolType}&timespan=LATEST`)).subjects
    .filter(s => !s.endDate || s.endDate >= TODAY)
    .filter(s => s.typeOfSyllabus !== 'OTHER_COURSE_SYLLABUS' || schoolType === 'GR');
  console.log(`${label}: ${list.length} ämnen`);
  let done = 0;
  const subjects = await pool(list, 6, async s => {
    try {
      const subject = await fetchSubject(schoolType, s.code);
      const file = join(OUT, schoolType, s.code + '.json');
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ ...subject, fetchedAt: TODAY }));
      if (++done % 50 === 0) console.log(`  ${done}/${list.length}`);
      return subject;
    } catch (e) {
      console.warn(`  hoppar över ${s.code}: ${e.message}`);
      return null;
    }
  });
  index.schoolTypes[schoolType] = {
    name: label,
    subjects: subjects.filter(s => s && s.levels.some(l => l.content.length))
      .map(s => ({ code: s.code, name: s.name, reform: s.reform, version: s.version, levels: s.levels.map(l => ({ code: l.code, name: l.name })) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv') || (a.reform < b.reform ? 1 : -1)),
  };
}

const preschool = await fetchPreschool();
console.log(`Förskola: ${preschool.levels[0].content.length} mål`);
await mkdir(join(OUT, 'FS'), { recursive: true });
await writeFile(join(OUT, 'FS', preschool.code + '.json'), JSON.stringify({ ...preschool, fetchedAt: TODAY }));
index.schoolTypes.FS = {
  name: 'Förskola',
  subjects: [{ code: preschool.code, name: preschool.name, reform: preschool.reform, version: preschool.version, levels: preschool.levels.map(l => ({ code: l.code, name: l.name })) }],
};

await writeFile(join(OUT, 'index.json'), JSON.stringify(index));
console.log('Klart:', OUT);
