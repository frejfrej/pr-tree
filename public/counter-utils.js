/**
 * Updates all pull request counters in the UI to show filtered/total counts
 * @param {string} assignee - Selected assignee filter
 * @param {string} reviewer - Selected reviewer filter
 * @param {string} sprint - Selected sprint filter
 */
export function updateAllCounters(assignee, reviewer, sprint) {
    // Update repository counters
    const repositories = document.querySelectorAll('.repository');
    repositories.forEach(repo => updateRepositoryCounter(repo, assignee, reviewer, sprint));

    // Update branch counters
    const branches = document.querySelectorAll('.root-branch');
    branches.forEach(branch => updateBranchCounter(branch, assignee, reviewer, sprint));

    // Update pull request child counters
    const pullRequests = document.querySelectorAll('.pull-request');
    pullRequests.forEach(pr => updatePullRequestCounter(pr, assignee, reviewer, sprint));
}

/**
 * Updates the counter for a repository
 * @param {Element} repository - Repository DOM element
 * @param {string} assignee - Selected assignee filter
 * @param {string} reviewer - Selected reviewer filter
 * @param {string} sprint - Selected sprint filter
 */
function updateRepositoryCounter(repository, assignee, reviewer, sprint) {
    const counter = repository.querySelector('.repo-pr-counter');
    if (!counter) return;

    const pullRequests = repository.querySelectorAll('.pull-request');
    const totalCount = pullRequests.length;
    const visibleCount = Array.from(pullRequests).filter(pr =>
        pr.style.display !== 'none' && !pr.classList.contains('filtered')
    ).length;

    updateCounterDisplay(counter, visibleCount, totalCount);
}

/**
 * Updates the counter for a branch
 * @param {Element} branch - Branch DOM element
 * @param {string} assignee - Selected assignee filter
 * @param {string} reviewer - Selected reviewer filter
 * @param {string} sprint - Selected sprint filter
 */
function updateBranchCounter(branch, assignee, reviewer, sprint) {
    const counter = branch.querySelector('.branch-pr-counter');
    if (!counter) return;

    const pullRequests = branch.querySelectorAll('.pull-request');
    const totalCount = pullRequests.length;
    const visibleCount = Array.from(pullRequests).filter(pr =>
        pr.style.display !== 'none' && !pr.classList.contains('filtered')
    ).length;

    updateCounterDisplay(counter, visibleCount, totalCount);
}

/**
 * Updates the counter for a pull request's children
 * @param {Element} pullRequest - Pull request DOM element
 * @param {string} assignee - Selected assignee filter
 * @param {string} reviewer - Selected reviewer filter
 * @param {string} sprint - Selected sprint filter
 */
function updatePullRequestCounter(pullRequest, assignee, reviewer, sprint) {
    const counter = pullRequest.querySelector('.child-counter');
    if (!counter || !counter.classList.contains('visible')) return;

    const children = pullRequest.nextElementSibling;
    if (!children || !children.classList.contains('children')) return;

    const childPullRequests = children.querySelectorAll('.pull-request');
    const totalCount = childPullRequests.length;
    const visibleCount = Array.from(childPullRequests).filter(pr =>
        pr.style.display !== 'none' && !pr.classList.contains('filtered')
    ).length;

    updateCounterDisplay(counter, visibleCount, totalCount);
}

/**
 * Updates the display of a counter element
 * @param {Element} counterElement - Counter DOM element
 * @param {number} visibleCount - Number of visible/filtered items
 * @param {number} totalCount - Total number of items
 */
function updateCounterDisplay(counterElement, visibleCount, totalCount) {
    const isFiltered = visibleCount !== totalCount;
    const displayText = isFiltered ? `${visibleCount}/${totalCount}` : `${totalCount}`;
    counterElement.textContent = displayText;

    // Update the title attribute for tooltip
    const itemText = totalCount === 1 ? 'pull request' : 'pull requests';
    const titleText = isFiltered
        ? `${visibleCount} filtered ${itemText} out of ${totalCount} total`
        : `${totalCount} ${itemText}`;
    counterElement.setAttribute('title', titleText);
}