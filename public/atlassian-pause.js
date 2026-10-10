/**
 * The Atlassian pause as the page shows it. After an HTTP 429 the server sends
 * nothing to Atlassian for 10 minutes, and /api/pull-requests/:project answers
 * 503 { error, rateLimitedUntil } when it has to build the data meanwhile.
 * This module reads that answer, formats the end of the pause and paints the
 * banner indicator. When to fetch, and what the main pane shows, belong to
 * app.js; the SYNC warning (app-sync.js) only borrows formatPauseEnd.
 *
 * Nothing here touches the DOM at import time.
 */

/**
 * Reads a /api/pull-requests/:project response: { data } on success,
 * { pausedUntil } (epoch ms) on a 503 carrying the end of the pause, {} on
 * any other failure (a 503 without a readable end has no time to announce).
 * @param {Response} response
 * @returns {Promise<{ data?: object, pausedUntil?: number }>}
 */
export async function readProjectResponse(response) {
    if (response.ok) return { data: await response.json() };
    if (response.status === 503) {
        try {
            const pausedUntil = Date.parse((await response.json()).rateLimitedUntil);
            if (Number.isFinite(pausedUntil)) return { pausedUntil };
        } catch (error) {
            // Not JSON: an ordinary failure
        }
    }
    return {};
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

export function pauseIndicatorText(until) {
    return `Paused until ${formatPauseEnd(until)}`;
}

export function pauseIndicatorTitle(until) {
    return `Atlassian rate limit reached (HTTP 429): requests are paused until ${formatPauseEnd(until)}. The page checks again then.`;
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
