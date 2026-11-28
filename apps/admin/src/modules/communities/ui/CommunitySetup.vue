<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { isValidIban, isValidNif } from '@gobernansa/shared/domain/fiscal.ts';
import { readsOnly } from '@gobernansa/shared/domain/user.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref, watch } from 'vue';
import { useRevalidated } from '@/app/ux/navigation.ts';
import { hasBudget } from '@/modules/finances/application/useFinances.ts';

// C1: what a new community needs before it's of use, ticking itself off. The page's figures, plus the year's budget
const props = defineProps<{
	communityId: string;
	community?: Community;
	neighbours?: { properties: number; registered: number; invitations: number };
}>();

const { user } = useAuth();

// Once finished or put away it doesn't come back, nor reads the budget again
// ponytail: per browser, like the dashboard's layout
const storageKey = `gobernansa.admin.setup.${props.communityId}`;
function stored() {
	try {
		return !!localStorage.getItem(storageKey);
	} catch {
		return false;
	}
}
const closed = ref(stored());
function close() {
	closed.value = true;
	try {
		localStorage.setItem(storageKey, '1');
	} catch {
		// It will show again next time
	}
}

const year = new Date().getFullYear();
// 1 read, while the list is still there
const { data: budget } = useRevalidated(async () => ({ exists: closed.value || (await hasBudget(props.communityId, year)) }));

const steps = computed(() => {
	const { cif, iban } = props.community ?? {};
	const neighbours = props.neighbours;
	return [
		{ label: 'Datos fiscales', detail: 'El CIF y el IBAN, para los recibos y las remesas', to: 'info', done: !!cif && isValidNif(cif) && !!iban && isValidIban(iban) },
		{ label: 'Censo', detail: 'Las propiedades y sus coeficientes, desde Excel', to: 'import', done: !!neighbours?.properties },
		{ label: `Presupuesto de ${year}`, detail: 'Las cuotas del año salen de él', to: 'budget', done: !!budget.value?.exists },
		{ label: 'Vecinos', detail: 'Invítalos a la app del vecino', to: 'people', done: !!neighbours && neighbours.registered + neighbours.invitations > 0 },
	];
});
const done = computed(() => steps.value.filter(step => step.done).length);

// Shown once everything's read, so it doesn't flash on a community already set up
const loaded = computed(() => !closed.value && !!props.community && !!props.neighbours && !!budget.value);
const shown = computed(() => loaded.value && !!user.value && !readsOnly(user.value) && done.value < steps.value.length);
// Set up meanwhile, or already when first opened: closed for good, without a read the next time
watch(() => loaded.value && done.value === steps.value.length, finished => finished && close());
</script>

<template>
	<section v-if="shown" class="setup" aria-labelledby="setup-title">
		<header>
			<div>
				<h2 id="setup-title">
					Puesta en marcha
				</h2>
				<p>{{ done }} de {{ steps.length }} hechos. Se van tachando solos.</p>
			</div>
			<LnxButton size="sm" mode="clear" variant="grayscale" @click="close()">
				Ocultar
			</LnxButton>
		</header>
		<ol>
			<li v-for="step in steps" :key="step.to" :class="{ done: step.done }">
				<RouterLink :to="`/communities/${communityId}/${step.to}`">
					<LnxIcon :icon="step.done ? 'lucide:circle-check' : 'lucide:circle'" :size="20" />
					<span>
						<strong>{{ step.label }}</strong>
						<small>{{ step.detail }}</small>
					</span>
					<LnxIcon v-if="!step.done" class="arrow" icon="lucide:arrow-right" :size="16" />
				</RouterLink>
			</li>
		</ol>
	</section>
</template>

<style lang="scss" scoped>
.setup {
	margin-bottom: var(--lnx-spacing-4);
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
		margin-bottom: var(--lnx-spacing-3);

		p {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
		}
	}
}

ol {
	display: grid;
	// The four in a row on a laptop, two by two on a tablet, one under the other on a phone
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
	gap: var(--lnx-spacing-2);
}

a {
	height: 100%;
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
	padding: var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-1);
	color: var(--color-primary);
	text-decoration: none;

	&:hover {
		background: var(--color-gray-2);
	}

	span {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	strong {
		color: var(--color-gray-9);
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	.arrow {
		align-self: center;
	}
}

.done a {
	color: var(--color-success, var(--color-gray-6));

	strong {
		color: var(--color-gray-6);
		text-decoration: line-through;
	}
}
</style>
