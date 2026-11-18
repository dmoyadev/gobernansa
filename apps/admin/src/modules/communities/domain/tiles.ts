/*
 * The tiles of a community's page: what each opens and the sizes it takes, in the order and size they come by default.
 * The admin rearranges them, and the page keeps that layout in the browser
 */

// 1 is one cell of the bento, 2 two side by side and 4 a square of two by two. Bigger tiles show more
export type TileSize = 1 | 2 | 4;

export interface Tile {
	// The page it opens, /communities/:id/<key>: a page of its own or the first of a workspace
	key: string;
	title: string;
	icon: string;
	description: string;
	// What can be done there, for the pages shown at size 2
	details?: string;
	sizes: TileSize[];
	size: TileSize;
}

// In their default order and size, the community's data first and big, then its workspaces and the pages filling the rows
export const allTiles: Tile[] = [
	{ key: 'info', title: 'Comunidad', icon: 'lucide:building-2', description: 'Datos generales, contactos, documentación y configuración', sizes: [1, 2, 4], size: 4 },
	{ key: 'people', title: 'Vecinos', icon: 'lucide:users', description: 'Propiedades, cuentas e invitaciones', sizes: [1, 2], size: 2 },
	{ key: 'finances', title: 'Finanzas', icon: 'lucide:wallet', description: 'Pendiente de cobro, facturas vencidas y banco', sizes: [1, 2], size: 2 },
	{ key: 'issues', title: 'Incidencias', icon: 'lucide:message-square-warning', description: 'Estado y respuestas a los vecinos', details: 'Revisa lo que avisan los vecinos, cambia su estado y respóndeles.', sizes: [1, 2], size: 2 },
	{ key: 'meetings', title: 'Juntas', icon: 'lucide:gavel', description: 'Convocatorias, asistencia y votaciones', details: 'Convoca juntas, lleva la asistencia, recoge las votaciones y redacta el acta.', sizes: [1, 2], size: 2 },
	{ key: 'locations', title: 'Zonas comunes y reservas', icon: 'lucide:map-pin', description: 'Lugares de los avisos y zonas que se reservan', sizes: [1, 2, 4], size: 2 },
	{ key: 'notifications', title: 'Avisos', icon: 'lucide:bell', description: 'Avisos y eventos de la comunidad', details: 'Publica avisos y eventos que llegan a todos los vecinos de la comunidad.', sizes: [1, 2], size: 1 },
	{ key: 'obligations', title: 'Obligaciones', icon: 'lucide:calendar-check', description: 'IEE, ascensor, extintores, seguro…', details: 'Vencimientos de inspecciones, revisiones y seguros, con su proveedor y aviso previo.', sizes: [1, 2], size: 1 },
];
export const tilesByKey = new Map(allTiles.map(tile => [tile.key, tile]));
export const sizeLabels: Record<TileSize, string> = { 1: 'pequeña', 2: 'ancha', 4: 'grande' };

export interface LayoutItem { key: string; size: TileSize }

export const defaultLayout = allTiles.map(({ key, size }) => ({ key, size }));

// A saved layout made valid: unknown tiles and sizes are dropped and new tiles are added at the end
export function toLayout(saved: unknown): LayoutItem[] {
	const items = (Array.isArray(saved) ? saved as LayoutItem[] : [])
		.filter((item, index, all) => tilesByKey.get(item?.key)?.sizes.includes(item.size) && all.findIndex(other => other.key === item.key) === index);
	// Copies, resizing a tile mustn't change the defaults it's reset to
	return structuredClone([...items, ...defaultLayout.filter(item => !items.some(({ key }) => key === item.key))]);
}

export function nextSize(tile: Tile) {
	return tile.sizes[(tile.sizes.indexOf(tile.size) + 1) % tile.sizes.length];
}
