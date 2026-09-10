import { initializeFilter, filterBranches, countActiveFilters, issueOptions } from './app-filter.js';
import { renderRepositories, renderOrphanedIssues, initializePopovers } from './app-render.js';
import { initializeSyncControls, resetSyncStatuses, syncStatusesLoaded, applySyncStatuses, updateSyncControls } from './app-sync.js';
import { createMultiSelect, getMultiSelect } from './multi-select.js';
import { toggleChildren, toggleRootBranch, toggleRepository, captureToggleStates, restoreToggleStates } from './tree-toggle.js';
import { initializeAppShell, updateDocumentTitle, closeSidebarDrawer, updateActiveFilterBadge, setToolbarVisible } from './app-shell.js';
import { filtersFromUrl, projectFromUrl, urlWithFilters } from './app-url.js';

// The projects the dropdown offers, from /api/projects
let availableProjects = [];
let currentProject = null;
let currentText = '';
let currentSprints = [];
let currentFixVersions = [];
let currentEpics = [];
let currentStories = [];
let currentAssignees = [];
let currentReviewers = [];
let currentSync = "Show all";
let currentReadyForReviewer = false;
let currentReadyForAssignee = false;
let currentApiResult = null;
let reloadInterval = 100;

// Multi-select filters, in sidebar order
const multiSelectIds = ['sprintSelect', 'fixVersionSelect', 'epicSelect', 'storySelect', 'assigneeSelect', 'reviewerSelect'];
// The two ready checkboxes, in sidebar order
const readyCheckboxIds = ['readyForAssigneeCheck', 'readyForReviewerCheck'];

function currentFilters() {
    return {
        text: currentText,
        assignees: currentAssignees,
        reviewers: currentReviewers,
        sprints: currentSprints,
        fixVersions: currentFixVersions,
        epics: currentEpics,
        stories: currentStories,
        sync: currentSync,
        readyReviewer: currentReadyForReviewer,
        readyAssignee: currentReadyForAssignee
    };
}

// Runs the filter pass and refreshes everything that depends on it: the
// counters (inside filterBranches), the active-filter badge, the clear button
// and the attention count in the tab title.
function applyFilters() {
    const filters = currentFilters();
    const attentionCount = filterBranches(filters);
    updateActiveFilterBadge(countActiveFilters(filters));
    updateDocumentTitle({ project: currentProject, attentionCount });
}

// Puts every filter control back to its default without applying anything:
// the search box, the multi-selects, the ready checkboxes (unchecked; their
// disabled state follows the selection in readFilterControls) and the SYNC select
function resetFilterControls() {
    const textFilter = document.getElementById('textFilter');
    if (textFilter) textFilter.value = '';
    multiSelectIds.forEach(id => {
        const multiSelect = getMultiSelect(id);
        if (multiSelect) multiSelect.clearAll(false);
    });
    readyCheckboxIds.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.checked = false;
    });
    const syncSelect = document.getElementById('syncSelect');
    if (syncSelect) syncSelect.value = 'Show all';
}

// Empties the option lists of the multi-selects, and their selections
// (setOptions keeps them), as before the first load
function clearFilterOptions() {
    multiSelectIds.forEach(id => {
        const multiSelect = getMultiSelect(id);
        if (!multiSelect) return;
        multiSelect.setOptions([]);
        multiSelect.clearAll(false);
    });
}

// Resets every filter and applies the result once.
// The project and the loaded SYNC statuses are kept.
function clearAllFilters() {
    resetFilterControls();
    handleFilterChange();
}

// Writes the project and the filters to the URL. `replace` swaps the current
// history entry instead of pushing one: while typing in the search box, and
// when the address bar catches up after a load.
function updateUrlWithFilters({ replace = false } = {}) {
    const url = urlWithFilters(new URL(window.location), { project: currentProject, filters: currentFilters() });

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
// a ready checkbox enabled over an empty selection). SYNC follows the URL only
// while its statuses are loaded: they are fetched on demand, so a reload starts
// at "Show all". The URL holds the trimmed query: while the user is typing the
// box keeps its own content (a re-render must not eat a trailing space); after
// a switch from the URL (`preferTypedText: false`: page load, Back and
// Forward) the URL wins, unless the box holds the URL's query with extra
// whitespace, the same filter: a query typed during a page load keeps its
// trailing space.
function restoreFiltersFromUrl({ preferTypedText = true } = {}) {
    const filters = filtersFromUrl(window.location.search);

    currentSprints = restoreMultiSelect('sprintSelect', filters.sprints);
    currentFixVersions = restoreMultiSelect('fixVersionSelect', filters.fixVersions);
    currentEpics = restoreMultiSelect('epicSelect', filters.epics);
    currentStories = restoreMultiSelect('storySelect', filters.stories);
    currentAssignees = restoreMultiSelect('assigneeSelect', filters.assignees);
    currentReviewers = restoreMultiSelect('reviewerSelect', filters.reviewers);

    const syncSelect = document.getElementById('syncSelect');
    const syncOffered = syncSelect && Array.from(syncSelect.options).some(option => option.value === filters.sync);
    currentSync = (syncStatusesLoaded() && syncOffered) ? filters.sync : 'Show all';
    if (syncSelect) syncSelect.value = currentSync;

    currentReadyForReviewer = filters.readyReviewer;
    currentReadyForAssignee = filters.readyAssignee;
    updateReadyCheckboxes();

    currentText = filters.text;
    const textFilter = document.getElementById('textFilter');
    const typing = textFilter && document.activeElement === textFilter;
    if (typing && (preferTypedText || textFilter.value.trim() === currentText)) {
        currentText = textFilter.value;
    } else if (textFilter) {
        textFilter.value = currentText;
    }
    updateTextFilterClearButton();
}

function initializeReadyFilters() {
    readyCheckboxIds.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.addEventListener('change', handleFilterChange);
    });
    updateReadyCheckboxes();
}

// The ready checkboxes depend on their multi-select: while no assignee (or
// reviewer) is selected the matching state is cleared (so a readyAssignee=true
// without an assignee in the URL is dropped) and the box is disabled and
// unchecked; otherwise the box shows the state
function updateReadyCheckboxes() {
    if (currentAssignees.length === 0) currentReadyForAssignee = false;
    if (currentReviewers.length === 0) currentReadyForReviewer = false;
    const assigneeCheck = document.getElementById('readyForAssigneeCheck');
    if (assigneeCheck) {
        assigneeCheck.disabled = currentAssignees.length === 0;
        assigneeCheck.checked = currentReadyForAssignee;
    }
    const reviewerCheck = document.getElementById('readyForReviewerCheck');
    if (reviewerCheck) {
        reviewerCheck.disabled = currentReviewers.length === 0;
        reviewerCheck.checked = currentReadyForReviewer;
    }
}

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        availableProjects = await response.json();
        const projectSelect = document.getElementById('projectSelect');
        projectSelect.innerHTML = '<option value="">Select a project</option>' +
            availableProjects.map(project => `<option value="${project}">${project}</option>`).join('');
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
    // The SYNC statuses belong to the project being left
    resetSyncStatuses();
    // Nothing is rendered for the project being switched to: a popstate meanwhile waits for the render
    currentApiResult = null;
    currentProject = projectName || null;
    updateSyncControls();
    updateDocumentTitle({ project: currentProject, attentionCount: 0 });
    closeSidebarDrawer();
    // The refresh time belongs to the data being left
    const lastRefreshElement = document.getElementById('lastRefreshTime');
    if (lastRefreshElement) lastRefreshElement.textContent = '';

    if (!currentProject) {
        clearFilterOptions();
        resetFilterControls();
        readFilterControls();
        if (!fromUrl) updateUrlWithFilters();
        setToolbarVisible(false);
        stopPeriodicChecking();
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
    const apiResult = await fetchData(projectName);
    // Back and Forward make quick switches easy: a late response for a project no longer selected is dropped
    if (currentProject !== projectName) return;
    renderEverything(apiResult, { preferTypedText: !fromUrl });
    // The address bar catches up with the filters the render validated, without a new entry
    if (apiResult) updateUrlWithFilters({ replace: true });
    startPeriodicChecking();
}

// Back and Forward: the page follows the URL, never the other way round.
// Another project (or none): switch to it, the render restores the filters
// of that URL. Same project: the filters are restored from the URL and
// applied, then the URL is replaced with what was kept, as a project load
// does after its render (a value the options no longer offer since a refresh
// is dropped from the entry). Nothing here pushes a history entry. Browsers
// no longer fire popstate on page load.
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
    updateUrlWithFilters({ replace: true });
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

function showErrorState() {
    showStateMessage('fas fa-exclamation-triangle', `Could not load ${currentProject}. The next automatic check will retry.`, 'error');
}

// Copies the filter controls into the state variables and refreshes the
// controls that depend on them (ready checkboxes, clear button)
function readFilterControls() {
    const textFilter = document.getElementById('textFilter');
    const assigneeMultiSelect = getMultiSelect('assigneeSelect');
    const reviewerMultiSelect = getMultiSelect('reviewerSelect');
    const sprintMultiSelect = getMultiSelect('sprintSelect');
    const fixVersionMultiSelect = getMultiSelect('fixVersionSelect');
    const epicMultiSelect = getMultiSelect('epicSelect');
    const storyMultiSelect = getMultiSelect('storySelect');

    currentText = textFilter ? textFilter.value : '';
    currentAssignees = assigneeMultiSelect ? assigneeMultiSelect.getSelectedValues() : [];
    currentReviewers = reviewerMultiSelect ? reviewerMultiSelect.getSelectedValues() : [];
    currentSprints = sprintMultiSelect ? sprintMultiSelect.getSelectedValues() : [];
    currentFixVersions = fixVersionMultiSelect ? fixVersionMultiSelect.getSelectedValues() : [];
    currentEpics = epicMultiSelect ? epicMultiSelect.getSelectedValues() : [];
    currentStories = storyMultiSelect ? storyMultiSelect.getSelectedValues() : [];

    // Get sync and ready values from regular form elements
    const syncSelect = document.getElementById("syncSelect");
    const assigneeCheck = document.getElementById('readyForAssigneeCheck');
    const reviewerCheck = document.getElementById('readyForReviewerCheck');

    currentSync = syncSelect ? syncSelect.value : "Show all";
    currentReadyForAssignee = assigneeCheck ? assigneeCheck.checked : false;
    currentReadyForReviewer = reviewerCheck ? reviewerCheck.checked : false;
    updateReadyCheckboxes();

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
    if (!syncStatusesLoaded()) currentSync = 'Show all';
    applyFilters();
}

function updateTextFilterClearButton() {
    const clearButton = document.getElementById('textFilterClear');
    if (clearButton) clearButton.hidden = currentText === '';
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

function populateFilters(pullRequests) {
    const assigneeMultiSelect = getMultiSelect('assigneeSelect');
    const reviewerMultiSelect = getMultiSelect('reviewerSelect');

    // Extract unique assignees from Jira issues and sort them alphabetically
    const assignees = new Set();
    if (currentApiResult && currentApiResult.jiraIssuesDetails) {
        currentApiResult.jiraIssuesDetails.forEach(issue => {
            if (issue.fields.assignee && issue.fields.assignee.displayName) {
                assignees.add(issue.fields.assignee.displayName);
            }
        });
    }
    const sortedAssignees = [...assignees].sort();
    const assigneeOptions = sortedAssignees.map(assignee => ({ value: assignee, label: assignee }));
    if (assigneeMultiSelect) {
        assigneeMultiSelect.setOptions(assigneeOptions);
    }

    // Extract unique reviewers and sort them alphabetically
    // Exclude Rovo Dev agent from reviewers
    const reviewers = [...new Set(
        pullRequests.flatMap(pr =>
            pr.participants
                .filter(p => p.user.uuid !== pr.author.uuid)
                .map(p => p.user.display_name)
        )
    )].filter(reviewer => reviewer !== 'Rovo Dev').sort();
    const reviewerOptions = reviewers.map(reviewer => ({ value: reviewer, label: reviewer }));
    if (reviewerMultiSelect) {
        reviewerMultiSelect.setOptions(reviewerOptions);
    }

    // Reflect the current SYNC load state (statuses are only fetched on demand)
    updateSyncControls();
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
    if (!apiResult) {
        currentApiResult = null;
        setToolbarVisible(false);
        showErrorState();
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
        new Map(Object.entries(currentApiResult.pullRequestsByDestination)),
        currentApiResult.jiraSiteName
    );

    // Add orphaned issues section
    const orphanedIssuesHtml = renderOrphanedIssues(currentApiResult.orphanedIssues);

    // Combine content
    container.innerHTML = mainContent + orphanedIssuesHtml;

    // Restore toggle states after rendering
    restoreToggleStates(toggleStates);

    // Re-apply the last loaded SYNC statuses (without fetching them again)
    // before filters run, so the SYNC filter can rely on the rendered badges
    applySyncStatuses();
    populateFilters(currentApiResult.pullRequests);
    populateSprintFilter(currentApiResult.sprints);
    populateFixVersionFilter(currentApiResult.jiraIssuesDetails);
    populateIssueFilter('epicSelect', filterIndex.epics);
    populateIssueFilter('storySelect', filterIndex.stories);

    // Every option list is populated: restore the filters from the URL (see restoreFiltersFromUrl for preferTypedText) and apply them once
    restoreFiltersFromUrl({ preferTypedText });
    applyFilters();
    setToolbarVisible(true);

    // Update the last refresh time
    const lastRefreshElement = document.getElementById('lastRefreshTime');
    if (lastRefreshElement && currentApiResult.lastRefreshTime) {
        lastRefreshElement.textContent = formatRefreshTime(currentApiResult.lastRefreshTime);
    }
}

async function fetchData(project) {
    try {
        const response = await fetch(`/api/pull-requests/${encodeURIComponent(project)}`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching pull requests:', error);
        return null;
    }
}

async function checkForUpdates() {
    const project = currentProject;
    if (!project) {
        return;
    }
    // The refresh icon spins while a check runs, and marks it: a second check
    // meanwhile is skipped (before the try, so the finally below does not
    // stop the icon of the running check)
    const refreshIcon = document.getElementById('refreshIcon');
    if (refreshIcon && refreshIcon.classList.contains('checking')) {
        return;
    }
    if (refreshIcon) refreshIcon.classList.add('checking');
    try {
        const newData = await fetchData(project);
        // A project switched to during the check has its own load: the late response of the project left is dropped
        if (currentProject !== project || !newData) return;

        // Always update the refresh time
        const lastRefreshElement = document.getElementById('lastRefreshTime');
        if (lastRefreshElement && newData.lastRefreshTime) {
            lastRefreshElement.textContent = formatRefreshTime(newData.lastRefreshTime);
        }

        // Re-render when the data changed, or when nothing is displayed yet because the last fetch failed
        if (!currentApiResult || newData.dataHash !== currentApiResult.dataHash) {
            console.log('Data has changed. Updating...');
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

function populateSprintFilter(sprints) {
    const sprintMultiSelect = getMultiSelect('sprintSelect');
    if (!sprintMultiSelect) return;

    // Sort sprints by name
    const sortedSprints = sprints.sort((a, b) => a.name.localeCompare(b.name));

    const sprintOptions = sortedSprints.map(sprint => ({
        value: String(sprint.id),
        label: sprint.name
    }));
    sprintMultiSelect.setOptions(sprintOptions);
}

function populateFixVersionFilter(jiraIssuesDetails) {
    const fixVersionMultiSelect = getMultiSelect('fixVersionSelect');
    if (!fixVersionMultiSelect) return;

    // Extract all unique fix versions from jira issues, including project
    const fixVersions = new Map();
    jiraIssuesDetails.forEach(issue => {
        if (issue.fields.fixVersions && issue.fields.fixVersions.length > 0) {
            const project = issue.key.split('-')[0];
            issue.fields.fixVersions.forEach(version => {
                // Use version.id as key to avoid duplicates
                if (!fixVersions.has(version.id)) {
                    fixVersions.set(version.id, { id: version.id, name: version.name, project: project });
                }
            });
        }
    });

    // Convert to array and sort by project then name
    const sortedFixVersions = Array.from(fixVersions.values())
        .sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name));

    const fixVersionOptions = sortedFixVersions.map(version => ({
        value: String(version.id),
        label: `${version.name} (${version.project})`
    }));
    fixVersionMultiSelect.setOptions(fixVersionOptions);
}

// Fills an issue multi-select (epics or stories) from the index; the selection
// is restored from the URL afterwards, like every other filter
function populateIssueFilter(elementId, issues) {
    const multiSelect = getMultiSelect(elementId);
    if (multiSelect) multiSelect.setOptions(issueOptions(issues.values()));
}

// Initialize multi-select components
function initializeMultiSelects() {
    multiSelectIds.forEach(id => createMultiSelect(id, { onChange: handleFilterChange }));
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    initializeAppShell({ onClearFilters: clearAllFilters });
    initializeMultiSelects();
    initializeTextFilter();
    showEmptyState();
    loadProjects();
    initializePopovers();
    initializeReadyFilters();
    initializeSyncControls({
        getProject: () => currentProject,
        getSyncFilter: () => currentSync,
        onFilterChange: handleFilterChange,
        onLoadEnd: handleSyncLoadEnd
    });
    window.addEventListener('popstate', handlePopState);
});

// Export functions that need to be accessible globally
window.toggleChildren = toggleChildren;
window.toggleRootBranch = toggleRootBranch;
window.toggleRepository = toggleRepository;
