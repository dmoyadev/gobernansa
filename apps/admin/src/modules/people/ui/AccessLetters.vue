<script setup lang="ts">
import type { Invitation } from '@gobernansa/shared/domain/user.ts';
import type { LetterTarget } from '../application/usePeople.ts';
import type { PrintedLetter } from './AccessLetterPrint.vue';
import { failure } from '@gobernansa/shared/application/errors.ts';
import { normalize, plural } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon, toast } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { letterMailto } from '@/modules/mail/application/mail.ts';
import { useProperties } from '@/modules/properties/application/useProperties.ts';
import { createLetters } from '../application/usePeople.ts';

/*
 * Access letters (B2.4): every owner without an account and every tenant gets one with their own code, which links their
 * account to their home the first time they use it. Prepared when first printed or sent, then kept until it's used
 */
const props = defineProps<{ communityId: string; community: string; invitations: (Invitation & { id: string })[]; canInvite: boolean }>();
const emit = defineEmits<{ print: [letters: PrintedLetter[]] }>();

const { data: properties } = useProperties(props.communityId);

interface Letter extends LetterTarget {
	key: string;
	places: string;
	email?: string;
	tenant: boolean;
	code?: string;
}

// shortcut: a letter keeps the properties it was prepared with; one bought later is added with its own letter (B10)
function codeOf(letter: LetterTarget) {
	return props.invitations.find(invitation => invitation.byCode && (letter.tenantOf
		? invitation.tenantOf === letter.tenantOf
		: invitation.propertyIds?.some(id => letter.propertyIds?.includes(id))))?.id;
}

// Owners by NIF, or by name, so whoever has a flat and a garage gets a single letter
const letters = computed<Letter[]>(() => {
	const sorted = [...properties.value].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
	const owners = new Map<string, Letter>();
	for (const property of sorted.filter(({ ownerUid }) => !ownerUid)) {
		const key = property.ownerNif || normalize(property.ownerName ?? '') || property.id;
		const letter = owners.get(key);
		if (letter) {
			letter.propertyIds!.push(property.id);
			letter.places += `, ${property.name}`;
		} else {
			owners.set(key, { key: `owner-${key}`, name: property.ownerName || `Propietario de ${property.name}`, propertyIds: [property.id], places: property.name, email: property.ownerEmail, tenant: false });
		}
	}
	const tenants = sorted.filter(property => property.tenantName && !property.tenantUid)
		.map(property => ({ key: `tenant-${property.id}`, name: property.tenantName!, tenantOf: property.id, places: property.name, email: property.tenantEmail, tenant: true }));
	return [...owners.values(), ...tenants].map(letter => ({ ...letter, code: codeOf(letter) }));
});

const unprepared = computed(() => letters.value.filter(letter => !letter.code).length);
const busy = ref(false);

// Those without a code get one first, in the same go
async function withCodes(chosen: Letter[]) {
	const missing = chosen.filter(letter => !letter.code);
	const codes = missing.length ? await createLetters(props.communityId, missing.map(({ name, propertyIds, tenantOf }) => ({ name, propertyIds, tenantOf }))) : [];
	return chosen.map(letter => ({ ...letter, code: letter.code ?? codes[missing.indexOf(letter)] }));
}

async function print(chosen: Letter[]) {
	busy.value = true;
	try {
		const ready = await withCodes(chosen);
		emit('print', ready.map(({ name, code, places }) => ({ name, code: code!, places })));
	} catch (error) {
		toast(failure('No se han podido preparar las cartas', error), { variant: 'danger' });
	} finally {
		busy.value = false;
	}
}

async function send(letter: Letter) {
	busy.value = true;
	try {
		const [ready] = await withCodes([letter]);
		window.location.href = letterMailto(letter.email!, letter.name, ready.code!, props.community);
	} catch (error) {
		toast(failure('No se ha podido preparar la carta', error), { variant: 'danger' });
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<section class="card">
		<h2>Cartas de acceso</h2>
		<p class="hint">
			Cada propietario sin cuenta y cada inquilino recibe una carta con su código y un QR. Con ella entra en la app desde cualquier móvil, sin email ni contraseña, y su cuenta queda unida a su casa.
		</p>
		<template v-if="letters.length">
			<div v-if="canInvite">
				<LnxButton :is-loading="busy" :disabled="busy" @click="print(letters)">
					<LnxIcon icon="lucide:printer" />
					Imprimir todas ({{ letters.length }})
				</LnxButton>
			</div>
			<ul class="list">
				<li v-for="letter in letters" :key="letter.key" class="person">
					<div class="who">
						<strong>{{ letter.name }}</strong>
						<small>{{ letter.tenant ? 'Inquilino' : 'Propietario' }} · {{ letter.places }}</small>
					</div>
					<span class="badge">{{ letter.code ? 'Preparada' : 'Sin preparar' }}</span>
					<div v-if="canInvite" class="person-actions">
						<LnxButton mode="clear" size="sm" :disabled="busy" @click="print([letter])">
							<LnxIcon icon="lucide:printer" />
							Imprimir
						</LnxButton>
						<LnxButton v-if="letter.email" mode="clear" size="sm" :disabled="busy" @click="send(letter)">
							<LnxIcon icon="lucide:mail" />
							Enviar desde tu correo
						</LnxButton>
					</div>
				</li>
			</ul>
		</template>
		<p v-else class="hint">
			Todos los propietarios e inquilinos del censo tienen ya su cuenta.
		</p>
		<p v-if="unprepared" class="hint">
			{{ plural(unprepared, 'carta se prepara', 'cartas se preparan') }} al imprimirla o enviarla.
		</p>
		<p class="hint">
			Si alguien pierde la suya sin haberla usado, cancélala en Invitaciones pendientes y aquí aparecerá otra nueva. Si ya la usó, desvincula su cuenta en Propiedades y quítalo de las cuentas.
		</p>
	</section>
</template>

<style lang="scss" scoped>
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

.person-actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: var(--lnx-spacing-1);
}

@media (max-width: 640px) {
	.person {
		grid-template-columns: minmax(0, 1fr) auto;

		.person-actions {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}
	}
}
</style>
