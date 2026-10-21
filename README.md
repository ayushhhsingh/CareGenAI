# CareGen AI — generic medicine finder

Search a branded medicine, see its exact salt composition, and compare every product built on the
**identical composition, strength and dosage form** — ranked by what one tablet actually costs
rather than by pack MRP.

The point of the tool is the price gap: the same 500 mg paracetamol tablet in this dataset ranges
from ₹0.55 to ₹2.07 per tablet depending on the label on the strip.

---

## Quick start.....

Two ways to run it.

**A. Open the frontend directly** — no install, no Python. Double-click
`frontend/index.html`. The browser loads `data/medicines.js` and computes everything locally.
The status pill in the header reads *offline dataset*.

**B. Run the full stack** — Flask API + SQLite, which is the authoritative engine.

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
python db.py        # builds caregen.db from ../data/medicines.js
python app.py       # http://127.0.0.1:5000
```

Open <http://127.0.0.1:5000>. The status pill reads *API connected*, and search, alternatives and
statistics are served by the API. If the API goes down mid-session the frontend falls back to the
bundled dataset and says so — it never presents offline numbers as live ones.

Requires Python 3.10 or newer.

---

## How matching works

Substitution is only offered when the composition fingerprint matches exactly.

1. **Parse composition.** Every product stores its salts as `{name, strength, unit}` plus a dosage
   form: `Amoxicillin 500mg + Clavulanic Acid 125mg, Tablet`.
2. **Build a fingerprint.** Salt names are normalised (case, accents, punctuation) and sorted, so
   `A + B` and `B + A` collapse to one key. Strength and form are part of the key — a 500 mg tablet
   never matches a 650 mg one, and `Tablet SR` never matches `Tablet`.
3. **Rank by cost per unit.** Pack sizes differ, so MRP alone misleads: a ₹150 pack of 100 is far
   cheaper per tablet than a ₹30 pack of 10. Ranking uses `MRP ÷ pack size`.
4. **Estimate the course saving.** For the number of units you enter, the tool shows the rupee
   difference against the medicine you searched for.

Products sharing the active ingredient but differing in strength or form are shown in a separate
*not interchangeable* section. Name similarity alone is never treated as equivalence.

---

## Project layout

```
caregenai/
├── data/medicines.js        # single source of truth: 100 products, 28 comparable compositions
├── backend/
│   ├── core.py              # pure logic: normalisation, fingerprints, pricing, ranking
│   ├── db.py                # dataset validation + SQLite schema and seeding
│   ├── app.py               # Flask REST API, also serves the frontend
│   ├── requirements.txt
│   └── tests/
│       ├── test_core.py     # unit tests for the logic above
│       └── test_api.py      # integration tests through the Flask test client
└── frontend/
    ├── index.html
    ├── styles.css
    └── app.js               # UI + a client-side mirror of core.py for offline use
```

`data/medicines.js` is deliberately a `.js` file: the browser can load it over `file://`, and
`db.py` parses the embedded JSON array out of it. One dataset, no drift between two copies.

---

## API

All responses use one envelope:

```json
{ "success": true,  "data": {}, "message": "OK" }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "No medicine with that id." } }
```

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API, dataset and database status |
| GET | `/api/meta` | disclaimer, dataset metadata, catalogue counts |
| GET | `/api/medicines?q=&limit=` | ranked search over brand, salt and manufacturer |
| GET | `/api/medicines/{id}` | one product with derived pricing fields |
| GET | `/api/medicines/{id}/alternatives?units=&sort=` | substitutable list, related list, best saving |
| GET | `/api/salts` | salt index with product counts and price range (SQL aggregate) |
| POST | `/api/compare` | `{"ids": [...], "units": 30}` — compare 2–8 chosen products |
| GET | `/api/stats` | catalogue totals and the biggest price gaps |
| POST | `/api/admin/reindex` | rebuild SQLite from the dataset and clear the cache |

`sort` accepts `unit_price`, `savings`, `mrp`, `name`. `units` is clamped to 1–365.

Example:

```bash
curl "http://127.0.0.1:5000/api/medicines?q=dolo"
curl "http://127.0.0.1:5000/api/medicines/m007/alternatives?units=30&sort=savings"
```

---

## Tests

```bash
cd backend
pytest -q
```

`tests/test_core.py` covers composition fingerprints (salt order, strength, SR/IR forms), per-unit
pricing, whole-pack course costs, savings arithmetic in both directions, ranking and best-value
flagging, search scoring, and validation of the shipped dataset.

`tests/test_api.py` drives the real Flask app through its test client, so it also exercises dataset
parsing and the SQLite build. It asserts the response envelope, the request-id header, that every
"substitutable" row shares the reference composition and form exactly, that `Tablet SR` is never
offered as a substitute for a plain `Tablet`, and that the headline saving is identical whichever
`sort` the user picks.

> Not yet executed in this environment: the sandbox shell was unavailable, so the suite has been
> written and hand-checked against the dataset but not run. `pytest -q` from `backend/` is the
> first thing to do on a real machine.

---

## Data — read this before trusting a number

The bundled prices are **indicative sample values assembled for a prototype**. They are not live
MRPs, they exclude pharmacy discounts, and they will drift out of date. Before any real use,
replace `data/medicines.js` with a verified feed and keep a source plus timestamp on every record.
Reasonable sources are the NPPA ceiling-price list, the PMBJP (Jan Aushadhi) product price list, and
CDSCO product data. `db.validate()` already rejects records with a missing field, a duplicate id or
a non-positive price or pack size, so a bad import fails loudly instead of serving wrong prices.

Adding a product means appending one line to `data/medicines.js` and re-running `python db.py`.

---

## Limitations and safety

CareGen AI is an **information and price-comparison tool**. It does not diagnose, prescribe or
recommend a dose, and it does not replace a doctor or pharmacist.

- Same composition on paper is not the whole story: excipients, coatings and release profiles
  differ between manufacturers, which occasionally matters clinically.
- Some drugs have a narrow therapeutic index — thyroid hormones, anti-epileptics, warfarin,
  immunosuppressants, lithium — where switching brands should only happen under supervision.
- Availability is local. A cheaper product existing in the catalogue does not mean the pharmacy
  down the road stocks it.
- The catalogue is a sample, not the Indian market. Absence of a cheaper option here does not mean
  none exists.

## Possible next steps

Prescription image upload with OCR to pre-fill the search; a nearby-pharmacy or Jan Aushadhi
Kendra locator; user accounts with saved medicines and cumulative savings; scheduled ingestion
jobs that refresh prices from the NPPA and PMBJP lists.
