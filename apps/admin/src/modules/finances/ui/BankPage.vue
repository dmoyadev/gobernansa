<script setup lang="ts">
import type { BankMovement, CsvColumns, GatewayPayment, MatchCandidate, MovementData, ParsedStatement } from '@gobernansa/shared/domain/bank.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { PaymentOrder, Remittance } from '@gobernansa/shared/domain/sepa.ts';
import { commonConcepts, csvMovements, decodeText, demoMovements, guessColumns, ibanAccount, matchCandidates, movementSources, norma43, parseCsv, parseNorma43, suggestMatches } from '@gobernansa/shared/domain/bank.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { isValidIban } from '@gobernansa/shared/domain/fiscal.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, LnxInput, LnxSelect } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { downloadFile } from '@/app/ux/download.ts';
import Kbd from '@/app/ux/Kbd.vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { toast } from '@/app/ux/toast.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { ignoreMovement, importMovements, loadBankMovements, loadGatewayPayments, matchMovement, removeMovements, saveBankFeed, unignoreMovement, unmatchMovement } from '../application/useBank.ts';
import { useBudget, useUnpaidCharges, useUnpaidInvoices } from '../application/useFinances.ts';
import { loadPaymentOrders } from '../application/usePaymentOrders.ts';
import { loadRemittances } from '../application/useRemittances.ts';

const props = defineProps<{ id: string }>();

// Reconciled movements are shown for this long, those still pending however old
const RECENT_DAYS = 90;
// Made up for the test bank's first statement
const DEMO_OPENING = 1_234_567;
// PSD2 lets an aggregator read the account for 180 days before the owner consents again
const CONSENT_DAYS = 180;
const DAY_MS = 86_400_000;
// A Norma 43 account header: 11, then bank, branch and account number. A CSV row starting with a date like 11/03 isn't
const NORMA43_HEADER_REGEX = /^11\d{18}/;

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
const kindLabels: Record<MatchCandidate['kind'], string> = { charges: 'Recibo', expenses: 'Factura', remittance: 'Remesa', paymentOrder: 'Orden de pago', payout: 'Pasarela de pago' };

const { data: unpaidCharges, error: chargesError } = useUnpaidCharges(props.id);
const { data: unpaidInvoices, error: invoicesError } = useUnpaidInvoices(props.id);

// The community, its movements, the remittances and orders and the recent online payments, read once: they only change here
const community = ref<Community>();
const movements = ref<BankMovement[]>([]);
const remittances = ref<Remittance[]>([]);
const orders = ref<PaymentOrder[]>([]);
const payments = ref<GatewayPayment[]>([]);
const loading = ref(true);
const loadError = ref<string>();
const since = toDateString(new Date(Date.now() - RECENT_DAYS * DAY_MS));

async function load() {
	try {
		[community.value, movements.value, remittances.value, orders.value, payments.value] = await Promise.all([
			loadCommunity(props.id),
			loadBankMovements(props.id, since),
			loadRemittances(props.id),
			loadPaymentOrders(props.id),
			loadGatewayPayments(props.id, since),
		]);
		loadError.value = undefined;
	} catch (e) {
		loadError.value = `No se han podido cargar los movimientos: ${(e as Error).message}`;
	} finally {
		loading.value = false;
	}
}

onMounted(load);
onRevalidate(load);

function formatDay(date: string) {
	return dateFormat.format(new Date(`${date}T00:00`));
}

function sortMovements(list: BankMovement[]) {
	return list.sort((a, b) => b.date.localeCompare(a.date) || b.position - a.position);
}

function replace(movement: BankMovement) {
	movements.value = movements.value.map(other => other.id === movement.id ? movement : other);
}

const pending = computed(() => movements.value.filter(movement => movement.status === 'pending'));
const done = computed(() => movements.value.filter(movement => movement.status !== 'pending'));
const account = computed(() => community.value?.iban && isValidIban(community.value.iban) ? ibanAccount(community.value.iban) : '');

/* Balances */

// For each account: the balance the bank last gave, what's still to reconcile, and the balance it explains
const balances = computed(() => Array.from(Map.groupBy(movements.value, movement => movement.account), ([key, list]) => {
	const last = list.filter(movement => movement.balance !== undefined).sort((a, b) => b.date.localeCompare(a.date) || b.position - a.position)[0];
	const open = list.filter(movement => movement.status === 'pending');
	const unreconciled = open.reduce((sum, movement) => sum + movement.amount, 0);
	return {
		account: key,
		ours: key === account.value,
		date: last?.date,
		statement: last?.balance,
		count: open.length,
		unreconciled,
		reconciled: last?.balance === undefined ? undefined : last.balance - unreconciled,
	};
}));

function lastBalance(key: string) {
	return balances.value.find(balance => balance.account === key)?.statement;
}

function accountLabel(key: string) {
	return key.length === 18 ? `${key.slice(0, 4)} ${key.slice(4, 8)} ···· ${key.slice(-4)}` : key;
}

/* Suggestions */

const candidates = computed(() => matchCandidates({ charges: unpaidCharges.value, invoices: unpaidInvoices.value, remittances: remittances.value, orders: orders.value, payments: payments.value }));
const suggestions = computed(() => suggestMatches(pending.value, candidates.value));

const busyId = ref<string>();
const actionError = ref<string>();

async function run(id: string, action: () => Promise<void>) {
	busyId.value = id;
	actionError.value = undefined;
	try {
		await action();
	} catch (e) {
		actionError.value = `No se ha podido hacer: ${(e as Error).message}`;
	} finally {
		busyId.value = undefined;
	}
}

// Remittances, orders and payouts' payments change with it, so they're read again after
async function reloadDocuments(candidate: Pick<MatchCandidate, 'kind'>) {
	if (candidate.kind === 'remittance') {
		remittances.value = await loadRemittances(props.id);
	} else if (candidate.kind === 'paymentOrder') {
		orders.value = await loadPaymentOrders(props.id);
	} else if (candidate.kind === 'payout') {
		payments.value = await loadGatewayPayments(props.id, since);
	}
}

async function accept(movement: BankMovement, candidate: MatchCandidate) {
	await run(movement.id, async () => {
		const matched = await matchMovement(props.id, movement, candidate, { remittances: remittances.value, orders: orders.value });
		replace(matched);
		closePanel();
		await reloadDocuments(candidate);
		toast(`Conciliado con ${candidate.label}`, {
			undo: async () => {
				replace(await unmatchMovement(props.id, matched));
				await reloadDocuments(candidate);
			},
		});
	});
}

async function undoDone(movement: BankMovement) {
	await run(movement.id, async () => {
		if (movement.status === 'matched') {
			replace(await unmatchMovement(props.id, movement));
			await reloadDocuments(movement.match!);
			toast('Conciliación deshecha: el movimiento vuelve a estar pendiente');
		} else {
			replace(await unignoreMovement(props.id, movement));
			toast('El movimiento vuelve a estar pendiente');
		}
	});
}

/* Manual matching and ignoring, one movement at a time */

const panel = ref<{ id: string; mode: 'match' | 'ignore' }>();
const search = ref('');
const picked = ref<string[]>([]);
const ignoreForm = ref({ note: '', asExpense: false, itemId: '' });
const ignoreYear = ref(new Date().getFullYear());
const { data: budget } = useBudget(props.id, ignoreYear);
const itemOptions = computed(() => [{ value: '', label: 'Sin partida' }, ...(budget.value?.items ?? []).map(item => ({ value: item.id, label: item.name }))]);

function openPanel(movement: BankMovement, mode: 'match' | 'ignore') {
	if (panel.value?.id === movement.id && panel.value.mode === mode) {
		closePanel();
		return;
	}
	panel.value = { id: movement.id, mode };
	search.value = '';
	picked.value = [];
	ignoreForm.value = { note: movement.commonConcept === '17' ? 'Comisión del banco' : '', asExpense: movement.amount < 0 && movement.commonConcept === '17', itemId: '' };
	ignoreYear.value = Number(movement.date.slice(0, 4));
}

function closePanel() {
	panel.value = undefined;
}

function keyOf(candidate: MatchCandidate) {
	return `${candidate.kind}:${candidate.ids.join(',')}`;
}

// What a movement can be matched with by hand: one document at a time, of its sign
function manualOptions(movement: BankMovement) {
	const words = search.value.trim().toLowerCase();
	return candidates.value
		.filter(candidate => (candidate.kind !== 'charges' || candidate.ids.length === 1) && Math.sign(candidate.amount) === Math.sign(movement.amount))
		.filter(candidate => !words || `${candidate.label} ${candidate.text}`.toLowerCase().includes(words))
		.sort((a, b) => Math.abs(a.amount - movement.amount) - Math.abs(b.amount - movement.amount));
}

// Several charges or several invoices together, or a single remittance or order
const pickedCandidate = computed<MatchCandidate | string | undefined>(() => {
	const chosen = candidates.value.filter(candidate => picked.value.includes(keyOf(candidate)));
	if (!chosen.length) {
		return undefined;
	}
	const kinds = new Set(chosen.map(candidate => candidate.kind));
	if (kinds.size > 1 || (chosen.length > 1 && (kinds.has('remittance') || kinds.has('paymentOrder') || kinds.has('payout')))) {
		return 'Solo se pueden juntar varios recibos o varias facturas.';
	}
	if (chosen.length === 1) {
		return chosen[0];
	}
	return {
		kind: chosen[0].kind,
		ids: chosen.flatMap(candidate => candidate.ids),
		amount: chosen.reduce((sum, candidate) => sum + candidate.amount, 0),
		label: `${chosen.length} ${chosen[0].kind === 'charges' ? 'recibos' : 'facturas'}: ${chosen.map(candidate => candidate.label).join(', ')}`,
		text: '',
	};
});

function pickedTotal() {
	return typeof pickedCandidate.value === 'object' ? pickedCandidate.value.amount : 0;
}

async function acceptManual(movement: BankMovement) {
	const candidate = pickedCandidate.value;
	if (typeof candidate === 'object' && candidate.amount === movement.amount) {
		await accept(movement, candidate);
	}
}

async function ignore(movement: BankMovement) {
	const { note, asExpense, itemId } = ignoreForm.value;
	const day = Timestamp.fromDate(new Date(`${movement.date}T12:00`));
	const expense = asExpense && movement.amount < 0
		? { itemId, concept: note.trim() || movement.concept, amount: -movement.amount, date: day, paidAt: day, paymentMethod: 'direct_debit' as const }
		: undefined;
	await run(movement.id, async () => {
		const ignored = await ignoreMovement(props.id, movement, note.trim(), expense);
		replace(ignored);
		closePanel();
		toast(expense ? 'Movimiento apartado y registrado como gasto' : 'Movimiento apartado sin conciliar', {
			undo: async () => replace(await unignoreMovement(props.id, ignored)),
		});
	});
}

/* Import */

const fileInput = useTemplateRef('fileInput');
const draft = ref<{ name: string; statement?: ParsedStatement; rows?: string[][]; columns?: CsvColumns }>();
const importing = ref(false);
const importError = ref<string>();

useShortcut('i', () => fileInput.value?.click(), 'Importar un extracto');

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
const csvResult = computed(() => draft.value?.rows && draft.value.columns ? csvMovements(draft.value.rows, draft.value.columns, account.value || 'CSV') : undefined);

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
		movements.value = sortMovements([...movements.value, ...added]);
		const repeated = draftMovements.value.length - added.length;
		draft.value = undefined;
		toast(`${added.length} ${added.length === 1 ? 'movimiento importado' : 'movimientos importados'}${repeated ? `, ${repeated} ya estaban` : ''}`, added.length
			? {
					undo: async () => {
						await removeMovements(props.id, added, `el extracto ${name}`);
						const ids = new Set(added.map(movement => movement.id));
						movements.value = movements.value.filter(movement => !ids.has(movement.id));
					},
				}
			: {});
	} catch (e) {
		importError.value = `No se ha podido importar: ${(e as Error).message}`;
	} finally {
		importing.value = false;
	}
}

/* Bank connection in test mode */

const feed = computed(() => community.value?.bankFeed);
const consenting = ref(false);
const syncing = ref(false);
const feedError = ref<string>();

function demoData() {
	const today = toDateString(new Date());
	const opening = lastBalance(account.value) ?? DEMO_OPENING;
	return { today, opening, data: demoMovements({ account: account.value, today, opening, candidates: candidates.value, waiting: pending.value.map(movement => movement.amount) }) };
}

async function sync(connect = false) {
	if (syncing.value || !account.value || !community.value) {
		return;
	}
	syncing.value = true;
	feedError.value = undefined;
	try {
		const now = Timestamp.now();
		const next = { mode: 'demo' as const, connectedAt: feed.value?.connectedAt ?? now, syncedAt: now };
		const added = await importMovements(props.id, 'demo', demoData().data, 'el banco de pruebas');
		await saveBankFeed(props.id, next, connect ? 'Conectó la cuenta de la comunidad con el banco de pruebas' : 'Sincronizó los movimientos del banco de pruebas');
		community.value = { ...community.value, bankFeed: next };
		movements.value = sortMovements([...movements.value, ...added]);
		consenting.value = false;
		toast(added.length ? `${added.length} movimientos simulados nuevos` : 'No hay movimientos nuevos');
	} catch (e) {
		feedError.value = `No se ha podido sincronizar: ${(e as Error).message}`;
	} finally {
		syncing.value = false;
	}
}

async function disconnect() {
	if (!community.value) {
		return;
	}
	const previous = feed.value;
	try {
		await saveBankFeed(props.id, null, 'Desconectó la cuenta de la comunidad del banco de pruebas');
		community.value = { ...community.value, bankFeed: undefined };
		toast('Banco desconectado, los movimientos ya importados se quedan', {
			undo: async () => {
				await saveBankFeed(props.id, previous, 'Volvió a conectar la cuenta con el banco de pruebas');
				community.value = { ...community.value!, bankFeed: previous };
			},
		});
	} catch (e) {
		feedError.value = `No se ha podido desconectar: ${(e as Error).message}`;
	}
}

// The same movements the test bank would bring now, as the Norma 43 file a bank would send, to try the importer
function downloadSample() {
	if (!account.value || !community.value) {
		return;
	}
	const { today, opening, data } = demoData();
	const file = norma43({ account: account.value, holder: community.value.name, from: data[0].date, to: today, opening }, data);
	downloadFile(`extracto-ejemplo-${today}.n43`, file, 'text/plain');
}
</script>

<template>
	<header class="page-header">
		<h1>Conciliación bancaria</h1>
		<input ref="fileInput" type="file" accept=".n43,.aeb,.q43,.txt,.csv,text/plain,text/csv" hidden @change="readFile">
		<LnxButton class="size-small" @click="fileInput?.click()">
			<LnxIcon icon="lucide:upload" />
			Importar extracto
			<Kbd combo="i" />
		</LnxButton>
	</header>

	<p class="intro hint">
		<LnxIcon icon="lucide:info" />
		Importa el extracto del banco en Norma 43 o CSV y concilia cada movimiento con su recibo, factura, remesa u orden de pago: quedan pagados en la fecha del banco.
	</p>

	<p v-if="loadError" class="error" role="alert">
		{{ loadError }}
	</p>
	<p v-if="chargesError || invoicesError" class="error" role="alert">
		No se han podido cargar los recibos o las facturas pendientes: {{ (chargesError ?? invoicesError)?.message }}
	</p>

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
				<LnxSelect v-model.convert="draft.columns.date" :options="columnOptions" :convert-fn="option => option.value" search-placeholder-text="Buscar..." :placeholder="columnOptions[0]?.label">
					Fecha
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ columnOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
				<LnxSelect v-model.convert="draft.columns.concept" :options="columnOptions" :convert-fn="option => option.value" search-placeholder-text="Buscar..." :placeholder="columnOptions[0]?.label">
					Concepto
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ columnOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
				<LnxSelect v-model.convert="draft.columns.amount" :options="columnOptions" :convert-fn="option => option.value" search-placeholder-text="Buscar..." :placeholder="columnOptions[0]?.label">
					Importe
					<template #option="{ option }">
						{{ option.label }}
					</template>
					<template #optionInput="{ value }">
						{{ columnOptions.find(option => option.value === value)?.label }}
					</template>
				</LnxSelect>
				<LnxSelect v-model.convert="draft.columns.balance" :options="balanceOptions" :convert-fn="option => option.value" search-placeholder-text="Buscar..." :placeholder="columnOptions[0]?.label">
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

	<section class="card">
		<h2>Saldos</h2>
		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li class="line">
				<span class="skeleton-item" style="width: 50%" />
				<span class="skeleton-item skeleton-item--small" style="width: 90px" />
			</li>
		</ul>
		<div v-for="balance in balances" v-else :key="balance.account" class="balances ux-appear">
			<p class="hint tabular">
				Cuenta {{ accountLabel(balance.account) }}<template v-if="!balance.ours && account">
					· no es la cuenta de la comunidad
				</template>
			</p>
			<dl>
				<div>
					<dt>Saldo según el banco</dt>
					<dd class="tabular">
						{{ balance.statement === undefined ? '—' : formatCents(balance.statement) }}
					</dd>
					<small v-if="balance.date">a {{ formatDay(balance.date) }}</small>
				</div>
				<div>
					<dt>Pendiente de conciliar</dt>
					<dd class="tabular">
						{{ formatCents(balance.unreconciled) }}
					</dd>
					<small>{{ balance.count }} {{ balance.count === 1 ? 'movimiento' : 'movimientos' }}</small>
				</div>
				<div>
					<dt>Saldo conciliado</dt>
					<dd class="tabular" :class="{ ok: balance.count === 0 }">
						{{ balance.reconciled === undefined ? '—' : formatCents(balance.reconciled) }}
					</dd>
					<small>{{ balance.count ? 'Lo que explican recibos, facturas y apuntes' : 'Todo conciliado' }}</small>
				</div>
			</dl>
		</div>
		<p v-if="!loading && !balances.length" class="hint">
			Aún no hay movimientos. Importa un extracto o conecta el banco.
		</p>
	</section>

	<section class="card">
		<h2>
			Conexión bancaria
			<span class="chip test">Modo de prueba — datos simulados</span>
		</h2>
		<p class="hint">
			Con un agregador bancario (PSD2, de pago) los movimientos llegarían solos cada día. Hasta contratarlo, el banco de pruebas simula movimientos con tus recibos y facturas pendientes, los abonos de la pasarela de pago de prueba (los pagos online de cada día, dos días después y sin comisión), comisiones y alguno que no casa con nada. No se conecta con ningún banco real ni tiene coste.
		</p>
		<p v-if="community && !account" class="warning">
			<LnxIcon icon="lucide:triangle-alert" />
			Falta el IBAN de la comunidad, o no es válido.
			<RouterLink :to="`/communities/${id}/info`">
				Complétalo en sus datos
			</RouterLink>
		</p>
		<p v-if="feedError" class="error" role="alert">
			{{ feedError }}
		</p>

		<div v-if="feed" class="connected">
			<LnxIcon icon="lucide:plug-zap" />
			<span class="what">
				<span>Conectada al banco de pruebas</span>
				<small>
					Desde el {{ dateFormat.format(feed.connectedAt.toDate()) }}, consentimiento hasta el {{ dateFormat.format(new Date(feed.connectedAt.toMillis() + CONSENT_DAYS * DAY_MS)) }}<template v-if="feed.syncedAt"> · última sincronización el {{ dateFormat.format(feed.syncedAt.toDate()) }}</template>
				</small>
			</span>
		</div>
		<div v-else-if="consenting" class="consent">
			<p>
				El banco pedirá permiso para que la comunidad comparta, solo en lectura, los movimientos y el saldo de la cuenta <strong class="tabular">{{ community?.iban }}</strong> durante {{ CONSENT_DAYS }} días.
			</p>
			<p class="hint">
				En modo de prueba no se abre la web de ningún banco: el permiso se da aquí y los movimientos son simulados.
			</p>
		</div>

		<footer class="form-actions">
			<LnxButton mode="clear" class="size-small" :disabled="!account" @click="downloadSample()">
				<LnxIcon icon="lucide:file-down" />
				Descargar extracto de ejemplo (Norma 43)
			</LnxButton>
			<template v-if="feed">
				<LnxButton mode="clear" class="size-small" @click="disconnect()">
					Desconectar
				</LnxButton>
				<LnxButton class="size-small" :is-loading="syncing" :disabled="!account" @click="sync()">
					<LnxIcon icon="lucide:refresh-cw" />
					Sincronizar
				</LnxButton>
			</template>
			<template v-else-if="consenting">
				<LnxButton mode="clear" class="size-small" @click="consenting = false">
					Cancelar
				</LnxButton>
				<LnxButton class="size-small" :is-loading="syncing" :disabled="!account" @click="sync(true)">
					Autorizar en el banco de pruebas
				</LnxButton>
			</template>
			<LnxButton v-else class="size-small" :disabled="!account || loading" @click="consenting = true">
				<LnxIcon icon="lucide:plug" />
				Conectar banco
			</LnxButton>
		</footer>
	</section>

	<section class="card">
		<h2>Por conciliar</h2>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>
		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65]" :key="width" class="item">
				<div class="row">
					<div class="what">
						<span class="skeleton-item" :style="{ width: `${width}%` }" />
						<span class="skeleton-item skeleton-item--small" :style="{ width: `${width - 15}%` }" />
					</div>
					<span class="skeleton-item skeleton-item--small" style="width: 80px" />
				</div>
			</li>
		</ul>
		<ul v-else-if="pending.length" class="list ux-appear">
			<li v-for="movement in pending" :key="movement.id" class="item">
				<div class="row">
					<div class="what">
						<span>{{ movement.concept }}</span>
						<small class="tabular">
							{{ formatDay(movement.date) }}<template v-if="movement.reference"> · {{ movement.reference }}</template><template v-if="movement.commonConcept && commonConcepts[movement.commonConcept]"> · {{ commonConcepts[movement.commonConcept] }}</template> · {{ movementSources[movement.source] }}
						</small>
					</div>
					<strong class="tabular amount" :class="{ in: movement.amount > 0 }">{{ formatCents(movement.amount) }}</strong>
					<div class="item-actions">
						<LnxButton mode="clear" class="size-small" :aria-expanded="panel?.id === movement.id && panel.mode === 'match'" @click="openPanel(movement, 'match')">
							Conciliar a mano
						</LnxButton>
						<LnxButton mode="clear" class="size-small" :aria-expanded="panel?.id === movement.id && panel.mode === 'ignore'" @click="openPanel(movement, 'ignore')">
							Apartar
						</LnxButton>
					</div>
				</div>

				<div v-if="suggestions.get(movement.id)" class="suggestion">
					<LnxIcon icon="lucide:sparkles" />
					<span class="what">
						<span>{{ suggestions.get(movement.id)!.candidate.label }}</span>
						<small>{{ suggestions.get(movement.id)!.score ? 'Coinciden el importe y el nombre o la referencia' : 'Coincide el importe' }}</small>
					</span>
					<LnxButton class="size-small" :is-loading="busyId === movement.id" @click="accept(movement, suggestions.get(movement.id)!.candidate)">
						Aceptar
					</LnxButton>
				</div>

				<div v-if="panel?.id === movement.id && panel.mode === 'match'" class="panel">
					<LnxInput v-model="search" placeholder="Propiedad, proveedor, concepto…" aria-label="Buscar" />
					<ul v-if="manualOptions(movement).length" class="options">
						<li v-for="candidate in manualOptions(movement)" :key="keyOf(candidate)" class="line">
							<LnxCheckbox v-model="picked" :value="keyOf(candidate)">
								<span class="what">
									<span>{{ candidate.label }}</span>
									<small>{{ kindLabels[candidate.kind] }}<template v-if="candidate.date"> · {{ formatDay(candidate.date) }}</template></small>
								</span>
							</LnxCheckbox>
							<span class="tabular">{{ formatCents(candidate.amount) }}</span>
						</li>
					</ul>
					<p v-else class="hint">
						No hay {{ movement.amount > 0 ? 'recibos ni remesas pendientes' : 'facturas ni órdenes de pago pendientes' }} que coincidan.
					</p>
					<footer class="form-actions">
						<p v-if="typeof pickedCandidate === 'string'" class="error" role="alert">
							{{ pickedCandidate }}
						</p>
						<span v-else-if="pickedCandidate" class="hint tabular">
							Seleccionado {{ formatCents(pickedTotal()) }}<template v-if="pickedTotal() !== movement.amount"> · faltan {{ formatCents(movement.amount - pickedTotal()) }} para cuadrar</template>
						</span>
						<LnxButton
							class="size-small"
							:is-loading="busyId === movement.id"
							:disabled="typeof pickedCandidate !== 'object' || pickedCandidate.amount !== movement.amount"
							@click="acceptManual(movement)"
						>
							Conciliar
						</LnxButton>
					</footer>
				</div>

				<form v-if="panel?.id === movement.id && panel.mode === 'ignore'" class="panel" @submit.prevent="ignore(movement)">
					<p class="hint">
						Sale de la lista sin marcar nada como pagado, p. ej. una comisión o un traspaso entre cuentas de la comunidad.
					</p>
					<div class="fields">
						<LnxInput v-model="ignoreForm.note" placeholder="Comisión del banco, traspaso…">
							Nota
						</LnxInput>
						<LnxSelect
							v-if="ignoreForm.asExpense"
							v-model.convert="ignoreForm.itemId"
							:options="itemOptions"
							:convert-fn="option => option.value"
							search-placeholder-text="Buscar..."
							placeholder="Sin partida"
						>
							Partida de {{ ignoreYear }}
							<template #option="{ option }">
								{{ option.label }}
							</template>
							<template #optionInput="{ value }">
								{{ itemOptions.find(option => option.value === value)?.label }}
							</template>
						</LnxSelect>
					</div>
					<LnxCheckbox v-if="movement.amount < 0" v-model="ignoreForm.asExpense">
						Registrarlo como gasto pagado
					</LnxCheckbox>
					<footer class="form-actions">
						<LnxButton type="submit" class="size-small" :is-loading="busyId === movement.id">
							Apartar
						</LnxButton>
					</footer>
				</form>
			</li>
		</ul>
		<p v-else-if="movements.length" class="hint">
			Todo conciliado.
		</p>
		<p v-else class="hint">
			No hay movimientos por conciliar.
		</p>
	</section>

	<section v-if="done.length" class="card">
		<h2>Conciliados en los últimos {{ RECENT_DAYS }} días</h2>
		<ul class="list ux-appear">
			<li v-for="movement in done" :key="movement.id" class="item">
				<div class="row">
					<div class="what">
						<span>{{ movement.concept }}</span>
						<small>
							{{ formatDay(movement.date) }} ·
							<template v-if="movement.status === 'matched'">{{ movement.match?.label }}</template>
							<template v-else>Apartado{{ movement.note ? `: ${movement.note}` : '' }}{{ movement.expenseId ? ' · registrado como gasto' : '' }}</template>
						</small>
					</div>
					<strong class="tabular amount" :class="{ in: movement.amount > 0 }">{{ formatCents(movement.amount) }}</strong>
					<LnxButton mode="clear" class="size-small" :is-loading="busyId === movement.id" @click="undoDone(movement)">
						Deshacer
					</LnxButton>
				</div>
			</li>
		</ul>
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

.intro {
	margin-bottom: var(--lnx-spacing-4);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
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
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--lnx-spacing-2);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}
}

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);
}

.form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--lnx-spacing-2);

	.error,
	.hint {
		flex: 1;
	}
}

.list,
.options,
.problems {
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

.line {
	padding: var(--lnx-spacing-2) 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-3);

	:deep(.checkbox),
	:deep(.label) {
		min-width: 0;
	}
}

.what {
	display: flex;
	flex-direction: column;
	min-width: 0;
	text-align: left;

	small {
		overflow: hidden;
		color: var(--color-gray-6);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.amount {
	white-space: nowrap;

	&.in {
		color: var(--color-primary);
	}
}

.suggestion,
.connected {
	margin-top: var(--lnx-spacing-2);
	padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-2);
	background: var(--color-gray-1);
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--lnx-spacing-2);
	font-size: var(--lnx-font-size-small);
}

.connected {
	grid-template-columns: auto minmax(0, 1fr);
}

.panel {
	margin-top: var(--lnx-spacing-3);
	padding-left: var(--lnx-spacing-4);
	border-left: 2px solid var(--color-gray-3);
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.options {
	max-height: 320px;
	overflow-y: auto;
}

.consent {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}

.balances {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
		gap: var(--lnx-spacing-4);
	}

	dt {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	dd {
		font-size: var(--lnx-font-size-title);
		font-weight: var(--lnx-font-weight-bold);

		&.ok {
			color: var(--color-primary);
		}
	}

	small {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

.item-actions {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
}

.chip {
	padding: 2px var(--lnx-spacing-2);
	border-radius: 999px;
	background: var(--color-gray-2);
	font-size: var(--lnx-font-size-small);
	font-weight: normal;
	text-transform: none;
	letter-spacing: normal;
	white-space: nowrap;

	&.ok {
		color: var(--color-primary);
	}

	&.test {
		color: var(--color-gray-7);
	}
}

.hint {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);

	a {
		color: var(--color-primary);
	}
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

@media (max-width: 640px) {
	.row {
		grid-template-columns: minmax(0, 1fr) auto;

		.item-actions,
		> :deep(.lnx-button) {
			grid-column: 1 / -1;
		}
	}
}
</style>
