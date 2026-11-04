<script setup lang="ts">
import type { FeeInvoice } from '@gobernansa/shared/domain/billing.ts';
import { feeInvoiceAmounts } from '@gobernansa/shared/domain/billing.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { isValidNif, normalizeTaxId } from '@gobernansa/shared/domain/fiscal.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { toast } from '@/app/ux/toast.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { issueInvoices, loadInvoice, useOffice } from '../application/useBilling.ts';

// With an invoice, its rectificativa
const props = defineProps<{ invoiceId?: string }>();

const router = useRouter();
const { data: office, error: officeError } = useOffice();
const { communities, error: communitiesError } = useCommunities();
const communityOptions = computed(() => communities.value.map(community => ({ value: community.id, label: community.name })));

const today = toDateString(new Date());
const id = ref(newId());
const form = ref({ communityId: '', date: today, lines: [{ concept: 'Honorarios de administración', amount: '' }] });

// The invoice being rectified, read once
const original = ref<FeeInvoice>();
const loading = ref(!!props.invoiceId);
const loadError = ref<string>();

onMounted(async () => {
	if (!props.invoiceId) {
		return;
	}
	try {
		original.value = await loadInvoice(props.invoiceId);
		if (original.value) {
			// From the invoice and how many times it's been rectified: two tabs rectifying it at once issue one
			id.value = `${original.value.id}-R${(original.value.rectifiedBy?.length ?? 0) + 1}`;
			reset();
		} else {
			loadError.value = 'No existe esta factura.';
		}
	} catch (e) {
		loadError.value = `No se ha podido cargar la factura: ${(e as Error).message}`;
	} finally {
		loading.value = false;
	}
});

// A rectificativa starts as the whole invoice in negative, which cancels it
function reset() {
	form.value = original.value
		? {
				communityId: original.value.communityId,
				date: today,
				lines: original.value.lines.map(line => ({ concept: line.concept, amount: (-line.base / 100).toFixed(2).replace('.', ',') })),
			}
		: { communityId: '', date: today, lines: [{ concept: 'Honorarios de administración', amount: '' }] };
}

const community = computed(() => communities.value.find(candidate => candidate.id === form.value.communityId));
const rates = computed(() => original.value ?? office.value);
const lines = computed(() => form.value.lines.map(line => ({ concept: line.concept.trim(), base: toCents(line.amount) })));
const amounts = computed(() => rates.value && lines.value.every(line => Number.isFinite(line.base))
	? feeInvoiceAmounts(lines.value, rates.value.vatRate, rates.value.withholdingRate)
	: undefined);

function addLine() {
	form.value.lines.push({ concept: '', amount: '' });
}

function removeLine(index: number) {
	form.value.lines.splice(index, 1);
}

const issuing = ref(false);
const formError = ref<string>();

function findError() {
	if (!office.value) {
		return 'Completa antes los datos fiscales del despacho.';
	}
	if (!original.value && (!community.value?.cif || !isValidNif(community.value.cif))) {
		return 'La comunidad necesita un CIF válido para facturarle: complétalo en sus datos.';
	}
	if (lines.value.some(line => !line.concept || !Number.isFinite(line.base) || !line.base)) {
		return 'Cada línea necesita un concepto y un importe, p. ej. 120,00.';
	}
	if (!amounts.value || (original.value ? !amounts.value.total : amounts.value.total <= 0)) {
		return original.value ? 'La rectificativa tiene que cambiar algo del importe.' : 'El importe tiene que ser mayor que cero.';
	}
	if (!form.value.date || form.value.date > today) {
		return 'La fecha no puede ser futura.';
	}
}

async function issue() {
	if (issuing.value) {
		return;
	}
	formError.value = findError();
	if (formError.value) {
		return;
	}
	const draftId = id.value;
	const recipient = original.value?.recipient ?? {
		nif: normalizeTaxId(community.value!.cif!),
		name: `Comunidad de propietarios ${community.value!.name}`,
		address: community.value!.address,
	};
	issuing.value = true;
	try {
		const [issued] = await issueInvoices([{
			id: draftId,
			type: original.value ? 'R1' : 'F1',
			date: form.value.date,
			communityId: form.value.communityId,
			recipient,
			lines: lines.value,
			vatRate: rates.value!.vatRate,
			withholdingRate: rates.value!.withholdingRate,
			...(original.value ? { rectifies: { id: original.value.id, number: original.value.number, date: original.value.date } } : {}),
		}]);
		toast(issued ? `Factura ${issued.number} emitida` : 'Esta factura ya estaba emitida');
		// Kept alive: the next one starts empty, with its own id
		id.value = newId();
		reset();
		void router.replace(`/billing/${draftId}`);
	} catch (e) {
		formError.value = `No se ha podido emitir: ${(e as Error).message}`;
	} finally {
		issuing.value = false;
	}
}

const invoiceForm = useTemplateRef('invoiceForm');
useShortcut('mod+enter', () => invoiceForm.value?.requestSubmit(), 'Emitir la factura');
</script>

<template>
	<header class="page-header">
		<BackButton :to="invoiceId ? `/billing/${invoiceId}` : '/billing'" :label="invoiceId ? 'Volver a la factura' : 'Volver a honorarios'" />
		<h1>{{ invoiceId ? 'Factura rectificativa' : 'Nueva factura' }}</h1>
	</header>

	<p v-if="loadError || officeError || communitiesError" class="error" role="alert">
		{{ loadError ?? `No se han podido cargar: ${(officeError ?? communitiesError)?.message}` }}
	</p>
	<div v-else-if="loading" class="card" aria-busy="true" aria-label="Cargando">
		<span v-for="width in [60, 80, 50]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
	</div>
	<form v-else ref="invoiceForm" class="card ux-appear" @submit.prevent="issue()">
		<p v-if="original" class="hint">
			<LnxIcon icon="lucide:info" />
			Rectifica la {{ original.number }} por diferencias: cada línea es lo que cambia, en negativo para rebajar. Tal cual está, la anula entera.
		</p>
		<div class="fields">
			<LnxSelect
				v-model.convert="form.communityId"
				:options="communityOptions"
				:convert-fn="option => option.value"
				:disabled="!!original"
				search-placeholder-text="Buscar..."
				required
			>
				Comunidad
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ communityOptions.find(option => option.value === value)?.label ?? original?.recipient.name ?? 'Elige una' }}
				</template>
			</LnxSelect>
			<DatePicker v-model="form.date" :min="original?.date" :max="today" required>
				Fecha de expedición
			</DatePicker>
		</div>

		<ul class="lines">
			<li v-for="(line, index) in form.lines" :key="index" class="line">
				<LnxInput v-model="line.concept" required>
					Concepto
				</LnxInput>
				<LnxInput v-model="line.amount" inputmode="decimal" placeholder="0,00" required>
					Base (€)
				</LnxInput>
				<LnxButton
					type="button"
					mode="clear"
					size="small"
					shape="circle"
					aria-label="Quitar línea"
					title="Quitar línea"
					:disabled="form.lines.length === 1"
					@click="removeLine(index)"
				>
					<LnxIcon icon="lucide:x" />
				</LnxButton>
			</li>
		</ul>
		<LnxButton type="button" mode="clear" size="small" class="add" @click="addLine()">
			<LnxIcon icon="lucide:plus" />
			Añadir línea
		</LnxButton>

		<dl v-if="amounts && rates" class="totals tabular">
			<div>
				<dt>Base</dt>
				<dd>{{ formatCents(amounts.base) }}</dd>
			</div>
			<div>
				<dt>IVA {{ rates.vatRate }} %</dt>
				<dd>{{ formatCents(amounts.vat) }}</dd>
			</div>
			<div>
				<dt>Total</dt>
				<dd>{{ formatCents(amounts.total) }}</dd>
			</div>
			<div v-if="rates.withholdingRate">
				<dt>IRPF −{{ rates.withholdingRate }} %</dt>
				<dd>{{ formatCents(-amounts.withholding) }}</dd>
			</div>
			<div>
				<dt>A pagar</dt>
				<dd>{{ formatCents(amounts.payable) }}</dd>
			</div>
		</dl>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<span v-else class="hint">El número se asigna al emitirla, sin saltos, y no se puede borrar.</span>
			<LnxButton type="submit" :is-loading="issuing" :disabled="!office">
				<LnxIcon icon="lucide:file-check" />
				Emitir
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>
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

.card {
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
}

.lines {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.line {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 140px auto;
	align-items: end;
	gap: var(--lnx-spacing-3);
}

.add {
	align-self: flex-start;
}

.totals {
	padding-top: var(--lnx-spacing-3);
	border-top: 1px solid var(--color-gray-3);
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: var(--lnx-spacing-5);

	div {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	dt {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	dd {
		font-weight: var(--lnx-font-weight-bold);
	}
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

.hint {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@media (max-width: 640px) {
	.line {
		grid-template-columns: minmax(0, 1fr) auto;

		> :first-child {
			grid-column: 1 / -1;
		}
	}
}
</style>
