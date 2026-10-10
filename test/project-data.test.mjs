import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectData } from '../project-data.mjs';
import { RateLimitError } from '../atlassian-fetch.mjs';

/**
 * The project data against a fake Atlassian: the documented rules of
 * /api/pull-requests/:project (pagination, the Jira batches and parents,
 * the fix versions inherited, the orphaned issues, the hash and the commit
 * counts it saves). The fake answers Bitbucket and Jira by URL with real
 * Response objects and records every request.
 */

const workspace = 'ws';
const jiraSiteName = 'site';
const bbAuth = 'YmI6YmI=';
const jiraAuth = 'amlyYTpqaXJh';
const project = { repositories: ['repo-a', 'repo-b'], jiraProjects: ['PROJ', 'OTHER'], jiraRegex: /(PROJ-\d+|OTHER-\d+)/g };
const bitbucket = repo => `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}`;
const pullRequestsUrl = repo => `${bitbucket(repo)}/pullrequests?fields=%2Bvalues.*,%2Bvalues.properties*,%2Bvalues.rendered.*,-values.description,-values.summary&pagelen=50`;
const jira = `https://${jiraSiteName}.atlassian.net`;

function pullRequest(id, { repo = 'repo-a', source = `feat-${id}`, destination = 'master', title = `PROJ-${id} change ${id}`, hash = `s${id}` } = {}) {
    return {
        id,
        title,
        source: { branch: { name: source }, commit: { hash }, repository: { name: repo } },
        destination: { branch: { name: destination }, commit: { hash: `d${id}` }, repository: { name: repo } }
    };
}
function issue(key, { summary = `Summary of ${key}`, type = 'Story', parent = null, fixVersions = [] } = {}) {
    const fields = { summary, issuetype: { name: type }, fixVersions, status: { name: 'In Progress' } };
    if (parent) fields.parent = { key: parent };
    return { key, fields };
}
const version = name => ({ id: name, name });

/**
 * A fake Atlassian. `pullRequests` holds the pages of each repository (an
 * array of arrays; page 2 and later are asked through the `next` URL);
 * `commits(repo, include, exclude)` the number of commits; `issues` and
 * `parents` the pools answered to `issueKey in` and `key IN` queries;
 * `boards` per Jira project, `sprints` per board id, `sprintIssues` per
 * sprint id, `inReview` the issues in review; the parents, sprint and
 * in-review searches are paged with a token like the search endpoint,
 * `maxResults` at a time (a request without maxResults gets Jira's 50).
 * `intercept(url)` runs first: a Response it returns replaces the answer.
 */
function fakeAtlassian({ pullRequests = {}, commits = () => 0, issues = [], parents = [], boards = {}, sprints = {}, sprintIssues = {}, inReview = [], intercept = () => undefined } = {}) {
    const requests = [];
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const keysOf = list => list.split(',').map(key => key.trim());
    // A page of a search, the way the search endpoint answers: `maxResults` items
    // from the `nextPageToken` given (an offset here), `isLast`, and the token of
    // the next page when there is one; no total, no startAt.
    const page = (items, searchParams, map = item => item) => {
        const startAt = Number(searchParams.get('nextPageToken')?.replace('page-', '') ?? 0);
        const end = startAt + Number(searchParams.get('maxResults'));
        const body = { issues: items.slice(startAt, end).map(map), isLast: end >= items.length };
        if (!body.isLast) body.nextPageToken = `page-${end}`;
        return body;
    };
    async function fetch(url, options) {
        requests.push({ url, options });
        const replaced = intercept(url);
        if (replaced) return replaced;
        const { pathname, searchParams } = new URL(url);
        let match;
        if ((match = pathname.match(/^\/2\.0\/repositories\/ws\/([^/]+)\/pullrequests$/))) {
            const pages = pullRequests[match[1]] ?? [[]];
            const page = Number(searchParams.get('page') ?? 1);
            const body = { values: pages[page - 1] ?? [] };
            if (page < pages.length) body.next = `${url}&page=${page + 1}`;
            return json(body);
        }
        if ((match = pathname.match(/^\/2\.0\/repositories\/ws\/([^/]+)\/commits$/))) {
            const count = commits(match[1], searchParams.get('include'), searchParams.get('exclude'));
            return json({ values: Array.from({ length: count }, (_, i) => ({ hash: `c${i}` })) });
        }
        if (pathname === '/rest/api/3/search/jql') {
            const jql = searchParams.get('jql');
            if ((match = jql.match(/^issueKey in \(([^)]*)\)/))) {
                const keys = new Set(keysOf(match[1]));
                return json({ issues: issues.filter(candidate => keys.has(candidate.key)) });
            }
            if ((match = jql.match(/^key IN \(([^)]*)\)$/))) {
                const keys = new Set(keysOf(match[1]));
                if (!searchParams.has('maxResults')) searchParams.set('maxResults', '50');
                return json(page(parents.filter(candidate => keys.has(candidate.key)), searchParams));
            }
            if ((match = jql.match(/^sprint = (\d+) /))) return json(page(sprintIssues[match[1]] ?? [], searchParams, key => ({ key })));
            if (jql.includes('status = "In Review"')) return json(page(inReview, searchParams));
        }
        if ((match = pathname.match(/^\/rest\/agile\/1\.0\/board$/))) {
            const values = boards[searchParams.get('projectKeyOrId')] ?? [];
            return json({ total: values.length, values });
        }
        if ((match = pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)\/sprint$/))) {
            const values = sprints[match[1]] ?? [];
            return json({ total: values.length, values });
        }
        throw new Error(`unexpected request: ${url}`);
    }
    return { fetch, requests };
}

function setUp(atlassian) {
    const logs = { access: [], error: [], performance: [] };
    const data = createProjectData({
        fetch: atlassian.fetch,
        workspace,
        bbAuth,
        jiraSiteName,
        jiraAuth,
        log: { access: m => logs.access.push(m), error: m => logs.error.push(m), performance: m => logs.performance.push(m) }
    });
    return { ...data, logs, requests: atlassian.requests };
}
const urlsMatching = (requests, pattern) => requests.map(request => request.url).filter(url => pattern.test(url));
const jqlOf = url => new URL(url).searchParams.get('jql');

test('the pull requests of each repository are fetched 50 per page, following next, and the response has the documented shape', async () => {
    const a1 = pullRequest(1, { repo: 'repo-a' }), a2 = pullRequest(2, { repo: 'repo-a', title: 'OTHER-7 no proj key' }), b3 = pullRequest(3, { repo: 'repo-b', destination: 'develop' });
    const { buildProjectData, requests, logs } = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[a1], [a2]], 'repo-b': [[b3]] },
        commits: (repo, include, exclude) => (include.startsWith('feat') ? 3 : 1),
        issues: [issue('PROJ-1'), issue('OTHER-7')]
    }));
    const data = await buildProjectData('P', project);
    assert.deepEqual(urlsMatching(requests, /pullrequests/), [pullRequestsUrl('repo-a'), `${pullRequestsUrl('repo-a')}&page=2`, pullRequestsUrl('repo-b')]);
    assert.deepEqual(requests[0].options, { method: 'GET', headers: { 'Authorization': `Basic ${bbAuth}`, 'Accept': 'application/json' } });
    assert.deepEqual(Object.keys(data).sort(), ['dataHash', 'jiraIssuesDetails', 'jiraIssuesMap', 'jiraSiteName', 'lastRefreshTime', 'orphanedIssues', 'pullRequests', 'sprintIssues', 'sprints']);
    assert.deepEqual(data.pullRequests.map(pr => [pr.id, pr.commitsAhead, pr.commitsBehind]), [[1, 3, 1], [2, 3, 1], [3, 3, 1]]);
    assert.deepEqual(data.jiraIssuesMap, { 1: ['PROJ-1'], 2: ['OTHER-7'], 3: ['PROJ-3'] });
    assert.deepEqual(data.jiraIssuesDetails.map(i => i.key), ['PROJ-1', 'OTHER-7']); // PROJ-3 is not in Jira
    assert.equal(data.jiraSiteName, jiraSiteName);
    assert.deepEqual([data.sprints, data.sprintIssues, data.orphanedIssues], [[], {}, []]);
    assert.match(data.dataHash, /^[0-9a-f]{32}$/);
    assert.ok(logs.access.includes('Retrieved 2 pull requests for repository: repo-a'));
    assert.ok(logs.access.includes('Total JIRA issues found: 3'));
    assert.match(logs.performance.find(line => line.startsWith('fetchPullRequests')), /^fetchPullRequests - URL: .* - Duration: \d+ms$/);
});

test('the Jira issues are fetched in batches of 50, then the parents that were not linked themselves', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => `PROJ-${i + 1}`);
    const pullRequests = keys.map((key, i) => pullRequest(i + 1, { title: `${key} change` }));
    // PROJ-1 and PROJ-2 have parents outside the linked issues (PROJ-500 twice, PROJ-501), PROJ-3 has a linked parent
    const issues = keys.map(key => issue(key, { parent: { 'PROJ-1': 'PROJ-500', 'PROJ-2': 'PROJ-500', 'PROJ-3': 'PROJ-4', 'PROJ-5': 'PROJ-501' }[key] ?? null }));
    const parents = [issue('PROJ-500', { type: 'Epic', fixVersions: [version('1.0')] }), issue('PROJ-501', { type: 'Story', parent: 'PROJ-600' })];
    const { buildProjectData, requests, logs } = setUp(fakeAtlassian({ pullRequests: { 'repo-a': [pullRequests] }, issues, parents }));
    const data = await buildProjectData('P', project);
    const searches = urlsMatching(requests, /search\/jql/).map(jqlOf).filter(jql => !jql.includes('In Review'));
    assert.equal(searches.length, 4);
    assert.deepEqual(searches.slice(0, 3).map(jql => jql.match(/^issueKey in \(([^)]*)\) AND project in \(PROJ,OTHER\)$/)[1].split(',').length), [50, 50, 20]);
    assert.equal(searches[0].split(',')[0], 'issueKey in (PROJ-1');
    assert.equal(searches[3], 'key IN (PROJ-500,PROJ-501)'); // each missing parent once, linked parents not asked again
    const fields = url => new URL(url).searchParams.get('fields');
    const searchUrls = urlsMatching(requests, /search\/jql/).filter(url => !jqlOf(url).includes('In Review'));
    assert.equal(fields(searchUrls[0]), 'key,summary,status,priority,fixVersions,assignee,parent,issuetype');
    assert.equal(fields(searchUrls[3]), 'key,summary,issuetype,fixVersions,parent');
    assert.equal(requests.find(r => r.url.includes('issueKey%20in')).options.headers.Authorization, `Basic ${jiraAuth}`);
    assert.deepEqual(data.jiraIssuesDetails.slice(-2).map(i => [i.key, i.fields.issuetype.name]), [['PROJ-500', 'Epic'], ['PROJ-501', 'Story']]);
    assert.equal(data.jiraIssuesDetails.length, 122);
    assert.match(logs.performance.find(line => line.includes('Parent issues fetch')), /^fetchJiraIssuesDetails - Parent issues fetch \(2\) - Duration: \d+ms$/);
});

test('an issue without fix versions inherits the fix versions of its parent, epic to story to sub-task', async () => {
    const v2 = version('2.0');
    const issues = [
        issue('PROJ-10', { type: 'Story', parent: 'PROJ-1', fixVersions: [] }), // the story, before its sub-task
        issue('PROJ-11', { type: 'Sub-task', parent: 'PROJ-10', fixVersions: [] }),
        issue('PROJ-12', { type: 'Sub-task', parent: 'PROJ-10', fixVersions: [version('3.0')] }), // keeps its own
        issue('PROJ-13', { type: 'Sub-task', parent: 'PROJ-14', fixVersions: [] }) // its parent has none either
    ];
    const parents = [issue('PROJ-1', { type: 'Epic', fixVersions: [v2] }), issue('PROJ-14', { type: 'Story', fixVersions: [] })];
    const pullRequests = [10, 11, 12, 13].map(n => pullRequest(n, { title: `PROJ-${n} change` }));
    const { buildProjectData } = setUp(fakeAtlassian({ pullRequests: { 'repo-a': [pullRequests] }, issues, parents }));
    const data = await buildProjectData('P', project);
    const versions = Object.fromEntries(data.jiraIssuesDetails.map(i => [i.key, i.fields.fixVersions.map(v => v.name)]));
    assert.deepEqual(versions, { 'PROJ-10': ['2.0'], 'PROJ-11': ['2.0'], 'PROJ-12': ['3.0'], 'PROJ-13': [], 'PROJ-1': ['2.0'], 'PROJ-14': [] });
});

test('the orphaned issues are the ones in review without a pull request, every page of them, with the fields of the filters', async () => {
    const linked = issue('PROJ-1'), orphans = Array.from({ length: 119 }, (_, i) => issue(`OTHER-${i + 2}`));
    const { buildProjectData, requests, logs } = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] }, issues: [linked], inReview: [linked, ...orphans]
    }));
    const data = await buildProjectData('P', project);
    assert.deepEqual(data.orphanedIssues, orphans); // both pages, in order, the linked one dropped, nothing added
    const urls = urlsMatching(requests, /In%20Review/);
    assert.deepEqual(urls.map(url => new URL(url).searchParams.get('nextPageToken')), [null, 'page-100']);
    for (const url of urls) {
        assert.equal(jqlOf(url), 'project in (PROJ,OTHER) AND status = "In Review" ORDER BY priority DESC, updated DESC');
        assert.equal(new URL(url).searchParams.get('fields'), 'key,summary,status,priority,fixVersions,assignee,parent,issuetype,updated');
        assert.equal(new URL(url).searchParams.get('maxResults'), '100');
    }
    assert.ok(logs.access.includes('Found 119 orphaned issues in review status'));
});

test('the parents of the orphaned issues are fetched with the parents of the linked issues, once, and their fix versions inherited', async () => {
    const linked = issue('PROJ-1', { type: 'Sub-task', parent: 'PROJ-100', fixVersions: [] });
    const orphans = [
        issue('PROJ-2', { type: 'Sub-task', parent: 'PROJ-100', fixVersions: [] }), // the parent of the linked issue too
        issue('PROJ-3', { type: 'Sub-task', parent: 'PROJ-200', fixVersions: [] }), // a parent without fix versions
        issue('PROJ-4', { type: 'Story', parent: 'PROJ-300', fixVersions: [version('3.0')] }) // keeps its own
    ];
    const parents = [
        issue('PROJ-100', { type: 'Story', fixVersions: [version('2.0')] }),
        issue('PROJ-200', { type: 'Story', fixVersions: [] }),
        issue('PROJ-300', { type: 'Epic', fixVersions: [version('4.0')] })
    ];
    const { buildProjectData, requests } = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] }, issues: [linked], parents, inReview: [linked, ...orphans]
    }));
    const data = await buildProjectData('P', project);
    const searches = urlsMatching(requests, /search\/jql/).map(jqlOf);
    assert.deepEqual(searches.filter(jql => jql.startsWith('key IN')), ['key IN (PROJ-100,PROJ-200,PROJ-300)']); // one request, each parent once
    // The orphaned search runs before the details: that is what lets one parent request serve both
    assert.ok(searches.findIndex(jql => jql.includes('In Review')) < searches.findIndex(jql => jql.startsWith('issueKey in')));
    // The parent-only entries land with the linked issues, where the frontend looks them up
    assert.deepEqual(data.jiraIssuesDetails.map(i => i.key), ['PROJ-1', 'PROJ-100', 'PROJ-200', 'PROJ-300']);
    assert.deepEqual(data.jiraIssuesDetails[0].fields.fixVersions.map(v => v.name), ['2.0']);
    const versions = data.orphanedIssues.map(i => [i.key, i.fields.fixVersions.map(v => v.name)]);
    assert.deepEqual(versions, [['PROJ-2', ['2.0']], ['PROJ-3', []], ['PROJ-4', ['3.0']]]);
});

test('a parent that is itself an orphaned issue is not requested again nor added to the details', async () => {
    // The story PROJ-50 is in review with no pull request while its sub-task PROJ-1 has one
    const linked = issue('PROJ-1', { type: 'Sub-task', parent: 'PROJ-50', fixVersions: [] });
    const story = issue('PROJ-50', { type: 'Story', parent: 'PROJ-900', fixVersions: [version('5.0')] });
    const { buildProjectData, requests } = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] }, issues: [linked], parents: [issue('PROJ-900', { type: 'Epic' })], inReview: [story]
    }));
    const data = await buildProjectData('P', project);
    const searches = urlsMatching(requests, /search\/jql/).map(jqlOf);
    assert.deepEqual(searches.filter(jql => jql.startsWith('key IN')), ['key IN (PROJ-900)']); // the story's epic, not the story
    assert.deepEqual(data.jiraIssuesDetails.map(i => i.key), ['PROJ-1', 'PROJ-900']);
    assert.deepEqual(data.orphanedIssues.map(i => i.key), ['PROJ-50']);
    assert.deepEqual(data.jiraIssuesDetails[0].fields.fixVersions.map(v => v.name), ['5.0']); // inherited from the orphaned story all the same
});

test('a failed parent request is logged and leaves the issues without their parents', async () => {
    const linked = issue('PROJ-1', { type: 'Sub-task', parent: 'PROJ-100', fixVersions: [] });
    const { buildProjectData, logs } = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] }, issues: [linked],
        intercept: url => (jqlOf(url)?.startsWith('key IN') ? new Response('', { status: 502 }) : undefined)
    }));
    const data = await buildProjectData('P', project);
    assert.deepEqual(data.jiraIssuesDetails.map(i => i.key), ['PROJ-1']); // no parent-only entry, the build goes on
    assert.deepEqual(data.jiraIssuesDetails[0].fields.fixVersions, []);
    assert.deepEqual(logs.error, ['Error fetching parent issues: Request failed with status code 502']);
});

test('the parents are read page by page: more than a page of them all come back', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => `PROJ-${i + 1}`);
    const pullRequests = keys.map((key, i) => pullRequest(i + 1, { title: `${key} change` }));
    const issues = keys.map((key, i) => issue(key, { parent: `PROJ-${1001 + i}` }));
    const parents = keys.map((key, i) => issue(`PROJ-${1001 + i}`, { type: 'Epic' }));
    const { buildProjectData, requests } = setUp(fakeAtlassian({ pullRequests: { 'repo-a': [pullRequests] }, issues, parents }));
    const data = await buildProjectData('P', project);
    const parentUrls = urlsMatching(requests, /search\/jql/).filter(url => jqlOf(url).startsWith('key IN'));
    assert.deepEqual(parentUrls.map(url => [new URL(url).searchParams.get('maxResults'), new URL(url).searchParams.get('nextPageToken')]), [['100', null], ['100', 'page-100']]);
    assert.equal(data.jiraIssuesDetails.length, 240); // 120 linked issues, then their 120 parents
});

test('a rate-limit pause ends the build from a fetcher that otherwise goes on after a failure, without an error line', async () => {
    const fetchers = {
        parents: url => jqlOf(url)?.startsWith('key IN'),
        boards: url => url.includes('projectKeyOrId=PROJ'),
        'sprints of a board': url => /\/board\/1\/sprint/.test(url),
        'sprint issues': url => url.includes('sprint%20%3D%207'),
        'commit counts': url => url.includes('/commits?')
    };
    for (const [name, matches] of Object.entries(fetchers)) {
        const { buildProjectData, logs } = setUp(fakeAtlassian({
            pullRequests: { 'repo-a': [[pullRequest(1)]] },
            issues: [issue('PROJ-1', { parent: 'PROJ-100' })],
            parents: [issue('PROJ-100', { type: 'Epic' })],
            boards: { PROJ: [{ id: 1, name: 'Board 1' }] },
            sprints: { 1: [{ id: 7, name: 'Sprint 7' }] },
            sprintIssues: { 7: ['PROJ-1'] },
            intercept: url => {
                if (matches(url)) throw new RateLimitError();
                return undefined;
            }
        }));
        await assert.rejects(buildProjectData('P', project), RateLimitError, name);
        assert.deepEqual(logs.error, [], name);
    }
});

test('the active sprints of every scrum board of each Jira project, once each, and their issues 100 at a time', async () => {
    const shared = { id: 7, name: 'Sprint 7', state: 'active' };
    const { buildProjectData, requests, logs } = setUp(fakeAtlassian({
        boards: { PROJ: [{ id: 1, name: 'Board 1' }, { id: 2, name: 'Board 2' }], OTHER: [{ id: 3, name: 'Board 3' }] },
        sprints: { 1: [shared, { id: 8, name: 'Sprint 8' }], 2: [shared], 3: [] },
        sprintIssues: { 7: Array.from({ length: 150 }, (_, i) => `PROJ-${i}`), 8: ['OTHER-1'] }
    }));
    const data = await buildProjectData('P', project);
    assert.deepEqual(urlsMatching(requests, /agile/), [
        `${jira}/rest/agile/1.0/board?projectKeyOrId=PROJ&type=scrum`,
        `${jira}/rest/agile/1.0/board/1/sprint?state=active`,
        `${jira}/rest/agile/1.0/board/2/sprint?state=active`,
        `${jira}/rest/agile/1.0/board?projectKeyOrId=OTHER&type=scrum`,
        `${jira}/rest/agile/1.0/board/3/sprint?state=active`
    ]);
    assert.deepEqual(data.sprints, [{ id: 7, name: 'Sprint 7' }, { id: 8, name: 'Sprint 8' }]); // id and name only, the shared sprint once
    const sprintSearches = urlsMatching(requests, /sprint%20%3D/).map(url => [jqlOf(url), new URL(url).searchParams.get('nextPageToken'), new URL(url).searchParams.get('maxResults')]);
    assert.deepEqual(sprintSearches, [
        ['sprint = 7 AND project in (PROJ,OTHER)', null, '100'],
        ['sprint = 7 AND project in (PROJ,OTHER)', 'page-100', '100'], // the token of the first page, since it was not the last
        ['sprint = 8 AND project in (PROJ,OTHER)', null, '100']
    ]);
    assert.deepEqual(data.sprintIssues[7], Array.from({ length: 150 }, (_, i) => `PROJ-${i}`)); // every page, in order
    assert.deepEqual(data.sprintIssues[8], ['OTHER-1']);
    assert.ok(logs.access.includes('Retrieved a total of 150 issues for sprint 7'));
});

test('the commit counts are fetched only when the hash changed; otherwise the last response is served with a new time', async () => {
    let hash = 's1';
    let count = 2;
    const atlassian = fakeAtlassian({ commits: () => count });
    // The fake, with a pull-request page that follows the current hash
    const data = setUp({
        fetch: (url, options) => (url.includes('/pullrequests') ? new Response(JSON.stringify({ values: [pullRequest(1, { hash })] }), { status: 200 }) : atlassian.fetch(url, options)),
        requests: atlassian.requests
    });
    const oneRepository = { ...project, repositories: ['repo-a'] };
    const first = await data.buildProjectData('P', oneRepository);
    assert.deepEqual(urlsMatching(atlassian.requests, /commits/), [
        `${bitbucket('repo-a')}/commits?include=feat-1&exclude=master&pagelen=100`,
        `${bitbucket('repo-a')}/commits?include=master&exclude=feat-1&pagelen=100`
    ]);
    assert.deepEqual([first.pullRequests[0].commitsAhead, first.pullRequests[0].commitsBehind], [2, 2]);

    // Nothing changed: no commits request, the same response with a fresh lastRefreshTime
    count = 5;
    await new Promise(resolve => setTimeout(resolve, 2));
    const second = await data.buildProjectData('P', oneRepository);
    assert.equal(urlsMatching(atlassian.requests, /commits/).length, 2);
    assert.equal(second, first);
    assert.equal(second.pullRequests[0].commitsAhead, 2);
    assert.ok(Date.parse(second.lastRefreshTime) >= Date.parse(first.lastRefreshTime));
    assert.equal(second.dataHash, first.dataHash);

    // A commit moved: the counts are fetched again
    hash = 's1-moved';
    const third = await data.buildProjectData('P', oneRepository);
    assert.equal(urlsMatching(atlassian.requests, /commits/).length, 4);
    assert.notEqual(third.dataHash, first.dataHash);
    assert.equal(third.pullRequests[0].commitsAhead, 5);
});

test('a failed commits request leaves the count null and is logged; a failed pull-request page fails the build', async () => {
    const failing = fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] },
        intercept: url => (url.includes('/commits?include=feat-1') ? new Response('', { status: 500, statusText: 'Internal Server Error' }) : undefined)
    });
    const { buildProjectData, logs } = setUp(failing);
    const data = await buildProjectData('P', project);
    assert.deepEqual([data.pullRequests[0].commitsAhead, data.pullRequests[0].commitsBehind], [null, 0]);
    assert.deepEqual(logs.error, ['Error fetching commits ahead for feat-1 compared to master in repo-a: Request failed with status code 500']);

    const broken = setUp(fakeAtlassian({ intercept: url => (url.includes('/pullrequests') ? new Response('', { status: 401 }) : undefined) }));
    await assert.rejects(broken.buildProjectData('P', project), { message: 'Request failed with status code 401' });
    assert.deepEqual(broken.logs.error, ['Error in fetchPullRequests: Request failed with status code 401']);
});

test('a Jira failure: the sprints of a project are skipped and logged, a failed sprint page ends that sprint, a failed orphan search fails the build', async () => {
    const skipped = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] },
        boards: { PROJ: [{ id: 1, name: 'Board 1' }], OTHER: [{ id: 3, name: 'Board 3' }] },
        sprints: { 1: [{ id: 7, name: 'Sprint 7' }], 3: [{ id: 9, name: 'Sprint 9' }] },
        sprintIssues: { 7: ['PROJ-1'], 9: Array.from({ length: 150 }, (_, i) => `OTHER-${i}`) },
        intercept: url => {
            if (url.includes('projectKeyOrId=PROJ')) throw new Error('boards unreachable');
            if (url.includes('sprint%20%3D%209') && url.includes('nextPageToken')) return new Response('', { status: 502 });
            return undefined;
        }
    }));
    const data = await skipped.buildProjectData('P', project);
    assert.deepEqual(data.sprints, [{ id: 9, name: 'Sprint 9' }]);
    assert.equal(data.sprintIssues[9].length, 100); // the first page is kept, the failed second one ends the sprint
    assert.deepEqual(skipped.logs.error, ['Error fetching sprints for project PROJ: boards unreachable', 'Error fetching issues for sprint 9: Request failed with status code 502']);
    assert.ok(skipped.logs.access.includes('Retrieved a total of 100 issues for sprint 9'));

    const orphans = setUp(fakeAtlassian({ intercept: url => (url.includes('In%20Review') ? new Response('', { status: 403 }) : undefined) }));
    await assert.rejects(orphans.buildProjectData('P', project), { message: 'Request failed with status code 403' });
    assert.deepEqual(orphans.logs.error, ['Error fetching orphaned issues: Request failed with status code 403']);
});

test('a boards response without a list skips the project\'s sprints and the build goes on', async () => {
    const { buildProjectData, logs } = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] },
        boards: { OTHER: [{ id: 3, name: 'Board 3' }] },
        sprints: { 3: [{ id: 9, name: 'Sprint 9' }] },
        intercept: url => (url.includes('projectKeyOrId=PROJ') ? new Response('{"total":0}', { status: 200 }) : undefined)
    }));
    const data = await buildProjectData('P', project);
    assert.deepEqual(data.sprints, [{ id: 9, name: 'Sprint 9' }]);
    assert.deepEqual(logs.error, []);
});

test('a failed sprints request of one board skips that board only and is logged; a long Jira error body is cut at 200 characters', async () => {
    const skipped = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] },
        boards: { PROJ: [{ id: 1, name: 'Board 1' }, { id: 2, name: 'Board 2' }], OTHER: [{ id: 3, name: 'Board 3' }] },
        sprints: { 1: [{ id: 7, name: 'Sprint 7' }], 2: [{ id: 8, name: 'Sprint 8' }], 3: [{ id: 9, name: 'Sprint 9' }] },
        intercept: url => (url.includes('/board/2/sprint') ? new Response('', { status: 502 }) : undefined)
    }));
    const data = await skipped.buildProjectData('P', project);
    assert.deepEqual(data.sprints, [{ id: 7, name: 'Sprint 7' }, { id: 9, name: 'Sprint 9' }]); // the other boards keep their sprints
    assert.deepEqual(skipped.logs.error, ['Error fetching the sprints of board Board 2 (project PROJ): Request failed with status code 502']);

    const long = setUp(fakeAtlassian({ intercept: url => (url.includes('In%20Review') ? new Response('x'.repeat(500), { status: 500 }) : undefined) }));
    await assert.rejects(long.buildProjectData('P', project), { message: `Request failed with status code 500: ${'x'.repeat(200)}` });
});

test('a commits request that throws gives a null count; a failed Jira batch fails the build with the body; a failed parents fetch is logged and the build goes on', async () => {
    const thrown = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] },
        intercept: url => { if (url.includes('/commits?include=master')) throw new Error('socket hang up'); }
    }));
    const data = await thrown.buildProjectData('P', project);
    assert.deepEqual([data.pullRequests[0].commitsAhead, data.pullRequests[0].commitsBehind], [0, null]);
    assert.deepEqual(thrown.logs.error, ['Error fetching commits ahead for master compared to feat-1 in repo-a: socket hang up']);

    const batch = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] },
        intercept: url => (url.includes('issueKey%20in') ? new Response('{"errorMessages":["bad jql"]}', { status: 400, statusText: 'Bad Request' }) : undefined)
    }));
    await assert.rejects(batch.buildProjectData('P', project), { message: 'Request failed with status code 400: {"errorMessages":["bad jql"]}' });
    assert.deepEqual(batch.logs.error, ['Error in fetchJiraIssuesDetails: Request failed with status code 400: {"errorMessages":["bad jql"]}']);

    const parents = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] },
        issues: [issue('PROJ-1', { parent: 'PROJ-500' })],
        intercept: url => { if (url.includes('key%20IN')) throw new Error('Jira unreachable'); }
    }));
    const withoutParents = await parents.buildProjectData('P', project);
    assert.deepEqual(withoutParents.jiraIssuesDetails.map(i => i.key), ['PROJ-1']);
    assert.deepEqual(parents.logs.error, ['Error fetching parent issues: Jira unreachable']);
});
