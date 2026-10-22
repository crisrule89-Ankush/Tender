const settingsForm = document.getElementById("settings-form");
const settingsSections = document.getElementById("settings-sections");
const settingsMessage = document.getElementById("settings-message");
const saveSettingsButton = document.getElementById("save-settings");
const appearanceColors = document.getElementById("appearance-colors");
const saveAppearanceButton = document.getElementById("save-appearance");
const addFieldButton = document.getElementById("add-field");
const fieldCount = document.getElementById("field-count");
const selectedFieldSelect = document.getElementById("selected-field");
const newFieldCategorySelect = document.getElementById("new-field-category");
const moveFieldUpButton = document.getElementById("move-field-up");
const moveFieldDownButton = document.getElementById("move-field-down");
const deleteFieldButton = document.getElementById("delete-field");
const accessMatrix = document.getElementById("tab-access-matrix");
const userAccessMatrix = document.getElementById("user-access-matrix");
const saveAccessButton = document.getElementById("save-access");
const workflowTabs = ["Tender Details", "Operation", "Banking", "Approval"];
const appearanceFields = [
  ["backgroundStart", "Background start", "Left side of the sign-in page background."],
  ["backgroundEnd", "Background end", "Right side of the sign-in page background."],
  ["accent", "Primary accent", "Sign-in button, icon and focus color."],
  ["accentHover", "Button hover", "Sign-in button color when hovered."],
  ["highlight", "Headline highlight", "Accent color for the logo and welcome headline."],
  ["card", "Login card", "Background color of the sign-in panel."],
  ["cardText", "Login card text", "Text color inside the sign-in panel."]
];

let csrfToken = "";
let selectedFieldKey = "";
let tabAccessSettings = {};
let userAccessSettings = {};
let loginAccounts = [];

function showMessage(text, kind) {
  settingsMessage.textContent = text;
  settingsMessage.className = `notice notice-${kind}`;
  settingsMessage.hidden = false;
}

function renderAppearance(appearance) {
  appearanceColors.replaceChildren();
  for (const [key, labelText, helpText] of appearanceFields) {
    const wrapper = document.createElement("div");
    wrapper.className = "appearance-color";
    const label = document.createElement("label");
    label.htmlFor = `appearance-${key}-text`;
    label.textContent = labelText;
    const controls = document.createElement("div");
    controls.className = "appearance-color-controls";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.id = `appearance-${key}-picker`;
    picker.dataset.appearanceKey = key;
    picker.value = appearance[key];
    picker.setAttribute("aria-label", `${labelText} color picker`);
    const hex = document.createElement("input");
    hex.type = "text";
    hex.id = `appearance-${key}-text`;
    hex.dataset.appearanceKey = key;
    hex.value = appearance[key].toUpperCase();
    hex.pattern = "#[0-9A-Fa-f]{6}";
    hex.maxLength = 7;
    hex.required = true;
    hex.setAttribute("aria-label", `${labelText} hex color`);
    picker.addEventListener("input", () => {
      hex.value = picker.value.toUpperCase();
      applyAppearance(readAppearance());
    });
    hex.addEventListener("input", () => {
      if (!/^#[0-9a-f]{6}$/i.test(hex.value)) return;
      picker.value = hex.value;
      applyAppearance(readAppearance());
    });
    controls.append(picker, hex);
    const help = document.createElement("small");
    help.textContent = helpText;
    wrapper.append(label, controls, help);
    appearanceColors.append(wrapper);
  }
}

function readAppearance() {
  const appearance = Object.fromEntries(appearanceFields.map(([key]) => {
    const value = appearanceColors.querySelector(`[data-appearance-key="${key}"].appearance-color-hex`)?.value;
    return [key, value];
  }));
  for (const [key] of appearanceFields) {
    const value = appearanceColors.querySelector(`#appearance-${key}-text`).value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${key} must be a six-digit hexadecimal color.`);
    appearance[key] = value.toLowerCase();
  }
  return appearance;
}

function selectSettingField(key) {
  selectedFieldKey = key;
  settingsSections.querySelectorAll(".setting-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.fieldKey === key);
  });
  if ([...selectedFieldSelect.options].some((option) => option.value === key)) {
    selectedFieldSelect.value = key;
  }
  const hasSelection = [...settingsSections.querySelectorAll(".setting-card")]
    .some((card) => card.dataset.fieldKey === key);
  const currentField = hasSelection ? readSettings().find((field) => field.key === key) : null;
  const sameCategoryFields = currentField
    ? readSettings().filter((field) => field.section === currentField.section)
    : [];
  const categoryIndex = sameCategoryFields.findIndex((field) => field.key === key);
  moveFieldUpButton.disabled = !hasSelection || categoryIndex <= 0;
  moveFieldDownButton.disabled = !hasSelection || categoryIndex < 0 || categoryIndex >= sameCategoryFields.length - 1;
  const selectedCard = [...settingsSections.querySelectorAll(".setting-card")]
    .find((card) => card.dataset.fieldKey === key);
  const isProtected = selectedFieldKey === "branch" || selectedCard?.dataset.systemField === "true";
  deleteFieldButton.disabled = !hasSelection || isProtected;
  deleteFieldButton.title = selectedFieldKey === "branch"
    ? "Branch must remain in Tender Details to generate unique record IDs."
    : isProtected ? "System-managed Approval fields must remain in the form." : "";
}

function renderSettings(settings) {
  const grouped = new Map();
  for (const field of settings) {
    if (!grouped.has(field.section)) grouped.set(field.section, []);
    grouped.get(field.section).push(field);
  }

  if (!settings.some((field) => field.key === selectedFieldKey)) {
    selectedFieldKey = settings[0]?.key || "";
  }
  settingsSections.replaceChildren();
  fieldCount.textContent = `${settings.length} / 150 fields`;

  selectedFieldSelect.replaceChildren();
  for (const field of settings) {
    const option = document.createElement("option");
    option.value = field.key;
    option.textContent = `${field.label} · ${field.section}`;
    selectedFieldSelect.append(option);
  }
  selectedFieldSelect.disabled = settings.length === 0;

  const selectedCategory = newFieldCategorySelect.value;
  newFieldCategorySelect.replaceChildren();
  for (const categoryName of new Set([...grouped.keys(), "Custom fields"])) {
    const option = document.createElement("option");
    option.value = categoryName;
    option.textContent = categoryName;
    newFieldCategorySelect.append(option);
  }
  newFieldCategorySelect.value = grouped.has(selectedCategory) || selectedCategory === "Custom fields"
    ? selectedCategory
    : grouped.keys().next().value || "Custom fields";

  for (const [sectionName, fields] of grouped) {
    const section = document.createElement("section");
    section.className = "form-section setting-category-group";
    section.dataset.category = sectionName;
    const categoryHeader = document.createElement("div");
    categoryHeader.className = "setting-category-header";
    const title = document.createElement("h3");
    title.textContent = sectionName;
    const categoryCount = document.createElement("span");
    categoryCount.className = "category-field-count";
    categoryCount.textContent = `${fields.length} ${fields.length === 1 ? "field" : "fields"}`;
    categoryHeader.append(title, categoryCount);
    const grid = document.createElement("div");
    grid.className = "settings-grid";
    grid.addEventListener("dragover", (event) => {
      event.preventDefault();
      grid.classList.add("category-drop-active");
      event.dataTransfer.dropEffect = "move";
    });
    grid.addEventListener("dragleave", (event) => {
      if (!grid.contains(event.relatedTarget)) grid.classList.remove("category-drop-active");
    });
    grid.addEventListener("drop", (event) => {
      event.preventDefault();
      grid.classList.remove("category-drop-active");
      const draggedKey = event.dataTransfer.getData("text/plain");
      const draggedCard = [...settingsSections.querySelectorAll(".setting-card")]
        .find((item) => item.dataset.fieldKey === draggedKey);
      if (!draggedCard || grid.contains(draggedCard)) return;
      draggedCard.querySelector(".setting-category").value = sectionName;
      grid.append(draggedCard);
      selectedFieldKey = draggedKey;
      renderSettings(readSettings());
      settingsMessage.hidden = true;
    });

    for (const field of fields) {
      const card = document.createElement("article");
      card.className = "setting-card";
      card.dataset.fieldKey = field.key;
      card.dataset.systemField = String(field.system === true);
      card.draggable = true;
      card.tabIndex = 0;
      card.setAttribute("aria-label", `Field settings for ${field.label}`);
      card.addEventListener("click", () => selectSettingField(field.key));
      card.addEventListener("focusin", () => selectSettingField(field.key));
      card.addEventListener("dragstart", (event) => {
        if (!event.target.closest(".setting-drag-grip")) {
          event.preventDefault();
          return;
        }
        card.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", field.key);
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        settingsSections.querySelectorAll(".setting-card").forEach((item) => item.classList.remove("drop-before", "drop-after"));
        settingsSections.querySelectorAll(".settings-grid").forEach((item) => item.classList.remove("category-drop-active"));
      });
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        const bounds = card.getBoundingClientRect();
        card.classList.toggle("drop-before", event.clientY < bounds.top + bounds.height / 2);
        card.classList.toggle("drop-after", event.clientY >= bounds.top + bounds.height / 2);
        event.dataTransfer.dropEffect = "move";
      });
      card.addEventListener("dragleave", () => card.classList.remove("drop-before", "drop-after"));
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        const draggedKey = event.dataTransfer.getData("text/plain");
        const draggedCard = [...settingsSections.querySelectorAll(".setting-card")]
          .find((item) => item.dataset.fieldKey === draggedKey);
        if (!draggedCard || draggedCard === card) return;
        const targetCategory = card.querySelector(".setting-category").value.trim();
        draggedCard.querySelector(".setting-category").value = targetCategory;
        const bounds = card.getBoundingClientRect();
        if (event.clientY < bounds.top + bounds.height / 2) card.before(draggedCard);
        else card.after(draggedCard);
        selectedFieldKey = draggedKey;
        renderSettings(readSettings());
        settingsMessage.hidden = true;
      });
      const heading = document.createElement("div");
      heading.className = "setting-card-heading";
      const name = document.createElement("div");
      name.className = "setting-field-identity";
      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.className = "setting-label";
      labelInput.value = field.label;
      labelInput.maxLength = 100;
      labelInput.required = true;
      labelInput.setAttribute("aria-label", "Field name");
      labelInput.addEventListener("input", () => {
        const option = [...selectedFieldSelect.options].find((item) => item.value === field.key);
        if (option) option.textContent = `${labelInput.value.trim() || "New field"} · ${category.value || field.section}`;
      });
      const key = document.createElement("small");
      key.textContent = field.key;
      name.append(labelInput, key);
      const actions = document.createElement("div");
      actions.className = "setting-card-actions";
      const dragGrip = document.createElement("span");
      dragGrip.className = "setting-drag-grip";
      dragGrip.textContent = "⠿";
      dragGrip.draggable = true;
      dragGrip.title = `Drag to reorder or recategorize ${field.label}`;
      dragGrip.setAttribute("aria-hidden", "true");
      const nullableNote = document.createElement("span");
      nullableNote.className = "required-toggle";
      nullableNote.textContent = "Optional";
      actions.append(dragGrip, nullableNote);
      heading.append(name, actions);

      const type = document.createElement("select");
      type.className = "setting-type";
      type.setAttribute("aria-label", `${field.label} input type`);
      const inputTypes = [
        ["text", "Open box (text)"],
        ["number", "Number"],
        ["select", "Dropdown"],
        ["date", "Date"],
        ["textarea", "Long text"]
      ];
      for (const [value, label] of inputTypes) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        type.append(option);
      }
      type.value = field.type;
      const typeLabel = document.createElement("label");
      typeLabel.className = "setting-type-control";
      typeLabel.textContent = "Input type";
      typeLabel.append(type);

      const categoryLabel = document.createElement("label");
      categoryLabel.className = "setting-type-control";
      categoryLabel.textContent = "Category";
      const category = document.createElement("input");
      category.type = "text";
      category.className = "setting-category";
      category.value = field.section;
      category.maxLength = 80;
      category.required = true;
      category.addEventListener("change", () => {
        const updated = readSettings();
        renderSettings(updated);
        settingsSections.querySelector(`[data-field-key="${field.key}"] .setting-category`).focus();
      });
      category.addEventListener("input", () => {
        const option = [...selectedFieldSelect.options].find((item) => item.value === field.key);
        if (option) option.textContent = `${labelInput.value.trim() || "New field"} · ${category.value.trim() || field.section}`;
        if (selectedFieldKey === field.key) selectSettingField(field.key);
      });
      categoryLabel.append(category);

      const tabLabel = document.createElement("label");
      tabLabel.className = "setting-type-control";
      tabLabel.textContent = "Form tab";
      const tab = document.createElement("select");
      tab.className = "setting-tab";
      tab.setAttribute("aria-label", `${field.label} form tab`);
      for (const tabName of workflowTabs) {
        const option = document.createElement("option");
        option.value = tabName;
        option.textContent = tabName;
        tab.append(option);
      }
      tab.value = field.tab;
      tabLabel.append(tab);

      const optionsLabel = document.createElement("label");
      optionsLabel.className = "setting-options-control";
      optionsLabel.textContent = "Dropdown choices (one per line)";
      const options = document.createElement("textarea");
      options.className = "setting-options";
      options.value = (field.options || []).join("\n");
      options.placeholder = "Add one option per line";
      options.maxLength = 10000;
      optionsLabel.append(options);
      const updateOptionsVisibility = () => {
        optionsLabel.hidden = type.value !== "select";
      };
      type.addEventListener("change", updateOptionsVisibility);
      updateOptionsVisibility();

      card.append(heading, tabLabel, categoryLabel, typeLabel, optionsLabel);
      grid.append(card);
    }
    section.append(categoryHeader, grid);
    settingsSections.append(section);
  }
  selectSettingField(selectedFieldKey);
}

function moveField(card, direction) {
  const category = card.querySelector(".setting-category").value.trim();
  const group = card.closest(".setting-category-group");
  const cards = [...group.querySelectorAll(".setting-card")]
    .filter((item) => item.querySelector(".setting-category").value.trim() === category);
  const index = cards.indexOf(card);
  const target = cards[index + direction];
  if (!target) return;
  if (direction < 0) target.before(card);
  else target.after(card);
  renderSettings(readSettings());
  settingsMessage.hidden = true;
}

function readSettings() {
  return [...settingsSections.querySelectorAll(".setting-card")].map((card) => ({
    key: card.dataset.fieldKey,
    label: card.querySelector(".setting-label").value.trim(),
    tab: card.querySelector(".setting-tab").value,
    section: card.querySelector(".setting-category").value.trim(),
    type: card.querySelector(".setting-type").value,
    required: false,
    ...(card.dataset.systemField === "true" ? { system: true } : {}),
    options: card.querySelector(".setting-options").value
      .split(/\r?\n/)
      .map((option) => option.trim())
      .filter(Boolean)
  }));
}

function createAccessTable(rows, nameLabel, permissionsForRow, identifier) {
  const table = document.createElement("table");
  table.className = "access-table";
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const nameHeader = document.createElement("th");
  nameHeader.textContent = nameLabel;
  headerRow.append(nameHeader);
  for (const tabName of workflowTabs) {
    const header = document.createElement("th");
    header.textContent = tabName;
    headerRow.append(header);
  }
  head.append(headerRow);
  const body = document.createElement("tbody");
  for (const item of rows) {
    const row = document.createElement("tr");
    row.dataset[identifier.attribute] = identifier.value(item);
    const nameCell = document.createElement("th");
    nameCell.scope = "row";
    nameCell.textContent = identifier.label(item);
    row.append(nameCell);
    for (const tabName of workflowTabs) {
      const cell = document.createElement("td");
      const access = permissionsForRow(item)[tabName];
      for (const mode of ["view", "edit"]) {
        const label = document.createElement("label");
        label.className = "access-toggle";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.disabled = identifier.attribute === "role" && item.toLowerCase() === "approver";
        checkbox.dataset.tab = tabName;
        checkbox.dataset.mode = mode;
        checkbox.checked = access[mode];
        checkbox.setAttribute("aria-label", `${identifier.label(item)} ${mode} ${tabName}`);
        checkbox.addEventListener("change", () => {
          const view = row.querySelector(`input[data-tab="${tabName}"][data-mode="view"]`);
          const edit = row.querySelector(`input[data-tab="${tabName}"][data-mode="edit"]`);
          if (mode === "edit" && checkbox.checked) view.checked = true;
          if (mode === "view" && !checkbox.checked) edit.checked = false;
        });
        label.append(checkbox, document.createTextNode(mode));
        cell.append(label);
      }
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function readAccessRow(row) {
  return Object.fromEntries(workflowTabs.map((tabName) => [
    tabName,
    {
      view: row.querySelector(`input[data-tab="${tabName}"][data-mode="view"]`).checked,
      edit: row.querySelector(`input[data-tab="${tabName}"][data-mode="edit"]`).checked
    }
  ]));
}

function renderTabAccess(payload) {
  const { roles, userOverrides = {}, accounts = [] } = payload.roles
    ? payload
    : { roles: payload, userOverrides: {}, accounts: [] };
  tabAccessSettings = roles;
  userAccessSettings = userOverrides;
  loginAccounts = accounts;
  accessMatrix.replaceChildren();
  const roleNames = Object.keys(roles).sort((left, right) => left.localeCompare(right));
  if (!roleNames.length) {
    accessMatrix.textContent = "No non-administrator roles are configured.";
  } else {
    accessMatrix.append(createAccessTable(
      roleNames,
      "Role",
      (role) => roles[role],
      { attribute: "role", value: (role) => role, label: (role) => role }
    ));
  }
  userAccessMatrix.replaceChildren();
  if (!accounts.length) {
    userAccessMatrix.textContent = "No login accounts were found in dbo.userlogin.";
    return;
  }
  const userTable = createAccessTable(
    accounts,
    "Login · Branch · Role · Customize",
    (account) => account.permissions,
    { attribute: "username", value: (account) => account.username.toLowerCase(), label: (account) => account.username }
  );
  for (const row of userTable.querySelectorAll("tbody tr[data-username]")) {
    const username = row.dataset.username;
    const account = accounts.find((item) => item.username.toLowerCase() === username);
    const accountCell = row.querySelector("th");
    const controls = document.createElement("div");
    controls.className = "user-access-identity";
    const branchRole = document.createElement("small");
    branchRole.textContent = [account.branch, account.role].filter(Boolean).join(" · ");
    const customizeLabel = document.createElement("label");
    customizeLabel.className = "access-toggle user-access-customize";
    const customize = document.createElement("input");
    customize.type = "checkbox";
    customize.checked = account.custom;
    customize.disabled = ["admin", "approver"].includes(account.role.toLowerCase());
    customize.setAttribute("aria-label", `Customize permissions for ${account.username}`);
    customize.addEventListener("change", () => {
      const sourcePermissions = customize.checked
        ? (userAccessSettings[username] || roles[account.role.toLowerCase()] || defaultAccessForRole(account.role))
        : roles[account.role.toLowerCase()] || defaultAccessForRole(account.role);
      for (const tabName of workflowTabs) {
        for (const mode of ["view", "edit"]) {
          const box = row.querySelector(`input[data-tab="${tabName}"][data-mode="${mode}"]`);
          box.checked = sourcePermissions[tabName][mode];
          box.disabled = !customize.checked || customize.disabled;
        }
      }
      account.custom = customize.checked;
    });
    customizeLabel.append(customize, document.createTextNode("Customize"));
    controls.append(branchRole, customizeLabel);
    accountCell.append(controls);
    for (const checkbox of row.querySelectorAll('input[type="checkbox"][data-tab]')) {
      checkbox.disabled = !account.custom || customize.disabled;
    }
  }
  userAccessMatrix.append(userTable);
}

function defaultAccessForRole(role) {
  return role.toLowerCase() === "admin"
    ? Object.fromEntries(workflowTabs.map((tab) => [tab, { view: true, edit: true }]))
    : Object.fromEntries(workflowTabs.map((tab) => [tab, { view: false, edit: false }]));
}

function readRoleAccess() {
  const permissions = {};
  for (const row of accessMatrix.querySelectorAll("tbody tr[data-role]")) {
    const role = row.dataset.role;
    permissions[role] = readAccessRow(row);
  }
  return permissions;
}

function readUserAccess() {
  const overrides = {};
  for (const row of userAccessMatrix.querySelectorAll("tbody tr[data-username]")) {
    const customize = row.querySelector(".user-access-customize input");
    if (customize.checked && !customize.disabled) overrides[row.dataset.username] = readAccessRow(row);
  }
  return overrides;
}

async function saveFieldSettings(fields, successMessage = "Field settings saved and applied to open Tender pages.") {
  const response = await fetch("/api/field-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ fields })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to save field settings.");
  renderSettings(result.fields);
  showMessage(successMessage, "success");
  return result.fields;
}

async function initialize() {
  const [csrfResponse, userResponse] = await Promise.all([
    fetch("/api/csrf"),
    fetch("/api/me")
  ]);
  if (userResponse.status === 401) {
    window.location.assign("/");
    return;
  }
  if (!csrfResponse.ok || !userResponse.ok) throw new Error("Unable to load account settings.");
  csrfToken = (await csrfResponse.json()).csrfToken;
  const user = await userResponse.json();
  if (String(user.role).trim().toLowerCase() !== "admin") {
    window.location.assign("/dashboard.html");
    return;
  }
  document.getElementById("user-name").textContent = [user.username, user.branch, user.role].filter(Boolean).join(" · ");

  const [settingsResponse, appearanceResponse, accessResponse] = await Promise.all([
    fetch("/api/field-settings"),
    fetch("/api/appearance", { cache: "no-store" }),
    fetch("/api/tab-access", { cache: "no-store" })
  ]);
  if (!settingsResponse.ok || !appearanceResponse.ok || !accessResponse.ok) {
    const result = settingsResponse.ok ? null : await settingsResponse.json();
    throw new Error(result?.error || "Unable to load field or appearance settings.");
  }
  renderSettings(await settingsResponse.json());
  renderAppearance(await appearanceResponse.json());
  renderTabAccess(await accessResponse.json());
}

async function addField(category) {
  settingsMessage.hidden = true;
  const existing = readSettings();
  if (existing.length >= 150) {
    showMessage("A maximum of 150 fields can be configured.", "error");
    return;
  }
  let key;
  do {
    key = `customField${Date.now()}${Math.floor(Math.random() * 10000)}`;
  } while (existing.some((field) => field.key === key));
  existing.push({
    key,
    label: "New field",
    tab: "Tender Details",
    section: category,
    type: "text",
    required: false,
    options: []
  });

  selectedFieldKey = key;
  renderSettings(existing);
  addFieldButton.disabled = true;
  addFieldButton.textContent = "Adding...";
  try {
    await saveFieldSettings(existing, "Field added and published to open Tender pages.");
    const newCard = [...settingsSections.querySelectorAll(".setting-card")].find((card) => card.dataset.fieldKey === key);
    newCard?.querySelector(".setting-label").focus();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    addFieldButton.disabled = false;
    addFieldButton.textContent = "＋ Add field";
  }
}

document.getElementById("add-access-role").addEventListener("click", () => {
  const input = document.getElementById("new-access-role");
  const role = input.value.trim();
  if (!role || role.toLowerCase() === "admin") {
    showMessage("Enter a non-admin role name.", "error");
    return;
  }
  const normalizedRole = role.toLowerCase();
  if (Object.keys(tabAccessSettings).some((current) => current.toLowerCase() === normalizedRole)) {
    showMessage("That role already has tab access settings.", "error");
    return;
  }
  tabAccessSettings[normalizedRole] = Object.fromEntries(
    workflowTabs.map((tabName) => [tabName, { view: false, edit: false }])
  );
  input.value = "";
  renderTabAccess({ roles: tabAccessSettings, userOverrides: userAccessSettings, accounts: loginAccounts });
});

saveAccessButton.addEventListener("click", async () => {
  saveAccessButton.disabled = true;
  try {
    const response = await fetch("/api/tab-access", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        permissions: readRoleAccess(),
        userPermissions: readUserAccess()
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save tab access.");
    renderTabAccess(result);
    showMessage("Role and individual login access saved and applied.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    saveAccessButton.disabled = false;
  }
});

selectedFieldSelect.addEventListener("change", () => selectSettingField(selectedFieldSelect.value));
addFieldButton.addEventListener("click", () => { addField(newFieldCategorySelect.value); });
moveFieldUpButton.addEventListener("click", () => {
  const card = [...settingsSections.querySelectorAll(".setting-card")]
    .find((item) => item.dataset.fieldKey === selectedFieldKey);
  if (card) moveField(card, -1);
});
moveFieldDownButton.addEventListener("click", () => {
  const card = [...settingsSections.querySelectorAll(".setting-card")]
    .find((item) => item.dataset.fieldKey === selectedFieldKey);
  if (card) moveField(card, 1);
});
deleteFieldButton.addEventListener("click", async () => {
  const card = [...settingsSections.querySelectorAll(".setting-card")]
    .find((item) => item.dataset.fieldKey === selectedFieldKey);
  if (!card) return;
  const deletedFieldKey = selectedFieldKey;
  const fieldLabel = card.querySelector(".setting-label").value.trim() || deletedFieldKey;
  if (settingsSections.querySelectorAll(".setting-card").length <= 1) {
    showMessage("At least one field must remain on the tender form.", "error");
    return;
  }
  if (!window.confirm(`Delete "${fieldLabel}" from the active tender form now? This immediately saves all current field settings and updates open tender pages. Existing saved records will not be changed.`)) return;

  deleteFieldButton.disabled = true;
  deleteFieldButton.textContent = "Deleting...";
  try {
    const current = readSettings();
    const selectedIndex = current.findIndex((field) => field.key === selectedFieldKey);
    const updatedFields = current.filter((field) => field.key !== selectedFieldKey);
    selectedFieldKey = updatedFields[Math.min(selectedIndex, updatedFields.length - 1)]?.key || "";
    await saveFieldSettings(updatedFields, `"${fieldLabel}" was deleted and the Tender form was updated.`);
  } catch (error) {
    selectedFieldKey = deletedFieldKey;
    showMessage(error.message, "error");
  } finally {
    deleteFieldButton.textContent = "Delete selected field";
    selectSettingField(selectedFieldKey);
  }
});

saveAppearanceButton.addEventListener("click", async () => {
  settingsMessage.hidden = true;
  saveAppearanceButton.disabled = true;
  saveAppearanceButton.textContent = "Saving colors...";
  try {
    const appearance = readAppearance();
    const response = await fetch("/api/appearance", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ appearance })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save login colors.");
    applyAppearance(result.appearance);
    showMessage("Login colors saved and published to open sign-in pages.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    saveAppearanceButton.disabled = false;
    saveAppearanceButton.textContent = "Save login colors";
  }
});

document.getElementById("reset-appearance").addEventListener("click", () => {
  renderAppearance(defaultAppearance);
  applyAppearance(defaultAppearance);
  showMessage("Default colors are previewed. Save login colors to publish them.", "success");
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  settingsMessage.hidden = true;
  saveSettingsButton.disabled = true;
  saveSettingsButton.textContent = "Saving...";
  try {
    await saveFieldSettings(readSettings());
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    saveSettingsButton.disabled = false;
    saveSettingsButton.textContent = "Save field settings";
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken }
    });
    if (!response.ok) throw new Error("Unable to sign out. Please try again.");
    window.location.assign("/");
  } catch (error) {
    showMessage(error.message, "error");
  }
});

initialize().catch((error) => showMessage(error.message, "error"));
