# Temporal Topological Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the effective commit row order with one temporal topological ordering model while preserving compatibility with existing saved settings.

**Architecture:** Add a pure extension-host sorter, integrate it into `DataSource.getCommits()` before final `commitLookup` construction, then remove the webview's legacy ordering menu as a user-facing choice. Keep legacy config and repo state parsing compatible, but stop treating those values as the authority for graph row order.

**Tech Stack:** TypeScript, Jest, ts-jest, VS Code extension host code, Git Graph webview TypeScript.

---

## File Structure

- Create `src/commitOrdering.ts`: pure temporal topological sorter for parsed Git commits.
- Create `tests/commitOrdering.test.ts`: focused unit tests for the sorter, including partial histories and cycle recovery.
- Modify `src/dataSource.ts`: call the sorter after Git log parsing and before final `commitLookup` and GitFlow layout construction.
- Modify `tests/dataSource.test.ts`: update Git command expectations and add a date-skewed integration case.
- Modify `web/main.ts`: remove the commit ordering context menu section and stop sending legacy per-repo ordering as the row ordering authority.
- Modify `tests/gitGraphView.test.ts`: update `loadCommits` request expectations.
- Modify `src/config.ts`: keep `commitOrder` compatibility, but return the single effective order.
- Modify `tests/config.test.ts`: update compatibility expectations for old config values.
- Modify `src/repoManager.ts` and `tests/repoManager.test.ts` only if validation rejects legacy saved ordering values after UI removal.

## Implementation Notes

The worktree currently reports many TypeScript files as modified because the project stores CRLF TypeScript blobs and local checkout normalization can create EOL-only differences. Do not mix those changes into feature commits. Before code implementation, clean or recreate the worktree after confirming `git diff --ignore-cr-at-eol` is empty for the noisy files.

The final behavior should not add a new user option. Temporal topological order becomes the only effective graph order.

---

### Task 1: Prepare A Clean Implementation Baseline

**Files:**
- No source files should be changed in this task.

- [ ] **Step 1: Confirm the active branch and worktree**

Run:

```powershell
git branch --show-current
git status --short --branch
```

Expected:

```text
codex/temporal-topological-ordering
```

The status may list many `M` TypeScript files. Continue only if those changes are EOL-only.

- [ ] **Step 2: Verify the dirty files are EOL-only**

Run:

```powershell
git diff --ignore-cr-at-eol --exit-code
if ($LASTEXITCODE -eq 0) { "EOL-only worktree noise" } else { "Content changes exist" }
```

Expected:

```text
EOL-only worktree noise
```

If this prints `Content changes exist`, stop and inspect the diff before continuing.

- [ ] **Step 3: Clean the EOL-only worktree noise**

Run this only after Step 2 confirms the changes are EOL-only:

```powershell
$dirty = git diff --name-only
git restore --worktree -- $dirty
git status --short --branch
```

Expected:

```text
## codex/temporal-topological-ordering
```

If Git immediately marks the files modified again, recreate this worktree from `develop` after setting the repository-local EOL behavior:

```powershell
git config core.autocrlf true
git status --short --branch
```

- [ ] **Step 4: Install dependencies in the new worktree**

Run:

```powershell
npm ci
```

Expected: install completes with exit code `0`.

- [ ] **Step 5: Run a baseline compile**

Run:

```powershell
npm run compile
```

Expected: compile and lint complete with exit code `0`.

Do not commit this task unless a tracked project file was intentionally changed to fix the baseline.

---

### Task 2: Add The Pure Temporal Topological Sorter

**Files:**
- Create: `src/commitOrdering.ts`
- Create: `tests/commitOrdering.test.ts`

- [ ] **Step 1: Write the failing sorter tests**

Create `tests/commitOrdering.test.ts` with:

```typescript
import { orderCommitsTemporallyTopological, TemporalTopologicalCommit } from '../src/commitOrdering';

const commit = (hash: string, parents: string[], date: number): TemporalTopologicalCommit => ({
	hash,
	parents,
	date
});

const hashes = (commits: ReadonlyArray<TemporalTopologicalCommit>) => commits.map((c) => c.hash);

describe('orderCommitsTemporallyTopological', () => {
	it('places children before parents even when parent dates are newer', () => {
		const input = [
			commit('parent', [], 300),
			commit('child', ['parent'], 100)
		];

		expect(hashes(orderCommitsTemporallyTopological(input))).toStrictEqual(['child', 'parent']);
	});

	it('selects the newest eligible branch head first', () => {
		const input = [
			commit('main-parent', [], 10),
			commit('feature-parent', [], 20),
			commit('main-head', ['main-parent'], 100),
			commit('feature-head', ['feature-parent'], 200)
		];

		expect(hashes(orderCommitsTemporallyTopological(input))).toStrictEqual([
			'feature-head',
			'main-head',
			'feature-parent',
			'main-parent'
		]);
	});

	it('uses original position then hash as deterministic tie breakers', () => {
		const input = [
			commit('b', [], 100),
			commit('a', [], 100),
			commit('c', [], 100)
		];

		expect(hashes(orderCommitsTemporallyTopological(input))).toStrictEqual(['b', 'a', 'c']);
	});

	it('does not block on unloaded parents', () => {
		const input = [
			commit('child', ['missing-parent'], 50),
			commit('independent', [], 40)
		];

		expect(hashes(orderCommitsTemporallyTopological(input))).toStrictEqual(['child', 'independent']);
	});

	it('places a merge commit before all displayed parents', () => {
		const input = [
			commit('left-parent', [], 500),
			commit('right-parent', [], 400),
			commit('merge', ['left-parent', 'right-parent'], 100)
		];

		expect(hashes(orderCommitsTemporallyTopological(input))).toStrictEqual([
			'merge',
			'left-parent',
			'right-parent'
		]);
	});

	it('terminates deterministically for synthetic cycles', () => {
		const input = [
			commit('a', ['b'], 10),
			commit('b', ['a'], 20),
			commit('c', [], 15)
		];

		expect(hashes(orderCommitsTemporallyTopological(input))).toStrictEqual(['b', 'c', 'a']);
	});
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```powershell
npx jest --runInBand tests/commitOrdering.test.ts
```

Expected: fail because `src/commitOrdering.ts` does not exist.

- [ ] **Step 3: Add the sorter implementation**

Create `src/commitOrdering.ts` with:

```typescript
export interface TemporalTopologicalCommit {
	readonly hash: string;
	readonly parents: ReadonlyArray<string>;
	readonly date: number;
}

interface QueueEntry<T extends TemporalTopologicalCommit> {
	readonly commit: T;
	readonly originalIndex: number;
}

/**
 * Order commits so displayed children always appear before displayed parents.
 * Among commits that are currently eligible, newer commits appear first.
 */
export function orderCommitsTemporallyTopological<T extends TemporalTopologicalCommit>(commits: ReadonlyArray<T>): T[] {
	const entries = commits.map((commit, originalIndex): QueueEntry<T> => ({ commit, originalIndex }));
	const firstEntryByHash: { [hash: string]: QueueEntry<T> } = {};
	const childHashesByParentHash: { [hash: string]: string[] } = {};
	const remainingDisplayedChildren: { [hash: string]: number } = {};
	const emitted: { [hash: string]: boolean } = {};
	const result: T[] = [];

	for (let i = 0; i < entries.length; i++) {
		const hash = entries[i].commit.hash;
		if (typeof firstEntryByHash[hash] === 'undefined') {
			firstEntryByHash[hash] = entries[i];
			remainingDisplayedChildren[hash] = 0;
		}
	}

	for (let i = 0; i < entries.length; i++) {
		const child = entries[i].commit;
		if (firstEntryByHash[child.hash] !== entries[i]) continue;

		for (let j = 0; j < child.parents.length; j++) {
			const parentHash = child.parents[j];
			if (typeof firstEntryByHash[parentHash] === 'undefined') continue;

			if (typeof childHashesByParentHash[parentHash] === 'undefined') {
				childHashesByParentHash[parentHash] = [];
			}
			childHashesByParentHash[parentHash].push(child.hash);
			remainingDisplayedChildren[parentHash]++;
		}
	}

	const compareEntries = (a: QueueEntry<T>, b: QueueEntry<T>) => {
		if (a.commit.date !== b.commit.date) return b.commit.date - a.commit.date;
		if (a.originalIndex !== b.originalIndex) return a.originalIndex - b.originalIndex;
		return a.commit.hash < b.commit.hash ? -1 : a.commit.hash > b.commit.hash ? 1 : 0;
	};

	const getEligibleEntries = () => entries
		.filter((entry) => firstEntryByHash[entry.commit.hash] === entry && !emitted[entry.commit.hash] && remainingDisplayedChildren[entry.commit.hash] === 0)
		.sort(compareEntries);

	while (result.length < Object.keys(firstEntryByHash).length) {
		let eligible = getEligibleEntries();
		if (eligible.length === 0) {
			eligible = entries
				.filter((entry) => firstEntryByHash[entry.commit.hash] === entry && !emitted[entry.commit.hash])
				.sort(compareEntries);
		}

		const entry = eligible[0];
		emitted[entry.commit.hash] = true;
		result.push(entry.commit);

		const parents = entry.commit.parents;
		for (let i = 0; i < parents.length; i++) {
			const parentHash = parents[i];
			if (typeof remainingDisplayedChildren[parentHash] === 'number' && remainingDisplayedChildren[parentHash] > 0) {
				remainingDisplayedChildren[parentHash]--;
			}
		}

		const duplicateEntries = entries.filter((candidate) => candidate !== entry && candidate.commit.hash === entry.commit.hash);
		for (let i = 0; i < duplicateEntries.length; i++) {
			emitted[duplicateEntries[i].commit.hash] = true;
		}
	}

	return result;
}
```

- [ ] **Step 4: Run the sorter test**

Run:

```powershell
npx jest --runInBand tests/commitOrdering.test.ts
```

Expected: all tests in `tests/commitOrdering.test.ts` pass.

- [ ] **Step 5: Commit the sorter**

Run:

```powershell
git add src/commitOrdering.ts tests/commitOrdering.test.ts
git commit -m "feat: add temporal topological commit ordering"
```

---

### Task 3: Integrate Sorting Into DataSource

**Files:**
- Modify: `src/dataSource.ts`
- Modify: `tests/dataSource.test.ts`

- [ ] **Step 1: Write a failing DataSource integration test**

In `tests/dataSource.test.ts`, add this test inside the `getCommits` describe block, near the existing order tests:

```typescript
it('Should return commits in temporal topological order when commit dates conflict with topology', async () => {
	// Setup
	mockGitSuccessOnce(
		'parentXX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPbXX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPbauthorXX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPbemail@example.comXX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb300XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPbParent\n' +
		'childXX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPbparentXX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPbauthorXX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPbemail@example.comXX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb100XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPbChild'
	);
	mockGitSuccessOnce('parent\nchild');

	// Run
	const result = await dataSource.getCommits('/path/to/repo', null, 300, true, false, false, false, CommitOrdering.Date, [], [], []);

	// Assert
	expect(result.error).toBeNull();
	expect(result.commits.map((commit) => commit.hash)).toStrictEqual(['child', 'parent']);
});
```

If the helper format in this section has a local helper for log output, use that helper instead of duplicating the separator string. Keep the expected hash order exactly `['child', 'parent']`.

- [ ] **Step 2: Run the targeted failing test**

Run:

```powershell
npx jest --runInBand tests/dataSource.test.ts -t "temporal topological order"
```

Expected: fail because the current code preserves Git output order.

- [ ] **Step 3: Import and call the sorter**

In `src/dataSource.ts`, add the import near the existing imports:

```typescript
import { orderCommitsTemporallyTopological } from './commitOrdering';
```

In `getCommits()`, after `moreCommitsAvailable` handling and before uncommitted changes are inserted, add:

```typescript
commits = orderCommitsTemporallyTopological(commits);
```

Keep the uncommitted pseudo-commit insertion after this call so uncommitted changes stay pinned above the checked-out commit, matching current UI semantics.

- [ ] **Step 4: Stop exposing legacy Git log ordering as the final authority**

Change `getLog()` so it no longer receives `order: CommitOrdering` and no longer pushes `'--' + order + '-order'`.

Replace:

```typescript
private getLog(repo: string, branches: ReadonlyArray<string> | null, num: number, includeTags: boolean, includeRemotes: boolean, includeCommitsMentionedByReflogs: boolean, onlyFollowFirstParent: boolean, order: CommitOrdering, remotes: ReadonlyArray<string>, hideRemotes: ReadonlyArray<string>, stashes: ReadonlyArray<GitStash>) {
	const args = ['-c', 'log.showSignature=false', 'log', '--max-count=' + num, '--format=' + this.gitFormatLog, '--' + order + '-order'];
```

With:

```typescript
private getLog(repo: string, branches: ReadonlyArray<string> | null, num: number, includeTags: boolean, includeRemotes: boolean, includeCommitsMentionedByReflogs: boolean, onlyFollowFirstParent: boolean, remotes: ReadonlyArray<string>, hideRemotes: ReadonlyArray<string>, stashes: ReadonlyArray<GitStash>) {
	const args = ['-c', 'log.showSignature=false', 'log', '--max-count=' + num, '--format=' + this.gitFormatLog, '--date-order'];
```

Use `--date-order` as a broad initial Git traversal hint, but treat the internal sorter as the final row ordering authority.

Update the call in `getCommits()` from:

```typescript
this.getLog(repo, branches, maxCommits + 1, showTags && config.showCommitsOnlyReferencedByTags, showRemoteBranches, includeCommitsMentionedByReflogs, onlyFollowFirstParent, commitOrdering, remotes, hideRemotes, stashes)
```

To:

```typescript
this.getLog(repo, branches, maxCommits + 1, showTags && config.showCommitsOnlyReferencedByTags, showRemoteBranches, includeCommitsMentionedByReflogs, onlyFollowFirstParent, remotes, hideRemotes, stashes)
```

Leave the `commitOrdering` parameter on `getCommits()` for now so request message compatibility can be removed in a later task without mixing concerns.

- [ ] **Step 5: Update DataSource expectations**

In `tests/dataSource.test.ts`, update assertions that expect `--author-date-order` or `--topo-order` in the Git arguments to expect `--date-order`.

For example, change:

```typescript
['-c', 'log.showSignature=false', 'log', '--max-count=301', '--format=' + expectedFormat, '--author-date-order', 'master', 'develop', '--']
```

To:

```typescript
['-c', 'log.showSignature=false', 'log', '--max-count=301', '--format=' + expectedFormat, '--date-order', 'master', 'develop', '--']
```

Keep the rest of each expected argument array unchanged.

- [ ] **Step 6: Run DataSource tests**

Run:

```powershell
npx jest --runInBand tests/commitOrdering.test.ts tests/dataSource.test.ts
```

Expected: both suites pass.

- [ ] **Step 7: Commit DataSource integration**

Run:

```powershell
git add src/dataSource.ts tests/dataSource.test.ts
git commit -m "feat: apply temporal topological ordering to commits"
```

---

### Task 4: Remove The Legacy Ordering Menu From The Webview

**Files:**
- Modify: `web/main.ts`
- Modify: `tests/gitGraphView.test.ts`

- [ ] **Step 1: Remove the ordering menu section**

In `web/main.ts`, inside the table column header context menu handler, remove:

```typescript
const commitOrdering = getCommitOrdering(this.gitRepos[this.currentRepo].commitOrdering);
const changeCommitOrdering = (repoCommitOrdering: GG.RepoCommitOrdering) => {
	this.saveRepoStateValue(this.currentRepo, 'commitOrdering', repoCommitOrdering);
	this.refresh(true);
};
```

Then replace the `contextMenu.show()` call's second menu group:

```typescript
[
	{
		title: 'Commit Timestamp Order',
		visible: true,
		checked: commitOrdering === GG.CommitOrdering.Date,
		onClick: () => changeCommitOrdering(GG.RepoCommitOrdering.Date)
	},
	{
		title: 'Author Timestamp Order',
		visible: true,
		checked: commitOrdering === GG.CommitOrdering.AuthorDate,
		onClick: () => changeCommitOrdering(GG.RepoCommitOrdering.AuthorDate)
	},
	{
		title: 'Topological Order',
		visible: true,
		checked: commitOrdering === GG.CommitOrdering.Topological,
		onClick: () => changeCommitOrdering(GG.RepoCommitOrdering.Topological)
	}
]
```

With no second group. The final call should pass only the column visibility group:

```typescript
contextMenu.show([
	[
		{
			title: 'Date',
			visible: true,
			checked: columnWidths[2] !== COLUMN_HIDDEN,
			onClick: () => toggleColumnState(2, 128)
		},
		{
			title: 'Author',
			visible: true,
			checked: columnWidths[3] !== COLUMN_HIDDEN,
			onClick: () => toggleColumnState(3, 128)
		},
		{
			title: 'Commit',
			visible: true,
			checked: columnWidths[4] !== COLUMN_HIDDEN,
			onClick: () => toggleColumnState(4, 80)
		}
	]
], true, null, e, this.viewElem);
```

- [ ] **Step 2: Remove the now-unused helper if it has no references**

Run:

```powershell
rg -n "getCommitOrdering|RepoCommitOrdering\\.Date|RepoCommitOrdering\\.AuthorDate|RepoCommitOrdering\\.Topological" web src tests
```

If `web/main.ts` is the only remaining `getCommitOrdering` reference, remove the helper:

```typescript
function getCommitOrdering(repoValue: GG.RepoCommitOrdering): GG.CommitOrdering {
	switch (repoValue) {
		case GG.RepoCommitOrdering.Default:
			return initialState.config.commitOrdering;
		case GG.RepoCommitOrdering.Date:
			return GG.CommitOrdering.Date;
		case GG.RepoCommitOrdering.AuthorDate:
			return GG.CommitOrdering.AuthorDate;
		case GG.RepoCommitOrdering.Topological:
			return GG.CommitOrdering.Topological;
	}
}
```

- [ ] **Step 3: Send the single effective ordering from the webview**

In `web/main.ts`, find the `sendMessage({ command: 'loadCommits', ... })` block. Replace:

```typescript
commitOrdering: getCommitOrdering(repoState.commitOrdering),
```

With:

```typescript
commitOrdering: GG.CommitOrdering.Date,
```

This keeps the wire protocol stable for now while making the value non-user-controlled.

- [ ] **Step 4: Update GitGraphView tests**

In `tests/gitGraphView.test.ts`, keep expectations that pass `CommitOrdering.Date` to `dataSource.getCommits()`. For tests that set per-repo `RepoCommitOrdering.AuthorDate` or `RepoCommitOrdering.Topological`, change their expected load request back to `CommitOrdering.Date`.

Use this exact assertion shape where applicable:

```typescript
expect(spyOnGetCommits).toHaveBeenCalledWith('/path/to/repo', null, 300, true, false, false, false, CommitOrdering.Date, ['origin', 'upstream'], ['upstream'], []);
```

- [ ] **Step 5: Run webview-related tests**

Run:

```powershell
npx jest --runInBand tests/gitGraphView.test.ts
```

Expected: `tests/gitGraphView.test.ts` passes.

- [ ] **Step 6: Commit webview menu removal**

Run:

```powershell
git add web/main.ts tests/gitGraphView.test.ts
git commit -m "feat: remove legacy commit ordering menu"
```

---

### Task 5: Keep Legacy Config Compatible Without Restoring Legacy Behavior

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`
- Review: `src/repoManager.ts`
- Review: `tests/repoManager.test.ts`

- [ ] **Step 1: Make `Config.commitOrder` return the single effective order**

In `src/config.ts`, replace the current `commitOrder` getter body:

```typescript
const ordering = this.getRenamedExtensionSetting<string>('repository.commits.order', 'commitOrdering', 'date');
return ordering === 'author-date'
	? CommitOrdering.AuthorDate
	: ordering === 'topo'
		? CommitOrdering.Topological
		: CommitOrdering.Date;
```

With:

```typescript
this.getRenamedExtensionSetting<string>('repository.commits.order', 'commitOrdering', 'date');
return CommitOrdering.Date;
```

This still reads the legacy setting so renamed-setting migration behavior remains exercised, but the effective row model no longer changes.

- [ ] **Step 2: Update config tests**

In `tests/config.test.ts`, update the tests named:

```text
Should return CommitOrdering.AuthorDate when the configuration value is "author-date"
Should return CommitOrdering.Topological when the configuration value is "topo"
```

So they expect `CommitOrdering.Date`.

Example:

```typescript
expect(value).toBe(CommitOrdering.Date);
```

Keep the calls to `expectRenamedExtensionSettingToHaveBeenCalled('repository.commits.order', 'commitOrdering')` unchanged.

- [ ] **Step 3: Keep repository import/export validation compatible**

Run:

```powershell
rg -n "commitOrdering" src\\repoManager.ts tests\\repoManager.test.ts
```

Confirm `src/repoManager.ts` accepts `RepoCommitOrdering.Date`, `RepoCommitOrdering.AuthorDate`, and `RepoCommitOrdering.Topological`. Keep this compatibility unchanged so existing repo configuration imports keep working.

When a test expectation assumes the removed ordering menu still exists, replace only that UI expectation. Do not tighten repo configuration validation; saved repository config files with old `commitOrdering` values must still import.

- [ ] **Step 4: Run config and repo manager tests**

Run:

```powershell
npx jest --runInBand tests/config.test.ts tests/repoManager.test.ts
```

Expected: both suites pass.

- [ ] **Step 5: Commit compatibility changes**

Run:

```powershell
git add src/config.ts tests/config.test.ts src/repoManager.ts tests/repoManager.test.ts
git commit -m "chore: keep legacy ordering settings compatible"
```

Stage `src/repoManager.ts` and `tests/repoManager.test.ts` only when the compatibility review required an edit.

---

### Task 6: Verify GitFlow And State Restoration Assumptions

**Files:**
- Modify: `tests/dataSource.test.ts`
- Modify: `tests/gitGraphView.test.ts`
- Review: `src/dataSource.ts`
- Review: `web/main.ts`

- [ ] **Step 1: Add or update a GitFlow alignment assertion**

In `tests/dataSource.test.ts`, locate a GitFlow-layout `getCommits` test. Add an assertion that layout commits are keyed to the final returned commit order:

```typescript
expect(result.gitFlowLayout!.commits.map((commit) => commit.hash)).toStrictEqual(
	result.commits.filter((commit) => commit.hash !== UNCOMMITTED).map((commit) => commit.hash)
);
```

If the layout intentionally excludes some commits, replace the right-hand side with the exact expected hash list from that fixture. Do not leave the relationship implicit.

- [ ] **Step 2: Verify expanded commit remains hash anchored**

In `tests/gitGraphView.test.ts`, add or update a reload test so an expanded commit survives a reordered `commits[]` array by hash.

Use this expected behavior:

```typescript
expect(renderedExpandedCommit.commitHash).toBe('expanded-hash');
expect(renderedExpandedCommit.index).toBe(newIndexForExpandedHash);
```

Assert restored expanded-commit behavior through the public webview test surface: trigger reload, locate the restored row by the same commit id used before reload, and assert the row is expanded or selected according to the existing test helper conventions.

- [ ] **Step 3: Run focused graph tests**

Run:

```powershell
npx jest --runInBand tests/dataSource.test.ts tests/gitGraphView.test.ts
```

Expected: both suites pass.

- [ ] **Step 4: Commit any alignment fixes**

After editing the tests, run:

```powershell
git add src/dataSource.ts tests/dataSource.test.ts web/main.ts tests/gitGraphView.test.ts
git commit -m "test: cover ordered graph model alignment"
```

Create a commit only when this task changes test or source files.

---

### Task 7: Full Verification And Documentation Note

**Files:**
- Review: `CHANGELOG.md`
- Review: `README.md`

- [ ] **Step 1: Run full compile**

Run:

```powershell
npm run compile
```

Expected: lint, clean, compile-src, and compile-web all pass.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test -- --runInBand
```

Expected: all Jest suites pass.

- [ ] **Step 3: Run package verification**

Run:

```powershell
npm run package
```

Expected: VSIX package creation completes. Existing metadata warnings are acceptable if they match the known `*` activation or license warnings from previous runs.

- [ ] **Step 4: Add release-facing note if a changelog section exists**

If `CHANGELOG.md` has a current unreleased or next-version section, add:

```markdown
* The commit graph now uses a single topology-preserving temporal order for a more stable modern Git Graph view.
```

If `CHANGELOG.md` only contains historical released sections, do not edit it in this task.

- [ ] **Step 5: Commit documentation note if changed**

After completing the documentation review, run:

```powershell
git add CHANGELOG.md README.md
git commit -m "docs: note temporal topological ordering"
```

- [ ] **Step 6: Final status check**

Run:

```powershell
git status --short --branch
git log --oneline --decorate --max-count=10
```

Expected: only intentional untracked build artifacts may remain. No source or test changes should be unstaged.

---

## Self-Review Checklist

- The plan starts with a pure sorter and tests before integration.
- The final row model is single-path; no new user option is added.
- Legacy settings remain readable and importable.
- `DataSource` owns final ordering; the webview does not duplicate sorting.
- GitFlow layout is computed from the same final ordered commits as table/graph rendering.
- Load-more row shifts are acknowledged as a future hash-anchor scroll restoration concern.
- Each implementation task has exact files, commands, expected outcomes, and commit boundaries.
