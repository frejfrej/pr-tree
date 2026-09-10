# Serve README.md Through One Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static middleware mounted on the project directory (which serves `config.js`, the logs and the sources) with one route that sends `README.md`, proven by a test that runs the server.

**Architecture:** `index.mjs` keeps `express.static('public')` and gets `app.get('/README.md', ...)` with `res.sendFile`; the root `express.static(__dirname, ...)` goes. The listen callback logs `server.address().port` so the server can run on `PORT=0`. A new `test/server.test.mjs` spawns `node index.mjs --fixtures` with `PORT=0`, reads the port from stdout and checks what is served.

**Tech Stack:** Node 24 (global `fetch`, `import.meta.dirname`), Express 5, `node:test`. No frontend change.

**Spec:** `docs/superpowers/specs/2026-09-10-serve-readme-route-design.md`

**Branch:** `claude/serve-readme-route`, created from `master` (already checked out). Do not `git add` `config.js`, `config.js.test` or `.claude/`; add files by name. Commit messages end with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay
```

**CRLF:** `index.mjs` uses CRLF line endings on every line (800 lines, 800 carriage returns). After editing it, check `grep -c $'\r' index.mjs` equals `wc -l < index.mjs` and that `git diff --stat index.mjs` reports about 15 changed lines; if the whole file shows as changed, restore the endings with `perl -pi -e 's/\r?\n/\r\n/' index.mjs` and check again. New files (the test) use LF like the other tests.

**Running the unit tests:** `npm test`, expected to end with `ℹ fail 0` (73 tests before this plan, 76 after). The server test appends a few lines to `access.log` and `performance.log` in the project directory (the server opens its logs there); this is accepted by the spec.

---

### Task 1: The regression test, then the route

**Files:**
- Create: `test/server.test.mjs`
- Modify: `index.mjs:46-53` (static middlewares) and `index.mjs:796-801` (listen)

- [ ] **Step 1: Write the failing test**

Create `test/server.test.mjs`:

```js
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
    const files = ['config.js', 'config.js.default', 'index.mjs', 'cache.mjs', 'package.json',
        'access.log', 'CLAUDE.md', 'fixtures/generate.mjs'];
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
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npm test`
Expected: `test/server.test.mjs` fails. With the current `index.mjs` the startup log prints `http://localhost:0` (the `PORT` string, not the bound port), so the `before` hook resolves a URL on port 0 and every fetch fails with a connection error; that is the failure to expect. (Once Step 3 logs the real port and before the middleware is removed, the failure would be `config.js must not be served`: 200 instead of 404.)

- [ ] **Step 3: Replace the root static middleware with the route, log the bound port**

In `index.mjs`, replace

```js
// Serve all files in the public folder
app.use(express.static('public'));

// Serve README.md from the root directory
app.use(express.static(__dirname, {
    index: false, // Prevent serving index.html from root
    extensions: ['md'] // Allow serving .md files without extension
}));
```

with

```js
// Serve all files in the public folder
app.use(express.static('public'));

// The help modal fetches the README from the root. This route is the only
// thing served from the project directory: a static middleware mounted on it
// served config.js (the credentials), the logs and the sources too.
app.get('/README.md', (req, res) => {
    res.sendFile(path.join(__dirname, 'README.md'));
});
```

and replace the listen block at the end of the file

```js
app.listen(port, () => {
    log(`Server is running at http://localhost:${port}`, accessLogStream);
    if (fixtureSource) {
        log(`Fixture mode: serving generated data for ${Object.keys(config.projects).join(', ')} (scale ${fixtureSource.scale}, deepest stack ${fixtureSource.chainDepth}), no Atlassian request will be made`, accessLogStream);
    }
});
```

with

```js
const server = app.listen(port, () => {
    // The port actually bound: PORT=0 lets the OS pick one (the server test does that)
    log(`Server is running at http://localhost:${server.address().port}`, accessLogStream);
    if (fixtureSource) {
        log(`Fixture mode: serving generated data for ${Object.keys(config.projects).join(', ')} (scale ${fixtureSource.scale}, deepest stack ${fixtureSource.chainDepth}), no Atlassian request will be made`, accessLogStream);
    }
});
```

Keep the CRLF endings (see the header of this plan).

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test`
Expected: `ℹ tests 76`, `ℹ fail 0`.

- [ ] **Step 5: Check the diff**

Run: `grep -c $'\r' index.mjs; wc -l < index.mjs; git diff --stat`
Expected: the two counts are equal; `index.mjs` shows about 15 changed lines and no other tracked file changed.

- [ ] **Step 6: Commit**

```bash
git add index.mjs test/server.test.mjs
git commit -m "fix: serve README.md through one route, the project directory is no longer served (#40)

The static middleware mounted on the project directory served config.js
(the Bitbucket and Jira credentials), the logs and the sources to anyone
who could reach the port. The startup log now shows the port actually
bound, so the new server test can run on PORT=0.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 2: Version 2.5.2 and the documentation

**Files:**
- Modify: `package.json:3` (version)
- Modify: `README.md` (changelog, after the `## Changelog:` line)
- Modify: `CLAUDE.md` (version line, `index.mjs` description, security considerations, testing approach)
- Modify: `PRD.md` (6.5 Security)

- [ ] **Step 1: package.json**

Set `"version": "2.5.2"` (the `releaseDate` stays `2026-09-10`).

- [ ] **Step 2: README changelog**

Insert right after the line `## Changelog:` (before `* Version 2.5.1`):

```
* Version 2.5.2
    * `README.md` is served by a dedicated route; the static middleware that served it from the project directory also served `config.js` (the Bitbucket and Jira credentials), the logs and the sources to anyone who could reach the port (#40)
    * The startup log shows the port actually bound, so `PORT=0` reports the port the OS picked
    * `npm test` starts the server in fixture mode and checks what it serves from the project directory
```

- [ ] **Step 3: CLAUDE.md**

Four edits:

1. `Current version: **2.5.1** (as of 2026-09-10)` becomes `Current version: **2.5.2** (as of 2026-09-10)`.
2. In the `**index.mjs**` bullet list of "Key Files Explained", replace `- Static file serving for public directory` with `- Static file serving for the public directory; `README.md` is served through a dedicated route (the help modal fetches it) and nothing else of the project directory is reachable over HTTP`.
3. In "Security Considerations", add after the `**No input validation**` bullet: `- **Only public/ and README.md are served**: never mount a static middleware on the project directory, it would serve config.js, the logs and the sources (fixed in 2.5.2); `test/server.test.mjs` checks it`.
4. In "Testing Approach", the `**Unit tests**` bullet ends with `and the fixture generator (volumes, determinism, deep stack, hierarchy); no DOM, no extra dependency`; append `; `test/server.test.mjs` starts the server in fixture mode on an ephemeral port (`PORT=0`) and checks what it serves (the app, the API, `README.md`, nothing else of the project directory)` before the final period of that sentence, i.e. the bullet ends with `no DOM, no extra dependency; `test/server.test.mjs` starts the server ... of the project directory)`.

- [ ] **Step 4: PRD.md**

In `### 6.5 Security`, add after the NFR-SEC4 line:

```
- **NFR-SEC5**: Only the `public/` directory and `README.md` are served over HTTP; no other file of the project directory (configuration, logs, sources) is reachable
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: `ℹ tests 76`, `ℹ fail 0` (the server test compares `/api/version` with package.json, so the bump must be consistent).

- [ ] **Step 6: Commit**

```bash
git add package.json README.md CLAUDE.md PRD.md
git commit -m "docs: version 2.5.2, README.md served through one route (#40)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 3 (controller): verification and pull request

- [ ] `npm test` ends with `ℹ fail 0` and 76 tests.
- [ ] `PORT=3101 node index.mjs --fixtures` in the background; `curl -sI localhost:3101/config.js` answers `404`, `curl -sI localhost:3101/README.md` answers `200` with `text/markdown`, `curl -sI localhost:3101/access.log` answers `404`; stop the server.
- [ ] Push the branch and open the pull request to `master` with `Closes #40`.
