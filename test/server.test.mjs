import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
        env: { ...process.env, PORT: '0' },
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

after(() => {
    if (server) server.kill();
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
        'access.log', 'CLAUDE.md', 'fixtures/generate.mjs',
        '..%2fconfig.js', 'README.md%2f..%2fconfig.js'];
    for (const file of files) {
        const response = await fetch(`${baseUrl}/${file}`);
        assert.equal(response.status, 404, `${file} must not be served`);
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

test('the per-pull-request conflicts endpoint is gone, the sync statuses endpoint stays', async () => {
    const conflicts = await fetch(`${baseUrl}/api/pull-request-conflicts/some-repository/abc..def`);
    assert.equal(conflicts.status, 404);
    // The projects come from projects.js, which users replace with their own
    const [project] = await (await fetch(`${baseUrl}/api/projects`)).json();
    assert.ok(project, 'no project configured');
    const statuses = await fetch(`${baseUrl}/api/sync-statuses/${encodeURIComponent(project)}`);
    assert.equal(statuses.status, 200);
    assert.equal(typeof (await statuses.json()).statuses, 'object');
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
