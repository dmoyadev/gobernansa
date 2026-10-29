<script setup lang="ts">
import type { Community } from '@gobernansa/shared/domain/community.ts';
import type { CommunitySection } from '../domain/communityForm.ts';
import { contactTypes, formatIban } from '@gobernansa/shared/domain/community.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, onMounted, ref } from 'vue';
import { loadCommunity } from '../application/useCommunities.ts';

const props = defineProps<{ id: string }>();

// Not managed from the admin platform yet
const upcomingTiles = [
	{ title: 'Avisos', icon: 'lucide:message-square-warning' },
	{ title: 'Eventos', icon: 'lucide:calendar' },
	{ title: 'Propiedades', icon: 'lucide:house' },
	{ title: 'Cuentas de vecinos', icon: 'lucide:users' },
];

const community = ref<Community>();
const loading = ref(true);
const loadError = ref<string>();

onMounted(async () => {
	try {
		community.value = await loadCommunity(props.id);
	} catch (e) {
		loadError.value = (e as Error).message;
	} finally {
		loading.value = false;
	}
});

// Each one opens the form of its section. Lines are skeletons until the community is loaded
const tiles = computed<{ section: CommunitySection; title: string; icon: string; lines: string[]; empty: string }[]>(() => {
	const { address, constructionYear, monthlyVotes, contacts = [], documents = [], commonAreas = [], cif, bank, iban } = community.value ?? {} as Partial<Community>;
	return [
		{
			section: 'info',
			title: 'Datos generales',
			icon: 'lucide:building-2',
			lines: [address ?? '', `Construida en ${constructionYear}`, `${monthlyVotes ?? 5} votos al mes por vecino`],
			empty: '',
		},
		{
			section: 'contacts',
			title: 'Contactos',
			icon: 'lucide:phone',
			lines: contacts.map(contact => `${contact.name} · ${contactTypes[contact.type]?.label}`),
			empty: 'Aún no hay contactos',
		},
		{
			section: 'documents',
			title: 'Documentación oficial',
			icon: 'lucide:file-text',
			// Newest first
			lines: [...documents].sort((a, b) => b.date.toMillis() - a.date.toMillis()).map(document => document.title),
			empty: 'Aún no hay documentos',
		},
		{
			section: 'locations',
			title: 'Zonas comunes',
			icon: 'lucide:map-pin',
			lines: commonAreas,
			empty: 'Aún no hay zonas comunes',
		},
		{
			section: 'finances',
			title: 'Finanzas',
			icon: 'lucide:landmark',
			lines: [cif && `CIF ${cif}`, bank, iban && formatIban(iban)].filter((line): line is string => !!line),
			empty: 'Aún no hay datos fiscales',
		},
	];
});
</script>

<template>
	<header class="page-header">
		<LnxButton to="/" mode="clear" shape="circle" aria-label="Volver a comunidades">
			<LnxIcon icon="lucide:arrow-left" />
		</LnxButton>
		<h1>
			<span v-if="loading" class="skeleton-item skeleton-item--title" />
			<template v-else>
				{{ community?.name || 'Comunidad' }}
			</template>
		</h1>
	</header>

	<section v-if="loadError || (!loading && !community)" class="status">
		<p v-if="loadError" class="error" role="alert">
			No se ha podido cargar la comunidad: {{ loadError }}
		</p>
		<p v-else>
			Esta comunidad no existe o se ha borrado.
		</p>
		<LnxButton to="/" mode="outline">
			Volver a comunidades
		</LnxButton>
	</section>

	<ul v-else class="bento" :aria-busy="loading">
		<li v-for="tile in tiles" :key="tile.section" :class="tile.section">
			<RouterLink class="tile" :to="`/communities/${id}/${tile.section}`">
				<span class="icon">
					<LnxIcon :icon="tile.icon" :size="20" />
				</span>
				<LnxIcon class="arrow" icon="lucide:arrow-up-right" :size="18" />
				<h2>{{ tile.title }}</h2>

				<span v-if="loading" class="skeleton-item" />
				<ul v-else-if="tile.lines.length" class="lines">
					<li v-for="(line, index) in tile.lines.slice(0, 3)" :key="index">
						{{ line }}
					</li>
					<li v-if="tile.lines.length > 3" class="more">
						y {{ tile.lines.length - 3 }} más
					</li>
				</ul>
				<p v-else class="empty">
					{{ tile.empty }}
				</p>
			</RouterLink>
		</li>

		<li v-for="tile in upcomingTiles" :key="tile.title" class="tile upcoming">
			<span class="icon">
				<LnxIcon :icon="tile.icon" :size="20" />
			</span>
			<h2>{{ tile.title }}</h2>
			<p class="empty">
				Próximamente
			</p>
		</li>
	</ul>
</template>

<style lang="scss" scoped>
.page-header {
	margin-bottom: var(--lnx-spacing-5);
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);

	h1 {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: var(--lnx-font-size-title);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.status {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--lnx-spacing-3);
}

.error {
	color: var(--color-secondary-accent);
}

// Sections that can be edited take two columns, the general info two rows, and the upcoming ones fill the last row
.bento {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	grid-auto-rows: minmax(132px, auto);
	gap: var(--lnx-spacing-4);

	> li {
		grid-column: span 2;
		display: flex;
	}

	> .info {
		grid-row: span 2;
	}

	> .upcoming {
		grid-column: span 1;
	}
}

.tile {
	position: relative;
	flex: 1;
	min-width: 0;
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	text-decoration: none;
	transition: border-color .15s, box-shadow .15s;

	&:is(a):hover {
		border-color: var(--color-primary-light);
		box-shadow: 0 2px 4px #0000000F, 0 8px 24px #0000000F;

		.arrow {
			color: inherit;
		}
	}

	&:is(a):focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.icon {
		margin-bottom: var(--lnx-spacing-1);
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
		position: absolute;
		top: var(--lnx-spacing-4);
		right: var(--lnx-spacing-4);
		color: var(--color-gray-5);
		transition: color .15s;
	}

	h2 {
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-body);
		font-weight: var(--lnx-font-weight-bold);
	}

	.lines {
		font-size: var(--lnx-font-size-small);

		li {
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		.more {
			color: var(--color-gray-6);
		}
	}

	.empty {
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}
}

// The main tile, in the brand colour
.info .tile {
	border-color: var(--color-primary);
	background: var(--color-primary);
	color: var(--color-primary-accent-alpha);

	&:hover {
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

	h2 {
		color: var(--color-primary-accent);
	}

	.lines {
		margin-top: auto;
		font-size: var(--lnx-font-size-body);

		li {
			white-space: normal;
		}
	}
}

.upcoming {
	border-style: dashed;
	border-color: var(--color-gray-4);
	background: transparent;
	box-shadow: none;

	.icon {
		color: var(--color-gray-5);
	}

	h2 {
		color: var(--color-gray-6);
	}
}

@media (max-width: 640px) {
	.bento {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--lnx-spacing-3);

		> .info {
			grid-row: auto;
		}
	}
}
</style>
