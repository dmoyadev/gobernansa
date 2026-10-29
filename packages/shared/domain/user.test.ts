// The package is typed for the browser, its tests run on Node
/// <reference types="node" />
import type { User } from './user.ts';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { assignableRoles, managesCommunity } from './user.ts';

const superadmin = { role: 'superadmin', communityId: '' } as User;
const admin = { role: 'admin', communityId: '', communityIds: ['c1'] } as User;
const manager = { role: 'manager', communityId: 'c1' } as User;
const neighbour = { role: 'user', communityId: 'c1' } as User;

it('each role manages its own communities, as the rules do', () => {
	assert.ok(managesCommunity(superadmin, 'c2'));
	assert.ok(managesCommunity(admin, 'c1'));
	assert.ok(!managesCommunity(admin, 'c2'));
	assert.ok(managesCommunity(manager, 'c1'));
	assert.ok(!managesCommunity(manager, 'c2'));
	assert.ok(!managesCommunity(neighbour, 'c1'));
	assert.ok(!managesCommunity(admin, ''));
});

it('administrators give manager and neighbour roles in theirs, and managers only neighbour in their own', () => {
	assert.deepEqual(assignableRoles(superadmin, ''), ['user', 'manager', 'admin', 'superadmin']);
	assert.deepEqual(assignableRoles(admin, 'c1'), ['user', 'manager']);
	assert.deepEqual(assignableRoles(admin, 'c2'), []);
	assert.deepEqual(assignableRoles(manager, 'c1'), ['user']);
	assert.deepEqual(assignableRoles(manager, 'c2'), []);
	assert.deepEqual(assignableRoles(neighbour, 'c1'), []);
});
