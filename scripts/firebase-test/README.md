```md
# Firebase Firestore Seed Script

Script to populate the Firestore database with test data.

## 🔑 Configuration

1. Go to Firebase Console
2. Project Settings → Service Accounts
3. Generate private key
4. Save as `serviceAccountKey.local.json`

## ▶️ Usage

### Normal Seed (without deleting existing data)

```bash
$ node seed.js
```

### Reset + Complete Seed

Deletes the collections and recreates them:

```bash
node seed.js --reset
```

### Partial Seed

Only processes certain collections:

```bash
node seed.js --only=users
```
```bash
node seed.js --only=properties
```
```bash
node seed.js --only=communities,users
```

### Partial Reset

Deletes and recreates only certain collections:

```bash
node seed.js --reset --only=users
```

## 🧠 Behavior

- `set()` overwrites existing documents
- `--reset` deletes documents (and their subcollections) before inserting. Resetting `communities` also deletes their issues
- `--only` limits which collections are processed

## ⚠️ Limitations

- It writes to the project of `serviceAccountKey.local.json`, and every reset or seed counts against the free plan's daily quota. To run it against the local emulator instead:
    ```bash
    npm run seed-firebase:emulators
    ```
- No data validation (it may insert inconsistent data if the script contains errors)
```
