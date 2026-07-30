import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Home, RefreshCw, Sparkles, LayoutGrid, TrendingUp, Save } from "lucide-react";

/**
 * Admin control panel for the home-page merchandising engine.
 *
 * Three things the shop owner needs and previously had no way to get:
 *
 *  1. See exactly what the home page is showing right now, in rank order,
 *     with the score and the plain-English reasons behind each placement.
 *  2. See the runners-up -- the products that were eligible but did not make
 *     the cut -- so "why isn't X on the home page" has an answer.
 *  3. Change the mix. The weights are seven numbers in store_settings; moving
 *     one and rebuilding takes seconds and needs no deploy.
 *
 * The ranking itself is computed in the database (migration
 * 20260729160000_home_merchandising_engine). This screen only reads it and
 * asks it to rebuild.
 */

const SLOTS = [
  { id: "ai_picks", label: "AI Picks", icon: <Sparkles className="h-4 w-4" /> },
  { id: "featured", label: "Featured", icon: <LayoutGrid className="h-4 w-4" /> },
] as const;

type SlotId = (typeof SLOTS)[number]["id"];

const DIALS: { key: string; label: string; hint: string }[] = [
  { key: "merch.weight.demand", label: "Demand", hint: "How much everyday shoppers search for this kind of product" },
  { key: "merch.weight.brand", label: "Brand", hint: "Household-name recognition" },
  { key: "merch.weight.price", label: "Price fit", hint: "How well the price sits in the band that converts" },
  { key: "merch.weight.name", label: "Title quality", hint: "Readable name vs distributor part number" },
  { key: "merch.weight.availability", label: "Availability", hint: "Can it be bought and dispatched today" },
  { key: "merch.weight.media", label: "Photos", hint: "Real photography, and more than one angle" },
  { key: "merch.weight.signal", label: "Real sales", hint: "Actual paid orders and wishlist saves" },
  { key: "merch.max_per_brand", label: "Max per brand", hint: "Diversity cap within a grid" },
  { key: "merch.max_per_category", label: "Max per category", hint: "Diversity cap within a grid" },
  { key: "merch.min_demand", label: "Minimum demand", hint: "Below this a product can never reach the home page" },
];

interface ShowcaseRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  price: number | string;
  in_stock: boolean | null;
  is_ai_product: boolean | null;
  score: number | string | null;
  reasons: unknown;
  rank: number;
}

interface CandidateRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  price: number | string;
  in_stock: boolean | null;
  score: number | string | null;
}

const rands = (v: number | string) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 })
    .format(Number(v) || 0);

const reasonList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((r): r is string => typeof r === "string") : [];

const MerchandisingModule = () => {
  const [slot, setSlot] = useState<SlotId>("ai_picks");
  const [rows, setRows] = useState<ShowcaseRow[]>([]);
  const [runnersUp, setRunnersUp] = useState<CandidateRow[]>([]);
  const [dials, setDials] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [savingDials, setSavingDials] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async (which: SlotId) => {
    setLoading(true);
    try {
      const [showcase, candidates, settings] = await Promise.all([
        supabase.rpc("get_home_showcase" as never, { p_slot: which, p_limit: 24 } as never),
        supabase.from("home_showcase_candidates" as never)
          .select("id, name, brand, category, price, in_stock, score")
          .order("score", { ascending: false })
          .limit(40),
        supabase.from("store_settings").select("key, value").like("key", "merch.%"),
      ]);
      setRows(Array.isArray(showcase.data) ? (showcase.data as ShowcaseRow[]) : []);

      const placed = new Set(
        (Array.isArray(showcase.data) ? (showcase.data as ShowcaseRow[]) : []).map((r) => r.id),
      );
      setRunnersUp(
        (Array.isArray(candidates.data) ? (candidates.data as unknown as CandidateRow[]) : [])
          .filter((c) => !placed.has(c.id))
          .slice(0, 12),
      );

      const next: Record<string, string> = {};
      for (const s of settings.data ?? []) next[s.key] = s.value ?? "";
      setDials(next);
    } catch (e) {
      toast({
        title: "Could not load the showcase",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(slot); }, [slot, load]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const { data, error } = await supabase.rpc("refresh_home_showcase" as never);
      if (error) throw error;
      const filled = (Array.isArray(data) ? data : []) as { slot: string; filled: number }[];
      toast({
        title: "Home page rebuilt",
        description: filled.map((f) => `${f.slot}: ${f.filled}`).join(" · ") || "No slots filled",
      });
      await load(slot);
    } catch (e) {
      toast({
        title: "Rebuild failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRebuilding(false);
    }
  };

  const saveDials = async () => {
    setSavingDials(true);
    try {
      // Upsert one row per dial. Anything unparseable is rejected here rather
      // than silently ignored by the scorer's fallback -- the owner should know
      // the value did not take.
      for (const { key, label } of DIALS) {
        const raw = (dials[key] ?? "").trim();
        if (raw === "" || Number.isNaN(Number(raw))) {
          throw new Error(`"${label}" must be a number (got "${raw}")`);
        }
      }
      const { error } = await supabase.from("store_settings").upsert(
        DIALS.map(({ key }) => ({ key, value: dials[key].trim() })),
        { onConflict: "key" },
      );
      if (error) throw error;
      toast({ title: "Weights saved", description: "Rebuild to apply them to the home page." });
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSavingDials(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Home className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-display font-bold">Home page merchandising</h2>
            <p className="text-sm text-muted-foreground">
              What residential shoppers see first, and why each product earned its place.
            </p>
          </div>
        </div>
        <Button onClick={rebuild} disabled={rebuilding}>
          <RefreshCw className={`h-4 w-4 mr-2 ${rebuilding ? "animate-spin" : ""}`} />
          {rebuilding ? "Rebuilding…" : "Rebuild now"}
        </Button>
      </div>

      <div className="flex gap-2">
        {SLOTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSlot(s.id)}
            aria-pressed={slot === s.id}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
              slot === s.id
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nothing curated for this slot yet. Press <strong>Rebuild now</strong> — until then the
            home page falls back to its date-ordered query.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="shrink-0 w-9 h-9 rounded-lg bg-muted flex items-center justify-center font-display font-bold text-sm">
                  {r.rank}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm leading-snug">{r.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[r.brand, r.category].filter(Boolean).join(" · ")} — {rands(r.price)}
                    {r.in_stock ? " · in stock" : " · backorder"}
                    {r.is_ai_product ? " · AI tagged" : ""}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {reasonList(r.reasons).map((reason) => (
                      <li
                        key={reason}
                        className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-display font-extrabold text-lg leading-none">
                    {Number(r.score ?? 0).toFixed(1)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                    score
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {runnersUp.length > 0 && (
        <div className="rounded-2xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Next in line</h3>
            <span className="text-xs text-muted-foreground">
              eligible, but beaten on score or held out by a diversity cap
            </span>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {runnersUp.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[c.brand, c.category].filter(Boolean).join(" · ")} — {rands(c.price)}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {Number(c.score ?? 0).toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h3 className="font-semibold text-sm">The mix</h3>
          <Button size="sm" variant="outline" onClick={saveDials} disabled={savingDials}>
            <Save className="h-4 w-4 mr-2" />
            {savingDials ? "Saving…" : "Save weights"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Weights are relative — they are re-proportioned automatically, so they do not have to add
          up to 1. Save, then rebuild, to see the effect.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DIALS.map(({ key, label, hint }) => (
            <label key={key} className="block">
              <span className="block text-xs font-semibold">{label}</span>
              <span className="block text-[11px] text-muted-foreground mb-1">{hint}</span>
              <input
                type="text"
                inputMode="decimal"
                value={dials[key] ?? ""}
                onChange={(e) => setDials((d) => ({ ...d, [key]: e.target.value }))}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MerchandisingModule;
