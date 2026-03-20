import type { Slot } from 'vue';
import { Comment } from 'vue';

/**
 * Capitalizes the first letter of a string
 * @param {string} str - The string to capitalize
 *
 * @returns {string} The capitalized string
 */
export function capitalize(str: string): string {
	const lowercase = str.toLowerCase();
	return lowercase.charAt(0).toUpperCase() + lowercase.slice(1);
}

/**
 * Capitalizes the first letter of each word in a string
 * @param {string} str - The string to capitalize
 *
 * @returns {string} The capitalized string
 */
export function capitalizeAll(str: string): string {
	return str
		.split(' ')
		.map(word => capitalize(word))
		.join(' ');
}

/**
 * Normalize a string by removing accents and special characters, lower-casing it and removing spaces at the
 * beginning and end, but not in the middle.
 * @param str - string to normalize
 *
 * @returns string - normalized string
 */
export function normalize(str?: string) {
	if (!str) {
		return '';
	}

	return String(str)
		.normalize('NFD') // Normalize to decomposed form
		.replace(/[\u0300-\u036F]/g, '') // Remove combining diacritical marks
		.replace(/[^a-z0-9 ]/gi, '') // Remove non-alphanumeric characters but spaces
		.toLowerCase() // Lowercase
		.trim() // Remove spaces at the beginning and end
	;
}

/**
 * Checks if a slot has content to be rendered (not empty)
 * @see https://github.com/vuejs/core/issues/4733#issuecomment-1244011992
 *
 * @param {Slot} slot - The slot to check
 * @param {any} slotProps - The props to pass to the slot
 *
 * @returns {boolean} True if the slot has content, false otherwise
 */
export function hasSlotContent(slot?: Slot, slotProps: any = {}): boolean {
	if (!slot) {
		return false;
	}

	return slot(slotProps).some((vnode) => {
		if (Array.isArray(vnode.children)) {
			return !!vnode.children.length;
		}

		return vnode.type !== Comment;
	});
}
