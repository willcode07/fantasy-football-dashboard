// Test helper utilities for FantasyDashboard testing

/**
 * Creates mock matchup data for testing
 * @param {number} week - Week number
 * @param {Array<number>} top6Scores - Scores for top 6 teams
 * @param {Array<number>} bottom6Scores - Scores for bottom 6 teams
 * @returns {Object} Mock matchup response
 */
export const createMockMatchupData = (week, top6Scores, bottom6Scores) => {
  const matchups = [];
  
  // Add top 6 teams with higher scores
  top6Scores.forEach((score, index) => {
    matchups.push({
      roster_id: index + 1,
      points: score,
      matchup_id: index + 1,
      players: [`player${index + 1}_1`, `player${index + 1}_2`],
      starters: [`player${index + 1}_1`, `player${index + 1}_2`],
      starters_points: [score * 0.6, score * 0.4],
      players_points: {
        [`player${index + 1}_1`]: score * 0.6,
        [`player${index + 1}_2`]: score * 0.4
      }
    });
  });
  
  // Add bottom 6 teams with lower scores
  bottom6Scores.forEach((score, index) => {
    matchups.push({
      roster_id: index + 7,
      points: score,
      matchup_id: index + 7,
      players: [`player${index + 7}_1`, `player${index + 7}_2`],
      starters: [`player${index + 7}_1`, `player${index + 7}_2`],
      starters_points: [score * 0.6, score * 0.4],
      players_points: {
        [`player${index + 7}_1`]: score * 0.6,
        [`player${index + 7}_2`]: score * 0.4
      }
    });
  });
  
  return { data: matchups };
};

/**
 * Creates mock roster data for testing
 * @param {number} teamCount - Number of teams
 * @returns {Object} Mock roster response
 */
export const createMockRosterData = (teamCount = 12) => {
  const rosters = [];
  for (let i = 1; i <= teamCount; i++) {
    rosters.push({
      roster_id: i,
      owner_id: `user${i}`,
      league_id: '1243379119207497728'
    });
  }
  return { data: rosters };
};

/**
 * Creates mock user data for testing
 * @param {number} userCount - Number of users
 * @returns {Object} Mock user response
 */
export const createMockUserData = (userCount = 12) => {
  const users = [];
  for (let i = 1; i <= userCount; i++) {
    users.push({
      user_id: `user${i}`,
      display_name: `Team ${i}`,
      avatar: null
    });
  }
  return { data: users };
};

/**
 * Validates that top 6 logic is working correctly
 * @param {Array} matchupData - Array of matchup data
 * @param {boolean} isDynasty - Whether this is a dynasty league
 * @returns {Object} Validation result
 */
export const validateTop6Logic = (matchupData, isDynasty = false) => {
  const topCount = isDynasty ? 5 : 6;
  
  // Sort by points to get actual top teams
  const sortedByPoints = [...matchupData].sort((a, b) => b.points - a.points);
  const actualTopTeams = sortedByPoints.slice(0, topCount).map(team => team.roster_id);
  
  // Check if the isTop logic is working
  const validationResults = {
    isValid: true,
    errors: [],
    actualTopTeams,
    expectedTopCount: topCount
  };
  
  matchupData.forEach(team => {
    const shouldBeTop = actualTopTeams.includes(team.roster_id);
    const isMarkedAsTop = team.isTop === true;
    
    if (shouldBeTop !== isMarkedAsTop) {
      validationResults.isValid = false;
      validationResults.errors.push(
        `Team ${team.roster_id} (${team.points} points) should ${shouldBeTop ? 'be' : 'not be'} marked as top ${topCount}`
      );
    }
  });
  
  return validationResults;
};

/**
 * Validates that current week data is displayed correctly
 * @param {Array} seasonData - Array of season data
 * @param {number} currentWeek - Current week number
 * @returns {Object} Validation result
 */
export const validateCurrentWeekDisplay = (seasonData, currentWeek) => {
  const currentWeekData = seasonData.filter(entry => entry.week === currentWeek);
  
  const validationResults = {
    isValid: true,
    errors: [],
    currentWeek,
    hasCurrentWeekData: currentWeekData.length > 0,
    currentWeekDataCount: currentWeekData.length
  };
  
  if (currentWeekData.length === 0) {
    validationResults.isValid = false;
    validationResults.errors.push(`No data found for current week ${currentWeek}`);
  }
  
  // Check that current week data has valid points
  currentWeekData.forEach(entry => {
    if (entry.points === null || entry.points === undefined || entry.points < 0) {
      validationResults.isValid = false;
      validationResults.errors.push(
        `Invalid points data for team ${entry.roster_id} in week ${currentWeek}: ${entry.points}`
      );
    }
  });
  
  return validationResults;
};

/**
 * Validates that future weeks are not displayed
 * @param {Array} seasonData - Array of season data
 * @param {number} currentWeek - Current week number
 * @returns {Object} Validation result
 */
export const validateNoFutureWeeks = (seasonData, currentWeek) => {
  const futureWeekData = seasonData.filter(entry => entry.week > currentWeek);
  
  const validationResults = {
    isValid: futureWeekData.length === 0,
    errors: [],
    currentWeek,
    futureWeekCount: futureWeekData.length,
    futureWeeks: futureWeekData.map(entry => entry.week)
  };
  
  if (futureWeekData.length > 0) {
    validationResults.errors.push(
      `Found ${futureWeekData.length} entries for future weeks: ${validationResults.futureWeeks.join(', ')}`
    );
  }
  
  return validationResults;
};

/**
 * Validates that data is being refreshed automatically
 * @param {Function} mockAxios - Mocked axios function
 * @param {number} expectedCalls - Expected number of API calls
 * @returns {Object} Validation result
 */
export const validateAutoRefresh = (mockAxios, expectedCalls) => {
  const actualCalls = mockAxios.mock.calls.length;
  
  return {
    isValid: actualCalls >= expectedCalls,
    errors: actualCalls < expectedCalls ? [
      `Expected at least ${expectedCalls} API calls, but got ${actualCalls}`
    ] : [],
    actualCalls,
    expectedCalls
  };
};

/**
 * Creates a comprehensive test scenario for a full week
 * @param {number} week - Week number
 * @param {boolean} isDynasty - Whether this is a dynasty league
 * @returns {Object} Complete test scenario data
 */
export const createFullWeekScenario = (week, isDynasty = false) => {
  const teamCount = 12;
  const topCount = isDynasty ? 5 : 6;
  
  // Create realistic score distribution
  const topScores = Array.from({ length: topCount }, (_, i) => 120 - (i * 10));
  const bottomScores = Array.from({ length: teamCount - topCount }, (_, i) => 60 - (i * 5));
  
  return {
    week,
    isDynasty,
    teamCount,
    topCount,
    matchupData: createMockMatchupData(week, topScores, bottomScores),
    rosterData: createMockRosterData(teamCount),
    userData: createMockUserData(teamCount),
    expectedTopTeams: Array.from({ length: topCount }, (_, i) => i + 1),
    expectedBottomTeams: Array.from({ length: teamCount - topCount }, (_, i) => i + topCount + 1)
  };
};

/**
 * Validates that no hardcoded values require manual intervention
 * @param {Object} componentProps - Component props and state
 * @returns {Object} Validation result
 */
export const validateNoHardcodedValues = (componentProps) => {
  const validationResults = {
    isValid: true,
    errors: [],
    warnings: []
  };
  
  // Check for hardcoded season start dates
  if (componentProps.seasonStartDates) {
    const currentYear = new Date().getFullYear();
    const hasCurrentYear = Object.keys(componentProps.seasonStartDates).includes(currentYear.toString());
    
    if (!hasCurrentYear) {
      validationResults.warnings.push(
        `Season start dates do not include current year ${currentYear}`
      );
    }
  }
  
  // Check for hardcoded week limits
  if (componentProps.maxWeeks && componentProps.maxWeeks < 18) {
    validationResults.warnings.push(
      `Max weeks is hardcoded to ${componentProps.maxWeeks}, should be dynamic`
    );
  }
  
  return validationResults;
};
