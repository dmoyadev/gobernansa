<script setup lang="ts">
import type { OnlinePaymentMethod } from '@gobernansa/shared/domain/payment.ts';
import type { Checkout } from '../application/useMyCharges.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { checkTestCard, onlinePaymentMethods, TEST_CARD } from '@gobernansa/shared/domain/payment.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { ref, watch } from 'vue';

// A checkout that looks like a card or Bizum payment, in test mode: nothing is charged and only test cards are taken
const props = defineProps<{
	amount: number;
	concept: string;
	// Writes the payment, the checkout shows its errors
	pay: (checkout: Checkout) => Promise<unknown>;
}>();
const emit = defineEmits<{ cancel: [] }>();

const NON_DIGITS_REGEX = /\D/g;
const GROUPS_OF_4_REGEX = /(\d{4})(?=\d)/g;
// The time a real checkout takes to answer, so it doesn't look instant
const PROCESSING_MS = 900;

const method = ref<OnlinePaymentMethod>('card');
const number = ref('');
const expiry = ref('');
const cvc = ref('');
const error = ref<string>();
const busy = ref(false);

// As printed on the card, in groups of 4
watch(number, (value) => {
	const formatted = value.replace(NON_DIGITS_REGEX, '').slice(0, 16).replace(GROUPS_OF_4_REGEX, '$1 ');
	if (formatted !== value) {
		number.value = formatted;
	}
});

function useTestCard() {
	number.value = TEST_CARD;
	expiry.value = `12/${String(new Date().getFullYear() + 3).slice(-2)}`;
	cvc.value = '123';
	error.value = undefined;
}

async function submit() {
	if (busy.value) {
		return;
	}
	error.value = undefined;
	busy.value = true;
	try {
		await new Promise(resolve => setTimeout(resolve, PROCESSING_MS));
		if (method.value === 'bizum') {
			await props.pay({ method: 'bizum' });
			return;
		}
		const check = checkTestCard(number.value, expiry.value, cvc.value);
		if (!check.ok) {
			error.value = check.error;
			return;
		}
		// Only the brand and the last digits leave the form, the number is forgotten
		number.value = '';
		cvc.value = '';
		await props.pay({ method: 'card', card: check.card });
	} catch (e) {
		reportError(e, { action: 'Pagar el recibo' });
		error.value = 'No se ha podido registrar el pago. Inténtalo de nuevo.';
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<form class="checkout" aria-live="polite" @submit.prevent="submit()">
		<header>
			<h2>Pagar {{ formatCents(amount) }}</h2>
			<span class="test-badge">Modo de prueba</span>
		</header>
		<p class="concept">
			{{ concept }}
		</p>
		<p class="test-note">
			<LnxIcon icon="lucide:flask-conical" :size="16" />
			<span>No se cobra nada: tu comunidad está probando los pagos online. <strong>No introduzcas una tarjeta real</strong>, usa la de prueba 4242 4242 4242 4242.</span>
		</p>

		<fieldset class="methods">
			<legend class="sr-only">
				Forma de pago
			</legend>
			<label v-for="(label, value) in onlinePaymentMethods" :key="value" :class="{ active: method === value }">
				<input v-model="method" type="radio" name="method" class="sr-only" :value="value">
				<LnxIcon :icon="value === 'card' ? 'lucide:credit-card' : 'lucide:smartphone'" :size="18" />
				{{ label }}
			</label>
		</fieldset>

		<!-- autocomplete off, so the browser never offers a saved real card -->
		<div v-if="method === 'card'" class="fields">
			<LnxInput v-model="number" class="wide" inputmode="numeric" autocomplete="off" placeholder="4242 4242 4242 4242" required>
				Número de tarjeta
			</LnxInput>
			<LnxInput v-model="expiry" inputmode="numeric" autocomplete="off" placeholder="MM/AA" maxlength="5" required>
				Caducidad
			</LnxInput>
			<LnxInput v-model="cvc" inputmode="numeric" autocomplete="off" placeholder="123" maxlength="4" required>
				CVC
			</LnxInput>
			<LnxButton type="button" class="wide size-small" mode="clear" @click="useTestCard()">
				Usar la tarjeta de prueba
			</LnxButton>
		</div>
		<p v-else class="hint">
			Se simula la confirmación del Bizum desde la app de tu banco.
		</p>

		<p class="privacy">
			<LnxIcon class="privacy-icon" icon="lucide:shield-check" :size="18" />
			<span v-if="method === 'card'"><strong>No guardamos los datos de tu tarjeta</strong>: ni el número, ni la caducidad, ni el CVC. Solo la marca y los 4 últimos dígitos, para el justificante.</span>
			<span v-else><strong>No guardamos ningún dato de pago</strong>: ni tu teléfono ni los datos de tu banco.</span>
		</p>

		<p v-if="error" class="error" role="alert">
			{{ error }}
		</p>

		<div class="actions">
			<LnxButton type="button" mode="clear" :disabled="busy" @click="emit('cancel')">
				Cancelar
			</LnxButton>
			<LnxButton type="submit" :is-loading="busy">
				<LnxIcon icon="lucide:lock" />
				Pagar {{ formatCents(amount) }}
			</LnxButton>
		</div>
	</form>
</template>

<style lang="scss" scoped>
.checkout {
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-primary);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
	}

	h2 {
		font-size: var(--lnx-font-size-body);
		font-variant-numeric: tabular-nums;
	}
}

.test-badge {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: #fff3cd;
	color: #7a5a00;
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;
}

.concept {
	color: var(--color-gray-7);
}

.test-note {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-1);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
}

.methods {
	display: flex;
	gap: var(--lnx-spacing-2);

	label {
		flex: 1;
		min-height: 44px;
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-7);
		cursor: pointer;

		&.active {
			border-color: var(--color-primary);
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}

		&:has(:focus-visible) {
			outline: 2px solid var(--color-primary-light);
			outline-offset: 2px;
		}
	}
}

.fields {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--lnx-spacing-2) var(--lnx-spacing-3);

	.wide {
		grid-column: 1 / -1;
	}
}

.actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.privacy {
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);

	.privacy-icon {
		flex-shrink: 0;
		color: var(--color-issue-status-resolved);
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
