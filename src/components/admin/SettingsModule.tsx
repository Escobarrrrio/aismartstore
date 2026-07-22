import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Key, Bot, Link2, Package, Bell, Save, CheckCircle, Truck, Calculator } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SA_PROVINCES } from "@/hooks/useShippingSettings";

const DEFAULT_ZONES: Record<string, string> = {
  "Gauteng": "metro", "Western Cape": "metro",
  "KwaZulu-Natal": "regional", "Eastern Cape": "regional",
  "Free State": "outlying", "North West": "outlying", "Mpumalanga": "outlying",
  "Limpopo": "rest", "Northern Cape": "rest",
};
const DEFAULT_WEIGHT_TIERS = [
  { max_kg: 5, multiplier: 1.0 },
  { max_kg: 10, multiplier: 1.3 },
  { max_kg: 20, multiplier: 1.6 },
  { max_kg: 9999, multiplier: 2.0 },
];

interface SettingsModuleProps {
  settings: Record<string, string>;
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

const SettingsSection = ({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) => (
  <div className="card-flat p-6">
    <div className="flex items-start gap-3 mb-5 pb-4 border-b border-border">
      <div className="w-10 h-10 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary shrink-0">{icon}</div>
      <div>
        <h3 className="font-display font-bold text-sm">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
    {children}
  </div>
);

const isMasked = (v: string) => typeof v === "string" && v.startsWith("__MASKED__:");
const displayValue = (v: string) => (isMasked(v) ? "" : v);
const maskedPlaceholder = (v: string, fallback: string) =>
  isMasked(v) ? "•••• " + v.slice("__MASKED__:".length) + " (saved — retype to change)" : fallback;

const SettingsInput = ({ label, type = "text", value, onChange, placeholder, mono = false }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; placeholder: string; mono?: boolean;
}) => (
  <div>
    <label className="block text-xs font-semibold mb-1.5">{label}</label>
    <input
      type={type}
      value={displayValue(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={maskedPlaceholder(value, placeholder)}
      className={`input-premium ${mono ? "font-mono text-xs" : ""}`}
    />
  </div>
);

const SettingsModule = ({ settings, setSettings }: SettingsModuleProps) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (key: string, value: string) => setSettings((prev) => ({ ...prev, [key]: value }));

  const saveSetting = async (key: string, value: string) => {
    // Never persist a masked placeholder back to the database — that would
    // overwrite the real secret with the "••••1234" preview string.
    if (isMasked(value)) return;
    const { data: existing } = await supabase.from("store_settings").select("id").eq("key", key).maybeSingle();
    if (existing) {
      await supabase.from("store_settings").update({ value }).eq("key", key);
    } else {
      await supabase.from("store_settings").insert({ key, value });
    }
  };


  const THRESHOLD_DEFAULTS = { min_active: 500, spike_abs: 1000, spike_pct: 5, oos_share_ceiling: 60 };
  const parsedThresholds = (() => {
    try {
      const raw = settings.stock_sanity_thresholds;
      if (!raw) return THRESHOLD_DEFAULTS;
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      return { ...THRESHOLD_DEFAULTS, ...obj };
    } catch { return THRESHOLD_DEFAULTS; }
  })();

  const updateThreshold = (field: keyof typeof THRESHOLD_DEFAULTS, val: string) => {
    const next = { ...parsedThresholds, [field]: Number(val) || 0 };
    update("stock_sanity_thresholds", JSON.stringify(next));
  };

  const RATE_DEFAULTS = { metro: 98, outlying: 128, regional: 150, rest: 195 };
  const parsedRates = (() => {
    try {
      const raw = settings.shipping_rate_table;
      if (!raw) return RATE_DEFAULTS;
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      return { ...RATE_DEFAULTS, ...obj };
    } catch { return RATE_DEFAULTS; }
  })();

  const updateZoneRate = (zone: keyof typeof RATE_DEFAULTS, val: string) => {
    const next = { ...parsedRates, [zone]: Number(val) || 0 };
    update("shipping_rate_table", JSON.stringify(next));
  };

  const [previewProvince, setPreviewProvince] = useState(SA_PROVINCES[0]);
  const [previewWeight, setPreviewWeight] = useState(1);
  const previewFee = (() => {
    const zone = DEFAULT_ZONES[previewProvince] as keyof typeof RATE_DEFAULTS | undefined;
    const flatRate = Number(settings.shipping_flat_rate) || 75;
    const base = zone ? parsedRates[zone] ?? flatRate : flatRate;
    const tier = DEFAULT_WEIGHT_TIERS.find((t) => previewWeight <= t.max_kg) ?? DEFAULT_WEIGHT_TIERS[DEFAULT_WEIGHT_TIERS.length - 1];
    return Math.round(base * tier.multiplier);
  })();

  const handleSave = async () => {
    setSaving(true);
    const keys = ["yoco_public_key", "yoco_secret_key", "stripe_public_key", "stripe_secret_key", "stripe_webhook_secret", "paypal_client_id", "paypal_client_secret", "wise_account_details", "notification_email", "openai_api_key", "make_webhook_url", "axiz_api_key", "axiz_markup_pct", "shipping_flat_rate", "shipping_rate_table", "resend_api_key", "email_from_address", "courier_guy_api_key", "courier_guy_api_base", "stock_sanity_thresholds"];
    await Promise.all(keys.map((k) => saveSetting(k, settings[k] || "")));
    toast({ title: "Settings saved", description: "All configuration updated successfully." });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const markupPct = parseInt(settings.axiz_markup_pct || "26");

  return (
    <div className="max-w-2xl space-y-5">
      <SettingsSection icon={<Key className="h-4 w-4" />} title="Yoco Payment Gateway" description="Accept card payments via Yoco. Used for ZAR (South African) checkouts.">
        <div className="space-y-3">
          <SettingsInput label="Public Key" value={settings.yoco_public_key || ""} onChange={(v) => update("yoco_public_key", v)} placeholder="pk_live_..." mono />
          <SettingsInput label="Secret Key" type="password" value={settings.yoco_secret_key || ""} onChange={(v) => update("yoco_secret_key", v)} placeholder="sk_live_..." mono />
        </div>
      </SettingsSection>

      <SettingsSection icon={<Key className="h-4 w-4" />} title="PayPal — International Payments (Active)" description="Used automatically when a customer's selected currency isn't ZAR. PayPal directly supports South African merchant accounts, unlike Stripe. Get keys at developer.paypal.com/dashboard/applications, under your app's API credentials.">
        <div className="space-y-3">
          <SettingsInput label="Client ID" value={settings.paypal_client_id || ""} onChange={(v) => update("paypal_client_id", v)} placeholder="A..." mono />
          <SettingsInput label="Client Secret" type="password" value={settings.paypal_client_secret || ""} onChange={(v) => update("paypal_client_secret", v)} placeholder="E..." mono />
        </div>
      </SettingsSection>

      <SettingsSection icon={<Key className="h-4 w-4" />} title="Wise — Treasury & B2B Invoices" description="Not a checkout gateway -- Wise doesn't support that (their own words). Used for: (1) holding/converting international payments at low FX fees after PayPal/Yoco receive them, and (2) bank-transfer payment details shown to large procurement/government buyers on the For Business page, where wire transfer is normal.">
        <SettingsInput label="Account Details / Payment Link (shown to procurement buyers)" value={settings.wise_account_details || ""} onChange={(v) => update("wise_account_details", v)} placeholder="e.g. your Wise multi-currency payment link or account reference" />
      </SettingsSection>

      <SettingsSection icon={<Key className="h-4 w-4" />} title="Stripe — Standby (not currently usable)" description="Kept here in case you ever incorporate in a Stripe-supported country (UK, US, etc.) -- Stripe does not support South African merchant accounts directly, so this is dormant until/unless that changes.">
        <div className="space-y-3">
          <SettingsInput label="Publishable Key" value={settings.stripe_public_key || ""} onChange={(v) => update("stripe_public_key", v)} placeholder="pk_live_..." mono />
          <SettingsInput label="Secret Key" type="password" value={settings.stripe_secret_key || ""} onChange={(v) => update("stripe_secret_key", v)} placeholder="sk_live_..." mono />
          <SettingsInput label="Webhook Signing Secret" type="password" value={settings.stripe_webhook_secret || ""} onChange={(v) => update("stripe_webhook_secret", v)} placeholder="whsec_..." mono />
        </div>
      </SettingsSection>

      <SettingsSection icon={<Bot className="h-4 w-4" />} title="OpenAI — AI Assistant" description="Powers the customer service chatbot. Leave blank to use built-in AI.">
        <SettingsInput label="API Key" type="password" value={settings.openai_api_key || ""} onChange={(v) => update("openai_api_key", v)} placeholder="sk-..." mono />
      </SettingsSection>

      <SettingsSection icon={<Bot className="h-4 w-4" />} title="Resend — Email & Newsletters" description="Powers order confirmations, the welcome email, and newsletter campaigns. Get a free API key at resend.com. The From address MUST be on a domain you've verified in Resend's dashboard (Domains -> Add Domain, then add the SPF/DKIM records it gives you) -- sending from an unverified domain is why emails land in spam. Check Admin -> Email Health for a live check of whichever domain you use here.">
        <div className="space-y-3">
          <SettingsInput label="API Key" type="password" value={settings.resend_api_key || ""} onChange={(v) => update("resend_api_key", v)} placeholder="re_..." mono />
          <SettingsInput label="From Address (must be a Resend-verified domain)" value={settings.email_from_address || ""} onChange={(v) => update("email_from_address", v)} placeholder="AI Smart Store <orders@yourverifieddomain.co.za>" />
        </div>
      </SettingsSection>

      <SettingsSection icon={<Link2 className="h-4 w-4" />} title="Make Pro — Automation" description="Trigger webhooks for order and workflow automation.">
        <SettingsInput label="Webhook URL" value={settings.make_webhook_url || ""} onChange={(v) => update("make_webhook_url", v)} placeholder="https://hook.eu1.make.com/..." mono />
      </SettingsSection>

      <SettingsSection icon={<Truck className="h-4 w-4" />} title="Shipping" description="Every order ships via courier and is charged for it -- there is no free-shipping threshold. Checkout prices ZAR orders by delivery zone (below) once the customer's province is known; the Flat Rate is only the fallback shown on Cart, before an address is entered. Editing the zone rates here changes what customers are actually charged at Checkout, live.">
        <div className="space-y-4">
          <SettingsInput label="Flat Rate -- Cart fallback (R)" type="number" value={settings.shipping_flat_rate || ""} onChange={(v) => update("shipping_flat_rate", v)} placeholder="75" />
          <div>
            <label className="block text-xs font-semibold mb-2">Zone Rates -- what Checkout actually charges (R)</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <SettingsInput label="Metro (GP/WC)" type="number" value={String(parsedRates.metro)} onChange={(v) => updateZoneRate("metro", v)} placeholder="98" />
              <SettingsInput label="Outlying" type="number" value={String(parsedRates.outlying)} onChange={(v) => updateZoneRate("outlying", v)} placeholder="128" />
              <SettingsInput label="Regional (KZN/EC)" type="number" value={String(parsedRates.regional)} onChange={(v) => updateZoneRate("regional", v)} placeholder="150" />
              <SettingsInput label="Rest of SA" type="number" value={String(parsedRates.rest)} onChange={(v) => updateZoneRate("rest", v)} placeholder="195" />
            </div>
          </div>

          <div className="bg-muted rounded-xl p-4">
            <label className="flex items-center gap-1.5 text-xs font-semibold mb-3">
              <Calculator className="h-3.5 w-3.5" /> Preview — what would Checkout charge?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1.5">Province</label>
                <select
                  value={previewProvince}
                  onChange={(e) => setPreviewProvince(e.target.value)}
                  className="input-premium"
                >
                  {SA_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1.5">Parcel weight (kg)</label>
                <input
                  type="number" min={0} step={0.5}
                  value={previewWeight}
                  onChange={(e) => setPreviewWeight(Number(e.target.value) || 0)}
                  className="input-premium"
                />
              </div>
            </div>
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">Shipping fee for this order</span>
              <span className="font-display font-extrabold text-lg gradient-brand-text">R{previewFee.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Truck className="h-4 w-4" />} title="The Courier Guy — Tracking Automation" description="Paste the API key from portal.thecourierguy.co.za -> Integrations -> API keys. Every 30 minutes the store checks paid orders against the courier API, saves new tracking numbers automatically, and emails the customer a branded shipping notification with their tracking link (via Resend, no extra cost). Typing a tracking number manually into Orders triggers the same email on the next run -- each customer is only ever emailed once per order.">
        <div className="space-y-3">
          <SettingsInput label="API Key" type="password" value={settings.courier_guy_api_key || ""} onChange={(v) => update("courier_guy_api_key", v)} placeholder="Your Courier Guy API key..." mono />
          <SettingsInput label="API Base URL (leave blank for default)" value={settings.courier_guy_api_base || ""} onChange={(v) => update("courier_guy_api_base", v)} placeholder="https://api.shiplogic.com/v2" mono />
        </div>
      </SettingsSection>

      <SettingsSection icon={<Package className="h-4 w-4" />} title="Axiz Distributor" description="Connect to Axiz SA for automatic product syncing with markup.">
        <div className="space-y-4">
          <SettingsInput label="API Key" type="password" value={settings.axiz_api_key || ""} onChange={(v) => update("axiz_api_key", v)} placeholder="Your Axiz API key..." mono />
          <div>
            <label className="block text-xs font-semibold mb-2">Markup Percentage</label>
            <div className="flex items-center gap-4">
              <input type="range" min="0" max="100" value={markupPct} onChange={(e) => update("axiz_markup_pct", e.target.value)} className="flex-1 accent-[hsl(var(--primary))]" />
              <span className="font-display font-extrabold text-2xl gradient-brand-text min-w-[55px] text-right">{markupPct}%</span>
            </div>
            <div className="bg-muted rounded-xl p-4 mt-3 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost price</span><span className="font-medium">R1,000.00</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Markup ({markupPct}%)</span>
                <span className="text-[hsl(160,84%,39%)] font-medium">+R{(1000 * markupPct / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-display font-bold border-t border-border pt-2 mt-2">
                <span>Selling price</span><span>R{(1000 * (1 + markupPct / 100)).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Bell className="h-4 w-4" />} title="Notifications" description="Email notifications for new orders.">
        <SettingsInput label="Notification Email" value={settings.notification_email || ""} onChange={(v) => update("notification_email", v)} placeholder="admin@example.com" />
      </SettingsSection>

      <SettingsSection icon={<Bell className="h-4 w-4" />} title="Stock Sanity Alerts" description="Thresholds for the hourly stock sanity check. An alert email is sent when any threshold is breached vs. the last baseline.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingsInput label="Min active products (ignore below)" type="number" value={String(parsedThresholds.min_active)} onChange={(v) => updateThreshold("min_active", v)} placeholder="500" />
          <SettingsInput label="Absolute OOS jump" type="number" value={String(parsedThresholds.spike_abs)} onChange={(v) => updateThreshold("spike_abs", v)} placeholder="1000" />
          <SettingsInput label="OOS share jump (pp)" type="number" value={String(parsedThresholds.spike_pct)} onChange={(v) => updateThreshold("spike_pct", v)} placeholder="5" />
          <SettingsInput label="OOS share ceiling (%)" type="number" value={String(parsedThresholds.oos_share_ceiling)} onChange={(v) => updateThreshold("oos_share_ceiling", v)} placeholder="60" />
        </div>
        <p className="text-xs text-muted-foreground mt-3">Alerts fire when: OOS count jumps by ≥ absolute value, OR OOS share jumps by ≥ pp, OR OOS share exceeds ceiling.</p>
      </SettingsSection>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full btn-primary py-3.5 text-sm disabled:opacity-50 shadow-elevated"
      >
        {saved ? <><CheckCircle className="h-4 w-4" /> Saved!</> : <><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save All Settings"}</>}
      </button>
    </div>
  );
};

export default SettingsModule;
