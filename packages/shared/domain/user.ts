export interface User {
	email: string;
	// 'admin' also gives access to the admin platform, to manage every community
	role: 'admin' | 'manager' | 'user';
	communityId: string;
	name: string;
}
