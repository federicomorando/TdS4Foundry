/**
 * Grapple Lock (Bloccaggio) and Break Free (Liberarsi) actions.
 *
 * Lock: grappler performs a Lotta check. On success, opponent is locked
 * (cannot attack, defend, or move — only Break Free).
 *
 * Break Free: locked actor performs opposed Forza check vs lock difficulty.
 * On success, grapple is cleared and engagement returns to previous misura.
 *
 * PDF section 8.9 (Abrazzar). Engine: computeLockBreakDifficulty().
 */
import { swordCheckResolve } from "../engine.mjs";
import { computeLockBreakDifficulty } from "../engine.mjs";
import { SKILL_MAP } from "../data/actor.mjs";
import { armorSkillPenalty } from "../engine.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { buildPenaltyHtml } from "./dialog-helpers.mjs";

/**
 * Execute a Grapple Lock (Bloccaggio) attempt.
 * @param {Actor} actor - The grappler (attacker)
 * @param {object} [options] - Pre-fill options
 * @param {string} [options.lockTarget] - Target actor ID
 */
export async function swordGrappleLock(actor, options = {}) {
  const system = actor.system;
  const isCreature = actor.type === "creature";

  // Validate: must be in combat and grappling
  if (!game.combat) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoCombat"));
    return;
  }

  const grappleState = game.combat.getGrappleLock(actor);
  if (!grappleState || grappleState.role !== "grappler") {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.GrappleNotGrappling"));
    return;
  }

  // Action economy gate
  if (!game.combat.hasActionAvailable(actor)) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoActionAvailable"));
      return;
    }
    ui.notifications.info(game.i18n.localize("SWORD.Combat.GMActionOverride"));
  }

  // opponentId is a canonical combat key (token id first) — resolve via combat
  const targetActorId = grappleState.opponentId;
  const targetActor = game.combat.resolveCombatant(targetActorId)?.actor
    ?? game.actors.get(targetActorId);
  if (!targetActor) {
    ui.notifications.error("Avversario non trovato.");
    return;
  }

  const skillId = "lotta";
  const skillLabel = game.i18n.localize("SWORD.Skills.lotta");

  // A successful grab pre-loads the grappler's next Lotta check with the grab's net
  // successes (errata §5.6), accumulated toward the lock threshold of 3. Consumed here.
  const grapplerCombatant = game.combat.resolveCombatant(actor);
  const followUpBonus = grapplerCombatant?.getFlag("sword", "grappleFollowUpBonus") ?? 0;

  if (isCreature) {
    // Creature: fixed lotta successes
    const fixedSuccesses = system.skills?.lotta ?? 0;
    const fatiguePenalty = system.fatiguePenalty || 0;
    const woundPenalty = system.woundPenalty || 0;
    const basePenalty = fatiguePenalty + woundPenalty;
    const effectiveSuccesses = Math.max(0, fixedSuccesses - basePenalty);

    // Lock: sfida to threshold 3 (errata §5.6), with the grab's net successes accumulated.
    const lockDifficulty = 3;
    const lockSuccesses = effectiveSuccesses + followUpBonus;
    const passed = lockSuccesses >= lockDifficulty;

    if (grapplerCombatant) {
      if (passed) await grapplerCombatant.setFlag("sword", "lockSuccesses", lockSuccesses);
      // The grab bonus is consumed by this follow-up Lotta check
      if (followUpBonus > 0) await grapplerCombatant.unsetFlag("sword", "grappleFollowUpBonus");
    }

    const chatData = {
      actorName: actor.name,
      actorImg: actor.img,
      targetName: targetActor.name,
      isCreature: true,
      skillLabel,
      lockDifficulty,
      finalSuccesses: lockSuccesses,
      followUpBonus,
      passed,
      isLock: true
    };

    // Consume standard action
    await game.combat.consumeAction(actor);

    const html = await renderTemplate(
      "systems/sword/templates/chat/grapple-result.hbs",
      chatData
    );
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: html
    });
    return;
  }

  // Character: Lotta skill check
  const skillData = system.skills[skillId];
  if (!skillData) {
    ui.notifications.error(`Abilità non trovata: ${skillId}`);
    return;
  }

  const charKey = SKILL_MAP[skillId];
  const charScore = system.effectiveCharacteristics?.[charKey] ?? system.characteristics[charKey];

  const grade = skillData.grade;
  const extraDice = skillData.extraDice;  // focus dice selected contextually in dialog
  const isUntrained = grade === 0 && extraDice === 0;
  const allFoci = collectAllFoci(system);

  // Penalties
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const equippedArmor = Array.from(actor.items).find(i => i.type === "armor");
  const armorPenalty = equippedArmor
    ? armorSkillPenalty(equippedArmor.system.protezione || 0, equippedArmor.system.pregi || [], skillId)
    : 0;
  const basePenalty = fatiguePenalty + woundPenalty + encumbrancePenalty + armorPenalty;
  const spirito = system.resources.spirito;

  const penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value);

  const lockDifficulty = 3; // Lock sfida threshold (errata §5.6)

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${game.i18n.localize("SWORD.Combat.GrappleLock")}</strong> → ${targetActor.name}</p>
      <p class="hint">${skillLabel} (${charScore}), ${game.i18n.localize("SWORD.Grade")}: ${grade}</p>
      <p class="hint">${game.i18n.localize("SWORD.Chat.DifficultyThreshold")}: ${lockDifficulty}</p>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
      </div>
      ${penaltyHtml}
      ${buildFocusDialogHtml(allFoci)}
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.Combat.GrappleLock")} — ${actor.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-lock",
      callback: (event, button) => ({
        diceCount: parseInt(button.form.elements.diceCount.value) || 2,
        spiritoCancelPenalty: parseInt(button.form.elements.spiritoCancelPenalty?.value) || 0,
        focusDice: countSelectedFoci(button.form, allFoci.length)
      })
    }
  });

  if (!result) return;

  let { diceCount, spiritoCancelPenalty, focusDice } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
  spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);

  const effectivePenalty = basePenalty - spiritoCancelPenalty;
  const totalExtraDice = extraDice + focusDice;
  const totalDice = diceCount + totalExtraDice;

  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  const engineOutput = swordCheckResolve({
    characteristicScore: charScore,
    diceCount,
    grade,
    extraDice: totalExtraDice,
    successBonus: followUpBonus,
    successPenalty: effectivePenalty,
    difficultyThreshold: lockDifficulty,
    opposedSuccesses: null,
    diceRolled,
    discardIndices: null
  });

  const passed = engineOutput.basePassed && engineOutput.difficultyPassed;

  // Deduct spirito
  const updateData = {};
  if (spiritoCancelPenalty > 0) {
    updateData["system.resources.spirito.value"] = spirito.value - spiritoCancelPenalty;
  }
  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Store lock successes for Break Free difficulty (finalSuccesses already includes the
  // accumulated grab bonus via successBonus); consume the grab bonus.
  if (grapplerCombatant) {
    if (passed) await grapplerCombatant.setFlag("sword", "lockSuccesses", engineOutput.finalSuccesses);
    if (followUpBonus > 0) await grapplerCombatant.unsetFlag("sword", "grappleFollowUpBonus");
  }

  // Consume standard action
  await game.combat.consumeAction(actor);

  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    targetName: targetActor.name,
    isCreature: false,
    skillLabel,
    lockDifficulty,
    ...engineOutput,
    followUpBonus,
    diceAfterReductionDisplay: engineOutput.diceAfterReduction.map(d => ({
      value: d, isOne: d === 1
    })),
    passed,
    isLock: true,
    hasPenalty: basePenalty > 0,
    fatiguePenalty,
    woundPenalty,
    encumbrancePenalty,
    armorPenalty,
    penaltyCancelled: spiritoCancelPenalty,
    effectivePenalty
  };

  const html = await renderTemplate(
    "systems/sword/templates/chat/grapple-result.hbs",
    chatData
  );

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}

/**
 * Execute a Break Free (Liberarsi) attempt.
 * @param {Actor} actor - The locked/grappled actor
 */
export async function swordBreakFree(actor) {
  const system = actor.system;
  const isCreature = actor.type === "creature";

  // Validate: must be in combat and grappled
  if (!game.combat) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoCombat"));
    return;
  }

  const grappleState = game.combat.getGrappleLock(actor);
  if (!grappleState || grappleState.role !== "grappled") {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.GrappleNotGrappled"));
    return;
  }

  // Action economy gate
  if (!game.combat.hasActionAvailable(actor)) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoActionAvailable"));
      return;
    }
    ui.notifications.info(game.i18n.localize("SWORD.Combat.GMActionOverride"));
  }

  // opponentId is a canonical combat key (token id first) — resolve via combat
  const grapplerActorId = grappleState.opponentId;
  const grapplerCombatant = game.combat.resolveCombatant(grapplerActorId);
  const grapplerActor = grapplerCombatant?.actor ?? game.actors.get(grapplerActorId);
  const lockSuccesses = grapplerCombatant?.getFlag("sword", "lockSuccesses") ?? 2;
  const breakDifficulty = computeLockBreakDifficulty(lockSuccesses);

  const skillId = "forza";
  const skillLabel = game.i18n.localize("SWORD.Skills.forza");

  if (isCreature) {
    // Creature: fixed forza
    const fixedSuccesses = system.abilities?.forza ?? 0;
    const fatiguePenalty = system.fatiguePenalty || 0;
    const woundPenalty = system.woundPenalty || 0;
    const basePenalty = fatiguePenalty + woundPenalty;
    const effectiveSuccesses = Math.max(0, fixedSuccesses - basePenalty);

    const passed = effectiveSuccesses >= breakDifficulty;

    if (passed) {
      await game.combat.clearGrappleLock(actor);
    }

    // Consume standard action
    await game.combat.consumeAction(actor);

    const chatData = {
      actorName: actor.name,
      actorImg: actor.img,
      targetName: grapplerActor?.name ?? "???",
      isCreature: true,
      skillLabel,
      breakDifficulty,
      finalSuccesses: effectiveSuccesses,
      passed,
      isLock: false
    };

    const html = await renderTemplate(
      "systems/sword/templates/chat/grapple-result.hbs",
      chatData
    );
    await ChatMessage.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: html
    });
    return;
  }

  // Character: Forza skill check
  const skillData = system.skills[skillId];
  if (!skillData) {
    ui.notifications.error(`Abilità non trovata: ${skillId}`);
    return;
  }

  const charKey = SKILL_MAP[skillId];
  const charScore = system.effectiveCharacteristics?.[charKey] ?? system.characteristics[charKey];

  const grade = skillData.grade;
  const extraDice = skillData.extraDice;  // focus dice selected contextually in dialog
  const isUntrained = grade === 0 && extraDice === 0;
  const allFoci = collectAllFoci(system);

  // Penalties
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const equippedArmor = Array.from(actor.items).find(i => i.type === "armor");
  const armorPenalty = equippedArmor
    ? armorSkillPenalty(equippedArmor.system.protezione || 0, equippedArmor.system.pregi || [], skillId)
    : 0;
  const basePenalty = fatiguePenalty + woundPenalty + encumbrancePenalty + armorPenalty;
  const spirito = system.resources.spirito;

  const penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value);

  const dialogContent = `
    <div class="sword-roll-dialog">
      <p><strong>${game.i18n.localize("SWORD.Combat.BreakFree")}</strong> vs. ${grapplerActor?.name ?? "???"}</p>
      <p class="hint">${skillLabel} (${charScore}), ${game.i18n.localize("SWORD.Grade")}: ${grade}</p>
      <p class="hint">${game.i18n.localize("SWORD.Chat.DifficultyThreshold")}: ${breakDifficulty}</p>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
      </div>
      ${penaltyHtml}
      ${buildFocusDialogHtml(allFoci)}
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("SWORD.Combat.BreakFree")} — ${actor.name}` },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Submit"),
      icon: "fa-solid fa-unlock",
      callback: (event, button) => ({
        diceCount: parseInt(button.form.elements.diceCount.value) || 2,
        spiritoCancelPenalty: parseInt(button.form.elements.spiritoCancelPenalty?.value) || 0,
        focusDice: countSelectedFoci(button.form, allFoci.length)
      })
    }
  });

  if (!result) return;

  let { diceCount, spiritoCancelPenalty, focusDice } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);
  spiritoCancelPenalty = Math.min(spiritoCancelPenalty, spirito.value);

  const effectivePenalty = basePenalty - spiritoCancelPenalty;
  const totalExtraDice = extraDice + focusDice;
  const totalDice = diceCount + totalExtraDice;

  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  const engineOutput = swordCheckResolve({
    characteristicScore: charScore,
    diceCount,
    grade,
    extraDice: totalExtraDice,
    successBonus: 0,
    successPenalty: effectivePenalty,
    difficultyThreshold: breakDifficulty,
    opposedSuccesses: null,
    diceRolled,
    discardIndices: null
  });

  const passed = engineOutput.basePassed && engineOutput.difficultyPassed;

  // Deduct spirito
  const updateData = {};
  if (spiritoCancelPenalty > 0) {
    updateData["system.resources.spirito.value"] = spirito.value - spiritoCancelPenalty;
  }
  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Clear grapple on success
  if (passed) {
    await game.combat.clearGrappleLock(actor);
  }

  // Consume standard action
  await game.combat.consumeAction(actor);

  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    targetName: grapplerActor?.name ?? "???",
    isCreature: false,
    skillLabel,
    breakDifficulty,
    ...engineOutput,
    diceAfterReductionDisplay: engineOutput.diceAfterReduction.map(d => ({
      value: d, isOne: d === 1
    })),
    passed,
    isLock: false,
    hasPenalty: basePenalty > 0,
    fatiguePenalty,
    woundPenalty,
    encumbrancePenalty,
    armorPenalty,
    penaltyCancelled: spiritoCancelPenalty,
    effectivePenalty
  };

  const html = await renderTemplate(
    "systems/sword/templates/chat/grapple-result.hbs",
    chatData
  );

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}
