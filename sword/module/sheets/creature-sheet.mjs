/**
 * SwordCreatureSheet — Actor sheet for creature type actors.
 *
 * Single-page stat block layout (no tabs). Displays abilities, skills,
 * attacks, wounds, movement, advantages/disadvantages, and speciale.
 */

import { ADVANTAGES, DISADVANTAGES } from "../engine.mjs";

export class SwordCreatureSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["sword", "sheet", "actor", "creature"],
    position: { width: 560, height: 680 },
    actions: {
      creatureAttack: SwordCreatureSheet.#onCreatureAttack,
      unarmedAttack: SwordCreatureSheet.#onUnarmedAttack,
      breakFree: SwordCreatureSheet.#onBreakFree,
      rifiatare: SwordCreatureSheet.#onRifiatare,
      attesa: SwordCreatureSheet.#onAttesa,
      studyBattlefield: SwordCreatureSheet.#onStudyBattlefield,
      closeMisura: SwordCreatureSheet.#onCloseMisura,
      reaction: SwordCreatureSheet.#onReaction
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    creature: {
      template: "systems/sword/templates/actors/creature-sheet.hbs",
      scrollable: [".creature-body"]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;

    context.actor = actor;

    // Basic info
    context.rango = system.rango;
    context.creatureType = system.creatureType;
    context.creatureTypeLabel = game.i18n.localize(`SWORD.CreatureTypes.${system.creatureType}`);
    context.sizeCategory = system.sizeCategory;
    context.sizeCategoryLabel = game.i18n.localize(`SWORD.SizeCategories.${system.sizeCategory}`);
    context.isTemplate = system.isTemplate;

    // Abilities
    const abilityKeys = ["agilita", "forza", "percezione", "volonta", "ragionamento", "carisma"];
    context.abilities = abilityKeys
      .filter(key => system.abilities[key] > 0)
      .map(key => ({
        key,
        label: game.i18n.localize(`SWORD.Skills.${key}`),
        value: system.abilities[key]
      }));

    // Skills
    const skillKeys = ["lotta", "furtivita", "armi_comuni", "armi_da_guerra", "armi_corte", "archi",
                       "autorita", "empatia", "raggirare", "sopravvivenza"];
    context.skills = skillKeys
      .filter(key => system.skills[key] > 0)
      .map(key => ({
        key,
        label: game.i18n.localize(`SWORD.Skills.${key}`),
        value: system.skills[key]
      }));

    // Resources
    context.riflessi = system.resources.riflessi;
    context.fatica = system.resources.fatica;
    context.spirito = system.resources.spirito;
    context.protezione = system.protezione;

    // Fatigue
    context.fatigueLevel = system.fatigueLevel || "fresco";
    context.fatiguePenalty = system.fatiguePenalty || 0;

    // Movement
    const movementModes = ["walk", "trot", "gallop", "fly", "swim"];
    context.movementModes = movementModes
      .filter(mode => system.movement[mode] > 0)
      .map(mode => ({
        mode,
        label: game.i18n.localize(`SWORD.Movement.${mode}`),
        value: system.movement[mode]
      }));

    // Attacks
    context.attacks = system.attacks;

    // Wounds
    context.woundLevels = system.woundLevels;
    context.woundCapacities = system.woundCapacities;
    context.woundPenalty = system.woundPenalty || 0;
    const levels = system.woundLevelList || ["graffi", "leggere", "gravi", "critiche", "mortali"];
    context.woundLevelList = levels.map(level => ({
      key: level,
      label: game.i18n.localize(`SWORD.Wounds.${level}`),
      current: system.woundLevels[level],
      max: system.woundCapacities[level] ?? 0,
      penalty: level === "gravi" ? 1 : level === "critiche" ? 2 : level === "mortali" ? 3 : 0
    }));

    // Advantages
    context.advantages = system.advantages.map(id => {
      const def = ADVANTAGES[id];
      const level = system.advantageDetails?.[id];
      let label = def ? def.label : id;
      if (level) label += ` ${level}`;
      return { id, label };
    });

    // Disadvantages
    context.disadvantages = system.disadvantages.map(id => {
      const def = DISADVANTAGES[id];
      return { id, label: def ? def.label : id };
    });

    // Speciale
    context.speciale = system.speciale;

    return context;
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

  static async #onBreakFree(event, target) {
    game.sword.breakFree(this.actor);
  }

  static async #onCreatureAttack(event, target) {
    const index = target.dataset.attackIndex;
    game.sword.attack(this.actor, `creature_attack_${index}`);
  }

  static async #onUnarmedAttack(event, target) {
    // Creatures default to punch; offer kick option
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
}
