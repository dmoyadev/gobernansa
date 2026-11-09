<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { useRouter } from 'vue-router';
import Kbd from './Kbd.vue';
import { goToNew } from './navigation.ts';
import { pressNew } from './newForm.ts';
import { shortcutTitle, useShortcut } from './shortcuts.ts';

// «Nuevo», the same on every page: last in its header, it opens the form for a new one (useNewForm) or goes to its page
// (`to`), also with N. `label` says what it creates, as its tooltip and in the shortcuts sheet
const props = defineProps<{ label: string; to?: RouteLocationRaw; disabled?: boolean }>();
const emit = defineEmits<{ click: [] }>();
const router = useRouter();

// What it opens comes out of it: the form (newForm.ts) or the page (navigation.ts), which a link goes to on its own
function press() {
	if (props.to) {
		goToNew(router.resolve(props.to).path);
	} else {
		pressNew();
		emit('click');
	}
}

function open() {
	press();
	if (props.to) {
		void router.push(props.to);
	}
}

useShortcut('n', open, props.label, () => !props.disabled);
</script>

<template>
	<LnxButton class="new-button" :to="disabled ? undefined : to" :type="disabled || !to ? 'button' : undefined" :disabled="disabled" :title="shortcutTitle(label, 'n')" @click="press()">
		<LnxIcon icon="lucide:plus" />
		Nuevo
		<Kbd combo="n" />
	</LnxButton>
</template>

<style lang="scss" scoped>
// At the right of the header, whatever else it has
.new-button {
	margin-inline-start: auto;
	flex-shrink: 0;
}
</style>
