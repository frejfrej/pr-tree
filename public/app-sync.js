/**
 * SYNC status of the pull requests: whether a pull request conflicts with its
 * destination branch. The statuses are fetched on demand with the button next
 * to the SYNC filter, never automatically (the server computes them, which is
 * expensive); they are painted onto the conflicts counters of the rendered
 * tree and kept, so an automatic re-render repaints them without a new fetch.
 * The SYNC filter (app-filter.js) reads the loaded statuses, which app.js
 * passes to the filter pass (loadedSyncStatuses).
 *
 * The module owns the loaded statuses and the SYNC controls. The selected
 * project and the selected SYNC filter belong to app.js and are read through
 * the accessors given to initializeSyncControls.
 *
 * Nothing here touches the DOM at import time.
 */

import { formatPauseEnd, parsePauseEnd } from './atlassian-pause.js';
import { apiFetch, pageIsStale } from './page-updated.js';

// The last /api/sync-statuses response: null until the user loads it, and again after a project switch
let currentSyncStatuses = null;
let syncStatusLoading = false;
let syncLoadFailed = false;
// Counts the project switches: a load in flight compares it after its fetch
let syncLoadGeneration = 0;

// Given to initializeSyncControls
let getProject = () => null;
let getSyncFilter = () => 'Show all';
let onLoadEnd = () => {};

/**
 * Wires the SYNC select and the load button, and shows the initial state.
 * @param {object} options
 * @param {() => (string|null)} options.getProject - the selected project; the load button is enabled while there is one
 * @param {() => string} options.getSyncFilter - the selected SYNC filter, put back on the select when its options are rebuilt
 * @param {() => void} options.onFilterChange - called when the SYNC select changes
 * @param {() => void} options.onLoadEnd - called once a load ends, successful or not, so the filters use the new statuses
 */
export function initializeSyncControls(options) {
    ({ getProject, getSyncFilter, onLoadEnd } = options);
    const syncSelect = document.getElementById('syncSelect');
    if (syncSelect) {
        syncSelect.addEventListener('change', options.onFilterChange);
    }
    const loadSyncButton = document.getElementById('loadSyncButton');
    if (loadSyncButton) {
        loadSyncButton.addEventListener('click', loadSyncStatuses);
    }
    updateSyncControls();
}

/** Whether statuses are loaded; the SYNC filter is only meaningful then */
export function syncStatusesLoaded() {
    return Boolean(currentSyncStatuses);
}

/** The statuses of the last load, by "repo/destHash..sourceHash"; null while none is loaded */
export function loadedSyncStatuses() {
    return currentSyncStatuses ? currentSyncStatuses.statuses : null;
}

/** The end of the Atlassian pause the loaded statuses report (epoch ms), 0 when none */
export function syncPauseEnd() {
    return currentSyncStatuses && currentSyncStatuses.rateLimited ? parsePauseEnd(currentSyncStatuses.rateLimitedUntil) : 0;
}

/**
 * Forgets the loaded statuses, a failed load and a load in flight: they belong
 * to the project being left (the response of the load in flight is dropped
 * when it arrives, and a load can start for the new project right away). The
 * caller refreshes the controls once the project changed.
 */
export function resetSyncStatuses() {
    currentSyncStatuses = null;
    syncLoadFailed = false;
    syncStatusLoading = false;
    syncLoadGeneration += 1;
}

/**
 * Fetches the SYNC status of every pull request of the current project in a
 * single server call. Only triggered by the load button, never automatically.
 * After a project switch during the load the response is dropped, and so is
 * the failure: the statuses belong to the project left, and the controls
 * already show the new project's state (resetSyncStatuses).
 */
async function loadSyncStatuses() {
    const project = getProject();
    if (!project || syncStatusLoading) {
        return;
    }

    const generation = syncLoadGeneration;
    syncStatusLoading = true;
    updateSyncControls();
    document.querySelectorAll('.conflicts-counter').forEach(counter => {
        if (!counter.dataset.syncKey.includes('undefined')) {
            counter.innerHTML = '<div class="conflicts-spinner"></div>';
        }
    });

    const { statuses, stale } = await fetchSyncStatuses(project);
    if (generation !== syncLoadGeneration) {
        return;
    }
    syncStatusLoading = false;
    // A failed refresh keeps the previously loaded statuses, and so does an
    // answer of a server serving another page: the banner offers the reload
    if (statuses) currentSyncStatuses = statuses;
    syncLoadFailed = !statuses && !stale;

    updateSyncControls();
    applySyncStatuses();
    // The caller re-applies its filters, so an already selected SYNC filter uses the new statuses
    onLoadEnd();
}

// The answer of /api/sync-statuses/:project: { statuses }, { stale } from a
// server serving another page than this one (#125; nothing is fetched once
// the page is stale), {} on a failure
async function fetchSyncStatuses(project) {
    try {
        const response = await apiFetch(`/api/sync-statuses/${encodeURIComponent(project)}`);
        if (!response) return { stale: true };
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return { statuses: await response.json() };
    } catch (error) {
        console.error('Error fetching sync statuses:', error);
        return {};
    }
}

// One badge of the conflicts counter, built as DOM so file names and reasons need no escaping
function badge(className, title, text) {
    const element = document.createElement('div');
    element.className = className;
    element.title = title;
    element.textContent = text;
    return element;
}

// Tooltip of a SYNC conflict badge: the files, one per line, capped at five; a
// partial result (the other files could not be checked) ends with the reason
export function conflictsTitle(files, reason) {
    const listed = Array.isArray(files) && files.length > 0;
    const lines = listed ? ['Conflicts in:', ...files.slice(0, 5)] : ['Conflicts found'];
    if (listed && files.length > 5) lines.push(`and ${files.length - 5} more`);
    if (reason) lines.push(`Other files not checked: ${reason}`);
    return lines.join('\n');
}

/** Renders the stored SYNC statuses onto the conflicts counters: OK, SYNC, or ? with the reason */
export function applySyncStatuses() {
    document.querySelectorAll('.conflicts-counter').forEach(counter => {
        const { syncKey } = counter.dataset;
        if (syncKey.includes('undefined')) {
            counter.replaceChildren(badge('conflicts-error', `Invalid spec provided ${syncKey}`, '!'));
            return;
        }
        if (!currentSyncStatuses) {
            counter.replaceChildren();
            return;
        }

        const status = currentSyncStatuses.statuses[syncKey];
        if (!status) {
            counter.replaceChildren(badge('conflicts-error', 'SYNC status unknown - use the SYNC load button to refresh', '?'));
        } else if (status.error) {
            counter.replaceChildren(badge('conflicts-error', `Could not check: ${status.reason || 'unknown error'}`, '?'));
        } else if (status.conflicts) {
            counter.replaceChildren(badge('conflicts-count', conflictsTitle(status.files, status.reason), 'SYNC'));
        } else {
            counter.replaceChildren(badge('conflicts-ok', 'No conflict with the destination branch', 'OK'));
        }
    });
}

/** Shows the load state on the SYNC select, the load button and the warning icon */
export function updateSyncControls() {
    const syncSelect = document.getElementById('syncSelect');
    const loadSyncButton = document.getElementById('loadSyncButton');
    const syncWarning = document.getElementById('syncWarning');
    if (!syncSelect || !loadSyncButton) return;

    const buttonIcon = loadSyncButton.querySelector('i');
    if (syncStatusLoading) {
        loadSyncButton.disabled = true;
        if (buttonIcon) buttonIcon.classList.add('fa-spin');
        syncSelect.disabled = true;
        syncSelect.innerHTML = '<option value="Show all">Loading SYNC status...</option>';
    } else {
        // A stale page reads no SYNC answer (#125)
        loadSyncButton.disabled = !getProject() || pageIsStale();
        if (buttonIcon) buttonIcon.classList.remove('fa-spin');
        if (currentSyncStatuses) {
            syncSelect.disabled = false;
            syncSelect.innerHTML = `
                <option value="Show all">Show all</option>
                <option value="requested">SYNC required</option>
                <option value="OK">SYNC ok</option>
                <option value="unchecked">Not checked</option>
            `;
            syncSelect.value = getSyncFilter();
        } else {
            syncSelect.disabled = true;
            syncSelect.innerHTML = '<option value="Show all">SYNC status not loaded</option>';
        }
    }

    if (syncWarning) {
        let warningText = '';
        if (!syncStatusLoading && syncLoadFailed) {
            warningText = currentSyncStatuses
                ? 'Failed to refresh SYNC status - showing previously loaded results'
                : 'Failed to load SYNC status - use the load button to try again';
        } else if (!syncStatusLoading && currentSyncStatuses && currentSyncStatuses.rateLimited) {
            const end = parsePauseEnd(currentSyncStatuses.rateLimitedUntil);
            const until = end ? formatPauseEnd(end) : '';
            warningText = `Atlassian rate limit reached - SYNC status may be incomplete${until ? `, requests are paused until ${until}` : ''}`;
        } else if (!syncStatusLoading && currentSyncStatuses && currentSyncStatuses.stopped) {
            // The server stopped the load after repeated Bitbucket failures; `stopped` is its reason
            warningText = `${currentSyncStatuses.stopped} - use the load button to try again`;
        }
        syncWarning.hidden = !warningText;
        syncWarning.title = warningText;
    }
}
