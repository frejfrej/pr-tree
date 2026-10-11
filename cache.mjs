// cache.mjs
import NodeCache from 'node-cache';

// Initialize cache with default TTL of 2 minutes (120 seconds)
const cache = new NodeCache({
    stdTTL: 120,
    checkperiod: 60, // Check for expired keys every 60 seconds
    useClones: false // Store references instead of cloning objects
});

// Cache keys for different types of data
const CACHE_KEYS = {
    PROJECT_DATA: (projectName) => `project_${projectName}`,
    SYNC_STATUSES: (projectName) => `sync_statuses_${projectName}`,
    PROJECTS_LIST: 'projects_list'
};

// The builds in flight, by cache key
const pendingBuilds = new Map();

/**
 * The cached value of a key, or the value built on a miss. Concurrent calls
 * for one key share one build: a second browser tab, or the SYNC load during
 * a page load, would otherwise send every Atlassian request of the build again.
 * A failure (a RateLimitError included) reaches every call sharing the build
 * and is not cached: the next call builds again.
 * @param {string} key - Cache key
 * @param {() => Promise<{ data: any, ttl?: number, keep?: boolean }>} build - the value and its TTL in seconds (the default TTL when undefined); `keep: false` caches nothing, the calls sharing the build still get the value
 * @returns {Promise<any>} Cached or freshly built data
 */
async function getOrBuild(key, build) {
    const cachedData = cache.get(key);
    if (cachedData !== undefined) {
        return cachedData;
    }

    let pending = pendingBuilds.get(key);
    if (!pending) {
        pending = (async () => {
            const { data, ttl, keep = true } = await build();
            if (keep) cache.set(key, data, ttl);
            return data;
        })().finally(() => pendingBuilds.delete(key));
        pendingBuilds.set(key, pending);
    }
    return pending;
}

/**
 * Get projects list from cache or fetch from source
 * @param {function} fetchProjects - Function to fetch projects if cache miss
 * @returns {Promise<Array>} List of projects
 */
export async function getCachedProjects(fetchProjects) {
    return getOrBuild(CACHE_KEYS.PROJECTS_LIST, async () => ({ data: await fetchProjects(), ttl: 300 })); // 5 minutes TTL
}

// The TTL of project data a tolerated Jira failure left with gaps (its
// `incomplete`, project-data.mjs): short, so the next request after it retries
// the failed part, but long enough for the SYNC load started after a page load
const partialProjectDataTtl = 30;

/**
 * Get project data from cache or fetch from source: kept for the default TTL,
 * or for 30 seconds when it names gaps in `incomplete`
 * @param {string} projectName - Project identifier
 * @param {function} fetchProjectData - Function to fetch project data if cache miss
 * @returns {Promise<Object>} Project data
 */
export async function getCachedProjectData(projectName, fetchProjectData) {
    return getOrBuild(CACHE_KEYS.PROJECT_DATA(projectName), async () => {
        const data = await fetchProjectData();
        return { data, ttl: data?.incomplete?.length ? partialProjectDataTtl : undefined };
    });
}

/**
 * Get sync statuses (conflicts for every pull request of a project) from cache
 * or fetch from source. The fetch function decides the TTL: the server keeps
 * only the responses built during an Atlassian rate-limit window, until it
 * closes; the calls made while a computation runs share it either way.
 * @param {string} projectName - Project identifier
 * @param {function} fetchSyncStatuses - Async function returning { data, ttl, keep } on cache miss (ttl in seconds, keep false to cache nothing)
 * @returns {Promise<Object>} Sync statuses data
 */
export async function getCachedSyncStatuses(projectName, fetchSyncStatuses) {
    return getOrBuild(CACHE_KEYS.SYNC_STATUSES(projectName), fetchSyncStatuses);
}

/**
 * How long a SYNC response is kept (#49): until the end of the rate-limit pause
 * it was built in, so the clicks meanwhile send nothing; outside a pause not at
 * all, so each click on the load button computes again
 * @param {{ rateLimited: boolean, remainingMs: number }} pause - the pause when the response was built (atlassian.pause())
 * @returns {{ ttl: number } | { keep: false }} to spread into the build's answer to getCachedSyncStatuses
 */
export function syncStatusesKeep(pause) {
    return pause.rateLimited ? { ttl: Math.max(1, Math.ceil(pause.remainingMs / 1000)) } : { keep: false };
}

/**
 * Raise the TTL of every cached entry so that nothing expires before the given
 * number of seconds from now. Entries expiring later are left untouched.
 * Used to keep serving cached data while Atlassian requests are paused after an HTTP 429.
 * @param {number} seconds - Minimum remaining TTL in seconds
 */
export function raiseAllCacheTtls(seconds) {
    const target = Date.now() + seconds * 1000;
    for (const key of cache.keys()) {
        const expiry = cache.getTtl(key); // epoch ms, 0 when the key never expires
        if (expiry !== undefined && expiry !== 0 && expiry < target) {
            cache.ttl(key, seconds);
        }
    }
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
    return cache.getStats();
}