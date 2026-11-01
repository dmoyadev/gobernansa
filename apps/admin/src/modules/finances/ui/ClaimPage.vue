<script setup lang="ts">
import type { Claim, ClaimChannel, ClaimLevel, DebtCase } from '@gobernansa/shared/domain/arrears.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Charge } from '@gobernansa/shared/domain/finance.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { MailDraft } from '@/modules/mail/application/mail.ts';
import { claimChannels, claimLevels, demoBurofaxTracking, formatRate, interestOwed, nextClaimLevel } from '@gobernansa/shared/domain/arrears.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { formatIban } from '@gobernansa/shared/domain/community.ts';
import { chargeTypes, isOverdue, outstanding } from '@gobernansa/shared/domain/finance.ts';
import { isEmail } from '@gobernansa/shared/domain/mail.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { computed, onMounted, ref } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { optimistic, toast } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { communityLine, MAIL_MODE, mailOutcome } from '@/modules/mail/application/mail.ts';
import MailModeNote from '@/modules/mail/ui/MailModeNote.vue';
import { loadDebtCase, recordClaim, restoreClaims } from '../application/useArrears.ts';
import { loadPropertyAccount } from '../application/useFinances.ts';

const props = defineProps<{ id: string; propertyId: string }>();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });
const levelOptions = Object.entries(claimLevels).map(([value, { label }]) => ({ value: value as ClaimLevel, label }));
const today = ref(new Date());

const community = ref<Community>();
const property = ref<Property>();
const charges = ref<Charge[]>([]);
const debtCase = ref<DebtCase>();
const level = ref<ClaimLevel>('reminder');
const loading = ref(true);
const error = ref<string>();

// Read once, a letter is a picture of the debt the day it's sent. Coming back reads it again
async function load() {
	try {
		const [loadedCommunity, account, loadedCase] = await Promise.all([
			loadCommunity(props.id),
			loadPropertyAccount(props.id, props.propertyId),
			loadDebtCase(props.id, props.propertyId),
		]);
		community.value = loadedCommunity;
		property.value = account.property;
		charges.value = account.charges;
		if (!debtCase.value) {
			level.value = nextClaimLevel(loadedCase?.claims);
		}
		debtCase.value = loadedCase;
		today.value = new Date();
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

const overdue = computed(() => charges.value.filter(charge => isOverdue(charge, today.value)).sort((a, b) => a.dueDate.toMillis() - b.dueDate.toMillis()));
const total = computed(() => overdue.value.reduce((sum, charge) => sum + outstanding(charge), 0));
// Until today, when the community applies them
const interest = computed(() => {
	const settings = community.value?.lateInterest;
	if (!settings) {
		return undefined;
	}
	const owed = interestOwed(charges.value, settings, today.value);
	return { ...owed, settings, byCharge: new Map(owed.items.map(item => [item.charge.id, item.amount])) };
});
const claimed = computed(() => total.value + (interest.value?.total ?? 0));
const lastClaim = computed(() => debtCase.value?.claims.at(-1));

// The letter's text, the same printed and by email
const letter = computed(() => {
	const owner = property.value?.ownerName;
	const days = claimLevels[level.value].days;
	const previous = lastClaim.value && dateFormat.format(new Date(`${lastClaim.value.date}T00:00`));
	const intro = {
		reminder: `Le recordamos que, según la contabilidad de la comunidad, a fecha de hoy figuran pendientes de pago los siguientes recibos de ${property.value?.name}. Es posible que se trate de un olvido: le rogamos que los abone en los próximos ${days} días y, si ya lo ha hecho, que nos lo comunique y disculpe las molestias.`,
		second: `${previous ? `Pese a nuestro aviso del ${previous}, siguen` : 'Siguen'} pendientes de pago los siguientes recibos de ${property.value?.name}. Le rogamos que regularice la deuda en un plazo de ${days} días para evitar su reclamación por otras vías.`,
		formal: `Por la presente se le requiere formalmente el pago de la deuda que mantiene con la comunidad por ${property.value?.name}, detallada a continuación, en un plazo de ${days} días naturales desde la recepción de este escrito.`,
	}[level.value];
	const warning = level.value === 'formal'
		? [
				'Transcurrido dicho plazo sin haberla satisfecho, se someterá a la junta de propietarios la aprobación de la liquidación de la deuda y se iniciará su reclamación judicial por el procedimiento monitorio previsto en el artículo 21 de la Ley de Propiedad Horizontal, en el que se reclamarán además los gastos de este requerimiento, los intereses y las costas que procedan.',
				'Le recordamos que, conforme al artículo 15.2 de la misma ley, los propietarios que no estén al corriente de pago de las deudas vencidas con la comunidad no tienen derecho a voto en la junta.',
			]
		: [];
	const owed = interest.value;
	const interestNote = owed?.total
		? `A la deuda se suman ${formatCents(owed.total)} de intereses de demora hasta hoy, al ${formatRate(owed.settings.rate)} anual sobre lo pendiente de cada recibo${owed.settings.graceDays ? ` desde ${owed.settings.graceDays} días después de su vencimiento` : ' desde su vencimiento'}, según lo acordado por la comunidad.`
		: undefined;
	const iban = community.value?.iban;
	const payment = iban
		? `Puede abonarlo por transferencia a la cuenta de la comunidad ${formatIban(iban)}${community.value?.bank ? ` (${community.value.bank})` : ''}, indicando como concepto «${property.value?.name}».`
		: 'Puede abonarlo en la administración de la comunidad.';
	return { greeting: owner ? `Estimado/a ${owner}:` : 'Estimado/a propietario/a:', intro, interestNote, warning, payment };
});

const subject = computed(() => `${claimLevels[level.value].title}: ${property.value?.name} · Comunidad ${community.value?.name}`);

// The letter as an email, the same queued in the outbox or opened in the user's own mail app
const emailBlocks = computed(() => [
	letter.value.greeting,
	letter.value.intro,
	overdue.value.map(charge => `${charge.concept} (vencido el ${dateFormat.format(charge.dueDate.toDate())}): ${formatCents(outstanding(charge))}${interest.value?.byCharge.get(charge.id) ? ` más ${formatCents(interest.value.byCharge.get(charge.id)!)} de intereses` : ''}`),
	`Total adeudado: ${formatCents(claimed.value)}`,
	...(letter.value.interestNote ? [letter.value.interestNote] : []),
	...letter.value.warning,
	letter.value.payment,
	`Atentamente,\nLa administración de la Comunidad de propietarios ${community.value?.name}`,
]);

const mailto = computed(() => {
	const email = property.value?.ownerEmail;
	if (!email) {
		return undefined;
	}
	const body = emailBlocks.value.map(block => Array.isArray(block) ? block.map(item => `- ${item}`).join('\n') : block).join('\n\n');
	return `mailto:${email}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body)}`;
});

function sendByEmail() {
	void record('email', {
		to: property.value!.ownerEmail!,
		communityId: props.id,
		kind: 'claim',
		link: `/communities/${props.id}/arrears/${props.propertyId}/claim`,
		subject: subject.value,
		title: claimLevels[level.value].title,
		blocks: emailBlocks.value,
		footer: [communityLine(community.value ?? {}), community.value?.cif ? `CIF ${community.value.cif}` : ''],
	});
}

// Kept in the case's log, and undone from the toast if the letter wasn't sent after all. One emailed for real can't be,
// in demo mode nothing went out
const recording = ref(false);
async function record(channel: ClaimChannel, mail?: MailDraft) {
	if (!property.value || recording.value) {
		return;
	}
	const claim: Claim = {
		date: toDateString(new Date()),
		level: level.value,
		channel,
		amount: claimed.value,
		...(channel === 'burofax' ? { tracking: demoBurofaxTracking() } : {}),
	};
	const previous = debtCase.value;
	const target = { id: property.value.id, name: property.value.name };
	recording.value = true;
	debtCase.value = {
		...(previous ?? { id: target.id, propertyId: target.id, propertyName: target.name, claims: [] }),
		id: target.id,
		status: previous?.status === 'monitorio' ? 'monitorio' : 'claimed',
		claims: [...previous?.claims ?? [], claim],
	} as DebtCase;
	await optimistic(recordClaim(props.id, target, claim, previous, mail), {
		done: claim.tracking
			? `Burofax de prueba registrado: ${claim.tracking}`
			: mail
				? `Reclamación registrada; ${mailOutcome(mail.to)}`
				: `Reclamación registrada (${claimChannels[channel].toLowerCase()})`,
		failed: 'No se ha podido registrar',
		revert: mail && MAIL_MODE !== 'demo'
			? undefined
			: async () => {
				debtCase.value = previous;
				await restoreClaims(props.id, previous ?? { id: target.id, propertyName: target.name, claims: [], status: 'claimed' }, !!previous);
			},
		onError: () => debtCase.value = previous,
	});
	recording.value = false;
}

function printAndRecord() {
	window.print();
	void record('letter');
}
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}/arrears`" label="Volver a morosidad" />
		<h1>Carta de reclamación</h1>
		<LnxSelect
			v-model.convert="level"
			class="level"
			aria-label="Nivel"
			:options="levelOptions"
			:convert-fn="option => option.value"
			search-placeholder-text="Buscar..."
		>
			<template #option="{ option }">
				{{ option.label }}
			</template>
			<template #optionInput="{ value }">
				{{ claimLevels[value as ClaimLevel].label }}
			</template>
		</LnxSelect>
	</header>

	<section v-if="!error && !loading" class="card send">
		<p class="hint">
			<template v-if="lastClaim">
				Última reclamación: {{ claimLevels[lastClaim.level].label.toLowerCase() }} por {{ claimChannels[lastClaim.channel].toLowerCase() }} el {{ dateFormat.format(new Date(`${lastClaim.date}T00:00`)) }}.
			</template>
			<template v-else>
				Aún no se le ha reclamado.
			</template>
			Cada envío queda en el registro de reclamaciones de la propiedad.
		</p>
		<p v-if="!overdue.length" class="warning">
			<LnxIcon icon="lucide:circle-check" />
			No tiene recibos vencidos: no hay nada que reclamar.
		</p>
		<div class="actions">
			<LnxButton :disabled="!overdue.length" :is-loading="recording" @click="printAndRecord()">
				<LnxIcon icon="lucide:printer" />
				Imprimir y registrar carta
			</LnxButton>
			<LnxButton
				mode="outline"
				:disabled="!overdue.length || !isEmail(property?.ownerEmail)"
				:is-loading="recording"
				:title="overdue.length && !isEmail(property?.ownerEmail) ? 'El censo no tiene el correo del propietario' : undefined"
				@click="sendByEmail()"
			>
				<LnxIcon icon="lucide:mail" />
				Enviar por email
			</LnxButton>
			<LnxButton mode="outline" :disabled="!overdue.length" :is-loading="recording" @click="record('burofax')">
				<LnxIcon icon="lucide:stamp" />
				Enviar por burofax
				<span class="chip test">Modo de prueba</span>
			</LnxButton>
			<LnxButton v-if="mailto && overdue.length" :href="mailto" mode="clear" @click="record('email')">
				<LnxIcon icon="lucide:external-link" />
				Abrir en mi correo
			</LnxButton>
		</div>
		<MailModeNote v-if="isEmail(property?.ownerEmail)" />
		<p class="hint">
			«Abrir en mi correo» la prepara en tu programa de correo. El burofax es simulado: no se envía nada ni tiene coste, solo se registra con un justificante de prueba hasta contratar un servicio de envío certificado.
		</p>
	</section>

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
	<article v-else-if="community && property" class="sheet ux-appear">
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

		<p class="date">
			{{ dateFormat.format(today) }}
		</p>

		<h2>{{ claimLevels[level].title }}</h2>

		<p>{{ letter.greeting }}</p>
		<p>{{ letter.intro }}</p>

		<table v-if="overdue.length">
			<thead>
				<tr>
					<th>Concepto</th>
					<th>Tipo</th>
					<th>Vencimiento</th>
					<th class="amount">
						Pendiente
					</th>
					<th v-if="interest?.total" class="amount">
						Intereses
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="charge in overdue" :key="charge.id">
					<td>{{ charge.concept }}</td>
					<td>{{ chargeTypes[charge.type] }}</td>
					<td>{{ dateFormat.format(charge.dueDate.toDate()) }}</td>
					<td class="amount">
						{{ formatCents(outstanding(charge)) }}<template v-if="charge.collections?.length">
							<br><small>de {{ formatCents(charge.amount) }}</small>
						</template>
					</td>
					<td v-if="interest?.total" class="amount">
						{{ formatCents(interest.byCharge.get(charge.id) ?? 0) }}
					</td>
				</tr>
			</tbody>
			<tfoot>
				<tr v-if="interest?.total">
					<th colspan="3">
						Subtotal
					</th>
					<th class="amount">
						{{ formatCents(total) }}
					</th>
					<th class="amount">
						{{ formatCents(interest.total) }}
					</th>
				</tr>
				<tr>
					<th colspan="3">
						Total adeudado
					</th>
					<th class="amount" :colspan="interest?.total ? 2 : 1">
						{{ formatCents(claimed) }}
					</th>
				</tr>
			</tfoot>
		</table>

		<p v-if="letter.interestNote">
			{{ letter.interestNote }}
		</p>
		<p v-for="paragraph in letter.warning" :key="paragraph">
			{{ paragraph }}
		</p>
		<p>{{ letter.payment }}</p>
		<p>Atentamente,</p>

		<footer>
			<span>La administración de la comunidad</span>
		</footer>
	</article>
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

	.level {
		min-width: 220px;
	}
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
	gap: var(--lnx-spacing-3);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;

	&.test {
		color: var(--color-gray-7);
		background: var(--color-gray-2);
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

	> header,
	address,
	.lines {
		display: flex;
		flex-direction: column;
	}

	.lines {
		gap: 2mm;
	}

	// Where a window envelope shows it
	address {
		align-self: flex-end;
		width: 85mm;
		font-style: normal;
	}

	.date {
		align-self: flex-end;
	}

	h2 {
		font-size: 13pt;
		text-transform: uppercase;
	}

	p {
		text-align: justify;
	}

	> footer {
		margin-top: 20mm;
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
	.page-header,
	.send {
		display: none;
	}

	.sheet {
		max-width: none;
		min-height: auto;
		padding: 0;
		box-shadow: none;
	}
}
</style>
