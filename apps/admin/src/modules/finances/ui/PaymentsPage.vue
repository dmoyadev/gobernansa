<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Expense } from '@gobernansa/shared/domain/finance.ts';
import type { PaymentOrder, PaymentOrderItem } from '@gobernansa/shared/domain/sepa.ts';
import type { PaymentOrderData } from '../application/usePaymentOrders.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { checkSepa } from '@gobernansa/shared/domain/fileChecks.ts';
import { payableAmount } from '@gobernansa/shared/domain/finance.ts';
import { isValidIban, isValidNif, normalizeIban, normalizeTaxId } from '@gobernansa/shared/domain/fiscal.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { paymentOrderStatuses, paymentOrderXml, sepaDateTime, sepaId } from '@gobernansa/shared/domain/sepa.ts';
import { remote } from '@gobernansa/shared/infrastructure/remoteConfig.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';
import { downloadFile } from '@/app/ux/download.ts';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { toast } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { useProviders } from '@/modules/providers/application/useProviders.ts';
import { useFileCheck } from '../application/useFileCheck.ts';
import { useUnpaidInvoices } from '../application/useFinances.ts';
import { createPaymentOrder, deletePaymentOrder, loadPaymentOrders, MAX_PAYMENT_ITEMS, setPaymentOrderExecuted } from '../application/usePaymentOrders.ts';
import FileCheck from './FileCheck.vue';

const props = defineProps<{ id: string }>();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

const { data: unpaid, pending: invoicesPending, error: invoicesError } = useUnpaidInvoices(props.id);
const { providers, loading: providersLoading, error: providersError } = useProviders(props.id);

// The community (the debtor) and the orders, read once: they only change here
const community = ref<Community>();
const orders = ref<PaymentOrder[]>([]);
const loading = ref(true);
const loadError = ref<string>();

async function load() {
	try {
		[community.value, orders.value] = await Promise.all([loadCommunity(props.id), loadPaymentOrders(props.id)]);
		loadError.value = undefined;
	} catch (e) {
		loadError.value = `No se han podido cargar las órdenes de pago: ${(e as Error).message}`;
	} finally {
		loading.value = false;
	}
}

onMounted(load);
onRevalidate(load);

const debtorProblem = computed(() => {
	if (!community.value) {
		return undefined;
	}
	if (!community.value.cif || !isValidNif(community.value.cif)) {
		return 'Falta el CIF de la comunidad, o no es válido.';
	}
	if (!community.value.iban || !isValidIban(community.value.iban)) {
		return 'Falta el IBAN de la comunidad, o no es válido.';
	}
	return undefined;
});

/* New order */

// Providers with an account the transfer can go to
const payees = computed(() => new Map(providers.value.flatMap(provider => provider.iban && isValidIban(provider.iban) ? [[provider.id, provider]] : [])));
// Unpaid again after its order was executed (the transfer bounced, marked pending by hand) it can go in a new one
const executedIds = computed(() => new Set(orders.value.filter(order => order.status === 'executed').map(order => order.id)));
const free = computed(() => unpaid.value.filter(invoice => (!invoice.paymentOrderId || executedIds.value.has(invoice.paymentOrderId)) && payableAmount(invoice) > 0));
const candidates = computed(() => free.value
	.filter(invoice => invoice.provider && payees.value.has(invoice.provider.id))
	.sort((a, b) => (a.dueDate?.toMillis() ?? Infinity) - (b.dueDate?.toMillis() ?? Infinity) || a.date.toMillis() - b.date.toMillis()));
const withoutIban = computed(() => free.value.length - candidates.value.length);

const executionDate = ref(toDateString(new Date()));
const today = toDateString(new Date());
// Unticked by hand; the rest go in
const excluded = ref(new Set<string>());
const selected = computed(() => candidates.value.filter(invoice => !excluded.value.has(invoice.id)));
const selectedTotal = computed(() => selected.value.reduce((sum, invoice) => sum + payableAmount(invoice), 0));

function toggleInvoice(invoice: Expense, include: boolean) {
	const next = new Set(excluded.value);
	if (include) {
		next.delete(invoice.id);
	} else {
		next.add(invoice.id);
	}
	excluded.value = next;
}

const generating = ref(false);
// The order opened to see its transfers
const openId = ref<string>();
const formError = ref<string>();

// Each file is checked before it's downloaded, key is where the check shows: 'new' or the order's id
const { check, guard, confirm, dismiss } = useFileCheck();

function download(order: PaymentOrder) {
	const xml = paymentOrderXml(order);
	guard(order.id, `la orden de pago ${order.reference} (${order.items.length} transferencias por ${formatCents(order.total)})`, checkSepa(xml), () => downloadFile(`${order.reference}.xml`, xml, 'application/xml'));
}

// What was checked is what would be made, so changing it drops a held check
watch([selected, executionDate], () => {
	if (check.value?.key === 'new' && check.value.held) {
		dismiss();
	}
});

async function generate() {
	if (generating.value || !community.value) {
		return;
	}
	formError.value = debtorProblem.value
		?? (!selected.value.length ? 'No hay facturas seleccionadas.' : undefined)
		?? (selected.value.length > MAX_PAYMENT_ITEMS ? `Como mucho ${MAX_PAYMENT_ITEMS} facturas por orden: desmarca algunas y haz varias.` : undefined)
		?? (!executionDate.value || executionDate.value < today ? 'La fecha de ejecución no puede ser anterior a hoy.' : undefined);
	if (formError.value) {
		return;
	}

	// One write, so a failure leaves nothing and trying again makes a new one
	const id = newId();
	const now = new Date();
	const reference = sepaId(`TRF-${toDateString(now).replaceAll('-', '')}-${id.slice(0, 6)}`);
	const items: PaymentOrderItem[] = selected.value.map((invoice, index) => {
		const provider = payees.value.get(invoice.provider!.id)!;
		return {
			expenseId: invoice.id,
			providerId: provider.id,
			creditorName: provider.fiscalName || provider.name,
			iban: normalizeIban(provider.iban!),
			amount: payableAmount(invoice),
			concept: invoice.concept,
			...(invoice.invoiceNumber ? { invoiceNumber: invoice.invoiceNumber } : {}),
			endToEndId: `${reference}-${String(index + 1).padStart(4, '0')}`,
		};
	});
	const data = {
		reference,
		executionDate: executionDate.value,
		issuedAt: sepaDateTime(now),
		debtor: {
			name: community.value.name,
			id: `${normalizeTaxId(community.value.cif!)}${community.value.sepaSuffix || '000'}`,
			iban: normalizeIban(community.value.iban!),
			...(community.value.bic ? { bic: community.value.bic } : {}),
		},
		items,
		total: selectedTotal.value,
	};
	const xml = paymentOrderXml(data);
	guard('new', `la orden de pago ${data.reference} (${data.items.length} transferencias por ${formatCents(data.total)})`, checkSepa(xml), async () => save(id, data, xml));
}

// Whether the file was downloaded, for its activity entry
async function save(id: string, data: PaymentOrderData, xml: string) {
	// Money: it waits for the server before telling it's done
	generating.value = true;
	try {
		await createPaymentOrder(props.id, id, data);
		downloadFile(`${data.reference}.xml`, xml, 'application/xml');
		orders.value = [{ ...data, id, status: 'generated' } as PaymentOrder, ...orders.value];
		openId.value = id;
		excluded.value = new Set();
		toast(`Orden ${data.reference} generada, súbela a la banca online`);
		return true;
	} catch (e) {
		formError.value = `No se ha podido generar: ${(e as Error).message}`;
		return false;
	} finally {
		generating.value = false;
	}
}

const generateForm = useTemplateRef('generateForm');
useShortcut('mod+enter', () => generateForm.value?.requestSubmit(), 'Generar la orden de pago');

/* Orders */

const busyId = ref<string>();
const actionError = ref<string>();

function replace(order: PaymentOrder) {
	orders.value = orders.value.map(other => other.id === order.id ? order : other);
}

async function run(id: string, action: () => Promise<void>) {
	busyId.value = id;
	actionError.value = undefined;
	try {
		await action();
	} catch (e) {
		actionError.value = `No se ha podido hacer: ${(e as Error).message}`;
	} finally {
		busyId.value = undefined;
	}
}

async function execute(order: PaymentOrder) {
	// Its invoices are paid the day the bank sent the transfers
	const at = Timestamp.fromDate(new Date(`${order.executionDate}T12:00`));
	await run(order.id, async () => {
		const updated = await setPaymentOrderExecuted(props.id, order, at);
		replace(updated);
		toast('Orden ejecutada: sus facturas quedan pagadas', {
			undo: async () => replace(await setPaymentOrderExecuted(props.id, updated, null)),
		});
	});
}

async function remove(order: PaymentOrder) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar la orden de pago ${order.reference}? Sus facturas podrán ir en otra.`)) {
		return;
	}
	await run(order.id, async () => {
		await deletePaymentOrder(props.id, order);
		orders.value = orders.value.filter(other => other.id !== order.id);
		toast('Orden de pago borrada', {
			undo: async () => {
				const { reference, executionDate, issuedAt, debtor, items, total } = order;
				await createPaymentOrder(props.id, order.id, { reference, executionDate, issuedAt, debtor, items, total });
				orders.value = [order, ...orders.value].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
			},
		});
	});
}
</script>

<template>
	<header class="page-header">
		<h1>Pagos a proveedores</h1>
	</header>

	<p class="intro hint">
		<LnxIcon icon="lucide:info" />
		La orden se descarga como fichero SEPA de transferencias (pain.001) y se sube a la banca online de la comunidad. No hace falta conectar con el banco ni tiene coste.
	</p>

	<p v-if="!remote.remittances" class="card warning" role="note">
		La generación de órdenes de pago está desactivada temporalmente mientras se revisa. Vuelve a estar disponible en cuanto se reactive, sin actualizar la app.
	</p>
	<form v-else ref="generateForm" class="card" @submit.prevent="generate()">
		<h2>Nueva orden de pago</h2>
		<p v-if="invoicesError || providersError" class="error" role="alert">
			No se han podido cargar: {{ (invoicesError ?? providersError)?.message }}
		</p>
		<p v-if="debtorProblem" class="warning">
			<LnxIcon icon="lucide:triangle-alert" />
			{{ debtorProblem }}
			<RouterLink :to="`/communities/${id}/info`">
				Complétalo en sus datos
			</RouterLink>
		</p>

		<div class="fields">
			<DatePicker v-model="executionDate" :min="today" required>
				Fecha de ejecución
				<template #helper>
					El día que el banco envía las transferencias
				</template>
			</DatePicker>
		</div>

		<ul v-if="(invoicesPending || providersLoading) && !candidates.length" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65]" :key="width" class="invoice">
				<span class="skeleton-item" :style="{ width: `${width}%` }" />
				<span class="skeleton-item skeleton-item--small" style="width: 70px" />
			</li>
		</ul>
		<ul v-else-if="candidates.length" class="list ux-appear">
			<li v-for="invoice in candidates" :key="invoice.id" class="invoice">
				<LnxCheckbox :model-value="!excluded.has(invoice.id)" @update:model-value="value => toggleInvoice(invoice, !!value)">
					<span class="what">
						<span>{{ invoice.provider!.name }} · {{ invoice.concept }}</span>
						<small class="tabular">
							<template v-if="invoice.invoiceNumber">Fra. {{ invoice.invoiceNumber }} · </template>
							{{ payees.get(invoice.provider!.id)?.iban }}
							<template v-if="invoice.dueDate"> · vence {{ dateFormat.format(invoice.dueDate.toDate()) }}</template>
						</small>
					</span>
				</LnxCheckbox>
				<strong class="tabular">{{ formatCents(payableAmount(invoice)) }}</strong>
			</li>
		</ul>
		<p v-else class="hint">
			No hay facturas pendientes de proveedores con IBAN.
		</p>
		<p v-if="withoutIban" class="hint">
			{{ withoutIban }} {{ withoutIban === 1 ? 'factura pendiente es' : 'facturas pendientes son' }} de proveedores sin IBAN válido, o sin proveedor.
			<RouterLink to="/providers">
				Ver proveedores
			</RouterLink>
		</p>

		<FileCheck
			v-if="check?.key === 'new'"
			:issues="check.issues"
			kind="sepa"
			:held="!!check.held"
			confirm-label="Generar igualmente"
			@confirm="confirm()"
			@dismiss="dismiss()"
		/>
		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<span v-else-if="selected.length" class="hint tabular">
				{{ selected.length }} {{ selected.length === 1 ? 'factura' : 'facturas' }} · {{ formatCents(selectedTotal) }}
			</span>
			<LnxButton type="submit" :is-loading="generating" :disabled="!selected.length || !community">
				<LnxIcon icon="lucide:file-down" />
				Generar y descargar
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Órdenes de pago</h2>
		<p v-if="loadError" class="error" role="alert">
			{{ loadError }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [50, 40]" :key="width" class="item">
				<div class="row">
					<div class="what">
						<span class="skeleton-item" :style="{ width: `${width}%` }" />
						<span class="skeleton-item skeleton-item--small" :style="{ width: `${width - 15}%` }" />
					</div>
					<span class="skeleton-item skeleton-item--small" style="width: 90px" />
				</div>
			</li>
		</ul>
		<ul v-else-if="orders.length" class="list ux-appear">
			<li v-for="order in orders" :key="order.id" class="item">
				<div class="row">
					<button type="button" class="what ux-row" :aria-expanded="openId === order.id" @click="openId = openId === order.id ? undefined : order.id">
						<strong class="tabular">{{ order.reference }}</strong>
						<small class="tabular">
							Ejecución el {{ dateFormat.format(new Date(`${order.executionDate}T00:00`)) }} · {{ order.items.length }} {{ order.items.length === 1 ? 'transferencia' : 'transferencias' }} · {{ formatCents(order.total) }}
						</small>
					</button>
					<span class="chip" :class="{ ok: order.status === 'executed' }">{{ paymentOrderStatuses[order.status] }}</span>
					<div class="item-actions">
						<LnxButton mode="clear" size="small" shape="circle" aria-label="Descargar fichero" title="Descargar fichero" @click="download(order)">
							<LnxIcon icon="lucide:download" />
						</LnxButton>
						<LnxButton v-if="order.status === 'generated'" mode="clear" size="small" :is-loading="busyId === order.id" @click="execute(order)">
							Marcar ejecutada
						</LnxButton>
						<LnxButton
							v-if="order.status === 'generated'"
							mode="clear"
							size="small"
							shape="circle"
							variant="danger"
							aria-label="Borrar"
							title="Borrar"
							:disabled="busyId === order.id"
							@click="remove(order)"
						>
							<LnxIcon icon="lucide:trash-2" />
						</LnxButton>
					</div>
				</div>
				<FileCheck
					v-if="check?.key === order.id"
					class="item-check"
					:issues="check.issues"
					kind="sepa"
					:held="!!check.held"
					@confirm="confirm()"
					@dismiss="dismiss()"
				/>

				<div v-if="openId === order.id" class="transfers">
					<p class="hint tabular">
						Desde {{ order.debtor.iban }}. {{ order.status === 'generated'
							? 'Cuando el banco haga las transferencias, márcala como ejecutada y sus facturas quedarán pagadas.'
							: `Ejecutada: sus facturas se pagaron el ${dateFormat.format(new Date(`${order.executionDate}T00:00`))}.` }}
					</p>
					<ul>
						<li v-for="item in order.items" :key="item.expenseId" class="invoice">
							<div class="what">
								<span>{{ item.creditorName }} · {{ item.concept }}</span>
								<small class="tabular">
									<template v-if="item.invoiceNumber">Fra. {{ item.invoiceNumber }} · </template>{{ item.iban }}
								</small>
							</div>
							<strong class="tabular">{{ formatCents(item.amount) }}</strong>
						</li>
					</ul>
				</div>
			</li>
		</ul>
		<p v-else class="hint">
			Aún no hay órdenes de pago.
		</p>
	</section>
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

.intro {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
}

.card {
	margin-bottom: var(--lnx-spacing-5);
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	.error,
	.hint {
		flex: 1;
	}
}

.list {
	display: flex;
	flex-direction: column;
}

.item-check {
	margin-top: var(--lnx-spacing-3);
}

.item {
	padding: var(--lnx-spacing-3) 0;

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;
	text-align: left;

	small {
		overflow: hidden;
		color: var(--color-gray-6);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

button.what {
	// Its hover reaches a bit past the text, without moving it
	margin: calc(-1 * var(--lnx-spacing-1)) calc(-1 * var(--lnx-spacing-2));
	padding: var(--lnx-spacing-1) var(--lnx-spacing-2);
	border: none;
	border-radius: var(--lnx-radius-2);
	background: none;
	font: inherit;
	color: inherit;
	cursor: pointer;
}

.invoice {
	padding: var(--lnx-spacing-2) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	:deep(.checkbox),
	:deep(.label) {
		min-width: 0;
	}
}

.transfers {
	margin-top: var(--lnx-spacing-3);
	padding-left: var(--lnx-spacing-4);
	border-left: 2px solid var(--color-gray-3);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.item-actions {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;

	&.ok {
		color: var(--color-primary);
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);

	a {
		color: var(--color-primary);
	}
}

.warning {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
	color: var(--color-gray-7);

	a {
		color: var(--color-primary);
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
