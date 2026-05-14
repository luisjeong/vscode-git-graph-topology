export interface TemporalTopologicalCommit {
	readonly hash: string;
	readonly parents: ReadonlyArray<string>;
	readonly date: number;
}

interface IndexedCommit<T extends TemporalTopologicalCommit> {
	readonly commit: T;
	readonly index: number;
}

interface SearchFrame {
	readonly hash: string;
	nextParentIndex: number;
}

interface ComponentState<T extends TemporalTopologicalCommit> {
	readonly commits: ReadonlyArray<IndexedCommit<T>>;
	nextCommitIndex: number;
	childComponentCount: number;
	readonly parentComponents: Set<number>;
}

class BinaryHeap<T> {
	private readonly items: T[] = [];

	public constructor(private readonly compare: (left: T, right: T) => number) {}

	public get size(): number {
		return this.items.length;
	}

	public push(item: T): void {
		this.items.push(item);
		this.bubbleUp(this.items.length - 1);
	}

	public pop(): T | undefined {
		if (this.items.length === 0) {
			return undefined;
		}

		const first = this.items[0];
		const last = this.items.pop()!;
		if (this.items.length > 0) {
			this.items[0] = last;
			this.bubbleDown(0);
		}
		return first;
	}

	private bubbleUp(index: number): void {
		let currentIndex = index;
		while (currentIndex > 0) {
			const parentIndex = Math.floor((currentIndex - 1) / 2);
			if (this.compare(this.items[currentIndex], this.items[parentIndex]) >= 0) {
				return;
			}

			this.swap(currentIndex, parentIndex);
			currentIndex = parentIndex;
		}
	}

	private bubbleDown(index: number): void {
		let currentIndex = index;
		while (true) {
			const leftIndex = currentIndex * 2 + 1;
			const rightIndex = leftIndex + 1;
			let bestIndex = currentIndex;

			if (leftIndex < this.items.length && this.compare(this.items[leftIndex], this.items[bestIndex]) < 0) {
				bestIndex = leftIndex;
			}
			if (rightIndex < this.items.length && this.compare(this.items[rightIndex], this.items[bestIndex]) < 0) {
				bestIndex = rightIndex;
			}
			if (bestIndex === currentIndex) {
				return;
			}

			this.swap(currentIndex, bestIndex);
			currentIndex = bestIndex;
		}
	}

	private swap(leftIndex: number, rightIndex: number): void {
		const left = this.items[leftIndex];
		this.items[leftIndex] = this.items[rightIndex];
		this.items[rightIndex] = left;
	}
}

const compareHashes = (left: string, right: string): number => {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
};

const compareIndexedCommits = <T extends TemporalTopologicalCommit>(
	left: IndexedCommit<T>,
	right: IndexedCommit<T>
): number => {
	if (left.commit.date !== right.commit.date) {
		return right.commit.date - left.commit.date;
	}
	if (left.index !== right.index) {
		return left.index - right.index;
	}
	return compareHashes(left.commit.hash, right.commit.hash);
};

const findComponents = <T extends TemporalTopologicalCommit>(
	commits: ReadonlyArray<IndexedCommit<T>>,
	commitsByHash: ReadonlyMap<string, IndexedCommit<T>>
): string[][] => {
	const indexByHash = new Map<string, number>();
	const lowLinkByHash = new Map<string, number>();
	const componentStack: string[] = [];
	const stackedHashes = new Set<string>();
	const components: string[][] = [];
	let nextIndex = 0;

	const startVisit = (hash: string, searchStack: SearchFrame[]): void => {
		indexByHash.set(hash, nextIndex);
		lowLinkByHash.set(hash, nextIndex);
		nextIndex++;
		componentStack.push(hash);
		stackedHashes.add(hash);
		searchStack.push({ hash, nextParentIndex: 0 });
	};

	for (const indexedCommit of commits) {
		if (indexByHash.has(indexedCommit.commit.hash)) {
			continue;
		}

		const searchStack: SearchFrame[] = [];
		startVisit(indexedCommit.commit.hash, searchStack);

		while (searchStack.length > 0) {
			const frame = searchStack[searchStack.length - 1];
			const parents = commitsByHash.get(frame.hash)!.commit.parents;
			let descended = false;

			while (frame.nextParentIndex < parents.length) {
				const parentHash = parents[frame.nextParentIndex];
				frame.nextParentIndex++;

				if (!commitsByHash.has(parentHash)) {
					continue;
				}
				if (!indexByHash.has(parentHash)) {
					startVisit(parentHash, searchStack);
					descended = true;
					break;
				}
				if (stackedHashes.has(parentHash)) {
					lowLinkByHash.set(
						frame.hash,
						Math.min(lowLinkByHash.get(frame.hash)!, indexByHash.get(parentHash)!)
					);
				}
			}

			if (descended) {
				continue;
			}

			if (lowLinkByHash.get(frame.hash) === indexByHash.get(frame.hash)) {
				const component: string[] = [];
				let componentHash: string | undefined;
				do {
					componentHash = componentStack.pop();
					if (componentHash) {
						stackedHashes.delete(componentHash);
						component.push(componentHash);
					}
				} while (componentHash && componentHash !== frame.hash);
				components.push(component);
			}

			searchStack.pop();
			const parentFrame = searchStack[searchStack.length - 1];
			if (parentFrame) {
				lowLinkByHash.set(
					parentFrame.hash,
					Math.min(lowLinkByHash.get(parentFrame.hash)!, lowLinkByHash.get(frame.hash)!)
				);
			}
		}
	}

	return components;
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

	const componentStates = components.map((component): ComponentState<T> => ({
		commits: component.map((hash) => commitsByHash.get(hash)!).sort(compareIndexedCommits),
		nextCommitIndex: 0,
		childComponentCount: 0,
		parentComponents: new Set<number>()
	}));

	for (const indexedCommit of indexedCommits) {
		const childComponent = componentByHash.get(indexedCommit.commit.hash)!;
		for (const parentHash of indexedCommit.commit.parents) {
			const parentComponent = componentByHash.get(parentHash);
			if (parentComponent === undefined || parentComponent === childComponent) {
				continue;
			}

			const parentComponents = componentStates[childComponent].parentComponents;
			if (!parentComponents.has(parentComponent)) {
				parentComponents.add(parentComponent);
				componentStates[parentComponent].childComponentCount++;
			}
		}
	}

	const currentCommit = (componentIndex: number): IndexedCommit<T> =>
		componentStates[componentIndex].commits[componentStates[componentIndex].nextCommitIndex];

	const eligibleComponents = new BinaryHeap<number>((left, right) =>
		compareIndexedCommits(currentCommit(left), currentCommit(right))
	);
	componentStates.forEach((componentState, componentIndex) => {
		if (componentState.childComponentCount === 0) {
			eligibleComponents.push(componentIndex);
		}
	});

	const orderedCommits: T[] = [];
	while (eligibleComponents.size > 0) {
		const componentIndex = eligibleComponents.pop()!;
		const componentState = componentStates[componentIndex];
		const nextCommit = componentState.commits[componentState.nextCommitIndex];
		componentState.nextCommitIndex++;
		orderedCommits.push(nextCommit.commit);

		if (componentState.nextCommitIndex < componentState.commits.length) {
			eligibleComponents.push(componentIndex);
			continue;
		}

		for (const parentComponent of componentState.parentComponents) {
			componentStates[parentComponent].childComponentCount--;
			if (componentStates[parentComponent].childComponentCount === 0) {
				eligibleComponents.push(parentComponent);
			}
		}
	}

	return orderedCommits;
}
