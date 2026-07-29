/**
 * SwordCombat — Custom Combat document class for the SwORD system.
 *
 * Initiative is Riflessi-based (no dice roll). Turn order sorts by descending
 * Riflessi, with alphabetical tiebreaker. At each new round, combatants'
 * initiative re-reads their current Riflessi value.
 */
export class SwordCombat extends Combat {

  /**
   * Roll initiative for one or more combatants.
   * SwORD uses current Riflessi as initiative — no dice.
   * @param {string|string[]} ids - Combatant IDs
   * @param {object} [options={}]
   * @returns {Combat}
   */
  async rollInitiative(ids, options = {}) {
    if (!Array.isArray(ids)) ids = [ids];
    const updates = [];
    for (const id of ids) {
      const combatant = this.combatants.get(id);
      if (!combatant?.actor) continue;
      const riflessi = combatant.actor.system.resources?.riflessi?.value ?? 0;
      updates.push({ _id: id, initiative: riflessi });
    }
    if (updates.length) {
      await this.updateEmbeddedDocuments("Combatant", updates);
    }
    return this;
  }

  /**
   * Roll initiative for all combatants that haven't rolled yet.
   * @param {object} [options={}]
   * @returns {Combat}
   */
  async rollAll(options = {}) {
    const ids = this.combatants
      .filter(c => c.initiative === null)
      .map(c => c.id);
    return this.rollInitiative(ids, options);
  }

  /**
   * Roll initiative for NPC combatants only.
   * @param {object} [options={}]
   * @returns {Combat}
   */
  async rollNPC(options = {}) {
    const ids = this.combatants
      .filter(c => c.initiative === null && c.isNPC)
      .map(c => c.id);
    return this.rollInitiative(ids, options);
  }

  /**
   * Auto-populate initiative from Riflessi when combat begins.
   * rollAll() only touches combatants with initiative === null,
   * so any GM manual edits made before starting are preserved.
   * @override
   */
  async startCombat() {
    await this.rollAll();
    // Initialize creature Rango as bonus Riflessi reserve (PDF lines 5292-5293)
    for (const combatant of this.combatants) {
      const actor = combatant.actor;
      if (actor?.type === "creature" && actor.system.rango > 0) {
        await combatant.setFlag("sword", "rangoRemaining", actor.system.rango);
      }
    }
    // Initialize Condottiero success reserves
    for (const combatant of this.combatants) {
      const actor = combatant.actor;
      if (!actor || actor.type === "creature") continue;
      let reserve = 0;
      if (actor.system.talentSpecials?.has("success_reserve_adg")) {
        reserve += actor.system.skills.arte_della_guerra?.grade || 0;
      }
      if (actor.system.talentSpecials?.has("ambush_success_reserve")) {
        reserve += actor.system.skills.sopravvivenza?.grade || 0;
      }
      if (reserve > 0) {
        await combatant.setFlag("sword", "successReserve", reserve);
      }
      // Stratega: initialize distribute_riflessi pool = arte_della_guerra grade
      if (actor.system.talentSpecials?.has("distribute_riflessi")) {
        const adgGrade = actor.system.skills.arte_della_guerra?.grade || 0;
        if (adgGrade > 0) {
          await combatant.setFlag("sword", "strategaPool", adgGrade);
        }
      }
    }
    return super.startCombat();
  }

  /**
   * Auto-set initiative for combatants added mid-combat.
   * @override
   */
  _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    // GM client only: this fires on every connected client, and each one
    // would otherwise race to roll initiative for the new combatants.
    if (!game.users.activeGM?.isSelf) return;
    if (collection !== "combatants" || !this.started) return;
    const newIds = documents.filter(c => c.initiative === null).map(c => c.id);
    if (newIds.length) this.rollInitiative(newIds);
  }

  /**
   * Refresh all combatants' initiative from their current Riflessi.
   * Called at the start of each new round.
   */
  async refreshInitiative() {
    const updates = [];
    for (const combatant of this.combatants) {
      if (!combatant.actor) continue;
      const riflessi = combatant.actor.system.resources?.riflessi?.value ?? 0;
      if (combatant.initiative !== riflessi) {
        updates.push({ _id: combatant.id, initiative: riflessi });
      }
    }
    if (updates.length) {
      await this.updateEmbeddedDocuments("Combatant", updates);
    }
  }

  /**
   * Decrement reload counters on all combatants' ranged weapons.
   * Called at the start of each new round.
   */
  async decrementReloads() {
    for (const combatant of this.combatants) {
      if (!combatant?.actor) continue;
      for (const item of combatant.actor.items) {
        if (item.type === "weapon" && item.system.reloadTurnsRemaining > 0) {
          await item.update({ "system.reloadTurnsRemaining": item.system.reloadTurnsRemaining - 1 });
        }
      }
    }
  }

  /**
   * Reset action tracking flags for all combatants at the start of each round.
   * Replaces the old resetFreeShieldParries() — resets actionsUsed and freeActionUsed.
   */
  async resetRoundActions() {
    const updates = [];
    for (const combatant of this.combatants) {
      const needsReset =
        combatant.getFlag("sword", "actionsUsed") > 0 ||
        combatant.getFlag("sword", "freeActionUsed") ||
        combatant.getFlag("sword", "usedTempismoAction");
      if (needsReset) {
        updates.push({
          _id: combatant.id,
          "flags.sword.actionsUsed": 0,
          "flags.sword.freeActionUsed": false,
          "flags.sword.usedTempismoAction": false
        });
      }
    }
    if (updates.length) await this.updateEmbeddedDocuments("Combatant", updates);
  }

  /**
   * Resolve a combatant from a flexible reference.
   *
   * Combat state must distinguish multiple unlinked tokens of the same base
   * actor (synthetic token actors share the base actor's id), so resolution
   * is token-first:
   * - Combatant → itself
   * - Actor → its token's combatant for synthetic token actors, else by actorId
   * - string → tokenId match first (unique per token), then actorId (linked)
   *
   * @param {Combatant|Actor|string|null} ref
   * @returns {Combatant|undefined}
   */
  resolveCombatant(ref) {
    if (!ref) return undefined;
    if (typeof ref === "object") {
      if (ref.documentName === "Combatant") return ref;
      if (ref.documentName === "Actor") {
        if (ref.token) return this.combatants.find(c => c.tokenId === ref.token.id);
        return this.combatants.find(c => c.actorId === ref.id);
      }
      return undefined;
    }
    return this.combatants.find(c => c.tokenId === ref)
      ?? this.combatants.find(c => c.actorId === ref);
  }

  /**
   * Canonical per-combatant key used in engagement maps and grapple flags.
   * Token id when present (always, for token-based combatants), else actorId.
   * @param {Combatant|Actor|string|null} ref
   * @returns {string|null}
   */
  combatKey(ref) {
    const combatant = this.resolveCombatant(ref);
    return combatant ? (combatant.tokenId ?? combatant.actorId) : null;
  }

  /**
   * Get maximum standard actions per round for a combatant.
   * @returns {number} Max actions (1 by default; future: talent bonuses)
   */
  getMaxActions(ref) {
    return 1;
  }

  /**
   * Check if a combatant has a standard action available this round.
   * Returns true when the reference is not in this combat (unrestricted).
   * Also returns true if the actor has Tempismo and can spend 3 Riflessi.
   * @param {Combatant|Actor|string} ref
   * @returns {boolean}
   */
  hasActionAvailable(ref) {
    const combatant = this.resolveCombatant(ref);
    if (!combatant) return true;
    const used = combatant.getFlag("sword", "actionsUsed") ?? 0;
    if (used < this.getMaxActions(combatant)) return true;
    // Tempismo: extra action for 3 Riflessi (once per round)
    return this.hasTempismoActionAvailable(combatant);
  }

  /**
   * Check if a combatant can use Tempismo's extra action (3 Riflessi, once per round).
   * @param {Combatant|Actor|string} ref
   * @returns {boolean}
   */
  hasTempismoActionAvailable(ref) {
    const combatant = this.resolveCombatant(ref);
    if (!combatant?.actor) return false;
    const system = combatant.actor.system;
    if (!system.talentSpecials?.has("win_ties_riflessi_recovery_extra_action")) return false;
    if (combatant.getFlag("sword", "usedTempismoAction")) return false;
    return (system.resources?.riflessi?.value ?? 0) >= 3;
  }

  /**
   * Consume a standard action for a combatant this round.
   * If normal action is spent, uses Tempismo's extra action (3 Riflessi) if available.
   * @param {Combatant|Actor|string} ref
   * @returns {Promise<boolean>} True if action was consumed
   */
  async consumeAction(ref) {
    const combatant = this.resolveCombatant(ref);
    if (!combatant) return false;
    const used = combatant.getFlag("sword", "actionsUsed") ?? 0;
    if (used < this.getMaxActions(combatant)) {
      await combatant.setFlag("sword", "actionsUsed", used + 1);
      return true;
    }
    // Tempismo: spend 3 Riflessi for extra action
    if (this.hasTempismoActionAvailable(combatant)) {
      const actor = combatant.actor;
      let cost = 3;
      if (actor.system.talentSpecials?.has("riflessi_cost_minus1")) cost = Math.max(0, cost - 1);
      await actor.update({
        "system.resources.riflessi.value": actor.system.resources.riflessi.value - cost
      });
      await combatant.setFlag("sword", "usedTempismoAction", true);
      return true;
    }
    return false;
  }

  /**
   * Check if a combatant has the free action (secondary weapon) available this round.
   * Returns true when the reference is not in this combat.
   * @param {Combatant|Actor|string} ref
   * @returns {boolean}
   */
  hasFreeActionAvailable(ref) {
    const combatant = this.resolveCombatant(ref);
    if (!combatant) return true;
    return !combatant.getFlag("sword", "freeActionUsed");
  }

  /**
   * Consume the free action for a combatant this round.
   * @param {Combatant|Actor|string} ref
   * @returns {Promise<boolean>} True if free action was consumed
   */
  async consumeFreeAction(ref) {
    const combatant = this.resolveCombatant(ref);
    if (!combatant) return false;
    await combatant.setFlag("sword", "freeActionUsed", true);
    return true;
  }

  /**
   * Get the current engagement misura between two combatants.
   * @param {Combatant|Actor|string} refA
   * @param {Combatant|Actor|string} refB
   * @returns {string|null} Misura string or null if no engagement exists
   */
  getEngagementMisura(refA, refB) {
    const combatantA = this.resolveCombatant(refA);
    const keyB = this.combatKey(refB);
    if (!combatantA || !keyB) return null;
    const engagements = combatantA.getFlag("sword", "engagements") ?? {};
    return engagements[keyB] ?? null;
  }

  /**
   * Set the engagement misura between two combatants (symmetric).
   * @param {Combatant|Actor|string} refA
   * @param {Combatant|Actor|string} refB
   * @param {string} misura - Misura value ("LL","L","M","S","A")
   */
  async setEngagementMisura(refA, refB, misura) {
    const combatantA = this.resolveCombatant(refA);
    const combatantB = this.resolveCombatant(refB);
    const keyA = combatantA ? (combatantA.tokenId ?? combatantA.actorId) : null;
    const keyB = combatantB ? (combatantB.tokenId ?? combatantB.actorId) : null;
    if (combatantA && keyB) {
      const engA = combatantA.getFlag("sword", "engagements") ?? {};
      engA[keyB] = misura;
      await combatantA.setFlag("sword", "engagements", engA);
    }
    if (combatantB && keyA) {
      const engB = combatantB.getFlag("sword", "engagements") ?? {};
      engB[keyA] = misura;
      await combatantB.setFlag("sword", "engagements", engB);
    }
  }

  /**
   * Clear the engagement between two combatants (both directions).
   * @param {Combatant|Actor|string} refA
   * @param {Combatant|Actor|string} refB
   */
  async clearEngagement(refA, refB) {
    const combatantA = this.resolveCombatant(refA);
    const combatantB = this.resolveCombatant(refB);
    const keyA = combatantA ? (combatantA.tokenId ?? combatantA.actorId) : null;
    const keyB = combatantB ? (combatantB.tokenId ?? combatantB.actorId) : null;
    if (combatantA && keyB) {
      const engA = combatantA.getFlag("sword", "engagements") ?? {};
      if (keyB in engA) {
        delete engA[keyB];
        await combatantA.setFlag("sword", "engagements", engA);
      }
    }
    if (combatantB && keyA) {
      const engB = combatantB.getFlag("sword", "engagements") ?? {};
      if (keyA in engB) {
        delete engB[keyA];
        await combatantB.setFlag("sword", "engagements", engB);
      }
    }
  }

  /**
   * Get grapple lock state for a combatant.
   * @param {Combatant|Actor|string} ref
   * @returns {object|null} { role, opponentId } or null. opponentId is a
   *   canonical combat key resolvable via resolveCombatant().
   */
  getGrappleLock(ref) {
    const combatant = this.resolveCombatant(ref);
    if (!combatant) return null;
    const grappledBy = combatant.getFlag("sword", "grappledBy") ?? null;
    const grappling = combatant.getFlag("sword", "grappling") ?? null;
    if (grappledBy) return { role: "grappled", opponentId: grappledBy };
    if (grappling) return { role: "grappler", opponentId: grappling };
    return null;
  }

  /**
   * Set grapple lock between two combatants (symmetric).
   * @param {Combatant|Actor|string} grapplerRef - The combatant performing the grapple
   * @param {Combatant|Actor|string} grappledRef - The combatant being grappled
   */
  async setGrappleLock(grapplerRef, grappledRef) {
    const cGrappler = this.resolveCombatant(grapplerRef);
    const cGrappled = this.resolveCombatant(grappledRef);
    const keyGrappler = cGrappler ? (cGrappler.tokenId ?? cGrappler.actorId) : null;
    const keyGrappled = cGrappled ? (cGrappled.tokenId ?? cGrappled.actorId) : null;
    if (cGrappler && keyGrappled) await cGrappler.setFlag("sword", "grappling", keyGrappled);
    if (cGrappled && keyGrappler) await cGrappled.setFlag("sword", "grappledBy", keyGrappler);
  }

  /**
   * Clear grapple lock for a combatant (and their opponent).
   * @param {Combatant|Actor|string} ref
   */
  async clearGrappleLock(ref) {
    const combatant = this.resolveCombatant(ref);
    if (!combatant) return;
    const grappling = combatant.getFlag("sword", "grappling");
    const grappledBy = combatant.getFlag("sword", "grappledBy");
    // Clear own flags
    if (grappling) await combatant.unsetFlag("sword", "grappling");
    if (grappledBy) await combatant.unsetFlag("sword", "grappledBy");
    // Clear opponent's flags
    const opponentId = grappling || grappledBy;
    if (opponentId) {
      const opCombatant = this.resolveCombatant(opponentId);
      if (opCombatant) {
        if (opCombatant.getFlag("sword", "grappling")) await opCombatant.unsetFlag("sword", "grappling");
        if (opCombatant.getFlag("sword", "grappledBy")) await opCombatant.unsetFlag("sword", "grappledBy");
      }
    }
  }

  /**
   * Set mounted flag for a combatant.
   * @param {Combatant|Actor|string} ref
   */
  async setMounted(ref) {
    const combatant = this.resolveCombatant(ref);
    if (combatant) await combatant.setFlag("sword", "isMounted", true);
  }

  /**
   * Clear mounted flag for a combatant.
   * @param {Combatant|Actor|string} ref
   */
  async clearMounted(ref) {
    const combatant = this.resolveCombatant(ref);
    if (combatant) await combatant.unsetFlag("sword", "isMounted");
  }

  /**
   * Reset Stratega pool for all combatants with distribute_riflessi at round start.
   */
  async resetStrategaPool() {
    for (const combatant of this.combatants) {
      const actor = combatant.actor;
      if (!actor || actor.type === "creature") continue;
      if (!actor.system.talentSpecials?.has("distribute_riflessi")) continue;
      const adgGrade = actor.system.skills.arte_della_guerra?.grade || 0;
      if (adgGrade > 0) {
        await combatant.setFlag("sword", "strategaPool", adgGrade);
      }
    }
  }

  /** @override Sort descending by initiative; on ties, Tempismo talent wins; then alphabetically. */
  _sortCombatants(a, b) {
    const initA = Number.isFinite(a.initiative) ? a.initiative : -Infinity;
    const initB = Number.isFinite(b.initiative) ? b.initiative : -Infinity;
    if (initB !== initA) return initB - initA;
    // Tempismo: on tied Riflessi, combatant with talent acts first
    const tempismoA = a.actor?.system?.talentSpecials?.has("win_ties_riflessi_recovery_extra_action") ? 1 : 0;
    const tempismoB = b.actor?.system?.talentSpecials?.has("win_ties_riflessi_recovery_extra_action") ? 1 : 0;
    if (tempismoB !== tempismoA) return tempismoB - tempismoA;
    return (a.name || "").localeCompare(b.name || "");
  }
}
