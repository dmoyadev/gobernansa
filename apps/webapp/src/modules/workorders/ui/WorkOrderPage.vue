<script setup lang="ts">
import type { WorkOrderStatus } from '@gobernansa/shared/domain/workOrder.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { getPhoneLink, getWhatsappLink } from '@gobernansa/shared/domain/community.ts';
import { issuesCategories } from '@gobernansa/shared/domain/issue.ts';
import { WORK_ORDER_LIMITS, workOrderStatus } from '@gobernansa/shared/domain/workOrder.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { computed, onUnmounted, ref } from 'vue';
import { canUploadMedia, uploadMedia } from '@/shared/infrastructure/cloudinary.ts';
import { useWorkOrder } from '../application/useWorkOrder.ts';

const props = defineProps<{ token: string }>();

const { workOrder, report } = useWorkOrder(props.token);
const { pending: loading, error } = workOrder;

const VIDEO_REGEX = /\/video\//;
const dayFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full' });
const visitFormat = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' });
const stepFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

const category = computed(() => issuesCategories.find(option => option.value === workOrder.value?.issue.category));
const history = computed(() => [...workOrder.value?.history ?? []].reverse());
const mapsLink = computed(() => {
	const place = [workOrder.value?.community.address, workOrder.value?.community.name].filter(Boolean).join(', ');
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
});

const sending = ref<WorkOrderStatus>();
const failed = ref(false);
// From 0 to 1 while the photos upload
const progress = ref<number>();

// The form of the step being answered: rejecting asks why, scheduling when, and finishing what was done
const form = ref<Exclude<WorkOrderStatus, 'sent' | 'accepted'>>();
const note = ref('');
const date = ref('');
const time = ref('09:00');
const today = toDateString(new Date());

function open(step: typeof form.value) {
	form.value = step;
	note.value = '';
	failed.value = false;
	const visit = workOrder.value?.scheduledAt?.toDate();
	if (step === 'scheduled' && visit) {
		date.value = toDateString(visit);
		time.value = visit.toTimeString().slice(0, 5);
	}
}

// Previewed from the device until they're uploaded on sending
const photos = ref<{ file: File; preview: string }[]>([]);

function addPhotos(event: Event) {
	const input = event.target as HTMLInputElement;
	const files = [...(input.files ?? [])].slice(0, WORK_ORDER_LIMITS.photos - photos.value.length);
	input.value = '';
	photos.value.push(...files.map(file => ({ file, preview: URL.createObjectURL(file) })));
}

function removePhoto(index: number) {
	const [removed] = photos.value.splice(index, 1);
	URL.revokeObjectURL(removed!.preview);
}

onUnmounted(() => photos.value.forEach(photo => URL.revokeObjectURL(photo.preview)));

async function send(status: WorkOrderStatus) {
	sending.value = status;
	failed.value = false;
	try {
		const urls: string[] = [];
		for (const [index, photo] of photos.value.entries()) {
			urls.push(await uploadMedia(photo.file, 'gobernança/workorders', (fraction) => {
				progress.value = (index + fraction) / photos.value.length;
			}));
		}
		progress.value = undefined;
		const text = note.value.trim();
		await report({
			status,
			...(text ? { note: text } : {}),
			...(status === 'scheduled' ? { scheduledAt: Timestamp.fromDate(new Date(`${date.value}T${time.value}`)) } : {}),
		}, urls);
		form.value = undefined;
		photos.value.forEach(photo => URL.revokeObjectURL(photo.preview));
		photos.value = [];
	} catch (e) {
		reportError(e, { action: 'Responder a la orden de trabajo' });
		failed.value = true;
	} finally {
		sending.value = undefined;
		progress.value = undefined;
	}
}
</script>

<template>
	<main class="work-order">
		<p class="brand">
			<img src="@gobernansa/shared/assets/logo.svg" alt="gobernança" width="96" height="32">
			<span>Parte de trabajo</span>
		</p>

		<section v-if="loading" class="panel" aria-busy="true" aria-label="Cargando">
			<span class="skeleton-item skeleton-item--title" style="width: 70%" />
			<span v-for="width in [90, 75, 60]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
		</section>

		<section v-else-if="!workOrder" class="panel empty">
			<LnxIcon icon="lucide:link-2-off" :size="32" />
			<template v-if="error">
				<h1>No se ha podido cargar</h1>
				<p>Revisa la conexión y vuelve a abrir el enlace.</p>
			</template>
			<template v-else>
				<h1>Este enlace no es válido</h1>
				<p>Puede que esté incompleto. Pide a la administración que te lo vuelva a enviar.</p>
			</template>
		</section>

		<template v-else>
			<header>
				<small>{{ workOrder.community.name }}</small>
				<h1>{{ workOrder.issue.title }}</h1>
				<span v-if="!workOrder.revokedAt" class="status" :style="{ '--status-color': workOrderStatus[workOrder.status].color }">
					<LnxIcon :icon="workOrderStatus[workOrder.status].icon" :size="14" />
					{{ workOrderStatus[workOrder.status].label }}
				</span>
			</header>

			<section v-if="workOrder.revokedAt" class="panel notice" role="status">
				<LnxIcon icon="lucide:ban" :size="24" />
				<div>
					<strong>Este parte se ha anulado</strong>
					<p>La administración lo ha retirado o se lo ha encargado a otra persona. Si tienes dudas, contacta con ella.</p>
				</div>
			</section>

			<section v-else class="panel answer">
				<template v-if="workOrder.status === 'done'">
					<p class="final">
						<LnxIcon icon="lucide:circle-check" :size="24" />
						Trabajo terminado. Gracias, la administración ya lo sabe.
					</p>
				</template>
				<template v-else-if="workOrder.status === 'rejected'">
					<p class="final">
						<LnxIcon icon="lucide:circle-x" :size="24" />
						Has rechazado este trabajo. La administración ya lo sabe.
					</p>
				</template>
				<template v-else-if="!form">
					<p v-if="workOrder.status === 'scheduled' && workOrder.scheduledAt" class="visit">
						<LnxIcon icon="lucide:calendar-clock" :size="20" />
						<span>Visita: <strong>{{ visitFormat.format(workOrder.scheduledAt.toDate()) }}</strong></span>
					</p>
					<p v-else-if="workOrder.status === 'sent'">
						¿Te encargas de este trabajo?
					</p>
					<div class="actions">
						<template v-if="workOrder.status === 'sent'">
							<LnxButton size="large" is-block :is-loading="sending === 'accepted'" :disabled="!!sending" @click="send('accepted')">
								<LnxIcon icon="lucide:thumbs-up" />
								Aceptar
							</LnxButton>
							<LnxButton mode="outline" size="large" is-block :disabled="!!sending" @click="open('scheduled')">
								<LnxIcon icon="lucide:calendar-plus" />
								Aceptar y programar visita
							</LnxButton>
						</template>
						<template v-else>
							<LnxButton size="large" is-block :disabled="!!sending" @click="open('done')">
								<LnxIcon icon="lucide:circle-check" />
								Trabajo terminado
							</LnxButton>
							<!-- Leaves room in the history for finishing or rejecting -->
							<LnxButton
								v-if="workOrder.history.length < WORK_ORDER_LIMITS.steps - 1"
								mode="outline"
								size="large"
								is-block
								:disabled="!!sending"
								@click="open('scheduled')"
							>
								<LnxIcon icon="lucide:calendar-plus" />
								{{ workOrder.status === 'scheduled' ? 'Cambiar la visita' : 'Programar visita' }}
							</LnxButton>
						</template>
						<LnxButton mode="clear" variant="danger" :disabled="!!sending" @click="open('rejected')">
							<LnxIcon icon="lucide:circle-x" />
							{{ workOrder.status === 'sent' ? 'Rechazar' : 'No puedo hacerlo' }}
						</LnxButton>
					</div>
					<p v-if="failed" class="error" role="alert">
						No se ha podido enviar. Revisa la conexión e inténtalo de nuevo.
					</p>
				</template>

				<form v-else class="step-form" @submit.prevent="send(form!)">
					<h2>{{ form === 'rejected' ? 'Rechazar el trabajo' : form === 'scheduled' ? 'Programar visita' : 'Trabajo terminado' }}</h2>
					<template v-if="form === 'scheduled'">
						<DatePicker v-model="date" :min="today" required>
							Día
						</DatePicker>
						<LnxInput v-model="time" type="time" required>
							Hora
						</LnxInput>
					</template>
					<LnxTextarea
						v-model="note"
						rows="3"
						:maxlength="WORK_ORDER_LIMITS.note"
						:required="form === 'rejected'"
						:placeholder="form === 'rejected' ? 'No trabajamos esa zona, no tengo fecha hasta dentro de un mes…' : form === 'scheduled' ? 'Necesito acceso al cuarto de contadores…' : 'Qué se ha hecho, piezas cambiadas, si hay que volver…'"
					>
						{{ form === 'rejected' ? 'Motivo' : 'Nota para la administración (opcional)' }}
					</LnxTextarea>

					<div v-if="form === 'done' && canUploadMedia" class="photos">
						<span id="photos-label">Fotos del trabajo (opcional)</span>
						<ul class="media-grid" aria-labelledby="photos-label">
							<li v-for="(photo, index) in photos" :key="photo.preview">
								<img :src="photo.preview" :alt="photo.file.name">
								<button type="button" class="remove" :aria-label="`Quitar ${photo.file.name}`" :disabled="!!sending" @click="removePhoto(index)">
									<LnxIcon icon="lucide:x" :size="14" />
								</button>
							</li>
							<li v-if="photos.length < WORK_ORDER_LIMITS.photos">
								<label class="add-photo" :class="{ disabled: sending }">
									<input class="sr-only" type="file" accept="image/*" multiple :disabled="!!sending" @change="addPhotos">
									<LnxIcon icon="lucide:camera" :size="24" />
									Añadir
								</label>
							</li>
						</ul>
					</div>

					<p v-if="failed" class="error" role="alert">
						No se ha podido enviar. Revisa la conexión e inténtalo de nuevo.
					</p>
					<footer>
						<LnxButton mode="clear" :disabled="!!sending" @click="form = undefined">
							Cancelar
						</LnxButton>
						<LnxButton type="submit" :variant="form === 'rejected' ? 'danger' : 'primary'" :is-loading="!!sending" :disabled="!!sending || (form === 'scheduled' && !date)">
							<template v-if="progress !== undefined">
								Subiendo… {{ Math.round(progress * 100) }}%
							</template>
							<template v-else>
								{{ form === 'rejected' ? 'Rechazar' : form === 'scheduled' ? 'Confirmar visita' : 'Enviar' }}
							</template>
						</LnxButton>
					</footer>
				</form>
			</section>

			<section v-if="!workOrder.revokedAt" class="panel">
				<h2>
					<LnxIcon :icon="category?.icon ?? 'lucide:wrench'" :size="16" />
					{{ category?.label ?? 'Trabajo' }}
				</h2>
				<p class="description" :class="{ hint: !workOrder.issue.description }">
					{{ workOrder.issue.description || 'Sin descripción' }}
				</p>
				<dl class="details">
					<div v-if="workOrder.issue.location">
						<dt><LnxIcon icon="lucide:map-pin" :size="16" /> Dónde</dt>
						<dd>{{ workOrder.issue.location }}</dd>
					</div>
					<div v-if="workOrder.expectedAt">
						<dt><LnxIcon icon="lucide:calendar" :size="16" /> Fecha prevista</dt>
						<dd>{{ dayFormat.format(workOrder.expectedAt.toDate()) }}</dd>
					</div>
				</dl>
				<ul v-if="workOrder.issue.assets.length" class="media-grid">
					<li v-for="asset in workOrder.issue.assets" :key="asset">
						<a :href="asset" target="_blank" rel="noopener">
							<video v-if="VIDEO_REGEX.test(asset)" :src="`${asset}#t=0.1`" muted playsinline preload="metadata" />
							<img v-else :src="asset" alt="Foto de la incidencia" loading="lazy">
						</a>
					</li>
				</ul>
			</section>

			<section v-if="!workOrder.revokedAt" class="panel">
				<h2><LnxIcon icon="lucide:building-2" :size="16" /> Dirección</h2>
				<p>
					<strong>{{ workOrder.community.name }}</strong><br>
					{{ workOrder.community.address }}
				</p>
				<LnxButton :href="mapsLink" target="_blank" rel="noopener" mode="outline">
					<LnxIcon icon="lucide:map" />
					Abrir en el mapa
				</LnxButton>
			</section>

			<section class="panel">
				<h2><LnxIcon icon="lucide:briefcase" :size="16" /> Administración</h2>
				<p><strong>{{ workOrder.contact.name }}</strong></p>
				<div class="contact">
					<LnxButton v-if="workOrder.contact.phone" :href="getPhoneLink(workOrder.contact.phone)" mode="outline">
						<LnxIcon icon="lucide:phone" />
						Llamar
					</LnxButton>
					<LnxButton v-if="workOrder.contact.whatsapp" :href="getWhatsappLink(workOrder.contact.whatsapp)" target="_blank" rel="noopener" mode="outline">
						<LnxIcon icon="lucide:message-circle" />
						WhatsApp
					</LnxButton>
					<LnxButton v-if="workOrder.contact.email" :href="`mailto:${workOrder.contact.email}?subject=${encodeURIComponent(workOrder.issue.title)}`" mode="outline">
						<LnxIcon icon="lucide:mail" />
						Email
					</LnxButton>
				</div>
			</section>

			<section v-if="history.length && !workOrder.revokedAt" class="panel">
				<h2><LnxIcon icon="lucide:history" :size="16" /> Historial</h2>
				<ol class="history">
					<li v-for="step in history" :key="step.at.toMillis()" :style="{ '--status-color': workOrderStatus[step.status].color }">
						<LnxIcon :icon="workOrderStatus[step.status].icon" :size="16" />
						<div>
							<strong>{{ workOrderStatus[step.status].label }}</strong>
							<small>{{ stepFormat.format(step.at.toDate()) }}</small>
							<p v-if="step.scheduledAt">
								Visita: {{ visitFormat.format(step.scheduledAt.toDate()) }}
							</p>
							<p v-if="step.note">
								{{ step.note }}
							</p>
						</div>
					</li>
				</ol>
				<ul v-if="workOrder.photos?.length" class="media-grid">
					<li v-for="photo in workOrder.photos" :key="photo">
						<a :href="photo" target="_blank" rel="noopener"><img :src="photo" alt="Foto del trabajo" loading="lazy"></a>
					</li>
				</ul>
			</section>
		</template>
	</main>
</template>

<style lang="scss" scoped>
.work-order {
	max-width: 560px;
	min-height: 100svh;
	margin: 0 auto;
	padding: var(--lnx-spacing-4) var(--lnx-spacing-4) var(--lnx-spacing-7);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
}

.brand {
	display: flex;
	align-items: center;
	justify-content: space-between;
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
}

header {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-1);

	small {
		color: var(--color-gray-6);
		font-size: .75rem;
		font-weight: var(--lnx-font-weight-bold);
		letter-spacing: .04em;
		text-transform: uppercase;
	}

	h1 {
		color: var(--color-gray-9);
		line-height: 1.2;
		text-wrap: balance;
	}
}

.status {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-5);
	background: color-mix(in srgb, var(--status-color) 14%, var(--color-gray-0));
	color: var(--status-color);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
}

.panel {
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

h2 {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	letter-spacing: .04em;
	text-transform: uppercase;
}

.empty {
	align-items: center;
	text-align: center;
	color: var(--color-gray-7);
}

.notice {
	flex-direction: row;
	align-items: flex-start;
	background: #fef2f2;
	color: #b91c1c;

	p {
		color: var(--color-gray-8);
	}
}

.final,
.visit {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-weight: var(--lnx-font-weight-bold);
}

.final {
	color: var(--color-gray-8);
}

.actions {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.step-form {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--lnx-spacing-2);
	}
}

.description {
	line-height: 1.5;
	white-space: pre-line;
}

.details {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	dt {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	dd {
		padding-left: calc(16px + var(--lnx-spacing-2));

		&::first-letter {
			text-transform: uppercase;
		}
	}
}

.contact {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}

.photos {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: var(--lnx-font-size-small);
}

.media-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: var(--lnx-spacing-2);

	li {
		position: relative;
		aspect-ratio: 1;
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-2);
	}

	a {
		display: block;
		height: 100%;
		border-radius: inherit;
	}

	img,
	video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: inherit;
	}

	.remove {
		position: absolute;
		top: var(--lnx-spacing-1);
		right: var(--lnx-spacing-1);
		display: flex;
		padding: 4px;
		border-radius: var(--lnx-radius-circle);
		background: #00000099;
		color: var(--color-gray-0);
		cursor: pointer;
	}
}

.add-photo {
	height: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--lnx-spacing-1);
	border: 1px dashed var(--color-gray-5);
	border-radius: inherit;
	color: var(--color-gray-7);
	font-weight: var(--lnx-font-weight-bold);
	cursor: pointer;

	&.disabled {
		opacity: .5;
		cursor: not-allowed;
	}

	&:has(:focus-visible) {
		outline: 2px solid var(--color-primary-light);
		outline-offset: 2px;
	}
}

.history {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	li {
		display: flex;
		gap: var(--lnx-spacing-2);
		color: var(--status-color);
	}

	div {
		display: flex;
		flex-direction: column;
		min-width: 0;
		color: var(--color-gray-9);
	}

	small {
		color: var(--color-gray-6);
		font-variant-numeric: tabular-nums;
	}

	p {
		white-space: pre-line;
	}
}

.hint {
	color: var(--color-gray-6);
}

.error {
	color: var(--lnx-color-danger);
	font-size: var(--lnx-font-size-small);
}
</style>
