<script setup lang="ts">
import type { Claim, DebtCase, DebtCaseStatus } from '@gobernansa/shared/domain/arrears.ts';
import type { LateInterest } from '@gobernansa/shared/domain/community.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import { failure } from '@gobernansa/shared/application/errors.ts';
import { toCsv } from '@gobernansa/shared/domain/accounting.ts';
import { agingBuckets, agingOf, claimChannels, claimLevels, debtCaseStatus, formatRate, interestOwed, SUGGESTED_INTEREST_RATE } from '@gobernansa/shared/domain/arrears.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { outstanding } from '@gobernansa/shared/domain/finance.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxCheckbox, LnxDatePicker, LnxIcon, LnxInput, LnxKbd, LnxSelect, toast, useConfirm } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { downloadFile } from '@/app/ux/download.ts';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { issueInterestCharge, loadDebtCases, loadInterestCharges, removeClaim, restoreClaims, saveLateInterest, setDebtCaseStatus } from '../application/useArrears.ts';
import { deleteCharge, useCommunityProperties, useUnpaidCharges } from '../application/useFinances.ts';
import { useListSearch } from './listSearch.ts';

const props = defineProps<{ id: string }>();

const ask = useConfirm();

const { data: properties, pending: propertiesPending, error: propertiesError } = useCommunityProperties(props.id);
const { data: unpaid, pending: chargesPending, error: chargesError } = useUnpaidCharges(props.id);

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
const statusOptions = Object.entries(debtCaseStatus).map(([value, label]) => ({ value: value as DebtCaseStatus, label }));

const cases = ref<Record<string, DebtCase>>({});
const casesError = ref<string>();
const casesLoading = ref(true);

// Read once, and again when coming back: the claims are recorded from the letters' pages
async function loadCases() {
	try {
		cases.value = Object.fromEntries((await loadDebtCases(props.id)).map(debtCase => [debtCase.id, debtCase]));
		casesError.value = undefined;
	} catch (e) {
		casesError.value = failure('No se han podido cargar las reclamaciones', e);
	} finally {
		casesLoading.value = false;
	}
}
onMounted(loadCases);
onRevalidate(loadCases);

/* Intereses de demora: the community's setting and, while on, every recibo de intereses already issued, read once */
const settings = ref<LateInterest | null>();
const interestCharges = ref<Charge[]>([]);
const interestError = ref<string>();
// Apart from interestError, which also tells what to fix in the form: this one can be tried again
const interestLoadError = ref<string>();
const interestForm = ref({ enabled: false, rate: '', graceDays: '' });

function resetInterestForm() {
	interestForm.value = {
		enabled: !!settings.value,
		rate: ((settings.value?.rate ?? SUGGESTED_INTEREST_RATE) / 100).toFixed(2).replace('.', ','),
		graceDays: String(settings.value?.graceDays ?? 0),
	};
}

async function loadInterest() {
	try {
		const community = await loadCommunity(props.id);
		settings.value = community?.lateInterest ?? null;
		interestCharges.value = settings.value ? await loadInterestCharges(props.id) : [];
		resetInterestForm();
		interestLoadError.value = undefined;
	} catch (e) {
		interestLoadError.value = failure('No se han podido cargar los intereses de demora', e);
	}
}
onMounted(loadInterest);
onRevalidate(loadInterest);

function saveInterest() {
	const rate = toCents(interestForm.value.rate);
	const graceDays = Number(interestForm.value.graceDays);
	const next = interestForm.value.enabled ? { rate, graceDays } : null;
	if (next && !(rate > 0 && rate <= 2000)) {
		interestError.value = 'Escribe un interés anual entre 0,01 y 20, p. ej. 3,25';
		return;
	}
	if (next && !(Number.isInteger(graceDays) && graceDays >= 0 && graceDays <= 365)) {
		interestError.value = 'Los días de gracia van de 0 a 365';
		return;
	}
	const previous = settings.value ?? null;
	interestError.value = undefined;
	if (next?.rate === previous?.rate && next?.graceDays === previous?.graceDays) {
		return;
	}
	settings.value = next;
	if (next && !previous) {
		loadInterestCharges(props.id)
			.then(charges => interestCharges.value = charges)
			.catch((e: unknown) => interestLoadError.value = failure('No se han podido cargar los recibos de intereses', e));
	}
	const undo = () => {
		settings.value = previous;
		resetInterestForm();
	};
	void optimistic(saveLateInterest(props.id, next), {
		done: next ? 'Intereses de demora guardados' : 'Intereses de demora desactivados',
		failed: 'No se han podido guardar',
		revert: async () => {
			undo();
			await saveLateInterest(props.id, previous);
		},
		onError: undo,
	});
}

const now = new Date();
const today = toDateString(now);
// Until when the interest is worked out, today unless another day is picked
const interestTo = ref(today);
const interestDate = computed(() => new Date(`${interestTo.value || today}T12:00`));

// Those owing something overdue, and those with a claim still open even if they've paid since, to close it
const rows = computed(() => {
	const byProperty = Object.groupBy(unpaid.value, charge => charge.propertyId);
	const invoiced = Object.groupBy(interestCharges.value, charge => charge.propertyId);
	return properties.value.map((property) => {
		const charges = byProperty[property.id] ?? [];
		return {
			property,
			aging: agingOf(charges, now),
			debtCase: cases.value[property.id],
			interest: settings.value ? interestOwed([...invoiced[property.id] ?? [], ...charges], settings.value, interestDate.value) : undefined,
		};
	})
		.filter(row => row.aging.count || (row.debtCase && (row.debtCase.status === 'claimed' || row.debtCase.status === 'monitorio')))
		.sort((a, b) => b.aging.buckets.at(-1)! - a.aging.buckets.at(-1)! || b.aging.total - a.aging.total
			|| a.property.name.localeCompare(b.property.name, 'es', { numeric: true }));
});
const totals = computed(() => agingOf(unpaid.value, now));

const { search, matches } = useListSearch('Buscar en los deudores', useTemplateRef<HTMLElement>('searchBox'));
const shownRows = computed(() => rows.value.filter(row => matches(row.property.name, row.property.ownerName)));

// What's shown, as a spreadsheet opens it
function exportCsv() {
	const header = ['Propiedad', 'Propietario', 'Recibos vencidos', ...agingBuckets.map(bucket => bucket.label), 'Total', ...settings.value ? ['Intereses'] : [], 'Reclamación', 'Última reclamación'];
	const lines = shownRows.value.map(row => [
		row.property.name,
		row.property.ownerName ?? '',
		String(row.aging.count),
		...row.aging.buckets,
		row.aging.total,
		...settings.value ? [row.interest?.total ?? 0] : [],
		row.debtCase ? debtCaseStatus[row.debtCase.status] : 'Sin reclamar',
		lastClaim(row.debtCase) ?? '',
	]);
	downloadFile(`morosidad-${today}.csv`, toCsv([header, ...lines]), 'text/csv;charset=utf-8');
}
const interestTotal = computed(() => rows.value.reduce((sum, row) => sum + (row.interest?.total ?? 0), 0));

// A charge for the interest a property owes until the day picked. Money: it waits for the server
const invoicing = ref<string>();
async function invoiceInterest(row: typeof rows.value[number]) {
	const interest = row.interest;
	if (!interest?.total || invoicing.value) {
		return;
	}
	if (!await ask({ title: `¿Emitir a ${row.property.name} un recibo de ${formatCents(interest.total)} por los intereses de demora hasta el ${dateFormat.format(interestDate.value)}?`, confirmText: 'Emitir recibo' })) {
		return;
	}
	invoicing.value = row.property.id;
	try {
		const issued = interestCharges.value.filter(charge => charge.propertyId === row.property.id);
		const since = `${issued.map(charge => charge.interest?.to ?? '').sort().at(-1) || 'first'}-${issued.length}`;
		const charge = await issueInterestCharge(props.id, row.property, interest.items.map(item => item.charge.id), interest.total, toDateString(interestDate.value), since);
		interestCharges.value = [...interestCharges.value, charge];
		toast('Recibo de intereses emitido', {
			undo: async () => {
				await deleteCharge(props.id, charge);
				interestCharges.value = interestCharges.value.filter(other => other.id !== charge.id);
			},
		});
	} catch (e) {
		toast(failure('No se ha podido emitir', e), { variant: 'danger' });
	} finally {
		invoicing.value = undefined;
	}
}
const loading = computed(() => (propertiesPending.value || chargesPending.value || casesLoading.value) && !rows.value.length);

const openId = ref<string>();

function patchCase(propertyId: string, debtCase?: DebtCase) {
	const { [propertyId]: _, ...others } = cases.value;
	cases.value = debtCase ? { ...others, [propertyId]: debtCase } : others;
}

function changeStatus(debtCase: DebtCase, status: DebtCaseStatus) {
	const previous = debtCase.status;
	if (status === previous) {
		return;
	}
	patchCase(debtCase.id, { ...debtCase, id: debtCase.id, status });
	void optimistic(setDebtCaseStatus(props.id, debtCase, status), {
		done: `Marcado como ${debtCaseStatus[status].toLowerCase()}`,
		failed: 'No se ha podido cambiar',
		revert: async () => {
			patchCase(debtCase.id, { ...debtCase, id: debtCase.id, status: previous });
			await setDebtCaseStatus(props.id, debtCase, previous);
		},
		onError: () => patchCase(debtCase.id, { ...debtCase, id: debtCase.id, status: previous }),
	});
}

// Asked even with undo: the letter was sent, so the register stops showing a claim the owner did get
async function removeOne(debtCase: DebtCase, claim: Claim) {
	if (!await ask({ title: `¿Quitar la reclamación del ${claim.date.split('-').reverse().join('/')} del registro?`, message: 'Ya se le envió: solo deja de constar en el registro, que es la prueba de que se le reclamó.', confirmText: 'Quitar', variant: 'danger' })) {
		return;
	}
	const before = { ...debtCase, id: debtCase.id };
	patchCase(debtCase.id, { ...before, claims: before.claims.filter(other => other !== claim) });
	void optimistic(removeClaim(props.id, debtCase, claim), {
		done: 'Reclamación quitada',
		failed: 'No se ha podido quitar',
		revert: async () => {
			patchCase(debtCase.id, before);
			await restoreClaims(props.id, before);
		},
		onError: () => patchCase(debtCase.id, before),
	});
}

function lastClaim(debtCase?: DebtCase) {
	const claim = debtCase?.claims.at(-1);
	return claim && `${claimLevels[claim.level].label} · ${dateFormat.format(new Date(`${claim.date}T00:00`))}`;
}
</script>

<template>
	<header class="page-header">
		<h1>Morosidad</h1>
	</header>

	<p v-if="propertiesError || chargesError" class="error" role="alert">
		{{ failure('No se han podido cargar', propertiesError ?? chargesError) }}
	</p>
	<p v-if="casesError" class="error" role="alert">
		{{ casesError }}
		<LnxButton mode="clear" size="sm" @click="casesError = undefined; loadCases()">
			Reintentar
		</LnxButton>
	</p>
	<p v-if="interestLoadError" class="error" role="alert">
		{{ interestLoadError }}
		<LnxButton mode="clear" size="sm" @click="interestLoadError = undefined; loadInterest()">
			Reintentar
		</LnxButton>
	</p>
	<p v-if="interestError" class="error" role="alert">
		{{ interestError }}
	</p>

	<section class="card">
		<h2>Antigüedad de la deuda</h2>
		<div class="totals tabular" :aria-busy="loading">
			<div>
				<small>Deuda vencida</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 110px" />
				<strong v-else :class="{ debt: totals.total }">{{ formatCents(totals.total) }}</strong>
			</div>
			<div>
				<small>Recibos vencidos</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 40px" />
				<strong v-else>{{ totals.count }}</strong>
			</div>
			<div>
				<small>Propiedades con deuda</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 40px" />
				<strong v-else>{{ rows.filter(row => row.aging.count).length }}</strong>
			</div>
			<div v-if="settings">
				<small>Intereses de demora</small>
				<span v-if="loading" class="lnx-skeleton lnx-skeleton--title" style="width: 90px" />
				<strong v-else>{{ formatCents(interestTotal) }}</strong>
			</div>
		</div>
		<ol v-if="!loading && totals.total" class="aging tabular lnx-appear">
			<li v-for="(bucket, index) in agingBuckets" :key="bucket.label" :class="`age-${index}`">
				<span class="bar" :style="{ width: `${Math.round(totals.buckets[index] / totals.total * 100)}%` }" />
				<small>{{ bucket.label }}</small>
				<strong>{{ formatCents(totals.buckets[index]) }}</strong>
			</li>
		</ol>
	</section>

	<form class="card" @submit.prevent="saveInterest()">
		<div class="section-head">
			<h2>Intereses de demora</h2>
			<span v-if="settings" class="chip tabular">{{ formatRate(settings.rate) }} anual<template v-if="settings.graceDays"> · {{ settings.graceDays }} días de gracia</template></span>
			<span v-else-if="settings === null" class="chip">Sin intereses</span>
		</div>
		<p class="hint">
			Interés simple sobre lo que queda por pagar de cada recibo vencido, desde su vencimiento más los días de gracia. Aplícalos solo si lo ha aprobado la junta o lo prevén los estatutos, y comprueba el interés legal del dinero vigente, que fija cada año la Ley de Presupuestos. El {{ formatRate(SUGGESTED_INTEREST_RATE) }} que se propone es solo un punto de partida.
		</p>
		<span v-if="settings === undefined" class="lnx-skeleton" style="height: 40px" />
		<div v-else class="fields">
			<LnxCheckbox v-model="interestForm.enabled">
				Aplicar intereses de demora
			</LnxCheckbox>
			<LnxInput v-model="interestForm.rate" inputmode="decimal" placeholder="3,25" :disabled="!interestForm.enabled" required>
				Interés anual (%)
			</LnxInput>
			<LnxInput v-model="interestForm.graceDays" inputmode="numeric" placeholder="0" :disabled="!interestForm.enabled">
				Días de gracia
			</LnxInput>
			<LnxButton type="submit" mode="outline">
				Guardar
			</LnxButton>
		</div>
	</form>

	<section class="card">
		<div class="section-head">
			<h2>Deudores</h2>
			<LnxDatePicker v-if="settings" v-model="interestTo" value-format="iso-date" class="until" :max="today">
				Intereses hasta
			</LnxDatePicker>
			<LnxButton mode="clear" size="sm" :disabled="!shownRows.length" @click="exportCsv()">
				<LnxIcon icon="lucide:download" />
				Exportar CSV
			</LnxButton>
		</div>
		<div ref="searchBox" class="search">
			<LnxInput v-model="search" type="search" placeholder="Propiedad o propietario">
				Buscar <LnxKbd combo="/" />
			</LnxInput>
		</div>
		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65]" :key="width" class="item">
				<div class="row">
					<div class="what">
						<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
						<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width - 15}%` }" />
					</div>
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 90px" />
				</div>
			</li>
		</ul>
		<div v-else-if="shownRows.length" class="table lnx-appear">
			<table>
				<thead>
					<tr>
						<th scope="col">
							Propiedad
						</th>
						<th v-for="bucket in agingBuckets" :key="bucket.label" scope="col" class="amount">
							{{ bucket.label }}
						</th>
						<th scope="col" class="amount">
							Total
						</th>
						<th v-if="settings" scope="col" class="amount">
							Intereses
						</th>
						<th scope="col">
							Reclamación
						</th>
						<th scope="col">
							<span class="sr-only">Acciones</span>
						</th>
					</tr>
				</thead>
				<tbody>
					<template v-for="row in shownRows" :key="row.property.id">
						<tr>
							<th scope="row">
								<button type="button" class="what ux-row" :aria-expanded="openId === row.property.id" @click="openId = openId === row.property.id ? undefined : row.property.id">
									<strong>{{ row.property.name }}</strong>
									<small>{{ row.property.ownerName || 'Sin propietario' }} · {{ row.aging.count }} {{ row.aging.count === 1 ? 'recibo' : 'recibos' }}</small>
								</button>
							</th>
							<td v-for="(cents, index) in row.aging.buckets" :key="index" class="amount" :class="{ muted: !cents, debt: cents && index === agingBuckets.length - 1 }">
								{{ cents ? formatCents(cents) : '—' }}
							</td>
							<td class="amount">
								<strong>{{ formatCents(row.aging.total) }}</strong>
							</td>
							<td v-if="row.interest" class="amount" :class="{ muted: !row.interest.total }">
								{{ row.interest.total ? formatCents(row.interest.total) : '—' }}
							</td>
							<td>
								<span v-if="row.debtCase" class="chip" :class="row.debtCase.status">{{ debtCaseStatus[row.debtCase.status] }}</span>
								<span v-else class="chip">Sin reclamar</span>
								<small v-if="lastClaim(row.debtCase)" class="last">{{ lastClaim(row.debtCase) }}</small>
							</td>
							<td class="actions">
								<LnxButton
									:to="`/communities/${id}/arrears/${row.property.id}/claim`"
									mode="clear"
									size="sm"
									shape="circle"
									aria-label="Carta de reclamación"
									title="Carta de reclamación"
								>
									<LnxIcon icon="lucide:mail-warning" />
								</LnxButton>
								<LnxButton
									:to="`/communities/${id}/arrears/${row.property.id}/monitorio`"
									mode="clear"
									size="sm"
									shape="circle"
									aria-label="Procedimiento monitorio"
									title="Procedimiento monitorio"
								>
									<LnxIcon icon="lucide:gavel" />
								</LnxButton>
							</td>
						</tr>
						<tr v-if="openId === row.property.id" class="detail">
							<td :colspan="agingBuckets.length + (settings ? 5 : 4)">
								<div v-if="row.interest?.items.length" class="interest">
									<table>
										<thead>
											<tr>
												<th scope="col">
													Recibo
												</th>
												<th scope="col" class="amount">
													Pendiente
												</th>
												<th scope="col">
													Desde
												</th>
												<th scope="col" class="amount">
													Días
												</th>
												<th scope="col" class="amount">
													Intereses
												</th>
											</tr>
										</thead>
										<tbody>
											<tr v-for="item in row.interest.items" :key="item.charge.id">
												<td>{{ item.charge.concept }}</td>
												<td class="amount">
													{{ formatCents(outstanding(item.charge)) }}
												</td>
												<td>{{ dateFormat.format(new Date(`${item.from}T00:00`)) }}</td>
												<td class="amount">
													{{ item.days }}
												</td>
												<td class="amount">
													{{ formatCents(item.amount) }}
												</td>
											</tr>
										</tbody>
									</table>
									<LnxButton size="sm" mode="outline" :is-loading="invoicing === row.property.id" @click="invoiceInterest(row)">
										<LnxIcon icon="lucide:receipt-euro" />
										Generar recibo de intereses ({{ formatCents(row.interest.total) }})
									</LnxButton>
								</div>
								<div v-if="row.debtCase" class="case">
									<LnxSelect
										:model-value="row.debtCase.status"
										class="status"
										:options="statusOptions"
										:convert-fn="option => option.value"
										@update:model-value="(status?: DebtCaseStatus) => status && changeStatus(row.debtCase!, status)"
									>
										Estado
										<template #option="{ option }">
											{{ option.label }}
										</template>
										<template #optionInput="{ value }">
											{{ debtCaseStatus[value as DebtCaseStatus] }}
										</template>
									</LnxSelect>
									<p v-if="row.debtCase.monitorio" class="hint">
										Monitorio preparado el {{ dateFormat.format(new Date(`${row.debtCase.monitorio.preparedAt}T00:00`)) }} por {{ formatCents(row.debtCase.monitorio.amount) }},
										liquidación aprobada en la junta del {{ dateFormat.format(new Date(`${row.debtCase.monitorio.meetingDate}T00:00`)) }}<template v-if="row.debtCase.monitorio.notifiedAt">
											y notificada el {{ dateFormat.format(new Date(`${row.debtCase.monitorio.notifiedAt}T00:00`)) }}
										</template>.
									</p>
									<ul v-if="row.debtCase.claims.length" class="claims">
										<li v-for="claim in [...row.debtCase.claims].reverse()" :key="`${claim.date}-${claim.level}-${claim.channel}-${claim.tracking}`" class="claim">
											<div class="what">
												<span>{{ claimLevels[claim.level].label }} por {{ claimChannels[claim.channel].toLowerCase() }}</span>
												<small class="tabular">
													{{ dateFormat.format(new Date(`${claim.date}T00:00`)) }} · {{ formatCents(claim.amount) }}
													<template v-if="claim.tracking"> · {{ claim.tracking }} <span class="chip test">Prueba</span></template>
												</small>
											</div>
											<LnxButton mode="clear" size="sm" shape="circle" variant="danger" aria-label="Quitar" title="Quitar del registro" @click="removeOne(row.debtCase!, claim)">
												<LnxIcon icon="lucide:trash-2" />
											</LnxButton>
										</li>
									</ul>
									<p v-else class="hint">
										No se le ha enviado ninguna reclamación.
									</p>
								</div>
								<p v-else class="hint">
									Aún no se le ha reclamado. Genera la carta de reclamación para empezar su registro.
								</p>
							</td>
						</tr>
					</template>
				</tbody>
			</table>
		</div>
		<p v-else-if="rows.length" class="hint">
			Ningún deudor coincide con «{{ search }}».
		</p>
		<p v-else class="hint">
			Nadie debe recibos vencidos.
		</p>
	</section>
</template>

<style lang="scss" scoped src="./arrears.scss" />
