import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAtlassianFetch, RateLimitError, failureReason } from '../atlassian-fetch.mjs';

/**
 * The wrapper every Atlassian request goes through: the pause after an HTTP
 * 429, the network failure messages, and the fields the routes answer with
 * during a pause. The underlying fetch is a fake answering by URL, the clock
 * is a variable.
 */

const bitbucketUrl = 'https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests';
const jiraUrl = 'https://site.atlassian.net/rest/api/3/search/jql?jql=x';
const tenMinutes = 600 * 1000;

function setUp({ answer = () => new Response('{}', { status: 200 }), start = Date.parse('2026-09-13T10:00:00Z') } = {}) {
    const calls = [];
    const rateLimits = [];
    let clock = start;
    const atlassian = createAtlassianFetch({
        fetch: async (url, options) => {
            calls.push({ url, options });
            return answer(url, options);
        },
        now: () => clock,
        onRateLimit: (url, until) => rateLimits.push({ url, until })
    });
    return { atlassian, calls, rateLimits, advance: ms => { clock += ms; }, get clock() { return clock; } };
}

test('a response that is not a 429 is returned as it is, with the options passed through', async () => {
    const ok = new Response('{"values":[]}', { status: 200 });
    const failed = new Response('', { status: 502 });
    const { atlassian, calls } = setUp({ answer: url => (url === jiraUrl ? failed : ok) });
    const options = { method: 'GET', headers: { Accept: 'application/json' } };
    assert.equal(await atlassian.fetch(bitbucketUrl, options), ok);
    assert.equal(await atlassian.fetch(jiraUrl, options), failed); // the callers read response.ok themselves
    assert.deepEqual(calls.map(call => call.options), [options, options]);
    assert.deepEqual(atlassian.pause(), { rateLimited: false, rateLimitedUntil: null, remainingMs: 0 });
    assert.equal(atlassian.rateLimitedUntil(), 0);
});

test('after a 429 from either API, every request throws RateLimitError until 10 minutes after the last 429', async () => {
    let limited = false;
    const { atlassian, calls, rateLimits, advance, clock: start } = setUp({ answer: () => new Response('slow down', { status: limited ? 429 : 200 }) });
    const throwsPaused = url => assert.rejects(atlassian.fetch(url), error => error instanceof RateLimitError && error.name === 'RateLimitError');

    // A 429 from Jira: its body is drained (the socket is released) and the pause is reported once
    limited = true;
    await throwsPaused(jiraUrl);
    assert.equal(calls.length, 1);
    assert.deepEqual(rateLimits, [{ url: jiraUrl, until: start + tenMinutes }]);
    assert.equal(atlassian.rateLimitedUntil(), start + tenMinutes);

    // Every request, to either API, is refused without reaching fetch
    limited = false;
    await throwsPaused(bitbucketUrl);
    await throwsPaused(jiraUrl);
    assert.equal(calls.length, 1);
    assert.deepEqual(rateLimits.length, 1);

    // Still paused after nine minutes; a 429 then extends the pause from that moment
    advance(9 * 60 * 1000);
    await throwsPaused(bitbucketUrl);
    assert.equal(calls.length, 1);
    advance(60 * 1000); // the first pause is over
    limited = true;
    await throwsPaused(bitbucketUrl);
    assert.equal(calls.length, 2);
    assert.deepEqual(rateLimits.at(-1), { url: bitbucketUrl, until: start + tenMinutes + tenMinutes });
    limited = false;
    advance(tenMinutes - 1);
    await throwsPaused(jiraUrl);
    assert.equal(calls.length, 2);

    // Ten minutes after the last 429, requests go through again
    advance(1);
    assert.equal((await atlassian.fetch(jiraUrl)).status, 200);
    assert.equal(calls.length, 3);
});

test('the 429 body is read so that the socket is released', async () => {
    const response = new Response('slow down', { status: 429 });
    const { atlassian } = setUp({ answer: () => response });
    await assert.rejects(atlassian.fetch(bitbucketUrl), RateLimitError);
    assert.equal(response.bodyUsed, true);
});

test('a network failure carries its cause and the URL in message, and neither the URL in shortMessage', async () => {
    const dns = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.bitbucket.org') });
    const { atlassian } = setUp({ answer: () => { throw dns; } });
    await assert.rejects(atlassian.fetch(bitbucketUrl), error => {
        assert.equal(error.message, `fetch failed: getaddrinfo ENOTFOUND api.bitbucket.org (${bitbucketUrl})`);
        assert.equal(error.shortMessage, 'fetch failed: getaddrinfo ENOTFOUND api.bitbucket.org');
        assert.equal(error.cause, dns);
        return true;
    });

    // A refused connection on a dual-stack host: an AggregateError with an empty message but a code
    const refused = new AggregateError([new Error('connect ECONNREFUSED ::1:443')], '');
    refused.code = 'ECONNREFUSED';
    const dualStack = setUp({ answer: () => { throw new TypeError('fetch failed', { cause: refused }); } });
    await assert.rejects(dualStack.atlassian.fetch(jiraUrl), error => {
        assert.equal(error.message, `fetch failed: ECONNREFUSED (${jiraUrl})`);
        assert.equal(error.shortMessage, 'fetch failed: ECONNREFUSED');
        return true;
    });

    // A failure without a cause (an aborted request): the message and the URL
    const aborted = setUp({ answer: () => { throw new Error('The operation was aborted'); } });
    await assert.rejects(aborted.atlassian.fetch(jiraUrl), error => {
        assert.equal(error.message, `The operation was aborted (${jiraUrl})`);
        assert.equal(error.shortMessage, 'The operation was aborted');
        return true;
    });
    // A network failure does not start a pause
    assert.deepEqual(aborted.atlassian.pause().rateLimited, false);
});

test('failureReason gives the fixed sentence for a RateLimitError, the short message otherwise', () => {
    assert.equal(failureReason(new RateLimitError()), 'Atlassian requests are paused after a rate limit');
    const short = new Error('fetch failed: ECONNRESET (https://api.bitbucket.org/2.0/x)');
    short.shortMessage = 'fetch failed: ECONNRESET';
    assert.equal(failureReason(short), 'fetch failed: ECONNRESET');
    assert.equal(failureReason(new Error('Request failed with status code 502')), 'Request failed with status code 502');
});

test('during a pause, the routes answer 503 with the end of the pause, and the sync statuses carry it with their TTL', async () => {
    const { atlassian, advance, clock: start } = setUp({ answer: () => new Response('', { status: 429 }) });
    let thrown;
    try {
        await atlassian.fetch(bitbucketUrl);
    } catch (error) {
        thrown = error;
    }
    // What /api/pull-requests/:project answers with status 503
    const body = { error: thrown.message, rateLimitedUntil: new Date(atlassian.rateLimitedUntil()).toISOString() };
    assert.deepEqual(body, { error: 'Atlassian rate limit reached (HTTP 429), requests are paused', rateLimitedUntil: '2026-09-13T10:10:00.000Z' });
    // What /api/sync-statuses/:project puts in its response, and the TTL that keeps it until the pause ends
    advance(4 * 60 * 1000 + 500);
    const pause = atlassian.pause();
    assert.deepEqual(pause, { rateLimited: true, rateLimitedUntil: '2026-09-13T10:10:00.000Z', remainingMs: tenMinutes - 4 * 60 * 1000 - 500 });
    assert.equal(Math.max(1, Math.ceil(pause.remainingMs / 1000)), 360);
    assert.equal(atlassian.rateLimitedUntil(), start + tenMinutes);
    // Once over, the pause is gone from the response but its end is still known
    advance(6 * 60 * 1000);
    assert.deepEqual(atlassian.pause(), { rateLimited: false, rateLimitedUntil: null, remainingMs: 0 });
    assert.equal(atlassian.rateLimitedUntil(), start + tenMinutes);
});
