"""CareGen AI backend — Flask REST API + static frontend host.

Run:  python app.py      (then open http://127.0.0.1:5000)

Every response uses one envelope so the frontend has a single code path:
    success -> {"success": true,  "data": ..., "message": "..."}
    failure -> {"success": false, "error": {"code": "...", "message": "..."}}
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory

import core
import db

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
DATA_DIR = BASE_DIR.parent / "data"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("caregen")

app = Flask(__name__, static_folder=None)

_CACHE: dict = {"catalogue": None, "meta": None}


# ---------------------------------------------------------------- data access

def catalogue() -> list:
    """All products, read once from SQLite and cached in memory."""
    if _CACHE["catalogue"] is None:
        if not db.DB_FILE.exists():
            log.info("database missing, building from %s", db.DATA_FILE)
            db.build_database()
        conn = db.connect()
        try:
            rows = conn.execute("SELECT raw_json FROM medicines").fetchall()
        finally:
            conn.close()
        _CACHE["catalogue"] = [json.loads(r["raw_json"]) for r in rows]
        log.info("loaded %d medicines", len(_CACHE["catalogue"]))
    return _CACHE["catalogue"]


def meta() -> dict:
    if _CACHE["meta"] is None:
        _, m = db.load_dataset()
        _CACHE["meta"] = m
    return _CACHE["meta"]


def by_id(medicine_id: str) -> dict | None:
    return next((m for m in catalogue() if m["id"] == medicine_id), None)


# ------------------------------------------------------------------ envelope

def ok(data, message: str = "OK", status: int = 200):
    return jsonify({"success": True, "data": data, "message": message}), status


def fail(code: str, message: str, status: int = 400):
    return jsonify({"success": False, "error": {"code": code, "message": message}}), status


@app.before_request
def _start_timer():
    g.request_id = uuid.uuid4().hex[:8]
    g.started = time.perf_counter()


@app.after_request
def _finish(response):
    took = (time.perf_counter() - getattr(g, "started", time.perf_counter())) * 1000
    response.headers["X-Request-Id"] = getattr(g, "request_id", "-")
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    if request.path.startswith("/api/"):
        log.info("%s %s %s -> %s in %.1fms",
                 getattr(g, "request_id", "-"), request.method, request.path,
                 response.status_code, took)
    return response


@app.errorhandler(404)
def _not_found(_e):
    if request.path.startswith("/api/"):
        return fail("NOT_FOUND", "No such endpoint.", 404)
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.errorhandler(500)
def _server_error(e):
    log.exception("unhandled error: %s", e)
    return fail("INTERNAL_ERROR", "Something went wrong on the server.", 500)


# ----------------------------------------------------------------- API routes

DISCLAIMER = (
    "CareGen AI is an information and price-comparison tool. It does not diagnose, "
    "prescribe or recommend a dose, and it does not replace your doctor or pharmacist. "
    "Confirm any substitution and the current price with a registered pharmacist."
)


@app.get("/api/health")
def health():
    checks = {"api": "healthy", "dataset": "unknown", "database": "unknown"}
    try:
        checks["dataset"] = "healthy" if db.DATA_FILE.exists() else "missing"
        conn = db.connect()
        try:
            count = conn.execute("SELECT COUNT(*) AS c FROM medicines").fetchone()["c"]
        finally:
            conn.close()
        checks["database"] = "healthy" if count else "empty"
        checks["medicines"] = count
    except Exception as exc:  # noqa: BLE001 - health endpoint must never crash
        checks["database"] = "error"
        checks["detail"] = type(exc).__name__
    return ok(checks)


@app.get("/api/meta")
def api_meta():
    products = catalogue()
    return ok({
        "disclaimer": DISCLAIMER,
        "dataset": meta(),
        "total_medicines": len(products),
        "total_compositions": len({core.composition_key(m) for m in products}),
        "product_types": core.TYPE_LABEL,
    })


@app.get("/api/medicines")
def search_medicines():
    query = (request.args.get("q") or "").strip()
    try:
        limit = min(max(int(request.args.get("limit", 25)), 1), 100)
    except ValueError:
        return fail("BAD_REQUEST", "limit must be an integer.")
    if not query:
        return fail("BAD_REQUEST", "Query parameter 'q' is required.")
    if len(query) > 80:
        return fail("BAD_REQUEST", "Query is too long.")

    matches = core.search_catalogue(catalogue(), query, limit)
    results = []
    for med in matches:
        results.append({
            "id": med["id"],
            "brand": med["brand"],
            "manufacturer": med.get("mfr"),
            "composition": core.composition_label(med),
            "form": med["form"],
            "pack": med["pack"],
            "pack_unit": med.get("packUnit"),
            "pack_label": f"{int(med['pack'])} {med.get('packUnit') or ''}".strip(),
            "mrp": med["mrp"],
            "unit_price": core.unit_price(med),
            "type": med["type"],
            "type_label": core.TYPE_LABEL.get(med["type"], med["type"]),
            "rx_required": bool(med.get("rx")),
        })
    return ok({"query": query, "count": len(results), "results": results})


@app.get("/api/medicines/<medicine_id>")
def medicine_detail(medicine_id):
    med = by_id(medicine_id)
    if not med:
        return fail("NOT_FOUND", "No medicine with that id.", 404)
    return ok(core.decorate(med))


@app.get("/api/medicines/<medicine_id>/alternatives")
def medicine_alternatives(medicine_id):
    med = by_id(medicine_id)
    if not med:
        return fail("NOT_FOUND", "No medicine with that id.", 404)
    try:
        units = min(max(int(request.args.get("units", 30)), 1), 365)
    except ValueError:
        return fail("BAD_REQUEST", "units must be an integer.")
    sort_by = request.args.get("sort", "unit_price")
    if sort_by not in {"unit_price", "savings", "mrp", "name"}:
        return fail("BAD_REQUEST", "sort must be one of unit_price, savings, mrp, name.")

    products = catalogue()
    same = core.find_alternatives(med, products, strict=True)
    related = core.find_alternatives(med, products, strict=False)

    ranked = core.rank_alternatives(med, same, units, sort_by)
    # The headline saving must not depend on how the user chose to sort the table.
    cheaper_rows = [r for r in ranked if r["savings"]["cheaper"]]
    cheapest = max(cheaper_rows, key=lambda r: r["savings"]["saving_per_unit"]) if cheaper_rows else None

    return ok({
        "reference": core.decorate(med, units),
        "units_considered": units,
        "sort": sort_by,
        "substitutable": ranked,
        "substitutable_count": len(ranked),
        "related": core.rank_alternatives(med, related, units, sort_by),
        "related_note": (
            "Same active ingredient but a different strength or dosage form. "
            "These are NOT interchangeable with your prescription."
        ),
        "best_saving": None if not cheapest else {
            "id": cheapest["id"],
            "brand": cheapest["brand"],
            "saving_percent": cheapest["savings"]["saving_percent"],
            "course_saving": cheapest["savings"]["course_saving"],
        },
        "disclaimer": DISCLAIMER,
    })


@app.get("/api/salts")
def list_salts():
    """Salt index built with SQL, useful for browse-by-ingredient in the UI."""
    conn = db.connect()
    try:
        rows = conn.execute(
            """SELECT s.salt_name AS name, COUNT(DISTINCT s.medicine_id) AS products,
                      MIN(m.unit_price) AS min_unit_price, MAX(m.unit_price) AS max_unit_price
                 FROM medicine_salts s JOIN medicines m ON m.id = s.medicine_id
             GROUP BY s.salt_name ORDER BY products DESC, s.salt_name"""
        ).fetchall()
    finally:
        conn.close()
    return ok([dict(r) for r in rows])


@app.post("/api/compare")
def compare():
    payload = request.get_json(silent=True) or {}
    ids = payload.get("ids")
    if not isinstance(ids, list) or not 2 <= len(ids) <= 8:
        return fail("BAD_REQUEST", "Provide 'ids' as a list of 2 to 8 medicine ids.")
    try:
        units = min(max(int(payload.get("units", 30)), 1), 365)
    except (TypeError, ValueError):
        return fail("BAD_REQUEST", "units must be an integer.")

    picked = [by_id(str(i)) for i in ids]
    if any(p is None for p in picked):
        missing = [i for i, p in zip(ids, picked) if p is None]
        return fail("NOT_FOUND", f"Unknown medicine ids: {missing}", 404)

    keys = {core.composition_key(p) for p in picked}
    reference = max(picked, key=core.unit_price)
    rows = core.rank_alternatives(reference, picked, units, "unit_price")
    return ok({
        "units_considered": units,
        "same_composition": len(keys) == 1,
        "composition_warning": None if len(keys) == 1 else (
            "The selected products do not share an identical salt, strength and form. "
            "Cost comparison is shown for information only, not as a substitution suggestion."
        ),
        "reference_id": reference["id"],
        "items": rows,
    })


@app.get("/api/stats")
def stats():
    """Headline numbers for the dashboard cards."""
    products = catalogue()
    groups: dict[str, list] = {}
    for med in products:
        groups.setdefault(core.composition_key(med), []).append(med)

    gaps = []
    for key, members in groups.items():
        if len(members) < 2:
            continue
        cheap = min(members, key=core.unit_price)
        pricey = max(members, key=core.unit_price)
        cheap_u, pricey_u = core.unit_price(cheap), core.unit_price(pricey)
        if pricey_u <= 0:
            continue
        gaps.append({
            "composition": core.composition_label(pricey),
            "form": pricey["form"],
            "costliest": {"brand": pricey["brand"], "unit_price": pricey_u},
            "cheapest": {"brand": cheap["brand"], "unit_price": cheap_u,
                         "type_label": core.TYPE_LABEL.get(cheap["type"], cheap["type"])},
            "saving_percent": round((pricey_u - cheap_u) / pricey_u * 100, 1),
        })
    gaps.sort(key=lambda gp: -gp["saving_percent"])

    return ok({
        "total_medicines": len(products),
        "total_compositions": len(groups),
        "comparable_compositions": sum(1 for m in groups.values() if len(m) > 1),
        "jan_aushadhi_products": sum(1 for m in products if m["type"] == "jan-aushadhi"),
        "biggest_price_gaps": gaps[:10],
    })


@app.post("/api/admin/reindex")
def reindex():
    """Rebuild SQLite from the dataset file and drop the in-memory cache."""
    report = db.build_database()
    _CACHE["catalogue"] = None
    _CACHE["meta"] = None
    return ok(report, "Database rebuilt from dataset.")


# ------------------------------------------------------------- static hosting

@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/data/<path:filename>")
def data_files(filename):
    return send_from_directory(DATA_DIR, filename)


@app.get("/<path:filename>")
def frontend_files(filename):
    # Belt and braces: never let the catch-all swallow an unknown API path.
    if filename.startswith("api/"):
        return fail("NOT_FOUND", "No such endpoint.", 404)
    return send_from_directory(FRONTEND_DIR, filename)


if __name__ == "__main__":
    if not db.DB_FILE.exists():
        print(db.build_database())
    catalogue()
    app.run(host="127.0.0.1", port=5000, debug=True)
