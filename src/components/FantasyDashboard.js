// src/components/FantasyDashboard.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './FantasyDashboard.css';

// Stable league IDs mapping for each season
const LEAGUE_IDS = {
    '2025': '1243379119207497728',
    '2024': '1094759154738130944',
    '2023': '974055073460396032',
    '2022': '845131315744473088',
    '2021': '652542582072619008',
    '2020': '518187294738378752',
    '2019': '387982074797166592',
    '2018': '329722904092631040'
};

function FantasyDashboard() {
    const [selectedSeason, setSelectedSeason] = useState(() => {
        return localStorage.getItem('selectedSeason') || '2025';
    });

    const [leagueId, setLeagueId] = useState(LEAGUE_IDS[selectedSeason]);
    const [seasonData, setSeasonData] = useState([]);
    const [teamNames, setTeamNames] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const isDarkMode = true; // Set dark mode as default
    const isProjectedSeason = selectedSeason === new Date().getFullYear().toString();

    // Define sortConfig state
    const [sortConfig, setSortConfig] = useState({
        key: 'totalMNPS',  // Default sorting key
        direction: 'desc'  // Default sorting direction
    });

    // Get current week based on date (Tuesday 12am EST)
    const getCurrentWeekNumber = () => {
        // For 2025 season, return week 2 since we only have weeks 1-2 data
        // For other seasons, use date-based calculation
        if (selectedSeason === '2025') {
            return 2; // Only show weeks 1-2 for 2025
        }
        
        const now = new Date();
        const estOffset = -5; // EST is UTC-5
        const estTime = new Date(now.getTime() + (estOffset * 60 * 60 * 1000));
        
        // Get the start of the NFL season based on selected season
        const seasonStartDates = {
            '2024': '2024-09-03',
            '2023': '2023-09-05',
            '2022': '2022-09-06',
            '2021': '2021-09-07',
            '2020': '2020-09-08',
            '2019': '2019-09-03',
            '2018': '2018-09-04'
        };
        
        const seasonStart = new Date(seasonStartDates[selectedSeason] || seasonStartDates['2024']);
        const weeksSinceStart = Math.floor((estTime - seasonStart) / (7 * 24 * 60 * 60 * 1000));
        
        // Return current week (1-17) or 1 if before season starts
        return Math.max(1, Math.min(17, weeksSinceStart + 1));
    };

    const currentWeekNumber = getCurrentWeekNumber();

    // Load cached data immediately
    useEffect(() => {
        const cachedData = localStorage.getItem(`fantasy_${selectedSeason}`);
        if (cachedData) {
            const parsed = JSON.parse(cachedData);
            setTeamNames(parsed.teamNames || {});
            setSeasonData(parsed.seasonData || []);
            setLoading(false);
        } else {
            setLoading(true); // Set loading to true if no cached data
        }
    }, [selectedSeason]);

    // Update leagueId when selectedSeason changes
    useEffect(() => {
        setLeagueId(LEAGUE_IDS[selectedSeason]);
    }, [selectedSeason]);

    // Fetch fresh data
    useEffect(() => {
        let isMounted = true;
        
        const fetchSeasonData = async () => {
            try {
                setLoadingProgress(0);
                
                // Fetch basic data
                const [rostersResponse, usersResponse] = await Promise.all([
                    axios.get(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
                    axios.get(`https://api.sleeper.app/v1/league/${leagueId}/users`)
                ]);

                if (!isMounted) return;

                // Process team names
                const names = {};
                rostersResponse.data.forEach(roster => {
                    const user = usersResponse.data.find(u => u.user_id === roster.owner_id);
                    names[roster.roster_id] = user?.display_name || `Team ${roster.roster_id}`;
                });
                setTeamNames(names);

                // Fetch weeks in smaller batches
                // For projected seasons, fetch weeks with data plus current week
                // For completed seasons, fetch all 17 weeks
                const maxWeeksToFetch = isProjectedSeason ? Math.max(2, currentWeekNumber) : 17;
                const weeks = Array.from({ length: maxWeeksToFetch }, (_, i) => i + 1);
                const processedData = [];
                const multiplier = getMNPSMultiplier(selectedSeason);

                // Process 3 weeks at a time
                for (let i = 0; i < weeks.length; i += 3) {
                    if (!isMounted) return;

                    const batchWeeks = weeks.slice(i, i + 3);
                    const responses = await Promise.all(
                        batchWeeks.map(week => 
                            axios.get(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`)
                        )
                    );

                    responses.forEach((response, index) => {
                        const week = batchWeeks[index];
                        const matchups = response.data;

                        // Only process weeks that have actual matchup data
                        if (matchups && matchups.length > 0) {
                            const teamScores = matchups.map(matchup => ({
                                roster_id: matchup.roster_id,
                                points: matchup.points || 0
                            }));

                            // Only calculate top 6 and MNPS if we have valid scores
                            if (teamScores.length > 0) {
                                const sortedScores = [...teamScores].sort((a, b) => b.points - a.points);
                                const top6Ids = sortedScores.slice(0, 6).map(team => team.roster_id);

                                const weekData = teamScores.map(({ roster_id, points }) => {
                                    const isTop6 = top6Ids.includes(roster_id);
                                    const mnps = isTop6 ? 5 + (points * multiplier) : (points * multiplier);
                                    return { week, roster_id, points, mnps, isTop6 };
                                });

                                // Add week data, avoiding duplicates
                                weekData.forEach(newEntry => {
                                    const existingIndex = processedData.findIndex(existing => 
                                        existing.week === newEntry.week && existing.roster_id === newEntry.roster_id
                                    );
                                    if (existingIndex === -1) {
                                        processedData.push(newEntry);
                                    }
                                });
                            }
                        }
                        // If no matchups data, skip this week entirely - don't create empty entries
                    });

                    // Update progress and data incrementally
                    const progress = Math.min(100, ((i + 3) / weeks.length) * 100);
                    setLoadingProgress(progress);
                    setSeasonData([...processedData]);

                    // Small delay between batches
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                // Cache the final data
                localStorage.setItem(`fantasy_${selectedSeason}`, JSON.stringify({
                    teamNames: names,
                    seasonData: processedData,
                    timestamp: Date.now()
                }));

                setLoading(false);
                setLoadingProgress(100);

            } catch (error) {
                console.error('Error fetching season data:', error);
                if (isMounted) {
                    setError('Failed to load data. Please try again later.');
                    setLoading(false);
                }
            }
        };

        fetchSeasonData();

        return () => {
            isMounted = false;
        };
    }, [leagueId, selectedSeason, currentWeekNumber]);

    // Get MNPS multiplier helper function
    const getMNPSMultiplier = (season) => {
        return parseInt(season) >= 2024 ? 0.0653 : 0.082;
    };

    // Removed unused seasonTotals calculation to satisfy linter

    // Get top 5 teams by MNPS from regular season (weeks 1-14)
    const getTop5RegularSeasonByMNPS = () => {
        const regularSeasonStats = {};
        
        // For projected seasons, use weeks with data plus current week
        // For completed seasons, only use weeks 1-14
        const maxWeek = isProjectedSeason ? Math.max(2, currentWeekNumber) : 14;
        
        // Calculate regular season totals
        seasonData.forEach(entry => {
            if (entry.week > maxWeek) return;
            
            const rosterId = entry.roster_id.toString();
            if (!regularSeasonStats[rosterId]) {
                regularSeasonStats[rosterId] = {
                    teamName: teamNames[rosterId],
                    totalPoints: 0,
                    totalMNPS: 0
                };
            }
            regularSeasonStats[rosterId].totalPoints += entry.points;
            regularSeasonStats[rosterId].totalMNPS += entry.mnps;
        });

        // Get top 5 roster IDs by MNPS
        return Object.entries(regularSeasonStats)
            .sort(([, a], [, b]) => b.totalMNPS - a.totalMNPS) // Sort by MNPS instead of points
            .slice(0, 5)
            .map(([rosterId, data]) => ({
                rosterId,
                regularSeasonMNPS: data.totalMNPS // Store regular season MNPS for display
            }));
    };

    // Calculate championship data for top 5 teams
    const getChampionshipData = (top5Teams) => {
        const championshipStats = {};
        const top5RosterIds = top5Teams.map(team => team.rosterId);
        
        // For projected 2025 season, show current top 5 with their current stats
        if (isProjectedSeason) {
            top5Teams.forEach(team => {
                const rosterId = team.rosterId;
                championshipStats[rosterId] = {
                    teamName: teamNames[rosterId],
                    regularSeasonAverageMNPS: team.regularSeasonMNPS / Math.max(1, seasonData.filter(entry => 
                        entry.roster_id.toString() === rosterId && entry.week <= 2
                    ).length), // Calculate average based on games played
                    weeks: {},
                    totalPoints: 0,
                    totalMNPS: team.regularSeasonMNPS,
                    isProjected: true
                };
                
                // Show current week data if available
                const teamData = seasonData.filter(entry => 
                    entry.roster_id.toString() === rosterId && entry.week <= 2
                );
                
                teamData.forEach(entry => {
                    championshipStats[rosterId].weeks[entry.week] = {
                        points: entry.points,
                        mnps: entry.mnps,
                        isTop6: entry.isTop6
                    };
                    championshipStats[rosterId].totalPoints += entry.points;
                });
            });
            
            return Object.entries(championshipStats)
                .sort(([, a], [, b]) => b.totalMNPS - a.totalMNPS);
        }
        
        // For completed seasons, get actual playoff weeks data for top 5 teams
        // Playoff weeks are typically 15-17, but can vary by season
        const playoffStartWeek = 15;
        const playoffEndWeek = 17;
        
        seasonData.forEach(entry => {
            if (entry.week < playoffStartWeek || entry.week > playoffEndWeek) return;
            
            const rosterId = entry.roster_id.toString();
            if (!top5RosterIds.includes(rosterId)) return;
            
            if (!championshipStats[rosterId]) {
                const teamData = top5Teams.find(team => team.rosterId === rosterId);
                championshipStats[rosterId] = {
                    teamName: teamNames[rosterId],
                    regularSeasonAverageMNPS: teamData ? teamData.regularSeasonAverageMNPS : 0,
                    weeks: {},
                    totalPoints: 0,
                    totalMNPS: 0
                };
            }
            
            championshipStats[rosterId].weeks[entry.week] = {
                points: entry.points,
                mnps: entry.mnps,
                isTop6: true // Treat all as top 6 for scoring
            };
            championshipStats[rosterId].totalPoints += entry.points;
            championshipStats[rosterId].totalMNPS += entry.mnps;
        });

        // Highlight only the highest score for each week
        Object.values(championshipStats).forEach(team => {
            for (let week = playoffStartWeek; week <= playoffEndWeek; week++) {
                if (team.weeks[week]) {
                    const weekData = team.weeks[week];
                    weekData.isHighest = false; // Initialize as not highest
                }
            }
        });

        // Determine highest scores for each week
        const highestScores = {};
        Object.entries(championshipStats).forEach(([rosterId, data]) => {
            for (let week = playoffStartWeek; week <= playoffEndWeek; week++) {
                if (data.weeks[week]) {
                    const weekPoints = data.weeks[week].points;
                    if (!highestScores[week] || weekPoints > highestScores[week].points) {
                        highestScores[week] = { points: weekPoints, rosterId };
                    }
                }
            }
        });

        // Mark the highest scores
        Object.entries(championshipStats).forEach(([rosterId, data]) => {
            for (let week = playoffStartWeek; week <= playoffEndWeek; week++) {
                if (data.weeks[week] && data.weeks[week].points === highestScores[week].points) {
                    data.weeks[week].isHighest = true; // Mark as highest
                }
            }
        });

        return Object.entries(championshipStats)
            .sort(([, a], [, b]) => b.totalPoints - a.totalPoints);
    };

    // Only calculate these if we have data
    const top5Teams = seasonData.length > 0 ? getTop5RegularSeasonByMNPS() : [];
    const championshipData = seasonData.length > 0 ? getChampionshipData(top5Teams) : [];
    const champion = championshipData.length > 0 ? championshipData[0] : null;

    // Organize team data with sorting capability
    const organizeTeamData = () => {
        const teamStats = {};
        
        // For projected seasons, use weeks with data plus current week
        // For completed seasons, only use weeks 1-14
        const maxWeek = isProjectedSeason ? Math.max(2, currentWeekNumber) : 14;
        
        // Initialize team data
        seasonData.forEach(entry => {
            if (entry.week > maxWeek) return;
            
            const rosterId = entry.roster_id.toString();
            if (!teamStats[rosterId]) {
                teamStats[rosterId] = {
                    teamName: teamNames[rosterId],
                    weeklyData: {},
                    totalPoints: 0,
                    totalMNPS: 0,
                    top6Count: 0,  // Add counter for top 6 finishes
                    regularSeasonGames: 0 // Track number of games for average calculation
                };
            }
            
            teamStats[rosterId].weeklyData[entry.week] = {
                points: entry.points,
                mnps: entry.mnps,
                isTop6: entry.isTop6
            };
            
            teamStats[rosterId].totalPoints += entry.points;
            teamStats[rosterId].totalMNPS += entry.mnps;
            teamStats[rosterId].regularSeasonGames += 1; // Increment game count
            if (entry.isTop6) {
                teamStats[rosterId].top6Count += 1;  // Increment top 6 counter
            }
        });

        // Ensure teams appear even if there is no weekly data yet (e.g., early 2025)
        Object.keys(teamNames || {}).forEach((rid) => {
            const rosterId = rid.toString();
            if (!teamStats[rosterId]) {
                teamStats[rosterId] = {
                    teamName: teamNames[rosterId],
                    weeklyData: {},
                    totalPoints: 0,
                    totalMNPS: 0,
                    top6Count: 0,
                    regularSeasonGames: 0
                };
            }
        });

        // Calculate average MNPS for each team
        Object.values(teamStats).forEach(team => {
            team.regularSeasonAverageMNPS = team.regularSeasonGames > 0 ? (team.totalMNPS / team.regularSeasonGames) : 0; // Calculate MNPS average
        });

        return teamStats;
    };

    const sortData = (data, sortConfig) => {
        const sortedEntries = Object.entries(data).sort((a, b) => {
            if (sortConfig.key === 'teamName') {
                return sortConfig.direction === 'asc' 
                    ? a[1].teamName.localeCompare(b[1].teamName)
                    : b[1].teamName.localeCompare(a[1].teamName);
            }
            
            if (sortConfig.key === 'totalPoints' || 
                sortConfig.key === 'totalMNPS' || 
                sortConfig.key === 'top6Count') {  // Add sorting for top6Count
                return sortConfig.direction === 'asc'
                    ? a[1][sortConfig.key] - b[1][sortConfig.key]
                    : b[1][sortConfig.key] - a[1][sortConfig.key];
            }
            
            // Sort by specific week
            if (sortConfig.key.startsWith('week')) {
                const weekNum = parseInt(sortConfig.key.split('_')[1]);
                const aValue = a[1].weeklyData[weekNum]?.points || 0;
                const bValue = b[1].weeklyData[weekNum]?.points || 0;
                return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
            }
            
            return 0;
        });
        
        return sortedEntries;
    };

    const handleSort = (key) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return '↕️';
        return sortConfig.direction === 'desc' ? '↓' : '↑';
    };

    const teamData = organizeTeamData();
    const sortedTeams = sortData(teamData, sortConfig);
    
    // For 2025 projected season, show only weeks with actual data
    // For completed seasons, show weeks 1-14
    const weekNumbers = isProjectedSeason 
        ? (() => {
            // Get weeks that have actual data
            const weeksWithData = seasonData.length > 0 
                ? [...new Set(seasonData.map(entry => entry.week))].sort((a, b) => a - b)
                : [];
            
            // Only show weeks with actual data - no additional weeks
            return weeksWithData;
        })()
        : Array.from({ length: 14 }, (_, i) => i + 1);


    return (
        <div className={`fantasy-dashboard-wrapper ${isDarkMode ? 'dark-mode' : ''}`}>
            <div className="fantasy-dashboard">
                <h1>Fantasy Football MNPS Dashboard</h1>
                
                <div className="season-selector">
                    <label>
                        Select Season:
                        <select 
                            value={selectedSeason} 
                            onChange={(e) => setSelectedSeason(e.target.value)}
                            className="season-select"
                            disabled={loading && loadingProgress < 100}
                        >
                            <option value="2025">2025 Season (0.0653)</option>
                            <option value="2024">2024 Season (0.0653)</option>
                            <option value="2023">2023 Season (0.082)</option>
                            <option value="2022">2022 Season (0.082)</option>
                            <option value="2021">2021 Season (0.082)</option>
                            <option value="2020">2020 Season (0.082)</option>
                            <option value="2019">2019 Season (0.082)</option>
                            <option value="2018">2018 Season (0.082)</option>
                        </select>
                    </label>
                    {loading && loadingProgress < 100 && (
                        <div className="loading-progress">
                            <div 
                                className="progress-bar" 
                                style={{ width: `${loadingProgress}%` }}
                            />
                            <div className="progress-text">
                                Loading... {Math.round(loadingProgress)}%
                            </div>
                        </div>
                    )}
                    {error && <div className="error-message">{error}</div>}
                </div>

                {loading ? (
                    <div className="loading-container">
                        <div className="loading-spinner"></div>
                        <p>Loading {selectedSeason} season data...</p>
                    </div>
                ) : error ? (
                    <div className="error-container">
                        <p>{error}</p>
                        <button onClick={() => window.location.reload()}>
                            Retry
                        </button>
                    </div>
                ) : (
                    <>
                        <h2 className="playoff-header">
                            {isProjectedSeason
                                ? 'Current Playoff Picture - Top 5 MNPS Leaders (Rolling Preview)'
                                : 'Championship Playoffs - Top 5 MNPS Qualifiers (Weeks 15-17)'}
                        </h2>
                        <div className="playoff-data">
                            <div className="table-wrapper">
                                <table className="playoff-table">
                                    <thead>
                                        <tr>
                                            <th>Team</th>
                                            {isProjectedSeason ? (
                                                <>
                                                    <th>Last Week</th>
                                                    <th>Best Performance</th>
                                                    <th>Season Average</th>
                                                </>
                                            ) : (
                                                <>
                                                    <th>Week 15</th>
                                                    <th>Week 16</th>
                                                    <th>Week 17</th>
                                                </>
                                            )}
                                            <th>{isProjectedSeason ? 'Total Points' : 'Playoff Points'}</th>
                                            <th>{isProjectedSeason ? 'Total MNPS' : 'Playoff MNPS'}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {championshipData.map(([rosterId, data]) => (
                                            <tr key={rosterId} className={!isProjectedSeason && rosterId === champion?.[0] ? 'champion-row' : ''}>
                                                <td className="team-name">
                                                    {data.teamName}
                                                    {!isProjectedSeason && rosterId === champion?.[0] && 
                                                        <span className="champion-badge">🏆 Champion</span>
                                                    }
                                                </td>
                                                {isProjectedSeason ? (
                                                    <>
                                                        <td className="last-week">
                                                            {(() => {
                                                                const lastWeek = Math.max(...Object.keys(data.weeks).map(Number));
                                                                const weekData = data.weeks[lastWeek];
                                                                return weekData ? (
                                                                    <>
                                                                        <div className="points">
                                                                            {weekData.points.toFixed(2)}
                                                                        </div>
                                                                        <div className="mnps">
                                                                            {weekData.mnps.toFixed(2)}
                                                                        </div>
                                                                    </>
                                                                ) : '-';
                                                            })()}
                                                        </td>
                                                        <td className="best-performance">
                                                            {(() => {
                                                                const weekData = Object.values(data.weeks);
                                                                const bestWeek = weekData.reduce((best, current) => {
                                                                    return current.points > best.points ? current : best;
                                                                }, { points: 0, mnps: 0 });
                                                                return (
                                                                    <>
                                                                        <div className="points">
                                                                            {bestWeek.points.toFixed(2)}
                                                                        </div>
                                                                        <div className="mnps">
                                                                            {bestWeek.mnps.toFixed(2)}
                                                                        </div>
                                                                    </>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className="season-average">
                                                            {(() => {
                                                                const totalGames = Object.keys(data.weeks).length;
                                                                const avgPoints = totalGames > 0 ? data.totalPoints / totalGames : 0;
                                                                const avgMNPS = totalGames > 0 ? data.totalMNPS / totalGames : 0;
                                                                return (
                                                                    <>
                                                                        <div className="points">
                                                                            {avgPoints.toFixed(2)}
                                                                        </div>
                                                                        <div className="mnps">
                                                                            {avgMNPS.toFixed(2)}
                                                                        </div>
                                                                    </>
                                                                );
                                                            })()}
                                                        </td>
                                                    </>
                                                ) : (
                                                    [15, 16, 17].map(week => (
                                                        <td 
                                                            key={week} 
                                                            className={data.weeks[week] && data.weeks[week].isHighest ? 'top-6' : ''}
                                                        >
                                                            {data.weeks[week] ? (
                                                                <>
                                                                    <div className="points">
                                                                        {data.weeks[week].points.toFixed(2)}
                                                                    </div>
                                                                    <div className="mnps">
                                                                        {data.weeks[week].mnps.toFixed(2)}
                                                                    </div>
                                                                </>
                                                            ) : '-'}
                                                        </td>
                                                    ))
                                                )}
                                                <td className="total-points">
                                                    {data.totalPoints.toFixed(2)}
                                                </td>
                                                <td className="total-mnps">
                                                    {data.totalMNPS.toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <h2 className="season-header">Regular Season Results (Weeks 1-17)</h2>
                        <div className="season-data">
                            <div className="table-wrapper">
                                <table className="season-table">
                                    <thead>
                                        <tr>
                                            <th className="sticky-col sortable" onClick={() => handleSort('teamName')}>
                                                Team {getSortIcon('teamName')}
                                            </th>
                                            {weekNumbers.map(week => {
                                                const isCurrentWeek = week === currentWeekNumber;
                                                const isFutureWeek = week > currentWeekNumber;
                                                return (
                                                    <th 
                                                        key={week} 
                                                        className={`sortable ${isFutureWeek ? 'future-week' : ''}`}
                                                        onClick={() => handleSort(`week_${week}`)}
                                                    >
                                                        Week {week} {isCurrentWeek ? '(Current)' : ''} {getSortIcon(`week_${week}`)}
                                                    </th>
                                                );
                                            })}
                                            <th 
                                                className="total-col sortable" 
                                                onClick={() => handleSort('top6Count')}
                                            >
                                                Top 6s {getSortIcon('top6Count')}
                                            </th>
                                            <th 
                                                className="total-col sortable" 
                                                onClick={() => handleSort('totalPoints')}
                                            >
                                                Total Points {getSortIcon('totalPoints')}
                                            </th>
                                            <th 
                                                className="total-col sortable" 
                                                onClick={() => handleSort('totalMNPS')}
                                            >
                                                Total MNPS {getSortIcon('totalMNPS')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedTeams.map(([rosterId, data]) => (
                                            <tr key={rosterId}>
                                                <td className="sticky-col">{data.teamName}</td>
                                                {weekNumbers.map(week => {
                                                    const weekData = data.weeklyData[week];
                                                    const isCurrentWeek = week === currentWeekNumber;
                                                    const isFutureWeek = week > currentWeekNumber;
                                                    
                                                    // For current week, always show "-" with no special styling
                                                    if (isCurrentWeek) {
                                                        return (
                                                            <td 
                                                                key={week}
                                                            >
                                                                -
                                                            </td>
                                                        );
                                                    }
                                                    
                                                    // For other weeks, show data normally
                                                    const shouldShowTop6 = weekData && weekData.isTop6;
                                                    return (
                                                        <td 
                                                            key={week} 
                                                            className={`${shouldShowTop6 ? 'top-6' : ''} ${isFutureWeek ? 'future-week' : ''}`}
                                                        >
                                                            {weekData ? (
                                                                <>
                                                                    <div className="points">
                                                                        {weekData.points.toFixed(2)}
                                                                    </div>
                                                                    <div className="mnps">
                                                                        {weekData.mnps.toFixed(2)}
                                                                    </div>
                                                                </>
                                                            ) : '-'}
                                                        </td>
                                                    );
                                                })}
                                                <td className="total-col top6-count">
                                                    {data.top6Count}
                                                </td>
                                                <td className="total-col">{data.totalPoints.toFixed(2)}</td>
                                                <td className="total-col mnps-total">{data.totalMNPS.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default FantasyDashboard;
