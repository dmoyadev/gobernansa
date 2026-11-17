import { nextTick, ref } from 'vue';

/**
 * The step a wizard is on. Going to another one slides the page forward or back with the View Transitions API, with
 * the same animations as the router between pages (theme/view-transitions.scss), and focuses its heading so screen
 * readers announce the new step
 */
export function useWizardSteps($heading: { readonly value: HTMLElement | null }) {
	const step = ref(0);

	// Each step starts at the top. At once and not smoothly, so the transition's new snapshot is already there
	async function show(index: number) {
		step.value = index;
		await nextTick();
		window.scrollTo({ top: 0 });
		$heading.value?.focus({ preventScroll: true });
	}

	function goTo(index: number) {
		if (!('startViewTransition' in document)) {
			void show(index);
			return;
		}

		document.documentElement.dataset.transition = index < step.value ? 'back' : 'forward';
		const transition = document.startViewTransition(async () => show(index));
		void transition.finished.finally(() => delete document.documentElement.dataset.transition);
	}

	return { step, goTo };
}
