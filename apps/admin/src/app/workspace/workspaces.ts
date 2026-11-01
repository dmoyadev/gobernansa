import type { RouteLocationNormalized } from 'vue-router';
import { financeGroups } from '@/modules/finances/sections.ts';

export interface WorkspacePage {
	// Its route, /communities/:id/<key>
	key: string;
	title: string;
	description: string;
	// Its own in search, when not its section's
	icon?: string;
}

export interface WorkspaceSection {
	title: string;
	icon: string;
	// It opens on the first one. With more than one, each is a tab of the section
	pages: WorkspacePage[];
}

export interface WorkspaceGroup {
	// Only when the workspace has more than one, its heading
	title?: string;
	sections: WorkspaceSection[];
}

export interface Workspace {
	title: string;
	groups: WorkspaceGroup[];
	// A page of its own above the sections, "Resumen" in the nav
	summary?: Omit<WorkspacePage, 'title'> & { icon: string };
	// The route param that names the page, for routes that are several pages of it. Otherwise it's their meta.page
	param?: string;
	// The sections as the nav lists them, and each page's section by its key
	sections: WorkspaceSection[];
	sectionOf: Map<string, WorkspaceSection>;
}

function workspace(definition: Omit<Workspace, 'sections' | 'sectionOf'>): Workspace {
	const sections = definition.groups.flatMap(group => group.sections);
	return { ...definition, sections, sectionOf: new Map(sections.flatMap(section => section.pages.map(page => [page.key, section]))) };
}

// The community's pages that go together, with a nav beside them (AdminLayout). A route joins one with meta.workspace
export const workspaces: Record<string, Workspace> = {
	community: workspace({
		title: 'Comunidad',
		param: 'section',
		groups: [{
			sections: [
				{ title: 'Datos generales', icon: 'lucide:building-2', pages: [{ key: 'info', title: 'Datos generales', description: 'Nombre, dirección, CIF, banco e IBAN' }] },
				{ title: 'Contactos', icon: 'lucide:phone', pages: [{ key: 'contacts', title: 'Contactos', description: 'Teléfonos, correos y horarios' }] },
				{ title: 'Documentación oficial', icon: 'lucide:file-text', pages: [{ key: 'documents', title: 'Documentación oficial', description: 'Estatutos, normas, seguro y actas' }] },
				{ title: 'Configuración', icon: 'lucide:settings-2', pages: [{ key: 'settings', title: 'Configuración de la comunidad', description: 'Votos por vecino y otros ajustes' }] },
			],
		}],
	}),
	neighbours: workspace({
		title: 'Vecinos',
		groups: [{
			sections: [
				{ title: 'Vecinos y gestores', icon: 'lucide:users', pages: [{ key: 'people', title: 'Vecinos y gestores', description: 'Cuentas, roles e invitaciones' }] },
				{ title: 'Propiedades', icon: 'lucide:house', pages: [{ key: 'properties', title: 'Propiedades', description: 'Censo con coeficientes, propietarios e inquilinos' }] },
			],
		}],
	}),
	finances: workspace({
		title: 'Finanzas',
		summary: { key: 'finances', icon: 'lucide:wallet', description: 'Pendiente de cobro, facturas vencidas, banco, fondo de reserva y plazos' },
		groups: financeGroups,
	}),
};

// The workspace of a route and which of its pages it is: its own key, or its parent's on a detail page
export function workspacePage(route: RouteLocationNormalized) {
	const workspace = workspaces[route.meta.workspace as string] as Workspace | undefined;
	return workspace && { workspace, page: (route.meta.page ?? (workspace.param && route.params[workspace.param])) as string };
}

// How the page moves from one page of a workspace to another: sideways within a section's tabs (back when to an earlier one),
// otherwise down or up as their sections are in the nav, the summary first
export function workspaceMove({ sections, sectionOf }: Workspace, from: string, to: string) {
	const [previous, next] = [sectionOf.get(from), sectionOf.get(to)];
	if (previous && previous === next) {
		const index = (key: string) => next.pages.findIndex(page => page.key === key);
		return index(to) < index(from) ? 'back' : 'forward';
	}
	const position = (section?: WorkspaceSection) => section ? sections.indexOf(section) : -1;
	return position(next) < position(previous) ? 'up' : 'down';
}
