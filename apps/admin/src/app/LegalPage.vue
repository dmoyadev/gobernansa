<script setup lang="ts">
import { hasHolder, holder } from '@gobernansa/shared/domain/legal.ts';
import { LnxIcon } from 'lnxjs-components';
</script>

<template>
	<main class="legal">
		<RouterLink to="/" class="back">
			<LnxIcon icon="lucide:arrow-left" :size="16" />
			Volver
		</RouterLink>

		<header>
			<h1>Información legal</h1>
			<p>Para los despachos que usan gobernança admin. Última actualización: noviembre de 2026</p>
		</header>

		<nav aria-label="Secciones">
			<a v-if="hasHolder" href="#notice">Aviso legal</a>
			<a href="#privacy">Privacidad</a>
			<a href="#cookies">Cookies</a>
		</nav>

		<section v-if="hasHolder" id="notice">
			<h2>Aviso legal</h2>
			<p>
				gobernança es un servicio de {{ holder.name }}, con NIF {{ holder.nif }}{{ holder.address ? ` y domicilio en ${holder.address}` : '' }}.
				<template v-if="holder.email">
					Puedes escribirnos a <a :href="`mailto:${holder.email}`">{{ holder.email }}</a>.
				</template>
			</p>
		</section>

		<section id="privacy">
			<h2>Privacidad</h2>
			<h3>Los datos de tus comunidades</h3>
			<p>
				El despacho es el responsable de los datos de las comunidades que gestiona y de sus vecinos. gobernança los trata
				por cuenta del despacho, como encargado del tratamiento, solo para prestar el servicio y según el contrato de encargado
				que firmamos con cada despacho. Son tuyos y de tus comunidades: no los usamos para nada más ni los cedemos a nadie.
			</p>
			<h3>Los datos de quienes trabajáis en el despacho</h3>
			<ul>
				<li>Tu email y tu nombre, para que puedas entrar, y las comunidades que gestionas.</li>
				<li>Quién cambió qué y cuándo en cada comunidad, en su registro de actividad, que se guarda cinco años desde el final de cada año.</li>
				<li>Los errores técnicos que te salgan, con tu identificador de usuario y lo que hiciste justo antes, para corregirlos.</li>
				<li>
					Lo que haces en la plataforma, con la fecha, tu usuario y el navegador y sistema de tu dispositivo: cuándo entras,
					qué pantallas abres, qué descargas y cada cambio en los datos, con cómo estaban y cómo quedaron. Solo para la
					seguridad del servicio, y solo lo ve el equipo de gobernança.
				</li>
			</ul>
			<h3>Cuánto tiempo guardamos ese registro y los errores</h3>
			<ul>
				<li>Los errores técnicos, 30 días.</li>
				<li>Las pantallas, 90 días. Las de la ficha de una persona o de un inmueble, 12 meses.</li>
				<li>Las entradas y salidas, descargas, impresiones, «ver como vecino» y cambios de contraseña o email, 12 meses.</li>
				<li>
					Cómo estaban los datos antes de cada cambio: los de recibos, remesas, deudas, contabilidad, reservas, juntas, votos,
					actas, propiedades, coeficientes y facturas, hasta el 31 de diciembre del año siguiente; el resto, 90 días.
				</li>
				<li>Lo que hace el equipo de gobernança, como entrar, ver como otro usuario o restaurar una versión, 3 años.</li>
				<li>
					Pasado su plazo, cada entrada se borra entera en el mes siguiente, y de las copias de seguridad cuando se renuevan, salvo
					lo que haga falta para un fallo de seguridad, una reclamación o una petición de acceso, que se exporta cifrado y fechado
					antes de que caduque.
				</li>
				<li>Al terminar el contrato, después de entregar al despacho la exportación de cada comunidad, borramos todo su registro.</li>
			</ul>
			<h3>Dónde se guardan</h3>
			<p>
				En los servicios de Google Firebase: acceso, base de datos, notificaciones y Cloud Storage, donde están las fotos y
				vídeos de las incidencias y de los partes de trabajo. Google es nuestro subencargado, y figura en el contrato de encargado.
				Las fotos y vídeos subidos antes de pasar a Cloud Storage siguen en el servicio de imágenes que usábamos entonces, aunque
				se borre su incidencia, hasta que los pasemos o los borremos.
			</p>
			<h3>Tus derechos</h3>
			<p>
				Puedes pedir ver, corregir o borrar tus datos, u oponerte a su uso, escribiendo al equipo de gobernança.
				Si crees que no se han respetado, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).
			</p>
		</section>

		<section id="cookies">
			<h2>Cookies</h2>
			<p>
				No usamos cookies de publicidad ni de analítica. Tu navegador solo guarda lo necesario para que funcione: tu sesión,
				tus preferencias y tu email mientras terminas de entrar.
			</p>
		</section>
	</main>
</template>

<style lang="scss" scoped>
.legal {
	max-width: 720px;
	margin: 0 auto;
	padding: var(--lnx-spacing-6) var(--lnx-spacing-4) var(--lnx-spacing-8);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-5);
	color: var(--color-gray-8);
	line-height: 1.5;
}

.back {
	align-self: flex-start;
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
	text-decoration: none;
}

h1 {
	color: var(--color-gray-9);
	font-size: var(--lnx-font-size-title);
}

header p {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

nav {
	display: flex;
	flex-wrap: wrap;
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
		font-size: var(--lnx-font-size-subtitle);
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
