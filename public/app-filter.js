import { updateAllCounters } from './counter-utils.js';

let currentApiResult = null;

export function initializeFilter(apiResult) {
    currentApiResult = apiResult;
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

function getLinkedIssues(pullRequestData) {
    const keys = currentApiResult.jiraIssuesMap[pullRequestData.id] || [];
    return keys
        .map(key => currentApiResult.jiraIssuesDetails.find(issue => issue.key === key))
        .filter(issue => issue);
}

/**
 * Applies the filters to the rendered tree and refreshes the counters.
 * @returns {number} how many pull requests are left shown and need attention
 */
export function filterBranches(assignees, reviewers, sprints, fixVersions, sync, ready) {
    // Start filtering from the root branches
    let rootBranches = document.getElementsByClassName("root-branch");
    Array.from(rootBranches).forEach(rootBranch => {
        filterBranch(rootBranch, assignees, reviewers, sprints, fixVersions, sync, ready);
    });

    // Update all counters after filtering
    // Pass first selected values for backwards compatibility with counter-utils
    const assignee = assignees.length > 0 ? assignees[0] : "Show all";
    const reviewer = reviewers.length > 0 ? reviewers[0] : "Show all";
    const sprint = sprints.length > 0 ? sprints[0] : "Show all";
    updateAllCounters(assignee, reviewer, sprint, sync);

    return countShownAttention();
}

function countShownAttention() {
    return Array.from(document.querySelectorAll('.pull-request.needs-attention'))
        .filter(pr => pr.style.display !== 'none' && !pr.classList.contains('filtered'))
        .length;
}

function filterBranch(branch, assignees, reviewers, sprints, fixVersions, sync, ready) {
    let pullRequests = branch.querySelectorAll(".pull-request");
    let visiblePullRequests = 0;

    // Filter pull requests from bottom to top
    visiblePullRequests += filterPullRequests(pullRequests, assignees, reviewers, sprints, fixVersions, sync, ready);

    // Hide branch if no visible pull requests
    branch.style.display = visiblePullRequests > 0 ? "" : "none";

    return visiblePullRequests;
}

function filterPullRequests(pullRequests, assignees, reviewers, sprints, fixVersions, sync, ready) {
    let visiblePullRequests = 0;
    for (let i = 0; i < pullRequests.length; i++) {
        let pr = pullRequests[i];
        let prId = pr.dataset.id;
        let pullRequestData = currentApiResult.pullRequests.find(p => p.id === parseInt(prId));

        let visibleChildren = 0;

        // Check if this pull request has children
        let childrenContainer = pr.nextElementSibling;
        if (childrenContainer && childrenContainer.classList.contains('children')) {
            // If it has children, check if any of them are visible
            let childrenPullRequests = childrenContainer.querySelectorAll(".pull-request");
            visibleChildren += filterPullRequests(childrenPullRequests, assignees, reviewers, sprints, fixVersions, sync, ready);
            visiblePullRequests += visibleChildren;
        }

        // Attention is computed from data before visibility, so the ready filter never
        // depends on what a previous pass rendered
        const attention = computeAttention(pullRequestData, {
            statusInProgress: pr.classList.contains('status-in-progress'),
            statusInReview: pr.classList.contains('status-in-review'),
            linkedIssues: getLinkedIssues(pullRequestData),
            assignees,
            reviewers
        });
        pr.classList.toggle('needs-attention', attention.any);

        // Check if this pull request should be visible
        let isVisible = isPullRequestVisible(pr, pullRequestData, assignees, reviewers, sprints, fixVersions, sync, ready, attention);

        // Update visibility state
        pr.classList.toggle("filtered", !isVisible);
        pr.style.display = (!isVisible && visibleChildren === 0) ? "none" : "";

        if (isVisible) {
            visiblePullRequests++;
        }
    }

    return visiblePullRequests;
}

function isPullRequestVisible(prElement, pullRequestData, assignees, reviewers, sprints, fixVersions, sync, ready, attention) {
    // Assignee filter - check Jira issue assignees
    // Empty array = show all (no filtering)
    // Non-empty = match ANY selected value
    const assigneeMatch = assignees.length === 0 || (() => {
        const jiraIssueKeys = currentApiResult.jiraIssuesMap[pullRequestData.id] || [];
        return jiraIssueKeys.some(issueKey => {
            const issue = currentApiResult.jiraIssuesDetails.find(i => i.key === issueKey);
            return issue && issue.fields.assignee && assignees.includes(issue.fields.assignee.displayName);
        });
    })();

    // Reviewer filter - match ANY selected reviewer
    const reviewerMatch = reviewers.length === 0 || pullRequestData.participants.some(p =>
        p.user.uuid !== pullRequestData.author.uuid && reviewers.includes(p.user.display_name)
    );

    // Sprint filter - match if ANY linked issue is in ANY selected sprint
    const sprintMatch = sprints.length === 0 || (
        currentApiResult.jiraIssuesMap[pullRequestData.id] &&
        currentApiResult.jiraIssuesMap[pullRequestData.id].some(issueKey =>
            sprints.some(sprintId =>
                currentApiResult.sprintIssues[sprintId] && currentApiResult.sprintIssues[sprintId].includes(issueKey)
            )
        )
    );

    // Fix Version filter - match if ANY linked issue has ANY selected fix version
    const fixVersionMatch = fixVersions.length === 0 || (
        currentApiResult.jiraIssuesMap[pullRequestData.id] &&
        currentApiResult.jiraIssuesMap[pullRequestData.id].some(issueKey => {
            const issueDetails = currentApiResult.jiraIssuesDetails.find(issue => issue.key === issueKey);
            return issueDetails && issueDetails.fields.fixVersions &&
                issueDetails.fields.fixVersions.some(version => fixVersions.includes(String(version.id)));
        })
    );

    // Sync filter
    const syncCounter = prElement.querySelector('.conflicts-counter');
    const syncCountElement = syncCounter ? syncCounter.querySelector('.conflicts-count') : null;
    const hasSyncLabel = syncCountElement !== null;
    const syncMatch = sync === "Show all" ||
        (sync === "requested" && hasSyncLabel) ||
        (sync === "OK" && !hasSyncLabel);

    // Ready for reviewer filter: in review, and a selected reviewer has not approved yet
    const readyMatch = !ready || attention.reviewer;

    return assigneeMatch && reviewerMatch && sprintMatch && fixVersionMatch && syncMatch && readyMatch;
}
