import { calm } from '../page.js';

// The hero's building
const page = document.querySelector('.page');
const stage = document.querySelector('.stage');
const windows = [...stage.querySelectorAll('.building span:not(.door)')];
windows.forEach(window => window.style.setProperty('--d', `${(Math.random() * 0.7).toFixed(2)}s`));

// Its night grows from its sun as a circle over the whole hero. Each text changes colour as the edge passes it:
// the inverse of the circle's ease-out (a quadratic) says when the radius reaches it, growing or shrinking
const sky = document.querySelector('.hero-sky');
const sun = stage.querySelector('.sun');
const dusky = [...document.querySelectorAll('[data-dusk]')];
const SWEEP = 1.2; // the circle's transition, and the texts' below, in the CSS
const FADE = 0.4;
let settle;

function setNight(night) {
	const box = sky.getBoundingClientRect();
	const top = Math.max(box.top, page.getBoundingClientRect().top);
	const light = sun.getBoundingClientRect();
	const x = light.left + light.width / 2;
	const y = light.top + light.height / 2;
	const reach = Math.max(...[box.left, box.right].flatMap(cornerX => [top, box.bottom].map(cornerY => Math.hypot(cornerX - x, cornerY - y))));
	sky.style.setProperty('--sun', `${x - box.left}px ${y - box.top}px`);
	sky.style.setProperty('--reach', `${reach}px`);
	void getComputedStyle(sky).clipPath; // at rest it has no transition, so the circle jumps to where the sun is now
	dusky.forEach((element) => {
		const rect = element.getBoundingClientRect();
		const share = Math.min(1, Math.hypot(rect.left + rect.width / 2 - x, rect.top + rect.height / 2 - y) / reach);
		const time = night ? 1 - Math.sqrt(1 - share) : 1 - Math.sqrt(share);
		element.style.setProperty('--at', `${(time * SWEEP - FADE / 2).toFixed(2)}s`);
	});
	page.classList.add('dusking');
	clearTimeout(settle);
	settle = setTimeout(() => page.classList.remove('dusking'), (SWEEP + FADE) * 1000);
	page.classList.toggle('night', night);
	stage.setAttribute('aria-pressed', String(night));
}
stage.addEventListener('pointerenter', event => event.pointerType === 'mouse' && setNight(true));
stage.addEventListener('pointerleave', event => event.pointerType === 'mouse' && setNight(false));
stage.addEventListener('click', event => event.pointerType !== 'mouse' && setNight(!page.classList.contains('night')));
stage.addEventListener('keydown', (event) => {
	if (event.key === 'Enter' || event.key === ' ') {
		event.preventDefault();
		// Holding the key would flash the whole hero at the repeat rate
		if (!event.repeat) {
			setNight(!page.classList.contains('night'));
		}
	}
});
// A turned phone or a resized window moves the sun: night follows it, so no corner is left in daylight
new ResizeObserver(() => page.classList.contains('night') && setNight(true)).observe(sky);

if (!calm) {
	// Someone is always switching a light on or off
	setInterval(() => {
		const window = windows[Math.floor(Math.random() * windows.length)];
		if (!page.classList.contains('night') && !window.classList.contains('help')) {
			window.classList.toggle('on');
		}
	}, 1400);

	// Three small stories, each from its own window, told one bubble at a time
	const stories = [
		[8, [['3º A · Gotera en el baño', 'Con 2 fotos · ahora mismo'], ['Fontanero avisado', 'Por WhatsApp · va a las 17:00'], ['Gotera arreglada', 'El 3º A ya lo ve en su app']]],
		[13, [['Junta del jueves', 'Convocatoria en 24 móviles'], ['2º B delega su voto', 'En la presidenta, desde casa'], ['Acta firmada', 'Sellada y enviada a todos']]],
		[2, [['5º C · Recibo devuelto', 'Vuelve a pendiente solo'], ['Carta de aviso al 5º C', 'Con los intereses calculados'], ['5º C al día', 'Conciliado con el banco']]],
	];
	const bubbles = [...stage.querySelectorAll('.bubble')];
	let turn = 0;
	stage.classList.add('cycle');
	const play = () => {
		const [home, lines] = stories[turn++ % stories.length];
		windows.forEach(window => window.classList.remove('help'));
		windows[home].classList.add('help');
		bubbles.forEach((bubble, index) => {
			bubble.querySelector('strong').textContent = lines[index][0];
			bubble.querySelector('small').textContent = lines[index][1];
			setTimeout(() => bubble.classList.add('in'), 500 + index * 1300);
		});
		setTimeout(() => bubbles.forEach(bubble => bubble.classList.remove('in')), 8200);
		setTimeout(play, 9000);
	};
	play();
}
