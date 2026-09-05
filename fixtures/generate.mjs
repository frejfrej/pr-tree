/**
 * Deterministic fixture data for the two configured projects.
 *
 * Volumes, repository names, Jira project keys, branch naming, stacked
 * pull-request chains, sprints and fix versions are modelled on the real
 * SECOLLAB and OSLC projects (September 2026 access logs). People are
 * fictional. The same repository always yields the same pull requests, so
 * a repository shared by two projects (products.web.oslc) is consistent.
 *
 * Everything is generated from a seeded PRNG: the output is stable across
 * runs, which keeps the server's dataHash stable and the smart reload quiet.
 */

import crypto from 'crypto';

export const workspace = 'sodius';
export const jiraSiteName = 'sodiuswillert';

// Open pull requests per repository, as observed in the real projects
export const repositoryVolumes = {
    'products.secollab': 100,
    'products.secollab.client': 2,
    'products.secollab.packaging': 0,
    'products.web.oslc': 10,
    'products.web.common': 5,
    'products.oslc': 9
};

// Which Jira projects the branches of a repository refer to, with a weight
const repositoryJiraProjects = {
    'products.secollab': [['SECOLLAB', 9], ['WEBCMN', 1]],
    'products.secollab.client': [['SECOLLAB', 1]],
    'products.secollab.packaging': [['SECOLLAB', 1]],
    'products.web.oslc': [['PRDOSLC', 3], ['WEBCMN', 1]],
    'products.web.common': [['WEBCMN', 1]],
    'products.oslc': [['PRDOSLC', 1]]
};

const repositoryRootBranches = {
    'products.secollab': [['master', 7], ['master_5.4.0', 2], ['master_1.16.x', 1]],
    'products.secollab.client': [['develop', 1]],
    'products.secollab.packaging': [['develop', 1]],
    'products.web.oslc': [['develop', 3], ['release/3.1.x', 1]],
    'products.web.common': [['main', 1]],
    'products.oslc': [['develop', 2], ['release/3.1.x', 1]]
};

// The real SECOLLAB project carries one very deep stack: 26 pull requests
// chained 24 levels deep under a long-lived feature branch. This is what made
// the recursive filtering explode (2^depth visits), so the fixture keeps it.
export const deepChain = {
    repository: 'products.secollab',
    rootBranch: 'feat/ai_investigations',
    firstBranch: 'ai-mcp-tool-layer',
    depth: 24,
    sideBranches: 2
};

// Bitbucket pull-request ids are sequential per repository; the ranges are
// disjoint here so a pull request is unambiguous in the fixtures
const repositoryFirstId = {
    'products.secollab': 2400,
    'products.secollab.client': 180,
    'products.secollab.packaging': 40,
    'products.web.oslc': 610,
    'products.web.common': 320,
    'products.oslc': 1150
};

// Active sprints: the same boards serve both projects, so both projects
// see the same sprints with different issue counts (as in the real logs)
export const sprintDefinitions = [
    { id: 100, name: 'Foundation Sprint 12', project: 'WEBCMN' },
    { id: 5240, name: 'SECollab Sprint 142', project: 'SECOLLAB' },
    { id: 5241, name: 'SECollab Sprint 143', project: 'SECOLLAB' },
    { id: 2731, name: 'SECollab Hardening 2.7.x', project: 'SECOLLAB' },
    { id: 5341, name: 'OSLCATL Sprint 88', project: 'PRDOSLC' },
    { id: 5308, name: 'OSLCATL Sprint 87', project: 'PRDOSLC' },
    { id: 5307, name: 'OSLCATL Sprint 89', project: 'PRDOSLC' }
];

const sprintIssueCounts = {
    SECOLLAB: { 100: 3, 5240: 100, 5241: 61, 2731: 100, 5341: 7, 5308: 96, 5307: 0 },
    OSLC: { 100: 0, 5240: 4, 5241: 2, 2731: 1, 5341: 0, 5308: 96, 5307: 0 }
};

const orphanedIssueCounts = { SECOLLAB: 13, OSLC: 0 };

const fixVersionsByProject = {
    SECOLLAB: [
        { id: '10812', name: 'SECollab 2.8.0' },
        { id: '10790', name: 'SECollab 2.7.3' },
        { id: '10855', name: 'SECollab 3.0.0' }
    ],
    PRDOSLC: [
        { id: '10820', name: 'OSLC Connect for Jira 3.2.0' },
        { id: '10801', name: 'OSLC Connect for Windchill 1.5.0' },
        { id: '10833', name: 'OSLC Connect for Jira 3.1.4' }
    ],
    WEBCMN: [
        { id: '10760', name: 'Web Common 4.1.0' },
        { id: '10842', name: 'Web Common 4.2.0' }
    ],
    WEBOSLC: [
        { id: '10777', name: 'Web OSLC 2.3.0' }
    ]
};

// Fictional team
const people = [
    'Amélie Roussel', 'Bastien Lefèvre', 'Chloé Marchand', 'Damien Garnier',
    'Elise Fontaine', 'Florian Meunier', 'Gaëlle Perrin', 'Hugo Blanchard',
    'Inès Carpentier', 'Julien Rey'
];

// Distribution observed on the real SECOLLAB issues
const statuses = [
    ['In Review', 55], ['In Progress', 37], ['Ready', 7], ['Created', 2], ['Reopened', 1]
];

const priorities = [
    ['Highest', '#d04437', 1], ['High', '#e5493a', 3], ['Medium', '#e97f33', 8],
    ['Low', '#2a8735', 3], ['Lowest', '#57a55a', 1]
];

const issueTypes = [['Bug', 4], ['Story', 3], ['Task', 3], ['Sub-task', 2]];

const branchKinds = [['feature', 6], ['bugfix', 4], ['hotfix', 1], ['chore', 1]];

const components = {
    SECOLLAB: [
        'baseline comparison', 'Rhapsody import', 'DOORS synchronisation', 'review workflow',
        'requirement attributes', 'model diagrams', 'Capella connector', 'permission checks',
        'change-set export', 'SysML block viewer', 'comment threads', 'traceability matrix',
        'notification e-mails', 'project archiving', 'LDAP group mapping'
    ],
    PRDOSLC: [
        'OSLC preview dialog', 'delegated UI selection', 'Windchill link discovery',
        'Jira issue linking', 'OAuth 1.0a handshake', 'root services document',
        'resource shape cache', 'TRS provider', 'query capability', 'configuration context'
    ],
    WEBCMN: [
        'date picker', 'multi-select control', 'theme tokens', 'session keep-alive',
        'error banner', 'REST client retries', 'i18n bundles', 'modal focus trap'
    ],
    WEBOSLC: ['link picker', 'preview card', 'selection dialog']
};

const problems = [
    'fails when the module is baselined', 'ignores nested packages with unicode names',
    'shows removed items as modified', 'loses the selection after pagination',
    'times out on large projects', 'duplicates entries after a refresh',
    'does not honour the configured locale', 'breaks keyboard navigation',
    'leaks the HTTP client on error', 'rejects valid ETags', 'renders empty on Firefox',
    'skips the last page of results', 'crashes on a null description'
];

const improvements = [
    'add pagination', 'support configuration contexts', 'cache resource shapes',
    'expose a REST endpoint', 'migrate to the v3 API', 'add a dark theme',
    'batch the update requests', 'add an audit log entry', 'make the timeout configurable',
    'show progress while loading', 'align spacing with the design tokens'
];

// ------------------------------------------------------------------ helpers

function createRandom(seedText) {
    let seed = crypto.createHash('md5').update(seedText).digest().readUInt32LE(0) || 1;
    // mulberry32
    return function random() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function pick(random, items) {
    return items[Math.floor(random() * items.length)];
}

// items: [[value, weight], ...]
function pickWeighted(random, items) {
    const total = items.reduce((sum, item) => sum + item[1], 0);
    let roll = random() * total;
    for (const item of items) {
        roll -= item[1];
        if (roll < 0) return item[0];
    }
    return items[items.length - 1][0];
}

function integer(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
}

function hex(random, length) {
    let out = '';
    while (out.length < length) {
        out += Math.floor(random() * 16).toString(16);
    }
    return out;
}

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function isoDaysAgo(days) {
    const date = new Date(Date.UTC(2026, 8, 5, 8, 0, 0)); // fixed "now": 2026-09-05
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString();
}

function initials(name) {
    return name.split(/\s+/).map(part => part[0]).join('').toUpperCase();
}

function svgDataUri(svg) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function avatarUrl(name, index) {
    const hue = (index * 47) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="16" fill="hsl(${hue} 55% 45%)"/><text x="16" y="21" font-family="system-ui,sans-serif" font-size="14" font-weight="600" text-anchor="middle" fill="#fff">${initials(name)}</text></svg>`;
    return svgDataUri(svg);
}

function priorityIconUrl(colour) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 2 L14 12 H2 Z" fill="${colour}"/></svg>`;
    return svgDataUri(svg);
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------- people

function bitbucketUser(name, index) {
    const uuid = `{${crypto.createHash('md5').update(`bb-${name}`).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')}}`;
    const accountId = `712020:${crypto.createHash('md5').update(`account-${name}`).digest('hex').slice(0, 24)}`;
    return {
        type: 'user',
        uuid,
        account_id: accountId,
        display_name: name,
        nickname: slugify(name),
        links: {
            avatar: { href: avatarUrl(name, index) },
            html: { href: `https://bitbucket.org/${accountId}/` }
        }
    };
}

function jiraUser(name, index) {
    return {
        accountId: `712020:${crypto.createHash('md5').update(`account-${name}`).digest('hex').slice(0, 24)}`,
        displayName: name,
        emailAddress: `${slugify(name).replace(/-/g, '.')}@example.com`,
        active: true,
        avatarUrls: { '48x48': avatarUrl(name, index) }
    };
}

const team = people.map((name, index) => ({ bitbucket: bitbucketUser(name, index), jira: jiraUser(name, index) }));
const rovoDev = {
    type: 'user',
    uuid: '{5e6a9c70-0000-4000-8000-00000000r0v0}',
    account_id: '712020:rovo-dev-agent',
    display_name: 'Rovo Dev',
    nickname: 'rovo-dev',
    links: { avatar: { href: avatarUrl('Rovo Dev', 42) }, html: { href: 'https://bitbucket.org/rovo-dev/' } }
};

// ------------------------------------------------------------------- issues

function issueSummary(random, project) {
    const component = pick(random, components[project] || components.WEBCMN);
    const capitalised = component[0].toUpperCase() + component.slice(1);
    return random() < 0.6
        ? `${capitalised} ${pick(random, problems)}`
        : `${capitalised}: ${pick(random, improvements)}`;
}

// Issue numbers: each generation (a repository, or the project-level sprint
// fillers and orphans) owns a block of 1000 numbers per Jira project, so keys
// never collide and every call yields the same keys
const issueNumberBase = { SECOLLAB: 4800, PRDOSLC: 1320, WEBCMN: 610, WEBOSLC: 240 };
function createIssueNumbering(block) {
    const counters = new Map();
    return function nextIssueNumber(project) {
        const start = (issueNumberBase[project] || 100) + block * 1000;
        const next = (counters.get(project) ?? start) + 1;
        counters.set(project, next);
        return next;
    };
}

function createIssue(random, nextIssueNumber, project, { status, assignee, parent, type } = {}) {
    const key = `${project}-${nextIssueNumber(project)}`;
    const issueType = type || pickWeighted(random, issueTypes);
    const [priorityName, priorityColour] = pickWeighted(random, priorities.map(p => [[p[0], p[1]], p[2]]));
    const versions = fixVersionsByProject[project] || [];
    // Sub-tasks mostly inherit their fix version from the parent (the server does that too)
    const fixVersions = issueType === 'Sub-task' || random() < 0.25 ? [] : [pick(random, versions)];
    const assigneePerson = assignee === null ? null : (assignee || (random() < 0.85 ? pick(random, team) : null));
    return {
        id: String(10000 + Number(key.split('-')[1])),
        key,
        self: `https://${jiraSiteName}.atlassian.net/rest/api/3/issue/${key}`,
        fields: {
            summary: issueSummary(random, project),
            status: { name: status || pickWeighted(random, statuses), statusCategory: { key: 'indeterminate' } },
            priority: { name: priorityName, iconUrl: priorityIconUrl(priorityColour), id: String(priorities.findIndex(p => p[0] === priorityName) + 1) },
            fixVersions,
            assignee: assigneePerson ? assigneePerson.jira : null,
            issuetype: { name: issueType, subtask: issueType === 'Sub-task' },
            ...(parent ? { parent: { key: parent.key, fields: { summary: parent.fields.summary } } } : {})
        }
    };
}

// ------------------------------------------------------------ pull requests

function renderedDescription(random, title, issueKeys) {
    const paragraphs = integer(random, 1, 4);
    let html = `<p>${escapeHtml(title)}.</p>`;
    for (let i = 0; i < paragraphs; i++) {
        html += `<p>${escapeHtml(pick(random, [
            'Root cause: the merge base was computed on the wrong side, so removed items were reported as modified.',
            'This change refactors the loader to stream the pages instead of accumulating them in memory.',
            'Tested manually against the QA instance with the 2.7.x dataset, and with the new unit tests.',
            'Follow-up of the review comments: renamed the helper and added the missing null checks.',
            'The migration is idempotent and can be replayed on an already migrated database.',
            'Screenshots are attached to the Jira issue. No public API change.'
        ]))}</p>`;
    }
    if (issueKeys.length > 0) {
        html += '<ul>' + issueKeys.map(key => `<li><a href="https://${jiraSiteName}.atlassian.net/browse/${key}">${key}</a></li>`).join('') + '</ul>';
    }
    if (random() < 0.3) {
        html += '<pre><code>mvn -pl products.secollab verify -Dsurefire.failIfNoSpecifiedTests=false</code></pre>';
    }
    // Bitbucket fills the description with the commit list: 3 to 60 lines
    const commits = integer(random, 3, random() < 0.15 ? 60 : 20);
    html += '<ul>';
    for (let i = 0; i < commits; i++) {
        html += `<li><a href="https://bitbucket.org/${workspace}/commits/${hex(random, 40)}">${hex(random, 7)}</a> ${escapeHtml(pick(random, [
            'fix review comments', 'rename helper and add null checks', 'add unit tests', 'merge master into branch',
            'wip', 'update third-party libraries', 'fix NPE on empty selection', 'i18n: add French strings',
            'refactor loader to stream pages', 'add missing license headers', 'fix flaky test on CI'
        ]))}</li>`;
    }
    html += '</ul>';
    return html;
}

// Branch names follow the team convention INITIALS_YYMMDD_KEY_Slug (most of
// the time), with a few fix/ and bare KEY-slug branches
function branchName(random, kind, key, summary, createdDaysAgo) {
    const slug = slugify(summary);
    if (kind === 'convention') {
        const initials = pick(random, people).split(/\s+/).map(part => part[0]).join('').toUpperCase() + pick(random, ['', 'R', 'E', 'A']);
        const date = new Date(isoDaysAgo(createdDaysAgo));
        const yymmdd = `${String(date.getUTCFullYear()).slice(2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
        const titleSlug = slug.split('-').filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('-');
        return `${initials}_${yymmdd}_${key || 'NOKEY'}_${titleSlug}`;
    }
    if (kind === 'bare') {
        return `${key ? `${key}-` : ''}${slug}`;
    }
    return `${kind}/${key ? `${key}-` : ''}${slug}`;
}

function createParticipants(random, author) {
    const others = team.filter(person => person.bitbucket !== author);
    const count = pickWeighted(random, [[0, 3], [1, 6], [2, 3], [3, 1]]);
    const chosen = [];
    while (chosen.length < count) {
        const candidate = pick(random, others);
        if (!chosen.includes(candidate)) chosen.push(candidate);
    }
    const participants = [{
        type: 'participant', user: author, role: 'PARTICIPANT', approved: false, state: null, participated_on: null
    }];
    for (const person of chosen) {
        const state = pickWeighted(random, [['approved', 4], ['changes_requested', 1], [null, 4]]);
        participants.push({
            type: 'participant', user: person.bitbucket, role: 'REVIEWER',
            approved: state === 'approved', state, participated_on: state ? isoDaysAgo(integer(random, 0, 20)) : null
        });
    }
    if (random() < 0.3) {
        participants.push({ type: 'participant', user: rovoDev, role: 'REVIEWER', approved: false, state: null, participated_on: null });
    }
    return participants;
}

/**
 * Pull requests of one repository, with the Jira issues they refer to.
 * Chains are built by targeting the source branch of an earlier pull request.
 */
export function generateRepository(repoName, { scale = 1, chainDepth = deepChain.depth } = {}) {
    const random = createRandom(`repo-${repoName}`);
    const count = Math.round((repositoryVolumes[repoName] ?? 5) * scale);
    const chainLength = repoName === deepChain.repository ? Math.min(count, chainDepth + deepChain.sideBranches) : 0;
    const jiraProjects = repositoryJiraProjects[repoName] || [['WEBCMN', 1]];
    const rootBranches = repositoryRootBranches[repoName] || [['develop', 1]];
    const repository = {
        type: 'repository',
        name: repoName,
        full_name: `${workspace}/${repoName}`,
        uuid: `{${hex(random, 8)}-${hex(random, 4)}-${hex(random, 4)}-${hex(random, 4)}-${hex(random, 12)}}`,
        links: { html: { href: `https://bitbucket.org/${workspace}/${repoName}` } }
    };

    const pullRequests = [];
    const issues = [];
    const parentIssues = [];
    let id = repositoryFirstId[repoName] ?? 1;
    const nextIssueNumber = createIssueNumbering(Object.keys(repositoryVolumes).indexOf(repoName) + 1);

    for (let i = 0; i < count; i++) {
        const project = pickWeighted(random, jiraProjects);
        const author = pick(random, team).bitbucket;
        const status = pickWeighted(random, statuses);

        // Issues referenced in the title: usually one, sometimes two, rarely none
        const issueCount = pickWeighted(random, [[0, 1], [1, 12], [2, 3]]);
        const linkedIssues = [];
        for (let j = 0; j < issueCount; j++) {
            const type = pickWeighted(random, issueTypes);
            let parent = null;
            if (type === 'Sub-task') {
                // Half of the parents are only known through the sub-task (fetched separately by the server)
                parent = random() < 0.5 && issues.length > 0 ? pick(random, issues) : createIssue(random, nextIssueNumber, project, { type: 'Story', status: 'In Progress' });
                if (!issues.includes(parent)) parentIssues.push(parent);
            }
            const issue = createIssue(random, nextIssueNumber, project, { status: j === 0 ? status : (random() < 0.8 ? status : undefined), parent, type });
            linkedIssues.push(issue);
            issues.push(issue);
        }

        const summary = linkedIssues.length > 0 ? linkedIssues[0].fields.summary : issueSummary(random, project);
        const keys = linkedIssues.map(issue => issue.key);
        const title = keys.length > 0 ? `${keys.join(' ')} ${summary}` : summary;

        const createdDaysAgo = integer(random, 1, 180);

        // Destination: the deep chain first, then a root branch or the source
        // of an earlier pull request (stacked, 2 to 5 levels)
        let destinationBranch;
        let sourceBranch;
        if (i < chainLength) {
            const chain = pullRequests.slice(0, i);
            if (i === 0) {
                destinationBranch = deepChain.rootBranch;
                sourceBranch = deepChain.firstBranch;
            } else if (i < chainDepth) {
                destinationBranch = chain[i - 1].source.branch.name;
            } else {
                destinationBranch = chain[Math.floor(chain.length / 2) + (i - chainDepth)].source.branch.name; // side branch
            }
        } else {
            const stackable = pullRequests.slice(chainLength).slice(-12);
            if (stackable.length > 0 && random() < 0.3) {
                destinationBranch = pick(random, stackable).source.branch.name;
            } else {
                destinationBranch = pickWeighted(random, rootBranches);
            }
        }
        if (!sourceBranch) {
            const kind = repoName.startsWith('products.secollab')
                ? pickWeighted(random, [['convention', 8], ['fix', 1], ['bare', 1]])
                : pickWeighted(random, branchKinds);
            sourceBranch = branchName(random, kind, keys[0], summary, createdDaysAgo);
        }

        const updatedDaysAgo = integer(random, 0, Math.min(createdDaysAgo, 45));
        const commitsAhead = pickWeighted(random, [[integer(random, 1, 6), 6], [integer(random, 7, 40), 3], [100, 1]]);
        const commitsBehind = pickWeighted(random, [[0, 3], [integer(random, 1, 15), 5], [integer(random, 16, 99), 1], [100, 1]]);

        const pullRequest = {
            type: 'pullrequest',
            id: id++,
            title,
            state: 'OPEN',
            draft: random() < 0.1,
            author,
            created_on: isoDaysAgo(createdDaysAgo),
            updated_on: isoDaysAgo(updatedDaysAgo),
            comment_count: integer(random, 0, 14),
            task_count: integer(random, 0, 3),
            close_source_branch: true,
            source: {
                branch: { name: sourceBranch },
                commit: { hash: hex(random, 12) },
                repository
            },
            destination: {
                branch: { name: destinationBranch },
                commit: { hash: hex(random, 12) },
                repository
            },
            participants: createParticipants(random, author),
            rendered: {
                title: { type: 'rendered', raw: title, markup: 'markdown', html: `<p>${escapeHtml(title)}</p>` },
                description: { type: 'rendered', raw: '', markup: 'markdown', html: renderedDescription(random, summary, keys) }
            },
            links: {
                html: { href: `https://bitbucket.org/${workspace}/${repoName}/pull-requests/${id - 1}` }
            },
            commitsAhead,
            commitsBehind
        };
        pullRequests.push(pullRequest);
    }

    return { repository, pullRequests, issues, parentIssues };
}

// ------------------------------------------------------------------ project

const repositoryCache = new Map();
function repositoryData(repoName, options) {
    const cacheKey = `${repoName}@${options.scale}@${options.chainDepth}`;
    if (!repositoryCache.has(cacheKey)) {
        repositoryCache.set(cacheKey, generateRepository(repoName, options));
    }
    return repositoryCache.get(cacheKey);
}

function extractJiraIssues(title, jiraRegex) {
    return title.match(jiraRegex) || [];
}

/**
 * Builds the /api/pull-requests/:project response for a project, in the exact
 * shape produced by buildProjectData() in index.mjs.
 */
export function generateProjectData(projectName, projectConfig, { scale = 1, chainDepth = deepChain.depth } = {}) {
    const random = createRandom(`project-${projectName}-${scale}`);
    const nextIssueNumber = createIssueNumbering(9);
    const pullRequests = [];
    const knownIssues = new Map();
    for (const repoName of projectConfig.repositories) {
        const data = repositoryData(repoName, { scale, chainDepth });
        pullRequests.push(...data.pullRequests);
        for (const issue of [...data.issues, ...data.parentIssues]) {
            knownIssues.set(issue.key, issue);
        }
    }

    // Same regex-based extraction as the server: only keys matching the project regex count
    const jiraIssuesMap = {};
    for (const pullRequest of pullRequests) {
        jiraIssuesMap[pullRequest.id] = extractJiraIssues(pullRequest.title, projectConfig.jiraRegex);
    }
    const allJiraIssues = Object.values(jiraIssuesMap).flat();

    // Issue details only for the configured Jira projects (the JQL filters on project)
    const jiraIssuesDetails = [];
    const seen = new Set();
    for (const key of allJiraIssues) {
        const issue = knownIssues.get(key);
        if (issue && !seen.has(key) && projectConfig.jiraProjects.includes(key.split('-')[0])) {
            seen.add(key);
            jiraIssuesDetails.push(structuredClone(issue));
        }
    }
    // Parents of sub-tasks are fetched by the server with their fix versions only
    for (const issue of [...jiraIssuesDetails]) {
        const parentKey = issue.fields.parent?.key;
        if (parentKey && !seen.has(parentKey) && knownIssues.has(parentKey)) {
            seen.add(parentKey);
            const parent = knownIssues.get(parentKey);
            jiraIssuesDetails.push({ id: parent.id, key: parent.key, self: parent.self, fields: { fixVersions: parent.fields.fixVersions } });
        }
    }
    // Sub-tasks inherit the fix versions of their parent
    for (const issue of jiraIssuesDetails) {
        if (issue.fields.parent && (!issue.fields.fixVersions || issue.fields.fixVersions.length === 0)) {
            const parent = jiraIssuesDetails.find(candidate => candidate.key === issue.fields.parent.key);
            if (parent?.fields.fixVersions?.length > 0) {
                issue.fields.fixVersions = parent.fields.fixVersions;
            }
        }
    }

    const pullRequestsByDestination = {};
    for (const pullRequest of pullRequests) {
        const destination = pullRequest.destination.branch.name;
        (pullRequestsByDestination[destination] ??= []).push(pullRequest);
    }

    // Sprints: the linked issues of the project are spread over the sprints,
    // the remaining slots are filled with issues that have no pull request
    const sprints = sprintDefinitions.map(({ id, name }) => ({ id, name }));
    const counts = sprintIssueCounts[projectName] || {};
    const sprintIssues = {};
    const linkedKeys = jiraIssuesDetails.map(issue => issue.key).filter(key => key.split('-')[0] !== 'WEBOSLC');
    for (const sprint of sprintDefinitions) {
        const target = Math.round((counts[sprint.id] ?? 0) * scale);
        const keys = [];
        for (const key of linkedKeys) {
            if (keys.length >= target) break;
            if (key.startsWith(`${sprint.project}-`) && random() < 0.5) keys.push(key);
        }
        while (keys.length < target) {
            keys.push(`${sprint.project}-${nextIssueNumber(sprint.project)}`);
        }
        sprintIssues[sprint.id] = keys;
    }

    // Issues "In Review" without a pull request
    const orphanedIssues = [];
    const orphanCount = Math.round((orphanedIssueCounts[projectName] ?? 0) * scale);
    for (let i = 0; i < orphanCount; i++) {
        const project = pick(random, projectConfig.jiraProjects);
        const issue = createIssue(random, nextIssueNumber, project, { status: 'In Review' });
        orphanedIssues.push({
            id: issue.id,
            key: issue.key,
            self: issue.self,
            fields: {
                summary: issue.fields.summary,
                status: issue.fields.status,
                priority: issue.fields.priority,
                updated: isoDaysAgo(integer(random, 0, 30)),
                assignee: issue.fields.assignee
            },
            jiraSiteName
        });
    }

    const data = {
        pullRequests,
        jiraIssuesMap,
        jiraIssuesDetails,
        pullRequestsByDestination,
        jiraSiteName,
        sprints,
        sprintIssues,
        orphanedIssues
    };
    return {
        lastRefreshTime: new Date().toISOString(),
        ...data,
        dataHash: calculateHash(data)
    };
}

// Same hash as buildProjectData() in index.mjs, so the smart reload behaves as in production
function calculateHash(data) {
    const hash = crypto.createHash('md5');
    hash.update(JSON.stringify({
        pullRequests: data.pullRequests,
        jiraIssuesMap: data.jiraIssuesMap,
        jiraIssuesDetails: data.jiraIssuesDetails,
        sprints: data.sprints,
        sprintIssues: data.sprintIssues,
        orphanedIssues: data.orphanedIssues
    }));
    return hash.digest('hex');
}

/**
 * Builds the /api/sync-statuses/:project response: about a fifth of the pull
 * requests have conflicts, a few could not be computed.
 */
export function generateSyncStatuses(projectData) {
    const random = createRandom(`sync-${projectData.pullRequests.length}`);
    const statuses = {};
    for (const pullRequest of projectData.pullRequests) {
        const spec = `${pullRequest.destination.commit?.hash}..${pullRequest.source.commit?.hash}`;
        if (spec.includes('undefined')) continue;
        const roll = random();
        statuses[`${pullRequest.source.repository.name}/${spec}`] =
            roll < 0.04 ? { error: true } : { conflicts: roll < 0.24 };
    }
    return {
        lastRefreshTime: new Date().toISOString(),
        rateLimited: false,
        rateLimitedUntil: null,
        statuses
    };
}
