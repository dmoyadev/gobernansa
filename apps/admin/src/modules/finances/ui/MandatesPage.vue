<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { SepaMandate } from '@gobernansa/shared/domain/sepa.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { formatIban } from '@gobernansa/shared/domain/community.ts';
import { isValidIban, normalizeIban } from '@gobernansa/shared/domain/fiscal.ts';
import { creditorId, isValidBic, mandateStatuses, newMandateReference, sepaId } from '@gobernansa/shared/domain/sepa.ts';
import { LnxButton, LnxDatePicker, LnxIcon, LnxInput, LnxSelect, useConfirm } from 'lnxjs-components';
import { computed, onMounted, ref } from 'vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { optimistic } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { useCommunityProperties } from '../application/useFinances.ts';
import { saveMandate } from '../application/useRemittances.ts';

const props = defineProps<{ id: string }>();

const ask = useConfirm();

const SPACES_REGEX = /\s/g;
const statusOptions = Object.entries(mandateStatuses).map(([value, label]) => ({ value: value as SepaMandate['status'], label }));

const { data: properties, pending, error } = useCommunityProperties(props.id);

const community = ref<Community>();
const communityError = ref<string>();

async function load() {
	try {
		community.value = await loadCommunity(props.id);
	} catch (e) {
		communityError.value = `No se han podido cargar los datos de la comunidad: ${(e as Error).message}`;
	}
}

onMounted(load);
onRevalidate(load);

const creditor = computed(() => community.value?.cif ? creditorId(community.value.cif, community.value.sepaSuffix) : undefined);

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
const sorted = computed(() => [...properties.value].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })));
const active = computed(() => properties.value.filter(property => property.mandate?.status === 'active').length);
const loading = computed(() => pending.value && !properties.value.length);

// The one being edited, with its form as typed
const editingId = ref<string>();
const form = ref({ debtorName: '', iban: '', bic: '', reference: '', signedAt: '', status: 'active' as SepaMandate['status'] });
const formError = ref<string>();

function edit(property: Property) {
	const mandate = property.mandate;
	editingId.value = property.id;
	formError.value = undefined;
	form.value = {
		debtorName: mandate?.debtorName ?? property.ownerName ?? '',
		iban: mandate ? formatIban(mandate.iban) : '',
		bic: mandate?.bic ?? '',
		reference: mandate?.reference ?? newMandateReference(property.id),
		signedAt: mandate?.signedAt ?? toDateString(new Date()),
		status: mandate?.status ?? 'active',
	};
}

function findError(property: Property) {
	const reference = sepaId(form.value.reference);
	if (!form.value.debtorName.trim()) {
		return 'Escribe el titular de la cuenta.';
	}
	if (!isValidIban(form.value.iban)) {
		return 'Revisa el IBAN: no es válido, p. ej. ES91 2100 0418 4502 0005 1332.';
	}
	if (form.value.bic.trim() && !isValidBic(form.value.bic)) {
		return 'Revisa el BIC: son 8 u 11 letras y números, p. ej. CAIXESBBXXX.';
	}
	if (!reference) {
		return 'Escribe la referencia del mandato.';
	}
	if (properties.value.some(other => other.id !== property.id && other.mandate?.reference === reference)) {
		return 'Otra propiedad ya tiene un mandato con esa referencia.';
	}
	if (!form.value.signedAt || form.value.signedAt > toDateString(new Date())) {
		return 'La fecha de firma no puede ser futura.';
	}
}

function save(property: Property) {
	formError.value = findError(property);
	if (formError.value) {
		return;
	}
	const previous = property.mandate;
	const iban = normalizeIban(form.value.iban);
	const bic = form.value.bic.replace(SPACES_REGEX, '').toUpperCase();
	// A new account is debited first (FRST) again
	const firstRemittanceId = previous?.iban === iban ? previous.firstRemittanceId : undefined;
	const mandate: SepaMandate = {
		reference: sepaId(form.value.reference),
		debtorName: form.value.debtorName.trim(),
		iban,
		...(bic ? { bic } : {}),
		signedAt: form.value.signedAt,
		status: form.value.status,
		...(firstRemittanceId ? { firstRemittanceId } : {}),
	};
	editingId.value = undefined;
	void optimistic(saveMandate(props.id, property, mandate), {
		done: 'Mandato guardado',
		failed: 'No se ha podido guardar',
		revert: async () => saveMandate(props.id, property, previous ?? null),
	});
}

async function remove(property: Property) {
	const previous = property.mandate;
	if (!previous || !await ask({ title: `¿Quitar el mandato de ${property.name}?`, message: 'Sus recibos dejarán de domiciliarse.', confirmText: 'Quitar', variant: 'danger' })) {
		return;
	}
	editingId.value = undefined;
	void optimistic(saveMandate(props.id, property, null), {
		done: 'Mandato quitado',
		failed: 'No se ha podido quitar',
		revert: async () => saveMandate(props.id, property, previous),
	});
}
</script>

<template>
	<header class="page-header">
		<h1>Mandatos SEPA</h1>
	</header>

	<section class="card">
		<h2>Acreedor</h2>
		<p v-if="communityError" class="error" role="alert">
			{{ communityError }}
		</p>
		<dl v-if="community" class="creditor tabular">
			<div>
				<dt>Identificador de acreedor</dt>
				<dd>{{ creditor ?? 'Falta el CIF' }}</dd>
			</div>
			<div>
				<dt>Cuenta de abono</dt>
				<dd>
					{{ community.iban ? formatIban(community.iban) : 'Falta el IBAN' }}<template v-if="community.bic">
						· {{ community.bic }}
					</template>
				</dd>
			</div>
		</dl>
		<div v-else-if="!communityError" class="creditor" aria-busy="true">
			<span class="lnx-skeleton" style="width: 60%" />
			<span class="lnx-skeleton" style="width: 45%" />
		</div>
		<p v-if="community && (!community.cif || !community.iban)" class="warning">
			<LnxIcon icon="lucide:triangle-alert" />
			Para domiciliar recibos hacen falta el CIF y el IBAN de la comunidad.
			<RouterLink :to="`/communities/${id}/info`">
				Complétalos en sus datos
			</RouterLink>
		</p>
		<p class="hint">
			El identificador sale del CIF y del sufijo que asigne el banco (000 si no dice otro), que se cambia en los datos de la comunidad.
		</p>
	</section>

	<section class="card">
		<h2>Mandatos por propiedad</h2>
		<p v-if="error" class="error" role="alert">
			No se han podido cargar: {{ error.message }}
		</p>
		<p v-if="!loading && properties.length" class="hint">
			{{ active }} de {{ properties.length }} propiedades con mandato activo. Domiciliación SEPA Core, recurrente: la orden firmada la guarda la administración.
		</p>

		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65]" :key="width" class="item">
				<div class="row">
					<div class="what">
						<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
						<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width - 15}%` }" />
					</div>
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 90px" />
				</div>
			</li>
		</ul>
		<ul v-else-if="sorted.length" class="list lnx-appear">
			<li v-for="property in sorted" :key="property.id" class="item">
				<div class="row">
					<div class="what">
						<strong>{{ property.name }}</strong>
						<small class="tabular">
							<template v-if="property.mandate">
								{{ property.mandate.debtorName }} · {{ formatIban(property.mandate.iban) }} · {{ property.mandate.reference }}
							</template>
							<template v-else>{{ property.ownerName || 'Sin propietario' }}</template>
						</small>
					</div>
					<span v-if="property.mandate" class="chip" :class="{ ok: property.mandate.status === 'active' }">
						{{ mandateStatuses[property.mandate.status] }}
					</span>
					<span v-else class="chip">Sin mandato</span>
					<LnxButton mode="clear" class="lnx-size-small" @click="editingId === property.id ? editingId = undefined : edit(property)">
						{{ editingId === property.id ? 'Cerrar' : property.mandate ? 'Editar' : 'Añadir' }}
					</LnxButton>
				</div>

				<form v-if="editingId === property.id" class="mandate lnx-appear" @submit.prevent="save(property)">
					<div class="fields">
						<LnxInput v-model="form.debtorName" required>
							Titular de la cuenta
						</LnxInput>
						<LnxInput v-model="form.iban" placeholder="ES00 0000 0000 0000 0000 0000" required>
							IBAN
						</LnxInput>
						<LnxInput v-model="form.bic" placeholder="Opcional">
							BIC
						</LnxInput>
						<LnxInput v-model="form.reference" maxlength="35" required>
							Referencia del mandato
						</LnxInput>
						<LnxDatePicker v-model="form.signedAt" value-format="iso-date" :max="toDateString(new Date())" required>
							Fecha de firma
						</LnxDatePicker>
						<LnxSelect
							v-model.convert="form.status"
							:options="statusOptions"
							:convert-fn="option => option.value"
						>
							Estado
							<template #option="{ option }">
								{{ option.label }}
							</template>
							<template #optionInput="{ value }">
								{{ mandateStatuses[value as SepaMandate['status']] }}
							</template>
						</LnxSelect>
					</div>
					<p v-if="property.mandate?.firstRemittanceId" class="hint">
						Ya se ha cobrado con él: los siguientes adeudos van como recurrentes. Si cambia la cuenta, el siguiente irá como primero.
					</p>
					<p v-else-if="property.mandate" class="hint">
						Aún no se ha cobrado con él: el primer adeudo irá como primero (FRST).
					</p>
					<footer class="form-actions">
						<p v-if="formError" class="error" role="alert">
							{{ formError }}
						</p>
						<LnxButton v-if="property.mandate" mode="clear" variant="danger" @click="remove(property)">
							Quitar
						</LnxButton>
						<LnxButton type="submit">
							<LnxIcon icon="lucide:check" />
							Guardar
						</LnxButton>
					</footer>
				</form>
				<p v-else-if="property.mandate" class="hint signed">
					Firmado el {{ dateFormat.format(new Date(`${property.mandate.signedAt}T00:00`)) }}
				</p>
			</li>
		</ul>
		<p v-else class="hint">
			Aún no hay propiedades. Añádelas en el censo para domiciliar sus recibos.
		</p>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		font-size: var(--lnx-font-size-title);
	}
}

.card {
	margin-bottom: var(--lnx-spacing-5);
	padding: var(--lnx-spacing-5);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);

	h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.creditor {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: var(--lnx-spacing-3);

	dt {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	dd {
		font-weight: var(--lnx-font-weight-bold);
		overflow-wrap: anywhere;
	}
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	.error {
		flex: 1;
	}
}

.list {
	display: flex;
	flex-direction: column;
}

.item {
	padding: var(--lnx-spacing-3) 0;

	& + & {
		border-top: 1px solid var(--color-gray-3);
	}
}

.row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: center;
	gap: var(--lnx-spacing-3);
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;

	small {
		overflow: hidden;
		color: var(--color-gray-6);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.mandate {
	margin-top: var(--lnx-spacing-3);
	padding-left: var(--lnx-spacing-4);
	border-left: 2px solid var(--color-gray-3);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.signed {
	margin-top: var(--lnx-spacing-1);
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	white-space: nowrap;

	&.ok {
		color: var(--color-primary);
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.warning {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
	color: var(--color-gray-7);

	a {
		color: var(--color-primary);
	}
}

.error {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}
</style>
