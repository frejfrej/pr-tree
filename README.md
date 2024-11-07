# Bitbucket Pull-Requests tree

## Features
* Lists all projects from the configuration file in a dropdown selector
* Upon selecting a project, lists all corresponding pull requests
* Displays a link to related issues
* Displays the status of the pull requests alongside the status of related issues
* Provides initial warnings
    * If the pull request was approved by everyone
    * If the pull request is open but related issues are closed or in review
* Provides an author filter
    * Filters pull requests of selected author
    * Highlights in red those where an effort is expected
* Provides a reviewer filter
    * Filters pull requests of selected reviewer
    * Highlights in red those where an effort is expected
* Allows simultaneous filtering by both author and reviewer
* Maintains filter selections in URL
    * All filter selections (project, sprint, author, reviewer) are saved in the URL
    * Filters are automatically restored when sharing or reloading the page
    * Enables direct linking to specific filtered views
* Smart reload: Automatically updates the page when new data is available without full page refresh
    * Repaint is only done if there are changes in the data returned by the server
    * Performed every minute
* Display SYNC in a badge onto each pull-requests that requires syncing with its parent branch
* Online help displays the README.md file
* Hovering the title of the pull-request or the Jira issue displays a popover previewing their title and description.

## Installation
* Clone this repository
* Copy config.js.default to config.js
* Fill in the required configuration values in config.js
* Update projects.js to include your own projects if needed, and remove those you might not need
* Open a terminal (we are assuming here you have `nodejs` and `npm` installed)
* Run `npm ci`
* Run `node index.mjs`
* Go to http://localhost:3000

## Changelog:
* Version 1.6.3
    * Added support for filtered counters vs overall counters
* Version 1.6.2
    * Enhanced URL persistence for all filters
        * All filter selections (project, sprint, author, reviewer) are now saved in the URL
        * Filters are automatically restored when sharing or reloading the page
        * Direct linking to specific filtered views is now supported
* Version 1.6.1
    * Better sprint filtering
* Version 1.6
    * Add online help based which displays the README.md file
    * Allow filtering by both author and reviewer
    * Add a pull-request counter on branch and repository headers
    * Add popover previews on the title of the pull-requests and Jira issues
    * Add sprint filter feature
        * Fetches all sprints from all boards of associated Jira projects
        * Retrieves issues associated with each sprint
        * Allows filtering pull requests by associated sprint, based on related Jira issues
* Version 1.5
    * Conflicts counter are now displayed with an initial implementation displaying the number of conflicts in a badge
* Version 1.4
    * Enhanced filtering behavior:
        * Pull requests with no children are hidden if they don't match the filter
        * Pull requests with only hidden children are hidden if they don't match the filter
        * Root pull requests follow the same filtering rules as other pull requests
* Version 1.3
    * Added Smart reload feature
        * Automatically checks for updates every minute and refreshes data if changes are detected
* Version 1.2
    * Split project configuration into a separate file (projects.js)
* Version 1.1
    * Introduces Projects
* Version 1.0
    * Lists all pull requests
    * Lists all related issues
    * Displays the status of the pull requests alongside the status of related issues
    * Provides initial warnings
        * if the pull request was approved by all reviewers
        * if the pull request is open but related issues are closed or in review
        * if the pull request has no reviewers
    * Provides an author filter
        * filters pull requests of selected author
        * highlights in red those where an effort is expected
    * Provides a reviewer filter
        * filters pull requests of selected reviewer
        * highlights in red those where an effort is expected