<script setup lang="ts">
import useAuth, { authErrorMessage } from '@gobernansa/shared/application/useAuth.ts';
import { parseInviteCode } from '@gobernansa/shared/domain/user.ts';
import { reportError } from '@gobernansa/shared/infrastructure/monitoring.ts';
import { vPasswordToggle } from '@gobernansa/shared/ui/passwordToggle.ts';
import { LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { onBeforeMount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { getCurrentUser } from 'vuefire';
import router from '@/app/router.ts';
import BackgroundImage from '@/app/ui/BackgroundImage.vue';
import { version } from '../../../../package.json';

// The letter's QR opens /login#codigo-XXXXXXXXXX: in the hash, so it never reaches a server's logs
const CODE_HASH = '#codigo-';

const route = useRoute();
const loading = ref(false);

// Neighbours get a letter with their access code (B2.4), so it's what the page asks first
const withCode = ref(true);
const code = ref('');
const codeError = ref<string>();
watch(code, () => codeError.value = undefined);

const email = ref('');
const password = ref('');
const errorLogin = ref<string>();
const resetSent = ref(false);
watch([email, password], () => errorLogin.value = undefined);

function enter() {
	return router.replace((route.query?.unauthorized as string) || '/');
}

onBeforeMount(async () => {
	const fromQr = route.hash.startsWith(CODE_HASH) ? parseInviteCode(route.hash.slice(CODE_HASH.length)) : '';
	if (fromQr) {
		window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
	}
	if (await getCurrentUser()) {
		// Already in: the letter's code adds that home to their account
		await (fromQr ? router.replace({ path: '/profile', query: { code: fromQr } }) : enter());
		return;
	}
	if (fromQr) {
		code.value = fromQr;
		await signInWithCode();
	}
});

async function signInWithCode() {
	loading.value = true;
	try {
		await useAuth().signInWithCode(code.value);
		await enter();
	} catch (error) {
		const invalid = (error as Error).message === 'INVALID_CODE';
		if (!invalid) {
			reportError(error, { action: 'Entrar con el código' });
		}
		codeError.value = invalid ? 'Ese código no es válido. Revisa que esté bien escrito o pide uno nuevo a tu administrador.' : authErrorMessage(error);
	} finally {
		loading.value = false;
	}
}

async function signIn() {
	loading.value = true;
	try {
		await useAuth().signInWithPassword(email.value, password.value);
		await enter();
	} catch (error) {
		errorLogin.value = authErrorMessage(error);
	} finally {
		loading.value = false;
	}
}

// Also to make one, for whoever was invited by email and never had a password
async function resetPassword() {
	if (!email.value.trim()) {
		errorLogin.value = 'Escribe tu email y te enviaremos un enlace para crear una contraseña nueva.';
		return;
	}
	loading.value = true;
	try {
		await useAuth().resetPassword(email.value);
		resetSent.value = true;
	} catch (error) {
		errorLogin.value = authErrorMessage(error);
	} finally {
		loading.value = false;
	}
}
</script>

<template>
	<header>
		<BackgroundImage />

		<img
			class="logo"
			src="@gobernansa/shared/assets/logo.svg"
			width="180"
			alt="Logo"
		>
	</header>

	<main>
		<h1>Tu hogar, en buenas manos.</h1>
		<p>
			Tu comunidad de vecinos ahora tiene
			<br>
			quien se preocupa por ella.
		</p>

		<form v-if="withCode" @submit.prevent="signInWithCode()">
			<section>
				<LnxInput
					v-model="code"
					:has-error="!!codeError"
					:disabled="loading"
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					placeholder="ABCDE-23456"
					required
					autofocus
				>
					Tu código de acceso
					<template #helper>
						Debería estar en la carta de tu administrador.
						<br>
						Si hay un QR, usa la cámara del móvil.
					</template>
					<template #error>
						{{ codeError }}
					</template>
				</LnxInput>

				<LnxButton type="submit" :loading="loading" :disabled="loading">
					<LnxIcon icon="lucide:arrow-right" />
					Entrar
				</LnxButton>
				<LnxButton mode="clear" @click="withCode = false">
					Entrar con email y contraseña
				</LnxButton>
			</section>
		</form>

		<form v-else @submit.prevent="signIn()">
			<section>
				<LnxInput
					v-model="email"
					type="email"
					:has-error="!!errorLogin"
					:disabled="loading"
					autocomplete="username"
					required
					autofocus
				>
					Tu email
					<template v-if="resetSent" #helper>
						Si ese email tiene cuenta, te hemos enviado un enlace para crear una contraseña nueva. Mira también en el correo no deseado.
					</template>
				</LnxInput>

				<LnxInput
					v-model="password"
					v-password-toggle
					type="password"
					:has-error="!!errorLogin"
					:disabled="loading"
					autocomplete="current-password"
					required
				>
					Tu contraseña
					<template #error>
						{{ errorLogin }}
					</template>
				</LnxInput>

				<LnxButton type="submit" :loading="loading" :disabled="loading">
					<LnxIcon icon="lucide:arrow-right" />
					Entrar
				</LnxButton>
				<LnxButton mode="clear" :disabled="loading" @click="resetPassword()">
					No tengo contraseña o la he olvidado
				</LnxButton>
				<LnxButton mode="clear" @click="withCode = true">
					Tengo una carta con un código
				</LnxButton>
			</section>
		</form>

		<small>
			v.{{ version }}
			<br>
			Continuando, indicas que aceptas nuestros
			<RouterLink to="/legal#terms">Términos y condiciones</RouterLink> y la <RouterLink to="/legal#privacy">Política de privacidad</RouterLink>
		</small>
	</main>
</template>

<style lang="scss" scoped>
header {
	height: 260px;
	position: relative;

	.logo {
		position: absolute;
		bottom: -8px;
		left: 20px;
		width: 50%;
		height: auto;
		object-fit: contain;
	}
}

main {
	padding: 20px;
	display: flex;
	flex-direction: column;
	min-height: calc(100svh - 260px);

	h1 {
		font-weight: bold;
		font-size: 18px;
		max-width: 265px;
	}

	p {
		font-size: var(--font-size-small);
		font-weight: 300;
		color: var(--color-primary);
	}

	form {
		margin-top: auto;
		margin-bottom: auto;
		display: flex;
		flex-direction: column;
		gap: 34px;

		section {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
	}

	small {
		margin-top: auto;
		align-self: center;
		display: block;
		font-size: var(--font-size-legal);
		color: var(--color-primary);
		text-align: center;
		max-width: 230px;

		a {
			color: var(--color-secondary-accent);
			font-size: var(--font-size-legal);
			text-decoration: underline;
		}
	}
}
</style>
