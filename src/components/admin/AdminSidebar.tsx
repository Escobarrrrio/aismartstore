import {
  LayoutDashboard, Package, ShoppingCart, Users, HeadphonesIcon,
  Settings, FileSpreadsheet, LogOut, Menu
} from "lucide-react";

export type AdminTab = "dashboard" | "products" | "import" | "orders" | "customers" | "support" | "settings";

interface AdminSidebarProps {
  activeTab: AdminTab;
  setActiveTab: (tab: AdminTab) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  email: string;
  onSignOut: () => void;
}

const tabs: { id: AdminTab; label: string; icon: React.ReactNode; section?: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, section: "Overview" },
  { id: "products", label: "Products", icon: <Package className="h-4 w-4" />, section: "Catalogue" },
  { id: "import", label: "Bulk Import", icon: <FileSpreadsheet className="h-4 w-4" /> },
  { id: "orders", label: "Orders", icon: <ShoppingCart className="h-4 w-4" />, section: "Sales" },
  { id: "customers", label: "Customers", icon: <Users className="h-4 w-4" /> },
  { id: "support", label: "Support", icon: <HeadphonesIcon className="h-4 w-4" /> },
  { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" />, section: "System" },
];

const AdminSidebar = ({ activeTab, setActiveTab, sidebarOpen, setSidebarOpen, email, onSignOut }: AdminSidebarProps) => {
  let lastSection = "";

  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 bg-foreground/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`fixed top-0 left-0 bottom-0 w-[240px] bg-foreground z-50 flex flex-col transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:sticky lg:top-0 lg:h-screen`}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/[0.06]">
          <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center text-white font-bold text-xs shrink-0">S</div>
          <div className="min-w-0">
            <p className="font-display font-extrabold text-[13px] text-white truncate">Control Centre</p>
            <p className="text-[10px] text-white/30 truncate">{email}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {tabs.map((tab) => {
            const showSection = tab.section && tab.section !== lastSection;
            if (tab.section) lastSection = tab.section;
            return (
              <div key={tab.id}>
                {showSection && (
                  <p className="px-5 pt-4 pb-1.5 text-[10px] font-display font-bold text-white/20 uppercase tracking-widest">
                    {tab.section}
                  </p>
                )}
                <button
                  onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-5 py-2 text-[13px] font-display font-medium transition-all duration-150 ${
                    activeTab === tab.id
                      ? "bg-white/[0.08] text-white border-l-2 border-l-primary"
                      : "text-white/35 border-l-2 border-l-transparent hover:bg-white/[0.04] hover:text-white/70"
                  }`}
                >
                  <span className={activeTab === tab.id ? "text-primary" : "text-white/25"}>{tab.icon}</span>
                  {tab.label}
                </button>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.06]">
          <button onClick={onSignOut} className="flex items-center gap-2 text-white/30 text-[13px] hover:text-white/70 transition-colors font-display">
            <LogOut className="h-4 w-4" /> Sign Out
          </button>
        </div>
      </aside>
    </>
  );
};

export default AdminSidebar;
export { tabs };
