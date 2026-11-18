<script setup lang="ts">
import type { BankMovement, MatchCandidate } from '@gobernansa/shared/domain/bank.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import { demoMovements, norma43 } from '@gobernansa/shared/domain/bank.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { Timestamp } from 'firebase/firestore';
import { LnxButton, LnxIcon, toast } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { downloadFile } from '@/app/ux/download.ts';
import { importMovements, saveBankFeed } from '../application/useBank.ts';

// The community's account linked to the test bank, which makes up movements from what's pending: the amounts still
// waiting, the receipts and invoices it could pay, and the last balance (opening) it goes on from
const props = defineProps<{ id: string; account: string; loading: boolean; candidates: MatchCandidate[]; waiting: number[]; opening?: number }>();
const emit = defineEmits<{ imported: [added: BankMovement[]] }>();
const community = defineModel<Community>('community');

// Made up for the test bank's first statement
const DEMO_OPENING = 1_234_567;
// PSD2 lets an aggregator read the account for 180 days before the owner consents again
const CONSENT_DAYS = 180;
const DAY_MS = 86_400_000;

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

const feed = computed(() => community.value?.bankFeed);
const consenting = ref(false);
const syncing = ref(false);
const feedError = ref<string>();

function demoData() {
	const today = toDateString(new Date());
	const opening = props.opening ?? DEMO_OPENING;
	return { today, opening, data: demoMovements({ account: props.account, today, opening, candidates: props.candidates, waiting: props.waiting }) };
}

async function sync(connect = false) {
	if (syncing.value || !props.account || !community.value) {
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
		emit('imported', added);
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
	if (!props.account || !community.value) {
		return;
	}
	const { today, opening, data } = demoData();
	const file = norma43({ account: props.account, holder: community.value.name, from: data[0].date, to: today, opening }, data);
	downloadFile(`extracto-ejemplo-${today}.n43`, file, 'text/plain');
}
</script>

<template>
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
			<LnxButton mode="clear" class="lnx-size-small" :disabled="!account" @click="downloadSample()">
				<LnxIcon icon="lucide:file-down" />
				Descargar extracto de ejemplo (Norma 43)
			</LnxButton>
			<template v-if="feed">
				<LnxButton mode="clear" class="lnx-size-small" @click="disconnect()">
					Desconectar
				</LnxButton>
				<LnxButton class="lnx-size-small" :is-loading="syncing" :disabled="!account" @click="sync()">
					<LnxIcon icon="lucide:refresh-cw" />
					Sincronizar
				</LnxButton>
			</template>
			<template v-else-if="consenting">
				<LnxButton mode="clear" class="lnx-size-small" @click="consenting = false">
					Cancelar
				</LnxButton>
				<LnxButton class="lnx-size-small" :is-loading="syncing" :disabled="!account" @click="sync(true)">
					Autorizar en el banco de pruebas
				</LnxButton>
			</template>
			<LnxButton v-else class="lnx-size-small" :disabled="!account || loading" @click="consenting = true">
				<LnxIcon icon="lucide:plug" />
				Conectar banco
			</LnxButton>
		</footer>
	</section>
</template>

<style lang="scss" scoped src="./bank.scss" />
