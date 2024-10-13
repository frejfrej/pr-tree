import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import config from './config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json to get the version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const version = packageJson.version;
const releaseDate = packageJson.releaseDate || new Date().toISOString().split('T')[0]; // Use current date if not specified
const author = packageJson.author;
const license = packageJson.license;

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

async function fetchPullRequests(url, pullRequests) {
    const auth = Buffer.from(`${config.bitbucket.username}:${config.bitbucket.password}`).toString('base64');
    const startTime = Date.now();
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
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
    const jiraBaseUrl = `https://${config.jira.siteName}.atlassian.net/rest/api/2/search`;
    const jiraAuth = Buffer.from(`${config.jira.username}:${config.jira.apiKey}`).toString('base64');

    let pageSize = 50;
    const jiraIssuesDetails = [];
    for (let i = 0; i < jiraIssues.length; i += pageSize) {
        const startTime = Date.now();
        const jiraIssuesBatch = jiraIssues.slice(i, i + pageSize);
        const jql = `issueKey in (${jiraIssuesBatch.join(',')}) AND project in (${jiraProjects.join(',')})`;
        const url = `${jiraBaseUrl}?jql=${encodeURIComponent(jql)}&fields=key,summary,status`;

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
        jiraIssuesDetails: data.jiraIssuesDetails
    }));
    return hash.digest('hex');
}

app.get('/api/projects', (req, res) => {
    const projects = Object.keys(config.projects).sort();
    log(`Retrieved ${projects.length} projects`, accessLogStream);
    res.json(projects);
});

app.get('/api/pull-requests/:project', async (req, res) => {
    const startTime = Date.now();
    try {
        const projectName = req.params.project;
        const projectConfig = config.projects[projectName];

        if (!projectConfig) {
            log(`Project not found: ${projectName}`, errorLogStream);
            return res.status(404).send('Project not found');
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

        const response = {
            pullRequests: allPullRequests,
            jiraIssuesMap: Object.fromEntries(jiraIssuesMap.entries()),
            jiraIssuesDetails: jiraIssuesDetails,
            pullRequestsByDestination: Object.fromEntries(pullRequestsByDestination.entries()),
            jiraSiteName: config.jira.siteName,
            dataHash: calculateHash({ pullRequests: allPullRequests, jiraIssuesMap, jiraIssuesDetails })
        };

        res.json(response);

        const duration = Date.now() - startTime;
        log(`Completed processing for project ${projectName} - Duration: ${duration}ms`, performanceLogStream);
        log(`Response hash: ${response.dataHash}`, performanceLogStream);
    } catch (error) {
        log(`Error processing pull requests: ${error.message}`, errorLogStream);
        res.status(500).send('Internal Server Error');
    }
});


// Add this new endpoint
app.get('/api/pull-request-conflicts/:repoName/:spec', async (req, res) => {
    const { repoName, spec } = req.params;
    const url = `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${repoName}/diff/${spec}`;
    const auth = Buffer.from(`${config.bitbucket.username}:${config.bitbucket.password}`).toString('base64');

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json',
            }
        });

        if (response.ok) {
            const data = await response.text();
            const conflictsCount = countOccurrences(data, '+<<<<<<< destination:');
            res.json({ conflicts: conflictsCount > 0 });
        } else {
            throw new Error(`Request failed with status code ${response.status}`);
        }
    } catch (error) {
        log(`Error fetching conflicts for commits ${spec}: ${error.message}`, errorLogStream);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

function countOccurrences(str, searchString) {
    let count = 0;
    let index = 0;
    while ((index = str.indexOf(searchString, index)) !== -1) {
        if (index === 0 || str[index - 1] === '\n') {
            count++;
        }
        index += searchString.length;
    }
    return count;
}

app.listen(port, () => {
    log(`Server is running at http://localhost:${port}`, accessLogStream);
});