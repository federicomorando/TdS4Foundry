/**
 * Shared dialog HTML builders for roll adapter dialogs.
 *
 * Eliminates duplication of penalty display, valore/fama selectors,
 * approach dropdown, and combined maneuver UI across 13+ roll adapters.
 */

import { VALORE_KEYS } from "../engine.mjs";

/**
 * Build individual penalty label strings for the breakdown variant.
 * @returns {string[]} Array of human-readable penalty labels
 */
export function buildPenaltyParts({ fatiguePenalty = 0, woundPenalty = 0, encumbrancePenalty = 0, fatigueLevel = "fresco" }) {
  const parts = [];
  if (fatiguePenalty > 0) {
    const levelLabel = game.i18n.localize(`SWORD.Fatigue.${fatigueLevel}`);
    parts.push(`${game.i18n.localize("SWORD.Chat.PenaltyApplied")}: ${levelLabel} (-${fatiguePenalty})`);
  }
  if (woundPenalty > 0) {
    parts.push(`${game.i18n.localize("SWORD.Combat.WoundPenalty")}: -${woundPenalty}`);
  }
  if (encumbrancePenalty > 0) {
    parts.push(`${game.i18n.localize("SWORD.Encumbrance.Penalty")}: -${encumbrancePenalty}`);
  }
  return parts;
}

/**
 * Build penalty display HTML with spirito cancellation input.
 *
 * Two display modes:
 * - Pass `parts` array for itemized breakdown (e.g., "Stanco: -1 + Wounds: -2")
 * - Omit `parts` for total-only label (e.g., "Penalty Total: -3")
 *
 * @param {number} basePenalty - Total penalty value
 * @param {number} spiritoValue - Current spirito for cancellation cap
 * @param {string[]} [parts] - Itemized penalty labels (omit for total-only)
 * @returns {string} HTML string (empty if basePenalty <= 0)
 */
export function buildPenaltyHtml(basePenalty, spiritoValue, parts) {
  if (basePenalty <= 0) return "";
  const label = parts
    ? parts.join(" + ")
    : `${game.i18n.localize("SWORD.Combat.PenaltyTotal")}: -${basePenalty}`;
  return `
    <div class="form-group fatigue-penalty-group">
      <label>${label}</label>
      <div class="form-group-inline">
        <label>${game.i18n.localize("SWORD.Roll.PenaltyCancellation")}</label>
        <input type="number" name="spiritoCancelPenalty" value="0" min="0" max="${Math.min(basePenalty, spiritoValue)}" />
      </div>
    </div>
  `;
}

/**
 * Build valore activation dropdown HTML.
 * @param {object} system - Actor system data
 * @returns {string} HTML string (empty if no valori available)
 */
export function buildValoreSelectHtml(system) {
  const availableValori = VALORE_KEYS
    .filter(k => system.valori[k] > 0)
    .map(k => ({
      key: k,
      label: game.i18n.localize(`SWORD.Valori.${k}`),
      score: system.valori[k]
    }));
  if (availableValori.length === 0) return "";

  const canUseValore = system.resources.spirito.value >= 3;
  const noneLabel = game.i18n.localize("SWORD.Roll.ValoreNone");
  const options = availableValori
    .map(v => `<option value="${v.key}">${v.label} (${v.score})</option>`)
    .join("");
  return `
    <div class="form-group">
      <label>${game.i18n.localize("SWORD.Roll.Valore")}</label>
      <select name="valore" ${!canUseValore ? "disabled" : ""}>
        <option value="">${noneLabel}</option>
        ${options}
      </select>
      ${!canUseValore ? `<p class="hint">${game.i18n.localize("SWORD.Roll.ValoreNoSpirito")}</p>` : ""}
    </div>
  `;
}

/**
 * Build fama spending input + optional mondano valore selector HTML.
 * @param {number} fama - Current fama value
 * @param {object} [opts]
 * @param {boolean} [opts.hasMondano=false] - Has add_fides_honor_to_fama talent
 * @param {object} [opts.valori] - Actor valori (needed if hasMondano)
 * @returns {string} HTML string (empty if fama=0)
 */
export function buildFamaHtml(fama, { hasMondano = false, valori = {} } = {}) {
  if (fama <= 0) return "";

  let mondanoHtml = "";
  if (hasMondano) {
    const fides = valori.fides || 0;
    const honor = valori.honor || 0;
    if (fides > 0 || honor > 0) {
      mondanoHtml = `
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Talent.Mondano")}</label>
          <select name="mondanoValore">
            <option value="">—</option>
            ${fides > 0 ? `<option value="fides">${game.i18n.localize("SWORD.Valori.fides")} (+${fides})</option>` : ""}
            ${honor > 0 ? `<option value="honor">${game.i18n.localize("SWORD.Valori.honor")} (+${honor})</option>` : ""}
          </select>
        </div>`;
    }
  }
  return `
    <div class="form-group">
      <label>${game.i18n.localize("SWORD.Roll.Fama")} (${fama})</label>
      <input type="number" name="famaSpend" value="0" min="0" max="${fama}" />
    </div>
    ${mondanoHtml}
  `;
}

/**
 * Build combat approach selector (Corsa/Prudente/Carica).
 * @returns {string} HTML string
 */
export function buildCombatApproachHtml() {
  return `
    <div class="form-group">
      <label>${game.i18n.localize("SWORD.Combat.Approach")}</label>
      <select name="approach">
        <option value="corsa">${game.i18n.localize("SWORD.Combat.ApproachCorsa")} (0/0)</option>
        <option value="prudente">${game.i18n.localize("SWORD.Combat.ApproachPrudente")} (-1/+1)</option>
        <option value="carica">${game.i18n.localize("SWORD.Combat.ApproachCarica")} (+1/-1)</option>
      </select>
    </div>
  `;
}

/**
 * Build combined maneuver selector HTML.
 * @param {Array<{id: string, label: string, grade: number}>} skillOptions - Available correlated skills
 * @param {boolean} canUseCombined - Whether resources allow combined maneuver
 * @param {object} [opts]
 * @param {string} [opts.preSelected=""] - Pre-selected skill ID
 * @returns {string} HTML string (empty if no options)
 */
export function buildCombinedManeuverHtml(skillOptions, canUseCombined, { preSelected = "", inInitiative = null } = {}) {
  if (skillOptions.length === 0) return "";

  const noneLabel = game.i18n.localize("SWORD.Roll.ValoreNone");
  const combinedOpts = skillOptions
    .map(s => `<option value="${s.id}" ${s.id === preSelected ? "selected" : ""}>${s.label} (+${s.grade})</option>`)
    .join("");
  // inInitiative overrides the default game.combat heuristic: sfide charge the
  // +3 Riflessi only when running under initiative rules (confronto + drain)
  const inCombat = inInitiative ?? !!game.combat;
  const costHint = inCombat
    ? game.i18n.localize("SWORD.Combined.CostCombat")
    : game.i18n.localize("SWORD.Combined.CostNormal");
  const costSourceLabel = game.i18n.localize("SWORD.Combined.CostSource");
  const spiritoLabel = game.i18n.localize("SWORD.Resources.spirito");
  const faticaLabel = game.i18n.localize("SWORD.Resources.fatica");
  return `
    <div class="form-group">
      <label>${game.i18n.localize("SWORD.Combined.Label")}</label>
      <select name="combinedSkill" ${!canUseCombined ? "disabled" : ""}
        onchange="this.closest('.sword-roll-dialog').querySelector('[data-combined-cost-group]').style.display = this.value ? '' : 'none'">
        <option value="">${noneLabel}</option>
        ${combinedOpts}
      </select>
      <p class="hint">${costHint}</p>
    </div>
    <div class="form-group" style="${preSelected ? "" : "display:none"}" data-combined-cost-group>
      <label>${costSourceLabel}</label>
      <select name="combinedCostSource">
        <option value="spirito">${spiritoLabel}</option>
        <option value="fatica">${faticaLabel}</option>
      </select>
    </div>
  `;
}

/**
 * Build combined skill options list from actor system data.
 * @param {object} system - Actor system data
 * @param {string} currentSkillId - Skill to exclude
 * @param {number} currentGrade - Current skill grade (must be >= 1)
 * @returns {{ options: Array<{id, label, grade}>, canUse: boolean }}
 */
export function buildCombinedSkillOptions(system, currentSkillId, currentGrade) {
  const options = [];
  if (currentGrade >= 1) {
    for (const [sid, sdata] of Object.entries(system.skills)) {
      if (sid === currentSkillId) continue;
      if ((sdata.grade || 0) < 1) continue;
      options.push({
        id: sid,
        label: game.i18n.localize(`SWORD.Skills.${sid}`),
        grade: sdata.grade
      });
    }
  }
  const canUse = options.length > 0 && (system.resources.spirito.value >= 1 || system.resources.fatica.value >= 1);
  return { options, canUse };
}

/**
 * Extract an integer form field value with a default.
 * Replaces `parseInt(form.elements.X.value) || default` pattern.
 */
export function formInt(form, name, defaultValue = 0) {
  return parseInt(form.elements[name]?.value) || defaultValue;
}

/**
 * Extract a string form field value with a default.
 */
export function formStr(form, name, defaultValue = "") {
  return form.elements[name]?.value || defaultValue;
}

/**
 * Extract a boolean (checkbox) form field value.
 */
export function formBool(form, name) {
  return !!form.elements[name]?.checked;
}
