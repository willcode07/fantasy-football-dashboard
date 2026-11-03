// Shared setup for dashboard tests.
// The app treats the calendar year as the live season and probes Sleeper week by
// week before it loads rosters. These helpers keep that behavior deterministic:
// the clock stays on 15 Oct 2025, and axios answers by URL instead of call order.

import { screen, within } from '@testing-library/react';
import axios from 'axios';
import { createMockMatchupData, createMockRosterData, createMockUserData } from './testHelpers';

const RealDate = Date;
export const DASHBOARD_NOW = new RealDate('2025-10-15T16:00:00.000Z');

export const defaultRosters = createMockRosterData();
export const defaultUsers = createMockUserData();

export function pinDashboardNow(when = DASHBOARD_NOW) {
    const fixed = when.getTime();
    function MockDate(...args) {
        if (args.length === 0) return new RealDate(fixed);
        return new RealDate(...args);
    }
    MockDate.now = () => fixed;
    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    MockDate.prototype = RealDate.prototype;
    global.Date = MockDate;
}

export function restoreDashboardNow() {
    global.Date = RealDate;
}

export function mockDashboardStorage({ season = '2025', leagueType = 'redraft', cache = null } = {}) {
    const cacheKey = `fantasy_${leagueType}_${season}`;
    localStorage.getItem.mockImplementation((key) => {
        if (key === 'selectedSeason') return season;
        if (key === 'leagueType') return leagueType;
        if (key === cacheKey) return cache;
        return null;
    });
}

export function mockSleeperApi({
    rosters = defaultRosters,
    users = defaultUsers,
    weeksWithData = 3,
    matchupForWeek = (week) => createMockMatchupData(
        week,
        [120, 110, 100, 90, 80, 70],
        [60, 50, 40, 30, 20, 10]
    ),
    rejectAll = false
} = {}) {
    axios.get.mockImplementation((url) => {
        const target = String(url);
        if (rejectAll) return Promise.reject(new Error('API Error'));
        if (target.includes('/rosters')) return Promise.resolve(rosters);
        if (target.includes('/users')) return Promise.resolve(users);
        const weekMatch = target.match(/\/matchups\/(\d+)/);
        if (weekMatch) {
            const week = Number(weekMatch[1]);
            if (week > weeksWithData) {
                return Promise.reject(new Error(`Week ${week} not found`));
            }
            return Promise.resolve(matchupForWeek(week));
        }
        return Promise.reject(new Error(`Unexpected Sleeper URL ${target}`));
    });
}

export function installDashboardTestEnv(options) {
    pinDashboardNow();
    mockDashboardStorage(options && options.storage);
    mockSleeperApi(options && options.sleeper);
}

export async function findSeasonTable() {
    await screen.findByRole('heading', { name: /Regular Season Results/ });
    const tables = screen.getAllByRole('table');
    const season = tables.find((table) => within(table).queryByRole('columnheader', { name: /Top [56]s/ }));
    if (!season) throw new Error('Regular season table did not render');
    return season;
}

export function teamRow(table, name) {
    const row = within(table).getAllByRole('row').find((candidate) => within(candidate).queryByText(name));
    if (!row) throw new Error(`No standings row for ${name}`);
    return row;
}
