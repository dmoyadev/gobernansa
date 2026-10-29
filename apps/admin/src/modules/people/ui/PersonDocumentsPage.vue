<script setup lang="ts">
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { User } from '@gobernansa/shared/domain/user.ts';
import type { Timestamp } from 'firebase/firestore';
import { logActivity } from '@gobernansa/shared/application/activity.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { db } from '@gobernansa/shared/infrastructure/firebase.ts';
import { Bytes, collection, doc, getDoc, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useCollection, useDocument } from 'vuefire';

// The same shape as the webapp's, which lists them to the neighbour along with the ones they upload
interface PersonDocument {
	id: string;
	name: string;
	type: string;
	size: number;
	category: 'deed' | 'permit' | 'receipt' | 'other';
	propertyId?: string;
	createdAt: Timestamp;
	// Who sent it from the administration, none for the ones the neighbour uploaded
	uploadedBy?: string;
}

const props = defineProps<{ id: string; uid: string }>();

// Files live inside Firestore documents to stay on the free plan, as the webapp does
const MAX_DOCUMENT_SIZE = 1_000_000;

const categories: { value: PersonDocument['category']; label: string; icon: string }[] = [
	{ value: 'deed', label: 'Escrituras', icon: 'lucide:landmark' },
	{ value: 'permit', label: 'Permisos', icon: 'lucide:stamp' },
	{ value: 'receipt', label: 'Recibos', icon: 'lucide:receipt-text' },
	{ value: 'other', label: 'Otros', icon: 'lucide:file' },
];

const { user: me } = useAuth();
const person = useDocument<User>(doc(db, 'users', props.uid));
const documentsRef = collection(db, 'users', props.uid, 'documents');
// Listed without their files, which are only read to download one
const { data: documents, pending, error } = useCollection<PersonDocument>(query(documentsRef, orderBy('createdAt', 'desc')));
const properties = useCollection<Property>(query(collection(db, 'properties'), where('communityId', '==', props.id), where('ownerUid', '==', props.uid)));
const propertyNames = computed(() => Object.fromEntries(properties.value.map(property => [property.id, property.name])));

const file = ref<File>();
const category = ref<PersonDocument['category']>('other');
const propertyId = ref('');
const sending = ref(false);
const formError = ref<string>();
const fileInput = ref<HTMLInputElement>();

function fileRef(id: string) {
	return doc(db, 'users', props.uid, 'documentFiles', id);
}

async function upload() {
	if (!file.value) {
		return;
	}
	if (file.value.size > MAX_DOCUMENT_SIZE) {
		formError.value = 'El archivo no puede pasar de 1 MB.';
		return;
	}

	sending.value = true;
	formError.value = undefined;
	try {
		const documentRef = doc(documentsRef);
		const batch = writeBatch(db);
		batch.set(fileRef(documentRef.id), { data: Bytes.fromUint8Array(new Uint8Array(await file.value.arrayBuffer())) });
		batch.set(documentRef, {
			name: file.value.name,
			type: file.value.type,
			size: file.value.size,
			category: category.value,
			...(propertyId.value ? { propertyId: propertyId.value } : {}),
			createdAt: serverTimestamp(),
			uploadedBy: me.value?.name || 'Administración',
		});
		logActivity(batch, props.id, {
			area: 'people',
			summary: `Envió «${file.value.name}» a ${person.value?.name ?? 'un vecino'}`,
			link: `/communities/${props.id}/people/${props.uid}/documents`,
		});
		await batch.commit();
		file.value = undefined;
		fileInput.value!.value = '';
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
		const bytes = ((await getDoc(fileRef(document.id))).data()?.data as Bytes | undefined)?.toUint8Array();
		if (!bytes) {
			throw new Error('El documento no tiene archivo');
		}

		const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: document.type }));
		Object.assign(window.document.createElement('a'), { href: url, download: document.name }).click();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	} catch (e) {
		actionError.value = `No se ha podido descargar: ${(e as Error).message}`;
	}
}

// Only the ones sent by the administration, the neighbour's own are theirs to remove
async function remove(document: PersonDocument) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${document.name}»? ${person.value?.name ?? 'El vecino'} dejará de verlo.`)) {
		return;
	}

	actionError.value = undefined;
	try {
		const batch = writeBatch(db);
		batch.delete(doc(documentsRef, document.id));
		batch.delete(fileRef(document.id));
		logActivity(batch, props.id, {
			area: 'people',
			summary: `Borró «${document.name}» de los documentos de ${person.value?.name ?? 'un vecino'}`,
			link: `/communities/${props.id}/people/${props.uid}/documents`,
		});
		await batch.commit();
	} catch (e) {
		actionError.value = `No se ha podido borrar: ${(e as Error).message}`;
	}
}

function formatSize(bytes: number) {
	return bytes < 1_000_000 ? `${Math.ceil(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
</script>

<template>
	<header class="page-header">
		<LnxButton :to="`/communities/${id}/people`" mode="clear" shape="circle" aria-label="Volver a vecinos y gestores">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>
			Documentos<template v-if="person">
				de {{ person.name }}
			</template>
		</h1>
	</header>

	<form class="card" @submit.prevent="upload()">
		<h2>Enviar un documento</h2>
		<p class="hint">
			Lo verá en su perfil, con tu nombre. Hasta 1 MB.
		</p>
		<input
			ref="fileInput"
			type="file"
			required
			@change="file = ($event.target as HTMLInputElement).files?.[0]"
		>

		<fieldset class="chips">
			<legend>Categoría</legend>
			<label v-for="option in categories" :key="option.value">
				<input v-model="category" type="radio" class="sr-only" :value="option.value">
				<span><LnxIcon :icon="option.icon" />{{ option.label }}</span>
			</label>
		</fieldset>

		<fieldset v-if="properties.length" class="chips">
			<legend>Propiedad</legend>
			<label>
				<input v-model="propertyId" type="radio" class="sr-only" value="">
				<span>Ninguna</span>
			</label>
			<label v-for="property in properties" :key="property.id">
				<input v-model="propertyId" type="radio" class="sr-only" :value="property.id">
				<span>{{ property.name }}</span>
			</label>
		</fieldset>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton type="submit" :is-loading="sending">
				<LnxIcon icon="lucide:send" />
				Enviar
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Sus documentos</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<span v-if="pending" class="skeleton-item" />
		<ul v-else-if="documents.length" class="list">
			<li v-for="document in documents" :key="document.id" class="document">
				<LnxIcon :icon="categories.find(option => option.value === document.category)?.icon ?? 'lucide:file'" />
				<div class="what">
					<strong>{{ document.name }}</strong>
					<small>
						{{ categories.find(option => option.value === document.category)?.label }}
						<template v-if="document.propertyId && propertyNames[document.propertyId]"> · {{ propertyNames[document.propertyId] }}</template>
						· {{ formatSize(document.size) }}
						· {{ document.uploadedBy ? `Enviado por ${document.uploadedBy}` : 'Subido por el vecino' }}
					</small>
				</div>
				<div class="actions">
					<LnxButton mode="clear" size="small" :aria-label="`Descargar ${document.name}`" @click="download(document)">
						<LnxIcon icon="lucide:download" />
					</LnxButton>
					<LnxButton
						v-if="document.uploadedBy"
						mode="clear"
						size="small"
						variant="danger"
						:aria-label="`Borrar ${document.name}`"
						@click="remove(document)"
					>
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</div>
			</li>
		</ul>
		<p v-else class="hint">
			Aún no tiene documentos.
		</p>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		font-size: var(--lnx-font-size-title);
	}
}

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

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	.error {
		flex: 1;
	}
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

.chips {
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
		gap: var(--lnx-spacing-1);
		min-height: 36px;
		padding: 0 var(--lnx-spacing-3);
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

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
