interface RestorableExpandedCommit {
	index: number;
	commitHash: string;
	commitElem: HTMLElement | null;
	compareWithHash: string | null;
	compareWithElem: HTMLElement | null;
}

function findCommitElemWithId(elems: HTMLCollectionOf<HTMLElement>, id: number | null) {
	if (id === null) return null;
	let findIdStr = id.toString();
	for (let i = 0; i < elems.length; i++) {
		if (findIdStr === elems[i].dataset.id) return elems[i];
	}
	return null;
}

function restoreExpandedCommitElements(expandedCommit: RestorableExpandedCommit, elems: HTMLCollectionOf<HTMLElement>, getCommitId: (hash: string) => number | null) {
	const commitElem = findCommitElemWithId(elems, getCommitId(expandedCommit.commitHash));
	const compareWithElem = expandedCommit.compareWithHash !== null ? findCommitElemWithId(elems, getCommitId(expandedCommit.compareWithHash)) : null;

	if (commitElem === null || (expandedCommit.compareWithHash !== null && compareWithElem === null)) return false;

	expandedCommit.index = parseInt(commitElem.dataset.id!);
	expandedCommit.commitElem = commitElem;
	expandedCommit.compareWithElem = compareWithElem;
	return true;
}
