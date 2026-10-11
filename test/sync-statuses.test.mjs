import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSyncStatuses, filesPerPatchRequest, maxFilesToCheck } from '../sync-statuses.mjs';
import { conflictRuleVersion } from '../conflicts.mjs';
import { openSyncCache as openSyncCacheOf } from '../sync-cache.mjs';
import { RateLimitError } from '../atlassian-fetch.mjs';

/**
 * The server's SYNC computation against a fake Bitbucket: what is fetched,
 * what the client is shown, what reaches sync-cache.json. The fake `fetch`
 * stands for atlassianFetch: it answers diffstats and diffs by URL with real
 * Response objects and throws what atlassianFetch throws (a RateLimitError,
 * a failure whose shortMessage has no URL).
 */

const workspace = 'ws';
const bbAuth = 'dXNlcjpwYXNz';
const repo = 'repo-one';
const dest = 'dddd';
const source = 'ssss';
const spec = `${dest}..${source}`;
const key = `${repo}/${spec}`;
const fileKey = `${conflictRuleVersion}:${key}`; // the key in sync-cache.json
const api = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}`;
const diffstatUrl = (side, other) => `${api}/diffstat/${side}..${other}?pagelen=500`;
const diffUrl = (side, other, paths) => `${api}/diff/${side}..${other}?topic=true&${paths.map(p => `path=${encodeURIComponent(p)}`).join('&')}`;

const tempDirectories = [];
after(() => {
    for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true });
});
// What the server opens: the keys under the current conflict rule
const openSyncCache = file => openSyncCacheOf(file, { ruleVersion: conflictRuleVersion });

function tempFile() {
    const directory = mkdtempSync(path.join(tmpdir(), 'sync-statuses-'));
    tempDirectories.push(directory);
    return path.join(directory, 'sync-cache.json');
}

// A pull request as the computation reads it
function pullRequest(destHash = dest, sourceHash = source, repoName = repo) {
    return {
        source: { repository: { name: repoName }, commit: sourceHash === null ? undefined : { hash: sourceHash } },
        destination: { commit: destHash === null ? undefined : { hash: destHash } }
    };
}

// Patches as git prints them (see test/conflicts.test.mjs); `body` holds the hunk lines with their leading space, - or +
const hashOf = text => createHash('sha1').update(text).digest('hex').slice(0, 7);
function patch(file, header, body) {
    return `diff --git a/${file} b/${file}\nindex 1111111..${hashOf(body.join('\n'))} 100644\n--- a/${file}\n+++ b/${file}\n@@ ${header} @@\n${body.join('\n')}\n`;
}
const base = [' l1', ' l2', ' l3', ' l4', ' l5', ' l6'];
// The six-line file with line `n` replaced by `text`
function modify(file, n, text) {
    return patch(file, '-1,6 +1,6', base.map((line, i) => (i === n - 1 ? [`-${line.slice(1)}`, `+${text}`] : [line])).flat());
}
// The six-line file renamed, with line `n` replaced by `text`
function renameAndModify(oldPath, newPath, n, text) {
    const body = base.map((line, i) => (i === n - 1 ? [`-${line.slice(1)}`, `+${text}`] : [line])).flat();
    return `diff --git a/${oldPath} b/${newPath}\nsimilarity index 80%\nrename from ${oldPath}\nrename to ${newPath}\nindex 1111111..${hashOf(body.join('\n'))} 100644\n--- a/${oldPath}\n+++ b/${newPath}\n@@ -1,6 +1,6 @@\n${body.join('\n')}\n`;
}

// Diffstat entries as Bitbucket lists them, with the line counts of a one-line modification
const modified = (file, counts = { lines_added: 1, lines_removed: 1 }) => ({ status: 'modified', old: { path: file }, new: { path: file }, ...counts });
const removed = file => ({ status: 'removed', old: { path: file }, new: null, lines_added: 0, lines_removed: 6 });
const renamed = (oldPath, newPath) => ({ status: 'renamed', old: { path: oldPath }, new: { path: newPath }, lines_added: 1, lines_removed: 1 });

/**
 * A fake Bitbucket. `diffstats` and `diffs` are keyed by "side..other": a
 * diffstat is a list of entries (one page) or a function of the URL
 * returning the page; a diff is a patch text or a function of the requested
 * paths. `intercept(count, url, options)` runs before each answer: what it
 * returns replaces the answer, what it throws is thrown.
 */
function fakeBitbucket({ diffstats = {}, diffs = {}, intercept = () => undefined } = {}) {
    const requests = [];
    async function fetch(url, options) {
        requests.push({ url, options });
        const replaced = await intercept(requests.length, url, options);
        if (replaced) return replaced;
        const { pathname, searchParams } = new URL(url);
        const [, kind, pair] = pathname.match(/\/(diffstat|diff)\/([^/]+)$/);
        if (kind === 'diffstat') {
            const diffstat = diffstats[pair] ?? [];
            const page = typeof diffstat === 'function' ? diffstat(url) : { values: diffstat };
            return new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        const diff = diffs[pair] ?? '';
        return new Response(typeof diff === 'function' ? diff(searchParams.getAll('path')) : diff, { status: 200 });
    }
    return { fetch, requests };
}

// `computeSyncStatuses` answers the statuses of the load, `computeLoad` the whole result ({ statuses, stopped })
function setUp(bitbucket, { cache = openSyncCache(tempFile()), timeoutMs = 30000, maxConcurrent, maxConsecutiveFailures } = {}) {
    const logs = { error: [], performance: [] };
    const { computeConflicts, computeSyncStatuses } = createSyncStatuses({
        fetch: bitbucket.fetch,
        workspace,
        bbAuth,
        log: { error: message => logs.error.push(message), performance: message => logs.performance.push(message) },
        syncCache: cache,
        timeoutMs,
        maxConcurrent,
        maxConsecutiveFailures
    });
    return {
        computeConflicts,
        computeSyncStatuses: async (...args) => (await computeSyncStatuses(...args)).statuses,
        computeLoad: computeSyncStatuses,
        logs,
        cache,
        requests: bitbucket.requests
    };
}

// The scenarios of one file f.txt touched on both sides
const sameLine = { diffs: { [`${source}..${dest}`]: modify('f.txt', 3, 'S'), [`${dest}..${source}`]: modify('f.txt', 3, 'D') } };
const bothSides = { diffstats: { [`${source}..${dest}`]: [modified('f.txt')], [`${dest}..${source}`]: [modified('f.txt')] } };

test('no file touched on both sides: the two diffstats decide, no diff is fetched', async () => {
    const { computeSyncStatuses, requests, logs } = setUp(fakeBitbucket({
        diffstats: { [`${source}..${dest}`]: [modified('a.txt')], [`${dest}..${source}`]: [modified('b.txt')] }
    }));
    const statuses = await computeSyncStatuses('PROJ', [pullRequest()]);
    assert.deepEqual(statuses, { [key]: { conflicts: false } });
    assert.deepEqual(requests.map(request => request.url), [diffstatUrl(source, dest), diffstatUrl(dest, source)]);
    for (const { options } of requests) {
        assert.deepEqual(options.headers, { 'Authorization': `Basic ${bbAuth}`, 'Accept': 'application/json' });
        assert.ok(options.signal instanceof AbortSignal, 'a request has a timeout');
    }
    assert.match(logs.performance[0], /^computeConflicts - repo-one dddd\.\.ssss - 0 overlapping files - conflicts: false - Duration: \d+ms$/);
    assert.deepEqual(logs.error, []);
});

test('a source side that changed nothing costs one request', async () => {
    const { computeConflicts, requests } = setUp(fakeBitbucket());
    assert.deepEqual(await computeConflicts(repo, spec), { conflicts: false });
    assert.deepEqual(requests.map(request => request.url), [diffstatUrl(source, dest)]);
});

test('a diffstat of several pages is read to its end', async () => {
    const { computeConflicts, requests } = setUp(fakeBitbucket({
        diffstats: {
            [`${source}..${dest}`]: url => (url.includes('page=2') ? { values: [modified('b.txt')] } : { values: [modified('a.txt')], next: `${url}&page=2` }),
            [`${dest}..${source}`]: [modified('c.txt')]
        }
    }));
    assert.deepEqual(await computeConflicts(repo, spec), { conflicts: false });
    assert.deepEqual(requests.map(request => request.url), [diffstatUrl(source, dest), `${diffstatUrl(source, dest)}&page=2`, diffstatUrl(dest, source)]);
});

test('a file changed on both sides is decided from the patches of both sides: a conflict', async () => {
    const { computeSyncStatuses, requests, logs } = setUp(fakeBitbucket({ ...bothSides, ...sameLine }));
    const statuses = await computeSyncStatuses('PROJ', [pullRequest()]);
    assert.deepEqual(statuses, { [key]: { conflicts: true, files: ['f.txt'] } });
    assert.deepEqual(requests.map(request => request.url), [
        diffstatUrl(source, dest), diffstatUrl(dest, source),
        diffUrl(source, dest, ['f.txt']), diffUrl(dest, source, ['f.txt'])
    ]);
    // A diff is fetched as text, with the same credentials
    assert.deepEqual(requests[2].options.headers, { 'Authorization': `Basic ${bbAuth}` });
    assert.ok(requests[2].options.signal instanceof AbortSignal);
    assert.match(logs.performance[0], /^computeConflicts - repo-one dddd\.\.ssss - 1 overlapping files - conflicts: true - Duration: \d+ms$/);
});

test('a file changed on both sides is decided from the patches of both sides: no conflict', async () => {
    const { computeSyncStatuses } = setUp(fakeBitbucket({
        ...bothSides,
        diffs: { [`${source}..${dest}`]: modify('f.txt', 1, 'S'), [`${dest}..${source}`]: modify('f.txt', 6, 'D') }
    }));
    assert.deepEqual(await computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { conflicts: false } });
});

test('a patch whose line counts differ from the diffstat reports the pull request not checked, never clean', async () => {
    const { computeSyncStatuses, logs } = setUp(fakeBitbucket({
        diffstats: { [`${source}..${dest}`]: [modified('f.txt', { lines_added: 2, lines_removed: 1 })], [`${dest}..${source}`]: [modified('f.txt')] },
        diffs: { [`${source}..${dest}`]: modify('f.txt', 1, 'S'), [`${dest}..${source}`]: modify('f.txt', 6, 'D') }
    }));
    const reason = 'f.txt: the diff (+1 -1) does not match the diffstat (+2 -1)';
    assert.deepEqual(await computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason } });
    assert.deepEqual(logs.error, [`Error computing sync status for repo-one dddd..ssss: ${reason}`]);
});

test('a file missing from a diff reports the pull request not checked', async () => {
    const { computeSyncStatuses, logs } = setUp(fakeBitbucket({
        ...bothSides,
        diffs: { [`${source}..${dest}`]: modify('f.txt', 1, 'S') } // the destination side answers an empty diff
    }));
    assert.deepEqual(await computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason: 'f.txt is missing from the diff' } });
    assert.deepEqual(logs.error, ['Error computing sync status for repo-one dddd..ssss: f.txt is missing from the diff']);
});

const manyFiles = count => Array.from({ length: count }, (_, i) => `f${String(i + 1).padStart(3, '0')}.txt`);

test('more than 100 files to check: not checked without a diff request, or partly checked when the diffstats proved a conflict', async () => {
    const files = manyFiles(maxFilesToCheck + 1).map(file => modified(file));
    const tooMany = setUp(fakeBitbucket({ diffstats: { [`${source}..${dest}`]: files, [`${dest}..${source}`]: files } }));
    const reason = `too many files to check (${maxFilesToCheck + 1})`;
    assert.deepEqual(await tooMany.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason } });
    assert.equal(tooMany.requests.length, 2);
    assert.deepEqual(tooMany.logs.error, [`Conflict check for repo-one dddd..ssss: ${reason}, the limit is ${maxFilesToCheck}`]);

    // g.txt removed on the source side and modified on the destination: a conflict the diffstats decide
    const partial = setUp(fakeBitbucket({ diffstats: { [`${source}..${dest}`]: [removed('g.txt'), ...files], [`${dest}..${source}`]: [modified('g.txt'), ...files] } }));
    assert.deepEqual(await partial.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { conflicts: true, files: ['g.txt'], reason } });
    assert.equal(partial.requests.length, 2);
    assert.deepEqual(partial.logs.error, [`Conflict check for repo-one dddd..ssss: ${reason}, the limit is ${maxFilesToCheck}`]);
});

test('exactly 100 files are checked, 20 files per diff request', async () => {
    const names = manyFiles(maxFilesToCheck);
    const files = names.map(file => modified(file));
    // Every file is changed on line 1 by the source and on line 6 by the destination: clean
    const diffOf = line => paths => paths.map(file => modify(file, line, 'X')).join('');
    const { computeConflicts, requests } = setUp(fakeBitbucket({
        diffstats: { [`${source}..${dest}`]: files, [`${dest}..${source}`]: files },
        diffs: { [`${source}..${dest}`]: diffOf(1), [`${dest}..${source}`]: diffOf(6) }
    }));
    assert.deepEqual(await computeConflicts(repo, spec), { conflicts: false });
    const diffRequests = requests.filter(request => request.url.includes('/diff/'));
    assert.equal(diffRequests.length, 2 * maxFilesToCheck / filesPerPatchRequest);
    for (const { url } of diffRequests) assert.equal(new URL(url).searchParams.getAll('path').length, filesPerPatchRequest);
});

test('a renamed file at the 20-file boundary goes with both its paths in one request and is checked under its base path', async () => {
    const names = manyFiles(filesPerPatchRequest + 1);
    const renamedFile = names[filesPerPatchRequest - 1];
    const newPath = `moved/${renamedFile}`;
    const sourceFiles = names.map(file => (file === renamedFile ? renamed(file, newPath) : modified(file)));
    const destFiles = names.map(file => modified(file));
    // The renamed file conflicts (line 3 on both sides), the others do not
    const sourceDiff = paths => paths.filter(p => p !== newPath).map(file => (file === renamedFile ? renameAndModify(file, newPath, 3, 'S') : modify(file, 1, 'S'))).join('');
    const destDiff = paths => paths.filter(p => p !== newPath).map(file => modify(file, file === renamedFile ? 3 : 6, 'D')).join('');
    const { computeConflicts, requests } = setUp(fakeBitbucket({
        diffstats: { [`${source}..${dest}`]: sourceFiles, [`${dest}..${source}`]: destFiles },
        diffs: { [`${source}..${dest}`]: sourceDiff, [`${dest}..${source}`]: destDiff }
    }));
    assert.deepEqual(await computeConflicts(repo, spec), { conflicts: true, files: [renamedFile] });
    // The two sides are fetched in parallel, so their requests interleave: compared per side
    const pathsOf = side => requests.filter(request => request.url.includes(`/diff/${side}..`)).map(request => new URL(request.url).searchParams.getAll('path'));
    const firstTwenty = [...names.slice(0, filesPerPatchRequest - 1), renamedFile, newPath];
    assert.deepEqual(pathsOf(source), [firstTwenty, [names[filesPerPatchRequest]]]);
    assert.deepEqual(pathsOf(dest), [firstTwenty, [names[filesPerPatchRequest]]]);
});

test('a failed diff request: not checked, or partly checked when the diffstats proved a conflict', async () => {
    const failDiffs = (count, url) => (url.includes('/diff/') ? new Response('', { status: 502 }) : undefined);
    const failed = setUp(fakeBitbucket({ ...bothSides, intercept: failDiffs }));
    assert.deepEqual(await failed.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason: 'Request failed with status code 502' } });
    assert.deepEqual(failed.logs.error, ['Error computing sync status for repo-one dddd..ssss: Request failed with status code 502']);

    const partial = setUp(fakeBitbucket({
        diffstats: { [`${source}..${dest}`]: [removed('g.txt'), modified('f.txt')], [`${dest}..${source}`]: [modified('g.txt'), modified('f.txt')] },
        intercept: failDiffs
    }));
    assert.deepEqual(await partial.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { conflicts: true, files: ['g.txt'], reason: 'Request failed with status code 502' } });
    assert.deepEqual(partial.logs.error, ['Conflict check for repo-one dddd..ssss incomplete, 1 conflicting files known from the diffstats: Request failed with status code 502']);
});

test('a failed diffstat request: not checked with the status code as the reason', async () => {
    const { computeSyncStatuses, logs } = setUp(fakeBitbucket({ intercept: count => (count === 2 ? new Response('', { status: 503 }) : undefined), ...bothSides }));
    assert.deepEqual(await computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason: 'Request failed with status code 503' } });
    assert.deepEqual(logs.error, ['Error computing sync status for repo-one dddd..ssss: Request failed with status code 503']);
});

test('a diff request that times out: not checked with the timeout as the reason', async () => {
    // The fake answers a diff only when the signal the computation passed aborts
    const hang = (count, url, options) => (url.includes('/diff/')
        ? new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)))
        : undefined);
    const { computeSyncStatuses, logs } = setUp(fakeBitbucket({ ...bothSides, intercept: hang }), { timeoutMs: 5 });
    const started = performance.now();
    const statuses = await computeSyncStatuses('PROJ', [pullRequest()]);
    assert.ok(performance.now() - started < 5000, 'the timeout given is the one applied, not the 30 s default');
    assert.deepEqual(statuses, { [key]: { error: true, reason: 'The operation was aborted due to timeout' } });
    assert.equal(logs.error.length, 1);
});

test('a side whose diff request fails stops the requests of the other side', { timeout: 5000 }, async () => {
    // Three diff requests per side
    const files = manyFiles(2 * filesPerPatchRequest + 1).map(file => modified(file));
    const diffOf = line => paths => paths.map(file => modify(file, line, 'X')).join('');
    const scenario = { diffstats: { [`${source}..${dest}`]: files, [`${dest}..${source}`]: files }, diffs: { [`${source}..${dest}`]: diffOf(1), [`${dest}..${source}`]: diffOf(6) } };
    const diffsOf = (requests, side) => requests.filter(request => request.url.includes(`/diff/${side}..`));
    const reason = 'Request failed with status code 502';

    // The source side fails at once, the destination's first request is in flight: aborted
    const inFlight = setUp(fakeBitbucket({
        ...scenario,
        intercept: (count, url, options) => {
            if (url.includes(`/diff/${source}..`)) return new Response('', { status: 502 });
            if (url.includes(`/diff/${dest}..`)) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
        }
    }));
    assert.deepEqual(await inFlight.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason } });
    assert.deepEqual(inFlight.logs.error, [`Error computing sync status for repo-one dddd..ssss: ${reason}`]);
    const [destRequest, ...moreDest] = diffsOf(inFlight.requests, dest);
    assert.ok(destRequest.options.signal.aborted, 'the request in flight is aborted');
    assert.deepEqual(moreDest, [], 'the destination side sends no other request');

    // The destination side fails at once, the source's first response comes in just as the side is stopped: no next request
    let bodyRead;
    const bodyReadOnce = new Promise(resolve => { bodyRead = resolve; });
    const answersLate = setUp(fakeBitbucket({
        ...scenario,
        intercept: async (count, url, options) => {
            if (url.includes(`/diff/${dest}..`)) return new Response('', { status: 502 });
            if (url.includes(`/diff/${source}..`)) {
                await new Promise(resolve => options.signal.addEventListener('abort', resolve));
                const text = diffOf(1)(new URL(url).searchParams.getAll('path'));
                return { ok: true, status: 200, text: async () => { bodyRead(); return text; } };
            }
        }
    }));
    assert.deepEqual(await answersLate.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason } });
    // Once its body is read, the source side reaches its next request or its abort check within the same turn
    await bodyReadOnce;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(diffsOf(answersLate.requests, source).length, 1, 'the source side sends no other request');
});

test('a rate-limit pause in the middle of the requests: the fixed reason, nothing logged as an error', async () => {
    const pauseAt = n => (count) => { if (count >= n) throw new RateLimitError(); };
    const reason = 'Atlassian requests are paused after a rate limit';
    // During the diffs
    const inDiffs = setUp(fakeBitbucket({ ...bothSides, intercept: pauseAt(3) }));
    assert.deepEqual(await inDiffs.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason } });
    assert.deepEqual(inDiffs.logs.error, []);
    // During the diffstats
    const inDiffstats = setUp(fakeBitbucket({ ...bothSides, intercept: pauseAt(2) }));
    assert.deepEqual(await inDiffstats.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason } });
    assert.deepEqual(inDiffstats.logs.error, []);
    // With a conflict the diffstats proved: partly checked
    const partial = setUp(fakeBitbucket({
        diffstats: { [`${source}..${dest}`]: [removed('g.txt'), modified('f.txt')], [`${dest}..${source}`]: [modified('g.txt'), modified('f.txt')] },
        intercept: pauseAt(3)
    }));
    assert.deepEqual(await partial.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { conflicts: true, files: ['g.txt'], reason } });
    assert.deepEqual(partial.logs.error, []);
});

test('the reason sent to the client is the short message, the log keeps the URL', async () => {
    const { computeSyncStatuses, logs } = setUp(fakeBitbucket({
        ...bothSides,
        intercept: (count, url) => {
            if (!url.includes('/diff/')) return;
            const failure = new Error(`fetch failed: ECONNRESET (${url})`);
            failure.shortMessage = 'fetch failed: ECONNRESET';
            throw failure;
        }
    }));
    assert.deepEqual(await computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { error: true, reason: 'fetch failed: ECONNRESET' } });
    assert.equal(logs.error.length, 1);
    assert.ok(logs.error[0].includes(diffUrl(source, dest, ['f.txt'])), logs.error[0]);
});

test('a complete result is stored under the rule-version prefix, and found again without a request', async () => {
    const file = tempFile();
    const cache = openSyncCache(file);
    const first = setUp(fakeBitbucket({ ...bothSides, ...sameLine }), { cache });
    const result = { conflicts: true, files: ['f.txt'] };
    assert.deepEqual(await first.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: result });
    assert.deepEqual(cache.get(key), result);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).entries), [fileKey]); // saved at the end of the load

    // A restart: the file is read again, the same pull request costs no request
    const restarted = setUp(fakeBitbucket({ ...bothSides, ...sameLine }), { cache: openSyncCache(file) });
    assert.deepEqual(await restarted.computeSyncStatuses('PROJ', [pullRequest()]), { [key]: result });
    assert.deepEqual(restarted.requests, []);
    assert.deepEqual(restarted.logs.performance, ['Sync statuses of PROJ - 1 pull requests, 0 computed, 0 not checked, 0 partly checked']);
});

test('a result stored under another version of the conflict rule is not reused, and goes at the next write', async () => {
    const file = tempFile();
    const older = openSyncCacheOf(file, { ruleVersion: conflictRuleVersion - 1 });
    older.set(key, { conflicts: false });
    await older.save();
    const cache = openSyncCache(file);
    const { computeSyncStatuses, requests } = setUp(fakeBitbucket({ ...bothSides, ...sameLine }), { cache });
    assert.deepEqual(await computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { conflicts: true, files: ['f.txt'] } });
    assert.equal(requests.length, 4);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).entries), [fileKey]); // the older entry went with the save
});

test('a failed result, or one partial after a failure, is not stored', async () => {
    const file = tempFile();
    const cache = openSyncCache(file);
    const failDiffs = (count, url) => (url.includes('/diff/') ? new Response('', { status: 502 }) : undefined);
    const { computeSyncStatuses } = setUp(fakeBitbucket({
        diffstats: {
            [`${source}..${dest}`]: [removed('g.txt'), modified('f.txt')],
            [`${dest}..${source}`]: [modified('g.txt'), modified('f.txt')],
            [`${source}..eeee`]: [modified('f.txt')],
            [`eeee..${source}`]: [modified('f.txt')]
        },
        intercept: failDiffs
    }), { cache });
    const statuses = await computeSyncStatuses('PROJ', [pullRequest(), pullRequest('eeee')]);
    assert.equal(statuses[key].reason, 'Request failed with status code 502'); // partial
    assert.equal(statuses[`${repo}/eeee..${source}`].error, true); // failed
    assert.equal(cache.get(key), null);
    assert.equal(cache.get(`${repo}/eeee..${source}`), null);
    assert.equal(openSyncCache(file).size, 0, 'nothing reached the disk');
});

test('an over-limit result is stored: the next load sends no request and logs nothing (#49)', async () => {
    const file = tempFile();
    const files = manyFiles(maxFilesToCheck + 1).map(name => modified(name));
    const reason = `too many files to check (${maxFilesToCheck + 1})`;
    const otherKey = `${repo}/eeee..${source}`;
    const bitbucket = () => fakeBitbucket({
        diffstats: {
            [`${source}..${dest}`]: files,
            [`${dest}..${source}`]: files,
            // g.txt removed on the source side, modified on the destination: partly checked
            [`${source}..eeee`]: [removed('g.txt'), ...files],
            [`eeee..${source}`]: [modified('g.txt'), ...files]
        }
    });
    const expected = { [key]: { error: true, reason }, [otherKey]: { conflicts: true, files: ['g.txt'], reason } };
    const first = setUp(bitbucket(), { cache: openSyncCache(file) });
    assert.deepEqual(await first.computeSyncStatuses('PROJ', [pullRequest(), pullRequest('eeee')]), expected);
    assert.equal(first.requests.length, 4);

    const next = setUp(bitbucket(), { cache: openSyncCache(file) });
    assert.deepEqual(await next.computeSyncStatuses('PROJ', [pullRequest(), pullRequest('eeee')]), expected);
    assert.deepEqual(next.requests, []);
    assert.deepEqual(next.logs.error, []);
});

test('a pull request without commit hashes on a side gets no status', async () => {
    const { computeSyncStatuses, requests } = setUp(fakeBitbucket());
    assert.deepEqual(await computeSyncStatuses('PROJ', [pullRequest(null, source), pullRequest(dest, null)]), {});
    assert.deepEqual(requests, []);
});

test('at most four computations run at once', async () => {
    let release;
    const released = new Promise(resolve => { release = resolve; });
    const { computeSyncStatuses, requests } = setUp(fakeBitbucket({ intercept: () => released }));
    const load = computeSyncStatuses('PROJ', Array.from({ length: 6 }, (_, i) => pullRequest(`d${i}`, `s${i}`)));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 4);
    release(undefined);
    const statuses = await load;
    assert.equal(Object.keys(statuses).length, 6);
    assert.equal(requests.length, 6);
});

test('the summary log line counts the pull requests computed, not checked and partly checked', async () => {
    const cache = openSyncCache(tempFile());
    cache.set(`${repo}/c..c`, { conflicts: false });
    const failDiffs = (count, url) => (url.includes('/diff/') ? new Response('', { status: 502 }) : undefined);
    const { computeSyncStatuses, logs } = setUp(fakeBitbucket({
        diffstats: {
            'os..od': [modified('a.txt')], 'od..os': [modified('b.txt')], // an OK computed from the diffstats
            'ps..pd': [removed('g.txt'), modified('f.txt')], 'pd..ps': [modified('g.txt'), modified('f.txt')], // partly checked: the diffs fail
            'xs..xd': [modified('f.txt')], 'xd..xs': [modified('f.txt')] // not checked: the diffs fail
        },
        intercept: failDiffs
    }), { cache });
    // One found in the cache, three computed, one without a source commit
    await computeSyncStatuses('PROJ', [pullRequest('c', 'c'), pullRequest('od', 'os'), pullRequest('pd', 'ps'), pullRequest('xd', 'xs'), pullRequest('yd', null)]);
    assert.equal(logs.performance.at(-1), 'Sync statuses of PROJ - 4 pull requests, 3 computed, 1 not checked, 1 partly checked');
});

test('a cache that cannot be written is logged, the statuses are still returned', async () => {
    const cache = openSyncCache(path.join(tmpdir(), 'sync-statuses-missing-directory', 'sync-cache.json'));
    const { computeSyncStatuses, logs } = setUp(fakeBitbucket({ ...bothSides, ...sameLine }), { cache });
    assert.deepEqual(await computeSyncStatuses('PROJ', [pullRequest()]), { [key]: { conflicts: true, files: ['f.txt'] } });
    assert.equal(logs.error.length, 1);
    assert.match(logs.error[0], /^sync-cache\.json not written: ENOENT/);
});

// The stop of a whole load after repeated Bitbucket failures (#93)
const stopReason = (last, count = 8) => `SYNC load stopped after Bitbucket failed for ${count} pull requests in a row, the last one: ${last}`;
const manyPullRequests = count => Array.from({ length: count }, (_, i) => pullRequest(`d${i}`, `s${i}`));
const keyOf = i => `${repo}/d${i}..s${i}`;
const hangUntilAborted = options => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
const networkFailure = () => {
    const failure = new Error('fetch failed: ECONNRESET (url)');
    failure.shortMessage = 'fetch failed: ECONNRESET';
    return failure;
};

test('8 pull requests in a row whose requests fail stop the load: the checks not started send nothing and report the stop', async () => {
    const { computeLoad, requests, logs } = setUp(fakeBitbucket({ intercept: () => new Response('', { status: 503 }) }), { maxConcurrent: 1 });
    const { statuses, stopped } = await computeLoad('PROJ', manyPullRequests(40));
    const reason = stopReason('Request failed with status code 503');
    assert.equal(stopped, reason);
    assert.equal(requests.length, 8);
    // The 8 failures keep their own reason, the checks the stop ended get its reason
    for (let i = 0; i < 8; i++) assert.deepEqual(statuses[keyOf(i)], { error: true, reason: 'Request failed with status code 503' });
    for (let i = 8; i < 40; i++) assert.deepEqual(statuses[keyOf(i)], { error: true, reason }, keyOf(i));
    // The 8 failures, then the stop once
    assert.equal(logs.error.length, 9);
    assert.equal(logs.error.at(-1), `Sync statuses of PROJ: ${reason}`);
    assert.equal(logs.performance.at(-1), 'Sync statuses of PROJ - 40 pull requests, 8 computed, 40 not checked, 0 partly checked, stopped after repeated Bitbucket failures');
});

test('requests that hang stop the load after two rounds of timeouts, the requests in flight are aborted', { timeout: 5000 }, async () => {
    const { computeLoad, requests } = setUp(fakeBitbucket({ intercept: (count, url, options) => hangUntilAborted(options) }), { timeoutMs: 5 });
    const { statuses, stopped } = await computeLoad('PROJ', manyPullRequests(40));
    assert.equal(stopped, stopReason('The operation was aborted due to timeout'));
    assert.equal(Object.keys(statuses).length, 40);
    // 8 timeouts, and at most the 4 started meanwhile
    assert.ok(requests.length >= 8 && requests.length <= 12, `${requests.length} requests`);
    assert.ok(requests.every(request => request.options.signal.aborted));
});

test('timeouts, network failures, 5xx, 401, 403 and unreadable bodies count together', { timeout: 5000 }, async () => {
    const failures = [
        () => new Response('', { status: 502 }),
        () => { throw networkFailure(); },
        (options) => hangUntilAborted(options),
        () => new Response('', { status: 401 }),
        () => new Response('', { status: 403 }),
        () => new Response('<html>Bad gateway</html>', { status: 200 }), // a diffstat that is not JSON
        () => new Response('', { status: 500 })
    ];
    const { computeLoad, requests } = setUp(fakeBitbucket({ intercept: (count, url, options) => failures[(count - 1) % failures.length](options) }), { maxConcurrent: 1, timeoutMs: 5 });
    const { stopped } = await computeLoad('PROJ', manyPullRequests(20));
    // The 8th request is the first kind again
    assert.equal(stopped, stopReason('Request failed with status code 502'));
    assert.equal(requests.length, 8);
});

test('an answer between two failures resets the count, a 404 included', async () => {
    for (const answer of [undefined, new Response('', { status: 404 })]) {
        // 7 failures, an answer, 7 failures: never 8 in a row
        const { computeLoad, requests } = setUp(fakeBitbucket({ intercept: count => (count === 8 ? answer : new Response('', { status: 503 })) }), { maxConcurrent: 1 });
        const { statuses, stopped } = await computeLoad('PROJ', manyPullRequests(15));
        assert.equal(stopped, null);
        assert.equal(requests.length, 15);
        assert.ok(Object.values(statuses).every(status => !status.reason?.startsWith('SYNC load stopped')));
    }
});

test('a rate-limit pause counts no failure, and a check counts one at most', async () => {
    const paused = setUp(fakeBitbucket({ intercept: () => { throw new RateLimitError(); } }), { maxConcurrent: 1 });
    const pausedLoad = await paused.computeLoad('PROJ', manyPullRequests(10));
    assert.equal(pausedLoad.stopped, null);
    assert.equal(paused.requests.length, 10);

    // One side fails, the other side's request in flight is aborted; both sides fail at once: one failure each time
    const sides = {
        'fails and stops the other': (url, options) => (url.includes(`/diff/${source}..`) ? new Response('', { status: 502 }) : hangUntilAborted(options)),
        'fail at once': () => new Response('', { status: 502 })
    };
    for (const [name, diffs] of Object.entries(sides)) {
        const { computeLoad } = setUp(fakeBitbucket({
            ...bothSides,
            intercept: (count, url, options) => (url.includes('/diff/') ? diffs(url, options) : undefined)
        }), { maxConsecutiveFailures: 2 });
        const { statuses, stopped } = await computeLoad('PROJ', [pullRequest()]);
        assert.equal(stopped, null, name);
        assert.equal(statuses[key].error, true, name);
    }
});

test('after a stop, the results read or completed before it are kept, a conflict the diffstats proved is partly checked', async () => {
    const cache = openSyncCache(tempFile());
    cache.set(`${repo}/c..c`, { conflicts: false });
    let diffsRequested;
    const inDiffs = new Promise(resolve => { diffsRequested = resolve; });
    const { computeLoad, requests, logs } = setUp(fakeBitbucket({
        diffstats: {
            'os..od': [modified('a.txt')], 'od..os': [modified('b.txt')], // complete before the stop: OK
            'ps..pd': [removed('g.txt'), modified('f.txt')], 'pd..ps': [modified('g.txt'), modified('f.txt')] // its diffs are in flight at the stop
        },
        intercept: async (count, url, options) => {
            if (url.includes('/diff/')) {
                diffsRequested();
                return hangUntilAborted(options);
            }
            // Fails once the other check waits for its diffs: the stop
            if (url.includes('/diffstat/xs..')) {
                await inDiffs;
                return new Response('', { status: 503 });
            }
        }
    }), { cache, maxConcurrent: 2, maxConsecutiveFailures: 1 });
    const { statuses, stopped } = await computeLoad('PROJ', [pullRequest('c', 'c'), pullRequest('od', 'os'), pullRequest('pd', 'ps'), pullRequest('xd', 'xs'), pullRequest('zd', 'zs')]);
    const reason = stopReason('Request failed with status code 503', 1);
    assert.equal(stopped, reason);
    assert.deepEqual(statuses, {
        [`${repo}/c..c`]: { conflicts: false },
        [`${repo}/od..os`]: { conflicts: false },
        [`${repo}/pd..ps`]: { conflicts: true, files: ['g.txt'], reason },
        [`${repo}/xd..xs`]: { error: true, reason: 'Request failed with status code 503' },
        [`${repo}/zd..zs`]: { error: true, reason }
    });
    assert.deepEqual(cache.get(`${repo}/od..os`), { conflicts: false });
    assert.equal(cache.get(`${repo}/pd..ps`), null);
    assert.ok(requests.every(request => !request.url.includes('zs')), 'nothing is sent for the check after the stop');
    assert.deepEqual(logs.error, ['Error computing sync status for repo-one xd..xs: Request failed with status code 503', `Sync statuses of PROJ: ${reason}`]);
});

test('a check that fails on its own after the stop keeps its reason and its log line', async () => {
    let diffsRequested;
    const inDiffs = new Promise(resolve => { diffsRequested = resolve; });
    const { computeLoad, logs } = setUp(fakeBitbucket({
        // The source diffstat counts two added lines, the patch one
        diffstats: { [`${source}..${dest}`]: [modified('f.txt', { lines_added: 2, lines_removed: 1 })], [`${dest}..${source}`]: [modified('f.txt')] },
        ...sameLine,
        intercept: async (count, url, options) => {
            // The diffs answer just as the load stops
            if (url.includes('/diff/')) {
                diffsRequested();
                await new Promise(resolve => options.signal.addEventListener('abort', resolve));
                return undefined;
            }
            if (url.includes('/diffstat/xs..')) {
                await inDiffs;
                return new Response('', { status: 503 });
            }
        }
    }), { maxConcurrent: 2, maxConsecutiveFailures: 1 });
    const { statuses, stopped } = await computeLoad('PROJ', [pullRequest(), pullRequest('xd', 'xs')]);
    const mismatch = 'f.txt: the diff (+1 -1) does not match the diffstat (+2 -1)';
    assert.equal(stopped, stopReason('Request failed with status code 503', 1));
    assert.deepEqual(statuses[key], { error: true, reason: mismatch });
    assert.ok(logs.error.includes(`Error computing sync status for repo-one dddd..ssss: ${mismatch}`), logs.error.join('\n'));
});
