<script setup lang="ts">
import type { Issue } from '../interfaces/issue';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { issuesCategories, issueStatus } from '../composables/useIssues.ts';

defineProps<{
	issue: Issue;
}>();
</script>

<template>
	<LnxButton :to="`/issues/${issue.id}`" mode="link" class="issue">
		<div class="meta">
			<div
				class="status-dot"
				:style="{ '--badge-color': `var(--color-issue-status-${issue.status})` }"
			>
				<span class="dot" />
				{{ issueStatus.find(status => status.value === issue.status)?.label || 'Sin categoría' }}
			</div>
			<small>
				{{ issue.createdAt.toDate().toLocaleDateString([], { day: 'numeric', month: 'long' }) }}
			</small>
		</div>

		<div class="info">
			<div class="assets">
				<img :src="issue.assets?.[0]?.replace('/upload/', '/upload/c_auto,g_auto,w_50,h_50/').replace('.mp4', '.jpg').replace('.mov', '.jpg')" :alt="issue.title">
				<div
					v-if="(issue.assets?.length || 0) > 1"
					class="assets-count"
				/>
			</div>
			<h3>
				{{ issue.title }}
			</h3>
		</div>

		<div class="status">
			<div class="votes">
				<LnxIcon
					:icon="`mdi:${issue.votesScore > 0 ? 'flame' : 'snowflake'}`"
					:style="{ color: issue.votesScore > 1 ? 'var(--color-issue-vote-hot)' : 'var(--color-issue-vote-cold)' }"
				/>
				{{ issue.votesScore }} votos
			</div>

			<span
				class="badge"
				:style="{
					'--badge-color': `var(--color-issue-cat-${issue.category}-accent)`,
					'--badge-color-bg': `var(--color-issue-cat-${issue.category})`,
				}"
			>
				{{ issuesCategories.find(category => category.value === issue.category)?.label || 'Sin categoría' }}
			</span>
		</div>
	</LnxButton>
</template>

<style scoped lang="scss">
.issue {
	border-radius: calc(var(--lnx-radius-3) + var(--lnx-spacing-2));
	background: var(--color-gray-2);
	padding: var(--lnx-spacing-3) var(--lnx-spacing-4);
	display: flex;
	align-items: flex-start;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	.meta {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);

		.status-dot {
			display: flex;
			align-items: center;
			gap: var(--lnx-spacing-1);
			color: var(--badge-color, var(--color-primary));

			.dot {
				background: var(--badge-color, var(--color-primary));
				width: 10px;
				height: 10px;
				border-radius: var(--lnx-radius-circle);
			}
		}
	}

	.badge {
		padding: 2px var(--lnx-spacing-3);
		border-radius: var(--lnx-radius-4);
		font-size: var(--lnx-font-size-small);
		color: var(--badge-color, var(--color-gray-6));
		background: var(--badge-color-bg, var(--color-gray-4));
	}

	.info {
		width: 100%;
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);

		.assets {
			display: flex;
			position: relative;
			flex-shrink: 0;
			max-width: 50px;
			max-height: 50px;

			img {
				position: relative;
				border-radius: var(--lnx-radius-3);
				z-index: 2;
			}

			.assets-count {
				position: absolute;
				inset: var(--lnx-spacing-1) 0 calc(-1 * var(--lnx-spacing-1)) var(--lnx-spacing-1);
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 0 var(--lnx-spacing-2) 0 var(--lnx-spacing-4);
				background-color: var(--color-gray-5);
				border-radius: var(--lnx-radius-3);
				width: 50px;
				height: 50px;
			}
		}

		h3 {
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			overflow: hidden;
			text-align: left;
		}
	}

	.status {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);

		.votes {
			display: flex;
			align-items: center;
			gap: var(--lnx-spacing-1);
			color: var(--color-gray-6);
		}
	}
}
</style>
