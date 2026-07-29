/**
 * Interlude actions (downtime between adventures).
 *
 * PDF §8.8: Each interlude action takes one month minimum.
 * Types implemented:
 *  - Addestramento (Training): gain 1 PE
 *  - Studio (Study): Ragionamento vs 6 successes, gain 2 PE (3 with Diligente)
 *  - Lavoro (Work): skill check, earn money per ceto (doubled with Diligente/Affarista)
 */
import { SKILL_MAP } from "../data/actor.mjs";
import { CURRENCY } from "../engine.mjs";
import { computeWorkEarnings, computeBondCost } from "../engine.mjs";
import { resolveStudy, resolveWork, resolveBond } from "../engine.mjs";

/**
 * Open the interlude dialog for an actor.
 * @param {Actor} actor
 */
export async function swordInterlude(actor) {
  const system = actor.system;
  const hasStudy3PE = system.talentSpecials?.has("study_3pe");
  const hasDoubleWork = system.talentSpecials?.has("double_work_earnings");
  const hasDoubleTrade = system.talentSpecials?.has("double_trade_earnings");
  const doubleWork = hasDoubleWork || hasDoubleTrade;
  const hasContacts = (system.contacts || []).length > 0;

  // Build contact options for bond
  const contactOptions = (system.contacts || [])
    .map((c, i) => `<option value="${i}">${c.name} (F:${c.familiarita} I:${c.influenza})</option>`)
    .join("");

  // Build skill options for work
  const skillOptions = Object.keys(system.skills)
    .filter(id => system.skills[id].grade > 0)
    .map(id => `<option value="${id}">${game.i18n.localize(`SWORD.Skills.${id}`)}</option>`)
    .join("");

  const studyPE = hasStudy3PE ? 3 : 2;

  const dialogContent = `
    <div class="sword-roll-dialog">
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Interlude.Type")}</label>
        <select name="interludeType">
          <option value="training">${game.i18n.localize("SWORD.Interlude.Training")} (+1 PE)</option>
          <option value="study">${game.i18n.localize("SWORD.Interlude.Study")} (+${studyPE} PE)</option>
          <option value="work">${game.i18n.localize("SWORD.Interlude.Work")}${doubleWork ? " (×2)" : ""}</option>
          ${hasContacts ? `<option value="bond">${game.i18n.localize("SWORD.Interlude.Bond")}</option>` : ""}
        </select>
      </div>
      <hr/>
      <fieldset class="study-options" style="display:none;">
        <legend>${game.i18n.localize("SWORD.Interlude.Study")}</legend>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
          <input type="number" name="diceCount" value="2" min="2" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Interlude.GoldForBonus")}</label>
          <input type="number" name="goldBonus" value="0" min="0" />
        </div>
      </fieldset>
      <fieldset class="work-options" style="display:none;">
        <legend>${game.i18n.localize("SWORD.Interlude.Work")}</legend>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Interlude.WorkSkill")}</label>
          <select name="workSkill">${skillOptions}</select>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
          <input type="number" name="workDiceCount" value="2" min="2" />
        </div>
      </fieldset>
      ${hasContacts ? `
      <fieldset class="bond-options" style="display:none;">
        <legend>${game.i18n.localize("SWORD.Interlude.Bond")}</legend>
        <div class="form-group">
          <label>${game.i18n.localize("SWORD.Interlude.BondContact")}</label>
          <select name="bondContact">${contactOptions}</select>
        </div>
      </fieldset>` : ""}
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.Interlude.Label")} — ${actor.name}` },
    content: dialogContent,
    // Wire the type-specific sections here: DialogV2 injects content via
    // innerHTML, so inline <script> tags never execute.
    render: (event, dialog) => {
      const parent = dialog.element.querySelector(".sword-roll-dialog");
      const typeEl = parent?.querySelector('[name="interludeType"]');
      if (!typeEl) return;
      typeEl.addEventListener("change", () => {
        parent.querySelector(".study-options").style.display = typeEl.value === "study" ? "" : "none";
        parent.querySelector(".work-options").style.display = typeEl.value === "work" ? "" : "none";
        const bondEl = parent.querySelector(".bond-options");
        if (bondEl) bondEl.style.display = typeEl.value === "bond" ? "" : "none";
      });
    },
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button) => {
        const form = button.form;
        return {
          type: form.elements.interludeType.value,
          diceCount: parseInt(form.elements.diceCount?.value) || 2,
          goldBonus: parseInt(form.elements.goldBonus?.value) || 0,
          workSkill: form.elements.workSkill?.value,
          workDiceCount: parseInt(form.elements.workDiceCount?.value) || 2,
          bondContact: parseInt(form.elements.bondContact?.value) || 0
        };
      }
    }
  });

  if (!result) return;

  if (result.type === "training") {
    await _resolveTraining(actor);
  } else if (result.type === "study") {
    await _resolveStudy(actor, result.diceCount, result.goldBonus, studyPE);
  } else if (result.type === "work") {
    await _resolveWork(actor, result.workSkill, result.workDiceCount, doubleWork);
  } else if (result.type === "bond") {
    await _resolveBond(actor, result.bondContact);
  }
}

async function _resolveTraining(actor) {
  const newTotal = actor.system.pe.total + 1;
  await actor.update({ "system.pe.total": newTotal });

  const content = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${actor.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas fa-graduation-cap"></i> ${game.i18n.localize("SWORD.Interlude.Training")}</h3>
        </div>
      </header>
      <div class="result-section">
        <div class="damage-line"><strong>+1 PE</strong></div>
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content
  });
}

async function _resolveStudy(actor, diceCount, goldBonus, studyPE) {
  // Gold bonus must be affordable: each bonus success costs 1 lira
  if (goldBonus > 0) {
    const availableDenari = actor.system.money.lire * CURRENCY.lira.inDenari
      + actor.system.money.soldi * CURRENCY.soldo.inDenari
      + actor.system.money.denari;
    const affordable = Math.floor(availableDenari / CURRENCY.lira.inDenari);
    if (goldBonus > affordable) {
      goldBonus = affordable;
      ui.notifications.warn(game.i18n.format("SWORD.Interlude.GoldBonusClamped", { count: affordable }));
    }
  }
  const system = actor.system;
  const ec = system.effectiveCharacteristics ?? system.characteristics;
  const charScore = ec.mens;
  const skillData = system.skills.ragionamento;
  const grade = skillData.grade;
  const extraDice = skillData.extraDice;
  const isUntrained = grade === 0 && extraDice === 0;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;

  const totalDice = diceCount + extraDice;
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  // --- Use-case call ---
  const studyResult = resolveStudy({
    characteristicScore: charScore, diceCount, grade, extraDice,
    hasStudy3pe: studyPE === 3, goldBonusSuccesses: goldBonus
  }, {
    fatiguePenalty: system.fatiguePenalty || 0, woundPenalty: system.woundPenalty || 0,
    encumbrancePenalty: system.encumbrancePenalty || 0,
    spirito: system.resources.spirito.value, fatica: system.resources.fatica.value,
    riflessi: system.resources.riflessi.value
  }, diceRolled);

  const { passed, peGained } = studyResult;
  const engineOutput = studyResult.checkResult.engineOutput;
  const updateData = {};

  // Deduct gold spent
  if (goldBonus > 0) {
    const goldDenari = goldBonus * CURRENCY.lira.inDenari;
    let totalDenari = system.money.lire * CURRENCY.lira.inDenari
      + system.money.soldi * CURRENCY.soldo.inDenari
      + system.money.denari;
    totalDenari = Math.max(0, totalDenari - goldDenari);
    updateData["system.money.lire"] = Math.floor(totalDenari / CURRENCY.lira.inDenari);
    totalDenari %= CURRENCY.lira.inDenari;
    updateData["system.money.soldi"] = Math.floor(totalDenari / CURRENCY.soldo.inDenari);
    updateData["system.money.denari"] = totalDenari % CURRENCY.soldo.inDenari;
  }

  if (passed) {
    updateData["system.pe.total"] = system.pe.total + peGained;
  }

  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  const content = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${actor.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas fa-book-open"></i> ${game.i18n.localize("SWORD.Interlude.Study")}</h3>
        </div>
      </header>
      <div class="result-section">
        <div class="damage-line">${game.i18n.localize("SWORD.Skills.ragionamento")} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
        <div class="damage-line">${passed ? "✓" : "✗"} ${game.i18n.localize(passed ? "SWORD.Chat.Passed" : "SWORD.Chat.Failed")} — ${game.i18n.localize("SWORD.Chat.Successes")}: ${engineOutput.finalSuccesses} / 6</div>
        ${goldBonus > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Interlude.GoldSpent")}: ${goldBonus} ${game.i18n.localize("SWORD.Currency.Lire")}</div>` : ""}
        ${passed ? `<div class="damage-line"><strong>+${studyPE} PE</strong></div>` : ""}
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}

async function _resolveWork(actor, skillId, diceCount, doubleEarnings) {
  const system = actor.system;
  const ec = system.effectiveCharacteristics ?? system.characteristics;
  const charKey = SKILL_MAP[skillId];
  const charScore = ec[charKey];
  const skillData = system.skills[skillId];
  const grade = skillData?.grade || 0;
  const extraDice = skillData?.extraDice || 0;
  const isUntrained = grade === 0 && extraDice === 0;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;

  const totalDice = diceCount + extraDice;
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  const ceto = system.ceto;
  const earningDef = computeWorkEarnings(ceto);

  // --- Use-case call (skill check portion) ---
  const workResult = resolveWork({
    characteristicScore: charScore, diceCount, grade, extraDice,
    ceto, doubleEarnings
  }, {
    fatiguePenalty: system.fatiguePenalty || 0, woundPenalty: system.woundPenalty || 0,
    encumbrancePenalty: system.encumbrancePenalty || 0,
    spirito: system.resources.spirito.value, fatica: system.resources.fatica.value,
    riflessi: system.resources.riflessi.value
  }, diceRolled, []); // Pass empty — we'll roll earnings separately per success

  const successes = workResult.successes;
  const engineOutput = workResult.checkResult.engineOutput;

  // Roll earnings per success (Foundry Roll for display)
  let totalEarningsDenari = 0;
  const earningsRolls = [];
  for (let i = 0; i < successes; i++) {
    const earningsRoll = new Roll(`${earningDef.diceCount}d${earningDef.sides}`);
    await earningsRoll.evaluate();
    const amount = earningsRoll.total;
    earningsRolls.push(amount);
    const rate = earningDef.unit === "soldi" ? CURRENCY.soldo.inDenari
      : earningDef.unit === "lire" ? CURRENCY.lira.inDenari : 1;
    totalEarningsDenari += amount * rate;
  }
  if (doubleEarnings) totalEarningsDenari *= 2;

  // Add to actor's money
  const updateData = {};
  if (totalEarningsDenari > 0) {
    let currentDenari = system.money.lire * CURRENCY.lira.inDenari
      + system.money.soldi * CURRENCY.soldo.inDenari
      + system.money.denari;
    currentDenari += totalEarningsDenari;
    updateData["system.money.lire"] = Math.floor(currentDenari / CURRENCY.lira.inDenari);
    currentDenari %= CURRENCY.lira.inDenari;
    updateData["system.money.soldi"] = Math.floor(currentDenari / CURRENCY.soldo.inDenari);
    updateData["system.money.denari"] = currentDenari % CURRENCY.soldo.inDenari;
  }

  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Format earnings display
  const displayLire = Math.floor(totalEarningsDenari / CURRENCY.lira.inDenari);
  const remAfterLire = totalEarningsDenari % CURRENCY.lira.inDenari;
  const displaySoldi = Math.floor(remAfterLire / CURRENCY.soldo.inDenari);
  const displayDenari = remAfterLire % CURRENCY.soldo.inDenari;
  const parts = [];
  if (displayLire > 0) parts.push(`${displayLire} ${game.i18n.localize("SWORD.Currency.Lire")}`);
  if (displaySoldi > 0) parts.push(`${displaySoldi} ${game.i18n.localize("SWORD.Currency.Soldi")}`);
  if (displayDenari > 0) parts.push(`${displayDenari} ${game.i18n.localize("SWORD.Currency.Denari")}`);
  const earningsDisplay = parts.length > 0 ? parts.join(", ") : "0";

  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);
  const content = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${actor.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas fa-hammer"></i> ${game.i18n.localize("SWORD.Interlude.Work")}</h3>
        </div>
      </header>
      <div class="result-section">
        <div class="damage-line">${skillLabel} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
        <div class="damage-line">${engineOutput.basePassed ? "✓" : "✗"} ${game.i18n.localize(engineOutput.basePassed ? "SWORD.Chat.Passed" : "SWORD.Chat.Failed")} — ${game.i18n.localize("SWORD.Chat.Successes")}: ${successes}</div>
        ${successes > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Interlude.Earnings")}: <strong>${earningsDisplay}</strong>${doubleEarnings ? " (×2)" : ""}</div>` : ""}
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}

/**
 * Bond interlude: invest money to deepen a contact relationship.
 * Investment cost by current influenza level (PDF §4.10):
 *  0 → 2d6 soldi, 1 → 6d6 soldi, 2 → 1d6 lire, 3 → 2d6 lire,
 *  4 → 4d6 lire, 5+ → 4d6 + (influenza-4)×2d6 lire
 * @param {Actor} actor
 * @param {number} contactIndex
 */
async function _resolveBond(actor, contactIndex) {
  const system = actor.system;
  const contacts = [...(system.contacts || [])];
  const contact = contacts[contactIndex];
  if (!contact) return;

  const influence = contact.influenza;

  // Use engine to compute cost parameters
  const costParams = computeBondCost(influence);
  const investDice = `${costParams.diceCount}d6`;
  const investUnit = costParams.unit;

  // Roll investment cost
  const costRoll = new Roll(investDice);
  await costRoll.evaluate();
  const costAmount = costRoll.total;

  // Check funds via engine
  let totalDenari = system.money.lire * CURRENCY.lira.inDenari
    + system.money.soldi * CURRENCY.soldo.inDenari
    + system.money.denari;

  const bondResult = resolveBond(influence, costAmount, totalDenari);
  const costDenari = bondResult.costDenari;

  const costUnitLabel = game.i18n.localize(investUnit === "lire" ? "SWORD.Currency.Lire" : "SWORD.Currency.Soldi");
  const costDisplay = `${costAmount} ${costUnitLabel}`;

  if (!bondResult.canAfford) {
    const content = `
      <div class="sword chat-card">
        <header class="card-header">
          <img src="${actor.img}" width="36" height="36" />
          <div class="card-header-text">
            <h3><i class="fas fa-handshake"></i> ${game.i18n.localize("SWORD.Interlude.Bond")}</h3>
          </div>
        </header>
        <div class="result-section">
          <div class="damage-line">${game.i18n.localize("SWORD.Interlude.BondContact")}: <strong>${contact.name}</strong></div>
          <div class="damage-line">${game.i18n.localize("SWORD.Interlude.BondInvestment")}: ${costDisplay} (${investDice})</div>
          <div class="damage-line">✗ ${game.i18n.localize("SWORD.Interlude.BondInsufficientFunds")}</div>
        </div>
      </div>`;
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content,
      rolls: [costRoll],
      sound: CONFIG.sounds.dice
    });
    return;
  }

  // Deduct money and increase familiarità
  totalDenari -= costDenari;
  const updateData = {};
  updateData["system.money.lire"] = Math.floor(totalDenari / CURRENCY.lira.inDenari);
  totalDenari %= CURRENCY.lira.inDenari;
  updateData["system.money.soldi"] = Math.floor(totalDenari / CURRENCY.soldo.inDenari);
  updateData["system.money.denari"] = totalDenari % CURRENCY.soldo.inDenari;

  contacts[contactIndex] = { ...contact, familiarita: contact.familiarita + 1 };
  updateData["system.contacts"] = contacts;

  await actor.update(updateData);

  const content = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${actor.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas fa-handshake"></i> ${game.i18n.localize("SWORD.Interlude.Bond")}</h3>
        </div>
      </header>
      <div class="result-section">
        <div class="damage-line">${game.i18n.localize("SWORD.Interlude.BondContact")}: <strong>${contact.name}</strong></div>
        <div class="damage-line">${game.i18n.localize("SWORD.Interlude.BondInvestment")}: ${costDisplay} (${investDice})</div>
        <div class="damage-line">✓ ${game.i18n.localize("SWORD.Interlude.BondResult")} → F:${contact.familiarita + 1}</div>
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content,
    rolls: [costRoll],
    sound: CONFIG.sounds.dice
  });
}
