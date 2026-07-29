# TdS4Foundry — SwORD system for Foundry VTT

A [Foundry VTT](https://foundryvtt.com/) game system implementing the **mechanics**
of the tabletop RPG *Il Tempo della Spada* (SwORD system): check resolution,
combat, sfide, ars oratoria, contacts, interludes, character creation and
progression, talents, equipment, and a bestiary.

## Installation

In Foundry VTT → **Game Systems → Install System**, paste this manifest URL:

```
https://github.com/federicomorando/TdS4Foundry/releases/latest/download/system.json
```

## What's included / not included

This project ships **game mechanics** and original **English** rule
specifications only. It does **not** include the copyrighted game text, images,
or setting of the *Il Tempo della Spada* rulebook. Compendium entries carry
mechanical stats with original English descriptions; short Italian terms are
kept as functional labels (skills, characteristics, talent and creature names).

Repository layout:

- `sword/` — the Foundry system (data models, sheets, combat, rolls, compendium packs)
- `sword/module/engine.mjs` — bundled [`@federicomorando/sword-engine`](https://www.npmjs.com/package/@federicomorando/sword-engine) (pure rules engine)
- `sword-rules-spec.md` / `sword-engine-spec.json` — the English rules specification

## Attribution

SwORD Foundry system by **Federico Morando** — https://github.com/federicomorando/TdS4Foundry.
Implements the mechanics of *Il Tempo della Spada* (© **Acheron**,
https://www.acheron.it/il-tempo-della-spada-gdr/); game text, images and setting
are not included.

The rulebook *Il Tempo della Spada* is copyright-protected and published by
Acheron. To play, you will want the original rulebook for the game's text and
setting; this system provides only the mechanics and tooling.

## License

[GNU Affero General Public License v3.0 or later](LICENSE). See also `NOTICE`.
