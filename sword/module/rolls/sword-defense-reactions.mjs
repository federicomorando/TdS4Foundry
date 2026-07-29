import { resolveDamage, distributeWounds, computeTalentCombatBonus, computeAccompagnataParryBonus, GRAPPLE_FREE_STRIKE_BONUS, computePesanteRiflessiCost, computeReactionRiflessiCost } from "../engine.mjs";
import { resolveDefenseCheck } from "../engine.mjs";
import { SKILL_MAP } from "../data/actor.mjs";
import { armorSkillPenalty, weaponQualityBonus } from "../engine.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { buildPenaltyHtml, buildCombatApproachHtml, formInt, formStr, formBool } from "./dialog-helpers.mjs";
import { APPROACH_MODS } from "../engine.mjs";

/**
 * Forza reaction defense against disarm/push.
 * @param {Actor} actor - The defending actor
 * @param {object} attackData - Attack flags from the chat message
 */
export async function _defendReaction(actor, attackData) {
  const { finalSuccesses: attackSuccesses, weaponName: attackWeaponName } = attackData;
  const specialMove = attackData.specialMove;
  const system = actor.system;
  const isCreature = actor.type === "creature";

  const defenseLabel = game.i18n.localize("SWORD.Combat.ReactionForza");

  if (isCreature) {
    // Creature: fixed forza successes
    const defenseSuccesses = system.abilities?.forza ?? 0;
    const fatiguePenalty = system.fatiguePenalty || 0;
    const woundPenalty = system.woundPenalty || 0;
    const basePenalty = fatiguePenalty + woundPenalty;
    const effectiveSuccesses = Math.max(0, defenseSuccesses - basePenalty);
    const netSuccesses = effectiveSuccesses - attackSuccesses;
    const defenseSucceeded = netSuccesses >= 0;

    // Deduct Riflessi: threat - net successes (errata §4.6 line 2148) — only in combat
    const updateData = {};
    const riflessi = system.resources.riflessi;
    const riflessiCost = game.combat ? computeReactionRiflessiCost(attackSuccesses, netSuccesses) : 0;
    if (riflessiCost > 0) {
      updateData["system.resources.riflessi.value"] = riflessi.value - riflessiCost;
    }

    const specialMoveResult = _computeReactionOutcome(specialMove, defenseSucceeded, netSuccesses, attackSuccesses, attackData, system, actor);
    _applyReactionOutcome(specialMoveResult, updateData, system, attackData);

    if (Object.keys(updateData).length > 0) {
      await actor.update(updateData);
    }

    const chatData = {
      actorName: actor.name,
      actorImg: actor.img,
      defenseLabel,
      defenseType: "reactionForza",
      attackWeaponName,
      attackSuccesses,
      skillLabel: game.i18n.localize("SWORD.Skills.forza"),
      isCreature: true,
      defenseSuccesses,
      effectiveSuccesses,
      finalSuccesses: effectiveSuccesses,
      netSuccesses,
      defenseSucceeded,
      hasPenalty: basePenalty > 0,
      fatiguePenalty,
      woundPenalty,
      armorPenalty: 0,
      penaltyCancelled: 0,
      effectivePenalty: basePenalty,
      riflessiCost,
      isFreeShieldParry: false,
      hasDamage: false,
      specialMove,
      specialMoveResult,
      isDisarmResult: specialMoveResult?.type === "disarm",
      isPushResult: specialMoveResult?.type === "push"
    };

    const html = await renderTemplate("systems/sword/templates/chat/defense-result.hbs", chatData);
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: html
    });
    return;
  }

  // Character: Forza skill check
  const skillId = "forza";
  const skillData = system.skills[skillId];
  if (!skillData) {
    ui.notifications.error(`Abilità non trovata: ${skillId}`);
    return;
  }

  const charKey = SKILL_MAP[skillId];
  const charScore = system.effectiveCharacteristics?.[charKey] ?? system.characteristics[charKey];
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);

  const grade = skillData.grade;
  const allFoci = collectAllFoci(system);
  const extraDice = skillData.extraDice;
  const isUntrained = grade === 0 && extraDice === 0;

  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const equippedArmor = Array.from(actor.items).find(i => i.type === "armor");
  const armorPenalty = equippedArmor
    ? armorSkillPenalty(equippedArmor.system.protezione || 0, equippedArmor.system.pregi || [], skillId)
    : 0;
  const basePenalty = fatiguePenalty + woundPenalty + armorPenalty + encumbrancePenalty;
  const spirito = system.resources.spirito;

  const penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value);

  const specialMoveLabel = specialMove === "disarm"
    ? game.i18n.localize("SWORD.Combat.MoveDisarm")
    : game.i18n.localize("SWORD.Combat.MovePush");

  // Ombra: option to spend Spirito instead of Riflessi
  const hasSpiritoForReactionsForza = !!system.talentSpecials?.has("spirito_for_reactions");
  const spiritoOptionHtmlForza = hasSpiritoForReactionsForza ? `
    <div class="form-group">
      <label><input type="checkbox" name="useSpiritoForRiflessi" checked /> ${game.i18n.localize("SWORD.Talent.SpiritoForRiflessi")}</label>
    </div>` : "";

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${defenseLabel}</strong> vs. ${attackWeaponName} (${attackSuccesses} ${game.i18n.localize("SWORD.Chat.Successes").toLowerCase()})</p>
      <p class="hint">${specialMoveLabel}</p>
      <p class="hint">${skillLabel} (${charScore}), ${game.i18n.localize("SWORD.Grade")}: ${grade}</p>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
      </div>
      ${penaltyHtml}
      ${spiritoOptionHtmlForza}
      ${buildFocusDialogHtml(allFoci)}
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format("SWORD.Combat.DefenseTitle", { type: defenseLabel }) },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Combat.DefendBtn"),
      icon: "fa-solid fa-hand-fist",
      callback: (event, button) => {
        const form = button.form;
        return {
          diceCount: formInt(form, "diceCount", 2),
          spiritoCancelPenalty: formInt(form, "spiritoCancelPenalty"),
          useSpiritoForRiflessi: formBool(form, "useSpiritoForRiflessi"),
          focusDice: countSelectedFoci(button.form, allFoci.length)
        };
      }
    }
  });

  if (!result) return;

  let { diceCount, spiritoCancelPenalty, useSpiritoForRiflessi, focusDice } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
  spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);

  const effectivePenalty = basePenalty - spiritoCancelPenalty;
  const successPenalty = effectivePenalty;
  const totalExtraDice = extraDice + focusDice;
  const totalDice = diceCount + totalExtraDice;

  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  // --- Defense check via use-case ---
  const riflessi = system.resources.riflessi;
  const defCheckResult = resolveDefenseCheck(
    { finalSuccesses: attackSuccesses },
    {
      characteristicScore: charScore, diceCount, grade, extraDice, focusDice,
      approach: "corsa", parryModifier: 0, spiritoCancelPenalty,
      defenseMode: "schivata",
      hasRiflessiCostMinus1: !!system.talentSpecials?.has("riflessi_cost_minus1"),
      useSpiritoForRiflessi
    },
    { fatiguePenalty, woundPenalty, armorPenalty, encumbrancePenalty, spirito: spirito.value, riflessi: riflessi.value },
    diceRolled
  );
  const engineOutput = defCheckResult.engineOutput;
  const riflessiCost = defCheckResult.riflessiCost;
  const defenseSucceeded = defCheckResult.defenseSucceeded;
  const netSuccesses = engineOutput.netSuccesses;

  const updateData = {};
  for (const [key, value] of Object.entries(defCheckResult.patches)) {
    if (key.startsWith("resources.")) {
      updateData[`system.${key}.value`] = value;
    } else {
      updateData[`system.${key}`] = value;
    }
  }

  const specialMoveResult = _computeReactionOutcome(specialMove, defenseSucceeded, netSuccesses, attackSuccesses, attackData, system, actor);
  _applyReactionOutcome(specialMoveResult, updateData, system, attackData);

  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    defenseLabel,
    defenseType: "reactionForza",
    attackWeaponName,
    attackSuccesses,
    skillLabel,
    ...engineOutput,
    grade,
    extraDice,
    diceAfterReductionDisplay: engineOutput.diceAfterReduction.map(d => ({
      value: d, isOne: d === 1
    })),
    defenseSucceeded,
    hasPenalty: basePenalty > 0,
    fatiguePenalty,
    woundPenalty,
    armorPenalty,
    encumbrancePenalty,
    penaltyCancelled: spiritoCancelPenalty,
    effectivePenalty,
    riflessiCost,
    isFreeShieldParry: false,
    hasDamage: false,
    specialMove,
    specialMoveResult,
    isDisarmResult: specialMoveResult?.type === "disarm",
    isPushResult: specialMoveResult?.type === "push"
  };

  const html = await renderTemplate("systems/sword/templates/chat/defense-result.hbs", chatData);
  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}

/**
 * Compute outcome for a disarm/push reaction.
 */
export function _computeReactionOutcome(specialMove, defenseSucceeded, netSuccesses, attackSuccesses, attackData, system, actor) {
  if (defenseSucceeded) {
    // Defender resisted
    return { type: specialMove, success: false };
  }
  const netAttackSuccesses = -netSuccesses;

  if (specialMove === "disarm") {
    return { type: "disarm", success: true, flyDistance: netAttackSuccesses };
  }
  if (specialMove === "push") {
    const thrown = netAttackSuccesses >= 3;
    let pushWounds = 0;
    if (thrown) {
      const armorProt = actor.type === "creature"
        ? (system.protezione ?? 0)
        : (Array.from(actor.items).find(i => i.type === "armor")?.system.protezione ?? 0);
      pushWounds = Math.max(0, netAttackSuccesses - armorProt);
    }
    return {
      type: "push", success: true,
      riflessiLost: netAttackSuccesses,
      thrown,
      pushWounds
    };
  }
  return null;
}

/**
 * Apply reaction outcome to actor update data.
 */
export function _applyReactionOutcome(result, updateData, system, attackData) {
  if (!result || !result.success) return;

  if (result.type === "push") {
    // Deduct additional Riflessi from push (combat only)
    if (game.combat) {
      const currentRiflessi = updateData["system.resources.riflessi.value"] ?? system.resources.riflessi.value;
      updateData["system.resources.riflessi.value"] = currentRiflessi - result.riflessiLost;
    }
    // Push wounds are handled by GM (thrown to ground)

    // Successful push modifies engagement Misura to attacker's weapon (errata §5.3 line 2559)
    if (game.combat && attackData?.attackerId && attackData?.targetActorId) {
      const newMisura = attackData.weaponMisura || "M";
      game.combat.setEngagementMisura(attackData.attackerTokenId || attackData.attackerId, attackData.targetTokenId || attackData.targetActorId, newMisura);
    }
  }
  // Disarm: weapon removal is GM-managed (chat notification only)
}

/**
 * Parata Accompagnata: dual-weapon parry for characters.
 * Combines parry modifiers from two items; on 4+ net successes, auto-disarms attacker.
 * Costs the free action (secondary weapon sacrifice).
 */
export async function _defendParataAccompagnata(actor, attackData) {
  // Accompagnata costs the free action
  if (game.combat && !game.combat.hasFreeActionAvailable(actor)) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoFreeActionAvailable"));
      return;
    }
    ui.notifications.info(game.i18n.localize("SWORD.Combat.GMActionOverride"));
  }

  const system = actor.system;

  // Find parry-capable items (weapons with parryModifier + shields)
  const parryItems = Array.from(actor.items).filter(i =>
    (i.type === "weapon" || i.type === "shield") && i.system.parryModifier !== undefined
  );

  // Check for Lotta eligibility (unarmed dual-parry)
  const lottaGrade = system.skills.lotta?.grade ?? 0;
  const canLotta = lottaGrade >= 1;

  if (parryItems.length < 2 && !canLotta) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.ParataAccompagnataNoItems"));
    return;
  }

  // Determine parry items — let player pick two if more available
  let item1, item2, skillId, combinedParryMod;

  if (parryItems.length >= 2) {
    // Pick two items
    if (parryItems.length === 2) {
      item1 = parryItems[0];
      item2 = parryItems[1];
    } else {
      // Let player pick two from multiple items
      const options = parryItems.map(i => {
        const mod = i.system.parryModifier >= 0 ? `+${i.system.parryModifier}` : i.system.parryModifier;
        return `<option value="${i.id}">${i.name} (${mod})</option>`;
      }).join("");

      const pickResult = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("SWORD.Combat.ParataAccompagnata") },
        content: `
          <div class="sword-roll-dialog">
            <div class="form-group">
              <label>${game.i18n.localize("SWORD.Combat.ParryWeapon")} 1</label>
              <select name="parryItem1">${options}</select>
            </div>
            <div class="form-group">
              <label>${game.i18n.localize("SWORD.Combat.ParryWeapon")} 2</label>
              <select name="parryItem2">${options}</select>
            </div>
          </div>
        `,
        ok: {
          label: game.i18n.localize("SWORD.Combat.DefendBtn"),
          callback: (event, button) => ({
            id1: button.form.elements.parryItem1.value,
            id2: button.form.elements.parryItem2.value
          })
        }
      });
      if (!pickResult) return;
      if (pickResult.id1 === pickResult.id2) {
        ui.notifications.warn(game.i18n.localize("SWORD.Combat.ParataAccompagnataNoItems"));
        return;
      }
      item1 = actor.items.get(pickResult.id1);
      item2 = actor.items.get(pickResult.id2);
    }

    combinedParryMod = computeAccompagnataParryBonus(
      item1.system.parryModifier || 0,
      item2.system.parryModifier || 0
    );
    // Use primary weapon's skill for weapons, or armi_da_guerra for shields
    skillId = item1.type === "shield"
      ? (item2.type === "shield" ? "armi_da_guerra" : item2.system.skillId)
      : item1.system.skillId;
  } else {
    // Unarmed (Lotta) + one weapon/shield, or pure unarmed
    item1 = parryItems[0] || null;
    item2 = null;
    const unarmedParry = -1; // standard Lotta parry modifier
    combinedParryMod = computeAccompagnataParryBonus(
      item1 ? (item1.system.parryModifier || 0) : unarmedParry,
      unarmedParry
    );
    skillId = "lotta";
  }

  const skillData = system.skills[skillId];
  if (!skillData) {
    ui.notifications.error(`Abilità non trovata: ${skillId}`);
    return;
  }

  const { finalSuccesses: attackSuccesses, damageValue, damageType, weaponName: attackWeaponName } = attackData;
  const specialMove = attackData.specialMove || null;

  const charKey = SKILL_MAP[skillId];
  const effectiveCharKey = charKey === "varies" ? (skillData.specialtyChar || "mens") : charKey;
  const baseCharScore = system.effectiveCharacteristics?.[effectiveCharKey] ?? system.characteristics[effectiveCharKey];
  // Apply weapon quality modifier from the primary parry item (the one determining the skill)
  const accompPrimaryItem = (item1 && item1.type !== "shield") ? item1 : item2;
  const accompQualityMod = accompPrimaryItem ? weaponQualityBonus(accompPrimaryItem.system.quality) : 0;
  const charScore = baseCharScore + accompQualityMod;
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);

  const grade = skillData.grade;
  const allFoci = collectAllFoci(system);
  const extraDice = skillData.extraDice;
  const isUntrained = grade === 0 && extraDice === 0;

  // Penalties
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const equippedArmor = Array.from(actor.items).find(i => i.type === "armor");
  const armorPenalty = equippedArmor
    ? armorSkillPenalty(equippedArmor.system.protezione || 0, equippedArmor.system.pregi || [], skillId)
    : 0;
  const basePenalty = fatiguePenalty + woundPenalty + armorPenalty + encumbrancePenalty;
  const spirito = system.resources.spirito;

  const penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value);

  const defenseLabel = game.i18n.localize("SWORD.Combat.ParataAccompagnata");
  const defenseItemName = item1 && item2
    ? `${item1.name} + ${item2.name}`
    : item1 ? `${item1.name} + Lotta` : "Lotta";

  const approachHtml = buildCombatApproachHtml();

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${defenseLabel}</strong> vs. ${attackWeaponName} (${attackSuccesses} ${game.i18n.localize("SWORD.Chat.Successes").toLowerCase()})</p>
      <p class="hint">${defenseItemName} (${game.i18n.localize("SWORD.Combat.AccompagnataParryBonus")}: ${combinedParryMod >= 0 ? "+" : ""}${combinedParryMod})</p>
      <p class="hint">${skillLabel} (${charScore}), ${game.i18n.localize("SWORD.Grade")}: ${grade}</p>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
      </div>
      ${approachHtml}
      ${penaltyHtml}
      ${buildFocusDialogHtml(allFoci)}
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: {
      title: game.i18n.format("SWORD.Combat.DefenseTitle", { type: defenseLabel })
    },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Combat.DefendBtn"),
      icon: "fa-solid fa-shield-halved",
      callback: (event, button) => {
        const form = button.form;
        return {
          diceCount: formInt(form, "diceCount", 2),
          spiritoCancelPenalty: formInt(form, "spiritoCancelPenalty"),
          approach: formStr(form, "approach", "corsa"),
          focusDice: countSelectedFoci(button.form, allFoci.length)
        };
      }
    }
  });

  if (!result) return;

  let { diceCount, spiritoCancelPenalty, approach, focusDice } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
  spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);

  const effectivePenalty = basePenalty - spiritoCancelPenalty;
  const approachMod = APPROACH_MODS[approach] || APPROACH_MODS.corsa;

  // Talent parry bonus
  const defHasShield = Array.from(actor.items).some(i => i.type === "shield");
  const defCombatCtx = {
    skillId,
    isRanged: false,
    weaponCategory: item1?.system?.category,
    weaponType: item1?.system?.weaponType,
    weaponHands: item1?.system?.hands,
    hasShield: defHasShield,
    hasArmor: !!equippedArmor,
    mounted: false
  };
  const talentParryBonus = computeTalentCombatBonus(system.talents, "parryMod", defCombatCtx);

  const totalDefBonus = combinedParryMod + approachMod.defMod + talentParryBonus;
  const successBonus = Math.max(0, totalDefBonus);
  const successPenalty = effectivePenalty + Math.max(0, -totalDefBonus);

  const totalExtraDice = extraDice + focusDice;
  const totalDice = diceCount + totalExtraDice;

  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  // --- Defense check via use-case ---
  const riflessi = system.resources.riflessi;
  const defCheckResult = resolveDefenseCheck(
    { finalSuccesses: attackSuccesses },
    {
      characteristicScore: charScore, diceCount, grade, extraDice, focusDice,
      approach, parryModifier: 0, spiritoCancelPenalty,
      defenseMode: "accompagnata",
      talentParryBonus, talentSuccessBonus: 0,
      hasRiflessiCostMinus1: false, useSpiritoForRiflessi: false,
      isAccompagnata: true, accompagnataParryMod: combinedParryMod
    },
    { fatiguePenalty, woundPenalty, armorPenalty, encumbrancePenalty, spirito: spirito.value, riflessi: riflessi.value },
    diceRolled
  );
  const engineOutput = defCheckResult.engineOutput;
  const riflessiCost = defCheckResult.riflessiCost;
  const newRiflessi = riflessi.value;

  // Map check patches
  const updateData = {};
  for (const [key, value] of Object.entries(defCheckResult.patches)) {
    if (key.startsWith("resources.")) {
      updateData[`system.${key}.value`] = value;
    } else {
      updateData[`system.${key}`] = value;
    }
  }

  // Consume free action
  if (game.combat) await game.combat.consumeFreeAction(actor);

  const defenseSucceeded = engineOutput.netSuccesses >= 0;

  // Damage on defense failure (same as normal parata)
  let damageResult = null;
  let woundsApplied = 0;
  let talentDmgBonus = 0;
  let talentProtBonus = 0;
  let specialMoveResult = null;
  const oldCritiche = system.woundLevels.critiche;
  const oldMortali = system.woundLevels.mortali;
  let newWounds = null;

  if (!defenseSucceeded) {
    const netAttackSuccesses = -engineOutput.netSuccesses;

    if (specialMove === "nonLethal") {
      const fatica = system.resources.fatica;
      const newFatica = Math.max(0, fatica.value - netAttackSuccesses);
      updateData["system.resources.fatica.value"] = newFatica;
      // Fatigue overflow → wounds
      let faticaOverflowWounds = Math.max(0, netAttackSuccesses - fatica.value);
      if (faticaOverflowWounds > 0 && system.talentSpecials?.has("halve_excess_fatica_wounds")) {
        faticaOverflowWounds = Math.ceil(faticaOverflowWounds / 2);
      }
      if (faticaOverflowWounds > 0) {
        const overflowWoundDist = distributeWounds(system.woundLevels, system.woundCapacities, faticaOverflowWounds);
        updateData["system.woundLevels.graffi"] = overflowWoundDist.graffi;
        updateData["system.woundLevels.leggere"] = overflowWoundDist.leggere;
        updateData["system.woundLevels.gravi"] = overflowWoundDist.gravi;
        updateData["system.woundLevels.critiche"] = overflowWoundDist.critiche;
        updateData["system.woundLevels.mortali"] = overflowWoundDist.mortali;
      }
      specialMoveResult = { type: "nonLethal", faticaInflicted: netAttackSuccesses, overflowWounds: faticaOverflowWounds || 0 };
    } else if (specialMove === "feint") {
      let riflessiLoss = netAttackSuccesses;
      const attackerPregi = attackData.weaponPregi || [];
      if (attackerPregi.includes("agganciare")) riflessiLoss += 1;
      updateData["system.resources.riflessi.value"] =
        (updateData["system.resources.riflessi.value"] ?? newRiflessi) - riflessiLoss;
      specialMoveResult = { type: "feint", riflessiLost: riflessiLoss, agganciare: attackerPregi.includes("agganciare") };
    } else if (specialMove === "grapple") {
      // Grapple (Presa): no damage — establish grapple at Abrazzar
      if (game.combat && attackData.attackerId) {
        await game.combat.setEngagementMisura(attackData.attackerTokenId || attackData.attackerId, actor, "A");
        await game.combat.setGrappleLock(attackData.attackerTokenId || attackData.attackerId, actor);
      }
      specialMoveResult = {
        type: "grapple",
        attackerActorId: attackData.attackerTokenId || attackData.attackerId,
        defenderActorId: game.combat?.combatKey(actor) ?? actor.id,
        freeStrikeBonus: GRAPPLE_FREE_STRIKE_BONUS,
        followUpGradeBonus: netAttackSuccesses
      };
    } else {
      const armorItem = equippedArmor;
      let armorProt = armorItem?.system.protezione ?? 0;
      const combatant = game.combat?.resolveCombatant(actor);
      if (combatant && armorItem) {
        const puntaReductions = combatant.getFlag("sword", "puntaReductions") ?? {};
        armorProt = Math.max(0, armorProt - (puntaReductions[armorItem.id] ?? 0));
      }
      const armorRobCurrent = armorItem?.system.robustezzaCurrent ?? 0;

      talentDmgBonus = (attackData.talentDamageBonus || 0) + (attackData.sicarioDamageBonus || 0);
      const defProtCtx = { hasArmor: !!armorItem, isRanged: false };
      talentProtBonus = computeTalentCombatBonus(system.talents, "protectionMod", defProtCtx);

      // da_cavallo armor pregio: +1 protezione when mounted (accompagnata assumes not mounted — no dialog field)
      const cecchinoProtRedAcc = attackData.cecchinoProtectionReduction || 0;
      damageResult = resolveDamage({
        netSuccesses: netAttackSuccesses,
        weaponDamage: damageValue + talentDmgBonus,
        damageType,
        armorProtezione: Math.max(0, armorProt + talentProtBonus - cecchinoProtRedAcc),
        armorRobustezzaCurrent: armorRobCurrent,
        attackerSizeCategory: attackData.attackerSizeCategory || "media"
      });

      woundsApplied = damageResult.netWounds;

      if (woundsApplied > 0) {
        const wl = system.woundLevels;
        const caps = system.woundCapacities;
        newWounds = distributeWounds(wl, caps, woundsApplied);
        updateData["system.woundLevels.graffi"] = newWounds.graffi;
        updateData["system.woundLevels.leggere"] = newWounds.leggere;
        updateData["system.woundLevels.gravi"] = newWounds.gravi;
        updateData["system.woundLevels.critiche"] = newWounds.critiche;
        updateData["system.woundLevels.mortali"] = newWounds.mortali;
      }

      // Sicario: surprise attack causes bleeding
      if (attackData.sicarioBleeding && woundsApplied > 0 && !actor.statuses.has("sanguinamento")) {
        await actor.toggleStatusEffect("sanguinamento", { active: true });
        await actor.setFlag("sword", "bleedingTurns", 0);
      }

      if (damageResult.bluntRiflessi > 0) {
        updateData["system.resources.riflessi.value"] =
          (updateData["system.resources.riflessi.value"] ?? newRiflessi) - damageResult.bluntRiflessi;
      }

      if (damageResult.thrustReduction > 0 && armorItem && combatant) {
        const puntaFlags = combatant.getFlag("sword", "puntaReductions") ?? {};
        puntaFlags[armorItem.id] = (puntaFlags[armorItem.id] ?? 0) + damageResult.thrustReduction;
        await combatant.setFlag("sword", "puntaReductions", puntaFlags);
      }

      if (damageResult.armorRobustezzaLost > 0 && armorItem) {
        await armorItem.update({ "system.robustezzaCurrent": damageResult.armorRobustezzaNew });
      }

      if (specialMove === "targetedAttack") {
        specialMoveResult = { type: "targetedAttack", target: attackData.specialMoveTarget };
      }
    }
  }

  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Axe mastery: each wound also causes -1 Fatica and -1 Riflessi
  if (attackData.axeMasteryActive && woundsApplied > 0) {
    await actor.update({
      "system.resources.fatica.value": Math.max(0, actor.system.resources.fatica.value - woundsApplied),
      "system.resources.riflessi.value": actor.system.resources.riflessi.value - woundsApplied
    });
  }

  // Sanguinamento
  if (newWounds && oldCritiche === 0 && newWounds.critiche > 0) {
    await actor.toggleStatusEffect("sanguinamento", { active: true });
    await actor.setFlag("sword", "bleedingTurns", 0);
  }

  // Forza reaction prompts (with actionable buttons)
  if (newWounds && newWounds.critiche > oldCritiche) {
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<p><i class="fas fa-heart-broken"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Status.ForzaReactionCritiche")}</p>
        <p class="hint">${game.i18n.localize("SWORD.Status.ForzaReactionHint")}</p>
        <button type="button" class="defend-btn" data-action="reaction-ferite"
          data-actor-id="${actor.id}" data-token-id="${actor.token?.id ?? ""}" data-threat="${newWounds.critiche}">
          <i class="fas fa-shield-virus"></i> ${game.i18n.localize("SWORD.Reaction.TypeFerite")}
        </button>`
    });
  }
  if (newWounds && newWounds.mortali > oldMortali) {
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<p><i class="fas fa-skull-crossbones"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Status.ForzaReactionMortali")}</p>
        <p class="hint">${game.i18n.localize("SWORD.Status.ForzaReactionHint")}</p>
        <button type="button" class="defend-btn" data-action="reaction-ferite"
          data-actor-id="${actor.id}" data-token-id="${actor.token?.id ?? ""}" data-threat="${newWounds.mortali}">
          <i class="fas fa-shield-virus"></i> ${game.i18n.localize("SWORD.Reaction.TypeFerite")}
        </button>`
    });
  }

  // Targeted attack: post actionable Forza reaction button
  if (specialMove === "targetedAttack" && damageResult && damageResult.netWounds > 0) {
    const targetLabel = attackData.specialMoveTarget || "";
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<p><i class="fas fa-bullseye"></i> <strong>${actor.name}</strong> — ${game.i18n.format("SWORD.Status.ForzaReactionTargeted", { target: targetLabel })}</p>
        <button type="button" class="defend-btn" data-action="reaction-ferite"
          data-actor-id="${actor.id}" data-token-id="${actor.token?.id ?? ""}" data-threat="${damageResult.netWounds}">
          <i class="fas fa-shield-virus"></i> ${game.i18n.localize("SWORD.Reaction.TypeFerite")}
        </button>`
    });
  }

  const dmgTypeLabel = game.i18n.localize(`SWORD.DamageTypes.${damageType}`);
  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    defenseLabel,
    defenseType: "parataAccompagnata",
    defenseItemName,
    attackWeaponName,
    attackSuccesses,
    skillLabel,
    ...engineOutput,
    grade,
    extraDice,
    diceAfterReductionDisplay: engineOutput.diceAfterReduction.map(d => ({
      value: d, isOne: d === 1
    })),
    defenseSucceeded,
    hasPenalty: basePenalty > 0,
    fatiguePenalty,
    woundPenalty,
    armorPenalty,
    encumbrancePenalty,
    penaltyCancelled: spiritoCancelPenalty,
    effectivePenalty,
    riflessiCost,
    isFreeShieldParry: false,
    talentParryBonus,
    approach,
    approachLabel: game.i18n.localize(`SWORD.Combat.Approach${approach.charAt(0).toUpperCase() + approach.slice(1)}`),
    hasDamage: !defenseSucceeded && damageResult,
    talentDamageBonus: talentDmgBonus,
    talentProtBonus,
    damageResult: damageResult ? {
      grossWounds: damageResult.grossWounds,
      armorAbsorbed: damageResult.armorAbsorbed,
      netWounds: damageResult.netWounds,
      slashBonus: damageResult.slashBonus,
      bluntRiflessi: damageResult.bluntRiflessi,
      thrustReduction: damageResult.thrustReduction,
      damageType,
      damageTypeLabel: dmgTypeLabel
    } : null,
    specialMove,
    specialMoveResult,
    isNonLethal: specialMoveResult?.type === "nonLethal",
    isFeint: specialMoveResult?.type === "feint",
    isTargetedAttack: specialMoveResult?.type === "targetedAttack",
    isGrapple: specialMoveResult?.type === "grapple",
    isAccompagnata: true,
    // Action cost display
    isStandardAction: false,
    isFreeAction: true,
    pesanteRiflessiCost: 0
  };

  const html = await renderTemplate(
    "systems/sword/templates/chat/defense-result.hbs",
    chatData
  );

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}
