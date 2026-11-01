<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Remittance, RemittanceItem, ReturnReason } from '@gobernansa/shared/domain/sepa.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { isValidIban, isValidNif } from '@gobernansa/shared/domain/fiscal.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { creditorId, remittanceStatuses, remittanceXml, returnReasons, sepaDateTime, sepaId } from '@gobernansa/shared/domain/sepa.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { downloadFile } from '@/app/ux/download.ts';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { toast } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { useCommunityProperties, useUnpaidCharges } from '../application/useFinances.ts';
import { createRemittance, deleteRemittance, loadRemittances, MAX_REMITTANCE_ITEMS, returnDebit, setRemittanceStatus } from '../application/useRemittances.ts';

const props = defineProps<{ id: string }>();

const ALL = '';
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
const reasonOptions = Object.entries(returnReasons).map(([value, label]) => ({ value: value as ReturnReason, label: `${value} · ${label}` }));

const { data: properties, pending: propertiesPending, error: propertiesError } = useCommunityProperties(props.id);
const { data: unpaid, pending: chargesPending, error: chargesError } = useUnpaidCharges(props.id);

// The community (the creditor) and the remittances, read once: they only change here
const community = ref<Community>();
const remittances = ref<Remittance[]>([]);
const loading = ref(true);
const loadError = ref<string>();

async function load() {
	try {
		[community.value, remittances.value] = await Promise.all([loadCommunity(props.id), loadRemittances(props.id)]);
		loadError.value = undefined;
	} catch (e) {
		loadError.value = `No se han podido cargar las remesas: ${(e as Error).message}`;
	} finally {
		loading.value = false;
	}
}

onMounted(load);
onRevalidate(load);

const creditorProblem = computed(() => {
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

/* New remittance */

const mandates = computed(() => new Map(properties.value.flatMap(property => property.mandate?.status === 'active' ? [[property.id, { property, mandate: property.mandate }]] : [])));
// Unpaid, not in another remittance, with an active mandate
const candidates = computed(() => unpaid.value.filter(charge => !charge.remittanceId && charge.amount > 0 && mandates.value.has(charge.propertyId)));
const withoutMandate = computed(() => unpaid.value.filter(charge => !charge.remittanceId && !mandates.value.has(charge.propertyId)).length);

const dueUntil = ref('');
const batch = ref(ALL);
const collectionDate = ref('');
// Unticked by hand; the rest go in
const excluded = ref(new Set<string>());

// The runs of the candidates, by the concept of their first charge
const batchOptions = computed(() => [
	{ value: ALL, label: 'Todos' },
	...Array.from(new Map(candidates.value.filter(charge => charge.batchId).map(charge => [charge.batchId!, charge.concept])).entries(), ([value, label]) => ({ value, label })),
]);

const shown = computed(() => candidates.value
	.filter(charge => (!dueUntil.value || toDateString(charge.dueDate.toDate()) <= dueUntil.value) && (batch.value === ALL || charge.batchId === batch.value))
	.sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis() || a.propertyName.localeCompare(b.propertyName, 'es', { numeric: true })));
const selected = computed(() => shown.value.filter(charge => !excluded.value.has(charge.id)));
const selectedTotal = computed(() => selected.value.reduce((sum, charge) => sum + charge.amount, 0));
const tomorrow = toDateString(new Date(Date.now() + 864e5));

function toggleCharge(charge: Charge, include: boolean) {
	const next = new Set(excluded.value);
	if (include) {
		next.delete(charge.id);
	} else {
		next.add(charge.id);
	}
	excluded.value = next;
}

const generating = ref(false);
// The remittance opened to see its debits
const openId = ref<string>();
const formError = ref<string>();

function download(remittance: Pick<Remittance, 'reference' | 'collectionDate' | 'issuedAt' | 'creditor' | 'items'>) {
	downloadFile(`${remittance.reference}.xml`, remittanceXml(remittance), 'application/xml');
}

async function generate() {
	if (generating.value || !community.value) {
		return;
	}
	formError.value = creditorProblem.value
		?? (!selected.value.length ? 'No hay recibos seleccionados.' : undefined)
		?? (selected.value.length > MAX_REMITTANCE_ITEMS ? `Como mucho ${MAX_REMITTANCE_ITEMS} recibos por remesa: filtra por vencimiento o lote y haz varias.` : undefined)
		?? (!collectionDate.value || collectionDate.value < tomorrow ? 'La fecha de cargo tiene que ser a partir de mañana.' : undefined);
	if (formError.value) {
		return;
	}

	// One write, so a failure leaves nothing and trying again makes a new one
	const id = newId();
	const now = new Date();
	const reference = sepaId(`REM-${toDateString(now).replaceAll('-', '')}-${id.slice(0, 6)}`);
	const items: RemittanceItem[] = selected.value.map((charge, index) => {
		const { property, mandate } = mandates.value.get(charge.propertyId)!;
		return {
			chargeId: charge.id,
			propertyId: property.id,
			propertyName: charge.propertyName,
			concept: charge.concept,
			amount: charge.amount,
			endToEndId: `${reference}-${String(index + 1).padStart(4, '0')}`,
			// Several charges of a mandate debited for the first time all go as first
			sequence: mandate.firstRemittanceId ? 'RCUR' : 'FRST',
			mandate: {
				reference: mandate.reference,
				debtorName: mandate.debtorName,
				iban: mandate.iban,
				...(mandate.bic ? { bic: mandate.bic } : {}),
				signedAt: mandate.signedAt,
			},
		};
	});
	const data = {
		reference,
		collectionDate: collectionDate.value,
		issuedAt: sepaDateTime(now),
		creditor: {
			name: community.value.name,
			id: creditorId(community.value.cif!, community.value.sepaSuffix),
			iban: community.value.iban!,
			...(community.value.bic ? { bic: community.value.bic } : {}),
		},
		items,
		total: selectedTotal.value,
	};

	// Money: it waits for the server before telling it's done
	generating.value = true;
	try {
		await createRemittance(props.id, id, data);
		download(data);
		remittances.value = [{ ...data, id, status: 'generated' } as Remittance, ...remittances.value];
		openId.value = id;
		excluded.value = new Set();
		toast(`Remesa ${reference} generada, súbela a la banca online`);
	} catch (e) {
		formError.value = `No se ha podido generar: ${(e as Error).message}`;
	} finally {
		generating.value = false;
	}
}

const generateForm = useTemplateRef('generateForm');
useShortcut('mod+enter', () => generateForm.value?.requestSubmit(), 'Generar la remesa');

/* Remittances */

const busyId = ref<string>();
const actionError = ref<string>();

function replace(remittance: Remittance) {
	remittances.value = remittances.value.map(other => other.id === remittance.id ? remittance : other);
}

function returnedCount(remittance: Remittance) {
	return remittance.items.filter(item => item.returned).length;
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

async function advance(remittance: Remittance) {
	const next = remittance.status === 'generated' ? 'sent' : 'collected';
	// Collected, its charges are paid the day the bank charged them
	const at = next === 'collected' ? Timestamp.fromDate(new Date(`${remittance.collectionDate}T12:00`)) : Timestamp.now();
	await run(remittance.id, async () => {
		const updated = await setRemittanceStatus(props.id, remittance, next, at);
		replace(updated);
		toast(next === 'collected' ? 'Remesa cobrada: sus recibos quedan pagados' : 'Remesa marcada como enviada', {
			undo: async () => replace(await setRemittanceStatus(props.id, updated, remittance.status, null)),
		});
	});
}

async function remove(remittance: Remittance) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar la remesa ${remittance.reference}? Sus recibos podrán ir en otra.`)) {
		return;
	}
	await run(remittance.id, async () => {
		await deleteRemittance(props.id, remittance);
		remittances.value = remittances.value.filter(other => other.id !== remittance.id);
		toast('Remesa borrada', {
			undo: async () => {
				const { reference, collectionDate, issuedAt, creditor, items, total } = remittance;
				await createRemittance(props.id, remittance.id, { reference, collectionDate, issuedAt, creditor, items, total });
				remittances.value = [remittance, ...remittances.value].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
			},
		});
	});
}

// The debit being returned, with its form as typed
const returning = ref<string>();
const returnForm = ref({ reason: 'AM04' as ReturnReason, date: '', fee: '' });
const returnError = ref<string>();

function startReturn(item: RemittanceItem) {
	returning.value = item.chargeId;
	returnError.value = undefined;
	returnForm.value = { reason: 'AM04', date: toDateString(new Date()), fee: '' };
}

async function confirmReturn(remittance: Remittance, item: RemittanceItem) {
	const fee = returnForm.value.fee.trim() ? toCents(returnForm.value.fee) : 0;
	if (!(fee >= 0)) {
		returnError.value = 'Escribe unos gastos válidos, p. ej. 3,50, o déjalo vacío.';
		return;
	}
	if (!returnForm.value.date) {
		returnError.value = 'Elige la fecha de la devolución.';
		return;
	}
	await run(remittance.id, async () => {
		const result = await returnDebit(props.id, remittance, item, {
			reason: returnForm.value.reason,
			date: returnForm.value.date,
			...(fee ? { fee: { id: newId(), cents: fee } } : {}),
		});
		replace(result.remittance);
		returning.value = undefined;
		toast(fee ? 'Devolución registrada y gastos cargados' : 'Devolución registrada: el recibo vuelve a estar pendiente', {
			undo: async () => replace(await result.undo()),
		});
	});
}
</script>

<template>
	<header class="page-header">
		<h1>Remesas</h1>
	</header>

	<p class="intro hint">
		<LnxIcon icon="lucide:info" />
		La remesa se descarga como fichero SEPA (pain.008) y se sube a la banca online de la comunidad. No hace falta conectar con el banco ni tiene coste.
	</p>

	<form ref="generateForm" class="card" @submit.prevent="generate()">
		<h2>Nueva remesa</h2>
		<p v-if="propertiesError || chargesError" class="error" role="alert">
			No se han podido cargar: {{ (propertiesError ?? chargesError)?.message }}
		</p>
		<p v-if="creditorProblem" class="warning">
			<LnxIcon icon="lucide:triangle-alert" />
			{{ creditorProblem }}
			<RouterLink :to="`/communities/${id}/info`">
				Complétalo en sus datos
			</RouterLink>
		</p>

		<div class="fields">
			<DatePicker v-model="dueUntil">
				Vencidos hasta
				<template #helper>
					Vacío, todos los pendientes
				</template>
			</DatePicker>
			<LnxSelect
				v-model.convert="batch"
				:options="batchOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Lote
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ batchOptions.find(option => option.value === value)?.label ?? 'Todos' }}
				</template>
			</LnxSelect>
			<DatePicker v-model="collectionDate" :min="tomorrow" required>
				Fecha de cargo
			</DatePicker>
		</div>

		<ul v-if="(propertiesPending || chargesPending) && !shown.length" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65]" :key="width" class="charge">
				<span class="skeleton-item" :style="{ width: `${width}%` }" />
				<span class="skeleton-item skeleton-item--small" style="width: 70px" />
			</li>
		</ul>
		<ul v-else-if="shown.length" class="list ux-appear">
			<li v-for="charge in shown" :key="charge.id" class="charge">
				<LnxCheckbox :model-value="!excluded.has(charge.id)" @update:model-value="value => toggleCharge(charge, !!value)">
					<span class="what">
						<span>{{ charge.propertyName }} · {{ charge.concept }}</span>
						<small class="tabular">
							{{ mandates.get(charge.propertyId)?.mandate.debtorName }} · vence {{ dateFormat.format(charge.dueDate.toDate()) }}
							<template v-if="charge.returns?.length"> · <span class="debt">devuelto antes ({{ charge.returns.at(-1)!.reason }})</span></template>
						</small>
					</span>
				</LnxCheckbox>
				<strong class="tabular">{{ formatCents(charge.amount) }}</strong>
			</li>
		</ul>
		<p v-else class="hint">
			No hay recibos pendientes con mandato activo<template v-if="dueUntil || batch">
				con estos filtros
			</template>.
		</p>
		<p v-if="withoutMandate" class="hint">
			{{ withoutMandate }} {{ withoutMandate === 1 ? 'recibo pendiente es' : 'recibos pendientes son' }} de propiedades sin mandato activo.
			<RouterLink :to="`/communities/${id}/mandates`">
				Ver mandatos
			</RouterLink>
		</p>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<span v-else-if="selected.length" class="hint tabular">
				{{ selected.length }} {{ selected.length === 1 ? 'recibo' : 'recibos' }} · {{ formatCents(selectedTotal) }}
			</span>
			<LnxButton type="submit" :is-loading="generating" :disabled="!selected.length || !community">
				<LnxIcon icon="lucide:file-down" />
				Generar y descargar
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Remesas</h2>
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
		<ul v-else-if="remittances.length" class="list ux-appear">
			<li v-for="remittance in remittances" :key="remittance.id" class="item">
				<div class="row">
					<button type="button" class="what ux-row" :aria-expanded="openId === remittance.id" @click="openId = openId === remittance.id ? undefined : remittance.id">
						<strong class="tabular">{{ remittance.reference }}</strong>
						<small class="tabular">
							Cargo el {{ dateFormat.format(new Date(`${remittance.collectionDate}T00:00`)) }} · {{ remittance.items.length }} recibos · {{ formatCents(remittance.total) }}
							<template v-if="returnedCount(remittance)"> · <span class="debt">{{ returnedCount(remittance) }} {{ returnedCount(remittance) === 1 ? 'devuelto' : 'devueltos' }}</span></template>
						</small>
					</button>
					<span class="chip" :class="{ ok: remittance.status === 'collected' }">{{ remittanceStatuses[remittance.status] }}</span>
					<div class="item-actions">
						<LnxButton mode="clear" size="small" shape="circle" aria-label="Descargar fichero" title="Descargar fichero" @click="download(remittance)">
							<LnxIcon icon="lucide:download" />
						</LnxButton>
						<LnxButton v-if="remittance.status !== 'collected'" mode="clear" size="small" :is-loading="busyId === remittance.id" @click="advance(remittance)">
							{{ remittance.status === 'generated' ? 'Marcar enviada' : 'Marcar cobrada' }}
						</LnxButton>
						<LnxButton
							v-if="remittance.status === 'generated'"
							mode="clear"
							size="small"
							shape="circle"
							variant="danger"
							aria-label="Borrar"
							title="Borrar"
							:disabled="busyId === remittance.id"
							@click="remove(remittance)"
						>
							<LnxIcon icon="lucide:trash-2" />
						</LnxButton>
					</div>
				</div>

				<div v-if="openId === remittance.id" class="debits">
					<p class="hint tabular">
						Acreedor {{ remittance.creditor.id }}. {{ remittance.status === 'generated'
							? 'Cuando la subas al banco, márcala como enviada.'
							: 'Si el banco devuelve algún recibo, regístralo aquí: vuelve a quedar pendiente.' }}
					</p>
					<ul>
						<li v-for="item in remittance.items" :key="item.chargeId" class="debit">
							<div class="charge">
								<div class="what">
									<span>{{ item.propertyName }} · {{ item.concept }}</span>
									<small class="tabular">
										{{ item.mandate.debtorName }} · {{ item.sequence === 'FRST' ? 'primer adeudo' : 'recurrente' }}
										<template v-if="item.returned">
											· <span class="debt">devuelto el {{ dateFormat.format(new Date(`${item.returned.date}T00:00`)) }}, {{ item.returned.reason }} {{ returnReasons[item.returned.reason].toLowerCase() }}</span>
										</template>
									</small>
								</div>
								<strong class="tabular" :class="{ struck: item.returned }">{{ formatCents(item.amount) }}</strong>
								<LnxButton
									v-if="remittance.status !== 'generated' && !item.returned && returning !== item.chargeId"
									mode="clear"
									size="small"
									@click="startReturn(item)"
								>
									Devolución
								</LnxButton>
							</div>
							<form v-if="returning === item.chargeId" class="return ux-appear" @submit.prevent="confirmReturn(remittance, item)">
								<div class="fields">
									<LnxSelect
										v-model.convert="returnForm.reason"
										:options="reasonOptions"
										:convert-fn="option => option.value"
										search-placeholder-text="Buscar..."
									>
										Motivo
										<template #option="{ option }">
											{{ option.label }}
										</template>
										<template #optionInput="{ value }">
											{{ reasonOptions.find(option => option.value === value)?.label }}
										</template>
									</LnxSelect>
									<DatePicker v-model="returnForm.date" required>
										Fecha
									</DatePicker>
									<LnxInput v-model="returnForm.fee" inputmode="decimal" placeholder="0,00">
										Gastos de devolución (€)
										<template #helper>
											Opcional, se cargan a la propiedad
										</template>
									</LnxInput>
								</div>
								<footer class="form-actions">
									<p v-if="returnError" class="error" role="alert">
										{{ returnError }}
									</p>
									<LnxButton type="button" mode="clear" @click="returning = undefined">
										Cancelar
									</LnxButton>
									<LnxButton type="submit" :is-loading="busyId === remittance.id">
										Registrar devolución
									</LnxButton>
								</footer>
							</form>
						</li>
					</ul>
				</div>
			</li>
		</ul>
		<p v-else class="hint">
			Aún no hay remesas.
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

.charge {
	padding: var(--lnx-spacing-2) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	:deep(.checkbox),
	:deep(.label) {
		min-width: 0;
	}
}

.debits {
	margin-top: var(--lnx-spacing-3);
	padding-left: var(--lnx-spacing-4);
	border-left: 2px solid var(--color-gray-3);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.return {
	margin-bottom: var(--lnx-spacing-3);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
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

.struck {
	color: var(--color-gray-6);
	text-decoration: line-through;
}

.debt {
	color: var(--color-secondary-accent);
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
