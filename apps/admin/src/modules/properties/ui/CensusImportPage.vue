<script setup lang="ts">
import type { CensusColumns, CensusData, CensusField, CensusGroup, CensusRow } from '@gobernansa/shared/domain/census.ts';
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { Property } from '@gobernansa/shared/domain/property.ts';
import type { Sheet } from '@gobernansa/shared/utils/xlsx.ts';
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { toCsv } from '@gobernansa/shared/domain/accounting.ts';
import { decodeText, parseCsv } from '@gobernansa/shared/domain/bank.ts';
import { toDateString } from '@gobernansa/shared/domain/booking.ts';
import { censusFields, censusTemplate, communityFields, groupByCommunity, guessCensusColumns, guessHeaderRow, importedTotal, readCensus } from '@gobernansa/shared/domain/census.ts';
import { formatCoefficient, propertyTypeLabels } from '@gobernansa/shared/domain/property.ts';
import LnxCheckbox from '@gobernansa/shared/ui/LnxCheckbox.vue';
import LnxTextarea from '@gobernansa/shared/ui/LnxTextarea.vue';
import { plural } from '@gobernansa/shared/utils/helpers.ts';
import { columnIndex, columnLetter, readXlsx } from '@gobernansa/shared/utils/xlsx.ts';
import { LnxButton, LnxIcon, LnxSelect } from 'lnxjs-components';
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import BackButton from '@/app/ux/BackButton.vue';
import { downloadFile } from '@/app/ux/download.ts';
import Kbd from '@/app/ux/Kbd.vue';
import { newId, onRevalidate } from '@/app/ux/navigation.ts';
import { useShortcut } from '@/app/ux/shortcuts.ts';
import { toast } from '@/app/ux/toast.ts';
import { useCommunities } from '@/modules/communities/application/useCommunities.ts';
import { loadProperties } from '@/modules/finances/application/useExchange.ts';
import MailModeNote from '@/modules/mail/ui/MailModeNote.vue';
import { importCensus, inviteOwners } from '../application/importCensus.ts';

// With a community, its census. Without one, the portfolio's: several communities, each row saying its own
const props = defineProps<{ id?: string }>();

// The first bytes of a zip (.xlsx) and of the old binary Excel (.xls, and any Excel with a password)
const ZIP_SIGNATURE = '80,75,3,4';
const OLE_SIGNATURE = '208,207,17,224';
// Rows shown per community until asked for the rest, as thousands would take long to show
const PREVIEW_ROWS = 200;

const { user } = useAuth();
const isSuperadmin = computed(() => user.value?.role === 'superadmin');
const { communities, loading: loadingCommunities } = props.id
	? { communities: computed<Community[]>(() => []), loading: computed(() => false) }
	: useCommunities();
const router = useRouter();

/* 1. The file, or the cells pasted from a spreadsheet */

const fileInput = useTemplateRef('fileInput');
const source = shallowRef<{ name: string; sheets: Sheet[] }>();
// Sheet and row numbers start at 1, as LnxSelect takes a 0 for no value
const sheet = ref(1);
const pasted = ref('');
const reading = ref(false);
const error = ref<string>();
// The communities whose review shows all their rows, by groupKey. A new file shows the first ones again
const expanded = ref<string[]>([]);

useShortcut('i', () => fileInput.value?.click(), 'Elegir el fichero');

function open(name: string, sheets: Sheet[]) {
	const first = sheets.findIndex(item => item.rows.length);
	source.value = first === -1 ? undefined : { name, sheets };
	sheet.value = first + 1;
	error.value = first === -1 ? 'No tiene ninguna fila.' : undefined;
	expanded.value = [];
}

async function readFile(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file) {
		return;
	}
	reading.value = true;
	try {
		const buffer = await file.arrayBuffer();
		const signature = new Uint8Array(buffer.slice(0, 4)).join();
		if (signature === OLE_SIGNATURE) {
			throw new Error('es un .xls antiguo o un Excel con contraseña. Guárdalo desde Excel como .xlsx o CSV y elígelo de nuevo.');
		}
		open(file.name, signature === ZIP_SIGNATURE ? await readXlsx(buffer) : [{ name: file.name, rows: parseCsv(decodeText(buffer)) }]);
	} catch (e) {
		source.value = undefined;
		error.value = `No se ha podido leer ${file.name}: ${(e as Error).message}`;
	} finally {
		reading.value = false;
	}
}

// Excel and Google Sheets copy the cells as text, separated by tabs
watch(pasted, (text) => {
	if (text.trim()) {
		open('las celdas pegadas', [{ name: '', rows: parseCsv(text) }]);
	}
});

function downloadTemplate() {
	downloadFile(props.id ? 'plantilla-censo.csv' : 'plantilla-comunidades.csv', toCsv(censusTemplate(!props.id)), 'text/csv;charset=utf-8');
}

/* 2. The row with the headings and each field's column, guessed from them */

const rows = computed(() => source.value?.sheets[sheet.value - 1]?.rows ?? []);
const header = ref(1);
const headings = computed(() => rows.value[header.value - 1] ?? []);
// By their letters, '' for none
const letters = ref<Record<CensusField, string>>(toLetters(guessCensusColumns([])));
const columns = computed(() => Object.fromEntries(Object.entries(letters.value).map(([field, letter]) => [field, columnIndex(letter)])) as CensusColumns);
watch(rows, (value) => {
	header.value = guessHeaderRow(value) + 1;
});
watch(headings, (value) => {
	letters.value = toLetters(guessCensusColumns(value));
});

function toLetters(guessed: CensusColumns) {
	return Object.fromEntries(Object.entries(guessed).map(([field, index]) => [field, index === -1 ? '' : columnLetter(index)])) as Record<CensusField, string>;
}

const fields = (Object.keys(censusFields) as CensusField[]).filter(field => !props.id || !communityFields.includes(field));
const sheetOptions = computed(() => source.value?.sheets.map((item, index) => ({ value: index + 1, label: item.name })) ?? []);
const headerOptions = computed(() => rows.value.slice(0, 20).flatMap((cells, index) => cells.some(Boolean)
	? [{ value: index + 1, label: `Fila ${index + 1}: ${cells.filter(Boolean).slice(0, 4).join(' · ')}` }]
	: []));
const columnOptions = computed(() => {
	const width = Math.max(headings.value.length, ...rows.value.slice(header.value, header.value + 5).map(cells => cells.length));
	return [
		{ value: '', label: 'Ninguna' },
		...Array.from({ length: width }, (_, index) => ({ value: columnLetter(index), label: `${columnLetter(index)} · ${headings.value[index] || 'sin título'}` })),
	];
});
const missingColumn = computed(() => columns.value.name === -1
	? 'Elige la columna con el nombre de cada propiedad.'
	: !props.id && columns.value.community === -1 ? 'Elige la columna con la comunidad de cada fila.' : undefined);
// Each one with its row in the sheet, to find it there
const lines = computed(() => rows.value.slice(header.value)
	.map((cells, index) => ({ line: header.value + index + 1, cells }))
	.filter(({ cells }) => cells.some(Boolean)));

/* 3. The rows compared with each community's census, read once */

interface Group extends CensusGroup {
	properties: Property[];
	rows: CensusRow[];
	total: number;
	// In the census and not in the file, left as they are
	missing: Property[];
}

const groups = shallowRef<Group[]>([]);
const comparing = ref(false);
const loaded = new Map<string, Promise<Property[]>>();

function census(communityId: string) {
	const properties = loaded.get(communityId) ?? loadProperties(communityId).catch((e: unknown) => {
		loaded.delete(communityId);
		throw e;
	});
	loaded.set(communityId, properties);
	return properties;
}

// The latest one wins, as the columns may change while an earlier one is still reading
let comparison = 0;
async function compare() {
	const current = ++comparison;
	if (!lines.value.length || missingColumn.value) {
		groups.value = [];
		comparing.value = false;
		return;
	}
	comparing.value = true;
	// Until they're there, every community in the file would look new
	if (loadingCommunities.value) {
		groups.value = [];
		return;
	}
	try {
		const today = toDateString(new Date());
		const found: CensusGroup[] = props.id
			? [{ name: '', cif: '', address: '', iban: '', communityId: props.id, lines: lines.value }]
			: groupByCommunity(lines.value, columns.value, communities.value, isSuperadmin.value);
		const compared = await Promise.all(found.map(async (group): Promise<Group> => {
			const properties = group.communityId ? await census(group.communityId) : [];
			const read = group.error ? [] : readCensus(group.lines, columns.value, properties, today);
			return {
				...group,
				properties,
				rows: read,
				total: importedTotal(read, properties),
				missing: properties.filter(property => !read.some(row => row.property?.id === property.id)),
			};
		}));
		if (current === comparison) {
			groups.value = compared;
			error.value = undefined;
		}
	} catch (e) {
		if (current === comparison) {
			groups.value = [];
			error.value = `No se ha podido leer el censo: ${(e as Error).message}`;
		}
	} finally {
		if (current === comparison) {
			comparing.value = false;
		}
	}
}
watch([lines, () => JSON.stringify(columns.value), communities, loadingCommunities], compare);
// Coming back, the census may have changed meanwhile
onRevalidate(() => {
	loaded.clear();
	return compare();
});

const imported = computed(() => groups.value.filter(group => !group.error));
const allRows = computed(() => imported.value.flatMap(group => group.rows));
const counts = computed(() => Object.groupBy(allRows.value, row => row.status));
const toWrite = computed(() => (counts.value.new?.length ?? 0) + (counts.value.update?.length ?? 0));
const newCommunities = computed(() => imported.value.filter(group => !group.communityId).length);

function groupKey(group: Group) {
	return group.communityId ?? group.name;
}

// Errors first, then as the file has them
function preview(group: Group) {
	const rows = [...group.rows.filter(row => row.status === 'error'), ...group.rows.filter(row => row.status !== 'error')];
	return expanded.value.includes(groupKey(group)) ? rows : rows.slice(0, PREVIEW_ROWS);
}

function shown(row: CensusRow): CensusData {
	return { ...row.property, ...row.values };
}

function difference(total: number) {
	return formatCoefficient(Math.round(Math.abs(100 - total) * 100) / 100);
}

// Owners without an account and with an email
function owners(group: Group) {
	return group.rows.flatMap((row) => {
		const email = row.status === 'error' || row.property?.ownerUid ? '' : shown(row).ownerEmail;
		return email ? [{ email, name: shown(row).ownerName ?? '' }] : [];
	});
}

const ownerEmails = computed(() => new Set(imported.value.flatMap(group => owners(group).map(owner => owner.email))).size);
const inviting = ref(false);
const byEmail = ref(true);
const importing = ref(false);

async function apply() {
	if (!source.value || importing.value || comparing.value || (!toWrite.value && !newCommunities.value && !inviting.value)) {
		return;
	}
	const file = source.value.name;
	importing.value = true;
	const invited = { sent: 0, failed: 0 };
	const summary = [
		newCommunities.value && plural(newCommunities.value, 'comunidad nueva', 'comunidades nuevas'),
		counts.value.new?.length && plural(counts.value.new.length, 'propiedad nueva', 'propiedades nuevas'),
		counts.value.update?.length && plural(counts.value.update.length, 'actualizada', 'actualizadas'),
	].filter(Boolean).join(', ');
	try {
		for (const group of imported.value) {
			const communityId = group.communityId ?? newId();
			await importCensus(communityId, group.rows, file, group.communityId
				? undefined
				: { name: group.name, address: group.address, ...(group.cif ? { cif: group.cif } : {}), ...(group.iban ? { iban: group.iban } : {}) });
			if (inviting.value) {
				const result = await inviteOwners(communityId, owners(group), byEmail.value);
				invited.sent += result.sent;
				invited.failed += result.failed;
			}
		}
		toast([
			`Censo importado${summary ? `: ${summary}` : ''}`,
			invited.sent && `${plural(invited.sent, 'propietario invitado', 'propietarios invitados')}${byEmail.value ? ' por email' : ''}`,
			invited.failed && `${invited.failed} sin invitar, puede que ya tengan invitación en otra comunidad`,
		].filter(Boolean).join(' · '));
		source.value = undefined;
		pasted.value = '';
		inviting.value = false;
		await router.push(props.id ? `/communities/${props.id}/properties` : '/');
	} catch (e) {
		// What was written stays: compared again, what's left is what to import again
		toast(`No se ha podido terminar de importar: ${(e as Error).message}`, { tone: 'error' });
	} finally {
		loaded.clear();
		importing.value = false;
		await compare();
	}
}
</script>

<template>
	<header class="page-header">
		<BackButton v-if="!id" to="/" label="Volver a las comunidades" />
		<h1>{{ id ? 'Importar censo' : 'Importar comunidades' }}</h1>
	</header>

	<section class="card">
		<h2>1. Fichero</h2>
		<p v-if="id" class="hint">
			Pisos, garajes, trasteros y locales con sus propietarios y coeficientes, desde un Excel o un CSV de cualquier programa.
			Cada fila se busca en el censo por el nombre de la propiedad: las nuevas se añaden y las que ya están se actualizan con lo que traiga el fichero.
			No se borra nada, y una celda vacía no quita lo que ya hay.
		</p>
		<p v-else class="hint">
			El censo de varias comunidades en un Excel o un CSV, una fila por propiedad con la columna Comunidad. Cada comunidad se busca por su CIF y, si no lo tiene, por su nombre.
			{{ isSuperadmin
				? 'Las que no existen se crean sin administrador: asígnalas después desde Administradores.'
				: 'Solo se importan las comunidades que tienes asignadas: las nuevas las crea el equipo de gobernança.' }}
		</p>
		<div class="actions">
			<input ref="fileInput" type="file" accept=".xlsx,.xls,.csv,.tsv,.txt,text/csv,text/plain" hidden @change="readFile">
			<LnxButton :disabled="reading || importing" @click="fileInput?.click()">
				<LnxIcon :icon="reading ? 'lucide:loader-circle' : 'lucide:upload'" :class="{ spin: reading }" />
				Elegir fichero
				<Kbd combo="i" />
			</LnxButton>
			<LnxButton mode="clear" @click="downloadTemplate()">
				<LnxIcon icon="lucide:file-spreadsheet" />
				Descargar plantilla
			</LnxButton>
		</div>
		<LnxTextarea v-model="pasted" rows="3" placeholder="Copia las celdas en Excel o Google Sheets, con sus títulos, y pégalas aquí" :disabled="importing">
			O pega las celdas
		</LnxTextarea>
		<p v-if="error" class="error" role="alert">
			{{ error }}
		</p>
	</section>

	<section v-if="source" class="card">
		<h2>2. Columnas</h2>
		<p class="hint">
			Reconocidas por sus títulos en <strong>{{ source.name }}</strong>. Cambia las que no cuadren.
		</p>
		<div class="fields">
			<LnxSelect
				v-if="sheetOptions.length > 1"
				v-model.convert="sheet"
				:options="sheetOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Hoja
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ sheetOptions[value as number - 1]?.label }}
				</template>
			</LnxSelect>
			<LnxSelect
				v-model.convert="header"
				class="wide"
				:options="headerOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
			>
				Fila con los títulos
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ headerOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
			<LnxSelect
				v-for="field in fields"
				:key="field"
				v-model.convert="letters[field]"
				:options="columnOptions"
				:convert-fn="option => option.value"
				search-placeholder-text="Buscar..."
				placeholder="Ninguna"
			>
				{{ censusFields[field] }}
				<template #option="{ option }">
					{{ option.label }}
				</template>
				<template #optionInput="{ value }">
					{{ columnOptions.find(option => option.value === value)?.label }}
				</template>
			</LnxSelect>
		</div>
		<p v-if="missingColumn" class="warning note" role="status">
			<LnxIcon icon="lucide:triangle-alert" :size="16" />
			{{ missingColumn }}
		</p>
	</section>

	<section v-if="source && !missingColumn" class="card">
		<h2>3. Revisión</h2>
		<div v-if="comparing && !groups.length" class="lines" aria-busy="true" aria-label="Comparando con el censo">
			<span v-for="width in [90, 80, 95]" :key="width" class="skeleton-item" :style="{ width: `${width}%` }" />
		</div>
		<template v-else>
			<p class="summary">
				<template v-if="newCommunities">
					{{ plural(newCommunities, 'comunidad nueva', 'comunidades nuevas') }} ·
				</template>
				{{ plural(counts.new?.length ?? 0, 'propiedad nueva', 'propiedades nuevas') }}
				· {{ counts.update?.length ?? 0 }} con cambios
				· {{ counts.unchanged?.length ?? 0 }} sin cambios<template v-if="counts.error">
					· <span class="debt">{{ plural(counts.error.length, 'con errores, no se importa', 'con errores, no se importan') }}</span>
				</template>
			</p>

			<section v-for="group in groups" :key="groupKey(group)" class="group">
				<h3 v-if="!id">
					<LnxIcon icon="lucide:building-2" :size="16" />
					{{ group.name || 'Filas sin comunidad' }}
					<span class="badge" :class="{ error: group.error, new: !group.error && !group.communityId }">
						{{ group.error ?? (group.communityId ? 'Ya existe' : 'Se crea') }}
					</span>
					<small v-if="group.error">{{ plural(group.lines.length, 'fila sin importar', 'filas sin importar') }}</small>
				</h3>
				<template v-if="!group.error">
					<p class="tabular note" :class="group.total === 100 ? 'hint' : 'warning'" :role="group.total === 100 ? undefined : 'status'">
						<LnxIcon :icon="group.total === 100 ? 'lucide:circle-check' : 'lucide:triangle-alert'" :size="16" />
						Los coeficientes suman {{ formatCoefficient(group.total) }}{{ group.total === 100 ? '' : `: ${group.total < 100 ? 'faltan' : 'sobran'} ${difference(group.total)}` }}
					</p>
					<div class="table">
						<table class="ux-appear">
							<thead>
								<tr>
									<th>Fila</th>
									<th>Propiedad</th>
									<th>Tipo</th>
									<th class="number">
										Coeficiente
									</th>
									<th>Propietario</th>
									<th>Resultado</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="row in preview(group)" :key="row.line" :class="{ unchanged: row.status === 'unchanged' }">
									<td class="tabular">
										{{ row.line }}
									</td>
									<td>{{ row.property?.name ?? row.name }}</td>
									<td>{{ shown(row).type ? propertyTypeLabels[shown(row).type!] : '' }}</td>
									<td class="number">
										{{ shown(row).coefficient === undefined ? '' : formatCoefficient(shown(row).coefficient) }}
									</td>
									<td>{{ shown(row).ownerName }}</td>
									<td class="result">
										<span v-if="row.status === 'error'" class="debt">{{ row.error }}</span>
										<template v-else-if="row.status === 'new'">
											<span class="badge new">Nueva</span>
										</template>
										<template v-else-if="row.status === 'update'">
											<span class="badge">Cambia</span> {{ row.changes.join(', ') }}
										</template>
										<template v-else>
											Sin cambios
										</template>
										<small v-for="warning in row.warnings" :key="warning" class="hint note">
											<LnxIcon icon="lucide:info" :size="14" />
											{{ warning }}
										</small>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
					<LnxButton
						v-if="group.rows.length > PREVIEW_ROWS && !expanded.includes(groupKey(group))"
						class="more"
						mode="clear"
						size="small"
						@click="expanded.push(groupKey(group))"
					>
						Mostrar {{ plural(group.rows.length - PREVIEW_ROWS, 'fila más', 'filas más') }}
					</LnxButton>
					<p v-if="group.missing.length" class="hint">
						{{ plural(group.missing.length, 'propiedad del censo no está', 'propiedades del censo no están') }} en el fichero y se quedan como están:
						{{ group.missing.map(property => property.name).join(', ') }}.
					</p>
				</template>
			</section>

			<LnxCheckbox v-model="inviting" :disabled="!ownerEmails || importing">
				Invitar a los propietarios con email ({{ ownerEmails }})
				<template #helper>
					Como vecinos, salvo quien ya tenga cuenta o invitación en su comunidad.
				</template>
			</LnxCheckbox>
			<template v-if="inviting">
				<LnxCheckbox v-model="byEmail" :disabled="importing">
					Enviar invitación por email
					<template #helper>
						{{ byEmail ? 'Con el enlace para entrar en la app.' : 'Avísales tú de que entren en gobernança con su email.' }}
					</template>
				</LnxCheckbox>
				<MailModeNote v-if="byEmail" />
			</template>
			<div class="actions">
				<LnxButton :disabled="importing || comparing || (!toWrite && !newCommunities && !inviting)" @click="apply()">
					<LnxIcon :icon="importing ? 'lucide:loader-circle' : 'lucide:check'" :class="{ spin: importing }" />
					{{ importing ? 'Importando…' : toWrite ? `Importar ${plural(toWrite, 'propiedad', 'propiedades')}` : 'Importar' }}
				</LnxButton>
				<LnxButton mode="clear" :disabled="importing" @click="source = undefined; pasted = ''">
					Descartar
				</LnxButton>
			</div>
		</template>
	</section>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
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

.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
	align-items: start;
	gap: var(--lnx-spacing-3) var(--lnx-spacing-4);

	.wide {
		grid-column: 1 / -1;
	}
}

.actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);
}

.lines {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.group {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	h3 {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--lnx-spacing-2);
		font-weight: var(--lnx-font-weight-bold);

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
			font-weight: normal;
		}
	}
}

.table {
	max-height: 420px;
	overflow: auto;
}

.more {
	align-self: flex-start;
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--lnx-font-size-small);

	th,
	td {
		padding: var(--lnx-spacing-2);
		border-bottom: 1px solid var(--color-gray-3);
		text-align: left;
		vertical-align: top;
	}

	th {
		position: sticky;
		top: 0;
		background: var(--color-gray-0);
		white-space: nowrap;
	}

	.number {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.result {
		min-width: 220px;

		small {
			margin-top: var(--lnx-spacing-1);
		}
	}

	.unchanged td {
		color: var(--color-gray-6);
	}
}

.badge {
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-5);
	background: var(--color-gray-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-legal);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;

	&.new {
		background: var(--color-primary);
		color: var(--color-primary-accent);
	}

	&.error {
		background: var(--color-secondary-accent);
		color: var(--color-gray-0);
	}
}

.summary {
	font-size: var(--lnx-font-size-small);
}

.tabular {
	font-variant-numeric: tabular-nums;
}

.hint,
.warning {
	font-size: var(--lnx-font-size-small);
}

.hint {
	color: var(--color-gray-6);
}

.warning {
	color: var(--color-secondary-accent);
	font-weight: var(--lnx-font-weight-bold);
}

// With an icon before it
.note {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-1);
}

.debt,
.error {
	color: var(--color-secondary-accent);
}

.error {
	font-size: var(--lnx-font-size-small);
}

.spin {
	animation: spin 1s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
