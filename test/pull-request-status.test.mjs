import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otherReviewers, statusClass, syncKey, isDraft, openTaskCount, issueApprovals } from '../public/pull-request-status.js';

const author = { uuid: 'author-uuid', display_name: 'Author' };
const jane = { uuid: 'jane-uuid', display_name: 'Jane' };
const rovoDev = { uuid: 'rovo-uuid', display_name: 'Rovo Dev' };
const pullRequest = (participants, approved = false) => ({
    author,
    participants: [{ user: author, approved: false }, ...participants.map(user => ({ user, approved }))]
});
const issue = status => ({ fields: { status: { name: status } } });

test('syncKey is the key of a SYNC statuses response, "undefined" where a hash is missing', () => {
    const withHashes = { source: { repository: { name: 'repo' }, commit: { hash: 's1' } }, destination: { commit: { hash: 'd1' } } };
    assert.equal(syncKey(withHashes), 'repo/d1..s1');
    assert.equal(syncKey({ ...withHashes, destination: {} }), 'repo/undefined..s1');
});

test('otherReviewers leaves out the author and Rovo Dev', () => {
    assert.deepEqual(otherReviewers(pullRequest([jane, rovoDev])).map(participant => participant.user.display_name), ['Jane']);
    assert.deepEqual(otherReviewers(pullRequest([])), []);
});

test('statusClass: in progress wins, then in review (all approved or not), then resolved', () => {
    assert.equal(statusClass(pullRequest([jane]), [issue('In Review'), issue('In Progress')]), 'status-in-progress');
    assert.equal(statusClass(pullRequest([jane]), [issue('In Review'), issue('Resolved')]), 'status-in-review');
    assert.equal(statusClass(pullRequest([jane], true), [issue('In Review')]), 'status-in-review-all-approved');
    assert.equal(statusClass(pullRequest([rovoDev], true), [issue('In Review')]), 'status-in-review'); // Rovo Dev is not a reviewer: nobody approved
    assert.equal(statusClass(pullRequest([]), [issue('In Review')]), 'status-in-review'); // no reviewer at all
    assert.equal(statusClass(pullRequest([jane]), [issue('Resolved'), issue('Closed')]), 'status-resolved');
    assert.equal(statusClass(pullRequest([jane]), [issue('Ready')]), '');
    assert.equal(statusClass(pullRequest([jane]), [{ fields: {} }]), ''); // an issue without a status
});

test('statusClass: no linked issue and no issue list are no band', () => {
    assert.equal(statusClass(pullRequest([jane]), []), '');
    assert.equal(statusClass(pullRequest([jane]), null), '');
    assert.equal(statusClass(pullRequest([jane]), undefined), '');
});

test('isDraft is true for draft: true only', () => {
    assert.equal(isDraft({ draft: true }), true);
    for (const draft of [false, undefined, null, 'true', 1]) assert.equal(isDraft({ draft }), false, String(draft));
});

test('openTaskCount is task_count when a positive integer, 0 otherwise', () => {
    assert.equal(openTaskCount({ task_count: 3 }), 3);
    for (const taskCount of [0, -1, 1.5, null, undefined, '2']) assert.equal(openTaskCount({ task_count: taskCount }), 0, String(taskCount));
});

test('issueApprovals: who approved an issue (approvers or not) and the approvers who have not, each once, without Rovo Dev or a nameless person (#146)', () => {
    const user = (id, displayName) => ({ accountId: id, displayName });
    const [ann, bob, cleo, dan] = [user('a', 'Ann'), user('b', 'Bob'), user('c', 'Cleo'), user('d', 'Dan')];
    const approvals = fields => {
        const { approved, pending } = issueApprovals({ fields });
        return { approved: approved.map(u => u.displayName), pending: pending.map(u => u.displayName) };
    };
    assert.deepEqual(approvals({ approvers: [ann, bob, cleo], approvedBy: [dan, cleo] }), { approved: ['Dan', 'Cleo'], pending: ['Ann', 'Bob'] });
    assert.deepEqual(approvals({ approvers: [ann, ann], approvedBy: [] }), { approved: [], pending: ['Ann'] }); // once each
    assert.deepEqual(approvals({ approvers: [ann, user('r', 'Rovo Dev'), { accountId: 'x' }], approvedBy: [] }), { approved: [], pending: ['Ann'] });
    // Approved under an entry without a name: still approved, under the name the approvers give
    assert.deepEqual(approvals({ approvers: [ann], approvedBy: [{ accountId: 'a' }] }), { approved: ['Ann'], pending: [] });
    // No approval fields (an older server) or null ones
    assert.deepEqual(approvals({}), { approved: [], pending: [] });
    assert.deepEqual(approvals({ approvers: null, approvedBy: null }), { approved: [], pending: [] });
});
