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
app.use(express.static(__dirname));

// URL of the Bitbucket REST API to retrieve pull requests
const baseUrl = `https://api.bitbucket.org/2.0/repositories/${config.bitbucket.workspace}/${config.bitbucket.repoName}/pullrequests?fields=%2Bvalues.participants,-values.description,-values.summary`;
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

// Function to render participant information
function renderParticipant(participant, status) {
    let iconClass = "";
    if (status === "approved") {
        iconClass = "fa-check-circle";
    } else if (status === "requestedChanges") {
        iconClass = "fa-times-circle";
    } else if (status === "toReview") {
        iconClass = "fa-question-circle";
    } else if (status === "author") {
        iconClass = "fa-user";
    } else {
        console.log(`${participant.display_name} participant's status is invalid: ${status}`);
    }

    return `
        <span class="image-container" data-author="${participant.display_name}" data-review-status="${status}">
            <img src="${participant.links.avatar.href}" alt="${participant.display_name}">
            <i class="fas ${iconClass} icon"></i>
        </span>
    `;
}

function findRootBranches(pullRequests) {
    const destinationBranches = new Set(pullRequests.map(pullRequest => pullRequest.destination.branch.name));
    const sourceBranches = new Set(pullRequests.map(pullRequest => pullRequest.source.branch.name));
    return Array.from(destinationBranches).filter(branch => !sourceBranches.has(branch));
}

// Function to recursively render the pull-requests
function renderPullRequests(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, level = 0) {
    let html = '';
    if (level === 0) {
        const destinationBranches = findRootBranches(pullRequests);

        for(const destinationBranch of destinationBranches) {
            const rootPullRequests = pullRequests.filter(pullRequest => destinationBranch === pullRequest.destination.branch.name);
            html += `<h2>${destinationBranch}</h2>`;
            rootPullRequests.forEach(rootPullRequest => {
                html += renderPullRequest(rootPullRequest, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, 1);
            });
        }
    } else {
        pullRequests.forEach(pullRequest => {
            html += renderPullRequest(pullRequest, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, level+1);
        });
    }
    return html;
}

// Function to recursively render a pull-request
function renderPullRequest(pullRequest, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, level = 0) {
    let approvedDetails = "";
    let requestedChangesDetails = "";
    let notYetDecidedDetails = "";
    let hasOtherParticipants = false;
    let allOtherParticipantsApproved = true;

    for (const participant of pullRequest.participants) {
        if (participant.user.account_id !== pullRequest.author.account_id) {
            hasOtherParticipants = true;
            if (participant.approved) {
                approvedDetails += renderParticipant(participant.user, "approved");
            } else if (participant.state === "changes_requested") {
                requestedChangesDetails += renderParticipant(participant.user, "requestedChanges");
                allOtherParticipantsApproved = false;
            } else {
                notYetDecidedDetails += renderParticipant(participant.user, "toReview");
                allOtherParticipantsApproved = false;
            }
        }
    }

    let allOtherParticipantsApprovedIcon = hasOtherParticipants && allOtherParticipantsApproved ?
        `<div class="all-approved-icon"><i class="fas fa-check-circle" title="All other participants approved"></i></div>` : '';

    let noOtherParticipantsAlert = !hasOtherParticipants ?
        `<li><i class="fas fa-exclamation-triangle red" title="Pull request has no other participants"></i> Pull request has no other participants</li>` : '';

    const jiraIssues = jiraIssuesMap.get(pullRequest.id);
    const jiraIssuesDetailsForPullRequest = jiraIssues.map(issue => jiraIssuesDetails.find(details => details.key === issue)).filter(issueDetails => issueDetails);
    const jiraIssuesStatuses = jiraIssuesDetailsForPullRequest.map(issueDetails => issueDetails.fields.status.name);

    let statusClass = "";
    if (jiraIssuesStatuses.includes("In Progress")) {
        statusClass = "status-in-progress";
    } else if (jiraIssuesStatuses.includes("In Review")) {
        statusClass = "status-in-review";
    }

    const uniqueJiraIssuesStatuses = new Set(jiraIssuesStatuses);
    let sameStatusIcon = uniqueJiraIssuesStatuses.size > 1 ?
        `<li><i class="fas fa-exclamation-triangle red" title="JIRA issues have different statuses"></i> JIRA issues have different statuses</li>` : '';

    let resolvedIssuesAlert = '';
    const jiraIssuesHtml = jiraIssuesDetailsForPullRequest.map(issueDetails => {
        if (issueDetails.fields.status.name === "Resolved" || issueDetails.fields.status.name === "Closed") {
            resolvedIssuesAlert += `<li><i class="fas fa-exclamation-triangle red" title="JIRA issue is resolved"></i> JIRA issue ${issueDetails.key} is resolved</li>`;
        }
        return `<li><a href="https://${config.jira.siteName}.atlassian.net/browse/${issueDetails.key}" target="_blank" title="${issueDetails.fields.summary}">${issueDetails.key} (${issueDetails.fields.status.name})</a></li>`;
    }).join('');

    let alertsHtml = "";
    if (sameStatusIcon || noOtherParticipantsAlert || resolvedIssuesAlert) {
        alertsHtml = `
            <div class="warnings">
                <ul>
                    ${sameStatusIcon}
                    ${noOtherParticipantsAlert}
                    ${resolvedIssuesAlert}
                </ul>
            </div>
        `;
    }

    const sourceBranch = pullRequest.source.branch.name;
    const hasChildren = pullRequestsByDestination.has(sourceBranch);

    const toggleButton = hasChildren ? `
        <button class="toggle-button" onclick="toggleChildren(this)">
            <i class="fas fa-chevron-down"></i>
            <i class="fas fa-chevron-right"></i>
        </button>
    ` : '';

    let html = `
        <div class="pull-request ${statusClass}" style="margin-left: ${level * 10}px;">
            ${allOtherParticipantsApprovedIcon}
            <div class="pull-request-content">
                <div class="pull-request-info">
                    <div class="pull-request-header">
                        ${toggleButton}
                        <a href="${pullRequest.links.html.href}" target="_blank">${pullRequest.title}</a>
                        <span class="status-indicator ${statusClass}"></span>
                    </div>
                    <div class="participants">
                        ${renderParticipant(pullRequest.author, "author")} 
                        <span class="created-date">${pullRequest.created_on.substring(0,10)}</span>
                        ${approvedDetails} ${requestedChangesDetails} ${notYetDecidedDetails}
                    </div>
                    ${alertsHtml}
                </div>
                <div class="pull-request-issues">
                    <ul class="jira-issues">
                        ${jiraIssuesHtml}
                    </ul>
                </div>
            </div>
        </div>
    `;
    
    if (hasChildren) {
        html += `<div class="children">${renderPullRequests(pullRequestsByDestination.get(sourceBranch), jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, level + 1)}</div>`;
    }
    return html;
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

app.get('/', async (req, res) => {
    try {
        // Declare the pullRequests array inside the route handler function
        let pullRequests = [];
        let pullRequestsByDestination = new Map();
        await fetchPullRequests(baseUrl, pullRequests);
        fillPullRequestsMap(pullRequests, pullRequestsByDestination);
        const jiraIssuesMap = createJiraIssuesMap(pullRequests);
        const allJiraIssues = Array.from(jiraIssuesMap.values()).flat();
        const jiraIssuesDetails = await fetchJiraIssuesDetails(allJiraIssues);

        // Extract unique authors
        let authors = [...new Set(pullRequests.map(pr => pr.author.display_name))];
        // Generate the dropdown options
        let authorOptions = `<option value="Show all">Show all</option>${authors.map(author => `<option value="${author}">${author}</option>`).join('')}`;

        // Extract unique reviewers
        let reviewers = [...new Set(pullRequests.flatMap(pr => pr.participants.map(p => p.user.display_name)))];
        // Generate the dropdown options
        let reviewerOptions = `<option value="Show all">Show all</option>${reviewers.map(reviewer => `<option value="${reviewer}">${reviewer}</option>`).join('')}`;

        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bitbucket Pull Requests Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css">
    <style>
        :root {
            --primary-color: #0052CC;
            --secondary-color: #FF5630;
            --background-color: #F4F5F7;
            --text-color: #172B4D;
            --border-color: #DFE1E6;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: var(--text-color);
            background-color: var(--background-color);
            margin: 0;
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }

        h1 {
            color: var(--primary-color);
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 10px;
            margin-bottom: 20px;
        }

        .filters {
            display: flex;
            justify-content: space-between;
            margin-bottom: 20px;
        }

        select {
            padding: 8px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            font-size: 14px;
        }

        .pull-request {
            background-color: white;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            margin-bottom: 10px;
            padding: 15px;
            transition: box-shadow 0.3s ease;
            position: relative; /* Add this to allow absolute positioning of children */
        }

        .all-approved-icon {
            position: absolute;
            top: 50%;
            right: 10px;
            transform: translateY(-50%);
            font-size: 24px;
            color: #36B37E;
            background-color: white;
            border-radius: 50%;
            padding: 2px;
            box-shadow: 0 0 5px rgba(0, 0, 0, 0.1);
        }

        .pull-request:hover {
            box-shadow: 0 0 5px rgba(0, 0, 0, 0.1);
        }

        .pull-request-content {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .pull-request-info {
            flex: 1;
            margin-right: 20px;
        }

        .pull-request-issues {
            flex: 0 0 250px;
        }

        .pull-request a {
            color: var(--primary-color);
            text-decoration: none;
            font-weight: bold;
        }

        .pull-request a:hover {
            text-decoration: underline;
        }

        .image-container {
            display: inline-flex;
            align-items: center;
            margin-right: 5px;
            position: relative;
        }

        .image-container img {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            margin-right: 5px;
        }

        .icon {
            font-size: 12px;
            position: absolute;
            bottom: -2px;
            right: -2px;
            background-color: white;
            border-radius: 50%;
            padding: 2px;
        }

        .icon.fa-check-circle { color: #36B37E; }
        .icon.fa-times-circle { color: #FF5630; }
        .icon.fa-question-circle { color: #0052CC; }
        .icon.fa-user { color: #172B4D; }

        .status-indicator {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 5px;
        }

        .status-in-progress { background-color: #FFD700; }
        .status-in-review { background-color: #36B37E; }
        .status-resolved { background-color: #00B8D9; }

        .warnings {
            background-color: #FFEBE6;
            border: 1px solid #FF8F73;
            border-radius: 4px;
            padding: 10px;
            margin-top: 10px;
        }

        .warnings li {
            margin-bottom: 5px;
        }

        .children {
            margin-left: 10px; /* Reduced from 20px */
            border-left: 2px solid var(--border-color);
            padding-left: 10px; /* Reduced from 15px */
        }

        .jira-issues {
            list-style-type: none;
            padding: 0;
            margin: 0;
        }

        .jira-issues li {
            margin-bottom: 5px;
        }
        
        .pull-request-header {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
        }

        .toggle-button {
            background: none;
            border: none;
            cursor: pointer;
            padding: 0;
            margin-right: 10px;
            font-size: 16px;
            color: var(--text-color);
        }

        .toggle-button:hover {
            color: var(--primary-color);
        }

        .toggle-button .fa-chevron-right {
            display: none;
        }

        .collapsed .toggle-button .fa-chevron-down {
            display: none;
        }

        .collapsed .toggle-button .fa-chevron-right {
            display: inline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Bitbucket Pull Requests Dashboard</h1>
        <div class="filters">
            <div>
                <label for="authorSelect">Author:</label>
                <select id="authorSelect" onchange="filterPullRequests()">
                    ${authorOptions}
                </select>
            </div>
            <div>
                <label for="reviewerSelect">Reviewer:</label>
                <select id="reviewerSelect" onchange="filterPullRequests()">
                    ${reviewerOptions}
                </select>
            </div>
        </div>
        <div id="pull-requests">
            ${renderPullRequests(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination)}
        </div>
    </div>
    <script src="app.js"></script>
</body>
</html>
        `;

        res.send(html);
    } catch (error) {
        console.error(`Error executing the request: ${error.message}`);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
