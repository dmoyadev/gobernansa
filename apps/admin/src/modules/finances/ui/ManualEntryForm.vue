<script setup lang="ts">
import type { Account, JournalLine, ManualEntry } from '@gobernansa/shared/domain/accounting.ts';
import { failure } from '@gobernansa/shared/application/errors.ts';
import { isBalanced, sortedAccounts } from '@gobernansa/shared/domain/accounting.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxDatePicker, LnxIcon, LnxInput, LnxSelect, useShortcut } from 'lnxjs-components';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import FormCard from '@/app/ux/FormCard.vue';
import { newId } from '@/app/ux/navigation.ts';
import { closeForm, openForm } from '@/app/ux/newForm.ts';

const props = defineProps<{
	year: number;
	accounts: Map<string, Account>;
	// Writes it and keeps it in the page's data, throwing when it can't
	save: (id: string, entry: { date: string; concept: string; lines: JournalLine[] }, existing?: ManualEntry) => Promise<void>;
}>();
// As it opens, so the page shows the journal it goes into
const emit = defineEmits<{ opening: [] }>();
// Open or not, for the page's «Nuevo»
const editing = defineModel<boolean>('editing', { required: true });

interface LineDraft { key: string; account: string; debit: string; credit: string }
const emptyLine = (): LineDraft => ({ key: newId(), account: '', debit: '', credit: '' });
const editor = ref<{ id: string; existing?: ManualEntry; date: string; concept: string; lines: LineDraft[] }>();
const saving = ref(false);
const formError = ref<string>();
const form = useTemplateRef('form');

// The parent accounts aren't used, each owner and provider has their own
const accountOptions = computed(() => sortedAccounts(props.accounts)
	.filter(account => account.key !== '4000' && account.key !== '4300')
	.map(account => ({ value: account.key, label: `${account.code} ${account.name}` })));

function accountLabel(key: string) {
	const account = props.accounts.get(key);
	return account ? `${account.code} ${account.name}` : key;
}

function defaultDate() {
	const today = toDateString(new Date());
	return today.startsWith(`${props.year}-`) ? today : `${props.year}-12-31`;
}

async function open(existing?: ManualEntry) {
	formError.value = undefined;
	await openForm(async () => {
		editor.value = existing
			? {
					id: existing.id,
					existing,
					date: existing.date,
					concept: existing.concept,
					lines: existing.lines.map(item => ({ key: newId(), account: item.account, debit: item.debit ? String(item.debit / 100).replace('.', ',') : '', credit: item.credit ? String(item.credit / 100).replace('.', ',') : '' })),
				}
			: { id: newId(), date: defaultDate(), concept: '', lines: [emptyLine(), emptyLine()] };
		editing.value = true;
		emit('opening');
		await nextTick();
		return form.value?.$el as HTMLElement | undefined;
	});
}

function cancel() {
	formError.value = undefined;
	void closeForm(form.value?.$el, () => {
		editor.value = undefined;
		editing.value = false;
	});
}

const parsedLines = computed(() => (editor.value?.lines ?? []).map(item => ({
	account: item.account,
	debit: item.debit.trim() ? toCents(item.debit) : 0,
	credit: item.credit.trim() ? toCents(item.credit) : 0,
})));
const draftDebit = computed(() => parsedLines.value.reduce((sum, item) => sum + (Number.isNaN(item.debit) ? 0 : item.debit), 0));
const draftCredit = computed(() => parsedLines.value.reduce((sum, item) => sum + (Number.isNaN(item.credit) ? 0 : item.credit), 0));

async function submit() {
	const draft = editor.value;
	if (!draft || saving.value) {
		return;
	}
	const lines: JournalLine[] = parsedLines.value.filter(item => item.account || item.debit || item.credit);
	formError.value = !draft.concept.trim()
		? 'Escribe el concepto.'
		: !draft.date.startsWith(`${props.year}-`)
				? `La fecha tiene que ser de ${props.year}.`
				: lines.some(item => !item.account)
					? 'Falta la cuenta de alguna línea.'
					: lines.some(item => Number.isNaN(item.debit) || Number.isNaN(item.credit))
						? 'Algún importe no es válido.'
						: !isBalanced(lines)
								? 'Cada línea va al debe o al haber, y el debe tiene que sumar lo mismo que el haber.'
								: undefined;
	if (formError.value) {
		return;
	}
	saving.value = true;
	try {
		await props.save(draft.id, { date: draft.date, concept: draft.concept.trim(), lines }, draft.existing);
		cancel();
	} catch (e) {
		formError.value = failure('No se ha podido guardar', e);
	} finally {
		saving.value = false;
	}
}

useShortcut('escape', cancel, { description: 'Cancelar el asiento', enabled: () => !!editor.value });

defineExpose({ open, cancel });
</script>

<template>
	<FormCard
		v-if="editor"
		ref="form"
		shortcut="Guardar el asiento"
		:title="editor.existing ? 'Editar asiento' : 'Nuevo asiento'"
		:saving="saving"
		@submit="submit()"
		@cancel="cancel()"
	>
		<div class="fields">
			<LnxDatePicker v-model="editor.date" value-format="iso-date" :min="`${year}-01-01`" :max="`${year}-12-31`" required>
				Fecha
			</LnxDatePicker>
			<LnxInput v-model="editor.concept" placeholder="Pago de retenciones del 3T (modelo 111)" required>
				Concepto
			</LnxInput>
		</div>
		<ul class="entry-lines">
			<li v-for="(item, index) in editor.lines" :key="item.key" class="entry-line">
				<LnxSelect
					v-model.convert="item.account"
					:options="accountOptions"
					:convert-fn="option => option.value"
					search-placeholder-text="Buscar cuenta..."
				>
					Cuenta
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ value ? accountLabel(value) : '' }}
					</template>
				</LnxSelect>
				<LnxInput v-model="item.debit" inputmode="decimal" placeholder="0,00" :disabled="!!item.credit.trim()">
					Debe (€)
				</LnxInput>
				<LnxInput v-model="item.credit" inputmode="decimal" placeholder="0,00" :disabled="!!item.debit.trim()">
					Haber (€)
				</LnxInput>
				<LnxButton
					mode="clear"
					size="sm"
					shape="circle"
					variant="danger"
					aria-label="Quitar línea"
					title="Quitar línea"
					:disabled="editor.lines.length <= 2"
					@click="editor.lines.splice(index, 1)"
				>
					<LnxIcon icon="lucide:trash-2" />
				</LnxButton>
			</li>
		</ul>
		<div>
			<LnxButton mode="clear" size="sm" @click="editor.lines.push(emptyLine())">
				<LnxIcon icon="lucide:plus" />
				Añadir línea
			</LnxButton>
		</div>
		<template #status>
			<p v-if="formError" class="error" role="alert">
				{{ formError }}
			</p>
			<span v-else class="hint tabular" :class="{ unbalanced: draftDebit !== draftCredit }">
				Debe {{ formatCents(draftDebit) }} · Haber {{ formatCents(draftCredit) }}<template v-if="draftDebit !== draftCredit"> · descuadre de {{ formatCents(Math.abs(draftDebit - draftCredit)) }}</template>
			</span>
		</template>
	</FormCard>
</template>

<style lang="scss" scoped>
// The card itself is the page's
h2 {
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	color: var(--color-gray-6);
	text-transform: uppercase;
	letter-spacing: .04em;
}

.fields {
	grid-template-columns: minmax(0, 220px) minmax(0, 1fr);

	@media (width <= 600px) {
		grid-template-columns: minmax(0, 1fr);
	}
}

.entry-lines {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.entry-line {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 130px 130px auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	@media (width <= 600px) {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;

		> :first-child {
			grid-column: 1 / -1;
		}
	}
}

.form-actions {
	.error,
	.hint {
		flex: 1;
	}

	.unbalanced {
		color: var(--color-secondary-accent);
	}
}
</style>
