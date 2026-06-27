import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Key, Bot, Link2, Package, Bell, Save, CheckCircle, Truck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

const SettingsInput = ({ label, type = "text", value, onChange, placeholder, mono = false }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; placeholder: string; mono?: boolean;
}) => (
  <div>
    <label className="block text-xs font-semibold mb-1.5">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
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
    const { data: existing } = await supabase.from("store_settings").select("id").eq("key", key).maybeSingle();
    if (existing) {
      await supabase.from("store_settings").update({ value }).eq("key", key);
    } else {
      await supabase.from("store_settings").insert({ key, value });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const keys = ["yoco_public_key", "yoco_secret_key", "stripe_public_key", "stripe_secret_key", "stripe_webhook_secret", "notification_email", "openai_api_key", "make_webhook_url", "axiz_api_key", "axiz_markup_pct", "shipping_flat_rate", "free_shipping_threshold", "resend_api_key"];
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

      <SettingsSection icon={<Key className="h-4 w-4" />} title="Stripe — International Payments" description="Used automatically when a customer's selected currency isn't ZAR (USD, EUR, GBP, JPY, AUD, CAD, NZD, CHF, CNY, INR). Get keys at dashboard.stripe.com/apikeys, and set up a webhook at dashboard.stripe.com/webhooks pointed at your stripe-webhook function URL for the checkout.session.completed event.">
        <div className="space-y-3">
          <SettingsInput label="Publishable Key" value={settings.stripe_public_key || ""} onChange={(v) => update("stripe_public_key", v)} placeholder="pk_live_..." mono />
          <SettingsInput label="Secret Key" type="password" value={settings.stripe_secret_key || ""} onChange={(v) => update("stripe_secret_key", v)} placeholder="sk_live_..." mono />
          <SettingsInput label="Webhook Signing Secret" type="password" value={settings.stripe_webhook_secret || ""} onChange={(v) => update("stripe_webhook_secret", v)} placeholder="whsec_..." mono />
        </div>
      </SettingsSection>

      <SettingsSection icon={<Bot className="h-4 w-4" />} title="OpenAI — AI Assistant" description="Powers the customer service chatbot. Leave blank to use built-in AI.">
        <SettingsInput label="API Key" type="password" value={settings.openai_api_key || ""} onChange={(v) => update("openai_api_key", v)} placeholder="sk-..." mono />
      </SettingsSection>

      <SettingsSection icon={<Bot className="h-4 w-4" />} title="Resend — Email & Newsletters" description="Powers the welcome email and newsletter campaigns. Get a free API key at resend.com.">
        <SettingsInput label="API Key" type="password" value={settings.resend_api_key || ""} onChange={(v) => update("resend_api_key", v)} placeholder="re_..." mono />
      </SettingsSection>

      <SettingsSection icon={<Link2 className="h-4 w-4" />} title="Make Pro — Automation" description="Trigger webhooks for order and workflow automation.">
        <SettingsInput label="Webhook URL" value={settings.make_webhook_url || ""} onChange={(v) => update("make_webhook_url", v)} placeholder="https://hook.eu1.make.com/..." mono />
      </SettingsSection>

      <SettingsSection icon={<Truck className="h-4 w-4" />} title="Shipping" description="Shown to every shopper on Cart and Checkout, and charged as part of the order total. This is the only place to change it -- editing it here updates the live site immediately.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingsInput label="Flat Rate (R)" type="number" value={settings.shipping_flat_rate || ""} onChange={(v) => update("shipping_flat_rate", v)} placeholder="75" />
          <SettingsInput label="Free Shipping Threshold (R)" type="number" value={settings.free_shipping_threshold || ""} onChange={(v) => update("free_shipping_threshold", v)} placeholder="500" />
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
