#!/usr/bin/env node
/**
 * Figma → tokens sync script
 *
 * Fetches the AAI Components page from the Figma file,
 * extracts design tokens (colors, fonts, spacing),
 * and writes them to src/tokens.json.
 *
 * Usage:  npm run sync
 * Requires: FIGMA_API_KEY and FIGMA_FILE_ID in .env
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Load .env manually (no deps) ──────────────────────────────────────────────
function loadEnv() {
  try {
    const envPath = resolve(ROOT, ".env");
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const match = line.match(/^(\w+)=(.*)$/);
      if (match) process.env[match[1]] = match[2].trim();
    }
  } catch (_) {
    // .env not found — rely on process.env from CI/Vercel
  }
}
loadEnv();

const API_KEY = process.env.FIGMA_API_KEY;
const FILE_ID = process.env.FIGMA_FILE_ID;

if (!API_KEY || !FILE_ID) {
  console.error("❌  Missing FIGMA_API_KEY or FIGMA_FILE_ID in .env");
  process.exit(1);
}

// ─── Figma REST API fetch ──────────────────────────────────────────────────────
async function figmaGet(path) {
  const res = await fetch(`https://api.figma.com/v1${path}`, {
    headers: { "X-Figma-Token": API_KEY },
  });
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Color helpers ─────────────────────────────────────────────────────────────
function rgbToHex(r, g, b) {
  const toHex = (v) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function extractFills(node) {
  const fills = node.fills || [];
  const solid = fills.find((f) => f.type === "SOLID" && f.visible !== false);
  if (!solid) return null;
  const { r, g, b } = solid.color;
  return rgbToHex(r, g, b);
}

// ─── Walk nodes to collect colors and fonts ────────────────────────────────────
function collectTokens(node, colors, fonts) {
  // Collect fill colors
  const hex = extractFills(node);
  if (hex && hex !== "#FFFFFF" && hex !== "#000000") {
    colors.add(hex);
  }

  // Collect font info
  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    fonts.add(`${s.fontFamily}/${s.fontWeight}/${s.fontSize}`);
  }

  // Recurse
  for (const child of node.children || []) {
    collectTokens(child, colors, fonts);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔄  Fetching Figma file…");
  const file = await figmaGet(`/files/${FILE_ID}`);

  // Find the AAI Components page
  const componentsPage = file.document.children.find(
    (p) => p.name.includes("AAI Components") || p.name.includes("🧩")
  );

  if (!componentsPage) {
    console.error("❌  Could not find 🧩 AAI Components page in Figma file");
    process.exit(1);
  }

  console.log(`📄  Found page: "${componentsPage.name}"`);

  const colors = new Set();
  const fonts = new Set();
  collectTokens(componentsPage, colors, fonts);

  // Map collected hex colors to semantic names (best-effort matching)
  const COLOR_MAP = {
    "#D9D9D9": "imgGray",
    "#BCBCBC": "imgGrayDk",
    "#F5F5F5": "sectionBg",
    "#EEEEEE": "filterBg",
    "#E4E4E4": "memberLogo",
    "#CACACA": "navBar",
    "#F5F5F5": "linkRect",
  };

  const tokenColors = { white: "#FFFFFF", black: "#000000" };
  for (const hex of colors) {
    const name = COLOR_MAP[hex] || `color_${hex.slice(1).toLowerCase()}`;
    tokenColors[name] = hex;
  }

  // Build tokens object
  const tokens = {
    colors: tokenColors,
    spacing: {
      pageWidth: 1536,
      pageMargin: 96,
    },
    fonts: {
      sans: '"Inter", system-ui, sans-serif',
      serif: 'Georgia, "Times New Roman", serif',
    },
    _meta: {
      syncedAt: new Date().toISOString(),
      figmaFile: FILE_ID,
      fontsFound: [...fonts].sort(),
    },
  };

  const outPath = resolve(ROOT, "src", "tokens.json");
  writeFileSync(outPath, JSON.stringify(tokens, null, 2) + "\n");
  console.log(`✅  Wrote ${Object.keys(tokenColors).length} colors to src/tokens.json`);
  console.log(`📝  Fonts found: ${[...fonts].join(", ")}`);
}

main().catch((err) => {
  console.error("❌ ", err.message);
  process.exit(1);
});
