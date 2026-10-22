async function initializeDashboard() {
  const [user, counts] = await Promise.all([
    dashboardRequest("/api/me"),
    dashboardRequest("/api/dashboard/summary")
  ]);
  document.getElementById("user-name").textContent = [user.username, user.branch, user.role].filter(Boolean).join(" · ");
  const isBankingQueue = String(user.role || "").trim().toLowerCase() === "banking" ||
    String(user.username || "").trim().toLowerCase() === "banking";
  if (isBankingQueue) {
    document.getElementById("dashboard-description").textContent =
      "Track requests awaiting Banking and those with final Banking approval.";
  }
  if (String(user.role).toLowerCase() === "admin") {
    document.querySelectorAll(".admin-nav").forEach((link) => { link.hidden = false; });
  }
  renderDashboardCounts(counts);
  const updates = new EventSource("/api/tenders/events");
  updates.addEventListener("records-updated", () => {
    dashboardRequest("/api/dashboard/summary")
      .then(renderDashboardCounts)
      .catch(showDashboardError);
  });
}

async function dashboardRequest(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 401) {
    window.location.assign("/");
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!response.ok) throw new Error("Unable to load tender request statistics.");
  return response.json();
}

function renderDashboardCounts(counts) {
  const statuses = [
    { key: "approved", color: "#1a9a68" },
    { key: "pending", color: "#e5a32e" },
    { key: "notApproved", color: "#d65454" }
  ];
  const total = counts.total;
  document.getElementById("metric-total").textContent = total.toLocaleString();
  document.getElementById("metric-approved").textContent = counts.approved.toLocaleString();
  document.getElementById("metric-not-approved").textContent = counts.notApproved.toLocaleString();
  document.getElementById("metric-pending").textContent = counts.pending.toLocaleString();
  document.getElementById("chart-total").textContent = total.toLocaleString();
  document.getElementById("legend-approved").textContent = counts.approved.toLocaleString();
  document.getElementById("legend-pending").textContent = counts.pending.toLocaleString();
  document.getElementById("legend-not-approved").textContent = counts.notApproved.toLocaleString();

  let accumulated = 0;
  const slices = statuses.map(({ key, color }) => {
    const size = total ? counts[key] / total * 100 : 0;
    const slice = `${color} ${accumulated}% ${accumulated + size}%`;
    accumulated += size;
    return slice;
  });
  const chart = document.getElementById("status-chart");
  chart.style.setProperty("--status-chart", total
    ? `conic-gradient(${slices.join(", ")})`
    : "conic-gradient(#e8edf4 0% 100%)");
  chart.setAttribute("aria-label",
    `Request status chart: ${counts.approved} approved, ${counts.pending} pending, ${counts.notApproved} not approved, out of ${total} requests.`);
}

function showDashboardError(error) {
  const message = document.getElementById("dashboard-message");
  message.textContent = error.message;
  message.hidden = false;
}

async function signOut() {
  const csrfResponse = await fetch("/api/csrf");
  if (!csrfResponse.ok) throw new Error("Unable to establish a secure session.");
  const { csrfToken } = await csrfResponse.json();
  const response = await fetch("/api/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken }
  });
  if (!response.ok) throw new Error("Unable to sign out. Please try again.");
  window.location.assign("/");
}

document.getElementById("logout-button").addEventListener("click", () => {
  signOut().catch((error) => window.alert(error.message));
});

initializeDashboard().catch((error) => {
  if (error.message !== "Your session has expired. Please sign in again.") showDashboardError(error);
});
