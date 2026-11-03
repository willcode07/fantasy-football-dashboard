import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import FantasyDashboard from '../FantasyDashboard';
import {
    findSeasonTable,
    installDashboardTestEnv,
    mockDashboardStorage,
    mockSleeperApi,
    restoreDashboardNow,
    teamRow
} from '../../utils/dashboardTestSetup';

describe('Dashboard smoke', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        installDashboardTestEnv();
    });

    afterEach(() => {
        restoreDashboardNow();
    });

    test('renders standings from the loaded season', async () => {
        render(<FantasyDashboard />);

        expect(await screen.findByRole('heading', { name: /fantasy football mnps dashboard/i })).toBeInTheDocument();
        expect(await screen.findByRole('columnheader', { name: /Week 1/ })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Week 3 \(Current\)/ })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Top 6s/ })).toBeInTheDocument();
        const table = await findSeasonTable();
        expect(teamRow(table, 'Team 1')).toBeTruthy();
        expect(teamRow(table, 'Team 12')).toBeTruthy();
        expect(screen.getAllByText('120.00').length).toBeGreaterThan(0);
        expect(screen.queryByText(/Failed to load data/)).not.toBeInTheDocument();
    });

    test('shows the loading state until rosters and users arrive', async () => {
        let releaseRosters;
        const gate = new Promise((resolve) => {
            releaseRosters = resolve;
        });
        const sleeper = axios.get.getMockImplementation();
        axios.get.mockImplementation((url) => {
            if (String(url).includes('/rosters')) {
                return gate.then(() => sleeper(url));
            }
            return sleeper(url);
        });

        render(<FantasyDashboard />);

        expect(await screen.findByText(/Loading 2025 season data/)).toBeInTheDocument();
        releaseRosters();
        expect(teamRow(await findSeasonTable(), 'Team 1')).toBeTruthy();
        expect(screen.queryByText(/Loading 2025 season data/)).not.toBeInTheDocument();
    });

    test('shows an error when the season request fails', async () => {
        mockSleeperApi({ rejectAll: true });

        render(<FantasyDashboard />);

        expect((await screen.findAllByText('Failed to load data. Please try again later.')).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: /Top 6s/ })).not.toBeInTheDocument();
    });

    test('loads a completed season without starting the live refresh timer', async () => {
        mockDashboardStorage({ season: '2024' });
        mockSleeperApi({ weeksWithData: 17 });
        const interval = jest.spyOn(window, 'setInterval');

        render(<FantasyDashboard />);

        expect(await findSeasonTable()).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: /Week 14/ })).toBeInTheDocument();
        expect(screen.getByText(/Championship Playoffs/)).toBeInTheDocument();
        expect(interval.mock.calls.filter((call) => call[1] === 60 * 1000)).toHaveLength(0);
        interval.mockRestore();
    });
});
