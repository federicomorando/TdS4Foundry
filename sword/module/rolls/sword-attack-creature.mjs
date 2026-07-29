/**
 * Creature attack: fixed successes from skill value, no dice roll.
 * Mirrors the pattern in _defendCreature from sword-defense.mjs.
 *
 * Split from sword-attack.mjs — called by swordAttack when actor.type === "creature".
 */
import { APPROACH_MODS, computeSpecialMoveDifficulty } from "../engine.mjs";
import { buildCombatApproachHtml } from "./dialog-helpers.mjs";

/**
 * Creature attack: fixed successes from skill value, no dice roll.
 * Mirrors the pattern in _defendCreature from sword-defense.mjs.
 */
export async function _attackCreature(actor, weapon, isUnarmed, shared) {
  const { targetActorId, targetTokenId, targetName, targetSenzaFiato,
          isRanged, gittata, weaponMisura, engagementMisura, misuraPenalty } = shared;
  const system = actor.system;
  const skillId = weapon.system.skillId;
  const weaponName = weapon.name;
  const skillLabel = game.i18n.localize(`SWORD.Skills.${skillId}`) || skillId;

  // Fixed successes from creature skill value
  const baseSuccesses = system.skills[skillId] || 0;

  // Penalties
  const fatiguePenalty = system.fatiguePenalty || 0;
  const woundPenalty = system.woundPenalty || 0;
  const basePenalty = fatiguePenalty + woundPenalty;

  // Senza-fiato bonus
  const senzaFiatoBonus = targetSenzaFiato ? 1 : 0;

  // Damage type label
  const dmgTypeLabel = game.i18n.localize(`SWORD.DamageTypes.${weapon.system.damageType}`);

  // Weapon info for dialog
  const weaponInfoHtml = `
    <div class="sword-attack-info">
      <strong>${weaponName}</strong> — ${weapon.system.damageValue}${weapon.system.damageType} (${dmgTypeLabel})
    </div>
  `;

  // Misura display
  let misuraHtml = "";
  if (!isRanged && engagementMisura) {
    const engLabel = game.i18n.localize(`SWORD.Combat.Misura.${engagementMisura}`);
    const wepLabel = game.i18n.localize(`SWORD.Combat.Misura.${weaponMisura}`);
    misuraHtml = `
      <div class="form-group misura-info">
        <label>${game.i18n.localize("SWORD.Combat.EngagementMisura")}: <strong>${engLabel}</strong></label>
        <p class="hint">${game.i18n.localize("SWORD.Item.Misura")}: ${wepLabel}</p>
      </div>
    `;
  }

  // Special move dropdown (melee only)
  let specialMoveHtml = "";
  if (!isRanged) {
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

  const approachHtml = buildCombatApproachHtml();

  const dialogContent = `
    <div class="sword-roll-dialog">
      ${weaponInfoHtml}
      <p><strong>${skillLabel}</strong> — ${game.i18n.localize("SWORD.Creature.FixedSuccesses")}: ${baseSuccesses}</p>
      ${approachHtml}
      ${misuraHtml}
      ${specialMoveHtml}
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
          approach: form.elements.approach?.value || "corsa",
          specialMove: form.elements.specialMove?.value || "",
          specialMoveTarget: form.elements.specialMoveTarget?.value || ""
        };
      }
    }
  });

  if (!result) return;

  let { approach, specialMove, specialMoveTarget } = result;
  if (!specialMove) specialMove = null;
  if (!specialMoveTarget) specialMoveTarget = null;
  if (specialMove !== "targetedAttack" && specialMove !== "grapple") specialMoveTarget = null;

  const approachMod = APPROACH_MODS[approach] || APPROACH_MODS.corsa;
  const approachBonus = Math.max(0, approachMod.checkMod);
  const approachPenalty = Math.max(0, -approachMod.checkMod);

  const specialMoveDifficulty = specialMove ? computeSpecialMoveDifficulty(specialMove, specialMoveTarget) : null;
  const nonLethalBottaBonus = (specialMove === "nonLethal" && weapon.system.damageType === "B") ? 1 : 0;

  // Fixed successes with bonuses and penalties
  const successBonus = approachBonus + senzaFiatoBonus + nonLethalBottaBonus;
  const successPenalty = basePenalty + approachPenalty + misuraPenalty;
  const finalSuccesses = Math.max(0, baseSuccesses + successBonus - successPenalty);

  // Difficulty check (special move threshold)
  let difficultyPassed = null;
  if (specialMoveDifficulty !== null) {
    difficultyPassed = finalSuccesses >= specialMoveDifficulty;
  }
  const effectiveAttackHit = finalSuccesses > 0 &&
    (difficultyPassed === null || difficultyPassed === true);

  const isDisarm = specialMove === "disarm";
  const isPush = specialMove === "push";
  const isDisarmOrPush = isDisarm || isPush;
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

  const chatData = {
    actorName: actor.name,
    actorImg: actor.img,
    targetName,
    targetActorId,
    weaponName,
    skillLabel,
    isCreature: true,
    baseSuccesses,
    finalSuccesses,
    effectiveAttackHit,
    damageValue: weapon.system.damageValue,
    damageType: weapon.system.damageType,
    damageTypeLabel: dmgTypeLabel,
    hasPenalty: basePenalty > 0,
    fatiguePenalty,
    woundPenalty,
    effectivePenalty: basePenalty,
    senzaFiatoBonus,
    approach,
    approachLabel: game.i18n.localize(`SWORD.Combat.Approach${approach.charAt(0).toUpperCase() + approach.slice(1)}`),
    isRanged,
    engagementMisura,
    engagementMisuraLabel: engagementMisura ? game.i18n.localize(`SWORD.Combat.Misura.${engagementMisura}`) : null,
    misuraPenalty,
    specialMove,
    specialMoveLabel: specialMove ? game.i18n.localize(SPECIAL_MOVE_LABELS[specialMove] || "") : null,
    specialMoveTarget,
    specialMoveTargetLabel: specialMoveTarget ? game.i18n.localize(BODY_PART_LABELS[specialMoveTarget] || "") : null,
    specialMoveDifficulty,
    difficultyPassed,
    isDisarmOrPush,
    isDisarm,
    isPush,
    nonLethalBottaBonus,
    isUnarmed,
    mounted: false,
    isStandardAction: true,
    pesanteRiflessiCost: 0
  };

  const html = await renderTemplate(
    "systems/sword/templates/chat/attack-result.hbs",
    chatData
  );

  await ChatMessage.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: html,
    "flags.sword.attack": {
      attackerId: actor.id,
      attackerTokenId: actor.token?.id ?? null,
      targetActorId,
      targetTokenId,
      targetName,
      weaponItemId: null,
      skillId,
      finalSuccesses,
      damageValue: weapon.system.damageValue,
      damageType: weapon.system.damageType,
      weaponName,
      isRanged,
      rangedDistance: null,
      coverDifficulty: null,
      difficultyPassed,
      effectiveAttackHit,
      approach,
      approachDefMod: approachMod.defMod,
      talentDamageBonus: 0,
      specialMove,
      specialMoveTarget,
      specialMoveDifficulty,
      engagementMisura,
      weaponMisura,
      weaponPregi: [],
      parryModifier: weapon.system.parryModifier || 0,
      isUnarmed,
      mounted: false,
      attackerSizeCategory: system.sizeCategory || "media"
    }
  });

  // Consume standard action
  if (game.combat) await game.combat.consumeAction(actor);
}
