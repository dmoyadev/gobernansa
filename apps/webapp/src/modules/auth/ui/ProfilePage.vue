<script setup lang="ts">
import type { UserDocument } from '../domain/user.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { propertyTypeIcons, propertyTypeLabels } from '@gobernansa/shared/domain/property.ts';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { useUserProperties } from '@/modules/community/application/useUserProperties.ts';
import IsotypeSVG from '@/shared/ui/IsotypeSVG.vue';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheHeader from '@/shared/ui/TheHeader.vue';
import TiltCard from '@/shared/ui/TiltCard.vue';
import { version } from '../../../../package.json';
import { usePushNotifications } from '../application/usePushNotifications.ts';
import { MAX_DOCUMENT_SIZE, useUserDocuments } from '../application/useUserDocuments.ts';
import { userDocumentCategories } from '../domain/user.ts';

const { user, logout, changePassword } = useAuth();
const { userCommunity } = useUserCommunity();
const { userProperties, selectedProperty } = useUserProperties();

/* Documents */
const { documents, uploadDocument, openDocument, deleteDocument } = useUserDocuments();
const adding = ref(false);
const category = ref<UserDocument['category']>('deed');
const propertyId = ref<string>();
const uploading = ref(false);
const documentsError = ref<string>();

async function upload(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file) {
		return;
	}

	documentsError.value = undefined;
	if (file.size > MAX_DOCUMENT_SIZE) {
		documentsError.value = 'El archivo ocupa más de 1 MB. Prueba a reducirlo o a hacer la foto con menos calidad.';
		return;
	}

	uploading.value = true;
	try {
		await uploadDocument(file, category.value, propertyId.value ?? selectedProperty.value?.id);
		adding.value = false;
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error(error);
		documentsError.value = 'No se ha podido subir. Revisa tu conexión e inténtalo de nuevo.';
	} finally {
		uploading.value = false;
	}
}

async function open(document: UserDocument) {
	documentsError.value = undefined;
	try {
		await openDocument(document);
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error(error);
		documentsError.value = 'No se ha podido abrir. Revisa tu conexión e inténtalo de nuevo.';
	}
}

async function remove(document: UserDocument) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Eliminar «${document.name}»? No se puede deshacer.`)) {
		return;
	}

	documentsError.value = undefined;
	try {
		await deleteDocument(document);
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error(error);
		documentsError.value = 'No se ha podido eliminar. Revisa tu conexión e inténtalo de nuevo.';
	}
}

function describe(document: UserDocument) {
	const property = userProperties.value.length > 1 && userProperties.value.find(({ id }) => id === document.propertyId);
	return [
		userDocumentCategories.find(({ value }) => value === document.category)?.label,
		property && property.name,
		`${Math.max(1, Math.round(document.size / 1000))} KB`,
		document.uploadedBy && `Enviado por ${document.uploadedBy}`,
	].filter(Boolean).join(' · ');
}

/* Notifications */
const push = usePushNotifications();
const pushBusy = ref(false);
const pushError = ref(false);
const pushStatus = computed(() => {
	if (!push.supported) {
		return 'Tu navegador no las admite. En iPhone, añade la app a la pantalla de inicio.';
	}
	if (push.permission.value === 'denied') {
		return 'Bloqueadas en los ajustes del navegador';
	}
	return push.enabled.value ? 'Activadas en este dispositivo' : 'Avisos de tus incidencias y de la comunidad';
});

async function togglePush() {
	pushBusy.value = true;
	pushError.value = false;
	try {
		await (push.enabled.value ? push.disable() : push.enable());
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error(error);
		pushError.value = true;
	} finally {
		pushBusy.value = false;
	}
}

/* Password */
const password = ref('');
const passwordRepeat = ref('');
const savingPassword = ref(false);
const passwordMessage = ref<{ error: boolean; text: string }>();

async function savePassword() {
	if (password.value.length < 6) {
		passwordMessage.value = { error: true, text: 'Usa al menos 6 caracteres.' };
		return;
	}
	if (password.value !== passwordRepeat.value) {
		passwordMessage.value = { error: true, text: 'Las contraseñas no coinciden.' };
		return;
	}

	savingPassword.value = true;
	passwordMessage.value = undefined;
	try {
		await changePassword(password.value);
		password.value = '';
		passwordRepeat.value = '';
		passwordMessage.value = { error: false, text: 'Contraseña guardada. Podrás usarla si no te llega el email para entrar.' };
	} catch (error) {
		const code = (error as { code?: string }).code;
		passwordMessage.value = {
			error: true,
			text: code === 'auth/requires-recent-login'
				? 'Por seguridad, cierra sesión, vuelve a entrar y prueba de nuevo.'
				: 'No se ha podido guardar. Inténtalo de nuevo.',
		};
	} finally {
		savingPassword.value = false;
	}
}
</script>

<template>
	<TheHeader>
		<h1>{{ user?.name || 'Perfil' }}</h1>
		<p>{{ user?.email }}</p>
	</TheHeader>

	<MainLayout>
		<section v-if="selectedProperty">
			<TiltCard>
				<div class="owner-card">
					<IsotypeSVG class="watermark" width="200" height="200" aria-hidden="true" />
					<div class="top">
						<small>Propietario/a</small>
						<span>{{ userCommunity?.name }}</span>
					</div>

					<div class="property">
						<span class="icon">
							<LnxIcon :icon="propertyTypeIcons[selectedProperty.type]" :size="24" />
						</span>
						<div>
							<h2>{{ selectedProperty.name }}</h2>
							<p>{{ propertyTypeLabels[selectedProperty.type] }}</p>
						</div>
					</div>

					<dl>
						<div>
							<dt>Titular</dt>
							<dd>{{ user?.name }}</dd>
						</div>
						<div v-if="userCommunity?.address">
							<dt>Dirección</dt>
							<dd>{{ userCommunity.address }}</dd>
						</div>
					</dl>
				</div>
			</TiltCard>

			<fieldset v-if="userProperties.length > 1" class="chips">
				<legend class="sr-only">
					Propiedad
				</legend>
				<label
					v-for="property in userProperties"
					:key="property.id"
					class="chip"
					:class="{ active: selectedProperty.id === property.id }"
				>
					<input v-model="selectedProperty" type="radio" name="property" :value="property">
					<LnxIcon :icon="propertyTypeIcons[property.type]" :size="16" />
					{{ property.name }}
				</label>
			</fieldset>
		</section>

		<section>
			<h2>Documentos</h2>
			<ul v-if="documents.length" class="list">
				<li v-for="document in documents" :key="document.id" class="row">
					<button type="button" class="open" @click="open(document)">
						<span class="icon">
							<LnxIcon :icon="userDocumentCategories.find(({ value }) => value === document.category)?.icon || 'lucide:file'" :size="20" />
						</span>
						<span class="body">
							<strong>{{ document.name }}</strong>
							<small>{{ describe(document) }}</small>
						</span>
					</button>
					<LnxButton
						mode="clear"
						shape="circle"
						variant="grayscale"
						:aria-label="`Eliminar ${document.name}`"
						@click="remove(document)"
					>
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</li>
			</ul>
			<p v-else-if="!adding" class="hint">
				Guarda aquí las escrituras, permisos o recibos de las cuotas de tu propiedad. Solo tú y tu administración podéis verlos.
			</p>

			<form v-if="adding" class="upload" @submit.prevent>
				<fieldset class="chips">
					<legend>¿Qué documento es?</legend>
					<label
						v-for="option in userDocumentCategories"
						:key="option.value"
						class="chip"
						:class="{ active: category === option.value }"
					>
						<input v-model="category" type="radio" name="category" :value="option.value">
						<LnxIcon :icon="option.icon" :size="16" />
						{{ option.label }}
					</label>
				</fieldset>

				<fieldset v-if="userProperties.length > 1" class="chips">
					<legend>¿De qué propiedad?</legend>
					<label
						v-for="property in userProperties"
						:key="property.id"
						class="chip"
						:class="{ active: (propertyId ?? selectedProperty?.id) === property.id }"
					>
						<input v-model="propertyId" type="radio" name="document-property" :value="property.id">
						{{ property.name }}
					</label>
				</fieldset>

				<label class="file-button" :class="{ disabled: uploading }">
					<input
						class="sr-only"
						type="file"
						accept="application/pdf,image/*"
						:disabled="uploading"
						@change="upload"
					>
					<LnxIcon :icon="uploading ? 'lucide:loader-circle' : 'lucide:upload'" :class="{ spin: uploading }" />
					{{ uploading ? 'Subiendo…' : 'Elegir archivo' }}
				</label>
				<small class="hint">PDF o imagen de hasta 1 MB. Solo tú podrás verlo.</small>
			</form>

			<p v-if="documentsError" class="error" role="alert">
				<LnxIcon icon="lucide:circle-alert" :size="16" />
				{{ documentsError }}
			</p>

			<LnxButton
				v-if="!adding"
				mode="outline"
				is-block
				@click="adding = true"
			>
				<LnxIcon icon="lucide:file-plus" />
				Añadir documento
			</LnxButton>
			<LnxButton
				v-else
				mode="clear"
				variant="grayscale"
				is-block
				:disabled="uploading"
				@click="adding = false"
			>
				Cancelar
			</LnxButton>
		</section>

		<section>
			<h2>Ajustes</h2>
			<ul class="list">
				<li>
					<label class="row">
						<span class="icon">
							<LnxIcon icon="lucide:bell" :size="20" />
						</span>
						<span class="body">
							<strong>Notificaciones</strong>
							<small :class="{ 'error-text': pushError }">
								{{ pushError ? 'No se han podido cambiar. Inténtalo de nuevo.' : pushStatus }}
							</small>
						</span>
						<input
							class="switch"
							type="checkbox"
							role="switch"
							:checked="push.enabled.value"
							:disabled="!push.supported || push.permission.value === 'denied' || pushBusy"
							@change="togglePush()"
						>
					</label>
				</li>
				<li>
					<details class="password">
						<summary class="row">
							<span class="icon">
								<LnxIcon icon="lucide:key-round" :size="20" />
							</span>
							<span class="body">
								<strong>Cambiar contraseña</strong>
								<small>Para entrar si no te llega el email</small>
							</span>
							<LnxIcon class="chevron" icon="lucide:chevron-down" :size="16" />
						</summary>

						<form @submit.prevent="savePassword()">
							<!-- Lets password managers know whose password it is -->
							<input class="sr-only" type="email" autocomplete="username" :value="user?.email" readonly tabindex="-1" aria-hidden="true">
							<LnxInput v-model="password" type="password" autocomplete="new-password" required>
								Nueva contraseña
							</LnxInput>
							<LnxInput v-model="passwordRepeat" type="password" autocomplete="new-password" required>
								Repítela
							</LnxInput>
							<p v-if="passwordMessage" :class="passwordMessage.error ? 'error' : 'success'" role="status">
								<LnxIcon :icon="passwordMessage.error ? 'lucide:circle-alert' : 'lucide:circle-check'" :size="16" />
								{{ passwordMessage.text }}
							</p>
							<LnxButton type="submit" is-block :is-loading="savingPassword" :disabled="savingPassword">
								Guardar contraseña
							</LnxButton>
						</form>
					</details>
				</li>
			</ul>
		</section>

		<section>
			<h2>Información legal</h2>
			<ul class="list">
				<li
					v-for="link in [
						{ hash: 'privacy', icon: 'lucide:shield', label: 'Política de privacidad' },
						{ hash: 'terms', icon: 'lucide:scale', label: 'Términos y condiciones' },
						{ hash: 'cookies', icon: 'lucide:cookie', label: 'Política de cookies' },
					]" :key="link.hash"
				>
					<RouterLink class="row" :to="`/legal#${link.hash}`">
						<span class="icon">
							<LnxIcon :icon="link.icon" :size="20" />
						</span>
						<span class="body">
							<strong>{{ link.label }}</strong>
						</span>
						<LnxIcon class="chevron" icon="lucide:chevron-right" :size="16" />
					</RouterLink>
				</li>
			</ul>
		</section>

		<LnxButton variant="danger" mode="outline" is-block @click="logout()">
			<LnxIcon icon="lucide:log-out" />
			Cerrar sesión
		</LnxButton>

		<p class="version">
			gobernança v{{ version }}
		</p>
	</MainLayout>
</template>

<style lang="scss" scoped>
section {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	> h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.owner-card {
	position: relative;
	overflow: hidden;
	aspect-ratio: 1.586; // Credit card proportions
	padding: var(--lnx-spacing-4);
	border-radius: inherit;
	background:
		radial-gradient(circle at 100% 0%, #e1616233, transparent 50%),
		linear-gradient(160deg, var(--color-gray-0) 0%, var(--color-gray-2) 100%);
	border: 1px solid var(--color-gray-3);
	color: var(--color-gray-9);
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: var(--lnx-spacing-3);

	.watermark {
		position: absolute;
		right: -50px;
		bottom: -60px;
		color: #e161621A;
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);

		small {
			color: var(--color-secondary-accent);
			font-size: .7rem;
			font-weight: var(--lnx-font-weight-bold);
			letter-spacing: .08em;
			text-transform: uppercase;
		}

		span {
			overflow: hidden;
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.property {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);

		.icon {
			flex-shrink: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 48px;
			height: 48px;
			border-radius: var(--lnx-radius-3);
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}

		h2 {
			font-size: 1.4rem;
			line-height: 1.2;
		}

		p {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
		}
	}

	dl {
		display: flex;
		gap: var(--lnx-spacing-4);

		div {
			min-width: 0;
		}

		dt {
			color: var(--color-gray-6);
			font-size: .65rem;
			letter-spacing: .08em;
			text-transform: uppercase;
		}

		dd {
			overflow: hidden;
			font-weight: var(--lnx-font-weight-bold);
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);

	legend {
		margin-bottom: var(--lnx-spacing-2);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
	}

	.chip {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		padding: var(--lnx-spacing-1) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-4);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		cursor: pointer;
		transition: background .15s, color .15s, border-color .15s;

		&.active {
			border-color: var(--color-primary);
			background: var(--color-primary);
			color: var(--color-primary-accent);
		}

		&:has(:focus-visible) {
			outline: 2px solid var(--color-primary-light);
			outline-offset: 2px;
		}

		input {
			position: absolute;
			opacity: 0;
			pointer-events: none;
		}
	}
}

section > .chips {
	margin-top: var(--lnx-spacing-2);
	justify-content: center;
}

.list {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;

	> li + li {
		border-top: 1px solid var(--color-gray-2);
	}
}

.row,
.open {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);
	color: inherit;
	text-align: left;
	text-decoration: none;
}

.row {
	padding: var(--lnx-spacing-3);
	cursor: pointer;

	.icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-1);
		color: var(--color-primary);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;

		strong {
			overflow: hidden;
			color: var(--color-gray-9);
			font-weight: var(--lnx-font-weight-regular);
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
		}
	}

	.chevron {
		flex-shrink: 0;
		color: var(--color-gray-5);
		transition: transform .2s;
	}
}

a.row:active,
.open:active {
	background: var(--color-gray-1);
}

li.row {
	cursor: default;
}

.open {
	flex: 1;
	min-width: 0;
	margin: calc(-1 * var(--lnx-spacing-3)) 0 calc(-1 * var(--lnx-spacing-3)) calc(-1 * var(--lnx-spacing-3));
	padding: var(--lnx-spacing-3);
	cursor: pointer;
}

.password {
	summary {
		list-style: none;

		&::-webkit-details-marker {
			display: none;
		}
	}

	&[open] .chevron {
		transform: rotate(180deg);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-3);
		padding: 0 var(--lnx-spacing-3) var(--lnx-spacing-3);
	}
}

.switch {
	flex-shrink: 0;
	position: relative;
	width: 44px;
	height: 26px;
	border-radius: 26px;
	background: var(--color-gray-4);
	appearance: none;
	cursor: pointer;
	transition: background .2s;

	&::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 20px;
		height: 20px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-0);
		box-shadow: 0 1px 3px #00000033;
		transition: transform .2s;
	}

	&:checked {
		background: var(--color-issue-status-resolved);

		&::after {
			transform: translateX(18px);
		}
	}

	&:disabled {
		opacity: .5;
		cursor: not-allowed;
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary-light);
		outline-offset: 2px;
	}
}

.upload {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
	padding: var(--lnx-spacing-3);
	border: 1px dashed var(--color-gray-4);
	border-radius: var(--lnx-radius-3);
}

.file-button {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: var(--lnx-spacing-2);
	padding: var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-primary);
	color: var(--color-primary-accent);
	font-weight: var(--lnx-font-weight-bold);
	cursor: pointer;

	&.disabled {
		opacity: .7;
		cursor: progress;
	}

	&:has(:focus-visible) {
		outline: 2px solid var(--color-primary-light);
		outline-offset: 2px;
	}
}

.spin {
	animation: spin 1s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.error,
.success {
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);

	iconify-icon {
		flex-shrink: 0;
		margin-top: 2px;
	}
}

.error,
.error-text {
	color: var(--color-secondary-accent) !important;
}

.success {
	color: var(--color-issue-status-resolved);
}

.version {
	color: var(--color-gray-5);
	font-size: var(--lnx-font-size-small);
	text-align: center;
}
</style>
