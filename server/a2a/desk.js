'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KINDS = ['trade', 'waiver_priority', 'faab'];
const OPEN_STATES = ['submitted', 'working', 'input-required'];
const CLOSED_STATES = ['completed', 'rejected', 'canceled', 'failed'];
const MAX_OPEN_TASKS = 25;

const EXECUTION = {
    automatic: false,
    executed: false,
    reason: 'Human owners must both approve. Approval only records the agreement. No roster move is sent to Sleeper.'
};

class DeskError extends Error {
    constructor(code, message, status) {
        super(message);
        this.name = 'DeskError';
        this.code = code;
        this.status = status;
    }
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function createToken() {
    return crypto.randomBytes(24).toString('hex');
}

function createId(prefix) {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function safeEqualHex(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
}

function cleanText(value, max, { required = false, field = 'text' } = {}) {
    if (value == null || value === '') {
        if (required) {
            throw new DeskError('validation', `${field} is required.`, 400);
        }
        return '';
    }
    if (typeof value !== 'string') {
        throw new DeskError('validation', `${field} must be a string.`, 400);
    }
    const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (!cleaned && required) {
        throw new DeskError('validation', `${field} is required.`, 400);
    }
    if (cleaned.length > max) {
        throw new DeskError('validation', `${field} must be ${max} characters or fewer.`, 400);
    }
    return cleaned;
}

function cleanId(value, field) {
    const text = cleanText(value, 40, { required: true, field });
    if (!/^[A-Za-z0-9_-]+$/.test(text)) {
        throw new DeskError('validation', `${field} may only contain letters, numbers, underscores, and hyphens.`, 400);
    }
    return text;
}

function assertWebhookUrl(value) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.length > 300) {
        throw new DeskError('validation', 'webhookUrl must be an http(s) URL.', 400);
    }
    let parsed;
    try {
        parsed = new URL(value);
    } catch (error) {
        throw new DeskError('validation', 'webhookUrl must be an http(s) URL.', 400);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new DeskError('validation', 'webhookUrl must use http or https.', 400);
    }
    if (parsed.username || parsed.password) {
        throw new DeskError('validation', 'webhookUrl cannot include credentials.', 400);
    }
    const host = parsed.hostname.toLowerCase();
    if (host === '169.254.169.254' || host === 'metadata.google.internal') {
        throw new DeskError('validation', 'webhookUrl is not allowed.', 400);
    }
    return parsed.toString();
}

function stringList(value, field) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new DeskError('validation', `${field} must be a non-empty list of names.`, 400);
    }
    if (value.length > 6) {
        throw new DeskError('validation', `${field} can include at most 6 names.`, 400);
    }
    const names = value.map((item, index) => cleanText(item, 60, { required: true, field: `${field}[${index}]` }));
    const seen = new Set();
    names.forEach((name) => {
        const key = name.toLowerCase();
        if (seen.has(key)) {
            throw new DeskError('validation', `${field} contains a duplicate.`, 400);
        }
        seen.add(key);
    });
    return names;
}

function validateTerms(kind, terms) {
    if (!terms || typeof terms !== 'object' || Array.isArray(terms)) {
        throw new DeskError('validation', 'terms must be an object.', 400);
    }
    if (kind === 'trade') {
        const send = stringList(terms.send, 'terms.send');
        const receive = stringList(terms.receive, 'terms.receive');
        const overlap = send.find((name) => receive.some((other) => other.toLowerCase() === name.toLowerCase()));
        if (overlap) {
            throw new DeskError('validation', 'A trade cannot send and receive the same player.', 400);
        }
        return { send, receive };
    }
    if (kind === 'waiver_priority') {
        const fromPriority = integerIn(terms.fromPriority, 1, 32, 'terms.fromPriority');
        const toPriority = integerIn(terms.toPriority, 1, 32, 'terms.toPriority');
        if (fromPriority === toPriority) {
            throw new DeskError('validation', 'Waiver priorities must be different.', 400);
        }
        return { fromPriority, toPriority };
    }
    if (kind === 'faab') {
        const player = cleanText(terms.player, 60, { required: true, field: 'terms.player' });
        const amount = integerIn(terms.amount, 0, 1000, 'terms.amount');
        if (terms.dropClaim != null && typeof terms.dropClaim !== 'boolean') {
            throw new DeskError('validation', 'terms.dropClaim must be true or false.', 400);
        }
        return { player, amount, dropClaim: Boolean(terms.dropClaim) };
    }
    throw new DeskError('validation', 'kind must be trade, waiver_priority, or faab.', 400);
}

function integerIn(value, min, max, field) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new DeskError('validation', `${field} must be an integer.`, 400);
    }
    if (value < min || value > max) {
        throw new DeskError('validation', `${field} must be between ${min} and ${max}.`, 400);
    }
    return value;
}

function summarize(kind, terms, proposerName) {
    if (kind === 'trade') {
        return `${proposerName} gives ${terms.send.join(', ')} and receives ${terms.receive.join(', ')}.`;
    }
    if (kind === 'waiver_priority') {
        return `${proposerName} offers waiver priority ${terms.fromPriority} in exchange for priority ${terms.toPriority}.`;
    }
    return `${proposerName} offers $${terms.amount} FAAB for ${terms.player}${terms.dropClaim ? ' if the other team drops its claim' : ''}.`;
}

function createDesk(options = {}) {
    const now = options.now || (() => new Date());
    const notify = options.notify || (async () => {});
    const persistPath = options.persistPath || null;
    const leagueCode = options.leagueCode == null ? null : String(options.leagueCode);
    const state = { agents: {}, tasks: {} };

    if (persistPath) {
        loadState(persistPath, state);
    }

    function iso() {
        return now().toISOString();
    }

    function persist() {
        if (!persistPath) return;
        fs.mkdirSync(path.dirname(persistPath), { recursive: true });
        const tmp = `${persistPath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state));
        fs.renameSync(tmp, persistPath);
    }

    function assertLeagueCode(header) {
        if (!leagueCode) return;
        const provided = header == null ? '' : String(header);
        const a = hashToken(provided);
        const b = hashToken(leagueCode);
        if (!safeEqualHex(a, b)) {
            throw new DeskError('unauthorized', 'League code is incorrect.', 401);
        }
    }

    function authenticate(token) {
        if (!token || typeof token !== 'string' || token.length < 16 || token.length > 200) return null;
        const hashed = hashToken(token);
        const agents = Object.values(state.agents);
        let match = null;
        agents.forEach((agent) => {
            if (agent.revokedAt) return;
            if (safeEqualHex(agent.agentTokenHash, hashed)) {
                match = { role: 'agent', agent };
            } else if (safeEqualHex(agent.ownerTokenHash, hashed)) {
                match = { role: 'owner', agent };
            }
        });
        return match;
    }

    function requireAuth(token) {
        const auth = authenticate(token);
        if (!auth) {
            throw new DeskError('unauthorized', 'Missing or invalid bearer token.', 401);
        }
        return auth;
    }

    function activeAgentForTeam(leagueId, teamId) {
        return Object.values(state.agents).find((agent) => (
            !agent.revokedAt && agent.leagueId === leagueId && agent.teamId === teamId
        )) || null;
    }

    function publicCard(agent, baseUrl) {
        const origin = baseUrl || '';
        return {
            name: agent.name,
            description: agent.description,
            url: `${origin}/api/a2a/agents/${agent.id}`,
            version: '0.1.0',
            protocolVersion: '0.3.0',
            capabilities: {
                streaming: false,
                pushNotifications: Boolean(agent.webhookUrl),
                stateTransitionHistory: true
            },
            authentication: { schemes: ['Bearer'] },
            securitySchemes: {
                bearer: { type: 'http', scheme: 'bearer' }
            },
            security: [{ bearer: [] }],
            defaultInputModes: ['text/plain', 'application/json'],
            defaultOutputModes: ['text/plain', 'application/json'],
            skills: skills(),
            metadata: {
                agentId: agent.id,
                teamId: agent.teamId,
                teamName: agent.teamName,
                leagueId: agent.leagueId
            }
        };
    }

    function partySnapshot(agent) {
        return {
            teamId: agent.teamId,
            teamName: agent.teamName,
            agentId: agent.id,
            agentName: agent.name
        };
    }

    function teamName(task, teamId) {
        const party = task.parties.find((item) => item.teamId === teamId);
        return party ? party.teamName : `Team ${teamId}`;
    }

    function toPublicTask(task) {
        return {
            id: task.id,
            contextId: task.contextId,
            kind: task.kind,
            status: task.status,
            currentOffer: task.currentOffer,
            accepts: task.accepts,
            humanApproval: task.humanApproval,
            executed: false,
            execution: EXECUTION,
            parties: task.parties,
            history: task.history,
            metadata: { leagueId: task.leagueId }
        };
    }

    function toListItem(task) {
        const full = toPublicTask(task);
        const history = full.history;
        return {
            ...full,
            history: undefined,
            messageCount: history.length,
            preview: history[history.length - 1] || null
        };
    }

    function allowedActions(task, auth) {
        if (!auth) return [];
        const teamId = auth.agent.teamId;
        const involved = task.parties.some((party) => party.teamId === teamId);
        if (!involved) return [];
        if (CLOSED_STATES.includes(task.status.state)) return [];
        if (auth.role === 'owner') {
            const actions = ['veto'];
            const approval = task.humanApproval[teamId];
            if (task.status.state === 'input-required' && approval && approval.state === 'pending') {
                actions.unshift('approve');
            }
            return actions;
        }
        if (task.status.state === 'input-required') return ['comment'];
        const actions = ['comment', 'reject', 'cancel'];
        if (task.currentOffer.proposedByTeamId !== teamId) actions.push('accept');
        actions.push('counter');
        return actions;
    }

    function withActions(payload, task, auth) {
        return { ...payload, allowedActions: allowedActions(task, auth) };
    }

    function pushMessage(task, { role, agent, action, text, data }) {
        const message = {
            messageId: createId('msg'),
            role,
            taskId: task.id,
            contextId: task.contextId,
            parts: [
                { type: 'text', kind: 'text', text },
                { type: 'data', kind: 'data', data }
            ],
            metadata: {
                action,
                teamId: agent.teamId,
                teamName: agent.teamName,
                agentId: agent.id
            },
            createdAt: iso()
        };
        task.history.push(message);
        task.updatedAt = message.createdAt;
        return message;
    }

    async function emit(task, eventName, actorTeamId) {
        const recipients = task.parties.filter((party) => party.teamId !== actorTeamId);
        await Promise.all(recipients.map(async (party) => {
            const agent = activeAgentForTeam(task.leagueId, party.teamId);
            if (!agent || !agent.webhookUrl) return;
            const event = {
                event: eventName,
                taskId: task.id,
                contextId: task.contextId,
                state: task.status.state,
                kind: task.kind,
                summary: task.currentOffer.summary
            };
            try {
                await notify(agent, event);
                agent.lastWebhookError = null;
            } catch (error) {
                agent.lastWebhookError = cleanText(error.message || 'webhook failed', 200);
            }
        }));
    }

    function touchOffer(task, teamId, terms) {
        const revision = task.currentOffer ? task.currentOffer.revision + 1 : 1;
        const proposerName = teamName(task, teamId);
        task.currentOffer = {
            revision,
            proposedByTeamId: teamId,
            proposedByTeamName: proposerName,
            terms,
            summary: summarize(task.kind, terms, proposerName)
        };
        task.accepts = {};
        task.humanApproval = {};
    }

    function openTaskCount(teamId, leagueId) {
        return Object.values(state.tasks).filter((task) => (
            task.leagueId === leagueId
            && OPEN_STATES.includes(task.status.state)
            && task.parties.some((party) => party.teamId === teamId)
        )).length;
    }

    function partyAgent(task, auth) {
        return task.parties.find((party) => party.teamId === auth.agent.teamId) || null;
    }

    return {
        authenticate,
        leagueCard(baseUrl) {
            const origin = baseUrl || '';
            return {
                name: 'League Negotiation Desk',
                description: 'Minimal agent-to-agent desk for fantasy trades, waiver priority swaps, and FAAB talks. Agents negotiate. Human owners approve. Nothing is executed on Sleeper.',
                url: `${origin}/api/a2a`,
                provider: { organization: 'Fantasy Football Dashboard' },
                version: '0.1.0',
                protocolVersion: '0.3.0',
                capabilities: {
                    streaming: false,
                    pushNotifications: true,
                    stateTransitionHistory: true
                },
                authentication: { schemes: ['Bearer'] },
                securitySchemes: {
                    bearer: { type: 'http', scheme: 'bearer' }
                },
                security: [{ bearer: [] }],
                defaultInputModes: ['text/plain', 'application/json'],
                defaultOutputModes: ['text/plain', 'application/json'],
                skills: skills()
            };
        },

        registerAgent(input, meta = {}) {
            assertLeagueCode(meta.leagueCode);
            const body = input || {};
            const teamId = cleanId(body.teamId, 'teamId');
            const teamName = cleanText(body.teamName, 60, { required: true, field: 'teamName' });
            const leagueId = cleanId(body.leagueId, 'leagueId');
            const name = cleanText(body.name, 80, { required: true, field: 'name' });
            const description = cleanText(
                body.description,
                280
            ) || `${teamName} agent for trades, waiver priority, and FAAB.`;
            const webhookUrl = assertWebhookUrl(body.webhookUrl);
            let webhookSecret = null;
            if (body.webhookSecret != null && body.webhookSecret !== '') {
                webhookSecret = cleanText(body.webhookSecret, 200, { required: true, field: 'webhookSecret' });
            }

            const existing = activeAgentForTeam(leagueId, teamId);
            if (existing) {
                existing.revokedAt = iso();
            }

            const agentToken = createToken();
            const ownerToken = createToken();
            const agent = {
                id: createId('agent'),
                teamId,
                teamName,
                leagueId,
                name,
                description,
                webhookUrl,
                webhookSecret,
                agentTokenHash: hashToken(agentToken),
                ownerTokenHash: hashToken(ownerToken),
                createdAt: iso(),
                revokedAt: null,
                lastWebhookError: null
            };
            state.agents[agent.id] = agent;
            persist();
            return {
                agent: publicCard(agent, meta.baseUrl),
                agentToken,
                ownerToken
            };
        },

        listAgents({ leagueId, baseUrl } = {}) {
            const filter = leagueId ? cleanId(leagueId, 'leagueId') : null;
            const agents = Object.values(state.agents)
                .filter((agent) => !agent.revokedAt && (!filter || agent.leagueId === filter))
                .map((agent) => publicCard(agent, baseUrl));
            return { agents };
        },

        getAgent(agentId, baseUrl) {
            const agent = state.agents[agentId];
            if (!agent || agent.revokedAt) {
                throw new DeskError('not_found', 'Agent not found.', 404);
            }
            return publicCard(agent, baseUrl);
        },

        me(token, baseUrl) {
            const auth = requireAuth(token);
            return {
                role: auth.role,
                agent: publicCard(auth.agent, baseUrl),
                teamId: auth.agent.teamId,
                teamName: auth.agent.teamName,
                leagueId: auth.agent.leagueId
            };
        },

        revokeAgent(agentId, token) {
            const auth = requireAuth(token);
            if (auth.role !== 'owner' || auth.agent.id !== agentId) {
                throw new DeskError('forbidden', 'Only this team owner can disconnect the agent.', 403);
            }
            auth.agent.revokedAt = iso();
            persist();
            return { revoked: true, agentId };
        },

        rotateAgentToken(agentId, token) {
            const auth = requireAuth(token);
            if (auth.role !== 'owner' || auth.agent.id !== agentId) {
                throw new DeskError('forbidden', 'Only this team owner can rotate the agent token.', 403);
            }
            const agentToken = createToken();
            auth.agent.agentTokenHash = hashToken(agentToken);
            persist();
            return { agentToken, agentId };
        },

        async createTask({ token, kind, toTeamId, terms, text }, meta = {}) {
            const auth = requireAuth(token);
            if (auth.role !== 'agent') {
                throw new DeskError('forbidden', 'Creating an offer requires the agent token, not the owner token.', 403);
            }
            if (!KINDS.includes(kind)) {
                throw new DeskError('validation', 'kind must be trade, waiver_priority, or faab.', 400);
            }
            const targetTeamId = cleanId(toTeamId, 'toTeamId');
            if (targetTeamId === auth.agent.teamId) {
                throw new DeskError('validation', 'An agent cannot negotiate with its own team.', 400);
            }
            const counterparty = activeAgentForTeam(auth.agent.leagueId, targetTeamId);
            if (!counterparty) {
                throw new DeskError('not_found', 'The other team has not connected an agent.', 404);
            }
            if (openTaskCount(auth.agent.teamId, auth.agent.leagueId) >= MAX_OPEN_TASKS) {
                throw new DeskError('conflict', 'This team has too many open negotiations.', 409);
            }
            const normalized = validateTerms(kind, terms);
            const note = cleanText(text, 2000) || defaultText('propose', kind);
            const task = {
                id: createId('task'),
                contextId: createId('ctx'),
                kind,
                leagueId: auth.agent.leagueId,
                parties: [partySnapshot(auth.agent), partySnapshot(counterparty)],
                status: { state: 'submitted', timestamp: iso() },
                currentOffer: null,
                accepts: {},
                humanApproval: {},
                history: [],
                createdAt: iso(),
                updatedAt: iso()
            };
            task.parties[0].teamName = auth.agent.teamName;
            touchOffer(task, auth.agent.teamId, normalized);
            task.currentOffer.revision = 1;
            pushMessage(task, {
                role: 'agent',
                agent: auth.agent,
                action: 'propose',
                text: note,
                data: { action: 'propose', kind, terms: normalized }
            });
            state.tasks[task.id] = task;
            persist();
            await emit(task, 'task.created', auth.agent.teamId);
            return { task: withActions(toPublicTask(task), task, auth) };
        },

        listTasks(token) {
            const auth = requireAuth(token);
            const tasks = Object.values(state.tasks)
                .filter((task) => task.leagueId === auth.agent.leagueId)
                .filter((task) => task.parties.some((party) => party.teamId === auth.agent.teamId))
                .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
                .map((task) => withActions(toListItem(task), task, auth));
            return { tasks };
        },

        getTask(taskId, token) {
            const auth = requireAuth(token);
            const task = state.tasks[taskId];
            if (!task) throw new DeskError('not_found', 'Task not found.', 404);
            if (!partyAgent(task, auth)) {
                throw new DeskError('forbidden', 'This token is not part of the negotiation.', 403);
            }
            return { task: withActions(toPublicTask(task), task, auth) };
        },

        async postMessage({ token, taskId, action, terms, text }) {
            const auth = requireAuth(token);
            if (auth.role !== 'agent') {
                throw new DeskError('forbidden', 'Offers and replies require the agent token.', 403);
            }
            const task = state.tasks[taskId];
            if (!task) throw new DeskError('not_found', 'Task not found.', 404);
            if (!partyAgent(task, auth)) {
                throw new DeskError('forbidden', 'This agent is not part of the negotiation.', 403);
            }
            if (CLOSED_STATES.includes(task.status.state)) {
                throw new DeskError('conflict', 'This negotiation is already closed.', 409);
            }
            if (!['counter', 'accept', 'reject', 'comment', 'cancel'].includes(action)) {
                throw new DeskError('validation', 'action must be counter, accept, reject, comment, or cancel.', 400);
            }

            if (action === 'comment') {
                const note = cleanText(text, 2000, { required: true, field: 'text' });
                pushMessage(task, {
                    role: 'agent',
                    agent: auth.agent,
                    action: 'comment',
                    text: note,
                    data: { action: 'comment' }
                });
                persist();
                await emit(task, 'task.message', auth.agent.teamId);
                return { task: withActions(toPublicTask(task), task, auth) };
            }

            if (task.status.state === 'input-required' && action !== 'comment') {
                throw new DeskError('conflict', 'Both agents accepted. Waiting on the human owners.', 409);
            }

            if (action === 'cancel') {
                const note = cleanText(text, 2000) || 'Canceled the negotiation.';
                task.status = { state: 'canceled', timestamp: iso() };
                pushMessage(task, {
                    role: 'agent',
                    agent: auth.agent,
                    action: 'cancel',
                    text: note,
                    data: { action: 'cancel' }
                });
                persist();
                await emit(task, 'task.canceled', auth.agent.teamId);
                return { task: withActions(toPublicTask(task), task, auth) };
            }

            if (action === 'reject') {
                const note = cleanText(text, 2000) || 'Rejected the negotiation.';
                task.status = { state: 'rejected', timestamp: iso() };
                pushMessage(task, {
                    role: 'agent',
                    agent: auth.agent,
                    action: 'reject',
                    text: note,
                    data: { action: 'reject' }
                });
                persist();
                await emit(task, 'task.rejected', auth.agent.teamId);
                return { task: withActions(toPublicTask(task), task, auth) };
            }

            if (action === 'counter') {
                const normalized = validateTerms(task.kind, terms);
                const note = cleanText(text, 2000) || 'Countered with a new offer.';
                touchOffer(task, auth.agent.teamId, normalized);
                task.status = { state: 'working', timestamp: iso() };
                pushMessage(task, {
                    role: 'agent',
                    agent: auth.agent,
                    action: 'counter',
                    text: note,
                    data: { action: 'counter', kind: task.kind, terms: normalized }
                });
                persist();
                await emit(task, 'task.message', auth.agent.teamId);
                return { task: withActions(toPublicTask(task), task, auth) };
            }

            if (task.currentOffer.proposedByTeamId === auth.agent.teamId) {
                throw new DeskError('conflict', 'The other agent has to accept this offer.', 409);
            }
            const note = cleanText(text, 2000) || 'Accepted the current offer.';
            task.accepts[auth.agent.teamId] = task.currentOffer.revision;
            task.accepts[task.currentOffer.proposedByTeamId] = task.currentOffer.revision;
            task.humanApproval = {};
            task.parties.forEach((party) => {
                task.humanApproval[party.teamId] = { state: 'pending', at: null };
            });
            task.status = { state: 'input-required', timestamp: iso() };
            pushMessage(task, {
                role: 'agent',
                agent: auth.agent,
                action: 'accept',
                text: note,
                data: { action: 'accept', revision: task.currentOffer.revision }
            });
            persist();
            await emit(task, 'task.input-required', auth.agent.teamId);
            return { task: withActions(toPublicTask(task), task, auth) };
        },

        async decide({ token, taskId, decision }) {
            const auth = requireAuth(token);
            if (auth.role !== 'owner') {
                throw new DeskError(
                    'human_approval_required',
                    'Only a human owner can approve or veto. Agent tokens cannot settle a deal.',
                    403
                );
            }
            const task = state.tasks[taskId];
            if (!task) throw new DeskError('not_found', 'Task not found.', 404);
            if (!partyAgent(task, auth)) {
                throw new DeskError('forbidden', 'This owner is not part of the negotiation.', 403);
            }
            if (decision !== 'approve' && decision !== 'veto') {
                throw new DeskError('validation', 'decision must be approve or veto.', 400);
            }
            if (task.status.state === 'completed') {
                throw new DeskError('conflict', 'This agreement is already approved by both owners.', 409);
            }
            if (CLOSED_STATES.includes(task.status.state)) {
                throw new DeskError('conflict', 'This negotiation is already closed.', 409);
            }

            if (decision === 'veto') {
                task.humanApproval[auth.agent.teamId] = { state: 'vetoed', at: iso() };
                task.status = { state: 'rejected', timestamp: iso() };
                pushMessage(task, {
                    role: 'user',
                    agent: auth.agent,
                    action: 'veto',
                    text: `${auth.agent.teamName} vetoed the agreement.`,
                    data: { action: 'veto' }
                });
                persist();
                await emit(task, 'task.rejected', auth.agent.teamId);
                return { task: withActions(toPublicTask(task), task, auth) };
            }

            if (task.status.state !== 'input-required') {
                throw new DeskError('conflict', 'Both agents have to accept the same offer before an owner can approve it.', 409);
            }
            const approval = task.humanApproval[auth.agent.teamId];
            if (!approval || approval.state !== 'pending') {
                throw new DeskError('conflict', 'You already approved this agreement.', 409);
            }
            task.humanApproval[auth.agent.teamId] = { state: 'approved', at: iso() };
            pushMessage(task, {
                role: 'user',
                agent: auth.agent,
                action: 'approve',
                text: `${auth.agent.teamName} approved the agreement.`,
                data: { action: 'approve' }
            });
            const both = task.parties.every((party) => task.humanApproval[party.teamId]?.state === 'approved');
            if (both) {
                task.status = { state: 'completed', timestamp: iso() };
            }
            persist();
            await emit(task, both ? 'task.completed' : 'task.message', auth.agent.teamId);
            return { task: withActions(toPublicTask(task), task, auth) };
        }
    };
}

function defaultText(action, kind) {
    const label = kind === 'waiver_priority' ? 'waiver priority swap' : kind === 'faab' ? 'FAAB offer' : 'trade';
    if (action === 'propose') return `Proposed a ${label}.`;
    return '';
}

function skills() {
    return [
        {
            id: 'negotiate-trade',
            name: 'Negotiate a trade',
            description: 'Propose, counter, accept, or reject a player trade. Both human owners must approve. No roster move is executed.',
            tags: ['trade', 'fantasy'],
            examples: ['Offer Justin Jefferson for Ja\'Marr Chase']
        },
        {
            id: 'negotiate-waiver-priority',
            name: 'Negotiate a waiver priority swap',
            description: 'Offer to swap waiver priority slots. Both human owners must approve.',
            tags: ['waiver', 'fantasy'],
            examples: ['Swap priority 7 for priority 2']
        },
        {
            id: 'negotiate-faab',
            name: 'Negotiate a FAAB bid',
            description: 'Offer FAAB dollars tied to a waiver target. Both human owners must approve.',
            tags: ['faab', 'waiver', 'fantasy'],
            examples: ['Offer $12 FAAB if you drop your claim on Tank Bigsby']
        }
    ];
}

function loadState(persistPath, state) {
    try {
        const parsed = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
        state.agents = parsed.agents || {};
        state.tasks = parsed.tasks || {};
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

module.exports = {
    CLOSED_STATES,
    DeskError,
    EXECUTION,
    KINDS,
    createDesk,
    hashToken,
    validateTerms
};
