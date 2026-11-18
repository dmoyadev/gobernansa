<script setup lang="ts">
import type { Withholding } from '@gobernansa/shared/domain/aeat.ts';
import { quarterReturn, taxIdProblem } from '@gobernansa/shared/domain/aeat.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { LnxButton, LnxIcon, LnxKbd } from 'lnxjs-components';
import { computed } from 'vue';
import TaxIdCell from './TaxIdCell.vue';

// The tab of the withholdings on the invoices of the year: the 111 and 115 by quarter, the 190 by recipient. The
// file's check goes in the slot, by its button
const props = defineProps<{ year: number; withheld: Withholding[]; canDownload: boolean }>();
const emit = defineEmits<{ download: [] }>();

const quarters = ['1T', '2T', '3T', '4T'];
const professionals = computed(() => props.withheld.filter(item => item.type === 'professional'));
const landlords = computed(() => props.withheld.filter(item => item.type === 'rental'));
const returns111 = computed(() => quarters.map((_, quarter) => quarterReturn(props.withheld, 'professional', quarter)));
const returns115 = computed(() => quarters.map((_, quarter) => quarterReturn(props.withheld, 'rental', quarter)));
const ready190 = computed(() => professionals.value.filter(item => !taxIdProblem(item.nif)));

function sum(list: Withholding[], field: 'base' | 'withholding') {
	return list.reduce((total, item) => total + item[field], 0);
}
</script>

<template>
	<section class="card lnx-appear">
		<h2>Modelo 111 · Retenciones trimestrales {{ year }}</h2>
		<p class="hint">
			Rendimientos de actividades profesionales: las facturas con retención, por la fecha en que se pagaron.
			Las pendientes de pago entran en el trimestre en que se paguen.
		</p>
		<table>
			<thead>
				<tr>
					<th>Trimestre</th>
					<th class="amount">
						Perceptores [07]
					</th>
					<th class="amount">
						Importe de las percepciones [08]
					</th>
					<th class="amount">
						Retenciones [09] y a ingresar [30]
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="(row, index) in returns111" :key="index">
					<td>{{ quarters[index] }}</td>
					<td class="amount">
						{{ row.recipients }}
					</td>
					<td class="amount">
						{{ formatCents(row.base) }}
					</td>
					<td class="amount">
						<strong>{{ formatCents(row.withholding) }}</strong>
					</td>
				</tr>
			</tbody>
		</table>
		<p class="hint">
			El 111 se presenta cada trimestre aunque no haya retenciones, con resultado cero, mientras la comunidad siga dada de alta como retenedora.
		</p>
	</section>

	<section v-if="landlords.length" class="card lnx-appear">
		<h2>Modelo 115 · Retenciones de alquileres {{ year }}</h2>
		<table>
			<thead>
				<tr>
					<th>Trimestre</th>
					<th class="amount">
						Perceptores [01]
					</th>
					<th class="amount">
						Base [02]
					</th>
					<th class="amount">
						Retenciones [03]
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="(row, index) in returns115" :key="index">
					<td>{{ quarters[index] }}</td>
					<td class="amount">
						{{ row.recipients }}
					</td>
					<td class="amount">
						{{ formatCents(row.base) }}
					</td>
					<td class="amount">
						<strong>{{ formatCents(row.withholding) }}</strong>
					</td>
				</tr>
			</tbody>
		</table>
		<p class="hint">
			El resumen anual de alquileres (modelo 180) son estos arrendadores: {{ landlords.map(item => `${item.name} (${formatCents(item.base)}, retenido ${formatCents(item.withholding)})`).join('; ') }}.
			Se presenta con el formulario de la Sede.
		</p>
	</section>

	<section class="card lnx-appear">
		<h2>Modelo 190 · Resumen anual {{ year }}</h2>
		<p v-if="!professionals.length" class="empty">
			En {{ year }} no se pagaron facturas con retención a profesionales.
		</p>
		<div v-else class="table">
			<table>
				<thead>
					<tr>
						<th>NIF</th>
						<th>Perceptor</th>
						<th>Clave</th>
						<th class="amount">
							Percepción íntegra
						</th>
						<th class="amount">
							Retenciones
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="item in professionals" :key="`${item.providerId}-${item.subkey}`">
						<TaxIdCell :nif="item.nif" />
						<td>
							{{ item.name }}
							<small v-if="!item.province" class="hint">· sin código postal, provincia 00</small>
						</td>
						<td :title="item.subkey === '03' ? 'Inicio de actividad' : 'Tipo general'">
							G.{{ item.subkey }}
						</td>
						<td class="amount">
							{{ formatCents(item.base) }}
						</td>
						<td class="amount">
							{{ formatCents(item.withholding) }}
						</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<td colspan="3">
							Total
						</td>
						<td class="amount">
							{{ formatCents(sum(professionals, 'base')) }}
						</td>
						<td class="amount">
							{{ formatCents(sum(professionals, 'withholding')) }}
						</td>
					</tr>
				</tfoot>
			</table>
		</div>
		<p v-if="professionals.length !== ready190.length" class="warning" role="status">
			{{ professionals.length - ready190.length }} sin NIF válido no van en el fichero: complétalo en la ficha del proveedor.
		</p>
		<slot />
		<footer class="actions">
			<span class="summary">La suma de los cuatro 111 debe coincidir con el total de retenciones.</span>
			<LnxButton :disabled="!canDownload || !ready190.length" @click="emit('download')">
				<LnxIcon icon="lucide:download" />
				Descargar fichero 190
				<LnxKbd combo="d" />
			</LnxButton>
		</footer>
	</section>
</template>

<style lang="scss" scoped src="./taxes.scss" />
