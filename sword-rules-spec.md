# SwORD System — Complete Rules Specification

> **Il Tempo della Spada** (The Time of the Sword) — SwORD System v1.1
>
> Human-readable English specification. Machine-readable counterpart: `sword-engine-spec.json`.
> Original rulebook: *Il Tempo della Spada 1.0* (PDF, Italian).

---

## Status Legend

| Marker | Meaning |
|--------|---------|
| `[SPEC COMPLETE]` | Fully specified in `sword-engine-spec.json`, ready for code implementation |
| `[SPEC PARTIAL]` | Specified but with gaps or flagged ambiguities |
| `[TODO]` | Not yet formally specified — rules exist in PDF but await extraction |
| `[IMPLEMENTED]` | Working code exists in the Foundry VTT module |

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Characteristics](#2-characteristics)
3. [Skills](#3-skills)
4. [The Check (Le Prove)](#4-the-check-le-prove) — core mechanic
5. [Resources](#5-resources)
6. [Values (Valori)](#6-values-valori)
7. [Fame (Fama)](#7-fame-fama)
   7a. [Experience Points (Punti Esperienza)](#7a-experience-points-punti-esperienza)
   7b. [Talents (Talenti)](#7b-talents-talenti)
8. [Combat](#8-combat)
9. [Extended Tests (Sfide)](#9-extended-tests-sfide)
10. [Social Challenges (Ars Oratoria)](#10-social-challenges-ars-oratoria)
11. [Character Creation](#11-character-creation)
12. [Equipment and Encumbrance](#12-equipment-and-encumbrance)
13. [Contacts (Contatti)](#13-contacts-contatti)
14. [Resolved Conflicts](#14-resolved-conflicts)
15. [Open Ambiguities](#15-open-ambiguities)
16. [Bestiary (Bestiario)](#16-bestiary-bestiario)

---

## 1. System Overview

`[IMPLEMENTED]`

SwORD is a d6 dice-pool system built around a **cumulative roll-under** mechanic with **risk betting**. The player chooses how many dice to roll (more dice = more potential successes but higher chance of failure), then uses **skill grades** to reduce die values after rolling.

**Core loop:**
1. Player chooses how many d6 to roll (risk bet).
2. Roll the dice.
3. Discard dice granted by extra dice sources.
4. Spend grade points to reduce remaining die values toward 1.
5. Sum the final dice — if the sum is at or below the linked characteristic, base success is achieved.
6. Count dice showing 1 for additional successes.
7. Apply modifiers (bonuses and penalties) to final success count.

This is not a simple roll-under system. It is a **scalable risk-management engine** where the player controls the risk/reward tradeoff through dice count and skill grades provide mitigation.

---

## 2. Characteristics

`[IMPLEMENTED]`

Six primary characteristics define a character, scored from **5 to 13** (default 7):

| Latin Name | English | Description |
|-----------|---------|-------------|
| **Fortitudo** | Fortitude | Physical power, strength, constitution, health |
| **Celeritas** | Celerity | Speed, coordination, reflexes |
| **Gratia** | Grace | Charisma, charm, social presence |
| **Mens** | Mind | Intelligence, education, memory, reasoning |
| **Prudentia** | Prudence | Awareness, perception, caution |
| **Audacia** | Audacity | Courage, willpower, daring |

### Characteristic Modifier

A derived modifier is computed from each characteristic score:

| Score | Modifier |
|-------|----------|
| 5–6 | -1 |
| 7 | 0 |
| 8–9 | +1 |
| 10–11 | +2 |
| 12–13 | +3 |

**Formula:** `d > 0 ? ceil(d / 2) : floor(d / 2)`, where `d = score - 7`

*Errata correction: floor for scores ≤ 7, ceil for scores > 7. Previous `floor((score - 7) / 2)` gave wrong results for even scores above 7.*

Modifiers feed into derived stats (see Section 2.1).

### 2.1 Derived Stats

`[IMPLEMENTED]` — Riflessi, Ferite, Fatica, Spirito formulas computed in `prepareDerivedData()`, including retaggio bonuses (spiritoBonus, riflessiBonus). Movimento (default 5, reduced by encumbrance) and Ingombro (Fortitudo + gradi Forza, 4 categories with penalties) computed in `prepareDerivedData()`. Encumbrance penalty applied to all checks via all roll adapters.

| Stat | Formula | Description |
|------|---------|-------------|
| **Riflessi** (Reflexes) | Prudentia + mod(Celeritas) | Initiative order and action economy in combat |
| **Ferite** (Wounds) | Fortitudo + mod(Fortitudo) + grades(Forza) | Total wound capacity across 5 severity levels |
| **Fatica** (Fatigue) | Fortitudo + Audacia | Total fatigue capacity across 3 levels |
| **Spirito** (Spirit) | Audacia + mod(Audacia) + grades(Volonta) | Points for special actions |
| **Movimento** (Movement) | Default 5 | Movement rate (m/s or km/h) |
| **Ingombro** (Encumbrance) | Fortitudo + grades(Forza) | Carrying capacity base (multiplied by category) |

---

## 3. Skills

`[IMPLEMENTED]` — All 32 skills in data model with grade, isMestiere, hasFocus (auto-derived), extraDice. Mestiere skills highlighted in gold on character sheet. Cross-ceto skills shown in italic/dimmed on skills tab and character summary (visual indicator, not a gate — per rules, rolling is always allowed, and 0→1 transition transcends ceto).

Each skill has:
- A **grade** (0–6): training level. Grade 0 = untrained.
- A **linked characteristic**: determines the roll-under target.
- An optional **focus**: grants 1 extra die in applicable context.
- **Extra dice** from other sources (culture, items, talents).
- An **armor penalty** flag (marked skills suffer -1 success per protection point when wearing armor).

### 3.1 Skill List

| Skill | Characteristic | Armor Penalized |
|-------|---------------|-----------------|
| Agilita (Agility) | Celeritas | No |
| Alchimia (Alchemy) | Mens | No |
| Archi (Bows) | Celeritas | **Yes** |
| Armi comuni (Common weapons) | Fortitudo | No |
| Armi corte (Short weapons) | Celeritas | No |
| Armi da guerra (War weapons) | Fortitudo | No |
| Arte della guerra (Art of war) | Audacia | No |
| Arti arcane (Arcane arts) | Mens | No |
| Arti liberali (Liberal arts) | Mens | No |
| Artigiano (Artisan) | Varies | No | `[IMPLEMENTED]` Named specialty + characteristic stored on skill data, set in creation wizard, displayed on character sheet, used as roll default |
| Atletica (Athletics) | Fortitudo | **Yes** |
| Autorita (Authority) | Audacia | No |
| Balestre (Crossbows) | Prudentia | No |
| Carisma (Charisma) | Gratia | No |
| Cavalcare (Riding) | Audacia | No |
| Empatia (Empathy) | Prudentia | No |
| Forza (Strength) | Fortitudo | No |
| Furtivita (Stealth) | Celeritas | **Yes** |
| Guarigione (Healing) | Prudentia | No |
| Intrattenere (Entertain) | Gratia | No |
| Lotta (Wrestling) | Fortitudo | No |
| Manualita (Dexterity/Craft) | Celeritas | **Yes** |
| Mercatura (Commerce) | Gratia | No |
| Percezione (Perception) | Prudentia | No |
| Professione (Profession) | Varies | No | `[IMPLEMENTED]` Named specialty + characteristic stored on skill data, set in creation wizard, displayed on character sheet, used as roll default |
| Raggirare (Deceive) | Gratia | No |
| Ragionamento (Reasoning) | Mens | No |
| Sopravvivenza (Survival) | Prudentia | No |
| Storia e leggende (Lore) | Mens | No |
| Teologia (Theology) | Audacia | No |
| Usi e costumi (Customs) | Gratia | No |
| Volonta (Will) | Audacia | No |

### 3.2 Social Class Access

`[IMPLEMENTED]` — Cross-ceto skills visually indicated (italic/dimmed) on skills tab and character summary. No roll gate — per rules, any character can attempt any skill. PE advancement gate is advisory only (GM discretion).

Skills are grouped by social class (ceto). Characters can only **train** skills available to their class plus the common pool:

| Class | Available Skills |
|-------|-----------------|
| **Common** (all classes) | Agilita, Carisma, Forza, Percezione, Ragionamento, Volonta |
| **Umile** (Humble) | Armi corte, Empatia, Furtivita, Guarigione, Professione, Raggirare, Sopravvivenza |
| **Popolano** (Commoner) | Archi, Armi comuni, Artigiano, Atletica, Lotta, Manualita, Usi e costumi |
| **Borghese** (Bourgeois) | Alchimia, Arti liberali, Balestre, Intrattenere, Mercatura, Professione, Storia e leggende |
| **Nobile** (Noble) | Armi da guerra, Arte della guerra, Arti arcane, Autorita, Cavalcare, Professione, Teologia |

**Cross-ceto training rules** (PDF pp.42–65):
- During **character creation**, skills outside the character's ceto cost more mestiere points (distance-based scaling in creation wizard).
- **Learning a new skill** (grade 0 → 1) via PE **transcends ceto restrictions** ("a prescindere dal ceto"). Costs 10 PE and requires a teacher with grade 3+.
- **Advancing** an existing cross-ceto skill (grade 1+) is at GM discretion — the rules focus the restriction on creation-time training access, not on PE-based advancement.
- **Rolling** is never gated by ceto — any character can attempt any skill at any time, even at grade 0 (untrained, locked to 2 dice).

**Implementation:** `isOutsideCeto` derived flag computed per skill in `prepareDerivedData()` using `CETO_SKILLS` constant. A skill is "in ceto" if it appears in `CETO_SKILLS.common` or `CETO_SKILLS[character.ceto]`.

### 3.3 Languages (Lingue)

`[IMPLEMENTED]` — Language slots auto-computed in `prepareDerivedData()`. Character tab displays language tags with add/remove and slot counter.

**Rules** (PDF pp.61, 794–819, 869, 1128, 1196):

Every adventurer knows their **native language** (determined by culture/region of origin). Additional languages come from three sources:

**1. Mens modifier** (PDF p.61, line 869): For each point of the Mens modifier, if positive, the adventurer can speak one additional language beyond the native one.

**2. Usi e costumi** (PDF line 1196): At every **even grade** reached (2, 4, 6), the character learns one additional modern/vulgar language.

**3. Arti liberali — ancient languages** (PDF line 1128): At every **even grade** reached, the character learns one ancient language:
- Grade 2: Latin
- Grade 4: Ancient Greek
- Grade 6: Hebrew or Aramaic

**4. Meticcio culture trait** (PDF line 972): Grants knowledge of one additional language.

**Formula:**
```
languageSlots = 1 (native)
              + max(0, mod(Mens))
              + floor(usi_e_costumi.grade / 2)
              + floor(arti_liberali.grade / 2)
              + (has Meticcio trait ? 1 : 0)
```

**Available languages** in medieval Europe (PDF pp.799–819): Arabo, Castigliano, Catalano, Cimrico, Ebraico, Francese (Langue d'Oil), Frisone, Gaelico, Gallego, Greco, Inglese, Ladino, Latino (transnational elite language), Portoghese, Provenzale (Langue d'Oc), Scandinavo, Slavo, Tedesco, Turco, Volgare (Italian dialects).

**Language proficiency** (PDF line 797): Fluency and expressive capacity in known languages are typically the result of Arti liberali checks. Ragionamento or Arti liberali checks are required when disguising one's accent, communicating complex concepts in a foreign language, or improvising communication without a shared language.

---

## 4. The Check (Le Prove)

`[IMPLEMENTED]` — Full 9-step pipeline in `sword/module/engine/sword-check.mjs`. Roll dialog and chat card in `sword/module/rolls/sword-roll.mjs`.

This is the core resolution mechanic. Machine-readable definition: `sword-engine-spec.json → EngineCore`.

### 4.1 Parameters

| Parameter | Description |
|-----------|-------------|
| **C** | Characteristic score (the roll-under target) |
| **N** | Number of d6 chosen by the player (minimum 2) |
| **G** | Grade points available for die reduction |
| **E** | Extra dice (each grants one discard) |
| **Bonus** | Positive modifier to final successes |
| **Penalty** | Negative modifier to final successes |
| **D** | Difficulty threshold (if applicable) |
| **Opp** | Opponent's successes (if opposed) |

### 4.2 Resolution Pipeline

The check resolves in exactly this order:

**Step 1 — Validate Input**
- Dice count must be ≥ 2.
- Untrained characters (grade 0, no skill-sourced extra dice) are locked to exactly 2 dice.

**Step 2 — Roll Dice**
- Roll N + E dice (d6). The extra dice are rolled together with the main pool.

**Step 3 — Discard (Extra Dice)**
- Discarding is **optional, not mandatory**: the player may discard **up to** one die per extra die.
- If the total sum of all dice already fits the characteristic score, keeping all dice maximizes 1s (successes).
- Smart auto-discard strategy: keep all when sum fits; otherwise discard highest non-1 values first, stopping as soon as sum fits.
- Player may override with manual selection.
- If all dice are discarded, the pool is empty, sum = 0 (automatic base success).

**Step 4 — Grade Reduction**
- Spend grade points to reduce die values. Each point reduces one die by 1.
- A die **cannot be reduced below 1**.
- **Strategy: reduceLowestNonOneFirst** — always pick the die with the *minimum* value among dice still > 1. This maximizes the number of dice reaching 1 (see [Resolved Conflicts](#14-resolved-conflicts), CONFLICT-001).
- Stop when all grade points are spent or all dice are already 1.

**Step 5 — Compute Sum**
- Sum all remaining dice values after reduction.

**Step 6 — Determine Successes**
- **Roll-under gate:** If sum ≤ characteristic score → **base success** (1 success).
- If the gate passes, add **+1 success for each die showing 1** (natural or reduced via grades).
- **Fail gate:** If sum > characteristic, **zero successes** — even if dice show 1.

**Step 7 — Apply Modifiers**
- `finalSuccesses = rawSuccesses + bonus - penalty`
- Final successes **cannot go below 0** (floor at zero).

**Step 8 — Evaluate Difficulty**
- If a difficulty threshold D is set: pass if `finalSuccesses ≥ D`.

**Step 9 — Evaluate Opposed**
- If opposed: `netSuccesses = myFinalSuccesses - opponentFinalSuccesses`.

### 4.3 Difficulty Scale

Difficulty is a threshold of successes required:

| Threshold | Label (Italian) | Description |
|-----------|-----------------|-------------|
| 2 | Normale | Basic task |
| 3 | Imperativa | Requires effort |
| 4 | Difficile | Hard |
| 5 | Molto difficile | Very hard |
| 6 | Difficilissima | Extremely hard |
| 7+ | Praticamente impossibile | Near impossible |

### 4.4 Opposed Rolls (Confronti)

Both sides perform a full check. Net successes = A - B.
- Positive → A wins.
- Negative → B wins.
- Zero → tie (Master's discretion).

Many effects scale on net successes (e.g., combat damage).

### 4.5 Combined Maneuvers (Manovre Combinate)

`[IMPLEMENTED]`

A character may add the grades of a **correlated secondary skill** to the primary skill's effective grade for one check.

- **Cost:** 1 Spirito point (or 1 Fatica point as alternative payment).
- **Requirement:** Both skills must have grade ≥ 1.
- **In initiative:** Also costs 3 Riflessi (the action resolves at reduced initiative).
- **Restriction:** Cannot be used on Reactions (PDF p.85).

Implemented in sword-roll.mjs (skill checks) and sword-attack.mjs (attacks). Defense rolls excluded per reaction restriction.

### 4.6 Focus

`[IMPLEMENTED]` — Context-based focus system. Named foci stored in `skills.{id}.foci[]` array. `focusSlots` derived from grade thresholds (mestiere: 3+6, non-mestiere: 4 only). Roll dialogs show all character foci for selection; each checked focus = +1 extra die. Foci apply across skills (e.g. Alchimia "Erboristeria" focus applies to Sopravvivenza herb checks). Character sheet shows focus names as badges with +F button for empty slots.

A focus is a named specialization within a skill. When applicable to the context of any check (not just the source skill), it grants **1 extra die** (which means 1 additional discard). Multiple foci can apply to a single action. Non-mestiere skills earn 1 focus at grade 4; mestiere skills earn foci at grades 3 and 6. Cannot choose the same focus twice (except via specific talents).

### 4.7 Extra Dice Sources

`[IMPLEMENTED]` — Engine handles extra dice discard. All extra dice sources wired: skill-level extraDice, talent extraDice, Fama spending (social checks), focus dice. Gear quality bonus modifies characteristic score per §12.2 (skill tools + scadente weapons).

Extra dice come from multiple sources, each granting 1 discard per die:
- Focus (1 die, if context applies)
- Fama points (social checks, see Section 7)
- Special abilities
- Items / equipment
- Talents

Extra dice do not generate successes directly — they only allow discarding rolled dice.

### 4.8 Modifiers

`[IMPLEMENTED]`

Modifiers apply to **final successes**, not to dice or the roll itself.

Sources of modifiers:
- Wound penalties (see Section 5.2)
- Fatigue penalties (see Section 5.3)
- Environmental circumstances
- Items / equipment
- Fama
- Combined maneuvers
- Special abilities
- Armor penalties on specific skills

Typical range: bonus +1 to +3, penalty -1 to -6.

### 4.9 Edge Cases

`[IMPLEMENTED]` — All 8 edge cases handled by engine; 8/8 test cases pass.

| Edge Case | Behavior |
|-----------|----------|
| All dice discarded | Sum = 0, auto base success (1 success before modifiers) |
| Negative successes | Clamped to 0 |
| Untrained check | Locked to exactly 2 dice |
| Combined maneuver | Effective grade = base + correlated, costs 1 Spirito |
| All dice already 1 | Grade reduction stops, leftover grades unused |
| Grades exceed reducible total | All dice become 1, remaining grades unused |
| Valore activation | Only if basePassed, costs 3 Spirito (see [Ambiguity AMB-002](#15-open-ambiguities)) |
| Spirito penalty cancellation | Each Spirito cancels 1 penalty point, applied before engine |

### 4.10 Verified Test Cases

8 test cases with full traces in `sword-engine-spec.json → EngineCore.testCases`:

| # | Name | Input | Expected |
|---|------|-------|----------|
| 1 | John example | char=10, dice=[6,5], grade=4 | 2 successes |
| 2 | Risk 3 dice | char=10, dice=[3,2,2], grade=4 | 4 successes |
| 3 | Fail gate | char=5, dice=[1,6], grade=0 | 0 successes |
| 4 | All discarded | char=7, dice=[4,3], extra=2 | 1 success |
| 5 | Clamp to zero | char=8, dice=[3,4], penalty=3 | 0 successes |
| 6 | Difficulty pass | char=10, dice=[2,1,3], grade=2, diff=3 | 3 successes, pass |
| 7 | Opposed | char=9, dice=[2,3], grade=3, opp=2 | net=1 |
| 8 | Excess grades | char=8, dice=[2,2], grade=10 | 3 successes, 8 grades unused |

---

## 5. Resources

### 5.1 Spirito (Spirit)

`[IMPLEMENTED]` — Max formula computed in `prepareDerivedData()`. Spending via roll dialogs (valore activation, penalty cancellation, combined maneuvers). Manual +/- adjustment buttons on character tab.

- **Max:** Audacia + mod(Audacia) + grades(Volonta)
- **Recovery:** 1 + mod(Audacia) per rest period.
- **Uses:**
  - 1 point: Activate a combined maneuver.
  - 3 points: Activate a Valore (see Section 6).
  - 1 point per penalty: Cancel wound/fatigue success penalties.

**Spirito overflow (PDF line 1593):** When a character at 0 Spirito loses additional Spirito, the excess converts to **Fatica** losses.

### 5.2 Ferite (Wounds)

`[IMPLEMENTED]` — Max formula computed. Wound levels in wound track with active-level highlighting. Wound penalty badge on character tab. +/- adjustment buttons on ferite resource.

- **Max:** Fortitudo + mod(Fortitudo) + grades(Forza)
- Distributed across 5 severity levels:

| Level | Italian | Penalty to Successes |
|-------|---------|---------------------|
| 1 | Graffi (Scratches) | 0 |
| 2 | Leggere (Light) | 0 |
| 3 | Gravi (Serious) | -1 |
| 4 | Critiche (Critical) | -2 |
| 5 | Mortali (Mortal) | -3 |

When a character takes wounds, they fill from the lowest level upward. The penalty corresponds to the **highest filled level**.

**Wound level capacity formula:** Each level gets `floor(feriteMax / 5)` slots. The remainder is distributed bottom-up (graffi first, then leggere, etc.).

> *Example: feriteMax = 12 → base = floor(12/5) = 2, remainder = 2. Graffi: 3, Leggere: 3, Gravi: 2, Critiche: 2, Mortali: 2. Total = 12.*

> *Example: feriteMax = 7 → base = 1, remainder = 2. Graffi: 2, Leggere: 2, Gravi: 1, Critiche: 1, Mortali: 1. Total = 7.*

**Wound penalties also apply to Movimento** (PDF line 1536), reducing effective movement in addition to success penalties. At Critiche and Mortali levels, the character must make a **Forza Reaction** against the threat: at Critiche, falling unconscious on failure; at Mortali, dying on failure. This Reaction must be **repeated every time a further wound is taken** while at that level, not just on first entry.

### 5.3 Fatica (Fatigue)

`[IMPLEMENTED]` — Max formula computed. Always-visible fatigue level badge (fresco/stanco/sfinito) with color coding on character tab. +/- adjustment buttons on fatica resource.

- **Max:** Fortitudo + Audacia
- Distributed across 3 levels:

| Level | Italian | Threshold | Penalty |
|-------|---------|-----------|---------|
| 1 | Fresco (Fresh) | Above 2/3 max | 0 |
| 2 | Stanco (Tired) | Between 1/3 and 2/3 max | -1 |
| 3 | Sfinito (Exhausted) | Below 1/3 max | -2 |

**Fatigue sources:**
- **Sleep deprivation:** lose **3** Fatica per sleepless night (+3 cumulative per consecutive night). **Hunger:** 1 Fatica per missed meal (+1 per fasting day). **Thirst:** 2 Fatica per day without water (+2 cumulative), doubled in hot/arid climates.
- Physical exertion: Rifiatare (catching breath) costs 1 Fatica.

**Recovery (Rest):** `[IMPLEMENTED]` *Errata line 1600.* After a rest period, characters make a **Forza skill check** with condition modifiers:
- Outdoor: -1
- No bedding: -2
- Cold food: -1
- Cold weather: -1 to -3
- Armor worn: -protezione value
- Short/no sleep: -1 to -3

On success: each success recovers **+1 Fatica** and **heals 1 wound** (from highest level down). On failure: no recovery. Lose **1 Fatica per uncontested success** (i.e. the amount by which the check fails against the difficulty threshold). Spirito always recovers **1 + max(0, mod(Audacia))** regardless of roll outcome.

### 5.4 Active Healing (Guarigione Check)

`[TODO]` — PDF lines 1625-1637. Not yet specified in detail.

**Guarigione skill check**: Heals **1 wound per success**. Takes 15 minutes per wound healed. Penalized by patient's wound level (-1 Gravi, -2 Critiche, -3 Mortali). Requires bandages (without: -2 penalty; improvised: -1). For Gravi+ wounds, also requires surgical tools (without: additional -2). **Failure causes 1 extra wound.** Cannot heal same subject more than once per day.

**Stabilization** (sfida): Difficulty/threshold scales by wound level: Graffi/Leggere = 1/2, Gravi = 2/3, Critiche = 3/4, Mortali = 4/5. Each attempt = 1 combat turn. Requires bandages.

### 5.5 Riflessi (Reflexes / Action Economy)

`[IMPLEMENTED]` — Formula and basic rules specified. Action economy fully coded in Phase 5 (1 action + 1 free per round, pesante Riflessi cost, GM override).

- **Max:** Prudentia + mod(Celeritas) + retaggio riflessiBonus
- Used during initiative to track available actions.
- **Costs:**
  - Combined maneuver: 3 Riflessi
  - Reactions: Riflessi = successes of the incoming threat
  - Rifiatare (catch breath): recovers max(1, grades(Atletica)) Riflessi, costs 1 Fatica
  - Attesa (wait): skip turn, recover all Riflessi at start of next turn, no cost
- When Riflessi < 0, the character is senza fiato (cannot act or defend).

---

## 6. Values (Valori)

`[IMPLEMENTED]`

Medieval values that shape character motivations. Organized as 3 opposing axes:

| Axis | Positive | Negative |
|------|----------|----------|
| Faith | **Fides** (Faith) | **Impietas** (Impiety) |
| Honor | **Honor** (Honor) | **Ego** (Ego) |
| Superstition | **Superstitio** (Superstition) | **Ratio** (Reason) |

**Rules:**
- Only one value per axis can be active (e.g., cannot have both Fides and Impietas).
- Score range: 0–3 per value.
- Maximum total Valore points during chronicle: 3 + mod(Audacia).
- At creation: max(0, mod(Audacia)) points, constrained to culture-allowed axes (errata correction).

**Activation:** After rolling a check and passing the roll-under gate, the player may spend **3 Spirito** to add the relevant Valore score as a success bonus. If the roll-under fails, the Valore cannot be activated.

**Activation contexts per Valore** (PDF lines 1725-1731):
- **Fides**: helping others, defending religion, opposing fey/demons
- **Honor**: protecting family/ceto honor, defending social order
- **Superstitio**: any **Reaction** (unique mechanical advantage); other checks only with relic/amulet present
- **Impietas**: harming others for personal gain
- **Ego**: asserting self against established order
- **Ratio**: gaining knowledge, investigating, resisting mind-clouding effects

Only **one** Valore can be activated per check (PDF line 1723).

---

## 7. Fame (Fama)

`[IMPLEMENTED]`

- **Score:** 0–6, representing renown in the character's home region.
- **Mechanic:** In social checks, the player may spend Fama points. Each point spent grants **1 extra die** (and therefore 1 discard).
- Also influences Contacts (familiarity, influence) — see Section 13.

**Fama spending costs** (PDF lines 1763-1778):
- **Monetary cost** per Fama point spent, scaled by interlocutor's ceto: Denaro/point (Umile), Soldo/point (Popolano), 12 Soldi/point (Borghese), Lira/point (Nobile).
- **Preparation time**: 1 point = 1 minute, 2 points = half day, 3 points = 1 day, 4+ points = 1 day per point. This makes Fama unusable mid-combat.

**Regional scope** (PDF lines 1746-1754): Fama 0 = village, 1 = borough, ..., 6 = Europe. Outside home region, effective Fama reduced by -1 to -3 at GM discretion. Fama enables NPC **recognition**: Usi e costumi check with Fama as bonus reveals ceto/origin/identity at increasing thresholds.

**Losing Fama** (PDF line 1801): 1st month without paying cost of living = temporary -1 Fama. 2nd month = permanent -1. Pattern repeats.

### 7a. Experience Points (Punti Esperienza)

`[IMPLEMENTED]` — PE tracking in actor data model, auto-computation of spent/available in `prepareDerivedData()`, PE section on character sheet.

PE (Punti Esperienza) are earned each session and spent to improve skill grades.

#### Earning PE (per session)

- 1 PE for attending the session
- 1 PE for demonstrating learning about the world
- 1 PE for interpreting Valori and Tentazioni
- 1 PE (table vote) for the player who struggled most with Valori
- 1 PE (table vote) for the most important Audacia-linked skill test
- 1 PE freely assigned by the players to one adventurer
- Optional 1 PE from Master for adventure/arc conclusion
- Typical range: 3–6 PE per session

#### Spending PE — Grade Increase

Cost to increase a skill grade = `2 × target_grade` (the grade you're increasing TO). Must go sequentially (cannot skip grades). Max grade: 6.

| From → To | Cost | Cumulative from 1 |
|-----------|:----:|:-----------------:|
| 1 → 2    | 4    | 4                 |
| 2 → 3    | 6    | 10                |
| 3 → 4    | 8    | 18                |
| 4 → 5    | 10   | 28                |
| 5 → 6    | 12   | 40                |

#### Learning a New Skill (0 → 1)

Cost: **10 PE**. Requires a teacher (anyone with grade ≥ 3 in that skill). Transcends ceto restrictions ("a prescindere dal ceto"). Requires narrative justification (at least one interlude, PDF p.168).

#### Focus

Non-mestiere skills earn 1 focus at grade 4. Mestiere skills earn foci at grade 3 and grade 6. Each focus is a named specialization that grants +1 extra die when applicable to the action — regardless of which skill is being rolled. Cannot choose the same focus twice (except via specific talents).

**Source:** PDF p.138, Errata §7.1 (lines 3483-3485).

### 7b. Talents (Talenti)

`[IMPLEMENTED — Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 (partial)]` — Talent definitions, auto-unlock detection, character sheet display, creation wizard preview (Phase 1). Characteristic bonuses now follow the progression rule (first unlocked talent at grade 3/4/5/6 per category grants +1 to the related characteristic) with full cascading to modifiers, resource maximums, and valori (Phase 2). Extra dice on skills, resource max bonuses, and Spirito formula modifications from talents (Phase 3). Passive combat effects: damageMod/parryMod/protectionMod and successBonus context matching are wired into attack/defense pipeline (Phase 4/5 partial). Remaining `flag` and most `special` effects are still deferred.

**Source:** PDF pp.139–148, Section 7.2.

#### Overview

Talents are special abilities that **auto-unlock** when a character meets all skill grade prerequisites. They are never purchased or selected — they emerge automatically from skill advancement. There are **72 talents** organized into 6 categories (12 per characteristic), each linked to the characteristic's base skill.

#### Prerequisite Types

Each talent has a list of requirements. Three types exist:

| Type | Format | Meaning |
|------|--------|---------|
| **Simple** | `{ skill, grade }` | Skill must be at or above the specified grade |
| **OR** | `{ type: "or", options: [{skill, grade}, ...] }` | At least one option must be met |
| **CHOICE_ANY** | `{ type: "choice_any", options: [...], count: N }` | At least N options must be met |

**No circular dependency**: Talent prerequisites only check skill grades, never characteristics. Characteristic bonuses from talents (Phase 2) cannot affect other talent unlock conditions.

#### Computation

Talents are purely derived data — not stored in the actor schema. They recompute automatically in `prepareDerivedData()` whenever skill grades change. The full computation pipeline:

```
Step 1:  PE spent + hasFocus (skill-only computation)
Step 2:  Talent unlock detection (only checks skill grades — no circular dependency)
Step 3:  charBonus accumulation from unlocked talents
Step 3b: extraDice + resourceBonus + spiritFormula accumulation from unlocked talents
Step 4:  Effective characteristics = base + talent charBonuses
Step 5:  Modifiers from effective characteristics: mod = d > 0 ? ceil(d/2) : floor(d/2), d = effective - 7
Step 6:  Resource maximums from effective characteristics + modifiers + talent bonuses
Step 7:  Valori totals from effective modifiers
```

Steps 2–4 are the critical ordering: talents are detected from skills (Step 2), then their charBonus effects are accumulated (Step 3), then effective characteristics are computed (Step 4). Step 3b accumulates unconditional extraDice (added directly to skill data), resourceBonus values, and spiritFormula effects. Step 6 uses all accumulated talent bonuses when computing resource maximums. All downstream computations (modifiers, resource maximums, valori) use `effectiveCharacteristics`, not raw base values.

#### Effect Categories (Phased Implementation)

Effects are categorized for phased implementation. All phases (1–5d) are implemented.

| Phase | Type | Description | Example | Status |
|-------|------|-------------|---------|--------|
| **2** | `charBonus` | Category progression bonus (+1 at first unlocked 3/4/5/6 per track) | Audacia track tier progression | **IMPLEMENTED** |
| **3** | `extraDice` | Extra dice on specific skills (unconditional only) | Grazia felina: +1 die Agilità | **IMPLEMENTED** |
| **3** | `resourceBonus` | Permanent bonus to a resource max | Grazia felina: +1 Riflessi | **IMPLEMENTED** |
| **3** | `spiritFormula` | Modify Spirito max formula | Illuminazione: +Mens score to Spirito | **IMPLEMENTED** |
| **4** | `damageMod` | Bonus to damage | Macchina da guerra: +1 melee damage | **IMPLEMENTED** |
| **4** | `parryMod` | Bonus to parry values | Duellante: +1 parry with short weapons | **IMPLEMENTED** |
| **4** | `protectionMod` | Bonus to protection | Macchina da guerra: Protection 1 unarmored | **IMPLEMENTED** |
| **5** | `successBonus` | Conditional success bonuses | Bassifondi: +1 success Furtività urban | **IMPLEMENTED** (wired contexts) |
| **5** | `flag` | Passive narrative effects | Affarista: focus in borghese social | **IMPLEMENTED** |
| **5** | `special` | Active/contextual abilities | Condottiero: distribute success reserve | **IMPLEMENTED** |

#### Spirito Formula Talents (Important Distinction)

Two talents modify Spirito max with different formulas:

- **Illuminazione** (Audacia, grade 5): adds Mens **score** (punteggio, 5–13) to Spirito max
- **Meditazione** (Mens, grade 3): adds Mens **modifier** + Prudentia **modifier** to Spirito max

The Italian "punteggio" = raw score, "bonus" = modifier. These produce very different magnitudes.

#### Characteristic Bonuses from Talents (p.139)

When a talent grants +1 to a characteristic, cascading effects occur on derived stats:

| Characteristic | Cascade Effects |
|---------------|-----------------|
| Audacia ↑ | Spirito max ↑, Fatica max ↑, mod(Audacia) may change → Valori max |
| Celeritas ↑ | mod(Celeritas) may change → Riflessi max |
| Fortitudo ↑ | Ferite max ↑, Fatica max ↑, mod(Fortitudo) may change → Ferite max |
| Gratia ↑ | mod(Gratia) may change → grants new retaggio event |
| Mens ↑ | mod(Mens) may change → grants new language |
| Prudentia ↑ | Riflessi max ↑ |

**Talents granting +1 to each characteristic:**

| Characteristic | Talents |
|---------------|---------|
| Audacia | Alfiere (4), Araldo (5), Mente del guerriero (4), Maestà (6) |
| Celeritas | Senso del pericolo (4), Macchina da guerra (6), Armonioso (5) |
| Fortitudo | Vitalità (4), Maestro di lotta (5), Bestia da soma (5) |
| Gratia | Seduttore (4), Volitivo (6), Giudice (6) |
| Mens | Vagabondo (4), Intuito (5), Custode del sapere (6) |
| Prudentia | Fulmine di guerra (6), Colpo d'occhio (5), Cercatore (4) |

#### Talent Catalog (72 talents across 6 categories)

**Audacia/Volontà (12):** Bassifondi(3), Diligente(3), Lottatore(3), Stratega(3), Alfiere(4), Fiore della cavalleria(4), Lotta in arme(4), Vitalità(4), Araldo(5), Condottiero(5), Illuminazione(5), Volitivo(6)

**Celeritas/Agilità (12):** Combattimento con due armi(3), Equitazione(3), Grazia felina(3), Lingua Sciolta(3), Senso del pericolo(4), Sicario(4), Stile a due armi(4), Tempismo(4), Maestro di lotta(5), Maestro di scudo(5), Ombra(5), Fulmine di guerra(6)

**Fortitudo/Forza (12):** Giostrare(3), Incoccare(3), Minaccioso(3), Sbracciata(3), Carovaniere(4), Fanteria(4), Mente del guerriero(4), Mitridatismo(4), Bestia da soma(5), Duellante(5), Maestro d'arma(5), Macchina da guerra(6)

**Gratia/Carisma (12):** Affarista(3), Cortesia(3), Fattucchiere(3), Trovatore(3), Compagni fedeli(4), Retore(4), Seduttore(4), Senza volto(4), Intuito(5), Ispirare(5), Rete di contatti(5), Maestà(6)

**Mens/Ragionamento (12):** Determinazione(3), Ingegno(3), Medico da campo(3), Meditazione(3), Giuramento di Ippocrate(4), Mondano(4), Vagabondo(4), Vita di strada(4), Chiave della mappa(5), Colpo d'occhio(5), Eponimo(5), Custode del sapere(6)

**Prudentia/Percezione (12):** Arrocco(3), Avanguardia(3), Battipista(3), Scienza antica(3), Aggiustare il tiro(4), Bruciapelo(4), Cercatore(4), Tattiche di Guerriglia(4), Armonioso(5), Cecchino(5), Occhio di falco(5), Giudice(6)

#### OCR Data Quality Fixes (6 structural issues)

The canonical JSON (`docs/sword_talents_canonical_clean.json`) has OCR artifacts. All were fixed in the code (`sword/module/data/talents.mjs`), not in the source JSON:

1. **Diligente** (Audacia 3): `"Ar- tigiano"` → `artigiano`
2. **Ingegno** (Mens 3): `"Artigia- no"` → `artigiano`
3. **Minaccioso** (Fortitudo 3): `requirements_raw` merged with `effects_raw`, parsed entries have null grades. Correct: forza 3, atletica 3, autorita 3, lotta 3. Effect: "+1 dado extra in Autorità per intimorire."
4. **Fulmine di guerra** (Celeritas 6): Complex requirement not parsed (null grades). Correct: agilita 6 + choice_any([armi_comuni, armi_corte, armi_da_guerra, lotta], count=2, grade=6)
5. **Meditazione** (Mens 3): `"Arti arcane op- pure Empatia"` parsed as single entry. Correct: or(arti_arcane 3, empatia 3)
6. **Arrocco** (Prudentia 3): `"una qualsiasi abilità d'arma"` parsed as literal string. Correct: choice_any([archi, balestre, armi_corte, armi_comuni, armi_da_guerra, lotta], count=1, grade=3)

#### UI Presentation

**Character Sheet:**
- Talents section appears after the skills list, grouped by characteristic
- Unlocked talents: full opacity, name + info icon (hover tooltip shows `effectsRaw`)
- Locked talents: dimmed (opacity 0.4), name + lock icon (hover tooltip shows requirement summary)
- Grade badge: colored circle (3=green, 4=blue, 5=purple, 6=gold)
- Header shows total unlocked count
- Characteristics display: base score (editable input) + green bonus badge `+N` when talent charBonus active + modifier (computed from effective characteristic). The modifier reflects the effective value (base + bonus), so players see the cascading effect immediately.
- Skill rows show the effective characteristic score (base + bonus), not the raw base

**Creation Wizard (Step 4 — Skills):**
- Preview panel at bottom showing talents that would unlock with current skill selections
- Talent names displayed as colored chips (grade-based coloring)
- Updates live as user modifies skill grade selections
- Note: At creation time, max skill grade is 3, and no charBonus talents exist below grade 4, so the wizard does not need to simulate charBonus cascading

---

## 8. Combat

`[IMPLEMENTED]` — Fully specified from PDF pp.85–110.

Three combat modes exist: **Mischia** (melee), **Combattimento a distanza** (ranged), and **Abrazzar** (grappling/unarmed). All use the standard check mechanic; combat-specific rules layer on top of it.

### 8.1 Initiative (Iniziativa)

`[IMPLEMENTED]` — PDF p.90.

- Turn-based. Each **turno** (turn) ≈ 5 seconds in combat.
- Characters act in **descending Riflessi order** (highest first).
- Each character gets **1 action + free movement** per turn.
- At the start of each new turn, Riflessi carry over from the previous turn's ending value.
- **Riflessi changes affect initiative order in real time** during the round: combined maneuvers, defenses, reactions, and other Riflessi costs immediately update the turn order. *Errata line 2128: "Manovre combinate, azioni addizionali date dai talenti, difese e Reazioni andranno a modificare i Riflessi e quindi l'ordine di iniziativa."* Implemented via `updateActor` hook in main.mjs.
- Characters at Riflessi < 0 are **senza fiato** (out of breath): they cannot act, cannot defend in combat, and cannot perform Agilità reactions. Other (non-Agilità) reactions are allowed with **+1 penalty** and **no Riflessi cost**. At the start of the next turn, they must perform a forced attesa. *Errata line 2141.*

**Rifiatare (Catch Breath):** `[IMPLEMENTED]` At the start of any turn, a character may spend **1 Fatica** to recover Riflessi equal to **max(1, grades(Atletica))**, up to their maximum. Creatures recover max(1, Forza). *Errata line 2133: "1 oppure i loro gradi di Atletica" = whichever is higher.* Implemented via sword-rifiatare.mjs, button on character + creature sheets.

**Attesa (Wait):** `[IMPLEMENTED]` A character may skip their entire turn (no actions) by declaring Attesa. At the start of the next turn, they recover ALL Riflessi to maximum. No Fatica cost. Attesa can be interrupted at any moment (e.g. by performing a reaction, attacking, or defending); in that case, no Riflessi are recovered. *Errata line 2135-2138.* Implemented via sword-attesa.mjs (declaration), sword-reaction.mjs + sword-attack.mjs + sword-defense.mjs (interruption on any action), button on character + creature sheets.

**Combined maneuvers** in initiative cost **3 Riflessi** in addition to the 1 Spirito cost. The action resolves at the character's current Riflessi minus 3.

> *Example: Marco (Riflessi 9) declares a combined maneuver at initiative 9. He spends 3 Riflessi, and the blow resolves at initiative 6.*

### 8.2 Turns and Actions (Turni e Azioni)

`[IMPLEMENTED]` — PDF p.100.

Each turn, a combatant may **move** and perform **one action**.

**Movement:** Move up to Movimento stat in meters. Alternatively, movement can be used for: dropping prone, turning, picking up an object, drawing/sheathing a weapon, nocking an arrow, reloading a crossbow.

**Free actions** (no action cost): brief speech, shout, pass a small object, draw a secondary weapon, turn around. Characters *senza fiato* cannot perform even free actions.

**Opportunity actions (Azioni d'opportunita):** A character may delay their action and set a trigger condition. The action resolves at the Riflessi value when the condition occurs. If the condition never occurs, the action is lost. Declaring an opportunity action does not change the character's Riflessi.

**Extended actions (Azioni prolungate):** Actions requiring more than 5 seconds span multiple turns.

#### 8.2.1 Combat Action Riflessi Costs

| Action | Riflessi Cost | Other Cost | Notes |
|--------|:------------:|:----------:|-------|
| Standard attack | 0 | 1 action | Character's one action per turn |
| Parata (Parry) | attacker's successes | 1 action | First shield parry per turn is free |
| Schivata (Dodge) | attacker's successes | — | No action cost |
| Combined maneuver | 3 | 1 spirito | Action resolves at current Riflessi - 3 |
| Rifiatare | 0 | 1 fatica | Recovers max(1, grades(atletica)) Riflessi (start of turn) |
| Attesa (Wait) | 0 | — | Skip turn, recover all Riflessi next turn |

### 8.3 Movement and Approach

`[IMPLEMENTED]` — PDF p.91. Approach dropdown (Prudente/Corsa/Carica) in attack + defense dialogs, modifiers applied to successBonus/Penalty.

When moving in tactical situations, the character chooses an **approach**:

| Approach | Italian | Check Modifier | Reaction/Defense Modifier |
|----------|---------|:--------------:|:------------------------:|
| Cautious | Prudente | -1 | +1 |
| Running | Corsa | 0 | 0 |
| Charge | Carica | +1 | -1 |

**Scatto (Sprint/Dash):** A character may sprint to move faster. Grants bonus movement but increases vulnerability.

**Terrain penalties to movement checks:**

| Terrain | Penalty |
|---------|:-------:|
| Hills, woods, deserts, rocky ground | -1 |
| Forests, mountains, swamps | -2 |
| Rain, fog | -1 |
| Storm, blizzard | -2 |
| Flooding or hail | -3 |
| Crowded road | -1 to -2 |

### 8.4 Melee Combat (Mischia)

`[IMPLEMENTED]` — PDF pp.101–102.

To attack in melee, the attacker must have **sufficient space** for their weapon's Misura (combat range category) and must have **engaged** the opponent at that range.

**Attack:** A standard check using the appropriate weapon skill (e.g., Armi comuni, Armi da guerra, Armi corte), opposed by the defender's defense roll. Net successes determine effect.

**Insufficient space:** Using a weapon in a space smaller than its Misura imposes **-1 success per meter short**. (e.g., a Large weapon in a 1m corridor = -2 penalty.)

**Melee attack modifiers:**

| Condition | Modifier |
|-----------|:-------:|
| Attacker on higher ground | +1 |
| Defender *senza fiato* (out of breath) | +1 |
| Defender prone | +1 |
| Defender immobilized | +2 |

**Damage:** If the attack hits (net successes > 0 after defense), damage is resolved step by step:

1. `grossWounds = netSuccesses + weapon.damageValue`
2. `armorAbsorbed = min(grossWounds, armor.protezione)`
3. `netWounds = grossWounds - armorAbsorbed`
4. Apply damage type effects (see 8.7):
   - **Taglio (T):** if `armorProtezione == 0` OR `grossWounds > armorProtezione` → `netWounds += 1`
   - **Botta (B):** target loses 1 Riflessi (regardless of armor)
   - **Punta (P):** armor protezione reduced by 1 for rest of encounter
5. `armor.robustezzaCurrent -= armorAbsorbed` (1:1)

> *Example: Albrecht (sword +3T) scores 2 net successes vs. chainmail (Prot 3). grossWounds = 2+3 = 5. Absorbed = 3. netWounds = 2. Taglio: grossWounds(5) > protezione(3), so +1 → 3 wounds total.*

**Fleeing melee:** Once engaged, disengaging is dangerous. The opponent gets a free attack against anyone attempting to flee.

### 8.5 Combat Range (La Misura)

`[IMPLEMENTED]` — PDF p.106.

Weapons are classified into five range categories, from longest to shortest:

| Misura | English | Approx. Range | Examples |
|--------|---------|:-------------:|---------|
| Larghissima (LL) | Very Long | 3–4 m | Pikes, cavalry lances |
| Large (L) | Long | 2–3 m | Polearms, two-handed weapons |
| Media (M) | Medium | 1–2 m | Swords, axes, maces |
| Stretta (S) | Close | ≤ 1 m | Daggers, knives |
| Abrazzar (A) | Grappling | Contact | Unarmed/wrestling |

**Misura mismatch:** When combatants wield weapons of different Misura, the one with the shorter weapon is **fuori Misura** (out of range) and **must close the distance** before attacking.

**Closing the Misura (Chiudere la Misura):**

Two methods:
1. **Successful defense with 3+ successes** — the defender automatically closes to their weapon's range.
2. **Dedicated action** — an **Agilita check** opposed by the defender's weapon skill. Both apply their weapon's damage. The winner inflicts wounds for net uncontested successes and sets the range to their weapon's Misura. The defender of the current range gets **one free attack per closure attempt**, but each subsequent attempt in the same turn gives the defender **-1 cumulative penalty**.

> *Example: A swordsman (Medium) faces a spearman (Long). The swordsman must close one step. The spearman gets a free attack; if the swordsman survives and wins the opposed check, melee continues at Medium range.*

### 8.6 Defense (Le Difese)

`[IMPLEMENTED]` — PDF p.101.

After each attack, the defender may declare one of two defense types:

| Defense | Cost | On Success |
|---------|------|-----------|
| **Parata** (Parry) with weapon or shield | 1 action; Riflessi cost = attacker's successes. First shield parry per turn is **free**. | Attack misses. Attacker loses Riflessi = defender's net successes. |
| **Schivata** (Dodge) | Riflessi cost = threat − net successes (min 0). *Errata §4.6 line 2148.* | Attack misses. |

If an attack results in **0 net successes** after defense, it deals no wounds.

Parries can be enhanced with a **free combined maneuver of Forza or Atletica**, granting **+1 damage bonus** on a counter.

### 8.7 Armor and Protection (Armatura e Protezione)

`[IMPLEMENTED]` — PDF p.102.

Each armor piece has a **Protezione** (Protection) value, subtracted from incoming wounds after defense resolution.

**Damage types** interact with armor:

| Type | Italian | Effect |
|------|---------|--------|
| **Slash** | Taglio | Causes **1 additional wound** against targets with **no** remaining Protection |
| **Blunt** | Botta | Reduces target's **Riflessi by 1** (regardless of Protection) |
| **Thrust** | Punta | **Reduces armor Protection by 1** for the rest of the encounter |

> *Example: Albrecht wears chainmail (Protection 3). He is hit for 5 wounds by a slashing weapon. Protection absorbs 3, leaving 2 wounds. Since Protection was not fully penetrated at the time of the hit, the slash bonus does not apply.*

**Robustezza degradation:** Each point of damage absorbed by armor reduces `robustezzaCurrent` by 1. For every 10 total robustezza lost from the original max, protezione is permanently reduced by 1.

> *Example: Chainmail (Prot 2, Rob 20). After absorbing 10 total damage, robustezzaCurrent = 10, protezione drops to 1. After 20 total absorbed, armor is destroyed (robustezza 0, protezione 0).*

**Combat action costs (consolidated):**

| Action | Riflessi Cost | Other Cost | Notes |
|--------|:------------:|:----------:|-------|
| Standard attack | 0 | 1 action | Character's one action per turn |
| Parata (Parry) | attacker's successes | 1 action | First shield parry per turn is free |
| Schivata (Dodge) | attacker's successes | — | No action cost |
| Combined maneuver | 3 | 1 spirito | Action resolves at current Riflessi - 3 |
| Rifiatare | 0 | 1 fatica | Recovers max(1, grades(atletica)) Riflessi (start of turn) |
| Attesa (Wait) | 0 | — | Skip turn, recover all Riflessi next turn |

### 8.8 Ranged Combat (Armi da Tiro e da Lancio)

`[IMPLEMENTED]` — PDF pp.107–108. computeRangePenalty in engine, ranged detection (gittata > 0), reload gate + tracking (reloadTurnsRemaining on WeaponDataModel, decrement on round, clear on combat end), distance/cover fields in attack dialog, cover as difficultyThreshold, Parata blocked for ranged, reload badge in inventory.

Ranged attacks require the appropriate skill: **Archi** (bows), **Balestre** (crossbows), or **Atletica** (thrown weapons). Combined maneuvers are allowed. Minimum space: 2 meters.

**Range and Gittata:** Each ranged weapon has a **Gittata** (range increment) in meters. Within this range: no penalty. Beyond it, **-1 success penalty per additional range increment**.

**Ranged weapon table:**

| Weapon | Gittata | Rate of Fire |
|--------|:-------:|:------------:|
| Weapons with *Da lancio* property | 10 m | Every turn |
| Thrown melee weapons | 5 m | Every turn |
| Bow (Arco) | 30 m | Every 2 turns |
| Light crossbow (Balestra leggera) | 20 m | Every 2 turns |
| Staff crossbow (Balestra a staffa) | 20 m | Every 4 turns |
| Vertical crossbow (Balestrone a verricello) | 20 m | Every 6 turns |

Expert archers (or those with the *Incoccamento* talent) halve reload time and can fire every turn.

**Cover difficulty:**

| Cover Amount | Difficulty Threshold |
|--------------|:-------------------:|
| 3/4 cover (behind a merlon or arrow slit) | 4 |
| 1/2 cover (behind a corner, window, or log) | 3 |
| 1/3 cover (behind a low wall or shrub) | 2 |

For targeted attacks against covered targets, the difficulty is the **higher** of the cover difficulty and the body-part difficulty.

**Ranged attack modifiers:**

| Condition | Modifier |
|-----------|:-------:|
| Attacker moving | -1 |
| Attacker running | -2 |
| Mounted at trot | -2 |
| Mounted at gallop/charge | -3 |
| Tiny or minute target | -1 to -3 |
| Large, enormous, or gigantic target | +1 to +3 |

**Atmospheric modifiers:**

| Condition | Modifier |
|-----------|:-------:|
| Rain | -1 |
| Heavy rain or snowfall | -2 |
| Wind | -1 |
| Very strong wind | -3 |
| Light fog, full moon night | -1 |
| Waning/waxing moon | -2 |
| Heavy fog, moonless night | -3 |

**Shooting into melee (Tirare nella Mischia):** Difficulty **3**. If the attack succeeds with only 1–2 successes (below difficulty), a **random combatant** in the melee is hit instead. The Master assigns numbers to each combatant (larger creatures get more numbers) and rolls randomly.

**Ranged defense:** A target can attempt a **Reaction of Agilita** against ranged attacks, but only if they can see the source of the attack.

**Being hit while advancing** requires a **Reaction of Volontà against the wounds received** (variable, not fixed). Failure means falling prone and losing the next turn of movement.

### 8.9 Special Melee Moves (Mosse in Mischia)

`[IMPLEMENTED]` — PDF pp.104–105.

Special moves follow normal attack rules but add a **difficulty threshold** that must be met by net successes. If the threshold is not met, the action fails completely.

*Optional rule: the Master may allow players to declare a special move after seeing the initial roll result.*

#### Targeted Attack (Attacco Mirato)

Aim at a specific body part. Difficulty depends on location:

| Target | Difficulty |
|--------|:---------:|
| Head, vital organs | 4 |
| Legs, shield arm | 3 |
| Weapon arm, chest | 2 |

On success (net successes ≥ difficulty), damage is applied to the specified location and the target must make an **Agilita Reaction** against the effects.

#### Non-Lethal Strike (Colpo Non Letale)

Difficulty **2**. Hit with the flat of the blade, pommel, or restrained force. On success, the target loses **Fatica** instead of taking wounds (even if armor absorbs the hit). **Blunt weapons get +1 success** on this move.

#### Disarm (Colpire l'Arma)

Difficulty **2 successes** to trigger. Opposed attack vs. the defender — target makes **Forza Reaction vs net attack successes**. On success, the opponent's weapon flies **1 meter per uncontested success**. Cannot target shields (only weapons).

*Special:* In some contexts, unarmed disarms are possible (e.g., grabbing a spear shaft), but difficulty increases based on the weapon type.

#### Throw Weapon (Lanciare un'Arma)

Difficulty **2**. All melee weapons can be thrown at **5 meters range** using **Atletica**. Weapons with the *Da lancio* property use normal ranged rules at **10 meters range**. Dodging a thrown weapon costs **double Riflessi**.

#### Parata Accompagnata (Combined Parry)

**Parata Accompagnata (Combined Parry)** (PDF line 2553): Use two weapons (including shield) to defend. Sacrifice the secondary weapon's free action to add **both Parata values** to the defense check. Variant: can also sacrifice free action to **support a dodge**, adding secondary weapon's Parata to dodge successes; but attacker applies weapon damage as if it were a parry.

#### Push (Spinta)

Available at Close or Grappling range. Test weapon skill or **Lotta** vs. the opponent — opponent can **defend normally OR make a Forza Reaction** (not Agilita). On success, push the opponent back and optionally **change the combat Misura**. If net attack successes ≥ 3, the target is thrown: wounds = net successes − armor protection (characters use equipped armor protezione, creatures use flat protezione field). If the pushed defender collides with others, those others must make a **Forza check** against the net successes or be pushed as well.

#### Study the Battlefield (Studiare il Campo di Battaglia)

**Once per combat.** One party member uses an action to make an **Arte della guerra** check. Each success identifies one **tactical advantage** in the environment (a low branch, a trapdoor, a hanging tapestry, stairs, etc.). Any ally may spend one of these advantages for a **+1 bonus success** on a single attack or defense roll. Each advantage can only be used once per combat.

#### Contrattacco (Counterattack)

**Contrattacco (Counterattack)** (PDF line 2542): Difficulty **3 successes**. Execute as a parry. If net defense successes reach difficulty, attacker loses 1 Riflessi AND takes wounds = net defense successes + defender's weapon damage. [TODO -- not implemented]

#### Finta (Feint)

**Finta (Feint)** (PDF line 2547): Difficulty **2 successes**. Resolves as attack but **without weapon damage or Parata**. Net successes >= difficulty: defender loses 1 Riflessi per uncontested success. Weapons with Agganciare pregio cause **1 additional Riflessi loss** (2 if double Agganciare). [TODO -- not implemented]

#### Disarmo difensivo (Defensive Disarm)

**Disarmo difensivo (Defensive Disarm)** (PDF line 2545): Wait for an attack. Defend with a **combined maneuver of Lotta on the weapon skill**. Difficulty **3**: attacker is disarmed (loses weapon) plus loses Riflessi. Can be used unarmed (Lotta only). [TODO -- not implemented]

#### Colpire lo Scudo (Hit the Shield)

**Colpire lo Scudo (Hit the Shield)** (PDF line 2540): Difficulty **2 successes**. Shield must pass object resistance check (target 7 +/- quality modifier - net attack successes). Failure destroys the shield. Cannot target bucklers (metal). [TODO -- not implemented]

### 8.10 Unarmed Combat (Abrazzar)

`[IMPLEMENTED]` — PDF pp.109–110.

Unarmed combat uses the **Lotta** skill and operates at its own Misura (body contact). All melee rules apply, plus the following special actions.

#### Strikes (Percussioni)

| Attack | Damage | Parry Modifier | Notes |
|--------|:------:|:--------------:|-------|
| Punch (Pugno) | +0B | -1 | Blunt damage |
| Kick (Calcio) | +1B | -1 | Blunt damage |

#### Grapple (Presa)

Grapple uses Targeted Attack rules but with difficulty **reduced by 1**. Net successes become a **variable grade bonus** (not flat +1) on the next Lotta or Forza check, and count as accumulated successes for locks.

**After a successful grapple, the attacker may:**
- **Free strike:** Percussione as a free action with **+1 damage** (headbutt, knee, elbow).
- **Throw (Sbilanciamento):** Free action; target falls prone. Victim must succeed on a Reaction to break free, with a -1 success penalty.
- **Consolidate into a lock (Bloccaggio).**

#### Lock (Bloccaggio)

The grapple becomes a full lock. The victim **cannot defend**. The attacker may:
- **Immobilize:** the victim cannot act.
- **Apply restraints:** requires 3 actions while locked.

To **break free**, the victim must win an opposed **Forza** or **Lotta** check, contesting the accumulated successes of the lock.

### 8.11 Mounted Combat (Combattimento in Sella)

`[IMPLEMENTED]` — PDF pp.102–103.

Riding in melee requires a **Cavalcare check** handled as a Reaction (Riflessi cost = melee damage):

| Trigger | Successes to contest |
|---------|:-------------------:|
| Start of each turn (untrained mount) | 3 |
| When struck (by mount or rider wounds) | Wounds received |

**Failure effects:**
- Failed with < 3 uncontested: rider is unhorsed. Fall damage uses the **mount's Movement** as the height/distance base.
- Failed with ≥ 3 uncontested: **mount flees**.

**Tournament jousts:** Resolved as simultaneous charges. Both riders benefit from mounted charge modifiers. Tournament lances deal **+4B** (reduced from normal +5B) and **shatter after impact**.

**Height advantage:** Rider gets **+1 success bonus to attacks AND defenses** against unmounted enemies. Mounted charge damage bonus is **+2** (not +1 like regular charge).

### 8.12 Surprise (La Sorpresa)

`[IMPLEMENTED]` — PDF p.100.

When one faction is unaware of the enemy (e.g., ambush), **surprise** occurs:
- The aware faction makes a **Percezione** check opposed by the unaware faction.
- In the first turn, the surprised faction suffers **-1 Riflessi per uncontested success** from the surprise check, and cannot counterattack.
- Ambusher gets a **free action** before combat starts. Surprised characters **cannot rifiatare** in the first turn.
- **Mutual surprise:** when groups stumble upon each other, all make Percezione checks; Riflessi penalty from best opposing check; no free action for either side.

### 8.13 Reactions (Reazioni)

`[IMPLEMENTED]` — PDF p.85.

Reactions are defensive checks triggered by the Master (except Agilita dodges, which the player may choose). They cover: fear, disease, fatigue, poison, pain, and other threats.

**Cost in initiative:** Riflessi equal to the **threat's successes**. Reduced by **1 per net success** on the Reaction check.

**Restriction:** Reactions **CANNOT** use combined maneuvers (PDF p.85).

**Agilita Reactions** are the exception — they are optional (player chooses whether to attempt). Characters *senza fiato* cannot perform attacks or Agilita-based reactions/defenses. Other reactions are allowed with **+1 penalty** and **no Riflessi cost**. *Errata line 2141.*

#### Fear Reactions (Reazioni di Paura)

`[IMPLEMENTED]` — PDF p.87.

Failed Fear Reactions lose **Fatica equal to the threat level** plus additional effects based on uncontested successes:

| Uncontested Successes | Effect |
|:---------------------:|--------|
| 2 (Scossi / Shaken) | -1 success penalty on Volonta checks |
| 3 (Spaventati / Frightened) | -2 penalty vs. fear source, -1 to all other actions |
| 4 (Terrorizzati / Terrified) | Must flee. If impossible, cannot attack the source. -2 to all actions |
| 5 (Crollo / Breakdown) | Paralyzed for 1d6 x 10 minutes |
| 6+ (Collasso / Collapse) | Unconscious for 1d6 hours |

**Calming a terrified/collapsed character:** An ally who passed the same Fear Reaction may attempt **Autorita, Carisma, or Raggirare** (with Empatia as combined). Each success gives the victim a bonus grade to re-attempt the Fear Reaction. Can only be attempted once per hour; costs 1 action in combat.

#### Fatigue Reactions (Reazioni di Fatica)

`[IMPLEMENTED]` — PDF p.85.

Failed Fatigue Reactions lose **1 Fatica per uncontested success**.

**Travel/labor fatigue threat modifiers:**

| Condition | Threat Modifier |
|-----------|:--------------:|
| Hills, woods, deserts, rocky ground | +1 |
| Forests, mountains, swamps | +2 |
| Rain, fog | +1 |
| Storm, blizzard | +2 |
| Snow or hail | +3 |
| Extreme heat or cold | +1 to +3 |
| Wearing armor | +Protection value |
| Light encumbrance | +1 |
| Traveling at night | +1 |
| Increased pace (+1 Movement) | +1 |
| Decreased pace (-1 Movement) | -1 |
| Mounted at walk or in cart | -1 |
| Mounted at trot | +1 |
| Mounted at gallop | +2 |
| Each hour beyond 8 per day | +1 |
| Skipping 1-hour rest per 4 hours | +1 |

**Reaction frequency scales with threat:**

| Threat Level | Reaction Frequency |
|:------------:|:-----------------:|
| Up to 2 | Every 8 hours |
| 3–4 | Every 4 hours |
| 5–6 | Every 2 hours |
| 7+ | Every hour |

#### Disease Reactions (Reazioni di Malattia)

`[IMPLEMENTED]` — PDF p.86.

Diseases have three factors: **incubation time**, **power** (successes to contest), and **effects**.

- Failed Reaction: lose Fatica per the disease's specific effect per uncontested success.
- A patient who survives 1 week after failing may re-attempt the Reaction with the power reduced.
- **Passing 2 Reactions = automatically cured.**

**Example diseases:**

| Disease | Incubation | Power | Effect per Day |
|---------|:----------:|:-----:|---------------|
| Cholera (Colera) | 8d6 hours | 3 | 1d6 Fatica per uncontested success |
| Black Plague (Peste Nera) | 1d6 days | 4 | 1d6 Fatica/day per uncontested success |
| Typhus (Tifo) | 2d6 days | 3 | -1 success penalty to all actions + 1 Fatica/day per uncontested success; power increases by 1 after first week |
| Smallpox (Vaiolo) | 1d6 days | 3 | 1d6 Fatica/day per uncontested success (first 2–4 days with blisters and high fever) |

### 8.14 Resolve (Risolutezza)

`[IMPLEMENTED]` — PDF pp.88–89.

Resolve confrontations test **Volonta** when characters face moral pressure from their Values or Temptations.

**Value confrontations:** 1 to 3 successes to contest (1 = minor transgression, 3 = major sacrifice). Modified by the character's relevant Valore score.

**Opposing Valore reduction (PDF line 1736):** Risolutezza difficulty is modified by +1 per point in the Valore being transgressed AND **-1 per point in the opposed Valore** (e.g., Impietas reduces difficulty of transgressing Fides).

**Temptation confrontations:** 3 to 6 successes (3 = basic temptation, 6 = irresistible impulse). Based on the seven sins (Gola, Invidia, Ira, Lussuria, Superbia, etc.).

**Outcomes of failed Resolve (by uncontested successes):**

| Uncontested | Effect |
|:-----------:|--------|
| 1 (A denti stretti / Gritted teeth) | May resist, but loses Spirito = total threat successes and suffers -1 to all checks for hours = threat |
| 2 (Tensione / Tension) | May resist, but same penalties as above |
| 3 (Liberta di scelta / Free choice) | If they resist, lose 1 point in the relevant Valore (to min 0). If resisting a Temptation, lose Spirito + Fatica = threat |
| 4 | Must obey their Values / yield to Temptation for at least 1 hour; will react violently to anyone preventing them |
| 5 (Blasfemi) | Acts to defend Values violently; ready to abandon or betray companions |
| 6+ (Mia ira!) | Acts as a fanatic, risking life and others' lives to act according to Values |

---

### 8.15 Environmental Damage

`[TODO]` — PDF lines 1514-1533. Not yet specified or implemented.

**Fall damage**: Soft terrain = 1 wound/meter, solid = 2, hard = 3. **Agilità Reaction** vs meters fallen; each success reduces effective meters by 1. Armor Protection applies. **Running fall**: damage = Movimento of faller/mount; reduce by 1 per success in Agilità, Atletica, or Cavalcare (mounted).

**Fire damage**: **Agilità Reaction** vs threat (torch=2, campfire=4, burning house=6, Greek fire=8). Failure = 1 wound per uncontested success (Protection applies). If ≥1 fire wound: roll 1d6, if result ≤ wounds, catch fire (Fear Reaction, +1 wound/turn without Protection, extinguish via Agilità sfida soglia 3 / difficoltà 2).

---

## 8b. Token Status Effects `[IMPLEMENTED]`

Visual token overlays and automated status tracking for combat conditions. Replaces Foundry default status effects with SwORD-specific statuses.

### Auto-Synced Statuses

These statuses are automatically applied/removed when actor data changes (wound levels, fatigue, riflessi):

| Status | Condition | Penalty |
|--------|-----------|---------|
| Ferite gravi | woundLevels.gravi > 0 | -1 (already in wound penalty) |
| Ferite critiche | woundLevels.critiche > 0 | -2 (already in wound penalty) |
| Ferite mortali | woundLevels.mortali > 0 | -3 (already in wound penalty) |
| Stanco | fatigueLevel = stanco | -1 (already in fatigue penalty) |
| Sfinito | fatigueLevel = sfinito | -2 (already in fatigue penalty) |
| Senza Fiato | riflessi.value ≤ 0 | Cannot act; -1 on Agilità reactions; attackers get +1 |

### Semi-Auto Statuses

| Status | Trigger | Behavior |
|--------|---------|----------|
| Sanguinamento | First time critiche > 0 from wounds | Applied automatically in defense flow. Lose 1 Fatica per combat round. Auto-removed after 12 turns or by GM (Guarigione). |

### Manual Statuses (GM toggle via token HUD)

| Status | Trigger | Notes |
|--------|---------|-------|
| Svenuto | Forza reaction failed at critiche | System posts chat prompt; GM applies manually |
| Morto | Forza reaction failed at mortali | Maps to Foundry DEFEATED. System posts chat prompt; GM applies manually |

### Forza Reaction Rules (PDF p.68)

When a character first reaches **Ferite critiche** or **Ferite mortali**:
- System posts a chat notification prompting a Forza reaction
- Contest difficulty = wound points currently in that level
- **Critiche failure**: character faints (svenuto) — GM applies via token HUD
- **Mortali failure**: character is dying (morto) — GM applies via token HUD

### Senza Fiato Combat Effects (Errata line 2141)

When riflessi < 0:
- **Cannot act** (attacks blocked) — early block in attack flow
- **Cannot defend** (parata, schivata, accompagnata blocked) — early block in defense flow
- **Cannot perform Agilità reactions** — blocked in reaction flow
- **Other reactions allowed** with **+1 penalty** and **no Riflessi cost**
- **Forza reactions** (disarm/push) still allowed via reactionForza defense type
- **Attackers** targeting a senza-fiato actor get **+1 success bonus**
- At start of next turn: forced attesa to recover Riflessi

### Implementation

- `module/statuses/sword-statuses.mjs`: Status definitions + syncActorStatuses()
- `module/main.mjs`: CONFIG.statusEffects replacement, updateActor hook, bleeding in combatRound/deleteCombat hooks, attesa recovery in combatRound hook
- `module/rolls/sword-defense.mjs`: Sanguinamento application, Forza reaction chat prompts, senza-fiato defense block (reactionForza routed before block)
- `module/rolls/sword-attack.mjs`: Senza-fiato attack block + +1 attack bonus vs breathless targets
- `module/rolls/sword-reaction.mjs`: Senza-fiato Agilità block, +1 penalty, no Riflessi cost, attesa interruption
- `module/rolls/sword-attesa.mjs`: Attesa action (skip turn, recover all Riflessi next round)

---

## 9. Extended Tests (Sfide)

`[IMPLEMENTED]` — PDF pp.92–93, §4.8.

A **sfida** (extended test) is a series of linked checks or opposed confronti where participants accumulate successes toward a **soglia** (threshold). Used for complex actions that cannot be resolved in a single check: competitions, pursuits, crafting, research, climbing, excavation, etc.

### 9.1 Setup

The GM defines the sfida parameters:

| Parameter | Description | Typical Range |
|-----------|-------------|---------------|
| **Abilità** (skill) | Which skill(s) can be used. Multiple skills may be allowed at GM discretion. | Any |
| **Soglia** (threshold) | Number of net successes needed to complete the sfida. | 3–10 |
| **Durata** (turn duration) | Time each turn represents. Varies by context: ~5 seconds in combat/pursuits, minutes/hours/days for non-combat sfide. | Variable |
| **Costo** (cost per attempt) | Resource spent per check: 1 Fatica for physical sfide, 1 Spirito for mental/social sfide. | 1 Fatica or 1 Spirito |
| **Tentativi** (max attempts) | Optional cap on number of turns. If unset, the sfida continues until soglia is reached or abandoned. | Optional |
| **Confronto** (opposed) | Whether an opponent makes opposed checks each turn. | Yes/No |
| **Fallimento** (failure consequence) | What happens when a check fails or the sfida is lost. May affect only the current turn or the entire sfida. | GM-defined |

Standard checks apply: modifiers, difficulty, foci, combined maneuvers, Fama spending, etc. are all available within each turn's check.

### 9.2 Flow

1. **Turn order**: If speed matters (pursuits, competitions), use **initiative** rules (§4.6): highest Riflessi acts first, then descending. Otherwise turns are simultaneous.
2. **Each turn**: Each participant makes one check with the designated skill. Successes accumulate toward the soglia.
3. **Confronto (opposed)**: If the sfida is opposed, both sides roll. Only **net successes** (winner's successes minus loser's) count toward the winner's accumulated total. Ties produce no net successes for either side.
4. **Riflessi penalty (opposed with initiative)**: In opposed sfide using initiative, the winner of each confronto may penalize the loser's Riflessi by the net successes. This is identical to the initiative Riflessi-drain mechanic in §4.6.
5. **Completion**: The first participant (or faction) to reach the soglia wins. In a competition with a fixed number of attempts, whoever has the most accumulated successes at the end wins.

### 9.3 Obstacle Reactions During Sfide

When the environment imposes penalties (situation modifiers from the table below), this means an **obstacle** is present. Each turn, the participant must make an **Agilità reaction** against a number of successes equal to:

- The **situation penalty** (absolute value), plus
- The **approach modifier** (see table below).

Every success from the obstacle reaction that is **not countered** causes **1 Fatica or 1 wound** (ferita).

In initiative contexts, the Agilità reaction costs Riflessi per normal reaction rules (§4.6).

### 9.4 Movement / Sprint (Scatto)

Movement uses Agilità or Atletica checks: each success = 10 meters per 5-second turn. Modified by:

**Approach modifiers:**

| Approccio | Check Modifier | Reactions & Defenses |
|-----------|:--------------:|:--------------------:|
| Prudente (cautious) | −1 | +1 |
| Corsa (running) | 0 | 0 |
| Carica (charge) | +1 | −1 |

**Situation penalties:**

| Situazione | Penalità |
|------------|:--------:|
| Colline, boschi, deserti, pietraie | −1 |
| Foreste, montagne, paludi | −2 |
| Pioggia, nebbia | −1 |
| Tempesta, bufera | −2 |
| Nevicata o grandinata | −3 |
| Strada affollata | −1 to −2 |

Movement guarantees **at least 1 success** (minimum 10m), regardless of penalties. Each success below the required amount costs **1 Fatica**.

### 9.5 Pursuits (Inseguimenti)

A pursuit is a specific sfida type using Agilità/Atletica.

| Parameter | Value |
|-----------|-------|
| **Abilità** | Agilità, Atletica |
| **Confronto** | Same skills (opposed) |
| **Costo** | 1+ Fatica per turn (see Movement above) |
| **Durata** | Variable by scale (see below) |

**Soglia**: The fleeing party must accumulate a certain number of net successes to escape; the pursuer must zero the distance. Soglia varies:
- Open field: 10
- Forests / large cities: 5

The pursuer reduces the distance by their net successes each turn.

**Pursuit scales:**

| Scala | Distanza | Durata del turno |
|-------|----------|:----------------:|
| Breve (< 1 km) | 10 meters | 5 seconds |
| Media (1–10 km) | 1 kilometer | 1 hour |
| Lunga (> 10 km) | 10 kilometers | 1 day |

### 9.6 Audience (Chiedere Udienza)

A social sfida for gaining audience with an important figure.

| Parameter | Value |
|-----------|-------|
| **Abilità** | Arti liberali, Autorità, Carisma, Raggirare, Usi e costumi |
| **Costo** | 1 Spirito per attempt |
| **Durata** | 1 day per attempt |

**Penalty by target's rank:**

| Figura pubblica | Penalità | Soglia |
|-----------------|:--------:|:------:|
| Signore locale, capovillaggio, presbitero | 2 | 3 |
| Abate, siniscalco di un borgo, nobile minore | 2 | 4 |
| Vescovo, nobile (marchese, barone) | 3 | 6 |
| Arcivescovo, nobile maggiore (duca, conte) | 3 | 8 |
| Sovrano, ministri del regno | 4 | 10 |
| Il papa o l'imperatore | 4 | 12 |

Fama can be used to influence individual checks as normal.

---

## 10. Social Challenges (Ars Oratoria)

`[IMPLEMENTED]` — PDF pp.94–97, §4.9. Errata lines 2254–2321.

A structured social encounter subsystem for debates, negotiations, and rhetorical duels. Uses Riflessi-based initiative like combat. Implemented in `module/rolls/sword-ars-oratoria.mjs`.

### 10.1 Setup

| Parameter | Description |
|-----------|-------------|
| **Soglia** (threshold) | Net successes needed to win. Base 1 + situational modifiers. |
| **Starting skill** | One of: Autorità, Carisma, Raggirare, Arti liberali, Intrattenere. Its grade determines **max attempts**. |
| **Opponent** | NPC name, fixed successes per round, and Riflessi value. |
| **Spectators** | Optional phase before the main challenge. |

### 10.2 Skills

Four skills may be used in confronti (exchanges): **Autorità**, **Carisma**, **Raggirare**, **Arti liberali**.

- The chosen starting skill is used in the first round.
- Each subsequent round must use a **different skill** from those already used in the challenge.
- Once all 4 skills have been used, the rotation resets.

**Risk-reward skills** — Autorità and Raggirare carry extra stakes:
- Winner of the confronto gets **+1 additional success immediately** (in the current exchange, not next round). If the orator loses, the opponent gets +1 extra success instead.

### 10.3 Flow

1. **Spectator phase** (optional): The orator rolls **Intrattenere** opposed by the opponent's Carisma/Intrattenere. Each net success grants +1 to the orator's grade for the entire challenge.
2. **Round loop**: Each round is one **botta e risposta** (exchange).
   - The orator chooses a skill, rolls an opposed check vs the opponent's fixed successes.
   - Standard check options apply: foci, combined maneuvers (cost 3 Riflessi + 1 Spirito), Fama spending, Valore activation, penalty cancellation via Spirito.
   - **Net successes** accumulate toward the threshold.
   - The **loser** of each confronto loses Riflessi equal to the net successes (Riflessi drain).
3. **Termination**: The challenge ends when:
   - Accumulated successes >= threshold → **win**
   - Accumulated successes <= -3 → **loss**
   - All attempts exhausted → result depends on accumulated total

**Graduated outcomes by margin** (PDF line 2316):
- **Win by 3+**: Full success — request accepted
- **Win by 2**: Accepted with conditions
- **Win by 1**: Accepted with reduced demands
- **Loss by 1**: Retry in 1d6 days with -1 threshold
- **Loss by 2**: New meeting required, must reduce demands
- **Loss by 3**: Further contact precluded
- **Loss by 4+**: Violent reaction, -1 Fama
- **Loss by 6+**: Prison, -2 Fama

### 10.4 Senza Parole (Speechless)

When a participant's Riflessi drops below 0, they are **Senza Parole** — speechless:
- They skip the current round and the next round.
- Riflessi resets to max at the start of the skipped round (like forced attesa).

### 10.5 Spectators (Intrattenere)

Before the main challenge, the orator may attempt to sway the audience:
- Roll **Intrattenere** vs opponent's fixed successes.
- Each net success = +1 grade bonus for the entire challenge.
- On loss: opponent gains the grade bonus instead.

### 10.6 Recedere (Yield / Modify Proposal)

At any point during the challenge, either side may **Recedere** — modify their proposal to change the threshold. This does not consume an attempt. The new threshold replaces the old one.

### 10.7 Talent Integration

| Talent | Key | Effect |
|--------|-----|--------|
| Lingua Sciolta | `ars_oratoria_riflessi_drain` | Once per challenge: bonus Carisma confronto that drains opponent Riflessi (no success accumulation). |
| Retore | `no_riflessi_combined_ars_oratoria` | Combined maneuvers in Ars Oratoria do not cost Riflessi. |
| Intuito | `ars_oratoria_threshold_minus1` | Threshold reduced by 1 (minimum 1). |
| Giudice | `categorical_judgment_ars_oratoria` | Once per challenge: +1 success bonus on a confronto. |

---

## 11. Character Creation

`[IMPLEMENTED]` — PDF pp.42–65, Chapter 2. 8-step creation wizard in `module/apps/creation-wizard.mjs` (Ceto, Characteristics, Culture, Derived Stats, Skills, Valori, Retaggio, Equipment).

### Step 1 — Characteristics (p.46)

Distribute **54 points** across 6 characteristics. Range 5–13 each, default 7.

### Step 2 — Culture (pp.48–49) `[IMPLEMENTED]`

Choose 2 cultural traits from 12 cultures:

| Culture | Italian | Skill Choices | Valori | Advantage | Status |
|---------|---------|---------------|--------|-----------|--------|
| Antica | Ancient | Carisma / Volontà | Fides / Superstitio | +1 mod(Audacia) | Implemented |
| Cortese | Courteous | Carisma / Ragionamento | Fides / Honor | Extra die in 1 of: Arti liberali, Autorità, Empatia | Implemented |
| Erudita | Erudite | Percezione / Ragionamento | Ego / Ratio | +1 success on study/meditation | Implemented |
| Guerresca | Warlike | Agilità / Forza | Impietas / Honor | +1 graffi/leggere, +1 fresco/stanco | Implemented |
| Intraprendente | Enterprising | Percezione / Volontà | Ego / Ratio | +1 retaggio point | Implemented |
| Laboriosa | Industrious | Percezione / Ragionamento | Honor / Ratio | Starting wealth ×2 | Implemented |
| Meticcio | Mixed heritage | Any | Any | Extra language + extra die in Storia e leggende & Usi e costumi | Implemented |
| Militare | Military | Agilità / Volontà | Impietas / Honor | Starting equipment Buona quality | Implemented |
| Rurale | Rural | Forza / Percezione | Fides / Superstitio | Extra die in Sopravvivenza & Usi e costumi | Implemented |
| Spirituale | Spiritual | Carisma / Volontà | Fides / Superstitio | +4 Spirito | Implemented |
| Tenace | Tenacious | Percezione / Volontà | Honor / Superstitio | Extra die in Forza | Implemented |
| Urbana | Urban | Carisma / Ragionamento | Ego / Ratio | Ceto skill distance −1, contact bonus | Partial (contacts deferred) |

Each trait grants: 1 extra die in a skill (choice of 2, or any for Meticcio), access to specific Valore axes (constrains Valori step), 1 special advantage. Characters with mod(Audacia) ≥ +1 can select Valori from culture-allowed axes.

Implementation: Step 3 in wizard (after Characteristics, before Derived). Culture traits stored in `system.culture.trait1/trait2`. Culture-derived effects computed in `prepareDerivedData()` (Antica, Guerresca, Spirituale). Extra dice applied at creation finish. Valori step constrained to culture-allowed axes via `getCultureAllowedValori()`. Data: `module/data/cultures.mjs`.

### Step 3 — Ceto (pp.50–52)

Start as Umile (free). Spend Retaggio to upgrade:

| Ceto | Retaggio Cost | Fama Bonus |
|------|:------------:|:----------:|
| Umile | 0 | +0 |
| Popolano | 1 | +1 |
| Borghese | 2 | +2 |
| Nobile | 3 | +3 |

Each ceto point grants +1 Fama. Ceto determines skill access, equipment, income.

### Step 4 — Mestiere Skills (p.53)

Every character starts with 6 base skills at grade 1: **Volonta, Agilita, Carisma, Forza, Ragionamento, Percezione** (these are "abilità di Reazione" and can never be mestiere).

Choose 6 additional **mestiere skills**. Own-ceto and adjacent-ceto skills cost 1 pick; farther ceti cost +1 per extra distance (distance 2 = cost 2, distance 3 = cost 3). Mestiere skills grant focus at grade 3 and 6.

### Step 5 — Free Skills (p.63)

Number of free skill picks = **Mens score**. Each can be: new skill at grade 1, OR increase an existing grade-1 skill to grade 2. Subject to same ceto cost rules.

### Step 6 — Training (p.63)

- 2 skills raised to grade 3 (focus available for mestiere skills)
- 8 skills at grade 2

### Step 7 — Valori (p.45)

Distribute points across 3 axes (only one side per axis). Max total at creation = **max(0, mod(Audacia))** (errata; overall max during chronicle = 3 + mod(Audacia)). Score 0–3 per value. Only culture-allowed axes are selectable (Meticcio allows all).

### Step 8 — Retaggio/Events (pp.60–62, wizard Step 7)

Points = 3 + mod(Gratia). Spend on ceto upgrade and/or events (1 pt each).

15 event types (each selectable at most once): Addestramento marziale, Apprendistato, Affinità animale, Antico sapere, Cimelio, Conoscenze, Dedizione, Esperienza, Fascino, Indomito, Istinto, Legame, Nomea, Percorso spirituale, Talento naturale.

Each event has mechanical effects applied at creation:
- **Extra dice events** (Addestramento marziale, Antico sapere, Apprendistato, Dedizione, Fascino, Talento naturale): pick skill(s) from a pool, gain extraDice on those skills.
- **Apprendistato** is modal: either +2 dice on 1 skill or +1 die on 2 skills (Artigiano/Professione).
- **Esperienza**: +1 grade 3 training slot, +2 grade 2 training slots (in addition to Step 6 base training).
- **Istinto**: +1 Riflessi (permanent, stored as `retaggio.riflessiBonus`).
- **Nomea**: +1 Fama and doubles starting wealth.
- **Percorso spirituale**: +3 Spirito (stored as `retaggio.spiritoBonus`), pick 1 Valore at +1 (compatible with Step 7 axis choices).
- **Cimelio**: one starting item becomes **Ottima** quality.
- **Other flag events** (Affinità animale, Conoscenze, Legame): narrative effects stored as retaggio booleans/strings.
- **Indomito**: `[IMPLEMENTED]` +1 wound capacity to gravi, critiche, and mortali levels. +1 to stanco and sfinito fatigue thresholds (delays fatigue penalties). Stored as `retaggio.indomito` boolean, consumed in `prepareDerivedData()` step 8-9 and passed to `computeWoundCapacities()`.

Optional Tentazione (1 of 7 sins: Accidia, Avidità, Gola, Invidia, Ira, Lussuria, Superbia) grants +1 Retaggio point. Stored as `system.tentazione` (string field, empty if none chosen). Event count cannot exceed available Retaggio points.

### Equipment (wizard Step 8)

Roll starting wealth by ceto on entry to the equipment step (reroll available), then apply wealth multipliers from applicable culture/event effects. Equip manually from catalog or use random loadout; remaining wealth is stored as Lire/Soldi/Denari.

**Starting wealth** (PDF lines 1017-1067): Umile = 4d6 Soldi, Popolano = 2d6 Lire, Borghese = 2d6×5 Lire, Nobile = 4d6×10 Lire.

**Cost of living** (monthly): Umile = 1 Soldo, Popolano = 1d6 Soldi, Borghese = 2d6+12 Soldi, Nobile = 1d6+6 Lire. Not paying = -1 Fama.

**Rendita (income)** (monthly): Borghese = 4d6 Soldi, Nobile = 2d6 Lire. Umile and Popolano have no automatic income.

---

## 12. Equipment and Encumbrance

`[IMPLEMENTED]` — PDF Chapter 6, pp.112-135. Machine-readable: `sword-engine-spec.json → FoundryAdapter.itemDataSchema`.

### 12.1 Currency (Moneta)

PDF p.114.

| Denomination | Abbreviation | Value in Denari | Rarity |
|-------------|:------------:|:---------------:|--------|
| Denaro (d) | d | 1 | Common |
| Soldo (s) | s | 12 | Sought-after |
| Lira (l) | l | 240 | Luxury |

**1 Lira = 20 Soldi = 240 Denari.** All item costs stored as `costDenari` (integer) + `costDisplay` (original string). Denomination encodes rarity: denari items are everyday goods, soldi items are specialized, lira items are luxury.

### 12.2 Quality (Qualita)

PDF pp.116-117. Every item has a quality tier affecting cost, pregi slots, and (for skill gear) characteristic bonuses.

| Quality | Cost Multiplier | Pregi Slots | Skill Gear Bonus |
|---------|:--------------:|:-----------:|:----------------:|
| Scadente | x0.5 | 0 (penalties instead) | -2 |
| Normale | x1 | 0 | 0 |
| Buona | x3 | 1 (max cost-1) | +1 |
| Eccellente | x5 | 2 (max cost-2) or 1 (cost-2) | +2 |
| Ottima | x10 | combos up to 3 cost | +3 |
| Straordinaria | x25 | combos up to 4 cost | +4 |

**Skill gear quality bonus:** Applies to the linked characteristic score for checks using that gear. Scadente imposes -2 instead of a bonus.

**Scadente penalties:** Weapons: -2 to skill characteristic. Armor: +1 protezione for penalty only, 7 robustezza/point instead of 10. Travel gear: may break (1d6, 6=broken). Alchemical: Forza reaction vs 3 successes or nausea.

**Cost denomination upgrade:** Eccellente changes d→s; Ottima changes s→l; Straordinaria: base denomination changes to Lire then ×3. If already in Lire, multiply ×25.

**Straordinaria requirement:** Requires the **Chiave della mappa** talent to commission.

### 12.3 Encumbrance (Ingombro)

PDF p.47.

**Formula:** `Ingombro base = Fortitudo + gradi(Forza)`

| Category | Threshold | Penalty |
|----------|-----------|:-------:|
| Leggero (Light) | ≤ base × 2 | 0 |
| Moderato (Moderate) | ≤ base × 4 | -1 |
| Pesante (Heavy) | ≤ base × 6 | -2 |
| Massimo (Maximum) | ≤ base × 8 | -3 |

**Penalty application:** Encumbrance penalty applies to **all checks** AND **Movement** (PDF p.47: "a) a tutte le prove b) al Movimento"). Independent from armor skill penalty — they **stack** on armor-penalized skills.

**Computation:** `carriedWeight = sum(item.weight × item.quantity)` for all carried items. Category determined by highest threshold not exceeded. If carriedWeight > base × 8, the character cannot move.

**Integration with penalty formula:**
```
totalPenalty = woundPenalty + fatiguePenalty + encumbrancePenalty + additionalPenalty
             + (skill.armorPenalized ? max(0, armorProtezione - armorPregiReduction_for_skill) : 0)
             - spiritoForPenaltyCancellation
```

### 12.4 Item Types

Four Foundry Item document types: **weapon**, **armor**, **shield**, **gear**.

#### Weapons

Fields: weaponId, label, category (archi/balestre/armi_corte/armi_comuni/armi_da_guerra), skillId, hands (una_mano/due_mani), costDenari, costDisplay, weight (kg), damageValue (int), damageType (T/B/P), parryModifier (int), misura (LL/L/M/S), pregi (array), quality, rangedStats (gittata in meters, ricarica in actions — null for melee).

#### Shields

Fields: shieldId, label, costDenari, costDisplay, weight, damageValue, damageType (always B), parryModifier, misura (always S), pregi, quality.

**Free parry:** Shields require **Armi da guerra grade >= 1** for free parry per turn (PDF p.125 sidebar).

#### Armor

Fields: armorId, label, costDenari, costDisplay, weight, protezione (1/2/3), robustezza (protezione × 10), pregi, quality.

**Robustezza:** Each damage absorbed reduces robustezza by 1. Every 10 lost = -1 protezione. At 0, armor destroyed. (PDF p.128)

**Armor penalty on skills:** Protezione value is the success penalty on armorPenalized skills (archi, atletica, furtivita, manualita). Four armor pregi reduce this per-skill — see Section 12.6.

**Don time:** 1 minute per protezione point with helper, double alone.

**Partial wear:** Armor with protezione > 1 can be worn partially: torso = half cost/weight, head/limbs = quarter each.

#### Gear

Fields: gearId, label, gearCategory (skill_tool/travel/clothing/container/alchemical/ammunition), costDenari, costDisplay, weight, quantity, quality, skillBonus ({skillId, value}), description.

### 12.5 Weapon Pregi

PDF pp.126-127.

#### Ranged Pregi

| Id | Cost | Applies To | Effect |
|----|:----:|-----------|--------|
| attrezzi_da_ricarica | 1 | crossbows | -1 ricarica |
| da_guerra | special | bows | Add Fortitudo bonus to damage per quality |
| flettenti_morbidi | 1 | crossbows | -1 ricarica (min 0) |
| frecce_barbigli | 1 | ranged | +1 wound, causes bleeding |
| frecce_sfondagiaco | 1 | ranged | -2 target Protection (vs -1 for P) |
| frecce_da_caccia | 1 | ranged | T damage, +1 wound vs unarmored |
| frecce_da_volo | 1 | bows | +20m gittata |
| ricurvo | 1 | bows | +10m gittata |

#### Melee Pregi

| Id | Cost | Applies To | Effect |
|----|:----:|-----------|--------|
| agganciare | 1 | melee | Defender -1 Riflessi on parry (stacks to -2) |
| benedetta | 2 | melee | +1 Fides bonus when invoked |
| bilanciata | 1 | melee | Additional actions cost 2 Riflessi instead of 3 |
| compatta | 1 | melee | Use at one Misura less without penalty |
| copertura | 1 | shields | Auto cover vs ranged; if already has Copertura, costs 2, cover 3 |
| da_cavallo | 1 | melee+bows | Extra die mounted |
| da_lancio | 1 | short/polearms | Throwable 10m (+1 damage); if already, 20m |
| da_sicario | 1 | short only | +1 die on surprise attacks |
| demolitrice | 1 | melee | Doubled robustezza damage, +1 die Disarm |
| difensiva | 1 | melee | +1 parry; shields cost 2 |
| feritrice | 1 | melee | T damage instead of normal; if already T, cost 2, +2 wounds vs no-Protection |
| impugnatura_sicura | 1 | all | -1 wound/fatigue penalty, +1 die vs Disarm |
| leggera | 1 | Pesante only | -0.5kg, no Riflessi cost for Pesante |
| metallurgia_avanzata | 2 | melee | Choose extra damage type on hit |
| occultabile | 1 | short only | Can hide, found with Percezione 3+ |
| onorevole | 2 | melee | +1 Honor bonus when invoked |
| pavese | 1 | large shields | Pavise stand for cover |
| personale | 2 | melee+bows | Custom-built for owner; +1 extra die (owner only) |
| pesante | 1 | melee | +1 damage, costs 1 Riflessi/use; stacks |
| reliquia | 2 | melee+bows | +1 Superstitio bonus when invoked |
| rostri_o_ali | 2 | polearms | +1 success on free attacks vs Misura closure |
| sanguinaria | 1 | melee | Causes bleeding on 1+ wound |
| sfondagiaco | 2 | melee | P damage, -2 Protection |
| stordente | 2 | melee | B damage, target -2 Riflessi |
| versatile | 1 | not Pesante | One-hand costs 1 Riflessi; two-hand +1 parry |

### 12.6 Armor Pregi

PDF pp.128-129.

| Id | Cost | Effect |
|----|:----:|--------|
| agile | 1 | Atletica armor penalty -2 (min 0) |
| brigantina | 2 | +1 Protection torso only (XIV century) |
| da_arciere | 1 | Archi armor penalty -2 (min 0) |
| da_cavallo | 1 | +1 Protection when mounted |
| da_geniere | 1 | Manualita armor penalty -2 (min 0) |
| da_viaggio | 1 | Travel/sleep fatigue penalties -1 each |
| dimessa | 1 | Armor appears common; wearer can reduce Fama by 1 |
| elmo_migliorato | 1 | Padded: Protection 2 helmet; others: +1 vs head |
| furtiva | 1 | Furtivita armor penalty -2 (min 0) |
| leggera | 1 | -1/4 weight, Fatigue Reaction -1 |
| opera_d_arte | 1 | +1 Fama, price doubled |
| pratica | 1 | Halved don/doff time |
| pesante | 2 | +5kg weight, +1 Protection. Cannot combine with Leggera |
| rinforzata | 1 (padded/infantry) or 2 (cavalry) | +1 Protection against a **specific damage type** (chosen at purchase). Can be taken multiple times for different types. |
| robusta | 1 | Robustezza doubled (lose 1 Protection every 20 damage) |
| terrificante | 1-2 | +1 extra die on Autorita checks (not padded; 2 for infantry, 1 for cavalry) |

**Armor penalty reduction pregi:** Four pregi each reduce the armor penalty by 2 (min 0) for their specific skill: **agile** (Atletica), **da_arciere** (Archi), **da_geniere** (Manualita), **furtiva** (Furtivita). Formula: `armorSkillPenalty = max(0, protezione - armorPregiReduction_for_skill)`.

### 12.7 Equipment Tables

All data verified against PDF tables. Full canonical data in `sword-engine-spec.json → FoundryAdapter.itemDataSchema.compendiumData`.

#### Weapons — Archi

| Name | Cost | Wt | Dmg | Parry | Gittata | Ricarica | Hands | Pregi |
|------|------|----|-----|:-----:|:-------:|:--------:|-------|-------|
| Arco corto | 12d | 1 | +2P | +1 | 30m | 1 | due_mani | — |
| Arco lungo | 24d | 1.5 | +3P | +2 | 30m | 1 | due_mani | pesante |

#### Weapons — Balestre

| Name | Cost | Wt | Dmg | Parry | Gittata | Ricarica | Hands | Pregi |
|------|------|----|-----|:-----:|:-------:|:--------:|-------|-------|
| Balestra leggera | 3s | 3 | +3P | 0 | 20m | 2 | due_mani | — |
| Balestra a staffa | 6s | 4 | +4P | +1 | 20m | 4 | due_mani | — |
| Balestra a verricello | 10s | 6 | +6P | +2 | 20m | 6 | due_mani | — |

#### Weapons — Armi Corte

| Name | Cost | Wt | Dmg | Parry | Misura | Hands | Pregi |
|------|------|----|-----|:-----:|:------:|-------|-------|
| Accetta | 3d | 1 | +3T | +1 | S | una_mano | agganciare |
| Bastoncello | na | 1 | +1B | +1 | S | una_mano | — |
| Coltellaccio | 6d | 1 | +2T | +2 | M | una_mano | — |
| Coltello | 2d | 0.5 | +1T | +1 | S | una_mano | — |

#### Weapons — Armi Comuni

| Name | Cost | Wt | Dmg | Parry | Misura | Hands | Pregi |
|------|------|----|-----|:-----:|:------:|-------|-------|
| Bordone | 3d | 2 | +2B | +3 | L | due_mani | — |
| Falce da guerra | 12d | 6 | +4T | +3 | L | due_mani | — |
| Lancia da fante | 10d | 3 | +3P | +3 | L | due_mani | — |
| Martello | 6d | 2 | +2B | +1 | S | una_mano | compatta |
| Randello | 2d | 2 | +2B | +1 | M | una_mano | pesante |
| Roncone | 12d | 5 | +4P | +2 | L | due_mani | agganciare |
| Scure | 8d | 4 | +5T | +2 | M | due_mani | agganciare |
| Spiedo | 10d | 2 | +3P | +2 | M | una_mano | da_lancio |

#### Weapons — Armi da Guerra

| Name | Cost | Wt | Dmg | Parry | Misura | Hands | Pregi |
|------|------|----|-----|:-----:|:------:|-------|-------|
| Ascia normanna | 8s | 2 | +4T | +2 | M | una_mano | pesante, agganciare |
| Lancia da cavaliere | 2s | 4 | +5P | +1 | LL | due_mani | pesante, da_cavallo |
| Mannaia inastata | 2s | 5 | +6T | +3 | L | due_mani | pesante |
| Mazza ferrata | 10s | 2 | +3B | +1 | M | una_mano | — |
| Picca | 3s | 4 | +4P | +4 | LL | due_mani | pesante |
| Pugnale | 1s | 0.5 | +2P | +1 | S | una_mano | — |
| Spada da guerra | 40s | 2 | +4T | +3 | M | una_mano | versatile |
| Spada d'arme | 20s | 1.5 | +3T | +3 | M | una_mano | — |

#### Shields

| Name | Cost | Wt | Dmg | Parry | Misura | Pregi |
|------|------|----|-----|:-----:|:------:|-------|
| Brocchiere | 1s | 1 | +1B | +1 | S | — |
| Scudo | 1s | 3 | +2B | +2 | S | — |
| Scudo grande | 2s | 5 | +2B | +3 | S | pesante, copertura |

#### Armor

| Name | Cost | Weight | Protezione | Robustezza |
|------|------|:------:|:----------:|:----------:|
| Abiti imbottiti | 24d | 2 | 1 | 10 |
| Armatura da fanteria | 12s | 6 | 2 | 20 |
| Armatura da cavalleria | 8l | 15 | 3 | 30 |

#### Ammunition

| Name | Cost | Weight |
|------|------|:------:|
| Frecce (12) con faretra | 12d | 1 |
| Dardi (12) con faretra | 2s | 2 |

### 12.8 Data Quality Notes

- **No "I" damage type** — all weapons use T, B, or P. Earlier report of "I" was an OCR artifact.
- **Mannaia inastata:** Parry is +3 (confirmed from PDF table).
- **Falce da guerra:** No Pesante listed in pregi column on the table (two-handed but Pesante is not among its pregi).
- **Bastoncello:** Cost "na" (free/improvised) — stored as 0 denari.

---

## 13. Contacts (Contatti)

`[IMPLEMENTED]` — PDF pp.96–97.

Contacts are known NPCs with two dimensions:
- **Familiarita** (Familiarity): 0–4+ scale (0 = name only, 4+ = intimate bond).
- **Influenza** (Influence): social power level of the contact in their settlement.

### 13a. Contact Creation

When arriving at a new settlement, a character can establish contacts via a skill check.

**Settlement max contacts:** inn/village = 1, town = 2, city = 3, metropolis = 4 (talent `extra_contacts` adds +1).

**Penalties:**
- **Ceto distance:** |character ceto − contact ceto| (0–3). Urbana culture reduces by 1.
- **Region distance:** number of regions away (0 if trade route or metropolis).
- Standard fatigue/wound penalties apply. Spirito cancellation available.

**Bonuses:**
- Heritage `conoscenze`: +1 success bonus.
- Erudita culture: +1 success bonus.
- Fama spending on social skills.

**Success distribution:** Player splits successes between Familiarità and Influenza.
- Talent `contact_familiarity_plus1` (Rete di contatti): +1 to both Familiarità and Influenza.

**Influence mechanical uses** (PDF line 2384):
- Grade bonus on Storia e leggende / Usi e costumi checks for the contact's region
- Grade bonus on Mercatura checks (contact as guarantor)
- Grade bonus on sfide (audiences, archive research, local gossip)
- Financial aid (requires familiarità ≥ 3): gifts = 1 Lira per Influence point, loans = 10× that
- Hospitality: days = familiarità × influenza

**Per-character limit** (PDF line 2342): Each adventurer can create only **one contact per location**. Settlement limits are **party-wide** totals.

### 13b. Legame (Bond) Interlude

Interlude action: invest money to increase a contact's Familiarità by +1.

**Investment cost by current Influenza level:**

| Influenza | Cost |
|-----------|------|
| 0 | 2d6 soldi |
| 1 | 6d6 soldi |
| 2 | 1d6 lire |
| 3 | 2d6 lire |
| 4 | 4d6 lire |
| 5+ | 4d6 + (influenza−4)×2d6 lire |

---

## 14. Resolved Conflicts

Conflicts between source documents that have been resolved. The resolution is reflected in `sword-engine-spec.json`.

### CONFLICT-001: Grade Reduction Strategy

| Source | Strategy | Example: [4,3,2] with 4 grades |
|--------|----------|--------------------------------|
| `sword-check-spec.json` (authoritative) | **reduceLowestNonOneFirst** — always pick the die with minimum value > 1 | → [3,1,1] — **2 ones** |
| `sword-system.md` (secondary) | Reduce highest first — sort descending, iterate top-down | → [1,2,2] — 1 one |
| PDF | No explicit algorithmic ordering specified | N/A |

**Resolution:** The JSON spec strategy is correct. It maximizes dice reaching 1, thus maximizing additional successes. It is strictly optimal for the player.

**Traceability:** `sword-engine-spec.json → Traceability.entries[CORE-006]`

### CONFLICT-002: Armor Skill Penalty Formula (was AMB-003)

**Question:** How exactly does armor interact with skill checks? The PDF marks certain skills with a superscript "A" but the original JSON spec did not model this.

**Resolution:** Armor protezione is the penalty magnitude on armorPenalized skills (archi, atletica, furtivita, manualita). Four armor pregi each reduce the penalty by 2 (min 0) for their specific skill:

| Pregio | Skill | Reduction |
|--------|-------|:---------:|
| agile | Atletica | -2 |
| da_arciere | Archi | -2 |
| da_geniere | Manualita | -2 |
| furtiva | Furtivita | -2 |

**Formula:** `armorSkillPenalty = max(0, protezione - armorPregiReduction_for_skill)`

The penalty is independent from encumbrance penalties — they stack. Spirito can cancel the combined penalty 1-for-1.

**Sources:** PDF pp.54-57 (skill descriptions with superscript A), pp.128-129 (armor pregi).

**Traceability:** `sword-engine-spec.json → Traceability.entries[EQUIP-007]`

---

## 15. Open Ambiguities

Issues flagged during specification that require future clarification or design decisions.

### AMB-001: Discard Selection Agency

**Question:** When discarding dice from extra dice, must the player always discard the highest, or is it truly free choice?

- PDF says "scartare un risultato a scelta" (discard a result of choice).
- `sword-system.md` says "normalmente il piu alto" (normally the highest).
- JSON spec says "Player may discard one rolled die per extra die" without mandating which.

**Current resolution:** Player-chosen with auto-highest as the default strategy in UI.

**Traceability:** `sword-engine-spec.json → Traceability.entries[CORE-004]`

### AMB-002: Valore Activation Timing

**Question:** How does Valore activation interact with the modifier pipeline?

- PDF says activation is only permitted "dopo aver lanciato i dadi per la prova e non aver fallito il tiro" (after rolling and not failing the roll-under).
- The engine's modifier pipeline applies modifiers unconditionally in Step 7.

**Current resolution:** The adapter must gate Valore activation on `basePassed == true` before feeding the bonus into the engine. If the roll-under fails, the Valore is not activated and the 3 Spirito cost is not spent.

**Traceability:** `sword-engine-spec.json → Traceability.entries[CORE-018]`

### ~~AMB-003: Armor Skill Penalties~~ → Resolved (see CONFLICT-002 in Section 14)

### AMB-004: Reactions and Combined Maneuvers

**Question:** Can combined maneuvers be used on reactive actions?

- PDF p.85 explicitly states: "Non e possibile potenziare una Reazione con una manovra combinata."
- The JSON spec does not mention reactions at all.

**Current resolution:** Adapter-level validation must block combined maneuvers on reactions. Flagged as a PDF-only rule.

**Traceability:** `sword-engine-spec.json → Traceability.entries[CORE-024]`

### AMB-005: Extra-Dice Discard — Optional, Not Mandatory

**Question:** Must the player always discard exactly one die per extra die, or is discarding optional?

- PDF says "scartare un risultato **a scelta**" — discard a result of choice, not "must discard".
- When keeping extra dice still passes the check (sum ≤ characteristic), those extra 1s contribute additional successes.

**Resolution:** Discarding is optional. The engine's smart auto-discard keeps all dice when sum fits, otherwise discards highest non-1 values first stopping as soon as sum fits. Validation relaxed from `== extraDice` to `<= extraDice`. Adapters pass `discardIndices: null` (smart auto). Manual UI remains pending.

### ~~AMB-006: Combined Maneuver Adapter Flow~~ → Resolved (implemented)

**Question:** How should the correlated-skill workflow be surfaced in dialogs (including Spirito/Fatica costs and reaction restrictions)?

**Resolution:** Implemented in sword-roll.mjs (skill checks) and sword-attack.mjs (attacks). Dialog shows correlated skill dropdown (grade ≥ 1 skills only), cost source selector (Spirito/Fatica), cost hint (normal vs combat). Defense dialogs excluded per reaction restriction (CORE-024). Engine receives effectiveGrade = base + correlated; adapter handles resource deductions.

### ~~AMB-007: Language Progression Automation~~ → Resolved (implemented)

**Question:** Should language gains from Mens/skill progression be computed automatically in actor derived data?

**Resolution:** Implemented. Language slots computed in `prepareDerivedData()` step 12:
- Base: 1 (native language)
- +mod(Mens) if positive (PDF p.61, line 869)
- +1 per even grade of Usi e costumi (grade 2, 4, 6) (PDF line 1196)
- +1 ancient language per even grade of Arti liberali (2→Latin, 4→Greek, 6→Hebrew/Aramaic) (PDF line 1128)
- +1 if Meticcio culture trait (PDF line 972)

Character sheet displays language tags with add/remove, slot count (X/Y), and over-limit warning.

### AMB-008: Talent Special-Effect Runtime Coverage

**Question:** How should the large set of `special` talent effects be executed consistently at runtime?

- Talent data defines many `special` effects (and some contextual modifiers) that require dedicated flow hooks.
- Current implementation executes only a subset of talent effect types directly in roll/combat/derived pipelines.

**Current resolution:** Tracked as implementation gap. Priority is to migrate `special` effects into explicit executable handlers with tests per effect key.

---

## 15b. Orders (Ordini)

`[TODO]` — PDF pp.156-175. Three prestige progression paths available to characters during play. Not yet specified or implemented.

### Milites (Fighters' Order)
PDF pp.157-163. Military brotherhood with three **combat guards** (stances) and the **Gloria** mechanic (accumulated renown). Guards modify attack/defense profiles; Gloria enables special battlefield actions. Requires combat skill grade ≥ 4 to join.

### Clerici (Clergy Order)
PDF pp.163-169. Religious vocation with **Vocazione** (calling), **Ecumene** (authority within the Church), and 9 **Crisma** choices (sacramental powers). Requires Teologia grade ≥ 3 to join.

### Vagantes (Wanderers' Order)
PDF pp.169-175. Traveling order with **Apolide** (stateless benefits), **Risorse nascoste** (hidden resources), **Stella polare** (navigation), **Ultima Thule** (exotic knowledge), and **Via della Seta** (trade routes). Requires 3+ contacts in different regions to join.

---

## Appendix A: File Inventory

| File | Role | Status |
|------|------|--------|
| `sword-engine-spec.json` | Machine-readable specification (EngineCore + FoundryAdapter + Traceability + ReferenceMapping) | Active — source of truth for implementation |
| `sword-rules-spec.md` | This file — human-readable English specification | Active — source of truth for understanding |
| `Il Tempo della Spada 1.0.pdf` | Original Italian rulebook | Reference — authoritative for rules not yet specified |
| `sword/` | Foundry VTT v13 system implementation | Active — MVP |
| `sword/system.json` | Foundry v13 manifest | Implemented |
| `sword/module/engine/sword-check.mjs` | Pure 9-step check pipeline (zero Foundry deps) | Implemented — 8/8 test cases pass |
| `sword/module/data/actor.mjs` | TypeDataModel: schema + prepareDerivedData + PE computation | Implemented |
| `sword/module/sheets/character-sheet.mjs` | ActorSheetV2 character sheet | Implemented |
| `sword/module/rolls/sword-roll.mjs` | Roll adapter: dialog + engine + chat card | Implemented |
| `sword/module/apps/creation-wizard.mjs` | 8-step character creation wizard (ApplicationV2) | Implemented |
| `sword/module/main.mjs` | Entry point: init hook | Implemented |
| `sword/test/engine-test.mjs` | Standalone Node.js engine tests | Implemented |
| `docs/archive/sword-check-spec.json` | Original authoritative check mechanic JSON (absorbed into engine spec) | Archived |
| `docs/archive/sword-system.md` | Italian plain-language technical rules (absorbed into engine spec) | Archived |
| `docs/archive/implementation-references.md` | Architectural reference repos (absorbed into engine spec ReferenceMapping) | Archived |
| `docs/archive/2026-02-15-TDS-prompt.md` | Original compiler meta-prompt (fulfilled) | Archived |

## 16. Bestiary (Bestiario)

`[IMPLEMENTED]` — PDF Chapter 11, pp. 204–225. 39 creature stat blocks in bestiary.mjs, CreatureDataModel, creature sheet, "Bestiario" compendium pack. 2358 tests passing.

### 16.1 Creature Statistics Rules (PDF pp. 204–205)

Creature stats follow PC format with these differences:
- **Abilità base** (base abilities): listed as fixed successes. Unlisted = 1.
- **Abilità** (skills): fixed successes per skill.
- Creatures use fixed Forza successes (not Atletica) for initiative recovery (Rifiatare).
- **Attacks**: primary attack listed first; Misura in parentheses. Natural weapon attacks can be used at lower Misura without penalty.
- **Rango**: indication for balancing encounters. Also a Riflessi reserve (bonus Riflessi = rango value) spent before real Riflessi.

**Size categories:**
- **Piccola** (< 1m): Only 4 wound levels (graffi, gravi, critiche, mortali — no leggere; gravi penalty = -1, critiche = -2, mortali = -3). Hard to spot/hit: -1 success penalty to Percezione and ranged attacks against them.
- **Media** (~human): No modifiers.
- **Grande** (2–4× human): Ranged attacks against them get +1 bonus success. Damage calculation: wounds inflicted = damage × net successes (e.g., +3B with 3 net successes = 9 wounds).
- **Enorme** (4m+): Ranged attacks +2 bonus success, melee +1 bonus success, Percezione +1 to spot. Also calculate wounds as Grande. Cannot lose Riflessi from defense; defense net successes reduce attacker's damage like a Reaction.

**Rango table:**

| Rango | PE | Examples |
|-------|-----|---------|
| 1 | 0 | Lupo, morto vivente |
| 2 | 25 | Palafreno, mastino, cinghiale |
| 3 | 50 | Destriero, orso |
| 4 | 75 | Leone, basilisco, arpia, folletto |
| 5 | 100 | Grifone, ghoul |
| 6 | 125 | Manticora, ritornato, elefante |
| 7 | 150 | Viverna |
| 8 | 175 | Gigante |
| 10 | 225 | Demone del sottosuolo |
| 12 | 275 | Giovane drago |
| 15 | 350 | Demone dell'acqua |
| 16 | 375 | Drago adulto |

**Potenziare le creature** (each +1 rango, pick one):
- **Aggressiva**: +1 success to Forza, weapon skills, and Lotta
- **Combattiva**: additional attack as free action
- **Massiccia**: +1 wound capacity in every level
- **Rapida**: +1 success to Agilità, +2 Riflessi, +1 Movimento
- **Terrificante**: all Reactions caused by creature's attacks/advantages get +1 threat

### 16.2 Creature Size Rules (PDF lines 5284-5293)

**Piccola (Small):** Percezione checks to spot and ranged attacks against them have **-1 success penalty**.

**Grande (Large):** Damage is **multiplicative**: weapon damage × net successes (not additive). Ranged attacks against them get **+1 success bonus**. [TODO — not implemented in combat engine]

**Enorme (Enormous):** Damage is multiplicative like Grande. Defense against them **does not reduce attacker's Riflessi** — net defense successes instead reduce the defender's own Riflessi cost (like a Reaction). Ranged +2 bonus, melee +1 bonus, Percezione +1 to spot. [TODO — not implemented in combat engine]

**Rango as Riflessi reserve** (PDF lines 5292-5293): A creature's Rango value serves as a **bonus Riflessi pool** for paying Reactions and dodges during combat. Once spent, it can be recovered with an attesa (wait) action. [TODO — not implemented in combat engine]

### 16.3 Creature Enhancement (Potenziare) (PDF lines 5330-5337)

Five enhancement templates add +1 Rango each:
- **Aggressiva**: +1 skill success on attacks
- **Combattiva**: +1 Protection
- **Massiccia**: +2 wound capacity per level
- **Rapida**: +1 success to Agilità, +2 Riflessi, +1 Movimento
- **Terrificante**: opponents must pass Risolutezza or suffer -1 success

### 16.4 Advantages (Vantaggi) — PDF pp. 205–207

| Advantage | Effect |
|-----------|--------|
| **Afferrare** | On hit, creature grabs; victim must Reaction Forza vs creature's Forza. Fail by 2+: dragged to ground, can't defend next attack. Flying: ghermire (snatch + carry). 2 sizes larger: inghiottire (swallow — no Protection, -2 success penalty, attack only with bare hands at Misura Stretta). |
| **Aura infernale** (1/2/3) | Tangible aura at 5/10/15m. Interacts with Fides/Impietas: allied creatures with Impietas or lower Aura get bonus; others compare Fides vs Aura level for penalty/bonus. Demon's Impietas = Aura level. |
| **Aura letale** (N) | Deadly aura. Reaction Forza vs N successes at start of each turn for all within range. Each unresisted success = 1 wound ignoring Protection. |
| **Fascinazione** (sense, N) | Action to activate; affects all who can see/hear creature. Reaction Volontà vs creature's Volontà (N fixed successes). Sight: can look away (-2 success penalty to combat). Hearing: can cover ears (+2 to Reaction). Effects by unresisted successes: 1=stordimento (-1 penalty, 1d6 hours), 2=richiamo (drawn toward creature) or sonno (sleep 1d6 hours), 3+=fascinazione (charmed, obey with -1 penalty). Resisting grants immunity to same species for 1 day. |
| **Ferocia** | Reduce wound penalties by 1. |
| **Immunità al freddo/fuoco** | Immune to natural and magical cold/fire damage. |
| **Immunità ai danni mondani** | Immune to non-magical weapons and threats. Also immune to natural poisons and diseases. |
| **Immunità a veleni e malattie** | Immune to all non-magical poisoning and disease. |
| **Incorporeo** | No physical body. Attacks can't be parried with mundane weapons. Creature levitates, passes through barriers, silent. When resting (Rifiatare), recovers Riflessi = Volontà successes. No anatomy, ignores targeted attacks. Uses Agilità instead of Lotta for contact abilities. |
| **Invisibilità** | Can turn invisible at will as free action, indefinitely. Anyone fighting invisible creature: -3 success penalty to all attacks, defense against it. |
| **Mente vacua** | Mind is unassailable. Auto-wins any Reaction, confronto, or check of Volontà. Never loses Riflessi or other resources from mental effects. |
| **Non vita** | Not truly alive. No pain, hunger, fatigue. Ignores all penalties from wound and fatigue levels. |
| **Ostacolare** (Reaction type, N, range) | Creature's presence obstructs. Effects by unresisted successes (cumulative): 1=-1 success and Movement penalty, 2=every action costs 3 Riflessi, 3=lose 1d6 Fatica, 4+=immobilized (no actions or defense). |
| **Paura** (N) | Terrifying appearance. Reaction di Paura vs N successes. Succeeds: no effect. Fails: results per unresisted successes (fear/paralysis). |
| **Scatto fulmineo** | Spend 1 Fatica: double Movement for the turn, can disengage from melee without provoking free attacks. |
| **Senso affinato** | One highly developed sense. +1 success bonus to resist Furtività and to detect hidden creatures. |
| **Sfuggente** | Extraordinary evasion. Dodge (Agilità) gets +1 success bonus; ranged defense gets +2 success bonus. |
| **Sguardo letale** (type) | Gaze attack: action to use, observe target, Reaction Volontà vs creature's Volontà fixed successes. Range 15m. Can declare not to look (-3 penalty to all actions against creature). Resisting grants immunity to same species for 1 day. Types: **confusione** (-3 penalty for hours = unresisted successes), **morte** (3 wounds per unresisted success, ignoring Protection). Only affects humans, animals, fey. Creatures with Sguardo letale are immune to others'. |
| **Terzo occhio** | With a glance, recognizes Valori of sentient beings, detects magic, sees through illusions. |
| **Tocco fatato** | Creature's attacks are magical. Natural attacks damage creatures with Immunità ai danni mondani. |
| **Travolgere** | Charge attack gets +2 damage (instead of normal +1). If mountable, applies to mounted charge too. |
| **Vista notturna** | Can see in low/no light. Percezione checks in darkness without penalty. |

### 16.5 Disadvantages (Svantaggi)

| Disadvantage | Effect |
|--------------|--------|
| **Notturno** | Daylight gives -1 success penalty to all actions. |
| **Terrore del sole** | Sunlight physically damages. In addition to Notturno penalty, must Reaction Paura vs sunlight; auto-wounded without Protection each turn. Threat by light intensity: dim=3 successes/1 wound, soft=4/2 wounds, full=5/3 wounds per turn. |
| **Vincolo** | Magically bound to a place/object/person. Cannot move farther than 100m × Volontà successes. Beyond: loses 1 wound + 1 Fatica per turn (no Protection). |

### 16.6 Creature Stat Blocks

The full stat blocks for all 39 creatures ship as the **bestiary compendium pack** (`packs/bestiary`), generated from the engine's creature data. Import the pack in Foundry to browse them, or see the `@federicomorando/sword-engine` package (`data/bestiary`) for the machine-readable definitions. Each entry follows the format in §16.1 and draws on the advantages/disadvantages listed in §16.4–16.5.

## Appendix B: Known Limitations

| Item | Status | Notes |
|------|--------|-------|
| Artigiano/Professione named specialty | `[IMPLEMENTED]` | Schema fields `specialty` + `specialtyChar` on skill data, creation wizard inline inputs, character sheet display + edit dialog, all roll flows use stored characteristic as default. |
| Carovaniere movement penalty reduction | Hint only | "Ignore 1 movement penalty from terrain/climate" — narrative/GM-adjudicated, displayed as character-tab hint. No mechanical automation (movement penalties are not system-tracked). |
| Focus: multiple foci as success bonus | By design | PDF §7.1 line 3484 says "un successo bonus per ogni focus applicabile" but the example on line 3485 says "2 dadi extra (uno per focus)". Self-contradictory text; spec and code follow the example (each focus = +1 extra die). Could revisit if official errata clarifies. |
| Fiore della cavalleria: Valore extension | Deferred | PDF says "Con un Valore in gioco, il bonus si estende ai compagni che lo condividono". Current implementation is a self-opt-in checkbox (+1 success). The Valore-conditioned group extension would require coupling formation bonus to the Valore activation flow across multiple actors in real time — complex for an edge case. |
| Compagni fedeli: animal pregio | Deferred | PDF says "Qualsiasi animale possediate riceve un pregio aggiuntivo". Current PE spending action tracks investment but does not modify creature actors. Requires a companion-link mechanism (character → creature actor) that the system does not yet support. |

## Appendix B2: Engine Extraction Status

Game logic that has been extracted from the Foundry adapter layer into pure engine functions (zero Foundry deps, testable in Node.js):

| Domain | Engine function | Source | Status |
|--------|----------------|--------|--------|
| Culture bonuses | `computeCultureBonuses()` | sword-combat.mjs | `[DONE]` Extracted from actor.mjs prepareDerivedData |
| Fatigue levels | `computeFatigueLevel()` | sword-combat.mjs | `[DONE]` Extracted from actor.mjs; creature.mjs still uses inline (different model: explicit thresholds) |
| Talent effects | `collectTalentDerivedEffects()` | sword-combat.mjs | `[DONE]` Extracted from actor.mjs (extraDice, resources, specials, flags) |
| Talent choices | `computeTalentChoiceExtraDice()` | sword-combat.mjs | `[DONE]` Extracted from actor.mjs (Determinazione/Eponimo/Ingegno) |
| Wound capacities | `computeWoundCapacities()` | sword-combat.mjs | `[DONE]` Extended with cultureBonus param for Guerresca |

### Possible future extractions

| Domain | Current location | Notes |
|--------|-----------------|-------|
| Rest/recovery | character-sheet.mjs `#onRest` (~200 lines) | Condition penalties, fatica/wound/spirito recovery formulas — could become `computeRestOutcome()` |
| Meditation | character-sheet.mjs `#onMeditate` (~140 lines) | Spirito recovery check — could become `computeMeditationOutcome()` |
| Fattucchiere | character-sheet.mjs `#onFattucchiere` (~120 lines) | Fake magic defense check — could become engine function or roll module |
| Valore post-processing | sword-roll.mjs, sword-attack.mjs, sword-sfida.mjs (duplicated in 3 files) | `finalSuccesses` recomputation with valore bonus + ambi-002 rule — could be added to check engine pipeline |
| Resource batching | sword-attack.mjs (3 separate actor.update calls) | Pesante + extra attack + action consumption — could batch into single update |

## Appendix C: Architectural References

7 reference repositories for Foundry VTT implementation patterns. Full details in `sword-engine-spec.json → ReferenceMapping`.

| Reference | Used For |
|-----------|----------|
| Year Zero Universal Roller (YZUR) | Roll class abstraction, dice post-processing, chat card templates |
| FitD Roller | Dice pool dialog UI, macro API, settings-driven limits |
| Blades in the Dark (legacy) | Roll handler structure, chat integration |
| Blades in the Dark (maintained) | Modern Foundry v12+ conventions |
| Forbidden Lands | Full system architecture, modifier layering, packaging |
| Open Legends | Modern system template patterns |
| Foundry VTT Wiki | system.json manifest structure |
