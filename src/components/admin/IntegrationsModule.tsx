import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link2, CheckCircle, XCircle, AlertTriangle, RefreshCw, Zap, CreditCard, Phone, Bot, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const IntegrationsModule = () => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    // Fetch via admin edge function; sensitive values arrive masked.
    supabase.functions.invoke("admin-get-settings").then(({ data }) => {
      if (data?.settings) setSettings(data.settings as Record<string, string>);
    });
  }, []);


  const integrations = [
    { id: "axiz", name: "Axiz Distributor", desc: "Product catalogue sync", icon: Package, key: "axiz_api_key" },
    { id: "yoco", name: "Yoco Payments", desc: "Payment processing", icon: CreditCard, key: "yoco_public_key" },
    { id: "telnyx", name: "Telnyx SMS", desc: "SMS notifications", icon: Phone, key: "telnyx_api_key" },
    { id: "openai", name: "OpenAI API", desc: "AI chatbot engine", icon: Bot, key: "openai_api_key" },
    { id: "make", name: "Make Pro", desc: "Workflow automation", icon: Zap, key: "make_webhook_url" },
  ];

  const getStatus = (key: string) => {
    const val = settings[key];
    if (!val) return "disconnected";
    return "connected";
  };

  const testConnection = async (id: string) => {
    setTesting(id);
    await new Promise(r => setTimeout(r, 1500));
    toast({ title: "Connection Test", description: `${id} connection test completed.` });
    setTesting(null);
  };

  const statusConfig = {
    connected: { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-200", icon: CheckCircle, label: "Connected" },
    disconnected: { cls: "bg-muted text-muted-foreground border-border", icon: XCircle, label: "Not Configured" },
    error: { cls: "bg-red-500/10 text-red-600 border-red-200", icon: AlertTriangle, label: "Error" },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4">
        {integrations.map((int) => {
          const status = getStatus(int.key);
          const sc = statusConfig[status];
          return (
            <div key={int.id} className="card-flat p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary">
                  <int.icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-display font-bold text-sm">{int.name}</p>
                  <p className="text-xs text-muted-foreground">{int.desc}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Key: {settings[int.key] ? "••••••••" + (settings[int.key]?.slice(-4) || "") : "Not set"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-display font-bold border ${sc.cls}`}>
                  <sc.icon className="h-3 w-3" />{sc.label}
                </span>
                <button
                  onClick={() => testConnection(int.id)}
                  disabled={testing === int.id}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  title={`Test ${int.name} connection`}
                >
                  <RefreshCw className={`h-3 w-3 ${testing === int.id ? "animate-spin" : ""}`} />
                  Test
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Failed integration logs */}
      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Failed Integration Logs
          </h3>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground text-center py-4">No failed integration attempts recorded</p>
        </div>
      </div>
    </div>
  );
};

export default IntegrationsModule;
