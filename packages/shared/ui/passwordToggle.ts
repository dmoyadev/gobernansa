import type { Directive } from 'vue';

// The eye button of an LnxInput of type password has no name for screen readers, and the library takes none (C4,
// docs/v1.md). ponytail: belongs in lnxjs-components; drop this once it names the button
export const vPasswordToggle: Directive<HTMLElement> = {
	mounted(el) {
		const button = el.querySelector<HTMLButtonElement>('button.btn-icon');
		if (!button) {
			return;
		}
		button.setAttribute('aria-label', 'Mostrar la contraseña');
		button.setAttribute('aria-pressed', 'false');
		button.addEventListener('click', () => {
			button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
		});
	},
};
