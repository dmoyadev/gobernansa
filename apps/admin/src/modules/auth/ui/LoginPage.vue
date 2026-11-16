<script setup lang="ts">
import useAuth, { authErrorMessage } from '@gobernansa/shared/application/useAuth.ts';
import { vPasswordToggle } from '@gobernansa/shared/ui/passwordToggle.ts';
import { LnxButton, LnxIcon, LnxInput, LnxKbd, useShortcut } from 'lnxjs-components';
import { onBeforeMount, ref, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getCurrentUser } from 'vuefire';

const { signInWithPassword, signUp, resetPassword } = useAuth();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const loading = ref(false);
// Whoever was invited makes their account with the email it was sent to
const creating = ref(false);
const message = ref<string>();
const error = ref<string>();
watch([email, password, creating], () => error.value = undefined);
const form = useTemplateRef('form');

async function goToApp() {
	await router.replace((route.query.redirect as string | undefined) || '/');
}

onBeforeMount(async () => {
	if (await getCurrentUser()) {
		await goToApp();
	}
});

async function submit() {
	error.value = undefined;
	message.value = undefined;
	loading.value = true;
	try {
		await (creating.value ? signUp(email.value, password.value) : signInWithPassword(email.value, password.value));
		await goToApp();
	} catch (e) {
		error.value = authErrorMessage(e);
	} finally {
		loading.value = false;
	}
}

async function forgot() {
	error.value = undefined;
	if (!email.value.trim()) {
		error.value = 'Escribe tu email y te enviaremos un enlace para crear una contraseña nueva.';
		return;
	}
	loading.value = true;
	try {
		await resetPassword(email.value);
		message.value = 'Si ese email tiene cuenta, te hemos enviado un enlace para crear una contraseña nueva.';
	} catch (e) {
		error.value = authErrorMessage(e);
	} finally {
		loading.value = false;
	}
}

useShortcut('mod+enter', () => {
	if (!loading.value) {
		form.value?.requestSubmit();
	}
}, { description: 'Entrar' });
</script>

<template>
	<main>
		<form ref="form" class="lnx-appear" @submit.prevent="submit()">
			<header>
				<img src="@gobernansa/shared/assets/logo.svg" alt="gobernança" width="180">
				<h1>Administración</h1>
				<p>Gestiona las comunidades de gobernança.</p>
			</header>

			<LnxInput
				v-model="email"
				type="email"
				autocomplete="username"
				:disabled="loading"
				required
				autofocus
			>
				Email
			</LnxInput>

			<LnxInput
				v-model="password"
				v-password-toggle
				type="password"
				:autocomplete="creating ? 'new-password' : 'current-password'"
				:disabled="loading"
				minlength="6"
				required
			>
				Contraseña
				<template v-if="creating" #helper>
					Al menos 6 caracteres. Después te pediremos que confirmes tu email.
				</template>
			</LnxInput>

			<p v-if="message" class="message" role="status">
				{{ message }}
			</p>
			<p v-if="error" class="message error" role="alert">
				{{ error }}
			</p>

			<LnxButton type="submit" :is-loading="loading" is-block>
				<LnxIcon :icon="creating ? 'lucide:user-plus' : 'lucide:arrow-right'" />
				{{ creating ? 'Crear cuenta' : 'Entrar' }}
				<LnxKbd combo="mod+enter" />
			</LnxButton>
			<div class="links">
				<LnxButton v-if="!creating" mode="clear" :disabled="loading" @click="forgot()">
					He olvidado mi contraseña
				</LnxButton>
				<LnxButton mode="clear" @click="creating = !creating">
					{{ creating ? 'Ya tengo cuenta' : 'Me han invitado: crear cuenta' }}
				</LnxButton>
			</div>
		</form>

		<RouterLink to="/legal" class="legal">
			Información legal
		</RouterLink>
	</main>
</template>

<style lang="scss" scoped>
main {
	min-height: 100svh;
	padding: var(--lnx-spacing-4);
	display: grid;
	place-items: center;
	align-content: center;
	gap: var(--lnx-spacing-4);
}

form {
	width: 100%;
	max-width: 400px;
	padding: var(--lnx-spacing-6);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-4);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 8px 24px #0000000F;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
}

header {
	margin-bottom: var(--lnx-spacing-2);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	h1 {
		margin-top: var(--lnx-spacing-3);
		font-size: var(--lnx-font-size-bigger);
	}

	p {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

.legal {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.links {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: var(--lnx-spacing-2);
}

.message {
	font-size: var(--lnx-font-size-small);
	color: var(--color-gray-7);

	&.error {
		color: var(--color-secondary-accent);
	}
}
</style>
