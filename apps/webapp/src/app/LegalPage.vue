<script setup lang="ts">
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheToolbar from '@/shared/ui/TheToolbar.vue';
</script>

<template>
	<TheToolbar title="Información legal" back="/profile" />

	<MainLayout class="legal">
		<header>
			<h1>Información legal</h1>
			<p>Última actualización: octubre de 2026</p>
		</header>

		<nav aria-label="Secciones">
			<RouterLink to="#privacy">
				Privacidad
			</RouterLink>
			<RouterLink to="#terms">
				Términos
			</RouterLink>
			<RouterLink to="#cookies">
				Cookies
			</RouterLink>
		</nav>

		<section id="privacy">
			<h2>Política de privacidad</h2>
			<p>
				Tu comunidad de propietarios usa gobernança para gestionarse, y es la responsable de tus datos.
				Aquí te contamos cuáles tratamos, para qué y quién puede verlos.
			</p>
			<h3>Qué datos tratamos</h3>
			<ul>
				<li>Tu email y tu nombre, para que puedas entrar.</li>
				<li>Las propiedades que tienes en la comunidad.</li>
				<li>Las incidencias, comentarios y votos que hagas.</li>
				<li>Los documentos que subas a tu perfil.</li>
				<li>Un identificador de tu dispositivo, solo si activas las notificaciones.</li>
			</ul>
			<h3>Quién puede verlos</h3>
			<ul>
				<li>Las incidencias, con sus fotos, las ve toda tu comunidad.</li>
				<li>Los documentos de tu perfil solo los ves tú.</li>
				<li>La administración de la comunidad ve lo necesario para gestionarla.</li>
			</ul>
			<h3>Dónde se guardan</h3>
			<p>
				En los servicios de Google Firebase (acceso, base de datos y notificaciones) y, las fotos de las incidencias, en Cloudinary.
				Los guardamos mientras tengas cuenta.
			</p>
			<h3>Tus derechos</h3>
			<p>
				Puedes pedir ver, corregir o borrar tus datos, u oponerte a su uso, a la administración de tu comunidad.
				Si crees que no se han respetado, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).
			</p>
		</section>

		<section id="terms">
			<h2>Términos y condiciones</h2>
			<p>
				gobernança sirve para que vecinos y administración se comuniquen y tengan a mano la información de la comunidad.
				No sustituye a las convocatorias ni a las actas oficiales, ni a los servicios de emergencia: si hay un peligro, llama al 112.
			</p>
			<h3>Uso responsable</h3>
			<ul>
				<li>Cuenta lo que pasa con respeto y de forma veraz.</li>
				<li>No publiques datos personales de otras personas en las incidencias.</li>
				<li>Eres responsable de lo que publicas. La administración puede retirar lo que no sea apropiado.</li>
			</ul>
			<h3>Disponibilidad</h3>
			<p>
				Intentamos que la app funcione siempre, pero puede haber cortes o cambios sin previo aviso.
			</p>
		</section>

		<section id="cookies">
			<h2>Política de cookies</h2>
			<p>
				No usamos cookies de publicidad ni de analítica.
				Tu navegador solo guarda lo necesario para que la app funcione: tu sesión, tus preferencias (como las notificaciones)
				y tu email mientras terminas de entrar.
			</p>
			<p>
				Las tipografías se cargan desde Google Fonts, que recibe la dirección IP de tu dispositivo para enviarlas.
			</p>
		</section>
	</MainLayout>
</template>

<style lang="scss" scoped>
.legal {
	padding-top: calc(var(--toolbar-height) + var(--lnx-spacing-2));
	// Without the tab bar below
	padding-bottom: var(--lnx-spacing-8);
	min-height: auto;
	color: var(--color-gray-8);
	line-height: 1.5;
}

header p {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

nav {
	display: flex;
	gap: var(--lnx-spacing-2);

	a {
		padding: var(--lnx-spacing-1) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-4);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
		text-decoration: none;
	}
}

section {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	h2 {
		color: var(--color-gray-9);
		font-size: 1.2rem;
	}

	h3 {
		margin-top: var(--lnx-spacing-2);
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-body);
	}

	ul {
		padding-left: var(--lnx-spacing-4);
		list-style: disc;
	}
}
</style>
