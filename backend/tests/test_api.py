"""Integration tests for the HTTP layer.

These exercise the real Flask app against the shipped dataset, so they also
cover dataset loading and the SQLite build step.

Run from the backend directory:   pytest -q
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as flask_app  # noqa: E402
import db  # noqa: E402


@pytest.fixture(scope="module")
def client():
    db.build_database()
    flask_app._CACHE["catalogue"] = None
    flask_app._CACHE["meta"] = None
    flask_app.app.config.update(TESTING=True)
    with flask_app.app.test_client() as test_client:
        yield test_client


def payload(response):
    body = response.get_json()
    assert body["success"] is True, body
    return body["data"]


class TestEnvelope:
    def test_health_reports_every_dependency(self, client):
        data = payload(client.get("/api/health"))
        assert data["api"] == "healthy"
        assert data["database"] == "healthy"
        assert data["medicines"] > 50

    def test_unknown_endpoint_returns_error_envelope(self, client):
        body = client.get("/api/does-not-exist").get_json()
        assert body["success"] is False
        assert body["error"]["code"] == "NOT_FOUND"

    def test_every_response_carries_a_request_id(self, client):
        assert client.get("/api/health").headers.get("X-Request-Id")


class TestSearch:
    def test_brand_search_finds_the_exact_product_first(self, client):
        data = payload(client.get("/api/medicines?q=Dolo 650"))
        assert data["results"][0]["brand"] == "Dolo 650"

    def test_salt_search_returns_several_brands(self, client):
        data = payload(client.get("/api/medicines?q=atorvastatin"))
        assert data["count"] >= 4

    def test_missing_query_is_rejected(self, client):
        body = client.get("/api/medicines").get_json()
        assert body["success"] is False
        assert body["error"]["code"] == "BAD_REQUEST"


class TestAlternatives:
    def _alternatives(self, client, brand, extra=""):
        results = payload(client.get(f"/api/medicines?q={brand}"))["results"]
        med_id = results[0]["id"]
        return payload(client.get(f"/api/medicines/{med_id}/alternatives{extra}"))

    def test_dolo_650_has_a_cheaper_identical_option(self, client):
        data = self._alternatives(client, "Dolo 650")
        assert data["substitutable_count"] >= 2
        assert data["best_saving"]["saving_percent"] > 0

    def test_every_substitutable_option_shares_the_exact_composition(self, client):
        data = self._alternatives(client, "Dolo 650")
        reference = data["reference"]["composition"]
        form = data["reference"]["form"]
        for row in data["substitutable"]:
            assert row["composition"] == reference
            assert row["form"] == form

    def test_related_rows_never_share_the_exact_composition(self, client):
        data = self._alternatives(client, "Dolo 650")
        exact = (data["reference"]["composition"], data["reference"]["form"])
        for row in data["related"]:
            assert (row["composition"], row["form"]) != exact

    def test_headline_saving_is_independent_of_sort_order(self, client):
        by_price = self._alternatives(client, "Dolo 650", "?sort=unit_price")
        by_name = self._alternatives(client, "Dolo 650", "?sort=name")
        by_mrp = self._alternatives(client, "Dolo 650", "?sort=mrp")
        assert by_price["best_saving"] == by_name["best_saving"] == by_mrp["best_saving"]

    def test_sustained_release_is_not_offered_for_plain_tablets(self, client):
        data = self._alternatives(client, "Glycomet 500")
        assert data["reference"]["form"] == "Tablet"
        assert all(row["form"] == "Tablet" for row in data["substitutable"])
        assert any("SR" in row["form"] for row in data["related"])

    def test_units_change_the_course_saving(self, client):
        few = self._alternatives(client, "Dolo 650", "?units=10")
        many = self._alternatives(client, "Dolo 650", "?units=90")
        assert many["best_saving"]["course_saving"] > few["best_saving"]["course_saving"]

    def test_unknown_id_returns_404(self, client):
        response = client.get("/api/medicines/nope/alternatives")
        assert response.status_code == 404

    def test_bad_sort_is_rejected(self, client):
        response = client.get("/api/medicines/m007/alternatives?sort=cheapest")
        assert response.status_code == 400


class TestCompare:
    def test_compare_flags_a_mixed_composition_selection(self, client):
        data = payload(client.post("/api/compare", json={"ids": ["m007", "m001"], "units": 30}))
        assert data["same_composition"] is False
        assert data["composition_warning"]

    def test_compare_accepts_an_identical_group(self, client):
        data = payload(client.post("/api/compare", json={"ids": ["m007", "m010"]}))
        assert data["same_composition"] is True
        assert len(data["items"]) == 2

    def test_compare_needs_at_least_two_ids(self, client):
        response = client.post("/api/compare", json={"ids": ["m007"]})
        assert response.status_code == 400


class TestStatsAndSalts:
    def test_stats_expose_the_biggest_price_gaps(self, client):
        data = payload(client.get("/api/stats"))
        assert data["comparable_compositions"] >= 20
        gaps = data["biggest_price_gaps"]
        assert gaps and gaps[0]["saving_percent"] > 50
        assert gaps == sorted(gaps, key=lambda g: -g["saving_percent"])

    def test_salt_index_is_built_from_sql(self, client):
        data = payload(client.get("/api/salts"))
        names = {row["name"] for row in data}
        assert "Paracetamol" in names
        paracetamol = next(r for r in data if r["name"] == "Paracetamol")
        assert paracetamol["products"] >= 10
        assert paracetamol["min_unit_price"] < paracetamol["max_unit_price"]

    def test_meta_includes_the_disclaimer(self, client):
        data = payload(client.get("/api/meta"))
        assert "does not diagnose" in data["disclaimer"]


class TestStaticHosting:
    def test_root_serves_the_frontend(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert b"CareGen" in response.data

    def test_dataset_is_reachable_for_the_browser(self, client):
        response = client.get("/data/medicines.js")
        assert response.status_code == 200
        assert b"MEDICINE_DATA" in response.data
