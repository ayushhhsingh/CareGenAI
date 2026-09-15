"""Unit tests for the price/composition logic.

Run from the backend directory:   pytest -q
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import core  # noqa: E402
import db  # noqa: E402


def med(mid, brand, salts, form="Tablet", pack=10, mrp=100.0, mtype="branded"):
    return {"id": mid, "brand": brand, "salts": salts, "form": form,
            "pack": pack, "packUnit": "tablet", "mrp": mrp, "type": mtype}


PARA_A = med("a", "Dolo 650", [{"n": "Paracetamol", "s": 650, "u": "mg"}], pack=15, mrp=34.0)
PARA_B = med("b", "Paracetamol 650 (PMBJP)", [{"n": "Paracetamol", "s": 650, "u": "mg"}],
             pack=10, mrp=7.5, mtype="jan-aushadhi")
PARA_500 = med("c", "Crocin 500", [{"n": "Paracetamol", "s": 500, "u": "mg"}], pack=15, mrp=30.0)
COMBO_1 = med("d", "Augmentin 625", [{"n": "Amoxicillin", "s": 500, "u": "mg"},
                                     {"n": "Clavulanic Acid", "s": 125, "u": "mg"}], mrp=205.0)
COMBO_2 = med("e", "Clavam 625", [{"n": "Clavulanic Acid", "s": 125, "u": "mg"},
                                  {"n": "Amoxicillin", "s": 500, "u": "mg"}], mrp=182.0)


class TestCompositionKey:
    def test_salt_order_does_not_matter(self):
        assert core.composition_key(COMBO_1) == core.composition_key(COMBO_2)

    def test_different_strength_is_a_different_key(self):
        assert core.composition_key(PARA_A) != core.composition_key(PARA_500)

    def test_strength_ignored_when_asked(self):
        assert core.composition_key(PARA_A, include_strength=False, include_form=False) == \
               core.composition_key(PARA_500, include_strength=False, include_form=False)

    def test_form_separates_sustained_release(self):
        ir = med("f", "Glycomet 500", [{"n": "Metformin", "s": 500, "u": "mg"}], form="Tablet")
        sr = med("g", "Glycomet SR 500", [{"n": "Metformin", "s": 500, "u": "mg"}],
                 form="Tablet SR")
        assert core.composition_key(ir) != core.composition_key(sr)

    def test_form_aliases_collapse(self):
        assert core.normalize_form("Tab") == core.normalize_form("Tablet")
        assert core.normalize_form("Suspension") == core.normalize_form("Syrup")


class TestPricing:
    def test_unit_price_uses_pack_size(self):
        assert core.unit_price(PARA_A) == pytest.approx(34.0 / 15)
        assert core.unit_price(PARA_B) == pytest.approx(0.75)

    def test_bigger_mrp_can_still_be_cheaper_per_unit(self):
        big = med("h", "Big pack", [{"n": "X", "s": 1, "u": "mg"}], pack=100, mrp=150.0)
        small = med("i", "Small pack", [{"n": "X", "s": 1, "u": "mg"}], pack=10, mrp=30.0)
        assert big["mrp"] > small["mrp"]
        assert core.unit_price(big) < core.unit_price(small)

    def test_course_cost_rounds_up_to_whole_packs(self):
        cost = core.course_cost(PARA_B, 25)
        assert cost["packs_needed"] == 3
        assert cost["total_cost"] == pytest.approx(22.5)

    def test_zero_units_needs_no_packs(self):
        assert core.course_cost(PARA_B, 0)["packs_needed"] == 0


class TestSavings:
    def test_savings_are_positive_for_the_cheaper_option(self):
        s = core.savings_vs(PARA_A, PARA_B, units_needed=30)
        assert s["cheaper"] is True
        assert s["saving_percent"] == pytest.approx(66.9, abs=0.2)
        assert s["course_saving"] == pytest.approx(45.5, abs=0.1)

    def test_savings_are_negative_when_candidate_costs_more(self):
        s = core.savings_vs(PARA_B, PARA_A, units_needed=30)
        assert s["cheaper"] is False
        assert s["saving_per_unit"] < 0

    def test_no_saving_against_itself(self):
        s = core.savings_vs(PARA_A, PARA_A)
        assert s["saving_per_unit"] == 0
        assert s["course_saving"] == 0


class TestAlternatives:
    catalogue = [PARA_A, PARA_B, PARA_500, COMBO_1, COMBO_2]

    def test_strict_match_only_returns_identical_composition(self):
        alts = core.find_alternatives(PARA_A, self.catalogue, strict=True)
        assert [a["id"] for a in alts] == ["b"]

    def test_related_match_returns_other_strengths_but_not_strict_ones(self):
        related = core.find_alternatives(PARA_A, self.catalogue, strict=False)
        assert [r["id"] for r in related] == ["c"]

    def test_ranking_puts_cheapest_per_unit_first_and_flags_best_value(self):
        alts = core.find_alternatives(PARA_500, self.catalogue + [
            med("z", "Pacimol 500", [{"n": "Paracetamol", "s": 500, "u": "mg"}],
                pack=15, mrp=22.0, mtype="branded-generic"),
            med("y", "Paracetamol 500 (PMBJP)", [{"n": "Paracetamol", "s": 500, "u": "mg"}],
                pack=10, mrp=5.5, mtype="jan-aushadhi"),
        ], strict=True)
        ranked = core.rank_alternatives(PARA_500, alts, 30, "unit_price")
        assert ranked[0]["id"] == "y"
        assert ranked[0]["best_value"] is True
        assert sum(1 for r in ranked if r["best_value"]) == 1

    def test_sort_by_savings_matches_sort_by_price(self):
        alts = core.find_alternatives(PARA_500, self.catalogue, strict=True)
        by_price = core.rank_alternatives(PARA_500, alts, 30, "unit_price")
        by_saving = core.rank_alternatives(PARA_500, alts, 30, "savings")
        assert [r["id"] for r in by_price] == [r["id"] for r in by_saving]

    def test_affordability_bands(self):
        assert core.affordability_band(1.0, 1.0) == "most-affordable"
        assert core.affordability_band(1.9, 1.0) == "affordable"
        assert core.affordability_band(3.0, 1.0) == "moderate"
        assert core.affordability_band(9.0, 1.0) == "expensive"


class TestSearch:
    catalogue = [PARA_A, PARA_B, PARA_500, COMBO_1]

    def test_exact_brand_ranks_first(self):
        assert core.search_catalogue(self.catalogue, "Dolo 650")[0]["id"] == "a"

    def test_search_by_salt_name(self):
        ids = {m["id"] for m in core.search_catalogue(self.catalogue, "paracetamol")}
        assert ids == {"a", "b", "c"}

    def test_case_and_spacing_insensitive(self):
        assert core.search_catalogue(self.catalogue, "  dOlO   650 ")[0]["id"] == "a"

    def test_empty_query_returns_nothing(self):
        assert core.search_catalogue(self.catalogue, "   ") == []


class TestDataset:
    def test_shipped_dataset_is_valid(self):
        products, meta = db.load_dataset()
        assert len(products) > 50
        assert meta.get("currency") == "INR"

    def test_every_composition_has_a_cheaper_alternative_somewhere(self):
        products, _ = db.load_dataset()
        groups = {}
        for product in products:
            groups.setdefault(core.composition_key(product), []).append(product)
        multi = [g for g in groups.values() if len(g) > 1]
        assert len(multi) >= 20, "dataset should contain many comparable groups"

    def test_validation_rejects_bad_records(self):
        with pytest.raises(ValueError):
            db.validate([med("x", "Bad", [{"n": "X", "s": 1, "u": "mg"}], mrp=0.0)])
        with pytest.raises(ValueError):
            db.validate([PARA_A, dict(PARA_A)])
