/**
 * Updates the display of a filtered/total counter (repository, root branch or
 * pull-request child counter, or the counter of the orphaned issues section).
 * The counts themselves are computed by the filter pass in app-filter.js, in
 * the same walk that decides visibility.
 * @param {Element} counterElement - Counter DOM element
 * @param {number} visibleCount - Number of pull requests left visible by the filters
 * @param {number} totalCount - Total number of pull requests
 * @param {string} [noun='pull request'] - what is counted, singular
 */
export function updateCounterDisplay(counterElement, visibleCount, totalCount, noun = 'pull request') {
    const isFiltered = visibleCount !== totalCount;
    const displayText = isFiltered ? `${visibleCount}/${totalCount}` : `${totalCount}`;
    if (counterElement.textContent !== displayText) {
        counterElement.textContent = displayText;
    }

    // Update the title attribute for tooltip
    const itemText = totalCount === 1 ? noun : `${noun}s`;
    const titleText = isFiltered
        ? `${visibleCount} filtered ${itemText} out of ${totalCount} total`
        : `${totalCount} ${itemText}`;
    if (counterElement.getAttribute('title') !== titleText) {
        counterElement.setAttribute('title', titleText);
    }
}
