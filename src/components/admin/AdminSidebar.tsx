import {
  LayoutDashboard, Package, ShoppingCart, Users, HeadphonesIcon,
  Settings, FileSpreadsheet, LogOut, RefreshCw, MessageSquare,
  RotateCcw, Activity, Bell, Zap, Shield, DollarSign, Link2,
  HardDrive, Wrench, Search, Mail, Stethoscope, CreditCard, ShieldCheck, Bot,
  ReceiptText, Home, Gauge, Images, ChevronRight, TrendingUp,
} from "lucide-react";
import { useState } from "react";
import Logo from "@/components/Logo";

export type AdminTab =
  | "dashboard" | "products" | "import" | "orders" | "customers"
  | "support" | "returns" | "ai-logs" | "sync-logs" | "automations"
  | "edge-function-health"
  | "photos" | "settings" | "system-health" | "security" | "cost-usage" | "engine-room"
  | "integrations" | "backups" | "catalog-health" | "merchandising" | "sourcing"
  | "notifications-mgmt" | "newsletter" | "quotes" | "email-previews"
  | "compliance-audit"
  | "order-diagnostics" | "yoco-health" | "payment-events" | "email-health" | "ai-agent";


interface AdminSidebarProps {
  activeTab: AdminTab;
  setActiveTab: (tab: AdminTab) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  email: string;
  onSignOut: () => void;
  onOpenCommand: () => void;
}

// Navigation, grouped by the job you came here to do.
//
// WHY THIS WAS REGROUPED
// ----------------------
// Thirty-four destinations sat in a flat list under five headings that had
// stopped describing their contents. "Engine Room", "System Health", "Edge
// Function Health", "Sync Logs" and "Automations" were filed apart from each
// other while all five answer one question -- is the machinery running -- and
// the owner's own verdict was that he could not find his way around it.
//
// The grouping below is by intent, not by subsystem: what you are trying to do,
// not which service implements it. Sections collapse, and only the one you are
// working in stays open, so the list you scan is roughly seven items rather
// than thirty-four.
//
// `defaultOpen` marks the three sections that carry daily work. The rest are
// places you go deliberately, and a section you open deliberately is easier to
// find than one that was always open and therefore always scrolled past.

interface TabDef { id: AdminTab; label: string; icon: React.ReactNode; }
interface SectionDef { title: string; defaultOpen?: boolean; items: TabDef[]; }

const SECTIONS: SectionDef[] = [
  {
    title: "Today", defaultOpen: true,
    items: [
      { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: "orders", label: "Orders", icon: <ShoppingCart className="h-4 w-4" /> },
      { id: "support", label: "Support", icon: <HeadphonesIcon className="h-4 w-4" /> },
      { id: "quotes", label: "Quote Requests", icon: <FileSpreadsheet className="h-4 w-4" /> },
      { id: "returns", label: "Returns", icon: <RotateCcw className="h-4 w-4" /> },
    ],
  },
  {
    title: "Catalogue", defaultOpen: true,
    items: [
      { id: "products", label: "Products", icon: <Package className="h-4 w-4" /> },
      { id: "photos", label: "Photos", icon: <Images className="h-4 w-4" /> },
      { id: "import", label: "Bulk Import", icon: <FileSpreadsheet className="h-4 w-4" /> },
      { id: "merchandising", label: "Home Merchandising", icon: <Home className="h-4 w-4" /> },
      { id: "sourcing", label: "Sourcing & Pricing", icon: <TrendingUp className="h-4 w-4" /> },
      { id: "catalog-health", label: "Catalogue Health", icon: <Activity className="h-4 w-4" /> },
    ],
  },
  {
    title: "Customers",
    items: [
      { id: "customers", label: "Customers", icon: <Users className="h-4 w-4" /> },
      { id: "newsletter", label: "Newsletter", icon: <Mail className="h-4 w-4" /> },
      { id: "ai-logs", label: "AI Conversations", icon: <MessageSquare className="h-4 w-4" /> },
      { id: "ai-agent", label: "AI Agent", icon: <Bot className="h-4 w-4" /> },
    ],
  },
  {
    title: "Money",
    items: [
      { id: "payment-events", label: "Payment Events", icon: <ReceiptText className="h-4 w-4" /> },
      { id: "yoco-health", label: "Yoco Health", icon: <CreditCard className="h-4 w-4" /> },
      { id: "order-diagnostics", label: "Order Diagnostics", icon: <Stethoscope className="h-4 w-4" /> },
      { id: "cost-usage", label: "Cost & Usage", icon: <DollarSign className="h-4 w-4" /> },
    ],
  },
  {
    // Everything that answers "is the machinery running". Engine Room leads
    // because it is the one screen that summarises the other five, and burying
    // it among them is why it went unread while the sync was stuck.
    title: "Machinery", defaultOpen: true,
    items: [
      { id: "engine-room", label: "Engine Room", icon: <Gauge className="h-4 w-4" /> },
      { id: "sync-logs", label: "Sync Logs", icon: <RefreshCw className="h-4 w-4" /> },
      { id: "automations", label: "Automations", icon: <Zap className="h-4 w-4" /> },
      { id: "edge-function-health", label: "Edge Functions", icon: <Stethoscope className="h-4 w-4" /> },
      { id: "email-health", label: "Email Health", icon: <ShieldCheck className="h-4 w-4" /> },
      { id: "system-health", label: "System Health", icon: <Activity className="h-4 w-4" /> },
    ],
  },
  {
    title: "Trust & Safety",
    items: [
      { id: "security", label: "Security", icon: <Shield className="h-4 w-4" /> },
      { id: "compliance-audit", label: "Compliance Audit", icon: <Shield className="h-4 w-4" /> },
      { id: "backups", label: "Backups", icon: <HardDrive className="h-4 w-4" /> },
    ],
  },
  {
    title: "Setup",
    items: [
      { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
      { id: "integrations", label: "Integrations", icon: <Link2 className="h-4 w-4" /> },
      { id: "notifications-mgmt", label: "Notifications", icon: <Bell className="h-4 w-4" /> },
      { id: "email-previews", label: "Email Previews", icon: <Mail className="h-4 w-4" /> },
    ],
  },
];

/** Flat list, kept for the command palette (Ctrl+K), which searches everything
 *  regardless of which section it lives in -- and remains the fastest route for
 *  anyone who already knows the name of where they are going. */
const tabs: { id: AdminTab; label: string; icon: React.ReactNode; section?: string }[] =
  SECTIONS.flatMap((s) => s.items.map((t) => ({ ...t, section: s.title })));

const AdminSidebar = ({ activeTab, setActiveTab, sidebarOpen, setSidebarOpen, email, onSignOut, onOpenCommand }: AdminSidebarProps) => {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => Object.fromEntries(SECTIONS.map((s) => [s.title, Boolean(s.defaultOpen)])),
  );

  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 bg-foreground/60 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`fixed top-0 left-0 bottom-0 w-[260px] bg-sidebar z-50 flex flex-col transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
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
          {SECTIONS.map((section) => {
            const holdsActive = section.items.some((t) => t.id === activeTab);
            // The section holding the current screen is always open, whatever
            // the user last collapsed. Otherwise arriving via the command
            // palette drops you somewhere with no visible sign of where "here"
            // is, which is the disorientation this whole regroup is fixing.
            const open = holdsActive || openSections[section.title];

            return (
              <div key={section.title} className="pb-1">
                <button
                  onClick={() => setOpenSections((prev) => ({ ...prev, [section.title]: !open }))}
                  aria-expanded={open}
                  className="w-full flex items-center gap-2 px-5 pt-4 pb-2 text-[10px] font-display font-bold text-sidebar-foreground/40 uppercase tracking-widest hover:text-sidebar-foreground/70 transition-colors"
                >
                  <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
                  <span className="flex-1 text-left">{section.title}</span>
                  {!open && (
                    <span className="text-sidebar-foreground/30 font-mono normal-case">{section.items.length}</span>
                  )}
                </button>

                {open && section.items.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-[13px] font-medium transition-all duration-200 ${
                      activeTab === tab.id
                        ? "bg-sidebar-accent text-sidebar-foreground border-l-2 border-l-sidebar-primary"
                        : "text-sidebar-foreground/50 border-l-2 border-l-transparent hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80"
                    }`}
                  >
                    <span className={activeTab === tab.id ? "text-sidebar-primary" : "text-sidebar-foreground/35"}>{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
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
