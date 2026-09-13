import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { getCachedSyncStatuses, raiseAllCacheTtls, getCacheStats } from '../cache.mjs';

// The cache belongs to the module: every test uses project names of its own

test('two concurrent loads of one project compute once and both get the data', async () => {
    let computations = 0;
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const fetchSyncStatuses = async () => {
        computations++;
        await finished;
        return { data: { statuses: { 'repo/a..b': { conflicts: false } } }, ttl: 60 };
    };
    const first = getCachedSyncStatuses('CONCURRENT', fetchSyncStatuses);
    const second = getCachedSyncStatuses('CONCURRENT', fetchSyncStatuses);
    finish();
    const [firstData, secondData] = await Promise.all([first, second]);
    assert.equal(computations, 1);
    assert.deepEqual(firstData, { statuses: { 'repo/a..b': { conflicts: false } } });
    assert.equal(secondData, firstData);
});

test('a later load returns the cached data without computing', async () => {
    const data = { statuses: {} };
    assert.equal(await getCachedSyncStatuses('CACHED', async () => ({ data, ttl: 60 })), data);
    let computations = 0;
    const again = await getCachedSyncStatuses('CACHED', async () => {
        computations++;
        return { data: { statuses: { other: {} } }, ttl: 60 };
    });
    assert.equal(again, data);
    assert.equal(computations, 0);
});

test('a failed computation is not cached: the loads sharing it fail, the next load computes again', async () => {
    let computations = 0;
    const failing = async () => {
        computations++;
        throw new Error('Bitbucket unreachable');
    };
    const results = await Promise.allSettled([
        getCachedSyncStatuses('FAILING', failing),
        getCachedSyncStatuses('FAILING', failing)
    ]);
    assert.equal(computations, 1);
    assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
    assert.equal(results[0].reason.message, 'Bitbucket unreachable');
    const data = { statuses: {} };
    assert.equal(await getCachedSyncStatuses('FAILING', async () => ({ data, ttl: 60 })), data);
});

test('raiseAllCacheTtls keeps the entries expiring before the delay, and leaves the later and the never-expiring ones as they are', async () => {
    // node-cache reads Date.now() for its expiries: the clock is moved instead of waited for
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
        await getCachedSyncStatuses('SOON', async () => ({ data: 'soon', ttl: 10 }));
        await getCachedSyncStatuses('LATER', async () => ({ data: 'later', ttl: 1000 }));
        await getCachedSyncStatuses('NEVER', async () => ({ data: 'never', ttl: 0 })); // never expires
        raiseAllCacheTtls(600);
        const served = name => getCachedSyncStatuses(name, async () => ({ data: 'computed again', ttl: 1 }));
        mock.timers.tick(500 * 1000);
        assert.equal(await served('SOON'), 'soon'); // expired at 10 s without the raise
        mock.timers.tick(200 * 1000);
        // At 700 s the raised entry is gone; the two others would be too had they been set to 600 s
        assert.equal(await served('SOON'), 'computed again');
        assert.equal(await served('LATER'), 'later');
        assert.equal(await served('NEVER'), 'never');
    } finally {
        mock.timers.reset();
    }
});

test('getCacheStats counts the keys, the hits and the misses', async () => {
    const before = { ...getCacheStats() }; // node-cache hands out its live counters: copied before they move
    await getCachedSyncStatuses('STATS', async () => ({ data: 'first', ttl: 60 })); // a miss, then stored
    await getCachedSyncStatuses('STATS', async () => ({ data: 'second', ttl: 60 })); // a hit
    const after = getCacheStats();
    assert.deepEqual(Object.keys(after).sort(), ['hits', 'keys', 'ksize', 'misses', 'vsize']);
    assert.equal(after.keys, before.keys + 1);
    assert.equal(after.misses, before.misses + 1);
    assert.equal(after.hits, before.hits + 1);
});
