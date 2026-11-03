'use strict';

// Small agent client for the league negotiation desk.
// Tokens are bearer secrets. Pass them in memory or the environment, not on the command line
// of a shared machine if you can avoid it. This client never puts a token in a URL.

class A2AClient {
    constructor({ baseUrl, token }) {
        if (!baseUrl) throw new Error('baseUrl is required');
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.token = token || null;
    }

    static async register({ baseUrl, leagueCode, token, ...body }) {
        const data = await request(baseUrl, 'POST', '/api/a2a/agents', {
            body,
            leagueCode,
            token
        });
        return {
            agent: data.agent,
            agentToken: data.agentToken,
            ownerToken: data.ownerToken || null,
            client: new A2AClient({ baseUrl, token: data.agentToken }),
            owner: data.ownerToken ? new A2AClient({ baseUrl, token: data.ownerToken }) : null
        };
    }

    me() {
        return this.send('GET', '/api/a2a/me');
    }

    createTask({ kind, toTeamId, terms, text }) {
        return this.send('POST', '/api/a2a/tasks', { kind, toTeamId, terms, text });
    }

    listTasks() {
        return this.send('GET', '/api/a2a/tasks');
    }

    getTask(taskId) {
        return this.send('GET', `/api/a2a/tasks/${taskId}`);
    }

    message(taskId, { action, terms, text }) {
        return this.send('POST', `/api/a2a/tasks/${taskId}/messages`, { action, terms, text });
    }

    decide(taskId, decision) {
        return this.send('POST', `/api/a2a/tasks/${taskId}/decision`, { decision });
    }

    send(method, path, body) {
        return request(this.baseUrl, method, path, { token: this.token, body });
    }
}

async function request(baseUrl, method, path, { token, body, leagueCode } = {}) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (leagueCode) headers['x-league-code'] = leagueCode;
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error?.message || response.statusText);
        error.status = response.status;
        error.code = data.error?.code;
        error.body = data;
        throw error;
    }
    return data;
}

module.exports = { A2AClient, request };
