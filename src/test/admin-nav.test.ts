import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Guards the admin against the failure that prompted the regroup: a screen
// that exists, is wired into Admin.tsx, and has no way to reach it -- or a nav
// entry pointing at a screen that renders nothing. Both look like "the admin is
// scattered" from the outside, and neither is visible in a type error, because
// the sidebar builds its list from data rather than from the union.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const sidebar = read("src/components/admin/AdminSidebar.tsx");
const adminPage = read("src/pages/Admin.tsx");

/** Every id in the AdminTab union. */
const unionTabs = (() => {
  const start = sidebar.indexOf("export type AdminTab =");
  const end = sidebar.indexOf(";", start);
  return [...sidebar.slice(start, end).matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
})();

/** Every id reachable from the sidebar's SECTIONS. */
const navTabs = (() => {
  const start = sidebar.indexOf("const SECTIONS: SectionDef[]");
  const end = sidebar.indexOf("const tabs:", start);
  return [...sidebar.slice(start, end).matchAll(/id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
})();

/** Every id Admin.tsx actually renders a module for. */
const renderedTabs = [...adminPage.matchAll(/activeTab === "([a-z0-9-]+)"/g)].map((m) => m[1]);

describe("admin navigation", () => {
  it("has a real union to check against", () => {
    expect(unionTabs.length).toBeGreaterThan(20);
  });

  it("every screen in the union is reachable from the sidebar", () => {
    const unreachable = unionTabs.filter((t) => !navTabs.includes(t));
    expect(unreachable, `unreachable admin screens: ${unreachable.join(", ")}`).toEqual([]);
  });

  it("every sidebar entry renders a module", () => {
    const dead = navTabs.filter((t) => !renderedTabs.includes(t));
    expect(dead, `sidebar links to screens that render nothing: ${dead.join(", ")}`).toEqual([]);
  });

  it("every rendered module is reachable", () => {
    const orphans = renderedTabs.filter((t) => !navTabs.includes(t));
    expect(orphans, `modules with no way in: ${orphans.join(", ")}`).toEqual([]);
  });

  it("lists no screen twice", () => {
    const dupes = navTabs.filter((t, i) => navTabs.indexOf(t) !== i);
    expect(dupes, `duplicated nav entries: ${dupes.join(", ")}`).toEqual([]);
  });

  it("keeps every section small enough to scan", () => {
    // The point of the regroup. Seven or so is about where a list stops being
    // read and starts being scrolled past -- which is how a stuck sync sat
    // unnoticed behind a wall of similarly-named health screens.
    const oversized = [...sidebar.matchAll(/title: "([^"]+)"[\s\S]*?items: \[([\s\S]*?)\n  \],/g)]
      .map(([, title, body]) => ({ title, count: (body.match(/id:\s*"/g) ?? []).length }))
      .filter((s) => s.count > 7);
    expect(oversized.map((s) => `${s.title} (${s.count})`)).toEqual([]);
  });
});
