import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';  // For environment variables
import config from './config.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();  // Load environment variables from .env

const app = express();
const port = process.env.PORT || 3000;  // Dynamic port for flexibility

// Serve static files from the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static('public'));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// URL of the Bitbucket REST API to retrieve pull requests
const baseUrl = `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${config.bitbucket.repoName}/pullrequests?fields=%2Bvalues.*,%2Bvalues.properties*,%2Bvalues.rendered.*,-values.description,-values.summary&pagelen=50`;
// Encode the credentials in base64
const auth = Buffer.from(`${config.bitbucket.username}:${config.bitbucket.password}`).toString('base64');

// Function to retrieve all pages of pull requests
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

// Function to extract JIRA issues from a pull request title
function extractJiraIssues(title) {
    return title.match(config.jira.issuesRegex) || [];
}

// Function to create a map between pull requests and their corresponding JIRA issues
function createJiraIssuesMap(pullRequests) {
    const jiraIssuesMap = new Map();
    pullRequests.forEach(pullRequest => {
        const jiraIssues = extractJiraIssues(pullRequest.title);
        jiraIssuesMap.set(pullRequest.id, jiraIssues);
    });
    return jiraIssuesMap;
}

// Function to fetch details of all JIRA issues in batches of 50
async function fetchJiraIssuesDetails(jiraIssues) {
    const jiraBaseUrl = `https://${config.jira.siteName}.atlassian.net/rest/api/2/search`;
    const jiraAuth = Buffer.from(`${config.jira.username}:${config.jira.apiKey}`).toString('base64');

    const jiraIssuesDetails = [];
    for (let i = 0; i < jiraIssues.length; i += 50) {
        const jiraIssuesBatch = jiraIssues.slice(i, i + 50);
        const jql = `issueKey in (${jiraIssuesBatch.join(',')})`;
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
            throw new Error(`Request failed with status code ${response.status}`);
        }
    }

    return jiraIssuesDetails;
}

// Function to fill the pull requests map
function fillPullRequestsMap(pullRequests, pullRequestsByDestination) {
    pullRequests.forEach(pullRequest => {
        const destinationBranch = pullRequest.destination.branch.name;
        if (!pullRequestsByDestination.has(destinationBranch)) {
            pullRequestsByDestination.set(destinationBranch, []);
        }
        pullRequestsByDestination.get(destinationBranch).push(pullRequest);
    });
}

app.get('/api/pull-requests', async (req, res) => {
    try {
        // Declare the pullRequests array inside the route handler function
        let pullRequests = [];
        let pullRequestsByDestination = new Map();
        await fetchPullRequests(baseUrl, pullRequests);
        fillPullRequestsMap(pullRequests, pullRequestsByDestination);
        const jiraIssuesMap = createJiraIssuesMap(pullRequests);
        const allJiraIssues = Array.from(jiraIssuesMap.values()).flat();
        const jiraIssuesDetails = await fetchJiraIssuesDetails(allJiraIssues);

        res.send({
            pullRequests: pullRequests,
            jiraIssuesMap: Object.fromEntries(jiraIssuesMap.entries()),
            jiraIssuesDetails: jiraIssuesDetails,
            pullRequestsByDestination: Object.fromEntries(pullRequestsByDestination.entries()),
            jiraSiteName: config.jira.siteName,
        });
    } catch (error) {
        console.error(`Error executing the request: ${error.message}`);
        res.status(500).send('Internal Server Error');
    }

})

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
