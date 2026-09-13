/**
 * Every Atlassian request goes through the wrapper created here, so a single
 * HTTP 429 pauses them all: after a 429 from Bitbucket or Jira, no request is
 * sent until backoffSeconds (10 minutes) after the last 429 received, and the
 * callers get a RateLimitError instead. A network failure is rethrown with
 * its cause and the URL in the message. Nothing here reads a clock or talks
 * to the network by itself: fetch, the clock and what to do on a 429 (the
 * server raises the cache TTLs and logs) are injected. The fixture-mode
 * guard stays in index.mjs.
 */

export class RateLimitError extends Error {
    constructor() {
        super('Atlassian rate limit reached (HTTP 429), requests are paused');
        this.name = 'RateLimitError';
    }
}

// What the user is told when a conflict check fails; the logs keep the full message
export function failureReason(error) {
    return error instanceof RateLimitError
        ? 'Atlassian requests are paused after a rate limit'
        : (error.shortMessage || error.message);
}

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch - the underlying fetch
 * @param {() => number} [options.now] - clock, for the tests
 * @param {number} [options.backoffSeconds=600] - how long requests are paused after a 429
 * @param {(url: string, until: number) => void} [options.onRateLimit] - called on each 429 with the URL and the end of the pause (epoch ms)
 * @returns {{ fetch: (url: string, options?: object) => Promise<Response>, rateLimitedUntil: () => number, pause: () => { rateLimited: boolean, rateLimitedUntil: string|null, remainingMs: number } }}
 */
export function createAtlassianFetch({ fetch, now = () => Date.now(), backoffSeconds = 600, onRateLimit = () => {} }) {
    let rateLimitedUntil = 0;

    function isRateLimited() {
        return now() < rateLimitedUntil;
    }

    function noteRateLimit(url) {
        rateLimitedUntil = now() + backoffSeconds * 1000;
        onRateLimit(url, rateLimitedUntil);
    }

    async function atlassianFetch(url, options) {
        if (isRateLimited()) {
            throw new RateLimitError();
        }

        let response;
        try {
            response = await fetch(url, options);
        } catch (error) {
            // The fetch built into Node reports a network failure as "fetch failed" and
            // keeps the reason (DNS, TLS, refused connection) in error.cause; the callers
            // log error.message only, so the reason and the URL go into the message
            // A refused or reset connection on a dual-stack host comes as an AggregateError with an empty message
            const detail = error.cause && (error.cause.message || error.cause.code);
            const reason = detail ? `: ${detail}` : '';
            const failure = new Error(`${error.message}${reason} (${url})`, { cause: error });
            // The same without the URL, for the user: a diff URL carries every path of its chunk
            failure.shortMessage = `${error.message}${reason}`;
            throw failure;
        }
        if (response.status === 429) {
            await response.arrayBuffer().catch(() => {}); // release the socket
            noteRateLimit(url);
            throw new RateLimitError();
        }
        return response;
    }

    return {
        fetch: atlassianFetch,
        /** The end of the last pause in epoch ms, 0 before any 429; possibly past */
        rateLimitedUntil: () => rateLimitedUntil,
        /** The pause as the responses describe it: whether one is on, its end as an ISO date (null otherwise), the time left */
        pause() {
            const remainingMs = Math.max(0, rateLimitedUntil - now());
            return {
                rateLimited: remainingMs > 0,
                rateLimitedUntil: remainingMs > 0 ? new Date(rateLimitedUntil).toISOString() : null,
                remainingMs
            };
        }
    };
}
