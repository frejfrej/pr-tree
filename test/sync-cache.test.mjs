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
