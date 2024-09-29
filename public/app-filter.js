// app-filter.js

let currentApiResult = null;

export function initializeFilter(apiResult) {
    currentApiResult = apiResult;
}

export function filterBranches(author, reviewer) {
    // Start filtering from the root branches
    let rootBranches = document.getElementsByClassName("root-branch");
    Array.from(rootBranches).forEach(rootBranch => {
        filterBranch(rootBranch, author, reviewer);
    });
}

function filterBranch(branch, author, reviewer) {
    let pullRequests = branch.querySelectorAll(".pull-request");
    let visiblePullRequests = 0;

    // Filter pull requests from bottom to top
    visiblePullRequests += filterPullRequests(pullRequests, author, reviewer);

    // Hide branch if no visible pull requests
    branch.style.display = visiblePullRequests > 0 ? "" : "none";

    return visiblePullRequests;
}

function filterPullRequests(pullRequests, author, reviewer) {
    let visiblePullRequests = 0;
    for (let i = 0 ; i < pullRequests.length; i++) {
        let pr = pullRequests[i];
        let prId = pr.dataset.id;
        let pullRequestData = currentApiResult.pullRequests.find(p => p.id === parseInt(prId));

        let visibleChildren = 0;

        // Check if this pull request has children
        let childrenContainer = pr.nextElementSibling;
        if (childrenContainer && childrenContainer.classList.contains('children')) {
            // If it has children, check if any of them are visible
            let childrenPullRequests = childrenContainer.querySelectorAll(".pull-request");
            visibleChildren += filterPullRequests(childrenPullRequests, author, reviewer);
            visiblePullRequests += visibleChildren;
        }
        // based on whether this pull request has visible children, or should itself be visible...
        let isVisible = isPullRequestVisible(pullRequestData, author, reviewer);

        // ... we'll make it smaller if it's no match for our filter...
        pr.classList.toggle("filtered", !isVisible);
        // ... and even hide it if nothing is visible starting from here
        pr.style.display = (!isVisible && visibleChildren === 0) ? "none" : "";

        // whereas in case it's visible, we'll update the style and our return counter
        if (isVisible) {
            visiblePullRequests++;
            updatePullRequestStyle(pr, pullRequestData, author, reviewer);
        }
    }

    return visiblePullRequests;
}


function isPullRequestVisible(pullRequestData, author, reviewer) {
    if (author === "Show all" && reviewer === "Show all") {
        return true;
    }

    if (pullRequestData.author.display_name === author) {
        return true;
    }

    if (reviewer !== "Show all") {
        return pullRequestData.participants.some(p => p.user.uuid != pullRequestData.author.uuid && p.user.display_name === reviewer);
    }

    return false;
}

function updatePullRequestStyle(prElement, pullRequestData, author, reviewer) {
    let title = prElement.querySelector("a");
    let titleColor = "";

    if (author !== "Show all" && pullRequestData.author.display_name === author) {
        if (prElement.classList.contains("status-in-progress")) {
            titleColor = "var(--secondary-color)";
        }
    } else if (reviewer !== "Show all") {
        let reviewerParticipant = pullRequestData.participants.find(p => p.user.uuid != pullRequestData.author.uuid && p.user.display_name === reviewer);
        if (reviewerParticipant && !reviewerParticipant.approved && prElement.classList.contains("status-in-review")) {
            titleColor = "var(--secondary-color)";
        }
    }

    if (titleColor) {
        title.style.color = titleColor;
    }
}