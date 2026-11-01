<script setup lang="ts">
import type { Issue, IssueComment } from '@gobernansa/shared/domain/issue.ts';
import type { Provider } from '@gobernansa/shared/domain/provider.ts';
import type { WorkOrder } from '@gobernansa/shared/domain/workOrder.ts';
import type { useIssue } from '../application/useIssues.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { getWhatsappLink } from '@gobernansa/shared/domain/community.ts';
import { isEmail } from '@gobernansa/shared/domain/mail.ts';
import { workOrderStatus } from '@gobernansa/shared/domain/workOrder.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { optimistic, toast } from '@/app/ux/toast.ts';
import { mailOutcome } from '@/modules/mail/application/mail.ts';
import MailModeNote from '@/modules/mail/ui/MailModeNote.vue';
import { workOrderUrl } from '../application/useIssues.ts';

// The parte de trabajo sent to the issue's provider, with their answers as they come
const props = defineProps<{
	issue: Issue;
	// Undefined while it loads, null when there's none
	workOrder?: WorkOrder | null;
	comments: IssueComment[];
	// From the directory, for their phone
	provider?: Provider;
	// The provider's mailto, already with the link
	mail?: string;
	actions: Pick<ReturnType<typeof useIssue>, 'createWorkOrder' | 'updateWorkOrderDate' | 'revokeWorkOrder' | 'reply'>;
}>();
const emit = defineEmits<{ resolve: [] }>();

const { user: me } = useAuth();

const stepFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });

const url = computed(() => props.workOrder && workOrderUrl(props.workOrder.id));
const steps = computed(() => [...props.workOrder?.history ?? []].reverse());
const visit = computed(() => props.workOrder?.status === 'scheduled' ? props.workOrder.scheduledAt?.toDate() : undefined);
const whatsapp = computed(() => props.provider?.phone && props.workOrder
	? `${getWhatsappLink(props.provider.phone)}?text=${encodeURIComponent(`Hola, ${props.provider.name}. Te enviamos un trabajo en ${props.workOrder.community.name}: «${props.workOrder.issue.title}». En este enlace tienes los detalles, y puedes aceptarlo, programar la visita y avisarnos al terminar: ${url.value}`)}`
	: undefined);

const creating = ref(false);

// Also for a new link, which revokes the current one in the same write
async function create() {
	// eslint-disable-next-line no-alert
	if (props.workOrder && !window.confirm('¿Crear un enlace nuevo? El actual dejará de funcionar.')) {
		return;
	}
	creating.value = true;
	const email = props.provider?.email;
	await optimistic(props.actions.createWorkOrder(me.value!, email), { done: isEmail(email) ? `Parte creado; ${mailOutcome(email)}` : 'Parte de trabajo creado', failed: 'No se ha podido crear el parte' });
	creating.value = false;
}

function revoke() {
	// eslint-disable-next-line no-alert
	if (window.confirm(`¿Anular el parte? ${props.workOrder!.provider.name} ya no podrá abrir el enlace.`)) {
		void optimistic(props.actions.revokeWorkOrder(me.value!), { done: 'Parte anulado', failed: 'No se ha podido anular el parte' });
	}
}

async function copy() {
	await navigator.clipboard.writeText(url.value!);
	toast('Enlace copiado');
}

// The issue's expected date changed after the link was made, while the provider can still act on it
const dateChanged = computed(() => !!props.workOrder && ['sent', 'accepted', 'scheduled'].includes(props.workOrder.status)
	&& (props.issue.expectedAt?.toMillis() ?? null) !== (props.workOrder.expectedAt?.toMillis() ?? null));

function updateDate() {
	void optimistic(props.actions.updateWorkOrderDate(), { done: 'Fecha del parte actualizada', failed: 'No se ha podido actualizar el parte' });
}

// Once per visit date, it's a comment neighbours see: one already among the issue's isn't offered again
const visitMessage = computed(() => visit.value && `Visita programada: ${props.workOrder!.provider.name} vendrá el ${dayFormat.format(visit.value)} a las ${timeFormat.format(visit.value)}.`);
const posted = ref<string>();
const notified = computed(() => !!visitMessage.value && (posted.value === visitMessage.value || props.comments.some(comment => comment.message === visitMessage.value)));

function notify() {
	const message = visitMessage.value!;
	posted.value = message;
	void optimistic(props.actions.reply(me.value!, message), {
		done: 'Vecinos avisados',
		failed: 'No se ha podido avisar',
		onError: () => posted.value = undefined,
	});
}
</script>

<template>
	<div v-if="workOrder === undefined" class="empty" aria-busy="true">
		<span class="skeleton-item" style="width: 60%" />
		<span class="skeleton-item skeleton-item--small" style="width: 40%" />
	</div>

	<div v-else-if="!workOrder" class="empty">
		<p class="hint">
			Envía a {{ issue.provider?.name }} un enlace para ver el trabajo, programar la visita y avisar al terminar, sin crear una cuenta.
			<template v-if="isEmail(provider?.email)">
				Le llega también por email, a {{ provider?.email }}.
			</template>
		</p>
		<MailModeNote v-if="isEmail(provider?.email)" />
		<LnxButton mode="outline" :is-loading="creating" :disabled="creating" @click="create()">
			<LnxIcon icon="lucide:link" />
			Crear enlace
		</LnxButton>
	</div>

	<template v-else>
		<p class="state">
			<span class="chip" :style="{ '--step-color': workOrderStatus[workOrder.status].color }">
				<LnxIcon :icon="workOrderStatus[workOrder.status].icon" :size="14" />
				{{ workOrderStatus[workOrder.status].label }}
			</span>
			<small v-if="visit">{{ dayFormat.format(visit) }}, {{ timeFormat.format(visit) }}</small>
		</p>

		<div class="share">
			<LnxButton mode="outline" size="small" @click="copy()">
				<LnxIcon icon="lucide:copy" />
				Copiar enlace
			</LnxButton>
			<LnxButton v-if="whatsapp" :href="whatsapp" target="_blank" rel="noopener" mode="outline" size="small">
				<LnxIcon icon="lucide:message-circle" />
				WhatsApp
			</LnxButton>
			<LnxButton v-if="mail" :href="mail" mode="outline" size="small">
				<LnxIcon icon="lucide:mail" />
				Email
			</LnxButton>
		</div>

		<ol v-if="steps.length" class="steps">
			<li v-for="step in steps" :key="step.at.toMillis()" :style="{ '--step-color': workOrderStatus[step.status].color }">
				<LnxIcon :icon="workOrderStatus[step.status].icon" :size="14" />
				<div>
					<strong>{{ workOrderStatus[step.status].label }}</strong>
					<small>{{ stepFormat.format(step.at.toDate()) }}</small>
					<p v-if="step.scheduledAt">
						Visita: {{ stepFormat.format(step.scheduledAt.toDate()) }}
					</p>
					<p v-if="step.note">
						{{ step.note }}
					</p>
				</div>
			</li>
		</ol>
		<p v-else class="hint">
			Aún no ha contestado. Lo verás aquí en cuanto lo haga.
		</p>

		<ul v-if="workOrder.photos?.length" class="photos">
			<li v-for="photo in workOrder.photos" :key="photo">
				<a :href="photo" target="_blank" rel="noopener" class="ux-lift"><img :src="photo" alt="Foto del trabajo" loading="lazy"></a>
			</li>
		</ul>

		<LnxButton v-if="workOrder.status === 'done' && (issue.status === 'open' || issue.status === 'in_progress')" @click="emit('resolve')">
			<LnxIcon icon="lucide:circle-check" />
			Marcar como resuelta
		</LnxButton>
		<LnxButton v-if="visit && !notified" mode="outline" @click="notify()">
			<LnxIcon icon="lucide:megaphone" />
			Avisar a los vecinos
		</LnxButton>
		<template v-if="dateChanged">
			<p class="hint">
				La fecha prevista de la incidencia ha cambiado desde que se creó el enlace.
			</p>
			<LnxButton mode="outline" @click="updateDate()">
				<LnxIcon icon="lucide:calendar-check" />
				Actualizar la fecha en el parte
			</LnxButton>
		</template>
		<p v-if="workOrder.status === 'rejected'" class="hint">
			Cambia el proveedor o crea un enlace nuevo.
		</p>

		<footer>
			<LnxButton mode="clear" size="small" :disabled="creating" @click="create()">
				<LnxIcon icon="lucide:refresh-cw" />
				Nuevo enlace
			</LnxButton>
			<LnxButton mode="clear" size="small" variant="danger" @click="revoke()">
				<LnxIcon icon="lucide:link-2-off" />
				Anular
			</LnxButton>
		</footer>
	</template>
</template>

<style lang="scss" scoped>
.empty {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
}

.state {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);

	small {
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		font-variant-numeric: tabular-nums;

		&::first-letter {
			text-transform: uppercase;
		}
	}
}

.chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-5);
	background: color-mix(in srgb, var(--step-color) 14%, var(--color-gray-0));
	color: var(--step-color);
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
}

.share,
footer {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}

footer {
	justify-content: flex-end;
}

.steps {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);

	li {
		display: flex;
		gap: var(--lnx-spacing-2);
		color: var(--step-color);
	}

	div {
		display: flex;
		flex-direction: column;
		min-width: 0;
		color: var(--color-gray-8);
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-legal);
		font-variant-numeric: tabular-nums;
	}

	p {
		white-space: pre-line;
	}
}

.photos {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);

	a {
		display: block;
		overflow: hidden;
		border-radius: var(--lnx-radius-2);
	}

	img {
		display: block;
		width: 64px;
		height: 64px;
		object-fit: cover;
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}
</style>
