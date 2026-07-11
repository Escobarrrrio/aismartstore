import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import SEO from "@/components/SEO";
import ProductCard from "@/components/ProductCard";
import { Product } from "@/contexts/CartContext";
import { Link } from "react-router-dom";
import {
  ShieldCheck, FileCheck, Landmark, Building2, HardHat, Send,
  CheckCircle2, Award, CreditCard, Sparkles, ArrowRight,
} from "lucide-react";

const CREDENTIALS = [
  { icon: Award, label: "B-BBEE Status", value: "Level 1 EME — 100% Black-Owned" },
  { icon: FileCheck, label: "CIPC Registration", value: "2025/599261/07 — Active" },
  { icon: ShieldCheck, label: "CSD Supplier Number", value: "MAAA1656325 — Verified Active" },
  { icon: CreditCard, label: "Banking", value: "Capitec Business — Active account" },
];

const ENTITY_TYPES = [
  { value: "government", label: "Government / Municipal", icon: Landmark },
  { value: "private", label: "Private Enterprise", icon: Building2 },
  { value: "contractor", label: "Contractor / Subcontractor", icon: HardHat },
  { value: "other", label: "Other", icon: Building2 },
];

const ProcurementPage = () => {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [enterpriseAi, setEnterpriseAi] = useState<Product[]>([]);
  const [form, setForm] = useState({
    organisation_name: "", entity_type: "private", contact_name: "",
    email: "", phone: "", requirements: "", estimated_value: "",
  });

  useEffect(() => {
    (async () => {
      // Enterprise-tier AI: AI-tagged AND priced R15,000+ (workstations,
      // GPUs, servers, rack-scale accelerators — what procurement teams
      // typically issue POs for).
      const { data } = await supabase
        .from("products")
        .select("id, name, description, price, category, brand, sku, images, in_stock, stock_quantity, is_ai_product, created_at")
        .eq("is_active", true)
        .eq("is_ai_product", true)
        .gte("price", 15000)
        .not("images", "is", null)
        .order("price", { ascending: false })
        .limit(12);
      setEnterpriseAi(
        ((data as any[]) || [])
          .filter((p) => Array.isArray(p.images) && p.images[0])
          .slice(0, 8)
          .map((p) => ({
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
            createdAt: p.created_at || new Date().toISOString(),
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
    const { error } = await supabase.from("quote_requests").insert({
      organisation_name: form.organisation_name,
      entity_type: form.entity_type,
      contact_name: form.contact_name,
      email: form.email,
      phone: form.phone || null,
      requirements: form.requirements,
      estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Couldn't send your request", description: error.message, variant: "destructive" });
      return;
    }
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen">
      <SEO
        title="For Government & Enterprise"
        description="AI Smart Store — B-BBEE Level 1, CSD-verified, CIPC-registered technology supplier for government, enterprise, and contractor procurement in South Africa."
        path="/procurement"
      />

      {/* Hero */}
      <div className="bg-muted/50 border-b border-border">
        <div className="container mx-auto px-4 py-14 md:py-20 text-center max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-display font-semibold mb-5">
            <ShieldCheck className="h-3.5 w-3.5" /> Verified South African Supplier
          </span>
          <h1 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-4">
            A technology supplier ready for <span className="gradient-brand-text">any procurement process</span>
          </h1>
          <p className="text-muted-foreground text-base md:text-lg">
            AI Smart Store is a trading division of AI Job Chommie (Pty) Ltd — a Level 1 B-BBEE,
            CSD-verified, CIPC-registered South African company. Maximum preferential procurement
            score, full compliance documentation on request, and a track record with municipal and
            private sector clients in the Eastern Cape.
          </p>
        </div>
      </div>

      {/* Credentials grid */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {CREDENTIALS.map((c) => (
            <div key={c.label} className="card-flat p-5 text-center">
              <c.icon className="h-7 w-7 text-primary mx-auto mb-3" />
              <p className="text-xs text-muted-foreground font-medium mb-1">{c.label}</p>
              <p className="font-display font-bold text-sm">{c.value}</p>
            </div>
          ))}
        </div>

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
              <div className="text-center py-10">
                <CheckCircle2 className="h-12 w-12 text-[hsl(160,84%,39%)] mx-auto mb-4" />
                <h3 className="font-display font-bold text-lg mb-2">Request received</h3>
                <p className="text-sm text-muted-foreground">
                  We'll be in touch to discuss your requirements and provide a formal quote.
                </p>
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
