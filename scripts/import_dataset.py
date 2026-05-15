#!/usr/bin/env python3
"""
Import local verifier JSON files into the Supabase-backed PII verification schema.

One output/source dataset can hold review items for many entity types. The full
sample file is imported once, then class-specific audit/export files append
review_items into the shared dataset.

This script is intentionally dependency-free: it uses Supabase's REST API through
Python stdlib urllib so it can run in this repo without installing another SDK.

Run with --dry-run first. For real imports, use a service role / secret key from
Supabase. Never expose that key in frontend code or public deployment settings.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


JsonObject = dict[str, Any]


class ImportErrorWithHint(RuntimeError):
    pass


class SupabaseRestError(RuntimeError):
    def __init__(self, method: str, path: str, status: int, body: str):
        self.method = method
        self.path = path
        self.status = status
        self.body = body
        super().__init__(f"{method} {path} failed with HTTP {status}: {body}")


class SupabaseRestClient:
    def __init__(self, supabase_url: str, service_key: str):
        self.base_url = supabase_url.rstrip("/") + "/rest/v1"
        self.service_key = service_key

    def select(self, table: str, query: dict[str, str]) -> list[JsonObject]:
        result = self._request("GET", table, query=query)
        if not isinstance(result, list):
            raise ImportErrorWithHint(f"Expected list response when selecting {table}")
        return result

    def insert(
        self,
        table: str,
        rows: JsonObject | list[JsonObject],
        *,
        return_representation: bool,
    ) -> list[JsonObject]:
        prefer = "return=representation" if return_representation else "return=minimal"
        result = self._request("POST", table, body=rows, prefer=prefer)
        if return_representation:
            if not isinstance(result, list):
                raise ImportErrorWithHint(f"Expected list response when inserting {table}")
            return result
        return []

    def delete(self, table: str, query: dict[str, str]) -> None:
        self._request("DELETE", table, query=query, prefer="return=minimal")

    def _request(
        self,
        method: str,
        table: str,
        *,
        query: dict[str, str] | None = None,
        body: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        url = f"{self.base_url}/{table}"
        if query:
            url += "?" + urllib.parse.urlencode(query)

        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer

        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"

        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read().decode("utf-8")
                if not raw:
                    return None
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise SupabaseRestError(method, table, exc.code, raw) from exc
        except urllib.error.URLError as exc:
            raise ImportErrorWithHint(f"Could not reach Supabase REST API: {exc}") from exc


@dataclass(frozen=True)
class ImportInputs:
    output_path: Path
    audit_path: Path
    export_path: Path
    project_id: str | None
    project_slug: str | None
    folder: str
    entity_type: str | None
    language: str | None
    sample_key_prefix: str | None
    created_by: str | None
    batch_size: int


@dataclass
class ImportPlan:
    dataset_payload: JsonObject
    entity_type: str
    output_samples: list[JsonObject]
    audit_results: list[JsonObject]
    export_spans: list[JsonObject]
    sample_key_prefix: str
    warnings: list[str]


SAMPLE_REF_RE = re.compile(r"^(?P<prefix>.+)#(?P<index>\d+)$")
VALID_VERDICTS = {"CORRECT", "WRONG_LABEL", "UNREALISTIC_VALUE"}
SOURCE_DATASET_ENTITY_TYPE = "MULTI_ENTITY"


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)

    inputs = ImportInputs(
        output_path=args.output_json,
        audit_path=args.audit_json,
        export_path=args.export_json,
        project_id=args.project_id,
        project_slug=args.project_slug,
        folder=args.folder or infer_folder(args.output_json),
        entity_type=args.entity_type,
        language=args.language,
        sample_key_prefix=args.sample_key_prefix,
        created_by=args.created_by,
        batch_size=args.batch_size,
    )

    try:
        plan = build_import_plan(inputs)
        print_plan(plan, inputs, dry_run=args.dry_run)

        if args.dry_run:
            return 0

        supabase_url = args.supabase_url or os.getenv("SUPABASE_URL")
        service_key = (
            args.service_role_key
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SECRET_KEY")
        )
        if not supabase_url:
            raise ImportErrorWithHint("Missing --supabase-url or SUPABASE_URL")
        if not service_key:
            raise ImportErrorWithHint(
                "Missing --service-role-key, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_SECRET_KEY"
            )

        client = SupabaseRestClient(supabase_url, service_key)
        project_id = resolve_project_id(client, inputs.project_id, inputs.project_slug)
        dataset_id, dataset_created = get_or_create_dataset(
            client, project_id, plan, inputs, replace=args.replace
        )
        if dataset_created:
            sample_rows = build_sample_rows(
                plan.output_samples,
                dataset_id=dataset_id,
                fallback_language=plan.dataset_payload["language"],
                sample_key_prefix=plan.sample_key_prefix,
            )
            sample_rows_for_lookup = insert_batches(
                client,
                "review_samples",
                sample_rows,
                inputs.batch_size,
                return_representation=True,
            )
        else:
            sample_rows_for_lookup = load_dataset_samples(client, dataset_id, inputs.batch_size)

        sample_lookup = build_sample_lookup(sample_rows_for_lookup)
        review_rows, review_warnings = build_review_rows(
            plan.audit_results,
            plan.export_spans,
            dataset_id=dataset_id,
            entity_type=plan.entity_type,
            sample_lookup=sample_lookup,
        )
        review_rows, dedupe_warnings = dedupe_review_rows(review_rows)
        review_warnings.extend(dedupe_warnings)
        insert_batches(
            client,
            "review_items",
            review_rows,
            inputs.batch_size,
            return_representation=False,
        )

        print(f"Imported dataset id: {dataset_id}")
        print(f"Dataset action: {'created' if dataset_created else 'reused'}")
        print(
            f"{'Inserted' if dataset_created else 'Loaded'} review_samples: "
            f"{len(sample_rows_for_lookup)}"
        )
        print(f"Inserted review_items: {len(review_rows)}")
        if review_warnings:
            print("\nWarnings:")
            for warning in review_warnings:
                print(f"- {warning}")
        return 0
    except (ImportErrorWithHint, SupabaseRestError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import verifier output/audit/export JSON files into Supabase."
    )
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--audit-json", type=Path, required=True)
    parser.add_argument("--export-json", type=Path, required=True)
    parser.add_argument("--folder", help="Dataset folder/batch id. Defaults to output file parent folder name.")
    parser.add_argument("--entity-type", help="Override entity type. Defaults to export JSON 'type'.")
    parser.add_argument("--language", help="Override language. Defaults to export JSON 'language'.")
    parser.add_argument("--sample-key-prefix", help="Override sample key prefix, e.g. en/result1_train_verified.")
    parser.add_argument("--project-id", help="Supabase labeling_projects.id. Skips slug lookup.")
    parser.add_argument("--project-slug", default="pii-verification", help="Project slug to look up when project id is not provided.")
    parser.add_argument("--created-by", help="Optional Supabase Auth user UUID stored on datasets.created_by.")
    parser.add_argument("--supabase-url", help="Defaults to SUPABASE_URL.")
    parser.add_argument("--service-role-key", help="Defaults to SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.")
    parser.add_argument("--env-file", type=Path, help="Optional dotenv-style file to load before env lookup.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--replace", action="store_true", help="Delete existing review items for this entity type before importing into the shared source dataset.")
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate locally without calling Supabase.")
    return parser.parse_args()


def load_env_file(path: Path | None) -> None:
    if not path:
        return
    if not path.exists():
        raise ImportErrorWithHint(f"Env file not found: {path}")

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def infer_folder(output_path: Path) -> str:
    parent = output_path.parent.name
    return parent or "default"


def build_import_plan(inputs: ImportInputs) -> ImportPlan:
    output_json = load_json(inputs.output_path)
    audit_json = load_json(inputs.audit_path)
    export_json = load_json(inputs.export_path)

    output_samples = normalize_output_samples(output_json)
    audit_results = normalize_audit_results(audit_json)
    export_spans = normalize_export_spans(export_json)

    language = inputs.language or export_json.get("language")
    if not language:
        language = first_nonempty([sample.get("language") for sample in output_samples])
    if not language:
        raise ImportErrorWithHint("Could not infer language. Pass --language.")

    entity_type = inputs.entity_type or export_json.get("type")
    if not entity_type:
        entity_type = infer_entity_type_from_export_name(inputs.export_path.name)
    if not entity_type:
        raise ImportErrorWithHint("Could not infer entity type. Pass --entity-type.")

    sample_key_prefix = inputs.sample_key_prefix or infer_sample_key_prefix(
        audit_results, export_spans, language, inputs.output_path.stem
    )

    dataset_payload: JsonObject = {
        "source_key": sample_key_prefix,
        "entity_type": SOURCE_DATASET_ENTITY_TYPE,
        "language": language,
        "folder": inputs.folder,
        "metadata": {
            "source_files": {
                "output": inputs.output_path.name,
            },
            "source_paths": {
                "output": str(inputs.output_path),
            },
            "initial_import": {
                "entity_type": entity_type,
                "audit_file": inputs.audit_path.name,
                "export_file": inputs.export_path.name,
                "audit_path": str(inputs.audit_path),
                "export_path": str(inputs.export_path),
            },
            "import": {
                "source": "pii_verification/scripts/import_dataset.py",
                "source_key": sample_key_prefix,
                "counts": {
                    "output_samples": len(output_samples),
                },
            },
            "latest_entity_import": {
                "entity_type": entity_type,
                "audit": str(inputs.audit_path),
                "export": str(inputs.export_path),
                "counts": {
                    "audit_results": len(audit_results),
                    "export_spans": len(export_spans),
                },
                "export_summary": {
                    "total_occurrences": (export_json.get(language) or {}).get("total_occurrences"),
                    "unique_count": (export_json.get(language) or {}).get("unique_count"),
                },
            },
        },
    }
    if inputs.created_by:
        dataset_payload["created_by"] = inputs.created_by

    warnings = validate_plan(output_samples, audit_results, export_spans, sample_key_prefix)
    return ImportPlan(
        dataset_payload=dataset_payload,
        entity_type=entity_type,
        output_samples=output_samples,
        audit_results=audit_results,
        export_spans=export_spans,
        sample_key_prefix=sample_key_prefix,
        warnings=warnings,
    )


def load_json(path: Path) -> Any:
    if not path.exists():
        raise ImportErrorWithHint(f"JSON file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_output_samples(payload: Any) -> list[JsonObject]:
    if isinstance(payload, list):
        samples = payload
    elif isinstance(payload, dict) and isinstance(payload.get("samples"), list):
        samples = payload["samples"]
    elif isinstance(payload, dict) and isinstance(payload.get("data"), list):
        samples = payload["data"]
    else:
        raise ImportErrorWithHint("Output JSON must be a list or contain a samples/data list.")

    normalized = []
    for idx, sample in enumerate(samples):
        if not isinstance(sample, dict):
            raise ImportErrorWithHint(f"Output sample at index {idx} is not an object.")
        if not isinstance(sample.get("source_text"), str):
            raise ImportErrorWithHint(f"Output sample at index {idx} is missing source_text.")
        privacy_mask = sample.get("privacy_mask", [])
        if not isinstance(privacy_mask, list):
            raise ImportErrorWithHint(f"Output sample at index {idx} has non-list privacy_mask.")
        normalized.append(sample)
    return normalized


def normalize_audit_results(payload: Any) -> list[JsonObject]:
    if isinstance(payload, list):
        results = payload
    elif isinstance(payload, dict) and isinstance(payload.get("results"), list):
        results = payload["results"]
    else:
        raise ImportErrorWithHint("Audit JSON must be a list or contain a results list.")

    normalized = []
    for idx, item in enumerate(results):
        if not isinstance(item, dict):
            raise ImportErrorWithHint(f"Audit result at index {idx} is not an object.")
        if not item.get("sample_id"):
            raise ImportErrorWithHint(f"Audit result at index {idx} is missing sample_id.")
        if "value" not in item:
            raise ImportErrorWithHint(f"Audit result at index {idx} is missing value.")
        verdict = item.get("verdict")
        if verdict not in VALID_VERDICTS:
            raise ImportErrorWithHint(
                f"Audit result at index {idx} has invalid verdict {verdict!r}."
            )
        normalized.append(item)
    return normalized


def normalize_export_spans(payload: Any) -> list[JsonObject]:
    spans = payload.get("samples") if isinstance(payload, dict) else None
    if spans is None:
        return []
    if not isinstance(spans, list):
        raise ImportErrorWithHint("Export JSON 'samples' must be a list.")
    return [span for span in spans if isinstance(span, dict)]


def first_nonempty(values: list[Any]) -> str | None:
    for value in values:
        if value:
            return str(value)
    return None


def infer_entity_type_from_export_name(filename: str) -> str | None:
    match = re.match(r"^export__(?P<entity>.+?)__", filename)
    return match.group("entity") if match else None


def infer_sample_key_prefix(
    audit_results: list[JsonObject],
    export_spans: list[JsonObject],
    language: str,
    output_stem: str,
) -> str:
    prefixes = []
    for row in [*audit_results, *export_spans]:
        ref = parse_sample_ref(str(row.get("sample_id") or ""))
        if ref:
            prefixes.append(ref[0])

    if prefixes:
        most_common = Counter(prefixes).most_common(1)[0][0]
        return most_common
    return f"{language}/{output_stem}"


def parse_sample_ref(sample_id: str) -> tuple[str, int] | None:
    match = SAMPLE_REF_RE.match(sample_id)
    if not match:
        return None
    return match.group("prefix"), int(match.group("index"))


def validate_plan(
    output_samples: list[JsonObject],
    audit_results: list[JsonObject],
    export_spans: list[JsonObject],
    sample_key_prefix: str,
) -> list[str]:
    warnings = []
    output_count = len(output_samples)

    bad_refs = []
    for item in audit_results:
        ref = parse_sample_ref(str(item.get("sample_id") or ""))
        if not ref:
            bad_refs.append(str(item.get("sample_id")))
            continue
        if ref[1] < 0 or ref[1] >= output_count:
            bad_refs.append(str(item.get("sample_id")))
    if bad_refs:
        preview = ", ".join(bad_refs[:5])
        warnings.append(
            f"{len(bad_refs)} audit results reference missing output sample indexes. Examples: {preview}"
        )

    inferred_prefixes = {
        ref[0]
        for ref in (parse_sample_ref(str(item.get("sample_id") or "")) for item in audit_results)
        if ref
    }
    if inferred_prefixes and sample_key_prefix not in inferred_prefixes:
        warnings.append(
            "Chosen sample key prefix does not appear in audit sample_id prefixes; "
            "index fallback will be used."
        )

    if not export_spans:
        warnings.append("Export JSON has no samples array; review item offsets/context will be empty.")
    else:
        span_lookup = build_span_lookup(export_spans)
        span_usage: dict[tuple[str, tuple[Any, ...]], int] = defaultdict(int)
        seen_items = set()
        duplicate_examples = []
        for item in audit_results:
            sample_id = str(item.get("sample_id") or "")
            span = find_matching_span(item, span_lookup, span_usage) or {}
            key = (
                sample_id,
                comparable_id(item.get("id")),
                item.get("value"),
                pick_first_int(span.get("start"), item.get("start")),
                pick_first_int(span.get("end"), item.get("end")),
            )
            if key in seen_items:
                duplicate_examples.append(f"{sample_id} value={item.get('value')!r}")
                continue
            seen_items.add(key)
        if duplicate_examples:
            preview = ", ".join(duplicate_examples[:5])
            warnings.append(
                f"{len(duplicate_examples)} duplicate audit rows share the same "
                f"sample/id/value/offset and will be skipped on import. Examples: {preview}"
            )

    return warnings


def resolve_project_id(
    client: SupabaseRestClient,
    project_id: str | None,
    project_slug: str | None,
) -> str:
    if project_id:
        return project_id
    if not project_slug:
        raise ImportErrorWithHint("Pass --project-id or --project-slug.")

    rows = client.select(
        "labeling_projects",
        {"select": "id,slug,name", "slug": f"eq.{project_slug}"},
    )
    if not rows:
        raise ImportErrorWithHint(
            f"No project found for slug {project_slug!r}. Run 005_seed_project.sql first."
        )
    if len(rows) > 1:
        raise ImportErrorWithHint(f"Multiple projects found for slug {project_slug!r}.")
    return str(rows[0]["id"])


def get_or_create_dataset(
    client: SupabaseRestClient,
    project_id: str,
    plan: ImportPlan,
    inputs: ImportInputs,
    *,
    replace: bool,
) -> tuple[str, bool]:
    existing = client.select(
        "datasets",
        {
            "select": "id,source_key,language,folder",
            "project_id": f"eq.{project_id}",
            "language": f"eq.{plan.dataset_payload['language']}",
            "folder": f"eq.{inputs.folder}",
            "source_key": f"eq.{plan.dataset_payload['source_key']}",
        },
    )
    if len(existing) > 1:
        raise ImportErrorWithHint(
            "Multiple source datasets matched the same project/language/folder/source_key."
        )
    if existing:
        dataset_id = str(existing[0]["id"])
        existing_items = client.select(
            "review_items",
            {
                "select": "id",
                "dataset_id": f"eq.{dataset_id}",
                "entity_type": f"eq.{plan.entity_type}",
                "limit": "1",
            },
        )
        if existing_items and not replace:
            raise ImportErrorWithHint(
                f"Review items for entity type {plan.entity_type!r} already exist in "
                "this source dataset. Re-run with --replace to delete and re-import "
                "that entity type."
            )
        if replace:
            client.delete(
                "review_items",
                {"dataset_id": f"eq.{dataset_id}", "entity_type": f"eq.{plan.entity_type}"},
            )
        return dataset_id, False

    dataset_payload = dict(plan.dataset_payload)
    dataset_payload["project_id"] = project_id
    inserted = client.insert("datasets", dataset_payload, return_representation=True)
    if not inserted:
        raise ImportErrorWithHint("Dataset insert returned no rows.")
    return str(inserted[0]["id"]), True


def load_dataset_samples(
    client: SupabaseRestClient,
    dataset_id: str,
    batch_size: int,
) -> list[JsonObject]:
    rows = []
    offset = 0
    page_size = max(batch_size, 1)
    while True:
        page = client.select(
            "review_samples",
            {
                "select": "*",
                "dataset_id": f"eq.{dataset_id}",
                "order": "sample_index.asc",
                "limit": str(page_size),
                "offset": str(offset),
            },
        )
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size

    if not rows:
        raise ImportErrorWithHint(
            "Source dataset already exists but has no review_samples. "
            "Use --replace only after confirming the source dataset is safe to reset."
        )
    return rows


def build_sample_rows(
    output_samples: list[JsonObject],
    *,
    dataset_id: str,
    fallback_language: str,
    sample_key_prefix: str,
) -> list[JsonObject]:
    rows = []
    for idx, sample in enumerate(output_samples):
        language = sample.get("language") or fallback_language
        rows.append(
            {
                "dataset_id": dataset_id,
                "sample_index": idx,
                "sample_key": f"{sample_key_prefix}#{idx}",
                "language": language,
                "original_source_text": sample["source_text"],
                "current_source_text": sample["source_text"],
                "original_privacy_mask": sample.get("privacy_mask", []),
                "current_privacy_mask": sample.get("privacy_mask", []),
                "raw_output": sample,
            }
        )
    return rows


def build_sample_lookup(sample_rows: list[JsonObject]) -> dict[str, dict[Any, JsonObject]]:
    by_key = {}
    by_index = {}
    for row in sample_rows:
        by_key[row["sample_key"]] = row
        by_index[row["sample_index"]] = row
    return {"by_key": by_key, "by_index": by_index}


def build_review_rows(
    audit_results: list[JsonObject],
    export_spans: list[JsonObject],
    *,
    dataset_id: str,
    entity_type: str,
    sample_lookup: dict[str, dict[Any, JsonObject]],
) -> tuple[list[JsonObject], list[str]]:
    span_lookup = build_span_lookup(export_spans)
    span_usage: dict[tuple[str, tuple[Any, ...]], int] = defaultdict(int)
    warnings = []
    missing_spans = 0
    review_rows = []

    for idx, item in enumerate(audit_results):
        sample = resolve_sample_for_item(item, sample_lookup)
        if sample is None:
            raise ImportErrorWithHint(
                f"Audit result at index {idx} references missing sample_id {item.get('sample_id')!r}."
            )

        span = find_matching_span(item, span_lookup, span_usage)
        if not span:
            missing_spans += 1
            span = {}

        review_rows.append(
            {
                "dataset_id": dataset_id,
                "sample_row_id": sample["id"],
                "sample_key": sample["sample_key"],
                "entity_type": entity_type,
                "audit_record_id": int_or_none(item.get("id")),
                "value": str(item["value"]),
                "start_offset": pick_first_int(span.get("start"), item.get("start")),
                "end_offset": pick_first_int(span.get("end"), item.get("end")),
                "verdict": item["verdict"],
                "reason": item.get("reason"),
                "suggested_label": item.get("suggested_label"),
                "replacement_value": item.get("replacement_value"),
                "raw_audit": item,
                "raw_export_span": span,
            }
        )

    if missing_spans:
        warnings.append(f"{missing_spans} review items had no matching export span.")
    return review_rows, warnings


def build_span_lookup(export_spans: list[JsonObject]) -> dict[str, dict[Any, list[JsonObject]]]:
    by_sample_id_id_value = defaultdict(list)
    by_id_value = defaultdict(list)
    by_sample_index_id_value = defaultdict(list)

    for span in export_spans:
        sample_id = str(span.get("sample_id") or "")
        audit_id = comparable_id(span.get("id"))
        value = span.get("value")
        by_sample_id_id_value[(sample_id, audit_id, value)].append(span)
        by_id_value[(audit_id, value)].append(span)

        ref = parse_sample_ref(sample_id)
        if ref:
            by_sample_index_id_value[(ref[1], audit_id, value)].append(span)

    for bucket in (by_sample_id_id_value, by_id_value, by_sample_index_id_value):
        for candidates in bucket.values():
            candidates.sort(key=span_sort_key)

    return {
        "by_sample_id_id_value": by_sample_id_id_value,
        "by_id_value": by_id_value,
        "by_sample_index_id_value": by_sample_index_id_value,
    }


def span_sort_key(span: JsonObject) -> tuple[int, int, int]:
    ref = parse_sample_ref(str(span.get("sample_id") or ""))
    sample_index = ref[1] if ref else sys.maxsize
    start = int_or_none(span.get("start"))
    end = int_or_none(span.get("end"))
    return (
        sample_index,
        start if start is not None else sys.maxsize,
        end if end is not None else sys.maxsize,
    )


def find_matching_span(
    item: JsonObject,
    span_lookup: dict[str, dict[Any, list[JsonObject]]],
    span_usage: dict[tuple[str, tuple[Any, ...]], int] | None = None,
) -> JsonObject | None:
    sample_id = str(item.get("sample_id") or "")
    audit_id = comparable_id(item.get("id"))
    value = item.get("value")

    key = (sample_id, audit_id, value)
    candidates = span_lookup["by_sample_id_id_value"].get(key)
    if candidates:
        return pick_matching_span(item, candidates, ("by_sample_id_id_value", key), span_usage)

    ref = parse_sample_ref(sample_id)
    if ref:
        key = (ref[1], audit_id, value)
        candidates = span_lookup["by_sample_index_id_value"].get(key)
        if candidates:
            return pick_matching_span(
                item,
                candidates,
                ("by_sample_index_id_value", key),
                span_usage,
            )

    key = (audit_id, value)
    candidates = span_lookup["by_id_value"].get(key)
    if candidates:
        return pick_matching_span(item, candidates, ("by_id_value", key), span_usage)

    return None


def pick_matching_span(
    item: JsonObject,
    candidates: list[JsonObject],
    usage_key: tuple[str, tuple[Any, ...]],
    span_usage: dict[tuple[str, tuple[Any, ...]], int] | None,
) -> JsonObject | None:
    item_start = int_or_none(item.get("start"))
    item_end = int_or_none(item.get("end"))
    if item_start is not None or item_end is not None:
        return find_span_by_offset(candidates, item_start, item_end)

    if span_usage is None:
        return candidates[0]

    index = span_usage[usage_key]
    span_usage[usage_key] += 1
    if index >= len(candidates):
        return None
    return candidates[index]


def find_span_by_offset(
    candidates: list[JsonObject], item_start: int | None, item_end: int | None
) -> JsonObject | None:
    for span in candidates:
        span_start = int_or_none(span.get("start"))
        span_end = int_or_none(span.get("end"))
        start_matches = item_start is None or item_start == span_start
        end_matches = item_end is None or item_end == span_end
        if start_matches and end_matches:
            return span
    return None


def resolve_sample_for_item(
    item: JsonObject, sample_lookup: dict[str, dict[Any, JsonObject]]
) -> JsonObject | None:
    sample_id = str(item.get("sample_id") or "")
    sample = sample_lookup["by_key"].get(sample_id)
    if sample:
        return sample

    ref = parse_sample_ref(sample_id)
    if ref:
        return sample_lookup["by_index"].get(ref[1])
    return None


def pick_first_int(*values: Any) -> int | None:
    for value in values:
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())
    return None


def int_or_none(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def comparable_id(value: Any) -> Any:
    as_int = int_or_none(value)
    return as_int if as_int is not None else value


def review_row_unique_key(row: JsonObject) -> tuple[Any, ...]:
    return (
        row["dataset_id"],
        row["entity_type"],
        row["sample_key"],
        row.get("audit_record_id"),
        row["value"],
        row.get("start_offset") if row.get("start_offset") is not None else -1,
        row.get("end_offset") if row.get("end_offset") is not None else -1,
    )


def dedupe_review_rows(rows: list[JsonObject]) -> tuple[list[JsonObject], list[str]]:
    seen = set()
    deduped = []
    duplicate_examples = []
    for row in rows:
        key = review_row_unique_key(row)
        if key in seen:
            duplicate_examples.append(
                f"{row['entity_type']} {row['sample_key']} value={row['value']!r}"
            )
            continue
        seen.add(key)
        deduped.append(row)

    if not duplicate_examples:
        return deduped, []

    preview = ", ".join(duplicate_examples[:5])
    return deduped, [
        (
            f"Skipped {len(duplicate_examples)} duplicate review items with the same "
            f"entity/sample/audit id/value/offset. Examples: {preview}"
        )
    ]


def insert_batches(
    client: SupabaseRestClient,
    table: str,
    rows: list[JsonObject],
    batch_size: int,
    *,
    return_representation: bool,
) -> list[JsonObject]:
    if batch_size < 1:
        raise ImportErrorWithHint("--batch-size must be >= 1")

    inserted = []
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        inserted.extend(
            client.insert(table, batch, return_representation=return_representation)
        )
        print(f"Inserted {table}: {min(start + len(batch), len(rows))}/{len(rows)}")
    return inserted


def print_plan(plan: ImportPlan, inputs: ImportInputs, *, dry_run: bool) -> None:
    print("Import plan")
    print("-----------")
    print(f"Mode: {'dry-run' if dry_run else 'import'}")
    print(f"Project: {inputs.project_id or inputs.project_slug}")
    print(f"Dataset source key: {plan.dataset_payload['source_key']}")
    print(f"Review entity_type: {plan.entity_type}")
    print(f"Dataset language: {plan.dataset_payload['language']}")
    print(f"Dataset folder: {plan.dataset_payload['folder']}")
    print(f"Sample key prefix: {plan.sample_key_prefix}")
    print(f"Output samples: {len(plan.output_samples)}")
    print(f"Audit results: {len(plan.audit_results)}")
    print(f"Export spans: {len(plan.export_spans)}")
    if plan.warnings:
        print("\nWarnings:")
        for warning in plan.warnings:
            print(f"- {warning}")
    print()


if __name__ == "__main__":
    raise SystemExit(main())
