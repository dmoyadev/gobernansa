export interface User {
	email: string;
	role: 'admin' | 'manager' | 'user';
	communityId: string;
	name: string;
}
