/**
 * Rifiatare (Catch Breath) action.
 *
 * Spend 1 Fatica → recover max(1, grades(Atletica)) Riflessi (characters)
 * or max(1, abilities.forza) Riflessi (creatures).
 * Errata line 2133: "1 oppure i loro gradi di Atletica" = whichever is higher.
 */

/**
 * Execute Rifiatare for an actor.
 * @param {Actor} actor - The acting character or creature
 */
export async function swordRifiatare(actor) {
  const system = actor.system;
  const fatica = system.resources.fatica;
  const riflessi = system.resources.riflessi;

  // Validate: cannot rifiatare while surprised (first round)
  if (game.combat) {
    const combatant = game.combat.resolveCombatant(actor);
    if (combatant?.getFlag("sword", "isSurprised")) {
      ui.notifications.warn(game.i18n.localize("SWORD.Surprise.SurprisedNoRifiatare"));
      return;
    }
  }

  // Action economy gate
  if (game.combat && !game.combat.hasActionAvailable(actor)) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoActionAvailable"));
      return;
    }
    ui.notifications.info(game.i18n.localize("SWORD.Combat.GMActionOverride"));
  }

  // Validate: fatica must be > 0 (spending 1 fatica)
  if (fatica.value <= 0) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.RifiatareNoFatica"));
    return;
  }

  // Validate: riflessi must be below max
  if (riflessi.value >= riflessi.max) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.RifiatareMaxRiflessi"));
    return;
  }

  // Compute recovery amount: max(1, grades) per errata
  // Incorporeo creatures use Volontà instead of Forza (PDF line 5366)
  let recovery;
  if (actor.type === "creature") {
    const isIncorporeo = (system.advantages || []).includes("incorporeo");
    recovery = Math.max(1, isIncorporeo ? (system.abilities.volonta || 0) : (system.abilities.forza || 0));
  } else {
    recovery = Math.max(1, system.skills.atletica?.grade || 0);
  }

  // Cap at max
  const actualRecovery = Math.min(recovery, riflessi.max - riflessi.value);

  // Apply updates
  await actor.update({
    "system.resources.fatica.value": fatica.value - 1,
    "system.resources.riflessi.value": riflessi.value + actualRecovery
  });

  // Consume standard action
  if (game.combat) await game.combat.consumeAction(actor);

  // Post chat card
  const content = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${actor.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas fa-wind"></i> ${game.i18n.localize("SWORD.Combat.Rifiatare")}</h3>
        </div>
      </header>
      <div class="result-section">
        <div class="damage-line">${game.i18n.localize("SWORD.Combat.RifiatareFaticaCost")}: -1</div>
        <div class="damage-line">${game.i18n.localize("SWORD.Combat.RifiatareRecovery")}: <strong>+${actualRecovery}</strong></div>
      </div>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content
  });
}
