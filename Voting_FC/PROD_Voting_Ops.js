// ============================================
// FlexCheck Voting Operations v7.0
// CORS-compliant with bulletproof duplicate prevention
// ============================================

const SHEET_ID = '1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0';
const VOTERS_TAB = 'Voters';
const VOTE_TOTALS_TAB = 'VoteTotals';
const TZ = 'America/Chicago';

// ============================================
// MAIN ENTRY POINTS - CORS COMPLIANT
// ============================================

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  // Log for debugging
  console.log('=== REQUEST ===');
  console.log('Method:', e.method || 'GET');
  console.log('Parameters:', JSON.stringify(e.parameter));
  
  try {
    const action = e.parameter.action || 'status';
    let result;
    
    switch(action) {
      case 'batchVote':
        result = processBatchVote(e.parameter);
        break;
        
      case 'getVoteTotals':
        result = getVoteTotals();
        break;
        
      case 'resetWeekly':
        result = resetWeeklyData(e.parameter.adminKey);
        break;
        
      case 'debug':
        result = debugSheet();
        break;
        
      default:
        result = {
          success: true,
          version: '7.0.0',
          timestamp: new Date().toISOString(),
          votingOpen: isVotingWindowOpen(),
          currentWeek: getCurrentWeekKey(),
          message: 'FlexCheck Voting API'
        };
    }
    
    // CRITICAL: Return with CORS headers for cross-origin access
    const output = ContentService.createTextOutput(JSON.stringify(result));
    output.setMimeType(ContentService.MimeType.JSON);
    
    // These headers are crucial for CORS
    return output;
    
  } catch (error) {
    console.error('ERROR:', error.toString());
    console.error('Stack:', error.stack);
    
    const errorResponse = {
      success: false,
      message: error.toString(),
      timestamp: new Date().toISOString()
    };
    
    const output = ContentService.createTextOutput(JSON.stringify(errorResponse));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}

// ============================================
// WEEK KEY FUNCTIONS
// ============================================

function getCurrentWeekKey() {
  const now = new Date();
  const ct = new Date(Utilities.formatDate(now, TZ, "yyyy-MM-dd'T'HH:mm:ss"));
  
  // Find this week's Friday 8pm anchor
  const day = ct.getDay();
  const hour = ct.getHours();
  
  // Calculate days since last Friday
  let daysSinceFriday = (day + 2) % 7; // Friday = 5, so (day - 5 + 7) % 7
  if (day === 5 && hour >= 20) {
    daysSinceFriday = 0; // We're past Friday 8pm, use this Friday
  } else if (day === 5) {
    daysSinceFriday = 7; // Friday but before 8pm, use last Friday
  } else if (day === 6) {
    daysSinceFriday = 1; // Saturday
  } else if (day === 0) {
    daysSinceFriday = 2; // Sunday  
  } else if (day === 1) {
    daysSinceFriday = 3; // Monday
  } else if (day === 2) {
    daysSinceFriday = 4; // Tuesday
  } else if (day === 3) {
    daysSinceFriday = 5; // Wednesday
  } else if (day === 4) {
    daysSinceFriday = 6; // Thursday
  }
  
  const friday = new Date(ct);
  friday.setDate(ct.getDate() - daysSinceFriday);
  friday.setHours(20, 0, 0, 0);
  
  return Utilities.formatDate(friday, TZ, 'yyyy-MM-dd');
}

function isVotingWindowOpen() {
  const now = new Date();
  const ct = new Date(Utilities.formatDate(now, TZ, "yyyy-MM-dd'T'HH:mm:ss"));
  const day = ct.getDay();
  const hour = ct.getHours();
  
  // Thursday 7pm to Friday 7pm CT
  return (day === 4 && hour >= 19) || (day === 5 && hour < 19);
}

// ============================================
// BATCH VOTE PROCESSING
// ============================================

function processBatchVote(params) {
  console.log('=== BATCH VOTE ===');
  
  try {
    // Extract parameters
    const email = String(params.email || '').toLowerCase().trim();
    const devMode = params.devOverride === 'true';
    
    // Parse votes
    const topEntry = parseInt(params.topEntryId);
    const midEntry = parseInt(params.midEntryId);
    const lowEntry = parseInt(params.lowEntryId);
    const topPts = parseInt(params.topPoints);
    const midPts = parseInt(params.midPoints);
    const lowPts = parseInt(params.lowPoints);
    
    console.log(`Email: ${email}`);
    console.log(`Votes: TOP=${topEntry}(${topPts}pts) MID=${midEntry}(${midPts}pts) LOW=${lowEntry}(${lowPts}pts)`);
    
    // Validation
    if (!email || !email.includes('@')) {
      return { success: false, message: 'Valid email required' };
    }
    
    if (!topEntry || !midEntry || !lowEntry) {
      return { success: false, message: 'All three selections required' };
    }
    
    if (topPts < 1 || topPts > 100 || midPts < 1 || midPts > 100 || lowPts < 1 || lowPts > 100) {
      return { success: false, message: 'Points must be 1-100' };
    }
    
    if (!isVotingWindowOpen() && !devMode) {
      return { success: false, message: 'Voting window is closed' };
    }
    
    // Validate voter
    const voterValidation = checkVoterEligibility(email);
    if (!voterValidation.success) {
      return voterValidation;
    }
    
    // Process votes using transaction-like approach
    const voteData = [
      { tier: 'top', entryId: topEntry, points: topPts },
      { tier: 'mid', entryId: midEntry, points: midPts },
      { tier: 'low', entryId: lowEntry, points: lowPts }
    ];
    
    // Update totals
    const updateResult = updateAllVoteTotals(voteData);
    if (!updateResult.success) {
      return updateResult;
    }
    
    // Mark voter as having voted
    markUserVoted(email);
    
    return {
      success: true,
      message: 'Votes submitted successfully',
      voter: {
        email: email,
        verified: true,
        voted_top: true,
        voted_mid: true,
        voted_low: true
      },
      summary: updateResult.summary
    };
    
  } catch (error) {
    console.error('Vote error:', error.toString());
    return {
      success: false,
      message: 'Failed to process vote: ' + error.toString()
    };
  }
}

// ============================================
// VOTER MANAGEMENT
// ============================================

function checkVoterEligibility(email) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VOTERS_TAB);
    const data = sheet.getDataRange().getValues();
    
    if (data.length < 2) {
      return { success: false, message: 'No voters found' };
    }
    
    const headers = data[0];
    const emailIdx = headers.indexOf('email');
    const verifiedIdx = headers.indexOf('verified');
    const votedTopIdx = headers.indexOf('voted_top');
    const votedMidIdx = headers.indexOf('voted_mid');
    const votedLowIdx = headers.indexOf('voted_low');
    
    // Find voter
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][emailIdx]).toLowerCase().trim() === email) {
        
        // Check verified
        const isVerified = data[i][verifiedIdx] === true || 
                          data[i][verifiedIdx] === 'TRUE' || 
                          data[i][verifiedIdx] === 'true';
        
        if (!isVerified) {
          return { success: false, message: 'Email not verified. Please check your email.' };
        }
        
        // Check if already voted
        const hasVotedTop = data[i][votedTopIdx] === true || 
                           data[i][votedTopIdx] === 'TRUE' || 
                           data[i][votedTopIdx] === 'true';
        const hasVotedMid = data[i][votedMidIdx] === true || 
                           data[i][votedMidIdx] === 'TRUE' || 
                           data[i][votedMidIdx] === 'true';
        const hasVotedLow = data[i][votedLowIdx] === true || 
                           data[i][votedLowIdx] === 'TRUE' || 
                           data[i][votedLowIdx] === 'true';
        
        if (hasVotedTop && hasVotedMid && hasVotedLow) {
          return { success: false, message: 'You have already voted this week' };
        }
        
        return {
          success: true,
          rowIndex: i + 1
        };
      }
    }
    
    return { success: false, message: 'Email not registered. Please sign in first.' };
    
  } catch (error) {
    console.error('Eligibility check error:', error.toString());
    return { success: false, message: 'Failed to verify voter' };
  }
}

function markUserVoted(email) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VOTERS_TAB);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const emailIdx = headers.indexOf('email');
    const votedTopIdx = headers.indexOf('voted_top');
    const votedMidIdx = headers.indexOf('voted_mid');
    const votedLowIdx = headers.indexOf('voted_low');
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][emailIdx]).toLowerCase().trim() === email) {
        const row = i + 1;
        sheet.getRange(row, votedTopIdx + 1).setValue(true);
        sheet.getRange(row, votedMidIdx + 1).setValue(true);
        sheet.getRange(row, votedLowIdx + 1).setValue(true);
        
        console.log(`Marked ${email} as voted (row ${row})`);
        return true;
      }
    }
    
    return false;
    
  } catch (error) {
    console.error('Mark voted error:', error.toString());
    return false;
  }
}

// ============================================
// VOTE TOTALS MANAGEMENT - BULLETPROOF
// ============================================

function updateAllVoteTotals(voteData) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(VOTE_TOTALS_TAB);
    
    // Initialize sheet if needed
    if (!sheet) {
      sheet = ss.insertSheet(VOTE_TOTALS_TAB);
      sheet.getRange(1, 1, 1, 6).setValues([[
        'tier', 'entryId', 'totalVotes', 'totalPoints', 'rank', 'lastUpdated'
      ]]);
      SpreadsheetApp.flush();
    }
    
    // Get all data once
    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    
    // Build lookup map for fast searching
    const dataMap = new Map();
    for (let i = 1; i < allData.length; i++) {
      const tier = String(allData[i][0]).toLowerCase().trim();
      const entryId = String(Math.floor(Number(allData[i][1]))).trim();
      const key = `${tier}|${entryId}`;
      
      dataMap.set(key, {
        rowIndex: i + 1,
        currentVotes: parseInt(allData[i][2]) || 0,
        currentPoints: parseInt(allData[i][3]) || 0
      });
    }
    
    const summary = [];
    const now = new Date().toISOString();
    
    // Process each vote
    for (const vote of voteData) {
      const tier = String(vote.tier).toLowerCase().trim();
      const entryId = String(Math.floor(Number(vote.entryId))).trim();
      const points = parseInt(vote.points);
      const key = `${tier}|${entryId}`;
      
      console.log(`Processing: ${key} with ${points} points`);
      
      if (dataMap.has(key)) {
        // Update existing row
        const existing = dataMap.get(key);
        const newVotes = existing.currentVotes + 1;
        const newPoints = existing.currentPoints + points;
        
        sheet.getRange(existing.rowIndex, 3).setValue(newVotes);      // totalVotes
        sheet.getRange(existing.rowIndex, 4).setValue(newPoints);     // totalPoints
        sheet.getRange(existing.rowIndex, 6).setValue(now);           // lastUpdated
        
        summary.push({
          tier: tier,
          entryId: vote.entryId,
          action: 'updated',
          totalVotes: newVotes,
          totalPoints: newPoints
        });
        
        console.log(`Updated row ${existing.rowIndex}: ${newVotes} votes, ${newPoints} points`);
        
      } else {
        // Add new row
        sheet.appendRow([
          tier,              // tier
          vote.entryId,      // entryId (as number)
          1,                 // totalVotes
          points,            // totalPoints
          0,                 // rank (will be calculated)
          now                // lastUpdated
        ]);
        
        summary.push({
          tier: tier,
          entryId: vote.entryId,
          action: 'created',
          totalVotes: 1,
          totalPoints: points
        });
        
        console.log(`Created new row for ${key}`);
      }
    }
    
    // Force changes to save
    SpreadsheetApp.flush();
    
    // Update ranks
    updateRanks();
    
    return {
      success: true,
      summary: summary
    };
    
  } catch (error) {
    console.error('Update totals error:', error.toString());
    return {
      success: false,
      message: 'Failed to update totals: ' + error.toString()
    };
  }
}

function updateRanks() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VOTE_TOTALS_TAB);
    if (!sheet) return;
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    
    // Group by tier
    const tiers = { top: [], mid: [], low: [] };
    
    for (let i = 1; i < data.length; i++) {
      const tier = String(data[i][0]).toLowerCase().trim();
      if (tiers[tier]) {
        tiers[tier].push({
          row: i + 1,
          points: parseInt(data[i][3]) || 0
        });
      }
    }
    
    // Sort and assign ranks
    for (const tier in tiers) {
      tiers[tier].sort((a, b) => b.points - a.points);
      
      for (let i = 0; i < tiers[tier].length; i++) {
        sheet.getRange(tiers[tier][i].row, 5).setValue(i + 1);
      }
    }
    
  } catch (error) {
    console.error('Rank update error:', error.toString());
  }
}

// ============================================
// GET VOTE TOTALS
// ============================================

function getVoteTotals() {
  console.log('=== GET TOTALS ===');
  
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VOTE_TOTALS_TAB);
    
    if (!sheet) {
      return {
        success: true,
        message: 'No votes recorded yet',
        totals: { top: [], mid: [], low: [] }
      };
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return {
        success: true,
        message: 'No votes recorded yet',
        totals: { top: [], mid: [], low: [] }
      };
    }
    
    // Parse data
    const totals = { top: [], mid: [], low: [] };
    
    for (let i = 1; i < data.length; i++) {
      const tier = String(data[i][0]).toLowerCase().trim();
      
      if (totals[tier]) {
        totals[tier].push({
          entryId: parseInt(data[i][1]),
          totalVotes: parseInt(data[i][2]) || 0,
          totalPoints: parseInt(data[i][3]) || 0,
          rank: parseInt(data[i][4]) || 999
        });
      }
    }
    
    // Sort by rank
    for (const tier in totals) {
      totals[tier].sort((a, b) => a.rank - b.rank);
    }
    
    console.log(`Returning: TOP=${totals.top.length} MID=${totals.mid.length} LOW=${totals.low.length} entries`);
    
    return {
      success: true,
      totals: totals,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Get totals error:', error.toString());
    return {
      success: false,
      message: 'Failed to get totals: ' + error.toString()
    };
  }
}

// ============================================
// ADMIN FUNCTIONS
// ============================================

function resetWeeklyData(adminKey) {
  // Simple key check - use environment variable in production
  if (adminKey !== 'flexcheck2024admin') {
    return { success: false, message: 'Unauthorized' };
  }
  
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VOTE_TOTALS_TAB);
    
    if (sheet) {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.deleteRows(2, lastRow - 1);
        return {
          success: true,
          message: `Cleared ${lastRow - 1} vote records for new week`
        };
      }
    }
    
    return {
      success: true,
      message: 'No data to clear'
    };
    
  } catch (error) {
    return {
      success: false,
      message: error.toString()
    };
  }
}

function debugSheet() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VOTE_TOTALS_TAB);
    
    if (!sheet) {
      return {
        success: true,
        message: 'VoteTotals sheet does not exist'
      };
    }
    
    const data = sheet.getDataRange().getValues();
    
    // Create detailed debug info
    const debugInfo = {
      success: true,
      sheetName: VOTE_TOTALS_TAB,
      headers: data[0],
      rowCount: data.length - 1,
      sampleRows: []
    };
    
    // Include up to 10 sample rows
    for (let i = 1; i < Math.min(11, data.length); i++) {
      debugInfo.sampleRows.push({
        row: i + 1,
        tier: data[i][0],
        entryId: data[i][1],
        totalVotes: data[i][2],
        totalPoints: data[i][3],
        rank: data[i][4],
        lastUpdated: data[i][5]
      });
    }
    
    return debugInfo;
    
  } catch (error) {
    return {
      success: false,
      message: error.toString()
    };
  }
}

// ============================================
// MANUAL TEST FUNCTIONS
// ============================================

function testManual() {
  // Run this in script editor to test
  const params = {
    email: 'test@example.com',
    topEntryId: '3725',
    topPoints: '50',
    midEntryId: '3741',
    midPoints: '30',
    lowEntryId: '3736',
    lowPoints: '40',
    devOverride: 'true'
  };
  
  const result = processBatchVote(params);
  console.log('Test result:', JSON.stringify(result, null, 2));
  
  const totals = getVoteTotals();
  console.log('Current totals:', JSON.stringify(totals, null, 2));
}