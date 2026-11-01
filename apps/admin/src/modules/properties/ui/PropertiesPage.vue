<script setup lang="ts">
import type { Property } from '@gobernansa/shared/domain/property.ts';
import { formatCoefficient, propertyTypeIcons, propertyTypeLabels, totalCoefficient } from '@gobernansa/shared/domain/property.ts';
import { normalize } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import { newId } from '@/app/ux/navigation.ts';
import { useEventListener, useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { usePeople } from '@/modules/people/application/usePeople.ts';
import { deleteProperty, restoreProperty, saveProperty, toPropertyForm, useProperties } from '../application/useProperties.ts';

const props = defineProps<{ id: string }>();

const typeOptions = Object.entries(propertyTypeLabels).map(([value, label]) => ({ value: value as Property['type'], label }));
const types = Object.keys(propertyTypeLabels) as Property['type'][];

const { data: properties, pending, error } = useProperties(props.id);
// Owners with an account are picked from the community's, the rest are typed in
const { people } = usePeople(props.id);
const ownerOptions = computed(() => [
	{ value: '', label: 'Sin cuenta en gobernança' },
	...[...people.value].sort((a, b) => a.name.localeCompare(b.name, 'es')).map(person => ({ value: person.id, label: `${person.name} (${person.email})` })),
]);

// Deeds should add up to 100, a gap usually means a property is missing or mistyped
const total = computed(() => totalCoefficient(properties.value));

const typeFilter = ref<Property['type'] | ''>('');
const search = ref('');
// By type, then by name with numbers in order (2A before 10A). Empty types are left out
const groups = computed(() => {
	const words = normalize(search.value).split(' ').filter(Boolean);
	const matching = properties.value
		.filter(property => !typeFilter.value || property.type === typeFilter.value)
		.filter((property) => {
			const text = normalize([property.name, property.ownerName, property.ownerEmail, property.tenantName, property.tenantEmail].join(' '));
			return words.every(word => text.includes(word));
		})
		.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
	return types
		.map(type => ({ type, properties: matching.filter(property => property.type === type) }))
		.filter(group => group.properties.length);
});

const form = ref(toPropertyForm());
// The one being edited, none while adding a new one
const editingId = ref<string>();
// The new one's id, made with the form so sending it twice writes the same property
let createId = newId();
const formElement = useTemplateRef<HTMLFormElement>('formElement');
const searchInput = useTemplateRef<HTMLElement>('searchInput');

function edit(property: Property) {
	editingId.value = property.id;
	form.value = toPropertyForm(property);
	window.scrollTo({ top: 0, behavior: 'smooth' });
}

function reset() {
	editingId.value = undefined;
	form.value = toPropertyForm();
}

// The form empties at once, the list shows it from the local cache. If the server rejects it, the form gets it back
function save() {
	// The account's name and email are copied, so the census reads without loading the accounts
	const owner = people.value.find(person => person.id === form.value.ownerUid);
	const sent = { form: form.value, editingId: editingId.value, createId };
	const action = saveProperty(props.id, editingId.value, {
		...form.value,
		coefficient: String(form.value.coefficient ?? ''),
		...(owner ? { ownerName: owner.name, ownerEmail: owner.email } : {}),
	}, createId);
	reset();
	createId = newId();
	void optimistic(action, {
		done: sent.editingId ? 'Propiedad guardada' : 'Propiedad añadida',
		failed: 'No se ha podido guardar',
		onError: () => {
			({ form: form.value, editingId: editingId.value, createId } = sent);
		},
	});
}

useShortcut('n', () => formElement.value?.querySelector('input')?.focus(), 'Añadir una propiedad');
useShortcut('mod+enter', () => formElement.value?.requestSubmit(), 'Guardar la propiedad');
useShortcut('/', () => searchInput.value?.querySelector('input')?.focus(), 'Buscar en el censo');
// Only while editing, so Esc keeps closing whatever else is open otherwise
useEventListener(window, 'keydown', (event) => {
	if (event.key === 'Escape' && editingId.value && !event.defaultPrevented) {
		reset();
	}
});

function remove(property: Property) {
	// eslint-disable-next-line no-alert
	if (!window.confirm(`¿Borrar «${property.name}»?`)) {
		return;
	}

	if (editingId.value === property.id) {
		reset();
	}
	void optimistic(deleteProperty(property), {
		done: 'Propiedad borrada',
		failed: 'No se ha podido borrar',
		revert: async () => restoreProperty(property),
	});
}

function ownerLabel(property: Property) {
	if (property.ownerName) {
		return property.ownerUid ? property.ownerName : `${property.ownerName} (sin cuenta)`;
	}
	return property.ownerUid ? 'Propietario con cuenta' : 'Sin propietario';
}
</script>

<template>
	<header class="page-header">
		<BackButton :to="`/communities/${id}`" label="Volver a la comunidad" />
		<h1>Propiedades</h1>
	</header>

	<form ref="formElement" class="card" @submit.prevent="save()">
		<h2>{{ editingId ? 'Editar propiedad' : 'Nueva propiedad' }} <Kbd v-if="!editingId" combo="n" /></h2>
		<div class="fields">
			<LnxInput v-model="form.name" placeholder="2A, Plaza 14…" required>
				Nombre
			</LnxInput>
			<LnxSelect
				v-model.convert="form.type"
				:options="typeOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Tipo
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ propertyTypeLabels[value as Property['type']] }}
				</template>
			</LnxSelect>
			<LnxInput v-model="form.coefficient" type="number" min="0" max="100" step="0.0001" placeholder="3,25">
				Coeficiente de participación (%)
			</LnxInput>
			<LnxSelect
				v-model.convert="form.ownerUid"
				class="wide"
				:options="ownerOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
				placeholder="Sin cuenta en gobernança"
			>
				Propietario
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ ownerOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
			<template v-if="!form.ownerUid">
				<LnxInput v-model="form.ownerName">
					Nombre del propietario
				</LnxInput>
				<LnxInput v-model="form.ownerEmail" type="email">
					Email del propietario
				</LnxInput>
			</template>
			<LnxInput v-model="form.ownerNif" placeholder="Para el modelo 184">
				NIF del propietario
			</LnxInput>
			<LnxInput v-model="form.tenantName">
				Inquilino (si está alquilada)
			</LnxInput>
			<LnxInput v-model="form.tenantEmail" type="email">
				Email del inquilino
			</LnxInput>
		</div>

		<footer class="form-actions">
			<LnxButton v-if="editingId" mode="clear" @click="reset()">
				Cancelar
				<Kbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit">
				<LnxIcon :icon="editingId ? 'lucide:save' : 'lucide:plus'" />
				{{ editingId ? 'Guardar cambios' : 'Añadir' }}
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>Censo</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>
		<p v-if="properties.length" class="tabular" :class="total === 100 ? 'hint' : 'warning'" :role="total === 100 ? undefined : 'status'">
			<LnxIcon :icon="total === 100 ? 'lucide:circle-check' : 'lucide:triangle-alert'" :size="16" />
			{{ properties.length }} propiedades · los coeficientes suman {{ total.toLocaleString('es') }} %{{ total === 100 ? '' : ', deberían sumar 100 %' }}
		</p>

		<div class="filters">
			<div ref="searchInput">
				<LnxInput v-model="search" type="search" placeholder="Nombre, propietario o inquilino">
					Buscar <Kbd combo="/" />
				</LnxInput>
			</div>
			<fieldset class="chips">
				<legend>Tipo</legend>
				<label>
					<input v-model="typeFilter" type="radio" class="sr-only" value="">
					<span>Todas</span>
				</label>
				<label v-for="type in types" :key="type">
					<input v-model="typeFilter" type="radio" class="sr-only" :value="type">
					<span>{{ propertyTypeLabels[type] }}</span>
				</label>
			</fieldset>
		</div>

		<ul v-if="pending && !properties.length" class="list" aria-busy="true">
			<li v-for="width in [20, 28, 16, 24]" :key="width" class="item">
				<span class="skeleton-item skeleton-item--icon" />
				<div class="what">
					<span class="skeleton-item" :style="{ width: `${width}%` }" />
					<span class="skeleton-item skeleton-item--small" :style="{ width: `${width + 30}%` }" />
				</div>
				<span class="skeleton-item skeleton-item--icon" />
			</li>
		</ul>
		<TransitionGroup v-else-if="groups.length" tag="div" name="row" class="groups ux-appear">
			<section v-for="group in groups" :key="group.type">
				<h3 class="tabular">
					{{ propertyTypeLabels[group.type] }} · {{ group.properties.length }} · {{ totalCoefficient(group.properties).toLocaleString('es') }} %
				</h3>
				<TransitionGroup tag="ul" name="row" class="list">
					<li v-for="property in group.properties" :key="property.id" class="item">
						<LnxIcon class="type" :icon="propertyTypeIcons[property.type] ?? 'lucide:map-pin'" :size="20" />
						<div class="what">
							<strong>{{ property.name }}<template v-if="property.coefficient !== undefined"> · <span class="tabular">{{ formatCoefficient(property.coefficient) }}</span></template></strong>
							<small>
								{{ ownerLabel(property) }}<template v-if="property.tenantName"> · Inquilino: {{ property.tenantName }}</template>
							</small>
						</div>
						<div class="item-actions">
							<LnxButton mode="clear" size="small" shape="circle" aria-label="Editar" title="Editar" @click="edit(property)">
								<LnxIcon icon="lucide:pencil" />
							</LnxButton>
							<LnxButton mode="clear" size="small" shape="circle" variant="danger" aria-label="Borrar" title="Borrar" @click="remove(property)">
								<LnxIcon icon="lucide:trash-2" />
							</LnxButton>
						</div>
					</li>
				</TransitionGroup>
			</section>
		</TransitionGroup>
		<p v-else class="hint">
			{{ properties.length ? 'Ninguna propiedad coincide.' : 'Aún no hay propiedades.' }}
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
	display: flex;
	flex-direction: column;
}

.item {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}

	.type {
		color: var(--color-primary);
	}
}

.what {
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

.item-actions {
	display: flex;
	gap: var(--lnx-spacing-1);
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

h3 {
	margin-top: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	color: var(--color-gray-6);
}

.filters {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
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
		min-height: 36px;
		padding: 0 var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-4);
		border-radius: var(--lnx-radius-2);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		cursor: pointer;
		transition: background-color var(--duration) var(--ease-out), border-color var(--duration) var(--ease-out), color var(--duration) var(--ease-out), scale var(--duration-fast) var(--ease-out);
	}

	label:hover input:not(:checked) + span {
		background: var(--color-gray-1);
	}

	label:active span {
		scale: var(--press-scale);
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

.hint,
.warning {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
}

.warning {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

.groups {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
}

// Rows and groups coming and going as the filters change, interruptible as they're transitions
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
