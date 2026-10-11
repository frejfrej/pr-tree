import { decideFromDiffstat, parseUnifiedDiff, conflictingFiles } from './conflicts.mjs';
import { RateLimitError, failureReason } from './atlassian-fetch.mjs';
import { createLimiter } from './limiter.mjs';

/**
 * The SYNC (conflicts) status of the pull requests of a project, computed
 * from Bitbucket's diffstats and patches (conflicts.mjs) and kept in
 * sync-cache.json (sync-cache.mjs). Nothing here talks to Bitbucket by
 * itself: the server passes atlassianFetch as `fetch`, so a rate-limit pause
 * reaches the computation as a RateLimitError. A load whose Bitbucket
 * requests keep failing (an outage, requests that hang until their timeout)
 * is stopped as a whole instead of each pull request finding out on its own.
 */

// The paths of one file (its base path and its path on each side) go in the
// same request, so a rename is seen whole; 20 files per request keep the URL short.
export const filesPerPatchRequest = 20;

// More files to check than this skips the patches: the pull request is not
// checked, or only partly when the diffstats already proved a conflict
export const maxFilesToCheck = 100;

// A checked file must be in the patch of each side, with the diffstat's line
// counts: a missing file, a patch cut between two hunks or a path the parser
// could not read would otherwise pass for a clean merge
function checkPatch(basePath, patch, diffstat) {
    const file = patch.get(basePath);
    if (!file) throw new Error(`${basePath} is missing from the diff`);
    const { linesAdded, linesRemoved } = diffstat.get(basePath);
    if ((Number.isInteger(linesAdded) && file.linesAdded !== linesAdded) ||
        (Number.isInteger(linesRemoved) && file.linesRemoved !== linesRemoved)) {
        throw new Error(`${basePath}: the diff (+${file.linesAdded} -${file.linesRemoved}) does not match the diffstat (+${linesAdded} -${linesRemoved})`);
    }
}

/**
 * The computation of a server: one limiter, one cache.
 * @param {object} options
 * @param {typeof fetch} options.fetch - sends a request to Bitbucket (the server passes atlassianFetch)
 * @param {string} options.workspace - the Bitbucket workspace slug
 * @param {string} options.bbAuth - the Base64 credentials of the Authorization header
 * @param {{ error: (message: string) => void, performance: (message: string) => void }} options.log - the error and performance logs
 * @param {ReturnType<import('./sync-cache.mjs').openSyncCache>} options.syncCache - the opened sync-cache.json, keyed by "repo/destHash..sourceHash" (opened with the current conflictRuleVersion)
 * @param {number} [options.timeoutMs=30000] - the timeout of one request
 * @param {number} [options.maxConcurrent=4] - conflict computations at once
 * @param {number} [options.maxConsecutiveFailures=8] - pull requests in a row whose requests fail that stop a load
 * @param {() => number} [options.now] - clock, for the durations logged
 */
export function createSyncStatuses({ fetch, workspace, bbAuth, log, syncCache, timeoutMs = 30000, maxConcurrent = 4, maxConsecutiveFailures = 8, now = () => Date.now() }) {
    // One SYNC load asks for every pull request of a project at once, and each
    // computation makes many Bitbucket calls of its own
    const conflictsLimiter = createLimiter(maxConcurrent);

    // The stop of one load: the requests of maxConsecutiveFailures checks in a row
    // fail (two rounds of the limiter by default), with no answer between them,
    // and `signal` is aborted with the reason, which every request and check of the
    // load follows. A check counts one failure at most: the two sides of a pull
    // request whose diffs are too heavy time out together, and the next checks'
    // diffstats answer. The count is the load's: the limiter is shared by the
    // loads of every project.
    function createLoad() {
        const controller = new AbortController();
        let failures = 0;
        const answered = () => { failures = 0; };
        return {
            signal: controller.signal,
            // What the requests of one check report
            check() {
                let failed = false;
                return {
                    signal: controller.signal,
                    answered,
                    failed(error) {
                        if (failed || controller.signal.aborted) return;
                        failed = true;
                        failures++;
                        if (failures >= maxConsecutiveFailures) {
                            controller.abort(new Error(`SYNC load stopped after Bitbucket failed for ${failures} pull requests in a row, the last one: ${failureReason(error)}`));
                        }
                    }
                };
            }
        };
    }

    // One Bitbucket request of a check, its body read by `parse`. `signal` stops it
    // on purpose (the load, or the other side of the check) and is combined with
    // the timeout; a request stopped by the load rejects with the load's reason.
    // A timeout, a network failure, a body cut short or unreadable, a 5xx, a 401
    // or a 403 (an expired token fails every request too) counts towards the stop
    // of the load; any other answer (a 404: Bitbucket is up) resets the count; a
    // stop on purpose and the rate-limit pause count nothing.
    async function fetchBitbucket(url, headers, requests, signal, parse = body => body) {
        let response;
        let body;
        try {
            response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
                headers: { 'Authorization': `Basic ${bbAuth}`, ...headers }
            });
            if (response.ok) body = parse(await response.text());
        } catch (error) {
            if (requests.signal.aborted) throw requests.signal.reason;
            if (!signal.aborted && !(error instanceof RateLimitError)) requests.failed(error);
            throw error;
        }
        if (!response.ok) {
            await response.arrayBuffer().catch(() => {}); // release the socket
            const error = new Error(`Request failed with status code ${response.status}`);
            if (response.status >= 500 || response.status === 401 || response.status === 403) requests.failed(error);
            else requests.answered();
            throw error;
        }
        requests.answered();
        return body;
    }

    // Returns a Map of touched file path -> {status, sidePath, linesAdded, linesRemoved} for one side of a merge.
    // Bitbucket's diffstat/{a}..{b} is a topic (three-dot) diff: changes on side `a` since merge-base(a, b).
    // Renamed files are keyed by their old path (so both sides match) but read from their new path.
    async function fetchDiffstatFiles(repoName, sideCommit, otherCommit, requests) {
        const files = new Map();
        let url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/diffstat/${sideCommit}..${otherCommit}?pagelen=500`;
        while (url) {
            const page = await fetchBitbucket(url, { 'Accept': 'application/json' }, requests, requests.signal, body => JSON.parse(body));
            for (const entry of page.values || []) {
                const oldPath = entry.old && entry.old.path;
                const newPath = entry.new && entry.new.path;
                files.set(oldPath || newPath, { status: entry.status, sidePath: newPath || oldPath, linesAdded: entry.lines_added, linesRemoved: entry.lines_removed });
            }
            url = page.next || null;
        }
        return files;
    }

    // The changes of one side since the merge base for the given files, as parsed
    // by conflicts.mjs. Bitbucket's diff/{a}..{b}?topic=true is the three-dot diff
    // of side `a` (checked against diffstat on 2026-09-11); `path` can be repeated.
    // `signal` stops the side: no next request, the one in flight aborted.
    async function fetchPatch(repoName, sideCommit, otherCommit, filePaths, requests, signal) {
        const files = new Map();
        for (let i = 0; i < filePaths.length; i += filesPerPatchRequest) {
            signal.throwIfAborted();
            const paths = new Set(filePaths.slice(i, i + filesPerPatchRequest).flat());
            const query = [...paths].map(p => `path=${encodeURIComponent(p)}`).join('&');
            const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/diff/${sideCommit}..${otherCommit}?topic=true&${query}`;
            for (const [basePath, file] of parseUnifiedDiff(await fetchBitbucket(url, {}, requests, signal))) {
                files.set(basePath, file);
            }
        }
        return files;
    }

    // Bitbucket removed merge-preview diffs from its API and the replacement
    // /pullrequests/{id}/conflicts endpoint rejects API-token auth, so conflicts
    // are decided here: the files touched on both sides since the merge base come
    // from the diffstats, what the statuses do not decide comes from the patches
    // of both sides (conflicts.mjs). No file content is fetched, nothing is merged.
    // When the patches cannot decide (more files to check than the limit, a failed
    // request, a patch that does not match its diffstat), the conflicts the
    // diffstats found are still reported, with the reason the rest was not checked.
    // `load` is the SYNC load the check belongs to: a check waiting in the limiter
    // when the load stops ends without a request; a direct call gets a load of its own.
    async function computeConflicts(repoName, spec, load = createLoad()) {
        load.signal.throwIfAborted();
        const startTime = now();
        const [destCommit, sourceCommit] = spec.split('..');
        const requests = load.check();

        const sourceFiles = await fetchDiffstatFiles(repoName, sourceCommit, destCommit, requests);
        if (sourceFiles.size === 0) return { conflicts: false };
        const destFiles = await fetchDiffstatFiles(repoName, destCommit, sourceCommit, requests);
        const { conflicting, toCheck } = decideFromDiffstat(sourceFiles, destFiles);
        const known = [...conflicting].sort();
        if (toCheck.length > maxFilesToCheck) {
            const reason = `too many files to check (${toCheck.length})`;
            log.error(`Conflict check for ${repoName} ${spec}: ${reason}, the limit is ${maxFilesToCheck}`);
            return known.length > 0 ? { conflicts: true, files: known, reason } : { error: true, reason };
        }

        const files = new Set(known);
        if (toCheck.length > 0) {
            const stop = new AbortController();
            const signal = AbortSignal.any([load.signal, stop.signal]);
            try {
                // The base path and the path on each side: a renamed file is found under both
                const filePaths = toCheck.map(basePath => [basePath, sourceFiles.get(basePath).sidePath, destFiles.get(basePath).sidePath]);
                const [sourcePatch, destPatch] = await Promise.all([
                    fetchPatch(repoName, sourceCommit, destCommit, filePaths, requests, signal),
                    fetchPatch(repoName, destCommit, sourceCommit, filePaths, requests, signal)
                ]);
                for (const basePath of toCheck) {
                    checkPatch(basePath, sourcePatch, sourceFiles);
                    checkPatch(basePath, destPatch, destFiles);
                }
                for (const file of conflictingFiles(sourcePatch, destPatch)) files.add(file);
            } catch (error) {
                // The first side to fail stops the other: its result would be thrown away
                stop.abort(error);
                // Nothing known yet: the caller reports the pull request not checked
                if (known.length === 0) throw error;
                // The stop of the load is logged once, by the caller
                if (!(error instanceof RateLimitError) && error !== load.signal.reason) {
                    log.error(`Conflict check for ${repoName} ${spec} incomplete, ${known.length} conflicting files known from the diffstats: ${error.message}`);
                }
                return { conflicts: true, files: known, reason: failureReason(error) };
            }
        }
        const sorted = [...files].sort();

        const duration = now() - startTime;
        log.performance(`computeConflicts - ${repoName} ${spec} - ${conflicting.length + toCheck.length} overlapping files - conflicts: ${sorted.length > 0} - Duration: ${duration}ms`);
        return sorted.length > 0 ? { conflicts: true, files: sorted } : { conflicts: false };
    }

    /**
     * The statuses of the given pull requests, keyed by "repo/dest..source":
     * each result is read from the cache first, computed otherwise (at most
     * maxConcurrent at once), and only a complete result is stored; a pull
     * request without commit hashes on both sides gets no entry (the
     * frontend flags it as invalid). The cache is saved once at the end.
     * Repeated Bitbucket failures stop the load (createLoad): the checks the
     * stop ends report its reason, `stopped` too; `computed` counts the checks
     * started, not the ones that ended before their first request.
     * @param {string} projectName - for the log lines
     * @param {object[]} pullRequests - Bitbucket pull requests
     * @returns {Promise<{ statuses: Record<string, { conflicts: boolean, files?: string[], reason?: string } | { error: true, reason: string }>, stopped: string|null }>}
     */
    async function computeSyncStatuses(projectName, pullRequests) {
        const statuses = {};
        let computed = 0;
        const load = createLoad();
        await Promise.all(pullRequests.map(async (pullRequest) => {
            const repoName = pullRequest.source.repository.name;
            const spec = `${pullRequest.destination.commit?.hash}..${pullRequest.source.commit?.hash}`;
            if (spec.includes('undefined')) {
                return; // no commit hashes to compare, the frontend flags these as invalid
            }

            const key = `${repoName}/${spec}`;
            try {
                let result = syncCache.get(key);
                if (!result) {
                    result = await conflictsLimiter(() => {
                        load.signal.throwIfAborted();
                        computed++;
                        return computeConflicts(repoName, spec, load);
                    });
                    // Complete results only: a failure or a partial SYNC is computed again at the next load
                    if (!result.error && !result.reason) syncCache.set(key, result);
                }
                statuses[key] = result;
            } catch (error) {
                // The stop of the load is logged once, below
                if (!(error instanceof RateLimitError) && error !== load.signal.reason) {
                    log.error(`Error computing sync status for ${repoName} ${spec}: ${error.message}`);
                }
                statuses[key] = { error: true, reason: failureReason(error) };
            }
        }));
        const stopped = load.signal.aborted ? load.signal.reason.message : null;
        if (stopped) log.error(`Sync statuses of ${projectName}: ${stopped}`);
        await syncCache.save().catch(error => log.error(`sync-cache.json not written: ${error.message}`));
        const results = Object.values(statuses);
        const notChecked = results.filter(status => status.error).length;
        const partlyChecked = results.filter(status => status.conflicts && status.reason).length;
        log.performance(`Sync statuses of ${projectName} - ${results.length} pull requests, ${computed} computed, ${notChecked} not checked, ${partlyChecked} partly checked${stopped ? ', stopped after repeated Bitbucket failures' : ''}`);
        return { statuses, stopped };
    }

    return { computeConflicts, computeSyncStatuses };
}
