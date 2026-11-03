import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import AgentDesk from '../AgentDesk';
import { loadSessions, saveSessions } from '../../utils/a2aApi';

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

    test('files a claim and shows the claim token once', async () => {
        mockOnline();
        axios.post.mockResolvedValue({
            data: {
                status: 'pending',
                claimToken: 'claim-token-value',
                claim: {
                    id: 'claim_4',
                    status: 'pending',
                    purpose: 'register',
                    teamId: '4',
                    teamName: 'Bench Mob',
                    leagueId: 'league-1',
                    agentName: 'Bench Mob Agent'
                }
            }
        });

        render(<AgentDesk leagueId="league-1" leagueType="redraft" teamNames={{ 4: 'Bench Mob' }} />);
        await screen.findByText(/desk connected/i);

        expect(screen.queryByLabelText('Sleeper user id')).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('League team'), { target: { value: '4' } });
        fireEvent.change(screen.getByLabelText('League code'), { target: { value: 'league-secret' } });
        expect(screen.getByLabelText('League code')).toHaveValue('league-secret');
        expect(screen.getByLabelText('Team name')).toHaveValue('Bench Mob');
        fireEvent.click(screen.getByRole('button', { name: 'Connect agent' }));

        expect(await screen.findByLabelText('Issued claim token')).toHaveValue('claim-token-value');
        expect(screen.getByLabelText('Issued claim id')).toHaveValue('claim_4');
        expect(screen.queryByLabelText('Issued owner token')).not.toBeInTheDocument();
        expect(axios.post).toHaveBeenCalledWith(
            '/api/a2a/agents',
            expect.objectContaining({
                teamId: '4',
                teamName: 'Bench Mob',
                leagueId: 'league-1'
            }),
            expect.objectContaining({
                headers: { 'X-League-Code': 'league-secret' }
            })
        );
        expect(axios.post.mock.calls[0][1].sleeperOwnerId).toBeUndefined();
        expect(saveSessions).not.toHaveBeenCalled();
    });

    test('keeps an owner token in memory for replacement and leaves it out of storage', async () => {
        loadSessions.mockReturnValue([{
            ...session,
            teamId: '4',
            teamName: 'Bench Mob',
            agentId: 'agent_4',
            ownerToken: 'owner-token-1'
        }]);
        axios.get.mockImplementation((url) => {
            const target = String(url);
            if (target.endsWith('/health')) {
                return Promise.resolve({ data: { ok: true, service: 'a2a' } });
            }
            if (target.includes('/api/a2a/me')) {
                return Promise.resolve({
                    data: {
                        role: 'owner',
                        teamId: '4',
                        teamName: 'Bench Mob',
                        leagueId: 'league-1',
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
            }
            if (target.includes('/api/a2a/agents')) {
                return Promise.resolve({ data: { agents: [] } });
            }
            if (target.includes('/api/a2a/tasks')) {
                return Promise.resolve({ data: { tasks: [] } });
            }
            return Promise.resolve({ data: {} });
        });
        axios.post.mockResolvedValue({
            data: {
                agentToken: 'replacement-agent-token',
                ownerToken: null,
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
        fireEvent.change(screen.getByLabelText('Owner token'), { target: { value: 'owner-token-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Claim team' }));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Inbox/ })).toHaveClass('active'));
        expect(saveSessions.mock.calls.at(-1)[0][0].ownerToken).toBeUndefined();

        fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }));
        fireEvent.change(screen.getByLabelText('League team'), { target: { value: '4' } });
        fireEvent.change(screen.getByLabelText('Registration action'), { target: { value: 'replace' } });
        fireEvent.change(screen.getByLabelText('League code'), { target: { value: 'sesame' } });
        fireEvent.click(screen.getByRole('button', { name: 'Connect agent' }));

        expect(await screen.findByLabelText('Issued agent token')).toHaveValue('replacement-agent-token');
        expect(screen.queryByLabelText('Issued owner token')).not.toBeInTheDocument();
        expect(screen.getByText(/owner token in this tab still approves/i)).toBeInTheDocument();
        expect(axios.post).toHaveBeenCalledWith(
            '/api/a2a/agents',
            expect.objectContaining({ teamId: '4', leagueId: 'league-1' }),
            expect.objectContaining({
                headers: {
                    Authorization: 'Bearer owner-token-1',
                    'X-League-Code': 'sesame'
                }
            })
        );
        saveSessions.mock.calls.forEach((call) => {
            expect(JSON.stringify(call[0]).includes('owner-token-1')).toBe(false);
        });
    });

    test('shows a negotiation thread and lets the owner approve it', async () => {
        loadSessions.mockReturnValue([session]);
        let current = task;
        axios.get.mockImplementation((url) => {
            if (String(url).endsWith('/health')) {
                return Promise.resolve({ data: { ok: true, service: 'a2a' } });
            }
            if (String(url).includes('/api/a2a/me')) {
                return Promise.resolve({
                    data: {
                        role: 'owner',
                        teamId: '1',
                        teamName: 'Gridiron AI',
                        leagueId: 'league-1',
                        agent: {
                            name: 'Gridiron Negotiator',
                            metadata: {
                                agentId: 'agent_1',
                                teamId: '1',
                                teamName: 'Gridiron AI',
                                leagueId: 'league-1'
                            }
                        }
                    }
                });
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
        await screen.findByText(/desk connected/i);
        fireEvent.change(screen.getByLabelText('Owner token'), { target: { value: 'owner-token-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Claim team' }));
        await waitFor(() => expect(saveSessions).toHaveBeenCalled());
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

    test('a commissioner approves a claim and the owner token is shown once', async () => {
        mockOnline();
        axios.get.mockImplementation((url) => {
            const target = String(url);
            if (target.endsWith('/health')) {
                return Promise.resolve({ data: { ok: true, service: 'a2a' } });
            }
            if (target.includes('/api/a2a/claims/claim_9')) {
                return Promise.resolve({
                    data: {
                        status: 'approved',
                        ownerToken: 'fresh-owner-token',
                        agentToken: 'fresh-agent-token',
                        agent: {
                            name: 'Bench Mob Agent',
                            metadata: {
                                agentId: 'agent_9',
                                teamId: '9',
                                teamName: 'Bench Mob',
                                leagueId: 'league-1'
                            }
                        }
                    }
                });
            }
            if (target.includes('/api/a2a/claims')) {
                return Promise.resolve({
                    data: {
                        claims: [{
                            id: 'claim_9',
                            purpose: 'register',
                            teamName: 'Bench Mob',
                            agentName: 'Bench Mob Agent',
                            rosterOwnerId: 'public-owner'
                        }]
                    }
                });
            }
            if (target.includes('/api/a2a/agents')) {
                return Promise.resolve({ data: { agents: [] } });
            }
            if (target.includes('/api/a2a/tasks')) {
                return Promise.resolve({ data: { tasks: [] } });
            }
            return Promise.resolve({ data: {} });
        });
        axios.post.mockResolvedValue({ data: { claim: { id: 'claim_9', status: 'approved' } } });

        render(<AgentDesk leagueId="league-1" leagueType="redraft" teamNames={{}} />);
        await screen.findByText(/desk connected/i);
        expect(screen.getByText(/not proof of ownership/i)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Commissioner code'), { target: { value: 'commissioner-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh pending claims' }));
        expect(await screen.findByText(/Public Sleeper owner id: public-owner/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Approve Bench Mob' }));
        await waitFor(() => {
            expect(axios.post).toHaveBeenCalledWith(
                '/api/a2a/claims/claim_9/decision',
                { decision: 'approve' },
                expect.objectContaining({
                    headers: { 'X-Commissioner-Code': 'commissioner-secret' }
                })
            );
        });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Check claim' })).toBeEnabled());

        fireEvent.change(screen.getByLabelText('Claim id'), { target: { value: 'claim_9' } });
        fireEvent.change(screen.getByLabelText('Claim token'), { target: { value: 'pickup-token' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check claim' }));
        expect(await screen.findByLabelText('Issued owner token')).toHaveValue('fresh-owner-token');
        expect(screen.getByLabelText('Issued agent token')).toHaveValue('fresh-agent-token');
        await waitFor(() => expect(saveSessions).toHaveBeenCalled());
        saveSessions.mock.calls.forEach((call) => {
            expect(JSON.stringify(call[0]).includes('fresh-owner-token')).toBe(false);
        });
    });
});

describe('owner token storage', () => {
    test('load and save drop any owner token', () => {
        const actual = jest.requireActual('../../utils/a2aApi');
        const memory = {};
        localStorage.getItem.mockImplementation((key) => (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null));
        localStorage.setItem.mockImplementation((key, value) => {
            memory[key] = String(value);
        });
        actual.saveSessions([{ teamId: '1', ownerToken: 'secret-owner', agentToken: 'agent-token' }]);
        const stored = JSON.parse(memory[actual.SESSION_KEY]);
        expect(stored[0].ownerToken).toBeUndefined();
        expect(stored[0].agentToken).toBe('agent-token');
        memory[actual.SESSION_KEY] = JSON.stringify([{ teamId: '1', ownerToken: 'leftover' }]);
        expect(actual.loadSessions()[0].ownerToken).toBeUndefined();
        expect(actual.loadSessions()[0].teamId).toBe('1');
        localStorage.getItem.mockReset();
        localStorage.setItem.mockReset();
    });
});
