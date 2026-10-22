const ExcelJS = require("exceljs");

const RECORD_COLUMNS = [
  ["uniqueId", "Unique ID", 18],
  ["branch", "Branch", 20],
  ["workflowStatus", "Workflow Status", 20],
  ["createdBy", "Created By", 20],
  ["createdAt", "Last Updated", 24],
  ["assignTo", "Assigned Reviewer", 22],
  ["approvalStatus", "Reviewer Status", 18],
  ["reviewedBy", "Reviewed By", 20],
  ["reviewedAt", "Reviewed At", 24],
  ["jobStatus", "Banking Status", 18],
  ["processedBy", "Banking Approver", 22],
  ["processedAt", "Banking Approved At", 24]
];

function uniqueFieldHeaders(fields) {
  const counts = new Map(RECORD_COLUMNS.map(([, header]) => [header, 1]));
  return fields.map((field) => {
    const label = String(field.label || field.key);
    const count = (counts.get(label) || 0) + 1;
    counts.set(label, count);
    return count === 1 ? label : `${label} (${count})`;
  });
}

async function createTenderExcel({ records, fields }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tender & Bank Guarantee Management";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Tender Records", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  const fieldHeaders = uniqueFieldHeaders(fields);
  const columns = [
    ...RECORD_COLUMNS.map(([key, header, width]) => ({ key, header, width })),
    ...fields.map((field, index) => ({
      key: `field_${field.key}`,
      header: fieldHeaders[index],
      width: Math.min(36, Math.max(16, fieldHeaders[index].length + 2))
    }))
  ];
  worksheet.columns = columns;
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length }
  };
  worksheet.getRow(1).height = 30;
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF12335B" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  for (const record of records) {
    const data = record.formData;
    const row = {
      uniqueId: record.uniqueId || "",
      branch: data.branch || "",
      workflowStatus: record.status || "",
      createdBy: record.createdBy || "",
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt || ""),
      assignTo: data.assignTo || "",
      approvalStatus: data.approvalStatus || "",
      reviewedBy: data.reviewedBy || "",
      reviewedAt: data.reviewedAt || "",
      jobStatus: data.jobStatus || "",
      processedBy: data.processedBy || "",
      processedAt: data.processedAt || ""
    };
    for (const field of fields) row[`field_${field.key}`] = data[field.key] ?? "";
    worksheet.addRow(row);
  }
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { createTenderExcel, uniqueFieldHeaders };
