# The pause indicator stays across project switches

**Date:** 2026-10-11
**Issue:** #83 (follow-up of #77, PR #82)
**Target version:** 2.12.0 (unreleased, no version bump)

## 1. Goal

The banner indicator "Paused until HH:MM" followed the answers of the project
shown: `selectProject` cleared it with the refresh time, and the next answer
of the new project set it again. The pause, though, belongs to the server:
nothing is sent to Atlassian before its end, whatever the project. Choosing
the empty entry of the project dropdown, or switching to a project whose load
failed with an ordinary error (500, network), hid the indicator while the
pause went on.

## 2. Decisions

1. **`pausedUntil` is the server's pause**, not the current project's. A
   project switch leaves it alone. Each `/api/pull-requests` answer updates
   it through `pauseEndAfter(current, result)` (atlassian-pause.js, pure):
   - an answer with an end (a 503, or cached data with `rateLimitedUntil`)
     sets that end;
   - data without an end clears it: since 2.12.0 every 200 answer carries the
     live `rateLimitedUntil`, `null` outside a pause;
   - an ordinary failure keeps it: a 500 or a network error says nothing
     about the pause.
   `setPause` drops an end already past, so a failure after a timer delayed
   in a background tab does not show a pause that is over.
2. **One timer at the end of the pause**, independent of
   `startPeriodicChecking` and `stopPeriodicChecking`: set by `setPause`, it
   fires a second after the end, clears the pause, hides the indicator and,
   while the periodic checks run, checks at once (the check of decision 5 of
   the #77 spec, unchanged when a project is shown). Without a project, or in
   a hidden tab, it only hides the indicator; a tab shown again checks at
   once as before. Before, the timer lived with the periodic interval, so
   with no project nothing would have hidden the indicator.
3. **The main-pane message follows the answer**, the indicator the server.
   A load or a check without data shows the pause message with the end its
   own answer carried, the "Could not load" message otherwise, even while a
   pause from an earlier answer is still ahead: the "will load then" of the
   pause message would be a promise a failed load cannot keep. This keeps
   "the server is paused" (the indicator) apart from "this answer was
   paused" (the message), the mix the issue warned about.
   `renderEverything` no longer takes `null`: `takeAnswer(result)`, shared
   by the load and the check, updates the pause and paints the message.
4. **The periodic checks still skip their fetch while the pause is ahead**,
   now also for a project switched to during the pause; its load itself is
   sent (the server answers its cache or a 503 at once, without Atlassian).
   So a failure during a pause names the time of the next check: "Could not
   load OSLC. The next check is at 14:33, at the end of the Atlassian
   pause." instead of "The next automatic check will retry".
5. **A 503 that arrives after the end of its pause** (sent a second before
   it) is a failure: `setPause` drops the past end, so the pause message
   would promise a load nothing sends. A load that gets one starts its
   checks at once. A check that gets one is followed by the periodic one;
   rescheduling at once would loop on an end the client's clock always sees
   as past, which the shared clock of server and page rules out today but
   should not turn into a request per second if it ever did not.
6. **The indicator's tooltip** says the pause is for every project and that
   "the project shown is checked again then" (it said "the page checks
   again then", false without a project).

## 3. Turned down

- **Hiding the indicator when no project is selected**: the user would no
  longer be told that a project picked meanwhile cannot load before HH:MM.
- **Asking the server for the pause (`/api/cache/stats` or a new
  endpoint) on a switch**: every answer already carries it; a failed load
  keeps the last known end, which the timer clears.
- **Comparing the server's end with a clock of its own** (review of #94):
  the server and the page run on the same workstation, one clock.
- **Repainting the pause message of a hidden tab at the end of the pause**
  (review of #94): nobody sees it, and the tab checks at once when shown.
- **Clearing a pause set by a SYNC answer on a switch** (review of #94): a
  cached SYNC answer expires at the end of its pause, and a server restart
  clears that cache with the pause, so its end is never stale.
