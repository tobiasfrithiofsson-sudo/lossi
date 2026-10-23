// ── Lossis maskot ──
// En SVG med två ögon (vita + pupiller) och en mun. Pupillerna flyttas mot
// det den tittar på, men stannar inom ögonvitorna (som klipper dem). Kan
// hålla för ögonen, blinka och byta min. Används i onboardingen (onboarding.js) och i
// välkomsten/rundturen i appen (tour.js). Utseendet finns i mascot.css.
//   const m = createMascot(hostElement);
//   m.lookAt(x, y)   – tittar mot en punkt på skärmen (clientX/clientY)
//   m.center()       – tittar rakt fram
//   m.setMood('normal' | 'curious' | 'happy' | 'sad')
//   m.setClosed(true/false) – armarna kommer in och håller för ögonen
//   m.blink()

let mascotCount = 0;

function createMascot(host) {
  const id = 'mascot' + (++mascotCount);
  host.classList.add('mascot');
  host.insertAdjacentHTML('beforeend', `
    <svg class="mascot-face" viewBox="0 0 200 130" role="img" aria-label="Lossis maskot">
      <defs>
        <clipPath id="${id}L"><circle cx="58" cy="52" r="40" /></clipPath>
        <clipPath id="${id}R"><circle cx="142" cy="52" r="40" /></clipPath>
      </defs>
      <g class="mascot-eye" data-cx="58" data-cy="52">
        <circle cx="58" cy="52" r="40" fill="#fff" />
        <g clip-path="url(#${id}L)"><circle class="mascot-pupil" cx="58" cy="52" r="24" fill="#2b2b2b" /></g>
      </g>
      <g class="mascot-eye" data-cx="142" data-cy="52">
        <circle cx="142" cy="52" r="40" fill="#fff" />
        <g clip-path="url(#${id}R)"><circle class="mascot-pupil" cx="142" cy="52" r="24" fill="#2b2b2b" /></g>
      </g>
      <path class="mascot-mouth" d="M 92 108 Q 100 117 108 108" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" />
    </svg>
    <span class="mascot-arm is-left"></span><span class="mascot-arm is-right"></span>`);
  const svg = host.querySelector('.mascot-face');
  const eyes = [...svg.querySelectorAll('.mascot-eye')];
  const MAX_OFFSET = 24; // i SVG-enheter: pupillen får gå ut över kanten (klipps), som i Tobias skiss
  const MOUTHS = {
    normal: 'M 92 108 Q 100 117 108 108',
    curious: 'M 95 110 Q 100 113 105 110',
    happy: 'M 84 104 Q 100 124 116 104',
    sad: 'M 92 114 Q 100 106 108 114',
  };
  let closed = false;

  function lookAt(x, y) {
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

  function setMood(mood) {
    svg.querySelector('.mascot-mouth').setAttribute('d', MOUTHS[mood] || MOUTHS.normal);
    host.classList.toggle('is-happy', mood === 'happy');
  }

  function blink() {
    if (closed) return;
    host.classList.add('is-blinking');
    setTimeout(() => host.classList.remove('is-blinking'), 140);
  }

  return { host, lookAt, center, setMood, setClosed, blink, get closed() { return closed; } };
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
