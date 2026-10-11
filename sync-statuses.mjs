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
 * @param {number} [options.maxConsecutiveFailures=8] - failed requests in a row that stop a load
 * @param {() => number} [options.now] - clock, for the durations logged
 */
export function createSyncStatuses({ fetch, workspace, bbAuth, log, syncCache, timeoutMs = 30000, maxConcurrent = 4, maxConsecutiveFailures = 8, now = () => Date.now() }) {
    // One SYNC load asks for every pull request of a project at once, and each
    // computation makes many Bitbucket calls of its own
    const conflictsLimiter = createLimiter(maxConcurrent);

    // The stop of one load: maxConsecutiveFailures failed requests in a row (two
    // rounds of the limiter by default) abort `signal`, which every request and
    // check of the load follows; a request that gets an answer resets the count.
    // The count is the load's: the limiter is shared by the loads of every project.
    function createLoad() {
        const controller = new AbortController();
        let failures = 0;
        return {
            signal: controller.signal,
            answered() { failures = 0; },
            failed(error) {
                if (controller.signal.aborted) return;
                failures++;
                if (failures >= maxConsecutiveFailures) {
                    controller.abort(new Error(`SYNC load stopped after ${failures} Bitbucket failures in a row, the last one: ${failureReason(error)}`));
                }
            }
        };
    }

    // One Bitbucket request of a load, its body as text. `signal` stops it on
    // purpose (the load, or the other side of a check) and is combined with the
    // timeout. A timeout, a network failure, a body cut short or a 5xx counts
    // towards the stop of the load; any other answer (a 404 too: Bitbucket is up)
    // resets the count; a stop on purpose and the rate-limit pause count nothing.
    async function fetchBitbucket(url, headers, load, signal) {
        let response;
        let body;
        try {
            response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
                headers: { 'Authorization': `Basic ${bbAuth}`, ...headers }
            });
            if (response.ok) body = await response.text();
        } catch (error) {
            if (!signal.aborted && !(error instanceof RateLimitError)) load.failed(error);
            throw error;
        }
        if (!response.ok) {
            await response.arrayBuffer().catch(() => {}); // release the socket
            const error = new Error(`Request failed with status code ${response.status}`);
            if (response.status >= 500) load.failed(error);
            else load.answered();
            throw error;
        }
        load.answered();
        return body;
    }

    // Returns a Map of touched file path -> {status, sidePath, linesAdded, linesRemoved} for one side of a merge.
    // Bitbucket's diffstat/{a}..{b} is a topic (three-dot) diff: changes on side `a` since merge-base(a, b).
    // Renamed files are keyed by their old path (so both sides match) but read from their new path.
    async function fetchDiffstatFiles(repoName, sideCommit, otherCommit, load) {
        const files = new Map();
        let url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/diffstat/${sideCommit}..${otherCommit}?pagelen=500`;
        while (url) {
            const page = JSON.parse(await fetchBitbucket(url, { 'Accept': 'application/json' }, load, load.signal));
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
    async function fetchPatch(repoName, sideCommit, otherCommit, filePaths, load, signal) {
        const files = new Map();
        for (let i = 0; i < filePaths.length; i += filesPerPatchRequest) {
            signal.throwIfAborted();
            const paths = new Set(filePaths.slice(i, i + filesPerPatchRequest).flat());
            const query = [...paths].map(p => `path=${encodeURIComponent(p)}`).join('&');
            const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/diff/${sideCommit}..${otherCommit}?topic=true&${query}`;
            for (const [basePath, file] of parseUnifiedDiff(await fetchBitbucket(url, {}, load, signal))) {
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

        const sourceFiles = await fetchDiffstatFiles(repoName, sourceCommit, destCommit, load);
        if (sourceFiles.size === 0) return { conflicts: false };
        const destFiles = await fetchDiffstatFiles(repoName, destCommit, sourceCommit, load);
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
                    fetchPatch(repoName, sourceCommit, destCommit, filePaths, load, signal),
                    fetchPatch(repoName, destCommit, sourceCommit, filePaths, load, signal)
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
                // After the stop of the load, its reason: the error of a request it aborted says nothing (logged once by the caller)
                if (load.signal.aborted) return { conflicts: true, files: known, reason: failureReason(load.signal.reason) };
                if (!(error instanceof RateLimitError)) {
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
     * Repeated Bitbucket failures stop the load (createLoad): the checks not
     * done yet report the stop's reason, `stopped` too.
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
                    computed++;
                    result = await conflictsLimiter(() => computeConflicts(repoName, spec, load));
                    // Complete results only: a failure or a partial SYNC is computed again at the next load
                    if (!result.error && !result.reason) syncCache.set(key, result);
                }
                statuses[key] = result;
            } catch (error) {
                // After the stop of the load, its reason, logged once below
                const failure = load.signal.aborted ? load.signal.reason : error;
                if (!load.signal.aborted && !(error instanceof RateLimitError)) {
                    log.error(`Error computing sync status for ${repoName} ${spec}: ${error.message}`);
                }
                statuses[key] = { error: true, reason: failureReason(failure) };
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
