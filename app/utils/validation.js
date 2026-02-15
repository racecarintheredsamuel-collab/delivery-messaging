// ============================================================================
// VALIDATION HELPERS
// Functions to validate rule data, time formats, and config/settings schemas
// ============================================================================

import { z } from "zod";

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

// Rule match schema
const ruleMatchSchema = z.object({
  product_handles: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  stock_status: z.string().optional(),
}).passthrough();

// Rule settings schema - using passthrough for forward compatibility
const ruleSettingsSchema = z.object({
  // Collapsed states
  collapsed_product_matching: z.boolean().optional(),
  collapsed_dispatch_settings: z.boolean().optional(),
  collapsed_countdown_messages: z.boolean().optional(),
  collapsed_countdown_icon: z.boolean().optional(),
  collapsed_eta_timeline: z.boolean().optional(),
  // Messages
  show_messages: z.boolean().optional(),
  message_line_1: z.string().optional(),
  message_line_2: z.string().optional(),
  // Icon settings
  show_icon: z.boolean().optional(),
  icon: z.string().optional(),
  icon_style: z.string().optional(),
  icon_color: z.string().optional(),
  // Countdown
  show_countdown: z.boolean().optional(),
  // Dispatch settings overrides (separate flags for each setting type)
  override_cutoff_times: z.boolean().optional(),
  override_lead_time: z.boolean().optional(),
  override_closed_days: z.boolean().optional(),
  override_courier_no_delivery_days: z.boolean().optional(),
  cutoff_time: z.string().optional(),
  cutoff_time_sat: z.string().optional(),
  cutoff_time_sun: z.string().optional(),
  closed_days: z.array(z.string()).optional(),
  lead_time: z.number().min(0).max(30).optional(),
  courier_no_delivery_days: z.array(z.string()).optional(),
  // ETA Timeline
  show_eta_timeline: z.boolean().optional(),
  eta_delivery_days_min: z.number().optional(),
  eta_delivery_days_max: z.number().optional(),
  // Special Delivery
  special_delivery_text_alignment: z.enum(["left", "center", "right"]).optional(),
}).passthrough();

// Single rule schema
const ruleSchema = z.object({
  id: z.string(),
  name: z.string(),
  match: ruleMatchSchema.optional(),
  settings: ruleSettingsSchema.optional(),
});

// Profile schema
const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  rules: z.array(ruleSchema),
});

// Config v1 schema (legacy)
const configV1Schema = z.object({
  version: z.literal(1),
  rules: z.array(ruleSchema),
});

// Config v2 schema (current)
const configV2Schema = z.object({
  version: z.literal(2),
  profiles: z.array(profileSchema).min(1),
  activeProfileId: z.string(),
});

// Combined config schema
export const configSchema = z.union([configV1Schema, configV2Schema]);

// Custom holiday schema
const customHolidaySchema = z.object({
  date: z.string(),
  label: z.string().optional(),
});

// Custom icon schema (for global custom icons)
const customIconSchema = z.object({
  name: z.string().optional(),
  svg: z.string().optional(),
  url: z.string().optional(),
});

// Global settings schema
export const settingsSchema = z.object({
  // Business hours
  cutoff_time: z.string().optional(),
  cutoff_time_sat: z.string().optional(),
  cutoff_time_sun: z.string().optional(),
  lead_time: z.number().min(0).max(30).optional(),
  // Closed days
  closed_days: z.array(z.string()).optional(),
  // Bank holidays
  bank_holiday_country: z.string().optional(),
  custom_holidays: z.array(customHolidaySchema).optional(),
  // Courier settings
  courier_no_delivery_days: z.array(z.string()).optional(),
  // Typography
  use_theme_font: z.boolean().optional(),
  custom_font_family: z.string().optional(),
  use_theme_text_styling: z.boolean().optional(),
  text_color: z.string().optional(),
  font_size: z.union([z.string(), z.number()]).optional(),
  font_weight: z.string().optional(),
  // Block spacing
  messages_margin_top: z.number().optional(),
  messages_margin_bottom: z.number().optional(),
  eta_margin_top: z.number().optional(),
  eta_margin_bottom: z.number().optional(),
  // Alignment
  messages_alignment: z.string().optional(),
  eta_alignment: z.string().optional(),
  // ETA Timeline spacing
  eta_gap_icon_label: z.number().optional(),
  eta_gap_label_date: z.number().optional(),
  eta_horizontal_gap: z.number().optional(),
  eta_padding_horizontal: z.number().optional(),
  eta_padding_vertical: z.number().optional(),
  // Special Delivery spacing
  special_delivery_line_height: z.number().optional(),
  // Custom icons (global)
  custom_icons: z.array(customIconSchema).max(8).optional(),
  // Custom connector SVG for ETA Timeline
  custom_connector_svg: z.string().optional(),
  // Free Delivery Threshold
  fd_enabled: z.boolean().optional(),
  fd_threshold: z.number().min(0).optional(),
  fd_message_progress: z.string().optional(),
  fd_message_unlocked: z.string().optional(),
  fd_message_empty: z.string().optional(),
  fd_show_progress_bar: z.boolean().optional(),
  fd_progress_bar_color: z.string().optional(),
  fd_progress_bar_bg: z.string().optional(),
  fd_message_excluded: z.string().optional(),
  fd_show_announcement_bar: z.boolean().optional(),
  fd_announcement_progress_message: z.string().optional(),
  fd_announcement_unlocked_message: z.string().optional(),
  fd_announcement_empty_message: z.string().optional(),
  fd_announcement_excluded_message: z.string().optional(),
  fd_announcement_bg_color: z.string().optional(),
  fd_announcement_text_color: z.string().optional(),
  fd_announcement_text_size: z.string().optional(),
  fd_announcement_bar_height: z.string().optional(),
}).passthrough();

/**
 * Format Zod errors into a user-friendly string
 * @param {z.ZodError} error - The Zod error object
 * @returns {string} - Formatted error message
 */
function formatZodError(error) {
  const errors = error?.errors || [];
  if (errors.length === 0) {
    return error?.message || 'Validation failed';
  }
  const messages = errors.slice(0, 3).map(e => {
    const path = e.path.join('.');
    return path ? `${path}: ${e.message}` : e.message;
  });
  if (errors.length > 3) {
    messages.push(`...and ${errors.length - 3} more`);
  }
  return messages.join('; ');
}

/**
 * Validate config data against schema
 * @param {unknown} data - The data to validate
 * @returns {{ success: true, data: object } | { success: false, error: string }}
 */
export function validateConfig(data) {
  const result = configSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: formatZodError(result.error) };
}

/**
 * Validate settings data against schema
 * @param {unknown} data - The data to validate
 * @returns {{ success: true, data: object } | { success: false, error: string }}
 */
export function validateSettings(data) {
  const result = settingsSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: formatZodError(result.error) };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a value is a valid HH:MM time format (24-hour)
 * @param {*} value - The value to check
 * @returns {boolean} - True if valid HH:MM format
 */
export function isHHMM(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/**
 * Check if a rule has at least one matching condition (product handles or tags)
 * @param {Object} rule - The rule object to check
 * @returns {boolean} - True if rule has valid matching conditions
 */
export function ruleHasMatch(rule) {
  // Fallback rules always match (they're the catch-all)
  if (rule?.match?.is_fallback) return true;

  const handles = (rule?.match?.product_handles ?? [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  const tags = (rule?.match?.tags ?? [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  return handles.length > 0 || tags.length > 0;
}

/**
 * Safely parse a value to a number with NaN protection
 * @param {*} value - The value to parse
 * @param {number} defaultVal - Default value if parsing fails (default: 0)
 * @param {number} min - Minimum allowed value (default: -Infinity)
 * @param {number} max - Maximum allowed value (default: Infinity)
 * @returns {number} - The parsed number, clamped to min/max, or defaultVal if NaN
 */
export function safeParseNumber(value, defaultVal = 0, min = -Infinity, max = Infinity) {
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultVal;
  return Math.max(min, Math.min(max, num));
}

/**
 * Extract font name from a CSS font-family string
 * Handles quoted fonts like "'Inter', sans-serif" or unquoted like "Arial, sans-serif"
 * @param {string} fontFamily - The CSS font-family value
 * @param {string} fallback - Fallback font name if extraction fails (default: "Arial")
 * @returns {string} - The extracted font name
 */
export function extractFontName(fontFamily, fallback = "Arial") {
  if (!fontFamily || typeof fontFamily !== "string") return fallback;
  const match = fontFamily.match(/'([^']+)'/);
  if (match?.[1]) return match[1];
  // Try first font in comma-separated list
  const first = fontFamily.split(",")[0]?.trim();
  return first || fallback;
}

/**
 * Log technical error and return user-friendly message
 * @param {Error|string} technicalError - The technical error to log
 * @param {string} userMessage - User-friendly message to return
 * @returns {string} - The user-friendly message
 */
export function friendlyError(technicalError, userMessage = "An error occurred. Please try again.") {
  // Log only error type/message, not full objects that may contain sensitive config data
  const errorMsg = technicalError instanceof Error
    ? technicalError.message
    : Array.isArray(technicalError)
      ? `${technicalError.length} error(s)`
      : String(technicalError);
  console.error("Error:", errorMsg);
  return userMessage;
}

/**
 * Safely log errors without exposing sensitive data
 * Extracts only error type/code/message, not full payloads
 * @param {string} context - Description of what failed
 * @param {Error|Object|Array} error - The error to log
 */
export function safeLogError(context, error) {
  if (error instanceof Error) {
    console.error(`${context}:`, error.message);
  } else if (Array.isArray(error)) {
    // For userErrors arrays, just log count and first error field (not message which may contain data)
    const fields = error.map(e => e?.field).filter(Boolean).join(", ");
    console.error(`${context}: ${error.length} error(s)${fields ? ` on fields: ${fields}` : ""}`);
  } else if (error && typeof error === "object") {
    // For GraphQL errors, extract just the error codes/types
    const codes = error.extensions?.code || error.code || "unknown";
    console.error(`${context}: ${codes}`);
  } else {
    console.error(`${context}: ${String(error).substring(0, 100)}`);
  }
}
