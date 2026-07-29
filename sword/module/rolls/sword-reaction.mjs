/**
 * General Reaction action.
 *
 * Reactions are defensive checks triggered by the GM covering fear, fatigue,
 * disease, poison, wounds, and agility dodges. PDF p.85–87, Errata §4.4.
 *
 * Skill depends on type: Forza (fatica/malattia/veleno/ferite),
 * Volontà (paura), Agilità (agilita).
 * Riflessi cost = threat successes - net successes (in combat).
 * Combined maneuvers cannot be used with reactions.
 */
import { computeCavalcareThreshold, computeTalentCombatBonus } from "../engine.mjs";
import { SKILL_MAP } from "../data/actor.mjs";
import { armorSkillPenalty } from "../engine.mjs";
import { VALORE_KEYS } from "../engine.mjs";
import { resolveReaction } from "../engine.mjs";
import { buildPenaltyParts, buildPenaltyHtml } from "./dialog-helpers.mjs";

/** Reaction type → skill mapping. */
const REACTION_SKILL_MAP = {
  fatica:    "forza",
  paura:     "volonta",
  malattia:  "forza",
  veleno:    "forza",
  ferite:    "forza",
  agilita:   "agilita",
  cavalcare: "cavalcare"
};

/** Reaction type → localization key. */
const REACTION_TYPE_LABELS = {
  fatica:    "SWORD.Reaction.TypeFatica",
  paura:     "SWORD.Reaction.TypePaura",
  malattia:  "SWORD.Reaction.TypeMalattia",
  veleno:    "SWORD.Reaction.TypeVeleno",
  ferite:    "SWORD.Reaction.TypeFerite",
  agilita:   "SWORD.Reaction.TypeAgilita",
  cavalcare: "SWORD.Reaction.TypeCavalcare"
};

/**
 * Execute a Reaction for an actor.
 * @param {Actor} actor - The acting character or creature
 * @param {object} [options] - Pre-fill options (from wound reaction buttons)
 * @param {string} [options.reactionType] - Pre-selected reaction type
 * @param {number} [options.threatSuccesses] - Pre-filled threat successes
 */
export async function swordReaction(actor, options = {}) {
  const system = actor.system;
  const isCreature = actor.type === "creature";

  // Build reaction type options
  const typeOptions = Object.entries(REACTION_TYPE_LABELS)
    .map(([key, labelKey]) => {
      const selected = options.reactionType === key ? "selected" : "";
      return `<option value="${key}" ${selected}>${game.i18n.localize(labelKey)}</option>`;
    })
    .join("");

  const threatDefault = options.threatSuccesses ?? 3;

  // Existing penalties
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = isCreature ? 0 : (system.encumbrancePenalty || 0);
  const basePenalty = fatiguePenalty + woundPenalty + encumbrancePenalty;
  const spirito = isCreature ? { value: 0, max: 0 } : system.resources.spirito;

  // Penalty HTML
  let penaltyHtml = "";
  if (!isCreature && basePenalty > 0) {
    const parts = buildPenaltyParts({ fatiguePenalty, woundPenalty, encumbrancePenalty, fatigueLevel: system.fatigueLevel || "fresco" });
    penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value, parts);
  }

  // Dice count (characters only)
  const diceHtml = isCreature ? "" : `
    <div class="form-group">
      <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
      <input type="number" name="diceCount" value="2" min="2" />
    </div>`;

  // Note about combined maneuvers
  const combineNote = `<p class="hint"><i class="fas fa-ban"></i> ${game.i18n.localize("SWORD.Reaction.CannotCombine")}</p>`;

  // Ombra: option to spend Spirito instead of Riflessi for reactions
  const hasSpiritoForReactions = !isCreature && !!system.talentSpecials?.has("spirito_for_reactions");
  const spiritoOptionHtml = hasSpiritoForReactions ? `
    <div class="form-group">
      <label><input type="checkbox" name="useSpiritoForRiflessi" checked /> ${game.i18n.localize("SWORD.Talent.SpiritoForRiflessi")}</label>
    </div>` : "";

  // Carovaniere: traveling checkbox (any allied member with party_travel_bonus grants +1 to Fatica reactions)
  const anyCarovaniere = !isCreature && game.combat && game.combat.combatants.some(c =>
    c.actor?.hasPlayerOwner && c.actor.system?.talentSpecials?.has("party_travel_bonus")
  );
  const travelCheckboxHtml = anyCarovaniere ? `
    <div class="form-group">
      <label><input type="checkbox" name="isTraveling" /> ${game.i18n.localize("SWORD.Talent.CarovaniereTraveling")}</label>
    </div>
  ` : "";

  // Fiore della cavalleria: formation bonus applies to reactions too (errata: "tutti ricevono un successo bonus")
  // Any allied combatant with the talent enables the checkbox for the whole party
  const hasFormation = !isCreature && game.combat && game.combat.combatants.some(c =>
    c.actor?.hasPlayerOwner && c.actor.system?.talentSpecials?.has("formation_bonus")
  );
  const formationHtml = hasFormation ? `
    <div class="form-group">
      <label><input type="checkbox" name="useFormation" /> ${game.i18n.localize("SWORD.Talent.FormationBonus")}</label>
    </div>` : "";

  const dialogContent = `
    <div class="sword-roll-dialog">
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Reaction.ReactionType")}</label>
        <select name="reactionType">${typeOptions}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Reaction.ThreatSuccesses")}</label>
        <input type="number" name="threatSuccesses" value="${threatDefault}" min="0" />
      </div>
      ${diceHtml}
      ${penaltyHtml}
      ${spiritoOptionHtml}
      ${travelCheckboxHtml}
      ${formationHtml}
      ${combineNote}
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.Reaction.Label")} — ${actor.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button) => {
        const form = button.form;
        return {
          reactionType: form.elements.reactionType.value,
          threatSuccesses: parseInt(form.elements.threatSuccesses.value) || 0,
          diceCount: parseInt(form.elements.diceCount?.value) || 2,
          spiritoCancelPenalty: parseInt(form.elements.spiritoCancelPenalty?.value) || 0,
          useSpiritoForRiflessi: form.elements.useSpiritoForRiflessi?.checked || false,
          isTraveling: form.elements.isTraveling?.checked || false,
          useFormation: form.elements.useFormation?.checked || false
        };
      }
    }
  });

  if (!result) return;

  let { reactionType, threatSuccesses, diceCount, spiritoCancelPenalty, useSpiritoForRiflessi, isTraveling, useFormation } = result;
  if (diceCount < 2) diceCount = 2;
  threatSuccesses = Math.max(0, threatSuccesses);

  // Senza fiato: block Agilità reactions, allow others with +1 penalty and no Riflessi cost
  // (errata §4.6 line 2141)
  const isSenzaFiato = actor.statuses?.has("senza-fiato") ?? false;
  if (isSenzaFiato && reactionType === "agilita") {
    ui.notifications.warn(game.i18n.localize("SWORD.Status.SenzaFiatoNoAgilita"));
    return;
  }

  // Determine skill
  const skillId = REACTION_SKILL_MAP[reactionType];
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);
  const reactionTypeLabel = game.i18n.localize(REACTION_TYPE_LABELS[reactionType]);

  // Armor penalty for fatigue reactions
  let armorReactionPenalty = 0;
  if (reactionType === "fatica" && !isCreature) {
    const armorItem = Array.from(actor.items).find(i => i.type === "armor");
    if (armorItem) armorReactionPenalty = armorItem.system.protezione || 0;
  }

  // Clamp spirito cancellation
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
  spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);
  // Senza fiato: +1 penalty to non-Agilità reactions (errata §4.6 line 2141)
  const senzaFiatoPenalty = isSenzaFiato ? 1 : 0;
  const effectivePenalty = basePenalty - spiritoCancelPenalty + armorReactionPenalty + senzaFiatoPenalty;

  // ── Talent reaction bonuses ──
  let reactionTalentBonus = 0;
  if (!isCreature) {
    // Battipista: +1 success to fatigue reactions of COMPANIONS (errata: "dei compagni", not self)
    if (reactionType === "fatica" && game.combat) {
      const hasBattipista = game.combat.combatants.some(c => {
        const other = c.actor;
        return other && other.id !== actor.id && other.hasPlayerOwner
          && other.system?.talentSpecials?.has("travel_distance_bonus");
      });
      if (hasBattipista) reactionTalentBonus += 1;
    }

    // Carovaniere: traveling checkbox grants +1 to Fatica reactions
    if (isTraveling && reactionType === "fatica") {
      reactionTalentBonus += 1;
    }

    // Fiore della cavalleria: formation bonus +1 to reactions (errata: "attacchi, difese e Reazioni")
    if (useFormation) {
      reactionTalentBonus += 1;
    }

    // Araldo: companions_reaction_resolve_bonus — any other combatant with talent sharing a Valore grants +1
    if (game.combat) {
      const actorValori = VALORE_KEYS.filter(k => (system.valori?.[k] || 0) > 0);
      for (const combatant of game.combat.combatants) {
        const other = combatant.actor;
        if (!other || other.id === actor.id || !combatant.actor?.hasPlayerOwner) continue;
        if (!other.system.talentSpecials?.has("companions_reaction_resolve_bonus")) continue;
        const otherValori = VALORE_KEYS.filter(k => (other.system.valori?.[k] || 0) > 0);
        if (actorValori.some(v => otherValori.includes(v))) {
          reactionTalentBonus += 1;
          break; // Only +1 total from Araldo
        }
      }
    }
  }

  // ── Roll / compute ──
  let engineOutput = null;
  let reactionPatches = null;
  let finalSuccesses = 0;
  let passed = false;
  let diceAfterReductionDisplay = [];

  const inCombat = !!game.combat;
  let riflessiCost = 0;
  let fatigaLost = 0;
  let fearOutcome = null;
  let fearOutcomeLabel = "";
  let fearFatigaLost = 0;
  let fearDurationText = "";
  let cavalcareOutcome = null;

  if (isCreature) {
    // Creature: fixed successes (no talent bonuses for creatures)
    const fixedSuccesses = system.abilities?.[skillId] ?? system.skills?.[skillId] ?? 0;
    finalSuccesses = Math.max(0, fixedSuccesses - effectivePenalty);
    passed = finalSuccesses > 0 && finalSuccesses >= threatSuccesses;
  } else {
    // Character: dice roll → use-case
    const charKey = SKILL_MAP[skillId];
    const ec = system.effectiveCharacteristics ?? system.characteristics;
    const charScore = ec[charKey];
    const skillData = system.skills[skillId];
    const grade = skillData?.grade || 0;
    const extraDice = skillData?.extraDice || 0;
    const isUntrained = grade === 0 && extraDice === 0;
    if (isUntrained) diceCount = 2;

    const totalDice = diceCount + extraDice;
    const roll = new Roll(`${totalDice}d6`);
    await roll.evaluate();
    const diceRolled = roll.terms[0].values;

    // --- Use-case call ---
    const reactionResult = resolveReaction({
      reactionType, threatSuccesses, characteristicScore: charScore,
      diceCount, grade, extraDice, spiritoCancelPenalty,
      reactionTalentBonus,
      hasRiflessiCostMinus1: !!system.talentSpecials?.has("riflessi_cost_minus1"),
      useSpiritoForRiflessi, isSenzaFiato, inCombat
    }, {
      fatiguePenalty, woundPenalty, encumbrancePenalty, armorReactionPenalty,
      spirito: spirito.value, fatica: system.resources.fatica.value,
      riflessi: system.resources.riflessi.value
    }, diceRolled);

    engineOutput = reactionResult.engineOutput;
    reactionPatches = reactionResult.patches;
    finalSuccesses = reactionResult.finalSuccesses;
    passed = reactionResult.passed;
    riflessiCost = reactionResult.riflessiCost;
    fatigaLost = reactionResult.fatigaLost;
    fearOutcome = reactionResult.fearOutcome;
    fearFatigaLost = reactionResult.fearFatigaLost;
    cavalcareOutcome = reactionResult.cavalcareOutcome;
    spiritoCancelPenalty = reactionResult.spiritoCancelPenalty;

    diceAfterReductionDisplay = engineOutput.diceAfterReduction.map(d => ({
      value: d, isOne: d === 1
    }));

    // Fear duration rolls (adapter-side, dice rolling is Foundry's job)
    if (fearOutcome?.key) {
      fearOutcomeLabel = game.i18n.localize(`SWORD.Reaction.${_capitalize(fearOutcome.key)}`);
      if (fearOutcome.key === "crollo") {
        const durationRoll = new Roll("1d6");
        await durationRoll.evaluate();
        const d6 = durationRoll.terms[0].values[0];
        fearDurationText = `1d6 = ${d6} → ${d6 * 10} minuti`;
      } else if (fearOutcome.key === "collasso") {
        const durationRoll = new Roll("1d6");
        await durationRoll.evaluate();
        const d6 = durationRoll.terms[0].values[0];
        fearDurationText = `1d6 = ${d6} → ${d6} ore`;
      }
    }
  }

  // ── Compute net/uncontested successes ──
  const netSuccesses = finalSuccesses - threatSuccesses;
  const uncontestedSuccesses = passed ? 0 : Math.max(0, threatSuccesses - finalSuccesses);

  // ── Apply updates ──
  const updateData = {};
  const totalFaticaLost = fatigaLost + fearFatigaLost;

  if (!isCreature && reactionPatches) {
    // Character: apply the use-case patches verbatim — the engine clamps
    // spirito at 0 and converts overflow to fatica loss (applySpiritoOverflow)
    for (const [key, value] of Object.entries(reactionPatches)) {
      if (key.startsWith("resources.")) {
        updateData[`system.${key}.value`] = value;
      } else {
        updateData[`system.${key}`] = value;
      }
    }
  } else {
    // Creature: inline deductions
    if (totalFaticaLost > 0) {
      updateData["system.resources.fatica.value"] = Math.max(0, system.resources.fatica.value - totalFaticaLost);
    }
  }

  // Cavalcare: clear mounted state on failure
  if (reactionType === "cavalcare" && !passed && cavalcareOutcome && game.combat) {
    const combatant = game.combat.resolveCombatant(actor);
    if (combatant) {
      await combatant.unsetFlag("sword", "isMounted");
      await combatant.unsetFlag("sword", "mountActorId");
    }
  }

  // Fear status effects
  if (reactionType === "paura" && !passed && fearOutcome?.key) {
    if (fearOutcome.key === "collasso") {
      // Svenuto status
      await actor.toggleStatusEffect("svenuto", { active: true });
    } else {
      // Paura status + flag for fear level
      await actor.toggleStatusEffect("paura", { active: true });
      await actor.setFlag("sword", "fearLevel", fearOutcome.key);
    }
  }

  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Attesa interruption: performing a reaction while waiting forfeits recovery (errata line 2138)
  if (inCombat) {
    const combatant = game.combat.resolveCombatant(actor);
    if (combatant?.getFlag("sword", "isWaiting")) {
      await combatant.unsetFlag("sword", "isWaiting");
      ui.notifications.info(game.i18n.localize("SWORD.Combat.AttesaInterrupted"));
    }
  }

  // ── Chat card ──
  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    isCreature,
    reactionTypeLabel,
    skillLabel,
    threatSuccesses,
    finalSuccesses,
    passed,
    riflessiCost: inCombat ? riflessiCost : 0,
    fatigaLost: totalFaticaLost || 0,
    fearOutcome: fearOutcome?.key ? true : false,
    fearOutcomeLabel,
    fearDurationText,
    diceAfterReductionDisplay,
    cavalcareOutcome: cavalcareOutcome ? true : false,
    cavalcareOutcomeType: cavalcareOutcome?.type || "",
    hasPenalty: effectivePenalty > 0 || spiritoCancelPenalty > 0,
    fatiguePenalty: fatiguePenalty > 0 ? fatiguePenalty : 0,
    woundPenalty: woundPenalty > 0 ? woundPenalty : 0,
    armorReactionPenalty: armorReactionPenalty > 0 ? armorReactionPenalty : 0,
    encumbrancePenalty: encumbrancePenalty > 0 ? encumbrancePenalty : 0,
    penaltyCancelled: spiritoCancelPenalty > 0 ? spiritoCancelPenalty : 0,
    reactionTalentBonus: reactionTalentBonus > 0 ? reactionTalentBonus : 0
  };

  const html = await renderTemplate(
    "systems/sword/templates/chat/reaction-result.hbs",
    chatData
  );

  const chatMessageData = {
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html
  };

  // Include roll for dice sound (characters only)
  if (!isCreature && engineOutput) {
    const totalDice = diceCount + (system.skills[skillId]?.extraDice || 0);
    const roll = new Roll(`${totalDice}d6`);
    chatMessageData.sound = CONFIG.sounds.dice;
  }

  await ChatMessage.create(chatMessageData);
}

/** Capitalize first letter of a string. */
function _capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
