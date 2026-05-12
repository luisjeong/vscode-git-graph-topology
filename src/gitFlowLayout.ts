import { GitCommit, GitCommitRemote, GitFlowLaneFamily, GitFlowLayoutData } from './types';

const MAIN_BRANCHES = ['main', 'master', 'trunk'];
const DEVELOP_BRANCHES = ['develop', 'dev'];
const RELEASE_HOTFIX_BRANCH = /(?:^|[^\w.-])(?:release|hotfix)[/-][\w./-]+/i;
const MERGE_BRANCH = /Merge (?:remote-tracking )?branch ['"]([^'"]+)['"]/i;
const COMPACT_FEATURE_MAX_COMMITS = 12;
const COMPACT_FEATURE_MAX_EXTRA_ROWS = 3;

interface SidePath {
	readonly commits: ReadonlyArray<string>;
	readonly mergeLane: GitFlowLaneFamily;
	readonly hasReleaseHotfixSignal: boolean;
	readonly branch: string | null;
	readonly compact: boolean;
}

export function computeGitFlowLayout(commits: ReadonlyArray<GitCommit>, head: string | null): GitFlowLayoutData {
	const commitByHash = new Map<string, GitCommit>();
	const commitIndexByHash = new Map<string, number>();
	commits.forEach((commit) => commitByHash.set(commit.hash, commit));
	commits.forEach((commit, index) => commitIndexByHash.set(commit.hash, index));

	const mainHead = selectBranchHead(commits, MAIN_BRANCHES) || (head !== null && commitByHash.has(head) ? head : null);
	const developHead = selectBranchHead(commits, DEVELOP_BRANCHES);
	const lanes = new Map<string, GitFlowLaneFamily>();

	traceFirstParent(mainHead, commitByHash, (commit) => {
		if (!isPseudoCommit(commit)) lanes.set(commit.hash, GitFlowLaneFamily.Main);
	});
	traceFirstParent(developHead, commitByHash, (commit) => {
		if (!lanes.has(commit.hash) && !isPseudoCommit(commit)) lanes.set(commit.hash, GitFlowLaneFamily.Develop);
	});
	traceReleaseHotfixRefs(commits, commitByHash, lanes);

	const sidePaths = collectSidePaths(commits, commitByHash, commitIndexByHash, lanes);
	const releaseHotfixCommits = findReleaseHotfixSidePathCommits(sidePaths);
	const compactCommits = findCompactSidePathCommits(sidePaths);
	const branchByHash = new Map<string, string>();

	sidePaths.forEach((path) => {
		path.commits.forEach((hash) => {
			if (!lanes.has(hash)) {
				const commit = commitByHash.get(hash);
				lanes.set(hash, releaseHotfixCommits.has(hash) && (!commit || !isPseudoCommit(commit) || hasReleaseHotfixRef(commit)) ? GitFlowLaneFamily.ReleaseHotfix : GitFlowLaneFamily.Feature);
			}
			if (path.branch !== null && !branchByHash.has(hash)) {
				branchByHash.set(hash, path.branch);
			}
		});
	});

	return {
		commits: commits.map((commit) => {
			const branch = branchByHash.get(commit.hash) || getCommitBranchIdentity(commit);
			const layout = {
				hash: commit.hash,
				lane: lanes.get(commit.hash) || (hasReleaseHotfixRef(commit) ? GitFlowLaneFamily.ReleaseHotfix : GitFlowLaneFamily.Feature)
			};
			const withBranch = typeof branch === 'string' ? { ...layout, branch } : layout;
			return compactCommits.has(commit.hash) ? { ...withBranch, compact: true } : withBranch;
		}),
		mainHead,
		developHead
	};
}

function selectBranchHead(commits: ReadonlyArray<GitCommit>, branchNames: ReadonlyArray<string>): string | null {
	const localMatches = new Map<string, string>();
	const remoteMatches = new Map<string, string>();

	commits.forEach((commit) => {
		commit.heads.forEach((head) => {
			const branchName = normalizeLocalBranch(head);
			if (branchNames.indexOf(branchName) >= 0 && !localMatches.has(branchName)) {
				localMatches.set(branchName, commit.hash);
			}
		});
		commit.remotes.forEach((remote) => {
			const branchName = normalizeRemoteBranch(remote);
			if (branchNames.indexOf(branchName) >= 0 && !remoteMatches.has(branchName)) {
				remoteMatches.set(branchName, commit.hash);
			}
		});
	});

	for (let i = 0; i < branchNames.length; i++) {
		const branchName = branchNames[i];
		const localMatch = localMatches.get(branchName);
		if (localMatch) return localMatch;
	}
	for (let i = 0; i < branchNames.length; i++) {
		const branchName = branchNames[i];
		const remoteMatch = remoteMatches.get(branchName);
		if (remoteMatch) return remoteMatch;
	}
	return null;
}

function normalizeLocalBranch(branchName: string): string {
	return stripPrefix(branchName, 'refs/heads/');
}

function normalizeRemoteBranch(remote: GitCommitRemote): string {
	let branchName = stripPrefix(stripPrefix(remote.name, 'refs/remotes/'), 'remotes/');
	if (remote.remote !== null) {
		branchName = stripPrefix(branchName, remote.remote + '/');
	} else {
		const firstSlash = branchName.indexOf('/');
		if (firstSlash >= 0) branchName = branchName.substring(firstSlash + 1);
	}
	return branchName;
}

function stripPrefix(value: string, prefix: string) {
	return value.substring(0, prefix.length) === prefix ? value.substring(prefix.length) : value;
}

function traceFirstParent(head: string | null, commitByHash: ReadonlyMap<string, GitCommit>, visit: (commit: GitCommit) => void) {
	const visited = new Set<string>();
	let hash = head;
	while (hash !== null && !visited.has(hash)) {
		const commit = commitByHash.get(hash);
		if (!commit) return;

		visited.add(hash);
		visit(commit);
		hash = commit.parents.length > 0 ? commit.parents[0] : null;
	}
}

function traceReleaseHotfixRefs(commits: ReadonlyArray<GitCommit>, commitByHash: ReadonlyMap<string, GitCommit>, lanes: Map<string, GitFlowLaneFamily>) {
	commits.forEach((commit) => {
		if (!hasReleaseHotfixRef(commit)) return;

		const visited = new Set<string>();
		let hash: string | null = commit.hash;
		while (hash !== null && !visited.has(hash)) {
			const pathCommit = commitByHash.get(hash);
			if (!pathCommit) return;

			const lane = lanes.get(pathCommit.hash);
			if (lane === GitFlowLaneFamily.Main || lane === GitFlowLaneFamily.Develop) return;

			visited.add(pathCommit.hash);
			lanes.set(pathCommit.hash, GitFlowLaneFamily.ReleaseHotfix);
			hash = pathCommit.parents.length > 0 ? pathCommit.parents[0] : null;
		}
	});
}

function collectSidePaths(commits: ReadonlyArray<GitCommit>, commitByHash: ReadonlyMap<string, GitCommit>, commitIndexByHash: ReadonlyMap<string, number>, lanes: ReadonlyMap<string, GitFlowLaneFamily>) {
	const paths: SidePath[] = [];
	commits.forEach((mergeCommit, mergeIndex) => {
		if (mergeCommit.parents.length < 2) return;

		const mergeLane = lanes.get(mergeCommit.hash) || GitFlowLaneFamily.Feature;
		for (let i = 1; i < mergeCommit.parents.length; i++) {
			const pathCommits = traceSidePath(mergeCommit.parents[i], commitByHash, lanes);
			if (pathCommits.length > 0) {
				const hasReleaseHotfixSignal = RELEASE_HOTFIX_BRANCH.test(mergeCommit.message) || pathCommits.some((hash) => {
					const commit = commitByHash.get(hash);
					return !!commit && hasReleaseHotfixRef(commit);
				});
				paths.push({
					commits: pathCommits,
					mergeLane,
					hasReleaseHotfixSignal,
					branch: getMergeBranchIdentity(mergeCommit.message) || getSidePathBranchIdentity(pathCommits, commitByHash),
					compact: isCompactDevelopSidePath(pathCommits, mergeIndex, mergeLane, commitIndexByHash)
				});
			}
		}
	});
	return paths;
}

function traceSidePath(head: string, commitByHash: ReadonlyMap<string, GitCommit>, lanes: ReadonlyMap<string, GitFlowLaneFamily>) {
	const path: string[] = [];
	const visited = new Set<string>();
	let hash: string | null = head;
	while (hash !== null && !visited.has(hash)) {
		if (lanes.has(hash)) return path;

		const commit = commitByHash.get(hash);
		if (!commit) return path;

		visited.add(hash);
		path.push(hash);
		hash = commit.parents.length > 0 ? commit.parents[0] : null;
	}
	return path;
}

function findReleaseHotfixSidePathCommits(sidePaths: ReadonlyArray<SidePath>) {
	const mergedIntoMain = new Set<string>();
	const mergedIntoDevelop = new Set<string>();
	const releaseHotfixCommits = new Set<string>();

	sidePaths.forEach((path) => {
		if (path.hasReleaseHotfixSignal) {
			path.commits.forEach((hash) => {
				releaseHotfixCommits.add(hash);
			});
		}
		path.commits.forEach((hash) => {
			if (path.mergeLane === GitFlowLaneFamily.Main) {
				mergedIntoMain.add(hash);
			} else if (path.mergeLane === GitFlowLaneFamily.Develop) {
				mergedIntoDevelop.add(hash);
			}
		});
	});

	mergedIntoMain.forEach((hash) => {
		if (mergedIntoDevelop.has(hash)) releaseHotfixCommits.add(hash);
	});
	return releaseHotfixCommits;
}

function findCompactSidePathCommits(sidePaths: ReadonlyArray<SidePath>) {
	const compactCommits = new Set<string>();
	sidePaths.forEach((path) => {
		if (path.compact) {
			path.commits.forEach((hash) => compactCommits.add(hash));
		}
	});
	return compactCommits;
}

function isCompactDevelopSidePath(pathCommits: ReadonlyArray<string>, mergeIndex: number, mergeLane: GitFlowLaneFamily, commitIndexByHash: ReadonlyMap<string, number>) {
	if (mergeLane !== GitFlowLaneFamily.Develop || pathCommits.length === 0 || pathCommits.length > COMPACT_FEATURE_MAX_COMMITS) {
		return false;
	}

	let maxIndex = mergeIndex;
	for (let i = 0; i < pathCommits.length; i++) {
		const commitIndex = commitIndexByHash.get(pathCommits[i]);
		if (typeof commitIndex !== 'number') return false;
		if (commitIndex > maxIndex) maxIndex = commitIndex;
	}

	return maxIndex - mergeIndex <= pathCommits.length + COMPACT_FEATURE_MAX_EXTRA_ROWS;
}

function hasReleaseHotfixRef(commit: GitCommit) {
	return commit.heads.some((head) => isReleaseHotfixBranch(normalizeLocalBranch(head))) || commit.remotes.some((remote) => isReleaseHotfixBranch(normalizeRemoteBranch(remote)));
}

function getMergeBranchIdentity(message: string) {
	const match = MERGE_BRANCH.exec(message);
	return match ? normalizeBranchIdentity(match[1]) : null;
}

function getSidePathBranchIdentity(pathCommits: ReadonlyArray<string>, commitByHash: ReadonlyMap<string, GitCommit>) {
	for (let i = 0; i < pathCommits.length; i++) {
		const commit = commitByHash.get(pathCommits[i]);
		if (!commit) continue;

		const branch = getCommitBranchIdentity(commit);
		if (branch !== undefined) return branch;
	}
	return null;
}

function getCommitBranchIdentity(commit: GitCommit) {
	for (let i = 0; i < commit.heads.length; i++) {
		const branch = normalizeBranchIdentity(normalizeLocalBranch(commit.heads[i]));
		if (!isLongLivedBranch(branch)) return branch;
	}
	for (let i = 0; i < commit.remotes.length; i++) {
		const branch = normalizeBranchIdentity(normalizeRemoteBranch(commit.remotes[i]));
		if (!isLongLivedBranch(branch)) return branch;
	}
	return undefined;
}

function normalizeBranchIdentity(branchName: string) {
	branchName = stripPrefix(stripPrefix(branchName, 'refs/heads/'), 'refs/remotes/');
	if (branchName.indexOf('origin/') === 0) return stripPrefix(branchName, 'origin/');
	if (branchName.indexOf('upstream/') === 0) return stripPrefix(branchName, 'upstream/');
	return branchName;
}

function isLongLivedBranch(branchName: string) {
	return MAIN_BRANCHES.indexOf(branchName) >= 0 || DEVELOP_BRANCHES.indexOf(branchName) >= 0;
}

function isReleaseHotfixBranch(branchName: string) {
	return branchName.indexOf('release/') === 0 || branchName.indexOf('release-') === 0 || branchName.indexOf('hotfix/') === 0 || branchName.indexOf('hotfix-') === 0;
}

function isPseudoCommit(commit: GitCommit) {
	return commit.hash === '*' || commit.stash !== null;
}
