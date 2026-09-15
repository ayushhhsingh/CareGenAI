"""Pure business logic for CareGen AI.

Everything in this module is side-effect free so it can be unit tested without
a database, a network connection or a running web server.

Key idea: two medicines are treated as *substitutable candidates* only when
their full salt composition, strength and dosage form match exactly. Anything
looser is surfaced as a "related" result and clearly labelled as such, because
name similarity alone never implies therapeutic equivalence.
"""

from __future__ import annotations

import re
import unicodedata

# Product categories, cheapest-intent first. Used for tie-breaking and badges.
TYPE_ORDER = {
    "jan-aushadhi": 0,
    "generic": 1,
    "branded-generic": 2,
    "branded": 3,
}

TYPE_LABEL = {
    "jan-aushadhi": "Jan Aushadhi (PMBJP)",
    "generic": "Unbranded generic",
    "branded-generic": "Branded generic",
    "branded": "Branded",
}


def normalize_text(value: str) -> str:
    """Lowercase, strip accents and collapse whitespace/punctuation."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9./+% ]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_form(value: str) -> str:
    """Map dosage-form spellings onto a small canonical set."""
    form = normalize_text(value)
    aliases = {
        "tab": "tablet",
        "tabs": "tablet",
        "cap": "capsule",
        "caps": "capsule",
        "susp": "syrup",
        "suspension": "syrup",
        "tablet sr": "tablet sr",
        "tablet er": "tablet er",
        "tablet xr": "tablet er",
    }
    return aliases.get(form, form)


def format_strength(salt: dict) -> str:
    strength = salt.get("s")
    unit = salt.get("u") or ""
    if strength is None:
        return ""
    if float(strength).is_integer():
        strength = int(strength)
    return f"{strength}{unit}"


def salt_token(salt: dict, include_strength: bool = True) -> str:
    name = normalize_text(salt.get("n"))
    if not include_strength:
        return name
    return f"{name}@{normalize_text(format_strength(salt))}"


def composition_key(med: dict, include_strength: bool = True, include_form: bool = True) -> str:
    """Canonical fingerprint of a product's composition.

    Salts are sorted so that "A + B" and "B + A" collapse to one key.
    """
    tokens = sorted(salt_token(s, include_strength) for s in med.get("salts", []))
    key = "+".join(tokens)
    if include_form:
        key = f"{normalize_form(med.get('form'))}|{key}"
    return key


def composition_label(med: dict) -> str:
    """Human-readable composition, e.g. 'Amoxicillin 500mg + Clavulanic Acid 125mg'."""
    parts = []
    for salt in med.get("salts", []):
        strength = format_strength(salt)
        parts.append(f"{salt.get('n')} {strength}".strip())
    return " + ".join(parts)


def unit_price(med: dict) -> float:
    """Price of one tablet / capsule / ml / dose. Pack sizes differ between
    brands, so comparing MRP alone is misleading; this is the fair comparison."""
    pack = med.get("pack") or 0
    if not pack:
        return float(med.get("mrp") or 0.0)
    return round(float(med["mrp"]) / float(pack), 4)


def course_cost(med: dict, units_needed: int) -> dict:
    """Cost of buying enough whole packs to cover `units_needed` units."""
    pack = int(med.get("pack") or 1)
    units_needed = max(int(units_needed), 0)
    packs = -(-units_needed // pack) if units_needed else 0  # ceil division
    return {
        "units_needed": units_needed,
        "packs_needed": packs,
        "pack_cost": round(float(med["mrp"]), 2),
        "total_cost": round(packs * float(med["mrp"]), 2),
        "exact_cost": round(units_needed * unit_price(med), 2),
    }


def savings_vs(reference: dict, candidate: dict, units_needed: int = 30) -> dict:
    """Savings of `candidate` measured against `reference`, per unit and per course."""
    ref_unit = unit_price(reference)
    cand_unit = unit_price(candidate)
    per_unit = round(ref_unit - cand_unit, 4)
    percent = round((per_unit / ref_unit) * 100, 1) if ref_unit else 0.0
    ref_course = course_cost(reference, units_needed)["exact_cost"]
    cand_course = course_cost(candidate, units_needed)["exact_cost"]
    return {
        "reference_unit_price": round(ref_unit, 4),
        "unit_price": round(cand_unit, 4),
        "saving_per_unit": per_unit,
        "saving_percent": percent,
        "reference_course_cost": ref_course,
        "course_cost": cand_course,
        "course_saving": round(ref_course - cand_course, 2),
        "cheaper": per_unit > 0,
    }


def affordability_band(unit_p: float, cheapest_unit: float) -> str:
    """Coarse label so the UI can colour-code rows without inventing precision."""
    if cheapest_unit <= 0:
        return "unknown"
    ratio = unit_p / cheapest_unit
    if ratio <= 1.15:
        return "most-affordable"
    if ratio <= 2.0:
        return "affordable"
    if ratio <= 4.0:
        return "moderate"
    return "expensive"


def find_alternatives(reference: dict, catalogue: list, strict: bool = True) -> list:
    """All catalogue products sharing the reference's composition.

    strict=True  -> same salts, same strengths, same dosage form (substitutable
                    candidates a pharmacist can act on).
    strict=False -> same salts only; strength/form may differ. These are shown
                    separately and must never be presented as equivalents.
    """
    if strict:
        target = composition_key(reference, include_strength=True, include_form=True)
        return [
            m for m in catalogue
            if composition_key(m, True, True) == target and m["id"] != reference["id"]
        ]
    target_loose = composition_key(reference, include_strength=False, include_form=False)
    target_strict = composition_key(reference, True, True)
    return [
        m for m in catalogue
        if composition_key(m, False, False) == target_loose
        and composition_key(m, True, True) != target_strict
        and m["id"] != reference["id"]
    ]


def rank_alternatives(reference: dict, alternatives: list, units_needed: int = 30,
                      sort_by: str = "unit_price") -> list:
    """Attach price/savings/affordability fields and order the list."""
    pool = [reference] + list(alternatives)
    cheapest_unit = min(unit_price(m) for m in pool) if pool else 0.0

    rows = []
    for med in alternatives:
        row = dict(med)
        row["unit_price"] = unit_price(med)
        row["type_label"] = TYPE_LABEL.get(med.get("type"), med.get("type"))
        row["composition"] = composition_label(med)
        row["savings"] = savings_vs(reference, med, units_needed)
        row["course"] = course_cost(med, units_needed)
        row["affordability"] = affordability_band(row["unit_price"], cheapest_unit)
        row["is_reference"] = False
        rows.append(row)

    sorters = {
        "unit_price": lambda r: (r["unit_price"], TYPE_ORDER.get(r.get("type"), 9)),
        "savings": lambda r: (-r["savings"]["saving_per_unit"], r["unit_price"]),
        "mrp": lambda r: (r["mrp"], r["unit_price"]),
        "name": lambda r: normalize_text(r["brand"]),
    }
    rows.sort(key=sorters.get(sort_by, sorters["unit_price"]))

    for row in rows:
        row["best_value"] = False
    for row in rows:
        if row["unit_price"] == cheapest_unit:
            row["best_value"] = True
            break
    return rows


def decorate(med: dict, units_needed: int = 30) -> dict:
    """Reference-product view with the same derived fields as alternatives."""
    row = dict(med)
    row["unit_price"] = unit_price(med)
    row["type_label"] = TYPE_LABEL.get(med.get("type"), med.get("type"))
    row["composition"] = composition_label(med)
    row["course"] = course_cost(med, units_needed)
    row["is_reference"] = True
    return row


def search_catalogue(catalogue: list, query: str, limit: int = 25) -> list:
    """Rank products by how well brand / salt / manufacturer matches the query."""
    q = normalize_text(query)
    if not q:
        return []
    results = []
    for med in catalogue:
        brand = normalize_text(med.get("brand"))
        salts = normalize_text(" ".join(s.get("n", "") for s in med.get("salts", [])))
        mfr = normalize_text(med.get("mfr"))
        score = 0
        if brand == q:
            score = 100
        elif brand.startswith(q):
            score = 85
        elif q in brand:
            score = 70
        elif salts.startswith(q):
            score = 60
        elif q in salts:
            score = 50
        elif q in mfr:
            score = 25
        if score:
            results.append((score, unit_price(med), med))
    results.sort(key=lambda t: (-t[0], t[1]))
    return [med for _, _, med in results[:limit]]
