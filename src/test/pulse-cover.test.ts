import { describe, it, expect } from "vitest";
import { hashString, coverArt, motifDataUri } from "@/lib/pulse-cover";

describe("hashString", () => {
  it("is stable across calls", () => {
    expect(hashString("https://example.com/a")).toBe(hashString("https://example.com/a"));
  });

  it("distinguishes anagrams and shared prefixes", () => {
    // Publisher URLs share long prefixes; a positional-blind hash would give
    // every story from one site the same cover.
    expect(hashString("abc")).not.toBe(hashString("cba"));
    expect(hashString("https://techcabal.com/2026/07/story-one"))
      .not.toBe(hashString("https://techcabal.com/2026/07/story-two"));
  });

  it("stays a 32-bit unsigned integer", () => {
    for (const s of ["", "a", "https://example.com/" + "x".repeat(500), "研究 AI"]) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("coverArt", () => {
  it("gives the same story the same cover every time", () => {
    const a = coverArt("https://arxiv.org/abs/2607.01234", "research");
    const b = coverArt("https://arxiv.org/abs/2607.01234", "research");
    expect(a).toEqual(b);
  });

  it("keeps categories visually distinct", () => {
    // Local African stories must not be indistinguishable from arXiv papers.
    const research = coverArt("same-seed", "research");
    const local = coverArt("same-seed", "local");
    expect(research.background).not.toBe(local.background);
  });

  it("falls back to the news palette for an unknown category", () => {
    const unknown = coverArt("seed", "not-a-real-category");
    expect(unknown.background).toBe(coverArt("seed", "news").background);
  });

  it("survives an empty seed", () => {
    const art = coverArt("", "news");
    expect(art.background).toContain("linear-gradient");
    expect(art.ink).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("spreads real URLs across the available covers", () => {
    // The whole point is that the feed stops looking like one repeated tile.
    const urls = Array.from({ length: 120 }, (_, i) => `https://news.example/story-${i}`);
    const combos = new Set(urls.map((u) => {
      const a = coverArt(u, "news");
      return `${a.background}|${a.motif}|${a.angle}`;
    }));
    expect(combos.size).toBeGreaterThan(20);
  });

  it("only emits motifs it can actually draw", () => {
    const known = new Set(["grid", "rays", "dots", "waves", "arcs"]);
    for (let i = 0; i < 200; i++) {
      expect(known.has(coverArt(`seed-${i}`, "news").motif)).toBe(true);
    }
  });
});

describe("motifDataUri", () => {
  it("produces a usable CSS url() for every motif", () => {
    for (let i = 0; i < 60; i++) {
      const uri = motifDataUri(coverArt(`s${i}`, "local"));
      expect(uri.startsWith('url("data:image/svg+xml,')).toBe(true);
      expect(uri.endsWith('")')).toBe(true);
      // Unescaped quotes or '#' would terminate the url() early and silently
      // render nothing.
      const inner = uri.slice('url("data:image/svg+xml,'.length, -2);
      expect(inner).not.toContain('"');
      expect(inner).not.toContain("#");
      expect(decodeURIComponent(inner)).toContain("<svg");
    }
  });

  it("never throws on non-Latin-1 input", () => {
    expect(() => motifDataUri(coverArt("研究・AI・모델", "research"))).not.toThrow();
  });
});
