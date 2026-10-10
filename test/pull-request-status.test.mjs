import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otherReviewers, statusClass, syncKey } from '../public/pull-request-status.js';

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

test('statusClass: no linked issues is resolved (every status of none), no issue list is no band', () => {
    assert.equal(statusClass(pullRequest([jane]), []), 'status-resolved');
    assert.equal(statusClass(pullRequest([jane]), null), '');
    assert.equal(statusClass(pullRequest([jane]), undefined), '');
});
