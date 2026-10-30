import { reactive } from 'vue';

export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'error';
	duration: number;
	undo?: () => Promise<unknown>;
}

const DURATION_MS = 4000;
const UNDO_DURATION_MS = 7000;
const ERROR_DURATION_MS = 9000;

export const toasts = reactive<Toast[]>([]);
let lastId = 0;

export function toast(message: string, options: { tone?: Toast['tone']; undo?: () => Promise<unknown> } = {}) {
	const tone = options.tone ?? 'info';
	const item: Toast = {
		id: ++lastId,
		message,
		tone,
		undo: options.undo,
		duration: tone === 'error' ? ERROR_DURATION_MS : options.undo ? UNDO_DURATION_MS : DURATION_MS,
	};
	toasts.push(item);
	return item.id;
}

export function dismiss(id: number) {
	const index = toasts.findIndex(item => item.id === id);
	if (index !== -1) {
		toasts.splice(index, 1);
	}
}

// The given one, or the newest that can be undone (what ⌘Z undoes)
export async function undo(id = toasts.findLast(item => item.undo)?.id) {
	const item = toasts.find(candidate => candidate.id === id);
	if (!item?.undo) {
		return false;
	}
	dismiss(item.id);
	try {
		await item.undo();
		toast('Deshecho');
	} catch (error) {
		toast(`No se ha podido deshacer: ${(error as Error).message}`, { tone: 'error' });
	}
	return true;
}

// Optimistic: Firestore shows local writes in its listeners at once, so the page doesn't wait for the server. The toast
// tells it's done straight away; if the server rejects it the change goes back by itself and the toast becomes the error.
// Never rejects: resolves to whether the server took it, for what can only follow then
export async function optimistic(action: Promise<unknown>, { done, failed, revert, onError }: {
	done?: string;
	failed: string;
	revert?: () => Promise<unknown>;
	onError?: (error: Error) => void;
}) {
	const id = done ? toast(done, { undo: revert && (async () => action.then(revert)) }) : undefined;
	try {
		await action;
		return true;
	} catch (error) {
		if (id) {
			dismiss(id);
		}
		toast(`${failed}: ${(error as Error).message}`, { tone: 'error' });
		onError?.(error as Error);
		return false;
	}
}
