/**
 * Types mirroring the FastAPI v1 response shapes (see docs/API.md).
 * Keep in sync with backend/caregen/services/*.py serialisers.
 */

/* ------------------------------------------------------------- envelope */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/* ------------------------------------------------------------- medicine */

export type ProductType = "jan-aushadhi" | "generic" | "branded-generic" | "branded";
export type SortKey = "unit_price" | "savings" | "mrp" | "name";
export type Affordability = "most-affordable" | "affordable" | "moderate" | "expensive" | "unknown";
export type MatchStrategy =
  | "exact"
  | "lexical"
  | "salt"
  | "semantic"
  | "openfda"
  | "llm"
  | "none";

export interface Salt {
  name: string;
  strength: number | null;
  unit: string | null;
}

export interface DataSource {
  name: string;
  price_as_of: string | null;
}

export interface Medicine {
  id: string;
  brand: string;
  manufacturer: string | null;
  salts: Salt[];
  composition: string;
  form: string;
  pack_size: number;
  pack_unit: string | null;
  pack_label: string;
  mrp: number;
  unit_price: number;
  type: ProductType;
  type_label: string;
  rx_required: boolean;
  therapeutic_class: string | null;
  uses: string | null;
  narrow_therapeutic_index: boolean;
  source: DataSource;
}

export interface CourseCost {
  units_needed: number;
  packs_needed: number;
  pack_cost: number;
  total_cost: number;
  exact_cost: number;
}

export interface PriceComparison {
  reference_unit_price: number;
  unit_price: number;
  saving_per_unit: number;
  saving_percent: number;
  reference_course_cost: number;
  course_cost: number;
  course_saving: number;
  cheaper: boolean;
}

export interface ReferenceMedicine extends Medicine {
  course: CourseCost;
}

export interface GenericAlternative extends Medicine {
  savings: PriceComparison;
  course: CourseCost;
  affordability: Affordability;
  best_value: boolean;
}

export interface BestSaving {
  id: string;
  brand: string;
  type_label: string;
  unit_price: number;
  saving_per_unit: number;
  saving_percent: number;
  course_saving: number;
}

export interface AlternativesResult {
  reference: ReferenceMedicine;
  units_considered: number;
  sort: SortKey;
  substitutable: GenericAlternative[];
  substitutable_count: number;
  related: GenericAlternative[];
  related_note: string;
  best_saving: BestSaving | null;
  warnings: string[];
  disclaimer: string;
}

export interface MatchInfo {
  strategy: MatchStrategy;
  confidence: number;
  notes: string[];
}

export interface MedicineSearchRequest {
  query: string;
  units?: number;
  sort?: SortKey;
  limit?: number;
  medicine_id?: string;
}

export interface MedicineSearchResponse {
  query: string;
  match: MatchInfo;
  matches: Medicine[];
  result: AlternativesResult;
}

export interface SuggestResponse {
  query: string;
  count: number;
  results: Medicine[];
}

export interface CompareResponse {
  units_considered: number;
  same_composition: boolean;
  composition_warning: string | null;
  reference_id: string;
  items: GenericAlternative[];
  disclaimer: string;
}

export interface SaltIndexEntry {
  name: string;
  products: number;
  min_unit_price: number;
  max_unit_price: number;
}

export interface PriceGap {
  composition: string;
  form: string;
  costliest: { id: string; brand: string; unit_price: number };
  cheapest: { id: string; brand: string; unit_price: number; type_label: string };
  saving_percent: number;
}

export interface CatalogueStats {
  total_medicines: number;
  total_compositions: number;
  comparable_compositions: number;
  jan_aushadhi_products: number;
  biggest_price_gaps: PriceGap[];
}

export interface HealthStatus {
  api: string;
  version: string;
  database: { healthy: boolean; medicines?: number; dialect?: string; detail?: string };
  cache: { backend: string; healthy: boolean };
}

/* --------------------------------------------------------- prescription */

export interface ExtractedMedicine {
  id: string;
  raw_text: string;
  name: string;
  strength: string | null;
  dosage_form: string | null;
  /** Exactly as written on the prescription. Never interpreted by CareGen. */
  dosage_notation: string | null;
  duration: string | null;
  confidence: number;
  low_confidence: boolean;
  matched_medicine_id: string | null;
  match_strategy: MatchStrategy | null;
}

export interface DiagnosticTest {
  id: string;
  raw_text: string;
  code: string | null;
  name: string;
  confidence: number;
  low_confidence: boolean;
}

export type PrescriptionStatus = "extracted" | "analyzed";

export interface Prescription {
  id: string;
  status: PrescriptionStatus;
  source: "image" | "text";
  file_name: string | null;
  created_at: string | null;
  analyzed_at: string | null;
  ocr: { engine: string | null; confidence: number | null; text: string | null };
  medicines: ExtractedMedicine[];
  tests: DiagnosticTest[];
  warnings: string[];
  estimated_savings: number;
  analysis: PrescriptionAnalysis | null;
}

export interface EditedMedicineInput {
  name: string;
  strength?: string | null;
  dosage_form?: string | null;
  dosage_notation?: string | null;
  duration?: string | null;
  raw_text?: string | null;
  confidence?: number | null;
  edited?: boolean;
}

export interface AnalyzeRequest {
  prescription_id: string;
  medicines?: EditedMedicineInput[];
  test_codes?: string[];
  location?: { lat: number; lng: number };
  radius_m?: number;
  units?: number;
}

export type MedicineAnalysisStatus =
  | "matched"
  | "no_cheaper_alternative"
  | "no_alternative"
  | "not_found";

export interface MedicineAnalysis {
  extracted: Pick<
    ExtractedMedicine,
    "id" | "name" | "strength" | "dosage_form" | "dosage_notation" | "duration" | "raw_text" | "confidence"
  >;
  match: MatchInfo & { candidates: Medicine[] };
  result: AlternativesResult | null;
  status: MedicineAnalysisStatus;
}

export interface PrescriptionAnalysis {
  prescription_id: string;
  units_considered: number;
  medicines: MedicineAnalysis[];
  tests: Array<Pick<DiagnosticTest, "code" | "name" | "raw_text" | "confidence">>;
  labs: LabsBlock;
  summary: {
    medicines_found: number;
    medicines_matched: number;
    tests_found: number;
    estimated_total_saving: number;
  };
  disclaimer: string;
}

/* ----------------------------------------------------------------- labs */

export interface LabTest {
  code: string;
  name: string;
  category: string;
  sample_type: string | null;
  aliases: string[];
}

export interface LabTestPrice {
  test_code: string;
  test_name: string;
  price: number | null;
  currency: "INR";
  availability: "listed" | "unknown";
  source: string | null;
  as_of: string | null;
}

export interface Laboratory {
  id: string;
  name: string;
  address: string | null;
  location: { lat: number; lng: number };
  distance_m: number;
  travel_time_min: number;
  travel_time_source: "estimated";
  rating: number | null;
  rating_count: number | null;
  open_now: boolean | null;
  phone: string | null;
  website: string | null;
  maps_url: string;
  directions_url: string;
  chain: string | null;
  test_prices: LabTestPrice[];
  priced_tests: number;
}

export interface LabsBlock {
  status: "ok" | "empty" | "skipped" | "error";
  message: string | null;
  provider: "google" | "demo" | null;
  labs: Laboratory[];
  notes: string[];
  code?: string;
}

export interface NearbyLabsResponse {
  center: { lat: number; lng: number };
  radius_m: number;
  provider: "google" | "demo";
  tests_considered: Array<{ code: string; name: string }>;
  labs: Laboratory[];
  count: number;
  notes: string[];
}

/* ------------------------------------------------------- user / history */

export type Role = "user" | "admin";

export interface UserPreferences {
  save_history: boolean;
  store_prescription_text: boolean;
  default_units: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  auth_provider: "password" | "google";
  preferences: UserPreferences;
  created_at: string | null;
}

export type HistoryKind = "medicine_search" | "prescription";

export interface SearchHistory {
  id: string;
  kind: HistoryKind;
  query: string;
  reference_medicine_id: string | null;
  prescription_id: string | null;
  medicines_found: number;
  estimated_savings: number;
  summary: string | null;
  created_at: string;
}

export interface HistoryTotals {
  searches: number;
  prescriptions: number;
  estimated_total_savings: number;
}

export interface HistoryPage extends Paginated<SearchHistory> {
  totals: HistoryTotals;
}

export interface Profile {
  user: User;
  stats: HistoryTotals;
}

/* ---------------------------------------------------------------- admin */

export type ComponentStatus =
  | "healthy"
  | "unavailable"
  | "fallback"
  | "error"
  | "disabled"
  | "demo"
  | "not_configured";

export interface AdminOverview {
  users: { total: number; new_7d: number };
  searches: { total: number; last_7d: number; top_queries: Array<{ query: string; count: number }> };
  prescriptions: { total: number; last_7d: number };
  medicines: { total: number; compositions: number; comparable_compositions: number; jan_aushadhi: number };
  activity: Array<{ date: string; count: number }>;
  data_sources: Array<{ name: string; status: ComponentStatus; detail: string; updated: string | null }>;
  models: Array<{ name: string; kind: string; status: ComponentStatus; detail: string }>;
}
