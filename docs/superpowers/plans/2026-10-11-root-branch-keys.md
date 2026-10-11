# Root branches keyed by repository and branch — plan

Spec: `docs/superpowers/specs/2026-10-11-root-branch-keys-design.md`.

1. app-render.js: `data-root-branch-key` on `.root-branch`.
2. tree-toggle.js: capture the key; one keyed restore for root branches and
   pull requests.
3. Tests: tree-toggle (fake document), app-render (attribute, escaping,
   fixtures); `npm test`.
4. Manual re-render check on fixture SECOLLAB; README 3.1.2, CLAUDE.md
   pitfall 11, version; pull request closing #103.
