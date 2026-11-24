<script setup lang="ts">
import type { Role, User } from '@gobernansa/shared/domain/user.ts';
import type { AccountChanges } from '../application/usePeople.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { roles } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxCheckbox, LnxIcon, LnxInput, LnxRadioGroup, LnxSelect, useConfirm } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import BackButton from '@/app/ux/BackButton.vue';
import FormCard from '@/app/ux/FormCard.vue';
import { useNewForm } from '@/app/ux/newForm.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { removePerson, updateAccount, useAccounts } from '../application/usePeople.ts';

// Every account, of every role and community, for the team: what each one is and anything about it but its sign-in
const ask = useConfirm();
const { user: me, resetPassword } = useAuth();
const { communities } = useCommunities();

const roleOptions = (Object.keys(roles) as Role[]).map(value => ({ value, label: roles[value].label }));
const communityOptions = computed(() => communities.value.map(community => ({ value: community.id, label: community.name || 'Sin nombre' })));
const communityName = (id: string) => communities.value.find(community => community.id === id)?.name || (id ? 'Comunidad archivada o sin acceso' : 'Ninguna');

const filter = ref({ role: 'admin' as Role, communityId: '' });
const { accounts, loading, error } = useAccounts(filter);
const search = ref('');
const shown = computed(() => {
	const text = search.value.trim().toLowerCase();
	return accounts.value
		.filter(account => !text || `${account.name} ${account.email}`.toLowerCase().includes(text))
		.sort((a, b) => a.name.localeCompare(b.name, 'es'));
});

// Managers and neighbours live in a community, administrators run several, the team sees them all
const livesIn = (role: Role) => role === 'manager' || role === 'user';

const editing = ref<User & { id: string }>();
const draft = ref<AccountChanges>({ name: '', role: 'user', communityId: '', communityIds: [], blocked: false });
const formError = ref<string>();
const formElement = useTemplateRef('formElement');

function reset() {
	editing.value = undefined;
	formError.value = undefined;
}

const { open, show, close } = useNewForm(formElement, reset);

function edit(account: User & { id: string }) {
	editing.value = account;
	draft.value = {
		name: account.name,
		role: account.role,
		communityId: account.communityId ?? '',
		communityIds: [...account.communityIds ?? []],
		blocked: !!account.blocked,
	};
	formError.value = undefined;
	void show();
}

// The form closes at once and the live list shows it. If the server rejects it, it opens again with what was sent
function save() {
	const account = editing.value!;
	const sent: AccountChanges = { ...draft.value, name: draft.value.name.trim() };
	if (livesIn(sent.role) && !sent.communityId) {
		formError.value = 'Elige su comunidad.';
		return;
	}
	close();
	void optimistic(updateAccount(account.id, sent), {
		done: `Cuenta de ${sent.name} guardada`,
		failed: 'No se ha podido guardar la cuenta',
		onError: () => {
			edit(account);
			draft.value = sent;
		},
	});
}

// Firebase sends it from the address set in Authentication, to their sign-in email
async function sendReset(account: User & { id: string }) {
	if (!await ask({ title: `¿Enviar a ${account.email} un enlace para crear una contraseña nueva?`, confirmText: 'Enviar' })) {
		return;
	}
	void optimistic(resetPassword(account.email), {
		done: `Enlace enviado a ${account.email}`,
		failed: 'No se ha podido enviar el enlace',
	});
}

// Their sign-in account stays: a new invitation or access code gives them a profile again
async function remove(account: User & { id: string }) {
	if (!await ask({ title: `¿Quitar la cuenta de ${account.name}?`, message: 'Se borra su perfil y no se puede deshacer: pierde el acceso a gobernança. Una invitación nueva se lo devuelve.', confirmText: 'Quitar', variant: 'danger' })) {
		return;
	}
	void optimistic(removePerson(account.id, livesIn(account.role) ? account.communityId : undefined, account.name), {
		done: `Cuenta de ${account.name} quitada`,
		failed: 'No se ha podido quitar la cuenta',
	});
}
</script>

<template>
	<header class="page-header">
		<BackButton to="/" label="Volver a comunidades" />
		<h1>Cuentas</h1>
	</header>

	<FormCard
		v-if="open && editing"
		ref="formElement"
		:title="`Editar la cuenta de ${editing.name}`"
		:error="formError"
		submit-label="Guardar cambios"
		submit-icon="lucide:save"
		shortcut="Guardar la cuenta"
		@submit="save()"
		@cancel="close()"
	>
		<p class="hint">
			Entra con {{ editing.email || 'su carta de acceso' }}. El email de acceso no se cambia desde aquí: invítale con el nuevo y quita esta cuenta.
		</p>
		<div class="fields">
			<LnxInput v-model="draft.name" required>
				Nombre
			</LnxInput>
			<LnxSelect v-model.convert="draft.role" :options="roleOptions" :convert-fn="option => option.value">
				Rol
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ roles[value as Role]?.label }}
				</template>
			</LnxSelect>
			<LnxSelect v-if="livesIn(draft.role)" v-model.convert="draft.communityId" :options="communityOptions" :convert-fn="option => option.value">
				Comunidad
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ communityName(value as string) }}
				</template>
			</LnxSelect>
		</div>
		<LnxRadioGroup v-if="draft.role === 'admin'" v-model="draft.communityIds" :options="communityOptions" multiple>
			Comunidades que administra
		</LnxRadioGroup>
		<LnxCheckbox v-model="draft.blocked">
			Bloqueada
			<template #helper>
				Puede leer, pero no reportar, comentar, votar ni reservar.
			</template>
		</LnxCheckbox>
	</FormCard>

	<section class="card">
		<div class="filters">
			<LnxSelect v-model.convert="filter.role" :options="roleOptions" :convert-fn="option => option.value">
				Rol
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ roles[value as Role]?.label }}
				</template>
			</LnxSelect>
			<LnxSelect
				v-if="livesIn(filter.role)"
				v-model.convert="filter.communityId"
				:options="[{ value: '', label: 'Todas' }, ...communityOptions]"
				:convert-fn="option => option.value"
			>
				Comunidad
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ value ? communityName(value as string) : 'Todas' }}
				</template>
			</LnxSelect>
			<LnxInput v-model="search" type="search">
				Buscar por nombre o email
			</LnxInput>
		</div>

		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>
		<p v-else-if="loading && !accounts.length" class="hint" aria-busy="true">
			Cargando…
		</p>
		<ul v-else-if="shown.length" class="list">
			<li v-for="account in shown" :key="account.id" class="account">
				<div class="who">
					<strong>{{ account.name }}<template v-if="account.id === me?.id"> (tú)</template></strong>
					<small>{{ account.email || 'Entra con su carta de acceso' }}</small>
					<small>
						{{ livesIn(account.role) ? communityName(account.communityId)
							: account.role === 'admin' ? `${account.communityIds?.length ?? 0} comunidades${account.officeId ? ' · equipo de otro despacho' : ''}`
								: 'Todas las comunidades' }}
					</small>
				</div>
				<span class="badges">
					<span v-if="account.blocked" class="badge blocked">Bloqueada</span>
					<span class="badge">{{ roles[account.role]?.label }}</span>
				</span>
				<div v-if="account.id !== me?.id" class="actions">
					<LnxButton mode="clear" class="lnx-size-small" @click="edit(account)">
						<LnxIcon icon="lucide:pencil" />
						Editar
					</LnxButton>
					<LnxButton v-if="account.email" mode="clear" class="lnx-size-small" @click="sendReset(account)">
						<LnxIcon icon="lucide:key-round" />
						Contraseña nueva
					</LnxButton>
					<LnxButton mode="clear" class="lnx-size-small" variant="danger" @click="remove(account)">
						<LnxIcon icon="lucide:trash-2" />
						Quitar
					</LnxButton>
				</div>
			</li>
		</ul>
		<p v-else class="hint">
			No hay cuentas con ese filtro.
		</p>
		<p v-if="accounts.length >= 300" class="hint">
			Se muestran las 300 primeras: filtra por comunidad para ver el resto.
		</p>
	</section>
</template>

<style lang="scss" scoped>
.filters {
	margin-bottom: var(--lnx-spacing-3);
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: var(--lnx-spacing-3);
}

.list {
	display: flex;
	flex-direction: column;
}

.account {
	padding: var(--lnx-spacing-3) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-2) var(--lnx-spacing-3);

	& + & {
		border-top: 1px solid var(--color-gray-3);
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

.badges {
	display: flex;
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

.blocked {
	background: var(--color-secondary-accent);
	color: var(--color-gray-0);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: var(--lnx-spacing-1);
}

@media (max-width: 640px) {
	.account {
		grid-template-columns: minmax(0, 1fr) auto;

		.actions {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}
	}
}
</style>
