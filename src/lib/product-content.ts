import { buildSpecifications } from "@/lib/specifications";
import type { Product } from "@/contexts/CartContext";

/**
 * Product content engine — the "SEO on steroids" switch.
 *
 * THE PROBLEM IT SOLVES
 * ---------------------
 * 2 853 of 3 488 active products have a description under 40 characters and
 * 3 482 have no stored specifications. Every product page is therefore a thin
 * page: nothing for Google to index, nothing for a shopper to read, and 3 488
 * wasted chances to rank for long-tail queries like
 * "Dell Pro Webcam WB5023 price South Africa".
 *
 * WHAT IT IS NOT
 * --------------
 * It does not invent claims. Every sentence is assembled from facts already in
 * the record — the supplier title, brand, category, price band, stock state,
 * and the specifications parsed out of the product name by specifications.ts.
 * If a fact is absent the sentence that would have used it is dropped, rather
 * than filled with a plausible guess. Fabricated specs on a commercial
 * storefront are a Consumer Protection Act problem, not just an SEO one.
 *
 * IT IS OFF BY DEFAULT
 * --------------------
 * Nothing here renders until `seo.content_engine` is switched on in
 * store_settings (Admin → Home Merchandising → Search visibility). Generated
 * copy across 3 488 pages is a deliberate, reversible business decision about
 * how the store presents itself to Google — not something to switch on behind
 * the owner's back.
 */

export interface GeneratedContent {
  /** 1–3 sentences. Safe to render as the product's lead paragraph. */
  description: string;
  /** <=155 chars, for <meta name="description">. */
  metaDescription: string;
  /** Question/answer pairs, also emitted as FAQPage JSON-LD. */
  faqs: { question: string; answer: string }[];
  /** Short factual bullets under the fold. */
  highlights: string[];
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const article = (word: string) =>
  VOWELS.has((word[0] ?? "").toLowerCase()) ? "an" : "a";

/** How the category reads inside a sentence, singular and lower-case. */
const CATEGORY_NOUN: Record<string, string> = {
  "Laptops": "laptop",
  "Peripherals": "peripheral",
  "Monitors & Displays": "monitor",
  "Storage": "storage drive",
  "Memory": "memory module",
  "Networking": "networking device",
  "Smart Home": "smart home device",
  "Wearables": "wearable",
  "Health & Wellness": "health device",
  "Desktops & Workstations": "desktop system",
  "GPUs & AI Accelerators": "graphics accelerator",
  "Printer Consumables": "printer consumable",
  "Cables & Connectivity": "cable",
  "Accessories (General)": "accessory",
};

const priceBand = (price: number): string => {
  if (price < 500) return "an easy add-on buy";
  if (price < 1500) return "priced for everyday upgrades";
  if (price < 4000) return "in the mid-range bracket";
  if (price < 8000) return "a considered purchase";
  return "a premium pick";
};

/**
 * Deterministic: the same product always yields the same copy. That matters
 * because Google treats content that changes on every crawl as unstable, and
 * because a support agent quoting the page needs it to still say that tomorrow.
 */
export function generateContent(
  product: Product,
  stored?: Record<string, unknown> | null,
): GeneratedContent {
  const brand = product.brand?.trim() || "";
  const category = product.category?.trim() || "";
  const noun = CATEGORY_NOUN[category] || "product";
  const specGroups = buildSpecifications(product, stored);
  // Only the technical group. "Product details" repeats brand, category and
  // stock, which the surrounding sentences already say -- restating them would
  // read as padding to a shopper and as boilerplate to a search engine.
  const specs = specGroups.find((g) => g.title === "Technical specifications")?.items ?? [];

  // --- lead paragraph -----------------------------------------------------
  const sentences: string[] = [];

  const opener = brand
    ? `The ${product.name} is ${article(brand)} ${brand} ${noun}`
    : `The ${product.name} is ${article(noun)} ${noun}`;
  sentences.push(`${opener} available from AI Smart Store in South Africa.`);

  const headline = specs.slice(0, 3).filter((s) => s.value);
  if (headline.length > 0) {
    const parts = headline.map((s) => `${s.label.toLowerCase()} of ${s.value}`);
    const joined =
      parts.length === 1
        ? parts[0]
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    sentences.push(`It lists ${joined}.`);
  }

  if (product.price > 0) {
    sentences.push(
      `At R${Math.round(product.price).toLocaleString("en-ZA")} including VAT it is ${priceBand(product.price)}, with delivery across South Africa.`,
    );
  }

  const description = sentences.join(" ");

  // --- meta description ---------------------------------------------------
  // Google truncates around 155 characters, so this is built short rather than
  // trimmed long: a sentence cut mid-word reads as broken in the SERP.
  const metaBits = [
    product.name,
    brand && `by ${brand}`,
    product.price > 0 && `R${Math.round(product.price).toLocaleString("en-ZA")}`,
    product.inStock ? "In stock" : "Available to order",
    "SA-wide delivery",
  ].filter(Boolean) as string[];
  let metaDescription = metaBits.join(" · ");
  if (metaDescription.length > 155) metaDescription = `${metaDescription.slice(0, 152).trimEnd()}…`;

  // --- FAQs ---------------------------------------------------------------
  // Only questions the record can actually answer. An FAQ block padded with
  // invented answers is worse than none: it is both a trust problem and, under
  // Google's guidelines, a reason to drop the rich result entirely.
  const faqs: { question: string; answer: string }[] = [];

  if (product.price > 0) {
    faqs.push({
      question: `How much does the ${product.name} cost in South Africa?`,
      answer: `It is R${Math.round(product.price).toLocaleString("en-ZA")}, VAT included, from AI Smart Store.`,
    });
  }

  faqs.push({
    question: `Is the ${product.name} in stock?`,
    answer: product.inStock
      ? "Yes — it is in stock and dispatches on the next working-day dispatch run."
      : "It is currently on backorder. The product page shows a live dispatch estimate before you check out.",
  });

  faqs.push({
    question: `Do you deliver the ${product.name} across South Africa?`,
    answer:
      "Yes. We deliver to all nine provinces via The Courier Guy, and the delivery window shown on the product page is calculated for your province, allowing for weekends and public holidays.",
  });

  if (specs.length > 0) {
    faqs.push({
      question: `What are the specifications of the ${product.name}?`,
      answer: `${specs
        .slice(0, 5)
        .map((s) => `${s.label}: ${s.value}`)
        .join("; ")}.`,
    });
  }

  // --- highlights ---------------------------------------------------------
  const highlights: string[] = [];
  if (brand) highlights.push(`Genuine ${brand} product`);
  if (category) highlights.push(category);
  for (const s of specs.slice(0, 4)) highlights.push(`${s.label}: ${s.value}`);
  highlights.push(product.inStock ? "In stock now" : "Available to order");
  highlights.push("VAT included · SA-wide delivery");

  return { description, metaDescription, faqs, highlights };
}

/**
 * FAQPage structured data. Returned separately from the copy so a caller can
 * render the visible block and the schema independently — Google requires the
 * answers to be visible on the page, so the two must not drift apart.
 */
export function faqJsonLd(content: GeneratedContent) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}
