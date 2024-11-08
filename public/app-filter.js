import { updateAllCounters } from './counter-utils.js';

let currentApiResult = null;

export function initializeFilter(apiResult) {
    currentApiResult = apiResult;
}

export function filterBranches(author, reviewer, sprint, sync, ready) {
    // Start filtering from the root branches
    let rootBranches = document.getElementsByClassName("root-branch");
    Array.from(rootBranches).forEach(rootBranch => {
        filterBranch(rootBranch, author, reviewer, sprint, sync, ready);
    });

    // Update all counters after filtering
    updateAllCounters(author, reviewer, sprint, sync);
}

function filterBranch(branch, author, reviewer, sprint, sync, ready) {
    let pullRequests = branch.querySelectorAll(".pull-request");
    let visiblePullRequests = 0;

    // Filter pull requests from bottom to top
    visiblePullRequests += filterPullRequests(pullRequests, author, reviewer, sprint, sync, ready);

    // Hide branch if no visible pull requests
    branch.style.display = visiblePullRequests > 0 ? "" : "none";

    return visiblePullRequests;
}

function filterPullRequests(pullRequests, author, reviewer, sprint, sync, ready) {
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
            visibleChildren += filterPullRequests(childrenPullRequests, author, reviewer, sprint, sync, ready);
            visiblePullRequests += visibleChildren;
        }

        // Check if this pull request should be visible
        let isVisible = isPullRequestVisible(pr, pullRequestData, author, reviewer, sprint, sync, ready);

        // Update visibility state
        pr.classList.toggle("filtered", !isVisible);
        pr.style.display = (!isVisible && visibleChildren === 0) ? "none" : "";

        if (isVisible) {
            visiblePullRequests++;
            updatePullRequestStyle(pr, pullRequestData, author, reviewer, sprint);
        }
    }

    return visiblePullRequests;
}

function isPullRequestVisible(prElement, pullRequestData, author, reviewer, sprint, sync, ready) {
    // Basic filters
    const authorMatch = author === "Show all" || pullRequestData.author.display_name === author;
    const reviewerMatch = reviewer === "Show all" || pullRequestData.participants.some(p =>
        p.user.uuid !== pullRequestData.author.uuid && p.user.display_name === reviewer
    );

    // Sprint filter
    const sprintMatch = sprint === "Show all" || (
        currentApiResult.jiraIssuesMap[pullRequestData.id] &&
        currentApiResult.jiraIssuesMap[pullRequestData.id].some(issueKey =>
            currentApiResult.sprintIssues[sprint] && currentApiResult.sprintIssues[sprint].includes(issueKey)
        )
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

    return authorMatch && reviewerMatch && sprintMatch && syncMatch && readyMatch;
}

// Update the updatePullRequestStyle function in app-filter.js
function updatePullRequestStyle(prElement, pullRequestData, author, reviewer) {
    let title = prElement.querySelector("a");
    let titleColor = "";

    if (author !== "Show all" && pullRequestData.author.display_name === author) {
        if (prElement.classList.contains("status-in-progress")) {
            titleColor = "var(--secondary-color)";
        }
    }

    if (reviewer !== "Show all") {
        let reviewerParticipant = pullRequestData.participants.find(p => p.user.uuid !== pullRequestData.author.uuid && p.user.display_name === reviewer);
        if (reviewerParticipant && !reviewerParticipant.approved && prElement.classList.contains("status-in-review")) {
            titleColor = "var(--secondary-color)";
        }
    }

    if (titleColor) {
        title.style.color = titleColor;
    } else {
        title.style.color = ""; // Reset color if no condition is met
    }
}