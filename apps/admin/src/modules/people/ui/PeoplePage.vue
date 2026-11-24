<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Invitation, Role, User } from '@gobernansa/shared/domain/user.ts';
import type { PrintedLetter } from './AccessLetterPrint.vue';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { assignableRoles, formatInviteCode, newInviteCode, roles } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxCheckbox, LnxIcon, LnxInput, LnxRadioGroup, LnxSelect, useConfirm } from 'lnxjs-components';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import FormCard from '@/app/ux/FormCard.vue';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { mailOutcome } from '@/modules/mail/application/mail.ts';
import MailModeNote from '@/modules/mail/ui/MailModeNote.vue';
import { setBlocked } from '../application/useModeration.ts';
import { cancelInvitation, communityName, invite, removePerson, resendInvitation, restoreInvitation, setCommunityAssigned, setRole, usePeople } from '../application/usePeople.ts';
import AccessLetterPrint from './AccessLetterPrint.vue';
import AccessLetters from './AccessLetters.vue';

// A community's neighbours and managers or, without one, the administrators
const props = defineProps<{ id?: string }>();

const ask = useConfirm();

const communityId = props.id ?? '';
const scopeRoles: Role[] = communityId ? ['user', 'manager'] : ['admin', 'superadmin'];
const roleOrder = Object.keys(roles);

const { user: me } = useAuth();
const { people, invitations, loading, error } = usePeople(communityId);
// To assign them to administrators
const communities = communityId ? computed<Community[]>(() => []) : useCommunities().communities;
const communityOptions = computed(() => communities.value.map(community => ({ value: community.id, label: community.name || 'Sin nombre' })));

// What the rules let the user give here
const roleOptions = computed(() => assignableRoles(me.value, communityId).filter(role => scopeRoles.includes(role)));
const roleSelectOptions = computed(() => roleOptions.value.map(value => ({ value, label: roles[value].label })));

// Managers first, then by name. An office's staff aren't listed among the administrators: they follow its owner's
// communities and its owner manages them, on Equipo
const sortedPeople = computed(() => people.value.filter(person => communityId || !person.officeId).sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.name.localeCompare(b.name, 'es')));

// Never themselves, and only roles they could give
function canEdit(person: User & { id: string }) {
	return person.id !== me.value?.id && roleOptions.value.includes(person.role);
}

// A neighbour whose profile is another community's (B10): their role and blocking are that community's
function isSecondary(person: User & { id: string; secondary?: boolean }) {
	return !!person.secondary;
}

const form = ref({ name: '', email: '', role: scopeRoles[0], communityIds: [] as string[] });
const byEmail = ref(true);
// Neighbours get an access letter (B2.4) instead of an email
const withCode = computed(() => !!communityId && form.value.role === 'user');
const formError = ref<string>();
const formElement = useTemplateRef('formElement');

function reset() {
	form.value = { ...form.value, name: '', email: '', communityIds: [] };
	formError.value = undefined;
}

const { open, show, close } = useNewForm(formElement, reset);

// The email is its id, so sending it twice can't make two. The form closes at once and opens with its values if it fails
function sendInvitation() {
	if (withCode.value) {
		inviteWithCode();
		return;
	}
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

// Printed at once, since it's what the office hands over. The code is new, so it can't clash with another
function inviteWithCode() {
	const sent = { ...form.value };
	const code = newInviteCode();
	close();
	void optimistic(invite({ ...sent, email: code, communityId, byCode: true }), {
		done: `${sent.name.trim()} invitado con un código`,
		failed: 'No se ha podido invitar',
		onError: () => {
			form.value = sent;
			open.value = true;
		},
	}).then(async invited => invited && printLetters([{ name: sent.name.trim(), code, places: '' }]));
}

// Access letters, alone on the page when printing
const community = ref('');
if (communityId) {
	void communityName(communityId).then(name => community.value = name, () => {});
}
const printing = ref<PrintedLetter[]>([]);
async function printLetters(letters: PrintedLetter[]) {
	printing.value = letters;
	await nextTick();
	window.print();
}

function printCode(invitation: Invitation & { id: string }) {
	return printLetters([{ name: invitation.name, code: invitation.id, places: '' }]);
}

async function remove(person: User & { id: string }) {
	const question = communityId ? `¿Quitar a ${person.name} de la comunidad?` : `¿Quitar el acceso de ${person.name}?`;
	const message = isSecondary(person)
		? 'Deja de ver esta comunidad; su perfil y su comunidad principal siguen.'
		: 'Se borra su perfil y no se puede deshacer: pierde el acceso. Una invitación nueva se lo devuelve.';
	if (!await ask({ title: question, message, confirmText: 'Quitar', variant: 'danger' })) {
		return;
	}

	// No undo: only they can create their profile again, by signing in with a new invitation
	void optimistic(removePerson(person.id, communityId, person.name, isSecondary(person)), {
		done: communityId ? `${person.name} quitado de la comunidad` : `Acceso de ${person.name} quitado`,
		failed: 'No se ha podido quitar',
	});
}

async function toggleBlocked(person: User & { id: string }) {
	const confirmed = await ask(person.blocked
		? { title: `¿Desbloquear a ${person.name}?`, message: 'Podrá volver a reportar, comentar, votar y reservar.', confirmText: 'Desbloquear' }
		: { title: `¿Bloquear a ${person.name}?`, message: 'Podrá seguir leyendo, pero no reportar, comentar, votar ni reservar.', confirmText: 'Bloquear', variant: 'danger' });
	if (!confirmed) {
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

// The chips give the whole list: the community clicked is the one that changed
function toggleAssigned(person: User & { id: string }, ids: string[]) {
	const community = communities.value.find(({ id }) => ids.includes(id) !== !!person.communityIds?.includes(id));
	if (!community) {
		return;
	}
	const assigned = ids.includes(community.id);
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

	<FormCard
		v-if="open && roleOptions.length"
		ref="formElement"
		title="Invitar a alguien"
		:error="formError"
		:submit-label="withCode ? 'Imprimir su carta' : 'Invitar'"
		:submit-icon="withCode ? 'lucide:printer' : 'lucide:send'"
		shortcut="Enviar la invitación"
		@submit="sendInvitation()"
		@cancel="close()"
	>
		<p class="hint">
			{{ withCode
				? 'Se imprime una carta con su código para entrar en la app. Para un propietario o inquilino del censo, usa mejor su carta de acceso, más abajo: así su cuenta queda unida a su casa.'
				: 'Recibe un email para crear su cuenta en gobernança admin con ese email.' }}
		</p>
		<div class="fields">
			<LnxInput v-model="form.name" required>
				Nombre
			</LnxInput>
			<LnxInput v-if="!withCode" v-model="form.email" type="email" required>
				Email
			</LnxInput>
			<LnxSelect
				v-if="roleOptions.length > 1"
				v-model.convert="form.role"
				:options="roleSelectOptions"
				:convert-fn="option => option.value"
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

		<LnxRadioGroup v-if="form.role === 'admin'" v-model="form.communityIds" :options="communityOptions" multiple>
			Comunidades que administra
		</LnxRadioGroup>

		<div v-if="!withCode">
			<LnxCheckbox v-model="byEmail">
				Enviar invitación por email
				<template #helper>
					{{ byEmail ? 'Con el enlace para entrar en la app que usará.' : 'Avísale tú de que entre en gobernança con este email.' }}
				</template>
			</LnxCheckbox>
			<MailModeNote v-if="byEmail" />
		</div>
	</FormCard>

	<section class="card">
		<h2>{{ communityId ? 'Cuentas' : 'Con acceso' }}</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>

		<ul v-if="loading && !people.length" class="list" aria-busy="true">
			<li v-for="width in [38, 52, 30, 45]" :key="width" class="person">
				<div class="who">
					<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
					<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width + 15}%` }" />
				</div>
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 64px" />
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 96px" />
			</li>
		</ul>
		<TransitionGroup v-else-if="sortedPeople.length" tag="ul" name="row" class="list lnx-appear">
			<li v-for="person in sortedPeople" :key="person.id" class="person">
				<div class="who">
					<strong :style="communityId ? { viewTransitionName: `person-${person.id}` } : undefined">{{ person.name }}<template v-if="person.id === me?.id"> (tú)</template></strong>
					<small>{{ person.email || 'Entra con su carta de acceso' }}</small>
				</div>
				<span class="badges">
					<span v-if="person.blocked" class="badge blocked">Bloqueado</span>
					<span v-if="isSecondary(person)" class="badge" title="Su cuenta es de otra comunidad">Vive en otra</span>
					<span class="badge">{{ roles[person.role]?.label }}</span>
				</span>

				<div v-if="communityId || canEdit(person)" class="person-actions">
					<LnxButton v-if="communityId" :to="`/communities/${communityId}/people/${person.id}/documents`" mode="clear" class="lnx-size-small">
						<LnxIcon icon="lucide:file-text" />
						Documentos
					</LnxButton>
					<LnxButton
						v-if="communityId && person.role === 'user' && canEdit(person) && !isSecondary(person)"
						mode="clear"
						class="lnx-size-small"
						@click="toggleBlocked(person)"
					>
						<LnxIcon :icon="person.blocked ? 'lucide:shield-check' : 'lucide:shield-ban'" />
						{{ person.blocked ? 'Desbloquear' : 'Bloquear' }}
					</LnxButton>
					<LnxButton
						v-if="canEdit(person) && communityId && roleOptions.includes('manager') && !isSecondary(person)"
						mode="clear"
						class="lnx-size-small"
						@click="toggleManager(person)"
					>
						<LnxIcon :icon="person.role === 'manager' ? 'lucide:user-minus' : 'lucide:user-check'" />
						{{ person.role === 'manager' ? 'Quitar gestión' : 'Hacer gestor' }}
					</LnxButton>
					<LnxButton v-if="canEdit(person)" mode="clear" class="lnx-size-small" variant="danger" @click="remove(person)">
						<LnxIcon icon="lucide:trash-2" />
						{{ communityId ? 'Quitar de la comunidad' : 'Quitar acceso' }}
					</LnxButton>
				</div>

				<p v-if="person.role === 'superadmin'" class="hint wide">
					Todas las comunidades
				</p>
				<LnxRadioGroup
					v-else-if="!communityId"
					class="wide"
					:model-value="person.communityIds ?? []"
					:options="communityOptions"
					:disabled="!canEdit(person)"
					multiple
					@update:model-value="ids => toggleAssigned(person, ids as string[])"
				>
					Comunidades que administra
				</LnxRadioGroup>
			</li>
		</TransitionGroup>
		<p v-else class="hint">
			Aún no hay cuentas.
		</p>
	</section>

	<AccessLetters
		v-if="communityId"
		:community-id="communityId"
		:community="community"
		:invitations="invitations"
		:can-invite="roleOptions.includes('user')"
		@print="printLetters"
	/>

	<section v-if="invitations.length" class="card">
		<h2>Invitaciones pendientes</h2>
		<TransitionGroup tag="ul" name="row" class="list">
			<li v-for="invitation in invitations" :key="invitation.id" class="person">
				<div class="who">
					<strong>{{ invitation.name }}</strong>
					<small>{{ invitation.byCode ? `Código ${formatInviteCode(invitation.id)}` : invitation.email }}</small>
				</div>
				<span class="badge">{{ roles[invitation.role]?.label }}</span>
				<div v-if="assignableRoles(me, invitation.communityId).includes(invitation.role)" class="person-actions">
					<LnxButton v-if="invitation.byCode" mode="clear" class="lnx-size-small" @click="printCode(invitation)">
						<LnxIcon icon="lucide:printer" />
						Imprimir la carta
					</LnxButton>
					<!-- Neighbours' are letters now: one by email can't be used in the app -->
					<LnxButton v-else-if="invitation.role !== 'user'" mode="clear" class="lnx-size-small" @click="resend(invitation)">
						<LnxIcon icon="lucide:mail" />
						Reenviar invitación por email
					</LnxButton>
					<LnxButton
						mode="clear"
						class="lnx-size-small"
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

	<AccessLetterPrint :letters="printing" :community="community" />
</template>

<style lang="scss" scoped>
@media print {
	.page-header,
	.card {
		display: none;
	}
}

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
