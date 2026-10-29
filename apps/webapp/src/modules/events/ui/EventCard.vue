<script setup lang="ts">
import type { Event } from '@gobernansa/shared/domain/event.ts';
import { eventTypes } from '@gobernansa/shared/domain/event.ts';
import { LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';

const props = defineProps<{
	event: Event;
	small?: boolean;
}>();

const MONTHS = [
	'Ene',
	'Feb',
	'Mar',
	'Abr',
	'May',
	'Jun',
	'Jul',
	'Ago',
	'Sep',
	'Oct',
	'Nov',
	'Dic',
];

// Colours of each type, its label and icon are shared with the admin
const typeColors: Record<Event['type'], { color: string; bgColor: string }> = {
	community: { bgColor: '#eef4ff', color: '#335fa5' },
	maintenance: { bgColor: '#fae5d9', color: '#af6228' },
	improvements: { bgColor: '#def1dc', color: '#3c8924' },
	notice: { bgColor: '#fde8e8', color: '#b42318' },
	other: { bgColor: '#e7e7e7', color: '#393939' },
};

const typeData = computed(() => ({ ...eventTypes[props.event.type || 'other'], ...typeColors[props.event.type || 'other'] }));
</script>

<template>
	<div class="event-card" :class="{ 'has-line': !small }">
		<LnxIcon class="icon" :icon="typeData?.icon" :size="20" />

		<div class="info">
			<div class="metadata">
				<span class="date">
					{{ event.date.toDate().getDate() }} {{ MONTHS[event.date.toDate().getMonth()] }} {{ event.date.toDate().getFullYear() }}
				</span>
				<div class="tag">
					{{ typeData?.label }}
				</div>
			</div>

			<h3>{{ event.title }}</h3>

			<p v-if="!small">
				{{ event.description }}
			</p>
		</div>
	</div>
</template>

<style scoped lang="scss">
.event-card {
	position: relative;
	display: flex;
	gap: var(--lnx-spacing-4);

	&.has-line:before {
		content: '';
		position: absolute;
		top: 36px;
		bottom: calc(-1 * var(--lnx-spacing-4));
		left: 18px;
		width: 1px;
		background: var(--color-gray-4);
		border-radius: 2px;
	}

	.icon {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 3px solid v-bind('typeData.bgColor');
		color: v-bind('typeData.color');
		border-radius: var(--lnx-radius-circle);
		flex-shrink: 0;
		z-index: 1;
	}

	.info {
		border: 1px solid v-bind('typeData.bgColor');
		border-radius: var(--lnx-radius-3);
		padding: var(--lnx-spacing-2);
		width: 100%;

		.metadata {
			width: 100%;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--lnx-spacing-2);
			text-transform: uppercase;

			.date {
				font-weight: var(--lnx-font-weight-thin);
				flex-shrink: 0;
				font-size: .6em;
				color: v-bind('typeData.color');
			}

			.tag {
				background: v-bind('typeData.bgColor');
				color: v-bind('typeData.color');
				padding: 2px var(--lnx-spacing-1);
				border-radius: var(--lnx-radius-3);
				font-weight: var(--lnx-font-weight-bold);
				font-size: .5em;
			}
		}

		h3 {
			font-size: var(--lnx-font-size-body);
			font-weight: var(--lnx-font-weight-regular);
		}

		p {
			color: var(--color-gray-5);
			font-size: var(--lnx-font-size-small);
			font-weight: var(--lnx-font-weight-thin);
		}
	}
}
</style>
