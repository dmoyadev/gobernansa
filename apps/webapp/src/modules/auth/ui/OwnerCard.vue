<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { propertyTypeIcons, propertyTypeLabels } from '@gobernansa/shared/domain/property.ts';
import IsotypeSVG from '@gobernansa/shared/ui/IsotypeSVG.vue';
import { LnxIcon } from 'lnxjs-components';

// The owner's card of the property picked, like a membership card
defineProps<{ property: Property; community?: Pick<Community, 'name' | 'address'> | null; owner?: string }>();
</script>

<template>
	<div class="owner-card">
		<IsotypeSVG class="watermark" width="200" height="200" aria-hidden="true" />
		<div class="top">
			<small>Propietario/a</small>
			<span>{{ community?.name }}</span>
		</div>

		<div class="property">
			<span class="icon">
				<LnxIcon :icon="propertyTypeIcons[property.type]" :size="24" />
			</span>
			<div>
				<h2>{{ property.name }}</h2>
				<p>{{ propertyTypeLabels[property.type] }}</p>
			</div>
		</div>

		<dl>
			<div>
				<dt>Titular</dt>
				<dd>{{ owner }}</dd>
			</div>
			<div v-if="community?.address">
				<dt>Dirección</dt>
				<dd>{{ community.address }}</dd>
			</div>
		</dl>
	</div>
</template>

<style lang="scss" scoped>
.owner-card {
	position: relative;
	overflow: hidden;
	aspect-ratio: 1.586; // Credit card proportions
	padding: var(--lnx-spacing-4);
	border-radius: inherit;
	background:
		radial-gradient(circle at 100% 0%, #e1616233, transparent 50%),
		linear-gradient(160deg, var(--color-gray-0) 0%, var(--color-gray-2) 100%);
	border: 1px solid var(--color-gray-3);
	color: var(--color-gray-9);
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: var(--lnx-spacing-3);

	.watermark {
		position: absolute;
		right: -50px;
		bottom: -60px;
		color: #e161621A;
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);

		small {
			color: var(--color-secondary-accent);
			font-size: .75rem;
			font-weight: var(--lnx-font-weight-bold);
			letter-spacing: .08em;
			text-transform: uppercase;
		}

		span {
			overflow: hidden;
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.property {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);

		.icon {
			flex-shrink: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 48px;
			height: 48px;
			border-radius: var(--lnx-radius-3);
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}

		h2 {
			font-size: 1.4rem;
			line-height: 1.2;
		}

		p {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
		}
	}

	dl {
		display: flex;
		gap: var(--lnx-spacing-4);

		div {
			min-width: 0;
		}

		dt {
			color: var(--color-gray-6);
			font-size: .75rem;
			letter-spacing: .08em;
			text-transform: uppercase;
		}

		dd {
			overflow: hidden;
			font-weight: var(--lnx-font-weight-bold);
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
}
</style>
