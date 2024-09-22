let previousAuthor = "Show all";
let previousReviewer = "Show all";

function filterPullRequests() {
    let author = document.getElementById("authorSelect").value;
    let reviewer = document.getElementById("reviewerSelect").value;
    let pullRequests = document.getElementsByClassName("pull-request");

    if (reviewer !== previousReviewer) {
        document.getElementById("authorSelect").value = "Show all";
        previousReviewer = reviewer;
        author = "Show all";
    } else if (author !== previousAuthor) {
        document.getElementById("reviewerSelect").value = "Show all";
        previousAuthor = author;
        reviewer = "Show all";
    }

    Array.from(pullRequests).forEach(pr => {
        let title = pr.querySelector("a");
        let authorImg = pr.querySelector("img");
        let reviewerApproved = false;
        let reviewerFound = false;

        if (reviewer !== "Show all") {
            let participants = pr.querySelectorAll(".image-container");
            for (let i = 1; i < participants.length; i++) {
                if (participants[i].dataset.author === reviewer) {
                    reviewerFound = true;
                    if (participants[i].dataset.reviewStatus === "approved") {
                        reviewerApproved = true;
                        break;
                    }
                }
            }
        }

        let display = "none";
        let titleColor = "black";

        if (author === "Show all" && reviewer === "Show all") {
            display = "";
        } else if (authorImg.alt === author) {
            display = "";
            if (pr.classList.contains("status-in-progress")) {
                titleColor = "var(--secondary-color)";
            }
        } else if (reviewerFound) {
            display = "";
            if (!reviewerApproved && !pr.classList.contains("status-in-progress")) {
                titleColor = "var(--secondary-color)";
            }
        }

        pr.style.display = display;
        title.style.color = titleColor;
    });
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

    // Extract unique authors
    const authors = [...new Set(pullRequests.map(pr => pr.author.display_name))];
    // Generate the dropdown options
    authorSelect.innerHTML = `<option value="Show all">Show all</option>${authors.map(author => `<option value="${author}">${author}</option>`).join('')}`;

    // Extract unique reviewers
    const reviewers = [...new Set(pullRequests.flatMap(pr => pr.participants.map(p => p.user.display_name)))];
    // Generate the dropdown options
    reviewerSelect.innerHTML = `<option value="Show all">Show all</option>${reviewers.map(reviewer => `<option value="${reviewer}">${reviewer}</option>`).join('')}`;
}

async function renderEverything() {
    const data = await fetchData();
    const container = document.getElementById('pull-requests');
    container.innerHTML = renderRepositories(data.pullRequests, data.jiraIssuesMap, data.jiraIssuesDetails, new Map(Object.entries(data.pullRequestsByDestination)), data.jiraSiteName);
    populateFilters(data.pullRequests);
}

async function fetchData() {
    try {
        const response = await fetch('/api/pull-requests');
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching pull requests:', error);
        return [];
    }
}

function findRootBranches(pullRequests) {
    const destinationBranches = new Set(pullRequests.map(pullRequest => pullRequest.destination.branch.name));
    const sourceBranches = new Set(pullRequests.map(pullRequest => pullRequest.source.branch.name));
    return Array.from(destinationBranches).filter(branch => !sourceBranches.has(branch));
}

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

// Function to recursively render the pull-requests
function renderPullRequests(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName, level = 0) {
    let html = '';
    if (level === 0) {
        const destinationBranches = findRootBranches(pullRequests);

        for(const destinationBranch of destinationBranches) {
            const rootPullRequests = pullRequests.filter(pullRequest => destinationBranch === pullRequest.destination.branch.name);
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
        <div class="pull-request ${statusClass}" style="margin-left: ${level * 10}px;">
            ${allOtherParticipantsApprovedIcon}
            <div class="pull-request-content">
                <div class="pull-request-info">
                    <div class="pull-request-header">
                        ${toggleButton}
                        <a href="${pullRequest.links.html.href}" target="_blank">${pullRequest.title}</a>
                        <span class="status-indicator ${statusClass}"></span>
                    </div>
                    <div class="participants">
                        ${renderParticipant(pullRequest.author, "author")} 
                        <span class="created-date">${pullRequest.created_on.substring(0,10)}</span>
                        ${approvedDetails} ${requestedChangesDetails} ${notYetDecidedDetails}
                    </div>
                    ${alertsHtml}
                </div>
                <div class="pull-request-issues">
                    <ul class="jira-issues">
                        ${jiraIssuesHtml}
                    </ul>
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
    renderEverything();
});