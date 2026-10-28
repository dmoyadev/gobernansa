<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { ref, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import IsotypeSVG from './IsotypeSVG.vue';

const props = defineProps<{
	title?: string;
	// Fallback route of the back button; without it the logo is shown instead
	back?: string;
	// Replaces leaving the page, e.g. to go back a step inside it
	onBack?: () => void;
	// Once this element scrolls under the toolbar, it collapses and shows the title. Without it, it's always collapsed
	reveal?: HTMLElement | null;
}>();

const router = useRouter();
const $toolbar = useTemplateRef('$toolbar');
const collapsed = ref(props.reveal === undefined);

watch(() => props.reveal, (element, _, onCleanup) => {
	if (!element || !$toolbar.value) {
		collapsed.value = false;
		return;
	}

	const height = $toolbar.value.offsetHeight;
	const observer = new IntersectionObserver(([entry]) => {
		// Out of view below the screen does not count, only above
		collapsed.value = !!entry && !entry.isIntersecting && entry.boundingClientRect.top < height;
	}, { rootMargin: `-${height}px 0px 0px 0px` });
	observer.observe(element);
	onCleanup(() => observer.disconnect());
}, { flush: 'post' });

// Going back keeps the previous page's scroll position, but a shared link has no page to go back to
function goBack() {
	if (props.onBack) {
		props.onBack();
	} else if (window.history.state?.back) {
		router.back();
	} else {
		void router.push(props.back!);
	}
}
</script>

<template>
	<div ref="$toolbar" class="toolbar" :class="{ collapsed }">
		<LnxButton
			v-if="back"
			class="back"
			shape="circle"
			aria-label="Volver"
			style="--lnx-button-border: none"
			@click="goBack()"
		>
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>

		<span v-else class="brand">
			<img src="@gobernansa/shared/assets/logo.svg" class="logo" alt="gobernança" width="120" height="40">
			<IsotypeSVG class="isotype" width="32" height="32" aria-hidden="true" />
		</span>

		<!-- Repeats the page's heading, which screen readers already read -->
		<span class="heading">
			<span class="title" aria-hidden="true">{{ title }}</span>
			<slot name="subtitle" />
		</span>

		<slot />
	</div>
</template>

<style>
:root {
	--toolbar-height: calc(40px + 2 * var(--lnx-spacing-4));
}
</style>

<style lang="scss" scoped>
.toolbar {
	view-transition-name: toolbar;
	z-index: 99;
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	height: var(--toolbar-height);
	padding: 0 var(--lnx-spacing-4);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);
	// Here and not in ::before: the view-transition-name keeps children from blurring what is behind
	transition: backdrop-filter .2s;

	// Own layer so the background fades without fading the content
	&::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: color-mix(in srgb, var(--color-gray-0) 85%, transparent);
		box-shadow: 0 1px 0 var(--color-gray-3), 0 4px 12px #0000000A;
		opacity: 0;
		transition: opacity .2s;
	}

	> * {
		flex-shrink: 0;
	}
}

.back {
	background: var(--color-gray-0);
	color: var(--color-gray-9);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000014;
}

.brand {
	position: relative;
	width: 120px;
	height: 40px;
	transition: width .3s cubic-bezier(.2, 0, 0, 1);

	.logo,
	.isotype {
		position: absolute;
		top: 0;
		left: 0;
		transition: opacity .2s, transform .3s cubic-bezier(.2, 0, 0, 1);
	}

	.logo {
		top: 2px;
	}

	.isotype {
		top: 4px;
		color: var(--color-secondary-accent);
		opacity: 0;
		transform: scale(.5) rotate(-90deg);
	}
}

.heading {
	flex: 1 1 0;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);
}

.title {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
	color: var(--color-gray-9);
	font-weight: var(--lnx-font-weight-bold);
	opacity: 0;
	transform: translateY(8px);
	transition: opacity .2s, transform .3s cubic-bezier(.2, 0, 0, 1);
}

.collapsed {
	backdrop-filter: blur(8px);

	&::before,
	.title,
	.brand .isotype {
		opacity: 1;
		transform: none;
	}

	.brand {
		width: 32px;

		.logo {
			opacity: 0;
			transform: translateX(-16px);
		}
	}
}

@media (prefers-reduced-motion: reduce) {
	.toolbar,
	.toolbar::before,
	.toolbar * {
		transition: none;
	}
}
</style>
