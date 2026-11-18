<script setup lang="ts">
import type { PersonDocument } from '../application/personDocuments.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { MAX_DOCUMENT_SIZE, MAX_DOCUMENTS } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxIcon, LnxRadioGroup, useConfirm } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { downloadFile } from '@/app/ux/download.ts';
import FormCard from '@/app/ux/FormCard.vue';
import { newId } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadDocumentFile, removePersonDocument, sendPersonDocument, usePersonDocuments } from '../application/personDocuments.ts';

const props = defineProps<{ id: string; uid: string }>();

const ask = useConfirm();

const categories: { value: PersonDocument['category']; label: string; icon: string }[] = [
	{ value: 'deed', label: 'Escrituras', icon: 'lucide:landmark' },
	{ value: 'permit', label: 'Permisos', icon: 'lucide:stamp' },
	{ value: 'receipt', label: 'Recibos', icon: 'lucide:receipt-text' },
	{ value: 'other', label: 'Otros', icon: 'lucide:file' },
];

const { user: me } = useAuth();
const { person, documents: documentList, properties } = usePersonDocuments(props.id, props.uid);
const { data: documents, pending, error } = documentList;
const propertyNames = computed(() => Object.fromEntries(properties.value.map(property => [property.id, property.name])));

const file = ref<File>();
const category = ref<PersonDocument['category']>('other');
const propertyId = ref('');
const sending = ref(false);
const formError = ref<string>();
const formElement = useTemplateRef('formElement');
// Sending it again after a failure writes the same document instead of a second one
let documentId = newId();

function reset() {
	file.value = undefined;
	formError.value = undefined;
	documentId = newId();
}

const { open, show, close } = useNewForm(formElement, reset);

async function upload() {
	if (!file.value || sending.value) {
		return;
	}
	if (file.value.size > MAX_DOCUMENT_SIZE) {
		formError.value = 'El archivo no puede pasar de 1 MB.';
		return;
	}
	if (documents.value.length >= MAX_DOCUMENTS) {
		formError.value = `Cada vecino puede tener hasta ${MAX_DOCUMENTS} documentos. Borra alguno antes de enviar otro.`;
		return;
	}

	sending.value = true;
	formError.value = undefined;
	try {
		await sendPersonDocument(props.id, props.uid, documentId, file.value, { category: category.value, propertyId: propertyId.value, uploadedBy: me.value?.name || 'Administración' }, person.value?.name ?? 'un vecino');
		close();
	} catch (e) {
		formError.value = `No se ha podido enviar: ${(e as Error).message}`;
	} finally {
		sending.value = false;
	}
}

const actionError = ref<string>();

async function download(document: PersonDocument) {
	actionError.value = undefined;
	try {
		const bytes = await loadDocumentFile(props.uid, document.id);
		if (!bytes) {
			throw new Error('El documento no tiene archivo');
		}

		downloadFile(document.name, bytes as BlobPart, document.type);
	} catch (e) {
		actionError.value = `No se ha podido descargar: ${(e as Error).message}`;
	}
}

// Only the ones sent by the administration, the neighbour's own are theirs to remove. No undo: the file itself isn't
// in the page (it's only read to download it), and reading it first just in case would cost a read per delete
async function remove(document: PersonDocument) {
	if (!await ask({ title: `¿Borrar «${document.name}»?`, message: `${person.value?.name ?? 'El vecino'} dejará de verlo.`, confirmText: 'Borrar', variant: 'danger' })) {
		return;
	}

	void optimistic(removePersonDocument(props.id, props.uid, document, person.value?.name ?? 'un vecino'), { done: 'Documento borrado', failed: 'No se ha podido borrar' });
}

function formatSize(bytes: number) {
	return bytes < 1_000_000 ? `${Math.ceil(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}/people`" label="Volver a vecinos y gestores" />
		<h1>
			Documentos<template v-if="person">
				de <span :style="{ viewTransitionName: `person-${uid}` }">{{ person.name }}</span>
			</template>
		</h1>
		<NewButton v-if="!open" label="Enviar un documento" @click="show()" />
	</header>

	<FormCard
		v-if="open"
		ref="formElement"
		title="Enviar un documento"
		:error="formError"
		submit-label="Enviar"
		submit-icon="lucide:send"
		:saving="sending"
		shortcut="Enviar el documento elegido"
		@submit="upload()"
		@cancel="close()"
	>
		<p class="hint">
			Lo verá en su perfil, con tu nombre. Hasta 1 MB.
		</p>
		<input
			type="file"
			required
			@change="file = ($event.target as HTMLInputElement).files?.[0]"
		>

		<LnxRadioGroup v-model="category" :options="categories">
			Categoría
		</LnxRadioGroup>

		<LnxRadioGroup v-if="properties.length" v-model="propertyId" :options="[{ value: '', label: 'Ninguna' }, ...properties.map(property => ({ value: property.id, label: property.name }))]">
			Propiedad
		</LnxRadioGroup>
	</FormCard>

	<section class="card">
		<h2>Sus documentos</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<ul v-if="pending && !documents.length" class="list" aria-busy="true">
			<li v-for="width in [42, 60, 34]" :key="width" class="document">
				<span class="lnx-skeleton lnx-skeleton--circle" />
				<div class="what">
					<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
					<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width + 25}%` }" />
				</div>
				<span class="lnx-skeleton lnx-skeleton--circle" />
			</li>
		</ul>
		<TransitionGroup v-else-if="documents.length" tag="ul" name="row" class="list lnx-appear">
			<li v-for="document in documents" :key="document.id" class="document">
				<LnxIcon :icon="categories.find(option => option.value === document.category)?.icon ?? 'lucide:file'" />
				<div class="what">
					<strong>{{ document.name }}</strong>
					<small class="tabular">
						{{ categories.find(option => option.value === document.category)?.label }}
						<template v-if="document.propertyId && propertyNames[document.propertyId]"> · {{ propertyNames[document.propertyId] }}</template>
						· {{ formatSize(document.size) }}
						· {{ document.uploadedBy ? `Enviado por ${document.uploadedBy}` : 'Subido por el vecino' }}
					</small>
				</div>
				<div class="actions">
					<LnxButton mode="clear" class="lnx-size-small" :aria-label="`Descargar ${document.name}`" :title="`Descargar ${document.name}`" @click="download(document)">
						<LnxIcon icon="lucide:download" />
					</LnxButton>
					<LnxButton
						v-if="document.uploadedBy"
						mode="clear"
						class="lnx-size-small"
						variant="danger"
						:aria-label="`Borrar ${document.name}`"
						:title="`Borrar ${document.name}`"
						@click="remove(document)"
					>
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</div>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			Aún no tiene documentos.
		</p>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	h1 {
		font-size: var(--lnx-font-size-title);
	}
}

.card {
	margin-bottom: var(--lnx-spacing-5);
}

.list {
	display: flex;
	flex-direction: column;
}

.document {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	strong {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	small {
		color: var(--color-gray-6);
	}
}

.actions {
	display: flex;
	gap: var(--lnx-spacing-1);
}

// Rows coming and going, interruptible as they're transitions
.row-move,
.row-enter-active,
.row-leave-active {
	transition: opacity var(--duration) var(--ease-out), translate var(--duration) var(--ease-out);
}

.row-enter-from,
.row-leave-to {
	opacity: 0;
	translate: 0 -4px;
}
</style>
