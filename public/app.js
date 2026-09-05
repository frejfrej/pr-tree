import { initializeFilter, filterBranches } from './app-filter.js';
import { createMultiSelect, getMultiSelect } from './multi-select.js';
import { toggleChildren, toggleRootBranch, toggleRepository, captureToggleStates, restoreToggleStates } from './tree-toggle.js';
import { initializeAppShell, updateDocumentTitle, closeSidebarDrawer } from './app-shell.js';

let currentProject = null;
let currentSprints = [];
let currentFixVersions = [];
let currentAssignees = [];
let currentReviewers = [];
let currentSync = "Show all";
let currentReadyForReviewer = false;
let currentApiResult = null;
let reloadInterval = 100;
// SYNC statuses are only fetched when the user clicks the load button; the
// last response is kept so it can be re-applied after automatic re-renders
let currentSyncStatuses = null;
let syncStatusLoading = false;
let syncLoadFailed = false;

function updateUrlWithFilters() {
    const url = new URL(window.location);

    // Clear existing multi-select params first
    url.searchParams.delete('assignee');
    url.searchParams.delete('reviewer');
    url.searchParams.delete('sprint');
    url.searchParams.delete('fixVersion');

    // Set project
    if (currentProject) {
        url.searchParams.set('project', currentProject);
    } else {
        url.searchParams.delete('project');
    }

    // Set multi-select params (use repeated params format)
    currentAssignees.forEach(v => url.searchParams.append('assignee', v));
    currentReviewers.forEach(v => url.searchParams.append('reviewer', v));
    currentSprints.forEach(v => url.searchParams.append('sprint', v));
    currentFixVersions.forEach(v => url.searchParams.append('fixVersion', v));

    // Set other params
    if (currentSync !== "Show all") {
        url.searchParams.set('sync', currentSync);
    } else {
        url.searchParams.delete('sync');
    }

    if (currentReadyForReviewer) {
        url.searchParams.set('ready', 'true');
    } else {
        url.searchParams.delete('ready');
    }

    // Update URL without reloading the page
    window.history.pushState({}, '', url);
}

// Update filter restoration from URL
function restoreFiltersFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);

    // Get all values for multi-select filters (supports repeated params)
    currentAssignees = urlParams.getAll('assignee');
    currentReviewers = urlParams.getAll('reviewer');
    currentSprints = urlParams.getAll('sprint');
    currentFixVersions = urlParams.getAll('fixVersion');

    if (!currentSyncStatuses) {
        currentSync = "Show all"; // Not restored from URL because SYNC status is only loaded on demand
    }
    currentReadyForReviewer = false; // Not restored because it requires a fully displayed and updated pr tree

    // Update multi-select components with restored values
    const assigneeMultiSelect = getMultiSelect('assigneeSelect');
    const reviewerMultiSelect = getMultiSelect('reviewerSelect');
    const sprintMultiSelect = getMultiSelect('sprintSelect');
    const fixVersionMultiSelect = getMultiSelect('fixVersionSelect');

    if (assigneeMultiSelect) {
        assigneeMultiSelect.setSelectedValues(currentAssignees);
    }
    if (reviewerMultiSelect) {
        reviewerMultiSelect.setSelectedValues(currentReviewers);
    }
    if (sprintMultiSelect) {
        sprintMultiSelect.setSelectedValues(currentSprints);
    }
    if (fixVersionMultiSelect) {
        fixVersionMultiSelect.setSelectedValues(currentFixVersions);
    }

    // Update sync select and ready checkbox
    const syncSelect = document.getElementById('syncSelect');
    const readyCheck = document.getElementById('readyForReviewerCheck');

    if (syncSelect) syncSelect.value = currentSync;
    if (readyCheck) {
        readyCheck.checked = currentReadyForReviewer;
        readyCheck.disabled = currentReviewers.length === 0;
    }
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

function initializeReadyForReviewerFilter() {
    const readyCheck = document.getElementById('readyForReviewerCheck');
    if (readyCheck) {
        readyCheck.addEventListener('change', handleFilterChange);
        // Set initial state - disabled when no reviewers selected
        readyCheck.disabled = currentReviewers.length === 0;
        readyCheck.checked = currentReadyForReviewer;
    }
}

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        const projects = await response.json();
        const projectSelect = document.getElementById('projectSelect');
        projectSelect.innerHTML = '<option value="">Select a project</option>' +
            projects.map(project => `<option value="${project}">${project}</option>`).join('');
        projectSelect.addEventListener('change', handleProjectChange);

        // Check for project query parameter
        const urlParams = new URLSearchParams(window.location.search);
        const projectParam = urlParams.get('project');
        if (projectParam) {
            const projectOption = projectSelect.querySelector(`option[value="${projectParam}"]`);
            if (projectOption) {
                projectSelect.value = projectParam;
                // Pass true to indicate this is initial page load, not a manual switch
                await handleProjectChange({ target: { value: projectParam } }, true);
            }
        }
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

async function handleProjectChange(event, isInitialLoad = false) {
    const projectName = event.target.value;
    if (projectName) {
        currentProject = projectName;
        updateDocumentTitle({ project: currentProject, attentionCount: 0 });
        closeSidebarDrawer();

        // Only clear filters from URL when manually switching projects, not during initial page load
        if (!isInitialLoad) {
            const url = new URL(window.location);
            url.searchParams.delete('assignee');
            url.searchParams.delete('reviewer');
            url.searchParams.delete('sprint');
            url.searchParams.delete('fixVersion');
            url.searchParams.delete('sync');
            url.searchParams.delete('ready');
            window.history.pushState({}, '', url);

            // Clear multi-select state and UI
            currentAssignees = [];
            currentReviewers = [];
            currentSprints = [];
            currentFixVersions = [];
            currentSync = "Show all";
            currentReadyForReviewer = false;

            // Clear multi-select components
            const assigneeMultiSelect = getMultiSelect('assigneeSelect');
            const reviewerMultiSelect = getMultiSelect('reviewerSelect');
            const sprintMultiSelect = getMultiSelect('sprintSelect');
            const fixVersionMultiSelect = getMultiSelect('fixVersionSelect');

            // Pass false to prevent triggering handleFilterChange callbacks
            if (assigneeMultiSelect) assigneeMultiSelect.clearAll(false);
            if (reviewerMultiSelect) reviewerMultiSelect.clearAll(false);
            if (sprintMultiSelect) sprintMultiSelect.clearAll(false);
            if (fixVersionMultiSelect) fixVersionMultiSelect.clearAll(false);

            // Reset sync statuses and ready checkbox (SYNC data belongs to the previous project)
            currentSyncStatuses = null;
            syncLoadFailed = false;
            updateSyncControls();
            const readyCheck = document.getElementById('readyForReviewerCheck');
            if (readyCheck) {
                readyCheck.checked = false;
                readyCheck.disabled = true;
            }
        }

        showLoadingState();
        renderEverything(await fetchData());
        updateUrlWithFilters();

        // Start periodic checking
        startPeriodicChecking();
    } else {
        currentProject = null;
        currentSyncStatuses = null;
        syncLoadFailed = false;
        updateSyncControls();
        updateUrlWithFilters();
        updateDocumentTitle({ project: null, attentionCount: 0 });
        showEmptyState();

        // Stop periodic checking
        stopPeriodicChecking();
    }
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

function handleFilterChange() {
    // Get values from multi-select components
    const assigneeMultiSelect = getMultiSelect('assigneeSelect');
    const reviewerMultiSelect = getMultiSelect('reviewerSelect');
    const sprintMultiSelect = getMultiSelect('sprintSelect');
    const fixVersionMultiSelect = getMultiSelect('fixVersionSelect');

    currentAssignees = assigneeMultiSelect ? assigneeMultiSelect.getSelectedValues() : [];
    currentReviewers = reviewerMultiSelect ? reviewerMultiSelect.getSelectedValues() : [];
    currentSprints = sprintMultiSelect ? sprintMultiSelect.getSelectedValues() : [];
    currentFixVersions = fixVersionMultiSelect ? fixVersionMultiSelect.getSelectedValues() : [];

    // Get sync and ready values from regular form elements
    const syncSelect = document.getElementById("syncSelect");
    const readyCheck = document.getElementById("readyForReviewerCheck");

    currentSync = syncSelect ? syncSelect.value : "Show all";
    currentReadyForReviewer = readyCheck ? readyCheck.checked : false;

    // Enable/disable checkbox based on reviewer selection (disabled when no reviewers selected)
    if (readyCheck) {
        readyCheck.disabled = currentReviewers.length === 0;
        if (currentReviewers.length === 0) {
            readyCheck.checked = false;
            currentReadyForReviewer = false;
        }
    }

    filterBranches(currentAssignees, currentReviewers, currentSprints, currentFixVersions, currentSync, currentReadyForReviewer);
    updateUrlWithFilters();
}



function populateFilters(pullRequests) {
    const assigneeMultiSelect = getMultiSelect('assigneeSelect');
    const reviewerMultiSelect = getMultiSelect('reviewerSelect');
    const readyCheck = document.getElementById('readyForReviewerCheck');

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

    // Update checkbox state
    if (readyCheck) {
        readyCheck.disabled = currentReviewers.length === 0;
        readyCheck.checked = currentReadyForReviewer;
    }

    // Restore filter values and apply them
    restoreFiltersFromUrl();
    if (currentAssignees.length > 0 || currentReviewers.length > 0 ||
        currentSprints.length > 0 || currentFixVersions.length > 0 ||
        currentSync !== "Show all" || currentReadyForReviewer) {
        filterBranches(currentAssignees, currentReviewers, currentSprints, currentFixVersions, currentSync, currentReadyForReviewer);
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

function renderOrphanedIssues(issues) {
    if (!issues || issues.length === 0) {
        return '';
    }

    const issuesHtml = issues.map(issue => `
        <div class="orphaned-issue">
            <div class="orphaned-issue-header">
                ${issue.fields.priority ? `
                    <img 
                        src="${issue.fields.priority.iconUrl}" 
                        alt="${issue.fields.priority.name}"
                        class="orphaned-issue-priority"
                        title="${issue.fields.priority.name}"
                    />
                ` : ''}
                <a 
                    href="https://${issue.jiraSiteName}.atlassian.net/browse/${issue.key}"
                    target="_blank"
                    class="orphaned-issue-key"
                >
                    ${issue.key}
                </a>
            </div>
            <p class="orphaned-issue-summary">${issue.fields.summary}</p>
            <div class="orphaned-issue-status">
                Status: ${issue.fields.status.name}
            </div>
        </div>
    `).join('');

    return `
        <div class="orphaned-issues">
            <div class="orphaned-issues-header">
                <h2 class="orphaned-issues-title">
                    <i class="fas fa-exclamation-circle"></i>
                    JIRA Issues In Review without Pull Requests (${issues.length})
                </h2>
            </div>
            <div class="orphaned-issues-content">
                ${issuesHtml}
            </div>
        </div>
    `;
}


function renderEverything(apiResult) {
    if (!currentProject) {
        return;
    }
    if (!apiResult) {
        currentApiResult = null;
        showErrorState();
        return;
    }

    // Capture current toggle states before re-rendering
    const toggleStates = captureToggleStates();

    currentApiResult = apiResult;
    initializeFilter(currentApiResult);
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

function renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName) {
    // Group pull requests by repository
    const pullRequestsByRepo = pullRequests.reduce((acc, pr) => {
        const repoName = pr.source.repository.name;
        if (!acc[repoName]) {
            acc[repoName] = [];
        }
        acc[repoName].push(pr);
        return acc;
    }, {});

    let html = '';
    for (const [repoName, repoPullRequests] of Object.entries(pullRequestsByRepo)) {
        const pullRequestCount = repoPullRequests.length;
        html += `
            <div class="repository">
                <div class="repository-header" onclick="toggleRepository(this)">
                    <button class="toggle-button">
                        <i class="fas fa-chevron-down"></i>
                        <i class="fas fa-chevron-right"></i>
                    </button>
                    <h2 class="repository-name">${repoName}</h2>
                    <div class="repo-pr-counter" title="${pullRequestCount} pull request${pullRequestCount !== 1 ? 's' : ''}">
                        ${pullRequestCount}
                    </div>
                </div>
                <div class="repository-content">
                    ${renderPullRequests(repoPullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName)}
                </div>
            </div>
        `;
    }
    return html;
}

function findRootBranches(pullRequests) {
    const destinationBranches = new Set(pullRequests.map(pullRequest => pullRequest.destination.branch.name));
    const sourceBranches = new Set(pullRequests.map(pullRequest => pullRequest.source.branch.name));
    return Array.from(destinationBranches).filter(branch => !sourceBranches.has(branch));
}

// Function to calculate total pull requests in a branch including all descendants
function calculateTotalPullRequests(pullRequests, pullRequestsByDestination) {
    let total = pullRequests.length;
    for (const pullRequest of pullRequests) {
        const sourceBranch = pullRequest.source.branch.name;
        if (pullRequestsByDestination.has(sourceBranch)) {
            total += calculateTotalPullRequests(pullRequestsByDestination.get(sourceBranch), pullRequestsByDestination);
        }
    }
    return total;
}

// Helper function to get branch URL from Bitbucket
function getBranchUrl(repoName, branchName, pullRequest) {
    // Use the repository links from any pull request to get the base URL
    const baseUrl = pullRequest.source.repository.links.html.href;
    return `${baseUrl}/branch/${encodeURIComponent(branchName)}`;
}

// Function to recursively render the pull-requests
function renderPullRequests(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName, level = 0) {
    let html = '';
    if (level === 0) {
        const rootBranches = findRootBranches(pullRequests);
        for(const rootBranch of rootBranches) {
            const rootPullRequests = pullRequests.filter(pullRequest => rootBranch === pullRequest.destination.branch.name);
            // Sort by updated_on date in descending order (most recent first)
            rootPullRequests.sort((a, b) => new Date(b.updated_on) - new Date(a.updated_on));
            const totalPullRequestCount = calculateTotalPullRequests(rootPullRequests, pullRequestsByDestination);

            // Get the branch URL using the first pull request's repository information
            const branchUrl = getBranchUrl(rootPullRequests[0].source.repository.name, rootBranch, rootPullRequests[0]);

            html += `
                <div class="root-branch">
                    <div class="root-branch-header" onclick="toggleRootBranch(this)">
                        <button class="toggle-button">
                            <i class="fas fa-chevron-down"></i>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                        <h3 class="root-branch-name">
                            <a href="${branchUrl}" target="_blank" onclick="event.stopPropagation();" class="root-branch-link">
                                ${rootBranch}
                                <i class="fas fa-external-link-alt external-link-icon"></i>
                            </a>
                        </h3>
                        <div class="branch-pr-counter" title="${totalPullRequestCount} total pull request${totalPullRequestCount !== 1 ? 's' : ''} (including all descendants)">
                            ${totalPullRequestCount}
                        </div>
                    </div>
                    <div class="root-branch-content">
            `;
            rootPullRequests.forEach(rootPullRequest => {
                html += renderPullRequest(rootPullRequest, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName, 1);
            });
            html += `
                    </div>
                </div>
            `;
        }
    } else {
        // Sort by updated_on date in descending order (most recent first)
        pullRequests.sort((a, b) => new Date(b.updated_on) - new Date(a.updated_on));
        pullRequests.forEach(pullRequest => {
            html += renderPullRequest(pullRequest, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName, level+1);
        });
    }
    return html;
}

function calculateDescendants(pullRequest, pullRequestsByDestination) {
    let count = 0;
    const sourceBranch = pullRequest.source.branch.name;
    if (pullRequestsByDestination.has(sourceBranch)) {
        const children = pullRequestsByDestination.get(sourceBranch);
        count += children.length;
        for (const child of children) {
            count += calculateDescendants(child, pullRequestsByDestination);
        }
    }
    return count;
}

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

    // Restore sprint values from URL after populating options
    if (currentSprints.length > 0) {
        // Filter out any sprint IDs that don't exist in the options
        const validSprintIds = sprintOptions.map(opt => opt.value);
        currentSprints = currentSprints.filter(id => validSprintIds.includes(id));
        sprintMultiSelect.setSelectedValues(currentSprints);
    }
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

    // Restore fixVersion values from URL after populating options
    if (currentFixVersions.length > 0) {
        // Filter out any fixVersion IDs that don't exist in the options
        const validFixVersionIds = fixVersionOptions.map(opt => opt.value);
        currentFixVersions = currentFixVersions.filter(id => validFixVersionIds.includes(id));
        fixVersionMultiSelect.setSelectedValues(currentFixVersions);
    }
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
    filterBranches(currentAssignees, currentReviewers, currentSprints, currentFixVersions, currentSync, currentReadyForReviewer);
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

// Function to recursively render a pull-request
function renderPullRequest(pullRequest, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName, level = 0) {
    let approvedDetails = "";
    let requestedChangesDetails = "";
    let notYetDecidedDetails = "";
    let hasOtherParticipants = false;
    let allOtherParticipantsApproved = true;

    for (const participant of pullRequest.participants) {
        // Exclude author and Rovo Dev agent
        if (participant.user.account_id !== pullRequest.author.account_id &&
            participant.user.display_name !== 'Rovo Dev') {
            hasOtherParticipants = true;
            if (participant.approved) {
                approvedDetails += renderParticipant(participant.user, "approved");
            } else if (participant.state === "changes_requested") {
                requestedChangesDetails += renderParticipant(participant.user, "requestedChanges");
                allOtherParticipantsApproved = false;
            } else {
                notYetDecidedDetails += renderParticipant(participant.user, "toReview");
                allOtherParticipantsApproved = false;
            }
        }
    }

    let noOtherParticipantsAlert = !hasOtherParticipants ?
        `<li><i class="fas fa-exclamation-triangle red" title="Pull request has no other participants"></i> Pull request has no other participants</li>` : '';

    const jiraIssues = jiraIssuesMap["" + pullRequest.id];

    let statusClass = "";
    let alertsHtml = "";
    let jiraIssuesHtml = "";
    if (jiraIssues) {
        const jiraIssuesDetailsForPullRequest = jiraIssues.map(issue => jiraIssuesDetails.find(details => details.key === issue)).filter(issueDetails => issueDetails);
        const jiraIssuesStatuses = jiraIssuesDetailsForPullRequest.map(issueDetails => issueDetails.fields.status.name);

        if (jiraIssuesStatuses.includes("In Progress")) {
            statusClass = "status-in-progress";
        } else if (jiraIssuesStatuses.includes("In Review")) {
            statusClass = hasOtherParticipants && allOtherParticipantsApproved ? "status-in-review-all-approved" : "status-in-review";
        } else if (jiraIssuesStatuses.every(status => status === "Resolved" || status === "Closed")) {
            statusClass = "status-resolved";
        }

        const uniqueJiraIssuesStatuses = new Set(jiraIssuesStatuses);
        let sameStatusIcon = uniqueJiraIssuesStatuses.size > 1 ?
            `<li><i class="fas fa-exclamation-triangle red" title="JIRA issues have different statuses"></i> JIRA issues have different statuses</li>` : '';

        let resolvedIssuesAlert = '';

        jiraIssuesHtml = jiraIssuesDetailsForPullRequest.map(issueDetails => {
            const priority = issueDetails.fields.priority;
            const priorityHtml = priority ?
                `<img src="${priority.iconUrl}" alt="${priority.name}" class="jira-priority-icon" title="${priority.name}">` : '';

            return `<li>${priorityHtml}<a href="https://${jiraSiteName}.atlassian.net/browse/${issueDetails.key}" target="_blank"
                       data-issue-key="${issueDetails.key}" 
                       data-issue-summary="${issueDetails.fields.summary}"
                       class="jira-issue-link">
                       ${issueDetails.key} (${issueDetails.fields.status.name})
                    </a></li>`;
        }).join('');

        if (sameStatusIcon || noOtherParticipantsAlert || resolvedIssuesAlert) {
            alertsHtml = `
                <div class="warnings">
                    <ul>
                        ${sameStatusIcon}
                        ${noOtherParticipantsAlert}
                        ${resolvedIssuesAlert}
                    </ul>
                </div>
            `;
        }
    }

    const sourceBranch = pullRequest.source.branch.name;
    const hasChildren = pullRequestsByDestination.has(sourceBranch);
    const descendantCount = calculateDescendants(pullRequest, pullRequestsByDestination);
    const isRootPullRequest = level === 1;

    const toggleButton = hasChildren ? `
        <button class="toggle-button" onclick="toggleChildren(this)">
            <i class="fas fa-chevron-down"></i>
            <i class="fas fa-chevron-right"></i>
        </button>
    ` : '';

    // Combine both counters in a container
    const spec = pullRequest.destination.commit?.hash + '..' + pullRequest.source.commit?.hash;
    const countersHtml = `
        <div class="counters-container">
            ${(isRootPullRequest || hasChildren) ? `
                <div class="child-counter ${isRootPullRequest ? 'visible' : ''}" 
                     title="${descendantCount} descendant pull request${descendantCount !== 1 ? 's' : ''}">
                    ${descendantCount}
                </div>
            ` : ''}
            <div class="conflicts-counter"
                 data-id="conflicts_${pullRequest.id}"
                 data-repo-name="${pullRequest.source.repository.name}"
                 data-spec="${spec}">
            </div>
        </div>
    `;

    const renderedTitle = pullRequest.rendered.title.html;
    const renderedDescription = pullRequest.rendered.description.html || 'No description provided.';

    let html = `
        <div class="pull-request ${statusClass}${isRootPullRequest ? ' pull-request-root' : ''}" data-id="${pullRequest.id}">
            ${countersHtml}
            <div class="pull-request-content">
                <div class="pull-request-main">
                    <div class="pull-request-info">
                        <div class="pull-request-header">
                            ${toggleButton}
                            <a href="${pullRequest.links.html.href}" target="_blank" 
                               class="pull-request-link"
                               data-rendered-title="${encodeURIComponent(renderedTitle)}"
                               data-rendered-description="${encodeURIComponent(renderedDescription)}">
                               ${pullRequest.title}
                            </a>
                        </div>
                    </div>
                    <div class="pull-request-issues">
                        <ul class="jira-issues">
                            ${jiraIssuesHtml}
                        </ul>
                    </div>
                </div>
                <div class="pull-request-details">
                    <div class="participants">
                        ${renderParticipant(pullRequest.author, "author")} 
                        <span class="created-date">${pullRequest.created_on.substring(0,10)}</span>
                        ${approvedDetails} ${requestedChangesDetails} ${notYetDecidedDetails}
                        ${pullRequest.commitsBehind !== null && pullRequest.commitsBehind !== undefined ?
                            `<span class="commit-badge commit-badge-behind" title="Number of commits behind destination branch">
                                <i class="fas fa-code-branch"></i>${pullRequest.commitsBehind === 100 ? 'at least ': ''}-${pullRequest.commitsBehind}
                            </span>`
                            : ''}
                        ${pullRequest.commitsAhead ?
                            `<span class="commit-badge commit-badge-ahead" title="Number of commits ahead of destination branch">
                                <i class="fas fa-code-branch"></i>${pullRequest.commitsAhead === 100 ? 'at least ': ''}+${pullRequest.commitsAhead}
                            </span>`
                            : ''}
                    </div>
                    ${alertsHtml}
                </div>
            </div>
        </div>
    `;
    if (hasChildren) {
        html += `<div class="children">${renderPullRequests(pullRequestsByDestination.get(sourceBranch), jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName, level + 1)}</div>`;
    }
    return html;
}

// Function to render participant information
function renderParticipant(participant, status) {
    let iconClass = "";
    if (status === "approved") {
        iconClass = "fa-check-circle";
    } else if (status === "requestedChanges") {
        iconClass = "fa-times-circle";
    } else if (status === "toReview") {
        iconClass = "fa-question-circle";
    } else if (status === "author") {
        iconClass = "fa-user";
    } else {
        console.log(`${participant.display_name} participant's status is invalid: ${status}`);
    }

    return `
        <span class="image-container" data-author="${participant.display_name}" data-review-status="${status}">
            <img src="${participant.links.avatar.href}" alt="${participant.display_name}">
            <i class="fas ${iconClass} icon"></i>
        </span>
    `;
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

function initializePopovers() {
    let popoverTimeout;
    let currentLink = null;
    const popover = document.createElement('div');
    popover.className = 'popover';
    document.body.appendChild(popover);

    function showPopover(link) {
        if (link.classList.contains('jira-issue-link')) {
            const key = link.dataset.issueKey;
            const summary = link.dataset.issueSummary;
            popover.className = 'jira-issue-popover';
            popover.innerHTML = `
                <div class="jira-issue-popover-key">${key}</div>
                <div class="jira-issue-popover-summary">${summary}</div>
            `;
        } else {
            const title = decodeURIComponent(link.dataset.renderedTitle);
            const description = decodeURIComponent(link.dataset.renderedDescription);
            popover.className = 'pull-request-popover';
            popover.innerHTML = `
                <div class="pull-request-popover-title">${title}</div>
                <div class="pull-request-popover-description">${description}</div>
            `;
        }

        // The popover is fixed: viewport coordinates, kept inside the viewport
        popover.style.display = 'block';
        const rect = link.getBoundingClientRect();
        const margin = 8;
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - popover.offsetWidth - margin));
        const fitsBelow = rect.bottom + popover.offsetHeight + margin <= window.innerHeight;
        const top = fitsBelow ? rect.bottom : Math.max(margin, rect.top - popover.offsetHeight);
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }

    function hidePopover() {
        popover.style.display = 'none';
        currentLink = null;
    }

    document.addEventListener('mouseover', function(event) {
        const link = event.target.closest('.jira-issue-link, .pull-request-link');

        if (link) {
            clearTimeout(popoverTimeout);
            currentLink = link;
            popoverTimeout = setTimeout(() => showPopover(link), 500);
        } else if (event.target === popover || popover.contains(event.target)) {
            clearTimeout(popoverTimeout);
        } else if (currentLink) {
            clearTimeout(popoverTimeout);
            popoverTimeout = setTimeout(hidePopover, 300);
        }
    });

    document.addEventListener('mouseout', function(event) {
        const link = event.target.closest('.jira-issue-link, .pull-request-link');

        if (link) {
            clearTimeout(popoverTimeout);
            popoverTimeout = setTimeout(hidePopover, 300);
        }
    });

    // Add this event listener to keep the popover visible when hovering over it
    popover.addEventListener('mouseover', function() {
        clearTimeout(popoverTimeout);
    });

    popover.addEventListener('mouseout', function() {
        clearTimeout(popoverTimeout);
        popoverTimeout = setTimeout(hidePopover, 300);
    });

    // A popover left open while the tree scrolls would float away from its link
    document.getElementById('main').addEventListener('scroll', hidePopover, { passive: true });
}

// Initialize multi-select components
function initializeMultiSelects() {
    createMultiSelect('sprintSelect', { onChange: handleFilterChange });
    createMultiSelect('fixVersionSelect', { onChange: handleFilterChange });
    createMultiSelect('assigneeSelect', { onChange: handleFilterChange });
    createMultiSelect('reviewerSelect', { onChange: handleFilterChange });
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    initializeAppShell();
    initializeMultiSelects();
    showEmptyState();
    loadProjects();
    fetchAndDisplayVersion();
    initializePopovers();
    initializeReadyForReviewerFilter();
    initializeSyncControls();
});

// Export functions that need to be accessible globally
window.toggleChildren = toggleChildren;
window.toggleRootBranch = toggleRootBranch;
window.toggleRepository = toggleRepository;