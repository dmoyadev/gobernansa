<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Remittance, RemittanceItem, ReturnReason } from '@gobernansa/shared/domain/sepa.ts';
import type { RemittanceData } from '../application/useRemittances.ts';
import { failure } from '@gobernansa/shared/application/errors.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { checkSepa } from '@gobernansa/shared/domain/fileChecks.ts';
import { outstanding } from '@gobernansa/shared/domain/finance.ts';
import { isValidIban, isValidNif } from '@gobernansa/shared/domain/fiscal.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { creditorId, remittanceStatuses, remittanceXml, returnReasons, sepaDateTime, sepaId } from '@gobernansa/shared/domain/sepa.ts';
import { remote } from '@gobernansa/shared/infrastructure/remoteConfig.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxCheckbox, LnxDatePicker, LnxIcon, LnxInput, LnxKbd, LnxSelect, toast } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';
import { downloadFile } from '@/app/ux/download.ts';
import FormCard from '@/app/ux/FormCard.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { useFileCheck } from '../application/useFileCheck.ts';
import { useCommunityProperties, useUnpaidCharges } from '../application/useFinances.ts';
import { createRemittance, deleteRemittance, loadRemittances, MAX_REMITTANCE_ITEMS, returnDebit, setRemittanceStatus } from '../application/useRemittances.ts';
import FileCheck from './FileCheck.vue';
import { useListSearch } from './listSearch.ts';
import ReturnsReport from './ReturnsReport.vue';

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
		loadError.value = failure('No se han podido cargar las remesas', e);
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
// Unpaid, not in another remittance, with an active mandate. Each debits what the entregas a cuenta left
const candidates = computed(() => unpaid.value.filter(charge => !charge.remittanceId && outstanding(charge) > 0 && mandates.value.has(charge.propertyId)));
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
const selectedTotal = computed(() => selected.value.reduce((sum, charge) => sum + outstanding(charge), 0));
const tomorrow = toDateString(new Date(Date.now() + 864e5));
// Its charges are paid the day the bank charges them, so not before
const today = toDateString(new Date());

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

// Each file is checked before it's downloaded, key is where the check shows: 'new' or the remittance's id
const { check, guard, confirm, dismiss } = useFileCheck();

function download(remittance: Remittance) {
	const xml = remittanceXml(remittance);
	guard(remittance.id, `la remesa ${remittance.reference} (${remittance.items.length} recibos por ${formatCents(remittance.total)})`, checkSepa(xml), () => downloadFile(`${remittance.reference}.xml`, xml, 'application/xml'));
}

// What was checked is what would be made, so changing it drops a held check
watch([selected, collectionDate], () => {
	if (check.value?.key === 'new' && check.value.held) {
		dismiss();
	}
});

const generateForm = useTemplateRef('generateForm');

// The next one starts over: no filters, every charge ticked, and without the check of the last file
function reset() {
	dueUntil.value = '';
	batch.value = ALL;
	collectionDate.value = '';
	excluded.value = new Set();
	formError.value = undefined;
	if (check.value?.key === 'new') {
		dismiss();
	}
}

const { open, show, close } = useNewForm(generateForm, reset);

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
			amount: outstanding(charge),
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
	const xml = remittanceXml(data);
	guard('new', `la remesa ${data.reference} (${data.items.length} recibos por ${formatCents(data.total)})`, checkSepa(xml), async () => save(id, data, xml));
}

// Whether the file was downloaded, for its activity entry
async function save(id: string, data: RemittanceData, xml: string) {
	// Money: it waits for the server before telling it's done
	generating.value = true;
	try {
		await createRemittance(props.id, id, data);
		downloadFile(`${data.reference}.xml`, xml, 'application/xml');
		remittances.value = [{ ...data, id, status: 'generated' } as Remittance, ...remittances.value];
		openId.value = id;
		// The form closes, its check stays shown under the new remittance
		const shown = check.value;
		close();
		check.value = shown && { key: id, issues: shown.issues };
		toast(`Remesa ${data.reference} generada, súbela a la banca online`);
		return true;
	} catch (e) {
		formError.value = failure('No se ha podido generar', e);
		return false;
	} finally {
		generating.value = false;
	}
}

/* Remittances */

const busyId = ref<string>();
const actionError = ref<string>();

// By reference or by what went in: a property, its account holder or a concept
const { search, matches } = useListSearch('Buscar en las remesas', useTemplateRef<HTMLElement>('searchBox'));
const shownRemittances = computed(() => remittances.value.filter(remittance => matches(remittance.reference, ...remittance.items.flatMap(item => [item.propertyName, item.mandate.debtorName, item.concept]))));

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
		actionError.value = failure('No se ha podido hacer', e);
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

// Not asked: only one not sent to the bank yet can be, and undoing it makes it again as it was
async function remove(remittance: Remittance) {
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
			...(fee ? { fee: { cents: fee } } : {}),
		});
		replace(result.remittance);
		returning.value = undefined;
		const { undo } = result;
		if (!undo) {
			toast('Ese adeudo ya estaba devuelto');
			return;
		}
		toast(fee ? 'Devolución registrada y gastos cargados' : 'Devolución registrada: el recibo vuelve a estar pendiente', {
			undo: async () => replace(await undo()),
		});
	});
}

const returns = useTemplateRef('returns');
</script>

<template>
	<header class="page-header">
		<h1>Remesas</h1>
		<LnxButton class="lnx-size-small" mode="outline" :disabled="loading" @click="returns?.open()">
			<LnxIcon icon="lucide:file-input" />
			Importar devoluciones
			<LnxKbd combo="i" />
		</LnxButton>
		<NewButton v-if="!open" label="Nueva remesa" :disabled="!remote.remittances" @click="show()" />
	</header>

	<p class="intro hint">
		<LnxIcon icon="lucide:info" />
		La remesa se descarga como fichero SEPA (pain.008) y se sube a la banca online de la comunidad. No hace falta conectar con el banco ni tiene coste.
	</p>

	<ReturnsReport :id ref="returns" :remittances :disabled="loading" @replace="replace" />

	<p v-if="!remote.remittances" class="card warning" role="note">
		La generación de remesas está desactivada temporalmente mientras se revisa. Vuelve a estar disponible en cuanto se reactive, sin actualizar la app.
	</p>
	<FormCard
		v-else-if="open"
		ref="generateForm"
		shortcut="Generar la remesa"
		title="Nueva remesa"
		submit-label="Generar y descargar"
		submit-icon="lucide:file-down"
		:saving="generating"
		:disabled="!selected.length || !community"
		@submit="generate()"
		@cancel="close()"
	>
		<p v-if="propertiesError || chargesError" class="error" role="alert">
			{{ failure('No se han podido cargar', propertiesError ?? chargesError) }}
		</p>
		<p v-if="creditorProblem" class="warning">
			<LnxIcon icon="lucide:triangle-alert" />
			{{ creditorProblem }}
			<RouterLink :to="`/communities/${id}/info`">
				Complétalo en sus datos
			</RouterLink>
		</p>

		<div class="fields">
			<LnxDatePicker v-model="dueUntil" value-format="iso-date">
				Vencidos hasta
				<template #helper>
					Vacío, todos los pendientes
				</template>
			</LnxDatePicker>
			<LnxSelect
				v-model.convert="batch"
				:options="batchOptions"
				:convert-fn="option => option.value"
			>
				Lote
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ batchOptions.find(option => option.value === value)?.label ?? 'Todos' }}
				</template>
			</LnxSelect>
			<LnxDatePicker v-model="collectionDate" value-format="iso-date" :min="tomorrow" required>
				Fecha de cargo
			</LnxDatePicker>
		</div>

		<ul v-if="(propertiesPending || chargesPending) && !shown.length" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65]" :key="width" class="charge">
				<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 70px" />
			</li>
		</ul>
		<ul v-else-if="shown.length" class="list lnx-appear">
			<li v-for="charge in shown" :key="charge.id" class="charge">
				<LnxCheckbox :model-value="!excluded.has(charge.id)" @update:model-value="value => toggleCharge(charge, !!value)">
					<span class="what">
						<span>{{ charge.propertyName }} · {{ charge.concept }}</span>
						<small class="tabular">
							{{ mandates.get(charge.propertyId)?.mandate.debtorName }} · vence {{ dateFormat.format(charge.dueDate.toDate()) }}
							<template v-if="charge.returns?.length"> · <span class="debt">devuelto antes ({{ charge.returns.at(-1)!.reason }})</span></template>
							<template v-if="charge.collections?.length"> · de {{ formatCents(charge.amount) }}, con entregas a cuenta</template>
						</small>
					</span>
				</LnxCheckbox>
				<strong class="tabular">{{ formatCents(outstanding(charge)) }}</strong>
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

		<FileCheck
			v-if="check?.key === 'new'"
			:issues="check.issues"
			kind="sepa"
			:held="!!check.held"
			confirm-label="Generar igualmente"
			@confirm="confirm()"
			@dismiss="dismiss()"
		/>
		<template #status>
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<span v-else-if="selected.length" class="hint tabular">
				{{ selected.length }} {{ selected.length === 1 ? 'recibo' : 'recibos' }} · {{ formatCents(selectedTotal) }}
			</span>
		</template>
	</FormCard>

	<section class="card">
		<h2>Remesas</h2>
		<p v-if="loadError" class="error" role="alert">
			{{ loadError }}
			<LnxButton mode="clear" class="lnx-size-small" @click="loadError = undefined; load()">
				Reintentar
			</LnxButton>
		</p>
		<div v-if="remittances.length" ref="searchBox" class="search">
			<LnxInput v-model="search" type="search" placeholder="Referencia, propiedad o titular">
				Buscar <LnxKbd combo="/" />
			</LnxInput>
		</div>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [50, 40]" :key="width" class="item">
				<div class="row">
					<div class="what">
						<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
						<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width - 15}%` }" />
					</div>
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 90px" />
				</div>
			</li>
		</ul>
		<ul v-else-if="shownRemittances.length" class="list lnx-appear">
			<li v-for="remittance in shownRemittances" :key="remittance.id" class="item">
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
						<LnxButton mode="clear" class="lnx-size-small" shape="circle" aria-label="Descargar fichero" title="Descargar fichero" @click="download(remittance)">
							<LnxIcon icon="lucide:download" />
						</LnxButton>
						<LnxButton
							v-if="remittance.status !== 'collected'"
							mode="clear"
							class="lnx-size-small"
							:is-loading="busyId === remittance.id"
							:disabled="remittance.status === 'sent' && remittance.collectionDate > today"
							:title="remittance.status === 'sent' && remittance.collectionDate > today ? `Se puede marcar cobrada desde el día del cargo, el ${remittance.collectionDate.split('-').reverse().join('/')}` : undefined"
							@click="advance(remittance)"
						>
							{{ remittance.status === 'generated' ? 'Marcar enviada' : 'Marcar cobrada' }}
						</LnxButton>
						<LnxButton
							v-if="remittance.status === 'generated'"
							mode="clear"
							class="lnx-size-small"
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
				<FileCheck
					v-if="check?.key === remittance.id"
					class="item-check"
					:issues="check.issues"
					kind="sepa"
					:held="!!check.held"
					@confirm="confirm()"
					@dismiss="dismiss()"
				/>

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
									class="lnx-size-small"
									@click="startReturn(item)"
								>
									Devolución
								</LnxButton>
							</div>
							<form v-if="returning === item.chargeId" class="return lnx-appear" @submit.prevent="confirmReturn(remittance, item)">
								<div class="fields">
									<LnxSelect
										v-model.convert="returnForm.reason"
										:options="reasonOptions"
										:convert-fn="option => option.value"
									>
										Motivo
										<template #option="{ option }">
											{{ option.label }}
										</template>
										<template #optionInput="{ value }">
											{{ reasonOptions.find(option => option.value === value)?.label }}
										</template>
									</LnxSelect>
									<LnxDatePicker v-model="returnForm.date" value-format="iso-date" required>
										Fecha
									</LnxDatePicker>
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
									<LnxButton mode="clear" @click="returning = undefined">
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
		<p v-else-if="remittances.length" class="hint">
			Ninguna remesa coincide con «{{ search }}».
		</p>
		<p v-else class="hint">
			Aún no hay remesas.
		</p>
	</section>
</template>

<style lang="scss" scoped src="./remittances.scss" />
