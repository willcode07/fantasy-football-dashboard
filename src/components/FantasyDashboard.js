// src/components/FantasyDashboard.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';

function FantasyDashboard() {
    const [leagueId, setLeagueId] = useState('your_league_id_here');
    const [week, setWeek] = useState(1);
    const [mnpsResults, setMnpsResults] = useState([]);

    useEffect(() => {
        // Fetch matchups and calculate MNPS here
        const fetchMatchups = async () => {
            try {
                const response = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
                const matchups = response.data;

                // Process matchups to calculate MNPS
                const teamScores = matchups.map((matchup) => ({
                    roster_id: matchup.roster_id,
                    points: matchup.points,
                }));

                // Sort and calculate MNPS
                const sortedScores = [...teamScores].sort((a, b) => b.points - a.points);
                const top6Ids = sortedScores.slice(0, 6).map((team) => team.roster_id);
                
                const results = teamScores.map(({ roster_id, points }) => {
                    const isTop6 = top6Ids.includes(roster_id);
                    const mnps = isTop6 ? (1 * 5) + (points * 0.0653) : (points * 0.0653);
                    return { roster_id, points, mnps, isTop6 };
                });

                setMnpsResults(results);
            } catch (error) {
                console.error('Error fetching matchups:', error);
            }
        };

        fetchMatchups();
    }, [leagueId, week]);

    return (
        <div className="dashboard">
            <h1>Fantasy Football Dashboard</h1>
            <div className="standings-section">
                <h2>League Standings</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Team ID</th>
                            <th>Points</th>
                            <th>MNPS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mnpsResults.map(({ roster_id, points, mnps }) => (
                            <tr key={roster_id}>
                                <td>{roster_id}</td>
                                <td>{points.toFixed(2)}</td>
                                <td>{mnps.toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="top6-section">
                <h2>Current Week Top 6</h2>
                <ul>
                    {mnpsResults
                        .filter((team) => team.isTop6)
                        .map(({ roster_id, mnps }) => (
                            <li key={roster_id}>
                                Team {roster_id}: MNPS = {mnps.toFixed(2)}
                            </li>
                        ))}
                </ul>
            </div>
        </div>
    );
}

export default FantasyDashboard;
