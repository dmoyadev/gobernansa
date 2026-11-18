<script setup lang="ts">
import { taxIdProblem } from '@gobernansa/shared/domain/aeat.ts';
import { computed } from 'vue';

// A declarado's NIF in a tax return's table, or why it's missing or wrong
const props = defineProps<{ nif?: string }>();
const problem = computed(() => taxIdProblem(props.nif));
</script>

<template>
	<td :class="{ debt: problem }">
		{{ nif ?? problem }}<small v-if="nif && problem"> · {{ problem }}</small>
	</td>
</template>
