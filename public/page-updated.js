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
 * This module keeps the build and paints the banner button and the main-pane
 * message. Not reading a stale answer, and stopping the checks, belong to
 * app.js and app-sync.js. Nothing here touches the DOM at import time.
 */

/** The header of the /api answers that carries the page build (page-build.mjs) */
export const pageBuildHeader = 'X-Page-Build';

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

let pageBuild = { loaded: null, stale: false };

/** Whether the server serves another page than this one: its answers are not read */
export function pageIsStale() {
    return pageBuild.stale;
}

/**
 * Takes the build an /api answer names and returns whether the page is stale;
 * the banner button shows when it just became so.
 * @param {Response} response
 */
export function checkPageBuild(response) {
    const wasStale = pageBuild.stale;
    pageBuild = nextPageBuild(pageBuild, response.headers.get(pageBuildHeader));
    if (pageBuild.stale && !wasStale) showPageUpdatedIndicator();
    return pageBuild.stale;
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
