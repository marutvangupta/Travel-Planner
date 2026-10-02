export type Slot = "morning" | "lunch" | "afternoon" | "dinner" | "evening";
export type Pace = "relaxed" | "balanced" | "packed";

export interface Source {
  id: string;
  provider: string;
  title: string;
  url?: string | null;
  retrieved_at?: string | null;
}
export interface DayWeather {
  date: string;
  precip_prob: number;
  temp_min: number;
  temp_max: number;
  condition: "clear" | "cloudy" | "rain" | "storm" | "hot";
  source?: Source | null;
}
export interface TravelLeg {
  mode: "walk" | "taxi" | "transit";
  minutes: number;
  meters: number;
  cost_inr: number;
}
export interface Item {
  id: string;
  place_id: string;
  name: string;
  category: string;
  tags: string[];
  indoor: boolean;
  lat: number;
  lng: number;
  slot: Slot;
  start: number;
  end: number;
  est_cost_inr: number;
  travel_from_prev: TravelLeg | null;
  why: string;
  source_ids: string[];
  locked: boolean;
  warnings: string[];
}
export interface Day {
  index: number;
  date: string;
  theme: string;
  weather: DayWeather | null;
  items: Item[];
  tip: string | null;
  tip_source_ids: string[];
}
export interface Totals {
  cost_inr: number;
  activities_inr: number;
  food_inr: number;
  transport_inr: number;
  travel_minutes: number;
  budget_inr: number;
  remaining_inr: number;
  items: number;
}
export interface Itinerary {
  destination: string;
  base: [number, number] | null;
  days: Day[];
  totals: Totals;
  assumptions: string[];
  warnings: string[];
  sources: Record<string, Source>;
  data_mode: "live" | "demo";
  planner: string;
}
export interface ItemChange {
  kind: "added" | "removed" | "moved" | "retimed";
  name: string;
  place_id: string;
  day_from: number | null;
  day_to: number | null;
  detail: string;
}
export interface Diff {
  changes: ItemChange[];
  cost_before: number;
  cost_after: number;
  cost_delta: number;
  travel_before: number;
  travel_after: number;
  travel_delta: number;
  items_before: number;
  items_after: number;
  stability: number;
  interests_before: Record<string, number>;
  interests_after: Record<string, number>;
  summary: string;
}
export interface AffectedItem {
  item_id: string;
  day: number;
  name: string;
  reason: string;
}
export interface Violation {
  code: string;
  severity: "error" | "warning";
  message: string;
  day?: number | null;
  item_id?: string | null;
}
export interface Proposal {
  version_id: string | null;
  change_type: string;
  reason: string;
  affected: AffectedItem[];
  diff: Diff;
  itinerary: Itinerary;
  violations: Violation[];
  notes: string[];
}
export interface ChatReply {
  intent: "edit" | "constraint_change" | "whatif" | "question" | "chitchat";
  reply: string;
  proposal: Proposal | null;
  citations: string[];
}
export interface ProposalSummary {
  id: string;
  version_no: number;
  change_type: string;
  status: string;
  reason: string;
  created_at: string;
  diff: Diff | null;
  affected: AffectedItem[] | null;
  notes: string[];
}
export interface TripSummary {
  id: string;
  destination: string;
  start_date: string;
  end_date: string;
  budget_inr: number;
  cost_inr: number;
  stops: number;
  interests: string[];
  created_at: string;
  open_events: number;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload: { intent?: string; version_id?: string | null; diff_summary?: string | null; citations?: string[] } | null;
  created_at: string;
}
export interface ChangeEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: "open" | "resolved" | "dismissed";
  proposed_version_id: string | null;
  affected_item_ids: string[];
  created_at: string;
}
export interface RunMetrics {
  workflow: string;
  planner: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cost_inr?: number;
  tool_calls: number;
  repair_loops: number;
  tool_errors?: number;
  cache_hits?: number;
  llm_calls?: number;
  models?: string[];
}
export interface TripDetail {
  trip: {
    id: string;
    destination: string;
    lat: number | null;
    lng: number | null;
    start_date: string;
    end_date: string;
    budget_inr: number;
    request: TripRequest & { _closed?: string[] };
  };
  version: { id: string; version_no: number; metrics: Record<string, unknown> | null } | null;
  itinerary: Itinerary | null;
  proposals: ProposalSummary[];
  events: ChangeEvent[];
  messages: ChatMessage[];
  last_run: RunMetrics | null;
}
export interface VersionRow extends ProposalSummary {
  current: boolean;
}
export interface TripRequest {
  destination: string;
  start_date: string;
  end_date: string;
  budget_inr: number;
  travelers: number;
  interests: string[];
  travel_style: "budget" | "balanced" | "luxury";
  pace: Pace;
  constraints_text: string;
  diet: "none" | "vegetarian" | "vegan";
  step_free: boolean;
  avoid: string[];
  late_starts: boolean;
}
export interface Meta {
  data_mode: "live" | "demo";
  llm_mode: string;
  models: { plan: string; fast: string } | null;
  tools_mode: string;
  cache: string;
  langfuse: boolean;
  interests: string[];
  destinations: string[] | null;
  rain_threshold: number;
}
export interface Prefs {
  pace: Pace;
  travel_style: "budget" | "balanced" | "luxury";
  diet: "none" | "vegetarian" | "vegan";
  step_free: boolean;
  interests: string[];
  avoid: string[];
  category_weights: Record<string, number>;
}
export interface Memory {
  id: string;
  content: string;
  kind: "explicit" | "inferred";
  confidence: number;
  evidence: string | null;
  created_at: string;
}
export interface StageEvent {
  type: "stage";
  node: string;
  status: "start" | "done";
  label: string;
  detail?: string;
  ms?: number;
}
export type StreamEvent =
  | StageEvent
  | { type: "itinerary"; trip_id: string; version_id: string; itinerary: Itinerary; notes: string[]; metrics: RunMetrics; stats: Record<string, unknown> }
  | { type: "error"; code: string; message: string };
