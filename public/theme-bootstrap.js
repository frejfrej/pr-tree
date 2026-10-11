/**
 * The theme and the sidebar state, set before the stylesheet applies, so
 * neither the theme nor a hidden sidebar flashes on load. A classic script
 * loaded by index.html's <head>, not a module: it must run before the first
 * paint. Its own file rather than inline, so the Content-Security-Policy
 * needs no 'unsafe-inline' (#110).
 */
(function () {
    var theme = null;
    var sidebarHidden = null;
    try {
        theme = localStorage.getItem('prTree.theme');
        sidebarHidden = localStorage.getItem('prTree.sidebarHidden');
    } catch (error) { /* storage unavailable */ }
    var root = document.documentElement;
    if (theme !== 'light' && theme !== 'dark') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    root.dataset.theme = theme;
    if (sidebarHidden === 'true' || !window.matchMedia('(min-width: 900px)').matches) {
        root.classList.add('sidebar-hidden');
    }
})();
