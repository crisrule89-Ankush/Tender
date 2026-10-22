const form = document.getElementById("tender-form");
const sectionsContainer = document.getElementById("form-sections");
const message = document.getElementById("form-message");
const recordsBody = document.getElementById("records-body");
const recordCount = document.getElementById("record-count");
const saveButton = document.getElementById("save-button");

let csrfToken = "";
let formFields = [];
let appliedSettingsSignature = "";
let currentRecordId = null;
let initialValues = {};

async function apiRequest(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    window.location.assign("/");
    throw new Error("Your session has expired. Please sign in again.");
  }
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || "The request could not be completed.");
  return result;
}

function showMessage(text, kind) {
  message.textContent = text;
  message.className = `notice notice-${kind}`;
  message.hidden = false;
}

function createInput(field, options) {
  let input;
  if (field.type === "textarea") {
    input = document.createElement("textarea");
    input.placeholder = `Enter ${field.label.toLowerCase()}`;
  } else {
    input = document.createElement("input");
    input.type = field.type === "date" ? "date" : "text";
    if (field.type !== "date") {
      input.placeholder = options.length
        ? `Enter or choose ${field.label.toLowerCase()}`
        : `Enter ${field.label.toLowerCase()}`;
    }
    if (field.type === "number") input.inputMode = "decimal";
    if (field.type === "select") input.setAttribute("list", `options-${field.key}`);
  }
  if (field.type === "select") {
    if (field.key === "referenceType") {
      input.addEventListener("input", () => updateReferenceFieldLabels(input.value));
    }
    if (field.key === "jobType") {
      input.addEventListener("input", () => updateJobTypeDateLabels(input.value));
    }
    if (field.key === "requisitionType") {
      input.addEventListener("input", () => updateRequisitionLabels(input.value));
    }
  }
  input.id = field.key;
  input.name = field.key;
  input.required = false;
  input.disabled = field.canEdit === false;
  input.setAttribute("aria-label", field.label);
  return input;
}

function updateReferenceFieldLabels(referenceType) {
  const { numberLabel, dateLabel } = window.TenderReferenceLabels.getReferenceLabels(referenceType);
  for (const [key, text] of [["referenceNumber", numberLabel], ["referenceDate", dateLabel]]) {
    const label = [...sectionsContainer.querySelectorAll("label")].find((item) => item.htmlFor === key);
    const input = form.elements.namedItem(key);
    if (label) label.textContent = text;
    if (input) {
      input.setAttribute("aria-label", text);
      if (input instanceof HTMLInputElement && input.type === "text") input.placeholder = `Enter ${text.toLowerCase()}`;
    }
  }
}

function updateJobTypeDateLabels(jobType) {
  const startDateField = formFields.find((field) => field.key === "startDate");
  const endDateField = formFields.find((field) => field.key === "endDate");
  const { startDateLabel, endDateLabel } = window.TenderReferenceLabels.getJobTypeDateLabels(
    jobType,
    startDateField?.label || "Start Date",
    endDateField?.label || "End Date"
  );

  for (const [key, text] of [["startDate", startDateLabel], ["endDate", endDateLabel]]) {
    const label = [...sectionsContainer.querySelectorAll("label")].find((item) => item.htmlFor === key);
    const input = form.elements.namedItem(key);
    if (label) label.textContent = text;
    if (input) input.setAttribute("aria-label", text);
  }
}

function updateRequisitionLabels(requisitionType) {
  const fieldByKey = new Map(formFields.map((field) => [field.key, field]));
  const { validUptoLabel, amountLabel, inFormOfLabel, inFavorOfLabel } =
    window.TenderReferenceLabels.getRequisitionLabels(requisitionType, {
      validUptoLabel: fieldByKey.get("validUpto")?.label || "Valid Upto",
      amountLabel: fieldByKey.get("requisitionAmount")?.label || "Amount",
      inFormOfLabel: fieldByKey.get("inFormOf")?.label || "In form of",
      inFavorOfLabel: fieldByKey.get("inFavorOf")?.label || "in favor of"
    });

  for (const [key, text] of [
    ["validUpto", validUptoLabel],
    ["requisitionAmount", amountLabel],
    ["inFormOf", inFormOfLabel],
    ["inFavorOf", inFavorOfLabel]
  ]) {
    const label = [...sectionsContainer.querySelectorAll("label")].find((item) => item.htmlFor === key);
    const input = form.elements.namedItem(key);
    if (label) label.textContent = text;
    if (input) {
      input.setAttribute("aria-label", text);
      if (input instanceof HTMLInputElement && input.type === "text") input.placeholder = `Enter ${text.toLowerCase()}`;
    }
  }
}

function renderFields() {
  const previousValues = Object.fromEntries([...form.elements]
    .filter((element) => element.name)
    .map((element) => [element.name, element.value]));
  sectionsContainer.replaceChildren();
  const tabOrder = ["Tender Details", "Operation", "Banking", "Approval"];
  const availableTabs = [...new Set(formFields.map((field) => field.tab))]
    .sort((left, right) => tabOrder.indexOf(left) - tabOrder.indexOf(right));
  for (const tab of availableTabs) {
    const tabSection = document.createElement("section");
    tabSection.className = "form-section workflow-section";
    const tabHeading = document.createElement("h3");
    tabHeading.textContent = tab;
    tabSection.append(tabHeading);
    const categories = new Map();
    for (const field of formFields.filter((item) => item.tab === tab)) {
      if (!categories.has(field.section)) categories.set(field.section, []);
      categories.get(field.section).push(field);
    }
    for (const [categoryName, fields] of categories) {
      if (categoryName !== tab) {
        const categoryHeading = document.createElement("h4");
        categoryHeading.className = "form-category-heading";
        categoryHeading.textContent = categoryName;
        tabSection.append(categoryHeading);
      }
      const grid = document.createElement("div");
      grid.className = "field-grid";
      for (const field of fields) {
        const wrapper = document.createElement("div");
        wrapper.className = "field";
        const label = document.createElement("label");
        label.htmlFor = field.key;
        label.textContent = field.label;
        const input = createInput(field, field.options || []);
        wrapper.append(label);
        if (field.type === "date") {
          const dateControl = document.createElement("div");
          dateControl.className = "date-field-control";
          const clearDateButton = document.createElement("button");
          clearDateButton.type = "button";
          clearDateButton.className = "date-clear-button";
          clearDateButton.textContent = "Clear date";
          clearDateButton.disabled = field.canEdit === false;
          clearDateButton.setAttribute("aria-label", `Clear ${field.label}`);
          clearDateButton.addEventListener("click", () => {
            input.value = "";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          });
          dateControl.append(input, clearDateButton);
          wrapper.append(dateControl);
        } else {
          wrapper.append(input);
        }
        if (field.type === "select" && field.options?.length) {
          const datalist = document.createElement("datalist");
          datalist.id = `options-${field.key}`;
          for (const value of field.options) {
            const option = document.createElement("option");
            option.value = value;
            datalist.append(option);
          }
          wrapper.append(datalist);
        }
        if (field.type === "select" && (!field.options || field.options.length === 0)) {
          const hint = document.createElement("small");
          hint.className = "hint";
          hint.textContent = "An administrator can add choices under Field Settings.";
          wrapper.append(hint);
        }
        grid.append(wrapper);
      }
      tabSection.append(grid);
    }
    sectionsContainer.append(tabSection);
  }
  for (const [key, value] of Object.entries(previousValues)) {
    const control = form.elements.namedItem(key);
    if (!control) continue;
    if (control instanceof HTMLSelectElement && value && ![...control.options].some((option) => option.value === value)) {
      const historicalOption = document.createElement("option");
      historicalOption.value = value;
      historicalOption.textContent = value;
      control.append(historicalOption);
    }
    control.value = value;
  }
  updateReferenceFieldLabels(form.elements.namedItem("referenceType")?.value);
  updateJobTypeDateLabels(form.elements.namedItem("jobType")?.value);
  updateRequisitionLabels(form.elements.namedItem("requisitionType")?.value);
}

function applyFieldSettings(settings, notify = false) {
  if (!Array.isArray(settings) || settings.length === 0) throw new Error("The server returned invalid field settings.");
  const settingsByKey = new Map(settings.map((setting) => [setting.key, setting]));
  if (settingsByKey.size !== settings.length || settings.some((field) => !field.label || !field.section)) {
    throw new Error("The server returned incomplete or duplicate form field definitions.");
  }
  const signature = JSON.stringify(settings);
  if (signature === appliedSettingsSignature) return;

  const previousValues = Object.fromEntries([...form.elements]
    .filter((element) => element.name)
    .map((element) => [element.name, element.value]));
  const activeKey = document.activeElement?.form === form ? document.activeElement.name : "";
  formFields = settings.map((field) => ({ ...field }));
  appliedSettingsSignature = signature;
  renderFields();
  for (const [key, value] of Object.entries(previousValues)) {
    const control = form.elements.namedItem(key);
    if (!control) continue;
    if (control instanceof HTMLSelectElement && value && ![...control.options].some((option) => option.value === value)) {
      const historicalOption = document.createElement("option");
      historicalOption.value = value;
      historicalOption.textContent = value;
      control.append(historicalOption);
    }
    control.value = value;
  }
  updateReferenceFieldLabels(form.elements.namedItem("referenceType")?.value);
  updateJobTypeDateLabels(form.elements.namedItem("jobType")?.value);
  updateRequisitionLabels(form.elements.namedItem("requisitionType")?.value);
  if (activeKey) form.elements.namedItem(activeKey)?.focus();
  if (notify) showMessage("Field settings were updated. The form now reflects the latest configuration.", "success");
}

function recordCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "—";
  return cell;
}

function formatTimestampInIndia(value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "—";
  return `${new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp)} IST`;
}

function renderRecords(records) {
  recordCount.textContent = `${records.length} recent record${records.length === 1 ? "" : "s"}`;
  recordsBody.replaceChildren();
  if (records.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.className = "empty-state";
    cell.textContent = "No tender records have been saved yet.";
    row.append(cell);
    recordsBody.append(row);
    return;
  }
  for (const record of records) {
    const data = record.formData;
    const row = document.createElement("tr");
    const workCell = document.createElement("td");
    const title = document.createElement("div");
    title.className = "table-title";
    title.textContent = data.nameOfWork || "Untitled work";
    const subtitle = document.createElement("div");
    subtitle.className = "table-subtitle";
    subtitle.textContent = data.clientName || "";
    workCell.append(title, subtitle);
    const idCell = document.createElement("td");
    const recordLink = document.createElement("a");
    recordLink.href = `/tender.html?id=${encodeURIComponent(record.id)}`;
    recordLink.textContent = record.uniqueId || `#${record.id}`;
    idCell.append(recordLink);
    row.append(idCell, workCell);
    row.append(recordCell(data.tenderType));
    row.append(recordCell(data.tenderValue));
    row.append(recordCell(data.submissionDate));
    row.append(recordCell(data.bankingAmount));
    row.append(recordCell(record.createdBy));
    row.append(recordCell(formatTimestampInIndia(record.createdAt)));
    row.append(recordCell(record.status));
    recordsBody.append(row);
  }
}

async function loadRecords() {
  const records = await apiRequest("/api/tenders");
  renderRecords(records);
}

function showWorkflowActions(user, record) {
  const role = String(user.role || "").trim().toLowerCase();
  const isBankingLogin = String(user.username || "").trim().toLowerCase() === "banking";
  const assignedToCurrentUser =
    String(record.formData.assignTo || "").trim().toLowerCase() === String(user.username || "").trim().toLowerCase();
  const canApprove = role === "admin" || (role === "approver" && assignedToCurrentUser);
  document.getElementById("review-approve").hidden =
    !canApprove || record.formData.approvalStatus !== "Pending";
  document.getElementById("review-reject").hidden =
    !canApprove || record.formData.approvalStatus !== "Pending";
  document.getElementById("banking-approve").hidden =
    !(["banking", "admin"].includes(role) || isBankingLogin) ||
    record.formData.approvalStatus !== "Approved" ||
    record.formData.jobStatus === "Processed";
}

async function submitWorkflowAction(path, body, successMessage) {
  const buttons = ["review-approve", "review-reject", "banking-approve"].map((id) => document.getElementById(id));
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await apiRequest(path, { method: "POST", body: JSON.stringify(body) });
    showMessage(successMessage, "success");
    window.setTimeout(() => window.location.reload(), 350);
  } catch (error) {
    showMessage(error.message, "error");
    buttons.filter((button) => !button.hidden).forEach((button) => { button.disabled = false; });
  }
}

document.getElementById("review-approve").addEventListener("click", () => {
  submitWorkflowAction(`/api/tenders/${currentRecordId}/review`, { status: "Approved" }, "Request approved and sent to Banking.");
});
document.getElementById("review-reject").addEventListener("click", () => {
  submitWorkflowAction(`/api/tenders/${currentRecordId}/review`, { status: "Not Approved" }, "Request was marked not approved and returned to its branch.");
});
document.getElementById("banking-approve").addEventListener("click", async () => {
  if (!form.reportValidity()) return;
  const button = document.getElementById("banking-approve");
  const values = Object.fromEntries(new FormData(form).entries());
  const changedFields = Object.fromEntries(
    Object.entries(values).filter(([key, value]) =>
      key !== "jobStatus" && value !== (initialValues[key] ?? ""))
  );
  button.disabled = true;
  try {
    if (Object.keys(changedFields).length) {
      const result = await apiRequest(`/api/tenders/${currentRecordId}`, {
        method: "PUT",
        body: JSON.stringify(changedFields)
      });
      initialValues = { ...initialValues, ...changedFields };
      if (result.approvalLoginName) initialValues.approvalLoginName = result.approvalLoginName;
      if (result.approvalDateTime) initialValues.approvalDateTime = result.approvalDateTime;
    }
    await apiRequest(`/api/tenders/${currentRecordId}/banking-complete`, {
      method: "POST",
      body: JSON.stringify({})
    });
    showMessage("Request has been approved.", "success");
    window.setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    showMessage(error.message, "error");
    button.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.hidden = true;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.jobStatus === "Processed" && data.jobStatus !== (initialValues.jobStatus ?? "")) {
    showMessage("Use the Banking Approve request action to mark this request as processed.", "error");
    return;
  }
  const updateData = currentRecordId
    ? Object.fromEntries(Object.entries(data).filter(([key, value]) => value !== (initialValues[key] ?? "")))
    : data;
  if (currentRecordId && Object.keys(updateData).length === 0) {
    showMessage("There are no changes to save.", "error");
    return;
  }
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";
  try {
    const result = currentRecordId
      ? await apiRequest(`/api/tenders/${currentRecordId}`, { method: "PUT", body: JSON.stringify(updateData) })
      : await apiRequest("/api/tenders", { method: "POST", body: JSON.stringify(updateData) });
    if (!currentRecordId) {
      currentRecordId = result.id;
      initialValues = { ...data };
      for (const [key, value] of [
        ["approvalLoginName", result.approvalLoginName],
        ["approvalDateTime", result.approvalDateTime],
        ["approvalStatus", result.approvalStatus],
        ["jobStatus", result.jobStatus]
      ]) {
        const control = form.elements.namedItem(key);
        if (control && value) control.value = value;
        if (value) initialValues[key] = value;
      }
      document.getElementById("form-title").textContent = `Record ${result.uniqueId}`;
      document.getElementById("form-description").textContent = "Record saved. You can continue with the tabs available to your role.";
      window.history.replaceState({}, "", `/tender.html?id=${encodeURIComponent(result.id)}`);
      saveButton.textContent = "Update tender record";
      document.getElementById("reset-button").hidden = true;
    } else {
      initialValues = { ...initialValues, ...updateData };
      for (const [key, value] of [
        ["approvalLoginName", result.approvalLoginName],
        ["approvalDateTime", result.approvalDateTime],
        ["approvalStatus", result.approvalStatus],
        ["jobStatus", result.jobStatus]
      ]) {
        const control = form.elements.namedItem(key);
        if (control && value) control.value = value;
        if (value) initialValues[key] = value;
      }
    }
    if (result.status) {
      document.getElementById("form-description").textContent =
        `Status: ${result.status}. Review or update the information available to your role.`;
    }
    showMessage("Tender record saved successfully.", "success");
    await loadRecords();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    saveButton.disabled = false;
    if (!currentRecordId) saveButton.textContent = "Save tender record";
  }
});

document.getElementById("reset-button").addEventListener("click", () => { message.hidden = true; });
form.addEventListener("reset", () => {
  window.setTimeout(() => {
    updateReferenceFieldLabels(form.elements.namedItem("referenceType")?.value);
    updateJobTypeDateLabels(form.elements.namedItem("jobType")?.value);
    updateRequisitionLabels(form.elements.namedItem("requisitionType")?.value);
  }, 0);
});
document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await apiRequest("/api/logout", { method: "POST" });
    window.location.assign("/");
  } catch (error) {
    showMessage(error.message, "error");
  }
});

async function initialize() {
  try {
    const csrf = await fetch("/api/csrf");
    if (!csrf.ok) throw new Error("Unable to establish a secure session.");
    csrfToken = (await csrf.json()).csrfToken;
    const [user, settings] = await Promise.all([
      apiRequest("/api/me"),
      apiRequest("/api/field-settings")
    ]);
    document.getElementById("user-name").textContent = [user.username, user.branch, user.role].filter(Boolean).join(" · ");
    if (String(user.role).toLowerCase() === "admin") {
      document.querySelectorAll(".admin-nav").forEach((link) => { link.hidden = false; });
    }
    const requestedRecordId = new URLSearchParams(window.location.search).get("id");
    const canCreate = ["Tender Details", "Operation"].every((tab) =>
      settings.some((field) => field.tab === tab && field.canEdit)
    );
    if (!requestedRecordId && !canCreate) {
      window.location.replace("/summary.html");
      return;
    }
    applyFieldSettings(settings);
    const branchControl = form.elements.namedItem("branch");
    if (branchControl && !requestedRecordId) branchControl.value = user.branch || "";
    if (requestedRecordId) {
      const record = await apiRequest(`/api/tenders/${encodeURIComponent(requestedRecordId)}`);
      showWorkflowActions(user, record);
      currentRecordId = record.id;
      document.getElementById("form-title").textContent = `Record ${record.uniqueId || `#${record.id}`}`;
      document.getElementById("form-description").textContent =
        `Status: ${record.status}. Review or update the information available to your role. Saved by ${record.createdBy || "unknown"}.`;
      if (!settings.some((field) => field.canEdit)) {
        saveButton.hidden = true;
        document.getElementById("reset-button").hidden = true;
      }
      for (const [key, value] of Object.entries(record.formData)) {
        const control = form.elements.namedItem(key);
        if (!control) continue;
        const resolvedValue = value ?? "";
        if (control instanceof HTMLSelectElement && resolvedValue && ![...control.options].some((option) => option.value === resolvedValue)) {
          const historicalOption = document.createElement("option");
          historicalOption.value = resolvedValue;
          historicalOption.textContent = resolvedValue;
          control.append(historicalOption);
        }
        control.value = resolvedValue;
      }
      initialValues = Object.fromEntries([...form.elements]
        .filter((element) => element.name)
        .map((element) => [element.name, element.value]));
      saveButton.textContent = "Update tender record";
      document.getElementById("reset-button").hidden = true;
      updateReferenceFieldLabels(form.elements.namedItem("referenceType")?.value);
      updateJobTypeDateLabels(form.elements.namedItem("jobType")?.value);
      updateRequisitionLabels(form.elements.namedItem("requisitionType")?.value);
    } else {
      const editableFields = settings.filter((field) => field.canEdit);
      if (editableFields.length === 0) {
        saveButton.hidden = true;
        document.getElementById("reset-button").hidden = true;
      }
    }
    const settingsEvents = new EventSource("/api/field-settings/events");
    settingsEvents.addEventListener("field-settings", (event) => {
      try {
        applyFieldSettings(JSON.parse(event.data), true);
      } catch (error) {
        showMessage(error.message, "error");
      }
    });
    const recordEvents = new EventSource("/api/tenders/events");
    recordEvents.addEventListener("records-updated", () => {
      loadRecords().catch((error) => showMessage(error.message, "error"));
    });
    await loadRecords();
  } catch (error) {
    if (error.message !== "Your session has expired. Please sign in again.") showMessage(error.message, "error");
  }
}

initialize();
