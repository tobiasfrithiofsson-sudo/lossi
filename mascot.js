// ── Lossis maskot ──
// En SVG med två ögon (vita + pupiller) och en mun. Pupillerna flyttas mot
// det den tittar på, men stannar inom ögonvitorna (som klipper dem). Kan
// hålla för ögonen, blinka och byta min. Används i onboardingen (onboarding.js) och i
// välkomsten/rundturen i appen (tour.js). Utseendet finns i mascot.css.
//   const m = createMascot(hostElement, { mouthScale });  – mouthScale gör munnen
//                    större när maskoten är liten (t.ex. 1.7 vid 64 px)
//   m.lookAt(x, y)   – tittar mot en punkt på skärmen (clientX/clientY)
//   m.center()       – tittar rakt fram
//   m.setMood('normal' | 'curious' | 'happy' | 'sad')
//   m.setClosed(true/false) – armarna kommer in och håller för ögonen
//   m.setLove(true/false) – blinkar och byter pupillerna mot röda hjärtan
//                           (ögonvitorna växer samtidigt från 64 till 70 px,
//                           munnen blir en öppen wow-mun)
//   m.blink()
//   m.setThinking(true/false) – tittar upp åt ena och sedan andra hållet, munnen
//                    grubblar snett, och siffror och tecken svävar upp ovanför och
//                    bleknar bort. Följer inte pekaren under tiden (lookAt gör
//                    inget). Tecknen läggs i värdens förälder, som behöver
//                    position: relative och vara lika stor som maskoten.

let mascotCount = 0;

// Ett hjärta med mitten i (cx, cy), ungefär lika stort som pupillen
function heartPath(cx, cy, s = 1.2) {
  const p = (x, y) => `${(cx + x * s).toFixed(1)} ${(cy + 2 * s + y * s).toFixed(1)}`;
  return `M ${p(0, 20)} C ${p(-30, 0)} ${p(-26, -24)} ${p(-12, -24)} C ${p(-5, -24)} ${p(0, -18)} ${p(0, -14)} `
    + `C ${p(0, -18)} ${p(5, -24)} ${p(12, -24)} C ${p(26, -24)} ${p(30, 0)} ${p(0, 20)} Z`;
}

function createMascot(host, { mouthScale = 1 } = {}) {
  const id = 'mascot' + (++mascotCount);
  host.classList.add('mascot');
  host.insertAdjacentHTML('beforeend', `
    <svg class="mascot-face" viewBox="0 0 200 130" role="img" aria-label="Lossis maskot">
      <defs>
        <clipPath id="${id}L"><circle cx="45" cy="52" r="40" /></clipPath>
        <clipPath id="${id}R"><circle cx="155" cy="52" r="40" /></clipPath>
      </defs>
      <g class="mascot-eye" data-cx="45" data-cy="52">
        <g class="mascot-eyeball" style="transform-origin: 45px 52px">
          <circle cx="45" cy="52" r="40" fill="#fff" />
          <g clip-path="url(#${id}L)"><g class="mascot-pupil"><circle class="mascot-pupil-dot" cx="45" cy="52" r="26.25" fill="#2b2b2b" /><path class="mascot-heart" d="${heartPath(45, 52)}" fill="#E8183A" /></g></g>
        </g>
      </g>
      <g class="mascot-eye" data-cx="155" data-cy="52">
        <g class="mascot-eyeball" style="transform-origin: 155px 52px">
          <circle cx="155" cy="52" r="40" fill="#fff" />
          <g clip-path="url(#${id}R)"><g class="mascot-pupil"><circle class="mascot-pupil-dot" cx="155" cy="52" r="26.25" fill="#2b2b2b" /><path class="mascot-heart" d="${heartPath(155, 52)}" fill="#E8183A" /></g></g>
        </g>
      </g>
      <g transform="translate(100 108) scale(${mouthScale}) translate(-100 -108)">
        <path class="mascot-mouth" d="M 92 108 Q 100 117 108 108" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" />
      </g>
    </svg>
    <span class="mascot-arm is-left"></span><span class="mascot-arm is-right"></span>`);
  // Mått efter Tobias skiss: vita 64 px, pupiller 42 px, 24 px mellan ögonen
  // (vid --face: 160px är 1 enhet 0,8 px: vita r 40, pupiller r 26,25, glipa 30)
  const svg = host.querySelector('.mascot-face');
  const eyes = [...svg.querySelectorAll('.mascot-eye')];
  const MAX_OFFSET = 24; // i SVG-enheter: pupillen får gå ut över kanten (klipps), som i Tobias skiss
  const MOUTHS = {
    normal: 'M 92 108 Q 100 117 108 108',
    curious: 'M 95 110 Q 100 113 105 110',
    happy: 'M 84 104 Q 100 124 116 104',
    sad: 'M 92 114 Q 100 106 108 114',
  };
  // Hjärtläget: en öppen, fylld "wow"-mun (rak överkant, rund underkant) efter Tobias skiss
  const LOVE_MOUTH = 'M 85 100 Q 85 97 88 97 L 112 97 Q 115 97 115 100 C 115 108 108 113 100 113 C 92 113 85 108 85 100 Z';
  // Tänkande: munnen lutar åt ena eller andra hållet, ögonen tittar snett upp åt samma håll
  const THINK_MOUTHS = ['M 86 114 Q 98 110 110 106', 'M 90 106 Q 102 110 114 114'];
  const THINK_LOOKS = [[-10, -19], [10, -19]];
  const THOUGHTS = ['5', '7', '2', '{4}', 'mc²', '#', 'π', 'x²', '√', '∑', '?', '%', '=', '🔨'];
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let mood = 'normal';
  let love = false;
  let closed = false;
  let thinking = null; // { side, layer, timers } medan den tänker

  function lookAt(x, y) {
    if (thinking) return;
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const scale = box.width / 200;
    eyes.forEach(eye => {
      const cx = box.left + Number(eye.dataset.cx) * scale;
      const cy = box.top + Number(eye.dataset.cy) * scale;
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      // Långt bort = ända ut mot kanten; nära = lite
      const reach = Math.min(MAX_OFFSET, dist / scale / 6);
      eye.querySelector('.mascot-pupil').style.transform = `translate(${(dx / dist) * reach}px, ${(dy / dist) * reach}px)`;
    });
  }

  function center() {
    eyes.forEach(eye => { eye.querySelector('.mascot-pupil').style.transform = ''; });
  }

  function setClosed(on) {
    closed = on;
    host.classList.toggle('is-closed', on);
  }

  function drawMouth() {
    const mouth = svg.querySelector('.mascot-mouth');
    mouth.setAttribute('d', love ? LOVE_MOUTH : thinking ? THINK_MOUTHS[thinking.side] : MOUTHS[mood] || MOUTHS.normal);
    mouth.setAttribute('fill', love ? '#fff' : 'none');
    mouth.setAttribute('stroke', love ? 'none' : '#fff');
  }

  function setMood(next) {
    mood = next;
    drawMouth();
    host.classList.toggle('is-happy', mood === 'happy');
  }

  // Bytet sker mitt i en blinkning, när ögonen är stängda
  function setLove(on) {
    if (!!on === love) return;
    love = !!on;
    const swap = () => {
      host.classList.toggle('is-love', love);
      drawMouth();
    };
    if (calm.matches || closed) return swap();
    host.classList.add('is-blinking');
    setTimeout(() => {
      swap();
      host.classList.remove('is-blinking');
    }, 130);
  }

  function blink() {
    if (closed) return;
    host.classList.add('is-blinking');
    setTimeout(() => host.classList.remove('is-blinking'), 140);
  }

  function spawnThought(layer) {
    const el = document.createElement('span');
    el.className = 'mascot-thought';
    el.textContent = THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)];
    // Mest lite snett, ibland nästan på sidan (som mc² i skissen)
    const tilt = (Math.random() - 0.5) * 50 + (Math.random() < 0.15 ? (Math.random() < 0.5 ? -70 : 70) : 0);
    el.style.cssText = `left: ${8 + Math.random() * 84}%; font-size: ${10 + Math.random() * 10}px; `
      + `--rot: ${tilt}deg; --dx: ${(Math.random() - 0.5) * 20}px; animation-duration: ${2.6 + Math.random() * 1.4}s`;
    el.addEventListener('animationend', () => el.remove());
    layer.append(el);
  }

  function setThinking(on) {
    if (!!on === !!thinking) return;
    host.classList.toggle('is-thinking', !!on);
    if (!on) {
      thinking.timers.forEach(clearInterval);
      thinking.layer.remove();
      thinking = null;
      center();
      drawMouth();
      return;
    }
    const layer = document.createElement('div');
    layer.className = 'mascot-thoughts';
    layer.setAttribute('aria-hidden', 'true');
    host.after(layer);
    thinking = { side: 0, layer, timers: [] };
    const turn = () => {
      const [x, y] = THINK_LOOKS[thinking.side];
      eyes.forEach(eye => { eye.querySelector('.mascot-pupil').style.transform = `translate(${x}px, ${y}px)`; });
      drawMouth();
    };
    turn();
    if (calm.matches) return;
    thinking.timers.push(setInterval(() => { thinking.side = 1 - thinking.side; turn(); }, 1800));
    thinking.timers.push(setInterval(() => spawnThought(layer), 400));
    spawnThought(layer);
  }

  return { host, lookAt, center, setMood, setClosed, setLove, setThinking, blink, get closed() { return closed; } };
}

// Blinkar ibland så länge isAwake() svarar ja (inte med reducerade animationer)
function blinkNowAndThen(mascot, isAwake) {
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  (function later() {
    setTimeout(() => {
      if (!calm.matches && isAwake()) mascot.blink();
      later();
    }, 3000 + Math.random() * 4000);
  })();
}
