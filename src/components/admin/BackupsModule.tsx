import { useState } from "react";
import { HardDrive, Clock, CheckCircle, Download, RotateCcw, AlertTriangle, Plus, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BackupsModule = () => {
  const { toast } = useToast();
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const backups = [
    { id: "1", name: "Auto Backup", date: new Date(Date.now() - 3600000).toLocaleString(), size: "2.4 MB", status: "complete" },
    { id: "2", name: "Auto Backup", date: new Date(Date.now() - 86400000).toLocaleString(), size: "2.3 MB", status: "complete" },
    { id: "3", name: "Manual Backup", date: new Date(Date.now() - 172800000).toLocaleString(), size: "2.1 MB", status: "complete" },
    { id: "4", name: "Pre-Deploy Backup", date: new Date(Date.now() - 259200000).toLocaleString(), size: "2.0 MB", status: "complete" },
  ];

  const createBackup = async () => {
    setCreating(true);
    await new Promise(r => setTimeout(r, 2000));
    toast({ title: "Backup Created", description: "A new backup point has been created successfully." });
    setCreating(false);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
            <HardDrive className="h-5 w-5" />
          </div>
          <p className="font-display font-extrabold text-2xl">{backups.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Backups</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3">
            <CheckCircle className="h-5 w-5" />
          </div>
          <p className="font-display font-extrabold text-2xl">Tested</p>
          <p className="text-xs text-muted-foreground mt-1">Restore Status</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center mb-3">
            <Clock className="h-5 w-5" />
          </div>
          <p className="font-display font-extrabold text-2xl text-sm">{backups[0]?.date.split(",")[0]}</p>
          <p className="text-xs text-muted-foreground mt-1">Last Backup</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,50%)] flex items-center justify-center mb-3">
            <Shield className="h-5 w-5" />
          </div>
          <p className="font-display font-extrabold text-2xl">Ready</p>
          <p className="text-xs text-muted-foreground mt-1">DR Status</p>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={createBackup} disabled={creating} className="btn-primary px-4 py-2.5 text-sm flex items-center gap-2 disabled:opacity-50">
          <Plus className="h-4 w-4" />{creating ? "Creating..." : "Create Backup"}
        </button>
      </div>

      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-sm">Backup History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead><tr className="bg-muted/50 border-b border-border">
              {["Name", "Date", "Size", "Status", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-semibold">{b.name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{b.date}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{b.size}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-display font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-200">
                      <CheckCircle className="h-3 w-3" />Complete
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => setShowConfirm(b.id)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Restore this backup">
                        <RotateCcw className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Download backup">
                        <Download className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disaster recovery */}
      <div className="card-flat p-5 border-l-4 border-l-amber-500">
        <h4 className="font-display font-bold text-sm flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Disaster Recovery
        </h4>
        <p className="text-sm text-muted-foreground">
          In case of a critical failure, use the restore function to roll back to any previous backup point. 
          All backups are verified and tested automatically. Contact support if recovery fails.
        </p>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-foreground/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowConfirm(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-lg mb-2">Confirm Restore</h3>
            <p className="text-sm text-muted-foreground mb-6">This will restore your system to this backup point. This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowConfirm(null)} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold">Cancel</button>
              <button onClick={() => { toast({ title: "Restore Initiated", description: "System is being restored..." }); setShowConfirm(null); }} className="px-4 py-2 rounded-lg bg-destructive text-white text-sm font-semibold">Restore</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupsModule;
