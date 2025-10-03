<script>
(function(){
  function isRenderable(e){
    return !!(e && (e.result?.score != null || (Array.isArray(e.photos) && e.photos.length)));
  }
  function getParamInsensitive(name){
    try{
      const u = new URL(location.href);
      let v = u.searchParams.get(name);
      if (v != null) return v;
      for (const [k,val] of u.searchParams.entries()){
        if (k.toLowerCase() === name.toLowerCase()) return val;
      }
    }catch{}
    return null;
  }
  function peekLocalCache(id){
    try{
      const raw = localStorage.getItem('flexcheckCacheV3');
      if (!raw) return null;
      const j = JSON.parse(raw);
      return j?.entriesById?.[String(id)] || null;
    }catch{ return null; }
  }
  function peekOwnerLocal(){
    try{
      const raw = localStorage.getItem('flexcheckOwner');
      if (!raw) return '';
      const j = JSON.parse(raw);
      return j?.email || '';
    }catch{ return ''; }
  }
  function resolveViewerIdFast(){ return getParamInsensitive('entryId') || ''; }
  function resolveViewerIdSlow(){
    const urlEntryId = getParamInsensitive('entryId');
    if (urlEntryId) return urlEntryId;

    try{
      const fx = window.flexcheck;
      return fx?.getViewerEntryId?.() || fx?.getOwner?.()?.preferredEntryId || '';
    }catch{ return ''; }
  }
  function waitForGlobals(maxMs=6000){
    return new Promise(resolve=>{
      const t0 = Date.now();
      (function tick(){
        if (window.flexcheck && window.flexcheckCache) return resolve(true);
        if (Date.now() - t0 > maxMs) return resolve(false);
        setTimeout(tick, 50);
      })();
    });
  }

  // --- Quieter cache event patch (avoids redundant entryChanged spam)
  function patchCacheEvents(){
    const cache = window.flexcheckCache;
    if (!cache || cache.__fc_demopatched) return;

    let lastEntryId = getParamInsensitive('entryId');

    const fire = (val) => {
      try {
        // Always announce cache updates (consumers depend on this)
        window.dispatchEvent(new CustomEvent('flexcheck:cacheUpdated'));

        // Only announce entryChanged if the entryId actually changed
        const cur = getParamInsensitive('entryId');
        if (cur && cur !== lastEntryId){
          lastEntryId = cur;
          window.dispatchEvent(new CustomEvent('flexcheck:entryChanged', { detail: { entryId: cur }}));
        }
      } catch {}
    };

    ['setEntry','upsertMany','fetchEntry','fetchAndPrimeOwner'].forEach(k=>{
      if (typeof cache[k] !== 'function') return;
      const orig = cache[k];
      cache[k] = function(...args){
        const r = orig.apply(this, args);
        try {
          Promise.resolve(r).then(val=>{
            // Fire on operations likely to change the cache or owner
            if (k === 'setEntry' || k === 'upsertMany' || (k === 'fetchEntry' && val) || k === 'fetchAndPrimeOwner'){
              fire(val);
            }
          }).catch(()=>{});
        } catch {
          // Best-effort: if wrapping goes sideways, don't kill the call
        }
        return r;
      };
    });

    cache.__fc_demopatched = true;
  }

  function makeGuard(el){
    const mode = (el.getAttribute('data-fc-demo') || 'entry').toLowerCase();  // 'entry' | 'owner'
    const optimistic = el.getAttribute('data-fc-optimistic') !== '0';         // default on
    const timeout = parseInt(el.getAttribute('data-fc-timeout') || '3000', 10); // rollback ms
    const debug = el.hasAttribute('data-fc-debug');

    // --- DEDUPED visibility/logging (no console spam)
    let isVisible = null; // tri-state
    const setVisible = (v) => {
      if (isVisible === v) return; // avoid duplicate show/hide + logs
      isVisible = v;
      el.style.display = v ? '' : 'none';
      if (debug) console.log('[DemoGuard]', v ? 'show' : 'hide', el);
    };
    const show = () => setVisible(true);
    const hide = () => setVisible(false);

    // Demo-first default (unchanged behavior)
    show();

    // OPTIMISTIC early hide (no globals)
    let rollback = null;
    if (optimistic){
      if (mode === 'entry'){
        const urlId = resolveViewerIdFast();
        if (urlId){
          const local = peekLocalCache(urlId);
          if (isRenderable(local)) {
            hide(); // instant
          } else {
            hide(); // hide now, rollback later if it turns out not real
            rollback = setTimeout(()=>{ show(); rollback=null; }, timeout);
          }
        }
      } else if (mode === 'owner'){
        const email = peekOwnerLocal();
        if (email) hide();
      }
    }

    (async function boot(){
      const ok = await waitForGlobals(6000);
      if (!ok) return;  // globals never arrived; rollback (if any) will handle demo

      patchCacheEvents();

      // --- Fetch guard with TTL + auto-reset after cacheUpdated
      const FETCH_TTL_MS = 10000;              // allow retry after 10s
      let triedFetchFor = new Map();           // id -> last-attempt-ts

      function canRefetch(id){
        const t = triedFetchFor.get(id);
        return !t || (Date.now() - t) > FETCH_TTL_MS;
      }
      function markTried(id){
        triedFetchFor.set(id, Date.now());
      }

      async function evaluate(){
        if (mode === 'owner'){
          const email = window.flexcheck?.getOwner?.()?.email || peekOwnerLocal();
          if (rollback){ clearTimeout(rollback); rollback = null; }
          return email ? hide() : show();
        }

        const id = resolveViewerIdSlow();
        if (!id){
          if (rollback){ clearTimeout(rollback); rollback = null; }
          return show();
        }

        const cache = window.flexcheckCache;
        const cached = cache.getEntry(String(id));
        if (isRenderable(cached)){
          if (rollback){ clearTimeout(rollback); rollback = null; }
          return hide();
        }

        // Not renderable: try to fetch, but avoid hammering
        const sid = String(id);
        if (canRefetch(sid)){
          markTried(sid);
          const fresh = await cache.fetchEntry(sid).catch(()=>null);
          if (rollback){ clearTimeout(rollback); rollback = null; }
          return isRenderable(fresh) ? hide() : show();
        }

        // Already tried recently; show demo and wait for cacheUpdated/event
        if (rollback){ clearTimeout(rollback); rollback = null; }
        return show();
      }

      // --- Debounce evaluate to 1x per frame (handles event storms)
      const raf = window.requestAnimationFrame || function(cb){ return setTimeout(cb, 16); };
      let evalScheduled = false;
      const scheduleEvaluate = () => {
        if (evalScheduled) return;
        evalScheduled = true;
        raf(() => { evalScheduled = false; evaluate(); });
      };

      // initial + subscribe
      evaluate();

      // Belt & suspenders:
      //  - Debounced evaluation on changes
      //  - Clear fetch guard after *any* cache update so a new fetch can occur quickly
      window.addEventListener('flexcheck:viewerChanged', scheduleEvaluate);
      window.addEventListener('flexcheck:entryChanged', scheduleEvaluate);
      window.addEventListener('flexcheck:cacheUpdated', () => {
        triedFetchFor.clear();        // allow immediate re-fetch after updates
        scheduleEvaluate();
      });
    })();
  }

  function initAll(){
    document.querySelectorAll('[data-fc-demo]').forEach(makeGuard);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
  window.FCDemoGuard = { initAll, init: makeGuard };
})();
</script>