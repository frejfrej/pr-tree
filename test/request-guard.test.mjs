import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostnameOf, allowedHostnames, createRequestGuard, loopbackHostnames } from '../request-guard.mjs';

test('hostnameOf: the host name without the port, lower-cased, IPv6 in brackets; null when missing or malformed', () => {
    assert.equal(hostnameOf('localhost:3000'), 'localhost');
    assert.equal(hostnameOf('LocalHost'), 'localhost');
    assert.equal(hostnameOf('127.0.0.1:3000'), '127.0.0.1');
    assert.equal(hostnameOf('[::1]:3000'), '[::1]');
    assert.equal(hostnameOf('[::1]'), '[::1]');
    assert.equal(hostnameOf('evil.example:3000'), 'evil.example');
    for (const header of [undefined, '', '::1', 'a:b:c', 'user@localhost', 'localhost/x', 'localhost:30a', '[::1', 'local host']) {
        assert.equal(hostnameOf(header), null, `${header} is malformed`);
    }
});

const interfaces = {
    lo0: [{ address: '127.0.0.1' }, { address: '::1' }],
    en0: [{ address: '192.168.1.20' }, { address: 'fe80::1c2b:3a4d' }]
};

test('allowedHostnames: the loopback names, plus the address of PR_TREE_HOST', () => {
    assert.deepEqual([...allowedHostnames({ host: '127.0.0.1', interfaces, machineName: 'Mac.local' })], loopbackHostnames);
    assert.deepEqual([...allowedHostnames({ host: '192.168.1.20' })], [...loopbackHostnames, '192.168.1.20']);
    assert.deepEqual([...allowedHostnames({ host: 'fd00::5' })], [...loopbackHostnames, '[fd00::5]']);
});

test('allowedHostnames: a wildcard PR_TREE_HOST accepts every address of the machine and its name; PR_TREE_ALLOWED_HOSTS adds names', () => {
    for (const host of ['0.0.0.0', '::']) {
        assert.deepEqual([...allowedHostnames({ host, interfaces, machineName: 'Mac.local', extraHosts: ['Dashboard.corp.example'] })],
            [...loopbackHostnames, '192.168.1.20', '[fe80::1c2b:3a4d]', 'mac.local', 'dashboard.corp.example']);
    }
});

// The middleware on a fake request and response
function run(guard, { host = 'localhost:3000', path = '/api/projects', site, method = 'GET' } = {}) {
    const headers = host === null ? {} : { host };
    if (site !== undefined) headers['sec-fetch-site'] = site;
    const res = {
        statusCode: 200, body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    let passed = false;
    guard({ method, path, headers }, res, () => { passed = true; });
    return { passed, status: res.statusCode, body: res.body };
}

const guardWith = (options = {}) => {
    const logged = [];
    const guard = createRequestGuard({ allowedHostnames: allowedHostnames({ host: '127.0.0.1' }), log: message => logged.push(message), ...options });
    return { guard, logged };
};

test('a request addressed to a loopback name passes', () => {
    const { guard, logged } = guardWith();
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST']) {
        assert.equal(run(guard, { host }).passed, true, host);
    }
    assert.deepEqual(logged, []);
});

test('another Host, or none, gets a 403 on every route: a page rebinding its DNS to 127.0.0.1 reads nothing', () => {
    const { guard, logged } = guardWith();
    for (const host of ['evil.example:3000', '192.168.1.20:3000', null]) {
        for (const path of ['/api/pull-requests/SECOLLAB', '/', '/README.md']) {
            const result = run(guard, { host, path });
            assert.equal(result.passed, false, `${host} ${path}`);
            assert.equal(result.status, 403);
            assert.match(result.body.error, /PR_TREE_ALLOWED_HOSTS/);
        }
    }
    assert.match(logged[0], /^Refused GET \/api\/pull-requests\/SECOLLAB: Host "evil\.example:3000" is not a name of this server/);
    assert.match(logged.at(-1), /Host null/);
});

test('an /api request from another site gets a 403, whatever the case of the path; the same origin, the address bar and no header pass', () => {
    const { guard } = guardWith();
    for (const site of ['cross-site', 'same-site']) {
        for (const path of ['/api/sync-statuses/SECOLLAB', '/API/sync-statuses/SECOLLAB', '/api']) {
            const result = run(guard, { path, site });
            assert.equal(result.passed, false, `${site} ${path}`);
            assert.equal(result.status, 403);
            assert.deepEqual(result.body, { error: 'Cross-site request refused' });
        }
    }
    for (const site of ['same-origin', 'none', undefined]) {
        assert.equal(run(guard, { path: '/api/sync-statuses/SECOLLAB', site }).passed, true, site);
    }
});

test('the page, its files and README.md open from a link on another site', () => {
    const { guard } = guardWith();
    for (const path of ['/', '/app.js', '/README.md', '/apiary.html']) {
        assert.equal(run(guard, { path, site: 'cross-site' }).passed, true, path);
    }
});

test('a refusal is logged once a minute at most per message, so a page sending requests in a loop does not fill the log', () => {
    let time = 0;
    const { guard, logged } = guardWith({ now: () => time });
    for (let i = 0; i < 5; i++) run(guard, { path: '/api/sync-statuses/SECOLLAB', site: 'cross-site' });
    run(guard, { host: 'evil.example' });
    assert.equal(logged.length, 2);
    time = 59999;
    run(guard, { path: '/api/sync-statuses/SECOLLAB', site: 'cross-site' });
    assert.equal(logged.length, 2);
    time = 60000;
    const result = run(guard, { path: '/api/sync-statuses/SECOLLAB', site: 'cross-site' });
    assert.equal(logged.length, 3);
    assert.equal(result.status, 403, 'refused even when not logged');
});
