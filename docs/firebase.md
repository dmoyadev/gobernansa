# Firebase setup

What the live project needs for every feature to work. Only Firestore's security rules are deployed by CI; the rest (Storage's rules, the indexes, the functions) is set or deployed by hand.

## 1. Security rules

[`firestore.rules`](../firebase/firestore.rules) covers everything the app reads and writes. It was tested against the local emulator with every flow (as a neighbour and as a manager), and it blocks a neighbour from changing an issue's status, inflating votes, removing other people's issues, posting as someone else or as the administration, and reading other users' data.

Each push to `main` deploys it before the app, so change the rules here and not in the console: a console edit is overwritten by the next push. If a deploy breaks something, revert the commit, or roll back in **Firebase console → Firestore → Rules** (it keeps the history) and then fix the file. A file that doesn't compile fails the workflow and leaves both the live rules and the app as they were.

The local emulator enforces it too. Each rule that checks the user's community or role reads their profile once per request, which counts as one extra read.

**Money can't be written twice** ([ROB-6](fiabilidad.md#rob-6) in [fiabilidad.md](fiabilidad.md)). The rules turn down what a double click, a second tab or a batch sent again after losing the connection would duplicate, with no extra reads and also when an offline write reaches the server later:
- a charge, expense, bank movement, property or community written again over one already there (its `createdAt` changes): a run of fees, a derrama, a recibo de intereses, a statement or a census imported twice;
- a charge's `remittanceId`, `bankMovementId` or an invoice's `paymentOrderId` changed for another one: a charge goes in one remittance at a time and only while unpaid, and a charge or invoice is reconciled with one bank movement only while unpaid (and a charge only if it isn't in a remittance); an invoice moves to another payment order only once the first was executed and the transfer came back unpaid;
- a bank movement reconciled or set aside twice: it only goes from pending to done and back;
- a remittance or payment order deleted once sent or executed, or collected or executed again on another day;
- a year closed again over its closing.

When one is turned down, the action shows an error and nothing of its batch is written. What needs to know the state on the server first (marking a charge or invoice paid by hand, returns, recibos de intereses, closing the year) goes in a transaction, so it needs a connection.

**Photos are links too.** An issue's `assets` must be up to 6 download URLs of files in its reporter's own Storage folder (`issues/{communityId}/{authorKey}/`); until now any text went in, `javascript:` links included, which the admin and the provider's page show as links. A provider's photos must be up to 10 download URLs of files under their own work order (`workOrders/{token}/`). Both take the URL absolute (`https://firebasestorage.googleapis.com/v0/b/…`) or, with the emulators, relative (`/v0/b/…`), see section 3.

**Historial** (section 10). `audit` is read only by the superadmin and nobody writes it from the apps: the functions do. `actions` is created by whoever is signed in, with their own uid and email, the server's time, only its known fields, each with a size cap, and any type but `restore`, which only the restore function writes; read only by the superadmin, never changed or removed.

**Storage** has its own rules, [`storage.rules`](../firebase/storage.rules), which only let files be created, never changed, removed or listed from the apps. Everyone else opens a file through its download URL, whose token skips the rules.
- **An issue's photos and videos**: in the folder of the reporter's secret key, only by that key's owner while they're a neighbour of that community and not blocked (as Firestore's `issues` create rule). Images up to 20 MB (jpeg, png, webp, gif, heic, heif, avif) and videos up to 100 MB (mp4, mov, webm).
- **A provider's photos**: images only, up to 20 MB, while their work order exists, isn't revoked and is sent, accepted or scheduled. The token is their only credential, as in Firestore.
- **Reads**: the rules read Firestore, which counts: two documents for each issue upload (the key and the profile) and one for a work order's, plus one more when the app then asks for the file's download URL.

CI doesn't deploy `storage.rules`: after each change, `npx firebase deploy --only storage --project dmoyadev-gobernansa` (section 3). A neighbour's photo upload has been tried in the local demo (section 12); a provider's photos and the cases the rules must refuse (another's key, another community, a blocked neighbour, another type, too big, a revoked or finished order) are still to be tried in the emulator.

## 2. Indexes

The first time each of these queries runs, Firestore logs an error in the browser console with a link that creates the index:

| Feature | Index |
| --- | --- |
| Votes left this month, on the home and issue pages | Composite on the `votes` **collection group**: `voterId` ascending, `votedAt` ascending (Firestore → Indexes → Composite, query scope "Collection group") |
| "Mis incidencias" filter in the issues list | Composite on `issues`: `authorKey` ascending, `createdAt` descending (the old one on `createdBy` can go) |

Comments are ordered by date only, so they need no index.

| Admin feature | Index |
| --- | --- |
| Liquidación anual of a closed year, the charges due in it and paid after | Composite on `charges`: `paidAt` ascending, `dueDate` ascending |

The admin's **Errores** page (only the team) orders the errors by when they were last seen, and each filter needs its own index. Firestore merges them when several filters are on:

| Feature | Index |
| --- | --- |
| Errores, by status (the page opens on the pending ones) | Composite on `errors`: `status` ascending, `lastSeen` descending |
| Errores, by app | Composite on `errors`: `app` ascending, `lastSeen` descending |
| Errores, by type | Composite on `errors`: `code` ascending, `lastSeen` descending |
| Errores, new in a release | Composite on `errors`: `firstRelease` ascending, `lastSeen` descending |
| Errores, the urgent ones first | Served by the status and type indexes; if Firestore asks for its own, composite on `errors`: `status` ascending, `code` ascending, `lastSeen` descending |
| Errores, the header's count of urgent and come-back ones ([MON-9](fiabilidad.md#mon-9)) | None: a count with equality filters only (`status` with `code`, or `status` with `seenSinceResolved`), served by the single-field indexes |
| Errores → Limpiar caducadas | Single field on the `samples` **collection group**: `expiresAt` ascending (Firestore → Indexes → Single field → Add exemption, collection ID `samples`, scope "Collection group") |
| Errores, the last backup ([ROB-2](fiabilidad.md#rob-2)) | None: one document, `ops/backup` |
| Errores → Rendimiento ([MON-6](fiabilidad.md#mon-6)) | None: the days' documents by id (`vitals/{app}_{day}`), up to 30 per query |
| `npm run backup` ([ROB-2](fiabilidad.md#rob-2)) | None: each collection group without filters, in name order, which Firestore serves on its own |

`ops` is written only with the Admin SDK (the backup script) and read only by the team; `vitals` takes the sampled sessions' performance, one write each, with no reads, and the rules cap what each write adds (docs/fiabilidad.md, [MON-6](fiabilidad.md#mon-6)).

Samples expire 30 days after they're taken (`expiresAt`), and the deletion of what's expired (section 10, Retention) removes them; **Limpiar caducadas** does it too, along with the errors resolved or ignored that went 180 days without coming back.

The superadmin's **Historial** (section 10) lists the newest first, and each filter needs its own index. Firestore merges them when several filters are on:

| Feature | Index |
| --- | --- |
| Historial → Cambios, by community, collection, operation or person | Composite on `audit`: `communityId` (or `collection`, `op`, `actorId`) ascending, `at` descending |
| Historial → Versiones de este documento | Composite on `audit`: `path` ascending, `at` descending |
| Historial → Acciones, by person, type or app | Composite on `actions`: `uid` (or `type`, `app`) ascending, `at` descending |
| The copies of whole documents | No index: `before` and `after` of `audit` and `meta` of `actions` are exempted (`fieldOverrides`), so they don't add an index entry per field to each write |
| Deleting what's expired (section 10, Retention) | Composite on `audit` and on `actions`: `keep` ascending, `at` ascending. Single field on the `activity` **collection group**: `at` ascending (a `fieldOverrides` entry, which also keeps the collection's own ascending and descending) |

Every index of this section is in `firestore.indexes.json`. CI deploys only the rules, so production gets them by hand, also on the free plan: `npx firebase deploy --only firestore:indexes --project dmoyadev-gobernansa`. Until then the Historial's filters fail.

## 3. Firebase Storage (photos and videos of issues and work orders)

The photos and videos neighbours attach to an issue, and those a provider adds when finishing a parte de trabajo, go to the project's Storage bucket ([A4.6](v1.md#a4)) from the webapp (`uploadMedia()` in `apps/webapp/src/app/infrastructure/storage.ts`). Storage needs Blaze ([B1](v1.md#b1)): until then production is built without a bucket and hides the pickers, so issues are created and jobs finished without photos.

- **Folders**: `issues/{communityId}/{authorKey}/`, the reporter's secret key and not their uid, so a URL every neighbour sees doesn't say who reported it ([Who reported an issue](#who-reported-an-issue)); and `workOrders/{token}/`. Each file is named with a random token, its name and its type's extension, so nobody finds another's files by name.
- **Limits** (the rules, section 1): up to 6 per issue and 10 per work order; images up to 20 MB, issue videos mp4, mov or webm up to 100 MB. The browser shrinks photos to 1920 px JPEG before uploading; those it can't read (HEIC on most browsers but Safari) and videos go as they are, with no conversion, so a HEIC photo only shows in Safari.
- **URLs**: Firestore keeps each file's download URL, whose token opens it without an account, as the provider does. In production they're absolute (`https://firebasestorage.googleapis.com/v0/b/…`). With the emulators they're relative (`/v0/b/…`) and the page's own server forwards them to the Storage emulator, so they also open from a phone in the local demo. Issues and work orders from before may still have URLs of the previous photo service: they show while that account exists, but the rules only take Storage URLs for new ones.
- **Deleted**: `purgeOldMedia`, scheduled with the functions (section 10), every Sunday at 05:00 (Madrid), deletes those of an issue removed over 90 days before, taking them out of its `assets` so a restored issue shows no broken links, and out of the copy its work orders keep (`issue.assets`), so the provider's page shows none rather than broken ones, and those uploaded over 90 days before that no issue or work order has (a save that failed). Those of an issue or a work order still there stay. It lists every file in both folders and reads the issues of each reporter with old files, a query per folder, and, when some go, the work orders of their community, a query per community.
- **Not in the backups**: `npm run backup` copies Firestore, not the bucket ([ROB-2](fiabilidad.md#rob-2), [B5](v1.md#b5)).
- **Known limits**: the lists load the whole photo as their thumbnail; the rules can't count, so whoever holds a key or a work order's token can upload any number of files (the lists in Firestore are capped); an upload the rules refuse shows the generic connection error.
- **Cost**: Storage's no-cost allowance only covers buckets in US regions, so an EU bucket is billed from the first GB. The Firestore reads the rules make are in section 1.

To turn it on, once the project is on Blaze:

1. **Firebase console → Storage → Get started**: **production mode** (test mode leaves the bucket open to anyone for 30 days) and a location in the EU ([GAR-3](competencia.md#gar-3)), e.g. `europe-southwest1` (Madrid). The location can't be changed later.
2. Right away, deploy the rules by hand, as CI doesn't: `npx firebase deploy --only storage --project dmoyadev-gobernansa`.
3. The first deploy asks to let Storage's rules read Firestore (it grants the **Firebase Rules Firestore Service Agent** role): accept, or every upload is refused, as the rules read the user's profile, their key and the work order.
4. Set the GitHub secret `VITE_FIREBASE_STORAGE_BUCKET` (section 4) to the new bucket (`storageBucket` in **Project settings → Your apps**), replacing any older value, and uncomment its line in both workflows, `.github/workflows/firebase-hosting-merge.yml` and `firebase-hosting-pull-request.yml`. The next deploy shows the pickers.
5. Deploy the functions again (section 10), even with no change: they take the bucket's name when deployed, and `purgeOldMedia` does nothing without it.

## 4. GitHub secrets for the deploy

The workflows now pass these, add them in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` in **Project settings → Your apps**. Its line is commented out in both workflows until the bucket exists, so the apps hide the photo pickers (section 3) |
| `VITE_FIREBASE_VAPID_KEY` | Firebase console → Project settings → Cloud Messaging → Web Push certificates |
| `VITE_MAIL_MODE` | `demo` (or unset) until the email extension is installed, then `extension`, see [Correo saliente](#correo-saliente) |
| `VITE_APP_CHECK_KEY` | The reCAPTCHA key id from section 9 (unset: no App Check) |

The rules deploy uses the same service account as the hosting deploy (`FIREBASE_SERVICE_ACCOUNT_DMOYADEV_GOBERNANSA`). In **Google Cloud console → IAM**, give that account (`github-action-…@dmoyadev-gobernansa.iam.gserviceaccount.com`) the roles **Firebase Rules Admin** and **Service Usage Consumer**, or the rules step fails with a permission error.

## 5. Admin platform hosting

The admin (`apps/admin`) has its own Hosting site, `gobernansa-admin`, next to the webapp's default site `dmoyadev-gobernansa`. Both are deployed on each push to `main` (and to a preview channel on each PR), webapp first: until the admin site exists its step fails and the workflow shows red, but the webapp is already deployed. Extra sites and custom domains are part of the free plan.

1. Create the site, either in **Firebase console → Hosting → Add another site** with the id `gobernansa-admin`, or with:
   ```bash
   npx firebase hosting:sites:create gobernansa-admin --project dmoyadev-gobernansa
   ```
2. Check the webapp's site id with `npx firebase hosting:sites:list --project dmoyadev-gobernansa`. `.firebaserc` maps the `webapp` target to `dmoyadev-gobernansa`; if the default site has another id, change it there.
3. **Hosting → gobernansa-admin → Add custom domain**: `admin.gobernansa.dmoya.dev`, then add the DNS records the wizard shows at the DNS provider of `dmoya.dev`. The certificate can take a few hours.
4. **Authentication → Settings → Authorized domains → Add domain**: `admin.gobernansa.dmoya.dev` and `gobernansa-admin.web.app`. Without them the admin can't send the emails with a link (confirming an email, making a new password). PR preview URLs aren't authorized (the list takes no wildcards), so signing in doesn't work there.

To deploy by hand: `npm run build && npx firebase deploy --only hosting:admin` (or `hosting:webapp`).

**Landing.** `apps/landing` is a plain HTML page with no build, served by GitHub Pages: every push to `main` that touches it deploys it (`.github/workflows/landing-pages.yml`), once **Settings → Pages → Source** is set to GitHub Actions. Its paths are relative, so it works under `/gobernansa/` as well as on its own domain ([A2](v1.md#a2)). Its demo form doesn't touch Firebase: it sends each request to a Telegram bot, whose address with the token and the chat id go in one constant, `BOT`, reversed and in base64. That only keeps token scanners away, anyone reading the code can still get it: if someone abuses the bot, revoke the token in @BotFather and put the new one in.

## 6. Installable app

Both apps install from the browser as apps (Chrome and Edge offer it; Safari adds them from its share menu, which the webapp explains on iPhone and iPad) and open without a connection. Nothing to set up: it's all in each app's `public/` and in `firebase.json`, on the free plan.

- **Manifest and icons**: `public/manifest.webmanifest`, linked from `index.html` with the iOS tags. The icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) are the isotype, white on the brand's navy for the webapp and coral on white for the admin. The webapp's has shortcuts to Nueva incidencia, Reservas and Mis recibos.
- **Service worker**: `public/sw.js`, written by hand and registered by `packages/shared/application/pwa.ts`. It saves `index.html` and the files it loads, serves Vite's hashed `/assets/*` from the cache and pages from the network, falling back to the saved one offline. Other origins (Firestore, Google APIs, Storage's photos) and writes go straight to the network. On `localhost` it caches nothing, so Vite's dev server and hot reload work as usual: try it offline on a PR's preview channel or the live site (DevTools → Network → Offline).
- **Updates**: after each deploy the worker saves the new `index.html` and drops the old hashed files. An app left open checks `index.html` each time it comes back to the foreground (a few hundred bytes, no reads) and shows **Nueva versión disponible · Actualizar**; a new `sw.js` also waits for that button to take over. Renaming its caches (`shell-v1`, `assets-v1`) drops the old ones when it does.
- **Push notifications**: they arrive through the same `sw.js`, whose registration `getToken` gets. `firebase-messaging-sw.js` is kept as a one line shim that imports it, for devices that turned them on before and still have that worker and its token; it can go once they've turned them on again.
- **Hosting headers**: `firebase.json` serves the pages (`/`, `index.html` and every path without an extension, the app's routes) and the workers and the manifest with `Cache-Control: no-cache` instead of Hosting's default hour, so the browser checks them each time and a deploy reaches them at once (an unchanged file is a short 304). Vite's hashed `/assets/**` are cached for a year, as their names change with their content. The two rules never match the same path, so it doesn't matter which one Hosting would apply first; the icons and images keep Hosting's default hour.
- **Offline data**: Firestore keeps what it reads in IndexedDB (`persistentLocalCache` with the multi-tab manager, in `packages/shared/infrastructure/firebase.ts`), so the installed app shows the last data without a connection and sends the changes made offline once it's back. It doesn't add reads: the server is still asked first, listeners opened again within 30 minutes are only charged for what changed, and several tabs share one connection. With the emulators it stays in memory, so their reset data doesn't mix with the live project's. Signing out removes it from the device (`terminate` and `clearIndexedDbPersistence` in `logout()`, `packages/shared/application/useAuth.ts`), which also stops the other open tabs' Firestore; those reload to `/login` when they see the session end. Changes not sent yet are lost with it, and if another tab holds it for over 3 seconds signing out goes ahead without it.
- **Not covered**: the images in `public/` aren't cached. The fonts are served from Hosting with the rest of `/assets`, so offline they come from the cache. There's no listing in the app stores.

## 7. Remote switches

Both apps read these switches from **Firebase console → Remote Config** when they open and again as soon as a change is published, with no deploy and no Firestore reads ([ROB-5](fiabilidad.md#rob-5) in [fiabilidad.md](fiabilidad.md)). Remote Config is free. A parameter that doesn't exist, or a browser that can't reach it, keeps the default, so nothing needs creating until it's needed. To use one, create the parameter with exactly this name and type, then **Publish changes**:

| Parameter | Type | Default | What it does |
| --- | --- | --- | --- |
| `payments` | Boolean | `true` | `false` hides the **Pagar** buttons of charges and bookings in the webapp |
| `remittances` | Boolean | `true` | `false` replaces the forms to generate remittances and payment orders in the admin with a notice |
| `aeatFiles` | Boolean | `true` | `false` disables downloading the 347, 190 and 184 in the admin |
| `censusImport` | Boolean | `true` | `false` disables importing a census or a portfolio in the admin |
| `errorReporting` | Boolean | `true` | `false` stops sending errors to the **Errores** page |
| `actionsLog` | Boolean | `true` | `false` stops recording what each user does for the **Historial**'s **Acciones** (section 10), one write per screen opened |
| `errorSampleRate` | Number | `1` | Share of sessions, from 0 to 1, whose errors carry a sample (stack, trail and context); lower it when errors spend too many writes |
| `minVersion` | String | empty | The lowest release still allowed, e.g. `2026.11.04-1200`. Older ones (`VITE_RELEASE`, shown in the webapp's profile and the admin's menu) are covered by a notice that only lets them update. Releases sort as text, so a date and time is enough |
| `maintenance` | String | empty | A message shown in both apps while it isn't empty |

Remote Config needs the **Firebase Installations API** and the **Firebase Remote Config API**, which a new Firebase project has on. If the API key is ever restricted ([ROB-8](fiabilidad.md#rob-8)), keep both in its list of APIs, or every app keeps the defaults. With the emulators the apps don't ask Remote Config at all and keep the defaults, so the local demo makes no request to the internet.

## 8. Demo project

What's shown to the offices runs on its own Firebase project, `gobernansa-demo`, on the free plan: its own data, quota and accounts, so a demo never touches production nor spends its customers' quota. `.firebaserc` calls it `demo`; if that id is taken, create it with another and change both mentions there. Indexes are in `firestore.indexes.json` (section 2), which `npm run deploy:demo` deploys with the rules; production's go by hand. On the free plan it has no Storage nor functions: its issues have no photos and its **Historial** only fills **Acciones**. For a demo with photos and without internet, see the local demo (section 12).

Once:

1. **Firebase console → Add project** `gobernansa-demo`, without Analytics. **Firestore → Create database** in `europe-southwest1` (Madrid), production mode.
2. **Authentication → Sign-in method → Email/Password**, with **Email link** and **Anonymous** off: neighbours sign in with the code of their access letter, which is an Email/Password account on `codigo.gobernansa.dmoya.dev` that receives nothing ([B2.4](v1.md#b2)). Free, like the rest of Auth on this plan. The password reset and email confirmation emails count against Auth's daily email limit.
3. **Project settings → Your apps → Web**, and **Cloud Messaging → Web Push certificates → Generate**. Copy `.env.example` to `.env.demo.local` at the root and fill it with that config and:
   - `VITE_FIREBASE_EMULATORS='false'`, `VITE_ENV_NAME='demo'` (the tab reads «gobernança DEMO») and `VITE_MAIL_MODE='demo'`;
   - `VITE_WEBAPP_URL='https://gobernansa-demo.web.app'`;
   - `VITE_FIREBASE_STORAGE_BUCKET=''`, empty and not left out, or the one in `.env.local` comes through and the pickers show for uploads that would fail;
   - `DEMO_PASSWORD`, at least 6 characters: the password of every demo account. Only the seed reads it, the apps never get it.

   The build reads `.env.local` too, and `.env.demo.local` wins: anything left out comes from there, so `npm run deploy:demo` stops unless the project is the demo one, the emulators are off and `VITE_WEBAPP_URL` is set.
4. **Hosting → Add another site** `gobernansa-demo-admin`, and **Authentication → Settings → Authorized domains → Add** `gobernansa-demo-admin.web.app` (the default site's domains are already there).
5. **Project settings → Service accounts → Generate new private key**, saved as `scripts/seed/serviceAccountKey.demo.local.json`. The seed refuses it unless its project is the `demo` of `.firebaserc`.
6. `npx firebase login --reauth` if the CLI asks, then `npm run deploy:demo` and `npm run seed:demo`.

Then:

- **Before each demo:** `npm run seed:demo` empties it and loads the whole demo again, with dates relative to that day. It removes any account that isn't the demo's and keeps the demo's, so whoever is signed in stays so; those missing are created with `DEMO_PASSWORD`, so a new `DEMO_PASSWORD` only reaches the accounts created after it. It spends about the demo's size in writes of the demo project's own quota. The seed only uploads photos to the Storage emulator, so here issues and work orders load without them, with a yellow warning.
- **After a release worth showing:** `npm run deploy:demo`, by hand, never on each push. It builds both apps in `demo` mode with a `VITE_RELEASE` like CI's and deploys the rules, the indexes and both sites.
- **Errors** of the demo go to its own **Errores** page: sign in as the team's demo account.
- Custom domains (`demo.` and `demo-admin.`) come with the product's own domain ([A2](v1.md#a2) in [v1.md](v1.md)).

## 9. App Check (quota protection)

The apps ask for an App Check token when `VITE_APP_CHECK_KEY` is set, and never with the emulators. Until the console enforces it, nothing is blocked: it only measures. Once per project (production and demo):

1. **Google Cloud console → Security → reCAPTCHA → Create key**, type **Website**, with the domains of both apps (`*.web.app` for the PR previews, and the custom ones from [A2](v1.md#a2)). No checkbox challenge.
2. **Firebase console → App Check → Apps → the web app → reCAPTCHA Enterprise**, with that key's id. Token lifetime: the longest the console allows (7 days), so a neighbour spends few of the 10,000 free assessments a month.
3. The key id as `VITE_APP_CHECK_KEY` in `.env.local` / `.env.demo.local` and as a GitHub secret (section 4).
4. Deploy, then watch **App Check → APIs → Cloud Firestore** for a week or two: the share of verified requests should be near 100 %. Only then **Enforce**. Unverified ones are old installs that haven't refreshed yet, or someone else's script.
5. In development the SDK prints a debug token in the console the first time; add it in **App Check → Apps → ⋮ → Manage debug tokens**, or the local app is blocked once enforced. Not needed with the emulators.

Also restrict the API key (**Google Cloud console → APIs & Services → Credentials**) to the apps' domains, keeping the Installations and Remote Config APIs (section 7).

## 10. Cloud Functions and the Historial

The admin's **Historial** (`/history`, superadmin only, `g h`) shows every change to the data, with each document's versions and a restore, and what each user does in both apps ([B12](v1.md#b12), most of [GAR-1](competencia.md#gar-1)). The changes are recorded by Cloud Functions, which need Blaze ([B1](v1.md#b1)); the actions are written by the apps themselves and work on the free plan. Until the functions are deployed, **Cambios** stays empty and restoring fails, while **Acciones** already fills in.

- **Node**: they run on Node 24, `engines` in `apps/functions/package.json`; the emulators run them on the local Node, newer, with a warning. ESLint refuses in `apps/functions/` Node's own modules and APIs newer than that (`node/no-unsupported-features/*`), but not yet the newest JavaScript built-ins (`Promise.try`, `RegExp.escape`…), so check those by hand. Node 24 is supported until 30/04/2028.
- **Code**: `apps/functions/`, a workspace of its own (Node 24, ES modules, `firebase-functions` 7 and `firebase-admin` 13), set up in `firebase.json`. `auditTop`, `auditNested` and `auditDeep` are Firestore triggers for documents 1, 2 and 3 levels deep; `auditAccountCreated` and `auditAccountDeleted`, Auth triggers of the first generation (the second has none), record accounts; `restoreVersion` is a callable only the superadmin can use; `purgeExpired`, scheduled, deletes what's expired (Retention, below), and `purgeOldMedia` the photos nobody sees anymore (section 3).
- **Region**: `REGION`, in `apps/functions/index.js` and in `apps/admin/src/modules/history/application/restoreVersion.ts`, is `europe-southwest1`. Firestore triggers must run in the database's region, production's is there (checked on 16/11/2026), and section 8 creates the demo project's there too. A project in another region needs both files changed.
- **Deploy** (CI only deploys Firestore's rules): on Blaze, the indexes first (section 2), then `npx firebase deploy --only functions --project dmoyadev-gobernansa`, and again after each change in `apps/functions/`. The first one turns on the APIs it needs; if it says to retry in a few minutes, do so. `purgeExpired` and `purgeOldMedia` run in `europe-west1` whatever `REGION` is, as Cloud Scheduler may not be in Madrid.

```text
audit/{eventId}       path, collection, docId, communityId? (the path's, or the one the document carries), op create | update | delete,
                      changed (field names), before, after (whole, or only what changed, cut, with truncated: true),
                      authType, authId, actorId, actorName, actorEmail, actorInferred?, restoredFrom?, keep short | year | fiscal, at
                      accounts as path auth/{uid}, collection auth, with { email, providers, anonymous, disabled, createdAt, lastSignInAt }
actions/{id}          uid, email?, name, app webapp | admin, type signin | signout | page | print | download | view-as | view-as-exit
                      | email | password | restore, path, detail?, meta?, communityId?, viewAs?, device, keep short | year | admin, at
ops/restore-{sha1}    { uid, name, email, auditId, side, at }, by restoreVersion, the sha1 of the restored document's path
```

- **Changes**: every create, update and delete, but in `audit`, `actions`, `errors`, `vitals`, `ops` and each community's `activity` (a register already), under `users/{uid}` the secret keys (`keys`), the push devices (`devices`, whose id is the token) and the documents' files (`documentFiles`: their list, `documents`, says who, when, name and size), and writes that change nothing. Who made it comes from the session; writes without one, like a provider's report, show as without a session. In the emulators no event carries a session, so it's guessed from a person field the write itself set (`updatedBy`, `authorId`…) and marked `actorInferred`, and a delete shows as unknown. That production's events bring the user's uid hasn't been checked yet. A document too big to keep twice (over about 900 KB) keeps only what changed, cut, and can't be restored. The superadmin sees who created an anonymous issue, as they could already read its `private/author`: anonymity is towards neighbours.
- **Retried**: a Firestore trigger that fails runs again, so a passing error doesn't lose an entry, and each event writes its entry once (`audit/{eventId}`). A failure that never goes away retries for up to 24 hours (second generation functions).
- **Restore**: **Restaurar la versión anterior** or **Restaurar esta versión** writes that state back, or removes the document if it didn't exist then. It's refused when the document is already so, for accounts, for cut entries and for anything under `offices/`: invoices, the Verifactu register and the office's counters and end of the chain are corrected with a rectificativa, never put back. The restore is a change like any other, so it can be undone the same way: it leaves an `ops/restore-*` marker that its own entry takes (within 60 seconds) to name the superadmin and the change it came from, and logs a `restore` action.
- **Actions**: written by `packages/shared/infrastructure/actions.ts`, one document each: every screen opened, printing, signing in (with password or an access code) and out, asking to add an email, changing the password, starting and stopping «Ver como vecino» and every download. `name` is what the app sends, unchecked by the rules (the uid and email are). Not sent once the quota has run out, nor in development against the live project. The `actionsLog` switch (section 7, [ROB-5](fiabilidad.md#rob-5)) turns them off.
- **Cost**: each write to any document wakes a trigger, the skipped collections too (they stop at once): one invocation, one `audit` write and, once per instance, a read of that person's profile. A bulk write (a census import, `npm run restore`) makes one of each per document. The entries keep whole documents, so `audit` also grows in stored size with every change. Each action is a write, mostly one per screen opened, out of the free plan's 20,000 a day.

<a id="retention"></a>

### Retention

Each entry of `audit` and `actions` carries its class in `keep`, set when it's written (`apps/functions/retention.js`, `packages/shared/infrastructure/actions.ts`; the rules require it and leave `admin` to the superadmin), and is deleted whole once its time is up. The legal pages of both apps say the same:

| What | `keep` | Kept |
| --- | --- | --- |
| Screens opened | `short` | 90 days |
| Screens of a person or a property (a route with `uid` or `propertyId`) | `year` | 12 months |
| Signing in and out, downloads, printing, «Ver como vecino», password and email changes; accounts (`auth/*`) | `year` | 12 months |
| Everything the superadmin does, restores included | `admin` | 3 years |
| Versions of charges, payments, remittances, debts, accounting, budgets and expenses, bookings, meetings, votes, actas, properties, communities, invoices and Verifactu | `fiscal` | Until the 31st of December of the year after the change |
| Every other version (profiles, invitations, mail, issues, comments, work orders, providers…) | `short` | 90 days |
| Anything, whatever its class | | 3 years at most |
| Each community's `activity`, outside the Historial | | 5 years from the end of each year |
| The errors' samples | | 30 days (`expiresAt`) |
| Photos and videos of a removed issue, or never attached (section 3) | | 90 days |

- **Who deletes**: on Blaze, `purgeExpired`, every night at 04:00 (Madrid), up to 10,000 documents a night (one of the three free Cloud Scheduler jobs; `purgeOldMedia` is the second). On the free plan, the copia de seguridad ([ROB-2](fiabilidad.md#rob-2)) after each copy, and `npm run purge`, which counts what's expired and, with `--delete`, deletes it. The daily copy isn't scheduled yet: until then, run `npm run purge -- --delete` once a month, again while it warns that it reached the 10,000 and there's more.
- **Cost**: a read and a delete per document, up to 10,000 a run, half the free plan's daily deletes; counting, a read per 1,000.
- **Restore**: an entry deleted takes its version with it, so it can no longer be restored. The copies keep it until they rotate out (the last 14), but the `actions`, which they never take. A profile document whose file was deleted isn't restored either: the file was never copied.
- **Kept apart**: before something tied to a security breach, a claim or an access request expires, export only that case's `audit` and `actions` entries (by the person's `uid`, the community's `communityId` or the document's `path`), encrypt them with the copies' key (`encrypt` in `scripts/backup/archive.js`), date the file and keep it outside the backups' folder until it's resolved. A whole copy (`npm run backup`) only when a breach needs everything, with the `actions` exported apart first: the copy leaves them out and then deletes what's expired. By hand with the Admin SDK; ponytail: a script at the first case.
- **End of an office's contract**: after handing it each community's export (**Exportar** in the community), delete its history: the `audit` entries with its communities' `communityId`, those whose `path` is under `offices/{officeId}`, those of its people's accounts and profiles (`auth/{uid}`, `users/{uid}` and below, their `invitations`), and the `actions` of its people (`uid`). By hand with the Admin SDK; ponytail: a script when the first one leaves.

## 11. Local emulators

`npm run dev` starts the emulators of `firebase.json` (their UI on 5500, Auth on 5501, Firestore on 5502, Storage on 5504 and Functions on 5505), loads the seed (`--reset`) and serves the webapp at `https://localhost:5400` and the admin at `https://localhost:5401`, with `VITE_FIREBASE_EMULATORS='true'` in `.env.local`. The apps connect to all of them or to none, as the real project rejects the emulators' tokens. Firestore's and Storage's emulators need Java 21, and their first start downloads their jars (`~/.cache/firebase/emulators`, Storage's rules runtime included), the only time they need internet.

- **Rules**: both files are enforced, Firestore's and Storage's.
- **Photos**: the seed uploads captioned SVG placeholders to the Storage emulator, in the folders of section 3, and stores their relative URLs; Vite forwards `/v0/b` to it. There's no video in the seed. Without the Storage emulator (`FIREBASE_STORAGE_EMULATOR_HOST` unset) issues and work orders load without photos, with a yellow warning.
- **Functions**: the Historial records each change made in the apps and restores, guessing who made each change (section 10).
- **Remote Config**: not read, the defaults of section 7 apply.

## 12. Local demo

`npm run demo` (`scripts/demo.js`) runs the sales demo on the laptop alone, with no internet, and a phone on the same network opens the webapp: the guide is [demo.md](demo.md). What it needs and does:

- **Before**: Java 21 on the PATH (`brew install openjdk@21`) and `DEMO_PASSWORD` in `.env.local`, the password of every account. The first run on a machine needs internet once, to download the emulator jars (`~/.cache/firebase/emulators`, Storage's rules runtime included); the script warns when one is missing.
- **Ports**, apart from `npm run dev`'s, so both can run at once: webapp 5402, admin 5403, and the emulators ten above `npm run dev`'s: Auth 5511, Firestore 5512 (websocket 5513), Storage 5514, hub 5516, logging 5517. The project is `demo-gobernansa`, which only exists in the emulators.
- **What it does**: starts the Auth, Firestore and Storage emulators, loads the seed with its photos, builds both apps against them with the laptop's network address and serves them over http on every interface, forwarding the emulators' paths through each page's own address. It prints both addresses, a QR code for the webapp and the accounts. The admin goes at `http://localhost:5403` on the laptop, not the address: copying links and `crypto` need localhost.
- **No functions**: the Historial records no changes and can't restore there, and says so; **Acciones** does fill in.
- **`npm run demo:reset`** loads the data again while it runs, without signing anyone out. Ctrl+C or closing the terminal stops everything. A full restart signs the phones out, and a network change needs one, as the address is in the build.
- **Proxy**: it clears `HTTP(S)_PROXY` for the emulators; with one set, Storage's rules couldn't read Firestore and every upload was refused.
- **Network**: while it runs, anyone on that network reaches the emulators. The data is made up, but the phone's hotspot is better than a client's guest wifi.

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

Accounts are added from the admin platform (a community's **Vecinos y gestores**, or **Administradores** for the team) by inviting an email, stored as `invitations/{email in lowercase}` with the name, role and community. With **Enviar invitación por email** (on by default) an email with the link to their app (the webapp for neighbours, the admin for everyone else) is queued along with it, see [Correo saliente](#correo-saliente). The person signs in to the app with that email, and on their first sign-in their profile is created from the invitation, which is then removed. Only verified emails can take one, which sign-in links are; password accounts created in the console aren't.

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
monthlyVotes   votes each property gets every month, 5 when missing
issueCategories[]  { id, name, icon, color: amber | green | cyan | blue | purple | rose | gray, examples?, defaultTitle? },
                   in the order neighbours see them. The six defaults (DEFAULT_ISSUE_CATEGORIES) when missing
```

### Issue categories

Each community has its own, edited from the admin's **Incidencias → Categorías** like the common areas: create, rename, change the icon, color and examples, reorder by dragging and remove (at least one stays). Until it's first saved the community has the six defaults (Mantenimiento, Limpieza, Molestias, Jardinería, Servicios, Otros). Issues keep their category's id, so renaming one renames it on all of them; one that's removed shows with its default name if it was a default, or as **Sin categoría**. The suggestions while reporting only know the defaults, so they only offer one of those the community still has. A parte de trabajo keeps the category's name and icon, as the provider can't read the community.

`schedule` works for any contact (e.g. the janitor's shifts): days are ISO weekdays (1 is Monday, 7 is Sunday) and times are 24 hour and zero padded. Add one entry per shift, e.g. `{ days: [1, 2, 3, 4, 5], from: '08:00', to: '15:00' }` and `{ days: [6], from: '09:00', to: '13:00' }`. The contact then shows its hours and whether it's available now.

### Monthly votes

Properties vote, not people: each issue has at most one vote per property, cast by its owner (`ownerUid`), so a home with several accounts counts once and an account without a property doesn't vote. Each property gets `monthlyVotes` votes every month (5 by default) to spend on the issues that matter most. An owner of several properties votes with the one selected in their profile, and each has its own votes. A vote uses one of the month it's cast in; taking it back that same month gives it back, and votes from past months stay on their issues without using this month's. The month's votes of the user's properties are read (a few documents, never more than `monthlyVotes` per property) and told apart by property in the app. Until the index above exists, the remaining votes can't be counted: they show as "—" and voting isn't limited.

The limit is checked by the app. Rules can't count documents, so someone calling the API directly could vote past it; enforcing it on the server would need a Cloud Function (paid plan).

## Data the app writes

```text
communities/{communityId}/issues/{issueId}
  votesScore, votesCount, commentsCount   counters, written along with each vote or comment
  authorKey                               the reporter's secret key, to find their own (see below). No createdBy
  votes/{issueId}_{propertyId}            { propertyId, voterId (its owner), score: 1 | -1, votedAt }
  private/author                          { uid }, who reported it, written with it and never changed
  comments/{commentId}                    { type: message | status, message, status?, authorId, authorName, authorRole? }
users/{uid}                               profile, created from their invitation on the first sign-in
invitations/{email}                       { email, name, role, communityId, communityIds?, invitedBy, invitedAt }
users/{uid}/documents/{id}                property documents (listing)
users/{uid}/documentFiles/{id}            their content, up to 1 MB each
users/{uid}/devices/{token}               devices with push notifications on
users/{uid}/keys/issues                   { key }, the secret key of the issues they report, made once and only read by them
```

### Who reported an issue

Only the administration knows it. The issue has no `createdBy` and its author's changes aren't signed (`updatedBy`, and `deletedBy` when they remove it): who reported it goes in `private/author`, which only whoever manages the community reads, written in the same batch and never changed. To find their own issues ("Mis incidencias" and the count on the home page) and remove them, the issue carries `authorKey`, 192 random bits made the first time the user needs it and kept in `users/{uid}/keys/issues`, which only they can read. Neighbours see the key but can't tell whose it is. They can tell that two issues share an author, though not who; an issue about a property (`location.type: property`) still says which one, as before. Its photos go in a Storage folder named after the key, not the uid, so their URLs don't say who either (section 3).

## Community management

Everything below runs in the browser and is enforced by [`firestore.rules`](../firebase/firestore.rules), with no Cloud Functions and no scheduled jobs, so it works on the free plan. Only the providers' photos need Storage, on Blaze (section 3). The types are in `packages/shared/domain`.

```text
properties/{id}                                 census: name, type, coefficient (%), ownerUid ('' without account), ownerName, ownerEmail, ownerNif, ownerPhone (≤ 40), tenantName, tenantEmail
providers/{id}                                  directory shared by communityIds, with ratingSum / ratingCount
  ratings/{uid}                                 { score 1–5, comment, communityId, authorId, authorName }
events/{id}                                     notices too: the copies of one sent to several communities share broadcastId
communities/{c}/issues/{i}                      + provider, expectedAt, resolvedAt, insuranceClaim
  private/admin                                 internal note, insurance claim and the token of the provider's parte de trabajo (workOrder), never readable by neighbours
  private/author                                who reported it, never readable by neighbours
  comments/{id}                                 + hiddenAt, hiddenBy (hidden by the administration)
workOrders/{token}                              partes de trabajo, see below
mail/{id}                                       correo saliente, see below
communities/{c}/meetings/{m}                    juntas: agenda, place / link, status draft | convened | held | cancelled, votingOpen
  attendance/{uid}                              attending | absent | delegated (+ delegateName)
  ballots/{itemId}_{propertyId}                 one vote per property, weighted by its coefficient
  minutes/record                                the signed acta, sealed with its hash (see Acta firmada below)
  notices/{kind}_{uid}                          the convocatoria or the acta sent to each owner (see Acta firmada below)
communities/{c}/charges/{id}                    receipts and levies (cents), owners read theirs. + collections, collected, collectionYears, interest (see below)
communities/{c}/budgets/{year}, expenses/{id}   budget items and expenses (cents), open to neighbours
communities/{c}/obligations/{id}                IEE, elevator, extinguishers, legionella, insurance… with dueAt and everyMonths
communities/{c}/bookings/{areaId}_{date}_{from} a slot can only be booked once, its id makes a second booking an update the rules deny
communities/{c}/activity/{id}                   who changed what, written with each change from the admin, never edited
users/{uid}.blocked                             a blocked neighbour can read but not report, comment, vote, book or answer meetings
```

What the free plan leaves out, and how it's covered:

- **Due date warnings** (obligations): there's no server to send emails, so they show in the admin (the obligations page and the portfolio dashboard), and each obligation can be added to the admin's own calendar as an `.ics` with its reminder.
- **PDF certificates and minutes**: printed from the browser ("Guardar como PDF"), the admin hides its frame when printing.
- **Limits the rules can't count** (bookings per week, monthly votes of each property): checked by the app.
- **Documents sent to a neighbour**: stored in Firestore like their own (up to 1 MB each).

Counts on the portfolio dashboard use aggregation queries, which cost one read per 1000 documents counted.

"Ver como vecino" opens the webapp with `?viewAs=<communityId>`: whoever manages that community sees it read-only as a neighbour would. The admin needs `VITE_WEBAPP_URL` (the webapp's address, `https://gobernansa.dmoya.dev` when missing) and has to sign in to the webapp with the same account.

### Importación del censo

From a community's **Vecinos → Propiedades → Importar censo**, its census comes from an `.xlsx`, a CSV or TSV (`;`, `,` or tab, UTF-8 or Windows-1252) or cells pasted from Excel or Google Sheets. The `.xlsx` is unzipped and parsed in the browser (`packages/shared/utils/xlsx.ts`, with `DecompressionStream` and `DOMParser`), with percentages and dates as Excel shows them; old binary `.xls` files aren't read, the page asks to save them as `.xlsx` or CSV. The header row and each column are guessed from the headings and can be changed. Each row is then compared with the census by the property's name, ignoring case, accents, spaces and punctuation: new, update (only what the file fills in, an empty cell never removes anything), unchanged, or error (no name or repeated, invalid coefficient, NIF, IBAN, email or mandate date), and the page warns when the coefficients won't add up to 100 %. The review lists each community's errors first and shows up to 200 rows until **Mostrar … filas más**; every row is checked and imported either way. **Descargar plantilla** gives a CSV with the expected headings.

From the communities list, **Importar comunidades** takes the same file with a **Comunidad** column (and optionally its CIF, address and IBAN). Each community in it is matched with an existing one by CIF, then by name. gobernança's team creates the ones that don't exist (without `constructionYear` nor administrators, assigned later from **Administradores**); administrators only import into theirs.

```text
properties/{id}     the fields the properties page writes, new ones with ownerUid ''
  mandate           from IBAN + mandate reference + signing date: { reference, debtorName (the owner), iban, signedAt,
                    status: 'active', firstRemittanceId: 'migrated' }
communities/{id}    created ones: { name, address, cif?, iban?, createdAt, createdBy, updatedAt, updatedBy }
```

- **Nothing is removed**: the properties missing from the file are listed and left as they are. Owners with an account keep the account's name and email.
- **Migrated mandates**: `firstRemittanceId: 'migrated'` (as if a remittance had carried their first debit) makes their first debit from here recurrent (RCUR), as SEPA asks of mandates brought from another program. An IBAN without its mandate reference and date isn't stored, as properties have no place for it, and the row says so. Phones go to `ownerPhone`, as typed (a row with one over 40 characters is an error).
- **Writes**: batches of up to 497 properties plus their activity entry (and the created community with its own), within the 500 writes of a batch. If one fails, what was written stays and the file is compared again, so importing it again only writes what's left.
- **Invitations**, optional: each owner with an email and no account is invited as a neighbour with the people page's `invite()`, one invitation and activity entry each, skipping the emails that already have a profile or an invitation in the community. As on the people page, **Enviar invitación por email** (on by default) also queues each one's invitation email (see [Correo saliente](#correo-saliente)).
- **Rules**: the ones of `properties` (a numeric coefficient and `ownerPhone` a string of up to 40 characters), `communities` (created only by `superadmin`), `invitations`, `mail` and `activity` cover it.
- **Reads**: one query of each community's properties (`communityId ==`) when the file is read, and again on coming back to the page or after importing; when inviting, one of its users and one of its invitations, plus the community once per invitation sent by email (`invite()` reads it for its name). Equality-only, no new index. Nothing is paid or sent anywhere, so there's no test mode.

### Entregas a cuenta e intereses de demora

From **Recibos**, the office records partial collections on an unpaid charge that isn't domiciliated (amount, date, efectivo / transferencia / tarjeta / otro, note) and undoes them one by one. What's left is the amount minus what was collected, and everything that shows or sums debt uses it: the charges list, the statements (each entrega on its own line), the arrears aging, claim letters, the monitorio, the payments certificate, the Finanzas summary, the community dashboard and the portfolio, the bank's match candidates, the exports of balances and debtors (the charges export adds a **Cobrado a cuenta** column), a new remittance's debits and the neighbours' **Mis recibos**, whose test payment pays what's left. The journal books each entrega on its date (to 570 Caja when in cash, else 572 Bancos) and the rest on the day the charge was paid. Charges without these fields work as before.

Late interest is a per-community setting, off by default, edited on **Morosidad**: the yearly rate and the days of grace. It's simple interest on what's left of each overdue charge, day by day, from its due date plus the grace to today (or another day picked), on a 365 day year and rounded to the cent per charge. The page reminds that it needs the junta's or the statutes' approval and that the interés legal del dinero is set each year by the Ley de Presupuestos; 3,25 % is only offered as a starting value. **Generar recibo de intereses** issues a charge for a debtor's interest (batchId `interest`, booked to 769 Otros ingresos financieros), due in 15 days, that's collected like any other one and accrues no interest itself.

```text
communities/{c}.lateInterest   { rate (hundredths of a percent: 325 is 3,25 %), graceDays }, missing when off
charges/{id}.collections[]     { id, amount, date, method: cash | transfer | card | other, note? }, in the order they were recorded
charges/{id}.collected         their sum, so the rules know what's left and the Finanzas summary sums it on the server
charges/{id}.collectionYears   the years they fall in, so each year's books find a charge paid in parts across years
charges/{id}.interest          a recibo de intereses: { chargeIds, to: 'YYYY-MM-DD' }, its charges were charged until then
```

- **Rules**: only the office writes them, with up to 100 entregas per charge, the last one added checked field by field, `collected` between 0 and the amount, and `interest` with up to 500 charges. A neighbour's test payment must be exactly `amount - collected`. `lateInterest` takes a rate up to 20 % and up to 365 days of grace.
- **Paid**: a charge is marked paid on the day of the latest entrega once they reach its amount. One marked paid by hand or online keeps what it covered: it's marked pending before undoing an entrega. Annulling a year's unpaid fees leaves those with entregas.
- **Domiciliated**: a remittance debits what's left of each charge, and while the charge is in it no entrega can be added or undone. A return keeps what was debited (`returns[].amount`; older returns, without it, debited the whole amount), which the journal books as collected and given back.
- **Not charged twice**: interest is worked out from the charges, never stored, and a recibo de intereses says until when its charges were charged, so the next one starts there. Interest not yet charged when a charge gets paid is no longer counted.
- **Reads**: recording or undoing an entrega reads the charge once (a transaction). The arrears page reads the community and, while interest is on, the recibos de intereses once (`batchId ==`); the books add one `collectionYears array-contains` query, and the summary sums `amount` and `collected` in the same aggregation. Single-field filters only, no new index.
- **Not covered**: the community dashboard's money widget still counts as collected in a month the whole amount of the charges paid in it, entregas included.

### Partes de trabajo

With a provider assigned to an issue, the administration creates a link for them (**Parte de trabajo** on the issue) and sends it by WhatsApp (a `wa.me` link, no API), email (queued in the [correo saliente](#correo-saliente) when it's created, if the directory has the provider's, or `mailto`) or copied. The provider opens `/gremio/<token>` in the webapp without an account: they see the job, its photos, the address with a map link and the administration's contact, and they accept or reject it (with a reason), schedule the visit and mark it done with a note and photos (uploaded to Storage, hidden without a bucket, section 3). The issue page shows their answers live; once done it offers to mark the issue as solved, and a scheduled visit can be posted to the neighbours as a comment (offered once per visit date: one already among the issue's comments isn't offered again).

```text
workOrders/{token}   communityId, issueId, community { name, address }, issue { title, description, category, location, assets },
                     expectedAt, contact { name, phone?, whatsapp?, email? }, provider { id, name },
                     status sent | accepted | rejected | scheduled | done, scheduledAt?, photos?,
                     history[] { at, status, note?, scheduledAt? }, createdAt, createdBy, updatedAt, revokedAt
```

- **The token is the only credential**: 192 random bits in base64url from `crypto.getRandomValues`. Anyone can get one by its id, but nobody can list them, so they can't be found. It's kept in the issue's `private/admin` (`workOrder`), so the admin reads it by id with no query or index.
- **A copy, not a view of the issue**: only what the provider needs, taken when the link is made. The community's name and address, the issue without who reported it, and the community's **Administración** contact (or whoever made the link). Changing the issue later doesn't change it, but for the expected date: when the issue's differs from the order's while the provider can still act, the issue page offers **Actualizar la fecha en el parte**. Anything else needs a new link.
- **Rules**: whoever manages the community creates, revokes (`revokedAt`) and deletes them, and can change `expectedAt` alone. Without signing in, an update can only add one step to the history (up to 20, with a note of up to 2000 characters) with an allowed status change (accepting only comes first, the visit can be rescheduled, rejecting or finishing ends it), the visit date when scheduling and up to 10 photos, download URLs of files under `workOrders/{token}/` in Storage (relative with the emulators), one URL each, with `updatedAt` set by the server and only while it isn't revoked.
- **Revoked**: from the issue (**Anular** or **Nuevo enlace**) and when its provider is changed or removed. The link then says it was cancelled.
- **Cost**: one listener on that document while the provider's page or the issue page is open. The issues list doesn't show its status, as that would read one more document per issue.

### Acta firmada y notificaciones

Once a meeting is held, the acta the admin composes (attendance, agenda and results) is saved as **Preparar acta para firmar**, naming the president and the secretary from the community's people (or the administrator). Its text and signers can be edited until both have signed; saving takes off any signature there was. The secretary signs in the admin; the president either signs there in person or from the webapp, where the meeting shows **Firmar acta** to whoever is named. Once both have signed, whoever signed last seals it in the same flow, from the admin or the webapp (or the admin when it next shows the acta, if that failed): SHA-256 (`crypto.subtle`) of the text and both signatures with who and when, stored with `closedAt`. If both seal it at once the rules refuse the second, which then finds it sealed and leaves it. The printable acta shows the signatures, the hash (short and full), a QR with the hash and the meeting reference, and the list of notifications.

From the sealed acta, **Notificar a los propietarios** sends a notice to each owner of the census (their properties grouped by account, email or name), and **Notificar convocatoria** does the same for a convened meeting. Each owner with an account sees it in the webapp, where opening it marks it read and **Acuso recibo** records the acknowledgement. Owners who neither attended nor were represented (no attendance answer as attending or delegated and no ballot from their properties) get **Manifestar mi discrepancia** for each voted agreement, for 30 natural days from their notice; the admin shows each agreement's result counting them in favour or, if they dissent, against (art. 17.8 LPH), provisional until the 30 days are over. A dissent received by post, burofax or in person, from an owner with an account or without, is recorded under the notifications table with **Anotar discrepancia** (the absent owner, the agreement and the day it arrived); it counts the same and the table and the webapp show it apart from those made in the app.

```text
meetings/{m}.minutesSigners      the president's and the secretary's uids, so the webapp knows who can read the acta before it's sent
meetings/{m}.minutesSigned       those of them who have signed, so the meetings list stops showing them Firma del acta
meetings/{m}.notifiedAt          { call?, minutes? }: when each was last sent. Owners can read the acta from then on
meetings/{m}/minutes/record      communityId, meetingId, text, president { uid, name }, secretary { uid, name },
                                 signatures { president?, secretary? }: { uid, name, path, signedAt, byUid, byEmail },
                                 hash ('' until sealed), closedAt, updatedAt, updatedBy
meetings/{m}/notices/{kind}_{uid}  kind call | minutes, uid ('' without an account, then the id is {kind}_p{first propertyId}),
                                 name, email, propertyIds, propertyNames, coefficient, absent, items (voted item ids),
                                 app, certified { mode: 'test', reference }, sentAt, sentBy, readAt, receivedAt, dissent { itemId: at },
                                 recordedDissent? { itemId: { receivedOn, recordedAt, recordedBy } } (received outside the app)
```

- **Firma electrónica simple**: the stroke drawn (an SVG path of whole numbers in a 400×150 box, up to 20 000 characters) plus the account signed in (`byUid`, `byEmail`) and the server's time. `byUid` differs from `uid` when it was signed in person on the administration's screen.
- **Rules**: whoever manages the community writes the acta's text and signers, only with no signatures in the result and not once both have signed. Each signature can only be added to its empty slot, by the person named there or by whoever manages the community, dated by the server, and blocked neighbours can't. Sealing, once both have signed and by whoever manages the community or one of the two signers, sets a 64 hex `hash` and `closedAt` (the server's time); then nothing can change it. A signer adds only their own uid to the meeting's `minutesSigned`, nothing else of the meeting. Neighbours read the acta if they're one of its signers or once it's been sent to the owners (one extra read of the meeting). Notices are created by whoever manages the community, who then only adds or takes back an entry of `recordedDissent`: one voted agreement at a time of an absent owner's acta notice, received on a day not in the future, signed and dated by the server. Each owner reads only theirs (by its id; only the administration lists them), sets `readAt` and `receivedAt` once, and adds a dissent per voted agreement while absent and within 30 days of `sentAt`, dated by the server. Blocked owners can too: blocking stops spam, not their rights as owners.
- **Test mode**: the certified notification (correo certificado / burofax) sends nothing; each notice gets a made-up `PRUEBA-BF…` reference, and the admin labels it as a test. Owners without an account only get that channel (and the email, when the census has theirs), so the admin lists them to print and post the acta. Every owner with an email in the census gets it by email too, the acta's text included (see [Correo saliente](#correo-saliente)). A real certified provider would be added in `sendNotices()` in `apps/admin/src/modules/meetings/application/useMeetings.ts`, the one place notices are created.
- **Reads**: the admin listens to the acta while the meeting is held and to its notices once any is sent; the webapp only to the acta when the user can read it and to their own notices by id. The meetings list shows **Firma del acta** (to a signer not in `minutesSigned`) or **Acta enviada** from the meeting itself, with no extra reads. Equality-only, no new index.
- **Online meetings**: meetings held only online are pending general regulation in the LPH, so the admin and the webapp say so when a meeting has a link and no place, and the admin suggests also giving a place.

### Comprobación de ficheros, devoluciones importadas y abonos de la pasarela

Before each download of a remittance (pain.008), a transfer order (pain.001), a 347, 190 or 184, or the journal (CSV or ContaPlus' XDiario), the admin checks the exact file about to be saved (`packages/shared/domain/fileChecks.ts`) and shows **Comprobación del fichero**: all correct, warnings, or errors with the block, transaction or record they point to. Errors hold the download (and a new remittance or order isn't created) until **Descargar igualmente** or **Generar igualmente**. **Exportar e importar → Comprobar un fichero** checks any of them made by another program. Each download is logged in the community's activity with the result of its check ([MON-4](fiabilidad.md#mon-4)), in a write of its own that isn't waited for. It all runs in the browser (DOMParser, TextDecoder), nothing is uploaded.

- **SEPA**: well-formed XML; the version (pain.008.001.02 or .08, pain.001.001.03 or .09); NbOfTxs and CtrlSum of the file and of each block; identifiers of up to 35 characters of the SEPA set, PmtInfId unique and EndToEndId not repeated; IBAN check digits and BIC format; the creditor identifier's check digits (ISO 7064 mod 97-10 over the NIF and the country, as `creditorId()`); amounts above zero with two decimals at most; collection and execution dates not past (a collection today is a warning); sequence types FRST, RCUR, OOFF or FNAL; the mandate signed by the collection date; names present and within the SEPA characters.
- **AEAT**: ISO-8859-1 (a UTF-8 file is an error), records of 500 characters, one of type 1 and then those of type 2, model and year in their place, valid NIFs, digits where the designs `aeat.ts` follows have numbers, and the type 1's counts and totals equal to what the type 2 add up (in the 190, dinerarias plus en especie and incapacidad laboral). In the 184, what's attributed to the members per clave is compared with the entity's records, as a warning.
- **Journal**: every entry balances; ContaPlus subaccounts that don't have 8 digits are a warning.
- It checks the record design and the data, not what the Sede or the bank will say: the first real filing still goes through the Sede (it validates the file before signing) and the first remittance or order is uploaded to the bank without signing it.

**Importar devoluciones** (Remesas) reads the bank's pain.002 (transactions with TxSts RJCT and StsRsnInf/Rsn/Cd) or camt.054 / camt.053 (entries with RtrInf/Rsn/Cd and the original EndToEndId), matches each one to a remittance's debit by its EndToEndId (and its amount, when the report has it) and shows them with the reason in Spanish, plus those it can't register: not found, a different amount, already returned, a remittance not sent yet or a reason code it doesn't know. Registering goes one by one through the same return as by hand (`returnDebit`): the same fields, an optional fee per return, one activity entry each, and it can be undone. RC01 and RR01–RR04 were added to the reasons. Each return now also keeps the amount debited (`charges/{id}.returns[].amount`), what the entregas a cuenta had left.

**Abonos de la pasarela, in test mode**: the test gateway pays each day's online payments (`communities/{c}/payments`, those not reverted) into the community's account as one payout two days later, without fees. The test bank feed (and its sample Norma 43) brings those payouts on their dates, and the bank page offers each one as a single candidate covering its day's payments; reconciling it marks them:

```text
communities/{c}/payments/{id}.bankMovementId   the movement of the payout that paid it in, removed when that's undone
```

- **Rules**: only whoever manages the community, changing only that field, to a movement of the community that exists (one more read per request).
- **Reads**: the bank page reads the last 90 days of payments once (`createdAt >=`, single field, no index); undoing a payout reads each of its payments once.
- **Books**: a charge or booking paid online is booked that day to 5729 Pasarela de pago, and each day's payments move to 572 Bancos on their payout's date (`payoutDate()` in `bank.ts`, the date of the test gateway's payout movement), so the bank account follows the statement and what's on the way stays in 5729 (shown apart in the annual report's Tesorería). The books read the charges and bookings paid in the last two days of the year before too, whose payout falls in the new year. A year closed before this change with online payments in its last two days shows that its closing no longer matches, to be reopened and closed again.
- **A real gateway** (Redsys, Stripe) has its own payout calendar and fees and says which payments each payout carries: that list would replace `gatewayPayouts()` in `bank.ts`, and its fee would be recorded as an expense.

### Sugerencias y redacción automática

Four helpers that run in the browser and send nothing anywhere (`packages/shared/application/writing.ts`, loaded only when a page needs it). Each uses the browser's own on-device API when it has one and a basic version with rules and templates otherwise, and a chip says which ran: **En tu dispositivo** or **Básico**.

- **Issue suggestion**: from the title and description, the category, the trade for the provider and the urgency (baja, normal, alta, urgente) with its reason, plus what to do right away for gas, fire, people stuck in the lift, electrical risk, falling materials or a water leak. In the webapp's **Nueva incidencia** it offers the category as a chip the neighbour can take (never changed by itself) and shows that advice; in the admin's issue page it shows the urgency and lists the providers of that trade first: the basic version at once when the issue opens, and the on-device one, where there is one, once per issue and text while the admin stays open. Basic: a table of Spanish keywords, without accents. On the device: Chrome's `LanguageModel` with a JSON schema, checked against the categories, trades and urgencies (the rules' high or urgent level stays as a floor).
- **Resumir**, on the admin's issue page: three to five points from the comments already loaded (no reads, hidden ones left out). Basic: the report, the status changes, a neighbour's question with no answer after it and the last messages. On the device: `Summarizer` (key points).
- **Redactar a partir de unos puntos**, in **Comunicados**: the title and description from a few lines and a tone (informativo, urgente, recordatorio), to review before sending. Basic: a polite template with the points. On the device: `Writer`, discarded if it adds, changes or leaves out a figure.
- **Mejorar redacción**, on the acta while it can be edited: only shown when the browser has `Rewriter`. Line by line, a line whose new version changes a figure or drops a name stays as it was, and the page says how many; **Deshacer** brings back the text. Nothing is saved until **Guardar acta**.

```text
nothing stored: no collection, field or rule
```

- **The browser's APIs**: Chrome's built-in Summarizer, Writer, Rewriter and Prompt API (`LanguageModel`), asked for Spanish. Each is detected before use and any failure falls back to the basic version. The first click that needs one downloads its files to the device (a few GB, once) and shows the progress; suggestions while typing or opening an issue only use what's already downloaded.
- **Setup**: none for the basic version. Where Chrome doesn't offer an API to every site yet, it needs that API's origin trial token (free, from Chrome's origin trials page) as a `<meta http-equiv="origin-trial">` in each app's `index.html`, or its flag in `chrome://flags`; without it the pages use **Básico**.
- **Cost**: nothing paid and no network calls, so there's no test mode.

### Correo saliente

The free plan has no server to send email from, so the admin queues each one in Firestore in the shape of Firebase's official **Trigger Email from Firestore** extension (`firebase/firestore-send-email`): installing it later sends them, with no change to the code. Until then (`VITE_MAIL_MODE` `demo`, the default) nothing is sent: the actions say **Modo de prueba: no se envía, queda en el correo saliente**, and the admin's **Correo** page lists them.

Every email is queued in the same batch as the action it comes from, by `queueMail()` in `apps/admin/src/modules/mail/application/mail.ts`, where its templates are too:

- **Invitations** (Vecinos y gestores, Administradores): **Enviar invitación por email**, with the link to the webapp (`VITE_WEBAPP_URL`) for neighbours or to the admin (its own address) for everyone else. Pending ones have **Reenviar invitación por email**, which queues the same email again.
- **Juntas**: **Notificar convocatoria** and **Notificar a los propietarios** also email each owner with an email in the census: the date, place and agenda, or the sealed acta's text and, for absent owners, their 30 days to dissent. Those with an account get a button to the meeting in the webapp.
- **Partes de trabajo**: creating the link emails it to the provider when the directory has their email. Replies go to the community's Administración contact.
- **Reclamaciones**: **Enviar por email** queues the letter and records the claim (once sending is on it can't be undone from the toast, the email is out; in demo mode it can); **Abrir en mi correo** keeps the `mailto`.

In demo mode the toasts say so too (for example **Parte creado; el email queda en el correo saliente (modo de prueba)**), and the outbox shows the extension's delivery state in Spanish (Pendiente, Enviando, Reintentando, Entregado, Error).

```text
mail/{id}   to[], cc[]?, bcc[]?, replyTo?, message { subject, text, html }   the extension's fields
            communityId ('' for the team's), kind invitation | meeting-call | meeting-minutes | work-order | claim,
            mode demo | extension, link (the admin page it comes from), createdAt, createdBy
            delivery { state PENDING | PROCESSING | RETRY | SUCCESS | ERROR, attempts, error, endTime, info }, by the extension
```

- **The email**: `renderMail()` in `packages/shared/domain/mail.ts` makes the HTML (inline styles and layout tables, which mail clients render, `lang="es"`, the gobernança name, a heading, paragraphs and lists, one button with its link also written out, the community in the footer) and its plain text version. Census and directory addresses that don't look like one are skipped, as one would fail the whole batch. Replies go to whoever sent it, unless the action gives another address.
- **Rules**: created only by whoever manages its `communityId` (the team's, `''`, by the team), with only those fields, 1 to 50 addresses in all, one `x@y` without spaces per entry, `replyTo` up to 254 characters, a subject up to 300, text up to 200 000 and HTML up to 400 000 characters, `createdBy` the caller and `createdAt` the server's time. Read by whoever manages the community. Nobody changes or removes them from the apps: only the extension writes `delivery`, with admin rights that skip the rules.
- **Reads**: the page reads 25 at a time, once (no listener), with **Cargar más**: all for the team, `communityId in` the user's communities otherwise (picking them one at a time past 30, Firestore's limit for `in`), or `communityId ==` the one picked. Ids start with the time reversed (`mailId()`), so by id is newest first and these filters need no composite index. Each one shows its status (Prueba, or Pendiente, Enviado and Error from `delivery.state`), the delivery details and a preview in a sandboxed iframe (no scripts, its links open in a new tab). Notifying a meeting reads the community once and, for the acta, its text once; the notices then go in batches of up to 240 owners and about 8 MB, as each email can carry a long acta.
- **Test mode**: `mode` keeps how it was queued, so the ones from demo mode show **Prueba** for good. The extension only acts on documents written while it's installed, so it never sends those; install it and switch `VITE_MAIL_MODE` together, as from then on it sends every new one whatever its mode.

To send them for real (the extension runs on Cloud Functions, which need the Blaze plan, and an SMTP provider):

1. Pick an SMTP provider (Brevo, Mailgun, Amazon SES, SendGrid…) and verify the sending domain there, adding its SPF, DKIM and DMARC records at the domain's DNS, or the emails land in spam.
2. **Firebase console → Upgrade** the project to Blaze, with a budget alert.
3. **Firebase console → Extensions → Trigger Email from Firestore → Install** (or `npx firebase ext:install firebase/firestore-send-email --project dmoyadev-gobernansa`):
   - Email documents collection: `mail`
   - SMTP connection URI: the provider's, e.g. `smtps://<user>@smtp-relay.brevo.com:465`, and its password (kept in Secret Manager)
   - Default FROM address: e.g. `gobernança <no-reply@gobernansa.dmoya.dev>`, on the verified domain. Default REPLY-TO: empty, each email brings its own
   - Users and templates collections: empty
4. Set `VITE_MAIL_MODE='extension'` in `.env.local` and, for the deploy, as the GitHub secret `VITE_MAIL_MODE`, which both workflows in `.github/workflows` pass to the build (section 4), and deploy. The actions then stop saying it's a test, and the page shows each one's delivery.

Before turning it on, keep in mind the rules can't limit what an email says nor how many are queued: any manager of a community can queue their own HTML to up to 50 addresses per email, which would then go out from the project's domain. Rules can't rate limit, so if that's a concern, a Cloud Function that renders the templates from the `kind` and the ids (instead of trusting the stored HTML) closes it once the paid plan is on.
