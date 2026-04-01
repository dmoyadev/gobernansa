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
import * as pkg from '../../../../package.json';
import router from '../../../router.ts';
import BackgroundImage from '../components/BackgroundImage.vue';
import useAuth from '../composables/useAuth.ts';

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

const email = ref<string>('');
const password = ref<string>('');

// Manage the error state of the form
const triedSubmit = ref(false);
watch(email, () => triedSubmit.value = false);
const isEmailValid = computed<boolean>(() => {
	return !triedSubmit.value
		|| (triedSubmit.value
			&& !!email.value
			&& /.[^\n\r}@\u2028\u2029]*@.+\..+/.test(email.value));
});
const errorLogin = ref<unknown>();
const emailSent = ref(false);
const loadingLogin = ref(false);

const route = useRoute();
async function doSignIn() {
	errorLogin.value = undefined;
	triedSubmit.value = true;

	if (!isEmailValid.value) {
		return;
	}

	loadingLogin.value = true;

	try {
		await useAuth().sendMagicLink(email.value);

		emailSent.value = true;
	} catch (e) {
		errorLogin.value = e as Error;
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
					v-if="(errorLogin as Error)?.message.includes('QUOTA_EXCEEDED')"
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
						<LnxIcon icon="mdi:close" />
						Error
					</template>
					<template v-else-if="emailSent && !password">
						<LnxIcon icon="mdi:check" />
						¡Enviado!
					</template>
					<template v-else-if="emailSent">
						<LnxIcon icon="mdi:check" />
						Entrando...
					</template>
					<template v-else>
						<LnxIcon icon="mdi:arrow-right-thick" />
						Entrar
					</template>
				</LnxButton>
			</section>
		</form>

		<small>
			v.{{ pkg.version }}
			<br>
			Continuando, indicas que aceptas nuestros
			<a href="#">Términos y condiciones</a> y la <a href="#">Política de privacidad</a>
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
