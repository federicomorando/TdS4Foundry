import { resolveDamage, distributeWounds, GRAPPLE_FREE_STRIKE_BONUS, computeReactionRiflessiCost } from "../engine.mjs";

/**
 * Auto-resolve a Forza wound reaction for a creature (no dialog needed).
 * Compares creature's fixed Forza against threat, deducts Riflessi if in combat,
 * applies svenuto/morto status on failure, posts reaction-result chat card.
 *
 * @param {Actor} actor - The creature actor
 * @param {"critiche"|"mortali"|"targetedAttack"} woundLevel - Which wound level triggered reaction
 * @param {number} threat - Successes to beat (wound count at that level, or net wounds for targeted)
 */
export async function _autoResolveCreatureWoundReaction(actor, woundLevel, threat) {
  const system = actor.system;
  const fixedForza = system.abilities?.forza ?? 0;
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const effectivePenalty = fatiguePenalty + woundPenalty;
  const finalSuccesses = Math.max(0, fixedForza - effectivePenalty);
  const passed = finalSuccesses > 0 && finalSuccesses >= threat;

  // Riflessi cost (in combat)
  let riflessiCost = 0;
  const inCombat = !!game.combat;
  if (inCombat) {
    const netSuccesses = finalSuccesses - threat;
    riflessiCost = computeReactionRiflessiCost(threat, netSuccesses);
    const currentRiflessi = system.resources.riflessi.value;
    await actor.update({ "system.resources.riflessi.value": currentRiflessi - riflessiCost });
  }

  // Apply status on failure
  if (!passed) {
    if (woundLevel === "critiche") {
      await actor.toggleStatusEffect("svenuto", { active: true });
    } else if (woundLevel === "mortali") {
      await actor.toggleStatusEffect("morto", { active: true });
    }
    // targetedAttack: no auto-status (GM decides based on body part)
  }

  // Localize labels
  const reactionTypeKey = woundLevel === "critiche"
    ? "SWORD.Reaction.AutoResolvedCritiche"
    : woundLevel === "mortali"
    ? "SWORD.Reaction.AutoResolvedMortali"
    : "SWORD.Reaction.AutoResolvedTargeted";
  const reactionTypeLabel = game.i18n.localize(reactionTypeKey);
  const skillLabel = game.i18n.localize("SWORD.Skills.forza");

  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    isCreature: true,
    reactionTypeLabel,
    skillLabel,
    threatSuccesses: threat,
    finalSuccesses,
    passed,
    riflessiCost: inCombat ? riflessiCost : 0,
    fatigaLost: 0,
    fearOutcome: false,
    fearOutcomeLabel: "",
    fearDurationText: "",
    diceAfterReductionDisplay: [],
    cavalcareOutcome: false,
    cavalcareOutcomeType: "",
    hasPenalty: effectivePenalty > 0,
    fatiguePenalty: fatiguePenalty > 0 ? fatiguePenalty : 0,
    woundPenalty: woundPenalty > 0 ? woundPenalty : 0,
    armorReactionPenalty: 0,
    penaltyCancelled: 0
  };

  const html = await renderTemplate("systems/sword/templates/chat/reaction-result.hbs", chatData);
  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html
  });
}

/**
 * Creature defense: fixed successes, no dice roll.
 * @param {Actor} actor - The defending creature
 * @param {object} attackData - Attack flags from the chat message
 * @param {string} defenseType - "parata" or "schivata"
 */
export async function _defendCreature(actor, attackData, defenseType) {
  const { finalSuccesses: attackSuccesses, damageValue, damageType, weaponName: attackWeaponName } = attackData;
  const specialMove = attackData.specialMove || null;
  const system = actor.system;

  // Parata costs the creature's standard action — block it with no action left,
  // mirroring the character flow (schivata/reactions are free and stay allowed).
  if (defenseType === "parata" && game.combat && !game.combat.hasActionAvailable(actor)) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoActionAvailable"));
    return;
  }

  let defenseSuccesses, skillLabel, defenseItemName = "";

  if (defenseType === "schivata") {
    defenseSuccesses = system.abilities.agilita || 0;
    skillLabel = game.i18n.localize("SWORD.Skills.agilita");
  } else {
    // Parata: pick from creature's attacks
    const attacks = system.attacks || [];
    if (attacks.length === 0) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoParryWeapon"));
      return;
    }

    let selectedAttack;
    if (attacks.length === 1) {
      selectedAttack = attacks[0];
    } else {
      const options = attacks.map((a, i) =>
        `<option value="${i}">${a.name} (${game.i18n.localize(`SWORD.Skills.${a.skill}`) || a.skill})</option>`
      ).join("");

      const pickResult = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("SWORD.Combat.ParryWith") },
        content: `
          <div class="sword-roll-dialog">
            <div class="form-group">
              <label>${game.i18n.localize("SWORD.Combat.ParryWeapon")}</label>
              <select name="parryItem">${options}</select>
            </div>
          </div>
        `,
        ok: {
          label: game.i18n.localize("SWORD.Combat.DefendBtn"),
          callback: (event, button) => parseInt(button.form.elements.parryItem.value)
        }
      });
      if (pickResult === null || pickResult === undefined) return;
      selectedAttack = attacks[pickResult];
    }

    defenseItemName = selectedAttack.name;
    defenseSuccesses = system.skills[selectedAttack.skill] || 0;
    skillLabel = game.i18n.localize(`SWORD.Skills.${selectedAttack.skill}`) || selectedAttack.skill;
  }

  const defenseLabel = defenseType === "parata"
    ? game.i18n.localize("SWORD.Combat.Parata")
    : game.i18n.localize("SWORD.Combat.Schivata");

  // Apply penalties (fatigue + wounds reduce fixed successes)
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const basePenalty = fatiguePenalty + woundPenalty;
  const effectiveSuccesses = Math.max(0, defenseSuccesses - basePenalty);

  // Compare fixed successes vs attack
  const netSuccesses = effectiveSuccesses - attackSuccesses;
  const defenseSucceeded = netSuccesses >= 0;

  // Deduct Riflessi: schivata costs threat - net successes (errata §4.6 line 2148);
  // parata costs an action (no Riflessi)
  const updateData = {};
  const riflessi = system.resources.riflessi;
  const isCreatureParata = defenseType === "parata";
  let riflessiCost = isCreatureParata ? 0
    : computeReactionRiflessiCost(attackSuccesses, netSuccesses);

  // Rango as Riflessi reserve: pay from rango first (PDF lines 5292-5293)
  let rangoPaid = 0;
  const combatantDef = game.combat?.resolveCombatant(actor);
  if (riflessiCost > 0 && combatantDef) {
    const rangoRemaining = combatantDef.getFlag("sword", "rangoRemaining") ?? 0;
    if (rangoRemaining > 0) {
      rangoPaid = Math.min(rangoRemaining, riflessiCost);
      riflessiCost -= rangoPaid;
      await combatantDef.setFlag("sword", "rangoRemaining", rangoRemaining - rangoPaid);
    }
  }

  const newRiflessi = riflessi.value - riflessiCost;
  if (riflessiCost > 0) {
    updateData["system.resources.riflessi.value"] = newRiflessi;
  }

  // Parata costs the creature's standard action (the chat card already
  // declares isStandardAction for parata; mirror the character flow)
  if (isCreatureParata && game.combat) {
    await game.combat.consumeAction(actor);
  }

  // Capture old wound levels for sanguinamento/Forza reaction detection
  const oldCritiche = system.woundLevels.critiche;
  const oldMortali = system.woundLevels.mortali;
  let newWoundsCreature = null;

  // Special move result tracking
  let specialMoveResult = null;

  // Damage resolution if defense failed
  let damageResult = null;
  if (!defenseSucceeded) {
    const netAttackSuccesses = -netSuccesses;

    if (specialMove === "nonLethal") {
      // Non-lethal: fatica instead of wounds
      const fatica = system.resources.fatica;
      const newFatica = Math.max(0, fatica.value - netAttackSuccesses);
      updateData["system.resources.fatica.value"] = newFatica;
      // Fatigue overflow → wounds
      let faticaOverflowWounds = Math.max(0, netAttackSuccesses - fatica.value);
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
      // Feint: Riflessi loss
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
        await game.combat.setGrappleLock(attackData.attackerTokenId || attackData.attackerId, actor, netAttackSuccesses);
      }
      specialMoveResult = {
        type: "grapple",
        attackerActorId: attackData.attackerTokenId || attackData.attackerId,
        defenderActorId: game.combat?.combatKey(actor) ?? actor.id,
        freeStrikeBonus: GRAPPLE_FREE_STRIKE_BONUS,
        followUpGradeBonus: netAttackSuccesses
      };
    } else {
      // Normal or targeted: standard damage
      const armorProt = system.protezione || 0;
      const creatureTalentDmg = (attackData.talentDamageBonus || 0) + (attackData.sicarioDamageBonus || 0);
      const cecchinoProtRed = attackData.cecchinoProtectionReduction || 0;

      damageResult = resolveDamage({
        netSuccesses: netAttackSuccesses,
        weaponDamage: damageValue + creatureTalentDmg,
        damageType,
        armorProtezione: Math.max(0, armorProt - cecchinoProtRed),
        armorRobustezzaCurrent: 99, // creatures don't track robustezza
        attackerSizeCategory: attackData.attackerSizeCategory || "media"
      });

      if (damageResult.netWounds > 0) {
        const wl = system.woundLevels;
        const caps = system.woundCapacities;
        newWoundsCreature = distributeWounds(wl, caps, damageResult.netWounds);
        updateData["system.woundLevels.graffi"] = newWoundsCreature.graffi;
        updateData["system.woundLevels.leggere"] = newWoundsCreature.leggere;
        updateData["system.woundLevels.gravi"] = newWoundsCreature.gravi;
        updateData["system.woundLevels.critiche"] = newWoundsCreature.critiche;
        updateData["system.woundLevels.mortali"] = newWoundsCreature.mortali;
      }

      // Botta: -1 Riflessi
      if (damageResult.bluntRiflessi > 0) {
        updateData["system.resources.riflessi.value"] =
          (updateData["system.resources.riflessi.value"] ?? newRiflessi) - damageResult.bluntRiflessi;
      }

      if (specialMove === "targetedAttack") {
        specialMoveResult = { type: "targetedAttack", target: attackData.specialMoveTarget };
      }
    }
  }

  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Sicario: surprise attack causes bleeding
  if (attackData.sicarioBleeding && damageResult?.netWounds > 0 && !actor.statuses.has("sanguinamento")) {
    await actor.toggleStatusEffect("sanguinamento", { active: true });
    await actor.setFlag("sword", "bleedingTurns", 0);
  }

  // Axe mastery: each wound also causes -1 Fatica and -1 Riflessi
  if (attackData.axeMasteryActive && damageResult?.netWounds > 0) {
    await actor.update({
      "system.resources.fatica.value": Math.max(0, actor.system.resources.fatica.value - damageResult.netWounds),
      "system.resources.riflessi.value": actor.system.resources.riflessi.value - damageResult.netWounds
    });
  }

  // Sanguinamento: apply when critiche first reached
  if (newWoundsCreature && oldCritiche === 0 && newWoundsCreature.critiche > 0) {
    await actor.toggleStatusEffect("sanguinamento", { active: true });
    await actor.setFlag("sword", "bleedingTurns", 0);
  }

  // Creature: auto-resolve Forza reactions (no GM click needed)
  if (newWoundsCreature && newWoundsCreature.critiche > oldCritiche) {
    await _autoResolveCreatureWoundReaction(actor, "critiche", newWoundsCreature.critiche);
  }
  if (newWoundsCreature && newWoundsCreature.mortali > oldMortali) {
    await _autoResolveCreatureWoundReaction(actor, "mortali", newWoundsCreature.mortali);
  }
  // Creature targeted attack: auto-resolve wound reaction
  if (specialMove === "targetedAttack" && damageResult && damageResult.netWounds > 0) {
    await _autoResolveCreatureWoundReaction(actor, "targetedAttack", damageResult.netWounds);
  }

  // Chat card
  const dmgTypeLabel = game.i18n.localize(`SWORD.DamageTypes.${damageType}`);
  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    defenseLabel,
    defenseType,
    defenseItemName,
    attackWeaponName,
    attackSuccesses,
    skillLabel,
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
    hasDamage: !defenseSucceeded && damageResult,
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
    // Phase 3: special move results
    specialMove,
    specialMoveResult,
    isNonLethal: specialMoveResult?.type === "nonLethal",
    isFeint: specialMoveResult?.type === "feint",
    isTargetedAttack: specialMoveResult?.type === "targetedAttack",
    isGrapple: specialMoveResult?.type === "grapple",
    // Action cost display — creature parata has no free action tracking
    isStandardAction: defenseType === "parata",
    isFreeAction: false,
    pesanteRiflessiCost: 0
  };

  const html = await renderTemplate(
    "systems/sword/templates/chat/defense-result.hbs",
    chatData
  );

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html
  });
}

/**
 * Parata Accompagnata for creatures: fixed successes from two best attacks.
 */
export async function _defendCreatureAccompagnata(actor, attackData) {
  // Accompagnata costs the free action
  if (game.combat && !game.combat.hasFreeActionAvailable(actor)) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoFreeActionAvailable"));
      return;
    }
    ui.notifications.info(game.i18n.localize("SWORD.Combat.GMActionOverride"));
  }

  const system = actor.system;
  const { finalSuccesses: attackSuccesses, damageValue, damageType, weaponName: attackWeaponName } = attackData;
  const specialMove = attackData.specialMove || null;

  const attacks = system.attacks || [];
  if (attacks.length < 2) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.ParataAccompagnataNoItems"));
    return;
  }

  // Pick two best parry attacks (highest skill values)
  const sorted = [...attacks].sort((a, b) => (system.skills[b.skill] || 0) - (system.skills[a.skill] || 0));
  const atk1 = sorted[0];
  const atk2 = sorted[1];

  const defenseSuccesses1 = system.skills[atk1.skill] || 0;
  const defenseSuccesses2 = system.skills[atk2.skill] || 0;
  // Combined: use primary skill value + secondary as bonus (like combined parry)
  const defenseSuccesses = defenseSuccesses1;
  const combinedBonus = Math.floor(defenseSuccesses2 / 2); // secondary contributes half

  const defenseLabel = game.i18n.localize("SWORD.Combat.ParataAccompagnata");
  const defenseItemName = `${atk1.name} + ${atk2.name}`;
  const skillLabel = game.i18n.localize(`SWORD.Skills.${atk1.skill}`) || atk1.skill;

  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const basePenalty = fatiguePenalty + woundPenalty;
  const effectiveSuccesses = Math.max(0, defenseSuccesses + combinedBonus - basePenalty);

  const netSuccesses = effectiveSuccesses - attackSuccesses;
  const defenseSucceeded = netSuccesses >= 0;

  // Parata accompagnata (creature): action-based, no Riflessi cost
  // Consume free action
  if (game.combat) await game.combat.consumeFreeAction(actor);

  const updateData = {};
  const riflessi = system.resources.riflessi;
  const riflessiCost = 0;

  const oldCritiche = system.woundLevels.critiche;
  const oldMortali = system.woundLevels.mortali;
  let newWoundsCreature = null;
  let specialMoveResult = null;
  let damageResult = null;

  if (!defenseSucceeded) {
    const netAttackSuccesses = -netSuccesses;

    if (specialMove === "nonLethal") {
      const fatica = system.resources.fatica;
      const newFatica = Math.max(0, fatica.value - netAttackSuccesses);
      updateData["system.resources.fatica.value"] = newFatica;
      // Fatigue overflow → wounds (creatures don't have halve talent)
      let faticaOverflowWounds = Math.max(0, netAttackSuccesses - fatica.value);
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
        (updateData["system.resources.riflessi.value"] ?? (riflessi.value - riflessiCost)) - riflessiLoss;
      specialMoveResult = { type: "feint", riflessiLost: riflessiLoss, agganciare: attackerPregi.includes("agganciare") };
    } else if (specialMove === "grapple") {
      // Grapple (Presa): no damage — establish grapple at Abrazzar
      if (game.combat && attackData.attackerId) {
        await game.combat.setEngagementMisura(attackData.attackerTokenId || attackData.attackerId, actor, "A");
        await game.combat.setGrappleLock(attackData.attackerTokenId || attackData.attackerId, actor, netAttackSuccesses);
      }
      specialMoveResult = {
        type: "grapple",
        attackerActorId: attackData.attackerTokenId || attackData.attackerId,
        defenderActorId: game.combat?.combatKey(actor) ?? actor.id,
        freeStrikeBonus: GRAPPLE_FREE_STRIKE_BONUS,
        followUpGradeBonus: netAttackSuccesses
      };
    } else {
      const armorProt = system.protezione || 0;
      const creatureTalentDmg = (attackData.talentDamageBonus || 0) + (attackData.sicarioDamageBonus || 0);
      const cecchinoProtRedCA = attackData.cecchinoProtectionReduction || 0;
      damageResult = resolveDamage({
        netSuccesses: netAttackSuccesses,
        weaponDamage: damageValue + creatureTalentDmg,
        damageType,
        armorProtezione: Math.max(0, armorProt - cecchinoProtRedCA),
        armorRobustezzaCurrent: 99,
        attackerSizeCategory: attackData.attackerSizeCategory || "media"
      });

      if (damageResult.netWounds > 0) {
        const wl = system.woundLevels;
        const caps = system.woundCapacities;
        newWoundsCreature = distributeWounds(wl, caps, damageResult.netWounds);
        updateData["system.woundLevels.graffi"] = newWoundsCreature.graffi;
        updateData["system.woundLevels.leggere"] = newWoundsCreature.leggere;
        updateData["system.woundLevels.gravi"] = newWoundsCreature.gravi;
        updateData["system.woundLevels.critiche"] = newWoundsCreature.critiche;
        updateData["system.woundLevels.mortali"] = newWoundsCreature.mortali;
      }

      if (damageResult.bluntRiflessi > 0) {
        updateData["system.resources.riflessi.value"] =
          (updateData["system.resources.riflessi.value"] ?? (riflessi.value - riflessiCost)) - damageResult.bluntRiflessi;
      }

      if (specialMove === "targetedAttack") {
        specialMoveResult = { type: "targetedAttack", target: attackData.specialMoveTarget };
      }
    }
  }

  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Sicario: surprise attack causes bleeding
  if (attackData.sicarioBleeding && damageResult?.netWounds > 0 && !actor.statuses.has("sanguinamento")) {
    await actor.toggleStatusEffect("sanguinamento", { active: true });
    await actor.setFlag("sword", "bleedingTurns", 0);
  }

  // Axe mastery: each wound also causes -1 Fatica and -1 Riflessi
  if (attackData.axeMasteryActive && damageResult?.netWounds > 0) {
    await actor.update({
      "system.resources.fatica.value": Math.max(0, actor.system.resources.fatica.value - damageResult.netWounds),
      "system.resources.riflessi.value": actor.system.resources.riflessi.value - damageResult.netWounds
    });
  }

  // Sanguinamento
  if (newWoundsCreature && oldCritiche === 0 && newWoundsCreature.critiche > 0) {
    await actor.toggleStatusEffect("sanguinamento", { active: true });
    await actor.setFlag("sword", "bleedingTurns", 0);
  }

  // Creature: auto-resolve Forza reactions (no GM click needed)
  if (newWoundsCreature && newWoundsCreature.critiche > oldCritiche) {
    await _autoResolveCreatureWoundReaction(actor, "critiche", newWoundsCreature.critiche);
  }
  if (newWoundsCreature && newWoundsCreature.mortali > oldMortali) {
    await _autoResolveCreatureWoundReaction(actor, "mortali", newWoundsCreature.mortali);
  }
  // Creature targeted attack: auto-resolve wound reaction
  if (specialMove === "targetedAttack" && damageResult && damageResult.netWounds > 0) {
    await _autoResolveCreatureWoundReaction(actor, "targetedAttack", damageResult.netWounds);
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
    isCreature: true,
    defenseSuccesses: defenseSuccesses + combinedBonus,
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
    hasDamage: !defenseSucceeded && damageResult,
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
    content: html
  });
}
