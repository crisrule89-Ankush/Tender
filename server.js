require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const sql = require("mssql");
const { createTenderOperationPdf } = require("./pdf/tender-operation");
const { createTenderExcel } = require("./excel/tender-export");

const app = express();
const port = Number(process.env.PORT || 3000);
const fields = require("./config/form-fields.json");
const dropdownOptions = require("./config/dropdown-options.json");
const workflowTabs = Object.freeze(["Tender Details", "Operation", "Banking", "Approval"]);
const structuredTenderColumns = Object.freeze([
  ["branch", "Branch"], ["department", "Department"], ["clientName", "ClientName"],
  ["numberOfLifts", "NumberOfLifts"], ["nameOfWork", "NameOfWork"], ["loNumber", "LoNumber"],
  ["referenceType", "ReferenceType"], ["referenceNumber", "ReferenceNumber"], ["referenceDate", "ReferenceDate"],
  ["workType", "WorkType"], ["jobType", "JobType"], ["startDate", "StartDate"], ["endDate", "EndDate"],
  ["beneficiaryBankName", "BeneficiaryBankName"], ["beneficiaryIfscCode", "BeneficiaryIfscCode"],
  ["tenderType", "TenderType"], ["tenderValue", "TenderValue"], ["completionPeriod", "CompletionPeriod"],
  ["submissionDate", "SubmissionDate"], ["dlpInMonths", "DlpInMonths"],
  ["requisitionType", "RequisitionType"], ["validUpto", "ValidUpto"], ["requisitionAmount", "RequisitionAmount"],
  ["inFormOf", "InFormOf"], ["inFavorOf", "InFavorOf"], ["emdConvertedToSd", "EmdConvertedToSd"],
  ["refundable", "Refundable"], ["paymentTerm", "PaymentTerm"], ["operationRemarks", "OperationRemarks"],
  ["beneficiaryName", "BeneficiaryName"], ["bankName", "BankName"], ["claimDate", "ClaimDate"],
  ["bankingRequisitionType", "BankingRequisitionType"], ["chequeNumber", "ChequeNumber"],
  ["utrDdNumber", "UtrDdNumber"], ["bankExpiryDate", "BankExpiryDate"], ["chequeDate", "ChequeDate"],
  ["bankingAmount", "BankingAmount"], ["bankingRemarks", "BankingRemarks"], ["preparedBy", "PreparedBy"]
]);
const scrypt = promisify(crypto.scrypt);
const fieldSettingsSubscribers = new Map();
const appearanceSubscribers = new Set();
const recordSubscribers = new Map();
const defaultAppearance = Object.freeze({
  backgroundStart: "#f4faff",
  backgroundEnd: "#cbd9e8",
  accent: "#0879e8",
  accentHover: "#1154ad",
  highlight: "#8fc7ff",
  card: "#071b45",
  cardText: "#ffffff"
});

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function sqlIdentifier(name, environmentVariable) {
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,127}$/.test(name)) {
    throw new Error(`${environmentVariable} must be a simple SQL column name.`);
  }
  return `[${name}]`;
}

function databaseConfig() {
  const config = {
    server: requiredEnvironment("DB_SERVER"),
    port: Number(process.env.DB_PORT || 1433),
    database: requiredEnvironment("DB_NAME"),
    user: requiredEnvironment("DB_USER"),
    password: requiredEnvironment("DB_PASSWORD"),
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true"
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 30000
  };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("DB_PORT must be a valid TCP port.");
  }
  return config;
}

function checkConfiguration() {
  const sessionSecret = requiredEnvironment("SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  sqlIdentifier(process.env.LOGIN_USERNAME_COLUMN || "Username", "LOGIN_USERNAME_COLUMN");
  sqlIdentifier(process.env.LOGIN_PASSWORD_COLUMN || "Password", "LOGIN_PASSWORD_COLUMN");
  sqlIdentifier(process.env.LOGIN_BRANCH_COLUMN || "Branch_Name", "LOGIN_BRANCH_COLUMN");
  sqlIdentifier(process.env.LOGIN_ROLE_COLUMN || "Role", "LOGIN_ROLE_COLUMN");
  if (!["bcrypt", "scrypt", "plain"].includes(process.env.AUTH_PASSWORD_FORMAT || "bcrypt")) {
    throw new Error("AUTH_PASSWORD_FORMAT must be bcrypt, scrypt, or plain.");
  }
  databaseConfig();
}

function loadSchema() {
  return fs.readFileSync(path.join(__dirname, "sql", "schema.sql"), "utf8");
}

app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "256kb" }));
app.use(session({
  name: "tender.sid",
  secret: process.env.SESSION_SECRET || "configuration-is-validated-before-startup",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please try again later." }
});

app.get("/healthz", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ status: "ok" });
});

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  const provided = req.get("X-CSRF-Token");
  const expected = req.session.csrfToken;
  if (!provided || !expected) return res.status(403).json({ error: "The request could not be verified. Refresh and try again." });
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return res.status(403).json({ error: "The request could not be verified. Refresh and try again." });
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in to continue." });
  next();
}

let poolPromise;
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(databaseConfig()).connect().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

async function verifyPassword(candidate, stored) {
  const format = process.env.AUTH_PASSWORD_FORMAT || "bcrypt";
  if (format === "bcrypt") return bcrypt.compare(candidate, stored);
  if (format === "plain") {
    const candidateBytes = Buffer.from(candidate);
    const storedBytes = Buffer.from(stored);
    return candidateBytes.length === storedBytes.length && crypto.timingSafeEqual(candidateBytes, storedBytes);
  }
  const [prefix, salt, encodedHash] = stored.split("$");
  if (prefix !== "scrypt" || !salt || !encodedHash) return false;
  const expected = Buffer.from(encodedHash, "base64");
  if (!expected.length) return false;
  const actual = await scrypt(candidate, Buffer.from(salt, "base64"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function defaultFieldSettings() {
  return fields.map((field) => {
    const { optionsKey, maxLength, ...definition } = field;
    return {
      ...definition,
      ...(maxLength ? { maxLength: Number(maxLength) } : {}),
      required: false,
      options: optionsKey ? [...(dropdownOptions[optionsKey] || [])] : []
    };
  });
}

function defaultTabAccess(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "admin") {
    return Object.fromEntries(workflowTabs.map((tab) => [tab, { view: true, edit: true }]));
  }
  if (normalizedRole === "operation" || normalizedRole === "user") {
    return {
      "Tender Details": { view: true, edit: true },
      Operation: { view: true, edit: true },
      Banking: { view: false, edit: false },
      Approval: { view: true, edit: true }
    };
  }
  if (normalizedRole === "banking") {
    return {
      "Tender Details": { view: true, edit: false },
      Operation: { view: true, edit: false },
      Banking: { view: true, edit: true },
      Approval: { view: true, edit: true }
    };
  }
  if (normalizedRole === "approver") {
    return {
      "Tender Details": { view: true, edit: false },
      Operation: { view: true, edit: false },
      Banking: { view: false, edit: false },
      Approval: { view: true, edit: false }
    };
  }
  return Object.fromEntries(workflowTabs.map((tab) => [tab, { view: false, edit: false }]));
}

function normalizeTabAccess(permissions) {
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    return "Role permissions must be an object.";
  }
  const normalized = {};
  for (const [role, tabs] of Object.entries(permissions)) {
    const roleName = role.trim();
    const roleKey = roleName.toLowerCase();
    if (!roleName || roleName.length > 80) return "Role names must contain 1 to 80 characters.";
    if (roleKey === "admin") continue;
    if (!tabs || typeof tabs !== "object" || Array.isArray(tabs)) return `${roleName} must have tab access settings.`;
    const rolePermissions = {};
    for (const tab of workflowTabs) {
      const access = tabs[tab];
      if (!access || typeof access.view !== "boolean" || typeof access.edit !== "boolean") {
        return `${roleName} must have valid view and edit permissions for ${tab}.`;
      }
      if (access.edit && !access.view) return `${roleName} cannot edit ${tab} without being able to view it.`;
      rolePermissions[tab] = { view: access.view, edit: access.edit };
    }
    normalized[roleKey] = rolePermissions;
  }
  return normalized;
}

function isBankingUser(username, role) {
  return String(role || "").trim().toLowerCase() === "banking" ||
    String(username || "").trim().toLowerCase() === "banking";
}

function getRoleTabAccess(settings, role, username = "") {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "admin") return defaultTabAccess("admin");
  if (normalizedRole === "approver") {
    const access = defaultTabAccess("approver");
    if (isBankingUser(username, role)) access.Banking = { view: true, edit: true };
    return access;
  }
  const normalized = normalizeTabAccess(settings);
  if (typeof normalized === "string") throw new Error(normalized);
  return normalized[normalizedRole] || defaultTabAccess(role);
}

function isBranchScopedRole(role) {
  return !["admin", "approver", "banking"].includes(String(role || "").trim().toLowerCase());
}

function fieldsForRole(fieldSettings, tabAccess, role, mode = "view", username = "") {
  const access = getRoleTabAccess(tabAccess, role, username);
  const normalizedRole = String(role || "").trim().toLowerCase();
  const canEditSystemField = (field) => field.system !== true ||
    (field.key === "assignTo" && (isBranchScopedRole(normalizedRole) || normalizedRole === "admin")) ||
    (field.key === "jobStatus" && (isBankingUser(username, role) || normalizedRole === "admin"));
  return fieldSettings
    .filter((field) => access[field.tab]?.[mode] &&
      (mode !== "edit" || canEditSystemField(field)) &&
      (mode !== "edit" || !(isBranchScopedRole(normalizedRole) && field.key === "branch")) &&
      (mode !== "edit" || normalizedRole !== "banking" || field.key !== "assignTo"))
    .map((field) => ({
      ...field,
      canEdit: Boolean(access[field.tab]?.edit) &&
        canEditSystemField(field) &&
        !(isBranchScopedRole(normalizedRole) && field.key === "branch") &&
        !(normalizedRole === "banking" && field.key === "assignTo")
    }));
}

function filterRecordData(data, fieldSettings, access, mode = "view") {
  return Object.fromEntries(fieldSettings
    .filter((field) => access[field.tab]?.[mode])
    .map((field) => [field.key, data[field.key] ?? ""]));
}

function toNullableSqlText(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function bindStructuredTenderFields(request, formData) {
  for (const [key] of structuredTenderColumns) {
    request.input(`field_${key}`, sql.NVarChar(sql.MAX), toNullableSqlText(formData[key]));
  }
  return request;
}

function branchPrefix(branch) {
  const letters = String(branch || "").replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();
  return letters.padEnd(3, "X");
}

function formatUniqueId(branch, recordId) {
  return `${branchPrefix(branch)}${String(recordId).padStart(6, "0")}`;
}

function includeDefaultDropdownOptions(field, defaultOptions) {
  if (field?.type !== "select" || !Array.isArray(field.options)) return;
  field.options = [...new Set([...defaultOptions, ...field.options])];
}

function orderReferenceFields(settings) {
  const referenceKeys = ["loNumber", "referenceType", "referenceNumber", "referenceDate"];
  const references = referenceKeys.map((key) => settings.find((field) => field.key === key));
  if (references.some((field) => !field) || new Set(references.map((field) => field.tab).filter(Boolean)).size > 1) {
    return settings;
  }

  const firstIndex = Math.min(...references.map((field) => settings.indexOf(field)));
  const referenceKeySet = new Set(referenceKeys);
  const ordered = settings.filter((field) => !referenceKeySet.has(field.key));
  ordered.splice(firstIndex, 0, ...references);
  return ordered;
}

function repairLegacyReferenceFields(settings) {
  const defaultByKey = new Map(defaultFieldSettings().map((field) => [field.key, field]));
  const labelKey = (label) => String(label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const legacyNumberFields = settings.filter((field) =>
    field.key !== "loNumber" &&
    field.key !== "referenceNumber" &&
    (["referenceno", "referancenumber"].includes(labelKey(field.label)) ||
      ["referenceNo", "referenceNumber"].includes(field.key))
  );
  const loNumber = settings.find((field) => field.key === "loNumber");
  const referenceType = settings.find((field) => field.key === "referenceType");
  const referenceDate = settings.find((field) => field.key === "referenceDate");
  const referenceNumber = settings.find((field) => field.key === "referenceNumber");
  const hasLegacyLoNumberLabel = loNumber && labelKey(loNumber.label) !== "lonumber";
  const missingDedicatedReferenceNumber = !referenceNumber && referenceType && referenceDate;
  const needsRepair = hasLegacyLoNumberLabel || legacyNumberFields.length > 0 || missingDedicatedReferenceNumber;
  if (!needsRepair) return settings;

  const repaired = settings.filter((field) => !legacyNumberFields.includes(field)).map((field) => ({ ...field }));
  const fallbackSection = repaired.find((field) =>
    ["referenceType", "referenceNumber", "referenceDate"].includes(field.key)
  )?.section || defaultByKey.get("loNumber").section;
  const ensureField = (key) => {
    let field = repaired.find((item) => item.key === key);
    if (!field) {
      const base = defaultByKey.get(key);
      field = { ...base, section: fallbackSection, required: false, options: [...base.options] };
      repaired.push(field);
    }
    return field;
  };

  const repairedLoNumber = ensureField("loNumber");
  repairedLoNumber.label = "LO Number";
  const repairedReferenceType = ensureField("referenceType");
  repairedReferenceType.label = "Type Of Reference";
  repairedReferenceType.type = "select";
  if (!repairedReferenceType.options.length) {
    repairedReferenceType.options = [...defaultByKey.get("referenceType").options];
  }

  const repairedReferenceNumber = repaired.find((field) => field.key === "referenceNumber") ||
    legacyNumberFields[0];
  if (repairedReferenceNumber) {
    repairedReferenceNumber.key = "referenceNumber";
    repairedReferenceNumber.label = "Reference No";
    repairedReferenceNumber.type = "text";
    if (!repaired.includes(repairedReferenceNumber)) repaired.push(repairedReferenceNumber);
  } else {
    ensureField("referenceNumber");
  }
  const repairedReferenceDate = ensureField("referenceDate");
  repairedReferenceDate.label = "Reference Date";
  repairedReferenceDate.type = "date";

  return orderReferenceFields(repaired);
}

function validateAppearance(appearance) {
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
    return "Appearance settings must be an object.";
  }
  const keys = Object.keys(defaultAppearance);
  if (Object.keys(appearance).length !== keys.length || keys.some((key) => !Object.hasOwn(appearance, key))) {
    return "Appearance settings must include every supported color.";
  }
  for (const key of keys) {
    if (typeof appearance[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(appearance[key])) {
      return `${key} must be a six-digit hexadecimal color.`;
    }
  }
  return Object.fromEntries(keys.map((key) => [key, appearance[key].toLowerCase()]));
}

async function getAppearance(pool) {
  const result = await pool.request().query(`
    SELECT SettingsJson
    FROM dbo.TenderAppearanceSettings
    WHERE Id = 1
  `);
  if (!result.recordset.length) return { ...defaultAppearance };
  const saved = JSON.parse(result.recordset[0].SettingsJson);
  const validated = validateAppearance(saved);
  if (typeof validated === "string") throw new Error(`Saved appearance settings are invalid: ${validated}`);
  return validated;
}

function publishAppearance(appearance) {
  const event = `event: appearance-settings\ndata: ${JSON.stringify(appearance)}\n\n`;
  for (const response of appearanceSubscribers) {
    if (response.destroyed || response.writableEnded) {
      appearanceSubscribers.delete(response);
      continue;
    }
    response.write(event);
  }
}

function validateFieldSettings(settings) {
  if (!Array.isArray(settings) || settings.length < 1 || settings.length > 150) {
    return "Field settings must include between 1 and 150 form fields.";
  }
  if (Buffer.byteLength(JSON.stringify(settings), "utf8") > 200 * 1024) {
    return "Field configuration is too large. Reduce the number or length of dropdown choices.";
  }
  const settingsByKey = new Map();
  const allowedTypes = new Set(["text", "number", "date", "select", "textarea"]);
  for (const setting of settings) {
    if (!setting || typeof setting !== "object" || Array.isArray(setting)) {
      return "Each field setting must be an object.";
    }
    if (typeof setting.key !== "string" || !/^[a-z][A-Za-z0-9]{1,63}$/.test(setting.key) || settingsByKey.has(setting.key)) {
      return "Field keys must be unique and use letters and numbers only.";
    }
    const label = typeof setting.label === "string" ? setting.label.trim() : "";
    const tab = typeof setting.tab === "string" ? setting.tab.trim() : "";
    const section = typeof setting.section === "string" ? setting.section.trim() : "";
    if (!label || label.length > 100) return "Field labels must contain 1 to 100 characters.";
    if (!workflowTabs.includes(tab)) return `${label} must belong to one of the four workflow tabs.`;
    if (!section || section.length > 80) return `${label} must have a category containing 1 to 80 characters.`;
    if (!allowedTypes.has(setting.type)) return `${label} has an invalid input type.`;
    if (typeof setting.required !== "boolean") return `${label} must have a valid required setting.`;
    if (!Array.isArray(setting.options) || setting.options.length > 100) {
      return `${label} can have at most 100 dropdown choices.`;
    }
    if (setting.options.some((option) => typeof option !== "string" || !option.trim() || option.length > 100)) {
      return `${label} dropdown choices must be non-empty text up to 100 characters.`;
    }
    const normalizedOptions = setting.options.map((option) => option.trim());
    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      return `${label} dropdown choices must not contain duplicates.`;
    }
    const normalized = {
      key: setting.key,
      label,
      tab,
      section,
      type: setting.type,
      required: false,
      options: normalizedOptions,
      ...(setting.system === true ? { system: true } : {})
    };
    if (setting.step !== undefined) {
      if (!["1", "0.01", "any"].includes(String(setting.step))) return `${label} has an invalid number step.`;
      normalized.step = String(setting.step);
    }
    if (setting.min !== undefined) {
      if (typeof setting.min !== "string" || !/^-?\d{1,12}(\.\d{1,4})?$/.test(setting.min)) return `${label} has an invalid minimum value.`;
      normalized.min = setting.min;
    }
    if (setting.maxLength !== undefined) {
      if (!Number.isInteger(setting.maxLength) || setting.maxLength < 1 || setting.maxLength > 4000) {
        return `${label} has an invalid maximum text length.`;
      }
      normalized.maxLength = setting.maxLength;
    }
    if (setting.pattern !== undefined) {
      if (typeof setting.pattern !== "string" || setting.pattern.length > 200) return `${label} has an invalid text pattern.`;
      try {
        new RegExp(`^(?:${setting.pattern})$`);
      } catch {
        return `${label} has an invalid text pattern.`;
      }
      normalized.pattern = setting.pattern;
    }
    settingsByKey.set(setting.key, normalized);
  }
  const branchField = settingsByKey.get("branch");
  if (!branchField) return "The Branch field must remain on the form to generate unique record IDs.";
  if (branchField.tab !== "Tender Details" || !["text", "select"].includes(branchField.type)) {
    return "Branch must remain a text or dropdown field in the Tender Details tab.";
  }
  const workflowFieldRequirements = {
    assignTo: { tab: "Approval", type: "select" },
    approvalStatus: { tab: "Approval", type: "select" },
    jobStatus: { tab: "Banking", type: "select" },
    approvalLoginName: { tab: "Approval", type: "text" },
    approvalDateTime: { tab: "Approval", type: "text" }
  };
  for (const [key, required] of Object.entries(workflowFieldRequirements)) {
    const systemField = settingsByKey.get(key);
    if (!systemField || systemField.tab !== required.tab || systemField.type !== required.type) {
      return `${key} must remain as a ${required.type} field in the ${required.tab} tab.`;
    }
    systemField.system = true;
    systemField.required = false;
  }
  return [...settingsByKey.values()];
}

async function getFieldSettings(pool) {
  const result = await pool.request().query(`
    SELECT SettingsJson
    FROM dbo.TenderFieldSettings
    WHERE Id = 1
  `);
  if (!result.recordset.length) return defaultFieldSettings();
  const savedSettings = JSON.parse(result.recordset[0].SettingsJson);
  const defaultSettings = defaultFieldSettings();
  const baseByKey = new Map(defaultSettings.map((field) => [field.key, field]));
  const savedByKey = Array.isArray(savedSettings)
    ? new Map(savedSettings.filter((setting) => setting && typeof setting.key === "string").map((setting) => [setting.key, setting]))
    : new Map();
  const isLegacySettings = Array.isArray(savedSettings) && savedSettings.some((setting) => !setting.tab);
  const compatibleSettings = Array.isArray(savedSettings)
    ? (isLegacySettings
      ? defaultSettings.map((field) => ({
        ...field,
        ...(savedByKey.has(field.key) ? savedByKey.get(field.key) : {}),
        required: false
      }))
      : [
        ...savedSettings.map((setting) => ({ ...baseByKey.get(setting.key), ...setting })),
        ...defaultSettings.filter((field) => field.system === true && !savedByKey.has(field.key))
      ])
    : savedSettings;
  if (Array.isArray(compatibleSettings) && !compatibleSettings.some((field) => field.key === "operationRemarks")) {
    compatibleSettings.push({ ...defaultSettings.find((field) => field.key === "operationRemarks") });
  }
  const referenceType = Array.isArray(compatibleSettings)
    ? compatibleSettings.find((setting) => setting.key === "referenceType")
    : undefined;
  includeDefaultDropdownOptions(referenceType, dropdownOptions.referenceType || []);
  const jobType = Array.isArray(compatibleSettings)
    ? compatibleSettings.find((setting) => setting.key === "jobType")
    : undefined;
  includeDefaultDropdownOptions(jobType, dropdownOptions.jobType || []);
  const requisitionType = Array.isArray(compatibleSettings)
    ? compatibleSettings.find((setting) => setting.key === "requisitionType")
    : undefined;
  includeDefaultDropdownOptions(requisitionType, dropdownOptions.requisitionType || []);
  for (const key of ["approvalStatus", "jobStatus"]) {
    const workflowStatus = Array.isArray(compatibleSettings)
      ? compatibleSettings.find((setting) => setting.key === key)
      : undefined;
    includeDefaultDropdownOptions(workflowStatus, dropdownOptions[key] || []);
  }
  const orderedSettings = Array.isArray(compatibleSettings) ? repairLegacyReferenceFields(compatibleSettings) : compatibleSettings;
  const validated = validateFieldSettings(orderedSettings);
  if (typeof validated === "string") throw new Error(`Saved field settings are invalid: ${validated}`);
  return validated;
}

async function getTabAccessSettings(pool) {
  const result = await pool.request().query(`
    SELECT SettingsJson
    FROM dbo.TenderTabAccessSettings
    WHERE Id = 1
  `);
  const defaults = {
    operation: defaultTabAccess("operation"),
    banking: defaultTabAccess("banking"),
    user: defaultTabAccess("operation"),
    approver: defaultTabAccess("approver")
  };
  if (!result.recordset.length) return defaults;
  const saved = JSON.parse(result.recordset[0].SettingsJson);
  const validated = normalizeTabAccess(saved);
  if (typeof validated === "string") throw new Error(`Saved role permissions are invalid: ${validated}`);
  const oldOperationDefaults = {
    "Tender Details": { view: true, edit: true },
    Operation: { view: true, edit: true },
    Banking: { view: false, edit: false },
    Approval: { view: false, edit: false }
  };
  if (JSON.stringify(validated.operation) === JSON.stringify(oldOperationDefaults)) {
    validated.operation = defaultTabAccess("operation");
  }
  return { ...defaults, ...validated };
}

async function getUserAccessSettings(pool) {
  const result = await pool.request().query(`
    SELECT SettingsJson
    FROM dbo.TenderUserAccessSettings
    WHERE Id = 1
  `);
  if (!result.recordset.length) return {};
  const saved = JSON.parse(result.recordset[0].SettingsJson);
  const validated = normalizeTabAccess(saved);
  if (typeof validated === "string") throw new Error(`Saved per-user permissions are invalid: ${validated}`);
  return validated;
}

async function getEffectiveTabAccess(pool, username, role) {
  const [roles, users] = await Promise.all([getTabAccessSettings(pool), getUserAccessSettings(pool)]);
  return resolveUserTabAccess(roles, users, username, role);
}

async function listLoginAccounts(pool) {
  const usernameColumn = sqlIdentifier(process.env.LOGIN_USERNAME_COLUMN || "Username", "LOGIN_USERNAME_COLUMN");
  const roleColumn = sqlIdentifier(process.env.LOGIN_ROLE_COLUMN || "Role", "LOGIN_ROLE_COLUMN");
  const branchColumn = sqlIdentifier(process.env.LOGIN_BRANCH_COLUMN || "Branch_Name", "LOGIN_BRANCH_COLUMN");
  const result = await pool.request().query(`
    SELECT ${usernameColumn} AS username, ${roleColumn} AS roleName, ${branchColumn} AS branchName
    FROM dbo.userlogin
    WHERE ${usernameColumn} IS NOT NULL AND LTRIM(RTRIM(${usernameColumn})) <> ''
    ORDER BY ${usernameColumn}
  `);
  return result.recordset.map((row) => ({
    username: String(row.username).trim(),
    role: String(row.roleName || "").trim(),
    branch: String(row.branchName || "").trim()
  }));
}

function resolveUserTabAccess(roleSettings, userSettings, username, role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "admin" || normalizedRole === "approver") return roleSettings;
  const userPermissions = userSettings[String(username || "").trim().toLowerCase()];
  return userPermissions
    ? { ...roleSettings, [normalizedRole]: userPermissions }
    : roleSettings;
}

async function getEffectiveFieldSettings(pool) {
  const settings = await getFieldSettings(pool);
  const assignTo = settings.find((field) => field.key === "assignTo");
  if (assignTo) {
    assignTo.options = await getApproverUsernames(pool);
  }
  return settings;
}

async function getApproverUsernames(pool) {
  const usernameColumn = sqlIdentifier(process.env.LOGIN_USERNAME_COLUMN || "Username", "LOGIN_USERNAME_COLUMN");
  const roleColumn = sqlIdentifier(process.env.LOGIN_ROLE_COLUMN || "Role", "LOGIN_ROLE_COLUMN");
  const result = await pool.request()
    .input("approverRole", sql.NVarChar(80), "approver")
    .query(`
      SELECT ${usernameColumn} AS username
      FROM dbo.userlogin
      WHERE LOWER(LTRIM(RTRIM(${roleColumn}))) = @approverRole
        AND (LOWER(${usernameColumn}) LIKE '%rahul%' OR LOWER(${usernameColumn}) LIKE '%amrita%')
      ORDER BY ${usernameColumn}
    `);
  return result.recordset
    .map((row) => String(row.username || "").trim())
    .filter(Boolean);
}

function isAdmin(req) {
  return String(req.session.role || "").trim().toLowerCase() === "admin";
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: "Administrator access is required." });
  next();
}

function publishFieldSettings(settings, tabAccess, userAccess = {}) {
  for (const [response, identity] of fieldSettingsSubscribers) {
    if (response.destroyed || response.writableEnded) {
      fieldSettingsSubscribers.delete(response);
      continue;
    }
    const effectiveAccess = resolveUserTabAccess(
      tabAccess, userAccess, identity.username, identity.role
    );
    const visibleSettings = fieldsForRole(settings, effectiveAccess, identity.role, "view", identity.username);
    response.write(`event: field-settings\ndata: ${JSON.stringify(visibleSettings)}\n\n`);
  }
}

function publishRecordUpdate() {
  for (const [response] of recordSubscribers) {
    if (response.destroyed || response.writableEnded) {
      recordSubscribers.delete(response);
      continue;
    }
    response.write("event: records-updated\ndata: {}\n\n");
  }
}

function normalizeWorkflowStatus(data) {
  if (data.jobStatus === "Processed") return "Processed";
  if (data.approvalStatus === "Not Approved") return "Not Approved";
  if (data.approvalStatus === "Approved") return "Pending Banking";
  return "Pending Approval";
}

function formatStoredIndiaTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()} ` +
    `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")} IST`;
}

function mergeStoredWorkflowData(formData, row) {
  return {
    ...formData,
    ...(row.Branch !== null && row.Branch !== undefined ? { branch: String(row.Branch) } : {}),
    ...(row.AssignedTo !== null && row.AssignedTo !== undefined ? { assignTo: String(row.AssignedTo) } : {}),
    ...(row.ApprovalStatus !== null && row.ApprovalStatus !== undefined
      ? { approvalStatus: String(row.ApprovalStatus) }
      : {}),
    ...(row.JobStatus !== null && row.JobStatus !== undefined ? { jobStatus: String(row.JobStatus) } : {}),
    ...(row.ReviewedBy !== null && row.ReviewedBy !== undefined ? { reviewedBy: String(row.ReviewedBy) } : {}),
    ...(!formData.reviewedAt && row.ReviewedAt !== null && row.ReviewedAt !== undefined
      ? { reviewedAt: formatStoredIndiaTimestamp(row.ReviewedAt) }
      : {}),
    ...(row.ProcessedBy !== null && row.ProcessedBy !== undefined ? { processedBy: String(row.ProcessedBy) } : {}),
    ...(!formData.processedAt && row.ProcessedAt !== null && row.ProcessedAt !== undefined
      ? { processedAt: formatStoredIndiaTimestamp(row.ProcessedAt) }
      : {})
  };
}

function workflowSummary(data, approvers) {
  const assignedTo = String(data.assignTo || "").trim();
  const reviewedBy = String(data.reviewedBy || "").trim();
  const approvalDecision = String(data.approvalStatus || "Pending");
  const normalizedAssignedTo = assignedTo.toLowerCase();
  const normalizedReviewedBy = reviewedBy.toLowerCase();
  const rahul = approvers.find((username) => username.toLowerCase().includes("rahul"));
  const amrita = approvers.find((username) => username.toLowerCase().includes("amrita"));
  const statusForReviewer = (username, reviewerName) => {
    const normalizedReviewerName = reviewerName.toLowerCase();
    const assignedToReviewer = normalizedAssignedTo.includes(normalizedReviewerName) ||
      Boolean(username && normalizedAssignedTo === username.toLowerCase());
    const reviewedByReviewer = normalizedReviewedBy === normalizedReviewerName ||
      normalizedReviewedBy.includes(normalizedReviewerName) ||
      Boolean(username && normalizedReviewedBy === username.toLowerCase());
    if (reviewedByReviewer && approvalDecision !== "Pending") return approvalDecision;
    if (!assignedToReviewer) return "Not assigned";
    if (approvalDecision === "Pending") return "Pending";
    if (normalizedReviewedBy && !reviewedByReviewer) {
      return `${approvalDecision} by ${reviewedBy}`;
    }
    return approvalDecision;
  };
  const bankingStatus = approvalDecision !== "Approved"
    ? "Waiting for approval"
    : data.jobStatus === "Processed" ? "Processed" : "Pending";
  return {
    rahul: { name: "Rahul", status: statusForReviewer(rahul, "rahul") },
    amrita: { name: "Amrita", status: statusForReviewer(amrita, "amrita") },
    banking: {
      status: data.jobStatus === "Processed" ? "Approved" : bankingStatus,
      processedBy: data.jobStatus === "Processed" ? String(data.processedBy || "") : "",
      processedAt: data.jobStatus === "Processed" ? String(data.processedAt || "") : ""
    }
  };
}

function indiaTimestamp(value = new Date()) {
  const dateTimeFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    dateTimeFormat.formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  const indiaDateTime = new Date(Date.UTC(
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, value.getUTCMilliseconds()
  ));
  const formatted = `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year} ` +
    `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")} IST`;
  return { date: indiaDateTime, formatted };
}

function canAccessRecord(req, data) {
  const role = String(req.session.role || "").trim().toLowerCase();
  if (role === "admin") return true;
  if (isBankingUser(req.session.user, role)) {
    return String(data.approvalStatus || "").trim().toLowerCase() === "approved";
  }
  if (role === "approver") return String(data.assignTo || "").toLowerCase() === String(req.session.user || "").toLowerCase();
  if (isBranchScopedRole(role)) {
    return String(data.branch || "").trim().toLowerCase() === String(req.session.branch || "").trim().toLowerCase();
  }
  return false;
}

function canCompleteBanking(req) {
  const role = String(req.session.role || "").trim().toLowerCase();
  return role === "admin" || isBankingUser(req.session.user, role);
}

function canReviewRecord(req, data) {
  const role = String(req.session.role || "").trim().toLowerCase();
  if (role === "admin") return data.approvalStatus === "Pending";
  return role === "approver" &&
    String(data.assignTo || "").trim().toLowerCase() === String(req.session.user || "").trim().toLowerCase() &&
    data.approvalStatus === "Pending";
}

function isConfiguredApprover(username, approvers) {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  return Boolean(normalizedUsername) &&
    approvers.some((approver) => String(approver || "").trim().toLowerCase() === normalizedUsername);
}

function canSubmitReview(req, data, approvers) {
  const role = String(req.session.role || "").trim().toLowerCase();
  return canReviewRecord(req, data) &&
    (role === "admin" || isConfiguredApprover(req.session.user, approvers));
}

function canDownloadTenderOperationPdf(req, data, approvers) {
  const role = String(req.session.role || "").trim().toLowerCase();
  if (role === "admin") return true;
  const username = String(req.session.user || "").trim().toLowerCase();
  return role === "approver" &&
    isConfiguredApprover(username, approvers) &&
    String(data.assignTo || "").trim().toLowerCase() === username;
}

function tenderExportScope(req) {
  const role = String(req.session.role || "").trim().toLowerCase();
  if (role === "admin" || isBankingUser(req.session.user, role)) {
    return { where: "", parameter: null };
  }
  if (role === "approver") {
    return {
      where: "WHERE LOWER(LTRIM(RTRIM(ISNULL(AssignedTo, N'')))) = LOWER(LTRIM(RTRIM(@assignedTo)))",
      parameter: { name: "assignedTo", value: req.session.user }
    };
  }
  return {
    where: "WHERE LOWER(LTRIM(RTRIM(ISNULL(Branch, N'')))) = LOWER(LTRIM(RTRIM(@branch)))",
    parameter: { name: "branch", value: req.session.branch || "" }
  };
}

function canRejectQueuedRequest(req, data) {
  const role = String(req.session.role || "").trim().toLowerCase();
  const approvalStatus = String(data.approvalStatus || "").trim().toLowerCase();
  const jobStatus = String(data.jobStatus || "").trim().toLowerCase();
  if (jobStatus === "processed" || approvalStatus === "not approved") return false;
  if (role === "admin") {
    return approvalStatus === "pending" || approvalStatus === "approved";
  }
  return canCompleteBanking(req) && approvalStatus === "approved";
}

function normalizeTenderFormData(data, fieldSettings = defaultFieldSettings(), partial = false) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "Form data must be an object.";
  const allowedKeys = new Set(fieldSettings.map((field) => field.key));
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) return "The form contains an unknown field.";

  const normalized = {};
  for (const setting of fieldSettings) {
    if (partial && !Object.prototype.hasOwnProperty.call(data, setting.key)) continue;
    const value = data[setting.key];
    if (value === null || value === undefined) {
      normalized[setting.key] = "";
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      normalized[setting.key] = String(value);
    } else {
      return `${setting.label} must be a simple text value or blank.`;
    }
  }
  return normalized;
}

function validateTenderForm(data, fieldSettings = defaultFieldSettings(), partial = false) {
  const normalized = normalizeTenderFormData(data, fieldSettings, partial);
  return typeof normalized === "string" ? normalized : null;
}

function handleAsync(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  return csrfProtection(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === "/" || /\.(?:html|js|css)$/i.test(req.path)) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.get("/api/csrf", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ csrfToken: ensureCsrfToken(req) });
});

app.get("/api/appearance", handleAsync(async (_req, res) => {
  const pool = await getPool();
  res.set("Cache-Control", "no-store");
  res.json(await getAppearance(pool));
}));
app.get("/api/appearance/events", handleAsync(async (req, res) => {
  const pool = await getPool();
  const appearance = await getAppearance(pool);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders();
  appearanceSubscribers.add(res);
  res.write(`event: appearance-settings\ndata: ${JSON.stringify(appearance)}\n\n`);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25000);
  res.on("close", () => {
    clearInterval(heartbeat);
    appearanceSubscribers.delete(res);
  });
}));
app.post("/api/login", loginLimiter, handleAsync(async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !password || username.length > 100 || password.length > 1024) {
    return res.status(400).json({ error: "Enter a valid username and password." });
  }

  const usernameColumn = sqlIdentifier(process.env.LOGIN_USERNAME_COLUMN || "Username", "LOGIN_USERNAME_COLUMN");
  const passwordColumn = sqlIdentifier(process.env.LOGIN_PASSWORD_COLUMN || "Password", "LOGIN_PASSWORD_COLUMN");
  const branchColumn = sqlIdentifier(process.env.LOGIN_BRANCH_COLUMN || "Branch_Name", "LOGIN_BRANCH_COLUMN");
  const roleColumn = sqlIdentifier(process.env.LOGIN_ROLE_COLUMN || "Role", "LOGIN_ROLE_COLUMN");
  const pool = await getPool();
  const result = await pool.request()
    .input("username", sql.VarChar(100), username)
    .query(`SELECT TOP (1) ${passwordColumn} AS storedPassword, ${branchColumn} AS branchName, ${roleColumn} AS roleName FROM dbo.userlogin WHERE ${usernameColumn} = @username`);
  const user = result.recordset[0];
  const storedPassword = user?.storedPassword;
  const valid = typeof storedPassword === "string" && await verifyPassword(password, storedPassword);
  if (!valid) return res.status(401).json({ error: "The username or password is incorrect." });

  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: "Unable to start a secure session." });
    req.session.user = username;
    req.session.branch = user.branchName || "";
    req.session.role = user.roleName || "";
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: "Unable to start a secure session." });
      return res.json({ ok: true });
    });
  });
}));

app.get("/api/me", requireLogin, (req, res) => res.json({
  username: req.session.user,
  branch: req.session.branch,
  role: req.session.role
}));
app.post("/api/appearance", requireLogin, requireAdmin, handleAsync(async (req, res) => {
  const appearance = validateAppearance(req.body?.appearance);
  if (typeof appearance === "string") return res.status(400).json({ error: appearance });
  const pool = await getPool();
  await pool.request()
    .input("settingsJson", sql.NVarChar(sql.MAX), JSON.stringify(appearance))
    .input("updatedBy", sql.NVarChar(100), req.session.user)
    .query(`
      MERGE dbo.TenderAppearanceSettings WITH (HOLDLOCK) AS target
      USING (SELECT CAST(1 AS TINYINT) AS Id) AS source
      ON target.Id = source.Id
      WHEN MATCHED THEN
        UPDATE SET SettingsJson = @settingsJson, UpdatedBy = @updatedBy, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (Id, SettingsJson, UpdatedBy, UpdatedAt)
        VALUES (1, @settingsJson, @updatedBy, SYSUTCDATETIME());
    `);
  publishAppearance(appearance);
  res.json({ ok: true, appearance });
}));
app.get("/api/field-settings", requireLogin, handleAsync(async (req, res) => {
  const pool = await getPool();
  const [settings, roles, users] = await Promise.all([
    getEffectiveFieldSettings(pool), getTabAccessSettings(pool), getUserAccessSettings(pool)
  ]);
  const tabAccess = resolveUserTabAccess(roles, users, req.session.user, req.session.role);
  res.set("Cache-Control", "no-store");
  res.json(fieldsForRole(settings, tabAccess, req.session.role, "view", req.session.user));
}));
app.get("/api/field-settings/events", requireLogin, handleAsync(async (req, res) => {
  const pool = await getPool();
  const [settings, roles, users] = await Promise.all([
    getEffectiveFieldSettings(pool), getTabAccessSettings(pool), getUserAccessSettings(pool)
  ]);
  const tabAccess = resolveUserTabAccess(roles, users, req.session.user, req.session.role);
  const visibleSettings = fieldsForRole(settings, tabAccess, req.session.role, "view", req.session.user);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders();
  fieldSettingsSubscribers.set(res, { role: req.session.role, username: req.session.user });
  res.write(`event: field-settings\ndata: ${JSON.stringify(visibleSettings)}\n\n`);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25000);
  res.on("close", () => {
    clearInterval(heartbeat);
    fieldSettingsSubscribers.delete(res);
  });
}));
app.post("/api/field-settings", requireLogin, requireAdmin, handleAsync(async (req, res) => {
  const validatedSettings = validateFieldSettings(req.body?.fields);
  if (typeof validatedSettings === "string") return res.status(400).json({ error: validatedSettings });
  const settings = orderReferenceFields(validatedSettings);
  const pool = await getPool();
  await pool.request()
    .input("settingsJson", sql.NVarChar(sql.MAX), JSON.stringify(settings))
    .input("updatedBy", sql.NVarChar(100), req.session.user)
    .query(`
      MERGE dbo.TenderFieldSettings WITH (HOLDLOCK) AS target
      USING (SELECT CAST(1 AS TINYINT) AS Id) AS source
      ON target.Id = source.Id
      WHEN MATCHED THEN
        UPDATE SET SettingsJson = @settingsJson, UpdatedBy = @updatedBy, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (Id, SettingsJson, UpdatedBy, UpdatedAt)
        VALUES (1, @settingsJson, @updatedBy, SYSUTCDATETIME());
    `);
  const [currentSettings, tabAccess, userAccess] = await Promise.all([
    getEffectiveFieldSettings(pool), getTabAccessSettings(pool), getUserAccessSettings(pool)
  ]);
  publishFieldSettings(currentSettings, tabAccess, userAccess);
  res.json({ ok: true, fields: settings });
}));
app.get("/api/tab-access", requireLogin, requireAdmin, handleAsync(async (_req, res) => {
  const pool = await getPool();
  res.set("Cache-Control", "no-store");
  const [roles, userOverrides, accounts] = await Promise.all([
    getTabAccessSettings(pool), getUserAccessSettings(pool), listLoginAccounts(pool)
  ]);
  res.json({
    roles,
    userOverrides,
    accounts: accounts.map((account) => {
      const override = userOverrides[account.username.toLowerCase()];
      return {
        ...account,
        custom: Boolean(override),
        permissions: override || roles[account.role.toLowerCase()] || defaultTabAccess(account.role)
      };
    })
  });
}));
app.post("/api/tab-access", requireLogin, requireAdmin, handleAsync(async (req, res) => {
  const validated = normalizeTabAccess(req.body?.permissions);
  if (typeof validated === "string") return res.status(400).json({ error: validated });
  const validatedUsers = normalizeTabAccess(req.body?.userPermissions || {});
  if (typeof validatedUsers === "string") return res.status(400).json({ error: validatedUsers });
  const permissions = {
    operation: defaultTabAccess("operation"),
    banking: defaultTabAccess("banking"),
    approver: defaultTabAccess("approver"),
    ...validated
  };
  permissions.approver = defaultTabAccess("approver");
  const pool = await getPool();
  const accounts = await listLoginAccounts(pool);
  const validUsernames = new Set(accounts.map((account) => account.username.toLowerCase()));
  for (const username of Object.keys(validatedUsers)) {
    if (!validUsernames.has(username)) {
      return res.status(400).json({ error: `No login account exists for ${username}.` });
    }
    const account = accounts.find((item) => item.username.toLowerCase() === username);
    if (["admin", "approver"].includes(account.role.toLowerCase())) {
      return res.status(400).json({ error: `${account.username} uses fixed administrator or approver permissions.` });
    }
  }
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input("settingsJson", sql.NVarChar(sql.MAX), JSON.stringify(permissions))
      .input("updatedBy", sql.NVarChar(100), req.session.user)
      .query(`
        MERGE dbo.TenderTabAccessSettings WITH (HOLDLOCK) AS target
        USING (SELECT CAST(1 AS TINYINT) AS Id) AS source
        ON target.Id = source.Id
        WHEN MATCHED THEN
          UPDATE SET SettingsJson = @settingsJson, UpdatedBy = @updatedBy, UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (Id, SettingsJson, UpdatedBy, UpdatedAt)
          VALUES (1, @settingsJson, @updatedBy, SYSUTCDATETIME());
      `);
    await new sql.Request(transaction)
      .input("settingsJson", sql.NVarChar(sql.MAX), JSON.stringify(validatedUsers))
      .input("updatedBy", sql.NVarChar(100), req.session.user)
      .query(`
        MERGE dbo.TenderUserAccessSettings WITH (HOLDLOCK) AS target
        USING (SELECT CAST(1 AS TINYINT) AS Id) AS source
        ON target.Id = source.Id
        WHEN MATCHED THEN
          UPDATE SET SettingsJson = @settingsJson, UpdatedBy = @updatedBy, UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (Id, SettingsJson, UpdatedBy, UpdatedAt)
          VALUES (1, @settingsJson, @updatedBy, SYSUTCDATETIME());
      `);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
  const [fieldSettings, currentRoles] = await Promise.all([
    getEffectiveFieldSettings(pool), getTabAccessSettings(pool)
  ]);
  publishFieldSettings(fieldSettings, currentRoles, validatedUsers);
  res.json({
    ok: true,
    permissions,
    userOverrides: validatedUsers,
    accounts: accounts.map((account) => {
      const override = validatedUsers[account.username.toLowerCase()];
      return {
        ...account,
        custom: Boolean(override),
        permissions: override || permissions[account.role.toLowerCase()] || defaultTabAccess(account.role)
      };
    })
  });
}));
app.get("/api/tenders", requireLogin, handleAsync(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const pool = await getPool();
  const [settings, tabAccess] = await Promise.all([
    getEffectiveFieldSettings(pool), getEffectiveTabAccess(pool, req.session.user, req.session.role)
  ]);
  const approvers = await getApproverUsernames(pool);
  const access = getRoleTabAccess(tabAccess, req.session.role, req.session.user);
  const request = pool.request();
  const role = String(req.session.role || "").trim().toLowerCase();
  let scope = "";
  if (isBankingUser(req.session.user, role)) {
    scope = "WHERE ApprovalStatus = N'Approved'";
  } else if (isBranchScopedRole(role)) {
    request.input("branch", sql.NVarChar(sql.MAX), req.session.branch || "");
    scope = "WHERE Branch = @branch";
  } else if (role === "approver") {
    request.input("assignedTo", sql.NVarChar(200), req.session.user);
    scope = "WHERE LOWER(LTRIM(RTRIM(ISNULL(AssignedTo, N'')))) = LOWER(LTRIM(RTRIM(@assignedTo)))";
  } else if (role === "banking") {
    scope = "WHERE ApprovalStatus = N'Approved'";
  }
  const result = await request.query(`
    SELECT TOP (100) RecordId, UniqueId, CreatedBy, UpdatedAt, FormData, Branch, AssignedTo,
      ApprovalStatus, JobStatus, ReviewedBy, ReviewedAt, ProcessedBy, ProcessedAt
    FROM dbo.TenderRecords
    ${scope}
    ORDER BY UpdatedAt DESC, RecordId DESC
  `);
  const records = result.recordset.map((row) => {
    const data = mergeStoredWorkflowData(JSON.parse(row.FormData), row);
    return {
      id: row.RecordId,
      uniqueId: row.UniqueId || "",
      createdBy: row.CreatedBy,
      createdAt: row.UpdatedAt,
      status: normalizeWorkflowStatus(data),
      workflow: workflowSummary(data, approvers),
      formData: filterRecordData(data, settings, access)
    };
  });
  res.json(records);
}));
app.get("/api/dashboard/summary", requireLogin, handleAsync(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const pool = await getPool();
  const request = pool.request();
  const role = String(req.session.role || "").trim().toLowerCase();
  let scope = "";
  if (isBankingUser(req.session.user, role)) {
    scope = "WHERE ApprovalStatus = N'Approved'";
  } else if (isBranchScopedRole(role)) {
    request.input("branch", sql.NVarChar(sql.MAX), req.session.branch || "");
    scope = "WHERE Branch = @branch";
  } else if (role === "approver") {
    request.input("assignedTo", sql.NVarChar(200), req.session.user);
    scope = "WHERE LOWER(LTRIM(RTRIM(ISNULL(AssignedTo, N'')))) = LOWER(LTRIM(RTRIM(@assignedTo)))";
  } else if (role === "banking") {
    scope = "WHERE ApprovalStatus = N'Approved'";
  }
  const result = await request.query(`
    SELECT
      COUNT_BIG(*) AS total,
      SUM(CASE
        WHEN LOWER(LTRIM(RTRIM(ISNULL(ApprovalStatus, N'')))) = N'approved'
          AND LOWER(LTRIM(RTRIM(ISNULL(JobStatus, N'')))) = N'processed'
        THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0)
      END) AS approved,
      SUM(CASE WHEN LOWER(LTRIM(RTRIM(ISNULL(ApprovalStatus, N'')))) = N'not approved' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END) AS notApproved,
      SUM(CASE
        WHEN LOWER(LTRIM(RTRIM(ISNULL(ApprovalStatus, N'')))) = N'not approved' THEN CONVERT(BIGINT, 0)
        WHEN LOWER(LTRIM(RTRIM(ISNULL(ApprovalStatus, N'')))) = N'approved'
          AND LOWER(LTRIM(RTRIM(ISNULL(JobStatus, N'')))) = N'processed' THEN CONVERT(BIGINT, 0)
        ELSE CONVERT(BIGINT, 1)
      END) AS pending
    FROM dbo.TenderRecords
    ${scope}
  `);
  const row = result.recordset[0];
  res.json({
    total: Number(row.total || 0),
    approved: Number(row.approved || 0),
    notApproved: Number(row.notApproved || 0),
    pending: Number(row.pending || 0)
  });
}));
app.get("/api/tenders/events", requireLogin, (req, res) => {
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders();
  recordSubscribers.set(res, { role: req.session.role, user: req.session.user, branch: req.session.branch });
  res.write("event: records-updated\ndata: {}\n\n");
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25000);
  res.on("close", () => {
    clearInterval(heartbeat);
    recordSubscribers.delete(res);
  });
});
app.get("/api/tenders/export.xlsx", requireLogin, handleAsync(async (req, res) => {
  const pool = await getPool();
  const [settings, tabAccess] = await Promise.all([
    getEffectiveFieldSettings(pool), getEffectiveTabAccess(pool, req.session.user, req.session.role)
  ]);
  const role = String(req.session.role || "").trim().toLowerCase();
  const scope = tenderExportScope(req);
  const request = pool.request();
  if (scope.parameter) {
    request.input(
      scope.parameter.name,
      scope.parameter.name === "assignedTo" ? sql.NVarChar(200) : sql.NVarChar(sql.MAX),
      scope.parameter.value
    );
  }
  const result = await request.query(`
    SELECT RecordId, UniqueId, CreatedBy, UpdatedAt, FormData, Branch, AssignedTo,
      ApprovalStatus, JobStatus, ReviewedBy, ReviewedAt, ProcessedBy, ProcessedAt
    FROM dbo.TenderRecords
    ${scope.where}
    ORDER BY UpdatedAt DESC, RecordId DESC
  `);
  const approvers = await getApproverUsernames(pool);
  const access = getRoleTabAccess(tabAccess, req.session.role, req.session.user);
  const records = result.recordset.map((row) => {
    const data = mergeStoredWorkflowData(JSON.parse(row.FormData), row);
    return {
      id: row.RecordId,
      uniqueId: row.UniqueId || "",
      createdBy: row.CreatedBy,
      createdAt: row.UpdatedAt,
      status: normalizeWorkflowStatus(data),
      workflow: workflowSummary(data, approvers),
      formData: filterRecordData(data, settings, access)
    };
  });
  const exportableFields = fieldsForRole(settings, tabAccess, req.session.role, "view", req.session.user);
  const workbook = await createTenderExcel({ records, fields: exportableFields });
  const branchSlug = String(req.session.branch || "branch").trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";
  const suffix = isBankingUser(req.session.user, role)
    ? "all-branches"
    : role === "admin" ? "all-branches" : role === "approver" ? "reviewer" : `${branchSlug}-branch`;
  res.set({
    "Cache-Control": "no-store",
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="tender-records-${suffix}.xlsx"`,
    "Content-Length": String(workbook.length)
  });
  res.send(workbook);
}));
app.get("/api/tenders/:id/tender-operation.pdf", requireLogin, handleAsync(async (req, res) => {
  const role = String(req.session.role || "").trim().toLowerCase();
  if (!["approver", "admin"].includes(role)) {
    return res.status(403).json({ error: "An assigned Approver or administrator can download this PDF." });
  }
  const recordId = Number(req.params.id);
  if (!Number.isSafeInteger(recordId) || recordId < 1) {
    return res.status(400).json({ error: "Invalid tender record ID." });
  }
  const pool = await getPool();
  const approvers = await getApproverUsernames(pool);
  const result = await pool.request()
    .input("recordId", sql.Int, recordId)
    .query(`
      SELECT RecordId, UniqueId, FormData, Branch, AssignedTo, ApprovalStatus, JobStatus,
        ReviewedBy, ReviewedAt, ProcessedBy, ProcessedAt
      FROM dbo.TenderRecords WHERE RecordId = @recordId
    `);
  const row = result.recordset[0];
  if (!row) return res.status(404).json({ error: "Tender record not found." });
  const data = mergeStoredWorkflowData(JSON.parse(row.FormData), row);
  if (!canDownloadTenderOperationPdf(req, data, approvers)) {
    return res.status(404).json({ error: "Tender record not found." });
  }
  const fields = (await getEffectiveFieldSettings(pool))
    .filter((field) => ["Tender Details", "Operation"].includes(field.tab));
  const pdf = await createTenderOperationPdf({
    uniqueId: row.UniqueId || `Record-${recordId}`,
    data,
    fields,
    generatedBy: req.session.user,
    generatedAt: indiaTimestamp().formatted,
    createdBy: row.CreatedBy,
    branch: row.Branch,
    reviewedBy: data.reviewedBy,
    reviewedAt: data.reviewedAt
  });
  const filename = String(row.UniqueId || `Tender-${recordId}`).replace(/[^A-Za-z0-9._-]/g, "_");
  res.set({
    "Cache-Control": "no-store",
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}-Tender-Operation.pdf"`,
    "Content-Length": String(pdf.length)
  });
  res.send(pdf);
}));
app.get("/api/tenders/:id", requireLogin, handleAsync(async (req, res) => {
  const recordId = Number(req.params.id);
  if (!Number.isSafeInteger(recordId) || recordId < 1) return res.status(400).json({ error: "Invalid tender record ID." });
  const pool = await getPool();
  const [settings, tabAccess] = await Promise.all([
    getEffectiveFieldSettings(pool), getEffectiveTabAccess(pool, req.session.user, req.session.role)
  ]);
  const approvers = await getApproverUsernames(pool);
  const access = getRoleTabAccess(tabAccess, req.session.role, req.session.user);
  const result = await pool.request()
    .input("recordId", sql.Int, recordId)
    .query(`
      SELECT RecordId, UniqueId, CreatedBy, UpdatedAt, FormData, Branch, AssignedTo,
        ApprovalStatus, JobStatus, ReviewedBy, ReviewedAt, ProcessedBy, ProcessedAt
      FROM dbo.TenderRecords WHERE RecordId = @recordId
    `);
  const row = result.recordset[0];
  if (!row) return res.status(404).json({ error: "Tender record not found." });
  const data = mergeStoredWorkflowData(JSON.parse(row.FormData), row);
  if (!canAccessRecord(req, data)) return res.status(404).json({ error: "Tender record not found." });
  res.set("Cache-Control", "no-store");
  res.json({
    id: row.RecordId,
    uniqueId: row.UniqueId || "",
    createdBy: row.CreatedBy,
    createdAt: row.UpdatedAt,
    status: normalizeWorkflowStatus(data),
    workflow: workflowSummary(data, approvers),
    formData: filterRecordData(data, settings, access)
  });
}));
app.post("/api/tenders", requireLogin, handleAsync(async (req, res) => {
  const pool = await getPool();
  const [settings, tabAccess] = await Promise.all([
    getEffectiveFieldSettings(pool), getEffectiveTabAccess(pool, req.session.user, req.session.role)
  ]);
  const roleAccess = getRoleTabAccess(tabAccess, req.session.role, req.session.user);
  if (!["Tender Details", "Operation"].every((tab) => roleAccess[tab]?.edit)) {
    return res.status(403).json({ error: "This account cannot create tender records." });
  }
  const editableSettings = fieldsForRole(settings, tabAccess, req.session.role, "edit", req.session.user);
  const editableKeys = new Set(editableSettings.map((field) => field.key));
  if (Object.keys(req.body).some((key) => !editableKeys.has(key))) {
    return res.status(403).json({ error: "The form contains fields you are not permitted to submit." });
  }
  const formData = normalizeTenderFormData(req.body, editableSettings);
  if (typeof formData === "string") return res.status(400).json({ error: formData });
  for (const field of editableSettings) {
    if (!Object.prototype.hasOwnProperty.call(formData, field.key)) formData[field.key] = "";
  }
  if (isBranchScopedRole(req.session.role)) {
    formData.branch = String(req.session.branch || "");
  }
  const approvers = await getApproverUsernames(pool);
  if (formData.assignTo && !approvers.some((username) => username.toLowerCase() === formData.assignTo.toLowerCase())) {
    return res.status(400).json({ error: "Assign To must be an account with the Approver role." });
  }
  formData.approvalStatus = "Pending";
  formData.jobStatus = "Pending";
  const { date: approvalDateTime, formatted: approvalDateTimeText } = indiaTimestamp();
  formData.approvalLoginName = req.session.user;
  formData.approvalDateTime = approvalDateTimeText;
  const uniqueIdPrefix = branchPrefix(formData.branch);
  const searchKey = String(formData.nameOfWork || formData.clientName || "").slice(0, 200);
  let request = pool.request()
    .input("createdBy", sql.NVarChar(200), req.session.user)
    .input("searchKey", sql.NVarChar(200), searchKey)
    .input("formData", sql.NVarChar(sql.MAX), JSON.stringify(formData))
    .input("uniqueIdPrefix", sql.NVarChar(3), uniqueIdPrefix)
    .input("approvalLoginName", sql.NVarChar(sql.MAX), req.session.user)
    .input("approvalDateTime", sql.DateTime2, approvalDateTime)
    .input("assignedTo", sql.NVarChar(200), toNullableSqlText(formData.assignTo))
    .input("approvalStatus", sql.NVarChar(32), formData.approvalStatus)
    .input("jobStatus", sql.NVarChar(32), formData.jobStatus);
  request = bindStructuredTenderFields(request, formData);
  const structuredColumns = structuredTenderColumns.map(([, column]) => column);
  const structuredValues = structuredTenderColumns.map(([key]) => `@field_${key}`);
  const result = await request.query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @inserted TABLE (RecordId INT);
      INSERT INTO dbo.TenderRecords (
        CreatedBy, SearchKey, FormData, ${structuredColumns.join(", ")}, ApprovalLoginName, ApprovalDateTime,
        AssignedTo, ApprovalStatus, JobStatus
      )
      OUTPUT INSERTED.RecordId INTO @inserted (RecordId)
      VALUES (
        @createdBy, @searchKey, @formData, ${structuredValues.join(", ")}, @approvalLoginName, @approvalDateTime,
        @assignedTo, @approvalStatus, @jobStatus
      );
      UPDATE record
      SET UniqueId = @uniqueIdPrefix
        + REPLICATE('0', CASE WHEN LEN(CONVERT(VARCHAR(12), inserted.RecordId)) < 6 THEN 6 - LEN(CONVERT(VARCHAR(12), inserted.RecordId)) ELSE 0 END)
        + CONVERT(VARCHAR(12), inserted.RecordId)
      FROM dbo.TenderRecords AS record
      INNER JOIN @inserted AS inserted ON inserted.RecordId = record.RecordId;
      COMMIT TRANSACTION;
      SELECT RecordId, UniqueId, UpdatedAt FROM dbo.TenderRecords WHERE RecordId = (SELECT RecordId FROM @inserted);
    `);
  res.status(201).json({
    id: result.recordset[0].RecordId,
    uniqueId: result.recordset[0].UniqueId,
    createdAt: result.recordset[0].UpdatedAt,
    approvalLoginName: req.session.user,
    approvalDateTime: approvalDateTimeText,
    approvalStatus: formData.approvalStatus,
    jobStatus: formData.jobStatus
  });
  publishRecordUpdate();
}));
app.put("/api/tenders/:id", requireLogin, handleAsync(async (req, res) => {
  const recordId = Number(req.params.id);
  if (!Number.isSafeInteger(recordId) || recordId < 1) return res.status(400).json({ error: "Invalid tender record ID." });
  const pool = await getPool();
  const [settings, tabAccess] = await Promise.all([
    getEffectiveFieldSettings(pool), getEffectiveTabAccess(pool, req.session.user, req.session.role)
  ]);
  const role = String(req.session.role || "").trim().toLowerCase();
  const editableSettings = fieldsForRole(settings, tabAccess, req.session.role, "edit", req.session.user);
  if (!editableSettings.length) return res.status(403).json({ error: "This account cannot update tender records." });
  const editableKeys = new Set(editableSettings.map((field) => field.key));
  if (Object.keys(req.body).some((key) => !editableKeys.has(key))) {
    return res.status(403).json({ error: "The form contains fields you are not permitted to update." });
  }
  if (Object.hasOwn(req.body, "branch")) {
    return res.status(403).json({ error: "A tender record's originating branch cannot be changed." });
  }
  const submittedFields = normalizeTenderFormData(req.body, editableSettings, true);
  if (typeof submittedFields === "string") return res.status(400).json({ error: submittedFields });
  if (!Object.keys(req.body).length) return res.status(400).json({ error: "Submit at least one editable field." });
  const transaction = new sql.Transaction(pool);
  let transactionOpen = false;
  let approvalDateTime;
  let updatedData;
  try {
    await transaction.begin();
    transactionOpen = true;
    const currentResult = await new sql.Request(transaction)
      .input("recordId", sql.Int, recordId)
        .query(`
          SELECT FormData, Branch, AssignedTo, ApprovalStatus, JobStatus, ReviewedBy, ReviewedAt, ProcessedBy, ProcessedAt
          FROM dbo.TenderRecords WITH (UPDLOCK, ROWLOCK) WHERE RecordId = @recordId
        `);
    if (!currentResult.recordset.length) {
      await transaction.rollback();
      transactionOpen = false;
      return res.status(404).json({ error: "Tender record not found." });
    }
    const formData = mergeStoredWorkflowData(JSON.parse(currentResult.recordset[0].FormData), currentResult.recordset[0]);
    if (!canAccessRecord(req, formData)) {
      await transaction.rollback();
      transactionOpen = false;
      return res.status(404).json({ error: "Tender record not found." });
    }
    if (isBranchScopedRole(role) &&
        (formData.approvalStatus === "Approved" || formData.jobStatus === "Processed")) {
      await transaction.rollback();
      transactionOpen = false;
      return res.status(403).json({ error: "This request can no longer be changed by the originating branch." });
    }
    if (isBankingUser(req.session.user, role) && formData.approvalStatus !== "Approved") {
      await transaction.rollback();
      transactionOpen = false;
      return res.status(403).json({ error: "Banking can update a request only after it is approved." });
    }
    if (canCompleteBanking(req) && submittedFields.jobStatus === "Processed") {
      await transaction.rollback();
      transactionOpen = false;
      return res.status(400).json({ error: "Use the Banking Approve request action to mark this request as processed." });
    }
    for (const [key, value] of Object.entries(submittedFields)) formData[key] = value;
    if (submittedFields.assignTo) {
      const approvers = await getApproverUsernames(pool);
      if (!approvers.some((username) => username.toLowerCase() === submittedFields.assignTo.toLowerCase())) {
        await transaction.rollback();
        transactionOpen = false;
        return res.status(400).json({ error: "Assign To must be an account with the Approver role." });
      }
    }
    if (isBranchScopedRole(role)) {
      formData.approvalStatus = "Pending";
      formData.jobStatus = "Pending";
    }
    const indiaApprovalTimestamp = indiaTimestamp();
    approvalDateTime = indiaApprovalTimestamp.date;
    formData.approvalLoginName = req.session.user;
    formData.approvalDateTime = indiaApprovalTimestamp.formatted;
    updatedData = formData;
    let updateRequest = new sql.Request(transaction)
      .input("recordId", sql.Int, recordId)
      .input("formData", sql.NVarChar(sql.MAX), JSON.stringify(formData))
      .input("searchKey", sql.NVarChar(200), String(formData.nameOfWork || formData.clientName || "").slice(0, 200))
      .input("approvalLoginName", sql.NVarChar(sql.MAX), req.session.user)
      .input("approvalDateTime", sql.DateTime2, approvalDateTime)
      .input("assignedTo", sql.NVarChar(200), toNullableSqlText(formData.assignTo))
      .input("approvalStatus", sql.NVarChar(32), formData.approvalStatus || "Pending")
      .input("jobStatus", sql.NVarChar(32), formData.jobStatus || "Pending");
    updateRequest = bindStructuredTenderFields(updateRequest, formData);
    const structuredAssignments = structuredTenderColumns.map(([key, column]) => `${column} = @field_${key}`);
    await updateRequest.query(`
        UPDATE dbo.TenderRecords
        SET FormData = @formData, SearchKey = @searchKey,
            ${structuredAssignments.join(", ")},
            ApprovalLoginName = @approvalLoginName,
            ApprovalDateTime = @approvalDateTime,
            AssignedTo = @assignedTo,
            ApprovalStatus = @approvalStatus,
            JobStatus = @jobStatus,
            UpdatedAt = SYSUTCDATETIME()
        WHERE RecordId = @recordId
      `);
    await transaction.commit();
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) await transaction.rollback();
    throw error;
  }
  res.json({
    ok: true,
    id: recordId,
    approvalLoginName: req.session.user,
    approvalDateTime: updatedData.approvalDateTime,
    approvalStatus: updatedData.approvalStatus,
    jobStatus: updatedData.jobStatus,
    status: normalizeWorkflowStatus(updatedData)
  });
  publishRecordUpdate();
}));
app.post("/api/tenders/:id/review", requireLogin, handleAsync(async (req, res) => {
  const role = String(req.session.role || "").trim().toLowerCase();
  if (!["approver", "admin"].includes(role)) {
    return res.status(403).json({ error: "Only the assigned reviewer or an administrator can approve requests." });
  }
  const recordId = Number(req.params.id);
  const decision = req.body?.status;
  if (!Number.isSafeInteger(recordId) || recordId < 1) return res.status(400).json({ error: "Invalid tender record ID." });
  if (!["Approved", "Not Approved"].includes(decision)) {
    return res.status(400).json({ error: "Choose Approved or Not Approved." });
  }
  const pool = await getPool();
  const approvers = role === "approver" ? await getApproverUsernames(pool) : [];
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input("recordId", sql.Int, recordId)
      .query(`
        SELECT FormData, Branch, AssignedTo, ApprovalStatus, JobStatus, ReviewedBy, ReviewedAt, ProcessedBy, ProcessedAt
        FROM dbo.TenderRecords WITH (UPDLOCK, ROWLOCK) WHERE RecordId = @recordId
      `);
    const row = result.recordset[0];
    if (!row) {
      await transaction.rollback();
      return res.status(404).json({ error: "Tender record not found." });
    }
    const formData = mergeStoredWorkflowData(JSON.parse(row.FormData), row);
    if (!canSubmitReview(req, formData, approvers)) {
      await transaction.rollback();
      return res.status(404).json({ error: "Tender record not found." });
    }
    const { date: reviewedAt, formatted: reviewedAtText } = indiaTimestamp();
    formData.approvalStatus = decision;
    if (decision === "Approved") formData.jobStatus = "Pending";
    formData.reviewedBy = req.session.user;
    formData.reviewedAt = reviewedAtText;
    await new sql.Request(transaction)
      .input("recordId", sql.Int, recordId)
      .input("formData", sql.NVarChar(sql.MAX), JSON.stringify(formData))
      .input("approvalStatus", sql.NVarChar(32), decision)
      .input("jobStatus", sql.NVarChar(32), formData.jobStatus || "Pending")
      .input("reviewedBy", sql.NVarChar(200), req.session.user)
      .input("reviewedAt", sql.DateTime2, reviewedAt)
      .query(`
        UPDATE dbo.TenderRecords
        SET FormData = @formData, ApprovalStatus = @approvalStatus, JobStatus = @jobStatus,
            ReviewedBy = @reviewedBy, ReviewedAt = @reviewedAt, UpdatedAt = SYSUTCDATETIME()
        WHERE RecordId = @recordId
      `);
    await transaction.commit();
    res.json({ ok: true, status: normalizeWorkflowStatus(formData) });
    publishRecordUpdate();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}));
app.post("/api/tenders/:id/reject", requireLogin, handleAsync(async (req, res) => {
  if (!canCompleteBanking(req)) {
    return res.status(403).json({ error: "Only Banking or an administrator can reject a queued request." });
  }
  const recordId = Number(req.params.id);
  if (!Number.isSafeInteger(recordId) || recordId < 1) {
    return res.status(400).json({ error: "Invalid tender record ID." });
  }
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input("recordId", sql.Int, recordId)
      .query(`
        SELECT FormData, Branch, AssignedTo, ApprovalStatus, JobStatus, ReviewedBy, ReviewedAt, ProcessedBy, ProcessedAt
        FROM dbo.TenderRecords WITH (UPDLOCK, ROWLOCK) WHERE RecordId = @recordId
      `);
    const row = result.recordset[0];
    if (!row) {
      await transaction.rollback();
      return res.status(404).json({ error: "Tender record not found." });
    }
    const formData = mergeStoredWorkflowData(JSON.parse(row.FormData), row);
    if (!canRejectQueuedRequest(req, formData)) {
      await transaction.rollback();
      return res.status(404).json({ error: "Tender record not found." });
    }
    const { date: rejectedAt, formatted: rejectedAtText } = indiaTimestamp();
    formData.approvalStatus = "Not Approved";
    formData.reviewedBy = req.session.user;
    formData.reviewedAt = rejectedAtText;
    await new sql.Request(transaction)
      .input("recordId", sql.Int, recordId)
      .input("formData", sql.NVarChar(sql.MAX), JSON.stringify(formData))
      .input("approvalStatus", sql.NVarChar(32), formData.approvalStatus)
      .input("reviewedBy", sql.NVarChar(200), req.session.user)
      .input("reviewedAt", sql.DateTime2, rejectedAt)
      .query(`
        UPDATE dbo.TenderRecords
        SET FormData = @formData, ApprovalStatus = @approvalStatus,
            ReviewedBy = @reviewedBy, ReviewedAt = @reviewedAt, UpdatedAt = SYSUTCDATETIME()
        WHERE RecordId = @recordId
      `);
    await transaction.commit();
    res.json({ ok: true, status: "Not Approved" });
    publishRecordUpdate();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}));
app.post("/api/tenders/:id/banking-complete", requireLogin, handleAsync(async (req, res) => {
  if (!canCompleteBanking(req)) {
    return res.status(403).json({ error: "Banking or administrator access is required." });
  }
  const recordId = Number(req.params.id);
  if (!Number.isSafeInteger(recordId) || recordId < 1) return res.status(400).json({ error: "Invalid tender record ID." });
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input("recordId", sql.Int, recordId)
      .query(`
        SELECT FormData, Branch, AssignedTo, ApprovalStatus, JobStatus, ReviewedBy, ReviewedAt, ProcessedBy, ProcessedAt
        FROM dbo.TenderRecords WITH (UPDLOCK, ROWLOCK) WHERE RecordId = @recordId
      `);
    const row = result.recordset[0];
    if (!row) {
      await transaction.rollback();
      return res.status(404).json({ error: "Tender record not found." });
    }
    const formData = mergeStoredWorkflowData(JSON.parse(row.FormData), row);
    if (!canAccessRecord(req, formData) || formData.approvalStatus !== "Approved" || formData.jobStatus === "Processed") {
      await transaction.rollback();
      return res.status(404).json({ error: "Tender record not found." });
    }
    formData.jobStatus = "Processed";
    const { date: processedAt, formatted: processedAtText } = indiaTimestamp();
    formData.processedBy = req.session.user;
    formData.processedAt = processedAtText;
    await new sql.Request(transaction)
      .input("recordId", sql.Int, recordId)
      .input("formData", sql.NVarChar(sql.MAX), JSON.stringify(formData))
      .input("jobStatus", sql.NVarChar(32), formData.jobStatus)
      .input("processedBy", sql.NVarChar(200), req.session.user)
      .input("processedAt", sql.DateTime2, processedAt)
      .query(`
        UPDATE dbo.TenderRecords
        SET FormData = @formData, JobStatus = @jobStatus,
            ProcessedBy = @processedBy, ProcessedAt = @processedAt, UpdatedAt = SYSUTCDATETIME()
        WHERE RecordId = @recordId
      `);
    await transaction.commit();
    res.json({ ok: true, status: "Processed" });
    publishRecordUpdate();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}));

app.post("/api/logout", requireLogin, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("tender.sid", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    res.json({ ok: true });
  });
});

function sendNoCacheFile(res, filePath) {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(filePath, { cacheControl: false });
}

app.get("/", (_req, res) => sendNoCacheFile(res, path.join(__dirname, "login.html")));
app.get("/login.html", (_req, res) => sendNoCacheFile(res, path.join(__dirname, "login.html")));
app.get("/dashboard.html", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  sendNoCacheFile(res, path.join(__dirname, "public", "dashboard.html"));
});
app.get("/field-settings.html", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  if (!isAdmin(req)) return res.status(403).send("Administrator access is required.");
  sendNoCacheFile(res, path.join(__dirname, "public", "field-settings.html"));
});
app.get("/field-settings", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  if (!isAdmin(req)) return res.status(403).send("Administrator access is required.");
  res.redirect("/field-settings.html");
});
app.get("/tender.html", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  sendNoCacheFile(res, path.join(__dirname, "public", "tender.html"));
});
app.get("/summary.html", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  sendNoCacheFile(res, path.join(__dirname, "public", "summary.html"));
});
app.get("/summary", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  res.redirect("/summary.html");
});
app.use(express.static(path.join(__dirname, "public"), {
  index: false,
  setHeaders(res, filePath) {
    if (/\.(?:html|js|css)$/i.test(filePath)) res.setHeader("Cache-Control", "no-store");
  }
}));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.status(404).send("Page not found.");
});
app.use((error, _req, res, _next) => {
  console.error("Request failed:", error);
  if (res.headersSent) return;
  res.status(500).json({ error: "The request could not be completed. Check the server log for details." });
});

async function start() {
  checkConfiguration();
  if (process.env.AUTO_CREATE_SCHEMA !== "false") {
    await (await getPool()).request().batch(loadSchema());
  } else {
    await (await getPool()).request().query(`
      SELECT TOP (0) RecordId, UniqueId, ${structuredTenderColumns.map(([, column]) => column).join(", ")},
        ApprovalLoginName, ApprovalDateTime, AssignedTo, ApprovalStatus, JobStatus,
        ReviewedBy, ReviewedAt, ProcessedBy, ProcessedAt, FormData, SearchKey, CreatedBy, UpdatedAt
      FROM dbo.TenderRecords;
      SELECT TOP (0) Id FROM dbo.TenderFieldSettings;
      SELECT TOP (0) Id FROM dbo.TenderTabAccessSettings;
      SELECT TOP (0) Id FROM dbo.TenderUserAccessSettings;
      SELECT TOP (0) Id FROM dbo.TenderAppearanceSettings;
    `);
  }
  app.listen(port, "0.0.0.0", () => console.log(`Tender Management is running on port ${port}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Application startup failed:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  defaultFieldSettings,
  structuredTenderColumns,
  defaultTabAccess,
  isBankingUser,
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
  indiaTimestamp,
  mergeStoredWorkflowData,
  normalizeWorkflowStatus,
  workflowSummary,
  getFieldSettings,
  normalizeTenderFormData,
  toNullableSqlText,
  branchPrefix,
  formatUniqueId,
  includeDefaultDropdownOptions,
  orderReferenceFields,
  repairLegacyReferenceFields,
  isAdmin,
  isValidDate,
  publishFieldSettings,
  validateFieldSettings,
  validateAppearance,
  defaultAppearance,
  validateTenderForm,
  verifyPassword
};
