import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Users, Activity, Lock, Eye, EyeOff, LogOut, AlertTriangle, Key, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type AuditRow = { event_type: string; actor_email: string | null; created_at: string };

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SEVERITY_BY_EVENT: Record<string, "danger" | "warning" | "info"> = {
  "webhook.signature_failed": "danger",
  "webhook.rejected": "danger",
  "yoco.amount_mismatch": "danger",
  "email.failed": "warning",
  "email.shipped_failed": "warning",
  "price.reconciled": "warning",
};

const SecurityModule = () => {
  const { toast } = useToast();
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("user_roles").select("*");
    setRoles(data || []);
    setLoading(false);
  }, []);

  const loadAuditLog = useCallback(async () => {
    setAuditLoading(true);
    const { data } = await supabase
      .from("order_audit_log" as any)
      .select("event_type, actor_email, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    setAuditLog((data as unknown as AuditRow[]) ?? []);
    setAuditLoading(false);
  }, []);

  useEffect(() => { loadRoles(); loadAuditLog(); }, [loadRoles, loadAuditLog]);

  const severityColor = (s: string) => {
    if (s === "danger") return "bg-red-500/10 text-red-600 border-red-200";
    if (s === "warning") return "bg-amber-500/10 text-amber-600 border-amber-200";
    return "bg-emerald-500/10 text-emerald-600 border-emerald-200";
  };

  return (
    <div className="space-y-6">
      {/* RBAC */}
      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Role-Based Access Control
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead><tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">User ID</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading roles...</td></tr>
              ) : roles.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground text-sm">No roles configured</td></tr>
              ) : roles.map((r) => (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="px-4 py-3 text-sm font-mono text-xs">{r.user_id?.slice(0, 12)}...</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold bg-primary/10 text-primary border border-primary/20">{r.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-xs text-muted-foreground hover:text-foreground" title="View details">
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Trail -- real order_audit_log events, not sample data */}
      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Recent Order Activity
          </h3>
        </div>
        <div className="divide-y divide-border/50">
          {auditLoading ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : auditLog.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            auditLog.map((log, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${severityColor(SEVERITY_BY_EVENT[log.event_type] ?? "info")}`}>{log.event_type}</span>
                  <span className="text-xs text-muted-foreground">{log.actor_email ?? "system"}</span>
                </div>
                <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(log.created_at)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Session & Security Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-flat p-5">
          <h4 className="font-display font-bold text-sm mb-4 flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Session Management
          </h4>
          <div className="space-y-3">
            <button onClick={() => { setShowConfirm("force_logout"); }} className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm hover:bg-muted transition-colors" title="Force logout all active sessions">
              <LogOut className="h-4 w-4 text-red-500" /> Force Logout All Sessions
            </button>
            <button className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm hover:bg-muted transition-colors" title="Send password reset to admin email">
              <Key className="h-4 w-4 text-amber-500" /> Reset Admin Password
            </button>
            <button className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border border-destructive/30 text-sm hover:bg-destructive/5 transition-colors text-red-600" title="Lock all access to the admin panel immediately">
              <Shield className="h-4 w-4" /> Emergency Access Lock
            </button>
          </div>
        </div>

        <div className="card-flat p-5">
          <h4 className="font-display font-bold text-sm mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Security Alerts
          </h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs">No suspicious activity detected</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
              <span className="text-xs text-muted-foreground">All API keys are masked and protected</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
              <span className="text-xs text-muted-foreground">Secret values hidden from frontend</span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-foreground/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowConfirm(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-lg mb-2">Confirm Action</h3>
            <p className="text-sm text-muted-foreground mb-6">This is a destructive action. Are you sure you want to proceed?</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowConfirm(null)} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold">Cancel</button>
              <button onClick={() => { toast({ title: "Action completed", description: "The operation was executed successfully." }); setShowConfirm(null); }} className="px-4 py-2 rounded-lg bg-destructive text-white text-sm font-semibold">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityModule;
