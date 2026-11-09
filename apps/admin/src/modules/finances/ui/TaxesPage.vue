<script setup lang="ts">
import type { IncomeKind, ManualEntry } from '@gobernansa/shared/domain/accounting.ts';
import type { Declarant, Withholding } from '@gobernansa/shared/domain/aeat.ts';
import { incomeAmounts, incomeKinds } from '@gobernansa/shared/domain/accounting.ts';
import { attributeIncome, incomeTotals, model184File, model190File, model347File, operations347, provinceCode, quarterReturn, taxDeadlines, THRESHOLD_184, THRESHOLD_347, withholdings } from '@gobernansa/shared/domain/aeat.ts';
import { checkAeat } from '@gobernansa/shared/domain/fileChecks.ts';
import { isValidNif, normalizeTaxId } from '@gobernansa/shared/domain/fiscal.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { remote } from '@gobernansa/shared/infrastructure/remoteConfig.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, onMounted, reactive, ref, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { downloadFile } from '@/app/ux/download.ts';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { toast } from '@/app/ux/toast.ts';
import { useProviders } from '@/modules/providers/application/useProviders.ts';
import { deleteManualEntry, restoreManualEntry } from '../application/useAccounting.ts';
import { useFileCheck } from '../application/useFileCheck.ts';
import { addIncome, addTaxDeadlines, loadTaxData } from '../application/useTaxes.ts';
import FileCheck from './FileCheck.vue';

const props = defineProps<{ id: string }>();

type TaxData = Awaited<ReturnType<typeof loadTaxData>>;
type Model = '347' | '190' | '184';

const models: Record<Model, string> = { 347: '347 · Operaciones con terceros', 190: '111 y 190 · Retenciones', 184: '184 · Ingresos de la comunidad' };
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
const quarters = ['1T', '2T', '3T', '4T'];
const currentYear = new Date().getFullYear();
// Returns are filed for the year just ended
const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i).map(value => ({ value, label: String(value) }));
const year = ref(currentYear - 1);

// The model in the address, so a link (e.g. from an obligation) opens the right one
const route = useRoute();
const router = useRouter();
const model = computed<Model>(() => (Object.keys(models) as Model[]).find(key => key === route.query.model) ?? '347');
function setModel(key: Model) {
	return router.replace({ query: { ...route.query, model: key } });
}

/* Data: read once per year, read again when coming back */

const cache = reactive(new Map<number, TaxData>());
const loading = ref(true);
const error = ref<string>();

async function load(refresh = false) {
	const wanted = year.value;
	if (cache.has(wanted) && !refresh) {
		loading.value = false;
		error.value = undefined;
		return;
	}
	loading.value = !cache.has(wanted);
	try {
		const loaded = await loadTaxData(props.id, wanted);
		cache.set(wanted, loaded);
		error.value = loaded.community ? undefined : 'No existe esta comunidad.';
	} catch (e) {
		if (cache.has(wanted)) {
			toast(`No se ha podido actualizar: ${(e as Error).message}`, { tone: 'error' });
		} else {
			error.value = `No se han podido cargar los datos: ${(e as Error).message}`;
		}
	} finally {
		if (wanted === year.value) {
			loading.value = false;
		}
	}
}

onMounted(load);
onRevalidate(async () => {
	[...cache.keys()].filter(key => key !== year.value).forEach(key => cache.delete(key));
	await load(true);
});
watch(year, async () => load());

const data = computed(() => cache.get(year.value));
const community = computed(() => data.value?.community);
const { providers } = useProviders(() => props.id);

/* Who files them: the community, with the office as the person to contact. Prefilled, the office can change them */

const presenter = reactive({ phone: '', contact: '', email: '', representativeNif: '', representativeName: '' });
watch(community, (loaded) => {
	const admin = loaded?.contacts?.find(contact => contact.type === 'admin');
	const president = loaded?.contacts?.find(contact => contact.type === 'president');
	presenter.phone ||= admin?.phone ?? admin?.whatsapp ?? '';
	presenter.contact ||= admin?.name ?? '';
	presenter.email ||= admin?.email ?? '';
	presenter.representativeName ||= president?.name ?? '';
}, { immediate: true });
const representativeInvalid = computed(() => !!presenter.representativeNif.trim() && !isValidNif(presenter.representativeNif));

const cifProblem = computed(() => {
	if (!community.value) {
		return undefined;
	}
	if (!community.value.cif) {
		return 'La comunidad no tiene CIF: añádelo en sus datos generales para generar los ficheros.';
	}
	return isValidNif(community.value.cif) ? undefined : `El CIF de la comunidad (${community.value.cif}) no es válido.`;
});

function declarant(): Declarant {
	return {
		nif: community.value!.cif!,
		name: community.value!.name,
		year: year.value,
		phone: presenter.phone,
		contact: presenter.contact,
		email: presenter.email,
		representativeNif: representativeInvalid.value ? undefined : normalizeTaxId(presenter.representativeNif),
		representativeName: presenter.representativeName,
	};
}

// Each file is checked before it's downloaded, as the bytes that are saved
const { check, guard, confirm, dismiss } = useFileCheck();
watch(year, dismiss);

function download(model: Model, content: Uint8Array<ArrayBuffer>) {
	const name = `${normalizeTaxId(community.value!.cif!)}-${model}-${year.value}.txt`;
	guard(model, `el modelo ${model} de ${year.value} (${name})`, checkAeat(content), () => downloadFile(name, content, 'text/plain;charset=iso-8859-1'));
}

function taxIdProblem(nif?: string) {
	if (!nif) {
		return 'Sin NIF';
	}
	return isValidNif(nif) ? undefined : 'NIF no válido';
}

/* 347 */

const operations = computed(() => data.value ? operations347(year.value, data.value.expenses, data.value.incomes, providers.value) : []);
// The office's choice per declarado, over the guess of what's exempt
const exemptChoices = reactive(new Map<string, boolean>());
watch(year, () => exemptChoices.clear());
function isExempt(operation: { key: string; exempt: boolean }) {
	return exemptChoices.get(operation.key) ?? operation.exempt;
}
const declared347 = computed(() => operations.value.filter(operation => !isExempt(operation)));
const ready347 = computed(() => declared347.value.filter(operation => !taxIdProblem(operation.nif)));
const total347 = computed(() => ready347.value.reduce((sum, operation) => sum + operation.total, 0));

function download347() {
	download('347', model347File(declarant(), ready347.value));
}

/* 111, 115, 190 and 180 */

const withheld = computed(() => data.value ? withholdings(year.value, data.value.expenses, providers.value) : []);
const professionals = computed(() => withheld.value.filter(item => item.type === 'professional'));
const landlords = computed(() => withheld.value.filter(item => item.type === 'rental'));
const returns111 = computed(() => quarters.map((_, quarter) => quarterReturn(withheld.value, 'professional', quarter)));
const returns115 = computed(() => quarters.map((_, quarter) => quarterReturn(withheld.value, 'rental', quarter)));
const ready190 = computed(() => professionals.value.filter(item => !taxIdProblem(item.nif)));

function sum(list: Withholding[], field: 'base' | 'withholding') {
	return list.reduce((total, item) => total + item[field], 0);
}

function download190() {
	download('190', model190File(declarant(), ready190.value));
}

/* 184 */

const incomes = computed(() => data.value?.incomes ?? []);
const totals = computed(() => incomeTotals(year.value, incomes.value));
const grossIncome = computed(() => Object.values(totals.value).reduce((total, item) => total + item.gross, 0));
const members = computed(() => data.value ? attributeIncome(totals.value, data.value.properties) : []);
const withoutCoefficient = computed(() => data.value?.properties.filter(property => !property.coefficient).length ?? 0);
const ready184 = computed(() => members.value.filter(member => !taxIdProblem(member.nif)));
const communityProvince = computed(() => provinceCode(community.value?.address));

function download184() {
	download('184', model184File(declarant(), totals.value, members.value, community.value?.address ?? '', communityProvince.value));
}

const kindOptions = (Object.entries(incomeKinds) as [IncomeKind, { label: string }][]).map(([value, kind]) => ({ value, label: kind.label }));
// Rents and interests both bear the 19 % withholding
const RENTAL_WITHHOLDING = 19;

function emptyIncome() {
	return { date: `${year.value}-01-31`, concept: '', kind: 'rental' as IncomeKind, payer: '', payerNif: '', gross: '', rate: String(RENTAL_WITHHOLDING) };
}

const incomeForm = ref(emptyIncome());
const incomeId = ref(newId());
const incomeError = ref<string>();
const savingIncome = ref(false);
const incomeElement = useTemplateRef('incomeElement');
watch(year, () => {
	incomeForm.value = emptyIncome();
});

function resetIncome() {
	incomeForm.value = emptyIncome();
	incomeError.value = undefined;
}

const { open, show, close } = useNewForm(incomeElement, resetIncome);

// The form is in the 184 tab, so it waits for the tab to be there
async function newIncome() {
	await setModel('184');
	await show();
}

const incomeGross = computed(() => toCents(incomeForm.value.gross));
const incomeWithholding = computed(() => Math.round(incomeGross.value * (Number(incomeForm.value.rate.replace(',', '.')) || 0) / 100));

async function saveIncome() {
	const form = incomeForm.value;
	if (!(incomeGross.value > 0)) {
		incomeError.value = 'Escribe el importe íntegro, sin la retención descontada.';
		return;
	}
	if (form.payerNif.trim() && !isValidNif(form.payerNif)) {
		incomeError.value = 'El NIF del pagador no es válido.';
		return;
	}
	if (!form.date.startsWith(`${year.value}-`)) {
		incomeError.value = `La fecha debe ser de ${year.value}.`;
		return;
	}
	incomeError.value = undefined;
	savingIncome.value = true;
	try {
		await addIncome(props.id, incomeId.value, {
			date: form.date,
			concept: form.concept.trim() || `${incomeKinds[form.kind].label.split(' (')[0]} · ${form.payer.trim()}`,
			source: { kind: form.kind, payer: form.payer.trim(), payerNif: normalizeTaxId(form.payerNif) || undefined },
			gross: incomeGross.value,
			withholding: incomeWithholding.value,
		});
		incomeId.value = newId();
		// Closed, keeping the date, type and payer for the next one
		close();
		incomeForm.value = { ...emptyIncome(), date: form.date, kind: form.kind, payer: form.payer, payerNif: form.payerNif, rate: form.rate };
		toast('Ingreso añadido');
		await load(true);
	} catch (e) {
		incomeError.value = `No se ha podido guardar: ${(e as Error).message}`;
	} finally {
		savingIncome.value = false;
	}
}

async function removeIncome(entry: ManualEntry) {
	try {
		await deleteManualEntry(props.id, entry);
		await load(true);
		toast('Ingreso borrado', {
			undo: async () => {
				await restoreManualEntry(props.id, entry);
				await load(true);
			},
		});
	} catch (e) {
		toast(`No se ha podido borrar: ${(e as Error).message}`, { tone: 'error' });
	}
}

/* Plazos */

const deadlines = computed(() => taxDeadlines(year.value, landlords.value.length > 0, grossIncome.value > 0));
const addingDeadlines = ref(false);

async function addDeadlines() {
	addingDeadlines.value = true;
	try {
		const added = await addTaxDeadlines(props.id, deadlines.value.filter(deadline => new Date(`${deadline.due}T23:59`) >= new Date()));
		toast(added ? `${added} ${added === 1 ? 'plazo añadido' : 'plazos añadidos'} a las obligaciones` : 'Los plazos ya estaban en las obligaciones');
	} catch (e) {
		toast(`No se han podido añadir: ${(e as Error).message}`, { tone: 'error' });
	} finally {
		addingDeadlines.value = false;
	}
}

// The files can be turned off from the console (ROB-5) while one of them is being fixed
const canDownload = computed(() => !loading.value && !error.value && !cifProblem.value && remote.aeatFiles);
const downloads: Record<Model, () => void> = { 347: download347, 190: download190, 184: download184 };
useShortcut('d', () => downloads[model.value](), 'Descargar el fichero', () => canDownload.value);
useShortcut('mod+enter', () => incomeElement.value?.requestSubmit(), 'Guardar el ingreso', () => model.value === '184' && open.value);
</script>

<template>
	<header class="page-header">
		<h1>Modelos fiscales</h1>
		<LnxSelect
			v-model.convert="year"
			class="year"
			aria-label="Ejercicio"
			:options="yearOptions"
			:convert-fn="option => option.value"
			search-placeholder-text="Buscar..."
		>
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ value }}
			</template>
		</LnxSelect>
		<!-- Also from another tab, where the open form isn't in sight -->
		<NewButton v-if="!open || model !== '184'" label="Nuevo ingreso" :disabled="!data" @click="newIncome()" />
	</header>

	<section class="banner" role="note">
		<LnxIcon icon="lucide:triangle-alert" :size="20" />
		<p>
			<strong>Borrador — revísalo antes de presentarlo en la Sede electrónica de la AEAT.</strong>
			Las cifras salen de las facturas y los ingresos registrados. El fichero se presenta en la Sede con «Presentación mediante fichero»
			y el certificado de la comunidad; desde aquí no se envía nada a Hacienda.
		</p>
	</section>
	<p v-if="!remote.aeatFiles" class="warning" role="note">
		La descarga de los ficheros de la AEAT está desactivada temporalmente mientras se revisa.
	</p>

	<p v-if="error" class="error card" role="alert">
		{{ error }}
	</p>

	<template v-else>
		<p v-if="cifProblem" class="warning" role="status">
			{{ cifProblem }}
			<RouterLink :to="`/communities/${id}/info`">
				Ir a los datos
			</RouterLink>
		</p>

		<div class="tabs" role="tablist" aria-label="Modelo">
			<button v-for="(label, key) in models" :key="key" type="button" role="tab" :aria-selected="model === key" @click="setModel(key)">
				{{ label }}
			</button>
		</div>

		<div v-if="loading" class="card" aria-busy="true" aria-label="Cargando">
			<span v-for="width in [40, 100, 92, 100, 70]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
		</div>

		<!-- 347 -->
		<section v-else-if="model === '347'" class="card ux-appear">
			<h2>Modelo 347 · {{ year }}</h2>
			<p class="hint">
				Proveedores a los que la comunidad ha pagado más de {{ formatCents(THRESHOLD_347) }} en el año (IVA incluido, por la fecha de las facturas),
				con la clave D de las comunidades de propietarios, y quienes le han pagado más de esa cifra por un alquiler, con la clave B.
				Las facturas con retención no entran: se declaran en el 190 o el 180.
				Las comunidades no declaran los suministros de luz, agua y combustibles ni los seguros de las zonas comunes: van desmarcados, revísalos.
			</p>
			<p v-if="!operations.length" class="empty">
				Ningún proveedor ni pagador supera {{ formatCents(THRESHOLD_347) }} en {{ year }}: no hay que presentar el 347.
			</p>
			<div v-else class="table">
				<table>
					<thead>
						<tr>
							<th>Declarar</th>
							<th>NIF</th>
							<th>Nombre o razón social</th>
							<th>Clave</th>
							<th v-for="quarter in quarters" :key="quarter" class="amount">
								{{ quarter }}
							</th>
							<th class="amount">
								Total
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="operation in operations" :key="operation.key" :class="{ excluded: isExempt(operation) }">
							<td>
								<LnxCheckbox :model-value="!isExempt(operation)" :aria-label="`Declarar ${operation.name}`" @update:model-value="exemptChoices.set(operation.key, !$event)" />
							</td>
							<td :class="{ debt: taxIdProblem(operation.nif) }">
								{{ operation.nif ?? taxIdProblem(operation.nif) }}<small v-if="operation.nif && taxIdProblem(operation.nif)"> · {{ taxIdProblem(operation.nif) }}</small>
							</td>
							<td>
								{{ operation.name }}
								<small v-if="!operation.province" class="hint">· sin código postal, provincia 00</small>
							</td>
							<td>{{ operation.operation }}</td>
							<td v-for="(amount, index) in operation.quarters" :key="index" class="amount">
								{{ formatCents(amount) }}
							</td>
							<td class="amount">
								<strong>{{ formatCents(operation.total) }}</strong>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p v-if="declared347.length !== ready347.length" class="warning" role="status">
				{{ declared347.length - ready347.length }} sin NIF válido no van en el fichero: complétalo en la ficha del proveedor o del ingreso.
			</p>
			<p class="hint">
				El desglose por trimestres es informativo: las comunidades de propietarios lo dejan vacío en el fichero.
			</p>
			<FileCheck v-if="check?.key === '347'" :issues="check.issues" kind="aeat" :held="!!check.held" @confirm="confirm()" @dismiss="dismiss()" />
			<footer class="actions">
				<span class="summary">{{ ready347.length }} declarados · {{ formatCents(total347) }}</span>
				<LnxButton :disabled="!canDownload || !ready347.length" @click="download347()">
					<LnxIcon icon="lucide:download" />
					Descargar fichero 347
					<Kbd combo="d" />
				</LnxButton>
			</footer>
		</section>

		<!-- 111, 115, 190 and 180 -->
		<template v-else-if="model === '190'">
			<section class="card ux-appear">
				<h2>Modelo 111 · Retenciones trimestrales {{ year }}</h2>
				<p class="hint">
					Rendimientos de actividades profesionales: las facturas con retención, por la fecha en que se pagaron.
					Las pendientes de pago entran en el trimestre en que se paguen.
				</p>
				<table>
					<thead>
						<tr>
							<th>Trimestre</th>
							<th class="amount">
								Perceptores [07]
							</th>
							<th class="amount">
								Importe de las percepciones [08]
							</th>
							<th class="amount">
								Retenciones [09] y a ingresar [30]
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, index) in returns111" :key="index">
							<td>{{ quarters[index] }}</td>
							<td class="amount">
								{{ row.recipients }}
							</td>
							<td class="amount">
								{{ formatCents(row.base) }}
							</td>
							<td class="amount">
								<strong>{{ formatCents(row.withholding) }}</strong>
							</td>
						</tr>
					</tbody>
				</table>
				<p class="hint">
					El 111 se presenta cada trimestre aunque no haya retenciones, con resultado cero, mientras la comunidad siga dada de alta como retenedora.
				</p>
			</section>

			<section v-if="landlords.length" class="card ux-appear">
				<h2>Modelo 115 · Retenciones de alquileres {{ year }}</h2>
				<table>
					<thead>
						<tr>
							<th>Trimestre</th>
							<th class="amount">
								Perceptores [01]
							</th>
							<th class="amount">
								Base [02]
							</th>
							<th class="amount">
								Retenciones [03]
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, index) in returns115" :key="index">
							<td>{{ quarters[index] }}</td>
							<td class="amount">
								{{ row.recipients }}
							</td>
							<td class="amount">
								{{ formatCents(row.base) }}
							</td>
							<td class="amount">
								<strong>{{ formatCents(row.withholding) }}</strong>
							</td>
						</tr>
					</tbody>
				</table>
				<p class="hint">
					El resumen anual de alquileres (modelo 180) son estos arrendadores: {{ landlords.map(item => `${item.name} (${formatCents(item.base)}, retenido ${formatCents(item.withholding)})`).join('; ') }}.
					Se presenta con el formulario de la Sede.
				</p>
			</section>

			<section class="card ux-appear">
				<h2>Modelo 190 · Resumen anual {{ year }}</h2>
				<p v-if="!professionals.length" class="empty">
					En {{ year }} no se pagaron facturas con retención a profesionales.
				</p>
				<div v-else class="table">
					<table>
						<thead>
							<tr>
								<th>NIF</th>
								<th>Perceptor</th>
								<th>Clave</th>
								<th class="amount">
									Percepción íntegra
								</th>
								<th class="amount">
									Retenciones
								</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="item in professionals" :key="`${item.providerId}-${item.subkey}`">
								<td :class="{ debt: taxIdProblem(item.nif) }">
									{{ item.nif ?? taxIdProblem(item.nif) }}<small v-if="item.nif && taxIdProblem(item.nif)"> · {{ taxIdProblem(item.nif) }}</small>
								</td>
								<td>
									{{ item.name }}
									<small v-if="!item.province" class="hint">· sin código postal, provincia 00</small>
								</td>
								<td :title="item.subkey === '03' ? 'Inicio de actividad' : 'Tipo general'">
									G.{{ item.subkey }}
								</td>
								<td class="amount">
									{{ formatCents(item.base) }}
								</td>
								<td class="amount">
									{{ formatCents(item.withholding) }}
								</td>
							</tr>
						</tbody>
						<tfoot>
							<tr>
								<td colspan="3">
									Total
								</td>
								<td class="amount">
									{{ formatCents(sum(professionals, 'base')) }}
								</td>
								<td class="amount">
									{{ formatCents(sum(professionals, 'withholding')) }}
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
				<p v-if="professionals.length !== ready190.length" class="warning" role="status">
					{{ professionals.length - ready190.length }} sin NIF válido no van en el fichero: complétalo en la ficha del proveedor.
				</p>
				<FileCheck v-if="check?.key === '190'" :issues="check.issues" kind="aeat" :held="!!check.held" @confirm="confirm()" @dismiss="dismiss()" />
				<footer class="actions">
					<span class="summary">La suma de los cuatro 111 debe coincidir con el total de retenciones.</span>
					<LnxButton :disabled="!canDownload || !ready190.length" @click="download190()">
						<LnxIcon icon="lucide:download" />
						Descargar fichero 190
						<Kbd combo="d" />
					</LnxButton>
				</footer>
			</section>
		</template>

		<!-- 184 -->
		<template v-else>
			<section class="card ux-appear">
				<h2>Ingresos de la comunidad en {{ year }}</h2>
				<p class="hint">
					Lo que la comunidad cobra a terceros, como el alquiler de la azotea a una operadora o los intereses de la cuenta.
					Se apunta en la contabilidad y se atribuye a los propietarios por su coeficiente.
				</p>
				<ul v-if="incomes.length" class="incomes">
					<li v-for="entry in incomes" :key="entry.id">
						<div>
							<strong>{{ entry.concept }}</strong>
							<span class="hint">
								{{ dateFormat.format(new Date(`${entry.date}T12:00`)) }} · {{ entry.income?.payer }}{{ entry.income?.payerNif ? ` (${entry.income.payerNif})` : '' }}
							</span>
						</div>
						<span class="amount">
							{{ formatCents(incomeAmounts(entry).gross) }}
							<small v-if="incomeAmounts(entry).withholding" class="hint">retenido {{ formatCents(incomeAmounts(entry).withholding) }}</small>
						</span>
						<LnxButton mode="clear" class="size-small" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="removeIncome(entry)">
							<LnxIcon icon="lucide:trash-2" />
						</LnxButton>
					</li>
				</ul>
				<p v-else class="empty">
					No hay ingresos de terceros en {{ year }}.
				</p>
			</section>

			<form v-if="open" ref="incomeElement" class="card ux-appear" @submit.prevent="saveIncome()">
				<h2>Nuevo ingreso</h2>
				<div class="fields">
					<DatePicker v-model="incomeForm.date" required>
						Fecha de cobro
					</DatePicker>
					<LnxSelect
						v-model.convert="incomeForm.kind"
						:options="kindOptions"
						:convert-fn="option => option.value"
						search-placeholder-text="Buscar..."
					>
						Tipo
						<template #option="{ option }">
							{{ option.label }}
						</template>
						<template #optionInput="{ value }">
							{{ incomeKinds[value as IncomeKind]?.label }}
						</template>
					</LnxSelect>
					<LnxInput v-model="incomeForm.payer" required>
						Pagador
					</LnxInput>
					<LnxInput v-model="incomeForm.payerNif" placeholder="A00000000">
						NIF del pagador
					</LnxInput>
					<LnxInput v-model="incomeForm.gross" inputmode="decimal" required>
						Importe íntegro
					</LnxInput>
					<LnxInput v-model="incomeForm.rate" inputmode="decimal">
						Retención (%)
					</LnxInput>
					<LnxInput v-model="incomeForm.concept" class="wide" placeholder="Por ejemplo: Alquiler azotea enero">
						Concepto
					</LnxInput>
				</div>
				<footer class="actions">
					<p v-if="incomeError" class="error" role="alert">
						{{ incomeError }}
					</p>
					<span v-else-if="incomeGross > 0" class="summary">
						Cobrado en el banco {{ formatCents(incomeGross - incomeWithholding) }}<template v-if="incomeWithholding">, retenido {{ formatCents(incomeWithholding) }}</template>
					</span>
					<LnxButton type="button" mode="clear" @click="close()">
						Cancelar
						<Kbd combo="escape" />
					</LnxButton>
					<LnxButton type="submit" :is-loading="savingIncome">
						<LnxIcon icon="lucide:plus" />
						Añadir ingreso
						<Kbd combo="mod+enter" />
					</LnxButton>
				</footer>
			</form>

			<section class="card ux-appear">
				<h2>Modelo 184 · Atribución de rentas {{ year }}</h2>
				<p class="hint">
					La comunidad, como entidad en régimen de atribución de rentas, declara sus ingresos y la parte de cada propietario por su coeficiente;
					cada uno la incluye en su declaración de la renta. No tiene que presentarlo si no supera {{ formatCents(THRESHOLD_184) }} de ingresos en el año.
				</p>
				<p v-if="!grossIncome" class="empty">
					Sin ingresos en {{ year }}, no hay nada que atribuir.
				</p>
				<template v-else>
					<p class="summary">
						Ingresos {{ formatCents(grossIncome) }}<template v-for="(item, kind) in totals" :key="kind">
							· {{ incomeKinds[kind].label.split(' (')[0] }} {{ formatCents(item!.gross) }}<template v-if="item!.withholding">
								(retenido {{ formatCents(item!.withholding) }})
							</template>
						</template>
						<span v-if="grossIncome <= THRESHOLD_184" class="chip">No obligatorio</span>
					</p>
					<p v-if="withoutCoefficient" class="warning" role="status">
						{{ withoutCoefficient }} {{ withoutCoefficient === 1 ? 'propiedad no tiene' : 'propiedades no tienen' }} coeficiente y no reciben parte.
					</p>
					<div class="table">
						<table>
							<thead>
								<tr>
									<th>Propietario</th>
									<th>NIF</th>
									<th>Propiedades</th>
									<th class="amount">
										Participación
									</th>
									<th class="amount">
										Renta atribuida
									</th>
									<th class="amount">
										Retenciones
									</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="member in members" :key="member.key">
									<td>{{ member.name }}</td>
									<td :class="{ debt: taxIdProblem(member.nif) }">
										{{ member.nif ?? taxIdProblem(member.nif) }}<small v-if="member.nif && taxIdProblem(member.nif)"> · {{ taxIdProblem(member.nif) }}</small>
									</td>
									<td>{{ member.properties.join(', ') }}</td>
									<td class="amount">
										{{ member.share.toLocaleString('es', { maximumFractionDigits: 4 }) }} %
									</td>
									<td class="amount">
										{{ formatCents(Object.values(member.income).reduce((total, item) => total + item.gross, 0)) }}
									</td>
									<td class="amount">
										{{ formatCents(Object.values(member.income).reduce((total, item) => total + item.withholding, 0)) }}
									</td>
								</tr>
							</tbody>
						</table>
					</div>
					<p v-if="members.length !== ready184.length" class="warning" role="status">
						{{ members.length - ready184.length }} {{ members.length - ready184.length === 1 ? 'propietario' : 'propietarios' }} sin NIF válido no van en el fichero.
						<RouterLink :to="`/communities/${id}/properties`">
							Añade su NIF en el censo
						</RouterLink>
					</p>
					<details class="presenter">
						<summary>Representante y contacto</summary>
						<div class="fields">
							<LnxInput v-model="presenter.representativeName">
								Presidente (representante)
							</LnxInput>
							<LnxInput v-model="presenter.representativeNif" :has-error="representativeInvalid">
								NIF del presidente
							</LnxInput>
						</div>
					</details>
					<FileCheck v-if="check?.key === '184'" :issues="check.issues" kind="aeat" :held="!!check.held" @confirm="confirm()" @dismiss="dismiss()" />
					<footer class="actions">
						<span class="summary">Los rendimientos se declaran sin gastos deducibles y por el año completo; ajústalo en la Sede si no es así.</span>
						<LnxButton :disabled="!canDownload || !ready184.length" @click="download184()">
							<LnxIcon icon="lucide:download" />
							Descargar fichero 184
							<Kbd combo="d" />
						</LnxButton>
					</footer>
				</template>
			</section>
		</template>

		<details class="card presenter">
			<summary>Persona de contacto en los ficheros</summary>
			<div class="fields">
				<LnxInput v-model="presenter.contact">
					Nombre
				</LnxInput>
				<LnxInput v-model="presenter.phone" type="tel">
					Teléfono
				</LnxInput>
				<LnxInput v-model="presenter.email" type="email">
					Email (190)
				</LnxInput>
			</div>
		</details>

		<section class="card">
			<h2>Plazos de presentación</h2>
			<ul class="deadlines">
				<li v-for="deadline in deadlines" :key="deadline.id">
					<span>{{ deadline.title }}</span>
					<span class="tabular hint">hasta el {{ dateFormat.format(new Date(`${deadline.due}T12:00`)) }}</span>
				</li>
			</ul>
			<footer class="actions">
				<span class="summary">Los que aún no han vencido, con aviso previo, en las obligaciones de la comunidad.</span>
				<LnxButton mode="outline" :is-loading="addingDeadlines" @click="addDeadlines()">
					<LnxIcon icon="lucide:calendar-plus" />
					Añadir a obligaciones
				</LnxButton>
			</footer>
		</section>
	</template>
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

	.year {
		width: 110px;
	}
}

.banner {
	margin-bottom: var(--lnx-spacing-5);
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-secondary-accent);
	border-radius: var(--lnx-radius-3);
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
	color: var(--color-secondary-accent);

	p {
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
	}

	strong {
		display: block;
		color: var(--color-secondary-accent);
	}
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
		letter-spacing: 0.04em;
	}
}

.tabs {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	button {
		padding: var(--lnx-spacing-1) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: 999px;
		background: var(--color-gray-0);
		font: inherit;
		font-size: var(--lnx-font-size-small);
		color: var(--color-gray-7);
		cursor: pointer;

		&[aria-selected='true'] {
			border-color: var(--color-primary);
			color: var(--color-primary);
			font-weight: var(--lnx-font-weight-bold);
		}
	}
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
}

.actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-3);

	.summary,
	.error {
		flex: 1;
	}
}

.table {
	max-height: 480px;
	overflow: auto;
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--lnx-font-size-small);

	th,
	td {
		padding: var(--lnx-spacing-2);
		border-bottom: 1px solid var(--color-gray-3);
		text-align: left;
	}

	thead th {
		position: sticky;
		top: 0;
		background: var(--color-gray-0);
		white-space: nowrap;
	}

	tfoot td {
		font-weight: var(--lnx-font-weight-bold);
	}

	.amount {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.excluded td {
		color: var(--color-gray-6);
	}
}

.incomes {
	display: flex;
	flex-direction: column;

	li {
		padding: var(--lnx-spacing-2) 0;
		border-top: 1px solid var(--color-gray-3);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);

		div {
			flex: 1;
			display: flex;
			flex-direction: column;
		}

		.amount {
			display: flex;
			flex-direction: column;
			align-items: flex-end;
			font-variant-numeric: tabular-nums;
		}
	}
}

.deadlines {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
	gap: var(--lnx-spacing-1) var(--lnx-spacing-4);

	li {
		display: flex;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
		font-size: var(--lnx-font-size-small);
	}
}

.presenter summary {
	cursor: pointer;
	font-size: var(--lnx-font-size-small);
	color: var(--color-gray-7);
}

details.presenter[open] summary {
	margin-bottom: var(--lnx-spacing-3);
}

.chip {
	margin-left: var(--lnx-spacing-2);
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;
}

.tabular {
	font-variant-numeric: tabular-nums;
}

.summary {
	font-size: var(--lnx-font-size-small);
}

.debt {
	color: var(--color-secondary-accent);
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.empty {
	color: var(--color-gray-6);
}

.warning {
	margin-bottom: var(--lnx-spacing-4);
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);

	a {
		margin-left: var(--lnx-spacing-1);
		color: var(--color-primary);
	}

	.card & {
		margin-bottom: 0;
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
