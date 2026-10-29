# Fixtures

`esci-grocery.jsonl` is a small slice of Amazon's Shopping Queries Dataset (ESCI), used to measure product ranking offline.

- Source: <https://github.com/amazon-science/esci-data> (Apache-2.0), read through the Hugging Face mirror `tasksource/esci` (test split, `us` locale).
- Citation: Reddy et al., "Shopping Queries Dataset: A Large-Scale ESCI Benchmark for Improving Product Search", 2022.
- Selection: grocery and food-like queries (keyword filter over queries and product titles), 120 queries with 8 to 20 labeled products each. Every query has at least one Exact product and at least two different labels. Seeded. The committed file is the exact slice behind every reported number; `build-esci.py` is the same recipe but its word lists were tidied after the slice was cut, so a rebuild overlaps about 70% of the queries rather than matching byte for byte.
- Labels: `E` exact, `S` substitute, `C` complement, `I` irrelevant. Labels are Amazon's human judgments and are noisy.
- Splits: 48 `practice` queries (used to tune the Jev criteria) and 72 `test` queries (never used for tuning).

Rebuild: download the `test-*.parquet` shards of `tasksource/esci` into a folder, then run `python3 -I build-esci.py <folder> esci-grocery.jsonl` (needs `pyarrow`).
