<script setup lang="ts">
import { computed } from 'vue';
import { formatIban } from '../domain/community.ts';
import IsotypeSVG from './IsotypeSVG.vue';
import TiltCard from './TiltCard.vue';

// The community's fiscal data as a business card, the same the neighbours see in the webapp and the admin in its page
const props = defineProps<{
	name: string;
	address?: string;
	cif?: string;
	iban?: string;
	bank?: string;
	emptyText: string;
	// Fills its container instead of keeping the card proportions, with smaller type
	compact?: boolean;
}>();

const fiscalData = computed(() => [
	{ label: 'CIF', value: props.cif },
	{ label: 'IBAN', value: props.iban && formatIban(props.iban) },
	{ label: 'Banco', value: props.bank },
].filter((item): item is { label: string; value: string } => !!item.value));
</script>

<template>
	<TiltCard :class="{ compact }">
		<div class="business-card">
			<IsotypeSVG class="watermark" width="180" height="180" aria-hidden="true" />
			<div class="brand">
				<small>Comunidad de propietarios</small>
				<h2>{{ name }}</h2>
				<p v-if="address">
					{{ address }}
				</p>
			</div>

			<!-- e.g. a link stretched over the card, inside it so the card still tilts under the pointer -->
			<slot />

			<dl v-if="fiscalData.length">
				<div v-for="item in fiscalData" :key="item.label" :class="{ wide: item.label === 'IBAN' }">
					<dt>{{ item.label }}</dt>
					<dd>{{ item.value }}</dd>
				</div>
			</dl>
			<p v-else class="no-data">
				{{ emptyText }}
			</p>
		</div>
	</TiltCard>
</template>

<style lang="scss" scoped>
.business-card {
	position: relative;
	overflow: hidden;
	aspect-ratio: 1.586; // Credit card proportions
	padding: var(--lnx-spacing-5) var(--lnx-spacing-4) var(--lnx-spacing-4);
	border-radius: inherit;
	background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
	color: var(--color-primary-accent);
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: var(--lnx-spacing-3);

	.watermark {
		position: absolute;
		right: -40px;
		bottom: -50px;
		color: var(--color-gray-0-alpha);
	}

	.brand {
		small {
			color: var(--color-secondary-accent);
			font-size: .7rem;
			font-weight: var(--lnx-font-weight-bold);
			letter-spacing: .08em;
			text-transform: uppercase;
		}

		h2 {
			font-size: 1.3rem;
			line-height: 1.2;
		}

		p {
			color: var(--color-primary-accent-alpha);
			font-size: var(--lnx-font-size-small);
		}
	}

	dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--lnx-spacing-2) var(--lnx-spacing-4);

		.wide {
			grid-column: 1 / -1;
			order: -1;
		}

		dt {
			color: var(--color-primary-accent-alpha);
			font-size: .65rem;
			letter-spacing: .08em;
			text-transform: uppercase;
		}

		dd {
			font-family: var(--font-family-mono);
			font-size: .95rem;
			letter-spacing: .04em;
			white-space: nowrap;
		}
	}

	.no-data {
		color: var(--color-primary-accent-alpha);
		font-size: var(--lnx-font-size-small);
	}
}

// Sized by its container, e.g. a tile of a grid
.compact {
	height: 100%;

	:deep(.card) {
		height: 100%;
	}

	.business-card {
		height: 100%;
		aspect-ratio: auto;
		padding: var(--lnx-spacing-3) var(--lnx-spacing-4);
		gap: var(--lnx-spacing-1);

		.brand {
			min-width: 0;

			h2 {
				overflow: hidden;
				font-size: 1.05rem;
				white-space: nowrap;
				text-overflow: ellipsis;
			}

			p {
				overflow: hidden;
				white-space: nowrap;
				text-overflow: ellipsis;
			}
		}

		dl {
			gap: 2px var(--lnx-spacing-4);
		}

		dd {
			overflow: hidden;
			font-size: .85rem;
			text-overflow: ellipsis;
		}
	}
}
</style>
