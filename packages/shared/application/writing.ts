import type { DefaultIssueCategory, Issue, IssueComment } from '../domain/issue.ts';
import type { ProviderCategory } from '../domain/provider.ts';
import { DEFAULT_ISSUE_CATEGORIES, issueStatus } from '../domain/issue.ts';
import { providerCategories } from '../domain/provider.ts';
import { normalize } from '../utils/helpers.ts';

/*
 * Sugerencias y redacción automática: suggest an issue's category and urgency, sum up its thread, draft a notice and polish
 * the acta. With the browser's own on-device APIs when it has them (Chrome's LanguageModel, Summarizer, Writer and
 * Rewriter), else with rules and templates. Either way nothing leaves the device and nothing is paid. Imported lazily
 */

// What ran, shown in a chip: 'device' is the browser's on-device API, 'basic' the rules and templates
export type WritingSource = 'device' | 'basic';
// Tells how a download or a long run goes. Only passed from a click: the browser downloads its models only after a user gesture
export type Progress = (status: string) => void;

/* The browser's on-device APIs, declared here as far as they're used */

type Api = 'LanguageModel' | 'Summarizer' | 'Writer' | 'Rewriter';
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface Session {
	destroy: () => void;
}
interface Factory<T extends Session> {
	availability: (options: object) => Promise<Availability>;
	create: (options: object) => Promise<T>;
}
interface DownloadMonitor {
	addEventListener: (type: 'downloadprogress', listener: (event: { loaded: number }) => void) => void;
}
interface Prompter extends Session {
	prompt: (input: string, options: { responseConstraint: object; signal?: AbortSignal }) => Promise<string>;
}
interface Summarizer extends Session {
	summarize: (input: string) => Promise<string>;
}
interface Writer extends Session {
	write: (input: string, options?: { context?: string }) => Promise<string>;
}
interface Rewriter extends Session {
	rewrite: (input: string, options?: { context?: string }) => Promise<string>;
}

const SPANISH = { expectedInputLanguages: ['es'], expectedContextLanguages: ['es'], outputLanguage: 'es' };

function factory<T extends Session>(api: Api) {
	return (globalThis as unknown as Partial<Record<Api, Factory<T>>>)[api];
}

// Runs `use` with the browser's API and frees it after. Undefined when it isn't there, still has to be downloaded and no
// click asked for it (no onProgress), or anything fails: the caller then falls back to its basic version
async function onDevice<T extends Session, R>(api: Api, options: object, use: (session: T) => Promise<R | undefined>, onProgress?: Progress): Promise<R | undefined> {
	let session: T | undefined;
	try {
		const browser = factory<T>(api);
		const availability = await browser?.availability(options);
		if (!browser || availability === 'unavailable' || (availability !== 'available' && !onProgress)) {
			return undefined;
		}
		session = await browser.create({
			...options,
			monitor: (monitor: DownloadMonitor) => monitor.addEventListener('downloadprogress', event => onProgress?.(`Preparando en tu dispositivo… ${Math.round(event.loaded * 100)} %`)),
		});
		return await use(session);
	} catch {
		return undefined;
	} finally {
		session?.destroy();
	}
}

/* Text helpers */

const FIGURES_REGEX = /\d+(?:[.,:]\d+)*/g;
const NAMES_REGEX = /(?<=[\p{Ll},;]\s+)\p{Lu}\p{L}*/gu;
const SPACES_REGEX = /\s+/g;
const BULLET_REGEX = /^\s*(?:[-*•·]|\d+[.)])\s*/;
const SEPARATORS_REGEX = /[^\p{L}\p{N}]+/gu;
const END_REGEX = /[.!?…:]$/;
const FULL_STOP_REGEX = /\.$/;
const QUOTES_REGEX = /^["«]|["».]$/g;

// The figures of a text (amounts, dates, times, percentages), what a rewrite has to keep as they were
function figures(text: string) {
	return [...new Set(text.match(FIGURES_REGEX) ?? [])].sort();
}

// Capitalised words in the middle of a sentence: the names a rewrite has to keep
function names(text: string) {
	return text.match(NAMES_REGEX) ?? [];
}

function clip(text: string, max: number) {
	const flat = text.replace(SPACES_REGEX, ' ').trim();
	const cut = flat.lastIndexOf(' ', max - 1);
	return flat.length <= max ? flat : `${flat.slice(0, cut > 0 ? cut : max - 1)}…`;
}

// Bullet lists as the APIs or a person write them, one item per line without its marker
function toLines(text: string) {
	return text.split('\n').map(line => line.replace(BULLET_REGEX, '').trim()).filter(Boolean);
}

/* 1. Issue suggestion */

export type Urgency = 'low' | 'normal' | 'high' | 'urgent';

export const urgencies: Record<Urgency, { label: string; icon: string }> = {
	low: { label: 'Baja', icon: 'lucide:chevrons-down' },
	normal: { label: 'Normal', icon: 'lucide:equal' },
	high: { label: 'Alta', icon: 'lucide:chevrons-up' },
	urgent: { label: 'Urgente', icon: 'lucide:siren' },
};

const URGENCY_ORDER = Object.keys(urgencies) as Urgency[];
const rank = (urgency: Urgency) => URGENCY_ORDER.indexOf(urgency);

export interface IssueSuggestion {
	// One of the defaults, missing when nothing in the text points to one. Communities that removed it get no suggestion
	category?: DefaultIssueCategory;
	provider?: ProviderCategory;
	urgency: Urgency;
	reason: string;
	// What to do right now, for emergencies
	hint?: string;
	source: WritingSource;
}

interface Rule {
	match: RegExp;
	category?: DefaultIssueCategory;
	provider?: ProviderCategory;
	urgency?: Urgency;
	reason?: string;
	hint?: string;
}

const HINTS = {
	gas: 'Si huele a gas, no enciendas luces ni aparatos, abre las ventanas, sal y llama al 112 o al teléfono de urgencias de la compañía del gas.',
	fire: 'Si hay fuego o humo, sal del edificio por la escalera, nunca en ascensor, y llama al 112.',
	elevator: 'Que pulsen el botón de alarma del ascensor. Si nadie contesta, llama al 112.',
	electric: 'No toques los cables ni el cuadro eléctrico. Si hay peligro, llama al 112.',
	water: 'Si puedes, cierra la llave de paso del agua.',
	falling: 'Aleja a la gente de la zona y, si hay peligro, llama al 112.',
	security: 'Si está ocurriendo ahora, llama al 112.',
};

// Over the text without accents, punctuation or capitals. The category comes from the first rule that matches, so the
// specific ones go first; the urgency from the most urgent one
// ponytail: keyword rules miss what's described in other words, the on-device API covers it where the browser has one
const RULES: Rule[] = [
	// Emergencies
	{ match: /\b(olor (a|de) gas|huele a gas|fuga de gas|escape de gas|perdida de gas|sale gas)\b/, category: 'maintenance', provider: 'other', urgency: 'urgent', reason: 'Puede ser una fuga de gas', hint: HINTS.gas },
	{ match: /\b(fuego|en llamas|ardiendo|quemando|se quema|chamuscad\w*)\b|(?<!(de|contra) )\bincendi\w*|(?<!detector(es)? de )\bhumo\b(?! de (tabaco|cigarr|porro))/, category: 'maintenance', provider: 'fire_safety', urgency: 'urgent', reason: 'Fuego o humo', hint: HINTS.fire },
	{ match: /^(?=.*\bascensor)(?=.*\b(atrapad\w*|encerrad\w*|(gente|alguien|personas?|ninos?|ninas?|vecinos?|vecinas?) dentro))/, category: 'maintenance', provider: 'elevator', urgency: 'urgent', reason: 'Hay personas atrapadas en el ascensor', hint: HINTS.elevator },
	{ match: /\b(chispas?|chispazos?|cortocircuitos?|calambres?|descargas? electricas?|electrocut\w*|cables? (pelados?|sueltos?|al aire))\b/, category: 'maintenance', provider: 'electricity', urgency: 'urgent', reason: 'Riesgo eléctrico', hint: HINTS.electric },
	{ match: /\b(sin luz|no hay luz|no funciona la luz|no funcionan las luces|no (se )?(enciende|encienden) (la luz|las luces)|a oscuras|apagon)\b/, category: 'maintenance', provider: 'electricity', urgency: 'urgent', reason: 'Sin luz, con riesgo de caídas' },
	{ match: /\b(fugas? de agua|inundaci\w*|inundad\w*|reventon|reventad\w*|tuberias? rotas?|rotura de (la )?tuberia|chorro de agua|agua por todas partes)\b|(?<!no )\b(sale|cae|entra) (mucha )?agua\b/, category: 'maintenance', provider: 'plumbing', urgency: 'urgent', reason: 'Fuga o entrada de agua', hint: HINTS.water },
	{ match: /\b(desprendimientos?|cascotes|derrumbe|se (cae|caen|esta cayendo|estan cayendo) (trozos|cascotes|la fachada|el techo|parte))\b/, category: 'maintenance', provider: 'painting', urgency: 'urgent', reason: 'Riesgo de caída de materiales', hint: HINTS.falling },
	// Something important out of use, or the building's security
	{ match: /^(?=.*\bascensor)(?=.*\b(parado|no funciona|no va|averiad\w*|estropead\w*|bloquead\w*|fuera de servicio|no (baja|sube|abre|para)))/, category: 'maintenance', provider: 'elevator', urgency: 'high', reason: 'Ascensor parado' },
	{ match: /\b(robos?|robad\w*|roban|forzad\w*|okupa\w*|intrus\w*|vandalism\w*|vandalos?)\b/, category: 'services', provider: 'locksmith', urgency: 'high', reason: 'Afecta a la seguridad del edificio', hint: HINTS.security },
	{ match: /^(?=.*\b(puertas?|portal|porton|cancela|garaje|acceso))(?=.*\b(no (se )?(cierra|abre)n?|(se )?queda abierta|no se puede (abrir|cerrar)))/, category: 'maintenance', provider: 'locksmith', urgency: 'high', reason: 'Una puerta de acceso no cierra o no abre' },
	{ match: /\b(goteras?|gotea\w*|filtraci\w*|sin agua|no hay agua|no sale agua|atasc\w*|desagues?|bajantes?|alcantarill\w*|arquetas?|fecales)\b/, category: 'maintenance', provider: 'plumbing', urgency: 'high', reason: 'Agua o desagüe' },
	{ match: /\b(ratas?|raton\w*|roedor\w*|avispas?|avisperos?|chinches?)\b/, category: 'cleaning', provider: 'pest_control', urgency: 'high', reason: 'Plaga con riesgo para la salud' },
	{ match: /^(?=.*\b(arbol\w*|ramas?|palmeras?))(?=.*\b(caid[oa]s?|caer|cae|partid[oa]s?|inclinad[oa]s?))/, category: 'landscaping', provider: 'gardening', urgency: 'high', reason: 'Un árbol o una rama puede caer', hint: HINTS.falling },
	{ match: /\b(?<!no es |no corre |nada )(urgente|urgencia)\b|\b(emergencia|peligro\w*|riesgo)\b/, urgency: 'high', reason: 'Se describe como urgente o peligroso' },
	// Low: a proposal, or cosmetic
	{ match: /\b(sugerencias?|propuestas?|propongo|sugiero|seria (buena idea|bueno|conveniente)|estaria bien|cuando (se )?pueda|sin prisa|no (es|corre) urgente|no corre prisa)\b/, urgency: 'low', reason: 'Es una propuesta o no corre prisa' },
	{ match: /\b(desconch\w*|pintura|pintar|pintadas?|grafitis?|graffitis?|aranazos?|estetic\w*)\b/, category: 'maintenance', provider: 'painting', urgency: 'low', reason: 'Desperfecto estético' },
	// The category alone
	{ match: /\b(sucio|sucia|sucios|sucias|suciedad|basuras?|excrementos?|cacas?|orin\w*|meado\w*|vomit\w*|limpi\w*|polvo|barrer|fregar|contenedor\w*|cubos?)\b/, category: 'cleaning', provider: 'cleaning' },
	{ match: /\b(plagas?|cucarachas?|insectos?|termitas?|palomas?|pulgas?|hormigas?|mosquitos?|garrapatas?|desratiz\w*|fumig\w*)\b/, category: 'cleaning', provider: 'pest_control' },
	{ match: /\b(jardin\w*|cesped|plantas?|arbol\w*|arbust\w*|setos?|poda\w*|riego|regar|aspersor\w*|hojas|ramas?|hierbas?|macetas?|flores|palmeras?|zona verde)\b/, category: 'landscaping', provider: 'gardening' },
	{ match: /\b(fiestas?|musica|gritos?|grita\w*|voces|ladr\w*|perros?|mascotas?|fuma\w*|tabaco|cigarr\w*|porros?|madrugada|molest\w*|incivic\w*|vecinos? de (arriba|abajo|al lado))\b/, category: 'nuisance', provider: 'other' },
	{ match: /\bascensor(es)?\b/, category: 'maintenance', provider: 'elevator' },
	{ match: /\bgas\b/, category: 'maintenance', provider: 'other' },
	{ match: /\b(piscinas?|depuradora|socorrista|pistas?|tenis|padel|gimnasio|parque infantil|columpios?|tobogan|zona infantil|conserje\w*|porteria|vigilan\w*|camaras?|seguridad|wifi|internet|antenas?|television|parabolica|trasteros?|bicis?|aparcamiento)\b/, category: 'services', provider: 'other' },
	{ match: /\b(agua|grifos?|tuberias?|cisternas?|fontaner\w*|humedad\w*|caldera|calentador|calefaccion|radiador\w*)\b/, category: 'maintenance', provider: 'plumbing' },
	{ match: /\b(extintor\w*|bies?|detector(es)? de humo|alarma de incendios|salidas? de emergencia|luces de emergencia|bocas? de incendios)\b/, category: 'maintenance', provider: 'fire_safety' },
	{ match: /\b(luz|luces|bombillas?|fluorescentes?|lamparas?|focos?|farolas?|enchufes?|interruptor\w*|electric\w*|automaticos?|diferencial|temporizador|pulsador\w*|telefonillo|portero automatico|videoportero|timbres?)\b/, category: 'maintenance', provider: 'electricity' },
	{ match: /\b(cerraduras?|cerrojos?|bombin|llaves?|mandos?|puertas?|porton|cancela)\b/, category: 'maintenance', provider: 'locksmith' },
	{ match: /\b(grietas?|fisuras?|azulejos?|baldosas?|losetas?|techo|fachada|cornisas?|tejas?|tejado|yeso|escayola|pared\w*|muros?|barandillas?|escalon\w*|peldan\w*)\b/, category: 'maintenance', provider: 'painting' },
	{ match: /\b(ruidos?|ruidos[oa]s?|olor\w*|huele|peste|apesta)\b/, category: 'nuisance', provider: 'other' },
	{ match: /\bmanchas?\b/, category: 'cleaning', provider: 'cleaning' },
	{ match: /\b(seguro|siniestro|perito|aseguradora|poliza)\b/, category: 'other', provider: 'insurance' },
];

function suggestByRules(text: string): Omit<IssueSuggestion, 'source'> | undefined {
	// Spaces for punctuation and line breaks first, as normalize() drops them and would join the words
	const words = normalize(text.replace(SEPARATORS_REGEX, ' '));
	if (!words) {
		return undefined;
	}
	const matched = RULES.filter(rule => rule.match.test(words));
	const what = matched.find(rule => rule.category);
	// Stable sort: among equally urgent ones the first listed wins
	const why = matched.filter(rule => rule.urgency).sort((a, b) => rank(b.urgency!) - rank(a.urgency!))[0];
	return {
		category: what?.category,
		provider: what?.provider,
		urgency: why?.urgency ?? 'normal',
		reason: why?.reason ?? 'Sin señales de urgencia',
		hint: why?.hint,
	};
}

const ISSUE_SCHEMA = {
	type: 'object',
	properties: {
		category: { enum: DEFAULT_ISSUE_CATEGORIES.map(category => category.id) },
		provider: { enum: Object.keys(providerCategories) },
		urgency: { enum: URGENCY_ORDER },
		reason: { type: 'string', maxLength: 100 },
	},
	required: ['category', 'provider', 'urgency', 'reason'],
	additionalProperties: false,
};

const ISSUE_PROMPT = {
	expectedInputs: [{ type: 'text', languages: ['es'] }],
	expectedOutputs: [{ type: 'text', languages: ['es'] }],
	initialPrompts: [{
		role: 'system',
		content: `Clasificas los avisos de los vecinos de una comunidad de propietarios en España. Responde solo con el JSON pedido.
category: maintenance (averías: luces, puertas, ascensor, fugas), cleaning (suciedad, basura, plagas), nuisance (ruidos, olores, molestias de vecinos), landscaping (jardín, plantas, riego), services (piscina, pistas, seguridad), other.
provider, el gremio que lo arreglaría: plumbing (fontanería), electricity, elevator, cleaning, gardening, locksmith (cerrajería), painting (pintura y albañilería), pest_control, fire_safety, insurance, other.
urgency: urgent si hay peligro para las personas o el daño crece (gas, fuego, humo, gente atrapada en el ascensor, fuga de agua, sin luz en zonas comunes); high si deja sin algo importante o afecta a la seguridad; low si es estético o una propuesta; normal en otro caso.
reason: el motivo de esa urgencia, en español y en menos de diez palabras.`,
	}],
};

const PROMPT_TIMEOUT_MS = 10_000;

// The rules alone, at once: what an issue shows while the on-device one runs, if the browser has it
export function suggestIssueByRules(text: Pick<Issue, 'title' | 'description'>): IssueSuggestion | undefined {
	const rules = suggestByRules(`${text.title} ${text.description}`);
	return rules && { ...rules, source: 'basic' };
}

// While the neighbour types (pass a signal to drop the previous one) or when an issue opens. Never downloads anything:
// it uses the browser's API only if it's already on the device. Undefined for an empty text
export async function suggestIssue(text: Pick<Issue, 'title' | 'description'>, signal?: AbortSignal): Promise<IssueSuggestion | undefined> {
	const rules = suggestByRules(`${text.title} ${text.description}`);
	if (!rules) {
		return undefined;
	}

	const device = await onDevice<Prompter, Omit<IssueSuggestion, 'source'>>('LanguageModel', ISSUE_PROMPT, async (session) => {
		const raw = await session.prompt(`Título: ${text.title}\nDescripción: ${text.description}`, {
			responseConstraint: ISSUE_SCHEMA,
			signal: AbortSignal.any([AbortSignal.timeout(PROMPT_TIMEOUT_MS), ...(signal ? [signal] : [])]),
		});
		const answer = JSON.parse(raw) as Record<string, unknown>;
		const reason = typeof answer.reason === 'string' ? answer.reason.trim() : '';
		const valid = DEFAULT_ISSUE_CATEGORIES.some(category => category.id === answer.category)
			&& typeof answer.provider === 'string' && answer.provider in providerCategories
			&& URGENCY_ORDER.includes(answer.urgency as Urgency)
			&& reason && reason.length <= 140;
		return valid ? { category: answer.category as DefaultIssueCategory, provider: answer.provider as ProviderCategory, urgency: answer.urgency as Urgency, reason } : undefined;
	});
	if (!device) {
		return { ...rules, source: 'basic' };
	}
	// What the rules find urgent stays at least as urgent, with its advice
	const floor = rank(rules.urgency) >= rank('high') && rank(rules.urgency) > rank(device.urgency);
	return { ...device, ...(floor && { urgency: rules.urgency, reason: rules.reason, hint: rules.hint }), source: 'device' };
}

// The admin's issue page: once per issue and text while the app is open, as the on-device run takes up to 10 s
const asked = new Map<string, Promise<IssueSuggestion | undefined>>();

export async function suggestIssueOnce(id: string, text: Pick<Issue, 'title' | 'description'>) {
	const key = `${id}\n${text.title}\n${text.description}`;
	if (!asked.has(key)) {
		asked.set(key, suggestIssue(text));
	}
	return asked.get(key);
}

/* 2. Thread summary */

export interface Summary {
	points: string[];
	source: WritingSource;
}

// What the Summarizer reads at most, the latest messages
const MAX_THREAD = 8000;
const dayFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const statusLabels = Object.fromEntries(issueStatus.map(({ value, label }) => [value, label]));
const QUESTION_REGEX = /¿?[^.!?¿¡]*\?/;

function authorOf(comment: IssueComment) {
	return comment.authorName || (comment.authorRole ? 'La administración' : 'Un vecino');
}

function dayOf(comment: IssueComment) {
	return comment.createdAt ? dayFormat.format(comment.createdAt.toDate()) : '';
}

// The report, how its status went, a question nobody has answered and the last messages
function summarizeByRules(issue: Pick<Issue, 'title' | 'description'>, comments: IssueComment[]) {
	const messages = comments.filter(comment => comment.type !== 'status');
	const changes = comments.filter(comment => comment.type === 'status' && comment.status);
	const lastAnswer = messages.findLastIndex(comment => comment.authorRole);
	const question = messages.slice(lastAnswer + 1).findLast(comment => !comment.authorRole && comment.message.includes('?'));

	const points = [`Aviso: ${clip([issue.title, issue.description].filter(Boolean).join('. '), 160)}`];
	if (changes.length) {
		points.push(`Estado: ${changes.map(change => `${statusLabels[change.status!]}${dayOf(change) && ` el ${dayOf(change)}`}`).join(', luego ')}.`);
	}
	if (question) {
		points.push(`Sin responder: ${authorOf(question)} pregunta «${clip(question.message.match(QUESTION_REGEX)?.[0].trim() ?? question.message, 160)}»`);
	}
	for (const message of messages.filter(message => message !== question).slice(-2)) {
		points.push(`${authorOf(message)}${dayOf(message) && ` (${dayOf(message)})`}: ${clip(message.message, 160)}`);
	}
	return points;
}

// The comments already loaded, without the hidden ones. From a click
export async function summarize(issue: Pick<Issue, 'title' | 'description'>, comments: IssueComment[], onProgress?: Progress): Promise<Summary> {
	const visible = comments.filter(comment => !comment.hiddenAt);
	const lines = visible.map(comment => `${dayOf(comment)} ${authorOf(comment)}: ${comment.type === 'status' ? `cambia el estado a ${statusLabels[comment.status!]}` : comment.message}`);
	while (lines.length > 1 && lines.join('\n').length > MAX_THREAD) {
		lines.shift();
	}

	const options = {
		...SPANISH,
		type: 'key-points',
		format: 'plain-text',
		// Three points, or five for longer threads
		length: visible.length > 6 ? 'medium' : 'short',
		sharedContext: 'Conversación entre los vecinos y la administración de una comunidad de propietarios sobre una incidencia.',
	};
	const device = await onDevice<Summarizer, string[]>('Summarizer', options, async summarizer => toLines(await summarizer.summarize(`Incidencia: ${issue.title}. ${issue.description}\n${lines.join('\n')}`)), onProgress);
	return device?.length
		? { points: device.slice(0, 5), source: 'device' }
		: { points: summarizeByRules(issue, visible), source: 'basic' };
}

/* 3. Notice drafts */

export type NoticeTone = 'info' | 'urgent' | 'reminder';

export interface Draft {
	title: string;
	body: string;
	source: WritingSource;
}

const NOTICE: Record<NoticeTone, { kind: string; title: string; intro: string; outro: string }> = {
	info: { kind: 'informativo', title: '', intro: 'Les informamos de lo siguiente:', outro: 'Para cualquier duda, pueden contactar con la administración.' },
	urgent: { kind: 'urgente', title: 'Urgente: ', intro: 'Les comunicamos con urgencia lo siguiente:', outro: 'Les rogamos que lo tengan en cuenta cuanto antes. Para cualquier duda, contacten con la administración.' },
	reminder: { kind: 'recordatorio', title: 'Recordatorio: ', intro: 'Les recordamos lo siguiente:', outro: 'Gracias por su colaboración.' },
};

const WRITER = {
	...SPANISH,
	tone: 'formal',
	format: 'plain-text',
	length: 'medium',
	sharedContext: 'Comunicados de la administración a los vecinos de una comunidad de propietarios en España, en español de España, corteses y claros.',
};
const WRITER_CONTEXT = 'Empieza con «Estimados vecinos:» y termina con «Un saludo, La administración». Usa solo los datos de los puntos, sin inventar ninguno.';

// One point per line, as typed: capitalised and ending in a full stop
function toPoints(text: string) {
	return toLines(text).map(point => `${point[0].toUpperCase()}${point.slice(1)}${END_REGEX.test(point) ? '' : '.'}`);
}

// From a click, with at least one point. The administrator reviews it before sending
export async function draftNotice(text: string, tone: NoticeTone, onProgress?: Progress): Promise<Draft> {
	const points = toPoints(text);
	const list = points.map(point => `- ${point}`).join('\n');
	const { kind, title, intro, outro } = NOTICE[tone];
	const basicTitle = `${title}${clip((points[0] ?? '').replace(FULL_STOP_REGEX, ''), 70)}`;

	const device = await onDevice<Writer, Omit<Draft, 'source'>>('Writer', WRITER, async (writer) => {
		const body = (await writer.write(`Comunicado ${kind} para los vecinos con estos puntos:\n${list}`, { context: WRITER_CONTEXT })).trim();
		// No figure added, changed or left out
		if (!body || figures(body).join() !== figures(list).join()) {
			return undefined;
		}
		const heading = toLines(await writer.write(`Título de menos de diez palabras, sin comillas, para este comunicado:\n${body}`))[0]?.replace(QUOTES_REGEX, '') ?? '';
		const fits = heading.length <= 90 && figures(heading).every(figure => figures(list).includes(figure));
		return { title: fits && heading ? heading : basicTitle, body };
	}, onProgress);

	return device
		? { ...device, source: 'device' }
		: {
				title: basicTitle,
				body: `Estimados vecinos:\n\n${intro}\n\n${points.length === 1 ? points[0] : list}\n\n${outro}\n\nUn saludo,\nLa administración`,
				source: 'basic',
			};
}

/* 4. Polishing the acta */

const REWRITER = {
	...SPANISH,
	tone: 'more-formal',
	format: 'plain-text',
	length: 'as-is',
	sharedContext: 'Acta de una junta de propietarios de una comunidad en España.',
};
const REWRITER_CONTEXT = 'Corrige y aclara la redacción con un registro formal. No cambies nombres, cifras, fechas, porcentajes ni resultados de votaciones, y no añadas nada.';
// Shorter lines are headings or data (Fecha, Lugar…), left as they are
const MIN_PROSE = 60;

// Whether the browser has the Rewriter, even if it has to download it first. Only then is "Mejorar redacción" offered
export async function canPolish() {
	try {
		const availability = await factory('Rewriter')?.availability(REWRITER);
		return !!availability && availability !== 'unavailable';
	} catch {
		return false;
	}
}

// Line by line, keeping each one as it was if its rewrite changes a figure or drops a name. From a click. Undefined
// when the Rewriter couldn't run; else the text, how many lines changed and how many were kept for that
export async function polish(text: string, onProgress: Progress) {
	const lines = text.split('\n');
	let changed = 0;
	let kept = 0;
	const done = await onDevice<Rewriter, true>('Rewriter', REWRITER, async (rewriter) => {
		const prose = [...lines.keys()].filter(index => lines[index].trim().length >= MIN_PROSE);
		for (const [count, index] of prose.entries()) {
			onProgress(`Mejorando… ${count + 1} de ${prose.length}`);
			const line = lines[index].trim();
			const result = (await rewriter.rewrite(line, { context: REWRITER_CONTEXT })).replace(SPACES_REGEX, ' ').trim();
			if (!result || result === line) {
				continue;
			}
			if (figures(result).join() === figures(line).join() && names(line).every(name => result.includes(name))) {
				lines[index] = result;
				changed++;
			} else {
				kept++;
			}
		}
		return true;
	}, onProgress);
	return done && { text: lines.join('\n'), changed, kept };
}
