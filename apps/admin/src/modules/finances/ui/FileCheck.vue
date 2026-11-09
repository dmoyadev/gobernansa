<script setup lang="ts">
import type { FileIssue, FileKind } from '@gobernansa/shared/domain/fileChecks.ts';
import { plural } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref } from 'vue';

const props = withDefaults(defineProps<{
	issues: FileIssue[];
	kind?: FileKind;
	// Errors hold the download until it's confirmed
	held?: boolean;
	confirmLabel?: string;
}>(), { kind: undefined, held: false, confirmLabel: 'Descargar igualmente' });
const emit = defineEmits<{ confirm: []; dismiss: [] }>();

// A long list shows its first ones, errors first
const FIRST = 6;
const expanded = ref(false);
const sorted = computed(() => [...props.issues].sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error')));
const shown = computed(() => expanded.value ? sorted.value : sorted.value.slice(0, FIRST));
const errors = computed(() => props.issues.filter(issue => issue.level === 'error').length);
const warnings = computed(() => props.issues.length - errors.value);
const tone = computed(() => errors.value ? 'error' : warnings.value ? 'warning' : 'ok');

const summary = computed(() => [
	errors.value && plural(errors.value, 'error', 'errores'),
	warnings.value && plural(warnings.value, 'aviso', 'avisos'),
].filter(Boolean).join(' y ') || 'Todo correcto');
</script>

<template>
	<section class="file-check ux-appear" :class="`tone-${tone}`" role="status">
		<header>
			<LnxIcon :icon="tone === 'ok' ? 'lucide:circle-check' : tone === 'error' ? 'lucide:circle-x' : 'lucide:triangle-alert'" />
			<strong>Comprobación del fichero</strong>
			<span class="summary">{{ summary }}</span>
			<LnxButton mode="clear" class="size-small" shape="circle" aria-label="Cerrar" title="Cerrar" @click="emit('dismiss')">
				<LnxIcon icon="lucide:x" />
			</LnxButton>
		</header>
		<ul v-if="issues.length">
			<li v-for="(issue, index) in shown" :key="index" :class="issue.level">
				<LnxIcon class="mark" :icon="issue.level === 'error' ? 'lucide:circle-x' : 'lucide:triangle-alert'" />
				<span>
					{{ issue.message }}
					<small>{{ issue.where }}</small>
				</span>
			</li>
		</ul>
		<button v-if="sorted.length > FIRST" type="button" class="more" @click="expanded = !expanded">
			{{ expanded ? 'Ver menos' : `Ver los ${sorted.length - FIRST} restantes` }}
		</button>
		<p class="hint">
			<template v-if="kind === 'aeat'">
				Comprueba el diseño de registro y los datos. La primera vez, súbelo en la
				<a href="https://sede.agenciatributaria.gob.es/" target="_blank" rel="noopener">Sede de la AEAT</a>
				con «Presentación mediante fichero»: la Sede lo valida antes de firmarlo.
			</template>
			<template v-else-if="kind === 'sepa'">
				Comprueba el formato SEPA y los datos, no lo que dirá el banco. La primera vez, súbelo a la banca online de la comunidad sin firmarlo: el banco lo valida al recibirlo.
				<a href="https://www.europeanpaymentscouncil.eu/" target="_blank" rel="noopener">Normas SEPA del EPC</a>
			</template>
			<template v-else-if="kind === 'journal'">
				Comprueba que cada asiento cuadra. En ContaPlus, da de alta antes las subcuentas e importa primero una copia de prueba.
			</template>
		</p>
		<footer v-if="held">
			<span class="hint">Con errores, {{ kind === 'aeat' ? 'la AEAT' : kind === 'sepa' ? 'el banco' : 'el programa' }} puede rechazarlo.</span>
			<LnxButton mode="clear" class="size-small" @click="emit('dismiss')">
				Cancelar
			</LnxButton>
			<LnxButton class="size-small" variant="danger" @click="emit('confirm')">
				{{ confirmLabel }}
			</LnxButton>
		</footer>
	</section>
</template>

<style lang="scss" scoped>
.file-check {
	padding: var(--lnx-spacing-3) var(--lnx-spacing-4);
	border-radius: var(--lnx-radius-3);
	background: color-mix(in srgb, var(--color-primary) 8%, var(--color-gray-0));
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);

	&.tone-warning,
	&.tone-error {
		background: color-mix(in srgb, var(--color-secondary-accent) 9%, var(--color-gray-0));
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-primary);

		.summary {
			flex: 1;
			color: var(--color-gray-7);
		}
	}

	&.tone-warning header,
	&.tone-error header {
		color: var(--color-secondary-accent);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-1);
	}

	li {
		display: flex;
		align-items: flex-start;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-8);

		.mark {
			flex-shrink: 0;
			margin-top: 2px;
			color: var(--color-secondary-accent);
		}

		&.warning .mark {
			color: var(--color-gray-6);
		}

		small {
			display: block;
			color: var(--color-gray-6);
		}
	}

	.more {
		align-self: flex-start;
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		color: var(--color-primary);
		cursor: pointer;
	}

	.hint {
		color: var(--color-gray-6);

		a {
			color: var(--color-primary);
		}
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--lnx-spacing-2);

		.hint {
			flex: 1;
		}
	}
}
</style>
