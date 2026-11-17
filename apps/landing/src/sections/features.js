// Features: each area becomes a real button that opens its detail in the sheet (without the script they stay <details>)
const sheet = document.querySelector('.fx-sheet');
const icon = sheet.querySelector('.fx-icon');
const title = sheet.querySelector('#fx-title');
const hook = sheet.querySelector('.fx-sheet-hook');
const body = sheet.querySelector('.fx-sheet-body');
const note = document.querySelector('.fx-note');
let opener = null;
let pressedOutside = false;

document.querySelectorAll('.fx-grid details').forEach((area) => {
	const list = area.querySelector('.fx-list');
	const tile = document.createElement('button');
	tile.type = 'button';
	tile.className = 'fx-tile fx-face';
	tile.setAttribute('aria-haspopup', 'dialog');
	tile.append(...area.querySelector('summary').childNodes);
	area.replaceWith(tile);

	tile.addEventListener('click', () => {
		opener = tile;
		sheet.className = `fx-sheet ${tile.parentElement.className}`;
		icon.replaceChildren(tile.querySelector('svg').cloneNode(true));
		title.textContent = tile.querySelector('.fx-name').textContent;
		hook.textContent = tile.querySelector('.fx-hook').textContent;
		// The legend only travels with the areas that have something «Al contratar»
		note.hidden = !list.querySelector('.fx-soon');
		body.replaceChildren(list, note);
		sheet.showModal();
	});
});
body.append(note);

sheet.querySelector('.fx-close').addEventListener('click', () => sheet.close());
// Only a press that starts and ends on the backdrop closes it, so selecting text inside never does
sheet.addEventListener('pointerdown', event => (pressedOutside = event.target === sheet));
sheet.addEventListener('click', event => pressedOutside && event.target === sheet && sheet.close());
// Safari doesn't focus a clicked button, so focus doesn't always come back on its own
sheet.addEventListener('close', () => opener?.focus());
