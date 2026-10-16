// ── Datalager ──
// All läsning och skrivning av upplägg går via LossiData. Sidorna vet inte
// var datan bor: i dag i webbläsarens localStorage, senare i Supabase (steg 6
// i docs/migration-plan.md). Alla funktioner är async redan nu, så att
// anropen i sidorna inte behöver ändras när datan flyttar till en server.
//
// Ett upplägg = ett id + ett state-objekt (formen sätts av saveState() i
// upplag.html). Demo-upplägg som aldrig sparats har state null.
//
// UI-inställningar (tema, dold inbjudan, slumpad reservavatar) är inte
// uppläggsdata och ligger kvar direkt i localStorage i theme.js.
const LossiData = (() => {
  const REGISTRY_KEY = 'lossi-plans';
  const planKey = id => 'lossi-plan-' + id;

  function readJSON(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  }

  // Vilka upplägg som finns, i den ordning de skapats. Saknas registret
  // gäller demo-uppläggen (DEMO_PLANS i theme.js).
  function readIds() {
    const ids = readJSON(REGISTRY_KEY);
    if (Array.isArray(ids) && ids.length) return ids.map(String);
    return Object.keys(DEMO_PLANS);
  }

  // [{ id, state }], äldst först
  async function listPlans() {
    return readIds().map(id => ({ id, state: readJSON(planKey(id)) }));
  }

  async function loadPlan(id) {
    return readJSON(planKey(id));
  }

  async function savePlan(id, state) {
    localStorage.setItem(planKey(id), JSON.stringify(state));
  }

  // Sparar ett nytt upplägg och returnerar dess id
  async function createPlan(state) {
    const ids = readIds();
    const id = String(Math.max(0, ...ids.map(n => parseInt(n, 10) || 0)) + 1);
    localStorage.setItem(planKey(id), JSON.stringify(state));
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([...ids, id]));
    return id;
  }

  return { listPlans, loadPlan, savePlan, createPlan };
})();
