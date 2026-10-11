import { initializeFilter, filterBranches, countActiveFilters } from './app-filter.js';
import { renderRepositories, renderOrphanedIssues, initializePopovers } from './app-render.js';
import { initializeSyncControls, resetSyncStatuses, syncStatusesLoaded, loadedSyncStatuses, syncPauseEnd, applySyncStatuses, updateSyncControls } from './app-sync.js';
import { createMultiSelect, getMultiSelect } from './multi-select.js';
import { handleTreeClick, captureToggleStates, restoreToggleStates } from './tree-toggle.js';
import { initializeAppShell, updateDocumentTitle, closeSidebarDrawer, updateActiveFilterBadge, setToolbarVisible, showPartialDataIndicator } from './app-shell.js';
import { filtersFromUrl, projectFromUrl, urlWithFilters, filtersKeptOverGaps } from './app-url.js';
import { multiSelectFilters, defaultFilters } from './filter-registry.js';
import { readProjectResponse, pauseEndAfter, pausedStateText, failedDuringPauseText, showPauseIndicator } from './atlassian-pause.js';

// The projects the dropdown offers, from /api/projects
let availableProjects = [];
let currentProject = null;
// The filters, in the shape of defaultFilters(): what the controls show, what
// the URL carries and what the filter pass applies
let filters = defaultFilters();
let currentApiResult = null;
let reloadInterval = null;
// The end of the server's Atlassian pause (epoch ms), 0 when none is known
// ahead: it belongs to the server, not to a project, so it is kept across
// project switches (see pauseEndAfter)
let pausedUntil = 0;
// Just after the end of the pause, independent of the periodic checks: hides
// the indicator and, while the checks run, checks at once
let pauseEndTimer = null;
// Counts the project switches: a load or a check compares it after its fetch,
// so the answer of a fetch started before a later switch is dropped, even when
// the switch came back to the same project (Back then Forward)
let loadGeneration = 0;
// While a project load is in flight no check is sent: it would build the same
// data again and could paint over the loading message
let projectLoading = false;
// Whether the first render of the current project lets a focused search box win over the URL
// (see restoreFiltersFromUrl); kept for a check that renders it when the load got no data
let loadPrefersTypedText = true;

// Runs the filter pass and refreshes everything that depends on it: the
// counters (inside filterBranches), the active-filter badge, the clear button
// and the attention count in the tab title.
function applyFilters() {
    const attentionCount = filterBranches(filters, loadedSyncStatuses());
    updateActiveFilterBadge(countActiveFilters(filters));
    updateDocumentTitle({ project: currentProject, attentionCount });
}

// Puts every filter control back to its default without applying anything:
// the search box, the multi-selects, the Work select ("All work"; its disabled
// state follows the participants in readFilterControls), the Hide drafts box
// and the SYNC select
function resetFilterControls() {
    const textFilter = document.getElementById('textFilter');
    if (textFilter) textFilter.value = '';
    for (const { elementId } of multiSelectFilters) {
        const multiSelect = getMultiSelect(elementId);
        if (multiSelect) multiSelect.clearAll(false);
    }
    const workSelect = document.getElementById('workSelect');
    if (workSelect) workSelect.value = 'all';
    const hideDraftsCheckbox = document.getElementById('hideDraftsCheckbox');
    if (hideDraftsCheckbox) hideDraftsCheckbox.checked = false;
    const syncSelect = document.getElementById('syncSelect');
    if (syncSelect) syncSelect.value = 'Show all';
}

// Empties the option lists of the multi-selects, and their selections
// (setOptions keeps them), as before the first load
function clearFilterOptions() {
    for (const { elementId } of multiSelectFilters) {
        const multiSelect = getMultiSelect(elementId);
        if (!multiSelect) continue;
        multiSelect.setOptions([]);
        multiSelect.clearAll(false);
    }
}

// Resets every filter and applies the result once.
// The project and the loaded SYNC statuses are kept.
function clearAllFilters() {
    resetFilterControls();
    handleFilterChange();
}

// Writes the project and the filters (the state unless others are given) to
// the URL. `replace` swaps the current history entry instead of pushing one:
// while typing in the search box, and when the address bar catches up after a load.
function updateUrlWithFilters({ replace = false, filters: written = filters } = {}) {
    const url = urlWithFilters(new URL(window.location), { project: currentProject, filters: written });

    // Update URL without reloading the page. Safari throws past 100 updates
    // per 30 seconds: the URL then catches up on the next change
    try {
        if (replace) {
            window.history.replaceState({}, '', url);
        } else {
            window.history.pushState({}, '', url);
        }
    } catch (error) {
        // The filters are already applied; only the address bar lags
    }
}

// Selects the values a multi-select offers among the given ones, and returns what it kept
function restoreMultiSelect(id, values) {
    const multiSelect = getMultiSelect(id);
    if (!multiSelect) return values;
    multiSelect.setSelectedValues(values);
    return multiSelect.getSelectedValues();
}

// Copies the filters the URL describes into the state and the controls. Runs
// after every render, once every option list is populated, and on Back and
// Forward. Each multi-select keeps only the values its options offer, so a
// stale name in a shared link or an ended sprint is dropped (and cannot leave
// the Work select enabled over an empty selection). SYNC follows the URL only
// while its statuses are loaded: they are fetched on demand, so a reload starts
// at "Show all". The URL holds the trimmed query: while the user is typing the
// box keeps its own content (a re-render must not eat a trailing space); after
// a switch from the URL (`preferTypedText: false`: page load, Back and
// Forward) the URL wins, unless the box holds the URL's query with extra
// whitespace, the same filter: a query typed during a page load keeps its
// trailing space.
function restoreFiltersFromUrl({ preferTypedText = true } = {}) {
    const restored = filtersFromUrl(window.location.search);
    for (const { key, elementId } of multiSelectFilters) restored[key] = restoreMultiSelect(elementId, restored[key]);

    const syncSelect = document.getElementById('syncSelect');
    const syncOffered = syncSelect && Array.from(syncSelect.options).some(option => option.value === restored.sync);
    restored.sync = (syncStatusesLoaded() && syncOffered) ? restored.sync : 'Show all';
    if (syncSelect) syncSelect.value = restored.sync;

    const hideDraftsCheckbox = document.getElementById('hideDraftsCheckbox');
    if (hideDraftsCheckbox) hideDraftsCheckbox.checked = restored.hideDrafts;

    const textFilter = document.getElementById('textFilter');
    const typing = textFilter && document.activeElement === textFilter;
    if (typing && (preferTypedText || textFilter.value.trim() === restored.text)) {
        restored.text = textFilter.value;
    } else if (textFilter) {
        textFilter.value = restored.text;
    }

    filters = restored;
    updateWorkSelect();
    updateTextFilterClearButton();
}

function initializeWorkFilter() {
    const workSelect = document.getElementById('workSelect');
    if (workSelect) workSelect.addEventListener('change', handleFilterChange);
    updateWorkSelect();
    const hideDraftsCheckbox = document.getElementById('hideDraftsCheckbox');
    if (hideDraftsCheckbox) hideDraftsCheckbox.addEventListener('change', handleFilterChange);
}

// The Work select depends on the participants: while none is selected the
// state is back to "All work" (so a work=ready without a participant in
// the URL is dropped) and the select is disabled; otherwise it shows the state
function updateWorkSelect() {
    if (filters.participants.length === 0) filters.work = 'all';
    const workSelect = document.getElementById('workSelect');
    if (workSelect) {
        workSelect.disabled = filters.participants.length === 0;
        workSelect.value = filters.work;
    }
}

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        availableProjects = await response.json();
        const projectSelect = document.getElementById('projectSelect');
        // Option nodes: a project name is text, never markup (NFR-SEC7)
        projectSelect.replaceChildren(new Option('Select a project', ''), ...availableProjects.map(project => new Option(project, project)));
        projectSelect.addEventListener('change', event => selectProject(event.target.value));

        // Open the project the URL names, with the filters it carries
        const projectName = projectFromUrl(window.location.search, availableProjects);
        if (projectName) {
            projectSelect.value = projectName;
            await selectProject(projectName, { fromUrl: true });
        }
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

// Switches to a project, or to none with an empty name. From the dropdown the
// filters start empty and the switch gets one history entry. From the URL
// (page load, Back and Forward) the URL already describes the state to reach
// and is left alone: the render restores the filters it carries, and the URL
// wins over a focused search box (see restoreFiltersFromUrl). Without a
// project the page is back to its initial state: the filter options and
// selections are cleared whatever the URL says, there is nothing to restore
// them against.
async function selectProject(projectName, { fromUrl = false } = {}) {
    // The SYNC statuses and the checks belong to the project being left: a
    // check of the new project during its load could replace the loading message
    stopPeriodicChecking();
    resetSyncStatuses();
    const generation = ++loadGeneration;
    projectLoading = false;
    loadPrefersTypedText = !fromUrl;
    // Nothing is rendered for the project being switched to: a popstate meanwhile waits for the render
    currentApiResult = null;
    currentProject = projectName || null;
    updateSyncControls();
    updateDocumentTitle({ project: currentProject, attentionCount: 0 });
    closeSidebarDrawer();
    // The refresh time and the gaps belong to the data being left
    const lastRefreshElement = document.getElementById('lastRefreshTime');
    if (lastRefreshElement) lastRefreshElement.textContent = '';
    showPartialDataIndicator();

    if (!currentProject) {
        clearFilterOptions();
        resetFilterControls();
        readFilterControls();
        if (!fromUrl) updateUrlWithFilters();
        setToolbarVisible(false);
        showEmptyState();
        applyFilters(); // no tree to filter: refreshes the badge and the tab title
        return;
    }

    if (!fromUrl) {
        resetFilterControls();
        readFilterControls();
        updateUrlWithFilters();
    }
    showLoadingState();
    projectLoading = true;
    const result = await fetchData(projectName);
    // Back and Forward make quick switches easy: a late response of a load replaced since is dropped
    if (generation !== loadGeneration) return;
    projectLoading = false;
    takeAnswer(result);
    if (result.data) renderProjectLoad(result.data);
    // A hidden tab starts them when it becomes visible again. A 503 whose
    // pause ended while it was on its way: the check is sent at once.
    if (!document.hidden) startPeriodicChecking(Boolean(result.pausedUntil) && !pausedUntil);
}

// The address bar catches up with the filters the render validated, without
// a new entry. Over partial data the filters a gap feeds keep the values of
// the URL: the epic, story or sprint the data lacks stays there, and the next
// complete render restores it (#91)
function catchUpUrl() {
    const written = filtersKeptOverGaps(filters, filtersFromUrl(window.location.search), currentApiResult.incomplete);
    updateUrlWithFilters({ replace: true, filters: written });
}

// The first render of a project: by its load, or by a later check when the
// load got no data (a failure, or the Atlassian pause)
function renderProjectLoad(data) {
    renderEverything(data, { preferTypedText: loadPrefersTypedText });
    catchUpUrl();
}

// Takes the server's pause from an answer of a load or a check (see
// pauseEndAfter) and, when the answer has no data and nothing is rendered,
// paints its message: the pause while it is ahead, a failure otherwise. The
// message follows the answer, the indicator the server: a failure during a
// pause still says "Could not load", with the time of the next check.
function takeAnswer(result) {
    setPause(pauseEndAfter(pausedUntil, result));
    if (result.data || currentApiResult) return;
    setToolbarVisible(false);
    // A 503 that arrived after the end of its pause is a failure: setPause dropped the end
    if (result.pausedUntil && pausedUntil) {
        showPausedState();
    } else {
        showErrorState();
    }
}

// Back and Forward: the page follows the URL, never the other way round.
// Another project (or none): switch to it, the render restores the filters
// of that URL. Same project: the filters are restored from the URL and
// applied, then the URL is replaced with what was kept, as a project load
// does after its render (a value the options no longer offer since a refresh
// is dropped from the entry, except in a filter a gap of the data feeds).
// Nothing here pushes a history entry. Browsers no longer fire popstate on
// page load.
function handlePopState() {
    const projectName = projectFromUrl(window.location.search, availableProjects);
    if (projectName !== currentProject) {
        document.getElementById('projectSelect').value = projectName || '';
        selectProject(projectName, { fromUrl: true });
        return;
    }
    // Nothing rendered (loading, or the last load failed): the next render restores from the URL
    if (!currentApiResult) return;
    restoreFiltersFromUrl({ preferTypedText: false });
    applyFilters();
    catchUpUrl();
}

// Messages shown in the main pane instead of the tree. Built with DOM nodes so
// project names never go through innerHTML.
function showStateMessage(iconClass, text, modifier = '') {
    const message = document.createElement('div');
    message.className = `state-message ${modifier}`.trim();
    const icon = document.createElement('i');
    icon.className = iconClass;
    const label = document.createElement('span');
    label.textContent = text;
    message.append(icon, label);
    document.getElementById('pull-requests').replaceChildren(message);
}

function showEmptyState() {
    showStateMessage('fas fa-code-branch', 'Select a project to display its pull requests');
}

function showLoadingState() {
    showStateMessage('fas fa-spinner fa-spin', `Loading ${currentProject}…`);
}

// The checks are skipped during a pause: the next one is at its end
function showErrorState() {
    const text = pausedUntil ? failedDuringPauseText(currentProject, pausedUntil) : `Could not load ${currentProject}. The next automatic check will retry.`;
    showStateMessage('fas fa-exclamation-triangle', text, 'error');
}

function showPausedState() {
    showStateMessage('fas fa-hourglass-half', pausedStateText(currentProject, pausedUntil));
}

// Copies the filter controls into the filters object and refreshes the
// controls that depend on them (the Work select, the clear button)
function readFilterControls() {
    const read = defaultFilters();
    const textFilter = document.getElementById('textFilter');
    read.text = textFilter ? textFilter.value : '';
    for (const { key, elementId } of multiSelectFilters) {
        const multiSelect = getMultiSelect(elementId);
        read[key] = multiSelect ? multiSelect.getSelectedValues() : [];
    }
    // The Work and SYNC values come from regular select elements
    const workSelect = document.getElementById('workSelect');
    const syncSelect = document.getElementById('syncSelect');
    read.work = workSelect ? workSelect.value : 'all';
    read.sync = syncSelect ? syncSelect.value : 'Show all';
    const hideDraftsCheckbox = document.getElementById('hideDraftsCheckbox');
    read.hideDrafts = hideDraftsCheckbox ? hideDraftsCheckbox.checked : false;
    filters = read;
    updateWorkSelect();
    updateTextFilterClearButton();
}

function handleFilterChange() {
    readFilterControls();
    applyFilters();
    updateUrlWithFilters();
}

// Typing in the search box: same path, but the URL entry is replaced so the
// history does not gain an entry per keystroke
function handleTextFilterInput() {
    readFilterControls();
    applyFilters();
    updateUrlWithFilters({ replace: true });
}

// After a SYNC load, successful or not: the SYNC filter is only meaningful
// while statuses are loaded (a first load may have failed), and the filters
// run again so a selected SYNC filter uses the new statuses
function handleSyncLoadEnd() {
    if (!syncStatusesLoaded()) filters.sync = 'Show all';
    applyFilters();
    // A 429 of the SYNC load pauses every Atlassian request: the banner shows it now, not at the next check
    const syncPause = syncPauseEnd();
    if (syncPause > Math.max(pausedUntil, Date.now())) setPause(syncPause);
}

function updateTextFilterClearButton() {
    const clearButton = document.getElementById('textFilterClear');
    if (clearButton) clearButton.hidden = filters.text === '';
}

function initializeTextFilter() {
    const textFilter = document.getElementById('textFilter');
    const clearButton = document.getElementById('textFilterClear');
    if (!textFilter) return;
    textFilter.addEventListener('input', handleTextFilterInput);
    textFilter.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (textFilter.value !== '') {
            // Clear on Escape; the app shell leaves Escape to a filled text box
            event.preventDefault();
            textFilter.value = '';
            handleTextFilterInput();
        } else {
            textFilter.blur();
        }
    });
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            textFilter.value = '';
            handleTextFilterInput();
            textFilter.focus();
        });
    }
}

// Function to format the refresh time
function formatRefreshTime(isoString) {
    const date = new Date(isoString);
    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    return `Last refreshed: ${date.toLocaleString(undefined, options)}`;
}

function renderEverything(apiResult, { preferTypedText = true } = {}) {
    if (!currentProject) {
        return;
    }

    // Capture current toggle states before re-rendering
    const toggleStates = captureToggleStates();

    currentApiResult = apiResult;
    const filterIndex = initializeFilter(currentApiResult);
    const container = document.getElementById('pull-requests');

    // Create main content
    const mainContent = renderRepositories(
        currentApiResult.pullRequests,
        currentApiResult.jiraIssuesMap,
        currentApiResult.jiraIssuesDetails,
        currentApiResult.jiraSiteName
    );

    // Add orphaned issues section (a repository block, filtered with the tree)
    const orphanedIssuesHtml = renderOrphanedIssues(currentApiResult.orphanedIssues, currentApiResult.jiraSiteName);

    // Combine content
    container.innerHTML = mainContent + orphanedIssuesHtml;

    // Restore toggle states after rendering
    restoreToggleStates(toggleStates);

    // Re-paint the last loaded SYNC statuses (without fetching them again); the
    // filters read the statuses themselves, so the order does not matter
    applySyncStatuses();
    // Reflect the current SYNC load state (statuses are only fetched on demand)
    updateSyncControls();
    // The option lists come from the index, under the registry keys
    for (const { key, elementId } of multiSelectFilters) {
        const multiSelect = getMultiSelect(elementId);
        if (multiSelect) multiSelect.setOptions(filterIndex[key]);
    }

    // Every option list is populated: restore the filters from the URL (see restoreFiltersFromUrl for preferTypedText) and apply them once
    restoreFiltersFromUrl({ preferTypedText });
    applyFilters();
    setToolbarVisible(true);

    // Update the last refresh time
    const lastRefreshElement = document.getElementById('lastRefreshTime');
    if (lastRefreshElement && currentApiResult.lastRefreshTime) {
        lastRefreshElement.textContent = formatRefreshTime(currentApiResult.lastRefreshTime);
    }
    // The hash covers the gaps: a change of completeness alone renders here too
    showPartialDataIndicator(currentApiResult.incomplete);
}

// The answer of /api/pull-requests/:project: { data }, { pausedUntil } during
// an Atlassian pause, {} on any other failure
async function fetchData(project) {
    try {
        const response = await fetch(`/api/pull-requests/${encodeURIComponent(project)}`);
        const result = await readProjectResponse(response);
        if (!result.data && !result.pausedUntil) console.error(`Error fetching pull requests: HTTP ${response.status}`);
        return result;
    } catch (error) {
        console.error('Error fetching pull requests:', error);
        return {};
    }
}

// Keeps the end of the server's pause (0: none; an end already past is none:
// a timer may come late in a background tab), shows it in the banner and
// moves the timer at its end
function setPause(until) {
    pausedUntil = until > Date.now() ? until : 0;
    showPauseIndicator(pausedUntil);
    clearTimeout(pauseEndTimer);
    pauseEndTimer = null;
    // A second after the end, so the server's pause is over
    if (pausedUntil) pauseEndTimer = setTimeout(endPause, pausedUntil - Date.now() + 1000);
}

// Without a project, or in a hidden tab, there is nothing to check: a tab
// shown again checks at once
function endPause() {
    setPause(0);
    if (reloadInterval) checkForUpdates();
}

async function checkForUpdates() {
    const project = currentProject;
    if (!project) {
        return;
    }
    // During the pause the server answers 503 or the data already shown; the check at its end takes over.
    // During a load, the load answers.
    if (Date.now() < pausedUntil || projectLoading) {
        return;
    }
    const generation = loadGeneration;
    // The refresh icon spins while a check runs, and marks it: a second check
    // meanwhile is skipped (before the try, so the finally below does not
    // stop the icon of the running check)
    const refreshIcon = document.getElementById('refreshIcon');
    if (refreshIcon && refreshIcon.classList.contains('checking')) {
        return;
    }
    if (refreshIcon) refreshIcon.classList.add('checking');
    try {
        const result = await fetchData(project);
        // A project switched to during the check has its own load: the late response is dropped
        if (generation !== loadGeneration) return;
        // The tree, if any, stays on an answer without data
        takeAnswer(result);
        const newData = result.data;
        if (!newData) return;

        // Always update the refresh time
        const lastRefreshElement = document.getElementById('lastRefreshTime');
        if (lastRefreshElement && newData.lastRefreshTime) {
            lastRefreshElement.textContent = formatRefreshTime(newData.lastRefreshTime);
        }

        // Nothing displayed yet because the load got no data: this is the load's render
        if (!currentApiResult) {
            renderProjectLoad(newData);
        } else if (newData.dataHash !== currentApiResult.dataHash) {
            console.log('Data has changed. Updating...');
            // The URL is left alone: a value this data no longer offers is
            // dropped from the sidebar but kept in the URL, so it comes back
            // when a later refresh offers it again, unless a user action
            // rewrote the URL meanwhile (a Jira failure gives a response
            // without epics, stories or sprints, marked incomplete; #61, #91)
            renderEverything(newData);
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('checking');
    }
}
function startPeriodicChecking(now) {
    if (reloadInterval) {
        clearInterval(reloadInterval);
    }
    if (now) {
        setTimeout(checkForUpdates, 0); // run now
    }
    reloadInterval = setInterval(checkForUpdates, 120000); // Check every minute
}

function stopPeriodicChecking() {
    if (reloadInterval) {
        clearInterval(reloadInterval);
        reloadInterval = null;
    }
}

// Add event listener for visibility change
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        stopPeriodicChecking();
    } else {
        if (currentProject) {
            startPeriodicChecking(true);
        }
    }
});

// Initialize multi-select components
function initializeMultiSelects() {
    for (const { elementId } of multiSelectFilters) createMultiSelect(elementId, { onChange: handleFilterChange });
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    initializeAppShell({ onClearFilters: clearAllFilters });
    initializeMultiSelects();
    initializeTextFilter();
    showEmptyState();
    loadProjects();
    initializePopovers();
    document.getElementById('pull-requests').addEventListener('click', handleTreeClick);
    initializeWorkFilter();
    initializeSyncControls({
        getProject: () => currentProject,
        getSyncFilter: () => filters.sync,
        onFilterChange: handleFilterChange,
        onLoadEnd: handleSyncLoadEnd
    });
    window.addEventListener('popstate', handlePopState);
});
