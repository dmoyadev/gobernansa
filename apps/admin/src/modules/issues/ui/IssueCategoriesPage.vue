<script setup lang="ts">
import type { IssueCategory, IssueCategoryColor } from '@gobernansa/shared/domain/issue.ts';
import { DEFAULT_ISSUE_CATEGORIES, getIssueCategories, issueCategoryColors, issueCategoryIcons, issueCategoryStyle } from '@gobernansa/shared/domain/issue.ts';
import { LnxButton, LnxIcon, LnxInput, LnxKbd, useConfirm, useShortcut } from 'lnxjs-components';
import { ref, toRaw, useTemplateRef } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import IconPicker from '@/app/ux/IconPicker.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { useSortable } from '@/app/ux/sortable.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { saveIssueCategories } from '../application/useIssues.ts';

const props = defineProps<{ id: string }>();

const ask = useConfirm();

const colors = Object.entries(issueCategoryColors) as [IssueCategoryColor, string][];

const loading = ref(true);
const loadError = ref<string>();
const categories = ref<IssueCategory[]>([]);

// What the form edits, a copy so cancelling leaves the category as it was
const newDraft = (): IssueCategory => ({ id: crypto.randomUUID(), name: '', icon: 'lucide:triangle-alert', color: 'gray', examples: '' });
const draft = ref(newDraft());
// The one being edited, none while adding a new one
const editingId = ref<string>();
const error = ref<string>();
const formElement = useTemplateRef<HTMLFormElement>('formElement');

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

function reset() {
	draft.value = newDraft();
	editingId.value = undefined;
	error.value = undefined;
}

const { open, show, close } = useNewForm(formElement, reset);

function edit(category: IssueCategory) {
	draft.value = structuredClone(toRaw(category));
	editingId.value = category.id;
	error.value = undefined;
	void show();
}

// The form closes at once and the list shows it. If the server rejects it, the form opens with it again
function save() {
	const { examples, ...category } = draft.value;
	// Without empty examples, Firestore doesn't take undefined
	const saved: IssueCategory = { ...category, name: category.name.trim(), ...(examples?.trim() ? { examples: examples.trim() } : {}) };
	if (categories.value.some(other => other.id !== saved.id && other.name.toLowerCase() === saved.name.toLowerCase())) {
		error.value = `Ya hay una categoría llamada «${saved.name}».`;
		return;
	}

	const sent = { draft: draft.value, editingId: editingId.value };
	const next = sent.editingId ? categories.value.map(other => other.id === saved.id ? saved : other) : [...categories.value, saved];
	close();
	persist(next, `${sent.editingId ? 'Actualizó' : 'Añadió'} la categoría de incidencias ${saved.name}`, sent.editingId ? 'Categoría guardada' : 'Categoría creada', undefined, () => {
		({ draft: draft.value, editingId: editingId.value } = sent);
		open.value = true;
	});
}

async function remove(category: IssueCategory) {
	if (categories.value.length === 1) {
		error.value = 'Tiene que quedar al menos una categoría, para que los vecinos puedan dar avisos.';
		return;
	}
	// Removed defaults still show with their name, see findIssueCategory()
	const kept = DEFAULT_ISSUE_CATEGORIES.some(other => other.id === category.id) ? 'con su nombre' : 'como «Sin categoría»';
	if (!await ask({ title: `¿Quitar «${category.name}»?`, message: `Los vecinos ya no la podrán elegir, y las incidencias que la tienen se verán ${kept}.`, confirmText: 'Quitar', variant: 'danger' })) {
		return;
	}

	if (editingId.value === category.id) {
		close();
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
	disabled: () => open.value,
	reorder: next => persist(next, 'Reordenó las categorías de incidencias', 'Orden guardado'),
});

// The list changes at once; if the server rejects it, it goes back and `reopen` puts back what was being edited
function persist(next: IssueCategory[], summary: string, done: string, revert?: () => Promise<unknown>, reopen?: () => void) {
	const previous = categories.value;
	categories.value = next;
	void optimistic(saveIssueCategories(props.id, next, summary), {
		done,
		failed: 'No se ha podido guardar',
		revert,
		onError: () => {
			categories.value = previous;
			reopen?.();
		},
	});
}

useShortcut('mod+enter', () => formElement.value?.requestSubmit(), { description: 'Guardar la categoría' });
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}/issues`" label="Volver a las incidencias" />
		<h1>Categorías de incidencias</h1>
		<NewButton v-if="!open" label="Nueva categoría" :disabled="loading || (!!loadError && !categories.length)" @click="show()" />
	</header>

	<p class="hint">
		Los vecinos eligen una al dar un aviso, en este orden. Cambiar el nombre de una la cambia en todas sus incidencias.
	</p>
	<p v-if="loadError && !categories.length" class="error" role="alert">
		{{ loadError }}
	</p>
	<p v-else-if="error && !open" class="error" role="alert">
		{{ error }}
	</p>

	<!-- In the category's colors, as neighbours see it -->
	<form v-if="open" ref="formElement" class="card form lnx-appear" :style="issueCategoryStyle(draft)" @submit.prevent="save()">
		<h2>{{ editingId ? 'Editar categoría' : 'Nueva categoría' }}</h2>
		<div class="fields">
			<div class="named">
				<IconPicker v-model="draft.icon" :options="issueCategoryIcons" />
				<LnxInput v-model="draft.name" autofocus placeholder="Mantenimiento, ascensor, plagas…" required maxlength="40">
					Nombre
				</LnxInput>
			</div>
			<LnxInput v-model="draft.examples" placeholder="Luces, puertas, fugas…" maxlength="80">
				Ejemplos
				<template #helper>
					Para ayudar a los vecinos a elegirla
				</template>
			</LnxInput>
		</div>

		<fieldset class="colors">
			<legend>Color</legend>
			<label v-for="[color, label] in colors" :key="color" :title="label" :style="issueCategoryStyle({ color })">
				<input v-model="draft.color" type="radio" class="sr-only" name="color" :value="color" :aria-label="label">
				<span class="swatch" />
			</label>
		</fieldset>

		<footer class="form-actions">
			<p v-if="error" class="error" role="alert">
				{{ error }}
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

	<ul v-if="loading" class="card list" aria-busy="true">
		<li v-for="width in [30, 45, 25, 38]" :key="width" class="row">
			<span class="lnx-skeleton lnx-skeleton--circle icon" />
			<span class="name">
				<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
				<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width + 20}%`, marginTop: '4px' }" />
			</span>
		</li>
	</ul>

	<TransitionGroup v-else-if="!loadError || categories.length" tag="ul" name="row" class="card list sortable lnx-appear" :class="{ sorting }">
		<li
			v-for="category in categories"
			:key="category.id"
			:data-id="category.id"
			:class="rowClass(category)"
			:style="[rowStyle(category), issueCategoryStyle(category)]"
		>
			<div class="row">
				<button
					type="button"
					class="handle"
					title="Reordenar"
					:aria-label="`Reordenar ${category.name}, con las flechas arriba y abajo`"
					:disabled="open || categories.length < 2"
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
					<LnxButton mode="clear" shape="circle" :aria-label="`Editar ${category.name}`" :title="`Editar ${category.name}`" @click="edit(category)">
						<LnxIcon icon="lucide:pencil" />
					</LnxButton>
					<LnxButton mode="clear" shape="circle" variant="danger" :aria-label="`Quitar ${category.name}`" :title="`Quitar ${category.name}`" @click="remove(category)">
						<LnxIcon icon="lucide:trash-2" />
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
}

// Above the list, as the other pages' forms
form.card {
	margin-bottom: var(--lnx-spacing-5);
	padding: var(--lnx-spacing-5);
	gap: var(--lnx-spacing-4);

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

// The icon beside the name, at the height of its input, in the category's colors
.named {
	display: flex;
	align-items: flex-end;
	gap: var(--lnx-spacing-3);
	--icon-bg: var(--cat-color-bg);
	--icon-color: var(--cat-color);

	> :last-child {
		flex: 1;
		min-width: 0;
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
		margin-bottom: 0;
	}
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
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
}

.colors {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);

	legend {
		width: 100%;
		margin-bottom: var(--lnx-spacing-1);
		font-size: var(--lnx-font-size-small);
	}

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
