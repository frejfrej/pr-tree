import crypto from 'crypto';

/**
 * The data of a project as /api/pull-requests/:project answers it: the open
 * pull requests of its repositories (Bitbucket), the Jira issues they link
 * with the parents those issues need, the active sprints and their issues,
 * the issues in review without a pull request, and the hash the frontend
 * compares to know whether anything changed. Nothing here reads config.js
 * or talks to Atlassian by itself: fetch (the server passes atlassianFetch),
 * the workspace, the site and the credentials, and the logs are injected.
 * The fixture-mode branch and the project lookup stay in index.mjs.
 */

export function extractJiraIssues(title, jiraRegex) {
    return title.match(jiraRegex) || [];
}

export function createJiraIssuesMap(pullRequests, jiraRegex) {
    const jiraIssuesMap = new Map();
    pullRequests.forEach(pullRequest => {
        const jiraIssues = extractJiraIssues(pullRequest.title, jiraRegex);
        jiraIssuesMap.set(pullRequest.id, jiraIssues);
    });
    return jiraIssuesMap;
}

export function fillPullRequestsMap(pullRequests, pullRequestsByDestination) {
    pullRequests.forEach(pullRequest => {
        const destinationBranch = pullRequest.destination.branch.name;
        if (!pullRequestsByDestination.has(destinationBranch)) {
            pullRequestsByDestination.set(destinationBranch, []);
        }
        pullRequestsByDestination.get(destinationBranch).push(pullRequest);
    });
}

// Function to calculate hash of the response data
export function calculateHash(data) {
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

    async function fetchInReviewIssuesWithoutPR(jiraProjects, existingIssues) {
        const jiraBaseUrl = `https://${jiraSiteName}.atlassian.net/rest/api/3/search/jql`;
        const existingIssuesSet = new Set(existingIssues);
        let orphanedIssues = [];

        try {
            // Create JQL to find all issues in Review status that aren't in our existing issues
            const jql = `project in (${jiraProjects.join(',')}) AND status = "In Review" ORDER BY priority DESC, updated DESC`;
            const url = `${jiraBaseUrl}?jql=${encodeURIComponent(jql)}&fields=key,summary,status,priority,updated,assignee`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${jiraAuth}`,
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                // Filter out issues that already have pull requests
                orphanedIssues = data.issues.filter(issue => !existingIssuesSet.has(issue.key));

                // Add Jira site name to each issue for URL construction in frontend
                orphanedIssues = orphanedIssues.map(issue => ({
                    ...issue,
                    jiraSiteName: jiraSiteName
                }));

                log.access(`Found ${orphanedIssues.length} orphaned issues in review status`);
            } else {
                throw new Error(`Request failed with status code ${response.status}`);
            }
        } catch (error) {
            log.error(`Error fetching orphaned issues: ${error.message}`);
            throw error;
        }

        return orphanedIssues;
    }

    async function fetchCommitsDiff(repoName, sourceBranch, destinationBranch) {
        try {
            const compareUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/commits?include=${sourceBranch}&exclude=${destinationBranch}&pagelen=100`;
            const compareResponse = await fetch(compareUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${bbAuth}`,
                    'Accept': 'application/json'
                }
            });

            if (compareResponse.ok) {
                const compareData = await compareResponse.json();
                return compareData.values.length;
            } else {
                log.error(`Failed to fetch commits ahead for ${sourceBranch} compared to ${destinationBranch} in ${repoName} (HTTP ${compareResponse.status} ${compareResponse.statusText}`);
                return null;
            }
        } catch (error) {
            log.error(`Error fetching commits ahead: ${error.message}`);
            return null;
        }
    }

    async function fetchPullRequests(url, pullRequests) {
        const startTime = Date.now();
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${bbAuth}`,
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.values) {
                    pullRequests.push(...data.values);
                }
                if (data.next) {
                    await fetchPullRequests(data.next, pullRequests);
                }
            } else {
                throw new Error(`Request failed with status code ${response.status}`);
            }
        } catch (error) {
            log.error(`Error in fetchPullRequests: ${error.message}`);
            throw error;
        } finally {
            const duration = Date.now() - startTime;
            log.performance(`fetchPullRequests - URL: ${url} - Duration: ${duration}ms`);
        }
    }

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
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${jiraAuth}`,
                        'Accept': 'application/json'
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    jiraIssuesDetails.push(...data.issues);
                } else {
                    const data = await response.json();
                    throw new Error(`Request failed with status code: ${response.status}, status text: ${response.statusText}, body: ${JSON.stringify(data)}`);
                }
            } catch (error) {
                log.error(`Error in fetchJiraIssuesDetails: ${error.message}`);
                throw error;
            } finally {
                const duration = Date.now() - startTime;
                log.performance(`fetchJiraIssuesDetails - Batch ${i/50 + 1} - Duration: ${duration}ms`);
            }
        }

        // Collect parent keys that aren't in our results (for subtasks)
        const missingParentKeys = [];
        for (const issue of jiraIssuesDetails) {
            if (issue.fields.parent) {
                const parentKey = issue.fields.parent.key;
                if (!jiraIssuesDetails.find(i => i.key === parentKey) &&
                    !missingParentKeys.includes(parentKey)) {
                    missingParentKeys.push(parentKey);
                }
            }
        }

        // Fetch missing parent issues: their fix versions (inherited by sub-tasks)
        // and their summary, type and parent (epic and story filters)
        if (missingParentKeys.length > 0) {
            const parentJql = `key IN (${missingParentKeys.join(',')})`;
            const parentUrl = `${jiraBaseUrl}?jql=${encodeURIComponent(parentJql)}&fields=key,summary,issuetype,fixVersions,parent`;
            try {
                const startTime = Date.now();
                const response = await fetch(parentUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${jiraAuth}`,
                        'Accept': 'application/json'
                    }
                });
                if (response.ok) {
                    const data = await response.json();
                    jiraIssuesDetails.push(...data.issues);
                }
                const duration = Date.now() - startTime;
                log.performance(`fetchJiraIssuesDetails - Parent issues fetch (${missingParentKeys.length}) - Duration: ${duration}ms`);
            } catch (error) {
                log.error(`Error fetching parent issues: ${error.message}`);
            }
        }

        // Issues without fix versions inherit their parent's (sub-tasks from their story, stories from
        // their epic when it was fetched too). One pass in array order, so a version can travel
        // epic -> story -> sub-task when the story comes first
        for (const issue of jiraIssuesDetails) {
            if (issue.fields.parent &&
                (!issue.fields.fixVersions || issue.fields.fixVersions.length === 0)) {
                const parent = jiraIssuesDetails.find(i => i.key === issue.fields.parent.key);
                if (parent && parent.fields.fixVersions && parent.fields.fixVersions.length > 0) {
                    issue.fields.fixVersions = parent.fields.fixVersions;
                }
            }
        }

        return jiraIssuesDetails;
    }

    async function fetchJiraSprints(jiraProjects) {
        const sprints = new Set();

        for (const project of jiraProjects) {
            const boardsUrl = `https://${jiraSiteName}.atlassian.net/rest/agile/1.0/board?projectKeyOrId=${project}&type=scrum`;

            try {
                const boardsResponse = await fetch(boardsUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${jiraAuth}`,
                        'Accept': 'application/json'
                    }
                });

                if (boardsResponse.ok) {
                    const boardsData = await boardsResponse.json();
                    log.performance(`Fetched ${boardsData.total} boards for project ${project}`);
                    for (const board of boardsData.values) {
                        const sprintsUrl = `https://${jiraSiteName}.atlassian.net/rest/agile/1.0/board/${board.id}/sprint?state=active`;
                        const sprintsResponse = await fetch(sprintsUrl, {
                            method: 'GET',
                            headers: {
                                'Authorization': `Basic ${jiraAuth}`,
                                'Accept': 'application/json'
                            }
                        });

                        if (sprintsResponse.ok) {
                            const sprintsData = await sprintsResponse.json();
                            log.performance(`Fetched ${sprintsData.total} active sprints for board ${board.name}`);
                            for (const sprint of sprintsData.values) {
                                sprints.add(JSON.stringify({id: sprint.id, name: sprint.name}));
                            }
                        }
                    }
                }
            } catch (error) {
                log.error(`Error fetching sprints for project ${project}: ${error.message}`);
            }
        }

        return Array.from(sprints).map(JSON.parse);
    }

    async function fetchSprintIssues(sprints, jiraProjects) {
        const sprintIssues = {};

        for (const sprint of sprints) {
            const jql = `sprint = ${sprint.id} AND project in (${jiraProjects.join(',')})`;
            let startAt = 0;
            const maxResults = 100;
            let total = 0;
            sprintIssues[sprint.id] = [];

            do {
                const url = `https://${jiraSiteName}.atlassian.net/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key&startAt=${startAt}&maxResults=${maxResults}`;

                try {
                    const startTime = Date.now();
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Basic ${jiraAuth}`,
                            'Accept': 'application/json'
                        }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        sprintIssues[sprint.id].push(...data.issues.map(issue => issue.key));
                        total = data.total;
                        startAt += data.issues.length;

                        const duration = Date.now() - startTime;
                        log.performance(`Fetched ${data.issues.length} issues for sprint ${sprint.id} (${startAt}/${total}) - Duration: ${duration}ms`);
                    } else {
                        throw new Error(`Request failed with status code ${response.status}`);
                    }
                } catch (error) {
                    log.error(`Error fetching issues for sprint ${sprint.id}: ${error.message}`);
                    break; // Exit the loop if there's an error, but continue with other sprints
                }
            } while (startAt < total);

            log.access(`Retrieved a total of ${sprintIssues[sprint.id].length} issues for sprint ${sprint.id}`);
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

        let allPullRequests = [];
        let pullRequestsByDestination = new Map();

        for (const repoName of projectConfig.repositories) {
            const baseUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/pullrequests?fields=%2Bvalues.*,%2Bvalues.properties*,%2Bvalues.rendered.*,-values.description,-values.summary&pagelen=50`;
            let pullRequests = [];
            await fetchPullRequests(baseUrl, pullRequests);
            allPullRequests.push(...pullRequests);
            log.access(`Retrieved ${pullRequests.length} pull requests for repository: ${repoName}`);
        }

        fillPullRequestsMap(allPullRequests, pullRequestsByDestination);
        const jiraIssuesMap = createJiraIssuesMap(allPullRequests, projectConfig.jiraRegex);
        const allJiraIssues = Array.from(jiraIssuesMap.values()).flat();
        log.access(`Total JIRA issues found: ${allJiraIssues.length}`);

        const jiraIssuesDetails = await fetchJiraIssuesDetails(allJiraIssues, projectConfig.jiraProjects);

        // Fetch sprints
        const sprints = await fetchJiraSprints(projectConfig.jiraProjects);
        log.access(`Retrieved ${sprints.length} sprints for project: ${projectName}`);

        // Fetch sprint issues
        const sprintIssues = await fetchSprintIssues(sprints, projectConfig.jiraProjects);
        log.access(`Retrieved issues for ${Object.keys(sprintIssues).length} sprints`);

        // retrieve orphaned issues
        const orphanedIssues = await fetchInReviewIssuesWithoutPR(
            projectConfig.jiraProjects,
            allJiraIssues
        );

        // calculate dataHash and determine if the data is new based on the last saved response
        let dataHash = calculateHash({ pullRequests: allPullRequests, jiraIssuesMap, jiraIssuesDetails, sprints, sprintIssues, orphanedIssues })

        let response;
        if (lastResponse?.dataHash !== dataHash) {
            // if the hash is new, retrieve ahead and behind commit counts
            // Fetch commit differences for each pull request
            const pullRequestsWithCommits = await Promise.all(allPullRequests.map(async (pr) => {
                const commitsAhead = await fetchCommitsDiff(
                    pr.source.repository.name,
                    pr.source.branch.name,
                    pr.destination.branch.name
                );
                const commitsBehind = await fetchCommitsDiff(
                    pr.source.repository.name,
                    pr.destination.branch.name,
                    pr.source.branch.name
                );
                return {
                    ...pr,
                    commitsAhead: commitsAhead,
                    commitsBehind: commitsBehind
                };
            }));

            response = {
                lastRefreshTime: new Date().toISOString(),
                pullRequests: pullRequestsWithCommits,
                jiraIssuesMap: Object.fromEntries(jiraIssuesMap.entries()),
                jiraIssuesDetails: jiraIssuesDetails,
                pullRequestsByDestination: Object.fromEntries(pullRequestsByDestination.entries()),
                jiraSiteName: jiraSiteName,
                sprints: sprints,
                sprintIssues: sprintIssues,
                orphanedIssues: orphanedIssues,
                dataHash: dataHash
            };

            lastResponse = response;

        } else {
            // response is the same, just update the lastRefreshTime
            response = lastResponse;
            response.lastRefreshTime = new Date().toISOString();
        }

        return response;
    }

    return {
        buildProjectData,
        fetchPullRequests,
        fetchJiraIssuesDetails,
        fetchJiraSprints,
        fetchSprintIssues,
        fetchInReviewIssuesWithoutPR,
        fetchCommitsDiff
    };
}
