/** ================================
 *  FlexCheck Tournament Bracket - OPTIMIZED & FIXED
 *  Only fetches competitors actually in the bracket
 *  Scalable to thousands of rows
 *  Type-safe Entry ID matching
 *  ================================ */

const SPREADSHEET_ID = '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0';
const TOURNAMENT_SHEET = 'ManualTournament';
const PROCESSED_SHEET = 'Processed';

/**
 * Handle GET requests - return JSON with CORS headers
 */
function doGet(e) {
  try {
    const data = getTournamentData();
    
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.toString(),
        message: 'Failed to fetch tournament data',
        stack: error.stack
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * OPTIMIZED: Only fetch data for competitors in the bracket
 */
function getTournamentData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // STEP 1: Read bracket structure from ManualTournament (A4:G10)
  const tournamentSheet = ss.getSheetByName(TOURNAMENT_SHEET);
  const bracketData = tournamentSheet.getRange('A4:G10').getValues();
  
  // STEP 2: Parse brackets and extract Entry IDs (normalized to strings)
  const brackets = parseBrackets_(bracketData);
  
  // STEP 3: Get unique Entry IDs from brackets (only fetch these!)
  const entryIds = extractEntryIds_(brackets);
  
  Logger.log(`Found ${entryIds.size} unique Entry IDs in tournament: ${Array.from(entryIds).join(', ')}`);
  
  // STEP 4: Fetch ONLY the competitors we need
  const competitors = fetchCompetitorsByIds_(ss, entryIds);
  
  Logger.log(`Successfully fetched ${Object.keys(competitors).length} competitors`);
  
  return {
    success: true,
    timestamp: new Date().toISOString(),
    competitorCount: Object.keys(competitors).length,
    brackets: brackets,
    competitors: competitors
  };
}

/**
 * Extract all unique Entry IDs from brackets - NORMALIZE TO STRINGS
 */
function extractEntryIds_(brackets) {
  const ids = new Set();
  
  brackets.forEach(bracket => {
    // Convert all to strings and trim for consistent comparison
    if (bracket.wk1) ids.add(String(bracket.wk1).trim());
    if (bracket.wk2) ids.add(String(bracket.wk2).trim());
    if (bracket.semifinal1) ids.add(String(bracket.semifinal1).trim());
    if (bracket.wk3) ids.add(String(bracket.wk3).trim());
    if (bracket.wk4) ids.add(String(bracket.wk4).trim());
    if (bracket.semifinal2) ids.add(String(bracket.semifinal2).trim());
    if (bracket.champion) ids.add(String(bracket.champion).trim());
  });
  
  return ids;
}

/**
 * OPTIMIZED: Only fetch competitors that are in the tournament
 * TYPE-SAFE: Normalizes Entry IDs to strings for matching
 */
function fetchCompetitorsByIds_(ss, entryIds) {
  const processedSheet = ss.getSheetByName(PROCESSED_SHEET);
  const data = processedSheet.getDataRange().getValues();
  const headers = data[0];
  
  const entryIdIndex = headers.indexOf('entryId');
  if (entryIdIndex === -1) {
    throw new Error('entryId column not found in Processed sheet');
  }
  
  const competitors = {};
  let matchCount = 0;
  
  // Only process rows where entryId is in our tournament
  for (let i = 1; i < data.length; i++) {
    const rawEntryId = data[i][entryIdIndex];
    
    // Skip empty rows
    if (!rawEntryId) continue;
    
    // NORMALIZE: Convert to string and trim for comparison
    const entryIdStr = String(rawEntryId).trim();
    
    // Check if this Entry ID is in the tournament
    if (entryIds.has(entryIdStr)) {
      matchCount++;
      Logger.log(`Match found: ${entryIdStr}`);
      
      // Build competitor object using normalized string ID as key
      competitors[entryIdStr] = buildCompetitorObject_(data[i], headers, entryIdStr);
    }
  }
  
  Logger.log(`Matched ${matchCount} competitors out of ${entryIds.size} requested`);
  
  // Debug: Log any Entry IDs that weren't found
  const foundIds = new Set(Object.keys(competitors));
  entryIds.forEach(id => {
    if (!foundIds.has(id)) {
      Logger.log(`WARNING: Entry ID "${id}" not found in Processed sheet`);
    }
  });
  
  return competitors;
}

/**
 * Build a single competitor object from a row
 */
function buildCompetitorObject_(row, headers, normalizedEntryId) {
  const idx = (name) => {
    const index = headers.indexOf(name);
    return index >= 0 ? index : -1;
  };
  
  const toNum = (v) => {
    if (v === '' || v == null) return null;
    const n = (typeof v === 'number') ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  
  const getVal = (name, defaultVal = '') => {
    const i = idx(name);
    return i >= 0 ? (row[i] || defaultVal) : defaultVal;
  };
  
  return {
    entryId: normalizedEntryId, // Use the normalized string version
    ticket: getVal('ticket'),
    email: getVal('email'),
    isPaid: getVal('isPaid', false),
    createdAtISO: getVal('createdAtISO'),
    cachedAt: getVal('cachedAt'),
    weekKey: getVal('weekKey'),
    score: toNum(getVal('score')),
    summary: getVal('summary'),
    divisionFit: getVal('divisionFit'),
    muscleRatings: getVal('muscleRatings'),
    age: toNum(getVal('age')),
    heightCm: toNum(getVal('heightCm')),
    heightIn: getVal('heightIn'),
    weightKg: toNum(getVal('weightKg')),
    weightLb: toNum(getVal('weightLb')),
    trainingAgeYears: toNum(getVal('trainingAgeYears')),
    socialHandle: getVal('socialHandle'),
    photos: getVal('photos', '[]'),
    bestExercises: getVal('bestExercises'),
    biomechanics: getVal('biomechanics')
  };
}

/**
 * Parse bracket structure from ManualTournament tab
 * NORMALIZES all Entry IDs to strings
 */
function parseBrackets_(data) {
  const tiers = ['TOP', 'MID', 'BOT'];
  const dataRows = [2, 4, 6]; // Data rows for each tier
  
  return tiers.map((tier, index) => {
    const rowData = data[dataRows[index]];
    
    return {
      tier: tier,
      wk1: cleanValue_(rowData[0]),
      wk2: cleanValue_(rowData[1]),
      semifinal1: cleanValue_(rowData[2]),
      wk3: cleanValue_(rowData[3]),
      wk4: cleanValue_(rowData[4]),
      semifinal2: cleanValue_(rowData[5]),
      champion: cleanValue_(rowData[6])
    };
  });
}

/**
 * Clean cell values - return null for empty, "x", or whitespace
 * RETURNS STRING or null (never returns numbers)
 */
function cleanValue_(value) {
  if (!value || value === '') {
    return null;
  }
  
  const strValue = String(value).trim();
  
  // Check for "x" placeholder
  if (strValue.toLowerCase() === 'x') {
    return null;
  }
  
  return strValue;
}

/**
 * Test function - run this to verify the data structure
 */
function testGetTournamentData() {
  const data = getTournamentData();
  Logger.log(`Returned ${data.competitorCount} competitors`);
  Logger.log(JSON.stringify(data, null, 2));
  
  // Check if we have any Entry IDs but no competitors (indicates matching issue)
  const hasEntryIds = data.brackets.some(b => 
    b.wk1 || b.wk2 || b.semifinal1 || b.wk3 || b.wk4 || b.semifinal2 || b.champion
  );
  
  if (hasEntryIds && data.competitorCount === 0) {
    Logger.log('WARNING: Bracket has Entry IDs but no competitors were found!');
    Logger.log('This indicates a type mismatch between bracket IDs and Processed sheet IDs');
  }
}