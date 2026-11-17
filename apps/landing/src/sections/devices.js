import { calm, cover } from '../page.js';

// The neighbour's app on the phone, and the office's on a computer. Each flow is a list of classes a clock adds
// to the device; whatever carries that class in [data-tap] gets tapped by the finger (or the mouse) first,
// and the CSS does the rest
function playDevice(section, flows, pushes = []) {
	const phone = section.querySelector('.app-phone, .ad-desk');
	const device = phone.classList[0];
	const screen = phone.querySelector('.app-screen, .ad-screen');
	const hand = phone.querySelector('.app-hand');
	const touch = hand.querySelector('.app-touch');
	const rings = section.querySelectorAll('.app-ring');
	const choices = [...section.querySelectorAll('.app-flow')];
	const bars = choices.map(choice => choice.querySelector('.app-progress i'));
	const pause = section.querySelector('.app-pause');
	const caption = section.querySelector('.app-caption');
	const captionBar = caption.querySelector('.app-progress i');

	// Layout offsets, not the screen box: they ignore the slides and the phone's buzz
	const point = (target) => {
		let x = target.offsetWidth / 2;
		let y = target.offsetHeight / 2;
		for (let node = target; node && node !== phone; node = node.offsetParent) {
			x += node.offsetLeft;
			y += node.offsetTop;
		}
		if (!hand.classList.contains('app-shown')) {
			// It comes in from the bottom corner, not from wherever it last was
			hand.style.transition = 'none';
			hand.style.transform = `translate(${phone.offsetWidth * 0.85}px, ${phone.offsetHeight}px)`;
			void hand.offsetWidth;
			hand.style.transition = '';
			hand.classList.add('app-shown');
		}
		hand.style.transform = `translate(${x}px, ${y}px)`;
	};
	const lift = () => hand.classList.remove('app-shown');
	const press = () => {
		touch.animate([{ opacity: 0.9, transform: 'scale(0.2)' }, { opacity: 0, transform: 'scale(1)' }], { duration: 600, easing: 'ease-out' });
		hand.lastElementChild.animate([{ transform: 'none' }, { transform: 'scale(0.86)' }, { transform: 'none' }], { duration: 320, easing: 'ease-in-out' });
	};
	const set = (flag) => {
		phone.classList.add(flag);
		if (pushes.includes(flag)) {
			// The phone buzzes and the news ripples out of it
			phone.animate([{ transform: 'none' }, { transform: 'rotate(-2deg)' }, { transform: 'rotate(2deg)' }, { transform: 'rotate(-1deg)' }, { transform: 'none' }], { duration: 450, easing: 'ease-in-out' });
			rings.forEach((ring, index) => ring.animate([{ opacity: 0.9, transform: 'scale(0.4)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 1400, delay: index * 300, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' }));
		}
	};

	// Steps to timed events: the finger travels to what it taps, presses, and lifts if nothing else is coming soon
	const timelines = flows.map(({ steps }) => {
		const taps = steps.filter(([, flag]) => phone.querySelector(`[data-tap="${flag}"]`)).map(([at]) => at);
		return steps.flatMap(([at, flag]) => {
			const target = phone.querySelector(`[data-tap="${flag}"]`);
			if (!target) {
				return [[at, () => set(flag)]];
			}
			const events = [[at - 650, () => point(target)], [at, () => {
				press();
				set(flag);
			}]];
			const following = taps.find(next => next > at);
			if (!following || following - at > 1600) {
				events.push([at + 500, lift]);
			}
			return events;
		}).sort((a, b) => a[0] - b[0]);
	});

	let flow = 0;
	let time = 0;
	let next = 0;
	let last = 0;
	let frame = 0;
	let visible = false;
	let paused = false;

	const show = (index) => {
		flow = index;
		time = 0;
		next = 0;
		// Back to the home screen in one cut, nothing sliding backwards
		phone.className = `${device} app-cut`;
		lift();
		void phone.offsetWidth;
		phone.classList.remove('app-cut');
		choices.forEach((choice, position) => choice.setAttribute('aria-current', String(position === index)));
		caption.firstElementChild.textContent = index + 1;
		caption.children[1].innerHTML = choices[index].querySelector('.app-text').innerHTML;
		[...bars, captionBar].forEach(bar => (bar.style.transform = ''));
		if (calm) {
			// No motion: straight to how the flow ends
			flows[index].steps.forEach(([, flag]) => phone.classList.add(flag));
		} else {
			screen.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
		}
	};
	const tick = (now) => {
		// Clamped both ways: a frame stamped before run() started, or a long stall, never jumps the clock
		time += Math.min(Math.max(now - last, 0), 100);
		last = now;
		const events = timelines[flow];
		while (next < events.length && events[next][0] <= time) {
			events[next++][1]();
		}
		bars[flow].style.transform = captionBar.style.transform = `scaleX(${Math.min(time / flows[flow].length, 1)})`;
		if (time >= flows[flow].length) {
			show((flow + 1) % flows.length);
		}
		frame = requestAnimationFrame(tick);
	};
	// Only while it's on screen and nobody paused it
	const run = () => {
		cancelAnimationFrame(frame);
		const running = visible && !paused;
		section.classList.toggle('app-run', running);
		if (running) {
			last = performance.now();
			frame = requestAnimationFrame(tick);
		}
	};
	const setPaused = (value) => {
		paused = value;
		pause.classList.toggle('app-paused', paused);
		pause.lastElementChild.textContent = paused ? 'Seguir' : 'Pausar';
		run();
	};

	choices.forEach((choice, index) => choice.addEventListener('click', () => {
		show(index);
		// On phones the list sits under the phone, often with the phone scrolled away: bring it back to watch
		phone.scrollIntoView({ block: 'nearest' });
		if (!calm) {
			setPaused(false);
		}
	}));
	pause.addEventListener('click', () => setPaused(!paused));

	section.classList.add('app-live');
	show(0);
	if (!calm) {
		section.classList.add('app-anim');
		pause.hidden = false;
		// The ratio, not isIntersecting: that one is already true at the first visible pixel
		new IntersectionObserver((entries) => {
			visible = entries.at(-1).intersectionRatio >= 0.3;
			run();
		}, { threshold: 0.3 }).observe(phone);
	}

	// Phones: the floating «Pide una demo» would cover the bottom of the screen, where the taps land and the caption sits
	cover(phone.parentElement);
}

playDevice(document.querySelector('.app-section:not(.app-office)'), [
	{ length: 9800, steps: [[900, 'app-form'], [1350, 'app-typed'], [2900, 'app-photo'], [3500, 'app-hint'], [4500, 'app-cat'], [5600, 'app-sent'], [6500, 'app-plan'], [7600, 'app-fixed']] },
	{ length: 6800, steps: [[700, 'app-call'], [2000, 'app-meeting'], [3600, 'app-vote'], [3950, 'app-voted']] },
	{ length: 7400, steps: [[1000, 'app-book'], [2400, 'app-day'], [3600, 'app-slot'], [4800, 'app-booked']] },
], ['app-fixed', 'app-call']);

playDevice(document.querySelector('.app-office'), [
	{ length: 7800, steps: [[900, 'ad-bills'], [2300, 'ad-checked'], [3600, 'ad-remit'], [4300, 'ad-file']] },
	{ length: 9800, steps: [[900, 'ad-issues'], [2300, 'ad-open'], [3600, 'ad-pick'], [4800, 'ad-sent'], [6200, 'ad-planned'], [7600, 'ad-fixed']] },
	{ length: 8200, steps: [[900, 'ad-meeting'], [1300, 'ad-tally'], [4600, 'ad-close'], [5400, 'ad-minutes']] },
]);
