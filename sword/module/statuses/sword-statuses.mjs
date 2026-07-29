/**
 * SwORD custom status effects for token overlays.
 *
 * 10 statuses replacing Foundry defaults:
 * - 3 wound levels (gravi/critiche/mortali) — auto-synced
 * - 2 fatigue levels (stanco/sfinito) — auto-synced
 * - 1 breathless (senza fiato) — auto-synced when riflessi < 0
 * - 1 bleeding (sanguinamento) — applied in defense flow, decremented per round
 * - 3 manual (svenuto/morto/paura) — GM toggles after reactions
 */

/**
 * Status effect definitions for CONFIG.statusEffects.
 * Each entry maps to a Foundry ActiveEffect with the given id/img/label.
 * _id must be exactly 16 alphanumeric chars (DocumentIdField).
 */
export const SWORD_STATUS_EFFECTS = [
  {
    id: "ferite-gravi",
    name: "SWORD.Status.FeriteGravi",
    img: "icons/svg/blood.svg",
    _id: "swordFeriteGravi"
  },
  {
    id: "ferite-critiche",
    name: "SWORD.Status.FeriteCritiche",
    img: "icons/svg/downgrade.svg",
    _id: "swordFeriteCrit0"
  },
  {
    id: "ferite-mortali",
    name: "SWORD.Status.FeriteMortali",
    img: "icons/svg/skull.svg",
    _id: "swordFeriteMort0"
  },
  {
    id: "stanco",
    name: "SWORD.Status.Stanco",
    img: "icons/svg/daze.svg",
    _id: "swordStanco00000"
  },
  {
    id: "sfinito",
    name: "SWORD.Status.Sfinito",
    img: "icons/svg/unconscious.svg",
    _id: "swordSfinito0000"
  },
  {
    id: "senza-fiato",
    name: "SWORD.Status.SenzaFiato",
    img: "icons/svg/falling.svg",
    _id: "swordSenzaFiato0"
  },
  {
    id: "sanguinamento",
    name: "SWORD.Status.Sanguinamento",
    img: "icons/svg/degen.svg",
    _id: "swordSanguinam00"
  },
  {
    id: "svenuto",
    name: "SWORD.Status.Svenuto",
    img: "icons/svg/sleep.svg",
    _id: "swordSvenuto0000"
  },
  {
    id: "morto",
    name: "SWORD.Status.Morto",
    img: "icons/svg/skull.svg",
    _id: "swordMorto000000"
  },
  {
    id: "paura",
    name: "SWORD.Status.Paura",
    img: "icons/svg/terror.svg",
    description: "SWORD.Status.PauraDesc",
    _id: "swordPaura000000"
  }
];

/**
 * IDs of statuses that are auto-synced from actor derived data.
 * Maps status ID → function(system) returning whether it should be active.
 */
const AUTO_SYNC_STATUSES = {
  "ferite-gravi": (system) => (system.woundLevels?.gravi ?? 0) > 0,
  "ferite-critiche": (system) => (system.woundLevels?.critiche ?? 0) > 0,
  "ferite-mortali": (system) => (system.woundLevels?.mortali ?? 0) > 0,
  "stanco": (system) => system.fatigueLevel === "stanco",
  "sfinito": (system) => system.fatigueLevel === "sfinito",
  "senza-fiato": (system) => (system.resources?.riflessi?.value ?? 1) < 0
};

/**
 * Synchronize auto-synced status effects on an actor's tokens.
 * Compares desired state (from derived data) with current ActiveEffects,
 * toggling only on mismatch to avoid unnecessary updates.
 *
 * @param {Actor} actor - The actor to sync statuses for
 */
export async function syncActorStatuses(actor) {
  // Only run for the actor's owner to prevent duplicate toggles across clients
  if (!actor.isOwner) return;

  for (const [statusId, predicate] of Object.entries(AUTO_SYNC_STATUSES)) {
    const shouldBeActive = predicate(actor.system);
    const isActive = actor.statuses.has(statusId);

    if (shouldBeActive !== isActive) {
      await actor.toggleStatusEffect(statusId, { active: shouldBeActive });
    }
  }
}
