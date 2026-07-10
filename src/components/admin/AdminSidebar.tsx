import {
  LayoutDashboard, Package, ShoppingCart, Users, HeadphonesIcon,
  Settings, FileSpreadsheet, LogOut, RefreshCw, MessageSquare,
  RotateCcw, Activity, Bell, Zap, Shield, DollarSign, Link2,
  HardDrive, Wrench, Search, Mail
} from "lucide-react";
import Logo from "@/components/Logo";

export type AdminTab =
  | "dashboard" | "products" | "import" | "orders" | "customers"
  | "support" | "returns" | "ai-logs" | "sync-logs" | "automations"
  | "settings" | "system-health" | "security" | "cost-usage"
  | "integrations" | "backups" | "catalog-health"
  | "notifications-mgmt" | "newsletter" | "quotes" | "email-previews";

interface AdminSidebarProps {
  activeTab: AdminTab;
  setActiveTab: (tab: AdminTab) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  email: string;
  onSignOut: () => void;
  onOpenCommand: () => void;
}

const tabs: { id: AdminTab; label: string; icon: React.ReactNode; section?: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, section: "Overview" },
  { id: "system-health", label: "System Health", icon: <Activity className="h-4 w-4" /> },
  { id: "products", label: "Products", icon: <Package className="h-4 w-4" />, section: "Catalogue" },
  { id: "import", label: "Bulk Import", icon: <FileSpreadsheet className="h-4 w-4" /> },
  { id: "orders", label: "Orders", icon: <ShoppingCart className="h-4 w-4" />, section: "Sales" },
  { id: "returns", label: "Returns", icon: <RotateCcw className="h-4 w-4" /> },
  { id: "customers", label: "Customers", icon: <Users className="h-4 w-4" /> },
  { id: "newsletter", label: "Newsletter", icon: <Mail className="h-4 w-4" /> },
  { id: "quotes", label: "Quote Requests", icon: <FileSpreadsheet className="h-4 w-4" /> },
  { id: "support", label: "Support", icon: <HeadphonesIcon className="h-4 w-4" />, section: "Operations" },
  { id: "ai-logs", label: "AI Conversations", icon: <MessageSquare className="h-4 w-4" /> },
  { id: "notifications-mgmt", label: "Notifications", icon: <Bell className="h-4 w-4" /> },
  { id: "email-previews", label: "Email Previews", icon: <Mail className="h-4 w-4" /> },
  { id: "security", label: "Security", icon: <Shield className="h-4 w-4" />, section: "System" },
  { id: "integrations", label: "Integrations", icon: <Link2 className="h-4 w-4" /> },
  { id: "cost-usage", label: "Cost & Usage", icon: <DollarSign className="h-4 w-4" /> },
  { id: "backups", label: "Backups", icon: <HardDrive className="h-4 w-4" /> },
  { id: "sync-logs", label: "Sync Logs", icon: <RefreshCw className="h-4 w-4" /> },
  { id: "automations", label: "Automations", icon: <Zap className="h-4 w-4" /> },
  { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

const AdminSidebar = ({ activeTab, setActiveTab, sidebarOpen, setSidebarOpen, email, onSignOut, onOpenCommand }: AdminSidebarProps) => {
  let lastSection = "";

  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 bg-foreground/60 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`fixed top-0 left-0 bottom-0 w-[260px] bg-sidebar z-50 flex flex-col transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:sticky lg:top-0 lg:h-screen`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <Logo size={32} showWordmark={false} asLink={false} />
          <div className="min-w-0">
            <p className="font-display font-extrabold text-sm text-sidebar-foreground truncate">Control Centre</p>
            <p className="text-[10px] text-sidebar-foreground/40 truncate">{email}</p>
          </div>
        </div>

        {/* Command palette trigger */}
        <button
          onClick={onOpenCommand}
          className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-sidebar-border text-sidebar-foreground/30 text-xs hover:bg-sidebar-accent/50 transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search commands...</span>
          <kbd className="text-[9px] border border-sidebar-border rounded px-1 py-0.5">Ctrl+K</kbd>
        </button>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {tabs.map((tab) => {
            const showSection = tab.section && tab.section !== lastSection;
            if (tab.section) lastSection = tab.section;
            return (
              <div key={tab.id}>
                {showSection && (
                  <p className="px-5 pt-5 pb-2 text-[10px] font-display font-bold text-sidebar-foreground/25 uppercase tracking-widest">
                    {tab.section}
                  </p>
                )}
                <button
                  onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 text-[13px] font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? "bg-sidebar-accent text-sidebar-foreground border-l-2 border-l-sidebar-primary"
                      : "text-sidebar-foreground/40 border-l-2 border-l-transparent hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/70"
                  }`}
                >
                  <span className={activeTab === tab.id ? "text-sidebar-primary" : "text-sidebar-foreground/25"}>{tab.icon}</span>
                  {tab.label}
                </button>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-sidebar-border">
          <button onClick={onSignOut} className="flex items-center gap-2.5 text-sidebar-foreground/30 text-[13px] hover:text-sidebar-foreground/70 transition-colors font-medium">
            <LogOut className="h-4 w-4" /> Sign Out
          </button>
        </div>
      </aside>
    </>
  );
};

export default AdminSidebar;
export { tabs };
