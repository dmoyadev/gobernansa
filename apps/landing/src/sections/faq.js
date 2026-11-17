import { cover } from '../page.js';

// The neighbour's email to their office, already written and carrying this page's address wherever it's published.
// Phones: the floating «Pide una demo» is for offices, so it gives way to the neighbour's column and its button
const proposal = document.querySelector('.faq-mail');
cover(proposal.parentElement);
proposal.href += `&body=${encodeURIComponent(`Hola:

He visto gobernança, un programa para despachos que trae una app para los vecinos: avisaríamos de las averías con fotos, votaríamos en las juntas y veríamos nuestros recibos desde el móvil. A vosotros os ahorraría llamadas, y lleva también los recibos, la contabilidad y las juntas.

Se puede probar tres meses sin pagar con unas pocas comunidades. ¿Le echáis un vistazo?

${location.origin}${location.pathname}

Un saludo`)}`;

// Phones: the office's questions and the neighbour's as two pages of a strip, with tabs to jump between them.
// Nothing is hidden: the other page is a swipe away and find in page still reaches it
const faq = document.querySelector('.faq');
const columns = faq.querySelector('.faq-columns');
const tabs = [...faq.querySelectorAll('.faq-tabs button')];
const step = () => columns.children[1].offsetLeft - columns.children[0].offsetLeft;
// A tab switches at once, like any tab; the slide is for the finger
tabs.forEach((tab, index) => tab.addEventListener('click', () => (columns.scrollLeft = index * step())));
// Swiping, or tabbing into the other page, moves the tabs too
columns.addEventListener('scroll', () => {
	const shown = Math.round(columns.scrollLeft / step());
	tabs.forEach((tab, index) => tab.setAttribute('aria-pressed', String(index === shown)));
}, { passive: true });
faq.classList.add('faq-live');
