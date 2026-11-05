/**
 * Rendering of the pull-request tree and of the orphaned issues as HTML
 * strings, from the data of /api/pull-requests/:project.
 *
 * Nothing here depends on the filter state: the tree is rendered in full, and
 * the filter pass (app-filter.js) hides and counts on the rendered result.
 * The tree is rendered per repository, the stacked pull requests found through
 * the destination map of that repository, so two repositories sharing a branch
 * name never show each other's pull requests under it.
 * The tree carries no inline handler: app.js installs one click listener on
 * the pane, which copies what a copy button carries (handleCopyClick in
 * copy-branch.js) or toggles the block a click lands on and leaves the links
 * alone (handleTreeClick in tree-toggle.js); toggleButton renders every
 * chevron button, a real button with a name and aria-expanded, and
 * tree-toggle.js keeps aria-expanded in step. The pull-request and issue
 * links carry, as data attributes, what the popovers show;
 * initializePopovers reads them back, so the writer and the reader of those
 * attributes live together. The "(see 12, 45)" links after an issue carry
 * only the key of the related pull request's row, whose title link the
 * preview reads.
 * Under an issue, of a card or of an orphaned row, one line per Jira link of
 * the phrases the Links setting ticked, to an issue not done (the rule is
 * issue-links.js): Jira's phrase, the linked key, a `jira-issue-link` like
 * the issue's own, so the same popover shows its summary and the issue's own
 * stays the first of its row (the `i` key), its status, and its pull
 * requests as "#41" links, `related-pull-request-link`s like the "see" ones.
 * The orphaned issues section is rendered as a repository block so the
 * toggles of tree-toggle.js apply to it; its rows are `.orphaned-issue`,
 * never `.pull-request`, so the tree pass does not see them.
 * Both kinds of rows, and the root-branch headers, are focusable but outside
 * the Tab order (tabindex="-1"): the keys of tree-keyboard.js move the focus
 * between them.
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

import { isDraft, issueApprovals, openTaskCount, otherReviewers, statusClass, syncKey } from './pull-request-status.js';
import { pullRequestKey, rootBranchKey } from './pull-request-key.mjs';
import { escapeHtml } from './escape-html.js';
import { sourcetreeUrl, switchCommand } from './copy-branch.js';
import { shownIssueLinks } from './issue-links.js';

// The one escape of the page, shared with the filter options (escape-html.js)
export { escapeHtml };

// The chevron button of a collapsible block. `name` is the accessible name
// (escaped); the chevrons are decoration. No handler of its own: the click
// listener of the pane toggles the block a click lands on.
function toggleButton(name) {
    return `<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle ${name}">
                        <i class="fas fa-chevron-down" aria-hidden="true"></i>
                        <i class="fas fa-chevron-right" aria-hidden="true"></i>
                    </button>`;
}

// A copy button: `text` is what it copies, `label` its accessible name. Its
// own icon, the copied and the failed icons, the class copy-branch.js sets
// on the button choosing the one shown. No handler of its own: the click
// listener of the pane copies (handleCopyClick).
function copyButton(kind, icon, text, label) {
    return `<button type="button" class="copy-button ${kind}" data-copy="${escapeHtml(text)}" title="Copy: ${escapeHtml(text)}" aria-label="${escapeHtml(label)}">
                                <i class="fas ${icon} copy-icon" aria-hidden="true"></i><i class="fas fa-check copied-icon" aria-hidden="true"></i><i class="fas fa-times copy-failed-icon" aria-hidden="true"></i>
                            </button>`;
}

// The link checking a branch out in Sourcetree, nothing without the
// repository's full name. No target: the browser hands it to Sourcetree
function sourcetreeLink(branch, repositoryFullName) {
    const url = sourcetreeUrl(branch, repositoryFullName);
    if (!url) return '';
    return `<a class="sourcetree-link" href="${escapeHtml(url)}" title="Check out in Sourcetree" aria-label="Check out ${escapeHtml(branch)} in Sourcetree">
                                <i class="fab fa-sourcetree" aria-hidden="true"></i>
                            </a>`;
}

// The branch actions of a pull request: copy its source branch name, copy
// the command fetching and switching to it (none for a name no quoting
// carries), check it out in Sourcetree
function branchActions(branch, repositoryFullName) {
    const command = switchCommand(branch);
    return `<span class="branch-actions">
                            ${copyButton('copy-branch', 'fa-copy', branch, `Copy the branch name ${branch}`)}
                            ${command ? copyButton('copy-switch', 'fa-terminal', command, `Copy ${command}`) : ''}
                            ${sourcetreeLink(branch, repositoryFullName)}
                        </span>`;
}

/**
 * The pull requests by destination branch name: the stacked pull requests of
 * a pull request are those whose destination is its source branch. Built per
 * repository, so two repositories sharing a branch name do not see each
 * other's pull requests.
 * @returns {Map<string, object[]>}
 */
export function pullRequestsByDestination(pullRequests) {
    const byDestination = new Map();
    for (const pullRequest of pullRequests) {
        const destination = pullRequest.destination.branch.name;
        if (!byDestination.has(destination)) byDestination.set(destination, []);
        byDestination.get(destination).push(pullRequest);
    }
    return byDestination;
}

/**
 * The pull requests of each issue, by issue key, from the issue map of the
 * response: once each, however often a title names the key, in id order,
 * ties by repository. The repository is the one of the pull-request key, where
 * Bitbucket numbers the pull request (the destination). Pure.
 * @returns {Map<string, { key: string, id: number, repository: string, href: string }[]>}
 */
export function relatedPullRequestsByIssue(pullRequests, jiraIssuesMap) {
    const byIssue = new Map();
    for (const pullRequest of pullRequests) {
        const key = pullRequestKey(pullRequest);
        for (const issueKey of new Set(jiraIssuesMap[key] || [])) {
            if (!byIssue.has(issueKey)) byIssue.set(issueKey, []);
            byIssue.get(issueKey).push({ key, id: pullRequest.id, repository: pullRequest.destination.repository.name, href: pullRequest.links.html.href });
        }
    }
    for (const list of byIssue.values()) {
        list.sort((a, b) => a.id - b.id || a.repository.localeCompare(b.repository));
    }
    return byIssue;
}

/**
 * The pull requests of one repository the tree shows: those on a root branch
 * and those stacked on them, at any depth; none of a branch loop, which no
 * root branch reaches. Each visited once. Pure.
 */
export function pullRequestsInTree(repoPullRequests) {
    const byDestination = pullRequestsByDestination(repoPullRequests);
    const pending = findRootBranches(repoPullRequests).flatMap(branch => byDestination.get(branch));
    const shown = new Set();
    while (pending.length > 0) {
        const pullRequest = pending.pop();
        if (shown.has(pullRequest)) continue;
        shown.add(pullRequest);
        pending.push(...(byDestination.get(pullRequest.source.branch.name) || []));
    }
    return [...shown];
}

// A link to a related pull request in Bitbucket, carrying the key of its row,
// which its preview reads (initializePopovers), named with its repository:
// two repositories share numbers
function relatedPullRequestLink(other, text) {
    return `<a href="${escapeHtml(other.href)}" target="_blank" class="related-pull-request-link" data-related-key="${escapeHtml(other.key)}" aria-label="Pull request ${escapeHtml(other.id)} of ${escapeHtml(other.repository)}">${escapeHtml(text)}</a>`;
}

// The "(see 12, 45)" after an issue of a card: the other pull requests of the
// issue; nothing when the card is alone
function relatedLinks(pullRequests = [], ownKey) {
    const others = pullRequests.filter(other => other.key !== ownKey);
    if (others.length === 0) return '';
    return `<span class="related-pull-requests">(see ${others.map(other => relatedPullRequestLink(other, other.id)).join(', ')})</span>`;
}

// The link lines under an issue of a card or an orphaned row, those of the
// ticked phrases to issues not done (shownIssueLinks): Jira's phrase, the
// linked key carrying what the issue popover shows, its status, then the
// pull requests of the linked issue the tree shows ("· #41, #57"), never
// the card's own (`ownKey`); nothing when no link is shown
function issueLinkLines(issue, linkPhrases, related, jiraSiteName, ownKey) {
    const links = shownIssueLinks(issue, linkPhrases);
    if (links.length === 0) return '';
    const lines = links.map(link => {
        const others = (related.get(link.key) ?? []).filter(other => other.key !== ownKey);
        const pullRequests = others.length > 0
            ? `<span class="issue-link-pull-requests"> · ${others.map(other => relatedPullRequestLink(other, `#${other.id}`)).join(', ')}</span>`
            : '';
        return `<li class="issue-link"><i class="fas fa-link" aria-hidden="true"></i> <span class="issue-link-phrase">${escapeHtml(link.phrase)}</span> <a href="${issueUrl(jiraSiteName, link.key)}" target="_blank" class="jira-issue-link" data-issue-key="${escapeHtml(link.key)}" data-issue-summary="${escapeHtml(link.summary)}">${escapeHtml(link.key)}</a> <span class="issue-link-status">(${escapeHtml(link.status?.name ?? 'no status')})</span>${pullRequests}</li>`;
    });
    return `<ul class="issue-links">${lines.join('')}</ul>`;
}

// The pull requests of each repository, by the name of their source repository, in their order
function pullRequestsByRepository(pullRequests) {
    const byRepository = {};
    for (const pullRequest of pullRequests) {
        (byRepository[pullRequest.source.repository.name] ??= []).push(pullRequest);
    }
    return byRepository;
}

/**
 * The pull requests of each issue the tree shows, across the repositories:
 * the "see" list of each card and the "#" links of the link lines; app.js
 * passes it to renderOrphanedIssues, rendered apart from the tree
 */
export function treeRelatedPullRequests(pullRequests, jiraIssuesMap) {
    return relatedPullRequestsByIssue(Object.values(pullRequestsByRepository(pullRequests)).flatMap(pullRequestsInTree), jiraIssuesMap);
}

/**
 * The tree as an HTML string: one block per repository, its root branches and
 * the pull requests nested under their parents, most recently updated first.
 * Ends with the hidden no-match message the filter pass shows when needed.
 * `linkPhrases`: the phrases of the issue links drawn under each issue (the
 * Links setting), none by default; `related`: treeRelatedPullRequests of
 * these pull requests, which app.js builds once for the tree and the
 * orphaned issues, built here when not given.
 */
export function renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, jiraSiteName, { linkPhrases = [], related = treeRelatedPullRequests(pullRequests, jiraIssuesMap) } = {}) {
    const pullRequestsByRepo = pullRequestsByRepository(pullRequests);

    let html = '';
    for (const [repoName, repoPullRequests] of Object.entries(pullRequestsByRepo)) {
        const byDestination = pullRequestsByDestination(repoPullRequests);
        const pullRequestCount = repoPullRequests.length;
        html += `
            <div class="repository">
                <div class="repository-header">
                    ${toggleButton(escapeHtml(repoName))}
                    <h2 class="repository-name">${escapeHtml(repoName)}</h2>
                    <div class="repo-pr-counter" title="${pullRequestCount} pull request${pullRequestCount !== 1 ? 's' : ''}">
                        ${pullRequestCount}
                    </div>
                </div>
                <div class="repository-content">
                    ${renderPullRequests(repoPullRequests, jiraIssuesMap, jiraIssuesDetails, byDestination, jiraSiteName, related, linkPhrases)}
                </div>
            </div>
        `;
    }

    // Shown by the filter pass while every repository is hidden
    if (Object.keys(pullRequestsByRepo).length > 0) {
        html += `
            <div class="state-message tree-no-match" hidden>
                <i class="fas fa-filter" aria-hidden="true"></i>
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
export function calculateTotalPullRequests(pullRequests, byDestination) {
    let total = pullRequests.length;
    for (const pullRequest of pullRequests) {
        const sourceBranch = pullRequest.source.branch.name;
        if (byDestination.has(sourceBranch)) {
            total += calculateTotalPullRequests(byDestination.get(sourceBranch), byDestination);
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
function renderPullRequests(pullRequests, jiraIssuesMap, jiraIssuesDetails, byDestination, jiraSiteName, related, linkPhrases, level = 0) {
    let html = '';
    if (level === 0) {
        const rootBranches = findRootBranches(pullRequests);
        for(const rootBranch of rootBranches) {
            const rootPullRequests = pullRequests.filter(pullRequest => rootBranch === pullRequest.destination.branch.name);
            // Sort by updated_on date in descending order (most recent first)
            rootPullRequests.sort((a, b) => new Date(b.updated_on) - new Date(a.updated_on));
            const totalPullRequestCount = calculateTotalPullRequests(rootPullRequests, byDestination);

            const branchUrl = getBranchUrl(rootBranch, rootPullRequests[0]);
            // Repositories share root branch names (master): each one keeps its own collapse state (#103)
            const branchKey = rootBranchKey(rootPullRequests[0].source.repository.name, rootBranch);

            html += `
                <div class="root-branch" data-root-branch-key="${escapeHtml(branchKey)}">
                    <div class="root-branch-header" tabindex="-1">
                        ${toggleButton(escapeHtml(rootBranch))}
                        <h3 class="root-branch-name">
                            <a href="${escapeHtml(branchUrl)}" target="_blank" class="root-branch-link">
                                ${escapeHtml(rootBranch)}
                                <i class="fas fa-external-link-alt external-link-icon" aria-hidden="true"></i>
                            </a>
                        </h3>
                        <div class="branch-pr-counter" title="${totalPullRequestCount} total pull request${totalPullRequestCount !== 1 ? 's' : ''} (including all descendants)">
                            ${totalPullRequestCount}
                        </div>
                    </div>
                    <div class="root-branch-content">
            `;
            rootPullRequests.forEach(rootPullRequest => {
                html += renderPullRequest(rootPullRequest, jiraIssuesMap, jiraIssuesDetails, byDestination, jiraSiteName, related, linkPhrases, 1);
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
            html += renderPullRequest(pullRequest, jiraIssuesMap, jiraIssuesDetails, byDestination, jiraSiteName, related, linkPhrases, level+1);
        });
    }
    return html;
}

/** How many pull requests are stacked, at any depth, on the given one */
export function calculateDescendants(pullRequest, byDestination) {
    let count = 0;
    const sourceBranch = pullRequest.source.branch.name;
    if (byDestination.has(sourceBranch)) {
        const children = byDestination.get(sourceBranch);
        count += children.length;
        for (const child of children) {
            count += calculateDescendants(child, byDestination);
        }
    }
    return count;
}

// Function to recursively render a pull-request
function renderPullRequest(pullRequest, jiraIssuesMap, jiraIssuesDetails, byDestination, jiraSiteName, related, linkPhrases, level = 0) {
    let approvedDetails = "";
    let requestedChangesDetails = "";
    let notYetDecidedDetails = "";

    // The reviewers: every participant but the author and Rovo Dev
    const reviewers = otherReviewers(pullRequest);
    for (const participant of reviewers) {
        if (participant.approved) {
            approvedDetails += renderParticipant(participant.user, "approved");
        } else if (participant.state === "changes_requested") {
            requestedChangesDetails += renderParticipant(participant.user, "requestedChanges");
        } else {
            notYetDecidedDetails += renderParticipant(participant.user, "toReview");
        }
    }

    // A draft without reviewers is the normal state of a draft: no warning
    const draft = isDraft(pullRequest);
    let noOtherParticipantsAlert = reviewers.length === 0 && !draft ?
        `<li><i class="fas fa-exclamation-triangle red" aria-hidden="true" title="Pull request has no other participants"></i> Pull request has no other participants</li>` : '';

    // The linked issues, in the order of the map; null for a pull request the map does not know
    const key = pullRequestKey(pullRequest);
    const jiraIssues = jiraIssuesMap[key];
    const linkedIssues = jiraIssues
        ? jiraIssues.map(issue => jiraIssuesDetails.find(details => details.key === issue)).filter(issueDetails => issueDetails)
        : null;
    // The band: one computation with the filter index (pull-request-status.js)
    const bandClass = statusClass(pullRequest, linkedIssues);

    let alertsHtml = "";
    let jiraIssuesHtml = "";
    if (linkedIssues) {
        const uniqueJiraIssuesStatuses = new Set(linkedIssues.map(issueDetails => issueDetails.fields.status?.name));
        let sameStatusIcon = uniqueJiraIssuesStatuses.size > 1 ?
            `<li><i class="fas fa-exclamation-triangle red" aria-hidden="true" title="JIRA issues have different statuses"></i> JIRA issues have different statuses</li>` : '';

        jiraIssuesHtml = linkedIssues.map(issueDetails => {
            // The icon and the link in one group: the line wraps before the related list, never between them
            return `<li><span class="jira-issue">${renderPriority(issueDetails.fields.priority)}<a href="${issueUrl(jiraSiteName, issueDetails.key)}" target="_blank"
                       data-issue-key="${escapeHtml(issueDetails.key)}"
                       data-issue-summary="${escapeHtml(issueDetails.fields.summary)}"
                       class="jira-issue-link">
                       ${escapeHtml(issueDetails.key)} (${escapeHtml(issueDetails.fields.status?.name ?? 'no status')})
                    </a></span>${relatedLinks(related.get(issueDetails.key), key)}${issueLinkLines(issueDetails, linkPhrases, related, jiraSiteName, key)}</li>`;
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
    const hasChildren = byDestination.has(sourceBranch);
    const descendantCount = calculateDescendants(pullRequest, byDestination);
    const isRootPullRequest = level === 1;

    const toggleButtonHtml = hasChildren ? toggleButton('the stacked pull requests') : '';

    // Combine both counters in a container
    const countersHtml = `
        <div class="counters-container">
            ${(isRootPullRequest || hasChildren) ? `
                <div class="child-counter ${isRootPullRequest ? 'visible' : ''}" 
                     title="${descendantCount} descendant pull request${descendantCount !== 1 ? 's' : ''}">
                    ${descendantCount}
                </div>
            ` : ''}
            <div class="conflicts-counter"
                 data-sync-key="${escapeHtml(syncKey(pullRequest))}">
            </div>
        </div>
    `;

    const renderedTitle = pullRequest.rendered.title.html;
    const renderedDescription = pullRequest.rendered.description.html || 'No description provided.';

    let html = `
        <div class="pull-request ${bandClass}${isRootPullRequest ? ' pull-request-root' : ''}" data-id="${escapeHtml(key)}" tabindex="-1">
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
                            ${draft ? '<span class="draft-badge" title="Draft: not ready for review yet">Draft</span>' : ''}
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
                                <i class="fas fa-code-branch" aria-hidden="true"></i>${pullRequest.commitsBehind === 100 ? 'at least ': ''}-${pullRequest.commitsBehind}
                            </span>`
                            : ''}
                        ${pullRequest.commitsAhead ?
                            `<span class="commit-badge commit-badge-ahead" title="Number of commits ahead of destination branch">
                                <i class="fas fa-code-branch" aria-hidden="true"></i>${pullRequest.commitsAhead === 100 ? 'at least ': ''}+${pullRequest.commitsAhead}
                            </span>`
                            : ''}
                        ${renderTaskBadge(openTaskCount(pullRequest))}
                        ${branchActions(sourceBranch, pullRequest.source.repository?.full_name)}
                    </div>
                    ${alertsHtml}
                </div>
            </div>
        </div>
    `;
    if (hasChildren) {
        html += `<div class="children">${renderPullRequests(byDestination.get(sourceBranch), jiraIssuesMap, jiraIssuesDetails, byDestination, jiraSiteName, related, linkPhrases, level + 1)}</div>`;
    }
    return html;
}

// The avatar of a person, or, without an avatar URL (a Jira user may have
// none), a disc of the same size named like the image (never an empty
// <img src="">): the name stays on the row, the status icon in its corner.
// The tooltip is the caller's, on the container holding avatar and icon
function renderAvatar(url, name) {
    if (url) return `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}">`;
    return `<span class="avatar-placeholder" role="img" aria-label="${escapeHtml(name)}"></span>`;
}

// The open tasks of a pull request (openTaskCount), nothing without one; the
// icon names what the number counts
function renderTaskBadge(taskCount) {
    if (!(taskCount > 0)) return '';
    return `<span class="commit-badge task-badge" title="${taskCount} open task${taskCount !== 1 ? 's' : ''}">
                                <i class="fas fa-tasks" role="img" aria-label="open tasks"></i>${taskCount}
                            </span>`;
}

// What the status icon of a participant says, for screen readers (#109)
const participantStatusLabels = {
    approved: 'approved',
    requestedChanges: 'requested changes',
    toReview: 'not reviewed yet',
    author: 'author'
};

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
        <span class="image-container" data-author="${name}" data-review-status="${status}" title="${name}">
            ${renderAvatar(participant.links?.avatar?.href, participant.display_name)}
            <i class="fas ${iconClass} icon" ${Object.hasOwn(participantStatusLabels, status) ? `role="img" aria-label="${participantStatusLabels[status]}"` : 'aria-hidden="true"'}></i>
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
 * issue popover), summary, assignee, last update, its Jira approvers with
 * their review status, and a warning when the issue has not been updated for
 * 14 days. Pure; an empty string without issues. `now` (epoch ms) is what the
 * staleness is measured from; `linkPhrases` the phrases of the issue links
 * drawn under each issue (none by default), `related` the pull requests of
 * each issue the tree shows (treeRelatedPullRequests), for their "#" links.
 */
export function renderOrphanedIssues(issues, jiraSiteName, { now = Date.now(), linkPhrases = [], related = new Map() } = {}) {
    if (!issues || issues.length === 0) {
        return '';
    }
    const count = issues.length;
    return `
        <div class="repository orphaned-issues">
            <div class="repository-header">
                ${toggleButton('Jira issues in review without a pull request')}
                <h2 class="repository-name"><i class="fas fa-exclamation-circle" aria-hidden="true"></i> Jira issues in review without a pull request</h2>
                <div class="repo-pr-counter" title="${count} issue${count !== 1 ? 's' : ''}">
                    ${count}
                </div>
            </div>
            <div class="repository-content">
                ${issues.map(issue => renderOrphanedIssue(issue, jiraSiteName, now, linkPhrases, related)).join('')}
            </div>
        </div>
    `;
}

// One row of the section, shaped like a pull request: the header (priority,
// key, summary), its link lines, then the details (assignee, last update, approvers, the stale warning)
function renderOrphanedIssue(issue, jiraSiteName, now, linkPhrases, related) {
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
                <li><i class="fas fa-exclamation-triangle red" aria-hidden="true" title="No update for ${days} days"></i> No update for ${days} days</li>
            </ul>
        </div>
    ` : '';
    return `
        <div class="orphaned-issue status-in-review" data-issue-key="${key}" tabindex="-1">
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
                ${issueLinkLines(issue, linkPhrases, related, jiraSiteName, null)}
                <div class="pull-request-details">
                    <div class="participants">
                        ${renderAssignee(issue.fields.assignee)}
                        <span class="created-date" title="Last updated">${escapeHtml(updated.substring(0, 10))}</span>
                        ${renderApprovers(issue)}
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
    const name = escapeHtml(assignee.displayName);
    return `
        <span class="image-container" data-author="${name}" title="Assignee: ${name}">
            ${renderAvatar(jiraAvatar(assignee), assignee.displayName)}
            <i class="fas fa-user icon" aria-hidden="true"></i>
        </span>
    `;
}

// The Jira approvers of an issue (#146), drawn like the reviewers of a pull
// request: those who approved first, then the others, as the filter index
// counts them (issueApprovals)
function renderApprovers(issue) {
    const { approved, pending } = issueApprovals(issue);
    return [
        ...approved.map(user => renderParticipant(jiraUserAsParticipant(user), 'approved')),
        ...pending.map(user => renderParticipant(jiraUserAsParticipant(user), 'toReview'))
    ].join('');
}

// The avatar URL of a Jira user (avatarUrls by size), undefined without one
function jiraAvatar(user) {
    const avatars = user.avatarUrls || {};
    return avatars['24x24'] || avatars['48x48'];
}

// A Jira user as the Bitbucket participant renderParticipant draws
function jiraUserAsParticipant(user) {
    return { display_name: user.displayName, links: { avatar: { href: jiraAvatar(user) } } };
}

// The row of a pull request, by its key (repository/id), in the tree as rendered now
function pullRequestRow(key) {
    return document.querySelector(`.pull-request[data-id="${CSS.escape(key)}"]`);
}

/**
 * Hover popovers of the pull-request links (rendered title and description),
 * of the issue links (key and summary), read from the data attributes
 * renderPullRequest writes, and of the "(see 12, 45)" links, which show the
 * preview of the related pull request's title link, under its repository
 * and number. A related pull request the last filter pass shows gets a
 * button that reveals it: unfolds what hides it, selects it, scrolls to it.
 * app.js owns the shown rows and the selection, hence the two functions.
 * @param {{ isShown?: (row: Element) => boolean, reveal?: (row: Element) => void }} [options]
 */
export function initializePopovers({ isShown = () => false, reveal = () => {} } = {}) {
    let popoverTimeout;
    let currentLink = null;
    const popover = document.createElement('div');
    popover.className = 'popover';
    document.body.appendChild(popover);

    // Bitbucket's rendering of the title and description of a pull-request link: HTML by
    // design; returns the title's element
    function renderPullRequestPreview(titleLink) {
        const title = htmlElement('pull-request-popover-title', decodeURIComponent(titleLink.dataset.renderedTitle));
        popover.className = 'pull-request-popover';
        popover.replaceChildren(title, htmlElement('pull-request-popover-description', decodeURIComponent(titleLink.dataset.renderedDescription)));
        return title;
    }

    // The preview of a related pull request: its repository and number (text), then its
    // title line with the scroll button while the filters show it, then its description
    function renderRelatedPreview(link) {
        const key = link.dataset.relatedKey;
        const row = pullRequestRow(key);
        const titleLink = row?.querySelector('.pull-request-link');
        if (!titleLink) return false;
        const title = renderPullRequestPreview(titleLink);
        const separator = key.lastIndexOf('/');
        const repository = key.slice(0, separator);
        const id = key.slice(separator + 1);
        const header = document.createElement('div');
        header.className = 'pull-request-popover-header';
        header.append(title);
        if (isShown(row)) {
            // Named with the repository, as the "see" link is: two repositories share numbers
            const label = `Scroll to pull request ${id} of ${repository}`;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'scroll-to-pull-request';
            button.dataset.relatedKey = key;
            button.title = label;
            button.setAttribute('aria-label', label);
            const icon = document.createElement('i');
            icon.className = 'fas fa-crosshairs';
            icon.setAttribute('aria-hidden', 'true');
            button.append(icon);
            header.append(button);
        }
        popover.prepend(textElement('pull-request-popover-repository', `${repository} · #${id}`), header);
        return true;
    }

    function showPopover(link) {
        if (link.classList.contains('jira-issue-link')) {
            // Jira text: shown as text, never parsed as HTML
            popover.className = 'jira-issue-popover';
            popover.replaceChildren(
                textElement('jira-issue-popover-key', link.dataset.issueKey),
                textElement('jira-issue-popover-summary', link.dataset.issueSummary)
            );
        } else if (link.classList.contains('related-pull-request-link')) {
            // A row gone with a re-render: no preview, not even the one of the link hovered before
            if (!renderRelatedPreview(link)) {
                hidePopover();
                return;
            }
        } else {
            renderPullRequestPreview(link);
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

    // Only for Bitbucket's rendered HTML
    function htmlElement(className, html) {
        const element = document.createElement('div');
        element.className = className;
        element.innerHTML = html;
        return element;
    }

    const linkSelector = '.jira-issue-link, .pull-request-link, .related-pull-request-link';

    document.addEventListener('mouseover', function(event) {
        const link = event.target.closest(linkSelector);

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
        const link = event.target.closest(linkSelector);

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

    // The scroll button of a related preview: the row is looked up again, a refresh may
    // have re-rendered the tree meanwhile; a row gone or filtered out since only closes it
    popover.addEventListener('click', function(event) {
        const button = event.target.closest('.scroll-to-pull-request');
        if (!button) return;
        const row = pullRequestRow(button.dataset.relatedKey);
        clearTimeout(popoverTimeout);
        hidePopover();
        if (row && isShown(row)) reveal(row);
    });

    // A popover left open while the tree scrolls would float away from its link
    document.getElementById('main').addEventListener('scroll', hidePopover, { passive: true });
}
