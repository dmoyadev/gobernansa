<script setup lang="ts">
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Checkout } from '../application/useMyCharges.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { formatIban } from '@gobernansa/shared/domain/community.ts';
import { chargeTypes, isOverdue } from '@gobernansa/shared/domain/finance.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheHeader from '@/shared/ui/TheHeader.vue';
import { useMyCharges } from '../application/useMyCharges.ts';
import TestCheckout from './TestCheckout.vue';

const SPACES_REGEX = /\s/g;

const { user } = useAuth();
const { userCommunity } = useUserCommunity();
const { unpaid, loadPaid, payCharge } = useMyCharges();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

// Overdue first, then by due date
const pending = computed(() => [...unpaid.value].sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || a.dueDate.toMillis() - b.dueDate.toMillis()));
const pendingTotal = computed(() => pending.value.reduce((sum, charge) => sum + charge.amount, 0));
const overdueTotal = computed(() => pending.value.filter(charge => isOverdue(charge)).reduce((sum, charge) => sum + charge.amount, 0));
const loading = computed(() => unpaid.pending.value && !unpaid.value.length);
const loadError = computed(() => unpaid.error.value);

// Blocked neighbours (and admins viewing as one) can look, not pay
const canPay = computed(() => userCommunity.value?.onlinePayments === 'test' && !user.value?.blocked);

/* The paid history, read when asked for */
const paid = ref<Charge[]>();
const paidLoading = ref(false);
const paidError = ref<string>();

async function showPaid() {
	paidLoading.value = true;
	paidError.value = undefined;
	try {
		paid.value = await loadPaid();
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error(e);
		paidError.value = 'No se han podido cargar los pagados. Inténtalo de nuevo.';
	} finally {
		paidLoading.value = false;
	}
}

/* Paying */
const paying = ref<Charge>();
const justPaid = ref<{ chargeId: string; concept: string }>();

async function pay(checkout: Checkout) {
	const charge = paying.value!;
	await payCharge(charge, checkout);
	justPaid.value = { chargeId: charge.id, concept: charge.concept };
	paying.value = undefined;
	// Read again when asked, with this one
	paid.value = undefined;
}

/* Paying by transfer */
const copied = ref<string>();
async function copy(label: string, value: string) {
	try {
		await navigator.clipboard.writeText(value);
		copied.value = label;
		setTimeout(() => {
			if (copied.value === label) {
				copied.value = undefined;
			}
		}, 2000);
	} catch {
		// e.g. the browser denies the permission, the data is still on screen to copy by hand
	}
}

// What to write in the transfer, so the office can tell what it pays
function transferConcept(charge: Charge) {
	return `${charge.propertyName} ${charge.concept}`;
}
</script>

<template>
	<TheHeader>
		<h1>Mis recibos</h1>
		<p>Tus cuotas y derramas, lo que tienes pendiente y lo que ya has pagado.</p>
	</TheHeader>

	<MainLayout>
		<section class="balance" :aria-busy="loading">
			<div>
				<small>Pendiente</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 90px" />
				<strong v-else class="tabular">{{ formatCents(pendingTotal) }}</strong>
			</div>
			<div>
				<small>Vencido</small>
				<span v-if="loading" class="skeleton-item skeleton-item--title" style="width: 70px" />
				<strong v-else class="tabular" :class="{ overdue: overdueTotal }">{{ formatCents(overdueTotal) }}</strong>
			</div>
		</section>

		<p v-if="loadError" class="error" role="alert">
			No se han podido cargar tus recibos. Recarga la página.
		</p>

		<p v-if="justPaid" class="success" role="status">
			<LnxIcon icon="lucide:circle-check" :size="18" />
			<span>Pago de prueba registrado: «{{ justPaid.concept }}».</span>
			<RouterLink :to="`/neighborhood/charges/${justPaid.chargeId}/receipt`">
				Ver justificante
			</RouterLink>
		</p>

		<section>
			<h2>Pendientes</h2>
			<ul v-if="loading" class="list" aria-label="Cargando">
				<li v-for="width in [60, 45]" :key="width" class="row">
					<span class="body">
						<span class="skeleton-item" :style="{ width: `${width}%` }" />
						<span class="skeleton-item skeleton-item--small" :style="{ width: `${width - 20}%` }" />
					</span>
				</li>
			</ul>
			<ul v-else-if="pending.length" class="list">
				<li v-for="charge in pending" :key="charge.id" class="row" :class="{ overdue: isOverdue(charge) }">
					<span class="body">
						<small>{{ chargeTypes[charge.type] }} · {{ charge.propertyName }}</small>
						<strong>{{ charge.concept }}</strong>
						<small class="tabular">
							<template v-if="isOverdue(charge)"><span class="overdue">Vencido</span> el {{ dateFormat.format(charge.dueDate.toDate()) }}</template>
							<template v-else>Vence el {{ dateFormat.format(charge.dueDate.toDate()) }}</template>
							<template v-if="charge.remittanceId"> · se cobra por domiciliación</template>
						</small>
					</span>
					<span class="side">
						<strong class="tabular">{{ formatCents(charge.amount) }}</strong>
						<LnxButton
							v-if="canPay && !charge.remittanceId && charge.amount > 0"
							size="small"
							:disabled="!!paying"
							@click="paying = charge; justPaid = undefined"
						>
							Pagar
						</LnxButton>
					</span>
				</li>
			</ul>
			<p v-else class="empty">
				Estás al corriente, no tienes nada pendiente.
			</p>
		</section>

		<TestCheckout
			v-if="paying"
			:amount="paying.amount"
			:concept="`${paying.concept} · ${paying.propertyName}`"
			:pay="pay"
			@cancel="paying = undefined"
		/>

		<section v-if="pending.length && userCommunity?.iban" id="transfer">
			<h2>Pagar por transferencia</h2>
			<div class="transfer">
				<p>Haz una transferencia a la cuenta de la comunidad indicando la vivienda y el recibo, p. ej. «{{ transferConcept(pending[0]) }}».</p>
				<dl>
					<div>
						<dt>Titular</dt>
						<dd>{{ userCommunity.name }}</dd>
					</div>
					<div>
						<dt>IBAN</dt>
						<dd class="tabular">
							{{ formatIban(userCommunity.iban) }}
							<LnxButton mode="clear" shape="circle" size="small" :aria-label="copied === 'IBAN' ? 'IBAN copiado' : 'Copiar IBAN'" @click="copy('IBAN', userCommunity.iban.replace(SPACES_REGEX, ''))">
								<LnxIcon :icon="copied === 'IBAN' ? 'lucide:check' : 'lucide:copy'" />
							</LnxButton>
						</dd>
					</div>
					<div v-if="userCommunity.bank">
						<dt>Banco</dt>
						<dd>{{ userCommunity.bank }}</dd>
					</div>
				</dl>
				<small>La administración lo marcará como pagado cuando le llegue.</small>
			</div>
		</section>

		<section>
			<h2>Pagados</h2>
			<p v-if="paidError" class="error" role="alert">
				{{ paidError }}
			</p>
			<ul v-if="paid?.length" class="list">
				<li v-for="charge in paid" :key="charge.id">
					<RouterLink class="row" :to="`/neighborhood/charges/${charge.id}/receipt`">
						<span class="body">
							<small class="tabular">Pagado el {{ dateFormat.format(charge.paidAt!.toDate()) }} · {{ charge.propertyName }}</small>
							<strong>{{ charge.concept }}</strong>
							<small v-if="charge.payment" class="test">Pago de prueba</small>
						</span>
						<span class="side">
							<strong class="tabular">{{ formatCents(charge.amount) }}</strong>
							<LnxIcon class="chevron" icon="lucide:file-check" :size="18" aria-label="Justificante" />
						</span>
					</RouterLink>
				</li>
			</ul>
			<p v-else-if="paid" class="empty">
				Aún no tienes recibos pagados.
			</p>
			<LnxButton v-else mode="outline" size="small" :is-loading="paidLoading" @click="showPaid()">
				<LnxIcon icon="lucide:history" />
				Ver pagados y justificantes
			</LnxButton>
		</section>
	</MainLayout>
</template>

<style lang="scss" scoped>
section {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);

	> * {
		align-self: stretch;
	}

	> :deep(button) {
		align-self: flex-start;
	}

	> h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.balance {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--lnx-spacing-2);

	div {
		padding: var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
		display: flex;
		flex-direction: column;
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	strong {
		font-size: 1.4rem;
	}
}

.list {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;

	> li + li {
		border-top: 1px solid var(--color-gray-2);
	}
}

.row {
	padding: var(--lnx-spacing-3);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: inherit;
	text-decoration: none;

	&.overdue {
		box-shadow: inset 3px 0 0 var(--color-secondary-accent);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
		}

		strong {
			overflow: hidden;
			color: var(--color-gray-9);
			font-weight: var(--lnx-font-weight-regular);
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.test {
			color: #7a5a00;
		}
	}

	.side {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--lnx-spacing-1);
	}

	.chevron {
		color: var(--color-gray-5);
	}
}

a.row:active {
	background: var(--color-gray-1);
}

.overdue {
	color: var(--color-secondary-accent);
	font-weight: var(--lnx-font-weight-bold);
}

.transfer {
	padding: var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	dl > div {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--lnx-spacing-2);
	}

	dt {
		width: 4.5em;
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	dd {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

.success {
	padding: var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-1);
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-issue-status-resolved);
	font-size: var(--lnx-font-size-small);

	span {
		flex: 1;
		color: var(--color-gray-9);
	}

	a {
		color: var(--color-primary);
		font-weight: var(--lnx-font-weight-bold);
	}
}

.empty {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
