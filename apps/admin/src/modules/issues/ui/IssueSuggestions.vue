<script setup lang="ts">
// Loaded lazily by the issue page, with writing.ts: the urgency and the trade the text points to, and a summary of the
// conversation on request
import type { IssueSuggestion, Summary } from '@gobernansa/shared/application/writing.ts';
import type { Issue, IssueComment } from '@gobernansa/shared/domain/issue.ts';
import { suggestIssueByRules, suggestIssueOnce, summarize, urgencies } from '@gobernansa/shared/application/writing.ts';
import { providerCategories } from '@gobernansa/shared/domain/provider.ts';
import WritingSource from '@gobernansa/shared/ui/WritingSource.vue';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';

const props = defineProps<{ issue: Issue; comments: IssueComment[] }>();
const emit = defineEmits<{ suggest: [suggestion: IssueSuggestion | undefined] }>();

const suggestion = ref<IssueSuggestion>();
// The rules at once, so the page opens as fast as before, and the on-device one when it comes
const key = () => `${props.issue.id}\n${props.issue.title}\n${props.issue.description}`;
watch(key, async (current) => {
	const { id, title, description } = props.issue;
	suggestion.value = suggestIssueByRules({ title, description });
	emit('suggest', suggestion.value);
	const result = await suggestIssueOnce(id, { title, description });
	if (result?.source === 'device' && current === key()) {
		suggestion.value = result;
		emit('suggest', result);
	}
}, { immediate: true });

const provider = computed(() => suggestion.value?.provider && suggestion.value.provider !== 'other' ? providerCategories[suggestion.value.provider] : undefined);

// From the comments the page already has, no reads
const hasComments = computed(() => props.comments.some(comment => !comment.hiddenAt));
const summary = ref<Summary>();
const summarizing = ref<string>();

async function runSummary() {
	summarizing.value = 'Resumiendo…';
	summary.value = await summarize(props.issue, props.comments, (status) => {
		summarizing.value = status;
	});
	summarizing.value = undefined;
}
</script>

<template>
	<section class="card">
		<header>
			<h2>Sugerencias y redacción automática</h2>
			<WritingSource v-if="suggestion" :source="suggestion.source" />
		</header>

		<template v-if="suggestion">
			<p class="urgency" :class="suggestion.urgency">
				<LnxIcon :icon="urgencies[suggestion.urgency].icon" :size="16" />
				<strong>Urgencia {{ urgencies[suggestion.urgency].label.toLowerCase() }}</strong>
				<span>· {{ suggestion.reason }}</span>
			</p>
			<p v-if="suggestion.hint" class="hint">
				{{ suggestion.hint }}
			</p>
			<p v-if="provider" class="trade">
				<LnxIcon :icon="provider.icon" :size="16" />
				<span>Gremio: <strong>{{ provider.label }}</strong>. Sus proveedores salen primero al asignar.</span>
			</p>
		</template>

		<div v-if="hasComments" class="summary">
			<LnxButton mode="outline" size="small" :is-loading="!!summarizing" @click="runSummary()">
				<LnxIcon icon="lucide:list" />
				{{ summarizing ?? (summary ? 'Resumir de nuevo' : 'Resumir') }}
			</LnxButton>
			<template v-if="summary">
				<ul>
					<li v-for="point in summary.points" :key="point">
						{{ point }}
					</li>
				</ul>
				<WritingSource :source="summary.source" />
			</template>
		</div>
	</section>
</template>

<style lang="scss" scoped>
.card {
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	header {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
	}

	h2 {
		flex: 1;
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.urgency,
.trade {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);
	font-size: var(--lnx-font-size-small);
}

.urgency {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-1);
	color: var(--color-gray-8);

	&.low {
		background: #e0f2fe;
		color: #0369a1;
	}

	&.high {
		background: #fef3c7;
		color: #b45309;
	}

	&.urgent {
		background: #fee2e2;
		color: #dc2626;
	}
}

.summary {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);

	ul {
		padding-left: var(--lnx-spacing-4);
		list-style: disc;
		font-size: var(--lnx-font-size-small);
		line-height: 1.5;
	}
}

.hint {
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
}
</style>
