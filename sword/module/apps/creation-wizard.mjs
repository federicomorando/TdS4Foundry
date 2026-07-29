import { SKILL_MAP, BASE_SKILLS, CETO_SKILLS, TALENT_DEFS, checkTalentUnlocked } from "../data/actor.mjs";
import { CULTURE_DEFS, CULTURE_IDS, getCultureAllowedValori } from "../engine.mjs";
import { WEAPONS, SHIELDS, ARMOR, GEAR, denariToDisplay } from "../engine.mjs";

const CHAR_ORDER = ["fortitudo", "celeritas", "gratia", "mens", "prudentia", "audacia"];
const CHAR_POINTS_TARGET = 54;

const CETO_ORDER = ["umile", "popolano", "borghese", "nobile"];
const CETO_COST = { umile: 0, popolano: 1, borghese: 2, nobile: 3 };

/**
 * Starting wealth per ceto. Each entry has dice count, sides, multiplier, and unit.
 * Umile: 4d6 soldi, Popolano: 2d6 lire, Borghese: 2d6×5 lire, Nobile: 4d6×10 lire.
 * Source: IL_TEMPO_DELLA_SPADA_Errata.md pp.1038-1065.
 */
const STARTING_WEALTH = {
  umile:    { dice: 4, multiplier: 1, unit: "soldi" },
  popolano: { dice: 2, multiplier: 1, unit: "lire" },
  borghese: { dice: 2, multiplier: 5, unit: "lire" },
  nobile:   { dice: 4, multiplier: 10, unit: "lire" }
};

const EVENT_TYPES = [
  "addestramento_marziale", "apprendistato", "affinita_animale", "antico_sapere",
  "cimelio", "conoscenze", "dedizione", "esperienza", "fascino",
  "indomito", "istinto", "legame", "nomea",
  "percorso_spirituale", "talento_naturale"
];

const EVENT_DEFS = {
  addestramento_marziale: {
    pickFrom: ["archi", "balestre", "armi_corte", "armi_comuni", "armi_da_guerra", "lotta"],
    pickCount: 1, effect: "extraDice", extraDiceAmount: 1
  },
  affinita_animale: { pickFrom: null, effect: "flag" },
  antico_sapere: {
    pickFrom: ["alchimia", "arti_arcane", "guarigione", "storia_e_leggende", "teologia"],
    pickCount: 2, effect: "extraDice", extraDiceAmount: 1
  },
  apprendistato: {
    effect: "extraDice",
    modes: {
      single: { pickFrom: ["artigiano", "professione"], pickCount: 1, extraDiceAmount: 2 },
      split:  { pickFrom: ["artigiano", "professione"], pickCount: 2, extraDiceAmount: 1 }
    }
  },
  cimelio: { pickFrom: null, effect: "flag" },
  conoscenze: { pickFrom: null, effect: "flag" },
  dedizione: {
    pickFrom: ["arte_della_guerra", "atletica", "cavalcare", "empatia", "furtivita",
               "manualita", "mercatura", "sopravvivenza", "usi_e_costumi"],
    pickCount: 2, effect: "extraDice", extraDiceAmount: 1
  },
  esperienza: { pickFrom: null, effect: "training", extraGrade3: 1, extraGrade2: 2 },
  fascino: {
    pickFrom: ["arti_liberali", "autorita", "intrattenere", "raggirare"],
    pickCount: 2, effect: "extraDice", extraDiceAmount: 1
  },
  indomito: { pickFrom: null, effect: "flag" },
  istinto: { pickFrom: null, effect: "riflessi_bonus", bonus: 1 },
  legame: { pickFrom: null, effect: "flag" },
  nomea: { pickFrom: null, effect: "fama_bonus", bonus: 1 },
  percorso_spirituale: { pickFrom: null, effect: "spirito_bonus", bonus: 3, valorePickRequired: true },
  talento_naturale: {
    pickFrom: ["volonta", "agilita", "carisma", "forza", "ragionamento", "percezione"],
    pickCount: 1, effect: "extraDice", extraDiceAmount: 1
  }
};

const STEP_LABELS = [
  "SWORD.Creation.StepCeto",
  "SWORD.Creation.StepCharacteristics",
  "SWORD.Creation.StepCulture",
  "SWORD.Creation.StepDerived",
  "SWORD.Creation.StepSkills",
  "SWORD.Creation.StepValori",
  "SWORD.Creation.StepRetaggio",
  "SWORD.Creation.StepEquipment"
];

/**
 * Compute the mestiere pick cost for a skill given a ceto.
 * Own-ceto/adjacent = 1, farther ceti = +1 per extra distance beyond adjacent.
 * Common skills and base skills are excluded from mestiere.
 */
function mestiereCost(skillId, ceto, hasUrbana = false) {
  if (CETO_SKILLS.common.includes(skillId)) return null; // common = not mestiere
  if (BASE_SKILLS.includes(skillId)) return null;
  const idx = CETO_ORDER.indexOf(ceto);
  for (let dist = 0; dist < CETO_ORDER.length; dist++) {
    for (const d of [idx - dist, idx + dist]) {
      if (d < 0 || d >= CETO_ORDER.length) continue;
      const c = CETO_ORDER[d];
      if (CETO_SKILLS[c]?.includes(skillId)) {
        let cost = dist <= 1 ? 1 : dist;
        if (hasUrbana && cost > 1) cost -= 1;
        return cost;
      }
    }
  }
  return null;
}

/**
 * Get all skills available as mestiere for a given ceto, with costs.
 */
function availableMestiereSkills(ceto, hasUrbana = false) {
  const result = [];
  const allSkillIds = Object.keys(SKILL_MAP);
  for (const id of allSkillIds) {
    const cost = mestiereCost(id, ceto, hasUrbana);
    if (cost !== null) {
      result.push({ id, cost });
    }
  }
  return result.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
}

export class SwordCreationWizard extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor({ actor, ...options } = {}) {
    super(options);
    this.actor = actor;
    this._state = {
      step: 1,
      ceto: "umile",
      chars: Object.fromEntries(CHAR_ORDER.map(k => [k, 7])),
      cultureTrait1: "",         // culture ID
      cultureTrait2: "",         // culture ID
      trait1Skill: "",           // chosen skill for trait1's extra die
      trait2Skill: "",           // chosen skill for trait2's extra die
      corteseAdvSkill: "",       // Cortese advantage: pick 1 of 3
      mestiereSkills: [],   // array of skill IDs chosen as mestiere
      freeSkills: [],       // array of skill IDs chosen as free picks
      specialties: {},      // { artigiano: { name, char }, professione: { name, char } }
      grade3: ["", ""],     // 2 skills at grade 3
      grade2: Array(8).fill(""), // 8 skills at grade 2
      valori: { fides: 0, impietas: 0, honor: 0, ego: 0, superstitio: 0, ratio: 0 },
      tentazione: "",       // temptation ID or "" for none
      events: [],           // array of { type, note, picks, mode, valoreKey }
      espGrade3: [""],       // 1 extra grade 3 slot (Esperienza)
      espGrade2: ["", ""],   // 2 extra grade 2 slots (Esperienza)
      cart: [],              // equipment cart: [{type, itemId, qty}]
      wealth: 0,             // total wealth in denari
      wealthBase: 0,         // wealth roll result in denari before multipliers
      wealthRolled: false,   // whether wealth has been rolled
      equipMode: "manual",   // "manual" or "random"
    };
  }

  static DEFAULT_OPTIONS = {
    id: "sword-creation-wizard",
    classes: ["sword-creation-wizard"],
    tag: "div",
    window: {
      title: "SWORD.Creation.Title",
      resizable: true
    },
    position: { width: 620, height: 640 },
    actions: {
      // NOTE: select/input-driven steps (setCultureTrait*, setTrait*Skill,
      // setGrade*, setTentazione, setEvent*, setSpecialty*) are deliberately
      // NOT registered here: ApplicationV2 actions fire on ANY click, so a
      // click on a <select> would re-render and close the native dropdown.
      // They are wired as change listeners in _onRender instead.
      selectCeto: SwordCreationWizard.#onSelectCeto,
      charInc: SwordCreationWizard.#onCharInc,
      charDec: SwordCreationWizard.#onCharDec,
      toggleMestiere: SwordCreationWizard.#onToggleMestiere,
      toggleFreeSkill: SwordCreationWizard.#onToggleFreeSkill,
      valoreInc: SwordCreationWizard.#onValoreInc,
      valoreDec: SwordCreationWizard.#onValoreDec,
      setEventPick: SwordCreationWizard.#onSetEventPick,
      setEventMode: SwordCreationWizard.#onSetEventMode,
      addToCart: SwordCreationWizard.#onAddToCart,
      removeFromCart: SwordCreationWizard.#onRemoveFromCart,
      setEquipMode: SwordCreationWizard.#onSetEquipMode,
      randomEquipment: SwordCreationWizard.#onRandomEquipment,
      rerollWealth: SwordCreationWizard.#onRerollWealth,
      wizardBack: SwordCreationWizard.#onBack,
      wizardNext: SwordCreationWizard.#onNext,
      wizardFinish: SwordCreationWizard.#onFinish
    }
  };

  static PARTS = {
    wizard: {
      template: "systems/sword/templates/apps/creation-wizard.hbs"
    }
  };

  // --- Lifecycle ---

  async render(options) {
    const content = this.element?.querySelector(".wizard-content");
    this._scrollTop = content?.scrollTop ?? 0;
    return super.render(options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    // Restore scroll position after re-render
    const content = html.querySelector(".wizard-content");
    if (content && this._scrollTop) content.scrollTop = this._scrollTop;

    // Attach change listeners for inputs/selects (data-action only fires on click)
    for (const input of html.querySelectorAll("input[data-action], select[data-action]")) {
      const action = input.dataset.action;
      const handler = {
        setCultureTrait1: SwordCreationWizard.#onSetCultureTrait,
        setCultureTrait2: SwordCreationWizard.#onSetCultureTrait,
        setTrait1Skill: SwordCreationWizard.#onSetTraitSkill,
        setTrait2Skill: SwordCreationWizard.#onSetTraitSkill,
        setCorteseAdvSkill: SwordCreationWizard.#onSetCorteseAdvSkill,
        setGrade3: SwordCreationWizard.#onSetGrade3,
        setGrade2: SwordCreationWizard.#onSetGrade2,
        setEvent: SwordCreationWizard.#onSetEvent,
        setEventNote: SwordCreationWizard.#onSetEventNote,
        setTentazione: SwordCreationWizard.#onSetTentazione,
        setEventValore: SwordCreationWizard.#onSetEventValore,
        setEspGrade3: SwordCreationWizard.#onSetEspGrade3,
        setEspGrade2: SwordCreationWizard.#onSetEspGrade2,
        setSpecialtyName: SwordCreationWizard.#onSetSpecialtyName,
        setSpecialtyChar: SwordCreationWizard.#onSetSpecialtyChar,
      }[action];
      if (handler) {
        input.addEventListener("change", (ev) => handler.call(this, ev, input));
      }
    }
  }

  // --- Helpers ---

  get _mod() {
    return (score) => {
      const d = score - 7;
      return d > 0 ? Math.ceil(d / 2) : Math.floor(d / 2);
    };
  }

  get _charPointsUsed() {
    return Object.values(this._state.chars).reduce((s, v) => s + v, 0);
  }

  /** All skill IDs that have at least grade 1 in this wizard state */
  get _knownSkills() {
    const known = new Set(BASE_SKILLS);
    for (const id of this._state.mestiereSkills) known.add(id);
    for (const id of this._state.freeSkills) known.add(id);
    return known;
  }

  /** Whether either culture trait is the given ID */
  _hasCultureTrait(id) {
    return this._state.cultureTrait1 === id || this._state.cultureTrait2 === id;
  }

  /** Total mestiere picks consumed (accounting for cross-ceto cost and Urbana) */
  get _mestierePicksUsed() {
    const hasUrbana = this._hasCultureTrait("urbana");
    let used = 0;
    for (const id of this._state.mestiereSkills) {
      used += mestiereCost(id, this._state.ceto, hasUrbana) || 1;
    }
    return used;
  }

  get _freePicksTotal() {
    return this._state.chars.mens;
  }

  get _freePicksUsed() {
    const hasUrbana = this._hasCultureTrait("urbana");
    let used = 0;
    for (const id of this._state.freeSkills) {
      used += mestiereCost(id, this._state.ceto, hasUrbana) || 1;
    }
    return used;
  }

  _hasEventType(typeId) {
    return this._state.events.some(e => e.type === typeId);
  }

  _currentWealthMultiplier() {
    let mult = 1;
    if (this._hasCultureTrait("laboriosa")) mult *= 2;
    if (this._hasEventType("nomea")) mult *= 2;
    return mult;
  }

  _recomputeRolledWealth() {
    if (!this._state.wealthRolled) return;
    this._state.wealth = this._state.wealthBase * this._currentWealthMultiplier();
  }

  get _valoriTotal() {
    const v = this._state.valori;
    return v.fides + v.impietas + v.honor + v.ego + v.superstitio + v.ratio;
  }

  get _valoriMax() {
    let audaciaMod = this._mod(this._state.chars.audacia);
    // Antica: +1 to Audacia modifier
    if (this._hasCultureTrait("antica")) audaciaMod += 1;
    return Math.max(0, audaciaMod);
  }

  get _retaggioTotal() {
    let total = 3 + this._mod(this._state.chars.gratia) + (this._state.tentazione ? 1 : 0);
    // Intraprendente: +1 retaggio point
    if (this._hasCultureTrait("intraprendente")) total += 1;
    return total;
  }

  get _retaggioAvailable() {
    return this._retaggioTotal - CETO_COST[this._state.ceto];
  }

  /** Total equipment cart cost in denari */
  get _cartTotal() {
    let total = 0;
    for (const entry of this._state.cart) {
      total += this._getItemCost(entry.type, entry.itemId) * entry.qty;
    }
    return total;
  }

  _getItemCost(type, itemId) {
    if (type === "weapon") return WEAPONS.find(w => w.weaponId === itemId)?.costDenari ?? 0;
    if (type === "shield") return SHIELDS.find(sh => sh.shieldId === itemId)?.costDenari ?? 0;
    if (type === "armor") return ARMOR.find(a => a.armorId === itemId)?.costDenari ?? 0;
    if (type === "gear") return GEAR.find(g => g.gearId === itemId)?.costDenari ?? 0;
    return 0;
  }

  /** Format denari as mixed lire/soldi/denari display */
  _formatWealth(totalDenari) {
    if (totalDenari <= 0) return "0 denari";
    const l = Math.floor(totalDenari / 240);
    const rem = totalDenari % 240;
    const s = Math.floor(rem / 12);
    const d = rem % 12;
    const parts = [];
    if (l > 0) parts.push(`${l} ${game.i18n.localize("SWORD.Currency.Lire").toLowerCase()}`);
    if (s > 0) parts.push(`${s} ${game.i18n.localize("SWORD.Currency.Soldi").toLowerCase()}`);
    if (d > 0 || parts.length === 0) parts.push(`${d} ${game.i18n.localize("SWORD.Currency.Denari").toLowerCase()}`);
    return parts.join(", ");
  }

  /** Roll starting wealth based on ceto */
  async _rollWealth() {
    const s = this._state;
    const wealthDef = STARTING_WEALTH[s.ceto];
    if (!wealthDef) return;
    const roll = new Roll(`${wealthDef.dice}d6`);
    await roll.evaluate();
    const result = roll.total * wealthDef.multiplier;
    s.wealthBase = wealthDef.unit === "soldi" ? result * 12 : result * 240;
    s.wealth = s.wealthBase * this._currentWealthMultiplier();
    s.wealthRolled = true;
  }

  _detectSkillWarnings() {
    const s = this._state;
    const warnings = [];
    const freeRaised = s.freeSkills.filter(
      id => BASE_SKILLS.includes(id) || s.mestiereSkills.includes(id)
    );
    const grade3Set = new Set(s.grade3.filter(Boolean));

    for (const id of freeRaised) {
      if (!grade3Set.has(id)) continue;
      const label = game.i18n.localize(`SWORD.Skills.${id}`);
      warnings.push(game.i18n.format("SWORD.Creation.SkillWarnFreeG3", { skill: label }));
    }
    return warnings;
  }

  /** Compute skill grades from current wizard state */
  _computeSkillGrades() {
    const s = this._state;
    const grades = {};
    for (const id of Object.keys(SKILL_MAP)) {
      let grade = 0;
      if (BASE_SKILLS.includes(id)) grade = 1;
      if (s.mestiereSkills.includes(id)) grade = 1;
      if (s.freeSkills.includes(id)) grade = grade >= 1 ? 2 : 1;
      if (s.grade2.includes(id) && grade < 2) grade = 2;
      if (s.grade3.includes(id)) grade = 3;
      if (s.espGrade3.includes(id)) grade = Math.max(grade, 3);
      if (s.espGrade2.includes(id)) grade = Math.max(grade, 2);
      grades[id] = grade;
    }
    return grades;
  }

  /** Generate random equipment loadout based on character's ceto, skills, and budget */
  _generateRandomEquipment() {
    const s = this._state;
    const cart = [];
    let budget = s.wealth;
    const grades = this._computeSkillGrades();
    const cetoIdx = CETO_ORDER.indexOf(s.ceto);

    const tryAdd = (type, itemId, qty = 1) => {
      const unitCost = this._getItemCost(type, itemId);
      const cost = unitCost * qty;
      if (budget >= cost) {
        const existing = cart.find(c => c.type === type && c.itemId === itemId);
        if (existing) existing.qty += qty;
        else cart.push({ type, itemId, qty });
        budget -= cost;
        return true;
      }
      return false;
    };

    // 1. Clothing
    const clothingMap = { umile: "abiti_umili", popolano: "abiti_popolano", borghese: "abiti_borghese", nobile: "abiti_nobile" };
    tryAdd("gear", clothingMap[s.ceto]);

    // 2. Container
    tryAdd("gear", cetoIdx === 0 ? "bisaccia" : "zaino");

    // 3. Basics
    tryAdd("gear", "acciarino");
    tryAdd("gear", "otre_acqua");
    tryAdd("gear", "razioni_1giorno", 3);

    // 4. Weapon: best affordable matching highest-grade weapon skill
    const weaponSkills = ["archi", "balestre", "armi_corte", "armi_comuni", "armi_da_guerra"];
    const knownWeaponSkills = weaponSkills
      .filter(sk => grades[sk] > 0)
      .sort((a, b) => grades[b] - grades[a]);
    let selectedWeapon = null;
    for (const skillId of knownWeaponSkills) {
      const candidates = WEAPONS
        .filter(w => w.skillId === skillId)
        .sort((a, b) => b.damageValue - a.damageValue);
      for (const w of candidates) {
        if (budget >= w.costDenari) {
          cart.push({ type: "weapon", itemId: w.weaponId, qty: 1 });
          budget -= w.costDenari;
          selectedWeapon = w;
          break;
        }
      }
      if (selectedWeapon) break;
    }
    if (!selectedWeapon) {
      const coltello = WEAPONS.find(w => w.weaponId === "coltello");
      if (coltello && budget >= coltello.costDenari) {
        cart.push({ type: "weapon", itemId: "coltello", qty: 1 });
        budget -= coltello.costDenari;
        selectedWeapon = coltello;
      }
    }

    // 5. Ammunition
    if (selectedWeapon?.gittata) {
      if (selectedWeapon.category === "archi") tryAdd("gear", "frecce_12");
      else if (selectedWeapon.category === "balestre") tryAdd("gear", "dardi_12");
    }

    // 6. Shield: brocchiere if has armi_da_guerra and one-handed weapon
    if (grades.armi_da_guerra >= 1 && selectedWeapon?.hands === "una_mano") {
      tryAdd("shield", "brocchiere");
    }

    // 7. Armor: abiti_imbottiti if Borghese+ or Militare
    if (cetoIdx >= 2 || this._hasCultureTrait("militare")) {
      tryAdd("armor", "abiti_imbottiti");
    }

    // 8. Skill tools
    for (const tool of GEAR.filter(g => g.gearCategory === "skill_tool")) {
      if (tool.skillBonusSkillId && grades[tool.skillBonusSkillId] > 0) {
        tryAdd("gear", tool.gearId);
      }
    }

    // 9. Travel extras
    tryAdd("gear", "sacco_a_pelo");
    if (cetoIdx >= 2) {
      tryAdd("gear", "lanterna");
      tryAdd("gear", "olio_lanterna");
    }
    tryAdd("gear", "corda_10m");

    return cart;
  }

  // --- Context ---

  async _prepareContext(options) {
    const s = this._state;
    const step = s.step;
    const context = {};

    // Step indicators
    context.steps = STEP_LABELS.map((label, i) => ({
      num: i + 1,
      label: game.i18n.localize(label),
      active: step === i + 1,
      completed: step > i + 1
    }));

    context.currentStep = step;

    // Step 1: Ceto
    if (step === 1) {
      context.cetoOptions = CETO_ORDER.map(id => ({
        id,
        label: game.i18n.localize(`SWORD.Ceto.${id}`),
        desc: game.i18n.localize(`SWORD.Creation.CetoDesc.${id}`),
        cost: CETO_COST[id],
        selected: s.ceto === id
      }));
    }

    // Step 2: Characteristics
    if (step === 2) {
      context.charSpinners = CHAR_ORDER.map(key => ({
        key,
        label: game.i18n.localize(`SWORD.Characteristics.${key}`),
        value: s.chars[key],
        mod: this._mod(s.chars[key])
      }));
      context.charPointsUsed = this._charPointsUsed;
      context.charPointsRemaining = CHAR_POINTS_TARGET - this._charPointsUsed;
      context.charPointsValid = this._charPointsUsed === CHAR_POINTS_TARGET;
    }

    // Step 3: Culture
    if (step === 3) {
      const allSkillIds = Object.keys(SKILL_MAP);
      context.cultureOptions = CULTURE_IDS.map(id => ({
        id,
        label: game.i18n.localize(`SWORD.Cultures.${id}.label`)
      }));
      context.cultureTrait1 = s.cultureTrait1;
      context.cultureTrait2 = s.cultureTrait2;

      // Trait 1 details
      if (s.cultureTrait1) {
        const def1 = CULTURE_DEFS[s.cultureTrait1];
        context.trait1Def = {
          desc: game.i18n.localize(`SWORD.Cultures.${s.cultureTrait1}.desc`),
          advantageDesc: game.i18n.localize(`SWORD.Cultures.${s.cultureTrait1}.advantage`),
          valoriLabels: def1.valori
            ? def1.valori.map(v => game.i18n.localize(`SWORD.Valori.${v}`)).join(", ")
            : game.i18n.localize("SWORD.Creation.CultureAnyValore"),
          skillOptions: (def1.skillChoices || allSkillIds).map(id => ({
            id,
            label: game.i18n.localize(`SWORD.Skills.${id}`),
            selected: s.trait1Skill === id
          })),
          anySkill: def1.skillChoices === null
        };
      }

      // Trait 2 details
      if (s.cultureTrait2) {
        const def2 = CULTURE_DEFS[s.cultureTrait2];
        context.trait2Def = {
          desc: game.i18n.localize(`SWORD.Cultures.${s.cultureTrait2}.desc`),
          advantageDesc: game.i18n.localize(`SWORD.Cultures.${s.cultureTrait2}.advantage`),
          valoriLabels: def2.valori
            ? def2.valori.map(v => game.i18n.localize(`SWORD.Valori.${v}`)).join(", ")
            : game.i18n.localize("SWORD.Creation.CultureAnyValore"),
          skillOptions: (def2.skillChoices || allSkillIds).map(id => ({
            id,
            label: game.i18n.localize(`SWORD.Skills.${id}`),
            selected: s.trait2Skill === id
          })),
          anySkill: def2.skillChoices === null
        };
      }

      // Cortese advantage: pick 1 of 3 skills
      const hasCortese = s.cultureTrait1 === "cortese" || s.cultureTrait2 === "cortese";
      if (hasCortese) {
        const corteseDef = CULTURE_DEFS.cortese;
        context.corteseAdvOptions = corteseDef.advantagePickFrom.map(id => ({
          id,
          label: game.i18n.localize(`SWORD.Skills.${id}`),
          selected: s.corteseAdvSkill === id
        }));
        context.corteseAdvSkill = s.corteseAdvSkill;
      }
      context.hasCortese = hasCortese;
    }

    // Step 4: Derived stats
    if (step === 4) {
      const c = s.chars;
      const mod = this._mod;
      let spiritoBase = c.audacia + mod(c.audacia);
      // Antica: +1 to Audacia modifier → +1 spirito
      if (this._hasCultureTrait("antica")) spiritoBase += 1;
      // Spirituale: +4 spirito
      if (this._hasCultureTrait("spirituale")) spiritoBase += 4;
      context.derivedStats = [
        { label: game.i18n.localize("SWORD.Resources.spirito"), value: spiritoBase },
        { label: game.i18n.localize("SWORD.Resources.fatica"), value: c.fortitudo + c.audacia },
        { label: game.i18n.localize("SWORD.Resources.ferite"), value: c.fortitudo + mod(c.fortitudo) },
        { label: game.i18n.localize("SWORD.Resources.riflessi"), value: c.prudentia + mod(c.celeritas) }
      ];
    }

    // Step 5: Skills
    if (step === 5) this._prepareSkillsContext(context);

    // Step 6: Valori
    if (step === 6) {
      const v = s.valori;
      const total = this._valoriTotal;
      const max = this._valoriMax;
      const atCap = total >= max;
      // Culture constrains which valori axes are selectable
      const allowedValori = getCultureAllowedValori(s.cultureTrait1, s.cultureTrait2);
      const axes = [["fides", "impietas"], ["honor", "ego"], ["superstitio", "ratio"]];
      context.valoriAxes = axes.map(([left, right]) => {
        const leftAllowed = allowedValori.has(left);
        const rightAllowed = allowedValori.has(right);
        return {
          leftKey: left,
          rightKey: right,
          leftLabel: game.i18n.localize(`SWORD.Valori.${left}`),
          rightLabel: game.i18n.localize(`SWORD.Valori.${right}`),
          leftVal: v[left],
          rightVal: v[right],
          leftMaxed: !leftAllowed || v[left] >= 3 || v[right] > 0 || (atCap && v[left] === 0),
          rightMaxed: !rightAllowed || v[right] >= 3 || v[left] > 0 || (atCap && v[right] === 0),
          leftDisabled: !leftAllowed,
          rightDisabled: !rightAllowed,
        };
      });
      context.valoriPointsUsed = total;
      context.valoriPointsMax = max;
    }

    // Step 7: Retaggio
    if (step === 7) this._prepareRetaggioContext(context);

    // Step 8: Equipment
    if (step === 8) this._prepareEquipmentContext(context);

    // Navigation
    context.nextDisabled = !this._canAdvance();
    context.validationMsg = this._validationMessage();
    context.finishDisabled = step === 8 && this._cartTotal > s.wealth;

    return context;
  }

  _prepareSkillsContext(context) {
    const s = this._state;

    context.baseSkillDisplay = BASE_SKILLS.map(id => ({
      id,
      label: game.i18n.localize(`SWORD.Skills.${id}`)
    }));

    const hasUrbana = this._hasCultureTrait("urbana");
    const mestierePool = availableMestiereSkills(s.ceto, hasUrbana);
    const VARIES_SKILLS = new Set(["artigiano", "professione"]);
    const charOptionsList = ["fortitudo", "celeritas", "gratia", "mens", "prudentia", "audacia"]
      .map(k => ({ key: k, label: game.i18n.localize(`SWORD.Characteristics.${k}`) }));
    context.mestiereOptions = mestierePool.map(({ id, cost }) => {
      const spec = s.specialties[id] || {};
      return {
        id,
        label: game.i18n.localize(`SWORD.Skills.${id}`),
        selected: s.mestiereSkills.includes(id),
        costLabel: String(cost),
        disabled: false,
        needsSpecialty: VARIES_SKILLS.has(id),
        specialtyName: spec.name || "",
        specialtyChar: spec.char || "mens",
        characteristicOptions: charOptionsList.map(o => ({ ...o, selected: o.key === (spec.char || "mens") }))
      };
    });
    context.mestierePicksUsed = this._mestierePicksUsed;

    context.freeSkillOptions = mestierePool.map(({ id, cost }) => {
      const isKnown = BASE_SKILLS.includes(id) || s.mestiereSkills.includes(id);
      const spec = s.specialties[id] || {};
      return {
        id,
        label: game.i18n.localize(`SWORD.Skills.${id}`),
        selected: s.freeSkills.includes(id),
        effect: isKnown ? "+1" : "Nuovo",
        costLabel: String(cost),
        needsSpecialty: VARIES_SKILLS.has(id),
        specialtyName: spec.name || "",
        specialtyChar: spec.char || "mens",
        characteristicOptions: charOptionsList.map(o => ({ ...o, selected: o.key === (spec.char || "mens") }))
      };
    });
    context.freePicksUsed = this._freePicksUsed;
    context.freePicksTotal = this._freePicksTotal;

    const knownSkills = this._knownSkills;
    const trainableSkills = [...knownSkills].map(id => ({
      id,
      label: game.i18n.localize(`SWORD.Skills.${id}`),
      focusEligible: s.mestiereSkills.includes(id)
    })).sort((a, b) => a.label.localeCompare(b.label));

    const freeRaised = new Set(
      s.freeSkills.filter(id => BASE_SKILLS.includes(id) || s.mestiereSkills.includes(id))
    );
    s.grade3 = s.grade3.map(id => knownSkills.has(id) ? id : "");
    s.grade2 = s.grade2.map(id => (knownSkills.has(id) && !freeRaised.has(id)) ? id : "");

    context.grade3Slots = s.grade3.map((selected, index) => {
      const otherG3 = s.grade3.filter((v, i) => i !== index && v);
      const options = trainableSkills.filter(sk => !otherG3.includes(sk.id) || sk.id === selected);
      return { index, selected, options };
    });

    const alreadyGrade2 = new Set(
      s.freeSkills.filter(id => BASE_SKILLS.includes(id) || s.mestiereSkills.includes(id))
    );

    const grade3Set = new Set(s.grade3.filter(v => v));
    context.grade2Slots = s.grade2.map((selected, index) => {
      const otherG2 = s.grade2.filter((v, i) => i !== index && v);
      const options = trainableSkills.filter(sk =>
        !grade3Set.has(sk.id) &&
        !alreadyGrade2.has(sk.id) &&
        (!otherG2.includes(sk.id) || sk.id === selected)
      );
      return { index, selected, options };
    });

    const simSkills = {};
    for (const id of Object.keys(SKILL_MAP)) {
      let grade = 0;
      if (BASE_SKILLS.includes(id)) grade = 1;
      if (s.mestiereSkills.includes(id)) grade = 1;
      if (s.freeSkills.includes(id)) grade = grade >= 1 ? 2 : 1;
      if (s.grade2.includes(id) && grade < 2) grade = 2;
      if (s.grade3.includes(id)) grade = 3;
      simSkills[id] = { grade };
    }
    context.talentPreview = Object.entries(TALENT_DEFS)
      .filter(([_, def]) => checkTalentUnlocked(def, simSkills))
      .map(([id, def]) => ({ id, name: def.name, category: def.category, grade: def.grade }));
    context.talentPreviewCount = context.talentPreview.length;

    context.skillWarnings = this._detectSkillWarnings();
  }

  _prepareRetaggioContext(context) {
    const s = this._state;

    context.retaggioAvailable = this._retaggioAvailable;
    context.tentazione = s.tentazione;
    context.tentazioneOptions = [
      "accidia", "avidita", "gola", "invidia", "ira", "lussuria", "superbia"
    ].map(id => ({
      id,
      label: game.i18n.localize(`SWORD.Tentazioni.${id}`),
      selected: s.tentazione === id
    }));
    context.eventsUsed = s.events.filter(e => e.type).length;

    const usedEventTypes = new Set(s.events.filter(e => e.type).map(e => e.type));

    const slotCount = Math.max(this._retaggioAvailable, s.events.length, 1);
    context.eventSlots = [];
    for (let i = 0; i < slotCount; i++) {
      const ev = s.events[i] || { type: "", note: "", picks: [], mode: null, valoreKey: null };
      const selected = ev.type || "";
      const def = selected ? EVENT_DEFS[selected] : null;

      const slotData = {
        index: i,
        selected,
        note: ev.note || "",
        needsSkillPicks: false,
        hasMode: false,
        isEsperienza: false,
        isPercorsoSpirituale: false,
        pickOptions: [],
        picksCount: 0,
        pickMax: 0,
        modes: null,
        currentMode: ev.mode || null,
        valoreOptions: [],
        currentValoreKey: ev.valoreKey || "",
        effectLabel: null
      };

      if (def) {
        if (def.modes) {
          slotData.hasMode = true;
          slotData.currentMode = ev.mode || null;
          slotData.modes = Object.keys(def.modes).map(modeId => ({
            id: modeId,
            label: game.i18n.localize(`SWORD.Creation.EventMode.${modeId}`),
            selected: ev.mode === modeId
          }));
          if (ev.mode && def.modes[ev.mode]) {
            const modeDef = def.modes[ev.mode];
            slotData.needsSkillPicks = true;
            slotData.pickMax = modeDef.pickCount;
            slotData.picksCount = (ev.picks || []).length;
            slotData.pickOptions = modeDef.pickFrom.map(id => ({
              id,
              label: game.i18n.localize(`SWORD.Skills.${id}`),
              selected: (ev.picks || []).includes(id)
            }));
          }
        } else if (def.pickFrom) {
          slotData.needsSkillPicks = true;
          slotData.pickMax = def.pickCount;
          slotData.picksCount = (ev.picks || []).length;
          slotData.pickOptions = def.pickFrom.map(id => ({
            id,
            label: game.i18n.localize(`SWORD.Skills.${id}`),
            selected: (ev.picks || []).includes(id)
          }));
        }

        if (def.effect === "training") {
          slotData.isEsperienza = true;
        }

        if (def.valorePickRequired) {
          slotData.isPercorsoSpirituale = true;
          const axes = [["fides", "impietas"], ["honor", "ego"], ["superstitio", "ratio"]];
          const valoreOpts = [];
          for (const [left, right] of axes) {
            const leftVal = s.valori[left];
            const rightVal = s.valori[right];
            if (leftVal > 0) {
              valoreOpts.push({ key: left, label: game.i18n.localize(`SWORD.Valori.${left}`) });
            } else if (rightVal > 0) {
              valoreOpts.push({ key: right, label: game.i18n.localize(`SWORD.Valori.${right}`) });
            } else {
              valoreOpts.push({ key: left, label: game.i18n.localize(`SWORD.Valori.${left}`) });
              valoreOpts.push({ key: right, label: game.i18n.localize(`SWORD.Valori.${right}`) });
            }
          }
          slotData.valoreOptions = valoreOpts;
          slotData.currentValoreKey = ev.valoreKey || "";
        }

        if (def.effect === "flag") slotData.effectLabel = game.i18n.localize("SWORD.Creation.EventEffect.flag");
        if (def.effect === "riflessi_bonus") slotData.effectLabel = game.i18n.localize("SWORD.Creation.EventEffect.riflessi");
        if (def.effect === "fama_bonus") slotData.effectLabel = game.i18n.localize("SWORD.Creation.EventEffect.fama");
      }

      context.eventSlots.push(slotData);
    }

    const hasEsperienza = s.events.some(e => e.type === "esperienza");
    if (hasEsperienza) {
      const knownSkills = this._knownSkills;
      const trainableSkills = [...knownSkills].map(id => ({
        id,
        label: game.i18n.localize(`SWORD.Skills.${id}`),
        focusEligible: s.mestiereSkills.includes(id)
      })).sort((a, b) => a.label.localeCompare(b.label));

      const freeRaised = new Set(
        s.freeSkills.filter(id => BASE_SKILLS.includes(id) || s.mestiereSkills.includes(id))
      );
      const grade3Set = new Set(s.grade3.filter(v => v));
      const grade2Set = new Set(s.grade2.filter(v => v));

      s.espGrade3 = s.espGrade3.map(id => knownSkills.has(id) ? id : "");
      s.espGrade2 = s.espGrade2.map(id => knownSkills.has(id) ? id : "");

      const espG3Set = new Set(s.espGrade3.filter(v => v));
      const espG2Set = new Set(s.espGrade2.filter(v => v));

      context.espGrade3Slots = s.espGrade3.map((selected, index) => {
        const otherEspG3 = s.espGrade3.filter((v, i) => i !== index && v);
        const options = trainableSkills.filter(sk =>
          !grade3Set.has(sk.id) &&
          !grade2Set.has(sk.id) &&
          !freeRaised.has(sk.id) &&
          !espG2Set.has(sk.id) &&
          (!otherEspG3.includes(sk.id) || sk.id === selected)
        );
        return { index, selected, options };
      });

      context.espGrade2Slots = s.espGrade2.map((selected, index) => {
        const otherEspG2 = s.espGrade2.filter((v, i) => i !== index && v);
        const options = trainableSkills.filter(sk =>
          !grade3Set.has(sk.id) &&
          !grade2Set.has(sk.id) &&
          !freeRaised.has(sk.id) &&
          !espG3Set.has(sk.id) &&
          (!otherEspG2.includes(sk.id) || sk.id === selected)
        );
        return { index, selected, options };
      });
    }

    context.eventTypes = EVENT_TYPES.map(id => ({
      id,
      label: game.i18n.localize(`SWORD.Creation.EventTypes.${id}`)
    }));
    context.eventSlots.forEach((slot, i) => {
      slot.eventTypeOptions = EVENT_TYPES.map(id => ({
        id,
        label: game.i18n.localize(`SWORD.Creation.EventTypes.${id}`),
        disabled: id !== slot.selected && usedEventTypes.has(id),
        selected: id === slot.selected
      }));
    });
  }

  _prepareEquipmentContext(context) {
    const s = this._state;

    context.wealthDisplay = this._formatWealth(s.wealth);
    context.equipMode = s.equipMode;
    context.hasMilitare = this._hasCultureTrait("militare");
    context.hasLaboriosa = this._hasCultureTrait("laboriosa");

    const cartTotal = this._cartTotal;
    const remaining = s.wealth - cartTotal;

    context.cartItems = s.cart.map(entry => {
      let label, unitCost;
      if (entry.type === "weapon") {
        const w = WEAPONS.find(x => x.weaponId === entry.itemId);
        label = w?.label; unitCost = w?.costDenari ?? 0;
      } else if (entry.type === "shield") {
        const sh = SHIELDS.find(x => x.shieldId === entry.itemId);
        label = sh?.label; unitCost = sh?.costDenari ?? 0;
      } else if (entry.type === "armor") {
        const a = ARMOR.find(x => x.armorId === entry.itemId);
        label = a?.label; unitCost = a?.costDenari ?? 0;
      } else {
        const g = GEAR.find(x => x.gearId === entry.itemId);
        label = g?.label; unitCost = g?.costDenari ?? 0;
      }
      return {
        type: entry.type,
        itemId: entry.itemId,
        label: label ?? entry.itemId,
        qty: entry.qty,
        costDisplay: denariToDisplay(unitCost * entry.qty),
        militareTag: context.hasMilitare && (entry.type === "weapon" || entry.type === "armor")
      };
    });

    context.cartTotalDisplay = this._formatWealth(cartTotal);
    context.remaining = remaining;
    context.remainingDisplay = remaining >= 0
      ? this._formatWealth(remaining)
      : "−" + this._formatWealth(-remaining);
    context.overBudget = remaining < 0;

    if (s.equipMode === "manual") {
      const cartSet = new Set(s.cart.map(c => `${c.type}:${c.itemId}`));

      const weaponsByCategory = {};
      for (const w of WEAPONS) {
        if (!weaponsByCategory[w.category]) weaponsByCategory[w.category] = [];
        weaponsByCategory[w.category].push({
          type: "weapon", itemId: w.weaponId, label: w.label,
          costDisplay: w.costDisplay, costDenari: w.costDenari,
          inCart: cartSet.has(`weapon:${w.weaponId}`),
          affordable: remaining >= w.costDenari
        });
      }
      context.weaponCategories = Object.entries(weaponsByCategory).map(([catId, items]) => ({
        id: catId, label: game.i18n.localize(`SWORD.WeaponCategories.${catId}`), items
      }));

      context.shieldItems = SHIELDS.map(sh => ({
        type: "shield", itemId: sh.shieldId, label: sh.label,
        costDisplay: sh.costDisplay, costDenari: sh.costDenari,
        inCart: cartSet.has(`shield:${sh.shieldId}`),
        affordable: remaining >= sh.costDenari
      }));

      context.armorItems = ARMOR.map(a => ({
        type: "armor", itemId: a.armorId, label: a.label,
        costDisplay: a.costDisplay, costDenari: a.costDenari,
        inCart: cartSet.has(`armor:${a.armorId}`),
        affordable: remaining >= a.costDenari
      }));

      const gearByCategory = {};
      for (const g of GEAR) {
        if (!gearByCategory[g.gearCategory]) gearByCategory[g.gearCategory] = [];
        gearByCategory[g.gearCategory].push({
          type: "gear", itemId: g.gearId, label: g.label,
          costDisplay: g.costDisplay, costDenari: g.costDenari,
          affordable: remaining >= g.costDenari
        });
      }
      context.gearCategories = Object.entries(gearByCategory).map(([catId, items]) => ({
        id: catId, label: game.i18n.localize(`SWORD.GearCategories.${catId}`), items
      }));
    }
  }

  _canAdvance() {
    const s = this._state;
    switch (s.step) {
      case 1: return true; // ceto always selected
      case 2: return this._charPointsUsed === CHAR_POINTS_TARGET;
      case 3: {
        // Culture: both traits chosen, different, skill picks complete
        if (!s.cultureTrait1 || !s.cultureTrait2) return false;
        if (s.cultureTrait1 === s.cultureTrait2) return false;
        if (!s.trait1Skill || !s.trait2Skill) return false;
        // Cortese advantage pick required if either trait is cortese
        const hasCortese = s.cultureTrait1 === "cortese" || s.cultureTrait2 === "cortese";
        if (hasCortese && !s.corteseAdvSkill) return false;
        return true;
      }
      case 4: return true; // read-only derived stats
      case 5: return this._mestierePicksUsed === 6 &&
                     this._freePicksUsed === this._freePicksTotal &&
                     s.grade3.filter(v => v).length === 2 &&
                     s.grade2.filter(v => v).length === 8;
      case 6: return this._valoriTotal <= this._valoriMax;
      case 7: {
        const eventsUsed = s.events.filter(e => e.type).length;
        if (eventsUsed > this._retaggioAvailable) return false;
        // Validate all selected events have complete sub-choices
        for (const ev of s.events) {
          if (!ev.type) continue;
          const def = EVENT_DEFS[ev.type];
          if (!def) continue;

          if (def.modes) {
            // Apprendistato: mode must be selected + correct pick count
            if (!ev.mode) return false;
            const modeDef = def.modes[ev.mode];
            if (!modeDef) return false;
            if ((ev.picks || []).length !== modeDef.pickCount) return false;
          } else if (def.pickFrom) {
            if ((ev.picks || []).length !== def.pickCount) return false;
          }

          if (def.valorePickRequired && !ev.valoreKey) return false;

          if (def.effect === "training") {
            if (s.espGrade3.some(v => !v) || s.espGrade2.some(v => !v)) return false;
          }
        }
        return true;
      }
      case 8: return this._cartTotal <= this._state.wealth;
      default: return false;
    }
  }

  _validationMessage() {
    const s = this._state;
    switch (s.step) {
      case 2:
        if (this._charPointsUsed !== CHAR_POINTS_TARGET)
          return game.i18n.localize("SWORD.Creation.ValidationCharPoints");
        break;
      case 3:
        if (!s.cultureTrait1 || !s.cultureTrait2 || s.cultureTrait1 === s.cultureTrait2 ||
            !s.trait1Skill || !s.trait2Skill)
          return game.i18n.localize("SWORD.Creation.ValidationCulture");
        if ((s.cultureTrait1 === "cortese" || s.cultureTrait2 === "cortese") && !s.corteseAdvSkill)
          return game.i18n.localize("SWORD.Creation.ValidationCulture");
        break;
      case 5:
        if (this._mestierePicksUsed !== 6)
          return game.i18n.localize("SWORD.Creation.ValidationMestiere");
        if (this._freePicksUsed !== this._freePicksTotal)
          return game.i18n.localize("SWORD.Creation.ValidationFreePicks");
        if (s.grade3.filter(v => v).length < 2 || s.grade2.filter(v => v).length < 8)
          return game.i18n.localize("SWORD.Creation.ValidationTraining");
        break;
      case 7:
        if (s.events.filter(e => e.type).length > this._retaggioAvailable)
          return game.i18n.localize("SWORD.Creation.ValidationRetaggio");
        for (const ev of s.events) {
          if (!ev.type) continue;
          const def = EVENT_DEFS[ev.type];
          if (!def) continue;
          const label = game.i18n.localize(`SWORD.Creation.EventTypes.${ev.type}`);
          if (def.modes && !ev.mode)
            return game.i18n.format("SWORD.Creation.ValidationEventMode", { event: label });
          if (def.modes && ev.mode) {
            const modeDef = def.modes[ev.mode];
            if (modeDef && (ev.picks || []).length !== modeDef.pickCount)
              return game.i18n.format("SWORD.Creation.ValidationEventPicks", { event: label });
          } else if (def.pickFrom && (ev.picks || []).length !== def.pickCount)
            return game.i18n.format("SWORD.Creation.ValidationEventPicks", { event: label });
          if (def.valorePickRequired && !ev.valoreKey)
            return game.i18n.format("SWORD.Creation.ValidationEventValore", { event: label });
          if (def.effect === "training" && (s.espGrade3.some(v => !v) || s.espGrade2.some(v => !v)))
            return game.i18n.localize("SWORD.Creation.ValidationEsperienza");
        }
        break;
    }
    return null;
  }

  // --- Actions ---

  static #onSelectCeto(event, target) {
    this._state.ceto = target.dataset.ceto;
    // Reset skills when ceto changes since availability changes
    this._state.mestiereSkills = [];
    this._state.freeSkills = [];
    this._state.grade3 = ["", ""];
    this._state.grade2 = Array(8).fill("");
    this._state.wealth = 0;
    this._state.wealthBase = 0;
    this._state.wealthRolled = false;
    this._state.cart = [];
    this.render();
  }

  static #onCharInc(event, target) {
    const key = target.dataset.char;
    if (this._state.chars[key] < 13) {
      this._state.chars[key]++;
      this.render();
    }
  }

  static #onCharDec(event, target) {
    const key = target.dataset.char;
    if (this._state.chars[key] > 5) {
      this._state.chars[key]--;
      this.render();
    }
  }

  static #onSetCultureTrait(event, target) {
    const which = target.dataset.action; // setCultureTrait1 or setCultureTrait2
    const field = which === "setCultureTrait1" ? "cultureTrait1" : "cultureTrait2";
    const skillField = which === "setCultureTrait1" ? "trait1Skill" : "trait2Skill";
    const oldValue = this._state[field];
    if (oldValue === target.value) return; // no change — keep dependent picks
    this._state[field] = target.value;
    // Reset skill pick when trait changes
    this._state[skillField] = "";
    // Reset cortese advantage if neither trait is cortese anymore
    if (oldValue === "cortese" || target.value === "cortese") {
      const hasCortese = this._state.cultureTrait1 === "cortese" || this._state.cultureTrait2 === "cortese";
      if (!hasCortese) this._state.corteseAdvSkill = "";
    }
    // Reset valori when culture changes (allowed axes may change)
    this._state.valori = { fides: 0, impietas: 0, honor: 0, ego: 0, superstitio: 0, ratio: 0 };
    this._recomputeRolledWealth();
    this.render();
  }

  static #onSetTraitSkill(event, target) {
    const which = target.dataset.action; // setTrait1Skill or setTrait2Skill
    const field = which === "setTrait1Skill" ? "trait1Skill" : "trait2Skill";
    this._state[field] = target.value;
    this.render();
  }

  static #onSetCorteseAdvSkill(event, target) {
    this._state.corteseAdvSkill = target.value;
    this.render();
  }

  static #onToggleMestiere(event, target) {
    const id = target.dataset.skill;
    const idx = this._state.mestiereSkills.indexOf(id);
    const hasUrbana = this._hasCultureTrait("urbana");
    if (idx >= 0) {
      this._state.mestiereSkills.splice(idx, 1);
    } else {
      // Check if we have room
      const costIfAdded = this._mestierePicksUsed + (mestiereCost(id, this._state.ceto, hasUrbana) || 1);
      if (costIfAdded <= 6) {
        this._state.mestiereSkills.push(id);
      }
    }
    this.render();
  }

  static #onToggleFreeSkill(event, target) {
    const id = target.dataset.skill;
    const idx = this._state.freeSkills.indexOf(id);
    const hasUrbana = this._hasCultureTrait("urbana");
    const cost = mestiereCost(id, this._state.ceto, hasUrbana) || 1;
    if (idx >= 0) {
      this._state.freeSkills.splice(idx, 1);
    } else if (this._freePicksUsed + cost <= this._freePicksTotal) {
      this._state.freeSkills.push(id);
    }
    this.render();
  }

  static #onSetSpecialtyName(event, target) {
    const id = target.dataset.skill;
    if (!this._state.specialties[id]) this._state.specialties[id] = { name: "", char: "mens" };
    this._state.specialties[id].name = target.value.trim();
  }

  static #onSetSpecialtyChar(event, target) {
    const id = target.dataset.skill;
    if (!this._state.specialties[id]) this._state.specialties[id] = { name: "", char: "mens" };
    this._state.specialties[id].char = target.value;
  }

  static #onSetGrade3(event, target) {
    const slot = parseInt(target.dataset.slot);
    this._state.grade3[slot] = target.value;
    this.render();
  }

  static #onSetGrade2(event, target) {
    const slot = parseInt(target.dataset.slot);
    this._state.grade2[slot] = target.value;
    this.render();
  }

  static #onValoreInc(event, target) {
    const key = target.dataset.valore;
    const v = this._state.valori;
    if (v[key] >= 3) return;
    if (this._valoriTotal >= this._valoriMax) return;
    // Enforce culture constraint: only allowed valori can be incremented
    const allowed = getCultureAllowedValori(this._state.cultureTrait1, this._state.cultureTrait2);
    if (!allowed.has(key)) return;
    // Enforce one-per-axis: block if opposite side is chosen
    const axes = [["fides", "impietas"], ["honor", "ego"], ["superstitio", "ratio"]];
    for (const [a, b] of axes) {
      if (key === a && v[b] > 0) return;
      if (key === b && v[a] > 0) return;
    }
    v[key]++;
    this.render();
  }

  static #onValoreDec(event, target) {
    const key = target.dataset.valore;
    if (this._state.valori[key] > 0) {
      this._state.valori[key]--;
      this.render();
    }
  }

  static #onSetTentazione(event, target) {
    this._state.tentazione = target.value;
    this.render();
  }

  static #onSetEvent(event, target) {
    const slot = parseInt(target.dataset.slot);
    while (this._state.events.length <= slot) this._state.events.push({ type: "", note: "", picks: [], mode: null, valoreKey: null });
    const oldType = this._state.events[slot].type;
    const newType = target.value;
    this._state.events[slot].type = newType;
    // Reset sub-choices when type changes
    if (oldType !== newType) {
      this._state.events[slot].picks = [];
      this._state.events[slot].mode = null;
      this._state.events[slot].valoreKey = null;
    }
    // Reset Esperienza training when deselecting it
    if (oldType === "esperienza" && newType !== "esperienza") {
      this._state.espGrade3 = [""];
      this._state.espGrade2 = ["", ""];
    }
    this._recomputeRolledWealth();
    this.render();
  }

  static #onSetEventNote(event, target) {
    const slot = parseInt(target.dataset.slot);
    while (this._state.events.length <= slot) this._state.events.push({ type: "", note: "", picks: [], mode: null, valoreKey: null });
    this._state.events[slot].note = target.value;
    // Don't re-render on note changes to avoid losing focus
  }

  static #onSetEventPick(event, target) {
    const slot = parseInt(target.dataset.slot);
    const skillId = target.dataset.skill;
    const ev = this._state.events[slot];
    if (!ev) return;
    const def = EVENT_DEFS[ev.type];
    if (!def) return;

    // Determine pickCount and pickFrom based on mode (for Apprendistato) or def
    let pickFrom, pickCount;
    if (def.modes) {
      const modeDef = def.modes[ev.mode];
      if (!modeDef) return;
      pickFrom = modeDef.pickFrom;
      pickCount = modeDef.pickCount;
    } else {
      pickFrom = def.pickFrom;
      pickCount = def.pickCount;
    }
    if (!pickFrom || !pickFrom.includes(skillId)) return;

    const idx = ev.picks.indexOf(skillId);
    if (idx >= 0) {
      ev.picks.splice(idx, 1);
    } else if (ev.picks.length < pickCount) {
      ev.picks.push(skillId);
    }
    this.render();
  }

  static #onSetEventMode(event, target) {
    const slot = parseInt(target.dataset.slot);
    const mode = target.dataset.mode;
    const ev = this._state.events[slot];
    if (!ev) return;
    if (ev.mode !== mode) {
      ev.mode = mode;
      ev.picks = []; // Reset picks when switching mode
    }
    this.render();
  }

  static #onSetEventValore(event, target) {
    const slot = parseInt(target.dataset.slot);
    const ev = this._state.events[slot];
    if (!ev) return;
    ev.valoreKey = target.value || null;
    this.render();
  }

  static #onSetEspGrade3(event, target) {
    const slot = parseInt(target.dataset.slot);
    this._state.espGrade3[slot] = target.value;
    this.render();
  }

  static #onSetEspGrade2(event, target) {
    const slot = parseInt(target.dataset.slot);
    this._state.espGrade2[slot] = target.value;
    this.render();
  }

  static #onAddToCart(event, target) {
    const type = target.dataset.type;
    const itemId = target.dataset.itemId;
    const existing = this._state.cart.find(c => c.type === type && c.itemId === itemId);
    if (type === "gear") {
      // Gear items stack (increment qty)
      if (existing) existing.qty += 1;
      else this._state.cart.push({ type, itemId, qty: 1 });
    } else {
      // Weapons, shields, armor: only one of each
      if (!existing) this._state.cart.push({ type, itemId, qty: 1 });
    }
    this.render();
  }

  static #onRemoveFromCart(event, target) {
    const type = target.dataset.type;
    const itemId = target.dataset.itemId;
    const idx = this._state.cart.findIndex(c => c.type === type && c.itemId === itemId);
    if (idx < 0) return;
    const entry = this._state.cart[idx];
    if (entry.qty > 1) entry.qty -= 1;
    else this._state.cart.splice(idx, 1);
    this.render();
  }

  static #onSetEquipMode(event, target) {
    this._state.equipMode = target.dataset.mode;
    this.render();
  }

  static #onRandomEquipment(event, target) {
    this._state.cart = this._generateRandomEquipment();
    this.render();
  }

  static async #onRerollWealth(event, target) {
    await this._rollWealth();
    this.render();
  }

  static #onBack(event, target) {
    if (this._state.step > 1) {
      this._state.step--;
      this.render();
    }
  }

  static async #onNext(event, target) {
    if (this._canAdvance() && this._state.step < 8) {
      this._state.step++;
      // Roll starting wealth when entering equipment step
      if (this._state.step === 8 && !this._state.wealthRolled) {
        await this._rollWealth();
      }
      this.render();
    }
  }

  static async #onFinish(event, target) {
    // Re-entry guard: a double-click would create starting equipment twice
    if (this._finishing) return;
    this._finishing = true;
    try {
      await this.#doFinish();
    } finally {
      this._finishing = false;
    }
  }

  async #doFinish() {
    const s = this._state;
    const mod = this._mod;

    // Build the skill grades map
    const skillUpdates = {};
    const allSkillIds = Object.keys(SKILL_MAP);

    for (const id of allSkillIds) {
      let grade = 0;

      // Base skills start at 1
      if (BASE_SKILLS.includes(id)) grade = 1;
      // Mestiere skills start at 1
      if (s.mestiereSkills.includes(id)) grade = 1;
      // Free skills: new at 1, or existing +1
      if (s.freeSkills.includes(id)) {
        grade = grade >= 1 ? 2 : 1;
      }
      // Training: grade 2
      if (s.grade2.includes(id) && grade < 2) grade = 2;
      // Training: grade 3
      if (s.grade3.includes(id)) grade = 3;

      skillUpdates[`system.skills.${id}.grade`] = grade;
      skillUpdates[`system.skills.${id}.baseGrade`] = grade;
      skillUpdates[`system.skills.${id}.isMestiere`] = s.mestiereSkills.includes(id);

      // Write specialty for artigiano/professione
      if (s.specialties[id]) {
        skillUpdates[`system.skills.${id}.specialty`] = s.specialties[id].name || "";
        skillUpdates[`system.skills.${id}.specialtyChar`] = s.specialties[id].char || "";
      }
    }

    // --- Apply retaggio event effects ---
    let fameBonus = 0;
    let spiritoBonus = 0;
    let riflessiBonus = 0;
    const valoriUpdates = {};
    const retaggioFlags = {
      indomito: false,
      affinitaAnimale: false,
      conoscenze: false,
      nomea: false,
      legame: "",
      cimelio: ""
    };

    for (const ev of s.events) {
      if (!ev.type) continue;
      const def = EVENT_DEFS[ev.type];
      if (!def) continue;

      if (def.effect === "extraDice") {
        // Determine amount and picks based on mode or def
        let amount, picks;
        if (def.modes && ev.mode && def.modes[ev.mode]) {
          amount = def.modes[ev.mode].extraDiceAmount;
          picks = ev.picks || [];
        } else {
          amount = def.extraDiceAmount || 0;
          picks = ev.picks || [];
        }
        for (const skillId of picks) {
          const key = `system.skills.${skillId}.extraDice`;
          skillUpdates[key] = (skillUpdates[key] || 0) + amount;
        }
      }

      if (def.effect === "training") {
        // Esperienza: apply espGrade3 and espGrade2 selections
        for (const skillId of s.espGrade3) {
          if (!skillId) continue;
          skillUpdates[`system.skills.${skillId}.grade`] = 3;
          skillUpdates[`system.skills.${skillId}.baseGrade`] = 3;
        }
        for (const skillId of s.espGrade2) {
          if (!skillId) continue;
          const currentGrade = skillUpdates[`system.skills.${skillId}.grade`] || 0;
          if (currentGrade < 2) {
            skillUpdates[`system.skills.${skillId}.grade`] = 2;
            skillUpdates[`system.skills.${skillId}.baseGrade`] = 2;
          }
        }
      }

      if (def.effect === "fama_bonus") fameBonus += def.bonus;
      if (def.effect === "spirito_bonus") {
        spiritoBonus += def.bonus;
        if (ev.valoreKey) {
          valoriUpdates[ev.valoreKey] = (s.valori[ev.valoreKey] || 0) + 1;
        }
      }
      if (def.effect === "riflessi_bonus") riflessiBonus += def.bonus;

      // Flag events
      if (ev.type === "indomito") retaggioFlags.indomito = true;
      if (ev.type === "affinita_animale") retaggioFlags.affinitaAnimale = true;
      if (ev.type === "conoscenze") retaggioFlags.conoscenze = true;
      if (ev.type === "nomea") retaggioFlags.nomea = true;
      if (ev.type === "legame") retaggioFlags.legame = ev.note || "Legame";
      if (ev.type === "cimelio") retaggioFlags.cimelio = ev.note || "Cimelio";
    }

    // --- Apply culture effects ---
    // Extra dice from trait skill picks
    for (const skillId of [s.trait1Skill, s.trait2Skill]) {
      if (skillId) {
        const key = `system.skills.${skillId}.extraDice`;
        skillUpdates[key] = (skillUpdates[key] || 0) + 1;
      }
    }
    // Cortese advantage: extra die in 1 of 3 skills
    if (s.corteseAdvSkill) {
      const key = `system.skills.${s.corteseAdvSkill}.extraDice`;
      skillUpdates[key] = (skillUpdates[key] || 0) + 1;
    }
    // Meticcio advantage: extra die in storia_e_leggende + usi_e_costumi
    if (this._hasCultureTrait("meticcio")) {
      skillUpdates["system.skills.storia_e_leggende.extraDice"] =
        (skillUpdates["system.skills.storia_e_leggende.extraDice"] || 0) + 1;
      skillUpdates["system.skills.usi_e_costumi.extraDice"] =
        (skillUpdates["system.skills.usi_e_costumi.extraDice"] || 0) + 1;
    }
    // Rurale advantage: extra die in sopravvivenza + usi_e_costumi
    if (this._hasCultureTrait("rurale")) {
      skillUpdates["system.skills.sopravvivenza.extraDice"] =
        (skillUpdates["system.skills.sopravvivenza.extraDice"] || 0) + 1;
      skillUpdates["system.skills.usi_e_costumi.extraDice"] =
        (skillUpdates["system.skills.usi_e_costumi.extraDice"] || 0) + 1;
    }
    // Tenace advantage: extra die in Forza
    if (this._hasCultureTrait("tenace")) {
      skillUpdates["system.skills.forza.extraDice"] =
        (skillUpdates["system.skills.forza.extraDice"] || 0) + 1;
    }

    // Build actor update
    const update = {
      ...skillUpdates,
      "system.characteristics.fortitudo": s.chars.fortitudo,
      "system.characteristics.celeritas": s.chars.celeritas,
      "system.characteristics.gratia": s.chars.gratia,
      "system.characteristics.mens": s.chars.mens,
      "system.characteristics.prudentia": s.chars.prudentia,
      "system.characteristics.audacia": s.chars.audacia,
      "system.culture.trait1": s.cultureTrait1,
      "system.culture.trait2": s.cultureTrait2,
      "system.ceto": s.ceto,
      "system.fama": CETO_COST[s.ceto] + fameBonus,
      "system.valori.fides": valoriUpdates.fides ?? s.valori.fides,
      "system.valori.impietas": valoriUpdates.impietas ?? s.valori.impietas,
      "system.valori.honor": valoriUpdates.honor ?? s.valori.honor,
      "system.valori.ego": valoriUpdates.ego ?? s.valori.ego,
      "system.valori.superstitio": valoriUpdates.superstitio ?? s.valori.superstitio,
      "system.valori.ratio": valoriUpdates.ratio ?? s.valori.ratio,
      "system.retaggio.total": this._retaggioTotal,
      "system.retaggio.notes": s.events
        .filter(e => e.type)
        .map(e => {
          const label = game.i18n.localize(`SWORD.Creation.EventTypes.${e.type}`);
          return e.note ? `${label}: ${e.note}` : label;
        })
        .join("; "),
      "system.retaggio.spiritoBonus": spiritoBonus,
      "system.retaggio.riflessiBonus": riflessiBonus,
      "system.retaggio.indomito": retaggioFlags.indomito,
      "system.retaggio.affinitaAnimale": retaggioFlags.affinitaAnimale,
      "system.retaggio.conoscenze": retaggioFlags.conoscenze,
      "system.retaggio.nomea": retaggioFlags.nomea,
      "system.retaggio.legame": retaggioFlags.legame,
      "system.retaggio.cimelio": retaggioFlags.cimelio,
      "system.tentazione": s.tentazione,
      "system.creationComplete": true
    };

    const existingLanguages = Array.isArray(this.actor.system.languages) ? [...this.actor.system.languages] : [];
    if (this._hasCultureTrait("meticcio")) {
      const marker = game.i18n.localize("SWORD.Creation.MeticcioExtraLanguage");
      if (!existingLanguages.includes(marker)) existingLanguages.push(marker);
    }
    update["system.languages"] = existingLanguages;

    // Set resource values to their maximums (including retaggio + culture bonuses)
    // Antica: +1 Audacia modifier → +1 spirito max
    const anticaBonus = this._hasCultureTrait("antica") ? 1 : 0;
    // Spirituale: +4 spirito max
    const spiritualeBonus = this._hasCultureTrait("spirituale") ? 4 : 0;
    const spirMax = s.chars.audacia + mod(s.chars.audacia) + (skillUpdates["system.skills.volonta.grade"] || 0) + spiritoBonus + anticaBonus + spiritualeBonus;
    const fatMax = s.chars.fortitudo + s.chars.audacia;
    const ferMax = s.chars.fortitudo + mod(s.chars.fortitudo) + (skillUpdates["system.skills.forza.grade"] || 0);
    const rifMax = s.chars.prudentia + mod(s.chars.celeritas) + riflessiBonus;

    update["system.resources.spirito.value"] = spirMax;
    update["system.resources.fatica.value"] = fatMax;
    update["system.resources.ferite.value"] = ferMax;
    update["system.resources.riflessi.value"] = rifMax;

    // ── Remaining wealth (from equipment shopping in step 8) ──
    const hasMilitare = this._hasCultureTrait("militare");
    const cartSpent = this._cartTotal;
    const remainingDenari = Math.max(0, s.wealth - cartSpent);
    const rLire = Math.floor(remainingDenari / 240);
    const rAfterLire = remainingDenari % 240;
    const rSoldi = Math.floor(rAfterLire / 12);
    const rDenari = rAfterLire % 12;
    update["system.money.lire"] = rLire;
    update["system.money.soldi"] = rSoldi;
    update["system.money.denari"] = rDenari;

    await this.actor.update(update);

    // ── Create equipment items from cart ──
    const itemDataArray = [];
    for (const entry of s.cart) {
      if (entry.type === "weapon") {
        const w = WEAPONS.find(x => x.weaponId === entry.itemId);
        if (!w) continue;
        const pregi = [...w.pregi];
        let quality = "normale";
        if (hasMilitare) {
          quality = "buona";
          if (!pregi.includes("impugnatura_sicura")) pregi.push("impugnatura_sicura");
        }
        itemDataArray.push({
          name: w.label, type: "weapon",
          system: {
            category: w.category, skillId: w.skillId, hands: w.hands,
            costDenari: w.costDenari, costDisplay: w.costDisplay, weight: w.weight,
            damageValue: w.damageValue, damageType: w.damageType,
            parryModifier: w.parryModifier, misura: w.misura,
            pregi, quality, gittata: w.gittata, ricarica: w.ricarica
          }
        });
      } else if (entry.type === "shield") {
        const sh = SHIELDS.find(x => x.shieldId === entry.itemId);
        if (!sh) continue;
        itemDataArray.push({
          name: sh.label, type: "shield",
          system: {
            costDenari: sh.costDenari, costDisplay: sh.costDisplay, weight: sh.weight,
            damageValue: sh.damageValue, parryModifier: sh.parryModifier,
            pregi: [...sh.pregi], quality: "normale"
          }
        });
      } else if (entry.type === "armor") {
        const a = ARMOR.find(x => x.armorId === entry.itemId);
        if (!a) continue;
        const pregi = [...a.pregi];
        let quality = "normale";
        if (hasMilitare) {
          quality = "buona";
          if (!pregi.includes("leggera")) pregi.push("leggera");
        }
        itemDataArray.push({
          name: a.label, type: "armor",
          system: {
            costDenari: a.costDenari, costDisplay: a.costDisplay, weight: a.weight,
            protezione: a.protezione, robustezza: a.robustezza,
            robustezzaCurrent: a.robustezza,
            pregi, quality
          }
        });
      } else if (entry.type === "gear") {
        const g = GEAR.find(x => x.gearId === entry.itemId);
        if (!g) continue;
        itemDataArray.push({
          name: g.label, type: "gear",
          system: {
            gearCategory: g.gearCategory, costDenari: g.costDenari,
            costDisplay: g.costDisplay, weight: g.weight,
            quantity: entry.qty, quality: "normale",
            skillBonusSkillId: g.skillBonusSkillId, description: g.description
          }
        });
      }
    }

    // Cimelio: one starting item is Ottima quality.
    if (retaggioFlags.cimelio && itemDataArray.length > 0) {
      const note = (retaggioFlags.cimelio || "").trim().toLowerCase();
      const qualityEligible = itemDataArray.filter(i => ["weapon", "shield", "armor", "gear"].includes(i.type));
      if (qualityEligible.length > 0) {
        let target = null;
        if (note) {
          target = qualityEligible.find(i =>
            i.name?.toLowerCase().includes(note) ||
            (i.system?.skillBonusSkillId || "").toLowerCase().includes(note)
          );
        }
        if (!target) target = qualityEligible[0];
        target.system.quality = "ottima";
      }
    }
    if (itemDataArray.length > 0) {
      await this.actor.createEmbeddedDocuments("Item", itemDataArray);
    }

    this.close();
  }
}
