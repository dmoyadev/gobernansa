<script setup lang="ts">
import type { Meeting, MeetingVote } from '@gobernansa/shared/domain/meeting.ts';
import type { MeetingNotice, Minutes, Signature, SignerRole } from '@gobernansa/shared/domain/minutes.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { tallyVotes } from '@gobernansa/shared/domain/meeting.ts';
import { isFullySigned, minutesHash, signerRoles, tallyWithAbsent } from '@gobernansa/shared/domain/minutes.ts';
import SignaturePad from '@gobernansa/shared/ui/SignaturePad.vue';
import WritingSource from '@gobernansa/shared/ui/WritingSource.vue';
import { LnxButton, LnxIcon, LnxSelect, LnxTextarea, useConfirm } from 'lnxjs-components';
import { renderSVG } from 'uqr';
import { computed, ref, watch } from 'vue';
import { optimistic } from '@/app/ux/toast.ts';
import { describeResult, saveMinutes, sealMinutes, signMinutes } from '../application/useMeetings.ts';

const props = defineProps<{
	meeting: Meeting;
	// Undefined while it loads, null until it's prepared
	minutes: Minutes | null | undefined;
	people: { id: string; name: string }[];
	notices: MeetingNotice[];
	ballots: MeetingVote[];
	total: number;
	// The acta as the page composes it, to start from
	compose: () => string;
}>();

const ask = useConfirm();

const { user } = useAuth();
const roles = Object.keys(signerRoles) as SignerRole[];
const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' });

// The community's people, plus the administrator, who is often the secretary and doesn't live in it
const signerOptions = computed(() => {
	const options = props.people.map(person => ({ value: person.id, label: person.name }));
	const extra = [user.value && { value: user.value.id, label: user.value.name || user.value.email }, ...roles.map(role => props.minutes && { value: props.minutes[role].uid, label: props.minutes[role].name })];
	for (const option of extra) {
		if (option && !options.some(known => known.value === option.value)) {
			options.push(option);
		}
	}
	return options.sort((a, b) => a.label.localeCompare(b.label, 'es'));
});

const form = ref({ text: '', president: '', secretary: '' });
// Filled once it loads, so changes made elsewhere don't overwrite what's being typed
watch(() => props.minutes, (minutes, before) => {
	if (minutes && !before) {
		form.value = { text: minutes.text, president: minutes.president.uid, secretary: minutes.secretary.uid };
	} else if (minutes === null && !form.value.secretary) {
		form.value.secretary = user.value?.id ?? '';
	}
}, { immediate: true });

const editable = computed(() => props.minutes !== undefined && !(props.minutes && isFullySigned(props.minutes)));

// Mejorar redacción: only offered when the browser has its own Rewriter, which runs on the device. Lines whose rewrite
// changes a figure or drops a name stay as they were
const polishable = ref(false);
const polishing = ref<string>();
const polishNote = ref<string>();
const unpolished = ref<string>();

watch(() => editable.value && !!props.minutes, async (open) => {
	if (open && !polishable.value) {
		const { canPolish } = await import('@gobernansa/shared/application/writing.ts');
		polishable.value = await canPolish();
	}
}, { immediate: true });

async function improve() {
	const before = form.value.text;
	polishing.value = 'Mejorando…';
	// Also undefined if its code can't load, e.g. offline
	const result = await import('@gobernansa/shared/application/writing.ts')
		.then(async ({ polish }) => polish(before, (status) => {
			polishing.value = status;
		}))
		.catch(() => undefined);
	polishing.value = undefined;
	if (!result) {
		polishNote.value = 'No se ha podido mejorar la redacción en este dispositivo.';
		return;
	}
	if (result.changed) {
		unpolished.value = before;
		form.value.text = result.text;
	}
	const kept = result.kept === 1 ? '1 párrafo se ha dejado como estaba porque cambiaba cifras o nombres.' : `${result.kept} párrafos se han dejado como estaban porque cambiaban cifras o nombres.`;
	polishNote.value = result.changed
		? `${result.changed === 1 ? 'Se ha mejorado 1 párrafo' : `Se han mejorado ${result.changed} párrafos`}. Revisa el texto antes de guardar.${result.kept ? ` ${kept}` : ''}`
		: result.kept ? `No se ha cambiado nada: ${kept}` : 'No hay nada que mejorar.';
}

function undoPolish() {
	form.value.text = unpolished.value!;
	unpolished.value = undefined;
	polishNote.value = undefined;
}

async function save() {
	const minutes = props.minutes;
	if (minutes && Object.keys(minutes.signatures).length && !await ask({ title: '¿Guardar el acta?', message: 'Al guardar se quitan las firmas que ya tiene.', confirmText: 'Guardar', variant: 'danger' })) {
		return;
	}
	const signer = (uid: string) => ({ uid, name: signerOptions.value.find(option => option.value === uid)!.label });
	void optimistic(saveMinutes(props.meeting, minutes ? form.value.text : props.compose(), signer(form.value.president), signer(form.value.secretary), !minutes), {
		done: minutes ? 'Acta guardada' : 'Acta lista para firmar',
		failed: 'No se ha podido guardar el acta',
	});
}

// Signing

const signing = ref<SignerRole>();
const path = ref('');
const busy = ref(false);

function startSigning(role: SignerRole) {
	signing.value = role;
	path.value = '';
}

async function sign() {
	const role = signing.value!;
	const signer = props.minutes![role];
	busy.value = true;
	const signed = await optimistic(signMinutes(props.meeting, signer, role, path.value), {
		done: signer.uid === user.value?.id ? 'Acta firmada' : `Firma de ${signer.name} guardada`,
		failed: 'No se ha podido firmar',
	});
	busy.value = false;
	if (signed) {
		signing.value = undefined;
	}
}

// Sealed by whoever signs last, from the app too. If that failed, here when it's seen
watch(() => !!props.minutes && isFullySigned(props.minutes) && !props.minutes.closedAt && !busy.value, (ready) => {
	if (ready) {
		void optimistic(sealMinutes(props.meeting), { failed: 'No se ha podido cerrar el acta' });
	}
}, { immediate: true });

function describeSignature(signature: Signature) {
	const at = dateFormat.format(signature.signedAt.toDate());
	return signature.byUid === signature.uid
		? `Firmado por su cuenta (${signature.byEmail}) el ${at}`
		: `Firmado en persona, en la sesión de ${signature.byEmail}, el ${at}`;
}

// The seal

// Computed again from what's stored, so a copy changed by hand would show
const verified = ref<boolean>();
watch(() => props.minutes?.hash, async () => {
	const minutes = props.minutes;
	verified.value = minutes?.hash ? await minutesHash(minutes) === minutes.hash : undefined;
}, { immediate: true });

const qr = computed(() => props.minutes?.hash && renderSVG(`Acta ${props.meeting.communityId}/${props.meeting.id} SHA-256 ${props.minutes.hash}`, { ecc: 'M', border: 2 }));

// Art. 17.8 LPH

const absentCount = computed(() => props.notices.filter(notice => notice.kind === 'minutes' && notice.absent).length);
const agreements = computed(() => props.meeting.agenda.filter(item => item.votable).map((item) => {
	const tally = tallyVotes(props.ballots, item.id);
	const withAbsent = tallyWithAbsent(tally, props.notices, item.id);
	return {
		item,
		present: describeResult(tally, props.total),
		withAbsent: describeResult(withAbsent.tally, props.total),
		status: withAbsent.final || !withAbsent.deadline ? 'Definitivo' : `Provisional hasta el ${dayFormat.format(withAbsent.deadline)}`,
	};
}));

function print() {
	window.print();
}
</script>

<template>
	<form v-if="editable" class="card screen-only" @submit.prevent="save()">
		<h2>Firma del acta</h2>
		<p class="hint">
			{{ minutes
				? 'Puedes cambiar el texto y quién firma hasta que firmen los dos. Al guardar se quitan las firmas que ya tenga.'
				: 'Guarda el acta de arriba para que la firmen el presidente y el secretario. Podrás editarla hasta que firmen los dos.' }}
		</p>
		<div class="fields">
			<LnxSelect
				v-for="role in roles"
				:key="role"
				v-model.convert="form[role]"
				:options="signerOptions"
				:convert-fn="option => option.value"
				required
			>
				{{ signerRoles[role] }}
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ signerOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
			<LnxTextarea v-if="minutes" v-model="form.text" rows="16" maxlength="100000" class="wide" required :disabled="!!polishing">
				Texto del acta
			</LnxTextarea>
		</div>
		<p v-if="polishNote" class="hint" role="status">
			{{ polishNote }}
		</p>
		<footer class="form-actions">
			<template v-if="minutes && polishable">
				<WritingSource source="device" />
				<LnxButton v-if="unpolished !== undefined" mode="clear" :disabled="!!polishing" @click="undoPolish()">
					<LnxIcon icon="lucide:undo-2" />
					Deshacer
				</LnxButton>
				<LnxButton mode="outline" :is-loading="!!polishing" :disabled="!form.text.trim()" @click="improve()">
					<LnxIcon icon="lucide:spell-check" />
					{{ polishing ?? 'Mejorar redacción' }}
				</LnxButton>
			</template>
			<LnxButton type="submit" :disabled="!form.president || !form.secretary || !!polishing">
				<LnxIcon icon="lucide:file-pen-line" />
				{{ minutes ? 'Guardar acta' : 'Preparar acta para firmar' }}
			</LnxButton>
		</footer>
	</form>

	<section v-if="minutes" class="card">
		<header class="minutes-header screen-only">
			<h2>{{ minutes.closedAt ? 'Acta firmada' : 'Acta para firmar' }}</h2>
			<LnxButton class="lnx-size-small" @click="print()">
				<LnxIcon icon="lucide:printer" />
				Imprimir o guardar PDF
			</LnxButton>
		</header>

		<article class="minutes">
			<p class="text">
				{{ minutes.text }}
			</p>

			<div class="signatures">
				<figure v-for="role in roles" :key="role" class="signature">
					<SignaturePad v-if="minutes.signatures[role]" :model-value="minutes.signatures[role].path" readonly />
					<form v-else-if="signing === role" class="signing screen-only" @submit.prevent="sign()">
						<SignaturePad v-model="path" />
						<div class="form-actions">
							<LnxButton mode="clear" class="lnx-size-small" @click="signing = undefined">
								Cancelar
							</LnxButton>
							<LnxButton type="submit" class="lnx-size-small" :is-loading="busy" :disabled="!path">
								<LnxIcon icon="lucide:signature" />
								Firmar como {{ minutes[role].name }}
							</LnxButton>
						</div>
					</form>
					<div v-else class="unsigned">
						<LnxButton v-if="!isFullySigned(minutes)" class="screen-only lnx-size-small" mode="outline" :disabled="!!signing" @click="startSigning(role)">
							<LnxIcon icon="lucide:signature" />
							{{ minutes[role].uid === user?.id ? 'Firmar' : 'Firmar en persona' }}
						</LnxButton>
						<small v-if="minutes[role].uid !== user?.id" class="hint screen-only">O desde la app, donde verá «Firmar acta».</small>
					</div>
					<figcaption>
						<strong>{{ signerRoles[role] }}: {{ minutes[role].name }}</strong>
						<small v-if="minutes.signatures[role]">{{ describeSignature(minutes.signatures[role]) }}</small>
					</figcaption>
				</figure>
			</div>

			<footer v-if="minutes.hash" class="seal">
				<!-- eslint-disable-next-line vue/no-v-html -- uqr's SVG of the hash -->
				<div class="qr" v-html="qr" />
				<div class="fingerprint">
					<strong>Huella SHA-256: <span class="tabular">{{ minutes.hash.slice(0, 12) }}</span></strong>
					<code>{{ minutes.hash }}</code>
					<small>
						Cerrada el {{ minutes.closedAt ? dateFormat.format(minutes.closedAt.toDate()) : '' }}.
						<template v-if="verified">La huella coincide con el texto y las firmas.</template>
						<template v-else-if="verified === false">La huella no coincide con el contenido.</template>
					</small>
				</div>
			</footer>
			<p class="legal">
				Firma electrónica simple (art. 3 del Reglamento eIDAS): el trazo y la cuenta con la que se firma, fechados por el servidor.
				La huella sella el texto y las firmas: cualquier cambio la haría distinta.
			</p>
		</article>
	</section>

	<section v-if="absentCount" class="card">
		<h2>Acuerdos con los ausentes</h2>
		<p class="hint">
			Art. 17.8 LPH: los propietarios ausentes que, notificados, no manifiesten su discrepancia en 30 días naturales cuentan a favor; quienes discrepan, en contra.
		</p>
		<ol class="agreements">
			<li v-for="agreement in agreements" :key="agreement.item.id">
				<strong>{{ agreement.item.title }}</strong>
				<small>En la junta: {{ agreement.present }}</small>
				<small>
					Con los {{ absentCount }} ausentes: {{ agreement.withAbsent }}
					<span class="chip">{{ agreement.status }}</span>
				</small>
			</li>
		</ol>
	</section>
</template>

<style lang="scss" scoped>
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
	grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
	align-items: end;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
}

.form-actions,
.minutes-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
}

.form-actions {
	justify-content: flex-end;
}

.minutes-header h2 {
	flex: 1;
}

.minutes {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
	line-height: 1.5;

	.text {
		white-space: pre-line;
	}
}

.signatures {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
	gap: var(--lnx-spacing-5);
	break-inside: avoid;
}

.signature {
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	figcaption {
		padding-top: var(--lnx-spacing-1);
		border-top: 1px solid var(--color-gray-4);
		display: flex;
		flex-direction: column;

		small {
			color: var(--color-gray-6);
		}
	}
}

.signing,
.unsigned {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
}

.seal {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-4);
	break-inside: avoid;

	.qr {
		width: 112px;
		flex-shrink: 0;

		:deep(svg) {
			width: 100%;
			height: auto;
			display: block;
		}
	}
}

.fingerprint {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);

	code {
		font-size: var(--lnx-font-size-small);
		overflow-wrap: anywhere;
	}

	small {
		color: var(--color-gray-6);
	}
}

.legal,
.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.agreements {
	padding-left: var(--lnx-spacing-5);
	list-style: decimal;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	li {
		display: flex;
		flex-direction: column;
	}

	small {
		color: var(--color-gray-7);
	}
}

.chip {
	margin-left: var(--lnx-spacing-1);
	padding: 0 var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	white-space: nowrap;
}

@media print {
	.screen-only {
		display: none !important;
	}

	.card {
		border: 0;
		padding: 0;
		box-shadow: none;
	}
}
</style>
