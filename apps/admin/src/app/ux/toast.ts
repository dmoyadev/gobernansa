import { addToTrail, reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { dismiss, toast } from 'lnxjs-components';

const FAILED_PREFIX = /^No se han? podido /;

// Optimistic: Firestore shows local writes in its listeners at once, so the page doesn't wait for the server. The toast
// tells it's done straight away; if the server rejects it the change goes back by itself and the toast becomes the error.
// Never rejects: resolves to whether the server took it, for what can only follow then. Failures are reported, with the
// action as their context
export async function optimistic(action: Promise<unknown>, { done, failed, revert, onError }: {
	done?: string;
	failed: string;
	revert?: () => Promise<unknown>;
	onError?: (error: Error) => void;
}) {
	const id = done ? toast(done, { undo: revert && (async () => action.then(revert)) }) : undefined;
	// By what it does, not what it says when it fails: 'No se ha podido anotar el voto' is 'anotar el voto'
	addToTrail('acción', done ?? failed.replace(FAILED_PREFIX, ''));
	try {
		await action;
		return true;
	} catch (error) {
		if (id) {
			dismiss(id);
		}
		toast(`${failed}: ${(error as Error).message}`, { variant: 'danger' });
		reportError(error, { source: 'action', action: failed });
		onError?.(error as Error);
		return false;
	}
}
