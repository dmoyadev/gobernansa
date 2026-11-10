<script setup lang="ts">
import type { Provider, ProviderCategory, ProviderRating } from '@gobernansa/shared/domain/provider.ts';
import type { ProviderForm } from '../application/providerActions.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { formatIban } from '@gobernansa/shared/domain/community.ts';
import { averageRating, providerCategories } from '@gobernansa/shared/domain/provider.ts';
import { managesCommunity } from '@gobernansa/shared/domain/user.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxKbd, LnxRadioGroup, LnxSelect, LnxTextarea, useConfirm, useShortcut } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { canRestoreProvider, deleteProvider, findProviderError, loadRatings, rateProvider, restoreProvider, saveProvider } from '../application/providerActions.ts';
import { useProviders } from '../application/useProviders.ts';

const ask = useConfirm();

// One directory for every community the user manages, each provider shared with the ones they choose
const { user: me } = useAuth();
const { providers, loading, error } = useProviders();
const { communities } = useCommunities();
const communityNames = computed(() => new Map(communities.value.map(community => [community.id, community.name || 'Sin nombre'])));

const categoryOptions = Object.entries(providerCategories).map(([value, { label }]) => ({ value: value as ProviderCategory, label }));
const filterOptions: { value: ProviderCategory | ''; label: string }[] = [{ value: '', label: 'Todas' }, ...categoryOptions];

const category = ref<ProviderCategory | ''>('');
const search = ref('');
const visibleProviders = computed(() => {
	const text = search.value.trim().toLocaleLowerCase('es');
	return providers.value.filter(provider => (!category.value || provider.category === category.value)
		&& (!text || [provider.name, provider.fiscalName, provider.phone, provider.email, provider.cif, provider.notes].some(field => field?.toLocaleLowerCase('es').includes(text))));
});

function emptyForm(): ProviderForm {
	// Shared with all of theirs unless they say otherwise
	return { name: '', category: 'plumbing', phone: '', email: '', cif: '', fiscalName: '', address: '', iban: '', notes: '', communityIds: communities.value.map(community => community.id) };
}

const form = ref<ProviderForm>(emptyForm());
const editingId = ref<string>();
// The new one's id, so sending it twice creates it once
const draftId = ref(newId());
const formError = ref<string>();
const formElement = ref<HTMLFormElement>();
const filtersElement = ref<HTMLElement>();

// Communities load after the form is built
watch(communities, () => {
	if (!editingId.value && !form.value.communityIds.length) {
		form.value.communityIds = communities.value.map(community => community.id);
	}
});

function reset() {
	editingId.value = undefined;
	form.value = emptyForm();
	formError.value = undefined;
	draftId.value = newId();
}

const { open, show, close } = useNewForm(formElement, reset);

function edit(provider: Provider) {
	editingId.value = provider.id;
	form.value = {
		name: provider.name,
		category: provider.category,
		phone: provider.phone ?? '',
		email: provider.email ?? '',
		cif: provider.cif ?? '',
		fiscalName: provider.fiscalName ?? '',
		address: provider.address ?? '',
		iban: provider.iban ? formatIban(provider.iban) : '',
		notes: provider.notes ?? '',
		// Only the ones they manage show as chips, the rest are kept as they are
		communityIds: provider.communityIds.filter(id => managesCommunity(me.value, id)),
	};
	formError.value = undefined;
	void show();
}

function save() {
	const original = providers.value.find(provider => provider.id === editingId.value);
	formError.value = findProviderError(form.value, original);
	if (formError.value) {
		return;
	}
	// The ones they don't manage count too, so a manager can stop sharing one an administrator also shares it with
	const others = original?.communityIds.filter(id => !managesCommunity(me.value, id)) ?? [];
	const communityIds = [...others, ...form.value.communityIds];
	if (!communityIds.length) {
		formError.value = 'Compártelo al menos con una comunidad.';
		return;
	}

	// The list shows it at once; the form closes now and comes back as it was if the server says no
	const sent = { editingId: editingId.value, draftId: draftId.value, form: form.value };
	close();
	void optimistic(saveProvider(sent.editingId, { ...sent.form, communityIds }, sent.draftId), {
		done: sent.editingId ? 'Proveedor guardado' : 'Proveedor añadido',
		failed: 'No se ha podido guardar',
		onError: () => {
			editingId.value = sent.editingId;
			draftId.value = sent.draftId;
			form.value = sent.form;
			open.value = true;
		},
	});
}

async function remove(provider: Provider) {
	if (!await ask({ title: `¿Eliminar ${provider.name} del directorio de todas sus comunidades?`, confirmText: 'Eliminar', variant: 'danger' })) {
		return;
	}

	if (editingId.value === provider.id) {
		close();
	}
	void optimistic(deleteProvider(provider.id), {
		done: 'Proveedor eliminado',
		failed: 'No se ha podido eliminar',
		revert: canRestoreProvider(provider, me.value) ? () => restoreProvider(provider) : undefined,
	});
}

function canDelete(provider: Provider) {
	return me.value?.role === 'superadmin' || provider.createdBy === me.value?.id;
}

function stars(value: number | undefined) {
	return Math.round(value ?? 0);
}

// Ratings of the opened provider
const openedId = ref<string>();
const ratings = ref<ProviderRating[]>([]);
const ratingsLoading = ref(false);
const ratingsError = ref<string>();
const rating = ref({ score: 5 as ProviderRating['score'], comment: '' });
// It reads the previous rating before writing, so a second send meanwhile would count it twice
let ratingSaving = false;

// Coming back keeps what they were writing
async function refreshRatings(providerId: string, keepDraft = false) {
	ratingsLoading.value = true;
	ratingsError.value = undefined;
	try {
		const loaded = await loadRatings(providerId);
		// Another one may have been opened meanwhile
		if (openedId.value !== providerId) {
			return;
		}
		ratings.value = loaded;
		if (!keepDraft) {
			const mine = ratings.value.find(item => item.authorId === me.value?.id);
			rating.value = { score: mine?.score ?? 5, comment: mine?.comment ?? '' };
		}
	} catch (e) {
		ratingsError.value = `No se han podido cargar las valoraciones: ${(e as Error).message}`;
	} finally {
		ratingsLoading.value = false;
	}
}

async function toggle(provider: Provider) {
	if (openedId.value === provider.id) {
		openedId.value = undefined;
		return;
	}

	openedId.value = provider.id;
	ratings.value = [];
	await refreshRatings(provider.id);
}

onRevalidate(() => openedId.value && refreshRatings(openedId.value, true));

async function rate(provider: Provider) {
	if (ratingSaving) {
		return;
	}
	// From the first of its communities the user manages, to know where the experience comes from
	const communityId = provider.communityIds.find(id => managesCommunity(me.value, id)) ?? provider.communityIds[0];
	const sent = { ...rating.value, communityId, authorName: me.value?.name ?? '' };
	const uid = me.value?.id ?? '';
	// Shown in the list at once instead of reading them all again, rolled back if the server says no
	const previous = ratings.value;
	const comment = sent.comment.trim();
	ratings.value = [
		{ ...sent, comment, id: uid, authorId: uid, createdAt: Timestamp.now() } as ProviderRating,
		...previous.filter(item => item.authorId !== uid),
	];
	ratingsError.value = undefined;
	ratingSaving = true;
	await optimistic(rateProvider(provider, sent), {
		done: 'Valoración guardada',
		failed: 'No se ha podido guardar la valoración',
		onError: () => {
			ratings.value = previous;
			rating.value = { score: sent.score, comment: sent.comment };
		},
	});
	ratingSaving = false;
}

function focusFirst(element: HTMLElement | undefined, selector: string) {
	element?.querySelector<HTMLElement>(selector)?.focus();
}

useShortcut('/', () => focusFirst(filtersElement.value, 'input[type="search"]'), { description: 'Buscar proveedores' });
// The rating's form when writing in it, the provider's otherwise
useShortcut('mod+enter', () => (document.activeElement?.closest('form') ?? formElement.value)?.requestSubmit(), { description: 'Guardar' });
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver a comunidades" />
		<h1>Proveedores</h1>
		<NewButton v-if="!open" label="Nuevo proveedor" @click="show()" />
	</header>

	<form v-if="open" ref="formElement" class="card lnx-appear" @submit.prevent="save()">
		<h2>{{ editingId ? 'Editar proveedor' : 'Nuevo proveedor' }}</h2>
		<div class="fields">
			<LnxInput v-model="form.name" required>
				Nombre
			</LnxInput>
			<LnxSelect
				v-model.convert="form.category"
				:options="categoryOptions"
				:convert-fn="option => option.value"
			>
				Categoría
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ providerCategories[value as ProviderCategory]?.label }}
				</template>
			</LnxSelect>
			<LnxInput v-model="form.phone" type="tel">
				Teléfono
			</LnxInput>
			<LnxInput v-model="form.email" type="email">
				Email
			</LnxInput>
			<LnxInput v-model="form.cif" placeholder="B23000003">
				NIF/CIF
			</LnxInput>
			<LnxInput v-model="form.fiscalName" placeholder="Como figura en sus facturas">
				Razón social
			</LnxInput>
			<LnxInput v-model="form.address" class="wide">
				Domicilio fiscal
			</LnxInput>
			<LnxInput v-model="form.iban" class="wide" placeholder="ES00 0000 0000 0000 0000 0000">
				IBAN para pagarle
			</LnxInput>
			<LnxTextarea v-model="form.notes" rows="2" class="wide">
				Notas
			</LnxTextarea>
		</div>

		<LnxRadioGroup v-model="form.communityIds" :options="communities.map(community => ({ value: community.id, label: community.name || 'Sin nombre' }))" multiple>
			Compartido con
		</LnxRadioGroup>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton mode="clear" @click="close()">
				Cancelar
				<LnxKbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit">
				<LnxIcon :icon="editingId ? 'lucide:save' : 'lucide:plus'" />
				{{ editingId ? 'Guardar cambios' : 'Añadir' }}
				<LnxKbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Directorio</h2>
		<div ref="filtersElement" class="fields">
			<LnxInput v-model="search" type="search">
				Buscar
			</LnxInput>
			<LnxSelect
				v-model.convert="category"
				:options="filterOptions"
				:convert-fn="option => option.value"
			>
				Categoría
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ value ? providerCategories[value as ProviderCategory]?.label : 'Todas' }}
				</template>
			</LnxSelect>
		</div>

		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<ul v-if="loading && !providers.length" class="list" aria-busy="true" aria-label="Cargando proveedores">
			<li v-for="width in [45, 30, 55, 38]" :key="width" class="provider">
				<span class="lnx-skeleton lnx-skeleton--circle" />
				<div class="who">
					<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
					<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width + 20}%` }" />
				</div>
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 90px" />
			</li>
		</ul>
		<TransitionGroup v-else-if="visibleProviders.length" tag="ul" name="row" class="list lnx-appear">
			<li v-for="provider in visibleProviders" :key="provider.id" class="provider">
				<LnxIcon :icon="providerCategories[provider.category]?.icon ?? 'lucide:hammer'" class="category-icon" />
				<div class="who">
					<strong>{{ provider.name }}</strong>
					<small>
						{{ providerCategories[provider.category]?.label }}
						<template v-if="provider.phone"> · {{ provider.phone }}</template>
						<template v-if="provider.email"> · {{ provider.email }}</template>
						<template v-if="provider.cif"> · NIF {{ provider.cif }}</template>
					</small>
				</div>
				<button
					type="button"
					class="rating"
					:aria-expanded="openedId === provider.id"
					:aria-label="`Valoraciones de ${provider.name}`"
					@click="toggle(provider)"
				>
					<span class="stars" :aria-label="`${averageRating(provider)?.toFixed(1) ?? 'Sin'} de 5`" :title="`${averageRating(provider)?.toFixed(1) ?? 'Sin'} de 5`">
						<LnxIcon v-for="n in 5" :key="n" icon="lucide:star" :class="{ filled: n <= stars(averageRating(provider)) }" />
					</span>
					<small class="tabular">({{ provider.ratingCount }})</small>
				</button>
				<div class="provider-actions">
					<LnxButton mode="clear" class="lnx-size-small" @click="edit(provider)">
						<LnxIcon icon="lucide:pencil" />
						Editar
					</LnxButton>
					<LnxButton v-if="canDelete(provider)" mode="clear" class="lnx-size-small" variant="danger" @click="remove(provider)">
						<LnxIcon icon="lucide:trash-2" />
						Eliminar
					</LnxButton>
				</div>

				<p v-if="provider.notes" class="hint wide">
					{{ provider.notes }}
				</p>
				<p class="hint wide">
					Compartido con {{ provider.communityIds.map(id => communityNames.get(id) ?? 'otra comunidad').join(', ') }}
				</p>

				<div v-if="openedId === provider.id" class="ratings wide">
					<form class="rate" @submit.prevent="rate(provider)">
						<LnxRadioGroup v-model="rating.score" :options="[1, 2, 3, 4, 5].map(n => ({ value: n, label: String(n), icon: 'lucide:star' }))">
							Tu valoración
						</LnxRadioGroup>
						<LnxTextarea v-model="rating.comment" rows="2">
							Comentario
						</LnxTextarea>
						<footer class="form-actions">
							<p v-if="ratingsError" class="error" role="alert">
								{{ ratingsError }}
							</p>
							<LnxButton type="submit" class="lnx-size-small">
								<LnxIcon icon="lucide:star" />
								Valorar
								<LnxKbd combo="mod+enter" />
							</LnxButton>
						</footer>
					</form>

					<ul v-if="ratingsLoading && !ratings.length" class="list" aria-busy="true" aria-label="Cargando valoraciones">
						<li v-for="width in [35, 50, 28]" :key="width" class="rating-item">
							<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
							<span class="lnx-skeleton lnx-skeleton--small wide" :style="{ width: `${width + 30}%` }" />
						</li>
					</ul>
					<ul v-else-if="ratings.length" class="list">
						<li v-for="item in ratings" :key="item.id" class="rating-item">
							<strong>{{ item.authorName }}</strong>
							<span class="stars" :aria-label="`${item.score} de 5`" :title="`${item.score} de 5`">
								<LnxIcon v-for="n in 5" :key="n" icon="lucide:star" :class="{ filled: n <= item.score }" />
							</span>
							<small class="hint tabular">
								{{ communityNames.get(item.communityId) ?? '' }}
								<template v-if="item.createdAt"> · {{ item.createdAt.toDate().toLocaleDateString('es') }}</template>
							</small>
							<p v-if="item.comment" class="wide">
								{{ item.comment }}
							</p>
						</li>
					</ul>
					<p v-else class="hint">
						Aún no tiene valoraciones.
					</p>
				</div>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			{{ providers.length ? 'Ningún proveedor coincide con la búsqueda.' : 'Aún no hay proveedores.' }}
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

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
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
	position: relative;
	display: flex;
	flex-direction: column;
}

// Filtering slides the rest into place; transitions, so typing fast turns them back halfway
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

.row-leave-active {
	position: absolute;
	width: 100%;
}

// Category, who, rating and actions, with notes, communities and ratings below
.provider {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-2) var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}

	.wide {
		grid-column: 1 / -1;
	}
}

.category-icon {
	color: var(--color-gray-6);
}

.who {
	display: flex;
	flex-direction: column;
	min-width: 0;

	strong {
		text-wrap: balance;
	}

	small {
		overflow: hidden;
		color: var(--color-gray-6);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.rating {
	padding: var(--lnx-spacing-1);
	border: 0;
	border-radius: var(--lnx-radius-2);
	background: none;
	color: var(--color-gray-6);
	display: inline-flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
	cursor: pointer;

	&:hover {
		background: var(--color-gray-2);
	}

	&:active {
		scale: var(--press-scale);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
	}
}

.stars {
	display: inline-flex;
	color: var(--color-gray-4);

	.filled {
		color: #E5A50A;
	}
}

.provider-actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: var(--lnx-spacing-1);
}

.ratings {
	padding: var(--lnx-spacing-4);
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-1);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.rate {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.rating-item {
	padding: var(--lnx-spacing-2) 0;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-1) var(--lnx-spacing-2);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}

	.wide {
		width: 100%;
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

@media (max-width: 640px) {
	// Rating and actions on their own row, so names keep the width
	.provider {
		grid-template-columns: auto minmax(0, 1fr);

		.rating,
		.provider-actions {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}
	}
}
</style>
