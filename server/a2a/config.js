'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '::0']);

function resolveListenHost(env = process.env) {
    const host = env.HOST == null || env.HOST === '' ? '127.0.0.1' : String(env.HOST);
    if (WILDCARD_HOSTS.has(host) && env.A2A_ALLOW_PUBLIC_BIND !== '1') {
        throw new Error(`Refusing to listen on ${host}. Set A2A_ALLOW_PUBLIC_BIND=1 to expose the desk beyond this machine.`);
    }
    return host;
}

function resolveLeagueCode(env = process.env, codePath) {
    if (env.A2A_LEAGUE_CODE) {
        return { code: String(env.A2A_LEAGUE_CODE), generated: false };
    }
    if (!codePath) {
        throw new Error('A league code file path is required when A2A_LEAGUE_CODE is unset.');
    }
    try {
        const existing = fs.readFileSync(codePath, 'utf8').trim();
        if (existing) return { code: existing, generated: false };
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const code = crypto.randomBytes(18).toString('hex');
    fs.mkdirSync(path.dirname(codePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(codePath, `${code}\n`, { mode: 0o600 });
    try {
        fs.chmodSync(codePath, 0o600);
    } catch (error) {
        // The code is still only in this file.
    }
    return { code, generated: true };
}

function resolvePublicBase(env = process.env, port = 8787) {
    const raw = env.A2A_PUBLIC_URL;
    if (!raw) return `http://127.0.0.1:${port}`;
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (error) {
        throw new Error('A2A_PUBLIC_URL must be an http(s) URL.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('A2A_PUBLIC_URL must use http or https.');
    }
    if (parsed.username || parsed.password) {
        throw new Error('A2A_PUBLIC_URL cannot include credentials.');
    }
    return parsed.href.replace(/\/$/, '');
}

function resolveSecretKey(env = process.env, keyPath) {
    if (env.A2A_SECRET_KEY) {
        return crypto.createHash('sha256').update(String(env.A2A_SECRET_KEY)).digest();
    }
    if (!keyPath) return crypto.randomBytes(32);
    try {
        const existing = fs.readFileSync(keyPath);
        if (existing.length === 32) return existing;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    try {
        fs.chmodSync(keyPath, 0o600);
    } catch (error) {
        // The key file is still unreadable to other users when the mode stuck.
    }
    return key;
}

function resolveCorsOrigins(env = process.env) {
    const raw = env.A2A_CORS_ORIGIN;
    if (raw == null || String(raw).trim() === '') {
        return ['http://127.0.0.1:3000', 'http://localhost:3000'];
    }
    return String(raw).split(',').map((item) => item.trim()).filter(Boolean);
}

module.exports = {
    resolveCorsOrigins,
    resolveLeagueCode,
    resolveListenHost,
    resolvePublicBase,
    resolveSecretKey
};
