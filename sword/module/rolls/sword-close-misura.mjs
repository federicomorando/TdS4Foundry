/**
 * Close Misura (Chiudere la Misura) dedicated action.
 *
 * A combatant whose weapon is fuori misura (too short for current engagement)
 * attempts to close the distance. Uses Agilita opposed by defender's weapon skill.
 *
 * Flow:
 * 1. Validate: active combat, target selected, weapon fuori misura
 * 2. Post GM prompt: defender gets free attack (cumulative penalty)
 * 3. Agilita opposed check vs defender skill
 * 4. Winner deals damage (net successes + weapon damage)
 * 5. On attacker win: engagement misura changes to attacker weapon's misura
 *
 * Pattern follows sword-rifiatare.mjs for standalone actions.
 */
import { swordCheckResolve } from "../engine.mjs";
import {
  MISURA_ORDER, isFuoriMisura, initialEngagementMisura, resolveDamage,
  distributeWounds, computeTalentCombatBonus
} from "../engine.mjs";
import { SKILL_MAP } from "../data/actor.mjs";
import { armorSkillPenalty } from "../engine.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { CREATURE_MISURA_MAP } from "../engine.mjs";
import { buildPenaltyHtml } from "./dialog-helpers.mjs";

/** Get defender's primary melee weapon misura (longest reach). */
function _getDefenderPrimaryMisura(targetActor) {
  if (!targetActor) return "M";
  if (targetActor.type === "creature") {
    const attacks = targetActor.system.attacks || [];
    for (const atk of attacks) {
      if (!atk.misura) continue;
      return CREATURE_MISURA_MAP[atk.misura] ?? "M";
    }
    return "M";
  }
  let bestIdx = MISURA_ORDER.length;
  for (const item of targetActor.items) {
    if (item.type !== "weapon") continue;
    if (item.system.gittata > 0) continue;
    const m = item.system.misura;
    if (!m) continue;
    const idx = MISURA_ORDER.indexOf(m);
    if (idx >= 0 && idx < bestIdx) bestIdx = idx;
  }
  return bestIdx < MISURA_ORDER.length ? MISURA_ORDER[bestIdx] : "M";
}

/**
 * Execute Close Misura for an actor.
 * @param {Actor} actor - The acting character or creature attempting to close distance
 */
export async function swordCloseMisura(actor) {
  // Validate: active combat
  if (!game.combat) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.CloseMisuraNoCombat"));
    return;
  }

  // Validate: target selected
  const targets = game.user.targets;
  if (!targets.size) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.CloseMisuraNoTarget"));
    return;
  }

  const targetToken = targets.first();
  const targetActor = targetToken.actor;
  if (!targetActor) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.CloseMisuraNoTarget"));
    return;
  }

  // Find attacker's primary melee weapon
  let attackerWeapon = null;
  if (actor.type === "creature") {
    const attacks = actor.system.attacks || [];
    for (const atk of attacks) {
      if (atk.misura) {
        attackerWeapon = atk;
        break;
      }
    }
  } else {
    for (const item of actor.items) {
      if (item.type !== "weapon") continue;
      if (item.system.gittata > 0) continue;
      attackerWeapon = item;
      break;
    }
  }

  if (!attackerWeapon) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.CloseMisuraNoTarget"));
    return;
  }

  // Get weapon misura
  const weaponMisura = actor.type === "creature"
    ? (CREATURE_MISURA_MAP[attackerWeapon.misura] ?? "M")
    : (attackerWeapon.system.misura ?? "M");

  // Get engagement misura (compute initial if not yet set)
  let engagementMisura = game.combat.getEngagementMisura(actor, targetActor);
  if (!engagementMisura) {
    // Compute initial engagement from both combatants' weapons
    const defenderMisura = _getDefenderPrimaryMisura(targetActor);
    engagementMisura = initialEngagementMisura(weaponMisura, defenderMisura);
    // Persist it
    await game.combat.setEngagementMisura(actor, targetActor, engagementMisura);
  }

  // Validate: weapon IS fuori misura (too short)
  if (!isFuoriMisura(weaponMisura, engagementMisura)) {
    ui.notifications.info(game.i18n.localize("SWORD.Combat.CloseMisuraAlreadyInRange"));
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
  const combatant = game.combat.resolveCombatant(actor);

  // Cumulative penalty from previous attempts this round
  const closeMisuraAttempts = combatant?.getFlag("sword", "closeMisuraAttempts") ?? 0;

  // Post GM prompt: defender gets free attack
  const freeAttackMsg = closeMisuraAttempts > 0
    ? `${game.i18n.localize("SWORD.Combat.CloseMisuraFreeAttack")} ${game.i18n.localize("SWORD.Combat.CloseMisuraFreeAttackPenalty").replace("{penalty}", closeMisuraAttempts)}`
    : game.i18n.localize("SWORD.Combat.CloseMisuraFreeAttack");

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `
      <div class="sword chat-card">
        <header class="card-header">
          <img src="${actor.img}" width="36" height="36" />
          <div class="card-header-text">
            <h3><i class="fas fa-arrows-left-right"></i> ${game.i18n.localize("SWORD.Combat.CloseMisuraAction")}</h3>
          </div>
        </header>
        <div class="result-section">
          <p><i class="fas fa-exclamation-triangle"></i> ${freeAttackMsg}</p>
        </div>
      </div>
    `
  });

  if (isCreature) {
    // Creature: fixed agilita successes vs defender
    const agilita = system.abilities?.agilita ?? 0;
    const fatiguePenalty = system.fatiguePenalty || 0;
    const woundPenalty = system.woundPenalty || 0;
    const effectiveSuccesses = Math.max(0, agilita - fatiguePenalty - woundPenalty);

    // Defender's opposition
    let defenderSuccesses;
    if (targetActor.type === "creature") {
      const defSkills = targetActor.system.skills || {};
      const defAttacks = targetActor.system.attacks || [];
      defenderSuccesses = defAttacks.length > 0
        ? (defSkills[defAttacks[0].skill] || 0)
        : (targetActor.system.abilities?.agilita ?? 0);
    } else {
      // Character defender: use their best melee weapon skill
      let defSkillId = "agilita";
      for (const item of targetActor.items) {
        if (item.type !== "weapon" || item.system.gittata > 0) continue;
        defSkillId = item.system.skillId;
        break;
      }
      defenderSuccesses = targetActor.system.skills[defSkillId]?.grade ?? 0;
    }

    const netSuccesses = effectiveSuccesses - defenderSuccesses;
    const attackerWins = netSuccesses > 0;

    // Apply engagement change on win
    if (attackerWins) {
      await game.combat.setEngagementMisura(actor, targetActor, weaponMisura);
    }

    // Increment attempts
    if (combatant) {
      await combatant.setFlag("sword", "closeMisuraAttempts", closeMisuraAttempts + 1);
    }

    // Consume standard action
    await game.combat.consumeAction(actor);

    const misuraLabel = game.i18n.localize(`SWORD.Combat.Misura.${weaponMisura}`);
    const resultText = attackerWins
      ? `<strong>${actor.name}</strong> ${game.i18n.localize("SWORD.Combat.CloseMisuraWin").replace("{misura}", misuraLabel)}`
      : `<strong>${actor.name}</strong> ${game.i18n.localize("SWORD.Combat.CloseMisuraLose")}`;

    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `
        <div class="sword chat-card">
          <header class="card-header">
            <img src="${actor.img}" width="36" height="36" />
            <div class="card-header-text">
              <h3><i class="fas fa-arrows-left-right"></i> ${game.i18n.localize("SWORD.Combat.CloseMisuraAction")}</h3>
            </div>
          </header>
          <div class="result-section ${attackerWins ? "passed" : "failed"}">
            <p>${resultText}</p>
          </div>
        </div>
      `
    });
    return;
  }

  // Character: Agilita skill check
  const skillId = "agilita";
  const skillData = system.skills[skillId];
  if (!skillData) {
    ui.notifications.error(`Abilità non trovata: ${skillId}`);
    return;
  }

  const charKey = SKILL_MAP[skillId];
  const charScore = system.effectiveCharacteristics?.[charKey] ?? system.characteristics[charKey];
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);

  const grade = skillData.grade;
  const extraDice = skillData.extraDice;  // focus dice selected contextually in dialog
  const isUntrained = grade === 0 && extraDice === 0;
  const allFoci = collectAllFoci(system);

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

  // Defender's opposed successes
  let opposedSuccesses;
  if (targetActor.type === "creature") {
    const defSkills = targetActor.system.skills || {};
    const defAttacks = targetActor.system.attacks || [];
    opposedSuccesses = defAttacks.length > 0
      ? (defSkills[defAttacks[0].skill] || 0)
      : (targetActor.system.abilities?.agilita ?? 0);
  } else {
    let defSkillId = "agilita";
    for (const item of targetActor.items) {
      if (item.type !== "weapon" || item.system.gittata > 0) continue;
      defSkillId = item.system.skillId;
      break;
    }
    const defSkillData = targetActor.system.skills[defSkillId];
    // For opposed check, use defender's grade as their successes
    opposedSuccesses = defSkillData?.grade ?? 0;
  }

  const engMisuraLabel = game.i18n.localize(`SWORD.Combat.Misura.${engagementMisura}`);
  const wepMisuraLabel = game.i18n.localize(`SWORD.Combat.Misura.${weaponMisura}`);

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${game.i18n.localize("SWORD.Combat.CloseMisuraAction")}</strong></p>
      <p class="hint">${game.i18n.localize("SWORD.Combat.EngagementMisura")}: ${engMisuraLabel} → ${wepMisuraLabel}</p>
      <p class="hint">${skillLabel} (${charScore}), ${game.i18n.localize("SWORD.Grade")}: ${grade}</p>
      <p class="hint">vs. ${targetActor.name} (${opposedSuccesses})</p>
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
    window: { title: game.i18n.localize("SWORD.Combat.CloseMisuraAction") },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Combat.CloseMisuraAction"),
      icon: "fa-solid fa-arrows-left-right",
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

  // Polearm mastery: +1 success when restoring misura with a polearm
  const polearmMasteryBonus = (attackerWeapon.system?.weaponType === "asta"
    && system.talentSpecials?.has("weapon_mastery_polearm")) ? 1 : 0;

  const engineOutput = swordCheckResolve({
    characteristicScore: charScore,
    diceCount,
    grade,
    extraDice: totalExtraDice,
    successBonus: polearmMasteryBonus,
    successPenalty: effectivePenalty,
    difficultyThreshold: null,
    opposedSuccesses,
    diceRolled,
    discardIndices: null
  });

  // Deduct spirito
  if (spiritoCancelPenalty > 0) {
    await actor.update({
      "system.resources.spirito.value": spirito.value - spiritoCancelPenalty
    });
  }

  const attackerWins = engineOutput.netSuccesses > 0;

  // Apply engagement change on win
  if (attackerWins) {
    await game.combat.setEngagementMisura(actor, targetActor, weaponMisura);
  }

  // Increment attempts
  if (combatant) {
    await combatant.setFlag("sword", "closeMisuraAttempts", closeMisuraAttempts + 1);
  }

  // Consume standard action
  await game.combat.consumeAction(actor);

  const misuraLabel = game.i18n.localize(`SWORD.Combat.Misura.${weaponMisura}`);
  const resultText = attackerWins
    ? `${game.i18n.localize("SWORD.Combat.CloseMisuraWin").replace("{misura}", misuraLabel)}`
    : game.i18n.localize("SWORD.Combat.CloseMisuraLose");

  const html = await renderTemplate(
    "systems/sword/templates/chat/close-misura-result.hbs",
    {
      actorName: actor.name,
      actorImg: actor.img,
      targetName: targetActor.name,
      skillLabel,
      ...engineOutput,
      grade,
      extraDice,
      diceAfterReductionDisplay: engineOutput.diceAfterReduction.map(d => ({
        value: d, isOne: d === 1
      })),
      attackerWins,
      resultText,
      engagementMisuraLabel: engMisuraLabel,
      targetMisuraLabel: wepMisuraLabel,
      hasPenalty: basePenalty > 0,
      fatiguePenalty,
      woundPenalty,
      encumbrancePenalty,
      armorPenalty,
      penaltyCancelled: spiritoCancelPenalty,
      effectivePenalty,
      opposedSuccesses
    }
  );

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}
