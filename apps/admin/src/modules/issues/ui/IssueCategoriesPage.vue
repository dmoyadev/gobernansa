<script setup lang="ts">
import type { IssueCategory, IssueCategoryColor } from '@gobernansa/shared/domain/issue.ts';
import { DEFAULT_ISSUE_CATEGORIES, getIssueCategories, issueCategoryColors, issueCategoryIcons, issueCategoryStyle } from '@gobernansa/shared/domain/issue.ts';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { nextTick, ref, toRaw } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import IconPicker from '@/app/ux/IconPicker.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { useSortable } from '@/app/ux/sortable.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { saveIssueCategories } from '../application/useIssues.ts';

const props = defineProps<{ id: string }>();

const colors = Object.entries(issueCategoryColors) as [IssueCategoryColor, string][];

const loading = ref(true);
const loadError = ref<string>();
const categories = ref<IssueCategory[]>([]);

// The one being edited, a copy so cancelling leaves it as it was
interface Draft extends IssueCategory { isNew?: boolean }
const draft = ref<Draft>();
const error = ref<string>();

// Read again when the page comes back, the last one shown meanwhile
function load() {
	return loadCommunity(props.id)
		.then((community) => {
			categories.value = structuredClone(getIssueCategories(community));
			loadError.value = undefined;
		})
		.catch((e: Error) => loadError.value = `No se ha podido cargar la comunidad: ${e.message}`)
		.finally(() => loading.value = false);
}

void load();
onRevalidate(load);

async function edit(category: IssueCategory) {
	draft.value = structuredClone(toRaw(category));
	error.value = undefined;
	await nextTick();
	document.querySelector<HTMLInputElement>('.editing input')?.focus();
}

async function create() {
	if (draft.value?.isNew) {
		document.querySelector<HTMLInputElement>('.editing input')?.focus();
		return;
	}
	await edit({ id: crypto.randomUUID(), name: '', icon: 'lucide:triangle-alert', color: 'gray', examples: '' });
	draft.value!.isNew = true;
}

function cancel() {
	draft.value = undefined;
	error.value = undefined;
}

function save() {
	const { isNew, examples, ...category } = draft.value!;
	// Without empty examples, Firestore doesn't take undefined
	const saved: IssueCategory = { ...category, name: category.name.trim(), ...(examples?.trim() ? { examples: examples.trim() } : {}) };
	if (categories.value.some(other => other.id !== saved.id && other.name.toLowerCase() === saved.name.toLowerCase())) {
		error.value = `Ya hay una categoría llamada «${saved.name}».`;
		return;
	}

	const next = isNew ? [...categories.value, saved] : categories.value.map(other => other.id === saved.id ? saved : other);
	persist(next, `${isNew ? 'Añadió' : 'Actualizó'} la categoría de incidencias ${saved.name}`, isNew ? 'Categoría creada' : 'Categoría guardada');
}

function remove(category: IssueCategory) {
	if (categories.value.length === 1) {
		error.value = 'Tiene que quedar al menos una categoría, para que los vecinos puedan dar avisos.';
		return;
	}
	// Removed defaults still show with their name, see findIssueCategory()
	const kept = DEFAULT_ISSUE_CATEGORIES.some(other => other.id === category.id) ? 'con su nombre' : 'como «Sin categoría»';
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Quitar «${category.name}»? Los vecinos ya no la podrán elegir, y las incidencias que la tienen se verán ${kept}.`)) {
		return;
	}

	const index = categories.value.findIndex(other => other.id === category.id);
	// Back where it was, among the categories as they are by then
	persist(categories.value.filter(other => other.id !== category.id), `Quitó la categoría de incidencias ${category.name}`, 'Categoría quitada', async () => {
		const previous = categories.value;
		const restored = previous.filter(other => other.id !== category.id);
		restored.splice(index, 0, category);
		categories.value = restored;
		try {
			await saveIssueCategories(props.id, restored, `Restauró la categoría de incidencias ${category.name}`);
		} catch (e) {
			categories.value = previous;
			throw e;
		}
	});
}

// Neighbours see them in this order when reporting
const { sorting, rowStyle, rowClass, handleEvents } = useSortable(categories, {
	disabled: () => !!draft.value,
	reorder: next => persist(next, 'Reordenó las categorías de incidencias', 'Orden guardado'),
});

// The list changes at once; if the server rejects it, it goes back and what was being edited is open again
function persist(next: IssueCategory[], summary: string, done: string, revert?: () => Promise<unknown>) {
	const previous = categories.value;
	const editing = draft.value;
	categories.value = next;
	draft.value = undefined;
	error.value = undefined;
	void optimistic(saveIssueCategories(props.id, next, summary), {
		done,
		failed: 'No se ha podido guardar',
		revert,
		onError: () => {
			categories.value = previous;
			draft.value ??= editing;
		},
	});
}

useShortcut('n', () => void create(), 'Crear una categoría');
useShortcut('mod+enter', () => document.querySelector<HTMLFormElement>('form.editing')?.requestSubmit(), 'Guardar la categoría');
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}/issues`" label="Volver a las incidencias" />
		<h1>Categorías de incidencias</h1>
		<LnxButton :disabled="loading || (!!loadError && !categories.length) || !!draft?.isNew" @click="create()">
			<LnxIcon icon="lucide:plus" />
			Crear
			<Kbd combo="n" />
		</LnxButton>
	</header>

	<p class="hint">
		Los vecinos eligen una al dar un aviso, en este orden. Cambiar el nombre de una la cambia en todas sus incidencias.
	</p>
	<p v-if="loadError && !categories.length" class="error" role="alert">
		{{ loadError }}
	</p>
	<p v-else-if="error && !draft" class="error" role="alert">
		{{ error }}
	</p>

	<ul v-if="loading" class="card list" aria-busy="true">
		<li v-for="width in [30, 45, 25, 38]" :key="width" class="row">
			<span class="skeleton-item skeleton-item--icon icon" />
			<span class="name">
				<span class="skeleton-item" :style="{ width: `${width}%` }" />
				<span class="skeleton-item skeleton-item--small" :style="{ width: `${width + 20}%`, marginTop: '4px' }" />
			</span>
		</li>
	</ul>

	<TransitionGroup v-else-if="!loadError || categories.length" tag="ul" name="row" class="card list sortable ux-appear" :class="{ sorting }">
		<li
			v-for="category in draft?.isNew ? [...categories, draft] : categories"
			:key="category.id"
			:data-id="category.id"
			:class="rowClass(category)"
			:style="[rowStyle(category), issueCategoryStyle(draft?.id === category.id ? draft : category)]"
		>
			<form v-if="draft?.id === category.id" class="row editing" @submit.prevent="save()" @keydown.esc="cancel()">
				<IconPicker v-model="draft.icon" :options="issueCategoryIcons" />

				<div class="fields">
					<LnxInput v-model="draft.name" placeholder="Mantenimiento, ascensor, plagas…" aria-label="Nombre" required maxlength="40" />
					<LnxInput v-model="draft.examples" placeholder="Ejemplos, para ayudar a elegirla: luces, puertas, fugas…" aria-label="Ejemplos" maxlength="80" />
				</div>

				<fieldset class="colors">
					<legend class="sr-only">
						Color
					</legend>
					<label v-for="[color, label] in colors" :key="color" :title="label" :style="issueCategoryStyle({ color })">
						<input v-model="draft.color" type="radio" class="sr-only" name="color" :value="color" :aria-label="label">
						<span class="swatch" />
					</label>
				</fieldset>

				<div class="actions">
					<LnxButton
						v-if="!draft.isNew"
						type="button"
						mode="clear"
						shape="circle"
						variant="danger"
						:aria-label="`Quitar ${category.name}`"
						:title="`Quitar ${category.name}`"
						@click="remove(category)"
					>
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
					<LnxButton type="button" mode="clear" size="small" @click="cancel()">
						Cancelar
					</LnxButton>
					<LnxButton type="submit" size="small">
						<LnxIcon icon="lucide:check" />
						Guardar
						<Kbd combo="mod+enter" />
					</LnxButton>
				</div>
				<p v-if="error" class="error wide" role="alert">
					{{ error }}
				</p>
			</form>

			<div v-else class="row">
				<button
					type="button"
					class="handle"
					title="Reordenar"
					:aria-label="`Reordenar ${category.name}, con las flechas arriba y abajo`"
					:disabled="!!draft || categories.length < 2"
					v-on="handleEvents(category)"
				>
					<LnxIcon icon="lucide:grip-vertical" :size="18" />
				</button>
				<span class="icon">
					<LnxIcon :icon="category.icon" :size="20" />
				</span>
				<span class="name">
					<strong>{{ category.name }}</strong>
					<small v-if="category.examples">{{ category.examples }}</small>
				</span>
				<div class="actions">
					<LnxButton
						mode="clear"
						shape="circle"
						:aria-label="`Editar ${category.name}`"
						:title="`Editar ${category.name}`"
						:disabled="!!draft"
						@click="edit(category)"
					>
						<LnxIcon icon="lucide:pencil" />
					</LnxButton>
				</div>
			</div>
		</li>
	</TransitionGroup>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-2);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		font-size: var(--lnx-font-size-title);
	}
}

.hint {
	margin-bottom: var(--lnx-spacing-5);
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.card {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
}

.list > li + li {
	border-top: 1px solid var(--color-gray-3);
}

.row {
	min-height: 64px;
	padding: var(--lnx-spacing-3) 0;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-3);

	// The picker in the category's colors, as neighbours see it
	--icon-bg: var(--cat-color-bg);
	--icon-color: var(--cat-color);
}

.icon {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	border-radius: var(--lnx-radius-circle);
	background: var(--cat-color-bg, var(--color-gray-2));
	color: var(--cat-color, var(--color-primary));
}

.name {
	flex: 1 1 200px;
	min-width: 0;
	display: flex;
	flex-direction: column;

	strong {
		color: var(--color-gray-9);
		text-wrap: balance;
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

.fields {
	flex: 1 1 260px;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.colors {
	display: flex;
	gap: var(--lnx-spacing-1);

	label {
		display: flex;
		padding: 4px;
		border-radius: var(--lnx-radius-circle);
		cursor: pointer;

		&:has(:focus-visible) {
			outline: 2px solid var(--color-primary);
		}
	}

	.swatch {
		width: 20px;
		height: 20px;
		border: 2px solid var(--cat-color-bg);
		border-radius: var(--lnx-radius-circle);
		background: var(--cat-color);
		transition: scale var(--duration-fast) var(--ease-out);
	}

	label:hover .swatch {
		scale: 1.1;
	}

	:checked + .swatch {
		box-shadow: 0 0 0 2px var(--color-gray-0), 0 0 0 4px var(--cat-color);
	}
}

.actions {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
}

.wide {
	flex-basis: 100%;
}

// Created or removed, the others make room
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

.error {
	margin-bottom: var(--lnx-spacing-3);
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
