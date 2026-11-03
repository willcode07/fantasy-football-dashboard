import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import FantasyDashboard from '../FantasyDashboard';
import { createMockMatchupData } from '../../utils/testHelpers';
import {
    findSeasonTable,
    installDashboardTestEnv,
    mockDashboardStorage,
    mockSleeperApi,
    restoreDashboardNow,
    teamRow
} from '../../utils/dashboardTestSetup';

const mockedAxios = axios;

const top6Scores = [120, 110, 100, 90, 80, 70];
const bottom6Scores = [60, 50, 40, 30, 20, 10];

function matchupForWeek(week) {
    return createMockMatchupData(week, top6Scores, bottom6Scores);
}

describe('FantasyDashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        installDashboardTestEnv({
            sleeper: { weeksWithData: 3, matchupForWeek }
        });
    });

    afterEach(() => {
        restoreDashboardNow();
    });

    describe('Current Week Detection', () => {
        it('should detect current week from API data', async () => {
            render(<FantasyDashboard />);

            await waitFor(() => {
                expect(mockedAxios.get).toHaveBeenCalledWith(
                    expect.stringContaining('/matchups/3'),
                    expect.any(Object)
                );
            });
            const urls = mockedAxios.get.mock.calls.map((call) => call[0]);
            expect(urls.some((url) => String(url).includes('/matchups/4'))).toBe(true);
            expect(await screen.findByText(/Week 3 \(Current\)/)).toBeInTheDocument();
        });

        it('should handle API failures gracefully', async () => {
            mockSleeperApi({ rejectAll: true });

            render(<FantasyDashboard />);

            // A rejected week probe stops the scan and returns week 1. The season
            // fetch is what surfaces the failure, as the error banner.
            expect((await screen.findAllByText(/Failed to load data/)).length).toBeGreaterThan(0);
            expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
        });
    });

    describe('Top 6 Logic', () => {
        it('should correctly identify top 6 teams by points', async () => {
            render(<FantasyDashboard />);

            const table = await findSeasonTable();
            const leader = within(teamRow(table, 'Team 1')).getAllByRole('cell');
            const last = within(teamRow(table, 'Team 12')).getAllByRole('cell');
            expect(leader[1]).toHaveClass('top-6');
            expect(last[1]).not.toHaveClass('top-6');
            expect(within(table).getByText('Team 6')).toBeInTheDocument();
        });

        it('should correctly calculate top count for each team', async () => {
            render(<FantasyDashboard />);

            const table = await findSeasonTable();
            expect(within(teamRow(table, 'Team 1')).getByText('3')).toBeInTheDocument();
            expect(within(teamRow(table, 'Team 12')).getByText('0')).toBeInTheDocument();
        });

        it('should handle dynasty league (top 5) vs redraft league (top 6)', async () => {
            const view = render(<FantasyDashboard />);

            expect(await screen.findByText(/Top 6s/)).toBeInTheDocument();
            view.unmount();

            mockDashboardStorage({ leagueType: 'dynasty' });
            render(<FantasyDashboard />);

            const table = await findSeasonTable();
            expect(screen.getByText(/Top 5s/)).toBeInTheDocument();
            expect(within(teamRow(table, 'Team 5')).getByText('3')).toBeInTheDocument();
            expect(within(teamRow(table, 'Team 6')).getByText('0')).toBeInTheDocument();
        });
    });

    describe('Current Week Column', () => {
        it('should display current week data correctly', async () => {
            render(<FantasyDashboard />);

            expect(await screen.findByText(/Week 3 \(Current\)/)).toBeInTheDocument();
            const week3Cells = screen.getAllByText('120.00');
            expect(week3Cells.length).toBeGreaterThan(0);
        });

        it('should not show "-" for current week when data exists', async () => {
            render(<FantasyDashboard />);

            const table = await findSeasonTable();
            const headers = within(table).getAllByRole('columnheader');
            const currentHeader = within(table).getByRole('columnheader', { name: /Week 3/ });
            const cell = within(teamRow(table, 'Team 1')).getAllByRole('cell')[headers.indexOf(currentHeader)];
            expect(cell).toHaveTextContent('120.00');
            expect(cell).not.toHaveTextContent(/^-$/);
        });
    });

    describe('Live Data Updates', () => {
        it('should automatically refresh when new week is detected', async () => {
            const interval = jest.spyOn(window, 'setInterval');
            render(<FantasyDashboard />);

            expect(await screen.findByText(/Week 3 \(Current\)/)).toBeInTheDocument();
            expect(interval).toHaveBeenCalledWith(expect.any(Function), 60 * 1000);
            interval.mockRestore();
        });

        it('should not auto-refresh for completed seasons', async () => {
            mockDashboardStorage({ season: '2024' });
            mockSleeperApi({ weeksWithData: 17, matchupForWeek });
            const interval = jest.spyOn(window, 'setInterval');

            render(<FantasyDashboard />);

            expect(await findSeasonTable()).toBeTruthy();
            expect(screen.getByRole('combobox', { name: /select season/i })).toHaveValue('2024');
            const minuteTimers = interval.mock.calls.filter((call) => call[1] === 60 * 1000);
            expect(minuteTimers).toHaveLength(0);
            interval.mockRestore();
        });
    });

    describe('Data Consistency', () => {
        it('should maintain data consistency across refreshes', async () => {
            const { rerender } = render(<FantasyDashboard />);

            const table = await findSeasonTable();
            expect(teamRow(table, 'Team 1')).toBeTruthy();

            rerender(<FantasyDashboard />);

            const again = await findSeasonTable();
            expect(teamRow(again, 'Team 1')).toBeTruthy();
            expect(screen.getByText(/Week 3 \(Current\)/)).toBeInTheDocument();
        });

        it('should handle missing or invalid data gracefully', async () => {
            mockSleeperApi({
                weeksWithData: 1,
                matchupForWeek: () => ({
                    data: [
                        { roster_id: 1, points: null },
                        { roster_id: 2, points: undefined },
                        { roster_id: 3, points: 100 }
                    ]
                })
            });

            render(<FantasyDashboard />);

            const table = await findSeasonTable();
            expect(teamRow(table, 'Team 1')).toBeTruthy();
            expect(screen.queryByText(/Failed to load data/)).not.toBeInTheDocument();
        });
    });

    describe('Performance', () => {
        it('should not make excessive API calls', async () => {
            render(<FantasyDashboard />);

            expect(await screen.findByText(/Week 3 \(Current\)/)).toBeInTheDocument();
            const urls = mockedAxios.get.mock.calls.map((call) => String(call[0]));
            expect(urls.some((url) => url.includes('/rosters'))).toBe(true);
            expect(urls.some((url) => url.includes('/users'))).toBe(true);
            expect(urls.some((url) => url.includes('/matchups/3'))).toBe(true);
            // A live 2026 season stops at the current week. It does not walk the full slate.
            expect(urls.some((url) => url.includes('/matchups/17'))).toBe(false);
            expect(mockedAxios.get.mock.calls.length).toBeLessThanOrEqual(20);
        });
    });
});
