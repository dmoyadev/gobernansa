import { calm } from '../page.js';

// The day, told as you scroll: the thread walks down with you and each moment shows up when it reaches its dot
const day = document.querySelector('.tl');
if (!calm) {
	day.classList.add('tl-play');
	const list = day.querySelector('.tl-list');
	const items = [...list.querySelectorAll('.tl-item')];
	let queued = false;
	const paint = () => {
		queued = false;
		// How far down the list the reader has got: a fifth of the screen above its bottom edge
		const reach = innerHeight * 0.8 - list.getBoundingClientRect().top;
		// offsetTop leaves out the lift of a moment still to come, so showing one never pushes it back out
		const dots = items.map(item => item.offsetTop + item.querySelector('.tl-face').offsetHeight / 2);
		items.forEach((item, i) => {
			item.classList.toggle('tl-in', reach >= dots[i]);
			const walked = i + 1 < dots.length ? (reach - dots[i]) / (dots[i + 1] - dots[i]) : 0;
			item.style.setProperty('--tl-draw', Math.min(1, Math.max(0, walked)));
		});
	};
	const queue = () => {
		if (!queued) {
			queued = true;
			requestAnimationFrame(paint);
		}
	};
	addEventListener('scroll', queue, { passive: true });
	addEventListener('resize', queue);
	paint();
}
