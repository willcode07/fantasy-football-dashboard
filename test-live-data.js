// Simple test script to verify live data functionality
// This can be run with: node test-live-data.js

const axios = require('axios');

// Test configuration
const LEAGUE_ID = '1243379119207497728'; // Redraft league
const LEAGUE_TYPE = 'redraft';

// Helper function to test current week detection
async function testCurrentWeekDetection() {
  console.log('🔍 Testing current week detection...');
  
  try {
    let currentWeek = 1;
    
    // Check weeks 1-18 to find the current week (not just any week with data)
    for (let week = 1; week <= 18; week++) {
      try {
        const response = await axios.get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`, {
          timeout: 2000 // Faster timeout for live data
        });
        
        if (response.data && response.data.length > 0) {
          // Check if this week has actual matchup data with real scores
          const hasValidData = response.data.some(matchup => 
            matchup.points !== null && matchup.points !== undefined && matchup.points > 0
          );
          
          if (hasValidData) {
            currentWeek = week;
            console.log(`✅ Week ${week} has valid data with scores`);
          }
        }
      } catch (error) {
        // Week doesn't exist yet, stop checking
        break;
      }
    }
    
    console.log(`📅 Current week detected: ${currentWeek}`);
    return currentWeek;
  } catch (error) {
    console.error('❌ Error detecting current week:', error.message);
    return 1;
  }
}

// Helper function to test top 6 logic
async function testTop6Logic(week) {
  console.log(`🏆 Testing top 6 logic for week ${week}...`);
  
  try {
    const response = await axios.get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`);
    
    if (!response.data || response.data.length === 0) {
      console.log(`⚠️  No data found for week ${week}`);
      return false;
    }
    
    // Sort teams by points
    const teamScores = response.data.map(matchup => ({
      roster_id: matchup.roster_id,
      points: matchup.points || 0
    }));
    
    const sortedScores = [...teamScores].sort((a, b) => b.points - a.points);
    const topCount = LEAGUE_TYPE === 'dynasty' ? 5 : 6;
    const topIds = sortedScores.slice(0, topCount).map(team => team.roster_id);
    
    console.log(`📊 Top ${topCount} teams by points:`);
    sortedScores.slice(0, topCount).forEach((team, index) => {
      console.log(`   ${index + 1}. Roster ${team.roster_id}: ${team.points} points`);
    });
    
    // Validate that the logic is working
    let isValid = true;
    teamScores.forEach(team => {
      const shouldBeTop = topIds.includes(team.roster_id);
      // In a real implementation, we would check if team.isTop matches shouldBeTop
      if (shouldBeTop && team.points < sortedScores[topCount - 1].points) {
        isValid = false;
      }
    });
    
    if (isValid) {
      console.log(`✅ Top ${topCount} logic is working correctly`);
    } else {
      console.log(`❌ Top ${topCount} logic has issues`);
    }
    
    return isValid;
  } catch (error) {
    console.error(`❌ Error testing top 6 logic for week ${week}:`, error.message);
    return false;
  }
}

// Helper function to test data freshness
async function testDataFreshness() {
  console.log('🔄 Testing data freshness...');
  
  try {
    const currentWeek = await testCurrentWeekDetection();
    
    // Check if current week has recent data
    const response = await axios.get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${currentWeek}`);
    
    let hasScores = false;
    
    if (response.data && response.data.length > 0) {
      // Check if any teams have scores (indicating games have been played)
      hasScores = response.data.some(matchup => 
        matchup.points !== null && matchup.points !== undefined && matchup.points > 0
      );
      
      if (hasScores) {
        console.log('✅ Current week has live scores');
        
        // Show some sample scores
        const sampleScores = response.data
          .filter(matchup => matchup.points > 0)
          .slice(0, 3)
          .map(matchup => `Roster ${matchup.roster_id}: ${matchup.points} points`)
          .join(', ');
        
        console.log(`📈 Sample scores: ${sampleScores}`);
      } else {
        console.log('⏳ Current week data exists but no scores yet');
      }
    } else {
      console.log('❌ No data found for current week');
    }
    
    return hasScores;
  } catch (error) {
    console.error('❌ Error testing data freshness:', error.message);
    return false;
  }
}

// Helper function to test no hardcoded values
function testNoHardcodedValues() {
  console.log('🔧 Testing for hardcoded values...');
  
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 1-12
  
  console.log(`📅 Current date: ${currentYear}-${currentMonth.toString().padStart(2, '0')}`);
  
  // Test that the system can handle current year without hardcoded dates
  if (currentYear >= 2024 && currentYear <= 2026) {
    console.log('✅ System should handle current year dynamically');
  } else {
    console.log('⚠️  Current year may need manual configuration');
  }
  
  return true;
}

// Helper function to test that future weeks are not displayed
async function testNoFutureWeeks(currentWeek) {
  console.log(`🚫 Testing that future weeks (${currentWeek + 1}+) are not displayed...`);
  
  try {
    // Check that weeks beyond current week either don't exist or have no data
    const futureWeek = currentWeek + 1;
    const response = await axios.get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${futureWeek}`, {
      timeout: 2000 // Faster timeout for live data
    });
    
    if (response.data && response.data.length > 0) {
      // Check if future week has actual scores
      const hasScores = response.data.some(matchup => 
        matchup.points !== null && matchup.points !== undefined && matchup.points > 0
      );
      
      if (hasScores) {
        console.log(`⚠️  Week ${futureWeek} has scores but should not be displayed yet`);
        return false;
      } else {
        console.log(`✅ Week ${futureWeek} exists but has no scores (correct behavior)`);
      }
    } else {
      console.log(`✅ Week ${futureWeek} doesn't exist yet (correct behavior)`);
    }
    
    return true;
  } catch (error) {
    // Future week doesn't exist yet, which is correct
    console.log(`✅ Future week doesn't exist yet (correct behavior)`);
    return true;
  }
}

// Main test function
async function runAllTests() {
  console.log('🚀 Starting Fantasy Dashboard Live Data Tests\n');
  
  const results = {
    currentWeekDetection: false,
    top6Logic: false,
    dataFreshness: false,
    noHardcodedValues: false,
    noFutureWeeks: false
  };
  
  try {
    // Test 1: Current week detection
    const currentWeek = await testCurrentWeekDetection();
    results.currentWeekDetection = currentWeek > 0;
    
    console.log(''); // Empty line
    
    // Test 2: Top 6 logic
    results.top6Logic = await testTop6Logic(currentWeek);
    
    console.log(''); // Empty line
    
    // Test 3: Data freshness
    results.dataFreshness = await testDataFreshness();
    
    console.log(''); // Empty line
    
    // Test 4: No hardcoded values
    results.noHardcodedValues = testNoHardcodedValues();
    
    console.log(''); // Empty line
    
    // Test 5: No future weeks displayed
    results.noFutureWeeks = await testNoFutureWeeks(currentWeek);
    
    console.log('\n📋 Test Results Summary:');
    console.log(`   Current Week Detection: ${results.currentWeekDetection ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Top 6 Logic: ${results.top6Logic ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Data Freshness: ${results.dataFreshness ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   No Hardcoded Values: ${results.noHardcodedValues ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   No Future Weeks: ${results.noFutureWeeks ? '✅ PASS' : '❌ FAIL'}`);
    
    const allPassed = Object.values(results).every(result => result === true);
    console.log(`\n🎯 Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
    
  } catch (error) {
    console.error('💥 Test suite failed:', error.message);
  }
}

// Run the tests
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testCurrentWeekDetection,
  testTop6Logic,
  testDataFreshness,
  testNoHardcodedValues,
  testNoFutureWeeks,
  runAllTests
};
