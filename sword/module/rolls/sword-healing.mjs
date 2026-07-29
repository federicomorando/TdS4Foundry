/**
 * Healing action — Guarigione skill check to cure wounds on a patient.
 *
 * PDF §3.4 (lines 1625-1629):
 *  - 1 wound cured per success
 *  - 15 min per wound cured (halved with Medico da campo)
 *  - Penalty from patient wound level: -1 Gravi, -2 Critiche, -3 Mortali
 *  - Penalty without bandages: -2 (or -1 with improvised)
 *  - Penalty without surgical tools for Gravi+: -2
 *  - Medico da campo: -1 to wound level and equipment penalties
 *  - Failure: +1 wound to patient
 *  - Cannot heal same patient more than once per day
 */
import { swordCheckResolve } from "../engine.mjs";
import { SKILL_MAP } from "../data/actor.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { buildPenaltyHtml } from "./dialog-helpers.mjs";

/**
 * Perform a healing check on a target actor.
 * @param {Actor} healer - The actor performing healing
 * @param {Actor} [patient] - The target actor (defaults to selected token's actor)
 */
export async function swordHealing(healer) {
  const system = healer.system;
  const ec = system.effectiveCharacteristics ?? system.characteristics;
  const charKey = SKILL_MAP.guarigione;  // prudentia
  const charScore = ec[charKey];
  const skillData = system.skills.guarigione;
  const grade = skillData?.grade || 0;
  const extraDice = skillData?.extraDice || 0;
  const isUntrained = grade === 0 && extraDice === 0;

  const hasMedicoDaCampo = system.talentSpecials?.has("halve_wound_healing_time")
    && system.talentSpecials?.has("reduce_cure_penalty");
  const penaltyReduction = hasMedicoDaCampo ? 1 : 0;

  // Collect foci
  const allFoci = collectAllFoci(system);
  const focusHtml = buildFocusDialogHtml(allFoci);

  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const basePenalty = fatiguePenalty + woundPenalty + encumbrancePenalty;
  const spirito = system.resources.spirito;

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${game.i18n.localize("SWORD.Healing.Label")}</strong> — ${game.i18n.localize("SWORD.Skills.guarigione")} (${charScore})</p>
      ${grade > 0 ? `<p class="hint">${game.i18n.localize("SWORD.Grade")}: ${grade}</p>` : ""}
      ${hasMedicoDaCampo ? `<p class="hint"><i class="fas fa-user-doctor"></i> ${game.i18n.localize("SWORD.Healing.MedicoDaCampo")}</p>` : ""}
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
      </div>
      ${focusHtml}
      <hr/>
      <h4>${game.i18n.localize("SWORD.Healing.PatientCondition")}</h4>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Healing.WoundLevel")}</label>
        <select name="patientWoundLevel">
          <option value="0">${game.i18n.localize("SWORD.Wounds.graffi")} / ${game.i18n.localize("SWORD.Wounds.leggere")} (0)</option>
          <option value="1">${game.i18n.localize("SWORD.Wounds.gravi")} (-${Math.max(0, 1 - penaltyReduction)})</option>
          <option value="2">${game.i18n.localize("SWORD.Wounds.critiche")} (-${Math.max(0, 2 - penaltyReduction)})</option>
          <option value="3">${game.i18n.localize("SWORD.Wounds.mortali")} (-${Math.max(0, 3 - penaltyReduction)})</option>
        </select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Healing.Equipment")}</label>
        <select name="equipment">
          <option value="full">${game.i18n.localize("SWORD.Healing.FullEquipment")} (0)</option>
          <option value="bandages">${game.i18n.localize("SWORD.Healing.BandagesOnly")} (0)</option>
          <option value="improvised">${game.i18n.localize("SWORD.Healing.Improvised")} (-${Math.max(0, 1 - penaltyReduction)})</option>
          <option value="none">${game.i18n.localize("SWORD.Healing.NoEquipment")} (-${Math.max(0, 2 - penaltyReduction)})</option>
        </select>
      </div>
      <div class="form-group">
        <label><input type="checkbox" name="needsSurgical" /> ${game.i18n.localize("SWORD.Healing.NeedsSurgical")} (-${Math.max(0, 2 - penaltyReduction)})</label>
      </div>
      ${basePenalty > 0 ? `<hr/>${buildPenaltyHtml(basePenalty, spirito.value)}` : ""}
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.Healing.Label")} — ${healer.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button) => {
        const form = button.form;
        return {
          diceCount: parseInt(form.elements.diceCount.value) || 2,
          focusCount: countSelectedFoci(form, allFoci.length),
          patientWoundLevel: parseInt(form.elements.patientWoundLevel.value) || 0,
          equipment: form.elements.equipment.value,
          needsSurgical: form.elements.needsSurgical.checked,
          spiritoCancelPenalty: parseInt(form.elements.spiritoCancelPenalty?.value) || 0
        };
      }
    }
  });

  if (!result) return;

  let { diceCount, focusCount, patientWoundLevel, equipment, needsSurgical, spiritoCancelPenalty } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;

  // Compute healing penalties
  let healingPenalty = 0;

  // Patient wound level penalty (reduced by Medico da campo)
  healingPenalty += Math.max(0, patientWoundLevel - penaltyReduction);

  // Equipment penalty (reduced by Medico da campo)
  if (equipment === "none") {
    healingPenalty += Math.max(0, 2 - penaltyReduction);
  } else if (equipment === "improvised") {
    healingPenalty += Math.max(0, 1 - penaltyReduction);
  }

  // Surgical tools penalty for Gravi+ (reduced by Medico da campo)
  if (needsSurgical) {
    healingPenalty += Math.max(0, 2 - penaltyReduction);
  }

  // Healer's own penalties
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
  spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);
  const totalPenalty = basePenalty - spiritoCancelPenalty + healingPenalty;

  // Roll
  const totalDice = diceCount + extraDice + focusCount;
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  const engineOutput = swordCheckResolve({
    characteristicScore: charScore,
    diceCount,
    grade,
    extraDice: extraDice + focusCount,
    successBonus: 0,
    successPenalty: totalPenalty,
    difficultyThreshold: null,
    opposedSuccesses: null,
    diceRolled,
    discardIndices: null
  });

  // Deduct spirito
  if (spiritoCancelPenalty > 0) {
    await healer.update({
      "system.resources.spirito.value": spirito.value - spiritoCancelPenalty
    });
  }

  const passed = engineOutput.basePassed;
  const successes = engineOutput.finalSuccesses;
  const woundsCured = passed ? successes : 0;
  const woundsInflicted = !passed ? 1 : 0;
  const timePerWound = hasMedicoDaCampo ? 8 : 15;
  const totalTime = woundsCured * timePerWound;

  // Build chat card
  const penaltyParts = [];
  if (patientWoundLevel > 0) {
    const wlNames = ["", "SWORD.Wounds.gravi", "SWORD.Wounds.critiche", "SWORD.Wounds.mortali"];
    penaltyParts.push(`${game.i18n.localize(wlNames[patientWoundLevel])}: -${Math.max(0, patientWoundLevel - penaltyReduction)}`);
  }
  if (equipment === "none") penaltyParts.push(`${game.i18n.localize("SWORD.Healing.NoEquipment")}: -${Math.max(0, 2 - penaltyReduction)}`);
  else if (equipment === "improvised") penaltyParts.push(`${game.i18n.localize("SWORD.Healing.Improvised")}: -${Math.max(0, 1 - penaltyReduction)}`);
  if (needsSurgical) penaltyParts.push(`${game.i18n.localize("SWORD.Healing.NeedsSurgical")}: -${Math.max(0, 2 - penaltyReduction)}`);

  const content = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${healer.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas fa-heart-pulse"></i> ${game.i18n.localize("SWORD.Healing.Label")}</h3>
        </div>
      </header>
      <div class="result-section">
        <div class="damage-line">${game.i18n.localize("SWORD.Skills.guarigione")} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
        ${penaltyParts.length > 0 ? `<div class="damage-line">${penaltyParts.join("; ")}</div>` : ""}
        <div class="damage-line">${passed ? "✓" : "✗"} ${game.i18n.localize(passed ? "SWORD.Chat.Passed" : "SWORD.Chat.Failed")} — ${game.i18n.localize("SWORD.Chat.Successes")}: ${successes}</div>
        ${woundsCured > 0 ? `<div class="damage-line"><strong>${game.i18n.localize("SWORD.Healing.WoundsCured")}: ${woundsCured}</strong> (${totalTime} ${game.i18n.localize("SWORD.Healing.Minutes")})</div>` : ""}
        ${woundsInflicted > 0 ? `<div class="damage-line"><strong>${game.i18n.localize("SWORD.Healing.FailureWound")}</strong></div>` : ""}
        ${hasMedicoDaCampo ? `<div class="damage-line"><i class="fas fa-user-doctor"></i> ${game.i18n.localize("SWORD.Healing.MedicoDaCampo")}</div>` : ""}
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: healer }),
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}
