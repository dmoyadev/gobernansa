# Firebase and Cloudinary setup

What the live project needs for every feature to work. Nothing here is deployed by `firebase deploy` or CI.

## 1. Security rules

[`firestore.rules`](./firestore.rules) covers everything the app reads and writes. It was tested against the local emulator with every flow (as a neighbour and as a manager), and it blocks a neighbour from changing an issue's status, inflating votes, removing other people's issues, posting as someone else or as the administration, and reading other users' data.

Compare it with the live rules and paste it in **Firebase console → Firestore → Rules**. Each rule that checks the user's community or role reads their profile once per request, which counts as one extra read.

To try it locally, point `firebase.json` to it **only while testing** (it would also deploy it):

```text
"firestore": { "rules": "docs/firestore.rules" }
```

## 2. Indexes

The first time each of these queries runs, Firestore logs an error in the browser console with a link that creates the index:

| Feature | Index |
| --- | --- |
| Votes given, on the home page | Single field `voterId` on the `votes` **collection group** (Firestore → Indexes → Single field → Add exemption, scope "Collection group") |
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

## Community data

Set from the console on `communities/{communityId}`, the app only reads it:

```text
cif, iban, bank
contacts[]     { type: admin | president | janitor | insurance | elevator | cleaning | gardening | other,
                 name, phone?, whatsapp?, email?,
                 schedule?: [{ days: [1..7], from: 'HH:MM', to: 'HH:MM' }] }
documents[]    { type: statutes | regulations | insurance | minutes, title, url, date }
```

`schedule` works for any contact (e.g. the janitor's shifts): days are ISO weekdays (1 is Monday, 7 is Sunday) and times are 24 hour and zero padded. Add one entry per shift, e.g. `{ days: [1, 2, 3, 4, 5], from: '08:00', to: '15:00' }` and `{ days: [6], from: '09:00', to: '13:00' }`. The contact then shows its hours and whether it's available now.

## Data the app writes

```text
communities/{communityId}/issues/{issueId}
  votesScore, votesCount, commentsCount   counters, written along with each vote or comment
  votes/{issueId}_{uid}                   { voterId, score: 1 | -1 }
  comments/{commentId}                    { type: message | status, message, status?, authorId, authorName, authorRole? }
users/{uid}/documents/{id}                property documents (listing)
users/{uid}/documentFiles/{id}            their content, up to 1 MB each
users/{uid}/devices/{token}               devices with push notifications on
```
