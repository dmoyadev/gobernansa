<script setup lang="ts">
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed } from 'vue';
import { useCurrentUser } from 'vuefire';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { useUserProperties } from '@/modules/community/application/useUserProperties.ts';
import { contactTypes, getPhoneLink, getWhatsappLink } from '@/modules/community/domain/community.ts';
import { useCommunityEvents } from '@/modules/events/application/useCommunityEvents.ts';
import EventCard from '@/modules/events/ui/EventCard.vue';
import { issuesFilters } from '@/modules/issues/application/useIssues.ts';
import { useUserActivity } from '@/modules/issues/application/useUserActivity.ts';
import { getVotingMonth } from '@/modules/issues/domain/issue.ts';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheHeader from '@/shared/ui/TheHeader.vue';
import { scrollTop } from '@/shared/utils/helpers.ts';

const user = useCurrentUser();
const { selectedProperty } = useUserProperties();
const { userCommunity } = useUserCommunity();
const { events } = useCommunityEvents(3);
const { issues, votesLeft, monthlyVotes } = useUserActivity();
const votesRenewOn = getVotingMonth().renewsOn.toLocaleDateString('es', { day: 'numeric', month: 'long' });

// The ones to call when something happens, in the order the community has them
const quickContacts = computed(() => (userCommunity.value?.contacts ?? []).filter(contact => contact.phone || contact.whatsapp));

function showMyIssues() {
	issuesFilters.value = { createdBy: user.value?.uid };
	scrollTop();
}
</script>

<template>
	<TheHeader title="Inicio">
		<div class="greeting">
			<h1 v-if="selectedProperty">
				¡Hola, {{ selectedProperty.name }}!
			</h1>
			<h1 v-else>
				¡Hola!
			</h1>
			<p
				v-if="userCommunity"
				class="text-cursive"
			>
				Bienvenido a {{ userCommunity?.name }}
			</p>
		</div>
	</TheHeader>

	<MainLayout>
		<div class="cta">
			<h2>¿Algo no va bien?</h2>
			<p class="text-cursive">
				Avisa de cualquier problema para que empecemos a trabajar en ello cuanto antes.
			</p>
			<LnxButton variant="danger" to="/issues/new" is-block>
				<LnxIcon icon="lucide:circle-alert" />
				Dar aviso
			</LnxButton>
		</div>

		<section>
			<header>
				<h2>Tu actividad</h2>
			</header>

			<div class="stats">
				<RouterLink to="/issues" class="stat link" @click="showMyIssues()">
					<span class="stat-icon">
						<LnxIcon icon="lucide:message-square-warning" :size="18" />
					</span>
					<strong>{{ issues?.total ?? '—' }}</strong>
					<span>
						{{ issues?.total === 1 ? 'Incidencia creada' : 'Incidencias creadas' }}<template v-if="issues?.active">, {{ issues.active }} en curso</template>
					</span>
					<small>
						Ver mis incidencias
						<LnxIcon icon="lucide:arrow-right" :size="12" />
					</small>
				</RouterLink>

				<div class="stat">
					<span class="stat-icon">
						<LnxIcon icon="lucide:vote" :size="18" />
					</span>
					<strong>
						{{ votesLeft ?? '—' }}<span class="of">/{{ monthlyVotes }}</span>
					</strong>
					<span v-if="votesLeft === 0">Ya has usado tus votos de este mes</span>
					<span v-else>{{ votesLeft === 1 ? 'Voto disponible' : 'Votos disponibles' }} este mes</span>
					<!-- Not "new ones": unused votes don't carry over -->
					<small>Vuelves a tener {{ monthlyVotes }} el {{ votesRenewOn }}</small>
				</div>
			</div>
		</section>

		<section v-if="quickContacts.length">
			<header>
				<h2>Contactos rápidos</h2>
				<LnxButton
					class="btn-all"
					to="/neighborhood#contacts"
					mode="clear"
					variant="grayscale"
					size="small"
				>
					Ver todos
				</LnxButton>
			</header>

			<ul class="contacts">
				<li v-for="contact in quickContacts" :key="contact.name">
					<LnxIcon class="contact-icon" :icon="contactTypes[contact.type]?.icon || 'lucide:phone'" :size="18" />
					<span class="contact-body">
						<small>{{ contactTypes[contact.type]?.label || 'Contacto' }}</small>
						<strong>{{ contact.name }}</strong>
					</span>
					<span class="contact-actions">
						<LnxButton
							v-if="contact.whatsapp"
							class="whatsapp"
							:href="getWhatsappLink(contact.whatsapp)"
							target="_blank"
							rel="noopener"
							mode="clear"
							shape="circle"
							size="small"
							:aria-label="`Escribir por WhatsApp a ${contact.name}`"
						>
							<LnxIcon icon="lucide:message-circle" />
						</LnxButton>
						<LnxButton
							v-if="contact.phone"
							:href="getPhoneLink(contact.phone)"
							shape="circle"
							size="small"
							:aria-label="`Llamar a ${contact.name}`"
						>
							<LnxIcon icon="lucide:phone" />
						</LnxButton>
					</span>
				</li>
			</ul>
		</section>

		<section>
			<header>
				<h2>Actividad reciente</h2>
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
.greeting {
	p {
		color: var(--color-gray-6);
	}
}

.cta {
	border-radius: var(--lnx-radius-3);
	background: var(--color-primary);
	background: linear-gradient(165deg, var(--color-primary-light) 0%, var(--color-primary) 25%, var(--color-primary-dark) 100%);
	color: var(--color-primary-accent);
	padding: var(--lnx-spacing-5) var(--lnx-spacing-4);

	p {
		color: var(--color-primary-accent-alpha);
		margin-bottom: var(--lnx-spacing-4);
	}
}

section {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-1);

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

	.stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--lnx-spacing-2);
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
		box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
		color: var(--color-gray-7);
		text-decoration: none;

		&.link {
			transition: transform .15s;

			&:active {
				transform: scale(.98);
			}
		}

		.stat-icon {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 32px;
			height: 32px;
			margin-bottom: var(--lnx-spacing-1);
			border-radius: var(--lnx-radius-circle);
			background: var(--color-gray-1);
			color: var(--color-primary);
		}

		strong {
			color: var(--color-gray-9);
			font-size: 1.6rem;
			line-height: 1.1;

			.of {
				color: var(--color-gray-5);
				font-weight: var(--lnx-font-weight-regular);
			}
		}

		span {
			font-size: var(--lnx-font-size-small);
		}

		small {
			margin-top: auto;
			padding-top: var(--lnx-spacing-1);
			color: var(--color-gray-6);
			font-size: .7rem;
		}

		&.link small {
			color: var(--color-primary);
			font-weight: var(--lnx-font-weight-bold);
		}
	}

	.contacts {
		display: flex;
		gap: var(--lnx-spacing-2);
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		margin: 0 calc(-1 * var(--lnx-spacing-4));
		padding: 2px var(--lnx-spacing-4) var(--lnx-spacing-2);

		li {
			flex: 0 0 auto;
			width: min(260px, 75vw);
			display: flex;
			align-items: center;
			gap: var(--lnx-spacing-2);
			padding: var(--lnx-spacing-2) var(--lnx-spacing-2) var(--lnx-spacing-2) var(--lnx-spacing-3);
			border: 1px solid var(--color-gray-3);
			border-radius: var(--lnx-radius-3);
			background: var(--color-gray-0);
			box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
			scroll-snap-align: start;
			scroll-margin-left: var(--lnx-spacing-4);
		}

		.contact-icon {
			flex-shrink: 0;
			color: var(--color-primary);
		}

		.contact-body {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;

			small {
				color: var(--color-gray-6);
				font-size: .7rem;
			}

			strong {
				overflow: hidden;
				color: var(--color-gray-9);
				font-size: var(--lnx-font-size-small);
				text-overflow: ellipsis;
				white-space: nowrap;
			}
		}

		.contact-actions {
			flex-shrink: 0;
			display: flex;
			gap: var(--lnx-spacing-1);
		}

		.whatsapp {
			--lnx-button-color: #128c4b;
		}
	}

	.events {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-2);

		li:last-child {
			mask-image: linear-gradient(to bottom, rgba(0,0,0,1), rgba(0,0,0,.2) 30%, rgba(0,0,0,0) 90%);
		}
	}
}
</style>
