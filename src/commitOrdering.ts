export interface TemporalTopologicalCommit {
	readonly hash: string;
	readonly parents: ReadonlyArray<string>;
	readonly date: number;
}

interface IndexedCommit<T extends TemporalTopologicalCommit> {
	readonly commit: T;
	readonly index: number;
}

interface SearchState<T extends TemporalTopologicalCommit> {
	readonly commitsByHash: ReadonlyMap<string, IndexedCommit<T>>;
	readonly indexByHash: Map<string, number>;
	readonly lowLinkByHash: Map<string, number>;
	readonly stack: string[];
	readonly stackedHashes: Set<string>;
	readonly components: string[][];
	nextIndex: number;
}

const compareIndexedCommits = <T extends TemporalTopologicalCommit>(
	left: IndexedCommit<T>,
	right: IndexedCommit<T>
) => {
	if (left.commit.date !== right.commit.date) {
		return right.commit.date - left.commit.date;
	}
	if (left.index !== right.index) {
		return left.index - right.index;
	}
	return left.commit.hash.localeCompare(right.commit.hash);
};

const strongConnect = <T extends TemporalTopologicalCommit>(hash: string, state: SearchState<T>) => {
	state.indexByHash.set(hash, state.nextIndex);
	state.lowLinkByHash.set(hash, state.nextIndex);
	state.nextIndex++;
	state.stack.push(hash);
	state.stackedHashes.add(hash);

	const indexedCommit = state.commitsByHash.get(hash);
	if (indexedCommit) {
		for (const parentHash of indexedCommit.commit.parents) {
			if (!state.commitsByHash.has(parentHash)) {
				continue;
			}

			if (!state.indexByHash.has(parentHash)) {
				strongConnect(parentHash, state);
				state.lowLinkByHash.set(
					hash,
					Math.min(state.lowLinkByHash.get(hash)!, state.lowLinkByHash.get(parentHash)!)
				);
			} else if (state.stackedHashes.has(parentHash)) {
				state.lowLinkByHash.set(
					hash,
					Math.min(state.lowLinkByHash.get(hash)!, state.indexByHash.get(parentHash)!)
				);
			}
		}
	}

	if (state.lowLinkByHash.get(hash) === state.indexByHash.get(hash)) {
		const component: string[] = [];
		let componentHash: string | undefined;
		do {
			componentHash = state.stack.pop();
			if (componentHash) {
				state.stackedHashes.delete(componentHash);
				component.push(componentHash);
			}
		} while (componentHash && componentHash !== hash);
		state.components.push(component);
	}
};

const findComponents = <T extends TemporalTopologicalCommit>(
	commits: ReadonlyArray<IndexedCommit<T>>,
	commitsByHash: ReadonlyMap<string, IndexedCommit<T>>
) => {
	const state: SearchState<T> = {
		commitsByHash,
		indexByHash: new Map<string, number>(),
		lowLinkByHash: new Map<string, number>(),
		stack: [],
		stackedHashes: new Set<string>(),
		components: [],
		nextIndex: 0
	};

	for (const indexedCommit of commits) {
		if (!state.indexByHash.has(indexedCommit.commit.hash)) {
			strongConnect(indexedCommit.commit.hash, state);
		}
	}

	return state.components;
};

export function orderCommitsTemporallyTopological<T extends TemporalTopologicalCommit>(commits: ReadonlyArray<T>): T[] {
	const indexedCommits = commits.map((commit, index) => ({ commit, index }));
	const commitsByHash = new Map(indexedCommits.map((indexedCommit) => [indexedCommit.commit.hash, indexedCommit]));
	const components = findComponents(indexedCommits, commitsByHash);
	const componentByHash = new Map<string, number>();

	components.forEach((component, componentIndex) => {
		for (const hash of component) {
			componentByHash.set(hash, componentIndex);
		}
	});

	const childCountByComponent = new Map<number, number>();
	const parentsByComponent = new Map<number, Set<number>>();
	for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
		childCountByComponent.set(componentIndex, 0);
		parentsByComponent.set(componentIndex, new Set<number>());
	}

	for (const indexedCommit of indexedCommits) {
		const childComponent = componentByHash.get(indexedCommit.commit.hash)!;
		for (const parentHash of indexedCommit.commit.parents) {
			const parentComponent = componentByHash.get(parentHash);
			if (parentComponent === undefined || parentComponent === childComponent) {
				continue;
			}

			const parentComponents = parentsByComponent.get(childComponent)!;
			if (!parentComponents.has(parentComponent)) {
				parentComponents.add(parentComponent);
				childCountByComponent.set(parentComponent, childCountByComponent.get(parentComponent)! + 1);
			}
		}
	}

	const remainingByComponent = new Map<number, IndexedCommit<T>[]>();
	for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
		remainingByComponent.set(
			componentIndex,
			components[componentIndex].map((hash) => commitsByHash.get(hash)!).sort(compareIndexedCommits)
		);
	}

	const orderedCommits: T[] = [];
	const exhaustedComponents = new Set<number>();
	while (orderedCommits.length < indexedCommits.length) {
		const nextCommit = indexedCommits
			.filter((indexedCommit) => {
				const component = componentByHash.get(indexedCommit.commit.hash)!;
				const remaining = remainingByComponent.get(component)!;
				return childCountByComponent.get(component) === 0 && remaining.includes(indexedCommit);
			})
			.sort(compareIndexedCommits)[0];

		if (!nextCommit) {
			break;
		}

		orderedCommits.push(nextCommit.commit);
		const component = componentByHash.get(nextCommit.commit.hash)!;
		const remaining = remainingByComponent.get(component)!;
		remaining.splice(remaining.indexOf(nextCommit), 1);

		if (remaining.length === 0 && !exhaustedComponents.has(component)) {
			exhaustedComponents.add(component);
			for (const parentComponent of parentsByComponent.get(component)!) {
				childCountByComponent.set(parentComponent, childCountByComponent.get(parentComponent)! - 1);
			}
		}
	}

	return orderedCommits;
}
