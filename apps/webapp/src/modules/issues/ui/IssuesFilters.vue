<script setup lang="ts">
import type { IssueCategory, IssueStatus } from '@gobernansa/shared/domain/issue.ts';
import { issuesCategories, issueStatus } from '@gobernansa/shared/domain/issue.ts';
import { LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { useCurrentUser } from 'vuefire';

const status = defineModel<IssueStatus>('status');
const category = defineModel<IssueCategory>('category');
const createdBy = defineModel<string>('createdBy');

const user = useCurrentUser();

const selectedCategory = computed(() => issuesCategories.find(option => option.value === category.value));
</script>

<template>
	<div class="filters">
		<fieldset class="tabs">
			<legend class="sr-only">
				Estado
			</legend>

			<label
				v-for="option in [{ value: undefined, label: 'Todas' }, ...issueStatus]"
				:key="option.label"
				class="tab"
				:class="{ active: status === option.value }"
				:style="{ '--status-color': option.value ? `var(--color-issue-status-${option.value})` : 'var(--color-primary)' }"
			>
				<input
					v-model="status"
					type="radio"
					name="status"
					:value="option.value"
				>
				{{ option.label }}
			</label>
		</fieldset>

		<div
			class="categories"
			role="group"
			aria-labelledby="category-filter-label"
		>
			<div class="categories-header">
				<p id="category-filter-label" class="categories-label">
					Categoría
					<strong>{{ selectedCategory?.label || 'Todas' }}</strong>
				</p>

				<button
					type="button"
					class="mine"
					:class="{ active: !!createdBy }"
					:aria-pressed="!!createdBy"
					@click="createdBy = createdBy ? undefined : user?.uid"
				>
					<LnxIcon icon="lucide:user" :size="14" />
					Mis incidencias
				</button>
			</div>

			<div class="tiles">
				<button
					v-for="option in issuesCategories"
					:key="option.value"
					type="button"
					class="tile"
					:class="{ active: category === option.value }"
					:aria-pressed="category === option.value"
					:aria-label="option.label"
					:title="option.label"
					:style="{
						'--cat-color': `var(--color-issue-cat-${option.value}-accent)`,
						'--cat-color-bg': `var(--color-issue-cat-${option.value})`,
					}"
					@click="category = category === option.value ? undefined : option.value"
				>
					<LnxIcon :icon="option.icon" :size="20" />
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped lang="scss">
.filters {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
}

.tabs {
	display: flex;
	gap: var(--lnx-spacing-1);
	overflow-x: auto;
	scrollbar-width: none;
	mask-image: linear-gradient(to right, #000 85%, transparent);
	border-bottom: 1px solid var(--color-gray-3);
	margin: 0 calc(-1 * var(--lnx-spacing-4));
	padding: 0 var(--lnx-spacing-4);

	.tab {
		position: relative;
		flex-shrink: 0;
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		color: var(--color-gray-6);
		white-space: nowrap;
		cursor: pointer;
		transition: color .2s;

		&::after {
			content: '';
			position: absolute;
			left: var(--lnx-spacing-2);
			right: var(--lnx-spacing-2);
			bottom: -1px;
			height: 3px;
			border-radius: 3px 3px 0 0;
			background: var(--status-color);
			transform: scaleX(0);
			transition: transform .2s;
		}

		&.active {
			color: var(--color-gray-9);
			font-weight: var(--lnx-font-weight-bold);

			&::after {
				transform: scaleX(1);
			}
		}

		&:has(:focus-visible) {
			outline: 2px solid var(--color-primary-light);
			outline-offset: -2px;
			border-radius: var(--lnx-radius-3);
		}

		input {
			position: absolute;
			opacity: 0;
			pointer-events: none;
		}
	}
}

.categories {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	.categories-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
	}

	.mine {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px var(--lnx-spacing-2);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-4);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		cursor: pointer;
		transition: background .15s, color .15s, border-color .15s;

		&.active {
			border-color: var(--color-primary);
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}
	}

	.categories-label {
		font-size: var(--lnx-font-size-small);
		color: var(--color-gray-6);

		strong {
			color: var(--color-gray-9);
			margin-left: var(--lnx-spacing-1);
		}
	}

	.tiles {
		display: flex;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
	}

	.tile {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: var(--lnx-radius-circle);
		color: var(--cat-color);
		background: var(--cat-color-bg);
		cursor: pointer;
		transition: transform .15s, box-shadow .15s, background .15s, color .15s;

		&:active {
			transform: scale(.92);
		}

		&.active {
			color: var(--cat-color-bg);
			background: var(--cat-color);
			box-shadow: 0 0 0 3px var(--color-gray-0), 0 0 0 5px var(--cat-color);
		}
	}
}
</style>
