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

app.use(express.static('public'));

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//const auth = Buffer.from(`${config.bitbucket.username}:${config.bitbucket.password}`).toString('base64');

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
app.get('/api/pull-request-conflicts/:repoName/:prId', async (req, res) => {
    const { workspace, repoName, prId } = req.params;
    const url = `https://bitbucket.org/!api/internal/repositories/${config.bitbucket.workspace}/${repoName}/pullrequests/${prId}/conflicts`;
    const auth = Buffer.from(`${config.bitbucket.username}:${config.bitbucket.password}`).toString('base64');

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json',
                'Cookie': 'cloud.session.token=eyJraWQiOiJzZXNzaW9uLXNlcnZpY2UvcHJvZC0xNTkyODU4Mzk0IiwiYWxnIjoiUlMyNTYifQ.eyJhc3NvY2lhdGlvbnMiOltdLCJzdWIiOiI1NTcwNTg6YmRiMjE1MDktZjNiZS00YmMwLWJkNWMtYjYxZGRkYjIxNzA0IiwiZW1haWxEb21haW4iOiJzb2RpdXN3aWxsZXJ0LmNvbSIsImltcGVyc29uYXRpb24iOltdLCJjcmVhdGVkIjoxNjg4Mzc3MTY1LCJyZWZyZXNoVGltZW91dCI6MTcyNzY3MjIxOCwidmVyaWZpZWQiOnRydWUsImlzcyI6InNlc3Npb24tc2VydmljZSIsInNlc3Npb25JZCI6IjE0OWM2NDZmLWJmMGEtNGJmZS1iNTVkLTkyMWNkNGIxMjMxZSIsInN0ZXBVcHMiOltdLCJhdWQiOiJhdGxhc3NpYW4iLCJuYmYiOjE3Mjc2NzE2MTgsImV4cCI6MTczMDI2MzYxOCwiaWF0IjoxNzI3NjcxNjE4LCJlbWFpbCI6ImZyamF1bmF0cmVAc29kaXVzd2lsbGVydC5jb20iLCJqdGkiOiIxNDljNjQ2Zi1iZjBhLTRiZmUtYjU1ZC05MjFjZDRiMTIzMWUifQ.SxLncqbUhEHn38K-HFA09klF50FoynF741w2KMm_QSmAsMItykbxo--Jfu8Y7Ci_ESrfXxSMj52b1qIscswyF3iUnLMG-WsGDFOYdvyZ9DkZWIifZBJt3rd1R-tRC8LFgaeHgFhQYlqa6_e2waE0PepppYX21txWSm7NnLms5C_foWDmqkmWTIdS-Riohc-aYxaZ-aK6yzPNmuydcN3ipIgRqsBQ7pc2qoWV6S5NaAeYtgTSHRMlK8ZMSQy72PcHvgMdz5kWmk06vJO9daRaEPI3-c9WuQ32E1GyPoIcpzgB3nkcFBWjXU-AjAGxu6e8S3zsTz0L0KKR778A1-aUow; Expires=Wed, 30 Oct 2024 04:46:58 GMT; Max-Age=2592000; Path=/; Secure; HttpOnly; Domain=bitbucket.org',
            }
        });

        if (response.ok) {
            const data = await response.json();
            res.json({ conflictsCount: data.length });
        } else {
            throw new Error(`Request failed with status code ${response.status}`);
        }
    } catch (error) {
        log(`Error fetching conflicts for PR ${prId}: ${error.message}`, errorLogStream);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(port, () => {
    log(`Server is running at http://localhost:${port}`, accessLogStream);
});