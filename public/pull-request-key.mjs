/**
 * The key of a pull request in a project, "repository/id" (#99): Bitbucket
 * numbers the pull requests of each repository from 1, so two repositories
 * of a project have pull requests with the same id. The repository is the
 * destination one, where Bitbucket numbers the pull request (a pull request
 * from a fork included), not the source one the tree groups it under.
 *
 * One definition for the server (project-assembly.mjs keys jiraIssuesMap by
 * it) and the page (the data-id of a row, the filter index): a `.mjs` file,
 * so Node loads it as an ES module whatever the package type. Pure.
 */
export function pullRequestKey(pullRequest) {
    return `${pullRequest.destination?.repository?.name}/${pullRequest.id}`;
}
