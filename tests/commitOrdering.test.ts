import { TemporalTopologicalCommit, orderCommitsTemporallyTopological } from '../src/commitOrdering';

const commit = (hash: string, parents: ReadonlyArray<string>, date: number): TemporalTopologicalCommit => ({
	hash,
	parents,
	date
});

const orderedHashes = (commits: ReadonlyArray<TemporalTopologicalCommit>) =>
	orderCommitsTemporallyTopological(commits).map((orderedCommit) => orderedCommit.hash);

describe('orderCommitsTemporallyTopological', () => {
	it('places a child before its parent even when the parent date is newer', () => {
		const commits = [
			commit('parent', [], 300),
			commit('child', ['parent'], 100)
		];

		expect(orderedHashes(commits)).toEqual(['child', 'parent']);
	});

	it('places the newest eligible branch head first', () => {
		const commits = [
			commit('main-parent', [], 10),
			commit('feature-parent', [], 20),
			commit('main-head', ['main-parent'], 100),
			commit('feature-head', ['feature-parent'], 200)
		];

		expect(orderedHashes(commits)).toEqual(['feature-head', 'main-head', 'feature-parent', 'main-parent']);
	});

	it('breaks date ties by original input position', () => {
		const commits = [
			commit('b', [], 100),
			commit('a', [], 100),
			commit('c', [], 100)
		];

		expect(orderedHashes(commits)).toEqual(['b', 'a', 'c']);
	});

	it('does not block a commit with a missing parent', () => {
		const commits = [
			commit('child', ['missing-parent'], 50),
			commit('independent', [], 40)
		];

		expect(orderedHashes(commits)).toEqual(['child', 'independent']);
	});

	it('places a merge before all displayed parents', () => {
		const commits = [
			commit('left-parent', [], 500),
			commit('right-parent', [], 400),
			commit('merge', ['left-parent', 'right-parent'], 100)
		];

		expect(orderedHashes(commits)).toEqual(['merge', 'left-parent', 'right-parent']);
	});

	it('terminates synthetic cycles deterministically', () => {
		const commits = [
			commit('a', ['b'], 10),
			commit('b', ['a'], 20),
			commit('c', [], 15)
		];

		expect(orderedHashes(commits)).toEqual(['b', 'c', 'a']);
	});

	it('orders a deep linear history without overflowing the call stack', () => {
		const commits = Array.from({ length: 12000 }, (_, index) =>
			commit(`commit-${index}`, index === 0 ? [] : [`commit-${index - 1}`], index)
		).reverse();

		expect(() => orderCommitsTemporallyTopological(commits)).not.toThrow();
		const hashes = orderedHashes(commits);

		expect(hashes[0]).toBe('commit-11999');
		expect(hashes[hashes.length - 1]).toBe('commit-0');
	});

	it('does not mutate the input array or commit objects', () => {
		const parent = commit('parent', [], 300);
		const child = commit('child', ['parent'], 100);
		const commits = [parent, child];
		const originalCommits = commits.slice();
		const originalParent = { ...parent, parents: parent.parents.slice() };
		const originalChild = { ...child, parents: child.parents.slice() };

		orderCommitsTemporallyTopological(commits);

		expect(commits).toEqual(originalCommits);
		expect(parent).toEqual(originalParent);
		expect(child).toEqual(originalChild);
	});

	it('orders a larger branchy history with children before displayed parents', () => {
		const commits: TemporalTopologicalCommit[] = [];
		for (let branch = 0; branch < 20; branch++) {
			for (let index = 0; index < 50; index++) {
				const hash = `branch-${branch}-${index}`;
				const parents = index === 0 ? ['root'] : [`branch-${branch}-${index - 1}`];
				commits.push(commit(hash, parents, branch * 100 + index));
			}
		}
		commits.push(commit('root', [], 10000));

		const ordered = orderCommitsTemporallyTopological(commits);
		const positionByHash = new Map(ordered.map((orderedCommit, index) => [orderedCommit.hash, index]));

		for (const orderedCommit of ordered) {
			for (const parentHash of orderedCommit.parents) {
				const parentPosition = positionByHash.get(parentHash);
				if (parentPosition !== undefined) {
					expect(positionByHash.get(orderedCommit.hash)).toBeLessThan(parentPosition);
				}
			}
		}
	});
});
