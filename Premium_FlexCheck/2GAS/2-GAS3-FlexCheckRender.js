

/***** ========= CONFIG ========= *****/
const CFG = {
  SHEET_ID: '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0',
  SHEET_NAME: 'Processed',    // <- we now read from Processed
  HEADER_ROW: 1,
  API_KEY: '',                // optional simple key gate; '' to disable
  CACHE_SECONDS: 30           // script cache for read-heavy usage
};

/*
Processed headers (exact order in your sheet):
entryId,ticket,email,isPaid,createdAtISO,cachedAt,weekKey,score,summary,
divisionFit,muscleRatings,age,heightCm,heightIn,weightKg,weightLb,
trainingAgeYears,socialHandle,photos,bestExercises,biomechanics
*/

/***** ========= ENTRYPOINT ========= *****/
function doGet(e){
  try{
    const p = normalizeParams(e);
    enforceApiKey_(p);

    const fn = (p.fn || '').toLowerCase();
    switch(fn){

      // List entryIds for an email (simple)
      case 'ids': {
  const email = normalizeEmail_(p.email);
  if(!email) return bad_('Missing or invalid email');
  const { rows } = getProcessedData_();
  const ids = rows
    .filter(r => normalizeEmail_(r.email) === email && r.entryid)
    .map(r => String(r.entryid));
  const entryIds = Array.from(new Set(ids))
    .sort((a,b)=>(parseInt(b,10)||0)-(parseInt(a,10)||0));
  return ok_({ email, entryIds, count: entryIds.length });
}


      // Single entry by entryId
      case 'entry': {
        const id = normalizeId_(p.entryId);
        if(!id) return bad_('Missing or invalid entryId');
        const { rows } = getProcessedData_();
        const row = rows.find(r => String(r.entryid || '') === id);
        if(!row) return notFound_(`No entry found for entryId=${id}`);
        return ok_({ entry: hydrateProcessed_(row) });
      }

      // All entries for an email (back-compat + grouped)
      // returns: { email, entries: [...], byId: { [entryId]: entry }, ids: [...], count }
      case 'entries': {
        const email = normalizeEmail_(p.email);
        if(!email) return bad_('Missing or invalid email');
        const { rows } = getProcessedData_();
        const matches = rows.filter(r => normalizeEmail_(r.email) === email && r.entryid);

        const hydrated = matches.map(hydrateProcessed_);
        hydrated.sort((a,b) => {
          // newest first by createdAtISO then numeric entryId
          const atA = Date.parse(a.createdAtISO || '') || 0;
          const atB = Date.parse(b.createdAtISO || '') || 0;
          if (atA !== atB) return atB - atA;
          return (parseInt(b.entryId,10)||0) - (parseInt(a.entryId,10)||0);
        });

        const byId = {};
        const ids = [];
        for(const rec of hydrated){
          byId[rec.entryId] = rec;
          ids.push(rec.entryId);
        }

        return ok_({ email, entries: hydrated, byId, ids, count: hydrated.length });
      }

      // (Optional) Global grouped index across ALL entries (admin / prefetch)
      // returns: { ids:[...], byId:{ id:entry }, count }
      case 'index': {
        const grouped = getGlobalGrouped_();
        return ok_(grouped);
      }

      default:
        return bad_('Invalid or missing fn (use fn=ids, fn=entry, fn=entries, or fn=index)');
    }
  }catch(err){
    return serverError_(err);
  }
}

/***** ========= CORE (Processed -> Hydrated) ========= *****/

/** Build a lightweight global grouped map for all entries. Cached. */
function getGlobalGrouped_(){
  const cache = CacheService.getScriptCache();
  const key = 'fc_grouped_v2';
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const { rows } = getProcessedData_();
  const byId = {};
  const ids = [];

  for(const row of rows){
    if(!row.entryid) continue;
    const rec = hydrateProcessed_(row);
    byId[rec.entryId] = rec;
    ids.push(rec.entryId);
  }

  // newest first
  ids.sort((a,b) => (parseInt(b,10)||0) - (parseInt(a,10)||0));
  const payload = { ids, byId, count: ids.length };
  cache.put(key, JSON.stringify(payload), CFG.CACHE_SECONDS);
  return payload;
}

/** Convert a Processed-row map into FE-ready shape (group-friendly). */
function hydrateProcessed_(row){
  const entryId = safeStr_(row.entryid);
  const ticket  = safeStr_(row.ticket);
  const email   = safeStr_(row.email);

  const createdAtISO = toIso_(row.createdatiso);
  const cachedAt     = toIso_(row.cachedat);
  const weekKey      = safeStr_(row.weekkey);

  const isPaid = parseBoolean_(row.ispaid);
  const score  = numOrNull_(row.score);
  const summary = safeStr_(row.summary);

  const divisionFit   = parseJsonSafe_(row.divisionfit)   || {};
  const muscleRatings = parseJsonSafe_(row.muscleratings) || {};
  const photos        = parseJsonSafe_(row.photos)        || [];
  const bestExercises = parseJsonSafe_(row.bestexercises) || [];
  const biomechanics  = parseJsonSafe_(row.biomechanics)  || [];

  const profile = {
    age:                numOrNull_(row.age),
    heightCm:           numOrNull_(row.heightcm),
    heightIn:           numOrNull_(row.heightin),
    weightKg:           numOrNull_(row.weightkg),
    weightLb:           numOrNull_(row.weightlb),
    trainingAgeYears:   numOrNull_(row.trainingageyears),
    socialHandle:       safeStr_(row.socialhandle)
  };

  // Return a clean, FE-friendly object. Grouping on FE is trivial via entryId.
  return {
    entryId, ticket, email, isPaid,
    createdAtISO, cachedAt, weekKey,
    score, summary,
    divisionFit, muscleRatings,
    profile,
    media: { photos },
    bestExercises,
    biomechanics
  };
}

/***** ========= SHEET ACCESS + CACHE ========= *****/
function getProcessedData_(){
  const cache = CacheService.getScriptCache();
  const cacheKey = 'flexcheck_processed_v2';
  const hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sh = ss.getSheetByName(CFG.SHEET_NAME);
  if(!sh) throw new Error('Sheet not found: ' + CFG.SHEET_NAME);

  const values = sh.getDataRange().getValues();
  if (!values || values.length < CFG.HEADER_ROW) return { header: [], rows: [] };

  const headers = values[CFG.HEADER_ROW - 1].map(h => normalizeHeader_(h));
  const rows = [];
  for (let r = CFG.HEADER_ROW; r < values.length; r++){
    const row = values[r];
    const o = {};
    for(let c=0;c<headers.length;c++){
      const key = headers[c]; if(!key) continue;
      o[key] = row[c];
    }
    rows.push(o);
  }

  const payload = { header: headers, rows };
  if (CFG.CACHE_SECONDS > 0){
    cache.put(cacheKey, JSON.stringify(payload), CFG.CACHE_SECONDS);
  }
  return payload;
}

/***** ========= UTIL ========= *****/
function normalizeParams(e){
  const p = (e && e.parameter) ? e.parameter : {};
  if (p.entryID && !p.entryId) p.entryId = p.entryID;
  if (p.entryid && !p.entryId) p.entryId = p.entryid;
  return p;
}
function enforceApiKey_(p){
  if (!CFG.API_KEY) return;
  if ((p.key || p.apiKey || p.apikey) !== CFG.API_KEY){
    throw new Error('Unauthorized');
  }
}
function normalizeHeader_(h){
  return String(h || '').trim().toLowerCase().replace(/\s+/g,''); // "createdAtISO" -> "createdatiso"
}
function normalizeEmail_(e){
  const s = String(e || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}
function normalizeId_(id){
  const s = String(id || '');
  const digits = s.match(/\d+/g);
  return digits ? digits.join('') : '';
}
function parseJsonSafe_(v){
  if (v == null) return null;
  if (typeof v === 'object') return v;
  const s = String(v).trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch(e){ return null; }
}
function parseBoolean_(v){
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true','1','yes','y'].includes(s)) return true;
  if (['false','0','no','n',''].includes(s)) return false;
  return false;
}
function numOrNull_(v){
  if (v == null || v === '' || v === 'null') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toIso_(v){
  if (v instanceof Date) return v.toISOString();
  const s = String(v || '').trim();
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
function safeStr_(v){ return (v == null) ? '' : String(v); }

/***** ========= RESPONSE HELPERS ========= *****/
function ok_(obj){
  const out = ContentService.createTextOutput(JSON.stringify({ ok:true, ...obj }))
    .setMimeType(ContentService.MimeType.JSON);
  return out;
}
function bad_(msg){
  const out = ContentService.createTextOutput(JSON.stringify({ ok:false, error: String(msg) }))
    .setMimeType(ContentService.MimeType.JSON);
  return out;
}
function notFound_(msg){
  const out = ContentService.createTextOutput(JSON.stringify({ ok:false, error: String(msg), status:404 }))
    .setMimeType(ContentService.MimeType.JSON);
  return out;
}
function serverError_(err){
  const out = ContentService.createTextOutput(JSON.stringify({
    ok:false, error: (err && err.message) ? err.message : String(err), status:500
  })).setMimeType(ContentService.MimeType.JSON);
  return out;
}
