<script setup lang="ts">
import { formatInviteCode } from '@gobernansa/shared/domain/user.ts';
import { renderSVG } from 'uqr';
import { computed } from 'vue';
import { letterUrl, WEBAPP_URL } from '@/modules/mail/application/mail.ts';

export interface PrintedLetter {
	name: string;
	code: string;
	// The properties it's for, '' when it's for none (a relative, say)
	places: string;
}

// The access letters (B2.4), only on paper: one per page, with the QR that opens the app signed in
const props = defineProps<{ letters: PrintedLetter[]; community: string }>();

const host = new URL(WEBAPP_URL).host;
const pages = computed(() => props.letters.map(letter => ({
	...letter,
	formatted: formatInviteCode(letter.code),
	qr: renderSVG(letterUrl(letter.code), { ecc: 'M', border: 2 }),
})));
</script>

<template>
	<div class="letters">
		<article v-for="letter in pages" :key="letter.code" class="letter">
			<h1>{{ letter.name }}, ya puedes entrar en la app de tu comunidad</h1>
			<p>{{ [community, letter.places].filter(Boolean).join(' · ') }}</p>
			<div class="how">
				<!-- eslint-disable-next-line vue/no-v-html -- uqr's SVG of the link -->
				<div class="qr" v-html="letter.qr" />
				<ol>
					<li>Abre la cámara del móvil y apunta a este código QR. Toca el enlace que aparece.</li>
					<li>O entra en <strong>{{ host }}</strong> y escribe tu código:</li>
				</ol>
			</div>
			<p class="code">
				{{ letter.formatted }}
			</p>
			<p>
				Este código es tu llave: te sirve para entrar desde cualquier móvil, siempre que quieras. Guarda esta carta y no la compartas.
				Si la pierdes, avisa a tu administrador. Dentro de la app puedes añadir tu email para recuperar el acceso.
			</p>
		</article>
	</div>
</template>

<style lang="scss" scoped>
.letters {
	display: none;
}

@media print {
	.letters {
		display: block;
	}

	.letter {
		display: flex;
		flex-direction: column;
		gap: 16px;
		font-size: 14pt;
		line-height: 1.4;
		break-after: page;

		h1 {
			font-size: 22pt;
		}
	}

	.how {
		display: flex;
		align-items: center;
		gap: 24px;

		ol {
			padding-left: 1.2em;
		}
	}

	.qr {
		flex: none;
		width: 45mm;

		:deep(svg) {
			display: block;
			width: 100%;
			height: auto;
		}
	}

	.code {
		padding: 16px 0;
		border: 2px solid #000;
		border-radius: 12px;
		font-family: ui-monospace, monospace;
		font-size: 36pt;
		font-weight: bold;
		letter-spacing: .12em;
		text-align: center;
	}
}
</style>
