<script setup lang="ts">
import type { Issue } from '../domain/issue.ts';
import { BUTTON_VARIANTS, LnxButton, LnxIcon, LnxInput } from 'lnxjs-components';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { useUserProperties } from '@/modules/community/application/useUserProperties.ts';
import { getCommonAreaIcon } from '@/modules/community/domain/community.ts';
import { propertyTypeIcons } from '@/modules/community/domain/property.ts';
import MainLayout from '@/shared/ui/MainLayout.vue';
import TheToolbar from '@/shared/ui/TheToolbar.vue';
import { scrollTop } from '@/shared/utils/helpers.ts';
import { useCreateIssue } from '../application/useIssues.ts';
import { issuesCategories } from '../domain/issue.ts';

type Category = (typeof issuesCategories)[number];
type Place = NonNullable<Issue['location']> & { reference: string };

const STEPS = ['¿Qué ha pasado?', '¿Dónde ha pasado?', '¿Quieres añadir algo?'];

const router = useRouter();
const { createIssue } = useCreateIssue();
const { userCommunity } = useUserCommunity();
const { userProperties } = useUserProperties();

const step = ref(0);
const goingBack = ref(false);
const $heading = useTemplateRef('$heading');

function goTo(index: number) {
	goingBack.value = index < step.value;
	step.value = index;
}

// Each step starts at the top, and screen readers announce its question
watch(step, () => {
	scrollTop();
	$heading.value?.focus({ preventScroll: true });
});

const category = ref<Category>();
const place = ref<Place>();
// Only set while the place is written by hand
const otherPlace = ref<string>();
const $otherPlace = useTemplateRef('$otherPlace');
const description = ref('');
const title = ref('');

// Changing the category from the last step goes straight back to it
function chooseCategory(option: Category) {
	category.value = option;
	goTo(place.value ? 2 : 1);
}

function choosePlace(value: Place, typed = false) {
	place.value = value;
	if (!typed) {
		otherPlace.value = undefined;
	}
	goTo(2);
}

function isChosenArea(area: string) {
	return otherPlace.value === undefined && place.value?.type === 'common_area' && place.value.reference === area;
}

async function writeOtherPlace() {
	otherPlace.value ??= '';
	await nextTick();
	$otherPlace.value?.$input?.focus();
}

// Issues sent without a title are named after what and where, e.g. "Avería en garaje"
const defaultTitle = computed(() => {
	if (!category.value || !place.value) {
		return '';
	}

	const { reference } = place.value;
	return `${category.value.defaultTitle} en ${reference.charAt(0).toLowerCase()}${reference.slice(1)}`;
});

const saving = ref(false);
const error = ref(false);

async function submit() {
	if (!category.value || !place.value) {
		return;
	}

	saving.value = true;
	error.value = false;

	try {
		const id = await createIssue({
			title: title.value.trim() || defaultTitle.value,
			description: description.value.trim(),
			category: category.value.value,
			location: place.value,
		});
		// Replaced so going back from the new issue doesn't land on the form again
		await router.replace(`/issues/${id}`);
	} catch {
		error.value = true;
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<TheToolbar
		title="Nueva incidencia"
		back="/issues"
		:on-back="step ? () => goTo(step - 1) : undefined"
	>
		<template #subtitle>
			<span class="progress">
				<span class="bar" aria-hidden="true">
					<span
						v-for="(_, index) in STEPS"
						:key="index"
						:class="{ done: index <= step }"
					/>
				</span>
				Paso {{ step + 1 }} de {{ STEPS.length }}
			</span>
		</template>
	</TheToolbar>

	<header>
		<h1 ref="$heading" tabindex="-1">
			{{ STEPS[step] }}
		</h1>
	</header>

	<MainLayout class="wizard">
		<Transition :name="goingBack ? 'step-back' : 'step-forward'" mode="out-in">
			<ul v-if="step === 0" class="categories">
				<li v-for="option in issuesCategories" :key="option.value">
					<LnxButton
						:variant="category?.value === option.value ? BUTTON_VARIANTS.PRIMARY : BUTTON_VARIANTS.GRAYSCALE"
						:aria-pressed="category?.value === option.value"
						class="option category"
						:style="{
							'--cat-color': `var(--color-issue-cat-${option.value}-accent)`,
							'--cat-color-bg': `var(--color-issue-cat-${option.value})`,
						}"
						is-block
						@click="chooseCategory(option)"
					>
						<template #prefix>
							<span class="icon">
								<LnxIcon :icon="option.icon" :size="28" />
							</span>
						</template>

						<span class="text">
							<strong>{{ option.label }}</strong>
							<span class="examples">{{ option.examples }}</span>
						</span>

						<template #suffix>
							<LnxIcon icon="lucide:chevron-right" :size="24" class="chevron" />
						</template>
					</LnxButton>
				</li>
			</ul>

			<div v-else-if="step === 1" class="places">
				<section v-if="userProperties.length">
					<h2>Tus propiedades</h2>
					<ul class="grid">
						<li v-for="property in userProperties" :key="property.id">
							<LnxButton
								:variant="place?.propertyId === property.id ? BUTTON_VARIANTS.PRIMARY : BUTTON_VARIANTS.GRAYSCALE"
								:aria-pressed="place?.propertyId === property.id"
								class="option place"
								is-block
								@click="choosePlace({ type: 'property', propertyId: property.id, reference: property.name })"
							>
								<LnxIcon :icon="propertyTypeIcons[property.type]" :size="28" />
								{{ property.name }}
							</LnxButton>
						</li>
					</ul>
				</section>

				<section>
					<h2>Zonas comunes</h2>
					<ul class="grid">
						<li v-for="area in userCommunity?.commonAreas" :key="area">
							<LnxButton
								:variant="isChosenArea(area) ? BUTTON_VARIANTS.PRIMARY : BUTTON_VARIANTS.GRAYSCALE"
								:aria-pressed="isChosenArea(area)"
								class="option place"
								is-block
								@click="choosePlace({ type: 'common_area', reference: area })"
							>
								<LnxIcon :icon="getCommonAreaIcon(area)" :size="28" />
								{{ area }}
							</LnxButton>
						</li>
						<li>
							<LnxButton
								:variant="otherPlace !== undefined ? BUTTON_VARIANTS.PRIMARY : BUTTON_VARIANTS.GRAYSCALE"
								:aria-pressed="otherPlace !== undefined"
								class="option place"
								is-block
								@click="writeOtherPlace()"
							>
								<LnxIcon icon="lucide:pencil" :size="28" />
								Otro sitio
							</LnxButton>
						</li>
					</ul>
				</section>

				<form
					v-if="otherPlace !== undefined"
					class="other-place"
					@submit.prevent="choosePlace({ type: 'common_area', reference: otherPlace.trim() }, true)"
				>
					<LnxInput
						ref="$otherPlace"
						v-model="otherPlace"
						placeholder="Ej: Portal 2, trastero 4…"
						enterkeyhint="next"
					>
						¿Dónde exactamente?
					</LnxInput>
					<LnxButton
						type="submit"
						size="large"
						is-block
						:disabled="!otherPlace.trim()"
					>
						Continuar
						<template #suffix>
							<LnxIcon icon="lucide:arrow-right" />
						</template>
					</LnxButton>
				</form>
			</div>

			<form v-else-if="category && place" class="details" @submit.prevent="submit()">
				<div class="summary">
					<div
						class="summary-row"
						:style="{
							'--cat-color': `var(--color-issue-cat-${category.value}-accent)`,
							'--cat-color-bg': `var(--color-issue-cat-${category.value})`,
						}"
					>
						<span class="icon">
							<LnxIcon :icon="category.icon" :size="20" />
						</span>
						<span class="value">{{ category.label }}</span>
						<LnxButton
							type="button"
							mode="link"
							aria-label="Cambiar qué ha pasado"
							@click="goTo(0)"
						>
							Cambiar
						</LnxButton>
					</div>
					<div class="summary-row">
						<span class="icon">
							<LnxIcon icon="lucide:map-pin" :size="20" />
						</span>
						<span class="value">{{ place.reference }}</span>
						<LnxButton
							type="button"
							mode="link"
							aria-label="Cambiar dónde ha pasado"
							@click="goTo(1)"
						>
							Cambiar
						</LnxButton>
					</div>
				</div>

				<label class="description">
					Cuéntanos más (opcional)
					<textarea
						v-model="description"
						rows="4"
						placeholder="Por ejemplo: desde cuándo pasa o si es urgente"
					/>
				</label>

				<LnxInput
					v-model="title"
					:placeholder="defaultTitle"
					enterkeyhint="send"
				>
					Título (opcional)
					<template #helper>
						Si lo dejas vacío, se llamará «{{ defaultTitle }}»
					</template>
				</LnxInput>

				<p v-if="error" class="error" role="alert">
					<LnxIcon icon="lucide:circle-alert" :size="20" class="error-icon" />
					No se ha podido enviar. Revisa tu conexión e inténtalo de nuevo.
				</p>

				<div class="send">
					<LnxButton
						type="submit"
						size="large"
						is-block
						:is-loading="saving"
						:disabled="saving"
					>
						<template #prefix>
							<LnxIcon icon="lucide:send" />
						</template>
						Enviar aviso
					</LnxButton>
					<small>Toda la comunidad podrá verlo.</small>
				</div>
			</form>
		</Transition>
	</MainLayout>
</template>

<style lang="scss" scoped>
header {
	// Starts below the fixed toolbar, which is always shown
	padding: calc(var(--toolbar-height) + var(--lnx-spacing-4)) var(--lnx-spacing-4) 0;

	h1 {
		color: var(--color-gray-9);
		line-height: 1.2;
		// Focused by code to announce each step, not by the user
		outline: none;
	}
}

.progress {
	display: flex;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
	font-weight: var(--lnx-font-weight-bold);
	white-space: nowrap;

	.bar {
		flex: 1;
		display: flex;
		gap: var(--lnx-spacing-1);

		span {
			flex: 1;
			height: 6px;
			border-radius: 6px;
			background: var(--color-gray-3);
			transition: background .3s;

			&.done {
				background: var(--color-primary);
			}
		}
	}
}

// The steps slide in, so they must not widen the page meanwhile
.wizard {
	overflow-x: clip;
}

// Big LnxButtons shaped like the issues list cards, easy to read and tap for anyone
.option {
	min-height: 76px;
	padding: var(--lnx-spacing-3);
	border-radius: var(--lnx-radius-3);
	transition: transform .15s;

	&:active {
		transform: scale(.98);
	}
}

.categories {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-3);
}

.category {
	justify-content: flex-start;
	gap: var(--lnx-spacing-3);
	text-align: left;

	.icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 52px;
		height: 52px;
		border-radius: var(--lnx-radius-3);
		color: var(--cat-color);
		background: var(--cat-color-bg);
	}

	.text {
		flex: 1;
		display: flex;
		flex-direction: column;

		strong {
			font-size: var(--lnx-font-size-big);
			font-weight: var(--lnx-font-weight-bold);
		}
	}

	.examples,
	.chevron {
		opacity: .75;
	}
}

.places {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-5);

	section {
		display: flex;
		flex-direction: column;
		gap: var(--lnx-spacing-2);
	}

	h2 {
		color: var(--color-gray-7);
		font-size: var(--lnx-font-size-body);
		font-weight: var(--lnx-font-weight-bold);
	}
}

.grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: var(--lnx-spacing-3);

	li {
		display: flex;
	}
}

.place {
	min-height: 88px;
	flex-direction: column;
	font-size: var(--lnx-font-size-big);
	font-weight: var(--lnx-font-weight-bold);
	overflow-wrap: anywhere;
}

.other-place,
.details {
	display: flex;
	flex-direction: column;
	gap: var(--lnx-spacing-4);
}

.details {
	gap: var(--lnx-spacing-5);
}

.summary {
	padding: var(--lnx-spacing-1) var(--lnx-spacing-3);
	border: 1px solid var(--color-gray-3);
	border-radius: var(--lnx-radius-3);
	background: var(--color-gray-1);

	.summary-row {
		min-height: 60px;
		display: flex;
		align-items: center;
		gap: var(--lnx-spacing-3);
		color: var(--color-gray-9);
		font-size: var(--lnx-font-size-big);
		font-weight: var(--lnx-font-weight-bold);

		& + .summary-row {
			border-top: 1px solid var(--color-gray-3);
		}
	}

	.icon {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--lnx-radius-3);
		color: var(--cat-color, var(--color-primary));
		background: var(--cat-color-bg, var(--color-gray-0));
	}

	.value {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
}

// Same look as LnxInput, which has no multiline version
.description {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: var(--lnx-font-size-small);

	textarea {
		width: 100%;
		padding: 8px;
		border: 1px solid var(--lnx-color-gray-5);
		border-radius: 4px;
		font-size: var(--lnx-font-size-body);
		resize: vertical;

		&::placeholder {
			color: var(--lnx-color-gray-3);
		}
	}
}

.error {
	display: flex;
	align-items: flex-start;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-9);
	font-weight: var(--lnx-font-weight-bold);

	.error-icon {
		flex-shrink: 0;
		color: var(--lnx-color-danger);
	}
}

.send {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--lnx-spacing-2);
	color: var(--color-gray-7);
	font-size: var(--lnx-font-size-small);
}

.step-forward-enter-active,
.step-forward-leave-active,
.step-back-enter-active,
.step-back-leave-active {
	transition: opacity .2s, transform .25s cubic-bezier(.2, 0, 0, 1);
}

.step-forward-enter-from,
.step-back-leave-to {
	opacity: 0;
	transform: translateX(32px);
}

.step-forward-leave-to,
.step-back-enter-from {
	opacity: 0;
	transform: translateX(-32px);
}

@media (prefers-reduced-motion: reduce) {
	.step-forward-enter-from,
	.step-forward-leave-to,
	.step-back-enter-from,
	.step-back-leave-to {
		transform: none;
	}
}
</style>
