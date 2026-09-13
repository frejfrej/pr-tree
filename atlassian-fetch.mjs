/**
 * What every Atlassian request shares: the error thrown while requests are
 * paused after an HTTP 429, and what the user is told when a request failed.
 * The wrapper itself (atlassianFetch, the fixture-mode guard and the pause)
 * still lives in index.mjs.
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
