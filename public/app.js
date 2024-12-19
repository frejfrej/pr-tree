import { initializeFilter, filterBranches } from './app-filter.js';

let currentProject = null;
let currentSprint = "Show all";
let currentAuthor = "Show all";
let currentReviewer = "Show all";
let currentSync = "Show all";
let currentReadyForReviewer = false;
let currentApiResult = null;
let reloadInterval = 100;

// Update URL parameters handling
function updateUrlWithFilters() {
    const url = new URL(window.location);

    // Only set parameters if they're different from default
    if (currentProject) url.searchParams.set('project', currentProject);
    if (currentAuthor !== "Show all") url.searchParams.set('author', currentAuthor);
    if (currentReviewer !== "Show all") url.searchParams.set('reviewer', currentReviewer);
    if (currentSprint !== "Show all") url.searchParams.set('sprint', currentSprint);
    if (currentSync !== "Show all") url.searchParams.set('sync', currentSync);
    if (currentReadyForReviewer) url.searchParams.set('ready', 'true');

    // Remove parameters if they're set to default
    if (currentAuthor === "Show all") url.searchParams.delete('author');
    if (currentReviewer === "Show all") url.searchParams.delete('reviewer');
    if (currentSprint === "Show all") url.searchParams.delete('sprint');
    if (currentSync === "Show all") url.searchParams.delete('sync');
    if (!currentReadyForReviewer) url.searchParams.delete('ready');
    if (!currentProject) url.searchParams.delete('project');

    // Update URL without reloading the page
    window.history.pushState({}, '', url);
}

// Update filter restoration from URL
function restoreFiltersFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    currentAuthor = urlParams.get('author') || "Show all";
    currentReviewer = urlParams.get('reviewer') || "Show all";
    currentSprint = urlParams.get('sprint') || "Show all";
    currentSync = "Show all"; // Not restored because it's calculated asynchronously
    currentReadyForReviewer = false; // Not restored because it requires a fully displayed and updated pr tree

    // Update filter elements with restored values
    const authorSelect = document.getElementById('authorSelect');
    const reviewerSelect = document.getElementById('reviewerSelect');
    const sprintSelect = document.getElementById('sprintSelect');
    const syncSelect = document.getElementById('syncSelect');
    const readyCheck = document.getElementById('readyForReviewerCheck');

    if (authorSelect) authorSelect.value = currentAuthor;
    if (reviewerSelect) reviewerSelect.value = currentReviewer;
    if (sprintSelect) sprintSelect.value = currentSprint;
    if (syncSelect) syncSelect.value = currentSync;
    if (readyCheck) {
        readyCheck.checked = currentReadyForReviewer;
        readyCheck.disabled = currentReviewer === "Show all";
    }
}

function initializeReadyForReviewerFilter() {
    const readyCheck = document.getElementById('readyForReviewerCheck');
    if (readyCheck) {
        readyCheck.addEventListener('change', handleFilterChange);
        // Set initial state
        readyCheck.disabled = true;
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
                await handleProjectChange({ target: { value: projectParam } });
            }
        }
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

async function handleProjectChange(event) {
    const projectName = event.target.value;
    if (projectName) {
        currentProject = projectName;
        showLoading();
        await renderEverything();
        hideLoading();
        updateUrlWithFilters();

        // Start periodic checking
        startPeriodicChecking();
    } else {
        document.getElementById('pull-requests').innerHTML = 'Please select a project';
        currentProject = null;
        updateUrlWithFilters();

        // Stop periodic checking
        stopPeriodicChecking();
    }
}

function showLoading() {
    document.getElementById('pull-requests').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('pull-requests').style.display = 'block';
}

function handleFilterChange() {
    let author = document.getElementById("authorSelect").value;
    let reviewer = document.getElementById("reviewerSelect").value;
    let sprint = document.getElementById("sprintSelect").value;
    let sync = document.getElementById("syncSelect").value;
    let readyCheck = document.getElementById("readyForReviewerCheck");

    currentAuthor = author;
    currentReviewer = reviewer;
    currentSprint = sprint;
    currentSync = sync;
    currentReadyForReviewer = readyCheck.checked;

    // Enable/disable checkbox based on reviewer selection
    readyCheck.disabled = reviewer === "Show all";
    if (reviewer === "Show all") {
        readyCheck.checked = false;
        currentReadyForReviewer = false;
    }

    filterBranches(currentAuthor, currentReviewer, currentSprint, currentSync, currentReadyForReviewer);
    updateUrlWithFilters();
}


function toggleChildren(button) {
    const pullRequest = button.closest('.pull-request');
    const children = pullRequest.nextElementSibling;
    if (children && children.classList.contains('children')) {
        pullRequest.classList.toggle('collapsed');
        children.style.display = children.style.display === 'none' ? 'block' : 'none';

        // Toggle visibility of child counter
        const childCounter = pullRequest.querySelector('.child-counter');
        if (childCounter) {
            childCounter.classList.toggle('visible');
        }
    }
}


function toggleRootBranch(button) {
    const rootBranch = button.closest('.root-branch');
    rootBranch.classList.toggle('collapsed');
}

function toggleRepository(button) {
    const repository = button.closest('.repository');
    repository.classList.toggle('collapsed');
    const icon = button.querySelector('i');
    icon.classList.toggle('fa-chevron-down');
    icon.classList.toggle('fa-chevron-right');
}

function populateFilters(pullRequests) {
    const authorSelect = document.getElementById('authorSelect');
    const reviewerSelect = document.getElementById('reviewerSelect');
    const syncSelect = document.getElementById('syncSelect');
    const readyCheck = document.getElementById('readyForReviewerCheck');

    // Extract unique authors and sort them alphabetically
    const authors = [...new Set(pullRequests.map(pr => pr.author.display_name))].sort();
    authorSelect.innerHTML = `<option value="Show all">Show all</option>${authors.map(author => `<option value="${author}">${author}</option>`).join('')}`;

    // Extract unique reviewers and sort them alphabetically
    const reviewers = [...new Set(pullRequests.flatMap(pr => pr.participants.map(p => p.user.uuid != pr.author.uuid && p.user.display_name)))].sort();
    reviewerSelect.innerHTML = `<option value="Show all">Show all</option>${reviewers.map(reviewer => `<option value="${reviewer}">${reviewer}</option>`).join('')}`;

    // Generate sync filter options
    syncSelect.innerHTML = `
        <option value="Show all">Show all</option>
        <option value="requested">SYNC requested</option>
        <option value="OK">SYNC ok</option>
    `;

    // Add event listeners
    authorSelect.addEventListener('change', handleFilterChange);
    reviewerSelect.addEventListener('change', handleFilterChange);
    syncSelect.addEventListener('change', handleFilterChange);

    // Update checkbox state
    if (readyCheck) {
        readyCheck.disabled = currentReviewer === "Show all";
        readyCheck.checked = currentReadyForReviewer;
    }

    // Restore filter values and apply them
    restoreFiltersFromUrl();
    if (currentAuthor !== "Show all" || currentReviewer !== "Show all" ||
        currentSprint !== "Show all" || currentSync !== "Show all" ||
        currentReadyForReviewer) {
        filterBranches(currentAuthor, currentReviewer, currentSprint, currentSync, currentReadyForReviewer);
    }
}

async function renderEverything() {
    if (!currentProject) {
        return;
    }
    currentApiResult = await fetchData();
    initializeFilter(currentApiResult);
    const container = document.getElementById('pull-requests');
    container.innerHTML = renderRepositories(currentApiResult.pullRequests, currentApiResult.jiraIssuesMap, currentApiResult.jiraIssuesDetails, new Map(Object.entries(currentApiResult.pullRequestsByDestination)), currentApiResult.jiraSiteName);
    populateFilters(currentApiResult.pullRequests);
    populateSprintFilter(currentApiResult.sprints);
    updateAllConflictsCounters();
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
        const newData = await fetchData();
        if (newData && newData.dataHash !== currentApiResult.dataHash) {
            console.log('Data has changed. Updating...');
            await renderEverything();
            updateAllConflictsCounters();
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    }
}

function startPeriodicChecking() {
    if (reloadInterval) {
        clearInterval(reloadInterval);
    }
    reloadInterval = setInterval(checkForUpdates, 60000); // Check every minute
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
            startPeriodicChecking();
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
                    </button>
                    <h1>${repoName}</h1>
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
            rootPullRequests.sort((a, b) => a.title.localeCompare(b.title));
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
                        <h2>
                            <a href="${branchUrl}" target="_blank" onclick="event.stopPropagation();" 
                               style="color: inherit; text-decoration: none;">
                                ${rootBranch}
                                <i class="fas fa-external-link-alt" style="font-size: 0.8em; margin-left: 5px;"></i>
                            </a>
                        </h2>
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
        pullRequests.sort((a, b) => a.title.localeCompare(b.title));
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
    const sprintSelect = document.getElementById('sprintSelect');

    // Sort sprints by name
    const sortedSprints = sprints.sort((a, b) => a.name.localeCompare(b.name));

    sprintSelect.innerHTML = '<option value="Show all">Show all</option>' +
        sortedSprints.map(sprint => `<option value="${sprint.id}">${sprint.name}</option>`).join('');
    sprintSelect.addEventListener('change', handleFilterChange);

    // Restore sprint value from URL after populating options
    if (currentSprint !== "Show all") {
        sprintSelect.value = currentSprint;
    }
}


async function updateConflictsCounter(pullRequestElement) {
    const conflictsCounter = pullRequestElement.querySelector('.conflicts-counter');
    if (!conflictsCounter) return;

    const { repoName, spec } = conflictsCounter.dataset;
    // no need to go fetch the sync status if the spec is invalid
    let validSpec = null;
    if (!spec.includes('undefined')) {
        validSpec = spec;
    }

    const result = validSpec ? await fetchConflicts(repoName, validSpec) : null;

    if (result) {
        if (result.conflicts) {
            conflictsCounter.innerHTML = `
            <div class="conflicts-count" title="Conflicts found">
                SYNC
            </div>
        `;
        } else {
            // display nothing if there are no conflicts
            conflictsCounter.innerHTML = ``;
        }
    } else {
        if (spec !== validSpec) {
            conflictsCounter.innerHTML = `<div class="conflicts-error" title="Invalid spec provided ${spec}">!</div>`;
        } else {
            conflictsCounter.innerHTML = '<div class="conflicts-error" title="Error fetching conflicts">?</div>';
        }
    }
}

function updateAllConflictsCounters() {
    const pullRequests = document.querySelectorAll('.pull-request');
    pullRequests.forEach(updateConflictsCounter);
}

async function fetchConflicts(repoName, spec) {
    try {
        const response = await fetch(`/api/pull-request-conflicts/${repoName}/${spec}`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching conflicts for', spec, 'with :', error);
        return null;
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
        if (participant.user.account_id !== pullRequest.author.account_id) {
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

    const childCounterHtml = (isRootPullRequest || hasChildren) ? `
        <div class="child-counter ${isRootPullRequest ? 'visible' : ''}" title="${descendantCount} descendant pull request${descendantCount !== 1 ? 's' : ''}">
            ${descendantCount}
        </div>
    ` : '';

    // we don't really care if a commit hash is missing here => the server will complain later
    const spec = pullRequest.destination.commit?.hash + '..' + pullRequest.source.commit?.hash;
    const conflictsCounter = `
        <div class="conflicts-counter" data-id="conflicts_${pullRequest.id}" data-repo-name="${pullRequest.source.repository.name}" data-spec="${spec}">
            <div class="conflicts-spinner"></div>
        </div>
    `;

    const renderedTitle = pullRequest.rendered.title.html;
    const renderedDescription = pullRequest.rendered.description.html || 'No description provided.';

    let html = `
        <div class="pull-request ${statusClass}" data-id="${pullRequest.id}">
            ${childCounterHtml}${conflictsCounter}
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

function initializeHelpModal() {
    const modal = document.getElementById("helpModal");
    const btn = document.getElementById("helpButton");
    const span = document.getElementsByClassName("close")[0];
    const helpContent = document.getElementById("helpContent");

    btn.onclick = function() {
        modal.style.display = "block";
        if (!helpContent.innerHTML) {
            fetchAndRenderReadme();
        }
    }

    span.onclick = function() {
        modal.style.display = "none";
    }

    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }
}

async function fetchAndRenderReadme() {
    const helpContent = document.getElementById("helpContent");
    helpContent.innerHTML = 'Loading...';

    try {
        const response = await fetch('README.md');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const markdown = await response.text();
        const html = marked.parse(markdown);
        helpContent.innerHTML = html;
    } catch (error) {
        console.error('Error fetching README:', error);
        helpContent.innerHTML = 'Error loading help content. Please try again later.';
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
        const dateElement = document.getElementById('versionDate');
        const authorElement = document.getElementById('authorInfo');
        const licenseElement = document.getElementById('licenseInfo');

        if (versionElement && dateElement && authorElement && licenseElement) {
            versionElement.textContent = `v${data.version}`;
            dateElement.textContent = `Released: ${data.releaseDate}`;
            authorElement.textContent = `Created by ${data.author}`;
            licenseElement.textContent = `${data.license}`;

            versionElement.style.animation = 'versionPulse 0.5s ease';
            setTimeout(() => {
                versionElement.style.animation = '';
            }, 500);
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
        const rect = link.getBoundingClientRect();

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

        popover.style.left = `${rect.left}px`;
        popover.style.top = `${rect.bottom + window.scrollY}px`;
        popover.style.display = 'block';
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
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    loadProjects();
    initializeHelpModal();
    fetchAndDisplayVersion();
    initializePopovers();
    initializeReadyForReviewerFilter();

    // Add event listener for the footer help button
    const footerHelpButton = document.querySelector('.footer-link#helpButton');
    if (footerHelpButton) {
        footerHelpButton.addEventListener('click', function(e) {
            e.preventDefault();
            const helpModal = document.getElementById('helpModal');
            if (helpModal) {
                helpModal.style.display = 'block';
                if (!document.getElementById('helpContent').innerHTML) {
                    fetchAndRenderReadme();
                }
            }
        });
    }
});

// Export functions that need to be accessible globally
window.toggleChildren = toggleChildren;
window.toggleRootBranch = toggleRootBranch;
window.toggleRepository = toggleRepository;