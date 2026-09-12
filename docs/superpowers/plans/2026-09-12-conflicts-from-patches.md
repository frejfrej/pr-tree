# Conflicts From Patches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide the SYNC (conflict) status of a pull request from Bitbucket's diffs of both sides instead of a three-way merge of the files, keep the results on disk for good, and show every computed pull request an explicit badge (#46).

**Architecture:** A new pure module `conflicts.mjs` parses unified diffs into change regions in merge-base coordinates and applies git's rule (overlapping or touching changes with different content, modify/delete, add/add, binaries). `index.mjs` keeps the two diffstat calls, decides what it can from their statuses, fetches one patch per side restricted to the remaining overlapping files (`diff/{side}..{other}?topic=true&path=...`) and asks `conflicts.mjs`. A new `sync-cache.mjs` keeps `{ conflicts, files }` per `repo/dest..source` in `sync-cache.json`, loaded at startup and written atomically after each load. The frontend paints OK, SYNC (files in the tooltip) or `?` (reason) and the SYNC filter gets "Not checked". `node-diff3`, the merge-base call and the file fetches go.

**Tech Stack:** Node 24 (built-in `fetch`, `fs/promises`), Express 5, `node:test`, vanilla ES modules in the browser.

**Spec:** `docs/superpowers/specs/2026-09-11-conflicts-from-patches-design.md`

**Branch:** `claude/conflicts-from-patches`, created from `master` (already checked out; HEAD is the spec commit). Do not `git add` `config.js`, `config.js.test`, `.claude/` or `sync-cache.json`; add files by name. Commit messages end with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay
```

(an implementer whose own instructions prescribe another Co-Authored-By model uses that one and keeps the Claude-Session line).

**CRLF:** `index.mjs`, `cache.mjs`, `package-lock.json` and `.gitignore` use CRLF line endings on every line. After editing one, check `grep -c $'\r' <file>` equals `wc -l < <file>` and that `git diff --stat <file>` reports only the lines you meant to change; if the whole file shows as changed, restore the endings with `perl -pi -e 's/\r?\n/\r\n/' <file>` and check again. New files and every other file use LF.

**Running the unit tests:** `npm test`, expected to end with `ℹ fail 0` (77 tests before this plan). `test/server.test.mjs` starts the server in fixture mode on `PORT=0` by itself; never start the server on a fixed port (3000, 3100 are taken; 3101 and 3102 are for the controller's checks). Never read or print `config.js`. Never load the SYNC status of the SECOLLAB project against Atlassian.

**Task order:** 1, 2 and 4 are independent; 3 needs 1 and 2; 5 needs only the response shape (it can follow 3 or 4); 6 is last.

---

### Task 1: `conflicts.mjs`, the pure conflict rule

**Files:**
- Create: `conflicts.mjs` (project root, next to `cache.mjs`)
- Create: `test/conflicts.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/conflicts.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff, conflictingFiles, decideFromDiffstat } from '../conflicts.mjs';

// A one-file, one-hunk patch as git prints it; `body` holds the hunk lines with their leading space, - or +
function patch(file, header, body) {
    return `diff --git a/${file} b/${file}\nindex 1111111..2222222 100644\n--- a/${file}\n+++ b/${file}\n@@ ${header} @@\n${body.join('\n')}\n`;
}
const base = [' l1', ' l2', ' l3', ' l4', ' l5', ' l6'];
// The six-line file with line `n` replaced by `text` (1-based)
function modify(file, n, text) {
    return patch(file, '-1,6 +1,6', base.map((line, i) => (i === n - 1 ? [`-${line.slice(1)}`, `+${text}`] : [line])).flat());
}
// The six-line file with `text` inserted after line `n`
function insertAfter(file, n, text) {
    return patch(file, '-1,6 +1,7', base.flatMap((line, i) => (i === n - 1 ? [line, `+${text}`] : [line])));
}
const regions = (files, path) => files.get(path).regions;

test('parseUnifiedDiff reads change regions in base coordinates: a modification and an insertion', () => {
    const files = parseUnifiedDiff(patch('f.txt', '-1,6 +1,7', [' l1', ' l2', '-l3', '+L3', ' l4', ' l5', '+X', ' l6']));
    assert.deepEqual([...files.keys()], ['f.txt']);
    const file = files.get('f.txt');
    assert.equal(file.oldPath, 'f.txt');
    assert.equal(file.newPath, 'f.txt');
    assert.deepEqual({ added: file.added, deleted: file.deleted, binary: file.binary }, { added: false, deleted: false, binary: false });
    assert.deepEqual(file.regions, [
        { start: 3, end: 4, lines: ['L3'] },
        { start: 6, end: 6, lines: ['X'] }
    ]);
});

test('parseUnifiedDiff: an insertion-only hunk sits before the line that follows it', () => {
    const files = parseUnifiedDiff(patch('f.txt', '-5,0 +6,2', ['+a', '+b']));
    assert.deepEqual(regions(files, 'f.txt'), [{ start: 6, end: 6, lines: ['a', 'b'] }]);
});

test('parseUnifiedDiff: added, deleted, binary and renamed files', () => {
    const added = parseUnifiedDiff('diff --git a/n.txt b/n.txt\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n');
    assert.equal(added.get('n.txt').added, true);
    assert.deepEqual(regions(added, 'n.txt'), [{ start: 1, end: 1, lines: ['a', 'b'] }]);

    const deleted = parseUnifiedDiff('diff --git a/d.txt b/d.txt\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/d.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n');
    assert.equal(deleted.get('d.txt').deleted, true);
    assert.deepEqual(regions(deleted, 'd.txt'), [{ start: 1, end: 3, lines: [] }]);

    const binary = parseUnifiedDiff('diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nBinary files a/img.png and b/img.png differ\n');
    assert.equal(binary.get('img.png').binary, true);
    assert.deepEqual(regions(binary, 'img.png'), []);

    const renamed = parseUnifiedDiff('diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n');
    assert.deepEqual([...renamed.keys()], ['old.txt']);
    assert.equal(renamed.get('old.txt').newPath, 'new.txt');
    assert.deepEqual(regions(renamed, 'old.txt'), []);
});

test('parseUnifiedDiff: several files, several hunks, an empty context line, CRLF line endings, "no newline" markers', () => {
    // The first hunk of b.txt has an empty context line (its leading space stripped): it still counts as a base line
    const text = patch('a.txt', '-1,6 +1,6', [' l1', ' l2', '-l3', '+A3', ' l4', ' l5', ' l6']) +
        'diff --git a/b.txt b/b.txt\nindex 1111111..2222222 100644\n--- a/b.txt\n+++ b/b.txt\n@@ -1,4 +1,4 @@\n-x\n+y\n z\n\n w\n\\ No newline at end of file\n@@ -11,2 +11,2 @@\n p\n-q\n+Q\n\\ No newline at end of file\n';
    const files = parseUnifiedDiff(text.replace(/\n/g, '\r\n'));
    assert.deepEqual([...files.keys()], ['a.txt', 'b.txt']);
    assert.deepEqual(regions(files, 'a.txt'), [{ start: 3, end: 4, lines: ['A3'] }]);
    assert.deepEqual(regions(files, 'b.txt'), [{ start: 1, end: 2, lines: ['y'] }, { start: 12, end: 13, lines: ['Q'] }]);
});

test('conflictingFiles: overlapping or touching changes conflict, separated ones do not', () => {
    const a = parseUnifiedDiff(modify('f.txt', 3, 'A3'));
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modify('f.txt', 3, 'B3'))), ['f.txt']); // same line
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modify('f.txt', 4, 'B4'))), ['f.txt']); // adjacent line
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modify('f.txt', 2, 'B2'))), ['f.txt']); // adjacent line, other side
    assert.deepEqual(conflictingFiles(a, parseUnifiedDiff(modify('f.txt', 5, 'B5'))), []); // one unchanged line between
});

test('conflictingFiles: an insertion conflicts with a change of the lines around it', () => {
    const insertion = parseUnifiedDiff(insertAfter('f.txt', 3, 'X'));
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(modify('f.txt', 4, 'B4'))), ['f.txt']); // the line after
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(modify('f.txt', 3, 'B3'))), ['f.txt']); // the line before
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(modify('f.txt', 6, 'B6'))), []);
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(insertAfter('f.txt', 3, 'Y'))), ['f.txt']); // same place, different text
    assert.deepEqual(conflictingFiles(insertion, parseUnifiedDiff(insertAfter('f.txt', 3, 'X'))), []); // same insertion on both sides
});

test('conflictingFiles: the same change on both sides merges cleanly', () => {
    const a = parseUnifiedDiff(modify('f.txt', 3, 'X3'));
    const b = parseUnifiedDiff(modify('f.txt', 3, 'X3'));
    assert.deepEqual(conflictingFiles(a, b), []);
});

test('conflictingFiles: added on both sides, deleted on one side, binaries', () => {
    const addedA = 'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n';
    const addedSame = parseUnifiedDiff(addedA);
    const addedOther = parseUnifiedDiff(addedA.replace('+b\n', '+c\n'));
    assert.deepEqual(conflictingFiles(parseUnifiedDiff(addedA), addedSame), []);
    assert.deepEqual(conflictingFiles(parseUnifiedDiff(addedA), addedOther), ['n.txt']);

    const deleted = parseUnifiedDiff('diff --git a/f.txt b/f.txt\ndeleted file mode 100644\n--- a/f.txt\n+++ /dev/null\n@@ -1,6 +0,0 @@\n-l1\n-l2\n-l3\n-l4\n-l5\n-l6\n');
    assert.deepEqual(conflictingFiles(deleted, parseUnifiedDiff(modify('f.txt', 5, 'B5'))), ['f.txt']); // modify/delete
    assert.deepEqual(conflictingFiles(deleted, deleted), []); // deleted on both sides

    const binary = parseUnifiedDiff('diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nBinary files a/img.png and b/img.png differ\n');
    assert.deepEqual(conflictingFiles(binary, binary), ['img.png']);
});

test('conflictingFiles: only the files present on both sides count, sorted', () => {
    const a = parseUnifiedDiff(modify('b.txt', 3, 'A') + modify('a.txt', 3, 'A') + modify('only-a.txt', 3, 'A'));
    const b = parseUnifiedDiff(modify('a.txt', 3, 'B') + modify('b.txt', 3, 'B') + modify('only-b.txt', 3, 'B'));
    assert.deepEqual(conflictingFiles(a, b), ['a.txt', 'b.txt']);
});

test('decideFromDiffstat: deletions are decided without a patch, the rest is checked', () => {
    const source = new Map([
        ['gone-both.txt', { status: 'removed', sidePath: 'gone-both.txt' }],
        ['gone-here.txt', { status: 'removed', sidePath: 'gone-here.txt' }],
        ['kept.txt', { status: 'modified', sidePath: 'kept.txt' }],
        ['moved.txt', { status: 'renamed', sidePath: 'moved-here.txt' }],
        ['only-source.txt', { status: 'modified', sidePath: 'only-source.txt' }]
    ]);
    const dest = new Map([
        ['gone-both.txt', { status: 'removed', sidePath: 'gone-both.txt' }],
        ['gone-here.txt', { status: 'modified', sidePath: 'gone-here.txt' }],
        ['kept.txt', { status: 'modified', sidePath: 'kept.txt' }],
        ['moved.txt', { status: 'modified', sidePath: 'moved.txt' }],
        ['only-dest.txt', { status: 'added', sidePath: 'only-dest.txt' }]
    ]);
    assert.deepEqual(decideFromDiffstat(source, dest), { conflicting: ['gone-here.txt'], toCheck: ['kept.txt', 'moved.txt'] });
    assert.deepEqual(decideFromDiffstat(new Map(), dest), { conflicting: [], toCheck: [] });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: `test/conflicts.test.mjs` fails to load (`Cannot find module '../conflicts.mjs'`).

- [ ] **Step 3: Write the module**

Create `conflicts.mjs`:

```js
/**
 * Conflicts of a pull request decided from Bitbucket's patches, without file
 * contents. For a pull request dest..source, the diffs of each side since the
 * merge base (diff/{side}..{other}?topic=true) have their hunks in the line
 * coordinates of the same merge-base version, so git's rule is decidable from
 * the two patches: two changes of the same file conflict when their base
 * ranges overlap or touch, unless they replace the same range with the same
 * lines; a file deleted on one side and changed on the other conflicts; a file
 * added on both sides conflicts unless the content is identical; a binary file
 * changed on both sides conflicts. Pure: nothing here talks to Bitbucket.
 */

/**
 * The files of a unified diff, keyed by their base path (the "a/" path of the
 * header, the path the other side knows too), with their change regions in
 * base line coordinates: { start, end, lines } where [start, end) are the base
 * lines replaced (start === end for an insertion before line `start`) and
 * `lines` is what the side puts there.
 * @param {string} text - a git unified diff, LF or CRLF
 * @returns {Map<string, { oldPath: string, newPath: string, added: boolean, deleted: boolean, binary: boolean, regions: { start: number, end: number, lines: string[] }[] }>}
 */
export function parseUnifiedDiff(text) {
    const files = new Map();
    let file = null;
    let inHunk = false;
    let baseLine = 0;
    let run = null;
    const closeRun = () => {
        if (run) {
            file.regions.push(run);
            run = null;
        }
    };

    for (const rawLine of text.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith('diff --git ')) {
            closeRun();
            const header = line.match(/^diff --git a\/(.*) b\/(.*)$/);
            file = {
                oldPath: header ? header[1] : line.slice('diff --git '.length),
                newPath: header ? header[2] : line.slice('diff --git '.length),
                added: false,
                deleted: false,
                binary: false,
                regions: []
            };
            files.set(file.oldPath, file);
            inHunk = false;
            continue;
        }
        if (!file) continue;
        if (!inHunk) {
            if (line.startsWith('--- ')) {
                if (line === '--- /dev/null') file.added = true;
                else if (line.startsWith('--- a/')) file.oldPath = line.slice('--- a/'.length);
            } else if (line.startsWith('+++ ')) {
                if (line === '+++ /dev/null') file.deleted = true;
                else if (line.startsWith('+++ b/')) file.newPath = line.slice('+++ b/'.length);
            } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
                file.binary = true;
            }
        }
        const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
        if (hunk) {
            closeRun();
            inHunk = true;
            const baseStart = Number(hunk[1]);
            const baseCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
            // A hunk with no base line is an insertion after the line it names
            baseLine = baseCount === 0 ? baseStart + 1 : baseStart;
            continue;
        }
        if (!inHunk) continue;
        const kind = line[0];
        if (kind === '\\') continue; // "\ No newline at end of file"
        if (kind === ' ' || line === '') {
            // a context line (an empty line is one whose leading space was stripped)
            closeRun();
            baseLine++;
        } else if (kind === '-') {
            if (!run) run = { start: baseLine, end: baseLine, lines: [] };
            run.end = ++baseLine;
        } else if (kind === '+') {
            if (!run) run = { start: baseLine, end: baseLine, lines: [] };
            run.lines.push(line.slice(1));
        } else {
            // anything else ends the hunk
            closeRun();
            inHunk = false;
        }
    }
    closeRun();
    return files;
}

// Two changes of the same base region conflict when they overlap or touch,
// unless they are the same change (same range, same replacement)
function regionsConflict(a, b) {
    if (a.end < b.start || b.end < a.start) return false;
    const same = a.start === b.start && a.end === b.end &&
        a.lines.length === b.lines.length && a.lines.every((line, i) => line === b.lines[i]);
    return !same;
}

function sameContent(a, b) {
    return a.regions.length === 1 && b.regions.length === 1 &&
        a.regions[0].lines.join('\n') === b.regions[0].lines.join('\n');
}

/**
 * The base paths of the files that conflict between the two sides, sorted.
 * A file present on one side only cannot conflict.
 * @param {Map} sideA - parseUnifiedDiff of one side
 * @param {Map} sideB - parseUnifiedDiff of the other side
 * @returns {string[]}
 */
export function conflictingFiles(sideA, sideB) {
    const conflicts = [];
    for (const [basePath, a] of sideA) {
        const b = sideB.get(basePath);
        if (!b) continue;
        let conflict;
        if (a.deleted && b.deleted) conflict = false;
        else if (a.deleted || b.deleted) conflict = true;
        else if (a.binary || b.binary) conflict = true;
        else if (a.added && b.added) conflict = !sameContent(a, b);
        else conflict = a.regions.some(ra => b.regions.some(rb => regionsConflict(ra, rb)));
        if (conflict) conflicts.push(basePath);
    }
    return conflicts.sort();
}

/**
 * What the diffstats of both sides decide without a patch: a file removed on
 * both sides is no conflict, a file removed on one side and touched on the
 * other is one; every other overlapping file needs the patches.
 * @param {Map<string, { status: string, sidePath: string }>} sourceFiles - diffstat of the source side, keyed by base path
 * @param {Map<string, { status: string, sidePath: string }>} destFiles - diffstat of the destination side
 * @returns {{ conflicting: string[], toCheck: string[] }}
 */
export function decideFromDiffstat(sourceFiles, destFiles) {
    const conflicting = [];
    const toCheck = [];
    for (const [basePath, source] of sourceFiles) {
        const dest = destFiles.get(basePath);
        if (!dest) continue;
        const sourceRemoved = source.status === 'removed';
        const destRemoved = dest.status === 'removed';
        if (sourceRemoved && destRemoved) continue;
        if (sourceRemoved || destRemoved) conflicting.push(basePath);
        else toCheck.push(basePath);
    }
    return { conflicting, toCheck };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test`
Expected: `ℹ tests 87`, `ℹ fail 0` (10 new tests). If an assertion about a region disagrees with the module, re-derive the expected value from the rule in the module's header comment before changing either side, and report the change.

- [ ] **Step 5: Commit**

```bash
git add conflicts.mjs test/conflicts.test.mjs
git commit -m "feat: decide conflicts from the patches of both sides, a pure module (#46)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 2: `sync-cache.mjs`, the results kept on disk

**Files:**
- Create: `sync-cache.mjs` (project root)
- Create: `test/sync-cache.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/sync-cache.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openSyncCache, syncCacheVersion } from '../sync-cache.mjs';

function tempFile() {
    return path.join(mkdtempSync(path.join(tmpdir(), 'sync-cache-')), 'sync-cache.json');
}

test('a missing file opens an empty cache without an error', () => {
    const errors = [];
    const cache = openSyncCache(tempFile(), { onError: error => errors.push(error) });
    assert.equal(cache.size, 0);
    assert.equal(cache.get('repo/a..b'), null);
    assert.deepEqual(errors, []);
});

test('results round trip through the file without their timestamp, and reload', async () => {
    const file = tempFile();
    const cache = openSyncCache(file, { now: () => Date.parse('2026-09-12T10:00:00Z') });
    cache.set('repo/a..b', { conflicts: true, files: ['x'] });
    cache.set('repo/c..d', { conflicts: false });
    assert.deepEqual(cache.get('repo/a..b'), { conflicts: true, files: ['x'] });
    assert.equal(await cache.save(), true);
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(stored.version, syncCacheVersion);
    assert.equal(stored.entries['repo/a..b'].computedAt, '2026-09-12T10:00:00.000Z');
    const reopened = openSyncCache(file);
    assert.equal(reopened.size, 2);
    assert.deepEqual(reopened.get('repo/c..d'), { conflicts: false });
    assert.equal(await reopened.save(), false); // nothing new: no write
    assert.deepEqual(readdirSync(path.dirname(file)), ['sync-cache.json']); // no temporary file left behind
});

test('entries older than the maximum age are dropped when the file is written', async () => {
    const file = tempFile();
    let clock = Date.parse('2026-01-01T00:00:00Z');
    const cache = openSyncCache(file, { now: () => clock, maxAgeDays: 90 });
    cache.set('repo/old..old', { conflicts: false });
    clock = Date.parse('2026-06-01T00:00:00Z');
    cache.set('repo/new..new', { conflicts: false });
    await cache.save();
    const reopened = openSyncCache(file);
    assert.equal(reopened.get('repo/old..old'), null);
    assert.deepEqual(reopened.get('repo/new..new'), { conflicts: false });
});

test('a corrupt file or another version opens empty and is reported', () => {
    const file = tempFile();
    const errors = [];
    writeFileSync(file, '{not json');
    assert.equal(openSyncCache(file, { onError: error => errors.push(error) }).size, 0);
    writeFileSync(file, JSON.stringify({ version: 999, entries: { 'repo/a..b': { conflicts: false } } }));
    assert.equal(openSyncCache(file, { onError: error => errors.push(error) }).size, 0);
    assert.equal(errors.length, 2);
});

test('two saves in a row write once each, in order', async () => {
    const file = tempFile();
    const cache = openSyncCache(file);
    cache.set('repo/a..b', { conflicts: false });
    const first = cache.save();
    cache.set('repo/c..d', { conflicts: false });
    const second = cache.save();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(openSyncCache(file).size, 2);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: `test/sync-cache.test.mjs` fails to load (`Cannot find module '../sync-cache.mjs'`).

- [ ] **Step 3: Write the module**

Create `sync-cache.mjs`:

```js
import { readFileSync } from 'fs';
import { rename, writeFile } from 'fs/promises';

/**
 * The conflicts of pull requests by "repo/destHash..sourceHash", kept on disk
 * across server restarts: a result only depends on the two commits, so it
 * never changes. Entries computed more than maxAgeDays ago are dropped when
 * the file is written (merged pull requests leave their hashes behind). Only
 * successful results are meant to be stored; a failure is retried by the
 * caller at the next load.
 */

export const syncCacheVersion = 1;
const dayMs = 24 * 60 * 60 * 1000;

/**
 * Opens (reads) the cache file. A missing file is an empty cache; an
 * unreadable one or another version is reported through onError and ignored.
 * @param {string} filePath - the JSON file
 * @param {object} [options]
 * @param {number} [options.maxAgeDays=90] - entries older than this are dropped at save
 * @param {() => number} [options.now] - clock, for the tests
 * @param {(error: Error) => void} [options.onError] - called when the file cannot be used
 */
export function openSyncCache(filePath, { maxAgeDays = 90, now = () => Date.now(), onError = () => {} } = {}) {
    const entries = new Map();
    let dirty = false;
    let saving = Promise.resolve(false);

    try {
        const stored = JSON.parse(readFileSync(filePath, 'utf8'));
        if (stored && stored.version === syncCacheVersion && stored.entries && typeof stored.entries === 'object') {
            for (const [key, entry] of Object.entries(stored.entries)) {
                entries.set(key, entry);
            }
        } else {
            onError(new Error(`unexpected content in ${filePath}`));
        }
    } catch (error) {
        if (error.code !== 'ENOENT') onError(error);
    }

    function prune() {
        const oldest = now() - maxAgeDays * dayMs;
        for (const [key, entry] of entries) {
            if (!(Date.parse(entry.computedAt) >= oldest)) entries.delete(key); // an unparsable date goes too
        }
    }

    async function write() {
        if (!dirty) return false;
        prune();
        // A temporary file then a rename: a crash never leaves a truncated cache
        const temporary = `${filePath}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: syncCacheVersion, entries: Object.fromEntries(entries) }));
        await rename(temporary, filePath);
        dirty = false;
        return true;
    }

    return {
        get size() {
            return entries.size;
        },
        /** The stored result without its timestamp, null when unknown */
        get(key) {
            const entry = entries.get(key);
            if (!entry) return null;
            const { computedAt, ...result } = entry;
            return result;
        },
        set(key, result) {
            entries.set(key, { ...result, computedAt: new Date(now()).toISOString() });
            dirty = true;
        },
        /** Writes the file when something changed; resolves to whether it did. One write at a time. */
        save() {
            saving = saving.then(write, write);
            return saving;
        }
    };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test`
Expected: `ℹ tests 92`, `ℹ fail 0` (5 new tests).

- [ ] **Step 5: Commit**

```bash
git add sync-cache.mjs test/sync-cache.test.mjs
git commit -m "feat: conflict results kept on disk across restarts, sync-cache.mjs (#46)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 3: The server computes from patches and keeps the results

**Files:**
- Modify: `index.mjs` (CRLF): the imports, a `syncCache` after the logging middleware, the `/api/sync-statuses/:project` route, `computeConflicts` and its neighbours at the end of the file
- Modify: `cache.mjs` (CRLF): `CACHE_KEYS.CONFLICTS` and `getCachedConflicts` removed
- Modify: `package.json`, `package-lock.json` (CRLF): `node-diff3` removed
- Modify: `.gitignore` (CRLF): `sync-cache.json`

- [ ] **Step 1: The imports**

At the top of `index.mjs`, delete the line `import { diff3Merge } from 'node-diff3';`, delete the line `    getCachedConflicts,` from the `./cache.mjs` import list, and add after the `./fixtures/index.mjs` import line:

```js
import { decideFromDiffstat, parseUnifiedDiff, conflictingFiles } from './conflicts.mjs';
import { openSyncCache } from './sync-cache.mjs';
```

- [ ] **Step 2: The persistent cache**

Right after the access-log middleware (the `app.use((req, res, next) => { ... next(); });` block, before the comment `// Atlassian rate-limit circuit breaker`), add:

```js
// A conflict result never changes for a pair of commits: the results are kept
// on disk and survive restarts (sync-cache.mjs); only failures are recomputed
const syncCache = openSyncCache(path.join(__dirname, 'sync-cache.json'), {
    onError: error => log(`sync-cache.json ignored: ${error.message}`, errorLogStream)
});

```

- [ ] **Step 3: The route**

In the `/api/sync-statuses/:project` route, replace the `try { ... } catch (error) { ... }` inside the `Promise.all(projectData.pullRequests.map(async (pullRequest) => { ... }))` callback, i.e.

```js
                try {
                    statuses[`${repoName}/${spec}`] = await getCachedConflicts(repoName, spec, () => {
                        return conflictsLimiter(() => computeConflicts(repoName, spec));
                    });
                } catch (error) {
                    if (!(error instanceof RateLimitError)) {
                        log(`Error computing sync status for ${repoName} ${spec}: ${error.message}`, errorLogStream);
                    }
                    statuses[`${repoName}/${spec}`] = { error: true };
                }
```

with

```js
                const key = `${repoName}/${spec}`;
                try {
                    let result = syncCache.get(key);
                    if (!result) {
                        result = await conflictsLimiter(() => computeConflicts(repoName, spec));
                        if (!result.error) syncCache.set(key, result);
                    }
                    statuses[key] = result;
                } catch (error) {
                    if (error instanceof RateLimitError) {
                        statuses[key] = { error: true, reason: 'Atlassian requests are paused after a rate limit' };
                    } else {
                        log(`Error computing sync status for ${repoName} ${spec}: ${error.message}`, errorLogStream);
                        statuses[key] = { error: true, reason: error.message };
                    }
                }
```

then, right after the closing `}));` of that `Promise.all`, add:

```js
            await syncCache.save().catch(error => log(`sync-cache.json not written: ${error.message}`, errorLogStream));
```

and change the comment `// regular ones are cached like individual conflicts (5 minutes)` to `// regular ones for 5 minutes`.

- [ ] **Step 4: The computation**

Delete the whole `fetchFileAtCommit` function with its comment (`// Returns the file content at a commit, null if the file does not exist there.`), the comment block that starts with `// Bitbucket removed merge-preview diffs from its API and the replacement`, the line `const maxConflictCandidates = 50;`, the blank line after it and the whole `computeConflicts` function. In their place (between `fetchDiffstatFiles` and `const server = app.listen(...)`) put:

```js
// The changes of one side since the merge base, restricted to the given paths,
// as parsed by conflicts.mjs. Bitbucket's diff/{a}..{b}?topic=true is the
// three-dot diff of side `a` (checked against diffstat on 2026-09-11); `path`
// can be repeated, in chunks so the URL stays short.
const pathsPerPatchRequest = 20;

async function fetchPatch(repoName, sideCommit, otherCommit, paths) {
    const files = new Map();
    const uniquePaths = [...new Set(paths)];
    for (let i = 0; i < uniquePaths.length; i += pathsPerPatchRequest) {
        const query = uniquePaths.slice(i, i + pathsPerPatchRequest).map(p => `path=${encodeURIComponent(p)}`).join('&');
        const url = `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${repoName}/diff/${sideCommit}..${otherCommit}?topic=true&${query}`;
        const response = await atlassianFetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(30000),
            headers: { 'Authorization': `Basic ${bbAuth}` }
        });
        if (!response.ok) {
            await response.arrayBuffer().catch(() => {}); // release the socket
            throw new Error(`Request failed with status code ${response.status}`);
        }
        for (const [basePath, file] of parseUnifiedDiff(await response.text())) {
            files.set(basePath, file);
        }
    }
    return files;
}

// Bitbucket removed merge-preview diffs from its API and the replacement
// /pullrequests/{id}/conflicts endpoint rejects API-token auth, so conflicts
// are decided here: the files touched on both sides since the merge base come
// from the diffstats, what the statuses do not decide comes from the patches
// of both sides (conflicts.mjs). No file content is fetched, nothing is merged.
const maxOverlappingFiles = 100;

async function computeConflicts(repoName, spec) {
    const startTime = Date.now();
    const [destCommit, sourceCommit] = spec.split('..');

    const sourceFiles = await fetchDiffstatFiles(repoName, sourceCommit, destCommit);
    if (sourceFiles.size === 0) return { conflicts: false };
    const destFiles = await fetchDiffstatFiles(repoName, destCommit, sourceCommit);
    const { conflicting, toCheck } = decideFromDiffstat(sourceFiles, destFiles);
    const overlapping = conflicting.length + toCheck.length;
    if (overlapping > maxOverlappingFiles) {
        return { error: true, reason: `too many overlapping files (${overlapping})` };
    }

    const files = [...conflicting];
    if (toCheck.length > 0) {
        // The base path and the path on each side: a renamed file is found under both
        const paths = toCheck.flatMap(basePath => [basePath, sourceFiles.get(basePath).sidePath, destFiles.get(basePath).sidePath]);
        const [sourcePatch, destPatch] = await Promise.all([
            fetchPatch(repoName, sourceCommit, destCommit, paths),
            fetchPatch(repoName, destCommit, sourceCommit, paths)
        ]);
        files.push(...conflictingFiles(sourcePatch, destPatch));
    }
    files.sort();

    const duration = Date.now() - startTime;
    log(`computeConflicts - ${repoName} ${spec} - ${overlapping} overlapping files - conflicts: ${files.length > 0} - Duration: ${duration}ms`, performanceLogStream);
    return files.length > 0 ? { conflicts: true, files } : { conflicts: false };
}

```

Keep `fetchBitbucketJson`, `createLimiter`, `conflictsLimiter` and `fetchDiffstatFiles` as they are. Check the CRLF endings of `index.mjs`.

- [ ] **Step 5: cache.mjs, package.json, .gitignore**

In `cache.mjs`, delete the line `    CONFLICTS: (repoName, spec) => \`conflicts_${repoName}_${spec}\`,` from `CACHE_KEYS`, and delete the `getCachedConflicts` function with its JSDoc comment and the blank line that follows it (the file keeps `getCachedProjects`, `getCachedProjectData`, `getCachedSyncStatuses`, `raiseAllCacheTtls`, `getCacheStats`, one blank line between each). Check the CRLF endings.

Run `npm uninstall node-diff3`, then `perl -pi -e 's/\r?\n/\r\n/' package-lock.json` and check `grep -c $'\r' package-lock.json` equals `wc -l < package-lock.json`; `git diff --stat package-lock.json` shows the removed `node-diff3` entry and the root block only (npm re-sorts nothing else; the version in the lock root stays 2.6.0 until Task 6 bumps it).

In `.gitignore`, append after the `Bitbucket-pr-tree*.gif` line (keep CRLF on the new lines):

```
# Conflict results kept across restarts
sync-cache.json
```

- [ ] **Step 6: Run the tests**

Run: `npm test && npm ls --depth=0`
Expected: `ℹ tests 92`, `ℹ fail 0` (the server test starts the server: the imports resolve, the route still answers from the fixtures); `npm ls` lists `express` and `node-cache` only. Also `grep -n "diff3\|fetchFileAtCommit\|maxConflictCandidates\|getCachedConflicts" index.mjs cache.mjs` finds nothing, and `git status --short` shows no `sync-cache.json` (fixture mode never writes it).

- [ ] **Step 7: Commit**

```bash
git add index.mjs cache.mjs package.json package-lock.json .gitignore
git commit -m "feat: the SYNC load decides conflicts from the patches of both sides and keeps the results (#46)

Two diffstats, then one diff per side restricted to the overlapping files,
instead of a merge-base call, three file fetches per file and a three-way
merge that ran for minutes on the event loop. Results go to sync-cache.json.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 4: The fixtures produce the new shapes

**Files:**
- Modify: `fixtures/generate.mjs` (`generateSyncStatuses`, at the end of the file)
- Modify: `test/fixtures.test.mjs` (the test `sync statuses cover every pull request with a conflicts or error flag`)
- Modify: `test/server.test.mjs` (one test appended)

- [ ] **Step 1: The tests**

In `test/fixtures.test.mjs`, replace the test `sync statuses cover every pull request with a conflicts or error flag` with:

```js
test('sync statuses cover every pull request: OK, conflicting files or a reason', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const sync = generateSyncStatuses(data);
    assert.equal(Object.keys(sync.statuses).length, data.pullRequests.length);
    assert.equal(sync.rateLimited, false);
    const kinds = { ok: 0, conflicts: 0, errors: 0 };
    for (const status of Object.values(sync.statuses)) {
        if (status.error === true) {
            assert.equal(typeof status.reason, 'string');
            kinds.errors++;
        } else if (status.conflicts === true) {
            assert.ok(Array.isArray(status.files) && status.files.length > 0 && status.files.every(file => typeof file === 'string'));
            kinds.conflicts++;
        } else {
            assert.deepEqual(status, { conflicts: false });
            kinds.ok++;
        }
    }
    assert.ok(kinds.ok > 0 && kinds.conflicts > 0 && kinds.errors > 0, JSON.stringify(kinds));
    assert.deepEqual(generateSyncStatuses(data).statuses, sync.statuses); // deterministic
});
```

Append to `test/server.test.mjs`:

```js
test('the sync statuses of the fixtures have the documented shapes', async () => {
    const [project] = await (await fetch(`${baseUrl}/api/projects`)).json();
    const { statuses } = await (await fetch(`${baseUrl}/api/sync-statuses/${encodeURIComponent(project)}`)).json();
    const values = Object.values(statuses);
    assert.ok(values.length > 0);
    for (const status of values) {
        if (status.error) {
            assert.equal(typeof status.reason, 'string');
        } else if (status.conflicts) {
            assert.ok(Array.isArray(status.files) && status.files.length > 0);
        } else {
            assert.deepEqual(status, { conflicts: false });
        }
    }
});
```

- [ ] **Step 2: Run the tests to see the fixtures test fail**

Run: `npm test`
Expected: the fixtures test fails (`files` missing or `reason` missing); the server test may pass or fail depending on the SECOLLAB/OSLC data, that is fine at this step.

- [ ] **Step 3: The generator**

In `fixtures/generate.mjs`, replace the body of `generateSyncStatuses` so the function reads:

```js
/**
 * Builds the /api/sync-statuses/:project response: about a fifth of the pull
 * requests have conflicts (with the files), a few could not be computed (with
 * the reason), the rest are OK.
 */
const conflictFiles = [
    'src/com.sodius.oslc.web/package-lock.json',
    'src/com.sodius.oslc.web/projects/ng-sodius-oslc/core/src/i18n/messages_en.ts',
    'pom.xml',
    'src/main/java/com/sodius/secollab/review/ReviewService.java',
    'src/main/resources/messages.properties',
    'README.md'
];
const failureReasons = [
    'The operation was aborted due to timeout (https://api.bitbucket.org/2.0/repositories/sodius/products.secollab/diffstat/...)',
    'Request failed with status code 502',
    'too many overlapping files (140)'
];

export function generateSyncStatuses(projectData) {
    const random = createRandom(`sync-${projectData.pullRequests.length}`);
    const statuses = {};
    for (const pullRequest of projectData.pullRequests) {
        const spec = `${pullRequest.destination.commit?.hash}..${pullRequest.source.commit?.hash}`;
        if (spec.includes('undefined')) continue;
        const key = `${pullRequest.source.repository.name}/${spec}`;
        const roll = random();
        if (roll < 0.04) {
            statuses[key] = { error: true, reason: pick(random, failureReasons) };
        } else if (roll < 0.24) {
            const count = integer(random, 1, 3);
            const files = new Set();
            for (let i = 0; i < count; i++) files.add(pick(random, conflictFiles));
            statuses[key] = { conflicts: true, files: [...files].sort() };
        } else {
            statuses[key] = { conflicts: false };
        }
    }
    return {
        lastRefreshTime: new Date().toISOString(),
        rateLimited: false,
        rateLimitedUntil: null,
        statuses
    };
}
```

(the existing JSDoc comment above the function is replaced by the one above; `pick`, `integer` and `createRandom` already exist in the file).

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ tests 93`, `ℹ fail 0` (one new test; the fixtures test is replaced). If the fixtures test reports `kinds` with zero errors for SECOLLAB (the seeded rolls), raise the error share from `0.04` to `0.06` in the generator and run again; report the change.

- [ ] **Step 5: Commit**

```bash
git add fixtures/generate.mjs test/fixtures.test.mjs test/server.test.mjs
git commit -m "feat: fixture sync statuses carry the conflicting files and the failure reasons (#46)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 5: OK, SYNC and `?` badges, the "Not checked" filter

**Files:**
- Modify: `public/app-sync.js` (`applySyncStatuses`, `updateSyncControls`)
- Modify: `public/app-filter.js` (`evaluatePullRequest`, `filterBranches`, `filterPullRequest`)
- Modify: `public/styles.css` (after the `.conflicts-count` rule)
- Modify: `test/app-filter.test.mjs`

- [ ] **Step 1: The failing tests**

In `test/app-filter.test.mjs`, change the line

```js
const rendered = { statusInProgress: false, statusInReview: true, hasSyncLabel: false };
```

to

```js
const rendered = { statusInProgress: false, statusInReview: true, hasSyncLabel: false, hasOkBadge: false };
```

replace the test `evaluatePullRequest SYNC filter follows the rendered badge` with

```js
test('evaluatePullRequest SYNC filter follows the rendered badges: SYNC, OK, or neither', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    const syncBadge = { ...rendered, hasSyncLabel: true };
    const okBadge = { ...rendered, hasOkBadge: true };
    const noBadge = rendered;
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, syncBadge).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, okBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, noBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, okBadge).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, syncBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, noBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'unchecked' }, noBadge).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'unchecked' }, okBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'unchecked' }, syncBadge).visible, false);
});
```

and in the `countActiveFilters` test add, after the line asserting `sync: 'requested'` counts 1:

```js
    assert.equal(countActiveFilters({ ...defaults, sync: 'unchecked' }), 1);
```

- [ ] **Step 2: Run the tests to see the new one fail**

Run: `npm test`
Expected: the SYNC-filter test fails on `sync: 'OK'` with `noBadge` (visible today).

- [ ] **Step 3: app-filter.js**

In `evaluatePullRequest`, change the destructured third parameter `{ statusInProgress, statusInReview, hasSyncLabel }` to `{ statusInProgress, statusInReview, hasSyncLabel, hasOkBadge }`, its JSDoc line `*   statusInProgress, statusInReview (from the Jira statuses) and hasSyncLabel` to `*   statusInProgress, statusInReview (from the Jira statuses), hasSyncLabel and hasOkBadge (the painted SYNC badges)`, and the `syncMatch` expression to:

```js
    // 'OK' means computed without conflict; 'unchecked' is a pull request with neither badge
    const syncMatch = sync === 'Show all' ||
        (sync === 'requested' && hasSyncLabel) ||
        (sync === 'OK' && hasOkBadge) ||
        (sync === 'unchecked' && !hasSyncLabel && !hasOkBadge);
```

In `filterBranches`, after the `pullRequestsWithSyncLabel` property of `pass`, add the same collection for the OK badges:

```js
        pullRequestsWithOkBadge: new Set(
            Array.from(document.querySelectorAll('.pull-request .conflicts-ok'))
                .map(badge => badge.closest('.pull-request'))
                .filter(pullRequest => pullRequest)
                .map(pullRequest => pullRequest.dataset.id)
        ),
```

and change the comment above `pullRequestsWithSyncLabel` to `// The SYNC filter relies on the rendered badges: collect them once`. In `filterPullRequest`, after the line `hasSyncLabel: pass.pullRequestsWithSyncLabel.has(pullRequestElement.dataset.id)` add `,` and:

```js
            hasOkBadge: pass.pullRequestsWithOkBadge.has(pullRequestElement.dataset.id)
```

- [ ] **Step 4: app-sync.js**

Replace `applySyncStatuses` with:

```js
// One badge of the conflicts counter, built as DOM so file names and reasons need no escaping
function badge(className, title, text) {
    const element = document.createElement('div');
    element.className = className;
    element.title = title;
    element.textContent = text;
    return element;
}

function conflictsTitle(files) {
    if (!files || files.length === 0) return 'Conflicts found';
    const shown = files.slice(0, 5).join(', ');
    return files.length > 5 ? `Conflicts in ${shown} and ${files.length - 5} more` : `Conflicts in ${shown}`;
}

/** Renders the stored SYNC statuses onto the conflicts counters: OK, SYNC, or ? with the reason */
export function applySyncStatuses() {
    document.querySelectorAll('.conflicts-counter').forEach(counter => {
        const { repoName, spec } = counter.dataset;
        if (spec.includes('undefined')) {
            counter.replaceChildren(badge('conflicts-error', `Invalid spec provided ${spec}`, '!'));
            return;
        }
        if (!currentSyncStatuses) {
            counter.replaceChildren();
            return;
        }

        const status = currentSyncStatuses.statuses[`${repoName}/${spec}`];
        if (!status) {
            counter.replaceChildren(badge('conflicts-error', 'SYNC status unknown - use the SYNC load button to refresh', '?'));
        } else if (status.error) {
            counter.replaceChildren(badge('conflicts-error', `Could not check: ${status.reason || 'unknown error'}`, '?'));
        } else if (status.conflicts) {
            counter.replaceChildren(badge('conflicts-count', conflictsTitle(status.files), 'SYNC'));
        } else {
            counter.replaceChildren(badge('conflicts-ok', 'No conflict with the destination branch', 'OK'));
        }
    });
}
```

In `updateSyncControls`, add the option `<option value="unchecked">Not checked</option>` after `<option value="OK">SYNC ok</option>` in the `syncSelect.innerHTML` of the loaded state.

- [ ] **Step 5: styles.css**

Change the `.conflicts-count` rule so that it also styles the OK badge and add the colour of the latter right after it:

```css
.conflicts-count,
.conflicts-ok {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 8px;
    border-radius: 12px;
    background-color: var(--error-color);
    color: var(--on-accent-text);
    font-size: 12px;
    font-weight: bold;
}

.conflicts-ok {
    background-color: var(--success-color);
}
```

(`--success-color` and `--on-accent-text` exist in both theme blocks; add no colour.)

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: `ℹ tests 93`, `ℹ fail 0` (the SYNC-filter test is replaced, no new test). Also `node --check public/app-sync.js public/app-filter.js` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add public/app-sync.js public/app-filter.js public/styles.css test/app-filter.test.mjs
git commit -m "feat: OK, SYNC and ? badges with the files or the reason, a Not checked SYNC filter (#46)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 6: Version 2.7.0 and the documentation

**Files:**
- Modify: `package.json` (version, releaseDate)
- Modify: `README.md` (features, changelog)
- Modify: `CLAUDE.md` (version, stack, project structure, key files, app-sync bullets, endpoint, cache TTLs, testing, pitfalls)
- Modify: `PRD.md` (F6, 7.2, 7.4)

- [ ] **Step 1: package.json**

Set `"version": "2.7.0"` and `"releaseDate": "2026-09-12"`.

- [ ] **Step 2: README.md**

Replace the two feature lines

```
* Display SYNC in a badge onto each pull-requests that requires syncing with its parent branch
    * SYNC status is only fetched when clicking the load button next to the SYNC filter
```

with

```
* SYNC badges: once the SYNC status is loaded (the load button next to the SYNC filter, never automatically), each pull request shows a green OK, a red SYNC when it conflicts with its destination branch (the conflicting files in the tooltip) or a grey `?` with the reason when it could not be checked
    * Conflicts are decided from Bitbucket's diffs of both sides since the merge base, two to four requests per pull request; a result never changes for a pair of commits, so it is kept in `sync-cache.json` next to the server and reused across reloads and restarts
```

Insert right after the line `## Changelog:` (before `* Version 2.6.0`):

```
* Version 2.7.0
    * The SYNC load no longer freezes the server: conflicts are decided from Bitbucket's diffs of both sides instead of a three-way merge of the files (one merge of a 30,000-line lock file ran for five minutes on the event loop and made the other computations time out with `?` badges) (#46)
    * Two to four Bitbucket requests per pull request instead of about ten, so the SYNC load is affordable on the largest project; the results are kept for good in `sync-cache.json` (git-ignored), reused after a restart, and only the pull requests whose commits moved are computed again
    * Explicit SYNC badges: green OK, red SYNC with the conflicting files in the tooltip, grey `?` with the reason; a "Not checked" value in the SYNC filter; nothing is shown until the statuses are loaded
    * `node-diff3` is no longer a dependency
```

- [ ] **Step 3: CLAUDE.md**

1. `Current version: **2.6.0** (as of 2026-09-10)` becomes `Current version: **2.7.0** (as of 2026-09-12)`.
2. In "Technology Stack / Backend", delete the line `- **Three-way merge**: node-diff3 (v3.2.1), for the conflict computation`.
3. In the "Project Structure" tree, add after the `├── cache.mjs` line:

```
├── conflicts.mjs          # Conflicts decided from the patches of both sides (pure)
├── sync-cache.mjs         # Conflict results kept in sync-cache.json across restarts
```

4. In the `**index.mjs**` bullets of "Key Files Explained", replace the bullet that starts with `- The per-pull-request conflict computation (` with: `- The per-pull-request conflict computation survives only as an internal of `/api/sync-statuses/:project`: `computeConflicts` fetches the diffstats of both sides, decides deletions from their statuses, fetches one patch per side restricted to the overlapping files (`diff/{side}..{other}?topic=true&path=...`, chunks of 20 paths) and asks `conflicts.mjs`; more than 100 overlapping files is reported "not checked"; results are looked up in and added to `sync-cache.json` (`sync-cache.mjs`) before any request`.
5. After the `**cache.mjs**` block, add two blocks:

```
**conflicts.mjs**
- Pure: `parseUnifiedDiff(text)` turns a git unified diff into files keyed by base path with change regions `{ start, end, lines }` in merge-base line coordinates; `conflictingFiles(sideA, sideB)` applies git's rule (overlapping or touching regions with different content, modify/delete, add/add with different content, binaries); `decideFromDiffstat(sourceFiles, destFiles)` decides deletions from the diffstat statuses and lists the files that need the patches
- Unit-tested with synthetic patches (`test/conflicts.test.mjs`)

**sync-cache.mjs**
- `openSyncCache(filePath, { maxAgeDays, now, onError })`: `get(key)`, `set(key, result)`, `save()`; the file is `{ version: 1, entries: { "repo/dest..source": { conflicts, files, computedAt } } }`, written through a temporary file then a rename, pruned of entries older than 90 days at save; a missing file is an empty cache, an unreadable one is reported and ignored
- Only successful results are stored (the route stores nothing for `{ error: true }`), so failures are retried at the next load; fixture mode never writes the file
```

6. In the `**public/app-sync.js**` bullets, replace the `applySyncStatuses()` bullet with: `- `applySyncStatuses()`: paints the stored statuses onto the `.conflicts-counter` elements as DOM badges: green `OK` (`.conflicts-ok`), red `SYNC` (`.conflicts-count`, the conflicting files in the tooltip), grey `?` (`.conflicts-error`, the reason, or "unknown" when the key is absent), `!` for an invalid spec; nothing while statuses are not loaded; called after every render (before the filters run) and after every load`.
7. In the `**public/app-filter.js**` bullets, in the `filterBranches(filters)` bullet, replace `one walk of the rendered tree` with `collects the SYNC and OK badges once, then one walk of the rendered tree` (keep the rest), and in the `evaluatePullRequest` bullet append `; the SYNC filter values are `requested` (SYNC badge), `OK` (OK badge) and `unchecked` (neither)`.
8. In "### GET /api/sync-statuses/:project", replace the description paragraph with: `Returns the SYNC (conflicts) status of every open PR of a project in a single response (cached 5 minutes; each pull request's result is read from `sync-cache.json` first, so only the pull requests whose commits moved cost Bitbucket requests). Only called by the frontend when the user clicks the load button next to the SYNC filter, never automatically.` and the `statuses` example with:

```json
  "statuses": {
    "repo-name/destHash..sourceHash": { "conflicts": true, "files": ["src/package-lock.json"] },
    "repo-name/otherDest..otherSource": { "conflicts": false },
    "repo-name/thirdDest..thirdSource": { "error": true, "reason": "The operation was aborted due to timeout (https://...)" }
  }
```

9. In the `**cache.mjs**` bullets, delete the line `  - Conflicts: 300 seconds (5 minutes)` and add after the TTL list the bullet `- The per-pull-request conflict results are not in node-cache: they live in `sync-cache.json` (`sync-cache.mjs`), for good`.
10. In "Testing Approach", the `**Unit tests**` bullet: after `the fixture generator (volumes, determinism, deep stack, hierarchy)` insert `, the conflict rule on synthetic patches (`test/conflicts.test.mjs`), the on-disk cache (`test/sync-cache.test.mjs`)`.
11. In "Common Pitfalls", add a new numbered item at the end: `14. **Conflict computation**: never merge file contents on the event loop again (a 30,000-line lock file ran for five minutes and blocked every request, 2.7.0); conflicts come from the patches of both sides, and `sync-cache.json` makes the results permanent, so a wrong rule must be fixed by deleting the file after the fix`.
12. In "Security Considerations", after the `**Only public/ and README.md are served**` bullet, add: `- **sync-cache.json** holds commit hashes and file paths only, no content and no credential; it is git-ignored`.

- [ ] **Step 4: PRD.md**

1. In `#### F6: Conflict Detection`, replace the four requirement lines and the three acceptance criteria with:

```
- F6.1: Decide conflicts with the destination branch from Bitbucket's diffs of both sides since the merge base (git's rule: overlapping or adjacent changes with different content, modify/delete, add/add, binaries); no file content is fetched
- F6.2: Display a badge on each pull request once the statuses are loaded: OK, SYNC, or ? with the reason it could not be checked
- F6.3: Keep the results across restarts (`sync-cache.json`); a result never changes for a pair of commits, so only the pull requests whose commits moved are computed again
- F6.4: Load on demand only (the SYNC load button), never automatically
```

and

```
- PRs with conflicts show a red SYNC badge, PRs without conflicts a green OK badge
- Hovering the SYNC badge lists the conflicting files; hovering a ? badge shows the reason
- A load of the largest project (about 110 pull requests) stays under Bitbucket's hourly request limit and never blocks the server
```

2. In "7.2 Technology Stack / Backend", delete the line `- **Three-way merge:** node-diff3 v3.2.1 (conflict computation)`.
3. In "7.4 Caching Strategy", replace `- Conflicts: 300 seconds` with `- Conflicts: kept for good on disk (`sync-cache.json`), pruned after 90 days`.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: `ℹ tests 93`, `ℹ fail 0` (the server test compares `/api/version` with package.json).

- [ ] **Step 6: Commit**

```bash
git add package.json README.md CLAUDE.md PRD.md
git commit -m "docs: version 2.7.0, conflicts from patches and the persistent SYNC cache (#46)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DKvcYxSmgzzL3huCorE4Ay"
```

---

### Task 7 (controller): verification and pull request

- [ ] `npm test` ends with `ℹ fail 0` and 93 tests; `npm ls --depth=0` lists `express` and `node-cache`.
- [ ] Fixture server on port 3101, in the browser: load the SYNC status of OSLC; the tree shows OK, SYNC and `?` badges; the SYNC tooltip lists files, the `?` tooltip a reason; the SYNC filter offers "Not checked" and each value keeps the right pull requests; no `sync-cache.json` appears in the checkout.
- [ ] Real OSLC load on a second instance with the real `config.js` on port 3102: `/api/sync-statuses/OSLC` answers in well under a minute with OK, SYNC and reasoned `?` entries only, `/api/version` answers during the load; a second load computes nothing (no new `computeConflicts` line in performance.log); a restart followed by a load computes nothing either (`sync-cache.json` reloaded). Never load SECOLLAB.
- [ ] Push and open the pull request to `master`, `Closes #46`.
