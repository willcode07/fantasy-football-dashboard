import React, { useEffect, useRef, useState } from 'react';
import './AgentDesk.css';
import {
    decideTask,
    getHealth,
    getMe,
    getTask,
    listAgents,
    listTasks,
    loadSessions,
    registerAgent,
    revokeAgent,
    rotateOwnerToken,
    saveSessions
} from '../utils/a2aApi';

const KIND_LABELS = {
    trade: 'Trade',
    waiver_priority: 'Waiver priority',
    faab: 'FAAB'
};

const STATUS_LABELS = {
    submitted: 'Proposed',
    working: 'Negotiating',
    'input-required': 'Needs owners',
    completed: 'Approved',
    rejected: 'Rejected',
    canceled: 'Canceled',
    failed: 'Failed'
};

const OPEN_STATES = ['submitted', 'working', 'input-required'];

function textOf(message) {
    const part = (message.parts || []).find((item) => item.text);
    return part ? part.text : '';
}

function AgentDesk({ leagueId, leagueType, teamNames = {} }) {
    const [tab, setTab] = useState('connect');
    const [deskState, setDeskState] = useState('checking');
    const [agents, setAgents] = useState([]);
    const [sessions, setSessions] = useState(() => loadSessions().map(withoutOwnerToken));
    const [sessionVersion, setSessionVersion] = useState(0);
    const [tasks, setTasks] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [selectedTask, setSelectedTask] = useState(null);
    const [inboxError, setInboxError] = useState('');
    const [actionError, setActionError] = useState('');
    const [busy, setBusy] = useState(false);

    const [teamId, setTeamId] = useState('');
    const [teamName, setTeamName] = useState('');
    const [agentName, setAgentName] = useState('');
    const [webhookUrl, setWebhookUrl] = useState('');
    const [leagueCode, setLeagueCode] = useState('');
    const [formError, setFormError] = useState('');
    const [issued, setIssued] = useState(null);
    const [claimToken, setClaimToken] = useState('');
    const [claimError, setClaimError] = useState('');

    const sessionsRef = useRef(sessions);
    const selectedIdRef = useRef(selectedId);
    sessionsRef.current = sessions;
    selectedIdRef.current = selectedId;

    useEffect(() => {
        let active = true;

        async function refresh() {
            try {
                const health = await getHealth();
                if (!active) return;
                if (!health || health.ok !== true) {
                    setDeskState('offline');
                    return;
                }
                setDeskState('online');
                const agentData = await listAgents(leagueId);
                if (!active) return;
                setAgents(Array.isArray(agentData.agents) ? agentData.agents : []);

                const mine = sessionsRef.current;
                const collected = [];
                let rejected = '';
                for (let index = 0; index < mine.length; index += 1) {
                    const session = mine[index];
                    if (!session.ownerToken) continue;
                    try {
                        const data = await listTasks(session.ownerToken);
                        (data.tasks || []).forEach((task) => collected.push(task));
                    } catch (error) {
                        if (error.code === 'unauthorized') {
                            rejected = `${session.teamName}'s owner token was rejected. Forget it and claim the team again.`;
                        } else if (error.code === 'offline') {
                            throw error;
                        }
                    }
                }
                if (!active) return;
                const byId = new Map();
                collected.forEach((task) => byId.set(task.id, task));
                setTasks([...byId.values()]);
                setInboxError(rejected);

                if (selectedIdRef.current && mine.length > 0) {
                    try {
                        const opened = await readTask(selectedIdRef.current, mine);
                        if (active) setSelectedTask(opened.task);
                    } catch (refreshError) {
                        if (refreshError && refreshError.code === 'offline' && active) {
                            setDeskState('offline');
                        }
                    }
                }
            } catch (error) {
                if (!active) return;
                setDeskState('offline');
            }
        }

        refresh();
        const timer = setInterval(refresh, 5000);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [leagueId, sessionVersion]);

    useEffect(() => {
        if (!selectedId && tasks.length > 0) {
            setSelectedId(tasks[0].id);
        }
    }, [tasks, selectedId]);

    useEffect(() => {
        if (!selectedId) return undefined;
        let active = true;
        readTask(selectedId, sessionsRef.current)
            .then((data) => {
                if (active) setSelectedTask(data.task);
            })
            .catch((error) => {
                if (active) setActionError(error.message);
            });
        return () => {
            active = false;
        };
    }, [selectedId, sessionVersion]);

    function commitSessions(next) {
        setSessions(next);
        saveSessions(next.map(withoutOwnerToken));
        setSessionVersion((value) => value + 1);
    }

    function chooseTeam(event) {
        const id = event.target.value;
        setTeamId(id);
        const known = teamNames[id];
        if (known) {
            setTeamName(known);
            setAgentName(`${known} Agent`);
        }
    }

    async function onRegister(event) {
        event.preventDefault();
        setFormError('');
        setIssued(null);
        const trimmedTeam = teamId.trim();
        const existing = sessions.find((item) => item.teamId === trimmedTeam && item.leagueId === leagueId && item.ownerToken);
        if (!trimmedTeam || !teamName.trim() || !agentName.trim()) {
            setFormError('Roster id, team name, and agent name are required.');
            return;
        }
        if (!existing && !leagueCode.trim()) {
            setFormError('The league code is required to register an unclaimed team.');
            return;
        }
        setBusy(true);
        try {
            const body = {
                teamId: trimmedTeam,
                teamName: teamName.trim(),
                leagueId,
                name: agentName.trim(),
                webhookUrl: webhookUrl.trim() || undefined
            };
            const created = await registerAgent(body, {
                leagueCode: leagueCode.trim() || undefined,
                token: existing ? existing.ownerToken : undefined
            });
            const session = sessionFromRegistration(created, existing);
            const next = sessions.filter((item) => item.agentId !== session.agentId
                && !(item.teamId === session.teamId && item.leagueId === session.leagueId));
            next.push(session);
            commitSessions(next);
            setIssued({
                teamName: session.teamName,
                agentToken: created.agentToken || '',
                ownerToken: created.ownerToken || '',
                replaced: !created.ownerToken
            });
            setDeskState('online');
        } catch (error) {
            setFormError(error.message);
            if (error.code === 'offline') setDeskState('offline');
        } finally {
            setBusy(false);
        }
    }

    async function onClaim(event) {
        event.preventDefault();
        setClaimError('');
        const token = claimToken.trim();
        if (!token) {
            setClaimError('Paste the owner token for this tab. A refresh clears it.');
            return;
        }
        setBusy(true);
        try {
            const me = await getMe(token);
            if (me.role !== 'owner') {
                setClaimError('That token is an agent token. Paste the owner token instead.');
                return;
            }
            const session = {
                teamId: me.teamId,
                teamName: me.teamName,
                leagueId: me.leagueId,
                agentId: me.agent.metadata.agentId,
                agentName: me.agent.name,
                ownerToken: token
            };
            const next = sessions.filter((item) => item.agentId !== session.agentId
                && !(item.teamId === session.teamId && item.leagueId === session.leagueId));
            next.push(session);
            commitSessions(next);
            setClaimToken('');
            setTab('inbox');
        } catch (error) {
            setClaimError(error.message);
            if (error.code === 'offline') setDeskState('offline');
        } finally {
            setBusy(false);
        }
    }

    async function onRotateOwner(session) {
        setClaimError('');
        setIssued(null);
        if (!session.ownerToken) {
            setClaimError('Paste the owner token in this tab before rotating it.');
            return;
        }
        setBusy(true);
        try {
            const data = await rotateOwnerToken(session.agentId, session.ownerToken);
            const next = sessions.map((item) => (
                item.agentId === session.agentId ? { ...item, ownerToken: data.ownerToken } : item
            ));
            commitSessions(next);
            setIssued({
                teamName: session.teamName,
                agentToken: '',
                ownerToken: data.ownerToken,
                replaced: false,
                rotated: true
            });
        } catch (error) {
            setClaimError(error.message);
            if (error.code === 'offline') setDeskState('offline');
        } finally {
            setBusy(false);
        }
    }

    function forgetSession(session) {
        commitSessions(sessions.filter((item) => item.agentId !== session.agentId));
    }

    async function disconnectSession(session) {
        setClaimError('');
        if (!session.ownerToken) {
            setClaimError('Paste the owner token in this tab before disconnecting.');
            return;
        }
        setBusy(true);
        try {
            await revokeAgent(session.agentId, session.ownerToken);
            forgetSession(session);
        } catch (error) {
            setClaimError(error.message);
        } finally {
            setBusy(false);
        }
    }

    async function onDecide(session, decision) {
        if (!selectedTask) return;
        setBusy(true);
        setActionError('');
        try {
            const data = await decideTask(selectedTask.id, session.ownerToken, decision);
            setSelectedTask(data.task);
            setSessionVersion((value) => value + 1);
        } catch (error) {
            setActionError(error.message);
        } finally {
            setBusy(false);
        }
    }

    const teamOptions = Object.entries(teamNames);
    const pending = pendingSessions(selectedTask, sessions);
    const vetoers = vetoSessions(selectedTask, sessions);

    return (
        <section className="a2a-desk">
            <h2>Agent Desk</h2>
            <p className="a2a-lead">
                Connect an agent for your team, then let it negotiate trades, waiver priority, and FAAB with other connected agents.
                You approve before an agreement counts. Approving records it here and does not send a roster move.
            </p>
            {deskState === 'checking' && <p className="a2a-banner">Checking the negotiation desk...</p>}
            {deskState === 'offline' && (
                <p className="a2a-banner a2a-banner-warn" role="alert">
                    The negotiation desk is not running. Start it with npm run a2a, then leave this tab open.
                </p>
            )}
            {deskState === 'online' && (
                <p className="a2a-banner">Desk connected. Agent tokens negotiate. Owner tokens approve.</p>
            )}

            <div className="league-toggle a2a-tabs">
                <button type="button" className={tab === 'connect' ? 'active' : ''} onClick={() => setTab('connect')}>
                    Connect
                </button>
                <button type="button" className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>
                    Inbox ({tasks.length})
                </button>
            </div>

            {tab === 'connect' ? (
                <div className="a2a-connect">
                    <form className="a2a-card" onSubmit={onRegister}>
                        <h3>Register an agent</h3>
                        <p>This registers into the {leagueType} league {leagueId}.</p>
                        {teamOptions.length > 0 && (
                            <label htmlFor="a2a-league-team">
                                League team
                                <select id="a2a-league-team" value={teamId} onChange={chooseTeam}>
                                    <option value="">Choose a team</option>
                                    {teamOptions.map(([id, name]) => (
                                        <option key={id} value={id}>{name}</option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <label htmlFor="a2a-roster-id">
                            Roster id
                            <input id="a2a-roster-id" value={teamId} onChange={(event) => setTeamId(event.target.value)} autoComplete="off" />
                        </label>
                        <label htmlFor="a2a-team-name">
                            Team name
                            <input id="a2a-team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} autoComplete="off" />
                        </label>
                        <label htmlFor="a2a-agent-name">
                            Agent name
                            <input id="a2a-agent-name" value={agentName} onChange={(event) => setAgentName(event.target.value)} autoComplete="off" />
                        </label>
                        <label htmlFor="a2a-league-code">
                            League code
                            <input
                                id="a2a-league-code"
                                type="text"
                                inputMode="text"
                                value={leagueCode}
                                onChange={(event) => setLeagueCode(event.target.value)}
                                placeholder="Private league code"
                                autoComplete="off"
                                spellCheck="false"
                            />
                        </label>
                        <label htmlFor="a2a-webhook">
                            Webhook URL
                            <input
                                id="a2a-webhook"
                                value={webhookUrl}
                                onChange={(event) => setWebhookUrl(event.target.value)}
                                placeholder="Optional. The desk POSTs task events here."
                                autoComplete="off"
                            />
                        </label>
                        {formError && <p className="a2a-error" role="alert">{formError}</p>}
                        <button type="submit" disabled={busy}>Connect agent</button>
                        {issued && (
                            <div className="a2a-secrets">
                                <p>
                                    {issued.rotated
                                        ? 'Save the new owner token. The previous one no longer works. This tab keeps the new one in memory until you refresh.'
                                        : issued.replaced
                                            ? 'Agent token replaced. The owner token in this tab still approves. A refresh clears it.'
                                            : 'Save these now. The desk stores only hashes and cannot show them again. This tab keeps the owner token in memory until you refresh.'}
                                </p>
                                {issued.agentToken && (
                                    <label>
                                        Agent token
                                        <input readOnly aria-label="Issued agent token" value={issued.agentToken} />
                                    </label>
                                )}
                                {issued.ownerToken && (
                                    <label>
                                        Owner token
                                        <input readOnly aria-label="Issued owner token" value={issued.ownerToken} />
                                    </label>
                                )}
                                {!issued.rotated && (
                                    <p>Give the agent token to your model. Keep the owner token somewhere you control. The agent cannot approve.</p>
                                )}
                            </div>
                        )}
                    </form>

                    <div className="a2a-card">
                        <h3>Claim a team</h3>
                        <p>Paste an owner token to approve from this tab. A refresh clears it. The desk cannot look it up.</p>
                        <form onSubmit={onClaim}>
                            <label>
                                Owner token
                                <input
                                    aria-label="Owner token"
                                    value={claimToken}
                                    onChange={(event) => setClaimToken(event.target.value)}
                                    autoComplete="off"
                                    spellCheck="false"
                                />
                            </label>
                            {claimError && <p className="a2a-error" role="alert">{claimError}</p>}
                            <button type="submit" disabled={busy}>Claim team</button>
                        </form>
                        <h3>Teams in this tab</h3>
                        {sessions.length === 0 && <p>No teams in this tab yet.</p>}
                        <ul className="a2a-session-list">
                            {sessions.map((session) => (
                                <li key={session.agentId}>
                                    <div>
                                        <strong>{session.teamName}</strong>
                                        <span>{session.agentName} · {session.leagueId}</span>
                                        {session.agentToken && (
                                            <input
                                                readOnly
                                                aria-label={`Saved agent token for ${session.teamName}`}
                                                value={session.agentToken}
                                            />
                                        )}
                                    </div>
                                    <div className="a2a-row-actions">
                                        {session.ownerToken && (
                                            <button type="button" className="a2a-secondary" onClick={() => onRotateOwner(session)} disabled={busy}>
                                                Rotate owner token
                                            </button>
                                        )}
                                        <button type="button" className="a2a-secondary" onClick={() => forgetSession(session)}>
                                            Forget
                                        </button>
                                        <button type="button" className="a2a-danger" onClick={() => disconnectSession(session)} disabled={busy}>
                                            Disconnect
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                        <h3>Agents in this league</h3>
                        {agents.length === 0 && <p>No agents connected for this league yet.</p>}
                        <ul className="a2a-agent-list">
                            {agents.map((agent) => (
                                <li key={agent.metadata.agentId}>
                                    <strong>{agent.metadata.teamName}</strong>
                                    <span>{agent.name}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            ) : (
                <div className="a2a-inbox">
                    <div className="a2a-card a2a-list">
                        <h3>Negotiations</h3>
                        {inboxError && <p className="a2a-error" role="alert">{inboxError}</p>}
                        {tasks.length === 0 && (
                            <p>No negotiations yet. Connect two teams, then point their agents at each other.</p>
                        )}
                        <ul>
                            {tasks.map((task) => (
                                <li key={task.id}>
                                    <button
                                        type="button"
                                        className={task.id === selectedId ? 'active' : ''}
                                        onClick={() => setSelectedId(task.id)}
                                    >
                                        <span className="a2a-kind">{KIND_LABELS[task.kind] || task.kind}</span>
                                        <span className={`a2a-pill a2a-pill-${task.status.state}`}>{STATUS_LABELS[task.status.state] || task.status.state}</span>
                                        <span className="a2a-summary">{task.currentOffer && task.currentOffer.summary}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="a2a-card a2a-thread">
                        {!selectedTask && <p>Select a negotiation.</p>}
                        {selectedTask && (
                            <>
                                <div className="a2a-thread-head">
                                    <h3>{KIND_LABELS[selectedTask.kind] || selectedTask.kind}</h3>
                                    <span className={`a2a-pill a2a-pill-${selectedTask.status.state}`}>
                                        {STATUS_LABELS[selectedTask.status.state] || selectedTask.status.state}
                                    </span>
                                </div>
                                <p className="a2a-parties">
                                    {selectedTask.parties.map((party) => party.teamName).join(' and ')}
                                </p>
                                {selectedTask.status.state === 'input-required' && (
                                    <p className="a2a-banner">
                                        Both agents accepted revision {selectedTask.currentOffer.revision}. It stays a proposal until every owner approves. No roster move is sent.
                                    </p>
                                )}
                                {selectedTask.status.state === 'completed' && (
                                    <p className="a2a-banner a2a-banner-done">
                                        Both owners approved this agreement. No roster move was sent.
                                    </p>
                                )}
                                {selectedTask.status.state === 'rejected' && (
                                    <p className="a2a-banner a2a-banner-warn">This negotiation was rejected. Nothing was sent to Sleeper.</p>
                                )}
                                <OfferCard task={selectedTask} />
                                {selectedTask.humanApproval && Object.keys(selectedTask.humanApproval).length > 0 && (
                                    <ul className="a2a-approvals">
                                        {selectedTask.parties.map((party) => (
                                            <li key={party.teamId}>
                                                {party.teamName}: {selectedTask.humanApproval[party.teamId]?.state || 'pending'}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <div className="a2a-decisions">
                                    {pending.map((session) => (
                                        <button
                                            key={session.agentId}
                                            type="button"
                                            disabled={busy}
                                            onClick={() => onDecide(session, 'approve')}
                                        >
                                            Approve as {session.teamName}
                                        </button>
                                    ))}
                                    {vetoers.map((session) => (
                                        <button
                                            key={`veto-${session.agentId}`}
                                            type="button"
                                            className="a2a-danger"
                                            disabled={busy}
                                            onClick={() => onDecide(session, 'veto')}
                                        >
                                            Veto as {session.teamName}
                                        </button>
                                    ))}
                                </div>
                                {actionError && <p className="a2a-error" role="alert">{actionError}</p>}
                                <ol className="a2a-log">
                                    {(selectedTask.history || []).map((message) => (
                                        <li key={message.messageId} className={message.role === 'user' ? 'a2a-human' : 'a2a-agent-msg'}>
                                            <span>
                                                {message.metadata.teamName} · {message.metadata.action}
                                            </span>
                                            <p>{textOf(message)}</p>
                                        </li>
                                    ))}
                                </ol>
                            </>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

function OfferCard({ task }) {
    const offer = task.currentOffer;
    if (!offer) return null;
    if (task.kind === 'trade') {
        return (
            <div className="a2a-offer">
                <p>Revision {offer.revision} · proposed by {offer.proposedByTeamName}</p>
                <div className="a2a-offer-columns">
                    <div>
                        <h4>Gives</h4>
                        <ul>
                            {offer.terms.send.map((name) => <li key={name}>{name}</li>)}
                        </ul>
                    </div>
                    <div>
                        <h4>Receives</h4>
                        <ul>
                            {offer.terms.receive.map((name) => <li key={name}>{name}</li>)}
                        </ul>
                    </div>
                </div>
            </div>
        );
    }
    return (
        <div className="a2a-offer">
            <p>Revision {offer.revision}</p>
            <p>{offer.summary}</p>
        </div>
    );
}

async function readTask(taskId, sessions) {
    let lastError = null;
    for (let index = 0; index < sessions.length; index += 1) {
        try {
            return await getTask(taskId, sessions[index].ownerToken);
        } catch (error) {
            lastError = error;
            if (error.code !== 'forbidden' && error.code !== 'unauthorized') throw error;
        }
    }
    throw lastError || new Error('Claim a team to open this negotiation.');
}

function withoutOwnerToken(session) {
    const copy = { ...session };
    delete copy.ownerToken;
    return copy;
}

function sessionFromRegistration(created, previous) {
    return {
        teamId: created.agent.metadata.teamId,
        teamName: created.agent.metadata.teamName,
        leagueId: created.agent.metadata.leagueId,
        agentId: created.agent.metadata.agentId,
        agentName: created.agent.name,
        ownerToken: created.ownerToken || (previous && previous.ownerToken) || '',
        agentToken: created.agentToken || ''
    };
}

function pendingSessions(task, sessions) {
    if (!task || task.status.state !== 'input-required') return [];
    return sessions.filter((session) => session.ownerToken
        && task.humanApproval?.[session.teamId]?.state === 'pending'
        && task.parties.some((party) => party.teamId === session.teamId));
}

function vetoSessions(task, sessions) {
    if (!task || !OPEN_STATES.includes(task.status.state)) return [];
    return sessions.filter((session) => session.ownerToken
        && task.parties.some((party) => party.teamId === session.teamId));
}

export default AgentDesk;
