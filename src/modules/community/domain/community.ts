import type { Datable } from '@/shared/domain/audit.ts';

export interface Community extends Datable {
	id: string;
	name: string;
	address: string;
	constructionYear: number;
}
