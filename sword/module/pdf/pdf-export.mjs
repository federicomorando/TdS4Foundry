/**
 * PDF export adapter for Foundry VTT.
 * Loads template PDF, fills fields via pdf-lib, triggers browser download.
 */

import { buildPdfPayload } from "./pdf-mapper.mjs";

/**
 * Convert a live Foundry actor into a plain object suitable for the mapper.
 * Handles Collection→Array conversion and synthesizes talent items from derived data.
 */
function buildActorExport(actor) {
  const data = {
    name: actor.name,
    img: actor.img,
    system: foundry.utils.deepClone(actor.system),
    items: Array.from(actor.items).map(i => ({
      type: i.type,
      name: i.name,
      system: foundry.utils.deepClone(i.system)
    }))
  };

  // Inject pe.spent from derived data (mapper expects it)
  if (data.system.pe && data.system.pe.spent == null) {
    data.system.pe.spent = actor.system.pe?.spent ?? 0;
  }

  // Synthesize talent pseudo-items from derived system.talents
  if (actor.system.talents) {
    const talentItems = Object.values(actor.system.talents)
      .filter(t => t.unlocked)
      .map(t => ({ type: "talent", name: t.name, system: {} }));
    data.items.push(...talentItems);
  }

  return data;
}

/**
 * Export a character actor as a filled PDF.
 * @param {Actor} actor - Foundry Actor document (type: character)
 */
export async function exportCharacterPDF(actor) {
  const name = actor.name || "character";
  const safeName = name.replace(/[<>:"\/\\|?*]+/g, "_").trim() || "character";

  try {
    ui.notifications.info(`Esportazione PDF di ${name}…`);

    // Dynamically import pdf-lib (lazy load, ~350KB)
    const { PDFDocument, PDFHexString, PDFName } = await import("./vendor/pdf-lib.min.mjs");

    // Load field map
    const fieldMapResp = await fetch("systems/sword/module/pdf/pdf-field-map.json");
    if (!fieldMapResp.ok) throw new Error(`Impossibile caricare la mappa dei campi (${fieldMapResp.status})`);
    const pdfFieldMap = await fieldMapResp.json();

    // Load blank template PDF
    const templateResp = await fetch("systems/sword/assets/TdS-scheda-editabile.pdf");
    if (!templateResp.ok) throw new Error(`Impossibile caricare il template PDF (${templateResp.status})`);
    const templateBytes = await templateResp.arrayBuffer();

    // Build actor data and compute field values
    const actorData = buildActorExport(actor);
    const payload = buildPdfPayload(actorData, pdfFieldMap);

    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    // Tell PDF viewers to regenerate appearances from DA + V on open.
    // This lets the viewer use the template's original embedded fonts
    // (InkFree, ComicSansMS-Italic, Helvetica) and alignment (/Q) settings.
    const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
    acroForm.set(PDFName.of("NeedAppearances"), pdfDoc.context.obj(true));

    for (const [fieldName, value] of Object.entries(payload)) {
      if (!value) continue;
      try {
        const field = form.getTextField(fieldName);
        // Set value directly — bypass pdf-lib's setText() which regenerates
        // appearance streams with degraded font/alignment
        field.acroField.setValue(PDFHexString.fromText(String(value)));
        // Remove stale blank-template AP so the viewer renders fresh from DA + V
        for (const widget of field.acroField.getWidgets()) {
          widget.dict.delete(PDFName.of("AP"));
        }
      } catch (e) {
        console.warn(`PDF campo "${fieldName}":`, e.message);
      }
    }

    // Do NOT flatten — keep form editable with original template styling

    // Generate PDF bytes and trigger download (matches Foundry's saveDataToFile pattern)
    const pdfBytes = await pdfDoc.save();
    const file = new File([pdfBytes], `${safeName}.pdf`, { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = `${safeName}.pdf`;
    a.click();

    ui.notifications.info(`PDF esportato: ${safeName}.pdf`);
  } catch (err) {
    console.error("PDF export failed:", err);
    ui.notifications.error(`Esportazione PDF fallita: ${err.message}`);
  }
}
