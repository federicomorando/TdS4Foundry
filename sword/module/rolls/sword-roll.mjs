import { SKILL_MAP, SOCIAL_SKILLS } from "../data/actor.mjs";
import { armorSkillPenalty, QUALITY_TIERS } from "../engine.mjs";
import { computeTalentContextExtraDice, computeTalentEffectBonus } from "../engine.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { VALORE_KEYS } from "../engine.mjs";
import { resolveCheck } from "../engine.mjs";
import {
  buildPenaltyParts, buildPenaltyHtml, buildValoreSelectHtml,
  buildFamaHtml, buildCombinedSkillOptions, buildCombinedManeuverHtml,
  formInt, formStr, formBool
} from "./dialog-helpers.mjs";

function skillGearQualityBonus(items, skillId) {
  let best = null;
  for (const item of items) {
    if (item.type !== "gear") continue;
    if (item.system.skillBonusSkillId !== skillId) continue;
    const tier = QUALITY_TIERS.find(q => q.id === item.system.quality);
    if (!tier) continue;
    if (best === null || tier.skillGearBonus > best) best = tier.skillGearBonus;
  }
  return best ?? 0;
}

/**
 * Main roll adapter: dialog -> Foundry Roll -> engine -> chat card.
 * Supports: Valori activation, Fama spending, Fatigue penalty + Spirito cancellation.
 * @param {Actor} actor
 * @param {string} skillId
 * @param {object} [options]
 * @param {string} [options.combinedSkillId] - Pre-selected combined maneuver skill
 */
export async function swordRoll(actor, skillId, options = {}) {
  const system = actor.system;
  const skillData = system.skills[skillId];
  if (!skillData) {
    ui.notifications.error(`Skill not found: ${skillId}`);
    return;
  }

  const charKey = SKILL_MAP[skillId];
  const isVariesSkill = charKey === "varies";
  const defaultCharKey = isVariesSkill ? (skillData.specialtyChar || "mens") : charKey;
  const defaultCharScore = system.effectiveCharacteristics?.[defaultCharKey] ?? system.characteristics[defaultCharKey];
  const defaultCharLabel = game.i18n.localize(`SWORD.Characteristics.${defaultCharKey}`);
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);

  const grade = skillData.grade;
  const allFoci = collectAllFoci(system);
  const extraDice = skillData.extraDice;
  const isUntrained = grade === 0 && extraDice === 0;

  // --- Gather context for resource-spending options ---
  const spirito = system.resources.spirito;
  const isSocial = SOCIAL_SKILLS.has(skillId);
  const fama = system.fama;
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const fatigueLevel = system.fatigueLevel || "fresco";

  const canUseValore = VALORE_KEYS.some(k => system.valori[k] > 0) && spirito.value >= 3;

  // --- Combined Maneuver: build correlated skill options ---
  const combined = buildCombinedSkillOptions(system, skillId, grade);

  // --- Build dialog content ---
  const extraDiceHint =
    extraDice > 0
      ? `<p class="hint">+${extraDice} dadi extra (talento)</p>`
      : "";
  const untrainedHint = isUntrained
    ? `<p class="hint">${game.i18n.localize("SWORD.Roll.Untrained")}</p>`
    : "";

  const valoreHtml = buildValoreSelectHtml(system);

  const hasMondano = !!system.talentSpecials?.has("add_fides_honor_to_fama");
  const famaHtml = isSocial
    ? buildFamaHtml(fama, { hasMondano, valori: system.valori })
    : "";

  // Erudita study bonus
  const eruditaStudyBonus = system.eruditaStudyBonus || 0;

  // Contextual talent toggles for skill checks
  const talentContextHtmlParts = [];
  if (skillId === "furtivita") {
    talentContextHtmlParts.push(`
      <div class="form-group">
        <label><input type="checkbox" name="ctxFurtivitaUrban" /> ${game.i18n.localize("SWORD.Roll.CtxFurtivitaUrban")}</label>
      </div>
    `);
  }
  if (skillId === "arte_della_guerra") {
    talentContextHtmlParts.push(`
      <div class="form-group">
        <label><input type="checkbox" name="ctxBattlefieldStudy" /> ${game.i18n.localize("SWORD.Roll.CtxBattlefieldStudy")}</label>
      </div>
    `);
  }
  if (skillId === "sopravvivenza") {
    talentContextHtmlParts.push(`
      <div class="form-group">
        <label><input type="checkbox" name="ctxCampPreparation" /> ${game.i18n.localize("SWORD.Roll.CtxCampPreparation")}</label>
      </div>
    `);
  }
  if (skillId === "forza") {
    talentContextHtmlParts.push(`
      <div class="form-group">
        <label><input type="checkbox" name="ctxPoisonReaction" /> ${game.i18n.localize("SWORD.Roll.CtxPoisonReaction")}</label>
      </div>
    `);
  }
  if (skillId === "autorita") {
    talentContextHtmlParts.push(`
      <div class="form-group">
        <label><input type="checkbox" name="ctxIntimidation" /> ${game.i18n.localize("SWORD.Roll.CtxIntimidation")}</label>
      </div>
    `);
  }
  // Avanguardia: sacrifice 1 success for +1 die to companions (Furtività/Percezione/Sopravvivenza)
  const hasAvanguardia = !!system.talentSpecials?.has("sacrifice_success_companion_die");
  if (hasAvanguardia && (skillId === "furtivita" || skillId === "percezione" || skillId === "sopravvivenza")) {
    talentContextHtmlParts.push(`
      <div class="form-group">
        <label><input type="checkbox" name="ctxAvanguardia" /> ${game.i18n.localize("SWORD.Talent.AvanguardiaSacrifice")}</label>
      </div>
    `);
  }

  // Carovaniere: traveling grants +1 success to Percezione checks (errata: "prove di Percezione e Reazioni di Fatica")
  // Check combat combatants first, fall back to all player-owned actors when outside combat
  const anyCarovaniere = skillId === "percezione" && (
    game.combat
      ? game.combat.combatants.some(c => c.actor?.hasPlayerOwner && c.actor.system?.talentSpecials?.has("party_travel_bonus"))
      : game.actors.some(a => a.hasPlayerOwner && a.system?.talentSpecials?.has("party_travel_bonus"))
  );
  if (anyCarovaniere) {
    talentContextHtmlParts.push(`
      <div class="form-group">
        <label><input type="checkbox" name="ctxTraveling" /> ${game.i18n.localize("SWORD.Talent.CarovaniereTraveling")}</label>
      </div>
    `);
  }

  const talentContextHtml = talentContextHtmlParts.join("");

  // Armor penalty for superscript-A skills (if armor equipped)
  const armorItem = Array.from(actor.items).find(i => i.type === "armor");
  const armorPenalty = armorItem
    ? armorSkillPenalty(armorItem.system.protezione || 0, armorItem.system.pregi || [], skillId)
    : 0;

  // Combined penalty (fatigue + wounds + armor + encumbrance)
  const basePenalty = fatiguePenalty + woundPenalty + armorPenalty + encumbrancePenalty;

  // Erudita HTML (checkbox for +1 success on study/meditation/work)
  let eruditaHtml = "";
  if (eruditaStudyBonus > 0) {
    eruditaHtml = `
      <div class="form-group">
        <label><input type="checkbox" name="eruditaBonus" /> ${game.i18n.localize("SWORD.Roll.EruditaBonus")}</label>
      </div>
    `;
  }

  const penaltyParts = buildPenaltyParts({ fatiguePenalty, woundPenalty, encumbrancePenalty, fatigueLevel });
  const penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value, penaltyParts);

  const combinedHtml = buildCombinedManeuverHtml(combined.options, combined.canUse, { preSelected: options.combinedSkillId || "" });

  const characteristicOptionsHtml = isVariesSkill
    ? `
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Creation.StepCharacteristics")}</label>
        <select name="characteristic">
          <option value="fortitudo">${game.i18n.localize("SWORD.Characteristics.fortitudo")}</option>
          <option value="celeritas">${game.i18n.localize("SWORD.Characteristics.celeritas")}</option>
          <option value="gratia">${game.i18n.localize("SWORD.Characteristics.gratia")}</option>
          <option value="mens" selected>${game.i18n.localize("SWORD.Characteristics.mens")}</option>
          <option value="prudentia">${game.i18n.localize("SWORD.Characteristics.prudentia")}</option>
          <option value="audacia">${game.i18n.localize("SWORD.Characteristics.audacia")}</option>
        </select>
      </div>
    `
    : "";

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${skillLabel}</strong> (${defaultCharLabel} ${defaultCharScore})</p>
      ${grade > 0 ? `<p class="hint">${game.i18n.localize("SWORD.Grade")}: ${grade}</p>` : ""}
      ${extraDiceHint}
      ${characteristicOptionsHtml}
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
        ${untrainedHint}
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.Difficulty")}</label>
        <input type="number" name="difficulty" value="" min="1" placeholder="\u2014" />
      </div>
      ${famaHtml}
      ${eruditaHtml}
      ${talentContextHtml}
      ${penaltyHtml}
      ${combinedHtml}
      ${buildFocusDialogHtml(allFoci)}
      ${valoreHtml}
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: {
      title: game.i18n.format("SWORD.Roll.Title", { skill: skillLabel })
    },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button, dialog) => {
        const form = button.form;
        return {
          characteristic: formStr(form, "characteristic", defaultCharKey),
          diceCount: formInt(form, "diceCount", 2),
          difficulty: formInt(form, "difficulty") || null,
          valore: formStr(form, "valore"),
          famaSpend: formInt(form, "famaSpend"),
          mondanoValore: formStr(form, "mondanoValore"),
          spiritoCancelPenalty: formInt(form, "spiritoCancelPenalty"),
          eruditaBonus: formBool(form, "eruditaBonus"),
          ctxFurtivitaUrban: formBool(form, "ctxFurtivitaUrban"),
          ctxBattlefieldStudy: formBool(form, "ctxBattlefieldStudy"),
          ctxCampPreparation: formBool(form, "ctxCampPreparation"),
          ctxPoisonReaction: formBool(form, "ctxPoisonReaction"),
          ctxIntimidation: formBool(form, "ctxIntimidation"),
          ctxAvanguardia: formBool(form, "ctxAvanguardia"),
          ctxTraveling: formBool(form, "ctxTraveling"),
          combinedSkill: formStr(form, "combinedSkill"),
          combinedCostSource: formStr(form, "combinedCostSource", "spirito"),
          focusDice: countSelectedFoci(form, allFoci.length)
        };
      }
    }
  });

  if (!result) return; // Dialog dismissed

  let {
    characteristic, diceCount, difficulty, valore, famaSpend, mondanoValore, spiritoCancelPenalty, eruditaBonus,
    ctxFurtivitaUrban, ctxBattlefieldStudy, ctxCampPreparation, ctxPoisonReaction, ctxIntimidation, ctxAvanguardia, ctxTraveling,
    combinedSkill, combinedCostSource, focusDice
  } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;
  const effectiveCharKey = isVariesSkill ? (characteristic || defaultCharKey) : defaultCharKey;
  const baseCharScore = system.effectiveCharacteristics?.[effectiveCharKey] ?? system.characteristics[effectiveCharKey];
  // Skill gear quality bonus (§12.2): modifies characteristic score
  const gearQualityBonus = skillGearQualityBonus(actor.items, skillId);
  const charScore = baseCharScore + gearQualityBonus;
  const charLabel = game.i18n.localize(`SWORD.Characteristics.${effectiveCharKey}`);

  // Combined Maneuver: validate and compute effective grade
  let combinedGrade = 0;
  let combinedSkillLabel = "";
  if (combinedSkill && system.skills[combinedSkill]?.grade >= 1 && grade >= 1) {
    combinedGrade = system.skills[combinedSkill].grade;
    combinedSkillLabel = game.i18n.localize(`SWORD.Skills.${combinedSkill}`);
  }

  // Clamp famaSpend
  famaSpend = Math.min(Math.max(famaSpend, 0), fama);

  // Mondano: add Fides or Honor score as bonus dice when spending Fama
  let mondanoBonus = 0;
  if (famaSpend > 0 && mondanoValore && hasMondano) {
    mondanoBonus = system.valori[mondanoValore] || 0;
  }

  // Clamp spiritoCancelPenalty
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);

  // Validate valore selection: must have spirito >= 3 and valore score > 0
  let valoreSelected = null;
  let valoreScore = 0;
  if (valore && canUseValore) {
    valoreScore = system.valori[valore] || 0;
    if (valoreScore > 0) {
      valoreSelected = valore;
    }
  }

  // Talent contextual success bonuses
  let talentSuccessBonus = 0;
  if (ctxFurtivitaUrban) talentSuccessBonus += computeTalentEffectBonus(system.talents, "successBonus", "furtivita_urban");
  if (ctxBattlefieldStudy) talentSuccessBonus += computeTalentEffectBonus(system.talents, "successBonus", "battlefield_study");
  if (ctxCampPreparation) talentSuccessBonus += computeTalentEffectBonus(system.talents, "successBonus", "camp_preparation");
  if (ctxPoisonReaction) talentSuccessBonus += computeTalentEffectBonus(system.talents, "successBonus", "poison_reaction");
  if (ctxAvanguardia) talentSuccessBonus -= 1;
  if (ctxTraveling) talentSuccessBonus += 1;

  // Talent contextual extra dice (currently: intimidation)
  let contextualTalentDice = 0;
  if (ctxIntimidation) {
    contextualTalentDice += computeTalentContextExtraDice(system.talents, skillId, "intimidation");
  }

  // Erudita: +1 success bonus when checkbox checked
  const eruditaSuccessBonus = (eruditaBonus && eruditaStudyBonus > 0) ? eruditaStudyBonus : 0;

  // Compute total dice for Foundry Roll
  const totalExtraDice = extraDice + famaSpend + mondanoBonus + contextualTalentDice + focusDice;
  const totalDice = diceCount + totalExtraDice;

  // Roll dice via Foundry
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  // --- Use-case call ---
  const checkResult = resolveCheck({
    characteristicScore: charScore, diceCount, grade, extraDice,
    focusDice, famaSpend, mondanoBonus, contextualDice: contextualTalentDice,
    combinedGrade, combinedCostSource, inCombat: !!game.combat,
    valoreSelected, valoreScore,
    hasActivationPlus1: system.talentSpecials?.has("valori_activation_plus1"),
    spiritoCancelPenalty,
    successBonus: eruditaSuccessBonus + talentSuccessBonus,
    difficultyThreshold: difficulty,
    hasRiflessiCostMinus1: !!system.talentSpecials?.has("riflessi_cost_minus1")
  }, {
    fatiguePenalty, woundPenalty, armorPenalty, encumbrancePenalty,
    spirito: spirito.value, fama, fatica: system.resources.fatica.value,
    riflessi: system.resources.riflessi.value
  }, diceRolled);

  const { engineOutput, valoreUsed, valoreBonus, effectivePenalty } = checkResult;
  const valoreName = valoreUsed ? game.i18n.localize(`SWORD.Valori.${valoreSelected}`) : "";

  // Apply resource patches
  const updateData = {};
  for (const [key, value] of Object.entries(checkResult.patches)) {
    if (key.startsWith("resources.")) {
      updateData[`system.${key}.value`] = value;
    } else {
      updateData[`system.${key}`] = value;
    }
  }
  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Prepare chat template data
  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    skillLabel,
    charLabel,
    ...engineOutput,
    grade,
    extraDice: totalExtraDice,
    hasDifficulty: engineOutput.difficultyThreshold !== null,
    hasOpposed: engineOutput.opposedSuccesses !== null,
    // Pre-compute display flags for dice
    diceAfterReductionDisplay: engineOutput.diceAfterReduction.map((d) => ({
      value: d,
      isOne: d === 1
    })),
    // Valore activation
    valoreUsed,
    valoreName,
    valoreBonus,
    // Fama spending
    famaUsed: famaSpend > 0,
    famaPoints: famaSpend,
    // Penalty info
    hasFatiguePenalty: fatiguePenalty > 0,
    fatiguePenalty,
    hasWoundPenalty: woundPenalty > 0,
    woundPenalty,
    hasArmorPenalty: armorPenalty > 0,
    armorPenalty,
    hasEncumbrancePenalty: encumbrancePenalty > 0,
    encumbrancePenalty,
    fatiguePenaltyCancelled: spiritoCancelPenalty,
    effectivePenalty,
    // Gear quality bonus
    hasGearQualityBonus: gearQualityBonus !== 0,
    gearQualityBonus,
    // Erudita study bonus
    eruditaBonusUsed: eruditaSuccessBonus > 0,
    eruditaSuccessBonus,
    // Talent contextual bonuses
    talentSuccessBonus,
    contextualTalentDice,
    // Combined Maneuver
    combinedUsed: combinedGrade > 0,
    combinedSkillLabel,
    combinedGrade
  };

  const html = await renderTemplate(
    "systems/sword/templates/chat/check-result.hbs",
    chatData
  );

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });

  // Avanguardia: post companion hint after roll
  if (ctxAvanguardia) {
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<div class="sword chat-card"><div class="result-section"><div class="damage-line"><i class="fas fa-eye"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Talent.AvanguardiaHint")}</div></div></div>`
    });
  }
}
