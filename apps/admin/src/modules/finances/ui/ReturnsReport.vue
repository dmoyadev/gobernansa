<script setup lang="ts">
import type { Remittance, RemittanceItem, ReturnMatch, ReturnReason } from '@gobernansa/shared/domain/sepa.ts';
import { failure } from '@gobernansa/shared/application/errors.ts';
import { decodeText } from '@gobernansa/shared/domain/bank.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { formatCents, toCents } from '@gobernansa/shared/domain/money.ts';
import { matchReturns, parseReturns, returnReasons } from '@gobernansa/shared/domain/sepa.ts';
import { LnxButton, LnxInput, toast, useShortcut } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import { logReturnsReport, returnDebit } from '../application/useRemittances.ts';

// The debits the bank returned, from its report (pain.002 or camt.054), matched with the remittances to register them
// all at once. open() picks the file
const props = defineProps<{ id: string; remittances: Remittance[]; disabled: boolean }>();
const emit = defineEmits<{ replace: [remittance: Remittance] }>();

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

const reportInput = useTemplateRef('reportInput');
const report = ref<{ name: string; matches: ReturnMatch[] }>();
const reportFee = ref('');
const reportError = ref<string>();
const applying = ref(false);
const ready = computed(() => report.value?.matches.filter(match => !match.problem) ?? []);
const unmatched = computed(() => report.value?.matches.filter(match => match.problem) ?? []);

useShortcut('i', () => reportInput.value?.click(), { description: 'Importar devoluciones', enabled: () => !props.disabled });

async function readReport(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file) {
		return;
	}
	const lines = parseReturns(decodeText(await file.arrayBuffer()));
	report.value = lines?.length ? { name: file.name, matches: matchReturns(lines, props.remittances) } : undefined;
	reportError.value = !lines
		? 'No es un informe de devoluciones del banco (pain.002 o camt.054).'
		: !lines.length ? 'El informe no trae ningún adeudo devuelto.' : undefined;
	reportFee.value = '';
}

// One by one, as registered by hand: each its charge, fee and activity entry
async function applyReport() {
	const fee = reportFee.value.trim() ? toCents(reportFee.value) : 0;
	if (!report.value || applying.value || !(fee >= 0)) {
		reportError.value = fee >= 0 ? undefined : 'Escribe unos gastos válidos, p. ej. 3,50, o déjalo vacío.';
		return;
	}
	const today = toDateString(new Date());
	const undos: (() => Promise<Remittance>)[] = [];
	const registered: RemittanceItem[] = [];
	const { name, matches } = report.value;
	applying.value = true;
	reportError.value = undefined;
	try {
		for (const { line, remittance, item } of ready.value) {
			const current = props.remittances.find(other => other.id === remittance!.id) ?? remittance!;
			const result = await returnDebit(props.id, current, item!, {
				reason: line.code as ReturnReason,
				date: line.date ?? today,
				...(fee ? { fee: { cents: fee } } : {}),
			});
			emit('replace', result.remittance);
			// Registered meanwhile elsewhere (another tab, by hand): nothing to undo
			if (result.undo) {
				undos.push(result.undo);
				registered.push(item!);
			}
		}
		report.value = undefined;
		toast(`${undos.length} ${undos.length === 1 ? 'devolución registrada' : 'devoluciones registradas'}${fee ? ' con sus gastos' : ''}`, {
			undo: async () => {
				for (const undo of undos.toReversed()) {
					emit('replace', await undo());
				}
			},
		});
	} catch (e) {
		reportError.value = failure(`Se han registrado ${undos.length} y la siguiente ha fallado`, e);
		// Those registered now show as such, trying again only registers the rest
		report.value = { name, matches: matchReturns(matches.map(match => match.line), props.remittances) };
	} finally {
		applying.value = false;
		logReturnsReport(props.id, name, registered, matches.filter(match => match.problem));
	}
}

defineExpose({ open: () => reportInput.value?.click() });
</script>

<template>
	<input ref="reportInput" type="file" accept=".xml,application/xml,text/xml" hidden @change="readReport">
	<p v-if="reportError && !report" class="error card-gap" role="alert">
		{{ reportError }}
	</p>
	<section v-if="report" class="card lnx-appear">
		<h2>Devoluciones de {{ report.name }}</h2>
		<p class="hint">
			Cada adeudo devuelto se busca en las remesas por su referencia (EndToEndId) y su importe. Al registrarlas, los recibos vuelven a quedar pendientes, como al hacerlo a mano.
		</p>
		<ul v-if="ready.length" class="list">
			<li v-for="match in ready" :key="match.line.endToEndId" class="charge">
				<div class="what">
					<span>{{ match.item!.propertyName }} · {{ match.item!.concept }}</span>
					<small class="tabular">
						{{ match.remittance!.reference }} · <span class="debt">{{ match.line.code }} {{ returnReasons[match.line.code as ReturnReason].toLowerCase() }}</span><template v-if="match.line.date">
							· {{ dateFormat.format(new Date(`${match.line.date}T00:00`)) }}
						</template>
					</small>
				</div>
				<strong class="tabular">{{ formatCents(match.item!.amount) }}</strong>
			</li>
		</ul>
		<p v-else class="hint">
			Ninguna devolución del fichero se puede registrar.
		</p>
		<template v-if="unmatched.length">
			<h3>Sin registrar</h3>
			<ul class="list">
				<li v-for="(match, index) in unmatched" :key="index" class="charge">
					<div class="what">
						<span class="tabular">{{ match.item ? `${match.item.propertyName} · ${match.item.concept}` : match.line.endToEndId || 'Sin referencia' }}</span>
						<small>{{ match.problem }}<template v-if="match.line.code"> · {{ match.line.code }}</template></small>
					</div>
					<span v-if="match.line.amount !== undefined" class="tabular">{{ formatCents(match.line.amount) }}</span>
				</li>
			</ul>
		</template>
		<div v-if="ready.length" class="fields">
			<LnxInput v-model="reportFee" inputmode="decimal" placeholder="0,00">
				Gastos por devolución (€)
				<template #helper>
					Opcional, se cargan a cada propiedad
				</template>
			</LnxInput>
		</div>
		<footer class="form-actions">
			<p v-if="reportError" class="error" role="alert">
				{{ reportError }}
			</p>
			<LnxButton mode="clear" @click="report = undefined">
				Cancelar
			</LnxButton>
			<LnxButton :is-loading="applying" :disabled="!ready.length" @click="applyReport()">
				Registrar {{ ready.length }} {{ ready.length === 1 ? 'devolución' : 'devoluciones' }}
			</LnxButton>
		</footer>
	</section>
</template>

<style lang="scss" scoped src="./remittances.scss" />
