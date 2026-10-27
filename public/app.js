import { initializeFilter, filterBranches, countActiveFilters } from './app-filter.js';
import { renderRepositories, renderOrphanedIssues, initializePopovers } from './app-render.js';
import { initializeSyncControls, resetSyncStatuses, syncStatusesLoaded, loadedSyncStatuses, syncPauseEnd, applySyncStatuses, updateSyncControls } from './app-sync.js';
import { createMultiSelect, getMultiSelect } from './multi-select.js';
import { handleCopyClick } from './copy-branch.js';
import { handleTreeClick, captureToggleStates, restoreToggleStates, storedToggleStates, storeToggleStates, pruneStoredToggleStates, onFoldChange } from './tree-toggle.js';
import { handleTreeKey, captureFocusedRow, restoreFocusedRow, paintSelectedRow, markSelectedRow, rowOf, rowKey } from './tree-keyboard.js';
import { initializeAppShell, updateDocumentTitle, closeSidebarDrawer, updateActiveFilterBadge, setToolbarVisible, showPartialDataIndicator } from './app-shell.js';
import { filtersFromUrl, projectFromUrl, urlWithFilters, filtersKeptOverGaps, selectedFromUrl, urlWithSelection } from './app-url.js';
import { multiSelectFilters, defaultFilters, singleValueFilters, applyFilterRequirements, readSingleValueControls, writeSingleValueControls } from './filter-registry.js';
import { readProjectResponse, pauseEndAfter, pausedStateText, failedDuringPauseText, showPauseIndicator } from './atlassian-pause.js';
import { apiFetch, pageIsStale, pageUpdatedStateText, initializePageUpdatedButton } from './page-updated.js';

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
// The rows the last filter pass left displayed, in document order: where j and k go (tree-keyboard.js)
let treeRows = [];
// The row the user last selected (its key, the `selected` URL parameter), and
// the row selected: that one when the last pass shows it, the first row shown
// otherwise. Only a selection by the user changes the first (see selectRow)
let wantedRowKey = null;
let selectedRow = null;
// The URL write of a selection waits for the keys to rest (see selectRow)
let selectionWriteTimer = null;
// While a re-render gives the focus back, the focus selects nothing: a refresh never writes the URL
let restoringFocus = false;
// Whether the last click was in the tree's pane: the arrows then move the selection
// with the focus on the page itself; after a click in the sidebar or the banner they scroll it
let lastPointerInTree = true;

// Runs the filter pass and refreshes everything that depends on it: the
// counters (inside filterBranches), the active-filter badge, the clear button
// and the attention count in the tab title.
function applyFilters() {
    const { attentionCount, shownRows } = filterBranches(filters, loadedSyncStatuses());
    treeRows = shownRows;
    selectedRow = paintSelectedRow(treeRows, wantedRowKey, selectedRow);
    // The selection moved without the user (Back, a filter): a row still holding the focus
    // lets it go, so the keys and the focus a refresh gives back follow the selected row
    const focusedRow = rowOf(document.activeElement);
    if (focusedRow && focusedRow !== selectedRow) document.activeElement.blur();
    updateActiveFilterBadge(countActiveFilters(filters));
    updateDocumentTitle({ project: currentProject, attentionCount });
}

// The filter controls are looked up by id (filter-registry.js)
const elementById = id => document.getElementById(id);

// Puts every filter control back to its default without applying anything:
// the search box, the multi-selects and the single-value controls (the Work
// select's disabled state follows the participants in readFilterControls)
function resetFilterControls() {
    const textFilter = document.getElementById('textFilter');
    if (textFilter) textFilter.value = '';
    for (const { elementId } of multiSelectFilters) {
        const multiSelect = getMultiSelect(elementId);
        if (multiSelect) multiSelect.clearAll(false);
    }
    writeSingleValueControls(defaultFilters(), elementById);
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

// A selection by the user: a key, a click in a row, Tab into a row. The URL
// entry is replaced (no entry per row, like typing in the search box), once
// the keys rest: a held arrow would spend the browser's budget of URL updates.
// A refresh never gets here: the focus it gives back selects nothing
// (restoringFocus), so a refresh never writes the URL (#61)
function selectRow(row) {
    const key = rowKey(row);
    if (key === wantedRowKey && row === selectedRow) return;
    wantedRowKey = key;
    selectedRow = markSelectedRow(row, selectedRow);
    clearTimeout(selectionWriteTimer);
    selectionWriteTimer = setTimeout(writeSelection, 250);
}

function writeSelection() {
    selectionWriteTimer = null;
    try {
        window.history.replaceState(window.history.state, '', urlWithSelection(new URL(window.location), wantedRowKey));
    } catch (error) {
        // Safari's update limit: the address bar catches up at the next write
    }
}

// A selection not written yet: a write of the URL takes it along, Back/Forward and a project switch drop it
function cancelSelectionWrite() {
    clearTimeout(selectionWriteTimer);
    selectionWriteTimer = null;
}

// The selected row after a project load or Back/Forward: in the middle of the view
function scrollToSelectedRow() {
    selectedRow?.scrollIntoView({ block: 'center' });
}

// Writes the project, the filters (the state unless others are given) and the wanted row to
// the URL. `replace` swaps the current history entry instead of pushing one:
// while typing in the search box, and when the address bar catches up after a load.
function updateUrlWithFilters({ replace = false, filters: written = filters } = {}) {
    cancelSelectionWrite();
    const url = urlWithSelection(urlWithFilters(new URL(window.location), { project: currentProject, filters: written }), wantedRowKey);

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
    if (!syncStatusesLoaded() || !syncOffered) restored.sync = defaultFilters().sync;
    writeSingleValueControls(restored, elementById);

    const textFilter = document.getElementById('textFilter');
    const typing = textFilter && document.activeElement === textFilter;
    if (typing && (preferTypedText || textFilter.value.trim() === restored.text)) {
        restored.text = textFilter.value;
    } else if (textFilter) {
        textFilter.value = restored.text;
    }

    filters = restored;
    applyFilterRequirements(filters, elementById);
    updateTextFilterClearButton();
}

function initializeSingleValueFilters() {
    for (const { elementId } of singleValueFilters) document.getElementById(elementId)?.addEventListener('change', handleFilterChange);
    applyFilterRequirements(filters, elementById);
}


async function loadProjects() {
    try {
        const response = await apiFetch('/api/projects');
        if (!response) return;
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
    // The row wanted belongs to the project: from the dropdown none is, the URL write drops it.
    // A refresh does not read it: the state is the user's last selection
    cancelSelectionWrite();
    wantedRowKey = fromUrl ? selectedFromUrl(window.location.search) : null;
    selectedRow = null;
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
    if (!document.hidden && !result.stale) startPeriodicChecking(Boolean(result.pausedUntil) && !pausedUntil);
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
    scrollToSelectedRow();
}

// Takes the server's pause from an answer of a load or a check (see
// pauseEndAfter) and, when the answer has no data and nothing is rendered,
// paints its message: the pause while it is ahead, a failure otherwise. The
// message follows the answer, the indicator the server: a failure during a
// pause still says "Could not load", with the time of the next check. An
// answer of a server serving another page is not read (#125): the checks
// stop, the tree shown stays, the banner offers the reload.
function takeAnswer(result) {
    if (result.stale) {
        stopPeriodicChecking();
        // The page reads nothing more, so it says nothing of the server's pause either
        setPause(0);
        updateSyncControls();
        if (!currentApiResult) {
            // Nothing to restore against: the options of the project left must not be offered for this one
            clearFilterOptions();
            setToolbarVisible(false);
            showStateMessage('fas fa-redo', pageUpdatedStateText(currentProject));
        }
        return;
    }
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
    // A selection not written yet belongs to the entry left
    cancelSelectionWrite();
    const projectName = projectFromUrl(window.location.search, availableProjects);
    if (projectName !== currentProject) {
        document.getElementById('projectSelect').value = projectName || '';
        selectProject(projectName, { fromUrl: true });
        return;
    }
    // The row wanted is the entry's, rendered or not: the next render selects it and writes it back
    wantedRowKey = selectedFromUrl(window.location.search);
    // Nothing rendered (loading, or the last load failed): the next render restores the filters from the URL
    if (!currentApiResult) return;
    const selectedBefore = selectedRow;
    restoreFiltersFromUrl({ preferTypedText: false });
    applyFilters();
    catchUpUrl();
    if (selectedRow !== selectedBefore) scrollToSelectedRow();
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
    readSingleValueControls(read, elementById);
    filters = read;
    applyFilterRequirements(filters, elementById);
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
    if (!syncStatusesLoaded()) filters.sync = defaultFilters().sync;
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

// The collapse state of the tree shown, kept for the next page load (#142),
// after the user folds or unfolds. Only over the project's tree: during its
// load the pane shows a message, and storing that would unfold its stored folds
function saveCollapseState() {
    if (currentProject && currentApiResult) storeToggleStates(currentProject);
}

function renderEverything(apiResult, { preferTypedText = true } = {}) {
    if (!currentProject) {
        return;
    }

    // The folds to put back: the tree's own across a refresh, the stored ones
    // at the project's first render, which replaces a message (#142)
    const toggleStates = currentApiResult ? captureToggleStates() : storedToggleStates(currentProject);
    const container = document.getElementById('pull-requests');
    // The focus is lost with the rows it was in: the row is focused again after the pass
    const focusedRow = captureFocusedRow(container, document.activeElement);

    currentApiResult = apiResult;
    const filterIndex = initializeFilter(currentApiResult);

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

    // Restore toggle states after rendering; the stored ones lose the keys gone from the tree
    restoreToggleStates(toggleStates);
    pruneStoredToggleStates(currentProject);

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
    // The focus is given back to the selected row only: a refresh must not select another (selectRow would write the URL)
    if (selectedRow && focusedRow?.key === rowKey(selectedRow)) {
        restoringFocus = true;
        try {
            restoreFocusedRow(focusedRow, treeRows);
        } finally {
            restoringFocus = false;
        }
    }
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
// an Atlassian pause, { stale } from a server serving another page than this
// one (nothing is fetched once the page is stale), {} on any other failure
async function fetchData(project) {
    try {
        const response = await apiFetch(`/api/pull-requests/${encodeURIComponent(project)}`);
        if (!response) return { stale: true };
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
// A stale page checks nothing: only a reload brings it data again (#125)
function startPeriodicChecking(now) {
    if (pageIsStale()) return;
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
    initializeAppShell({
        onClearFilters: clearAllFilters,
        onTreeKey: event => handleTreeKey(event, { shownRows: treeRows, selectedRow, select: selectRow, arrowsFromPage: lastPointerInTree })
    });
    initializePageUpdatedButton();
    initializeMultiSelects();
    initializeTextFilter();
    showEmptyState();
    loadProjects();
    initializePopovers();
    const treePane = document.getElementById('pull-requests');
    // The pane's one click listener: a copy button copies, anything else may toggle a block
    treePane.addEventListener('click', event => handleCopyClick(event) || handleTreeClick(event));
    // Every fold of the user's, by a click, a key or Collapse all, is kept for the next page load
    onFoldChange(saveCollapseState);
    // A click in a row, or Tab into one, selects it (a row is focusable)
    treePane.addEventListener('focusin', event => {
        const row = rowOf(event.target);
        if (row && !restoringFocus) selectRow(row);
    });
    document.addEventListener('pointerdown', event => {
        lastPointerInTree = event.target instanceof Element && Boolean(event.target.closest('.main-pane'));
    }, true);
    initializeSingleValueFilters();
    initializeSyncControls({
        getProject: () => currentProject,
        getSyncFilter: () => filters.sync,
        onLoadEnd: handleSyncLoadEnd
    });
    window.addEventListener('popstate', handlePopState);
});
