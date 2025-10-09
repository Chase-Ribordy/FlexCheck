/**
 * ================================
 * FlexCheck Hall of Fame - OPTIMIZED & SCALABLE
 * Only fetches competitors actually in the Hall of Fame
 * Handles thousands of rows efficiently
 * ================================
 */

const SPREADSHEET_ID = '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0';
const HALL_OF_FAME_SHEET = 'HallOfFame';
const PROCESSED_SHEET = 'Processed';

function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type')
    .setHeader('Access-Control-Max-Age', '86400');
}


/**
 * Handle GET requests - return JSON with CORS headers
 */
function doGet(e) {
  try {
    const data = getHallOfFameData();
    
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    Logger.log('Error in doGet: ' + error.toString());
    Logger.log('Stack: ' + error.stack);
    
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.toString(),
        message: 'Failed to fetch Hall of Fame data',
        stack: error.stack
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * MAIN FUNCTION: Get Hall of Fame data with competitor details
 * Only fetches competitors that are in the Hall of Fame (scalable)
 */
function getHallOfFameData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // STEP 1: Read Hall of Fame structure from HallOfFame sheet
  const hofSheet = ss.getSheetByName(HALL_OF_FAME_SHEET);
  if (!hofSheet) {
    throw new Error('HallOfFame sheet not found');
  }
  
  const lastRow = hofSheet.getLastRow();
  const lastCol = hofSheet.getLastColumn();
  
  if (lastRow < 1) {
    throw new Error('HallOfFame sheet is empty');
  }
  
  // Get headers (row 1) - should be: TOP, MID, BOT, ChallengeMaster, etc.
  const headers = hofSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  
  // STEP 2: Parse Hall of Fame entries and extract unique Entry IDs
  const hallOfFame = {};
  const allEntryIds = new Set();
  
  headers.forEach((header, colIndex) => {
    if (!header) return;
    
    const columnEntries = [];
    
    // Read all entries in this column (starting from row 2)
    if (lastRow > 1) {
      const values = hofSheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
      
      values.forEach(row => {
        const entryId = cleanEntryId_(row[0]);
        if (entryId) {
          columnEntries.push(entryId);
          allEntryIds.add(entryId);
        }
      });
    }
    
    hallOfFame[header] = columnEntries;
  });
  
  Logger.log(`Found ${allEntryIds.size} unique Entry IDs across all categories`);
  Logger.log(`Entry IDs: ${Array.from(allEntryIds).join(', ')}`);
  
  // STEP 3: Fetch ONLY the competitors in the Hall of Fame
  const competitors = fetchCompetitorsByIds_(ss, allEntryIds);
  
  Logger.log(`Successfully fetched ${Object.keys(competitors).length} competitor records`);
  
  return {
    success: true,
    timestamp: new Date().toISOString(),
    entryCount: allEntryIds.size,
    competitorCount: Object.keys(competitors).length,
    hallOfFame: hallOfFame,
    competitors: competitors
  };
}

/**
 * Clean and normalize Entry ID - return null for empty or invalid
 */
function cleanEntryId_(value) {
  if (!value || value === '') {
    return null;
  }
  
  const strValue = String(value).trim();
  
  // Skip placeholder values like "x", "X", "TBD", etc.
  if (strValue.toLowerCase() === 'x' || 
      strValue.toLowerCase() === 'tbd' || 
      strValue.toLowerCase() === 'pending') {
    return null;
  }
  
  return strValue;
}

/**
 * OPTIMIZED: Only fetch competitors that are in the Hall of Fame
 * TYPE-SAFE: Normalizes Entry IDs to strings for matching
 */
function fetchCompetitorsByIds_(ss, entryIds) {
  const processedSheet = ss.getSheetByName(PROCESSED_SHEET);
  if (!processedSheet) {
    throw new Error('Processed sheet not found');
  }
  
  const data = processedSheet.getDataRange().getValues();
  const headers = data[0];
  
  const entryIdIndex = headers.indexOf('entryId');
  if (entryIdIndex === -1) {
    throw new Error('entryId column not found in Processed sheet');
  }
  
  const competitors = {};
  let matchCount = 0;
  
  // Only process rows where entryId is in our Hall of Fame
  for (let i = 1; i < data.length; i++) {
    const rawEntryId = data[i][entryIdIndex];
    
    // Skip empty rows
    if (!rawEntryId) continue;
    
    // NORMALIZE: Convert to string and trim for comparison
    const entryIdStr = String(rawEntryId).trim();
    
    // Check if this Entry ID is in the Hall of Fame
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
 * Build a single competitor object from a Processed sheet row
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
    entryId: normalizedEntryId,
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
 * Test function - run this to verify the data structure
 */
function testGetHallOfFameData() {
  const data = getHallOfFameData();
  
  Logger.log('===== HALL OF FAME TEST RESULTS =====');
  Logger.log(`Success: ${data.success}`);
  Logger.log(`Timestamp: ${data.timestamp}`);
  Logger.log(`Total unique Entry IDs: ${data.entryCount}`);
  Logger.log(`Competitor records fetched: ${data.competitorCount}`);
  Logger.log('');
  
  Logger.log('Hall of Fame Structure:');
  Object.keys(data.hallOfFame).forEach(category => {
    const entries = data.hallOfFame[category];
    Logger.log(`  ${category}: ${entries.length} entries - [${entries.join(', ')}]`);
  });
  Logger.log('');
  
  Logger.log('Sample Competitor Data:');
  const sampleId = Object.keys(data.competitors)[0];
  if (sampleId) {
    Logger.log(JSON.stringify(data.competitors[sampleId], null, 2));
  }
  
  // Check for Entry IDs without competitor data
  const missingData = [];
  Object.keys(data.hallOfFame).forEach(category => {
    data.hallOfFame[category].forEach(entryId => {
      if (!data.competitors[entryId]) {
        missingData.push(`${category}: ${entryId}`);
      }
    });
  });
  
  if (missingData.length > 0) {
    Logger.log('');
    Logger.log('WARNING: Entry IDs in Hall of Fame but not found in Processed sheet:');
    missingData.forEach(msg => Logger.log(`  - ${msg}`));
  }
  
  return data;
}

/**
 * Manual function to add Entry IDs to Hall of Fame
 * Useful for testing or manual additions
 */
function addToHallOfFame(category, entryId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hofSheet = ss.getSheetByName(HALL_OF_FAME_SHEET);
  
  const headers = hofSheet.getRange(1, 1, 1, hofSheet.getLastColumn()).getValues()[0];
  const colIndex = headers.indexOf(category);
  
  if (colIndex === -1) {
    throw new Error(`Category "${category}" not found in headers`);
  }
  
  // Find the next empty row in this column
  const lastRow = hofSheet.getLastRow();
  let nextRow = 2;
  
  for (let i = 2; i <= lastRow; i++) {
    const cellValue = hofSheet.getRange(i, colIndex + 1).getValue();
    if (!cellValue || cellValue === '') {
      nextRow = i;
      break;
    }
    nextRow = i + 1;
  }
  
  hofSheet.getRange(nextRow, colIndex + 1).setValue(entryId);
  Logger.log(`Added Entry ID "${entryId}" to category "${category}" at row ${nextRow}`);
}

/**
 * Get statistics about the Hall of Fame
 */
function getHallOfFameStats() {
  const data = getHallOfFameData();
  
  const stats = {
    totalEntries: data.entryCount,
    totalCompetitors: data.competitorCount,
    categoryCounts: {}
  };
  
  Object.keys(data.hallOfFame).forEach(category => {
    stats.categoryCounts[category] = data.hallOfFame[category].length;
  });
  
  Logger.log(JSON.stringify(stats, null, 2));
  return stats;
}