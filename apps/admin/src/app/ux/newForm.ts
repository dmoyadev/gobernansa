import type { Ref } from 'vue';
import { useShortcut } from 'lnxjs-components';
import { nextTick, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { pageSettled } from './navigation.ts';

const FIRST_FIELD = 'input:not([type="hidden"]), textarea, select, button';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Into view on its first field, or the one marked autofocus: a form that opens, or the item «Nuevo» adds to one
export function reveal(element: HTMLElement | null | undefined, behavior: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth') {
	(element?.querySelector<HTMLElement>('[autofocus]') ?? element?.querySelector<HTMLElement>(FIRST_FIELD))?.focus({ preventScroll: true });
	element?.scrollIntoView({ block: 'nearest', behavior });
}

// «Nuevo» (NewButton.vue) was just pressed. Its page opens the form at once or after a few awaits (a router.replace), so
// it's forgotten on the next task instead of right after its click
let newPressed = false;
export function pressNew() {
	newPressed = true;
	setTimeout(() => newPressed = false);
}

const SEND = '[type="submit"]';
const canFly = () => 'startViewTransition' in document && !reducedMotion();

// The form «Nuevo» last flew into, so its send button flies back as it closes
let flown: HTMLElement | null | undefined;

// `from` flies to the element `update` returns once it has changed the page, its label fading into that one's. The rest
// of the page is at once as it ends (interactions.scss)
async function fly(from: HTMLElement, update: () => Promise<HTMLElement | null | undefined>) {
	let to: HTMLElement | null | undefined;
	from.style.viewTransitionName = 'new-form';
	document.documentElement.dataset.newForm = '';
	const transition = document.startViewTransition(async () => {
		from.style.viewTransitionName = '';
		to = await update();
		if (to) {
			to.style.viewTransitionName = 'new-form';
		}
	});
	// Cut short by a navigation or a resize, it's simply as it ends
	transition.ready.catch(() => {});
	void transition.finished.finally(() => {
		if (to) {
			to.style.viewTransitionName = '';
		}
		delete document.documentElement.dataset.newForm;
	});
	await transition.updateCallbackDone;
}

// Opens the form `open` puts in the page, on its first field. Opened by «Nuevo», it flies to the button that sends the
// form so it's clear where it went, once the page it's in has come in. Not for those who prefer less motion
export async function openForm(open: () => Promise<HTMLElement | null | undefined>) {
	const flies = newPressed && canFly();
	newPressed = false;
	flown = undefined;
	if (flies) {
		await pageSettled();
	}
	const from = flies ? document.querySelector<HTMLElement>('.new-button') : null;
	if (!from) {
		reveal(await open());
		return;
	}
	await fly(from, async () => {
		const form = await open();
		// Already scrolled to where it lands, or it would land where the button no longer is
		reveal(form, 'instant');
		flown = form;
		return form?.querySelector<HTMLElement>(SEND);
	});
}

// Takes the form out of the page with `close`. If «Nuevo» flew into it, its send button flies back to «Nuevo»
export async function closeForm(form: HTMLElement | null | undefined, close: () => void) {
	const from = form && form === flown && canFly() ? form.querySelector<HTMLElement>(SEND) : null;
	flown = undefined;
	if (!from) {
		close();
		return;
	}
	await fly(from, async () => {
		close();
		await nextTick();
		const button = document.querySelector<HTMLElement>('.new-button');
		button?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
		return button;
	});
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
		return openForm(async () => {
			open.value = true;
			await nextTick();
			return form.value;
		});
	}

	// Emptied at once, so what's set after it is kept, and taken out as its button flies back
	function close() {
		reset?.();
		void closeForm(form.value, () => open.value = false);
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
			// As if its «Nuevo» was pressed, which the page it comes from turned into (navigation.ts)
			pressNew();
			void show();
		}
	});

	useShortcut('escape', close, { description: 'Cerrar el formulario', enabled: () => open.value });
	return { open, show, close };
}
