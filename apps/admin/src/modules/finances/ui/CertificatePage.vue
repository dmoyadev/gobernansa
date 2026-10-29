<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { chargeTypes, isOverdue } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { propertyTypeLabels } from '@gobernansa/shared/domain/property.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, onMounted, ref } from 'vue';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { loadCertificate } from '../application/useFinances.ts';

const props = defineProps<{ id: string; propertyId: string }>();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });
const today = new Date();

const community = ref<Community>();
const property = ref<Property>();
const unpaid = ref<Charge[]>([]);
const loading = ref(true);
const error = ref<string>();

// Read once: a certificate is a picture of the day it's issued
onMounted(async () => {
	try {
		const [loadedCommunity, certificate] = await Promise.all([loadCommunity(props.id), loadCertificate(props.id, props.propertyId)]);
		community.value = loadedCommunity;
		property.value = certificate.property;
		unpaid.value = certificate.unpaid;
		// A property of another community would be certified against charges that aren't its own
		if (!loadedCommunity || certificate.property?.communityId !== props.id) {
			error.value = 'No existe esta comunidad o propiedad.';
		}
	} catch (e) {
		error.value = `No se ha podido cargar: ${(e as Error).message}`;
	} finally {
		loading.value = false;
	}
});

// Charges not yet due don't count against it
const overdue = computed(() => unpaid.value.filter(charge => isOverdue(charge, today)).sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis()));
const overdueTotal = computed(() => overdue.value.reduce((sum, charge) => sum + charge.amount, 0));

function print() {
	window.print();
}
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}/charges`" mode="clear" shape="circle" aria-label="Volver a recibos">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Certificado de pagos</h1>
		<LnxButton class="print" :disabled="loading || !!error" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir / Guardar PDF
		</LnxButton>
	</header>

	<p v-if="error" class="error" role="alert">
		{{ error }}
	</p>
	<span v-else-if="loading" class="skeleton-item" />
	<article v-else-if="community && property" class="sheet">
		<header>
			<strong>Comunidad de propietarios {{ community.name }}</strong>
			<span>{{ community.address }}</span>
			<span v-if="community.cif">CIF {{ community.cif }}</span>
		</header>

		<h2>Certificado de {{ overdue.length ? 'deuda' : 'estar al corriente de pago' }}</h2>

		<p>
			Se certifica que la propiedad <strong>{{ property.name }}</strong> ({{ propertyTypeLabels[property.type].toLowerCase() }}) de esta comunidad,
			<template v-if="property.ownerName">
				cuyo titular es <strong>{{ property.ownerName }}</strong>,
			</template>
			<template v-if="!overdue.length">
				<strong>se encuentra al corriente de pago</strong> de las cuotas y derramas vencidas a fecha de hoy.
			</template>
			<template v-else>
				tiene pendientes de pago los siguientes recibos vencidos a fecha de hoy:
			</template>
		</p>

		<table v-if="overdue.length">
			<thead>
				<tr>
					<th>Concepto</th>
					<th>Tipo</th>
					<th>Vencimiento</th>
					<th class="amount">
						Importe
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="charge in overdue" :key="charge.id">
					<td>{{ charge.concept }}</td>
					<td>{{ chargeTypes[charge.type] }}</td>
					<td>{{ dateFormat.format(charge.dueDate.toDate()) }}</td>
					<td class="amount">
						{{ formatCents(charge.amount) }}
					</td>
				</tr>
			</tbody>
			<tfoot>
				<tr>
					<th colspan="3">
						Total adeudado
					</th>
					<th class="amount">
						{{ formatCents(overdueTotal) }}
					</th>
				</tr>
			</tfoot>
		</table>

		<p>Y para que conste a los efectos oportunos, se expide el presente certificado el {{ dateFormat.format(today) }}.</p>

		<footer>
			<span>Firma y sello de la administración</span>
		</footer>
	</article>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		font-size: var(--lnx-font-size-title);
	}
}

// An A4 page on screen, the same on paper
.sheet {
	max-width: 210mm;
	min-height: 297mm;
	margin: 0 auto;
	padding: 20mm;
	background: #FFFFFF;
	color: #000000;
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000014;
	display: flex;
	flex-direction: column;
	gap: 8mm;
	font-size: 11pt;
	line-height: 1.6;

	> header {
		display: flex;
		flex-direction: column;
	}

	h2 {
		text-align: center;
		font-size: 15pt;
		text-transform: uppercase;
	}

	> footer {
		margin-top: 20mm;
		align-self: flex-end;
		padding-top: 2mm;
		width: 70mm;
		border-top: 1px solid #000000;
		text-align: center;
		font-size: 9pt;
	}
}

table {
	width: 100%;
	border-collapse: collapse;

	th,
	td {
		padding: 1.5mm 2mm;
		border-bottom: 1px solid #CCCCCC;
		text-align: left;
	}

	.amount {
		text-align: right;
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@page {
	size: A4;
	margin: 20mm;
}

@media print {
	.page-header {
		display: none;
	}

	// The page margins take the padding's place, so a long list of debts keeps them on every page
	.sheet {
		max-width: none;
		min-height: auto;
		padding: 0;
		box-shadow: none;
	}
}
</style>
