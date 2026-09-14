/**
 * Rendering of the pull-request tree and of the orphaned issues as HTML
 * strings, from the data of /api/pull-requests/:project.
 *
 * Nothing here depends on the filter state: the tree is rendered in full, and
 * the filter pass (app-filter.js) hides and counts on the rendered result.
 * The inline onclick handlers of the tree call the toggle functions that
 * app.js installs on window; the click of a repository or root branch is on
 * the whole header (the mouse), and the toggle button inside it, a real
 * button with a name and aria-expanded, reaches the same handler when the
 * keyboard activates it, since that click bubbles. toggleButton renders
 * every one of them, and tree-toggle.js keeps aria-expanded in step. The pull-request and issue links carry, as data
 * attributes, what the popovers show; initializePopovers reads them back, so
 * the writer and the reader of those attributes live together.
 * The orphaned issues section is rendered as a repository block so the
 * toggles of tree-toggle.js apply to it; its rows are `.orphaned-issue`,
 * never `.pull-request`, so the tree pass does not see them.
 * Every text from Bitbucket or Jira (titles, branch and repository names,
 * summaries, display names, priority names, URLs) goes through escapeHtml
 * before it is interpolated, whether into an attribute or between tags; the
 * one exception is the rendered title and description of a pull request,
 * HTML made by Bitbucket, which is URL-encoded into a data attribute and
 * shown as HTML by the popover.
 *
 * Nothing here touches the DOM at import time, so the rendering can be
 * unit-tested with node:test.
 */

/**
 * The text as HTML: the five characters that can end an attribute or start a
 * tag are escaped, so it can be interpolated anywhere. null and undefined
 * give an empty string.
 */
export function escapeHtml(text) {
    if (text === null || text === undefined) {
        return '';
    }
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// The chevron button of a collapsible block. `name` is the accessible name
// (escaped); the chevrons are decoration. `onclick` is only given for the
// pull-request button, the others rely on the click of their header.
function toggleButton(name, onclick = '') {
    return `<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle ${name}"${onclick ? ` onclick="${onclick}"` : ''}>
                        <i class="fas fa-chevron-down" aria-hidden="true"></i>
                        <i class="fas fa-chevron-right" aria-hidden="true"></i>
                    </button>`;
}

/**
 * The tree as an HTML string: one block per repository, its root branches and
 * the pull requests nested under their parents, most recently updated first.
 * Ends with the hidden no-match message the filter pass shows when needed.
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
                    ${toggleButton(escapeHtml(repoName))}
                    <h2 class="repository-name">${escapeHtml(repoName)}</h2>
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

/** The destination branches that are no pull request's source: the roots of the tree */
export function findRootBranches(pullRequests) {
    const destinationBranches = new Set(pullRequests.map(pullRequest => pullRequest.destination.branch.name));
    const sourceBranches = new Set(pullRequests.map(pullRequest => pullRequest.source.branch.name));
    return Array.from(destinationBranches).filter(branch => !sourceBranches.has(branch));
}

/** Total pull requests in a branch including all descendants */
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

// The Bitbucket URL of a branch, from the repository links of one of its pull requests
function getBranchUrl(branchName, pullRequest) {
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

            const branchUrl = getBranchUrl(rootBranch, rootPullRequests[0]);

            html += `
                <div class="root-branch">
                    <div class="root-branch-header" onclick="toggleRootBranch(this)">
                        ${toggleButton(escapeHtml(rootBranch))}
                        <h3 class="root-branch-name">
                            <a href="${escapeHtml(branchUrl)}" target="_blank" onclick="event.stopPropagation();" class="root-branch-link">
                                ${escapeHtml(rootBranch)}
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

/** How many pull requests are stacked, at any depth, on the given one */
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

        jiraIssuesHtml = jiraIssuesDetailsForPullRequest.map(issueDetails => {
            const priority = issueDetails.fields.priority;
            return `<li>${renderPriority(issueDetails.fields.priority)}<a href="${issueUrl(jiraSiteName, issueDetails.key)}" target="_blank"
                       data-issue-key="${escapeHtml(issueDetails.key)}"
                       data-issue-summary="${escapeHtml(issueDetails.fields.summary)}"
                       class="jira-issue-link">
                       ${escapeHtml(issueDetails.key)} (${escapeHtml(issueDetails.fields.status.name)})
                    </a></li>`;
        }).join('');

        if (sameStatusIcon || noOtherParticipantsAlert) {
            alertsHtml = `
                <div class="warnings">
                    <ul>
                        ${sameStatusIcon}
                        ${noOtherParticipantsAlert}
                    </ul>
                </div>
            `;
        }
    }

    const sourceBranch = pullRequest.source.branch.name;
    const hasChildren = pullRequestsByDestination.has(sourceBranch);
    const descendantCount = calculateDescendants(pullRequest, pullRequestsByDestination);
    const isRootPullRequest = level === 1;

    const toggleButtonHtml = hasChildren ? toggleButton('the stacked pull requests', 'toggleChildren(this)') : '';

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
                 data-repo-name="${escapeHtml(pullRequest.source.repository.name)}"
                 data-spec="${escapeHtml(spec)}">
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
                            ${toggleButtonHtml}
                            <a href="${escapeHtml(pullRequest.links.html.href)}" target="_blank"
                               class="pull-request-link"
                               data-rendered-title="${encodeURIComponent(renderedTitle)}"
                               data-rendered-description="${encodeURIComponent(renderedDescription)}">
                               ${escapeHtml(pullRequest.title)}
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
                        <span class="created-date">${escapeHtml(pullRequest.created_on.substring(0, 10))}</span>
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
export function renderParticipant(participant, status) {
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

    const name = escapeHtml(participant.display_name);
    return `
        <span class="image-container" data-author="${name}" data-review-status="${status}">
            <img src="${escapeHtml(participant.links.avatar.href)}" alt="${name}">
            <i class="fas ${iconClass} icon"></i>
        </span>
    `;
}

// The priority icon of an issue, nothing without a priority
function renderPriority(priority) {
    if (!priority) {
        return '';
    }
    const name = escapeHtml(priority.name);
    return `<img src="${escapeHtml(priority.iconUrl)}" alt="${name}" class="jira-priority-icon" title="${name}">`;
}

// The Jira page of an issue, escaped for an href
function issueUrl(jiraSiteName, key) {
    return escapeHtml(`https://${jiraSiteName}.atlassian.net/browse/${key}`);
}

// An orphaned issue not updated for this many days gets a warning line
const staleAfterDays = 14;
const dayMs = 24 * 60 * 60 * 1000;

/**
 * The section of issues in review without a pull request, as a repository
 * block (same header, toggle and counter, so the tree's collapse code and the
 * filter pass treat it alike) with one row per issue: priority, key (with the
 * issue popover), summary, assignee, last update, and a warning when the
 * issue has not been updated for 14 days. Pure; an empty string without
 * issues. `now` (epoch ms) is what the staleness is measured from.
 */
export function renderOrphanedIssues(issues, jiraSiteName, { now = Date.now() } = {}) {
    if (!issues || issues.length === 0) {
        return '';
    }
    const count = issues.length;
    return `
        <div class="repository orphaned-issues">
            <div class="repository-header" onclick="toggleRepository(this)">
                ${toggleButton('Jira issues in review without a pull request')}
                <h2 class="repository-name"><i class="fas fa-exclamation-circle" aria-hidden="true"></i> Jira issues in review without a pull request</h2>
                <div class="repo-pr-counter" title="${count} issue${count !== 1 ? 's' : ''}">
                    ${count}
                </div>
            </div>
            <div class="repository-content">
                ${issues.map(issue => renderOrphanedIssue(issue, jiraSiteName, now)).join('')}
            </div>
        </div>
    `;
}

// One row of the section, shaped like a pull request: the header (priority,
// key, summary), then the details (assignee, last update, the stale warning)
function renderOrphanedIssue(issue, jiraSiteName, now) {
    const key = escapeHtml(issue.key);
    const summary = escapeHtml(issue.fields.summary);
    const updated = issue.fields.updated || '';
    // Jira writes the offset without a colon (+0000), outside the ECMAScript
    // date format: put the colon in so every engine parses it
    // NaN for a missing or unparsable date: never stale
    const days = Math.floor((now - Date.parse(updated.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))) / dayMs);
    const staleHtml = days >= staleAfterDays ? `
        <div class="warnings">
            <ul>
                <li><i class="fas fa-exclamation-triangle red" title="No update for ${days} days"></i> No update for ${days} days</li>
            </ul>
        </div>
    ` : '';
    return `
        <div class="orphaned-issue status-in-review" data-issue-key="${key}">
            <div class="pull-request-content">
                <div class="pull-request-header">
                    ${renderPriority(issue.fields.priority)}
                    <a href="${issueUrl(jiraSiteName, issue.key)}" target="_blank"
                       data-issue-key="${key}"
                       data-issue-summary="${summary}"
                       class="jira-issue-link">
                       ${key}
                    </a>
                    <span class="orphaned-issue-summary">${summary}</span>
                </div>
                <div class="pull-request-details">
                    <div class="participants">
                        ${renderAssignee(issue.fields.assignee)}
                        <span class="created-date" title="Last updated">${escapeHtml(updated.substring(0, 10))}</span>
                    </div>
                    ${staleHtml}
                </div>
            </div>
        </div>
    `;
}

// The assignee of an issue as Jira describes it (displayName, avatarUrls by
// size), with the author icon of the tree; "Unassigned" without one
function renderAssignee(assignee) {
    if (!assignee || !assignee.displayName) {
        return '<span class="orphaned-issue-unassigned">Unassigned</span>';
    }
    const avatars = assignee.avatarUrls || {};
    const avatar = avatars['24x24'] || avatars['48x48'];
    const name = escapeHtml(assignee.displayName);
    return `
        <span class="image-container" data-author="${name}" title="Assignee: ${name}">
            ${avatar ? `<img src="${escapeHtml(avatar)}" alt="${name}">` : ''}
            <i class="fas fa-user icon"></i>
        </span>
    `;
}

/**
 * Hover popovers of the pull-request links (rendered title and description)
 * and of the issue links (key and summary), read from the data attributes
 * renderPullRequest writes.
 */
export function initializePopovers() {
    let popoverTimeout;
    let currentLink = null;
    const popover = document.createElement('div');
    popover.className = 'popover';
    document.body.appendChild(popover);

    function showPopover(link) {
        if (link.classList.contains('jira-issue-link')) {
            // Jira text: shown as text, never parsed as HTML
            popover.className = 'jira-issue-popover';
            popover.replaceChildren(
                textElement('jira-issue-popover-key', link.dataset.issueKey),
                textElement('jira-issue-popover-summary', link.dataset.issueSummary)
            );
        } else {
            // Bitbucket's rendering of the title and description: HTML by design
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

    function textElement(className, text) {
        const element = document.createElement('div');
        element.className = className;
        element.textContent = text;
        return element;
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
