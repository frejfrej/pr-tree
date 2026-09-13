import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCachedSyncStatuses } from '../cache.mjs';

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
