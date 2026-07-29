/**
 * CreatureDataModel — Foundry TypeDataModel for creature actors.
 *
 * Defines the schema for creatures (monsters, animals, fey, demons, etc.)
 * and computes derived data (wound penalty, fatigue level).
 *
 * Source: sword-rules-spec.md Section 16, PDF Chapter 11.
 */

import { computeWoundPenalty } from "../engine.mjs";

export class CreatureDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;

    const abilityField = () =>
      new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 });

    const resourceField = () =>
      new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
      });

    return {
      rango: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 1 }),
      creatureType: new fields.StringField({ required: true, initial: "animale" }),
      sizeCategory: new fields.StringField({ required: true, initial: "media" }),
      isTemplate: new fields.BooleanField({ initial: false }),

      // Base abilities (fixed successes)
      abilities: new fields.SchemaField({
        agilita: abilityField(),
        forza: abilityField(),
        percezione: abilityField(),
        volonta: abilityField(),
        ragionamento: abilityField(),
        carisma: abilityField()
      }),

      // Skills (fixed successes)
      skills: new fields.SchemaField({
        lotta: abilityField(),
        furtivita: abilityField(),
        armi_comuni: abilityField(),
        armi_da_guerra: abilityField(),
        armi_corte: abilityField(),
        archi: abilityField(),
        autorita: abilityField(),
        empatia: abilityField(),
        raggirare: abilityField(),
        sopravvivenza: abilityField()
      }),

      // Resources
      resources: new fields.SchemaField({
        riflessi: new fields.SchemaField({
          value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
          max: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
        }),
        fatica: resourceField(),
        spirito: resourceField()
      }),

      // Movement modes
      movement: new fields.SchemaField({
        walk: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        trot: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        gallop: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        fly: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        swim: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
      }),

      protezione: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),

      // Attacks
      attacks: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ required: true, initial: "" }),
          skill: new fields.StringField({ required: true, initial: "lotta" }),
          misura: new fields.StringField({ nullable: true, initial: null }),
          damage: new fields.StringField({ required: true, initial: "+0T" }),
          parata: new fields.NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null })
        })
      ),

      // Advantages/Disadvantages
      advantages: new fields.ArrayField(new fields.StringField()),
      advantageDetails: new fields.ObjectField(),
      disadvantages: new fields.ArrayField(new fields.StringField()),

      // Wound capacities (pre-assigned per level from PDF)
      woundCapacities: new fields.SchemaField({
        graffi: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        leggere: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        gravi: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        critiche: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        mortali: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
      }),

      // Current wounds (editable by GM)
      woundLevels: new fields.SchemaField({
        graffi: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        leggere: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        gravi: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        critiche: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        mortali: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
      }),

      // Fatigue thresholds from PDF (3 values: fresco/stanco/sfinito)
      fatigueThresholds: new fields.SchemaField({
        fresco: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        stanco: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        sfinito: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
      }),

      speciale: new fields.StringField({ initial: "" })
    };
  }

  prepareDerivedData() {
    // Total wounds
    const wl = this.woundLevels;
    this.totalWounds = wl.graffi + wl.leggere + wl.gravi + wl.critiche + wl.mortali;

    // Wound penalty (reuses character wound logic)
    // For piccola creatures: leggere capacity is 0, so gravi = -1, critiche = -2, mortali = -3
    this.woundPenalty = computeWoundPenalty(wl);

    // Fatigue level + penalty
    const fatica = this.resources.fatica;
    const thresholds = this.fatigueThresholds;
    if (thresholds.fresco > 0 && fatica.value <= Math.floor(thresholds.fresco * 2 / 3)) {
      if (fatica.value <= Math.floor(thresholds.fresco / 3)) {
        this.fatiguePenalty = 2;
        this.fatigueLevel = "sfinito";
      } else {
        this.fatiguePenalty = 1;
        this.fatigueLevel = "stanco";
      }
    } else {
      this.fatiguePenalty = 0;
      this.fatigueLevel = "fresco";
    }

    // Total ferite capacity
    const wc = this.woundCapacities;
    this.totalFeriteCapacity = wc.graffi + wc.leggere + wc.gravi + wc.critiche + wc.mortali;

    // Wound level list for template rendering
    const levels = this.sizeCategory === "piccola"
      ? ["graffi", "gravi", "critiche", "mortali"]
      : ["graffi", "leggere", "gravi", "critiche", "mortali"];
    this.woundLevelList = levels;
  }
}
