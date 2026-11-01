<script setup lang="ts">
import type { DebtCase, NotificationMethod } from '@gobernansa/shared/domain/arrears.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { debtCaseStatus, notificationMethods } from '@gobernansa/shared/domain/arrears.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { formatIban } from '@gobernansa/shared/domain/community.ts';
import { chargeTypes } from '@gobernansa/shared/domain/finance.ts';
import { meetingTypes } from '@gobernansa/shared/domain/meeting.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, onMounted, ref } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { toast } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { useMeetings } from '@/modules/meetings/application/useMeetings.ts';
import { loadDebtCase, saveMonitorio } from '../application/useArrears.ts';
import { loadPropertyAccount } from '../application/useFinances.ts';

const props = defineProps<{ id: string; propertyId: string }>();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });
const meetings = useMeetings(props.id);
const notificationOptions = Object.entries(notificationMethods).map(([value, label]) => ({ value: value as NotificationMethod, label }));

const community = ref<Community>();
const property = ref<Property>();
const charges = ref<Charge[]>([]);
const debtCase = ref<DebtCase>();
const loading = ref(true);
const error = ref<string>();

const form = ref({ meetingId: '', meetingDate: '', secretary: '', president: '', notifiedAt: '', notification: 'address' as NotificationMethod });

async function load() {
	try {
		const [loadedCommunity, account, loadedCase] = await Promise.all([
			loadCommunity(props.id),
			loadPropertyAccount(props.id, props.propertyId),
			loadDebtCase(props.id, props.propertyId),
		]);
		// The first time only, so coming back doesn't undo what's being typed
		if (!community.value) {
			const saved = loadedCase?.monitorio;
			form.value = saved
				? { meetingId: saved.meetingId ?? '', meetingDate: saved.meetingDate, secretary: saved.secretary, president: saved.president, notifiedAt: saved.notifiedAt, notification: saved.notification }
				: { ...form.value, president: loadedCommunity?.contacts?.find(contact => contact.type === 'president')?.name ?? '' };
		}
		community.value = loadedCommunity;
		property.value = account.property;
		charges.value = account.charges;
		debtCase.value = loadedCase;
		error.value = !loadedCommunity || account.property?.communityId !== props.id ? 'No existe esta comunidad o propiedad.' : undefined;
	} catch (e) {
		if (community.value) {
			toast(`No se ha podido actualizar: ${(e as Error).message}`, { tone: 'error' });
		} else {
			error.value = `No se ha podido cargar: ${(e as Error).message}`;
		}
	} finally {
		loading.value = false;
	}
}

onMounted(load);
onRevalidate(load);

// The juntas already held, the last one first. Or a date typed by hand, for one held before using the app
const meetingOptions = computed(() => [
	{ value: '', label: 'Otra junta (escribe su fecha)' },
	...meetings.value.filter(meeting => meeting.status === 'held').sort((a, b) => b.date.toMillis() - a.date.toMillis()).map(meeting => ({ value: meeting.id, label: `${meeting.title} · ${dateFormat.format(meeting.date.toDate())}` })),
]);
const meeting = computed(() => meetings.value.find(candidate => candidate.id === form.value.meetingId));

function pickMeeting(meetingId = '') {
	form.value.meetingId = meetingId;
	const picked = meetings.value.find(candidate => candidate.id === meetingId);
	if (picked) {
		form.value.meetingDate = toDateString(picked.date.toDate());
	}
}

// The debt the junta liquidated: what was due by its date and is still unpaid
const liquidated = computed(() => {
	const until = form.value.meetingDate ? new Date(`${form.value.meetingDate}T23:59:59`).getTime() : Date.now();
	return charges.value.filter(charge => !charge.paidAt && charge.dueDate.toMillis() < until).sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis());
});
const amount = computed(() => liquidated.value.reduce((sum, charge) => sum + charge.amount, 0));
const meetingDate = computed(() => form.value.meetingDate ? dateFormat.format(new Date(`${form.value.meetingDate}T00:00`)) : '____________');
const juntaName = computed(() => meeting.value ? `junta ${meetingTypes[meeting.value.type].toLowerCase()} de propietarios` : 'junta de propietarios');

const saving = ref(false);
const formError = ref<string>();

async function save() {
	if (!property.value || saving.value) {
		return;
	}
	if (!form.value.meetingDate || !form.value.secretary.trim() || !form.value.president.trim()) {
		formError.value = 'Indica la fecha de la junta, el secretario y el presidente.';
		return;
	}
	if (!amount.value) {
		formError.value = 'No hay deuda vencida en la fecha de la junta.';
		return;
	}
	// Money and a court case: it waits for the server
	saving.value = true;
	formError.value = undefined;
	try {
		const monitorio = {
			...(form.value.meetingId ? { meetingId: form.value.meetingId } : {}),
			meetingDate: form.value.meetingDate,
			amount: amount.value,
			secretary: form.value.secretary.trim(),
			president: form.value.president.trim(),
			notifiedAt: form.value.notifiedAt,
			notification: form.value.notification,
			preparedAt: toDateString(new Date()),
		};
		await saveMonitorio(props.id, property.value, monitorio, !!debtCase.value);
		debtCase.value = { ...(debtCase.value ?? { claims: [] }), id: property.value.id, propertyId: property.value.id, propertyName: property.value.name, status: 'monitorio', monitorio } as DebtCase;
		toast('Monitorio preparado');
	} catch (e) {
		formError.value = `No se ha podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}

function print() {
	window.print();
}
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}/arrears`" label="Volver a morosidad" />
		<h1>Procedimiento monitorio</h1>
		<span v-if="debtCase" class="chip">{{ debtCaseStatus[debtCase.status] }}</span>
		<LnxButton mode="outline" :disabled="loading || !!error || !form.meetingDate" @click="print()">
			<LnxIcon icon="lucide:printer" />
			Imprimir / Guardar PDF
		</LnxButton>
	</header>

	<form v-if="!error && !loading" class="card details" @submit.prevent="save()">
		<p class="hint">
			Para reclamar por el monitorio (art. 21 LPH) la junta debe aprobar la liquidación de la deuda y notificarla al deudor. Después, el secretario la certifica con el visto bueno del presidente y se presenta en el juzgado con la notificación y las reclamaciones enviadas.
		</p>
		<div class="fields">
			<LnxSelect
				:model-value="form.meetingId"
				:options="meetingOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
				placeholder="Otra junta (escribe su fecha)"
				@update:model-value="pickMeeting"
			>
				Junta que aprobó la liquidación
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ meetingOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
			<DatePicker v-model="form.meetingDate" :max="toDateString(new Date())" required @update:model-value="form.meetingId = ''">
				Fecha de la junta
			</DatePicker>
			<LnxInput v-model="form.secretary" required>
				Secretario/a
			</LnxInput>
			<LnxInput v-model="form.president" required>
				Presidente/a
			</LnxInput>
			<DatePicker v-model="form.notifiedAt" :min="form.meetingDate || undefined">
				Notificada al deudor el
			</DatePicker>
			<LnxSelect
				v-model.convert="form.notification"
				:options="notificationOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Forma de notificación
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ notificationMethods[value as NotificationMethod] }}
				</template>
			</LnxSelect>
		</div>
		<p v-if="!form.notifiedAt" class="warning">
			<LnxIcon icon="lucide:triangle-alert" />
			Sin la notificación del acuerdo no se puede iniciar el monitorio. Imprime la notificación (segunda página), entrégala y anota la fecha.
		</p>
		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<span class="hint tabular">Deuda liquidada: <strong>{{ formatCents(amount) }}</strong></span>
			<LnxButton type="submit" :is-loading="saving">
				<LnxIcon icon="lucide:gavel" />
				Guardar y marcar monitorio preparado
			</LnxButton>
		</footer>
	</form>

	<p v-if="error" class="error" role="alert">
		{{ error }}
	</p>
	<article v-else-if="loading" class="sheet" aria-busy="true" aria-label="Cargando">
		<header>
			<span class="skeleton-item" style="width: 55%" />
			<span class="skeleton-item skeleton-item--small" style="width: 40%" />
		</header>
		<div class="lines">
			<span v-for="width in [100, 96, 100, 70]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
		</div>
	</article>
	<template v-else-if="community && property">
		<article class="sheet ux-appear">
			<header>
				<strong>Comunidad de propietarios {{ community.name }}</strong>
				<span>{{ community.address }}</span>
				<span v-if="community.cif">CIF {{ community.cif }}</span>
			</header>

			<h2>Certificado del acuerdo de liquidación de deuda</h2>

			<p>
				<strong>{{ form.secretary || '____________' }}</strong>, secretario/a de la Comunidad de propietarios {{ community.name }}, {{ community.address }}<template v-if="community.cif">
					, con CIF {{ community.cif }}
				</template>,
			</p>
			<p class="certifies">
				CERTIFICA:
			</p>
			<p>
				<strong>Primero.</strong> Que en la {{ juntaName }} celebrada el {{ meetingDate }} se aprobó la liquidación de la deuda que mantiene con la comunidad
				<strong>{{ property.ownerName || 'el/la propietario/a' }}</strong><template v-if="property.ownerNif">
					, con NIF {{ property.ownerNif }}
				</template>,
				como propietario/a de <strong>{{ property.name }}</strong>, por un importe de <strong>{{ formatCents(amount) }}</strong>, según el siguiente detalle:
			</p>

			<table>
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
					<tr v-for="charge in liquidated" :key="charge.id">
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
							Total
						</th>
						<th class="amount">
							{{ formatCents(amount) }}
						</th>
					</tr>
				</tfoot>
			</table>

			<p>
				<strong>Segundo.</strong> Que dicho acuerdo fue notificado al deudor
				<template v-if="form.notifiedAt">
					el {{ dateFormat.format(new Date(`${form.notifiedAt}T00:00`)) }}, {{ notificationMethods[form.notification].charAt(0).toLowerCase() + notificationMethods[form.notification].slice(1) }},
				</template>
				<template v-else>
					el ____________,
				</template>
				conforme al artículo 9.1.h) de la Ley de Propiedad Horizontal.
			</p>
			<p>
				<strong>Tercero.</strong> Que a la fecha de este certificado la deuda es vencida, líquida y exigible, y sigue pendiente de pago.
			</p>
			<p>
				Y para que conste y surta efectos en el procedimiento monitorio previsto en el artículo 21 de la Ley de Propiedad Horizontal, expido el presente certificado con el visto bueno del presidente/a el {{ dateFormat.format(new Date()) }}.
			</p>

			<footer class="signatures">
				<div>
					<span>Vº Bº El/la presidente/a</span>
					<strong>{{ form.president }}</strong>
				</div>
				<div>
					<span>El/la secretario/a</span>
					<strong>{{ form.secretary }}</strong>
				</div>
			</footer>
		</article>

		<article class="sheet notice ux-appear">
			<header>
				<strong>Comunidad de propietarios {{ community.name }}</strong>
				<span>{{ community.address }}</span>
				<span v-if="community.cif">CIF {{ community.cif }}</span>
			</header>

			<address>
				<strong>{{ property.ownerName || 'Propietario/a' }}</strong>
				<span>{{ property.name }}</span>
				<span>{{ community.address }}</span>
			</address>

			<h2>Notificación del acuerdo de liquidación de deuda</h2>

			<p>
				Le notificamos que la {{ juntaName }} celebrada el {{ meetingDate }} aprobó la liquidación de la deuda que mantiene con la comunidad como propietario/a de {{ property.name }},
				por un importe de <strong>{{ formatCents(amount) }}</strong>, correspondiente a {{ liquidated.length }} {{ liquidated.length === 1 ? 'recibo vencido e impagado' : 'recibos vencidos e impagados' }}.
			</p>
			<p>
				Se le requiere para que la abone<template v-if="community.iban">
					por transferencia a la cuenta de la comunidad {{ formatIban(community.iban) }}<template v-if="community.bank">
						({{ community.bank }})
					</template>,
				</template>
				en el plazo de 10 días naturales. De no hacerlo, la comunidad la reclamará judicialmente por el procedimiento monitorio del artículo 21 de la Ley de Propiedad Horizontal, sumando los gastos del requerimiento previo de pago, los intereses y las costas que procedan.
			</p>
			<p>{{ dateFormat.format(new Date()) }}</p>

			<footer class="signatures">
				<div>
					<span>Recibí: el/la propietario/a (fecha y firma)</span>
				</div>
				<div>
					<span>El/la secretario/a</span>
					<strong>{{ form.secretary }}</strong>
				</div>
			</footer>
		</article>
	</template>
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

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;
}

.card {
	max-width: 210mm;
	margin: 0 auto var(--lnx-spacing-5);
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
	grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-3);

	.error {
		flex: 1;
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.warning {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
	color: var(--color-gray-7);
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
	gap: 6mm;
	font-size: 11pt;
	line-height: 1.6;

	& + & {
		margin-top: var(--lnx-spacing-5);
	}

	> header,
	address,
	.lines {
		display: flex;
		flex-direction: column;
	}

	.lines {
		gap: 2mm;
	}

	address {
		align-self: flex-end;
		width: 85mm;
		font-style: normal;
	}

	h2 {
		text-align: center;
		font-size: 14pt;
		text-transform: uppercase;
	}

	p {
		text-align: justify;
	}

	.certifies {
		font-weight: bold;
	}
}

.signatures {
	margin-top: 15mm;
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 15mm;

	div {
		padding-top: 2mm;
		border-top: 1px solid #000000;
		display: flex;
		flex-direction: column;
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
	.page-header,
	.details {
		display: none;
	}

	// The notice on a page of its own
	.sheet {
		max-width: none;
		min-height: auto;
		padding: 0;
		box-shadow: none;

		& + & {
			margin-top: 0;
			break-before: page;
		}
	}
}
</style>
