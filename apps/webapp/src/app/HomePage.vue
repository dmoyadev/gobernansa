<script setup lang="ts">
import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { contactTypes, getPhoneLink, getWhatsappLink } from '@gobernansa/shared/domain/community.ts';
import { getVotingMonth, ISSUE_ICON } from '@gobernansa/shared/domain/issue.ts';
import { formatCents } from '@gobernansa/shared/domain/money.ts';
import { scrollTop } from '@gobernansa/shared/utils/helpers.ts';
import { LnxButton, LnxIcon } from 'lnxjs-components';
import { computed, ref } from 'vue';
import { useCurrentUser } from 'vuefire';
import InstallApp from '@/app/ui/InstallApp.vue';
import MainLayout from '@/app/ui/MainLayout.vue';
import TheHeader from '@/app/ui/TheHeader.vue';
import { usePending } from '@/app/usePending.ts';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { useUserProperties } from '@/modules/community/application/useUserProperties.ts';
import CommunitySwitcher from '@/modules/community/ui/CommunitySwitcher.vue';
import { useCommunityEvents } from '@/modules/events/application/useCommunityEvents.ts';
import EventCard from '@/modules/events/ui/EventCard.vue';
import { getAuthorKey } from '@/modules/issues/application/authorKey.ts';
import { issuesFilters } from '@/modules/issues/application/useIssues.ts';
import { useUserActivity } from '@/modules/issues/application/useUserActivity.ts';
import { formatMeetingDate } from '@/modules/meetings/application/useMeetings.ts';

const user = useCurrentUser();
const { selectedProperty } = useUserProperties();
const { userCommunity } = useUserCommunity();
const { communities, user: profile, viewingAs } = useAuth();

// Who entered with a code (B2.4) is reminded to add an email, until they do or for a week after «Ahora no»
const REMIND_KEY = 'emailReminder';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const remindedAt = ref(Number(readStorage(REMIND_KEY) ?? 0));
const remindEmail = computed(() => !!profile.value && !profile.value.email && !viewingAs.value && Date.now() - remindedAt.value > WEEK);

function remindLater() {
	remindedAt.value = Date.now();
	try {
		localStorage.setItem(REMIND_KEY, String(remindedAt.value));
	} catch {}
}

function readStorage(key: string) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
const { events, loading: eventsLoading, error: eventsError } = useCommunityEvents(3, true);
const { issues, votingProperty, canVoteAsOwner, votesLeft, monthlyVotes } = useUserActivity();
// What the user has to do, first. Only when there's something, so a day with nothing doesn't add a block
const { toAnswer, toSign, paymentsCount, paymentsTotal, paymentsError, overdue, payLink } = usePending();
const hasPending = computed(() => (!!paymentsCount.value && !paymentsError.value) || !!toAnswer.value || !!toSign.value.length);

const votesRenewOn = getVotingMonth().renewsOn.toLocaleDateString('es', { day: 'numeric', month: 'long' });

// The ones to call when something happens, in the order the community has them
const quickContacts = computed(() => (userCommunity.value?.contacts ?? []).filter(contact => contact.phone || contact.whatsapp));

// Already read for the counts, so it's there at once
async function showMyIssues() {
	scrollTop();
	if (user.value) {
		issuesFilters.value = { authorKey: await getAuthorKey(user.value.uid) };
	}
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
			<CommunitySwitcher v-if="communities.length > 1" />
			<p
				v-else-if="userCommunity"
				class="text-cursive"
			>
				Bienvenido a {{ userCommunity?.name }}
			</p>
		</div>
	</TheHeader>

	<MainLayout>
		<div v-if="remindEmail" class="reminder" role="status">
			<LnxIcon icon="lucide:mail-plus" :size="24" />
			<div>
				<h2>Añade tu email</h2>
				<p>Si pierdes la carta con tu código, con tu email podrás recuperar el acceso.</p>
				<div class="actions">
					<LnxButton to="/profile#email">
						Añadir email
					</LnxButton>
					<LnxButton mode="clear" variant="grayscale" @click="remindLater()">
						Ahora no
					</LnxButton>
				</div>
			</div>
		</div>

		<section v-if="hasPending">
			<header>
				<h2>Pendiente</h2>
			</header>

			<ul class="todo">
				<li v-if="paymentsCount && !paymentsError">
					<RouterLink :to="payLink" class="todo-item">
						<span class="todo-icon" :class="{ overdue }">
							<LnxIcon icon="lucide:credit-card" :size="20" />
						</span>
						<span class="todo-body">
							<strong>{{ paymentsCount === 1 ? 'Tienes un pago pendiente' : `Tienes ${paymentsCount} pagos pendientes` }}</strong>
							<small class="tabular">{{ formatCents(paymentsTotal) }}<template v-if="overdue"> · alguno ya ha vencido</template></small>
						</span>
						<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
					</RouterLink>
				</li>
				<li v-if="toAnswer">
					<RouterLink :to="`/neighborhood/meetings/${toAnswer.id}`" class="todo-item">
						<span class="todo-icon">
							<LnxIcon icon="lucide:gavel" :size="20" />
						</span>
						<span class="todo-body">
							<strong>¿Vas a ir a la junta?</strong>
							<small>{{ formatMeetingDate(toAnswer.date) }}</small>
						</span>
						<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
					</RouterLink>
				</li>
				<li v-for="meeting in toSign" :key="meeting.id">
					<RouterLink :to="`/neighborhood/meetings/${meeting.id}`" class="todo-item">
						<span class="todo-icon">
							<LnxIcon icon="lucide:file-pen-line" :size="20" />
						</span>
						<span class="todo-body">
							<strong>Firma el acta</strong>
							<small>De la junta del {{ meeting.date.toDate().toLocaleDateString('es', { day: 'numeric', month: 'long' }) }}</small>
						</span>
						<LnxIcon class="chevron" icon="lucide:chevron-right" :size="18" />
					</RouterLink>
				</li>
			</ul>
		</section>

		<div class="cta">
			<h2>¿Algo no va bien?</h2>
			<p class="text-cursive">
				Avisa de cualquier problema para que empecemos a trabajar en ello cuanto antes.
			</p>
			<LnxButton variant="danger" to="/issues/new" is-block>
				<LnxIcon :icon="ISSUE_ICON" />
				Dar aviso
			</LnxButton>
		</div>

		<InstallApp dismissible />

		<section>
			<header>
				<h2>Tu actividad</h2>
			</header>

			<div class="stats">
				<RouterLink to="/issues" class="stat link" @click="showMyIssues()">
					<span class="stat-icon">
						<LnxIcon :icon="ISSUE_ICON" :size="18" />
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
					<span v-if="!canVoteAsOwner">Votan los propietarios, con cada propiedad</span>
					<span v-else-if="votesLeft === 0">Ya has usado los votos de {{ votingProperty?.name }} este mes</span>
					<span v-else>{{ votesLeft === 1 ? 'Voto disponible' : 'Votos disponibles' }} de {{ votingProperty?.name }} este mes</span>
					<!-- Not "new ones": unused votes don't carry over -->
					<small v-if="canVoteAsOwner">Vuelves a tener {{ monthlyVotes }} el {{ votesRenewOn }}</small>
				</div>
			</div>
		</section>

		<section v-if="quickContacts.length">
			<header>
				<h2>Contactos rápidos</h2>
				<LnxButton
					class="btn-all"
					size="sm"
					to="/neighborhood#contacts"
					mode="clear"
					variant="grayscale"
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
							size="sm"
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
							:href="getPhoneLink(contact.phone)"
							shape="circle"
							size="sm"
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
					size="sm"
					to="/notices"
					mode="clear"
					variant="grayscale"
					@click="scrollTop()"
				>
					Ver todo
				</LnxButton>
			</header>

			<ul v-if="eventsLoading" class="events" aria-label="Cargando">
				<li v-for="index in 2" :key="index" class="lnx-skeleton lnx-skeleton--rect" />
			</ul>
			<p v-else-if="!events.length" class="empty">
				{{ eventsError ? 'No se ha podido cargar la actividad. Revisa tu conexión.' : 'Aún no hay actividad en tu comunidad.' }}
			</p>
			<ul v-else class="events">
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

.reminder {
	display: flex;
	gap: var(--lnx-spacing-3);
	padding: var(--lnx-spacing-4);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-0);
	color: var(--color-primary);

	h2 {
		color: var(--color-gray-9);
		font-size: 1.1rem;
	}

	p {
		margin: var(--lnx-spacing-1) 0 var(--lnx-spacing-3);
		color: var(--color-gray-7);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--lnx-spacing-2);
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
				color: var(--color-gray-6);
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
			font-size: .75rem;
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
				font-size: .75rem;
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

	.todo {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-2);
	}

	.todo-item {
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);
		min-height: 64px;
		padding: var(--lnx-spacing-2) var(--lnx-spacing-3);
		border: 1px solid var(--color-gray-3);
		border-radius: var(--lnx-radius-3);
		background: var(--color-gray-0);
		box-shadow: 0 1px 2px #0000000A, 0 2px 8px #00000008;
		color: inherit;
		text-decoration: none;

		.todo-icon {
			flex-shrink: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 40px;
			height: 40px;
			border-radius: var(--lnx-radius-circle);
			background: var(--color-gray-1);
			color: var(--color-primary);

			&.overdue {
				color: var(--color-secondary-accent);
			}
		}

		.todo-body {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 2px;

			strong {
				color: var(--color-gray-9);
			}

			small {
				color: var(--color-gray-6);
				font-size: var(--lnx-font-size-small);
			}
		}

		.chevron {
			flex-shrink: 0;
			color: var(--color-gray-5);
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

		li:last-child {
			mask-image: linear-gradient(to bottom, rgba(0,0,0,1), rgba(0,0,0,.2) 30%, rgba(0,0,0,0) 90%);
		}
	}
}
</style>
