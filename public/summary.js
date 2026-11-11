const recordsBody = document.getElementById("summary-records");
const countLabel = document.getElementById("summary-count");
const searchInput = document.getElementById("summary-search");
const summaryMessage = document.getElementById("summary-message");
let records = [];
let fieldLabels = new Map();
let canDownloadPdf = false;
let canRejectQueuedRequests = false;
let isBankingLogin = false;
let currentRole = "";
let sortKey = "updated";
let sortDirection = "desc";
const sortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function getSummaryAmount(data) {
  return data.tenderValue || data.bankingAmount || data.requisitionAmount;
}

function getSortValue(record, key) {
  const data = record.formData;
  switch (key) {
    case "uniqueId": return record.uniqueId || `#${record.id}`;
    case "branch": return data.branch;
    case "work": return [data.nameOfWork, data.clientName].filter(Boolean).join(" / ");
    case "jobType": return data.jobType;
    case "amount": return getSummaryAmount(data);
    case "status": return record.status;
    case "rahul": return record.workflow?.rahul?.status || "Not assigned";
    case "amrita": return record.workflow?.amrita?.status || "Not assigned";
    case "simran": return record.workflow?.simran?.status || "Not assigned";
    case "banking": return record.workflow?.banking?.status || "Waiting for approval";
    case "updated": return new Date(record.createdAt || 0).getTime() || 0;
    default: return "";
  }
}

function sortRecords(items) {
  const direction = sortDirection === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    const leftValue = getSortValue(left, sortKey);
    const rightValue = getSortValue(right, sortKey);
    let comparison;
    if (sortKey === "updated") {
      comparison = leftValue - rightValue;
    } else if (sortKey === "amount") {
      const leftAmount = Number.parseFloat(String(leftValue || "").replace(/[^\d.-]/g, ""));
      const rightAmount = Number.parseFloat(String(rightValue || "").replace(/[^\d.-]/g, ""));
      comparison = Number.isFinite(leftAmount) && Number.isFinite(rightAmount)
        ? leftAmount - rightAmount
        : sortCollator.compare(String(leftValue || ""), String(rightValue || ""));
    } else {
      comparison = sortCollator.compare(String(leftValue || ""), String(rightValue || ""));
    }
    return comparison * direction || (Number(left.id) - Number(right.id)) * -1;
  });
}

function updateSortControls() {
  document.querySelectorAll(".summary-sort-button").forEach((button) => {
    const active = button.dataset.sort === sortKey;
    const header = button.closest("th");
    header.setAttribute("aria-sort", active
      ? (sortDirection === "asc" ? "ascending" : "descending")
      : "none");
    button.querySelector(".summary-sort-arrow").textContent = active
      ? (sortDirection === "asc" ? "▲" : "▼")
      : "↕";
    button.setAttribute("aria-label", `${button.childNodes[0].textContent.trim()}, ${active
      ? `sorted ${sortDirection === "asc" ? "ascending" : "descending"}`
      : "sort ascending"}`);
  });
}

function addCell(row, text) {
  const cell = document.createElement("td");
  cell.textContent = text || "—";
  row.append(cell);
}

function addStatusCell(row, text) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  const value = String(text || "—");
  const normalized = value.toLowerCase();
  badge.className = "summary-status-badge";
  if (normalized.includes("not approved") || normalized.includes("rejected")) {
    badge.classList.add("status-rejected");
  } else if (normalized.includes("approved") || normalized === "processed") {
    badge.classList.add("status-approved");
  } else if (normalized.includes("pending") || normalized.includes("waiting")) {
    badge.classList.add("status-pending");
  } else {
    badge.classList.add("status-neutral");
  }
  badge.textContent = value;
  cell.append(badge);
  row.append(cell);
}

function formatTimestampInIndia(value) {
  if (!value) return "—";
  if (typeof value === "string" && value.endsWith(" IST")) return value;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "—";
  return `${new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp)} IST`;
}

function renderRecords() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = sortRecords(records.filter((record) => {
    const data = record.formData;
    return [record.uniqueId, data.branch, data.nameOfWork, data.clientName]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }));
  countLabel.textContent = `${filtered.length} of ${records.length} record${records.length === 1 ? "" : "s"}`;
  recordsBody.replaceChildren();
  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 12;
    cell.className = "empty-state";
    cell.textContent = records.length ? "No records match your search." : "No tender records have been saved yet.";
    row.append(cell);
    recordsBody.append(row);
    return;
  }
  for (const record of filtered) {
    const data = record.formData;
    const row = document.createElement("tr");
    const idCell = document.createElement("td");
    const idLink = document.createElement("a");
    idLink.className = "summary-id";
    idLink.href = `/tender.html?id=${encodeURIComponent(record.id)}`;
    idLink.textContent = record.uniqueId || `#${record.id}`;
    idCell.append(idLink);
    row.append(idCell);
    addCell(row, data.branch);
    addCell(row, [data.nameOfWork, data.clientName].filter(Boolean).join(" / "));
    addCell(row, data.jobType);
    addCell(row, getSummaryAmount(data));
    addStatusCell(row, record.status);
    addStatusCell(row, record.workflow?.rahul?.status || "Not assigned");
    addStatusCell(row, record.workflow?.amrita?.status || "Not assigned");
    addStatusCell(row, record.workflow?.simran?.status || "Not assigned");
    addStatusCell(row, record.workflow?.banking?.status || "Waiting for approval");
    addCell(row, formatTimestampInIndia(record.createdAt));
    const actionCell = document.createElement("td");
    const action = document.createElement("a");
    action.className = "button button-secondary summary-open";
    action.href = idLink.href;
    action.textContent = "Open";
    const details = document.createElement("details");
    details.className = "summary-details";
    const summary = document.createElement("summary");
    summary.textContent = "All visible details";
    const definitionList = document.createElement("dl");
    for (const [key, value] of Object.entries(data)) {
      const term = document.createElement("dt");
      term.textContent = fieldLabels.get(key) || key;
      const description = document.createElement("dd");
      description.textContent = value || "—";
      definitionList.append(term, description);
    }
    details.append(summary, definitionList);
    actionCell.append(action, details);
    if (canDownloadPdf) {
      const download = document.createElement("a");
      download.className = "button button-secondary summary-pdf-download";
      download.href = `/api/tenders/${encodeURIComponent(record.id)}/tender-operation.pdf`;
      download.download = `${record.uniqueId || `Tender-${record.id}`}-Tender-Operation.pdf`;
      download.textContent = "Save PDF";
      actionCell.append(download);
    }
    const approvalStatus = String(data.approvalStatus || "").trim().toLowerCase();
    const jobStatus = String(data.jobStatus || "").trim().toLowerCase();
    const canRejectRecord = canRejectQueuedRequests &&
      jobStatus !== "processed" &&
      (currentRole === "admin"
        ? ["pending", "approved"].includes(approvalStatus)
        : approvalStatus === "approved");
    if (canRejectRecord) {
      const reject = document.createElement("button");
      reject.className = "button button-danger summary-reject";
      reject.type = "button";
      reject.textContent = "Reject request";
      reject.addEventListener("click", () => rejectRequest(record));
      actionCell.append(reject);
    }
    row.append(actionCell);
    recordsBody.append(row);
  }
}

async function rejectRequest(record) {
  if (!window.confirm(
    `Reject request ${record.uniqueId || `#${record.id}`}? It will be marked Not Approved and removed from the Banking queue if applicable.`
  )) return;
  const buttons = [...recordsBody.querySelectorAll(".summary-reject")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const csrfResponse = await fetch("/api/csrf");
    if (!csrfResponse.ok) throw new Error("Unable to establish a secure session.");
    const { csrfToken } = await csrfResponse.json();
    const response = await fetch(`/api/tenders/${encodeURIComponent(record.id)}/reject`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken }
    });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(result?.error || "Unable to reject the request.");
    summaryMessage.textContent = "Request rejected and removed from the Banking queue.";
    summaryMessage.className = "notice notice-success";
    summaryMessage.hidden = false;
    if (isBankingLogin) {
      records = records.filter((item) => item.id !== record.id);
    } else {
      record.formData.approvalStatus = "Not Approved";
      record.status = "Not Approved";
    }
    renderRecords();
  } catch (error) {
    summaryMessage.textContent = error.message;
    summaryMessage.className = "notice notice-error";
    summaryMessage.hidden = false;
    renderRecords();
  }
}

async function initialize() {
  const response = await fetch("/api/me");
  if (response.status === 401) {
    window.location.assign("/");
    return;
  }
  if (!response.ok) throw new Error("Unable to load your account.");
  const user = await response.json();
  document.getElementById("user-name").textContent = [user.username, user.branch, user.role].filter(Boolean).join(" · ");
  currentRole = String(user.role || "").trim().toLowerCase();
  isBankingLogin = isBankingUser(user);
  canRejectQueuedRequests = ["admin", "banking"].includes(currentRole) || isBankingLogin;
  if (String(user.role).trim().toLowerCase() === "admin") {
    document.querySelectorAll(".admin-nav").forEach((link) => { link.hidden = false; });
  }
  canDownloadPdf = ["approver", "admin"].includes(String(user.role || "").trim().toLowerCase());
  const dataResponse = await fetch("/api/tenders");
  if (dataResponse.status === 401) {
    window.location.assign("/");
    return;
  }
  if (!dataResponse.ok) {
    const result = await dataResponse.json();
    throw new Error(result.error || "Unable to load tender records.");
  }
  records = await dataResponse.json();
  const fieldsResponse = await fetch("/api/field-settings");
  if (!fieldsResponse.ok) throw new Error("Unable to load accessible field labels.");
  const fields = await fieldsResponse.json();
  fieldLabels = new Map(fields.map((field) => [field.key, field.label]));
  const canCreate = ["Tender Details", "Operation"].every((tab) =>
    fields.some((field) => field.tab === tab && field.canEdit)
  );
  document.getElementById("new-record-link").hidden = !canCreate;
  renderRecords();
  if (!window.recordsUpdatedEvents) {
    window.recordsUpdatedEvents = new EventSource("/api/tenders/events");
    window.recordsUpdatedEvents.addEventListener("records-updated", () => {
      fetch("/api/tenders", { cache: "no-store" })
        .then(async (response) => {
          if (response.status === 401) {
            window.location.assign("/");
            return [];
          }
          if (!response.ok) throw new Error("Unable to refresh tender records.");
          return response.json();
        })
        .then((updatedRecords) => {
          records = updatedRecords;
          renderRecords();
        })
        .catch((error) => {
          summaryMessage.textContent = error.message;
          summaryMessage.className = "notice notice-error";
          summaryMessage.hidden = false;
        });
    });
  }
  const requestedId = new URLSearchParams(window.location.search).get("record");
  if (requestedId) {
    const matching = records.find((record) => record.uniqueId === requestedId);
    if (matching) window.location.replace(`/tender.html?id=${encodeURIComponent(matching.id)}`);
  }
}

function isBankingUser(user) {
  return currentRole === "banking" || String(user.username || "").trim().toLowerCase() === "banking";
}

searchInput.addEventListener("input", renderRecords);
document.querySelectorAll(".summary-sort-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (sortKey === button.dataset.sort) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortKey = button.dataset.sort;
      sortDirection = "asc";
    }
    updateSortControls();
    renderRecords();
  });
});
updateSortControls();
document.getElementById("logout-button").addEventListener("click", async () => {
  const csrfResponse = await fetch("/api/csrf");
  if (!csrfResponse.ok) throw new Error("Unable to establish a secure session.");
  const { csrfToken } = await csrfResponse.json();
  const response = await fetch("/api/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
  if (!response.ok) throw new Error("Unable to sign out. Please try again.");
  window.location.assign("/");
});
initialize().catch((error) => {
  summaryMessage.textContent = error.message;
  summaryMessage.className = "notice notice-error";
  summaryMessage.hidden = false;
});
