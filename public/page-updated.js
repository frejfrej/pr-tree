/**
 * Whether the server now serves another page than the one this tab runs. A
 * tab keeps the modules it loaded until it is reloaded, while its checks and
 * its SYNC loads read the answers of whatever server runs now: after an
 * upgrade that changed an answer, the old page would render it wrongly and
 * silently (#125). Every /api answer names the page build the server serves
 * (the X-Page-Build header, page-build.mjs): the first one read is this
 * page's; an answer naming another build makes the page stale, for good, and
 * the banner offers a reload.
 *
 * This module keeps the build, sends the page's /api requests (apiFetch, so
 * none escapes the check) and paints the banner button and the main-pane
 * message. What a stale page stops doing (the checks, the SYNC load) belongs
 * to app.js and app-sync.js. Nothing here touches the DOM at import time.
 */

import { pageBuildHeader } from './page-build-header.mjs';

/**
 * The build state after an answer naming `served` (null without the header).
 * The first build named is the page's; another one makes the page stale, and
 * it stays stale: only a reload loads the page served now. An answer without
 * the header (a server from before #125) says nothing.
 * @param {{ loaded: (string|null), stale: boolean }} state
 * @param {string|null} served
 * @returns {{ loaded: (string|null), stale: boolean }}
 */
export function nextPageBuild(state, served) {
    if (state.stale || !served) return state;
    if (!state.loaded) return { loaded: served, stale: false };
    return served === state.loaded ? state : { loaded: state.loaded, stale: true };
}

const freshPageBuild = { loaded: null, stale: false };
let pageBuild = freshPageBuild;

/** Forgets the build, as at page load: for the tests */
export function resetPageBuild() {
    pageBuild = freshPageBuild;
}

/** Whether the server serves another page than this one: its answers are not read */
export function pageIsStale() {
    return pageBuild.stale;
}

// Takes the build an /api answer names and returns whether the page is
// stale; the banner button shows when it just became so
function checkPageBuild(response) {
    const wasStale = pageBuild.stale;
    pageBuild = nextPageBuild(pageBuild, response.headers.get(pageBuildHeader));
    if (pageBuild.stale && !wasStale) showPageUpdatedIndicator();
    return pageBuild.stale;
}

/**
 * Every /api request of the page: the answer, or null when the page is stale
 * (the answer names another build, or an earlier one did and nothing is
 * sent). A null answer is not to be read: the banner already offers the reload.
 * @param {string} url
 * @param {{ fetch?: typeof fetch }} [options]
 * @returns {Promise<Response|null>} rejects as fetch does on a network failure
 */
export async function apiFetch(url, { fetch: send = (...args) => fetch(...args) } = {}) {
    if (pageBuild.stale) return null;
    const response = await send(url);
    return checkPageBuild(response) ? null : response;
}

/** The main-pane message of a project that is not loaded because the page is stale */
export function pageUpdatedStateText(project) {
    return `The dashboard was updated on the server: reload the page to load ${project}.`;
}

export const pageUpdatedTitle = 'The dashboard was updated on the server since this page was loaded, and this page may misread its data: reload the page. The project and the filters are kept; the SYNC statuses need loading again.';

/** Shows the banner button that reloads the page */
export function showPageUpdatedIndicator() {
    const indicator = document.getElementById('pageUpdated');
    if (!indicator) return;
    indicator.hidden = false;
    const button = indicator.querySelector('button');
    if (button) button.title = pageUpdatedTitle;
    // The text is in the markup too (the button's name); written again so the status region announces it
    const text = indicator.querySelector('.page-updated-text');
    if (text) text.textContent = 'Reload: dashboard updated';
}

/** Wires the banner button: a click reloads the page, which keeps the project and the filters of the URL */
export function initializePageUpdatedButton({ reload = () => window.location.reload() } = {}) {
    const button = document.querySelector('#pageUpdated button');
    if (button) button.addEventListener('click', () => reload());
}
