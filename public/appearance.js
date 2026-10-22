const defaultAppearance = {
  backgroundStart: "#f4faff",
  backgroundEnd: "#cbd9e8",
  accent: "#0879e8",
  accentHover: "#1154ad",
  highlight: "#8fc7ff",
  card: "#071b45",
  cardText: "#ffffff"
};

function colorChannels(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function relativeLuminance(hex) {
  const channels = colorChannels(hex).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function mixColor(hex, target, amount) {
  const sourceChannels = colorChannels(hex);
  const targetChannels = colorChannels(target);
  const mixed = sourceChannels.map((value, index) =>
    Math.round(value * (1 - amount) + targetChannels[index] * amount)
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function contrastSafeAppearance(appearance) {
  const safe = { ...defaultAppearance, ...appearance };
  for (const key of ["backgroundStart", "backgroundEnd"]) {
    let candidate = safe[key];
    for (let mix = 0; relativeLuminance(candidate) < 0.76 && mix < 24; mix += 1) {
      candidate = mixColor(candidate, "#ffffff", 0.18);
    }
    safe[key] = candidate;
  }
  let card = safe.card;
  for (let mix = 0; relativeLuminance(card) > 0.12 && mix < 24; mix += 1) {
    card = mixColor(card, "#071b45", 0.2);
  }
  safe.card = card;
  safe.cardText = "#ffffff";
  return safe;
}

function applyAppearance(appearance) {
  const root = document.documentElement;
  const safeAppearance = contrastSafeAppearance(appearance);
  const cssVariables = {
    backgroundStart: "--login-background-start",
    backgroundEnd: "--login-background-end",
    accent: "--login-accent",
    accentHover: "--login-accent-hover",
    highlight: "--login-highlight",
    card: "--login-card",
    cardText: "--login-card-text"
  };
  for (const [key, variable] of Object.entries(cssVariables)) {
    if (/^#[0-9a-f]{6}$/i.test(safeAppearance[key] || "")) {
      root.style.setProperty(variable, safeAppearance[key]);
    }
  }
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", safeAppearance.backgroundStart);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { contrastSafeAppearance, relativeLuminance };
}
