import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import SEO from "@/components/SEO";
import ProductCard from "@/components/ProductCard";
import { Product } from "@/contexts/CartContext";
import { Link } from "react-router-dom";
import { trackEvent } from "@/lib/analytics";
import {
  ShieldCheck, FileCheck, Landmark, Building2, HardHat, Send,
  CheckCircle2, Award, CreditCard, Sparkles, ArrowRight,
} from "lucide-react";

// Public-facing credential summary. Real registration numbers, CSD supplier
// number and banking details are NEVER exposed on this page — procurement
// officers receive the full verified compliance pack (with a named account
// manager, e.g. "John Dlomo") once they submit the quote request form below.
const CREDENTIALS = [
  { icon: Award, label: "B-BBEE Status", value: "Level 1 Contributor — verified" },
  { icon: FileCheck, label: "CIPC Registration", value: "Active — disclosed on request" },
  { icon: ShieldCheck, label: "CSD Supplier", value: "Verified Active — number on request" },
  { icon: CreditCard, label: "Account Manager", value: "John Dlomo — Procurement Desk" },
];

const ENTITY_TYPES = [
  { value: "government", label: "Government / Municipal", icon: Landmark },
  { value: "private", label: "Private Enterprise", icon: Building2 },
  { value: "contractor", label: "Contractor / Subcontractor", icon: HardHat },
  { value: "other", label: "Other", icon: Building2 },
];

/** Row shape returned by the `search_products` RPC. */
type SearchRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  category: string | null;
  brand: string | null;
  sku: string | null;
  images: string[] | null;
  in_stock: boolean;
  stock_quantity: number | null;
  is_ai_product: boolean | null;
  total_count: number | string;
};

type CompliancePack = {
  entity_legal_name: string;
  cipc_registration_number: string | null;
  vat_number: string | null;
  tax_reference_number: string | null;
  csd_supplier_number: string | null;
  bbbee_level: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_branch_code: string | null;
  account_manager_name: string | null;
  account_manager_email: string | null;
  account_manager_phone: string | null;
  notes: string | null;
};

const ProcurementPage = () => {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [compliancePack, setCompliancePack] = useState<CompliancePack | null>(null);
  const [enterpriseAi, setEnterpriseAi] = useState<Product[]>([]);
  const [enterpriseTotal, setEnterpriseTotal] = useState(0);
  const [form, setForm] = useState({
    organisation_name: "", entity_type: "private", contact_name: "",
    email: "", phone: "", requirements: "", estimated_value: "",
  });

  useEffect(() => {
    (async () => {
      trackEvent({ name: "storefront_viewed", audience: "business", surface: "procurement" });

      // Real catalogue size for the "browse everything" link below -- a
      // lightweight count, independent of the curated showcase (which is
      // capped at 24 and ranked, not exhaustive).
      const { count } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("audience", "business");
      const catalogueTotal = count ?? 0;
      setEnterpriseTotal(catalogueTotal);

      // get_business_showcase() ranks by real demand/brand/availability/
      // stocked-order-signal, NOT by price -- see business_merchandising_engine
      // migration for the full reasoning. Falls back to a plain business-audience
      // fetch (still not price-sorted) if the showcase is ever empty, so the
      // page never renders blank.
      let list: SearchRow[] = [];
      const { data: picks } = await supabase.rpc("get_business_showcase" as never, { p_limit: 12 } as never);
      // `as never` on the RPC name (the generated types lag migrations applied
      // out of band) makes the result `never`, so it is re-typed here.
      const ranked = picks as unknown as SearchRow[] | null;
      if (ranked && ranked.length > 0) {
        list = ranked.filter((p) => Array.isArray(p.images) && !!p.images[0]);
      } else {
        const { data } = await supabase.rpc("search_products", {
          search_query: "",
          filter_ai_only: false,
          sort_by: "relevance",
          page_number: 0,
          page_size: 24,
          filter_audience: "business",
        });
        list = ((data as SearchRow[] | null) ?? []).filter((p) => Array.isArray(p.images) && !!p.images[0]);
      }

      trackEvent({
        name: "product_list_returned",
        audience: "business",
        surface: "procurement",
        count: list.length,
        total: catalogueTotal,
      });
      setEnterpriseAi(
        list.slice(0, 8).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description || "",
          price: Number(p.price),
          category: p.category || "",
          brand: p.brand || undefined,
          sku: p.sku || undefined,
          images: p.images || [],
          inStock: p.in_stock,
          stockQuantity: typeof p.stock_quantity === "number" ? p.stock_quantity : undefined,
          isAiProduct: !!p.is_ai_product,
          createdAt: new Date().toISOString(),
        }))
      );
    })();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // Insert and return the row so we can prove ownership when unlocking the
    // private compliance pack via the SECURITY DEFINER get_compliance_pack RPC.
    const { data: inserted, error } = await supabase
      .from("quote_requests")
      .insert({
        organisation_name: form.organisation_name,
        entity_type: form.entity_type,
        contact_name: form.contact_name,
        email: form.email,
        phone: form.phone || null,
        requirements: form.requirements,
        estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
      })
      .select("id, email")
      .single();
    // PGRST116 = "no rows returned". The threat gate quarantined this
    // submission: the BEFORE INSERT trigger returned NULL, so nothing was
    // written and .single() has nothing to hand back.
    //
    // Treated as sent on purpose. Telling the sender it failed hands a spammer
    // a free oracle for tuning payloads against the scorer, and the point of
    // quarantining rather than rejecting is that they learn nothing. The
    // enquiry is not lost -- it is kept whole in the Engine Room's quarantine,
    // where a genuine buyer misjudged by a regex is visible and recoverable.
    //
    // They do not get the compliance pack below, which is correct: unlocking it
    // requires a real quote_requests row to prove ownership against, and there
    // is deliberately no row.
    if (error?.code === "PGRST116" || (!error && !inserted)) {
      setSubmitting(false);
      setSubmitted(true);
      return;
    }
    if (error || !inserted) {
      setSubmitting(false);
      toast({
        title: "Couldn't send your request",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
      return;
    }

    // Unlock the private compliance pack for THIS submitter only. The RPC
    // verifies (quote_id, email) server-side; nothing sensitive is available
    // to anonymous visitors who haven't submitted a matching request.
    const { data: pack } = await supabase.rpc("get_compliance_pack", {
      _quote_id: inserted.id,
      _email: inserted.email,
    });
    if (Array.isArray(pack) && pack.length > 0) {
      setCompliancePack(pack[0] as CompliancePack);
    }

    setSubmitting(false);
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen">
      <SEO
        title="For Government & Enterprise"
        description="AI Smart Store — B-BBEE Level 1, CSD-verified, CIPC-registered technology supplier for government, enterprise, and contractor procurement in South Africa."
        path="/procurement"
      />

      {/* Hero — was a flat bg-muted/50 grey box with a 4%-opacity badge;
          real colour band now, same gradient-brand + white-text pattern
          already proven legible on the Smart Pick badge elsewhere. */}
      <div className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-secondary/[0.05] to-accent/[0.10]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] gradient-brand opacity-[0.12] rounded-full blur-3xl -translate-y-1/2" />
        <div className="container mx-auto px-4 py-14 md:py-20 text-center max-w-3xl relative">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full gradient-brand text-white text-xs font-display font-bold mb-5 shadow-sm">
            <ShieldCheck className="h-3.5 w-3.5" /> Verified South African Supplier
          </span>
          <h1 className="text-4xl md:text-5xl font-display font-extrabold tracking-tight mb-4">
            A technology supplier ready for <span className="gradient-brand-text">any procurement process</span>
          </h1>
          <p className="text-muted-foreground text-base md:text-lg">
            AI Smart Store is a CIPC-registered, CSD-verified South African technology supplier
            with Level 1 B-BBEE contributor status — giving procurement teams maximum
            preferential procurement scoring. Your dedicated account manager,
            <span className="font-semibold text-foreground"> John Dlomo</span>, coordinates
            quoting, tender responses, and the full compliance pack (CIPC disclosure, B-BBEE
            certificate, CSD confirmation, banking confirmation, and tax compliance status)
            on request.
          </p>
        </div>
      </div>

      {/* Credentials grid — icon chips now carry the same solid brand colour
          the hero badge does, instead of a bare icon floating on a plain
          card; less generic-corporate, more "this is the premium supplier". */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {CREDENTIALS.map((c) => (
            <div key={c.label} className="card-flat p-5 text-center border-t-2 border-t-transparent hover:border-t-primary transition-colors">
              <div className="w-12 h-12 rounded-xl gradient-brand flex items-center justify-center mx-auto mb-3 shadow-sm">
                <c.icon className="h-6 w-6 text-white" />
              </div>
              <p className="text-xs text-muted-foreground font-medium mb-1">{c.label}</p>
              <p className="font-display font-bold text-sm">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Enterprise-grade AI catalogue */}
        {enterpriseAi.length > 0 && (
          <section className="mb-16">
            <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full gradient-brand text-white px-3 py-1.5 text-xs font-bold mb-3 shadow-sm">
                  <Sparkles className="h-3.5 w-3.5" />
                  Enterprise AI Hardware
                </div>
                <h2 className="text-2xl md:text-3xl font-display font-extrabold tracking-tight mb-2">
                  <span className="shimmer-text">AI infrastructure procurement teams actually order</span>
                </h2>
                <p className="text-muted-foreground max-w-2xl text-sm">
                  Workstations, GPUs, accelerators and rack-scale AI systems — the enterprise-tier hardware
                  our government and business clients quote against. Every item has a distributor product
                  code (SKU) suitable for tender line-items and CSD/BAS capture.
                </p>
              </div>
              {/* Must land in the BUSINESS catalogue. The old target
                  (/products?ai=1) dropped procurement officers into the
                  consumer storefront filtered to AI-flagged items — six
                  smart-home products, none of them tender-relevant. */}
              <Link
                to="/products?audience=business"
                className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap"
              >
                {enterpriseTotal > 0
                  ? `Browse all ${enterpriseTotal.toLocaleString("en-ZA")} enterprise products`
                  : "Browse the enterprise catalogue"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {enterpriseAi.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Why work with us */}
          <div>
            <h2 className="text-2xl font-display font-bold mb-6">Why procurement teams choose us</h2>
            <ul className="space-y-4">
              {[
                ["Maximum B-BBEE scorecard points", "Level 1 EME status means every rand spent with us counts at the highest preferential procurement weighting."],
                ["Formal quoting, not just instant checkout", "Submit your requirements below for a written quote — no need to force a tender through a consumer checkout flow."],
                ["Full compliance pack on request", "CIPC disclosure certificate, B-BBEE certificate, CSD confirmation, banking confirmation letter, and tax compliance status."],
                ["Direct distributor sourcing", "Sourced through Axiz (Alviva Holdings) — a major South African IT distributor — not grey-market resale."],
              ].map(([title, desc]) => (
                <li key={title} className="flex gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-display font-semibold text-sm">{title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Quote request form */}
          <div className="card-flat p-6 md:p-8">
            {submitted ? (
              <div data-testid="compliance-pack" className="py-4">
                <div className="flex items-start gap-3 mb-5">
                  <CheckCircle2 className="h-8 w-8 text-[hsl(160,84%,39%)] flex-shrink-0" />
                  <div>
                    <h3 className="font-display font-bold text-lg mb-1">Request received — compliance pack unlocked</h3>
                    <p className="text-sm text-muted-foreground">
                      Your dedicated account manager will be in touch shortly. The
                      private supplier compliance details are shown below for your
                      procurement records.
                    </p>
                  </div>
                </div>
                {compliancePack ? (
                  <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-5">
                    <p className="text-xs uppercase tracking-wider font-semibold text-primary mb-3">
                      Private — for {form.organisation_name || "your organisation"} only
                    </p>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      {[
                        ["Legal entity", compliancePack.entity_legal_name],
                        ["CIPC registration", compliancePack.cipc_registration_number],
                        ["VAT number", compliancePack.vat_number],
                        ["Tax reference", compliancePack.tax_reference_number],
                        ["CSD supplier no.", compliancePack.csd_supplier_number],
                        ["B-BBEE level", compliancePack.bbbee_level],
                        ["Bank", compliancePack.bank_name],
                        ["Account no.", compliancePack.bank_account_number],
                        ["Branch code", compliancePack.bank_branch_code],
                        ["Account manager", compliancePack.account_manager_name],
                        ["Manager email", compliancePack.account_manager_email],
                        ["Manager phone", compliancePack.account_manager_phone],
                      ].map(([label, value]) => value ? (
                        <div key={label as string}>
                          <dt className="text-xs text-muted-foreground">{label}</dt>
                          <dd className="font-medium">{value}</dd>
                        </div>
                      ) : null)}
                    </dl>
                    {compliancePack.notes && (
                      <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
                        {compliancePack.notes}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The compliance pack will be emailed to you within one business day.
                  </p>
                )}
              </div>
            ) : (
              <>
                <h2 className="font-display font-bold text-lg mb-1 flex items-center gap-2">
                  <Send className="h-4 w-4 text-primary" /> Request a Quote
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                  For bulk orders, tenders, or contract supply — tell us what you need.
                </p>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Organisation Name</label>
                    <input name="organisation_name" value={form.organisation_name} onChange={handleChange} required className="input-premium" />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-2">Organisation Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      {ENTITY_TYPES.map((et) => (
                        <button
                          key={et.value}
                          type="button"
                          onClick={() => setForm({ ...form, entity_type: et.value })}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors text-left ${
                            form.entity_type === et.value
                              ? "border-primary bg-primary/[0.06] text-primary"
                              : "border-border text-muted-foreground hover:border-primary/30"
                          }`}
                        >
                          <et.icon className="h-3.5 w-3.5 flex-shrink-0" /> {et.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">Contact Name</label>
                      <input name="contact_name" value={form.contact_name} onChange={handleChange} required className="input-premium" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">Email</label>
                      <input name="email" type="email" value={form.email} onChange={handleChange} required className="input-premium" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">Phone</label>
                      <input name="phone" value={form.phone} onChange={handleChange} className="input-premium" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">Estimated Value (R)</label>
                      <input name="estimated_value" type="number" value={form.estimated_value} onChange={handleChange} className="input-premium" placeholder="Optional" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1.5">What do you need?</label>
                    <textarea name="requirements" value={form.requirements} onChange={handleChange} required rows={4} className="input-premium resize-none" placeholder="Products, quantities, timeline, tender reference number if applicable..." />
                  </div>

                  <button type="submit" disabled={submitting} className="btn-primary w-full py-3 text-sm disabled:opacity-50">
                    {submitting ? "Sending..." : "Submit Quote Request"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProcurementPage;
