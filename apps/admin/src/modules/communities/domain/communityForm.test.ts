import type { Community } from '@gobernansa/shared/domain/community.ts';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { deleteField, Timestamp } from 'firebase/firestore';
import { findFormError, fromCommunityForm, toCommunityForm } from './communityForm.ts';

const community = {
	name: 'Residencial Los Olivos',
	address: 'Calle Falsa 123, Jaén',
	constructionYear: 1990,
	commonAreas: ['Portal', 'Garaje'],
	iban: 'ES9121000418450200051332',
	contacts: [{ type: 'janitor', name: 'Antonio', phone: '600 000 103', schedule: [{ days: [1, 2], from: '08:00', to: '15:00' }] }],
	documents: [{ type: 'minutes', title: 'Junta', url: 'https://example.com/acta.pdf', date: Timestamp.fromDate(new Date(2026, 2, 14)) }],
} as Community;

it('a saved community comes back the same after going through the form', () => {
	const form = toCommunityForm(community);
	assert.equal(form.iban, 'ES91 2100 0418 4502 0005 1332');
	assert.equal(form.documents[0].date, '2026-03-14');

	const saved = fromCommunityForm(form);
	assert.equal(saved.iban, community.iban);
	assert.equal(saved.constructionYear, 1990);
	assert.deepEqual(saved.commonAreas, ['Portal', 'Garaje']);
	assert.deepEqual(saved.contacts, community.contacts);
	assert.ok(saved.documents[0].date.isEqual(community.documents![0].date));
});

it('emptied fields are removed, also inside contacts', () => {
	const form = toCommunityForm(community);
	form.iban = ' ';
	form.commonAreas = ' , ';
	form.contacts[0].phone = '';
	form.contacts[0].schedule = [];

	const saved = fromCommunityForm(form);
	assert.ok((saved.iban as ReturnType<typeof deleteField>).isEqual(deleteField()));
	assert.ok((saved.commonAreas as ReturnType<typeof deleteField>).isEqual(deleteField()));
	assert.deepEqual(saved.contacts, [{ type: 'janitor', name: 'Antonio' }]);
});

it('schedules need a day and to start before they end', () => {
	const form = toCommunityForm(community);
	assert.equal(findFormError(form), undefined);

	form.contacts[0].schedule![0].to = '08:00';
	assert.match(findFormError(form)!, /anterior/);

	form.contacts[0].schedule![0].days = [];
	assert.match(findFormError(form)!, /día/);
});
