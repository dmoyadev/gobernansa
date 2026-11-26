<script setup lang="ts">
import type { Account, CustomAccount } from '@gobernansa/shared/domain/accounting.ts';
import { failure } from '@gobernansa/shared/application/errors.ts';
import { isValidAccountCode, sortedAccounts } from '@gobernansa/shared/domain/accounting.ts';
import { LnxButton, LnxIcon, LnxInput, toast } from 'lnxjs-components';
import { reactive, ref } from 'vue';
import { saveCustomAccounts } from '../application/useAccounting.ts';

// The chart of accounts, and the ones the office adds to it. update() takes the added ones, also when undone, so a
// prop and not an event: the plan may be gone from the page by then
const props = defineProps<{ id: string; accounts: Map<string, Account>; custom: CustomAccount[]; moved: Account[]; year: number; closed: boolean; update: (custom: CustomAccount[]) => void }>();

const newAccount = reactive({ code: '', name: '' });
const accountError = ref<string>();
const accountSaving = ref(false);

async function writeCustom(next: CustomAccount[], summary: string, previous: CustomAccount[]) {
	accountSaving.value = true;
	try {
		await saveCustomAccounts(props.id, next, summary);
		props.update(next);
		toast(summary, {
			undo: async () => {
				await saveCustomAccounts(props.id, previous, 'Deshizo el cambio en el plan de cuentas');
				props.update(previous);
			},
		});
		return true;
	} catch (e) {
		accountError.value = failure('No se ha podido guardar', e);
		return false;
	} finally {
		accountSaving.value = false;
	}
}

async function addAccount() {
	const code = newAccount.code.trim();
	const name = newAccount.name.trim();
	accountError.value = !isValidAccountCode(code)
		? 'El código son de 3 a 10 cifras y empieza por el grupo, del 1 al 7.'
		: sortedAccounts(props.accounts).some(account => account.code === code)
			? 'Ya hay una cuenta con ese código.'
			: !name ? 'Escribe el nombre de la cuenta.' : undefined;
	if (accountError.value) {
		return;
	}
	const previous = props.custom;
	if (await writeCustom([...previous, { code, name }], `Añadió la cuenta ${code} ${name}`, previous)) {
		newAccount.code = '';
		newAccount.name = '';
	}
}

async function removeAccount(account: Account) {
	if (props.moved.some(other => other.key === account.key)) {
		accountError.value = `La cuenta ${account.code} tiene apuntes en ${props.year}: quítalos antes de borrarla.`;
		return;
	}
	accountError.value = undefined;
	const previous = props.custom;
	await writeCustom(previous.filter(other => other.code !== account.key), `Borró la cuenta ${account.code} ${account.name}`, previous);
}
</script>

<template>
	<table>
		<thead>
			<tr>
				<th>Cuenta</th>
				<th>Nombre</th>
				<th class="no-print" />
			</tr>
		</thead>
		<tbody>
			<tr v-for="account in sortedAccounts(accounts)" :key="account.key">
				<td class="tabular">
					{{ account.code }}
				</td>
				<td>
					{{ account.name }}
					<small v-if="account.custom">Añadida</small>
				</td>
				<td class="amount no-print">
					<LnxButton
						v-if="account.custom && !closed"
						mode="clear"
						class="lnx-size-small"
						shape="circle"
						variant="danger"
						aria-label="Borrar cuenta"
						title="Borrar cuenta"
						:disabled="accountSaving"
						@click="removeAccount(account)"
					>
						<LnxIcon icon="lucide:trash-2" />
					</LnxButton>
				</td>
			</tr>
		</tbody>
	</table>
	<form class="add-account no-print" @submit.prevent="addAccount()">
		<LnxInput v-model="newAccount.code" inputmode="numeric" placeholder="6230001">
			Código
		</LnxInput>
		<LnxInput v-model="newAccount.name" placeholder="Asesoría jurídica">
			Nombre
		</LnxInput>
		<LnxButton type="submit" mode="outline" :is-loading="accountSaving">
			<LnxIcon icon="lucide:plus" />
			Añadir cuenta
		</LnxButton>
	</form>
	<p v-if="accountError" class="error no-print" role="alert">
		{{ accountError }}
	</p>
	<p class="note">
		Cada propietario, proveedor y partida del presupuesto tiene su subcuenta (4300, 4000 y el grupo 6 que le corresponde), numeradas por orden de nombre.
	</p>
</template>

<style lang="scss" scoped src="./accounting.scss" />
