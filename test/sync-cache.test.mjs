import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openSyncCache, syncCacheVersion } from '../sync-cache.mjs';

const tempDirectories = [];

after(() => {
    for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true });
});

function tempDir() {
    const directory = mkdtempSync(path.join(tmpdir(), 'sync-cache-'));
    tempDirectories.push(directory);
    return directory;
}

function tempFile() {
    return path.join(tempDir(), 'sync-cache.json');
}

const ruleVersion = 2;
const open = (file, options = {}) => openSyncCache(file, { ruleVersion, ...options });

test('the rule version of the keys is required', () => {
    assert.throws(() => openSyncCache(tempFile()), TypeError);
    assert.throws(() => openSyncCache(tempFile(), { ruleVersion: '2' }), TypeError);
});

test('a missing file opens an empty cache without an error', () => {
    const errors = [];
    const cache = open(tempFile(), { onError: error => errors.push(error) });
    assert.equal(cache.size, 0);
    assert.equal(cache.get('repo/a..b'), null);
    assert.deepEqual(errors, []);
});

test('results round trip through the file without their timestamp, and reload', async () => {
    const file = tempFile();
    const cache = open(file, { now: () => Date.parse('2026-09-12T10:00:00Z') });
    cache.set('repo/a..b', { conflicts: true, files: ['x'] });
    cache.set('repo/c..d', { conflicts: false });
    assert.deepEqual(cache.get('repo/a..b'), { conflicts: true, files: ['x'] });
    assert.equal(await cache.save(), true);
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(stored.version, syncCacheVersion);
    assert.deepEqual(Object.keys(stored.entries), ['2:repo/a..b', '2:repo/c..d']); // the rule version in front of every key
    assert.equal(stored.entries['2:repo/a..b'].computedAt, '2026-09-12T10:00:00.000Z');
    const reopened = open(file);
    assert.equal(reopened.size, 2);
    assert.deepEqual(reopened.get('repo/c..d'), { conflicts: false });
    assert.equal(await reopened.save(), false); // nothing new: no write
    assert.deepEqual(readdirSync(path.dirname(file)), ['sync-cache.json']); // no temporary file left behind
});

test('entries older than the maximum age are dropped when the file is written', async () => {
    const file = tempFile();
    let clock = Date.parse('2026-01-01T00:00:00Z');
    const cache = open(file, { now: () => clock, maxAgeDays: 90 });
    cache.set('repo/old..old', { conflicts: false });
    clock = Date.parse('2026-06-01T00:00:00Z');
    cache.set('repo/new..new', { conflicts: false });
    await cache.save();
    const reopened = open(file);
    assert.equal(reopened.get('repo/old..old'), null);
    assert.deepEqual(reopened.get('repo/new..new'), { conflicts: false });
});

test('the entries of another rule version, older or newer, are not visible and go when the file is written', async () => {
    const file = tempFile();
    const computedAt = new Date().toISOString();
    writeFileSync(file, JSON.stringify({
        version: syncCacheVersion,
        entries: {
            '1:repo/a..b': { conflicts: false, computedAt },
            '3:repo/a..b': { conflicts: false, computedAt },
            '2:repo/c..d': { conflicts: true, files: ['y'], computedAt }
        }
    }));
    const cache = open(file);
    assert.equal(cache.size, 1); // the current version only
    assert.equal(cache.get('repo/a..b'), null);
    assert.deepEqual(cache.get('repo/c..d'), { conflicts: true, files: ['y'] });
    cache.set('repo/a..b', { conflicts: true, files: ['x'] });
    assert.equal(await cache.save(), true);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).entries).sort(), ['2:repo/a..b', '2:repo/c..d']);
    assert.deepEqual(open(file).get('repo/a..b'), { conflicts: true, files: ['x'] });
});

test('a corrupt file or another version opens empty and is reported', () => {
    const file = tempFile();
    const errors = [];
    writeFileSync(file, '{not json');
    assert.equal(open(file, { onError: error => errors.push(error) }).size, 0);
    writeFileSync(file, JSON.stringify({ version: 999, entries: { 'repo/a..b': { conflicts: false } } }));
    assert.equal(open(file, { onError: error => errors.push(error) }).size, 0);
    assert.equal(errors.length, 2);
});

test('a stored entry that is not an object is dropped, and the file heals at the next save', async () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({
        version: syncCacheVersion,
        entries: {
            '2:repo/n..n': null,
            '2:repo/o..o': { conflicts: false, computedAt: new Date().toISOString() }
        }
    }));
    const cache = open(file);
    assert.equal(cache.size, 1);
    assert.deepEqual(cache.get('repo/o..o'), { conflicts: false });
    cache.set('repo/p..p', { conflicts: false });
    assert.equal(await cache.save(), true);
    const reopened = open(file);
    assert.equal(reopened.size, 2);
    assert.equal(reopened.get('repo/n..n'), null);
});

test('two saves in a row write once each, in order', async () => {
    const file = tempFile();
    const cache = open(file);
    cache.set('repo/a..b', { conflicts: false });
    const first = cache.save();
    cache.set('repo/c..d', { conflicts: false });
    const second = cache.save();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(open(file).size, 2);
});

test('an entry set while a write is in flight is written by the next save', async () => {
    const file = tempFile();
    const cache = open(file);
    cache.set('repo/a..b', { conflicts: false });
    const first = cache.save();
    await new Promise(resolve => setImmediate(resolve)); // the first write has started
    cache.set('repo/c..d', { conflicts: false });
    assert.equal(await first, true);
    assert.equal(await cache.save(), true);
    assert.equal(open(file).size, 2);
});

test('a failed write leaves the entries to the next save', async () => {
    const file = path.join(tempDir(), 'missing', 'sync-cache.json');
    const cache = open(file);
    cache.set('repo/a..b', { conflicts: false });
    await assert.rejects(cache.save()); // the directory does not exist
    mkdirSync(path.dirname(file));
    assert.equal(await cache.save(), true);
    assert.equal(open(file).size, 1);
});

// A file system recording the calls of a save; failing: { 'sync:<path>': error, ... }
function fakeFileSystem(failing = {}) {
    const calls = [];
    const written = [];
    const fail = name => { if (failing[name]) throw failing[name]; };
    const fileSystem = {
        calls,
        written,
        async open(filePath, flags) {
            calls.push(`open ${path.basename(filePath)} ${flags}`);
            fail(`open:${path.basename(filePath)}`);
            const name = path.basename(filePath);
            return {
                async writeFile(content) { calls.push(`write ${name}`); written.push(content); fail(`write:${name}`); },
                async sync() { calls.push(`sync ${name}`); fail(`sync:${name}`); },
                async close() { calls.push(`close ${name}`); fail(`close:${name}`); }
            };
        },
        async rename(from, to) { calls.push(`rename ${path.basename(from)} ${path.basename(to)}`); fail('rename'); },
        async unlink(filePath) { calls.push(`unlink ${path.basename(filePath)}`); }
    };
    return fileSystem;
}

test('a save syncs the temporary file before the rename, then the directory', async () => {
    const directory = path.join(tempDir(), 'cache');
    const fileSystem = fakeFileSystem();
    const cache = open(path.join(directory, 'sync-cache.json'), { fileSystem });
    cache.set('repo/a..b', { conflicts: false });
    assert.equal(await cache.save(), true);
    const temporary = `sync-cache.json.${process.pid}.tmp`;
    assert.deepEqual(fileSystem.calls, [
        `open ${temporary} w`, `write ${temporary}`, `sync ${temporary}`, `close ${temporary}`,
        `rename ${temporary} sync-cache.json`,
        'open cache r', 'sync cache', 'close cache'
    ]);
    assert.deepEqual(Object.keys(JSON.parse(fileSystem.written[0]).entries), ['2:repo/a..b']);
});

test('a directory that cannot be opened or synced does not fail the save', async () => {
    for (const failing of [{ 'open:cache': new Error('EISDIR') }, { 'sync:cache': new Error('EINVAL') }]) {
        const fileSystem = fakeFileSystem(failing);
        const cache = open(path.join(tempDir(), 'cache', 'sync-cache.json'), { fileSystem });
        cache.set('repo/a..b', { conflicts: false });
        assert.equal(await cache.save(), true);
        assert.equal(await cache.save(), false); // written: nothing pending
        assert.ok(!fileSystem.calls.includes(`unlink sync-cache.json.${process.pid}.tmp`));
    }
});

test('a failed write, sync or rename closes the handle and removes the temporary file', async () => {
    const temporary = `sync-cache.json.${process.pid}.tmp`;
    for (const step of ['write', 'sync', 'rename']) {
        const failure = new Error(`${step} failed`);
        // a close failing after a failed write or sync does not hide the first error
        const fileSystem = fakeFileSystem({ [step === 'rename' ? 'rename' : `${step}:${temporary}`]: failure, ...(step !== 'rename' && { [`close:${temporary}`]: new Error('close failed') }) });
        const cache = open(path.join(tempDir(), 'cache', 'sync-cache.json'), { fileSystem });
        cache.set('repo/a..b', { conflicts: false });
        await assert.rejects(cache.save(), failure);
        assert.ok(fileSystem.calls.includes(`close ${temporary}`), `${step}: the handle is closed`);
        assert.equal(fileSystem.calls.at(-1), `unlink ${temporary}`, `${step}: the temporary file is removed`);
        assert.ok(!fileSystem.calls.includes('open cache r'), `${step}: no directory sync`);
    }
});

test('a rename that fails on the real file system leaves no temporary file', async () => {
    const directory = tempDir();
    const file = path.join(directory, 'sync-cache.json');
    mkdirSync(file); // a non-empty directory where the file goes: the rename fails
    writeFileSync(path.join(file, 'inside'), '');
    const cache = open(file);
    cache.set('repo/a..b', { conflicts: false });
    await assert.rejects(cache.save());
    assert.deepEqual(readdirSync(directory), ['sync-cache.json']);
    rmSync(file, { recursive: true });
    assert.equal(await cache.save(), true); // the entries were kept for the next save
    assert.equal(open(file).size, 1);
});

test('a close that fails after the sync fails the save, and removes the temporary file', async () => {
    const temporary = `sync-cache.json.${process.pid}.tmp`;
    const failure = new Error('close failed');
    const fileSystem = fakeFileSystem({ [`close:${temporary}`]: failure });
    const cache = open(path.join(tempDir(), 'cache', 'sync-cache.json'), { fileSystem });
    cache.set('repo/a..b', { conflicts: false });
    await assert.rejects(cache.save(), failure);
    assert.deepEqual(fileSystem.calls.slice(-2), [`close ${temporary}`, `unlink ${temporary}`]); // closed once, no rename
});

test('the temporary files of stopped processes are removed at open, those of running ones kept', () => {
    const directory = tempDir();
    const file = path.join(directory, 'sync-cache.json');
    const stopped = 'sync-cache.json.2147483646.tmp'; // no such process
    const running = `sync-cache.json.${process.pid}.tmp`;
    const others = ['sync-cache.json.abc.tmp', 'other.json.2147483646.tmp', 'sync-cache.json.2147483646.tmp.bak'];
    for (const name of [stopped, running, ...others]) writeFileSync(path.join(directory, name), '');
    open(file);
    assert.deepEqual(readdirSync(directory).sort(), [running, ...others].sort());
});
