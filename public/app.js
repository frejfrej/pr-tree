import { initializeFilter, filterBranches, countActiveFilters, issueOptions } from './app-filter.js';
import { renderRepositories, renderOrphanedIssues, initializePopovers } from './app-render.js';
import { createMultiSelect, getMultiSelect } from './multi-select.js';
import { toggleChildren, toggleRootBranch, toggleRepository, captureToggleStates, restoreToggleStates } from './tree-toggle.js';
import { initializeAppShell, updateDocumentTitle, closeSidebarDrawer, updateActiveFilterBadge, setToolbarVisible } from './app-shell.js';
import { filtersFromUrl, urlWithFilters } from './app-url.js';

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
// SYNC statuses are only fetched when the user clicks the load button; the
// last response is kept so it can be re-applied after automatic re-renders
let currentSyncStatuses = null;
let syncStatusLoading = false;
let syncLoadFailed = false;

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
// box keeps its own content (a re-render must not eat a trailing space); on
// Back and Forward (`preferTypedText: false`) the URL wins.
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
    currentSync = (currentSyncStatuses && syncOffered) ? filters.sync : 'Show all';
    if (syncSelect) syncSelect.value = currentSync;

    currentReadyForReviewer = filters.readyReviewer;
    currentReadyForAssignee = filters.readyAssignee;
    updateReadyCheckboxes();

    currentText = filters.text;
    const textFilter = document.getElementById('textFilter');
    if (textFilter && preferTypedText && document.activeElement === textFilter) {
        currentText = textFilter.value;
    } else if (textFilter) {
        textFilter.value = currentText;
    }
    updateTextFilterClearButton();
}

function initializeSyncControls() {
    const syncSelect = document.getElementById('syncSelect');
    if (syncSelect) {
        syncSelect.addEventListener('change', handleFilterChange);
    }
    const loadSyncButton = document.getElementById('loadSyncButton');
    if (loadSyncButton) {
        loadSyncButton.addEventListener('click', loadSyncStatuses);
    }
    updateSyncControls();
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
        const projects = await response.json();
        const projectSelect = document.getElementById('projectSelect');
        projectSelect.innerHTML = '<option value="">Select a project</option>' +
            projects.map(project => `<option value="${project}">${project}</option>`).join('');
        projectSelect.addEventListener('change', event => selectProject(event.target.value));

        // Open the project the URL names, with the filters it carries
        const projectName = projectFromUrl();
        if (projectName) {
            projectSelect.value = projectName;
            await selectProject(projectName, { fromUrl: true });
        }
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

// The project the URL names, when the dropdown offers it; '' otherwise
function projectFromUrl() {
    const projectName = new URLSearchParams(window.location.search).get('project') || '';
    const options = Array.from(document.getElementById('projectSelect').options);
    return options.some(option => option.value === projectName) ? projectName : '';
}

// Switches to a project, or to none with an empty name. From the dropdown the
// filters start empty and the switch gets one history entry. From the URL
// (page load, Back and Forward) the URL already describes the state to reach
// and is left alone: the render restores the filters it carries.
// `preferTypedText` reaches restoreFiltersFromUrl: Back and Forward pass false so the URL wins over a focused search box.
async function selectProject(projectName, { fromUrl = false, preferTypedText = true } = {}) {
    // The SYNC statuses belong to the project being left
    currentSyncStatuses = null;
    syncLoadFailed = false;
    // Nothing is rendered for the project being switched to: a popstate meanwhile waits for the render
    currentApiResult = null;
    currentProject = projectName || null;
    updateSyncControls();
    updateDocumentTitle({ project: currentProject, attentionCount: 0 });
    closeSidebarDrawer();

    if (!currentProject) {
        if (!fromUrl) updateUrlWithFilters();
        setToolbarVisible(false);
        applyFilters(); // no tree to filter: refreshes the badge and the tab title
        showEmptyState();
        stopPeriodicChecking();
        return;
    }

    if (!fromUrl) {
        resetFilterControls();
        readFilterControls();
        updateUrlWithFilters();
    }
    showLoadingState();
    const apiResult = await fetchData();
    // Back and Forward make quick switches easy: a late response for a project no longer selected is dropped
    if (currentProject !== projectName) return;
    renderEverything(apiResult, { preferTypedText });
    // The address bar catches up with the filters the render validated, without a new entry
    if (apiResult) updateUrlWithFilters({ replace: true });
    startPeriodicChecking();
}

// Back and Forward: the page follows the URL, never the other way round.
// Another project: switch to it, the render restores the filters of that
// URL. Same project: the filters are restored from the URL and applied.
// Nothing here pushes a history entry. Browsers no longer fire popstate on
// page load.
function handlePopState() {
    const projectName = projectFromUrl();
    if (projectName !== (currentProject || '')) {
        document.getElementById('projectSelect').value = projectName;
        selectProject(projectName, { fromUrl: true, preferTypedText: false });
        return;
    }
    // Nothing rendered (loading, or the last load failed): the next render restores from the URL
    if (!currentApiResult) return;
    restoreFiltersFromUrl({ preferTypedText: false });
    applyFilters();
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

async function fetchData() {
    try {
        const response = await fetch(`/api/pull-requests/${encodeURIComponent(currentProject)}`);
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
    if (!currentProject) {
        return;
    }
    try {
        // Show the refresh icon
        const refreshIcon = document.getElementById('refreshIcon');
        if (refreshIcon) {
            if (refreshIcon.classList.contains('checking')) {
                return; // we're already checking
            }
            refreshIcon.classList.add('checking');
        }

        const newData = await fetchData();
        if (!newData) return;

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
        // Hide the refresh icon
        const refreshIcon = document.getElementById('refreshIcon');
        if (refreshIcon) {
            refreshIcon.classList.remove('checking');
        }
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

// Fetches the SYNC status of every pull request of the current project in a
// single server call. Only triggered by the load button, never automatically.
async function loadSyncStatuses() {
    if (!currentProject || syncStatusLoading) {
        return;
    }

    syncStatusLoading = true;
    updateSyncControls();
    document.querySelectorAll('.conflicts-counter').forEach(counter => {
        if (!counter.dataset.spec.includes('undefined')) {
            counter.innerHTML = '<div class="conflicts-spinner"></div>';
        }
    });

    try {
        const response = await fetch(`/api/sync-statuses/${encodeURIComponent(currentProject)}`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        currentSyncStatuses = await response.json();
        syncLoadFailed = false;
    } catch (error) {
        console.error('Error fetching sync statuses:', error);
        syncLoadFailed = true;
        if (!currentSyncStatuses) {
            currentSync = "Show all";
        }
    } finally {
        syncStatusLoading = false;
    }

    updateSyncControls();
    applySyncStatuses();
    // Re-apply filters so an already selected SYNC filter uses the new statuses
    applyFilters();
}

// Renders the stored SYNC statuses onto the conflicts counters
function applySyncStatuses() {
    document.querySelectorAll('.conflicts-counter').forEach(counter => {
        const { repoName, spec } = counter.dataset;
        if (spec.includes('undefined')) {
            counter.innerHTML = `<div class="conflicts-error" title="Invalid spec provided ${spec}">!</div>`;
            return;
        }
        if (!currentSyncStatuses) {
            counter.innerHTML = '';
            return;
        }

        const status = currentSyncStatuses.statuses[`${repoName}/${spec}`];
        if (!status) {
            counter.innerHTML = '<div class="conflicts-error" title="SYNC status unknown - use the SYNC load button to refresh">?</div>';
        } else if (status.error) {
            counter.innerHTML = '<div class="conflicts-error" title="Error fetching conflicts">?</div>';
        } else if (status.conflicts) {
            counter.innerHTML = `
                <div class="conflicts-count" title="Conflicts found">
                    SYNC
                </div>
            `;
        } else {
            // display nothing if there are no conflicts
            counter.innerHTML = ``;
        }
    });
}

function updateSyncControls() {
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
        loadSyncButton.disabled = !currentProject;
        if (buttonIcon) buttonIcon.classList.remove('fa-spin');
        if (currentSyncStatuses) {
            syncSelect.disabled = false;
            syncSelect.innerHTML = `
                <option value="Show all">Show all</option>
                <option value="requested">SYNC required</option>
                <option value="OK">SYNC ok</option>
            `;
            syncSelect.value = currentSync;
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
            const until = currentSyncStatuses.rateLimitedUntil
                ? new Date(currentSyncStatuses.rateLimitedUntil).toLocaleTimeString()
                : '';
            warningText = `Atlassian rate limit reached - SYNC status may be incomplete${until ? `, requests are paused until ${until}` : ''}`;
        }
        syncWarning.hidden = !warningText;
        syncWarning.title = warningText;
    }
}

async function fetchAndDisplayVersion() {
    try {
        const response = await fetch('/api/version');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const versionElement = document.getElementById('versionNumber');
        if (versionElement) {
            versionElement.textContent = `v${data.version}`;
            versionElement.title = `Version ${data.version}, released ${data.releaseDate}\nCreated by ${data.author}\n${data.license}`;
        }
    } catch (error) {
        console.error('Error fetching version:', error);
    }
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
    fetchAndDisplayVersion();
    initializePopovers();
    initializeReadyFilters();
    initializeSyncControls();
    window.addEventListener('popstate', handlePopState);
});

// Export functions that need to be accessible globally
window.toggleChildren = toggleChildren;
window.toggleRootBranch = toggleRootBranch;
window.toggleRepository = toggleRepository;
