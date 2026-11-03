import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import FantasyDashboard from '../FantasyDashboard';
import {
    createMockMatchupData,
    validateTop6Logic
} from '../../utils/testHelpers';
import {
    findSeasonTable,
    installDashboardTestEnv,
    mockDashboardStorage,
    mockSleeperApi,
    restoreDashboardNow,
    teamRow
} from '../../utils/dashboardTestSetup';

const mockedAxios = axios;

function markTopFinishes(matchups, topCount) {
    const sorted = [...matchups].sort((a, b) => b.points - a.points);
    const topIds = new Set(sorted.slice(0, topCount).map((team) => team.roster_id));
    return matchups.map((team) => ({ ...team, isTop: topIds.has(team.roster_id) }));
}

describe('Live Data Integration Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        installDashboardTestEnv();
    });

    afterEach(() => {
        restoreDashboardNow();
    });

    describe('Week Progression Simulation', () => {
        it('should handle week progression from 1 to 3 automatically', async () => {
            mockSleeperApi({
                weeksWithData: 3,
                matchupForWeek: (week) => createMockMatchupData(
                    week,
                    [120 - week, 110, 100, 90, 80, 70],
                    [60, 50, 40, 30, 20, 10]
                )
            });

            render(<FantasyDashboard />);

            expect(await screen.findByText(/Fantasy Football MNPS Dashboard/)).toBeInTheDocument();
            expect(await screen.findByText(/Week 3 \(Current\)/)).toBeInTheDocument();
            expect(screen.getByText(/Week 1/)).toBeInTheDocument();
            expect(screen.getByText(/Week 2/)).toBeInTheDocument();
        });

        it('should correctly calculate cumulative top counts across multiple weeks', async () => {
            mockSleeperApi({
                weeksWithData: 3,
                matchupForWeek: (week) => createMockMatchupData(
                    week,
                    [130, 120, 110, 100, 90, 80],
                    [70, 60, 50, 40, 30, 20]
                )
            });

            render(<FantasyDashboard />);

            const table = await findSeasonTable();
            expect(screen.getByText(/Top 6s/)).toBeInTheDocument();
            expect(within(teamRow(table, 'Team 1')).getByText('3')).toBeInTheDocument();
            expect(within(teamRow(table, 'Team 7')).getByText('0')).toBeInTheDocument();
        });
    });

    describe('Real-time Data Validation', () => {
        it('should validate top 6 logic with realistic data', () => {
            const realisticScores = [
                145.2, 132.8, 128.5, 121.7, 118.3, 115.9,
                98.4, 94.1, 89.7, 85.2, 82.6, 78.3
            ];
            const matchupData = createMockMatchupData(1, realisticScores.slice(0, 6), realisticScores.slice(6));
            const marked = markTopFinishes(matchupData.data, 6);
            const validation = validateTop6Logic(marked, false);

            expect(validation.isValid).toBe(true);
            expect(validation.errors).toHaveLength(0);
            expect(validation.actualTopTeams).toHaveLength(6);
        });

        it('should handle edge cases in score distribution', () => {
            const tiedScores = [100, 100, 100, 95, 95, 95, 90, 90, 90, 85, 85, 85];
            const matchupData = createMockMatchupData(1, tiedScores.slice(0, 6), tiedScores.slice(6));
            const marked = markTopFinishes(matchupData.data, 6);
            const validation = validateTop6Logic(marked, false);

            expect(validation.isValid).toBe(true);
            expect(validation.actualTopTeams).toEqual([1, 2, 3, 4, 5, 6]);
        });

        it('should handle very low scores', () => {
            const lowScores = [45, 42, 38, 35, 32, 28, 25, 22, 18, 15, 12, 8];
            const matchupData = createMockMatchupData(1, lowScores.slice(0, 6), lowScores.slice(6));
            const marked = markTopFinishes(matchupData.data, 6);
            const validation = validateTop6Logic(marked, false);

            expect(validation.isValid).toBe(true);
            expect(validation.actualTopTeams).toEqual([1, 2, 3, 4, 5, 6]);
        });
    });

    describe('Data Consistency Across Refreshes', () => {
        it('should maintain consistent data when refreshed multiple times', async () => {
            const { rerender } = render(<FantasyDashboard />);

            expect(teamRow(await findSeasonTable(), 'Team 1')).toBeTruthy();

            for (let i = 0; i < 3; i += 1) {
                rerender(<FantasyDashboard />);
                expect(teamRow(await findSeasonTable(), 'Team 1')).toBeTruthy();
            }

            expect(mockedAxios.get).toHaveBeenCalled();
            expect(screen.getByText(/Week 3 \(Current\)/)).toBeInTheDocument();
        });

        it('should handle API failures gracefully during refresh', async () => {
            mockSleeperApi({ rejectAll: true });

            render(<FantasyDashboard />);

            expect(await screen.findByText(/Fantasy Football MNPS Dashboard/)).toBeInTheDocument();
            expect((await screen.findAllByText(/Failed to load data/)).length).toBeGreaterThan(0);
        });
    });

    describe('Performance and Efficiency', () => {
        it('should not make unnecessary API calls', async () => {
            render(<FantasyDashboard />);

            expect(await findSeasonTable()).toBeTruthy();

            const urls = mockedAxios.get.mock.calls.map((call) => String(call[0]));
            urls.forEach((url) => {
                expect(url).toMatch(/api\.sleeper\.app\/v1\/league\/.+\/(rosters|users|matchups\/\d+)/);
            });
            const weeks = urls
                .map((url) => url.match(/\/matchups\/(\d+)/))
                .filter(Boolean)
                .map((match) => Number(match[1]));
            expect(Math.max(...weeks)).toBeLessThanOrEqual(4);
            expect(weeks).toContain(1);
        });

        it('should cache data appropriately', async () => {
            render(<FantasyDashboard />);

            expect(await findSeasonTable()).toBeTruthy();
            await waitFor(() => {
                expect(localStorage.setItem).toHaveBeenCalled();
            });

            const cacheKey = localStorage.setItem.mock.calls.map((call) => call[0])
                .find((key) => String(key).startsWith('fantasy_'));
            expect(cacheKey).toMatch(/^fantasy_(redraft|dynasty)_\d{4}$/);
        });
    });

    describe('Dynasty vs Redraft Logic', () => {
        it('should correctly handle dynasty league (top 5) logic', async () => {
            mockDashboardStorage({ leagueType: 'dynasty' });

            render(<FantasyDashboard />);

            expect(await screen.findByText(/Fantasy Football MNPS Dashboard/)).toBeInTheDocument();
            expect(await screen.findByText(/Top 5s/)).toBeInTheDocument();
            expect(screen.queryByText(/Top 6s/)).not.toBeInTheDocument();
        });

        it('should correctly handle redraft league (top 6) logic', async () => {
            render(<FantasyDashboard />);

            expect(await screen.findByText(/Fantasy Football MNPS Dashboard/)).toBeInTheDocument();
            expect(await screen.findByText(/Top 6s/)).toBeInTheDocument();
        });
    });
});
