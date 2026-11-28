<script setup lang="ts">
import type { IssueSuggestion } from '@gobernansa/shared/application/writing.ts';
import type { Issue } from '@gobernansa/shared/domain/issue.ts';
import type { Provider } from '@gobernansa/shared/domain/provider.ts';
import type { useIssue } from '../application/useIssues.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { providerCategories } from '@gobernansa/shared/domain/provider.ts';
import { LnxAvatar, LnxButton, LnxDatePicker, LnxIcon, LnxKbd, LnxSelect, LnxTextarea, useEventListener } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { optimistic } from '@/app/ux/toast.ts';

// The provider box of an issue: who fixes it and by when, with an internal note
const props = defineProps<{
	issue: Issue;
	note?: string;
	providers: Provider[];
	// The one assigned, as it is in the directory
	assignedProvider?: Provider;
	// To send them what to fix from the mail app, with what's saved
	providerMail?: string;
	overdue: boolean;
	// Its trade's providers come first
	suggestion?: IssueSuggestion;
	assign: ReturnType<typeof useIssue>['assign'];
}>();

// Shown as a card once someone is assigned, the form only to change it
const editingAssignment = defineModel<boolean>('editing', { required: true });

const { user: me } = useAuth();

// Filled with what's saved each time it changes, also after saving
const assignment = ref({ providerId: '', expectedAt: '', note: '' });
function resetAssignment() {
	assignment.value = {
		providerId: props.issue.provider?.id ?? '',
		expectedAt: props.issue.expectedAt ? toDateString(props.issue.expectedAt.toDate()) : '',
		note: props.note ?? '',
	};
}
// Not while it's being edited, so what's typed stays when a save fails and goes back
watch(() => [props.issue.provider?.id, props.issue.expectedAt?.toMillis(), props.note], () => {
	if (!editingAssignment.value) {
		resetAssignment();
	}
}, { immediate: true });

const sortedProviders = computed(() => {
	const trade = props.suggestion?.provider;
	return trade && trade !== 'other' ? [...props.providers].sort((a, b) => Number(b.category === trade) - Number(a.category === trade)) : props.providers;
});

const providerOptions = computed(() => [{ value: '', label: 'Sin asignar' }, ...sortedProviders.value.map(provider => ({ value: provider.id, label: provider.name }))]);
const selectedProvider = computed(() => props.providers.find(provider => provider.id === assignment.value.providerId));

function saveAssignment() {
	const values = { ...assignment.value };
	const { providerId, expectedAt, note } = values;
	// A provider removed from the directory stays assigned until it's changed
	const provider = selectedProvider.value ?? (providerId === props.issue.provider?.id ? props.issue.provider : undefined);
	editingAssignment.value = false;
	void optimistic(props.assign(me.value!, provider, expectedAt ? new Date(`${expectedAt}T00:00`) : undefined, note.trim()), {
		done: provider ? 'Asignada' : 'Proveedor quitado',
		failed: 'No se ha podido guardar la asignación',
		onError: () => {
			editingAssignment.value = true;
			assignment.value = values;
		},
	});
}

const quickDates = [{ label: 'Hoy', days: 0 }, { label: 'Mañana', days: 1 }, { label: 'En 3 días', days: 3 }, { label: 'En una semana', days: 7 }];

function setExpectedIn(days: number) {
	const date = new Date();
	date.setDate(date.getDate() + days);
	assignment.value.expectedAt = toDateString(date);
}

function formatDate(date: Date) {
	return date.toLocaleString('es', { dateStyle: 'medium' });
}

// Escape drops the changes. Handled, so the insurance form stays open
useEventListener(window, 'keydown', (event) => {
	if (event.key === 'Escape' && !event.defaultPrevented && editingAssignment.value) {
		event.preventDefault();
		resetAssignment();
		editingAssignment.value = false;
	}
});
</script>

<template>
	<section class="card box">
		<header class="box-header">
			<span class="box-icon provider-icon"><LnxIcon icon="lucide:hard-hat" :size="18" /></span>
			<h2>Proveedor</h2>
			<LnxButton
				v-if="issue.provider && !editingAssignment"
				mode="clear"
				size="sm"
				@click="editingAssignment = true"
			>
				<LnxIcon icon="lucide:pencil" />
				Cambiar
			</LnxButton>
		</header>

		<template v-if="issue.provider && !editingAssignment">
			<div class="provider">
				<!-- Decorative: the name is next to it -->
				<LnxAvatar :name="issue.provider.name" alt="" :size="44" />
				<div>
					<strong>{{ issue.provider.name }}</strong>
					<small v-if="assignedProvider">{{ providerCategories[assignedProvider.category]?.label }}</small>
				</div>
			</div>
			<div class="quick-actions">
				<LnxButton v-if="assignedProvider?.phone" :href="`tel:${assignedProvider.phone}`" mode="outline" size="sm">
					<LnxIcon icon="lucide:phone" />
					Llamar
				</LnxButton>
				<LnxButton v-if="providerMail" :href="providerMail" mode="outline" size="sm">
					<LnxIcon icon="lucide:mail" />
					Enviar aviso
				</LnxButton>
			</div>
			<p class="expected" :class="{ late: overdue, unset: !issue.expectedAt }">
				<LnxIcon :icon="overdue ? 'lucide:calendar-x' : 'lucide:calendar-clock'" :size="16" />
				<span v-if="issue.expectedAt">
					{{ overdue ? 'Debía estar el' : 'Previsto para el' }} <strong>{{ formatDate(issue.expectedAt.toDate()) }}</strong>
				</span>
				<span v-else>Sin fecha prevista</span>
			</p>
			<p v-if="note" class="note">
				<small><LnxIcon icon="lucide:lock" :size="12" /> Nota interna</small>
				{{ note }}
			</p>
		</template>

		<form v-else class="assignment" @submit.prevent="saveAssignment()">
			<p v-if="!issue.provider" class="hint">
				Elige quién se encarga. Si está notificada, pasará a «Actuando».
			</p>
			<LnxSelect
				v-model.convert="assignment.providerId"
				:options="providerOptions"
				:convert-fn="option => option.value"
				placeholder="Sin asignar"
			>
				Proveedor
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ providerOptions.find(option => option.value === value)?.label ?? issue.provider?.name }}
				</template>
			</LnxSelect>
			<RouterLink to="/providers" class="add-provider">
				<LnxIcon icon="lucide:plus" :size="14" />
				¿No está? Añádelo al directorio
			</RouterLink>
			<div>
				<LnxDatePicker v-model="assignment.expectedAt" value-format="iso-date">
					Fecha prevista
				</LnxDatePicker>
				<div class="quick-dates">
					<button v-for="quick in quickDates" :key="quick.days" type="button" @click="setExpectedIn(quick.days)">
						{{ quick.label }}
					</button>
				</div>
			</div>
			<LnxTextarea v-model="assignment.note" rows="3" placeholder="Llaves, presupuesto aprobado, contacto…">
				Nota interna (los vecinos no la ven)
			</LnxTextarea>
			<footer class="form-actions">
				<LnxButton v-if="issue.provider" mode="clear" @click="resetAssignment(); editingAssignment = false">
					Cancelar
				</LnxButton>
				<LnxButton type="submit">
					<LnxIcon icon="lucide:check" />
					{{ issue.provider ? 'Guardar' : 'Asignar' }}
					<LnxKbd combo="mod+enter" />
				</LnxButton>
			</footer>
		</form>
	</section>
</template>

<style lang="scss" scoped>
.provider {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);

	div {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	strong {
		font-size: 1.05rem;
		line-height: 1.2;
		text-wrap: balance;
	}

	small {
		color: var(--color-gray-6);
	}
}

.lnx-avatar {
	--lnx-avatar-bg: var(--color-primary);
	color: var(--color-primary-accent);
}

.quick-actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}

.expected {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-2);
	background: #e8f6f1;
	color: #0f7a52;
	font-size: var(--lnx-font-size-small);
	font-variant-numeric: tabular-nums;

	&.late {
		background: #fee2e2;
		color: #dc2626;
	}

	&.unset {
		background: var(--color-gray-1);
		color: var(--color-gray-6);
	}
}

.note {
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border: 1px solid #fde68a;
	border-radius: var(--lnx-radius-2);
	background: #fffbeb;
	color: var(--color-gray-8);
	font-size: var(--lnx-font-size-small);
	white-space: pre-line;

	small {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 2px;
		color: #b45309;
		font-size: var(--lnx-font-size-legal);
		font-weight: var(--lnx-font-weight-bold);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.assignment {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.add-provider {
	margin-top: calc(-1 * var(--lnx-spacing-2));
	display: inline-flex;
	align-items: center;
	gap: 4px;
	color: var(--color-primary);
	font-size: var(--lnx-font-size-legal);
}

.quick-dates {
	margin-top: var(--lnx-spacing-1);
	display: flex;
	flex-wrap: wrap;
	gap: 4px;

	button {
		padding: 2px var(--lnx-spacing-2);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-5);
		background: var(--color-gray-0);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-legal);
		cursor: pointer;

		&:hover {
			border-color: var(--color-primary);
			color: var(--color-primary);
		}

		&:active {
			scale: var(--press-scale);
		}
	}
}
</style>
