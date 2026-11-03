import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import AgentDesk from '../AgentDesk';
import { loadSessions } from '../../utils/a2aApi';

jest.mock('../../utils/a2aApi', () => {
    const actual = jest.requireActual('../../utils/a2aApi');
    return {
        ...actual,
        loadSessions: jest.fn(() => []),
        saveSessions: jest.fn()
    };
});

const task = {
    id: 'task_1',
    contextId: 'ctx_1',
    kind: 'trade',
    status: { state: 'input-required', timestamp: '2026-11-03T00:00:00.000Z' },
    currentOffer: {
        revision: 2,
        proposedByTeamId: '2',
        proposedByTeamName: 'Waiver Wolf',
        terms: { send: ["Ja'Marr Chase"], receive: ['Justin Jefferson', '2026 3rd'] },
        summary: "Waiver Wolf gives Ja'Marr Chase and receives Justin Jefferson, 2026 3rd."
    },
    humanApproval: {
        1: { state: 'pending', at: null },
        2: { state: 'pending', at: null }
    },
    executed: false,
    execution: {
        automatic: false,
        executed: false,
        reason: 'No roster move is sent to Sleeper.'
    },
    parties: [
        { teamId: '1', teamName: 'Gridiron AI', agentId: 'agent_1', agentName: 'Gridiron Negotiator' },
        { teamId: '2', teamName: 'Waiver Wolf', agentId: 'agent_2', agentName: 'Waiver Wolf' }
    ],
    history: [
        {
            messageId: 'msg_1',
            role: 'agent',
            parts: [{ type: 'text', text: 'Jefferson for Chase?' }],
            metadata: { action: 'propose', teamName: 'Gridiron AI' }
        },
        {
            messageId: 'msg_2',
            role: 'agent',
            parts: [{ type: 'text', text: 'Chase for Jefferson and a 2026 3rd.' }],
            metadata: { action: 'counter', teamName: 'Waiver Wolf' }
        }
    ],
    metadata: { leagueId: 'league-1' }
};

const session = {
    teamId: '1',
    teamName: 'Gridiron AI',
    leagueId: 'league-1',
    agentId: 'agent_1',
    agentName: 'Gridiron Negotiator',
    ownerToken: 'owner-token-1'
};

function mockOnline() {
    axios.get.mockImplementation((url) => {
        if (String(url).endsWith('/health')) {
            return Promise.resolve({ data: { ok: true, service: 'a2a' } });
        }
        if (String(url).includes('/api/a2a/agents')) {
            return Promise.resolve({ data: { agents: [] } });
        }
        if (String(url).includes('/api/a2a/tasks/')) {
            return Promise.resolve({ data: { task } });
        }
        if (String(url).includes('/api/a2a/tasks')) {
            return Promise.resolve({ data: { tasks: [task] } });
        }
        return Promise.resolve({ data: {} });
    });
}

describe('AgentDesk', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        loadSessions.mockReturnValue([]);
    });

    test('explains that owners approve and roster moves are not sent', async () => {
        mockOnline();
        render(<AgentDesk leagueId="league-1" leagueType="redraft" teamNames={{}} />);
        expect(screen.getByText(/does not send a roster move/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /send to sleeper|execute trade/i })).not.toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText(/desk connected/i)).toBeInTheDocument();
        });
    });

    test('shows how to start the desk when it is offline', async () => {
        axios.get.mockRejectedValue(new Error('network down'));
        render(<AgentDesk leagueId="league-1" leagueType="redraft" teamNames={{}} />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/npm run a2a/i);
    });

    test('registers an agent and shows the owner token once', async () => {
        mockOnline();
        axios.post.mockResolvedValue({
            data: {
                agentToken: 'agent-token-value',
                ownerToken: 'owner-token-value',
                agent: {
                    name: 'Bench Mob Agent',
                    metadata: {
                        agentId: 'agent_4',
                        teamId: '4',
                        teamName: 'Bench Mob',
                        leagueId: 'league-1'
                    }
                }
            }
        });

        render(<AgentDesk leagueId="league-1" leagueType="redraft" teamNames={{ 4: 'Bench Mob' }} />);
        await screen.findByText(/desk connected/i);

        fireEvent.change(screen.getByLabelText('League team'), { target: { value: '4' } });
        expect(screen.getByLabelText('Team name')).toHaveValue('Bench Mob');
        fireEvent.click(screen.getByRole('button', { name: 'Connect agent' }));

        expect(await screen.findByLabelText('Issued owner token')).toHaveValue('owner-token-value');
        expect(screen.getByLabelText('Issued agent token')).toHaveValue('agent-token-value');
        expect(axios.post).toHaveBeenCalledWith(
            '/api/a2a/agents',
            expect.objectContaining({ teamId: '4', teamName: 'Bench Mob', leagueId: 'league-1' }),
            expect.any(Object)
        );
    });

    test('shows a negotiation thread and lets the owner approve it', async () => {
        loadSessions.mockReturnValue([session]);
        let current = task;
        axios.get.mockImplementation((url) => {
            if (String(url).endsWith('/health')) {
                return Promise.resolve({ data: { ok: true, service: 'a2a' } });
            }
            if (String(url).includes('/api/a2a/agents')) {
                return Promise.resolve({ data: { agents: [] } });
            }
            if (String(url).includes('/api/a2a/tasks/')) {
                return Promise.resolve({ data: { task: current } });
            }
            if (String(url).includes('/api/a2a/tasks')) {
                return Promise.resolve({ data: { tasks: [current] } });
            }
            return Promise.resolve({ data: {} });
        });
        const approved = {
            ...task,
            humanApproval: {
                1: { state: 'approved', at: '2026-11-03T00:03:00.000Z' },
                2: { state: 'pending', at: null }
            },
            history: [
                ...task.history,
                {
                    messageId: 'msg_3',
                    role: 'user',
                    parts: [{ type: 'text', text: 'Gridiron AI approved the agreement.' }],
                    metadata: { action: 'approve', teamName: 'Gridiron AI' }
                }
            ]
        };
        axios.post.mockImplementation(() => {
            current = approved;
            return Promise.resolve({ data: { task: approved } });
        });

        render(<AgentDesk leagueId="league-1" leagueType="redraft" teamNames={{}} />);
        fireEvent.click(screen.getByRole('button', { name: /inbox/i }));

        expect(await screen.findByText(/Ja'Marr Chase/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Waiver Wolf gives/i }));
        expect(await screen.findByText('Jefferson for Chase?')).toBeInTheDocument();
        expect(screen.getByText(/No roster move is sent/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /execute|send to sleeper/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Approve as Gridiron AI' }));

        await waitFor(() => {
            expect(axios.post).toHaveBeenCalledWith(
                '/api/a2a/tasks/task_1/decision',
                { decision: 'approve' },
                expect.objectContaining({
                    headers: { Authorization: 'Bearer owner-token-1' }
                })
            );
        });
        expect(await screen.findByText(/Gridiron AI: approved/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve as Gridiron AI' })).not.toBeInTheDocument();
        expect(screen.getByText(/No roster move was sent|No roster move is sent/i)).toBeInTheDocument();
    });
});
