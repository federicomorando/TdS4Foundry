/**
 * Surprise action.
 *
 * GM-side action: Percezione opposed by Furtività.
 * Losers: -1 Riflessi per uncontested success + no rifiatare in first round.
 * Winners: one free action before combat starts.
 * PDF p.87, Errata §5.7.
 */
import { swordCheckResolve } from "../engine.mjs";
import { computeSurprisePenalty } from "../engine.mjs";
import { SKILL_MAP } from "../data/actor.mjs";

/**
 * Execute a Surprise check for an actor (victim being ambushed).
 * @param {Actor} actor - The actor being checked for surprise
 */
export async function swordSurprise(actor) {
  // Validate: must be in combat
  if (!game.combat) {
    ui.notifications.warn(game.i18n.localize("SWORD.Surprise.NoCombat"));
    return;
  }

  const system = actor.system;
  const isCreature = actor.type === "creature";

  // Check if any friendly combatant has party_furtivita_woodland
  let woodlandHint = "";
  if (game.combat) {
    const hasWoodland = game.combat.combatants.some(c => {
      const a = c.actor;
      return a && a.type === "character" && a.system.talentSpecials?.has("party_furtivita_woodland");
    });
    if (hasWoodland) {
      woodlandHint = `<p class="hint"><i class="fas fa-tree"></i> ${game.i18n.localize("SWORD.Talent.WoodlandFurtivita")}</p>`;
    }
  }

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${game.i18n.localize("SWORD.Surprise.PercepzioneCheck")}</strong> — ${actor.name}</p>
      ${woodlandHint}
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Surprise.FurtivitaSuccesses")}</label>
        <input type="number" name="furtivitaSuccesses" value="3" min="0" />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Surprise.EnvironmentalPenalty")}</label>
        <input type="number" name="envPenalty" value="0" min="0" />
      </div>
      ${!isCreature ? `
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2" />
      </div>` : ""}
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.Surprise.Label")} — ${actor.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button) => {
        const form = button.form;
        return {
          furtivitaSuccesses: parseInt(form.elements.furtivitaSuccesses.value) || 0,
          envPenalty: parseInt(form.elements.envPenalty.value) || 0,
          diceCount: parseInt(form.elements.diceCount?.value) || 2
        };
      }
    }
  });

  if (!result) return;

  let { furtivitaSuccesses, envPenalty, diceCount } = result;
  furtivitaSuccesses = Math.max(0, furtivitaSuccesses);
  envPenalty = Math.max(0, envPenalty);
  if (diceCount < 2) diceCount = 2;

  const skillId = "percezione";
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);

  // Existing penalties
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = isCreature ? 0 : (system.encumbrancePenalty || 0);
  const totalPenalty = fatiguePenalty + woundPenalty + encumbrancePenalty + envPenalty;

  let finalSuccesses = 0;
  let passed = false;
  let diceAfterReductionDisplay = [];

  if (isCreature) {
    // Creature: fixed percezione
    const fixedSuccesses = system.abilities?.percezione ?? system.skills?.percezione ?? 0;
    finalSuccesses = Math.max(0, fixedSuccesses - totalPenalty);
    passed = finalSuccesses >= furtivitaSuccesses;
  } else {
    // Character: dice roll
    const charKey = SKILL_MAP[skillId];
    const ec = system.effectiveCharacteristics ?? system.characteristics;
    const charScore = ec[charKey];
    const skillData = system.skills[skillId];
    const grade = skillData?.grade || 0;
    const extraDice = skillData?.extraDice || 0;  // focus dice not applied to involuntary checks
    const isUntrained = grade === 0 && extraDice === 0;
    if (isUntrained) diceCount = 2;

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
      successPenalty: totalPenalty,
      difficultyThreshold: null,
      opposedSuccesses: furtivitaSuccesses,
      diceRolled,
      discardIndices: null
    });

    finalSuccesses = engineOutput.finalSuccesses;
    passed = engineOutput.basePassed && finalSuccesses >= furtivitaSuccesses;
    diceAfterReductionDisplay = engineOutput.diceAfterReduction.map(d => ({
      value: d,
      isOne: d === 1
    }));
  }

  // Compute penalty
  const penalty = passed ? 0 : computeSurprisePenalty(furtivitaSuccesses, finalSuccesses);

  // Apply effects
  if (penalty > 0) {
    const currentRiflessi = system.resources.riflessi.value;
    await actor.update({
      "system.resources.riflessi.value": currentRiflessi - penalty
    });
  }

  // Set isSurprised flag on combatant
  if (!passed) {
    const combatant = game.combat.resolveCombatant(actor);
    if (combatant) {
      await combatant.setFlag("sword", "isSurprised", true);
    }
  }

  // Chat card
  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    isCreature,
    skillLabel,
    furtivitaSuccesses,
    finalSuccesses,
    passed,
    penalty,
    diceAfterReductionDisplay,
    noRifiatare: !passed
  };

  const html = await renderTemplate(
    "systems/sword/templates/chat/surprise-result.hbs",
    chatData
  );

  const chatMessageData = {
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html
  };

  if (!isCreature) {
    chatMessageData.sound = CONFIG.sounds.dice;
  }

  await ChatMessage.create(chatMessageData);
}
