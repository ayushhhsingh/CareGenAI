"""Dataset loading + SQLite persistence for CareGen AI.

The single source of truth for the catalogue is ../data/medicines.js. It is a
JavaScript file so the frontend can load it directly (even from file://) while
the backend parses the embedded JSON array out of it. That keeps one dataset
instead of two copies that can drift apart.
"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from core import composition_key, composition_label, unit_price

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = Path(os.environ.get("CAREGEN_DATA_FILE", BASE_DIR.parent / "data" / "medicines.js"))
DB_FILE = Path(os.environ.get("CAREGEN_DB_FILE", BASE_DIR / "caregen.db"))

SCHEMA = """
DROP TABLE IF EXISTS medicine_salts;
DROP TABLE IF EXISTS medicines;

CREATE TABLE medicines (
    id                TEXT PRIMARY KEY,
    brand             TEXT NOT NULL,
    manufacturer      TEXT,
    form              TEXT NOT NULL,
    pack_size         REAL NOT NULL,
    pack_unit         TEXT,
    mrp               REAL NOT NULL,
    unit_price        REAL NOT NULL,
    product_type      TEXT NOT NULL,
    rx_required       INTEGER NOT NULL DEFAULT 0,
    therapeutic_class TEXT,
    uses              TEXT,
    composition       TEXT NOT NULL,
    composition_key   TEXT NOT NULL,
    salt_key          TEXT NOT NULL,
    raw_json          TEXT NOT NULL
);

CREATE TABLE medicine_salts (
    medicine_id TEXT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    salt_name   TEXT NOT NULL,
    strength    REAL,
    unit        TEXT,
    PRIMARY KEY (medicine_id, salt_name)
);

CREATE INDEX idx_med_composition_key ON medicines(composition_key);
CREATE INDEX idx_med_salt_key        ON medicines(salt_key);
CREATE INDEX idx_med_brand           ON medicines(brand);
CREATE INDEX idx_salts_name          ON medicine_salts(salt_name);
"""


def load_dataset(path: Path | None = None) -> tuple[list, dict]:
    """Extract the JSON array (and metadata object) from medicines.js."""
    path = Path(path or DATA_FILE)
    raw = path.read_text(encoding="utf-8")
    start = raw.index("[")
    end = raw.rindex("]")
    catalogue = json.loads(raw[start:end + 1])

    meta = {}
    marker = "window.MEDICINE_META"
    if marker in raw:
        tail = raw[raw.index(marker):]
        meta_start = tail.index("{")
        meta_end = tail.rindex("}")
        meta = json.loads(tail[meta_start:meta_end + 1])

    validate(catalogue)
    return catalogue, meta


def validate(catalogue: list) -> None:
    """Fail loudly on a malformed dataset rather than silently serving bad prices."""
    seen = set()
    required = ("id", "brand", "salts", "form", "pack", "mrp", "type")
    for med in catalogue:
        missing = [f for f in required if med.get(f) in (None, "", [])]
        if missing:
            raise ValueError(f"medicine {med.get('id')!r} missing fields: {missing}")
        if med["id"] in seen:
            raise ValueError(f"duplicate medicine id: {med['id']}")
        seen.add(med["id"])
        if float(med["mrp"]) <= 0 or float(med["pack"]) <= 0:
            raise ValueError(f"medicine {med['id']} has a non-positive price or pack size")
        for salt in med["salts"]:
            if not salt.get("n"):
                raise ValueError(f"medicine {med['id']} has a salt without a name")


def connect(db_file: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_file or DB_FILE))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def build_database(db_file: Path | None = None, data_file: Path | None = None) -> dict:
    """(Re)create the SQLite database from the dataset file. Idempotent."""
    catalogue, meta = load_dataset(data_file)
    conn = connect(db_file)
    try:
        conn.executescript(SCHEMA)
        for med in catalogue:
            conn.execute(
                """INSERT INTO medicines (id, brand, manufacturer, form, pack_size, pack_unit,
                       mrp, unit_price, product_type, rx_required, therapeutic_class, uses,
                       composition, composition_key, salt_key, raw_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    med["id"], med["brand"], med.get("mfr"), med["form"],
                    float(med["pack"]), med.get("packUnit"), float(med["mrp"]),
                    unit_price(med), med["type"], 1 if med.get("rx") else 0,
                    med.get("class"), med.get("uses"), composition_label(med),
                    composition_key(med, True, True),
                    composition_key(med, False, False),
                    json.dumps(med, ensure_ascii=False),
                ),
            )
            for salt in med["salts"]:
                conn.execute(
                    "INSERT OR IGNORE INTO medicine_salts (medicine_id, salt_name, strength, unit)"
                    " VALUES (?,?,?,?)",
                    (med["id"], salt["n"], salt.get("s"), salt.get("u")),
                )
        conn.commit()
    finally:
        conn.close()
    return {"medicines": len(catalogue), "database": str(db_file or DB_FILE), "meta": meta}


if __name__ == "__main__":
    report = build_database()
    print(f"Seeded {report['medicines']} medicines into {report['database']}")
