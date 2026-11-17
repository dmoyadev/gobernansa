// Night falls on the footer each time it comes into view
const revealObserver = new IntersectionObserver((entries) => {
	entries.forEach(entry => entry.target.classList.toggle('on', entry.isIntersecting));
}, { rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('[data-reveal]').forEach(element => revealObserver.observe(element));

// The footer's skyline, the same every time (a tiny seeded random), with its windows lighting up one by one
let seed = 11;
const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
let shapes = '';
for (let x = -12; x < 1212;) {
	const width = 70 + random() * 90;
	const height = 60 + random() * 110;
	const top = 240 - height;
	shapes += `<rect class="bld" x="${x}" y="${top}" width="${width}" height="${height + 2}" rx="3"/>`;
	if (random() < 0.4) {
		shapes += `<rect class="tank" x="${x + width * 0.6}" y="${top - 12}" width="${width * 0.2}" height="12" rx="2"/>`;
	}
	for (let y = top + 16; y < 228; y += 24) {
		for (let column = x + 12; column < x + width - 18; column += 20) {
			if (random() < 0.62) {
				shapes += `<rect class="win" x="${column}" y="${y}" width="9" height="12" rx="1.5" style="transition-delay:${(0.6 + random() * 2.6).toFixed(2)}s"/>`;
			}
		}
	}
	x += width + 4 + random() * 10;
}
document.querySelector('.skyline').innerHTML = shapes;
