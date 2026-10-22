const form = document.getElementById("login-form");
const message = document.getElementById("login-message");
const submitButton = document.getElementById("login-button");
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("toggle-password");
const rememberMe = document.getElementById("remember-me");
const forgotPassword = document.getElementById("forgot-password");

try {
  const rememberedUsername = localStorage.getItem("tender.remembered-username");
  if (rememberedUsername) {
    form.elements.username.value = rememberedUsername;
    rememberMe.checked = true;
  }
} catch (error) {
  console.warn("Could not restore the remembered username:", error);
}

async function getCsrfToken() {
  const response = await fetch("/api/csrf");
  if (!response.ok) throw new Error("Could not start a secure sign-in session.");
  return (await response.json()).csrfToken;
}

async function loadAppearance() {
  try {
    const response = await fetch("/api/appearance", { cache: "no-store" });
    if (!response.ok) throw new Error(`Appearance settings returned HTTP ${response.status}.`);
    applyAppearance(await response.json());
  } catch (error) {
    console.error("Could not load saved login colors:", error);
    message.textContent = "Saved login colors could not be loaded; using the default palette.";
  }
  const updates = new EventSource("/api/appearance/events");
  updates.addEventListener("appearance-settings", (event) => {
    try {
      applyAppearance(JSON.parse(event.data));
    } catch (error) {
      console.error("Could not apply updated login colors:", error);
    }
  });
}

loadAppearance();

togglePassword.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePassword.textContent = isPassword ? "Hide" : "Show";
  togglePassword.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
});

forgotPassword.addEventListener("click", () => {
  message.textContent = "Please contact your system administrator to reset your password.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  if (!form.reportValidity()) return;

  submitButton.disabled = true;
  submitButton.textContent = "Signing in...";
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        username: form.elements.username.value.trim(),
        password: form.elements.password.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sign-in failed.");
    try {
      if (rememberMe.checked) {
        localStorage.setItem("tender.remembered-username", form.elements.username.value.trim());
      } else {
        localStorage.removeItem("tender.remembered-username");
      }
    } catch (error) {
      console.warn("Could not save the remembered username:", error);
    }
    window.location.assign("/dashboard.html");
  } catch (error) {
    message.textContent = error.message || "Unable to sign in. Please try again.";
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = '<span class="login-submit-icon" aria-hidden="true">➜</span>Login';
  }
});
