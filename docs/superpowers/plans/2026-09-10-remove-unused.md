# Remove What Nothing Uses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dependencies, the endpoint, the exports, the methods, the config fields and the file that nothing uses, and make the documentation follow (#41).

**Architecture:** Pure removals. The server keeps `express`, `node-cache` and `node-diff3` and uses the `fetch` built into Node; the sync-statuses endpoint keeps the conflict computation it needs; the frontend loses two multi-select methods and two render leftovers. The server test gains one check (the removed route answers 404).

**Tech Stack:** Node 24 (built-in `fetch`), Express 5, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-10-remove-unused-design.md`

**Branch:** `claude/remove-unused`, created from `claude/serve-readme-route` (already checked out). Do not `git add` `config.js`, `config.js.test` or `.claude/`; add files by name. Commit messages end with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay
```

**CRLF:** `index.mjs`, `cache.mjs`, `public/multi-select.js` and `package-lock.json` use CRLF line endings on every line. After editing one of them, check `grep -c $'\r' <file>` equals `wc -l < <file>` and that `git diff --stat <file>` reports only the lines you meant to change; if the whole file shows as changed, restore the endings with `perl -pi -e 's/\r?\n/\r\n/' <file>` and check again. The other files use LF.

**Running the unit tests:** `npm test`, expected to end with `ℹ fail 0` (76 tests before this plan, 77 after Task 2). The server test starts the server in fixture mode on `PORT=0`; never start the server yourself on a fixed port (3000 and 3100 are taken on this machine; 3101 is for the controller's manual checks).

---

### Task 1: The three dependencies

**Files:**
- Modify: `package.json` (dependencies), `package-lock.json` (CRLF, rewritten by npm)
- Modify: `index.mjs:1-22` (CRLF; the imports and `dotenv.config()`)

- [ ] **Step 1: Uninstall**

Run: `npm uninstall fetch node-fetch dotenv`
Expected: `package.json` keeps `express`, `node-cache` and `node-diff3` only; `package-lock.json` loses the entries of `fetch`, `node-fetch`, `dotenv` and of the packages only they depended on (`biskviit`, `encoding`, `data-uri-to-buffer`, `fetch-blob`, `formdata-polyfill`, `web-streams-polyfill`; `iconv-lite` and `safer-buffer` may stay, Express needs them).

- [ ] **Step 2: Restore the CRLF endings of the lock file**

Run: `perl -pi -e 's/\r?\n/\r\n/' package-lock.json; grep -c $'\r' package-lock.json; wc -l < package-lock.json; git diff --stat package-lock.json package.json`
Expected: the two counts are equal; the lock file shows removed lines and no added block other than what npm rewrote for the root package; `package.json` shows three removed lines.

- [ ] **Step 3: Drop the imports in index.mjs**

Remove these three lines (and the blank line that follows `dotenv.config();`):

```js
import fetch from 'node-fetch';
```

```js
import dotenv from 'dotenv';
```

```js
dotenv.config();
```

The file starts with `import express from 'express';` followed by `import { diff3Merge } from 'node-diff3';`; the `fetch(url, options)` call in `atlassianFetch` now resolves to the global one. Check the CRLF endings (plan header).

- [ ] **Step 4: Run the tests and list the dependencies**

Run: `npm test && npm ls --depth=0`
Expected: `ℹ tests 76`, `ℹ fail 0` (the server test starts the server, which proves the imports resolve); `npm ls` lists `express`, `node-cache`, `node-diff3` and nothing else, without `UNMET` or `extraneous`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json index.mjs
git commit -m "chore: drop node-fetch, dotenv and the unused fetch package (#41)

The server uses the fetch built into Node (20.11 or later); PORT works
without dotenv and nothing documented a .env file; fetch was never
imported.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 2: The conflicts endpoint, the dead cache exports, the duplicate auth header

**Files:**
- Modify: `test/server.test.mjs` (one test)
- Modify: `index.mjs` (CRLF): the import list at the top, the `fetchJiraSprints` function, the `/api/pull-request-conflicts/:repoName/:spec` route
- Modify: `cache.mjs` (CRLF): `CACHE_KEYS`, `getCachedSprints`, `clearCache`, `clearAllCache`

- [ ] **Step 1: Write the failing test**

Append to `test/server.test.mjs`:

```js
test('the per-pull-request conflicts endpoint is gone, the sync statuses endpoint stays', async () => {
    const conflicts = await fetch(`${baseUrl}/api/pull-request-conflicts/products.secollab/abc..def`);
    assert.equal(conflicts.status, 404);
    const statuses = await fetch(`${baseUrl}/api/sync-statuses/OSLC`);
    assert.equal(statuses.status, 200);
    assert.equal(typeof (await statuses.json()).statuses, 'object');
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npm test`
Expected: the new test fails on the first assertion: the route still exists and answers 500 in fixture mode (its conflict computation cannot reach Atlassian), not 404.

- [ ] **Step 3: Remove the route and the duplicate header in index.mjs**

Delete this whole block:

```js
app.get('/api/pull-request-conflicts/:repoName/:spec', async (req, res) => {
    const { repoName, spec } = req.params;

    try {
        const conflictsData = await getCachedConflicts(repoName, spec, () => {
            return conflictsLimiter(() => computeConflicts(repoName, spec));
        });

        res.json(conflictsData);
    } catch (error) {
        if (error instanceof RateLimitError) {
            res.status(503).json({ error: error.message, rateLimitedUntil: new Date(rateLimitedUntil).toISOString() });
            return;
        }
        log(`Error fetching conflicts for commits ${spec}: ${error.message}`, errorLogStream);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
```

(and the blank line that followed it). In the import list at the top of the file, delete the line `    getCachedSprints,`. In `fetchJiraSprints`, delete its first line:

```js
    const jiraAuth = Buffer.from(`${config.jira.username}:${config.jira.apiKey}`).toString('base64');
```

(the module-level `jiraAuth` is identical and stays). Check the CRLF endings.

- [ ] **Step 4: Remove the dead exports in cache.mjs**

Delete the line `    SPRINTS: (projectName) => \`sprints_${projectName}\`,` from `CACHE_KEYS`, and delete these three functions with their JSDoc comments:

```js
/**
 * Get sprints data from cache or fetch from source
 * @param {string} projectName - Project identifier
 * @param {function} fetchSprints - Function to fetch sprints if cache miss
 * @returns {Promise<Array>} Sprints data
 */
export async function getCachedSprints(projectName, fetchSprints) {
    return getOrSetCache(CACHE_KEYS.SPRINTS(projectName), fetchSprints, 600); // 10 minutes TTL
}
```

```js
/**
 * Clear specific cache entry
 * @param {string} key - Cache key to clear
 */
export function clearCache(key) {
    cache.del(key);
}

/**
 * Clear all cache entries
 */
export function clearAllCache() {
    cache.flushAll();
}
```

The file keeps `getCachedProjects`, `getCachedProjectData`, `getCachedConflicts`, `getCachedSyncStatuses`, `raiseAllCacheTtls` and `getCacheStats`, each separated by one blank line as before. Check the CRLF endings.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: `ℹ tests 77`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add index.mjs cache.mjs test/server.test.mjs
git commit -m "chore: remove the per-pull-request conflicts endpoint and the cache exports nothing calls (#41)

The SYNC load has used /api/sync-statuses/:project since 2.1.0. The
sprints are fetched with the project data: the separate sprint cache
was never wired, and clearCache/clearAllCache had no caller.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 3: Frontend leftovers, the config template, start.bat

**Files:**
- Modify: `public/multi-select.js` (CRLF): `toggle`, `getOptions`, `setDisabled`
- Modify: `public/styles.css` (the `.multi-select.disabled` rule, around line 553)
- Modify: `public/app-render.js`: `getBranchUrl` (around line 86) and its call (around line 104), `resolvedIssuesAlert` (around lines 206, 221, 227)
- Modify: `config.js.default`
- Delete: `start.bat`

- [ ] **Step 1: multi-select.js**

Delete the `getOptions` method:

```js
    getOptions() {
        return this.options;
    }

```

and the `setDisabled` method:

```js
    setDisabled(disabled) {
        if (disabled) {
            this.element.classList.add('disabled');
            this.close();
        } else {
            this.element.classList.remove('disabled');
        }
    }

```

Nothing adds the `disabled` class any more, so replace the body of `toggle()`

```js
    toggle() {
        if (this.element.classList.contains('disabled')) {
            return;
        }

        if (this.element.classList.contains('open')) {
            this.close();
        } else {
            this.open();
        }
    }
```

with

```js
    toggle() {
        if (this.element.classList.contains('open')) {
            this.close();
        } else {
            this.open();
        }
    }
```

Check the CRLF endings.

- [ ] **Step 2: styles.css**

Delete the rule (and its blank line) that starts with `.multi-select.disabled .multi-select-trigger {` (around line 553); read the rule first to remove exactly that block.

- [ ] **Step 3: app-render.js**

Replace

```js
// Helper function to get branch URL from Bitbucket
function getBranchUrl(repoName, branchName, pullRequest) {
    // Use the repository links from any pull request to get the base URL
    const baseUrl = pullRequest.source.repository.links.html.href;
    return `${baseUrl}/branch/${encodeURIComponent(branchName)}`;
}
```

with

```js
// The Bitbucket URL of a branch, from the repository links of one of its pull requests
function getBranchUrl(branchName, pullRequest) {
    const baseUrl = pullRequest.source.repository.links.html.href;
    return `${baseUrl}/branch/${encodeURIComponent(branchName)}`;
}
```

and its call

```js
            const branchUrl = getBranchUrl(rootPullRequests[0].source.repository.name, rootBranch, rootPullRequests[0]);
```

with

```js
            const branchUrl = getBranchUrl(rootBranch, rootPullRequests[0]);
```

In `renderPullRequest`, delete the line `        let resolvedIssuesAlert = '';` (and the blank line before it, so that `sameStatusIcon` is followed directly by `jiraIssuesHtml = ...`), change `        if (sameStatusIcon || noOtherParticipantsAlert || resolvedIssuesAlert) {` to `        if (sameStatusIcon || noOtherParticipantsAlert) {`, and delete the line `                        ${resolvedIssuesAlert}` inside the warnings template.

- [ ] **Step 4: config.js.default and start.bat**

In `config.js.default`, delete the two lines

```js
        repoName: 'xxx' // for us was products.secollab
```

```js
        issuesRegex: /(XXX-\d+)/g // for us was replacing XXX with SECOLLAB
```

so the `bitbucket` block ends with the `workspace` line and the `jira` block with the `apiKey` line (a trailing comma on those lines is fine). Then `git rm start.bat`.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: `ℹ tests 77`, `ℹ fail 0` (the render tests check the branch URL and the warnings by substring).

- [ ] **Step 6: Commit**

```bash
git add public/multi-select.js public/styles.css public/app-render.js config.js.default start.bat
git commit -m "chore: remove the multi-select methods, the render leftovers, the config fields and start.bat nothing uses (#41)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 4: Version 2.6.0 and the documentation

**Files:**
- Modify: `package.json:3`
- Modify: `README.md` (Installation, Changelog)
- Modify: `CLAUDE.md` (version, technology stack, project structure, index.mjs and cache.mjs descriptions, API endpoints)
- Modify: `PRD.md` (F8.5, 7.2, 7.4, 7.5, 13 risks)

- [ ] **Step 1: package.json**

Set `"version": "2.6.0"` (the `releaseDate` stays `2026-09-10`).

- [ ] **Step 2: README.md**

Replace the Installation bullet

```
* Open a terminal (we are assuming here you have `nodejs` and `npm` installed)
```

with

```
* Open a terminal (Node.js 20.11 or later and `npm` are assumed to be installed; the server uses the `fetch` built into Node)
```

Insert right after the line `## Changelog:` (before `* Version 2.5.2`):

```
* Version 2.6.0
    * Removed what nothing used (#41)
        * The `/api/pull-request-conflicts/:repoName/:spec` endpoint: the SYNC load has used `/api/sync-statuses/:project` since 2.1.0
        * The `node-fetch`, `dotenv` and `fetch` dependencies: the server uses the `fetch` built into Node (20.11 or later), `PORT` is read from the environment as before
        * The sprint cache that was never wired (the sprints are fetched with the project data), the `clearCache` and `clearAllCache` exports, two multi-select methods, the `repoName` and `issuesRegex` fields of `config.js.default`, `start.bat` (`npm start` does the same)
```

- [ ] **Step 3: CLAUDE.md**

1. `Current version: **2.5.2** (as of 2026-09-10)` becomes `Current version: **2.6.0** (as of 2026-09-10)`.
2. In "Technology Stack / Backend", replace the four lines

```
- **Framework**: Express.js (v4.19.2)
- **HTTP Client**: node-fetch (v3.3.2)
- **Caching**: node-cache (v5.1.2)
- **Configuration**: dotenv (v16.4.5)
```

with

```
- **Framework**: Express.js (v5.2.1)
- **HTTP Client**: the `fetch` built into Node.js (20.11 or later)
- **Caching**: node-cache (v5.1.2)
- **Three-way merge**: node-diff3 (v3.2.1), for the conflict computation
```

3. In "Project Structure", delete the line `├── start.bat              # Windows startup script`.
4. In the `**index.mjs**` bullets, replace `- API endpoint definitions (`/api/projects`, `/api/pull-requests/:project`, `/api/pull-request-conflicts/:repoName/:spec`)` with `- API endpoint definitions (`/api/version`, `/api/projects`, `/api/pull-requests/:project`, `/api/sync-statuses/:project`, `/api/cache/stats`)`.
5. In the `**cache.mjs**` bullets, delete the line `  - Sprints: 600 seconds (10 minutes)` and add after the TTL list: `- The sprints are fetched with the project data and cached with it (no separate cache)`.
6. In "API Endpoints", delete the whole `### GET /api/pull-request-conflicts/:repoName/:spec` section (heading, parameters, response, up to the line before `### GET /api/sync-statuses/:project`).
7. In "Initial Setup", step 7 `Run \`node index.mjs\`` stays (the review round then changed it to `npm start`); in "Development Workflows" nothing else mentions the removed items.

- [ ] **Step 4: PRD.md**

1. Line `- F8.5: Cache sprint data (10-minute TTL)` becomes `- F8.5: Sprints are fetched and cached with the project data (no separate cache)`.
2. In "7.2 Technology Stack / Backend", replace

```
- **Framework:** Express.js v4.19.2
- **HTTP Client:** node-fetch v3.3.2
- **Caching:** node-cache v5.1.2
- **Configuration:** dotenv v16.4.5
```

with

```
- **Framework:** Express.js v5.2.1
- **HTTP Client:** the `fetch` built into Node.js 20.11 or later
- **Caching:** node-cache v5.1.2
- **Three-way merge:** node-diff3 v3.2.1 (conflict computation)
```

3. In "7.4 Caching Strategy", delete the line `- Sprints: 600 seconds`.
4. In the "7.5 API Endpoints" table, replace the row `| \`/api/pull-request-conflicts/:repo/:spec\` | GET | 300s | Merge conflict detection |` with `| \`/api/sync-statuses/:project\` | GET | 300s | SYNC (conflict) status of every open pull request, loaded on demand |`.
5. Around line 711, the risk line that reads `Cache sprint data for 10 minutes...` (read it first): reword it to say the sprints are cached with the project data (2 minutes), keeping the rest of the sentence.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: `ℹ tests 77`, `ℹ fail 0` (the server test compares `/api/version` with package.json).

- [ ] **Step 6: Commit**

```bash
git add package.json README.md CLAUDE.md PRD.md
git commit -m "docs: version 2.6.0, the removals of #41

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 5 (controller): verification and pull request

- [ ] `npm test` ends with `ℹ fail 0` and 77 tests; `npm ls --depth=0` lists three dependencies.
- [ ] `PORT=3101 node index.mjs --fixtures` in the background: `curl -si localhost:3101/api/pull-request-conflicts/x/a..b | head -1` answers 404, `curl -s localhost:3101/api/sync-statuses/OSLC | head -c 80` answers JSON; the page and a multi-select work in the browser; stop the server.
- [ ] One real request through the built-in `fetch`: `PORT=3102 node index.mjs` (real `config.js`), `curl -s -m 120 localhost:3102/api/pull-requests/OSLC | head -c 200` answers JSON, `tail -3 error.log` shows no new line; stop the server.
- [ ] Push the branch and open the pull request with base `claude/serve-readme-route`, `Closes #41`.
