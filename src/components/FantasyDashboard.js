// src/components/FantasyDashboard.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './FantasyDashboard.css';

function FantasyDashboard() {
    const [selectedSeason, setSelectedSeason] = useState(() => {
        return localStorage.getItem('selectedSeason') || '2024';
    });
    
    const leagueIds = {
        '2024': '1094759154738130944',
        '2023': '974055073460396032',
        '2022': '845131315744473088',
        '2021': '652542582072619008',
        '2020': '518187294738378752',
        '2019': '387982074797166592',
        '2018': '329722904092631040'
    };

    const [leagueId, setLeagueId] = useState(leagueIds[selectedSeason]);
    const [seasonData, setSeasonData] = useState([]);
    const [teamNames, setTeamNames] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [loadingProgress, setLoadingProgress] = useState(0);

    // Define sortConfig state
    const [sortConfig, setSortConfig] = useState({
        key: 'totalMNPS',  // Default sorting key
        direction: 'desc'  // Default sorting direction
    });

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
        setLeagueId(leagueIds[selectedSeason]);
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
                const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
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

                        if (matchups && matchups.length > 0) {
                            const teamScores = matchups.map(matchup => ({
                                roster_id: matchup.roster_id,
                                points: matchup.points || 0
                            }));

                            const sortedScores = [...teamScores].sort((a, b) => b.points - a.points);
                            const top6Ids = sortedScores.slice(0, 6).map(team => team.roster_id);

                            const weekData = teamScores.map(({ roster_id, points }) => {
                                const isTop6 = top6Ids.includes(roster_id);
                                const mnps = isTop6 ? 5 + (points * multiplier) : (points * multiplier);
                                return { week, roster_id, points, mnps, isTop6 };
                            });

                            processedData.push(...weekData);
                        }
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
    }, [leagueId, selectedSeason]);

    // Get MNPS multiplier helper function
    const getMNPSMultiplier = (season) => {
        return parseInt(season) >= 2024 ? 0.0653 : 0.082;
    };

    // Calculate total season MNPS for each team to determine top 5
    const seasonTotals = seasonData.reduce((acc, entry) => {
        if (!acc[entry.roster_id]) {
            acc[entry.roster_id] = {
                totalMNPS: 0,
                teamName: teamNames[entry.roster_id]
            };
        }
        acc[entry.roster_id].totalMNPS += entry.mnps;
        return acc;
    }, {});

    // Get top 5 teams by MNPS from regular season (weeks 1-14)
    const getTop5RegularSeasonByMNPS = () => {
        const regularSeasonStats = {};
        
        // Calculate regular season totals
        seasonData.forEach(entry => {
            if (entry.week > 14) return; // Only weeks 1-14
            
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
        
        // Get playoff weeks data for top 5 teams
        seasonData.forEach(entry => {
            if (entry.week < 15 || entry.week > 17) return;
            
            const rosterId = entry.roster_id.toString();
            if (!top5RosterIds.includes(rosterId)) return;
            
            if (!championshipStats[rosterId]) {
                const regularSeasonMNPS = top5Teams.find(team => team.rosterId === rosterId).regularSeasonMNPS;
                championshipStats[rosterId] = {
                    teamName: teamNames[rosterId],
                    regularSeasonMNPS, // Add regular season MNPS
                    weeks: {},
                    totalPoints: 0,
                    totalMNPS: 0
                };
            }
            
            championshipStats[rosterId].weeks[entry.week] = {
                points: entry.points,
                mnps: entry.mnps,
                isTop6: entry.isTop6
            };
            championshipStats[rosterId].totalPoints += entry.points;
            championshipStats[rosterId].totalMNPS += entry.mnps;
        });

        return Object.entries(championshipStats)
            .sort(([, a], [, b]) => b.totalPoints - a.totalPoints);
    };

    // Only calculate these if we have data
    const top5Teams = seasonData.length > 0 ? getTop5RegularSeasonByMNPS() : [];
    const championshipData = seasonData.length > 0 ? getChampionshipData(top5Teams) : [];
    const champion = championshipData.length > 0 ? championshipData[0] : null;

    console.log('Top 5 Roster IDs:', top5Teams);
    console.log('Championship Data:', championshipData);

    // Organize team data with sorting capability
    const organizeTeamData = () => {
        const teamStats = {};
        
        // Initialize team data
        seasonData.forEach(entry => {
            if (entry.week > 14) return; // Only weeks 1-14
            
            const rosterId = entry.roster_id.toString();
            if (!teamStats[rosterId]) {
                teamStats[rosterId] = {
                    teamName: teamNames[rosterId],
                    weeklyData: {},
                    totalPoints: 0,
                    totalMNPS: 0,
                    top6Count: 0  // Add counter for top 6 finishes
                };
            }
            
            teamStats[rosterId].weeklyData[entry.week] = {
                points: entry.points,
                mnps: entry.mnps,
                isTop6: entry.isTop6
            };
            
            teamStats[rosterId].totalPoints += entry.points;
            teamStats[rosterId].totalMNPS += entry.mnps;
            if (entry.isTop6) {
                teamStats[rosterId].top6Count += 1;  // Increment top 6 counter
            }
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
    const weekNumbers = Array.from({ length: 14 }, (_, i) => i + 1);

    return (
        <div className="fantasy-dashboard-wrapper">
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
                        <h2 className="playoff-header">Championship Playoffs - Top 5 MNPS Qualifiers (Weeks 15-17)</h2>
                        <div className="playoff-data">
                            <table className="playoff-table">
                                <thead>
                                    <tr>
                                        <th>Team</th>
                                        <th>Regular Season MNPS</th>
                                        <th>Week 15</th>
                                        <th>Week 16</th>
                                        <th>Week 17</th>
                                        <th>Playoff Points</th>
                                        <th>Playoff MNPS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {championshipData.map(([rosterId, data]) => (
                                        <tr key={rosterId} className={rosterId === champion?.[0] ? 'champion-row' : ''}>
                                            <td className="team-name">
                                                {data.teamName}
                                                {rosterId === champion?.[0] && 
                                                    <span className="champion-badge">🏆 Champion</span>
                                                }
                                            </td>
                                            <td className="regular-season-mnps">
                                                {data.regularSeasonMNPS.toFixed(2)}
                                            </td>
                                            {[15, 16, 17].map(week => (
                                                <td 
                                                    key={week} 
                                                    className={data.weeks[week]?.isTop6 ? 'top-6' : ''}
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
                                            ))}
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

                        <h2 className="season-header">Regular Season Results (Weeks 1-14)</h2>
                        <div className="season-data">
                            <div className="table-wrapper">
                                <table className="season-table">
                                    <thead>
                                        <tr>
                                            <th className="sticky-col sortable" onClick={() => handleSort('teamName')}>
                                                Team {getSortIcon('teamName')}
                                            </th>
                                            {weekNumbers.map(week => (
                                                <th 
                                                    key={week} 
                                                    className="sortable"
                                                    onClick={() => handleSort(`week_${week}`)}
                                                >
                                                    Week {week} {getSortIcon(`week_${week}`)}
                                                </th>
                                            ))}
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
                                                Points {getSortIcon('totalPoints')}
                                            </th>
                                            <th 
                                                className="total-col sortable" 
                                                onClick={() => handleSort('totalMNPS')}
                                            >
                                                MNPS {getSortIcon('totalMNPS')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedTeams.map(([rosterId, data]) => (
                                            <tr key={rosterId}>
                                                <td className="sticky-col">{data.teamName}</td>
                                                {weekNumbers.map(week => {
                                                    const weekData = data.weeklyData[week];
                                                    return (
                                                        <td 
                                                            key={week} 
                                                            className={weekData?.isTop6 ? 'top-6' : ''}
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
