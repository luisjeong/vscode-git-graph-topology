# GitFlow View Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitFlow-oriented graph layout mode that is enabled by default and arranges graph lanes left-to-right as `master/main/trunk`, `release/hotfix`, `develop/dev`, then `feature`, while preserving Git Graph's existing visual language.

**Architecture:** Classify commits into GitFlow lane families in a tested extension-host helper, include that metadata in `loadCommits` responses, and let the webview graph renderer use those role hints only when selecting x coordinates. Existing SVG path rendering, colours, vertex styling, row ordering, table columns, labels, menus, and interactions stay unchanged.

**Tech Stack:** TypeScript, VS Code extension API, browser SVG webview scripts compiled with `module: none`, Jest, existing npm scripts.

---

## Current Constraints

- The renderer in `web/graph.ts` already owns branch path construction through `Vertex`, `Branch`, and `Graph.determinePath`.
- The webview script consumes backend types through `web/global.d.ts`, so new response metadata must be declared in `src/types.ts` and compiled before web compilation.
- Existing graph width is computed from the largest vertex x coordinate. GitFlow grouping can widen the graph naturally; the current scroll/width behavior should be reused.
- The concept image is not a design target. Do not add swimlane backgrounds, category labels, legends, or new graph colours.
- Commit rows remain ordered by the existing commit ordering setting. This feature only changes branch lane placement.

## File Structure

```text
src/types.ts
  Add GraphLayoutMode, GitFlowLaneFamily, GitFlowCommitLayout, GitFlowLayoutData.
  Add GraphConfig.layout.
  Add ResponseLoadCommits.gitFlowLayout.

src/config.ts
  Read git-graph.graph.layout with default "gitflow".

src/dataSource.ts
  Compute GitFlow layout metadata after commit nodes are assembled.
  Include metadata in GitCommitData and ResponseLoadCommits.

src/gitFlowLayout.ts
  New pure helper for GitFlow classification.

src/gitGraphView.ts
  Pass gitFlowLayout from data source into loadCommits response messages.

web/main.ts
  Store gitFlowLayout in webview state.
  Pass gitFlowLayout to Graph.loadCommits.

web/graph.ts
  Use GitFlow lane families to bias x-coordinate allocation.
  Keep existing Branch.draw and Vertex.draw output unchanged.

package.json
  Add git-graph.graph.layout setting with default "gitflow".

tests/gitFlowLayout.test.ts
  New focused unit tests for classification.

tests/config.test.ts
  Add coverage for graph.layout default and explicit standard mode.
```

## Data Model

Add these public types in `src/types.ts` near existing graph configuration types:

```ts
export const enum GraphLayoutMode {
	GitFlow = 'gitflow',
	Standard = 'standard'
}

export const enum GitFlowLaneFamily {
	Main = 'main',
	ReleaseHotfix = 'release-hotfix',
	Develop = 'develop',
	Feature = 'feature'
}

export interface GitFlowCommitLayout {
	readonly hash: string;
	readonly lane: GitFlowLaneFamily;
}

export interface GitFlowLayoutData {
	readonly commits: ReadonlyArray<GitFlowCommitLayout>;
	readonly mainHead: string | null;
	readonly developHead: string | null;
}
```

Extend existing interfaces:

```ts
export interface GraphConfig {
	readonly colours: ReadonlyArray<string>;
	readonly style: GraphStyle;
	readonly layout: GraphLayoutMode;
	readonly grid: { x: number, y: number, offsetX: number, offsetY: number, expandY: number };
	readonly uncommittedChanges: GraphUncommittedChangesStyle;
}

export interface ResponseLoadCommits extends ResponseWithErrorInfo {
	readonly command: 'loadCommits';
	readonly refreshId: number;
	readonly commits: GitCommit[];
	readonly head: string | null;
	readonly tags: string[];
	readonly moreCommitsAvailable: boolean;
	readonly onlyFollowFirstParent: boolean;
	readonly gitFlowLayout: GitFlowLayoutData | null;
}
```

## Classification Rules

Implement `src/gitFlowLayout.ts` with deterministic, in-memory classification:

```ts
import { GitCommit, GitFlowLaneFamily, GitFlowLayoutData } from './types';

export function computeGitFlowLayout(commits: ReadonlyArray<GitCommit>, head: string | null): GitFlowLayoutData {
	// Build hash lookup, select main/develop heads from refs, trace first-parent chains,
	// classify side branches, then return one lane family per visible commit.
}
```

Rules, in priority order:

- Normalize local heads and remotes to their short names. `origin/main`, `upstream/main`, and `main` should all match `main`.
- Main candidates: exact `master`, `main`, `trunk`.
- Develop candidates: exact `develop`, `dev`.
- Prefer local branch heads over remote branch heads when both exist.
- If no main candidate exists, fall back to `head` when provided and visible.
- Trace first-parent chains from selected main and develop heads through loaded commits.
- Commits on the selected main chain are `GitFlowLaneFamily.Main`.
- Commits on the selected develop chain are `GitFlowLaneFamily.Develop` unless already classified as `Main`.
- For each merge commit, trace each non-first parent side path until it reaches an already-classified commit, a missing parent, or the loaded history boundary.
- A side path is `ReleaseHotfix` when any of these are true:
  - a visible ref on the path starts with `release/`, `release-`, `hotfix/`, or `hotfix-`;
  - a merge commit message contains a release/hotfix branch token such as `release/1.2.0` or `hotfix/login`;
  - the same side path is merged into both the main chain and the develop chain within the loaded commit window.
- Side paths not classified as `ReleaseHotfix` stay `Feature`.
- Stash and uncommitted pseudo-commits stay `Feature` unless the existing renderer marks them specially.

Use hash sets and arrays only. Do not call Git from this helper.

## Tasks

- [ ] Add failing tests for GitFlow classification.

Create `tests/gitFlowLayout.test.ts`. Use small synthetic commit arrays so the expected lane families are readable.

Required test cases:

```ts
describe('computeGitFlowLayout', () => {
	it('classifies first-parent main and develop chains');
	it('uses main/master/trunk and develop/dev exact branch names');
	it('prefers local branch refs over remote refs');
	it('classifies a branch merged into both main and develop as release-hotfix');
	it('classifies release and hotfix ref names as release-hotfix');
	it('uses merge message branch names as a supporting release-hotfix signal');
	it('keeps branches merged only into develop as feature');
	it('falls back to HEAD when no main branch ref is visible');
});
```

Run:

```powershell
npm test -- --runInBand tests/gitFlowLayout.test.ts
```

Expected result before implementation: TypeScript/Jest fails because `src/gitFlowLayout.ts` does not exist.

- [ ] Implement `src/gitFlowLayout.ts`.

Implementation details:

- Keep helper functions private: `normaliseBranchName`, `getVisibleRefs`, `selectHead`, `traceFirstParent`, `traceSidePath`, `branchLooksReleaseHotfix`, `getMergeTargetFamily`.
- Return `commits` as an array rather than a hash map so the response stays JSON-simple and stable.
- Build an internal `Map<string, GitFlowLaneFamily>` and serialize it at the end:

```ts
return {
	commits: commits.map((commit) => ({
		hash: commit.hash,
		lane: laneByHash.get(commit.hash) || GitFlowLaneFamily.Feature
	})),
	mainHead,
	developHead
};
```

Run:

```powershell
npm test -- --runInBand tests/gitFlowLayout.test.ts
```

Expected result: new classifier tests pass.

- [ ] Add graph layout mode types and configuration.

Update `src/types.ts` with `GraphLayoutMode`, `GitFlowLaneFamily`, `GitFlowCommitLayout`, `GitFlowLayoutData`, `GraphConfig.layout`, and `ResponseLoadCommits.gitFlowLayout`.

Update `src/config.ts`:

```ts
import {
	GraphConfig,
	GraphLayoutMode,
	GraphStyle,
	GraphUncommittedChangesStyle,
	...
} from './types';
```

Inside `get graph()`:

```ts
layout: this.config.get<string>('graph.layout', 'gitflow') === 'standard'
	? GraphLayoutMode.Standard
	: GraphLayoutMode.GitFlow,
```

Update `package.json` beside existing `git-graph.graph.style`:

```json
"git-graph.graph.layout": {
	"type": "string",
	"enum": [
		"gitflow",
		"standard"
	],
	"enumDescriptions": [
		"Arrange lanes by GitFlow branch family: master/main/trunk, release/hotfix, develop/dev, then feature.",
		"Use Git Graph's existing lane allocation behavior."
	],
	"default": "gitflow",
	"description": "Specifies how branch lanes are arranged in the graph."
}
```

Add `tests/config.test.ts` assertions:

- default `config.graph.layout` is `GraphLayoutMode.GitFlow`;
- explicit `"git-graph.graph.layout": "standard"` maps to `GraphLayoutMode.Standard`;
- unknown values fall back to `GraphLayoutMode.GitFlow`.

Run:

```powershell
npm test -- --runInBand tests/config.test.ts tests/gitFlowLayout.test.ts
```

- [ ] Thread GitFlow metadata through backend responses.

Update imports and `GitCommitData` in `src/dataSource.ts`:

```ts
import { computeGitFlowLayout } from './gitFlowLayout';
import { GitFlowLayoutData, GraphLayoutMode, ... } from './types';

interface GitCommitData {
	commits: GitCommit[];
	head: string | null;
	tags: string[];
	moreCommitsAvailable: boolean;
	gitFlowLayout: GitFlowLayoutData | null;
	error: ErrorInfo;
}
```

After `commitNodes` is built:

```ts
const graphLayout = getConfig(repo).graph.layout;
const gitFlowLayout = graphLayout === GraphLayoutMode.GitFlow
	? computeGitFlowLayout(commitNodes, refData.head)
	: null;
```

Return `gitFlowLayout` with both success and error paths:

```ts
return {
	commits: commitNodes,
	head: refData.head,
	tags: unique(refData.tags.map((tag) => tag.name)),
	moreCommitsAvailable,
	gitFlowLayout,
	error: null
};
```

Update `src/gitGraphView.ts` load-commits response construction to include `gitFlowLayout: data.gitFlowLayout`.

Run:

```powershell
npm test -- --runInBand tests/gitFlowLayout.test.ts
npm run compile-src
```

- [ ] Store and pass GitFlow metadata in the webview.

Update `web/global.d.ts` state:

```ts
readonly gitFlowLayout: GG.GitFlowLayoutData | null;
```

Update `web/main.ts`:

- add private field `gitFlowLayout: GG.GitFlowLayoutData | null = null;`;
- restore it from `prevState`;
- pass it through `loadCommits`;
- save it in `saveState`;
- clear it in `clearCommits`;
- read it from `ResponseLoadCommits`.

Change signatures:

```ts
private loadCommits(
	commits: GG.GitCommit[],
	commitHead: string | null,
	tags: ReadonlyArray<string>,
	moreAvailable: boolean,
	onlyFollowFirstParent: boolean,
	gitFlowLayout: GG.GitFlowLayoutData | null
) { ... }
```

Call graph:

```ts
this.graph.loadCommits(this.commits, this.commitHead, this.commitLookup, this.onlyFollowFirstParent, this.gitFlowLayout);
```

Run:

```powershell
npm run compile-web
```

- [ ] Bias graph x-coordinate allocation by GitFlow lane family.

Update `web/graph.ts` without changing SVG drawing code.

Add fields:

```ts
private gitFlowLaneByHash: { [hash: string]: GG.GitFlowLaneFamily } = {};
private static readonly GIT_FLOW_GROUP_MIN_X: { [lane: string]: number } = {
	[GG.GitFlowLaneFamily.Main]: 0,
	[GG.GitFlowLaneFamily.ReleaseHotfix]: 4,
	[GG.GitFlowLaneFamily.Develop]: 8,
	[GG.GitFlowLaneFamily.Feature]: 12
};
```

Update `Vertex` point allocation so explicit larger x coordinates are recorded:

```ts
public getNextPointFrom(minX: number): Point {
	let x = Math.max(this.nextX, minX);
	while (typeof this.connections[x] !== 'undefined') x++;
	return { x, y: this.id };
}

public registerUnavailablePoint(x: number, connectsToVertex: VertexOrNull, onBranch: Branch) {
	this.connections[x] = { connectsTo: connectsToVertex, onBranch: onBranch };
	if (x === this.nextX) {
		while (typeof this.connections[this.nextX] !== 'undefined') this.nextX++;
	}
}
```

Add helpers to `Graph`:

```ts
private getGitFlowLaneFamily(index: number): GG.GitFlowLaneFamily {
	const commit = this.commits[index];
	return commit && this.gitFlowLaneByHash[commit.hash] || GG.GitFlowLaneFamily.Feature;
}

private getNextPointForLane(vertex: Vertex, lane: GG.GitFlowLaneFamily): Point {
	if (this.config.layout !== GG.GraphLayoutMode.GitFlow) return vertex.getNextPoint();
	return vertex.getNextPointFrom(Graph.GIT_FLOW_GROUP_MIN_X[lane]);
}
```

Update `Graph.loadCommits` to accept `gitFlowLayout` and build `gitFlowLaneByHash`.

In `determinePath`, replace calls that choose a new free point with `getNextPointForLane` using the start commit's lane family. Keep the existing case that connects to an already placed parent point.

Standard mode must be byte-for-byte behaviorally equivalent in lane choice because `getNextPointForLane` returns `vertex.getNextPoint()` when `config.layout !== GitFlow`.

Run:

```powershell
npm run compile-web
```

- [ ] Verify interactions and layout width behavior.

Manual checks after compile:

- GitFlow mode places main left, release/hotfix next, develop next, features to the right.
- Standard mode still uses the existing compact lane allocation.
- Graph dots, lines, curves, colours, hover tooltips, current commit open circle, stash rendering, and muted commit behavior look unchanged.
- Wider GitFlow graph uses existing horizontal scrolling/width handling and does not overlap commit text.

Run full verification:

```powershell
npm test -- --runInBand
npm run compile
```

If the repository has an existing launch/debug workflow, use VS Code's Extension Development Host to inspect the webview against a sample GitFlow repository. If no launch workflow is available in this environment, record that manual VS Code visual verification was not run.

## Self-Review Checklist

- [ ] No swimlane backgrounds, lane labels, legends, new graph colours, or non-native visual decorations were added.
- [ ] Default setting is GitFlow and the fallback mode is available as `standard`.
- [ ] Release/hotfix classification uses branch names and merge messages only as supporting signals; the main structural signal is merge-into-main plus merge-into-develop within the loaded history.
- [ ] The feature does not issue extra Git commands.
- [ ] Standard mode remains compatible with existing Git Graph users.
- [ ] Tests cover classifier edge cases and configuration defaulting.
- [ ] `npm test -- --runInBand` and `npm run compile` pass before implementation is considered complete.

