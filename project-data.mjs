import { createJiraIssuesMap, missingParentKeys, assembleProjectData } from './project-assembly.mjs';
import { RateLimitError } from './atlassian-fetch.mjs';
import { createLimiter } from './limiter.mjs';

/**
 * The data of a project as /api/pull-requests/:project answers it: the open
 * pull requests of its repositories (Bitbucket), the Jira issues they link
 * with the parents those issues need, the active sprints and their issues,
 * the issues in review without a pull request, and the hash the frontend
 * compares to know whether anything changed. Every pull request is sent once,
 * in one list: the tree groups them per repository and by destination branch
 * itself (app-render.js). Nothing here reads config.js or talks to Atlassian
 * by itself: fetch (the server passes atlassianFetch), the workspace, the site
 * and the credentials, and the logs are injected; the pure post-processing
 * (the issue map, the parents to fetch, the inheritance, the hash, the
 * response shape) is project-assembly.mjs, shared with the fixture generator.
 * The fixture-mode branch and the project lookup stay in index.mjs.
 */

// The fetchers that keep the build going after a failed request still let a
// rate-limit pause end it: every later request would fail the same way, and a
// response without its parents, sprints or commit counts would be cached for
// the whole pause (the route answers 503 instead)
function rethrowRateLimit(error) {
    if (error instanceof RateLimitError) throw error;
}

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch - sends a request to Atlassian (the server passes atlassianFetch)
 * @param {string} options.workspace - the Bitbucket workspace slug
 * @param {string} options.bbAuth - the Base64 credentials of the Bitbucket Authorization header
 * @param {string} options.jiraSiteName - the subdomain of atlassian.net
 * @param {string} options.jiraAuth - the Base64 credentials of the Jira Authorization header
 * @param {{ access: (message: string) => void, error: (message: string) => void, performance: (message: string) => void }} options.log - the logs
 * @param {number} [options.maxConcurrentCommitRequests=10] - commit-count requests at once
 * @param {number} [options.timeoutMs=30000] - the timeout of one request: concurrent requests for a project share its build (cache.mjs), so a request that hangs would hold them all
 */
export function createProjectData({ fetch, workspace, bbAuth, jiraSiteName, jiraAuth, log, maxConcurrentCommitRequests = 10, timeoutMs = 30000 }) {
    // The commit counts of the last build of each project, by project name then
    // by "repo/destHash..sourceHash": a count is fetched again only when a commit
    // of its pull request moved, whatever else changed in Bitbucket or Jira
    const commitCountsByProject = new Map();
    const commitsLimiter = createLimiter(maxConcurrentCommitRequests);

    // One GET per API, with its credentials: the parsed body of an ok response,
    // otherwise an error with the status, the body drained first so the socket
    // is released. Jira's body says what was wrong with the JQL, so its first
    // 200 characters follow the status; Bitbucket's is an HTML page, left out.
    async function getJson(url, auth, keepBody) {
        const response = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            }
        });
        if (response.ok) return response.json();
        const body = await response.text().catch(() => '');
        throw new Error(`Request failed with status code ${response.status}${keepBody && body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    const bitbucketJson = url => getJson(url, bbAuth, false);
    const jiraJson = url => getJson(url, jiraAuth, true);

    // Every page of a Jira search. The search endpoint pages with a token: no
    // total, no startAt (a page is the last one when isLast is true or no token
    // comes back with it). A failed page throws; the caller decides what to keep.
    async function* searchIssuePages(jql, fields, maxResults = 100) {
        let nextPageToken = null;
        do {
            const pageParam = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : '';
            const url = `https://${jiraSiteName}.atlassian.net/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=${maxResults}${pageParam}`;
            const data = await jiraJson(url);
            nextPageToken = data.isLast === false && data.nextPageToken ? data.nextPageToken : null;
            yield { issues: data.issues, last: !nextPageToken };
        } while (nextPageToken);
    }

    async function fetchInReviewIssuesWithoutPR(jiraProjects, existingIssues) {
        const existingIssuesSet = new Set(existingIssues);
        const orphanedIssues = [];

        try {
            // Every issue in review of the projects, minus those a pull request links,
            // with the fields the filters need (fix versions, parent and type like the linked issues)
            const jql = `project in (${jiraProjects.join(',')}) AND status = "In Review" ORDER BY priority DESC, updated DESC`;
            for await (const page of searchIssuePages(jql, 'key,summary,status,priority,fixVersions,assignee,parent,issuetype,updated')) {
                orphanedIssues.push(...page.issues.filter(issue => !existingIssuesSet.has(issue.key)));
            }
            log.access(`Found ${orphanedIssues.length} orphaned issues in review status`);
        } catch (error) {
            log.error(`Error fetching orphaned issues: ${error.message}`);
            throw error;
        }

        return orphanedIssues;
    }

    // The number of commits of `sourceBranch` that `destinationBranch` does not have
    // (up to 100); null when the request fails, which is logged
    async function fetchCommitsDiff(repoName, sourceBranch, destinationBranch) {
        const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/commits?include=${encodeURIComponent(sourceBranch)}&exclude=${encodeURIComponent(destinationBranch)}&pagelen=100`;
        try {
            const data = await bitbucketJson(url);
            return data.values.length;
        } catch (error) {
            rethrowRateLimit(error);
            log.error(`Error fetching commits ahead for ${sourceBranch} compared to ${destinationBranch} in ${repoName}: ${error.message}`);
            return null;
        }
    }

    // Every page of the open pull requests of a repository, following `next`,
    // into the array given; a failed page fails the build (logged)
    async function fetchPullRequests(url, pullRequests) {
        let next = url;
        while (next) {
            const pageUrl = next;
            const startTime = Date.now();
            try {
                const data = await bitbucketJson(pageUrl);
                if (data.values) {
                    pullRequests.push(...data.values);
                }
                next = data.next || null;
            } catch (error) {
                log.error(`Error in fetchPullRequests: ${error.message}`);
                throw error;
            } finally {
                const duration = Date.now() - startTime;
                log.performance(`fetchPullRequests - URL: ${pageUrl} - Duration: ${duration}ms`);
            }
        }
    }

    // The linked issues in batches of 50 (their parents are fetchParentIssues' job)
    async function fetchJiraIssuesDetails(jiraIssues, jiraProjects) {
        const jiraBaseUrl = `https://${jiraSiteName}.atlassian.net/rest/api/3/search/jql`;

        let pageSize = 50;
        const jiraIssuesDetails = [];
        for (let i = 0; i < jiraIssues.length; i += pageSize) {
            const startTime = Date.now();
            const jiraIssuesBatch = jiraIssues.slice(i, i + pageSize);
            const jql = `issueKey in (${jiraIssuesBatch.join(',')}) AND project in (${jiraProjects.join(',')})`;
            const url = `${jiraBaseUrl}?jql=${encodeURIComponent(jql)}&fields=key,summary,status,priority,fixVersions,assignee,parent,issuetype`;

            try {
                const data = await jiraJson(url);
                jiraIssuesDetails.push(...data.issues);
            } catch (error) {
                log.error(`Error in fetchJiraIssuesDetails: ${error.message}`);
                throw error;
            } finally {
                const duration = Date.now() - startTime;
                log.performance(`fetchJiraIssuesDetails - Batch ${i/50 + 1} - Duration: ${duration}ms`);
            }
        }

        return jiraIssuesDetails;
    }

    // The parents of the linked and orphaned issues (summary, type, fix versions
    // and parent: what the epic and story filters and the inheritance need), in
    // one search, every page of it (a single request stopped at Jira's default
    // page of 50); a failure is logged and gives no parents, the build goes on
    async function fetchParentIssues(keys) {
        if (keys.length === 0) return [];
        try {
            const startTime = Date.now();
            const parents = [];
            for await (const page of searchIssuePages(`key IN (${keys.join(',')})`, 'key,summary,issuetype,fixVersions,parent')) {
                parents.push(...page.issues);
            }
            log.performance(`fetchJiraIssuesDetails - Parent issues fetch (${keys.length}) - Duration: ${Date.now() - startTime}ms`);
            return parents;
        } catch (error) {
            rethrowRateLimit(error);
            log.error(`Error fetching parent issues: ${error.message}`);
            return [];
        }
    }

    // The active sprints of every scrum board of each Jira project, { id, name },
    // a sprint shared by two boards once. A failed boards request skips the
    // project's sprints, a failed sprints request skips that board; both logged
    async function fetchJiraSprints(jiraProjects) {
        const sprints = new Set();

        for (const project of jiraProjects) {
            let boards;
            try {
                const boardsData = await jiraJson(`https://${jiraSiteName}.atlassian.net/rest/agile/1.0/board?projectKeyOrId=${project}&type=scrum`);
                log.performance(`Fetched ${boardsData.total} boards for project ${project}`);
                boards = boardsData.values || []; // a body without boards skips the project too, not the build
            } catch (error) {
                rethrowRateLimit(error);
                log.error(`Error fetching sprints for project ${project}: ${error.message}`);
                continue;
            }

            for (const board of boards) {
                try {
                    const sprintsData = await jiraJson(`https://${jiraSiteName}.atlassian.net/rest/agile/1.0/board/${board.id}/sprint?state=active`);
                    log.performance(`Fetched ${sprintsData.total} active sprints for board ${board.name}`);
                    for (const sprint of sprintsData.values) {
                        sprints.add(JSON.stringify({ id: sprint.id, name: sprint.name }));
                    }
                } catch (error) {
                    rethrowRateLimit(error);
                    log.error(`Error fetching the sprints of board ${board.name} (project ${project}): ${error.message}`);
                }
            }
        }

        return Array.from(sprints).map(JSON.parse);
    }

    async function fetchSprintIssues(sprints, jiraProjects) {
        const sprintIssues = {};

        for (const sprint of sprints) {
            const jql = `sprint = ${sprint.id} AND project in (${jiraProjects.join(',')})`;
            const keys = sprintIssues[sprint.id] = [];

            try {
                let startTime = Date.now();
                for await (const page of searchIssuePages(jql, 'key')) {
                    keys.push(...page.issues.map(issue => issue.key));
                    log.performance(`Fetched ${page.issues.length} issues for sprint ${sprint.id} (${keys.length} so far${page.last ? '' : ', more to come'}) - Duration: ${Date.now() - startTime}ms`);
                    startTime = Date.now();
                }
            } catch (error) {
                rethrowRateLimit(error);
                // The pages read so far are kept; the other sprints are still fetched
                log.error(`Error fetching issues for sprint ${sprint.id}: ${error.message}`);
            }

            log.access(`Retrieved a total of ${keys.length} issues for sprint ${sprint.id}`);
        }

        return sprintIssues;
    }

    // The commit counts of every pull request, two requests each: the ones of the
    // last build of the project when its commits have not moved; the counts of
    // this build replace them, a failed count (null) left out so it is retried.
    // A count fetched is also added to the counts known at once, so a build that
    // fails midway (a rate-limit pause) keeps the counts it got for the next one.
    async function addCommitCounts(projectName, pullRequests) {
        let known = commitCountsByProject.get(projectName);
        if (!known) {
            known = new Map();
            commitCountsByProject.set(projectName, known);
        }
        const kept = new Map();
        const countCommits = (repoName, include, exclude) => commitsLimiter(() => fetchCommitsDiff(repoName, include, exclude));
        const withCounts = await Promise.all(pullRequests.map(async (pr) => {
            const repoName = pr.source.repository.name;
            const destinationHash = pr.destination.commit?.hash, sourceHash = pr.source.commit?.hash;
            const key = destinationHash && sourceHash ? `${repoName}/${destinationHash}..${sourceHash}` : null;
            let counts = key && known.get(key);
            if (!counts) {
                const [commitsAhead, commitsBehind] = await Promise.all([
                    countCommits(repoName, pr.source.branch.name, pr.destination.branch.name),
                    countCommits(repoName, pr.destination.branch.name, pr.source.branch.name)
                ]);
                counts = { commitsAhead, commitsBehind };
                if (key && commitsAhead !== null && commitsBehind !== null) known.set(key, counts);
            }
            if (key && counts.commitsAhead !== null && counts.commitsBehind !== null) kept.set(key, counts);
            return { ...pr, ...counts };
        }));
        commitCountsByProject.set(projectName, kept);
        return withCounts;
    }

    // The open pull requests of the repositories with their commit counts, the
    // Jira issues they link, the issues in review no pull request links and the
    // parents of both; the counts are fetched alongside the Jira issues
    async function fetchPullRequestsWithIssues(projectName, projectConfig) {
        const allPullRequests = [];
        for (const repoName of projectConfig.repositories) {
            const baseUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/pullrequests?fields=%2Bvalues.*,%2Bvalues.properties*,%2Bvalues.rendered.*,-values.description,-values.summary&pagelen=50`;
            const pullRequests = [];
            await fetchPullRequests(baseUrl, pullRequests);
            allPullRequests.push(...pullRequests);
            log.access(`Retrieved ${pullRequests.length} pull requests for repository: ${repoName}`);
        }

        const jiraIssuesMap = createJiraIssuesMap(allPullRequests, projectConfig.jiraRegex);
        const allJiraIssues = Array.from(jiraIssuesMap.values()).flat();
        log.access(`Total JIRA issues found: ${allJiraIssues.length}`);

        const [pullRequests, issues] = await Promise.all([
            addCommitCounts(projectName, allPullRequests),
            fetchIssues(projectConfig.jiraProjects, allJiraIssues)
        ]);
        return { pullRequests, jiraIssuesMap, ...issues };
    }

    // The issues in review no pull request links, before the details so that one
    // request fetches their parents with the parents of the linked issues
    async function fetchIssues(jiraProjects, allJiraIssues) {
        const orphanedIssues = await fetchInReviewIssuesWithoutPR(jiraProjects, allJiraIssues);
        const jiraIssuesDetails = await fetchJiraIssuesDetails(allJiraIssues, jiraProjects);
        const parents = await fetchParentIssues(missingParentKeys([...jiraIssuesDetails, ...orphanedIssues]));
        return { orphanedIssues, jiraIssuesDetails, parents };
    }

    // The active sprints of the Jira projects and their issues
    async function fetchSprintsWithIssues(projectName, jiraProjects) {
        const sprints = await fetchJiraSprints(jiraProjects);
        log.access(`Retrieved ${sprints.length} sprints for project: ${projectName}`);
        const sprintIssues = await fetchSprintIssues(sprints, jiraProjects);
        log.access(`Retrieved issues for ${Object.keys(sprintIssues).length} sprints`);
        return { sprints, sprintIssues };
    }

    /**
     * The response of /api/pull-requests/:project for a project of projects.js.
     * The sprints, which depend on nothing else, are fetched alongside the rest;
     * the commit counts of a pull request are fetched only when one of its
     * commits moved since the last build of the project. The hash covers the
     * counts, so a count that changes (a failed one fetched again) is rendered
     * @param {string} projectName
     * @param {{ repositories: string[], jiraProjects: string[], jiraRegex: RegExp }} projectConfig
     */
    async function buildProjectData(projectName, projectConfig) {
        log.access(`Processing pull requests for project: ${projectName}`);

        const [{ pullRequests, jiraIssuesMap, orphanedIssues, jiraIssuesDetails, parents }, { sprints, sprintIssues }] = await Promise.all([
            fetchPullRequestsWithIssues(projectName, projectConfig),
            fetchSprintsWithIssues(projectName, projectConfig.jiraProjects)
        ]);

        const assembled = assembleProjectData({ pullRequests, jiraIssuesMap, jiraIssuesDetails, parents, orphanedIssues, sprints, sprintIssues, jiraSiteName });
        return { lastRefreshTime: new Date().toISOString(), ...assembled };
    }

    return {
        buildProjectData,
        fetchPullRequests,
        fetchJiraIssuesDetails,
        fetchParentIssues,
        fetchJiraSprints,
        fetchSprintIssues,
        fetchInReviewIssuesWithoutPR,
        fetchCommitsDiff
    };
}
