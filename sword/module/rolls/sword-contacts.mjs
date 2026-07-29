/**
 * Contacts (Contatti) creation workflow.
 *
 * PDF §4.10: When arriving at a new settlement, characters can establish contacts
 * via a skill check. Successes are split between Familiarità (bond strength) and
 * Influenza (local power). Heritage "conoscenze" grants +1 success bonus.
 * Urbana culture reduces ceto distance penalty by 1.
 * Talent "Rete di contatti": contact_familiarity_plus1 = +1 to both F and I,
 * extra_contacts = +1 max contacts per settlement type.
 */
import { SKILL_MAP, SOCIAL_SKILLS } from "../data/actor.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { CETO_VALUES, SETTLEMENT_MAX } from "../engine.mjs";
import { resolveContacts } from "../engine.mjs";
import { buildPenaltyHtml, buildFamaHtml } from "./dialog-helpers.mjs";

/**
 * Open the contacts creation dialog for an actor.
 * @param {Actor} actor
 */
export async function swordContacts(actor) {
  const system = actor.system;
  const hasExtraContacts = system.talentSpecials?.has("extra_contacts");
  const hasFamiliarityPlus1 = system.talentSpecials?.has("contact_familiarity_plus1");
  const hasUrbanaCulture = system.hasUrbanaCulture;
  const hasConoscenze = !!system.retaggio.conoscenze;

  // Build skill options (grade > 0)
  const skillOptions = Object.keys(system.skills)
    .filter(id => system.skills[id].grade > 0)
    .map(id => `<option value="${id}">${game.i18n.localize(`SWORD.Skills.${id}`)}</option>`)
    .join("");

  if (!skillOptions) {
    ui.notifications.warn(game.i18n.localize("SWORD.Contacts.NoSkills"));
    return;
  }

  // Settlement type options
  const settlementOptions = Object.keys(SETTLEMENT_MAX)
    .map(id => {
      const max = SETTLEMENT_MAX[id] + (hasExtraContacts ? 1 : 0);
      return `<option value="${id}">${game.i18n.localize(`SWORD.Contacts.Settlement.${id}`)} (max ${max})</option>`;
    })
    .join("");

  // Ceto options for contact
  const cetoOptions = ["umile", "popolano", "borghese", "nobile"]
    .map(id => `<option value="${id}">${game.i18n.localize(`SWORD.Ceto.${id}`)}</option>`)
    .join("");

  const allFoci = collectAllFoci(system);
  const focusHtml = buildFocusDialogHtml(allFoci);

  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const basePenalty = fatiguePenalty + woundPenalty + encumbrancePenalty;
  const spirito = system.resources.spirito;
  const isSocial = (id) => SOCIAL_SKILLS.has(id);

  const dialogContent = `
    <div class="sword-roll-dialog">
      <h3>${game.i18n.localize("SWORD.Contacts.Create")}</h3>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Contacts.ContactName")}</label>
        <input type="text" name="contactName" required autofocus />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Contacts.Profession")}</label>
        <input type="text" name="profession" />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Contacts.SettlementName")}</label>
        <input type="text" name="settlement" />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Contacts.SettlementType")}</label>
        <select name="settlementType">${settlementOptions}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Contacts.ContactCeto")}</label>
        <select name="contactCeto">${cetoOptions}</select>
      </div>
      <hr/>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Contacts.Skill")}</label>
        <select name="skillId">${skillOptions}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2" />
      </div>
      ${focusHtml}
      <hr/>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Contacts.RegionDistance")}</label>
        <input type="number" name="regionDistance" value="0" min="0" />
      </div>
      <div class="form-group">
        <label class="checkbox">
          <input type="checkbox" name="tradeRoute" />
          ${game.i18n.localize("SWORD.Contacts.TradeRoute")}
        </label>
      </div>
      ${basePenalty > 0 ? `<hr/>${buildPenaltyHtml(basePenalty, spirito.value)}` : ""}
      ${buildFamaHtml(system.fama, {
        hasMondano: !!system.talentSpecials?.has("add_fides_honor_to_fama"),
        valori: system.valori
      })}
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.Contacts.Create")} — ${actor.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-dice",
      callback: (event, button) => {
        const form = button.form;
        return {
          contactName: form.elements.contactName.value.trim(),
          profession: form.elements.profession.value.trim(),
          settlement: form.elements.settlement.value.trim(),
          settlementType: form.elements.settlementType.value,
          contactCeto: form.elements.contactCeto.value,
          skillId: form.elements.skillId.value,
          diceCount: parseInt(form.elements.diceCount.value) || 2,
          focusCount: countSelectedFoci(form, allFoci.length),
          regionDistance: parseInt(form.elements.regionDistance.value) || 0,
          tradeRoute: form.elements.tradeRoute.checked,
          spiritoCancelPenalty: parseInt(form.elements.spiritoCancelPenalty?.value) || 0,
          famaSpend: parseInt(form.elements.famaSpend?.value) || 0,
          mondanoValore: form.elements.mondanoValore?.value || ""
        };
      }
    }
  });

  if (!result || !result.contactName) return;

  const {
    contactName, profession, settlement, settlementType,
    contactCeto, skillId, focusCount, regionDistance, tradeRoute
  } = result;
  let { diceCount, spiritoCancelPenalty, famaSpend, mondanoValore } = result;

  // ── Skill data ──
  const charKey = SKILL_MAP[skillId];
  const isVariesSkill = charKey === "varies";
  const defaultCharKey = isVariesSkill ? (system.skills[skillId]?.specialtyChar || "mens") : charKey;
  const ec = system.effectiveCharacteristics ?? system.characteristics;
  const charScore = ec[defaultCharKey];
  const skillData = system.skills[skillId];
  const grade = skillData.grade;
  const extraDice = skillData.extraDice;
  const isUntrained = grade === 0 && extraDice === 0;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;

  // Fama spending (social skills only)
  const skillIsSocial = SOCIAL_SKILLS.has(skillId);
  if (!skillIsSocial || system.fama < famaSpend) famaSpend = 0;
  // Mondano: add Fides OR Honor (player's choice) as bonus dice when spending Fama
  let mondanoBonus = 0;
  if (famaSpend > 0 && mondanoValore && system.talentSpecials?.has("add_fides_honor_to_fama")) {
    mondanoBonus = system.valori[mondanoValore] || 0;
  }

  // Roll
  const totalDice = diceCount + extraDice + focusCount + famaSpend + mondanoBonus;
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  // --- Use-case call ---
  const contactResult = resolveContacts({
    characteristicScore: charScore, diceCount, grade, extraDice,
    focusDice: focusCount, famaSpend, mondanoBonus,
    actorCeto: system.ceto, contactCeto,
    hasUrbanaCulture, regionDistance, tradeRoute, settlementType,
    spiritoCancelPenalty: Math.min(Math.max(spiritoCancelPenalty, 0), spirito.value),
    conoscenzeBonus: hasConoscenze ? 1 : 0,
    eruditaBonus: system.eruditaStudyBonus || 0
  }, {
    fatiguePenalty: system.fatiguePenalty || 0,
    woundPenalty: system.woundPenalty || 0,
    encumbrancePenalty: system.encumbrancePenalty || 0,
    spirito: spirito.value, fama: system.fama,
    fatica: system.resources.fatica.value,
    riflessi: system.resources.riflessi.value
  }, diceRolled);

  const { engineOutput, cetoDistance, successesForDistribution: successes } = contactResult;

  // Apply resource patches
  const updateData = {};
  for (const [key, value] of Object.entries(contactResult.patches)) {
    if (key.startsWith("resources.")) {
      updateData[`system.${key}.value`] = value;
    } else {
      updateData[`system.${key}`] = value;
    }
  }
  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);

  if (successes <= 0) {
    // Failed — no contact established
    const content = `
      <div class="sword chat-card">
        <header class="card-header">
          <img src="${actor.img}" width="36" height="36" />
          <div class="card-header-text">
            <h3><i class="fas fa-address-book"></i> ${game.i18n.localize("SWORD.Contacts.Create")}</h3>
          </div>
        </header>
        <div class="result-section">
          <div class="damage-line">${skillLabel} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
          <div class="damage-line">✗ ${game.i18n.localize("SWORD.Chat.Failed")} — ${game.i18n.localize("SWORD.Chat.Successes")}: ${engineOutput.finalSuccesses}</div>
          ${hasConoscenze ? `<div class="damage-line">${game.i18n.localize("SWORD.Contacts.ConoscenzeBonus")}</div>` : ""}
          ${cetoDistance > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Contacts.CetoDistancePenalty")}: -${cetoDistance}</div>` : ""}
        </div>
      </div>`;
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content,
      rolls: [roll],
      sound: CONFIG.sounds.dice
    });
    return;
  }

  // Success — distribution dialog
  let familiarita = 0;
  let influenza = 0;

  if (successes === 1) {
    // Only 1 success: player chooses
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SWORD.Contacts.DistributeTitle") },
      content: `<p>${game.i18n.format("SWORD.Contacts.Distribute1Success", { name: contactName })}</p>
        ${hasFamiliarityPlus1 ? `<p class="hint">${game.i18n.localize("SWORD.Contacts.TalentFamiliarityBonus")}</p>` : ""}`,
      buttons: [
        { action: "familiarita", label: `${game.i18n.localize("SWORD.Contacts.Familiarita")} +1` },
        { action: "influenza", label: `${game.i18n.localize("SWORD.Contacts.Influenza")} +1` }
      ]
    });
    if (!choice) return;
    if (choice === "familiarita") familiarita = 1;
    else influenza = 1;
    // Rete di contatti applies to the single-success path too
    if (hasFamiliarityPlus1) {
      familiarita += 1;
      influenza += 1;
    }
  } else {
    // Multiple successes: let player distribute
    const distResult = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SWORD.Contacts.DistributeTitle") },
      content: `
        <div class="sword-roll-dialog">
          <p>${game.i18n.format("SWORD.Contacts.DistributeSuccesses", { count: successes, name: contactName })}</p>
          <div class="form-group">
            <label>${game.i18n.localize("SWORD.Contacts.Familiarita")}</label>
            <input type="number" name="familiarita" value="${Math.ceil(successes / 2)}" min="0" max="${successes}" />
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("SWORD.Contacts.Influenza")}</label>
            <input type="number" name="influenza" value="${Math.floor(successes / 2)}" min="0" max="${successes}" />
          </div>
          ${hasFamiliarityPlus1 ? `
          <div class="form-group">
            <label class="checkbox">
              <input type="checkbox" name="talentBonus" checked />
              ${game.i18n.localize("SWORD.Contacts.TalentFamiliarityBonus")}
            </label>
          </div>` : ""}
        </div>`,
      ok: {
        label: game.i18n.localize("SWORD.Focus.Confirm"),
        icon: "fa-solid fa-check",
        callback: (event, button) => {
          const form = button.form;
          const f = parseInt(form.elements.familiarita.value) || 0;
          const i = parseInt(form.elements.influenza.value) || 0;
          const talentBonus = hasFamiliarityPlus1 && form.elements.talentBonus?.checked;
          return { familiarita: f, influenza: i, talentBonus };
        }
      }
    });
    if (!distResult) return;

    // Ensure total doesn't exceed successes
    const total = distResult.familiarita + distResult.influenza;
    if (total > successes) {
      // Proportionally adjust
      familiarita = Math.min(distResult.familiarita, successes);
      influenza = successes - familiarita;
    } else {
      familiarita = distResult.familiarita;
      influenza = distResult.influenza;
    }

    if (distResult.talentBonus) {
      familiarita += 1;
      influenza += 1;
    }
  }

  // Store new contact
  const newContact = {
    name: contactName,
    profession,
    settlement,
    ceto: contactCeto,
    familiarita,
    influenza,
    skill: skillId,
    notes: ""
  };

  const contacts = [...(system.contacts || []), newContact];
  await actor.update({ "system.contacts": contacts });

  // Chat card
  const cetoLabel = game.i18n.localize(`SWORD.Ceto.${contactCeto}`);
  const content = `
    <div class="sword chat-card">
      <header class="card-header">
        <img src="${actor.img}" width="36" height="36" />
        <div class="card-header-text">
          <h3><i class="fas fa-address-book"></i> ${game.i18n.localize("SWORD.Contacts.Create")}</h3>
        </div>
      </header>
      <div class="result-section">
        <div class="damage-line">${skillLabel} (${charScore}): [${diceRolled.join(", ")}] → ${engineOutput.finalSum}</div>
        <div class="damage-line">✓ ${game.i18n.localize("SWORD.Chat.Passed")} — ${game.i18n.localize("SWORD.Chat.Successes")}: ${successes}</div>
        ${hasConoscenze ? `<div class="damage-line">${game.i18n.localize("SWORD.Contacts.ConoscenzeBonus")}</div>` : ""}
        ${cetoDistance > 0 ? `<div class="damage-line">${game.i18n.localize("SWORD.Contacts.CetoDistancePenalty")}: -${cetoDistance}${hasUrbanaCulture ? ` (${game.i18n.localize("SWORD.Contacts.UrbanaReduction")})` : ""}</div>` : ""}
        <hr/>
        <div class="damage-line"><strong>${contactName}</strong> — ${cetoLabel}${profession ? `, ${profession}` : ""}${settlement ? ` (${settlement})` : ""}</div>
        <div class="damage-line">${game.i18n.localize("SWORD.Contacts.Familiarita")}: ${familiarita} | ${game.i18n.localize("SWORD.Contacts.Influenza")}: ${influenza}</div>
        ${hasFamiliarityPlus1 ? `<div class="damage-line">${game.i18n.localize("SWORD.Contacts.TalentFamiliarityBonus")}</div>` : ""}
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}
