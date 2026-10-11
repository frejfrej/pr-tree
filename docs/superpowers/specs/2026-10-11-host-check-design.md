# Loopback bind, Host check, cross-site API requests refused

**Date:** 2026-10-11
**Issue:** #98
**Target version:** 3.1.0
**Status:** Decided alone (the user asked for the fix without a brainstorm); section 2 lists the decisions to revisit

## 1. Goal

`app.listen(port)` binds every interface and no route checks who is asking.
Three exposures: any machine of the network reads the private pull-request
and Jira data and starts SYNC loads on the user's token; a page of an
attacker's domain rebinding its DNS to 127.0.0.1 reads every `/api` answer
(binding to 127.0.0.1 alone does not stop it); any page open in the browser
can send `no-cors` requests to `localhost` in a loop and spend the Bitbucket
quota until a 429 pauses the dashboard for 10 minutes. Spec 2026-09-10
(serve-readme-route) §2.5 deferred the bind.

## 2. Decisions

1. **Bind 127.0.0.1 by default**, `PR_TREE_HOST` to open another address
   (`0.0.0.0` for every interface). Not `HOST`: shells and container images
   set it (zsh defines `$HOST`, some profiles export it), which would open the
   dashboard by accident; `PR_TREE_` matches the fixture variables. Not
   `localhost`: `listen` binds the first address it resolves to, `::1` on
   macOS, and `http://127.0.0.1` would fail. Browsers and Node's `fetch` fall
   back from `::1` to 127.0.0.1 for `localhost` (checked), so the startup line
   `Server is running at http://localhost:<port>` stays true.
2. **Host check on the host name only, every route, first in the chain.**
   Accepted: `localhost`, `127.0.0.1`, `[::1]`; the address of `PR_TREE_HOST`;
   for a wildcard, every interface address and `os.hostname()`, read at
   startup; the names of `PR_TREE_ALLOWED_HOSTS` (comma separated). The port is
   not compared: a rebinding page cannot make the browser send a loopback
   name, and an SSH tunnel on another port keeps working. 403 with a JSON
   `{ error }` naming `PR_TREE_ALLOWED_HOSTS`; the received Host is logged, not
   echoed.
3. **`Sec-Fetch-Site` instead of the custom header the issue suggested.**
   An `/api` request marked `cross-site` or `same-site` gets a 403; `same-origin`,
   `none` (address bar) and no header (curl, scripts, old browsers) pass.
   Every current browser sends the header, the page needs no change, and it
   covers every `/api` route rather than the SYNC one only. `same-site` is
   refused too: another dev server on `localhost:5173` is the same site. The
   page, its files and README.md are not checked, so a link from Jira or a
   chat still opens the dashboard. The `/api` test ignores case, as Express's
   routing does.
4. **Refusals logged once a minute per message** in `error.log`: a page
   sending requests in a loop would otherwise grow the log without bound.
5. **One pure module, `request-guard.mjs`**: `hostnameOf`, `allowedHostnames`
   (takes the interfaces and the machine name, so it is testable),
   `createRequestGuard` (Express middleware, takes `log` and `now`).
6. **3.1.0**: a new setting and a changed default (the LAN loses access until
   `PR_TREE_HOST` is set); the changelog says how to get it back.

## 3. Out of scope

- Authentication: a process of the machine, or of the network when opened,
  can still call the API with an accepted name.
- Interface addresses that change after startup (DHCP): restart, or list the
  name in `PR_TREE_ALLOWED_HOSTS`.
- HTTPS (NFR-SEC3).

## 4. Verification

`test/request-guard.test.mjs` (parsing, accepted names, both refusals, log
throttle). `test/server.test.mjs`: a foreign Host gets 403 on `/api`, `/` and
`/README.md` while the loopback names get 200; cross-site and same-site `/api`
requests get 403, same-origin 200, a cross-site navigation to `/` 200; a
non-loopback interface address is refused (skipped without one). The three
fail on the previous `index.mjs`. Manual: `PR_TREE_HOST=0.0.0.0` answers at
the LAN address, the machine name and an allowed name, 403 for another;
Chrome on the fixture server: SECOLLAB, the SYNC load and the help work at
`localhost`, and a `no-cors` fetch from `127.0.0.1:3100` (another site) to
`localhost:3100/api/sync-statuses` is refused before any computation.
