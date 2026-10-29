<script setup lang="ts">
import type { CommunityDocument } from '@gobernansa/shared/domain/community.ts';
import { contactTypes, documentTypes, formatIban, formatSchedule, getPhoneLink, getWhatsappLink, isWithinSchedule } from '@gobernansa/shared/domain/community.ts';
import { scrollTop } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useCommunityEvents } from '@/modules/events/application/useCommunityEvents.ts';
import EventCard from '@/modules/events/ui/EventCard.vue';
import { formatMeetingDate, useMeetings } from '@/modules/meetings/application/useMeetings.ts';
import IsotypeSVG from '@/shared/ui/IsotypeSVG.vue';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheHeader from '@/shared/ui/TheHeader.vue';
import TiltCard from '@/shared/ui/TiltCard.vue';
import { useUserCommunity } from '../application/useUserCommunity.ts';

const SPACES_REGEX = /\s/g;

const { userCommunity } = useUserCommunity();
const { events } = useCommunityEvents(3);
const { nextMeeting } = useMeetings();

const fiscalData = computed(() => [
	{ label: 'CIF', value: userCommunity.value?.cif },
	{ label: 'IBAN', value: userCommunity.value?.iban && formatIban(userCommunity.value.iban) },
	{ label: 'Banco', value: userCommunity.value?.bank },
].filter((item): item is { label: string; value: string } => !!item.value));

const copied = ref<string>();
const copyFailed = ref(false);
async function copy(label: string, value: string) {
	try {
		await navigator.clipboard.writeText(value.replace(SPACES_REGEX, ''));
		copied.value = label;
		copyFailed.value = false;
	} catch {
		// e.g. the browser denies the permission
		copyFailed.value = true;
		return;
	}

	setTimeout(() => {
		if (copied.value === label) {
			copied.value = undefined;
		}
	}, 2000);
}

const canShare = 'share' in navigator;
async function share() {
	const community = userCommunity.value!;
	const text = [community.name, community.address, ...fiscalData.value.map(({ label, value }) => `${label}: ${value}`)].join('\n');
	try {
		await navigator.share({ title: community.name, text });
	} catch {
		// Closing the share sheet rejects too, nothing to do
	}
}

const documents = computed(() => [...(userCommunity.value?.documents ?? [])]
	.sort((a, b) => b.date.toMillis() - a.date.toMillis()));
// Statutes go before the regulations, which develop them, and the insurance policy after
const rules = computed(() => (['statutes', 'regulations', 'insurance'] as const)
	.flatMap(type => documents.value.filter(document => document.type === type)));
const minutesByYear = computed(() => {
	const years = new Map<number, CommunityDocument[]>();
	for (const minutes of documents.value.filter(document => document.type === 'minutes')) {
		const year = minutes.date.toDate().getFullYear();
		years.set(year, [...(years.get(year) ?? []), minutes]);
	}
	return [...years];
});

function formatDate(document: CommunityDocument) {
	return document.date.toDate().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
}
</script>

<template>
	<TheHeader>
		<h1>{{ userCommunity?.name }}</h1>
		<p>Información de utilidad de tu comunidad.</p>
	</TheHeader>

	<MainLayout>
		<section v-if="userCommunity">
			<TiltCard>
				<div class="business-card">
					<IsotypeSVG class="watermark" width="180" height="180" aria-hidden="true" />
					<div class="brand">
						<small>Comunidad de propietarios</small>
						<h2>{{ userCommunity.name }}</h2>
						<p>{{ userCommunity.address }}</p>
					</div>

					<dl v-if="fiscalData.length">
						<div v-for="item in fiscalData" :key="item.label" :class="{ wide: item.label === 'IBAN' }">
							<dt>{{ item.label }}</dt>
							<dd>{{ item.value }}</dd>
						</div>
					</dl>
					<p v-else class="no-data">
						Tu administración aún no ha añadido los datos fiscales.
					</p>
				</div>
			</TiltCard>

			<div v-if="fiscalData.length" class="card-actions">
				<LnxButton
					v-for="item in fiscalData.filter(({ label }) => label !== 'Banco')"
					:key="item.label"
					mode="outline"
					size="small"
					@click="copy(item.label, item.value)"
				>
					<LnxIcon :icon="copied === item.label ? 'lucide:check' : 'lucide:copy'" />
					{{ copied === item.label ? 'Copiado' : `Copiar ${item.label}` }}
				</LnxButton>
				<LnxButton
					v-if="canShare"
					mode="outline"
					size="small"
					@click="share()"
				>
					<LnxIcon icon="lucide:share-2" />
					Compartir
				</LnxButton>
			</div>
			<p :class="copyFailed ? 'copy-failed' : 'sr-only'" aria-live="polite">
				{{ copyFailed ? 'No se ha podido copiar. Mantén pulsado el dato en la tarjeta para copiarlo.' : copied ? `${copied} copiado` : '' }}
			</p>
		</section>

		<section id="contacts">
			<h2>Contactos</h2>
			<ul class="list">
				<li v-for="contact in userCommunity?.contacts" :key="contact.name" class="row">
					<span class="icon">
						<LnxIcon :icon="contactTypes[contact.type]?.icon || 'lucide:phone'" :size="20" />
					</span>
					<span class="body">
						<small>{{ contactTypes[contact.type]?.label || 'Contacto' }}</small>
						<strong>{{ contact.name }}</strong>
						<small v-if="contact.schedule?.length" class="schedule">
							<span class="availability" :class="{ available: isWithinSchedule(contact.schedule) }">
								{{ isWithinSchedule(contact.schedule) ? 'Disponible ahora' : 'Fuera de horario' }}
							</span>
							{{ contact.schedule.map(formatSchedule).join(' · ') }}
						</small>
					</span>
					<span class="actions">
						<LnxButton
							v-if="contact.email"
							:href="`mailto:${contact.email}`"
							mode="clear"
							shape="circle"
							:aria-label="`Enviar un email a ${contact.name}`"
						>
							<LnxIcon icon="lucide:mail" />
						</LnxButton>
						<LnxButton
							v-if="contact.whatsapp"
							class="whatsapp"
							:href="getWhatsappLink(contact.whatsapp)"
							target="_blank"
							rel="noopener"
							mode="clear"
							shape="circle"
							:aria-label="`Escribir por WhatsApp a ${contact.name}`"
						>
							<LnxIcon icon="lucide:message-circle" />
						</LnxButton>
						<LnxButton
							v-if="contact.phone"
							class="call"
							:href="getPhoneLink(contact.phone)"
							shape="circle"
							:aria-label="`Llamar a ${contact.name}`"
						>
							<LnxIcon icon="lucide:phone" />
						</LnxButton>
					</span>
				</li>

				<!-- Always there, whatever the community has added -->
				<li class="row emergency">
					<span class="icon">
						<LnxIcon icon="lucide:siren" :size="20" />
					</span>
					<span class="body">
						<small>Emergencias</small>
						<strong>112</strong>
					</span>
					<span class="actions">
						<LnxButton class="call" href="tel:112" shape="circle" aria-label="Llamar a emergencias, 112">
							<LnxIcon icon="lucide:phone" />
						</LnxButton>
					</span>
				</li>
			</ul>
		</section>

		<section id="documents">
			<h2>Documentación oficial</h2>
			<ul v-if="documents.length" class="list">
				<li v-for="document in rules" :key="document.url">
					<a class="row" :href="document.url" target="_blank" rel="noopener">
						<span class="icon">
							<LnxIcon :icon="documentTypes[document.type].icon" :size="20" />
						</span>
						<span class="body">
							<small>{{ documentTypes[document.type].label }}</small>
							<strong>{{ document.title }}</strong>
						</span>
						<LnxIcon class="chevron" icon="lucide:external-link" :size="16" />
					</a>
				</li>

				<li v-if="minutesByYear.length" class="minutes">
					<h3>Actas de las juntas</h3>
					<!-- Only the latest year open, older ones are rarely looked up -->
					<details v-for="([year, yearMinutes], index) in minutesByYear" :key="year" :open="index === 0">
						<summary>
							{{ year }}
							<span class="count">{{ yearMinutes.length }}</span>
							<LnxIcon class="chevron" icon="lucide:chevron-down" :size="16" />
						</summary>
						<ul>
							<li v-for="minutes in yearMinutes" :key="minutes.url">
								<a class="row" :href="minutes.url" target="_blank" rel="noopener">
									<span class="icon">
										<LnxIcon :icon="documentTypes.minutes.icon" :size="20" />
									</span>
									<span class="body">
										<small>{{ formatDate(minutes) }}</small>
										<strong>{{ minutes.title }}</strong>
									</span>
									<LnxIcon class="chevron" icon="lucide:external-link" :size="16" />
								</a>
							</li>
						</ul>
					</details>
				</li>
			</ul>
			<p v-else class="empty">
				Tu administración aún no ha subido documentos.
			</p>
		</section>

		<section>
			<h2>Participa</h2>
			<ul class="list">
				<li>
					<RouterLink class="row" to="/neighborhood/meetings">
						<span class="icon">
							<LnxIcon icon="lucide:gavel" :size="20" />
						</span>
						<span class="body">
							<small>{{ nextMeeting ? `Próxima: ${formatMeetingDate(nextMeeting.date)}` : 'Convocatorias, asistencia y votaciones' }}</small>
							<strong>{{ nextMeeting?.title || 'Juntas' }}</strong>
						</span>
						<LnxIcon class="chevron" icon="lucide:chevron-right" :size="16" />
					</RouterLink>
				</li>
				<li v-if="userCommunity?.bookableAreas?.length">
					<RouterLink class="row" to="/neighborhood/bookings">
						<span class="icon">
							<LnxIcon icon="lucide:calendar-check" :size="20" />
						</span>
						<span class="body">
							<small>{{ userCommunity.bookableAreas.map(area => area.name).join(' · ') }}</small>
							<strong>Reservas</strong>
						</span>
						<LnxIcon class="chevron" icon="lucide:chevron-right" :size="16" />
					</RouterLink>
				</li>
			</ul>
		</section>

		<section>
			<header>
				<h2>Avisos</h2>
				<LnxButton
					class="btn-all"
					to="/neighborhood/timeline"
					mode="clear"
					variant="grayscale"
					size="small"
					@click="scrollTop()"
				>
					Ver todo
				</LnxButton>
			</header>
			<ul class="events">
				<li v-for="event in events" :key="event.id">
					<EventCard :event small />
				</li>
			</ul>
		</section>
	</MainLayout>
</template>

<style lang="scss" scoped>
section {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);

	> h2,
	header h2 {
		font-size: var(--lnx-font-size-small);
		font-weight: var(--lnx-font-weight-bold);
		color: var(--color-gray-6);
		text-transform: uppercase;
		letter-spacing: .04em;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;

		.btn-all {
			--lnx-button-color: var(--color-gray-6);
			text-transform: uppercase;
			font-size: var(--lnx-font-size-legal);
		}
	}
}

.business-card {
	position: relative;
	overflow: hidden;
	aspect-ratio: 1.586; // Credit card proportions
	padding: var(--lnx-spacing-5) var(--lnx-spacing-4) var(--lnx-spacing-4);
	border-radius: inherit;
	background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
	color: var(--color-primary-accent);
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: var(--lnx-spacing-3);

	.watermark {
		position: absolute;
		right: -40px;
		bottom: -50px;
		color: var(--color-gray-0-alpha);
	}

	.brand {
		small {
			color: var(--color-secondary-accent);
			font-size: .7rem;
			font-weight: var(--lnx-font-weight-bold);
			letter-spacing: .08em;
			text-transform: uppercase;
		}

		h2 {
			font-size: 1.3rem;
			line-height: 1.2;
		}

		p {
			color: var(--color-primary-accent-alpha);
			font-size: var(--lnx-font-size-small);
		}
	}

	dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--lnx-spacing-2) var(--lnx-spacing-4);

		.wide {
			grid-column: 1 / -1;
			order: -1;
		}

		dt {
			color: var(--color-primary-accent-alpha);
			font-size: .65rem;
			letter-spacing: .08em;
			text-transform: uppercase;
		}

		dd {
			font-family: var(--font-family-mono);
			font-size: .95rem;
			letter-spacing: .04em;
			white-space: nowrap;
		}
	}

	.no-data {
		color: var(--color-primary-accent-alpha);
		font-size: var(--lnx-font-size-small);
	}
}

.copy-failed {
	color: var(--color-secondary-accent);
	font-size: var(--lnx-font-size-small);
}

.card-actions {
	margin-top: var(--lnx-spacing-2);
	display: flex;
	flex-wrap: wrap;
	gap: var(--lnx-spacing-2);
}

.list {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;

	> li + li {
		border-top: 1px solid var(--color-gray-2);
	}
}

.row {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-3);
	padding: var(--lnx-spacing-3);
	color: inherit;
	text-decoration: none;

	.icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--lnx-radius-circle);
		background: var(--color-gray-1);
		color: var(--color-primary);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;

		small {
			color: var(--color-gray-6);
			font-size: var(--lnx-font-size-small);
		}

		strong {
			overflow: hidden;
			color: var(--color-gray-9);
			font-weight: var(--lnx-font-weight-regular);
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.schedule {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--lnx-spacing-2);
	}

	.availability {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--color-gray-6);
		font-weight: var(--lnx-font-weight-bold);

		&::before {
			content: '';
			width: 8px;
			height: 8px;
			border-radius: var(--lnx-radius-circle);
			background: var(--color-gray-4);
		}

		&.available {
			color: var(--color-issue-status-resolved);

			&::before {
				background: var(--color-issue-status-resolved);
			}
		}
	}

	.actions {
		flex-shrink: 0;
		display: flex;
		gap: var(--lnx-spacing-1);
	}

	.whatsapp {
		--lnx-button-color: #128c4b;
	}

	.call {
		--lnx-button-background: var(--color-primary);
	}

	.chevron {
		flex-shrink: 0;
		color: var(--color-gray-5);
	}

	&.emergency .icon {
		background: #fde8e8;
		color: var(--color-secondary-accent);
	}
}

a.row:active {
	background: var(--color-gray-1);
}

.minutes {
	padding: var(--lnx-spacing-3) 0 0;

	h3 {
		padding: 0 var(--lnx-spacing-3) var(--lnx-spacing-2);
		font-size: var(--lnx-font-size-body);
	}

	details {
		border-top: 1px solid var(--color-gray-2);

		&[open] .chevron {
			transform: rotate(180deg);
		}
	}

	summary {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-2);
		padding: var(--lnx-spacing-3);
		font-weight: var(--lnx-font-weight-bold);
		cursor: pointer;
		list-style: none;

		&::-webkit-details-marker {
			display: none;
		}

		.count {
			padding: 0 var(--lnx-spacing-2);
			border-radius: var(--lnx-radius-4);
			background: var(--color-gray-2);
			color: var(--color-gray-7);
			font-size: var(--lnx-font-size-small);
		}

		.chevron {
			margin-left: auto;
			color: var(--color-gray-5);
			transition: transform .2s;
		}
	}

	ul .row {
		padding-left: var(--lnx-spacing-5);
	}
}

.empty {
	color: var(--color-gray-6);
	font-size: var(--lnx-font-size-small);
}

.events {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-2);
}
</style>
