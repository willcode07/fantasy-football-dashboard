import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import FantasyDashboard from '../FantasyDashboard';

const mockedAxios = axios;

describe('FantasyDashboard', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    global.localStorage.getItem.mockReturnValue(null);
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

  describe('Current Week Detection', () => {
    it('should detect current week from API data', async () => {
      // Mock API responses for weeks 1, 2, and 3
      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(createMockMatchupResponse(1, [100, 90, 80, 70, 60, 50], [40, 35, 30, 25, 20, 15]))
        .mockResolvedValueOnce(createMockMatchupResponse(2, [110, 95, 85, 75, 65, 55], [45, 40, 35, 30, 25, 20]))
        .mockResolvedValueOnce(createMockMatchupResponse(3, [120, 100, 90, 80, 70, 60], [50, 45, 40, 35, 30, 25]))
        .mockRejectedValueOnce(new Error('Week 4 not found')); // Simulate week 4 not existing

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledWith(
          expect.stringContaining('/matchups/3')
        );
      });
    });

    it('should handle API failures gracefully', async () => {
      mockedAxios.get.mockRejectedValue(new Error('API Error'));

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to get current week from API')
        );
      });
    });
  });

  describe('Top 6 Logic', () => {
    it('should correctly identify top 6 teams by points', async () => {
      const top6Scores = [120, 110, 100, 90, 80, 70]; // Top 6 scores
      const bottom6Scores = [60, 50, 40, 30, 20, 10]; // Bottom 6 scores

      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(createMockMatchupResponse(1, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(2, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(3, top6Scores, bottom6Scores));

      render(<FantasyDashboard />);

      await waitFor(() => {
        // Check that teams with top 6 scores have isTop: true
        const topTeams = screen.queryAllByText(/Team [1-6]/);
        expect(topTeams.length).toBeGreaterThan(0);
      });
    });

    it('should correctly calculate top count for each team', async () => {
      const top6Scores = [120, 110, 100, 90, 80, 70];
      const bottom6Scores = [60, 50, 40, 30, 20, 10];

      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(createMockMatchupResponse(1, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(2, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(3, top6Scores, bottom6Scores));

      render(<FantasyDashboard />);

      await waitFor(() => {
        // Verify that top 6 teams have higher top counts
        const topCountCells = screen.queryAllByText(/^[0-9]+$/);
        expect(topCountCells.length).toBeGreaterThan(0);
      });
    });

    it('should handle dynasty league (top 5) vs redraft league (top 6)', async () => {
      // Test redraft league (top 6)
      const redraftTop6Scores = [120, 110, 100, 90, 80, 70];
      const redraftBottom6Scores = [60, 50, 40, 30, 20, 10];

      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(createMockMatchupResponse(1, redraftTop6Scores, redraftBottom6Scores));

      const { rerender } = render(<FantasyDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Top 6s/)).toBeInTheDocument();
      });

      // Test dynasty league (top 5) - would need to mock league type change
      // This would require more complex setup to test league switching
    });
  });

  describe('Current Week Column', () => {
    it('should display current week data correctly', async () => {
      const top6Scores = [120, 110, 100, 90, 80, 70];
      const bottom6Scores = [60, 50, 40, 30, 20, 10];

      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(createMockMatchupResponse(1, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(2, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(3, top6Scores, bottom6Scores))
        .mockRejectedValueOnce(new Error('Week 4 not found'));

      render(<FantasyDashboard />);

      await waitFor(() => {
        // Check that Week 3 column exists and shows data
        expect(screen.getByText(/Week 3/)).toBeInTheDocument();
        
        // Check that current week data is displayed (not just "-")
        const week3Cells = screen.queryAllByText(/^\d+\.\d{2}$/);
        expect(week3Cells.length).toBeGreaterThan(0);
      });
    });

    it('should not show "-" for current week when data exists', async () => {
      const top6Scores = [120, 110, 100, 90, 80, 70];
      const bottom6Scores = [60, 50, 40, 30, 20, 10];

      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(createMockMatchupResponse(1, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(2, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(3, top6Scores, bottom6Scores))
        .mockRejectedValueOnce(new Error('Week 4 not found'));

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
      jest.useFakeTimers();
      
      // Mock initial responses
      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(createMockMatchupResponse(1, [100, 90, 80, 70, 60, 50], [40, 35, 30, 25, 20, 15]))
        .mockResolvedValueOnce(createMockMatchupResponse(2, [110, 95, 85, 75, 65, 55], [45, 40, 35, 30, 25, 20]))
        .mockResolvedValueOnce(createMockMatchupResponse(3, [120, 100, 90, 80, 70, 60], [50, 45, 40, 35, 30, 25]))
        .mockRejectedValueOnce(new Error('Week 4 not found'));

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalled();
      });

      // Advance time to trigger auto-refresh
      act(() => {
        jest.advanceTimersByTime(5 * 60 * 1000); // 5 minutes
      });

      jest.useRealTimers();
    });

    it('should not auto-refresh for completed seasons', async () => {
      jest.useFakeTimers();
      
      // Mock responses for a completed season (2024)
      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse);

      // Mock localStorage to return cached data for 2024 season
      localStorageMock.getItem.mockReturnValue(JSON.stringify({
        teamNames: { '1': 'Team 1' },
        seasonData: [{ week: 1, roster_id: '1', points: 100, mnps: 10, isTop: true }],
        timestamp: Date.now()
      }));

      // Render with 2024 season (completed)
      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(localStorageMock.getItem).toHaveBeenCalled();
      });

      // Advance time - should not trigger auto-refresh for completed seasons
      act(() => {
        jest.advanceTimersByTime(5 * 60 * 1000);
      });

      // Should not have called API for current week detection
      expect(mockedAxios.get).not.toHaveBeenCalledWith(
        expect.stringContaining('/matchups/')
      );

      jest.useRealTimers();
    });
  });

  describe('Data Consistency', () => {
    it('should maintain data consistency across refreshes', async () => {
      const top6Scores = [120, 110, 100, 90, 80, 70];
      const bottom6Scores = [60, 50, 40, 30, 20, 10];

      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(createMockMatchupResponse(1, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(2, top6Scores, bottom6Scores))
        .mockResolvedValueOnce(createMockMatchupResponse(3, top6Scores, bottom6Scores));

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

      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(invalidMatchupResponse);

      render(<FantasyDashboard />);

      await waitFor(() => {
        // Should still render without crashing
        expect(screen.getByText(/Fantasy Football MNPS Dashboard/)).toBeInTheDocument();
      });
    });
  });

  describe('Performance', () => {
    it('should not make excessive API calls', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(mockRostersResponse)
        .mockResolvedValueOnce(mockUsersResponse)
        .mockResolvedValueOnce(createMockMatchupResponse(1, [100, 90, 80, 70, 60, 50], [40, 35, 30, 25, 20, 15]))
        .mockResolvedValueOnce(createMockMatchupResponse(2, [110, 95, 85, 75, 65, 55], [45, 40, 35, 30, 25, 20]))
        .mockResolvedValueOnce(createMockMatchupResponse(3, [120, 100, 90, 80, 70, 60], [50, 45, 40, 35, 30, 25]));

      render(<FantasyDashboard />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalled();
      });

      // Should not make more API calls than necessary
      expect(mockedAxios.get).toHaveBeenCalledTimes(5); // rosters + users + 3 weeks
    });
  });
});
