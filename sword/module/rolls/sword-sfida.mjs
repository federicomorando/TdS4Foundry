/**
 * Sfide (Extended Tests) — Multi-round structured challenges
 *
 * PDF §4.8 (pp.92-93), spec §9:
 *  - Participants accumulate successes toward a threshold (soglia)
 *  - Each turn: skill check → accumulate successes → resource cost
 *  - Covers: competitions, pursuits, crafting, research, audience-seeking
 *  - Confronto (opposed): net successes = player - opponent fixed successes
 *  - Movement sfide: approach modifiers, obstacle reactions, minimum 1 success
 *  - Chiedere Udienza: restricted skills, per-check penalty by rank
 *
 * Follows the Ars Oratoria dialog-loop pattern:
 *   setup dialog → state object → round loop → per-turn dialogs → chat cards
 */
import { swordCheckResolve } from "../engine.mjs";
import { SKILL_MAP, SOCIAL_SKILLS } from "../data/actor.mjs";
import { armorSkillPenalty } from "../engine.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import {
  buildPenaltyParts, buildPenaltyHtml, buildValoreSelectHtml, buildFamaHtml,
  buildCombinedSkillOptions, buildCombinedManeuverHtml, formInt, formStr, formBool
} from "./dialog-helpers.mjs";
import {
  SFIDA_PRESETS, UDIENZA_RANKS, UDIENZA_SKILLS,
  computeApproachModifiers, computeObstacleUncountered, checkLoopTermination
} from "../engine.mjs";
import { VALORE_KEYS } from "../engine.mjs";
import { resolveSfidaTurn } from "../engine.mjs";

/**
 * Open the Sfida setup dialog.
 * @param {Actor} actor
 */
export async function swordSfida(actor) {
  const setup = await _setupDialog(actor);
  if (!setup) return;

  const state = {
    // From setup
    soglia: setup.soglia,
    costo: setup.costo,
    tentativi: setup.tentativi,
    durata: setup.durata,
    confronto: setup.confronto,
    opponentName: setup.opponentName,
    opponentFixedSuccesses: setup.opponentFixedSuccesses,
    riflessiDrain: setup.riflessiDrain,
    hasObstacle: setup.hasObstacle,
    situationPenalty: setup.situationPenalty,
    isMovement: setup.isMovement,
    minOneSuccess: setup.minOneSuccess,
    allowedSkills: setup.allowedSkills,
    udienzaPenalty: setup.udienzaPenalty,

    // Running
    accumulatedSuccesses: 0,
    turnsUsed: 0,
    round: 0,
  };

  await _runSfida(actor, state);
}

// --------------- Setup Dialog ---------------

async function _setupDialog(actor) {
  // Build preset options
  const presetOptions = [
    { key: "custom", label: "SWORD.Sfida.PresetCustom" },
    { key: "scatto", label: "SWORD.Sfida.PresetScatto" },
    { key: "inseguimento_breve", label: "SWORD.Sfida.PresetInseguimentoBreve" },
    { key: "inseguimento_media", label: "SWORD.Sfida.PresetInseguimentoMedia" },
    { key: "inseguimento_lunga", label: "SWORD.Sfida.PresetInseguimentoLunga" },
    { key: "udienza", label: "SWORD.Sfida.PresetUdienza" },
  ].map(p => `<option value="${p.key}">${game.i18n.localize(p.label)}</option>`).join("");

  // Build udienza rank options
  const udienzaRankOptions = UDIENZA_RANKS
    .map((r, i) => `<option value="${i}">${game.i18n.localize(r.label)} (${game.i18n.localize("SWORD.Sfida.Soglia")} ${r.soglia}, -${r.penalty})</option>`)
    .join("");

  // Preset data for JS injection

  const dialogContent = `
    <div class="sword-roll-dialog">
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Sfida.Preset")}</label>
        <select name="preset">${presetOptions}</select>
      </div>

      <div class="form-group" data-udienza-rank style="display:none">
        <label>${game.i18n.localize("SWORD.Sfida.UdienzaRank")}</label>
        <select name="udienzaRank">${udienzaRankOptions}</select>
      </div>

      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Sfida.Soglia")}</label>
        <input type="number" name="soglia" value="5" min="1" />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Sfida.Costo")}</label>
        <select name="costo">
          <option value="fatica">${game.i18n.localize("SWORD.Sfida.CostoFatica")}</option>
          <option value="spirito">${game.i18n.localize("SWORD.Sfida.CostoSpirito")}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Sfida.Tentativi")}</label>
        <input type="number" name="tentativi" value="0" min="0" />
        <p class="hint">${game.i18n.localize("SWORD.Sfida.TentativiHint")}</p>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Sfida.Durata")}</label>
        <input type="text" name="durata" value="" />
      </div>

      <hr/>
      <div class="form-group">
        <label><input type="checkbox" name="confronto" /> ${game.i18n.localize("SWORD.Sfida.Confronto")}</label>
      </div>
      <div data-confronto-fields style="display:none">
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Sfida.OpponentName")}</label>
          <input type="text" name="opponentName" value="" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Sfida.OpponentSuccesses")}</label>
          <input type="number" name="opponentSuccesses" value="2" min="0" />
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="riflessiDrain" /> ${game.i18n.localize("SWORD.Sfida.RiflessiDrain")}</label>
          <p class="hint">${game.i18n.localize("SWORD.Sfida.RiflessiDrainHint")}</p>
        </div>
      </div>

      <div class="form-group">
        <label><input type="checkbox" name="hasObstacle" /> ${game.i18n.localize("SWORD.Sfida.HasObstacle")}</label>
      </div>
      <div data-obstacle-fields style="display:none">
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Sfida.SituationPenalty")}</label>
          <input type="number" name="situationPenalty" value="1" min="0" />
        </div>
      </div>

      <div class="form-group">
        <label><input type="checkbox" name="isMovement" /> ${game.i18n.localize("SWORD.Sfida.IsMovement")}</label>
      </div>

    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("SWORD.Sfida.Setup") },
    content: dialogContent,
    // Wire the preset autofill and conditional sections here: DialogV2 injects
    // content via innerHTML, so inline <script> tags never execute.
    render: (event, dialog) => {
      const dlg = dialog.element.querySelector(".sword-roll-dialog");
      if (!dlg) return;
      const presetEl = dlg.querySelector('[name="preset"]');
      const sogliaEl = dlg.querySelector('[name="soglia"]');
      const costoEl = dlg.querySelector('[name="costo"]');
      const tentativiEl = dlg.querySelector('[name="tentativi"]');
      const durataEl = dlg.querySelector('[name="durata"]');
      const confrontoEl = dlg.querySelector('[name="confronto"]');
      const confrontoFields = dlg.querySelector("[data-confronto-fields]");
      const opponentSuccEl = dlg.querySelector('[name="opponentSuccesses"]');
      const riflessiDrainEl = dlg.querySelector('[name="riflessiDrain"]');
      const hasObstacleEl = dlg.querySelector('[name="hasObstacle"]');
      const obstacleFields = dlg.querySelector("[data-obstacle-fields]");
      const isMovementEl = dlg.querySelector('[name="isMovement"]');
      const udienzaRankGroup = dlg.querySelector("[data-udienza-rank]");
      const udienzaRankEl = dlg.querySelector('[name="udienzaRank"]');

      confrontoEl.addEventListener("change", () => {
        confrontoFields.style.display = confrontoEl.checked ? "" : "none";
      });
      hasObstacleEl.addEventListener("change", () => {
        obstacleFields.style.display = hasObstacleEl.checked ? "" : "none";
      });

      presetEl.addEventListener("change", () => {
        const p = SFIDA_PRESETS[presetEl.value];
        if (!p) return;
        sogliaEl.value = p.soglia;
        costoEl.value = p.costo || "fatica";
        tentativiEl.value = p.tentativi || 0;
        durataEl.value = p.durata || "";
        confrontoEl.checked = !!p.confronto;
        confrontoFields.style.display = p.confronto ? "" : "none";
        if (p.confronto && p.opponentSuccesses != null) opponentSuccEl.value = p.opponentSuccesses;
        riflessiDrainEl.checked = !!p.riflessiDrain;
        hasObstacleEl.checked = !!p.hasObstacle;
        obstacleFields.style.display = p.hasObstacle ? "" : "none";
        isMovementEl.checked = !!p.isMovement;
        udienzaRankGroup.style.display = presetEl.value === "udienza" ? "" : "none";
        if (presetEl.value === "udienza") {
          const rank = UDIENZA_RANKS[parseInt(udienzaRankEl.value) || 0];
          if (rank) sogliaEl.value = rank.soglia;
        }
      });

      udienzaRankEl.addEventListener("change", () => {
        const rank = UDIENZA_RANKS[parseInt(udienzaRankEl.value) || 0];
        if (rank) sogliaEl.value = rank.soglia;
      });
    },
    ok: {
      label: game.i18n.localize("SWORD.Sfida.StartChallenge"),
      icon: "fa-solid fa-flag-checkered",
      callback: (event, button) => {
        const form = button.form;
        const presetKey = formStr(form, "preset");
        const preset = SFIDA_PRESETS[presetKey] || SFIDA_PRESETS.custom;
        const isUdienza = presetKey === "udienza";
        const udienzaRankIdx = formInt(form, "udienzaRank");
        const udienzaRank = isUdienza ? UDIENZA_RANKS[udienzaRankIdx] : null;

        return {
          soglia: formInt(form, "soglia", 5),
          costo: formStr(form, "costo", "fatica"),
          tentativi: formInt(form, "tentativi"),
          durata: formStr(form, "durata"),
          confronto: formBool(form, "confronto"),
          opponentName: formStr(form, "opponentName"),
          opponentFixedSuccesses: formInt(form, "opponentSuccesses"),
          riflessiDrain: formBool(form, "riflessiDrain"),
          hasObstacle: formBool(form, "hasObstacle"),
          situationPenalty: formInt(form, "situationPenalty", 1),
          isMovement: formBool(form, "isMovement"),
          // Min-1 applies to plain movement sfide (e.g. scatto), NOT to
          // confronti: the inseguimento presets rely on Riflessi drain, which
          // never fires if every turn is guaranteed ≥1 success.
          minOneSuccess: !!preset.minOneSuccess
            || (formBool(form, "isMovement") && !formBool(form, "confronto")),
          allowedSkills: preset.skills || [],
          udienzaPenalty: udienzaRank ? udienzaRank.penalty : 0,
        };
      }
    }
  });

  return result || null;
}

// --------------- Main Round Loop ---------------

async function _runSfida(actor, state) {
  // Post setup summary
  const setupLines = [];
  setupLines.push(`<div class="damage-line"><strong>${game.i18n.localize("SWORD.Sfida.Soglia")}:</strong> ${state.soglia}</div>`);
  setupLines.push(`<div class="damage-line"><strong>${game.i18n.localize("SWORD.Sfida.Costo")}:</strong> ${state.costo === "fatica" ? game.i18n.localize("SWORD.Sfida.CostoFatica") : game.i18n.localize("SWORD.Sfida.CostoSpirito")}</div>`);
  if (state.tentativi > 0) setupLines.push(`<div class="damage-line"><strong>${game.i18n.localize("SWORD.Sfida.Tentativi")}:</strong> ${state.tentativi}</div>`);
  if (state.durata) setupLines.push(`<div class="damage-line"><strong>${game.i18n.localize("SWORD.Sfida.Durata")}:</strong> ${state.durata}</div>`);
  if (state.confronto) setupLines.push(`<div class="damage-line"><strong>${game.i18n.localize("SWORD.Sfida.Confronto")}:</strong> ${state.opponentName} (${state.opponentFixedSuccesses} ${game.i18n.localize("SWORD.Chat.Successes").toLowerCase()})</div>`);
  if (state.hasObstacle) setupLines.push(`<div class="damage-line"><strong>${game.i18n.localize("SWORD.Sfida.HasObstacle")}:</strong> ${state.situationPenalty}</div>`);
  if (state.isMovement) setupLines.push(`<div class="damage-line"><i class="fas fa-person-running"></i> ${game.i18n.localize("SWORD.Sfida.IsMovement")}</div>`);

  await _postChatCard(actor, "fa-flag-checkered", game.i18n.localize("SWORD.Sfida.Label"), setupLines.join(""));

  while (true) {
    state.round++;

    // Check max attempts
    if (state.tentativi > 0 && state.turnsUsed >= state.tentativi) {
      await _postChatCard(actor, "fa-circle-xmark", game.i18n.localize("SWORD.Sfida.Failure"), `
        <div class="damage-line">${game.i18n.localize("SWORD.Sfida.AccumulatedSuccesses")}: ${state.accumulatedSuccesses} / ${state.soglia}</div>
        <div class="damage-line">${game.i18n.localize("SWORD.Sfida.Turn")}: ${state.turnsUsed}</div>
      `);
      return;
    }

    // Check resource exhaustion
    const system = actor.system;
    const resourceValue = state.costo === "fatica" ? system.resources.fatica.value : system.resources.spirito.value;
    if (resourceValue <= 0) {
      await _postChatCard(actor, "fa-battery-empty", game.i18n.localize("SWORD.Sfida.ResourceExhausted"), `
        <div class="damage-line">${state.costo === "fatica" ? game.i18n.localize("SWORD.Resources.fatica") : game.i18n.localize("SWORD.Resources.spirito")}</div>
        <div class="damage-line">${game.i18n.localize("SWORD.Sfida.AccumulatedSuccesses")}: ${state.accumulatedSuccesses} / ${state.soglia}</div>
      `);
      return;
    }

    const turnResult = await _resolveTurn(actor, state);

    if (turnResult === null || turnResult === "abandon") {
      await _postChatCard(actor, "fa-flag", game.i18n.localize("SWORD.Sfida.Abandoned"), `
        <div class="damage-line">${game.i18n.localize("SWORD.Sfida.AccumulatedSuccesses")}: ${state.accumulatedSuccesses} / ${state.soglia}</div>
        <div class="damage-line">${game.i18n.localize("SWORD.Sfida.Turn")}: ${state.turnsUsed}</div>
      `);
      return;
    }

    // Check win condition
    if (state.accumulatedSuccesses >= state.soglia) {
      await _postChatCard(actor, "fa-trophy", game.i18n.localize("SWORD.Sfida.Win"), `
        <div class="damage-line"><strong>${game.i18n.localize("SWORD.Sfida.AccumulatedSuccesses")}: ${state.accumulatedSuccesses} / ${state.soglia}</strong></div>
        <div class="damage-line">${game.i18n.localize("SWORD.Sfida.Turn")}: ${state.turnsUsed}</div>
      `);
      return;
    }
  }
}

// --------------- Per-Turn Dialog ---------------

async function _resolveTurn(actor, state) {
  const system = actor.system;
  const ec = system.effectiveCharacteristics ?? system.characteristics;

  // Build skill options
  const skillEntries = Object.entries(system.skills);
  const filteredSkills = state.allowedSkills.length > 0
    ? skillEntries.filter(([id]) => state.allowedSkills.includes(id))
    : skillEntries;

  const skillOptions = filteredSkills
    .map(([id, data]) => {
      const grade = data.grade || 0;
      const label = game.i18n.localize(`SWORD.Skills.${id}`);
      return `<option value="${id}">${label} (${game.i18n.localize("SWORD.Grade")}: ${grade})</option>`;
    })
    .join("");

  // Status banner
  const statusParts = [];
  statusParts.push(`<div><strong>${game.i18n.localize("SWORD.Sfida.Turn")} ${state.round}</strong></div>`);
  statusParts.push(`<div>${game.i18n.localize("SWORD.Sfida.AccumulatedSuccesses")}: <strong>${state.accumulatedSuccesses}</strong> / ${state.soglia}</div>`);
  if (state.tentativi > 0) {
    statusParts.push(`<div>${game.i18n.localize("SWORD.Sfida.TurnsRemaining")}: ${state.tentativi - state.turnsUsed}</div>`);
  }
  if (state.confronto) {
    statusParts.push(`<div>${state.opponentName}: ${state.opponentFixedSuccesses} ${game.i18n.localize("SWORD.Chat.Successes").toLowerCase()}</div>`);
  }
  const costoLabel = state.costo === "fatica"
    ? game.i18n.localize("SWORD.Resources.fatica")
    : game.i18n.localize("SWORD.Resources.spirito");
  statusParts.push(`<div>${game.i18n.localize("SWORD.Sfida.Costo")}: 1 ${costoLabel}</div>`);

  const statusHtml = `
    <div style="background:#f0f0f0; padding:6px; border-radius:4px; margin-bottom:8px;">
      ${statusParts.join("")}
    </div>`;

  // Approach dropdown (movement only)
  let approachHtml = "";
  if (state.isMovement) {
    approachHtml = `
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Sfida.Approach")}</label>
        <select name="approach">
          <option value="corsa">${game.i18n.localize("SWORD.Sfida.ApproachCorsa")} (—)</option>
          <option value="prudente">${game.i18n.localize("SWORD.Sfida.ApproachPrudente")} (-1 ${game.i18n.localize("SWORD.Chat.Successes").toLowerCase()}, +1 ${game.i18n.localize("SWORD.Sfida.Obstacle").toLowerCase()})</option>
          <option value="carica">${game.i18n.localize("SWORD.Sfida.ApproachCarica")} (+1 ${game.i18n.localize("SWORD.Chat.Successes").toLowerCase()}, -1 ${game.i18n.localize("SWORD.Sfida.Obstacle").toLowerCase()})</option>
        </select>
      </div>`;
  }

  // Difficulty input
  const difficultyHtml = `
    <div class="form-group">
      <label>${game.i18n.localize("SWORD.Roll.Difficulty")}</label>
      <input type="number" name="difficulty" value="" min="1" placeholder="\u2014" />
    </div>`;

  // Penalties
  const spirito = system.resources.spirito;
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const armorItem = Array.from(actor.items).find(i => i.type === "armor");
  // Armor penalty will be computed per-skill after selection; show base penalty here
  const basePenaltyNoArmor = fatiguePenalty + woundPenalty + encumbrancePenalty;
  const totalPenaltyDisplay = basePenaltyNoArmor + state.udienzaPenalty;

  const penaltyParts = buildPenaltyParts({ fatiguePenalty, woundPenalty, encumbrancePenalty, fatigueLevel: system.fatigueLevel || "fresco" });
  if (state.udienzaPenalty > 0) {
    penaltyParts.push(`${game.i18n.localize("SWORD.Sfida.UdienzaRank")}: -${state.udienzaPenalty}`);
  }
  const penaltyHtml = buildPenaltyHtml(totalPenaltyDisplay, spirito.value, penaltyParts);

  // Focus
  const allFoci = collectAllFoci(system);
  const focusHtml = buildFocusDialogHtml(allFoci);

  // Fama (social skills)
  const fama = system.fama;
  const hasMondano = !!system.talentSpecials?.has("add_fides_honor_to_fama");
  // We'll show Fama for all skills in sfida (GM may allow it); restrict UI hint
  const famaHtml = buildFamaHtml(fama, { hasMondano, valori: system.valori });

  // Valore
  const canUseValore = VALORE_KEYS.some(k => system.valori[k] > 0) && spirito.value >= 3;
  const valoreHtml = buildValoreSelectHtml(system);

  // Combined Maneuver — pass grade 1 as placeholder since skill isn't selected yet;
  // buildCombinedSkillOptions filters by grade >= 1 only when currentGrade >= 1.
  const { options: combinedSkillOpts, canUse: canUseCombined } = buildCombinedSkillOptions(system, "", 1);
  const combinedHtml = buildCombinedManeuverHtml(combinedSkillOpts, canUseCombined, {
    inInitiative: !!(state.confronto && state.riflessiDrain)
  });

  // Abandon checkbox
  const abandonHtml = `
    <hr/>
    <div class="form-group">
      <label><input type="checkbox" name="abandon" /> ${game.i18n.localize("SWORD.Sfida.Abandon")}</label>
      <p class="hint">${game.i18n.localize("SWORD.Sfida.AbandonHint")}</p>
    </div>`;

  const dialogContent = `
    <div class="sword-roll-dialog">
      ${statusHtml}
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Sfida.Skill")}</label>
        <select name="skill">${skillOptions}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2" />
      </div>
      ${approachHtml}
      ${difficultyHtml}
      ${focusHtml}
      ${famaHtml}
      ${penaltyHtml}
      ${combinedHtml}
      ${valoreHtml}
      ${abandonHtml}
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.Sfida.Label")} — ${game.i18n.localize("SWORD.Sfida.Turn")} ${state.round}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button) => {
        const form = button.form;
        return {
          skill: formStr(form, "skill"),
          diceCount: formInt(form, "diceCount", 2),
          approach: formStr(form, "approach", "corsa"),
          difficulty: formInt(form, "difficulty") || null,
          focusDice: countSelectedFoci(form, allFoci.length),
          famaSpend: formInt(form, "famaSpend"),
          mondanoValore: formStr(form, "mondanoValore"),
          spiritoCancelPenalty: formInt(form, "spiritoCancelPenalty"),
          valore: formStr(form, "valore"),
          combinedSkill: formStr(form, "combinedSkill"),
          combinedCostSource: formStr(form, "combinedCostSource", "spirito"),
          abandon: formBool(form, "abandon"),
        };
      }
    }
  });

  if (!result) return null; // Dialog dismissed
  if (result.abandon) return "abandon";

  // --- Process the turn ---
  const skillId = result.skill;
  const charKey = SKILL_MAP[skillId];
  const isVariesSkill = charKey === "varies";
  const effectiveCharKey = isVariesSkill ? (system.skills[skillId]?.specialtyChar || "mens") : charKey;
  const charScore = ec[effectiveCharKey] ?? system.characteristics[effectiveCharKey];
  const skillData = system.skills[skillId];
  const grade = skillData?.grade || 0;
  const extraDice = skillData?.extraDice || 0;
  const isUntrained = grade === 0 && extraDice === 0;

  let diceCount = result.diceCount;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;

  // Armor penalty for this skill
  const armorPenalty = armorItem
    ? armorSkillPenalty(armorItem.system.protezione || 0, armorItem.system.pregi || [], skillId)
    : 0;

  // Combined maneuver
  let combinedGrade = 0;
  let combinedSkillLabel = "";
  if (result.combinedSkill && system.skills[result.combinedSkill]?.grade >= 1 && grade >= 1) {
    combinedGrade = system.skills[result.combinedSkill].grade;
    combinedSkillLabel = game.i18n.localize(`SWORD.Skills.${result.combinedSkill}`);
  }

  // Fama
  let famaSpend = Math.min(Math.max(result.famaSpend, 0), fama);
  const isSocial = SOCIAL_SKILLS.has(skillId);
  if (!isSocial) famaSpend = 0;

  // Mondano bonus
  let mondanoBonus = 0;
  if (famaSpend > 0 && result.mondanoValore && hasMondano) {
    mondanoBonus = system.valori[result.mondanoValore] || 0;
  }

  // Valore
  let valoreSelected = null;
  let valoreScore = 0;
  if (result.valore && canUseValore) {
    valoreScore = system.valori[result.valore] || 0;
    if (valoreScore > 0) valoreSelected = result.valore;
  }

  // Compute dice and roll
  const focusDice = result.focusDice;
  const totalExtraDice = extraDice + famaSpend + mondanoBonus + focusDice;
  const totalDice = diceCount + totalExtraDice;
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  // --- Use-case call ---
  const turnResult = resolveSfidaTurn({
    characteristicScore: charScore, diceCount, grade, extraDice,
    focusDice, famaSpend, mondanoBonus, combinedGrade,
    combinedCostSource: result.combinedCostSource || "spirito",
    valoreSelected, valoreScore,
    hasActivationPlus1: system.talentSpecials?.has("valori_activation_plus1"),
    spiritoCancelPenalty: Math.min(Math.max(result.spiritoCancelPenalty, 0), spirito.value),
    hasRiflessiCostMinus1: system.talentSpecials?.has("riflessi_cost_minus1"),
    approach: result.approach, difficultyThreshold: result.difficulty
  }, {
    confronto: state.confronto, opponentFixedSuccesses: state.opponentFixedSuccesses,
    isMovement: state.isMovement, minOneSuccess: state.minOneSuccess,
    riflessiDrain: state.riflessiDrain, costo: state.costo,
    accumulatedSuccesses: state.accumulatedSuccesses, turnsUsed: state.turnsUsed,
    udienzaPenalty: state.udienzaPenalty
  }, {
    fatiguePenalty, woundPenalty, encumbrancePenalty, armorPenalty,
    spirito: spirito.value, fama, fatica: system.resources.fatica.value,
    riflessi: system.resources.riflessi.value
  }, diceRolled);

  // Unpack results
  const { engineOutput, turnSuccesses, shortfallFatica, riflessiDrainAmount,
    valoreUsed, valoreBonus, approachDefMod, sfidaDeductions } = turnResult;
  const valoreName = valoreUsed ? game.i18n.localize(`SWORD.Valori.${valoreSelected}`) : "";

  // Update loop state
  state.accumulatedSuccesses = turnResult.accumulatedSuccesses;
  state.turnsUsed = turnResult.turnsUsed;

  // Apply resource deductions
  if (Object.keys(sfidaDeductions).length > 0) {
    await actor.update(sfidaDeductions);
  }

  // --- Post turn chat card ---
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);
  const charLabel = game.i18n.localize(`SWORD.Characteristics.${effectiveCharKey}`);
  const chatLines = [];
  chatLines.push(`<div class="damage-line">${skillLabel} (${charLabel} ${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>`);
  chatLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Chat.Successes")}: ${engineOutput.finalSuccesses}${state.confronto ? ` vs ${state.opponentFixedSuccesses}` : ""}</div>`);
  if (state.confronto) {
    chatLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Sfida.NetSuccesses")}: ${turnSuccesses > 0 ? "+" : ""}${turnSuccesses}</div>`);
  }
  if (state.isMovement && result.approach !== "corsa") {
    const approachLabel = game.i18n.localize(`SWORD.Sfida.Approach${result.approach.charAt(0).toUpperCase() + result.approach.slice(1)}`);
    chatLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Sfida.Approach")}: ${approachLabel}</div>`);
  }
  if (valoreUsed) {
    chatLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Chat.ValoreUsed")}: ${valoreName} (+${valoreBonus})</div>`);
  }
  if (combinedGrade > 0) {
    chatLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Chat.CombinedUsed")}: ${combinedSkillLabel} (+${combinedGrade})</div>`);
  }
  if (famaSpend > 0) {
    chatLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Chat.FamaUsed")}: ${famaSpend} ${game.i18n.localize("SWORD.Chat.FamaDice")}</div>`);
  }
  if (shortfallFatica > 0) {
    chatLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Sfida.MovementShortfall")}: -${shortfallFatica} ${game.i18n.localize("SWORD.Resources.fatica")}</div>`);
  }
  if (riflessiDrainAmount > 0) {
    chatLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Sfida.RiflessiDrain")}: -${riflessiDrainAmount}</div>`);
  }
  chatLines.push(`<div class="damage-line"><strong>${game.i18n.localize("SWORD.Sfida.AccumulatedSuccesses")}: ${state.accumulatedSuccesses} / ${state.soglia}</strong></div>`);

  await _postChatCard(actor, "fa-bullseye", `${game.i18n.localize("SWORD.Sfida.Turn")} ${state.round}`, chatLines.join(""), [roll]);

  // --- Obstacle reaction (if enabled) ---
  if (state.hasObstacle && state.situationPenalty > 0) {
    await _resolveObstacle(actor, state, approachDefMod);
  }

  return true;
}

// --------------- Obstacle Reaction ---------------

async function _resolveObstacle(actor, state, approachDefMod) {
  const system = actor.system;
  const ec = system.effectiveCharacteristics ?? system.characteristics;
  const obstacleThreat = state.situationPenalty;

  // Agilità skill data
  const agilitaData = system.skills.agilita;
  const agilitaGrade = agilitaData?.grade || 0;
  const agilitaExtraDice = agilitaData?.extraDice || 0;
  const charScore = ec.celeritas ?? system.characteristics.celeritas;

  // Check if trained or has foci
  const allFoci = collectAllFoci(system);
  const agilitaFoci = allFoci.filter(f => f.skillId === "agilita");
  const hasTrained = agilitaGrade > 0 || agilitaExtraDice > 0 || agilitaFoci.length > 0;

  let diceCount = 2;
  let focusDice = 0;
  let roll;

  if (hasTrained) {
    // Mini-dialog for obstacle
    const focusCheckboxes = agilitaFoci.map((f, i) =>
      `<div class="form-group"><label><input type="checkbox" name="obsFocus-${i}" /> ${f.label}</label></div>`
    ).join("");

    const obsContent = `
      <div class="sword-roll-dialog">
        <p><strong>${game.i18n.localize("SWORD.Sfida.ObstacleReaction")}</strong> — ${game.i18n.localize("SWORD.Skills.agilita")} vs ${obstacleThreat}</p>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Sfida.ObstacleDiceCount")}</label>
          <input type="number" name="obsDiceCount" value="2" min="2" />
        </div>
        ${focusCheckboxes}
      </div>`;

    const obsResult = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SWORD.Sfida.ObstacleReaction") },
      content: obsContent,
      ok: {
        label: game.i18n.localize("SWORD.Roll.Submit"),
        icon: "fa-solid fa-dice",
        callback: (event, button) => {
          const form = button.form;
          let fd = 0;
          for (let i = 0; i < agilitaFoci.length; i++) {
            if (form.elements[`obsFocus-${i}`]?.checked) fd++;
          }
          return {
            diceCount: formInt(form, "obsDiceCount", 2),
            focusDice: fd
          };
        }
      }
    });

    if (obsResult) {
      diceCount = Math.max(2, obsResult.diceCount);
      focusDice = obsResult.focusDice;
    }
  }

  // Penalties
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const effectivePenalty = fatiguePenalty + woundPenalty + encumbrancePenalty;

  // Approach defense modifier
  const obsSuccessBonus = Math.max(0, approachDefMod);
  const obsSuccessPenalty = effectivePenalty + Math.max(0, -approachDefMod);

  const totalDice = diceCount + agilitaExtraDice + focusDice;
  roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  const engineOutput = swordCheckResolve({
    characteristicScore: charScore,
    diceCount,
    grade: agilitaGrade,
    extraDice: agilitaExtraDice + focusDice,
    successBonus: obsSuccessBonus,
    successPenalty: obsSuccessPenalty,
    difficultyThreshold: null,
    opposedSuccesses: obstacleThreat,
    diceRolled,
    discardIndices: null
  });

  const uncountered = computeObstacleUncountered(obstacleThreat, engineOutput.finalSuccesses);

  // Deduct fatica for uncountered
  if (uncountered > 0) {
    const fatica = actor.system.resources.fatica;
    await actor.update({
      "system.resources.fatica.value": Math.max(0, fatica.value - uncountered)
    });
  }

  // Post obstacle chat card
  const obsLines = [];
  obsLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Skills.agilita")} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>`);
  obsLines.push(`<div class="damage-line">${game.i18n.localize("SWORD.Chat.Successes")}: ${engineOutput.finalSuccesses} vs ${obstacleThreat} (${game.i18n.localize("SWORD.Sfida.Obstacle").toLowerCase()})</div>`);

  if (uncountered > 0) {
    obsLines.push(`<div class="damage-line"><strong>-${uncountered} ${game.i18n.localize("SWORD.Resources.fatica")}</strong></div>`);
  } else {
    obsLines.push(`<div class="damage-line"><strong>${game.i18n.localize("SWORD.Sfida.ObstacleAvoided")}</strong></div>`);
  }

  await _postChatCard(actor, "fa-person-running", game.i18n.localize("SWORD.Sfida.ObstacleReaction"), obsLines.join(""), [roll]);
}

// --------------- Chat Card Helper ---------------

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
