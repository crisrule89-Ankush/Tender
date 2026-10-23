const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { once } = require("node:events");
const bcrypt = require("bcryptjs");
const { PDFDocument } = require("pdf-lib");
const ExcelJS = require("exceljs");
const fields = require("../config/form-fields.json");
const { createTenderOperationPdf } = require("../pdf/tender-operation");
const { createTenderExcel, uniqueFieldHeaders } = require("../excel/tender-export");
const { getReferenceLabels, getJobTypeDateLabels, getRequisitionLabels } = require("../public/reference-labels");
const { contrastSafeAppearance, relativeLuminance } = require("../public/appearance");
const {
  app,
  defaultFieldSettings,
  structuredTenderColumns,
  defaultTabAccess,
  isBranchScopedRole,
  normalizeTabAccess,
  getRoleTabAccess,
  resolveUserTabAccess,
  fieldsForRole,
  filterRecordData,
  canAccessRecord,
  canCompleteBanking,
  canReviewRecord,
  isConfiguredApprover,
  canSubmitReview,
  canDownloadTenderOperationPdf,
  tenderExportScope,
  canRejectQueuedRequest,
  isBankingUser,
  indiaTimestamp,
  mergeStoredWorkflowData,
  normalizeWorkflowStatus,
  workflowSummary,
  normalizeTenderFormData,
  toNullableSqlText,
  branchPrefix,
  formatUniqueId,
  includeDefaultDropdownOptions,
  orderReferenceFields,
  repairLegacyReferenceFields,
  defaultAppearance,
  isAdmin,
  isValidDate,
  validateAppearance,
  validateFieldSettings,
  getFieldSettings,
  validateTenderForm,
  verifyPassword
} = require("../server");

function emptyRecord() {
  return Object.fromEntries(fields.map((field) => [field.key, ""]));
}

function optionalSettings() {
  return defaultFieldSettings().map((field) => ({
    ...field,
    required: false,
    ...(field.key === "branch" ? { type: "text" } : {})
  }));
}

test("allows every configured form field to be blank", () => {
  const settings = defaultFieldSettings();
  assert.ok(settings.every((field) => field.required === false));
  assert.deepEqual(
    ["assignTo", "approvalStatus", "jobStatus"].map((key) => {
      const field = settings.find((item) => item.key === key);
      return [field.tab, field.type, field.system];
    }),
    [["Approval", "select", true], ["Approval", "select", true], ["Banking", "select", true]]
  );
  assert.deepEqual(settings.find((field) => field.key === "approvalStatus").options, ["Pending", "Approved", "Not Approved"]);
  assert.deepEqual(settings.find((field) => field.key === "jobStatus").options, ["Pending", "Processed"]);
  assert.equal(validateTenderForm(emptyRecord(), settings), null);
  assert.equal(validateTenderForm(emptyRecord(), optionalSettings()), null);
  const referenceType = defaultFieldSettings().find((field) => field.key === "referenceType");
  assert.deepEqual(referenceType.options, ["NIT Ref No", "LOA No", "WorkOrder No"]);
  const jobType = defaultFieldSettings().find((field) => field.key === "jobType");
  assert.deepEqual(jobType.options, ["Installation", "Maintenance", "Tender"]);
  const requisitionType = defaultFieldSettings().find((field) => field.key === "requisitionType");
  assert.deepEqual(requisitionType.options, [
    "Tender Fees",
    "Processing Fees",
    "Legal & Stationary Charges",
    "Stamp Duty Charges",
    "EMD",
    "PBG",
    "Additional BG",
    "Advanced BG",
    "Extention BG",
    "FDR Renewal"
  ]);
  assert.deepEqual(fields.slice(5, 9).map((field) => field.key), [
    "loNumber",
    "referenceType",
    "referenceNumber",
    "referenceDate"
  ]);
  const legacyOrder = defaultFieldSettings();
  [legacyOrder[6], legacyOrder[7]] = [legacyOrder[7], legacyOrder[6]];
  assert.deepEqual(orderReferenceFields(legacyOrder).slice(5, 9).map((field) => field.key), [
    "loNumber",
    "referenceType",
    "referenceNumber",
    "referenceDate"
  ]);
});

test("adds required default dropdown options while retaining administrator-added options", () => {
  const settings = { type: "select", options: ["Custom option", "EMD"] };
  includeDefaultDropdownOptions(settings, ["Tender Fees", "EMD"]);
  assert.deepEqual(settings.options, ["Tender Fees", "EMD", "Custom option"]);
  const textField = { type: "text", options: [] };
  includeDefaultDropdownOptions(textField, ["Tender Fees"]);
  assert.deepEqual(textField.options, []);
});

test("repairs legacy duplicate reference labels without restoring unrelated deleted fields", () => {
  const legacyFields = defaultFieldSettings().filter((field) =>
    !["department", "referenceType", "referenceNumber"].includes(field.key)
  );
  legacyFields.find((field) => field.key === "loNumber").label = "Reference No";
  legacyFields.push({
    key: "referenceNo",
    label: "Reference No",
    section: "Tender details",
    type: "text",
    required: false,
    options: []
  });

  const repaired = repairLegacyReferenceFields(legacyFields);
  const references = repaired.filter((field) =>
    ["loNumber", "referenceType", "referenceNumber", "referenceDate"].includes(field.key)
  );
  assert.deepEqual(references.map((field) => [field.key, field.label]), [
    ["loNumber", "LO Number"],
    ["referenceType", "Type Of Reference"],
    ["referenceNumber", "Reference No"],
    ["referenceDate", "Reference Date"]
  ]);
  assert.equal(repaired.some((field) => field.key === "referenceNo"), false);
  assert.equal(repaired.some((field) => field.key === "department"), false);

  const intentionallyRemovedField = defaultFieldSettings().filter((field) => field.key !== "referenceType");
  assert.equal(repairLegacyReferenceFields(intentionallyRemovedField).some((field) => field.key === "referenceType"), false);
});

test("adds the new dedicated reference number while retaining the separate LO Number field", () => {
  const oldDefaults = defaultFieldSettings().filter((field) => field.key !== "referenceNumber");
  const repaired = repairLegacyReferenceFields(oldDefaults);
  assert.deepEqual(
    repaired.filter((field) => ["loNumber", "referenceType", "referenceNumber", "referenceDate"].includes(field.key))
      .map((field) => field.key),
    ["loNumber", "referenceType", "referenceNumber", "referenceDate"]
  );
});

test("derives reference number and date labels from the selected reference type", () => {
  assert.deepEqual(getReferenceLabels("NIT Ref No"), {
    numberLabel: "NIT Ref No",
    dateLabel: "NIT Ref Date"
  });
  assert.deepEqual(getReferenceLabels("LOA No"), {
    numberLabel: "LOA No",
    dateLabel: "LOA No Date"
  });
  assert.deepEqual(getReferenceLabels("WorkOrder No"), {
    numberLabel: "WorkOrder No",
    dateLabel: "WorkOrder No Date"
  });
  assert.deepEqual(getReferenceLabels(""), {
    numberLabel: "Reference No",
    dateLabel: "Reference Date"
  });
});

test("derives start and end date labels from Job Type and restores configured labels for Tender", () => {
  const configuredLabels = { startDateLabel: "Start Date", endDateLabel: "End Date" };
  assert.deepEqual(getJobTypeDateLabels("Installation", ...Object.values(configuredLabels)), {
    startDateLabel: "CH Date",
    endDateLabel: "MH Date"
  });
  assert.deepEqual(getJobTypeDateLabels("Maintenance", ...Object.values(configuredLabels)), {
    startDateLabel: "Maintenance period From",
    endDateLabel: "Maintenance period to"
  });
  assert.deepEqual(getJobTypeDateLabels("Tender", ...Object.values(configuredLabels)), configuredLabels);
  assert.deepEqual(
    getJobTypeDateLabels("Other", "Planned Start", "Planned End"),
    { startDateLabel: "Planned Start", endDateLabel: "Planned End" }
  );
});

test("derives requisition field labels while keeping Valid Upto visible", () => {
  const choices = [
    "Tender Fees",
    "Processing Fees",
    "Legal & Stationary Charges",
    "Stamp Duty Charges",
    "EMD",
    "PBG",
    "Additional BG",
    "Advanced BG",
    "Extention BG"
  ];
  for (const choice of choices) {
    assert.deepEqual(getRequisitionLabels(choice), {
      validUptoLabel: "Valid Upto",
      amountLabel: `${choice} Amount`,
      inFormOfLabel: `${choice} In Form of`,
      inFavorOfLabel: `${choice} in favor of`
    });
  }
  assert.deepEqual(
    getRequisitionLabels("", {
      validUptoLabel: "Renewal Date",
      amountLabel: "Guarantee Amount",
      inFormOfLabel: "Guarantee Format",
      inFavorOfLabel: "Payee"
    }),
    {
      validUptoLabel: "Renewal Date",
      amountLabel: "Guarantee Amount",
      inFormOfLabel: "Guarantee Format",
      inFavorOfLabel: "Payee"
    }
  );
  assert.deepEqual(
    getRequisitionLabels("FDR Renewal", {
      validUptoLabel: "Renewal Date",
      amountLabel: "Renewal Amount",
      inFormOfLabel: "Renewal Format",
      inFavorOfLabel: "Renewal Payee"
    }),
    {
      validUptoLabel: "Renewal Date",
      amountLabel: "Renewal Amount",
      inFormOfLabel: "Renewal Format",
      inFavorOfLabel: "Renewal Payee"
    }
  );
});

test("rejects unknown keys but accepts arbitrary date and text values", () => {
  assert.match(validateTenderForm({ ...emptyRecord(), unexpected: "value" }, optionalSettings()), /unknown field/);
  assert.equal(isValidDate("2024-02-29"), true);
  assert.equal(isValidDate("2025-02-29"), false);
  assert.equal(validateTenderForm({ ...emptyRecord(), referenceDate: "not a calendar date" }, optionalSettings()), null);
  assert.equal(validateTenderForm({ ...emptyRecord(), referenceDate: null, beneficiaryIfscCode: "ICIC123" }, optionalSettings()), null);
});

test("accepts free-form number, dropdown, IFSC, and null values", () => {
  const settings = optionalSettings();
  const branch = settings.find((field) => field.key === "branch");
  branch.type = "select";
  branch.options = ["North"];
  assert.equal(validateTenderForm({ ...emptyRecord(), numberOfLifts: "-1.5" }, settings), null);
  assert.equal(validateTenderForm({ ...emptyRecord(), branch: "Unknown branch" }, settings), null);
  assert.equal(validateTenderForm({ ...emptyRecord(), beneficiaryIfscCode: "BAD" }, settings), null);
  assert.equal(validateTenderForm({ ...emptyRecord(), tenderValue: null, bankingAmount: null }, settings), null);
  assert.equal(validateTenderForm({ ...emptyRecord(), beneficiaryIfscCode: "ABCD0123456" }, settings), null);
  const normalized = normalizeTenderFormData({
    branch: null,
    numberOfLifts: -1.5,
    beneficiaryIfscCode: "ICIC123",
    referenceDate: "some date text"
  }, settings);
  assert.equal(normalized.branch, "");
  assert.equal(normalized.numberOfLifts, "-1.5");
  assert.equal(normalized.beneficiaryIfscCode, "ICIC123");
  assert.equal(normalized.referenceDate, "some date text");
  assert.match(normalizeTenderFormData({ beneficiaryName: { unexpected: true } }, settings), /simple text value/);
});

test("keeps configured date fields as optional calendar inputs and maps blank values to SQL NULL", () => {
  const dateFields = defaultFieldSettings().filter((field) => field.type === "date");
  assert.ok(dateFields.length > 0);
  assert.ok(dateFields.every((field) => field.required === false));
  assert.ok(dateFields.every((field) => fields.find((definition) => definition.key === field.key)?.type === "date"));
  assert.equal(toNullableSqlText(""), null);
  assert.equal(toNullableSqlText(null), null);
  assert.equal(toNullableSqlText(undefined), null);
  assert.equal(toNullableSqlText("2026-10-16"), "2026-10-16");
  const appSource = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
  assert.match(appSource, /input\.type = field\.type === "date" \? "date" : "text"/);
  assert.match(appSource, /clearDateButton\.textContent = "Clear date"/);
});

test("validates field definitions while keeping every field nullable", () => {
  const settings = defaultFieldSettings();
  const tenderValue = settings.find((field) => field.key === "tenderValue");
  tenderValue.type = "date";
  tenderValue.required = true;
  const branch = settings.find((field) => field.key === "branch");
  branch.type = "select";
  branch.required = false;
  branch.options = ["Mumbai", "Pune"];

  assert.equal(typeof validateFieldSettings(settings), "object");
  assert.equal(validateFieldSettings(settings).find((field) => field.key === "tenderValue").required, false);
  assert.equal(validateTenderForm(emptyRecord(), settings), null);
  assert.equal(validateTenderForm({ ...emptyRecord(), tenderValue: "not-a-date", branch: "Unknown" }, settings), null);
  assert.equal(validateTenderForm({ ...emptyRecord(), tenderValue: "2026-10-14", branch: "Pune" }, settings), null);

  const customField = {
    key: "customFieldCheck",
    label: "Purchase Order",
    tab: "Operation",
    section: "Commercial details",
    type: "select",
    required: true,
    options: ["Direct", "Framework"]
  };
  const dynamicSettings = [...settings.filter((field) => field.key !== "tenderValue"), customField];
  const dynamicRecord = Object.fromEntries(dynamicSettings.map((field) => [field.key, ""]));
  assert.equal(typeof validateFieldSettings(dynamicSettings), "object");
  assert.equal(validateTenderForm({ ...dynamicRecord, nameOfWork: "Lift upgrade" }, dynamicSettings), null);
  assert.equal(validateTenderForm({ customFieldCheck: "Unknown" }, dynamicSettings), null);
  assert.equal(validateTenderForm({ customFieldCheck: "Framework" }, dynamicSettings), null);
  const reorderedFields = structuredClone(dynamicSettings);
  const customIndex = reorderedFields.findIndex((field) => field.key === "customFieldCheck");
  reorderedFields[customIndex].section = "Updated category";
  reorderedFields.reverse();
  assert.equal(typeof validateFieldSettings(reorderedFields), "object");
  assert.equal(validateFieldSettings(reorderedFields)[0].key, reorderedFields[0].key);
  const optionalNewField = { ...customField, key: "customFieldOptional", required: false };
  assert.equal(validateTenderForm({ ...dynamicRecord, customFieldCheck: "Direct", customFieldOptional: "" }, [...dynamicSettings, optionalNewField]), null);
  assert.match(validateFieldSettings([]), /between 1 and 150 form fields/);
  assert.match(validateFieldSettings([...settings, { ...customField, key: "not-valid-key!" }]), /Field keys/);
  assert.match(validateFieldSettings(settings.filter((field) => field.key !== "branch")), /Branch field must remain/);
  const branchOnBankingTab = structuredClone(settings);
  branchOnBankingTab.find((field) => field.key === "branch").tab = "Banking";
  assert.match(validateFieldSettings(branchOnBankingTab), /Branch must remain/);

  const duplicateOptionSettings = structuredClone(settings);
  duplicateOptionSettings.find((field) => field.key === "branch").options = ["Mumbai", "Mumbai"];
  assert.match(validateFieldSettings(duplicateOptionSettings), /duplicates/);
  assert.equal(isAdmin({ session: { role: "admin" } }), true);
  assert.equal(isAdmin({ session: { role: "user" } }), false);
});

test("limits role fields and record values to configured tab access", () => {
  const settings = defaultFieldSettings();
  const defaultAccess = {
    operation: defaultTabAccess("operation"),
    banking: defaultTabAccess("banking")
  };
  const operationFields = fieldsForRole(settings, defaultAccess, "Operation");
  assert.ok(operationFields.every((field) => ["Tender Details", "Operation", "Approval"].includes(field.tab)));
  assert.ok(operationFields.filter((field) => !field.system && field.key !== "branch").every((field) => field.canEdit));
  assert.ok(operationFields.filter((field) => field.system && field.key !== "assignTo").every((field) => !field.canEdit));
  assert.equal(operationFields.find((field) => field.key === "assignTo").canEdit, true);
  assert.equal(operationFields.some((field) => field.tab === "Banking"), false);
  assert.equal(getRoleTabAccess(defaultAccess, "Operation").Approval.edit, true);
  assert.deepEqual(defaultTabAccess("user"), defaultTabAccess("operation"));
  const bankingAccess = getRoleTabAccess(defaultAccess, "Banking");
  assert.equal(bankingAccess["Tender Details"].edit, false);
  assert.equal(bankingAccess.Banking.edit, true);
  assert.equal(fieldsForRole(settings, defaultAccess, "banking", "edit").some((field) => field.key === "assignTo"), false);
  assert.equal(fieldsForRole(settings, defaultAccess, "approver", "edit").length, 0);
  assert.equal(fieldsForRole(settings, defaultAccess, "approver").some((field) => field.tab === "Banking"), false);
  const bankingApproverFields = fieldsForRole(settings, defaultAccess, "approver", "edit", "banking");
  assert.ok(bankingApproverFields.some((field) => field.tab === "Banking"));
  assert.ok(bankingApproverFields.filter((field) => field.tab === "Banking").every((field) => field.canEdit));
  assert.equal(bankingApproverFields.find((field) => field.key === "jobStatus").type, "select");
  assert.equal(bankingApproverFields.find((field) => field.key === "jobStatus").canEdit, true);
  assert.equal(fieldsForRole(settings, defaultAccess, "approver", "view", "banking")
    .find((field) => field.key === "nameOfWork").canEdit, false);
  assert.equal(fieldsForRole(settings, defaultAccess, "approver", "edit", "rahul")
    .some((field) => field.tab === "Banking"), false);
  const record = {
    branch: "North",
    nameOfWork: "Lift modernization",
    bankingAmount: "10000",
    bankName: "Example Bank",
    preparedBy: "Accounts"
  };
  const operationData = filterRecordData(record, settings, getRoleTabAccess(defaultAccess, "Operation"));
  assert.equal(operationData.branch, "North");
  assert.equal(operationData.nameOfWork, "Lift modernization");
  assert.equal(operationData.preparedBy, "Accounts");
  assert.equal(Object.hasOwn(operationData, "bankingAmount"), false);
  assert.equal(Object.hasOwn(operationData, "bankName"), false);
  assert.equal(operationData.claimDate, undefined);
  const bankingData = filterRecordData(record, settings, bankingAccess);
  assert.equal(bankingData.bankingAmount, "10000");
  assert.equal(bankingData.bankName, "Example Bank");
  assert.equal(Object.hasOwn(bankingData, "branch"), true);
  assert.equal(bankingData.branch, "North");
  assert.equal(bankingData.beneficiaryName, "");
  assert.equal(Object.hasOwn(bankingData, "numberOfLifts"), true);
  const adminData = filterRecordData(record, settings, getRoleTabAccess(defaultAccess, "Admin"));
  assert.equal(adminData.bankingAmount, "10000");
  assert.equal(adminData.department, "");
  assert.equal(Object.hasOwn(adminData, "historicalDeletedField"), false);
  assert.match(normalizeTabAccess({
    manager: {
      ...defaultTabAccess("operation"),
      Banking: { view: false, edit: true }
    }
  }), /cannot edit Banking without being able to view it/);
});

test("resolves per-login tab permissions over defaults without changing protected roles", () => {
  const roles = {
    user: defaultTabAccess("user"),
    banking: defaultTabAccess("banking"),
    approver: defaultTabAccess("approver")
  };
  const privateUserAccess = {
    "jane.doe": {
      "Tender Details": { view: true, edit: false },
      Operation: { view: true, edit: true },
      Banking: { view: true, edit: false },
      Approval: { view: true, edit: false }
    }
  };
  const jane = resolveUserTabAccess(roles, privateUserAccess, "Jane.Doe", "user");
  assert.deepEqual(getRoleTabAccess(jane, "user"), privateUserAccess["jane.doe"]);
  assert.deepEqual(
    getRoleTabAccess(resolveUserTabAccess(roles, privateUserAccess, "new.user", "user"), "user"),
    defaultTabAccess("user")
  );
  assert.deepEqual(
    getRoleTabAccess(resolveUserTabAccess(roles, privateUserAccess, "jane.doe", "approver"), "approver"),
    defaultTabAccess("approver")
  );
  assert.deepEqual(
    getRoleTabAccess(resolveUserTabAccess(roles, privateUserAccess, "jane.doe", "admin"), "admin"),
    defaultTabAccess("admin")
  );
  assert.equal(isBranchScopedRole("user"), true);
  assert.equal(isBranchScopedRole("manager"), true);
  assert.equal(isBranchScopedRole("banking"), false);
  assert.equal(isBranchScopedRole("approver"), false);
  assert.equal(isBranchScopedRole("admin"), false);
});

test("scopes branch and approver record access and reports workflow status", () => {
  const data = { branch: "Bangalore", assignTo: "Rahul", approvalStatus: "Pending", jobStatus: "Pending" };
  assert.equal(canAccessRecord({ session: { role: "operation", branch: "Bangalore" } }, data), true);
  assert.equal(canAccessRecord({ session: { role: "user", branch: "Mumbai" } }, data), false);
  assert.equal(canAccessRecord({ session: { role: "approver", user: "rahul" } }, data), true);
  assert.equal(canAccessRecord({ session: { role: "approver", user: "amrita" } }, data), false);
  assert.equal(canAccessRecord({ session: { role: "banking" } }, data), false);
  assert.equal(canAccessRecord({ session: { role: "banking" } }, { ...data, approvalStatus: "Approved" }), true);
  assert.equal(canAccessRecord({ session: { role: "approver", user: "banking" } }, { ...data, approvalStatus: "Approved" }), true);
  assert.equal(canAccessRecord({ session: { role: "approver", user: "banking" } }, data), false);
  assert.equal(canCompleteBanking({ session: { role: "banking" } }), true);
  assert.equal(canCompleteBanking({ session: { role: "approver", user: "banking" } }), true);
  assert.equal(canCompleteBanking({ session: { role: "admin" } }), true);
  assert.equal(canCompleteBanking({ session: { role: "approver" } }), false);
  assert.equal(isBankingUser("banking", "approver"), true);
  assert.equal(isBankingUser("rahul", "approver"), false);
  assert.equal(canReviewRecord({ session: { role: "approver", user: "rahul" } }, data), true);
  assert.equal(canReviewRecord({ session: { role: "approver", user: "amrita" } }, data), false);
  assert.equal(isConfiguredApprover("rahul", ["Rahul"]), true);
  assert.equal(isConfiguredApprover(" AmRiTa ", ["amrita"]), true);
  assert.equal(isConfiguredApprover("rahul", ["amrita"]), false);
  assert.equal(isConfiguredApprover(" ", ["rahul"]), false);
  assert.equal(canSubmitReview({ session: { role: "approver", user: "rahul" } }, data, ["Rahul"]), true);
  assert.equal(canSubmitReview({ session: { role: "approver", user: "rahul" } }, data, ["Amrita"]), false);
  assert.equal(canSubmitReview({ session: { role: "admin", user: "administrator" } }, data, []), true);
  assert.equal(canReviewRecord({ session: { role: "admin", user: "admin1" } }, data), true);
  assert.equal(canReviewRecord({ session: { role: "operation", user: "operator" } }, data), false);
  assert.equal(normalizeWorkflowStatus(data), "Pending Approval");
  assert.equal(normalizeWorkflowStatus({ ...data, approvalStatus: "Not Approved" }), "Not Approved");
  assert.equal(normalizeWorkflowStatus({ ...data, approvalStatus: "Approved" }), "Pending Banking");
  assert.equal(normalizeWorkflowStatus({ ...data, approvalStatus: "Approved", jobStatus: "Processed" }), "Processed");
});

test("exports all records for admins and Banking, and scopes branch and reviewer exports", () => {
  assert.deepEqual(tenderExportScope({ session: { role: "admin", user: "admin" } }), {
    where: "",
    parameter: null
  });
  assert.deepEqual(tenderExportScope({ session: { role: "banking", user: "banking" } }), {
    where: "",
    parameter: null
  });
  assert.deepEqual(tenderExportScope({ session: { role: "approver", user: "banking" } }), {
    where: "",
    parameter: null
  });
  assert.deepEqual(tenderExportScope({ session: { role: "approver", user: "Rahul" } }), {
    where: "WHERE LOWER(LTRIM(RTRIM(ISNULL(AssignedTo, N'')))) = LOWER(LTRIM(RTRIM(@assignedTo)))",
    parameter: { name: "assignedTo", value: "Rahul" }
  });
  assert.deepEqual(tenderExportScope({
    session: { role: "operation", user: "operator", branch: "Bangalore" }
  }), {
    where: "WHERE LOWER(LTRIM(RTRIM(ISNULL(Branch, N'')))) = LOWER(LTRIM(RTRIM(@branch)))",
    parameter: { name: "branch", value: "Bangalore" }
  });

  const editableAdminFields = fieldsForRole(
    defaultFieldSettings(), defaultTabAccess("admin"), "admin", "edit", "admin"
  );
  assert.ok(editableAdminFields.filter((field) => field.system !== true).every((field) => field.canEdit));
});

test("allows Admin and Banking to reject unprocessed requests from their queues only", () => {
  const admin = { session: { role: "admin", user: "admin" } };
  const banking = { session: { role: "banking", user: "banking" } };
  const pending = { approvalStatus: "Pending", jobStatus: "Pending" };
  const approved = { approvalStatus: "Approved", jobStatus: "Pending" };
  const processed = { approvalStatus: "Approved", jobStatus: "Processed" };
  assert.equal(canRejectQueuedRequest(admin, pending), true);
  assert.equal(canRejectQueuedRequest(admin, approved), true);
  assert.equal(canRejectQueuedRequest(admin, processed), false);
  assert.equal(canRejectQueuedRequest(banking, pending), false);
  assert.equal(canRejectQueuedRequest(banking, approved), true);
  assert.equal(canRejectQueuedRequest(banking, processed), false);
  assert.equal(canRejectQueuedRequest({ session: { role: "approver", user: "Rahul" } }, approved), false);
});

test("creates Excel downloads with record metadata and only the fields supplied for the user role", async () => {
  const buffer = await createTenderExcel({
    records: [{
      uniqueId: "BAN000123",
      createdBy: "operator",
      createdAt: new Date("2026-10-17T09:00:00.000Z"),
      status: "Pending Approval",
      formData: {
        branch: "Bangalore",
        assignTo: "Rahul",
        approvalStatus: "Pending",
        clientName: "Example client",
        hiddenBankingValue: "Not exported"
      }
    }],
    fields: [
      { key: "clientName", label: "Client Name" },
      { key: "clientAlias", label: "Client Name" }
    ]
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Tender Records");
  assert.equal(worksheet.getCell(1, 1).value, "Unique ID");
  assert.equal(worksheet.getCell(1, 13).value, "Client Name");
  assert.equal(worksheet.getCell(1, 14).value, "Client Name (2)");
  assert.equal(worksheet.getCell(2, 1).value, "BAN000123");
  assert.equal(worksheet.getCell(2, 2).value, "Bangalore");
  assert.equal(worksheet.getCell(2, 13).value, "Example client");
  assert.equal(worksheet.getCell(2, 14).value, "");
  assert.equal(worksheet.getRow(1).getCell(15).value, null);
  assert.equal(uniqueFieldHeaders([{ key: "branch", label: "Branch" }])[0], "Branch (2)");
});

test("reports named reviewer and Banking statuses for the branch summary", () => {
  const approvers = ["amrita.sharma", "Rahul Kumar"];
  const assignedToRahul = {
    assignTo: "Rahul Kumar",
    approvalStatus: "Pending",
    jobStatus: "Pending"
  };
  assert.deepEqual(workflowSummary(assignedToRahul, approvers), {
    rahul: { name: "Rahul", status: "Pending" },
    amrita: { name: "Amrita", status: "Not assigned" },
    banking: { status: "Waiting for approval", processedBy: "", processedAt: "" }
  });
  assert.equal(workflowSummary({
    ...assignedToRahul,
    approvalStatus: "Approved",
    reviewedBy: "Rahul Kumar"
  }, approvers).rahul.status, "Approved");
  assert.equal(workflowSummary({
    ...assignedToRahul,
    approvalStatus: "Approved",
    reviewedBy: "Admin"
  }, approvers).rahul.status, "Approved by Admin");
  assert.equal(workflowSummary({
    assignTo: "Rahul",
    approvalStatus: "Approved",
    reviewedBy: "Rahul",
    jobStatus: "Processed"
  }, ["rahul.kumar"]).rahul.status, "Approved");
  assert.equal(workflowSummary({
    assignTo: "Amrita",
    approvalStatus: "Approved",
    reviewedBy: "amrita.sharma",
    jobStatus: "Pending"
  }, ["amrita.sharma"]).amrita.status, "Approved");
  assert.equal(workflowSummary({
    assignTo: "",
    approvalStatus: "Approved",
    reviewedBy: "rahul",
    jobStatus: "Processed"
  }, []).rahul.status, "Approved");
  assert.equal(workflowSummary({
    assignTo: "Amrita Sharma",
    approvalStatus: "Approved",
    reviewedBy: "Amrita Sharma",
    jobStatus: "Pending"
  }, []).amrita.status, "Approved");
  assert.equal(workflowSummary({
    assignTo: "Rahul",
    approvalStatus: "Pending",
    reviewedBy: "",
    jobStatus: "Pending"
  }, []).rahul.status, "Pending");
  assert.deepEqual(workflowSummary({
    ...assignedToRahul,
    approvalStatus: "Approved",
    jobStatus: "Processed",
    processedBy: "banking.user",
    processedAt: "16/10/2026 13:30:00 IST"
  }, approvers).banking, {
    status: "Approved",
    processedBy: "banking.user",
    processedAt: "16/10/2026 13:30:00 IST"
  });
});

test("routes Banking approval through its own action and persists pending edits first", () => {
  const appSource = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
  const summarySource = fs.readFileSync(require.resolve("../public/summary.js"), "utf8");
  const htmlSource = fs.readFileSync(require.resolve("../public/tender.html"), "utf8");
  const summaryHtml = fs.readFileSync(require.resolve("../public/summary.html"), "utf8");
  assert.match(htmlSource, /id="review-approve"[^>]*>Reviewer Approval/);
  assert.match(htmlSource, /id="banking-approve"[^>]*>Banking Approval/);
  assert.match(appSource, /tabHeading\.textContent = tab/);
  assert.match(appSource, /getElementById\("banking-approve"\)\.addEventListener/);
  assert.match(appSource, /method: "PUT",\s*body: JSON\.stringify\(changedFields\)/);
  assert.match(appSource, /key !== "jobStatus"/);
  assert.match(appSource, /\/banking-complete/);
  assert.match(appSource, /Request has been approved\./);
  assert.doesNotMatch(appSource, /getElementById\("banking-process"\)/);
  assert.match(summarySource, /addStatusCell\(row, record\.workflow\?\.banking\?\.status \|\| "Waiting for approval"\)/);
  assert.doesNotMatch(summarySource, /record\.workflow\?\.banking\?\.processed(?:By|At)/);
  assert.match(summaryHtml, /href="\/api\/tenders\/export\.xlsx" id="export-excel-link"/);
  assert.match(summaryHtml, /Download Excel/);
  assert.match(summarySource, /summary-reject/);
  assert.match(summarySource, /\/reject/);
  assert.match(fs.readFileSync(require.resolve("../server"), "utf8"), /app\.post\("\/api\/tenders\/:id\/reject", requireLogin/);
});

test("generates a downloadable Tender and Operation PDF and restricts it to assigned approvers or admins", async () => {
  const data = {
    branch: "Bangalore",
    clientName: "Café client",
    nameOfWork: "Lift maintenance",
    requisitionType: "EMD",
    requisitionAmount: "25000",
    bankName: "Private detail that is not included",
    paymentTerm: "Payment terms and conditions apply. ".repeat(9),
    operationRemarks: "Operation remarks for the bank guarantee.",
    bankingRemarks: "Additional supporting remarks for this tender request.",
    assignTo: "Amrita Sharma",
    reviewedBy: "Rahul Kumar",
    processedBy: "Banking Admin"
  };
  const settings = defaultFieldSettings();
  const exportFields = settings.filter((field) => ["Tender Details", "Operation"].includes(field.tab));
  const pdf = await createTenderOperationPdf({
    uniqueId: "BAN000123",
    data,
    fields: exportFields,
    generatedBy: "rahul",
    generatedAt: "17/10/2026 14:30:00 IST",
    createdBy: "branch.operator",
    branch: "Bangalore",
    reviewedBy: "Amrita Sharma",
    reviewedAt: "17/10/2026 14:00:00 IST"
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const document = await PDFDocument.load(pdf);
  assert.equal(document.getPageCount(), 1, "standard tender details and review metadata fit on one page");
  assert.equal(document.getTitle(), "Tender and Operation Details - BAN000123");
  assert.equal(document.getAuthor(), "rahul");
  assert.ok(document.getPageCount() >= 1);
  const longPdf = await createTenderOperationPdf({
    uniqueId: "BAN000124",
    data: {
      ...data,
      nameOfWork: "Long work description ".repeat(600),
      paymentTerm: "Extended payment clause ".repeat(600)
    },
    fields: exportFields,
    generatedBy: "rahul",
    generatedAt: "17/10/2026 14:30:00 IST",
    createdBy: "branch.operator",
    branch: "Bangalore",
    reviewedBy: "Amrita Sharma",
    reviewedAt: "17/10/2026 14:00:00 IST"
  });
  const longDocument = await PDFDocument.load(longPdf);
  assert.ok(longDocument.getPageCount() > 1, "long form values should continue onto another page");

  const assignedRecord = { assignTo: "Rahul" };
  assert.equal(canDownloadTenderOperationPdf(
    { session: { role: "approver", user: "rahul" } }, assignedRecord, ["Rahul"]
  ), true);
  assert.equal(canDownloadTenderOperationPdf(
    { session: { role: "approver", user: "amrita" } }, assignedRecord, ["Amrita"]
  ), false);
  assert.equal(canDownloadTenderOperationPdf(
    { session: { role: "admin", user: "admin" } }, assignedRecord, []
  ), true);
  assert.equal(canDownloadTenderOperationPdf(
    { session: { role: "banking", user: "banking" } }, assignedRecord, []
  ), false);

  const serverSource = fs.readFileSync(require.resolve("../server"), "utf8");
  const summarySource = fs.readFileSync(require.resolve("../public/summary.js"), "utf8");
  assert.match(serverSource, /app\.get\("\/api\/tenders\/:id\/tender-operation\.pdf", requireLogin/);
  assert.match(serverSource, /Content-Type": "application\/pdf"/);
  assert.match(serverSource, /createdBy: row\.CreatedBy,[\s\S]*branch: row\.Branch,[\s\S]*reviewedBy: data\.reviewedBy,[\s\S]*reviewedAt: data\.reviewedAt/);
  const pdfSource = fs.readFileSync(require.resolve("../pdf/tender-operation"), "utf8");
  assert.match(pdfSource, /Reviewed by: \$\{reviewedBy \|\| "—"\}/);
  assert.match(pdfSource, /color: COLORS\.navy\s*\}\);/);
  assert.doesNotMatch(pdfSource, /width: PAGE_WIDTH,[\s\S]*height: 94,[\s\S]*color: COLORS\.navy/);
  assert.match(pdfSource, /Created by \$\{String\(createdBy \|\| "—"\)\}  •  Branch \$\{String\(branch \|\| "—"\)\}/);
  assert.match(pdfSource, /function drawEmptyRemarkBox\(\)/);
  assert.doesNotMatch(pdfSource, /drawFullWidthField\("Additional Remark"/);
  assert.match(pdfSource, /field\.tab === "Operation" && field\.key !== "paymentTerm"/);
  assert.doesNotMatch(pdfSource, /fieldValue\(data, \{ key: "bankingRemarks" \}\)/);
  assert.match(summarySource, /summary-pdf-download/);
  assert.match(summarySource, /canDownloadPdf = \["approver", "admin"\]/);
});

test("dashboard uses scoped status counts and hides workflow actions from user-role accounts", () => {
  const serverSource = fs.readFileSync(require.resolve("../server"), "utf8");
  const dashboardSource = fs.readFileSync(require.resolve("../public/dashboard.js"), "utf8");
  const appSource = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
  const dashboardHtml = fs.readFileSync(require.resolve("../public/dashboard.html"), "utf8");
  const summaryHtml = fs.readFileSync(require.resolve("../public/summary.html"), "utf8");
  const tenderHtml = fs.readFileSync(require.resolve("../public/tender.html"), "utf8");
  const settingsHtml = fs.readFileSync(require.resolve("../public/field-settings.html"), "utf8");
  const dashboardStyles = fs.readFileSync(require.resolve("../public/styles.css"), "utf8");
  assert.match(serverSource, /app\.get\("\/api\/dashboard\/summary", requireLogin/);
  assert.match(serverSource, /if \(isBranchScopedRole\(role\)\)[\s\S]*scope = "WHERE Branch = @branch"/);
  assert.match(serverSource, /LOWER\(LTRIM\(RTRIM\(ISNULL\(AssignedTo, N''\)\)\)\) = LOWER\(LTRIM\(RTRIM\(@assignedTo\)\)\)/);
  assert.match(serverSource, /scope = "WHERE ApprovalStatus = N'Approved'"/);
  assert.match(serverSource, /ISNULL\(JobStatus,[\s\S]*?N'processed'[\s\S]*?AS approved/);
  assert.match(serverSource, /AS notApproved,[\s\S]*AS pending/);
  assert.match(dashboardHtml, /id="metric-total"/);
  assert.match(dashboardHtml, /id="metric-approved"/);
  assert.match(dashboardHtml, /id="metric-not-approved"/);
  assert.match(dashboardHtml, /id="metric-pending"/);
  assert.match(dashboardHtml, /id="status-chart"/);
  assert.match(dashboardHtml, /class="workspace-layout dashboard-layout"/);
  assert.match(dashboardStyles, /\.dashboard-layout \.sidebar \{[\s\S]*linear-gradient\(180deg, #e8f3fb 0%, #f3f8fc 56%, #e9f5f3 100%\)/);
  assert.match(dashboardStyles, /\.dashboard-layout \.sidebar-link\.active \{[\s\S]*linear-gradient\(100deg, #d4f0eb, #e4f4f7\)/);
  assert.match(summaryHtml, /class="workspace-layout summary-layout"/);
  assert.match(summaryHtml, /class="page-heading summary-page-heading"/);
  assert.match(summaryHtml, /class="records-header summary-toolbar"/);
  assert.match(tenderHtml, /class="workspace-layout tender-layout"/);
  assert.match(settingsHtml, /class="workspace-layout settings-layout"/);
  assert.match(dashboardStyles, /\.summary-layout,\s*\.tender-layout,\s*\.settings-layout \{[\s\S]*--side-accent: #7154bd/);
  assert.match(dashboardStyles, /\.tender-layout \{\s*--side-accent: #bb6b1c/);
  assert.match(dashboardStyles, /\.settings-layout \{\s*--side-accent: #28796f/);
  assert.match(dashboardStyles, /\.summary-layout \.sidebar-link\.active,[\s\S]*\.settings-layout \.sidebar-link\.active/);
  assert.match(dashboardStyles, /\.summary-page-heading \{[\s\S]*linear-gradient\(112deg, #30235f 0%, #57419b 57%, #7656b8 100%\)/);
  assert.match(dashboardStyles, /\.summary-heading-actions \.button \{[\s\S]*text-decoration: none/);
  assert.match(dashboardStyles, /\.summary-panel \.records-header \{[\s\S]*linear-gradient\(105deg, #f5f0ff 0%, #fff 55%, #f7f4fc 100%\)/);
  assert.match(dashboardStyles, /\.summary-panel \.records-table th \{[\s\S]*linear-gradient\(180deg, #f5f1fb, #eee9f7\)/);
  assert.match(dashboardStyles, /\.overview-hero \{[\s\S]*linear-gradient\(112deg, #09234b 0%, #124f83 58%, #087e86 100%\)/);
  assert.match(dashboardStyles, /\.metric-approved \{ --metric-accent: #168657; --metric-tint: #eef9f3; \}/);
  assert.match(dashboardStyles, /\.dashboard-shortcuts \{[\s\S]*linear-gradient\(145deg, #123e68 0%, #09234b 100%\)/);
  assert.match(dashboardHtml, /Banking approval completed/);
  assert.match(dashboardHtml, /Awaiting reviewer or Banking/);
  assert.match(dashboardSource, /EventSource\("\/api\/tenders\/events"\)/);
  assert.match(appSource, /role === "admin" \|\| \(role === "approver" && assignedToCurrentUser\)/);
  assert.match(appSource, /!\(\["banking", "admin"\]\.includes\(role\) \|\| isBankingLogin\)/);
  assert.match(appSource, /record\.formData\.assignTo \|\| ""\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(appSource, /document\.getElementById\("banking-approve"\)\.hidden =[\s\S]*!\(\["banking", "admin"\]\.includes\(role\) \|\| isBankingLogin\)/);
});

test("reviewer assignment choices use Rahul and Amrita accounts with the Approver role", () => {
  const serverSource = fs.readFileSync(require.resolve("../server"), "utf8");
  assert.match(serverSource, /LOWER\(LTRIM\(RTRIM\(\$\{roleColumn\}\)\)\) = @approverRole/);
  assert.doesNotMatch(serverSource, /@adminRole/);
  assert.match(serverSource, /LOWER\(\$\{usernameColumn\}\) LIKE '%rahul%'/);
  assert.match(serverSource, /LOWER\(\$\{usernameColumn\}\) LIKE '%amrita%'/);
});

test("uses SQL workflow columns to repair stale JSON workflow state on read", () => {
  const data = mergeStoredWorkflowData(
    { branch: "Old Branch", assignTo: "Old User", approvalStatus: "Pending", jobStatus: "Pending" },
    {
      Branch: "Bangalore",
      AssignedTo: "Rahul",
      ApprovalStatus: "Approved",
      JobStatus: "Pending",
      ReviewedBy: "Rahul",
      ReviewedAt: new Date("2026-10-16T13:30:00.000Z"),
      ProcessedBy: null,
      ProcessedAt: null
    }
  );
  assert.equal(data.branch, "Bangalore");
  assert.equal(data.assignTo, "Rahul");
  assert.equal(data.approvalStatus, "Approved");
  assert.equal(canAccessRecord({ session: { role: "banking" } }, data), true);
  assert.equal(data.reviewedAt, "16/10/2026 13:30:00 IST");
});

test("formats workflow timestamps and SQL datetime values in India Standard Time", () => {
  const { date, formatted } = indiaTimestamp(new Date("2026-10-16T08:00:00.000Z"));
  assert.equal(formatted, "16/10/2026 13:30:00 IST");
  assert.equal(date.toISOString(), "2026-10-16T13:30:00.000Z");
});

test("preserves custom admin fields on reload and only restores required workflow fields", async () => {
  const defaults = defaultFieldSettings();
  const customField = {
    key: "customFieldCheck",
    label: "Custom value",
    tab: "Operation",
    section: "Custom fields",
    type: "text",
    required: false,
    options: []
  };
  const saved = defaults.filter((field) => field.key !== "department").concat(customField);
  const fakePool = {
    request: () => ({
      query: async () => ({ recordset: [{ SettingsJson: JSON.stringify(saved) }] })
    })
  };
  const reloaded = await getFieldSettings(fakePool);
  assert.equal(reloaded.some((field) => field.key === "department"), false);
  assert.equal(reloaded.some((field) => field.key === "customFieldCheck"), true);
  assert.equal(reloaded.find((field) => field.key === "customFieldCheck").label, "Custom value");
  for (const key of ["assignTo", "approvalStatus", "jobStatus"]) {
    assert.equal(reloaded.some((field) => field.key === key), true);
    assert.match(validateFieldSettings(reloaded.filter((field) => field.key !== key)), new RegExp(`${key} must remain`));
  }
});

test("formats branch-prefixed IDs with a global padded row number", () => {
  assert.equal(branchPrefix("west branch"), "WES");
  assert.equal(branchPrefix("A"), "AXX");
  assert.equal(branchPrefix(""), "XXX");
  assert.equal(formatUniqueId("West Branch", 42), "WES000042");
  assert.equal(formatUniqueId("", 42), "XXX000042");
  assert.equal(formatUniqueId("North", 1234567), "NOR1234567");
});

test("maps every workbook business field to its nullable SQL column", () => {
  const mappedKeys = new Set(structuredTenderColumns.map(([key]) => key));
  const definedKeys = new Set(fields.map((field) => field.key));
  assert.equal(structuredTenderColumns.length, 40);
  for (const field of fields) {
    if (field.system) continue;
    assert.ok(mappedKeys.has(field.key), `Missing SQL column mapping for ${field.key}`);
  }
  assert.ok(definedKeys.has("approvalLoginName"));
  assert.ok(definedKeys.has("approvalDateTime"));
  assert.equal(new Set(structuredTenderColumns.map(([, column]) => column)).size, structuredTenderColumns.length);
  const schema = fs.readFileSync(require.resolve("../sql/schema.sql"), "utf8");
  for (const [, column] of structuredTenderColumns) {
    assert.match(schema, new RegExp(`\\b${column} NVARCHAR\\(MAX\\) NULL`, "i"), `${column} must be a nullable text column`);
  }
  assert.match(schema, /\bApprovalLoginName NVARCHAR\(MAX\) NULL/i);
  assert.match(schema, /\bApprovalDateTime DATETIME2\(7\) NULL/i);
  assert.match(schema, /\bAssignedTo NVARCHAR\(200\) NULL/i);
  assert.match(schema, /\bApprovalStatus NVARCHAR\(32\) NULL/i);
  assert.match(schema, /\bJobStatus NVARCHAR\(32\) NULL/i);
  assert.match(schema, /\bReviewedAt DATETIME2\(7\) NULL/i);
  assert.match(schema, /\bProcessedAt DATETIME2\(7\) NULL/i);
  assert.match(schema, /\bOperationRemarks NVARCHAR\(MAX\) NULL/i);
});

test("allows partial edits without requiring unchanged fields", () => {
  const settings = defaultFieldSettings();
  assert.equal(validateTenderForm({ bankingAmount: "250.00" }, settings, true), null);
  assert.equal(validateTenderForm({ branch: null }, settings, true), null);
});

test("accepts arbitrarily long business-field text regardless of configured UI limits", () => {
  const settings = defaultFieldSettings();
  settings.find((field) => field.key === "branch").type = "text";
  assert.equal(validateTenderForm({ ...emptyRecord(), nameOfWork: "X".repeat(5000) }, settings), null);
  const clientName = settings.find((field) => field.key === "clientName");
  clientName.maxLength = 100;
  assert.equal(validateTenderForm({ ...emptyRecord(), clientName: "X".repeat(5000) }, settings), null);
});

test("validates configurable login-page colors", () => {
  assert.deepEqual(validateAppearance(defaultAppearance), defaultAppearance);
  assert.equal(defaultAppearance.backgroundStart, "#f4faff");
  assert.equal(defaultAppearance.backgroundEnd, "#cbd9e8");
  assert.equal(defaultAppearance.card, "#071b45");
  assert.equal(typeof validateAppearance({ ...defaultAppearance, accent: "blue" }), "string");
  assert.equal(typeof validateAppearance({ ...defaultAppearance, extra: "#000000" }), "string");
  assert.equal(typeof validateAppearance(null), "string");
  const safePalette = contrastSafeAppearance({
    ...defaultAppearance,
    backgroundStart: "#071b38",
    backgroundEnd: "#10274a",
    card: "#ffffff",
    cardText: "#14243a"
  });
  assert.ok(relativeLuminance(safePalette.backgroundStart) >= 0.76);
  assert.ok(relativeLuminance(safePalette.backgroundEnd) >= 0.76);
  assert.ok(relativeLuminance(safePalette.card) <= 0.12);
  assert.equal(safePalette.cardText, "#ffffff");
});

test("verifies configured bcrypt and legacy plain-text credentials", async () => {
  process.env.AUTH_PASSWORD_FORMAT = "bcrypt";
  const hash = await bcrypt.hash("example-password", 4);
  assert.equal(await verifyPassword("example-password", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);

  process.env.AUTH_PASSWORD_FORMAT = "plain";
  assert.equal(await verifyPassword("legacy-password", "legacy-password"), true);
  assert.equal(await verifyPassword("wrong-password", "legacy-password"), false);
  delete process.env.AUTH_PASSWORD_FORMAT;
});

test("serves the login page, protects app APIs, and checks CSRF tokens", async (context) => {
  const server = app.listen(0);
  await once(server, "listening");
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(health.headers.get("cache-control"), "no-store");

  const loginPage = await fetch(baseUrl);
  assert.equal(loginPage.status, 200);
  assert.equal(loginPage.headers.get("cache-control"), "no-store");
  const loginHtml = await loginPage.text();
  assert.match(loginHtml, /Escon Elevators Pvt\. Ltd\./);
  assert.match(loginHtml, /class="login-company-logo" src="\/assets\/escon-logo\.png"/);
  assert.match(loginHtml, /id="remember-me"/);
  assert.match(loginHtml, /id="forgot-password"/);
  assert.match(loginHtml, /\/assets\/escon-logo\.png/);
  const loginStyles = fs.readFileSync(require.resolve("../public/styles.css"), "utf8");
  assert.match(loginStyles, /grid-template-columns: minmax\(0, 1fr\) minmax\(340px, 410px\)/);
  assert.match(loginStyles, /width: min\(1440px, 100%\);[\s\S]*margin: 0 auto/);
  assert.match(loginStyles, /\.login-card \{ width: min\(380px, 100%\)/);
  const logo = await fetch(`${baseUrl}/assets/escon-logo.png`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/png");
  assert.match(fs.readFileSync(require.resolve("../public/login.js"), "utf8"), /tender\.remembered-username/);
  const tenderScript = await fetch(`${baseUrl}/app.js`);
  assert.equal(tenderScript.status, 200);
  assert.equal(tenderScript.headers.get("cache-control"), "no-store");
  assert.match(await tenderScript.text(), /banking.*admin/);
  const publicFieldInventory = await fetch(`${baseUrl}/form-fields.json`);
  assert.equal(publicFieldInventory.status, 404);

  const protectedResponse = await fetch(`${baseUrl}/api/me`);
  assert.equal(protectedResponse.status, 401);
  const protectedSettings = await fetch(`${baseUrl}/api/field-settings`);
  assert.equal(protectedSettings.status, 401);
  const protectedDashboardSummary = await fetch(`${baseUrl}/api/dashboard/summary`);
  assert.equal(protectedDashboardSummary.status, 401);
  const protectedSettingsEvents = await fetch(`${baseUrl}/api/field-settings/events`);
  assert.equal(protectedSettingsEvents.status, 401);

  const protectedDashboard = await fetch(`${baseUrl}/dashboard.html`, { redirect: "manual" });
  assert.equal(protectedDashboard.status, 302);
  assert.equal(protectedDashboard.headers.get("location"), "/");
  const protectedSummary = await fetch(`${baseUrl}/summary.html`, { redirect: "manual" });
  assert.equal(protectedSummary.status, 302);
  assert.equal(protectedSummary.headers.get("location"), "/");
  const protectedTender = await fetch(`${baseUrl}/tender.html`, { redirect: "manual" });
  assert.equal(protectedTender.status, 302);
  assert.equal(protectedTender.headers.get("location"), "/");
  const protectedFieldSettings = await fetch(`${baseUrl}/field-settings.html`, { redirect: "manual" });
  assert.equal(protectedFieldSettings.status, 302);
  assert.equal(protectedFieldSettings.headers.get("location"), "/");

  const csrfResponse = await fetch(`${baseUrl}/api/csrf`);
  const csrf = await csrfResponse.json();
  const cookie = csrfResponse.headers.get("set-cookie").split(";")[0];
  const missingCredentials = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken, Cookie: cookie },
    body: JSON.stringify({})
  });
  assert.equal(missingCredentials.status, 400);

  const invalidCsrf = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "invalid", Cookie: cookie },
    body: JSON.stringify({})
  });
  assert.equal(invalidCsrf.status, 403);
});
