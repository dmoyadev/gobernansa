<script setup lang="ts">
import type { FeeInvoice } from '@gobernansa/shared/domain/billing.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { IssueDraft } from '../application/useBilling.ts';
import { invoiceTypes, monthLabel, monthlyInvoiceId } from '@gobernansa/shared/domain/billing.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { isValidNif, normalizeTaxId } from '@gobernansa/shared/domain/fiscal.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxIcon, LnxInput, LnxKbd, LnxSelect, toast, useShortcut } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { issueInvoices, loadInvoices, MAX_RUN_INVOICES, useOffice } from '../application/useBilling.ts';

const ALL = '';
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

const { data: office, pending: officePending, error: officeError } = useOffice();
const { communities, error: communitiesError } = useCommunities();
const communityNames = computed(() => new Map(communities.value.map(community => [community.id, community.name])));

const currentYear = new Date().getFullYear();
const year = ref(currentYear);
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i).map(value => ({ value, label: String(value) }));
const communityFilter = ref(ALL);
const typeFilter = ref(ALL);
const communityOptions = computed(() => [{ value: ALL, label: 'Todas' }, ...communities.value.map(community => ({ value: community.id, label: community.name }))]);
const typeOptions = [{ value: ALL, label: 'Todas' }, ...Object.entries(invoiceTypes).map(([value, label]) => ({ value, label }))];

// The year's invoices, read once: they only change here
const invoices = ref<FeeInvoice[]>([]);
const loading = ref(true);
const loadError = ref<string>();

async function load() {
	const loadedYear = year.value;
	try {
		const loaded = await loadInvoices(loadedYear);
		if (loadedYear === year.value) {
			invoices.value = loaded;
			loadError.value = undefined;
		}
	} catch (e) {
		loadError.value = `No se han podido cargar las facturas: ${(e as Error).message}`;
	} finally {
		loading.value = false;
	}
}

onMounted(load);
onRevalidate(load);
watch(year, () => {
	loading.value = true;
	invoices.value = [];
	void load();
});

const shown = computed(() => invoices.value.filter(invoice => (!communityFilter.value || invoice.communityId === communityFilter.value)
	&& (!typeFilter.value || invoice.type === typeFilter.value)));
// Annulled ones never counted
const totals = computed(() => shown.value.filter(invoice => !invoice.annulled).reduce((sum, invoice) => ({
	base: sum.base + invoice.base,
	vat: sum.vat + invoice.vat,
	withholding: sum.withholding + invoice.withholding,
	payable: sum.payable + invoice.payable,
}), { base: 0, vat: 0, withholding: 0, payable: 0 }));

/* Monthly run */

const period = ref(toDateString(new Date()).slice(0, 7));
// The list follows the run's year, so what's already billed is in it
watch(period, (value) => {
	const runYear = Number(value.slice(0, 4));
	if (runYear && runYear !== year.value) {
		year.value = runYear;
	}
});
const fees = ref<Record<string, string>>({});
watch([office, communities], () => {
	for (const community of communities.value) {
		const saved = office.value?.monthlyFees?.[community.id];
		if (!fees.value[community.id]) {
			fees.value[community.id] = saved ? (saved / 100).toFixed(2).replace('.', ',') : '';
		}
	}
}, { immediate: true });

const billed = computed(() => new Map(invoices.value.filter(invoice => invoice.period === period.value).map(invoice => [invoice.communityId, invoice])));
function cifProblem(community: Community) {
	return !community.cif || !isValidNif(community.cif) ? 'Sin CIF válido' : undefined;
}
const runnable = computed(() => communities.value.filter((community) => {
	const typed = fees.value[community.id]?.trim();
	return typed && toCents(typed) > 0 && !billed.value.has(community.id) && !cifProblem(community);
}));
const runTotal = computed(() => runnable.value.reduce((sum, community) => sum + toCents(fees.value[community.id]), 0));

const running = ref(false);
const runError = ref<string>();

async function run() {
	if (running.value || !office.value) {
		return;
	}
	const invalid = communities.value.find((community) => {
		const typed = fees.value[community.id]?.trim();
		return typed && !(toCents(typed) >= 0);
	});
	runError.value = invalid
		? `Revisa la cuota de ${invalid.name}: escribe un importe, p. ej. 120,00.`
		: !period.value
				? 'Elige el mes.'
				: !runnable.value.length
						? 'No hay comunidades por facturar este mes.'
						: runnable.value.length > MAX_RUN_INVOICES ? `Como mucho ${MAX_RUN_INVOICES} facturas de una vez: deja vacías algunas cuotas y emite el resto después.` : undefined;
	if (runError.value) {
		return;
	}

	const { vatRate, withholdingRate } = office.value;
	const date = toDateString(new Date());
	const drafts: IssueDraft[] = runnable.value.map(community => ({
		id: monthlyInvoiceId(period.value, community.id),
		type: 'F1',
		date,
		communityId: community.id,
		recipient: { nif: normalizeTaxId(community.cif!), name: `Comunidad de propietarios ${community.name}`, address: community.address },
		lines: [{ concept: `Honorarios de administración, ${monthLabel(period.value)}`, base: toCents(fees.value[community.id]) }],
		period: period.value,
		vatRate,
		withholdingRate,
	}));
	// The fees typed are remembered for next month
	const monthlyFees = Object.fromEntries(communities.value.flatMap((community) => {
		const cents = toCents(fees.value[community.id]?.trim() ?? '');
		return cents > 0 ? [[community.id, cents]] : [];
	}));

	// Invoices: it waits for the server, numbers are only known then
	running.value = true;
	try {
		const issued = await issueInvoices(drafts, monthlyFees);
		await load();
		toast(issued.length === 1 ? 'Emitida 1 factura' : `Emitidas ${issued.length} facturas de ${monthLabel(period.value)}`);
	} catch (e) {
		runError.value = `No se han podido emitir: ${(e as Error).message}`;
	} finally {
		running.value = false;
	}
}

const runForm = useTemplateRef('runForm');
useShortcut('mod+enter', () => runForm.value?.requestSubmit(), { description: 'Emitir las facturas del mes' });
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver a comunidades" />
		<h1>Honorarios</h1>
		<LnxButton to="/billing/registry" mode="clear" class="lnx-size-small">
			<LnxIcon icon="lucide:shield-check" />
			Registro Verifactu
		</LnxButton>
		<LnxButton to="/billing/office" mode="clear" class="lnx-size-small">
			<LnxIcon icon="lucide:briefcase" />
			Datos fiscales
		</LnxButton>
		<NewButton label="Nueva factura" to="/billing/new" :disabled="!office" />
	</header>

	<p class="intro hint">
		<span class="chip test">Modo de prueba</span>
		Verifactu: cada factura genera su registro encadenado y su QR, pero el envío a la AEAT es simulado y el QR lleva a su entorno de pruebas.
	</p>

	<p v-if="officeError || communitiesError" class="error" role="alert">
		No se han podido cargar: {{ (officeError ?? communitiesError)?.message }}
	</p>

	<section v-if="!office && !officePending" class="card empty lnx-appear">
		<LnxIcon icon="lucide:briefcase" :size="32" />
		<p>Para facturar los honorarios a tus comunidades, completa antes los datos fiscales del despacho.</p>
		<LnxButton to="/billing/office">
			Completar datos fiscales
		</LnxButton>
	</section>

	<form v-else-if="office" ref="runForm" class="card" @submit.prevent="run()">
		<h2>Cuotas mensuales</h2>
		<div class="fields">
			<label class="month">
				<span>Mes</span>
				<input v-model="period" type="month" required>
			</label>
		</div>
		<ul class="list">
			<li v-for="community in communities" :key="community.id" class="fee">
				<span class="what">
					<span>{{ community.name }}</span>
					<small v-if="billed.get(community.id)" class="ok">
						Facturada: <RouterLink :to="`/billing/${billed.get(community.id)!.id}`">{{ billed.get(community.id)!.number }}</RouterLink>
					</small>
					<small v-else-if="cifProblem(community)" class="debt">
						{{ cifProblem(community) }}: <RouterLink :to="`/communities/${community.id}/info`">complétalo</RouterLink>
					</small>
				</span>
				<LnxInput
					v-model="fees[community.id]"
					inputmode="decimal"
					placeholder="0,00"
					:disabled="billed.has(community.id)"
					:aria-label="`Cuota mensual de ${community.name} sin IVA`"
				/>
			</li>
		</ul>
		<p class="hint">
			Base sin IVA. Se aplica un IVA del {{ office.vatRate }} %<template v-if="office.withholdingRate">
				y una retención del {{ office.withholdingRate }} %
			</template>. Las cuotas se recuerdan para el mes siguiente.
		</p>
		<footer class="form-actions">
			<p v-if="runError" class="error" role="alert">
				{{ runError }}
			</p>
			<span v-else-if="runnable.length" class="hint tabular">
				{{ runnable.length }} {{ runnable.length === 1 ? 'factura' : 'facturas' }} · {{ formatCents(runTotal) }} de base
			</span>
			<LnxButton type="submit" :is-loading="running" :disabled="!runnable.length">
				<LnxIcon icon="lucide:files" />
				Emitir facturas de {{ period ? monthLabel(period) : 'el mes' }}
				<LnxKbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Facturas emitidas</h2>
		<div class="fields">
			<LnxSelect v-model.convert="year" :options="yearOptions" :convert-fn="option => option.value">
				Año
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ value }}
				</template>
			</LnxSelect>
			<LnxSelect v-model.convert="communityFilter" :options="communityOptions" :convert-fn="option => option.value">
				Comunidad
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ communityOptions.find(option => option.value === value)?.label ?? 'Todas' }}
				</template>
			</LnxSelect>
			<LnxSelect v-model.convert="typeFilter" :options="typeOptions" :convert-fn="option => option.value">
				Tipo
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ typeOptions.find(option => option.value === value)?.label ?? 'Todas' }}
				</template>
			</LnxSelect>
		</div>
		<p v-if="loadError" class="error" role="alert">
			{{ loadError }}
		</p>

		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [50, 40, 60]" :key="width" class="invoice">
				<span class="what">
					<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
					<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width - 15}%` }" />
				</span>
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 80px" />
			</li>
		</ul>
		<ul v-else-if="shown.length" class="list lnx-appear">
			<li v-for="invoice in shown" :key="invoice.id">
				<RouterLink :to="`/billing/${invoice.id}`" class="invoice ux-row">
					<span class="what">
						<strong class="tabular">{{ invoice.number }}</strong>
						<small>
							{{ communityNames.get(invoice.communityId) ?? invoice.recipient.name }} · {{ dateFormat.format(new Date(`${invoice.date}T00:00`)) }}
							<template v-if="invoice.rectifies"> · rectifica {{ invoice.rectifies.number }}</template>
						</small>
					</span>
					<span class="chips">
						<span v-if="invoice.annulled" class="chip debt">Anulada</span>
						<span v-else-if="invoice.rectifiedBy?.length" class="chip">Rectificada</span>
						<span v-if="invoice.type === 'R1'" class="chip">Rectificativa</span>
						<span v-if="invoice.expenseId" class="chip ok" title="Anotada en las cuentas de la comunidad">En sus cuentas</span>
					</span>
					<strong class="tabular" :class="{ struck: invoice.annulled }">{{ formatCents(invoice.total) }}</strong>
				</RouterLink>
			</li>
		</ul>
		<p v-else class="hint">
			No hay facturas<template v-if="communityFilter || typeFilter">
				con estos filtros
			</template> en {{ year }}.
		</p>

		<dl v-if="shown.length" class="totals tabular">
			<div>
				<dt>Base</dt>
				<dd>{{ formatCents(totals.base) }}</dd>
			</div>
			<div>
				<dt>IVA</dt>
				<dd>{{ formatCents(totals.vat) }}</dd>
			</div>
			<div>
				<dt>Retenciones</dt>
				<dd>{{ formatCents(totals.withholding) }}</dd>
			</div>
			<div>
				<dt>A cobrar</dt>
				<dd>{{ formatCents(totals.payable) }}</dd>
			</div>
		</dl>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	flex-wrap: wrap;
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
	flex-wrap: wrap;
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

.empty {
	align-items: center;
	text-align: center;
	color: var(--color-gray-7);
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
}

.month {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);

	input {
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		font: inherit;
		font-weight: normal;
		color: inherit;
	}
}

.list {
	display: flex;
	flex-direction: column;
}

.fee,
.invoice {
	padding: var(--lnx-spacing-2) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
}

.fee {
	grid-template-columns: minmax(0, 1fr) 140px;

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.list > li + li > .invoice {
	border-top: 1px solid var(--color-gray-3);
}

.invoice {
	color: inherit;
	text-decoration: none;
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	small {
		overflow: hidden;
		color: var(--color-gray-6);
		white-space: nowrap;
		text-overflow: ellipsis;

		&.ok,
		&.debt {
			color: inherit;
		}
	}

	a {
		color: var(--color-primary);
	}
}

.chips {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
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

	&.debt {
		color: var(--color-secondary-accent);
	}

	&.test {
		color: var(--color-gray-7);
	}
}

.ok {
	color: var(--color-primary);
}

.debt {
	color: var(--color-secondary-accent);
}

.struck {
	color: var(--color-gray-6);
	text-decoration: line-through;
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
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@media (max-width: 640px) {
	.invoice {
		grid-template-columns: minmax(0, 1fr) auto;

		.chips {
			display: none;
		}
	}
}
</style>
