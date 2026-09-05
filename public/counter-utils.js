/**
 * Updates the display of a filtered/total counter (repository, root branch or
 * pull-request child counter). The counts themselves are computed by the
 * filter pass in app-filter.js, in the same walk that decides visibility.
 * @param {Element} counterElement - Counter DOM element
 * @param {number} visibleCount - Number of pull requests left visible by the filters
 * @param {number} totalCount - Total number of pull requests
 */
export function updateCounterDisplay(counterElement, visibleCount, totalCount) {
    const isFiltered = visibleCount !== totalCount;
    const displayText = isFiltered ? `${visibleCount}/${totalCount}` : `${totalCount}`;
    if (counterElement.textContent !== displayText) {
        counterElement.textContent = displayText;
    }

    // Update the title attribute for tooltip
    const itemText = totalCount === 1 ? 'pull request' : 'pull requests';
    const titleText = isFiltered
        ? `${visibleCount} filtered ${itemText} out of ${totalCount} total`
        : `${totalCount} ${itemText}`;
    if (counterElement.getAttribute('title') !== titleText) {
        counterElement.setAttribute('title', titleText);
    }
}
