/**
 * Ars Oratoria — Social Challenge System
 *
 * PDF §4.9 (Errata lines 2254-2321):
 *  - Turn-based using Riflessi initiative (same as combat)
 *  - Two sides: player orator vs NPC orator, each gets 1 action/turn
 *  - Attempts limited by grade in starting skill
 *  - Skills: Autorità, Carisma, Raggirare, Arti liberali. Must change each turn
 *  - Autorità/Raggirare risk-reward: winner +1 bonus; loser gives opponent +1
 *  - Threshold (soglia): base 1 + modifiers. Win ≥ threshold, lose ≤ -3
 *  - Riflessi drain: winner drains loser by net successes
 *  - Senza Parole: negative Riflessi = skip current + next turn
 *  - Spectators: Intrattenere vs Carisma/Intrattenere, grade bonus per net success
 *  - Recedere: change proposal (modify threshold) without consuming attempt
 *  - Combined maneuvers cost 3 Riflessi, 1 Spirito or Fatica
 *
 * Talent keys:
 *  - ars_oratoria_riflessi_drain (Lingua Sciolta): once/sfida Carisma → drain Riflessi
 *  - no_riflessi_combined_ars_oratoria (Retore): no Riflessi for combined in oratoria
 *  - ars_oratoria_threshold_minus1 (Intuito): threshold -1
 *  - categorical_judgment_ars_oratoria (Giudice): once/sfida +1 success bonus
 */
import { SKILL_MAP } from "../data/actor.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { ORATORIA_SKILLS, RISK_REWARD_SKILLS } from "../engine.mjs";
import { resolveArsOratoriaTurn } from "../engine.mjs";
import { swordCheckResolve } from "../engine.mjs";
import { buildPenaltyHtml } from "./dialog-helpers.mjs";

/**
 * Open the Ars Oratoria challenge setup dialog.
 * @param {Actor} actor - The initiating actor
 */
export async function swordArsOratoria(actor) {
  const system = actor.system;

  // Build starting skill options with grades
  const startingSkillOptions = ORATORIA_SKILLS
    .concat(["intrattenere"])
    .map(id => {
      const grade = system.skills[id]?.grade || 0;
      const label = game.i18n.localize(`SWORD.Skills.${id}`);
      return `<option value="${id}">${label} (${game.i18n.localize("SWORD.Grade")}: ${grade})</option>`;
    })
    .join("");

  // Threshold modifiers table (from errata)
  const hasThresholdMinus1 = system.talentSpecials?.has("ars_oratoria_threshold_minus1");
  const talentThresholdMod = hasThresholdMinus1 ? -1 : 0;

  const dialogContent = `
    <div class="sword-roll-dialog">
      <h3>${game.i18n.localize("SWORD.ArsOratoria.Setup")}</h3>
      ${hasThresholdMinus1 ? `<p class="hint"><i class="fas fa-lightbulb"></i> ${game.i18n.localize("SWORD.ArsOratoria.TalentThresholdMinus1")}</p>` : ""}

      <div class="form-group">
        <label>${game.i18n.localize("SWORD.ArsOratoria.Threshold")}</label>
        <input type="number" name="threshold" value="${1 + talentThresholdMod}" min="1" />
        <p class="hint">${game.i18n.localize("SWORD.ArsOratoria.ThresholdHint")}</p>
      </div>

      <div class="form-group">
        <label>${game.i18n.localize("SWORD.ArsOratoria.StartingSkill")}</label>
        <select name="startingSkill">${startingSkillOptions}</select>
      </div>

      <hr/>
      <h4>${game.i18n.localize("SWORD.ArsOratoria.Opponent")}</h4>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.ArsOratoria.OpponentName")}</label>
        <input type="text" name="opponentName" value="PNG" />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.ArsOratoria.OpponentSuccesses")}</label>
        <input type="number" name="opponentSuccesses" value="2" min="0" />
        <p class="hint">${game.i18n.localize("SWORD.ArsOratoria.OpponentSuccessesHint")}</p>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.ArsOratoria.OpponentRiflessi")}</label>
        <input type="number" name="opponentRiflessi" value="5" min="0" />
      </div>

      <hr/>
      <div class="form-group">
        <label><input type="checkbox" name="doSpectators" /> ${game.i18n.localize("SWORD.ArsOratoria.SpectatorPhase")}</label>
      </div>
    </div>`;

  const setup = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.ArsOratoria.Label")} — ${actor.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.ArsOratoria.StartChallenge"),
      icon: "fa-solid fa-comments",
      callback: (event, button) => {
        const form = button.form;
        // Preserve a legal 0 (mute/weak opponent): only fall back on an empty/NaN field.
        const intOr = (v, d) => { const n = parseInt(v, 10); return Number.isNaN(n) ? d : n; };
        return {
          threshold: intOr(form.elements.threshold.value, 1),
          startingSkill: form.elements.startingSkill.value,
          opponentName: form.elements.opponentName.value || "PNG",
          opponentSuccesses: intOr(form.elements.opponentSuccesses.value, 2),
          opponentRiflessi: intOr(form.elements.opponentRiflessi.value, 5),
          doSpectators: form.elements.doSpectators.checked
        };
      }
    }
  });

  if (!setup) return;

  // Initialize challenge state
  const maxAttempts = system.skills[setup.startingSkill]?.grade || 1;
  const state = {
    threshold: setup.threshold,
    opponentName: setup.opponentName,
    opponentFixedSuccesses: setup.opponentSuccesses,
    opponentRiflessi: setup.opponentRiflessi,
    accumulatedSuccesses: 0,
    attemptsUsed: 0,
    maxAttempts,
    usedSkills: new Set(),
    startingSkill: setup.startingSkill,
    currentOrator: actor,
    spectatorBonus: 0,
    usedLinguaSciolta: false,
    usedGiudice: false,
    round: 0,
    // Senza Parole enforcement (spec §10.4)
    opponentRiflessiMax: setup.opponentRiflessi,
    playerSkipRounds: 0,
    opponentSkipRounds: 0,
    opponentSilencedThisRound: false
  };

  // Post challenge start chat message
  await _postChatCard(actor, "fa-comments", game.i18n.localize("SWORD.ArsOratoria.Label"), `
    <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.Threshold")}: <strong>${state.threshold}</strong></div>
    <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.Opponent")}: ${state.opponentName} (${state.opponentFixedSuccesses} ${game.i18n.localize("SWORD.Chat.Successes")})</div>
    <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.MaxAttempts")}: ${maxAttempts} (${game.i18n.localize(`SWORD.Skills.${setup.startingSkill}`)})</div>
  `);

  // Spectator phase (optional)
  if (setup.doSpectators) {
    await _resolveSpectators(actor, state);
  }

  // Run rounds until win/loss/out of attempts
  await _runChallenge(actor, state);
}

/**
 * Resolve the spectator phase: Intrattenere vs opponent's Carisma/Intrattenere.
 */
async function _resolveSpectators(actor, state) {
  const system = actor.system;
  const ec = system.effectiveCharacteristics ?? system.characteristics;
  const charKey = SKILL_MAP.intrattenere;
  const charScore = ec[charKey];
  const grade = system.skills.intrattenere?.grade || 0;
  const extraDice = system.skills.intrattenere?.extraDice || 0;
  const isUntrained = grade === 0 && extraDice === 0;

  const allFoci = collectAllFoci(system);
  const focusHtml = buildFocusDialogHtml(allFoci);

  const dialogContent = `
    <div class="sword-roll-dialog">
      <h3>${game.i18n.localize("SWORD.ArsOratoria.SpectatorPhase")}</h3>
      <p>${game.i18n.localize("SWORD.ArsOratoria.SpectatorDesc")}</p>
      <p><strong>${game.i18n.localize("SWORD.Skills.intrattenere")}</strong> (${charScore})</p>
      ${grade > 0 ? `<p class="hint">${game.i18n.localize("SWORD.Grade")}: ${grade}</p>` : ""}
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
      </div>
      ${focusHtml}
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.ArsOratoria.SpectatorPhase")} — ${actor.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button) => {
        const form = button.form;
        return {
          diceCount: parseInt(form.elements.diceCount.value) || 2,
          focusDice: countSelectedFoci(form, allFoci.length)
        };
      }
    }
  });

  if (!result) return;

  let { diceCount, focusDice } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;

  const totalDice = diceCount + extraDice + focusDice;
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const totalPenalty = fatiguePenalty + woundPenalty + encumbrancePenalty;

  const engineOutput = swordCheckResolve({
    characteristicScore: charScore,
    diceCount,
    grade,
    extraDice: extraDice + focusDice,
    successBonus: 0,
    successPenalty: totalPenalty,
    difficultyThreshold: null,
    opposedSuccesses: state.opponentFixedSuccesses,
    diceRolled,
    discardIndices: null
  });

  const netSuccesses = engineOutput.netSuccesses || 0;
  if (netSuccesses > 0) {
    // Winner gets grade bonus per net success
    state.spectatorBonus = netSuccesses;
  }

  await _postChatCard(actor, "fa-users", game.i18n.localize("SWORD.ArsOratoria.SpectatorPhase"), `
    <div class="damage-line">${game.i18n.localize("SWORD.Skills.intrattenere")} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
    <div class="damage-line">${game.i18n.localize("SWORD.Chat.Successes")}: ${engineOutput.finalSuccesses} vs ${state.opponentFixedSuccesses}</div>
    ${netSuccesses > 0 ? `<div class="damage-line"><strong>${game.i18n.localize("SWORD.ArsOratoria.SpectatorWin")}: +${netSuccesses} ${game.i18n.localize("SWORD.Grade")}</strong></div>` : ""}
    ${netSuccesses <= 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.SpectatorLose")}</div>` : ""}
  `, [roll]);
}

/**
 * Main challenge loop — resolve rounds until win/loss/out of attempts.
 */
async function _runChallenge(actor, state) {
  while (state.attemptsUsed < state.maxAttempts) {
    state.round++;

    // Senza Parole (spec §10.4): the speechless side skips the current and
    // the next round; Riflessi reset to max at the start of the first
    // skipped round (like forced attesa).
    if (state.playerSkipRounds > 0) {
      if (state.playerSkipRounds === 2) {
        const orator = state.currentOrator;
        await orator.update({ "system.resources.riflessi.value": orator.system.resources.riflessi.max });
      }
      state.playerSkipRounds--;
      state.attemptsUsed++;
      await _postChatCard(state.currentOrator, "fa-comment-slash", game.i18n.localize("SWORD.ArsOratoria.Label"), `
        <div class="damage-line"><strong>${game.i18n.localize("SWORD.ArsOratoria.PlayerSkipsRound")}</strong></div>
      `);
      continue;
    }
    state.opponentSilencedThisRound = state.opponentSkipRounds > 0;
    if (state.opponentSkipRounds > 0) {
      if (state.opponentSkipRounds === 2) {
        state.opponentRiflessi = state.opponentRiflessiMax;
      }
      state.opponentSkipRounds--;
      await _postChatCard(state.currentOrator, "fa-comment-slash", game.i18n.localize("SWORD.ArsOratoria.Label"), `
        <div class="damage-line"><strong>${game.i18n.localize("SWORD.ArsOratoria.OpponentSkipsRound")}</strong></div>
      `);
    }

    const roundResult = await _resolveRound(actor, state);

    if (roundResult === null) return; // Dialog dismissed = abort

    if (roundResult === "skillsExhausted") break; // judged on accumulated total

    if (roundResult === "recedere") {
      // Recedere: modify threshold, don't consume attempt
      const newThreshold = await _promptRecedere(state);
      if (newThreshold !== null) {
        state.threshold = newThreshold;
        await _postChatCard(actor, "fa-rotate-left", game.i18n.localize("SWORD.ArsOratoria.Recedere"), `
          <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.NewThreshold")}: <strong>${state.threshold}</strong></div>
        `);
      }
      state.round--; // Don't count as a round
      continue;
    }

    // Check win/loss conditions
    if (state.accumulatedSuccesses >= state.threshold) {
      const margin = state.accumulatedSuccesses;
      let outcomeKey;
      if (margin >= 3) outcomeKey = "SWORD.ArsOratoria.WinFull";
      else if (margin >= 2) outcomeKey = "SWORD.ArsOratoria.WinPartial";
      else outcomeKey = "SWORD.ArsOratoria.WinMinimal";

      await _postChatCard(actor, "fa-trophy", game.i18n.localize("SWORD.ArsOratoria.Win"), `
        <div class="damage-line"><strong>${game.i18n.localize(outcomeKey)}</strong></div>
        <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.AccumulatedSuccesses")}: ${state.accumulatedSuccesses} / ${state.threshold}</div>
      `);
      return;
    }

    if (state.accumulatedSuccesses <= -3) {
      let lossKey;
      const neg = Math.abs(state.accumulatedSuccesses);
      if (neg >= 6) lossKey = "SWORD.ArsOratoria.LoseCatastrophic";
      else if (neg >= 4) lossKey = "SWORD.ArsOratoria.LoseSevere";
      else lossKey = "SWORD.ArsOratoria.LoseRejected";

      await _postChatCard(actor, "fa-face-frown", game.i18n.localize("SWORD.ArsOratoria.Lose"), `
        <div class="damage-line"><strong>${game.i18n.localize(lossKey)}</strong></div>
        <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.AccumulatedSuccesses")}: ${state.accumulatedSuccesses} / ${state.threshold}</div>
      `);
      return;
    }
  }

  // Out of attempts — determine outcome based on accumulated successes
  let endKey;
  if (state.accumulatedSuccesses >= state.threshold) {
    endKey = "SWORD.ArsOratoria.Win";
  } else if (state.accumulatedSuccesses <= -3) {
    endKey = "SWORD.ArsOratoria.Lose";
  } else {
    endKey = "SWORD.ArsOratoria.AttemptsExhausted";
  }

  await _postChatCard(actor, "fa-hourglass-end", game.i18n.localize("SWORD.ArsOratoria.Label"), `
    <div class="damage-line"><strong>${game.i18n.localize(endKey)}</strong></div>
    <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.AccumulatedSuccesses")}: ${state.accumulatedSuccesses} / ${state.threshold}</div>
  `);
}

/**
 * Resolve a single round of the challenge.
 * Returns "recedere" if player chose to recedere, null if dismissed, true otherwise.
 */
async function _resolveRound(actor, state) {
  const orator = state.currentOrator;
  const system = orator.system;
  const ec = system.effectiveCharacteristics ?? system.characteristics;

  // Build skill options (exclude used ones for current orator)
  const availableSkills = ORATORIA_SKILLS.filter(id => !state.usedSkills.has(id));
  // First round must use starting skill
  const isFirstRound = state.attemptsUsed === 0;

  const skillOptions = (isFirstRound ? [state.startingSkill] : availableSkills)
    .map(id => {
      const grade = system.skills[id]?.grade || 0;
      const label = game.i18n.localize(`SWORD.Skills.${id}`);
      return `<option value="${id}">${label} (${game.i18n.localize("SWORD.Grade")}: ${grade})</option>`;
    })
    .join("");

  if (!isFirstRound && availableSkills.length === 0) {
    // All 4 social skills used: the orator's repertoire is exhausted and the
    // challenge ends, judged on the accumulated total (rules call 2026-06-12).
    // Combined maneuvers modify a base skill — they cannot extend the rotation.
    await _postChatCard(actor, "fa-rotate", game.i18n.localize("SWORD.ArsOratoria.MustChangeOrator"), `
      <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.AllSkillsUsed")}</div>
    `);
    return "skillsExhausted";
  }

  // Combined maneuver options
  const combinedOptions = [];
  if (system.skills) {
    for (const [sid, sdata] of Object.entries(system.skills)) {
      if (ORATORIA_SKILLS.includes(sid)) continue;
      if ((sdata.grade || 0) < 1) continue;
      const sLabel = game.i18n.localize(`SWORD.Skills.${sid}`);
      combinedOptions.push({ id: sid, label: sLabel, grade: sdata.grade });
    }
  }

  const hasRetore = system.talentSpecials?.has("no_riflessi_combined_ars_oratoria");
  const hasLinguaSciolta = system.talentSpecials?.has("ars_oratoria_riflessi_drain") && !state.usedLinguaSciolta;
  const hasGiudice = system.talentSpecials?.has("categorical_judgment_ars_oratoria") && !state.usedGiudice;

  const spirito = system.resources.spirito;
  const fatica = system.resources.fatica;
  const riflessi = system.resources.riflessi;
  const canCombined = combinedOptions.length > 0 && (spirito.value >= 1 || fatica.value >= 1);

  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const basePenalty = fatiguePenalty + woundPenalty + encumbrancePenalty;

  // Collect foci for orator
  const allFoci = collectAllFoci(system);
  const focusHtml = buildFocusDialogHtml(allFoci);

  // Build status display
  const statusHtml = `
    <div class="ars-oratoria-status" style="background:#f0f0f0; padding:6px; border-radius:4px; margin-bottom:8px;">
      <div><strong>${game.i18n.localize("SWORD.ArsOratoria.Round")} ${state.round}</strong></div>
      <div>${game.i18n.localize("SWORD.ArsOratoria.AccumulatedSuccesses")}: <strong>${state.accumulatedSuccesses}</strong> / ${state.threshold}</div>
      <div>${game.i18n.localize("SWORD.ArsOratoria.AttemptsRemaining")}: ${state.maxAttempts - state.attemptsUsed} / ${state.maxAttempts}</div>
      ${state.spectatorBonus > 0 ? `<div>${game.i18n.localize("SWORD.ArsOratoria.SpectatorBonusActive")}: +${state.spectatorBonus}</div>` : ""}
      <div>${state.opponentName}: ${game.i18n.localize("SWORD.Resources.riflessi")} ${state.opponentRiflessi}</div>
    </div>`;

  // Combined maneuver HTML
  let combinedHtml = "";
  if (combinedOptions.length > 0) {
    const noneLabel = game.i18n.localize("SWORD.Roll.ValoreNone");
    const combinedOpts = combinedOptions
      .map(s => `<option value="${s.id}">${s.label} (+${s.grade})</option>`)
      .join("");
    const riflessiCostLabel = hasRetore
      ? `${game.i18n.localize("SWORD.ArsOratoria.RetoreNoCost")}`
      : `${game.i18n.localize("SWORD.Combined.CostCombat")}`;
    combinedHtml = `
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Combined.Label")}</label>
        <select name="combinedSkill" ${!canCombined ? "disabled" : ""}
          onchange="this.closest('.sword-roll-dialog').querySelector('[data-combined-cost-group]').style.display = this.value ? '' : 'none'">
          <option value="">${noneLabel}</option>
          ${combinedOpts}
        </select>
        <p class="hint">${riflessiCostLabel}</p>
      </div>
      <div class="form-group" style="display:none" data-combined-cost-group>
        <label>${game.i18n.localize("SWORD.Combined.CostSource")}</label>
        <select name="combinedCostSource">
          <option value="spirito">${game.i18n.localize("SWORD.Resources.spirito")}</option>
          <option value="fatica">${game.i18n.localize("SWORD.Resources.fatica")}</option>
        </select>
      </div>`;
  }

  // Talent buttons HTML
  let talentHtml = "";
  if (hasLinguaSciolta) {
    talentHtml += `
      <div class="form-group">
        <label><input type="checkbox" name="linguaSciolta" /> ${game.i18n.localize("SWORD.ArsOratoria.LinguaSciolta")}</label>
      </div>`;
  }
  if (hasGiudice) {
    talentHtml += `
      <div class="form-group">
        <label><input type="checkbox" name="giudice" /> ${game.i18n.localize("SWORD.ArsOratoria.Giudice")}</label>
      </div>`;
  }

  // Penalty cancellation
  const penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value);

  const dialogContent = `
    <div class="sword-roll-dialog">
      ${statusHtml}
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.ArsOratoria.Skill")}</label>
        <select name="skill">${skillOptions}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2" />
      </div>
      ${focusHtml}
      ${combinedHtml}
      ${talentHtml}
      ${penaltyHtml}
      <hr/>
      <div class="form-group">
        <label><input type="checkbox" name="recedere" /> ${game.i18n.localize("SWORD.ArsOratoria.Recedere")}</label>
        <p class="hint">${game.i18n.localize("SWORD.ArsOratoria.RecedereHint")}</p>
      </div>
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.ArsOratoria.Confronto")} ${state.round} — ${orator.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button) => {
        const form = button.form;
        return {
          skill: form.elements.skill.value,
          diceCount: parseInt(form.elements.diceCount.value) || 2,
          focusDice: countSelectedFoci(form, allFoci.length),
          combinedSkill: form.elements.combinedSkill?.value || "",
          combinedCostSource: form.elements.combinedCostSource?.value || "spirito",
          linguaSciolta: form.elements.linguaSciolta?.checked || false,
          giudice: form.elements.giudice?.checked || false,
          spiritoCancelPenalty: parseInt(form.elements.spiritoCancelPenalty?.value) || 0,
          recedere: form.elements.recedere?.checked || false
        };
      }
    }
  });

  if (!result) return null;

  if (result.recedere) return "recedere";

  // Resolve the confronto
  const skillId = result.skill;
  const charKey = SKILL_MAP[skillId];
  const charScore = ec[charKey];
  const grade = system.skills[skillId]?.grade || 0;
  const extraDice = system.skills[skillId]?.extraDice || 0;
  const isUntrained = grade === 0 && extraDice === 0;
  let diceCount = result.diceCount;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;

  // Combined maneuver
  let combinedGrade = 0;
  let combinedSkillLabel = "";
  if (result.combinedSkill && system.skills[result.combinedSkill]?.grade >= 1 && grade >= 1) {
    combinedGrade = system.skills[result.combinedSkill].grade;
    combinedSkillLabel = game.i18n.localize(`SWORD.Skills.${result.combinedSkill}`);
  }

  // Giudice bonus
  let giudiceBonus = 0;
  if (result.giudice && hasGiudice) {
    giudiceBonus = 1;
    state.usedGiudice = true;
  }

  // Roll
  const totalExtraDice = extraDice + result.focusDice;
  const totalDice = diceCount + totalExtraDice;
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  // --- Use-case call ---
  const turnResult = resolveArsOratoriaTurn({
    skillId, characteristicScore: charScore, diceCount, grade,
    extraDice, focusDice: result.focusDice, combinedGrade,
    combinedCostSource: result.combinedCostSource || "spirito",
    hasRetore, hasRiflessiCostMinus1: system.talentSpecials?.has("riflessi_cost_minus1"),
    giudiceBonus,
    spiritoCancelPenalty: Math.min(Math.max(result.spiritoCancelPenalty, 0), basePenalty, spirito.value),
    spectatorBonus: state.spectatorBonus
  }, {
    // A silenced opponent cannot respond this round (Senza Parole)
    opponentFixedSuccesses: state.opponentSilencedThisRound ? 0 : state.opponentFixedSuccesses,
    accumulatedSuccesses: state.accumulatedSuccesses,
    attemptsUsed: state.attemptsUsed,
    opponentRiflessi: state.opponentRiflessi,
    threshold: state.threshold
  }, {
    fatiguePenalty, woundPenalty, encumbrancePenalty, spirito: spirito.value,
    fatica: fatica.value, riflessi: riflessi.value
  }, diceRolled);

  // Unpack and update loop state
  const { engineOutput, playerSuccesses, netSuccesses, playerWins, riskRewardApplied,
    newOpponentRiflessi, senzaParole } = turnResult;
  const opponentSuccesses = state.opponentFixedSuccesses;
  state.accumulatedSuccesses = turnResult.accumulatedSuccesses;
  state.attemptsUsed = turnResult.attemptsUsed;
  if (!state.opponentSilencedThisRound) state.opponentRiflessi = newOpponentRiflessi;
  state.usedSkills.add(skillId);

  // Schedule Senza Parole skips: current + next round (spec §10.4)
  if (senzaParole.player) state.playerSkipRounds = 2;
  if (senzaParole.opponent && state.opponentSkipRounds === 0) state.opponentSkipRounds = 2;

  // Apply resource patches
  const updateData = {};
  for (const [key, value] of Object.entries(turnResult.patches)) {
    if (key.startsWith("resources.")) {
      updateData[`system.${key}.value`] = value;
    } else {
      updateData[`system.${key}`] = value;
    }
  }
  if (Object.keys(updateData).length > 0) {
    await orator.update(updateData);
  }

  // Senza Parole text
  let senzaParoleText = "";
  if (senzaParole.opponent) senzaParoleText = game.i18n.localize("SWORD.ArsOratoria.OpponentSenzaParole");
  if (senzaParole.player) senzaParoleText = game.i18n.localize("SWORD.ArsOratoria.PlayerSenzaParole");

  // Risk-reward text
  const isRiskReward = RISK_REWARD_SKILLS.has(skillId);
  let riskRewardText = "";
  if (riskRewardApplied) {
    riskRewardText = playerWins
      ? game.i18n.localize("SWORD.ArsOratoria.RiskRewardWin")
      : game.i18n.localize("SWORD.ArsOratoria.RiskRewardLose");
  }

  // Post chat card
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);
  await _postChatCard(orator, "fa-comment", `${game.i18n.localize("SWORD.ArsOratoria.Confronto")} ${state.round}`, `
    <div class="damage-line">${skillLabel} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
    <div class="damage-line">${game.i18n.localize("SWORD.Chat.Successes")}: ${playerSuccesses} vs ${opponentSuccesses}</div>
    ${combinedGrade > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Chat.CombinedUsed")}: ${combinedSkillLabel} (+${combinedGrade})</div>` : ""}
    ${giudiceBonus > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.Giudice")}: +1</div>` : ""}
    ${isRiskReward ? `<div class="damage-line">${riskRewardText}</div>` : ""}
    <div class="damage-line">${playerWins ? "✓" : "✗"} ${game.i18n.localize("SWORD.ArsOratoria.NetSuccesses")}: <strong>${netSuccesses > 0 ? "+" : ""}${netSuccesses}</strong></div>
    <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.AccumulatedSuccesses")}: ${state.accumulatedSuccesses} / ${state.threshold}</div>
    <div class="damage-line">${game.i18n.localize("SWORD.ArsOratoria.AttemptsRemaining")}: ${state.maxAttempts - state.attemptsUsed}</div>
    ${senzaParoleText ? `<div class="damage-line"><strong>${senzaParoleText}</strong></div>` : ""}
  `, [roll]);

  // Lingua Sciolta: separate Carisma check → drain opponent Riflessi
  if (result.linguaSciolta && hasLinguaSciolta) {
    state.usedLinguaSciolta = true;
    await _resolveLinguaSciolta(orator, state);
  }

  return true;
}

/**
 * Lingua Sciolta talent: once per sfida, Carisma check to drain opponent Riflessi.
 */
async function _resolveLinguaSciolta(actor, state) {
  const system = actor.system;
  const ec = system.effectiveCharacteristics ?? system.characteristics;
  const charKey = SKILL_MAP.carisma;
  const charScore = ec[charKey];
  const grade = system.skills.carisma?.grade || 0;
  const extraDice = system.skills.carisma?.extraDice || 0;
  const isUntrained = grade === 0 && extraDice === 0;

  const dialogContent = `
    <div class="sword-roll-dialog">
      <h3>${game.i18n.localize("SWORD.ArsOratoria.LinguaSciolta")}</h3>
      <p>${game.i18n.localize("SWORD.ArsOratoria.LinguaScioltaDesc")}</p>
      <p><strong>${game.i18n.localize("SWORD.Skills.carisma")}</strong> (${charScore})</p>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
      </div>
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.ArsOratoria.LinguaSciolta")} — ${actor.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button) => {
        const form = button.form;
        return { diceCount: parseInt(form.elements.diceCount.value) || 2 };
      }
    }
  });

  if (!result) return;

  let diceCount = result.diceCount;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;

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
    successPenalty: 0,
    difficultyThreshold: null,
    opposedSuccesses: null,
    diceRolled,
    discardIndices: null
  });

  const successes = engineOutput.basePassed ? engineOutput.finalSuccesses : 0;
  if (successes > 0) {
    state.opponentRiflessi -= successes;
  }

  await _postChatCard(actor, "fa-bolt", game.i18n.localize("SWORD.ArsOratoria.LinguaSciolta"), `
    <div class="damage-line">${game.i18n.localize("SWORD.Skills.carisma")} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
    <div class="damage-line">${game.i18n.localize("SWORD.Chat.Successes")}: ${successes}</div>
    ${successes > 0 ? `<div class="damage-line"><strong>${state.opponentName} -${successes} ${game.i18n.localize("SWORD.Resources.riflessi")}</strong></div>` : ""}
  `, [roll]);
}

/**
 * Prompt to change the threshold via Recedere.
 */
async function _promptRecedere(state) {
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("SWORD.ArsOratoria.Recedere") },
    content: `
      <div class="sword-roll-dialog">
        <p>${game.i18n.localize("SWORD.ArsOratoria.RecedereDesc")}</p>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.ArsOratoria.NewThreshold")}</label>
          <input type="number" name="newThreshold" value="${state.threshold}" min="1" />
        </div>
      </div>`,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      callback: (event, button) => parseInt(button.form.elements.newThreshold.value) || state.threshold
    }
  });
  return result ?? null;
}

/**
 * Check if actor has combined maneuver options available.
 */
function _hasCombinedOptions(system, state) {
  for (const [sid, sdata] of Object.entries(system.skills)) {
    if (ORATORIA_SKILLS.includes(sid)) continue;
    if ((sdata.grade || 0) >= 1) return true;
  }
  return false;
}

/**
 * Post a styled chat card.
 */
async function _postChatCard(actor, icon, title, bodyHtml, rolls = []) {
  const content = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${actor.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas ${icon}"></i> ${title}</h3>
        </div>
      </header>
      <div class="result-section">
        ${bodyHtml}
      </div>
    </div>`;

  const msgData = {
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content
  };
  if (rolls.length > 0) {
    msgData.rolls = rolls;
    msgData.sound = CONFIG.sounds.dice;
  }
  await ChatMessage.create(msgData);
}
