// TILLFÄLLIG testfil (committas inte): låtsas-Supabase för att förhandsgranska inloggade sidor lokalt.
(function () {
  const user = { id: 'u1', email: 'tobias.frithiofsson@gmail.com', app_metadata: { role: 'admin' }, user_metadata: { display_name: 'Lina Berg', avatar: 'rocket', demo_seeded: true } };
  const session = { user, access_token: 'mock' };
  const saved = JSON.parse(sessionStorage.getItem('mockDb') || 'null');
  // Projekt: lärarens egna (1) och ett delat (2) där kollegan Kristoffer (u2) också är med
  const tables = saved || {
    plans: [
      { id: 1, owner_id: 'u1', project_id: 1, state: { demo: true, demoKey: '1', title: 'Demokrati – grunderna och processerna', subject: 'Samhällskunskap', grade: '7–9', avatar: 'sailboat' } },
      { id: 2, owner_id: 'u1', project_id: 1, state: { demo: true, demoKey: '2', title: 'Källkritik i det digitala samhället', subject: 'Samhällskunskap', grade: '9', avatar: 'lightning' } },
      { id: 3, owner_id: 'u1', project_id: 1, state: { demo: true, demoKey: '3', title: 'Fotosyntes – från molekyl till ekosystem', subject: 'Biologi', grade: '7', avatar: 'compass' } },
      { id: 4, owner_id: 'u2', project_id: 2, state: { demo: true, demoKey: '1', title: 'Kristoffers demokratiupplägg', subject: 'Samhällskunskap', grade: '8', avatar: 'compass' } },
      { id: 5, owner_id: 'u1', project_id: 2, state: { demo: true, demoKey: '3', title: 'Linas fotosyntes för skolan', subject: 'Biologi', grade: '7', avatar: 'sailboat' } },
    ],
    projects: [
      { id: 1, name: 'Mina upplägg', personal_owner: 'u1', created_at: '2026-10-19T10:00:00Z' },
      { id: 2, name: 'Sandlådan', personal_owner: null, created_at: '2026-10-19T11:00:00Z' },
    ],
    lesson_events: [],
  };
  const memberProfiles = [
    { project_id: 1, user_id: 'u1', role: 'owner', display_name: 'Lina Berg', avatar: 'rocket', email: user.email },
    { project_id: 2, user_id: 'u1', role: 'owner', display_name: 'Lina Berg', avatar: 'rocket', email: user.email },
    { project_id: 2, user_id: 'u2', role: 'member', display_name: 'Kristoffer Ek', avatar: 'cat', email: 'kristoffer@skola.se' },
  ];
  const persist = () => sessionStorage.setItem('mockDb', JSON.stringify(tables));
  window.__mockDb = tables;
  function builder(table) {
    const q = { f: [], op: 'select' };
    const rows = () => (tables[table] = tables[table] || []);
    const run = () => {
      let res = rows().filter(r => q.f.every(fn => fn(r)));
      const nextId = () => Math.max(0, ...rows().map(r => r.id)) + 1;
      if (q.op === 'insert') {
        // Som databasen: skaparen är den inloggade, projektet det egna om inget anges
        const defaults = table === 'plans' ? { owner_id: user.id, project_id: 1 } : {};
        const ins = [].concat(q.p).map(p => ({ id: nextId(), ...defaults, ...p }));
        rows().push(...ins); res = ins;
      }
      // Som databasens regler: bara skaparen ändrar och tar bort upplägg
      if (table === 'plans' && (q.op === 'update' || q.op === 'delete')) res = res.filter(r => r.owner_id === user.id);
      if (q.op === 'upsert') {
        const keys = q.onConflict.split(',');
        res = [].concat(q.p).map(p => {
          const hit = rows().find(r => keys.every(k => String(r[k]) === String(p[k])));
          if (hit) { Object.assign(hit, p); return hit; }
          const row = { id: nextId(), ...p }; rows().push(row); return row;
        });
      }
      if (q.op === 'update') res.forEach(r => Object.assign(r, q.p));
      if (q.op === 'delete') tables[table] = rows().filter(r => !res.includes(r));
      if (q.order) res = res.slice().sort((a, b) => (a[q.order] > b[q.order] ? 1 : -1));
      if (q.limit) res = res.slice(0, q.limit);
      persist();
      if (q.single) return { data: res[0], error: null };
      if (q.maybe) return { data: res[0] || null, error: null };
      return { data: res, error: null };
    };
    const api = {
      select() { return api; }, order(k) { q.order = k; return api; }, limit(n) { q.limit = n; return api; },
      eq(k, v) { q.f.push(r => String(r[k]) === String(v)); return api; },
      gte(k, v) { q.f.push(r => r[k] >= v); return api; },
      lt(k, v) { q.f.push(r => r[k] < v); return api; },
      insert(p) { q.op = 'insert'; q.p = p; return api; },
      upsert(p, o) { q.op = 'upsert'; q.p = p; q.onConflict = o.onConflict; return api; },
      update(p) { q.op = 'update'; q.p = p; return api; },
      delete() { q.op = 'delete'; return api; },
      maybeSingle() { q.maybe = true; return Promise.resolve(run()); }, single() { q.single = true; return Promise.resolve(run()); },
      then(a, b) { return Promise.resolve(run()).then(a, b); },
    };
    return api;
  }
  window.supabase = { createClient: () => ({
    from: t => builder(t),
    rpc: async (name, params) => {
      const fb = window.__mockFeedback = window.__mockFeedback || [];
      if (name === 'project_member_profiles') return { data: memberProfiles, error: null };
      if (name === 'feedback_admin_list') return { data: fb, error: null };
      if (name === 'feedback_admin_update') { const f = fb.find(x => x.id === params.p_id); Object.assign(f, { status: params.p_status, note: params.p_note || null }); return { data: null, error: null }; }
      return { data: null, error: { code: 'PGRST202' } };
    },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: cb => { setTimeout(() => cb('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe() {} } } }; },
      updateUser: async ({ data }) => { Object.assign(user.user_metadata, data || {}); return { data: { user }, error: null }; },
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ error: null }),
    },
  }) };
})();
