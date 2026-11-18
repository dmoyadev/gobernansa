<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import { LnxSelect } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { saveOnlinePayments } from '../application/useFinances.ts';

// Whether the neighbours pay online, read once with the community
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ error: [message: string] }>();

const onlinePayments = ref<Community['onlinePayments'] | null>();
const paymentsOptions = [
	{ value: 'off', label: 'Desactivados' },
	{ value: 'test', label: 'Modo de prueba' },
];

function loadPaymentsMode() {
	return loadCommunity(props.id)
		.then(community => onlinePayments.value = community?.onlinePayments ?? null)
		.catch((e: Error) => emit('error', `No se ha podido cargar la comunidad: ${e.message}`));
}

void loadPaymentsMode();
onRevalidate(loadPaymentsMode);

const paymentsMode = computed({
	get: () => onlinePayments.value ? 'test' : 'off',
	set: value => setPaymentsMode(value === 'test' ? 'test' : null),
});

function setPaymentsMode(next: 'test' | null) {
	const previous = onlinePayments.value;
	if (next === previous) {
		return;
	}
	onlinePayments.value = next;
	void optimistic(saveOnlinePayments(props.id, next), {
		done: next ? 'Pagos online en modo de prueba' : 'Pagos online desactivados',
		failed: 'No se ha podido cambiar',
		revert: async () => {
			onlinePayments.value = previous;
			await saveOnlinePayments(props.id, previous ?? null);
		},
		onError: () => onlinePayments.value = previous,
	});
}
</script>

<template>
	<section class="card">
		<div class="section-head">
			<h2>
				Pagos online de los vecinos
				<span v-if="onlinePayments" class="chip test">Modo de prueba</span>
			</h2>
		</div>
		<p class="hint">
			Los vecinos pagan sus recibos y las reservas de pago desde la app. En modo de prueba no se mueve dinero ni tiene coste: solo se aceptan las tarjetas de prueba (4242 4242 4242 4242) y un Bizum simulado. Para cobrar de verdad hará falta contratar una pasarela (Redsys, Stripe…).
		</p>
		<div class="fields">
			<span v-if="onlinePayments === undefined" class="lnx-skeleton" style="height: 40px" />
			<LnxSelect
				v-else
				v-model.convert="paymentsMode"
				:options="paymentsOptions"
				:convert-fn="option => option.value"
			>
				Pagos online
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ paymentsOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
		</div>
	</section>
</template>

<style lang="scss" scoped src="./charges.scss" />
