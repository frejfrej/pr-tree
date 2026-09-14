import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateProjectData } from '../fixtures/generate.mjs';
import { renderRepositories, renderOrphanedIssues, findRootBranches, calculateTotalPullRequests, calculateDescendants, renderParticipant, escapeHtml } from '../public/app-render.js';

const projects = createRequire(import.meta.url)('../projects.js');

function count(html, needle) {
    return html.split(needle).length - 1;
}

const author = { account_id: 'author-id', uuid: 'author-uuid', display_name: 'Author', links: { avatar: { href: 'https://avatars/author.png' } } };
const jane = { account_id: 'jane-id', uuid: 'jane-uuid', display_name: 'Jane', links: { avatar: { href: 'https://avatars/jane.png' } } };
const bob = { account_id: 'bob-id', uuid: 'bob-uuid', display_name: 'Bob', links: { avatar: { href: 'https://avatars/bob.png' } } };
const rovoDev = { account_id: 'rovo-id', uuid: 'rovo-uuid', display_name: 'Rovo Dev', links: { avatar: { href: 'https://avatars/rovo.png' } } };

function pullRequest(id, { repo = 'repo-one', source, destination, participants = [], updated = '2026-09-01T10:00:00.000Z', ahead = 0, behind = null } = {}) {
    return {
        id,
        title: `PR ${id}`,
        created_on: '2026-08-30T09:00:00.000Z',
        updated_on: updated,
        commitsAhead: ahead,
        commitsBehind: behind,
        author,
        participants: [{ user: author, approved: false, state: null }, ...participants],
        source: {
            branch: { name: source },
            commit: { hash: `s${id}` },
            repository: { name: repo, links: { html: { href: `https://bitbucket.org/ws/${repo}` } } }
        },
        destination: { branch: { name: destination }, commit: { hash: `d${id}` } },
        links: { html: { href: `https://bitbucket.org/ws/${repo}/pull-requests/${id}` } },
        rendered: { title: { html: `<p>PR ${id}</p>` }, description: { html: '' } }
    };
}

// repo-one: main <- PR 1 <- PR 2 (stacked); repo-two: develop <- PR 3 (approved by Jane), PR 4 (more recent)
const stacked = pullRequest(1, { source: 'feat-a', destination: 'main', ahead: 2, behind: 3 });
const child = pullRequest(2, { source: 'feat-b', destination: 'feat-a' });
const approved = pullRequest(3, { repo: 'repo-two', source: 'feat-c1', destination: 'develop', participants: [{ user: jane, approved: true, state: 'approved' }], updated: '2026-09-02T10:00:00.000Z', behind: 100 });
const recent = pullRequest(4, { repo: 'repo-two', source: 'feat-c2', destination: 'develop', updated: '2026-09-03T10:00:00.000Z' });
const pullRequests = [stacked, child, approved, recent];
const byDestination = new Map([['main', [stacked]], ['feat-a', [child]], ['develop', [approved, recent]]]);
const jiraIssuesMap = { '1': ['PROJ-1'], '3': ['PROJ-2'] };
const jiraIssuesDetails = [
    { key: 'PROJ-1', fields: { summary: 'First', status: { name: 'In Progress' }, priority: { name: 'High', iconUrl: 'https://jira/high.svg' } } },
    { key: 'PROJ-2', fields: { summary: 'Second', status: { name: 'In Review' }, priority: null } }
];

function renderSample() {
    return renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, byDestination, 'site');
}

// The classes of every pull request element, by id: { '1': ['pull-request', 'status-in-progress', 'pull-request-root'], ... }
function pullRequestClasses(html) {
    return Object.fromEntries(Array.from(html.matchAll(/<div class="(pull-request[^"]*)" data-id="(\d+)">/g), match => [match[2], match[1].split(/\s+/).filter(Boolean)]));
}

test('findRootBranches keeps the destination branches that are no pull request source', () => {
    assert.deepEqual(findRootBranches(pullRequests), ['main', 'develop']);
});

test('calculateTotalPullRequests and calculateDescendants count the whole stack', () => {
    assert.equal(calculateTotalPullRequests([stacked], byDestination), 2);
    assert.equal(calculateTotalPullRequests([approved, recent], byDestination), 2);
    assert.equal(calculateDescendants(stacked, byDestination), 1);
    assert.equal(calculateDescendants(child, byDestination), 0);

    // A chain of five pull requests: the root has four descendants
    const chain = Array.from({ length: 5 }, (_, i) => pullRequest(10 + i, { source: `step-${i + 1}`, destination: i === 0 ? 'main' : `step-${i}` }));
    const chainByDestination = new Map(chain.map(pr => [pr.destination.branch.name, [pr]]));
    assert.equal(calculateDescendants(chain[0], chainByDestination), 4);
    assert.equal(calculateTotalPullRequests([chain[0]], chainByDestination), 5);
});

test('renderRepositories renders one block per repository with its root branches and counters', () => {
    const html = renderSample();
    assert.equal(count(html, '<div class="repository">'), 2);
    assert.ok(html.includes('<h2 class="repository-name">repo-one</h2>'));
    assert.ok(html.includes('<h2 class="repository-name">repo-two</h2>'));
    assert.equal(count(html, 'class="root-branch"'), 2);
    assert.ok(html.includes('href="https://bitbucket.org/ws/repo-one/branch/main"'));
    assert.ok(html.includes('href="https://bitbucket.org/ws/repo-two/branch/develop"'));
    // Root branch counters include the descendants: main has 1 + 1, develop 2
    assert.equal(count(html, 'title="2 total pull requests (including all descendants)"'), 2);
    assert.equal(count(html, 'class="pull-request '), 4);
    // The no-match message is rendered hidden after the repositories; the filter pass shows it
    assert.equal(count(html, '<div class="state-message tree-no-match" hidden>'), 1);
});

test('renderRepositories renders nothing, not even the no-match message, without pull requests', () => {
    assert.equal(renderRepositories([], {}, [], new Map(), 'site'), '');
});

test('renderRepositories nests a stacked pull request under its parent, most recent siblings first', () => {
    const html = renderSample();
    assert.equal(count(html, '<div class="children">'), 1);
    assert.ok(html.indexOf('<div class="children">') < html.indexOf('data-id="2"'));
    assert.ok(html.indexOf('data-id="1"') < html.indexOf('<div class="children">'));
    // Under develop, PR 4 (updated later) comes before PR 3
    assert.ok(html.indexOf('data-id="4"') < html.indexOf('data-id="3"'));
    // The parent gets a toggle button and a visible child counter; the child, neither
    assert.ok(html.includes('title="1 descendant pull request"'));
    assert.equal(count(html, 'onclick="toggleChildren(this)"'), 1);
    assert.equal(count(html, 'class="child-counter visible"'), 3);
});

test('renderRepositories derives the status class from the linked issues and the reviews', () => {
    const classes = pullRequestClasses(renderSample());
    assert.deepEqual(classes['1'], ['pull-request', 'status-in-progress', 'pull-request-root']);
    assert.deepEqual(classes['2'], ['pull-request']);
    assert.deepEqual(classes['3'], ['pull-request', 'status-in-review-all-approved', 'pull-request-root']);
    assert.deepEqual(classes['4'], ['pull-request', 'pull-request-root']);
});

test('renderRepositories: review states, resolved issues, the Rovo Dev exclusion, a slash in a root branch, a missing commit', () => {
    // PR 5: issues In Review and Resolved, Jane requested changes, Bob has not reviewed yet
    const reviewed = pullRequest(5, { source: 'feat/e', destination: 'release/2026.09', participants: [{ user: jane, approved: false, state: 'changes_requested' }, { user: bob, approved: false, state: null }] });
    // PR 6: issues Resolved and Closed, Rovo Dev is its only other participant, no destination commit
    const resolved = pullRequest(6, { source: 'feat/f', destination: 'release/2026.09', participants: [{ user: rovoDev, approved: true, state: 'approved' }] });
    resolved.destination.commit = undefined;
    const byDest = new Map([['release/2026.09', [reviewed, resolved]]]);
    const issuesMap = { '5': ['PROJ-5', 'PROJ-6'], '6': ['PROJ-7', 'PROJ-8'] };
    const details = [
        { key: 'PROJ-5', fields: { summary: 'Five', status: { name: 'In Review' }, priority: null } },
        { key: 'PROJ-6', fields: { summary: 'Six', status: { name: 'Resolved' }, priority: null } },
        { key: 'PROJ-7', fields: { summary: 'Seven', status: { name: 'Resolved' }, priority: null } },
        { key: 'PROJ-8', fields: { summary: 'Eight', status: { name: 'Closed' }, priority: null } }
    ];
    const html = renderRepositories([reviewed, resolved], issuesMap, details, byDest, 'site');
    const classes = pullRequestClasses(html);
    assert.deepEqual(classes['5'], ['pull-request', 'status-in-review', 'pull-request-root']);
    assert.deepEqual(classes['6'], ['pull-request', 'status-resolved', 'pull-request-root']);
    assert.ok(html.includes('data-author="Jane" data-review-status="requestedChanges"'));
    assert.ok(html.includes('data-author="Bob" data-review-status="toReview"'));
    assert.ok(!html.includes('data-author="Rovo Dev"'));
    // Both pull requests link issues with different statuses; only PR 6 lacks other participants (Rovo Dev does not count)
    assert.equal(count(html, '<div class="warnings">'), 2);
    assert.equal(count(html, '<li><i class="fas fa-exclamation-triangle red" title="JIRA issues have different statuses">'), 2);
    assert.equal(count(html, '<li><i class="fas fa-exclamation-triangle red" title="Pull request has no other participants">'), 1);
    assert.ok(html.includes('href="https://bitbucket.org/ws/repo-one/branch/release%2F2026.09"'));
    assert.ok(html.includes('data-spec="undefined..s6"'));
});

test('renderRepositories renders the issues, participants, commit badges and alerts of a pull request', () => {
    const html = renderSample();
    assert.ok(html.includes('data-issue-key="PROJ-1"'));
    assert.ok(html.includes('PROJ-1 (In Progress)'));
    assert.ok(html.includes('href="https://site.atlassian.net/browse/PROJ-2"'));
    assert.equal(count(html, 'class="jira-priority-icon"'), 1);
    assert.ok(html.includes('data-author="Jane" data-review-status="approved"'));
    assert.equal(count(html, 'data-review-status="author"'), 4);
    assert.ok(html.includes('</i>+2'));
    assert.ok(html.includes('</i>-3'));
    assert.ok(html.includes('</i>at least -100'));
    assert.ok(html.includes('Pull request has no other participants'));
});

test('renderRepositories writes what the popovers and the SYNC badges read back', () => {
    const html = renderSample();
    assert.ok(html.includes(`data-rendered-title="${encodeURIComponent('<p>PR 1</p>')}"`));
    assert.ok(html.includes(`data-rendered-description="${encodeURIComponent('No description provided.')}"`));
    assert.ok(html.includes('data-repo-name="repo-one"'));
    assert.ok(html.includes('data-spec="d1..s1"'));
});

test('renderRepositories renders every pull request of the fixture projects once, deep stack included', () => {
    for (const [name, config] of Object.entries(projects)) {
        const data = generateProjectData(name, config);
        const byDest = new Map(Object.entries(data.pullRequestsByDestination));
        const html = renderRepositories(data.pullRequests, data.jiraIssuesMap, data.jiraIssuesDetails, byDest, data.jiraSiteName);
        assert.equal(count(html, 'class="pull-request '), data.pullRequests.length, name);
        assert.equal(count(html, '<div class="repository">'), new Set(data.pullRequests.map(pr => pr.source.repository.name)).size, name);
        assert.equal(count(html, '<div class="children">'), data.pullRequests.filter(pr => byDest.has(pr.source.branch.name)).length, name);
        assert.equal(count(html, 'tree-no-match'), 1, name);
    }
});

test('renderOrphanedIssues renders nothing without issues, otherwise a repository block with one row per issue', () => {
    assert.equal(renderOrphanedIssues([], 'site'), '');
    assert.equal(renderOrphanedIssues(undefined, 'site'), '');
    const now = Date.parse('2026-09-14T12:00:00.000Z');
    const html = renderOrphanedIssues([
        { key: 'PROJ-9', fields: { summary: 'Nine', status: { name: 'In Review' }, priority: { name: 'Low', iconUrl: 'https://jira/low.svg' }, updated: '2026-08-31T11:00:00.000+0000', assignee: { displayName: 'Jane', avatarUrls: { '24x24': 'https://avatars/jane-24.png', '48x48': 'https://avatars/jane-48.png' } } } }, // the offset as Jira writes it
        { key: 'PROJ-10', fields: { summary: 'Ten', status: { name: 'In Review' }, priority: null, updated: '2026-09-01T12:00:00.000Z', assignee: null } }
    ], 'site', { now });
    // A repository block: the tree's toggle, collapse-all and toggle-state code applies to it
    assert.equal(count(html, 'class="repository orphaned-issues"'), 1);
    assert.ok(html.includes('onclick="toggleRepository(this)"'));
    assert.ok(html.includes('<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle Jira issues in review without a pull request">'));
    assert.ok(html.includes('Jira issues in review without a pull request'));
    assert.match(html, /<div class="repo-pr-counter" title="2 issues">\s*2\s*<\/div>/);
    // One row per issue, keyed for the filter pass, with the in-review border
    assert.equal(count(html, 'class="orphaned-issue status-in-review"'), 2);
    assert.ok(html.includes('data-issue-key="PROJ-9"') && html.includes('data-issue-key="PROJ-10"'));
    assert.equal(count(html, 'class="pull-request '), 0); // never a .pull-request: the tree pass must not see the rows
    assert.equal(count(html, 'class="pull-request"'), 0);
    assert.equal(count(html, 'class="jira-priority-icon"'), 1);
    assert.ok(html.includes('href="https://site.atlassian.net/browse/PROJ-10"'));
    assert.ok(html.includes('data-issue-summary="Ten"')); // the popover attributes of the tree's issue links
    assert.equal(count(html, 'class="jira-issue-link"'), 2);
    assert.ok(html.includes('<span class="orphaned-issue-summary">Nine</span>'));
    assert.ok(html.includes('src="https://avatars/jane-24.png"') && html.includes('title="Assignee: Jane"'));
    assert.equal(count(html, '<span class="orphaned-issue-unassigned">Unassigned</span>'), 1);
    assert.ok(html.includes('title="Last updated">2026-08-31</span>'));
    assert.equal(count(html, 'Status:'), 0); // every issue here is in review: the header says it
    // PROJ-9 was updated 14 days ago: stale; PROJ-10 13 days ago: not yet
    assert.equal(count(html, 'class="warnings"'), 1);
    assert.ok(html.includes('No update for 14 days'));
});

test('renderOrphanedIssues falls back to the 48x48 avatar and never marks an issue without an update date', () => {
    const now = Date.parse('2026-09-14T12:00:00.000Z');
    const html = renderOrphanedIssues([
        { key: 'PROJ-11', fields: { summary: 'Eleven', priority: null, assignee: { displayName: 'Bob', avatarUrls: { '48x48': 'https://avatars/bob-48.png' } } } },
        { key: 'PROJ-12', fields: { summary: 'Twelve', priority: null, assignee: { displayName: 'Ann', avatarUrls: {} } } },
        { key: 'PROJ-13', fields: { summary: 'Thirteen', priority: null, assignee: { avatarUrls: { '48x48': 'https://avatars/x.png' } } } }
    ], 'site', { now });
    assert.ok(html.includes('src="https://avatars/bob-48.png"'));
    assert.equal(count(html, 'class="warnings"'), 0);
    assert.ok(html.includes('title="Last updated"></span>'));
    // Ann has a displayName but no avatar URL: the icon alone, never an empty <img src="">
    assert.ok(html.includes('title="Assignee: Ann"'));
    assert.equal(count(html, '<img'), 1); // only Bob has an avatar url; no priority icons here either
    // An assignee without a displayName is treated as unassigned
    assert.equal(count(html, '<span class="orphaned-issue-unassigned">Unassigned</span>'), 1);
});

test('renderOrphanedIssues counts one issue in the singular', () => {
    const html = renderOrphanedIssues([
        { key: 'PROJ-14', fields: { summary: 'Fourteen', priority: null, assignee: null } }
    ], 'site', { now: Date.parse('2026-09-14T12:00:00.000Z') });
    assert.ok(html.includes('title="1 issue"'));
});

test('renderParticipant gives each status its icon, and an unknown status no icon and a console line', () => {
    const icon = html => html.match(/<i class="fas (\S*) icon">/)[1];
    assert.equal(icon(renderParticipant(jane, 'approved')), 'fa-check-circle');
    assert.equal(icon(renderParticipant(jane, 'requestedChanges')), 'fa-times-circle');
    assert.equal(icon(renderParticipant(jane, 'toReview')), 'fa-question-circle');
    assert.equal(icon(renderParticipant(jane, 'author')), 'fa-user');
    const log = mock.method(console, 'log', () => {});
    try {
        const html = renderParticipant(jane, 'unknown');
        assert.equal(icon(html), '');
        assert.ok(html.includes('data-review-status="unknown"'));
        assert.ok(html.includes('src="https://avatars/jane.png"'));
        assert.deepEqual(log.mock.calls.map(call => call.arguments), [["Jane participant's status is invalid: unknown"]]);
    } finally {
        log.mock.restore();
    }
});

test('escapeHtml escapes the five HTML characters and turns null and undefined into an empty string', () => {
    assert.equal(escapeHtml('a & b <c> "d" \'e\''), 'a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;');
    assert.equal(escapeHtml('plain text'), 'plain text');
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
});

// A user with Jira or Bitbucket write access can put any character into a
// summary, a title, a name or a branch: none of them may end an attribute or
// open a tag in the rendered tree
test('renderRepositories escapes every Bitbucket and Jira text it interpolates', () => {
    const hostile = { ...jane, display_name: 'Eve "><img src=x onerror=alert(1)>', links: { avatar: { href: 'https://avatars/eve.png?a=1&b="2"' } } };
    const pr = pullRequest(7, { repo: 'repo<"&>', source: 'feat/<b>x</b>', destination: 'main"><i>', participants: [{ user: hostile, approved: true, state: 'approved' }] });
    pr.title = 'Title <script>alert("x")</script> & co';
    pr.links.html.href = 'https://bitbucket.org/ws/repo/pull-requests/7?x="y"';
    pr.created_on = '<b>2026';
    const details = [
        { key: 'PROJ-7', fields: { summary: 'Summary "><b>bold</b> & more', status: { name: 'In <Review>' }, priority: { name: 'High "priority"', iconUrl: 'https://jira/high.svg?a="b"' } } }
    ];
    const html = renderRepositories([pr], { '7': ['PROJ-7'] }, details, new Map([['main"><i>', [pr]]]), 'site');
    for (const raw of ['<script>', '<img src=x', '<b>bold</b>', '<i>', 'repo<"&>']) {
        assert.ok(!html.includes(raw), `raw ${raw} found in the rendered tree`);
    }
    assert.ok(html.includes('<h2 class="repository-name">repo&lt;&quot;&amp;&gt;</h2>'));
    assert.ok(html.includes('main&quot;&gt;&lt;i&gt;'));
    assert.ok(html.includes('Title &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co'));
    assert.ok(html.includes('href="https://bitbucket.org/ws/repo/pull-requests/7?x=&quot;y&quot;"'));
    assert.ok(html.includes('<span class="created-date">&lt;b&gt;2026</span>'));
    assert.ok(html.includes('data-issue-summary="Summary &quot;&gt;&lt;b&gt;bold&lt;/b&gt; &amp; more"'));
    assert.ok(html.includes('PROJ-7 (In &lt;Review&gt;)'));
    assert.ok(html.includes('alt="High &quot;priority&quot;" class="jira-priority-icon" title="High &quot;priority&quot;"'));
    assert.ok(html.includes('src="https://jira/high.svg?a=&quot;b&quot;"'));
    assert.ok(html.includes('data-author="Eve &quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
    assert.ok(html.includes('alt="Eve &quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
    assert.ok(html.includes('src="https://avatars/eve.png?a=1&amp;b=&quot;2&quot;"'));
    // The branch URL keeps its own encoding of the branch name, then is escaped like any attribute
    assert.ok(html.includes(`href="${escapeHtml('https://bitbucket.org/ws/repo<"&>/branch/' + encodeURIComponent('main"><i>'))}"`));
});

test('renderOrphanedIssues escapes the summary, the names and the URLs of an issue', () => {
    const html = renderOrphanedIssues([
        { key: 'PROJ-<1>', fields: { summary: 'Summary "><script>x</script>', priority: { name: 'P "1"', iconUrl: 'https://jira/p1.svg?q="1"' }, updated: '2026-09-13T11:00:00.000+0000', assignee: { displayName: 'Ann <"&">', avatarUrls: { '24x24': 'https://avatars/ann.png?a="1"' } } } }
    ], 'site', { now: Date.parse('2026-09-14T12:00:00.000Z') });
    assert.ok(!html.includes('<script>') && !html.includes('Ann <') && !html.includes('PROJ-<1>'));
    assert.ok(html.includes('data-issue-key="PROJ-&lt;1&gt;"'));
    assert.ok(html.includes('href="https://site.atlassian.net/browse/PROJ-&lt;1&gt;"'));
    assert.ok(html.includes('data-issue-summary="Summary &quot;&gt;&lt;script&gt;x&lt;/script&gt;"'));
    assert.ok(html.includes('<span class="orphaned-issue-summary">Summary &quot;&gt;&lt;script&gt;x&lt;/script&gt;</span>'));
    assert.ok(html.includes('data-author="Ann &lt;&quot;&amp;&quot;&gt;" title="Assignee: Ann &lt;&quot;&amp;&quot;&gt;"'));
    assert.ok(html.includes('src="https://avatars/ann.png?a=&quot;1&quot;" alt="Ann &lt;&quot;&amp;&quot;&gt;"'));
    assert.ok(html.includes('alt="P &quot;1&quot;" class="jira-priority-icon" title="P &quot;1&quot;"'));
});

// The toggle buttons: real buttons with a name and a state, so the keyboard
// reaches them and a screen reader knows what they open; the ones of the
// repositories and root branches carry no handler (their click bubbles to the
// header's), the one of a pull request carries its own
test('renderRepositories gives every collapsible block a named toggle button that says it is expanded', () => {
    const html = renderSample();
    assert.ok(html.includes('<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle repo-one">'));
    assert.ok(html.includes('<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle repo-two">'));
    assert.ok(html.includes('<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle main">'));
    assert.ok(html.includes('<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle develop">'));
    assert.equal(count(html, '<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle the stacked pull requests" onclick="toggleChildren(this)">'), 1); // PR 1 only
    assert.equal(count(html, '<button'), 5);
    assert.equal(count(html, 'class="toggle-button"'), 5);
    assert.equal(count(html, 'aria-expanded="true"'), 5);
    assert.equal(count(html, '<i class="fas fa-chevron-down" aria-hidden="true"></i>'), 5);
    // A hostile name stays inside the label
    const hostile = renderRepositories([pullRequest(8, { repo: 'r"><b>', source: 'x', destination: 'y"z' })], {}, [], new Map([['y"z', []]]), 'site');
    assert.ok(hostile.includes('aria-label="Toggle r&quot;&gt;&lt;b&gt;"') && hostile.includes('aria-label="Toggle y&quot;z"'));
});
