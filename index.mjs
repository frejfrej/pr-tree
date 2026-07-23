import express from 'express';
import fetch from 'node-fetch';
import { diff3Merge } from 'node-diff3';
import dotenv from 'dotenv';
import config from './config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

import {
    getCachedProjects,
    getCachedProjectData,
    getCachedConflicts,
    getCachedSprints,
    getCacheStats
} from './cache.mjs';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jiraAuth = Buffer.from(`${config.jira.username}:${config.jira.apiKey}`).toString('base64');
const bbAuth = Buffer.from(`${config.bitbucket.username}:${config.bitbucket.password}`).toString('base64');

// Read package.json to get the version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const version = packageJson.version;
const releaseDate = packageJson.releaseDate || new Date().toISOString().split('T')[0]; // Use current date if not specified
const author = packageJson.author;
const license = packageJson.license;

// last sent reponse is cached for performance
let lastResponse = null;

// Serve all files in the public folder
app.use(express.static('public'));

// Serve README.md from the root directory
app.use(express.static(__dirname, {
    index: false, // Prevent serving index.html from root
    extensions: ['md'] // Allow serving .md files without extension
}));

// Serve the version details
app.get('/api/version', (req, res) => {
    res.json({ version, releaseDate, author, license });
});

// Create write streams for different log types
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });
const errorLogStream = fs.createWriteStream(path.join(__dirname, 'error.log'), { flags: 'a' });
const performanceLogStream = fs.createWriteStream(path.join(__dirname, 'performance.log'), { flags: 'a' });

// Logging function
function log(message, logStream) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message}\n`;
    console.log(logMessage.trim()); // Log to console
    logStream.write(logMessage); // Log to file
}

// Custom logging middleware for access logs
app.use((req, res, next) => {
    const logMessage = `${req.method} ${req.path} - Query: ${JSON.stringify(req.query)} - IP: ${req.ip}`;
    log(logMessage, accessLogStream);
    next();
});

async function fetchInReviewIssuesWithoutPR(jiraProjects, existingIssues) {
    const jiraBaseUrl = `https://${config.jira.siteName}.atlassian.net/rest/api/3/search/jql`;
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
                jiraSiteName: config.jira.siteName
            }));

            log(`Found ${orphanedIssues.length} orphaned issues in review status`, accessLogStream);
        } else {
            throw new Error(`Request failed with status code ${response.status}`);
        }
    } catch (error) {
        log(`Error fetching orphaned issues: ${error.message}`, errorLogStream);
        throw error;
    }

    return orphanedIssues;
}

async function fetchCommitsDiff(repoName, sourceBranch, destinationBranch) {
    try {
        const compareUrl = `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${repoName}/commits?include=${sourceBranch}&exclude=${destinationBranch}&pagelen=100`;
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
            log(`Failed to fetch commits ahead for ${sourceBranch} compared to ${destinationBranch} in ${repoName} (HTTP ${compareResponse.status} ${compareResponse.statusText}`, errorLogStream);
            return null;
        }
    } catch (error) {
        log(`Error fetching commits ahead: ${error.message}`, errorLogStream);
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
        log(`Error in fetchPullRequests: ${error.message}`, errorLogStream);
        throw error;
    } finally {
        const duration = Date.now() - startTime;
        log(`fetchPullRequests - URL: ${url} - Duration: ${duration}ms`, performanceLogStream);
    }
}

function extractJiraIssues(title, jiraRegex) {
    return title.match(jiraRegex) || [];
}

function createJiraIssuesMap(pullRequests, jiraRegex) {
    const jiraIssuesMap = new Map();
    pullRequests.forEach(pullRequest => {
        const jiraIssues = extractJiraIssues(pullRequest.title, jiraRegex);
        jiraIssuesMap.set(pullRequest.id, jiraIssues);
    });
    return jiraIssuesMap;
}

async function fetchJiraIssuesDetails(jiraIssues, jiraProjects) {
    const jiraBaseUrl = `https://${config.jira.siteName}.atlassian.net/rest/api/3/search/jql`;

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
            log(`Error in fetchJiraIssuesDetails: ${error.message}`, errorLogStream);
            throw error;
        } finally {
            const duration = Date.now() - startTime;
            log(`fetchJiraIssuesDetails - Batch ${i/50 + 1} - Duration: ${duration}ms`, performanceLogStream);
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

    // Fetch missing parent issues to get their fix versions
    if (missingParentKeys.length > 0) {
        const parentJql = `key IN (${missingParentKeys.join(',')})`;
        const parentUrl = `${jiraBaseUrl}?jql=${encodeURIComponent(parentJql)}&fields=key,fixVersions`;
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
            log(`fetchJiraIssuesDetails - Parent issues fetch (${missingParentKeys.length}) - Duration: ${duration}ms`, performanceLogStream);
        } catch (error) {
            log(`Error fetching parent issues: ${error.message}`, errorLogStream);
        }
    }

    // Inherit fix versions from parent for subtasks without fix versions
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

function fillPullRequestsMap(pullRequests, pullRequestsByDestination) {
    pullRequests.forEach(pullRequest => {
        const destinationBranch = pullRequest.destination.branch.name;
        if (!pullRequestsByDestination.has(destinationBranch)) {
            pullRequestsByDestination.set(destinationBranch, []);
        }
        pullRequestsByDestination.get(destinationBranch).push(pullRequest);
    });
}

// Function to calculate hash of the response data
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

async function fetchJiraSprints(jiraProjects) {
    const jiraAuth = Buffer.from(`${config.jira.username}:${config.jira.apiKey}`).toString('base64');
    const sprints = new Set();

    for (const project of jiraProjects) {
        const boardsUrl = `https://${config.jira.siteName}.atlassian.net/rest/agile/1.0/board?projectKeyOrId=${project}&type=scrum`;

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
                log(`Fetched ${boardsData.total} boards for project ${project}`, performanceLogStream);
                for (const board of boardsData.values) {
                    const sprintsUrl = `https://${config.jira.siteName}.atlassian.net/rest/agile/1.0/board/${board.id}/sprint?state=active`;
                    const sprintsResponse = await fetch(sprintsUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Basic ${jiraAuth}`,
                            'Accept': 'application/json'
                        }
                    });

                    if (sprintsResponse.ok) {
                        const sprintsData = await sprintsResponse.json();
                        log(`Fetched ${sprintsData.total} active sprints for board ${board.name}`, performanceLogStream);
                        for (const sprint of sprintsData.values) {
                            sprints.add(JSON.stringify({id: sprint.id, name: sprint.name}));
                        }
                    }
                }
            }
        } catch (error) {
            log(`Error fetching sprints for project ${project}: ${error.message}`, errorLogStream);
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
            const url = `https://${config.jira.siteName}.atlassian.net/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key&startAt=${startAt}&maxResults=${maxResults}`;

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
                    log(`Fetched ${data.issues.length} issues for sprint ${sprint.id} (${startAt}/${total}) - Duration: ${duration}ms`, performanceLogStream);
                } else {
                    throw new Error(`Request failed with status code ${response.status}`);
                }
            } catch (error) {
                log(`Error fetching issues for sprint ${sprint.id}: ${error.message}`, errorLogStream);
                break; // Exit the loop if there's an error, but continue with other sprints
            }
        } while (startAt < total);

        log(`Retrieved a total of ${sprintIssues[sprint.id].length} issues for sprint ${sprint.id}`, accessLogStream);
    }

    return sprintIssues;
}

app.get('/api/cache/stats', (req, res) => {
    const stats = getCacheStats();
    res.json(stats);
});

app.get('/api/projects', async (req, res) => {
    try {
        const projects = await getCachedProjects(() => {
            const projects = Object.keys(config.projects).sort();
            log(`Retrieved ${projects.length} projects`, performanceLogStream);
            return projects;
        });
        res.json(projects);
    } catch (error) {
        log(`Error retrieving projects: ${error.message}`, errorLogStream);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/pull-requests/:project', async (req, res) => {
    const startTime = Date.now();
    const projectName = req.params.project;

    try {
        const projectData = await getCachedProjectData(projectName, async () => {
            // Existing data fetching logic remains the same
            const projectConfig = config.projects[projectName];
            if (!projectConfig) {
                throw new Error('Project not found');
            }

            log(`Processing pull requests for project: ${projectName}`, accessLogStream);

            let allPullRequests = [];
            let pullRequestsByDestination = new Map();

            for (const repoName of projectConfig.repositories) {
                const baseUrl = `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${repoName}/pullrequests?fields=%2Bvalues.*,%2Bvalues.properties*,%2Bvalues.rendered.*,-values.description,-values.summary&pagelen=50`;
                let pullRequests = [];
                await fetchPullRequests(baseUrl, pullRequests);
                allPullRequests.push(...pullRequests);
                log(`Retrieved ${pullRequests.length} pull requests for repository: ${repoName}`, accessLogStream);
            }

            fillPullRequestsMap(allPullRequests, pullRequestsByDestination);
            const jiraIssuesMap = createJiraIssuesMap(allPullRequests, projectConfig.jiraRegex);
            const allJiraIssues = Array.from(jiraIssuesMap.values()).flat();
            log(`Total JIRA issues found: ${allJiraIssues.length}`, accessLogStream);

            const jiraIssuesDetails = await fetchJiraIssuesDetails(allJiraIssues, projectConfig.jiraProjects);

            // Fetch sprints
            const sprints = await fetchJiraSprints(projectConfig.jiraProjects);
            log(`Retrieved ${sprints.length} sprints for project: ${projectName}`, accessLogStream);

            // Fetch sprint issues
            const sprintIssues = await fetchSprintIssues(sprints, projectConfig.jiraProjects);
            log(`Retrieved issues for ${Object.keys(sprintIssues).length} sprints`, accessLogStream);

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
                    jiraSiteName: config.jira.siteName,
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
        });

        res.json(projectData);

        const duration = Date.now() - startTime;
        log(`Completed processing for project ${projectName} - Duration: ${duration}ms`, performanceLogStream);
    } catch (error) {
        log(`Error processing pull requests: ${error.message}`, errorLogStream);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/pull-request-conflicts/:repoName/:spec', async (req, res) => {
    const { repoName, spec } = req.params;

    try {
        const conflictsData = await getCachedConflicts(repoName, spec, () => {
            return conflictsLimiter(() => computeConflicts(repoName, spec));
        });

        res.json(conflictsData);
    } catch (error) {
        log(`Error fetching conflicts for commits ${spec}: ${error.message}`, errorLogStream);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

async function fetchBitbucketJson(url) {
    const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(30000),
        headers: {
            'Authorization': `Basic ${bbAuth}`,
            'Accept': 'application/json'
        }
    });
    if (!response.ok) {
        await response.arrayBuffer().catch(() => {}); // release the socket
        throw new Error(`Request failed with status code ${response.status}`);
    }
    return response.json();
}

// Serializes conflict computations: a page load requests conflicts for every PR
// at once, and each computation makes many Bitbucket calls of its own.
function createLimiter(maxConcurrent) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= maxConcurrent || queue.length === 0) return;
        active++;
        const { task, resolve, reject } = queue.shift();
        task().then(resolve, reject).finally(() => { active--; next(); });
    };
    return task => new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        next();
    });
}
const conflictsLimiter = createLimiter(4);

// Returns a Map of touched file path -> {status, sidePath} for one side of a merge.
// Bitbucket's diffstat/{a}..{b} is a topic (three-dot) diff: changes on side `a` since merge-base(a, b).
// Renamed files are keyed by their old path (so both sides match) but read from their new path.
async function fetchDiffstatFiles(repoName, sideCommit, otherCommit) {
    const files = new Map();
    let url = `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${repoName}/diffstat/${sideCommit}..${otherCommit}?pagelen=500`;
    while (url) {
        const page = await fetchBitbucketJson(url);
        for (const entry of page.values || []) {
            const oldPath = entry.old && entry.old.path;
            const newPath = entry.new && entry.new.path;
            files.set(oldPath || newPath, { status: entry.status, sidePath: newPath || oldPath });
        }
        url = page.next || null;
    }
    return files;
}

// Returns the file content at a commit, null if the file does not exist there.
async function fetchFileAtCommit(repoName, commit, filePath) {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${repoName}/src/${commit}/${encodedPath}`;
    const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(30000),
        headers: { 'Authorization': `Basic ${bbAuth}` }
    });
    if (response.status === 404) {
        await response.arrayBuffer().catch(() => {}); // release the socket
        return null;
    }
    if (!response.ok) {
        await response.arrayBuffer().catch(() => {}); // release the socket
        throw new Error(`Request failed with status code ${response.status}`);
    }
    return response.text();
}

// Bitbucket removed merge-preview diffs from its API and the replacement
// /pullrequests/{id}/conflicts endpoint rejects API-token auth, so we compute
// conflicts ourselves: intersect the files touched on each side since the merge
// base, then 3-way merge each overlapping file with diff3.
const maxConflictCandidates = 50;

async function computeConflicts(repoName, spec) {
    const startTime = Date.now();
    const [destCommit, sourceCommit] = spec.split('..');

    const sourceFiles = await fetchDiffstatFiles(repoName, sourceCommit, destCommit);
    if (sourceFiles.size === 0) return { conflicts: false };
    const destFiles = await fetchDiffstatFiles(repoName, destCommit, sourceCommit);
    if (destFiles.size === 0) return { conflicts: false };

    const overlap = [...sourceFiles.keys()].filter(p => destFiles.has(p));
    if (overlap.length === 0) return { conflicts: false };
    if (overlap.length > maxConflictCandidates) {
        log(`Conflict check for ${repoName} ${spec}: ${overlap.length} overlapping files, only checking the first ${maxConflictCandidates}`, errorLogStream);
    }

    const mergeBase = (await fetchBitbucketJson(
        `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${repoName}/merge-base/${sourceCommit}..${destCommit}`
    )).hash;

    let conflicts = false;
    for (const filePath of overlap.slice(0, maxConflictCandidates)) {
        const sourceEntry = sourceFiles.get(filePath);
        const destEntry = destFiles.get(filePath);
        const sourceRemoved = sourceEntry.status === 'removed';
        const destRemoved = destEntry.status === 'removed';

        if (sourceRemoved && destRemoved) continue;
        if (sourceRemoved !== destRemoved) { // modify/delete
            conflicts = true;
            break;
        }

        const [baseContent, sourceContent, destContent] = await Promise.all([
            fetchFileAtCommit(repoName, mergeBase, filePath),
            fetchFileAtCommit(repoName, sourceCommit, sourceEntry.sidePath),
            fetchFileAtCommit(repoName, destCommit, destEntry.sidePath)
        ]);

        if (sourceContent === destContent) continue; // both sides made the same change
        if (baseContent === null) { // add/add with different content
            conflicts = true;
            break;
        }
        const isBinary = [baseContent, sourceContent, destContent].some(c => c !== null && c.includes('\0'));
        if (isBinary || sourceContent === null || destContent === null) {
            conflicts = true;
            break;
        }

        const merged = diff3Merge(sourceContent.split('\n'), baseContent.split('\n'), destContent.split('\n'));
        if (merged.some(region => region.conflict)) {
            conflicts = true;
            break;
        }
    }

    const duration = Date.now() - startTime;
    log(`computeConflicts - ${repoName} ${spec} - ${overlap.length} overlapping files - conflicts: ${conflicts} - Duration: ${duration}ms`, performanceLogStream);
    return { conflicts };
}

app.listen(port, () => {
    log(`Server is running at http://localhost:${port}`, accessLogStream);
});