import { CharacterDataModel } from "./data/actor.mjs";
import { CreatureDataModel } from "./data/creature.mjs";
import { WeaponDataModel, ShieldDataModel, ArmorDataModel, GearDataModel } from "./data/item.mjs";
import { SwordCharacterSheet } from "./sheets/character-sheet.mjs";
import { SwordCreatureSheet } from "./sheets/creature-sheet.mjs";
import { SwordItemSheet } from "./sheets/item-sheet.mjs";
import { SwordCombat } from "./documents/sword-combat-doc.mjs";
import { SwordCombatTracker } from "./apps/sword-combat-tracker.mjs";
import { swordRoll } from "./rolls/sword-roll.mjs";
import { swordAttack } from "./rolls/sword-attack.mjs";
import { swordDefend } from "./rolls/sword-defense.mjs";
import { swordRifiatare } from "./rolls/sword-rifiatare.mjs";
import { swordAttesa } from "./rolls/sword-attesa.mjs";
import { swordStudyBattlefield } from "./rolls/sword-study-battlefield.mjs";
import { swordCloseMisura } from "./rolls/sword-close-misura.mjs";
import { swordReaction } from "./rolls/sword-reaction.mjs";
import { swordSurprise } from "./rolls/sword-surprise.mjs";
import { swordGrappleLock, swordBreakFree } from "./rolls/sword-break-free.mjs";
import { SWORD_STATUS_EFFECTS, syncActorStatuses } from "./statuses/sword-statuses.mjs";
import { distributeWounds } from "./engine.mjs";

Hooks.once("init", () => {
  console.log("SwORD | Initializing Il Tempo della Spada system");

  // Register Actor data models
  CONFIG.Actor.dataModels.character = CharacterDataModel;
  CONFIG.Actor.dataModels.creature = CreatureDataModel;

  // Register Item data models
  CONFIG.Item.dataModels.weapon = WeaponDataModel;
  CONFIG.Item.dataModels.shield = ShieldDataModel;
  CONFIG.Item.dataModels.armor = ArmorDataModel;
  CONFIG.Item.dataModels.gear = GearDataModel;

  // Register custom Combat document (Riflessi-based initiative)
  CONFIG.Combat.documentClass = SwordCombat;

  // Register custom Combat Tracker sidebar (action counter badge)
  CONFIG.ui.combat = SwordCombatTracker;

  // Register character sheet
  foundry.documents.collections.Actors.registerSheet("sword", SwordCharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "SWORD.Sheet.Character"
  });

  // Register creature sheet
  foundry.documents.collections.Actors.registerSheet("sword", SwordCreatureSheet, {
    types: ["creature"],
    makeDefault: true,
    label: "SWORD.Sheet.Creature"
  });

  // Register item sheet
  foundry.documents.collections.Items.registerSheet("sword", SwordItemSheet, {
    types: ["weapon", "shield", "armor", "gear"],
    makeDefault: true,
    label: "SWORD.Item.Label"
  });

  // Replace default status effects with SwORD-specific statuses.
  // Mutate in place: on v14 CONFIG.statusEffects is a Proxy that maintains
  // the string-id lookup used by Actor#toggleStatusEffect — replacing it
  // with a plain array breaks every status toggle.
  CONFIG.statusEffects.length = 0;
  for (const status of SWORD_STATUS_EFFECTS) CONFIG.statusEffects.push(status);
  CONFIG.specialStatusEffects.DEFEATED = "morto";

  // Expose API for macros
  game.sword = {
    rollCheck: swordRoll,
    attack: swordAttack,
    defend: swordDefend,
    rifiatare: swordRifiatare,
    attesa: swordAttesa,
    studyBattlefield: swordStudyBattlefield,
    closeMisura: swordCloseMisura,
    reaction: swordReaction,
    surprise: swordSurprise,
    grappleLock: swordGrappleLock,
    breakFree: swordBreakFree
  };
});

// Process round start: tempismo recovery, attesa, initiative refresh, reloads, actions, bleeding
Hooks.on("combatRound", (combat, updateData, updateOptions) => {
  // Run once, on the GM's client: the hook fires on whichever client advances
  // the round, and players lack permission to update other combatants/actors.
  if (!game.users.activeGM?.isSelf) return;
  // Forward advancement only — rewinding a round must not re-apply
  // bleeding, reload decrements, or Tempismo recovery.
  if (updateOptions?.direction !== 1) return;
  // Tempismo: +1 Riflessi recovery at round start (before initiative refresh)
  for (const combatant of combat.combatants) {
    if (!combatant?.actor) continue;
    const actor = combatant.actor;
    if (actor.type === "creature") continue; // creatures don't have talents
    if (!actor.system.talentSpecials?.has("win_ties_riflessi_recovery_extra_action")) continue;
    const riflessi = actor.system.resources.riflessi;
    if (riflessi.value < riflessi.max) {
      actor.update({ "system.resources.riflessi.value": Math.min(riflessi.max, riflessi.value + 1) });
    }
  }

  combat.refreshInitiative();
  combat.decrementReloads();
  combat.resetRoundActions();
  combat.resetStrategaPool();

  // Attesa: recover all Riflessi for waiting combatants
  for (const combatant of combat.combatants) {
    if (!combatant?.actor) continue;
    if (!combatant.getFlag("sword", "isWaiting")) continue;
    const actor = combatant.actor;
    const riflessi = actor.system.resources.riflessi;
    if (riflessi.value < riflessi.max) {
      actor.update({ "system.resources.riflessi.value": riflessi.max });
      ChatMessage.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p><i class="fas fa-hourglass-end"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Combat.AttesaRecovery")}</p>`
      });
    }
    // Rango recovery: restore to full on attesa (PDF lines 5292-5293)
    if (actor.type === "creature" && actor.system.rango > 0) {
      combatant.setFlag("sword", "rangoRemaining", actor.system.rango);
    }
    combatant.unsetFlag("sword", "isWaiting");
  }

  // Surprise: clear isSurprised flags after round 1 (only affects first round)
  for (const combatant of combat.combatants) {
    if (!combatant) continue;
    if (combatant.getFlag("sword", "isSurprised")) {
      combatant.unsetFlag("sword", "isSurprised");
    }
  }

  // Close Misura: reset cumulative attempts each round
  // Sword mastery: reset free parry each round
  for (const combatant of combat.combatants) {
    if (!combatant) continue;
    if (combatant.getFlag("sword", "closeMisuraAttempts")) {
      combatant.unsetFlag("sword", "closeMisuraAttempts");
    }
    if (combatant.getFlag("sword", "usedFreeSwordParry")) {
      combatant.unsetFlag("sword", "usedFreeSwordParry");
    }
    if (combatant.getFlag("sword", "usedExtraAttack3Riflessi")) {
      combatant.unsetFlag("sword", "usedExtraAttack3Riflessi");
    }
    if (combatant.getFlag("sword", "usedTempismoAction")) {
      combatant.unsetFlag("sword", "usedTempismoAction");
    }
    if (combatant.getFlag("sword", "lastRangedTarget")) {
      combatant.unsetFlag("sword", "lastRangedTarget");
    }
    if (combatant.getFlag("sword", "usedFreeGrapple")) {
      combatant.unsetFlag("sword", "usedFreeGrapple");
    }
    if (combatant.getFlag("sword", "usedReserveThisTurn")) {
      combatant.unsetFlag("sword", "usedReserveThisTurn");
    }
  }

  // Bleeding: lose 1 Fatica per round, auto-stop after 12 turns
  for (const combatant of combat.combatants) {
    if (!combatant?.actor) continue;
    const actor = combatant.actor;
    if (!actor.statuses.has("sanguinamento")) continue;

    const fatica = actor.system.resources.fatica;
    if (fatica.value > 0) {
      actor.update({ "system.resources.fatica.value": fatica.value - 1 });
      ChatMessage.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p><i class="fas fa-tint"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Status.BleedingFatica")}</p>`
      });
    } else {
      // Fatigue exhausted: bleeding overflow → 1 wound (halved by Vitalità)
      let overflowWounds = 1;
      if (actor.system.talentSpecials?.has("halve_excess_fatica_wounds")) {
        overflowWounds = Math.ceil(overflowWounds / 2); // 1 → 1 (ceil), but future-proofs for multi-loss
      }
      const wl = actor.system.woundLevels;
      const caps = actor.system.woundCapacities;
      const newWounds = distributeWounds(wl, caps, overflowWounds);
      actor.update({
        "system.woundLevels.graffi": newWounds.graffi,
        "system.woundLevels.leggere": newWounds.leggere,
        "system.woundLevels.gravi": newWounds.gravi,
        "system.woundLevels.critiche": newWounds.critiche,
        "system.woundLevels.mortali": newWounds.mortali
      });
      ChatMessage.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p><i class="fas fa-tint"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Status.BleedingWound")}</p>`
      });
    }

    const turns = actor.getFlag("sword", "bleedingTurns") ?? 0;
    if (turns + 1 >= 12) {
      actor.toggleStatusEffect("sanguinamento", { active: false });
      actor.unsetFlag("sword", "bleedingTurns");
      ChatMessage.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p><i class="fas fa-band-aid"></i> <strong>${actor.name}</strong> — ${game.i18n.localize("SWORD.Status.BleedingStabilized")}</p>`
      });
    } else {
      actor.setFlag("sword", "bleedingTurns", turns + 1);
    }
  }
});

// Araldo: companions_reaction_resolve_bonus hint at combat start
// (combatRound fires before the round increments, so a round===1 check there
// only matched the 1→2 transition and never the actual start of combat)
Hooks.on("combatStart", (combat) => {
  if (!game.users.activeGM?.isSelf) return;
  for (const combatant of combat.combatants) {
    const a = combatant.actor;
    if (!a || a.type === "creature") continue;
    if (a.system.talentSpecials?.has("companions_reaction_resolve_bonus")) {
      ChatMessage.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor: a }),
        content: `<div class="sword chat-card"><div class="result-section"><div class="damage-line"><i class="fas fa-flag"></i> <strong>${a.name}</strong> — ${game.i18n.localize("SWORD.Talent.AraldoHint")}</div></div></div>`
      });
      break; // Only one hint per combat
    }
  }
});

// Refresh initiative mid-round when Riflessi change (errata §4.6 line 2128)
Hooks.on("updateActor", (actor, changes) => {
  // GM client only: this fires on every client for every actor update, and
  // non-owners' combatant.update calls fail with permission errors.
  if (!game.users.activeGM?.isSelf) return;
  if (!game.combat) return;
  if (foundry.utils.getProperty(changes, "system.resources.riflessi.value") === undefined) return;
  // Match by uuid: a synthetic token actor matches its own token's combatant,
  // a linked actor matches every one of its tokens' combatants.
  const newRiflessi = actor.system.resources.riflessi.value;
  for (const combatant of game.combat.combatants) {
    if (combatant.actor?.uuid !== actor.uuid) continue;
    if (combatant.initiative !== newRiflessi) {
      combatant.update({ initiative: newRiflessi });
    }
  }
});

// Duellante: modify_misura_on_riflessi_loss — detect Riflessi decrease, prompt engaged Duellanti
Hooks.on("preUpdateActor", (actor, changes) => {
  if (!game.combat || !game.user.isGM) return;
  const newRiflessi = foundry.utils.getProperty(changes, "system.resources.riflessi.value");
  if (newRiflessi === undefined) return;
  const oldRiflessi = actor.system.resources.riflessi.value;
  if (newRiflessi >= oldRiflessi) return; // only on decrease

  // Find combatants with modify_misura_on_riflessi_loss engaged with this actor
  const loserKey = game.combat.combatKey(actor);
  if (!loserKey) return;
  for (const combatant of game.combat.combatants) {
    const a = combatant.actor;
    if (!a) continue;
    if ((combatant.tokenId ?? combatant.actorId) === loserKey) continue;
    if (!a.system.talentSpecials?.has("modify_misura_on_riflessi_loss")) continue;
    // Check engagement (keyed by canonical combat key)
    const engagements = combatant.getFlag("sword", "engagements") ?? {};
    if (!engagements[loserKey]) continue;
    // Schedule prompt after update completes (non-blocking)
    const currentMisura = engagements[loserKey];
    const duellanteName = a.name;
    const loserName = actor.name;
    const duellanteCombatantId = combatant.id;
    setTimeout(() => _promptDuellanteMisura(duellanteCombatantId, loserKey, currentMisura, duellanteName, loserName), 100);
  }
});

async function _promptDuellanteMisura(duellanteCombatantId, loserKey, currentMisura, duellanteName, loserName) {
  if (!game.combat) return;
  const misuraOptions = ["LL", "L", "M", "S", "A"]
    .filter(m => m !== currentMisura)
    .map(m => `<option value="${m}">${game.i18n.localize(`SWORD.Combat.Misura.${m}`)}</option>`)
    .join("");

  const content = `
    <div class="sword-roll-dialog">
      <p><strong>${duellanteName}</strong> — ${game.i18n.localize("SWORD.Duellante.Prompt").replace("{target}", loserName)}</p>
      <div class="form-group">
        <label><input type="radio" name="duellanteChoice" value="misura" checked /> ${game.i18n.localize("SWORD.Duellante.ChangeMisura")}</label>
        <select name="newMisura">${misuraOptions}</select>
      </div>
      <div class="form-group">
        <label><input type="radio" name="duellanteChoice" value="withdraw" /> ${game.i18n.localize("SWORD.Duellante.Withdraw")}</label>
      </div>
      <div class="form-group">
        <label><input type="radio" name="duellanteChoice" value="none" /> ${game.i18n.localize("SWORD.Duellante.DoNothing")}</label>
      </div>
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${duellanteName} — ${game.i18n.localize("SWORD.Duellante.Title")}` },
    content,
    ok: {
      label: game.i18n.localize("SWORD.Roll.Confirm"),
      callback: (event, button) => {
        const form = button.form;
        return {
          choice: form.elements.duellanteChoice.value,
          newMisura: form.elements.newMisura.value
        };
      }
    }
  });

  if (!result || result.choice === "none" || !game.combat) return;

  const duellanteCombatant = game.combat.combatants.get(duellanteCombatantId);
  if (!duellanteCombatant) return;
  const speaker = ChatMessage.implementation.getSpeaker({ actor: duellanteCombatant.actor });

  if (result.choice === "misura") {
    await game.combat.setEngagementMisura(duellanteCombatant, loserKey, result.newMisura);
    const misuraLabel = game.i18n.localize(`SWORD.Combat.Misura.${result.newMisura}`);
    await ChatMessage.create({
      speaker,
      content: `<div class="sword chat-card"><div class="result-section"><div class="damage-line"><i class="fas fa-arrows-left-right"></i> <strong>${duellanteName}</strong> ${game.i18n.localize("SWORD.Duellante.ChangedMisura").replace("{misura}", misuraLabel)}</div></div></div>`
    });
  } else if (result.choice === "withdraw") {
    // Remove engagement (both directions)
    await game.combat.clearEngagement(duellanteCombatant, loserKey);
    await ChatMessage.create({
      speaker,
      content: `<div class="sword chat-card"><div class="result-section"><div class="damage-line"><i class="fas fa-person-running"></i> <strong>${duellanteName}</strong> ${game.i18n.localize("SWORD.Duellante.Withdrew")}</div></div></div>`
    });
  }
}

// New characters start rested: countdown resources initialize at their
// derived maxima when the creation data didn't set them (the wizard and
// JSON imports set their own values, which win over this default).
Hooks.on("createActor", (actor, options, userId) => {
  if (game.user.id !== userId) return;
  if (actor.type !== "character") return;
  const src = actor._source.system?.resources;
  if (!src) return;
  if (src.fatica.value === 0 && src.spirito.value === 0 && src.riflessi.value === 0) {
    const r = actor.system.resources;
    actor.update({
      "system.resources.fatica.value": r.fatica.max,
      "system.resources.spirito.value": r.spirito.max,
      "system.resources.riflessi.value": r.riflessi.max
    });
  }
});

// Clear lingering actor/item state when combat ends.
// Combatant flags are NOT touched here: they live inside the deleted Combat
// document, so writing to them after deletion makes the server reject with
// "The Combat <id> does not exist in combats" — and they are deleted along
// with the combat anyway. Only documents outside the combat need cleanup.
Hooks.on("deleteCombat", (combat) => {
  // GM client only: the hook fires on every client, and non-owners' updates
  // would fail with permission errors.
  if (!game.users.activeGM?.isSelf) return;
  for (const combatant of combat.combatants) {
    if (!combatant?.actor) continue;
    for (const item of combatant.actor.items) {
      if (item.type === "weapon" && item.system.reloadTurnsRemaining > 0) {
        item.update({ "system.reloadTurnsRemaining": 0 });
      }
    }
    // Clear bleeding turn counter
    if (combatant.actor.getFlag("sword", "bleedingTurns") !== undefined) {
      combatant.actor.unsetFlag("sword", "bleedingTurns");
    }
    // Clear fear level flag
    if (combatant.actor.getFlag("sword", "fearLevel") !== undefined) {
      combatant.actor.unsetFlag("sword", "fearLevel");
    }
  }
});

// Auto-sync status effects when wound levels, fatica, or riflessi change
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (game.user.id !== userId) return;
  const flat = foundry.utils.flattenObject(changes);
  const needsSync = Object.keys(flat).some(p =>
    p.startsWith("system.woundLevels") ||
    p.startsWith("system.resources.fatica") ||
    p.startsWith("system.resources.riflessi")
  );
  if (needsSync) {
    // Defer so prepareDerivedData() completes before we read fatigueLevel etc.
    setTimeout(() => syncActorStatuses(actor), 0);
  }
});

// Auto-resolve creature Forza reactions for disarm/push attacks
Hooks.on("createChatMessage", async (message) => {
  if (!game.user.isGM) return;
  const attackData = message.flags?.sword?.attack;
  if (!attackData) return;
  const { specialMove, targetActorId, targetTokenId, effectiveAttackHit } = attackData;
  if (!effectiveAttackHit) return;
  if (specialMove !== "disarm" && specialMove !== "push") return;

  // Resolve target actor (token first for unlinked actors)
  let actor;
  if (targetTokenId) {
    const token = canvas.tokens?.get(targetTokenId);
    if (token?.actor) actor = token.actor;
  }
  if (!actor && targetActorId) actor = game.actors.get(targetActorId);
  if (!actor || actor.type !== "creature") return;

  // Auto-resolve the Forza reaction for the creature
  await swordDefend(actor, message.id, "reactionForza");
});

// Attach defend button listeners to attack chat cards
Hooks.on("renderChatMessage", (message, html) => {
  // Normalize html: Foundry may pass jQuery or native HTMLElement
  const element = html instanceof HTMLElement ? html : html[0] ?? html;
  element.querySelectorAll("[data-action='defend-parata'], [data-action='defend-parata-accompagnata'], [data-action='defend-schivata'], [data-action='defend-reaction-forza'], [data-action='defend-contrattacco'], [data-action='defend-disarmo-difensivo']")
    .forEach(btn => btn.addEventListener("click", async (ev) => {
      const action = ev.currentTarget.dataset.action;
      const defenseType = action.includes("parata-accompagnata") ? "parataAccompagnata"
        : action.includes("contrattacco") ? "contrattacco"
        : action.includes("disarmo-difensivo") ? "disarmoDifensivo"
        : action.includes("parata") ? "parata"
        : action.includes("reaction-forza") ? "reactionForza"
        : "schivata";

      // Try to resolve defender from target flag
      const attackFlags = message.flags?.sword?.attack;
      const targetTokenId = attackFlags?.targetTokenId;
      const targetActorId = attackFlags?.targetActorId;
      let actor;

      // First try canvas token (handles unlinked/synthetic tokens)
      if (targetTokenId) {
        const token = canvas.tokens?.get(targetTokenId);
        if (token?.actor) actor = token.actor;
      }

      // Then try world actor collection (handles linked tokens if canvas token gone)
      if (!actor && targetActorId) {
        actor = game.actors.get(targetActorId);
      }

      // Ownership check
      if (actor && !actor.isOwner && !game.user.isGM) {
        ui.notifications.warn(game.i18n.localize("SWORD.Combat.SelectToken"));
        return;
      }

      // Fallback to selected token / user character
      if (!actor) {
        actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character;
      }

      if (!actor) {
        ui.notifications.warn(game.i18n.localize("SWORD.Combat.SelectToken"));
        return;
      }
      await swordDefend(actor, message.id, defenseType);
    }));

  // Wound Forza reaction button (defense chat card)
  element.querySelectorAll("[data-action='reaction-ferite']")
    .forEach(btn => btn.addEventListener("click", async (ev) => {
      const el = ev.currentTarget;
      const actorId = el.dataset.actorId;
      const tokenId = el.dataset.tokenId;
      const threat = parseInt(el.dataset.threat) || 3;
      // Token first: wounds were applied to the (possibly unlinked) token actor
      const actor = (tokenId ? canvas.tokens?.get(tokenId)?.actor : null)
        ?? game.actors.get(actorId);
      if (!actor) {
        ui.notifications.warn(game.i18n.localize("SWORD.Combat.SelectToken"));
        return;
      }
      await swordReaction(actor, { reactionType: "ferite", threatSuccesses: threat });
    }));

  // Grapple Free Strike button (defense chat card)
  element.querySelectorAll("[data-action='grapple-free-strike']")
    .forEach(btn => btn.addEventListener("click", async (ev) => {
      const el = ev.currentTarget;
      const attackerActorId = el.dataset.attackerActorId;
      const bonus = parseInt(el.dataset.bonus) || 0;
      // attackerActorId is a canonical combat key (token id first)
      const actor = game.combat?.resolveCombatant(attackerActorId)?.actor
        ?? game.actors.get(attackerActorId);
      if (!actor) {
        ui.notifications.warn(game.i18n.localize("SWORD.Combat.SelectToken"));
        return;
      }
      // Free strike: unarmed punch with grapple bonus (stored in flag for attack flow to consume)
      // The bonus is already accounted for via GRAPPLE_FREE_STRIKE_BONUS in the attack flow when grappled
      await swordAttack(actor, "unarmed_punch");
      el.disabled = true;
    }));

  // Grapple Lock button (defense chat card)
  element.querySelectorAll("[data-action='grapple-lock']")
    .forEach(btn => btn.addEventListener("click", async (ev) => {
      const el = ev.currentTarget;
      const attackerActorId = el.dataset.attackerActorId;
      const defenderActorId = el.dataset.defenderActorId;
      // attackerActorId is a canonical combat key (token id first)
      const actor = game.combat?.resolveCombatant(attackerActorId)?.actor
        ?? game.actors.get(attackerActorId);
      if (!actor) {
        ui.notifications.warn(game.i18n.localize("SWORD.Combat.SelectToken"));
        return;
      }
      // Lock attempt via Grapple Lock action
      await swordGrappleLock(actor, { lockTarget: defenderActorId });
      el.disabled = true;
    }));

  // Lottatore: free grapple after unarmed attack/defense (costs 1 Fatica)
  element.querySelectorAll("[data-action='free-grapple']")
    .forEach(btn => btn.addEventListener("click", async (ev) => {
      const el = ev.currentTarget;
      const actorId = el.dataset.actorId;
      const actorTokenId = el.dataset.actorTokenId;
      const targetActorId = el.dataset.targetActorId;
      const targetTokenId = el.dataset.targetTokenId;
      // Token first: synthetic token actors share the base actor id
      const actor = (actorTokenId ? canvas.tokens?.get(actorTokenId)?.actor : null)
        ?? game.actors.get(actorId);
      if (!actor) return;
      if (!game.combat) return;
      const combatant = game.combat.resolveCombatant(actorTokenId || actorId);
      if (!combatant || combatant.getFlag("sword", "usedFreeGrapple")) {
        ui.notifications.warn("Abrazzar gratuito già usato in questo turno.");
        return;
      }
      // Spend 1 Fatica (countdown: spending decrements the value)
      if (actor.system.resources.fatica.value <= 0) {
        ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoFatica"));
        return;
      }
      await actor.update({
        "system.resources.fatica.value": Math.max(0, actor.system.resources.fatica.value - 1)
      });
      // Mark as used this turn
      await combatant.setFlag("sword", "usedFreeGrapple", true);
      el.disabled = true;
      // Set target for the grapple attack
      const targetToken = targetTokenId ? canvas.tokens?.get(targetTokenId) : null;
      if (targetToken) targetToken.setTarget(true, { releaseOthers: true });
      // Launch grapple attack without consuming action (freeGrapple flag)
      await swordAttack(actor, "unarmed_punch", { freeGrapple: true });
    }));

  // Close Misura button (defense chat card)
  element.querySelectorAll("[data-action='close-misura']")
    .forEach(btn => btn.addEventListener("click", async (ev) => {
      const el = ev.currentTarget;
      const defenderActorId = el.dataset.defenderActorId;
      const attackerActorId = el.dataset.attackerActorId;
      const newMisura = el.dataset.newMisura;
      if (!game.combat || !defenderActorId || !attackerActorId || !newMisura) return;
      await game.combat.setEngagementMisura(defenderActorId, attackerActorId, newMisura);
      const misuraLabel = game.i18n.localize(`SWORD.Combat.Misura.${newMisura}`);
      ui.notifications.info(game.i18n.format("SWORD.Combat.MisuraChanged", { misura: misuraLabel }));
      el.disabled = true;
      el.textContent = game.i18n.localize("SWORD.Combat.MisuraClosed");
    }));
});
