import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostnameOf, canonicalHostname, isWildcardHost, hostnameMatcher, createRequestGuard, loopbackHostnames } from '../request-guard.mjs';

test('hostnameOf: the host name without the port, lower-cased, IPv6 compressed in brackets; null when missing or malformed', () => {
    assert.equal(hostnameOf('localhost:3000'), 'localhost');
    assert.equal(hostnameOf('LocalHost'), 'localhost');
    assert.equal(hostnameOf('localhost.:3000'), 'localhost', 'a fully qualified name with its trailing dot');
    assert.equal(hostnameOf('127.0.0.1:3000'), '127.0.0.1');
    assert.equal(hostnameOf('[::1]:3000'), '[::1]');
    assert.equal(hostnameOf('[::1]'), '[::1]');
    assert.equal(hostnameOf('[0:0:0:0:0:0:0:1]:3000'), '[::1]');
    assert.equal(hostnameOf('evil.example:3000'), 'evil.example');
    for (const header of [undefined, '', '::1', 'a:b:c', 'user@localhost', 'localhost/x', 'localhost:30a', '[::1', 'local host',
        '[localhost]', '[fe80::1%25en0]:3000', '.']) {
        assert.equal(hostnameOf(header), null, `${header} is malformed`);
    }
});

test('canonicalHostname and isWildcardHost: every spelling of an address is one name, :: however written is a wildcard', () => {
    assert.equal(canonicalHostname('FD00:0:0::5'), '[fd00::5]');
    assert.equal(canonicalHostname('[FD00::5]'), '[fd00::5]');
    assert.equal(canonicalHostname('fe80::1%en0'), null);
    for (const host of ['0.0.0.0', '::', '::0', '0:0:0:0:0:0:0:0']) assert.equal(isWildcardHost(host), true, host);
    for (const host of ['127.0.0.1', '::1', 'localhost', '192.168.1.20']) assert.equal(isWildcardHost(host), false, host);
});

const interfaces = {
    lo0: [{ address: '127.0.0.1' }, { address: '::1' }],
    en0: [{ address: '192.168.1.20' }, { address: 'fe80::1c2b:3a4d' }, { address: 'fd00::20' }]
};

test('hostnameMatcher: the loopback names, plus the address of PR_TREE_HOST', () => {
    const names = host => [...hostnameMatcher({ host, networkInterfaces: () => interfaces, machineName: 'Mac.local' }).names];
    assert.deepEqual(names('127.0.0.1'), loopbackHostnames);
    assert.deepEqual(names('192.168.1.20'), [...loopbackHostnames, '192.168.1.20']);
    assert.deepEqual(names('FD00:0::5'), [...loopbackHostnames, '[fd00::5]']);
    assert.equal(hostnameMatcher({ host: '127.0.0.1' }).isAllowed('192.168.1.20'), false);
});

test('hostnameMatcher: a wildcard PR_TREE_HOST accepts the addresses of the machine but the link-local ones, and the forms of its name; PR_TREE_ALLOWED_HOSTS adds names', () => {
    for (const [host, machineName] of [['0.0.0.0', 'Mac.local'], ['::', 'Mac'], ['::0', 'mac.local.']]) {
        assert.deepEqual([...hostnameMatcher({ host, networkInterfaces: () => interfaces, machineName, extraHosts: ['Dashboard.corp.example'] }).names].sort(),
            [...loopbackHostnames, '192.168.1.20', '[fd00::20]', 'mac.local', 'mac', 'dashboard.corp.example'].sort(), host);
    }
});

test('hostnameMatcher: with a wildcard, an address the machine gets after startup (Wi-Fi, VPN) is accepted without a restart', () => {
    let current = interfaces;
    const { names, isAllowed } = hostnameMatcher({ host: '0.0.0.0', networkInterfaces: () => current });
    assert.equal(isAllowed('10.8.0.2'), false);
    current = { ...interfaces, utun4: [{ address: '10.8.0.2' }] };
    assert.equal(isAllowed('10.8.0.2'), true);
    assert.equal(names.has('10.8.0.2'), false, 'the startup names are not changed');
    assert.equal(hostnameMatcher({ host: '127.0.0.1', networkInterfaces: () => current }).isAllowed('10.8.0.2'), false, 'only for a wildcard');
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
    const guard = createRequestGuard({ isAllowedHostname: hostnameMatcher({ host: '127.0.0.1' }).isAllowed, log: message => logged.push(message), ...options });
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
    assert.equal(logged.length, 1, 'one line a minute for the refusals of a Host');
    assert.match(logged[0], /^Refused GET \/api\/pull-requests\/SECOLLAB: Host "evil\.example:3000" is not a name of this server/);
    const withoutHost = guardWith();
    run(withoutHost.guard, { host: null });
    assert.match(withoutHost.logged[0], /Host null/);
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

test('a refusal is logged once a minute at most per kind, whatever the path or Host: a page sending requests in a loop does not fill the log', () => {
    let time = 0;
    const { guard, logged } = guardWith({ now: () => time });
    for (let i = 0; i < 5; i++) {
        run(guard, { path: `/api/sync-statuses/${i}`, site: 'cross-site' });
        run(guard, { host: `${i}.evil.example` });
    }
    assert.equal(logged.length, 2);
    assert.match(logged[0], /^Refused GET \/api\/sync-statuses\/0: request from another site .*not logged for a minute/);
    assert.match(logged[1], /Host "0\.evil\.example"/);
    time = 59999;
    run(guard, { path: '/api/sync-statuses/SECOLLAB', site: 'same-site' });
    assert.equal(logged.length, 2);
    time = 60000;
    const result = run(guard, { path: '/api/sync-statuses/SECOLLAB', site: 'same-site' });
    assert.equal(logged.length, 3);
    assert.equal(result.status, 403, 'refused even when not logged');
});
