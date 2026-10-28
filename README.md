# Bitbucket Pull-Requests tree

## Features
* Application layout
    * A top banner shows the app name, the project selector, the refresh status, the theme toggle, the help and GitHub links and the version
    * Filters live in a left sidebar that stays in place while the pull-request tree scrolls
    * The sidebar can be hidden with the banner button or the `F` key; the choice is remembered by the browser; `/` or Ctrl+F (Cmd+F on macOS) focuses the search box
    * On windows narrower than 900px the sidebar becomes a drawer over the tree
    * The badge on the sidebar button shows how many filters are active; "Clear filters" resets them all
    * Repository and branch headers stick to the top of the tree while scrolling
    * "Collapse all" and "Expand all" fold or unfold every repository, branch and pull request
    * What is folded is remembered by the browser, per project: a reload, a tab opened again or a switch to another project and back finds the repositories, branches and stacks folded as they were left (not the address: a shared link opens everything unfolded)
    * Every toggle is a button: Tab reaches it, Enter or Space folds or unfolds, and its state is announced
    * One row of the tree is selected, marked by a bar on its left edge: the first pull request when the page opens, then the one chosen with the keys, a click or Tab. The address keeps it (`selected=`), so a reload, a shared link or Back selects it again (and scrolls to it); when that row is gone, or a filter hides it, the first pull request is selected until it comes back
    * Keyboard navigation of the tree: ↓ / `j` and ↑ / `k` select the next and previous row shown (each branch header, the pull requests under it, then the Jira issues without a pull request), skipping what is filtered out or folded; → unfolds the selected branch or pull request's stack, or goes to its first pull request when it is unfolded; ← folds it, or goes to its parent (the branch header for a root pull request) when it is folded or stacks nothing; `o` opens the row in Bitbucket (the branch for a header, an issue in Jira), `i` its first Jira issue, in a new tab; `c` copies the `git switch` command of the selected pull request's branch, `b` the branch name; Enter or Space on the focused row folds or unfolds its stack; `x` goes back to the root pull request of the stack and folds it. The keys do nothing while typing in a box or with a filter list open; Page Up, Page Down and Space scroll the tree, and after a click in the sidebar or the banner the arrows scroll there
    * The tab title shows the selected project and, when participants are selected, the number of pull requests and orphaned issues waiting for them
* Light and dark themes, following the system setting until the theme toggle is used
* Lists all projects from the configuration file in a dropdown selector
* Upon selecting a project, lists all corresponding pull requests ordered by most recently updated
* Displays a link to related issues with the corresponding status
* Displays the status of the pull requests alongside the status of related issues
* Lists the Jira issues in review that no pull request links, in a section below the tree
    * The section follows the sidebar filters like the tree (text, sprint, fix version, epic, story, participants and work; SYNC and Hide drafts do not apply) and is hidden when nothing in it matches
    * Each issue shows its priority, key (with the same popover as in the tree), summary, assignee, last update and Jira approvers (like the reviewers of a pull request: a check for those who approved, a question mark for the others); an issue not updated for 14 days gets a warning
    * Reviews without a pull request (documentation, Xray tests) are kept for their approvers: the participant and work filters treat the approvers of an issue (and whoever approved it) as its reviewers and its assignee as its assignee, like for a pull request. The issue waits for its approvers who have not approved, and for its assignee once nobody is pending (no approver, or all approved): it is then highlighted and counted in the tab title for them. The approvers are read from the two Jira fields named in `config.js` (see Installation)
    * The section collapses like a repository ("Collapse all" and "Expand all" include it)
* Provides initial warnings
    * If the pull request was approved by everyone and has no open task (with open tasks it shows as in progress: the tasks are its assignee's work)
    * If the pull request is open but related issues are closed or in review
* Provides a text filter
    * Keeps the pull requests whose title, source branch name or linked issue keys contain every word typed (case-insensitive)
    * `/` or Ctrl+F (Cmd+F on macOS) focuses the search box, Escape clears it; Ctrl+F pressed again from the box opens the browser's own find
* Provides an epic filter
    * Keeps the pull requests whose linked issues belong to the selected epics; a pull request linked to a sub-task follows the epic of its parent story
* Provides a story filter
    * Keeps the pull requests delivering the selected issues: the linked issue itself, or the parent of a linked sub-task
* Provides a participants filter
    * Lists the assignees of the linked Jira issues and of the orphaned issues, the reviewers of the pull requests and the Jira approvers of the orphaned issues
    * Keeps the pull requests of the selected participants: those they review and those with a linked issue assigned to them
    * Highlights in red the pull requests waiting for them: In Review pull requests they have not approved (a draft waits for no reviewer), In Progress pull requests and In Review pull requests with open tasks, with a linked issue assigned to them
* Provides a work filter next to it: "All work" (every pull request of the participants, the default), "All reviews" (the pull requests they review), "All issues" (the pull requests with a linked issue assigned to them), "Ready for participants" (only those waiting for them, either kind), "Ready for reviewers" or "Ready for assignees"
* "Hide drafts" hides the draft pull requests
* Provides a fix version filter
    * Filters pull requests based on the fixVersion field of associated Jira issues
    * Dynamically populates with all available fixVersions from the project's Jira issues
* Hides the repositories and branches left without a matching pull request; when nothing matches, a message replaces the tree
* Maintains filter selections in URL
    * All filter selections (project, text, sprint, fixVersion, epic, story, participants, work, hide drafts) are saved in the URL
    * Filters are automatically restored when sharing or reloading the page
    * Enables direct linking to specific filtered views
    * Back and Forward put the filters, and the project, back as the URL describes
* Displays Ahead (green) and Behind (red) commit counts
* Marks draft pull requests with a "Draft" badge next to the title, and shows the open tasks of a pull request in an amber badge
* Two buttons at the end of a pull request's reviewers line, after its commit counts and open tasks, copy its source branch name and the command switching to it (`git switch <branch>`); the tooltip shows what is copied, the icon turns into a check once copied. A branch name holding a character the shell would read (`$`, `;`, a quote...) is put in single quotes in the command, so pasting it runs nothing else. `git switch` reads the name as a branch only, never as a file to restore (`git checkout docs`, with a branch `docs` not fetched yet, discards the changes in `docs/`)
* A third icon after them checks the branch out in Sourcetree, with the link of Bitbucket's own "Check out in SourceTree": Sourcetree asks which of your clones to check it out in (or clones it), and what to do with uncommitted changes. The browser asks the first time whether to open Sourcetree
* Smart reload: Automatically updates the page when new data is available without full page refresh
    * Repaint is only done if there are changes in the data returned by the server
    * Performed every 2 minutes
    * Performed when the tab is selected in the browser
    * Refresh date is visible at the top right of the page
    * Displays an icon when it's checking for updates
    * Preserves toggle states across reloads (collapsed/expanded repositories, branches, and pull requests)
    * After the server is upgraded, a tab left open shows "Reload: dashboard updated" in the banner instead of updating: its page may misread the new data. The reload keeps the project and the filters
* Pseudo-cache
    * Bitbucket PR and Jira issues data are retrieved server-side
    * A hash is computed based on that data
    * Ahead and Behind commit counts are only retrieved when the hash is updated to avoid issues with the Bitbucket API
* SYNC badges: once the SYNC status is loaded (the load button next to the SYNC filter, never automatically), each pull request shows a green OK, a red SYNC when it conflicts with its destination branch (the conflicting files in the tooltip) or a grey `?` with the reason when it could not be checked
    * Conflicts are decided from Bitbucket's diffs of both sides since the merge base with git's rule, usually two to four requests per pull request; a result never changes for a pair of commits, so it is kept in `sync-cache.json` next to the server and reused across reloads and restarts
    * A single server request retrieves the status of all pull requests, cached server-side
    * After an Atlassian HTTP 429 response, the server pauses all Atlassian requests and serves cached data until 10 minutes after the last 429
        * The page says so: the banner shows "Paused until HH:MM" next to the refresh time, a project that cannot load meanwhile says until when instead of a generic failure, and the page checks again at the end of the pause
* Hovering the title of the pull-request or the Jira issue displays a popover previewing their title and description.
* Online help displays the README.md file
* Filtering cost does not depend on how deep pull requests are stacked: one pass over the tree, whatever the project size
* Fixture mode: `npm run start:fixtures` serves realistic generated data for the configured projects without any Atlassian credentials or network access

## Installation
* Clone this repository
* Copy config.js.default to config.js
* Fill in the configuration values in config.js: the comments say which Atlassian tokens to create and where
* Optionally, name the Jira custom fields of the approvers of an issue and of those who approved (`approversField` and `approvedByField` in the `jira` block, user pickers, for instance `customfield_11101` and `customfield_11785`): the issues in review without a pull request are then kept for their approvers. The ids are listed by `https://<siteName>.atlassian.net/rest/api/3/field`
* Update projects.js to include your own projects if needed, and remove those you might not need
* Open a terminal (Node.js 20.11 or later and `npm` are assumed to be installed; the server uses the `fetch` built into Node)
* Run `npm ci`
* Run `npm start`
* Go to http://localhost:3000

## Network access
* The dashboard listens on the loopback addresses only (127.0.0.1 and ::1): it is reachable from the machine it runs on, at http://localhost:3000
* To open it from other machines, start it with `PR_TREE_HOST=0.0.0.0 npm start`: it then listens on every interface and answers to the machine's addresses (including those it gets later, on another Wi-Fi or a VPN) and its name (`Mac`, `Mac.local`); `PR_TREE_HOST=192.168.1.20` listens on that address only; anyone who can reach the port can read the pull requests and Jira issues it shows, and start SYNC loads on your Bitbucket token
* It answers only to the names it knows: a request for another name gets a 403 (this stops a web page whose domain is redirected to your machine from reading the dashboard). List other names, comma separated, in `PR_TREE_ALLOWED_HOSTS` (for instance `PR_TREE_ALLOWED_HOSTS=dashboard.example.com`)
* A web page of another site open in your browser cannot call the dashboard's API: the browser marks such requests (`Sec-Fetch-Site`) and the server refuses them, so a page cannot start SYNC loads behind your back. Links to the dashboard from other sites still open it

## Running without Atlassian access (fixture mode)
* Run `npm run start:fixtures` (or `node index.mjs --fixtures`), no `config.js` needed
* Both configured projects are served from generated data modelled on the real SECOLLAB and OSLC projects: same repositories, Jira projects, volumes, branch naming, sprints, fix versions and the 24-deep stack of pull requests; the people are fictional
* The SYNC load button answers from the fixtures too; no request is ever sent to Atlassian
* `--fixture-scale=3` multiplies the volumes, `--fixture-chain-depth=8` shortens the deepest stack (environment variables `PR_TREE_FIXTURES`, `PR_TREE_FIXTURE_SCALE` and `PR_TREE_FIXTURE_CHAIN_DEPTH` work too)

## Changelog:
* Version 3.2.0
    * Two icons at the end of the reviewers line of each pull request, after its commit counts and open tasks, copy its source branch name and the command switching to it, `git switch <branch>`, ready to paste in a terminal. The tooltip shows what is copied; the icon turns into a check for a moment once copied, or into a cross with the reason in its tooltip when the browser refuses (the clipboard needs the page on localhost or https), and screen readers hear the result
    * `c` copies the `git switch` command of the selected pull request, `b` its branch name
    * The copied command is safe to paste whatever the branch is named: a name with a character the shell would read (`$`, `;`, `|`, a backtick, a quote) is put in single quotes, so a branch named to run a command stays a branch name; a name starting with `-` follows `--end-of-options`, so it is never read as an option; and `git switch`, unlike `git checkout`, never reads the name as a file, so a branch named like a folder of the repository and not fetched yet fails instead of restoring that folder over your changes
    * A third icon checks the branch out in Sourcetree, with the link of Bitbucket's own "Check out in SourceTree": Sourcetree asks which of your clones to check it out in (or offers to clone the repository), and what to do with uncommitted changes. The browser asks the first time whether to open Sourcetree. A pull request from a fork links to the fork
* Version 3.1.2
    * An In Review pull request that every reviewer approved but with open tasks no longer shows as approved (green band): it shows as in progress (amber band), the assignee's work, as the participant filter already treated it; it turns green once the tasks are resolved
* Version 3.1.1
    * Hovering the avatar of an author, a reviewer or a Jira approver, or its status icon, shows the person's name; before, only an assignee and a person without an avatar had a tooltip
* Version 3.1.0
    * The Jira issues in review without a pull request show their approvers and are kept for them: with participants selected, an approver keeps the issue under "All work" and "All reviews" ("All reviews" and "Ready for reviewers" no longer hide the section), and an approver who has not approved sees it waiting for them (highlighted, counted in the tab title, kept by "Ready for reviewers" and "Ready for participants"); while an approver is pending, the issue no longer waits for its assignee, who gets it back once every approver approved. The approvers join the Participants list. Set `approversField` and `approvedByField` in `config.js` to the ids of the Jira fields (see Installation); without them nothing changes. Fixture mode: about half of the orphaned issues have approvers (#146)
    * A reviewer, an approver or an assignee without an avatar shows a grey disc of the same size, named for screen readers and in its tooltip, instead of a lone icon
    * No behaviour change: Work, Hide drafts and SYNC are rows of the filter registry like the multi-selects, so their state, URL parameter, reset by "Clear filters", count in the badge and restore from the URL come from one place (#136)
    * An In Review pull request with open tasks waits for the assignee of its linked issues: with them selected, it is highlighted, counted in the tab title and kept by "Ready for assignees" and "Ready for participants", whether every reviewer approved or not, draft or not; before, only an In Progress pull request waited for its assignee. Its reviewers who have not approved still see it as waiting for them; the tasks left on a pull request whose issues are resolved wait for nobody (#138)
    * The folded repositories, branches and stacked pull requests survive a reload: the browser keeps them per project (localStorage), so a reloaded or reopened tab, and a switch to another project and back, show the tree folded as it was left; "Collapse all" and "Expand all" are kept like any fold. A merged pull request leaves the record at the next refresh; a repository or a branch stays folded while it has no pull request. The selected row, when a fold hides it, gives way to the folded pull request or branch that holds it, and the page no longer selects a first pull request out of sight; the address is unchanged (#142)
    * Keyboard navigation of the tree: ↓ / `j` and ↑ / `k` move between the rows shown, the branch headers included, → and ← unfold and fold the selected branch or pull request or go to its first pull request and to its parent, `o` opens the selected pull request in Bitbucket, `i` its first Jira issue, Enter or Space fold or unfold its stacked pull requests, `x` goes back to the root of its stack and folds it; a filtered-out pull request shown for a matching one below it is a row too, and the Jira issues without a pull request come last. The focused row keeps the focus when an automatic refresh repaints the tree (#118)
    * One row is selected (a bar on its left edge) whenever the tree shows one, and the address keeps it (`selected=`): a reload, a shared link, Back and Forward select it again and scroll to it; when it is gone or filtered out, the first pull request is selected and the address keeps the one chosen. A refresh never changes the address
    * A dashboard tab left open while the server is upgraded no longer misreads the new answers: the banner shows a "Reload: dashboard updated" button (below 900px, its icon only), the tree already shown stays, and the tab sends no more checks nor SYNC loads until it is reloaded; a project chosen meanwhile says "reload the page to load" it. The reload keeps the project and the filters (the SYNC statuses need loading again). Every `/api` answer names the page the server serves in an `X-Page-Build` header, a hash of the `public/` folder. A tab opened before this version needs one manual reload (#125)
    * A draft pull request shows a "Draft" badge next to its title, and a pull request with open tasks an amber badge with their number. A draft waits for no reviewer: it is no longer highlighted for a selected reviewer, counted in the tab title for them, or kept by "Ready for reviewers" (its assignee still sees it when its issue is in progress; "All reviews" keeps it), and no longer warned about for having no reviewer. A "Hide drafts" box in the sidebar hides the drafts (URL `drafts=hide`) (#119)
    * The dashboard listens on the loopback addresses only (127.0.0.1 and ::1): on a shared or office network, other machines could read every project's pull requests and Jira issues, and start SYNC loads on your Bitbucket token. `PR_TREE_HOST=0.0.0.0 npm start` opens it to the network again (see "Network access") (#98)
    * The server answers only requests addressed to one of its names (localhost, 127.0.0.1, [::1], plus the bound address and `PR_TREE_ALLOWED_HOSTS`): a web page whose domain is redirected to 127.0.0.1 (DNS rebinding) gets a 403 instead of the `/api` answers
    * An `/api` request that the browser marks as sent by another site gets a 403: a page open in another tab could start SYNC loads in a loop until Bitbucket's rate limit paused the dashboard for 10 minutes. The page itself, a link from another site, `curl` and scripts are unaffected
    * Refused requests are logged in `error.log`, one line a minute at most for each of the two reasons
    * Two repositories of a project with an open pull request of the same number (Bitbucket numbers them per repository) no longer mix up: each row shows its own Jira issues, the filters (text, sprint, fix version, epic, story, participants and work) read its own issues and reviewers, and collapsing one keeps the other expanded after a refresh. Before, one of the two showed the issues of the other, or none, and was filtered on them (#99)
    * The response of `/api/pull-requests/:project` keys `jiraIssuesMap` by `repository/id` (the repository the pull request is opened into) instead of the bare id; reload a dashboard tab left open across the upgrade
    * Fixture mode: two repositories of each project share pull-request numbers, as they can on Bitbucket
    * A collapsed root branch stays collapsed in its own repository after a refresh: when two repositories of a project have a root branch of the same name (`develop`, `master`), the refresh collapsed the first repository's branch and expanded the one the user had collapsed (#103)
    * The log files (`access.log`, `error.log`, `performance.log`) no longer grow forever: each is rotated at 10 MB, three old files kept (`access.log.1` to `access.log.3`, git-ignored). A log file that cannot be written (permissions, a full disk) no longer crashes the server: the console says so once, the lines still show on the console, and the file is tried again a minute later (#104)
    * Each log line is written to its file at once: the last lines are no longer lost when the server is stopped (Ctrl+C, a crash)
    * An unknown project in the address of `/api/pull-requests/:project` gets a 404 (`{ error: 'Project not found' }`) instead of a 500 and an error log line, like the SYNC route; a project name such as `constructor` or `__proto__` is an unknown project like any other, on both routes (#105)
    * The server sends a Content-Security-Policy with every answer: the page runs only its own scripts, from its own files, so a script, an inline event handler or a `javascript:` link that reached the page through a pull-request description (the hover popover shows Bitbucket's rendering as HTML) does not run; images still load from Atlassian and from any `https:` host a description names (#110)
    * The answers also carry `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` (Atlassian and image hosts no longer receive the dashboard's address), and no longer say `X-Powered-By: Express`; the theme script of the page head moved to `public/theme-bootstrap.js`
    * `sync-cache.json` survives a power loss: each save reaches the disk before it replaces the previous file, so the SYNC results are no longer lost (and computed again, with their Bitbucket requests) when the machine stops during a save. A save that fails no longer leaves a `sync-cache.json.<number>.tmp` file in the project directory, and those left by a server stopped during a save are removed at the next start; the SYNC answer no longer waits for the file to be written (#106)
    * The dashboard can be started from any directory (`node ~/Sites/pr-tree/index.mjs`, launchd, pm2): the page is served from the dashboard's own `public/` folder, where it showed a blank page (or the `public/` folder of the directory it was started from) while the API worked (#107)
    * Keyboard and screen readers (#109): the help opens as a modal dialog that takes the focus (Tab stays in it, the page behind is out of reach) and gives it back to the help button on close
    * A filter list (Sprint, Fix version, Epic, Story, Participants) closes on Escape from any of its controls, a checkbox or Clear all included, and when Tab leaves it: `F`, `/` and Escape no longer do nothing until a click after tabbing out of an open list. ArrowDown opens a list, ArrowDown and ArrowUp move between its search box and its checkboxes
    * Every control shows the same 2px focus outline: the search box, the selects and the filter lists had a faint ring instead, and the banner's controls an outline of the banner's own colour in the light theme (invisible)
    * The icon-only buttons are named for screen readers ("Toggle filters, 3 active" instead of "3", "Switch to dark theme", "Help", "GitHub repository"), their icons hidden; in the tree, the review status of each reviewer is named ("approved", "requested changes", "not reviewed yet") and the decorative icons are hidden
    * The theme toggle follows the system again when it picks the system's theme: before, the first click fixed the theme for good
* Version 3.0.1
    * The page loads nothing from a CDN any more: Font Awesome 5.15.3 (its stylesheet and fonts) and Marked are served by the dashboard itself, from `public/vendor/`, as published on npm. Marked came from an unversioned CDN address with no integrity check (it served 15.0.12 of 2025): a changed or compromised file would have run on the page that reads the `/api` answers. The dashboard also works offline or behind a proxy that blocks the CDNs, and a slow CDN no longer holds back its start
    * The help modal uses Marked 18.0.14, imported only when the help is first opened, so nothing waits for it at page load; the README renders the same. When the help content cannot be loaded, opening the help again retries, instead of showing the error until the page is reloaded
    * Express's dependencies are updated past four advisories (`npm audit`): `proxy-addr` 2.0.8 (critical, IP spoofing through IPv4-mapped IPv6), `path-to-regexp` 8.4.2 (high, ReDoS), `qs` 6.16.0 (moderate, denial of service), `body-parser` 2.3.0 (low, size limit). Express itself stays 5.2.1
* Version 3.0.0
    * During the 10-minute pause of the Atlassian requests after an HTTP 429, the page says so instead of failing silently: a project that cannot load meanwhile says "Atlassian requests are paused until 14:33 after a rate limit (HTTP 429)" instead of "Could not load", and the banner shows "Paused until 14:33" with a warning icon next to the refresh time while the tree is the data cached before the pause (below 900px, the icon only, the time in its tooltip) (#77)
    * The response of `/api/pull-requests/:project` carries `rateLimitedUntil`: the end of the pause in progress, `null` outside one
    * The page checks again a second after the end of the pause, so the project loads or refreshes at the time it announced instead of up to two minutes later, and the periodic checks send no request during the pause
    * A SYNC load that hits the rate limit shows the pause in the banner at once, not at the next check
    * No automatic check is sent while a project loads (one sent on coming back to the tab built the same data twice and could replace "Loading…" with a failure), and the answer of a check started before a quick switch away and back (Back then Forward) is dropped instead of painting over the new load; a load that ends in a background tab starts the periodic checks only when the tab is shown again
    * When a project's load got no data (failure or pause), the check that later renders it restores the filters of the URL and cleans the URL as the load would have
    * Below 900px the pause text is hidden visually but still read by screen readers; the banner items are 8px apart instead of 12px and the project select can shrink, so the banner fits a 400px-wide window with the pause icon
    * The banner keeps showing the pause after a switch to another project, or to no project, until the pause ends: the pause stops the Atlassian requests of every project. A project whose load fails meanwhile for another reason (an HTTP 500, the server unreachable) says "Could not load" with the time of the next check, at the end of the pause, and the pause still in the banner, and the indicator goes away at the end of the pause even when nothing is checked then (no project, or a tab in the background) (#83)
    * The SYNC warning gives the end of the pause as HH:MM, like the banner, instead of a time with seconds
    * Fewer Bitbucket requests, so less risk of the 10-minute pause: the commit counts of a pull request are fetched again only when its source or destination commit moves. Before, any change in the project (a Jira issue moved, a pull request commented) fetched the counts of every pull request again, two requests each (about 400 on a project of 200 pull requests). With two projects open, this happened at every refresh (#78)
    * The commit counts of a project's first load are fetched at most 10 at a time instead of all at once, and the sprints are fetched while the pull requests and their issues load instead of after them
    * Two requests for the same project while its data is being built (two tabs, or the SYNC load during a page load) share one build instead of each sending every Atlassian request (#84); a Bitbucket or Jira request that hangs fails after 30 seconds instead of holding the project's load
    * A branch whose name contains `&`, `#` or `+` gets its commit counts instead of wrong ones or none
    * When the diff requests of one side of a conflict check fail, the other side's requests stop too instead of going on for nothing: its request in flight is cancelled and the next ones are not sent (up to four on a pull request of 100 files to check, 20 files per request); the SYNC result is unchanged (#52)
    * A SYNC load stops when Bitbucket fails for every pull request (an outage, requests that hang, a run of 5xx, an expired token): once the requests of 8 pull requests in a row have failed with no answer between them, the requests in flight are cancelled and the pull requests not checked yet send nothing. On a project of 200 pull requests whose requests hang, the load answers after about a minute instead of 25; with fast 5xx answers, after 8 requests instead of 200. Their `?` badge and the SYNC warning icon say the load was stopped and why; the results computed before the stop are kept, and the next click on the load button computes again instead of getting the stopped answer from the cache (#93)
    * A click on the SYNC load button computes again instead of getting the previous answer, kept 5 minutes: after a push, the `?` badge ("SYNC status unknown - use the SYNC load button to refresh") went away only 5 minutes after the previous load, and a pull request not checked after a failure could not be checked again before then. A click made while a load is running gets that load's answer. The load stays cheap: only the pull requests whose commits moved, or that failed at the previous load, send requests (a few each); a pull request with too many files to check is now stored like a checked one, so it is not computed again, nor logged again, until its commits move. During a rate-limit pause the answer is still kept until the pause ends, and nothing is sent (#49)
    * The response of `/api/sync-statuses/:project` carries `stopped`: the reason of the stop, `null` when the load ran to its end
    * When Jira fails on the epics and stories, or on the sprints of a board or the issues of a sprint, while the rest of a project loads, the banner says "Partial data" next to the refresh time (below 900px, the icon only), its tooltip naming the filters that may lack values; the server keeps such a response for 30 seconds instead of 2 minutes, so the next request retries Jira, and a project load, a page reload or Back/Forward over it no longer drops the epic, story or sprint of the URL: the next complete refresh restores it (#91)
    * The response of `/api/pull-requests/:project` carries `incomplete`: the parts a Jira failure left out (`parents`, `sprints`), `[]` when nothing is missing
    * Light theme: the border of an in-progress card is a darker amber and the border of an in-review card approved by every reviewer a darker green, so both reach the WCAG contrast for non-text elements (3:1) against the card (they were at 1.90:1 and 2.66:1), and the two differ in lightness as well as in hue; the red border of a card's warnings box is darker too (it was 2.76:1 against its pink fill); the blue borders and the dark theme are unchanged (#81)
    * The border of a card whose linked issues are all resolved or closed is purple instead of a second blue, in both themes: in the dark theme it was the same blue as an in-review card, in the light theme a slightly darker one; the purple is also darker than the in-review blue in both themes, so the two stay apart without hue
    * A pull request with no linked Jira issue keeps the plain grey border instead of the resolved one
* Version 2.11.2
    * Light theme: the highlighted links of the pull requests and orphaned issues that need attention, the active-filter count (now ringed in the banner's text colour, so it stands out from the blue banner), the `-n` commit badges, the changes-requested reviewer icons and the icon of a failed load are a darker red, the `+n` commit badges and the approved reviewer icons a darker green, and the SYNC warning icon a darker amber, so each one reaches the WCAG AA contrast with its background (4.5:1; they were between 1.9:1 and 3.2:1); the SYNC badges and the colours of the dark theme are unchanged, the ring of the active-filter count is drawn in both themes (#76)
* Version 2.11.1
    * Every filter of the sidebar is named by its visible label: the Work and SYNC labels are real labels (a click on them focuses the select once it is enabled: Work with a participant selected, SYNC once its statuses are loaded), and the Sprint, Fix version, Epic, Story and Participants dropdowns are announced as buttons with their label, their selection and whether they are open ("Sprint, Show all, collapsed"); before, a screen reader announced them as "Show all" with no role (#62)
    * The SYNC load button is announced as "Load SYNC status" instead of "Load"
    * The search box of each dropdown is named by its filter ("Sprint") instead of "Search...", and Escape from it closes the dropdown and puts the focus back on the dropdown's button instead of losing it
    * A click anywhere on the page no longer rebuilds the option lists of the dropdowns that are already closed
* Version 2.11.0
    * More than 50 parent issues (epics and stories named by the linked and orphaned issues) no longer lose the ones past the 50th: the parents are read page by page, like the other Jira searches
    * A pull request linking an issue Jira returns without a status (a key of a project outside the configured ones, fetched only as the parent of another linked issue) no longer stops the whole tree from rendering: it shows "(no status)"
    * An HTTP 429 in the middle of a load now ends it (the server answers 503; the page still shows its generic failure, #77) instead of producing data without its sprints, parents or commit counts, served for the whole 10-minute pause
    * Ctrl+F (Cmd+F on macOS) focuses the search box; pressed again from the box, it opens the browser's own find
    * The response of `/api/pull-requests/:project` no longer carries `pullRequestsByDestination`: every pull request was serialized twice, once in the list and once under its destination branch (on the fixture data, SECOLLAB's response goes from 1.62 MB to 0.91 MB, OSLC's from 0.35 MB to 0.20 MB); the tree groups the pull requests per repository itself, so two repositories sharing a branch name no longer show each other's pull requests under it (#42)
    * No behaviour change: one filter registry drives the filter state, the URL parameters, the option lists (built by the filter index now) and the filter controls; the multi-select builds its own markup; the filter pass reads the status band and the SYNC result of a pull request from the data instead of the rendered tree; the server and the fixture generator share one assembly of a project's data (`project-assembly.mjs`); the Atlassian requests of the project data go through one helper per API (a failed Jira request now reports Jira's error message in the log, and a board whose sprints cannot be fetched is logged instead of skipped silently); the tree has one click listener instead of inline handlers (#42)
* Version 2.10.3
    * `sync-cache.json` drops the conflict results computed under another version of the conflict rule (older or newer) the next time it is written, instead of carrying them for 90 days (#51)
    * Light theme: the OK and SYNC badges are a darker green and red (4.7:1 and 5.2:1 with their white text, the WCAG AA minimum being 4.5:1; they were at 2.7:1 and 3.2:1) and the `?` and `!` badges a slightly darker grey; the three badges now have fill tokens of their own, so the status and muted-text colours no longer drive them; the dark theme is unchanged (#50)
* Version 2.10.2
    * The SYNC select has an accessible name ("SYNC"), like the project and Work selects; a screen reader no longer announces it by its current option only (#62)
* Version 2.10.1
    * The toggle buttons of the repositories, the root branches, the stacked pull requests and the orphaned issues section are real buttons with a name ("Toggle products.secollab") and an `aria-expanded` state kept up to date by every collapse and expand, so a screen reader announces them, and the focus ring is visible on the coloured repository header; Enter and Space on a focused button collapse and expand like a click (#66)
    * Every text from Bitbucket and Jira (pull request titles, branch and repository names, issue summaries and statuses, display names, priority names, URLs) is HTML-escaped when the tree and the orphaned issues section are rendered, and the issue popover shows the summary as text; a `"` or `<` in a Jira summary or a display name no longer breaks the markup (#65)
    * The tooltip of a filtered counter agrees with the number shown: "1 filtered issue out of 13 total", "1 filtered pull request out of 8 total" (#67)
* Version 2.10.0
    * The "Jira issues in review without a pull request" section follows the sidebar filters like the tree (every filter but SYNC; a fix version, epic or story filter needs the issue type, fix versions and parent, which the server now fetches for these issues, their parents completed in the same request as the linked issues' parents) and is hidden when nothing in it matches; its header carries a shown/total counter
    * The section is rendered like a repository block (collapsible, included in "Collapse all" and "Expand all", collapsed state kept across refreshes) with rows shaped like pull requests: priority, key with the issue popover, summary, assignee, last update, and a "No update for N days" warning after 14 days
    * With participants selected, an orphaned issue assigned to one of them is kept under "All work", "All issues", "Ready for participants" and "Ready for assignees", highlighted and counted in the tab title; "All reviews" and "Ready for reviewers" hide the section
    * The fix version filter lists the fix versions of the orphaned issues too; the epic, story and participant lists include what they bring
    * Fixture data: the orphaned issues carry the same fields, some are sub-tasks with their parent, some are in a sprint
* Version 2.9.0
    * The Work select's "All work" now keeps every pull request of the selected participants: the ones they review, approved or not, and the ones with a linked issue assigned to them, whatever its status; the former "All work" (only the pull requests waiting for them) is renamed "Ready for participants" (URL value `work=ready`); "All work" is the default
    * Two more Work values: "All reviews" (`work=reviews`) keeps the pull requests the selected participants review, approved or not, "All issues" (`work=issues`) the pull requests with a linked issue assigned to them, whatever its status
* Version 2.8.0
    * The Assignee, Reviewer, Ready for assignee and Ready for reviewer filters are replaced by a Participants filter (the assignees of the linked issues and the reviewers of the pull requests, one list) and a Work select: "All work" keeps the pull requests waiting for the selected participants as reviewers or as assignees, "Ready for reviewers" and "Ready for assignees" one kind only; a participant's pull requests that need nothing from them are no longer listed
    * URL parameters `participant` (repeated) and `work` (`reviewers` or `assignees`); the former `assignee`, `reviewer`, `readyReviewer`, `readyAssignee` and `ready` parameters are ignored and removed from the address bar
* Version 2.7.2
    * The sprint filter no longer hides the pull requests of an issue past the first 100 issues of its sprint, and the orphaned issues section no longer stops at 50 issues in review: both searches are paged with the token of Jira's search endpoint (`nextPageToken`, `isLast`), which returns no `total`, so only the first page was read since the switch to that endpoint
* Version 2.7.1
    * The server's SYNC computation moved from `index.mjs` into `sync-statuses.mjs`, with `fetch`, the cache and the logs injected, and is tested against a fake Bitbucket (`test/sync-statuses.test.mjs`: the requests made, what the client is shown, what reaches `sync-cache.json`); no behaviour change, the stored results stay valid (#48)
    * `npm test` checks the documented shape of `/api/pull-requests/:project` and `/api/cache/stats` on the fixture server, and what an unknown project is answered; the TTLs raised during a rate-limit pause, the cache statistics, a quoted path git would not print, a participant with an unknown status and the filter index kept by `initializeFilter` have their tests
    * The wrapper of every Atlassian request (the pause after an HTTP 429, the failure messages) moved from `index.mjs` into `atlassian-fetch.mjs` with `fetch` and the clock injected, and is tested (`test/atlassian-fetch.test.mjs`); no behaviour change
    * The Bitbucket and Jira fetchers and the building of the `/api/pull-requests/:project` response moved from `index.mjs` into `project-data.mjs` with `fetch` injected, and their documented rules are tested against a fake Atlassian (`test/project-data.test.mjs`: pagination, the Jira batches and parents, the inherited fix versions, the orphaned issues, the sprints, the hash and the commit counts fetched only when it changed); no behaviour change
* Version 2.7.0
    * The SYNC load no longer freezes the server: conflicts are decided from Bitbucket's diffs of both sides instead of a three-way merge of the files (one merge of a 30,000-line lock file ran for five minutes on the event loop and made the other computations time out with `?` badges) (#46)
    * Git's rule on the two diffs: the same resulting file on both sides merges cleanly (binary files included), overlapping or adjacent changes conflict unless they are identical, line endings count, a file deleted on one side and changed on the other conflicts, and so do different renames of one file and two files renamed onto one path, a file on one side where the other has a directory, and files added on both sides with different modes; a diff that cannot be read completely reports the pull request not checked rather than clean (or, when conflicts are already certain, SYNC with the conflicting files and the reason the other files could not be checked)
    * Two to four Bitbucket requests per pull request instead of about ten, so the SYNC load is affordable on the largest project; two loads of one project at once share one computation; the results are kept for good in `sync-cache.json` (git-ignored, pruned 90 days after they were computed), reused after a restart, and only the pull requests whose commits moved are computed again
    * Explicit SYNC badges: green OK, red SYNC with the conflicting files in the tooltip (one per line), grey `?` with the reason; a "Not checked" value in the SYNC filter; nothing is shown until the statuses are loaded
    * `node-diff3` is no longer a dependency
    * `npm run test:coverage` runs the tests with Node's coverage report of the project's modules, the server included (Node 22.5 or later); a SIGTERM now ends the server normally, which is what lets its coverage be written
* Version 2.6.0
    * Removed what nothing used (#41)
        * The `/api/pull-request-conflicts/:repoName/:spec` endpoint: the SYNC load has used `/api/sync-statuses/:project` since 2.1.0
        * The `node-fetch`, `dotenv` and `fetch` dependencies: the server uses the `fetch` built into Node (20.11 or later, declared in `package.json`), `PORT` is read from the environment as before but a private `.env` file is no longer loaded; a network failure now reaches `error.log` with its reason and the URL (the built-in `fetch` only says "fetch failed")
        * The sprint cache that was never wired (the sprints are fetched with the project data), the `clearCache` and `clearAllCache` exports, two multi-select methods, the `repoName` and `issuesRegex` fields of `config.js.default`, `start.bat` (`npm start` does the same)
        * The comments of `config.js.default` describe the credentials Atlassian accepts today: the account e-mail and a scoped API token for Bitbucket (app passwords were removed in July 2026), an API token for Jira
* Version 2.5.2
    * `README.md` is served by a dedicated route; the static middleware that served it from the project directory also served `config.js` (the Bitbucket and Jira credentials), the logs and the sources to anyone who could reach the port (#40)
    * The startup log shows the port actually bound, so `PORT=0` reports the port the OS picked
    * `npm test` starts the server in fixture mode and checks what it serves from the project directory
* Version 2.5.1
    * A periodic refresh or a SYNC load that ends after a project switch no longer paints the previous project's data or `?` badges over the new one; the late response is dropped, and the SYNC load button is available for the new project right away
    * Selecting "Select a project" clears the filters and their option lists like a project switch does, and writes a bare URL; previously the previous project's filters stayed and were written to the URL without a project
    * Back and Forward inside a project replace the URL with the filters actually kept (a value the options no longer offer is dropped), as a load already did
    * The "Last refreshed" time is cleared on a project switch, and an update check skipped because one is already running no longer stops the spinning refresh icon
* Version 2.5.0
    * Repositories left without a matching pull request are hidden by the filters, like their branches already were
    * When nothing matches, a "No pull request matches the filters" message replaces the tree; the orphaned issues stay listed
    * Back and Forward re-apply the filters and switch the project as the URL describes (#32); a project switch is one history entry and a page load adds none
    * SYNC follows the URL through Back and Forward while its statuses are loaded
* Version 2.4.0
    * Text filter at the top of the sidebar: matches the pull-request title, the source branch name and the linked issue keys, every word typed must match
        * `/` or Ctrl+F focuses it, Escape clears it, restored from the URL (`q`), the URL is replaced while typing so the history stays clean
    * Epic filter: pull requests of the selected epics, resolved through the parent story when the pull request is linked to a sub-task
        * The server now fetches the summary, type and parent of parent issues (previously their fix versions only)
        * Fixture data carries epics
    * Story filter: pull requests of the selected issues, the linked issue itself or the parent of a linked sub-task
    * Ready for assignee filter: In Progress pull requests with a linked issue assigned to the selected assignee, the counterpart of Ready for reviewer
    * Both ready filters are now restored from the URL (`readyAssignee`, `readyReviewer`); only the SYNC filter is still reset on reload
* Version 2.3.0
    * Filtering is now a single pass over the tree
        * Each pull request is visited once; the previous recursion revisited a stacked pull request once per ancestor, so a 24-deep stack (as in SECOLLAB) cost about 16 million visits and 20 seconds per filter change
        * Lookups go through indexes built once per data load instead of array searches per pull request
        * Counters are summed in the same pass instead of re-scanning the tree
        * On the SECOLLAB-sized fixture with the 24-deep stack, a filter change takes under a millisecond of JavaScript (about 7 ms with layout) in the browser
    * Fixture mode (`npm run start:fixtures`) serves generated data for the configured projects without Atlassian access, with scale and stack-depth options
    * `npm test` covers the fixture generator and the pure filter logic (`buildFilterIndex`, `evaluatePullRequest`)
* Version 2.2.0
    * New application layout
        * Top banner with the app name, project selector, refresh status, theme toggle, help, GitHub link and version
        * Filters stacked in a left sidebar that does not scroll with the tree; the sidebar can be hidden (button or `F` key) and its state is remembered
        * Below 900px the sidebar becomes a drawer over the tree
        * Repository and branch headers stick to the top of the tree while scrolling
        * Collapse all / expand all buttons above the tree
        * Active-filter badge on the sidebar button and a "Clear filters" button
        * The tab title shows the selected project and the number of pull requests needing attention
        * Empty, loading and error states are shown in the tree pane; a failed load no longer leaves the spinner forever
        * The footer is gone; its links and version moved to the banner
    * Dark theme, following the system setting until the toggle is used
    * "Ready for reviewer" is now computed from the data instead of the title colour
    * Stylesheet rebuilt on colour tokens, duplicate rules removed, system font stack
    * `npm test` runs unit tests for the pure filter and title logic (node:test)
* Version 2.1.0
    * SYNC status is now loaded on demand instead of automatically
        * No conflict computation is triggered when a project loads or refreshes, only when clicking the new load button next to the SYNC filter
        * The frontend makes a single call to the server, which retrieves everything needed from Atlassian and answers in one response
        * The response is cached server-side for 5 minutes like individual conflict checks
        * Loaded statuses are kept client-side and re-applied on automatic refreshes without new requests
    * Atlassian rate-limit protection
        * After any HTTP 429 from Bitbucket or Jira, the server stops sending requests to Atlassian until 10 minutes after the last 429 received
        * All cached data is kept alive for those 10 minutes so the dashboard keeps working from cache during the pause
* Version 2.0.0
    * Filters for sprint, fix version, assignee and reviewer are now multi-select filters
* Version 1.14.0
    * Subtasks now inherit fix version from parent task
        * When a Jira subtask has no fix version, it automatically inherits from its parent task
        * Parent issues are fetched if not already present in the results
        * Improves fix version filter accuracy for subtasks
    * Fix version filter now shows project name
        * Versions are displayed as "Version Name (PROJECT)"
        * Sorted by project then version name for easier navigation
    * Updated dependencies to latest versions
        * Express: 4.19.2 → 5.2.1
        * dotenv: 16.4.5 → 17.2.3
* Version 1.13.1
    * Fixed toggle state preservation across data reloads
        * User's collapsed/expanded state for repositories, branches, and pull requests is now preserved when data refreshes
        * Prevents UI from resetting every 2 minutes during automatic updates
        * Improves user experience by maintaining the view state users have configured
* Version 1.13.0
    * Renamed "Author" filter to "Assignee" and changed filtering logic
        * Now filters pull requests based on Jira issue assignee instead of Bitbucket PR author
        * Dropdown is populated with unique assignees from all Jira issues
        * A PR is visible if any of its linked Jira issues is assigned to the selected person
        * Highlights "In Progress" PRs assigned to the filtered assignee
        * URL parameter changed from ?author= to ?assignee=
        * Fetches assignee field from Jira API for all issues
* Version 1.12.0
    * Added fixVersion filter dropdown
        * Fetches fixVersions field from Jira API for all issues
        * Allows filtering pull requests by Jira fixVersion
        * Filter selection is persisted in URL parameters
        * Dropdown is dynamically populated with all available fixVersions
* Version 1.11.1
    * Switched to the new JQL API after deprecation removal of the former API
* Version 1.11.0 
    * Added server-side caching to improve performance and reduce API calls
        * Implements in-memory caching with configurable TTL 
        * Caches project data, conflicts data, and sprint information 
        * Provides cache statistics endpoint for monitoring 
        * Automatically cleans up expired cache entries
    * Reduced load on Bitbucket and Jira APIs
* Version 1.10.0
    * Added display of JIRA issues that are In Review but don't have associated pull requests
    * Issues are displayed in a separate section below the pull requests
    * Each issue shows its priority, key, summary, and status
    * Issues are sorted by priority and last update time
    * Direct links to JIRA are provided for each issue
    * The section is only visible when there are orphaned issues to display
* Version 1.9.1
    * Minor aesthetics improvements
* Version 1.9.0
    * Compute Ahead (green) and Behind (red) commit counts
    * Implement a pseudo-cache to only get those new data when something else has changed to avoid HTTP 429 from Bitbucket
* Version 1.8.1
    * Disable the SYNC filter until all filters are properly loaded
* Version 1.8.0
    * Order pull requests by last modification date (most recent first)
    * Display the date when data was last refreshed
    * Refresh the data when the tab is selected
    * Display a small loader when checking for updates
    * Don't check for updates if it's already doing so
    * Don't check for updates unless the tab is active
    * Refresh every 2 minutes (instead of every minute)
* Version 1.7.2
    * Restore status text after issue key (users' feedback)
* Version 1.7.1
    * Fix Github link
    * Add priority icon before issue key
    * Remove status text after issue key (redundant with outline color)
    * Add tooltip to alert users on filters which are not restored on reload
* Version 1.7.0
    * Add SYNC filter
    * Add Ready for reviewer filters
    * Those 2 filters can't be restored from the URL upon reloading the app
* Version 1.6.3
    * Added support for filtered counters vs overall counters
* Version 1.6.2
    * Enhanced URL persistence for all filters
        * All filter selections (project, sprint, assignee, reviewer) are now saved in the URL
        * Filters are automatically restored when sharing or reloading the page
        * Direct linking to specific filtered views is now supported
* Version 1.6.1
    * Better sprint filtering
* Version 1.6
    * Add online help based which displays the README.md file
    * Allow filtering by both assignee and reviewer
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
    * Provides an assignee filter
        * filters pull requests of selected assignee
        * highlights in red those where an effort is expected
    * Provides a reviewer filter
        * filters pull requests of selected reviewer
        * highlights in red those where an effort is expected