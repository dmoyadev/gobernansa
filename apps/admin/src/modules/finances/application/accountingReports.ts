import type { Account, JournalEntry } from '@gobernansa/shared/domain/accounting.ts';
import type { Budget } from '@gobernansa/shared/domain/finance.ts';
import type { Ref } from 'vue';
import { balances, balanceSheet, beforeClosing, incomeStatement, sortedAccounts } from '@gobernansa/shared/domain/accounting.ts';
import { computed, ref, watch } from 'vue';

// The books Contabilidad shows, by tab
export const views = {
	journal: 'Libro diario',
	ledger: 'Libro mayor',
	trial: 'Sumas y saldos',
	sheet: 'Balance de situación',
	results: 'Cuenta de resultados',
	chart: 'Plan de cuentas',
} as const;
export type View = keyof typeof views;

// Each book from one year's entries, and its rows for the CSV
export function useAccountingReports(entries: Readonly<Ref<JournalEntry[]>>, accounts: Readonly<Ref<Map<string, Account>>>, budget: () => Pick<Budget, 'items'> | undefined) {
	/* Libro diario */

	const journalTotal = computed(() => entries.value.reduce((sum, entry) => sum + entry.lines.reduce((lines, item) => lines + item.debit, 0), 0));

	/* Libro mayor */

	const ledgerAccount = ref('');
	const movedAccounts = computed(() => sortedAccounts(accounts.value).filter(account => entries.value.some(entry => entry.lines.some(item => item.account === account.key))));
	watch(movedAccounts, (moved) => {
		if (!moved.some(account => account.key === ledgerAccount.value)) {
			ledgerAccount.value = moved[0]?.key ?? '';
		}
	}, { immediate: true });
	const ledgerRows = computed(() => {
		let balance = 0;
		return entries.value.flatMap((entry, index) => entry.lines.filter(item => item.account === ledgerAccount.value).map((item) => {
			balance += item.debit - item.credit;
			return { number: index + 1, entry, ...item, balance };
		}));
	});

	/* Sumas y saldos */

	const trial = computed(() => Array.from(balances(beforeClosing(entries.value)), ([key, sum]) => ({ account: accounts.value.get(key) ?? { key, code: key, name: key }, ...sum }))
		.sort((a, b) => a.account.code.localeCompare(b.account.code)));
	const trialTotals = computed(() => trial.value.reduce((sum, row) => ({
		debit: sum.debit + row.debit,
		credit: sum.credit + row.credit,
		debtor: sum.debtor + Math.max(row.debit - row.credit, 0),
		creditor: sum.creditor + Math.max(row.credit - row.debit, 0),
	}), { debit: 0, credit: 0, debtor: 0, creditor: 0 }));

	/* Balance de situación y cuenta de resultados */

	const sheet = computed(() => balanceSheet(entries.value, accounts.value));
	const results = computed(() => incomeStatement(entries.value, accounts.value, budget()));

	function csvRows(view: View) {
		const rows: (string | number)[][] = [];
		if (view === 'journal') {
			rows.push(['Asiento', 'Fecha', 'Concepto', 'Cuenta', 'Nombre', 'Debe', 'Haber']);
			entries.value.forEach((entry, index) => entry.lines.forEach((item) => {
				const account = accounts.value.get(item.account);
				rows.push([String(index + 1), entry.date, entry.concept, account?.code ?? item.account, account?.name ?? '', item.debit, item.credit]);
			}));
		} else if (view === 'ledger') {
			rows.push(['Fecha', 'Asiento', 'Concepto', 'Debe', 'Haber', 'Saldo']);
			ledgerRows.value.forEach(row => rows.push([row.entry.date, String(row.number), row.entry.concept, row.debit, row.credit, row.balance]));
		} else if (view === 'trial') {
			rows.push(['Cuenta', 'Nombre', 'Debe', 'Haber', 'Saldo deudor', 'Saldo acreedor']);
			trial.value.forEach(row => rows.push([row.account.code, row.account.name, row.debit, row.credit, Math.max(row.debit - row.credit, 0), Math.max(row.credit - row.debit, 0)]));
		} else if (view === 'sheet') {
			rows.push(['Masa', 'Cuenta', 'Nombre', 'Importe']);
			sheet.value.sections.forEach(section => section.rows.forEach(row => rows.push([`${section.side === 'assets' ? 'Activo' : 'Patrimonio neto y pasivo'} · ${section.title}`, row.account.code, row.account.name, row.amount])));
		} else if (view === 'results') {
			rows.push(['Tipo', 'Cuenta', 'Nombre', 'Real', 'Presupuesto', 'Diferencia']);
			for (const [type, list] of [['Ingreso', results.value.income], ['Gasto', results.value.expenses]] as const) {
				list.forEach(row => rows.push([type, row.account.code, row.account.name, row.amount, row.budgeted ?? 0, row.amount - (row.budgeted ?? 0)]));
			}
		} else {
			rows.push(['Cuenta', 'Nombre']);
			sortedAccounts(accounts.value).forEach(account => rows.push([account.code, account.name]));
		}
		return rows;
	}

	return { journalTotal, ledgerAccount, movedAccounts, ledgerRows, trial, trialTotals, sheet, results, csvRows };
}
