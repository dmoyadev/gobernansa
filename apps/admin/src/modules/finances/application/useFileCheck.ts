import type { FileIssue } from '@gobernansa/shared/domain/fileChecks.ts';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { plural } from '@gobernansa/shared/utils/helpers.ts';
import { writeBatch } from 'firebase/firestore';
import { shallowRef } from 'vue';
import { useRoute } from 'vue-router';

export interface FileCheckState {
	// What it's shown next to, e.g. the remittance's id or the model
	key: string;
	issues: FileIssue[];
	// The download held back by errors until it's confirmed
	held?: () => unknown;
}

function checkResult(issues: FileIssue[]) {
	const errors = issues.filter(issue => issue.level === 'error').length;
	const warnings = issues.length - errors;
	return errors
		? `descargado igualmente con ${plural(errors, 'error', 'errores')} en la comprobación`
		: warnings ? `comprobación con ${plural(warnings, 'aviso', 'avisos')}` : 'comprobación correcta';
}

/**
 * Comprobación del fichero before a download: without errors it goes ahead and the result stays shown, with errors
 * it waits until the user confirms. Each download is logged in the community's activity with its check (MON-4): on its
 * own, as it changes nothing, and not waited for. An action that resolves to false downloaded nothing
 */
export function useFileCheck() {
	const check = shallowRef<FileCheckState>();
	const route = useRoute();

	function guard(key: string, file: string, issues: FileIssue[], action: () => unknown) {
		const communityId = String(route.params.id);
		const link = route.path;
		const run = async () => {
			if (await action() === false) {
				return;
			}
			const batch = writeBatch(db);
			logActivity(batch, communityId, { area: 'finance', summary: `Descargó ${file}: ${checkResult(issues)}`, link });
			void batch.commit().catch(error => reportError(error, { action: 'No se ha podido registrar la descarga' }));
		};
		const held = issues.some(issue => issue.level === 'error');
		check.value = { key, issues, ...(held ? { held: run } : {}) };
		if (!held) {
			void run();
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
