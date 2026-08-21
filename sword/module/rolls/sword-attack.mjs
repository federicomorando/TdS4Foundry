/**
 * Attack adapter: dialog → Foundry Roll → engine → chat card with Defend buttons.
 *
 * Reads weapon data from actor inventory, runs a standard skill check via
 * swordCheckResolve, then posts a chat card with embedded attack flags for
 * the defense flow to consume.
 *
 * Supports melee and ranged attacks (gittata > 0 = ranged).
 * Includes approach modifier selection (Prudente/Corsa/Carica).
 * Phase 3: Misura management + 5 special melee moves.
 */
import {
  computeTalentCombatBonus, computeMisuraPenalty,
  MISURA_ORDER, initialEngagementMisura, isFuoriMisura,
  UNARMED_STRIKES, computeDaCavalloWeaponBonus
} from "../engine.mjs";
import { SKILL_MAP, SOCIAL_SKILLS } from "../data/actor.mjs";
import { armorSkillPenalty, weaponQualityBonus } from "../engine.mjs";
import { collectAllFoci, buildFocusDialogHtml, countSelectedFoci } from "./focus-helper.mjs";
import { VALORE_KEYS, APPROACH_MODS, CREATURE_MISURA_MAP } from "../engine.mjs";
import { resolveAttack } from "../engine.mjs";
import {
  buildPenaltyParts, buildPenaltyHtml, buildValoreSelectHtml,
  buildFamaHtml, buildCombinedSkillOptions, buildCombinedManeuverHtml,
  buildCombatApproachHtml, formInt, formStr, formBool
} from "./dialog-helpers.mjs";
import { _attackCreature } from "./sword-attack-creature.mjs";

/**
 * Get the primary melee misura for a defender.
 * Characters: longest equipped melee weapon. Creatures: first attack's misura.
 * Returns engine code ("LL","L","M","S","A") or "M" as default.
 */
function _getDefenderPrimaryMisura(targetActor) {
  if (!targetActor) return "M";

  if (targetActor.type === "creature") {
    const attacks = targetActor.system.attacks || [];
    for (const atk of attacks) {
      if (!atk.misura) continue;
      // Creature misura is Italian label — map to code
      return CREATURE_MISURA_MAP[atk.misura] ?? "M";
    }
    return "M";
  }

  // Character: find longest melee weapon
  let bestIdx = MISURA_ORDER.length; // start past end
  for (const item of targetActor.items) {
    if (item.type !== "weapon") continue;
    if (item.system.gittata > 0) continue; // skip ranged
    const m = item.system.misura;
    if (!m) continue;
    const idx = MISURA_ORDER.indexOf(m);
    if (idx >= 0 && idx < bestIdx) bestIdx = idx;
  }
  return bestIdx < MISURA_ORDER.length ? MISURA_ORDER[bestIdx] : "M";
}

/**
 * Initiate an attack from a character with a specific weapon.
 * @param {Actor} actor - The attacking actor
 * @param {string} weaponItemId - The Item ID of the weapon in actor's inventory
 */
export async function swordAttack(actor, weaponItemId, options = {}) {
  // --- Target selection (optional) ---
  const targets = game.user.targets;
  let targetActorId = null;
  let targetTokenId = null;
  let targetName = null;
  let targetSenzaFiato = false;
  let targetActor = null;
  let targetSizeCategory = "media";
  if (targets.size) {
    const targetToken = targets.first();
    targetActor = targetToken.actor;
    if (targetActor) {
      targetActorId = targetActor.id;
      targetTokenId = targetToken.document?.id ?? targetToken.id;
      targetName = targetActor.name;
      targetSenzaFiato = targetActor.statuses?.has("senza-fiato") ?? false;
      targetSizeCategory = targetActor.system.sizeCategory || "media";
    }
  }

  // Virtual weapon support: unarmed_punch, unarmed_kick
  let weapon, isUnarmed = false;
  if (weaponItemId?.startsWith("unarmed_")) {
    const strikeKey = weaponItemId.replace("unarmed_", "");
    const strike = UNARMED_STRIKES[strikeKey];
    if (!strike) { ui.notifications.error("Tipo di percussione non valido."); return; }
    isUnarmed = true;
    weapon = {
      name: game.i18n.localize(`SWORD.Combat.Strike${strikeKey.charAt(0).toUpperCase() + strikeKey.slice(1)}`),
      system: {
        damageValue: strike.damageValue,
        damageType: strike.damageType,
        parryModifier: strike.parryModifier,
        misura: strike.misura,
        skillId: strike.skillId,
        hands: "una_mano",
        category: null,
        pregi: [],
        gittata: null,
        ricarica: null,
        reloadTurnsRemaining: 0
      }
    };
  } else if (weaponItemId?.startsWith("creature_attack_")) {
    const idx = parseInt(weaponItemId.replace("creature_attack_", ""));
    const creatureAttack = actor.system.attacks?.[idx];
    if (!creatureAttack) { ui.notifications.error("Attacco non trovato."); return; }
    isUnarmed = true; // synthetic weapon, same treatment as unarmed
    // Parse damage string "+2T" → { damageValue: 2, damageType: "T" }
    const dmgMatch = (creatureAttack.damage || "").match(/([+-]?\d+)([TBP])/);
    const damageValue = dmgMatch ? parseInt(dmgMatch[1]) : 0;
    const damageType = dmgMatch ? dmgMatch[2] : "B";
    // Map Italian misura label to engine code
    const misuraCode = CREATURE_MISURA_MAP[creatureAttack.misura] ?? "M";
    weapon = {
      name: creatureAttack.name,
      system: {
        damageValue,
        damageType,
        parryModifier: 0,
        misura: misuraCode,
        skillId: creatureAttack.skill,
        hands: "una_mano",
        category: null,
        pregi: [],
        gittata: null,
        ricarica: null,
        reloadTurnsRemaining: 0
      }
    };
  } else {
    weapon = actor.items.get(weaponItemId);
    if (!weapon || weapon.type !== "weapon") {
      ui.notifications.error("Arma non trovata.");
      return;
    }
  }

  // --- Drawn gate: real weapons must be drawn to attack ---
  if (!isUnarmed && weapon.system.isDrawn === false) {
    ui.notifications.warn(game.i18n.localize("SWORD.Combat.WeaponNotDrawn"));
    return;
  }

  // --- da_lancio throw detection ---
  const hasDaLancio = !isUnarmed && (weapon.system.pregi || []).includes("da_lancio");

  // --- Ranged detection ---
  let isRanged = weapon.system.gittata != null && weapon.system.gittata > 0;
  // Occhio di falco: +10m gittata for bows
  const bowRangeBonus = (isRanged && weapon.system.skillId === "archi"
    && actor.system.talentSpecials?.has("bow_range_plus10m")) ? 10 : 0;
  const gittata = isRanged ? weapon.system.gittata + bowRangeBonus : 0;

  // --- Reload gate ---
  if (isRanged && weapon.system.reloadTurnsRemaining > 0) {
    ui.notifications.warn(game.i18n.format("SWORD.Combat.WeaponReloading",
      { weapon: weapon.name, turns: weapon.system.reloadTurnsRemaining }));
    return;
  }

  // --- Senza fiato: no actions allowed (errata §4.6 line 2141) ---
  if (actor.statuses?.has("senza-fiato")) {
    ui.notifications.warn(game.i18n.localize("SWORD.Status.SenzaFiatoNoAction"));
    return;
  }

  // --- Attesa interruption: attacking forfeits Riflessi recovery (errata line 2138) ---
  if (game.combat) {
    const waitCombatant = game.combat.resolveCombatant(actor);
    if (waitCombatant?.getFlag("sword", "isWaiting")) {
      await waitCombatant.unsetFlag("sword", "isWaiting");
      ui.notifications.info(game.i18n.localize("SWORD.Combat.AttesaInterrupted"));
    }
  }

  // --- Dual wielding: detect secondary weapon ---
  const isSecondaryWeapon = !!(weapon.system?.isSecondary);
  let isDualWieldAttack = isSecondaryWeapon;

  // --- Action economy gate ---
  const isFreeGrapple = !!options.freeGrapple;
  // Grapple free strike: a free bonus unarmed percussion after a successful grapple.
  // Unlike freeGrapple it is a normal strike (not another grapple); it bypasses the
  // action gate (the grapple attack already spent the action), does not consume an
  // action, and deals +1 damage (a headbutt/knee/elbow) per errata §5.6.
  const isFreeStrike = !!options.freeStrike;
  const freeStrikeDamage = isFreeStrike ? (Number(options.damageBonus) || 0) : 0;
  let isExtraAttack3Riflessi = false;

  // Off-hand attack uses the free action slot (combat only)
  if (game.combat && isDualWieldAttack && !isFreeGrapple) {
    if (game.combat.hasFreeActionAvailable(actor)) {
      // OK — free action available
    } else {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoFreeActionAvailable"));
      return;
    }
  }

  if (game.combat && !isFreeGrapple && !isFreeStrike && !isDualWieldAttack && !game.combat.hasActionAvailable(actor)) {
    // Fulmine / Occhio di falco: extra attack for 3 riflessi (once per turn)
    const combatant = game.combat.resolveCombatant(actor);
    const hasExtraMelee = !isRanged && !!actor.system.talentSpecials?.has("extra_attack_3riflessi");
    const hasExtraRanged = isRanged && weapon.system.skillId === "archi" && !!actor.system.talentSpecials?.has("extra_arrow_3riflessi");
    const usedExtraAttack = combatant?.getFlag("sword", "usedExtraAttack3Riflessi");
    if ((hasExtraMelee || hasExtraRanged) && !usedExtraAttack && actor.system.resources.riflessi.value >= 3) {
      isExtraAttack3Riflessi = true;
    } else if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("SWORD.Combat.NoActionAvailable"));
      return;
    } else {
      ui.notifications.info(game.i18n.localize("SWORD.Combat.GMActionOverride"));
    }
  }

  // --- Melee Misura (Phase 3) ---
  let weaponMisura = null;
  let engagementMisura = null;
  let misuraPenalty = 0;
  if (!isRanged) {
    weaponMisura = weapon.system.misura ?? "M";

    // Check existing engagement or compute initial
    if (game.combat && targetActorId) {
      engagementMisura = game.combat.getEngagementMisura(actor, targetTokenId || targetActorId);
      if (!engagementMisura) {
        const defenderMisura = _getDefenderPrimaryMisura(targetActor);
        engagementMisura = initialEngagementMisura(weaponMisura, defenderMisura);
        // Persist engagement immediately so Close Misura can reference it
        await game.combat.setEngagementMisura(actor, targetTokenId || targetActorId, engagementMisura);
      }

      // Lotta in arme: M or shorter weapons can be used at Close/Abrazzar
      const hasLottaInArme = !!actor.system.talentSpecials?.has("weapons_at_close_range");
      const lottaOverride = hasLottaInArme
        && MISURA_ORDER.indexOf(weaponMisura) >= MISURA_ORDER.indexOf("M");
      if (isFuoriMisura(weaponMisura, engagementMisura) && !lottaOverride) {
        if (!game.user.isGM) {
          const misuraLabel = game.i18n.localize(`SWORD.Combat.Misura.${engagementMisura}`);
          ui.notifications.warn(game.i18n.format("SWORD.Combat.FuoriMisura",
            { weapon: weapon.name, current: misuraLabel }));
          return;
        }
        ui.notifications.info(game.i18n.localize("SWORD.Combat.GMActionOverride"));
      }
      const hasCompatta = (weapon.system.pregi || []).includes("compatta");
      // Lotta in arme: no misura penalty for M weapons at Close/Abrazzar
      misuraPenalty = lottaOverride ? 0 : computeMisuraPenalty(weaponMisura, engagementMisura, hasCompatta);
    }
  }

  // --- Creature attack: fixed successes, no dice ---
  if (actor.type === "creature") {
    return _attackCreature(actor, weapon, isUnarmed, {
      targetActorId, targetTokenId, targetName, targetSenzaFiato, targetActor,
      isRanged, gittata, weaponMisura, engagementMisura, misuraPenalty
    });
  }

  const system = actor.system;
  const skillId = weapon.system.skillId;
  const skillData = system.skills[skillId];
  if (!skillData) {
    ui.notifications.error(`Abilità non trovata: ${skillId}`);
    return;
  }

  const charKey = SKILL_MAP[skillId];
  const effectiveCharKey = charKey === "varies" ? (skillData.specialtyChar || "mens") : charKey;
  const baseCharScore = system.effectiveCharacteristics?.[effectiveCharKey] ?? system.characteristics[effectiveCharKey];
  // Weapon quality: scadente imposes -2 to characteristic (§12.2)
  const weaponQualityMod = weaponQualityBonus(weapon.system.quality);
  const charScore = baseCharScore + weaponQualityMod;
  const charLabel = game.i18n.localize(`SWORD.Characteristics.${effectiveCharKey}`);
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`);
  const weaponName = weapon.name;

  const grade = skillData.grade;
  const allFoci = collectAllFoci(system);
  const extraDice = skillData.extraDice;
  const isUntrained = grade === 0 && extraDice === 0;

  // Penalties
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const encumbrancePenalty = system.encumbrancePenalty || 0;
  const equippedArmor = Array.from(actor.items).find(i => i.type === "armor");
  const armorPenalty = equippedArmor
    ? armorSkillPenalty(equippedArmor.system.protezione || 0, equippedArmor.system.pregi || [], skillId)
    : 0;
  const basePenalty = fatiguePenalty + woundPenalty + armorPenalty + encumbrancePenalty;
  const fatigueLevel = system.fatigueLevel || "fresco";

  // Spirito for cancellation
  const spirito = system.resources.spirito;

  const canUseValore = VALORE_KEYS.some(k => system.valori[k] > 0) && spirito.value >= 3;
  const isSocial = SOCIAL_SKILLS.has(skillId);
  const fama = system.fama;
  const combined = buildCombinedSkillOptions(system, skillId, grade);

  // Weapon info header
  const dmgTypeLabel = game.i18n.localize(`SWORD.DamageTypes.${weapon.system.damageType}`);
  const weaponInfoHtml = `
    <div class="sword-attack-info">
      <strong>${weaponName}</strong> — ${weapon.system.damageValue}${weapon.system.damageType} (${dmgTypeLabel})
      ${weapon.system.parryModifier ? ` | ${game.i18n.localize("SWORD.Item.Parry")}: ${weapon.system.parryModifier}` : ""}
      ${isRanged ? ` | ${game.i18n.localize("SWORD.Item.Gittata")}: ${gittata}m` : ""}
    </div>
  `;

  // Extra dice hint
  const extraDiceHint = extraDice > 0
    ? `<p class="hint">+${extraDice} dadi extra (focus/altro)</p>`
    : "";
  const untrainedHint = isUntrained
    ? `<p class="hint">${game.i18n.localize("SWORD.Roll.Untrained")}</p>`
    : "";

  const penaltyParts = buildPenaltyParts({ fatiguePenalty, woundPenalty, encumbrancePenalty, fatigueLevel });
  const penaltyHtml = buildPenaltyHtml(basePenalty, spirito.value, penaltyParts);

  const valoreHtml = buildValoreSelectHtml(system);

  const hasMondano = !!system.talentSpecials?.has("add_fides_honor_to_fama");
  const famaHtml = isSocial
    ? buildFamaHtml(fama, { hasMondano, valori: system.valori })
    : "";

  const approachHtml = buildCombatApproachHtml();

  // Situational modifier
  const modifierHtml = `
    <div class="form-group">
      <label>${game.i18n.localize("SWORD.Combat.SituationalMod")}</label>
      <input type="number" name="situationalMod" value="0" />
    </div>
  `;

  const mountedHtml = `
    <div class="form-group">
      <label><input type="checkbox" name="mountedMelee"
        onchange="this.closest('.sword-roll-dialog').querySelector('[data-mount-forza-group]').style.display = this.checked ? '' : 'none';
                  this.closest('.sword-roll-dialog').querySelector('[data-mount-target-group]').style.display = this.checked ? '' : 'none'" /> ${game.i18n.localize("SWORD.Combat.IsMounted")}</label>
    </div>
    <div class="form-group" style="display:none" data-mount-forza-group>
      <label>${game.i18n.localize("SWORD.Combat.MountForzaGrade")}</label>
      <input type="number" name="mountForzaGrade" value="0" min="0" max="6" />
      <p class="hint">${game.i18n.localize("SWORD.Combat.MountForzaHint")}</p>
    </div>
    <div class="form-group" style="display:none" data-mount-target-group>
      <label><input type="checkbox" name="targetMounted" /> ${game.i18n.localize("SWORD.Combat.TargetMounted")}</label>
    </div>
  `;

  // da_lancio throw option
  const throwHtml = hasDaLancio ? `
    <div class="form-group">
      <label><input type="checkbox" name="throwWeapon" /> ${game.i18n.localize("SWORD.Combat.ThrowWeapon")} (10m, +1 ${game.i18n.localize("SWORD.Item.Damage")})</label>
    </div>
  ` : "";

  // Ranged-specific fields
  let rangedHtml = "";
  if (isRanged) {
    rangedHtml = `
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Combat.RangedDistance")}</label>
        <input type="number" name="rangedDistance" value="${gittata}" min="2" />
        <p class="hint">${game.i18n.localize("SWORD.Item.Gittata")}: ${gittata}m</p>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Combat.RangedCover")}</label>
        <select name="coverDifficulty">
          <option value="0">${game.i18n.localize("SWORD.Combat.CoverNone")}</option>
          <option value="2">${game.i18n.localize("SWORD.Combat.Cover13")}</option>
          <option value="3">${game.i18n.localize("SWORD.Combat.Cover12")}</option>
          <option value="4">${game.i18n.localize("SWORD.Combat.Cover34")}</option>
        </select>
      </div>
    `;
  }

  // Melee Misura info + Special move selector (melee only)
  let misuraHtml = "";
  let specialMoveHtml = "";
  if (!isRanged) {
    // Misura display (when in combat with a target)
    if (engagementMisura) {
      const engLabel = game.i18n.localize(`SWORD.Combat.Misura.${engagementMisura}`);
      const wepLabel = game.i18n.localize(`SWORD.Combat.Misura.${weaponMisura}`);
      misuraHtml = `
        <div class="form-group misura-info">
          <label>${game.i18n.localize("SWORD.Combat.EngagementMisura")}: <strong>${engLabel}</strong></label>
          <p class="hint">${game.i18n.localize("SWORD.Item.Misura")}: ${wepLabel}${misuraPenalty > 0 ? ` (${game.i18n.localize("SWORD.Combat.MisuraPenalty")}: -${misuraPenalty})` : ""}</p>
        </div>
      `;
    }

    // Special move dropdown
    const grappleAvailable = isUnarmed || (engagementMisura === "A");
    specialMoveHtml = `
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Combat.SpecialMove")}</label>
        <select name="specialMove">
          <option value="">${game.i18n.localize("SWORD.Combat.MoveNormale")}</option>
          <option value="targetedAttack">${game.i18n.localize("SWORD.Combat.MoveTargeted")}</option>
          <option value="nonLethal">${game.i18n.localize("SWORD.Combat.MoveNonLethal")}</option>
          <option value="disarm">${game.i18n.localize("SWORD.Combat.MoveDisarm")}</option>
          <option value="push">${game.i18n.localize("SWORD.Combat.MovePush")}</option>
          <option value="feint">${game.i18n.localize("SWORD.Combat.MoveFeint")}</option>
          <option value="hitShield">${game.i18n.localize("SWORD.Combat.MoveHitShield")}</option>
          ${grappleAvailable ? `<option value="grapple">${game.i18n.localize("SWORD.Combat.MoveGrapple")}</option>` : ""}
        </select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Combat.TargetBodyPart")}</label>
        <select name="specialMoveTarget">
          <option value="">${game.i18n.localize("SWORD.Combat.BodyNone")}</option>
          <option value="weaponArm_chest">${game.i18n.localize("SWORD.Combat.BodyWeaponArmChest")} (2)</option>
          <option value="legs_shieldArm">${game.i18n.localize("SWORD.Combat.BodyLegsShieldArm")} (3)</option>
          <option value="head_vitals">${game.i18n.localize("SWORD.Combat.BodyHeadVitals")} (4)</option>
        </select>
      </div>
    `;
  }

  // Combined Maneuver HTML
  const combinedHtml = buildCombinedManeuverHtml(combined.options, combined.canUse);

  // Tactical advantage (Study Battlefield)
  let tacticalAdvHtml = "";
  const tacticalAdv = game.combat?.getFlag("sword", "tacticalAdvantages");
  if (tacticalAdv && tacticalAdv.remaining > 0) {
    tacticalAdvHtml = `
      <div class="form-group">
        <label>
          <input type="checkbox" name="useTacticalAdvantage" />
          ${game.i18n.localize("SWORD.Combat.UseTacticalAdvantage")} — ${tacticalAdv.remaining} ${game.i18n.localize("SWORD.Combat.RemainingAdvantages")}
        </label>
      </div>
    `;
  }

  // Sbracciata: spend 1 Fatica for +1 melee damage (melee only)
  const hasSbracciata = !isRanged && !!system.talentSpecials?.has("spend_fatica_plus1_damage");
  const canSbracciata = hasSbracciata && system.resources.fatica.value > 0;
  const sbracciataHtml = hasSbracciata ? `
    <div class="form-group">
      <label>
        <input type="checkbox" name="useSbracciata" ${!canSbracciata ? "disabled" : ""} />
        ${game.i18n.localize("SWORD.Talent.Sbracciata")} (+1 ${game.i18n.localize("SWORD.Combat.Damage")}, -1 ${game.i18n.localize("SWORD.Resources.fatica")})
      </label>
    </div>
  ` : "";

  // Formation bonus (Fiore della cavalleria) — any allied combatant with talent enables for all (errata: "tutti ricevono")
  const hasFormation = game.combat
    ? game.combat.combatants.some(c => c.actor?.hasPlayerOwner && c.actor.system?.talentSpecials?.has("formation_bonus"))
    : !!system.talentSpecials?.has("formation_bonus");
  const formationHtml = hasFormation ? `
    <div class="form-group">
      <label><input type="checkbox" name="useFormation" /> ${game.i18n.localize("SWORD.Talent.FormationBonus")}</label>
    </div>
  ` : "";

  const dialogContent = `
    <div class="sword-roll-dialog">
      ${weaponInfoHtml}
      <p><strong>${skillLabel}</strong> (${charLabel} ${charScore})</p>
      ${grade > 0 ? `<p class="hint">${game.i18n.localize("SWORD.Grade")}: ${grade}</p>` : ""}
      ${extraDiceHint}
      <div class="form-group">
        <label>${game.i18n.localize("SWORD.Roll.DiceCount")}</label>
        <input type="number" name="diceCount" value="2" min="2"
          ${isUntrained ? 'max="2" disabled' : ""} />
        ${untrainedHint}
      </div>
      ${approachHtml}
      ${modifierHtml}
      ${mountedHtml}
      ${throwHtml}
      ${misuraHtml}
      ${specialMoveHtml}
      ${rangedHtml}
      ${famaHtml}
      ${penaltyHtml}
      ${combinedHtml}
      ${valoreHtml}
      ${tacticalAdvHtml}
      ${sbracciataHtml}
      ${formationHtml}
      ${buildFocusDialogHtml(allFoci)}
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: {
      title: game.i18n.format("SWORD.Combat.AttackTitle", { weapon: weaponName }) + (targetName ? ` → ${targetName}` : "")
    },
    content: dialogContent,
    ok: {
      label: game.i18n.localize("SWORD.Combat.AttackBtn"),
      icon: "fa-solid fa-swords",
      callback: (event, button, dialog) => {
        const form = button.form;
        return {
          diceCount: parseInt(form.elements.diceCount.value) || 2,
          situationalMod: parseInt(form.elements.situationalMod.value) || 0,
          approach: form.elements.approach?.value || "corsa",
          valore: form.elements.valore?.value || "",
          famaSpend: parseInt(form.elements.famaSpend?.value) || 0,
          spiritoCancelPenalty: parseInt(form.elements.spiritoCancelPenalty?.value) || 0,
          mountedMelee: form.elements.mountedMelee?.checked || false,
          targetMounted: form.elements.targetMounted?.checked || false,
          throwWeapon: form.elements.throwWeapon?.checked || false,
          mountForzaGrade: parseInt(form.elements.mountForzaGrade?.value) || 0,
          rangedDistance: parseInt(form.elements.rangedDistance?.value) || gittata,
          coverDifficulty: parseInt(form.elements.coverDifficulty?.value) || 0,
          specialMove: form.elements.specialMove?.value || "",
          specialMoveTarget: form.elements.specialMoveTarget?.value || "",
          useTacticalAdvantage: form.elements.useTacticalAdvantage?.checked || false,
          combinedSkill: form.elements.combinedSkill?.value || "",
          combinedCostSource: form.elements.combinedCostSource?.value || "spirito",
          focusDice: countSelectedFoci(button.form, allFoci.length),
          useSbracciata: form.elements.useSbracciata?.checked || false,
          mondanoValore: form.elements.mondanoValore?.value || "",
          useFormation: form.elements.useFormation?.checked || false
        };
      }
    }
  });

  if (!result) return;

  let { diceCount, situationalMod, approach, valore, famaSpend, mondanoValore, spiritoCancelPenalty,
        mountedMelee, targetMounted, throwWeapon, mountForzaGrade, rangedDistance, coverDifficulty, specialMove, specialMoveTarget,
        useTacticalAdvantage, combinedSkill, combinedCostSource, focusDice, useSbracciata, useFormation } = result;
  if (isUntrained) diceCount = 2;
  if (diceCount < 2) diceCount = 2;

  // da_lancio throw: override ranged settings, +1 damage (PDF line 2550)
  let isThrown = false;
  let throwDamageBonus = 0;
  if (throwWeapon && hasDaLancio) {
    isRanged = true;
    isThrown = true;
    throwDamageBonus = 1;
    rangedDistance = rangedDistance || 10;
  }
  const gittataEffective = isThrown ? 10 : gittata;

  // Normalize special move: empty string → null
  if (!specialMove) specialMove = null;
  if (!specialMoveTarget) specialMoveTarget = null;
  // Free grapple (Lottatore): force grapple special move
  if (isFreeGrapple) specialMove = "grapple";
  // Body part relevant for targeted attack and grapple
  if (specialMove !== "targetedAttack" && specialMove !== "grapple") specialMoveTarget = null;

  // Clamp
  famaSpend = Math.min(Math.max(famaSpend, 0), fama);
  // Mondano: add Fides or Honor score as bonus dice when spending Fama
  let mondanoBonus = 0;
  if (famaSpend > 0 && mondanoValore && hasMondano) {
    mondanoBonus = system.valori[mondanoValore] || 0;
  }
  spiritoCancelPenalty = Math.min(Math.max(spiritoCancelPenalty, 0), basePenalty);

  // Combined Maneuver: validate
  let combinedGrade = 0;
  let combinedSkillLabel = "";
  if (combinedSkill && system.skills[combinedSkill]?.grade >= 1 && grade >= 1) {
    combinedGrade = system.skills[combinedSkill].grade;
    combinedSkillLabel = game.i18n.localize(`SWORD.Skills.${combinedSkill}`);
  }

  // Cecchino: crossbow aim combined maneuver with Percezione
  const isCrossbowAim = isRanged && skillId === "balestre" && combinedSkill === "percezione"
    && combinedGrade > 0 && !!system.talentSpecials?.has("crossbow_aim_bonus");
  const cecchinoGittataBonus = isCrossbowAim ? 10 : 0;
  const cecchinoPenaltyReduction = isCrossbowAim ? 1 : 0;
  const cecchinoCoverReduction = isCrossbowAim ? 1 : 0;
  const cecchinoProtectionReduction = isCrossbowAim ? 1 : 0;

  // Valore validation
  let valoreSelected = null;
  let valoreScore = 0;
  if (valore && canUseValore) {
    valoreScore = system.valori[valore] || 0;
    if (valoreScore > 0) valoreSelected = valore;
  }

  const mounted = !!mountedMelee;

  // Talent combat context (needed for intent)
  const attackCombatCtx = {
    skillId, isRanged,
    distance: isRanged ? rangedDistance : null,
    weaponCategory: weapon.system.category,
    weaponType: weapon.system.weaponType,
    weaponHands: weapon.system.hands,
    hasShield: Array.from(actor.items).some(i => i.type === "shield"),
    hasArmor: false,
    mounted
  };

  // Successive shot bonus (Aggiustare il tiro)
  let successiveShotBonus = 0;
  if (isRanged && skillId === "archi" && targetActorId && system.talentSpecials?.has("successive_shot_bonus") && game.combat) {
    const combatant = game.combat.resolveCombatant(actor);
    // Key by token first: two unlinked tokens of the same actor are distinct targets.
    if (combatant?.getFlag("sword", "lastRangedTarget") === (targetTokenId || targetActorId)) {
      successiveShotBonus = 1;
    }
  }

  // Non-lethal + Botta weapon → +1 success bonus
  const nonLethalBottaBonus = (specialMove === "nonLethal" && weapon.system.damageType === "B") ? 1 : 0;

  // Compute total dice for Foundry Roll (must match use-case's total)
  const daCavalloWeaponBonus = computeDaCavalloWeaponBonus(weapon.system.pregi, mounted);
  // Grapple: no Forza bonus dice on the attack (PDF line 2664).
  // Net successes become grade bonus on follow-up instead.
  const totalExtraDice = extraDice + focusDice + famaSpend + mondanoBonus + daCavalloWeaponBonus;
  const totalDice = diceCount + totalExtraDice;

  // Roll dice via Foundry
  const roll = new Roll(`${totalDice}d6`);
  await roll.evaluate();
  const diceRolled = roll.terms[0].values;

  // --- Use-case call ---
  const attackResult = resolveAttack({
    characteristicScore: charScore, diceCount, grade, extraDice, focusDice,
    famaSpend, mondanoBonus, approach, situationalMod,
    isRanged, rangedDistance, gittata: gittataEffective, coverDifficulty,
    specialMove, specialMoveTarget, combinedGrade, combinedCostSource,
    inCombat: !!game.combat, valoreSelected, valoreScore,
    hasActivationPlus1: !!system.talentSpecials?.has("valori_activation_plus1"),
    spiritoCancelPenalty,
    hasRiflessiCostMinus1: !!system.talentSpecials?.has("riflessi_cost_minus1"),
    useSbracciata, useFormation: !!useFormation,
    useTacticalAdvantage: !!useTacticalAdvantage,
    targetSenzaFiato, successiveShotBonus, mounted, targetMounted: !!targetMounted, targetSizeCategory,
    mountForzaGrade: mountForzaGrade || 0,
    hasDoubleCharge: !!system.talentSpecials?.has("double_charge_strength"),
    isDualWieldAttack,
    daCavalloWeaponBonus, isCrossbowAim,
    cecchinoGittataBonus, cecchinoPenaltyReduction,
    cecchinoCoverReduction, cecchinoProtectionReduction,
    attackCombatCtx, talents: system.talents,
    nonLethalBottaBonus, weaponMisura, engagementMisura,
    hasCompatta: (weapon.system.pregi || []).includes("compatta"),
    weaponPregi: weapon.system.pregi || []
  }, {
    fatiguePenalty, woundPenalty, armorPenalty, encumbrancePenalty,
    spirito: spirito.value, fama,
    fatica: system.resources.fatica.value,
    riflessi: system.resources.riflessi.value
  }, diceRolled);

  // Unpack results
  const { engineOutput, effectiveAttackHit: _eatHit, valoreUsed, valoreBonus,
    basePenalty: _bp, effectivePenalty, spiritoCancelPenalty: _scp,
    rangePenalty, misuraPenalty: _mp, specialMoveDifficulty,
    difficultyThreshold, talentDamageBonus, senzaFiatoBonus, talentSuccessBonus,
    isMountedCharge, mountChargeGradeBonus, mountChargeDamageBonus,
    mountedRangedPenalty, dualWieldPenalty, formationBonus,
    pesanteRiflessiCost, combinedRiflessiCost, approachDefMod: _adm } = attackResult;
  const valoreName = valoreUsed ? game.i18n.localize(`SWORD.Valori.${valoreSelected}`) : "";
  const effectiveAttackHit = _eatHit;

  // Apply resource patches
  const updateData = {};
  for (const [key, value] of Object.entries(attackResult.patches)) {
    if (key.startsWith("resources.")) {
      updateData[`system.${key}.value`] = value;
    } else {
      updateData[`system.${key}`] = value;
    }
  }
  if (Object.keys(updateData).length > 0) {
    await actor.update(updateData);
  }

  // Decrement tactical advantage
  if (useTacticalAdvantage && game.combat) {
    const ta = game.combat.getFlag("sword", "tacticalAdvantages");
    if (ta && ta.remaining > 0) {
      ta.remaining -= 1;
      await game.combat.setFlag("sword", "tacticalAdvantages", ta);
    }
  }

  if (!isRanged && game.combat && targetActorId) {
    const existingEngagement = game.combat.getEngagementMisura(actor, targetTokenId || targetActorId);
    if (!existingEngagement && engagementMisura) {
      await game.combat.setEngagementMisura(actor, targetTokenId || targetActorId, engagementMisura);
    }
  }

  // Pre-compute booleans for chat template (Handlebars lacks eq helper)
  const isDisarm = specialMove === "disarm";
  const isPush = specialMove === "push";
  const isDisarmOrPush = isDisarm || isPush;
  const specialMoveLabel = specialMove ? game.i18n.localize(`SWORD.Combat.Move${specialMove.charAt(0).toUpperCase() + specialMove.slice(1).replace(/([A-Z])/g, "$1")}`) : null;
  // Build a clean label using the localization keys
  const SPECIAL_MOVE_LABELS = {
    targetedAttack: "SWORD.Combat.MoveTargeted",
    nonLethal: "SWORD.Combat.MoveNonLethal",
    disarm: "SWORD.Combat.MoveDisarm",
    push: "SWORD.Combat.MovePush",
    feint: "SWORD.Combat.MoveFeint",
    grapple: "SWORD.Combat.MoveGrapple",
    hitShield: "SWORD.Combat.MoveHitShield"
  };
  const BODY_PART_LABELS = {
    weaponArm_chest: "SWORD.Combat.BodyWeaponArmChest",
    legs_shieldArm: "SWORD.Combat.BodyLegsShieldArm",
    head_vitals: "SWORD.Combat.BodyHeadVitals"
  };

  // Chat template data
  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    targetName,
    targetActorId,
    weaponName,
    skillLabel,
    charLabel,
    ...engineOutput,
    effectiveAttackHit,
    grade,
    extraDice: totalExtraDice,
    diceAfterReductionDisplay: engineOutput.diceAfterReduction.map(d => ({
      value: d, isOne: d === 1
    })),
    valoreUsed,
    valoreName,
    valoreBonus,
    famaUsed: famaSpend > 0,
    famaPoints: famaSpend,
    hasPenalty: basePenalty > 0,
    fatiguePenalty,
    woundPenalty,
    armorPenalty,
    encumbrancePenalty,
    penaltyCancelled: spiritoCancelPenalty,
    effectivePenalty,
    damageValue: weapon.system.damageValue,
    damageType: weapon.system.damageType,
    damageTypeLabel: dmgTypeLabel,
    talentDamageBonus: talentDamageBonus + freeStrikeDamage,
    isRanged,
    rangePenalty,
    rangedDistance: isRanged ? rangedDistance : null,
    gittata: isRanged ? gittataEffective : null,
    approach,
    approachLabel: game.i18n.localize(`SWORD.Combat.Approach${approach.charAt(0).toUpperCase() + approach.slice(1)}`),
    senzaFiatoBonus,
    talentSuccessBonus,
    mounted,
    // Phase 3: Misura + Special moves
    misuraPenalty,
    engagementMisura,
    engagementMisuraLabel: engagementMisura ? game.i18n.localize(`SWORD.Combat.Misura.${engagementMisura}`) : null,
    specialMove,
    specialMoveLabel: specialMove ? game.i18n.localize(SPECIAL_MOVE_LABELS[specialMove] || "") : null,
    specialMoveTarget,
    specialMoveTargetLabel: specialMoveTarget ? game.i18n.localize(BODY_PART_LABELS[specialMoveTarget] || "") : null,
    specialMoveDifficulty,
    isDisarmOrPush,
    isDisarm,
    isPush,
    nonLethalBottaBonus,
    tacticalAdvantageUsed: useTacticalAdvantage,
    isUnarmed,
    daCavalloWeaponBonus,
    mountedRangedPenalty,
    isStandardAction: !isExtraAttack3Riflessi && !isDualWieldAttack,
    isExtraAttack3Riflessi,
    isDualWieldAttack,
    dualWieldPenalty,
    isCrossbowAim,
    cecchinoGittataBonus,
    cecchinoPenaltyReduction,
    cecchinoCoverReduction,
    cecchinoProtectionReduction,
    isMountedCharge,
    mountChargeGradeBonus,
    mountChargeDamageBonus,
    pesanteRiflessiCost,
    // Combined Maneuver
    combinedUsed: combinedGrade > 0,
    combinedSkillLabel,
    combinedGrade
  };

  const html = await renderTemplate(
    "systems/sword/templates/chat/attack-result.hbs",
    chatData
  );

  // Initiate reload after firing ranged weapon (skip for virtual unarmed weapons)
  if (isRanged && !isUnarmed && weapon.system.ricarica > 0) {
    let reloadTurns = weapon.system.ricarica;
    // Incoccare (reload_minus1): -1 reload time for qualified ranged weapons
    if (system.talentSpecials?.has("reload_minus1") && (skillId === "archi" || skillId === "balestre")) {
      reloadTurns = Math.max(0, reloadTurns - 1);
    }
    if (reloadTurns > 0) {
      await weapon.update({ "system.reloadTurnsRemaining": reloadTurns });
    }
    // If reload reaches 0 (Incoccare), reload is instant — no turns remaining
  }

  // Sicario: surprise attack bonus damage + bleeding
  let sicarioDamageBonus = 0;
  let sicarioBleeding = false;
  if (system.talentSpecials?.has("surprise_bonus_damage_bleeding") && game.combat && targetActorId) {
    const targetCombatant = game.combat.resolveCombatant(targetTokenId || targetActorId);
    if (targetCombatant?.getFlag("sword", "isSurprised")) {
      const ec = system.effectiveCharacteristics ?? system.characteristics;
      const mod = v => (v >= 7 ? 2 : v >= 4 ? 1 : 0);
      sicarioDamageBonus = mod(ec.celeritas) + mod(ec.prudentia);
      sicarioBleeding = true;
    }
  }

  // Compute action cost flags for chat display
  const isStandardAction = true;

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html,
    rolls: [roll],
    sound: CONFIG.sounds.dice,
    "flags.sword.attack": {
      attackerId: actor.id,
      attackerTokenId: actor.token?.id ?? null,
      targetActorId,
      targetTokenId,
      targetName,
      weaponItemId,
      skillId,
      finalSuccesses: engineOutput.finalSuccesses,
      damageValue: weapon.system.damageValue,
      damageType: weapon.system.damageType,
      weaponName,
      isRanged,
      rangedDistance: isRanged ? rangedDistance : null,
      coverDifficulty: isRanged ? coverDifficulty : null,
      difficultyPassed: engineOutput.difficultyPassed,
      effectiveAttackHit,
      approach,
      approachDefMod: attackResult.approachDefMod,
      talentDamageBonus: talentDamageBonus + throwDamageBonus,
      isThrown,
      // Phase 3
      specialMove,
      specialMoveTarget,
      specialMoveDifficulty,
      engagementMisura,
      weaponMisura,
      weaponPregi: weapon.system.pregi || [],
      parryModifier: weapon.system.parryModifier || 0,
      isUnarmed,
      mounted,
      sicarioDamageBonus,
      sicarioBleeding,
      weaponType: weapon.system.weaponType || null,
      axeMasteryActive: !!(system.talentSpecials?.has("weapon_mastery_axe") && weapon.system.weaponType === "ascia"),
      cecchinoProtectionReduction,
      attackerSizeCategory: "media"
    }
  });

  // Consume standard action or extra attack riflessi (skip for free grapple — already
  // paid 1 Fatica — and for the grapple free strike, which is free after the grapple)
  if (game.combat && !isFreeGrapple && !isFreeStrike) {
    if (isDualWieldAttack) {
      await game.combat.consumeFreeAction(actor);
    } else if (isExtraAttack3Riflessi) {
      // Extra attack: spend 3 riflessi instead of action, mark as used
      let extraRifCost = 3;
      if (system.talentSpecials?.has("riflessi_cost_minus1")) extraRifCost = Math.max(0, extraRifCost - 1);
      await actor.update({
        "system.resources.riflessi.value": actor.system.resources.riflessi.value - extraRifCost
      });
      const combatant = game.combat.resolveCombatant(actor);
      if (combatant) await combatant.setFlag("sword", "usedExtraAttack3Riflessi", true);
    } else {
      await game.combat.consumeAction(actor);
    }
  }

  // Track last ranged target for successive shot bonus (Aggiustare il tiro).
  // Key by token first so distinct tokens of the same actor stay distinct.
  if (isRanged && game.combat && targetActorId) {
    const combatant = game.combat.resolveCombatant(actor);
    if (combatant) await combatant.setFlag("sword", "lastRangedTarget", targetTokenId || targetActorId);
  }

  // Pesante weapon: deduct extra Riflessi
  if (pesanteRiflessiCost > 0) {
    const currentRiflessi = actor.system.resources.riflessi.value;
    await actor.update({
      "system.resources.riflessi.value": currentRiflessi - pesanteRiflessiCost
    });
  }

  // Lottatore: offer free grapple after unarmed attack (once per turn, costs 1 Fatica)
  if (isUnarmed && specialMove !== "grapple" && game.combat && targetActorId
      && system.talentSpecials?.has("free_grapple_for_fatica")) {
    const combatant = game.combat.resolveCombatant(actor);
    if (combatant && !combatant.getFlag("sword", "usedFreeGrapple")
        && actor.system.resources.fatica.value > 0) {
      await ChatMessage.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<div class="sword-chat-card"><p><i class="fas fa-hand-rock"></i> <strong>${game.i18n.localize("SWORD.Talent.FreeGrapple")}</strong></p>
          <button type="button" data-action="free-grapple" data-actor-id="${actor.id}" data-actor-token-id="${actor.token?.id ?? ""}" data-target-actor-id="${targetActorId}" data-target-token-id="${targetTokenId || ""}">${game.i18n.localize("SWORD.Talent.FreeGrappleButton")}</button></div>`
      });
    }
  }
}
