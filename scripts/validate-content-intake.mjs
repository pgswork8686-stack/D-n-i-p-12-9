#!/usr/bin/env node
// Validates import preparation only. NEVER imports or publishes real data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["products", "services", "articles"];
const errors = [];
const allowedStatuses = new Set(["DRAFT", "ACTIVE", "ARCHIVED"]);

function missing(item, field) {
  const value = item[field];
  return value === undefined || value === null || (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && value.length === 0);
}
function validHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !/(^|\\.)example\\.(com|org|test|invalid)$/.test(url.hostname) &&
      url.hostname !== "localhost";
  } catch { return false; }
}

for (const name of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(path.join(root, "content", "intake", name + ".template.json"), "utf8"));
  } catch (err) {
    errors.push(name + ": missing or malformed JSON");
    continue;
  }
  if (!Array.isArray(data)) { errors.push(name + ": expected JSON array"); continue; }
  const slugs = new Set();
  data.forEach((item, index) => {
    const where = name + "[" + index + "]";
    if (!item || typeof item !== "object" || Array.isArray(item)) { errors.push(where + " must be an object"); return; }
    if (!allowedStatuses.has(item.status)) errors.push(where + " invalid status");
    if (item.slug) {
      if (typeof item.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) errors.push(where + " malformed slug");
      if (slugs.has(item.slug)) errors.push(where + " duplicate slug");
      slugs.add(item.slug);
    }
    if (Object.keys(item).some(k => /(password|secret|apiKey|privateKey|serviceRoleKey|customerEmail)/i.test(k))) {
      errors.push(where + " contains a forbidden secret/PII field");
    }
    // DRAFT means intentionally incomplete, NEVER publish incomplete entries.
    if (item.status !== "ACTIVE") return;
    const needed = name === "products" ?
      ["name", "slug", "shortDescription", "description", "thumbnailUrl", "categorySlugs", "variants", "licenseEvidence", "supportPolicyUrl"] :
      name === "services" ?
      ["name", "slug", "summary", "description", "features", "processSteps", "scopeOfDelivery", "privacyPolicyUrl"] :
      ["title", "slug", "excerpt", "body", "categorySlugs", "featuredImageUrl", "featuredImageAlt", "metaTitle", "metaDescription", "authorName"];
    for (const field of needed) if (missing(item, field)) errors.push(where + " ACTIVE requires " + field);
    if (name === "products") {
      if (item.thumbnailUrl && !validHttps(item.thumbnailUrl)) errors.push(where + " thumbnailUrl must be a real HTTPS URL");
      if (item.supportPolicyUrl && !validHttps(item.supportPolicyUrl)) errors.push(where + " supportPolicyUrl must be HTTPS");
      for (const variant of Array.isArray(item.variants) ? item.variants : []) {
        if (!variant || !Number.isSafeInteger(variant.amountVnd) || variant.amountVnd < 0 ||
          !variant.sku || !variant.name) errors.push(where + " variant must include SKU, name and nonnegative integer VND price");
      }
    }
    if (name === "services" && item.privacyPolicyUrl && !validHttps(item.privacyPolicyUrl)) {
      errors.push(where + " privacyPolicyUrl must be real HTTPS URL");
    }
    if (name === "articles" && item.featuredImageUrl && !validHttps(item.featuredImageUrl)) {
      errors.push(where + " featuredImageUrl must be real HTTPS URL");
    }
  });
}
if (errors.length) {
  for (const e of errors) console.error("[FAIL] " + e);
  process.exit(1);
}
console.log("[PASS] All content intake templates validate; no data was imported or published.");
