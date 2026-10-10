import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProjectResponse, formatPauseEnd, pausedStateText, pauseIndicatorText, pauseIndicatorTitle } from '../public/atlassian-pause.js';

const response = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

test('a successful response gives its data', async () => {
    assert.deepEqual(await readProjectResponse(response(200, { dataHash: 'abc' })), { data: { dataHash: 'abc' } });
});

test('a 503 with the end of the pause gives that end as epoch ms', async () => {
    const result = await readProjectResponse(response(503, { error: 'paused', rateLimitedUntil: '2026-10-11T10:10:00.000Z' }));
    assert.deepEqual(result, { pausedUntil: Date.parse('2026-10-11T10:10:00.000Z') });
});

test('a 503 without a readable end, or that is not JSON, is an ordinary failure', async () => {
    assert.deepEqual(await readProjectResponse(response(503, { error: 'paused' })), {});
    assert.deepEqual(await readProjectResponse(response(503, { rateLimitedUntil: 'soon' })), {});
    assert.deepEqual(await readProjectResponse(response(503, 'Service Unavailable')), {});
});

test('any other failure gives neither data nor a pause', async () => {
    assert.deepEqual(await readProjectResponse(response(500, 'Internal Server Error')), {});
    assert.deepEqual(await readProjectResponse(response(404, { error: 'Project not found', rateLimitedUntil: '2026-10-11T10:10:00.000Z' })), {});
});

test('the end of the pause is shown as HH:MM, rounded up to the minute', () => {
    assert.equal(formatPauseEnd(new Date(2026, 9, 11, 14, 32, 1).getTime()), '14:33');
    assert.equal(formatPauseEnd(new Date(2026, 9, 11, 14, 32, 59, 999).getTime()), '14:33');
    assert.equal(formatPauseEnd(new Date(2026, 9, 11, 9, 5, 0).getTime()), '09:05');
    assert.equal(formatPauseEnd(new Date(2026, 9, 11, 23, 59, 30).getTime()), '00:00');
});

test('the texts name the end of the pause', () => {
    const until = new Date(2026, 9, 11, 14, 32, 10).getTime();
    assert.equal(pausedStateText('SECOLLAB', until), 'Atlassian requests are paused until 14:33 after a rate limit (HTTP 429). SECOLLAB will load then.');
    assert.equal(pauseIndicatorText(until), 'Paused until 14:33');
    assert.equal(pauseIndicatorTitle(until), 'Atlassian rate limit reached (HTTP 429): requests are paused until 14:33. The page checks again then.');
});
