<script setup lang="ts">
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Checkout } from '../application/useMyCharges.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { chargeTypes, isOverdue, outstanding } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { remote } from '@gobernansa/shared/infrastructure/remoteConfig.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { loadMyCharge, payMyCharge } from '../application/useMyCharges.ts';
import PayWizard from './PayWizard.vue';
import ReceiptSheet from './ReceiptSheet.vue';

const props = defineProps<{ id: string }>();

const { user } = useAuth();
const { userCommunity } = useUserCommunity();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });

const charge = ref<Charge>();
const loading = ref(true);
const loadError = ref(false);

// Read once, when the user's community is known
watch(() => user.value?.communityId, async (communityId) => {
	if (!communityId) {
		return;
	}
	try {
		charge.value = await loadMyCharge(communityId, props.id);
	} catch (e) {
		reportError(e, { action: 'Cargar el recibo a pagar' });
		loadError.value = true;
	} finally {
		loading.value = false;
	}
}, { immediate: true });

// What's left of it, after any entregas a cuenta
const amount = computed(() => charge.value ? outstanding(charge.value) : 0);

// Why it can't be paid here, the same checks as the Pagar button of the list
const unavailable = computed(() => {
	if (loadError.value) {
		return 'No se ha podido cargar el recibo. Recarga la página.';
	}
	if (loading.value || !userCommunity.value) {
		return undefined;
	}
	if (!charge.value) {
		return 'Este recibo no existe.';
	}
	if (charge.value.paidAt || !amount.value) {
		return 'Este recibo ya está pagado.';
	}
	if (charge.value.remittanceId) {
		return 'Este recibo se cobra por domiciliación, no hace falta que lo pagues.';
	}
	// Online payments can be turned off from the console (ROB-5)
	if (userCommunity.value.onlinePayments !== 'test' || !remote.payments) {
		return 'Los pagos online no están disponibles ahora mismo. Puedes pagarlo por transferencia.';
	}
	// Blocked neighbours (and admins viewing as one) can look, not pay
	if (user.value?.blocked) {
		return 'Tu cuenta no puede pagar recibos ahora mismo.';
	}
	return undefined;
});

// The charge as it is once paid, for its justificante without reading it again
const paid = ref<Charge>();

async function pay(checkout: Checkout) {
	if (!charge.value || !user.value?.communityId) {
		throw new Error('The user must be signed in to pay');
	}
	const payment = await payMyCharge(user.value.communityId, user.value.id, charge.value, checkout);
	paid.value = { ...charge.value, paidAt: Timestamp.now(), payment };
}
</script>

<template>
	<PayWizard
		title="Pagar recibo"
		back="/neighborhood/charges"
		back-label="Volver a mis recibos"
		:loading="!charge || !userCommunity"
		:unavailable="unavailable"
		:amount="amount"
		:concept="charge ? `${charge.concept} · ${charge.propertyName}` : ''"
		:pay="pay"
	>
		<template v-if="charge?.paidAt" #unavailable>
			<LnxButton :to="`/neighborhood/charges/${charge.id}/receipt`" class="size-large" is-block>
				<template #prefix>
					<LnxIcon icon="lucide:file-check" />
				</template>
				Ver el justificante
			</LnxButton>
		</template>

		<template v-if="charge" #details>
			<div>
				<dt>Concepto</dt>
				<dd>{{ charge.concept }}</dd>
			</div>
			<div>
				<dt>Tipo</dt>
				<dd>{{ chargeTypes[charge.type] }}</dd>
			</div>
			<div>
				<dt>Propiedad</dt>
				<dd>{{ charge.propertyName }}</dd>
			</div>
			<div>
				<dt>Vencimiento</dt>
				<dd class="tabular" :class="{ overdue: isOverdue(charge) }">
					{{ dateFormat.format(charge.dueDate.toDate()) }}<template v-if="isOverdue(charge)">
						· vencido
					</template>
				</dd>
			</div>
			<template v-if="charge.collections?.length">
				<div>
					<dt>Importe del recibo</dt>
					<dd class="tabular">
						{{ formatCents(charge.amount) }}
					</dd>
				</div>
				<div>
					<dt>Ya pagado a cuenta</dt>
					<dd class="tabular">
						−{{ formatCents(charge.amount - amount) }}
					</dd>
				</div>
			</template>
		</template>

		<template #receipt>
			<ReceiptSheet :charge="paid" />
		</template>
	</PayWizard>
</template>
