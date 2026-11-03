'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const test = require('node:test');
const {
    loadEnvFile,
    resolveCorsOrigins,
    resolveLeagueCode,
    resolveListenHost,
    resolvePublicBase,
    resolveSecretKey
} = require('./config');

test('wildcard binds are refused unless explicitly allowed', () => {
    assert.equal(resolveListenHost({}), '127.0.0.1');
    assert.throws(() => resolveListenHost({ HOST: '0.0.0.0' }), /Refusing to listen on 0\.0\.0\.0/);
    assert.throws(() => resolveListenHost({ HOST: '::' }), /Refusing to listen on ::/);
    assert.throws(() => resolveListenHost({ HOST: '::0' }), /Refusing to listen on ::0/);
    assert.equal(resolveListenHost({ HOST: '0.0.0.0', A2A_ALLOW_PUBLIC_BIND: '1' }), '0.0.0.0');
    assert.equal(resolveListenHost({ HOST: '127.0.0.1' }), '127.0.0.1');
});

test('the desk process exits instead of listening on every interface', async () => {
    const dataFile = path.join(os.tmpdir(), `a2a-bind-${process.pid}.json`);
    const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
        env: {
            ...process.env,
            HOST: '0.0.0.0',
            A2A_LEAGUE_CODE: 'spawn-test-code',
            A2A_SECRET_KEY: 'spawn-test-key',
            A2A_DATA: dataFile
        }
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
        output += chunk;
    });
    child.stderr.on('data', (chunk) => {
        output += chunk;
    });
    const code = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', resolve);
    });
    assert.notEqual(code, 0);
    assert.match(output, /Refusing to listen on 0\.0\.0\.0/);
    assert.equal(fs.existsSync(dataFile), false);
});

test('a missing league code is generated once and then reused', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-code-'));
    const codePath = path.join(dir, 'league-code');
    const first = resolveLeagueCode({}, codePath);
    assert.equal(first.generated, true);
    assert.equal(first.code.length >= 16, true);
    assert.equal(fs.statSync(codePath).mode & 0o777, 0o600);
    const second = resolveLeagueCode({}, codePath);
    assert.equal(second.generated, false);
    assert.equal(second.code, first.code);
    assert.deepEqual(resolveLeagueCode({ A2A_LEAGUE_CODE: 'from-env' }, codePath), {
        code: 'from-env',
        generated: false
    });
    assert.deepEqual(resolveLeagueCode({ A2A_LEAGUE_CODE: 'desk-code-example' }), {
        code: 'desk-code-example',
        generated: false
    });
    const example = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
    assert.match(example, /^A2A_LEAGUE_CODE=replace-with-a-private-code$/m);
    assert.equal(example.includes('A2A_COMMISSIONER_CODE'), false);
    const readme = fs.readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8');
    assert.match(readme, /226/);
    assert.match(readme, /git history/i);
    assert.match(readme, /rotat/i);
    const privateSurfaces = [
        example,
        fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'AgentDesk.js'), 'utf8')
    ];
    privateSurfaces.forEach((source) => {
        assert.equal(source.includes('226'), false);
    });
});

test('loadEnvFile fills missing keys and leaves existing environment values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-env-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, [
        '# comment',
        'A2A_LEAGUE_CODE=desk-code-example',
        'A2A_SECRET_KEY="from-file"',
        'A2A_PUBLIC_URL=\'https://desk.example.com\'',
        ''
    ].join('\n'));
    const env = { A2A_SECRET_KEY: 'keep-me', A2A_LEAGUE_CODE: '' };
    loadEnvFile(file, env);
    assert.equal(env.A2A_LEAGUE_CODE, 'desk-code-example');
    assert.equal(env.A2A_SECRET_KEY, 'keep-me');
    assert.equal(env.A2A_PUBLIC_URL, 'https://desk.example.com');
    loadEnvFile(path.join(dir, 'missing.env'), env);
    assert.equal(env.A2A_LEAGUE_CODE, 'desk-code-example');
});

test('public URL and secret key stay local and unreadable to other users', () => {
    assert.equal(resolvePublicBase({}, 8787), 'http://127.0.0.1:8787');
    assert.equal(resolvePublicBase({ A2A_PUBLIC_URL: 'https://desk.example.com/a2a/' }), 'https://desk.example.com/a2a');
    assert.throws(() => resolvePublicBase({ A2A_PUBLIC_URL: 'http://user:pass@desk.example.com' }), /credentials/);
    assert.throws(() => resolvePublicBase({ A2A_PUBLIC_URL: 'ftp://desk.example.com' }), /http/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-key-'));
    const keyPath = path.join(dir, 'secret.key');
    const first = resolveSecretKey({}, keyPath);
    assert.equal(first.length, 32);
    assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600);
    const second = resolveSecretKey({}, keyPath);
    assert.equal(Buffer.compare(first, second), 0);
    const fromEnv = resolveSecretKey({ A2A_SECRET_KEY: 'phrase' });
    assert.equal(fromEnv.length, 32);
    assert.equal(Buffer.compare(fromEnv, first) === 0, false);
});

test('browser origins are an allowlist', () => {
    assert.deepEqual(resolveCorsOrigins({}), ['http://127.0.0.1:3000', 'http://localhost:3000']);
    assert.deepEqual(resolveCorsOrigins({ A2A_CORS_ORIGIN: 'https://league.example, http://127.0.0.1:3000' }), [
        'https://league.example',
        'http://127.0.0.1:3000'
    ]);
});
