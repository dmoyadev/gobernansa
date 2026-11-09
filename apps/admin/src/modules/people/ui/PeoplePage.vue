<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Invitation, Role, User } from '@gobernansa/shared/domain/user.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { assignableRoles, roles } from '@gobernansa/shared/domain/user.ts';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import Kbd from '@/app/ux/Kbd.vue';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { mailOutcome } from '@/modules/mail/application/mail.ts';
import MailModeNote from '@/modules/mail/ui/MailModeNote.vue';
import { setBlocked } from '../application/useModeration.ts';
import { cancelInvitation, invite, removePerson, resendInvitation, restoreInvitation, setCommunityAssigned, setRole, usePeople } from '../application/usePeople.ts';

// A community's neighbours and managers or, without one, the administrators
const props = defineProps<{ id?: string }>();
const communityId = props.id ?? '';
const scopeRoles: Role[] = communityId ? ['user', 'manager'] : ['admin', 'superadmin'];
const roleOrder = Object.keys(roles);

const { user: me } = useAuth();
const { people, invitations, loading, error } = usePeople(communityId);
// To assign them to administrators
const communities = communityId ? computed<Community[]>(() => []) : useCommunities().communities;

// What the rules let the user give here
const roleOptions = computed(() => assignableRoles(me.value, communityId).filter(role => scopeRoles.includes(role)));
const roleSelectOptions = computed(() => roleOptions.value.map(value => ({ value, label: roles[value].label })));

// Managers first, then by name
const sortedPeople = computed(() => [...people.value].sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.name.localeCompare(b.name, 'es')));

// Never themselves, and only roles they could give
function canEdit(person: User & { id: string }) {
	return person.id !== me.value?.id && roleOptions.value.includes(person.role);
}

const form = ref({ name: '', email: '', role: scopeRoles[0], communityIds: [] as string[] });
const byEmail = ref(true);
const formError = ref<string>();
const formElement = useTemplateRef<HTMLFormElement>('formElement');

function reset() {
	form.value = { ...form.value, name: '', email: '', communityIds: [] };
	formError.value = undefined;
}

const { open, show, close } = useNewForm(formElement, reset);

// The email is its id, so sending it twice can't make two. The form closes at once and opens with its values if it fails
function sendInvitation() {
	const email = form.value.email.trim().toLowerCase();
	if (people.value.some(person => person.email === email)) {
		formError.value = 'Esa persona ya tiene cuenta.';
		return;
	}
	if (invitations.value.some(invitation => invitation.id === email)) {
		formError.value = 'Ese email ya tiene una invitación pendiente.';
		return;
	}

	const sent = { ...form.value };
	close();
	void optimistic(invite({ ...sent, email, communityId }, undefined, byEmail.value), {
		done: `${sent.name.trim()} invitado${byEmail.value ? `; ${mailOutcome(email)}` : ''}`,
		// Sending one over another is an update, which the rules don't allow
		failed: 'No se ha podido invitar, puede que ese email ya tenga una invitación pendiente',
		onError: () => {
			form.value = sent;
			open.value = true;
		},
	});
}

useShortcut('mod+enter', () => formElement.value?.requestSubmit(), 'Enviar la invitación');

function remove(person: User & { id: string }) {
	const question = communityId ? `¿Quitar a ${person.name} de la comunidad?` : `¿Quitar el acceso de ${person.name}?`;
	// eslint-disable-next-line no-alert
	if (!window.confirm(question)) {
		return;
	}

	// No undo: only they can create their profile again, by signing in with a new invitation
	void optimistic(removePerson(person.id, communityId, person.name), {
		done: communityId ? `${person.name} quitado de la comunidad` : `Acceso de ${person.name} quitado`,
		failed: 'No se ha podido quitar',
	});
}

function toggleBlocked(person: User & { id: string }) {
	const question = person.blocked
		? `¿Desbloquear a ${person.name}? Podrá volver a reportar, comentar, votar y reservar.`
		: `¿Bloquear a ${person.name}? Podrá seguir leyendo, pero no reportar, comentar, votar ni reservar.`;
	// eslint-disable-next-line no-alert
	if (!window.confirm(question)) {
		return;
	}

	const blocked = !person.blocked;
	void optimistic(setBlocked(person.id, communityId, blocked, person.name), {
		done: `${person.name} ${blocked ? 'bloqueado' : 'desbloqueado'}`,
		failed: 'No se ha podido cambiar el bloqueo',
		revert: async () => setBlocked(person.id, communityId, !blocked, person.name),
	});
}

function toggleManager(person: User & { id: string }) {
	const previous = person.role;
	const role: Role = previous === 'manager' ? 'user' : 'manager';
	void optimistic(setRole(person.id, role, communityId, person.name), {
		done: `${person.name} ahora es ${roles[role].label.toLowerCase()}`,
		failed: 'No se ha podido cambiar el rol',
		revert: async () => setRole(person.id, previous, communityId, person.name),
	});
}

function toggleAssigned(person: User & { id: string }, community: Community, assigned: boolean) {
	const name = community.name || 'Sin nombre';
	void optimistic(setCommunityAssigned(person.id, community.id, assigned, person.name), {
		done: `${name} ${assigned ? 'asignada' : 'desasignada'}`,
		failed: 'No se ha podido asignar',
		revert: async () => setCommunityAssigned(person.id, community.id, !assigned, person.name),
	});
}

// No undo: the email may be out already
function resend(invitation: Invitation & { id: string }) {
	void optimistic(resendInvitation(invitation), {
		done: `Invitación de ${invitation.name}: ${mailOutcome(invitation.id)}`,
		failed: 'No se ha podido enviar la invitación',
	});
}

function cancel(invitation: Invitation & { id: string }) {
	void optimistic(cancelInvitation(invitation.id, invitation.communityId, invitation.name), {
		done: 'Invitación cancelada',
		failed: 'No se ha podido cancelar',
		revert: async () => restoreInvitation(invitation),
	});
}
</script>

<template>
	<header class="page-header">
		<!-- A community's has the nav of its workspace instead -->
		<BackButton v-if="!communityId" to="/" label="Volver a comunidades" />
		<h1>{{ communityId ? 'Vecinos y gestores' : 'Administradores' }}</h1>
		<NewButton v-if="!open && roleOptions.length" label="Invitar a alguien" @click="show()" />
	</header>

	<form v-if="open && roleOptions.length" ref="formElement" class="card ux-appear" @submit.prevent="sendInvitation()">
		<h2>Invitar a alguien</h2>
		<p class="hint">
			Su cuenta se crea la primera vez que entre en gobernança con este email.
		</p>
		<div class="fields">
			<LnxInput v-model="form.name" required>
				Nombre
			</LnxInput>
			<LnxInput v-model="form.email" type="email" required>
				Email
			</LnxInput>
			<LnxSelect
				v-if="roleOptions.length > 1"
				v-model.convert="form.role"
				:options="roleSelectOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Rol
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ roles[value]?.label }}
				</template>
			</LnxSelect>
		</div>

		<fieldset v-if="form.role === 'admin'" class="chips">
			<legend>Comunidades que administra</legend>
			<label v-for="community in communities" :key="community.id">
				<input v-model="form.communityIds" type="checkbox" class="sr-only" :value="community.id">
				<span>{{ community.name || 'Sin nombre' }}</span>
			</label>
		</fieldset>

		<div>
			<LnxCheckbox v-model="byEmail">
				Enviar invitación por email
				<template #helper>
					{{ byEmail ? 'Con el enlace para entrar en la app que usará.' : 'Avísale tú de que entre en gobernança con este email.' }}
				</template>
			</LnxCheckbox>
			<MailModeNote v-if="byEmail" />
		</div>

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton type="button" mode="clear" @click="close()">
				Cancelar
				<Kbd combo="escape" />
			</LnxButton>
			<LnxButton type="submit">
				<LnxIcon icon="lucide:send" />
				Invitar
				<Kbd combo="mod+enter" />
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>{{ communityId ? 'Cuentas' : 'Con acceso' }}</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<ul v-if="loading && !people.length" class="list" aria-busy="true">
			<li v-for="width in [38, 52, 30, 45]" :key="width" class="person">
				<div class="who">
					<span class="skeleton-item" :style="{ width: `${width}%` }" />
					<span class="skeleton-item skeleton-item--small" :style="{ width: `${width + 15}%` }" />
				</div>
				<span class="skeleton-item skeleton-item--small" style="width: 64px" />
				<span class="skeleton-item skeleton-item--small" style="width: 96px" />
			</li>
		</ul>
		<TransitionGroup v-else-if="sortedPeople.length" tag="ul" name="row" class="list ux-appear">
			<li v-for="person in sortedPeople" :key="person.id" class="person">
				<div class="who">
					<strong :style="communityId ? { viewTransitionName: `person-${person.id}` } : undefined">{{ person.name }}<template v-if="person.id === me?.id"> (tú)</template></strong>
					<small>{{ person.email }}</small>
				</div>
				<span class="badges">
					<span v-if="person.blocked" class="badge blocked">Bloqueado</span>
					<span class="badge">{{ roles[person.role]?.label }}</span>
				</span>

				<div v-if="communityId || canEdit(person)" class="person-actions">
					<LnxButton v-if="communityId" :to="`/communities/${communityId}/people/${person.id}/documents`" mode="clear" class="size-small">
						<LnxIcon icon="lucide:file-text" />
						Documentos
					</LnxButton>
					<LnxButton
						v-if="communityId && person.role === 'user' && canEdit(person)"
						mode="clear"
						class="size-small"
						@click="toggleBlocked(person)"
					>
						<LnxIcon :icon="person.blocked ? 'lucide:shield-check' : 'lucide:shield-ban'" />
						{{ person.blocked ? 'Desbloquear' : 'Bloquear' }}
					</LnxButton>
					<LnxButton
						v-if="canEdit(person) && communityId && roleOptions.includes('manager')"
						mode="clear"
						class="size-small"
						@click="toggleManager(person)"
					>
						<LnxIcon :icon="person.role === 'manager' ? 'lucide:user-minus' : 'lucide:user-check'" />
						{{ person.role === 'manager' ? 'Quitar gestión' : 'Hacer gestor' }}
					</LnxButton>
					<LnxButton v-if="canEdit(person)" mode="clear" class="size-small" variant="danger" @click="remove(person)">
						<LnxIcon icon="lucide:trash-2" />
						{{ communityId ? 'Quitar de la comunidad' : 'Quitar acceso' }}
					</LnxButton>
				</div>

				<p v-if="person.role === 'superadmin'" class="hint wide">
					Todas las comunidades
				</p>
				<fieldset v-else-if="!communityId" class="chips wide" :disabled="!canEdit(person)">
					<legend>Comunidades que administra</legend>
					<label v-for="community in communities" :key="community.id">
						<input
							type="checkbox"
							class="sr-only"
							:checked="person.communityIds?.includes(community.id)"
							@change="toggleAssigned(person, community, ($event.target as HTMLInputElement).checked)"
						>
						<span>{{ community.name || 'Sin nombre' }}</span>
					</label>
				</fieldset>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			Aún no hay cuentas.
		</p>
	</section>

	<section v-if="invitations.length" class="card">
		<h2>Invitaciones pendientes</h2>
		<TransitionGroup tag="ul" name="row" class="list">
			<li v-for="invitation in invitations" :key="invitation.id" class="person">
				<div class="who">
					<strong>{{ invitation.name }}</strong>
					<small>{{ invitation.email }}</small>
				</div>
				<span class="badge">{{ roles[invitation.role]?.label }}</span>
				<div v-if="assignableRoles(me, invitation.communityId).includes(invitation.role)" class="person-actions">
					<LnxButton mode="clear" class="size-small" @click="resend(invitation)">
						<LnxIcon icon="lucide:mail" />
						Reenviar invitación por email
					</LnxButton>
					<LnxButton
						mode="clear"
						class="size-small"
						variant="danger"
						@click="cancel(invitation)"
					>
						<LnxIcon icon="lucide:x" />
						Cancelar
					</LnxButton>
				</div>
			</li>
		</TransitionGroup>
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

// Who, their role and what can be done, with the communities of administrators below
.person {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-2) var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}

	.wide {
		grid-column: 1 / -1;
	}
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

.badge {
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-5);
	background: var(--color-gray-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;
}

.badges {
	display: flex;
	gap: var(--lnx-spacing-1);
}

.blocked {
	background: var(--color-secondary-accent);
	color: var(--color-gray-0);
}

.person-actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
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

	label:hover input:not(:checked, :disabled) + span {
		background: var(--color-gray-1);
	}

	label:active input:not(:disabled) + span {
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

	&:disabled span {
		cursor: default;
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
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

@media (max-width: 640px) {
	// Actions on their own row, so names and emails keep the width
	.person {
		grid-template-columns: minmax(0, 1fr) auto;

		.person-actions {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}
	}
}
</style>
