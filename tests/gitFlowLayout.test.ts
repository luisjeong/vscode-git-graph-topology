import { computeGitFlowLayout } from '../src/gitFlowLayout';
import { GitCommit, GitFlowLaneFamily } from '../src/types';

const commit = (hash: string, parents: ReadonlyArray<string>, options?: {
	readonly heads?: ReadonlyArray<string>,
	readonly remotes?: ReadonlyArray<{ readonly name: string, readonly remote: string | null }>,
	readonly message?: string,
	readonly stash?: GitCommit['stash']
}): GitCommit => ({
	hash,
	parents,
	author: 'User',
	email: 'user@example.com',
	date: 1,
	message: options?.message || hash,
	heads: options?.heads || [],
	tags: [],
	remotes: options?.remotes || [],
	stash: options?.stash || null
});

const remote = (name: string) => ({ name, remote: 'origin' });

const lanes = (commits: ReadonlyArray<GitCommit>, head: string | null = null) => {
	const layout = computeGitFlowLayout(commits, head);
	return {
		...layout,
		byHash: new Map(layout.commits.map((entry) => [entry.hash, entry.lane]))
	};
};

describe('computeGitFlowLayout', () => {
	it('classifies first-parent main and develop chains', () => {
		const commits = [
			commit('m2', ['m1'], { heads: ['main'] }),
			commit('d2', ['d1'], { heads: ['develop'] }),
			commit('d1', ['m1']),
			commit('m1', ['root']),
			commit('root', [])
		];

		const layout = lanes(commits);

		expect(layout.mainHead).toBe('m2');
		expect(layout.developHead).toBe('d2');
		expect(layout.byHash.get('m2')).toBe(GitFlowLaneFamily.Main);
		expect(layout.byHash.get('m1')).toBe(GitFlowLaneFamily.Main);
		expect(layout.byHash.get('root')).toBe(GitFlowLaneFamily.Main);
		expect(layout.byHash.get('d2')).toBe(GitFlowLaneFamily.Develop);
		expect(layout.byHash.get('d1')).toBe(GitFlowLaneFamily.Develop);
	});

	it('uses main/master/trunk and develop/dev exact branch names', () => {
		expect(lanes([commit('a', [], { heads: ['main'] })]).mainHead).toBe('a');
		expect(lanes([commit('b', [], { heads: ['master'] })]).mainHead).toBe('b');
		expect(lanes([commit('c', [], { heads: ['trunk'] })]).mainHead).toBe('c');
		expect(lanes([commit('d', [], { heads: ['develop'] })]).developHead).toBe('d');
		expect(lanes([commit('e', [], { heads: ['dev'] })]).developHead).toBe('e');
		expect(lanes([commit('f', [], { heads: ['feature/main'] })]).mainHead).toBeNull();
		expect(lanes([commit('g', [], { heads: ['develop-next'] })]).developHead).toBeNull();
	});

	it('uses the newest visible branch ref when local and remote refs diverge', () => {
		const commits = [
			commit('remote-main', ['local-main'], { remotes: [{ name: 'origin/main', remote: 'origin' }] }),
			commit('remote-develop', ['local-develop', 'feature-tip'], {
				remotes: [{ name: 'origin/develop', remote: 'origin' }],
				message: 'Merge branch \'feature/task-refactoring\' into \'develop\''
			}),
			commit('feature-tip', ['local-develop']),
			commit('local-main', [], { heads: ['main'] }),
			commit('local-develop', [], { heads: ['develop'] })
		];

		const layout = lanes(commits);

		expect(layout.mainHead).toBe('remote-main');
		expect(layout.developHead).toBe('remote-develop');
		expect(layout.byHash.get('remote-develop')).toBe(GitFlowLaneFamily.Develop);
	});

	it('classifies a branch merged into both main and develop as release-hotfix', () => {
		const commits = [
			commit('m3', ['m2', 'r2'], { heads: ['main'] }),
			commit('d3', ['d2', 'r2'], { heads: ['develop'] }),
			commit('r2', ['r1']),
			commit('r1', ['d1']),
			commit('d2', ['d1']),
			commit('m2', ['m1']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = lanes(commits);

		expect(layout.byHash.get('r2')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.byHash.get('r1')).toBe(GitFlowLaneFamily.ReleaseHotfix);
	});

	it('classifies release and hotfix ref names as release-hotfix', () => {
		const commits = [
			commit('m2', ['m1', 'release-tip'], { heads: ['main'] }),
			commit('d2', ['d1', 'hotfix-tip'], { heads: ['develop'] }),
			commit('release-tip', ['release-base'], { heads: ['release/1.2.0'] }),
			commit('release-base', ['d1']),
			commit('hotfix-tip', ['hotfix-base'], { remotes: [{ name: 'origin/hotfix-urgent', remote: 'origin' }] }),
			commit('hotfix-base', ['d1']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = lanes(commits);

		expect(layout.byHash.get('release-tip')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.byHash.get('release-base')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.byHash.get('hotfix-tip')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.byHash.get('hotfix-base')).toBe(GitFlowLaneFamily.ReleaseHotfix);
	});

	it('classifies unmerged release and hotfix branch refs as release-hotfix', () => {
		const commits = [
			commit('m2', ['m1'], { heads: ['main'] }),
			commit('d2', ['d1'], { heads: ['develop'] }),
			commit('release-tip', ['release-base'], { heads: ['release/1.2.0'] }),
			commit('release-base', ['d2']),
			commit('hotfix-tip', ['hotfix-base'], { remotes: [{ name: 'origin/hotfix-urgent', remote: 'origin' }] }),
			commit('hotfix-base', ['m2']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = lanes(commits);

		expect(layout.byHash.get('release-tip')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.byHash.get('release-base')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.byHash.get('hotfix-tip')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.byHash.get('hotfix-base')).toBe(GitFlowLaneFamily.ReleaseHotfix);
	});

	it('uses merge message branch names as a supporting release-hotfix signal', () => {
		const commits = [
			commit('m2', ['m1', 'r2'], { heads: ['main'], message: 'Merge branch \'release/1.3.0\'' }),
			commit('r2', ['r1']),
			commit('r1', ['d1']),
			commit('d1', ['m1'], { heads: ['develop'] }),
			commit('m1', [])
		];

		const layout = lanes(commits);

		expect(layout.byHash.get('r2')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.byHash.get('r1')).toBe(GitFlowLaneFamily.ReleaseHotfix);
	});

	it('uses hotfix merge messages merged only into develop as non-compact release-hotfix side paths', () => {
		const commits = [
			commit('m2', ['m1'], { heads: ['main'] }),
			commit('d3', ['d2', 'h2'], { heads: ['develop'], message: 'Merge branch \'hotfix/fe-router-fix\' into develop' }),
			commit('h2', ['h1']),
			commit('h1', ['d1']),
			commit('d2', ['d1']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = lanes(commits);

		expect(layout.byHash.get('d3')).toBe(GitFlowLaneFamily.Develop);
		expect(layout.byHash.get('h2')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.byHash.get('h1')).toBe(GitFlowLaneFamily.ReleaseHotfix);
		expect(layout.commits.find((entry) => entry.hash === 'h2')!.compact).toBeUndefined();
		expect(layout.commits.find((entry) => entry.hash === 'h1')!.compact).toBeUndefined();
	});

	it('keeps fix merge messages merged only into develop as compact feature side paths', () => {
		const commits = [
			commit('m2', ['m1'], { heads: ['main'] }),
			commit('d3', ['d2', 'x2'], { heads: ['develop'], message: 'Merge branch \'fix/S14P11B107-84_branchClear\' into develop' }),
			commit('x2', ['x1']),
			commit('x1', ['d1']),
			commit('d2', ['d1']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = lanes(commits);

		expect(layout.byHash.get('d3')).toBe(GitFlowLaneFamily.Develop);
		expect(layout.byHash.get('x2')).toBe(GitFlowLaneFamily.Feature);
		expect(layout.byHash.get('x1')).toBe(GitFlowLaneFamily.Feature);
		expect(layout.commits.find((entry) => entry.hash === 'x2')!.compact).toBe(true);
		expect(layout.commits.find((entry) => entry.hash === 'x1')!.compact).toBe(true);
	});

	it('marks short feature side paths merged into develop as compact', () => {
		const commits = [
			commit('m2', ['m1'], { heads: ['main'] }),
			commit('d3', ['d2', 'f3'], { heads: ['develop'], message: 'Merge branch \'feat/quick-chat\' into develop' }),
			commit('f3', ['f2']),
			commit('f2', ['f1']),
			commit('f1', ['d1']),
			commit('d2', ['d1']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = computeGitFlowLayout(commits, null);
		const byHash = new Map(layout.commits.map((entry) => [entry.hash, entry]));

		expect(byHash.get('d3')!.lane).toBe(GitFlowLaneFamily.Develop);
		expect(byHash.get('f3')!.lane).toBe(GitFlowLaneFamily.Feature);
		expect(byHash.get('f3')!.compact).toBe(true);
		expect(byHash.get('f2')!.compact).toBe(true);
		expect(byHash.get('f1')!.compact).toBe(true);
		expect(byHash.get('d3')!.compact).toBeUndefined();
	});

	it('preserves merge-message branch identity for repeated feature merges', () => {
		const commits = [
			commit('m2', ['m1'], { heads: ['main'] }),
			commit('d5', ['d4', 'f4'], { heads: ['develop'], message: 'Merge branch \'fix/fe-scenarioselect-breakpoints\' into develop' }),
			commit('f4', ['f3']),
			commit('f3', ['d3']),
			commit('d4', ['d3', 'f2'], { message: 'Merge branch \'fix/fe-scenarioselect-breakpoints\' into develop' }),
			commit('f2', ['f1']),
			commit('f1', ['d2']),
			commit('d3', ['d2']),
			commit('d2', ['d1']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = computeGitFlowLayout(commits, null);
		const byHash = new Map(layout.commits.map((entry) => [entry.hash, entry]));

		expect(byHash.get('f4')!.branch).toBe('fix/fe-scenarioselect-breakpoints');
		expect(byHash.get('f2')!.branch).toBe('fix/fe-scenarioselect-breakpoints');
		expect(byHash.get('f4')!.lane).toBe(GitFlowLaneFamily.Feature);
		expect(byHash.get('f2')!.lane).toBe(GitFlowLaneFamily.Feature);
	});

	it('normalises remote branch identity for repeated feature merges', () => {
		const commits = [
			commit('m2', ['m1'], { heads: ['main'] }),
			commit('d5', ['d4', 'f4'], { heads: ['develop'], message: 'Merge branch \'fix/fe-scenarioselect-breakpoints\' into develop' }),
			commit('f4', ['f3'], { remotes: [remote('origin/fix/fe-scenarioselect-breakpoints')] }),
			commit('f3', ['d3']),
			commit('d4', ['d3', 'f2'], { message: 'Merge remote-tracking branch \'origin/fix/fe-scenarioselect-breakpoints\' into develop' }),
			commit('f2', ['f1']),
			commit('f1', ['d2']),
			commit('d3', ['d2']),
			commit('d2', ['d1']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = computeGitFlowLayout(commits, null);
		const byHash = new Map(layout.commits.map((entry) => [entry.hash, entry]));

		expect(byHash.get('f4')!.branch).toBe('fix/fe-scenarioselect-breakpoints');
		expect(byHash.get('f2')!.branch).toBe('fix/fe-scenarioselect-breakpoints');
	});

	it('keeps branches merged only into develop as feature', () => {
		const commits = [
			commit('m2', ['m1'], { heads: ['main'] }),
			commit('d3', ['d2', 'f2'], { heads: ['develop'] }),
			commit('f2', ['f1']),
			commit('f1', ['d1']),
			commit('d2', ['d1']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = lanes(commits);

		expect(layout.byHash.get('f2')).toBe(GitFlowLaneFamily.Feature);
		expect(layout.byHash.get('f1')).toBe(GitFlowLaneFamily.Feature);
	});

	it('keeps develop side paths from pull merges on the develop lane', () => {
		const commits = [
			commit('m2', ['m1'], { heads: ['main'] }),
			commit('d4', ['d2', 'rd2'], { heads: ['develop'], message: 'Merge branch \'develop\' of https://lab.example.com/group/repo into develop' }),
			commit('rd2', ['rd1']),
			commit('rd1', ['d1']),
			commit('d2', ['d1']),
			commit('d1', ['m1']),
			commit('m1', [])
		];

		const layout = computeGitFlowLayout(commits, null);
		const byHash = new Map(layout.commits.map((entry) => [entry.hash, entry]));

		expect(byHash.get('d4')!.lane).toBe(GitFlowLaneFamily.Develop);
		expect(byHash.get('rd2')!.lane).toBe(GitFlowLaneFamily.Develop);
		expect(byHash.get('rd1')!.lane).toBe(GitFlowLaneFamily.Develop);
		expect(byHash.get('rd2')!.branch).toBe('develop');
		expect(byHash.get('rd1')!.branch).toBe('develop');
		expect(byHash.get('rd2')!.compact).toBeUndefined();
		expect(byHash.get('rd1')!.compact).toBeUndefined();
	});

	it('falls back to HEAD when no main branch ref is visible', () => {
		const commits = [
			commit('h2', ['h1']),
			commit('h1', [])
		];

		const layout = lanes(commits, 'h2');

		expect(layout.mainHead).toBe('h2');
		expect(layout.byHash.get('h2')).toBe(GitFlowLaneFamily.Main);
		expect(layout.byHash.get('h1')).toBe(GitFlowLaneFamily.Main);
	});
});
