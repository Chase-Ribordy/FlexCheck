const CFG = {
  SHEET_ID: '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0',
  TAB_NAME: 'Processed',        // <-- change if needed
  CACHE_SEC: 60,             // small cache per weekKey to reduce reads
  // Optional: simple shared secret. If you want it, require &token=... in doGet.
  TOKEN: ''                  // e.g. 'supersecret'; leave blank to disable
};

function doGet(e) {
  try {
    const p = e && e.parameter || {};
    if (CFG.TOKEN && p.token !== CFG.TOKEN) return json({ ok:false, error:'Unauthorized' }, 401);

    switch (p.fn) {
      case 'rivals':
        return handleRivals(p);
      default:
        return json({ ok:false, error:'Unknown function' }, 400);
    }
  } catch (err) {
    return json({ ok:false, error:String(err) }, 500);
  }
}

function handleRivals(p) {
  const entryId = str(p.entryId);
  const weekKey = str(p.weekKey);
  if (!entryId || !weekKey) return json({ ok:false, error:'Missing entryId or weekKey' }, 400);

  const cacheKey = `wk:${weekKey}`;
  const cache = CacheService.getScriptCache();
  let cached = cache.get(cacheKey);
  /** We cache the week’s sorted+ranked rows to avoid full sheet scans on each request */
  let ranked;
  if (cached) {
    ranked = JSON.parse(cached);
  } else {
    const rows = readRows();
    const weekRows = rows
      .filter(r => eqWeek(str(r.weekKey), weekKey) && num(r.score) > 0);
    if (!weekRows.length) return json({ ok:false, error:'No entries found for the specified week' }, 404);

    // Sort high->low by numeric score
    weekRows.sort((a,b) => num(b.score) - num(a.score));

    // Assign ranks (dense)
    for (let i = 0; i < weekRows.length; i++) weekRows[i].rank = i + 1;

    ranked = weekRows;
    cache.put(cacheKey, JSON.stringify(ranked), CFG.CACHE_SEC);
  }

  const you = ranked.find(r => str(r.entryId) === entryId);
  if (!you) return json({ ok:false, error:'User entry not found in this week' }, 404);

  const youRank = you.rank;
  const start = Math.max(1, youRank - 2);
  const end   = Math.min(ranked.length, youRank + 2);

  const rivals = [];
  for (let r = start; r <= end; r++) {
    const row = ranked[r - 1];
    if (!row) continue;
    rivals.push(toPublic(row, row.entryId == entryId));
  }

  return json({
    ok: true,
    weekKey,
    youEntryId: entryId,
    totalEntries: ranked.length,
    yourRank: youRank,
    rivals
  });
}

/** ---------- Sheet IO & Normalization ---------- */

function readRows() {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sh = ss.getSheetByName(CFG.TAB_NAME);
  if (!sh) {
    const names = ss.getSheets().map(s => s.getName());
    throw new Error(`Sheet not found: "${CFG.TAB_NAME}". Available tabs: ${JSON.stringify(names)}`);
  }
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(h => str(h));
  const idx = index(headers);

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || row.length === 0) continue;

    const rec = {
      entryId: str(row[idx.entryId]),
      ticket: str(row[idx.ticket]),
      email: str(row[idx.email]),
      isPaid: bool(row[idx.isPaid]),
      createdAtISO: toISO(row[idx.createdAtISO]),
      cachedAt: toISO(row[idx.cachedAt]),
      weekKey: normWeek(row[idx.weekKey]),
      score: num(row[idx.score]),
      summary: str(row[idx.summary]),
      divisionFit: jsonish(row[idx.divisionFit]),
      muscleRatings: jsonish(row[idx.muscleRatings]),
      age: int(row[idx.age]),
      heightCm: numOrNull(row[idx.heightCm]),
      heightIn: numOrNull(row[idx.heightIn]),
      weightKg: numOrNull(row[idx.weightKg]),
      weightLb: numOrNull(row[idx.weightLb]),
      trainingAgeYears: numOrNull(row[idx.trainingAgeYears]),
      socialHandle: str(row[idx.socialHandle]) || 'Anonymous',
      photos: arrayish(row[idx.photos]),
      bestExercises: jsonish(row[idx.bestExercises]),
      biomechanics: arrayish(row[idx.biomechanics])
    };

    if (rec.weightKg == null && rec.weightLb != null) rec.weightKg = round2(rec.weightLb / 2.20462);
    if (rec.weightLb == null && rec.weightKg != null) rec.weightLb = round2(rec.weightKg * 2.20462);
    if (rec.heightCm == null && rec.heightIn != null) rec.heightCm = round2(rec.heightIn * 2.54);
    if (rec.heightIn == null && rec.heightCm != null) rec.heightIn = round2(rec.heightCm / 2.54);

    out.push(rec);
  }
  return out;
}


function index(headers){
  /** Map expected header names to indices. Adjust names here if your sheet headers change. */
  const need = [
    'entryId','ticket','email','isPaid','createdAtISO','cachedAt','weekKey','score','summary',
    'divisionFit','muscleRatings','age','heightCm','heightIn','weightKg','weightLb',
    'trainingAgeYears','socialHandle','photos','bestExercises','biomechanics'
  ];
  const map = {};
  for (const h of need) {
    const j = headers.indexOf(h);
    if (j === -1) throw new Error(`Missing header: ${h}`);
    map[h] = j;
  }
  return map;
}

/** ---------- Output shaping ---------- */
function toPublic(rec, isYou){
  return {
    entryId: str(rec.entryId),
    rank: rec.rank,
    socialHandle: rec.socialHandle || 'Anonymous',
    score: num(rec.score),
    you: !!isYou,

    // Mini player card payload
    age: int(rec.age),
    heightCm: numOrNull(rec.heightCm),
    heightIn: numOrNull(rec.heightIn),
    weightKg: numOrNull(rec.weightKg),
    weightLb: numOrNull(rec.weightLb),
    trainingAgeYears: numOrNull(rec.trainingAgeYears),
    photos: Array.isArray(rec.photos) ? rec.photos : [],
    divisionFit: rec.divisionFit || {},
    muscleRatings: rec.muscleRatings || {},
    bestExercises: Array.isArray(rec.bestExercises) ? rec.bestExercises : [],
    biomechanics: Array.isArray(rec.biomechanics) ? rec.biomechanics : [],
    summary: rec.summary || ''
  };
}

/** ---------- Coercion helpers ---------- */
function str(v){ return (v == null) ? '' : String(v).trim(); }
function int(v){ const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function numOrNull(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function bool(v){
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}
function toISO(v){
  if (v instanceof Date) return v.toISOString();
  const s = str(v);
  return s ? s : null;
}
function normWeek(v){
  // Accept either a Date cell or a string like '2025-08-04'
  if (v instanceof Date) return ymd(v);
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Last resort: try Date parse
  const d = new Date(s);
  return isNaN(d) ? s : ymd(d);
}
function ymd(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function eqWeek(a,b){ return str(a) === str(b); }
function round2(n){ return Math.round(n * 100) / 100; }

function jsonish(v){
  if (v == null || v === '') return null;
  if (typeof v === 'object') return v;
  const s = str(v);
  try { return JSON.parse(s); } catch(e){ return null; }
}
function arrayish(v){
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v;
  const s = str(v);
  try {
    const j = JSON.parse(s);
    return Array.isArray(j) ? j : [];
  } catch(e){
    // Fallback: comma-separated string
    return s.split(',').map(x => x.trim()).filter(Boolean);
  }
}

/** ---------- JSON response ---------- */
function json(obj, status) {
  // Apps Script ContentService can’t set status code, but we keep param for clarity.
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Quick test in Apps Script logs */
function testRivals(){
  const res = handleRivals({ entryId:'1001', weekKey:'2025-08-04' });
  Logger.log(res.getContent());
}
