#!/usr/bin/env node
/**
 * Build script for SwORD compendium packs.
 *
 * Reads equipment data from module/data/equipment.mjs and creature data from
 * module/data/bestiary.mjs, writes individual JSON source files, then compiles
 * them into LevelDB compendium packs using the Foundry VTT CLI.
 *
 * Usage: node sword/scripts/build-packs.mjs
 */

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// Data comes from the published engine package (single source of truth) rather
// than local copies. The engine carries English descriptions (copyright cleanup).
import { WEAPONS, SHIELDS, ARMOR, GEAR, CREATURES } from "@federicomorando/sword-engine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SWORD_ROOT = resolve(__dirname, "..");

// Equipment paths
const EQUIP_SRC_DIR = resolve(SWORD_ROOT, "src/packs/equipment");
const EQUIP_OUT_DIR = resolve(SWORD_ROOT, "packs/equipment");

// Bestiary paths
const BESTIARY_SRC_DIR = resolve(SWORD_ROOT, "src/packs/bestiary");
const BESTIARY_OUT_DIR = resolve(SWORD_ROOT, "packs/bestiary");

// ─── Deterministic ID generation ─────────────────────────────────────────────
// Foundry uses 16-char alphanumeric IDs (A-Za-z0-9).
// We hash the key and encode in base62 to produce stable, valid IDs.

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function makeId(key) {
  const hash = createHash("sha256").update(key).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += BASE62[hash[i] % 62];
  }
  return id;
}

// ─── Icon mapping ────────────────────────────────────────────────────────────

// Fallback icons per item type (used if no per-item icon is defined)
const ITEM_ICONS = {
  weapon: "icons/svg/sword.svg",
  shield: "icons/svg/shield.svg",
  armor: "icons/svg/statue.svg",
  gear: "icons/svg/barrel.svg"
};

// Per-item icons — maps weaponId/shieldId/armorId/gearId to a specific Foundry icon
const WEAPON_ICONS = {
  // ── Archi (Bows) ──
  arco_corto:           "icons/weapons/bows/shortbow-recurve-yellow.webp",
  arco_lungo:           "icons/weapons/bows/longbow-recurve-leather-brown.webp",
  // ── Balestre (Crossbows) ──
  balestra_leggera:     "icons/weapons/crossbows/crossbow-simple-brown.webp",
  balestra_a_staffa:    "icons/weapons/crossbows/crossbow-simple-black.webp",
  balestra_a_verricello:"icons/weapons/crossbows/crossbow-heavy-black.webp",
  // ── Armi corte (Short weapons) ──
  accetta:              "icons/weapons/axes/shortaxe-simple-black.webp",
  bastoncello:          "icons/weapons/clubs/club-baton-brown.webp",
  coltellaccio:         "icons/weapons/daggers/knife-engraved-black.webp",
  coltello:             "icons/weapons/daggers/dagger-simple-black.webp",
  // ── Armi comuni (Common weapons) ──
  bordone:              "icons/weapons/staves/staff-simple-brown.webp",
  falce_da_guerra:      "icons/weapons/polearms/glaive-simple.webp",
  lancia_da_fante:      "icons/weapons/polearms/spear-simple-engraved.webp",
  martello:             "icons/weapons/hammers/hammer-simple-iron.webp",
  randello:             "icons/weapons/clubs/club-simple-stone-brown.webp",
  roncone:              "icons/weapons/polearms/halberd-crescent-worn-steel.webp",
  scure:                "icons/weapons/axes/axe-battle-simple.webp",
  spiedo:               "icons/weapons/polearms/spear-simple-barbed.webp",
  // ── Armi da guerra (War weapons) ──
  ascia_normanna:       "icons/weapons/axes/axe-battle.webp",
  lancia_da_cavaliere:  "icons/weapons/polearms/spear-ornate-gold.webp",
  mannaia_inastata:     "icons/weapons/polearms/halberd-engraved-steel.webp",
  mazza_ferrata:        "icons/weapons/maces/mace-round-spiked-black.webp",
  picca:                "icons/weapons/polearms/pike-flared-brown.webp",
  pugnale:              "icons/weapons/daggers/dagger-curved-guard.webp",
  spada_da_guerra:      "icons/weapons/swords/sword-guard-blue.webp",
  spada_d_arme:         "icons/weapons/swords/greatsword-crossguard-steel.webp",
};

const SHIELD_ICONS = {
  brocchiere:           "icons/equipment/shield/buckler-wooden-boss-steel.webp",
  scudo:                "icons/equipment/shield/heater-steel-grey.webp",
  scudo_grande:         "icons/equipment/shield/kite-wooden-boss-steel-brown.webp",
};

const ARMOR_ICONS = {
  abiti_imbottiti:      "icons/equipment/chest/breastplate-quilted-brown.webp",
  armatura_da_fanteria: "icons/equipment/chest/breastplate-banded-steel.webp",
  armatura_da_cavalleria:"icons/equipment/chest/breastplate-layered-steel.webp",
};

const GEAR_ICONS = {
  // ── Skill tools ──
  attrezzi_alchimia:    "icons/tools/cooking/mortar-herbs-yellow.webp",
  attrezzi_artigiano:   "icons/tools/hand/hammer-and-nail.webp",
  attrezzi_guarigione:  "icons/tools/hand/saw-surgical-steel-grey.webp",
  attrezzi_manualita:   "icons/tools/hand/lockpicks-steel-grey.webp",
  strumento_musicale:   "icons/tools/instruments/lute-gold-brown.webp",
  materiale_scrittura:  "icons/tools/scribal/ink-quill-red.webp",
  // ── Travel ──
  corda_10m:            "icons/sundries/survival/rope-coiled-brown.webp",
  torcia:               "icons/sundries/lights/torch-brown-lit.webp",
  lanterna:             "icons/sundries/lights/lantern-iron-lit-yellow.webp",
  olio_lanterna:        "icons/consumables/potions/bottle-round-corked-yellow.webp",
  sacco_a_pelo:         "icons/sundries/survival/bedroll-tan.webp",
  tenda:                "icons/environment/settlement/tent.webp",
  acciarino:            "icons/sundries/lights/candle-lit-yellow.webp",
  razioni_1giorno:      "icons/consumables/grains/bread-loaf-boule-tan.webp",
  otre_acqua:           "icons/sundries/survival/waterskin-leather-brown.webp",
  // ── Containers ──
  bisaccia:             "icons/containers/bags/satchel-leather-brown.webp",
  zaino:                "icons/containers/bags/pack-leather-brown.webp",
  baule:                "icons/containers/chest/chest-elm-steel-brown.webp",
  // ── Clothing ──
  abiti_umili:          "icons/equipment/chest/vest-cloth-tattered-tan.webp",
  abiti_popolano:       "icons/equipment/chest/shirt-collared-brown.webp",
  abiti_borghese:       "icons/equipment/chest/coat-collared-red.webp",
  abiti_nobile:         "icons/equipment/chest/coat-collared-red-gold.webp",
  // ── Alchemical ──
  antidoto_generico:    "icons/consumables/potions/potion-bottle-corked-white.webp",
  fuoco_greco:          "icons/consumables/potions/bottle-round-corked-orange.webp",
  unguento_curativo:    "icons/consumables/potions/potion-jar-corked-green.webp",
  veleno_da_contatto:   "icons/consumables/potions/bottle-conical-corked-labeled-skull-poison-green.webp",
  veleno_da_ingestione: "icons/consumables/potions/potion-bottle-skull-label-poison-teal.webp",
  // ── Ammunition ──
  frecce_12:            "icons/containers/ammunition/arrows-quiver-brown.webp",
  dardi_12:             "icons/containers/ammunition/arrows-quiver-black.webp",
};

const CREATURE_ICON = "icons/svg/mystery-man.svg";

// ─── Wrap raw item data with Foundry document boilerplate ────────────────────

function wrapItem(id, name, type, systemData, icon) {
  return {
    _id: id,
    _key: `!items!${id}`,
    name,
    type,
    img: icon || ITEM_ICONS[type],
    system: systemData,
    effects: [],
    flags: {},
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    _stats: {
      duplicateSource: null,
      coreVersion: "13.351",
      systemId: "sword",
      systemVersion: "2.1.0",
      createdTime: null,
      modifiedTime: null,
      lastModifiedBy: null
    }
  };
}

// ─── Wrap raw actor data with Foundry document boilerplate ───────────────────

function wrapActor(id, name, type, systemData) {
  return {
    _id: id,
    _key: `!actors!${id}`,
    name,
    type,
    img: CREATURE_ICON,
    system: systemData,
    items: [],
    effects: [],
    flags: {},
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    prototypeToken: {
      name,
      displayName: 20,
      actorLink: false,
      disposition: -1,
      width: 1,
      height: 1
    },
    _stats: {
      duplicateSource: null,
      coreVersion: "13.351",
      systemId: "sword",
      systemVersion: "2.1.0",
      createdTime: null,
      modifiedTime: null,
      lastModifiedBy: null
    }
  };
}

// ─── Build weapon item ───────────────────────────────────────────────────────

function buildWeapon(w) {
  const id = makeId(`weapon_${w.weaponId}`);
  const icon = WEAPON_ICONS[w.weaponId];
  return wrapItem(id, w.label, "weapon", {
    category: w.category,
    skillId: w.skillId,
    weaponType: w.weaponType || null,
    hands: w.hands,
    costDenari: w.costDenari,
    costDisplay: w.costDisplay,
    weight: w.weight,
    damageValue: w.damageValue,
    damageType: w.damageType,
    parryModifier: w.parryModifier,
    misura: w.misura,
    pregi: w.pregi,
    quality: "normale",
    gittata: w.gittata,
    ricarica: w.ricarica
  }, icon);
}

// ─── Build shield item ───────────────────────────────────────────────────────

function buildShield(s) {
  const id = makeId(`shield_${s.shieldId}`);
  const icon = SHIELD_ICONS[s.shieldId];
  return wrapItem(id, s.label, "shield", {
    costDenari: s.costDenari,
    costDisplay: s.costDisplay,
    weight: s.weight,
    damageValue: s.damageValue,
    parryModifier: s.parryModifier,
    pregi: s.pregi,
    quality: "normale"
  }, icon);
}

// ─── Build armor item ────────────────────────────────────────────────────────

function buildArmor(a) {
  const id = makeId(`armor_${a.armorId}`);
  const icon = ARMOR_ICONS[a.armorId];
  return wrapItem(id, a.label, "armor", {
    costDenari: a.costDenari,
    costDisplay: a.costDisplay,
    weight: a.weight,
    protezione: a.protezione,
    robustezza: a.robustezza,
    robustezzaCurrent: a.robustezza,
    pregi: a.pregi,
    quality: "normale"
  }, icon);
}

// ─── Build gear item ─────────────────────────────────────────────────────────

function buildGear(g) {
  const id = makeId(`gear_${g.gearId}`);
  const icon = GEAR_ICONS[g.gearId];
  return wrapItem(id, g.label, "gear", {
    gearCategory: g.gearCategory,
    costDenari: g.costDenari,
    costDisplay: g.costDisplay,
    weight: g.weight,
    quantity: 1,
    quality: "normale",
    skillBonusSkillId: g.skillBonusSkillId,
    description: g.description
  }, icon);
}

// ─── Build creature actor ────────────────────────────────────────────────────

function buildCreature(c) {
  const id = makeId(`creature_${c.id}`);

  // Map ferite array to wound capacities object
  // piccola: 4 levels [graffi, gravi, critiche, mortali] (no leggere)
  // others: 5 levels [graffi, leggere, gravi, critiche, mortali]
  let woundCapacities;
  if (c.sizeCategory === "piccola") {
    woundCapacities = {
      graffi: c.ferite[0] || 0,
      leggere: 0,
      gravi: c.ferite[1] || 0,
      critiche: c.ferite[2] || 0,
      mortali: c.ferite[3] || 0
    };
  } else {
    woundCapacities = {
      graffi: c.ferite[0] || 0,
      leggere: c.ferite[1] || 0,
      gravi: c.ferite[2] || 0,
      critiche: c.ferite[3] || 0,
      mortali: c.ferite[4] || 0
    };
  }

  // Fatica: 3-element array [fresco, stanco, sfinito] = the three fatigue-band sizes.
  // The total capacity is their sum; the band boundaries are derived at runtime by
  // computeFatigueLevel (floor(max*2/3), floor(max/3)), matching the character model.
  // The per-band values are also stored under fatigueThresholds for reference.
  const faticaMax = (c.fatica[0] || 0) + (c.fatica[1] || 0) + (c.fatica[2] || 0);

  // Build all abilities with defaults of 0
  const abilities = {
    agilita: c.abilities.agilita || 0,
    forza: c.abilities.forza || 0,
    percezione: c.abilities.percezione || 0,
    volonta: c.abilities.volonta || 0,
    ragionamento: c.abilities.ragionamento || 0,
    carisma: c.abilities.carisma || 0
  };

  // Build all skills with defaults of 0
  const skills = {
    lotta: c.skills.lotta || 0,
    furtivita: c.skills.furtivita || 0,
    armi_comuni: c.skills.armi_comuni || 0,
    armi_da_guerra: c.skills.armi_da_guerra || 0,
    armi_corte: c.skills.armi_corte || 0,
    archi: c.skills.archi || 0,
    autorita: c.skills.autorita || 0,
    empatia: c.skills.empatia || 0,
    raggirare: c.skills.raggirare || 0,
    sopravvivenza: c.skills.sopravvivenza || 0
  };

  // Build movement with defaults of 0
  const movement = {
    walk: c.movement.walk || 0,
    trot: c.movement.trot || 0,
    gallop: c.movement.gallop || 0,
    fly: c.movement.fly || 0,
    swim: c.movement.swim || 0
  };

  return wrapActor(id, c.name, "creature", {
    rango: c.rango,
    creatureType: c.type,
    sizeCategory: c.sizeCategory,
    isTemplate: c.isTemplate,
    abilities,
    skills,
    resources: {
      riflessi: { value: c.riflessi, max: c.riflessi },
      fatica: { value: faticaMax, max: faticaMax },
      spirito: { value: 0, max: 0 }
    },
    movement,
    protezione: c.protezione,
    attacks: c.attacks,
    advantages: c.advantages,
    advantageDetails: c.advantageDetails,
    disadvantages: c.disadvantages,
    woundCapacities,
    woundLevels: { graffi: 0, leggere: 0, gravi: 0, critiche: 0, mortali: 0 },
    fatigueThresholds: {
      fresco: c.fatica[0] || 0,
      stanco: c.fatica[1] || 0,
      sfinito: c.fatica[2] || 0
    },
    speciale: c.speciale
  });
}

// ─── Build a single compendium pack ──────────────────────────────────────────

function buildPack(name, srcDir, outDir, entries) {
  // Clean and recreate source directory
  if (existsSync(srcDir)) rmSync(srcDir, { recursive: true });
  mkdirSync(srcDir, { recursive: true });

  // Write individual JSON files
  for (const { filename, data } of entries) {
    writeFileSync(resolve(srcDir, filename), JSON.stringify(data, null, 2) + "\n");
  }
  console.log(`Wrote ${entries.length} JSON source files to src/packs/${name}/`);

  // Compile to LevelDB using Foundry CLI
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const cmd = `npx @foundryvtt/foundryvtt-cli package pack --type System --id sword --compendiumName ${name} --in "${srcDir}" --out "${resolve(SWORD_ROOT, "packs")}"`;
  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: SWORD_ROOT });

  console.log(`Compiled LevelDB pack to packs/${name}/`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  // ── Equipment pack ──
  const items = [];
  for (const w of WEAPONS) {
    items.push({ filename: `weapon_${w.weaponId}.json`, data: buildWeapon(w) });
  }
  for (const s of SHIELDS) {
    items.push({ filename: `shield_${s.shieldId}.json`, data: buildShield(s) });
  }
  for (const a of ARMOR) {
    items.push({ filename: `armor_${a.armorId}.json`, data: buildArmor(a) });
  }
  for (const g of GEAR) {
    items.push({ filename: `gear_${g.gearId}.json`, data: buildGear(g) });
  }
  buildPack("equipment", EQUIP_SRC_DIR, EQUIP_OUT_DIR, items);

  // ── Bestiary pack ──
  const creatures = [];
  for (const c of CREATURES) {
    creatures.push({ filename: `creature_${c.id}.json`, data: buildCreature(c) });
  }
  buildPack("bestiary", BESTIARY_SRC_DIR, BESTIARY_OUT_DIR, creatures);

  console.log("Done! All packs built.");
}

main();
