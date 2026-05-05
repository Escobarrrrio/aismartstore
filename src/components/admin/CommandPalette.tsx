import { useState, useEffect, useCallback } from "react";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator
} from "@/components/ui/command";
import {
  LayoutDashboard, Package, ShoppingCart, Users, HeadphonesIcon, Settings, RefreshCw,
  Trash2, Play, Pause, Shield, Activity, Database, Zap, Search, RotateCcw, Bell,
  FileSpreadsheet, MessageSquare, DollarSign, Link2, HardDrive, Wrench
} from "lucide-react";
import type { AdminTab } from "./AdminSidebar";

interface CommandPaletteProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  setActiveTab: (tab: AdminTab) => void;
  onAction: (action: string) => void;
}

const CommandPalette = ({ open, setOpen, setActiveTab, onAction }: CommandPaletteProps) => {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, setOpen]);

  const navigate = (tab: AdminTab) => { setActiveTab(tab); setOpen(false); };
  const action = (a: string) => { onAction(a); setOpen(false); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => navigate("dashboard")}><LayoutDashboard className="mr-2 h-4 w-4" />Dashboard</CommandItem>
          <CommandItem onSelect={() => navigate("products")}><Package className="mr-2 h-4 w-4" />Products</CommandItem>
          <CommandItem onSelect={() => navigate("orders")}><ShoppingCart className="mr-2 h-4 w-4" />Orders</CommandItem>
          <CommandItem onSelect={() => navigate("customers")}><Users className="mr-2 h-4 w-4" />Customers</CommandItem>
          <CommandItem onSelect={() => navigate("support")}><HeadphonesIcon className="mr-2 h-4 w-4" />Support</CommandItem>
          <CommandItem onSelect={() => navigate("system-health")}><Activity className="mr-2 h-4 w-4" />System Health</CommandItem>
          <CommandItem onSelect={() => navigate("security")}><Shield className="mr-2 h-4 w-4" />Security</CommandItem>
          <CommandItem onSelect={() => navigate("cost-usage")}><DollarSign className="mr-2 h-4 w-4" />Cost & Usage</CommandItem>
          <CommandItem onSelect={() => navigate("integrations")}><Link2 className="mr-2 h-4 w-4" />Integrations</CommandItem>
          <CommandItem onSelect={() => navigate("backups")}><HardDrive className="mr-2 h-4 w-4" />Backups</CommandItem>
          <CommandItem onSelect={() => navigate("product-ops")}><Wrench className="mr-2 h-4 w-4" />Product Ops</CommandItem>
          <CommandItem onSelect={() => navigate("order-ops")}><ShoppingCart className="mr-2 h-4 w-4" />Order Ops</CommandItem>
          <CommandItem onSelect={() => navigate("support-ops")}><HeadphonesIcon className="mr-2 h-4 w-4" />Support Ops</CommandItem>
          <CommandItem onSelect={() => navigate("notifications-mgmt")}><Bell className="mr-2 h-4 w-4" />Notifications</CommandItem>
          <CommandItem onSelect={() => navigate("settings")}><Settings className="mr-2 h-4 w-4" />Settings</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Maintenance Actions">
          <CommandItem onSelect={() => action("clear_cache")}><Trash2 className="mr-2 h-4 w-4" />Clear Cache</CommandItem>
          <CommandItem onSelect={() => action("refresh_sessions")}><RefreshCw className="mr-2 h-4 w-4" />Refresh Sessions</CommandItem>
          <CommandItem onSelect={() => action("resync_products")}><Package className="mr-2 h-4 w-4" />Resync Products</CommandItem>
          <CommandItem onSelect={() => action("resync_prices")}><DollarSign className="mr-2 h-4 w-4" />Resync Prices</CommandItem>
          <CommandItem onSelect={() => action("resync_stock")}><Database className="mr-2 h-4 w-4" />Resync Stock</CommandItem>
          <CommandItem onSelect={() => action("reindex_search")}><Search className="mr-2 h-4 w-4" />Reindex Search</CommandItem>
          <CommandItem onSelect={() => action("retry_failed")}><RotateCcw className="mr-2 h-4 w-4" />Retry Failed Jobs</CommandItem>
          <CommandItem onSelect={() => action("pause_automations")}><Pause className="mr-2 h-4 w-4" />Pause Automations</CommandItem>
          <CommandItem onSelect={() => action("resume_automations")}><Play className="mr-2 h-4 w-4" />Resume Automations</CommandItem>
          <CommandItem onSelect={() => action("maintenance_mode")}><Wrench className="mr-2 h-4 w-4" />Toggle Maintenance Mode</CommandItem>
          <CommandItem onSelect={() => action("restore_backup")}><HardDrive className="mr-2 h-4 w-4" />Restore Last Backup</CommandItem>
          <CommandItem onSelect={() => action("rollback_changes")}><RotateCcw className="mr-2 h-4 w-4" />Rollback Recent Changes</CommandItem>
          <CommandItem onSelect={() => action("refresh_integrations")}><Link2 className="mr-2 h-4 w-4" />Refresh Integration Connections</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

export default CommandPalette;
