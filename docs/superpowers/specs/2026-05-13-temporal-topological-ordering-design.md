# Temporal Topological Ordering Design

## Goal

Replace the legacy commit ordering contract with a single temporal topological ordering model that makes the modern Git Graph view easier to read, more predictable, and better prepared for future DOM/SVG virtualization.

The ordering must preserve graph topology first: a parent commit must never be displayed above one of its displayed children. When multiple commits are eligible for the next row, the newest commit by timestamp is selected first, with deterministic tie breakers.

## Motivation

The original extension exposes multiple ordering modes that mirror Git log flags: date order, author-date order, and topological order. That made sense for preserving legacy behavior, but this project is intentionally moving toward a new maintained Git Graph extension rather than preserving every old implementation choice.

The current code treats `commits[]` row order as a shared coordinate system across the extension host and the webview. The row order drives:

- graph vertices and branch paths,
- table row generation,
- `commitLookup`,
- keyboard parent/child navigation,
- commit details placement,
- find result navigation,
- scroll restoration,
- GitFlow lane rendering.

Keeping several ordering modes while introducing a new graph model would multiply the number of behavior combinations. A single ordering model is simpler to reason about, test, and optimize.

## Current State

Commit data is loaded in `src/dataSource.ts`.

`DataSource.getCommits()` calls `getLog()` with one of the existing `CommitOrdering` values. `getLog()` passes `--date-order`, `--author-date-order`, or `--topo-order` directly to `git log`, parses the output, enriches it with refs and stashes, and then returns the resulting `commits[]`.

The webview receives that array as the final row model. `web/main.ts` builds `commitLookup` by assigning each hash to its array index. `web/graph.ts` then creates one `Vertex` for each commit index and uses the same index as the SVG/table row coordinate.

## Target Behavior

The application should expose one default commit row order:

1. Build a directed commit graph from loaded commits.
2. Identify commits whose displayed children have all already been placed.
3. Pick the newest eligible commit.
4. Use deterministic tie breakers when timestamps are equal.
5. Repeat until all loaded commits are placed.

This produces a temporal topological order. It should be the only row order used by the main graph, table, find widget, keyboard navigation, commit details, and GitFlow layout.

Existing saved repository settings for commit ordering should not break loading. They can be treated as legacy data and ignored for the main graph order. The UI should no longer encourage switching between legacy ordering modes once the new model is in place.

## Ordering Rules

The algorithm operates on the commits returned by Git for the current query. It does not attempt to load the entire repository history before sorting.

For each loaded commit:

- `hash` identifies the node.
- `parents` identifies outgoing edges to older commits.
- A displayed child is any loaded commit that lists this commit as a parent.
- A commit is eligible when all of its displayed children have already been placed.

Eligible commits are ordered by:

1. timestamp descending,
2. original Git output position ascending,
3. hash ascending.

The original Git output position provides stable behavior when timestamps are tied or missing. Hash ordering prevents non-determinism when both timestamp and original position are equal in tests or synthetic data.

Unloaded parents are treated as graph boundaries. They must not block placement, because a partial history view must remain renderable.

Stash pseudo-commits and the uncommitted changes pseudo-commit should remain at their current semantic positions unless their surrounding code is explicitly redesigned. The first implementation should preserve existing placement behavior for these pseudo-commits and sort normal commits around that preserved behavior.

## Load More Semantics

The first implementation will sort only the currently loaded commit set. This is intentionally scoped.

When more commits are loaded, the row order may be recomputed for the enlarged loaded set. The implementation should avoid relying on old row indexes across a reload. State that needs to survive a reload should be anchored by commit hash.

This is acceptable for the first version because the existing extension already reloads and rebuilds the table/graph after load-more operations. A later virtualization project can introduce anchor-based scroll preservation so that adding more history does not visibly shift the current viewport.

## Architecture

Add a focused ordering module in the extension host, close to the data parsing pipeline:

- `src/commitOrdering.ts`
  - owns temporal topological sorting,
  - exports a pure function that accepts readonly commits and returns a reordered array,
  - has no dependency on VS Code APIs, Git process spawning, or webview code.

`src/dataSource.ts` should call this sorter after parsing Git log output and before attaching refs/stashes that depend on `commitLookup`, or immediately after pseudo-commit handling if preserving pseudo-commit placement requires it. The key rule is that the final `commitNodes` array and the final `commitLookup` must describe the same order.

The webview should continue to receive a single ordered `commits[]` array. The webview should not duplicate ordering logic.

## Data Flow

The intended flow is:

```text
Git log output
  -> parse normal commits
  -> apply temporal topological ordering to normal commits
  -> apply preserved pseudo-commit/stash placement rules
  -> build final commitLookup
  -> attach refs, tags, remotes, and stash metadata
  -> compute GitFlow layout from the final ordered commits
  -> send final ordered commits to webview
```

If investigation shows stash insertion must happen before sorting to preserve existing behavior, the sorter must explicitly document and test how pseudo-commits participate. Silent reliance on array side effects is not acceptable.

## Legacy Ordering Settings

The old `CommitOrdering` and `RepoCommitOrdering` types are currently used by config parsing, repository state import/export, context menus, request messages, tests, and Git log argument construction.

The first implementation should minimize user-facing churn while establishing the new internal model:

- Continue accepting existing config values so old settings do not cause errors.
- Stop passing the selected value through as the final ordering authority.
- Remove or hide the commit ordering context menu section after the new ordering is active.
- Keep import/export validation compatible with existing repository configuration files unless a separate migration removes that field.

This avoids a broken upgrade path while still making temporal topological order the only actual graph row model.

## UI Behavior

The user should see a single, stable graph order. There should be no new option for temporal topological order.

If the context menu still exposes Date, Author Timestamp, and Topological ordering during an intermediate implementation step, that is a temporary compatibility state and not the target design. The final design removes the choice from the main workflow.

## State And Navigation

This project should reduce dependence on stale row indexes where practical, but it does not need to complete the future virtualization rewrite.

Required behavior:

- `commitLookup` must be rebuilt after every ordering pass.
- `expandedCommit.commitHash` remains the source of truth for restoring an expanded commit.
- `expandedCommit.index` may be recomputed from `commitLookup` after reload.
- keyboard parent/child navigation must continue to use graph topology, not adjacent row assumptions.
- `scrollToCommit(hash, ...)` should remain hash based.

Known follow-up:

- `scrollTop` state restoration still restores pixels rather than a hash anchor. That is acceptable for this project but should be called out as a future virtualization prerequisite.

## GitFlow Layout

GitFlow layout should consume the final ordered commit array. It should not calculate lane data against one ordering and render against another.

Because GitFlow lane classification already returns data keyed by commit hash, it can survive row order changes if it is recomputed after sorting and compared by hash. Tests should cover that `gitFlowLayout.commits` aligns with the final ordered commits sent to the webview.

## Error Handling

The sorter should be total and deterministic:

- Missing parent hashes are treated as unloaded boundaries.
- Duplicate commit hashes should keep the first occurrence and leave later duplicates in original relative order, while tests document the chosen behavior.
- Cycles should not occur in Git history, but synthetic input can contain cycles. The sorter should break cycles deterministically by selecting the newest remaining commit and continue rather than hanging.

If cycle recovery is used, it should be internal and should not surface user-facing errors. Git itself should prevent real cyclic commit histories.

## Testing Strategy

Add focused unit tests for the pure sorter before touching integration code.

Sorter cases:

- linear history with shuffled dates still places children before parents,
- two eligible branch heads choose the newest timestamp first,
- equal timestamps use original order then hash,
- unloaded parents do not block placement,
- merge commits are placed before all displayed parents,
- synthetic cycles terminate deterministically,
- pseudo-commit handling preserves existing uncommitted/stash expectations if pseudo-commits are included in the sorter.

Integration cases:

- `DataSource.getCommits()` returns temporal topological order even when Git output is date-skewed.
- `commitLookup` is rebuilt from the final order before refs/tags/remotes/stashes are attached.
- GitFlow layout is computed from the final order.
- existing request/response tests are updated so the webview receives a single ordered model.

Regression checks:

```powershell
npm run compile
npm test -- --runInBand tests/commitOrdering.test.ts tests/dataSource.test.ts tests/gitGraphView.test.ts
npm test -- --runInBand
```

## Rollout

This should be implemented as an architectural change on the new extension branch, not as a small hidden option.

Recommended sequence:

1. Add the pure sorter and tests.
2. Integrate it in `DataSource.getCommits()`.
3. Rebuild affected `DataSource` expectations.
4. Remove or hide ordering UI entry points.
5. Update config/repo import behavior to accept but not promote legacy ordering.
6. Verify GitFlow layout and webview state restoration behavior.
7. Document any remaining row-index assumptions as follow-up work for virtualization.

## Acceptance Criteria

- The main commit graph uses temporal topological order as its only effective row order.
- No new user-facing ordering option is added.
- Existing saved ordering settings do not break repository loading.
- The context menu no longer presents legacy ordering choices in the final state.
- Parent commits are never displayed above displayed child commits.
- Equal-date and partial-history cases are deterministic.
- GitFlow layout still renders from the same ordered commit model as the table and graph.
- Compile and full Jest pass.

## Risks

Load-more can reorder rows when the loaded set expands. This already happens through full reloads, but the behavior may become more visible when timestamps are skewed. A future hash-anchor scroll restoration project should address this.

Removing visible ordering choices is a user-facing behavior change. This is consistent with the new-extension direction, but release notes should explain that the graph now uses one stable topology-preserving order.

The current worktree shows EOL-only modified files after checkout because the repository stores CRLF TypeScript blobs and the local Git configuration has CRLF conversion behavior. Implementation commits must avoid mixing EOL-only churn with ordering changes.
