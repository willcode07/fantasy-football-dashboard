import axios from 'axios';

export const SESSION_KEY = 'a2a_owner_sessions_v1';

export function a2aBase() {
    return (process.env.REACT_APP_A2A_BASE || '').replace(/\/$/, '');
}

function authHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function unwrap(promise) {
    try {
        const response = await promise;
        return response.data;
    } catch (error) {
        if (!error.response) {
            const offline = new Error('The negotiation desk is not running. Start it with npm run a2a.');
            offline.code = 'offline';
            throw offline;
        }
        const payload = error.response.data && error.response.data.error;
        const wrapped = new Error((payload && payload.message) || 'Request failed.');
        wrapped.code = (payload && payload.code) || 'request_failed';
        wrapped.status = error.response.status;
        throw wrapped;
    }
}

export function getHealth() {
    return unwrap(axios.get(`${a2aBase()}/health`, { timeout: 4000 }));
}

export function listAgents(leagueId) {
    return unwrap(axios.get(`${a2aBase()}/api/a2a/agents`, {
        params: { leagueId },
        timeout: 8000
    }));
}

export function registerAgent(body, { token, leagueCode } = {}) {
    const headers = { ...authHeaders(token) };
    if (leagueCode) headers['X-League-Code'] = leagueCode;
    return unwrap(axios.post(`${a2aBase()}/api/a2a/agents`, body, {
        headers,
        timeout: 8000
    }));
}

export function getMe(token) {
    return unwrap(axios.get(`${a2aBase()}/api/a2a/me`, {
        headers: authHeaders(token),
        timeout: 8000
    }));
}

export function listTasks(token) {
    return unwrap(axios.get(`${a2aBase()}/api/a2a/tasks`, {
        headers: authHeaders(token),
        timeout: 8000
    }));
}

export function getTask(taskId, token) {
    return unwrap(axios.get(`${a2aBase()}/api/a2a/tasks/${taskId}`, {
        headers: authHeaders(token),
        timeout: 8000
    }));
}

export function decideTask(taskId, token, decision) {
    return unwrap(axios.post(`${a2aBase()}/api/a2a/tasks/${taskId}/decision`, { decision }, {
        headers: authHeaders(token),
        timeout: 8000
    }));
}

export function revokeAgent(agentId, token) {
    return unwrap(axios.delete(`${a2aBase()}/api/a2a/agents/${agentId}`, {
        headers: authHeaders(token),
        timeout: 8000
    }));
}

export function listClaims({ commissionerCode, status } = {}) {
    return unwrap(axios.get(`${a2aBase()}/api/a2a/claims`, {
        params: status ? { status } : undefined,
        headers: commissionerCode ? { 'X-Commissioner-Code': commissionerCode } : {},
        timeout: 8000
    }));
}

export function decideClaim(claimId, decision, commissionerCode) {
    return unwrap(axios.post(`${a2aBase()}/api/a2a/claims/${claimId}/decision`, { decision }, {
        headers: { 'X-Commissioner-Code': commissionerCode },
        timeout: 8000
    }));
}

export function redeemClaim(claimId, claimToken) {
    return unwrap(axios.get(`${a2aBase()}/api/a2a/claims/${claimId}`, {
        headers: authHeaders(claimToken),
        timeout: 8000
    }));
}

function withoutOwnerToken(session) {
    if (!session || typeof session !== 'object') return session;
    const copy = { ...session };
    delete copy.ownerToken;
    return copy;
}

export function loadSessions() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map(withoutOwnerToken) : [];
    } catch (error) {
        return [];
    }
}

export function saveSessions(sessions) {
    const safe = (Array.isArray(sessions) ? sessions : []).map(withoutOwnerToken);
    localStorage.setItem(SESSION_KEY, JSON.stringify(safe));
}
