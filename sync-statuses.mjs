import { conflictRuleVersion, decideFromDiffstat, parseUnifiedDiff, conflictingFiles } from './conflicts.mjs';
import { RateLimitError, failureReason } from './atlassian-fetch.mjs';

/**
 * The SYNC (conflicts) status of the pull requests of a project, computed
 * from Bitbucket's diffstats and patches (conflicts.mjs) and kept in
 * sync-cache.json (sync-cache.mjs). Nothing here talks to Bitbucket by
 * itself: the server passes atlassianFetch as `fetch`, so a rate-limit pause
 * reaches the computation as a RateLimitError.
 */

// The paths of one file (its base path and its path on each side) go in the
// same request, so a rename is seen whole; 20 files per request keep the URL short.
export const filesPerPatchRequest = 20;

// More files to check than this skips the patches: the pull request is not
// checked, or only partly when the diffstats already proved a conflict
export const maxFilesToCheck = 100;

// Serializes conflict computations: one SYNC load asks for every pull request of
// a project at once, and each computation makes many Bitbucket calls of its own.
function createLimiter(maxConcurrent) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= maxConcurrent || queue.length === 0) return;
        active++;
        const { task, resolve, reject } = queue.shift();
        task().then(resolve, reject).finally(() => { active--; next(); });
    };
    return task => new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        next();
    });
}

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
 * @param {ReturnType<import('./sync-cache.mjs').openSyncCache>} options.syncCache - the opened sync-cache.json
 * @param {number} [options.timeoutMs=30000] - the timeout of one request
 * @param {number} [options.maxConcurrent=4] - conflict computations at once
 * @param {() => number} [options.now] - clock, for the durations logged
 */
export function createSyncStatuses({ fetch, workspace, bbAuth, log, syncCache, timeoutMs = 30000, maxConcurrent = 4, now = () => Date.now() }) {
    const conflictsLimiter = createLimiter(maxConcurrent);

    async function fetchBitbucketJson(url) {
        const response = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                'Authorization': `Basic ${bbAuth}`,
                'Accept': 'application/json'
            }
        });
        if (!response.ok) {
            await response.arrayBuffer().catch(() => {}); // release the socket
            throw new Error(`Request failed with status code ${response.status}`);
        }
        return response.json();
    }

    // Returns a Map of touched file path -> {status, sidePath, linesAdded, linesRemoved} for one side of a merge.
    // Bitbucket's diffstat/{a}..{b} is a topic (three-dot) diff: changes on side `a` since merge-base(a, b).
    // Renamed files are keyed by their old path (so both sides match) but read from their new path.
    async function fetchDiffstatFiles(repoName, sideCommit, otherCommit) {
        const files = new Map();
        let url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/diffstat/${sideCommit}..${otherCommit}?pagelen=500`;
        while (url) {
            const page = await fetchBitbucketJson(url);
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
    async function fetchPatch(repoName, sideCommit, otherCommit, filePaths) {
        const files = new Map();
        for (let i = 0; i < filePaths.length; i += filesPerPatchRequest) {
            const paths = new Set(filePaths.slice(i, i + filesPerPatchRequest).flat());
            const query = [...paths].map(p => `path=${encodeURIComponent(p)}`).join('&');
            const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/diff/${sideCommit}..${otherCommit}?topic=true&${query}`;
            const response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(timeoutMs),
                headers: { 'Authorization': `Basic ${bbAuth}` }
            });
            if (!response.ok) {
                await response.arrayBuffer().catch(() => {}); // release the socket
                throw new Error(`Request failed with status code ${response.status}`);
            }
            for (const [basePath, file] of parseUnifiedDiff(await response.text())) {
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
    async function computeConflicts(repoName, spec) {
        const startTime = now();
        const [destCommit, sourceCommit] = spec.split('..');

        const sourceFiles = await fetchDiffstatFiles(repoName, sourceCommit, destCommit);
        if (sourceFiles.size === 0) return { conflicts: false };
        const destFiles = await fetchDiffstatFiles(repoName, destCommit, sourceCommit);
        const { conflicting, toCheck } = decideFromDiffstat(sourceFiles, destFiles);
        const known = [...conflicting].sort();
        if (toCheck.length > maxFilesToCheck) {
            const reason = `too many files to check (${toCheck.length})`;
            log.error(`Conflict check for ${repoName} ${spec}: ${reason}, the limit is ${maxFilesToCheck}`);
            return known.length > 0 ? { conflicts: true, files: known, reason } : { error: true, reason };
        }

        const files = new Set(known);
        if (toCheck.length > 0) {
            try {
                // The base path and the path on each side: a renamed file is found under both
                const filePaths = toCheck.map(basePath => [basePath, sourceFiles.get(basePath).sidePath, destFiles.get(basePath).sidePath]);
                const [sourcePatch, destPatch] = await Promise.all([
                    fetchPatch(repoName, sourceCommit, destCommit, filePaths),
                    fetchPatch(repoName, destCommit, sourceCommit, filePaths)
                ]);
                for (const basePath of toCheck) {
                    checkPatch(basePath, sourcePatch, sourceFiles);
                    checkPatch(basePath, destPatch, destFiles);
                }
                for (const file of conflictingFiles(sourcePatch, destPatch)) files.add(file);
            } catch (error) {
                // Nothing known yet: the caller reports the pull request not checked
                if (known.length === 0) throw error;
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
     * @param {string} projectName - for the summary log line
     * @param {object[]} pullRequests - Bitbucket pull requests
     * @returns {Promise<Record<string, { conflicts: boolean, files?: string[], reason?: string } | { error: true, reason: string }>>}
     */
    async function computeSyncStatuses(projectName, pullRequests) {
        const statuses = {};
        let computed = 0;
        await Promise.all(pullRequests.map(async (pullRequest) => {
            const repoName = pullRequest.source.repository.name;
            const spec = `${pullRequest.destination.commit?.hash}..${pullRequest.source.commit?.hash}`;
            if (spec.includes('undefined')) {
                return; // no commit hashes to compare, the frontend flags these as invalid
            }

            const key = `${repoName}/${spec}`;
            // A result stored under another version of the conflict rule is not reused
            const cacheKey = `${conflictRuleVersion}:${key}`;
            try {
                let result = syncCache.get(cacheKey);
                if (!result) {
                    computed++;
                    result = await conflictsLimiter(() => computeConflicts(repoName, spec));
                    // Complete results only: a failure or a partial SYNC is computed again at the next load
                    if (!result.error && !result.reason) syncCache.set(cacheKey, result);
                }
                statuses[key] = result;
            } catch (error) {
                if (!(error instanceof RateLimitError)) {
                    log.error(`Error computing sync status for ${repoName} ${spec}: ${error.message}`);
                }
                statuses[key] = { error: true, reason: failureReason(error) };
            }
        }));
        await syncCache.save().catch(error => log.error(`sync-cache.json not written: ${error.message}`));
        const results = Object.values(statuses);
        const notChecked = results.filter(status => status.error).length;
        const partlyChecked = results.filter(status => status.conflicts && status.reason).length;
        log.performance(`Sync statuses of ${projectName} - ${results.length} pull requests, ${computed} computed, ${notChecked} not checked, ${partlyChecked} partly checked`);
        return statuses;
    }

    return { computeConflicts, computeSyncStatuses };
}
