<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref, useTemplateRef } from 'vue';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheToolbar from '@/shared/ui/TheToolbar.vue';
import { useIssue } from '../application/useIssue.ts';
import { getIssueStep, issueLifecycle, issueLocationTypes, issuesCategories, issueStatus } from '../domain/issue.ts';

const props = defineProps<{ id: string }>();

const VIDEO_EXTENSION_REGEX = /\.(?:mp4|mov)$/i;

// The toolbar collapses as soon as the title starts going under it, so long titles on short pages still do
const $titleTop = useTemplateRef('$titleTop');
const {
	data: issue,
	loading,
	error,
	fetch,
} = useIssue(() => props.id);

const category = computed(() => issuesCategories.find(category => category.value === issue.value?.category));
const status = computed(() => issueStatus.find(status => status.value === issue.value?.status));
const step = computed(() => issue.value ? getIssueStep(issue.value.status) : 0);

const assets = computed(() => (issue.value?.assets || []).map(url => VIDEO_EXTENSION_REGEX.test(url)
	? {
			type: 'video',
			url: url.replace('/upload/', '/upload/c_fill,w_800,h_600,q_auto/'),
			poster: url.replace('/upload/', '/upload/c_fill,w_800,h_600/').replace(VIDEO_EXTENSION_REGEX, '.jpg'),
			original: url,
		}
	: {
			type: 'image',
			url: url.replace('/upload/', '/upload/c_auto,g_auto,w_800,h_600/'),
			original: url,
		}));
const currentAsset = ref(0);

function onGalleryScroll(event: Event) {
	const gallery = event.target as HTMLElement;
	currentAsset.value = Math.round(gallery.scrollLeft / gallery.clientWidth);
}

function formatDate(date: Date) {
	return date.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
}
</script>

<template>
	<div
		class="issue-detail"
		:style="issue && {
			'--cat-color': `var(--color-issue-cat-${issue.category}-accent)`,
			'--cat-color-bg': `var(--color-issue-cat-${issue.category})`,
			'--status-color': `var(--color-issue-status-${issue.status})`,
		}"
	>
		<TheToolbar :title="issue?.title" back="/issues" :reveal="$titleTop" />

		<div
			v-if="issue || loading"
			class="hero vt-morph"
			:style="{ '--vt-name': `issue-media-${id}` }"
		>
			<span v-if="loading && !issue" class="skeleton-item hero-placeholder" />

			<template v-else-if="assets.length">
				<ul class="gallery" @scroll.passive="onGalleryScroll">
					<li v-for="(asset, index) in assets" :key="asset.original">
						<video
							v-if="asset.type === 'video'"
							:src="asset.url"
							:poster="asset.poster"
							controls
							playsinline
							preload="none"
						/>
						<a
							v-else
							:href="asset.original"
							target="_blank"
							rel="noopener"
						>
							<img :src="asset.url" :alt="`Foto ${index + 1} de ${issue?.title}`" width="800" height="600">
						</a>
					</li>
				</ul>
				<span v-if="assets.length > 1" class="gallery-count">
					{{ currentAsset + 1 }} / {{ assets.length }}
				</span>
			</template>

			<div v-else-if="issue" class="hero-placeholder">
				<LnxIcon :icon="category?.icon || 'lucide:triangle-alert'" :size="56" />
			</div>
		</div>

		<MainLayout>
			<template v-if="issue">
				<header>
					<div ref="$titleTop" class="meta">
						<span class="category">
							<LnxIcon v-if="category" :icon="category.icon" :size="14" />
							{{ category?.label || 'Sin categoría' }}
						</span>
						<span class="votes" :class="{ hot: issue.votesScore > 0 }">
							{{ issue.votesScore }} {{ Math.abs(issue.votesScore) === 1 ? 'voto' : 'votos' }}
						</span>
					</div>
					<h1>{{ issue.title }}</h1>
				</header>

				<section class="panel status">
					<div class="panel-header">
						<h2>Estado</h2>
						<span class="status-label">{{ status?.label || 'Sin estado' }}</span>
					</div>

					<ol class="stepper">
						<li
							v-for="(lifecycleStatus, index) in issueLifecycle"
							:key="lifecycleStatus.value"
							:class="{ done: index < step, current: issue.status !== 'closed' && index === step - 1 }"
						>
							<span class="dot" />
							{{ lifecycleStatus.label }}
						</li>
					</ol>
				</section>

				<section v-if="issue.description" class="description">
					<h2>Descripción</h2>
					<p>{{ issue.description }}</p>
				</section>

				<section class="panel">
					<dl class="details">
						<div v-if="issue.location">
							<dt>
								<LnxIcon icon="lucide:map-pin" :size="16" />
								Ubicación
							</dt>
							<dd>
								{{ issueLocationTypes[issue.location.type] }}{{ issue.location.reference ? ` · ${issue.location.reference}` : '' }}
							</dd>
						</div>
						<div>
							<dt>
								<LnxIcon icon="lucide:calendar" :size="16" />
								Aviso
							</dt>
							<dd>{{ formatDate(issue.createdAt.toDate()) }}</dd>
						</div>
						<div v-if="issue.updatedAt">
							<dt>
								<LnxIcon icon="lucide:history" :size="16" />
								Actualizada
							</dt>
							<dd>{{ formatDate(issue.updatedAt.toDate()) }}</dd>
						</div>
					</dl>
				</section>
			</template>

			<template v-else-if="loading">
				<span class="skeleton-item skeleton-item--small" style="width: 30%" />
				<span class="skeleton-item skeleton-item--title" />
				<span class="skeleton-item skeleton-item--big-square" />
				<span class="skeleton-item" />
				<span class="skeleton-item" style="width: 70%" />
			</template>

			<div v-else class="empty">
				<LnxIcon :icon="error ? 'lucide:wifi-off' : 'lucide:search-x'" :size="32" />
				<h3>{{ error ? 'No se ha podido cargar' : 'Incidencia no encontrada' }}</h3>
				<p>
					{{ error
						? 'Revisa tu conexión e inténtalo de nuevo.'
						: 'Puede que se haya eliminado o que el enlace no sea correcto.' }}
				</p>
				<LnxButton v-if="error" mode="clear" @click="fetch()">
					Reintentar
				</LnxButton>
				<LnxButton v-else mode="clear" to="/issues">
					Ver incidencias
				</LnxButton>
			</div>
		</MainLayout>
	</div>
</template>

<style lang="scss" scoped>
.issue-detail {
	position: relative;
}

.hero {
	position: relative;
	aspect-ratio: 4 / 3;
	max-height: 50svh;
	width: 100%;
	overflow: hidden;
	border-radius: 0 0 calc(var(--lnx-radius-3) + var(--lnx-spacing-2)) calc(var(--lnx-radius-3) + var(--lnx-spacing-2));
	background: var(--color-gray-2);

	.hero-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		border-radius: 0;
		color: var(--cat-color);
		background: var(--cat-color-bg);
	}

	.gallery {
		display: flex;
		height: 100%;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;

		li {
			flex: 0 0 100%;
			scroll-snap-align: start;
		}

		a {
			display: block;
			height: 100%;
		}

		img,
		video {
			width: 100%;
			height: 100%;
			object-fit: cover;
			background: var(--color-gray-9);
		}
	}

	.gallery-count {
		position: absolute;
		right: var(--lnx-spacing-4);
		bottom: var(--lnx-spacing-4);
		padding: 2px var(--lnx-spacing-2);
		border-radius: var(--lnx-radius-4);
		background: #00000099;
		color: var(--color-gray-0);
		font-size: var(--lnx-font-size-small);
	}
}

header {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);

	.meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--lnx-spacing-2);
	}

	.votes {
		flex-shrink: 0;
		padding: 2px var(--lnx-spacing-2);
		border-radius: var(--lnx-radius-4);
		background: var(--color-gray-1);
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);

		&.hot {
			background: var(--color-issue-vote-hot);
		}
	}

	.category {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--cat-color);
		font-size: .75rem;
		font-weight: var(--lnx-font-weight-bold);
		letter-spacing: .04em;
		text-transform: uppercase;
	}

	h1 {
		color: var(--color-gray-9);
		line-height: 1.2;
	}
}

h2 {
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	color: var(--color-gray-6);
	text-transform: uppercase;
	letter-spacing: .04em;
}

.panel {
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
}

.status {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.status-label {
		color: var(--status-color);
		font-weight: var(--lnx-font-weight-bold);
	}

	.stepper {
		display: flex;

		li {
			position: relative;
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: var(--lnx-spacing-2);
			color: var(--color-gray-5);
			font-size: var(--lnx-font-size-small);
			text-align: center;

			// Line joining each step with the previous one
			&:not(:first-child)::before {
				content: '';
				position: absolute;
				top: 5px;
				right: 50%;
				width: 100%;
				height: 4px;
				border-radius: 4px;
				background: var(--color-gray-3);
			}

			&.done {
				color: var(--color-gray-8);

				&::before {
					background: var(--status-color);
				}

				.dot {
					background: var(--status-color);
					border-color: var(--status-color);
				}
			}

			&.current {
				font-weight: var(--lnx-font-weight-bold);

				.dot {
					box-shadow: 0 0 0 4px var(--color-gray-0), 0 0 0 6px var(--status-color);
				}
			}
		}

		.dot {
			position: relative;
			z-index: 1;
			width: 14px;
			height: 14px;
			border: 2px solid var(--color-gray-4);
			border-radius: var(--lnx-radius-circle);
			background: var(--color-gray-0);
		}
	}
}

.description {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	p {
		color: var(--color-gray-8);
		line-height: 1.5;
		white-space: pre-line;
	}
}

.details {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);

	div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	dt {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		color: var(--color-gray-6);
		font-size: var(--lnx-font-size-small);
	}

	dd {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--lnx-spacing-2);
		// Lines the value up with the label text, past the icon
		padding-left: calc(16px + var(--lnx-spacing-2));
		color: var(--color-gray-9);
	}
}

.empty {
	padding: calc(var(--lnx-spacing-8) * 2) var(--lnx-spacing-4) var(--lnx-spacing-8);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-2);
	text-align: center;
	color: var(--color-gray-6);

	h3 {
		color: var(--color-gray-8);
	}
}
</style>
