import { onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive } from 'vue';

export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

const SEQUENCE_MS = 1000;
const SEPARATOR_REGEX = /[ +]/;
const TEXT_FIELDS = 'textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=file], [type=range], [type=color])';
const KEY_LABELS: Record<string, string> = {
	mod: isMac ? '⌘' : 'Ctrl',
	alt: isMac ? '⌥' : 'Alt',
	shift: '⇧',
	enter: '↵',
	escape: 'Esc',
	arrowup: '↑',
	arrowdown: '↓',
	arrowleft: '←',
	arrowright: '→',
	backspace: '⌫',
};

// Typing in a field: single keys are text there, only shortcuts with ⌘/Ctrl apply
export function isTyping(target: EventTarget | null) {
	return target instanceof HTMLElement && !!target.closest(TEXT_FIELDS);
}

// The keys to show for a combo such as 'mod+enter' or 'g i'
export function shortcutKeys(combo: string) {
	return combo.split(SEPARATOR_REGEX).map(key => KEY_LABELS[key] ?? key.toUpperCase());
}

export function shortcutTitle(label: string, combo: string) {
	return `${label} (${shortcutKeys(combo).join(isMac ? '' : '+')})`;
}

// Kept alive pages are only deactivated, so anything listening must stop then too
export function useEventListener<K extends keyof WindowEventMap>(target: Window | Document, type: K, handler: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions) {
	let attached = false;
	const on = () => {
		if (!attached) {
			target.addEventListener(type, handler as EventListener, options);
			attached = true;
		}
	};
	const off = () => {
		target.removeEventListener(type, handler as EventListener, options);
		attached = false;
	};
	onMounted(on);
	onActivated(on);
	onDeactivated(off);
	onBeforeUnmount(off);
}

interface Binding { combo: string; description?: string; handler: (event: KeyboardEvent) => void; enabled?: () => boolean }

// The newest wins, so a page's `n` takes over the layout's. Listed in the shortcuts sheet when described
export const bindings = reactive<Binding[]>([]);

// combo: keys joined with '+' (mod is ⌘ on Mac, Ctrl elsewhere), and a space for sequences: 'mod+enter', 'n', 'g i', '?'.
// While `enabled` says no it's as if it weren't there, e.g. an Escape that only cancels an open editor
export function useShortcut(combo: string, handler: (event: KeyboardEvent) => void, description?: string, enabled?: () => boolean) {
	const binding: Binding = { combo, description, handler, enabled };
	const on = () => {
		if (!bindings.includes(binding)) {
			bindings.push(binding);
		}
	};
	const off = () => {
		const index = bindings.indexOf(binding);
		if (index !== -1) {
			bindings.splice(index, 1);
		}
	};
	onMounted(on);
	onActivated(on);
	onDeactivated(off);
	onBeforeUnmount(off);
}

let pending: { key: string; at: number } | undefined;

function comboOf(event: KeyboardEvent) {
	const key = event.key.toLowerCase();
	const printable = key.length === 1;
	return [
		...((isMac ? event.metaKey : event.ctrlKey) ? ['mod'] : []),
		...(event.altKey ? ['alt'] : []),
		// ? or ! already carry the shift in their key
		...(event.shiftKey && !printable ? ['shift'] : []),
		key,
	].join('+');
}

function onKeydown(event: KeyboardEvent) {
	if (event.defaultPrevented || event.repeat || event.isComposing || ['meta', 'control', 'alt', 'shift'].includes(event.key.toLowerCase())) {
		return;
	}
	const combo = comboOf(event);
	const typing = isTyping(event.target);
	const sequence = pending && event.timeStamp - pending.at < SEQUENCE_MS ? `${pending.key} ${combo}` : undefined;
	pending = undefined;

	const find = (wanted: string) => bindings.findLast(binding => binding.combo === wanted && (binding.enabled?.() ?? true) && (!typing || binding.combo.includes('mod+') || binding.combo === 'escape'));
	const binding = (sequence && find(sequence)) || find(combo);
	if (binding) {
		event.preventDefault();
		binding.handler(event);
		return;
	}
	if (!typing && bindings.some(candidate => candidate.combo.startsWith(`${combo} `))) {
		pending = { key: combo, at: event.timeStamp };
	}
}

window.addEventListener('keydown', onKeydown);
