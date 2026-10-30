<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { useRouter } from 'vue-router';

// When the page it goes back to is the previous one, it steps back in history instead: the page comes back as it was
// left, kept alive and scrolled where it was, and the transition plays backwards
const props = defineProps<{ to: string; label: string }>();

const router = useRouter();

function back(event: MouseEvent) {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
		return;
	}
	const previous = window.history.state?.back as string | null | undefined;
	if (previous && router.resolve(previous).path === router.resolve(props.to).path) {
		event.preventDefault();
		router.back();
	}
}
</script>

<template>
	<LnxButton class="back-button" :to="to" mode="clear" shape="circle" :aria-label="label" :title="label" @click.capture="back">
		<LnxIcon icon="lucide:arrow-left" />
	</LnxButton>
</template>
