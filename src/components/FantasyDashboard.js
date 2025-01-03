// src/components/FantasyDashboard.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';

function FantasyDashboard() {
    const [leagueId, setLeagueId] = useState('1094759154738130944');
    const [seasonData, setSeasonData] = useState([]);
    const [teamNames, setTeamNames] = useState({});
    const [loading, setLoading] = useState(true);
    const [selectedWeek, setSelectedWeek] = useState('all');

    useEffect(() => {
        const fetchTeamNames = async () => {
            try {
                // Fetch rosters to get roster_id -> owner_id mapping
                const rostersResponse = await axios.get(
                    `https://api.sleeper.app/v1/league/${leagueId}/rosters`
                );
                
                // Fetch users to get user data (display names)
                const usersResponse = await axios.get(
                    `https://api.sleeper.app/v1/league/${leagueId}/users`
                );

                // Create mapping of roster_id to team names
                const nameMapping = {};
                rostersResponse.data.forEach((roster) => {
                    const user = usersResponse.data.find(u => u.user_id === roster.owner_id);
                    nameMapping[roster.roster_id] = user?.display_name || `Team ${roster.roster_id}`;
                });

                setTeamNames(nameMapping);
            } catch (error) {
                console.error('Error fetching team names:', error);
            }
        };

        const fetchSeasonData = async () => {
            try {
                setLoading(true);
                await fetchTeamNames(); // Fetch team names first
                
                const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
                const weekData = await Promise.all(
                    weeks.map(async (week) => {
                        const response = await axios.get(
                            `https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`
                        );
                        return { week, matchups: response.data };
                    })
                );

                // Process all weeks
                const processedData = weekData.map(({ week, matchups }) => {
                    if (!matchups || matchups.length === 0) return null;

                    const teamScores = matchups.map((matchup) => ({
                        roster_id: matchup.roster_id,
                        points: matchup.points,
                    }));

                    // Sort and calculate MNPS
                    const sortedScores = [...teamScores].sort((a, b) => b.points - a.points);
                    const top6Ids = sortedScores.slice(0, 6).map((team) => team.roster_id);

                    return teamScores.map(({ roster_id, points }) => {
                        const isTop6 = top6Ids.includes(roster_id);
                        const mnps = isTop6 ? 5 + (points * 0.0653) : (points * 0.0653);
                        return { week, roster_id, points, mnps, isTop6 };
                    });
                }).filter(Boolean).flat();

                // Calculate running totals
                const runningTotals = {};
                processedData.forEach((entry) => {
                    if (!runningTotals[entry.roster_id]) {
                        runningTotals[entry.roster_id] = 0;
                    }
                    runningTotals[entry.roster_id] += entry.mnps;
                });

                setSeasonData(processedData);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching season data:', error);
                setLoading(false);
            }
        };

        fetchSeasonData();
    }, [leagueId]);

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

    // Get top 5 roster IDs
    const top5RosterIds = Object.entries(seasonTotals)
        .sort(([, a], [, b]) => b.totalMNPS - a.totalMNPS)
        .slice(0, 5)
        .map(([rosterId]) => rosterId);

    // Calculate playoff data (weeks 15-17) for top 5 teams only
    const playoffData = seasonData
        .filter(entry => entry.week >= 15 && entry.week <= 17)
        .reduce((acc, entry) => {
            if (!acc[entry.roster_id]) {
                acc[entry.roster_id] = {
                    teamName: teamNames[entry.roster_id] || `Team ${entry.roster_id}`,
                    weeks: {},
                    totalMNPS: 0,
                    totalPoints: 0
                };
            }
            acc[entry.roster_id].weeks[entry.week] = {
                points: entry.points,
                mnps: entry.mnps,
                isTop6: entry.isTop6
            };
            acc[entry.roster_id].totalMNPS += entry.mnps;
            acc[entry.roster_id].totalPoints += entry.points;
            return acc;
        }, {});

    // Sort teams by total playoff MNPS
    const sortedPlayoffTeams = Object.entries(playoffData)
        .sort(([, a], [, b]) => b.totalMNPS - a.totalMNPS);

    // Organize data by team for the full season view
    const organizeTeamData = () => {
        const teamStats = {};
        
        // Initialize team data
        seasonData.forEach(entry => {
            if (!teamStats[entry.roster_id]) {
                teamStats[entry.roster_id] = {
                    teamName: teamNames[entry.roster_id] || `Team ${entry.roster_id}`,
                    weeklyData: {},
                    totalPoints: 0,
                    totalMNPS: 0
                };
            }
            
            // Add weekly data
            teamStats[entry.roster_id].weeklyData[entry.week] = {
                points: entry.points,
                mnps: entry.mnps,
                isTop6: entry.isTop6
            };
            
            // Update totals
            teamStats[entry.roster_id].totalPoints += entry.points;
            teamStats[entry.roster_id].totalMNPS += entry.mnps;
        });
        
        // Sort teams by total points
        return Object.entries(teamStats)
            .sort(([, a], [, b]) => b.totalPoints - a.totalPoints);
    };

    const sortedTeams = organizeTeamData();
    const weekNumbers = Array.from({ length: 17 }, (_, i) => i + 1); // Weeks 1-17

    return (
        <div className="fantasy-dashboard">
            <h1>Fantasy Football MNPS Dashboard</h1>
            {loading ? (
                <p>Loading season data...</p>
            ) : (
                <>
                    <h2 className="playoff-header">Championship Battle Royale - Top 5 Teams (Weeks 15-17)</h2>
                    <div className="playoff-data">
                        <table className="playoff-table">
                            <thead>
                                <tr>
                                    <th>Team</th>
                                    <th>Total MNPS</th>
                                    <th>Total Points</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedPlayoffTeams.map(([teamId, teamData]) => (
                                    <tr key={teamId}>
                                        <td>{teamData.teamName}</td>
                                        <td>{teamData.totalMNPS.toFixed(2)}</td>
                                        <td>{teamData.totalPoints.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <h2 className="season-header">Full Season Results</h2>
                    <div className="season-data">
                        <div className="table-wrapper">
                            <table className="season-table">
                                <thead>
                                    <tr>
                                        <th className="sticky-col">Team</th>
                                        {weekNumbers.map(week => (
                                            <th key={week}>Week {week}</th>
                                        ))}
                                        <th className="total-col">Total Points</th>
                                        <th className="total-col">Total MNPS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedTeams.map(([rosterId, teamData]) => (
                                        <tr key={rosterId}>
                                            <td className="sticky-col">{teamData.teamName}</td>
                                            {weekNumbers.map(week => {
                                                const weekData = teamData.weeklyData[week];
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
                                            <td className="total-col">
                                                {teamData.totalPoints.toFixed(2)}
                                            </td>
                                            <td className="total-col mnps-total">
                                                {teamData.totalMNPS.toFixed(2)}
                                            </td>
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
