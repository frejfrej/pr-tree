import express from 'express';
import fetch from 'node-fetch';
import config from './config.js';

const app = express();
const port = 3000;

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
    let icon = "";
    if (status === "approved") {
        icon = "circle-check green";
    } else if (status === "requestedChanges") {
        icon = "ban red";
    } else if (status === "toReview") {
        icon = "microscope blue";
    } else if (status === "author") {
        icon = "screwdriver-wrench";
    } else {
        console.log (`${participant.display_name} participant's status is invalid: ${status}`);
    }

    return `<span class="image-container" data-author="${participant.display_name}" data-reviewStatus="${status}">
                <img src="${participant.links.avatar.href}" alt="${participant.display_name}">
                <i class="fas fa-${icon} icon"></i>
            </span>`;
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
    let html = '';
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

    let allOtherParticipantsApprovedIcon = "";
    if (hasOtherParticipants && allOtherParticipantsApproved) {
        allOtherParticipantsApprovedIcon = `<i class="fas fa-check-circle green" title="All other participants approved"></i>`;
    }

    let noOtherParticipantsAlert = "";
    if (!hasOtherParticipants) {
        noOtherParticipantsAlert = `<li><i class="fas fa-exclamation-triangle red" title="Pull request has no other participants"></i> Pull request has no other participants</li>`;
    }

    const jiraIssues = jiraIssuesMap.get(pullRequest.id);
    const jiraIssuesDetailsForPullRequest = jiraIssues.map(issue => jiraIssuesDetails.find(details => details.key === issue)).filter(issueDetails => issueDetails);
    const jiraIssuesStatuses = jiraIssuesDetailsForPullRequest.map(issueDetails => issueDetails.fields.status.name);
    let statusClass = "";
    if (jiraIssuesStatuses.includes("In Progress")) {
        statusClass = "in-progress";
    } else if (jiraIssuesStatuses.includes("In Review")) {
        statusClass = "in-review";
    }
    const uniqueJiraIssuesStatuses = new Set(jiraIssuesStatuses);
    let sameStatusIcon = "";
    if (uniqueJiraIssuesStatuses.size > 1) {
        sameStatusIcon = `<li><i class="fas fa-exclamation-triangle red" title="JIRA issues have different statuses"></i> JIRA issues have different statuses</li>`;
    }

    let resolvedIssuesAlert = "";
    const jiraIssuesHtml = jiraIssuesDetailsForPullRequest.map(issueDetails => {
        if (issueDetails.fields.status.name === "Resolved" || issueDetails.fields.status.name === "Closed") {
            resolvedIssuesAlert += `<li><i class="fas fa-exclamation-triangle red" title="JIRA issue is resolved"></i> JIRA issue ${issueDetails.key} is resolved</li>`;
        }
        return `<li><a href="https://${config.jira.siteName}.atlassian.net/browse/${issueDetails.key}" target="_blank" title="${issueDetails.fields.summary}">${issueDetails.key} (${issueDetails.fields.status.name})</a></li>`;
    }).join('');

    let alertsHtml = "";
    if (sameStatusIcon || noOtherParticipantsAlert || resolvedIssuesAlert) {
        alertsHtml += `<li>Warnings:<ol>${sameStatusIcon}${noOtherParticipantsAlert}${resolvedIssuesAlert}</ol></li>`;
    }

    html += `
        <div class="pull-request ${statusClass}" style="margin-left: ${level * 20}px;">
            <p>
                <a href="${pullRequest.links.html.href}" target="_blank">${pullRequest.title}</a>&nbsp;&nbsp;&nbsp;
                <span>${renderParticipant(pullRequest.author, "author")} on ${pullRequest.created_on.substring(0,10)}
                ${approvedDetails} ${requestedChangesDetails} ${notYetDecidedDetails} ${allOtherParticipantsApprovedIcon}</span>
            </p>
            <ul>
                ${jiraIssuesHtml}
                ${alertsHtml}
            </ul>
        </div>
    `;

    const sourceBranch = pullRequest.source.branch.name;
    if (pullRequestsByDestination.has(sourceBranch)) {
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
                <title>Bitbucket Pull Requests</title>
                <style>
                    .pull-request {
                        margin-bottom: 5px;
                        padding-left: 5px;
                    }
                    .pull-request .children {
                        padding-left: 10px;
                    }

                    .image-container {
                        position: relative;
                        display: inline-block;
                    }

                    .image-container img {
                        display: block;
                        height: 22px;
                        width: 22px;
                    }

                    .image-container .icon {
                        position: absolute;
                        top: -3px;
                        right: -5px;
                        font-size: 12px;
                        font-weight: bolder;
                    }

                    .red {
                        color: red;
                    }

                    .green {
                        color: green;
                    }

                    .blue {
                        color: dodgerblue;
                    }
                </style>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css">
                <script>
                    let previousAuthor = "Show all";
                    let previousReviewer = "Show all";
                    function filterPullRequests() {
                        let author = document.getElementById("authorSelect").value;
                        let reviewer = document.getElementById("reviewerSelect").value;
                        let pullRequests = document.getElementsByClassName("pull-request");
                
                        // ensure only one of the dropdown is selected
                        // and resets the on which was not changed
                        if (reviewer !== previousReviewer) {
                            document.getElementById("authorSelect").value = "Show all";
                            previousReviewer = reviewer;
                            author = "Show all";
                        } else if (author !== previousAuthor) {
                            document.getElementById("reviewerSelect").value = "Show all";
                            previousAuthor = author;
                            reviewer = "Show all";
                        }
                        
                        
                        for (let i = 0; i < pullRequests.length; i++) {
                            let title = pullRequests[i].getElementsByTagName("a")[0];
                            let authorImg = pullRequests[i].getElementsByTagName("img")[0];
                            let reviewerApproved = false;
                            let reviewerFound = false;
                            if (reviewer !== "Show all") {
                                let participants = pullRequests[i].getElementsByClassName("image-container") || [];
                                // starting at 1 since first img is the author
                                for (let j = 1; j < participants.length; j++) {
                                    if (participants[j].dataset["author"] === reviewer) {
                                        reviewerFound = true;
                                        if (participants[j].dataset["reviewStatus"] === "approved") {
                                            reviewerApproved = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            if (author  === "Show all" && reviewer === "Show all" ) {
                                pullRequests[i].style.display = "";
                                title.style.color = "black";
                            } else if (authorImg.alt === author) {
                                pullRequests[i].style.display = "";
                                if (authorImg.alt === author && pullRequests[i].classList.contains("in-progress")) {
                                    title.style.color = "red";
                                } else {
                                    title.style.color = "black";
                                }
                            } else if (reviewerFound) {
                                pullRequests[i].style.display = "";
                                if (!reviewerApproved && !pullRequests[i].classList.contains("in-progress")) {
                                    title.style.color = "red";
                                } else {
                                    title.style.color = "black";
                                }
                            } else {
                                pullRequests[i].style.display = "none";
                            }
                        }
                    }
                </script>
            </head>
            <body>
            <h1>Bitbucket Pull Requests</h1>
            Author: <select id="authorSelect" onchange="filterPullRequests()">
                ${authorOptions}
            </select>
            Work for reviewer: <select id="reviewerSelect" onchange="filterPullRequests()">
                ${reviewerOptions}
            </select>
            <div id="pull-requests">${renderPullRequests(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination)}</div>
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
