import { describe, it, expect } from "vitest";
import { extractSpecs, buildSpecifications } from "@/lib/specifications";

const val = (items: { label: string; value: string }[], label: string) =>
  items.find((i) => i.label === label)?.value;

/** Real product names taken from the live catalogue. */
describe("extractSpecs", () => {
  it("reads capacity, interface and form factor off a drive", () => {
    const s = extractSpecs("HPE 1.92T NVMeRI SFF BC U.3ST V2 MV SSD");
    expect(val(s, "Capacity")).toBe("1.92TB");
    expect(val(s, "Drive type")).toBe("NVMe SSD");
    expect(val(s, "Form factor")).toBe("SFF");
  });

  it("reads rotational speed on a spinning disk", () => {
    const s = extractSpecs("HPE MSA 1.8TB SAS 10K SFF M2 HDD");
    expect(val(s, "Capacity")).toBe("1.8TB");
    expect(val(s, "Interface")).toBe("SAS");
    expect(val(s, "Rotational speed")).toBe("10K RPM");
  });

  it("parses a slash-delimited laptop name", () => {
    const s = extractSpecs(
      'Dell Latitude 5330/Core i5 1235U/8GB/Cant Upg Mem/256GB SSD/13.3" FHD/W11Pro/ 3Y ProSpt',
    );
    expect(val(s, "Processor")).toBe("Core i5 1235U");
    expect(val(s, "Display")).toBe('13.3" FHD');
    expect(val(s, "Operating system")).toMatch(/Windows ?11 ?Pro/i);
    expect(val(s, "Warranty")).toBe("3 years");
  });

  it("handles the multiline server description format", () => {
    const s = extractSpecs(
      "3.4GHz 4c 1P 32GB-U 4LFF\n2x960GB SSD 800W RPS EU Server\nHPE ProLiant ML30 Gen11\n" +
        "32 GB (1x32 GB UDIMM, 4800 MT/s)\n4U Tower\nServer Warranty includes 3-Year Parts",
    );
    expect(val(s, "Memory")).toBe("32GB");
    expect(val(s, "Memory speed")).toBe("4800 MT/s");
    expect(val(s, "Power supply")).toBe("800W");
    expect(val(s, "Rack height")).toBe("4U");
  });

  it("reads rack height off a rack cabinet", () => {
    expect(val(extractSpecs("HPE 42U 800x1200 Ent G2 NW Shock Rack"), "Rack height")).toBe("42U");
  });

  it("reads cable length without inventing other specs", () => {
    const s = extractSpecs("HPE 1.9M C13 to BS 1363/A Pwr Cord");
    expect(val(s, "Cable length")).toBe("1.9 m");
    expect(val(s, "Capacity")).toBeUndefined();
  });

  // Regressions found by running the parser over 25 random live product names
  // rather than hand-written fixtures. Both were confidently-wrong rows, which
  // is worse than showing nothing.
  it("does not read gigabit network speed as storage capacity", () => {
    const s = extractSpecs("HPE 100Gb QSFP28 MPO SR4 100m XCVR");
    expect(val(s, "Capacity")).toBeUndefined();
    expect(val(s, "Network speed")).toBe("100GbE");
  });

  it("does not read a gigabyte drive as a network link", () => {
    const s = extractSpecs("HPE 960GB SATA MU SFF SC MV SSD");
    expect(val(s, "Capacity")).toBe("960GB");
    expect(val(s, "Network speed")).toBeUndefined();
  });

  it("recognises EPYC part numbers that embed a letter", () => {
    expect(val(extractSpecs("AMD EPYC 73F3 CPU for HPE"), "Processor")).toBe("EPYC 73F3");
  });

  it("returns nothing for names that carry no real specs", () => {
    for (const name of ["AFCSJMTM-00 Soft Jumper", "HPE Standard Product Reporting Service", ""]) {
      expect(extractSpecs(name).length).toBe(0);
    }
  });

  it("never emits duplicate labels", () => {
    const s = extractSpecs("HPE 960GB SAS RI SFF SC MV SSD 1.92TB SAS");
    expect(new Set(s.map((i) => i.label)).size).toBe(s.length);
  });

  it("tolerates null and undefined", () => {
    expect(extractSpecs(null)).toEqual([]);
    expect(extractSpecs(undefined)).toEqual([]);
  });
});

describe("buildSpecifications", () => {
  const base = {
    name: "HPE 960GB SAS RI SFF SC MV SSD",
    description: "HPE 960GB SAS RI SFF SC MV SSD",
    brand: "HPE",
    sku: "P19974-B21",
    category: "Storage",
    inStock: false,
    stockQuantity: undefined,
  };

  it("always produces product details, even with no parseable specs", () => {
    const groups = buildSpecifications({ ...base, name: "Soft Jumper", description: "Soft Jumper" });
    const details = groups.find((g) => g.title === "Product details");
    expect(details).toBeDefined();
    expect(val(details!.items, "Brand")).toBe("HPE");
    expect(val(details!.items, "Product code")).toBe("P19974-B21");
    expect(val(details!.items, "Availability")).toBe("Available on backorder");
  });

  it("reports in-stock quantity when known", () => {
    const groups = buildSpecifications({ ...base, inStock: true, stockQuantity: 7 });
    const details = groups.find((g) => g.title === "Product details")!;
    expect(val(details.items, "Availability")).toBe("In stock (7 available)");
  });

  it("lets supplier data win over derived values", () => {
    const groups = buildSpecifications(base, { Capacity: "960GB (supplier confirmed)", supplier: "GeeWiz" });
    const tech = groups.find((g) => g.title === "Technical specifications")!;
    expect(val(tech.items, "Capacity")).toBe("960GB (supplier confirmed)");
    expect(tech.items.filter((i) => i.label === "Capacity")).toHaveLength(1);
  });

  it("hides internal bookkeeping keys from shoppers", () => {
    const groups = buildSpecifications(base, {
      supplier: "GeeWiz", manually_sourced: true, checked_at: "2026-07-19", supplier_sku: "GW-T-123",
    });
    const labels = groups.flatMap((g) => g.items.map((i) => i.label.toLowerCase()));
    expect(labels).not.toContain("manually sourced");
    expect(labels).not.toContain("checked at");
    expect(labels).not.toContain("supplier sku");
    expect(labels).toContain("supplier");
  });
});
