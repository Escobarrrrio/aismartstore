// Admin -> Sourcing & Pricing.
//
// The question this screen answers is "where does each price come from, and can
// I trust it" -- which nothing in the admin could answer before. A distributor
// price that stopped refreshing looked identical to one that refreshed a minute
// ago, and you found out it had gone stale when a customer paid yesterday's
// price against today's cost.
//
// Two halves:
//
//   Margin by category. Every product was priced cost x 1.17, from R200 cables
//   to R35,000 workstations. Setting margin by department is what every serious
//   retailer does, because a flat rate is wrong in both directions at once.
//
//   Cost and freshness per category, read from the database rather than
//   computed in the browser. Aggregating client-side would mean shipping every
//   active product to the page to add up -- which is exactly how the Photos
//   screen came to silently work on the first 1,000 rows only.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, Trash2, TrendingUp, AlertTriangle, Clock, Check, RefreshCw,
} from "lucide-react";

interface CategoryRow {
  category: string;
  products: number;
  in_stock: number;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
  avg_cost: number | null;
  avg_margin_pct: number | null;
  markup_pct: number | null;
  below_cost: number;
  stale: number;
}

interface MarkupRule {
  category: string | null;
  percent: number;
  note: string | null;
}

const rand = (n: number | null | undefined): string =>
  n == null ? "—" : `R${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (n: number | null | undefined): string => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

const SourcingModule = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [rules, setRules] = useState<MarkupRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newPercent, setNewPercent] = useState("");

  const load = async () => {
    setLoading(true);
    // Through the SECURITY DEFINER function, not the view. The view joins
    // product_costs, so every row of it says what the store pays -- it carries
    // no direct grant to anyone, and this function checks the caller is an
    // admin before returning a single row.
    const [{ data: summary, error: sErr }, { data: ruleRows, error: rErr }] = await Promise.all([
      supabase.rpc("get_category_pricing"),
      supabase.from("category_markup").select("category, percent, note").order("category", { nullsFirst: true }),
    ]);

    if (sErr) toast({ title: "Could not load pricing", description: sErr.message, variant: "destructive" });
    if (rErr) toast({ title: "Could not load markup rules", description: rErr.message, variant: "destructive" });

    setRows((summary ?? []) as CategoryRow[]);
    setRules(((ruleRows ?? []) as MarkupRule[]).map((r) => ({ ...r, percent: Number(r.percent) })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const saveRule = async (category: string | null, percent: number) => {
    if (!Number.isFinite(percent) || percent < 0 || percent > 500) {
      toast({
        title: "That markup will not save",
        description: "It has to be a number between 0 and 500 percent.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    // Matched on the same lower(category) the unique index uses, so "Laptops"
    // and "laptops" update one rule rather than fighting over two.
    const existing = rules.find(
      (r) => (r.category ?? "").toLowerCase() === (category ?? "").toLowerCase() && (r.category == null) === (category == null),
    );
    const { error } = existing
      ? await supabase.from("category_markup").update({ percent, updated_at: new Date().toISOString() })
          .filter("category", category == null ? "is" : "eq", category == null ? null : category)
      : await supabase.from("category_markup").insert({ category, percent });
    setSaving(false);

    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Markup saved",
      description: `${category ?? "Everything else"} → ${percent}%. It applies from the next catalogue sync; prices already on the site do not change until then.`,
    });
    await load();
  };

  const deleteRule = async (category: string) => {
    setSaving(true);
    const { error } = await supabase.from("category_markup").delete().eq("category", category);
    setSaving(false);
    if (error) {
      toast({ title: "Could not remove", description: error.message, variant: "destructive" });
      return;
    }
    await load();
  };

  const fallback = rules.find((r) => r.category == null);
  const totals = rows.reduce(
    (acc, r) => ({
      products: acc.products + Number(r.products || 0),
      belowCost: acc.belowCost + Number(r.below_cost || 0),
      stale: acc.stale + Number(r.stale || 0),
    }),
    { products: 0, belowCost: 0, stale: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Sourcing &amp; Pricing</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            What each category costs, what it earns, and how fresh its prices are.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted min-h-[40px]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Headline numbers. Below-cost first, because it is the only one that is
          actively costing money right now. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Live products</p>
          <p className="text-2xl font-bold mt-1">{totals.products.toLocaleString("en-ZA")}</p>
        </div>
        <div className={`rounded-xl border p-4 ${totals.belowCost > 0 ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Priced below cost</p>
          <p className={`text-2xl font-bold mt-1 ${totals.belowCost > 0 ? "text-destructive" : ""}`}>
            {totals.belowCost.toLocaleString("en-ZA")}
          </p>
          {totals.belowCost > 0 && <p className="text-xs text-destructive mt-1">Every sale of these loses money.</p>}
        </div>
        <div className={`rounded-xl border p-4 ${totals.stale > 0 ? "border-amber-500/50 bg-amber-500/5" : "border-border"}`}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prices over a week old</p>
          <p className="text-2xl font-bold mt-1">{totals.stale.toLocaleString("en-ZA")}</p>
          {totals.stale > 0 && <p className="text-xs text-muted-foreground mt-1">The sync is not reaching these.</p>}
        </div>
      </div>

      {/* ------------------------------------------------------------ markup */}
      <section className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Margin by category
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            17% on a R200 cable is R34, which a card fee and a courier bag eat. 17% on a R35,000
            workstation is R5,950 in a market that pays single digits. Set them separately.
          </p>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium min-w-[9rem]">Everything else</label>
            <input
              type="number"
              min={0}
              max={500}
              step="0.5"
              defaultValue={fallback?.percent ?? 17}
              disabled={saving}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v !== (fallback?.percent ?? 17)) void saveRule(null, v);
              }}
              className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            />
            <span className="text-sm text-muted-foreground">% on cost</span>
          </div>

          {rules.filter((r) => r.category != null).map((r) => (
            <div key={r.category!} className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-medium min-w-[9rem] truncate" title={r.category!}>{r.category}</label>
              <input
                type="number"
                min={0}
                max={500}
                step="0.5"
                defaultValue={r.percent}
                disabled={saving}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== r.percent) void saveRule(r.category, v);
                }}
                className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
              />
              <span className="text-sm text-muted-foreground">% on cost</span>
              <button
                type="button"
                onClick={() => void deleteRule(r.category!)}
                disabled={saving}
                aria-label={`Remove the rule for ${r.category}`}
                className="ml-auto grid place-items-center h-9 w-9 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              list="sourcing-categories"
              placeholder="Category name (exact)"
              className="flex-1 min-w-[12rem] rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <datalist id="sourcing-categories">
              {rows.map((r) => <option key={r.category} value={r.category} />)}
            </datalist>
            <input
              type="number"
              min={0}
              max={500}
              step="0.5"
              value={newPercent}
              onChange={(e) => setNewPercent(e.target.value)}
              placeholder="%"
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            />
            <button
              type="button"
              disabled={saving || !newCategory.trim() || newPercent === ""}
              onClick={async () => {
                await saveRule(newCategory.trim(), Number(newPercent));
                setNewCategory("");
                setNewPercent("");
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-semibold disabled:opacity-40 min-h-[40px]"
            >
              <Plus className="h-4 w-4" /> Add rule
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Categories are matched exactly — “Laptops” does not catch “Laptop Bags”. New margins apply
            from the next catalogue sync; prices already on the site do not move until then.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------------- per-category */}
      <section className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">What each category actually earns</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Margin here is what lands, not the markup applied — cost R1,000 marked up 17% sells at
            R1,170 and realises 14.5%.
          </p>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">No live products to price.</p>
        ) : (
          // Scrolls inside its own container so the admin page never scrolls
          // sideways on a phone.
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[46rem]">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold px-4 py-2">Category</th>
                  <th className="text-right font-semibold px-3 py-2">Live</th>
                  <th className="text-right font-semibold px-3 py-2">In stock</th>
                  <th className="text-right font-semibold px-3 py-2">Avg cost</th>
                  <th className="text-right font-semibold px-3 py-2">Avg price</th>
                  <th className="text-right font-semibold px-3 py-2">Markup</th>
                  <th className="text-right font-semibold px-3 py-2">Real margin</th>
                  <th className="text-right font-semibold px-3 py-2">Problems</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.category} className="hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{r.category}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(r.products).toLocaleString("en-ZA")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(r.in_stock).toLocaleString("en-ZA")}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{rand(r.avg_cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{rand(r.avg_price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pct(r.markup_pct)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      r.avg_margin_pct != null && r.avg_margin_pct < 5 ? "text-destructive" : ""
                    }`}>
                      {pct(r.avg_margin_pct)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-2 justify-end">
                        {Number(r.below_cost) > 0 && (
                          <span className="inline-flex items-center gap-1 text-destructive text-xs font-semibold" title={`${r.below_cost} priced below cost`}>
                            <AlertTriangle className="h-3.5 w-3.5" />{r.below_cost}
                          </span>
                        )}
                        {Number(r.stale) > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-semibold" title={`${r.stale} not refreshed in over a week`}>
                            <Clock className="h-3.5 w-3.5" />{r.stale}
                          </span>
                        )}
                        {Number(r.below_cost) === 0 && Number(r.stale) === 0 && (
                          <Check className="h-4 w-4 text-emerald-600" aria-label="Nothing wrong" />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default SourcingModule;
