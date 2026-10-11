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
 * @param {() => Promise<{ data: any, ttl?: number }>} build - the value and its TTL in seconds (the default TTL when undefined)
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
            const { data, ttl } = await build();
            cache.set(key, data, ttl);
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
 * or fetch from source. The fetch function decides the TTL so that responses
 * built during an Atlassian rate-limit window can be kept until it closes.
 * @param {string} projectName - Project identifier
 * @param {function} fetchSyncStatuses - Async function returning { data, ttl } on cache miss (ttl in seconds)
 * @returns {Promise<Object>} Sync statuses data
 */
export async function getCachedSyncStatuses(projectName, fetchSyncStatuses) {
    return getOrBuild(CACHE_KEYS.SYNC_STATUSES(projectName), fetchSyncStatuses);
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