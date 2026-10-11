/**
 * The keys that name the repository of an element of the tree: Bitbucket
 * numbers the pull requests of each repository from 1 and repositories share
 * branch names, so an id or a branch name alone is ambiguous in a project
 * (#99, #103). Pure.
 *
 * One definition for the server (project-assembly.mjs keys jiraIssuesMap by
 * the pull-request key) and the page (the data-id of a row, the filter index,
 * the collapse state of a root branch): a `.mjs` file, so Node loads it as an
 * ES module whatever the package type.
 */

/**
 * "repository/id", the repository being the destination one, where Bitbucket
 * numbers the pull request (a pull request from a fork included), not the
 * source one the tree groups it under.
 */
export function pullRequestKey(pullRequest) {
    return `${pullRequest.destination?.repository?.name}/${pullRequest.id}`;
}

/**
 * "repository:branch" for a root branch, the repository being the one the
 * tree groups the branch under (the source repository of its pull requests).
 * Git forbids `:` in a branch name, so the last `:` splits the key whatever
 * the repository name holds.
 */
export function rootBranchKey(repositoryName, branchName) {
    return `${repositoryName}:${branchName}`;
}
