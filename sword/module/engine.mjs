// node_modules/@federicomorando/sword-engine/src/check.mjs
function swordCheckResolve(input) {
  const {
    characteristicScore,
    diceCount,
    grade,
    extraDice,
    successBonus = 0,
    successPenalty = 0,
    difficultyThreshold = null,
    opposedSuccesses = null,
    diceRolled,
    discardIndices = null
  } = input;
  if (diceRolled.length !== diceCount + extraDice) {
    throw new Error(
      `diceRolled.length (${diceRolled.length}) must equal diceCount + extraDice (${diceCount + extraDice})`
    );
  }
  for (const d of diceRolled) {
    if (d < 1 || d > 6) throw new Error(`Die value ${d} out of range [1,6]`);
  }
  if (discardIndices !== null) {
    if (discardIndices.length > extraDice) {
      throw new Error(
        `discardIndices.length (${discardIndices.length}) must not exceed extraDice (${extraDice})`
      );
    }
    for (const idx of discardIndices) {
      if (idx < 0 || idx >= diceRolled.length) {
        throw new Error(`Invalid discard index: ${idx}`);
      }
    }
  }
  const diceOriginal = [...diceRolled];
  let diceAfterDiscards;
  if (extraDice === 0) {
    diceAfterDiscards = [...diceOriginal];
  } else if (discardIndices !== null) {
    const discardSet = new Set(discardIndices);
    diceAfterDiscards = diceOriginal.filter((_, i) => !discardSet.has(i));
  } else {
    const totalSum = diceOriginal.reduce((s, d) => s + d, 0);
    if (totalSum <= characteristicScore) {
      diceAfterDiscards = [...diceOriginal];
    } else {
      const indexed = diceOriginal.map((v, i) => ({ v, i }));
      indexed.sort((a, b) => {
        if (a.v === 1 && b.v !== 1) return 1;
        if (a.v !== 1 && b.v === 1) return -1;
        return b.v - a.v;
      });
      const discardSet = /* @__PURE__ */ new Set();
      let runningSum = totalSum;
      for (let d = 0; d < extraDice; d++) {
        if (runningSum <= characteristicScore) break;
        discardSet.add(indexed[d].i);
        runningSum -= indexed[d].v;
      }
      diceAfterDiscards = diceOriginal.filter((_, i) => !discardSet.has(i));
    }
  }
  const diceAfterReduction = [...diceAfterDiscards];
  let gradesRemaining = grade;
  let gradesUsed = 0;
  while (gradesRemaining > 0) {
    let minVal = Infinity;
    let minIdx = -1;
    for (let i = 0; i < diceAfterReduction.length; i++) {
      if (diceAfterReduction[i] > 1 && diceAfterReduction[i] < minVal) {
        minVal = diceAfterReduction[i];
        minIdx = i;
      }
    }
    if (minIdx === -1) break;
    diceAfterReduction[minIdx] -= 1;
    gradesRemaining -= 1;
    gradesUsed += 1;
  }
  const finalSum = diceAfterReduction.reduce((s, d) => s + d, 0);
  const basePassed = finalSum <= characteristicScore;
  const onesCount = diceAfterReduction.filter((d) => d === 1).length;
  const rawSuccesses = basePassed ? 1 + onesCount : 0;
  const finalSuccesses = Math.max(0, rawSuccesses + successBonus - successPenalty);
  const difficultyPassed = difficultyThreshold !== null ? finalSuccesses >= difficultyThreshold : null;
  const netSuccesses = opposedSuccesses !== null ? finalSuccesses - opposedSuccesses : null;
  return {
    diceOriginal,
    diceAfterDiscards,
    diceAfterReduction,
    gradesUsed,
    gradesRemaining,
    finalSum,
    characteristicScore,
    basePassed,
    onesCount,
    rawSuccesses,
    successBonus,
    successPenalty,
    finalSuccesses,
    difficultyThreshold,
    difficultyPassed,
    opposedSuccesses,
    netSuccesses
  };
}
function applyValoreBonus(engineOutput, { valoreSelected, valoreScore, hasActivationPlus1 = false } = {}) {
  if (!valoreSelected || !engineOutput.basePassed) {
    return { valoreUsed: false, valoreName: "", valoreBonus: 0 };
  }
  const valoreBonus = valoreScore + (hasActivationPlus1 ? 1 : 0);
  engineOutput.finalSuccesses = Math.max(
    0,
    engineOutput.rawSuccesses + valoreBonus + engineOutput.successBonus - engineOutput.successPenalty
  );
  if (engineOutput.difficultyThreshold !== null) {
    engineOutput.difficultyPassed = engineOutput.finalSuccesses >= engineOutput.difficultyThreshold;
  }
  if (engineOutput.opposedSuccesses !== null) {
    engineOutput.netSuccesses = engineOutput.finalSuccesses - engineOutput.opposedSuccesses;
  }
  return { valoreUsed: true, valoreName: valoreSelected, valoreBonus };
}

// node_modules/@federicomorando/sword-engine/src/combat.mjs
function computeRangePenalty(distance, gittata) {
  if (gittata <= 0 || distance <= gittata) return 0;
  return Math.ceil((distance - gittata) / gittata);
}
var MISURA_ORDER = ["LL", "L", "M", "S", "A"];
function misuraDistance(a, b) {
  return MISURA_ORDER.indexOf(b) - MISURA_ORDER.indexOf(a);
}
function initialEngagementMisura(attackerMisura, defenderMisura) {
  const ai = MISURA_ORDER.indexOf(attackerMisura ?? "M");
  const di = MISURA_ORDER.indexOf(defenderMisura ?? "M");
  return MISURA_ORDER[Math.min(ai, di)];
}
function isFuoriMisura(weaponMisura, engagementMisura) {
  return MISURA_ORDER.indexOf(weaponMisura) > MISURA_ORDER.indexOf(engagementMisura);
}
function computeMisuraPenalty(weaponMisura, engagementMisura, hasCompatta = false) {
  const dist = MISURA_ORDER.indexOf(engagementMisura) - MISURA_ORDER.indexOf(weaponMisura);
  const raw = dist > 0 ? dist : 0;
  return hasCompatta ? Math.max(0, raw - 1) : raw;
}
function computeSpecialMoveDifficulty(specialMove, specialMoveTarget) {
  if (specialMove === "targetedAttack") {
    if (specialMoveTarget === "head_vitals") return 4;
    if (specialMoveTarget === "legs_shieldArm") return 3;
    return 2;
  }
  if (specialMove === "grapple") {
    if (specialMoveTarget === "head_vitals") return 3;
    if (specialMoveTarget === "legs_shieldArm") return 2;
    return 1;
  }
  if (specialMove === "nonLethal") return 2;
  if (specialMove === "feint") return 2;
  if (specialMove === "hitShield") return 2;
  return null;
}
function resolveDamage(input) {
  const {
    netSuccesses,
    weaponDamage,
    damageType,
    armorProtezione,
    armorRobustezzaCurrent,
    attackerSizeCategory = "media"
  } = input;
  const isMultiplicative = attackerSizeCategory === "grande" || attackerSizeCategory === "enorme";
  const grossWounds = isMultiplicative ? netSuccesses * weaponDamage : netSuccesses + weaponDamage;
  const armorAbsorbed = Math.min(grossWounds, armorProtezione);
  let netWounds = grossWounds - armorAbsorbed;
  let slashBonus = 0;
  let bluntRiflessi = 0;
  let thrustReduction = 0;
  if (damageType === "T") {
    if (armorProtezione === 0 || grossWounds > armorProtezione) {
      slashBonus = 1;
      netWounds += 1;
    }
  } else if (damageType === "B") {
    bluntRiflessi = 1;
  } else if (damageType === "P") {
    if (armorProtezione > 0) {
      thrustReduction = 1;
    }
  }
  const armorRobustezzaLost = armorAbsorbed;
  const armorRobustezzaNew = Math.max(0, armorRobustezzaCurrent - armorRobustezzaLost);
  return {
    grossWounds,
    armorAbsorbed,
    netWounds,
    slashBonus,
    bluntRiflessi,
    thrustReduction,
    armorRobustezzaLost,
    armorRobustezzaNew
  };
}
function computeWoundCapacities(feriteMax, indomito = false, cultureBonus = null) {
  const base = Math.floor(feriteMax / 5);
  const remainder = feriteMax % 5;
  const levels = ["graffi", "leggere", "gravi", "critiche", "mortali"];
  const capacities = {};
  for (let i = 0; i < levels.length; i++) {
    capacities[levels[i]] = base + (i < remainder ? 1 : 0);
  }
  if (indomito) {
    capacities.gravi += 1;
    capacities.critiche += 1;
    capacities.mortali += 1;
  }
  if (cultureBonus) {
    capacities.graffi += cultureBonus.graffi || 0;
    capacities.leggere += cultureBonus.leggere || 0;
  }
  return capacities;
}
function distributeWounds(currentLevels, capacities, incomingWounds) {
  const levels = ["graffi", "leggere", "gravi", "critiche", "mortali"];
  const updated = { ...currentLevels };
  let remaining = incomingWounds;
  for (const level of levels) {
    if (remaining <= 0) break;
    const available = capacities[level] - updated[level];
    if (available > 0) {
      const fill = Math.min(remaining, available);
      updated[level] += fill;
      remaining -= fill;
    }
  }
  if (remaining > 0) {
    updated.mortali += remaining;
  }
  return updated;
}
function matchesTalentCombatContext(context, combatCtx) {
  switch (context) {
    case "unarmed":
      return combatCtx.skillId === "lotta" && !combatCtx.weaponCategory;
    case "polearm_shield":
      return combatCtx.weaponType === "asta" && combatCtx.hasShield;
    case "mounted_melee":
      return !!combatCtx.mounted && !combatCtx.isRanged;
    case "armi_corte":
      return combatCtx.skillId === "armi_corte";
    case "melee_all":
      return !combatCtx.isRanged;
    case "unarmored":
      return !combatCtx.hasArmor;
    case "crossbow_10m":
      return combatCtx.skillId === "balestre" && (combatCtx.distance ?? Infinity) <= 10;
    case "bow":
      return combatCtx.skillId === "archi";
    case "fatigue_reaction":
      return combatCtx.reactionType === "fatica";
    default:
      return false;
  }
}
function computeTalentCombatBonus(talents, effectType, combatCtx) {
  let bonus = 0;
  for (const talent of Object.values(talents || {})) {
    if (!talent.unlocked) continue;
    for (const effect of talent.effects) {
      if (effect.type === effectType && matchesTalentCombatContext(effect.context, combatCtx)) {
        bonus += effect.bonus;
      }
    }
  }
  return bonus;
}
function computeAccompagnataParryBonus(parryMod1, parryMod2) {
  return parryMod1 + parryMod2;
}
function accompagnataTriggersDisarm() {
  return false;
}
function computeReactionRiflessiCost(threatSuccesses, reactionNetSuccesses) {
  return Math.max(0, threatSuccesses - Math.max(0, reactionNetSuccesses));
}
function computeFearOutcome(uncontestedSuccesses) {
  if (uncontestedSuccesses >= 6) return { level: 5, key: "collasso" };
  if (uncontestedSuccesses >= 5) return { level: 4, key: "crollo" };
  if (uncontestedSuccesses >= 4) return { level: 3, key: "terrorizzato" };
  if (uncontestedSuccesses >= 3) return { level: 2, key: "spaventato" };
  if (uncontestedSuccesses >= 2) return { level: 1, key: "scosso" };
  return { level: 0, key: null };
}
function computeSurprisePenalty(furtivitaSuccesses, percepzioneSuccesses) {
  return Math.max(0, furtivitaSuccesses - percepzioneSuccesses);
}
var UNARMED_STRIKES = {
  punch: { name: "Pugno", damageValue: 0, damageType: "B", parryModifier: -1, misura: "A", skillId: "lotta" },
  kick: { name: "Calcio", damageValue: 1, damageType: "B", parryModifier: -1, misura: "A", skillId: "lotta" }
};
function computeGrappleFollowUpBonus(grappleNetSuccesses) {
  return Math.max(0, grappleNetSuccesses);
}
function computeGrappleBonus(forzaGrade) {
  return Math.max(0, forzaGrade);
}
var GRAPPLE_FREE_STRIKE_BONUS = 1;
function computeLockBreakDifficulty(lockSuccesses) {
  return Math.max(1, lockSuccesses);
}
function computeCavalcareThreshold(trigger, woundsReceived = 0) {
  if (trigger === "untrained_mount") return 3;
  if (trigger === "struck") return Math.max(1, woundsReceived);
  return 3;
}
function computeUnhorsedOutcome(uncontestedSuccesses) {
  if (uncontestedSuccesses >= 3) return { type: "mount_flees" };
  return { type: "unhorsed" };
}
function computeDaCavalloWeaponBonus(pregi, isMounted) {
  if (!isMounted || !pregi) return 0;
  return pregi.includes("da_cavallo") ? 1 : 0;
}
function computeDaCavalloArmorBonus(pregi, isMounted) {
  if (!isMounted || !pregi) return 0;
  return pregi.includes("da_cavallo") ? 1 : 0;
}
var MOUNTED_GALLOP_RANGED_PENALTY = 3;
function computePesanteRiflessiCost(pregi) {
  if (!pregi || !Array.isArray(pregi)) return 0;
  return pregi.filter((p) => p === "pesante").length;
}
function computeWoundPenalty(currentLevels) {
  if (currentLevels.mortali > 0) return 3;
  if (currentLevels.critiche > 0) return 2;
  if (currentLevels.gravi > 0) return 1;
  return 0;
}
function computeCultureBonuses(trait1, trait2, trait3 = "") {
  const has = (id) => trait1 === id || trait2 === id || trait3 === id;
  return {
    audaciaMod: has("antica") ? 1 : 0,
    eruditaStudyBonus: has("erudita") ? 1 : 0,
    militareQualityEquipment: has("militare"),
    hasUrbanaCulture: has("urbana"),
    spiritualeSpirito: has("spirituale") ? 4 : 0,
    guerrescaGraffi: has("guerresca") ? 1 : 0,
    guerrescaLeggere: has("guerresca") ? 1 : 0,
    guerrescaFatBonus: has("guerresca") ? 1 : 0
  };
}
function computeFatigueLevel(faticaValue, faticaMax, { indomito = false, guerrescaBonus = 0, scalePenalties = false } = {}) {
  if (faticaMax <= 0) return { fatiguePenalty: 0, fatigueLevel: "fresco" };
  const stancoBound = Math.floor(faticaMax * 2 / 3) + (indomito ? 2 : 0) + guerrescaBonus;
  const sfinitoBound = Math.floor(faticaMax / 3) + (indomito ? 1 : 0);
  let fatiguePenalty = 0;
  let fatigueLevel = "fresco";
  if (faticaValue <= stancoBound) {
    if (faticaValue <= sfinitoBound) {
      fatiguePenalty = 2;
      fatigueLevel = "sfinito";
    } else {
      fatiguePenalty = 1;
      fatigueLevel = "stanco";
    }
  }
  if (scalePenalties) {
    fatiguePenalty = Math.max(0, fatiguePenalty - 1);
  }
  return { fatiguePenalty, fatigueLevel };
}
function computeBasePenalty(state) {
  return (state.fatiguePenalty || 0) + (state.woundPenalty || 0) + (state.armorPenalty || 0) + (state.encumbrancePenalty || 0);
}
function applySpiritoOverflow(patches, currentFatica) {
  if (patches["resources.spirito"] != null && patches["resources.spirito"] < 0) {
    const overflow = -patches["resources.spirito"];
    patches["resources.spirito"] = 0;
    patches["resources.fatica"] = (patches["resources.fatica"] ?? currentFatica) - overflow;
  }
}
function collectTalentDerivedEffects(talents) {
  const extraDiceBySkill = {};
  const resourceBonuses = { spirito: 0, fatica: 0, ferite: 0, riflessi: 0 };
  const spiritFormulas = [];
  const specials = /* @__PURE__ */ new Set();
  const flags = /* @__PURE__ */ new Set();
  for (const talent of Object.values(talents)) {
    if (!talent.unlocked) continue;
    for (const effect of talent.effects) {
      if (effect.type === "extraDice" && !effect.context) {
        extraDiceBySkill[effect.skill] = (extraDiceBySkill[effect.skill] || 0) + effect.bonus;
      }
      if (effect.type === "resourceBonus") {
        resourceBonuses[effect.resource] += effect.bonus;
      }
      if (effect.type === "spiritFormula") {
        spiritFormulas.push(effect);
      }
      if (effect.type === "special") specials.add(effect.key);
      if (effect.type === "flag") flags.add(effect.key);
    }
  }
  return { extraDiceBySkill, resourceBonuses, spiritFormulas, specials, flags };
}
function computeTalentChoiceExtraDice(specials, talentChoices) {
  const result = {};
  if (specials.has("extra_die_forza_or_volonta") && talentChoices.determinazione) {
    result[talentChoices.determinazione] = (result[talentChoices.determinazione] || 0) + 1;
  }
  if (specials.has("extra_die_any_skill") && talentChoices.eponimo) {
    result[talentChoices.eponimo] = (result[talentChoices.eponimo] || 0) + 1;
  }
  if (specials.has("extra_die_mercatura_teologia_usi") && talentChoices.ingegno) {
    result[talentChoices.ingegno] = (result[talentChoices.ingegno] || 0) + 1;
  }
  return result;
}

// node_modules/@federicomorando/sword-engine/src/sfida.mjs
var UDIENZA_SKILLS = ["arti_liberali", "autorita", "carisma", "raggirare", "usi_e_costumi"];
var SFIDA_PRESETS = {
  custom: { skills: [], soglia: 5, costo: "fatica", confronto: false, tentativi: 0, durata: "", hasObstacle: false, isMovement: false },
  scatto: { skills: ["agilita", "atletica"], soglia: 5, costo: "fatica", confronto: false, tentativi: 0, durata: "5s (10m)", hasObstacle: true, isMovement: true, minOneSuccess: true },
  inseguimento_breve: { skills: ["agilita", "atletica"], soglia: 5, costo: "fatica", confronto: true, tentativi: 0, durata: "5s (10m)", hasObstacle: true, isMovement: true, riflessiDrain: true },
  inseguimento_media: { skills: ["agilita", "atletica"], soglia: 5, costo: "fatica", confronto: true, tentativi: 0, durata: "1 ora (1km)", hasObstacle: true, isMovement: true, riflessiDrain: true },
  inseguimento_lunga: { skills: ["agilita", "atletica"], soglia: 5, costo: "fatica", confronto: true, tentativi: 0, durata: "1 giorno (10km)", hasObstacle: true, isMovement: true, riflessiDrain: true },
  udienza: { skills: UDIENZA_SKILLS, soglia: 3, costo: "spirito", confronto: false, tentativi: 0, durata: "1 giorno" }
};
var UDIENZA_RANKS = [
  { label: "SWORD.Sfida.UdienzaSignore", penalty: 2, soglia: 3 },
  { label: "SWORD.Sfida.UdienzaAbate", penalty: 2, soglia: 4 },
  { label: "SWORD.Sfida.UdienzaVescovo", penalty: 3, soglia: 6 },
  { label: "SWORD.Sfida.UdienzaArcivescovo", penalty: 3, soglia: 8 },
  { label: "SWORD.Sfida.UdienzaSovrano", penalty: 4, soglia: 10 },
  { label: "SWORD.Sfida.UdienzaPapa", penalty: 4, soglia: 12 }
];
function computeApproachModifiers(approach) {
  if (approach === "prudente") return { checkMod: -1, defMod: 1 };
  if (approach === "carica") return { checkMod: 1, defMod: -1 };
  return { checkMod: 0, defMod: 0 };
}
function computeTurnSuccesses(engineOutput, confronto) {
  if (confronto) return engineOutput.netSuccesses ?? 0;
  return engineOutput.basePassed ? engineOutput.finalSuccesses : 0;
}
function applyMinOneSuccess(turnSuccesses, minOneSuccess) {
  if (minOneSuccess && turnSuccesses < 1) {
    return { turnSuccesses: 1, shortfallFatica: 1 - turnSuccesses };
  }
  return { turnSuccesses, shortfallFatica: 0 };
}
function computeRiflessiDrain(turnSuccesses, confronto, riflessiDrain) {
  if (confronto && riflessiDrain && turnSuccesses < 0) {
    return Math.abs(turnSuccesses);
  }
  return 0;
}
function computeObstacleUncountered(obstacleThreat, finalSuccesses) {
  return Math.max(0, obstacleThreat - finalSuccesses);
}
function computeResourceDeductions({
  costo,
  faticaValue,
  spiritoValue,
  riflessiValue,
  shortfallFatica,
  riflessiDrainAmount,
  valoreUsed,
  combinedSpiritoCost,
  combinedFaticaCost,
  combinedRiflessiCost = 0,
  spiritoCancelPenalty,
  famaSpend,
  famaValue
}) {
  const updateData = {};
  let currentFatica = faticaValue;
  let currentSpirito = spiritoValue;
  let currentRiflessi = riflessiValue;
  if (costo === "fatica") {
    currentFatica = Math.max(0, currentFatica - 1);
    updateData["system.resources.fatica.value"] = currentFatica;
  } else {
    currentSpirito = Math.max(0, currentSpirito - 1);
    updateData["system.resources.spirito.value"] = currentSpirito;
  }
  if (shortfallFatica > 0) {
    currentFatica = Math.max(0, currentFatica - shortfallFatica);
    updateData["system.resources.fatica.value"] = currentFatica;
  }
  if (riflessiDrainAmount > 0) {
    currentRiflessi = Math.max(0, currentRiflessi - riflessiDrainAmount);
    updateData["system.resources.riflessi.value"] = currentRiflessi;
  }
  if (valoreUsed) {
    currentSpirito = Math.max(0, currentSpirito - 3);
    updateData["system.resources.spirito.value"] = currentSpirito;
  }
  if (combinedSpiritoCost > 0) {
    currentSpirito = Math.max(0, currentSpirito - combinedSpiritoCost);
    updateData["system.resources.spirito.value"] = currentSpirito;
  }
  if (combinedFaticaCost > 0) {
    currentFatica = Math.max(0, currentFatica - combinedFaticaCost);
    updateData["system.resources.fatica.value"] = currentFatica;
  }
  if (combinedRiflessiCost > 0) {
    currentRiflessi = Math.max(0, currentRiflessi - combinedRiflessiCost);
    updateData["system.resources.riflessi.value"] = currentRiflessi;
  }
  if (spiritoCancelPenalty > 0) {
    currentSpirito = Math.max(0, currentSpirito - spiritoCancelPenalty);
    updateData["system.resources.spirito.value"] = currentSpirito;
  }
  if (famaSpend > 0) {
    updateData["system.fama"] = (famaValue ?? 0) - famaSpend;
  }
  return updateData;
}
function checkLoopTermination(state, resourceValue) {
  if (state.tentativi > 0 && state.turnsUsed >= state.tentativi) return "maxAttempts";
  if (resourceValue <= 0) return "resourceExhausted";
  if (state.accumulatedSuccesses >= state.soglia) return "win";
  return null;
}

// node_modules/@federicomorando/sword-engine/src/ars-oratoria.mjs
var ORATORIA_SKILLS = ["autorita", "carisma", "raggirare", "arti_liberali"];
var RISK_REWARD_SKILLS = /* @__PURE__ */ new Set(["autorita", "raggirare"]);
function applyRiskReward(netSuccesses, skillId) {
  if (!RISK_REWARD_SKILLS.has(skillId)) {
    return { netSuccesses, riskRewardApplied: false };
  }
  if (netSuccesses > 0) {
    return { netSuccesses: netSuccesses + 1, riskRewardApplied: true };
  }
  if (netSuccesses < 0) {
    return { netSuccesses: netSuccesses - 1, riskRewardApplied: true };
  }
  return { netSuccesses, riskRewardApplied: false };
}
function computeArsOratoriaOutcome(accumulatedSuccesses, threshold) {
  if (accumulatedSuccesses >= threshold) {
    if (accumulatedSuccesses >= threshold * 2) {
      return { outcome: "win", tier: "full" };
    }
    return { outcome: "win", tier: "partial" };
  }
  if (accumulatedSuccesses <= -3) {
    if (accumulatedSuccesses <= -threshold) {
      return { outcome: "loss", tier: "catastrophic" };
    }
    return { outcome: "loss", tier: "severe" };
  }
  return { outcome: null, tier: null };
}
function computeOratoriaDrain(netSuccesses, playerWins) {
  const amount = Math.abs(netSuccesses);
  if (amount === 0) return { playerDrain: 0, opponentDrain: 0 };
  if (playerWins) {
    return { playerDrain: 0, opponentDrain: amount };
  }
  return { playerDrain: amount, opponentDrain: 0 };
}
function checkSenzaParole(playerRiflessi, opponentRiflessi) {
  return {
    player: playerRiflessi < 0,
    opponent: opponentRiflessi < 0
  };
}

// node_modules/@federicomorando/sword-engine/src/contacts.mjs
var CETO_VALUES = { umile: 0, popolano: 1, borghese: 2, nobile: 3 };
var SETTLEMENT_MAX = { inn: 1, village: 1, town: 2, city: 3, metropolis: 4 };
function computeContactPenalty({ actorCeto, contactCeto, hasUrbanaCulture, regionDistance, tradeRoute, settlementType }) {
  const actorVal = CETO_VALUES[actorCeto] ?? 0;
  const contactVal = CETO_VALUES[contactCeto] ?? 0;
  let cetoDistance = Math.abs(actorVal - contactVal);
  if (hasUrbanaCulture && cetoDistance > 0) cetoDistance -= 1;
  const effectiveRegionDist = tradeRoute || settlementType === "metropolis" ? 0 : regionDistance;
  const contactPenalty = cetoDistance + effectiveRegionDist;
  return { cetoDistance, effectiveRegionDist, contactPenalty };
}
function applyContactTalentBonus(familiarita, influenza, hasFamiliarityPlus1) {
  if (hasFamiliarityPlus1) {
    return { familiarita: familiarita + 1, influenza: influenza + 1 };
  }
  return { familiarita, influenza };
}
function computeMaxContacts(settlementType, hasExtraContacts) {
  const base = SETTLEMENT_MAX[settlementType] ?? 1;
  return hasExtraContacts ? base + 1 : base;
}

// node_modules/@federicomorando/sword-engine/src/interlude.mjs
var WORK_EARNINGS = {
  umile: { diceCount: 2, sides: 6, unit: "denari" },
  popolano: { diceCount: 6, sides: 6, unit: "denari" },
  borghese: { diceCount: 1, sides: 6, unit: "soldi" },
  nobile: { diceCount: 1, sides: 6, unit: "lire" }
};
var DENARI_PER = { denari: 1, soldi: 12, lire: 240 };
function computeBondCost(influenza) {
  if (influenza <= 0) return { diceCount: 2, unit: "soldi" };
  if (influenza === 1) return { diceCount: 6, unit: "soldi" };
  if (influenza === 2) return { diceCount: 1, unit: "lire" };
  if (influenza === 3) return { diceCount: 2, unit: "lire" };
  if (influenza === 4) return { diceCount: 4, unit: "lire" };
  return { diceCount: 4 + (influenza - 4) * 2, unit: "lire" };
}
function computeWorkEarnings(ceto) {
  return WORK_EARNINGS[ceto] ?? WORK_EARNINGS.umile;
}
function computeEarningsDenari(rollTotal, unit, doubleEarnings) {
  const rate = DENARI_PER[unit] ?? 1;
  const base = rollTotal * rate;
  return doubleEarnings ? base * 2 : base;
}

// node_modules/@federicomorando/sword-engine/src/constants.mjs
var VALORE_KEYS = ["fides", "impietas", "honor", "ego", "superstitio", "ratio"];
var APPROACH_MODS = {
  prudente: { checkMod: -1, defMod: 1 },
  corsa: { checkMod: 0, defMod: 0 },
  carica: { checkMod: 1, defMod: -1 }
};
var CREATURE_MISURA_MAP = {
  "Larghissima": "LL",
  "Larga": "L",
  "Media": "M",
  "Stretta": "S",
  "Abbrazzar": "A"
};
var BASE_SKILLS = ["volonta", "agilita", "carisma", "forza", "ragionamento", "percezione"];
var CETO_SKILLS = {
  common: ["agilita", "carisma", "forza", "percezione", "ragionamento", "volonta"],
  umile: ["armi_corte", "empatia", "furtivita", "guarigione", "professione", "raggirare", "sopravvivenza"],
  popolano: ["archi", "armi_comuni", "artigiano", "atletica", "lotta", "manualita", "usi_e_costumi"],
  borghese: ["alchimia", "arti_liberali", "balestre", "intrattenere", "mercatura", "professione", "storia_e_leggende"],
  nobile: ["armi_da_guerra", "arte_della_guerra", "arti_arcane", "autorita", "cavalcare", "professione", "teologia"]
};
var SKILL_MAP = {
  armi_comuni: "fortitudo",
  armi_da_guerra: "fortitudo",
  atletica: "fortitudo",
  forza: "fortitudo",
  lotta: "fortitudo",
  agilita: "celeritas",
  archi: "celeritas",
  armi_corte: "celeritas",
  furtivita: "celeritas",
  manualita: "celeritas",
  carisma: "gratia",
  intrattenere: "gratia",
  mercatura: "gratia",
  raggirare: "gratia",
  usi_e_costumi: "gratia",
  alchimia: "mens",
  arti_arcane: "mens",
  arti_liberali: "mens",
  ragionamento: "mens",
  storia_e_leggende: "mens",
  balestre: "prudentia",
  empatia: "prudentia",
  guarigione: "prudentia",
  percezione: "prudentia",
  sopravvivenza: "prudentia",
  arte_della_guerra: "audacia",
  autorita: "audacia",
  cavalcare: "audacia",
  teologia: "audacia",
  volonta: "audacia",
  artigiano: "varies",
  professione: "varies"
};
var SOCIAL_SKILLS = /* @__PURE__ */ new Set(["autorita", "carisma", "intrattenere", "raggirare", "empatia", "arti_liberali"]);
var CETO_ORDER = ["umile", "popolano", "borghese", "nobile"];
var CETO_FAMA = { umile: 0, popolano: 1, borghese: 2, nobile: 3 };
function allSkillIds() {
  return Object.keys(SKILL_MAP);
}
function mestiereCost(skillId, ceto, hasUrbana = false) {
  if (CETO_SKILLS.common.includes(skillId)) return null;
  if (BASE_SKILLS.includes(skillId)) return null;
  const idx = CETO_ORDER.indexOf(ceto);
  for (let dist = 0; dist < CETO_ORDER.length; dist++) {
    for (const d of [idx - dist, idx + dist]) {
      if (d < 0 || d >= CETO_ORDER.length) continue;
      if (CETO_SKILLS[CETO_ORDER[d]]?.includes(skillId)) {
        let cost = dist <= 1 ? 1 : dist;
        if (hasUrbana && cost > 1) cost -= 1;
        return cost;
      }
    }
  }
  return null;
}
function peGradeCost(fromGrade, toGrade) {
  if (toGrade <= fromGrade) return 0;
  let cost = 0;
  if (fromGrade === 0 && toGrade >= 1) {
    cost += 10;
    for (let g = 2; g <= toGrade; g++) cost += 2 * g;
  } else {
    for (let g = fromGrade + 1; g <= toGrade; g++) cost += 2 * g;
  }
  return cost;
}
function characteristicMod(score) {
  const d = score - 7;
  return d > 0 ? Math.ceil(d / 2) : Math.floor(d / 2);
}

// node_modules/@federicomorando/sword-engine/src/rest.mjs
function computeRestConditionPenalty(conditions) {
  let penalty = 0;
  if (conditions.outdoor) penalty += 1;
  if (conditions.noBedding) penalty += 2;
  if (conditions.coldFood) penalty += 1;
  penalty += conditions.coldWeather || 0;
  penalty += conditions.sleepDuration || 0;
  penalty += conditions.armorProtezione || 0;
  return penalty;
}
function resolveRest(engineOutput, state) {
  const { conditionPenalty, spiritoCancelPenalty, resources, woundLevels, audacia } = state;
  const successes = engineOutput.finalSuccesses;
  const currentSpirito = resources.spirito.value - spiritoCancelPenalty;
  const spiritoRecovery = Math.min(
    1 + Math.max(0, characteristicMod(audacia)),
    resources.spirito.max - currentSpirito
  );
  const patches = {};
  let faticaRecovery = 0;
  let woundsHealed = 0;
  let faticaLost = 0;
  if (engineOutput.basePassed && successes > 0) {
    faticaRecovery = Math.min(successes, resources.fatica.max - resources.fatica.value);
    patches["resources.fatica.value"] = resources.fatica.value + faticaRecovery;
    let toHeal = successes;
    const wl = { ...woundLevels };
    for (const level of ["mortali", "critiche", "gravi", "leggere", "graffi"]) {
      if (toHeal <= 0) break;
      const heal = Math.min(toHeal, wl[level]);
      if (heal > 0) {
        wl[level] -= heal;
        toHeal -= heal;
        woundsHealed += heal;
        patches[`woundLevels.${level}`] = wl[level];
      }
    }
  } else if (!engineOutput.basePassed) {
    const effectiveConditionPenalty = Math.max(0, conditionPenalty - spiritoCancelPenalty);
    faticaLost = Math.min(effectiveConditionPenalty, resources.fatica.value);
    if (faticaLost > 0) {
      patches["resources.fatica.value"] = resources.fatica.value - faticaLost;
    }
  }
  const spiritoAfterCost = spiritoCancelPenalty > 0 ? currentSpirito : resources.spirito.value;
  if (spiritoCancelPenalty > 0 || spiritoRecovery > 0) {
    patches["resources.spirito.value"] = Math.min(
      spiritoAfterCost + spiritoRecovery,
      resources.spirito.max
    );
  }
  return {
    passed: engineOutput.basePassed,
    successes,
    faticaRecovery,
    woundsHealed,
    faticaLost,
    spiritoRecovery,
    conditionPenalty,
    patches
  };
}
function resolveMeditation(engineOutput, state) {
  const { spiritoCancelPenalty, resources } = state;
  const successes = engineOutput.finalSuccesses;
  const currentSpirito = resources.spirito.value - spiritoCancelPenalty;
  const spiritoRecovery = engineOutput.basePassed ? Math.min(successes, resources.spirito.max - currentSpirito) : 0;
  const patches = {};
  if (spiritoCancelPenalty > 0 || spiritoRecovery > 0) {
    patches["resources.spirito.value"] = Math.min(
      currentSpirito + spiritoRecovery,
      resources.spirito.max
    );
  }
  return {
    passed: engineOutput.basePassed,
    successes,
    spiritoRecovery,
    patches
  };
}
function resolveFattucchiere(engineOutput, state) {
  const { spiritoCancelPenalty, resources } = state;
  const successes = engineOutput.finalSuccesses;
  const defenseValue = engineOutput.basePassed ? successes : 0;
  const patches = {};
  if (spiritoCancelPenalty > 0) {
    patches["resources.spirito.value"] = resources.spirito.value - spiritoCancelPenalty;
  }
  return {
    passed: engineOutput.basePassed,
    successes,
    defenseValue,
    patches
  };
}

// node_modules/@federicomorando/sword-engine/src/data/talents.mjs
var TALENT_CATEGORIES = [
  "audacia",
  "celeritas",
  "fortitudo",
  "gratia",
  "mens",
  "prudentia"
];
var TALENT_TRACK_CHARACTERISTIC = {
  audacia: "audacia",
  celeritas: "celeritas",
  fortitudo: "fortitudo",
  gratia: "gratia",
  mens: "mens",
  prudentia: "prudentia"
};
var TALENT_DEFS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // AUDACIA (base skill: Volontà) — 12 talents
  // ═══════════════════════════════════════════════════════════════════════════
  bassifondi: {
    name: "Bassifondi",
    category: "audacia",
    grade: 3,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 3 },
      { skill: "furtivita", grade: 3 },
      { skill: "raggirare", grade: 3 },
      { skill: "usi_e_costumi", grade: 3 }
    ],
    effects: [
      { type: "successBonus", context: "furtivita_urban", bonus: 1 },
      { type: "flag", key: "focus_umile_social" }
    ],
    effectsRaw: "Gain a bonus success on Furtivit\xE0 checks in cramped urban environments. Also gain an extra focus for social interactions with people of Umile class."
  },
  diligente: {
    name: "Diligente",
    category: "audacia",
    grade: 3,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 3 },
      { skill: "mercatura", grade: 3 },
      { type: "or", options: [{ skill: "arti_liberali", grade: 3 }, { skill: "teologia", grade: 3 }] },
      { type: "or", options: [{ skill: "artigiano", grade: 3 }, { skill: "professione", grade: 3 }] }
    ],
    effects: [
      { type: "special", key: "double_work_earnings" },
      { type: "special", key: "study_3pe" }
    ],
    effectsRaw: "During a work interlude, double the earnings; during a study interlude, gain 3 XP instead of 2."
  },
  lottatore: {
    name: "Lottatore",
    category: "audacia",
    grade: 3,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 3 },
      { skill: "atletica", grade: 3 },
      { skill: "lotta", grade: 3 },
      { type: "or", options: [{ skill: "armi_comuni", grade: 3 }, { skill: "armi_da_guerra", grade: 3 }] }
    ],
    effects: [
      { type: "damageMod", context: "unarmed", bonus: 1 },
      { type: "special", key: "free_grapple_for_fatica" }
    ],
    effectsRaw: "+1 damage with unarmed attacks. Once per turn, after an unarmed attack or defense, spend 1 Fatica for a free abrazzar action."
  },
  stratega: {
    name: "Stratega",
    category: "audacia",
    grade: 3,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 3 },
      { skill: "arte_della_guerra", grade: 3 },
      { skill: "autorita", grade: 3 },
      { type: "or", options: [{ skill: "armi_comuni", grade: 3 }, { skill: "armi_da_guerra", grade: 3 }] }
    ],
    effects: [
      { type: "special", key: "distribute_riflessi" }
    ],
    effectsRaw: "At the start of each turn, gain a pool of Riflessi points equal to your Arte della guerra grade, to redistribute among yourself and your companions."
  },
  alfiere: {
    name: "Alfiere",
    category: "audacia",
    grade: 4,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 4 },
      { skill: "autorita", grade: 4 },
      { type: "or", options: [{ skill: "arti_liberali", grade: 4 }, { skill: "teologia", grade: 4 }] }
    ],
    effects: [
      { type: "special", key: "valori_activation_plus1" },
      { type: "charBonus", characteristic: "audacia", bonus: 1 }
    ],
    effectsRaw: "When you put Valori into play, you may count them one point higher for bonus successes. +1 Audacia."
  },
  fiore_della_cavalleria: {
    name: "Fiore della cavalleria",
    category: "audacia",
    grade: 4,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 4 },
      { skill: "arte_della_guerra", grade: 4 },
      { skill: "cavalcare", grade: 4 }
    ],
    effects: [
      { type: "special", key: "formation_bonus" }
    ],
    effectsRaw: "In formation (each member within 5 meters, at least 2 companions), all gain a bonus success on attacks, defenses, and Reactions. With a Valore in play, the bonus extends to companions who share it."
  },
  lotta_in_arme: {
    name: "Lotta in arme",
    category: "audacia",
    grade: 4,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 4 },
      { skill: "lotta", grade: 4 },
      { type: "or", options: [{ skill: "armi_da_guerra", grade: 4 }, { skill: "armi_comuni", grade: 4 }] }
    ],
    effects: [
      { type: "special", key: "weapons_at_close_range" }
    ],
    effectsRaw: "You may use weapons of Media reach or smaller even at Stretta reach or in abrazzar, keeping their damage and Parata."
  },
  vitalita: {
    name: "Vitalit\xE0",
    category: "audacia",
    grade: 4,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 4 },
      { skill: "atletica", grade: 4 },
      { type: "or", options: [{ skill: "lotta", grade: 4 }, { skill: "sopravvivenza", grade: 4 }] }
    ],
    effects: [
      { type: "special", key: "scale_fatigue_penalties" },
      { type: "charBonus", characteristic: "fortitudo", bonus: 1 }
    ],
    effectsRaw: "Reduce Fatica-related penalties by one success. +1 Fortitudo."
  },
  araldo: {
    name: "Araldo",
    category: "audacia",
    grade: 5,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 5 },
      { skill: "autorita", grade: 5 }
    ],
    effects: [
      { type: "special", key: "companions_reaction_resolve_bonus" },
      { type: "charBonus", characteristic: "audacia", bonus: 1 }
    ],
    effectsRaw: "Companions with whom you share at least one Valore gain a bonus success on Reactions and Risolutezza contests. +1 Audacia."
  },
  condottiero: {
    name: "Condottiero",
    category: "audacia",
    grade: 5,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 5 },
      { skill: "arte_della_guerra", grade: 5 }
    ],
    effects: [
      { type: "special", key: "success_reserve_adg" }
    ],
    effectsRaw: "Gain a pool of bonus successes equal to your Arte della guerra grade. You may assign 1 bonus success per turn to any check by you or a companion."
  },
  illuminazione: {
    name: "Illuminazione",
    category: "audacia",
    grade: 5,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 5 },
      { type: "or", options: [{ skill: "arti_arcane", grade: 5 }, { skill: "teologia", grade: 5 }] }
    ],
    effects: [
      { type: "spiritFormula", mode: "addScore", characteristic: "mens" }
    ],
    effectsRaw: "Increase Spirito points by an amount equal to your Mens score."
  },
  volitivo: {
    name: "Volitivo",
    category: "audacia",
    grade: 6,
    baseSkill: "volonta",
    requirements: [
      { skill: "volonta", grade: 6 },
      { type: "or", options: [{ skill: "intrattenere", grade: 6 }, { skill: "raggirare", grade: 6 }] }
    ],
    effects: [
      { type: "charBonus", characteristic: "gratia", bonus: 1 },
      { type: "special", key: "modify_valori" }
    ],
    effectsRaw: "+1 Gratia. You may remove or add a Tentazione. You may change a Valore by one point even beyond its limit."
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // CELERITAS (base skill: Agilità) — 12 talents
  // ═══════════════════════════════════════════════════════════════════════════
  combattimento_con_due_armi: {
    name: "Combattimento con due armi",
    category: "celeritas",
    grade: 3,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 3 },
      { skill: "atletica", grade: 3 },
      { skill: "armi_corte", grade: 3 },
      { type: "choice_any", options: [
        { skill: "armi_comuni", grade: 3 },
        { skill: "armi_da_guerra", grade: 3 },
        { skill: "lotta", grade: 3 }
      ], count: 1 }
    ],
    effects: [
      { type: "special", key: "free_secondary_attack" }
    ],
    effectsRaw: "Gain one free action per turn with a Stretta-reach weapon in your off hand, at a one-success penalty."
  },
  equitazione: {
    name: "Equitazione",
    category: "celeritas",
    grade: 3,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 3 },
      { skill: "atletica", grade: 3 },
      { skill: "cavalcare", grade: 3 },
      { skill: "empatia", grade: 3 }
    ],
    effects: [
      { type: "special", key: "mounted_two_hand" },
      { type: "successBonus", context: "mounted_melee", bonus: 1 }
    ],
    effectsRaw: "You may use two-handed weapons (including bows and crossbows) while mounted. -1 mount movement penalty. +1 success on mounted melee attacks and defenses."
  },
  grazia_felina: {
    name: "Grazia felina",
    category: "celeritas",
    grade: 3,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 3 },
      { skill: "atletica", grade: 3 },
      { skill: "furtivita", grade: 3 },
      { type: "or", options: [{ skill: "armi_corte", grade: 3 }, { skill: "manualita", grade: 3 }] }
    ],
    effects: [
      { type: "resourceBonus", resource: "riflessi", bonus: 1 },
      { type: "extraDice", skill: "agilita", bonus: 1 }
    ],
    effectsRaw: "+1 Riflessi (permanent). One extra die in Agilit\xE0."
  },
  lingua_sciolta: {
    name: "Lingua Sciolta",
    category: "celeritas",
    grade: 3,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 3 },
      { skill: "intrattenere", grade: 3 },
      { skill: "raggirare", grade: 3 },
      { type: "or", options: [{ skill: "autorita", grade: 3 }, { skill: "empatia", grade: 3 }] }
    ],
    effects: [
      { type: "special", key: "ars_oratoria_riflessi_drain" }
    ],
    effectsRaw: "Once per Ars oratoria challenge, you may cause the other party to lose Riflessi equal to your successes on a Carisma check."
  },
  senso_del_pericolo: {
    name: "Senso del pericolo",
    category: "celeritas",
    grade: 4,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 4 },
      { skill: "furtivita", grade: 4 },
      { skill: "sopravvivenza", grade: 4 }
    ],
    effects: [
      { type: "charBonus", characteristic: "celeritas", bonus: 1 },
      { type: "special", key: "draw_weapon_3riflessi" }
    ],
    effectsRaw: "+1 Celeritas. You may draw a weapon by spending 3 Riflessi points."
  },
  sicario: {
    name: "Sicario",
    category: "celeritas",
    grade: 4,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 4 },
      { skill: "furtivita", grade: 4 },
      { skill: "armi_corte", grade: 4 }
    ],
    effects: [
      { type: "special", key: "surprise_bonus_damage_bleeding" }
    ],
    effectsRaw: "When you catch an opponent by surprise, you deal extra damage equal to your Celeritas and Prudentia modifiers and cause bleeding."
  },
  stile_a_due_armi: {
    name: "Stile a due armi",
    category: "celeritas",
    grade: 4,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 4 },
      { skill: "armi_corte", grade: 4 },
      { type: "or", options: [{ skill: "armi_da_guerra", grade: 4 }, { skill: "lotta", grade: 4 }] }
    ],
    effects: [
      { type: "special", key: "two_medium_weapons" }
    ],
    effectsRaw: "You may fight with two one-handed weapons of Media reach, with one free action per turn (at a one-success penalty)."
  },
  tempismo: {
    name: "Tempismo",
    category: "celeritas",
    grade: 4,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 4 },
      { skill: "armi_da_guerra", grade: 4 },
      { skill: "armi_comuni", grade: 4 }
    ],
    effects: [
      { type: "special", key: "win_ties_riflessi_recovery_extra_action" }
    ],
    effectsRaw: "On a Riflessi tie you act before opponents. At the start of each turn recover 1 Riflessi point. You may spend 3 Riflessi for an additional action."
  },
  maestro_di_lotta: {
    name: "Maestro di lotta",
    category: "celeritas",
    grade: 5,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 5 },
      { skill: "lotta", grade: 5 }
    ],
    effects: [
      { type: "damageMod", context: "unarmed", bonus: 1 },
      { type: "charBonus", characteristic: "fortitudo", bonus: 1 }
    ],
    effectsRaw: "+1 damage with strikes (punches and kicks). +1 Fortitudo."
  },
  maestro_di_scudo: {
    name: "Maestro di scudo",
    category: "celeritas",
    grade: 5,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 5 },
      { skill: "armi_da_guerra", grade: 5 }
    ],
    effects: [
      { type: "special", key: "shield_parry_as_reaction" }
    ],
    effectsRaw: "You may parry with a shield using a Reaction instead of an action, spending Riflessi equal to the attack's successes."
  },
  ombra: {
    name: "Ombra",
    category: "celeritas",
    grade: 5,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 5 },
      { skill: "furtivita", grade: 5 }
    ],
    effects: [
      { type: "special", key: "riflessi_cost_minus1" },
      { type: "special", key: "spirito_for_reactions" }
    ],
    effectsRaw: "Any Riflessi expenditure costs 1 point less (minimum 0). You may perform Reactions by spending Spirito instead of Riflessi."
  },
  fulmine_di_guerra: {
    name: "Fulmine di guerra",
    category: "celeritas",
    grade: 6,
    baseSkill: "agilita",
    requirements: [
      { skill: "agilita", grade: 6 },
      { type: "choice_any", options: [
        { skill: "armi_comuni", grade: 6 },
        { skill: "armi_corte", grade: 6 },
        { skill: "armi_da_guerra", grade: 6 },
        { skill: "lotta", grade: 6 }
      ], count: 2 }
    ],
    effects: [
      { type: "charBonus", characteristic: "prudentia", bonus: 1 },
      { type: "special", key: "extra_attack_3riflessi" }
    ],
    effectsRaw: "+1 Prudentia. Each turn you may spend 3 Riflessi for an additional attack or parry."
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // FORTITUDO (base skill: Forza) — 12 talents
  // ═══════════════════════════════════════════════════════════════════════════
  giostrare: {
    name: "Giostrare",
    category: "fortitudo",
    grade: 3,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 3 },
      { skill: "armi_comuni", grade: 3 },
      { skill: "armi_da_guerra", grade: 3 },
      { skill: "cavalcare", grade: 3 }
    ],
    effects: [
      { type: "special", key: "mounted_shield_lance" },
      { type: "special", key: "double_charge_strength" }
    ],
    effectsRaw: "You may fight mounted with a shield and a cavalry lance or a one-handed weapon. On a charge, double the bonus from the mount's Forza grades."
  },
  incoccare: {
    name: "Incoccare",
    category: "fortitudo",
    grade: 3,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 3 },
      { skill: "atletica", grade: 3 },
      { skill: "manualita", grade: 3 },
      { type: "or", options: [{ skill: "archi", grade: 3 }, { skill: "balestre", grade: 3 }] }
    ],
    effects: [
      { type: "special", key: "reload_minus1" }
    ],
    effectsRaw: "Reduce the reload time of weapons for which you meet the prerequisite grades by one action. If it reaches 0, reloading becomes a free action (once per turn)."
  },
  minaccioso: {
    name: "Minaccioso",
    category: "fortitudo",
    grade: 3,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 3 },
      { skill: "atletica", grade: 3 },
      { skill: "autorita", grade: 3 },
      { skill: "lotta", grade: 3 }
    ],
    effects: [
      { type: "extraDice", skill: "autorita", bonus: 1, context: "intimidation" }
    ],
    effectsRaw: "A mere glance is enough to intimidate someone: gain an extra die in Autorit\xE0."
  },
  sbracciata: {
    name: "Sbracciata",
    category: "fortitudo",
    grade: 3,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 3 },
      { skill: "atletica", grade: 3 },
      { skill: "lotta", grade: 3 },
      { type: "or", options: [{ skill: "armi_comuni", grade: 3 }, { skill: "armi_da_guerra", grade: 3 }] }
    ],
    effects: [
      { type: "special", key: "spend_fatica_plus1_damage" }
    ],
    effectsRaw: "When making a melee weapon attack, you may spend 1 Fatica: damage increases by +1."
  },
  carovaniere: {
    name: "Carovaniere",
    category: "fortitudo",
    grade: 4,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 4 },
      { skill: "mercatura", grade: 4 },
      { skill: "sopravvivenza", grade: 4 }
    ],
    effects: [
      { type: "special", key: "party_travel_bonus" }
    ],
    effectsRaw: "While traveling, you and your companions gain a bonus success on Percezione checks and Fatica Reactions. The company may ignore 1 point of Movement penalty from terrain or weather."
  },
  fanteria: {
    name: "Fanteria",
    category: "fortitudo",
    grade: 4,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 4 },
      { skill: "armi_comuni", grade: 4 },
      { skill: "armi_da_guerra", grade: 4 }
    ],
    effects: [
      { type: "special", key: "one_hand_polearms_shield" },
      { type: "damageMod", context: "polearm_shield", bonus: 1 },
      { type: "parryMod", context: "polearm_shield", bonus: 1 }
    ],
    effectsRaw: "You may wield infantry spears, pikes, bills, and polearms one-handed, with a shield in the other hand. +1 damage with the polearm and +1 Parata with the shield."
  },
  mente_del_guerriero: {
    name: "Mente del guerriero",
    category: "fortitudo",
    grade: 4,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 4 },
      { skill: "arti_liberali", grade: 4 },
      { skill: "lotta", grade: 4 }
    ],
    effects: [
      { type: "special", key: "scale_wound_penalties" },
      { type: "charBonus", characteristic: "audacia", bonus: 1 }
    ],
    effectsRaw: "Reduce wound penalties by one success. +1 Audacia."
  },
  mitridatismo: {
    name: "Mitridatismo",
    category: "fortitudo",
    grade: 4,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 4 },
      { skill: "guarigione", grade: 4 }
    ],
    effects: [
      { type: "successBonus", context: "poison_reaction", bonus: 2 }
    ],
    effectsRaw: "+2 bonus successes on Reactions against poisons."
  },
  bestia_da_soma: {
    name: "Bestia da soma",
    category: "fortitudo",
    grade: 5,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 5 },
      { skill: "atletica", grade: 5 }
    ],
    effects: [
      { type: "charBonus", characteristic: "fortitudo", bonus: 1 },
      { type: "special", key: "extra_fatica_per_level" },
      { type: "special", key: "halve_excess_fatica_wounds" }
    ],
    effectsRaw: "+1 Fortitudo. +1 extra Fatica point at each level. If you exhaust Fatica, further losses are halved before becoming wounds."
  },
  duellante: {
    name: "Duellante",
    category: "fortitudo",
    grade: 5,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 5 },
      { skill: "armi_corte", grade: 5 }
    ],
    effects: [
      { type: "parryMod", context: "armi_corte", bonus: 1 },
      { type: "special", key: "quick_draw_armi_corte" },
      { type: "special", key: "modify_misura_on_riflessi_loss" }
    ],
    effectsRaw: "+1 Parata with short weapons. You may spend 3 Riflessi to draw or act with a short weapon. If opponents lose Riflessi, you may change reach or withdraw without free attacks."
  },
  maestro_darma: {
    name: "Maestro d'arma",
    category: "fortitudo",
    grade: 5,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 5 },
      { skill: "armi_da_guerra", grade: 5 },
      { skill: "armi_comuni", grade: 5 }
    ],
    effects: [
      { type: "special", key: "weapon_mastery_sword" },
      { type: "special", key: "weapon_mastery_axe" },
      { type: "special", key: "weapon_mastery_polearm" }
    ],
    effectsRaw: "Sword: one free parry per turn. Axe/mace: each wound also causes -1 Fatica and -1 Riflessi. Polearms: +1 success to defend or restore reach."
  },
  macchina_da_guerra: {
    name: "Macchina da guerra",
    category: "fortitudo",
    grade: 6,
    baseSkill: "forza",
    requirements: [
      { skill: "forza", grade: 6 },
      { skill: "lotta", grade: 6 }
    ],
    effects: [
      { type: "charBonus", characteristic: "celeritas", bonus: 1 },
      { type: "damageMod", context: "melee_all", bonus: 1 },
      { type: "parryMod", context: "melee_all", bonus: 1 },
      { type: "protectionMod", context: "unarmored", bonus: 1 }
    ],
    effectsRaw: "+1 Celeritas. +1 damage and +1 Parata with all melee weapons. Protezione 1 without armor."
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // GRATIA (base skill: Carisma) — 12 talents
  // ═══════════════════════════════════════════════════════════════════════════
  affarista: {
    name: "Affarista",
    category: "gratia",
    grade: 3,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 3 },
      { skill: "mercatura", grade: 3 },
      { skill: "raggirare", grade: 3 },
      { skill: "usi_e_costumi", grade: 3 }
    ],
    effects: [
      { type: "special", key: "double_trade_earnings" },
      { type: "flag", key: "focus_borghese_social" }
    ],
    effectsRaw: "Double your income and work earnings. Focus for social interactions with people of Borghese class."
  },
  cortesia: {
    name: "Cortesia",
    category: "gratia",
    grade: 3,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 3 },
      { skill: "arti_liberali", grade: 3 },
      { skill: "autorita", grade: 3 },
      { type: "or", options: [{ skill: "intrattenere", grade: 3 }, { skill: "raggirare", grade: 3 }] }
    ],
    effects: [
      { type: "special", key: "add_fides_honor_to_fama" }
    ],
    effectsRaw: "You may add Fides or Honor to your Fama when you put it into play."
  },
  fattucchiere: {
    name: "Fattucchiere",
    category: "gratia",
    grade: 3,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 3 },
      { skill: "alchimia", grade: 3 },
      { skill: "arti_arcane", grade: 3 },
      { skill: "raggirare", grade: 3 }
    ],
    effects: [
      { type: "special", key: "fake_magic_superstitio_defense" }
    ],
    effectsRaw: "With a Raggirare check, anyone who wishes to harm you must win a Superstitio Risolutezza contest against your successes."
  },
  trovatore: {
    name: "Trovatore",
    category: "gratia",
    grade: 3,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 3 },
      { skill: "intrattenere", grade: 3 },
      { skill: "storia_e_leggende", grade: 3 },
      { skill: "usi_e_costumi", grade: 3 }
    ],
    effects: [
      { type: "extraDice", skill: "arti_liberali", bonus: 1 },
      { type: "flag", key: "focus_nobile_social" }
    ],
    effectsRaw: "One extra die in Arti liberali. Focus for social interactions with people of Nobile class."
  },
  compagni_fedeli: {
    name: "Compagni fedeli",
    category: "gratia",
    grade: 4,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 4 },
      { skill: "empatia", grade: 4 },
      { type: "or", options: [{ skill: "cavalcare", grade: 4 }, { skill: "sopravvivenza", grade: 4 }] }
    ],
    effects: [
      { type: "special", key: "animal_companion_boost" },
      { type: "special", key: "spend_pe_for_animal_skill" }
    ],
    effectsRaw: "Any animal you own gains an extra advantage. You may spend XP (double the successes, max 6) to enhance the animals' abilities."
  },
  retore: {
    name: "Retore",
    category: "gratia",
    grade: 4,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 4 },
      { skill: "arti_liberali", grade: 4 },
      { skill: "intrattenere", grade: 4 }
    ],
    effects: [
      { type: "special", key: "no_riflessi_combined_ars_oratoria" }
    ],
    effectsRaw: "In oratory challenges you do not spend Riflessi points to perform combined maneuvers."
  },
  seduttore: {
    name: "Seduttore",
    category: "gratia",
    grade: 4,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 4 },
      { skill: "intrattenere", grade: 4 },
      { skill: "raggirare", grade: 4 }
    ],
    effects: [
      { type: "charBonus", characteristic: "gratia", bonus: 1 }
    ],
    effectsRaw: "+1 Gratia."
  },
  senza_volto: {
    name: "Senza volto",
    category: "gratia",
    grade: 4,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 4 },
      { skill: "furtivita", grade: 4 },
      { skill: "raggirare", grade: 4 }
    ],
    effects: [
      { type: "special", key: "reduce_fama_by3" }
    ],
    effectsRaw: "If you wish, at any time you may treat your Fama as 3 points lower."
  },
  intuito: {
    name: "Intuito",
    category: "gratia",
    grade: 5,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 5 },
      { skill: "arti_liberali", grade: 5 }
    ],
    effects: [
      { type: "charBonus", characteristic: "mens", bonus: 1 },
      { type: "special", key: "ars_oratoria_threshold_minus1" }
    ],
    effectsRaw: "+1 Mens. The threshold for oratory challenges decreases by one point."
  },
  ispirare: {
    name: "Ispirare",
    category: "gratia",
    grade: 5,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 5 },
      { skill: "empatia", grade: 5 },
      { type: "or", options: [{ skill: "intrattenere", grade: 5 }, { skill: "autorita", grade: 5 }] }
    ],
    effects: [
      { type: "special", key: "spend_spirito_heal_companions" }
    ],
    effectsRaw: "Once per day, you may spend Spirito (max equal to the shared Valore) to let companions recover wounds (Graffi and Ferite Leggere), Fatica, and Spirito."
  },
  rete_di_contatti: {
    name: "Rete di contatti",
    category: "gratia",
    grade: 5,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 5 },
      { skill: "usi_e_costumi", grade: 5 }
    ],
    effects: [
      { type: "special", key: "contact_familiarity_plus1" },
      { type: "special", key: "extra_contacts" }
    ],
    effectsRaw: "+1 familiarity and influence with one Contatto. Each settlement hosts one additional Contatto. Once a month you may replace a Contatto."
  },
  maesta: {
    name: "Maest\xE0",
    category: "gratia",
    grade: 6,
    baseSkill: "carisma",
    requirements: [
      { skill: "carisma", grade: 6 },
      { skill: "autorita", grade: 6 }
    ],
    effects: [
      { type: "charBonus", characteristic: "audacia", bonus: 1 }
    ],
    effectsRaw: "+1 Audacia."
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // MENS (base skill: Ragionamento) — 12 talents
  // ═══════════════════════════════════════════════════════════════════════════
  determinazione: {
    name: "Determinazione",
    category: "mens",
    grade: 3,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 3 },
      { skill: "autorita", grade: 3 },
      { type: "or", options: [{ skill: "arti_liberali", grade: 3 }, { skill: "mercatura", grade: 3 }] },
      { type: "or", options: [{ skill: "atletica", grade: 3 }, { skill: "lotta", grade: 3 }] }
    ],
    effects: [
      { type: "special", key: "extra_die_forza_or_volonta" }
    ],
    effectsRaw: "Gain an extra die in Forza or Volont\xE0."
  },
  ingegno: {
    name: "Ingegno",
    category: "mens",
    grade: 3,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 3 },
      { skill: "arti_liberali", grade: 3 },
      { skill: "storia_e_leggende", grade: 3 },
      { type: "or", options: [{ skill: "artigiano", grade: 3 }, { skill: "professione", grade: 3 }] }
    ],
    effects: [
      { type: "special", key: "extra_die_mercatura_teologia_usi" },
      { type: "special", key: "learn_skill_6pe" }
    ],
    effectsRaw: "One extra die in a skill of your choice among Mercatura, Teologia, or Usi e costumi. The cost to learn a new skill drops to 6 XP."
  },
  medico_da_campo: {
    name: "Medico da campo",
    category: "mens",
    grade: 3,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 3 },
      { skill: "empatia", grade: 3 },
      { skill: "guarigione", grade: 3 },
      { skill: "sopravvivenza", grade: 3 }
    ],
    effects: [
      { type: "special", key: "halve_wound_healing_time" },
      { type: "special", key: "reduce_cure_penalty" }
    ],
    effectsRaw: "Halve the time to treat wounds. -1 success to treatment penalties per wound level and for lack of equipment."
  },
  meditazione: {
    name: "Meditazione",
    category: "mens",
    grade: 3,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 3 },
      { skill: "arti_liberali", grade: 3 },
      { skill: "teologia", grade: 3 },
      { type: "or", options: [{ skill: "arti_arcane", grade: 3 }, { skill: "empatia", grade: 3 }] }
    ],
    effects: [
      { type: "spiritFormula", mode: "addModifier", characteristics: ["mens", "prudentia"] },
      { type: "special", key: "meditation_spirito_recovery" }
    ],
    effectsRaw: "You may add your Mens and Prudentia bonuses when calculating Spirito points. You may meditate for one hour to recover Spirito equal to your successes on a Ragionamento check."
  },
  giuramento_di_ippocrate: {
    name: "Giuramento di Ippocrate",
    category: "mens",
    grade: 4,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 4 },
      { skill: "alchimia", grade: 4 },
      { skill: "guarigione", grade: 4 }
    ],
    effects: [
      { type: "extraDice", skill: "alchimia", bonus: 1 },
      { type: "extraDice", skill: "guarigione", bonus: 1 }
    ],
    effectsRaw: "One extra die in Alchimia and Guarigione."
  },
  mondano: {
    name: "Mondano",
    category: "mens",
    grade: 4,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 4 },
      { skill: "arti_liberali", grade: 4 },
      { skill: "usi_e_costumi", grade: 4 }
    ],
    effects: [
      { type: "extraDice", skill: "carisma", bonus: 1 }
    ],
    effectsRaw: "One extra die in Carisma."
  },
  vagabondo: {
    name: "Vagabondo",
    category: "mens",
    grade: 4,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 4 },
      { skill: "storia_e_leggende", grade: 4 },
      { skill: "usi_e_costumi", grade: 4 }
    ],
    effects: [
      { type: "special", key: "third_cultural_trait" },
      { type: "charBonus", characteristic: "mens", bonus: 1 }
    ],
    effectsRaw: "You may choose a third cultural trait. +1 Mens."
  },
  vita_di_strada: {
    name: "Vita di strada",
    category: "mens",
    grade: 4,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 4 },
      { skill: "furtivita", grade: 4 },
      { skill: "usi_e_costumi", grade: 4 }
    ],
    effects: [
      { type: "extraDice", skill: "percezione", bonus: 1 }
    ],
    effectsRaw: "One extra die in Percezione."
  },
  chiave_della_mappa: {
    name: "Chiave della mappa",
    category: "mens",
    grade: 5,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 5 },
      { skill: "artigiano", grade: 5 }
    ],
    effects: [
      { type: "special", key: "create_extraordinary_items" }
    ],
    effectsRaw: "You may craft Straordinaria-quality items with Artigiano or Alchimia."
  },
  colpo_docchio: {
    name: "Colpo d'occhio",
    category: "mens",
    grade: 5,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 5 },
      { type: "or", options: [{ skill: "manualita", grade: 5 }, { skill: "sopravvivenza", grade: 5 }] }
    ],
    effects: [
      { type: "charBonus", characteristic: "prudentia", bonus: 1 }
    ],
    effectsRaw: "+1 Prudentia."
  },
  eponimo: {
    name: "Eponimo",
    category: "mens",
    grade: 5,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 5 },
      { skill: "arti_liberali", grade: 5 }
    ],
    effects: [
      { type: "special", key: "extra_die_any_skill" }
    ],
    effectsRaw: "Assign an extra die to any one skill."
  },
  custode_del_sapere: {
    name: "Custode del sapere",
    category: "mens",
    grade: 6,
    baseSkill: "ragionamento",
    requirements: [
      { skill: "ragionamento", grade: 6 },
      { type: "or", options: [{ skill: "arti_arcane", grade: 6 }, { skill: "teologia", grade: 6 }] }
    ],
    effects: [
      { type: "charBonus", characteristic: "mens", bonus: 1 }
    ],
    effectsRaw: "+1 Mens."
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // PRUDENTIA (base skill: Percezione) — 12 talents
  // ═══════════════════════════════════════════════════════════════════════════
  arrocco: {
    name: "Arrocco",
    category: "prudentia",
    grade: 3,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 3 },
      { skill: "arte_della_guerra", grade: 3 },
      { skill: "sopravvivenza", grade: 3 },
      { type: "choice_any", options: [
        { skill: "archi", grade: 3 },
        { skill: "balestre", grade: 3 },
        { skill: "armi_corte", grade: 3 },
        { skill: "armi_comuni", grade: 3 },
        { skill: "armi_da_guerra", grade: 3 },
        { skill: "lotta", grade: 3 }
      ], count: 1 }
    ],
    effects: [
      { type: "successBonus", context: "battlefield_study", bonus: 1 },
      { type: "successBonus", context: "camp_preparation", bonus: 1 }
    ],
    effectsRaw: "+1 success in Arte della guerra to study the battlefield and in Sopravvivenza to prepare camp."
  },
  avanguardia: {
    name: "Avanguardia",
    category: "prudentia",
    grade: 3,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 3 },
      { skill: "autorita", grade: 3 },
      { skill: "furtivita", grade: 3 },
      { skill: "sopravvivenza", grade: 3 }
    ],
    effects: [
      { type: "special", key: "sacrifice_success_companion_die" }
    ],
    effectsRaw: "On Furtivit\xE0, Percezione, or Sopravvivenza checks you may sacrifice one of your successes to grant an extra die to companions' checks."
  },
  battipista: {
    name: "Battipista",
    category: "prudentia",
    grade: 3,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 3 },
      { skill: "atletica", grade: 3 },
      { skill: "sopravvivenza", grade: 3 },
      { skill: "usi_e_costumi", grade: 3 }
    ],
    effects: [
      { type: "special", key: "travel_distance_bonus" },
      { type: "successBonus", context: "fatigue_reaction", bonus: 1 }
    ],
    effectsRaw: "Increase the km covered in a day of travel by your Sopravvivenza grades. +1 success on companions' Fatica Reactions."
  },
  scienza_antica: {
    name: "Scienza antica",
    category: "prudentia",
    grade: 3,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 3 },
      { skill: "alchimia", grade: 3 },
      { skill: "arti_arcane", grade: 3 },
      { skill: "artigiano", grade: 3 }
    ],
    effects: [
      { type: "extraDice", skill: "artigiano", bonus: 1 }
    ],
    effectsRaw: "One extra die in all Artigiano skills."
  },
  aggiustare_il_tiro: {
    name: "Aggiustare il tiro",
    category: "prudentia",
    grade: 4,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 4 },
      { skill: "archi", grade: 4 },
      { skill: "atletica", grade: 4 }
    ],
    effects: [
      { type: "special", key: "successive_shot_bonus" }
    ],
    effectsRaw: "The second arrow shot consecutively at the same target, and every subsequent arrow, have a bonus success."
  },
  bruciapelo: {
    name: "Bruciapelo",
    category: "prudentia",
    grade: 4,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 4 },
      { skill: "balestre", grade: 4 }
    ],
    effects: [
      { type: "successBonus", context: "crossbow_10m", bonus: 1 },
      { type: "damageMod", context: "crossbow_10m", bonus: 1 }
    ],
    effectsRaw: "When shooting a crossbow within 10 meters: +1 success on the check and +1 damage."
  },
  cercatore: {
    name: "Cercatore",
    category: "prudentia",
    grade: 4,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 4 },
      { skill: "furtivita", grade: 4 },
      { skill: "sopravvivenza", grade: 4 }
    ],
    effects: [
      { type: "charBonus", characteristic: "prudentia", bonus: 1 }
    ],
    effectsRaw: "+1 Prudentia."
  },
  tattiche_di_guerriglia: {
    name: "Tattiche di Guerriglia",
    category: "prudentia",
    grade: 4,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 4 },
      { skill: "arte_della_guerra", grade: 4 },
      { skill: "sopravvivenza", grade: 4 }
    ],
    effects: [
      { type: "special", key: "party_furtivita_woodland" },
      { type: "special", key: "ambush_success_reserve" }
    ],
    effectsRaw: "Companions gain +1 success on Furtivit\xE0 checks in woods and forests. When ambushing, gain a pool of bonus successes equal to your Sopravvivenza grade."
  },
  armonioso: {
    name: "Armonioso",
    category: "prudentia",
    grade: 5,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 5 },
      { skill: "atletica", grade: 5 }
    ],
    effects: [
      { type: "charBonus", characteristic: "celeritas", bonus: 1 }
    ],
    effectsRaw: "+1 Celeritas."
  },
  cecchino: {
    name: "Cecchino",
    category: "prudentia",
    grade: 5,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 5 },
      { skill: "balestre", grade: 5 }
    ],
    effects: [
      { type: "special", key: "crossbow_aim_bonus" }
    ],
    effectsRaw: "When you aim with a crossbow: +10m Gittata, -1 success condition penalty, -1 success shot difficulty, -1 target Protezione."
  },
  occhio_di_falco: {
    name: "Occhio di falco",
    category: "prudentia",
    grade: 5,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 5 },
      { skill: "archi", grade: 5 },
      { skill: "atletica", grade: 5 }
    ],
    effects: [
      { type: "damageMod", context: "bow", bonus: 1 },
      { type: "special", key: "bow_range_plus10m" },
      { type: "special", key: "extra_arrow_3riflessi" }
    ],
    effectsRaw: "+1 damage with bows. +10m Gittata. Once per turn, 3 Riflessi to reload or loose an additional arrow."
  },
  giudice: {
    name: "Giudice",
    category: "prudentia",
    grade: 6,
    baseSkill: "percezione",
    requirements: [
      { skill: "percezione", grade: 6 },
      { skill: "autorita", grade: 6 },
      { type: "or", options: [{ skill: "arti_liberali", grade: 6 }, { skill: "raggirare", grade: 6 }] }
    ],
    effects: [
      { type: "charBonus", characteristic: "gratia", bonus: 1 },
      { type: "special", key: "categorical_judgment_ars_oratoria" }
    ],
    effectsRaw: "+1 Gratia. Once per Ars oratoria challenge, you may deliver a categorical judgment and gain a bonus success on any check."
  }
};
function checkTalentUnlocked(talentDef, skills) {
  return talentDef.requirements.every((req) => {
    if (req.type === "or") {
      return req.options.some((o) => (skills[o.skill]?.grade ?? 0) >= o.grade);
    }
    if (req.type === "choice_any") {
      return req.options.filter((o) => (skills[o.skill]?.grade ?? 0) >= o.grade).length >= req.count;
    }
    return (skills[req.skill]?.grade ?? 0) >= req.grade;
  });
}
function countTalentProgress(talentDef, skills) {
  let met = 0;
  for (const req of talentDef.requirements) {
    if (req.type === "or") {
      if (req.options.some((o) => (skills[o.skill]?.grade ?? 0) >= o.grade)) met++;
    } else if (req.type === "choice_any") {
      if (req.options.filter((o) => (skills[o.skill]?.grade ?? 0) >= o.grade).length >= req.count) met++;
    } else {
      if ((skills[req.skill]?.grade ?? 0) >= req.grade) met++;
    }
  }
  return { met, total: talentDef.requirements.length };
}
function computeTalentTrackBonuses(talents) {
  const bonuses = {
    fortitudo: 0,
    celeritas: 0,
    gratia: 0,
    mens: 0,
    prudentia: 0,
    audacia: 0
  };
  const thresholds = [3, 4, 5, 6];
  for (const category of TALENT_CATEGORIES) {
    const related = TALENT_TRACK_CHARACTERISTIC[category];
    for (const threshold of thresholds) {
      const reached = Object.values(talents || {}).some(
        (t) => t.unlocked && t.category === category && t.grade === threshold
      );
      if (reached) bonuses[related] += 1;
    }
  }
  return bonuses;
}
function computeTalentEffectBonus(talents, effectType, context) {
  let bonus = 0;
  for (const talent of Object.values(talents || {})) {
    if (!talent.unlocked) continue;
    for (const effect of talent.effects || []) {
      if (effect.type === effectType && effect.context === context) {
        bonus += effect.bonus || 0;
      }
    }
  }
  return bonus;
}
function computeTalentContextExtraDice(talents, skillId, context) {
  let dice = 0;
  for (const talent of Object.values(talents || {})) {
    if (!talent.unlocked) continue;
    for (const effect of talent.effects || []) {
      if (effect.type === "extraDice" && effect.context === context && effect.skill === skillId) {
        dice += effect.bonus || 0;
      }
    }
  }
  return dice;
}

// node_modules/@federicomorando/sword-engine/src/data/equipment.mjs
var CURRENCY = {
  denaro: { abbrev: "d", inDenari: 1 },
  soldo: { abbrev: "s", inDenari: 12 },
  lira: { abbrev: "l", inDenari: 240 }
};
var QUALITY_TIERS = [
  { id: "scadente", label: "Scadente", costMultiplier: 0.5, pregiSlots: 0, skillGearBonus: -2 },
  { id: "normale", label: "Normale", costMultiplier: 1, pregiSlots: 0, skillGearBonus: 0 },
  { id: "buona", label: "Buona", costMultiplier: 3, pregiSlots: 1, skillGearBonus: 1 },
  { id: "eccellente", label: "Eccellente", costMultiplier: 5, pregiSlots: 2, skillGearBonus: 2 },
  { id: "ottima", label: "Ottima", costMultiplier: 10, pregiSlots: 3, skillGearBonus: 3 },
  { id: "straordinaria", label: "Straordinaria", costMultiplier: 25, pregiSlots: 4, skillGearBonus: 4 }
];
var DAMAGE_TYPES = {
  T: { label: "Taglio", effect: "+1 wound if target has no Protection" },
  B: { label: "Botta", effect: "-1 Riflessi to target" },
  P: { label: "Punta", effect: "Reduces armor Protection by 1" }
};
var WEAPON_CATEGORIES = ["archi", "balestre", "armi_corte", "armi_comuni", "armi_da_guerra"];
var GEAR_CATEGORIES = ["skill_tool", "travel", "clothing", "container", "alchemical", "ammunition"];
var ARMOR_PENALIZED_SKILLS = /* @__PURE__ */ new Set(["archi", "atletica", "furtivita", "manualita"]);
var ARMOR_PREGI_SKILL_MAP = {
  agile: { skillId: "atletica", reduction: 2 },
  da_arciere: { skillId: "archi", reduction: 2 },
  da_geniere: { skillId: "manualita", reduction: 2 },
  furtiva: { skillId: "furtivita", reduction: 2 }
};
var WEAPON_PREGI = {
  // Ranged (8)
  attrezzi_da_ricarica: { cost: 1, type: "ranged", appliesTo: "crossbows", effect: "-1 ricarica" },
  da_guerra: { cost: 0, type: "ranged", appliesTo: "bows", effect: "Add Fortitudo bonus to damage per quality tier" },
  flettenti_morbidi: { cost: 1, type: "ranged", appliesTo: "crossbows", effect: "-1 ricarica (min 0)" },
  frecce_barbigli: { cost: 1, type: "ranged", appliesTo: "ranged", effect: "+1 wound, causes bleeding" },
  frecce_sfondagiaco: { cost: 1, type: "ranged", appliesTo: "ranged", effect: "-2 target Protection (vs -1 for P damage type)" },
  frecce_da_caccia: { cost: 1, type: "ranged", appliesTo: "ranged", effect: "T damage, +1 wound vs unarmored" },
  frecce_da_volo: { cost: 1, type: "ranged", appliesTo: "bows", effect: "+20m gittata" },
  ricurvo: { cost: 1, type: "ranged", appliesTo: "bows", effect: "+10m gittata" },
  // Melee (24)
  agganciare: { cost: 1, type: "melee", appliesTo: "melee", effect: "Defender -1 Riflessi on parry (stacks to -2)" },
  benedetta: { cost: 2, type: "melee", appliesTo: "melee", effect: "+1 Fides bonus when invoked" },
  bilanciata: { cost: 1, type: "melee", appliesTo: "melee", effect: "Additional actions cost 2 Riflessi instead of 3" },
  compatta: { cost: 1, type: "melee", appliesTo: "melee", effect: "Use at one Misura less without penalty" },
  copertura: { cost: 1, type: "melee", appliesTo: "shields", effect: "Auto cover vs ranged" },
  da_cavallo: { cost: 1, type: "melee", appliesTo: "melee+bows", effect: "Extra die mounted" },
  da_lancio: { cost: 1, type: "melee", appliesTo: "short/polearms", effect: "Throwable 10m (+1 damage)" },
  da_sicario: { cost: 1, type: "melee", appliesTo: "short only", effect: "+1 die on surprise attacks" },
  demolitrice: { cost: 1, type: "melee", appliesTo: "melee", effect: "Doubled robustezza damage, +1 die Disarm" },
  difensiva: { cost: 1, type: "melee", appliesTo: "melee", effect: "+1 parry; shields cost 2" },
  feritrice: { cost: 1, type: "melee", appliesTo: "melee", effect: "T damage instead of normal; if already T, cost 2, +2 wounds vs no-Protection" },
  impugnatura_sicura: { cost: 1, type: "melee", appliesTo: "all", effect: "-1 wound/fatigue penalty, +1 die vs Disarm" },
  leggera: { cost: 1, type: "melee", appliesTo: "Pesante only", effect: "-0.5kg, no Riflessi cost for Pesante" },
  metallurgia_avanzata: { cost: 2, type: "melee", appliesTo: "melee", effect: "Choose extra damage type on hit" },
  occultabile: { cost: 1, type: "melee", appliesTo: "short only", effect: "Can hide, found with Percezione 3+" },
  onorevole: { cost: 2, type: "melee", appliesTo: "melee", effect: "+1 Honor bonus when invoked" },
  pavese: { cost: 1, type: "melee", appliesTo: "large shields", effect: "Pavise stand for cover" },
  pesante: { cost: 1, type: "melee", appliesTo: "melee", effect: "+1 damage, costs 1 Riflessi/use; stacks" },
  reliquia: { cost: 2, type: "melee", appliesTo: "melee+bows", effect: "+1 Superstitio bonus when invoked" },
  rostri_o_ali: { cost: 2, type: "melee", appliesTo: "polearms", effect: "+1 success on free attacks vs Misura closure" },
  sanguinaria: { cost: 1, type: "melee", appliesTo: "melee", effect: "Causes bleeding on 1+ wound" },
  sfondagiaco: { cost: 2, type: "melee", appliesTo: "melee", effect: "P damage, -2 Protection" },
  stordente: { cost: 2, type: "melee", appliesTo: "melee", effect: "B damage, target -2 Riflessi" },
  versatile: { cost: 1, type: "melee", appliesTo: "not Pesante", effect: "One-hand costs 1 Riflessi; two-hand +1 parry" }
};
var ARMOR_PREGI = {
  agile: { cost: 1, effect: "Atletica armor penalty -2 (min 0)" },
  brigantina: { cost: 2, effect: "+1 Protection torso only (XIV century)" },
  da_arciere: { cost: 1, effect: "Archi armor penalty -2 (min 0)" },
  da_cavallo: { cost: 1, effect: "+1 Protection when mounted" },
  da_geniere: { cost: 1, effect: "Manualita armor penalty -2 (min 0)" },
  da_viaggio: { cost: 1, effect: "Travel/sleep fatigue penalties -1 each" },
  dimessa: { cost: 1, effect: "Armor appears common; wearer can reduce Fama by 1" },
  elmo_migliorato: { cost: 1, effect: "Padded: Protection 2 helmet; others: +1 vs head" },
  furtiva: { cost: 1, effect: "Furtivita armor penalty -2 (min 0)" },
  leggera: { cost: 1, effect: "-1/4 weight, Fatigue Reaction -1" },
  opera_d_arte: { cost: 1, effect: "+1 Fama, price doubled" },
  pratica: { cost: 1, effect: "Halved don/doff time" },
  rinforzata: { cost: 1, effect: "+1 Protection" },
  robusta: { cost: 1, effect: "Robustezza doubled (lose 1 Protection every 20 damage)" },
  terrificante: { cost: 1, effect: "+1 extra die on Autorita checks" }
};
var WEAPONS = [
  // Bows (2)
  { weaponId: "arco_corto", label: "Arco corto", category: "archi", skillId: "archi", weaponType: "arco", hands: "due_mani", costDenari: 12, costDisplay: "12d", weight: 1, damageValue: 2, damageType: "P", parryModifier: 1, misura: null, pregi: [], gittata: 30, ricarica: 1 },
  { weaponId: "arco_lungo", label: "Arco lungo", category: "archi", skillId: "archi", weaponType: "arco", hands: "due_mani", costDenari: 24, costDisplay: "24d", weight: 1.5, damageValue: 3, damageType: "P", parryModifier: 2, misura: null, pregi: ["pesante"], gittata: 30, ricarica: 1 },
  // Crossbows (3)
  { weaponId: "balestra_leggera", label: "Balestra leggera", category: "balestre", skillId: "balestre", weaponType: "balestra", hands: "due_mani", costDenari: 36, costDisplay: "3s", weight: 3, damageValue: 3, damageType: "P", parryModifier: 0, misura: null, pregi: [], gittata: 20, ricarica: 2 },
  { weaponId: "balestra_a_staffa", label: "Balestra a staffa", category: "balestre", skillId: "balestre", weaponType: "balestra", hands: "due_mani", costDenari: 72, costDisplay: "6s", weight: 4, damageValue: 4, damageType: "P", parryModifier: 1, misura: null, pregi: [], gittata: 20, ricarica: 4 },
  { weaponId: "balestra_a_verricello", label: "Balestra a verricello", category: "balestre", skillId: "balestre", weaponType: "balestra", hands: "due_mani", costDenari: 120, costDisplay: "10s", weight: 6, damageValue: 6, damageType: "P", parryModifier: 2, misura: null, pregi: [], gittata: 20, ricarica: 6 },
  // Short weapons / Armi corte (4)
  { weaponId: "accetta", label: "Accetta", category: "armi_corte", skillId: "armi_corte", weaponType: "ascia", hands: "una_mano", costDenari: 3, costDisplay: "3d", weight: 1, damageValue: 3, damageType: "T", parryModifier: 1, misura: "S", pregi: ["agganciare"], gittata: null, ricarica: null },
  { weaponId: "bastoncello", label: "Bastoncello", category: "armi_corte", skillId: "armi_corte", weaponType: "ascia", hands: "una_mano", costDenari: 0, costDisplay: "na", weight: 1, damageValue: 1, damageType: "B", parryModifier: 1, misura: "S", pregi: [], gittata: null, ricarica: null },
  { weaponId: "coltellaccio", label: "Coltellaccio", category: "armi_corte", skillId: "armi_corte", weaponType: "spada", hands: "una_mano", costDenari: 6, costDisplay: "6d", weight: 1, damageValue: 2, damageType: "T", parryModifier: 2, misura: "M", pregi: [], gittata: null, ricarica: null },
  { weaponId: "coltello", label: "Coltello", category: "armi_corte", skillId: "armi_corte", weaponType: "spada", hands: "una_mano", costDenari: 2, costDisplay: "2d", weight: 0.5, damageValue: 1, damageType: "T", parryModifier: 1, misura: "S", pregi: [], gittata: null, ricarica: null },
  // Common weapons / Armi comuni (8)
  { weaponId: "bordone", label: "Bordone", category: "armi_comuni", skillId: "armi_comuni", weaponType: "asta", hands: "due_mani", costDenari: 3, costDisplay: "3d", weight: 2, damageValue: 2, damageType: "B", parryModifier: 3, misura: "L", pregi: [], gittata: null, ricarica: null },
  { weaponId: "falce_da_guerra", label: "Falce da guerra", category: "armi_comuni", skillId: "armi_comuni", weaponType: "asta", hands: "due_mani", costDenari: 12, costDisplay: "12d", weight: 6, damageValue: 4, damageType: "T", parryModifier: 3, misura: "L", pregi: [], gittata: null, ricarica: null },
  { weaponId: "lancia_da_fante", label: "Lancia da fante", category: "armi_comuni", skillId: "armi_comuni", weaponType: "asta", hands: "due_mani", costDenari: 10, costDisplay: "10d", weight: 3, damageValue: 3, damageType: "P", parryModifier: 3, misura: "L", pregi: [], gittata: null, ricarica: null },
  { weaponId: "martello", label: "Martello", category: "armi_comuni", skillId: "armi_comuni", weaponType: "ascia", hands: "una_mano", costDenari: 6, costDisplay: "6d", weight: 2, damageValue: 2, damageType: "B", parryModifier: 1, misura: "S", pregi: ["compatta"], gittata: null, ricarica: null },
  { weaponId: "randello", label: "Randello", category: "armi_comuni", skillId: "armi_comuni", weaponType: "ascia", hands: "una_mano", costDenari: 2, costDisplay: "2d", weight: 2, damageValue: 2, damageType: "B", parryModifier: 1, misura: "M", pregi: ["pesante"], gittata: null, ricarica: null },
  { weaponId: "roncone", label: "Roncone", category: "armi_comuni", skillId: "armi_comuni", weaponType: "asta", hands: "due_mani", costDenari: 12, costDisplay: "12d", weight: 5, damageValue: 4, damageType: "P", parryModifier: 2, misura: "L", pregi: ["agganciare"], gittata: null, ricarica: null },
  { weaponId: "scure", label: "Scure", category: "armi_comuni", skillId: "armi_comuni", weaponType: "ascia", hands: "due_mani", costDenari: 8, costDisplay: "8d", weight: 4, damageValue: 5, damageType: "T", parryModifier: 2, misura: "M", pregi: ["agganciare"], gittata: null, ricarica: null },
  { weaponId: "spiedo", label: "Spiedo", category: "armi_comuni", skillId: "armi_comuni", weaponType: "asta", hands: "una_mano", costDenari: 10, costDisplay: "10d", weight: 2, damageValue: 3, damageType: "P", parryModifier: 2, misura: "M", pregi: ["da_lancio"], gittata: null, ricarica: null },
  // War weapons / Armi da guerra (8)
  { weaponId: "ascia_normanna", label: "Ascia normanna", category: "armi_da_guerra", skillId: "armi_da_guerra", weaponType: "ascia", hands: "una_mano", costDenari: 96, costDisplay: "8s", weight: 2, damageValue: 4, damageType: "T", parryModifier: 2, misura: "M", pregi: ["pesante", "agganciare"], gittata: null, ricarica: null },
  { weaponId: "lancia_da_cavaliere", label: "Lancia da cavaliere", category: "armi_da_guerra", skillId: "armi_da_guerra", weaponType: "asta", hands: "due_mani", costDenari: 24, costDisplay: "2s", weight: 4, damageValue: 5, damageType: "P", parryModifier: 1, misura: "LL", pregi: ["pesante", "da_cavallo"], gittata: null, ricarica: null },
  { weaponId: "mannaia_inastata", label: "Mannaia inastata", category: "armi_da_guerra", skillId: "armi_da_guerra", weaponType: "asta", hands: "due_mani", costDenari: 24, costDisplay: "2s", weight: 5, damageValue: 6, damageType: "T", parryModifier: 3, misura: "L", pregi: ["pesante"], gittata: null, ricarica: null },
  { weaponId: "mazza_ferrata", label: "Mazza ferrata", category: "armi_da_guerra", skillId: "armi_da_guerra", weaponType: "ascia", hands: "una_mano", costDenari: 120, costDisplay: "10s", weight: 2, damageValue: 3, damageType: "B", parryModifier: 1, misura: "M", pregi: [], gittata: null, ricarica: null },
  { weaponId: "picca", label: "Picca", category: "armi_da_guerra", skillId: "armi_da_guerra", weaponType: "asta", hands: "due_mani", costDenari: 36, costDisplay: "3s", weight: 4, damageValue: 4, damageType: "P", parryModifier: 4, misura: "LL", pregi: ["pesante"], gittata: null, ricarica: null },
  { weaponId: "pugnale", label: "Pugnale", category: "armi_da_guerra", skillId: "armi_da_guerra", weaponType: "spada", hands: "una_mano", costDenari: 12, costDisplay: "1s", weight: 0.5, damageValue: 2, damageType: "P", parryModifier: 1, misura: "S", pregi: [], gittata: null, ricarica: null },
  { weaponId: "spada_da_guerra", label: "Spada da guerra", category: "armi_da_guerra", skillId: "armi_da_guerra", weaponType: "spada", hands: "una_mano", costDenari: 480, costDisplay: "40s", weight: 2, damageValue: 4, damageType: "T", parryModifier: 3, misura: "M", pregi: ["versatile"], gittata: null, ricarica: null },
  { weaponId: "spada_d_arme", label: "Spada d'arme", category: "armi_da_guerra", skillId: "armi_da_guerra", weaponType: "spada", hands: "una_mano", costDenari: 240, costDisplay: "20s", weight: 1.5, damageValue: 3, damageType: "T", parryModifier: 3, misura: "M", pregi: [], gittata: null, ricarica: null }
];
var SHIELDS = [
  { shieldId: "brocchiere", label: "Brocchiere", costDenari: 12, costDisplay: "1s", weight: 1, damageValue: 1, damageType: "B", parryModifier: 1, misura: "S", pregi: [] },
  { shieldId: "scudo", label: "Scudo", costDenari: 12, costDisplay: "1s", weight: 3, damageValue: 2, damageType: "B", parryModifier: 2, misura: "S", pregi: [] },
  { shieldId: "scudo_grande", label: "Scudo grande", costDenari: 24, costDisplay: "2s", weight: 5, damageValue: 2, damageType: "B", parryModifier: 3, misura: "S", pregi: ["pesante", "copertura"] }
];
var ARMOR = [
  { armorId: "abiti_imbottiti", label: "Abiti imbottiti", costDenari: 24, costDisplay: "24d", weight: 2, protezione: 1, robustezza: 10, pregi: [] },
  { armorId: "armatura_da_fanteria", label: "Armatura da fanteria", costDenari: 144, costDisplay: "12s", weight: 6, protezione: 2, robustezza: 20, pregi: [] },
  { armorId: "armatura_da_cavalleria", label: "Armatura da cavalleria", costDenari: 1920, costDisplay: "8l", weight: 15, protezione: 3, robustezza: 30, pregi: [] }
];
var GEAR = [
  // Skill tools (6)
  { gearId: "attrezzi_alchimia", label: "Attrezzi da alchimia", gearCategory: "skill_tool", costDenari: 240, costDisplay: "1l", weight: 5, skillBonusSkillId: "alchimia", description: "Required for Alchimia checks" },
  { gearId: "attrezzi_artigiano", label: "Attrezzi da artigiano", gearCategory: "skill_tool", costDenari: 48, costDisplay: "4s", weight: 5, skillBonusSkillId: "artigiano", description: "Required for Artigiano checks" },
  { gearId: "attrezzi_guarigione", label: "Attrezzi da guarigione", gearCategory: "skill_tool", costDenari: 120, costDisplay: "10s", weight: 2, skillBonusSkillId: "guarigione", description: "Required for Guarigione checks" },
  { gearId: "attrezzi_manualita", label: "Attrezzi da manualita", gearCategory: "skill_tool", costDenari: 24, costDisplay: "2s", weight: 3, skillBonusSkillId: "manualita", description: "Required for Manualita checks (lockpicks, tools, etc.)" },
  { gearId: "strumento_musicale", label: "Strumento musicale", gearCategory: "skill_tool", costDenari: 120, costDisplay: "10s", weight: 2, skillBonusSkillId: "intrattenere", description: "Required for Intrattenere (musical) checks" },
  { gearId: "materiale_scrittura", label: "Materiale da scrittura", gearCategory: "skill_tool", costDenari: 60, costDisplay: "5s", weight: 1, skillBonusSkillId: "arti_liberali", description: "Quill, ink, parchment. Required for written Arti liberali" },
  // Travel (9)
  { gearId: "corda_10m", label: "Corda (10m)", gearCategory: "travel", costDenari: 6, costDisplay: "6d", weight: 2, skillBonusSkillId: null, description: "Hemp rope, 10 meters" },
  { gearId: "torcia", label: "Torcia", gearCategory: "travel", costDenari: 1, costDisplay: "1d", weight: 0.5, skillBonusSkillId: null, description: "Burns for ~1 hour" },
  { gearId: "lanterna", label: "Lanterna", gearCategory: "travel", costDenari: 12, costDisplay: "1s", weight: 1, skillBonusSkillId: null, description: "Metal lantern, requires oil" },
  { gearId: "olio_lanterna", label: "Olio per lanterna", gearCategory: "travel", costDenari: 3, costDisplay: "3d", weight: 0.5, skillBonusSkillId: null, description: "Burns for ~4 hours" },
  { gearId: "sacco_a_pelo", label: "Sacco a pelo / Coperta", gearCategory: "travel", costDenari: 6, costDisplay: "6d", weight: 2, skillBonusSkillId: null, description: "Bedroll or blanket for camping" },
  { gearId: "tenda", label: "Tenda (2 persone)", gearCategory: "travel", costDenari: 24, costDisplay: "2s", weight: 5, skillBonusSkillId: null, description: "Canvas tent for 2 people" },
  { gearId: "acciarino", label: "Acciarino e esca", gearCategory: "travel", costDenari: 3, costDisplay: "3d", weight: 0.25, skillBonusSkillId: null, description: "Flint and tinder" },
  { gearId: "razioni_1giorno", label: "Razioni (1 giorno)", gearCategory: "travel", costDenari: 2, costDisplay: "2d", weight: 1, skillBonusSkillId: null, description: "Dried food for one day" },
  { gearId: "otre_acqua", label: "Otre d'acqua", gearCategory: "travel", costDenari: 2, costDisplay: "2d", weight: 1, skillBonusSkillId: null, description: "Waterskin, holds ~1 liter" },
  // Containers (3)
  { gearId: "bisaccia", label: "Bisaccia", gearCategory: "container", costDenari: 3, costDisplay: "3d", weight: 0.5, skillBonusSkillId: null, description: "Saddlebag or small sack" },
  { gearId: "zaino", label: "Zaino", gearCategory: "container", costDenari: 6, costDisplay: "6d", weight: 1, skillBonusSkillId: null, description: "Backpack" },
  { gearId: "baule", label: "Baule", gearCategory: "container", costDenari: 12, costDisplay: "1s", weight: 5, skillBonusSkillId: null, description: "Wooden chest/trunk" },
  // Clothing (4)
  { gearId: "abiti_umili", label: "Abiti da umile", gearCategory: "clothing", costDenari: 6, costDisplay: "6d", weight: 1, skillBonusSkillId: null, description: "Humble-class clothing" },
  { gearId: "abiti_popolano", label: "Abiti da popolano", gearCategory: "clothing", costDenari: 24, costDisplay: "2s", weight: 1, skillBonusSkillId: null, description: "Commoner-class clothing" },
  { gearId: "abiti_borghese", label: "Abiti da borghese", gearCategory: "clothing", costDenari: 120, costDisplay: "10s", weight: 1, skillBonusSkillId: null, description: "Bourgeois-class clothing" },
  { gearId: "abiti_nobile", label: "Abiti da nobile", gearCategory: "clothing", costDenari: 480, costDisplay: "2l", weight: 1.5, skillBonusSkillId: null, description: "Noble-class clothing" },
  // Alchemical (5)
  { gearId: "antidoto_generico", label: "Antidoto generico", gearCategory: "alchemical", costDenari: 60, costDisplay: "5s", weight: 0.25, skillBonusSkillId: null, description: "Reduces poison power by 2 for next reaction" },
  { gearId: "fuoco_greco", label: "Fuoco greco", gearCategory: "alchemical", costDenari: 240, costDisplay: "1l", weight: 0.5, skillBonusSkillId: null, description: "Incendiary; causes burning damage" },
  { gearId: "unguento_curativo", label: "Unguento curativo", gearCategory: "alchemical", costDenari: 60, costDisplay: "5s", weight: 0.25, skillBonusSkillId: null, description: "+1 success to Guarigione checks for wound treatment" },
  { gearId: "veleno_da_contatto", label: "Veleno da contatto", gearCategory: "alchemical", costDenari: 120, costDisplay: "10s", weight: 0.25, skillBonusSkillId: null, description: "Applied to blade; Forza Reaction vs power 3 on wound" },
  { gearId: "veleno_da_ingestione", label: "Veleno da ingestione", gearCategory: "alchemical", costDenari: 120, costDisplay: "10s", weight: 0.25, skillBonusSkillId: null, description: "In food/drink; Forza Reaction vs power 4" },
  // Ammunition (2)
  { gearId: "frecce_12", label: "Frecce (12) con faretra", gearCategory: "ammunition", costDenari: 12, costDisplay: "12d", weight: 1, skillBonusSkillId: null, description: "12 arrows with quiver" },
  { gearId: "dardi_12", label: "Dardi (12) con faretra", gearCategory: "ammunition", costDenari: 24, costDisplay: "2s", weight: 2, skillBonusSkillId: null, description: "12 bolts with quiver" }
];
function costToDenari(displayStr) {
  if (!displayStr || displayStr === "na") return 0;
  const str = displayStr.trim().toLowerCase();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*([dsl])$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const denom = match[2];
  if (denom === "d") return Math.round(value);
  if (denom === "s") return Math.round(value * 12);
  if (denom === "l") return Math.round(value * 240);
  return 0;
}
function denariToDisplay(denari) {
  if (denari <= 0) return "na";
  if (denari >= 240 && denari % 240 === 0) return `${denari / 240}l`;
  if (denari >= 12 && denari % 12 === 0) return `${denari / 12}s`;
  return `${denari}d`;
}
function qualityCost(baseDenari, qualityId, denomination) {
  const tier = QUALITY_TIERS.find((q) => q.id === qualityId);
  if (!tier) return baseDenari;
  if (qualityId === "eccellente" && denomination === "d") {
    return baseDenari * 12;
  }
  return Math.round(baseDenari * tier.costMultiplier);
}
function weaponQualityBonus(qualityId) {
  if (qualityId === "scadente") return -2;
  return 0;
}
var ENCUMBRANCE_CATEGORIES = [
  { id: "leggero", multiplier: 2, penalty: 0 },
  { id: "moderato", multiplier: 4, penalty: -1 },
  { id: "pesante", multiplier: 6, penalty: -2 },
  { id: "massimo", multiplier: 8, penalty: -3 }
];
function computeEncumbrance(fortitudo, forzaGrade, carriedWeight) {
  const base = fortitudo + forzaGrade;
  if (carriedWeight <= 0) return { base, category: "leggero", penalty: 0 };
  for (const cat of ENCUMBRANCE_CATEGORIES) {
    if (carriedWeight <= base * cat.multiplier) {
      return { base, category: cat.id, penalty: cat.penalty };
    }
  }
  return { base, category: "overloaded", penalty: -3 };
}
function armorSkillPenalty(protezione, armorPregi, skillId) {
  if (!ARMOR_PENALIZED_SKILLS.has(skillId)) return 0;
  let reduction = 0;
  for (const pregioId of armorPregi) {
    const mapping = ARMOR_PREGI_SKILL_MAP[pregioId];
    if (mapping && mapping.skillId === skillId) {
      reduction += mapping.reduction;
    }
  }
  return Math.max(0, protezione - reduction);
}

// node_modules/@federicomorando/sword-engine/src/derivation.mjs
function deriveCharacter(sheet) {
  const mod = characteristicMod;
  const skills = deepCloneSkills(sheet.skills || {});
  const characteristics = { ...sheet.characteristics };
  const resources = deepCloneResources(sheet.resources || {});
  const woundLevels = { graffi: 0, leggere: 0, gravi: 0, critiche: 0, mortali: 0, ...sheet.woundLevels || {} };
  const valori = { fides: 0, impietas: 0, honor: 0, ego: 0, superstitio: 0, ratio: 0, ...sheet.valori || {} };
  const culture = { trait1: "", trait2: "", trait3: "", ...sheet.culture || {} };
  const retaggio = { spiritoBonus: 0, riflessiBonus: 0, indomito: false, ...sheet.retaggio || {} };
  const pe = { total: 0, companionSpent: 0, ...sheet.pe || {} };
  const ceto = sheet.ceto || "popolano";
  const talentChoices = { determinazione: "", eponimo: "", ingegno: "", ...sheet.talentChoices || {} };
  const equipment = sheet.equipment || [];
  const focusCountFor = (grade, isMestiere) => {
    const thresholds = isMestiere ? [3, 6] : [4];
    return thresholds.filter((t) => grade >= t).length;
  };
  let peSpent = 0;
  for (const skillData of Object.values(skills)) {
    skillData.focusSlots = focusCountFor(skillData.grade, skillData.isMestiere);
    skillData.focusCount = (skillData.foci || []).length;
    skillData.hasFocus = skillData.focusCount > 0;
    const base = skillData.baseGrade || 0;
    const current = skillData.grade || 0;
    if (current > base) peSpent += peGradeCost(base, current);
    skillData.nextGradeCost = current >= 6 ? null : current === 0 ? 10 : 2 * (current + 1);
  }
  pe.spent = peSpent + (pe.companionSpent || 0);
  pe.available = pe.total - pe.spent;
  const cetoPool = /* @__PURE__ */ new Set([...CETO_SKILLS.common || [], ...CETO_SKILLS[ceto] || []]);
  for (const [skillId, skillData] of Object.entries(skills)) {
    skillData.isOutsideCeto = !cetoPool.has(skillId);
  }
  const talents = {};
  for (const [id, def] of Object.entries(TALENT_DEFS)) {
    const unlocked = checkTalentUnlocked(def, skills);
    const progress = unlocked ? null : countTalentProgress(def, skills);
    talents[id] = { unlocked, partial: !unlocked && progress !== null && progress.met > 0, ...def };
  }
  const talentCount = Object.values(talents).filter((t) => t.unlocked).length;
  const talentCharBonuses = computeTalentTrackBonuses(talents);
  const talentEffects = collectTalentDerivedEffects(talents);
  const talentResourceBonuses = talentEffects.resourceBonuses;
  const talentSpiritFormulas = talentEffects.spiritFormulas;
  const talentSpecials = talentEffects.specials;
  const talentFlags = talentEffects.flags;
  for (const [skillId, bonus] of Object.entries(talentEffects.extraDiceBySkill)) {
    if (skills[skillId]) skills[skillId].extraDice += bonus;
  }
  const choiceDice = computeTalentChoiceExtraDice(talentSpecials, talentChoices);
  for (const [skillId, bonus] of Object.entries(choiceDice)) {
    if (skills[skillId]) skills[skillId].extraDice += bonus;
  }
  if (talentSpecials.has("learn_skill_6pe")) {
    for (const skillData of Object.values(skills)) {
      if (skillData.grade === 0) skillData.nextGradeCost = 6;
    }
  }
  const effectiveCharacteristics = {};
  for (const key of Object.keys(characteristics)) {
    effectiveCharacteristics[key] = characteristics[key] + (talentCharBonuses[key] || 0);
  }
  const ec = effectiveCharacteristics;
  const modifiers = {};
  for (const key of Object.keys(ec)) {
    modifiers[key] = mod(ec[key]);
  }
  const cultureBonuses = computeCultureBonuses(culture.trait1, culture.trait2, culture.trait3);
  modifiers.audacia += cultureBonuses.audaciaMod;
  resources.spirito.max = ec.audacia + mod(ec.audacia) + cultureBonuses.audaciaMod + (skills.volonta?.grade || 0) + (retaggio.spiritoBonus || 0);
  for (const sf of talentSpiritFormulas) {
    if (sf.mode === "addScore") {
      resources.spirito.max += ec[sf.characteristic] || 0;
    } else if (sf.mode === "addModifier") {
      for (const charKey of sf.characteristics || []) {
        resources.spirito.max += mod(ec[charKey] || 7);
      }
    }
  }
  resources.spirito.max += cultureBonuses.spiritualeSpirito;
  resources.fatica.max = ec.fortitudo + ec.audacia + (talentSpecials.has("extra_fatica_per_level") ? 3 : 0);
  resources.ferite.max = ec.fortitudo + mod(ec.fortitudo) + (skills.forza?.grade || 0);
  resources.riflessi.max = ec.prudentia + mod(ec.celeritas) + (retaggio.riflessiBonus || 0) + (talentResourceBonuses.riflessi || 0);
  valori.totalPoints = valori.fides + valori.impietas + valori.honor + valori.ego + valori.superstitio + valori.ratio;
  valori.maxPoints = 3 + modifiers.audacia;
  valori.perValueMax = talentSpecials.has("modify_valori") ? 4 : 3;
  const indomito = !!retaggio.indomito;
  const fatigueResult = computeFatigueLevel(resources.fatica.value, resources.fatica.max, {
    indomito,
    guerrescaBonus: cultureBonuses.guerrescaFatBonus,
    scalePenalties: talentSpecials.has("scale_fatigue_penalties")
  });
  const woundCapacities = computeWoundCapacities(resources.ferite.max, indomito, {
    graffi: cultureBonuses.guerrescaGraffi,
    leggere: cultureBonuses.guerrescaLeggere
  });
  resources.ferite.value = woundLevels.graffi + woundLevels.leggere + woundLevels.gravi + woundLevels.critiche + woundLevels.mortali;
  let woundPenalty = computeWoundPenalty(woundLevels);
  if (talentSpecials.has("scale_wound_penalties")) {
    woundPenalty = Math.max(0, woundPenalty - 1);
  }
  let carriedWeight = 0;
  for (const item of equipment) {
    const w = item.weight || item.properties?.weight || 0;
    const q = item.quantity || 1;
    carriedWeight += w * q;
  }
  carriedWeight = Math.round(carriedWeight * 100) / 100;
  const enc = computeEncumbrance(ec.fortitudo, skills.forza?.grade || 0, carriedWeight);
  const movimento = enc.category === "overloaded" ? 0 : Math.max(0, 5 - Math.abs(enc.penalty) - woundPenalty);
  const mensModPositive = Math.max(0, modifiers.mens || 0);
  const usiGrade = skills.usi_e_costumi?.grade || 0;
  const artiGrade = skills.arti_liberali?.grade || 0;
  const meticcioBonus = culture.trait1 === "meticcia" || culture.trait2 === "meticcia" || culture.trait3 === "meticcia" ? 1 : 0;
  const languageSlots = 1 + mensModPositive + Math.floor(usiGrade / 2) + Math.floor(artiGrade / 2) + meticcioBonus;
  return {
    ...sheet,
    skills,
    resources,
    woundLevels,
    valori,
    pe,
    effectiveCharacteristics,
    modifiers,
    talents,
    talentCount,
    talentCharBonuses,
    talentResourceBonuses,
    talentSpiritFormulas,
    talentSpecials: [...talentSpecials],
    talentFlags: [...talentFlags],
    woundCapacities,
    woundPenalty,
    fatiguePenalty: fatigueResult.fatiguePenalty,
    fatigueLevel: fatigueResult.fatigueLevel,
    carriedWeight,
    encumbranceBase: enc.base,
    encumbranceCategory: enc.category,
    encumbrancePenalty: Math.abs(enc.penalty),
    encumbranceMaxWeight: enc.base * 8,
    movimento,
    languageSlots,
    cultureBonuses: {
      eruditaStudyBonus: cultureBonuses.eruditaStudyBonus,
      militareQualityEquipment: cultureBonuses.militareQualityEquipment,
      hasUrbanaCulture: cultureBonuses.hasUrbanaCulture
    }
  };
}
function deepCloneSkills(skills) {
  const out = {};
  for (const [id, data] of Object.entries(skills)) {
    out[id] = { ...data, foci: [...data.foci || []] };
  }
  return out;
}
function deepCloneResources(res) {
  return {
    spirito: { value: 0, max: 0, ...res.spirito || {} },
    fatica: { value: 0, max: 0, ...res.fatica || {} },
    ferite: { value: 0, max: 0, ...res.ferite || {} },
    riflessi: { value: 0, max: 0, ...res.riflessi || {} }
  };
}

// node_modules/@federicomorando/sword-engine/src/progression.mjs
var EVENT_DEFS = {
  addestramento_marziale: { effect: "extraDice", extraDiceAmount: 1 },
  apprendistato: { effect: "extraDice", modes: { single: { extraDiceAmount: 2 }, split: { extraDiceAmount: 1 } } },
  antico_sapere: { effect: "extraDice", extraDiceAmount: 1 },
  dedizione: { effect: "extraDice", extraDiceAmount: 1 },
  fascino: { effect: "extraDice", extraDiceAmount: 1 },
  percorso_spirituale: { effect: "spirito_bonus", bonus: 3 },
  talento_naturale: { effect: "extraDice", extraDiceAmount: 1 }
};
function computeRetaggioSlots(gratia, { hasTentazione = false, hasIntraprendente = false, ceto = "popolano" } = {}) {
  const total = Math.max(0, 3 + characteristicMod(gratia) + (hasTentazione ? 1 : 0) + (hasIntraprendente ? 1 : 0));
  const available = Math.max(0, total - (CETO_FAMA[ceto] ?? 0));
  return { total, available };
}
function emptySkillState() {
  return Object.fromEntries(
    allSkillIds().map((id) => [id, { baseGrade: 0, grade: 0, isMestiere: false, extraDice: 0 }])
  );
}
function computeCreationSkillState(state) {
  const skills = emptySkillState();
  for (const id of BASE_SKILLS) {
    if (!skills[id]) continue;
    skills[id].baseGrade = Math.max(skills[id].baseGrade, 1);
    skills[id].grade = Math.max(skills[id].grade, 1);
  }
  for (const id of state.skills.mestiere || []) {
    if (!skills[id]) continue;
    skills[id].baseGrade = Math.max(skills[id].baseGrade, 1);
    skills[id].grade = Math.max(skills[id].grade, 1);
    skills[id].isMestiere = true;
  }
  for (const id of state.skills.free || []) {
    if (!skills[id]) continue;
    if (skills[id].grade >= 1) {
      skills[id].baseGrade = Math.max(skills[id].baseGrade, 2);
      skills[id].grade = Math.max(skills[id].grade, 2);
    } else {
      skills[id].baseGrade = Math.max(skills[id].baseGrade, 1);
      skills[id].grade = Math.max(skills[id].grade, 1);
    }
  }
  for (const id of state.skills.grade2 || []) {
    if (!id || !skills[id]) continue;
    skills[id].baseGrade = Math.max(skills[id].baseGrade, 2);
    skills[id].grade = Math.max(skills[id].grade, 2);
  }
  for (const id of state.skills.grade3 || []) {
    if (!id || !skills[id]) continue;
    skills[id].baseGrade = Math.max(skills[id].baseGrade, 3);
    skills[id].grade = Math.max(skills[id].grade, 3);
  }
  for (const id of state.retaggio?.espGrade3 || []) {
    if (!id || !skills[id]) continue;
    skills[id].baseGrade = Math.max(skills[id].baseGrade, 3);
    skills[id].grade = Math.max(skills[id].grade, 3);
  }
  for (const id of state.retaggio?.espGrade2 || []) {
    if (!id || !skills[id]) continue;
    skills[id].baseGrade = Math.max(skills[id].baseGrade, 2);
    skills[id].grade = Math.max(skills[id].grade, 2);
  }
  if (state.trait1Skill && skills[state.trait1Skill]) skills[state.trait1Skill].extraDice += 1;
  if (state.trait2Skill && skills[state.trait2Skill]) skills[state.trait2Skill].extraDice += 1;
  if (state.corteseAdvSkill && skills[state.corteseAdvSkill]) skills[state.corteseAdvSkill].extraDice += 1;
  const hasTrait = (id) => state.cultureTrait1 === id || state.cultureTrait2 === id;
  if (hasTrait("meticcio")) {
    if (skills.storia_e_leggende) skills.storia_e_leggende.extraDice += 1;
    if (skills.usi_e_costumi) skills.usi_e_costumi.extraDice += 1;
  }
  if (hasTrait("rurale")) {
    if (skills.sopravvivenza) skills.sopravvivenza.extraDice += 1;
    if (skills.usi_e_costumi) skills.usi_e_costumi.extraDice += 1;
  }
  if (hasTrait("tenace") && skills.forza) skills.forza.extraDice += 1;
  for (const ev of state.retaggio?.events || []) {
    if (!ev?.type) continue;
    const def = EVENT_DEFS[ev.type];
    if (!def) continue;
    if (def.effect === "extraDice") {
      const amount = def.modes ? def.modes[ev.mode]?.extraDiceAmount ?? 0 : def.extraDiceAmount ?? 0;
      for (const skillId of ev.picks || []) {
        if (skills[skillId]) skills[skillId].extraDice += amount;
      }
    }
  }
  return skills;
}
function computeProgressionSummary(baseSkillState, currentGrades, peTotal = 0) {
  let peSpent = 0;
  const skillView = {};
  const skillsForTalent = {};
  for (const id of allSkillIds()) {
    const base = baseSkillState[id]?.baseGrade ?? 0;
    const current = Math.max(base, Math.min(6, Number(currentGrades[id] ?? base)));
    const isMestiere = Boolean(baseSkillState[id]?.isMestiere);
    const extraDice = Number(baseSkillState[id]?.extraDice ?? 0);
    if (current > base) peSpent += peGradeCost(base, current);
    const focusThresholds = isMestiere ? [3, 6] : [4, 6];
    const focusCount = focusThresholds.filter((t) => current >= t).length;
    skillView[id] = {
      id,
      baseGrade: base,
      grade: current,
      isMestiere,
      extraDice,
      focusCount,
      hasFocus: focusCount > 0,
      nextGradeCost: current >= 6 ? null : current === 0 ? 10 : 2 * (current + 1)
    };
    skillsForTalent[id] = { grade: current };
  }
  const talents = {};
  for (const [id, def] of Object.entries(TALENT_DEFS)) {
    const unlocked = checkTalentUnlocked(def, skillsForTalent);
    const progress = unlocked ? null : countTalentProgress(def, skillsForTalent);
    talents[id] = {
      unlocked,
      partial: !unlocked && progress !== null && progress.met > 0,
      progress,
      ...def
    };
  }
  const talentCount = Object.values(talents).filter((t) => t.unlocked).length;
  const talentCharBonuses = computeTalentTrackBonuses(talents);
  const talentEffects = collectTalentDerivedEffects(talents);
  for (const [skillId, bonus] of Object.entries(talentEffects.extraDiceBySkill)) {
    if (skillView[skillId]) skillView[skillId].extraDice += bonus;
  }
  return {
    skills: skillView,
    peTotal,
    peSpent,
    peAvailable: peTotal - peSpent,
    talents,
    talentCount,
    talentCharBonuses,
    talentResourceBonuses: talentEffects.resourceBonuses,
    talentSpiritFormulas: talentEffects.spiritFormulas,
    talentSpecials: talentEffects.specials,
    talentFlags: talentEffects.flags
  };
}

// node_modules/@federicomorando/sword-engine/src/data/cultures.mjs
var CULTURE_DEFS = {
  antica: {
    skillChoices: ["carisma", "volonta"],
    valori: ["fides", "superstitio"],
    advantage: "audacia_mod_bonus"
    // +1 to Audacia modifier
  },
  cortese: {
    skillChoices: ["carisma", "ragionamento"],
    valori: ["fides", "honor"],
    advantage: "extra_die_pick",
    // extra die in 1 of 3 skills
    advantagePickFrom: ["arti_liberali", "autorita", "empatia"]
  },
  erudita: {
    skillChoices: ["percezione", "ragionamento"],
    valori: ["ego", "ratio"],
    advantage: "study_bonus"
    // +1 success on study/meditation/work checks
  },
  guerresca: {
    skillChoices: ["agilita", "forza"],
    valori: ["impietas", "honor"],
    advantage: "wound_fatigue_bonus"
    // +1 graffi/leggere, +1 fresco/stanco
  },
  intraprendente: {
    skillChoices: ["percezione", "volonta"],
    valori: ["ego", "ratio"],
    advantage: "retaggio_bonus"
    // +1 retaggio point
  },
  laboriosa: {
    skillChoices: ["percezione", "ragionamento"],
    valori: ["honor", "ratio"],
    advantage: "double_wealth"
    // starting wealth doubled
  },
  meticcio: {
    skillChoices: null,
    // any skill
    valori: null,
    // any valore
    advantage: "mixed_heritage"
    // extra language + extra die in storia_e_leggende + usi_e_costumi
  },
  militare: {
    skillChoices: ["agilita", "volonta"],
    valori: ["impietas", "honor"],
    advantage: "quality_equipment"
    // starting equipment Buona quality
  },
  rurale: {
    skillChoices: ["forza", "percezione"],
    valori: ["fides", "superstitio"],
    advantage: "survival_bonus"
    // extra die in sopravvivenza + usi_e_costumi
  },
  spirituale: {
    skillChoices: ["carisma", "volonta"],
    valori: ["fides", "superstitio"],
    advantage: "spirito_bonus"
    // +4 Spirito
  },
  tenace: {
    skillChoices: ["percezione", "volonta"],
    valori: ["honor", "superstitio"],
    advantage: "forza_extra_die"
    // extra die in Forza
  },
  urbana: {
    skillChoices: ["carisma", "ragionamento"],
    valori: ["ego", "ratio"],
    advantage: "ceto_distance_minus1"
    // ceto skill distance -1 + contact bonus (partial deferred)
  }
};
var ALL_VALORI = /* @__PURE__ */ new Set(["fides", "impietas", "honor", "ego", "superstitio", "ratio"]);
var CULTURE_IDS = Object.keys(CULTURE_DEFS);
function getCultureAllowedValori(trait1, trait2) {
  const def1 = CULTURE_DEFS[trait1];
  const def2 = CULTURE_DEFS[trait2];
  if (!def1 || !def2 || def1.valori === null || def2.valori === null) {
    return new Set(ALL_VALORI);
  }
  const allowed = /* @__PURE__ */ new Set();
  for (const v of def1.valori) allowed.add(v);
  for (const v of def2.valori) allowed.add(v);
  return allowed;
}

// node_modules/@federicomorando/sword-engine/src/data/bestiary.mjs
var CREATURE_TYPES = ["animale", "creatura_fantastica", "non_morta", "demone", "fatato"];
var SIZE_CATEGORIES = ["piccola", "media", "grande", "enorme"];
var ADVANTAGES = {
  afferrare: { label: "Afferrare", hasLevel: false },
  aura_infernale: { label: "Aura infernale", hasLevel: true },
  aura_letale: { label: "Aura letale", hasLevel: true },
  fascinazione: { label: "Fascinazione", hasLevel: true },
  ferocia: { label: "Ferocia", hasLevel: false },
  immunita_freddo: { label: "Immunit\xE0 al freddo", hasLevel: false },
  immunita_fuoco: { label: "Immunit\xE0 al fuoco", hasLevel: false },
  immunita_danni_mondani: { label: "Immunit\xE0 ai danni mondani", hasLevel: false },
  immunita_veleni: { label: "Immunit\xE0 a veleni e malattie", hasLevel: false },
  incorporeo: { label: "Incorporeo", hasLevel: false },
  invisibilita: { label: "Invisibilit\xE0", hasLevel: false },
  mente_vacua: { label: "Mente vacua", hasLevel: false },
  non_vita: { label: "Non vita", hasLevel: false },
  ostacolare: { label: "Ostacolare", hasLevel: true },
  paura: { label: "Paura", hasLevel: true },
  scatto_fulmineo: { label: "Scatto fulmineo", hasLevel: false },
  senso_affinato: { label: "Senso affinato", hasLevel: false },
  sfuggente: { label: "Sfuggente", hasLevel: false },
  sguardo_letale: { label: "Sguardo letale", hasLevel: false },
  terzo_occhio: { label: "Terzo occhio", hasLevel: false },
  tocco_fatato: { label: "Tocco fatato", hasLevel: false },
  travolgere: { label: "Travolgere", hasLevel: false },
  vista_notturna: { label: "Vista notturna", hasLevel: false },
  oltre_il_velo: { label: "Oltre il velo", hasLevel: false }
};
var DISADVANTAGES = {
  notturno: { label: "Notturno" },
  terrore_del_sole: { label: "Terrore del sole" },
  vincolo: { label: "Vincolo" }
};
var CREATURES = [
  // ── 11.3 — Animals ──────────────────────────────────────────────────────
  {
    id: "aquila",
    name: "Aquila",
    rango: 1,
    type: "animale",
    sizeCategory: "piccola",
    isTemplate: false,
    abilities: { agilita: 3, forza: 3, percezione: 3, volonta: 2 },
    skills: { furtivita: 4, lotta: 2 },
    riflessi: 14,
    movement: { fly: 15 },
    ferite: [2, 2, 2, 1],
    fatica: [3, 3, 3],
    protezione: 0,
    attacks: [
      { name: "Artigli o becco", skill: "lotta", misura: "Abbrazzar", damage: "+2T" }
    ],
    advantages: ["senso_affinato"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "asino",
    name: "Asino",
    rango: 1,
    type: "animale",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 2, forza: 3, percezione: 3, volonta: 2 },
    skills: { lotta: 2 },
    riflessi: 10,
    movement: { walk: 4, trot: 6, gallop: 7 },
    ferite: [4, 3, 3, 3, 3],
    fatica: [7, 7, 7],
    protezione: 0,
    attacks: [
      { name: "Scalciata", skill: "lotta", misura: "Stretta", damage: "+2B" }
    ],
    advantages: ["senso_affinato"],
    advantageDetails: {},
    disadvantages: [],
    speciale: "Movement follows the horse rules (walk/trot/gallop)."
  },
  {
    id: "bue",
    name: "Bue",
    rango: 2,
    type: "animale",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { forza: 4, percezione: 2, volonta: 3 },
    skills: { lotta: 3 },
    riflessi: 9,
    movement: { walk: 6 },
    ferite: [4, 4, 4, 4, 3],
    fatica: [9, 9, 9],
    protezione: 2,
    attacks: [
      { name: "Incornata", skill: "lotta", misura: "Media", damage: "+3P" }
    ],
    advantages: ["travolgere"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "mastino",
    name: "Mastino",
    rango: 2,
    type: "animale",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 2, forza: 3, percezione: 3, volonta: 3 },
    skills: { lotta: 3 },
    riflessi: 11,
    movement: { walk: 6 },
    ferite: [3, 3, 3, 3, 2],
    fatica: [6, 6, 6],
    protezione: 0,
    attacks: [
      { name: "Morso", skill: "lotta", misura: "Stretta", damage: "+2T" }
    ],
    advantages: ["afferrare", "ferocia", "senso_affinato"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "segugio",
    name: "Segugio",
    rango: 1,
    type: "animale",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 3, forza: 2, percezione: 4, volonta: 2 },
    skills: { furtivita: 3, lotta: 2 },
    riflessi: 12,
    movement: { walk: 9 },
    ferite: [3, 3, 2, 2, 2],
    fatica: [5, 5, 5],
    protezione: 0,
    attacks: [
      { name: "Morso", skill: "lotta", misura: "Stretta", damage: "+2T" }
    ],
    advantages: ["afferrare", "senso_affinato", "vista_notturna"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "destriero",
    name: "Destriero o cavallo da guerra",
    rango: 3,
    type: "animale",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 3, forza: 3, percezione: 3, volonta: 3 },
    skills: { lotta: 4 },
    riflessi: 11,
    movement: { walk: 6, trot: 7, gallop: 8 },
    ferite: [4, 4, 4, 4, 4],
    fatica: [10, 10, 10],
    protezione: 1,
    attacks: [
      { name: "Zoccoli", skill: "lotta", misura: "Media", damage: "+3B" }
    ],
    advantages: ["ferocia", "travolgere"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "mulo",
    name: "Mulo o cavallo da tiro",
    rango: 2,
    type: "animale",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 2, forza: 3, percezione: 3, volonta: 2 },
    skills: { lotta: 3 },
    riflessi: 9,
    movement: { walk: 5, trot: 6, gallop: 7 },
    ferite: [5, 5, 4, 4, 4],
    fatica: [10, 10, 10],
    protezione: 1,
    attacks: [
      { name: "Zoccoli", skill: "lotta", misura: "Media", damage: "+2B" }
    ],
    advantages: [],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "palafreno",
    name: "Palafreno o cavallo da corsa",
    rango: 2,
    type: "animale",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 4, forza: 3, percezione: 3, volonta: 2 },
    skills: { lotta: 2 },
    riflessi: 11,
    movement: { walk: 6, trot: 7, gallop: 10 },
    ferite: [4, 4, 4, 3, 3],
    fatica: [8, 8, 8],
    protezione: 1,
    attacks: [
      { name: "Zoccoli", skill: "lotta", misura: "Media", damage: "+2B" }
    ],
    advantages: [],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "ronzino",
    name: "Ronzino o cavallo da sella",
    rango: 1,
    type: "animale",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 3, forza: 3, percezione: 3, volonta: 2 },
    skills: { lotta: 2 },
    riflessi: 9,
    movement: { walk: 5, trot: 6, gallop: 7 },
    ferite: [4, 4, 4, 3, 3],
    fatica: [8, 8, 8],
    protezione: 1,
    attacks: [
      { name: "Zoccoli", skill: "lotta", misura: "Media", damage: "+2B" }
    ],
    advantages: [],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "cervo",
    name: "Cervo",
    rango: 1,
    type: "animale",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 3, forza: 3, percezione: 3, volonta: 2 },
    skills: { furtivita: 2, lotta: 2 },
    riflessi: 10,
    movement: { walk: 7 },
    ferite: [4, 3, 3, 3, 3],
    fatica: [7, 7, 7],
    protezione: 0,
    attacks: [
      { name: "Incornata", skill: "lotta", misura: "Stretta", damage: "+2P" }
    ],
    advantages: [],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "cinghiale",
    name: "Cinghiale",
    rango: 2,
    type: "animale",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 2, forza: 4, percezione: 3, volonta: 3 },
    skills: { lotta: 3 },
    riflessi: 9,
    movement: { walk: 6 },
    ferite: [4, 4, 3, 3, 3],
    fatica: [7, 7, 7],
    protezione: 1,
    attacks: [
      { name: "Zanne", skill: "lotta", misura: "Media", damage: "+2P" }
    ],
    advantages: ["ferocia"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "coccodrillo",
    name: "Coccodrillo",
    rango: 5,
    type: "animale",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 2, forza: 4, percezione: 3, volonta: 3 },
    skills: { furtivita: 2, lotta: 3 },
    riflessi: 12,
    movement: { walk: 4 },
    ferite: [5, 5, 5, 5, 5],
    fatica: [9, 9, 9],
    protezione: 3,
    attacks: [
      { name: "Morso", skill: "lotta", misura: "Media", damage: "+4T" }
    ],
    advantages: ["afferrare", "ferocia"],
    advantageDetails: {},
    disadvantages: [],
    speciale: "On land, -1 success penalty to Agility; tires quickly and stops pursuing after 1d6 turns. Grapple +1 in water."
  },
  {
    id: "elefante",
    name: "Elefante",
    rango: 6,
    type: "animale",
    sizeCategory: "enorme",
    isTemplate: false,
    abilities: { forza: 6, percezione: 3, volonta: 4 },
    skills: { lotta: 4 },
    riflessi: 7,
    movement: { walk: 4 },
    ferite: [7, 7, 7, 7, 6],
    fatica: [13, 13, 13],
    protezione: 4,
    attacks: [
      { name: "Zanna", skill: "lotta", misura: "Larga", damage: "+3P" }
    ],
    advantages: ["ferocia", "paura", "travolgere"],
    advantageDetails: { paura: 4 },
    disadvantages: [],
    speciale: ""
  },
  {
    id: "falco",
    name: "Falco",
    rango: 1,
    type: "animale",
    sizeCategory: "piccola",
    isTemplate: false,
    abilities: { agilita: 3, percezione: 3, volonta: 2 },
    skills: { furtivita: 4, lotta: 2 },
    riflessi: 15,
    movement: { fly: 20 },
    ferite: [2, 1, 1, 1],
    fatica: [2, 2, 2],
    protezione: 0,
    attacks: [
      { name: "Beccata o artiglio", skill: "lotta", misura: "Abbrazzar", damage: "+1T" }
    ],
    advantages: ["senso_affinato"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "gatto",
    name: "Gatto",
    rango: 1,
    type: "animale",
    sizeCategory: "piccola",
    isTemplate: false,
    abilities: { agilita: 3, percezione: 3, volonta: 2 },
    skills: { furtivita: 3, lotta: 2 },
    riflessi: 16,
    movement: { walk: 6 },
    ferite: [2, 2, 2, 1],
    fatica: [3, 3, 3],
    protezione: 0,
    attacks: [
      { name: "Unghie", skill: "lotta", misura: "Abbrazzar", damage: "+1T" }
    ],
    advantages: ["senso_affinato", "vista_notturna"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "leone",
    name: "Leone",
    rango: 4,
    type: "animale",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 3, forza: 4, percezione: 3, volonta: 3 },
    skills: { furtivita: 2, lotta: 4 },
    riflessi: 11,
    movement: { walk: 8 },
    ferite: [4, 3, 3, 3, 3],
    fatica: [7, 7, 7],
    protezione: 1,
    attacks: [
      { name: "Artigli", skill: "lotta", misura: "Media", damage: "+3T" }
    ],
    advantages: ["afferrare", "ferocia", "senso_affinato", "vista_notturna"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "lupo",
    name: "Lupo",
    rango: 1,
    type: "animale",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 2, forza: 3, percezione: 3, volonta: 2 },
    skills: { furtivita: 3, lotta: 3 },
    riflessi: 12,
    movement: { walk: 8 },
    ferite: [3, 3, 2, 2, 2],
    fatica: [5, 5, 5],
    protezione: 0,
    attacks: [
      { name: "Morso", skill: "lotta", misura: "Stretta", damage: "+2T" }
    ],
    advantages: ["afferrare", "senso_affinato", "vista_notturna"],
    advantageDetails: {},
    disadvantages: [],
    speciale: "If the wolf surprises an adventurer, that adventurer must attempt a Resolve vs Superstition contest against 2 successes or lose their voice for a minute."
  },
  {
    id: "orso",
    name: "Orso",
    rango: 3,
    type: "animale",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 2, forza: 4, percezione: 3, volonta: 3 },
    skills: { furtivita: 2, lotta: 3 },
    riflessi: 10,
    movement: { walk: 5 },
    ferite: [5, 5, 5, 5, 4],
    fatica: [10, 10, 10],
    protezione: 1,
    attacks: [
      { name: "Artigli", skill: "lotta", misura: "Stretta", damage: "+3T" }
    ],
    advantages: ["afferrare", "ferocia"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "serpe",
    name: "Serpe",
    rango: 1,
    type: "animale",
    sizeCategory: "piccola",
    isTemplate: false,
    abilities: { agilita: 3, percezione: 3, volonta: 2 },
    skills: { furtivita: 3, lotta: 3 },
    riflessi: 16,
    movement: { walk: 4 },
    ferite: [2, 1, 1, 1],
    fatica: [2, 2, 2],
    protezione: 0,
    attacks: [
      { name: "Morso", skill: "lotta", misura: "Abbrazzar", damage: "+1T" }
    ],
    advantages: [],
    advantageDetails: {},
    disadvantages: [],
    speciale: "Injects venom of Power 3 (wounding, onset 1d6 hours). Can spook mounts (the animal makes a Fear reaction vs 3 successes)."
  },
  // ── 11.4 — Fantastic Creatures ──────────────────────────────────────────
  {
    id: "basilisco",
    name: "Basilisco",
    rango: 4,
    type: "creatura_fantastica",
    sizeCategory: "piccola",
    isTemplate: false,
    abilities: { agilita: 4, percezione: 3, volonta: 4 },
    skills: { furtivita: 4, lotta: 2 },
    riflessi: 15,
    movement: { walk: 4, fly: 12 },
    ferite: [3, 3, 2, 2],
    fatica: [4, 4, 4],
    protezione: 0,
    attacks: [
      { name: "Beccata", skill: "lotta", misura: "Abbrazzar", damage: "+1T" }
    ],
    advantages: ["aura_letale", "ferocia", "immunita_veleni", "sguardo_letale"],
    advantageDetails: { aura_letale: 3 },
    disadvantages: [],
    speciale: "Anyone who wounds the basilisk in melee takes an equal number of wounds from its toxic blood. Lethal gaze (death)."
  },
  {
    id: "fantasma",
    name: "Fantasma",
    rango: 0,
    type: "creatura_fantastica",
    sizeCategory: "media",
    isTemplate: true,
    abilities: {},
    skills: {},
    riflessi: 0,
    movement: {},
    ferite: [0, 0, 0, 0, 0],
    fatica: [0, 0, 0],
    protezione: 0,
    attacks: [],
    advantages: ["invisibilita", "non_vita", "paura", "immunita_danni_mondani"],
    advantageDetails: { paura: 3 },
    disadvantages: ["vincolo"],
    speciale: "Template creature. Uses the deceased's stats with XP+75. Gains: one Value of choice at 3; +24 Spirit; immunity to mundane damage; spirit copies of the weapons and armor held in life; attacks cause +1 Fatigue per wound and ignore non-magical Protection. By spending 5 Spirit plus an action, may attempt possession (victim: Willpower reaction vs 4 successes; on failure, possessed for 1d6 hours)."
  },
  {
    id: "grifone",
    name: "Grifone",
    rango: 5,
    type: "creatura_fantastica",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 3, forza: 4, percezione: 4, volonta: 4 },
    skills: { furtivita: 2, lotta: 4 },
    riflessi: 11,
    movement: { walk: 8, fly: 24 },
    ferite: [4, 4, 4, 4, 4],
    fatica: [9, 9, 9],
    protezione: 1,
    attacks: [
      { name: "Artigli", skill: "lotta", misura: "Media", damage: "+4T" }
    ],
    advantages: ["afferrare", "ferocia", "senso_affinato"],
    advantageDetails: {},
    disadvantages: [],
    speciale: ""
  },
  {
    id: "licantropo",
    name: "Licantropo",
    rango: 0,
    type: "creatura_fantastica",
    sizeCategory: "media",
    isTemplate: true,
    abilities: {},
    skills: {},
    riflessi: 0,
    movement: {},
    ferite: [0, 0, 0, 0, 0],
    fatica: [0, 0, 0],
    protezione: 0,
    attacks: [],
    advantages: [],
    advantageDetails: {},
    disadvantages: [],
    speciale: "Template creature. Uses the NPC's stats with XP+50. In animal form, takes the wolf's stats and advantages plus human Reasoning and skills. Both forms gain: +1 success to Force, Perception, Willpower, Stealth, and Grapple; +1 Grapple damage; +1 wound and +1 Fatigue per level; +1 Protection; +3 successes to Empathy/Survival toward wolves; a focus for intimidating/frightening; and regeneration of up to 3 wounds at end of turn (silver or wolfsbane prevents regeneration). Loses 1 Fides and gains 1 Impietas on the first transformation. Terrified of wolfsbane (within 10m, a Fear reaction vs 4 successes)."
  },
  {
    id: "ritornati",
    name: "Ritornati",
    rango: 6,
    type: "non_morta",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 3, forza: 3, percezione: 3, volonta: 4 },
    skills: { armi_comuni: 4, lotta: 3 },
    riflessi: 10,
    movement: { walk: 5 },
    ferite: [4, 4, 4, 3, 3],
    fatica: [9, 9, 9],
    protezione: 4,
    attacks: [
      { name: "Lotta", skill: "lotta", misura: "Stretta", damage: "+2B", parata: 1 }
    ],
    advantages: ["immunita_freddo", "mente_vacua", "non_vita", "ostacolare", "paura", "sguardo_letale"],
    advantageDetails: { ostacolare: 3, paura: 3 },
    disadvantages: ["notturno", "terrore_del_sole"],
    speciale: "Hinder: Force reaction vs 3 successes from the stench of decay, 5m radius. Lethal gaze (confusion). May use common or war weapons."
  },
  {
    id: "unicorno",
    name: "Unicorno",
    rango: 3,
    type: "creatura_fantastica",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 3, forza: 4, percezione: 3, ragionamento: 3, volonta: 4 },
    skills: { furtivita: 2, lotta: 4 },
    riflessi: 11,
    movement: { walk: 8 },
    ferite: [4, 4, 4, 3, 3],
    fatica: [8, 8, 8],
    protezione: 1,
    attacks: [
      { name: "Incornata", skill: "lotta", misura: "Media", damage: "+3P" }
    ],
    advantages: ["immunita_veleni", "terzo_occhio"],
    advantageDetails: {},
    disadvantages: [],
    speciale: "+1 success to any defense and reaction against demons and beings that hold Impiety points."
  },
  {
    id: "drago_giovane",
    name: "Drago giovane",
    rango: 12,
    type: "creatura_fantastica",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 4, carisma: 2, forza: 4, percezione: 3, ragionamento: 2, volonta: 4 },
    skills: { autorita: 3, empatia: 3, furtivita: 2, lotta: 4, raggirare: 3 },
    riflessi: 12,
    movement: { walk: 7, fly: 21 },
    ferite: [5, 5, 4, 4, 4],
    fatica: [7, 7, 7],
    protezione: 6,
    attacks: [
      { name: "Artiglio", skill: "lotta", misura: "Media", damage: "+3T" },
      { name: "Secondo artiglio", skill: "lotta", misura: "Media", damage: "+3T" },
      { name: "Morso", skill: "lotta", misura: "Stretta", damage: "+5T" }
    ],
    advantages: ["aura_letale", "ferocia", "paura"],
    advantageDetails: { aura_letale: 2, paura: 3 },
    disadvantages: [],
    speciale: "Breath: 5m x 10m cone, 4 successes, Agility reaction, 2 wounds per uncontested success. Sweep: 4 successes, Wide reach, 2m radius, 3 wounds per uncontested success."
  },
  {
    id: "drago_adulto",
    name: "Drago adulto",
    rango: 16,
    type: "creatura_fantastica",
    sizeCategory: "enorme",
    isTemplate: false,
    abilities: { agilita: 3, carisma: 3, forza: 5, percezione: 4, ragionamento: 3, volonta: 5 },
    skills: { autorita: 4, empatia: 4, furtivita: 1, lotta: 5, raggirare: 4 },
    riflessi: 10,
    movement: { walk: 7, fly: 14 },
    ferite: [8, 8, 8, 7, 7],
    fatica: [10, 10, 10],
    protezione: 8,
    attacks: [
      { name: "Artiglio", skill: "lotta", misura: "Larga", damage: "+4T" },
      { name: "Secondo artiglio", skill: "lotta", misura: "Larga", damage: "+4T" },
      { name: "Morso", skill: "lotta", misura: "Media", damage: "+6T" }
    ],
    advantages: ["afferrare", "aura_letale", "ferocia", "paura"],
    advantageDetails: { aura_letale: 3, paura: 4 },
    disadvantages: [],
    speciale: "Breath: 10m x 20m cone, 5 successes, Agility reaction, 3 wounds per uncontested success. Sweep: 4 successes, Largest reach, 4m radius, 4 wounds per uncontested success."
  },
  // ── 11.5 — Demons ──────────────────────────────────────────────────────
  {
    id: "demone_acqua",
    name: "Demone dell'acqua",
    rango: 15,
    type: "demone",
    sizeCategory: "enorme",
    isTemplate: false,
    abilities: { forza: 5, percezione: 3, volonta: 5 },
    skills: { lotta: 5 },
    riflessi: 12,
    movement: { walk: 7 },
    ferite: [8, 7, 7, 7, 7],
    fatica: [10, 10, 10],
    protezione: 6,
    attacks: [
      { name: "Morso", skill: "lotta", misura: "Larga", damage: "+4T" }
    ],
    advantages: ["afferrare", "aura_infernale", "immunita_freddo", "ostacolare", "paura", "scatto_fulmineo"],
    advantageDetails: { aura_infernale: 2, ostacolare: 3, paura: 4 },
    disadvantages: [],
    speciale: "Three times per day, may spend 2 consecutive actions to unleash a whirlpool/storm (100m radius, 12 turns). Boats: a Profession (sailor/pilot) check vs difficulty 5, or the vessel capsizes. In spirit form: immune to mundane damage, Incorporeal, Invisible, Third Eye, Night Vision."
  },
  {
    id: "demone_aria",
    name: "Demone dell'aria",
    rango: 3,
    type: "demone",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 3, carisma: 4, forza: 2, percezione: 5, ragionamento: 4, volonta: 4 },
    skills: { autorita: 3, empatia: 4, furtivita: 4, lotta: 4, raggirare: 4 },
    riflessi: 13,
    movement: { walk: 6, fly: 18 },
    ferite: [2, 2, 2, 1, 1],
    fatica: [5, 5, 5],
    protezione: 0,
    attacks: [
      { name: "Tocco corruttore", skill: "lotta", misura: "Stretta", damage: "speciale" }
    ],
    advantages: ["aura_infernale", "fascinazione", "ferocia", "incorporeo", "invisibilita", "ostacolare"],
    advantageDetails: { aura_infernale: 1, fascinazione: 5 },
    disadvantages: [],
    speciale: "An attack that deals at least one wound also causes bleeding. Hinder: Agility reaction vs 4 successes for a small tremor, 10m radius. Lethal gaze (confusion). Once per day, whisper lies: Willpower reaction vs the demon's Deceive. In spirit form: immune to mundane damage, Incorporeal, Invisible, Third Eye, Night Vision."
  },
  {
    id: "demone_fuoco",
    name: "Demone del fuoco",
    rango: 7,
    type: "demone",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 3, carisma: 3, forza: 3, percezione: 4, ragionamento: 3, volonta: 3 },
    skills: { armi_da_guerra: 4, autorita: 3, empatia: 3, lotta: 4, raggirare: 4 },
    riflessi: 9,
    movement: { walk: 5, fly: 15 },
    ferite: [3, 3, 3, 3, 2],
    fatica: [6, 6, 6],
    protezione: 2,
    attacks: [
      { name: "Arma infuocata", skill: "armi_da_guerra", misura: "Larga", damage: "+1 fuoco" }
    ],
    advantages: ["aura_infernale", "aura_letale", "immunita_fuoco", "paura"],
    advantageDetails: { aura_infernale: 2, aura_letale: 3, paura: 3 },
    disadvantages: [],
    speciale: "Two-handed flaming weapon (Wide reach, normal stats +1 fire damage). Flame burst: 4 successes, Agility reaction, 2 fire wounds per uncontested success, 10m range. Lethal aura: fire, 3 successes, 10m radius. Phantastikos: attacks dreams and manifests in mirrors/polished metal even by day. The only demon that tolerates sunlight. In spirit form: immune to mundane damage, Incorporeal, Invisible, Third Eye, Night Vision."
  },
  {
    id: "demone_sottosuolo",
    name: "Demone del sottosuolo",
    rango: 10,
    type: "demone",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 4, carisma: 2, forza: 4, percezione: 5, ragionamento: 3, volonta: 5 },
    skills: { autorita: 3, empatia: 3, lotta: 4, raggirare: 4 },
    riflessi: 10,
    movement: { walk: 5 },
    ferite: [4, 3, 3, 3, 3],
    fatica: [8, 8, 8],
    protezione: 4,
    attacks: [
      { name: "Artiglio", skill: "lotta", misura: "Media", damage: "+3T", parata: 2 },
      { name: "Secondo artiglio", skill: "lotta", misura: "Media", damage: "+3T", parata: 2 }
    ],
    advantages: ["aura_infernale", "ferocia", "ostacolare", "paura", "sguardo_letale"],
    advantageDetails: { aura_infernale: 2, ostacolare: 4, paura: 3 },
    disadvantages: [],
    speciale: "At least one wound also causes bleeding. Hinder: Agility reaction vs 4 successes for an earthquake, 10m radius. Lethal gaze (confusion). In spirit form: immune to mundane damage, Incorporeal, Invisible, Third Eye, Night Vision."
  },
  {
    id: "demone_terra",
    name: "Demone della terra",
    rango: 7,
    type: "demone",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { agilita: 2, carisma: 3, forza: 4, percezione: 4, ragionamento: 3, volonta: 4 },
    skills: { autorita: 4, empatia: 3, lotta: 4, raggirare: 3 },
    riflessi: 8,
    movement: { walk: 5 },
    ferite: [4, 4, 4, 4, 4],
    fatica: [8, 8, 8],
    protezione: 4,
    attacks: [
      { name: "Morso", skill: "lotta", misura: "Media", damage: "+3T" }
    ],
    advantages: ["afferrare", "aura_infernale", "ferocia", "paura"],
    advantageDetails: { aura_infernale: 1, paura: 3 },
    disadvantages: [],
    speciale: "In spirit form: immune to mundane damage, Incorporeal, Invisible, Third Eye, Night Vision."
  },
  {
    id: "demone_ombra",
    name: "Demone dell'ombra",
    rango: 6,
    type: "demone",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 4, percezione: 4, volonta: 4 },
    skills: { furtivita: 4, lotta: 4 },
    riflessi: 13,
    movement: { walk: 6 },
    ferite: [3, 3, 3, 3, 3],
    fatica: [4, 4, 4],
    protezione: 0,
    attacks: [
      { name: "Tocco corruttore", skill: "lotta", misura: "Stretta", damage: "speciale" }
    ],
    advantages: ["aura_infernale", "aura_letale", "immunita_freddo", "incorporeo", "mente_vacua", "non_vita", "paura"],
    advantageDetails: { aura_infernale: 1, aura_letale: 3, paura: 3 },
    disadvantages: ["notturno"],
    speciale: "Corrupting touch: deals no damage but causes loss of 1 Fatigue per net success. Lethal aura: Force reaction vs 3 successes for gusts of freezing air, 10m radius."
  },
  // ── 11.6 — Fairy Folk (Il Popolo Fatato) ────────────────────────────────
  {
    id: "arpie",
    name: "Arpie",
    rango: 4,
    type: "fatato",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 3, forza: 3, percezione: 3, volonta: 3 },
    skills: { furtivita: 3, lotta: 3 },
    riflessi: 13,
    movement: { walk: 6, fly: 21 },
    ferite: [2, 2, 2, 2, 2],
    fatica: [5, 5, 5],
    protezione: 0,
    attacks: [
      { name: "Artigli", skill: "lotta", misura: "Stretta", damage: "+2T" }
    ],
    advantages: ["afferrare", "fascinazione", "tocco_fatato", "terzo_occhio"],
    advantageDetails: { fascinazione: 4 },
    disadvantages: [],
    speciale: "Fascination (hearing). Like all fae, they have Fae Touch, Third Eye, and Beyond the Veil."
  },
  {
    id: "cane_fatato",
    name: "Cane fatato",
    rango: 2,
    type: "creatura_fantastica",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 3, forza: 3, percezione: 4, volonta: 4 },
    skills: { furtivita: 2, lotta: 4 },
    riflessi: 11,
    movement: { walk: 7 },
    ferite: [4, 3, 3, 3, 3],
    fatica: [7, 7, 7],
    protezione: 2,
    attacks: [
      { name: "Morso", skill: "lotta", misura: "Stretta", damage: "+1T" }
    ],
    advantages: ["afferrare", "ferocia"],
    advantageDetails: {},
    disadvantages: ["notturno"],
    speciale: "Fascination (sight). Hinder: Agility or Force reaction vs 3 successes as vegetation grows, 5m radius. Like all fae, they have Fae Touch, Third Eye, and Beyond the Veil."
  },
  {
    id: "driade",
    name: "Driade",
    rango: 4,
    type: "fatato",
    sizeCategory: "media",
    isTemplate: false,
    abilities: { agilita: 4, carisma: 3, forza: 2, percezione: 3, ragionamento: 2, volonta: 3 },
    skills: { autorita: 2, empatia: 3, furtivita: 4, lotta: 2, raggirare: 2 },
    riflessi: 14,
    movement: { walk: 6 },
    ferite: [2, 2, 2, 2, 2],
    fatica: [5, 5, 5],
    protezione: 0,
    attacks: [],
    advantages: ["fascinazione", "ostacolare", "sfuggente", "terzo_occhio", "tocco_fatato"],
    advantageDetails: { fascinazione: 4, ostacolare: 3 },
    disadvantages: ["vincolo"],
    speciale: "Fascination (sight). Hinder: Agility or Force reaction vs 3 successes as vegetation grows, 5m radius. Bound to an oak. Like all fae, they have Fae Touch, Third Eye, and Beyond the Veil."
  },
  {
    id: "folletti",
    name: "Folletti",
    rango: 4,
    type: "fatato",
    sizeCategory: "piccola",
    isTemplate: false,
    abilities: { agilita: 4, carisma: 3, forza: 2, percezione: 3, ragionamento: 2, volonta: 3 },
    skills: { archi: 3, armi_corte: 3, autorita: 2, empatia: 2, furtivita: 4, lotta: 2, raggirare: 3 },
    riflessi: 14,
    movement: { walk: 5 },
    ferite: [2, 2, 2, 1],
    fatica: [4, 4, 4],
    protezione: 0,
    attacks: [
      { name: "Coltellaccio o pugnale", skill: "armi_corte", misura: "Stretta", damage: "+2T" },
      { name: "Arco corto", skill: "archi", misura: null, damage: "+2P" }
    ],
    advantages: ["invisibilita", "sfuggente", "terzo_occhio", "tocco_fatato"],
    advantageDetails: {},
    disadvantages: ["notturno"],
    speciale: "Up to four times per day, may vanish and reappear within 90m, or transform into a Small animal for one hour. Like all fae, they have Fae Touch, Third Eye, and Beyond the Veil."
  },
  {
    id: "giganti",
    name: "Giganti",
    rango: 8,
    type: "fatato",
    sizeCategory: "enorme",
    isTemplate: false,
    abilities: { carisma: 2, forza: 5, percezione: 2, ragionamento: 2, volonta: 4 },
    skills: { armi_comuni: 5, autorita: 4, empatia: 2, lotta: 5, raggirare: 2 },
    riflessi: 8,
    movement: { walk: 7 },
    ferite: [7, 7, 7, 7, 6],
    fatica: [13, 13, 13],
    protezione: 6,
    attacks: [
      { name: "Lotta", skill: "lotta", misura: "Larga", damage: "+3B", parata: 1 },
      { name: "Macigno", skill: "forza", misura: null, damage: "+4B" }
    ],
    advantages: ["afferrare", "ferocia", "tocco_fatato", "terzo_occhio"],
    advantageDetails: {},
    disadvantages: [],
    speciale: "Base weapon increases Reach by two categories, damage by +3, and Parry by +2. Boulder thrown with Force, range 20. Like all fae, they have Fae Touch, Third Eye, and Beyond the Veil."
  },
  {
    id: "orchi",
    name: "Orchi",
    rango: 3,
    type: "fatato",
    sizeCategory: "grande",
    isTemplate: false,
    abilities: { forza: 4, percezione: 2, volonta: 3 },
    skills: { armi_comuni: 4, autorita: 1, empatia: 2, furtivita: 1, lotta: 4, raggirare: 2 },
    riflessi: 9,
    movement: { walk: 6 },
    ferite: [5, 5, 4, 4, 4],
    fatica: [10, 10, 10],
    protezione: 3,
    attacks: [
      { name: "Lotta", skill: "lotta", misura: "Stretta", damage: "+2B", parata: 1 }
    ],
    advantages: ["tocco_fatato", "terzo_occhio"],
    advantageDetails: {},
    disadvantages: [],
    speciale: "Base weapon increases Reach by one category and damage and Parry by +1. Like all fae, they have Fae Touch, Third Eye, and Beyond the Veil."
  }
];

// node_modules/@federicomorando/sword-engine/src/use-cases/resolve-check.mjs
function computeSpiritoBudget({ spiritoAvailable, valoreSelected, valoreScore, combinedSpiritoCost, spiritoCancelPenalty }) {
  const valoreCost = valoreSelected ? 3 : 0;
  let totalNeeded = valoreCost + combinedSpiritoCost + spiritoCancelPenalty;
  if (totalNeeded <= spiritoAvailable) {
    return { valoreSelected, valoreScore, spiritoCancelPenalty, spiritoTotal: totalNeeded };
  }
  const availableAfterFixed = spiritoAvailable - valoreCost - combinedSpiritoCost;
  if (availableAfterFixed >= 0) {
    spiritoCancelPenalty = Math.min(spiritoCancelPenalty, availableAfterFixed);
  } else {
    valoreSelected = null;
    valoreScore = 0;
    spiritoCancelPenalty = Math.min(spiritoCancelPenalty, Math.max(0, spiritoAvailable - combinedSpiritoCost));
  }
  const spiritoTotal = (valoreSelected ? 3 : 0) + combinedSpiritoCost + spiritoCancelPenalty;
  return { valoreSelected, valoreScore, spiritoCancelPenalty, spiritoTotal };
}
function resolveCheck(intent, state, diceRolled) {
  const {
    characteristicScore,
    diceCount,
    grade,
    extraDice = 0,
    focusDice = 0,
    famaSpend = 0,
    mondanoBonus = 0,
    contextualDice = 0,
    combinedGrade = 0,
    combinedCostSource = "spirito",
    inCombat = false,
    valoreSelected: reqValore = null,
    valoreScore: reqValoreScore = 0,
    hasActivationPlus1 = false,
    spiritoCancelPenalty: reqCancel = 0,
    successBonus = 0,
    difficultyThreshold = null,
    opposedSuccesses = null,
    hasRiflessiCostMinus1 = false
  } = intent;
  const combinedSpiritoCost = combinedGrade > 0 && combinedCostSource === "spirito" ? 1 : 0;
  const combinedFaticaCost = combinedGrade > 0 && combinedCostSource === "fatica" ? 1 : 0;
  let combinedRiflessiCost = combinedGrade > 0 && inCombat ? 3 : 0;
  if (combinedRiflessiCost > 0 && hasRiflessiCostMinus1) {
    combinedRiflessiCost = Math.max(0, combinedRiflessiCost - 1);
  }
  const basePenalty = computeBasePenalty(state);
  const cancelRequested = Math.max(0, Math.min(reqCancel, basePenalty));
  const budget = computeSpiritoBudget({
    spiritoAvailable: state.spirito,
    valoreSelected: reqValore,
    valoreScore: reqValoreScore,
    combinedSpiritoCost,
    spiritoCancelPenalty: cancelRequested
  });
  const effectivePenalty = basePenalty - budget.spiritoCancelPenalty;
  const totalExtraDice = extraDice + famaSpend + mondanoBonus + contextualDice + focusDice;
  const effectiveGrade = grade + combinedGrade;
  const engineOutput = swordCheckResolve({
    characteristicScore,
    diceCount,
    grade: effectiveGrade,
    extraDice: totalExtraDice,
    successBonus,
    successPenalty: effectivePenalty,
    difficultyThreshold,
    opposedSuccesses,
    diceRolled,
    discardIndices: null
  });
  const { valoreUsed, valoreBonus } = applyValoreBonus(engineOutput, {
    valoreSelected: budget.valoreSelected,
    valoreScore: budget.valoreScore,
    hasActivationPlus1
  });
  const patches = {};
  if (budget.spiritoTotal > 0) {
    patches["resources.spirito"] = state.spirito - budget.spiritoTotal;
  }
  if (famaSpend > 0) {
    patches["fama"] = state.fama - famaSpend;
  }
  if (combinedFaticaCost > 0) {
    patches["resources.fatica"] = Math.max(0, state.fatica - combinedFaticaCost);
  }
  if (combinedRiflessiCost > 0) {
    patches["resources.riflessi"] = Math.max(0, state.riflessi - combinedRiflessiCost);
  }
  applySpiritoOverflow(patches, state.fatica);
  return {
    engineOutput,
    valoreUsed,
    valoreName: budget.valoreSelected || "",
    valoreBonus,
    basePenalty,
    effectivePenalty,
    spiritoCancelPenalty: budget.spiritoCancelPenalty,
    combinedGrade,
    combinedRiflessiCost,
    totalExtraDice,
    patches
  };
}

// node_modules/@federicomorando/sword-engine/src/use-cases/resolve-attack.mjs
function resolveAttack(intent, state, diceRolled) {
  const {
    characteristicScore,
    diceCount: rawDiceCount,
    grade,
    extraDice = 0,
    focusDice = 0,
    famaSpend = 0,
    mondanoBonus = 0,
    approach = "corsa",
    situationalMod = 0,
    isRanged = false,
    rangedDistance = 0,
    gittata = 0,
    coverDifficulty = 0,
    specialMove = null,
    specialMoveTarget = null,
    combinedGrade = 0,
    combinedCostSource = "spirito",
    inCombat = false,
    valoreSelected: reqValore = null,
    valoreScore: reqValoreScore = 0,
    hasActivationPlus1 = false,
    spiritoCancelPenalty: reqCancel = 0,
    hasRiflessiCostMinus1 = false,
    useSbracciata = false,
    useFormation = false,
    useTacticalAdvantage = false,
    targetSenzaFiato = false,
    successiveShotBonus = 0,
    mounted = false,
    mountForzaGrade = 0,
    hasDoubleCharge = false,
    isDualWieldAttack = false,
    grappleForzaGrade = 0,
    // eslint-disable-line no-unused-vars -- deprecated, kept for API compat
    daCavalloWeaponBonus = 0,
    isCrossbowAim = false,
    cecchinoGittataBonus = 0,
    cecchinoPenaltyReduction = 0,
    cecchinoCoverReduction = 0,
    cecchinoProtectionReduction = 0,
    attackCombatCtx = null,
    talents = null,
    nonLethalBottaBonus = 0,
    weaponMisura = null,
    engagementMisura = null,
    hasCompatta = false,
    weaponPregi = []
  } = intent;
  const diceCount = Math.max(2, rawDiceCount);
  const approachMod = APPROACH_MODS[approach] || APPROACH_MODS.corsa;
  const approachBonus = Math.max(0, approachMod.checkMod);
  const approachPenalty = Math.max(0, -approachMod.checkMod);
  const effectiveGittata = gittata + cecchinoGittataBonus;
  const rangePenalty = isRanged ? computeRangePenalty(rangedDistance, effectiveGittata) : 0;
  const specialMoveDifficulty = specialMove ? computeSpecialMoveDifficulty(specialMove, specialMoveTarget) : null;
  const misuraPenalty = !isRanged && weaponMisura && engagementMisura ? computeMisuraPenalty(weaponMisura, engagementMisura, hasCompatta) : 0;
  const combinedSpiritoCost = combinedGrade > 0 && combinedCostSource === "spirito" ? 1 : 0;
  const combinedFaticaCost = combinedGrade > 0 && combinedCostSource === "fatica" ? 1 : 0;
  let combinedRiflessiCost = combinedGrade > 0 && inCombat ? 3 : 0;
  if (combinedRiflessiCost > 0 && hasRiflessiCostMinus1) {
    combinedRiflessiCost = Math.max(0, combinedRiflessiCost - 1);
  }
  const effectiveFama = Math.min(Math.max(famaSpend, 0), state.fama);
  const basePenalty = computeBasePenalty(state);
  const clampedCancel = Math.min(Math.max(reqCancel, 0), basePenalty);
  const budget = computeSpiritoBudget({
    spiritoAvailable: state.spirito,
    valoreSelected: reqValore,
    valoreScore: reqValoreScore,
    combinedSpiritoCost,
    spiritoCancelPenalty: clampedCancel
  });
  const effectivePenalty = basePenalty - budget.spiritoCancelPenalty;
  const isMountedCharge = mounted && approach === "carica" && !isRanged;
  let mountChargeGradeBonus = 0;
  let mountChargeDamageBonus = 0;
  if (isMountedCharge && mountForzaGrade > 0) {
    mountChargeGradeBonus = hasDoubleCharge ? mountForzaGrade * 2 : mountForzaGrade;
    mountChargeDamageBonus = 2;
  }
  let talentSuccessBonus = 0;
  let talentDamageBonus = 0;
  if (talents && attackCombatCtx) {
    talentSuccessBonus = computeTalentCombatBonus(talents, "successBonus", attackCombatCtx);
    talentDamageBonus = computeTalentCombatBonus(talents, "damageMod", attackCombatCtx);
  }
  const formationBonus = useFormation ? 1 : 0;
  const tacticalAdvantageBonus = useTacticalAdvantage ? 1 : 0;
  const senzaFiatoBonus = targetSenzaFiato ? 1 : 0;
  const mountedRangedPenalty = isRanged && mounted ? MOUNTED_GALLOP_RANGED_PENALTY : 0;
  const dualWieldPenalty = isDualWieldAttack ? 1 : 0;
  const mountedVsUnmountedBonus = mounted && !intent.targetMounted ? 1 : 0;
  const targetSize = intent.targetSizeCategory || "media";
  let sizeBonus = 0;
  if (targetSize === "piccola") sizeBonus = -1;
  else if (targetSize === "grande" && isRanged) sizeBonus = 1;
  else if (targetSize === "enorme") sizeBonus = isRanged ? 2 : 1;
  const successBonus = Math.max(0, situationalMod) + approachBonus + senzaFiatoBonus + talentSuccessBonus + nonLethalBottaBonus + tacticalAdvantageBonus + successiveShotBonus + cecchinoPenaltyReduction + formationBonus + mountedVsUnmountedBonus + Math.max(0, sizeBonus);
  const successPenalty = effectivePenalty + Math.max(0, -situationalMod) + approachPenalty + rangePenalty + misuraPenalty + mountedRangedPenalty + dualWieldPenalty + Math.abs(Math.min(0, sizeBonus));
  let difficultyThreshold = null;
  const effectiveCoverDifficulty = Math.max(0, coverDifficulty - cecchinoCoverReduction);
  if (isRanged && effectiveCoverDifficulty > 0) {
    difficultyThreshold = effectiveCoverDifficulty;
  } else if (specialMoveDifficulty !== null) {
    difficultyThreshold = specialMoveDifficulty;
  }
  const totalExtraDice = extraDice + focusDice + effectiveFama + mondanoBonus + daCavalloWeaponBonus;
  const effectiveGrade = grade + combinedGrade + mountChargeGradeBonus;
  const engineOutput = swordCheckResolve({
    characteristicScore,
    diceCount,
    grade: effectiveGrade,
    extraDice: totalExtraDice,
    successBonus,
    successPenalty,
    difficultyThreshold,
    opposedSuccesses: null,
    diceRolled,
    discardIndices: null
  });
  const { valoreUsed, valoreBonus } = applyValoreBonus(engineOutput, {
    valoreSelected: budget.valoreSelected,
    valoreScore: budget.valoreScore,
    hasActivationPlus1
  });
  const effectiveAttackHit = engineOutput.basePassed && (engineOutput.difficultyPassed === null || engineOutput.difficultyPassed === true);
  const sbracciataDmg = useSbracciata ? 1 : 0;
  const totalTalentDamageBonus = talentDamageBonus + sbracciataDmg + mountChargeDamageBonus;
  const pesanteRiflessiCost = computePesanteRiflessiCost(weaponPregi);
  const patches = {};
  if (budget.spiritoTotal > 0) {
    patches["resources.spirito"] = state.spirito - budget.spiritoTotal;
  }
  if (effectiveFama > 0) {
    patches["fama"] = state.fama - effectiveFama;
  }
  if (useSbracciata) {
    const curFatica = patches["resources.fatica"] ?? state.fatica;
    patches["resources.fatica"] = Math.max(0, curFatica - 1);
  }
  if (combinedFaticaCost > 0) {
    const curFatica = patches["resources.fatica"] ?? state.fatica;
    patches["resources.fatica"] = Math.max(0, curFatica - combinedFaticaCost);
  }
  if (combinedRiflessiCost > 0) {
    patches["resources.riflessi"] = Math.max(0, state.riflessi - combinedRiflessiCost);
  }
  applySpiritoOverflow(patches, state.fatica);
  return {
    engineOutput,
    effectiveAttackHit,
    valoreUsed,
    valoreName: budget.valoreSelected || "",
    valoreBonus,
    basePenalty,
    effectivePenalty,
    spiritoCancelPenalty: budget.spiritoCancelPenalty,
    approach,
    approachDefMod: approachMod.defMod,
    rangePenalty,
    misuraPenalty,
    specialMove,
    specialMoveTarget,
    specialMoveDifficulty,
    difficultyThreshold,
    successBonus,
    successPenalty,
    totalExtraDice,
    talentSuccessBonus,
    talentDamageBonus: totalTalentDamageBonus,
    senzaFiatoBonus,
    nonLethalBottaBonus,
    formationBonus,
    tacticalAdvantageBonus,
    successiveShotBonus,
    mountedRangedPenalty,
    dualWieldPenalty,
    isMountedCharge,
    mountChargeGradeBonus,
    mountChargeDamageBonus,
    daCavalloWeaponBonus,
    isCrossbowAim,
    cecchinoGittataBonus,
    cecchinoPenaltyReduction,
    cecchinoCoverReduction,
    cecchinoProtectionReduction,
    combinedGrade,
    combinedRiflessiCost,
    pesanteRiflessiCost,
    isDualWieldAttack,
    mounted,
    engagementMisura,
    weaponMisura,
    patches
  };
}

// node_modules/@federicomorando/sword-engine/src/use-cases/resolve-defense.mjs
function resolveDefenseCheck(attackResult, intent, state, diceRolled) {
  const attackSuccesses = attackResult.engineOutput ? attackResult.engineOutput.finalSuccesses : attackResult.finalSuccesses;
  const {
    characteristicScore,
    diceCount: rawDiceCount,
    grade,
    extraDice = 0,
    focusDice = 0,
    approach = "corsa",
    parryModifier = 0,
    spiritoCancelPenalty: reqCancel = 0,
    defenseMode,
    talentParryBonus = 0,
    talentSuccessBonus = 0,
    tacticalAdvantageBonus = 0,
    polearmMasteryBonus = 0,
    formationBonus = 0,
    mountedDefenseBonus = 0,
    hasRiflessiCostMinus1 = false,
    useSpiritoForRiflessi = false,
    isAccompagnata = false,
    accompagnataParryMod = 0
  } = intent;
  const diceCount = Math.max(2, rawDiceCount);
  const basePenalty = computeBasePenalty(state);
  const spiritoCancelPenalty = Math.min(Math.max(reqCancel, 0), basePenalty, state.spirito);
  const effectivePenalty = basePenalty - spiritoCancelPenalty;
  const approachMod = APPROACH_MODS[approach] || APPROACH_MODS.corsa;
  const effectiveParryMod = isAccompagnata ? accompagnataParryMod : parryModifier;
  const totalDefBonus = effectiveParryMod + approachMod.defMod + talentParryBonus;
  const successBonus = Math.max(0, totalDefBonus) + talentSuccessBonus + tacticalAdvantageBonus + polearmMasteryBonus + formationBonus + mountedDefenseBonus;
  const successPenalty = effectivePenalty + Math.max(0, -totalDefBonus);
  const totalExtraDice = extraDice + focusDice;
  const engineOutput = swordCheckResolve({
    characteristicScore,
    diceCount,
    grade,
    extraDice: totalExtraDice,
    successBonus,
    successPenalty,
    difficultyThreshold: null,
    opposedSuccesses: attackSuccesses,
    diceRolled,
    discardIndices: null
  });
  let riflessiCost;
  if (defenseMode === "maestro") {
    riflessiCost = attackSuccesses;
  } else if (defenseMode === "parata" || defenseMode === "freeShield" || defenseMode === "freeSword" || defenseMode === "accompagnata") {
    riflessiCost = 0;
  } else {
    riflessiCost = computeReactionRiflessiCost(attackSuccesses, engineOutput.netSuccesses);
  }
  if (riflessiCost > 0 && hasRiflessiCostMinus1) {
    riflessiCost = Math.max(0, riflessiCost - 1);
  }
  const patches = {};
  if (spiritoCancelPenalty > 0) {
    patches["resources.spirito"] = state.spirito - spiritoCancelPenalty;
  }
  if (riflessiCost > 0) {
    if (useSpiritoForRiflessi) {
      const curSpirito = patches["resources.spirito"] ?? state.spirito;
      patches["resources.spirito"] = Math.max(0, curSpirito - riflessiCost);
    } else {
      patches["resources.riflessi"] = state.riflessi - riflessiCost;
    }
  }
  applySpiritoOverflow(patches, state.fatica);
  return {
    engineOutput,
    defenseSucceeded: engineOutput.netSuccesses >= 0,
    attackSuccesses,
    basePenalty,
    effectivePenalty,
    spiritoCancelPenalty,
    riflessiCost,
    approach,
    totalExtraDice,
    talentParryBonus,
    talentSuccessBonus,
    successBonus,
    successPenalty,
    useSpiritoForRiflessi,
    patches
  };
}
function resolveDefenseOutcome(attackResult, defenseResult, defenderState, options = {}) {
  const {
    specialMove = null,
    specialMoveTarget = null,
    talentDamageBonus = 0,
    cecchinoProtectionReduction = 0,
    weaponPregi = [],
    sicarioDamageBonus = 0,
    sicarioBleeding = false,
    axeMasteryActive = false,
    engagementMisura = null
  } = attackResult;
  const {
    damageValue = 0,
    damageType = "T"
  } = attackResult;
  const netSuccesses = defenseResult.netSuccesses ?? defenseResult.engineOutput?.netSuccesses ?? 0;
  const defenseSucceeded = defenseResult.defenseSucceeded ?? netSuccesses >= 0;
  const {
    woundLevels,
    woundCapacities,
    fatica = 0,
    riflessi = 0,
    armorProtezione = 0,
    armorRobustezzaCurrent = 0,
    hasHalveExcessFaticaWounds = false,
    talents = null,
    hasArmor = false,
    mounted = false,
    armorPregi = []
  } = defenderState;
  const { isAccompagnata = false } = options;
  const patches = {};
  let damageResult = null;
  let specialMoveResult = null;
  let woundsApplied = 0;
  let newWounds = null;
  const forzaReactions = [];
  let grappleFollowUpGradeBonus = 0;
  if (specialMove === "grapple" && !defenseSucceeded) {
    grappleFollowUpGradeBonus = computeGrappleFollowUpBonus(-netSuccesses);
  }
  let canCloseMisura = false;
  if (defenseSucceeded && netSuccesses >= 3 && engagementMisura) {
    canCloseMisura = true;
  }
  if (!defenseSucceeded) {
    const netAttackSuccesses = -netSuccesses;
    if (specialMove === "nonLethal") {
      const newFatica = Math.max(0, fatica - netAttackSuccesses);
      patches["resources.fatica"] = newFatica;
      let faticaOverflowWounds = Math.max(0, netAttackSuccesses - fatica);
      if (faticaOverflowWounds > 0 && hasHalveExcessFaticaWounds) {
        faticaOverflowWounds = Math.ceil(faticaOverflowWounds / 2);
      }
      if (faticaOverflowWounds > 0) {
        newWounds = distributeWounds(woundLevels, woundCapacities, faticaOverflowWounds);
      }
      specialMoveResult = {
        type: "nonLethal",
        faticaInflicted: netAttackSuccesses,
        overflowWounds: faticaOverflowWounds || 0
      };
    } else if (specialMove === "feint") {
      let riflessiLoss = netAttackSuccesses;
      const hasAgganciare = weaponPregi.includes("agganciare");
      if (hasAgganciare) riflessiLoss += 1;
      patches["resources.riflessi"] = (patches["resources.riflessi"] ?? riflessi) - riflessiLoss;
      specialMoveResult = {
        type: "feint",
        riflessiLost: riflessiLoss,
        agganciare: hasAgganciare
      };
    } else if (specialMove === "grapple") {
      specialMoveResult = {
        type: "grapple",
        freeStrikeBonus: GRAPPLE_FREE_STRIKE_BONUS
      };
    } else {
      const totalTalentDmg = talentDamageBonus + sicarioDamageBonus;
      let talentProtBonus = 0;
      if (talents) {
        const defProtCtx = { hasArmor, isRanged: false };
        talentProtBonus = computeTalentCombatBonus(talents, "protectionMod", defProtCtx);
      }
      const daCavalloArmorBon = computeDaCavalloArmorBonus(armorPregi, mounted);
      const effectiveProtezione = Math.max(
        0,
        armorProtezione + talentProtBonus + daCavalloArmorBon - cecchinoProtectionReduction
      );
      damageResult = resolveDamage({
        netSuccesses: netAttackSuccesses,
        weaponDamage: damageValue + totalTalentDmg,
        damageType,
        armorProtezione: effectiveProtezione,
        armorRobustezzaCurrent
      });
      woundsApplied = damageResult.netWounds;
      if (woundsApplied > 0) {
        newWounds = distributeWounds(woundLevels, woundCapacities, woundsApplied);
      }
      if (damageResult.bluntRiflessi > 0) {
        patches["resources.riflessi"] = (patches["resources.riflessi"] ?? riflessi) - damageResult.bluntRiflessi;
      }
      if (specialMove === "targetedAttack") {
        specialMoveResult = { type: "targetedAttack", target: specialMoveTarget };
      }
    }
  }
  if (newWounds) {
    patches["woundLevels.graffi"] = newWounds.graffi;
    patches["woundLevels.leggere"] = newWounds.leggere;
    patches["woundLevels.gravi"] = newWounds.gravi;
    patches["woundLevels.critiche"] = newWounds.critiche;
    patches["woundLevels.mortali"] = newWounds.mortali;
  }
  const oldCritiche = woundLevels.critiche ?? 0;
  const oldMortali = woundLevels.mortali ?? 0;
  let triggerSanguinamento = false;
  if (newWounds && oldCritiche === 0 && newWounds.critiche > 0) {
    triggerSanguinamento = true;
  }
  let triggerSicarioBleeding = false;
  if (sicarioBleeding && woundsApplied > 0) {
    triggerSicarioBleeding = true;
  }
  let axeMasteryFaticaLoss = 0;
  let axeMasteryRiflessiLoss = 0;
  if (axeMasteryActive && woundsApplied > 0) {
    axeMasteryFaticaLoss = woundsApplied;
    axeMasteryRiflessiLoss = woundsApplied;
  }
  if (newWounds && oldCritiche === 0 && newWounds.critiche > 0) {
    forzaReactions.push({ type: "critiche", threat: newWounds.critiche });
  }
  if (newWounds && oldMortali === 0 && newWounds.mortali > 0) {
    forzaReactions.push({ type: "mortali", threat: newWounds.mortali });
  }
  if (specialMove === "targetedAttack" && damageResult && damageResult.netWounds > 0) {
    forzaReactions.push({ type: "targetedAttack", threat: damageResult.netWounds, target: specialMoveTarget });
  }
  return {
    defenseSucceeded,
    netSuccesses,
    specialMoveResult,
    damageResult,
    woundsApplied,
    newWounds,
    triggerSanguinamento,
    triggerSicarioBleeding,
    axeMasteryFaticaLoss,
    axeMasteryRiflessiLoss,
    forzaReactions,
    canCloseMisura,
    grappleFollowUpGradeBonus,
    patches
  };
}

// node_modules/@federicomorando/sword-engine/src/use-cases/resolve-reaction.mjs
var REACTION_SKILL_MAP = {
  fatica: "forza",
  paura: "volonta",
  malattia: "forza",
  veleno: "forza",
  ferite: "forza",
  agilita: "agilita",
  cavalcare: "cavalcare"
};
function resolveReaction(intent, state, diceRolled) {
  const {
    reactionType,
    threatSuccesses: rawThreat,
    characteristicScore,
    diceCount: rawDiceCount,
    grade,
    extraDice = 0,
    spiritoCancelPenalty: reqCancel = 0,
    reactionTalentBonus = 0,
    hasRiflessiCostMinus1 = false,
    useSpiritoForRiflessi = false,
    isSenzaFiato = false,
    inCombat = false
  } = intent;
  const diceCount = Math.max(2, rawDiceCount);
  const threatSuccesses = Math.max(0, rawThreat);
  const basePenalty = (state.fatiguePenalty || 0) + (state.woundPenalty || 0) + (state.encumbrancePenalty || 0);
  const armorReactionPenalty = state.armorReactionPenalty || 0;
  const spiritoCancelPenalty = Math.min(Math.max(reqCancel, 0), basePenalty, state.spirito);
  const senzaFiatoPenalty = isSenzaFiato ? 1 : 0;
  const effectivePenalty = basePenalty - spiritoCancelPenalty + armorReactionPenalty + senzaFiatoPenalty;
  const engineOutput = swordCheckResolve({
    characteristicScore,
    diceCount,
    grade,
    extraDice,
    successBonus: reactionTalentBonus,
    successPenalty: effectivePenalty,
    difficultyThreshold: null,
    opposedSuccesses: threatSuccesses,
    diceRolled,
    discardIndices: null
  });
  const finalSuccesses = engineOutput.finalSuccesses;
  const passed = engineOutput.basePassed && finalSuccesses >= threatSuccesses;
  const netSuccesses = finalSuccesses - threatSuccesses;
  const uncontestedSuccesses = passed ? 0 : Math.max(0, threatSuccesses - finalSuccesses);
  let riflessiCost = 0;
  if (inCombat && !isSenzaFiato) {
    riflessiCost = computeReactionRiflessiCost(threatSuccesses, netSuccesses);
    if (riflessiCost > 0 && hasRiflessiCostMinus1) {
      riflessiCost = Math.max(0, riflessiCost - 1);
    }
  }
  let fatigaLost = 0;
  let fearOutcome = null;
  let fearFatigaLost = 0;
  let cavalcareOutcome = null;
  switch (reactionType) {
    case "fatica":
      if (!passed) fatigaLost = uncontestedSuccesses;
      break;
    case "paura":
      fearFatigaLost = threatSuccesses;
      if (!passed) {
        fearOutcome = computeFearOutcome(uncontestedSuccesses);
      }
      break;
    case "malattia":
    case "veleno":
      if (!passed) fatigaLost = uncontestedSuccesses;
      break;
    case "ferite":
      break;
    case "agilita":
      break;
    case "cavalcare":
      if (!passed) {
        cavalcareOutcome = computeUnhorsedOutcome(uncontestedSuccesses);
      }
      break;
  }
  const patches = {};
  const totalFaticaLost = fatigaLost + fearFatigaLost;
  if (totalFaticaLost > 0) {
    patches["resources.fatica"] = Math.max(0, state.fatica - totalFaticaLost);
  }
  if (riflessiCost > 0) {
    if (useSpiritoForRiflessi) {
      const curSpirito = patches["resources.spirito"] ?? state.spirito;
      patches["resources.spirito"] = Math.max(0, curSpirito - riflessiCost);
    } else {
      patches["resources.riflessi"] = state.riflessi - riflessiCost;
    }
  }
  if (spiritoCancelPenalty > 0) {
    const curSpirito = patches["resources.spirito"] ?? state.spirito;
    patches["resources.spirito"] = curSpirito - spiritoCancelPenalty;
  }
  applySpiritoOverflow(patches, state.fatica);
  return {
    engineOutput,
    passed,
    finalSuccesses,
    netSuccesses,
    uncontestedSuccesses,
    reactionType,
    threatSuccesses,
    riflessiCost,
    basePenalty,
    effectivePenalty,
    spiritoCancelPenalty,
    armorReactionPenalty,
    senzaFiatoPenalty,
    reactionTalentBonus,
    // Type-specific
    fatigaLost,
    fearOutcome,
    fearFatigaLost,
    cavalcareOutcome,
    patches
  };
}

// node_modules/@federicomorando/sword-engine/src/use-cases/resolve-sfida-turn.mjs
function resolveSfidaTurn(intent, sfidaState, charState, diceRolled) {
  const {
    characteristicScore,
    diceCount,
    grade,
    extraDice = 0,
    focusDice = 0,
    famaSpend = 0,
    mondanoBonus = 0,
    combinedGrade = 0,
    combinedCostSource = "spirito",
    valoreSelected = null,
    valoreScore = 0,
    hasActivationPlus1 = false,
    spiritoCancelPenalty: reqCancel = 0,
    hasRiflessiCostMinus1 = false,
    approach = "corsa",
    difficultyThreshold = null
  } = intent;
  const {
    confronto,
    opponentFixedSuccesses = 0,
    isMovement,
    minOneSuccess = false,
    riflessiDrain = false,
    costo,
    udienzaPenalty = 0
  } = sfidaState;
  const { checkMod: approachCheckMod, defMod: approachDefMod } = isMovement ? computeApproachModifiers(approach) : { checkMod: 0, defMod: 0 };
  const approachSuccessBonus = Math.max(0, approachCheckMod);
  const approachSuccessPenalty = Math.max(0, -approachCheckMod);
  const totalArmorPenalty = (charState.armorPenalty || 0) + udienzaPenalty + approachSuccessPenalty;
  const checkResult = resolveCheck({
    characteristicScore,
    diceCount,
    grade,
    extraDice,
    focusDice,
    famaSpend,
    mondanoBonus,
    combinedGrade,
    combinedCostSource,
    valoreSelected,
    valoreScore,
    hasActivationPlus1,
    spiritoCancelPenalty: reqCancel,
    successBonus: approachSuccessBonus,
    difficultyThreshold,
    opposedSuccesses: confronto ? opponentFixedSuccesses : null,
    hasRiflessiCostMinus1
  }, {
    fatiguePenalty: charState.fatiguePenalty,
    woundPenalty: charState.woundPenalty,
    armorPenalty: totalArmorPenalty,
    encumbrancePenalty: charState.encumbrancePenalty || 0,
    // The mandatory per-turn costo is reserved BEFORE optional spending:
    // valore activation and penalty cancellation budget only what remains
    spirito: costo === "spirito" ? Math.max(0, charState.spirito - 1) : charState.spirito,
    fama: charState.fama,
    fatica: charState.fatica,
    riflessi: charState.riflessi
  }, diceRolled);
  const engineOutput = checkResult.engineOutput;
  let turnSuccesses = computeTurnSuccesses(engineOutput, confronto);
  const { turnSuccesses: adjustedSuccesses, shortfallFatica } = applyMinOneSuccess(turnSuccesses, minOneSuccess);
  turnSuccesses = adjustedSuccesses;
  const newAccumulated = sfidaState.accumulatedSuccesses + turnSuccesses;
  const newTurnsUsed = sfidaState.turnsUsed + 1;
  const riflessiDrainAmount = computeRiflessiDrain(turnSuccesses, confronto, riflessiDrain);
  const combinedSpiritoCost = combinedGrade > 0 && combinedCostSource === "spirito" ? 1 : 0;
  const combinedFaticaCost = combinedGrade > 0 && combinedCostSource === "fatica" ? 1 : 0;
  let combinedRiflessiCost = combinedGrade > 0 && confronto && riflessiDrain ? 3 : 0;
  if (combinedRiflessiCost > 0 && hasRiflessiCostMinus1) {
    combinedRiflessiCost = Math.max(0, combinedRiflessiCost - 1);
  }
  const sfidaDeductions = computeResourceDeductions({
    costo,
    faticaValue: charState.fatica,
    spiritoValue: charState.spirito,
    riflessiValue: charState.riflessi,
    shortfallFatica,
    riflessiDrainAmount,
    valoreUsed: checkResult.valoreUsed,
    combinedSpiritoCost,
    combinedFaticaCost,
    combinedRiflessiCost,
    spiritoCancelPenalty: checkResult.spiritoCancelPenalty,
    famaSpend,
    famaValue: charState.fama
  });
  return {
    engineOutput,
    turnSuccesses,
    combinedRiflessiCost,
    shortfallFatica,
    accumulatedSuccesses: newAccumulated,
    turnsUsed: newTurnsUsed,
    riflessiDrainAmount,
    approachCheckMod,
    approachDefMod,
    valoreUsed: checkResult.valoreUsed,
    valoreName: checkResult.valoreName,
    valoreBonus: checkResult.valoreBonus,
    combinedGrade,
    basePenalty: checkResult.basePenalty,
    effectivePenalty: checkResult.effectivePenalty,
    spiritoCancelPenalty: checkResult.spiritoCancelPenalty,
    sfidaDeductions
  };
}

// node_modules/@federicomorando/sword-engine/src/use-cases/resolve-ars-oratoria-turn.mjs
function resolveArsOratoriaTurn(intent, oratoriaState, charState, diceRolled) {
  const {
    skillId,
    characteristicScore,
    diceCount,
    grade,
    extraDice = 0,
    focusDice = 0,
    combinedGrade = 0,
    combinedCostSource = "spirito",
    hasRetore = false,
    hasRiflessiCostMinus1 = false,
    giudiceBonus = 0,
    spiritoCancelPenalty: reqCancel = 0,
    spectatorBonus = 0
  } = intent;
  const {
    opponentFixedSuccesses,
    threshold
  } = oratoriaState;
  const basePenalty = computeBasePenalty(charState);
  const spiritoCancelPenalty = Math.min(reqCancel, basePenalty, charState.spirito);
  const effectivePenalty = basePenalty - spiritoCancelPenalty;
  const totalExtraDice = extraDice + focusDice;
  const effectiveGrade = grade + combinedGrade + spectatorBonus;
  const engineOutput = swordCheckResolve({
    characteristicScore,
    diceCount,
    grade: effectiveGrade,
    extraDice: totalExtraDice,
    successBonus: giudiceBonus,
    successPenalty: effectivePenalty,
    difficultyThreshold: null,
    opposedSuccesses: opponentFixedSuccesses,
    diceRolled,
    discardIndices: null
  });
  const playerSuccesses = engineOutput.finalSuccesses;
  let netSuccesses = engineOutput.netSuccesses || 0;
  const playerWins = netSuccesses > 0;
  const { netSuccesses: adjustedNet, riskRewardApplied } = applyRiskReward(netSuccesses, skillId);
  netSuccesses = adjustedNet;
  const newAccumulated = oratoriaState.accumulatedSuccesses + netSuccesses;
  const newAttemptsUsed = oratoriaState.attemptsUsed + 1;
  const { playerDrain, opponentDrain } = computeOratoriaDrain(netSuccesses, playerWins);
  const newOpponentRiflessi = oratoriaState.opponentRiflessi - opponentDrain;
  const patches = {};
  let currentRiflessi = charState.riflessi;
  let currentSpirito = charState.spirito;
  let currentFatica = charState.fatica;
  if (playerDrain > 0) {
    currentRiflessi = currentRiflessi - playerDrain;
    patches["resources.riflessi"] = Math.max(0, currentRiflessi);
  }
  if (combinedGrade > 0) {
    const combinedSpiritoCost = combinedCostSource === "spirito" ? 1 : 0;
    const combinedFaticaCost = combinedCostSource === "fatica" ? 1 : 0;
    let combinedRiflessiCost = hasRetore ? 0 : 3;
    if (combinedRiflessiCost > 0 && hasRiflessiCostMinus1) {
      combinedRiflessiCost = Math.max(0, combinedRiflessiCost - 1);
    }
    if (combinedSpiritoCost > 0) {
      currentSpirito = currentSpirito - combinedSpiritoCost;
      patches["resources.spirito"] = currentSpirito;
    }
    if (combinedFaticaCost > 0) {
      currentFatica = Math.max(0, currentFatica - combinedFaticaCost);
      patches["resources.fatica"] = currentFatica;
    }
    if (combinedRiflessiCost > 0) {
      currentRiflessi = currentRiflessi - combinedRiflessiCost;
      patches["resources.riflessi"] = Math.max(0, currentRiflessi);
    }
  }
  if (spiritoCancelPenalty > 0) {
    currentSpirito = currentSpirito - spiritoCancelPenalty;
    patches["resources.spirito"] = currentSpirito;
  }
  applySpiritoOverflow(patches, charState.fatica);
  const senzaParole = checkSenzaParole(currentRiflessi, newOpponentRiflessi);
  const outcome = computeArsOratoriaOutcome(newAccumulated, threshold);
  return {
    engineOutput,
    playerSuccesses,
    opponentSuccesses: opponentFixedSuccesses,
    netSuccesses,
    playerWins,
    riskRewardApplied,
    accumulatedSuccesses: newAccumulated,
    attemptsUsed: newAttemptsUsed,
    playerDrain,
    opponentDrain,
    newOpponentRiflessi,
    senzaParole,
    outcome: outcome.outcome,
    tier: outcome.tier,
    basePenalty,
    effectivePenalty,
    spiritoCancelPenalty,
    combinedGrade,
    spectatorBonus,
    giudiceBonus,
    patches
  };
}

// node_modules/@federicomorando/sword-engine/src/use-cases/resolve-contacts.mjs
function resolveContacts(intent, state, diceRolled) {
  const {
    characteristicScore,
    diceCount,
    grade,
    extraDice = 0,
    focusDice = 0,
    famaSpend = 0,
    mondanoBonus = 0,
    actorCeto,
    contactCeto,
    hasUrbanaCulture = false,
    regionDistance = 0,
    tradeRoute = false,
    settlementType,
    spiritoCancelPenalty = 0,
    conoscenzeBonus = 0,
    eruditaBonus = 0
  } = intent;
  const { cetoDistance, effectiveRegionDist, contactPenalty } = computeContactPenalty({
    actorCeto,
    contactCeto,
    hasUrbanaCulture,
    regionDistance,
    tradeRoute,
    settlementType
  });
  const successBonus = conoscenzeBonus + eruditaBonus;
  const checkResult = resolveCheck({
    characteristicScore,
    diceCount,
    grade,
    extraDice,
    focusDice,
    famaSpend,
    mondanoBonus,
    spiritoCancelPenalty,
    successBonus
  }, {
    fatiguePenalty: state.fatiguePenalty,
    woundPenalty: state.woundPenalty,
    armorPenalty: (state.armorPenalty || 0) + contactPenalty,
    encumbrancePenalty: state.encumbrancePenalty || 0,
    spirito: state.spirito,
    fama: state.fama,
    fatica: state.fatica,
    riflessi: state.riflessi
  }, diceRolled);
  const successesForDistribution = checkResult.engineOutput.basePassed ? checkResult.engineOutput.finalSuccesses : 0;
  return {
    engineOutput: checkResult.engineOutput,
    cetoDistance,
    effectiveRegionDist,
    contactPenalty,
    successBonus,
    successesForDistribution,
    valoreUsed: checkResult.valoreUsed,
    valoreBonus: checkResult.valoreBonus,
    basePenalty: checkResult.basePenalty,
    effectivePenalty: checkResult.effectivePenalty,
    spiritoCancelPenalty: checkResult.spiritoCancelPenalty,
    patches: checkResult.patches
  };
}

// node_modules/@federicomorando/sword-engine/src/use-cases/resolve-interlude.mjs
function resolveStudy(intent, state, diceRolled) {
  const {
    characteristicScore,
    diceCount,
    grade,
    extraDice = 0,
    focusDice = 0,
    hasStudy3pe = false,
    goldBonusSuccesses = 0
  } = intent;
  const checkResult = resolveCheck({
    characteristicScore,
    diceCount,
    grade,
    extraDice,
    focusDice,
    successBonus: goldBonusSuccesses,
    difficultyThreshold: 6
  }, {
    fatiguePenalty: state.fatiguePenalty,
    woundPenalty: state.woundPenalty,
    armorPenalty: state.armorPenalty || 0,
    encumbrancePenalty: state.encumbrancePenalty || 0,
    spirito: state.spirito,
    fama: state.fama || 0,
    fatica: state.fatica,
    riflessi: state.riflessi
  }, diceRolled);
  const passed = checkResult.engineOutput.difficultyPassed === true;
  const peGained = passed ? hasStudy3pe ? 3 : 2 : 0;
  return { checkResult, passed, peGained };
}
function resolveWork(intent, state, diceRolled, earningsRolls) {
  const {
    characteristicScore,
    diceCount,
    grade,
    extraDice = 0,
    focusDice = 0,
    ceto,
    doubleEarnings = false
  } = intent;
  const checkResult = resolveCheck({
    characteristicScore,
    diceCount,
    grade,
    extraDice,
    focusDice
  }, {
    fatiguePenalty: state.fatiguePenalty,
    woundPenalty: state.woundPenalty,
    armorPenalty: state.armorPenalty || 0,
    encumbrancePenalty: state.encumbrancePenalty || 0,
    spirito: state.spirito,
    fama: state.fama || 0,
    fatica: state.fatica,
    riflessi: state.riflessi
  }, diceRolled);
  const successes = checkResult.engineOutput.basePassed ? checkResult.engineOutput.finalSuccesses : 0;
  const earningsParams = computeWorkEarnings(ceto);
  const rollTotal = earningsRolls.reduce((sum, v) => sum + v, 0);
  const totalDenari = successes > 0 ? computeEarningsDenari(rollTotal, earningsParams.unit, doubleEarnings) : 0;
  return {
    checkResult,
    successes,
    earnings: earningsParams,
    rollTotal,
    totalDenari
  };
}
function resolveBond(influenza, costRollTotal, currentDenari) {
  const costParams = computeBondCost(influenza);
  const DENARI_PER2 = { denari: 1, soldi: 12, lire: 240 };
  const rate = DENARI_PER2[costParams.unit] ?? 1;
  const costDenari = costRollTotal * rate;
  return {
    costParams,
    costDenari,
    canAfford: currentDenari >= costDenari
  };
}
export {
  ADVANTAGES,
  APPROACH_MODS,
  ARMOR,
  ARMOR_PENALIZED_SKILLS,
  ARMOR_PREGI,
  ARMOR_PREGI_SKILL_MAP,
  BASE_SKILLS,
  CETO_FAMA,
  CETO_ORDER,
  CETO_SKILLS,
  CETO_VALUES,
  CREATURES,
  CREATURE_MISURA_MAP,
  CREATURE_TYPES,
  CULTURE_DEFS,
  CULTURE_IDS,
  CURRENCY,
  DAMAGE_TYPES,
  DISADVANTAGES,
  GEAR,
  GEAR_CATEGORIES,
  GRAPPLE_FREE_STRIKE_BONUS,
  MISURA_ORDER,
  MOUNTED_GALLOP_RANGED_PENALTY,
  ORATORIA_SKILLS,
  QUALITY_TIERS,
  REACTION_SKILL_MAP,
  RISK_REWARD_SKILLS,
  SETTLEMENT_MAX,
  SFIDA_PRESETS,
  SHIELDS,
  SIZE_CATEGORIES,
  SKILL_MAP,
  SOCIAL_SKILLS,
  TALENT_CATEGORIES,
  TALENT_DEFS,
  UDIENZA_RANKS,
  UDIENZA_SKILLS,
  UNARMED_STRIKES,
  VALORE_KEYS,
  WEAPONS,
  WEAPON_CATEGORIES,
  WEAPON_PREGI,
  WORK_EARNINGS,
  accompagnataTriggersDisarm,
  allSkillIds,
  applyContactTalentBonus,
  applyMinOneSuccess,
  applyRiskReward,
  applySpiritoOverflow,
  applyValoreBonus,
  armorSkillPenalty,
  characteristicMod,
  checkLoopTermination,
  checkSenzaParole,
  checkTalentUnlocked,
  collectTalentDerivedEffects,
  computeAccompagnataParryBonus,
  computeApproachModifiers,
  computeArsOratoriaOutcome,
  computeBasePenalty,
  computeBondCost,
  computeCavalcareThreshold,
  computeContactPenalty,
  computeCreationSkillState,
  computeCultureBonuses,
  computeDaCavalloArmorBonus,
  computeDaCavalloWeaponBonus,
  computeEarningsDenari,
  computeEncumbrance,
  computeFatigueLevel,
  computeFearOutcome,
  computeGrappleBonus,
  computeGrappleFollowUpBonus,
  computeLockBreakDifficulty,
  computeMaxContacts,
  computeMisuraPenalty,
  computeObstacleUncountered,
  computeOratoriaDrain,
  computePesanteRiflessiCost,
  computeProgressionSummary,
  computeRangePenalty,
  computeReactionRiflessiCost,
  computeResourceDeductions,
  computeRestConditionPenalty,
  computeRetaggioSlots,
  computeRiflessiDrain,
  computeSpecialMoveDifficulty,
  computeSpiritoBudget,
  computeSurprisePenalty,
  computeTalentChoiceExtraDice,
  computeTalentCombatBonus,
  computeTalentContextExtraDice,
  computeTalentEffectBonus,
  computeTalentTrackBonuses,
  computeTurnSuccesses,
  computeUnhorsedOutcome,
  computeWorkEarnings,
  computeWoundCapacities,
  computeWoundPenalty,
  costToDenari,
  countTalentProgress,
  denariToDisplay,
  deriveCharacter,
  distributeWounds,
  getCultureAllowedValori,
  initialEngagementMisura,
  isFuoriMisura,
  matchesTalentCombatContext,
  mestiereCost,
  misuraDistance,
  peGradeCost,
  qualityCost,
  resolveArsOratoriaTurn,
  resolveAttack,
  resolveBond,
  resolveCheck,
  resolveContacts,
  resolveDamage,
  resolveDefenseCheck,
  resolveDefenseOutcome,
  resolveFattucchiere,
  resolveMeditation,
  resolveReaction,
  resolveRest,
  resolveSfidaTurn,
  resolveStudy,
  resolveWork,
  swordCheckResolve,
  weaponQualityBonus
};
