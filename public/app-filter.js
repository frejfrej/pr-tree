import { updateAllCounters } from './counter-utils.js';

let currentApiResult = null;

export function initializeFilter(apiResult) {
    currentApiResult = apiResult;
}

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

        // Check if this pull request should be visible
        let isVisible = isPullRequestVisible(pr, pullRequestData, assignees, reviewers, sprints, fixVersions, sync, ready);

        // Update visibility state
        pr.classList.toggle("filtered", !isVisible);
        pr.style.display = (!isVisible && visibleChildren === 0) ? "none" : "";

        if (isVisible) {
            visiblePullRequests++;
            updatePullRequestStyle(pr, pullRequestData, assignees, reviewers, sprints);
        }
    }

    return visiblePullRequests;
}

function isPullRequestVisible(prElement, pullRequestData, assignees, reviewers, sprints, fixVersions, sync, ready) {
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

    // Ready for reviewer filter
    let readyMatch = true;
    if (ready) {
        const isInReview = prElement.classList.contains('status-in-review');
        const link = prElement.querySelector('.pull-request-link');
        const style = window.getComputedStyle(link);
        const hasSecondaryColor = style.color === 'rgb(255, 86, 48)'; // --secondary-color in RGB
        readyMatch = isInReview && hasSecondaryColor;
    }

    return assigneeMatch && reviewerMatch && sprintMatch && fixVersionMatch && syncMatch && readyMatch;
}

// Update the updatePullRequestStyle function in app-filter.js
function updatePullRequestStyle(prElement, pullRequestData, assignees, reviewers) {
    let title = prElement.querySelector("a");
    let titleColor = "";

    // Check if any Jira issue for this PR is assigned to any filtered assignee
    if (assignees.length > 0) {
        const jiraIssueKeys = currentApiResult.jiraIssuesMap[pullRequestData.id] || [];
        const hasAssignee = jiraIssueKeys.some(issueKey => {
            const issue = currentApiResult.jiraIssuesDetails.find(i => i.key === issueKey);
            return issue && issue.fields.assignee && assignees.includes(issue.fields.assignee.displayName);
        });

        if (hasAssignee && prElement.classList.contains("status-in-progress")) {
            titleColor = "var(--secondary-color)";
        }
    }

    if (reviewers.length > 0) {
        // Check if any selected reviewer has not approved this PR
        let hasUnapprovedReviewer = reviewers.some(reviewer => {
            let reviewerParticipant = pullRequestData.participants.find(p =>
                p.user.uuid !== pullRequestData.author.uuid && p.user.display_name === reviewer
            );
            return reviewerParticipant && !reviewerParticipant.approved;
        });

        if (hasUnapprovedReviewer && prElement.classList.contains("status-in-review")) {
            titleColor = "var(--secondary-color)";
        }
    }

    if (titleColor) {
        title.style.color = titleColor;
    } else {
        title.style.color = ""; // Reset color if no condition is met
    }
}