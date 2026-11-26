<script setup lang="ts">
import type { BankMovement, GatewayPayment, MatchCandidate } from '@gobernansa/shared/domain/bank.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { PaymentOrder, Remittance } from '@gobernansa/shared/domain/sepa.ts';
import { failure } from '@gobernansa/shared/application/errors.ts';
import { accountLabel, commonConcepts, ibanAccount, matchCandidates, movementSources, similarity, suggestMatches } from '@gobernansa/shared/domain/bank.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { isValidIban } from '@gobernansa/shared/domain/fiscal.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxCheckbox, LnxIcon, LnxInput, LnxKbd, LnxSelect, toast, useShortcut } from 'lnxjs-components';
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { onRevalidate } from '@/app/ux/navigation.ts';
import { loadCommunity } from '@/modules/communities/application/useCommunities.ts';
import { ignoreMovement, loadBankMovements, loadGatewayPayments, matchMovement, unignoreMovement, unmatchMovement } from '../application/useBank.ts';
import { useBudget, useUnpaidCharges, useUnpaidInvoices } from '../application/useFinances.ts';
import { loadPaymentOrders } from '../application/usePaymentOrders.ts';
import { loadRemittances } from '../application/useRemittances.ts';
import BankFeedCard from './BankFeedCard.vue';
import BankImport from './BankImport.vue';

const props = defineProps<{ id: string }>();

// Reconciled movements are shown for this long, those still pending however old
const RECENT_DAYS = 90;
const DAY_MS = 86_400_000;

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
		loadError.value = failure('No se han podido cargar los movimientos', e);
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

/* Suggestions */

const candidates = computed(() => matchCandidates({ charges: unpaidCharges.value, invoices: unpaidInvoices.value, remittances: remittances.value, orders: orders.value, payments: payments.value }));
const suggestions = computed(() => suggestMatches(pending.value, candidates.value));

// Who the document is or its reference, without its concept: «cuota noviembre» is in many, a name or reference isn't
function identity(candidate: MatchCandidate) {
	if (candidate.kind === 'charges') {
		return unpaidCharges.value.filter(charge => candidate.ids.includes(charge.id)).map(charge => charge.ownerName ?? '').join(' ');
	}
	if (candidate.kind === 'expenses') {
		const invoice = unpaidInvoices.value.find(other => other.id === candidate.ids[0]);
		return `${invoice?.provider?.name ?? ''} ${invoice?.invoiceNumber ?? ''}`;
	}
	if (candidate.kind === 'remittance') {
		return remittances.value.find(other => other.id === candidate.ids[0])?.reference ?? '';
	}
	if (candidate.kind === 'paymentOrder') {
		return orders.value.find(other => other.id === candidate.ids[0])?.reference ?? '';
	}
	return candidate.reference ?? '';
}

const busyId = ref<string>();
const actionError = ref<string>();

// Safe to accept all at once: the amount matches and the movement names who it is or the reference
const safe = computed(() => pending.value.flatMap((movement) => {
	const suggestion = suggestions.value.get(movement.id);
	return suggestion && similarity(movement, { text: identity(suggestion.candidate) }) ? [{ movement, candidate: suggestion.candidate }] : [];
}));
const safeIds = computed(() => new Set(safe.value.map(({ movement }) => movement.id)));
const acceptingSafe = ref(false);

// One after another, each as accepting it alone; undone together
async function acceptSafe() {
	const pairs = safe.value;
	const matched: BankMovement[] = [];
	const kinds = new Set(pairs.map(({ candidate }) => candidate.kind));
	const reload = async () => {
		for (const kind of kinds) {
			await reloadDocuments({ kind });
		}
	};
	acceptingSafe.value = true;
	actionError.value = undefined;
	try {
		for (const { movement, candidate } of pairs) {
			const result = await matchMovement(props.id, movement, candidate, { remittances: remittances.value, orders: orders.value });
			replace(result);
			matched.push(result);
		}
	} catch (e) {
		actionError.value = failure(`Se han conciliado ${matched.length} y el siguiente no`, e);
	}
	// Stale, they'd only offer what's done already: coming back reads them again
	await reload().catch(() => undefined);
	acceptingSafe.value = false;
	if (matched.length) {
		toast(matched.length === 1 ? 'Movimiento conciliado' : `${matched.length} movimientos conciliados`, {
			undo: async () => {
				for (const movement of matched) {
					replace(await unmatchMovement(props.id, movement));
				}
				await reload();
			},
		});
	}
}

async function run(id: string, action: () => Promise<void>) {
	busyId.value = id;
	actionError.value = undefined;
	try {
		await action();
	} catch (e) {
		actionError.value = failure('No se ha podido hacer', e);
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

const importer = useTemplateRef('importer');

useShortcut('i', () => importer.value?.open(), { description: 'Importar un extracto' });

function addMovements(added: BankMovement[]) {
	movements.value = sortMovements([...movements.value, ...added]);
}

function dropMovements(removed: BankMovement[]) {
	const ids = new Set(removed.map(movement => movement.id));
	movements.value = movements.value.filter(movement => !ids.has(movement.id));
}
</script>

<template>
	<header class="page-header">
		<h1>Conciliación bancaria</h1>
		<LnxButton class="lnx-size-small" @click="importer?.open()">
			<LnxIcon icon="lucide:upload" />
			Importar extracto
			<LnxKbd combo="i" />
		</LnxButton>
	</header>

	<p class="intro hint">
		<LnxIcon icon="lucide:info" />
		Importa el extracto del banco en Norma 43 o CSV y concilia cada movimiento con su recibo, factura, remesa u orden de pago: quedan pagados en la fecha del banco.
	</p>

	<p v-if="loadError" class="error" role="alert">
		{{ loadError }}
		<LnxButton mode="clear" class="lnx-size-small" @click="loadError = undefined; load()">
			Reintentar
		</LnxButton>
	</p>
	<p v-if="chargesError || invoicesError" class="error" role="alert">
		{{ failure('No se han podido cargar los recibos o las facturas pendientes', chargesError ?? invoicesError) }}
	</p>

	<BankImport :id ref="importer" :account @imported="addMovements" @removed="dropMovements" />
	<section class="card">
		<h2>Saldos</h2>
		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li class="line">
				<span class="lnx-skeleton" style="width: 50%" />
				<span class="lnx-skeleton lnx-skeleton--small" style="width: 90px" />
			</li>
		</ul>
		<div v-for="balance in balances" v-else :key="balance.account" class="balances lnx-appear">
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

	<BankFeedCard :id v-model:community="community" :account :loading :candidates :waiting="pending.map(movement => movement.amount)" :opening="balances.find(balance => balance.account === account)?.statement" @imported="addMovements" />
	<section class="card">
		<div class="section-head">
			<h2>Por conciliar</h2>
			<LnxButton v-if="safe.length > 1" class="lnx-size-small" :is-loading="acceptingSafe" :disabled="!!busyId" @click="acceptSafe()">
				<LnxIcon icon="lucide:check-check" />
				Aceptar las {{ safe.length }} sugerencias seguras
			</LnxButton>
		</div>
		<p v-if="actionError" class="error" role="alert">
			{{ actionError }}
		</p>
		<ul v-if="loading" class="list" aria-busy="true" aria-label="Cargando">
			<li v-for="width in [55, 40, 65]" :key="width" class="item">
				<div class="row">
					<div class="what">
						<span class="lnx-skeleton" :style="{ width: `${width}%` }" />
						<span class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width - 15}%` }" />
					</div>
					<span class="lnx-skeleton lnx-skeleton--small" style="width: 80px" />
				</div>
			</li>
		</ul>
		<ul v-else-if="pending.length" class="list lnx-appear">
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
						<LnxButton mode="clear" class="lnx-size-small" :aria-expanded="panel?.id === movement.id && panel.mode === 'match'" @click="openPanel(movement, 'match')">
							Conciliar a mano
						</LnxButton>
						<LnxButton mode="clear" class="lnx-size-small" :aria-expanded="panel?.id === movement.id && panel.mode === 'ignore'" @click="openPanel(movement, 'ignore')">
							Apartar
						</LnxButton>
					</div>
				</div>

				<div v-if="suggestions.get(movement.id)" class="suggestion">
					<LnxIcon icon="lucide:sparkles" />
					<span class="what">
						<span>{{ suggestions.get(movement.id)!.candidate.label }}</span>
						<small>{{ safeIds.has(movement.id) ? 'Coinciden el importe y el nombre o la referencia' : suggestions.get(movement.id)!.score ? 'Coinciden el importe y alguna palabra del concepto' : 'Coincide el importe' }}</small>
					</span>
					<LnxButton class="lnx-size-small" :is-loading="busyId === movement.id" :disabled="acceptingSafe" @click="accept(movement, suggestions.get(movement.id)!.candidate)">
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
							class="lnx-size-small"
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
						<LnxButton type="submit" class="lnx-size-small" :is-loading="busyId === movement.id">
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
		<ul class="list lnx-appear">
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
					<LnxButton mode="clear" class="lnx-size-small" :is-loading="busyId === movement.id" @click="undoDone(movement)">
						Deshacer
					</LnxButton>
				</div>
			</li>
		</ul>
	</section>
</template>

<style lang="scss" scoped src="./bank.scss" />
