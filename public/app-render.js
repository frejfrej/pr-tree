/**
 * Rendering of the pull-request tree and of the orphaned issues as HTML
 * strings, from the data of /api/pull-requests/:project.
 *
 * Nothing here depends on the filter state: the tree is rendered in full, and
 * the filter pass (app-filter.js) hides and counts on the rendered result.
 * The inline onclick handlers of the tree call the toggle functions that
 * app.js installs on window. The pull-request and issue links carry, as data
 * attributes, what the popovers show; initializePopovers reads them back, so
 * the writer and the reader of those attributes live together.
 *
 * Nothing here touches the DOM at import time, so the rendering can be
 * unit-tested with node:test.
 */

export function renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName) {
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

    // Shown by the filter pass while every repository is hidden
    if (Object.keys(pullRequestsByRepo).length > 0) {
        html += `
            <div class="state-message tree-no-match" hidden>
                <i class="fas fa-filter"></i>
                <span>No pull request matches the filters</span>
            </div>
        `;
    }
    return html;
}

export function findRootBranches(pullRequests) {
    const destinationBranches = new Set(pullRequests.map(pullRequest => pullRequest.destination.branch.name));
    const sourceBranches = new Set(pullRequests.map(pullRequest => pullRequest.source.branch.name));
    return Array.from(destinationBranches).filter(branch => !sourceBranches.has(branch));
}

// Function to calculate total pull requests in a branch including all descendants
export function calculateTotalPullRequests(pullRequests, pullRequestsByDestination) {
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

export function calculateDescendants(pullRequest, pullRequestsByDestination) {
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

export function renderOrphanedIssues(issues) {
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

export function initializePopovers() {
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
