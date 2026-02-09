// ============================================================================
// STYLING HELPERS
// Functions to convert size/weight names to CSS values
// ============================================================================

/**
 * Get CSS size for single icon display
 * @param {string} size - Size name (small, medium, large, x-large, xx-large)
 * @returns {string} - CSS size value (e.g., "24px")
 */
export function getSingleIconSize(size) {
  const sizes = {
    small: "16px",
    medium: "24px",
    large: "32px",
    "x-large": "40px",
    "xx-large": "48px",
  };
  return sizes[size] || sizes.medium;
}

/**
 * Normalize single icon size - handles both string keywords and numeric px values
 * @param {string|number} value - Size value (string keyword or number)
 * @param {number} defaultValue - Default value if conversion fails
 * @returns {number} - Numeric px value
 */
export function normalizeSingleIconSize(value, defaultValue = 36) {
  if (typeof value === "number") return value;
  const parsed = parseInt(value, 10);
  if (!isNaN(parsed)) return parsed;
  const stringToNumber = {
    small: 20,
    medium: 28,
    large: 36,
    "x-large": 44,
    "xx-large": 52,
  };
  return stringToNumber[value] || defaultValue;
}

/**
 * Get CSS font size for text display
 * @param {string} size - Size name (xsmall, small, medium, large, xlarge)
 * @returns {string} - CSS size value (e.g., "16px")
 */
export function getTextFontSize(size) {
  const sizes = {
    xsmall: "12px",
    small: "14px",
    medium: "16px",
    large: "18px",
    xlarge: "20px",
  };
  return sizes[size] || sizes.medium;
}

/**
 * Normalize font size value - converts old string values to numbers
 * Handles backwards compatibility for existing rules with string values
 * @param {string|number} value - Size name or px number
 * @param {number} defaultValue - Default px value if not found
 * @returns {number} - Numeric px value
 */
export function normalizeFontSize(value, defaultValue = 16) {
  // Already a number
  if (typeof value === "number") return value;

  // Try parsing as number
  const parsed = parseInt(value, 10);
  if (!isNaN(parsed)) return parsed;

  // Convert old string values to numbers
  const stringToNumber = {
    xxsmall: 10,
    xsmall: 12,
    small: 14,
    medium: 16,
    large: 18,
    xlarge: 20,
  };

  return stringToNumber[value] || defaultValue;
}

/**
 * Normalize ETA label font size - converts old string values to numbers
 * @param {string|number} value - Size name or px number
 * @param {number} defaultValue - Default px value (12)
 * @returns {number} - Numeric px value
 */
export function normalizeEtaLabelFontSize(value, defaultValue = 12) {
  if (typeof value === "number") return value;
  const parsed = parseInt(value, 10);
  if (!isNaN(parsed)) return parsed;

  const stringToNumber = {
    xsmall: 11,
    small: 12,
    medium: 14,
    large: 16,
  };

  return stringToNumber[value] || defaultValue;
}

/**
 * Normalize ETA date font size - converts old string values to numbers
 * @param {string|number} value - Size name or px number
 * @param {number} defaultValue - Default px value (11)
 * @returns {number} - Numeric px value
 */
export function normalizeEtaDateFontSize(value, defaultValue = 11) {
  if (typeof value === "number") return value;
  const parsed = parseInt(value, 10);
  if (!isNaN(parsed)) return parsed;

  const stringToNumber = {
    xxsmall: 10,
    xsmall: 11,
    small: 12,
    medium: 14,
  };

  return stringToNumber[value] || defaultValue;
}

/**
 * Get CSS font weight for text display
 * @param {string} weight - Weight name (normal, medium, bold)
 * @returns {number} - CSS weight value (e.g., 400)
 */
export function getTextFontWeight(weight) {
  const weights = {
    normal: 400,
    medium: 500,
    bold: 600,
  };
  return weights[weight] || weights.normal;
}
