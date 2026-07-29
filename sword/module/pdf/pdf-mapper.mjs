/**
 * PDF field mapper — adapted from Foundry2PDF/foundry_pdf_mapper.js
 * ESM, no Node.js dependencies. Maps actor data to PDF field values.
 */

function get(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object" || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function modifier(score) {
  if (score == null) return 0;
  if (score <= 6) return -1;
  if (score === 7) return 0;
  if (score <= 9) return 1;
  if (score <= 11) return 2;
  if (score <= 13) return 3;
  return 3 + Math.floor((score - 13) / 2);
}

function segmented(total, buckets) {
  const t = Math.max(0, Number(total) || 0);
  const base = Math.floor(t / buckets);
  const rem = t % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < rem ? 1 : 0));
}

function asText(v) {
  if (v == null) return "";
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  return String(v);
}

function pick(arr, idx) {
  return idx >= 0 && idx < arr.length ? arr[idx] : undefined;
}

function joinPregi(item) {
  if (!item) return "";
  const pregi = get(item, "system", "pregi");
  if (Array.isArray(pregi)) return pregi.map(String).join(", ");
  return pregi ? String(pregi) : "";
}

function itemWeight(item) {
  if (!item) return "";
  const q = Number(get(item, "system", "quantity") ?? 1);
  const w = Number(get(item, "system", "weight") ?? 0);
  if (Number.isNaN(q) || Number.isNaN(w)) return "";
  return q * w;
}

const SKILL_KEY = {
  "Volontà": "volonta",
  "Arte guerra": "arte_della_guerra",
  "Autorità": "autorita",
  "Cavalcare": "cavalcare",
  "Teologia": "teologia",
  "Agilità": "agilita",
  Archi: "archi",
  "Armi Corte": "armi_corte",
  "Furtività": "furtivita",
  "Manualità": "manualita",
  Forza: "forza",
  "Armi Comuni": "armi_comuni",
  "Armi da Guerra": "armi_da_guerra",
  Atletica: "atletica",
  Lotta: "lotta",
  Carisma: "carisma",
  Intrattenere: "intrattenere",
  Mercatura: "mercatura",
  Raggirare: "raggirare",
  "Usi e Costumi": "usi_e_costumi",
  Ragionamento: "ragionamento",
  Alchimia: "alchimia",
  "Arti Arcane": "arti_arcane",
  "Arti Liberali": "arti_liberali",
  "Storia e Leggende": "storia_e_leggende",
  Percezione: "percezione",
  Balestre: "balestre",
  Empatia: "empatia",
  Guarigione: "guarigione",
  Sopravvivenza: "sopravvivenza",
};

const D_SKILL = {
  "DVolontà": "Volontà",
  DArteGuerra: "Arte guerra",
  "DAutorità": "Autorità",
  DCavalcare: "Cavalcare",
  DTeologia: "Teologia",
  "DAgilità": "Agilità",
  DArchi: "Archi",
  DArmiCorte: "Armi Corte",
  "DFurtività": "Furtività",
  DManualità: "Manualità",
  DForza: "Forza",
  DArmiComuni: "Armi Comuni",
  DArmiGuerra: "Armi da Guerra",
  DAtletica: "Atletica",
  DLotta: "Lotta",
  DCarisma: "Carisma",
  DIntrattenere: "Intrattenere",
  DMercatura: "Mercatura",
  DRaggirare: "Raggirare",
  DUsiCostumi: "Usi e Costumi",
  DRagionamento: "Ragionamento",
  DAlchimia: "Alchimia",
  DArtiArcane: "Arti Arcane",
  DArtiLiberali: "Arti Liberali",
  DStoriaLeggende: "Storia e Leggende",
  DPercezione: "Percezione",
  DBalestre: "Balestre",
  DEmpatia: "Empatia",
  DGuarigione: "Guarigione",
  DSopravvivenza: "Sopravvivenza",
};

function buildContext(actor) {
  const system = actor.system || {};
  const ch = system.characteristics || {};
  const sk = system.skills || {};
  const rs = system.resources || {};
  const pe = system.pe || {};
  const valori = system.valori || {};
  const wound = system.woundLevels || {};
  const retaggio = system.retaggio || {};

  // Handle items as either Array or Foundry Collection
  const items = Array.isArray(actor.items) ? actor.items : Array.from(actor.items);

  const weapons = items.filter((i) => i.type === "weapon");
  const armors = items.filter((i) => i.type === "armor");
  const gear = items.filter((i) => i.type === "gear");

  // Talents: try items first, then derive from system.talents (SwORD computes talents as derived data)
  let talents = items
    .filter((i) => i.type === "talent" || i.type === "talento")
    .map((i) => i.name || "");
  if (talents.length === 0 && system.talents) {
    talents = Object.values(system.talents)
      .filter((t) => t.unlocked)
      .map((t) => t.name || "");
  }

  let focus = items
    .filter((i) => i.type === "focus")
    .map((i) => i.name || "");

  if (focus.length === 0) {
    for (const [label, key] of Object.entries(SKILL_KEY)) {
      const foci = get(sk, key, "foci");
      if (Array.isArray(foci) && foci.length > 0) {
        for (const f of foci) focus.push(`${label}: ${f.name || ""}`);
      } else if (get(sk, key, "hasFocus")) {
        focus.push(label);
      }
    }
  }

  const cultureTraits = [get(system, "culture", "trait1"), get(system, "culture", "trait2")].filter(Boolean);
  const retaggioEntries = String(get(retaggio, "notes") || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);

  const traits = [...cultureTraits];
  for (const t of retaggioEntries) if (!traits.includes(t)) traits.push(t);

  const aud = Number(ch.audacia || 0);
  const cel = Number(ch.celeritas || 0);
  const fort = Number(ch.fortitudo || 0);
  const pru = Number(ch.prudentia || 0);
  const forzaGrade = Number(get(sk, "forza", "grade") || 0);
  const volGrade = Number(get(sk, "volonta", "grade") || 0);

  const derivedRifMax = pru + modifier(cel) + Number(retaggio.riflessiBonus || 0);
  const derivedSpirMax = aud + modifier(aud) + volGrade + Number(retaggio.spiritoBonus || 0);
  const derivedFaticaTotal = fort + aud;
  const derivedFeriteTotal = fort + modifier(fort) + forzaGrade;

  const rifCurrent = Number(get(rs, "riflessi", "value") || 0);
  const rifMax = Number(get(rs, "riflessi", "max") || 0) || derivedRifMax;

  const spirCurrent = Number(get(rs, "spirito", "value") || 0);
  const spirMax = Number(get(rs, "spirito", "max") || 0) || derivedSpirMax;

  const fatCurrent = Number(get(rs, "fatica", "value") || 0);
  const fatTotal = Number(get(rs, "fatica", "max") || 0) || derivedFaticaTotal;
  // Segment sizes follow the engine's fatigue bounds (computeFatigueLevel):
  // Indomito shifts both bounds, Guerresca shifts the stanco bound.
  const fatIndomito = !!get(system, "retaggio", "indomito");
  const fatGuerresca = cultureTraits.includes("guerresca") ? 1 : 0;
  const stancoBound = Math.floor(fatTotal * 2 / 3) + (fatIndomito ? 2 : 0) + fatGuerresca;
  const sfinitoBound = Math.floor(fatTotal / 3) + (fatIndomito ? 1 : 0);
  const [fresTot, stanTot, sfiTot] = [
    Math.max(0, fatTotal - stancoBound),
    Math.max(0, stancoBound - sfinitoBound),
    Math.max(0, sfinitoBound)
  ];

  let spentFat = Math.max(0, fatTotal - fatCurrent);
  const fatRes = [fresTot, stanTot, sfiTot];
  for (let i = 0; i < 3; i += 1) {
    const take = Math.min(fatRes[i], spentFat);
    fatRes[i] -= take;
    spentFat -= take;
  }
  const [fresRes, stanRes, sfiRes] = fatRes;

  const feriteTotal = Number(get(rs, "ferite", "max") || 0) || derivedFeriteTotal;
  // Prefer the derived woundCapacities (includes Indomito/Guerresca bonuses)
  const wc = system.woundCapacities;
  const [graTot, legTot, gravTot, criTot, morTot] = wc
    ? [wc.graffi, wc.leggere, wc.gravi, wc.critiche, wc.mortali].map((v) => Number(v || 0))
    : segmented(feriteTotal, 5);

  const graRes = Math.max(0, graTot - Number(wound.graffi || 0));
  const legRes = Math.max(0, legTot - Number(wound.leggere || 0));
  const gravRes = Math.max(0, gravTot - Number(wound.gravi || 0));
  const criRes = Math.max(0, criTot - Number(wound.critiche || 0));
  const morRes = Math.max(0, morTot - Number(wound.mortali || 0));

  const ingBase = fort + forzaGrade;

  let totalWeight = 0;
  for (const it of items) {
    const w = itemWeight(it);
    if (typeof w === "number" && Number.isFinite(w)) totalWeight += w;
  }

  return {
    actor,
    system,
    ch,
    sk,
    rs,
    pe,
    valori,
    weapons,
    armors,
    gear,
    equipItems: gear,
    talents,
    focus,
    traits,
    artigianoRows: ["artigiano", "professione"].flatMap((key) => {
      const s = sk?.[key];
      if (!s) return [];
      if (!(Number(s.grade || 0) > 0 || s.specialty)) return [];
      return [{
        name: s.specialty || (key === "artigiano" ? "Artigiano" : "Professione"),
        char: s.specialtyChar || "mens",
        grade: Number(s.grade || 0),
        extraDice: Number(s.extraDice || 0)
      }];
    }),
    events: Array.isArray(system.events) && system.events.length ? system.events : retaggioEntries,
    metrics: {
      rifCurrent,
      rifMax,
      spirCurrent,
      spirMax,
      fresTot,
      stanTot,
      sfiTot,
      fresRes,
      stanRes,
      sfiRes,
      graTot,
      legTot,
      gravTot,
      criTot,
      morTot,
      graRes,
      legRes,
      gravRes,
      criRes,
      morRes,
      ingBase,
      totalWeight,
    },
  };
}

function mapField(fieldName, fieldType, ctx) {
  const { actor, system, ch, sk, rs, pe, valori, armors, weapons, equipItems, talents, focus, traits, events, metrics } = ctx;

  if (fieldType === "/Btn") {
    return {
      value: "",
      mapStatus: "image_field",
      foundrySource: "",
      note: "Image/button field",
    };
  }

  const direct = {
    Nome: [actor.name || "", "actor.name"],
    Ceto: [system.ceto || "", "actor.system.ceto"],
    Fides: [valori.fides ?? "", "actor.system.valori.fides"],
    Impietas: [valori.impietas ?? "", "actor.system.valori.impietas"],
    Honor: [valori.honor ?? "", "actor.system.valori.honor"],
    Ego: [valori.ego ?? "", "actor.system.valori.ego"],
    Superstitio: [valori.superstitio ?? "", "actor.system.valori.superstitio"],
    Ratio: [valori.ratio ?? "", "actor.system.valori.ratio"],
    Fama: [system.fama ?? "", "actor.system.fama"],
    "PE Liberi": [pe.available ?? pe.total ?? "", "actor.system.pe.available"],
    "PE spesi": [
      pe.spent ?? (pe.total != null ? 0 : ""),
      "actor.system.pe.spent || (actor.system.pe.total != null ? 0 : '')",
    ],
    "Riflessi attuali": [metrics.rifCurrent, "actor.system.resources.riflessi.value"],
    "Riflessi massimi": [metrics.rifMax, "actor.system.resources.riflessi.max || derived"],
    Spiritototale: [metrics.spirMax, "actor.system.resources.spirito.max || derived"],
    Spiritoresiduo: [metrics.spirCurrent, "actor.system.resources.spirito.value"],
    Frescototale: [metrics.fresTot, "derived DM-007"],
    Stancototale: [metrics.stanTot, "derived DM-007"],
    Sfinitototale: [metrics.sfiTot, "derived DM-007"],
    "Fresco residuo": [metrics.fresRes, "derived from fatica current"],
    "Stanco residuo": [metrics.stanRes, "derived from fatica current"],
    "Sfinito residuo": [metrics.sfiRes, "derived from fatica current"],
    Graffitotali: [metrics.graTot, "derived DM-006"],
    Leggeretotali: [metrics.legTot, "derived DM-006"],
    Gravitotali: [metrics.gravTot, "derived DM-006"],
    Critichetotali: [metrics.criTot, "derived DM-006"],
    Mortalitotali: [metrics.morTot, "derived DM-006"],
    "Graffi Residue": [metrics.graRes, "derived totals - woundLevels.graffi"],
    "Leggere Residue": [metrics.legRes, "derived totals - woundLevels.leggere"],
    "Gravi Residue": [metrics.gravRes, "derived totals - woundLevels.gravi"],
    "Critiche Residue": [metrics.criRes, "derived totals - woundLevels.critiche"],
    "Mortali Residue": [metrics.morRes, "derived totals - woundLevels.mortali"],
    "Nessun Ingombro": [metrics.ingBase, "derived DM-008 base"],
    "Ingombro Leggero": [metrics.ingBase * 2, "derived DM-008"],
    "Ingombro Moderato": [metrics.ingBase * 4, "derived DM-008"],
    "Ingombro Pesante": [metrics.ingBase * 6, "derived DM-008"],
    "Ingombro Massimo": [metrics.ingBase * 8, "derived DM-008"],
    "Peso totale trasportato": [metrics.totalWeight, "sum(item.weight * qty)"],
    "Lire d'oro": [get(system, "money", "lire") ?? "", "actor.system.money.lire"],
    Soldi: [get(system, "money", "soldi") ?? "", "actor.system.money.soldi"],
    Denari: [get(system, "money", "denari") ?? "", "actor.system.money.denari"],
    "Protezione Armatura": [
      armors.reduce((acc, a) => acc + Number(get(a, "system", "protezione") || 0), 0),
      "sum(actor.items[type=armor].system.protezione)",
    ],
    "Robustezza Armatura": [
      armors.reduce(
        (acc, a) =>
          acc +
          Number(get(a, "system", "robustezzaCurrent") ?? get(a, "system", "robustezza") ?? 0),
        0,
      ),
      "sum(actor.items[type=armor].system.robustezzaCurrent)",
    ],
    Tentazione: [system.tentazione || system.temptation || "", "actor.system.tentazione|temptation"],
    Ordine: [system.order || system.ordine || "", "actor.system.order|ordine"],
    Mestiere: [system.mestiere || "", "actor.system.mestiere"],
    Cultura: [
      get(system, "culture", "name") ||
        [get(system, "culture", "trait1"), get(system, "culture", "trait2")]
          .filter(Boolean)
          .join(", "),
      "actor.system.culture.name || actor.system.culture.trait1/trait2",
    ],
    Lingue: [Array.isArray(system.languages) ? system.languages.join(", ") : "", "actor.system.languages[]"],
    Anno: [system.birthYear || system.anno || "", "actor.system.birthYear|anno"],
    Genere: [system.gender || system.genere || "", "actor.system.gender|genere"],
  };

  if (direct[fieldName]) {
    const [value, source] = direct[fieldName];
    const mapStatus = String(source).includes("derived") || String(source).startsWith("sum(")
      ? "mapped_derived"
      : "mapped_direct";

    if (value === "") {
      return {
        value: "",
        mapStatus: "unmapped_missing",
        foundrySource: source,
        note: "Key missing in this actor export",
      };
    }

    return { value, mapStatus, foundrySource: source, note: "" };
  }

  if (["Audacia", "Celeritas", "Fortitudo", "Gratia", "Mens", "Prudentia"].includes(fieldName)) {
    const key = fieldName.toLowerCase();
    return {
      value: ch[key] ?? "",
      mapStatus: "mapped_direct",
      foundrySource: `actor.system.characteristics.${key}`,
      note: "",
    };
  }

  if (fieldName.startsWith("Mod ")) {
    const key = fieldName.replace("Mod ", "").toLowerCase();
    const score = ch[key];
    if (score == null) {
      return {
        value: "",
        mapStatus: "unmapped_missing",
        foundrySource: `actor.system.characteristics.${key}`,
        note: "Characteristic missing",
      };
    }
    return {
      value: modifier(Number(score)),
      mapStatus: "mapped_derived",
      foundrySource: `modifier(actor.system.characteristics.${key})`,
      note: "DM-003",
    };
  }

  if (fieldName.startsWith("Grado ")) {
    const label = fieldName.replace("Grado ", "");
    const key = SKILL_KEY[label];
    if (!key) {
      return { value: "", mapStatus: "unmapped_manual", foundrySource: "", note: "No key mapping" };
    }
    return {
      value: get(sk, key, "grade") ?? "",
      mapStatus: "mapped_direct",
      foundrySource: `actor.system.skills.${key}.grade`,
      note: "",
    };
  }

  if (fieldName in D_SKILL) {
    const key = SKILL_KEY[D_SKILL[fieldName]];
    return {
      value: get(sk, key, "extraDice") ?? "",
      mapStatus: "mapped_direct",
      foundrySource: `actor.system.skills.${key}.extraDice`,
      note: "",
    };
  }

  if (fieldName.startsWith("Focus ")) {
    const idx = Number(fieldName.split(" ").pop()) - 1;
    const value = focus[idx] || "";
    return {
      value,
      mapStatus: value ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.items[type=focus][${idx}].name`,
      note: value ? "" : "No focus entries in sample",
    };
  }

  if (fieldName.startsWith("Regioni Fama ")) {
    const idx = Number(fieldName.split(" ").pop()) - 1;
    const arr = Array.isArray(system.famaRegions) ? system.famaRegions : [];
    const value = arr[idx] || "";
    return {
      value,
      mapStatus: value ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.system.famaRegions[${idx}]`,
      note: value ? "" : "No famaRegions array in sample",
    };
  }

  if (fieldName.startsWith("Armi ")) {
    const idx = Number(fieldName.split(" ").pop()) - 1;
    const w = pick(weapons, idx);
    return {
      value: w ? w.name || "" : "",
      mapStatus: w ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.items[type=weapon][${idx}].name`,
      note: "",
    };
  }

  if (fieldName.startsWith("Dannoarma")) {
    const idx = Number(fieldName.replace("Dannoarma", "")) - 1;
    const w = pick(weapons, idx);
    if (!w) return { value: "", mapStatus: "mapped_optional_empty", foundrySource: `weapon[${idx}]`, note: "" };
    const dv = get(w, "system", "damageValue") ?? "";
    const dt = get(w, "system", "damageType") ?? "";
    return {
      value: `${dv}${dt}`,
      mapStatus: "mapped_array",
      foundrySource: `actor.items[type=weapon][${idx}].system.damageValue/damageType`,
      note: "",
    };
  }

  if (fieldName.startsWith("Misuraarma")) {
    const idx = Number(fieldName.replace("Misuraarma", "")) - 1;
    const w = pick(weapons, idx);
    return {
      value: w ? get(w, "system", "misura") || "" : "",
      mapStatus: w ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.items[type=weapon][${idx}].system.misura`,
      note: "",
    };
  }

  if (fieldName.startsWith("Parata")) {
    const idx = Number(fieldName.replace("Parata", "")) - 1;
    const w = pick(weapons, idx);
    return {
      value: w ? get(w, "system", "parryModifier") ?? "" : "",
      mapStatus: w ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.items[type=weapon][${idx}].system.parryModifier`,
      note: "",
    };
  }

  if (fieldName.startsWith("Pregiarmi")) {
    const idx = Number(fieldName.replace("Pregiarmi", "")) - 1;
    const w = pick(weapons, idx);
    return {
      value: joinPregi(w),
      mapStatus: w ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.items[type=weapon][${idx}].system.pregi[]`,
      note: "",
    };
  }

  if (fieldName.startsWith("Armatura ")) {
    const idx = Number(fieldName.split(" ").pop()) - 1;
    const a = pick(armors, idx);
    return {
      value: a ? a.name || "" : "",
      mapStatus: a ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.items[type=armor][${idx}].name`,
      note: "",
    };
  }

  if (["Note armatura 1", "Note Armatura 2", "Note Armatura 3"].includes(fieldName)) {
    const idx = fieldName.endsWith("1") ? 0 : fieldName.endsWith("2") ? 1 : 2;
    const a = pick(armors, idx);
    return {
      value: joinPregi(a),
      mapStatus: a ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.items[type=armor][${idx}].system.pregi[]`,
      note: "",
    };
  }

  {
    // Artigiano/Professione rows: name ("Artigiano 1".."Artigiano 5"),
    // characteristic ("Caratteristica Artigiano 1" / "Carartigiano2-5"),
    // grade ("Gartigianato1-5"), extra dice ("Dartigianato1-5")
    const nameIdx = fieldName.match(/^Artigiano ?(\d)$/)?.[1];
    const charIdx = fieldName === "Caratteristica Artigiano 1"
      ? "1" : fieldName.match(/^Carartigiano(\d)$/)?.[1];
    const gradeIdx = fieldName.match(/^Gartigianato(\d)$/)?.[1];
    const diceIdx = fieldName.match(/^Dartigianato(\d)$/)?.[1];
    const idxStr = nameIdx ?? charIdx ?? gradeIdx ?? diceIdx;
    if (idxStr) {
      const row = ctx.artigianoRows[Number(idxStr) - 1];
      let value = "";
      if (row) {
        if (nameIdx) value = row.name;
        else if (charIdx) value = row.char.charAt(0).toUpperCase() + row.char.slice(1);
        else if (gradeIdx) value = row.grade;
        else value = row.extraDice;
      }
      return {
        value,
        mapStatus: row ? "mapped_direct" : "mapped_optional_empty",
        foundrySource: "actor.system.skills.artigiano/professione",
        note: "",
      };
    }
  }

  if (fieldName.startsWith("Talenti")) {
    const idx = Number(fieldName.replace("Talenti", "")) - 1;
    const value = talents[idx] || "";
    return {
      value,
      mapStatus: value ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.system.talents[${idx}].name`,
      note: "",
    };
  }

  if (fieldName.startsWith("Tratti ")) {
    const idx = Number(fieldName.split(" ").pop()) - 1;
    const value = traits[idx] || "";
    return {
      value,
      mapStatus: value ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.system.culture.trait* / actor.system.retaggio.notes`,
      note: "",
    };
  }

  if (fieldName.startsWith("Eventi ")) {
    const idx = Number(fieldName.split(" ").pop()) - 1;
    const value = events[idx] || "";
    return {
      value,
      mapStatus: value ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `actor.system.events[${idx}]`,
      note: "",
    };
  }

  if (fieldName.startsWith("Equipaggiamento ")) {
    const tail = fieldName.replace("Equipaggiamento ", "");
    const side = tail.slice(-1);
    const n = Number(tail.slice(0, -1));
    const idx = side === "S" ? n - 1 : 15 + (n - 1);
    const it = pick(equipItems, idx);
    return {
      value: it ? it.name || "" : "",
      mapStatus: it ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `equipItems[${idx}].name`,
      note: "",
    };
  }

  if (fieldName.startsWith("Pequip")) {
    const side = fieldName[6];
    const n = Number(fieldName.slice(7));
    const idx = side === "S" ? n - 1 : 15 + (n - 1);
    const it = pick(equipItems, idx);
    return {
      value: it ? itemWeight(it) : "",
      mapStatus: it ? "mapped_array" : "mapped_optional_empty",
      foundrySource: `equipItems[${idx}].system.weight*quantity`,
      note: "",
    };
  }

  return {
    value: "",
    mapStatus: "unmapped_manual",
    foundrySource: "",
    note: "No mapping rule yet",
  };
}

function buildPdfPayload(actor, pdfFieldRows) {
  const ctx = buildContext(actor);
  const payload = {};
  for (const r of pdfFieldRows) {
    const mapped = mapField(r.field_name, r.field_type, ctx);
    payload[r.field_name] = asText(mapped.value);
  }
  return payload;
}

export { buildPdfPayload, buildContext, mapField };
