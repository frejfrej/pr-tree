import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { multiSelectMarkup } from '../public/multi-select.js';
import { multiSelectFilters } from '../public/filter-registry.js';
import { pullRequestKey } from '../public/pull-request-key.mjs';

/**
 * Runs the server in fixture mode on an ephemeral port and checks what it
 * serves: the app, the API, README.md for the help modal, and nothing else
 * from the project directory (config.js holds the credentials).
 */

const root = path.resolve(import.meta.dirname, '..');
let server;
let baseUrl;

before(async () => {
    server = spawn(process.execPath, ['index.mjs', '--fixtures'], {
        cwd: root,
        // The default address and names: a PR_TREE_HOST of the environment would change them
        env: { ...process.env, PORT: '0', PR_TREE_HOST: '', PR_TREE_ALLOWED_HOSTS: '' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    baseUrl = await new Promise((resolve, reject) => {
        let output = '';
        server.stdout.on('data', chunk => {
            output += chunk;
            const match = output.match(/Server is running at (http:\/\/localhost:\d+)/);
            if (match) resolve(match[1]);
        });
        server.stderr.on('data', chunk => { output += chunk; });
        server.on('error', reject);
        server.on('exit', code => reject(new Error(`server exited with code ${code}\n${output}`)));
        setTimeout(() => reject(new Error(`server did not start\n${output}`)), 10000).unref();
    });
});

after(async () => {
    // Wait for the exit: the server writes its coverage on the way out (npm run test:coverage)
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, 'exit');
    server.kill();
    await exited;
});

test('README.md is served for the help modal', async () => {
    const response = await fetch(`${baseUrl}/README.md`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/markdown/);
    assert.equal(await response.text(), readFileSync(path.join(root, 'README.md'), 'utf8'));
});

test('no other file of the project directory is served', async () => {
    // A literal `..` is normalised away by fetch itself, so only the encoded forms reach the server
    const files = ['config.js', 'config.js.default', 'index.mjs', 'cache.mjs', 'package.json',
        'access.log', 'CLAUDE.md', 'fixtures/generate.mjs', 'sync-cache.json',
        '..%2fconfig.js', 'README.md%2f..%2fconfig.js'];
    for (const file of files) {
        const response = await fetch(`${baseUrl}/${file}`);
        assert.equal(response.status, 404, `${file} must not be served`);
    }
});

// Absolute (`https:`) or protocol-relative (`//host`) URLs; `data:` URLs load nothing
const otherOrigin = url => /^(?:[a-z][a-z\d+.-]*:|\/\/|\\\\)/i.test(url.trim()) && !/^data:/i.test(url.trim());

test('the page loads nothing from another origin: its scripts, links, module imports and CSS urls are all local', async () => {
    const html = await (await fetch(`${baseUrl}/`)).text();
    const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)].map(([tag]) => tag);
    const urls = tags.flatMap(tag => [...tag.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
        .map(match => ({ tag, url: match[1] ?? match[2] ?? match[3] })));
    assert.ok(urls.some(({ url }) => url === 'vendor/fontawesome/css/all.min.css'));
    for (const { tag, url } of urls) assert.ok(!otherOrigin(url), `${tag} loads from another origin`);

    const publicDir = path.join(root, 'public');
    for (const file of readdirSync(publicDir).filter(name => /\.m?js$/.test(name))) {
        const source = readFileSync(path.join(publicDir, file), 'utf8');
        for (const [, specifier] of source.matchAll(/\b(?:from|import)\s*\(?\s*['"`]([^'"`]+)['"`]/g)) {
            assert.ok(!otherOrigin(specifier), `${file} imports ${specifier}`);
        }
    }
    for (const file of ['styles.css', 'vendor/fontawesome/css/all.min.css']) {
        const css = readFileSync(path.join(publicDir, file), 'utf8');
        for (const [, url] of css.matchAll(/url\(\s*['"]?([^'")]+)/g)) assert.ok(!otherOrigin(url), `${file} loads ${url}`);
    }
});

test('the vendored libraries are served: Marked for the help modal, the Font Awesome stylesheet and every font it names', async () => {
    const marked = await fetch(`${baseUrl}/vendor/marked/marked.esm.js`);
    assert.equal(marked.status, 200);
    assert.match(marked.headers.get('content-type'), /^(?:text|application)\/javascript/);
    assert.match(await marked.text(), /export\s*\{[^}]*\bas marked\b/);

    const css = await fetch(`${baseUrl}/vendor/fontawesome/css/all.min.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /^text\/css/);
    const fonts = [...(await css.text()).matchAll(/url\((\.\.\/webfonts\/[^)]+\.woff2)\)/g)].map(([, url]) => url);
    assert.equal(fonts.length, 3);
    for (const font of fonts) {
        const response = await fetch(new URL(font, `${baseUrl}/vendor/fontawesome/css/`));
        assert.equal(response.status, 200, `${font} must be served`);
        assert.match(response.headers.get('content-type'), /^font\/woff2/);
    }
});

test('the app and the API still answer', async () => {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    const version = await (await fetch(`${baseUrl}/api/version`)).json();
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(version.version, packageJson.version);
});

// A comment is not markup: the checks below read the page without them
const withoutComments = html => html.replace(/<!--[\s\S]*?-->/g, '');

// The attributes of an opening tag, up to its `>`: an attribute value may hold a `>`
const tagAttributes = `(?:[^>"']|"[^"]*"|'[^']*')*`;

// The opening tags of an element in a page
function openingTags(html, element) {
    return html.match(new RegExp(`<${element}\\b${tagAttributes}>`, 'g')) ?? [];
}

function attribute(tag, name) {
    return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

// The element with this id has text of its own before any child element
function hasTextById(html, id) {
    return new RegExp(`\\sid="${id}"${tagAttributes}>\\s*[^<\\s]`).test(html);
}

// The label for this id has text of its own before any child element
function hasLabelText(html, id) {
    return new RegExp(`<label\\b${tagAttributes}\\sfor="${id}"${tagAttributes}>\\s*[^<\\s]`).test(html);
}

test('every select and multi-select of the app has an accessible name (#62)', async () => {
    const html = withoutComments(await (await fetch(`${baseUrl}/`)).text());

    // The page holds every select of the app: no script makes one
    const scripts = readdirSync(path.join(root, 'public')).filter(file => /\.m?js$/.test(file));
    for (const script of scripts) {
        const source = readFileSync(path.join(root, 'public', script), 'utf8');
        assert.doesNotMatch(source, /<select\b|createElement\(\s*['"`]select/i, `${script} makes a select this test does not see`);
    }

    // A select is named by a <label for> with text, or by an aria-label when nothing visible names it
    const selects = openingTags(html, 'select');
    assert.ok(selects.length >= 3, 'the project, Work and SYNC selects');
    const labelled = new Set(openingTags(html, 'label').map(label => attribute(label, 'for')));
    for (const select of selects) {
        const id = attribute(select, 'id');
        const named = Boolean(attribute(select, 'aria-label')?.trim()) ||
            (labelled.has(id) && hasLabelText(html, id));
        assert.ok(named, select);
    }

    // A multi-select trigger is a button named by the visible label of its filter, then by its
    // selection; the page holds one per filter of the registry, and no other
    const classes = div => (attribute(div, 'class') ?? '').split(/\s+/);
    const multiSelects = openingTags(html, 'div').filter(div => classes(div).includes('multi-select'));
    assert.deepEqual(multiSelects.map(div => attribute(div, 'id')).sort(), multiSelectFilters.map(filter => filter.elementId).sort());
    for (const { elementId: id } of multiSelectFilters) {
        assert.ok(hasTextById(html, `${id}Label`), `the visible label ${id}Label`);
        const markup = multiSelectMarkup(id);
        const [trigger] = openingTags(markup, 'div').filter(div => attribute(div, 'class') === 'multi-select-trigger');
        assert.equal(attribute(trigger, 'role'), 'button');
        assert.equal(attribute(trigger, 'aria-expanded'), 'false');
        assert.equal(attribute(trigger, 'aria-labelledby'), `${id}Label ${id}Display`);
        assert.ok(hasTextById(markup, `${id}Display`), `the selection ${id}Display`);
        const [search] = openingTags(markup, 'input');
        assert.equal(attribute(search, 'aria-labelledby'), `${id}Label`, 'the search box is named by the label');
    }

    // The SYNC load button says what it loads, its visible text first
    const [loadButton] = openingTags(html, 'button').filter(button => attribute(button, 'id') === 'loadSyncButton');
    assert.equal(attribute(loadButton, 'aria-label'), 'Load SYNC status');
});

test('the per-pull-request conflicts endpoint is gone, the sync statuses endpoint stays', async () => {
    const conflicts = await fetch(`${baseUrl}/api/pull-request-conflicts/some-repository/abc..def`);
    assert.equal(conflicts.status, 404);
    // The projects come from projects.js, which users replace with their own
    const [project] = await (await fetch(`${baseUrl}/api/projects`)).json();
    assert.ok(project, 'no project configured');
    const statuses = await fetch(`${baseUrl}/api/sync-statuses/${encodeURIComponent(project)}`);
    assert.equal(statuses.status, 200);
    const body = await statuses.json();
    assert.equal(typeof body.statuses, 'object');
    assert.equal(body.stopped, null, 'a load that ran to its end says so');
});

test('each SYNC load computes again: the response is not cached outside a rate-limit pause (#49)', async () => {
    const [project] = await (await fetch(`${baseUrl}/api/projects`)).json();
    const load = async () => (await (await fetch(`${baseUrl}/api/sync-statuses/${encodeURIComponent(project)}`)).json()).lastRefreshTime;
    const first = await load();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.notEqual(await load(), first);
});

test('the sync statuses of the fixtures have the documented shapes', async () => {
    const projectNames = await (await fetch(`${baseUrl}/api/projects`)).json();
    assert.ok(projectNames.length > 0);
    for (const project of projectNames) {
        const { statuses } = await (await fetch(`${baseUrl}/api/sync-statuses/${encodeURIComponent(project)}`)).json();
        const values = Object.values(statuses);
        assert.ok(values.length > 0, project);
        for (const status of values) {
            if (status.error) {
                assert.equal(typeof status.reason, 'string');
            } else if (status.conflicts) {
                assert.ok(Array.isArray(status.files) && status.files.length > 0);
                if (status.reason !== undefined) assert.equal(typeof status.reason, 'string');
            } else {
                assert.deepEqual(status, { conflicts: false });
            }
        }
    }
});

test('the pull requests of a project have the documented shape, and the same dataHash on a second call', async () => {
    const [project] = await (await fetch(`${baseUrl}/api/projects`)).json();
    const response = await fetch(`${baseUrl}/api/pull-requests/${encodeURIComponent(project)}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    const data = await response.json();
    assert.deepEqual(Object.keys(data).sort(), ['dataHash', 'incomplete', 'jiraIssuesDetails', 'jiraIssuesMap', 'jiraSiteName', 'lastRefreshTime', 'orphanedIssues', 'pullRequests', 'rateLimitedUntil', 'sprintIssues', 'sprints']);
    assert.ok(!Number.isNaN(Date.parse(data.lastRefreshTime)), 'lastRefreshTime is a date');
    assert.equal(data.rateLimitedUntil, null, 'no pause in fixture mode');
    assert.deepEqual(data.incomplete, [], 'the fixtures have no gap');
    assert.ok(Array.isArray(data.pullRequests) && data.pullRequests.length > 0);
    assert.ok(Array.isArray(data.jiraIssuesDetails) && Array.isArray(data.sprints) && Array.isArray(data.orphanedIssues));
    for (const pullRequest of data.pullRequests) {
        // The commit counts come with the data; the issue keys of every pull request are in the map,
        // under the key the page computes, repository/id (#99)
        assert.ok('commitsAhead' in pullRequest && 'commitsBehind' in pullRequest, `pull request ${pullRequest.id}`);
        assert.ok(Array.isArray(data.jiraIssuesMap[pullRequestKey(pullRequest)]), `pull request ${pullRequestKey(pullRequest)} in jiraIssuesMap`);
    }
    for (const sprint of data.sprints) assert.ok(Array.isArray(data.sprintIssues[sprint.id]), `issues of sprint ${sprint.id}`);
    assert.match(data.dataHash, /^[0-9a-f]{32}$/);
    // Cached for two minutes: the second call is the same data
    const again = await (await fetch(`${baseUrl}/api/pull-requests/${encodeURIComponent(project)}`)).json();
    assert.equal(again.dataHash, data.dataHash);
});

test('an unknown project: 500 from the pull requests route, 404 from the sync statuses one', async () => {
    const pullRequests = await fetch(`${baseUrl}/api/pull-requests/NO_SUCH_PROJECT`);
    assert.equal(pullRequests.status, 500);
    assert.equal(await pullRequests.text(), 'Internal Server Error');
    const statuses = await fetch(`${baseUrl}/api/sync-statuses/NO_SUCH_PROJECT`);
    assert.equal(statuses.status, 404);
    assert.deepEqual(await statuses.json(), { error: 'Project not found' });
});

test('a project name inherited from Object.prototype is an unknown project too (#105)', async () => {
    // Before, the check found Object.prototype.constructor and the like, and the build failed further on (a 500)
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        const statuses = await fetch(`${baseUrl}/api/sync-statuses/${name}`);
        assert.equal(statuses.status, 404, name);
        assert.deepEqual(await statuses.json(), { error: 'Project not found' }, name);
        const pullRequests = await fetch(`${baseUrl}/api/pull-requests/${name}`);
        assert.equal(pullRequests.status, 500, name);
        assert.equal(await pullRequests.text(), 'Internal Server Error', name);
    }
});

test('the cache statistics answer the five counters of node-cache', async () => {
    const response = await fetch(`${baseUrl}/api/cache/stats`);
    assert.equal(response.status, 200);
    const stats = await response.json();
    assert.deepEqual(Object.keys(stats).sort(), ['hits', 'keys', 'ksize', 'misses', 'vsize']);
    for (const value of Object.values(stats)) assert.equal(typeof value, 'number');
    // The tests above filled the cache: the projects list and project data at least
    // (sync statuses are kept during a rate-limit pause only, #49)
    assert.ok(stats.keys >= 2, `${stats.keys} keys`);
    assert.ok(stats.hits > 0 && stats.misses > 0);
});

// fetch cannot set the Host header: a raw request to 127.0.0.1 with the given headers
function rawGet(urlPath, headers) {
    return new Promise((resolve, reject) => {
        const request_ = request({ host: '127.0.0.1', port: new URL(baseUrl).port, path: urlPath, headers }, response => {
            let body = '';
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body }));
        });
        request_.on('error', reject);
        request_.end();
    });
}

test('a request addressed to another host name gets a 403 on every route: a DNS-rebinding page reads nothing (#98)', async () => {
    const port = new URL(baseUrl).port;
    for (const urlPath of ['/api/pull-requests/SECOLLAB', '/api/version', '/', '/README.md']) {
        const response = await rawGet(urlPath, { Host: `evil.example:${port}` });
        assert.equal(response.status, 403, urlPath);
        assert.match(JSON.parse(response.body).error, /PR_TREE_ALLOWED_HOSTS/);
    }
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
        assert.equal((await rawGet('/api/version', { Host: host })).status, 200, host);
    }
});

test('an /api request a browser sends from another site gets a 403, a link from another site still opens the page (#98)', async () => {
    const crossSite = { 'Sec-Fetch-Site': 'cross-site' };
    const sync = await fetch(`${baseUrl}/api/sync-statuses/SECOLLAB`, { headers: crossSite });
    assert.equal(sync.status, 403);
    assert.deepEqual(await sync.json(), { error: 'Cross-site request refused' });
    assert.equal((await fetch(`${baseUrl}/api/version`, { headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/version`, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/`, { headers: { ...crossSite, 'Sec-Fetch-Mode': 'navigate' } })).status, 200);
});

test('the server listens on the loopback interface only by default: the other addresses of the machine are refused (#98)', async t => {
    const addresses = Object.values(networkInterfaces()).flat().filter(({ family, internal }) => family === 'IPv4' && !internal);
    if (addresses.length === 0) {
        t.skip('no network interface besides the loopback one');
        return;
    }
    const error = await new Promise(resolve => {
        const socket = connect({ host: addresses[0].address, port: Number(new URL(baseUrl).port) });
        socket.on('connect', () => { socket.destroy(); resolve(null); });
        socket.on('error', resolve);
        // An interface that drops packets (a VPN, a firewall) never answers: unreachable as well
        socket.setTimeout(2000, () => { socket.destroy(); resolve({ code: 'ETIMEDOUT' }); });
    });
    assert.ok(['ECONNREFUSED', 'ETIMEDOUT'].includes(error?.code), `${addresses[0].address} must not be reachable`);
});

test('the IPv6 loopback answers too, on the same port: localhost may resolve to ::1 alone (#98)', async t => {
    if (!Object.values(networkInterfaces()).flat().some(({ address, internal }) => internal && address === '::1')) {
        t.skip('no IPv6 loopback');
        return;
    }
    const response = await fetch(`http://[::1]:${new URL(baseUrl).port}/api/version`);
    assert.equal(response.status, 200);
});
