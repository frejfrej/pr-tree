import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
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

test('an entry set while a write is in flight is written by the next save', async () => {
    const file = tempFile();
    const cache = openSyncCache(file);
    cache.set('repo/a..b', { conflicts: false });
    const first = cache.save();
    await new Promise(resolve => setImmediate(resolve)); // the first write has started
    cache.set('repo/c..d', { conflicts: false });
    assert.equal(await first, true);
    assert.equal(await cache.save(), true);
    assert.equal(openSyncCache(file).size, 2);
});

test('a failed write leaves the entries to the next save', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'sync-cache-')), 'missing', 'sync-cache.json');
    const cache = openSyncCache(file);
    cache.set('repo/a..b', { conflicts: false });
    await assert.rejects(cache.save()); // the directory does not exist
    mkdirSync(path.dirname(file));
    assert.equal(await cache.save(), true);
    assert.equal(openSyncCache(file).size, 1);
});
