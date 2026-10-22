const fs = require("node:fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const COLORS = {
  navy: rgb(0.035, 0.137, 0.286),
  blue: rgb(0.09, 0.412, 0.824),
  paleBlue: rgb(0.918, 0.953, 0.988),
  row: rgb(0.953, 0.965, 0.98),
  border: rgb(0.78, 0.83, 0.89),
  ink: rgb(0.08, 0.14, 0.23),
  muted: rgb(0.34, 0.41, 0.51),
  white: rgb(1, 1, 1)
};

function fontPaths() {
  const configured = process.env.PDF_FONT_PATH;
  const candidates = [
    configured,
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\segoeui.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function wrapText(text, font, size, maxWidth) {
  const paragraphs = String(text ?? "—").replace(/\r\n?/g, "\n").split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let fragment = "";
      for (const character of word) {
        const candidate = fragment + character;
        if (fragment && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(fragment);
          fragment = character;
        } else {
          fragment = candidate;
        }
      }
      line = fragment;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["—"];
}

function fieldValue(data, field) {
  const value = data[field.key];
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = String(value).split("-");
    return `${day}/${month}/${year}`;
  }
  return String(value);
}

async function createTenderOperationPdf({
  uniqueId,
  data,
  fields,
  generatedBy,
  generatedAt,
  createdBy,
  branch,
  reviewedBy,
  reviewedAt
}) {
  const document = await PDFDocument.create();
  document.setTitle(`Tender and Operation Details - ${uniqueId}`);
  document.setAuthor(String(generatedBy || "Tender Management"));
  document.setSubject("Tender Details and Operation");

  const fontPath = fontPaths();
  let regularFont;
  let boldFont;
  if (fontPath) {
    const fontkit = require("@pdf-lib/fontkit");
    document.registerFontkit(fontkit);
    const fontBytes = fs.readFileSync(fontPath);
    regularFont = await document.embedFont(fontBytes, { subset: true });
    const boldPath = fontPath.toLowerCase().endsWith("arial.ttf")
      ? fontPath.replace(/arial\.ttf$/i, "arialbd.ttf")
      : fontPath;
    boldFont = fs.existsSync(boldPath)
      ? await document.embedFont(fs.readFileSync(boldPath), { subset: true })
      : regularFont;
  } else {
    regularFont = await document.embedFont(StandardFonts.Helvetica);
    boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  }

  const pages = [];
  let page;
  let y;

  function drawBanner(firstPage) {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    page.drawRectangle({
      x: MARGIN,
      y: PAGE_HEIGHT - 76,
      width: 4,
      height: 48,
      color: COLORS.blue
    });
    page.drawText("TENDER & BANK GUARANTEE", {
      x: MARGIN + 22,
      y: PAGE_HEIGHT - 50,
      size: firstPage ? 19 : 16,
      font: boldFont,
      color: COLORS.navy
    });
    page.drawText(firstPage ? "TENDER DETAILS  •  OPERATION" : "DETAILS CONTINUED", {
      x: MARGIN + 23,
      y: PAGE_HEIGHT - 69,
      size: 8.5,
      font: regularFont,
      color: COLORS.muted
    });
    if (firstPage) {
      const reviewedLine = `Reviewed by: ${reviewedBy || "—"}  |  ${reviewedAt || "—"}`;
      wrapText(reviewedLine, regularFont, 6.2, PAGE_WIDTH - MARGIN * 2 - 23).forEach((line, index) => {
        page.drawText(line, {
          x: MARGIN + 23,
          y: PAGE_HEIGHT - 87 - index * 8,
          size: 6.2,
          font: regularFont,
          color: COLORS.muted
        });
      });
    }
    page.drawLine({
      start: { x: MARGIN, y: PAGE_HEIGHT - 94 },
      end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 94 },
      thickness: 0.6,
      color: COLORS.border
    });
    y = PAGE_HEIGHT - 112;
  }

  function ensureSpace(height) {
    if (y - height < 48) {
      drawBanner(false);
      drawReferenceBox();
    }
  }

  function drawEmptyRemarkBox() {
    const boxHeight = 56;
    const headingHeight = 18;
    ensureSpace(boxHeight);
    page.drawRectangle({
      x: MARGIN,
      y: y - boxHeight,
      width: PAGE_WIDTH - MARGIN * 2,
      height: boxHeight,
      color: COLORS.row,
      borderColor: COLORS.border,
      borderWidth: 0.5
    });
    page.drawText("Additional Remark", {
      x: MARGIN + 10,
      y: y - 13,
      size: 7.2,
      font: boldFont,
      color: COLORS.ink
    });
    page.drawLine({
      start: { x: MARGIN, y: y - headingHeight },
      end: { x: PAGE_WIDTH - MARGIN, y: y - headingHeight },
      thickness: 0.45,
      color: COLORS.border
    });
    y -= boxHeight + 8;
  }

  function drawReferenceBox() {
    const boxHeight = 30;
    page.drawRectangle({
      x: MARGIN,
      y: y - boxHeight,
      width: PAGE_WIDTH - MARGIN * 2,
      height: boxHeight,
      color: COLORS.paleBlue,
      borderColor: COLORS.border,
      borderWidth: 0.7
    });
    page.drawText("FORM / REFERENCE NO.", {
      x: MARGIN + 11,
      y: y - 19,
      size: 8,
      font: boldFont,
      color: COLORS.muted
    });
    page.drawText(String(uniqueId || "—"), {
      x: MARGIN + 133,
      y: y - 19,
      size: 10,
      font: boldFont,
      color: COLORS.ink
    });
    y -= boxHeight + 16;
  }

  function drawSection(title, sectionFields) {
    if (!sectionFields.length) return;
    const headingHeight = 23;
    ensureSpace(headingHeight + 30);
    page.drawRectangle({
      x: MARGIN,
      y: y - headingHeight,
      width: PAGE_WIDTH - MARGIN * 2,
      height: headingHeight,
      color: COLORS.blue
    });
    page.drawText(title.toUpperCase(), {
      x: MARGIN + 10,
      y: y - 15,
      size: 9,
      font: boldFont,
      color: COLORS.white
    });
    y -= headingHeight;

    const half = sectionFields.length % 2 ? sectionFields.length + 1 : sectionFields.length;
    const rowCount = half / 2;
    const columnWidth = (PAGE_WIDTH - MARGIN * 2) / 2;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const leftField = sectionFields[rowIndex];
      const rightField = sectionFields[rowIndex + rowCount];
      const labelWidth = columnWidth * 0.39;
      const valueWidth = columnWidth - labelWidth - 14;
      const leftLabel = leftField ? wrapText(leftField.label, boldFont, 7.2, labelWidth - 12) : [];
      const rightLabel = rightField ? wrapText(rightField.label, boldFont, 7.2, labelWidth - 12) : [];
      const leftValue = leftField ? wrapText(fieldValue(data, leftField), regularFont, 8.2, valueWidth) : [];
      const rightValue = rightField ? wrapText(fieldValue(data, rightField), regularFont, 8.2, valueWidth) : [];
      const lineHeight = 10;
      const maxValueLines = Math.max(leftValue.length, rightValue.length, 1);
      for (let lineOffset = 0; lineOffset < maxValueLines; lineOffset += 28) {
        const leftLabels = lineOffset === 0
          ? leftLabel
          : leftField ? wrapText(`${leftField.label} (continued)`, boldFont, 7.2, labelWidth - 12) : [];
        const rightLabels = lineOffset === 0
          ? rightLabel
          : rightField ? wrapText(`${rightField.label} (continued)`, boldFont, 7.2, labelWidth - 12) : [];
        const leftLines = leftValue.slice(lineOffset, lineOffset + 28);
        const rightLines = rightValue.slice(lineOffset, lineOffset + 28);
        const contentLines = Math.max(leftLabels.length, rightLabels.length, leftLines.length, rightLines.length, 1);
        const rowHeight = Math.max(28, contentLines * lineHeight + 10);
        ensureSpace(rowHeight);

        page.drawRectangle({
          x: MARGIN,
          y: y - rowHeight,
          width: PAGE_WIDTH - MARGIN * 2,
          height: rowHeight,
          color: rowIndex % 2 === 0 ? COLORS.row : COLORS.white,
          borderColor: COLORS.border,
          borderWidth: 0.45
        });
        page.drawLine({
          start: { x: MARGIN + columnWidth, y },
          end: { x: MARGIN + columnWidth, y: y - rowHeight },
          thickness: 0.55,
          color: COLORS.border
        });
        for (const offset of [0, columnWidth]) {
          page.drawLine({
            start: { x: MARGIN + offset + labelWidth, y },
            end: { x: MARGIN + offset + labelWidth, y: y - rowHeight },
            thickness: 0.45,
            color: COLORS.border
          });
        }
        for (const [field, labelLines, valueLines, offset] of [
          [leftField, leftLabels, leftLines, 0],
          [rightField, rightLabels, rightLines, columnWidth]
        ]) {
          if (!field) continue;
          const topTextY = y - 10;
          labelLines.forEach((line, index) => page.drawText(line, {
            x: MARGIN + offset + 7,
            y: topTextY - index * lineHeight,
            size: 7.2,
            font: boldFont,
            color: COLORS.ink
          }));
          valueLines.forEach((line, index) => page.drawText(line, {
            x: MARGIN + offset + labelWidth + 7,
            y: topTextY - index * lineHeight,
            size: 8.2,
            font: regularFont,
            color: COLORS.ink
          }));
        }
        y -= rowHeight;
      }
    }
    y -= 16;
  }

  function drawFullWidthField(title, value) {
    const contentWidth = PAGE_WIDTH - MARGIN * 2 - 20;
    const lines = wrapText(value, regularFont, 8.2, contentWidth);
    const maxLinesPerBlock = 48;
    for (let lineOffset = 0; lineOffset < lines.length; lineOffset += maxLinesPerBlock) {
      const blockLines = lines.slice(lineOffset, lineOffset + maxLinesPerBlock);
      const label = lineOffset === 0 ? title : `${title} (continued)`;
      const labelLines = wrapText(label, boldFont, 7.2, contentWidth);
      const rowHeight = labelLines.length * 9 + blockLines.length * 11 + 16;
      ensureSpace(rowHeight);
      page.drawRectangle({
        x: MARGIN,
        y: y - rowHeight,
        width: PAGE_WIDTH - MARGIN * 2,
        height: rowHeight,
        color: COLORS.row,
        borderColor: COLORS.border,
        borderWidth: 0.5
      });
      let textY = y - 12;
      labelLines.forEach((line) => {
        page.drawText(line, {
          x: MARGIN + 10,
          y: textY,
          size: 7.2,
          font: boldFont,
          color: COLORS.ink
        });
        textY -= 9;
      });
      textY -= 2;
      blockLines.forEach((line) => {
        page.drawText(line, {
          x: MARGIN + 10,
          y: textY,
          size: 8.2,
          font: regularFont,
          color: COLORS.ink
        });
        textY -= 11;
      });
      y -= rowHeight + 8;
    }
  }

  drawBanner(true);
  drawReferenceBox();
  const tenderFields = fields.filter((field) => field.tab === "Tender Details");
  const operationFields = fields.filter((field) => field.tab === "Operation" && field.key !== "paymentTerm");
  drawSection("Tender & Beneficiary Information", tenderFields);
  drawSection("Operation Details", operationFields);
  const paymentTermField = fields.find((field) => field.key === "paymentTerm");
  if (paymentTermField) drawFullWidthField(paymentTermField.label, fieldValue(data, paymentTermField));
  drawEmptyRemarkBox();

  pages.forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: MARGIN, y: 35 },
      end: { x: PAGE_WIDTH - MARGIN, y: 35 },
      thickness: 0.5,
      color: COLORS.border
    });
    currentPage.drawText(`Created by ${String(createdBy || "—")}  •  Branch ${String(branch || "—")}`, {
      x: MARGIN,
      y: 45,
      size: 6.5,
      font: regularFont,
      color: COLORS.muted
    });
    currentPage.drawText(`Generated by ${String(generatedBy || "Approver")}  •  ${generatedAt}`, {
      x: MARGIN,
      y: 22,
      size: 7,
      font: regularFont,
      color: COLORS.muted
    });
    currentPage.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: PAGE_WIDTH - MARGIN - 52,
      y: 22,
      size: 7,
      font: regularFont,
      color: COLORS.muted
    });
  });

  return Buffer.from(await document.save());
}

module.exports = { createTenderOperationPdf };
