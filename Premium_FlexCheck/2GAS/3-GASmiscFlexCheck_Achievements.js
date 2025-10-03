/*****************  CONFIG  *****************/
const CFG = {
  SPREADSHEET_ID: '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0', // <- your sheet
  PROCESSED_TAB : 'Processed',
  ACHIEVE_TAB   : 'Achievements',
  TZ            : 'America/Chicago',
  TTL_MS        : 12 * 60 * 60 * 1000 // recompute threshold if you later store lastComputedISO
};

/***************  WEB ENDPOINTS  ***************/
function doGet(e){
  const fn = String(e.parameter.fn||'').toLowerCase();
  if (fn === 'achievements'){
    const email = normEmail(e.parameter.email);
    if (!email) return json({ok:false, error:'missing email'});
    const data = recomputeAndUpsertForEmail(email); // compute on-demand for simplicity
    return json({ok:true, data});
  }
  if (fn === 'rebuildall'){
    const n = rebuildAllAchievements();
    return json({ok:true, rebuilt:n});
  }
  return json({ok:false, error:'unknown fn'});
}

/***************  CORE AGGREGATION  ***************/
function recomputeAndUpsertForEmail(email){
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const shP = mustSheet(ss, CFG.PROCESSED_TAB);
  mustSheet(ss, CFG.ACHIEVE_TAB, [
    'email','totalFlexScore','weeksBought',
    'badge_flex_100','badge_flex_500','badge_flex_1000',
    'badge_weeks_2','badge_weeks_6','badge_weeks_12'
  ]);

  const rows = readObjs(shP);
  const totals = aggregateForEmail(rows, email);

  const payload = {
    email,
    totalFlexScore : totals.totalFlexScore,
    weeksBought    : totals.weeksBought,
    badge_flex_100 : totals.totalFlexScore >= 100,
    badge_flex_500 : totals.totalFlexScore >= 500,
    badge_flex_1000: totals.totalFlexScore >= 1000,
    badge_weeks_2  : totals.weeksBought    >= 2,
    badge_weeks_6  : totals.weeksBought    >= 6,
    badge_weeks_12 : totals.weeksBought    >= 12
  };

  upsertByKey(ss, CFG.ACHIEVE_TAB, 'email', payload);
  return payload;
}

function rebuildAllAchievements(){
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const shP = mustSheet(ss, CFG.PROCESSED_TAB);
  const shA = mustSheet(ss, CFG.ACHIEVE_TAB, [
    'email','totalFlexScore','weeksBought',
    'badge_flex_100','badge_flex_500','badge_flex_1000',
    'badge_weeks_2','badge_weeks_6','badge_weeks_12'
  ]);

  const rows = readObjs(shP);

  // 1) Group by email
  const map = new Map(); // email -> { sum, weeks:Set }
  rows.forEach(r => {
    const E = normEmail(r.email);
    if (!E) return;

    // score
    const s = Number(r.score) || 0;

    // weekKey (prefer existing, else derive from createdAtISO)
    let wk = String(r.weekKey||'').trim();
    if (!wk) {
      const d = safeDate(r.createdAtISO);
      if (d) wk = isoWeekKey(d, CFG.TZ);
    }

    if (!map.has(E)) map.set(E, { sum:0, weeks: new Set() });
    const bucket = map.get(E);
    bucket.sum += s;
    if (wk) bucket.weeks.add(wk);
  });

  // 2) Upsert each email
  let n = 0;
  map.forEach((bucket, email) => {
    const totalFlexScore = bucket.sum;
    const weeksBought = bucket.weeks.size;
    const payload = {
      email,
      totalFlexScore,
      weeksBought,
      badge_flex_100 : totalFlexScore >= 100,
      badge_flex_500 : totalFlexScore >= 500,
      badge_flex_1000: totalFlexScore >= 1000,
      badge_weeks_2  : weeksBought    >= 2,
      badge_weeks_6  : weeksBought    >= 6,
      badge_weeks_12 : weeksBought    >= 12
    };
    upsertByKey(ss, CFG.ACHIEVE_TAB, 'email', payload);
    n++;
  });

  return n;
}

/***************  CALC HELPERS  ***************/
function aggregateForEmail(rows, email){
  const E = normEmail(email);
  let sum = 0;
  const weeks = new Set();

  rows.forEach(r => {
    if (normEmail(r.email) !== E) return;

    sum += Number(r.score) || 0;

    let wk = String(r.weekKey||'').trim();
    if (!wk){
      const d = safeDate(r.createdAtISO);
      if (d) wk = isoWeekKey(d, CFG.TZ);
    }
    if (wk) weeks.add(wk);
  });

  return { totalFlexScore: sum, weeksBought: weeks.size };
}

/***************  SHEET/ROW HELPERS  ***************/
function mustSheet(ss, name, headers){
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (headers && sh.getLastRow() === 0){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

function readObjs(sh){
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  const headers = vals[0].map(h => String(h||'').trim());
  return vals.slice(1).map(row => {
    const o = {};
    headers.forEach((h,i)=> o[h] = row[i]);
    return o;
  });
}

function upsertByKey(ss, tab, keyField, obj){
  const sh = mustSheet(ss, tab);
  // Ensure headers include all fields present in obj (auto-expand)
  const existingHeaders = sh.getLastRow() ? sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0] : [];
  const headers = ensureHeaders(sh, existingHeaders, Object.keys(obj));
  const keyIndex = headers.indexOf(keyField);
  if (keyIndex < 0) throw new Error('Key field not found in headers: '+keyField);

  const rng = sh.getDataRange();
  const vals = rng.getValues();
  let targetRow = 0;

  for (let r=1; r<vals.length; r++){
    const cellVal = vals[r][keyIndex];
    if (normEmail(cellVal) === normEmail(obj[keyField])) { targetRow = r+1; break; }
  }

  const rowArr = headers.map(h => (h in obj) ? obj[h] : '');
  if (targetRow){
    sh.getRange(targetRow, 1, 1, headers.length).setValues([rowArr]);
  }else{
    sh.appendRow(rowArr);
  }
}

function ensureHeaders(sh, currentHeaders, neededFields){
  const set = new Set(currentHeaders.map(h => String(h||'')));
  let changed = false;
  neededFields.forEach(f => { if (!set.has(f)){ set.add(f); changed = true; } });
  if (changed){
    const headers = Array.from(set);
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return Array.from(set);
}

/***************  UTIL ***************/
function normEmail(e){ return String(e||'').trim().toLowerCase(); }
function safeDate(x){ const d = new Date(x); return isNaN(d.getTime()) ? null : d; }
function json(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/* ISO week key like 2025-W32, respecting a TZ for date boundaries */
function isoWeekKey(date, tz){
  const local = Utilities.formatDate(date, tz || 'America/Chicago', "yyyy-MM-dd'T'HH:mm:ss");
  const d = new Date(local);
  // ISO week calc
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay()||7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1)/7);
  const yr = tmp.getUTCFullYear();
  return `${yr}-W${String(weekNo).padStart(2,'0')}`;
}
