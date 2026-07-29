/**
 * Attesa (Wait) action.
 *
 * Skip turn, no actions. At start of next turn: recover ALL Riflessi (to max).
 * No Fatica cost. Can be interrupted (forfeit recovery).
 *
 * Errata line 2135-2138.
 */

/**
 * Execute Attesa for an actor.
 * @param {Actor} actor - The acting character or creature
 */
export async function swordAttesa(actor) {
  const combatant = game.combat?.resolveCombatant(actor);
  if (!combatant) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.AttesaNoCombat"));
    return;
  }

  // Action economy gate
  if (!game.combat.hasActionAvailable(actor)) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoActionAvailable"));
      return;
    }
    ui.notifications.info(game.i18n.localize("SWORD.Combat.GMActionOverride"));
  }

  // Consume standard action
  await game.combat.consumeAction(actor);

  // Set waiting flag
  await combatant.setFlag("sword", "isWaiting", true);

  // Post chat card
  const content = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${actor.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas fa-hourglass-half"></i> ${game.i18n.localize("SWORD.Combat.Attesa")}</h3>
        </div>
      </header>
      <div class="result-section">
        <div class="damage-line">${game.i18n.localize("SWORD.Combat.AttesaDesc")}</div>
      </div>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content
  });
}
