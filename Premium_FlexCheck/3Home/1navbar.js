<!-- ░░░ flexCHECK NAVBAR – GAMIFIED ░░░ -->
<nav class="flexcheck-nav">
  <a href="/flexcheck/flexcheck-player-card" class="nav-item" data-tab="playercard">
    <span class="emoji">🎴</span>
    <span class="label">My Card</span>
  </a>
  <a href="/flexcheck" class="nav-item" data-tab="home">
    <span class="emoji">🏠</span>
    <span class="label">Home</span>
  </a>
  <a href="/flexcheck/flexcheck-leaderboard" class="nav-item" data-tab="leaderboard">
    <span class="emoji">🏆</span>
    <span class="label">Leaderboard</span>
  </a>
</nav>

<style>
/* ========== NAV BAR WRAPPER ========== */
.flexcheck-nav {
  display: flex;
  justify-content: center;
  gap: 2rem;
  padding: 1rem 0.75rem;
  background: linear-gradient(to right, #0f172a, #1e293b);
  border-bottom: 2px solid var(--accent, #27BEFA);
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  text-transform: uppercase;
  border-radius: 0 0 12px 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  position: relative;
  z-index: 10;
}

/* ========== NAV ITEMS ========== */
.nav-item {
  color: rgba(255,255,255,0.4);
  text-decoration: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: color 0.3s ease, transform 0.2s;
  position: relative;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
}

.nav-item .emoji {
  font-size: 1.2rem;
  margin-bottom: 0.2rem;
  transition: transform 0.3s ease;
}

.nav-item.active,
.nav-item:hover {
  color: var(--accent, #27BEFA);
}

.nav-item.active .emoji {
  transform: scale(1.2);
}

.nav-item:active {
  transform: scale(0.94);
}

/* optional glow effect when active */
.nav-item.active::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 60%;
  height: 3px;
  background: var(--accent, #27BEFA);
  border-radius: 99px;
  box-shadow: 0 0 6px var(--accent, #27BEFA);
}
</style>

<script>
/* ========= FLEXCHECK NAV CONTEXT (minimal, nav-only) ========= */
(function(){
  if (window.flexcheck?.__inited) return;

  const STORE_KEY = 'flexcheckOwner';
  const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

  const storage = {
    get(){ try { return JSON.parse(localStorage.getItem(STORE_KEY)||'null')||null; } catch { return null; } },
    set(o){ try { localStorage.setItem(STORE_KEY, JSON.stringify({...o, updatedAt: Date.now()})); } catch {} },
    clear(){ try { localStorage.removeItem(STORE_KEY); } catch {} }
  };

  function onlyDigits(x){ const m = String(x||'').match(/\d+/g); return m ? m.join('') : ''; }
  function validEmail(e){ return EMAIL_RE.test(String(e||'')); }
  function getUrlParams(){
    const u = new URL(location.href);
    const entries = Object.fromEntries(u.searchParams.entries());
    const k = Object.keys(entries).find(k => k.toLowerCase()==='entryid');
    const entryId = k ? onlyDigits(entries[k]) : '';
    const email   = entries.email ? entries.email.trim() : '';
    return { entryId, email };
  }

  let owner = storage.get();      // { email, preferredEntryId, entryIds[] } | null
  let viewerEntryId = '';         // current viewer (ephemeral)

  function initViewerFromUrlOrOwner(){
    const { entryId } = getUrlParams();
    viewerEntryId = entryId || owner?.preferredEntryId || '';
  }

  function wireNavLinks(){
    document.querySelectorAll('.flexcheck-nav .nav-item').forEach(a => {
      try{
        const url = new URL(a.getAttribute('href'), location.origin);
        url.searchParams.delete('email');             // keep nav URLs clean
        if (viewerEntryId) url.searchParams.set('entryId', viewerEntryId);
        a.setAttribute('href', url.pathname + url.search);
      }catch{}
    });

    let pathname = location.pathname.toLowerCase();
    if (pathname.endsWith('/')) pathname = pathname.slice(0,-1);
    const tabs = {
      'playercard': '/flexcheck/flexcheck-player-card',
      'leaderboard': '/flexcheck/flexcheck-leaderboard',
      'home': '/flexcheck'
    };
    for (const [key, url] of Object.entries(tabs)) {
      const el = document.querySelector(`.nav-item[data-tab="${key}"]`);
      el?.classList.toggle('active', pathname === url);
    }
  }

  async function setOwnerEmail(email, entryIds){
    if (!validEmail(email)) throw new Error('Invalid email');
    const ids = Array.isArray(entryIds) ? entryIds.map(onlyDigits) : [];
    owner = {
      email,
      preferredEntryId: ids[0] || owner?.preferredEntryId || '',
      entryIds: ids
    };
    storage.set(owner);
    if (!getUrlParams().entryId) {
      viewerEntryId = owner.preferredEntryId || '';
      wireNavLinks();
    }
  }

  function setOwnerPreferred(entryId, { updateUrl = true } = {}){
    const id = onlyDigits(entryId);
    if (!id || !owner) return;
    owner.preferredEntryId = id;
    if (Array.isArray(owner.entryIds) && !owner.entryIds.includes(id)) owner.entryIds.push(id);
    storage.set(owner);
    viewerEntryId = id;
    if (updateUrl) {
      const u = new URL(location.href);
      u.searchParams.set('entryId', id);
      history.replaceState(null, '', u.toString());
    }
    wireNavLinks();
  }

  function setViewerEphemeral(entryId, { pushUrl = false } = {}){
    viewerEntryId = onlyDigits(entryId);
    if (pushUrl) {
      const u = new URL(location.href);
      u.searchParams.set('entryId', viewerEntryId);
      history.replaceState(null, '', u.toString());
    }
    wireNavLinks();
  }

  function claimOwnerFromUrl(){
    const { email } = getUrlParams();
    if (!validEmail(email)) return false;
    owner = owner || { email: '', preferredEntryId: '', entryIds: [] };
    owner.email = email;
    storage.set(owner);
    wireNavLinks();
    return true;
  }

  function clearOwner(){
    owner = null; storage.clear();
    const u = new URL(location.href);
    u.searchParams.delete('email');
    history.replaceState(null, '', u.toString());
    initViewerFromUrlOrOwner();
    wireNavLinks();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initViewerFromUrlOrOwner();
    wireNavLinks();
    window.flexcheck = {
      __inited: true,
      getOwner: () => owner,
      getViewerEntryId: () => viewerEntryId,
      setOwnerEmail,
      setOwnerPreferred,
      setViewerEphemeral,
      claimOwnerFromUrl,
      clearOwner
    };
  });
})();

// Persist owner when arriving with ?email= (doesn't change viewer)
document.addEventListener('DOMContentLoaded', () => {
  try { window.flexcheck?.claimOwnerFromUrl(); } catch(e){}
});
</script>