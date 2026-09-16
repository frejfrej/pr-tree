/**
 * The status band of a pull request: the class the tree paints on it, from
 * the statuses of its linked issues and the state of its reviews. The render
 * (app-render.js) and the filter index (app-filter.js) both call it, so the
 * band painted and the band the attention rule reads are one computation.
 * Pure: no DOM.
 */

// The Atlassian agent reviews pull requests too: never a reviewer to count
const excludedReviewer = 'Rovo Dev';

/** The participants other than the author and Rovo Dev: the reviewers the tree shows */
export function otherReviewers(pullRequest) {
    return pullRequest.participants.filter(participant =>
        participant.user.uuid !== pullRequest.author.uuid &&
        participant.user.display_name !== excludedReviewer);
}

/**
 * The class of the band: status-in-progress when a linked issue is in
 * progress; else, when one is in review, status-in-review-all-approved if
 * there are reviewers and every one approved, status-in-review otherwise;
 * else status-resolved when every linked issue is resolved or closed (a pull
 * request without any linked issue included, as it always was); an empty
 * string otherwise, and for a pull request the issue map does not know
 * (no list at all).
 * @param {object} pullRequest - a Bitbucket pull request
 * @param {object[] | null | undefined} linkedIssues - the Jira issues it links, with their status
 * @returns {string}
 */
export function statusClass(pullRequest, linkedIssues) {
    if (!linkedIssues) return '';
    const statuses = linkedIssues.map(issue => issue.fields.status && issue.fields.status.name);
    if (statuses.includes('In Progress')) return 'status-in-progress';
    if (statuses.includes('In Review')) {
        const reviewers = otherReviewers(pullRequest);
        const allApproved = reviewers.length > 0 && reviewers.every(participant => participant.approved);
        return allApproved ? 'status-in-review-all-approved' : 'status-in-review';
    }
    if (statuses.every(status => status === 'Resolved' || status === 'Closed')) return 'status-resolved';
    return '';
}
