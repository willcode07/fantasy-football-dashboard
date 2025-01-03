// src/components/FantasyDashboard.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';

function FantasyDashboard() {
    const [selectedSeason, setSelectedSeason] = useState('2024');
    const leagueIds = {
        '2024': '1094759154738130944',
        '2023': '974055073460396032',
        '2022': '845131315744473088',
        '2021': '652542582072619008',
        '2020': '518187294738378752',
        '2019': '387982074797166592',
        '2018': '329722904092631040'
    };
    const [leagueId, setLeagueId] = useState(leagueIds['2024']);
    const [seasonData, setSeasonData] = useState([]);
    const [teamNames, setTeamNames] = useState({});
    const [loading, setLoading] = useState(true);
    const [selectedWeek, setSelectedWeek] = useState('all');
    const [sortConfig, setSortConfig] = useState({
        key: 'totalMNPS',  // Default sort by total MNPS
        direction: 'desc'
    });

    // Update MNPS multiplier helper function
    const getMNPSMultiplier = (season) => {
        return parseInt(season) >= 2024 ? 0.0653 : 0.082;
    };

    useEffect(() => {
        setLoading(true);
        setLeagueId(leagueIds[selectedSeason]);
    }, [selectedSeason]);

    useEffect(() => {
        const fetchSeasonData = async () => {
            try {
                setLoading(true);
                
                // Fetch data for the selected season
                const rostersResponse = await axios.get(
                    `https://api.sleeper.app/v1/league/${leagueId}/rosters`
                );
                
                const usersResponse = await axios.get(
                    `https://api.sleeper.app/v1/league/${leagueId}/users`
                );

                // Create team names mapping
                const names = {};
                rostersResponse.data.forEach(roster => {
                    const user = usersResponse.data.find(u => u.user_id === roster.owner_id);
                    names[roster.roster_id] = user?.display_name || `Team ${roster.roster_id}`;
                });
                setTeamNames(names);

                // Fetch all weeks
                const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
                const weekData = await Promise.all(
                    weeks.map(async (week) => {
                        const response = await axios.get(
                            `https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`
                        );
                        return { week, matchups: response.data };
                    })
                );

                // Process matchups with season-specific multiplier
                const multiplier = getMNPSMultiplier(selectedSeason);
                const processedData = weekData
                    .filter(({ matchups }) => matchups && matchups.length > 0)
                    .flatMap(({ week, matchups }) => {
                        const teamScores = matchups.map(matchup => ({
                            roster_id: matchup.roster_id,
                            points: matchup.points || 0
                        }));

                        const sortedScores = [...teamScores].sort((a, b) => b.points - a.points);
                        const top6Ids = sortedScores.slice(0, 6).map(team => team.roster_id);

                        return teamScores.map(({ roster_id, points }) => {
                            const isTop6 = top6Ids.includes(roster_id);
                            const mnps = isTop6 ? 5 + (points * multiplier) : (points * multiplier);
                            return { week, roster_id, points, mnps, isTop6 };
                        });
                    });

                setSeasonData(processedData);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching season data:', error);
                setLoading(false);
            }
        };

        if (leagueId) {
            fetchSeasonData();
        }
    }, [leagueId, selectedSeason]); // Add selectedSeason to dependencies

    // Get unique weeks for the filter dropdown
    const weeks = [...new Set(seasonData.map(entry => entry.week))].sort((a, b) => a - b);

    // Filter data based on selected week
    const filteredData = selectedWeek === 'all' 
        ? seasonData 
        : seasonData.filter(entry => entry.week === parseInt(selectedWeek));

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
        <div className="fantasy-dashboard">
            <h1>Fantasy Football MNPS Dashboard</h1>
            
            <div className="season-selector">
                <label>
                    Select Season:
                    <select 
                        value={selectedSeason} 
                        onChange={(e) => setSelectedSeason(e.target.value)}
                        className="season-select"
                    >
                        <option value="2024">2024 Season (0.0653)</option>
                        <option value="2023">2023 Season (0.082)</option>
                        <option value="2022">2022 Season (0.082)</option>
                        <option value="2021">2021 Season (0.082)</option>
                        <option value="2020">2020 Season (0.082)</option>
                        <option value="2019">2020 Season (0.082)</option>
                        <option value="2018">2018 Season (0.082)</option>
                    </select>
                </label>
                <div className="multiplier-info">
                    Current MNPS Multiplier: {getMNPSMultiplier(selectedSeason)}
                    <div className="multiplier-note">
                        Note: The MNPS multiplier was changed from 0.082 to 0.0653 starting in 2024
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="loading">
                    <p>Loading {selectedSeason} season data...</p>
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
    );
}

export default FantasyDashboard;
