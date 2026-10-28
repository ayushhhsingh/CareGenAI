/** Shapes returned by /api/v1/generics/* (the sourced medicine dataset). */

export type VerificationStatus = "verified" | "source_listed" | "incomplete" | "unverified";
export type RecordKind = "brand" | "generic" | "reference";
export type CompatLevel = "compatible" | "review" | "excluded";

export interface DatasetIngredient {
  name: string;
  active_moiety: string;
  strength: string | null;
  strength_canonical: string | null;
}

export interface PurchaseLinkView {
  id: number;
  kind: "product" | "search" | "locator";
  url: string;
  label: string;
  pharmacy: { name: string; channel: string; licence_status: string; licence_note: string };
  link_status: "ok" | "blocked" | "unchecked" | "broken";
  http_status: number | null;
  last_checked_at: string | null;
  note: string | null;
  price_inr: number | null;
  availability: "unknown";
}

export interface DatasetProduct {
  id: string;
  record_kind: RecordKind;
  country: "IN" | "US";
  brand_name: string | null;
  generic_name: string | null;
  source_title: string;
  ingredients: DatasetIngredient[];
  strength: string | null;
  dosage_form: string | null;
  route: string | null;
  release_type: string | null;
  release_type_assumed: boolean;
  manufacturer: string | null;
  drug_category: string | null;
  pack_size: string | null;
  price: { amount: number; currency: string; type: string; pack_basis: string | null } | null;
  rx_status: "rx" | "otc" | null;
  rx_basis: string | null;
  indian_regulatory_status: string | null;
  verification: { status: VerificationStatus; basis: string[]; last_verified_at: string | null };
  source: {
    name: string;
    authority: string;
    official: boolean;
    record_id: string;
    url: string;
    retrieved_at: string | null;
    corroborated_by: string[];
  };
  parse: { confidence: "full" | "partial" | "none"; issues: string[] };
  field_provenance: Record<string, "source" | "normalized" | "derived">;
  purchase_links: PurchaseLinkView[];
  purchase: { state: "links" | "unavailable"; message: string | null };
  warnings: string[];
  match?: { score: number; method: "text" | "fuzzy" | "semantic" };
  compatibility?: {
    level: CompatLevel;
    exclusions: string[];
    review_reasons: string[];
    cautions: string[];
    evidence: {
      reference: { composition: string; form: string | null; route: string | null; release: string | null };
      candidate: { composition: string; form: string | null; route: string | null; release: string | null };
      checks: { check: string; passed: boolean }[];
    };
  };
}

export interface DatasetSearchResult {
  query: string;
  total: number;
  method: string;
  results: DatasetProduct[];
  disclaimer: string;
}

export interface DatasetAlternatives {
  reference: DatasetProduct;
  compatible: DatasetProduct[];
  needs_pharmacist_review: DatasetProduct[];
  excluded_count: number;
  excluded_reasons: Record<string, number>;
  excluded: DatasetProduct[];
  pharmacist_note: string;
  disclaimer: string;
  ai_explanation: { text: string; origin: "ai_generated" | "template"; note: string } | null;
}

export interface DatasetSearchParams {
  q: string;
  kind?: RecordKind;
  form?: string;
  country?: "IN" | "US";
  verified_only?: boolean;
  with_links?: boolean;
}

export interface DatasetSource {
  code: string;
  name: string;
  authority: string;
  url: string;
  official: boolean;
  country: string;
  provides: string[];
  limitations: string | null;
}
