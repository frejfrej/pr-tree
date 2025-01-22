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
    CONFLICTS: (repoName, spec) => `conflicts_${repoName}_${spec}`,
    SPRINTS: (projectName) => `sprints_${projectName}`,
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
 * Get conflicts data from cache or fetch from source
 * @param {string} repoName - Repository name
 * @param {string} spec - Specification string
 * @param {function} fetchConflicts - Function to fetch conflicts if cache miss
 * @returns {Promise<Object>} Conflicts data
 */
export async function getCachedConflicts(repoName, spec, fetchConflicts) {
    return getOrSetCache(CACHE_KEYS.CONFLICTS(repoName, spec), fetchConflicts, 300);
}

/**
 * Get sprints data from cache or fetch from source
 * @param {string} projectName - Project identifier
 * @param {function} fetchSprints - Function to fetch sprints if cache miss
 * @returns {Promise<Array>} Sprints data
 */
export async function getCachedSprints(projectName, fetchSprints) {
    return getOrSetCache(CACHE_KEYS.SPRINTS(projectName), fetchSprints, 600); // 10 minutes TTL
}

/**
 * Clear specific cache entry
 * @param {string} key - Cache key to clear
 */
export function clearCache(key) {
    cache.del(key);
}

/**
 * Clear all cache entries
 */
export function clearAllCache() {
    cache.flushAll();
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
    return cache.getStats();
}