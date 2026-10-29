<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Role, User } from '@gobernansa/shared/domain/user.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { assignableRoles, roles } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { setBlocked } from '../application/useModeration.ts';
import { cancelInvitation, invite, removePerson, setCommunityAssigned, setRole, usePeople } from '../application/usePeople.ts';

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
const sending = ref(false);
const formError = ref<string>();

async function sendInvitation() {
	const email = form.value.email.trim().toLowerCase();
	if (people.value.some(person => person.email === email)) {
		formError.value = 'Esa persona ya tiene cuenta.';
		return;
	}

	sending.value = true;
	formError.value = undefined;
	try {
		await invite({ ...form.value, email, communityId });
		form.value = { ...form.value, name: '', email: '', communityIds: [] };
	} catch (e) {
		// Sending one over another is an update, which the rules don't allow
		formError.value = `No se ha podido invitar, puede que ese email ya tenga una invitación pendiente: ${(e as Error).message}`;
	} finally {
		sending.value = false;
	}
}

const actionError = ref<string>();

async function run(action: () => Promise<void>, failure: string) {
	actionError.value = undefined;
	try {
		await action();
	} catch (e) {
		actionError.value = `${failure}: ${(e as Error).message}`;
	}
}

async function remove(person: User & { id: string }) {
	const question = communityId ? `¿Quitar a ${person.name} de la comunidad?` : `¿Quitar el acceso de ${person.name}?`;
	// eslint-disable-next-line no-alert
	if (!window.confirm(question)) {
		return;
	}

	await run(async () => removePerson(person.id, communityId, person.name), 'No se ha podido quitar');
}

async function toggleBlocked(person: User & { id: string }) {
	const question = person.blocked
		? `¿Desbloquear a ${person.name}? Podrá volver a reportar, comentar, votar y reservar.`
		: `¿Bloquear a ${person.name}? Podrá seguir leyendo, pero no reportar, comentar, votar ni reservar.`;
	// eslint-disable-next-line no-alert
	if (!window.confirm(question)) {
		return;
	}

	await run(async () => setBlocked(person.id, communityId, !person.blocked, person.name), 'No se ha podido cambiar el bloqueo');
}
</script>

<template>
	<header class="page-header">
		<LnxButton
			:to="communityId ? `/communities/${communityId}` : '/'"
			mode="clear"
			shape="circle"
			:aria-label="communityId ? 'Volver a la comunidad' : 'Volver a comunidades'"
		>
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>{{ communityId ? 'Vecinos y gestores' : 'Administradores' }}</h1>
	</header>

	<form v-if="roleOptions.length" class="card" @submit.prevent="sendInvitation()">
		<h2>Invitar</h2>
		<p class="hint">
			No se envía ningún email: avísale de que entre en gobernança con este email. Su cuenta se crea al entrar por primera vez.
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

		<footer class="form-actions">
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<LnxButton type="submit" :is-loading="sending">
				<LnxIcon icon="lucide:send" />
				Invitar
			</LnxButton>
		</footer>
	</form>

	<section class="card">
		<h2>{{ communityId ? 'Cuentas' : 'Con acceso' }}</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>

		<span v-if="loading" class="skeleton-item" />
		<ul v-else-if="sortedPeople.length" class="list">
			<li v-for="person in sortedPeople" :key="person.id" class="person">
				<div class="who">
					<strong>{{ person.name }}<template v-if="person.id === me?.id"> (tú)</template></strong>
					<small>{{ person.email }}</small>
				</div>
				<span class="badges">
					<span v-if="person.blocked" class="badge blocked">Bloqueado</span>
					<span class="badge">{{ roles[person.role]?.label }}</span>
				</span>

				<div v-if="communityId || canEdit(person)" class="person-actions">
					<LnxButton v-if="communityId" :to="`/communities/${communityId}/people/${person.id}/documents`" mode="clear" size="small">
						<LnxIcon icon="lucide:file-text" />
						Documentos
					</LnxButton>
					<LnxButton
						v-if="communityId && person.role === 'user' && canEdit(person)"
						mode="clear"
						size="small"
						@click="toggleBlocked(person)"
					>
						<LnxIcon :icon="person.blocked ? 'lucide:shield-check' : 'lucide:shield-ban'" />
						{{ person.blocked ? 'Desbloquear' : 'Bloquear' }}
					</LnxButton>
					<LnxButton
						v-if="canEdit(person) && communityId && roleOptions.includes('manager')"
						mode="clear"
						size="small"
						@click="run(async () => setRole(person.id, person.role === 'manager' ? 'user' : 'manager', communityId, person.name), 'No se ha podido cambiar el rol')"
					>
						<LnxIcon :icon="person.role === 'manager' ? 'lucide:user-minus' : 'lucide:user-check'" />
						{{ person.role === 'manager' ? 'Quitar gestión' : 'Hacer gestor' }}
					</LnxButton>
					<LnxButton v-if="canEdit(person)" mode="clear" size="small" variant="danger" @click="remove(person)">
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
							@change="run(async () => setCommunityAssigned(person.id, community.id, ($event.target as HTMLInputElement).checked, person.name), 'No se ha podido asignar')"
						>
						<span>{{ community.name || 'Sin nombre' }}</span>
					</label>
				</fieldset>
			</li>
		</ul>
		<p v-else class="hint">
			Aún no hay cuentas.
		</p>
	</section>

	<section v-if="invitations.length" class="card">
		<h2>Invitaciones pendientes</h2>
		<ul class="list">
			<li v-for="invitation in invitations" :key="invitation.id" class="person">
				<div class="who">
					<strong>{{ invitation.name }}</strong>
					<small>{{ invitation.email }}</small>
				</div>
				<span class="badge">{{ roles[invitation.role]?.label }}</span>
				<div v-if="assignableRoles(me, invitation.communityId).includes(invitation.role)" class="person-actions">
					<LnxButton
						mode="clear"
						size="small"
						variant="danger"
						@click="run(async () => cancelInvitation(invitation.id, invitation.communityId, invitation.name), 'No se ha podido cancelar')"
					>
						<LnxIcon icon="lucide:x" />
						Cancelar
					</LnxButton>
				</div>
			</li>
		</ul>
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
