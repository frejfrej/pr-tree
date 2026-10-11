/**
 * The status band of a pull request: the class the tree paints on it, from
 * the statuses of its linked issues and the state of its reviews. The render
 * (app-render.js) and the filter index (app-filter.js) both call it, so the
 * band painted and the band the attention rule reads are one computation;
 * the same goes for its reviewers and its SYNC key. Pure: no DOM.
 */

/**
 * The key of a pull request in a project, "repository/id", as the server
 * keys jiraIssuesMap (project-assembly.mjs): pull-request ids are numbered
 * per repository, so two repositories of a project share ids (#99). The
 * render writes it as the data-id of the row, the filter index is keyed by it.
 */
export function pullRequestKey(pullRequest) {
    return `${pullRequest.source?.repository?.name}/${pullRequest.id}`;
}

// The Atlassian agent reviews pull requests too: never a reviewer to count,
// never a person the participant filter offers
export const atlassianAgent = 'Rovo Dev';

/** The participants other than the author and Rovo Dev: the reviewers the tree shows */
export function otherReviewers(pullRequest) {
    return pullRequest.participants.filter(participant =>
        participant.user.uuid !== pullRequest.author.uuid &&
        participant.user.display_name !== atlassianAgent);
}

/**
 * The key of a pull request in a SYNC statuses response,
 * "repo/destHash..sourceHash" (the server's key, sync-statuses.mjs); a
 * missing hash reads "undefined", a key no response holds (the ! badge)
 */
export function syncKey(pullRequest) {
    return `${pullRequest.source?.repository?.name}/${pullRequest.destination?.commit?.hash}..${pullRequest.source?.commit?.hash}`;
}

/**
 * The class of the band: status-in-progress when a linked issue is in
 * progress; else, when one is in review, status-in-review-all-approved if
 * there are reviewers and every one approved, status-in-review otherwise;
 * else status-resolved when it has linked issues and every one is resolved
 * or closed; an empty string otherwise: no linked issue, or a pull request
 * the issue map does not know (no list at all).
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
    if (statuses.length > 0 && statuses.every(status => status === 'Resolved' || status === 'Closed')) return 'status-resolved';
    return '';
}
