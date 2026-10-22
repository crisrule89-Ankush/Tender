(function (root) {
  function getReferenceLabels(referenceType) {
    const selectedType = String(referenceType || "").trim();
    if (!selectedType) return { numberLabel: "Reference No", dateLabel: "Reference Date" };

    const dateLabel = /\bRef No\.?$/i.test(selectedType)
      ? selectedType.replace(/\bRef No\.?$/i, "Ref Date")
      : `${selectedType} Date`;
    return { numberLabel: selectedType, dateLabel };
  }

  function getJobTypeDateLabels(jobType, startDateLabel = "Start Date", endDateLabel = "End Date") {
    switch (String(jobType || "").trim().toLowerCase()) {
      case "installation":
        return { startDateLabel: "CH Date", endDateLabel: "MH Date" };
      case "maintenance":
        return { startDateLabel: "Maintenance period From", endDateLabel: "Maintenance period to" };
      default:
        return { startDateLabel, endDateLabel };
    }
  }

  function getRequisitionLabels(requisitionType, defaults = {}) {
    const selectedType = String(requisitionType || "").trim();
    const amountLabel = defaults.amountLabel || "Amount";
    const inFormOfLabel = defaults.inFormOfLabel || "In form of";
    const inFavorOfLabel = defaults.inFavorOfLabel || "in favor of";
    const validUptoLabel = defaults.validUptoLabel || "Valid Upto";
    const supportedTypes = new Set([
      "Tender Fees",
      "Processing Fees",
      "Legal & Stationary Charges",
      "Stamp Duty Charges",
      "EMD",
      "PBG",
      "Additional BG",
      "Advanced BG",
      "Extention BG"
    ]);

    if (!supportedTypes.has(selectedType)) {
      return { validUptoLabel, amountLabel, inFormOfLabel, inFavorOfLabel };
    }

    return {
      validUptoLabel,
      amountLabel: `${selectedType} Amount`,
      inFormOfLabel: `${selectedType} In Form of`,
      inFavorOfLabel: `${selectedType} in favor of`
    };
  }

  root.TenderReferenceLabels = Object.freeze({
    getReferenceLabels,
    getJobTypeDateLabels,
    getRequisitionLabels
  });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.TenderReferenceLabels;
  }
})(typeof globalThis === "object" ? globalThis : this);
