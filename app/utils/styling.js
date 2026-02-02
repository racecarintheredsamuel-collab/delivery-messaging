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
