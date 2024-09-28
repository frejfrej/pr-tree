# Bitbucket Pull-Requests tree

Current version: 1.3

## Features
* Lists all projects from the configuration file in a dropdown selector
* Upon selecting a project, lists all corresponding pull requests
* Displays a link to related issues
* Displays the status of the pull requests alongside the status of related issues
* Provides initial warnings
  * if the pull request was approved by everyone
  * if the pull request is open but related issues are closed or in review
* Provides an author filter
  * filters pull requests of selected author
  * highlights in red those where an effort is expected
* Provides a reviewer filter
  * filters pull requests of selected reviewer
  * highlights in red those where an effort is expected
* Smart reload: Automatically updates the page when new data is available without full page refresh

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