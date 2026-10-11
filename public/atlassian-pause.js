/**
 * The Atlassian pause as the page shows it. After an HTTP 429 the server sends
 * nothing to Atlassian for 10 minutes: /api/pull-requests/:project answers
 * 503 { error, rateLimitedUntil } when it has to build the data meanwhile, and
 * its cached data with rateLimitedUntil otherwise.
 * This module reads that answer, formats the end of the pause and paints the
 * banner indicator, which follows the server's pause across project switches
 * (pauseEndAfter). When to fetch, and what the main pane shows, belong to
 * app.js; the SYNC warning (app-sync.js) only borrows parsePauseEnd and
 * formatPauseEnd.
 *
 * Nothing here touches the DOM at import time.
 */

/**
 * Reads a /api/pull-requests/:project response: { data } on success, with
 * pausedUntil (epoch ms) when the data was served from the cache during a
 * pause; { pausedUntil } on a 503 carrying the end of the pause; {} on any
 * other failure (a 503 without a readable end has no time to announce).
 * @param {Response} response
 * @returns {Promise<{ data?: object, pausedUntil?: number }>}
 */
export async function readProjectResponse(response) {
    if (response.ok) {
        const data = await response.json();
        const pausedUntil = parsePauseEnd(data.rateLimitedUntil);
        return pausedUntil ? { data, pausedUntil } : { data };
    }
    if (response.status === 503) {
        try {
            const pausedUntil = parsePauseEnd((await response.json()).rateLimitedUntil);
            if (pausedUntil) return { pausedUntil };
        } catch (error) {
            // Not JSON: an ordinary failure
        }
    }
    return {};
}

/**
 * The end of the server's pause after an answer read by readProjectResponse.
 * The pause belongs to the server, not to a project: an answer with an end
 * sets it, data without one says the server is not paused (every 200 answer
 * carries the live rateLimitedUntil), and an ordinary failure says nothing
 * about it, so the end known before is kept.
 * @param {number} current - the end known before the answer (epoch ms, 0 when none)
 * @param {{ data?: object, pausedUntil?: number }} result
 * @returns {number} epoch ms, 0 when none
 */
export function pauseEndAfter(current, { data, pausedUntil }) {
    if (pausedUntil) return pausedUntil;
    return data ? 0 : current;
}

/** The rateLimitedUntil of a server answer (an ISO date, or null) as epoch ms, 0 when it names no end */
export function parsePauseEnd(value) {
    const end = Date.parse(value);
    return Number.isFinite(end) ? end : 0;
}

/**
 * The end of a pause as HH:MM (24-hour, local time), rounded up to the
 * minute: the pause ends on an arbitrary second, and a request at the minute
 * shown must not be refused.
 * @param {number} until - epoch ms
 */
export function formatPauseEnd(until) {
    const date = new Date(Math.ceil(until / 60000) * 60000);
    const pad = number => String(number).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The main-pane message of a project load refused by the pause */
export function pausedStateText(project, until) {
    return `Atlassian requests are paused until ${formatPauseEnd(until)} after a rate limit (HTTP 429). ${project} will load then.`;
}

/** The main-pane message of a project load that failed for another reason during a pause: no check is sent before its end */
export function failedDuringPauseText(project, until) {
    return `Could not load ${project}. The next check is at ${formatPauseEnd(until)}, at the end of the Atlassian pause.`;
}

export function pauseIndicatorText(until) {
    return `Paused until ${formatPauseEnd(until)}`;
}

export function pauseIndicatorTitle(until) {
    return `Atlassian rate limit reached (HTTP 429): requests are paused until ${formatPauseEnd(until)}, for every project. The project shown is checked again then.`;
}

/** Shows the banner indicator for a pause ending at until (epoch ms), or hides it with 0 */
export function showPauseIndicator(until) {
    const indicator = document.getElementById('atlassianPause');
    if (!indicator) return;
    indicator.hidden = !until;
    indicator.title = until ? pauseIndicatorTitle(until) : '';
    const text = indicator.querySelector('.atlassian-pause-text');
    if (text) text.textContent = until ? pauseIndicatorText(until) : '';
}
