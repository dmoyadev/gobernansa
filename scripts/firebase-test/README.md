# Firebase Firestore Seed Script

Loads a complete demo of gobernança: three communities, their census and people, and data for every screen of both apps.

## 🔑 Configuration

Only needed for the live project, the emulators don't use it:

1. Go to Firebase Console
2. Project Settings → Service Accounts
3. Generate private key
4. Save as `serviceAccountKey.local.json`

## ▶️ Usage

```bash
npm run seed-firebase
```

It asks, step by step:

1. **Where**: the local emulators (start them first with `npm run start:firebase:emulators`) or the live project, which has to be confirmed by typing its id. `npm run seed-firebase:emulators` skips this question.
2. **What to do**: leave the whole demo as new (empties every demo collection and loads everything) or choose.
3. **What to delete**, by group, with how many documents each has now, and **how**: exactly the documents the seed makes (what was created by hand stays, even under them), or the whole collections (also what was created by hand, and other groups' documents in them, which it offers to load again).
4. **What to load**, by group, adding the groups the chosen ones need when they aren't there, and **how**: overwriting the demo documents or creating only the missing ones.
5. **Auth** (emulator only): recreate the demo accounts, so each one signs in with a magic link.

Before touching anything it shows a summary, with the quota it spends on the live project, and asks to go on.

### Groups

Each one is a file in `data/`, and `data/cast.js` holds the people, communities, census and providers they share:

| Group | Loads |
| --- | --- |
| `core` | Communities, properties, users, invitations, personal documents and the activity log |
| `maintenance` | Issues with comments, votes and internal notes, providers and ratings, work orders, obligations |
| `meetings` | Meetings with attendance, votes, minutes and notices, announcements and the mail outbox |
| `charges` | Budgets, fees and charges, online payments, debt claims and SEPA remittances |
| `accounting` | Supplier invoices, payment orders, bank movements, journal entries and the closed year |
| `bookings` | Bookings of the common areas |
| `billing` | The office's fee invoices and its Verifactu registry |
| `errors` | The apps' errors for the team's Errores page |

Dates are relative to the day it runs, so the demo always has upcoming meetings, recent issues and overdue charges.

### Without questions

Any flag skips them, e.g. in a script:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/firebase-test/seed.js --reset --only=core,meetings
```

- `--only=<groups>` loads only those groups (all by default)
- `--reset` empties their collections first
- `--yes` loads everything without other flags
- Without `FIRESTORE_EMULATOR_HOST` it writes to the live project, and then it needs `--project=<project id>` to confirm it

## ⚠️ Limitations

- On the live project every count, delete and write counts against the free plan's daily quota (20,000 writes and deletes, 50,000 reads). The whole demo is a small part of it, but don't run it several times a day.
- The live project's Auth accounts are never touched: the demo users with a real account keep their uids, the others only exist in the emulator.
- The fees start 220 days before the day it runs, so the debts keep their ages. Seeded between January and early August, that falls in the previous year, and the fiscal pages (fees, closed year, taxes) mix it with the calendar year.
- No data validation beyond the paths: it may insert inconsistent data if a group contains errors.
