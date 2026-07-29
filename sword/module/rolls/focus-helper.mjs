/**
 * Shared focus helpers for context-based focus selection.
 *
 * Errata §7.1 (line 3483-3485): Focus applies to ANY skill check where the
 * action relates to the specialization, not just the skill that granted it.
 * Each applicable focus = +1 extra die. Player selects at roll time.
 */

/**
 * Collect all named foci from all skills on an actor's system data.
 * @param {object} system - actor.system
 * @returns {Array<{skillId: string, name: string, label: string}>}
 */
export function collectAllFoci(system) {
  const foci = [];
  for (const [skillId, skillData] of Object.entries(system.skills)) {
    for (const f of skillData.foci || []) {
      const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);
      foci.push({ skillId, name: f.name, label: `${skillLabel}: ${f.name}` });
    }
  }
  // Ceto-based social foci from talents (Bassifondi, Mercante, Raffinato)
  const flags = system.talentFlags;
  if (flags?.has("focus_umile_social")) {
    foci.push({ skillId: "_talent", name: "ceto_umile", label: game.i18n.localize("SWORD.Focus.CetoUmile") });
  }
  if (flags?.has("focus_borghese_social")) {
    foci.push({ skillId: "_talent", name: "ceto_borghese", label: game.i18n.localize("SWORD.Focus.CetoBorghese") });
  }
  if (flags?.has("focus_nobile_social")) {
    foci.push({ skillId: "_talent", name: "ceto_nobile", label: game.i18n.localize("SWORD.Focus.CetoNobile") });
  }
  return foci;
}

/**
 * Build HTML for focus selection checkboxes in a roll dialog.
 * Returns empty string if no foci exist.
 * @param {Array<{skillId: string, name: string, label: string}>} allFoci
 * @returns {string} HTML string
 */
export function buildFocusDialogHtml(allFoci) {
  if (allFoci.length === 0) return "";
  const checkboxes = allFoci
    .map((f, i) => `<label class="focus-checkbox"><input type="checkbox" name="focus-${i}" /> ${f.label}</label>`)
    .join("\n        ");
  return `
    <fieldset class="focus-selection">
      <legend><i class="fas fa-crosshairs"></i> ${game.i18n.localize("SWORD.Focus.ApplicableFoci")}</legend>
      <div class="focus-checkboxes">
        ${checkboxes}
      </div>
    </fieldset>`;
}

/**
 * Count how many focus checkboxes were checked in a dialog form.
 * @param {HTMLFormElement} form - The dialog form element
 * @param {number} fociCount - Total number of foci checkboxes
 * @returns {number} Number of checked foci
 */
export function countSelectedFoci(form, fociCount) {
  let count = 0;
  for (let i = 0; i < fociCount; i++) {
    if (form.elements[`focus-${i}`]?.checked) count++;
  }
  return count;
}
