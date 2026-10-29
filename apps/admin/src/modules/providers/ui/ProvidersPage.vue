<script setup lang="ts">
import type { Provider, ProviderCategory, ProviderRating } from '@gobernansa/shared/domain/provider.ts';
import type { ProviderForm } from '../application/providerActions.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { averageRating, providerCategories } from '@gobernansa/shared/domain/provider.ts';
import { managesCommunity } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { deleteProvider, loadRatings, rateProvider, saveProvider } from '../application/providerActions.ts';
import { useProviders } from '../application/useProviders.ts';

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
		&& (!text || [provider.name, provider.phone, provider.email, provider.cif, provider.notes].some(field => field?.toLocaleLowerCase('es').includes(text))));
});

function emptyForm(): ProviderForm {
	// Shared with all of theirs unless they say otherwise
	return { name: '', category: 'plumbing', phone: '', email: '', cif: '', notes: '', communityIds: communities.value.map(community => community.id) };
}

const form = ref<ProviderForm>(emptyForm());
const editingId = ref<string>();
const saving = ref(false);
const formError = ref<string>();

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
}

function edit(provider: Provider) {
	editingId.value = provider.id;
	form.value = {
		name: provider.name,
		category: provider.category,
		phone: provider.phone ?? '',
		email: provider.email ?? '',
		cif: provider.cif ?? '',
		notes: provider.notes ?? '',
		// Only the ones they manage show as chips, the rest are kept as they are
		communityIds: provider.communityIds.filter(id => managesCommunity(me.value, id)),
	};
	formError.value = undefined;
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function save() {
	// The ones they don't manage count too, so a manager can stop sharing one an administrator also shares it with
	const original = providers.value.find(provider => provider.id === editingId.value);
	const others = original?.communityIds.filter(id => !managesCommunity(me.value, id)) ?? [];
	const communityIds = [...others, ...form.value.communityIds];
	if (!communityIds.length) {
		formError.value = 'Compártelo al menos con una comunidad.';
		return;
	}

	saving.value = true;
	formError.value = undefined;
	try {
		await saveProvider(editingId.value, { ...form.value, communityIds });
		reset();
	} catch (e) {
		formError.value = `No se ha podido guardar: ${(e as Error).message}`;
	} finally {
		saving.value = false;
	}
}

const actionError = ref<string>();

async function remove(provider: Provider) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Eliminar ${provider.name} del directorio de todas sus comunidades?`)) {
		return;
	}

	actionError.value = undefined;
	try {
		await deleteProvider(provider.id);
		if (editingId.value === provider.id) {
			reset();
		}
	} catch (e) {
		actionError.value = `No se ha podido eliminar: ${(e as Error).message}`;
	}
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
const ratingSaving = ref(false);

async function refreshRatings(providerId: string) {
	ratingsLoading.value = true;
	ratingsError.value = undefined;
	try {
		const loaded = await loadRatings(providerId);
		// Another one may have been opened meanwhile
		if (openedId.value !== providerId) {
			return;
		}
		ratings.value = loaded;
		const mine = ratings.value.find(item => item.authorId === me.value?.id);
		rating.value = { score: mine?.score ?? 5, comment: mine?.comment ?? '' };
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

async function rate(provider: Provider) {
	// From the first of its communities the user manages, to know where the experience comes from
	const communityId = provider.communityIds.find(id => managesCommunity(me.value, id)) ?? provider.communityIds[0];
	ratingSaving.value = true;
	ratingsError.value = undefined;
	try {
		await rateProvider(provider, { ...rating.value, communityId, authorName: me.value?.name ?? '' });
		await refreshRatings(provider.id);
	} catch (e) {
		ratingsError.value = `No se ha podido guardar la valoración: ${(e as Error).message}`;
	} finally {
		ratingSaving.value = false;
	}
}
</script>

<template>
	<header class="page-header">
		<LnxButton to="/" mode="clear" shape="circle" aria-label="Volver a comunidades">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>Proveedores</h1>
	</header>

	<form class="card" @submit.prevent="save()">
		<h2>{{ editingId ? 'Editar proveedor' : 'Añadir proveedor' }}</h2>
		<div class="fields">
			<LnxInput v-model="form.name" required>
				Nombre
			</LnxInput>
			<LnxSelect
				v-model.convert="form.category"
				:options="categoryOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
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
			<LnxInput v-model="form.cif">
				CIF
			</LnxInput>
			<label class="textarea wide">
				Notas
				<textarea v-model="form.notes" rows="2" />
			</label>
		</div>

		<fieldset class="chips">
			<legend>Compartido con</legend>
			<label v-for="community in communities" :key="community.id">
				<input v-model="form.communityIds" type="checkbox" class="sr-only" :value="community.id">
				<span>{{ community.name || 'Sin nombre' }}</span>
			</label>
		</fieldset>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton v-if="editingId" mode="clear" @click="reset()">
				Cancelar
			</LnxButton>
			<LnxButton type="submit" :is-loading="saving">
				<LnxIcon :icon="editingId ? 'lucide:save' : 'lucide:plus'" />
				{{ editingId ? 'Guardar cambios' : 'Añadir' }}
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Directorio</h2>
		<div class="fields">
			<LnxInput v-model="search" type="search">
				Buscar
			</LnxInput>
			<LnxSelect
				v-model.convert="category"
				:options="filterOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
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
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<span v-if="loading" class="skeleton-item" />
		<ul v-else-if="visibleProviders.length" class="list">
			<li v-for="provider in visibleProviders" :key="provider.id" class="provider">
				<LnxIcon :icon="providerCategories[provider.category]?.icon ?? 'lucide:hammer'" class="category-icon" />
				<div class="who">
					<strong>{{ provider.name }}</strong>
					<small>
						{{ providerCategories[provider.category]?.label }}
						<template v-if="provider.phone"> · {{ provider.phone }}</template>
						<template v-if="provider.email"> · {{ provider.email }}</template>
						<template v-if="provider.cif"> · CIF {{ provider.cif }}</template>
					</small>
				</div>
				<button
					type="button"
					class="rating"
					:aria-expanded="openedId === provider.id"
					:aria-label="`Valoraciones de ${provider.name}`"
					@click="toggle(provider)"
				>
					<span class="stars" :aria-label="`${averageRating(provider)?.toFixed(1) ?? 'Sin'} de 5`">
						<LnxIcon v-for="n in 5" :key="n" icon="lucide:star" :class="{ filled: n <= stars(averageRating(provider)) }" />
					</span>
					<small>({{ provider.ratingCount }})</small>
				</button>
				<div class="provider-actions">
					<LnxButton mode="clear" size="small" @click="edit(provider)">
						<LnxIcon icon="lucide:pencil" />
						Editar
					</LnxButton>
					<LnxButton v-if="canDelete(provider)" mode="clear" size="small" variant="danger" @click="remove(provider)">
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
						<fieldset class="chips">
							<legend>Tu valoración</legend>
							<label v-for="n in 5" :key="n">
								<input v-model="rating.score" type="radio" class="sr-only" :value="n" :name="`score-${provider.id}`">
								<span>{{ n }} <LnxIcon icon="lucide:star" /></span>
							</label>
						</fieldset>
						<label class="textarea">
							Comentario
							<textarea v-model="rating.comment" rows="2" />
						</label>
						<footer class="form-actions">
							<p v-if="ratingsError" class="error" role="alert">
								{{ ratingsError }}
							</p>
							<LnxButton type="submit" size="small" :is-loading="ratingSaving">
								<LnxIcon icon="lucide:star" />
								Valorar
							</LnxButton>
						</footer>
					</form>

					<span v-if="ratingsLoading" class="skeleton-item" />
					<ul v-else-if="ratings.length" class="list">
						<li v-for="item in ratings" :key="item.id" class="rating-item">
							<strong>{{ item.authorName }}</strong>
							<span class="stars" :aria-label="`${item.score} de 5`">
								<LnxIcon v-for="n in 5" :key="n" icon="lucide:star" :class="{ filled: n <= item.score }" />
							</span>
							<small class="hint">
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
		</ul>
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

.textarea {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);
	font-size: var(--lnx-font-size-small);

	textarea {
		padding: var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		font: inherit;
		font-size: var(--lnx-font-size-body);
		resize: vertical;

		&:focus-visible {
			outline: 2px solid var(--color-primary);
			outline-offset: 1px;
		}
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
	display: flex;
	flex-direction: column;
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
