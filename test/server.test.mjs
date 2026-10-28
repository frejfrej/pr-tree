import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { multiSelectMarkup } from '../public/multi-select.js';
import { multiSelectFilters } from '../public/filter-registry.js';
import { pullRequestKey } from '../public/pull-request-key.mjs';
import { contentSecurityPolicy } from '../security-headers.mjs';
import { pageBuildHeader, pageBuildOf } from '../page-build.mjs';

/**
 * Runs the server in fixture mode on an ephemeral port and checks what it
 * serves: the app, the API, README.md for the help modal, and nothing else
 * from the project directory (config.js holds the credentials). The server
 * is started from another directory, which has a public/ folder of its own:
 * nothing it serves depends on the working directory (#107). That directory
 * also holds decoys of the project files that must not be served, so a static
 * middleware mounted on the working directory is caught as well as one
 * mounted on the project directory.
 */

const root = path.resolve(import.meta.dirname, '..');
// The project files that must never be served (config.js holds the credentials)
const privateFiles = ['config.js', 'config.js.default', 'index.mjs', 'cache.mjs', 'package.json',
    'access.log', 'CLAUDE.md', 'fixtures/generate.mjs', 'sync-cache.json'];
let workingDirectory;
let server;
let baseUrl;

before(async () => {
    workingDirectory = mkdtempSync(path.join(tmpdir(), 'pr-tree-cwd-'));
    for (const file of ['public/index.html', ...privateFiles]) {
        mkdirSync(path.join(workingDirectory, path.dirname(file)), { recursive: true });
        writeFileSync(path.join(workingDirectory, file), 'a decoy in the working directory');
    }
    server = spawn(process.execPath, [path.join(root, 'index.mjs'), '--fixtures'], {
        cwd: workingDirectory,
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
    if (server && server.exitCode === null && server.signalCode === null) {
        const exited = once(server, 'exit');
        server.kill();
        await exited;
    }
    if (workingDirectory) rmSync(workingDirectory, { recursive: true, force: true });
});

test('the page comes from the public/ folder of the dashboard, whatever the working directory', async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), readFileSync(path.join(root, 'public', 'index.html'), 'utf8'));
});

test('README.md is served for the help modal', async () => {
    const response = await fetch(`${baseUrl}/README.md`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/markdown/);
    assert.equal(await response.text(), readFileSync(path.join(root, 'README.md'), 'utf8'));
});

test('no other file of the project directory, nor of the working directory, is served', async () => {
    // A literal `..` is normalised away by fetch itself, so only the encoded forms reach the server
    const files = [...privateFiles, '..%2fconfig.js', 'README.md%2f..%2fconfig.js'];
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
        assert.equal(attribute(trigger, 'aria-controls'), `${id}Dropdown`, 'the trigger points at what it opens (#109)');
        const [dropdown] = openingTags(markup, 'div').filter(div => attribute(div, 'class') === 'multi-select-dropdown');
        assert.equal(attribute(dropdown, 'id'), `${id}Dropdown`);
        assert.equal(attribute(dropdown, 'role'), 'group');
        assert.equal(attribute(dropdown, 'aria-labelledby'), `${id}Label`, 'the dropdown is named by the label');
        assert.ok(hasTextById(markup, `${id}Display`), `the selection ${id}Display`);
        const [search] = openingTags(markup, 'input');
        assert.equal(attribute(search, 'aria-labelledby'), `${id}Label`, 'the search box is named by the label');
    }

    // A checkbox is named by the label wrapping it, which has text of its own
    const checkboxes = openingTags(html, 'input').filter(input => attribute(input, 'type') === 'checkbox');
    assert.deepEqual(checkboxes.map(input => attribute(input, 'id')), ['hideDraftsCheckbox']);
    assert.match(html, /<label\b[^>]*\sfor="hideDraftsCheckbox"[^>]*>\s*<input\b[^>]*>\s*Hide drafts\s*<\/label>/);

    // The SYNC load button says what it loads, its visible text first
    const [loadButton] = openingTags(html, 'button').filter(button => attribute(button, 'id') === 'loadSyncButton');
    assert.equal(attribute(loadButton, 'aria-label'), 'Load SYNC status');
});

test('every button and link of the page has a name of its own, and the icons inside them are hidden (#109)', async () => {
    const html = withoutComments(await (await fetch(`${baseUrl}/`)).text());
    const elements = [...html.matchAll(new RegExp(`(<(button|a)\\b${tagAttributes}>)([\\s\\S]*?)</\\2>`, 'g'))];
    assert.ok(elements.length >= 10, 'the banner, sidebar, toolbar and help buttons');
    for (const [, tag, , content] of elements) {
        // An icon is no name: the sidebar toggle's badge number was its whole name with filters active
        const text = content.replace(/<i\b[^>]*><\/i>/g, '').replace(/<span\b[^>]*class="header-badge"[^>]*><\/span>/g, '')
            .replace(/<[^>]+>/g, '').trim();
        assert.ok(text || attribute(tag, 'aria-label')?.trim(), `${tag} has a name`);
        for (const icon of openingTags(content, 'i')) assert.equal(attribute(icon, 'aria-hidden'), 'true', `${icon} in ${tag}`);
    }
    for (const id of ['sidebarToggle', 'themeToggle', 'helpButton']) {
        const [button] = openingTags(html, 'button').filter(tag => attribute(tag, 'id') === id);
        assert.ok(attribute(button, 'aria-label'), `${id} is named by its aria-label, not by its tooltip alone`);
    }
});

test('the copy buttons of the tree report to screen readers through one status region, outside the tree pane a render replaces', async () => {
    const html = withoutComments(await (await fetch(`${baseUrl}/`)).text());
    const [region] = openingTags(html, 'span').filter(span => attribute(span, 'id') === 'copyStatus');
    assert.ok(region, 'the copyStatus region');
    assert.equal(attribute(region, 'role'), 'status');
    assert.equal(attribute(region, 'class'), 'visually-hidden');
    assert.ok(html.indexOf('id="copyStatus"') < html.indexOf('id="pull-requests"'));
    const css = await (await fetch(`${baseUrl}/styles.css`)).text();
    assert.match(css, /\.visually-hidden\s*\{[^}]*position:\s*absolute/);
});

test('the help is a dialog the browser makes modal: focus moved in, page behind inert, Escape (#109)', async () => {
    const html = withoutComments(await (await fetch(`${baseUrl}/`)).text());
    const [dialog] = openingTags(html, 'dialog');
    assert.equal(attribute(dialog, 'id'), 'helpModal');
    assert.ok(attribute(dialog, 'aria-label'));
    assert.doesNotMatch(dialog, /\shidden\b/, 'a closed dialog is hidden by the browser');
    const shell = readFileSync(path.join(root, 'public', 'app-shell.js'), 'utf8');
    assert.match(shell, /\.showModal\(\)/);
});

test('every /api answer names the build of the page served, a 404 included; the page files do not (#125)', async () => {
    const build = pageBuildOf(path.join(root, 'public'));
    for (const route of ['version', 'projects', 'cache/stats', 'pull-requests/SECOLLAB', 'sync-statuses/SECOLLAB', 'pull-requests/NO_SUCH_PROJECT']) {
        const response = await fetch(`${baseUrl}/api/${route}`);
        await response.arrayBuffer();
        assert.equal(response.headers.get(pageBuildHeader), build, route);
    }
    for (const file of ['', 'app.js']) {
        const response = await fetch(`${baseUrl}/${file}`);
        await response.arrayBuffer();
        assert.equal(response.headers.get(pageBuildHeader), null, file);
    }
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

test('an unknown project: 404 from both routes (#105)', async () => {
    const pullRequests = await fetch(`${baseUrl}/api/pull-requests/NO_SUCH_PROJECT`);
    assert.equal(pullRequests.status, 404);
    assert.deepEqual(await pullRequests.json(), { error: 'Project not found' });
    const statuses = await fetch(`${baseUrl}/api/sync-statuses/NO_SUCH_PROJECT`);
    assert.equal(statuses.status, 404);
    assert.deepEqual(await statuses.json(), { error: 'Project not found' });
});

test('a project name inherited from Object.prototype is an unknown project too (#105)', async () => {
    // Before, the check found Object.prototype.constructor and the like, and the build failed further on (a 500)
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        for (const route of ['sync-statuses', 'pull-requests']) {
            const response = await fetch(`${baseUrl}/api/${route}/${name}`);
            assert.equal(response.status, 404, `${route}/${name}`);
            assert.deepEqual(await response.json(), { error: 'Project not found' }, `${route}/${name}`);
        }
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
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
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

test('every answer of the app carries the Content-Security-Policy and the security headers, a refusal included; Express does not announce itself (#110)', async () => {
    const port = new URL(baseUrl).port;
    const responses = [
        await fetch(`${baseUrl}/`), await fetch(`${baseUrl}/app.js`), await fetch(`${baseUrl}/README.md`),
        await fetch(`${baseUrl}/api/version`), await fetch(`${baseUrl}/api/pull-requests/NO_SUCH_PROJECT`)
    ].map(response => name => response.headers.get(name));
    const refused = await rawGet('/', { Host: `evil.example:${port}` });
    assert.equal(refused.status, 403);
    for (const get of [...responses, name => refused.headers[name] ?? null]) {
        assert.equal(get('content-security-policy'), contentSecurityPolicy);
        assert.equal(get('x-content-type-options'), 'nosniff');
        assert.equal(get('referrer-policy'), 'no-referrer');
        assert.equal(get('x-powered-by'), null);
    }
    // The policy itself: the page's own origin only, no inline script, no eval; style attributes only (Bitbucket's tables)
    const directives = contentSecurityPolicy.split('; ');
    for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "style-src-attr 'unsafe-inline'", "font-src 'self'",
        "img-src 'self' https: data:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) {
        assert.ok(directives.includes(directive), directive);
    }
    assert.deepEqual(directives.filter(directive => /unsafe/.test(directive)), ["style-src-attr 'unsafe-inline'"]);
    // Express's own pages (a static file not found) keep its stricter policy
    assert.equal((await fetch(`${baseUrl}/no-such-file.js`)).headers.get('content-security-policy'), "default-src 'none'");
});

test('the page has nothing the policy would block: no inline script, no inline event handler, no <style>, no javascript: URL (#110)', async () => {
    const html = withoutComments(await (await fetch(`${baseUrl}/`)).text());
    for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        assert.match(attributes, /\bsrc=/, 'every script is a file');
        assert.equal(body.trim(), '', 'no inline script');
    }
    // The page and the markup the scripts build or set: an attribute inside a tag, or set by setAttribute
    const publicDir = path.join(root, 'public');
    const sources = { 'index.html': html, ...Object.fromEntries(readdirSync(publicDir).filter(name => /\.m?js$/.test(name))
        .map(name => [name, readFileSync(path.join(publicDir, name), 'utf8')])) };
    const blocked = {
        'an inline event handler': /<[a-z][^<>]*\son[a-z]+\s*=/i,
        'a handler set as an attribute': /setAttribute\(\s*['"`]on[a-z]+['"`]/i,
        'a <style> element': /<style\b/i,
        'a javascript: URL': /javascript:/i
    };
    for (const [name, source] of Object.entries(sources)) {
        for (const [what, pattern] of Object.entries(blocked)) assert.doesNotMatch(source, pattern, `${name} has ${what}`);
    }
});
