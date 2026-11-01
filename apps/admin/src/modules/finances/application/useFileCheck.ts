import type { FileIssue } from '@gobernansa/shared/domain/fileChecks.ts';
import { shallowRef } from 'vue';

export interface FileCheckState {
	// What it's shown next to, e.g. the remittance's id or the model
	key: string;
	issues: FileIssue[];
	// The download held back by errors until it's confirmed
	held?: () => unknown;
}

/**
 * Comprobación del fichero before a download: without errors it goes ahead and the result stays shown, with errors
 * it waits until the user confirms
 */
export function useFileCheck() {
	const check = shallowRef<FileCheckState>();

	function guard(key: string, issues: FileIssue[], action: () => unknown) {
		const held = issues.some(issue => issue.level === 'error');
		check.value = { key, issues, ...(held ? { held: action } : {}) };
		if (!held) {
			void action();
		}
	}

	function confirm() {
		const action = check.value?.held;
		check.value = check.value && { key: check.value.key, issues: check.value.issues };
		void action?.();
	}

	function dismiss() {
		check.value = undefined;
	}

	return { check, guard, confirm, dismiss };
}
