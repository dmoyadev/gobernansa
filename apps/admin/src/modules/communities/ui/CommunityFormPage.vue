<script setup lang="ts">
import type { CommunityContact, CommunityDocument, ContactType } from '@gobernansa/shared/domain/community.ts';
import type { CommunityForm } from '../domain/communityForm.ts';
import { contactTypes, documentTypes, WEEKDAYS } from '@gobernansa/shared/domain/community.ts';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { loadCommunity, saveCommunity } from '../application/useCommunities.ts';
import { findFormError, toCommunityForm, toInputDate } from '../domain/communityForm.ts';

// Without it, a new community is created
const props = defineProps<{ id?: string }>();

const contactTypeOptions = Object.entries(contactTypes).map(([value, { label }]) => ({ value: value as ContactType, label }));
const documentTypeOptions = Object.entries(documentTypes).map(([value, { label }]) => ({ value: value as CommunityDocument['type'], label }));
const currentYear = new Date().getFullYear();

const router = useRouter();
const form = ref<CommunityForm>(toCommunityForm());
const loading = ref(!!props.id);
const notFound = ref(false);
// Without the community, saving the empty form would replace its contacts and documents
const loadError = ref<string>();
const saving = ref(false);
const error = ref<string>();

onMounted(async () => {
	if (!props.id) {
		return;
	}

	try {
		const community = await loadCommunity(props.id);
		notFound.value = !community;
		form.value = toCommunityForm(community);
	} catch (e) {
		loadError.value = (e as Error).message;
	} finally {
		loading.value = false;
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
	error.value = findFormError(form.value);
	if (error.value) {
		return;
	}

	saving.value = true;
	try {
		await saveCommunity(props.id, form.value);
		await router.push('/');
	} catch (e) {
		// The form keeps what was typed, so it can be saved again
		error.value = `No se ha podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<form @submit.prevent="save()">
		<header class="page-header">
			<LnxButton to="/" mode="clear" shape="circle" aria-label="Volver a comunidades">
				<LnxIcon icon="lucide:arrow-left" />
			</LnxButton>
			<h1>{{ id ? (form.name || 'Editar comunidad') : 'Nueva comunidad' }}</h1>
		</header>

		<section v-if="loading" class="card" aria-busy="true">
			<span class="skeleton-item skeleton-item--title" />
			<span class="skeleton-item" />
			<span class="skeleton-item" />
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
			<section class="card">
				<h2>Datos generales</h2>
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
					<LnxInput v-model="form.monthlyVotes" type="number" min="1" max="99" placeholder="5">
						Votos al mes por vecino
						<template #helper>
							Si se deja vacío, 5.
						</template>
					</LnxInput>
					<LnxInput v-model="form.commonAreas" class="wide" placeholder="Portal, Escalera, Garaje, Piscina">
						Zonas comunes
						<template #helper>
							Separadas por comas. Los vecinos las eligen como lugar al dar un aviso.
						</template>
					</LnxInput>
				</div>
			</section>

			<section class="card">
				<h2>Datos fiscales</h2>
				<p class="hint">
					Los vecinos los ven y copian en la tarjeta de su comunidad, para pagar cuotas o facturar.
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
				</div>
			</section>

			<section class="card">
				<header>
					<h2>Contactos</h2>
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

			<section class="card">
				<header>
					<h2>Documentación oficial</h2>
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
						<LnxInput v-model="communityDocument.date" type="date" required>
							Fecha
						</LnxInput>
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
				<LnxButton to="/" mode="clear">
					Cancelar
				</LnxButton>
				<LnxButton type="submit" :is-loading="saving">
					<LnxIcon icon="lucide:save" />
					{{ id ? 'Guardar cambios' : 'Crear comunidad' }}
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
