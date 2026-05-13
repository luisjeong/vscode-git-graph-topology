import { orderCommitsTemporallyTopological, TemporalTopologicalCommit } from '../src/commitOrdering';

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
});
