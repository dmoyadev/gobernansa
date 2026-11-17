const BOT = 'NDIwMTI2ODcxfGVnYXNzZU1kbmVzL0lSaVdSVWI0ZWxSRE9KQm11bmpxX2lib0MwV2swZkJISEFBOjk4MjI1MTMxMDl0b2IvZ3JvLm1hcmdlbGV0LmlwYS8vOnNwdHRo';

const form = document.getElementById('lead');
const status = document.getElementById('status');
const button = form.querySelector('button');

form.addEventListener('submit', async (event) => {
	event.preventDefault();
	status.className = 'wide';
	if (!form.checkValidity()) {
		status.classList.add('error');
		status.textContent = 'Falta tu nombre o el email no parece válido.';
		form.querySelector(':invalid')?.focus();
		return;
	}

	const data = Object.fromEntries(new FormData(form));
	const value = key => data[key]?.trim();
	const text = [
		'Nueva solicitud de demo\n',
		value('name'),
		value('office'),
		value('email'),
		value('phone'),
		value('communities') && `${Math.round(Number(data.communities))} comunidades`,
		value('message') && `\n${value('message')}`,
	].filter(Boolean).join('\n');

	button.disabled = true;
	status.textContent = 'Enviando…';
	try {
		const [url, chat] = [...atob(BOT)].reverse().join('').split('|');
		const response = await fetch(url, { method: 'POST', body: new URLSearchParams({ chat_id: chat, text }) });
		if (!response.ok) {
			throw new Error(String(response.status));
		}
		form.reset();
		status.textContent = '¡Recibido! Te escribo en cuanto lo vea para cerrar el día y la hora.';
	} catch {
		status.classList.add('error');
		status.textContent = 'No se ha podido enviar. Vuelve a probar en un momento.';
	} finally {
		button.disabled = false;
	}
});
