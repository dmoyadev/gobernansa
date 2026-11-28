<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { ClaimStatus, InsuranceClaim } from '@gobernansa/shared/domain/issue.ts';
import type { useIssue } from '../application/useIssues.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { claimStatus } from '@gobernansa/shared/domain/issue.ts';
import { LnxButton, LnxIcon, LnxInput, LnxKbd, LnxTextarea, useEventListener } from 'lnxjs-components';
import { ref } from 'vue';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';

// The insurance box of an issue: the claim opened for the damage and how it goes
const props = defineProps<{
	communityId: string;
	claim?: InsuranceClaim;
	// Already read by the page, else read when opening a claim
	community?: Community;
	saveClaim: ReturnType<typeof useIssue>['saveClaim'];
}>();

const { user: me } = useAuth();

const claimColors: Record<ClaimStatus, string> = {
	opened: '#4fa2dc',
	expert: '#d97706',
	accepted: '#11ad70',
	rejected: '#dc2626',
	paid: '#15803d',
	closed: '#718096',
};

const copied = ref(false);

async function copyClaimNumber(number: string) {
	await navigator.clipboard.writeText(number);
	copied.value = true;
	setTimeout(() => copied.value = false, 1500);
}

const claimStatusOptions = Object.entries(claimStatus).map(([value, { label }]) => ({ value: value as ClaimStatus, label }));
const claimForm = ref<{ insurer: string; number: string; status: ClaimStatus; note: string }>();

// The insurer is taken from the community's insurance contact, read only when opening a claim
async function openClaimForm() {
	const claim = props.claim;
	if (claim) {
		claimForm.value = { insurer: claim.insurer, number: claim.number, status: claim.status, note: '' };
		return;
	}
	claimForm.value = { insurer: '', number: '', status: 'opened', note: '' };
	const loaded = props.community ?? await loadCommunity(props.communityId).catch(() => undefined);
	const insurer = loaded?.contacts?.find(contact => contact.type === 'insurance')?.name;
	if (insurer && claimForm.value && !claimForm.value.insurer) {
		claimForm.value.insurer = insurer;
	}
}

function submitClaim() {
	const form = claimForm.value;
	if (!form) {
		return;
	}
	claimForm.value = undefined;
	void optimistic(props.saveClaim(me.value!, { insurer: form.insurer.trim(), number: form.number.trim(), status: form.status, note: form.note.trim() }), {
		done: 'Parte guardado',
		failed: 'No se ha podido guardar el parte',
		onError: () => claimForm.value = form,
	});
}

function formatDate(date: Date, timeStyle?: 'short') {
	return date.toLocaleString('es', { dateStyle: 'medium', timeStyle });
}

// Escape closes the form
useEventListener(window, 'keydown', (event) => {
	if (event.key === 'Escape' && !event.defaultPrevented && claimForm.value) {
		event.preventDefault();
		claimForm.value = undefined;
	}
});
</script>

<template>
	<section class="card box">
		<header class="box-header">
			<span class="box-icon claim-icon"><LnxIcon icon="lucide:shield" :size="18" /></span>
			<h2>Seguro</h2>
			<LnxButton
				v-if="claim && !claimForm"
				mode="clear"
				size="sm"
				@click="openClaimForm()"
			>
				<LnxIcon icon="lucide:pencil" />
				Actualizar
			</LnxButton>
		</header>

		<template v-if="claim && !claimForm">
			<div class="claim-summary" :style="{ '--claim-color': claimColors[claim.status] }">
				<div>
					<strong>{{ claim.insurer }}</strong>
					<button
						v-if="claim.number"
						type="button"
						class="claim-number"
						:title="copied ? 'Copiado' : 'Copiar número de siniestro'"
						@click="copyClaimNumber(claim.number)"
					>
						Siniestro {{ claim.number }}
						<LnxIcon :icon="copied ? 'lucide:check' : 'lucide:copy'" :size="12" />
					</button>
					<small v-else class="hint">Sin número de siniestro</small>
				</div>
				<span class="claim-status">
					<LnxIcon :icon="claimStatus[claim.status].icon" :size="14" />
					{{ claimStatus[claim.status].label }}
				</span>
			</div>
			<ol class="timeline">
				<li
					v-for="entry in [...claim.history].reverse()"
					:key="entry.at.toMillis()"
					:style="{ '--claim-color': claimColors[entry.status] }"
				>
					<span class="timeline-icon"><LnxIcon :icon="claimStatus[entry.status].icon" :size="12" /></span>
					<div>
						<strong>{{ claimStatus[entry.status].label }}</strong>
						<small>{{ formatDate(entry.at.toDate(), 'short') }}</small>
						<p v-if="entry.note">
							{{ entry.note }}
						</p>
					</div>
				</li>
			</ol>
		</template>

		<div v-else-if="!claimForm" class="empty">
			<p class="hint">
				Si los daños los cubre el seguro, abre un parte y sigue aquí su tramitación.
			</p>
			<LnxButton mode="outline" @click="openClaimForm()">
				<LnxIcon icon="lucide:file-plus" />
				Abrir parte al seguro
			</LnxButton>
		</div>

		<form v-if="claimForm" class="claim lnx-appear" @submit.prevent="submitClaim()">
			<LnxInput v-model="claimForm.insurer" required>
				Aseguradora
			</LnxInput>
			<LnxInput v-model="claimForm.number">
				Número de siniestro
			</LnxInput>
			<fieldset class="claim-statuses">
				<legend>Estado</legend>
				<label v-for="option in claimStatusOptions" :key="option.value" :style="{ '--claim-color': claimColors[option.value] }">
					<input v-model="claimForm.status" type="radio" class="sr-only" name="claim-status" :value="option.value">
					<span><LnxIcon :icon="claimStatus[option.value].icon" :size="14" />{{ option.label }}</span>
				</label>
			</fieldset>
			<LnxTextarea v-model="claimForm.note" rows="2" placeholder="Visita del perito el martes, piden presupuesto…">
				Qué ha pasado
			</LnxTextarea>
			<footer class="form-actions">
				<LnxButton mode="clear" @click="claimForm = undefined">
					Cancelar
				</LnxButton>
				<LnxButton type="submit">
					<LnxIcon icon="lucide:check" />
					{{ claim ? 'Guardar' : 'Abrir parte' }}
					<LnxKbd combo="mod+enter" />
				</LnxButton>
			</footer>
		</form>
	</section>
</template>

<style lang="scss" scoped>
.claim-summary {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);

	> div {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-width: 0;
	}
}

.claim-number {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-gray-6);
	font-family: ui-monospace, monospace;
	font-size: var(--lnx-font-size-legal);
	white-space: nowrap;
	cursor: pointer;

	&:hover {
		color: var(--color-primary);
	}
}

.claim-status {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	gap: 4px;
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-5);
	background: color-mix(in srgb, var(--claim-color) 14%, var(--color-gray-0));
	color: var(--claim-color);
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
}

.timeline {
	display: flex;
	flex-direction: column;

	li {
		position: relative;
		display: flex;
		gap: var(--lnx-spacing-2);
		padding-bottom: var(--lnx-spacing-3);

		&:not(:last-child)::before {
			content: '';
			position: absolute;
			top: 22px;
			bottom: 0;
			left: 10px;
			width: 2px;
			background: var(--color-gray-3);
		}

		&:first-child .timeline-icon {
			background: var(--claim-color);
			color: var(--color-gray-0);
		}
	}

	div {
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-size: var(--lnx-font-size-small);
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-legal);
		font-variant-numeric: tabular-nums;
	}

	p {
		margin-top: 2px;
		color: var(--color-gray-8);
		white-space: pre-line;
	}
}

.timeline-icon {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	background: color-mix(in srgb, var(--claim-color) 14%, var(--color-gray-0));
	color: var(--claim-color);
}

.empty {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
}

.claim-statuses {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;

	legend {
		margin-bottom: var(--lnx-spacing-1);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-small);
	}

	span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px var(--lnx-spacing-2);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-5);
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-legal);
		cursor: pointer;
		transition: background-color var(--duration) var(--ease-out), border-color var(--duration) var(--ease-out), color var(--duration) var(--ease-out), scale var(--duration-fast) var(--ease-out);
	}

	label:hover input:not(:checked) + span {
		background: var(--color-gray-1);
	}

	label:active span {
		scale: var(--press-scale);
	}

	input:checked + span {
		border-color: var(--claim-color);
		background: color-mix(in srgb, var(--claim-color) 14%, var(--color-gray-0));
		color: var(--claim-color);
		font-weight: var(--lnx-font-weight-bold);
	}

	input:focus-visible + span {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
}

.claim {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}
</style>
