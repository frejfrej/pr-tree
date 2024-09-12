# Bitbucket Pull-Requests tree

Current version: 1.0

## Features
* Lists all pull requests
* Lists all related issues
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


## Installation
* Clone this repository
* Open copy config.default.js to config.js
* Fill in the required configuration values in config.js
* Open a terminal (we are assuming here you have `nodejs` and `npm` installed)
* Run `npm ci`
* Run `node index.mjs`
* Go to http://localhost:3000

## Changelog:
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

