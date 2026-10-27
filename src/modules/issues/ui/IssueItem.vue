<script setup lang="ts">
import type { Issue } from '../domain/issue.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { issuesCategories, issueStatus } from '../domain/issue.ts';

const props = defineProps<{
	issue: Issue;
}>();

const category = computed(() => issuesCategories.find(category => category.value === props.issue.category));
const status = computed(() => issueStatus.find(status => status.value === props.issue.status));
const thumbnail = computed(() => props.issue.assets?.[0]?.replace('/upload/', '/upload/c_auto,g_auto,w_128,h_128/').replace('.mp4', '.jpg').replace('.mov', '.jpg'));

// Closed issues leave the lifecycle, so they fill the whole bar with their own color
const lifecycle = issueStatus.filter(status => status.value !== 'closed');
const step = computed(() => props.issue.status === 'closed'
	? lifecycle.length
	: lifecycle.findIndex(status => status.value === props.issue.status) + 1);

const relativeTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const date = computed(() => {
	const createdAt = props.issue.createdAt.toDate();
	const days = Math.round((createdAt.getTime() - Date.now()) / 86_400_000);
	return days > -7
		? relativeTime.format(days, 'day')
		: createdAt.toLocaleDateString([], { day: 'numeric', month: 'long' });
});
</script>

<template>
	<LnxButton
		:to="`/issues/${issue.id}`"
		mode="link"
		class="issue"
		:style="{
			'--cat-color': `var(--color-issue-cat-${issue.category}-accent)`,
			'--cat-color-bg': `var(--color-issue-cat-${issue.category})`,
			'--status-color': `var(--color-issue-status-${issue.status})`,
		}"
	>
		<div class="media">
			<img v-if="thumbnail" :src="thumbnail" alt="" width="64" height="64">
			<LnxIcon v-else :icon="category?.icon || 'lucide:triangle-alert'" :size="26" />
			<span
				v-if="(issue.assets?.length || 0) > 1"
				class="assets-count"
			>
				+{{ issue.assets!.length - 1 }}
			</span>
		</div>

		<div class="body">
			<span class="category">
				<LnxIcon v-if="category" :icon="category.icon" :size="12" />
				{{ category?.label || 'Sin categoría' }}
			</span>
			<h3>{{ issue.title }}</h3>
			<small class="date">{{ date }}</small>
		</div>

		<div class="votes" :class="{ hot: issue.votesScore > 0 }">
			<strong>{{ issue.votesScore }}</strong>
			<small>{{ Math.abs(issue.votesScore) === 1 ? 'voto' : 'votos' }}</small>
		</div>

		<div class="progress">
			<span class="steps" aria-hidden="true">
				<span
					v-for="(lifecycleStatus, index) in lifecycle"
					:key="lifecycleStatus.value"
					class="step"
					:class="{ done: index < step }"
				/>
			</span>
			<span class="status">{{ status?.label || 'Sin estado' }}</span>
		</div>
	</LnxButton>
</template>

<style scoped lang="scss">
.issue {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	grid-template-areas:
		'media body votes'
		'progress progress progress';
	align-items: center;
	column-gap: var(--lnx-spacing-3);
	row-gap: var(--lnx-spacing-3);
	padding: var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: calc(var(--lnx-radius-3) + var(--lnx-spacing-2));
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	text-align: left;
	transition: transform .15s;

	&:active {
		transform: scale(.98);
	}

	.media {
		grid-area: media;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		align-self: start;
		width: 64px;
		height: 64px;
		border-radius: var(--lnx-radius-3);
		color: var(--cat-color);
		background: var(--cat-color-bg);

		img {
			width: 100%;
			height: 100%;
			object-fit: cover;
			border-radius: inherit;
		}

		.assets-count {
			position: absolute;
			right: calc(-1 * var(--lnx-spacing-1));
			bottom: calc(-1 * var(--lnx-spacing-1));
			padding: 0 var(--lnx-spacing-1);
			border: 2px solid var(--color-gray-0);
			border-radius: var(--lnx-radius-4);
			background: var(--color-gray-8);
			color: var(--color-gray-0);
			font-size: var(--lnx-font-size-small);
			line-height: 1.4;
		}
	}

	.body {
		grid-area: body;
		display: flex;
		flex-direction: column;
		gap: 2px;

		.category {
			display: flex;
			align-items: center;
			gap: 4px;
			color: var(--cat-color);
			font-size: .7rem;
			font-weight: var(--lnx-font-weight-bold);
			letter-spacing: .04em;
			text-transform: uppercase;
		}

		h3 {
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			overflow: hidden;
			color: var(--color-gray-9);
			font-size: var(--lnx-font-size-body);
			line-height: 1.3;
		}

		.date {
			color: var(--color-gray-6);
		}
	}

	.votes {
		grid-area: votes;
		align-self: start;
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 48px;
		padding: var(--lnx-spacing-2) var(--lnx-spacing-1);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-1);
		color: var(--color-issue-vote-cold);
		line-height: 1.1;

		&.hot {
			background: var(--color-issue-vote-hot);
		}

		strong {
			color: var(--color-gray-9);
			font-size: 1.1rem;
		}

		small {
			color: var(--color-gray-6);
			font-size: .65rem;
		}
	}

	.progress {
		grid-area: progress;
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);

		.steps {
			flex: 1;
			display: flex;
			gap: 4px;
		}

		.step {
			flex: 1;
			height: 4px;
			border-radius: 4px;
			background: var(--color-gray-3);

			&.done {
				background: var(--status-color);
			}
		}

		.status {
			color: var(--status-color);
			font-size: var(--lnx-font-size-small);
			font-weight: var(--lnx-font-weight-bold);
			white-space: nowrap;
		}
	}
}
</style>
