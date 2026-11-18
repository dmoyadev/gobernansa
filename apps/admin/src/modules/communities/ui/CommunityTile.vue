<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { loadNeighbourFigures } from '../application/useCommunityDashboard.ts';
import type { Tile, TileSize } from '../domain/tiles.ts';
import type { loadTileFigures } from '@/modules/finances/application/useFinanceSummary.ts';
import { getCommonAreas } from '@gobernansa/shared/domain/community.ts';
import { isValidIban, isValidNif } from '@gobernansa/shared/domain/fiscal.ts';
import { DEFAULT_MONTHLY_VOTES } from '@gobernansa/shared/domain/issue.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import CommunityBusinessCard from '@gobernansa/shared/ui/CommunityBusinessCard.vue';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref } from 'vue';

// One tile of the community's page, from the data the page already read. The general and fiscal data, when big
// enough, are the card the neighbours see, the tile itself
const props = defineProps<{
	tile: Tile;
	communityId: string;
	community?: Community;
	editing: boolean;
	loading: boolean;
	finances?: Awaited<ReturnType<typeof loadTileFigures>>;
	financesLoading: boolean;
	neighbours?: Awaited<ReturnType<typeof loadNeighbourFigures>>;
	neighboursLoading: boolean;
}>();
// For screen readers, what copying did
const emit = defineEmits<{ announce: [text: string] }>();

const SPACES_REGEX = /\s/g;
// The tiles showing the community's data, skeletons until it's loaded
const dataKeys = ['info', 'locations'];
// Placeholder lines while the community loads, as many as the tile shows and as wide as real ones tend to be
const SKELETON_WIDTHS = [72, 54, 80, 46, 64, 58];
const skeletonLines = (size: TileSize) => SKELETON_WIDTHS.slice(0, size === 1 ? 1 : size === 2 ? 3 : 6);

const contacts = computed(() => props.community?.contacts ?? []);
const documents = computed(() => props.community?.documents ?? []);
const commonAreas = computed(() => getCommonAreas(props.community));
const bookableAreas = computed(() => commonAreas.value.filter(area => area.booking));
const adoption = computed(() => props.neighbours?.homes ? Math.min(100, Math.round(props.neighbours.registered / props.neighbours.homes * 100)) : undefined);

const summary = computed(() => `${count(contacts.value.length, 'contacto', 'contactos')} · ${count(documents.value.length, 'documento', 'documentos')} · ${count(props.community?.monthlyVotes ?? DEFAULT_MONTHLY_VOTES, 'voto', 'votos')} al mes`);
// What the community lacks, each opening the section where it's filled in
const flags = computed(() => {
	const { cif, iban } = props.community ?? {};
	return [
		!cif || !isValidNif(cif) ? { label: cif ? 'CIF no válido' : 'Sin CIF', short: 'CIF', section: 'info' } : undefined,
		!iban || !isValidIban(iban) ? { label: iban ? 'IBAN no válido' : 'Sin IBAN', short: 'IBAN', section: 'info' } : undefined,
		!documents.value.some(document => document.type === 'insurance') ? { label: 'Sin póliza del seguro', short: 'póliza del seguro', section: 'documents' } : undefined,
		!contacts.value.length ? { label: 'Sin contactos', short: 'contactos', section: 'contacts' } : undefined,
	].filter(flag => !!flag);
});
const missing = computed(() => `Por completar: ${flags.value.map(flag => flag.short).join(', ')}`);

function count(total: number, one: string, many: string) {
	return `${total} ${total === 1 ? one : many}`;
}

/* Fiscal data */
const copyable = computed(() => [
	{ label: 'CIF', value: props.community?.cif },
	{ label: 'IBAN', value: props.community?.iban },
].filter((item): item is { label: string; value: string } => !!item.value));
const copied = ref<string>();
async function copy(label: string, value: string) {
	try {
		await navigator.clipboard.writeText(value.replace(SPACES_REGEX, ''));
		copied.value = label;
		emit('announce', `${label} copiado`);
	} catch {
		// e.g. the browser denies the permission
		emit('announce', `No se ha podido copiar el ${label}`);
		return;
	}

	setTimeout(() => {
		if (copied.value === label) {
			copied.value = undefined;
		}
	}, 2000);
}
</script>

<template>
	<div v-if="tile.key === 'info' && tile.size > 1 && community" class="tile card-tile">
		<h2 class="sr-only">
			{{ tile.title }}
		</h2>
		<CommunityBusinessCard
			compact
			:name="community.name"
			:address="community.address"
			:cif="community.cif"
			:iban="community.iban"
			:bank="community.bank"
			empty-text="Aún no hay datos fiscales."
		>
			<RouterLink v-if="!editing" class="stretched" :to="`/communities/${communityId}/info`" aria-label="Editar los datos generales" />
			<!-- No room for them under the card: how many, in its corner, opening the first -->
			<RouterLink
				v-if="tile.size === 2 && flags.length && !editing"
				class="flag flag-count"
				:to="`/communities/${communityId}/${flags[0].section}`"
				:title="missing"
				:aria-label="missing"
			>
				<LnxIcon icon="lucide:circle-alert" :size="14" aria-hidden="true" />
				{{ flags.length }} por completar
			</RouterLink>
		</CommunityBusinessCard>
		<div v-if="tile.size === 4" class="card-actions">
			<LnxButton v-for="{ label, value } in copyable" :key="label" mode="outline" class="lnx-size-small" @click="copy(label, value)">
				<LnxIcon :icon="copied === label ? 'lucide:check' : 'lucide:copy'" />
				{{ copied === label ? 'Copiado' : `Copiar ${label}` }}
			</LnxButton>
			<p class="summary-line tabular">
				{{ summary }}
			</p>
			<ul v-if="flags.length && !editing" class="flags" aria-label="Por completar">
				<li v-for="flag in flags" :key="flag.label">
					<RouterLink class="flag" :to="`/communities/${communityId}/${flag.section}`">
						<LnxIcon icon="lucide:circle-alert" :size="14" aria-hidden="true" />
						{{ flag.label }}
					</RouterLink>
				</li>
			</ul>
		</div>
	</div>

	<div v-else class="tile">
		<header>
			<span class="icon">
				<LnxIcon :icon="tile.icon" :size="20" />
			</span>
			<h2>
				<RouterLink v-if="!editing" class="stretched" :to="`/communities/${communityId}/${tile.key}`">
					{{ tile.title }}
				</RouterLink>
				<template v-else>
					{{ tile.title }}
				</template>
			</h2>
			<LnxIcon v-if="!editing" class="arrow" icon="lucide:arrow-up-right" :size="18" aria-hidden="true" />
		</header>

		<div v-if="(loading && dataKeys.includes(tile.key)) || (tile.key === 'finances' && financesLoading) || (tile.key === 'people' && neighboursLoading)" class="body" aria-hidden="true">
			<span v-for="width in skeletonLines(tile.size)" :key="width" class="lnx-skeleton lnx-skeleton--small" :style="{ width: `${width}%` }" />
		</div>

		<div v-else-if="tile.key === 'info'" class="body">
			<p v-if="flags.length" class="flagged">
				<LnxIcon icon="lucide:circle-alert" :size="14" aria-hidden="true" />
				{{ missing }}
			</p>
			<p v-else class="tabular">
				{{ summary }}
			</p>
		</div>

		<div v-else-if="tile.key === 'people'" class="body">
			<p v-if="!neighbours" class="empty">
				No se han podido cargar las cifras
			</p>
			<template v-else-if="tile.size === 1">
				<p class="tabular">
					{{ count(neighbours.properties, 'propiedad', 'propiedades') }}
				</p>
				<p v-if="adoption !== undefined" class="secondary tabular">
					{{ adoption }}% de las viviendas en la app
				</p>
			</template>
			<ul v-else class="lines">
				<li class="row">
					<span class="text">Propiedades</span>
					<span class="secondary tabular">{{ neighbours.properties }}</span>
				</li>
				<li class="row">
					<span class="text">Vecinos con cuenta</span>
					<span class="secondary tabular">{{ neighbours.registered }}{{ adoption !== undefined ? ` · ${adoption}% de las viviendas` : '' }}</span>
				</li>
				<li class="row">
					<span class="text">Invitaciones pendientes</span>
					<span class="secondary tabular">{{ neighbours.invitations || 'Ninguna' }}</span>
				</li>
			</ul>
		</div>

		<div v-else-if="tile.key === 'locations'" class="body">
			<p v-if="!commonAreas.length" class="empty">
				Aún no hay zonas comunes
			</p>
			<p v-else-if="tile.size === 1">
				<span class="tabular">{{ count(commonAreas.length, 'zona común', 'zonas comunes') }}</span>
			</p>
			<template v-else>
				<ul class="chips">
					<li v-for="area in commonAreas" :key="area.id">
						<LnxIcon v-if="tile.size === 4" :icon="area.icon" :size="14" aria-hidden="true" />
						{{ area.name }}
						<LnxIcon v-if="area.booking" icon="lucide:calendar-clock" :size="12" aria-label="reservable" />
					</li>
				</ul>
				<template v-if="tile.size === 4">
					<p class="summary-title">
						Zonas reservables
					</p>
					<ul v-if="bookableAreas.length" class="lines">
						<li v-for="area in bookableAreas" :key="area.id" class="row">
							<span class="text">{{ area.name }}</span>
							<span class="secondary tabular">{{ area.booking!.opens }}–{{ area.booking!.closes }}</span>
						</li>
					</ul>
					<p v-else class="empty">
						Ninguna, márcalas como reservables al editarlas
					</p>
				</template>
			</template>
		</div>

		<div v-else-if="tile.key === 'finances'" class="body">
			<p v-if="!finances" class="empty">
				No se han podido cargar las cifras
			</p>
			<p v-else-if="tile.size === 1">
				<span class="tabular">{{ formatCents(finances.pending) }} pendiente</span>
			</p>
			<ul v-else class="lines">
				<li class="row">
					<span class="text">Pendiente de cobro</span>
					<span class="secondary tabular">{{ formatCents(finances.pending) }}</span>
				</li>
				<li class="row">
					<span class="text">Facturas vencidas</span>
					<span class="secondary tabular">{{ finances.overdueInvoices ? `${finances.overdueInvoices} · ${formatCents(finances.overdueInvoicesAmount)}` : 'Ninguna' }}</span>
				</li>
				<li class="row">
					<span class="text">Movimientos por conciliar</span>
					<span class="secondary tabular">{{ finances.unreconciled || 'Ninguno' }}</span>
				</li>
			</ul>
		</div>

		<div v-else class="body">
			<p :class="{ lead: tile.size > 1 && tile.details }">
				{{ tile.description }}
			</p>
			<p v-if="tile.size > 1 && tile.details" class="secondary">
				{{ tile.details }}
			</p>
		</div>
	</div>
</template>

<style lang="scss" scoped>
// Room for the handle and resize button, so they don't cover the title
.editing > li .tile header {
	padding-right: 72px;
}

.tile {
	position: relative;
	flex: 1;
	min-width: 0;
	overflow: hidden;
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	transition: border-color var(--duration) var(--ease-out), box-shadow var(--duration) var(--ease-out), translate var(--duration) var(--ease-spring), scale var(--duration-fast) var(--ease-out);

	&:not(:has(.card-actions)):has(.stretched:hover) {
		border-color: var(--color-primary-light);
		box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000000F;
		translate: 0 -2px;

		.arrow {
			color: inherit;
			translate: 2px -2px;
		}
	}

	&:not(:has(.card-actions)):has(.stretched:active) {
		translate: 0;
		scale: .99;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);
	}

	.icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-2);
		color: var(--color-primary);
	}

	.arrow {
		flex-shrink: 0;
		align-self: flex-start;
		color: var(--color-gray-5);
		transition: color var(--duration) var(--ease-out), translate var(--duration) var(--ease-spring);
	}

	h2 {
		flex: 1;
		min-width: 0;
		text-wrap: balance;
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-body);
		font-weight: var(--lnx-font-weight-bold);
		line-height: 1.25;
	}

	.body {
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--lnx-font-size-small);

		> p:not(.lead) {
			display: -webkit-box;
			overflow: hidden;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 3;
		}
	}

	.lead {
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-body);
	}

	.secondary,
	.empty {
		color: var(--color-gray-6);
	}

	.lines li {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;

		&.row {
			padding: 3px 0;
			display: flex;
			align-items: center;
			gap: var(--lnx-spacing-2);

			+ .row {
				border-top: 1px solid var(--color-gray-2);
			}

			.text {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
			}
		}
	}

	.summary-title {
		margin-top: var(--lnx-spacing-2);
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
		font-weight: var(--lnx-font-weight-bold);
	}

	.summary li {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-1);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--lnx-spacing-1);

		li {
			padding: 2px var(--lnx-spacing-2);
			border-radius: var(--lnx-radius-4);
			display: inline-flex;
			align-items: center;
			gap: 4px;
			background: var(--color-gray-2);
			color: var(--color-gray-8);
		}
	}
}

// The title's link covers the whole tile, so the tile opens from anywhere and controls can sit above it
.stretched {
	color: inherit;
	text-decoration: none;

	&::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: var(--lnx-radius-3);
	}

	&:focus-visible {
		outline: none;

		&::after {
			outline: 2px solid var(--color-primary);
			outline-offset: -2px;
		}
	}
}

.card-tile {
	padding: 0;
	border: none;
	background: none;
	box-shadow: none;
	overflow: visible;

	> :not(.card-actions, h2) {
		flex: 1;
		min-height: 0;
	}

	.stretched::after {
		border-radius: inherit;
	}
}

.card-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--lnx-spacing-2);

	.summary-line {
		flex-basis: 100%;
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

// What's missing, as tinted badges that open where it's filled in
.flags {
	flex-basis: 100%;
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-1);
}

.flag {
	padding: 2px var(--lnx-spacing-2);
	border-radius: var(--lnx-radius-4);
	display: inline-flex;
	align-items: center;
	gap: 4px;
	background: color-mix(in srgb, var(--color-secondary-accent) 12%, var(--color-gray-0));
	color: color-mix(in srgb, var(--color-secondary-accent), var(--color-gray-9) 35%);
	font-size: var(--lnx-font-size-small);
	text-decoration: none;

	&:hover {
		background: color-mix(in srgb, var(--color-secondary-accent) 20%, var(--color-gray-0));
	}

	&:active {
		scale: var(--press-scale);
	}
}

// In the card's corner, above its link and tilting with it. The name makes room for it
.flag-count {
	position: absolute;
	top: var(--lnx-spacing-3);
	right: var(--lnx-spacing-3);
	z-index: 2;
	box-shadow: 0 1px 2px #0000000F;
}

.card-tile:has(.flag-count) :deep(.brand h2) {
	padding-right: 8.5rem;
}

// The main tile when small, in the brand colour
.info .tile:not(.card-tile) {
	border-color: var(--color-primary);
	background: var(--color-primary);
	color: var(--color-primary-accent-alpha);

	&:has(.stretched:hover) {
		border-color: var(--color-primary-dark);
		background: var(--color-primary-dark);
	}

	.icon {
		background: var(--color-gray-0-alpha);
		color: var(--color-primary-accent);
	}

	.arrow {
		color: var(--color-primary-accent-alpha);
	}

	h2,
	.lead {
		color: var(--color-primary-accent);
	}

	.body {
		margin-top: auto;
	}

	.flagged {
		color: var(--color-primary-accent);
	}
}
</style>
