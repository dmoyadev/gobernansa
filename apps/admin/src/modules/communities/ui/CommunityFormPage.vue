<script setup lang="ts">
import type { Community, CommunityContact } from '@gobernansa/shared/domain/community.ts';
import type { CommunityForm, CommunitySection } from '../domain/communityForm.ts';
import { DEFAULT_MONTHLY_VOTES } from '@gobernansa/shared/domain/issue.ts';
import { LnxButton, LnxIcon, LnxInput, LnxKbd, useConfirm, useShortcut } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { workspaces } from '@/app/workspace/workspaces.ts';
import { duplicateCommunity } from '../application/duplicateCommunity.ts';
import { loadCommunity, saveCommunity } from '../application/useCommunities.ts';
import { findFormError, toCommunityForm, toInputDate } from '../domain/communityForm.ts';
import CommunityContactFields from './CommunityContactFields.vue';
import CommunityDocumentFields from './CommunityDocumentFields.vue';

// Without an id, a new community is created from its general info and settings, prefilled from another one with ?from=<id>
const props = withDefaults(defineProps<{ id?: string; section?: CommunitySection }>(), { section: 'info' });

const ask = useConfirm();

const route = useRoute();
// Read again each time the page comes back, as the kept page is reused for any ?from=
const queryFrom = () => props.id ? undefined : route.query.from as string | undefined;
const fromId = ref(queryFrom());
// A new one's: an existing one has the nav of its workspace instead
const backTo = computed(() => fromId.value ? `/communities/${fromId.value}` : '/');
const backLabel = computed(() => fromId.value ? 'Volver a la comunidad' : 'Volver a comunidades');

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
const confirmLeave = async () => saving.value || isPristine() || await ask({ title: '¿Descartar los cambios sin guardar?', confirmText: 'Descartar', cancelText: 'Seguir editando', variant: 'danger' });
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

// The contact or document «Nuevo» adds, in its own form above the list as on the other pages. Added, it goes last and
// is saved with the rest of the section
const blankContact = (): CommunityContact => ({ type: 'other', name: '' });
const blankDocument = (): CommunityForm['documents'][number] => ({ type: 'minutes', title: '', url: '', date: toInputDate(new Date()) });
const newContact = ref(blankContact());
const newDocument = ref(blankDocument());
const newElement = useTemplateRef<HTMLFormElement>('newElement');
const { open: adding, show: showNew, close: closeNew } = useNewForm(newElement, () => {
	newContact.value = blankContact();
	newDocument.value = blankDocument();
});

function add() {
	const contacts = props.section === 'contacts';
	if (contacts) {
		form.value.contacts.push(newContact.value);
	} else {
		form.value.documents.push(newDocument.value);
	}
	closeNew();
	void save(contacts ? 'Contacto añadido' : 'Documento añadido');
}

function addSchedule(contact: CommunityContact) {
	(contact.schedule ??= []).push({ days: [1, 2, 3, 4, 5], from: '09:00', to: '14:00' });
}

async function save(done = props.id ? 'Guardado' : 'Comunidad creada') {
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
		done,
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

useShortcut('mod+enter', () => (adding.value ? newElement : formElement).value?.requestSubmit(), { description: props.id ? 'Guardar cambios' : 'Crear comunidad' });
</script>

<template>
	<header class="page-header">
		<!-- An existing one's has the nav of its workspace instead -->
		<BackButton v-if="!id" :to="backTo" :label="backLabel" />
		<h1>{{ id ? workspaces.community.sectionOf.get(section)!.pages[0].title : 'Nueva comunidad' }}</h1>
		<template v-if="!loading && !notFound && !loadError && !adding">
			<NewButton v-if="section === 'contacts'" label="Nuevo contacto" @click="showNew()" />
			<NewButton v-else-if="section === 'documents'" label="Nuevo documento" @click="showNew()" />
		</template>
	</header>

	<form v-if="adding" ref="newElement" class="card new lnx-appear" @submit.prevent="add()">
		<h2>{{ section === 'contacts' ? 'Nuevo contacto' : 'Nuevo documento' }}</h2>
		<CommunityContactFields v-if="section === 'contacts'" v-model="newContact" />
		<CommunityDocumentFields v-else v-model="newDocument" />

		<footer class="form-actions">
			<LnxButton v-if="section === 'contacts'" mode="clear" class="lnx-size-small add-schedule" @click="addSchedule(newContact)">
				<LnxIcon icon="lucide:clock" />
				Añadir horario
			</LnxButton>
			<LnxButton mode="clear" @click="closeNew()">
				Cancelar
				<LnxKbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit">
				<LnxIcon icon="lucide:plus" />
				Añadir
				<LnxKbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<form ref="formElement" @submit.prevent="save()">
		<!-- Shaped like the first card: its title and fields -->
		<section v-if="loading" class="card" aria-busy="true">
			<span class="lnx-skeleton lnx-skeleton--small" style="width: 22%" />
			<div class="fields">
				<span v-for="width in [92, 88, 46]" :key="width" class="skeleton-field">
					<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width / 3}%` }" />
					<span class="lnx-skeleton lnx-skeleton--rect" :style="{ width: `${width}%` }" />
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
			<p v-if="source" class="hint duplicate lnx-appear">
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
				<p v-if="!form.contacts.length" class="hint">
					Aún no hay contactos. Los vecinos verán solo el teléfono de emergencias.
				</p>

				<fieldset v-for="(contact, index) in form.contacts" :key="index" class="item">
					<legend class="sr-only">
						Contacto {{ index + 1 }}
					</legend>
					<CommunityContactFields v-model="form.contacts[index]" />

					<div class="item-actions">
						<LnxButton mode="clear" class="lnx-size-small" @click="addSchedule(contact)">
							<LnxIcon icon="lucide:clock" />
							Añadir horario
						</LnxButton>
						<LnxButton mode="clear" class="lnx-size-small" variant="danger" @click="form.contacts.splice(index, 1)">
							<LnxIcon icon="lucide:trash-2" />
							Quitar contacto
						</LnxButton>
					</div>
				</fieldset>
			</section>

			<section v-if="section === 'documents'" class="card">
				<p v-if="!form.documents.length" class="hint">
					Aún no hay documentos: estatutos, normas, póliza del seguro o actas de las juntas.
				</p>

				<fieldset v-for="(_, index) in form.documents" :key="index" class="item">
					<legend class="sr-only">
						Documento {{ index + 1 }}
					</legend>
					<CommunityDocumentFields v-model="form.documents[index]" />
					<div class="item-actions">
						<LnxButton mode="clear" class="lnx-size-small" variant="danger" @click="form.documents.splice(index, 1)">
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
					<LnxKbd combo="mod+enter" />
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
	margin-bottom: var(--lnx-spacing-5);
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

	.lnx-skeleton--rect {
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

.new {
	margin-bottom: var(--lnx-spacing-5);
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	// Apart from sending or cancelling the form
	.add-schedule {
		margin-right: auto;
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
