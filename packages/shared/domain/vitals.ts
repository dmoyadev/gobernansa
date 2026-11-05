/*
 * Rendimiento real (MON-6, docs/fiabilidad.md): vitals/{app}_{day} counts, per screen, the sampled sessions in each band
 * of the load (LCP), the layout shifts (CLS) and the slowest interaction (a rough INP). The good bands are Google's
 */
export const vitalMetrics = {
	lcp: { label: 'Carga (LCP)', bands: ['lcp1', 'lcp25', 'lcp4', 'lcpMore'], good: ['lcp1', 'lcp25'] },
	cls: { label: 'Saltos (CLS)', bands: ['clsGood', 'clsMid', 'clsPoor'], good: ['clsGood'] },
	inp: { label: 'Respuesta (INP)', bands: ['inpGood', 'inpMid', 'inpPoor'], good: ['inpGood'] },
} as const;

export type VitalMetric = keyof typeof vitalMetrics;

export type VitalBand = (typeof vitalMetrics)[VitalMetric]['bands'][number];

export interface VitalsDay {
	screens: Record<string, Partial<Record<VitalBand, number>>>;
	// The screens the last write added to, for the rules
	touched: string[];
}
