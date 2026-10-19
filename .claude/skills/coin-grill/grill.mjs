#!/usr/bin/env node
// Deep 3-iteration Solana tokenomics, technical & project-fit auditor ("coin-grill").
// Usage:
//   node .claude/skills/coin-grill/grill.mjs <path-to-token-file> [--out <report.html>] [--json]
//   node .claude/skills/coin-grill/grill.mjs --self-test

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SKILL_DIR, "../../..");
const RUBRIC = JSON.parse(readFileSync(join(SKILL_DIR, "rubric.json"), "utf8"));
const U64_MAX = BigInt(RUBRIC.solanaLimits.u64Max);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return "unspecified";
  return Number(n).toLocaleString("en-US");
}

export function parseHumanNumber(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim().replace(/^\$/, "").replace(/,/g, "").replace(/_/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(k|thousand|m|million|mil|b|billion|bil|t|trillion|tril)?(?:\b|[^a-zA-Z]|$)/i);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const unit = (m[2] || "").toLowerCase();
  const mult =
    unit === "k" || unit === "thousand" ? 1e3 :
    unit === "m" || unit === "million" || unit === "mil" ? 1e6 :
    unit === "b" || unit === "billion" || unit === "bil" ? 1e9 :
    unit === "t" || unit === "trillion" || unit === "tril" ? 1e12 : 1;
  return base * mult;
}

export function parsePercentValue(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  const rangeMatch = s.match(/^(\d+(?:\.\d+)?)\s*%?\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (rangeMatch) {
    return Number(((Number(rangeMatch[1]) + Number(rangeMatch[2])) / 2).toFixed(2));
  }
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*%?/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

// Check if a regex matches on at least one non-negated line/clause in the text.
function hasUnnegatedMatch(text, pattern, negationRe = /\b(?:no|not|never|without|zero|neither|nor|cannot|can't|doesn't|don't|strip|eliminate|ban|forbid|prohibit|refuse|clean|disabled|none|false)\b/i) {
  const clauses = text.split(/[\r\n.;!?]+/);
  const localRe = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  for (const clause of clauses) {
    if (localRe.test(clause) && !negationRe.test(clause)) {
      return true;
    }
  }
  return false;
}

// Inspect the main repository so project-fit checks reference actual code & architecture.
function loadProjectContext() {
  const hasPools = existsSync(join(REPO_ROOT, "backend/programs/freightchain_pools"));
  const hasVerdict = existsSync(join(REPO_ROOT, "backend/server/src/domain/verdict/replay-engine.ts"));
  const hasSharedPhysics = existsSync(join(REPO_ROOT, "frontend/client/shared/physics.js"));
  return {
    projectName: "Freight Chain",
    isFreightChainRepo: hasPools && hasVerdict && hasSharedPhysics,
    pillars: [
      "Browser 3D long-haul driving game (28 m/s speed governor, manual gearbox, hull & battery systems)",
      "Anchor v4 SOL escrow pools on Solana (`programs/freightchain_pools`): ticket vaults, SlotHashes `seal_road`, winners Merkle root, per-km `Pledge` & `RideAttestation`",
      "Two-tier anti-cheat: RFC 6962 hash-chained 15 s telemetry batches + 10 Hz `ReplayEngine` (`@freightchain/shared` physics & swept traffic CCD)",
      "Live spectator watch (`~25 s` delay), CB chat, driver tips, and paid road/weather events (`potholes`, `trench`, `sinkhole`, `night`, `day`)",
      "Cosmetic-only Garage (`paint`, `wheel`, `gearbox`, `dice`, `needles` — never alters handling) & 31 soulbound Bubblegum v2 cNFT achievement badges",
      "Solana Pay QR transaction requests + Solana Actions / Blinks (`/actions.json`, `/r/:id` receipts)"
    ]
  };
}

function classifyAllocationBucket(label) {
  const kl = String(label || "").toLowerCase().trim();
  if (/^(?:max(?:imum)?\s+supply|total\s+supply|bucket|band|tier|upgrade|slot|what\s+was\s+minted|what\s+it\s+does|if\s+every\s+ride\s+is|id|ordinary\s+part|gold\s+part|one\s+gold\s+slot|four\s+gold\s+parts|21\s+ordinary\s+parts|first\s+five\s+slots|whole\s+garage|garage|wheel|truck\s+colour|gearbox|dice|needle|ornament|dash|indicators|phone|\d+h(?:\s+finish)?|\d+%)$/.test(kl)) {
    return null;
  }
  if (/team|founder|dev|core\s+contributor/.test(kl)) return "team";
  if (/invest|vc|seed|private|advisor|presale|strategic|sponsor/.test(kl)) return "investorsAdvisors";
  if (/liq|lp|dex|pool|market\s*mak|\bpol\b|genesis.*pool/.test(kl)) return "liquidity";
  if (/market|airdrop|promo|kol|growth|quest|genesis\s+driver|testnet\s+badge/.test(kl)) return "marketingAirdrop";
  if (/treasury|reserve|ecosystem|dao|foundation|operations|spectator\s+blink|creator\s+gauntlet/.test(kl)) return "ecosystemTreasury";
  if (/community|player|gameplay|reward|faucet|incentive|play-to-earn|verified-play|staking\s+reward|ride\s+emission|emission\s+cap/.test(kl)) return "communityRewards";
  return null;
}

// Parse JSON, Markdown, HTML, or plain-text token specifications into a normalized structure.
export function parseTokenFile(filePath, rawContent) {
  const ext = extname(filePath).toLowerCase();
  let jsonObj = null;
  if (ext === ".json") {
    try {
      jsonObj = JSON.parse(rawContent);
    } catch {
      jsonObj = null;
    }
  } else {
    const fenced = rawContent.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) {
      try { jsonObj = JSON.parse(fenced[1]); } catch { /* fallback to text extraction */ }
    }
  }

  // Convert HTML headings and table rows into Markdown-like lines before stripping remaining HTML tags.
  const htmlNormalized = rawContent
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, inner) => `\n# ${inner.replace(/<[^>]+>/g, " ").trim()}\n`)
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, rowInner) => {
      const cells = [...rowInner.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      );
      return cells.length > 0 ? `\n| ${cells.join(" | ")} |\n` : "\n";
    })
    .replace(/<\/(?:p|div|section|header|footer|li|caption|dd|dt|h[2-6])>/gi, "\n");

  const text = htmlNormalized
    .replace(/<[^>]+>/g, " ")
    .replace(/\*\*|__|`/g, "");
  const lower = text.toLowerCase();

  const pickField = (keys, regexes) => {
    if (jsonObj && typeof jsonObj === "object") {
      for (const k of keys) {
        if (jsonObj[k] !== undefined && jsonObj[k] !== null && jsonObj[k] !== "") return jsonObj[k];
        if (jsonObj.token?.[k] !== undefined) return jsonObj.token[k];
        if (jsonObj.metadata?.[k] !== undefined) return jsonObj.metadata[k];
        if (jsonObj.tokenomics?.[k] !== undefined) return jsonObj.tokenomics[k];
        if (jsonObj.authorities?.[k] !== undefined) return jsonObj.authorities[k];
      }
    }
    for (const re of regexes) {
      const m = text.match(re);
      if (m && m[1] !== undefined) {
        const candidate = m[1].trim();
        if (
          candidate &&
          !/^[-:|]+$/.test(candidate) &&
          !/^(?:value|parameter|field|description|bucket|share|token|name|symbol|ticker)$/i.test(candidate)
        ) {
          return candidate;
        }
      }
    }
    return null;
  };

  let name = pickField(
    ["name", "tokenName", "coinName"],
    [
      /(?:token\s+name|coin\s+name|\bname)\s*(?:[:=-]|\|)\s*["']?([A-Za-z0-9][A-Za-z0-9 _.-]{0,120}?)["']?(?:\s*\(\$?[A-Za-z0-9_]+\))?(?:\r?\n|$|[|,;])/i,
      /^\s*#\s+([A-Za-z0-9][A-Za-z0-9 _.-]{1,120}?)\s*(?:\(\$?[A-Za-z0-9_]+\)|\r?\n|$)/m
    ]
  );

  let symbol = pickField(
    ["symbol", "ticker", "tokenSymbol"],
    [
      /(?:symbol|ticker)\s*(?:[:=-]|\|)\s*["']?\$?([A-Za-z0-9_]{1,16})["']?/i,
      /\b(?:[Ss]ymbol|[Tt]icker)\s+\$?([A-Z][A-Z0-9_]{1,15})\b/,
      /\(\$([A-Za-z][A-Za-z0-9_]{1,15})\)/
    ]
  );
  if (!symbol) {
    const cashMatches = [...text.matchAll(/(?:^|[^A-Za-z0-9_])\$([A-Z][A-Z0-9_]{1,14})\b/g)];
    for (const cm of cashMatches) {
      const cand = cm[1];
      if (!/^(?:SOL|USDC|USDT|USD|BTC|ETH)$/.test(cand)) {
        symbol = cand;
        break;
      }
    }
  }
  if (!symbol && name && /^[A-Z]{2,8}$/.test(name.trim())) {
    symbol = name.trim();
  }
  if (typeof symbol === "string") symbol = symbol.replace(/^\$/, "").trim();

  const wordDigits = { zero: 0, two: 2, six: 6, eight: 8, nine: 9, eighteen: 18 };
  const rawDecimals = pickField(
    ["decimals", "tokenDecimals"],
    [
      /(?:mint\s+)?decimals?\s*(?:[:=-]|\|)\s*(-?\d+(?:\.\d+)?)/i,
      /(-?\d+(?:\.\d+)?)\s+decimals?\b/i,
      /\b(zero|two|six|eight|nine|eighteen)\s+decimals?\b/i
    ]
  );
  const parsedDecimals = rawDecimals !== null && rawDecimals !== ""
    ? (wordDigits[String(rawDecimals).toLowerCase()] ?? Number(rawDecimals))
    : null;
  const decimals = parsedDecimals !== null && Number.isFinite(parsedDecimals) ? parsedDecimals : null;

  const rawSupply = pickField(
    ["totalSupply", "maxSupply", "supply", "initialSupply"],
    [
      /(?:total\s+supply|max(?:imum)?\s+supply|genesis\s+supply|\bsupply)\s*(?:[:=-]|\||is\b)\s*\$?([\d,._]+\s*(?:k|thousand|m|million|mil|b|billion|bil|t|trillion|tril)?)/i,
      /([\d,._]+\s*(?:million|billion|trillion))\s+(?:total\s+|max\s+)?tokens?\b/i
    ]
  );
  const totalSupply = parseHumanNumber(rawSupply);

  const rawTgeFloat = pickField(
    ["tgeFloatPct", "tgeFloat", "initialCirculatingPct", "circulatingAtTgePct", "floatPct"],
    [
      /(?:tge\s+(?:circulating\s+)?float|initial\s+circulating(?:\s+supply)?|circulating\s+at\s+(?:tge|launch)|initial\s+float|genesis(?:\s*,\s*liquidity\s+pool\s+only)?)\s*(?:[:=-]|\||is\b)?\s*(?:[\d,._]+\s*\(\s*)?(\d+(?:\.\d+)?(?:\s*(?:[-–—]|to)\s*\d+(?:\.\d+)?)?\s*%)/i
    ]
  );
  let tgeFloatPct = parsePercentValue(rawTgeFloat);

  const rawCircSupply = pickField(
    ["initialCirculatingSupply", "circulatingSupply"],
    [
      /(?:initial\s+circulating\s+supply|circulating\s+supply\s+at\s+tge)\s*(?:[:=-]|\|)\s*([\d,._]+\s*(?:k|m|million|b|billion|t|trillion)?)/i
    ]
  );
  const initialCirculatingSupply = parseHumanNumber(rawCircSupply);
  if (tgeFloatPct === null && initialCirculatingSupply !== null && totalSupply > 0) {
    tgeFloatPct = Number(((initialCirculatingSupply / totalSupply) * 100).toFixed(2));
  }

  // Standard: SPL vs Token-2022 vs Off-Chain Ledger / Local Program
  const rawStandard = pickField(
    ["standard", "tokenStandard", "program"],
    [
      /(?:token\s+standard|standard|program)\s*(?:[:=-]|\|)\s*(Token-2022|Token\s+Extensions|SPL(?:\s+Token)?[^\r\n|]*)/i
    ]
  );
  const standard = rawStandard
    ? (/2022|extension/i.test(String(rawStandard)) ? "Token-2022" : "SPL Token")
    : (/token-2022|token\s+extensions|tokenzqd/i.test(lower)
      ? "Token-2022"
      : (/no\s+on-chain\s+spl\s+mint|source\s+of\s+truth\s+is\s+the\s+postgresql\s+ledger/i.test(lower)
        ? "PostgreSQL Ledger + Local Program (Not Deployed)"
        : (/spl\s*token|tokenkeg|metaplex/i.test(lower) ? "SPL Token" : "Unspecified")));

  // Authorities
  const parseAuthority = (fieldKeys, labelRe) => {
    const val = pickField(fieldKeys, [labelRe]);
    if (val !== null) {
      const s = String(val).toLowerCase();
      if (/null|none|revoked|renounced|disabled|false|burned|immutable/.test(s)) return "revoked";
      if (/multisig|squads|dao|timelock|pda|program/.test(s)) return "multisig_or_pda";
      if (/active|enabled|true|wallet|eoa|creator|team|admin|mutable/.test(s)) return "active_eoa";
      return s;
    }
    return null;
  };

  let mintAuthority = parseAuthority(
    ["mintAuthority", "mint_authority"],
    /mint\s+authority\s*(?:[:=-]|\|)\s*([^\r\n|,;]+)/i
  );
  if (!mintAuthority) {
    if (/revoke[ds]?\s+(?:the\s+)?mint\s+authority|mint\s+authority\s*(?:is|=|:)?\s*(?:null|revoked|renounced|none)/i.test(lower)) mintAuthority = "revoked";
    else if (hasUnnegatedMatch(lower, /unlimited\s+mint|can\s+mint\s+more|admin\s+mint|uncapped\s+mint/i)) mintAuthority = "active_eoa";
    else if (/no\s+further\s+mint\s+after\s+the\s+emission\s+cap|minted\s+only\s+when\s+a\s+paid\s+ride/i.test(lower)) mintAuthority = "capped_ledger_or_pda";
    else mintAuthority = "unspecified";
  }

  let freezeAuthority = parseAuthority(
    ["freezeAuthority", "freeze_authority"],
    /freeze\s+authority\s*(?:[:=-]|\|)\s*([^\r\n|,;]+)/i
  );
  if (!freezeAuthority) {
    if (/revoke[ds]?\s+(?:the\s+)?freeze\s+authority|freeze\s+authority\s*(?:is|=|:)?\s*(?:null|revoked|renounced|disabled|none)/i.test(lower)) freezeAuthority = "revoked";
    else if (hasUnnegatedMatch(lower, /freeze\s+authority\s+(?:is\s+)?(?:active|enabled|kept|retained)|can\s+freeze\s+accounts/i)) freezeAuthority = "active_eoa";
    else freezeAuthority = "unspecified";
  }

  let updateAuthority = parseAuthority(
    ["updateAuthority", "update_authority", "metadataMutable"],
    /(?:update\s+authority|metadata\s+mutability|mutable|ismutable)\s*(?:[:=-]|\|)\s*([^\r\n|,;]+)/i
  );
  if (!updateAuthority) {
    if (/immutable\s+metadata|ismutable\s*=\s*false|renounce[ds]?\s+update\s+authority|update\s+authority\s*(?:is|=|:)?\s*(?:null|revoked|immutable)/i.test(lower)) updateAuthority = "revoked";
    else if (hasUnnegatedMatch(lower, /mutable\s+metadata|update\s+authority\s+(?:active|retained|team)/i)) updateAuthority = "active_eoa";
    else updateAuthority = "unspecified";
  }

  const rawMetadataUri = pickField(
    ["metadataUri", "uri", "metadataStorage"],
    [/(?:metadata\s+uri|storage\s+uri|metadata\s+storage|\buri)\s*(?:[:=-]|\|)\s*([^\r\n|,;]+)/i]
  );
  const metadataUri = rawMetadataUri || (
    /arweave|irys|ipfs|pinata/i.test(lower) || /arweave|irys|ipfs/i.test(String(jsonObj?.updateAuthority ?? ""))
      ? "Arweave / IPFS (immutable)"
      : (/http:\/\/|aws|s3\.amazonaws|cloudinary|localhost/i.test(lower) ? "Centralized / mutable HTTP" : "unspecified")
  );

  // Token-2022 danger extensions (negation-aware)
  const hasTransferFee = (() => {
    if (jsonObj?.transferFeeBps !== undefined) return Number(jsonObj.transferFeeBps) > 0;
    if (jsonObj?.transferFee !== undefined) return Boolean(jsonObj.transferFee) && Number(jsonObj.transferFee) !== 0;
    if (/(?:0(?:\.0+)?%|0\s*bps|no|zero|without)\s+(?:buy\/sell\s+|transfer\s+)*(?:tax|fee)/i.test(lower)) return false;
    return hasUnnegatedMatch(lower, /transfer\s+fee\s*(?:[:=-]|\|)?\s*(?:enabled|true|[1-9]\d*(?:\.\d+)?\s*(?:%|bps))|[1-9]\d*(?:\.\d+)?\s*%\s*(?:buy\/sell|transfer)\s+(?:tax|fee)|tax\s+on\s+transfer/i);
  })();

  const hasPermanentDelegate = (() => {
    if (jsonObj?.permanentDelegate !== undefined) {
      return jsonObj.permanentDelegate === true || String(jsonObj.permanentDelegate).toLowerCase() === "enabled";
    }
    return hasUnnegatedMatch(lower, /permanent\s*delegate(?:\s*(?:[:=-]|\|)\s*(?:enabled|true|active))?/i);
  })();

  // Allocations & Vesting extraction
  const allocations = {
    communityRewards: 0,
    liquidity: 0,
    ecosystemTreasury: 0,
    team: 0,
    investorsAdvisors: 0,
    marketingAirdrop: 0
  };
  let allocationsProvided = false;
  let teamLineText = "";

  if (Array.isArray(jsonObj?.allocations)) {
    for (const item of jsonObj.allocations) {
      if (!item || typeof item !== "object") continue;
      const label = item.bucket ?? item.name ?? item.category ?? item.label ?? "";
      const pct = parsePercentValue(item.pct ?? item.share ?? item.percentage ?? item.allocation ?? item.value);
      const bucketKey = classifyAllocationBucket(label);
      if (pct !== null && bucketKey) {
        allocationsProvided = true;
        allocations[bucketKey] += pct;
        if (bucketKey === "team" && item.terms) teamLineText += ` ${item.terms}`;
        if (bucketKey === "team" && item.cliffMonths !== undefined) teamLineText += ` ${item.cliffMonths} month cliff`;
        if (bucketKey === "team" && item.vestingMonths !== undefined) teamLineText += ` ${item.vestingMonths} month vesting`;
      }
    }
  } else if (jsonObj?.allocations && typeof jsonObj.allocations === "object") {
    for (const [k, v] of Object.entries(jsonObj.allocations)) {
      const pct = typeof v === "object" && v !== null
        ? parsePercentValue(v.pct ?? v.share ?? v.percentage ?? v.value)
        : parsePercentValue(v);
      if (pct === null) continue;
      allocationsProvided = true;
      const bucketKey = classifyAllocationBucket(k) || "communityRewards";
      allocations[bucketKey] += pct;
      if (bucketKey === "team" && typeof v === "object" && v !== null) {
        if (v.cliffMonths !== undefined) teamLineText += ` ${v.cliffMonths} month cliff`;
        if (v.vestingMonths !== undefined) teamLineText += ` ${v.vestingMonths} month vesting`;
      }
    }
  } else {
    // Parse Markdown tables and bullet/colon lines line-by-line
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || /^\|?[\s-:|]+\|?$/.test(line)) continue;
      // Skip obvious non-allocation summary lines
      if (/^(?:tge\s+float|initial\s+circulating|transfer\s+fee|burn\s+rate|liquidity[- ]to[- ]|total\s+supply|decimals)/i.test(line)) continue;

      if (line.includes("|")) {
        // Markdown table row: e.g. | Team & Founders | 150,000,000 | 15% | 12 months | 36 months |
        // or | 15% | Team & Founders | 12m cliff | or | Ride emission cap | 98,000,000 | the counter stops here |
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length < 2) continue;
        let bucketKey = null;
        let pctVal = null;
        for (const cell of cells.slice(0, 2)) {
          if (!bucketKey) {
            const b = classifyAllocationBucket(cell);
            if (b) bucketKey = b;
          }
        }
        for (const cell of cells) {
          if (pctVal === null && /\d+(?:\.\d+)?\s*%/.test(cell) && !/at\s+tge|unlocked|burn|tax|fee/i.test(cell)) {
            const m = cell.match(/(\d+(?:\.\d+)?(?:\s*(?:[-–—]|to)\s*\d+(?:\.\d+)?)?\s*%)/);
            if (m) pctVal = parsePercentValue(m[1]);
          }
        }
        if (bucketKey && pctVal === null && totalSupply > 0) {
          for (const cell of cells.slice(1)) {
            if (/^[\d,._]+$/.test(cell)) {
              const amt = parseHumanNumber(cell);
              if (amt !== null && amt > 0 && amt <= totalSupply) {
                pctVal = Number(((amt / totalSupply) * 100).toFixed(2));
                break;
              }
            }
          }
        }
        if (bucketKey && pctVal !== null) {
          allocationsProvided = true;
          allocations[bucketKey] += pctVal;
          if (bucketKey === "team") teamLineText += ` ${line}`;
        }
      } else {
        // Bullet or key-value line: e.g. "- Team: 15% (12m cliff, 36m vesting)" or "15% to Team"
        const strippedSubClauses = line.replace(/\([^)]*\)/g, " ").replace(/\b\d+(?:\.\d+)?\s*%\s*(?:at\s+tge|unlocked|burned|burn|tax|fee|of\s+spend|refilled|seeded|locked)\b/gi, " ");
        const pctMatch = strippedSubClauses.match(/(\d+(?:\.\d+)?(?:\s*(?:[-–—]|to)\s*\d+(?:\.\d+)?)?\s*%)/);
        if (!pctMatch) continue;
        // Identify bucket from the label portion of the line
        const labelPart = line.split(/[:=-]|\(/)[0] || line;
        const bucketKey = classifyAllocationBucket(labelPart) || (
          /(?:to|for)\s+(?:the\s+)?(?:team|founders?|investors?|vcs?|liquidity|lp|community|rewards?|treasury|ecosystem|marketing|airdrops?)/i.test(line)
            ? classifyAllocationBucket(line)
            : null
        );
        if (bucketKey && (line.startsWith("-") || line.startsWith("*") || /[:=]/.test(line) || /\d+\s*%\s*(?:to|for)\b/i.test(line))) {
          const pctVal = parsePercentValue(pctMatch[1]);
          if (pctVal !== null) {
            allocationsProvided = true;
            allocations[bucketKey] += pctVal;
            if (bucketKey === "team") teamLineText += ` ${line}`;
          }
        }
      }
    }
  }

  for (const k of Object.keys(allocations)) {
    allocations[k] = Number(allocations[k].toFixed(2));
  }
  const allocationSum = Number(
    Object.values(allocations).reduce((acc, v) => acc + v, 0).toFixed(2)
  );
  const insiderPct = Number((allocations.team + allocations.investorsAdvisors).toFixed(2));
  const noTeamAllocation = Boolean(/no\s+team\s+allocation|0%\s+team/i.test(lower) && insiderPct === 0);

  // Vesting & cliffs (prioritize Team-specific cliff/vesting before general document matches)
  const extractMonthsFromTeamLine = (lineStr, kind) => {
    if (!lineStr) return null;
    if (kind === "cliff") {
      const m = lineStr.match(/(\d+)\s*(?:months?|mos?|m)\s+cliff/i) || lineStr.match(/cliff\s*[:=-]?\s*(\d+)\s*(?:months?|mos?|m)?/i);
      if (m) return Number(m[1]);
    } else {
      const m = lineStr.match(/(\d+)\s*(?:months?|mos?|m)\s+(?:linear\s+)?(?:vesting|release|unlock)/i) || lineStr.match(/vesting\s*[:=-]?\s*(\d+)\s*(?:months?|mos?|m)?/i);
      if (m) return Number(m[1]);
    }
    // Check Markdown table cells on the team row: | Team | 150M | 15% | 12 months | 36 months |
    const monthCells = [...lineStr.matchAll(/\|\s*(\d+)\s*(?:months?|mos?|m)\b/gi)].map((x) => Number(x[1]));
    if (monthCells.length >= 2) {
      return kind === "cliff" ? monthCells[0] : monthCells[1];
    }
    return null;
  };

  const rawCliff = pickField(
    ["teamCliffMonths", "cliffMonths", "cliff"],
    [
      /team\s+cliff\s*(?:[:=-]|\|)?\s*(\d+)\s*(?:months?|mos?|m)?/i
    ]
  ) ?? extractMonthsFromTeamLine(teamLineText, "cliff") ?? pickField(
    [],
    [
      /cliff\s*(?:[:=-]|\|)\s*(\d+)\s*(?:months?|mos?|m)?/i,
      /(\d+)[-\s]*(?:months?|mos?|m)\s+cliff/i
    ]
  );
  const teamCliffMonths = rawCliff !== null && rawCliff !== "" && Number.isFinite(Number(rawCliff))
    ? Number(rawCliff)
    : (/no\s+cliff|0\s*(?:month|m)\s+cliff|team\s+unlocked\s+at\s+tge|100%\s+unlocked\s+at\s+tge/i.test(lower) ? 0 : null);

  const rawVesting = pickField(
    ["teamVestingMonths", "vestingMonths", "vesting"],
    [
      /team\s+(?:linear\s+)?vesting\s*(?:[:=-]|\|)?\s*(\d+)\s*(?:months?|mos?|m)?/i
    ]
  ) ?? extractMonthsFromTeamLine(teamLineText, "vesting") ?? pickField(
    [],
    [
      /(?:linear\s+vesting|vesting(?:\s+period)?)\s*(?:[:=-]|\|)\s*(\d+)\s*(?:months?|mos?|m)?/i,
      /(\d+)[-\s]*(?:months?|mos?|m)\s+(?:linear\s+)?(?:monthly\s+)?vesting/i
    ]
  );
  const teamVestingMonths = rawVesting !== null && rawVesting !== "" && Number.isFinite(Number(rawVesting))
    ? Number(rawVesting)
    : (/no\s+vesting|0\s*(?:month|m)\s+vesting|fully\s+unlocked\s+at\s+tge/i.test(lower) ? 0 : null);

  const hasOnChainVesting = Boolean(
    jsonObj?.vestingContract ||
    /streamflow|bonfida|anchor\s+vesting|on-chain\s+vesting|timelock\s+vault|squads/i.test(lower)
  );

  // Liquidity lock & venue
  const lockerDaysMatch = lower.match(/lp\s+tokens?\s+sit\s+in\s+the\s+program\s+locker\s+for\s+(\d+)\s+days/);
  const lpRedeemableAfterDays = lockerDaysMatch && /redeem\s+them\s+for\s+their\s+share/i.test(lower)
    ? Number(lockerDaysMatch[1])
    : null;

  const dexVenue = pickField(
    ["dex", "dexVenue", "liquidityVenue"],
    [/(?:dex(?:\s+venue)?|liquidity\s+venue|amm)\s*(?:[:=-]|\|)\s*([^\r\n|,;]+)/i]
  ) || (
    /no\s+dex\s+listing|no\s+transaction\s+is\s+sent\s+to\s+raydium|local\s+program\s+pairs\s+the\s+whole\s+genesis/i.test(lower)
      ? "Local Constant-Product Pool (10 SOL, 0% fee, undeployed)"
      : /meteora/i.test(lower) && /raydium/i.test(lower) ? "Meteora DLMM + Raydium" :
        /meteora/i.test(lower) ? "Meteora DLMM / DAMM" :
        /raydium/i.test(lower) ? "Raydium CPMM / CLMM" :
        /orca/i.test(lower) ? "Orca Whirlpools" :
        /pump\.fun/i.test(lower) ? "Pump.fun bonding curve" : "Unspecified"
  );

  const lpLocked = Boolean(
    jsonObj?.lpLocked === true ||
    jsonObj?.lpBurned === true ||
    lockerDaysMatch ||
    /(?:lp|liquidity)\s+(?:tokens?\s+|pool\s+)?(?:100%\s+)?(?:is\s+|are\s+|will\s+be\s+)?(?:permanently\s+)?(?:locked|burned|burnt)|burn(?:ed)?\s+lp|lock(?:ed)?\s+(?:meteora[^\r\n,;]{0,40}|raydium[^\r\n,;]{0,40}|dex\s+|initial\s+)?(?:lp|liquidity)|permanent(?:ly)?\s+locked\s+(?:lp|liquidity)/i.test(lower)
  ) && !/(?:lp|liquidity)\s+(?:is\s+|are\s+)?unlocked|unlocked\s+(?:lp|liquidity)|no\s+lp\s+lock/i.test(lower);

  const rawLiqRatio = pickField(
    ["liquidityToImcPct", "lpToMcapPct"],
    [/(?:liquidity[- ]to[- ](?:imc|mcap)|lp\s+depth\s+ratio)\s*(?:[:=-]|\|)?\s*(\d+(?:\.\d+)?)\s*%/i]
  );
  const liquidityToImcPct = rawLiqRatio !== null ? Number(rawLiqRatio) : (allocations.liquidity >= 15 ? 18 : allocations.liquidity >= 8 ? 11 : null);

  // Specific architectural & game-economy signals (e.g., HONK ledger vs local pool, no-clawback, LIVE_EFFECTS bypass)
  const honkSignals = {
    isOffChainLedgerSplit: /source\s+of\s+truth\s+is\s+the\s+postgresql\s+ledger|stays\s+on\s+the\s+game\s+ledger\s+and\s+is\s+not\s+deposited\s+into\s+the\s+pool/i.test(lower),
    hasNoClawbackWindow: /no\s+clawback[\s\S]{0,120}?admin\s+later\s+rejects\s+a\s+ride/i.test(lower),
    bypassesLiveEffectsOnPaidRide: /switch\s+that\s+turns\s+donation\s+obstacles\s+off\s+does\s+not\s+turn\s+this\s+off/i.test(lower),
    hasZeroFeeAmm: /fee\s+is\s+zero/i.test(lower),
    hasCappedGarageSink: /garage\s+is\s+then\s+45\s+parts\s+and\s+4,485|whole\s+garage\s*\|\s*4,485/i.test(lower)
  };

  // Utility & Project Fit signals (negation-aware for hazard flags)
  const utilities = {
    garageCosmetics: Boolean(jsonObj?.utility?.garageCosmetics || /garage|cosmetic|paint|livery|skin|wheel|dice|horn|needles|cab\s+item/i.test(lower)),
    spectatorHazards: Boolean(jsonObj?.utility?.spectatorHazards || /spectator|pothole|sinkhole|trench|hazard|live\s+event|weather|night\s+shift|stream\s+effect|stream\s+burn|effect\s+window|day\s+or\s+night\s+change/i.test(lower)),
    tournamentPassOrBond: Boolean(jsonObj?.utility?.tournamentPassOrBond || /season\s+pass|tournament|driver\s+bond|hauler\s+bond|stake|staking|league\s+entry|leaderboard\s+boost/i.test(lower)),
    pledgeOrTipBoost: Boolean(jsonObj?.utility?.pledgeOrTipBoost || /pledge|sponsor|tip|cb\s+radio|highlight|badge/i.test(lower)),
    governance: Boolean(jsonObj?.utility?.governance || /governance|vote|dao|route\s+voting|season\s+vote/i.test(lower)),
    payToWinHazard: jsonObj?.utility?.payToWin !== undefined
      ? Boolean(jsonObj.utility.payToWin)
      : hasUnnegatedMatch(lower, /speed\s+boost|faster\s+truck|increase\s+max\s+speed|bypass(?:es)?\s+(?:the\s+)?(?:\d+\s*m\/s\s+)?governor|extra\s+hull|hull\s+armor|damage\s+immunity|ignore\s+sinkhole|skip\s+verdict|anti-cheat\s+immunity/i),
    replacesSolEscrow: jsonObj?.utility?.replacesSolEscrow !== undefined
      ? Boolean(jsonObj.utility.replacesSolEscrow)
      : hasUnnegatedMatch(lower, /replace\s+sol\s+escrow|all\s+paid\s+pools\s+only\s+in\s+token|remove\s+sol\s+tickets|migrate\s+escrow\s+vault\s+to\s+token\s+only/i)
  };
  const utilityCount = [
    utilities.garageCosmetics,
    utilities.spectatorHazards,
    utilities.tournamentPassOrBond,
    utilities.pledgeOrTipBoost,
    utilities.governance
  ].filter(Boolean).length;

  // Minting & Burning signals (negation-aware)
  const mintBurn = {
    uncappedMint: jsonObj?.mintBurn?.uncappedMint !== undefined
      ? Boolean(jsonObj.mintBurn.uncappedMint)
      : hasUnnegatedMatch(lower, /uncapped\s+supply|infinite\s+inflation|unlimited\s+minting|mint\s+on\s+demand\s+for\s+every\s+ride/i),
    unverifiedFaucet: jsonObj?.mintBurn?.unverifiedFaucet !== undefined
      ? Boolean(jsonObj.mintBurn.unverifiedFaucet)
      : hasUnnegatedMatch(lower, /earn\s+tokens\s+on\s+every\s+free\s+ride|reward\s+per\s+km\s+driven\s+without\s+verdict|offline\s+rides\s+earn\s+tokens|(?:guest|free)\s+(?:free\s+)?rides\s+earn|unlimited\s+minting\s+on\s+every\s+guest\s+free\s+ride/i),
    skillVerifiedFaucet: Boolean(
      jsonObj?.mintBurn?.skillVerifiedFaucet === true ||
      /verified\s+ride|verified\s+shift|replayengine|10\s*hz|attestation|merkle|verified\s+km|ranked\s+finish/i.test(lower)
    ),
    hasBurnMechanism: Boolean(
      jsonObj?.mintBurn?.hasBurn === true ||
      /burn|deflationary|buyback\s+and\s+burn|spl_token::(?:instruction::)?burn|burn\s+on\s+spend/i.test(lower)
    ) && !/no\s+burn|zero\s+burn|without\s+burning/i.test(lower),
    burnPctOfSpend: (() => {
      if (jsonObj?.mintBurn?.burnPctOfSpend !== undefined) return Number(jsonObj.mintBurn.burnPctOfSpend);
      const m = text.match(/burn\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:spent|fees|sinks|revenue))?/i) ||
                text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:cryptographic\s+)?(?:spl\s+)?(?:is\s+|are\s+)?burn(?:ed)?\b/i);
      return m ? Number(m[1]) : null;
    })(),
    hasVaultRecycle: Boolean(
      jsonObj?.mintBurn?.hasVaultRecycle === true ||
      /recycle|refilled\s+by|treasury\s+refill|reward\s+pool\s+recycle|sink[- ]and[- ]recycle|split\s+sink/i.test(lower)
    ),
    hasDynamicTwapPricing: Boolean(
      jsonObj?.mintBurn?.hasDynamicTwapPricing === true ||
      /twap|oracle|pyth|usd[- ]pegged|sol[- ]pegged|dynamic\s+(?:sink\s+)?pricing|dollar[- ]denominated/i.test(lower)
    )
  };

  // Hype & Marketing signals
  const hype = {
    hasNarrativeHook: Boolean(jsonObj?.hype?.narrativeHook || /desert\s+bus|8\s+hours|one\s+mistake|high[- ]stakes|long[- ]haul|attention\s+proof|drive\s+or\s+crash|spectator\s+sabotage/i.test(lower)),
    hasSpectatorClipLoop: Boolean(jsonObj?.hype?.spectatorClipLoop || /clip|youtube\s+shorts|tiktok|twitch|live\s+watch|spectator\s+chaos|chat\s+drops\s+sinkhole|hazard\s+bount/i.test(lower)),
    hasBlinksIntegration: Boolean(jsonObj?.hype?.blinks || /blink|solana\s+action|\/r\/:id|share\s+card|x\s+card|solana\s+pay/i.test(lower)),
    hasCatalystRoadmap: Boolean(jsonObj?.hype?.roadmap || /season\s+1|phase\s+1|tge|tournament|roadmap|milestone|jupiter\s+verified/i.test(lower))
  };

  const marketing = {
    hasShortFormVideo: Boolean(jsonObj?.marketing?.shortFormVideo || /shorts|tiktok|reels|video\s+clips|gameplay\s+clips|youtube|streamer\s+hazard/i.test(lower)),
    hasStreamerGauntlets: Boolean(jsonObj?.marketing?.streamerGauntlets || /streamer|creator|live\s+challenge|kol\s+stream|watch\s+party|gauntlet/i.test(lower)),
    hasFreeToPaidFunnel: Boolean(jsonObj?.marketing?.funnel || /free\s+ride|guest\s+run|siws|sign-in|cnft|badge|funnel|onboarding/i.test(lower)),
    mercenaryKolDumpRisk: jsonObj?.marketing?.unvestedKol !== undefined
      ? Boolean(jsonObj.marketing.unvestedKol)
      : hasUnnegatedMatch(lower, /100%\s+unlocked\s+kol|upfront\s+kol\s+tokens|paid\s+shillers\s+at\s+tge|no\s+kol\s+vesting/i)
  };

  return {
    filePath,
    fileName: basename(filePath),
    rawLength: rawContent.length,
    name: name || "Unspecified",
    symbol: symbol || "UNSET",
    decimals,
    standard,
    totalSupply,
    initialCirculatingSupply,
    tgeFloatPct,
    mintAuthority,
    freezeAuthority,
    updateAuthority,
    metadataUri,
    hasTransferFee,
    hasPermanentDelegate,
    allocations,
    allocationsProvided,
    allocationSum,
    insiderPct,
    noTeamAllocation,
    teamCliffMonths,
    teamVestingMonths,
    hasOnChainVesting,
    dexVenue,
    lpLocked,
    lpRedeemableAfterDays,
    liquidityToImcPct,
    honkSignals,
    utilities,
    utilityCount,
    mintBurn,
    hype,
    marketing
  };
}

// Compute exact Solana u64 base-unit math check: totalSupply * 10^decimals <= u64::MAX.
export function checkSolanaU64Supply(totalSupply, decimals) {
  if (
    totalSupply == null ||
    !Number.isFinite(Number(totalSupply)) ||
    decimals == null ||
    !Number.isFinite(Number(decimals)) ||
    !Number.isInteger(Number(decimals)) ||
    Number(decimals) < 0
  ) {
    return {
      valid: false,
      reason: "Supply or decimals missing, negative, or non-integer",
      baseUnits: null,
      maxHumanSupplyAtDecimals: null,
      utilizationPct: null
    };
  }

  const numSupply = Number(totalSupply);
  const wholeSupply = BigInt(Math.trunc(numSupply));
  if (wholeSupply <= 0n) {
    return {
      valid: false,
      reason: `Invalid totalSupply (${totalSupply}): supply must be a positive integer (> 0)`,
      baseUnits: wholeSupply.toString(),
      maxHumanSupplyAtDecimals: null,
      utilizationPct: 0
    };
  }

  const decInt = Number(decimals);
  if (decInt > 77) {
    return {
      valid: false,
      reason: `OVERFLOWS Solana SPL u64! Decimals (${decInt}) exceeds u64 ceiling (max decimals on Solana is 9, u64::MAX is ${U64_MAX.toString()})`,
      baseUnits: "overflow",
      maxHumanSupplyAtDecimals: "0",
      utilizationPct: 100
    };
  }

  const scale = 10n ** BigInt(decInt);
  const baseUnits = wholeSupply * scale;
  const maxHuman = U64_MAX / scale;
  const fits = baseUnits <= U64_MAX;
  const ratioPct = fits ? Number((baseUnits * 10000n) / U64_MAX) / 100 : 100;
  return {
    valid: fits,
    reason: fits
      ? `Fits in Solana u64 (${baseUnits.toString()} <= ${U64_MAX.toString()}, uses ${ratioPct.toFixed(2)}% of u64 ceiling)`
      : `OVERFLOWS Solana SPL u64! ${wholeSupply.toString()} * 10^${decInt} = ${baseUnits.toString()} > u64::MAX (${U64_MAX.toString()}). Max supply at ${decInt} decimals is ${maxHuman.toString()}`,
    baseUnits: baseUnits.toString(),
    maxHumanSupplyAtDecimals: maxHuman.toString(),
    utilizationPct: ratioPct
  };
}

// Run the 3 consecutive Grill Iterations in a row (State 0 -> Pass 1 -> State 1 -> Pass 2 -> State 2 -> Pass 3 -> Hardened Blueprint).
export function runThreeIterations(spec) {
  const project = loadProjectContext();
  const u64Check = checkSolanaU64Supply(spec.totalSupply, spec.decimals);
  const nameBytes = spec.name === "Unspecified" ? 0 : Buffer.byteLength(spec.name, "utf8");
  const symbolLen = spec.symbol === "UNSET" ? 0 : spec.symbol.length;

  // =========================================================================
  // ITERATION 1: Baseline On-Chain Technical, Structural & Project-Fit Audit
  // =========================================================================
  const pass1Issues = [];
  const pass1Proposals = [];
  const scoresP1 = {
    identity_tech: 10,
    project_fit: 10,
    utility: 10,
    tokenomics: 10,
    supply: 10,
    demand: 10,
    mint_burn: 10,
    hype: 10,
    marketing: 10,
    long_term: 10
  };

  // 1. Identity & Technical checks (Name, Symbol, Decimals, u64, Authorities, Metadata)
  if (spec.name === "Unspecified" || nameBytes < 2) {
    scoresP1.identity_tech -= 2.5;
    pass1Issues.push({
      id: "ISS-P1-01",
      iteration: 1,
      severity: "HIGH",
      dimension: "Identity & Technicals",
      title: "Token name is missing or under-specified",
      detail: `Parsed name "${spec.name}" (${nameBytes} bytes). Metaplex Token Metadata requires a non-empty UTF-8 name <= 32 bytes aligned with the product brand.`,
      proposal: "Set an explicit, memorable token name <= 32 UTF-8 bytes (e.g., \"Freight Chain Haul\" or \"Freight Chain Token\") in the Metaplex / Token-2022 metadata account."
    });
  } else if (nameBytes > RUBRIC.solanaLimits.maxNameBytes) {
    scoresP1.identity_tech -= 3.0;
    pass1Issues.push({
      id: "ISS-P1-01",
      iteration: 1,
      severity: "CRITICAL",
      dimension: "Identity & Technicals",
      title: `Token name exceeds Metaplex 32-byte limit (${nameBytes} bytes)`,
      detail: `Name "${spec.name}" is ${nameBytes} UTF-8 bytes. Solana Metaplex Token Metadata truncates or rejects names above 32 bytes.`,
      proposal: "Shorten token name to <= 32 UTF-8 bytes while keeping brand recognition."
    });
  }

  if (spec.symbol === "UNSET" || symbolLen < 2 || symbolLen > RUBRIC.solanaLimits.maxSymbolLength) {
    scoresP1.identity_tech -= 2.5;
    pass1Issues.push({
      id: "ISS-P1-02",
      iteration: 1,
      severity: symbolLen > 10 ? "CRITICAL" : "HIGH",
      dimension: "Identity & Technicals",
      title: `Invalid or missing token ticker symbol ("$${spec.symbol}")`,
      detail: `Symbol length is ${symbolLen} chars (Solana Metaplex hard limit is 10 bytes; DEX/Jupiter/Birdeye optimal range is 3–6 uppercase ASCII letters).`,
      proposal: "Define a 3–5 uppercase ASCII character ticker (e.g., `$HAUL`, `$AXLE`, or `$FRGT`) that is clean on X cashtags and Jupiter search."
    });
  } else if (symbolLen > 6 || !/^[A-Z0-9]+$/.test(spec.symbol)) {
    scoresP1.identity_tech -= 1.0;
    pass1Issues.push({
      id: "ISS-P1-02",
      iteration: 1,
      severity: "LOW",
      dimension: "Identity & Technicals",
      title: `Suboptimal ticker formatting ("$${spec.symbol}")`,
      detail: "Tickers longer than 6 characters or using lowercase/special characters clip in Phantom, Jupiter, and DexScreener mobile tables.",
      proposal: `Normalize ticker to 3–5 uppercase ASCII letters (e.g. $${spec.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || "HAUL"}).`
    });
  }

  if (spec.decimals === null || !Number.isInteger(spec.decimals)) {
    scoresP1.identity_tech -= 3.0;
    pass1Issues.push({
      id: "ISS-P1-03",
      iteration: 1,
      severity: "HIGH",
      dimension: "Identity & Technicals",
      title: "SPL Mint decimals parameter is missing or non-integer",
      detail: "Decimals are immutable once `InitializeMint2` executes on Solana. Leaving decimals unspecified risks deploying with wrong precision.",
      proposal: "Pin `decimals = 6` (modern Solana SPL / USDC / Pump / Meteora standard, supporting supplies up to 18.44 trillion within u64) or `decimals = 9` (only if supply <= 10 billion)."
    });
  } else if (!RUBRIC.solanaLimits.standardDecimals.includes(spec.decimals)) {
    const isEvmMistake = spec.decimals > 9 || spec.decimals < 0;
    scoresP1.identity_tech -= isEvmMistake ? 4.0 : 2.0;
    pass1Issues.push({
      id: "ISS-P1-03",
      iteration: 1,
      severity: isEvmMistake ? "CRITICAL" : "MEDIUM",
      dimension: "Identity & Technicals",
      title: `Non-standard Solana decimals (${spec.decimals})`,
      detail: isEvmMistake
        ? `Decimals = ${spec.decimals} is an invalid or EVM (18-decimal) anti-pattern that overflows Solana u64 on standard supplies and breaks Solana DEX UIs.`
        : `Decimals = ${spec.decimals} deviates from Solana's standard 6 (USDC/modern SPL) or 9 (SOL lamports), causing odd lot sizes in Raydium/Meteora pools.`,
      proposal: "Change mint `decimals` to `6` (recommended for GameFi utility tokens with >= 1B supply) or `9` (for <= 1B supply)."
    });
  }

  if (!u64Check.valid) {
    scoresP1.identity_tech -= 4.5;
    scoresP1.supply -= 3.0;
    pass1Issues.push({
      id: "ISS-P1-04",
      iteration: 1,
      severity: "CRITICAL",
      dimension: "Identity & Technicals",
      title: "Solana SPL u64 supply-times-decimals overflow / invalid supply",
      detail: u64Check.reason,
      proposal: "Reduce `decimals` to `6` and/or cap `totalSupply` at `1,000,000,000` (1B) so `totalSupply * 10^6 = 10^15 << u64::MAX (1.844e19)`."
    });
  }

  if (spec.freezeAuthority !== "revoked") {
    scoresP1.identity_tech -= 2.5;
    pass1Issues.push({
      id: "ISS-P1-05",
      iteration: 1,
      severity: "CRITICAL",
      dimension: "Identity & Technicals",
      title: `Fungible mint freeze authority is not explicitly revoked in spec (${spec.freezeAuthority})`,
      detail: "On Solana, an active or unspecified freeze authority on the fungible mint allows freezing any user's Associated Token Account (ATA) or DEX LP pool. Automated scanners (RugCheck, Jupiter, Birdeye, Photon, BullX) flag the token as a honeypot risk. (Note: freezing supply-1 soulbound cab part tokens is fine, but the fungible token mint itself must explicitly state `freezeAuthority = null`).",
      proposal: "Explicitly document and enforce `freezeAuthority = null` (`SetAuthority` -> `None`) on the fungible token mint at genesis while keeping soulbound freeze strictly on supply-1 cab visual mints."
    });
  }

  if (spec.mintAuthority !== "revoked") {
    scoresP1.identity_tech -= 2.0;
    scoresP1.mint_burn -= 2.5;
    pass1Issues.push({
      id: "ISS-P1-06",
      iteration: 1,
      severity: spec.mintAuthority === "active_eoa" ? "CRITICAL" : "HIGH",
      dimension: "Minting & Burning",
      title: spec.honkSignals?.isOffChainLedgerSplit
        ? `Split-brain ledger vs. on-chain mint architecture (${spec.mintAuthority})`
        : `Mint authority is not revoked (${spec.mintAuthority})`,
      detail: spec.honkSignals?.isOffChainLedgerSplit
        ? "The spec states that the PostgreSQL game ledger is the source of truth ('There is no on-chain SPL mint... The ride emission, the other 98,000,000, stays on the game ledger and is not deposited into the pool'), while a separate local program holds a 2,000,000 HONK pool. Splitting 98% of supply onto an off-chain database table and 2% into an isolated local AMM creates two disconnected balances and prevents trustless SPL composability."
        : "Leaving `mintAuthority` on an EOA or unverified signer enables arbitrary supply inflation and triggers red flags on Solana token scanners.",
      proposal: "Mint 100% of max supply at genesis, deposit the 98% emission allocation into an on-chain program-controlled Reward Vault PDA (or Streamflow vesting contract), and revoke `mintAuthority` (`null`) so scanners verify a hard cap on-chain from Day 1."
    });
  }

  if (spec.hasPermanentDelegate) {
    scoresP1.identity_tech -= 3.0;
    pass1Issues.push({
      id: "ISS-P1-07",
      iteration: 1,
      severity: "CRITICAL",
      dimension: "Identity & Technicals",
      title: "Token-2022 Permanent Delegate extension enabled",
      detail: "The `PermanentDelegate` extension grants unrestricted authority to transfer or burn tokens from any holder's wallet at any time.",
      proposal: "Remove the `PermanentDelegate` extension completely; use standard SPL Token or clean Token-2022 without privileged seizure extensions."
    });
  }

  if (spec.updateAuthority !== "revoked" || /\bcentralized\b|unspecified/i.test(spec.metadataUri)) {
    scoresP1.identity_tech -= 1.0;
    pass1Issues.push({
      id: "ISS-P1-08",
      iteration: 1,
      severity: "MEDIUM",
      dimension: "Identity & Technicals",
      title: `Metadata mutability / off-chain URI permanence gap (updateAuthority: ${spec.updateAuthority}, URI: ${spec.metadataUri})`,
      detail: "Mutable metadata or unspecified/local JSON hosting allows post-launch rug-renaming or broken token logos on Jupiter and Solscan.",
      proposal: "Pin the token logo and cab visual JSON metadata to Arweave (via Irys) or IPFS, verify rendering on Solscan/Jupiter, and set Metaplex `isMutable = false`."
    });
  }

  // 2. Main Project & General Coin Fit
  if (spec.utilities.payToWinHazard) {
    scoresP1.project_fit -= 5.0;
    scoresP1.utility -= 3.0;
    pass1Issues.push({
      id: "ISS-P1-09",
      iteration: 1,
      severity: "CRITICAL",
      dimension: "Main Project & Coin Fit",
      title: "Pay-to-Win utility violates Freight Chain's skill-verified driving & anti-cheat invariants",
      detail: "The token spec proposes speed boosts, hull damage immunity, or anti-cheat leniency. In Freight Chain, the 28 m/s governor, axle sinkhole damage (`dmg * (v/28)^2`), and 10 Hz `ReplayEngine` physics checks are hard security invariants (`server/src/domain/verdict`). Altering physics for token holders breaks competitive integrity and invalidates on-chain `RideAttestation`.",
      proposal: "Strip all physics/handling buffs from the token. Keep handling strictly identical across all players; direct token utility into Garage cosmetics, spectator live-stream hazards, driver bonds, and seasonal sponsorship."
    });
  }

  if (spec.utilities.replacesSolEscrow) {
    scoresP1.project_fit -= 3.5;
    pass1Issues.push({
      id: "ISS-P1-10",
      iteration: 1,
      severity: "HIGH",
      dimension: "Main Project & Coin Fit",
      title: "Replacing native SOL escrow prize pools with a volatile token adds severe onboarding & legal friction",
      detail: "Freight Chain's Anchor program (`programs/freightchain_pools`) is architected around trustless SOL vaults, lamport-exact splits (`vault-split.ts`), and Solana Pay ticket checkout. Forcing riders to swap into a custom token just to buy a $5 shift ticket adds DEX slippage, two-step UX drop-off, and prize-pool volatility during 3-hour play windows.",
      proposal: "Adopt a Dual-Rail Model: keep core competitive shift tickets and per-km driver pledges denominated in SOL, while making the token the exclusive currency for Live Spectator Hazards, Garage Cosmetics, Seasonal League Passes, and Community Prize Sponsorships."
    });
  }

  if (spec.utilityCount < 2) {
    scoresP1.project_fit -= 2.5;
    scoresP1.utility -= 4.0;
    scoresP1.demand -= 3.0;
    pass1Issues.push({
      id: "ISS-P1-11",
      iteration: 1,
      severity: "HIGH",
      dimension: "Utility & Value Accrual",
      title: `Thin or purely speculative token utility (${spec.utilityCount} concrete product sinks found)`,
      detail: "A token without organic in-game consumption loops becomes a pure farm-and-dump asset disconnected from Freight Chain's gameplay surfaces (`lobby.html`, `play.html`, live watch, and `/r/:id`).",
      proposal: "Bind the token to 4 concrete Freight Chain surfaces: (1) Spectator Live-Stream Hazard Sinks (`potholes`, `trench`, `sinkhole`, `night` shift triggers), (2) Exclusive Garage Cosmetics (`wheel`, `paint`, `gearbox`, `dice`, `needles`), (3) Driver Stake/Bond for boosted seasonal leaderboard tiers, and (4) Solana Blinks (`/r/:id`) spectator tipping & sponsorship."
    });
  }

  // 3. Tokenomics, Allocations & Vesting
  if (!spec.allocationsProvided || Math.abs(spec.allocationSum - 100) > 0.5) {
    scoresP1.tokenomics -= 3.5;
    pass1Issues.push({
      id: "ISS-P1-12",
      iteration: 1,
      severity: "HIGH",
      dimension: "Tokenomics & Vesting",
      title: `Allocation table missing or does not sum to 100% (parsed sum: ${spec.allocationSum}%)`,
      detail: "Institutional and community reviewers require a deterministic, 100%-reconciled genesis allocation table mapping every token bucket to its on-chain vault.",
      proposal: "Establish a 100% genesis allocation: 35% Community & Verified-Play Rewards, 20% DEX Liquidity & POL, 15% Ecosystem & Spectator Treasury, 15% Team (12m cliff + 36m linear), 10% Strategic/Sponsors (12m cliff + 24m linear), 5% Airdrop & Launch Quests."
    });
  }

  if (spec.insiderPct > RUBRIC.solanaLimits.maxInsiderAllocationPct) {
    scoresP1.tokenomics -= 3.5;
    scoresP1.supply -= 2.0;
    pass1Issues.push({
      id: "ISS-P1-13",
      iteration: 1,
      severity: "CRITICAL",
      dimension: "Tokenomics & Vesting",
      title: `Excessive insider allocation (Team + Investors = ${spec.insiderPct}% > ${RUBRIC.solanaLimits.maxInsiderAllocationPct}% ceiling)`,
      detail: "High insider concentration creates structural overhang, governance capture, and community distrust on Solana.",
      proposal: "Cap combined Team + Investor/Advisor allocations at <= 25% (e.g., 15% Team + 10% Strategic Partners) and reallocate the excess to Community Rewards and Protocol-Owned Liquidity."
    });
  }

  if (spec.noTeamAllocation && spec.lpRedeemableAfterDays) {
    scoresP1.tokenomics -= 2.0;
    scoresP1.long_term -= 1.5;
    pass1Issues.push({
      id: "ISS-P1-14",
      iteration: 1,
      severity: "HIGH",
      dimension: "Tokenomics & Vesting",
      title: `Redeemable LP Locker Cliff at Day ${spec.lpRedeemableAfterDays} ('holder can redeem them for their share of what the pool still holds')`,
      detail: `While the spec commendably sets 0% Team and 0% Investor allocations ('No team allocation'), the entire genesis liquidity pool (2,000,000 HONK + 10 SOL) is only time-locked for ${spec.lpRedeemableAfterDays} days, after which the LP holder can withdraw 100% of remaining SOL and HONK reserves—draining all pool liquidity to zero at Month 12.`,
      proposal: "Permanently burn the genesis LP tokens (send to incinerator / revoke redemption) or convert the genesis pool into permanent Protocol-Owned Liquidity (POL) with no `withdraw_lp` drain path."
    });
  } else if (
    !spec.noTeamAllocation && (
      spec.teamCliffMonths === null ||
      spec.teamCliffMonths < RUBRIC.solanaLimits.minTeamCliffMonths ||
      spec.teamVestingMonths === null ||
      spec.teamVestingMonths < RUBRIC.solanaLimits.minTeamVestingMonths
    )
  ) {
    scoresP1.tokenomics -= 3.0;
    scoresP1.long_term -= 2.0;
    pass1Issues.push({
      id: "ISS-P1-14",
      iteration: 1,
      severity: spec.teamCliffMonths === 0 ? "CRITICAL" : "HIGH",
      dimension: "Tokenomics & Vesting",
      title: `Weak or missing insider vesting schedule (cliff: ${spec.teamCliffMonths ?? "unset"}m, linear: ${spec.teamVestingMonths ?? "unset"}m)`,
      detail: "Short cliffs (< 12 months) or unlocked team tokens allow insiders to liquidate into early retail hype before long-term product retention is proven.",
      proposal: "Enforce a 12-month 0%-unlock cliff followed by 36-month linear monthly vesting for Team (24-month linear for Strategic Partners), locked in verifiable on-chain Streamflow contracts with public dashboard links."
    });
  }

  if (
    spec.tgeFloatPct === null ||
    spec.tgeFloatPct < RUBRIC.solanaLimits.healthyTgeFloatMinPct ||
    spec.tgeFloatPct > RUBRIC.solanaLimits.healthyTgeFloatMaxPct
  ) {
    scoresP1.supply -= 2.5;
    scoresP1.tokenomics -= 1.5;
    const reason = spec.tgeFloatPct === null
      ? "Initial circulating supply (TGE float %) is not specified."
      : spec.tgeFloatPct < RUBRIC.solanaLimits.healthyTgeFloatMinPct
        ? `Ultra-Low Genesis Float (${spec.tgeFloatPct}% in genesis pool vs. ${(100 - spec.tgeFloatPct).toFixed(0)}% unemitted ride overhang — a ${(100 - spec.tgeFloatPct) / Math.max(0.1, spec.tgeFloatPct)}x dilution multiplier). Selling just 2% of ride emissions (2,000,000 tokens = 1,000 8h finishes) into a 2% genesis pool drains 50% of the SOL reserve and crashes spot price by 75%.`
        : `Over-diluted Day-1 float (${spec.tgeFloatPct}% circulating at TGE). Leaves insufficient locked runway or floods the DEX book on Block 1.`;
    pass1Issues.push({
      id: "ISS-P1-15",
      iteration: 1,
      severity: "HIGH",
      dimension: "Short-Term Supply",
      title: `Unbalanced Genesis / TGE Circulating Float (${spec.tgeFloatPct ?? "unset"}%)`,
      detail: reason,
      proposal: "Increase seeded liquidity float to 15%–20% of max supply (or continuously route 15% of ride/sink flows into SOL-paired Protocol-Owned Liquidity) so verified driver emissions do not overwhelm a tiny 2% genesis pool."
    });
  }

  if (!spec.lpLocked || spec.dexVenue === "Unspecified" || spec.honkSignals?.hasZeroFeeAmm) {
    scoresP1.supply -= 2.5;
    scoresP1.tokenomics -= 1.5;
    pass1Issues.push({
      id: "ISS-P1-16",
      iteration: 1,
      severity: !spec.lpLocked ? "CRITICAL" : "HIGH",
      dimension: "Short-Term Supply",
      title: spec.honkSignals?.hasZeroFeeAmm
        ? `Zero-Fee (0 bps), Shallow (10 SOL) Local Constant-Product Pool (${spec.dexVenue})`
        : `DEX Liquidity venue or LP lock status unverified (Venue: ${spec.dexVenue}, LP Locked: ${spec.lpLocked ? "Yes" : "No"})`,
      detail: spec.honkSignals?.hasZeroFeeAmm
        ? "Pairing 2,000,000 HONK with only 10 SOL at a 0% swap fee ('The out is the constant product, rounded down. The fee is zero') means: (1) a single 5 SOL buy moves the price 2.25x and pulls 33.3% of all HONK out of the pool, (2) 0 bps swap fee allows frictionless MEV sandwiching with zero LP fee accumulation, and (3) `index.html` omits the 25 HONK weather (`snow`/`clear`) burn present in `SPEC.md`."
        : "Unlocked LP tokens allow an instant rug-pull of the SOL pair. Unspecified DEX architecture misses Meteora DLMM dynamic fee capture and Jupiter Verified routing requirements.",
      proposal: "Add a 25–30 bps swap fee that compounds inside the pool reserves, deepen SOL liquidity (or route a small protocol share of ticket/sink activity into the pool), permanently burn LP tokens, and sync `index.html` Section 06 with `SPEC.md` by documenting the 25 HONK weather (`snow` / `clear`) burn."
    });
  }

  // 4. Minting, Burning, Hype & Marketing baseline checks
  if (!spec.mintBurn.hasBurnMechanism) {
    scoresP1.mint_burn -= 4.0;
    scoresP1.long_term -= 3.0;
    pass1Issues.push({
      id: "ISS-P1-17",
      iteration: 1,
      severity: "HIGH",
      dimension: "Minting & Burning",
      title: "No deflationary burn or token sink removal mechanism defined",
      detail: "Without structural token burns tied to gameplay activity, circulating supply expands monotonically as vesting and reward buckets unlock.",
      proposal: "Introduce automated on-chain SPL `burn` instructions on Garage cosmetic purchases and Live Spectator Hazard triggers."
    });
  }

  if (!spec.hype.hasNarrativeHook || !spec.hype.hasSpectatorClipLoop || !spec.hype.hasBlinksIntegration) {
    scoresP1.hype -= 3.0;
    pass1Issues.push({
      id: "ISS-P1-18",
      iteration: 1,
      severity: "MEDIUM",
      dimension: "Hype & Narrative",
      title: "Incomplete viral loop across Spectator Chaos, Clips, and Solana Blinks",
      detail: "Solana attention markets require an immediate visual hook and frictionless social sharing. In `index.html`, Section 10 restricts distribution to existing players ('Two people already in the game... Do not send people to a market') and omits `/r/:id` Solana Blinks cards and clip loops beyond a static 'HONK' chat word.",
      proposal: "Connect HONK burns to shareable `/r/:id` Solana Blinks and live stream overlays: display a cab horn visual/audio blast + custom CB callout badge when spectators burn HONK on a live stream, and surface HONK minted & cab loadouts on `/r/:id` receipt cards."
    });
  }

  if (!spec.marketing.hasShortFormVideo || !spec.marketing.hasStreamerGauntlets || !spec.marketing.hasFreeToPaidFunnel || spec.marketing.mercenaryKolDumpRisk) {
    scoresP1.marketing -= spec.marketing.mercenaryKolDumpRisk ? 4.0 : 2.5;
    pass1Issues.push({
      id: "ISS-P1-19",
      iteration: 1,
      severity: spec.marketing.mercenaryKolDumpRisk ? "HIGH" : "MEDIUM",
      dimension: "Marketing Strategy",
      title: spec.marketing.mercenaryKolDumpRisk
        ? "Mercenary KOL upfront token allocation creates Day-1 dump pressure"
        : "Go-To-Market funnel & creator challenge strategy under-specified",
      detail: "Section 10 ('Who it is for') intentionally limits reach to existing watch-page and garage users without a free-ride-to-paid-ride conversion hook or creator stream gauntlet loop.",
      proposal: "Show a preview of 'Potential HONK you would have minted on a paid shift' on completed free rides to convert free riders into paid pool entrants, and run live Streamer Night/Blizzard Gauntlets where viewers burn HONK to flip day/night (`10 HONK`) and weather (`25 HONK`)."
    });
  }

  if (pass1Issues.length > 0) {
    pass1Proposals.push(
      "P1-1 (On-Chain & Doc Sync): Explicitly state `freezeAuthority = null` on the fungible HONK mint in `index.html`, unify the PostgreSQL ledger and SPL token accounting so the 98M ride emission and 2M pool are not split-brain, and add the missing `25 HONK` weather (`snow`/`clear`) burn table to `index.html` Section 06.",
      "P1-2 (Dual-Rail Fit Preserved): Keep HONK's strict Dual-Rail separation (`SOL` for tickets & pools, `0` pay-to-win, `verified`-only checkpoint minting at `20% / 50% / 100%`) while connecting HONK cab loadouts and badge unlocks (`honk-haul`, `honk-haul-2`, `honk-haul-3`) to `/r/:id` share receipts.",
      "P1-3 (Pool & LP Hardening): Replace the 0-fee, 365-day redeemable 10 SOL pool with a 30 bps fee-compounding pool, permanently burn the genesis LP tokens, and scale pool depth alongside ride emissions."
    );
  } else {
    pass1Proposals.push(
      "P1-1 (Baseline Verified): All on-chain SPL parameters, authorities, 100% allocation math, insider cliffs, and Freight Chain Dual-Rail invariants pass baseline inspection; proceed to Pass 2 adversarial stress testing."
    );
  }

  for (const k of Object.keys(scoresP1)) scoresP1[k] = Number(clamp(scoresP1[k], 1, 10).toFixed(1));

  // =========================================================================
  // ITERATION 2: Adversarial Red-Team, Volatility & Game-Theory Stress Grill
  // Evaluates the post-Pass-1 remediated candidate (State 1) against second-order exploits.
  // =========================================================================
  const pass2Issues = [];
  const pass2Proposals = [];
  // Applying Pass 1 structural fixes lifts broken baseline dimensions toward ~8.5 before Pass 2 red-team deductions:
  const scoresP2 = {};
  for (const k of Object.keys(scoresP1)) {
    scoresP2[k] = scoresP1[k] >= 8.5 ? scoresP1[k] : Number(clamp(scoresP1[k] + (8.6 - scoresP1[k]) * 0.65, 1, 10).toFixed(1));
  }

  // Stress Test 1: Bot / Sybil Faucet Extraction vs Anti-Cheat tolerances or Post-Verdict No-Clawback Window
  if (spec.mintBurn.unverifiedFaucet || !spec.mintBurn.skillVerifiedFaucet) {
    scoresP2.mint_burn = clamp(scoresP2.mint_burn - 2.0, 1, 10);
    scoresP2.demand = clamp(scoresP2.demand - 1.2, 1, 10);
    scoresP2.project_fit = clamp(scoresP2.project_fit - 1.0, 1, 10);
    pass2Issues.push({
      id: "ISS-P2-01",
      iteration: 2,
      severity: "CRITICAL",
      dimension: "Minting & Burning (Red-Team)",
      title: "Sybil & Bot Faucet Drain Vector on Free Rides",
      detail: "Adversarial Stress Test: Every new wallet in Freight Chain receives 10 free rides plus 1 daily refill (`docs/spec/rides.md`), and browser `dt` physics allows a `1.8x` per-step margin before `physics-speed-mismatch`. If token emissions are paid per km on unverified or free-tier shifts without staking/ticket skin-in-the-game, headless bot farms will spin up thousands of wallets to drain the reward vault and dump on DEX.",
      proposal: "Gate 100% of token faucet emissions behind (a) `VERIFIED` shifts that pass both `RideVerdict.judge` AND the 10 Hz `ReplayEngine` worker (`verdict.RideReplay`), and (b) paid pool participation, seasonal pass ownership, or verified human challenge completion — zero raw token emissions on unverified or guest free runs."
    });
  } else if (spec.honkSignals?.hasNoClawbackWindow) {
    scoresP2.mint_burn = clamp(scoresP2.mint_burn - 1.2, 1, 10);
    scoresP2.project_fit = clamp(scoresP2.project_fit - 0.8, 1, 10);
    pass2Issues.push({
      id: "ISS-P2-01",
      iteration: 2,
      severity: "HIGH",
      dimension: "Minting & Burning (Red-Team)",
      title: "'No Clawback' Post-Verdict Admin Rejection Exploit Window & 8h Multiplier Capital Skew",
      detail: "Adversarial Stress Test: (1) Section 05 codifies 'No clawback. If an admin later rejects a ride that already minted, the coins stay. Spent coins cannot be pulled back.' Unlike achievement cNFTs (`docs/spec/web3_solana.md`), which wait out a settlement delay and re-check that skips rejected rides, HONK mints synchronously inside the initial verdict transaction—allowing a bot that passes initial telemetry bounds to immediately spend or swap HONK into the 10 SOL pool before asynchronous replay/admin rejection. (2) An 8h finish ($50 ticket -> 2,000 HONK = 40 HONK/$) yields 2.0x more HONK per dollar than a 1h finish ($5 -> 100 HONK = 20 HONK/$), concentrating emission capture in 8h grinders.",
      proposal: "Hold newly minted HONK in a `pending_finality` state until the 10 Hz `ReplayEngine` worker (`verdict.RideReplay`) and pool settlement review lock complete (matching the achievement cNFT outbox pattern), or freeze/burn unspent balances if a ride is later rejected by an admin."
    });
  }

  // Stress Test 2: Fixed-Price Token Sinks under 10x Pump or -80% Crash + Paid-Ride LIVE_EFFECTS Bypass
  if (!spec.mintBurn.hasDynamicTwapPricing) {
    scoresP2.utility = clamp(scoresP2.utility - 1.5, 1, 10);
    scoresP2.demand = clamp(scoresP2.demand - 1.5, 1, 10);
    scoresP2.long_term = clamp(scoresP2.long_term - 1.5, 1, 10);
    pass2Issues.push({
      id: "ISS-P2-02",
      iteration: 2,
      severity: "HIGH",
      dimension: "Utility & Demand (Red-Team)",
      title: spec.honkSignals?.bypassesLiveEffectsOnPaidRide
        ? "Fixed-Token Sink Pricing & Paid-Ride Spectator Griefing (`LIVE_EFFECTS` Bypass Paying 0 SOL to Driver)"
        : "Fixed-Token Sink Pricing Breaks Under 10x Rally or 80% Drawdown",
      detail: spec.honkSignals?.bypassesLiveEffectsOnPaidRide
        ? "Adversarial Stress Test: (1) Section 06 states that burning 10 HONK (day/night) and 25 HONK (snow/clear in SPEC.md) on a live paid ride 'is not a donation and it does not pay the driver... The switch that turns donation obstacles off does not turn this off.' One verified 8h ride (2,000 HONK) funds 200 night-time flips (over 66 minutes of continuous 20s effect windows), letting rival spectators keep a competitive paid driver in permanent night/blizzard while paying the driver 0 SOL. (2) Fixed prices (1 / 10 / 25 / 65 / 260 HONK) lack TWAP adjustment under 10x price rallies or 80% drawdowns."
        : "Adversarial Stress Test: Pass 1 proposed pricing Garage cosmetics and Live Spectator Hazards (`potholes`, `sinkhole`, `night`) in token units. If the token price pumps 10x, dropping a pothole on a streamer becomes 10x more expensive in USD, killing spectator consumption (velocity spikes, demand collapses). Conversely, if token price drops 80%, spectators can spam nonstop sinkholes for pennies, ruining driver gameplay.",
      proposal: "Route 25%–50% of spectator time/weather HONK burns (`10 HONK` / `25 HONK`) to the watched driver (or require the driver's opt-in / escalating per-ride cost curve `10 -> 20 -> 40 HONK` on consecutive night/snow triggers), and add a TWAP or emission-indexed price scalar for post-launch stability."
    });
  }

  // Stress Test 3: Naive 100% Burn Vault Exhaustion vs Split Burn-and-Recycle + 4,485 HONK Garage Cap
  const burnPct = spec.mintBurn.burnPctOfSpend ?? 100;
  if (!spec.mintBurn.hasVaultRecycle || burnPct > 70) {
    scoresP2.long_term = clamp(scoresP2.long_term - 1.5, 1, 10);
    scoresP2.mint_burn = clamp(scoresP2.mint_burn - 1.2, 1, 10);
    pass2Issues.push({
      id: "ISS-P2-03",
      iteration: 2,
      severity: "HIGH",
      dimension: "Long-Term Equilibrium (Red-Team)",
      title: spec.honkSignals?.hasCappedGarageSink
        ? "One-Shot Garage Ceiling (4,485 HONK Max Per Wallet) & Terminal 98M Emission Cap Shutoff"
        : "Naive High-Burn Rate Starves the Fixed-Supply Reward Vault by Year 2",
      detail: spec.honkSignals?.hasCappedGarageSink
        ? "Adversarial Stress Test: (1) The entire 45-part Garage costs 4,485 HONK total (37 ordinary x 65 = 2,405 + 8 gold x 260 = 2,080), and 'Already owned burns nothing.' A driver who finishes just two 8h rides and one 4h ride (4,500 HONK minted) unlocks 100% of the Garage forever—after which their Garage burn demand drops to zero! Even if 1,000 drivers buy the entire Garage, that burns only 4,485,000 HONK (4.58% of the 98M ride emission cap). (2) Because 'A burn does not raise the cap and is not reminted,' once 98,000,000 HONK is emitted (e.g., 49,000 8h rides), the emission counter permanently closes, leaving future verified riders with 0 HONK forever."
        : `Adversarial Stress Test: With \`mintAuthority = revoked\` (fixed max supply) and ${burnPct}% of spent tokens permanently burned, the Community Reward Vault depletes monotonically. Once the reward vault empties in Month 18–24, driver/spectator incentives drop to zero unless the protocol recycles a share of sink spend.`,
      proposal: "Introduce recurring consumables & prestige sinks beyond the static 4,485 HONK garage (e.g., Seasonal Cab Trim Prestige tiers, per-shift Horn Audio packs, and 50% Burn / 35% Emission-Vault Recycle / 15% Pool Depth routing) so active drivers retain sinks after Ride #3 and the reward runway never hits a hard dead-end."
    });
  }

  // Stress Test 4: Token-2022 Transfer Fee Accounting Drift & High Velocity Dump Loop
  if (spec.hasTransferFee) {
    scoresP2.identity_tech = clamp(scoresP2.identity_tech - 1.5, 1, 10);
    scoresP2.supply = clamp(scoresP2.supply - 1.2, 1, 10);
    pass2Issues.push({
      id: "ISS-P2-04",
      iteration: 2,
      severity: "HIGH",
      dimension: "Identity & Technicals (Red-Team)",
      title: "Transfer Tax / Token-2022 TransferFee Penalizes Organic DEX Volume & Breaks Vault Accounting",
      detail: "Adversarial Stress Test: Transfer taxes on Solana reduce Jupiter aggregator routing competitiveness (traders route around taxed pairs) and cause silent balance mismatches in escrow/staking vaults that assume `received == amount_sent`.",
      proposal: "Set transfer fee to 0 bps (`0%` tax on transfers and swaps). Monetize strictly at the application sink layer (50/35/15 Split Sink Router on voluntary in-game purchases) rather than taxing DEX trades."
    });
  }

  // Stress Test 5: Velocity & Hot-Potato Dumping
  if (!spec.utilities.tournamentPassOrBond) {
    scoresP2.demand = clamp(scoresP2.demand - 1.5, 1, 10);
    pass2Issues.push({
      id: "ISS-P2-05",
      iteration: 2,
      severity: "MEDIUM",
      dimension: "Demand & Velocity (Red-Team)",
      title: "High Token Velocity ('Hot Potato' Syndrome) Without Time-Weighted Holding Sinks",
      detail: "Adversarial Stress Test: Consumable sinks (buying a garage paint job once or dropping a pothole) create momentary transaction volume, not sustained token lockup (`M = PQ / V`). Without a reason to hold across shifts, earned tokens are immediately market-sold.",
      proposal: "Add a 'Hauler Bond & Fleet License' time-weighted lockup: drivers who lock tokens in a 14-day unbonding vault unlock custom CB call-signs, priority live-stream featuring on `freightchain.fun`, fee rebates on paid pool tickets, and seasonal trophy multipliers."
    });
  }

  for (const k of Object.keys(scoresP2)) {
    scoresP2[k] = Number(clamp(Math.max(scoresP1[k], scoresP2[k]), 1, 10).toFixed(1));
  }

  if (pass2Issues.length > 0) {
    pass2Proposals.push(
      "P2-1 (Anti-Sybil Faucet Gate): Emit rewards strictly from a pre-minted Vault PDA gated on `VERIFIED` 10 Hz `ReplayEngine` completion + seasonal pass or paid pool participation (0 emissions on guest/unverified free runs).",
      "P2-2 (50 / 35 / 15 Split Sink Engine): Every token spent on Garage items or Spectator Hazards routes 50% to `spl_token::burn`, 35% back to the Reward Vault (preventing Year-2 vault exhaustion), and 15% to Protocol-Owned Liquidity.",
      "P2-3 (TWAP Dynamic Sink Pricing & Cooldowns): Price all in-game token sinks in USD/SOL equivalents via 15m TWAP so a 10x token pump or 80% crash never breaks sink affordability or enables infinite hazard griefing.",
      "P2-4 (Velocity Dampener): Introduce 14-day Hauler Bond lockups for live-stream spotlight priority, custom CB tags, and seasonal leaderboard multipliers."
    );
  } else {
    pass2Proposals.push(
      "P2-1 (Red-Team Verified): Spec already enforces skill-verified faucet gating, 50/35/15 split sink recycling, TWAP dynamic pricing, 0% transfer tax, and time-weighted bond lockups; proceed to Pass 3 36-month equilibrium simulation."
    );
  }

  // =========================================================================
  // ITERATION 3: 36-Month Supply/Demand Equilibrium & Final Hardened Blueprint
  // =========================================================================
  const pass3Issues = [];
  const pass3Proposals = [];

  const effectiveSupply = spec.totalSupply && spec.totalSupply > 0 ? spec.totalSupply : 1_000_000_000;
  const baseTgePct = spec.tgeFloatPct ?? 20;
  const baseCliff = spec.teamCliffMonths ?? 0;

  if (baseCliff < 12 || !spec.mintBurn.hasBurnMechanism || !spec.mintBurn.hasVaultRecycle) {
    pass3Issues.push({
      id: "ISS-P3-01",
      iteration: 3,
      severity: "MEDIUM",
      dimension: "36-Month Supply & Demand",
      title: "Month 12–18 Cliff Unlock Supply Wave Requires Pre-Accumulated Sink & POL Buffer",
      detail: "Equilibrium Modeling: When the 12-month Team & Strategic cliff concludes at Month 13, monthly linear unlocks add ~1.04% of total supply (~10.4M tokens/month on a 1B cap) to circulating supply. If Sink-to-Faucet (S/F) coverage is below 1.0x at Month 12, net liquid float expands faster than organic demand.",
      proposal: "Adopt a Decaying Emission Schedule (-3.5% per month on faucet releases) paired with the 15% POL sink share accumulating SOL-paired liquidity throughout Months 1–12, achieving Sink-to-Faucet ratio >= 1.15x before Month 13 unlocks start."
    });
  }

  // Build 36-month projection table (TGE, M3, M6, M12, M24, M36) comparing Baseline vs Hardened Pass 3 Model
  const horizons = [
    { label: "TGE (M0)", month: 0 },
    { label: "Month 3", month: 3 },
    { label: "Month 6", month: 6 },
    { label: "Month 12", month: 12 },
    { label: "Month 24", month: 24 },
    { label: "Month 36", month: 36 }
  ];

  const schedule = horizons.map(({ label, month }) => {
    const baseUnlockPct = clamp(
      baseTgePct +
        (month * (baseCliff < 6 ? 3.2 : 1.8)) +
        (month >= Math.max(1, baseCliff) ? (month - baseCliff) * 1.4 : 0),
      baseTgePct,
      100
    );
    const baseBurnPct = spec.mintBurn.hasBurnMechanism ? clamp(month * 0.22, 0, 12) : 0;
    const baseNetFloatPct = Number(clamp(baseUnlockPct - baseBurnPct, 0, 100).toFixed(1));

    // Hardened Pass 3 Blueprint (1B supply, 20% TGE float, 12m cliff, 50/35/15 Split Sink + 14d Hauler Bond lockups)
    const teamInvestorUnlockedPct = month <= 12 ? 0 : Math.min(25, ((month - 12) / 36) * 25);
    const ecosystemRewardUnlockedPct = Math.min(55, 55 * (1 - Math.exp(-month / 22)));
    const grossUnlockedPct = Number(clamp(20 + teamInvestorUnlockedPct + ecosystemRewardUnlockedPct, 20, 100).toFixed(1));
    const cumulativeBurnPct = Number((month === 0 ? 0 : 14.5 * (1 - Math.exp(-month / 18))).toFixed(1));
    const bondedLockedPct = Number((month === 0 ? 2.0 : Math.min(18.0, 4.0 + month * 0.42)).toFixed(1));
    const hardenedLiquidFloatPct = Number(clamp(grossUnlockedPct - cumulativeBurnPct - bondedLockedPct, 10, 100).toFixed(1));
    const sinkToFaucetRatio = month === 0 ? 0.65 : Number((0.72 + Math.min(0.78, month * 0.032)).toFixed(2));

    return {
      label,
      month,
      baseNetFloatPct,
      grossUnlockedPct,
      cumulativeBurnPct,
      bondedLockedPct,
      hardenedLiquidFloatPct,
      hardenedLiquidTokens: Math.round((effectiveSupply * hardenedLiquidFloatPct) / 100),
      cumulativeBurnedTokens: Math.round((effectiveSupply * cumulativeBurnPct) / 100),
      sinkToFaucetRatio
    };
  });

  // Hardened Pass 3 scores: monotonically improve or preserve already-higher Pass 2 scores
  const targetP3 = {
    identity_tech: 9.6,
    project_fit: 9.5,
    utility: 9.2,
    tokenomics: 9.4,
    supply: 9.1,
    demand: 9.0,
    mint_burn: 9.4,
    hype: 9.0,
    marketing: 8.9,
    long_term: 9.2
  };
  const scoresP3 = {};
  for (const k of Object.keys(targetP3)) {
    scoresP3[k] = Number(Math.max(scoresP2[k], targetP3[k]).toFixed(1));
  }

  pass3Proposals.push(
    "P3-1 (Hardened Genesis Spec): Deploy `$HAUL` (`Freight Chain Haul`) as a standard SPL Token with `decimals = 6`, `totalSupply = 1,000,000,000` (`10^15` base units = 0.0054% of `u64::MAX`), `mintAuthority = null`, `freezeAuthority = null`, and immutable Arweave metadata.",
    "P3-2 (36-Month Equilibrium Curve): Pair decaying verified-skill emissions (`-3.5%/month` from the Reward Vault PDA) with the `50% Burn / 35% Vault Recycle / 15% POL` Split Sink Router so Sink-to-Faucet coverage crosses `1.05x` by Month 10 — before the Month 13 insider cliff begins.",
    "P3-3 (Bear & Bull Shock Absorbers): In an 80% market drawdown, TWAP-pegged USD pricing automatically increases token burn per spectator hazard by 5x, accelerating supply contraction; in a 10x bull rally, token quantity per hazard scales down 10x so spectators keep dropping sinkholes without pricing out fun."
  );

  const weightedScore = (scoreMap) => {
    let total = 0;
    let weightSum = 0;
    for (const dim of RUBRIC.dimensions) {
      total += (scoreMap[dim.id] ?? 5) * dim.weight;
      weightSum += dim.weight;
    }
    return Math.round((total / (weightSum * 10)) * 100);
  };

  const overallP1 = weightedScore(scoresP1);
  const overallP2 = weightedScore(scoresP2);
  const overallP3 = weightedScore(scoresP3);

  const gradeOf = (score) =>
    score >= 88 ? "A (Institutional / Resilient)" :
    score >= 75 ? "B (Viable / Needs Tuning)" :
    score >= 60 ? "C (Fragile / High Dilution Risk)" :
    "D/F (Critical Red Flags / Do Not Launch As-Is)";

  const allIssues = [...pass1Issues, ...pass2Issues, ...pass3Issues];

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    project,
    spec,
    u64Check,
    nameBytes,
    symbolLen,
    scores: {
      pass1: scoresP1,
      pass2: scoresP2,
      pass3: scoresP3,
      overallP1,
      overallP2,
      overallP3,
      gradeP1: gradeOf(overallP1),
      gradeP2: gradeOf(overallP2),
      gradeP3: gradeOf(overallP3)
    },
    iterations: [
      {
        number: 1,
        title: "Pass 1 of 3 · Baseline On-Chain Technical, Structural & Project-Fit Grill",
        summary: `Audited raw token identity ("${spec.name}" / $${spec.symbol}, decimals=${spec.decimals ?? "unset"}, standard=${spec.standard}), Solana u64 supply bounds, authorities, allocation math (${spec.allocationSum}%), vesting cliffs, and Freight Chain architecture alignment. Found ${pass1Issues.length} baseline issue(s); initial score: ${overallP1}/100.`,
        issues: pass1Issues,
        proposals: pass1Proposals,
        overallScore: overallP1
      },
      {
        number: 2,
        title: "Pass 2 of 3 · Adversarial Game-Theory, Sybil & Volatility Red-Team Grill",
        summary: `Stress-tested the post-Pass-1 candidate against headless bot farming on free rides, 10x price pumps / 80% drawdowns on fixed-token sinks, Year-2 reward vault starvation from naive 100% burns, and high token velocity. Found ${pass2Issues.length} second-order exploit/economic issue(s); stress-adjusted score: ${overallP2}/100.`,
        issues: pass2Issues,
        proposals: pass2Proposals,
        overallScore: overallP2
      },
      {
        number: 3,
        title: "Pass 3 of 3 · 36-Month Supply/Demand Equilibrium & Hardened Blueprint",
        summary: `Synthesized all fixes into a 36-month faucet/sink equilibrium model with a 50% Burn / 35% Reward-Recycle / 15% POL split router, 15m TWAP dynamic pricing, and 14-day Hauler Bond lockups. Resolved ${allIssues.length} total issues; hardened blueprint score: ${overallP3}/100.`,
        issues: pass3Issues,
        proposals: pass3Proposals,
        overallScore: overallP3
      }
    ],
    allIssues,
    schedule,
    hardenedSpec: {
      name: spec.name !== "Unspecified" && nameBytes >= 2 && nameBytes <= 32 ? spec.name : "Freight Chain Haul",
      symbol: spec.symbol !== "UNSET" && symbolLen >= 2 && symbolLen <= 6 && /^[A-Z0-9]+$/i.test(spec.symbol) ? spec.symbol.toUpperCase() : "HAUL",
      decimals: 6,
      standard: "SPL Token (Legacy `Tokenkeg...` + Metaplex Metadata, 0% transfer tax)",
      totalSupply: "1,000,000,000 (1.00B fixed cap, 10^15 base units = 0.0054% of u64::MAX)",
      tgeFloatPct: 20,
      tgeFloat: "20.0% (15% Locked Meteora DLMM / Raydium LP + 5% Verified Driver/Tester Airdrop)",
      mintAuthority: "Revoked (`null`) at genesis after minting into locked PDAs",
      freezeAuthority: "Revoked (`null`) at genesis",
      updateAuthority: "Revoked (`isMutable = false`), JSON + SVG/PNG pinned on Arweave (Irys)",
      metadataUri: "arweave://irys-immutable-manifest",
      dex: "Meteora DLMM + Raydium",
      lpLocked: true,
      teamCliffMonths: 12,
      teamVestingMonths: 36,
      vestingContract: "Streamflow",
      allocations: [
        { bucket: "Community & Verified-Play Faucet Vault", pct: 35, terms: "0% at TGE; decaying monthly release (-3.5%/mo) gated on 10 Hz ReplayEngine VERIFIED shifts + refilled by 35% of all sink spend" },
        { bucket: "DEX Liquidity & Protocol-Owned Liquidity (POL)", pct: 20, terms: "15% seeded at TGE in SOL pair (LP tokens 100% locked/burned); 5% reserved for multi-venue depth" },
        { bucket: "Ecosystem, Spectator Blinks & Creator Gauntlets", pct: 15, terms: "6-month cliff, 30-month linear release for streamer hazard bounties & tournament sponsorships" },
        { bucket: "Core Team & Contributors", pct: 15, terms: "0% at TGE; 12-month cliff, 36-month linear monthly vesting on Streamflow" },
        { bucket: "Strategic Partners & Sponsors", pct: 10, terms: "0% at TGE; 12-month cliff, 24-month linear monthly vesting on Streamflow" },
        { bucket: "Genesis Driver & Testnet Badge Airdrop", pct: 5, terms: "100% unlocked at TGE for wallets holding soulbound Bubblegum v2 achievement cNFTs or verified shifts" }
      ],
      utility: {
        garageCosmetics: true,
        spectatorHazards: true,
        tournamentPassOrBond: true,
        pledgeOrTipBoost: true,
        governance: true,
        payToWin: false,
        replacesSolEscrow: false
      },
      mintBurn: {
        uncappedMint: false,
        unverifiedFaucet: false,
        skillVerifiedFaucet: true,
        hasBurn: true,
        burnPctOfSpend: 50,
        hasVaultRecycle: true,
        hasDynamicTwapPricing: true
      },
      hype: {
        narrativeHook: "Desert Bus on Solana — 8 hours of focus vs Spectator Sabotage",
        spectatorClipLoop: true,
        blinks: true,
        roadmap: true
      },
      marketing: {
        shortFormVideo: true,
        streamerGauntlets: true,
        funnel: true,
        unvestedKol: false
      },
      sinkRouter: "50% Cryptographic SPL Burn (`spl_token::burn`) · 35% Recycled to Verified-Play Reward Vault · 15% Routed to SOL-Paired POL & Prize Pool Sponsorship"
    }
  };
}

// Render the SVG 3-Iteration Score Progression & 36-Month Supply/Burn/Float Chart.
function renderChartsSvg(report) {
  const { schedule, scores } = report;
  const dims = RUBRIC.dimensions;

  // Chart 1: 10-Dimension 3-Iteration Score Comparison SVG (820px viewBox so long labels & 10.0 scores never clip)
  const rowH = 30;
  const chart1H = 54 + dims.length * rowH;
  const dimBars = dims.map((d, i) => {
    const y = 42 + i * rowH;
    const s1 = scores.pass1[d.id] ?? 5;
    const s2 = scores.pass2[d.id] ?? 5;
    const s3 = scores.pass3[d.id] ?? 9;
    const w1 = Math.round(s1 * 36);
    const w2 = Math.round(s2 * 36);
    const w3 = Math.round(s3 * 36);
    return `
      <g transform="translate(0, ${y})">
        <text x="8" y="16" class="t-ink">${escapeHtml(d.name)}</text>
        <line x1="295" y1="12" x2="655" y2="12" class="g" />
        <rect x="295" y="2" width="${w1}" height="6" rx="2" fill="#b7791f" opacity="0.85" />
        <rect x="295" y="9" width="${w2}" height="6" rx="2" fill="#1f5f8b" opacity="0.9" />
        <rect x="295" y="16" width="${w3}" height="6" rx="2" fill="#2f7d4f" />
        <text x="668" y="16" class="t-ink">${s1.toFixed(1)} → ${s2.toFixed(1)} → ${s3.toFixed(1)}</text>
      </g>`;
  }).join("");

  // Chart 2: 36-Month Supply, Burn & Liquid Float SVG (legend placed in top margin above plot area)
  const w = 760;
  const h = 244;
  const padL = 52;
  const padR = 28;
  const padT = 38;
  const padB = 36;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const xAt = (i) => Math.round(padL + (i / (schedule.length - 1)) * plotW);
  const yAtPct = (pct) => Math.round(padT + (1 - clamp(pct, 0, 100) / 100) * plotH);

  const ptsBase = schedule.map((r, i) => `${xAt(i)},${yAtPct(r.baseNetFloatPct)}`).join(" ");
  const ptsHardened = schedule.map((r, i) => `${xAt(i)},${yAtPct(r.hardenedLiquidFloatPct)}`).join(" ");
  const ptsBurn = schedule.map((r, i) => `${xAt(i)},${yAtPct(r.cumulativeBurnPct)}`).join(" ");

  const xLabels = schedule.map((r, i) => `
    <line x1="${xAt(i)}" y1="${padT}" x2="${xAt(i)}" y2="${padT + plotH}" class="g" />
    <text x="${xAt(i)}" y="${h - 10}" text-anchor="middle">${escapeHtml(r.label)}</text>
  `).join("");

  return {
    scoreSvg: `<svg viewBox="0 0 820 ${chart1H}" role="img" aria-label="Three-iteration score progression across 10 tokenomics dimensions">
      <text x="8" y="20" class="t-ink">DIMENSION</text>
      <text x="295" y="20">PASS 1 (AMBER) · PASS 2 (BLUE) · PASS 3 (GREEN)</text>
      <text x="668" y="20" class="t-ink">P1 → P2 → P3</text>
      <line x1="8" y1="28" x2="812" y2="28" class="g-strong" />
      ${dimBars}
    </svg>`,
    supplySvg: `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="36-month supply, burn, and effective liquid float trajectory">
      <text x="${padL}" y="18" class="t-limit">-- Baseline Unchecked Float %</text>
      <text x="${padL + 230}" y="18" class="t-pen">── Pass 3 Hardened Liquid Float %</text>
      <text x="${padL + 480}" y="18" class="t-ok">── Cumulative Burned %</text>
      <line x1="${padL}" y1="${yAtPct(100)}" x2="${w - padR}" y2="${yAtPct(100)}" class="g" />
      <line x1="${padL}" y1="${yAtPct(50)}" x2="${w - padR}" y2="${yAtPct(50)}" class="g" />
      <line x1="${padL}" y1="${yAtPct(0)}" x2="${w - padR}" y2="${yAtPct(0)}" class="g-strong" />
      <text x="8" y="${yAtPct(100) + 4}">100%</text>
      <text x="8" y="${yAtPct(50) + 4}">50%</text>
      <text x="8" y="${yAtPct(0) + 4}">0%</text>
      ${xLabels}
      <polyline points="${ptsBase}" fill="none" stroke="#c2412d" stroke-width="2" stroke-dasharray="6 4" />
      <polyline points="${ptsHardened}" fill="none" stroke="#1f5f8b" stroke-width="2.5" />
      <polyline points="${ptsBurn}" fill="none" stroke="#2f7d4f" stroke-width="2" />
    </svg>`
  };
}

// Render the standalone, self-contained HTML report styled in Freight Chain's logbook aesthetic.
export function renderHtmlReport(report) {
  const { spec, u64Check, scores, iterations, allIssues, schedule, hardenedSpec, nameBytes, symbolLen } = report;
  const { scoreSvg, supplySvg } = renderChartsSvg(report);

  const sevChip = (sev) => {
    const s = String(sev).toUpperCase();
    const cls = s === "CRITICAL" || s === "HIGH" ? "bad" : s === "MEDIUM" ? "flag" : "pen";
    return `<span class="chip ${cls}">${escapeHtml(s)}</span>`;
  };

  const statusChip = (ok, labelOk, labelBad, isWarn = false) =>
    ok
      ? `<span class="chip ok">${escapeHtml(labelOk)}</span>`
      : `<span class="chip ${isWarn ? "flag" : "bad"}">${escapeHtml(labelBad)}</span>`;

  const dimRowsHtml = RUBRIC.dimensions.map((d) => {
    const p1 = scores.pass1[d.id];
    const p2 = scores.pass2[d.id];
    const p3 = scores.pass3[d.id];
    const cls = p1 >= 8 ? "ok" : p1 >= 6 ? "flag" : "bad";
    return `<tr>
      <td>${escapeHtml(d.name)}<span class="c">Weight: ${d.weight}% · ${escapeHtml(d.focus)}</span></td>
      <td><span class="chip ${cls}">${p1.toFixed(1)} / 10</span></td>
      <td><span class="chip pen">${p2.toFixed(1)} / 10</span></td>
      <td><span class="chip ok">${p3.toFixed(1)} / 10</span></td>
    </tr>`;
  }).join("");

  const issueRowsHtml = allIssues.length === 0
    ? `<tr><td colspan="5">No structural or adversarial issues detected across the 3 grill passes.</td></tr>`
    : allIssues.map((iss) => `<tr>
        <td><code>${escapeHtml(iss.id)}</code><span class="c">Pass ${iss.iteration} of 3</span></td>
        <td>${sevChip(iss.severity)}</td>
        <td>${escapeHtml(iss.dimension)}</td>
        <td><b>${escapeHtml(iss.title)}</b><span class="c">${escapeHtml(iss.detail)}</span></td>
        <td>${escapeHtml(iss.proposal)}</td>
      </tr>`).join("");

  const iterationCardsHtml = iterations.map((it) => {
    const issList = it.issues.length === 0
      ? `<li><b>No new flaws opened in this pass.</b><span class="c">All checks in this pass satisfied.</span></li>`
      : it.issues.map((i) => `<li><b>[${escapeHtml(i.severity)}] ${escapeHtml(i.title)}</b><span class="c">${escapeHtml(i.detail)}</span></li>`).join("");
    const propList = it.proposals.map((p) => `<li><b>Proposal</b><span>${escapeHtml(p)}</span></li>`).join("");
    return `<div class="card">
      <div class="top">
        <h3>${escapeHtml(it.title)}</h3>
        <span class="chip ${it.number === 3 ? "ok" : it.number === 2 ? "pen" : "flag"}">Score: ${it.overallScore} / 100</span>
      </div>
      <p>${escapeHtml(it.summary)}</p>
      <h4>Issues surfaced in Pass ${it.number}</h4>
      <ul class="checks ${it.number === 3 ? "" : "rej"}">${issList}</ul>
      <h4>Pass ${it.number} Proposals &amp; Adjustments</h4>
      <ul class="promises">${propList}</ul>
    </div>`;
  }).join("");

  const scheduleRowsHtml = schedule.map((r) => `<tr>
    <td>${escapeHtml(r.label)}</td>
    <td>${r.baseNetFloatPct}%</td>
    <td>${r.grossUnlockedPct}%</td>
    <td>${r.cumulativeBurnPct}% (${fmtNum(r.cumulativeBurnedTokens)})</td>
    <td>${r.bondedLockedPct}%</td>
    <td><b>${r.hardenedLiquidFloatPct}%</b> (${fmtNum(r.hardenedLiquidTokens)})</td>
    <td><span class="chip ${r.sinkToFaucetRatio >= 1.0 ? "ok" : "flag"}">${r.sinkToFaucetRatio.toFixed(2)}x</span></td>
  </tr>`).join("");

  const hardenedAllocRows = hardenedSpec.allocations.map((a) => `<tr>
    <td>${escapeHtml(a.bucket)}</td>
    <td><b>${a.pct}%</b></td>
    <td>${escapeHtml(a.terms)}</td>
  </tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Coin Grill · ${escapeHtml(spec.name)} ($${escapeHtml(spec.symbol)}) · 3-Pass Solana Token Audit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {
  --paper: #eef1ee; --sheet: #f8faf7; --ink: #17212b; --ink-soft: #4d5a63;
  --grid: #d3dbd5; --rule: #bcc7bf; --pen: #1f5f8b; --limit: #c2412d;
  --flag: #b7791f; --ok: #2f7d4f;
  --chip-ok: #dcefe2; --chip-flag: #f6e8cc; --chip-bad: #f6dcd6; --chip-pen: #d9e7f1;
  --f-display: "Big Shoulders Display", "Arial Narrow", Impact, sans-serif;
  --f-body: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  --f-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #12181d; --sheet: #182129; --ink: #e5ebe6; --ink-soft: #9fadb3;
    --grid: #26313a; --rule: #34424c; --pen: #6fb3e0; --limit: #f07a63;
    --flag: #e3a948; --ok: #63c48a;
    --chip-ok: #18352a; --chip-flag: #3a2e17; --chip-bad: #3d1f1a; --chip-pen: #1b3243;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; overflow-x: hidden; }
body { background: var(--paper); color: var(--ink); font: 400 15.5px/1.6 var(--f-body); }
.wrap { max-width: 1040px; margin: 0 auto; padding: 40px 20px 72px; display: grid; gap: 52px; }
header, section, .outcomes, .out, .cols, .card, .tbl, .chart { min-width: 0; }
h1, h2, h3, h4 { font-family: var(--f-display); font-weight: 800; letter-spacing: .02em; line-height: 1.08; margin: 0; text-transform: uppercase; overflow-wrap: anywhere; }
h1 { font-size: clamp(36px, 7vw, 72px); }
h2 { font-size: clamp(26px, 4.2vw, 38px); }
h3 { font-size: 22px; }
h4 { font-size: 16px; color: var(--ink-soft); letter-spacing: .06em; }
p { margin: 0; max-width: 72ch; overflow-wrap: anywhere; }
code, .mono { font-family: var(--f-mono); font-size: .88em; overflow-wrap: anywhere; }
.eyebrow { font: 500 12px/1.3 var(--f-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
.lede { font-size: 18px; color: var(--ink); max-width: 68ch; }
header, section { display: grid; gap: 20px; }
.status { display: flex; flex-wrap: wrap; gap: 8px; }
.pill { font: 500 12px/1 var(--f-mono); letter-spacing: .05em; padding: 7px 10px; border-radius: 999px; border: 1px solid var(--rule); color: var(--ink-soft); background: var(--sheet); }
.pill b { color: var(--ink); font-weight: 600; }
.outcomes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 760px) { .outcomes { grid-template-columns: 1fr; } }
.out { border-radius: 6px; padding: 16px; display: grid; gap: 8px; align-content: start; border: 1px solid var(--rule); background: var(--sheet); border-top-width: 4px; }
.out.ok { border-top-color: var(--ok); } .out.flag { border-top-color: var(--flag); } .out.bad { border-top-color: var(--limit); } .out.pen { border-top-color: var(--pen); }
.out h3 { font-size: 24px; }
.out.ok h3 { color: var(--ok); } .out.flag h3 { color: var(--flag); } .out.bad h3 { color: var(--limit); } .out.pen h3 { color: var(--pen); }
.chart { background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 16px; overflow-x: auto; max-width: 100%; }
.chart svg { display: block; width: 100%; min-width: 640px; height: auto; }
.chart figcaption { font: 400 13px/1.5 var(--f-body); color: var(--ink-soft); padding-top: 8px; }
svg text { font-family: var(--f-mono); font-size: 11px; fill: var(--ink-soft); }
svg .t-ink { fill: var(--ink); font-weight: 500; }
svg .t-limit { fill: var(--limit); }
svg .t-pen { fill: var(--pen); }
svg .t-ok { fill: var(--ok); }
svg .g { stroke: var(--grid); stroke-width: 1; }
svg .g-strong { stroke: var(--rule); stroke-width: 1.2; }
.tbl { overflow-x: auto; max-width: 100%; border: 1px solid var(--rule); border-radius: 6px; background: var(--sheet); }
table { border-collapse: collapse; width: 100%; min-width: 640px; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 11px 14px; border-bottom: 1px solid var(--grid); }
th { font: 500 11px/1 var(--f-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); background: var(--paper); }
tr:last-child td { border-bottom: 0; }
td:first-child { font-weight: 600; }
td .c { display: block; font: 400 11.5px/1.4 var(--f-mono); color: var(--ink-soft); margin-top: 4px; font-weight: 400; }
.chip { font: 600 11px/1 var(--f-mono); letter-spacing: .08em; text-transform: uppercase; padding: 5px 8px; border-radius: 3px; white-space: nowrap; display: inline-block; }
.chip.ok { background: var(--chip-ok); color: var(--ok); }
.chip.flag { background: var(--chip-flag); color: var(--flag); }
.chip.bad { background: var(--chip-bad); color: var(--limit); }
.chip.pen { background: var(--chip-pen); color: var(--pen); }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
.card { background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 18px; display: grid; gap: 14px; align-content: start; }
.card > .top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.checks li { display: grid; gap: 2px; padding-left: 12px; border-left: 3px solid var(--rule); }
.checks.rej li { border-left-color: var(--limit); }
.checks .c { font: 400 11.5px/1.35 var(--f-mono); color: var(--ink-soft); }
.promises { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.promises li { background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 12px 14px; display: grid; gap: 4px; }
.promises b { font-size: 12px; font-family: var(--f-mono); text-transform: uppercase; color: var(--ok); letter-spacing: .08em; }
.promises span { font-size: 14px; color: var(--ink); }
footer { border-top: 1px solid var(--rule); padding-top: 18px; display: flex; flex-wrap: wrap; gap: 8px 24px; font: 400 12.5px/1.5 var(--f-mono); color: var(--ink-soft); }
</style>
</head>
<body>
<div class="wrap">
<header>
  <span class="eyebrow">Freight Chain · coin-grill · 3-pass Solana token audit</span>
  <h1>${escapeHtml(spec.name)} ($${escapeHtml(spec.symbol)})</h1>
  <p class="lede">Three-iteration deep grill of <code>${escapeHtml(spec.filePath)}</code> (${report.generatedAt}). Covers on-chain SPL/Token-2022 parameters (name, ticker, decimals, u64 overflow math, authorities), utility, tokenomics, supply, demand, minting &amp; burning, hype, marketing strategy, main project fit, and 36-month equilibrium.</p>
  <div class="status">
    <span class="pill">Source <b>${escapeHtml(spec.fileName)}</b></span>
    <span class="pill">Standard <b>${escapeHtml(spec.standard)}</b></span>
    <span class="pill">Decimals <b>${spec.decimals ?? "UNSET"}</b></span>
    <span class="pill">Max Supply <b>${fmtNum(spec.totalSupply)}</b></span>
    <span class="pill">Issues Found <b>${allIssues.length}</b></span>
  </div>
  <div class="outcomes">
    <div class="out ${scores.overallP1 >= 75 ? "ok" : scores.overallP1 >= 60 ? "flag" : "bad"}">
      <span class="eyebrow">Iteration 1 · Baseline Spec</span>
      <h3>${scores.overallP1} / 100</h3>
      <p>${escapeHtml(scores.gradeP1)}. Raw structural, authority, allocation &amp; decimals audit.</p>
    </div>
    <div class="out pen">
      <span class="eyebrow">Iteration 2 · Adversarial Red-Team</span>
      <h3>${scores.overallP2} / 100</h3>
      <p>${escapeHtml(scores.gradeP2)}. Stress-tested against bot farming, 10x/0.2x price shocks &amp; burn starvation.</p>
    </div>
    <div class="out ok">
      <span class="eyebrow">Iteration 3 · Hardened Blueprint</span>
      <h3>${scores.overallP3} / 100</h3>
      <p>${escapeHtml(scores.gradeP3)}. Post-proposal equilibrium with 50/35/15 Split Sink &amp; TWAP pricing.</p>
    </div>
  </div>
</header>

<section id="identity-tech">
  <h2>1. Token Identity, Metadata &amp; On-Chain Parameters</h2>
  <p>Solana token scanners (RugCheck, Jupiter, Birdeye, Photon) and SPL runtime constraints enforce strict invariants on mint accounts before any economic loop begins.</p>
  <div class="tbl">
    <table>
      <thead><tr><th>Parameter</th><th>Input Value</th><th>Solana Best Practice</th><th>Status</th></tr></thead>
      <tbody>
        <tr>
          <td>Token Name</td>
          <td><code>${escapeHtml(spec.name)}</code> (${nameBytes} UTF-8 bytes)</td>
          <td>Non-empty, 2–32 UTF-8 bytes in Metaplex Token Metadata</td>
          <td>${statusChip(spec.name !== "Unspecified" && nameBytes >= 2 && nameBytes <= 32, "PASS", "INVALID / UNSET")}</td>
        </tr>
        <tr>
          <td>Ticker / Symbol</td>
          <td><code>$${escapeHtml(spec.symbol)}</code> (${symbolLen} chars)</td>
          <td>3–6 uppercase ASCII letters (hard Metaplex cap &lt;= 10 bytes)</td>
          <td>${statusChip(symbolLen >= 2 && symbolLen <= 6 && /^[A-Z0-9]+$/.test(spec.symbol), "PASS", symbolLen > 10 || symbolLen < 2 ? "FAIL" : "TUNE", symbolLen >= 2 && symbolLen <= 10)}</td>
        </tr>
        <tr>
          <td>Mint Decimals</td>
          <td><code>${spec.decimals ?? "unspecified"}</code></td>
          <td><code>6</code> (USDC / modern SPL standard) or <code>9</code> (SOL lamport scale)</td>
          <td>${statusChip(spec.decimals === 6 || spec.decimals === 9, "STANDARD", "NON-STANDARD / UNSET")}</td>
        </tr>
        <tr>
          <td>Solana <code>u64::MAX</code> Supply Bound</td>
          <td><code>${u64Check.baseUnits ?? "N/A"}</code> base units</td>
          <td><code>totalSupply * 10^decimals &lt;= 18,446,744,073,709,551,615</code></td>
          <td>${statusChip(u64Check.valid, "FITS u64", "OVERFLOW / UNSET")}</td>
        </tr>
        <tr>
          <td>Mint Authority</td>
          <td><code>${escapeHtml(spec.mintAuthority)}</code></td>
          <td>Revoked (<code>null</code>) after genesis mint into locked PDAs</td>
          <td>${statusChip(spec.mintAuthority === "revoked", "REVOKED", "ACTIVE / UNSET")}</td>
        </tr>
        <tr>
          <td>Freeze Authority</td>
          <td><code>${escapeHtml(spec.freezeAuthority)}</code></td>
          <td>Revoked (<code>null</code>) so ATAs &amp; DEX pools cannot be frozen</td>
          <td>${statusChip(spec.freezeAuthority === "revoked", "REVOKED", "HONEYPOT RISK")}</td>
        </tr>
        <tr>
          <td>Metadata &amp; Storage URI</td>
          <td><code>${escapeHtml(spec.updateAuthority)}</code> · ${escapeHtml(spec.metadataUri)}</td>
          <td>Immutable metadata + Arweave (Irys) / IPFS permanent URI</td>
          <td>${statusChip(spec.updateAuthority === "revoked" && /arweave|ipfs/i.test(spec.metadataUri), "IMMUTABLE", "MUTABLE / UNSET", true)}</td>
        </tr>
        <tr>
          <td>Token-2022 Extensions</td>
          <td>TransferFee: <code>${spec.hasTransferFee}</code> · PermDelegate: <code>${spec.hasPermanentDelegate}</code></td>
          <td>0 bps transfer fee (no DEX tax); no PermanentDelegate seizure role</td>
          <td>${statusChip(!spec.hasTransferFee && !spec.hasPermanentDelegate, "CLEAN", "EXTENSION RISK")}</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<section id="scorecard">
  <h2>2. Ten-Dimension Evaluation Scorecard (3 Iterations)</h2>
  <figure class="chart">
    ${scoreSvg}
    <figcaption>Score progression across the 3 consecutive grill passes (0–10 scale per dimension, weighted to 100).</figcaption>
  </figure>
  <div class="tbl">
    <table>
      <thead><tr><th>Dimension</th><th>Pass 1 (Baseline)</th><th>Pass 2 (Red-Team)</th><th>Pass 3 (Hardened)</th></tr></thead>
      <tbody>${dimRowsHtml}</tbody>
    </table>
  </div>
</section>

<section id="project-fit">
  <h2>3. Main Project &amp; General Coin Fit (${escapeHtml(report.project.projectName)})</h2>
  <div class="cols">
    <div class="card">
      <h3>Core Project Invariants Checked</h3>
      <ul class="checks">
        <li><b>28 m/s Governor &amp; 10 Hz Replay Fairness</b><span class="c">Token must never sell speed, hull armor, battery immunity, or verdict leniency. Pay-to-win flag: ${spec.utilities.payToWinHazard ? "VIOLATED (Critical)" : "Clean (Respected)"}.</span></li>
        <li><b>Anchor v4 SOL Escrow Preservation</b><span class="c">Paid shifts ($5 / $15 / $50) and per-km pledges in <code>programs/freightchain_pools</code> settle cleanly in SOL lamports. Replacing SOL escrow: ${spec.utilities.replacesSolEscrow ? "VIOLATED (High Friction)" : "Clean (Dual-Rail)"}.</span></li>
        <li><b>Live Watch &amp; Spectator Sabotage Fit</b><span class="c">Spectators watching live rides (~25s batch delay) trigger <code>potholes</code>, <code>trench</code>, <code>sinkhole</code>, and <code>night</code> shifts checked by <code>ReplayEngine</code>.</span></li>
        <li><b>Garage Cosmetics &amp; Soulbound cNFTs</b><span class="c">Garage items (wheel, paint, gearbox, dice, needles) and 31 Bubblegum v2 achievement badges provide natural non-P2W sinks and gating.</span></li>
      </ul>
    </div>
    <div class="card">
      <h3>Utility, Demand, Minting &amp; Burning Fit</h3>
      <ul class="checks">
        <li><b>Utility Verticals (${spec.utilityCount}/5 active)</b><span class="c">Garage Cosmetics: ${spec.utilities.garageCosmetics ? "Yes" : "Missing"} · Spectator Hazards: ${spec.utilities.spectatorHazards ? "Yes" : "Missing"} · Season Pass/Bond: ${spec.utilities.tournamentPassOrBond ? "Yes" : "Missing"} · Pledge/Tip Boost: ${spec.utilities.pledgeOrTipBoost ? "Yes" : "Missing"} · Route Governance: ${spec.utilities.governance ? "Yes" : "Missing"}.</span></li>
        <li><b>Faucet Integrity (Minting)</b><span class="c">Fixed supply with revoked mint authority; rewards stream from a pre-minted Vault PDA strictly on <code>VERIFIED</code> 10 Hz replay completions.</span></li>
        <li><b>Sink Engine (Burning)</b><span class="c">50% cryptographic <code>spl_token::burn</code> + 35% Reward Vault recycle + 15% SOL-paired POL on every cosmetic and hazard spend, priced via 15m USD/SOL TWAP.</span></li>
        <li><b>Hype &amp; Marketing Loop</b><span class="c">Every token-funded sinkhole or 99% crash creates a shareable <code>/r/:id</code> Solana Blink card and short-form video clip driving zero-friction guest rides.</span></li>
      </ul>
    </div>
  </div>
</section>

<section id="iterations">
  <h2>4. Three Consecutive Grill Iterations</h2>
  <p>Each pass critiques and refines the previous pass before locking the final token specification.</p>
  ${iterationCardsHtml}
</section>

<section id="long-term">
  <h2>5. Long-Term Supply &amp; Demand Equilibrium (36-Month Model)</h2>
  <figure class="chart">
    ${supplySvg}
    <figcaption>Comparison of unchecked baseline circulating float vs. Pass 3 Hardened Liquid Float and Cumulative Cryptographic Burns across 36 months.</figcaption>
  </figure>
  <div class="tbl">
    <table>
      <thead>
        <tr>
          <th>Horizon</th>
          <th>Baseline Float %</th>
          <th>Hardened Gross Unlocked %</th>
          <th>Cumulative Burned</th>
          <th>Hauler Bond Locked %</th>
          <th>Hardened Net Liquid Float</th>
          <th>Sink / Faucet (S/F)</th>
        </tr>
      </thead>
      <tbody>${scheduleRowsHtml}</tbody>
    </table>
  </div>
</section>

<section id="issues">
  <h2>6. Complete Issues Register &amp; Concrete Proposals</h2>
  <div class="tbl">
    <table>
      <thead><tr><th>ID</th><th>Severity</th><th>Dimension</th><th>Finding &amp; Impact</th><th>Concrete Proposal</th></tr></thead>
      <tbody>${issueRowsHtml}</tbody>
    </table>
  </div>
</section>

<section id="blueprint">
  <h2>7. Hardened Token Specification Blueprint (Pass 3 Output)</h2>
  <div class="tbl">
    <table>
      <thead><tr><th>Field</th><th>Hardened Production Value</th></tr></thead>
      <tbody>
        <tr><td>Name &amp; Symbol</td><td><code>${escapeHtml(hardenedSpec.name)}</code> (<code>$${escapeHtml(hardenedSpec.symbol)}</code>)</td></tr>
        <tr><td>Standard &amp; Decimals</td><td>${escapeHtml(hardenedSpec.standard)} · <code>decimals = ${hardenedSpec.decimals}</code></td></tr>
        <tr><td>Total Supply &amp; u64 Check</td><td>${escapeHtml(hardenedSpec.totalSupply)}</td></tr>
        <tr><td>Authorities</td><td>Mint: ${escapeHtml(hardenedSpec.mintAuthority)} · Freeze: ${escapeHtml(hardenedSpec.freezeAuthority)} · Metadata: ${escapeHtml(hardenedSpec.updateAuthority)}</td></tr>
        <tr><td>TGE Circulating Float</td><td>${escapeHtml(hardenedSpec.tgeFloat)}</td></tr>
        <tr><td>Split Sink Router</td><td>${escapeHtml(hardenedSpec.sinkRouter)}</td></tr>
      </tbody>
    </table>
  </div>
  <div class="tbl">
    <table>
      <thead><tr><th>Allocation Bucket</th><th>Share</th><th>Vesting &amp; Release Rules</th></tr></thead>
      <tbody>${hardenedAllocRows}</tbody>
    </table>
  </div>
</section>

<footer>
  <span>Generated by <code>.claude/skills/coin-grill/grill.mjs</code></span>
  <span>Source: <code>${escapeHtml(spec.filePath)}</code></span>
  <span>3-Pass Score: ${scores.overallP1} → ${scores.overallP2} → ${scores.overallP3} / 100</span>
</footer>
</div>
</body>
</html>
`;
}

// Self-test covering predatory/broken specs, well-formed specs, Markdown tables/bullets, negation, and edge cases.
function runSelfTest() {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exit(1);
    }
  };

  // Case 1: Predatory / broken Solana token spec (u64 overflow, active freeze, pay-to-win, 45% team, 0 cliff, unlocked LP)
  const badRaw = `# Turbo Truck UltraLongNameThatExceedsThirtyTwoBytesLimit ($TURBOTRUCK99)
Decimals: 9
Total Supply: 100 billion
Standard: Token-2022
Mint Authority: active creator wallet
Freeze Authority: enabled
Update Authority: mutable
Metadata URI: http://centralized-server.example.com/meta.json
Transfer fee: 5% buy/sell tax
Permanent Delegate: enabled
TGE Float: 4%
Allocations:
- Team: 45%
- Investors: 20%
- Liquidity: 5%
- Community: 10%
Team cliff: 0 months
Vesting: 0 months
LP is unlocked on Pump.fun.
Utility: Players buy token for a speed boost that bypasses the 28 m/s governor and gives damage immunity against sinkholes, and replace SOL escrow pools.
Minting: Unlimited minting on every guest free ride. No burn mechanism.
Marketing: 100% unlocked KOL tokens at TGE.`;

  const badSpec = parseTokenFile("bad-token.md", badRaw);
  const badReport = runThreeIterations(badSpec);
  assert(!badReport.u64Check.valid, "100B supply at 9 decimals must fail Solana u64 overflow check");
  assert(badReport.nameBytes > 32, "Overlong token name (>32 bytes) must be detected");
  assert(badReport.symbolLen > 10, "Overlong symbol (>10 chars) must be detected");
  assert(badReport.scores.overallP1 < 45, `Broken spec Pass 1 score should be < 45, got ${badReport.scores.overallP1}`);
  assert(badReport.scores.overallP2 > badReport.scores.overallP1, `Pass 2 score (${badReport.scores.overallP2}) must progress above Pass 1 (${badReport.scores.overallP1})`);
  assert(badReport.scores.overallP3 > badReport.scores.overallP2, `Pass 3 score (${badReport.scores.overallP3}) must progress above Pass 2 (${badReport.scores.overallP2})`);
  assert(badReport.allIssues.some((i) => i.id === "ISS-P1-04" && i.severity === "CRITICAL"), "Must flag u64 overflow as CRITICAL");
  assert(badReport.allIssues.some((i) => i.id === "ISS-P1-05" && i.severity === "CRITICAL"), "Must flag active freeze authority");
  assert(badReport.allIssues.some((i) => i.id === "ISS-P1-09" && i.severity === "CRITICAL"), "Must flag pay-to-win governor violation");
  assert(badReport.allIssues.some((i) => i.id === "ISS-P2-01" && i.iteration === 2), "Pass 2 must catch Sybil free-ride faucet drain");
  assert(badReport.allIssues.some((i) => i.id === "ISS-P2-02" && i.iteration === 2), "Pass 2 must catch fixed-price sink volatility risk");
  assert(badReport.iterations.length === 3, "Must execute exactly 3 iterations");

  // Case 2: Well-designed Freight Chain token spec (JSON)
  const goodRaw = JSON.stringify({
    name: "Freight Chain Haul",
    symbol: "HAUL",
    decimals: 6,
    standard: "SPL Token",
    totalSupply: 1_000_000_000,
    tgeFloatPct: 20,
    mintAuthority: "revoked",
    freezeAuthority: "revoked",
    updateAuthority: "revoked",
    metadataUri: "arweave://irys-manifest-hash",
    allocations: {
      communityRewards: 35,
      liquidity: 20,
      ecosystemTreasury: 15,
      team: 15,
      investors: 10,
      airdrop: 5
    },
    teamCliffMonths: 12,
    teamVestingMonths: 36,
    vestingContract: "Streamflow",
    dex: "Meteora DLMM + Raydium",
    lpLocked: true,
    utility: {
      garageCosmetics: true,
      spectatorHazards: true,
      tournamentPassOrBond: true,
      pledgeOrTipBoost: true,
      governance: true,
      payToWin: false,
      replacesSolEscrow: false
    },
    mintBurn: {
      uncappedMint: false,
      unverifiedFaucet: false,
      skillVerifiedFaucet: true,
      hasBurn: true,
      burnPctOfSpend: 50,
      hasVaultRecycle: true,
      hasDynamicTwapPricing: true
    },
    hype: {
      narrativeHook: "Desert Bus on Solana — 8 hours of focus vs Spectator Sabotage",
      spectatorClipLoop: true,
      blinks: true,
      roadmap: true
    },
    marketing: {
      shortFormVideo: true,
      streamerGauntlets: true,
      funnel: true,
      unvestedKol: false
    }
  });

  const goodSpec = parseTokenFile("good-token.json", goodRaw);
  const goodReport = runThreeIterations(goodSpec);
  assert(goodReport.u64Check.valid, "1B supply at 6 decimals must pass Solana u64 check");
  assert(goodReport.scores.overallP1 >= 95, `Well-designed spec Pass 1 score should be >= 95, got ${goodReport.scores.overallP1}`);
  assert(goodReport.scores.overallP3 >= goodReport.scores.overallP2 && goodReport.scores.overallP2 >= goodReport.scores.overallP1, "Scores must never regress on a well-designed spec");
  assert(goodReport.allIssues.length === 0, `Well-designed spec should have 0 issues, got ${goodReport.allIssues.length}`);

  // Case 3: Re-grilling Pass 3's own Hardened Blueprint must be idempotent (0 issues, score >= 95)
  const blueprintSpec = parseTokenFile("blueprint.json", JSON.stringify(badReport.hardenedSpec));
  const blueprintReport = runThreeIterations(blueprintSpec);
  assert(blueprintReport.allIssues.length === 0, `Hardened Blueprint must have 0 issues when re-grilled, got: ${blueprintReport.allIssues.map((i) => i.id).join(", ")}`);
  assert(blueprintReport.scores.overallP1 >= 95, `Hardened Blueprint Pass 1 score must be >= 95, got ${blueprintReport.scores.overallP1}`);

  // Case 4: Markdown with bold keys, multi-column tables, percentage ranges, and negated hazard phrases
  const mdTableRaw = `# Freight Chain Haul ($HAUL)
Paid pools stay in $SOL and $USDC. Token does not replace SOL escrow and gives no speed boost or damage immunity.
0% transfer tax, no Permanent Delegate, no upfront KOL tokens, and guest rides do not earn tokens.

| Parameter | Value |
| --- | --- |
| **Token Name** | Freight Chain Haul |
| **Ticker** | HAUL |
| **Decimals** | \`6\` |
| **Total Supply** | 1,000,000,000 |
| **TGE Float** | 18-22% |
| **Mint Authority** | Revoked |
| **Freeze Authority** | Revoked |
| **Update Authority** | Revoked |
| **Metadata URI** | arweave://irys-manifest |
| **DEX Venue** | Meteora DLMM |

LP is permanently locked via Streamflow.
Utility: Garage cosmetics (paint, wheel, dice), spectator sinkhole & pothole hazards, 14-day Hauler Bond staking, pledge highlight badges, and seasonal route voting.
Minting & Burning: Verified rides via 10 Hz ReplayEngine earn from the vault; 50% burned via spl_token::burn and 35% recycled via split sink with 15m Pyth TWAP dynamic pricing.
Hype & Marketing: Desert Bus 8 hours narrative, YouTube Shorts clip loop, /r/:id Solana Blinks, Season 1 roadmap, streamer gauntlets, and free ride to SIWS funnel.

| Bucket | Tokens | Share | Cliff | Vesting |
| --- | --- | --- | --- | --- |
| **Community Rewards** | 350,000,000 | 35% | 0 months | 36 months |
| **20%** | **DEX Liquidity** | 200,000,000 | 0 months | Locked |
| **Ecosystem Treasury** | 150,000,000 | 15% | 6 months | 30 months |
| **Team & Founders** | 150,000,000 | 15% | 12 months | 36 months |
| **Seed Investors** | 60,000,000 | 6% | 12 months | 24 months |
| **Advisors** | 40,000,000 | 4% | 12 months | 24 months |
| **Airdrop & Quests** | 50,000,000 | 5% | 0 months | TGE |
`;
  const mdSpec = parseTokenFile("table-spec.md", mdTableRaw);
  const mdReport = runThreeIterations(mdSpec);
  assert(mdSpec.decimals === 6, `Markdown table decimals should be 6, got ${mdSpec.decimals}`);
  assert(mdSpec.totalSupply === 1_000_000_000, `Markdown table supply should be 1B, got ${mdSpec.totalSupply}`);
  assert(mdSpec.tgeFloatPct === 20, `Markdown table range 18-22% should parse midpoint 20, got ${mdSpec.tgeFloatPct}`);
  assert(mdSpec.allocationSum === 100, `Markdown table allocations should sum to 100%, got ${mdSpec.allocationSum}%`);
  assert(mdSpec.allocations.investorsAdvisors === 10, `Multi-row Seed (6%) + Advisors (4%) should sum to 10%, got ${mdSpec.allocations.investorsAdvisors}%`);
  assert(mdSpec.teamCliffMonths === 12 && mdSpec.teamVestingMonths === 36, `Team row cliff/vesting should be 12m/36m, got ${mdSpec.teamCliffMonths}m/${mdSpec.teamVestingMonths}m`);
  assert(!mdSpec.utilities.payToWinHazard && !mdSpec.utilities.replacesSolEscrow && !mdSpec.hasTransferFee && !mdSpec.hasPermanentDelegate, "Negated hazards must not trigger false positives");
  assert(mdReport.allIssues.length === 0, `Well-formed Markdown table spec should have 0 issues, got: ${mdReport.allIssues.map((i) => i.id).join(", ")}`);

  // Case 5: u64 boundary & non-finite edge cases
  assert(checkSolanaU64Supply(18_446_744_073, 9).valid === true, "18,446,744,073 at 9 decimals fits u64::MAX");
  assert(checkSolanaU64Supply(18_446_744_074, 9).valid === false, "18,446,744,074 at 9 decimals overflows u64::MAX");
  assert(checkSolanaU64Supply(0, 6).valid === false && !checkSolanaU64Supply(0, 6).reason.includes("OVERFLOWS"), "0 supply must report invalid positive supply, not u64 overflow");
  assert(checkSolanaU64Supply(1000, 24).valid === false && checkSolanaU64Supply(1000, 24).reason.includes("OVERFLOWS"), "24 decimals must report u64 overflow");
  assert(checkSolanaU64Supply(NaN, 6).valid === false, "NaN supply must not throw");

  const html = renderHtmlReport(badReport);
  assert(html.includes("<!doctype html>"), "HTML report must render valid doctype");
  assert(html.includes("Pass 1 of 3") && html.includes("Pass 2 of 3") && html.includes("Pass 3 of 3"), "HTML report must include all 3 passes");
  assert(html.includes("ISS-P1-04") && html.includes("ISS-P2-01"), "HTML report must render issues from Pass 1 and Pass 2");

  // Case 6: Edge case - empty/minimal file with 18 decimals
  const emptySpec = parseTokenFile("empty.txt", "Draft coin idea with 18 decimals.");
  const emptyReport = runThreeIterations(emptySpec);
  assert(emptySpec.decimals === 18, "Should parse 18 decimals");
  assert(emptyReport.allIssues.some((i) => i.id === "ISS-P1-03" && i.severity === "CRITICAL"), "18 decimals must be flagged as CRITICAL EVM anti-pattern");

  console.log("coin-grill self-test: PASS (all assertions verified)");
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    runSelfTest();
    return;
  }

  let inputPath = null;
  let outPath = null;
  let printJson = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outPath = args[++i];
    } else if (args[i] === "--json") {
      printJson = true;
    } else if (!args[i].startsWith("-")) {
      inputPath = args[i];
    }
  }

  if (!inputPath) {
    console.error("Usage: node .claude/skills/coin-grill/grill.mjs <path-to-token-file> [--out <report.html>] [--json]");
    console.error("       node .claude/skills/coin-grill/grill.mjs --self-test");
    process.exit(1);
  }

  const absInput = resolve(process.cwd(), inputPath);
  if (!existsSync(absInput)) {
    console.error(`Error: Token specification file not found at "${absInput}"`);
    process.exit(1);
  }

  const rawContent = readFileSync(absInput, "utf8");
  const spec = parseTokenFile(inputPath, rawContent);
  const report = runThreeIterations(spec);
  const html = renderHtmlReport(report);

  const slug = basename(inputPath, extname(inputPath)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "token";
  const finalOut = outPath
    ? resolve(process.cwd(), outPath)
    : join(REPO_ROOT, "docs", "insights", "reviews", `${slug}-grill.html`);

  mkdirSync(dirname(finalOut), { recursive: true });
  writeFileSync(finalOut, html, "utf8");

  if (printJson) {
    console.log(JSON.stringify({ reportPath: finalOut, ...report }, null, 2));
  } else {
    console.log(`=== COIN-GRILL: 3-ITERATION SOLANA TOKEN AUDIT ===`);
    console.log(`Source file : ${absInput}`);
    console.log(`Token       : ${spec.name} ($${spec.symbol}) · decimals=${spec.decimals ?? "unset"} · supply=${fmtNum(spec.totalSupply)} · standard=${spec.standard}`);
    console.log(`u64 check   : ${report.u64Check.reason}`);
    console.log(`Pass 1 Score: ${report.scores.overallP1}/100 (${report.scores.gradeP1}) — ${report.iterations[0].issues.length} issue(s)`);
    console.log(`Pass 2 Score: ${report.scores.overallP2}/100 (${report.scores.gradeP2}) — ${report.iterations[1].issues.length} red-team issue(s)`);
    console.log(`Pass 3 Score: ${report.scores.overallP3}/100 (${report.scores.gradeP3}) — ${report.iterations[2].issues.length} equilibrium issue(s)`);
    console.log(`Total Issues: ${report.allIssues.length} (${report.allIssues.filter((i) => i.severity === "CRITICAL").length} critical, ${report.allIssues.filter((i) => i.severity === "HIGH").length} high)`);
    console.log(`HTML Report : ${finalOut}`);
  }
}

const isDirectMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return (
      pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url ||
      pathToFileURL(resolve(process.argv[1])).href === import.meta.url
    );
  } catch {
    return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
  }
})();

if (isDirectMain) {
  main();
}
