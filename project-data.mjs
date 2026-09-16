import { createJiraIssuesMap, missingParentKeys, assembleProjectData } from './project-assembly.mjs';

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

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch - sends a request to Atlassian (the server passes atlassianFetch)
 * @param {string} options.workspace - the Bitbucket workspace slug
 * @param {string} options.bbAuth - the Base64 credentials of the Bitbucket Authorization header
 * @param {string} options.jiraSiteName - the subdomain of atlassian.net
 * @param {string} options.jiraAuth - the Base64 credentials of the Jira Authorization header
 * @param {{ access: (message: string) => void, error: (message: string) => void, performance: (message: string) => void }} options.log - the logs
 */
export function createProjectData({ fetch, workspace, bbAuth, jiraSiteName, jiraAuth, log }) {
    // last sent reponse is cached for performance
    let lastResponse = null;

    // One GET per API, with its credentials: the parsed body of an ok response,
    // otherwise an error with the status, the body drained first so the socket
    // is released. Jira's body says what was wrong with the JQL, so its first
    // 200 characters follow the status; Bitbucket's is an HTML page, left out.
    async function getJson(url, auth, keepBody) {
        const response = await fetch(url, {
            method: 'GET',
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
        const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/commits?include=${sourceBranch}&exclude=${destinationBranch}&pagelen=100`;
        try {
            const data = await bitbucketJson(url);
            return data.values.length;
        } catch (error) {
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
    // one request; a failure is logged and gives no parents, the build goes on
    async function fetchParentIssues(keys) {
        if (keys.length === 0) return [];
        const jql = `key IN (${keys.join(',')})`;
        const url = `https://${jiraSiteName}.atlassian.net/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key,summary,issuetype,fixVersions,parent`;
        try {
            const startTime = Date.now();
            const data = await jiraJson(url);
            log.performance(`fetchJiraIssuesDetails - Parent issues fetch (${keys.length}) - Duration: ${Date.now() - startTime}ms`);
            return data.issues;
        } catch (error) {
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
                boards = boardsData.values;
            } catch (error) {
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
                // The pages read so far are kept; the other sprints are still fetched
                log.error(`Error fetching issues for sprint ${sprint.id}: ${error.message}`);
            }

            log.access(`Retrieved a total of ${keys.length} issues for sprint ${sprint.id}`);
        }

        return sprintIssues;
    }

    /**
     * The response of /api/pull-requests/:project for a project of projects.js;
     * the commit counts of the pull requests are fetched only when the hash of
     * the rest changed since the last response built
     * @param {string} projectName
     * @param {{ repositories: string[], jiraProjects: string[], jiraRegex: RegExp }} projectConfig
     */
    async function buildProjectData(projectName, projectConfig) {
        log.access(`Processing pull requests for project: ${projectName}`);

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

        // The issues in review no pull request links, before the details so that
        // one request fetches their parents with the parents of the linked issues
        const orphanedIssues = await fetchInReviewIssuesWithoutPR(projectConfig.jiraProjects, allJiraIssues);
        const jiraIssuesDetails = await fetchJiraIssuesDetails(allJiraIssues, projectConfig.jiraProjects);
        const parents = await fetchParentIssues(missingParentKeys([...jiraIssuesDetails, ...orphanedIssues]));

        const sprints = await fetchJiraSprints(projectConfig.jiraProjects);
        log.access(`Retrieved ${sprints.length} sprints for project: ${projectName}`);
        const sprintIssues = await fetchSprintIssues(sprints, projectConfig.jiraProjects);
        log.access(`Retrieved issues for ${Object.keys(sprintIssues).length} sprints`);

        const assembled = assembleProjectData({ pullRequests: allPullRequests, jiraIssuesMap, jiraIssuesDetails, parents, orphanedIssues, sprints, sprintIssues, jiraSiteName });

        // Nothing changed since the last response built: serve it again with a new time,
        // without the two commit requests per pull request
        if (lastResponse?.dataHash === assembled.dataHash) {
            lastResponse.lastRefreshTime = new Date().toISOString();
            return lastResponse;
        }
        const pullRequestsWithCommits = await Promise.all(allPullRequests.map(async (pr) => {
            const commitsAhead = await fetchCommitsDiff(pr.source.repository.name, pr.source.branch.name, pr.destination.branch.name);
            const commitsBehind = await fetchCommitsDiff(pr.source.repository.name, pr.destination.branch.name, pr.source.branch.name);
            return { ...pr, commitsAhead, commitsBehind };
        }));
        lastResponse = { lastRefreshTime: new Date().toISOString(), ...assembled, pullRequests: pullRequestsWithCommits };
        return lastResponse;
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
