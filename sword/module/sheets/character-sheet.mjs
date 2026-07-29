import { SKILL_MAP, TALENT_CATEGORIES, SOCIAL_SKILLS } from "../data/actor.mjs";
import { CULTURE_DEFS } from "../engine.mjs";
import { swordCheckResolve } from "../engine.mjs";
import { resolveRest, resolveMeditation, resolveFattucchiere, computeRestConditionPenalty } from "../engine.mjs";

const CHAR_ORDER = [
  "fortitudo",
  "celeritas",
  "gratia",
  "mens",
  "prudentia",
  "audacia"
];

export class SwordCharacterSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["sword", "sheet", "actor", "character"],
    position: { width: 680, height: 780 },
    dragDrop: [{ dragSelector: "[data-item-id]", dropSelector: null }],
    actions: {
      // Character management
      adjustCharacteristic: SwordCharacterSheet.#onAdjustCharacteristic,
      openWizard: SwordCharacterSheet.#onOpenWizard,
      exportPDF: SwordCharacterSheet.#onExportPDF,
      addLanguage: SwordCharacterSheet.#onAddLanguage,
      deleteLanguage: SwordCharacterSheet.#onDeleteLanguage,
      // Skill checks & foci
      rollSkill: SwordCharacterSheet.#onRollSkill,
      combinedManeuver: SwordCharacterSheet.#onCombinedManeuver,
      addFocus: SwordCharacterSheet.#onAddFocus,
      editSpecialty: SwordCharacterSheet.#onEditSpecialty,
      // Inventory & equipment
      editItem: SwordCharacterSheet.#onEditItem,
      deleteItem: SwordCharacterSheet.#onDeleteItem,
      createItem: SwordCharacterSheet.#onCreateItem,
      adjustQuantity: SwordCharacterSheet.#onAdjustQuantity,
      adjustRobustezza: SwordCharacterSheet.#onAdjustRobustezza,
      adjustResource: SwordCharacterSheet.#onAdjustResource,
      drawWeapon: SwordCharacterSheet.#onDrawWeapon,
      toggleSecondary: SwordCharacterSheet.#onToggleSecondary,
      // Combat actions
      attackWithWeapon: SwordCharacterSheet.#onAttackWithWeapon,
      unarmedAttack: SwordCharacterSheet.#onUnarmedAttack,
      breakFree: SwordCharacterSheet.#onBreakFree,
      rifiatare: SwordCharacterSheet.#onRifiatare,
      attesa: SwordCharacterSheet.#onAttesa,
      studyBattlefield: SwordCharacterSheet.#onStudyBattlefield,
      closeMisura: SwordCharacterSheet.#onCloseMisura,
      reaction: SwordCharacterSheet.#onReaction,
      spendReserve: SwordCharacterSheet.#onSpendReserve,
      // Extended tests & social
      arsOratoria: SwordCharacterSheet.#onArsOratoria,
      sfida: SwordCharacterSheet.#onSfida,
      contacts: SwordCharacterSheet.#onContacts,
      deleteContact: SwordCharacterSheet.#onDeleteContact,
      interlude: SwordCharacterSheet.#onInterlude,
      // Talent & recovery actions
      healing: SwordCharacterSheet.#onHealing,
      inspire: SwordCharacterSheet.#onInspire,
      distributeRiflessi: SwordCharacterSheet.#onDistributeRiflessi,
      companionBoost: SwordCharacterSheet.#onCompanionBoost,
      rest: SwordCharacterSheet.#onRest,
      meditate: SwordCharacterSheet.#onMeditate,
      fattucchiere: SwordCharacterSheet.#onFattucchiere
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    character: {
      template: "systems/sword/templates/actors/character-tab.hbs"
    },
    skills: {
      template: "systems/sword/templates/actors/skills-tab.hbs",
      scrollable: [".skills-list"]
    },
    talents: {
      template: "systems/sword/templates/actors/talents-tab.hbs",
      scrollable: [".talents-list"]
    },
    inventory: {
      template: "systems/sword/templates/actors/inventory-tab.hbs",
      scrollable: [".inventory-list"]
    }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "character", icon: "fa-solid fa-user" },
        { id: "skills", icon: "fa-solid fa-book-open" },
        { id: "talents", icon: "fa-solid fa-star" },
        { id: "inventory", icon: "fa-solid fa-shield-halved" }
      ],
      initial: "character",
      labelPrefix: "SWORD.Tabs"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;

    context.actor = actor;
    // DocumentSheetV2 does not provide `system` to templates; without it the
    // money inputs render empty and submitOnChange nulls the fields on save.
    context.system = system;

    // Characteristics with modifiers and talent bonuses
    context.characteristics = CHAR_ORDER.map((key) => {
      const base = system.characteristics[key];
      const bonus = system.talentCharBonuses?.[key] || 0;
      const effective = system.effectiveCharacteristics?.[key] ?? base;
      const mod = system.modifiers[key];
      const tooltipParts = [`Base: ${base}`];
      if (bonus) tooltipParts.push(`Talento: +${bonus}`);
      return {
        key,
        score: base,
        bonus,
        effectiveScore: effective,
        modified: effective !== base,
        increased: effective > base,
        decreased: effective < base,
        mod,
        label: game.i18n.localize(`SWORD.Characteristics.${key}`),
        tooltip: tooltipParts.join("\n")
      };
    });

    // Skills grouped by characteristic
    context.skillGroups = [];
    for (const charKey of CHAR_ORDER) {
      const skills = [];
      for (const [skillId, charRef] of Object.entries(SKILL_MAP)) {
        if (charRef !== charKey) continue;
        const skillData = system.skills[skillId];
        skills.push({
          id: skillId,
          label: game.i18n.localize(`SWORD.Skills.${skillId}`),
          grade: skillData.grade,
          hasFocus: skillData.hasFocus,
          focusCount: skillData.focusCount,
          focusSlots: skillData.focusSlots,
          foci: skillData.foci || [],
          isMestiere: skillData.isMestiere,
          isOutsideCeto: skillData.isOutsideCeto,
          extraDice: skillData.extraDice,
          charScore: system.effectiveCharacteristics?.[charKey] ?? system.characteristics[charKey],
          nextGradeCost: skillData.nextGradeCost
        });
      }
      skills.sort((a, b) => a.label.localeCompare(b.label));
      if (skills.length) {
        const charScore = system.effectiveCharacteristics?.[charKey] ?? system.characteristics[charKey];
        context.skillGroups.push({
          label: `${game.i18n.localize(`SWORD.Characteristics.${charKey}`)} (${charScore})`,
          charKey,
          skills
        });
      }
    }
    // "Varies" group for artigiano/professione
    const artigianoData = system.skills.artigiano;
    const profData = system.skills.professione;
    context.skillGroups.push({
      label: "Varie",
      charKey: "varies",
      skills: [
        {
          id: "artigiano",
          label: game.i18n.localize("SWORD.Skills.artigiano"),
          grade: artigianoData.grade,
          hasFocus: artigianoData.hasFocus,
          focusCount: artigianoData.focusCount,
          focusSlots: artigianoData.focusSlots,
          foci: artigianoData.foci || [],
          isMestiere: artigianoData.isMestiere,
          isOutsideCeto: artigianoData.isOutsideCeto,
          extraDice: artigianoData.extraDice,
          charScore: null,
          nextGradeCost: artigianoData.nextGradeCost,
          specialty: artigianoData.specialty || "",
          specialtyChar: artigianoData.specialtyChar || "",
          canSpecialize: true
        },
        {
          id: "professione",
          label: game.i18n.localize("SWORD.Skills.professione"),
          grade: profData.grade,
          hasFocus: profData.hasFocus,
          focusCount: profData.focusCount,
          focusSlots: profData.focusSlots,
          foci: profData.foci || [],
          isMestiere: profData.isMestiere,
          isOutsideCeto: profData.isOutsideCeto,
          extraDice: profData.extraDice,
          charScore: null,
          nextGradeCost: profData.nextGradeCost,
          specialty: profData.specialty || "",
          specialtyChar: profData.specialtyChar || "",
          canSpecialize: true
        }
      ]
    });

    // Compact skill summary (alphabetical, read-only, for character tab)
    context.skillSummary = context.skillGroups
      .flatMap(g => g.skills)
      .sort((a, b) => a.label.localeCompare(b.label));

    // Resources
    context.resources = Object.entries(system.resources).map(([key, res]) => ({
      key,
      label: game.i18n.localize(`SWORD.Resources.${key}`),
      value: res.value,
      max: res.max,
      percent: res.max > 0 ? Math.min(100, Math.round((res.value / res.max) * 100)) : 0
    }));

    // Fatigue level
    context.fatigueLevel = system.fatigueLevel || "fresco";
    context.fatiguePenalty = system.fatiguePenalty || 0;

    // Wound levels
    context.woundLevels = system.woundLevels;
    context.woundCapacities = system.woundCapacities;
    context.woundPenalty = system.woundPenalty || 0;
    context.encumbrancePenalty = system.encumbrancePenalty || 0;
    context.movimento = system.movimento ?? 5;

    // Languages
    context.languages = system.languages || [];
    context.languageSlots = system.languageSlots ?? 1;
    context.languagesOver = context.languages.length > context.languageSlots;
    // Determine the highest occupied wound level for highlighting
    const woundKeys = ["graffi", "leggere", "gravi", "critiche", "mortali"];
    let highestActiveWound = -1;
    for (let i = woundKeys.length - 1; i >= 0; i--) {
      if (system.woundLevels[woundKeys[i]] > 0) { highestActiveWound = i; break; }
    }
    context.woundLevelList = woundKeys.map((level, idx) => {
      const current = system.woundLevels[level];
      const max = system.woundCapacities?.[level] ?? 0;
      return {
        key: level,
        label: game.i18n.localize(`SWORD.Wounds.${level}`),
        current, max,
        percent: max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0,
        penalty: level === "gravi" ? 1 : level === "critiche" ? 2 : level === "mortali" ? 3 : 0,
        active: idx === highestActiveWound
      };
    });

    context.fama = system.fama;
    context.hasSenzaVolto = !!system.talentSpecials?.has("reduce_fama_by3");
    context.reducedFama = context.hasSenzaVolto ? Math.max(0, system.fama - 3) : 0;
    context.ceto = system.ceto;
    context.cetoLabel = game.i18n.localize(`SWORD.Ceto.${system.ceto}`);
    context.cetoChoices = {
      umile: game.i18n.localize("SWORD.Ceto.umile"),
      popolano: game.i18n.localize("SWORD.Ceto.popolano"),
      borghese: game.i18n.localize("SWORD.Ceto.borghese"),
      nobile: game.i18n.localize("SWORD.Ceto.nobile")
    };

    // Third cultural trait (Vagabondo talent)
    context.hasThirdCulturalTrait = !!system.talentSpecials?.has("third_cultural_trait");
    context.cultureTrait3 = system.culture?.trait3 || "";
    if (context.hasThirdCulturalTrait) {
      const opts = {};
      for (const id of Object.keys(CULTURE_DEFS)) {
        opts[id] = game.i18n.localize(`SWORD.Cultures.${id}.label`);
      }
      context.cultureTraitOptions = opts;
    }

    // Meditation (Filosofo talent)
    context.hasMeditation = !!system.talentSpecials?.has("meditation_spirito_recovery");
    // Fattucchiere talent
    context.hasFattucchiere = !!system.talentSpecials?.has("fake_magic_superstitio_defense");
    // Ispirare talent (spend_spirito_heal_companions)
    context.hasInspire = !!system.talentSpecials?.has("spend_spirito_heal_companions");
    // Stratega (distribute_riflessi)
    context.hasStratega = !!system.talentSpecials?.has("distribute_riflessi");
    context.strategaPool = 0;
    if (context.hasStratega && game.combat) {
      const combatant = game.combat.resolveCombatant(this.actor);
      context.strategaPool = combatant?.getFlag("sword", "strategaPool") || 0;
    }
    // Compagni fedeli (animal_companion_boost)
    context.hasCompagniFedeli = !!system.talentSpecials?.has("animal_companion_boost");
    // Battipista (travel_distance_bonus) — show km bonus
    context.hasBattipista = !!system.talentSpecials?.has("travel_distance_bonus");
    context.battipistKmBonus = context.hasBattipista ? (system.skills.sopravvivenza?.grade || 0) : 0;
    // Carovaniere (party_travel_bonus)
    context.hasCarovaniere = !!system.talentSpecials?.has("party_travel_bonus");

    // Contacts
    const cetoLabels = { umile: "SWORD.Ceto.umile", popolano: "SWORD.Ceto.popolano", borghese: "SWORD.Ceto.borghese", nobile: "SWORD.Ceto.nobile" };
    context.contacts = (system.contacts || []).map((c, idx) => ({
      ...c,
      index: idx,
      cetoLabel: game.i18n.localize(cetoLabels[c.ceto] || "SWORD.Ceto.popolano"),
      skillLabel: c.skill ? game.i18n.localize(`SWORD.Skills.${c.skill}`) : ""
    }));
    context.hasContacts = context.contacts.length > 0;

    // Success reserve (Condottiero / Tattiche di Guerriglia)
    context.successReserve = 0;
    if (game.combat) {
      const combatant = game.combat.resolveCombatant(this.actor);
      context.successReserve = combatant?.getFlag("sword", "successReserve") || 0;
    }

    // PE data
    context.pe = {
      total: system.pe.total,
      spent: system.pe.spent,
      available: system.pe.available
    };
    context.peNegative = system.pe.available < 0;
    context.studyPEReward = system.talentSpecials?.has("study_3pe") ? 3 : 2;

    // Valori data
    context.valori = {
      fides: system.valori.fides,
      impietas: system.valori.impietas,
      honor: system.valori.honor,
      ego: system.valori.ego,
      superstitio: system.valori.superstitio,
      ratio: system.valori.ratio,
      totalPoints: system.valori.totalPoints,
      maxPoints: system.valori.maxPoints,
      perValueMax: system.valori.perValueMax ?? 3
    };

    // Talents grouped by characteristic
    context.talentGroups = [];
    for (const cat of TALENT_CATEGORIES) {
      const talents = Object.entries(system.talents)
        .filter(([_, t]) => t.category === cat)
        .map(([id, t]) => {
          const skills = system.skills;
          const reqLabels = [];
          const missingReqs = [];
          for (const r of t.requirements) {
            if (r.type === "or") {
              const parts = r.options.map(o =>
                `${game.i18n.localize(`SWORD.Skills.${o.skill}`)} ${o.grade}`
              );
              const label = parts.join(" / ");
              reqLabels.push(label);
              const met = r.options.some(o => (skills[o.skill]?.grade ?? 0) >= o.grade);
              if (!met) missingReqs.push(label);
            } else if (r.type === "choice_any") {
              const parts = r.options.map(o =>
                game.i18n.localize(`SWORD.Skills.${o.skill}`)
              );
              const label = `${r.count} tra: ${parts.join(", ")} ${r.options[0].grade}`;
              reqLabels.push(label);
              const metCount = r.options.filter(o => (skills[o.skill]?.grade ?? 0) >= o.grade).length;
              if (metCount < r.count) missingReqs.push(label);
            } else {
              const label = `${game.i18n.localize(`SWORD.Skills.${r.skill}`)} ${r.grade}`;
              reqLabels.push(label);
              if ((skills[r.skill]?.grade ?? 0) < r.grade) missingReqs.push(label);
            }
          }
          // Choice-based talent data
          let choiceField = null;
          let choiceOptions = null;
          let choiceValue = null;
          if (id === "determinazione" && t.unlocked) {
            choiceField = "system.talentChoices.determinazione";
            choiceOptions = [
              { value: "forza", label: game.i18n.localize("SWORD.Skills.forza") },
              { value: "volonta", label: game.i18n.localize("SWORD.Skills.volonta") }
            ];
            choiceValue = system.talentChoices?.determinazione || "";
          } else if (id === "eponimo" && t.unlocked) {
            choiceField = "system.talentChoices.eponimo";
            choiceOptions = Object.keys(system.skills)
              .sort((a, b) => game.i18n.localize(`SWORD.Skills.${a}`).localeCompare(game.i18n.localize(`SWORD.Skills.${b}`)))
              .map(s => ({ value: s, label: game.i18n.localize(`SWORD.Skills.${s}`) }));
            choiceValue = system.talentChoices?.eponimo || "";
          } else if (id === "ingegno" && t.unlocked) {
            choiceField = "system.talentChoices.ingegno";
            choiceOptions = [
              { value: "mercatura", label: game.i18n.localize("SWORD.Skills.mercatura") },
              { value: "teologia", label: game.i18n.localize("SWORD.Skills.teologia") },
              { value: "usi_e_costumi", label: game.i18n.localize("SWORD.Skills.usi_e_costumi") }
            ];
            choiceValue = system.talentChoices?.ingegno || "";
          }

          return {
            id,
            name: t.name,
            grade: t.grade,
            unlocked: t.unlocked,
            partial: t.partial,
            effectsRaw: t.effectsRaw,
            requirementSummary: reqLabels.join("; "),
            missingSummary: missingReqs.join("; "),
            choiceField,
            choiceOptions,
            choiceValue
          };
        })
        .filter(t => t.unlocked || t.partial)
        .sort((a, b) => {
          // Unlocked first, then partial
          if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
          return a.grade - b.grade || a.name.localeCompare(b.name);
        });
      if (talents.length) {
        const charScore = system.effectiveCharacteristics?.[cat] ?? system.characteristics[cat];
        context.talentGroups.push({
          label: `${game.i18n.localize(`SWORD.Characteristics.${cat}`)} (${charScore})`,
          charKey: cat,
          talents
        });
      }
    }
    context.talentCount = system.talentCount;

    // Talent choices for choice-based talents
    context.talentChoices = system.talentChoices;
    context.talentSpecials = system.talentSpecials;

    // Creation status
    context.creationComplete = system.creationComplete;

    // Culture flags
    context.militareQualityEquipment = system.militareQualityEquipment;

    // ── Inventory data ──
    const items = Array.from(this.actor.items);
    const sortByName = (a, b) => a.name.localeCompare(b.name);

    // Dual wielding: check talent eligibility for secondary hand
    const hasDualWield = system.talentSpecials?.has("free_secondary_attack") || false;
    const hasDualWieldMedium = system.talentSpecials?.has("two_medium_weapons") || false;
    context.hasDualWield = hasDualWield || hasDualWieldMedium;

    context.weapons = items
      .filter(i => i.type === "weapon")
      .sort(sortByName)
      .map(i => {
        // Can be secondary: one-handed + correct misura for talent level
        const isOneHanded = i.system.hands === "una_mano";
        const misura = i.system.misura || "M";
        const isRanged = i.system.gittata != null && i.system.gittata > 0;
        const canBeSecondary = !isRanged && isOneHanded && (
          (hasDualWieldMedium && (misura === "S" || misura === "M")) ||
          (hasDualWield && !hasDualWieldMedium && misura === "S")
        );
        return {
          id: i.id, name: i.name, img: i.img,
          categoryLabel: game.i18n.localize(`SWORD.WeaponCategories.${i.system.category}`),
          handsLabel: game.i18n.localize(`SWORD.Hands.${i.system.hands}`),
          damageValue: i.system.damageValue, damageType: i.system.damageType,
          parryModifier: i.system.parryModifier, weight: i.system.weight,
          isReloading: i.system.reloadTurnsRemaining > 0,
          reloadTurnsRemaining: i.system.reloadTurnsRemaining,
          isSecondary: i.system.isSecondary,
          canBeSecondary,
          isDrawn: i.system.isDrawn
        };
      });

    context.shields = items
      .filter(i => i.type === "shield")
      .sort(sortByName)
      .map(i => ({
        id: i.id, name: i.name, img: i.img,
        damageValue: i.system.damageValue,
        parryModifier: i.system.parryModifier, weight: i.system.weight
      }));

    context.armor = items
      .filter(i => i.type === "armor")
      .sort(sortByName)
      .map(i => ({
        id: i.id, name: i.name, img: i.img,
        protezione: i.system.protezione,
        robustezza: i.system.robustezza, robustezzaCurrent: i.system.robustezzaCurrent,
        weight: i.system.weight
      }));

    context.gear = items
      .filter(i => i.type === "gear")
      .sort(sortByName)
      .map(i => ({
        id: i.id, name: i.name, img: i.img,
        gearCategoryLabel: game.i18n.localize(`SWORD.GearCategories.${i.system.gearCategory}`),
        quantity: i.system.quantity,
        weight: i.system.weight,
        totalWeight: Math.round(i.system.weight * i.system.quantity * 100) / 100
      }));

    // Encumbrance (computed in prepareDerivedData, read from system)
    const maxWeight = system.encumbranceMaxWeight || 1;
    context.encumbrance = {
      totalWeight: system.carriedWeight || 0,
      maxWeight,
      category: system.encumbranceCategory || "leggero",
      penalty: -(system.encumbrancePenalty || 0),
      percent: maxWeight > 0 ? Math.min(100, Math.round(((system.carriedWeight || 0) / maxWeight) * 100)) : 0
    };

    return context;
  }

  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    const tab = partContext.tabs?.[partId];
    if (tab) partContext.tab = tab;
    return partContext;
  }

  // ── Character management ──

  static async #onAdjustCharacteristic(event, target) {
    const key = target.dataset.charKey;
    if (!key) return;
    const current = this.actor.system.characteristics[key];
    const label = game.i18n.localize(`SWORD.Characteristics.${key}`);
    const content = `<form><div class="form-group"><label>${label} (${game.i18n.localize("SWORD.Characteristics.CurrentValue")}: ${current})</label><input type="number" name="value" value="${current}" min="5" max="13" autofocus /></div></form>`;
    const dlg = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${label}` },
      content,
      ok: { callback: (event, button) => {
        const val = parseInt(button.form.elements.value?.value);
        if (!isNaN(val)) return val;
      }}
    });
    if (dlg != null) {
      await this.actor.update({ [`system.characteristics.${key}`]: dlg });
    }
  }

  // ── Skill checks & foci ──

  static #onRollSkill(event, target) {
    const skillId = target.dataset.skillId;
    if (!skillId) return;
    game.sword.rollCheck(this.actor, skillId);
  }

  static async #onCombinedManeuver(event, target) {
    const combinedSkillId = target.dataset.skillId;
    if (!combinedSkillId) return;
    const system = this.actor.system;
    const combinedLabel = game.i18n.localize(`SWORD.Skills.${combinedSkillId}`);

    // Build list of eligible primary skills (grade ≥ 1, not the same skill)
    const primaryOptions = Object.entries(system.skills)
      .filter(([sid, sdata]) => sid !== combinedSkillId && (sdata.grade || 0) >= 1)
      .map(([sid]) => `<option value="${sid}">${game.i18n.localize(`SWORD.Skills.${sid}`)}</option>`)
      .join("");

    if (!primaryOptions) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combined.NoPrimarySkill"));
      return;
    }

    const primarySkillId = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${game.i18n.localize("SWORD.Combined.Label")}: ${combinedLabel}` },
      content: `
        <div class="sword-roll-dialog">
          <p>${game.i18n.localize("SWORD.Combined.PickPrimary")}</p>
          <div class="form-group">
            <label>${game.i18n.localize("SWORD.Combined.PrimarySkill")}</label>
            <select name="primarySkill">${primaryOptions}</select>
          </div>
        </div>
      `,
      ok: {
        label: game.i18n.localize("SWORD.Roll.Submit"),
        icon: "fa-solid fa-dice",
        callback: (event, button) => button.form.elements.primarySkill.value
      }
    });

    if (!primarySkillId) return;
    game.sword.rollCheck(this.actor, primarySkillId, { combinedSkillId });
  }

  static async #onAddFocus(event, target) {
    const skillId = target.dataset.skillId;
    if (!skillId) return;
    const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);
    const focusName = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${game.i18n.localize("SWORD.Focus.Add")} — ${skillLabel}` },
      content: `
        <div class="sword-roll-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("SWORD.Focus.Name")}</label>
            <input type="text" name="focusName" autofocus placeholder="${game.i18n.localize("SWORD.Focus.Placeholder")}" />
          </div>
        </div>
      `,
      ok: {
        label: game.i18n.localize("SWORD.Focus.Confirm"),
        icon: "fa-solid fa-crosshairs",
        callback: (event, button) => button.form.elements.focusName.value.trim()
      }
    });
    if (!focusName) return;
    const currentFoci = this.actor.system.skills[skillId]?.foci || [];
    await this.actor.update({ [`system.skills.${skillId}.foci`]: [...currentFoci, { name: focusName }] });
  }

  static async #onEditSpecialty(event, target) {
    const skillId = target.dataset.skillId;
    if (!skillId) return;
    const skillData = this.actor.system.skills[skillId];
    const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);
    const charOptions = ["fortitudo", "celeritas", "gratia", "mens", "prudentia", "audacia"]
      .map(k => `<option value="${k}" ${k === (skillData?.specialtyChar || "") ? "selected" : ""}>${game.i18n.localize(`SWORD.Characteristics.${k}`)}</option>`)
      .join("");
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${game.i18n.localize("SWORD.Specialty.Label")} — ${skillLabel}` },
      content: `
        <div class="sword-roll-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("SWORD.Specialty.Label")}</label>
            <input type="text" name="specialtyName" autofocus placeholder="${game.i18n.localize("SWORD.Specialty.Placeholder")}" value="${skillData?.specialty || ""}" />
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SWORD.Specialty.CharLabel")}</label>
            <select name="specialtyChar">${charOptions}</select>
          </div>
        </div>
      `,
      ok: {
        label: game.i18n.localize("SWORD.Focus.Confirm"),
        icon: "fa-solid fa-pen",
        callback: (event, button) => ({
          name: button.form.elements.specialtyName.value.trim(),
          char: button.form.elements.specialtyChar.value
        })
      }
    });
    if (!result) return;
    await this.actor.update({
      [`system.skills.${skillId}.specialty`]: result.name,
      [`system.skills.${skillId}.specialtyChar`]: result.char
    });
  }

  // ── Equipment handling ──

  static async #onDrawWeapon(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    const isDrawn = item.system.isDrawn;

    // Sheathing is always free
    if (isDrawn) {
      await item.update({ "system.isDrawn": false });
      return;
    }

    // Drawing outside combat is free
    if (!game.combat) {
      await item.update({ "system.isDrawn": true });
      return;
    }

    // Drawing in combat: costs action or 3 Riflessi (with talent)
    const system = this.actor.system;
    const hasDrawTalent = system.talentSpecials?.has("draw_weapon_3riflessi");
    const hasQuickDraw = system.talentSpecials?.has("quick_draw_armi_corte");
    const isArmiCorte = item.system.skillId === "armi_corte";
    const canDrawForRiflessi = hasDrawTalent || (hasQuickDraw && isArmiCorte);

    let riflessiCost = 3;
    if (system.talentSpecials?.has("riflessi_cost_minus1")) riflessiCost = Math.max(0, riflessiCost - 1);
    const hasEnoughRiflessi = system.resources.riflessi.value >= riflessiCost;
    const hasAction = game.combat.hasActionAvailable(this.actor);

    if (!hasAction && !canDrawForRiflessi) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoActionAvailable"));
      return;
    }
    if (!hasAction && canDrawForRiflessi && !hasEnoughRiflessi) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NotEnoughRiflessi"));
      return;
    }

    // If both options available, let player choose
    let useRiflessi = false;
    if (hasAction && canDrawForRiflessi && hasEnoughRiflessi) {
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("SWORD.Combat.DrawWeapon") },
        content: `<p>${game.i18n.format("SWORD.Combat.DrawWeaponChoice", { weapon: item.name })}</p>`,
        buttons: [
          { action: "action", label: game.i18n.localize("SWORD.Combat.DrawUseAction"), icon: "fa-solid fa-circle-check" },
          { action: "riflessi", label: game.i18n.format("SWORD.Combat.DrawUseRiflessi", { cost: riflessiCost }), icon: "fa-solid fa-bolt" }
        ]
      });
      if (!choice) return;
      useRiflessi = choice === "riflessi";
    } else if (!hasAction && canDrawForRiflessi) {
      useRiflessi = true;
    }

    // Pay cost
    if (useRiflessi) {
      await this.actor.update({
        "system.resources.riflessi.value": system.resources.riflessi.value - riflessiCost
      });
    } else {
      await game.combat.consumeAction(this.actor);
    }

    await item.update({ "system.isDrawn": true });

    // Chat notification
    const costLabel = useRiflessi
      ? `${riflessiCost} ${game.i18n.localize("SWORD.Resources.riflessi")}`
      : game.i18n.localize("SWORD.Combat.ActionSpent");
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.actor }),
      content: `<div class="sword chat-card"><div class="result-section"><div class="damage-line"><i class="fas fa-hand-fist"></i> <strong>${game.i18n.localize("SWORD.Combat.DrawWeapon")}</strong>: ${item.name} (${costLabel})</div></div></div>`
    });
  }

  static async #onToggleSecondary(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    const newVal = !item.system.isSecondary;
    // If toggling ON, clear any other secondary weapon first
    if (newVal) {
      for (const w of this.actor.items.filter(i => i.type === "weapon" && i.id !== itemId && i.system.isSecondary)) {
        await w.update({ "system.isSecondary": false });
      }
    }
    await item.update({ "system.isSecondary": newVal });
  }

  static async #onOpenWizard(event, target) {
    const { SwordCreationWizard } = await import("../apps/creation-wizard.mjs");
    new SwordCreationWizard({ actor: this.actor }).render({ force: true });
  }

  // ── Item management ──

  static #onEditItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.sheet.render({ force: true });
  }

  static async #onDeleteItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Elimina oggetto" },
      content: `<p>${game.i18n.format("SWORD.Inventory.DeleteConfirm", { name: item.name })}</p>`,
      yes: { default: false }
    });
    if (confirmed) await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
  }

  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const typeLabel = game.i18n.localize(`TYPES.Item.${type}`);
    const name = `${game.i18n.localize("SWORD.Inventory.New")} ${typeLabel}`;
    await this.actor.createEmbeddedDocuments("Item", [{ name, type }]);
  }

  // ── Combat actions ──

  static async #onAttackWithWeapon(event, target) {
    const weaponId = target.dataset.itemId;
    if (!weaponId) return;
    game.sword.attack(this.actor, weaponId);
  }

  static async #onUnarmedAttack(event, target) {
    // Small dialog to pick Punch or Kick
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SWORD.Combat.UnarmedAttack") },
      content: `
        <div class="sword-roll-dialog">
          <div class="form-group">
            <label>${game.i18n.localize("SWORD.Combat.StrikeType")}</label>
            <select name="strikeType">
              <option value="punch">${game.i18n.localize("SWORD.Combat.StrikePunch")} (0B)</option>
              <option value="kick">${game.i18n.localize("SWORD.Combat.StrikeKick")} (1B)</option>
            </select>
          </div>
        </div>
      `,
      ok: {
        label: game.i18n.localize("SWORD.Combat.AttackBtn"),
        icon: "fa-solid fa-fist-raised",
        callback: (event, button) => button.form.elements.strikeType.value
      }
    });
    if (!result) return;
    game.sword.attack(this.actor, `unarmed_${result}`);
  }

  static async #onBreakFree(event, target) {
    game.sword.breakFree(this.actor);
  }

  static async #onRifiatare(event, target) {
    game.sword.rifiatare(this.actor);
  }

  static async #onAttesa(event, target) {
    game.sword.attesa(this.actor);
  }

  static async #onStudyBattlefield(event, target) {
    game.sword.studyBattlefield(this.actor);
  }

  static async #onCloseMisura(event, target) {
    game.sword.closeMisura(this.actor);
  }

  static async #onReaction(event, target) {
    game.sword.reaction(this.actor);
  }

  // ── Export & utility ──

  static async #onExportPDF(event, target) {
    const { exportCharacterPDF } = await import("../pdf/pdf-export.mjs");
    await exportCharacterPDF(this.actor);
  }

  // ── Extended tests, social & interludes ──

  static async #onInterlude(event, target) {
    const { swordInterlude } = await import("../rolls/sword-interlude.mjs");
    await swordInterlude(this.actor);
  }

  static async #onHealing(event, target) {
    const { swordHealing } = await import("../rolls/sword-healing.mjs");
    await swordHealing(this.actor);
  }

  static async #onArsOratoria(event, target) {
    const { swordArsOratoria } = await import("../rolls/sword-ars-oratoria.mjs");
    await swordArsOratoria(this.actor);
  }

  static async #onSfida(event, target) {
    const { swordSfida } = await import("../rolls/sword-sfida.mjs");
    await swordSfida(this.actor);
  }

  static async #onInspire(event, target) {
    const actor = this.actor;
    const system = actor.system;
    const spirito = system.resources.spirito;

    if (spirito.value <= 0) {
      ui.notifications.warn(game.i18n.localize("SWORD.Inspire.NoSpirito"));
      return;
    }

    // Find shared valori with party members to determine max spirito spend
    // For simplicity: let user pick amount
    const dialogContent = `
      <div class="sword-roll-dialog">
        <h3>${game.i18n.localize("SWORD.Inspire.Label")}</h3>
        <p>${game.i18n.localize("SWORD.Inspire.Desc")}</p>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Inspire.SpiritoSpend")}</label>
          <input type="number" name="spiritoSpend" value="1" min="1" max="${spirito.value}" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Inspire.CompanionName")}</label>
          <input type="text" name="companionName" value="" placeholder="${game.i18n.localize("SWORD.Inspire.CompanionPlaceholder")}" />
        </div>
      </div>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${game.i18n.localize("SWORD.Inspire.Label")} — ${actor.name}` },
      content: dialogContent,
      ok: {
        label: game.i18n.localize("SWORD.Roll.Submit"),
        icon: "fa-solid fa-hand-holding-heart",
        callback: (event, button) => {
          const form = button.form;
          return {
            spiritoSpend: Math.min(parseInt(form.elements.spiritoSpend.value) || 1, spirito.value),
            companionName: form.elements.companionName.value || "?"
          };
        }
      }
    });

    if (!result) return;

    const { spiritoSpend, companionName } = result;

    // Deduct spirito
    await actor.update({
      "system.resources.spirito.value": spirito.value - spiritoSpend
    });

    // Post chat card — actual healing is applied manually by GM
    const content = `
      <div class="sword chat-card">
        <header class="card-header">
          <img src="${actor.img}" width="36" height="36" />
          <div class="card-header-text">
            <h3><i class="fas fa-hand-holding-heart"></i> ${game.i18n.localize("SWORD.Inspire.Label")}</h3>
          </div>
        </header>
        <div class="result-section">
          <div class="damage-line">${actor.name} ${game.i18n.localize("SWORD.Inspire.Spends")} ${spiritoSpend} ${game.i18n.localize("SWORD.Resources.spirito")}</div>
          <div class="damage-line">${game.i18n.localize("SWORD.Inspire.Target")}: <strong>${companionName}</strong></div>
          <div class="damage-line">${game.i18n.localize("SWORD.Inspire.Effect")}</div>
        </div>
      </div>`;

    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content
    });
  }

  static async #onContacts(event, target) {
    const { swordContacts } = await import("../rolls/sword-contacts.mjs");
    await swordContacts(this.actor);
  }

  static async #onDeleteContact(event, target) {
    const index = parseInt(target.dataset.contactIndex);
    if (isNaN(index)) return;
    const contacts = [...(this.actor.system.contacts || [])];
    const contact = contacts[index];
    if (!contact) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SWORD.Contacts.Delete") },
      content: `<p>${game.i18n.format("SWORD.Contacts.DeleteConfirm", { name: contact.name })}</p>`,
      yes: { default: false }
    });
    if (confirmed) {
      contacts.splice(index, 1);
      await this.actor.update({ "system.contacts": contacts });
    }
  }

  static async #onSpendReserve(event, target) {
    const actor = this.actor;
    if (!game.combat) {
      ui.notifications.warn(game.i18n.localize("SWORD.Reserve.NoCombat"));
      return;
    }
    const combatant = game.combat.resolveCombatant(actor);
    if (!combatant) return;
    const reserve = combatant.getFlag("sword", "successReserve") || 0;
    if (reserve <= 0) {
      ui.notifications.warn(game.i18n.localize("SWORD.Reserve.Empty"));
      return;
    }
    if (combatant.getFlag("sword", "usedReserveThisTurn")) {
      ui.notifications.warn(game.i18n.localize("SWORD.Reserve.AlreadyUsed"));
      return;
    }
    await combatant.setFlag("sword", "successReserve", reserve - 1);
    await combatant.setFlag("sword", "usedReserveThisTurn", true);
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<div class="sword chat-card"><div class="result-section"><div class="damage-line"><i class="fas fa-star"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Reserve.Spent")} (${reserve - 1} ${game.i18n.localize("SWORD.Reserve.Remaining")})</div></div></div>`
    });
  }

  // ── Rest & recovery (fattucchiere, meditation, rest) ──

  static async #onFattucchiere(event, target) {
    const actor = this.actor;
    const system = actor.system;
    const ec = system.effectiveCharacteristics ?? system.characteristics;
    const charScore = ec.gratia;
    const skillData = system.skills.raggirare;
    const grade = skillData.grade;
    const extraDice = skillData.extraDice;
    const isUntrained = grade === 0 && extraDice === 0;

    const fatiguePenalty = system.fatiguePenalty || 0;
    const woundPenalty = system.woundPenalty || 0;
    const basePenalty = fatiguePenalty + woundPenalty;
    const spirito = system.resources.spirito;

    const { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } = await import("../rolls/focus-helper.mjs");
    const allFoci = collectAllFoci(system);
    const focusHtml = buildFocusDialogHtml(allFoci);

    const dialogContent = `
      <div class="sword-roll-dialog">
        <p><strong>${game.i18n.localize("SWORD.Fattucchiere.Label")}</strong> — ${game.i18n.localize("SWORD.Skills.raggirare")} (${charScore})</p>
        ${grade > 0 ? `<p class="hint">${game.i18n.localize("SWORD.Grade")}: ${grade}</p>` : ""}
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
          <input type="number" name="diceCount" value="2" min="2"
            ${isUntrained ? 'max="2" disabled' : ""} />
        </div>
        ${focusHtml}
        ${basePenalty > 0 ? `
        <hr/>
        <div class="form-group fatigue-penalty-group">
          <label>${game.i18n.localize("SWORD.Combat.PenaltyTotal")}: -${basePenalty}</label>
          <div class="form-group-inline">
            <label>${game.i18n.localize("SWORD.Roll.PenaltyCancellation")}</label>
            <input type="number" name="spiritoCancelPenalty" value="0" min="0" max="${Math.min(basePenalty, spirito.value)}" />
          </div>
        </div>` : ""}
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SWORD.Fattucchiere.Label") },
      content: dialogContent,
      ok: {
        label: game.i18n.localize("SWORD.Roll.Submit"),
        icon: "fa-solid fa-dice",
        callback: (event, button) => {
          const form = button.form;
          return {
            diceCount: parseInt(form.elements.diceCount.value) || 2,
            focusCount: countSelectedFoci(form, allFoci.length),
            spiritoCancelPenalty: parseInt(form.elements.spiritoCancelPenalty?.value) || 0
          };
        }
      }
    });

    if (!result) return;

    let { diceCount, focusCount, spiritoCancelPenalty } = result;
    if (isUntrained) diceCount = 2;
    if (diceCount < 2) diceCount = 2;

    spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
    spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);
    const effectivePenalty = basePenalty - spiritoCancelPenalty;

    const totalDice = diceCount + extraDice + focusCount;
    const roll = new Roll(`${totalDice}d6`);
    await roll.evaluate();
    const diceRolled = roll.terms[0].values;

    const engineOutput = swordCheckResolve({
      characteristicScore: charScore,
      diceCount,
      grade,
      extraDice: extraDice + focusCount,
      successBonus: 0,
      successPenalty: effectivePenalty,
      difficultyThreshold: null,
      opposedSuccesses: null,
      diceRolled,
      discardIndices: null
    });

    // Resolve via engine
    const fatResult = resolveFattucchiere(engineOutput, {
      spiritoCancelPenalty,
      resources: { spirito: { value: spirito.value, max: spirito.max } }
    });

    const updateData = {};
    for (const [key, val] of Object.entries(fatResult.patches)) {
      updateData[`system.${key}`] = val;
    }
    if (Object.keys(updateData).length > 0) {
      await actor.update(updateData);
    }

    const successes = fatResult.successes;
    const content = `
      <div class="sword chat-card">
        <header class="card-header">
          <img src="${actor.img}" width="36" height="36" />
          <div class="card-header-text">
            <h3><i class="fas fa-hat-wizard"></i> ${game.i18n.localize("SWORD.Fattucchiere.Label")}</h3>
          </div>
        </header>
        <div class="result-section">
          <div class="damage-line">${game.i18n.localize("SWORD.Skills.raggirare")} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
          <div class="damage-line">${engineOutput.basePassed ? "✓" : "✗"} ${game.i18n.localize(engineOutput.basePassed ? "SWORD.Chat.Passed" : "SWORD.Chat.Failed")} — ${game.i18n.localize("SWORD.Chat.Successes")}: ${successes}</div>
          ${fatResult.passed ? `<div class="damage-line"><strong>${game.i18n.localize("SWORD.Fattucchiere.Defense")}: ${fatResult.defenseValue}</strong></div>` : `<div class="damage-line">${game.i18n.localize("SWORD.Fattucchiere.Failed")}</div>`}
        </div>
      </div>
    `;

    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content,
      rolls: [roll],
      sound: CONFIG.sounds.dice
    });
  }

  static async #onMeditate(event, target) {
    const actor = this.actor;
    const system = actor.system;
    const ec = system.effectiveCharacteristics ?? system.characteristics;
    const charScore = ec.mens;
    const skillData = system.skills.ragionamento;
    const grade = skillData.grade;
    const extraDice = skillData.extraDice;
    const isUntrained = grade === 0 && extraDice === 0;

    const fatiguePenalty = system.fatiguePenalty || 0;
    const woundPenalty = system.woundPenalty || 0;
    const basePenalty = fatiguePenalty + woundPenalty;
    const spirito = system.resources.spirito;

    // Check if spirito is already full
    if (spirito.value >= spirito.max) {
      ui.notifications.info(game.i18n.localize("SWORD.Meditation.AlreadyFull"));
      return;
    }

    // Collect applicable foci
    const { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } = await import("../rolls/focus-helper.mjs");
    const allFoci = collectAllFoci(system);
    const focusHtml = buildFocusDialogHtml(allFoci);

    const dialogContent = `
      <div class="sword-roll-dialog">
        <p><strong>${game.i18n.localize("SWORD.Meditation.Label")}</strong> — ${game.i18n.localize("SWORD.Skills.ragionamento")} (${charScore})</p>
        ${grade > 0 ? `<p class="hint">${game.i18n.localize("SWORD.Grade")}: ${grade}</p>` : ""}
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
          <input type="number" name="diceCount" value="2" min="2"
            ${isUntrained ? 'max="2" disabled' : ""} />
        </div>
        ${focusHtml}
        ${basePenalty > 0 ? `
        <hr/>
        <div class="form-group fatigue-penalty-group">
          <label>${game.i18n.localize("SWORD.Combat.PenaltyTotal")}: -${basePenalty}</label>
          <div class="form-group-inline">
            <label>${game.i18n.localize("SWORD.Roll.PenaltyCancellation")}</label>
            <input type="number" name="spiritoCancelPenalty" value="0" min="0" max="${Math.min(basePenalty, spirito.value)}" />
          </div>
        </div>` : ""}
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SWORD.Meditation.Label") },
      content: dialogContent,
      ok: {
        label: game.i18n.localize("SWORD.Roll.Submit"),
        icon: "fa-solid fa-dice",
        callback: (event, button) => {
          const form = button.form;
          return {
            diceCount: parseInt(form.elements.diceCount.value) || 2,
            focusCount: countSelectedFoci(form, allFoci.length),
            spiritoCancelPenalty: parseInt(form.elements.spiritoCancelPenalty?.value) || 0
          };
        }
      }
    });

    if (!result) return;

    let { diceCount, focusCount, spiritoCancelPenalty } = result;
    if (isUntrained) diceCount = 2;
    if (diceCount < 2) diceCount = 2;

    // Clamp spirito cancellation
    spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
    spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);
    const effectivePenalty = basePenalty - spiritoCancelPenalty;

    // Roll Ragionamento check
    const totalDice = diceCount + extraDice + focusCount;
    const roll = new Roll(`${totalDice}d6`);
    await roll.evaluate();
    const diceRolled = roll.terms[0].values;

    const engineOutput = swordCheckResolve({
      characteristicScore: charScore,
      diceCount,
      grade,
      extraDice: extraDice + focusCount,
      successBonus: 0,
      successPenalty: effectivePenalty,
      difficultyThreshold: null,
      opposedSuccesses: null,
      diceRolled,
      discardIndices: null
    });

    // Resolve meditation via engine
    const medResult = resolveMeditation(engineOutput, {
      spiritoCancelPenalty,
      resources: { spirito: { value: spirito.value, max: spirito.max } }
    });

    const updateData = {};
    for (const [key, val] of Object.entries(medResult.patches)) {
      updateData[`system.${key}`] = val;
    }
    if (Object.keys(updateData).length > 0) {
      await actor.update(updateData);
    }

    // Chat card
    const successes = medResult.successes;
    const content = `
      <div class="sword chat-card">
        <header class="card-header">
          <img src="${actor.img}" width="36" height="36" />
          <div class="card-header-text">
            <h3><i class="fas fa-om"></i> ${game.i18n.localize("SWORD.Meditation.Label")}</h3>
          </div>
        </header>
        <div class="result-section">
          <div class="damage-line">${game.i18n.localize("SWORD.Skills.ragionamento")} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
          <div class="damage-line">${engineOutput.basePassed ? "✓" : "✗"} ${game.i18n.localize(engineOutput.basePassed ? "SWORD.Chat.Passed" : "SWORD.Chat.Failed")} — ${game.i18n.localize("SWORD.Chat.Successes")}: ${successes}</div>
          ${medResult.spiritoRecovery > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Resources.spirito")}: <strong>+${medResult.spiritoRecovery}</strong></div>` : ""}
          ${!engineOutput.basePassed ? `<div class="damage-line">${game.i18n.localize("SWORD.Meditation.Failed")}</div>` : ""}
        </div>
      </div>
    `;

    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content,
      rolls: [roll],
      sound: CONFIG.sounds.dice
    });
  }

  static async #onRest(event, target) {
    const actor = this.actor;
    const system = actor.system;
    const ec = system.effectiveCharacteristics ?? system.characteristics;

    // Forza skill data
    const skillData = system.skills.forza;
    const charScore = ec.fortitudo;
    const grade = skillData.grade;
    const extraDice = skillData.extraDice;  // focus selected contextually in roll dialog
    const isUntrained = grade === 0 && extraDice === 0;

    // Existing penalties (fatigue + wounds)
    const fatiguePenalty = system.fatiguePenalty || 0;
    const woundPenalty = system.woundPenalty || 0;
    const basePenalty = fatiguePenalty + woundPenalty;
    const spirito = system.resources.spirito;

    // Build condition modifier dialog
    const dialogContent = `
      <div class="sword-roll-dialog">
        <p><strong>${game.i18n.localize("SWORD.Rest.Label")}</strong> — ${game.i18n.localize("SWORD.Skills.forza")} (${charScore})</p>
        ${grade > 0 ? `<p class="hint">${game.i18n.localize("SWORD.Grade")}: ${grade}</p>` : ""}
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
          <input type="number" name="diceCount" value="2" min="2"
            ${isUntrained ? 'max="2" disabled' : ""} />
        </div>
        <hr/>
        <h4>${game.i18n.localize("SWORD.Rest.Conditions")}</h4>
        <div class="form-group">
          <label><input type="checkbox" name="outdoor" /> ${game.i18n.localize("SWORD.Rest.Outdoor")} (-1)</label>
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="noBedding" /> ${game.i18n.localize("SWORD.Rest.NoBedding")} (-2)</label>
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="coldFood" /> ${game.i18n.localize("SWORD.Rest.ColdFood")} (-1)</label>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Rest.ColdWeather")}</label>
          <select name="coldWeather">
            <option value="0">${game.i18n.localize("SWORD.Rest.WeatherNone")}</option>
            <option value="1">${game.i18n.localize("SWORD.Rest.WeatherMild")} (-1)</option>
            <option value="2">${game.i18n.localize("SWORD.Rest.WeatherCold")} (-2)</option>
            <option value="3">${game.i18n.localize("SWORD.Rest.WeatherExtreme")} (-3)</option>
          </select>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Rest.SleepDuration")}</label>
          <select name="sleepDuration">
            <option value="0">${game.i18n.localize("SWORD.Rest.SleepFull")}</option>
            <option value="1">${game.i18n.localize("SWORD.Rest.SleepShort")} (-1)</option>
            <option value="2">${game.i18n.localize("SWORD.Rest.SleepMinimal")} (-2)</option>
            <option value="3">${game.i18n.localize("SWORD.Rest.SleepNone")} (-3)</option>
          </select>
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="armorWorn" /> ${game.i18n.localize("SWORD.Rest.ArmorWorn")}</label>
        </div>
        ${basePenalty > 0 ? `
        <hr/>
        <div class="form-group fatigue-penalty-group">
          <label>${game.i18n.localize("SWORD.Combat.PenaltyTotal")}: -${basePenalty}</label>
          <div class="form-group-inline">
            <label>${game.i18n.localize("SWORD.Roll.PenaltyCancellation")}</label>
            <input type="number" name="spiritoCancelPenalty" value="0" min="0" max="${Math.min(basePenalty, spirito.value)}" />
          </div>
        </div>` : ""}
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SWORD.Rest.Label") },
      content: dialogContent,
      ok: {
        label: game.i18n.localize("SWORD.Roll.Submit"),
        icon: "fa-solid fa-dice",
        callback: (event, button) => {
          const form = button.form;
          return {
            diceCount: parseInt(form.elements.diceCount.value) || 2,
            outdoor: form.elements.outdoor.checked,
            noBedding: form.elements.noBedding.checked,
            coldFood: form.elements.coldFood.checked,
            coldWeather: parseInt(form.elements.coldWeather.value) || 0,
            sleepDuration: parseInt(form.elements.sleepDuration.value) || 0,
            armorWorn: form.elements.armorWorn.checked,
            spiritoCancelPenalty: parseInt(form.elements.spiritoCancelPenalty?.value) || 0
          };
        }
      }
    });

    if (!result) return;

    let { diceCount, outdoor, noBedding, coldFood, coldWeather, sleepDuration, armorWorn, spiritoCancelPenalty } = result;
    if (isUntrained) diceCount = 2;
    if (diceCount < 2) diceCount = 2;

    // Compute condition penalty via engine
    let armorProtezione = 0;
    if (armorWorn) {
      const armorItem = Array.from(actor.items).find(i => i.type === "armor");
      if (armorItem) armorProtezione = armorItem.system.protezione || 0;
    }
    const conditionPenalty = computeRestConditionPenalty({
      outdoor, noBedding, coldFood, coldWeather, sleepDuration, armorProtezione
    });

    // Clamp spirito cancellation
    spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
    spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);
    const effectivePenalty = basePenalty - spiritoCancelPenalty + conditionPenalty;

    // Roll Forza check
    const totalDice = diceCount + extraDice;
    const roll = new Roll(`${totalDice}d6`);
    await roll.evaluate();
    const diceRolled = roll.terms[0].values;

    const engineOutput = swordCheckResolve({
      characteristicScore: charScore,
      diceCount,
      grade,
      extraDice,
      successBonus: 0,
      successPenalty: effectivePenalty,
      difficultyThreshold: null,
      opposedSuccesses: null,
      diceRolled,
      discardIndices: null
    });

    // Resolve rest via engine
    const restResult = resolveRest(engineOutput, {
      conditionPenalty,
      spiritoCancelPenalty,
      resources: {
        fatica: { value: system.resources.fatica.value, max: system.resources.fatica.max },
        spirito: { value: spirito.value, max: spirito.max }
      },
      woundLevels: { ...system.woundLevels },
      audacia: ec.audacia
    });

    const updateData = {};
    for (const [key, val] of Object.entries(restResult.patches)) {
      updateData[`system.${key}`] = val;
    }
    if (Object.keys(updateData).length > 0) {
      await actor.update(updateData);
    }

    // Chat card
    const successes = restResult.successes;
    const content = `
      <div class="sword chat-card">
        <header class="card-header">
          <img src="${actor.img}" width="36" height="36" />
          <div class="card-header-text">
            <h3><i class="fas fa-campground"></i> ${game.i18n.localize("SWORD.Rest.Label")}</h3>
          </div>
        </header>
        <div class="result-section">
          <div class="damage-line">${game.i18n.localize("SWORD.Skills.forza")} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
          <div class="damage-line">${engineOutput.basePassed ? "✓" : "✗"} ${game.i18n.localize(engineOutput.basePassed ? "SWORD.Chat.Passed" : "SWORD.Chat.Failed")} — ${game.i18n.localize("SWORD.Chat.Successes")}: ${successes}</div>
          ${conditionPenalty > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Rest.ConditionPenalty")}: -${conditionPenalty}</div>` : ""}
          ${restResult.faticaRecovery > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Resources.fatica")}: <strong>+${restResult.faticaRecovery}</strong></div>` : ""}
          ${restResult.woundsHealed > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Wounds.Label")}: <strong>-${restResult.woundsHealed}</strong></div>` : ""}
          ${restResult.faticaLost > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Resources.fatica")}: <strong>-${restResult.faticaLost}</strong></div>` : ""}
          <div class="damage-line">${game.i18n.localize("SWORD.Resources.spirito")}: <strong>+${Math.max(0, restResult.spiritoRecovery)}</strong></div>
        </div>
      </div>
    `;

    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content,
      rolls: [roll],
      sound: CONFIG.sounds.dice
    });
  }

  // ── Talent actions (stratega, compagni fedeli) ──

  static async #onDistributeRiflessi(event, target) {
    const actor = this.actor;
    if (!game.combat) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoCombat"));
      return;
    }
    const combatant = game.combat.resolveCombatant(actor);
    if (!combatant) return;
    const pool = combatant.getFlag("sword", "strategaPool") || 0;
    if (pool <= 0) {
      ui.notifications.warn(game.i18n.localize("SWORD.Talent.StrategaEmpty"));
      return;
    }

    // Build list of allied character combatants (including self — errata: "tra voi e i vostri compagni")
    const others = game.combat.combatants
      .filter(c => c.actor && c.actor.type === "character" && c.actor.hasPlayerOwner)
      .map(c => ({ id: c.actorId, name: c.actor.name }));
    if (others.length === 0) {
      ui.notifications.warn(game.i18n.localize("SWORD.Talent.StrategaNoCompanions"));
      return;
    }

    const inputRows = others.map(o =>
      `<div class="form-group">
        <label>${o.name}</label>
        <input type="number" name="riflessi_${o.id}" value="0" min="0" data-actor-id="${o.id}" />
      </div>`
    ).join("");

    const content = `
      <div class="sword-roll-dialog">
        <p>${game.i18n.localize("SWORD.Talent.StrategaPool")}: <strong>${pool}</strong></p>
        ${inputRows}
      </div>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${actor.name} — ${game.i18n.localize("SWORD.Talent.StrategaDistribute")}` },
      content,
      ok: {
        label: game.i18n.localize("SWORD.Roll.Confirm"),
        callback: (event, button) => {
          const form = button.form;
          const allocations = [];
          for (const o of others) {
            const val = parseInt(form.elements[`riflessi_${o.id}`]?.value) || 0;
            if (val > 0) allocations.push({ id: o.id, name: o.name, amount: val });
          }
          return allocations;
        }
      }
    });

    if (!result || result.length === 0) return;

    const totalAllocated = result.reduce((sum, a) => sum + a.amount, 0);
    if (totalAllocated > pool) {
      ui.notifications.warn(game.i18n.localize("SWORD.Talent.StrategaExceedsPool"));
      return;
    }

    // Apply Riflessi to companions
    for (const alloc of result) {
      const targetActor = game.actors.get(alloc.id);
      if (!targetActor) continue;
      const riflessi = targetActor.system.resources.riflessi;
      await targetActor.update({
        "system.resources.riflessi.value": Math.min(riflessi.max, riflessi.value + alloc.amount)
      });
    }

    // Deduct from pool
    await combatant.setFlag("sword", "strategaPool", pool - totalAllocated);

    // Chat message
    const distList = result.map(a => `${a.name}: +${a.amount}`).join(", ");
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<div class="sword chat-card"><div class="result-section"><div class="damage-line"><i class="fas fa-chess-king"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Talent.StrategaDistributed")}: ${distList}</div></div></div>`
    });
  }

  static async #onCompanionBoost(event, target) {
    const actor = this.actor;
    const pe = actor.system.pe;
    if (pe.available <= 0) {
      ui.notifications.warn(game.i18n.localize("SWORD.Talent.CompagniFedeliNoPE"));
      return;
    }

    const content = `
      <div class="sword-roll-dialog">
        <p>${game.i18n.localize("SWORD.Talent.CompagniFedeliDesc")}</p>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.PE.Label")}</label>
          <input type="number" name="peSpend" value="2" min="2" max="${pe.available}" step="2" />
        </div>
      </div>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${actor.name} — ${game.i18n.localize("SWORD.Talent.CompagniFedeli")}` },
      content,
      ok: {
        label: game.i18n.localize("SWORD.Roll.Confirm"),
        callback: (event, button) => parseInt(button.form.elements.peSpend?.value) || 0
      }
    });

    if (!result || result < 2) return;
    // Errata: cost = 2× successes, max 6 successes = 12 PE; enforce even spending
    const maxCompanionPe = 12 - (pe.companionSpent || 0);
    const peSpend = Math.min(Math.floor(result / 2) * 2, pe.available, maxCompanionPe);
    if (peSpend < 2) return;

    await actor.update({ "system.pe.companionSpent": (pe.companionSpent || 0) + peSpend });
    const successes = Math.floor(peSpend / 2);

    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<div class="sword chat-card"><div class="result-section"><div class="damage-line"><i class="fas fa-paw"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Talent.CompagniFedeliSpent")}: ${peSpend} PE → +${successes} ${game.i18n.localize("SWORD.Talent.CompagniFedeliSkillBoost")}</div></div></div>`
    });
  }

  // ── Inline inventory adjustments ──

  static async #onAdjustQuantity(event, target) {
    const itemId = target.dataset.itemId;
    const delta = parseInt(target.dataset.delta) || 0;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    const newQty = Math.max(0, (item.system.quantity || 1) + delta);
    if (newQty === 0) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Elimina oggetto" },
        content: `<p>${game.i18n.format("SWORD.Inventory.DeleteConfirm", { name: item.name })}</p>`,
        yes: { default: false }
      });
      if (confirmed) await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
    } else {
      await item.update({ "system.quantity": newQty });
    }
  }

  static async #onAdjustRobustezza(event, target) {
    const itemId = target.dataset.itemId;
    const delta = parseInt(target.dataset.delta) || 0;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    const maxRob = item.system.robustezza || 30;
    const newRob = Math.max(0, Math.min(maxRob, (item.system.robustezzaCurrent ?? maxRob) + delta));
    await item.update({ "system.robustezzaCurrent": newRob });
  }

  static async #onAdjustResource(event, target) {
    const key = target.dataset.resourceKey;
    const delta = parseInt(target.dataset.delta) || 0;
    if (!key) return;
    const res = this.actor.system.resources[key];
    if (!res) return;
    const newVal = Math.max(0, Math.min(res.max, res.value + delta));
    await this.actor.update({ [`system.resources.${key}.value`]: newVal });
  }

  // ── Language management ──

  static async #onAddLanguage(event, target) {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SWORD.Languages.Add") },
      content: `<form><div class="form-group"><label>${game.i18n.localize("SWORD.Languages.Name")}</label><input type="text" name="lang" autofocus /></div></form>`,
      ok: { callback: (event, button) => button.form.elements.lang?.value?.trim() }
    });
    if (!result) return;
    const languages = [...(this.actor.system.languages || []), result];
    await this.actor.update({ "system.languages": languages });
  }

  static async #onDeleteLanguage(event, target) {
    const idx = parseInt(target.dataset.langIndex);
    if (isNaN(idx)) return;
    const languages = [...(this.actor.system.languages || [])];
    languages.splice(idx, 1);
    await this.actor.update({ "system.languages": languages });
  }
}
