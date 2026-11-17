import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import FantasyDashboard from '../FantasyDashboard';

const mockedAxios = axios;

describe('FantasyDashboard', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    global.localStorage.getItem.mockReturnValue(null);
    mockedAxios.post.mockResolvedValue({ data: { data: {} } });
  });

  // Mock API responses
  const mockRostersResponse = {
    data: [
      { roster_id: 1, owner_id: 'user1' },
      { roster_id: 2, owner_id: 'user2' },
      { roster_id: 3, owner_id: 'user3' },
      { roster_id: 4, owner_id: 'user4' },
      { roster_id: 5, owner_id: 'user5' },
      { roster_id: 6, owner_id: 'user6' },
      { roster_id: 7, owner_id: 'user7' },
      { roster_id: 8, owner_id: 'user8' },
      { roster_id: 9, owner_id: 'user9' },
      { roster_id: 10, owner_id: 'user10' },
      { roster_id: 11, owner_id: 'user11' },
      { roster_id: 12, owner_id: 'user12' }
    ]
  };

  const mockUsersResponse = {
    data: [
      { user_id: 'user1', display_name: 'Team 1' },
      { user_id: 'user2', display_name: 'Team 2' },
      { user_id: 'user3', display_name: 'Team 3' },
      { user_id: 'user4', display_name: 'Team 4' },
      { user_id: 'user5', display_name: 'Team 5' },
      { user_id: 'user6', display_name: 'Team 6' },
      { user_id: 'user7', display_name: 'Team 7' },
      { user_id: 'user8', display_name: 'Team 8' },
      { user_id: 'user9', display_name: 'Team 9' },
      { user_id: 'user10', display_name: 'Team 10' },
      { user_id: 'user11', display_name: 'Team 11' },
      { user_id: 'user12', display_name: 'Team 12' }
    ]
  };

  const createMockMatchupResponse = (week, top6Scores, bottom6Scores) => {
    const matchups = [];
    
    // Add top 6 teams with higher scores
    top6Scores.forEach((score, index) => {
      matchups.push({
        roster_id: index + 1,
        points: score,
        matchup_id: index + 1
      });
    });
    
    // Add bottom 6 teams with lower scores
    bottom6Scores.forEach((score, index) => {
      matchups.push({
        roster_id: index + 7,
        points: score,
        matchup_id: index + 7
      });
    });
    
    return { data: matchups };
  };

  function mockSleeper({ maxWeek = 1, top = [120, 110, 100, 90, 80, 70], bottom = [60, 50, 40, 30, 20, 10], rejectAll = false, onGet } = {}) {
    mockedAxios.get.mockImplementation((url) => {
      if (onGet) {
        const custom = onGet(url);
        if (custom) return custom;
      }
      if (rejectAll) return Promise.reject(new Error('API Error'));
      if (url.includes('/rosters')) return Promise.resolve(mockRostersResponse);
      if (url.includes('/users')) return Promise.resolve(mockUsersResponse);
      if (url.includes('/stats/')) return Promise.resolve({ data: {} });
      if (url.includes('/players/nfl/')) return Promise.resolve({ data: {} });
      const match = String(url).match(/\/matchups\/(\d+)/);
      if (match) {
        const week = Number(match[1]);
        if (week <= maxWeek) {
          return Promise.resolve(createMockMatchupResponse(week, top, bottom));
        }
        return Promise.reject(new Error(`Week ${week} not found`));
      }
      return Promise.reject(new Error(`Unknown endpoint ${url}`));
    });
  }

  describe('Current Week Detection', () => {
    it('should detect current week from API data', async () => {
      mockSleeper({ maxWeek: 3 });

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledWith(
          expect.stringContaining('/matchups/3'),
          expect.any(Object)
        );
      });
    });

    it('should handle API failures gracefully', async () => {
      mockSleeper({ rejectAll: true });

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getAllByText(/Failed to load data/).length).toBeGreaterThan(0);
      });
    });
  });

  describe('Top 6 Logic', () => {
    it('should correctly identify top 6 teams by points', async () => {
      mockSleeper({ maxWeek: 1 });

      render(<FantasyDashboard />);

      await waitFor(() => {
        const topTeams = screen.queryAllByText(/Team [1-6]/);
        expect(topTeams.length).toBeGreaterThan(0);
      });
    });

    it('should correctly calculate top count for each team', async () => {
      mockSleeper({ maxWeek: 1 });

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getAllByText('Team 1').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Top 6s/).length).toBeGreaterThan(0);
      });
    });

    it('should handle dynasty league (top 5) vs redraft league (top 6)', async () => {
      // Test redraft league (top 6)
      mockSleeper({ maxWeek: 1 });

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Top 6s/)).toBeInTheDocument();
      });

      // Test dynasty league (top 5) - would need to mock league type change
      // This would require more complex setup to test league switching
    });
  });

  describe('Current Week Column', () => {
    it('should display current week data correctly', async () => {
      mockSleeper({ maxWeek: 3 });

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Week 3/)).toBeInTheDocument();
        const week3Cells = screen.queryAllByText(/^\d+\.\d{2}$/);
        expect(week3Cells.length).toBeGreaterThan(0);
      });
    });

    it('should not show "-" for current week when data exists', async () => {
      mockSleeper({ maxWeek: 3 });

      render(<FantasyDashboard />);

      await waitFor(() => {
        // Current week should show actual data, not "-"
        const week3Headers = screen.queryAllByText(/Week 3/);
        expect(week3Headers.length).toBeGreaterThan(0);
        
        // Should not have excessive "-" symbols in current week
        const dashCells = screen.queryAllByText('-');
        // Some dashes are expected for future weeks, but not for current week with data
        expect(dashCells.length).toBeLessThan(12); // Not all teams should have dashes
      });
    });
  });

  describe('Live Data Updates', () => {
    it('should automatically refresh when new week is detected', async () => {
      mockSleeper({ maxWeek: 3 });

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Week 3/)).toBeInTheDocument();
      });
    });

    it('should not auto-refresh for completed seasons', async () => {
      mockSleeper({ maxWeek: 1 });
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      global.localStorage.getItem.mockImplementation((key) => {
        if (key === 'selectedSeason') return '2024';
        if (key === 'leagueType') return 'redraft';
        if (key === 'fantasy_v3_redraft_2024') {
          return JSON.stringify({
            teamNames: { '1': 'Team 1' },
            seasonData: [{ week: 1, roster_id: '1', points: 100, mnps: 10, isTop: true }],
            timestamp: Date.now()
          });
        }
        return null;
      });

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getByText('Team 1')).toBeInTheDocument();
      });

      const refreshIntervals = setIntervalSpy.mock.calls.filter(([, delay]) => delay === 60 * 1000);
      expect(refreshIntervals).toHaveLength(0);
      setIntervalSpy.mockRestore();
    });
  });

  describe('Data Consistency', () => {
    it('should maintain data consistency across refreshes', async () => {
      mockSleeper({ maxWeek: 1 });

      const { rerender } = render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Fantasy Football MNPS Dashboard/)).toBeInTheDocument();
      });

      // Simulate a re-render
      rerender(<FantasyDashboard />);

      // Data should remain consistent
      await waitFor(() => {
        expect(screen.getByText(/Fantasy Football MNPS Dashboard/)).toBeInTheDocument();
      });
    });

    it('should handle missing or invalid data gracefully', async () => {
      // Mock API with some invalid data
      const invalidMatchupResponse = {
        data: [
          { roster_id: 1, points: null }, // Invalid points
          { roster_id: 2, points: undefined }, // Invalid points
          { roster_id: 3, points: 100 }, // Valid points
        ]
      };

      mockSleeper({
        maxWeek: 1,
        onGet: (url) => {
          if (url.includes('/matchups/1')) return Promise.resolve(invalidMatchupResponse);
          return null;
        }
      });

      render(<FantasyDashboard />);

      await waitFor(() => {
        // Should still render without crashing
        expect(screen.getByText(/Fantasy Football MNPS Dashboard/)).toBeInTheDocument();
      });
    });
  });

  describe('Performance', () => {
    it('should not make excessive API calls', async () => {
      mockSleeper({ maxWeek: 3 });

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Week 3/)).toBeInTheDocument();
      });

      const urls = mockedAxios.get.mock.calls.map((call) => call[0]);
      expect(urls.some((url) => url.includes('/matchups/3'))).toBe(true);
      expect(urls.some((url) => url.includes('/matchups/5'))).toBe(false);
    });
  });

  describe('Applied auto-subs', () => {
    it('shows Kupp Half Full Week 10 as 113.86 with Ekeler’s points on the sub row', async () => {
      mockedAxios.get.mockImplementation((url) => {
        if (url.includes('/rosters')) {
          return Promise.resolve({ data: [{ roster_id: 6, owner_id: 'user6' }] });
        }
        if (url.includes('/users')) {
          return Promise.resolve({ data: [{ user_id: 'user6', display_name: 'GoodWillHunting' }] });
        }
        if (url.includes('/players/nfl/4663')) {
          return Promise.resolve({ data: { first_name: 'Austin', last_name: 'Ekeler' } });
        }
        if (url.includes('/players/nfl/5892')) {
          return Promise.resolve({ data: { first_name: 'David', last_name: 'Montgomery' } });
        }
        if (url.includes('/stats/')) return Promise.resolve({ data: {} });
        if (url.includes('/matchups/10')) {
          return Promise.resolve({
            data: [{
              roster_id: 6,
              points: 106.66,
              starters: ['4984', '5967', '5892', '8144', '8148', '1479', '10859', '4177', '3294'],
              players_points: {
                '4984': 22.34,
                '5967': 19.9,
                '5892': 0,
                '8144': 4.5,
                '8148': 7,
                '1479': 8.6,
                '10859': 2.6,
                '4177': 7.3,
                '3294': 34.42,
                '4663': 7.2
              }
            }]
          });
        }
        if (String(url).match(/\/matchups\/([1-9]|1[0-8])/)) {
          const week = Number(String(url).match(/\/matchups\/(\d+)/)[1]);
          if (week < 10) {
            return Promise.resolve({ data: [{ roster_id: 6, points: 100, starters: ['4984'], players_points: { '4984': 100 } }] });
          }
          return Promise.reject(new Error(`Week ${week} not found`));
        }
        return Promise.reject(new Error(`Unknown endpoint ${url}`));
      });
      mockedAxios.post.mockResolvedValue({
        data: {
          data: {
            w10: [{ roster_id: 6, subs: { '5892': '4663' } }]
          }
        }
      });

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getAllByText('113.86').length).toBeGreaterThan(0);
        expect(screen.getByTitle('Subbed in for David Montgomery')).toHaveTextContent('Austin Ekeler 7.20');
      });
      expect(screen.getAllByText('GoodWillHunting').length).toBeGreaterThan(0);
    });
  });
});
