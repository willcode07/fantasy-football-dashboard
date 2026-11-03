'use strict';

const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const net = require('net');
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

const BLOCKED_HOST_NAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata',
    'metadata.google.internal',
    'instance-data'
]);

function parseIpPart(part) {
    if (/^0x[0-9a-f]+$/i.test(part)) return parseInt(part, 16);
    if (/^0[0-7]+$/.test(part)) return parseInt(part, 8);
    if (/^\d+$/.test(part)) return Number(part);
    return null;
}

function isBlockedIpv4(address) {
    const parts = address.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
}

function isBlockedIpv6(address) {
    const value = address.toLowerCase();
    if (value === '::' || value === '::0' || value === '::1') return true;
    const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isBlockedIpv4(dotted[1]);
    const mapped = value.match(/ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
        const hi = parseInt(mapped[1], 16);
        const lo = parseInt(mapped[2], 16);
        return isBlockedIpv4(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    if (/^fe[89ab][0-9a-f]:/.test(value)) return true;
    if (/^f[cd][0-9a-f]{2}:/.test(value)) return true;
    if (/^ff[0-9a-f]{2}:/.test(value)) return true;
    return false;
}

function isBlockedIp(address) {
    if (typeof address !== 'string' || !address) return true;
    const value = address.trim().toLowerCase();
    const version = net.isIP(value);
    if (version === 4) return isBlockedIpv4(value);
    if (version === 6) return isBlockedIpv6(value);
    return true;
}

function classifyHost(hostname) {
    const name = String(hostname || '').replace(/\.$/, '').toLowerCase();
    if (!name || BLOCKED_HOST_NAMES.has(name)) return { blocked: true };
    if (name.endsWith('.local') || name.endsWith('.localhost') || name.endsWith('.internal')) {
        return { blocked: true };
    }
    if (net.isIP(name) === 6) return { ip: name };
    const labels = name.split('.');
    if (labels.every((label) => parseIpPart(label) != null)) {
        if (labels.length !== 4) return { blocked: true };
        const nums = labels.map((label) => parseIpPart(label));
        if (nums.some((num) => num > 255)) return { blocked: true };
        return { ip: nums.join('.') };
    }
    if (!name.includes('.')) return { blocked: true };
    return { name };
}

async function resolveWebhookTarget(value, lookup = dns.promises.lookup) {
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
    const classified = classifyHost(parsed.hostname);
    if (classified.blocked || (classified.ip && isBlockedIp(classified.ip))) {
        throw new DeskError('validation', 'webhookUrl is not allowed.', 400);
    }
    if (classified.ip) {
        return {
            href: parsed.toString(),
            address: classified.ip,
            family: net.isIP(classified.ip)
        };
    }
    let records;
    try {
        records = await lookup(classified.name, { all: true });
    } catch (error) {
        throw new DeskError('validation', 'webhookUrl could not be resolved.', 400);
    }
    const list = Array.isArray(records) ? records : [records];
    const addresses = list.map((record) => (typeof record === 'string' ? record : record && record.address));
    if (addresses.length === 0 || addresses.some((address) => isBlockedIp(address))) {
        throw new DeskError('validation', 'webhookUrl is not allowed.', 400);
    }
    const chosen = addresses[0];
    const record = list[0];
    const family = (record && typeof record === 'object' && record.family) || net.isIP(chosen);
    return {
        href: parsed.toString(),
        address: chosen,
        family: Number(family) === 6 ? 6 : 4
    };
}

async function assertWebhookUrl(value, lookup = dns.promises.lookup) {
    const target = await resolveWebhookTarget(value, lookup);
    return target ? target.href : null;
}

function encryptSecret(plain, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptSecret(enc, key) {
    const parts = String(enc || '').split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
        throw new Error('Webhook secret could not be decrypted.');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(parts[3], 'base64')),
        decipher.final()
    ]).toString('utf8');
}

function secretKeyFrom(value) {
    if (!value) return crypto.randomBytes(32);
    if (Buffer.isBuffer(value) && value.length === 32) return value;
    if (typeof value === 'string' && value) return crypto.createHash('sha256').update(value).digest();
    throw new Error('secretKey must be 32 bytes or a passphrase string.');
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

const leagueDirectoryCache = new Map();

function canonicalTeamName(value, teamId) {
    const cleaned = cleanText(value == null ? '' : String(value), 60);
    return cleaned || `Team ${teamId}`;
}

async function loadLeagueDirectory(leagueId) {
    const cached = leagueDirectoryCache.get(leagueId);
    const nowMs = Date.now();
    if (cached && nowMs - cached.at < 60 * 1000) return cached.directory;
    let rosters;
    let users;
    try {
        const timeout = AbortSignal.timeout(5000);
        const [rostersResponse, usersResponse] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`, { signal: timeout }),
            fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`, { signal: timeout })
        ]);
        if (!rostersResponse.ok || !usersResponse.ok) {
            throw new DeskError('not_found', 'That league could not be verified.', 404);
        }
        rosters = await rostersResponse.json();
        users = await usersResponse.json();
    } catch (error) {
        if (error instanceof DeskError) throw error;
        throw new DeskError('not_found', 'That league could not be verified.', 404);
    }
    if (!Array.isArray(rosters) || !Array.isArray(users)) {
        throw new DeskError('not_found', 'That league could not be verified.', 404);
    }
    const directory = {};
    rosters.forEach((roster) => {
        if (!roster || roster.roster_id == null) return;
        const user = users.find((item) => item && item.user_id === roster.owner_id);
        directory[String(roster.roster_id)] = {
            teamName: canonicalTeamName(user && user.display_name, roster.roster_id),
            ownerId: roster.owner_id || null
        };
    });
    leagueDirectoryCache.set(leagueId, { at: nowMs, directory });
    return directory;
}

function createDesk(options = {}) {
    const now = options.now || (() => new Date());
    const notify = options.notify || (async () => {});
    const persistPath = options.persistPath || null;
    const leagueCode = options.leagueCode == null || options.leagueCode === '' ? null : String(options.leagueCode);
    const commissionerCode = options.commissionerCode == null || options.commissionerCode === ''
        ? null
        : String(options.commissionerCode);
    if (leagueCode && commissionerCode && leagueCode === commissionerCode) {
        throw new Error('A2A_COMMISSIONER_CODE must be different from A2A_LEAGUE_CODE.');
    }
    const secretKey = secretKeyFrom(options.secretKey);
    const lookup = options.lookup || dns.promises.lookup;
    const state = { agents: {}, tasks: {}, claims: {} };

    if (persistPath) {
        loadState(persistPath, state);
        if (migrateWebhookSecrets(state, secretKey)) persist();
    }

    function iso() {
        return now().toISOString();
    }

    function persist() {
        if (!persistPath) return;
        fs.mkdirSync(path.dirname(persistPath), { recursive: true, mode: 0o700 });
        const tmp = `${persistPath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
        fs.renameSync(tmp, persistPath);
        try {
            fs.chmodSync(persistPath, 0o600);
        } catch (error) {
            // Some platforms cannot chmod the store. The secret is still encrypted.
        }
    }

    function assertLeagueCode(header) {
        if (!leagueCode) {
            throw new DeskError('unauthorized', 'Registration is closed until a league code is configured.', 401);
        }
        const provided = header == null ? '' : String(header);
        const a = hashToken(provided);
        const b = hashToken(leagueCode);
        if (!safeEqualHex(a, b)) {
            throw new DeskError('unauthorized', 'League code is incorrect.', 401);
        }
    }

    function assertCommissionerCode(header) {
        if (!commissionerCode) {
            throw new DeskError('unauthorized', 'Claims stay pending until a commissioner code is configured.', 401);
        }
        const provided = header == null ? '' : String(header);
        if (!safeEqualHex(hashToken(provided), hashToken(commissionerCode))) {
            throw new DeskError('unauthorized', 'Commissioner code is incorrect.', 401);
        }
    }

    async function resolveRoster(leagueId, teamId) {
        if (options.rosters) {
            const league = options.rosters[leagueId];
            const team = league && league[teamId];
            if (!team) {
                throw new DeskError('not_found', 'That team is not in this league.', 404);
            }
            return {
                teamName: canonicalTeamName(team.teamName, teamId),
                ownerId: team.ownerId || null
            };
        }
        if (typeof options.resolveRoster === 'function') {
            const team = await options.resolveRoster(leagueId, teamId);
            if (!team) {
                throw new DeskError('not_found', 'That team is not in this league.', 404);
            }
            return {
                teamName: canonicalTeamName(team.teamName, teamId),
                ownerId: team.ownerId || null
            };
        }
        const directory = await loadLeagueDirectory(leagueId);
        const team = directory[teamId];
        if (!team) {
            throw new DeskError('not_found', 'That team is not in this league.', 404);
        }
        return team;
    }

    function webhookSecretFrom(body) {
        if (!body || body.webhookSecret == null || body.webhookSecret === '') return null;
        return cleanText(body.webhookSecret, 200, { required: true, field: 'webhookSecret' });
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
            let webhookSecret = null;
            if (agent.webhookSecretEnc) {
                try {
                    webhookSecret = decryptSecret(agent.webhookSecretEnc, secretKey);
                } catch (error) {
                    agent.lastWebhookError = 'Webhook secret could not be decrypted.';
                    return;
                }
            }
            try {
                await notify({
                    webhookUrl: agent.webhookUrl,
                    webhookSecret,
                    lookup,
                    transport: options.webhookTransport
                }, event);
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

    function claimPurpose(value) {
        if (value == null || value === '') return null;
        const purpose = cleanText(value, 40, { required: true, field: 'purpose' });
        if (purpose !== 'register' && purpose !== 'rotate-owner') {
            throw new DeskError('validation', 'purpose must be register or rotate-owner.', 400);
        }
        return purpose;
    }

    function publicClaim(claim, options = {}) {
        const view = {
            id: claim.id,
            status: claim.status,
            purpose: claim.purpose,
            teamId: claim.teamId,
            teamName: claim.teamName,
            leagueId: claim.leagueId,
            agentName: claim.agentName,
            agentId: claim.agentId || null,
            createdAt: claim.createdAt,
            decidedAt: claim.decidedAt || null
        };
        if (options.commissioner) {
            view.rosterOwnerId = claim.rosterOwnerId || null;
        }
        return view;
    }

    function pendingClaim(input) {
        const duplicate = Object.values(state.claims).find((claim) => (
            claim.status === 'pending'
            && claim.leagueId === input.leagueId
            && claim.teamId === input.teamId
            && claim.purpose === input.purpose
        ));
        if (duplicate) {
            throw new DeskError('conflict', 'A claim for this team is already waiting for the commissioner.', 409);
        }
        const claimToken = createToken();
        const claim = {
            id: createId('claim'),
            purpose: input.purpose,
            status: 'pending',
            teamId: input.teamId,
            teamName: input.teamName,
            leagueId: input.leagueId,
            rosterOwnerId: input.roster && input.roster.ownerId ? input.roster.ownerId : null,
            agentName: input.name,
            description: input.description,
            webhookUrl: input.webhookUrl || null,
            webhookSecretEnc: input.webhookSecretEnc || null,
            agentId: input.agentId || null,
            claimTokenHash: hashToken(claimToken),
            pickupEnc: null,
            createdAt: iso(),
            decidedAt: null
        };
        state.claims[claim.id] = claim;
        persist();
        return {
            status: 'pending',
            claim: publicClaim(claim),
            claimToken
        };
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

        async registerAgent(input, meta = {}) {
            const body = input || {};
            const teamId = cleanId(body.teamId, 'teamId');
            const leagueId = cleanId(body.leagueId, 'leagueId');
            const name = cleanText(body.name, 80, { required: true, field: 'name' });
            const roster = await resolveRoster(leagueId, teamId);
            const teamName = roster.teamName;
            const description = cleanText(body.description, 280)
                || `${teamName} agent for trades, waiver priority, and FAAB.`;
            const existing = activeAgentForTeam(leagueId, teamId);
            const purpose = claimPurpose(body.purpose);
            if (existing && meta.bearerToken) {
                const auth = authenticate(meta.bearerToken);
                if (!auth || auth.role !== 'owner' || auth.agent.id !== existing.id) {
                    throw new DeskError(
                        'forbidden',
                        'An existing agent can only be replaced by that team owner.',
                        403
                    );
                }
                if (purpose !== 'rotate-owner') {
                    const webhookUrl = await assertWebhookUrl(body.webhookUrl, lookup);
                    const webhookSecret = webhookSecretFrom(body);
                    const agentToken = createToken();
                    existing.name = name;
                    existing.description = description;
                    existing.teamName = teamName;
                    existing.webhookUrl = webhookUrl;
                    existing.webhookSecretEnc = webhookSecret ? encryptSecret(webhookSecret, secretKey) : null;
                    delete existing.webhookSecret;
                    existing.agentTokenHash = hashToken(agentToken);
                    existing.lastWebhookError = null;
                    persist();
                    return {
                        agent: publicCard(existing, meta.baseUrl),
                        agentToken,
                        ownerToken: null
                    };
                }
            }

            assertLeagueCode(meta.leagueCode);
            if (existing || purpose === 'rotate-owner') {
                if (!existing) {
                    throw new DeskError('conflict', 'There is no active agent whose owner token can be rotated.', 409);
                }
                return pendingClaim({
                    purpose: 'rotate-owner',
                    teamId,
                    teamName,
                    leagueId,
                    roster,
                    name,
                    description,
                    agentId: existing.id
                });
            }

            const webhookUrl = await assertWebhookUrl(body.webhookUrl, lookup);
            const webhookSecret = webhookSecretFrom(body);
            return pendingClaim({
                purpose: 'register',
                teamId,
                teamName,
                leagueId,
                roster,
                name,
                description,
                webhookUrl,
                webhookSecretEnc: webhookSecret ? encryptSecret(webhookSecret, secretKey) : null
            });
        },

        listClaims(meta = {}) {
            assertCommissionerCode(meta.commissionerCode);
            const claims = Object.values(state.claims)
                .filter((claim) => !meta.status || claim.status === meta.status)
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .map((claim) => publicClaim(claim, { commissioner: true }));
            return { claims };
        },

        decideClaim(claimId, meta = {}) {
            assertCommissionerCode(meta.commissionerCode);
            const claim = state.claims[claimId];
            if (!claim) throw new DeskError('not_found', 'Claim not found.', 404);
            if (claim.status !== 'pending') {
                throw new DeskError('conflict', 'That claim has already been decided.', 409);
            }
            const decision = meta.decision === 'approve' ? 'approve' : meta.decision === 'deny' ? 'deny' : null;
            if (!decision) {
                throw new DeskError('validation', 'decision must be approve or deny.', 400);
            }
            if (decision === 'deny') {
                claim.status = 'denied';
                claim.decidedAt = iso();
                persist();
                return { claim: publicClaim(claim, { commissioner: true }) };
            }
            if (claim.purpose === 'rotate-owner') {
                const agent = state.agents[claim.agentId];
                if (!agent || agent.revokedAt) {
                    throw new DeskError('conflict', 'That agent is no longer active.', 409);
                }
                const ownerToken = createToken();
                agent.ownerTokenHash = hashToken(ownerToken);
                claim.pickupEnc = encryptSecret(JSON.stringify({ agentToken: null, ownerToken }), secretKey);
            } else {
                if (activeAgentForTeam(claim.leagueId, claim.teamId)) {
                    throw new DeskError('conflict', 'This team already has an active agent.', 409);
                }
                const agentToken = createToken();
                const ownerToken = createToken();
                const agent = {
                    id: createId('agent'),
                    teamId: claim.teamId,
                    teamName: claim.teamName,
                    leagueId: claim.leagueId,
                    name: claim.agentName,
                    description: claim.description,
                    webhookUrl: claim.webhookUrl,
                    webhookSecretEnc: claim.webhookSecretEnc,
                    agentTokenHash: hashToken(agentToken),
                    ownerTokenHash: hashToken(ownerToken),
                    createdAt: iso(),
                    revokedAt: null,
                    lastWebhookError: null
                };
                state.agents[agent.id] = agent;
                claim.agentId = agent.id;
                claim.pickupEnc = encryptSecret(JSON.stringify({ agentToken, ownerToken }), secretKey);
            }
            claim.status = 'approved';
            claim.decidedAt = iso();
            persist();
            return { claim: publicClaim(claim, { commissioner: true }) };
        },

        redeemClaim(claimId, claimToken, meta = {}) {
            const claim = state.claims[claimId];
            if (!claim || !claimToken) throw new DeskError('not_found', 'Claim not found.', 404);
            if (!safeEqualHex(hashToken(String(claimToken)), claim.claimTokenHash)) {
                throw new DeskError('unauthorized', 'Claim token is incorrect.', 401);
            }
            if (claim.status === 'pending' || claim.status === 'denied') {
                return { status: claim.status, claim: publicClaim(claim) };
            }
            if (!claim.pickupEnc) {
                throw new DeskError('gone', 'Those tokens were already retrieved.', 410);
            }
            const issued = JSON.parse(decryptSecret(claim.pickupEnc, secretKey));
            claim.pickupEnc = null;
            persist();
            const agent = claim.agentId ? state.agents[claim.agentId] : null;
            return {
                status: 'approved',
                claim: publicClaim(claim),
                agent: agent ? publicCard(agent, meta.baseUrl) : null,
                agentToken: issued.agentToken || null,
                ownerToken: issued.ownerToken || null
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
        state.claims = parsed.claims && typeof parsed.claims === 'object' ? parsed.claims : {};
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

function migrateWebhookSecrets(state, secretKey) {
    let dirty = false;
    Object.values(state.agents).forEach((agent) => {
        if (typeof agent.webhookSecret === 'string' && agent.webhookSecret) {
            agent.webhookSecretEnc = encryptSecret(agent.webhookSecret, secretKey);
            dirty = true;
        }
        if (Object.prototype.hasOwnProperty.call(agent, 'webhookSecret')) {
            delete agent.webhookSecret;
            dirty = true;
        }
    });
    return dirty;
}

module.exports = {
    CLOSED_STATES,
    DeskError,
    EXECUTION,
    KINDS,
    assertWebhookUrl,
    createDesk,
    hashToken,
    isBlockedIp,
    resolveWebhookTarget,
    validateTerms
};
