import {
  deriveCharacter,
  TALENT_DEFS, TALENT_CATEGORIES, checkTalentUnlocked, countTalentProgress,
  BASE_SKILLS, CETO_SKILLS, SKILL_MAP, SOCIAL_SKILLS, peGradeCost
} from "../engine.mjs";

export { TALENT_DEFS, TALENT_CATEGORIES, checkTalentUnlocked, countTalentProgress };
export { BASE_SKILLS, CETO_SKILLS, SKILL_MAP, SOCIAL_SKILLS, peGradeCost };

export class CharacterDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;

    const charField = () =>
      new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 5,
        max: 13,
        initial: 7
      });

    const skillField = () =>
      new fields.SchemaField({
        grade: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          max: 6,
          initial: 0
        }),
        baseGrade: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          max: 6,
          initial: 0
        }),
        isMestiere: new fields.BooleanField({ initial: false }),
        hasFocus: new fields.BooleanField({ initial: false }),
        focusCount: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          initial: 0
        }),
        foci: new fields.ArrayField(
          new fields.SchemaField({
            name: new fields.StringField({ required: true, blank: false })
          }),
          { initial: [] }
        ),
        extraDice: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          initial: 0
        }),
        specialty: new fields.StringField({ required: false, blank: true, initial: "" }),
        specialtyChar: new fields.StringField({ required: false, blank: true, initial: "" })
      });

    const resourceField = () =>
      new fields.SchemaField({
        value: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          initial: 0
        }),
        max: new fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          initial: 0
        })
      });

    return {
      characteristics: new fields.SchemaField({
        fortitudo: charField(),
        celeritas: charField(),
        gratia: charField(),
        mens: charField(),
        prudentia: charField(),
        audacia: charField()
      }),
      skills: new fields.SchemaField({
        agilita: skillField(),
        alchimia: skillField(),
        archi: skillField(),
        armi_comuni: skillField(),
        armi_corte: skillField(),
        armi_da_guerra: skillField(),
        arte_della_guerra: skillField(),
        arti_arcane: skillField(),
        arti_liberali: skillField(),
        artigiano: skillField(),
        atletica: skillField(),
        autorita: skillField(),
        balestre: skillField(),
        carisma: skillField(),
        cavalcare: skillField(),
        empatia: skillField(),
        forza: skillField(),
        furtivita: skillField(),
        guarigione: skillField(),
        intrattenere: skillField(),
        lotta: skillField(),
        manualita: skillField(),
        mercatura: skillField(),
        percezione: skillField(),
        professione: skillField(),
        raggirare: skillField(),
        ragionamento: skillField(),
        sopravvivenza: skillField(),
        storia_e_leggende: skillField(),
        teologia: skillField(),
        usi_e_costumi: skillField(),
        volonta: skillField()
      }),
      resources: new fields.SchemaField({
        spirito: resourceField(),
        fatica: resourceField(),
        ferite: resourceField(),
        riflessi: new fields.SchemaField({
          value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
          max: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
        })
      }),
      fama: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        max: 6,
        initial: 0
      }),
      ceto: new fields.StringField({
        required: true,
        initial: "popolano",
        choices: ["umile", "popolano", "borghese", "nobile"]
      }),
      money: new fields.SchemaField({
        lire: new fields.NumberField({ required: true, nullable: false, initial: 0, integer: true, min: 0 }),
        soldi: new fields.NumberField({ required: true, nullable: false, initial: 0, integer: true, min: 0 }),
        denari: new fields.NumberField({ required: true, nullable: false, initial: 0, integer: true, min: 0 })
      }),
      pe: new fields.SchemaField({
        total: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        companionSpent: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
      }),
      valori: new fields.SchemaField({
        fides: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, max: 4, initial: 0 }),
        impietas: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, max: 4, initial: 0 }),
        honor: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, max: 4, initial: 0 }),
        ego: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, max: 4, initial: 0 }),
        superstitio: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, max: 4, initial: 0 }),
        ratio: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, max: 4, initial: 0 })
      }),
      woundLevels: new fields.SchemaField({
        graffi: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        leggere: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        gravi: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        critiche: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        mortali: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
      }),
      culture: new fields.SchemaField({
        trait1: new fields.StringField({ initial: "" }),
        trait2: new fields.StringField({ initial: "" }),
        trait3: new fields.StringField({ initial: "" })
      }),
      languages: new fields.ArrayField(new fields.StringField()),
      retaggio: new fields.SchemaField({
        total: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        notes: new fields.StringField({ initial: "" }),
        spiritoBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        riflessiBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        indomito: new fields.BooleanField({ initial: false }),
        affinitaAnimale: new fields.BooleanField({ initial: false }),
        conoscenze: new fields.BooleanField({ initial: false }),
        nomea: new fields.BooleanField({ initial: false }),
        legame: new fields.StringField({ initial: "" }),
        cimelio: new fields.StringField({ initial: "" })
      }),
      tentazione: new fields.StringField({ initial: "" }),
      creationComplete: new fields.BooleanField({ initial: false }),
      // Talent permanent choices (Determinazione: forza/volonta, Eponimo: skill ID, Ingegno: mercatura/teologia/usi_e_costumi)
      talentChoices: new fields.SchemaField({
        determinazione: new fields.StringField({ required: false, nullable: true, initial: null }),
        eponimo: new fields.StringField({ required: false, nullable: true, initial: null }),
        ingegno: new fields.StringField({ required: false, nullable: true, initial: null })
      }),
      // Contacts (Contatti) — PDF §4.10
      contacts: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ required: true, blank: false }),
          profession: new fields.StringField({ initial: "" }),
          settlement: new fields.StringField({ initial: "" }),
          ceto: new fields.StringField({ required: true, initial: "popolano" }),
          familiarita: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
          influenza: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
          skill: new fields.StringField({ initial: "" }),
          notes: new fields.StringField({ initial: "" })
        }),
        { initial: [] }
      )
    };
  }

  prepareDerivedData() {
    const equipment = [];
    if (this.parent?.items) {
      for (const item of this.parent.items) {
        equipment.push({
          weight: item.system.weight || 0,
          quantity: item.type === "gear" ? (item.system.quantity || 1) : 1,
        });
      }
    }

    const derived = deriveCharacter({
      characteristics: this.characteristics,
      skills: this.skills,
      resources: this.resources,
      woundLevels: this.woundLevels,
      valori: this.valori,
      culture: this.culture,
      retaggio: this.retaggio,
      pe: this.pe,
      ceto: this.ceto,
      talentChoices: this.talentChoices,
      equipment,
    });

    for (const [id, data] of Object.entries(derived.skills)) {
      if (!this.skills[id]) continue;
      this.skills[id].focusSlots = data.focusSlots;
      this.skills[id].focusCount = data.focusCount;
      this.skills[id].hasFocus = data.hasFocus;
      this.skills[id].isOutsideCeto = data.isOutsideCeto;
      this.skills[id].extraDice = data.extraDice;
      this.skills[id].nextGradeCost = data.nextGradeCost;
    }

    this.resources.spirito.max = derived.resources.spirito.max;
    this.resources.fatica.max = derived.resources.fatica.max;
    this.resources.ferite.max = derived.resources.ferite.max;
    this.resources.ferite.value = derived.resources.ferite.value;
    this.resources.riflessi.max = derived.resources.riflessi.max;

    this.pe.spent = derived.pe.spent;
    this.pe.available = derived.pe.available;

    this.valori.totalPoints = derived.valori.totalPoints;
    this.valori.maxPoints = derived.valori.maxPoints;
    this.valori.perValueMax = derived.valori.perValueMax;

    this.talents = derived.talents;
    this.talentCount = derived.talentCount;
    this.talentCharBonuses = derived.talentCharBonuses;
    this.talentResourceBonuses = derived.talentResourceBonuses;
    this.talentSpiritFormulas = derived.talentSpiritFormulas;
    this.talentSpecials = new Set(derived.talentSpecials);
    this.talentFlags = new Set(derived.talentFlags);

    this.effectiveCharacteristics = derived.effectiveCharacteristics;
    this.modifiers = derived.modifiers;

    this.eruditaStudyBonus = derived.cultureBonuses.eruditaStudyBonus;
    this.militareQualityEquipment = derived.cultureBonuses.militareQualityEquipment;
    this.hasUrbanaCulture = derived.cultureBonuses.hasUrbanaCulture;

    this.fatiguePenalty = derived.fatiguePenalty;
    this.fatigueLevel = derived.fatigueLevel;
    this.woundCapacities = derived.woundCapacities;
    this.woundPenalty = derived.woundPenalty;

    this.carriedWeight = derived.carriedWeight;
    this.encumbranceBase = derived.encumbranceBase;
    this.encumbranceCategory = derived.encumbranceCategory;
    this.encumbrancePenalty = derived.encumbrancePenalty;
    this.encumbranceMaxWeight = derived.encumbranceMaxWeight;

    this.movimento = derived.movimento;
    this.languageSlots = derived.languageSlots;
  }
}
