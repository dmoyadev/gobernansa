<script setup lang="ts">
import type { Checkout } from '../application/useMyCharges.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { useTemplateRef } from 'vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheToolbar from '@/shared/ui/TheToolbar.vue';
import { useWizardSteps } from '@/shared/ui/useWizardSteps.ts';
import TestCheckout from './TestCheckout.vue';

// Paying from the app in three steps, like reporting an issue: what's paid, the card, and its justificante
const props = defineProps<{
	title: string;
	// Where it leaves to, and its button's text once paid
	back: string;
	backLabel: string;
	loading: boolean;
	// Why it can't be paid, shown instead of what's paid
	unavailable?: string;
	amount: number;
	concept: string;
	continueLabel?: string;
	// Writes the payment, the checkout shows its errors
	pay: (checkout: Checkout) => Promise<unknown>;
}>();

const STEPS = ['¿Qué vas a pagar?', 'Datos de pago', 'Pago completado'];

const { userCommunity } = useUserCommunity();

const $heading = useTemplateRef('$heading');
const { step, goTo } = useWizardSteps($heading);

async function pay(checkout: Checkout) {
	await props.pay(checkout);
	goTo(2);
}

function print() {
	window.print();
}
</script>

<template>
	<TheToolbar
		:title="title"
		:back="back"
		:on-back="step === 1 ? () => goTo(0) : undefined"
	>
		<template #subtitle>
			<span class="progress">
				<span class="bar" aria-hidden="true">
					<span
						v-for="(_, index) in STEPS"
						:key="index"
						:class="{ done: index <= step }"
					/>
				</span>
				Paso {{ step + 1 }} de {{ STEPS.length }}
			</span>
		</template>
	</TheToolbar>

	<header>
		<h1 ref="$heading" tabindex="-1">
			{{ STEPS[step] }}
		</h1>
	</header>

	<!-- .wizard also hides the tab bar -->
	<MainLayout class="wizard">
		<div v-if="step === 0" class="step">
			<template v-if="unavailable">
				<p class="unavailable" role="alert">
					<LnxIcon icon="lucide:circle-alert" :size="20" class="unavailable-icon" />
					{{ unavailable }}
				</p>
				<slot name="unavailable">
					<LnxButton :to="back" mode="outline" class="size-large" is-block>
						{{ backLabel }}
					</LnxButton>
				</slot>
			</template>

			<div v-else-if="loading" class="loading" aria-busy="true" aria-label="Cargando">
				<span class="skeleton-item skeleton-item--title" style="width: 50%" />
				<span v-for="width in [80, 65, 70, 55]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
			</div>

			<template v-else>
				<section class="amount">
					<small>Vas a pagar</small>
					<strong class="tabular">{{ formatCents(amount) }}</strong>
					<span>a {{ userCommunity?.name }}</span>
				</section>

				<dl class="details">
					<slot name="details" />
					<div class="total">
						<dt>Total a pagar</dt>
						<dd class="tabular">
							{{ formatCents(amount) }}
						</dd>
					</div>
				</dl>

				<slot />

				<LnxButton class="size-large" is-block @click="goTo(1)">
					{{ continueLabel ?? 'Continuar al pago' }}
					<template #suffix>
						<LnxIcon icon="lucide:arrow-right" />
					</template>
				</LnxButton>
			</template>
		</div>

		<div v-else-if="step === 1" class="step">
			<TestCheckout
				:amount="amount"
				:concept="concept"
				:pay="pay"
				@cancel="goTo(0)"
			/>
		</div>

		<div v-else class="step">
			<div class="success" role="status">
				<LnxIcon icon="lucide:circle-check" :size="56" class="success-icon" />
				<strong class="tabular">Has pagado {{ formatCents(amount) }}</strong>
				<span>{{ concept }}</span>
			</div>

			<div class="actions">
				<LnxButton class="size-large" is-block @click="print()">
					<template #prefix>
						<LnxIcon icon="lucide:download" />
					</template>
					Descargar justificante
				</LnxButton>
				<small>Se abre la ventana de imprimir: elige «Guardar como PDF».</small>
				<LnxButton :to="back" mode="clear" is-block>
					{{ backLabel }}
				</LnxButton>
			</div>

			<slot name="receipt" />
		</div>
	</MainLayout>
</template>

<style lang="scss" scoped>
header {
	// Starts below the fixed toolbar, which is always shown
	padding: calc(var(--toolbar-height) + var(--lnx-spacing-4)) var(--lnx-spacing-4) 0;

	h1 {
		color: var(--color-gray-9);
		line-height: 1.2;
		// Focused by code to announce each step, not by the user
		outline: none;
	}
}

.progress {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;

	.bar {
		flex: 1;
		display: flex;
		gap: var(--lnx-spacing-1);

		span {
			flex: 1;
			height: 6px;
			border-radius: 6px;
			background: var(--color-gray-3);
			transition: background .3s;

			&.done {
				background: var(--color-primary);
			}
		}
	}
}

.step {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-5);
}

.loading {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.amount {
	padding: var(--lnx-spacing-5) var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-1);
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	color: var(--color-gray-7);

	small {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		text-transform: uppercase;
		letter-spacing: .04em;
	}

	strong {
		color: var(--color-gray-9);
		font-size: 2.5rem;
		line-height: 1.2;
	}
}

// Its rows come from each page, through the slot
.details {
	padding: 0 var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);

	> :deep(div) {
		min-height: 52px;
		padding: var(--lnx-spacing-2) 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-3);

		& + div {
			border-top: 1px solid var(--color-gray-2);
		}
	}

	:deep(dt) {
		flex-shrink: 0;
		color: var(--color-gray-6);
	}

	:deep(dd) {
		color: var(--color-gray-9);
		font-weight: var(--lnx-font-weight-bold);
		text-align: right;
		overflow-wrap: anywhere;
	}

	:deep(.overdue) {
		color: var(--color-secondary-accent);
	}

	.total {
		font-size: var(--lnx-font-size-big);

		dt {
			color: var(--color-gray-9);
			font-weight: var(--lnx-font-weight-bold);
		}
	}
}

.unavailable {
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-9);
	font-weight: var(--lnx-font-weight-bold);

	.unavailable-icon {
		flex-shrink: 0;
		color: var(--lnx-color-danger);
	}
}

.success {
	padding: var(--lnx-spacing-4) 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-1);
	text-align: center;
	color: var(--color-gray-7);

	.success-icon {
		margin-bottom: var(--lnx-spacing-2);
		color: var(--color-issue-status-resolved);
	}

	strong {
		color: var(--color-gray-9);
		font-size: 1.6rem;
		line-height: 1.2;
	}
}

.actions {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
}

// Only the justificante goes on paper
@media print {
	header,
	.success,
	.actions {
		display: none;
	}

	.wizard {
		min-height: auto;
		padding: 0;
	}
}
</style>
