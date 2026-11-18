<script setup lang="ts">
import type { Invitation, OfficeRole, User } from '@gobernansa/shared/domain/user.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { officeRoles } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxCheckbox, LnxIcon, LnxInput, LnxSelect, useConfirm } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import FormCard from '@/app/ux/FormCard.vue';
import NewButton from '@/app/ux/NewButton.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { mailOutcome } from '@/modules/mail/application/mail.ts';
import MailModeNote from '@/modules/mail/ui/MailModeNote.vue';
import { cancelInvitation, invite, removePerson, resendInvitation, restoreInvitation, setOfficeRole, useTeam } from '../application/usePeople.ts';

// The office's staff (B3), for its owner, whose uid is the office's id. They see all its communities, each with their function
const ask = useConfirm();
const { user: me } = useAuth();
const officeId = me.value!.id;
const { people, invitations, loading, error } = useTeam(officeId);

const STAFF_ROLES: OfficeRole[] = ['accountant', 'clerk', 'viewer'];
const roleOptions = STAFF_ROLES.map(value => ({ value, label: officeRoles[value].label }));
const sortedPeople = computed(() => [...people.value].sort((a, b) => a.name.localeCompare(b.name, 'es')));

const form = ref({ name: '', email: '', officeRole: 'clerk' as OfficeRole });
const byEmail = ref(true);
const formError = ref<string>();
const formElement = useTemplateRef('formElement');

const { open, show, close } = useNewForm(formElement, () => {
	form.value = { ...form.value, name: '', email: '' };
	formError.value = undefined;
});

// Same as on Administradores: the email is the invitation's id, the form opens again with its values if it fails
function sendInvitation() {
	const email = form.value.email.trim().toLowerCase();
	if (email === me.value?.email || people.value.some(person => person.email === email)) {
		formError.value = 'Esa persona ya está en el despacho.';
		return;
	}
	if (invitations.value.some(invitation => invitation.id === email)) {
		formError.value = 'Ese email ya tiene una invitación pendiente.';
		return;
	}

	const sent = { ...form.value };
	close();
	void optimistic(invite({
		email,
		name: sent.name,
		role: 'admin',
		communityId: '',
		communityIds: me.value?.communityIds ?? [],
		officeId,
		officeRole: sent.officeRole,
	}, `Invitó a ${sent.name.trim()} al despacho como ${officeRoles[sent.officeRole].label.toLowerCase()}`, byEmail.value), {
		done: `${sent.name.trim()} invitado${byEmail.value ? `; ${mailOutcome(email)}` : ''}`,
		failed: 'No se ha podido invitar, puede que ese email ya tenga una invitación pendiente',
		onError: () => {
			form.value = sent;
			open.value = true;
		},
	});
}

function changeRole(person: User & { id: string }, officeRole: OfficeRole) {
	const previous = person.officeRole ?? 'clerk';
	void optimistic(setOfficeRole(person.id, officeRole, person.name), {
		done: `${person.name} ahora es ${officeRoles[officeRole].label.toLowerCase()}`,
		failed: 'No se ha podido cambiar la función',
		revert: async () => setOfficeRole(person.id, previous, person.name),
	});
}

async function remove(person: User & { id: string }) {
	if (!await ask({ title: `¿Quitar a ${person.name} del despacho?`, message: 'Dejará de ver sus comunidades.', confirmText: 'Quitar', variant: 'danger' })) {
		return;
	}
	void optimistic(removePerson(person.id, undefined, person.name), {
		done: `${person.name} quitado del despacho`,
		failed: 'No se ha podido quitar',
	});
}

function resend(invitation: Invitation & { id: string }) {
	void optimistic(resendInvitation(invitation), {
		done: `Invitación de ${invitation.name}: ${mailOutcome(invitation.id)}`,
		failed: 'No se ha podido enviar la invitación',
	});
}

function cancel(invitation: Invitation & { id: string }) {
	void optimistic(cancelInvitation(invitation.id, undefined, invitation.name), {
		done: 'Invitación cancelada',
		failed: 'No se ha podido cancelar',
		revert: async () => restoreInvitation(invitation),
	});
}
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver a comunidades" />
		<h1>Equipo del despacho</h1>
		<NewButton v-if="!open" label="Invitar a alguien" @click="show()" />
	</header>

	<FormCard
		v-if="open"
		ref="formElement"
		title="Invitar al despacho"
		:error="formError"
		submit-label="Invitar"
		submit-icon="lucide:send"
		shortcut="Enviar la invitación"
		@submit="sendInvitation()"
		@cancel="close()"
	>
		<p class="hint">
			Verá todas las comunidades del despacho. Su cuenta se crea la primera vez que entre en gobernança con este email.
		</p>
		<div class="fields">
			<LnxInput v-model="form.name" required>
				Nombre
			</LnxInput>
			<LnxInput v-model="form.email" type="email" required>
				Email
			</LnxInput>
			<LnxSelect v-model.convert="form.officeRole" :options="roleOptions" :convert-fn="option => option.value">
				Función
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ officeRoles[value as OfficeRole]?.label }}
				</template>
				<template #helper>
					{{ officeRoles[form.officeRole].description }}
				</template>
			</LnxSelect>
		</div>

		<div>
			<LnxCheckbox v-model="byEmail">
				Enviar invitación por email
				<template #helper>
					{{ byEmail ? 'Con el enlace para entrar en el panel.' : 'Avísale tú de que entre en gobernança con este email.' }}
				</template>
			</LnxCheckbox>
			<MailModeNote v-if="byEmail" />
		</div>
	</FormCard>

	<section class="card">
		<h2>En el despacho</h2>
		<p v-if="error" class="error" role="alert">
			No se ha podido cargar: {{ error.message }}
		</p>
		<ul class="list">
			<li class="person">
				<div class="who">
					<strong>{{ me?.name }} (tú)</strong>
					<small>{{ me?.email }}</small>
				</div>
				<span class="badge">{{ officeRoles.owner.label }}</span>
			</li>
			<li v-if="loading && !people.length" class="person" aria-busy="true">
				<div class="who">
					<span class="lnx-skeleton" style="width: 40%" />
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 55%" />
				</div>
			</li>
			<li v-for="person in sortedPeople" :key="person.id" class="person">
				<div class="who">
					<strong>{{ person.name }}</strong>
					<small>{{ person.email }}</small>
				</div>
				<LnxSelect
					class="role"
					:model-value="person.officeRole ?? 'clerk'"
					:options="roleOptions"
					:convert-fn="option => option.value"
					:model-modifiers="{ convert: true }"
					:aria-label="`Función de ${person.name}`"
					@update:model-value="value => changeRole(person, value as OfficeRole)"
				>
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ officeRoles[value as OfficeRole]?.label }}
					</template>
				</LnxSelect>
				<LnxButton mode="clear" class="lnx-size-small" variant="danger" @click="remove(person)">
					<LnxIcon icon="lucide:trash-2" />
					Quitar
				</LnxButton>
			</li>
		</ul>
		<p v-if="!loading && !people.length" class="hint">
			Aún no has invitado a nadie. Cada persona tiene su propia cuenta y una función que limita lo que puede hacer.
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
				<span class="badge">{{ officeRoles[invitation.officeRole ?? 'clerk'].label }}</span>
				<div class="person-actions">
					<LnxButton mode="clear" class="lnx-size-small" @click="resend(invitation)">
						<LnxIcon icon="lucide:mail" />
						Reenviar
					</LnxButton>
					<LnxButton mode="clear" class="lnx-size-small" variant="danger" @click="cancel(invitation)">
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

.person {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-2) var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}

	.role {
		min-width: 160px;
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

.person-actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);
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
</style>
