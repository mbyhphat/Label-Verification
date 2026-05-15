# PII Verification Scripts

Admin-only local scripts for moving data between local JSON files and the Supabase database.

These scripts may use Supabase service role / secret keys. Never run them in browser code and never commit secrets.

## Import Dataset

`import_dataset.py` implements Phase 3 of the deployment guide. It imports three local JSON files into the database schema:

- output dataset JSON, for example `verify_entity/output/1/result1_train_verified.json`
- audit results JSON, for example `verify_entity/banking_account_number/data/1/results (1).json`
- export/context JSON, for example `verify_entity/banking_account_number/data/1/export__ACCOUNT_NUMBER__en__gt.json`

The script creates:

- one shared `datasets` row per output/source file,
- one `review_samples` row per output sample, inserted only when the shared source dataset is first created,
- one `review_items` row per audit result, with `entity_type` stored on each item.

This means importing several classes from the same `output-json` reuses the same `review_samples` rows instead of copying the full sample file once per class.

Run a local validation first:

```bash
python3 pii_verification/scripts/import_dataset.py \
  --output-json verify_entity/output/1/result1_train_verified.json \
  --audit-json 'verify_entity/banking_account_number/data/1/results (1).json' \
  --export-json verify_entity/banking_account_number/data/1/export__ACCOUNT_NUMBER__en__gt.json \
  --folder 1 \
  --dry-run
```

Run the real import:

```bash
export SUPABASE_URL='https://<project-ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<service-role-or-secret-key>'

python3 pii_verification/scripts/import_dataset.py \
  --output-json verify_entity/output/1/result1_train_verified.json \
  --audit-json 'verify_entity/banking_account_number/data/1/results (1).json' \
  --export-json verify_entity/banking_account_number/data/1/export__ACCOUNT_NUMBER__en__gt.json \
  --folder 1 \
  --project-slug pii-verification
```

## Importing More Data Later

### Add another source dataset

Use this when you have a different output/source file, a different folder, or a different sample key prefix. The script will create a new shared dataset and insert that source file's `review_samples`.

```bash
python3 pii_verification/scripts/import_dataset.py \
  --output-json verify_entity/output/2/result2_train_verified.json \
  --audit-json 'verify_entity/email/data/2/results.json' \
  --export-json verify_entity/email/data/2/export__EMAIL__en__gt.json \
  --folder 2 \
  --project-slug pii-verification
```

Expected result:

```text
Dataset action: created
Inserted review_samples: <output sample count>
Inserted review_items: <audit result count>
```

### Add another class to the same source dataset

Use the same `--output-json`, `--folder`, and inferred or explicit `--sample-key-prefix`, then point `--audit-json` and `--export-json` at another class. The script will reuse the existing source dataset and only insert new `review_items`.

```bash
python3 pii_verification/scripts/import_dataset.py \
  --output-json verify_entity/output/1/result1_train_verified.json \
  --audit-json 'verify_entity/email/data/1/results.json' \
  --export-json verify_entity/email/data/1/export__EMAIL__en__gt.json \
  --folder 1 \
  --project-slug pii-verification
```

Expected result:

```text
Dataset action: reused
Loaded review_samples: <existing output sample count>
Inserted review_items: <audit result count>
```

If the same source dataset already exists and you want to re-import one class:

```bash
python3 pii_verification/scripts/import_dataset.py \
  --output-json verify_entity/output/1/result1_train_verified.json \
  --audit-json 'verify_entity/banking_account_number/data/1/results (1).json' \
  --export-json verify_entity/banking_account_number/data/1/export__ACCOUNT_NUMBER__en__gt.json \
  --folder 1 \
  --project-slug pii-verification \
  --replace
```

`--replace` deletes existing `review_items` for the imported entity type and keeps the shared source dataset plus its `review_samples` rows.

## Required Supabase Setup

Before running a real import:

1. Run `pii_verification/database/001_schema.sql`.
2. Run `pii_verification/database/002_rls_policies.sql`.
3. Run `pii_verification/database/003_rpc_functions.sql`.
4. Run `pii_verification/database/004_realtime.sql`.
5. Create your first Auth user.
6. Run `pii_verification/database/005_seed_project.sql` after replacing `<your-auth-user-id>`.
7. If you already ran the older database schema before shared multi-entity datasets were added, run `pii_verification/database/006_multi_entity_datasets.sql` once.

## Useful Options

- `--dry-run`: parse and validate JSON locally without calling Supabase.
- `--replace`: delete and re-import review items for the current entity type within the shared source dataset.
- `--project-id`: use a known `labeling_projects.id` directly.
- `--project-slug`: find project by slug. Defaults to `pii-verification`.
- `--entity-type`: override entity type if it cannot be inferred from export JSON.
- `--language`: override language if it cannot be inferred from export/output JSON.
- `--sample-key-prefix`: override sample key prefix, for example `en/result1_train_verified`.
- `--env-file`: load a dotenv-style file before reading environment variables.
- `--batch-size`: default `500`.
