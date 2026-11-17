import { calm } from '../page.js';

// The pilot's stamp slams onto the ticket the first time it comes into view
const ticket = document.querySelector('.pl-ticket');
if (!calm) {
	ticket.classList.add('pl-armed');
	new IntersectionObserver((entries, observer) => {
		if (entries.some(entry => entry.isIntersecting)) {
			ticket.classList.add('pl-stamped');
			observer.disconnect();
		}
	}, { rootMargin: '0px 0px -25% 0px' }).observe(ticket.querySelector('.pl-stamp'));
}
