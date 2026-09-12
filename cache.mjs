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

/**
 * Generic function to get or set cache with async data fetching
 * @param {string} key - Cache key
 * @param {function} fetchData - Async function to fetch data if cache miss
 * @param {number} [ttl] - Optional TTL in seconds
 * @returns {Promise<any>} Cached or freshly fetched data
 */
async function getOrSetCache(key, fetchData, ttl = undefined) {
    const cachedData = cache.get(key);
    if (cachedData !== undefined) {
        return cachedData;
    }

    const freshData = await fetchData();
    cache.set(key, freshData, ttl);
    return freshData;
}

/**
 * Get projects list from cache or fetch from source
 * @param {function} fetchProjects - Function to fetch projects if cache miss
 * @returns {Promise<Array>} List of projects
 */
export async function getCachedProjects(fetchProjects) {
    return getOrSetCache(CACHE_KEYS.PROJECTS_LIST, fetchProjects, 300); // 5 minutes TTL
}

/**
 * Get project data from cache or fetch from source
 * @param {string} projectName - Project identifier
 * @param {function} fetchProjectData - Function to fetch project data if cache miss
 * @returns {Promise<Object>} Project data
 */
export async function getCachedProjectData(projectName, fetchProjectData) {
    return getOrSetCache(CACHE_KEYS.PROJECT_DATA(projectName), fetchProjectData);
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
    const key = CACHE_KEYS.SYNC_STATUSES(projectName);
    const cachedData = cache.get(key);
    if (cachedData !== undefined) {
        return cachedData;
    }

    const { data, ttl } = await fetchSyncStatuses();
    cache.set(key, data, ttl);
    return data;
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