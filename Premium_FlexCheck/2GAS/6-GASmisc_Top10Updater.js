/** ================================
 *  FlexCheck Leaderboard (Standalone GAS)
 *  Spreadsheet: 1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0
 *  Source tab:  "Processed"
 *  Target tab:  "CurrentTop10"
 *  Target headers (in order):
 *  weekKey, deadlineKey, tier, rank, score, entryId, createdAtISO, socialHandle, divisionFit, muscleRatings, photos
 *  ================================ */

const SPREADSHEET_ID = '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0';
const SRC_SHEET      = 'Processed';
const OUT_SHEET      = 'CurrentTop10';
const TZ             = 'America/Chicago';
const DISPLAY_COUNT  = 10;

// Optional: protect update endpoint
const SHARED_SECRET  = 'set-a-long-random-string-here'; // change me (or leave '' to disable auth)

/* ---------- CT helpers (DST-safe) ---------- */
function nowCt_() {
  const now = new Date();
  const fmt = Utilities.formatDate(now, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  return new Date(fmt);
}
function toCt_(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const fmt = Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  return new Date(fmt);
}
function iso_(d) {
  return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/* ---------- Competition week math ---------- */
// Week starts Fri 8:00 PM CT; deadline Thu 7:00 PM CT
function weekAnchorFriday_(dCt) {
  const wd = parseInt(Utilities.formatDate(dCt, TZ, 'u'), 10); // 1..7 (Mon..Sun)
  const daysSinceFri = (wd >= 5) ? (wd - 5) : (wd + 2);
  const fri = new Date(dCt);
  fri.setDate(dCt.getDate() - daysSinceFri);
  fri.setHours(20, 0, 0, 0); // Fri 8:00 PM CT

  // NEW: if timestamp is earlier than this Friday 8pm, use the *previous* Friday 8pm
  if (dCt < fri) { fri.setDate(fri.getDate() - 7); }

  return fri;
}

function recomputeKeysForTs_(ts /* Date in CT */) {
  const anchor = weekAnchorFriday_(ts);
const wk = Utilities.formatDate(anchor, TZ, 'yyyy-MM-dd');
  const dl = new Date(anchor); dl.setDate(anchor.getDate() + 6); dl.setHours(19,0,0,0);
  const dk = `DL-${Utilities.formatDate(dl, TZ, 'yyyy-MM-dd')}`;
  return { weekKey: wk, deadlineKey: dk };
}
function isActiveWindow_(dCt) {
  const anchor = weekAnchorFriday_(dCt);
  const thuFreeze = new Date(anchor); thuFreeze.setDate(anchor.getDate() + 6); thuFreeze.setHours(19,0,0,0); // Thu 7pm
  return (dCt >= anchor) && (dCt < thuFreeze); // active: Fri 8pm -> Thu 7pm
}

/* ---------- Data ingest ---------- */
function readProcessed_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SRC_SHEET);
  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  const header = values[0].map(String);

  const idx = (name) => header.indexOf(name);
  const iEntryId  = idx('entryId');
  const iScore    = idx('score');
  const iCreated  = idx('createdAtISO');
  const iCached   = idx('cachedAt');
  const iSocial   = idx('socialHandle');
  const iDiv      = idx('divisionFit');
  const iMus      = idx('muscleRatings');
  const iPhotos   = idx('photos');

  // NEW fields
  const iAge      = idx('age');
  const iHeightCm = idx('heightCm');
  const iHeightIn = idx('heightIn');
  const iWeightKg = idx('weightKg');
  const iWeightLb = idx('weightLb');
  const iTrainYrs = idx('trainingAgeYears');

  const numOrNull = (v) => {
    const n = (typeof v === 'number') ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return values.slice(1).map(r => {
    const rawCreated = r[iCreated];
    const rawCached  = r[iCached];
    const created    = (rawCreated instanceof Date) ? rawCreated : new Date(rawCreated);
    const cached     = (rawCached  instanceof Date) ? rawCached  : new Date(rawCached);
    const ts         = toCt_( (created && !isNaN(created)) ? created : (cached && !isNaN(cached) ? cached : null) );

    const scoreNum   = Number(r[iScore]);
    return {
      entryId: r[iEntryId],
      score: Number.isFinite(scoreNum) ? scoreNum : NaN,
      createdAt: ts,
      createdAtISO: (ts ? iso_(ts) : null),
      socialHandle: r[iSocial] || '',
      divisionFit: (iDiv >= 0 && r[iDiv] != null) ? String(r[iDiv]) : '',
      muscleRatings: (iMus >= 0 && r[iMus] != null) ? String(r[iMus]) : '',
      photos: (iPhotos >= 0 && r[iPhotos] != null) ? String(r[iPhotos]) : '',

      // NEW fields (nullable numbers are fine)
      age:        (iAge      >= 0) ? numOrNull(r[iAge])      : null,
      heightCm:   (iHeightCm >= 0) ? numOrNull(r[iHeightCm]) : null,
      heightIn:   (iHeightIn >= 0) ? numOrNull(r[iHeightIn]) : null,
      weightKg:   (iWeightKg >= 0) ? numOrNull(r[iWeightKg]) : null,
      weightLb:   (iWeightLb >= 0) ? numOrNull(r[iWeightLb]) : null,
      trainingAgeYears: (iTrainYrs >= 0) ? numOrNull(r[iTrainYrs]) : null
    };
  }).filter(o => o.createdAt); // require timestamp
}


/* ---------- Median & sort helpers ---------- */
function median_(nums) {
  const a = nums.slice().sort((x,y)=>x-y);
  const n = a.length;
  if (n === 0) return NaN;
  return (n % 2) ? a[(n-1)>>1] : (a[n/2 - 1] + a[n/2]) / 2;
}
function byEarlier_(a, b) {
  const t = (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
  if (t !== 0) return t;
  const aid = +a.entryId; const bid = +b.entryId;
  if (Number.isFinite(aid) && Number.isFinite(bid)) return aid - bid;
  return String(a.entryId).localeCompare(String(b.entryId));
}

/* ---------- Compute tiers for the *current* cycle ---------- */
function computeForCurrentWeek_() {
  const rows = readProcessed_();
  const now = nowCt_();
  const currentKeys = recomputeKeysForTs_(now);
  const targetWeekKey = currentKeys.weekKey;

  const eligible = rows.map(o => {
    const keys = recomputeKeysForTs_(o.createdAt);
    return { ...o, weekKey: keys.weekKey, deadlineKey: keys.deadlineKey };
  }).filter(o => o.weekKey === targetWeekKey && Number.isFinite(o.score) && o.score > 0);

  // Top
  const topSorted = eligible.slice().sort((a,b)=>{
    const s = b.score - a.score; // desc
    return s !== 0 ? s : byEarlier_(a,b);
  }).slice(0, DISPLAY_COUNT);

  // Low
  const lowSorted = eligible.slice().sort((a,b)=>{
    const s = a.score - b.score; // asc
    return s !== 0 ? s : byEarlier_(a,b);
  }).slice(0, DISPLAY_COUNT);

  // Mid
  const med = median_(eligible.map(e => e.score));
  const midSorted = eligible.slice().sort((a,b)=>{
    const da = Math.abs(a.score - med), db = Math.abs(b.score - med);
    if (da !== db) return da - db;
    return byEarlier_(a,b);
  }).slice(0, DISPLAY_COUNT);

  return {
    weekKey: targetWeekKey,
    deadlineKey: currentKeys.deadlineKey,
    median: Number.isFinite(med) ? med : null,
    top: topSorted,
    low: lowSorted,
    mid: midSorted
  };
}

/* ---------- Writer ---------- */
function writeCurrentTop10_(bundle) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(OUT_SHEET);
  if (!sh) sh = ss.insertSheet(OUT_SHEET);
  sh.clear();

  // UPDATED header (additions at the end, in your specified order)
  const header = [
    'weekKey','deadlineKey','tier','rank','score','entryId','createdAtISO',
    'socialHandle','divisionFit','muscleRatings','photos',
    'age','heightCm','heightIn','weightKg','weightLb','trainingAgeYears'
  ];
  sh.getRange(1,1,1,header.length).setValues([header]);

  let row = 2;
  const writeBlock = (tierName, arr) => {
    arr.forEach((o, i) => {
      sh.getRange(row,1,1,header.length).setValues([[
        bundle.weekKey,
        bundle.deadlineKey,
        tierName,
        i+1,
        o.score,
        o.entryId,
        o.createdAtISO,
        o.socialHandle,
        o.divisionFit,
        o.muscleRatings,
        o.photos,
        // NEW fields
        (o.age != null ? o.age : null),
        (o.heightCm != null ? o.heightCm : null),
        (o.heightIn != null ? o.heightIn : null),
        (o.weightKg != null ? o.weightKg : null),
        (o.weightLb != null ? o.weightLb : null),
        (o.trainingAgeYears != null ? o.trainingAgeYears : null)
      ]]);
      row++;
    });
  };

  // Order: Top (1..10), Low (1..10), Mid (1..10)
  writeBlock('top', bundle.top);
  writeBlock('low', bundle.low);
  writeBlock('mid', bundle.mid);
}


/* ---------- Reader (cache-first JSON) ---------- */
/* ---------- Reader (cache-first JSON) - FIXED VERSION ---------- */
function readCurrentTop10_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(OUT_SHEET);
  if (!sh) return null;
  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return null;

  const header = values[0].map(String);
  const idx = (name) => header.indexOf(name);
  const iWeekKey = idx('weekKey'), iDeadline = idx('deadlineKey'), iTier = idx('tier');
  const iRank = idx('rank'), iScore = idx('score'), iEntryId = idx('entryId');
  const iCreated = idx('createdAtISO'), iSocial = idx('socialHandle');
  const iDiv = idx('divisionFit'), iMus = idx('muscleRatings'), iPhotos = idx('photos');

  // NEW indices
  const iAge      = idx('age');
  const iHeightCm = idx('heightCm');
  const iHeightIn = idx('heightIn');
  const iWeightKg = idx('weightKg');
  const iWeightLb = idx('weightLb');
  const iTrainYrs = idx('trainingAgeYears');

  // Helper function to safely convert to number or null
  const toNum = (v) => {
    if (v === '' || v == null || v === undefined) return null;
    const n = (typeof v === 'number') ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const tiers = { top: [], low: [], mid: [] };
  let weekKey = null, deadlineKey = null;

  values.slice(1).forEach(r => {
    const tier = String(r[iTier] || '').toLowerCase();
    if (!weekKey) weekKey = r[iWeekKey];
    if (!deadlineKey) deadlineKey = r[iDeadline];
    
    const item = {
      rank: Number(r[iRank]),
      score: Number(r[iScore]),
      entryId: r[iEntryId],
      createdAtISO: r[iCreated],
      socialHandle: r[iSocial],
      divisionFit: r[iDiv],
      muscleRatings: r[iMus],
      photos: r[iPhotos],

      // FIXED: Properly handle personal data fields with type conversion
      age: (iAge >= 0) ? toNum(r[iAge]) : null,
      heightCm: (iHeightCm >= 0) ? toNum(r[iHeightCm]) : null,
      heightIn: (iHeightIn >= 0) ? toNum(r[iHeightIn]) : null,
      weightKg: (iWeightKg >= 0) ? toNum(r[iWeightKg]) : null,
      weightLb: (iWeightLb >= 0) ? toNum(r[iWeightLb]) : null,
      trainingAgeYears: (iTrainYrs >= 0) ? toNum(r[iTrainYrs]) : null
    };
    if (tiers[tier]) tiers[tier].push(item);
  });

  // Ensure rank order
  ['top','low','mid'].forEach(t => tiers[t].sort((a,b)=>a.rank-b.rank));

  return { weekKey, deadlineKey, tiers };
}


/* ---------- Orchestrator (normal; respects freeze window) ---------- */
function runUpdater() {
  const now = nowCt_();
  const updating = isActiveWindow_(now); // Fri 8:00 PM → Thu 7:00 PM
  if (!updating) return 'Frozen: skipped update.';
  const bundle = computeForCurrentWeek_();
  writeCurrentTop10_(bundle);
  return `Updated: ${bundle.weekKey}`;
}




/* ---------- Web App endpoint (update → read → JSON) ---------- */
// GET params:
//   updateBeforeRead: '1' | 'true' (default) → call runUpdater() first (no-op in freeze)
//   source: 'cache' (default) | 'compute'   → where data comes from
//   tier: 'top' | 'low' | 'mid'             → optional default tier for UI (echoed back)
/* ---------- Web App endpoint (update → read → JSON) ---------- */
// GET params:
//   updateBeforeRead: '1' | 'true' (default) → call runUpdater() first (no-op in freeze)
//   source: 'cache' (default) | 'compute'   → where data comes from
//   tier: 'top' | 'low' | 'mid'             → optional default tier (echoed back)
/* ---------- Web App endpoint (update → read → JSON) ---------- */
// GET params:
//   updateBeforeRead: '1' | 'true' (default) → call runUpdater() first (no-op in freeze)
//   source: 'cache' (default) | 'compute'   → where data comes from
//   tier: 'top' | 'low' | 'mid'             → optional default tier (echoed back)
function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const now = nowCt_();
  const updating = isActiveWindow_(now);
  const shouldUpdate = ['1','true','yes'].includes(String(p.updateBeforeRead ?? '1').toLowerCase());
  const source = (p.source || 'cache').toLowerCase();

  if (shouldUpdate) { try { runUpdater(); } catch (err) {} }

  let bundle, medianOut = null, srcLabel = source;

  if (source === 'compute') {
    bundle = computeForCurrentWeek_();
    medianOut = bundle.median;
  } else {
    const cached = readCurrentTop10_();
    if (cached) {
      bundle = {
        weekKey: cached.weekKey,
        deadlineKey: cached.deadlineKey,
        median: null,
        top: cached.tiers.top,
        low: cached.tiers.low,
        mid: cached.tiers.mid
      };
      srcLabel = 'cache';
    } else {
      bundle = computeForCurrentWeek_();
      medianOut = bundle.median;
      srcLabel = 'compute-fallback';
    }
  }

  const dlParts = bundle.deadlineKey.replace('DL-','').split('-'); // YYYY-MM-DD
  const dlDate = toCt_(new Date(dlParts[0], Number(dlParts[1])-1, dlParts[2], 19, 0, 0)); // Thu 7pm CT
  const deadlineDisplay = Utilities.formatDate(dlDate, TZ, "EEE MMM d, yyyy 'at' h:mma 'CT'");

  const top3 = {
    top: bundle.top.slice(0,3).map(normalizedItemForJson_),
    low: bundle.low.slice(0,3).map(normalizedItemForJson_),
    mid: bundle.mid.slice(0,3).map(normalizedItemForJson_)
  };

  const pack = {
    weekKey: bundle.weekKey,
    deadlineKey: bundle.deadlineKey,
    deadlineDisplay,
    updating,                 // true during Fri 8pm → Thu 7pm
    median: medianOut,        // present only when computed live
    source: srcLabel,         // 'cache' | 'compute' | 'compute-fallback'
    defaultTier: (p.tier || 'top'),
    tiers: {
      top: bundle.top.map(normalizedItemForJson_),
      low: bundle.low.map(normalizedItemForJson_),
      mid: bundle.mid.map(normalizedItemForJson_)
    },
    top3
  };

  return ContentService
    .createTextOutput(JSON.stringify(pack))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizedItemForJson_(o, i) {
  const rank = (o.rank != null) ? o.rank : (i + 1);
  const toNum = (v) => {
    if (v === '' || v == null) return null;
    const n = (typeof v === 'number') ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    rank,
    score: Number(o.score),
    entryId: o.entryId,
    createdAtISO: o.createdAtISO,
    socialHandle: o.socialHandle,
    divisionFit: o.divisionFit,
    muscleRatings: o.muscleRatings,
    photos: o.photos,

    // NEW fields
    age: toNum(o.age),
    heightCm: toNum(o.heightCm),
    heightIn: toNum(o.heightIn),
    weightKg: toNum(o.weightKg),
    weightLb: toNum(o.weightLb),
    trainingAgeYears: toNum(o.trainingAgeYears)
  };
}




