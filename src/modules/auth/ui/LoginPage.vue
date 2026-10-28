<script setup lang="ts">
import {
	BUTTON_VARIANTS,
	LnxButton,
	LnxIcon,
	LnxInput,
} from 'lnxjs-components';
import { computed, onBeforeMount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { getCurrentUser } from 'vuefire';
import router from '@/app/router.ts';
import BackgroundImage from '@/shared/ui/BackgroundImage.vue';
import { version } from '../../../../package.json';
import useAuth from '../application/useAuth.ts';

const EMAIL_REGEX = /.[^\n\r}@\u2028\u2029]*@.+\..+/;

const email = ref<string>('');
const password = ref<string>('');

// Manage the error state of the form
const triedSubmit = ref(false);
watch(email, () => triedSubmit.value = false);
const isEmailValid = computed<boolean>(() => {
	return !triedSubmit.value
		|| (triedSubmit.value
			&& !!email.value
			&& EMAIL_REGEX.test(email.value));
});
const errorLogin = ref<unknown>();
// Once the daily quota of sign-in emails runs out, users who set a password can still sign in with it
const askPassword = ref(false);
const emailSent = ref(false);
const loadingLogin = ref(false);

const route = useRoute();

onBeforeMount(async () => {
	try {
		await useAuth().completeMagicLink();

		const user = await getCurrentUser();
		if (user) {
			if (route.query?.unauthorized) {
				await router.replace(route.query.unauthorized as string);
				return;
			}

			await router.replace('/');
		}
	} catch (e) {
		errorLogin.value = e as Error;
	}
});

async function doSignIn() {
	errorLogin.value = undefined;
	triedSubmit.value = true;

	if (!isEmailValid.value) {
		return;
	}

	loadingLogin.value = true;

	try {
		if (password.value) {
			await useAuth().signInWithPassword(email.value, password.value);
			await router.replace((route.query?.unauthorized as string) || '/');
			return;
		}

		await useAuth().sendMagicLink(email.value);

		emailSent.value = true;
	} catch (e) {
		errorLogin.value = e as Error;
		askPassword.value ||= (e as Error).message.includes('QUOTA_EXCEEDED');
	} finally {
		loadingLogin.value = false;
	}
}
</script>

<template>
	<header>
		<BackgroundImage />

		<img
			class="logo"
			src="/logo.svg"
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

		<form @submit.prevent="doSignIn()">
			<section>
				<LnxInput
					v-model="email"
					type="email"
					:has-error="triedSubmit && !!errorLogin && !password"
					:disabled="loadingLogin"
					autocomplete="username"
					required
					autofocus
				>
					Introduce tu email
					<template #error>
						Ese email no está registrado: {{ errorLogin }}
					</template>

					<template
						v-if="triedSubmit && !errorLogin && emailSent && !password"
						#helper
					>
						Hemos enviado un enlace para iniciar sesión a tu correo electrónico. Revisa tu bandeja de entrada y haz clic en el enlace para acceder a tu cuenta.
					</template>
				</LnxInput>

				<LnxInput
					v-if="askPassword"
					v-model="password"
					type="password"
					:has-error="triedSubmit && !!errorLogin && !!password"
					:disabled="loadingLogin"
					autocomplete="password"
					required
				>
					Introduce tu contraseña
					<template #error>
						La contraseña no es correcta: {{ errorLogin }}
					</template>
				</LnxInput>

				<LnxButton
					type="submit"
					:color="(triedSubmit && errorLogin) ? BUTTON_VARIANTS.DANGER : BUTTON_VARIANTS.PRIMARY"
					:loading="loadingLogin"
					:disabled="!isEmailValid || loadingLogin || (emailSent && !password)"
				>
					<template v-if="(triedSubmit && errorLogin && !password)">
						<LnxIcon icon="lucide:x" />
						Error
					</template>
					<template v-else-if="emailSent && !password">
						<LnxIcon icon="lucide:check" />
						¡Enviado!
					</template>
					<template v-else-if="emailSent">
						<LnxIcon icon="lucide:check" />
						Entrando...
					</template>
					<template v-else>
						<LnxIcon icon="lucide:arrow-right" />
						Entrar
					</template>
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
