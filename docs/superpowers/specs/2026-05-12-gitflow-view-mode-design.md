# GitFlow View Mode Design

## Goal

Add a GitFlow-oriented graph layout mode to Git Graph so that users can understand branch strategy more easily than in a pure time-ordered lane layout. The existing visual design, commit table, context menus, colors, and interaction model should stay intact. The feature changes how graph lanes are assigned, not how the extension looks.

The default graph layout mode will be `GitFlow`.

The feature must feel native to the forked Git Graph extension. Existing users should not experience the mode as a separate visual product or a diagram overlay. It is the same Git Graph view with a different lane placement strategy.

## Motivation

The current graph is good for inspecting commit chronology, but it can be hard for new developers to see a repository's branching strategy. In GitFlow-style repositories, the important structure is usually the relationship between long-lived `master/main`, `develop`, short-lived release/hotfix work, and feature work. A role-based lane layout should make that structure visible without replacing the existing Git Graph experience.

## User-Facing Behavior

The extension will support two graph layout modes:

- `GitFlow`: the default mode. Lanes are grouped by inferred GitFlow role.
- `Default`: the existing automatic lane layout.

In GitFlow mode, lanes are ordered left to right:

1. `master` / `main`
2. `release` / `hotfix`
3. `develop`
4. `features`

The graph remains vertical by commit order. Commit rows, labels, hover behavior, commit details, file actions, and context menus continue to behave as they do today.

Design continuity requirements:

- Do not add colored background bands, swimlanes, large headers, or diagram-style labels to the graph.
- Do not change the existing graph stroke style, vertex style, spacing rhythm, row highlighting, typography, or commit table layout unless required for correctness.
- Do not introduce a separate visual legend into the main graph area for the first version.
- Any mode control should use the existing control-bar and settings-widget patterns rather than a new UI style.
- Existing branch colors remain governed by the current graph color configuration. GitFlow roles do not get hard-coded colors in the first version.

## Classification Rules

Classification is heuristic. The feature is intended to improve readability of a GitFlow strategy, not reconstruct deleted branch history perfectly.

`master` / `main`:

- Prefer an existing local branch named `master` or `main`.
- If neither local branch exists, fall back to visible remote branches named `origin/master` or `origin/main`.
- If both names exist, prefer the checked-out branch when it is one of them, otherwise prefer `main`.
- The main role is assigned to commits on the chosen branch's first-parent chain.

`develop`:

- Prefer an existing local branch named `develop`.
- Fall back to `dev` if `develop` does not exist.
- If neither local branch exists, fall back to visible remote branches named `origin/develop` or `origin/dev`.
- The develop role is assigned to commits on the chosen branch's first-parent chain.

`release` / `hotfix`:

- A side path is a release/hotfix candidate when it is merged into both main and develop.
- Merge commit summaries are allowed as a supporting signal. Branch names parsed from common merge messages such as `release/*`, `hotfix/*`, or `bugfix/*` strengthen this classification.
- Message parsing must not be the only requirement for correctness. If messages are modified or unavailable, the structural merge pattern should still be used where possible.

`features`:

- Any side path that does not classify as main, develop, or release/hotfix is treated as feature work.
- Ambiguous paths fall back to feature lanes so the graph remains usable.

## Architecture

The implementation should keep the current host/webview split.

`src/dataSource.ts` continues to provide commit, parent, ref, tag, remote, and stash data. If GitFlow layout needs additional information not currently sent to the webview, extend the existing `loadCommits` response with minimal metadata rather than introducing a separate fetch path.

`src/types.ts` defines a new graph layout mode type and carries it through `GitGraphViewConfig`.

`src/config.ts` reads the new setting and defaults it to `GitFlow`.

`src/gitGraphView.ts` passes the graph layout mode to the webview in the initial state, following the existing config transfer pattern.

`web/main.ts` stores the selected mode as part of view state and passes it to graph rendering.

`web/graph.ts` owns the layout behavior. The existing lane assignment remains available for `Default`. GitFlow mode adds a classifier and lane allocator that assign branch paths into role groups before rendering with the existing SVG drawing code.

No new rendering surface should be introduced for GitFlow mode. The implementation should reuse the current SVG path and vertex rendering methods so visual differences are limited to horizontal lane placement.

## Layout Strategy

The first implementation should avoid a full rewrite of graph drawing. It should add a role-aware lane choice layer around the current `Graph` / `Vertex` / `Branch` model.

The GitFlow layout should:

- Preserve the existing commit order.
- Compute first-parent chains for main and develop from loaded commits.
- Classify graph paths by role before assigning their `x` coordinate.
- Allocate separate columns inside each role group when multiple branches overlap.
- Keep current color selection behavior unless a future design explicitly introduces role colors.

When classification cannot be completed from the loaded commit window, the algorithm should fall back locally:

- Known main/develop first-parent commits stay in their role lanes.
- Unclassified side paths are placed in feature lanes.
- The graph should not hide commits simply because classification is incomplete.

## Merge Message Parsing

Merge summary parsing is a supporting signal only. It can recognize common forms used by Git, GitHub, GitLab, Bitbucket, and Gitea, but the first implementation can start with a small set:

- `Merge branch 'name'`
- `Merge branch 'name' into ...`
- `Merge pull request #123 from owner/name`
- `Merged in name (pull request #123)`

Only branch names matching `release/*`, `hotfix/*`, or `bugfix/*` should upgrade a side path toward release/hotfix classification. Names matching `feature/*` should keep or confirm feature classification.

## Configuration

Add this setting:

```json
"git-graph.graph.layout": {
  "type": "string",
  "enum": ["GitFlow", "Default"],
  "default": "GitFlow"
}
```

Documentation and README setting summaries should mention that GitFlow layout is heuristic and can be switched back to the existing default layout.

## Error Handling

The layout classifier should never surface errors for normal ambiguous history. In GitFlow mode, ambiguous side paths should fall back to feature lanes.

Only invalid configuration values should fall back silently to `GitFlow`, matching existing config getter patterns.

## Testing

Add focused unit coverage where the existing test structure allows it:

- Config parsing returns `GitFlow` by default and `Default` when configured.
- Main and develop first-parent chains are identified correctly from synthetic commit graphs.
- A side path merged into both main and develop classifies as release/hotfix.
- Merge message parsing recognizes release/hotfix/bugfix names as supporting signals.
- Unclassified paths fall back to feature.
- Default layout mode preserves current behavior.

Graph rendering should also be manually verified in VS Code with at least one GitFlow-like repository and one non-GitFlow repository.

## Out of Scope

- Changing the visual style of Git Graph.
- Adding colored background bands like conceptual GitFlow diagrams.
- Supporting arbitrary user-defined branching models in the first version.
- Perfect recovery of deleted branch history.
- Replacing the existing commit ordering options.
