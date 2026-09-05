import { updateCounterDisplay } from './counter-utils.js';

/**
 * Filtering of the rendered pull-request tree.
 *
 * The data needed by the filters is indexed once per data load
 * (buildFilterIndex), and every filter pass is a single walk of the rendered
 * tree: each pull request is visited exactly once, its visibility and
 * attention are decided from the index, and the counters of its ancestors are
 * summed on the way back up. Nothing here searches arrays or the DOM per
 * pull request, so a pass costs the same on a flat list and on a deep stack.
 */

let filterIndex = null;

export function initializeFilter(apiResult) {
    filterIndex = buildFilterIndex(apiResult);
}

/**
 * Counts the filters that are not at their default value.
 * A multi-select with several values counts once.
 */
export function countActiveFilters({ assignees, reviewers, sprints, fixVersions, sync, ready }) {
    return [
        assignees.length > 0,
        reviewers.length > 0,
        sprints.length > 0,
        fixVersions.length > 0,
        ready === true,
        sync !== 'Show all'
    ].filter(Boolean).length;
}

/**
 * Decides whether a pull request needs the attention of the people selected
 * in the assignee and reviewer filters. Pure: everything it needs is passed in.
 *
 * - assignee: the PR is in progress and a linked issue is assigned to a selected assignee
 * - reviewer: the PR is in review and a selected reviewer (never the author) has not approved
 *
 * The title of a PR with attention is highlighted; the "Ready for reviewer"
 * filter keeps the PRs with reviewer attention.
 */
export function computeAttention(pullRequestData, { statusInProgress, statusInReview, linkedIssues, assignees, reviewers }) {
    const assignee = assignees.length > 0 && statusInProgress &&
        linkedIssues.some(issue => issue.fields.assignee && assignees.includes(issue.fields.assignee.displayName));
    const reviewer = reviewers.length > 0 && statusInReview &&
        pullRequestData.participants.some(participant =>
            participant.user.uuid !== pullRequestData.author.uuid &&
            reviewers.includes(participant.user.display_name) &&
            !participant.approved
        );
    return { assignee, reviewer, any: assignee || reviewer };
}

/**
 * Indexes the API result for the filters: one entry per pull request with its
 * linked issues and the sets the filters compare against. Pure.
 * @returns {{ pullRequestsById: Map<number, object> }}
 */
export function buildFilterIndex({ pullRequests = [], jiraIssuesMap = {}, jiraIssuesDetails = [], sprintIssues = {} }) {
    const issuesByKey = new Map(jiraIssuesDetails.map(issue => [issue.key, issue]));

    const sprintsByIssueKey = new Map();
    for (const [sprintId, issueKeys] of Object.entries(sprintIssues)) {
        for (const issueKey of issueKeys) {
            if (!sprintsByIssueKey.has(issueKey)) {
                sprintsByIssueKey.set(issueKey, new Set());
            }
            sprintsByIssueKey.get(issueKey).add(String(sprintId));
        }
    }

    const pullRequestsById = new Map();
    for (const pullRequest of pullRequests) {
        const issueKeys = jiraIssuesMap[pullRequest.id] || [];
        const linkedIssues = issueKeys.map(key => issuesByKey.get(key)).filter(issue => issue);
        const entry = {
            pullRequest,
            linkedIssues,
            assignees: new Set(linkedIssues
                .filter(issue => issue.fields.assignee && issue.fields.assignee.displayName)
                .map(issue => issue.fields.assignee.displayName)),
            reviewers: new Set(pullRequest.participants
                .filter(participant => participant.user.uuid !== pullRequest.author.uuid)
                .map(participant => participant.user.display_name)),
            sprints: new Set(issueKeys.flatMap(key => [...(sprintsByIssueKey.get(key) || [])])),
            fixVersions: new Set(linkedIssues
                .flatMap(issue => issue.fields.fixVersions || [])
                .map(version => String(version.id)))
        };
        pullRequestsById.set(pullRequest.id, entry);
    }

    return { pullRequestsById };
}

/**
 * Applies the filters to one indexed pull request. Pure.
 * @param {object} entry - an entry of buildFilterIndex().pullRequestsById
 * @param {object} filters - { assignees, reviewers, sprints, fixVersions, sync, ready }
 * @param {object} rendered - what the tree shows for this pull request:
 *   statusInProgress, statusInReview (from the Jira statuses) and hasSyncLabel
 * @returns {{ visible: boolean, attention: { assignee, reviewer, any } }}
 */
export function evaluatePullRequest(entry, { assignees, reviewers, sprints, fixVersions, sync, ready }, { statusInProgress, statusInReview, hasSyncLabel }) {
    const attention = computeAttention(entry.pullRequest, {
        statusInProgress,
        statusInReview,
        linkedIssues: entry.linkedIssues,
        assignees,
        reviewers
    });

    // Empty selection = show all; otherwise match ANY selected value
    const assigneeMatch = assignees.length === 0 || assignees.some(name => entry.assignees.has(name));
    const reviewerMatch = reviewers.length === 0 || reviewers.some(name => entry.reviewers.has(name));
    const sprintMatch = sprints.length === 0 || sprints.some(sprintId => entry.sprints.has(String(sprintId)));
    const fixVersionMatch = fixVersions.length === 0 || fixVersions.some(versionId => entry.fixVersions.has(String(versionId)));
    const syncMatch = sync === 'Show all' ||
        (sync === 'requested' && hasSyncLabel) ||
        (sync === 'OK' && !hasSyncLabel);
    // Ready for reviewer: in review, and a selected reviewer has not approved yet
    const readyMatch = !ready || attention.reviewer;

    return {
        visible: assigneeMatch && reviewerMatch && sprintMatch && fixVersionMatch && syncMatch && readyMatch,
        attention
    };
}

/**
 * Applies the filters to the rendered tree and refreshes the counters.
 * @returns {number} how many pull requests are left shown and need attention
 */
export function filterBranches(assignees, reviewers, sprints, fixVersions, sync, ready) {
    const filters = { assignees, reviewers, sprints, fixVersions, sync, ready };
    const pass = {
        filters,
        index: filterIndex || buildFilterIndex({}),
        // The SYNC filter relies on the rendered badges: collect them once
        pullRequestsWithSyncLabel: new Set(
            Array.from(document.querySelectorAll('.pull-request .conflicts-count'))
                .map(badge => badge.closest('.pull-request'))
                .filter(pullRequest => pullRequest)
                .map(pullRequest => pullRequest.dataset.id)
        ),
        shownAttention: 0
    };

    for (const repository of document.querySelectorAll('.repository')) {
        let repositoryTotal = 0;
        let repositoryVisible = 0;
        for (const rootBranch of repository.querySelectorAll('.root-branch')) {
            const content = rootBranch.querySelector('.root-branch-content');
            const counts = content ? filterChildren(content, pass) : { total: 0, visible: 0 };
            repositoryTotal += counts.total;
            repositoryVisible += counts.visible;

            // Hide branch if no visible pull requests
            setDisplay(rootBranch, counts.visible > 0 ? '' : 'none');
            const counter = rootBranch.querySelector('.branch-pr-counter');
            if (counter) updateCounterDisplay(counter, counts.visible, counts.total);
        }
        const counter = repository.querySelector('.repo-pr-counter');
        if (counter) updateCounterDisplay(counter, repositoryVisible, repositoryTotal);
    }

    return pass.shownAttention;
}

// Filters the pull requests that are direct children of a container (a root
// branch content or a .children element), recursing into their own children.
// Returns the counts of the whole subtree.
function filterChildren(container, pass) {
    let total = 0;
    let visible = 0;
    for (let child = container.firstElementChild; child; child = child.nextElementSibling) {
        if (!child.classList.contains('pull-request')) {
            continue;
        }
        const counts = filterPullRequest(child, pass);
        total += counts.total;
        visible += counts.visible;
    }
    return { total, visible };
}

function filterPullRequest(pullRequestElement, pass) {
    // Children first, so the visibility of a filtered-out parent can depend on them
    const childrenContainer = pullRequestElement.nextElementSibling;
    const hasChildren = childrenContainer && childrenContainer.classList.contains('children');
    const children = hasChildren ? filterChildren(childrenContainer, pass) : { total: 0, visible: 0 };

    const entry = pass.index.pullRequestsById.get(Number(pullRequestElement.dataset.id));
    let isVisible = false;
    if (entry) {
        // Attention is computed from data before visibility, so the ready filter never
        // depends on what a previous pass rendered
        const { visible, attention } = evaluatePullRequest(entry, pass.filters, {
            statusInProgress: pullRequestElement.classList.contains('status-in-progress'),
            statusInReview: pullRequestElement.classList.contains('status-in-review'),
            hasSyncLabel: pass.pullRequestsWithSyncLabel.has(pullRequestElement.dataset.id)
        });
        isVisible = visible;
        pullRequestElement.classList.toggle('needs-attention', attention.any);
        if (visible && attention.any) {
            pass.shownAttention++;
        }
    }

    // Update visibility state: a filtered-out pull request stays displayed
    // while one of its descendants is visible
    pullRequestElement.classList.toggle('filtered', !isVisible);
    setDisplay(pullRequestElement, (!isVisible && children.visible === 0) ? 'none' : '');

    // The child counter is refreshed only while it is shown (root pull
    // requests permanently, others while collapsed), like before
    if (hasChildren) {
        const childCounter = pullRequestElement.querySelector('.child-counter');
        if (childCounter && childCounter.classList.contains('visible')) {
            updateCounterDisplay(childCounter, children.visible, children.total);
        }
    }

    return { total: children.total + 1, visible: children.visible + (isVisible ? 1 : 0) };
}

// Only touches the style when it changes, to keep style invalidation minimal
function setDisplay(element, value) {
    if (element.style.display !== value) {
        element.style.display = value;
    }
}
