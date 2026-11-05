import type { Ref } from 'vue';
import { nextTick, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useShortcut } from './shortcuts.ts';

const FIRST_FIELD = 'input:not([type="hidden"]), textarea, select, button';

// Into view on its first field: a form that opens, or the item «Nuevo» adds to one
export function reveal(element: HTMLElement | null | undefined) {
	element?.querySelector<HTMLElement>(FIRST_FIELD)?.focus({ preventScroll: true });
	element?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// The form a page's «Nuevo» (NewButton.vue) opens below its header, hidden until then, and the one editing an item of the
// list opens filled. It opens on its first field and closes with Escape or Cancelar, emptied by `reset`. A link to the
// page with ?new opens it once `ready`: what loads above it, or it pushes the form out of view
export function useNewForm(form: Readonly<Ref<HTMLElement | null | undefined>>, reset?: () => void, ready = () => true) {
	const open = ref(false);
	const route = useRoute();
	const router = useRouter();
	const linked = ref(false);

	async function show() {
		open.value = true;
		await nextTick();
		reveal(form.value);
	}

	function close() {
		open.value = false;
		reset?.();
	}

	function openFromLink() {
		// Opened once the router is done, or its scroll to the top of the page cancels the one to the form
		if ('new' in route.query) {
			void router.replace({ query: { ...route.query, new: undefined } }).then(() => linked.value = true);
		}
	}
	onMounted(openFromLink);
	onActivated(openFromLink);
	watch(() => linked.value && ready(), (go) => {
		if (go) {
			linked.value = false;
			void show();
		}
	});

	useShortcut('escape', close, 'Cerrar el formulario', () => open.value);
	return { open, show, close };
}
