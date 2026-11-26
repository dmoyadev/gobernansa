// What to tell the user when Firestore or Storage says no, in Spanish and with what to do next, instead of the SDK's
// English. Sign-in has its own, authErrorMessage (useAuth.ts)
const SERVICE_PREFIX = /^(?:firestore|storage)\//;

export function errorMessage(error: unknown) {
	const code = (error as { code?: string } | undefined)?.code?.replace(SERVICE_PREFIX, '') ?? '';
	if (['unavailable', 'deadline-exceeded', 'retry-limit-exceeded'].includes(code) || !navigator.onLine) {
		return 'Sin conexión. Revísala y vuelve a probar.';
	}
	if (['permission-denied', 'unauthorized', 'unauthenticated'].includes(code)) {
		return 'No tienes permiso para esto. Si crees que deberías, vuelve a entrar o pregunta a la administración.';
	}
	if (code === 'not-found' || code === 'object-not-found') {
		return 'Ya no existe: puede que alguien lo haya borrado.';
	}
	if (code === 'already-exists') {
		return 'Ya existe.';
	}
	if (code === 'resource-exhausted' || code === 'quota-exceeded') {
		return 'Se ha llegado al límite de uso por hoy. Vuelve a probar más tarde.';
	}
	// A query without its index, mostly: the team has to deploy it
	if (code === 'failed-precondition') {
		return 'Falta un ajuste en el servidor. Avisa al equipo de gobernança.';
	}
	if (code === 'aborted' || code === 'cancelled' || code === 'canceled') {
		return 'Se ha interrumpido. Vuelve a probar.';
	}
	return 'Vuelve a probar en un momento.';
}

// What failed and why. Ours say why in Spanish ('está en una remesa, que lo cobra') and stay so; Firestore's and
// Storage's come in English, so they're told in Spanish with what to do next
export function failure(what: string, error: unknown) {
	return (error as Error | undefined)?.name === 'Error' ? `${what}: ${(error as Error).message}.` : `${what}. ${errorMessage(error)}`;
}
