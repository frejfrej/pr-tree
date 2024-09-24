import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import config from './config.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const auth = Buffer.from(`${config.bitbucket.username}:${config.bitbucket.password}`).toString('base64');

async function fetchPullRequests(url, pullRequests) {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${auth}`
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

    const jiraIssuesDetails = [];
    for (let i = 0; i < jiraIssues.length; i += 50) {
        const jiraIssuesBatch = jiraIssues.slice(i, i + 50);
        const jql = `issueKey in (${jiraIssuesBatch.join(',')}) AND project in (${jiraProjects.join(',')})`;
        const url = `${jiraBaseUrl}?jql=${encodeURIComponent(jql)}`;

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
            throw new Error(`Request failed with\n status code: ${response.status},\n status text: ${response.statusText},\n body: ${JSON.stringify(data)}`);
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

app.get('/api/projects', (req, res) => {
    const projects = Object.keys(config.projects);
    res.json(projects);
});

app.get('/api/pull-requests/:project', async (req, res) => {
    try {
        const projectName = req.params.project;
        const projectConfig = config.projects[projectName];

        if (!projectConfig) {
            return res.status(404).send('Project not found');
        }

        let allPullRequests = [];
        let pullRequestsByDestination = new Map();

        for (const repoName of projectConfig.repositories) {
            const baseUrl = `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${repoName}/pullrequests?fields=%2Bvalues.*,%2Bvalues.properties*,%2Bvalues.rendered.*,-values.description,-values.summary&pagelen=50`;
            let pullRequests = [];
            await fetchPullRequests(baseUrl, pullRequests);
            allPullRequests.push(...pullRequests);
        }

        fillPullRequestsMap(allPullRequests, pullRequestsByDestination);
        const jiraIssuesMap = createJiraIssuesMap(allPullRequests, projectConfig.jiraRegex);
        const allJiraIssues = Array.from(jiraIssuesMap.values()).flat();
        const jiraIssuesDetails = await fetchJiraIssuesDetails(allJiraIssues, projectConfig.jiraProjects);

        res.json({
            pullRequests: allPullRequests,
            jiraIssuesMap: Object.fromEntries(jiraIssuesMap.entries()),
            jiraIssuesDetails: jiraIssuesDetails,
            pullRequestsByDestination: Object.fromEntries(pullRequestsByDestination.entries()),
            jiraSiteName: config.jira.siteName,
        });
    } catch (error) {
        console.error(`Error executing the request: ${error.message}`);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});