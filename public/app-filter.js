// app-filter.js

let currentApiResult = null;

export function initializeFilter(apiResult) {
    currentApiResult = apiResult;
}

export function filterPullRequests(author, reviewer) {
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
    for (let i = pullRequests.length - 1; i >= 0; i--) {
        let pr = pullRequests[i];
        let prId = pr.dataset.id;
        let pullRequestData = currentApiResult.pullRequests.find(p => p.id === parseInt(prId));

        let isVisible = isPullRequestVisible(pullRequestData, author, reviewer);

        // Check if this pull request has children
        let childrenContainer = pr.nextElementSibling;
        if (childrenContainer && childrenContainer.classList.contains('children')) {
            // If it has children, check if any of them are visible
            let visibleChildren = filterBranch(childrenContainer, author, reviewer);
            isVisible = isVisible || visibleChildren > 0;
        }

        pr.classList.toggle("filtered", !isVisible);
        if (isVisible) {
            visiblePullRequests++;
            updatePullRequestStyle(pr, pullRequestData, author, reviewer);
        }
    }

    // Hide branch if no visible pull requests
    branch.style.display = visiblePullRequests > 0 ? "" : "none";

    return visiblePullRequests;
}

function isPullRequestVisible(pullRequest, author, reviewer) {
    if (author === "Show all" && reviewer === "Show all") {
        return true;
    }

    if (pullRequest.author.display_name === author) {
        return true;
    }

    if (reviewer !== "Show all") {
        return pullRequest.participants.some(p => p.user.display_name === reviewer);
    }

    return false;
}

function updatePullRequestStyle(prElement, pullRequestData, author, reviewer) {
    let title = prElement.querySelector("a");
    let titleColor = "black";

    if (author !== "Show all" && pullRequestData.author.display_name === author) {
        if (prElement.classList.contains("status-in-progress")) {
            titleColor = "var(--secondary-color)";
        }
    } else if (reviewer !== "Show all") {
        let reviewerParticipant = pullRequestData.participants.find(p => p.user.display_name === reviewer);
        if (reviewerParticipant && !reviewerParticipant.approved && !prElement.classList.contains("status-in-progress")) {
            titleColor = "var(--secondary-color)";
        }
    }

    title.style.color = titleColor;
}