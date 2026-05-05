import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Mail, Phone, AlertTriangle, Package, Zap, Shield, DollarSign, CheckCircle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const NotificationsModule = () => {
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false });
    setNotifications(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const alertTypes = [
    { id: "email", label: "Email Alerts", desc: "Order confirmations, status updates", icon: Mail, enabled: true },
    { id: "sms", label: "SMS Alerts", desc: "Critical order and system alerts", icon: Phone, enabled: false },
    { id: "system", label: "Critical System Alerts", desc: "Downtime, failures, security", icon: AlertTriangle, enabled: true },
    { id: "stock", label: "Low Stock Alerts", desc: "Products below threshold", icon: Package, enabled: true },
    { id: "jobs", label: "Failed Job Alerts", desc: "Sync and automation failures", icon: Zap, enabled: true },
    { id: "login", label: "Suspicious Login Alerts", desc: "Unusual login activity", icon: Shield, enabled: true },
    { id: "budget", label: "Budget Limit Alerts", desc: "API spend warnings", icon: DollarSign, enabled: true },
  ];

  const [toggles, setToggles] = useState<Record<string, boolean>>(
    Object.fromEntries(alertTypes.map(a => [a.id, a.enabled]))
  );

  const typeIcon = (type: string) => {
    const map: Record<string, { icon: typeof Bell; cls: string }> = {
      info: { icon: Bell, cls: "bg-blue-500/10 text-blue-600" },
      warning: { icon: AlertTriangle, cls: "bg-amber-500/10 text-amber-600" },
      error: { icon: AlertTriangle, cls: "bg-red-500/10 text-red-600" },
      success: { icon: CheckCircle, cls: "bg-emerald-500/10 text-emerald-600" },
    };
    return map[type] || map.info;
  };

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-6">
      {/* Alert Channels Config */}
      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-sm">Alert Channels</h3>
        </div>
        <div className="divide-y divide-border/50">
          {alertTypes.map(a => (
            <div key={a.id} className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/[0.06] flex items-center justify-center text-primary">
                  <a.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{a.label}</p>
                  <p className="text-xs text-muted-foreground">{a.desc}</p>
                </div>
              </div>
              <button
                onClick={() => setToggles(prev => ({ ...prev, [a.id]: !prev[a.id] }))}
                className={`relative w-10 h-5 rounded-full transition-colors ${toggles[a.id] ? "bg-primary" : "bg-muted-foreground/20"}`}
                title={`Toggle ${a.label}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${toggles[a.id] ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Notification History */}
      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-display font-bold text-sm">Notification History</h3>
          <span className="text-xs text-muted-foreground">{notifications.filter(n => !n.is_read).length} unread</span>
        </div>
        <div className="divide-y divide-border/50 max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="p-5 text-center text-sm text-muted-foreground">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="p-5 text-center text-sm text-muted-foreground">No notifications yet</div>
          ) : notifications.map(n => {
            const ti = typeIcon(n.type);
            return (
              <div key={n.id} className={`flex items-start gap-3 px-5 py-3 ${n.is_read ? "opacity-60" : ""}`}>
                <div className={`w-8 h-8 rounded-lg ${ti.cls} flex items-center justify-center shrink-0 mt-0.5`}>
                  <ti.icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{n.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</p>
                </div>
                {!n.is_read && (
                  <button onClick={() => markRead(n.id)} className="p-1 rounded hover:bg-muted" title="Mark as read">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default NotificationsModule;
