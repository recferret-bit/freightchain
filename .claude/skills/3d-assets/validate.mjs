#!/usr/bin/env node
// Gate for car / tree / building specs. Counts live in rules.json.
// Exit 0 when the spec is legal or is some other prop. Exit 1 when it is not.
// "generate car with 2 wheels" exits 1.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rules = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rules.json"), "utf8"),
);

const WORD = {
  zero: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const WORD_RE = "zero|none|one|two|three|four|five|six|seven|eight|nine|ten";
const NUM = String.raw`(?:-?\d+\.\d+|-?\.\d+|-?\d+|${WORD_RE}|a|an)`;
const GAP = String.raw`(?:\s+(?:total|of|the|exactly|only|just))*\s+`;
const QUAL = new Set(["big", "small", "large", "old", "new", "little", "tall", "short", "huge", "tiny", "red", "blue", "green", "wooden", "parked", "roadside", "police", "winter", "bare", "leafless", "roofless", "wallless", "wheeled"]);
const TAIL = new Set(["tree", "truck", "car", "vehicle", "building"]);

function normalize(s) {
  let text = String(s).toLowerCase().replace(/["'`]/g, "");
  // Hyphenated words ("police-station", "2-wheeled"). A leading minus stays ("-1").
  text = text.replace(/([a-z0-9])-([a-z0-9])/g, "$1 $2");
  text = text.replace(/\btyres\b/g, "wheels").replace(/\btyre\b/g, "wheel");
  text = text.replace(/\btires\b/g, "wheels").replace(/\btire\b/g, "wheel");
  text = text.replace(/\bstories\b/g, "storeys").replace(/\bstory\b/g, "storey");
  text = text.replace(/\bcanopies\b/g, "canopy");
  return text.replace(/\s+/g, " ").trim();
}

function hasPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(text);
}

function asNumber(raw) {
  if (raw == null) return null;
  if (Object.hasOwn(WORD, raw)) return WORD[raw];
  if (raw === "a" || raw === "an") return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Every stated count, not the first one. Two different numbers, a comparison
// ("fewer than", "not 4"), or a fractional count cannot pass as the legal number.
function readUnit(text, unit) {
  const u = `(?:${unit})`;
  let rest = text;
  const values = [];
  let bad = false;
  let inexact = false;
  const eat = (re, fn) => {
    rest = rest.replace(re, (...args) => {
      fn(...args);
      return " ";
    });
  };
  const push = (raw, scale = 1) => {
    const n = asNumber(raw);
    if (n == null || !Number.isInteger(n)) bad = true;
    else values.push(n * scale);
  };
  eat(new RegExp(String.raw`\b(?:not|fewer than|less than|more than|greater than|under|over)\s+${NUM}${GAP}${u}\b`, "g"), () => { inexact = true; });
  eat(new RegExp(String.raw`\b(?:no|not)\s+${NUM}${GAP}${u}\b`, "g"), () => { inexact = true; });
  eat(new RegExp(String.raw`\b(?:no|zero|none|without)(?:\s+(?:a|an|any))?\s+${u}\b`, "g"), () => values.push(0));
  eat(new RegExp(String.raw`\b(?:a|an)\s+pair\s+of\s+${u}\b`, "g"), () => values.push(2));
  eat(new RegExp(String.raw`(?<![\w.])(${NUM})(?![\w.])\s+sets?\s+of\s+${u}\b`, "g"), (_m, n) => push(n, 2));
  eat(new RegExp(String.raw`\b(?:a\s+)?(?:second|extra|another|additional)\s+${u}\b`, "g"), () => values.push(2));
  eat(new RegExp(String.raw`(?<![\w.])(${NUM})(?![\w.])${GAP}${u}\b`, "g"), (_m, n) => push(n));
  eat(new RegExp(String.raw`\b${u}\s*[:=]\s*(${NUM})\b`, "g"), (_m, n) => push(n));
  eat(new RegExp(String.raw`\b${u}\s+(${NUM})\b`, "g"), (_m, n) => push(n));
  const present = new RegExp(String.raw`\b${u}\b`).test(rest) || (unit.startsWith("wheel") && /\bon wheels\b/.test(rest));
  if (bad) return "bad";
  if (inexact) return "inexact";
  const uniq = [...new Set(values)];
  if (uniq.length > 1) return "contradict";
  if (uniq.length === 1 && present && uniq[0] === 0) return "contradict";
  if (uniq.length === 1) return uniq[0];
  if (present) return "present";
  return null;
}

function flagOf(text, absentRe, presentRe) {
  const absent = absentRe.test(text);
  // Drop the negated phrase first so "no roof" is not also read as "roof".
  const present = presentRe.test(text.replace(absentRe, " "));
  if (absent && present) return "contradict";
  if (absent) return false;
  if (present) return true;
  return null;
}

function isModifierToken(token) {
  return QUAL.has(token) || Object.hasOwn(WORD, token) || /^\d+(?:\.\d+)?$/.test(token) || token === "wheel" || token === "wheels";
}

function stripModifiers(head) {
  const prefix = [
    new RegExp(String.raw`^(?:${WORD_RE}|\d+(?:\.\d+)?)\s+wheeled\s+`),
    new RegExp(String.raw`^(?:${WORD_RE}|\d+(?:\.\d+)?)\s+wheels?\s+`),
    /^wheeled\s+/,
    /^leafless\s+/,
    /^roofless\s+/,
    /^wall less\s+/,
    /^wallless\s+/,
    new RegExp(String.raw`^(?:${WORD_RE}|\d+(?:\.\d+)?)\s+storeys?\s+`),
  ];
  const suffix = [
    new RegExp(String.raw`\s+(?:${WORD_RE}|\d+(?:\.\d+)?)\s+wheeled$`),
    /\s+wheeled$/,
    /\s+leafless$/,
    /\s+roofless$/,
  ];
  let h = head;
  const removed = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of [...prefix, ...suffix]) {
      const found = h.match(re);
      if (found) {
        removed.push(found[0].trim());
        h = h.replace(re, "");
        changed = true;
      }
    }
  }
  return { head: h.trim(), removed: removed.join(" ") };
}

function aliasIndex() {
  const rows = [];
  for (const sub of rules.car.subtypes) {
    for (const alias of sub.aliases) rows.push({ family: "car", alias, sub });
  }
  for (const style of rules.tree.styles) {
    for (const alias of style.aliases) rows.push({ family: "tree", alias, style });
  }
  for (const alias of rules.building.aliases) rows.push({ family: "building", alias });
  for (const alias of rules.other.aliases) rows.push({ family: "other", alias });
  rows.sort((a, b) => b.alias.length - a.alias.length);
  return rows;
}

const ALIASES = aliasIndex();

function familiesIn(head) {
  const found = new Set();
  for (const row of ALIASES) {
    if (hasPhrase(head, row.alias)) found.add(row.family);
  }
  return [...found];
}

function knownHead(head) {
  return rules.car.ambiguous.includes(head) || ALIASES.some((row) => row.alias === head);
}

function singularize(head) {
  if (knownHead(head)) return head;
  if (head.endsWith("es") && knownHead(head.slice(0, -2))) return head.slice(0, -2);
  if (head.endsWith("s") && knownHead(head.slice(0, -1))) return head.slice(0, -1);
  return head;
}

function leftoverOk(tokens) {
  return tokens.every((token) => isModifierToken(token) || TAIL.has(token));
}

function matchRow(head) {
  const h = singularize(head);
  for (const row of ALIASES) if (h === row.alias) return row;
  for (const row of ALIASES) {
    if (!h.startsWith(`${row.alias} `)) continue;
    const rest = h.slice(row.alias.length).trim().split(/\s+/);
    if (leftoverOk(rest)) return row;
  }
  for (const row of ALIASES) {
    if (!hasPhrase(h, row.alias)) continue;
    const rest = h.replace(new RegExp(`(?:^|\\s)${row.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?:\\s|$)`), " ").trim();
    if (!rest || leftoverOk(rest.split(/\s+/))) return row;
  }
  return null;
}

function emptySpec() {
  return {
    phrase: "",
    head: "",
    forbidText: "",
    kind: "unknown",
    label: "",
    subtype: null,
    style: null,
    wheels: null,
    axles: null,
    trunks: null,
    canopy: null,
    roof: null,
    walls: null,
    storeys: null,
    hl: null,
    hd: null,
    ambiguous: false,
    skipped: false,
    errors: [],
  };
}

export function specFromPhrase(phrase) {
  const spec = emptySpec();
  const text = normalize(phrase);
  spec.phrase = text;
  let body = text.replace(/^(?:please\s+)?(?:generate|make|create|add|review|build|model)\s+/, "");
  body = body.replace(/^(?:a|an|the)\s+/, "");
  let attrs = "";
  const rel = body.match(/\s+(with(?:out)?)\s+/);
  if (rel) {
    const rest = body.slice(rel.index + rel[0].length);
    attrs = rel[1] === "without" ? `without ${rest}` : rest;
    body = body.slice(0, rel.index);
  }
  const onWheels = body.match(/^(.*)\s+on wheels$/);
  if (onWheels) {
    attrs = `${attrs} on wheels`.trim();
    body = onWheels[1];
  }
  const stripped = stripModifiers(body);
  spec.forbidText = `${stripped.removed} ${attrs}`.trim();
  spec.head = stripped.head;
  spec.wheels = readUnit(text, "wheels?|wheeled");
  spec.axles = readUnit(text, "axles?");
  spec.trunks = readUnit(text, "trunks?");
  if (spec.trunks == null && /\btrunkless\b/.test(text)) spec.trunks = 0;
  spec.canopy = flagOf(
    text,
    /\bno (?:leaf |leafy )?canopy\b|\bwithout (?:a )?(?:leaf |leafy )?canopy\b|\bno leaves\b|\bwithout (?:any )?leaves\b|\bleafless\b|\bcanopyless\b|\bno foliage\b|\bwithout (?:any )?foliage\b/,
    /\bleafy canopy\b|\bleaf canopy\b|\bwith (?:a )?canopy\b|\bwith leaves\b|\bwith foliage\b|\bcanopy\b|\bfoliage\b|\bleaves\b/,
  );
  spec.roof = flagOf(text, /\bno roof\b|\bwithout (?:a )?roof\b|\broofless\b/, /\bwith (?:a )?roof\b|\broof\b/);
  spec.walls = flagOf(text, /\bno walls?\b|\bwithout (?:a )?walls?\b|\bwall less\b|\bwallless\b/, /\bwith walls?\b/);
  spec.storeys = readUnit(text, "storeys?");

  if (rules.car.ambiguous.includes(spec.head)) {
    spec.kind = "car";
    spec.ambiguous = true;
    spec.label = spec.head;
    return spec;
  }
  const families = familiesIn(spec.head);
  if (families.length > 1) {
    spec.kind = "mixed";
    spec.errors.push(`mixed kinds ${families.join(" and ")}; name one object`);
    return spec;
  }
  const row = matchRow(spec.head);
  if (!row) {
    spec.kind = "unknown";
    spec.errors.push(`unknown kind "${spec.head || text}"; expected a car, tree, or building`);
    return spec;
  }
  spec.kind = row.family;
  spec.label = row.alias;
  if (row.family === "car") spec.subtype = row.sub.id;
  if (row.family === "tree") spec.style = row.style.id;
  if (row.family === "other") spec.skipped = true;
  return spec;
}

function applyFlags(spec, flags) {
  if (flags.kind) {
    const fromKind = specFromPhrase(flags.kind);
    spec.kind = fromKind.kind;
    spec.label = fromKind.label || flags.kind;
    spec.subtype = fromKind.subtype;
    spec.style = fromKind.style;
    spec.ambiguous = fromKind.ambiguous;
    spec.skipped = fromKind.skipped;
    spec.head = fromKind.head;
    spec.errors = [...fromKind.errors];
  }
  const num = (name) => {
    if (flags[name] === undefined) return;
    spec[name] = Number(flags[name]);
  };
  num("wheels");
  num("axles");
  num("trunks");
  num("storeys");
  num("hl");
  num("hd");
  for (const name of ["canopy", "roof", "walls"]) {
    if (flags[name] === undefined) continue;
    spec[name] = flags[name] === "true" || flags[name] === "1";
  }
  return spec;
}

function affirmed(text, term) {
  const re = new RegExp(`\\b${term}\\b`, "g");
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 16), m.index);
    if (!/\b(?:no|without)(?:\s+(?:a|an))?\s+$/.test(before)) return true;
  }
  return false;
}

function forbid(spec, list, errors) {
  for (const term of list) {
    if (affirmed(spec.forbidText, term)) errors.push(`${spec.label} cannot have ${term}`);
  }
}

function applyCount(spec, field, noun, need, errors, banZero) {
  const v = spec[field];
  const name = spec.label || spec.kind;
  if (v === "contradict") errors.push(`${name} ${noun} spec contradicts itself`);
  else if (v === "inexact") errors.push(`${name} ${noun} count must be exact`);
  else if (v === "bad" || (typeof v === "number" && !Number.isInteger(v))) errors.push(`${name} ${noun} count must be a whole number`);
  else if (v === "present" && banZero) errors.push(`a ${spec.kind} cannot have ${noun}`);
  else if (typeof v === "number" && v !== need) {
    if (banZero) errors.push(`a ${spec.kind} cannot have ${noun}; got ${v}`);
    else errors.push(`${name} ${noun} must be ${need}; got ${v}`);
  }
}

function checkCar(spec, errors) {
  const sub = rules.car.subtypes.find((s) => s.id === spec.subtype);
  if (!sub) {
    errors.push(`unknown vehicle "${spec.label}"`);
    return;
  }
  applyCount(spec, "wheels", "wheels", sub.wheels, errors, false);
  applyCount(spec, "axles", "axles", sub.axles, errors, false);
  if (typeof spec.wheels === "number" && typeof spec.axles === "number" && spec.wheels !== spec.axles * 2) {
    errors.push(`wheels must be 2 per axle; got ${spec.wheels} wheels and ${spec.axles} axles`);
  }
  forbid(spec, rules.car.forbid, errors);
  spec.expect = { wheels: sub.wheels, axles: sub.axles };
}

function checkTree(spec, errors) {
  const style = rules.tree.styles.find((s) => s.id === spec.style);
  if (!style) {
    errors.push(`unknown tree "${spec.label}"`);
    return;
  }
  applyCount(spec, "trunks", "trunks", rules.tree.trunks, errors, false);
  applyCount(spec, "wheels", "wheels", rules.tree.wheels, errors, false);
  if (spec.wheels === "present") errors.push("a tree cannot have wheels");
  if (spec.canopy === "contradict") errors.push(`${spec.label} canopy spec contradicts itself`);
  if (spec.canopy === false && style.canopy === "required") errors.push(`${spec.label} requires a canopy`);
  if (spec.canopy === true && style.canopy === "forbidden") errors.push(`${spec.label} has no leaf canopy`);
  forbid(spec, rules.tree.forbid, errors);
  spec.expect = { trunks: rules.tree.trunks, wheels: rules.tree.wheels, canopy: style.canopy };
}

function optional(list, label) {
  return list.includes(label);
}

function checkBuilding(spec, errors) {
  applyCount(spec, "wheels", "wheels", rules.building.wheels, errors, true);
  if (spec.roof === "contradict") errors.push(`${spec.label} roof spec contradicts itself`);
  else if (spec.roof === false && !optional(rules.building.roofOptional, spec.label)) errors.push(`${spec.label} requires a roof`);
  if (spec.walls === "contradict") errors.push(`${spec.label} walls spec contradicts itself`);
  else if (spec.walls === false && !optional(rules.building.wallsOptional, spec.label)) errors.push(`${spec.label} requires walls`);
  if (spec.storeys === "contradict") errors.push(`${spec.label} storeys spec contradicts itself`);
  else if (spec.storeys === "inexact") errors.push(`${spec.label} storeys count must be exact`);
  else if (spec.storeys === "bad" || (typeof spec.storeys === "number" && !Number.isInteger(spec.storeys))) errors.push(`${spec.label} storeys count must be a whole number`);
  else if (typeof spec.storeys === "number" && spec.storeys < rules.building.minStoreys) {
    errors.push(`${spec.label} storeys must be >= ${rules.building.minStoreys}; got ${spec.storeys}`);
  }
  if (spec.hl != null && spec.hl <= 0) errors.push("building footprint hl must be > 0");
  if (spec.hd != null && spec.hd <= 0) errors.push("building footprint hd must be > 0");
  forbid(spec, rules.building.forbid, errors);
  spec.expect = {
    wheels: rules.building.wheels,
    roof: optional(rules.building.roofOptional, spec.label) ? "optional" : "required",
    walls: optional(rules.building.wallsOptional, spec.label) ? "optional" : "required",
    minStoreys: rules.building.minStoreys,
  };
}

export function judge(spec) {
  const errors = [...spec.errors];
  if (spec.kind === "mixed") return done(spec, errors);
  if (spec.ambiguous) {
    errors.push("vehicle is ambiguous; name a car, truck, bus, or freighter");
    return done(spec, errors);
  }
  if (spec.skipped) {
    return { ok: true, skipped: true, phrase: spec.phrase, kind: "other", label: spec.label };
  }
  if (spec.kind === "unknown") return done(spec, errors);
  if (spec.kind === "car") checkCar(spec, errors);
  else if (spec.kind === "tree") checkTree(spec, errors);
  else if (spec.kind === "building") checkBuilding(spec, errors);
  else errors.push(`unknown kind "${spec.head}"`);
  return done(spec, errors);
}

function done(spec, errors) {
  const result = {
    ok: errors.length === 0,
    phrase: spec.phrase,
    kind: spec.kind,
  };
  if (spec.subtype) result.subtype = spec.subtype;
  if (spec.style) result.style = spec.style;
  if (spec.label) result.label = spec.label;
  if (spec.expect && result.ok) result.expect = spec.expect;
  if (errors.length) result.errors = errors;
  return result;
}

export function evaluate(phrase, flags = {}) {
  const spec = phrase ? specFromPhrase(phrase) : emptySpec();
  return judge(applyFlags(spec, flags));
}

const CASES = [
  ["generate car with 2 wheels", false, /wheels must be 4; got 2/],
  ["generate car with two wheels", false, /wheels must be 4; got 2/],
  ["Generate Car With 2 Wheels", false, /wheels must be 4/],
  ['"generate car with 2 wheels"', false, /got 2/],
  ["a 2-wheeled car", false, /car wheels must be 4/],
  ["generate truck with 2 wheels", false, /truck wheels must be 4/],
  ["generate freighter with 4 wheels", false, /freighter wheels must be 6/],
  ["generate car with 3 wheels", false, /got 3/],
  ["generate vehicle", false, /ambiguous/],
  ["generate vehicle with 4 wheels", false, /ambiguous/],
  ["generate car with a trunk and canopy", false, /cannot have trunk/],
  ["generate bus with 6 wheels", false, /bus wheels must be 4/],
  ["generate fire truck with 5 wheels", false, /got 5/],
  ["generate sedan with 3 axles", false, /axles must be 2/],
  ["generate semi with 2 axles", false, /axles must be 3/],
  ["generate ambulance with 1 wheel", false, /got 1/],
  ["generate car with 2 axles and 2 wheels", false, /wheels must be 4/],
  ["generate tree with 2 wheels", false, /wheels must be 0/],
  ["generate spruce with no canopy", false, /requires a canopy/],
  ["generate pine with no canopy", false, /requires a canopy/],
  ["generate tree with no trunk", false, /trunks must be 1; got 0/],
  ["generate oak with 2 trunks", false, /trunks must be 1; got 2/],
  ["generate birch with a leafy canopy", false, /has no leaf canopy/],
  ["generate tree with a roof", false, /cannot have roof/],
  ["generate gum tree with a door", false, /cannot have door/],
  ["generate broadleaf with axles", false, /cannot have axles/],
  ["generate tree with storeys", false, /cannot have storeys/],
  ["generate spruce wheeled", false, /cannot have wheels/],
  ["generate birch with wheels", false, /cannot have wheels/],
  ["generate building with 2 wheels", false, /cannot have wheels; got 2/],
  ["generate motel with no roof", false, /requires a roof/],
  ["generate house with no walls", false, /requires walls/],
  ["generate hotel with 0 storeys", false, /storeys must be >= 1/],
  ["generate building with a trunk and canopy", false, /cannot have trunk/],
  ["generate diner on wheels", false, /cannot have wheels/],
  ["a wheeled gas station", false, /cannot have wheels/],
  ["generate landmark with 4 wheels", false, /got 4/],
  ["generate police station with 4 wheels", false, /cannot have wheels/],
  ["generate car", true],
  ["generate car with 4 wheels", true],
  ["generate sedan with 2 axles", true],
  ["generate fire truck", true],
  ["generate freighter with 6 wheels", true],
  ["generate bus with 4 wheels", true],
  ["generate police car", true],
  ["generate truck with 2 axles", true],
  ["generate semi with 3 axles", true],
  ["generate ambulance with 4 wheels", true],
  ["generate car with 2 axles and 4 wheels", true],
  ["generate tree", true],
  ["generate spruce", true],
  ["generate birch", true],
  ["generate birch with no leaves", true],
  ["generate leafless birch", true],
  ["generate gum tree", true],
  ["generate broadleaf tree", true],
  ["generate spruce with 0 wheels", true],
  ["generate building", true],
  ["generate motel", true],
  ["generate a police station with two cruisers", true],
  ["generate gas station", true],
  ["generate diner", true],
  ["generate hotel with a roof", true],
  ["generate motel with a parked car", true],
  ["generate an oak with a parked car", true],
  ["generate a 4-storey garage with a fire truck", true],
  ["generate speed trap with no roof", true],
  ["generate speed trap with 2 wheels", false, /cannot have wheels/],
  ["generate cactus", true],
  ["generate bush", true],
  ["generate rock", true],
  ["generate spaceship", false, /unknown kind/],
  ["generate car with 2 tyres", false, /wheels must be 4; got 2/],
  ["generate car with two tires", false, /got 2/],
  ["generate sedan with a pair of wheels", false, /got 2/],
  ["generate car with 3 total wheels", false, /got 3/],
  ["generate car with wheels: 2", false, /got 2/],
  ["generate car with 4 wheels or 2 wheels", false, /contradicts itself/],
  ["generate 2-wheeled car with 4 wheels", false, /contradicts itself/],
  ["generate four wheel car", true],
  ["generate car without wheels", false, /got 0/],
  ["generate car without a trunk", true],
  ["generate semi truck with 4 wheels", false, /wheels must be 6/],
  ["generate a big car with 4 wheels", true],
  ["generate cars with 2 wheels", false, /got 2/],
  ["generate car with fewer than 4 wheels", false, /must be exact/],
  ["generate freighter with 5 total wheels", false, /got 5/],
  ["generate semi with two sets of wheels", false, /got 4/],
  ["generate birch with a leaf canopy", false, /has no leaf canopy/],
  ["generate birch with no foliage", true],
  ["generate spruce with no foliage", false, /requires a canopy/],
  ["generate spruce with no leaf canopy", false, /requires a canopy/],
  ["generate birch without leaves", true],
  ["generate tree without a roof", true],
  ["generate pine without a canopy", false, /requires a canopy/],
  ["generate birch tree", true, /"style":"birch"/],
  ["generate oak tree", true, /"style":"broadleaf"/],
  ["generate oak with a second trunk", false, /trunks must be 1; got 2/],
  ["generate gum tree without a door", true],
  ["generate building with no roof and a roof", false, /contradicts itself/],
  ["generate building with no wheels and 2 wheels", false, /contradicts itself/],
  ["generate 4-wheeled motel with no wheels", false, /contradicts itself/],
  ["generate diner on wheels with no wheels", false, /contradicts itself/],
  ["generate building with 2.0 wheels", false, /got 2/],
  ["generate hotel with -1 storeys", false, /got -1/],
  ["generate hotel with 0.5 storeys", false, /whole number/],
  ["generate hotel with 1.0 storeys", true],
  ["generate hotel with 0 stories", false, /storeys must be >= 1/],
  ["generate hotel with less than 1 storey", false, /must be exact/],
  ["generate police-station", true],
  ["generate police-speedtrap with no roof", true],
  ["generate police speed trap with no roof", true],
  ["generate house with no walls and with walls", false, /contradicts itself/],
];

function rulesHold() {
  const problems = [];
  for (const sub of rules.car.subtypes) {
    if (sub.wheels !== sub.axles * 2) problems.push(`${sub.id} wheels are not 2 per axle`);
    if (sub.wheels < 4) problems.push(`${sub.id} has fewer than 4 wheels`);
  }
  if (rules.tree.trunks !== 1) problems.push("a tree must have 1 trunk");
  if (rules.tree.wheels !== 0) problems.push("a tree must have 0 wheels");
  const birch = rules.tree.styles.find((s) => s.id === "birch");
  if (!birch || birch.canopy !== "forbidden") problems.push("birch canopy must be forbidden");
  if (rules.building.wheels !== 0) problems.push("a building must have 0 wheels");
  return problems;
}

export function selfTest() {
  const failures = rulesHold().map((p) => ({ phrase: "(rules.json)", detail: p }));
  for (const [phrase, ok, pattern] of CASES) {
    const result = evaluate(phrase);
    const blob = JSON.stringify(result);
    if (result.ok !== ok) failures.push({ phrase, detail: blob });
    else if (pattern && !pattern.test(blob)) failures.push({ phrase, detail: `pattern ${pattern} not in ${blob}` });
  }
  const flagged = [
    [evaluate("", { kind: "car", wheels: "2" }), false],
    [evaluate("", { kind: "car", wheels: "4" }), true],
    [evaluate("", { kind: "tree", wheels: "2" }), false],
    [evaluate("", { kind: "building", wheels: "2" }), false],
    [evaluate("", { kind: "freighter", wheels: "4" }), false],
    [evaluate("", { kind: "building", hl: "0" }), false],
  ];
  for (const [result, ok] of flagged) {
    if (result.ok !== ok) failures.push({ phrase: JSON.stringify(result.phrase || result.label), detail: JSON.stringify(result) });
  }
  const station = evaluate("generate a police station with two cruisers");
  if (station.kind !== "building" || !station.ok) failures.push({ phrase: "police station kind", detail: JSON.stringify(station) });
  const treeWheels = evaluate("generate tree with 2 wheels");
  if (treeWheels.kind !== "tree") failures.push({ phrase: "tree kind", detail: JSON.stringify(treeWheels) });
  const car = evaluate("generate car with 4 wheels");
  if (!car.ok || car.expect?.wheels !== 4) failures.push({ phrase: "expect wheels", detail: JSON.stringify(car) });
  return failures;
}

function parseArgs(argv) {
  const out = { phrase: [], flags: {}, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") out.selfTest = true;
    else if (a === "--json") out.json = argv[++i];
    else if (a.startsWith("--")) out.flags[a.slice(2)] = argv[++i];
    else out.phrase.push(a);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    const failures = selfTest();
    if (failures.length) {
      console.log(JSON.stringify({ ok: false, failures }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, selfTest: CASES.length }));
    return;
  }
  if (args.json) {
    const body = JSON.parse(args.json);
    const phrase = body.phrase || body.text || "";
    const flags = { ...body };
    delete flags.phrase;
    delete flags.text;
    const result = evaluate(phrase, flags);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }
  if (!args.phrase.length && !args.flags.kind) {
    console.error("usage: validate.mjs \"generate car with 2 wheels\" | --kind car --wheels 2 | --self-test");
    process.exit(2);
  }
  const result = evaluate(args.phrase.join(" "), args.flags);
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
