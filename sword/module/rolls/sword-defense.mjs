/**
 * Defense adapter: reads attack flags → dialog → engine → damage resolution → chat card.
 *
 * Handles parata (parry), schivata (dodge), and reactionForza (Forza reaction) defense types.
 * On defender loss: resolves damage via sword-combat engine, updates defender wounds/riflessi/armor.
 *
 * Phase 2 additions:
 * - Ranged attacks: parata blocked (schivata only)
 * - Approach modifiers: dropdown in defense dialog
 * - Free shield parry: first shield parry per round costs no action (tracked via combatant flag)
 *
 * Phase 3 additions:
 * - Special move branches: targetedAttack, nonLethal, disarm, push, feint
 * - Punta persistence fix: per-encounter tracking via combatant flags
 * - Close Misura offer on 3+ defense successes
 * - Forza reaction defense for disarm/push
 */
import { resolveDamage, distributeWounds, computeTalentCombatBonus, MISURA_ORDER, GRAPPLE_FREE_STRIKE_BONUS, computeDaCavalloArmorBonus, computePesanteRiflessiCost, applySpiritoOverflow } from "../engine.mjs";
import { resolveDefenseCheck } from "../engine.mjs";
import { SKILL_MAP } from "../data/actor.mjs";
import { armorSkillPenalty, weaponQualityBonus } from "../engine.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { buildPenaltyHtml, buildCombatApproachHtml, formInt, formStr, formBool } from "./dialog-helpers.mjs";
import { APPROACH_MODS } from "../engine.mjs";
import { _defendReaction, _computeReactionOutcome, _applyReactionOutcome, _defendParataAccompagnata } from "./sword-defense-reactions.mjs";
import { _defendCreature, _defendCreatureAccompagnata } from "./sword-defense-creature.mjs";

/**
 * Execute a defense action against an attack.
 * @param {Actor} actor - The defending actor
 * @param {string} attackMessageId - The ChatMessage ID containing the attack
 * @param {string} defenseType - "parata", "schivata", or "reactionForza"
 */
export async function swordDefend(actor, attackMessageId, defenseType) {
  const attackMsg = game.messages.get(attackMessageId);
  if (!attackMsg) {
    ui.notifications.error("Messaggio d'attacco non trovato.");
    return;
  }

  const attackData = attackMsg.flags?.sword?.attack;
  if (!attackData) {
    ui.notifications.error("Dati d'attacco non trovati.");
    return;
  }

  // Block parata vs ranged attacks
  if (attackData.isRanged && defenseType === "parata") {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoParryRanged"));
    return;
  }

  // Block defense if ranged attack was stopped by cover
  if (attackData.effectiveAttackHit === false) {
    ui.notifications.info(game.i18n.localize("SWORD.Combat.CoverBlocked"));
    return;
  }

  const specialMove = attackData.specialMove || null;

  // Route Forza reaction (disarm) — allowed even when senza fiato
  if (defenseType === "reactionForza") {
    return _defendReaction(actor, attackData);
  }

  // Contrattacco and Disarmo difensivo route through standard parry flow
  // with special behavior on success (checked after defense resolution)
  let defensiveSpecialMove = null;
  if (defenseType === "contrattacco") {
    defensiveSpecialMove = "contrattacco";
    defenseType = "parata"; // executes as a parry
  } else if (defenseType === "disarmoDifensivo") {
    defensiveSpecialMove = "disarmoDifensivo";
    defenseType = "parata"; // executes as a parry (combined Lotta)
  }

  // Senza fiato: cannot defend in combat (errata §4.6 line 2141)
  if (actor.statuses.has("senza-fiato")) {
    ui.notifications.warn(game.i18n.localize("SWORD.Status.SenzaFiatoNoDefense"));
    return;
  }

  // Attesa interruption: defending forfeits Riflessi recovery (errata line 2138)
  if (game.combat) {
    const waitCombatant = game.combat.resolveCombatant(actor);
    if (waitCombatant?.getFlag("sword", "isWaiting")) {
      await waitCombatant.unsetFlag("sword", "isWaiting");
      ui.notifications.info(game.i18n.localize("SWORD.Combat.AttesaInterrupted"));
    }
  }

  // Route Parata Accompagnata (dual-weapon parry)
  if (defenseType === "parataAccompagnata") {
    if (actor.type === "creature") {
      return _defendCreatureAccompagnata(actor, attackData);
    }
    return _defendParataAccompagnata(actor, attackData);
  }

  // Creature defense: fixed successes, no dice roll
  if (actor.type === "creature") {
    return _defendCreature(actor, attackData, defenseType);
  }

  // Determine defense skill and any parry modifier
  const isParata = defenseType === "parata";
  let skillId, parryModifier = 0, defenseItemName = "";
  let isFreeShieldParry = false;
  let isExtraParry3Riflessi = false;
  let isMaestroShieldReaction = false;
  let isFreeSwordParry = false;
  let selectedItem = null;

  if (defenseType === "schivata") {
    skillId = "agilita";
  } else {
    // Parata: let defender pick a weapon or shield to parry with
    const parryItems = Array.from(actor.items).filter(i =>
      (i.type === "weapon" || i.type === "shield") && i.system.parryModifier !== undefined
    );

    if (parryItems.length === 0) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoParryWeapon"));
      return;
    }

    // If only one item, auto-select; otherwise show picker
    if (parryItems.length === 1) {
      selectedItem = parryItems[0];
    } else {
      const options = parryItems.map(i => {
        const mod = i.system.parryModifier >= 0 ? `+${i.system.parryModifier}` : i.system.parryModifier;
        return `<option value="${i.id}">${i.name} (${mod})</option>`;
      }).join("");

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
          callback: (event, button) => button.form.elements.parryItem.value
        }
      });
      if (!pickResult) return;
      selectedItem = actor.items.get(pickResult);
    }

    if (!selectedItem) return;
    defenseItemName = selectedItem.name;
    parryModifier = selectedItem.system.parryModifier || 0;
    // Parry uses the weapon's skill for weapons, or armi_da_guerra for shields
    skillId = selectedItem.type === "shield" ? "armi_da_guerra" : selectedItem.system.skillId;

    // Maestro di scudo: shield parry as reaction (riflessi cost instead of action)
    isMaestroShieldReaction = selectedItem.type === "shield"
      && !!actor.system.talentSpecials?.has("shield_parry_as_reaction");

    // Sword mastery: one free sword parry per round (no action cost)
    if (selectedItem.type === "weapon" && selectedItem.system.weaponType === "spada"
      && actor.system.talentSpecials?.has("weapon_mastery_sword") && game.combat) {
      const combatant = game.combat.resolveCombatant(actor);
      if (combatant && !combatant.getFlag("sword", "usedFreeSwordParry")) {
        isFreeSwordParry = true;
      }
    }

    // Free shield parry check (uses free action slot)
    if (selectedItem.type === "shield" && !isMaestroShieldReaction) {
      const shieldSkillGrade = actor.system.skills.armi_da_guerra?.grade ?? 0;
      if (shieldSkillGrade >= 1 && game.combat?.hasFreeActionAvailable(actor)) {
        isFreeShieldParry = true;
      }
    }

    // Action economy gate for parata (maestro shield reaction / free sword parry bypass action cost)
    if (!isFreeShieldParry && !isMaestroShieldReaction && !isFreeSwordParry) {
      // Weapon/shield parata (not free) costs a standard action
      if (game.combat && !game.combat.hasActionAvailable(actor)) {
        // Fulmine: extra parry for 3 riflessi (once per turn, melee only)
        const combatantDef = game.combat.resolveCombatant(actor);
        const hasExtraParry = !!actor.system.talentSpecials?.has("extra_attack_3riflessi")
          && !combatantDef?.getFlag("sword", "usedExtraAttack3Riflessi")
          && actor.system.resources.riflessi.value >= 3;
        if (hasExtraParry) {
          isExtraParry3Riflessi = true;
        } else if (!game.user.isGM) {
          ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoActionAvailable"));
          return;
        } else {
          ui.notifications.info(game.i18n.localize("SWORD.Combat.GMActionOverride"));
        }
      }
    }
  }

  const system = actor.system;
  const skillData = system.skills[skillId];
  if (!skillData) {
    ui.notifications.error(`Abilità non trovata: ${skillId}`);
    return;
  }

  const { finalSuccesses: attackSuccesses, damageValue, damageType, weaponName: attackWeaponName } = attackData;

  const charKey = SKILL_MAP[skillId];
  const effectiveCharKey = charKey === "varies" ? (skillData.specialtyChar || "mens") : charKey;
  const baseCharScore = system.effectiveCharacteristics?.[effectiveCharKey] ?? system.characteristics[effectiveCharKey];
  const weaponQualityMod = selectedItem ? weaponQualityBonus(selectedItem.system.quality) : 0;
  const charScore = baseCharScore + weaponQualityMod;
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

  // Penalty cancellation dialog
  const penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value);

  const defenseLabel = defenseType === "parata"
    ? game.i18n.localize("SWORD.Combat.Parata")
    : game.i18n.localize("SWORD.Combat.Schivata");

  // Approach selector for defense
  const approachHtml = buildCombatApproachHtml();

  const mountedHtml = !attackData.isRanged
    ? `
      <div class="form-group">
        <label><input type="checkbox" name="mountedMelee" /> ${game.i18n.localize("SWORD.Combat.MountedMelee")}</label>
      </div>
    `
    : "";

  // Free parry hint
  const freeParryHint = isFreeShieldParry
    ? `<p class="hint"><i class="fas fa-shield-check"></i> ${game.i18n.localize("SWORD.Combat.FreeShieldParry")}</p>`
    : "";

  // Tactical advantage (Study Battlefield)
  let tacticalAdvHtml = "";
  const tacticalAdvDef = game.combat?.getFlag("sword", "tacticalAdvantages");
  if (tacticalAdvDef && tacticalAdvDef.remaining > 0) {
    tacticalAdvHtml = `
      <div class="form-group">
        <label>
          <input type="checkbox" name="useTacticalAdvantage" />
          ${game.i18n.localize("SWORD.Combat.UseTacticalAdvantage")} — ${tacticalAdvDef.remaining} ${game.i18n.localize("SWORD.Combat.RemainingAdvantages")}
        </label>
      </div>
    `;
  }

  // Ombra: option to spend Spirito instead of Riflessi for reactions
  const hasSpiritoForReactions = !!system.talentSpecials?.has("spirito_for_reactions");
  const showSpiritoOption = hasSpiritoForReactions && (defenseType === "schivata" || isMaestroShieldReaction);
  const spiritoOptionHtml = showSpiritoOption ? `
    <div class="form-group">
      <label><input type="checkbox" name="useSpiritoForRiflessi" checked /> ${game.i18n.localize("SWORD.Talent.SpiritoForRiflessi")}</label>
    </div>
  ` : "";

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${defenseLabel}</strong> vs. ${attackWeaponName} (${attackSuccesses} ${game.i18n.localize("SWORD.Chat.Successes").toLowerCase()})</p>
      ${defenseItemName ? `<p class="hint">${defenseItemName} (parata ${parryModifier >= 0 ? "+" : ""}${parryModifier})</p>` : ""}
      ${freeParryHint}
      <p class="hint">${skillLabel} (${charScore}), ${game.i18n.localize("SWORD.Grade")}: ${grade}</p>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
      </div>
      ${approachHtml}
      ${mountedHtml}
      ${penaltyHtml}
      ${spiritoOptionHtml}
      ${tacticalAdvHtml}
      ${ (game.combat ? game.combat.combatants.some(c => c.actor?.hasPlayerOwner && c.actor.system?.talentSpecials?.has("formation_bonus")) : !!system.talentSpecials?.has("formation_bonus")) ? `
      <div class="form-group">
        <label><input type="checkbox" name="useFormation" /> ${game.i18n.localize("SWORD.Talent.FormationBonus")}</label>
      </div>` : ""}
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
      icon: "fa-solid fa-shield",
      callback: (event, button) => {
        const form = button.form;
        return {
          diceCount: formInt(form, "diceCount", 2),
          spiritoCancelPenalty: formInt(form, "spiritoCancelPenalty"),
          approach: formStr(form, "approach", "corsa"),
          mountedMelee: formBool(form, "mountedMelee"),
          useTacticalAdvantage: formBool(form, "useTacticalAdvantage"),
          useSpiritoForRiflessi: formBool(form, "useSpiritoForRiflessi"),
          useFormation: formBool(form, "useFormation"),
          focusDice: countSelectedFoci(button.form, allFoci.length)
        };
      }
    }
  });

  if (!result) return;

  let { diceCount, spiritoCancelPenalty, approach, mountedMelee, useTacticalAdvantage, useSpiritoForRiflessi, useFormation, focusDice } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
  spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);

  const effectivePenalty = basePenalty - spiritoCancelPenalty;

  // Approach modifier for defense
  const approachMod = APPROACH_MODS[approach] || APPROACH_MODS.corsa;

  // Talent parry bonus (Phase 4)
  const defHasShield = Array.from(actor.items).some(i => i.type === "shield");
  const defCombatCtx = {
    skillId,
    isRanged: false,
    weaponCategory: selectedItem?.system?.category,
    weaponType: selectedItem?.system?.weaponType,
    weaponHands: selectedItem?.system?.hands,
    hasShield: defHasShield,
    hasArmor: !!Array.from(actor.items).find(i => i.type === "armor"),
    mounted: !!mountedMelee
  };
  const talentParryBonus = computeTalentCombatBonus(system.talents, "parryMod", defCombatCtx);
  const talentSuccessBonus = computeTalentCombatBonus(system.talents, "successBonus", defCombatCtx);

  // Tactical advantage bonus
  const tacticalAdvantageBonus = useTacticalAdvantage ? 1 : 0;

  // Polearm mastery: +1 success when parrying with a polearm
  const polearmMasteryBonus = (isParata && selectedItem?.system.weaponType === "asta"
    && system.talentSpecials?.has("weapon_mastery_polearm")) ? 1 : 0;

  const formationBonus = useFormation ? 1 : 0;
  // Mounted vs unmounted: +1 defense bonus (PDF line 2511)
  const mountedDefenseBonus = (mountedMelee && !attackData.mounted) ? 1 : 0;

  const totalExtraDice = extraDice + focusDice;
  const totalDice = diceCount + totalExtraDice;

  // Roll
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  // --- Defense check via use-case ---
  let defenseMode;
  if (isMaestroShieldReaction) defenseMode = "maestro";
  else if (isFreeShieldParry) defenseMode = "freeShield";
  else if (isFreeSwordParry) defenseMode = "freeSword";
  else if (defenseType === "parata") defenseMode = "parata";
  else defenseMode = "schivata";

  const riflessi = system.resources.riflessi;
  const defCheckResult = resolveDefenseCheck(
    { finalSuccesses: attackSuccesses },
    {
      characteristicScore: charScore, diceCount, grade, extraDice, focusDice,
      approach, parryModifier, spiritoCancelPenalty, defenseMode,
      talentParryBonus, talentSuccessBonus, tacticalAdvantageBonus,
      polearmMasteryBonus, formationBonus, mountedDefenseBonus,
      hasRiflessiCostMinus1: !!system.talentSpecials?.has("riflessi_cost_minus1"),
      useSpiritoForRiflessi
    },
    { fatiguePenalty, woundPenalty, armorPenalty, encumbrancePenalty, spirito: spirito.value, riflessi: riflessi.value },
    diceRolled
  );
  const engineOutput = defCheckResult.engineOutput;
  let riflessiCost = defCheckResult.riflessiCost;

  // Enorme defense: defense does NOT drain attacker Riflessi; instead net defense
  // successes reduce own Riflessi cost, like a Reaction (PDF line 5288)
  if (attackData.attackerSizeCategory === "enorme") {
    const netDefSuccesses = engineOutput.basePassed ? Math.max(0, engineOutput.finalSuccesses - attackSuccesses) : 0;
    riflessiCost = Math.max(0, attackSuccesses - netDefSuccesses);
  }

  // Thrown weapon: schivata costs double Riflessi (PDF line 2550)
  if (attackData.isThrown && defenseType === "schivata") {
    riflessiCost *= 2;
  }

  // Map check patches to Foundry update format
  const updateData = {};
  for (const [key, value] of Object.entries(defCheckResult.patches)) {
    if (key.startsWith("resources.")) {
      updateData[`system.${key}.value`] = value;
    } else {
      updateData[`system.${key}`] = value;
    }
  }
  // The enorme/thrown overrides change riflessiCost after the engine call —
  // rebuild the resource patches so the actor pays exactly the displayed cost.
  if (riflessiCost !== defCheckResult.riflessiCost) {
    const patches = {};
    const cancel = defCheckResult.spiritoCancelPenalty;
    if (cancel > 0) patches["resources.spirito"] = spirito.value - cancel;
    if (riflessiCost > 0) {
      if (useSpiritoForRiflessi) {
        const curSpirito = patches["resources.spirito"] ?? spirito.value;
        patches["resources.spirito"] = Math.max(0, curSpirito - riflessiCost);
      } else {
        patches["resources.riflessi"] = riflessi.value - riflessiCost;
      }
    }
    applySpiritoOverflow(patches, system.resources.fatica.value);
    delete updateData["system.resources.spirito.value"];
    delete updateData["system.resources.riflessi.value"];
    delete updateData["system.resources.fatica.value"];
    for (const [key, value] of Object.entries(patches)) {
      updateData[`system.${key}.value`] = value;
    }
  }
  // Ensure riflessi is set for subsequent deductions. When Ombra spends
  // Spirito instead of Riflessi, riflessi must NOT also be deducted.
  if (updateData["system.resources.riflessi.value"] === undefined) {
    updateData["system.resources.riflessi.value"] = riflessi.value - (useSpiritoForRiflessi ? 0 : riflessiCost);
  }
  const newRiflessi = updateData["system.resources.riflessi.value"];

  // Decrement tactical advantage (Foundry-specific)
  if (useTacticalAdvantage && game.combat) {
    const ta = game.combat.getFlag("sword", "tacticalAdvantages");
    if (ta && ta.remaining > 0) {
      ta.remaining -= 1;
      await game.combat.setFlag("sword", "tacticalAdvantages", ta);
    }
  }

  // Consume action: free action for shield parry, standard action for weapon parry
  // Maestro di scudo shield reaction: no action consumed (riflessi cost only)
  if (game.combat) {
    if (isFreeSwordParry) {
      // Sword mastery: mark free parry as used this round (no action consumed)
      const combatant = game.combat.resolveCombatant(actor);
      if (combatant) await combatant.setFlag("sword", "usedFreeSwordParry", true);
    } else if (isExtraParry3Riflessi) {
      // Fulmine: extra parry costs 3 riflessi instead of action
      let extraParryCost = 3;
      if (system.talentSpecials?.has("riflessi_cost_minus1")) extraParryCost = Math.max(0, extraParryCost - 1);
      updateData["system.resources.riflessi.value"] = (updateData["system.resources.riflessi.value"] ?? riflessi.value) - extraParryCost;
      const combatant = game.combat.resolveCombatant(actor);
      if (combatant) await combatant.setFlag("sword", "usedExtraAttack3Riflessi", true);
    } else if (isFreeShieldParry) {
      await game.combat.consumeFreeAction(actor);
    } else if (isParata && !isMaestroShieldReaction) {
      await game.combat.consumeAction(actor);
    }
  }

  // Pesante weapon parry: deduct extra Riflessi
  let pesanteRiflessiCost = (isParata && selectedItem) ? computePesanteRiflessiCost(selectedItem.system.pregi) : 0;
  if (pesanteRiflessiCost > 0 && system.talentSpecials?.has("riflessi_cost_minus1")) pesanteRiflessiCost = Math.max(0, pesanteRiflessiCost - 1);
  if (pesanteRiflessiCost > 0) {
    updateData["system.resources.riflessi.value"] =
      (updateData["system.resources.riflessi.value"] ?? newRiflessi) - pesanteRiflessiCost;
  }

  // Determine outcome
  const defenseSucceeded = engineOutput.netSuccesses >= 0;

  let damageResult = null;
  let woundsApplied = 0;
  let talentDmgBonus = 0;
  let talentProtBonus = 0;

  // Special move result tracking
  let specialMoveResult = null;

  // Capture old wound levels for sanguinamento/Forza reaction detection
  const oldCritiche = system.woundLevels.critiche;
  const oldMortali = system.woundLevels.mortali;
  let newWounds = null;

  if (!defenseSucceeded) {
    // Attacker wins: resolve based on special move type
    const netAttackSuccesses = -engineOutput.netSuccesses; // positive value

    if (specialMove === "nonLethal") {
      // Non-lethal: defender loses fatica instead of wounds
      const fatica = system.resources.fatica;
      const newFatica = Math.max(0, fatica.value - netAttackSuccesses);
      updateData["system.resources.fatica.value"] = newFatica;
      // Fatigue overflow → wounds (excess fatica loss after hitting 0)
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
      // Feint: defender loses Riflessi, no weapon damage
      let riflessiLoss = netAttackSuccesses;
      // Agganciare pregio on attacker weapon adds +1 Riflessi loss
      const attackerPregi = attackData.weaponPregi || [];
      const hasAgganciare = attackerPregi.includes("agganciare");
      if (hasAgganciare) riflessiLoss += 1;
      updateData["system.resources.riflessi.value"] =
        (updateData["system.resources.riflessi.value"] ?? newRiflessi) - riflessiLoss;
      specialMoveResult = { type: "feint", riflessiLost: riflessiLoss, agganciare: hasAgganciare };
    } else if (specialMove === "push") {
      // Push defended normally (parata/schivata): apply push outcome (PDF line 2557)
      const pushResult = _computeReactionOutcome("push", false, engineOutput.netSuccesses, attackSuccesses, attackData, system, actor);
      _applyReactionOutcome(pushResult, updateData, system, attackData);
      specialMoveResult = pushResult;
    } else if (specialMove === "hitShield") {
      // Colpire lo Scudo (PDF line 2540): shield resistance check
      // Target number = 7 (± quality mod) - net attack successes. Shield destroyed on failure.
      const shieldItem = Array.from(actor.items).find(i => i.type === "shield");
      if (shieldItem) {
        const shieldTarget = 7 - netAttackSuccesses; // base resistance
        const shieldDestroyed = shieldTarget <= 0; // auto-fail if target <= 0
        specialMoveResult = { type: "hitShield", shieldName: shieldItem.name, shieldTarget, shieldDestroyed };
        if (shieldDestroyed) {
          await actor.deleteEmbeddedDocuments("Item", [shieldItem.id]);
        }
      } else {
        specialMoveResult = { type: "hitShield", shieldName: null, shieldDestroyed: false };
      }
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
      // Normal attack, targeted attack: resolve damage as usual
      const armorItem = Array.from(actor.items).find(i => i.type === "armor");

      // Punta persistence fix: read effective protezione from combatant flags
      let armorProt = armorItem?.system.protezione ?? 0;
      const combatant = game.combat?.resolveCombatant(actor);
      if (combatant && armorItem) {
        const puntaReductions = combatant.getFlag("sword", "puntaReductions") ?? {};
        armorProt = Math.max(0, armorProt - (puntaReductions[armorItem.id] ?? 0));
      }
      const armorRobCurrent = armorItem?.system.robustezzaCurrent ?? 0;

      // Talent bonuses (+ Sicario surprise damage)
      talentDmgBonus = (attackData.talentDamageBonus || 0) + (attackData.sicarioDamageBonus || 0);
      const defProtCtx = { hasArmor: !!armorItem, isRanged: false };
      talentProtBonus = computeTalentCombatBonus(system.talents, "protectionMod", defProtCtx);

      // da_cavallo armor pregio: +1 protezione when mounted
      const daCavalloArmorBon = computeDaCavalloArmorBonus(armorItem?.system.pregi, !!mountedMelee);

      // Cecchino: -1 Protection from crossbow aim
      const cecchinoProtRed = attackData.cecchinoProtectionReduction || 0;

      damageResult = resolveDamage({
        netSuccesses: netAttackSuccesses,
        weaponDamage: damageValue + talentDmgBonus,
        damageType,
        armorProtezione: Math.max(0, armorProt + talentProtBonus + daCavalloArmorBon - cecchinoProtRed),
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

      // Botta: -1 Riflessi (additional to defense cost)
      if (damageResult.bluntRiflessi > 0) {
        updateData["system.resources.riflessi.value"] =
          (updateData["system.resources.riflessi.value"] ?? newRiflessi) - damageResult.bluntRiflessi;
      }

      // Punta: track reduction via combatant flag instead of modifying item
      if (damageResult.thrustReduction > 0 && armorItem && combatant) {
        const puntaFlags = combatant.getFlag("sword", "puntaReductions") ?? {};
        puntaFlags[armorItem.id] = (puntaFlags[armorItem.id] ?? 0) + damageResult.thrustReduction;
        await combatant.setFlag("sword", "puntaReductions", puntaFlags);
      }

      // Update armor robustezza
      if (damageResult.armorRobustezzaLost > 0 && armorItem) {
        await armorItem.update({ "system.robustezzaCurrent": damageResult.armorRobustezzaNew });
      }

      // Targeted attack: flag for GM reaction prompt
      if (specialMove === "targetedAttack") {
        specialMoveResult = { type: "targetedAttack", target: attackData.specialMoveTarget };
      }
    }
  }

  // Defensive special moves: Contrattacco / Disarmo difensivo (PDF lines 2542-2546)
  if (defenseSucceeded && defensiveSpecialMove) {
    const netDefSuccesses = engineOutput.netSuccesses;
    if (defensiveSpecialMove === "contrattacco" && netDefSuccesses >= 3) {
      // Counterattack: attacker loses 1 Riflessi AND takes wounds = net defense + weapon damage
      const defWeaponDmg = selectedItem?.system?.damageValue || 0;
      specialMoveResult = {
        type: "contrattacco", success: true,
        attackerRiflessiLost: 1,
        attackerWounds: netDefSuccesses + defWeaponDmg
      };
    } else if (defensiveSpecialMove === "disarmoDifensivo" && netDefSuccesses >= 3) {
      // Defensive disarm: attacker loses weapon + Riflessi
      specialMoveResult = { type: "disarmoDifensivo", success: true, riflessiLost: netDefSuccesses };
    } else if (defensiveSpecialMove) {
      // Didn't reach difficulty threshold
      specialMoveResult = { type: defensiveSpecialMove, success: false };
    }
  }

  // Apply all actor updates
  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Sanguinamento: apply when critiche first reached
  if (newWounds && oldCritiche === 0 && newWounds.critiche > 0) {
    await actor.toggleStatusEffect("sanguinamento", { active: true });
    await actor.setFlag("sword", "bleedingTurns", 0);
  }

  // Sicario: surprise attack causes bleeding regardless of wound level
  if (attackData.sicarioBleeding && woundsApplied > 0 && !actor.statuses.has("sanguinamento")) {
    await actor.toggleStatusEffect("sanguinamento", { active: true });
    await actor.setFlag("sword", "bleedingTurns", 0);
  }

  // Axe mastery: each wound also causes -1 Fatica and -1 Riflessi
  if (attackData.axeMasteryActive && woundsApplied > 0) {
    await actor.update({
      "system.resources.fatica.value": Math.max(0, actor.system.resources.fatica.value - woundsApplied),
      "system.resources.riflessi.value": actor.system.resources.riflessi.value - woundsApplied
    });
  }

  // Forza reaction prompts for critiche and mortali (with actionable buttons)
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

  let canCloseMisura = false;
  let closeMisuraNewMisura = null;
  if (defenseSucceeded && engineOutput.netSuccesses >= 3 && !attackData.isRanged && game.combat) {
    const engMisura = attackData.engagementMisura;
    if (engMisura) {
      let defenderWeaponMisura = null;
      for (const item of actor.items) {
        if (item.type !== "weapon") continue;
        if (item.system.gittata > 0) continue;
        const m = item.system.misura;
        if (!m) continue;
        const idx = MISURA_ORDER.indexOf(m);
        if (idx > MISURA_ORDER.indexOf(engMisura)) {
          if (!defenderWeaponMisura || idx < MISURA_ORDER.indexOf(defenderWeaponMisura)) {
            defenderWeaponMisura = m;
          }
        }
      }
      if (defenderWeaponMisura) {
        canCloseMisura = true;
        closeMisuraNewMisura = defenderWeaponMisura;
      }
    }
  }

  // Chat template data
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
    ...engineOutput,
    grade,
    extraDice,
    diceAfterReductionDisplay: engineOutput.diceAfterReduction.map(d => ({
      value: d, isOne: d === 1
    })),
    defenseSucceeded,
    hasPenalty: basePenalty > 0,
    fatiguePenalty,
    woundPenalty: woundPenalty,
    armorPenalty,
    encumbrancePenalty,
    penaltyCancelled: spiritoCancelPenalty,
    effectivePenalty,
    riflessiCost,
    isFreeShieldParry,
    talentParryBonus,
    talentSuccessBonus,
    approach,
    approachLabel: game.i18n.localize(`SWORD.Combat.Approach${approach.charAt(0).toUpperCase() + approach.slice(1)}`),
    // Damage section (only if defense failed and normal/targeted damage)
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
    // Phase 3: special move results
    specialMove,
    specialMoveResult,
    isNonLethal: specialMoveResult?.type === "nonLethal",
    isFeint: specialMoveResult?.type === "feint",
    isTargetedAttack: specialMoveResult?.type === "targetedAttack",
    isGrapple: specialMoveResult?.type === "grapple",
    isPushResult: specialMoveResult?.type === "push",
    isHitShield: specialMoveResult?.type === "hitShield",
    isContrattacco: specialMoveResult?.type === "contrattacco",
    isDisarmoDifensivo: specialMoveResult?.type === "disarmoDifensivo",
    defensiveSpecialMove,
    tacticalAdvantageUsed: useTacticalAdvantage,
    // Close Misura
    canCloseMisura,
    closeMisuraNewMisura,
    closeMisuraAttackerActorId: attackData.attackerTokenId || attackData.attackerId,
    closeMisuraDefenderActorId: game.combat?.combatKey(actor) ?? actor.id,
    // Action cost display
    isStandardAction: isParata && !isFreeShieldParry && !isFreeSwordParry && !isMaestroShieldReaction && !isExtraParry3Riflessi,
    isFreeAction: isFreeShieldParry || isFreeSwordParry,
    isFreeSwordParry,
    isExtraParry3Riflessi,
    isMaestroShieldReaction,
    pesanteRiflessiCost
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
