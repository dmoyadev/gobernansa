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
- `--reset` deletes documents before inserting
- `--only` limits which collections are processed

## ⚠️ Limitations

- Deletion uses batches (max 500 documents)
  - If you want to reset the entire database:
    ```bash
    firebase firestore:delete --all-collections
    ```
- Does not handle subcollections (if any exist, they will remain orphaned)
- No data validation (it may insert inconsistent data if the script contains errors)
```