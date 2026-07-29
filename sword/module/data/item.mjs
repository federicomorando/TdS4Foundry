/**
 * Foundry VTT Item data models for the SwORD system.
 *
 * Four TypeDataModel subclasses: WeaponDataModel, ShieldDataModel,
 * ArmorDataModel, GearDataModel. Registered in main.mjs.
 *
 * Pure equipment data lives in equipment.mjs (zero Foundry deps).
 * These models define the Foundry-side schema for Item documents.
 */

import { WEAPON_CATEGORIES, GEAR_CATEGORIES, QUALITY_TIERS } from "../engine.mjs";

const QUALITY_IDS = QUALITY_TIERS.map(q => q.id);
const HANDS_CHOICES = ["una_mano", "due_mani"];
const DAMAGE_TYPE_CHOICES = ["T", "B", "P"];
const MISURA_CHOICES = ["LL", "L", "M", "S"];

// ─── WeaponDataModel ──────────────────────────────────────────────────────────

export class WeaponDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      category: new fields.StringField({
        required: true, blank: false, initial: "armi_comuni",
        choices: WEAPON_CATEGORIES
      }),
      skillId: new fields.StringField({ required: true, blank: false, initial: "armi_comuni" }),
      weaponType: new fields.StringField({ required: false, nullable: true, initial: null }),
      hands: new fields.StringField({
        required: true, blank: false, initial: "una_mano",
        choices: HANDS_CHOICES
      }),
      costDenari: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      costDisplay: new fields.StringField({ required: true, initial: "na" }),
      weight: new fields.NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
      damageValue: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      damageType: new fields.StringField({
        required: true, blank: false, initial: "T",
        choices: DAMAGE_TYPE_CHOICES
      }),
      parryModifier: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      misura: new fields.StringField({ required: false, nullable: true, initial: null, choices: MISURA_CHOICES }),
      pregi: new fields.ArrayField(new fields.StringField()),
      quality: new fields.StringField({
        required: true, blank: false, initial: "normale",
        choices: QUALITY_IDS
      }),
      gittata: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      ricarica: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      reloadTurnsRemaining: new fields.NumberField({
        required: true, nullable: false, integer: true, min: 0, initial: 0
      }),
      isSecondary: new fields.BooleanField({ initial: false }),
      isDrawn: new fields.BooleanField({ initial: true })
    };
  }
}

// ─── ShieldDataModel ──────────────────────────────────────────────────────────

export class ShieldDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      costDenari: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      costDisplay: new fields.StringField({ required: true, initial: "na" }),
      weight: new fields.NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
      damageValue: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      parryModifier: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      pregi: new fields.ArrayField(new fields.StringField()),
      quality: new fields.StringField({
        required: true, blank: false, initial: "normale",
        choices: QUALITY_IDS
      })
    };
  }
}

// ─── ArmorDataModel ───────────────────────────────────────────────────────────

export class ArmorDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      costDenari: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      costDisplay: new fields.StringField({ required: true, initial: "na" }),
      weight: new fields.NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
      protezione: new fields.NumberField({ required: true, nullable: false, integer: true, min: 1, max: 3, initial: 1 }),
      robustezza: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 10 }),
      robustezzaCurrent: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 10 }),
      pregi: new fields.ArrayField(new fields.StringField()),
      quality: new fields.StringField({
        required: true, blank: false, initial: "normale",
        choices: QUALITY_IDS
      })
    };
  }
}

// ─── GearDataModel ────────────────────────────────────────────────────────────

export class GearDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      gearCategory: new fields.StringField({
        required: true, blank: false, initial: "travel",
        choices: GEAR_CATEGORIES
      }),
      costDenari: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      costDisplay: new fields.StringField({ required: true, initial: "na" }),
      weight: new fields.NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
      quantity: new fields.NumberField({ required: true, nullable: false, integer: true, min: 1, initial: 1 }),
      quality: new fields.StringField({
        required: true, blank: false, initial: "normale",
        choices: QUALITY_IDS
      }),
      skillBonusSkillId: new fields.StringField({ required: false, nullable: true, initial: null }),
      description: new fields.StringField({ required: false, initial: "" })
    };
  }
}
