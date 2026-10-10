import crypto from 'crypto';

/**
 * The pure part of a project's data: what the server (project-data.mjs)
 * computes once the Atlassian responses are in, and what the fixture
 * generator (fixtures/generate.mjs) computes on the data it makes up, so the
 * two responses have one shape and one hash. Nothing here fetches anything.
 */

/** The issue keys of the project regex found in a title, in order, repeats included */
export function extractJiraIssues(title, jiraRegex) {
    return title.match(jiraRegex) || [];
}

/**
 * The issue keys of every pull request, by pull request id.
 * @returns {Map<number, string[]>}
 */
export function createJiraIssuesMap(pullRequests, jiraRegex) {
    const jiraIssuesMap = new Map();
    for (const pullRequest of pullRequests) {
        jiraIssuesMap.set(pullRequest.id, extractJiraIssues(pullRequest.title, jiraRegex));
    }
    return jiraIssuesMap;
}

/** The parent keys the issues name that are in none of them, in first-seen order, once each: what has to be fetched */
export function missingParentKeys(issues) {
    const known = new Set(issues.map(issue => issue.key));
    const missing = [];
    for (const issue of issues) {
        const parentKey = issue.fields.parent && issue.fields.parent.key;
        if (parentKey && !known.has(parentKey) && !missing.includes(parentKey)) missing.push(parentKey);
    }
    return missing;
}

/**
 * Lets an issue without fix versions take its parent's, in place, in array
 * order (a version travels epic -> story -> sub-task when the story comes
 * before the sub-task); the parent is looked up among the issues given.
 */
export function inheritFixVersions(issues) {
    const byKey = new Map(issues.map(issue => [issue.key, issue]));
    for (const issue of issues) {
        if (issue.fields.parent && (!issue.fields.fixVersions || issue.fields.fixVersions.length === 0)) {
            const parent = byKey.get(issue.fields.parent.key);
            if (parent && parent.fields.fixVersions && parent.fields.fixVersions.length > 0) {
                issue.fields.fixVersions = parent.fields.fixVersions;
            }
        }
    }
}

/** The MD5 of what the frontend compares to know whether anything changed */
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
 * The response of /api/pull-requests/:project without its lastRefreshTime:
 * the fix versions inherited over the linked issues, the orphaned issues then
 * the parents (in place), the parents appended to the details, the hash.
 * The parts are returned as given, not copied: the caller owns them.
 * @param {object} parts
 * @param {object[]} parts.pullRequests
 * @param {Map<number, string[]>} parts.jiraIssuesMap - by pull request id (createJiraIssuesMap)
 * @param {object[]} parts.jiraIssuesDetails - the linked issues
 * @param {object[]} [parts.parents] - the parents fetched for them and for the orphaned issues
 * @param {object[]} [parts.orphanedIssues]
 * @param {{ id: number, name: string }[]} [parts.sprints]
 * @param {Record<string, string[]>} [parts.sprintIssues]
 * @param {string} parts.jiraSiteName
 */
export function assembleProjectData({ pullRequests, jiraIssuesMap, jiraIssuesDetails, parents = [], orphanedIssues = [], sprints = [], sprintIssues = {}, jiraSiteName }) {
    inheritFixVersions([...jiraIssuesDetails, ...orphanedIssues, ...parents]);
    const data = {
        pullRequests,
        jiraIssuesMap: Object.fromEntries(jiraIssuesMap),
        jiraIssuesDetails: [...jiraIssuesDetails, ...parents],
        jiraSiteName,
        sprints,
        sprintIssues,
        orphanedIssues
    };
    return { ...data, dataHash: calculateHash(data) };
}
