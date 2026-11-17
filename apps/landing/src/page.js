// What the sections share: whether to keep still, and the floating «Pide una demo» on phones
export const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Phones: show the floating button once the hero is gone, and hide it again over the form and the footer
const sticky = document.getElementById('sticky');
const covering = new Map();
const coverObserver = new IntersectionObserver((entries) => {
	entries.forEach(entry => covering.set(entry.target, entry.isIntersecting));
	sticky.classList.toggle('shown', ![...covering.values()].some(Boolean));
});
['hero', 'demo', 'footer'].forEach(id => coverObserver.observe(document.getElementById(id)));

// Anything else the button would sit on top of
export const cover = element => coverObserver.observe(element);
