/** ================================
 *  FlexCheck Leaderboard — Force Updater (Standalone GAS)
 *  Spreadsheet: 1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0
 *  Source tab:  "Processed"
 *  Target tab:  "CurrentTop10"
 *  Target headers (in order):
 *  weekKey, deadlineKey, tier, rank, score, entryId, createdAtISO, socialHandle,
 *  divisionFit, muscleRatings, photos, age, heightCm, heightIn, weightKg, weightLb, trainingAgeYears
 *  ================================ */

const SPREADSHEET_ID = '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0';
const SRC_SHEET      = 'Processed';
const OUT_SHEET      = 'CurrentTop10';
const TZ             = 'America/Chicago';
const DISPLAY_COUNT  = 10;

// Optional: protect force endpoint. Leave '' to disable auth.
const SHARED_SECRET  = ''; // e.g., 'set-a-long-random-string-here'

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
  if (dCt < fri) { fri.setDate(fri.getDate() - 7); }
  return fri;
}
function recomputeKeysForTs_(ts /* Date in CT */) {
  const anchor = weekAnchorFriday_(ts);
  const wk = `CW-${Utilities.formatDate(anchor, TZ, 'yyyy-MM-dd')}`;
  const dl = new Date(anchor); dl.setDate(anchor.getDate() + 6); dl.setHours(19,0,0,0);
  const dk = `DL-${Utilities.formatDate(dl, TZ, 'yyyy-MM-dd')}`;
  return { weekKey: wk, deadlineKey: dk };
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

  // Extended fields
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

/* ---------- Compute tiers for the current cycle (no freeze gate) ---------- */
function computeForCurrentWeek_() {
  const rows = readProcessed_();
  const now = nowCt_();
  const currentKeys = recomputeKeysForTs_(now);
  const targetWeekKey = currentKeys.weekKey;

  const eligible = rows.map(o => {
    const keys = recomputeKeysForTs_(o.createdAt);
    return { ...o, weekKey: keys.weekKey, deadlineKey: keys.deadlineKey };
  }).filter(o => o.weekKey === targetWeekKey && Number.isFinite(o.score) && o.score > 0);

  const topSorted = eligible.slice().sort((a,b)=>{
    const s = b.score - a.score; // desc
    return s !== 0 ? s : byEarlier_(a,b);
  }).slice(0, DISPLAY_COUNT);

  const lowSorted = eligible.slice().sort((a,b)=>{
    const s = a.score - b.score; // asc
    return s !== 0 ? s : byEarlier_(a,b);
  }).slice(0, DISPLAY_COUNT);

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

  writeBlock('top', bundle.top);
  writeBlock('low', bundle.low);
  writeBlock('mid', bundle.mid);
}

/* ---------- Orchestrator (ALWAYS updates; no freeze gate) ---------- */
function forceUpdate_() {
  const bundle = computeForCurrentWeek_();
  writeCurrentTop10_(bundle);
  return `Updated (forced): ${bundle.weekKey}`;
}

/* ---------- Editor entrypoint ---------- */
function forceUpdate() { // select this in the editor to run
  return forceUpdate_();
}

// NEW: Read complete tier data from CurrentTop10 sheet
function readCurrentTop10Complete_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(OUT_SHEET);
  if (!sh) return { top: [], low: [], mid: [] };

  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return { top: [], low: [], mid: [] };

  const header = values[0].map(String);
  const H = {};
  header.forEach((h, i) => { H[h] = i; });

  const asObj = (r) => ({
    rank: r[H.rank] || null,
    score: Number(r[H.score]) || 0,
    entryId: r[H.entryId],
    createdAtISO: r[H.createdAtISO] || '',
    socialHandle: r[H.socialHandle] || '',
    divisionFit: r[H.divisionFit] || '',
    muscleRatings: r[H.muscleRatings] || '',
    photos: r[H.photos] || '',
    age: r[H.age] ?? null,
    heightCm: r[H.heightCm] ?? null,
    heightIn: r[H.heightIn] ?? null,
    weightKg: r[H.weightKg] ?? null,
    weightLb: r[H.weightLb] ?? null,
    trainingAgeYears: r[H.trainingAgeYears] ?? null,
    // Keep tier for grouping
    _tier: r[H.tier]
  });

  const rows = values.slice(1).map(asObj);
  
  // Group by tier and return ALL entries (not limited to 3)
  const group = (tier) => {
    return rows.filter(o => o._tier === tier).map(o => {
      delete o._tier; 
      return o;
    });
  };

  return { 
    top: group('top'), 
    low: group('low'), 
    mid: group('mid') 
  };
}

// UPDATED: For backwards compatibility, keep the old function but make it call the new one
function readCurrentTop10ForEcho_(limitPerTier) {
  const fullData = readCurrentTop10Complete_();
  
  if (typeof limitPerTier === 'number' && limitPerTier > 0) {
    return {
      top: fullData.top.slice(0, limitPerTier),
      mid: fullData.mid.slice(0, limitPerTier),
      low: fullData.low.slice(0, limitPerTier)
    };
  }
  
  return fullData; // Return all data if no limit specified
}

/* ---------- Web App endpoint (force update → JSON) ---------- */
// GET params:
//   secret: required if SHARED_SECRET is non-empty
//   echo: '1' to include complete tier data in the response
//   limit: number to limit entries per tier (optional, defaults to all)
function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  if (SHARED_SECRET) {
    const token = String(p.secret || '');
    if (token !== SHARED_SECRET) {
      const err = { error: 'FORCE_NOT_AUTHORIZED', message: 'Invalid or missing secret.' };
      return ContentService.createTextOutput(JSON.stringify(err))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  const bundle = computeForCurrentWeek_();
  writeCurrentTop10_(bundle);

  const dlParts = bundle.deadlineKey.replace('DL-','').split('-'); // YYYY-MM-DD
  const dlDate = toCt_(new Date(dlParts[0], Number(dlParts[1])-1, dlParts[2], 19, 0, 0));
  const deadlineDisplay = Utilities.formatDate(dlDate, TZ, "EEE MMM d, yyyy 'at' h:mma 'CT'");

  const body = {
    status: 'Updated (forced)',
    weekKey: bundle.weekKey,
    deadlineKey: bundle.deadlineKey,
    deadlineDisplay,
    counts: { top: bundle.top.length, low: bundle.low.length, mid: bundle.mid.length }
  };

  if (String(p.echo || '0') === '1') {
    // Return complete tier data with all personal fields
    const limitPerTier = parseInt(p.limit) || null; // Optional limit parameter
    
    if (limitPerTier) {
      // If limit specified, use it
      body.tiers = readCurrentTop10ForEcho_(limitPerTier);
      body.top3 = readCurrentTop10ForEcho_(3); // Keep top3 for backwards compatibility
    } else {
      // Return ALL tier data
      body.tiers = readCurrentTop10Complete_();
      body.top3 = readCurrentTop10ForEcho_(3); // Keep top3 for backwards compatibility
    }
  }

  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}