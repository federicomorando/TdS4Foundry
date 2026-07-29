/**
 * SwordCombatTracker — Custom Combat Tracker sidebar for the SwORD system.
 *
 * Extends the built-in CombatTracker to:
 * - Use a custom tracker template with an action counter badge per combatant.
 * - Inject action economy data (used/max) into each turn's render context.
 */
export class SwordCombatTracker extends CombatTracker {

  /** @override — custom header (no roll buttons) and tracker (action counter) */
  static PARTS = {
    ...CombatTracker.PARTS,
    header: {
      template: "systems/sword/templates/combat/header.hbs"
    },
    tracker: {
      template: "systems/sword/templates/combat/tracker.hbs",
      scrollable: [""]
    }
  };

  /**
   * Extend per-combatant context with action economy data.
   * @override
   */
  async _prepareTurnContext(combat, combatant, index) {
    const turn = await super._prepareTurnContext(combat, combatant, index);
    const used = combatant.getFlag("sword", "actionsUsed") ?? 0;
    const max = combat.getMaxActions(combatant);
    turn.actions = { used, max, exhausted: used >= max };
    return turn;
  }
}
