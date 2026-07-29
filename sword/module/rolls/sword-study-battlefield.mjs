/**
 * Study Battlefield (Studiare il Campo) action.
 *
 * Arte della guerra check that generates tactical advantages for the party.
 * Once per combat per actor. Successes become spendable +1 bonuses
 * for any ally's attack or defense check.
 *
 * Pattern follows sword-rifiatare.mjs: standalone action, no opposition, chat card result.
 */
import { swordCheckResolve } from "../engine.mjs";
import { SKILL_MAP } from "../data/actor.mjs";
import { armorSkillPenalty } from "../engine.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { buildPenaltyHtml } from "./dialog-helpers.mjs";

/**
 * Execute Study Battlefield for an actor.
 * @param {Actor} actor - The acting character or creature
 */
export async function swordStudyBattlefield(actor) {
  // Validate: active combat
  if (!game.combat) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.StudyBattlefieldNoCombat"));
    return;
  }

  // Validate: not already used this combat
  const combatant = game.combat.resolveCombatant(actor);
  if (!combatant) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.StudyBattlefieldNoCombat"));
    return;
  }
  if (combatant.getFlag("sword", "hasStudiedBattlefield")) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.StudyBattlefieldAlreadyUsed"));
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

  const system = actor.system;
  const isCreature = actor.type === "creature";

  if (isCreature) {
    // Creature: fixed successes from arte_della_guerra skill
    const skillValue = system.skills?.arte_della_guerra ?? 0;
    if (skillValue <= 0) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.StudyBattlefieldNoSuccess"));
      return;
    }

    const fatiguePenalty = system.fatiguePenalty || 0;
    const woundPenalty = system.woundPenalty || 0;
    const effectiveSuccesses = Math.max(0, skillValue - fatiguePenalty - woundPenalty);

    if (effectiveSuccesses > 0) {
      // Accumulate into the shared pool (see character path)
      const existing = game.combat.getFlag("sword", "tacticalAdvantages");
      await game.combat.setFlag("sword", "tacticalAdvantages", {
        sourceActorId: actor.id,
        sourceActorName: actor.name,
        remaining: (existing?.remaining ?? 0) + effectiveSuccesses
      });
    }

    await combatant.setFlag("sword", "hasStudiedBattlefield", true);

    const resultText = effectiveSuccesses > 0
      ? `<strong>${actor.name}</strong> ${game.i18n.localize("SWORD.Combat.StudyBattlefieldResult")} <strong>${effectiveSuccesses}</strong>`
      : `<strong>${actor.name}</strong> ${game.i18n.localize("SWORD.Combat.StudyBattlefieldNoSuccess")}`;

    // Consume standard action
    await game.combat.consumeAction(actor);

    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `
        <div class="sword chat-card">
          <header class="card-header">
            <img src="${actor.img}" width="36" height="36" />
            <div class="card-header-text">
              <h3><i class="fas fa-chess"></i> ${game.i18n.localize("SWORD.Combat.StudyBattlefield")}</h3>
            </div>
          </header>
          <div class="result-section ${effectiveSuccesses > 0 ? "passed" : "failed"}">
            <p>${resultText}</p>
          </div>
        </div>
      `
    });
    return;
  }

  // Character: arte_della_guerra skill check
  const skillId = "arte_della_guerra";
  const skillData = system.skills[skillId];
  if (!skillData) {
    ui.notifications.error(`Abilità non trovata: ${skillId}`);
    return;
  }

  const charKey = SKILL_MAP[skillId];
  const effectiveCharKey = charKey === "varies" ? (skillData.specialtyChar || "mens") : charKey;
  const charScore = system.effectiveCharacteristics?.[effectiveCharKey] ?? system.characteristics[effectiveCharKey];
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);

  const grade = skillData.grade;
  const extraDice = skillData.extraDice;  // focus dice selected contextually in dialog
  const isUntrained = grade === 0 && extraDice === 0;
  const allFoci = collectAllFoci(system);

  // Penalties
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const equippedArmor = Array.from(actor.items).find(i => i.type === "armor");
  const armorPenalty = equippedArmor
    ? armorSkillPenalty(equippedArmor.system.protezione || 0, equippedArmor.system.pregi || [], skillId)
    : 0;
  const basePenalty = fatiguePenalty + woundPenalty + encumbrancePenalty + armorPenalty;
  const spirito = system.resources.spirito;

  const penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value);

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${game.i18n.localize("SWORD.Combat.StudyBattlefield")}</strong></p>
      <p class="hint">${skillLabel} (${charScore}), ${game.i18n.localize("SWORD.Grade")}: ${grade}</p>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
      </div>
      ${penaltyHtml}
      ${buildFocusDialogHtml(allFoci)}
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("SWORD.Combat.StudyBattlefield") },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Combat.StudyBattlefield"),
      icon: "fa-solid fa-chess",
      callback: (event, button) => {
        const form = button.form;
        return {
          diceCount: parseInt(form.elements.diceCount.value) || 2,
          spiritoCancelPenalty: parseInt(form.elements.spiritoCancelPenalty?.value) || 0,
          focusDice: countSelectedFoci(form, allFoci.length)
        };
      }
    }
  });

  if (!result) return;

  let { diceCount, spiritoCancelPenalty, focusDice } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
  spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);

  const effectivePenalty = basePenalty - spiritoCancelPenalty;
  const totalExtraDice = extraDice + focusDice;
  const totalDice = diceCount + totalExtraDice;

  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  const engineOutput = swordCheckResolve({
    characteristicScore: charScore,
    diceCount,
    grade,
    extraDice: totalExtraDice,
    successBonus: 0,
    successPenalty: effectivePenalty,
    difficultyThreshold: null,
    opposedSuccesses: null,
    diceRolled,
    discardIndices: null
  });

  // Deduct spirito
  if (spiritoCancelPenalty > 0) {
    await actor.update({
      "system.resources.spirito.value": spirito.value - spiritoCancelPenalty
    });
  }

  // Store tactical advantages if check passed — accumulate into the shared
  // pool: a second studier must not wipe the first one's unspent advantages
  const advantages = engineOutput.basePassed ? engineOutput.finalSuccesses : 0;
  if (advantages > 0) {
    const existing = game.combat.getFlag("sword", "tacticalAdvantages");
    await game.combat.setFlag("sword", "tacticalAdvantages", {
      sourceActorId: actor.id,
      sourceActorName: actor.name,
      remaining: (existing?.remaining ?? 0) + advantages
    });
  }

  await combatant.setFlag("sword", "hasStudiedBattlefield", true);

  // Consume standard action
  await game.combat.consumeAction(actor);

  const resultText = advantages > 0
    ? `<strong>${actor.name}</strong> ${game.i18n.localize("SWORD.Combat.StudyBattlefieldResult")} <strong>${advantages}</strong>`
    : `<strong>${actor.name}</strong> ${game.i18n.localize("SWORD.Combat.StudyBattlefieldNoSuccess")}`;

  // Chat card with dice display
  const html = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${actor.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas fa-chess"></i> ${game.i18n.localize("SWORD.Combat.StudyBattlefield")}</h3>
          <span class="char-info">${skillLabel} (${charScore})</span>
        </div>
      </header>
      <div class="dice-section">
        <div class="dice-row">
          <div class="dice-pool">
            ${engineOutput.diceAfterReduction.map(d =>
              `<span class="die ${d === 1 ? "is-one" : ""}">${d}</span>`
            ).join("")}
          </div>
        </div>
      </div>
      <div class="result-section ${advantages > 0 ? "passed" : "failed"}">
        <p>${resultText}</p>
      </div>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}
