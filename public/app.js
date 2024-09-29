import { initializeFilter, filterPullRequests } from './app-filter.js';

let previousAuthor = "Show all";
let previousReviewer = "Show all";
let currentProject = null;
let currentApiResult = null;
let reloadInterval = 100;

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

        // Start periodic checking
        startPeriodicChecking();

        // Update URL with the selected project
        const url = new URL(window.location);
        url.searchParams.set('project', projectName);
        window.history.pushState({}, '', url);
    } else {
        document.getElementById('pull-requests').innerHTML = 'Please select a project';

        // Remove project from URL if none selected
        const url = new URL(window.location);
        url.searchParams.delete('project');
        window.history.pushState({}, '', url);

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

    if (reviewer !== previousReviewer) {
        document.getElementById("authorSelect").value = "Show all";
        previousReviewer = reviewer;
        author = "Show all";
        previousAuthor = author;
    }
    if (author !== previousAuthor) {
        document.getElementById("reviewerSelect").value = "Show all";
        previousAuthor = author;
        reviewer = "Show all";
        previousReviewer = reviewer;
    }

    filterPullRequests(author, reviewer);
}

function toggleChildren(button) {
    const pullRequest = button.closest('.pull-request');
    const children = pullRequest.nextElementSibling;
    if (children && children.classList.contains('children')) {
        pullRequest.classList.toggle('collapsed');
        children.style.display = children.style.display === 'none' ? 'block' : 'none';
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

    // Extract unique authors and sort them alphabetically
    const authors = [...new Set(pullRequests.map(pr => pr.author.display_name))].sort();
    // Generate the dropdown options
    authorSelect.innerHTML = `<option value="Show all">Show all</option>${authors.map(author => `<option value="${author}">${author}</option>`).join('')}`;

    // Extract unique reviewers and sort them alphabetically
    const reviewers = [...new Set(pullRequests.flatMap(pr => pr.participants.map(p => p.user.display_name)))].sort();
    // Generate the dropdown options
    reviewerSelect.innerHTML = `<option value="Show all">Show all</option>${reviewers.map(reviewer => `<option value="${reviewer}">${reviewer}</option>`).join('')}`;

    // Add event listeners
    authorSelect.addEventListener('change', handleFilterChange);
    reviewerSelect.addEventListener('change', handleFilterChange);
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
        html += `
            <div class="repository">
                <div class="repository-header" onclick="toggleRepository(this)">
                    <button class="toggle-button">
                        <i class="fas fa-chevron-down"></i>
                    </button>
                    <h1>${repoName}</h1>
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

// Function to recursively render the pull-requests
function renderPullRequests(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName, level = 0) {
    let html = '';
    if (level === 0) {
        const destinationBranches = findRootBranches(pullRequests);

        for(const destinationBranch of destinationBranches) {
            const rootPullRequests = pullRequests.filter(pullRequest => destinationBranch === pullRequest.destination.branch.name);
            // Sort root pull requests by title
            rootPullRequests.sort((a, b) => a.title.localeCompare(b.title));
            html += `
                <div class="root-branch">
                    <div class="root-branch-header" onclick="toggleRootBranch(this)">
                        <button class="toggle-button">
                            <i class="fas fa-chevron-down"></i>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                        <h2>${destinationBranch}</h2>
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
        // Sort child pull requests by title
        pullRequests.sort((a, b) => a.title.localeCompare(b.title));
        pullRequests.forEach(pullRequest => {
            html += renderPullRequest(pullRequest, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName, level+1);
        });
    }
    return html;
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

    let allOtherParticipantsApprovedIcon = hasOtherParticipants && allOtherParticipantsApproved ?
        `<div class="all-approved-icon"><i class="fas fa-check-circle" title="All other participants approved"></i></div>` : '';

    let noOtherParticipantsAlert = !hasOtherParticipants ?
        `<li><i class="fas fa-exclamation-triangle red" title="Pull request has no other participants"></i> Pull request has no other participants</li>` : '';

    const jiraIssues = jiraIssuesMap[""+ pullRequest.id];

    let statusClass = "";
    let alertsHtml = "";
    let jiraIssuesHtml = "";
    if (jiraIssues) {
        const jiraIssuesDetailsForPullRequest = jiraIssues.map(issue => jiraIssuesDetails.find(details => details.key === issue)).filter(issueDetails => issueDetails);
        const jiraIssuesStatuses = jiraIssuesDetailsForPullRequest.map(issueDetails => issueDetails.fields.status.name);

        if (jiraIssuesStatuses.includes("In Progress")) {
            statusClass = "status-in-progress";
        } else if (jiraIssuesStatuses.includes("In Review")) {
            statusClass = "status-in-review";
        } else if (jiraIssuesStatuses.every(status => status === "Resolved" || status === "Closed")) {
            statusClass = "status-resolved";
        }

        const uniqueJiraIssuesStatuses = new Set(jiraIssuesStatuses);
        let sameStatusIcon = uniqueJiraIssuesStatuses.size > 1 ?
            `<li><i class="fas fa-exclamation-triangle red" title="JIRA issues have different statuses"></i> JIRA issues have different statuses</li>` : '';

        let resolvedIssuesAlert = '';
        jiraIssuesHtml = jiraIssuesDetailsForPullRequest.map(issueDetails => {
            if (issueDetails.fields.status.name === "Resolved" || issueDetails.fields.status.name === "Closed") {
                resolvedIssuesAlert += `<li><i class="fas fa-exclamation-triangle red" title="JIRA issue is resolved"></i> JIRA issue ${issueDetails.key} is resolved</li>`;
            }
            return `<li><a href="https://${jiraSiteName}.atlassian.net/browse/${issueDetails.key}" target="_blank" title="${issueDetails.fields.summary}">${issueDetails.key} (${issueDetails.fields.status.name})</a></li>`;
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

    const toggleButton = hasChildren ? `
        <button class="toggle-button" onclick="toggleChildren(this)">
            <i class="fas fa-chevron-down"></i>
            <i class="fas fa-chevron-right"></i>
        </button>
    ` : '';

    let html = `
        <div class="pull-request ${statusClass}" data-id="${pullRequest.id}">
            ${allOtherParticipantsApprovedIcon}
            <div class="pull-request-content">
                <div class="pull-request-main">
                    <div class="pull-request-info">
                        <div class="pull-request-header">
                            ${toggleButton}
                            <a href="${pullRequest.links.html.href}" target="_blank">${pullRequest.title}</a>
                            <span class="status-indicator ${statusClass}"></span>
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

document.addEventListener('DOMContentLoaded', function() {
    loadProjects();
});

// Export functions that need to be accessible globally
window.toggleChildren = toggleChildren;
window.toggleRootBranch = toggleRootBranch;
window.toggleRepository = toggleRepository;