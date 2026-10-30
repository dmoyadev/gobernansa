<script setup lang="ts">
import type { Issue } from '@gobernansa/shared/domain/issue.ts';
import { getIssueAge } from '@gobernansa/shared/domain/issue.ts';
import { computed } from 'vue';

const props = defineProps<{ issue: Pick<Issue, 'createdAt' | 'status'> }>();

const age = computed(() => getIssueAge(props.issue));
</script>

<template>
	<span v-if="age.level" class="age" :class="{ late: age.level > 1 }" :title="`Abierta hace ${age.days} días`">
		<span aria-hidden="true">{{ '!'.repeat(Math.max(1, age.level - 1)) }}</span>
		<span class="sr-only">Abierta hace {{ age.days }} días</span>
	</span>
</template>

<style lang="scss" scoped>
.age {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 18px;
	height: 18px;
	padding: 0 4px;
	color: var(--color-gray-6);
	font-size: .75rem;
	font-weight: 900;
	letter-spacing: .05em;
	line-height: 1;

	&.late {
		color: #dc2626;
	}
}
</style>
