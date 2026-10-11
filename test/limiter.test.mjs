import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../limiter.mjs';

// A task that runs until its release is called, recording when it starts
function controlledTasks(count) {
    const started = [];
    const releases = [];
    const tasks = Array.from({ length: count }, (_, i) => () => new Promise((resolve, reject) => {
        started.push(i);
        releases[i] = { resolve: () => resolve(i), reject: error => reject(error) };
    }));
    return { tasks, started, releases };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('no more than the limit run at once, the others start in order as slots free up', async () => {
    const limit = createLimiter(2);
    const { tasks, started, releases } = controlledTasks(4);
    const results = tasks.map(task => limit(task));
    await settle();
    assert.deepEqual(started, [0, 1]);
    releases[1].resolve();
    await settle();
    assert.deepEqual(started, [0, 1, 2]);
    releases[0].resolve();
    releases[2].resolve();
    await settle();
    assert.deepEqual(started, [0, 1, 2, 3]);
    releases[3].resolve();
    assert.deepEqual(await Promise.all(results), [0, 1, 2, 3]);
});

test('a rejection reaches its caller and frees its slot', async () => {
    const limit = createLimiter(1);
    const { tasks, started, releases } = controlledTasks(2);
    const failing = limit(tasks[0]);
    const next = limit(tasks[1]);
    await settle();
    releases[0].reject(new Error('Bitbucket unreachable'));
    await assert.rejects(failing, { message: 'Bitbucket unreachable' });
    await settle();
    assert.deepEqual(started, [0, 1]);
    releases[1].resolve();
    assert.equal(await next, 1);
});
