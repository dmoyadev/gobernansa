<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { onBeforeMount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getCurrentUser } from 'vuefire';

const { completeMagicLink, sendMagicLink, signInWithPassword } = useAuth();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const loading = ref(false);
const emailSent = ref(false);
const error = ref<string>();

async function goToApp() {
	await router.replace((route.query.redirect as string | undefined) || '/');
}

onBeforeMount(async () => {
	try {
		await completeMagicLink();
		if (await getCurrentUser()) {
			await goToApp();
		}
	} catch (e) {
		error.value = (e as Error).message;
	}
});

// With a password it signs in right away, without it a sign-in link is emailed (they have a daily quota)
async function signIn() {
	error.value = undefined;
	loading.value = true;
	try {
		if (password.value) {
			await signInWithPassword(email.value, password.value);
			await goToApp();
			return;
		}

		await sendMagicLink(email.value);
		emailSent.value = true;
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
}
</script>

<template>
	<main>
		<form @submit.prevent="signIn()">
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
				type="password"
				autocomplete="current-password"
				:disabled="loading"
			>
				Contraseña
				<template #helper>
					Déjala vacía para recibir un enlace de acceso en tu email.
				</template>
			</LnxInput>

			<p v-if="emailSent" class="message" role="status">
				Te hemos enviado un enlace para entrar. Ábrelo en este mismo navegador.
			</p>
			<p v-if="error" class="message error" role="alert">
				No se ha podido iniciar sesión: {{ error }}
			</p>

			<LnxButton type="submit" :is-loading="loading" is-block>
				<LnxIcon icon="lucide:arrow-right" />
				{{ password ? 'Entrar' : 'Enviar enlace' }}
			</LnxButton>
		</form>
	</main>
</template>

<style lang="scss" scoped>
main {
	min-height: 100svh;
	padding: var(--lnx-spacing-4);
	display: grid;
	place-items: center;
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

.message {
	font-size: var(--lnx-font-size-small);
	color: var(--color-gray-7);

	&.error {
		color: var(--color-secondary-accent);
	}
}
</style>
