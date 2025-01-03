// src/components/FantasyDashboard.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';

function FantasyDashboard() {
    const [leagueId, setLeagueId] = useState('1094759154738130944');
    const [seasonData, setSeasonData] = useState([]);
    const [teamNames, setTeamNames] = useState({});
    const [loading, setLoading] = useState(true);

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

    return (
        <div className="fantasy-dashboard">
            <h1>Fantasy Football MNPS Dashboard</h1>
            {loading ? (
                <p>Loading season data...</p>
            ) : (
                <div className="season-data">
                    <table>
                        <thead>
                            <tr>
                                <th>Week</th>
                                <th>Team</th>
                                <th>Points</th>
                                <th>MNPS</th>
                                <th>Running Total</th>
                                <th>Top 6?</th>
                            </tr>
                        </thead>
                        <tbody>
                            {seasonData.map((entry) => (
                                <tr key={`${entry.week}-${entry.roster_id}`}>
                                    <td>{entry.week}</td>
                                    <td>{teamNames[entry.roster_id] || `Team ${entry.roster_id}`}</td>
                                    <td>{entry.points.toFixed(2)}</td>
                                    <td>{entry.mnps.toFixed(2)}</td>
                                    <td>
                                        {seasonData
                                            .filter(e => e.roster_id === entry.roster_id && e.week <= entry.week)
                                            .reduce((sum, e) => sum + e.mnps, 0)
                                            .toFixed(2)}
                                    </td>
                                    <td>{entry.isTop6 ? '✅' : '❌'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default FantasyDashboard;
