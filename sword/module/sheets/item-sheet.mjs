import {
  WEAPON_CATEGORIES, GEAR_CATEGORIES, QUALITY_TIERS,
  WEAPON_PREGI, ARMOR_PREGI
} from "../engine.mjs";
import { SKILL_MAP } from "../data/actor.mjs";

const QUALITY_CHOICES = Object.fromEntries(QUALITY_TIERS.map(q => [q.id, q.id]));
const HANDS_CHOICES = { una_mano: "una_mano", due_mani: "due_mani" };
const DAMAGE_TYPE_CHOICES = { T: "T", B: "B", P: "P" };
const MISURA_CHOICES = { LL: "LL", L: "L", M: "M", S: "S" };

export class SwordItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ItemSheetV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["sword", "sheet", "item"],
    position: { width: 480, height: 440 },
    actions: {
      addPregio: SwordItemSheet.#onAddPregio,
      removePregio: SwordItemSheet.#onRemovePregio
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    sheet: {
      template: "systems/sword/templates/items/item-sheet.hbs",
      scrollable: [".item-content"]
    }
  };

  /** @override */
  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = super._prepareSubmitData(event, form, formData, updateData);
    // The "\u2014" misura option submits "" which fails StringField choices
    // validation (blank not allowed) and would reject the whole form
    if (submitData.system?.misura === "") submitData.system.misura = null;
    // Weapon categories are exactly the 5 weapon skill ids — keep skillId in
    // sync so re-categorized weapons attack with the right skill
    if (this.item.type === "weapon" && submitData.system?.category) {
      submitData.system.skillId = submitData.system.category;
    }
    return submitData;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const system = item.system;
    const itemType = item.type;

    context.item = item;
    context.system = system;
    context.itemType = itemType;
    context.isWeapon = itemType === "weapon";
    context.isShield = itemType === "shield";
    context.isArmor = itemType === "armor";
    context.isGear = itemType === "gear";

    // Localized type label
    context.typeLabel = game.i18n.localize(`TYPES.Item.${itemType}`);

    // Quality choices (localized)
    context.qualityChoices = {};
    for (const tier of QUALITY_TIERS) {
      context.qualityChoices[tier.id] = game.i18n.localize(`SWORD.Quality.${tier.id}`);
    }

    // Weapon-specific
    if (context.isWeapon) {
      context.categoryChoices = {};
      for (const cat of WEAPON_CATEGORIES) {
        context.categoryChoices[cat] = game.i18n.localize(`SWORD.WeaponCategories.${cat}`);
      }
      context.handsChoices = {};
      for (const [k] of Object.entries(HANDS_CHOICES)) {
        context.handsChoices[k] = game.i18n.localize(`SWORD.Hands.${k}`);
      }
      context.damageTypeChoices = {};
      for (const [k] of Object.entries(DAMAGE_TYPE_CHOICES)) {
        context.damageTypeChoices[k] = game.i18n.localize(`SWORD.DamageTypes.${k}`);
      }
      context.misuraChoices = { "": "—", ...MISURA_CHOICES };
      context.isMelee = !["archi", "balestre"].includes(system.category);

      // Pregi
      context.pregiList = (system.pregi || []).map((id, idx) => ({
        id, idx,
        label: game.i18n.has(`SWORD.WeaponPregi.${id}`) ? game.i18n.localize(`SWORD.WeaponPregi.${id}`) : id,
        effect: WEAPON_PREGI[id]?.effect || ""
      }));
      const usedPregi = new Set(system.pregi || []);
      context.availablePregi = Object.entries(WEAPON_PREGI)
        .filter(([id]) => !usedPregi.has(id))
        .map(([id, p]) => ({ id, label: game.i18n.has(`SWORD.WeaponPregi.${id}`) ? game.i18n.localize(`SWORD.WeaponPregi.${id}`) : id, effect: p.effect }));
    }

    // Shield-specific
    if (context.isShield) {
      context.pregiList = (system.pregi || []).map((id, idx) => ({
        id, idx,
        label: game.i18n.has(`SWORD.WeaponPregi.${id}`) ? game.i18n.localize(`SWORD.WeaponPregi.${id}`) : id,
        effect: (WEAPON_PREGI[id] || ARMOR_PREGI[id])?.effect || ""
      }));
      const usedPregi = new Set(system.pregi || []);
      // Shields can have both weapon and armor pregi
      const allShieldPregi = { ...WEAPON_PREGI, ...ARMOR_PREGI };
      context.availablePregi = Object.entries(allShieldPregi)
        .filter(([id]) => !usedPregi.has(id))
        .map(([id, p]) => ({ id, label: game.i18n.has(`SWORD.WeaponPregi.${id}`) ? game.i18n.localize(`SWORD.WeaponPregi.${id}`) : (game.i18n.has(`SWORD.ArmorPregi.${id}`) ? game.i18n.localize(`SWORD.ArmorPregi.${id}`) : id), effect: p.effect }));
    }

    // Armor-specific
    if (context.isArmor) {
      context.pregiList = (system.pregi || []).map((id, idx) => ({
        id, idx,
        label: game.i18n.has(`SWORD.ArmorPregi.${id}`) ? game.i18n.localize(`SWORD.ArmorPregi.${id}`) : id,
        effect: ARMOR_PREGI[id]?.effect || ""
      }));
      const usedPregi = new Set(system.pregi || []);
      context.availablePregi = Object.entries(ARMOR_PREGI)
        .filter(([id]) => !usedPregi.has(id))
        .map(([id, p]) => ({ id, label: game.i18n.has(`SWORD.ArmorPregi.${id}`) ? game.i18n.localize(`SWORD.ArmorPregi.${id}`) : id, effect: p.effect }));
    }

    // Gear-specific
    if (context.isGear) {
      context.gearCategoryChoices = {};
      for (const cat of GEAR_CATEGORIES) {
        context.gearCategoryChoices[cat] = game.i18n.localize(`SWORD.GearCategories.${cat}`);
      }
      context.skillChoices = { "": "—" };
      for (const [skillId] of Object.entries(SKILL_MAP)) {
        context.skillChoices[skillId] = game.i18n.localize(`SWORD.Skills.${skillId}`);
      }
    }

    return context;
  }

  static async #onAddPregio(event, target) {
    const pregioId = target.closest(".pregi-section")?.querySelector(".pregio-select")?.value;
    if (!pregioId) return;
    const pregi = [...(this.item.system.pregi || []), pregioId];
    await this.item.update({ "system.pregi": pregi });
  }

  static async #onRemovePregio(event, target) {
    const idx = Number(target.dataset.idx);
    const pregi = [...(this.item.system.pregi || [])];
    pregi.splice(idx, 1);
    await this.item.update({ "system.pregi": pregi });
  }
}
