import useAuth from '@gobernansa/shared/application/useAuth.ts';
import { bookingTotal } from '@gobernansa/shared/domain/booking.ts';
import { isOverdue, outstanding } from '@gobernansa/shared/domain/finance.ts';
import { remote } from '@gobernansa/shared/infrastructure/remoteConfig.ts';
import { computed } from 'vue';
import { useOwedBookings } from '@/modules/bookings/application/useBookings.ts';
import { useUserCommunity } from '@/modules/community/application/useUserCommunity.ts';
import { useMyCharges } from '@/modules/finances/application/useMyCharges.ts';
import { useMeetings, useMyAttendance } from '@/modules/meetings/application/useMeetings.ts';

/**
 * What the user has to do: pay, answer the next junta and sign its acta. For Inicio and the + page
 */
export function usePending() {
	const { user } = useAuth();
	const { userCommunity } = useUserCommunity();
	const { meetings, nextMeeting } = useMeetings();
	const attendance = useMyAttendance(() => nextMeeting.value?.id);
	const { unpaid } = useMyCharges();
	const owedBookings = useOwedBookings();

	// Only what the user has to pay themselves, the domiciled ones are collected by the bank
	const charges = computed(() => unpaid.value.filter(charge => outstanding(charge) > 0 && !charge.remittanceId));
	const paymentsCount = computed(() => charges.value.length + owedBookings.value.length);
	const paymentsTotal = computed(() => charges.value.reduce((sum, charge) => sum + outstanding(charge), 0)
		+ owedBookings.value.reduce((sum, booking) => sum + bookingTotal(booking), 0));
	const paymentsLoading = computed(() => (unpaid.pending.value || owedBookings.pending.value) && !paymentsCount.value);
	// Not knowing isn't "todo al día", so it leads to the receipts instead
	const paymentsError = computed(() => unpaid.error.value || owedBookings.error.value);
	const overdue = computed(() => charges.value.some(charge => isOverdue(charge)));

	// The same checks as the Pagar buttons of the lists
	const canPayOnline = computed(() => userCommunity.value?.onlinePayments === 'test' && !user.value?.blocked && remote.payments);

	// Straight to paying it when there's only one, otherwise to the list it's in, which also says how to pay by transfer
	const payLink = computed(() => {
		const [charge] = charges.value;
		const [booking] = owedBookings.value;
		if (canPayOnline.value && paymentsCount.value === 1) {
			return charge ? `/neighborhood/charges/${charge.id}/pay` : `/neighborhood/bookings/${booking.id}/pay`;
		}
		return booking && !charge ? '/neighborhood/bookings' : '/neighborhood/charges';
	});

	// Only once it's known there's no answer, so it doesn't flash while loading
	const toAnswer = computed(() => nextMeeting.value && !attendance.pending.value && !attendance.error.value && !attendance.value ? nextMeeting.value : undefined);
	// Actas waiting for the user's signature, until they're sent
	const toSign = computed(() => {
		const uid = user.value?.id;
		return uid ? meetings.value.filter(meeting => !meeting.notifiedAt?.minutes && meeting.minutesSigners?.includes(uid) && !meeting.minutesSigned?.includes(uid)) : [];
	});

	return { nextMeeting, attendance, toAnswer, toSign, paymentsCount, paymentsTotal, paymentsLoading, paymentsError, overdue, payLink };
}
