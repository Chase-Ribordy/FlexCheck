// ========================================
// FLEXCHECK COUNTDOWN TESTING UTILITIES
// Paste this into browser console to test
// ========================================

// Store original function
window.originalNowInCT = window.nowInCT;

// Test function to simulate different times
function testCountdownTime(year, month, day, hour, minute = 0) {
  // Override nowInCT to return our test time
  window.nowInCT = function() {
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  };
  
  // Force update
  updateCountdown();
  
  // Log what we're testing
  const testDate = new Date(year, month - 1, day, hour, minute);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  console.log(`Testing: ${dayNames[testDate.getDay()]}, ${month}/${day}/${year} at ${hour}:${minute < 10 ? '0' + minute : minute}`);
}

// Reset to real time
function resetToRealTime() {
  window.nowInCT = window.originalNowInCT;
  updateCountdown();
  console.log('Reset to real time');
}

// Test scenarios for easy testing
const testScenarios = {
  // NORMAL COUNTDOWN SCENARIOS
  mondayMorning: () => {
    testCountdownTime(2025, 1, 13, 9, 0);
    console.log('✅ Should show: Normal blue countdown to Thursday 7PM');
  },
  
  wednesdayAfternoon: () => {
    testCountdownTime(2025, 1, 15, 14, 30);
    console.log('✅ Should show: Normal blue countdown to Thursday 7PM');
  },
  
  thursdayMorning: () => {
    testCountdownTime(2025, 1, 16, 10, 0);
    console.log('✅ Should show: Normal blue countdown to Thursday 7PM (same day)');
  },
  
  thursdayBefore7PM: () => {
    testCountdownTime(2025, 1, 16, 18, 59);
    console.log('✅ Should show: Normal blue countdown (1 minute left)');
  },
  
  // VOTING OPEN SCENARIOS
  thursdayAt7PM: () => {
    testCountdownTime(2025, 1, 16, 19, 0);
    console.log('✅ Should show: GREEN "VOTING OPEN NOW!" with 24hr countdown');
  },
  
  thursdayNight: () => {
    testCountdownTime(2025, 1, 16, 23, 30);
    console.log('✅ Should show: GREEN voting open, counting to Friday 7PM');
  },
  
  fridayMorning: () => {
    testCountdownTime(2025, 1, 17, 9, 0);
    console.log('✅ Should show: GREEN voting still open');
  },
  
  fridayAfternoon: () => {
    testCountdownTime(2025, 1, 17, 15, 0);
    console.log('✅ Should show: GREEN voting open (4 hours left)');
  },
  
  fridayBefore7PM: () => {
    testCountdownTime(2025, 1, 17, 18, 59);
    console.log('✅ Should show: GREEN voting open (1 minute left)');
  },
  
  // LIVE REVEAL SCENARIOS
  fridayAt7PM: () => {
    testCountdownTime(2025, 1, 17, 19, 0);
    console.log('✅ Should show: RED "LIVE NOW!" with Instagram button');
  },
  
  fridayAt730PM: () => {
    testCountdownTime(2025, 1, 17, 19, 30);
    console.log('✅ Should show: RED still live');
  },
  
  fridayBefore8PM: () => {
    testCountdownTime(2025, 1, 17, 19, 59);
    console.log('✅ Should show: RED live (ending soon)');
  },
  
  // AFTER LIVE - BACK TO NORMAL
  fridayAfter8PM: () => {
    testCountdownTime(2025, 1, 17, 20, 0);
    console.log('✅ Should show: Normal blue countdown to next Thursday');
  },
  
  saturdayMorning: () => {
    testCountdownTime(2025, 1, 18, 10, 0);
    console.log('✅ Should show: Normal blue countdown to next Thursday');
  },
  
  // 5TH FRIDAY SCENARIOS (Skip week)
  fifthFridayWeek: () => {
    // January 29, 2025 is a Wednesday, making Jan 31 the 5th Friday
    testCountdownTime(2025, 1, 29, 12, 0);
    console.log('✅ Should show: "No voting this week (5th Friday)" message');
  },
  
  fifthFriday: () => {
    // January 31, 2025 is the 5th Friday
    testCountdownTime(2025, 1, 31, 15, 0);
    console.log('✅ Should show: "No voting this week (5th Friday)" message');
  },
  
  fifthFridayNight: () => {
    testCountdownTime(2025, 1, 31, 19, 30);
    console.log('✅ Should show: Skip message (no voting/live on 5th Friday)');
  }
};

// Quick test all states
function testAllStates() {
  console.log('🔄 TESTING ALL STATES...\n');
  console.log('=====================================');
  
  console.log('📘 NORMAL COUNTDOWN STATES:');
  console.log('-------------------------------------');
  testScenarios.mondayMorning();
  console.log('-------------------------------------');
  testScenarios.thursdayBefore7PM();
  
  console.log('\n=====================================');
  console.log('💚 VOTING OPEN STATES:');
  console.log('-------------------------------------');
  testScenarios.thursdayAt7PM();
  console.log('-------------------------------------');
  testScenarios.fridayMorning();
  console.log('-------------------------------------');
  testScenarios.fridayBefore7PM();
  
  console.log('\n=====================================');
  console.log('🔴 LIVE REVEAL STATES:');
  console.log('-------------------------------------');
  testScenarios.fridayAt7PM();
  console.log('-------------------------------------');
  testScenarios.fridayAt730PM();
  
  console.log('\n=====================================');
  console.log('⏭️ AFTER LIVE (BACK TO NORMAL):');
  console.log('-------------------------------------');
  testScenarios.fridayAfter8PM();
  
  console.log('\n=====================================');
  console.log('⏸️ 5TH FRIDAY (SKIP WEEK):');
  console.log('-------------------------------------');
  testScenarios.fifthFridayWeek();
  
  console.log('\n=====================================');
  console.log('✅ ALL TESTS COMPLETE!\n');
  console.log('Use resetToRealTime() to go back to current time');
}

// Instructions
console.log(`
🧪 FLEXCHECK COUNTDOWN TESTER LOADED!
=====================================

QUICK COMMANDS:
--------------
testAllStates()              - Run through all state tests
resetToRealTime()            - Return to actual current time

TEST SPECIFIC STATES:
--------------------
testScenarios.mondayMorning()      - Normal countdown
testScenarios.thursdayBefore7PM()  - Just before deadline
testScenarios.thursdayAt7PM()      - Voting opens
testScenarios.fridayMorning()      - Voting in progress
testScenarios.fridayAt7PM()        - Live reveal starts
testScenarios.fridayAfter8PM()     - Back to normal
testScenarios.fifthFridayWeek()    - Skip week test

CUSTOM TIME TEST:
----------------
testCountdownTime(year, month, day, hour, minute)
Example: testCountdownTime(2025, 1, 16, 19, 0)  // Jan 16, 2025 at 7:00 PM

VISUAL CHECK:
------------
After running any test, look at the countdown widget to see:
- Border color (blue/green/red)
- Timer display
- Banner message
- Action buttons
`);

// Auto-run comprehensive test
console.log('Running quick demo in 2 seconds...');
setTimeout(() => {
  console.log('DEMO: Showing voting open state for 3 seconds...');
  testScenarios.thursdayAt7PM();
  setTimeout(() => {
    console.log('DEMO: Showing live state for 3 seconds...');
    testScenarios.fridayAt7PM();
    setTimeout(() => {
      console.log('DEMO: Back to real time');
      resetToRealTime();
    }, 3000);
  }, 3000);
}, 2000);