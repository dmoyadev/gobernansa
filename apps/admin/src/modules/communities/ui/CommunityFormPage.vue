<script setup lang="ts">
import type { Community, CommunityContact, CommunityDocument, ContactType } from '@gobernansa/shared/domain/community.ts';
import type { CommunityForm, CommunitySection } from '../domain/communityForm.ts';
import { contactTypes, documentTypes, WEEKDAYS } from '@gobernansa/shared/domain/community.ts';
import { DEFAULT_MONTHLY_VOTES } from '@gobernansa/shared/domain/issue.ts';
import DatePicker from '@gobernansa/shared/ui/DatePicker.vue';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { workspaces } from '@/app/workspace/workspaces.ts';
import { duplicateCommunity } from '../application/duplicateCommunity.ts';
import { loadCommunity, saveCommunity } from '../application/useCommunities.ts';
import { findFormError, toCommunityForm, toInputDate } from '../domain/communityForm.ts';

// Without an id, a new community is created from its general info and settings, prefilled from another one with ?from=<id>
const props = withDefaults(defineProps<{ id?: string; section?: CommunitySection }>(), { section: 'info' });
const route = useRoute();
// Read again each time the page comes back, as the kept page is reused for any ?from=
const queryFrom = () => props.id ? undefined : route.query.from as string | undefined;
const fromId = ref(queryFrom());
// A new one's: an existing one has the nav of its workspace instead
const backTo = computed(() => fromId.value ? `/communities/${fromId.value}` : '/');
const backLabel = computed(() => fromId.value ? 'Volver a la comunidad' : 'Volver a comunidades');

const contactTypeOptions = Object.entries(contactTypes).map(([value, { label }]) => ({ value: value as ContactType, label }));
const documentTypeOptions = Object.entries(documentTypes).map(([value, { label }]) => ({ value: value as CommunityDocument['type'], label }));
const currentYear = new Date().getFullYear();

const router = useRouter();
const formElement = useTemplateRef<HTMLFormElement>('formElement');
const form = ref<CommunityForm>(toCommunityForm());
const loading = ref(!!(props.id || fromId.value));
// The community being duplicated, kept so duplicating doesn't read it again
const source = ref<Community>();
const notFound = ref(false);
// Without the community, saving the empty form would replace its contacts and documents
const loadError = ref<string>();
const saving = ref(false);
const error = ref<string>();
// The new community's id, made when its form opens so sending it twice creates it once
let createId = newId();
// The form as loaded, to tell whether the admin has changed it
let pristine = '';
const isPristine = () => JSON.stringify(form.value) === pristine;

// Leaving it, or moving to another section from the nav, would lose what was typed
// eslint-disable-next-line no-alert
const confirmLeave = () => saving.value || isPristine() || window.confirm('¿Descartar los cambios sin guardar?');
onBeforeRouteLeave(confirmLeave);
onBeforeRouteUpdate(confirmLeave);

function setForm(next: CommunityForm) {
	form.value = next;
	pristine = JSON.stringify(next);
}

// A copy of the source: the address, fiscal data and documents belong to the building, they're left for the admin to fill in
function prefill(community: Community) {
	return { ...toCommunityForm(community), name: `${community.name} (copia)`, address: '', cif: '', iban: '', bank: '', bic: '', sepaSuffix: '', documents: [] };
}

// `replace` loads it whatever is in the form; otherwise only while the admin hasn't changed it, nor does meanwhile
async function load(replace: boolean) {
	const id = props.id || fromId.value;
	if (!id) {
		setForm(toCommunityForm());
		return;
	}

	const before = pristine;
	try {
		const community = await loadCommunity(id);
		if (!replace && JSON.stringify(form.value) !== before) {
			return;
		}
		notFound.value = !community;
		source.value = fromId.value ? community : undefined;
		setForm(fromId.value && community ? prefill(community) : toCommunityForm(community));
		loadError.value = undefined;
	} catch (e) {
		// A failed reread keeps the form
		if (replace) {
			loadError.value = (e as Error).message;
		}
	} finally {
		loading.value = false;
	}
}

onMounted(() => load(true));
onRevalidate(() => {
	const from = queryFrom();
	if (from !== fromId.value) {
		fromId.value = from;
		createId = newId();
		error.value = undefined;
		loadError.value = undefined;
		notFound.value = false;
		loading.value = !!from;
		void load(true);
	} else if (isPristine()) {
		void load(false);
	}
});

function addContact() {
	form.value.contacts.push({ type: 'other', name: '' });
}

function addSchedule(contact: CommunityContact) {
	(contact.schedule ??= []).push({ days: [1, 2, 3, 4, 5], from: '09:00', to: '14:00' });
}

function addDocument() {
	form.value.documents.push({ type: 'minutes', title: '', url: '', date: toInputDate(new Date()) });
}

async function save() {
	error.value = findFormError(form.value, pristine ? JSON.parse(pristine) as CommunityForm : undefined);
	if (error.value || saving.value) {
		return;
	}

	const id = props.id ?? createId;
	// Duplicating reads the source's obligations and providers first, so it waits for it
	if (fromId.value) {
		saving.value = true;
		try {
			await duplicateCommunity(fromId.value, id, form.value, source.value);
			// Coming back to duplicate it again starts from a fresh copy
			createId = newId();
			setForm(prefill(source.value!));
			void router.push(`/communities/${id}`);
		} catch (e) {
			// The form keeps what was typed, so it can be saved again
			error.value = `No se ha podido guardar: ${(e as Error).message}`;
		} finally {
			saving.value = false;
		}
		return;
	}

	// The rest doesn't wait: the community is in the local cache at once, and the form is left clean for next time
	const typed = JSON.parse(JSON.stringify(form.value)) as CommunityForm;
	const previous = pristine;
	const formPath = route.fullPath;
	const action = saveCommunity(id, form.value, !props.id);
	if (props.id) {
		pristine = JSON.stringify(form.value);
	} else {
		createId = newId();
		setForm(toCommunityForm());
	}
	// An existing one stays on its section, as the other pages of a workspace
	if (!props.id) {
		void router.push(`/communities/${id}`);
	}
	void optimistic(action, {
		done: props.id ? 'Guardado' : 'Comunidad creada',
		failed: 'No se ha podido guardar',
		// Back to the form with what was typed, to send it again
		onError: (e) => {
			form.value = typed;
			pristine = previous;
			if (!props.id) {
				createId = id;
			}
			error.value = `No se ha podido guardar: ${e.message}`;
			void router.push(formPath);
		},
	});
}

useShortcut('mod+enter', () => formElement.value?.requestSubmit(), props.id ? 'Guardar cambios' : 'Crear comunidad');
</script>

<template>
	<form ref="formElement" @submit.prevent="save()">
		<header class="page-header">
			<!-- An existing one's has the nav of its workspace instead -->
			<BackButton v-if="!id" :to="backTo" :label="backLabel" />
			<h1>{{ id ? workspaces.community.sectionOf.get(section)!.pages[0].title : 'Nueva comunidad' }}</h1>
		</header>

		<!-- Shaped like the first card: its title and fields -->
		<section v-if="loading" class="card" aria-busy="true">
			<span class="skeleton-item skeleton-item--small" style="width: 22%" />
			<div class="fields">
				<span v-for="width in [92, 88, 46]" :key="width" class="skeleton-field">
					<span class="skeleton-item skeleton-item--small" :style="{ width: `${width / 3}%` }" />
					<span class="skeleton-item skeleton-item--big-square" :style="{ width: `${width}%` }" />
				</span>
			</div>
		</section>

		<section v-else-if="notFound || loadError" class="card">
			<p v-if="loadError" class="error" role="alert">
				No se ha podido cargar la comunidad: {{ loadError }}
			</p>
			<p v-else>
				Esta comunidad no existe o se ha borrado.
			</p>
			<LnxButton to="/" mode="outline">
				Volver a comunidades
			</LnxButton>
		</section>

		<template v-else>
			<p v-if="source" class="hint duplicate ux-appear">
				<LnxIcon icon="lucide:copy" aria-hidden="true" />
				Se copiarán las zonas comunes, contactos, zonas reservables, obligaciones y proveedores de «{{ source.name }}».
			</p>

			<section v-if="section === 'info' || !id" class="card">
				<!-- An existing one's sections are named by the page's title -->
				<h2 v-if="!id">
					Datos generales
				</h2>
				<div class="fields">
					<LnxInput v-model="form.name" class="wide" required>
						Nombre
					</LnxInput>
					<LnxInput v-model="form.address" class="wide" required>
						Dirección
					</LnxInput>
					<LnxInput v-model="form.constructionYear" type="number" min="1800" :max="currentYear" required>
						Año de construcción
					</LnxInput>
				</div>
				<p class="hint">
					Los datos fiscales los ven y copian los vecinos en la tarjeta de su comunidad, para pagar cuotas o facturar.
				</p>
				<div class="fields">
					<LnxInput v-model="form.cif">
						CIF
					</LnxInput>
					<LnxInput v-model="form.bank">
						Banco
					</LnxInput>
					<LnxInput v-model="form.iban" class="wide" placeholder="ES00 0000 0000 0000 0000 0000">
						IBAN
					</LnxInput>
					<LnxInput v-model="form.bic" placeholder="CAIXESBBXXX">
						BIC
						<template #helper>
							Opcional, para las remesas
						</template>
					</LnxInput>
					<LnxInput v-model="form.sepaSuffix" maxlength="3" placeholder="000">
						Sufijo de acreedor SEPA
						<template #helper>
							El que dé el banco, si no 000
						</template>
					</LnxInput>
				</div>
			</section>

			<section v-if="section === 'settings' || !id" class="card">
				<h2 v-if="!id">
					Configuración de la comunidad
				</h2>
				<p class="hint">
					Ajustes propios de esta comunidad, que cambian cómo funciona la app para sus vecinos.
				</p>
				<div class="fields">
					<LnxInput v-model="form.monthlyVotes" type="number" min="1" max="99" :placeholder="String(DEFAULT_MONTHLY_VOTES)">
						Votos al mes por propiedad
						<template #helper>
							Para apoyar incidencias, los da el propietario de cada una. Si se deja vacío, {{ DEFAULT_MONTHLY_VOTES }}.
						</template>
					</LnxInput>
				</div>
			</section>

			<section v-if="section === 'contacts'" class="card">
				<header>
					<LnxButton type="button" mode="outline" size="small" @click="addContact()">
						<LnxIcon icon="lucide:plus" />
						Añadir contacto
					</LnxButton>
				</header>
				<p v-if="!form.contacts.length" class="hint">
					Aún no hay contactos. Los vecinos verán solo el teléfono de emergencias.
				</p>

				<fieldset v-for="(contact, index) in form.contacts" :key="index" class="item">
					<legend class="sr-only">
						Contacto {{ index + 1 }}
					</legend>
					<div class="fields">
						<LnxSelect
							v-model.convert="contact.type"
							:options="contactTypeOptions"
							:convert-fn="option => option.value"
							search-placeholder-text="Buscar..."
						>
							Tipo
							<template #option="{ option }">
								{{ option.label }}
							</template>
							<template #optionInput="{ value }">
								{{ contactTypes[value]?.label }}
							</template>
						</LnxSelect>
						<LnxInput v-model="contact.name" required>
							Nombre
						</LnxInput>
						<LnxInput v-model="contact.phone" type="tel">
							Teléfono
						</LnxInput>
						<LnxInput v-model="contact.whatsapp" type="tel">
							WhatsApp
						</LnxInput>
						<LnxInput v-model="contact.email" type="email" class="wide">
							Email
						</LnxInput>
					</div>

					<div v-for="(schedule, scheduleIndex) in contact.schedule" :key="scheduleIndex" class="schedule">
						<fieldset class="days">
							<legend>Horario</legend>
							<label v-for="(day, dayIndex) in WEEKDAYS" :key="day">
								<input v-model="schedule.days" type="checkbox" class="sr-only" :value="dayIndex + 1">
								<span>{{ day }}</span>
							</label>
						</fieldset>
						<LnxInput v-model="schedule.from" type="time" required>
							Desde
						</LnxInput>
						<LnxInput v-model="schedule.to" type="time" required>
							Hasta
						</LnxInput>
						<LnxButton
							type="button"
							mode="clear"
							shape="circle"
							:aria-label="`Quitar este horario de ${contact.name || 'el contacto'}`"
							:title="`Quitar este horario de ${contact.name || 'el contacto'}`"
							@click="contact.schedule!.splice(scheduleIndex, 1)"
						>
							<LnxIcon icon="lucide:x" />
						</LnxButton>
					</div>

					<div class="item-actions">
						<LnxButton type="button" mode="clear" size="small" @click="addSchedule(contact)">
							<LnxIcon icon="lucide:clock" />
							Añadir horario
						</LnxButton>
						<LnxButton type="button" mode="clear" size="small" variant="danger" @click="form.contacts.splice(index, 1)">
							<LnxIcon icon="lucide:trash-2" />
							Quitar contacto
						</LnxButton>
					</div>
				</fieldset>
			</section>

			<section v-if="section === 'documents'" class="card">
				<header>
					<LnxButton type="button" mode="outline" size="small" @click="addDocument()">
						<LnxIcon icon="lucide:plus" />
						Añadir documento
					</LnxButton>
				</header>
				<p v-if="!form.documents.length" class="hint">
					Aún no hay documentos: estatutos, normas, póliza del seguro o actas de las juntas.
				</p>

				<fieldset v-for="(communityDocument, index) in form.documents" :key="index" class="item">
					<legend class="sr-only">
						Documento {{ index + 1 }}
					</legend>
					<div class="fields">
						<LnxSelect
							v-model.convert="communityDocument.type"
							:options="documentTypeOptions"
							:convert-fn="option => option.value"
							search-placeholder-text="Buscar..."
						>
							Tipo
							<template #option="{ option }">
								{{ option.label }}
							</template>
							<template #optionInput="{ value }">
								{{ documentTypes[value]?.label }}
							</template>
						</LnxSelect>
						<DatePicker v-model="communityDocument.date" required>
							Fecha
						</DatePicker>
						<LnxInput v-model="communityDocument.title" class="wide" required>
							Título
						</LnxInput>
						<LnxInput v-model="communityDocument.url" type="url" class="wide" required>
							Enlace al PDF
						</LnxInput>
					</div>
					<div class="item-actions">
						<LnxButton type="button" mode="clear" size="small" variant="danger" @click="form.documents.splice(index, 1)">
							<LnxIcon icon="lucide:trash-2" />
							Quitar documento
						</LnxButton>
					</div>
				</fieldset>
			</section>

			<footer class="actions">
				<p v-if="error" class="error" role="alert">
					{{ error }}
				</p>
				<LnxButton v-if="!id" :to="backTo" mode="clear">
					Cancelar
				</LnxButton>
				<LnxButton type="submit" :is-loading="saving">
					<LnxIcon icon="lucide:save" />
					{{ id ? 'Guardar cambios' : 'Crear comunidad' }}
					<Kbd combo="mod+enter" />
				</LnxButton>
			</footer>
		</template>
	</form>
</template>

<style lang="scss" scoped>
form {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-5);
}

.page-header {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		min-width: 0;
		overflow: hidden;
		font-size: var(--lnx-font-size-title);
		white-space: nowrap;
		text-overflow: ellipsis;
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

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
	}

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.hint {
	margin-top: calc(-1 * var(--lnx-spacing-2));
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);

	&.duplicate {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
	}
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
}

.skeleton-field {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);

	.skeleton-item--big-square {
		height: 40px;
		border-radius: var(--lnx-radius-2);
	}
}

.item {
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-1);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.item-actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);
}

// Days on their own row, then from, to and the button to remove it
.schedule {
	display: grid;
	grid-template-columns: 1fr 1fr auto;
	align-items: end;
	gap: var(--lnx-spacing-2) var(--lnx-spacing-3);

	.days {
		grid-column: 1 / -1;
	}
}

.days {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	legend {
		width: 100%;
		margin-bottom: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);
	}

	span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		height: 40px;
		padding: 0 var(--lnx-spacing-2);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		cursor: pointer;
		transition: background-color var(--duration) var(--ease-out), border-color var(--duration) var(--ease-out), color var(--duration) var(--ease-out), scale var(--duration-fast) var(--ease-out);

		&:hover {
			background: var(--color-gray-1);
		}

		&:active {
			scale: var(--press-scale);
		}
	}

	input:checked + span {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-primary-accent);
	}

	input:focus-visible + span {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
}

.actions {
	position: sticky;
	bottom: 0;
	padding: var(--lnx-spacing-3) 0;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);
	background: color-mix(in srgb, var(--color-gray-1) 90%, transparent);
	backdrop-filter: blur(8px);
	box-shadow: 0 -1px 0 var(--color-gray-3);

	.error {
		flex: 1 1 100%;
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
