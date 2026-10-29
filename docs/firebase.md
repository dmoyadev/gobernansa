# Firebase and Cloudinary setup

What the live project needs for every feature to work. Only the security rules are deployed by CI, the rest is set by hand.

## 1. Security rules

[`firestore.rules`](../firestore.rules) covers everything the app reads and writes. It was tested against the local emulator with every flow (as a neighbour and as a manager), and it blocks a neighbour from changing an issue's status, inflating votes, removing other people's issues, posting as someone else or as the administration, and reading other users' data.

Each push to `main` deploys it before the app, so change the rules here and not in the console: a console edit is overwritten by the next push. If a deploy breaks something, revert the commit, or roll back in **Firebase console → Firestore → Rules** (it keeps the history) and then fix the file. A file that doesn't compile fails the workflow and leaves both the live rules and the app as they were.

The local emulator enforces it too. Each rule that checks the user's community or role reads their profile once per request, which counts as one extra read.

## 2. Indexes

The first time each of these queries runs, Firestore logs an error in the browser console with a link that creates the index:

| Feature | Index |
| --- | --- |
| Votes left this month, on the home and issue pages | Composite on the `votes` **collection group**: `voterId` ascending, `votedAt` ascending (Firestore → Indexes → Composite, query scope "Collection group") |
| "Mis incidencias" filter in the issues list | Composite on `issues`: `createdBy` ascending, `createdAt` descending |

Comments are ordered by date only, so they need no index.

## 3. Cloudinary (issue photos and videos)

Cloud Storage needs the paid plan, so uploads go to Cloudinary, where the existing issue media already is.

1. **Cloudinary → Settings → Upload → Upload presets → Add upload preset**
   - Name: `gobernanca_issues` (what `.env.local` uses)
   - Signing mode: **Unsigned**
   - Restrict it, since anyone who knows its name can upload with it: allowed formats `jpg,png,webp,heic,mp4,mov,webm`, max file size 100 MB
2. Without the preset, the photo picker hides itself and issues are created without media.

## 4. GitHub secrets for the deploy

The workflows now pass these, add them in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `VITE_CLOUDINARY_CLOUD_NAME` | `dqd7np8vk` |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | `gobernanca_issues` |
| `VITE_FIREBASE_VAPID_KEY` | Firebase console → Project settings → Cloud Messaging → Web Push certificates |

The rules deploy uses the same service account as the hosting deploy (`FIREBASE_SERVICE_ACCOUNT_DMOYADEV_GOBERNANSA`). In **Google Cloud console → IAM**, give that account (`github-action-…@dmoyadev-gobernansa.iam.gserviceaccount.com`) the roles **Firebase Rules Admin** and **Service Usage Consumer**, or the rules step fails with a permission error.

## 5. Admin platform hosting

The admin (`apps/admin`) has its own Hosting site, `gobernansa-admin`, next to the webapp's default site `dmoyadev-gobernansa`. Both are deployed on each push to `main` (and to a preview channel on each PR), webapp first: until the admin site exists its step fails and the workflow shows red, but the webapp is already deployed. Extra sites and custom domains are part of the free plan.

1. Create the site, either in **Firebase console → Hosting → Add another site** with the id `gobernansa-admin`, or with:
   ```bash
   npx firebase hosting:sites:create gobernansa-admin --project dmoyadev-gobernansa
   ```
2. Check the webapp's site id with `npx firebase hosting:sites:list --project dmoyadev-gobernansa`. `.firebaserc` maps the `webapp` target to `dmoyadev-gobernansa`; if the default site has another id, change it there.
3. **Hosting → gobernansa-admin → Add custom domain**: `admin.gobernansa.dmoya.dev`, then add the DNS records the wizard shows at the DNS provider of `dmoya.dev`. The certificate can take a few hours.
4. **Authentication → Settings → Authorized domains → Add domain**: `admin.gobernansa.dmoya.dev` and `gobernansa-admin.web.app`. Without them the email sign-in links aren't sent from the admin. PR preview URLs aren't authorized (the list takes no wildcards), so signing in doesn't work there.

To deploy by hand: `npm run build && npx firebase deploy --only hosting:admin` (or `hosting:webapp`).

## Roles

Each profile in `users/{uid}` has a `role`. The rules enforce it, and `packages/shared/domain/user.ts` mirrors them so the apps only offer what's allowed:

| Role | Who | Communities | Can |
| --- | --- | --- | --- |
| `superadmin` | gobernança's team | All | Everything: create communities, invite administrators and assign them communities |
| `admin` | An administrator (administrador de fincas) | The ids in `communityIds` | Edit those communities, invite and remove their managers and neighbours |
| `manager` | Who runs the community, e.g. its president | Their `communityId` | Edit it and invite or remove its neighbours. In the webapp, change the status of issues and manage events |
| `user` | A neighbour | Their `communityId` | Use the webapp |

In the admin platform each one only opens what they manage: the team everything, administrators their communities and managers their own, while **Nueva comunidad** and **Administradores** are the team's. Neighbours get a screen with the managers and administrators of their community to ask for access, so the rules let them read those profiles (and only those). Nobody can change their own role: administrators give the manager and neighbour roles in their communities, and managers only the neighbour one in theirs. `communityId` is where someone lives (`''` for administrators who don't live in one); in the webapp, managing their own community also needs to live in it.

### Invitations

Accounts are added from the admin platform (a community's **Vecinos y gestores**, or **Administradores** for the team) by inviting an email, stored as `invitations/{email in lowercase}` with the name, role and community. No email is sent: the person signs in to the app with that email, and on their first sign-in their profile is created from the invitation, which is then removed. Only verified emails can take one, which sign-in links are; password accounts created in the console aren't.

An email that already has a profile doesn't take invitations: change its role from the list instead. Removing someone removes their profile, not their sign-in account, so a new invitation gives them access again.

### Moving to the four roles

Until now `admin` meant every community. After the push that deploys these rules, in **Firebase console → Firestore → users**:

1. Your profile (and anyone else's on gobernança's team): change `role` from `admin` to `superadmin`. Until then the admin platform shows no communities to it.
2. Any other `admin`: add `communityIds` (an array of strings) with the ids of the communities they manage. Leave their `communityId` if they live in one, or set it to `''`.
3. Managers and neighbours need nothing.

The new queries only use equality filters, which Firestore serves without composite indexes.

## Community data

Edited from the admin platform (`apps/admin`) by whoever manages each community (see [Roles](#roles)); only the team creates them. The webapp only reads it. Removing a community is still done from the console, along with its issues, users and properties. Stored on `communities/{communityId}`:

```text
cif, iban, bank
contacts[]     { type: admin | president | janitor | insurance | elevator | cleaning | gardening | other,
                 name, phone?, whatsapp?, email?,
                 schedule?: [{ days: [1..7], from: 'HH:MM', to: 'HH:MM' }] }
documents[]    { type: statutes | regulations | insurance | minutes, title, url, date }
monthlyVotes   votes each neighbour gets every month, 5 when missing
```

`schedule` works for any contact (e.g. the janitor's shifts): days are ISO weekdays (1 is Monday, 7 is Sunday) and times are 24 hour and zero padded. Add one entry per shift, e.g. `{ days: [1, 2, 3, 4, 5], from: '08:00', to: '15:00' }` and `{ days: [6], from: '09:00', to: '13:00' }`. The contact then shows its hours and whether it's available now.

### Monthly votes

Each neighbour gets `monthlyVotes` votes every month (5 by default) to spend on the issues that matter most to them. A vote uses one of the month it's cast in; taking it back that same month gives it back, and votes from past months stay on their issues without using this month's. Until the index above exists, the remaining votes can't be counted: they show as "—" and voting isn't limited.

The limit is checked by the app. Rules can't count documents, so someone calling the API directly could vote past it; enforcing it on the server would need a Cloud Function (paid plan).

## Data the app writes

```text
communities/{communityId}/issues/{issueId}
  votesScore, votesCount, commentsCount   counters, written along with each vote or comment
  votes/{issueId}_{uid}                   { voterId, score: 1 | -1, votedAt }
  comments/{commentId}                    { type: message | status, message, status?, authorId, authorName, authorRole? }
users/{uid}                               profile, created from their invitation on the first sign-in
invitations/{email}                       { email, name, role, communityId, communityIds?, invitedBy, invitedAt }
users/{uid}/documents/{id}                property documents (listing)
users/{uid}/documentFiles/{id}            their content, up to 1 MB each
users/{uid}/devices/{token}               devices with push notifications on
```
