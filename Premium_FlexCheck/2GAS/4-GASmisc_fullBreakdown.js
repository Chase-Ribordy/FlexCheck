/** CONFIG **/
const SPREADSHEET_ID = '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0';
const SHEET_NAME = 'Processed';

/** HTTP entrypoint **/
function doGet(e) {
  try {
    const entryId = getParamInsensitive_(e, 'entryId');
    const debug   = getParamInsensitive_(e, 'debug') === '1';
    if (!entryId) return json_({ error: 'Missing entryId' });

    const { row, headerMap, headerRow } = findRowByEntryIdFlexible_(entryId);
    if (!row) return json_(debug ? { pending: true, debug: { entryId, foundRow:false, headerRow } } : { pending: true });

    const obj = rowToObjectFlexible_(row, headerMap);          // coerce + parse
    const payload = normalizeForFrontend_(obj);                // final shape

    if (debug) {
      payload.debug = {
        entryId,
        foundRow: true,
        headerRow,
        keys: Object.keys(row)
      };
    }
    return json_(payload);
  } catch (err) {
    console.error(err);
    return json_({ error: String(err) });
  }
}

/** ---------- helpers ---------- **/
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}
function getParamInsensitive_(e, key) {
  if (!e || !e.parameter) return '';
  if (e.parameter[key] != null) return String(e.parameter[key]);
  for (var k in e.parameter) {
    if (String(k).toLowerCase() === String(key).toLowerCase()) return String(e.parameter[k]);
  }
  return '';
}
function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Sheet not found: ' + SHEET_NAME);
  return sh;
}

/** Case/space-insensitive header mapping + flexible id matching */
function findRowByEntryIdFlexible_(entryId) {
  const sh = getSheet_();
  const rng = sh.getDataRange();
  const values = rng.getValues();
  if (!values.length) return { row:null, headerMap:{}, headerRow:[] };

  const headerRaw = values[0].map(String);
  const headerNorm = headerRaw.map(h => h.trim());
  const headerMap = {}; // lower -> actual
  headerNorm.forEach((h, i) => headerMap[h.toLowerCase()] = headerRaw[i]);

  const entryKey = headerMap['entryid'] || headerMap['entry_id'] || headerMap['id'];
  if (!entryKey) throw new Error('No "entryId" column (case-insensitive) found in header row.');

  const idxEntry = headerRaw.indexOf(entryKey);
  const targetStr = String(entryId).trim();
  const targetNum = Number(targetStr);

  for (let r = 1; r < values.length; r++) {
    const cell = values[r][idxEntry];
    const cellStr = String(cell || '').trim();
    const cellNum = Number(cell);

    const match =
      (cellStr && cellStr === targetStr) ||
      (Number.isFinite(cellNum) && Number.isFinite(targetNum) && cellNum === targetNum);

    if (match) {
      const obj = {};
      for (let c = 0; c < headerRaw.length; c++) {
        obj[headerRaw[c]] = values[r][c];
      }
      return { row: obj, headerMap, headerRow: headerRaw };
    }
  }
  return { row:null, headerMap, headerRow: headerRaw };
}

/** Loose parsers for “JSON-ish” and CSV/semicolon fallbacks */
function parseJSONLoose_(val) {
  if (val == null || val === '') return null;
  if (typeof val !== 'string') return val;

  // Try valid JSON first
  try { return JSON.parse(val); } catch(_) {}

  // Single quotes → double
  let s = val.replace(/'/g, '"');

  // Quote unquoted object keys: {Chest:75} -> {"Chest":75}
  s = s.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');

  try { return JSON.parse(s); } catch(_) { return null; }
}
function parseList_(val) {
  if (val == null || val === '') return [];
  if (Array.isArray(val)) return val;
  if (typeof val !== 'string') return [];
  const j = parseJSONLoose_(val);
  if (Array.isArray(j)) return j;
  // CSV/semicolon fallback
  return val.split(/[;,]/).map(s => s.trim()).filter(Boolean);
}
function parsePhotos_(val) {
  const arr = parseList_(val);
  return arr.filter(Boolean);
}
function parseExercises_(val) {
  if (val == null || val === '') return [];
  if (Array.isArray(val)) return val;
  if (typeof val !== 'string') return [];
  const j = parseJSONLoose_(val);
  if (Array.isArray(j)) return j;
  return val.split(/[;,]/).map(s => s.trim()).filter(Boolean).map(name => ({ name }));
}
function toNum_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toBool_(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

/** Row coercion using header map (case-insensitive) */
function rowToObjectFlexible_(row, headerMap) {
  const get = k => row[ headerMap[k.toLowerCase()] || k ];

  return {
    entryId: String(get('entryId') || '').trim(),
    email: String(get('email') || '').trim(),
    isPaid: toBool_(get('isPaid')),
    createdAtISO: String(get('createdAtISO') || '').trim(),
    cachedAt: String(get('cachedAt') || '').trim(),
    weekKey: String(get('weekKey') || '').trim(),
    score: toNum_(get('score')),
    summary: String(get('summary') || '').trim(),

    divisionFit: parseJSONLoose_(get('divisionFit')) || {},
    muscleRatings: parseJSONLoose_(get('muscleRatings')) || {},

    age: toNum_(get('age')),
    heightCm: toNum_(get('heightCm')),
    heightIn: toNum_(get('heightIn')),
    weightKg: toNum_(get('weightKg')),
    weightLb: toNum_(get('weightLb')),
    trainingAgeYears: toNum_(get('trainingAgeYears')),

    socialHandle: String(get('socialHandle') || '').trim(),
    photos: parsePhotos_(get('photos')),
    bestExercises: parseExercises_(get('bestExercises')),
    biomechanics: parseList_(get('biomechanics'))
  };
}

/** Final shape expected by the frontend */
function normalizeForFrontend_(o) {
  return {
    pending: false,
    isPaid: o.isPaid === true,
    score: o.score || 0,
    photos: o.photos || [],
    socialHandle: o.socialHandle || '',
    age: o.age ?? null,
    heightCm: o.heightCm ?? null,
    heightIn: o.heightIn ?? null,
    weightKg: o.weightKg ?? null,
    weightLb: o.weightLb ?? null,
    trainingAgeYears: o.trainingAgeYears ?? null,

    muscleRatings: o.muscleRatings || null,
    divisionFit: o.divisionFit || null,

    summary: o.summary || '',
    biomechanics: Array.isArray(o.biomechanics) ? o.biomechanics : [],
    bestExercises: Array.isArray(o.bestExercises) ? o.bestExercises : []
  };
}
