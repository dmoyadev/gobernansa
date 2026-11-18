<script setup lang="ts">
import type { BankMovement, CsvColumns, MovementData, ParsedStatement } from '@gobernansa/shared/domain/bank.ts';
import { accountLabel, csvMovements, decodeText, guessColumns, parseCsv, parseNorma43 } from '@gobernansa/shared/domain/bank.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxSelect, toast, useShortcut } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import { importMovements, removeMovements } from '../application/useBank.ts';

// A bank statement from a file, Norma 43 or CSV, shown to check before its movements are imported. open() picks the file
const props = defineProps<{ id: string; account: string }>();
const emit = defineEmits<{ imported: [added: BankMovement[]]; removed: [added: BankMovement[]] }>();

// A Norma 43 account header: 11, then bank, branch and account number. A CSV row starting with a date like 11/03 isn't
const NORMA43_HEADER_REGEX = /^11\d{18}/;
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

function formatDay(date: string) {
	return dateFormat.format(new Date(`${date}T00:00`));
}

const fileInput = useTemplateRef('fileInput');
const draft = ref<{ name: string; statement?: ParsedStatement; rows?: string[][]; columns?: CsvColumns }>();
const importing = ref(false);
const importError = ref<string>();

useShortcut('i', () => fileInput.value?.click(), { description: 'Importar un extracto' });

async function readFile(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file) {
		return;
	}
	importError.value = undefined;
	const content = decodeText(await file.arrayBuffer());
	const firstLine = content.trimStart().split('\n', 1)[0].trimEnd();
	if (NORMA43_HEADER_REGEX.test(firstLine) && firstLine.length <= 80) {
		draft.value = { name: file.name, statement: parseNorma43(content) };
	} else {
		const rows = parseCsv(content);
		draft.value = rows.length ? { name: file.name, rows, columns: guessColumns(rows[0]) } : undefined;
		importError.value = rows.length ? undefined : 'El fichero está vacío o no se entiende.';
	}
}

const columnOptions = computed(() => (draft.value?.rows?.[0] ?? []).map((cell, index) => ({ value: index, label: `Columna ${index + 1}${cell ? ` · ${cell}` : ''}` })));
const balanceOptions = computed(() => [{ value: -1, label: 'No tiene' }, ...columnOptions.value]);
const csvResult = computed(() => draft.value?.rows && draft.value.columns ? csvMovements(draft.value.rows, draft.value.columns, props.account || 'CSV') : undefined);

const draftMovements = computed<MovementData[]>(() => draft.value?.statement
	? draft.value.statement.accounts.flatMap(statementAccount => statementAccount.movements)
	: csvResult.value?.movements ?? []);

async function importDraft() {
	if (!draft.value || importing.value || !draftMovements.value.length || draft.value.statement?.errors.length) {
		return;
	}
	const { name, statement } = draft.value;
	importing.value = true;
	importError.value = undefined;
	try {
		const added = await importMovements(props.id, statement ? 'norma43' : 'csv', draftMovements.value, `el extracto ${name}`);
		emit('imported', added);
		const repeated = draftMovements.value.length - added.length;
		draft.value = undefined;
		toast(`${added.length} ${added.length === 1 ? 'movimiento importado' : 'movimientos importados'}${repeated ? `, ${repeated} ya estaban` : ''}`, added.length
			? {
					undo: async () => {
						await removeMovements(props.id, added, `el extracto ${name}`);
						emit('removed', added);
					},
				}
			: {});
	} catch (e) {
		importError.value = `No se ha podido importar: ${(e as Error).message}`;
	} finally {
		importing.value = false;
	}
}

defineExpose({ open: () => fileInput.value?.click() });
</script>

<template>
	<input ref="fileInput" type="file" accept=".n43,.aeb,.q43,.txt,.csv,text/plain,text/csv" hidden @change="readFile">
	<section v-if="draft" class="card">
		<h2>Importar {{ draft.name }}</h2>
		<template v-if="draft.statement">
			<ul v-if="draft.statement.errors.length" class="problems">
				<li v-for="problem in draft.statement.errors" :key="problem" class="error">
					{{ problem }}
				</li>
			</ul>
			<ul class="list">
				<li v-for="statementAccount in draft.statement.accounts" :key="statementAccount.account + statementAccount.from" class="line">
					<div class="what">
						<span class="tabular">Norma 43 · cuenta {{ accountLabel(statementAccount.account) }}<template v-if="statementAccount.holder"> · {{ statementAccount.holder }}</template></span>
						<small class="tabular">
							Del {{ formatDay(statementAccount.from) }} al {{ formatDay(statementAccount.to) }} · {{ statementAccount.movements.length }} movimientos · saldo {{ formatCents(statementAccount.opening) }} → {{ formatCents(statementAccount.closing) }}
						</small>
					</div>
					<span v-if="account && statementAccount.account !== account" class="chip">No es la cuenta de la comunidad</span>
					<span v-else-if="!draft.statement.errors.length" class="chip ok">Totales cuadrados</span>
				</li>
			</ul>
		</template>
		<template v-else-if="draft.columns && csvResult">
			<div class="fields">
				<LnxSelect v-model.convert="draft.columns.date" :options="columnOptions" :convert-fn="option => option.value" :placeholder="columnOptions[0]?.label">
					Fecha
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ columnOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
				<LnxSelect v-model.convert="draft.columns.concept" :options="columnOptions" :convert-fn="option => option.value" :placeholder="columnOptions[0]?.label">
					Concepto
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ columnOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
				<LnxSelect v-model.convert="draft.columns.amount" :options="columnOptions" :convert-fn="option => option.value" :placeholder="columnOptions[0]?.label">
					Importe
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ columnOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
				<LnxSelect v-model.convert="draft.columns.balance" :options="balanceOptions" :convert-fn="option => option.value" :placeholder="columnOptions[0]?.label">
					Saldo
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ balanceOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
			</div>
			<p class="hint">
				Importes con signo, en negativo los cargos. Se admiten «1.234,56» y fechas como 31/10/2026.
				<template v-if="csvResult.skipped">
					{{ csvResult.skipped }} {{ csvResult.skipped === 1 ? 'fila sin fecha o importe se salta' : 'filas sin fecha o importe se saltan' }} (cabeceras, totales…).
				</template>
			</p>
			<ul v-if="csvResult.movements.length" class="list">
				<li v-for="movement in csvResult.movements.slice(0, 3)" :key="movement.position" class="line">
					<div class="what">
						<span>{{ movement.concept }}</span>
						<small class="tabular">{{ formatDay(movement.date) }}<template v-if="movement.balance !== undefined"> · saldo {{ formatCents(movement.balance) }}</template></small>
					</div>
					<strong class="tabular amount" :class="{ in: movement.amount > 0 }">{{ formatCents(movement.amount) }}</strong>
				</li>
			</ul>
		</template>

		<footer class="form-actions">
			<p v-if="importError" class="error" role="alert">
				{{ importError }}
			</p>
			<span v-else class="hint">Los movimientos que ya estaban importados no se duplican.</span>
			<LnxButton mode="clear" @click="draft = undefined">
				Cancelar
			</LnxButton>
			<LnxButton :is-loading="importing" :disabled="!draftMovements.length || !!draft.statement?.errors.length" @click="importDraft()">
				Importar {{ draftMovements.length }} {{ draftMovements.length === 1 ? 'movimiento' : 'movimientos' }}
			</LnxButton>
		</footer>
	</section>
	<p v-else-if="importError" class="error" role="alert">
		{{ importError }}
	</p>
</template>

<style lang="scss" scoped src="./bank.scss" />
