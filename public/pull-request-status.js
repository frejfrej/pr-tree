/**
 * The status band of a pull request: the class the tree paints on it, from
 * the statuses of its linked issues and the state of its reviews. The render
 * (app-render.js) and the filter index (app-filter.js) both call it, so the
 * band painted and the band the attention rule reads are one computation;
 * the same goes for its reviewers, its draft state, its open tasks and its
 * SYNC key, and for the Jira approvals of an issue in review without a pull
 * request (#146). Pure: no DOM.
 */

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
 * The Jira approvals of an issue in review without a pull request (#146), the
 * row and the filter index alike: the people who approved it (Approved by,
 * listed as approvers or not) and the approvers who have not, each person once
 * by account id (in Approved by order, then Approvers order), with the name
 * either list gives; Rovo Dev and a person without a name are left out, as
 * from the reviewers of a pull request.
 * @param {object} issue - an orphaned issue, fields.approvers and fields.approvedBy as the server renames them
 * @returns {{ approved: object[], pending: object[] }} Jira users
 */
export function issueApprovals(issue) {
    const approvedBy = issue.fields.approvedBy || [];
    const approvedIds = new Set(approvedBy.map(user => user.accountId));
    const people = new Map();
    for (const user of [...approvedBy, ...(issue.fields.approvers || [])]) {
        if (!people.get(user.accountId)?.displayName) people.set(user.accountId, user);
    }
    const counted = [...people.values()].filter(user => user.displayName && user.displayName !== atlassianAgent);
    return {
        approved: counted.filter(user => approvedIds.has(user.accountId)),
        pending: counted.filter(user => !approvedIds.has(user.accountId))
    };
}

/** A draft: its author wants no review yet (the badge, the attention rule, Hide drafts) */
export function isDraft(pullRequest) {
    return pullRequest.draft === true;
}

/**
 * The open tasks of a pull request (Bitbucket's task_count): the requests its
 * reviewers left, and any to-do its author added, all waiting for the author
 * (the badge, the attention rule); 0 when the count is missing or not a
 * positive integer
 */
export function openTaskCount(pullRequest) {
    const taskCount = pullRequest.task_count;
    return Number.isInteger(taskCount) && taskCount > 0 ? taskCount : 0;
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
 * the issue map does not know (no list at all). A pull request in review
 * that every reviewer approved but with open tasks is not approved: the
 * tasks are the assignee's work, so it takes the in-progress band, as its
 * attention says (app-filter.js computeAttention).
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
        if (!allApproved) return 'status-in-review';
        return openTaskCount(pullRequest) > 0 ? 'status-in-progress' : 'status-in-review-all-approved';
    }
    if (statuses.length > 0 && statuses.every(status => status === 'Resolved' || status === 'Closed')) return 'status-resolved';
    return '';
}
