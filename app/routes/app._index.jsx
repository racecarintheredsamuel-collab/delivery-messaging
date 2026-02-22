// ============================================================================
// IMPORTS
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRouteError, redirect, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureDeliveryRulesDefinition } from "../models/deliveryRules.server";
import { ChevronDownIcon, ChevronRightIcon } from "../components/icons/ChevronIcons";
import { newRuleId, newProfileId } from "../utils/idGenerators";
import { isHHMM, ruleHasMatch, safeParseNumber, friendlyError, safeLogError, validateConfig } from "../utils/validation";
import { getSingleIconSize, getTextFontSize, getTextFontWeight, normalizeFontSize, normalizeEtaLabelFontSize, normalizeEtaDateFontSize, normalizeSingleIconSize } from "../utils/styling";
import { getIconSvg, getConfiguredCustomIcons, generateIconsMetafield } from "../utils/icons";
import { getHolidaysForYear, HOLIDAY_DEFINITIONS } from "../utils/holidays";
import { CustomDatePicker } from "../components/CustomDatePicker";
import { PreviewLine } from "../components/PreviewLine";
import { ETATimelinePreview } from "../components/ETATimelinePreview";
import {
  GET_SHOP_DELIVERY_DATA,
  GET_SHOP_ID,
  SET_METAFIELDS,
  SET_METAFIELDS_MINIMAL,
  METAFIELD_NAMESPACE,
  CONFIG_KEY,
  SETTINGS_KEY,
  ICONS_KEY,
} from "../graphql/queries";

// ============================================================================
// DEFAULT SETTINGS & CONSTANTS
// ============================================================================

// Default global settings
function defaultGlobalSettings() {
  return {
    preview_timezone: "",
    cutoff_time: "14:00",
    cutoff_time_sat: "",
    cutoff_time_sun: "",
    lead_time: 0,
    closed_days: ["sat", "sun"],
    bank_holiday_country: "",
    custom_holidays: [],
    courier_no_delivery_days: ["sat", "sun"],
    // Typography - Messages font
    use_theme_font: true,
    custom_font_family: "",
    // Typography - Messages text styling
    use_theme_text_styling: true,
    text_color: "var(--p-color-text, #374151)",
    font_size: "medium",
    font_weight: "normal",
    // Typography - ETA Timeline font
    eta_use_theme_font: true,
    eta_custom_font_family: "",
    eta_preview_theme_font: "",
    eta_preview_font_size_scale: "", // Font size scale for admin preview (80-130%)
    eta_preview_font_weight: "", // Font weight for admin preview
    // Typography - ETA Timeline text styling
    eta_use_theme_text_styling: true,
    eta_text_color: "var(--p-color-text, #374151)",
    eta_font_size: "small",
    eta_font_weight: "semibold",
    // Block spacing
    messages_margin_top: 0,
    messages_margin_bottom: 0,
    eta_margin_top: 0,
    eta_margin_bottom: 0,
    // Block alignment
    messages_alignment: "left",
    eta_alignment: "left",
    // ETA Timeline vertical spacing
    eta_gap_icon_label: 2,
    eta_gap_label_date: 0,
    // ETA Timeline padding
    eta_padding_horizontal: 8,
    eta_padding_vertical: 8,
    // Typography - Special Delivery Header styling
    special_delivery_header_use_theme_text_styling: true,
    special_delivery_header_text_color: "#111827",
    special_delivery_header_font_size: 16,
    special_delivery_header_font_weight: "semibold",
    special_delivery_header_gap: 4,
    special_delivery_line_height: 1.4,
    // Link styling
    link_color: "#2563eb",
    link_decoration: "underline",
    // Hover effects
    link_hover_color: "#1d4ed8",
    link_hover_decoration: "underline",
    link_hover_opacity: 1,
    link_thickness: "1px",
    link_hover_thickness: "2px",
    // Announcement bar link styling
    fd_announcement_link_color: "#ffffff",
    fd_announcement_link_decoration: "underline",
    fd_announcement_link_hover_color: "#e5e7eb",
    fd_announcement_link_hover_decoration: "underline",
    fd_announcement_link_hover_opacity: 1,
    fd_announcement_link_thickness: "1px",
    fd_announcement_link_hover_thickness: "2px",
  };
}

// ============================================================================
// LOADER - Fetch config and settings from Shopify metafields
// ============================================================================

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  // Ensure all metafield definitions exist (config, settings, icons)
  const defResult = await ensureDeliveryRulesDefinition(admin);
  console.log("[ICONS DEBUG] Definition result:", JSON.stringify(defResult));

  // Fetch config, settings, and icons metafields
  const res = await admin.graphql(GET_SHOP_DELIVERY_DATA, {
    variables: {
      namespace: METAFIELD_NAMESPACE,
      configKey: CONFIG_KEY,
      settingsKey: SETTINGS_KEY,
      iconsKey: ICONS_KEY,
    },
  });

  const json = await res.json();
  if (json.errors) {
    safeLogError("Failed to fetch delivery data", json.errors);
    throw new Error("Unable to load configuration. Please refresh the page.");
  }
  const shopId = json?.data?.shop?.id;
  const configMf = json?.data?.shop?.config;
  const settingsMf = json?.data?.shop?.settings;
  const iconsMf = json?.data?.shop?.icons;
  console.log("[ICONS DEBUG] iconsMf exists:", !!iconsMf?.value);

  // Create default config if it doesn't exist (first install)
  if (!configMf?.value) {
    // Create v2 config with Default profile directly (so it's persisted from the start)
    const defaultProfileId = newProfileId();
    const firstInstallConfig = {
      version: 2,
      profiles: [{
        id: defaultProfileId,
        name: "Default",
        rules: [],
      }],
      activeProfileId: defaultProfileId,
    };
    const setRes = await admin.graphql(SET_METAFIELDS, {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: CONFIG_KEY,
            type: "json",
            value: JSON.stringify(firstInstallConfig),
          },
        ],
      },
    });

    const setJson = await setRes.json();
    if (setJson.errors) {
      safeLogError("Failed to set default config", setJson.errors);
      throw new Error("Unable to initialize configuration. Please refresh the page.");
    }
    const errors = setJson?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) safeLogError("Failed to set default config", errors);
  }

  // Create icons metafield if it doesn't exist (stores preset icons for Liquid templates)
  if (!iconsMf?.value) {
    console.log("[ICONS DEBUG] Creating icons metafield...");
    const iconsData = generateIconsMetafield();
    const iconsDataStr = JSON.stringify(iconsData);
    console.log("[ICONS DEBUG] Icons data size:", iconsDataStr.length, "bytes, keys:", Object.keys(iconsData).length);
    const setIconsRes = await admin.graphql(SET_METAFIELDS, {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: ICONS_KEY,
            type: "json",
            value: JSON.stringify(iconsData),
          },
        ],
      },
    });

    const setIconsJson = await setIconsRes.json();
    console.log("[ICONS DEBUG] Mutation response:", JSON.stringify(setIconsJson));
    if (setIconsJson.errors) {
      console.error("[ICONS DEBUG] GraphQL errors:", setIconsJson.errors);
      safeLogError("Failed to set icons metafield", setIconsJson.errors);
    }
    const iconsErrors = setIconsJson?.data?.metafieldsSet?.userErrors ?? [];
    if (iconsErrors.length) {
      console.error("[ICONS DEBUG] User errors:", iconsErrors);
      safeLogError("Failed to set icons metafield", iconsErrors);
    }
    if (!setIconsJson.errors && !iconsErrors.length) {
      console.log("[ICONS DEBUG] Icons metafield created successfully!");
    }
  }

  // Parse global settings
  let globalSettings = defaultGlobalSettings();
  if (settingsMf?.value) {
    try {
      globalSettings = { ...globalSettings, ...JSON.parse(settingsMf.value) };
    } catch (error) {
      safeLogError("Failed to parse global settings, using defaults", error);
    }
  }

  // Check if user has any rules - if not, redirect to Getting Started
  // (but only for first-time users, not if they deleted all rules)
  const url = new URL(request.url);
  const skipOnboarding = url.searchParams.get("skip_onboarding") === "true";

  if (!skipOnboarding) {
    let hasRules = false;
    try {
      const configToCheck = configMf?.value ? JSON.parse(configMf.value) : null;
      if (configToCheck?.version === 2 && configToCheck.profiles) {
        hasRules = configToCheck.profiles.some(p => p.rules && p.rules.length > 0);
      } else if (configToCheck?.rules) {
        hasRules = configToCheck.rules.length > 0;
      }
    } catch (e) {
      // Ignore parse errors
    }

    if (!hasRules) {
      return redirect("/app/dashboard");
    }
  }

  const shopCurrency = json?.data?.shop?.currencyCode || 'GBP';

  // Track whether we loaded with existing data (for auto-save safeguard)
  const hasExistingConfig = !!configMf?.value;
  const hasExistingSettings = !!settingsMf?.value && settingsMf.value !== "{}";

  return {
    config: configMf?.value ?? JSON.stringify({ version: 1, rules: [] }),
    globalSettings,
    shopId, // Pass to client for action
    shopCurrency, // For preview formatting
    hasExistingConfig,
    hasExistingSettings,
  };
};

// ============================================================================
// ACTION - Save config to Shopify metafields
// ============================================================================

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const configRaw = formData.get("config");
  const settingsRaw = formData.get("settings");
  let shopId = formData.get("shopId");

  const metafieldsToSave = [];

  // Parse and validate config if provided
  if (configRaw && typeof configRaw === "string" && configRaw.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(configRaw);
    } catch (error) {
      safeLogError("Failed to parse config JSON", error);
      return { ok: false, error: "Config must be valid JSON." };
    }

    // Validate config against schema
    const validation = validateConfig(parsed);
    if (!validation.success) {
      safeLogError("Config validation failed", new Error(validation.error));
      return { ok: false, error: "Invalid configuration format. Please check your data and try again." };
    }
    metafieldsToSave.push({
      namespace: METAFIELD_NAMESPACE,
      key: CONFIG_KEY,
      type: "json",
      value: JSON.stringify(validation.data),
    });
  }

  // Parse settings if provided (no validation needed - just JSON)
  if (settingsRaw && typeof settingsRaw === "string" && settingsRaw.trim()) {
    let parsedSettings;
    try {
      parsedSettings = JSON.parse(settingsRaw);
    } catch (error) {
      safeLogError("Failed to parse settings JSON", error);
      return { ok: false, error: "Settings must be valid JSON." };
    }
    metafieldsToSave.push({
      namespace: METAFIELD_NAMESPACE,
      key: SETTINGS_KEY,
      type: "json",
      value: JSON.stringify(parsedSettings),
    });
  }

  if (metafieldsToSave.length === 0) {
    return { ok: false, error: "No data to save." };
  }

  // Use shopId from form data if provided, otherwise fetch (fallback for edge cases)
  if (!shopId) {
    const shopRes = await admin.graphql(GET_SHOP_ID);
    const shopJson = await shopRes.json();
    if (shopJson.errors) {
      return { ok: false, error: friendlyError(shopJson.errors, "Unable to save. Please try again or contact support if the issue persists.") };
    }
    shopId = shopJson?.data?.shop?.id;
  }

  // Add ownerId to all metafields
  const metafieldsWithOwner = metafieldsToSave.map(mf => ({
    ...mf,
    ownerId: shopId,
  }));

  const setRes = await admin.graphql(SET_METAFIELDS_MINIMAL, {
    variables: {
      metafields: metafieldsWithOwner,
    },
  });

  const setJson = await setRes.json();
  if (setJson.errors) {
    return { ok: false, error: friendlyError(setJson.errors, "Unable to save configuration. Please try again.") };
  }
  const errors = setJson?.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    return { ok: false, error: friendlyError(errors, "Unable to save. Please check your configuration and try again.") };
  }

  return { ok: true };
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function defaultProfile(name = "Default") {
  return {
    id: newProfileId(),
    name: name,
    rules: [],
  };
}

// Migrate v1 config to v2 format (profiles)
function migrateToV2(config) {
  if (config?.version === 2) return config;

  // v1 format: { version: 1, rules: [] }
  // v2 format: { version: 2, profiles: [{ id, name, rules }], activeProfileId }
  const profile = defaultProfile("Default");
  profile.rules = config?.rules ?? [];

  return {
    version: 2,
    profiles: [profile],
    activeProfileId: profile.id,
  };
}

// Normalize URL - prepend https:// to bare domains
function normalizeUrl(url) {
  if (/^(https?:\/\/|\/)/i.test(url)) return url;
  // Check if it looks like a domain (starts with alphanumeric, contains a dot)
  if (url.includes('.') && /^[a-z0-9][-a-z0-9]*\./i.test(url)) return 'https://' + url;
  return null;
}

// Parse **bold** and [link](url) markdown syntax into segments
function parseMarkdown(text) {
  if (!text) return [];
  const parts = [];
  // Combined regex for bold and links
  const regex = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    if (match[1] !== undefined) {
      // Bold match: **text**
      parts.push({ text: match[1], bold: true });
    } else if (match[2] !== undefined) {
      // Link match: [text](url)
      const finalUrl = normalizeUrl(match[3]);
      if (finalUrl) {
        parts.push({ text: match[2], bold: false, link: finalUrl });
      } else {
        parts.push({ text: match[0], bold: false }); // Keep as plain text if invalid URL
      }
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), bold: false });
  }

  return parts;
}

// Render text with {lb} line breaks as React elements
function renderWithLineBreaks(text, keyPrefix = '') {
  if (!text || !text.includes('{lb}')) {
    return text;
  }
  const parts = text.split('{lb}');
  return parts.map((part, i) => (
    <span key={`${keyPrefix}-${i}`}>
      {part}
      {i < parts.length - 1 && <br />}
    </span>
  ));
}

// Render a parsed markdown segment with bold and link support
function renderSegment(seg, i, keyPrefix = '', globalSettings = null) {
  const content = renderWithLineBreaks(seg.text, `${keyPrefix}-${i}`);
  const inner = seg.bold ? <strong key={`${keyPrefix}-${i}-b`}>{content}</strong> : <span key={`${keyPrefix}-${i}-s`}>{content}</span>;
  if (seg.link) {
    // Use class for hover support - styles injected via <style> tag in preview
    return <a key={i} href={seg.link} target="_blank" rel="noopener noreferrer" className="dib-link-preview">{inner}</a>;
  }
  return <span key={i}>{inner}</span>;
}

// Replace {arrival}, {express}, and {countdown} placeholders with computed strings for preview
function replaceDatePlaceholders(text, rule, globalSettings, shopCurrency = 'GBP', countdownText = '02h 14m') {
  if (!text) return text;

  // Format currency helper - strips .00 for whole numbers (£50 not £50.00)
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: shopCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Handle free delivery threshold placeholder (static value)
  // Note: {remaining} and {cart_total} are NOT supported in Messages section
  // as they cause confusing UX (e.g., "Spend £0 more..."). Use announcement bar or cart for dynamic messages.
  if (text.includes('{threshold}')) {
    const thresholdAmount = (globalSettings?.fd_threshold || 5000) / 100;
    text = text.replace(/{threshold}/g, formatCurrency(thresholdAmount));
  }

  if (!text.includes('{arrival}') && !text.includes('{express}') && !text.includes('{countdown}')) return text;

  // Import the same business day logic used by ETATimelinePreview
  const weekdayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formatDate = (d) => `${months[d.getMonth()]} ${d.getDate()}`;

  const previewTz = globalSettings?.preview_timezone || "";
  const now = new Date();
  let today;
  if (previewTz) {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: previewTz, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const g = (t) => parts.find((p) => p.type === t)?.value;
      today = new Date(Number(g("year")), Number(g("month")) - 1, Number(g("day")), Number(g("hour")), Number(g("minute")), Number(g("second")));
    } catch { today = now; }
  } else {
    today = now;
  }

  const todayDayName = weekdayNames[today.getDay()];
  // Separate override flags for each dispatch setting type
  const useCutoffOverride = rule.settings?.override_cutoff_times;
  const useClosedDaysOverride = rule.settings?.override_closed_days;
  const useLeadTimeOverride = rule.settings?.override_lead_time;
  const useCourierOverride = rule.settings?.override_courier_no_delivery_days;

  let cutoffTime = globalSettings?.cutoff_time || "14:00";
  if (useCutoffOverride && rule.settings?.cutoff_time?.trim()) cutoffTime = rule.settings.cutoff_time;
  if (todayDayName === "sat") {
    const sat = useCutoffOverride ? rule.settings?.cutoff_time_sat : globalSettings?.cutoff_time_sat;
    if (sat?.trim()) cutoffTime = sat;
  } else if (todayDayName === "sun") {
    const sun = useCutoffOverride ? rule.settings?.cutoff_time_sun : globalSettings?.cutoff_time_sun;
    if (sun?.trim()) cutoffTime = sun;
  }
  const [cH, cM] = (cutoffTime || "14:00").split(":").map(Number);
  const cutoffToday = new Date(today);
  cutoffToday.setHours(cH ?? 14, cM ?? 0, 0, 0);
  const beforeCutoff = today.getTime() < cutoffToday.getTime();

  const closedDaysArr = useClosedDaysOverride ? (rule.settings?.closed_days || []) : (globalSettings?.closed_days || []);
  const closedDays = new Set(Array.isArray(closedDaysArr) ? closedDaysArr : String(closedDaysArr).split(',').map(d => d.trim().toLowerCase()).filter(Boolean));

  const bankHolidayCountry = globalSettings?.bank_holiday_country || "";
  const customHolidaysArr = globalSettings?.custom_holidays || [];
  const customHolidays = new Set(Array.isArray(customHolidaysArr) ? customHolidaysArr.map(h => typeof h === 'string' ? h : h?.date).filter(Boolean) : []);

  const isHoliday = (date) => {
    const ds = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    if (customHolidays.has(ds)) return true;
    if (bankHolidayCountry) {
      const bankHolidays = getHolidaysForYear(bankHolidayCountry, date.getFullYear());
      if (bankHolidays.includes(ds)) return true;
    }
    return false;
  };

  const isTodayClosed = closedDays.has(todayDayName) || isHoliday(today);
  let shippingDate;
  if (beforeCutoff && !isTodayClosed) {
    shippingDate = new Date(today);
  } else {
    shippingDate = new Date(today.getTime() + 86400000);
    let attempts = 14;
    while (attempts > 0) {
      const dn = weekdayNames[shippingDate.getDay()];
      if (!closedDays.has(dn) && !isHoliday(shippingDate)) break;
      shippingDate = new Date(shippingDate.getTime() + 86400000);
      attempts--;
    }
  }

  // Apply lead time: add X business days to shipping date
  const leadTime = useLeadTimeOverride
    ? (rule.settings?.lead_time ?? globalSettings?.lead_time ?? 0)
    : (globalSettings?.lead_time ?? 0);
  if (leadTime > 0) {
    let daysAdded = 0;
    let maxAttempts = 60;
    while (daysAdded < leadTime && maxAttempts > 0) {
      shippingDate = new Date(shippingDate.getTime() + 86400000);
      const dn = weekdayNames[shippingDate.getDay()];
      if (!closedDays.has(dn) && !isHoliday(shippingDate)) {
        daysAdded++;
      }
      maxAttempts--;
    }
  }

  const courierArr = useCourierOverride
    ? (rule.settings?.courier_no_delivery_days ?? globalSettings?.courier_no_delivery_days ?? ["sat", "sun"])
    : (globalSettings?.courier_no_delivery_days || ["sat", "sun"]);
  const courierNoDelivery = new Set(Array.isArray(courierArr) ? courierArr : String(courierArr).split(',').map(d => d.trim().toLowerCase()).filter(Boolean));

  const addBizDays = (start, num) => {
    let cur = new Date(start.getTime());
    let added = 0, max = 60;
    while (added < num && max > 0) {
      cur = new Date(cur.getTime() + 86400000);
      if (!courierNoDelivery.has(weekdayNames[cur.getDay()]) && !isHoliday(cur)) added++;
      max--;
    }
    return cur;
  };

  if (text.includes('{arrival}')) {
    const minDays = rule.settings?.eta_delivery_days_min ?? 3;
    const maxDays = rule.settings?.eta_delivery_days_max ?? 5;
    const minDate = addBizDays(shippingDate, minDays);
    const maxDate = addBizDays(shippingDate, maxDays);
    const arrivalText = minDays === maxDays ? formatDate(minDate)
      : minDate.getMonth() === maxDate.getMonth() ? `${formatDate(minDate)}-${maxDate.getDate()}`
      : `${formatDate(minDate)}-${formatDate(maxDate)}`;
    text = text.replace('{arrival}', arrivalText);
  }
  if (text.includes('{express}')) {
    const expressDate = addBizDays(shippingDate, 1);
    text = text.replace('{express}', formatDate(expressDate));
  }
  if (text.includes('{countdown}')) {
    // Real-time countdown based on cutoff time settings
    text = text.replace('{countdown}', countdownText);
  }
  // Note: {lb} is handled in rendering, not here (needs to become actual <br /> element)
  return text;
}

// Migrate old message fields (label, message, message_2_label, message_2) to new format
function migrateMessageFields(settings) {
  if (!settings) return settings;

  let result = { ...settings };

  // Migrate old label+message format to message_line_1/2
  if (settings.message_line_1 === undefined) {
    let line1 = "";
    if (settings.label) line1 += `**${settings.label}** `;
    if (settings.message) line1 += settings.message;

    let line2 = "";
    if (settings.message_2_label) line2 += `**${settings.message_2_label}** `;
    if (settings.message_2) line2 += settings.message_2;

    result.message_line_1 = line1.trim();
    result.message_line_2 = line2.trim();
  }

  // Migrate old countdown settings (prefix/suffix) to {countdown} placeholder
  if (settings.show_countdown && (settings.countdown_prefix !== undefined || settings.countdown_suffix !== undefined)) {
    const prefix = settings.countdown_prefix || "Order within";
    const suffix = settings.countdown_suffix || "";
    let countdownMsg = `${prefix} {countdown}${suffix ? " " + suffix : ""}`.trim();

    // If bold was enabled, wrap countdown in **
    if (settings.countdown_bold_time !== false) {
      countdownMsg = countdownMsg.replace("{countdown}", "**{countdown}**");
    }

    // Shift existing messages down and insert countdown as line 1
    result.message_line_3 = result.message_line_2 || "";
    result.message_line_2 = result.message_line_1 || "";
    result.message_line_1 = countdownMsg;
    result.show_messages = true;

    // Clean up old countdown settings
    delete result.show_countdown;
    delete result.countdown_bold_time;
    delete result.countdown_prefix;
    delete result.countdown_suffix;
  }

  // Ensure message_line_3 exists
  if (result.message_line_3 === undefined) {
    result.message_line_3 = "";
  }

  return result;
}

function defaultRule() {
  return {
    id: newRuleId(),
    name: "Untitled rule",
    match: { product_handles: [], tags: [], stock_status: "any", is_fallback: false },
    settings: {
      // Collapsed states - only Product Matching expanded by default
      collapsed_product_matching: false,
      collapsed_dispatch_settings: true,
      collapsed_countdown_messages: true,
      collapsed_countdown_icon: true,
      collapsed_eta_timeline: true,

      show_messages: false,
      message_line_1: "",
      message_line_2: "",
      message_line_3: "",
      show_icon: false,
      icon: "truck",
      icon_style: "solid",
      icon_color: "#111827",
      icon_layout: "per-line",
      single_icon_size: "medium",
      icon_vertical_align: "top",
      border_thickness: 0,
      border_color: "#e5e7eb",
      border_radius: 8,
      background_color: "",
      max_width: 600,

      // Dispatch settings overrides (separate flags)
      override_cutoff_times: false,
      override_lead_time: false,
      override_closed_days: false,
      override_courier_no_delivery_days: false,
      cutoff_time: "",
      cutoff_time_sat: "",
      cutoff_time_sun: "",
      closed_days: [],
      lead_time: 0,
      courier_no_delivery_days: [],

      // ETA Timeline
      show_eta_timeline: false,
      eta_left_padding: 0,
      eta_icon_size: 36,
      eta_connector_style: "arrows",
      eta_connector_color: "#111827",
      eta_connector_use_main_color: true,
      eta_connector_alignment: "center",
      eta_color: "#111827",
      eta_use_main_icon_color: true,
      eta_border_width: 0,
      eta_border_color: "#e5e7eb",
      eta_border_radius: 8,
      eta_background_color: "",
      eta_delivery_days_min: 3,
      eta_delivery_days_max: 5,
      eta_order_icon: "clipboard-document-check",
      eta_shipping_icon: "truck",
      eta_delivery_icon: "home",
      eta_order_icon_style: "solid",
      eta_shipping_icon_style: "solid",
      eta_delivery_icon_style: "solid",
      eta_label_order: "Ordered",
      eta_label_shipping: "Shipped",
      eta_label_delivery: "Delivered",
      match_eta_border: false,
      match_eta_width: false,

      // Text styling (per-rule override for messages)
      override_global_text_styling: false,
      text_color: "var(--p-color-text, #374151)",
      font_size: "medium",
      font_weight: "normal",

      // ETA text styling (per-rule override) - Labels (Ordered, Shipped, Delivered)
      override_eta_text_styling: false,
      eta_label_color: "var(--p-color-text, #374151)",
      eta_label_font_size: "small",
      eta_label_font_weight: "semibold",

      // ETA text styling - Dates (Jan 20, Jan 21-24)
      eta_date_color: "var(--p-color-text-subdued, #6b7280)",
      eta_date_font_size: "xsmall",
      eta_date_font_weight: "normal",

      // Special Delivery block
      show_special_delivery: false,
      special_delivery_header: "",
      special_delivery_message: "",
      special_delivery_icon_size: 24,
      special_delivery_icon_color: "#111827",
      special_delivery_use_main_icon_color: true,
      // Special Delivery - Border Styling
      special_delivery_border_thickness: 0,
      special_delivery_border_color: "#e5e7eb",
      special_delivery_border_radius: 8,
      special_delivery_background_color: "",
      special_delivery_match_eta_border: false,
      special_delivery_match_eta_width: false,
      special_delivery_max_width: 600,
      // Special Delivery - Text Styling (per-rule override)
      special_delivery_override_global_text_styling: false,
      special_delivery_text_color: "#374151",
      special_delivery_font_size: "medium",
      special_delivery_font_weight: "normal",
      special_delivery_text_alignment: "left",
      // Special Delivery - Header Styling (per-rule override)
      special_delivery_override_global_header_styling: false,
      special_delivery_header_color: "#111827",
      special_delivery_header_font_size: 16,
      special_delivery_header_font_weight: "semibold",
      // Special Delivery - Icon selection from Icons page
      special_delivery_icon: "",
    },
  };
}

// ============================================================================
// PREVIEW COMPONENTS
// ============================================================================

// Validation helpers moved to app/utils/validation.js
// Icon SVG helpers moved to app/utils/icons.js
// Text styling helpers moved to app/utils/styling.js

// ============================================================================
// COLLAPSED STATE HELPERS (localStorage)
// ============================================================================

const getCollapsedState = (ruleId, section) => {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(`collapsed_${ruleId}_${section}`);
    return stored === null ? true : stored === 'true';
  } catch (e) {
    return true;
  }
};

const setCollapsedState = (ruleId, section, collapsed) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`collapsed_${ruleId}_${section}`, String(collapsed));
  } catch (e) {
    // Ignore localStorage errors
  }
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Index() {
  const { config, globalSettings: loaderGlobalSettings, shopId, shopCurrency, hasExistingConfig, hasExistingSettings } = useLoaderData();

  // Track whether we loaded with existing data (prevents overwriting with empty data)
  const [loadedWithData] = useState(hasExistingConfig || hasExistingSettings);

  // Editable global settings state (for Typography and Alignment panels)
  const [globalSettings, setGlobalSettings] = useState(loaderGlobalSettings);

  // Typography, Alignment, and Global Settings panel visibility
  const [showTypographyPanel, setShowTypographyPanel] = useState(false);
  const [showAlignmentPanel, setShowAlignmentPanel] = useState(false);
  const [showGlobalSettingsPanel, setShowGlobalSettingsPanel] = useState(false);

  // Custom holiday management state
  const [newCustomHoliday, setNewCustomHoliday] = useState("");
  const [newCustomHolidayLabel, setNewCustomHolidayLabel] = useState("");

  // Helper functions for Global Settings
  const toggleClosedDay = (day) => {
    const current = new Set(globalSettings.closed_days || []);
    if (current.has(day)) {
      current.delete(day);
    } else {
      if (current.size >= 6) return; // Prevent closing all 7 days
      current.add(day);
    }
    setGlobalSettings({ ...globalSettings, closed_days: Array.from(current) });
  };

  const toggleCourierDay = (day) => {
    const current = new Set(globalSettings.courier_no_delivery_days || []);
    if (current.has(day)) {
      current.delete(day);
    } else {
      if (current.size >= 6) return; // Prevent blocking all 7 days
      current.add(day);
    }
    setGlobalSettings({ ...globalSettings, courier_no_delivery_days: Array.from(current) });
  };

  const addCustomHoliday = () => {
    if (!newCustomHoliday) return;
    const current = globalSettings.custom_holidays || [];
    if (current.some(h => h.date === newCustomHoliday)) {
      alert("This date is already in your custom holidays list.");
      return;
    }
    const newHoliday = {
      date: newCustomHoliday,
      label: newCustomHolidayLabel || "Custom Holiday",
    };
    setGlobalSettings({
      ...globalSettings,
      custom_holidays: [...current, newHoliday].sort((a, b) => a.date.localeCompare(b.date)),
    });
    setNewCustomHoliday("");
    setNewCustomHolidayLabel("");
  };

  const removeCustomHoliday = (dateToRemove) => {
    const current = globalSettings.custom_holidays || [];
    setGlobalSettings({
      ...globalSettings,
      custom_holidays: current.filter(h => h.date !== dateToRemove),
    });
  };

  // Real-time countdown for preview (state only - useEffect is after rule is defined)
  const [countdownText, setCountdownText] = useState('02h 14m');

  // Parse and migrate config to v2 format on initial load
  const initialConfig = (() => {
    try {
      const obj = JSON.parse(config);
      const v2 = migrateToV2(obj);
      // Migrate message fields in all rules of all profiles
      v2.profiles = v2.profiles.map((profile) => ({
        ...profile,
        rules: profile.rules.map((rule) => ({
          ...rule,
          settings: migrateMessageFields(rule.settings),
        })),
      }));
      return v2;
    } catch (error) {
      safeLogError("Failed to parse/migrate initial config, using empty default", error);
      return migrateToV2({ version: 1, rules: [] });
    }
  })();

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const [draft, setDraft] = useState(JSON.stringify(initialConfig));
  // Note: activeProfileId is derived from parsed (below), not stored separately
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [handlesText, setHandlesText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [hoverDeleteIdx, setHoverDeleteIdx] = useState(null);

  // Undo state for rules - shape: { rule: <ruleObject>, index: number }
  const [lastDeleted, setLastDeleted] = useState(null);

  // Undo state for profiles - shape: { profile: <profileObject>, index: number }
  const [lastDeletedProfile, setLastDeletedProfile] = useState(null);

  // Profile actions lock (prevents accidental add/copy/delete)
  const [profilesLocked, setProfilesLocked] = useState(true);

  // Sticky column height - measured from actual viewport for iframe compatibility
  const [stickyHeight, setStickyHeight] = useState(null);

  // Compute configured custom icons from global settings
  const configuredCustomIcons = useMemo(
    () => getConfiguredCustomIcons(globalSettings),
    [globalSettings]
  );

  // Helper to get effective icon value (falls back to default if custom icon no longer configured)
  const getEffectiveIcon = (iconValue, defaultIcon = "truck") => {
    if (!iconValue) return defaultIcon;
    if (iconValue.startsWith("custom-")) {
      const isConfigured = configuredCustomIcons.some(c => c.value === iconValue);
      return isConfigured ? iconValue : defaultIcon;
    }
    return iconValue;
  };

  // ETA timeline width measurement for "Match ETA timeline width" feature
  const etaTimelineRef = useRef(null);
  const [etaTimelineWidth, setEtaTimelineWidth] = useState(null);

  // --------------------------------------------------------------------------
  // Refs & Effects
  // --------------------------------------------------------------------------

  // Measure viewport height for sticky column (100vh doesn't work in iframes)
  useEffect(() => {
    const updateHeight = () => {
      // Subtract offset for page header (56px for Shopify admin chrome + page heading)
      setStickyHeight(Math.max(300, window.innerHeight - 56));
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  const undoTimerRef = useRef(null);
  const undoProfileTimerRef = useRef(null);
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (undoProfileTimerRef.current) clearTimeout(undoProfileTimerRef.current);
    };
  }, []);

  // Measure ETA timeline width for "Match ETA timeline width" feature
  // Uses ResizeObserver for proper measurement without feedback loops
  useEffect(() => {
    const measureWidth = () => {
      if (etaTimelineRef.current) {
        const width = etaTimelineRef.current.offsetWidth;
        // Only update if width actually changed to prevent re-render loops
        setEtaTimelineWidth((prev) => (prev !== width ? width : prev));
      }
    };

    // Check periodically since the ref target may change
    const interval = setInterval(measureWidth, 500);
    measureWidth();

    return () => clearInterval(interval);
  }, []);

  // Refs for tags/handles inputs to enable programmatic blur before rule switch
  const tagsInputRef = useRef(null);
  const handlesInputRef = useRef(null);

  // Track which rule ID we're editing (prevents stale closure issues)
  const editingTagsRuleId = useRef(null);
  const editingHandlesRuleId = useRef(null);

  const fetcher = useFetcher();

  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const settingsAutoSaveTimerRef = useRef(null);
  const initialDraftRef = useRef(JSON.stringify(initialConfig));
  const initialSettingsRef = useRef(JSON.stringify(loaderGlobalSettings));

  useEffect(() => {
    // Handle dev reset - reload page to get fresh state
    if (fetcher.state === "idle" && fetcher.data?.reset === true) {
      if (fetcher.data?.ok === true) {
        console.log("[DEV RESET] Reloading page...", fetcher.data?.message || "");
        window.location.reload();
      } else {
        alert("Reset failed: " + (fetcher.data?.error || "Unknown error"));
      }
      return;
    }

    // Only show "Saved" when a POST finishes successfully
    if (fetcher.state === "idle" && fetcher.data?.ok === true) {
      setJustSaved(true);

      // Reset timer so repeated saves re-trigger the notice
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

      savedTimerRef.current = setTimeout(() => {
        setJustSaved(false);
      }, 2500);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // Check if config has meaningful data (at least one rule)
  const configHasData = () => {
    try {
      const parsed = JSON.parse(draft);
      if (parsed.version === 2 && parsed.profiles) {
        return parsed.profiles.some(p => p.rules && p.rules.length > 0);
      }
      return parsed.rules && parsed.rules.length > 0;
    } catch {
      return false;
    }
  };

  // Check if settings have meaningful data
  const settingsHaveData = () => {
    return globalSettings.cutoff_time || globalSettings.closed_days?.length > 0;
  };

  // Auto-save config after 2 seconds of inactivity
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    // Don't auto-save if unchanged from initial load
    if (draft === initialDraftRef.current) return;

    // Don't auto-save while already saving
    if (fetcher.state !== "idle") return;

    autoSaveTimerRef.current = setTimeout(() => {
      // Safeguard: don't auto-save empty config if we had data
      if (loadedWithData && !configHasData()) {
        console.warn("Blocked config auto-save: config appears empty but we loaded with existing data");
        return;
      }
      fetcher.submit({ config: draft, shopId }, { method: "POST" });
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [draft, shopId, fetcher.state]);

  // Auto-save globalSettings after 2 seconds of inactivity
  useEffect(() => {
    if (settingsAutoSaveTimerRef.current) clearTimeout(settingsAutoSaveTimerRef.current);

    const currentSettingsStr = JSON.stringify(globalSettings);
    // Don't auto-save if unchanged from initial load
    if (currentSettingsStr === initialSettingsRef.current) return;

    // Don't auto-save while already saving
    if (fetcher.state !== "idle") return;

    settingsAutoSaveTimerRef.current = setTimeout(() => {
      // Safeguard: don't auto-save empty settings if we had data
      if (loadedWithData && !settingsHaveData()) {
        console.warn("Blocked settings auto-save: settings appear empty but we loaded with existing data");
        return;
      }
      fetcher.submit({ settings: currentSettingsStr, shopId }, { method: "POST" });
    }, 2000);

    return () => {
      if (settingsAutoSaveTimerRef.current) clearTimeout(settingsAutoSaveTimerRef.current);
    };
  }, [globalSettings, shopId, fetcher.state]);

  // Track previous fetcher state to detect save completion
  const prevFetcherStateRef = useRef(fetcher.state);

  // Update initial refs after successful save (so we don't re-save the same data)
  useEffect(() => {
    const wasSubmitting = prevFetcherStateRef.current === "submitting" || prevFetcherStateRef.current === "loading";
    const isNowIdle = fetcher.state === "idle";
    prevFetcherStateRef.current = fetcher.state;

    // Only process when we just finished a submission
    if (!wasSubmitting || !isNowIdle) return;

    if (fetcher.data?.ok === true) {
      initialDraftRef.current = draft;
      initialSettingsRef.current = JSON.stringify(globalSettings);
    }
  }, [fetcher.state, fetcher.data, draft, globalSettings]);

  // --------------------------------------------------------------------------
  // Derived state from parsed config (memoized to avoid re-parsing on every render)
  // --------------------------------------------------------------------------

  const parsed = useMemo(() => {
    try {
      const obj = JSON.parse(draft);
      if (obj?.version === 2 && Array.isArray(obj?.profiles)) {
        return obj;
      }
      return migrateToV2(obj);
    } catch (error) {
      safeLogError("Failed to parse draft config, using empty default", error);
      return migrateToV2({ version: 1, rules: [] });
    }
  }, [draft]);

  const profiles = parsed?.profiles ?? [];
  // Derive activeProfileId from parsed JSON (single source of truth)
  const activeProfileId = parsed?.activeProfileId ?? profiles[0]?.id ?? null;
  const activeProfile = profiles.length > 0
    ? (profiles.find((p) => p.id === activeProfileId) || profiles[0])
    : null;
  const activeProfileIndex = profiles.findIndex((p) => p.id === activeProfileId);
  // Memoize rules to maintain referential stability (prevents useEffect re-runs)
  const rules = useMemo(() => activeProfile?.rules ?? [], [activeProfile]);

  // Track previous activeProfileId to reset selectedIndex when switching profiles
  const prevActiveProfileIdRef = useRef(activeProfileId);
  useEffect(() => {
    if (prevActiveProfileIdRef.current !== activeProfileId && activeProfileId !== null) {
      setSelectedIndex(0); // Reset to first rule when switching profiles
    }
    prevActiveProfileIdRef.current = activeProfileId;
  }, [activeProfileId]);

  // Handle query parameters (from wizard redirect)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const selectRuleId = searchParams.get("selectRule");
    const openSettings = searchParams.get("openSettings");
    let changed = false;

    if (selectRuleId && rules.length > 0) {
      const ruleIndex = rules.findIndex(r => r.id === selectRuleId);
      if (ruleIndex !== -1) {
        setSelectedIndex(ruleIndex);
      }
      searchParams.delete("selectRule");
      changed = true;
    }

    if (openSettings === "true") {
      setShowGlobalSettingsPanel(true);
      searchParams.delete("openSettings");
      changed = true;
    }

    // Clear params from URL after handling
    if (changed) {
      setSearchParams(searchParams, { replace: true });
    }
  }, [rules, searchParams, setSearchParams]);

  const invalidRuleIndexes = rules
    .map((r, idx) => (ruleHasMatch(r) ? null : idx))
    .filter((x) => x !== null);

  // eslint-disable-next-line no-unused-vars
  const hasInvalidRules = invalidRuleIndexes.length > 0;

  const safeSelectedIndex =
    rules.length === 0 ? 0 : Math.min(selectedIndex, rules.length - 1);
  const rule = rules[safeSelectedIndex] ?? null;

  // Real-time countdown for preview (requires rule to be defined)
  useEffect(() => {
    const calculateCountdown = () => {
      const previewTz = globalSettings?.preview_timezone || "";
      const now = new Date();
      let shopNow;

      // Convert to shop timezone if set
      if (previewTz) {
        try {
          const fmt = new Intl.DateTimeFormat("en-US", {
            timeZone: previewTz, year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
          });
          const parts = fmt.formatToParts(now);
          const g = (t) => parts.find((p) => p.type === t)?.value;
          shopNow = new Date(Number(g("year")), Number(g("month")) - 1, Number(g("day")), Number(g("hour")), Number(g("minute")), Number(g("second")));
        } catch { shopNow = now; }
      } else {
        shopNow = now;
      }

      const dayName = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][shopNow.getDay()];

      // Check for rule overrides (same pattern as replaceDatePlaceholders)
      const useCutoffOverride = rule?.settings?.override_cutoff_times;
      const useClosedDaysOverride = rule?.settings?.override_closed_days;

      // Check if today is a closed day (with rule override support)
      const closedDaysArr = useClosedDaysOverride
        ? (rule?.settings?.closed_days || [])
        : (globalSettings?.closed_days || []);
      const closedDays = new Set(Array.isArray(closedDaysArr) ? closedDaysArr : String(closedDaysArr).split(',').map(d => d.trim().toLowerCase()).filter(Boolean));
      if (closedDays.has(dayName)) {
        setCountdownText('closed today');
        return;
      }

      // Check if today is a holiday
      const dateStr = `${shopNow.getFullYear()}-${String(shopNow.getMonth()+1).padStart(2,'0')}-${String(shopNow.getDate()).padStart(2,'0')}`;
      const customHolidaysArr = globalSettings?.custom_holidays || [];
      const customHolidays = new Set(Array.isArray(customHolidaysArr) ? customHolidaysArr.map(h => typeof h === 'string' ? h : h?.date).filter(Boolean) : []);
      const bankHolidayCountry = globalSettings?.bank_holiday_country || "";
      let isHolidayToday = customHolidays.has(dateStr);
      if (!isHolidayToday && bankHolidayCountry) {
        const bankHolidays = getHolidaysForYear(bankHolidayCountry, shopNow.getFullYear());
        isHolidayToday = bankHolidays.includes(dateStr);
      }
      if (isHolidayToday) {
        setCountdownText('holiday today');
        return;
      }

      // Get cutoff time (with rule override support)
      let cutoffStr = globalSettings?.cutoff_time || '14:00';
      if (useCutoffOverride && rule?.settings?.cutoff_time?.trim()) {
        cutoffStr = rule.settings.cutoff_time;
      }
      if (dayName === 'sat') {
        const sat = useCutoffOverride ? rule?.settings?.cutoff_time_sat : globalSettings?.cutoff_time_sat;
        if (sat?.trim()) cutoffStr = sat;
      } else if (dayName === 'sun') {
        const sun = useCutoffOverride ? rule?.settings?.cutoff_time_sun : globalSettings?.cutoff_time_sun;
        if (sun?.trim()) cutoffStr = sun;
      }

      // Parse cutoff time and calculate in shop timezone
      const [hours, minutes] = cutoffStr.split(':').map(Number);
      const cutoff = new Date(shopNow);
      cutoff.setHours(hours, minutes, 0, 0);

      // Calculate difference
      const diff = cutoff.getTime() - shopNow.getTime();

      if (diff <= 0) {
        setCountdownText('cutoff passed');
        return;
      }

      const totalMinutes = Math.floor(diff / 60000);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;

      if (h > 0) {
        setCountdownText(`${h}h ${m.toString().padStart(2, '0')}m`);
      } else {
        setCountdownText(`${m}m`);
      }
    };

    calculateCountdown(); // Initial calculation
    const interval = setInterval(calculateCountdown, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [globalSettings?.cutoff_time, globalSettings?.cutoff_time_sat, globalSettings?.cutoff_time_sun, globalSettings?.preview_timezone, globalSettings?.closed_days, globalSettings?.custom_holidays, globalSettings?.bank_holiday_country, rule?.settings?.override_cutoff_times, rule?.settings?.cutoff_time, rule?.settings?.cutoff_time_sat, rule?.settings?.cutoff_time_sun, rule?.settings?.override_closed_days, rule?.settings?.closed_days]);

  // Collapsed panel state (stored in localStorage, not metafield)
  const [collapsedPanels, setCollapsedPanels] = useState({
    product_matching: true,
    dispatch_settings: true,
    countdown_messages: true,
    countdown_icon: true,
    eta_timeline: true,
    special_delivery: true,
  });

  // Initialize collapsed state from localStorage when rule changes
  useEffect(() => {
    if (rule?.id) {
      setCollapsedPanels({
        product_matching: getCollapsedState(rule.id, 'product_matching'),
        dispatch_settings: getCollapsedState(rule.id, 'dispatch_settings'),
        countdown_messages: getCollapsedState(rule.id, 'countdown_messages'),
        countdown_icon: getCollapsedState(rule.id, 'countdown_icon'),
        eta_timeline: getCollapsedState(rule.id, 'eta_timeline'),
        special_delivery: getCollapsedState(rule.id, 'special_delivery'),
      });
    }
  }, [rule?.id]);

  // Helper to toggle a panel's collapsed state
  const togglePanel = (section) => {
    if (!rule?.id) return;
    const newCollapsed = !collapsedPanels[section];
    setCollapsedPanels(prev => ({ ...prev, [section]: newCollapsed }));
    setCollapsedState(rule.id, section, newCollapsed);
  };

  // Keep a ref to current rules for use in blur handlers (avoids stale closures)
  const rulesRef = useRef(rules);
  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);

  // Flush pending tag/handle edits before switching rules (prevents data loss)
  const flushPendingEdits = () => {
    if (document.activeElement === tagsInputRef.current) {
      tagsInputRef.current.blur();
    }
    if (document.activeElement === handlesInputRef.current) {
      handlesInputRef.current.blur();
    }
  };

  // Sync local text state when rule changes or data changes externally (e.g., undo)
  // Note: Only syncs if not actively editing to prevent overwriting user input
  useEffect(() => {
    if (document.activeElement !== tagsInputRef.current) {
      setTagsText((rule?.match?.tags ?? []).join(", "));
    }
    if (document.activeElement !== handlesInputRef.current) {
      setHandlesText((rule?.match?.product_handles ?? []).join(", "));
    }
  }, [rule?.id, rule?.match?.tags, rule?.match?.product_handles]);

  // --------------------------------------------------------------------------
  // Handlers for updating rules and profiles
  // --------------------------------------------------------------------------

  // Update rules within the active profile
  const setRules = (nextRules) => {
    const updatedProfiles = profiles.map((p) =>
      p.id === activeProfileId ? { ...p, rules: nextRules } : p
    );
    setDraft(JSON.stringify({ version: 2, profiles: updatedProfiles, activeProfileId }));
  };

  // Update all profiles (activeProfileId in JSON is the single source of truth)
  const setProfiles = (nextProfiles, newActiveId = activeProfileId) => {
    if (newActiveId !== activeProfileId) {
      flushPendingEdits(); // Save any pending edits before switching profiles
    }
    setDraft(JSON.stringify({ version: 2, profiles: nextProfiles, activeProfileId: newActiveId }));
    // Note: selectedIndex reset is handled by the effect watching activeProfileId changes
  };

  // Profile management functions
  const addProfile = () => {
    const newProfile = defaultProfile(`Profile ${profiles.length + 1}`);
    setProfiles([...profiles, newProfile], newProfile.id);
  };

  const copyProfile = () => {
    if (!activeProfile) return;
    const copiedProfile = {
      ...activeProfile,
      id: newProfileId(),
      name: activeProfile.name + " (copy)",
      rules: activeProfile.rules.map((r) => ({ ...r, id: newRuleId(), match: { ...r.match }, settings: { ...r.settings } })),
    };
    setProfiles([...profiles, copiedProfile], copiedProfile.id);
  };

  const deleteProfileWithUndo = () => {
    if (profiles.length <= 1) return; // Don't delete last profile

    // Clear previous undo timer
    if (undoProfileTimerRef.current) clearTimeout(undoProfileTimerRef.current);

    const removedIndex = activeProfileIndex;
    const removed = activeProfile;
    if (!removed) return;

    // Remove it immediately
    const nextProfiles = profiles.filter((p) => p.id !== activeProfileId);
    const nextActiveId = nextProfiles[Math.min(removedIndex, nextProfiles.length - 1)]?.id;
    setProfiles(nextProfiles, nextActiveId);

    // Remember it for undo
    setLastDeletedProfile({ profile: removed, index: removedIndex });

    // Auto-expire undo after 10s
    undoProfileTimerRef.current = setTimeout(() => {
      setLastDeletedProfile(null);
      undoProfileTimerRef.current = null;
    }, 10000);
  };

  const undoDeleteProfile = () => {
    if (!lastDeletedProfile?.profile) return;

    if (undoProfileTimerRef.current) clearTimeout(undoProfileTimerRef.current);
    undoProfileTimerRef.current = null;

    const insertAt = Math.max(0, Math.min(lastDeletedProfile.index ?? 0, profiles.length));
    const restored = [...profiles];
    restored.splice(insertAt, 0, lastDeletedProfile.profile);

    setProfiles(restored, lastDeletedProfile.profile.id);
    setLastDeletedProfile(null);
  };

  const renameProfile = (newName) => {
    const updatedProfiles = profiles.map((p) =>
      p.id === activeProfileId ? { ...p, name: newName } : p
    );
    setDraft(JSON.stringify({ version: 2, profiles: updatedProfiles, activeProfileId }));
  };

  const addRule = () => {
    flushPendingEdits(); // Save any pending edits before switching to new rule
    const next = [...rules, defaultRule()];
    setRules(next);
    setSelectedIndex(next.length - 1);
  };

  const duplicateRule = () => {
    flushPendingEdits(); // Save any pending edits before switching to copied rule
    if (selectedIndex < 0 || selectedIndex >= rules.length) return;
    const currentRule = rules[selectedIndex];
    // Truncate name to fit within 25 char limit with " (copy)" suffix
    const baseName = currentRule.name.slice(0, 18);
    const duplicatedRule = {
      ...currentRule,
      id: newRuleId(),
      name: (baseName + " (copy)").slice(0, 25),
      match: { ...currentRule.match },
      settings: { ...currentRule.settings }
    };
    const next = [
      ...rules.slice(0, selectedIndex + 1),
      duplicatedRule,
      ...rules.slice(selectedIndex + 1)
    ];
    setRules(next);
    setSelectedIndex(selectedIndex + 1);
  };

  const moveRule = (from, to) => {
    flushPendingEdits(); // Save any pending edits before reordering
    if (to < 0 || to >= rules.length) return;
    const next = [...rules];
    [next[to], next[from]] = [next[from], next[to]];
    setRules(next);
    setSelectedIndex(to);
  };

  // --- UNDO DELETE (finished) ---
  function deleteRuleWithUndo(idx) {
    flushPendingEdits(); // Save any pending edits before deleting
    // clear previous undo timer
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    const removed = rules[idx];
    if (!removed) return;

    // remove it immediately
    const nextRules = rules.filter((_, i) => i !== idx);
    setRules(nextRules);

    // selection: keep same index if possible, else move to last
    const nextSelected = nextRules.length === 0 ? 0 : Math.min(idx, nextRules.length - 1);
    setSelectedIndex(nextSelected);

    // remember it for undo
    setLastDeleted({ rule: removed, index: idx });

    // auto-expire undo after 10s
    undoTimerRef.current = setTimeout(() => {
      setLastDeleted(null);
      undoTimerRef.current = null;
    }, 10000);
  }

  function undoDelete() {
    if (!lastDeleted?.rule) return;

    flushPendingEdits(); // Save any pending edits before restoring
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;

    const insertAt = Math.max(0, Math.min(lastDeleted.index ?? 0, rules.length));
    const restored = [...rules];
    restored.splice(insertAt, 0, lastDeleted.rule);

    setRules(restored);
    setSelectedIndex(insertAt);
    setLastDeleted(null);
  }

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <>
      <style>{`
        html {
          scrollbar-gutter: stable;
        }
        @media (min-width: 900px) {
          .dib-right-column {
            max-height: ${stickyHeight ? `${stickyHeight}px` : "calc(100vh - 200px)"};
            position: sticky;
            top: 16px;
            will-change: transform;
          }
          .dib-preview-section {
            flex-shrink: 0;
          }
          .dib-rules-list {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
          }
          .dib-rules-list-content {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overscroll-behavior: contain;
          }
        }
        @media (max-width: 899px) {
          .dib-rules-list-content {
            max-height: ${stickyHeight ? `${Math.round(stickyHeight * 0.5)}px` : "50vh"};
            overflow-y: auto;
            overscroll-behavior: contain;
          }
        }
      `}</style>
      <s-page heading="Messages">
        <s-section>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                alignItems: "start",
              }}
            >
            {/* Top action bar - spans both columns */}
            <div style={{
              gridColumn: "1 / -1",
              border: "1px solid var(--p-color-border, #e5e7eb)",
              borderRadius: "8px",
              padding: "12px",
              background: "var(--p-color-bg-surface, #ffffff)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}>
              {/* Global buttons - LEFT */}
              <div style={{ display: "flex", gap: 8 }}>
                <s-button
                  variant={showGlobalSettingsPanel ? "primary" : undefined}
                  onClick={() => {
                    setShowGlobalSettingsPanel(!showGlobalSettingsPanel);
                    setShowTypographyPanel(false);
                    setShowAlignmentPanel(false);
                  }}
                >
                  Global Settings
                </s-button>
                <s-button
                  variant={showTypographyPanel ? "primary" : undefined}
                  onClick={() => {
                    setShowTypographyPanel(!showTypographyPanel);
                    setShowAlignmentPanel(false);
                    setShowGlobalSettingsPanel(false);
                  }}
                >
                  Global Typography
                </s-button>
                <s-button
                  variant={showAlignmentPanel ? "primary" : undefined}
                  onClick={() => {
                    setShowAlignmentPanel(!showAlignmentPanel);
                    setShowTypographyPanel(false);
                    setShowGlobalSettingsPanel(false);
                  }}
                >
                  Global Alignment
                </s-button>
              </div>

              {/* Profile selector + Save - RIGHT */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--p-color-text-subdued, #6b7280)", fontSize: "14px" }}>Profile:</span>
                  <select
                    value={activeProfileId}
                    onChange={(e) => setProfiles(profiles, e.target.value)}
                    aria-label="Select profile"
                    style={{
                      fontSize: "14px",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      border: "1px solid var(--p-color-border, #e5e7eb)",
                      background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                      cursor: "pointer",
                    }}
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  aria-hidden="true"
                >
                  <g fill={isLoading ? "#22c55e" : "#9ca3af"} fillRule="evenodd" clipRule="evenodd">
                    <path d="M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7.414A2 2 0 0 0 20.414 6L18 3.586A2 2 0 0 0 16.586 3zm3 11a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6H8zm1-7V5h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1" />
                    <path d="M14 17h-4v-2h4z" />
                  </g>
                </svg>
                <s-button
                  variant="primary"
                  onClick={() => {
                    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
                    // Safeguard: warn before saving empty config if we had data
                    if (loadedWithData && !configHasData()) {
                      if (!confirm("Configuration appears empty. Are you sure you want to save? This may overwrite your existing rules.")) {
                        return;
                      }
                    }
                    fetcher.submit({ config: draft, shopId }, { method: "POST" });
                  }}
                >
                  Save
                </s-button>
              </div>
            </div>

            {/* Action row - spans both columns (NOT sticky) */}
            <div style={{
              gridColumn: "1 / -1",
              border: "1px solid var(--p-color-border, #e5e7eb)",
              borderRadius: "8px",
              padding: "12px",
              background: "var(--p-color-bg-surface, #ffffff)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}>
              {/* Editor + Collapse/Expand buttons - LEFT */}
              <div style={{ display: "flex", gap: 8 }}>
                <s-button
                  variant={!showTypographyPanel && !showAlignmentPanel && !showGlobalSettingsPanel ? "primary" : undefined}
                  onClick={() => {
                    setShowTypographyPanel(false);
                    setShowAlignmentPanel(false);
                    setShowGlobalSettingsPanel(false);
                  }}
                >
                  Editor
                </s-button>
                {rule && (
                  <>
                    <s-button
                      onClick={() => {
                      if (!rule?.id) return;
                      const allCollapsed = {
                        product_matching: true,
                        dispatch_settings: true,
                        countdown_messages: true,
                        countdown_icon: true,
                        eta_timeline: true,
                        special_delivery: true,
                      };
                      setCollapsedPanels(allCollapsed);
                      Object.entries(allCollapsed).forEach(([key, val]) => {
                        setCollapsedState(rule.id, key, val);
                      });
                    }}
                  >
                    Collapse all
                  </s-button>
                  <s-button
                    onClick={() => {
                      if (!rule?.id) return;
                      const allExpanded = {
                        product_matching: false,
                        dispatch_settings: false,
                        countdown_messages: false,
                        countdown_icon: false,
                        eta_timeline: false,
                        special_delivery: false,
                      };
                      setCollapsedPanels(allExpanded);
                      Object.entries(allExpanded).forEach(([key, val]) => {
                        setCollapsedState(rule.id, key, val);
                      });
                    }}
                  >
                    Expand all
                  </s-button>
                  <s-button
                    onClick={() => {
                      if (!rule?.id) return;
                      const smartCollapse = {
                        product_matching: false,
                        dispatch_settings: false,
                        countdown_messages: !rule.settings?.show_messages,
                        countdown_icon: rule.settings?.show_icon === false,
                        eta_timeline: !rule.settings?.show_eta_timeline,
                        special_delivery: !rule.settings?.show_special_delivery,
                      };
                      setCollapsedPanels(smartCollapse);
                      Object.entries(smartCollapse).forEach(([key, val]) => {
                        setCollapsedState(rule.id, key, val);
                      });
                    }}
                  >
                    Show enabled
                  </s-button>
                  </>
                )}
              </div>
              {/* Rule name + Add rule + Copy rule - RIGHT */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  value={rule?.name || ""}
                  onChange={(e) => {
                    const next = [...rules];
                    next[safeSelectedIndex] = {
                      ...rule,
                      name: e.target.value,
                    };
                    setRules(next);
                  }}
                  maxLength={22}
                  aria-label="Rule name"
                  style={{
                    fontSize: "16px",
                    fontWeight: 600,
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                    borderRadius: "4px",
                    padding: "4px 8px",
                    width: "180px",
                    outline: "none",
                    background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "var(--p-color-border-emphasis, #111827)";
                    e.target.style.boxShadow = "0 0 0 1px var(--p-color-border-emphasis, #111827)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "var(--p-color-border, #e5e7eb)";
                    e.target.style.boxShadow = "none";
                  }}
                  placeholder="Rule name"
                />
                <s-button onClick={addRule}>
                  Add rule
                </s-button>
                <s-button onClick={duplicateRule}>
                  Copy rule
                </s-button>
              </div>
            </div>

            {/* LEFT column: editor (inputs, main work area) */}
            <div style={{ display: "grid", gap: 12, minWidth: 0 }}>

              {/* Typography Panel */}
              {showTypographyPanel && (
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, background: "var(--p-color-bg-surface, #ffffff)", display: "grid", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <s-heading>Typography</s-heading>
                  <s-button variant="plain" onClick={() => setShowTypographyPanel(false)}>Close</s-button>
                </div>

                {/* Theme Font for Preview */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Theme Font for Preview</s-heading>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Select your Shopify theme's body font so the preview matches your storefront when "Match theme font" is enabled.
                  </s-text>
                  <select
                    value={globalSettings?.eta_preview_theme_font || ""}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, eta_preview_theme_font: e.target.value })}
                    style={{ width: "100%" }}
                  >
                    <option value="">Select font...</option>
                    <option value="'Assistant', sans-serif">Assistant</option>
                    <option value="'Roboto', sans-serif">Roboto</option>
                    <option value="'Open Sans', sans-serif">Open Sans</option>
                    <option value="'Montserrat', sans-serif">Montserrat</option>
                    <option value="'Poppins', sans-serif">Poppins</option>
                    <option value="'Lato', sans-serif">Lato</option>
                    <option value="'Nunito Sans', sans-serif">Nunito Sans</option>
                    <option value="'Source Sans Pro', sans-serif">Source Sans Pro</option>
                    <option value="'Oswald', sans-serif">Oswald</option>
                    <option value="'Raleway', sans-serif">Raleway</option>
                    <option value="'Inter', sans-serif">Inter</option>
                  </select>
                  <div>
                    <s-text size="small">Font size scale ({globalSettings?.eta_preview_font_size_scale || 100}%)</s-text>
                    <input
                      type="range"
                      min="80"
                      max="130"
                      value={globalSettings?.eta_preview_font_size_scale || 100}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, eta_preview_font_size_scale: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>

                {/* Messages Font & Text Styling */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Messages Font & Text Styling</s-heading>

                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={globalSettings?.use_theme_font !== false}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, use_theme_font: e.target.checked })}
                    />
                    <s-text>Match theme font</s-text>
                  </label>
                  {!globalSettings?.use_theme_font && (
                    <div style={{ display: "grid", gap: 8, marginLeft: 24 }}>
                      <s-text size="small">Custom font</s-text>
                      <select
                        value={globalSettings?.custom_font_family || ""}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, custom_font_family: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="">Select font...</option>
                        <option value="'Assistant', sans-serif">Assistant</option>
                        <option value="'Roboto', sans-serif">Roboto</option>
                        <option value="'Open Sans', sans-serif">Open Sans</option>
                        <option value="'Montserrat', sans-serif">Montserrat</option>
                        <option value="'Poppins', sans-serif">Poppins</option>
                        <option value="'Lato', sans-serif">Lato</option>
                        <option value="'Nunito Sans', sans-serif">Nunito Sans</option>
                        <option value="'Source Sans Pro', sans-serif">Source Sans Pro</option>
                        <option value="'Oswald', sans-serif">Oswald</option>
                        <option value="'Raleway', sans-serif">Raleway</option>
                        <option value="'Inter', sans-serif">Inter</option>
                      </select>
                    </div>
                  )}

                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={globalSettings?.use_theme_text_styling !== false}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, use_theme_text_styling: e.target.checked })}
                    />
                    <s-text>Match theme text styling</s-text>
                  </label>
                  {rule.settings?.override_global_text_styling === true && (
                    <s-text size="small" style={{ color: "#6b7280", marginLeft: 24 }}><em>📌 Current rule is using custom text styling</em></s-text>
                  )}
                  {globalSettings?.use_theme_text_styling === false && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginLeft: 24 }}>
                      <div>
                        <s-text size="small">Text color</s-text>
                        <s-color-field
                          label=""
                          value={globalSettings?.text_color || "#374151"}
                          onInput={(e) => setGlobalSettings({ ...globalSettings, text_color: e.detail?.value ?? e.target?.value ?? "#374151" })}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, text_color: e.detail?.value ?? e.target?.value ?? "#374151" })}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font size ({globalSettings?.font_size ?? 16}px)</s-text>
                        <input
                          type="range"
                          min="10"
                          max="22"
                          value={globalSettings?.font_size ?? 16}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, font_size: Number(e.target.value) })}
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font weight</s-text>
                        <select
                          value={globalSettings?.font_weight || "normal"}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, font_weight: e.target.value })}
                          style={{ width: "100%" }}
                        >
                          <option value="normal">Normal</option>
                          <option value="bold">Bold</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* ETA Timeline Font & Text Styling */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">ETA Timeline Font & Text Styling</s-heading>

                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={globalSettings?.eta_use_theme_font !== false}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, eta_use_theme_font: e.target.checked })}
                    />
                    <s-text>Match theme font</s-text>
                  </label>
                  {globalSettings?.eta_use_theme_font === false && (
                    <div style={{ display: "grid", gap: 8, marginLeft: 24 }}>
                      <s-text size="small">Custom font</s-text>
                      <select
                        value={globalSettings?.eta_custom_font_family || ""}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, eta_custom_font_family: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="">Select font...</option>
                        <option value="'Assistant', sans-serif">Assistant</option>
                        <option value="'Roboto', sans-serif">Roboto</option>
                        <option value="'Open Sans', sans-serif">Open Sans</option>
                        <option value="'Montserrat', sans-serif">Montserrat</option>
                        <option value="'Poppins', sans-serif">Poppins</option>
                        <option value="'Lato', sans-serif">Lato</option>
                        <option value="'Nunito Sans', sans-serif">Nunito Sans</option>
                        <option value="'Source Sans Pro', sans-serif">Source Sans Pro</option>
                        <option value="'Oswald', sans-serif">Oswald</option>
                        <option value="'Raleway', sans-serif">Raleway</option>
                        <option value="'Inter', sans-serif">Inter</option>
                      </select>
                    </div>
                  )}

                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={globalSettings?.eta_use_theme_text_styling !== false}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, eta_use_theme_text_styling: e.target.checked })}
                    />
                    <s-text>Match theme text styling</s-text>
                  </label>
                  {rule.settings?.override_eta_text_styling === true && (
                    <s-text size="small" style={{ color: "#6b7280", marginLeft: 24 }}><em>📌 Current rule is using custom text styling</em></s-text>
                  )}
                  {globalSettings?.eta_use_theme_text_styling === false && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginLeft: 24 }}>
                    {/* Labels */}
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ minHeight: 40 }}><s-text size="small" style={{ fontWeight: 600 }}>Labels (Ordered, Shipped, Delivered)</s-text></div>
                      <div>
                        <s-text size="small">Color</s-text>
                        <s-color-field
                          label=""
                          value={globalSettings?.eta_label_color || "#374151"}
                          onInput={(e) => setGlobalSettings({ ...globalSettings, eta_label_color: e.detail?.value ?? e.target?.value ?? "#374151" })}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, eta_label_color: e.detail?.value ?? e.target?.value ?? "#374151" })}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font size ({globalSettings?.eta_label_font_size ?? 12}px)</s-text>
                        <input
                          type="range"
                          min="10"
                          max="18"
                          value={globalSettings?.eta_label_font_size ?? 12}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, eta_label_font_size: Number(e.target.value) })}
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font weight</s-text>
                        <select
                          value={globalSettings?.eta_label_font_weight || "semibold"}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, eta_label_font_weight: e.target.value })}
                          style={{ width: "100%" }}
                        >
                          <option value="normal">Normal</option>
                          <option value="bold">Bold</option>
                        </select>
                      </div>
                    </div>
                    {/* Dates */}
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ minHeight: 40 }}><s-text size="small" style={{ fontWeight: 600 }}>Dates (Jan 20, Jan 21-24)</s-text></div>
                      <div>
                        <s-text size="small">Color</s-text>
                        <s-color-field
                          label=""
                          value={globalSettings?.eta_date_color || "#6b7280"}
                          onInput={(e) => setGlobalSettings({ ...globalSettings, eta_date_color: e.detail?.value ?? e.target?.value ?? "#6b7280" })}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, eta_date_color: e.detail?.value ?? e.target?.value ?? "#6b7280" })}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font size ({globalSettings?.eta_date_font_size ?? 11}px)</s-text>
                        <input
                          type="range"
                          min="10"
                          max="18"
                          value={globalSettings?.eta_date_font_size ?? 11}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, eta_date_font_size: Number(e.target.value) })}
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font weight</s-text>
                        <select
                          value={globalSettings?.eta_date_font_weight || "normal"}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, eta_date_font_weight: e.target.value })}
                          style={{ width: "100%" }}
                        >
                          <option value="normal">Normal</option>
                          <option value="bold">Bold</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  )}
                </div>

                {/* Special Delivery Font & Text Styling */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Special Delivery Font & Text Styling</s-heading>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={globalSettings?.special_delivery_use_theme_font !== false}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_use_theme_font: e.target.checked })}
                    />
                    <s-text>Match theme font</s-text>
                  </label>
                  {globalSettings?.special_delivery_use_theme_font === false && (
                    <div style={{ display: "grid", gap: 8, marginLeft: 24 }}>
                      <s-text size="small">Custom font</s-text>
                      <select
                        value={globalSettings?.special_delivery_custom_font_family || ""}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_custom_font_family: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="">Select font...</option>
                        <option value="'Assistant', sans-serif">Assistant</option>
                        <option value="'Roboto', sans-serif">Roboto</option>
                        <option value="'Open Sans', sans-serif">Open Sans</option>
                        <option value="'Montserrat', sans-serif">Montserrat</option>
                        <option value="'Poppins', sans-serif">Poppins</option>
                        <option value="'Lato', sans-serif">Lato</option>
                        <option value="'Nunito Sans', sans-serif">Nunito Sans</option>
                        <option value="'Source Sans Pro', sans-serif">Source Sans Pro</option>
                        <option value="'Oswald', sans-serif">Oswald</option>
                        <option value="'Raleway', sans-serif">Raleway</option>
                        <option value="'Inter', sans-serif">Inter</option>
                      </select>
                    </div>
                  )}

                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={globalSettings?.special_delivery_use_theme_text_styling !== false}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_use_theme_text_styling: e.target.checked, special_delivery_header_use_theme_text_styling: e.target.checked })}
                    />
                    <s-text>Match theme text styling</s-text>
                  </label>
                  {(rule.settings?.special_delivery_override_global_text_styling === true || rule.settings?.special_delivery_override_global_header_styling === true) && (
                    <s-text size="small" style={{ color: "#6b7280", marginLeft: 24 }}><em>📌 Current rule is using custom text styling</em></s-text>
                  )}
                  {globalSettings?.special_delivery_use_theme_text_styling === false && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginLeft: 24 }}>
                    {/* Header */}
                    <div style={{ display: "grid", gap: 8 }}>
                      <s-text size="small" style={{ fontWeight: 600 }}>Header (optional)</s-text>
                      <div>
                        <s-text size="small">Color</s-text>
                        <s-color-field
                          label=""
                          value={globalSettings?.special_delivery_header_text_color || "#111827"}
                          onInput={(e) => setGlobalSettings({ ...globalSettings, special_delivery_header_text_color: e.detail?.value ?? e.target?.value ?? "#111827" })}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_header_text_color: e.detail?.value ?? e.target?.value ?? "#111827" })}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font size ({globalSettings?.special_delivery_header_font_size ?? 16}px)</s-text>
                        <input
                          type="range"
                          min="12"
                          max="24"
                          value={globalSettings?.special_delivery_header_font_size ?? 16}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_header_font_size: Number(e.target.value) })}
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font weight</s-text>
                        <select
                          value={globalSettings?.special_delivery_header_font_weight || "semibold"}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_header_font_weight: e.target.value })}
                          style={{ width: "100%" }}
                        >
                          <option value="normal">Normal</option>
                          <option value="bold">Bold</option>
                        </select>
                      </div>
                    </div>
                    {/* Message */}
                    <div style={{ display: "grid", gap: 8 }}>
                      <s-text size="small" style={{ fontWeight: 600 }}>Message</s-text>
                      <div>
                        <s-text size="small">Color</s-text>
                        <s-color-field
                          label=""
                          value={globalSettings?.special_delivery_text_color || "#374151"}
                          onInput={(e) => setGlobalSettings({ ...globalSettings, special_delivery_text_color: e.detail?.value ?? e.target?.value ?? "#374151" })}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_text_color: e.detail?.value ?? e.target?.value ?? "#374151" })}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font size ({globalSettings?.special_delivery_font_size ?? 16}px)</s-text>
                        <input
                          type="range"
                          min="10"
                          max="22"
                          value={globalSettings?.special_delivery_font_size ?? 16}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_font_size: Number(e.target.value) })}
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div>
                        <s-text size="small">Font weight</s-text>
                        <select
                          value={globalSettings?.special_delivery_font_weight || "normal"}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_font_weight: e.target.value })}
                          style={{ width: "100%" }}
                        >
                          <option value="normal">Normal</option>
                          <option value="bold">Bold</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  )}
                </div>

                {/* Link Styling */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Link Styling</s-heading>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Style links created from [text](url) markdown in messages.
                  </s-text>

                  {/* Color - full width */}
                  <div>
                    <s-text size="small">Color</s-text>
                    <s-color-field
                      label=""
                      value={globalSettings?.link_color || "#2563eb"}
                      onInput={(e) => setGlobalSettings({ ...globalSettings, link_color: e.detail?.value ?? e.target?.value ?? "#2563eb" })}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, link_color: e.detail?.value ?? e.target?.value ?? "#2563eb" })}
                    />
                  </div>

                  {/* Decoration + Thickness - 50% each */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <s-text size="small">Decoration</s-text>
                      <select
                        value={globalSettings?.link_decoration || "underline"}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, link_decoration: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="underline">Underline</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                    <div>
                      <s-text size="small">Thickness</s-text>
                      <select
                        value={globalSettings?.link_thickness || "1px"}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, link_thickness: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="1px">1px</option>
                        <option value="2px">2px</option>
                        <option value="3px">3px</option>
                        <option value="from-font">From font</option>
                      </select>
                    </div>
                  </div>

                  {/* Hover Effects */}
                  <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 4, display: "grid", gap: 12 }}>
                    <s-text size="small" style={{ fontWeight: 600 }}>Hover Effects</s-text>

                    {/* Hover Color - full width */}
                    <div>
                      <s-text size="small">Color</s-text>
                      <s-color-field
                        label=""
                        value={globalSettings?.link_hover_color || "#1d4ed8"}
                        onInput={(e) => setGlobalSettings({ ...globalSettings, link_hover_color: e.detail?.value ?? e.target?.value ?? "#1d4ed8" })}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, link_hover_color: e.detail?.value ?? e.target?.value ?? "#1d4ed8" })}
                      />
                    </div>

                    {/* Hover Decoration + Thickness - 50% each */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <s-text size="small">Decoration</s-text>
                        <select
                          value={globalSettings?.link_hover_decoration || "underline"}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, link_hover_decoration: e.target.value })}
                          style={{ width: "100%" }}
                        >
                          <option value="underline">Underline</option>
                          <option value="none">None</option>
                        </select>
                      </div>
                      <div>
                        <s-text size="small">Thickness</s-text>
                        <select
                          value={globalSettings?.link_hover_thickness || "2px"}
                          onChange={(e) => setGlobalSettings({ ...globalSettings, link_hover_thickness: e.target.value })}
                          style={{ width: "100%" }}
                        >
                          <option value="1px">1px</option>
                          <option value="2px">2px</option>
                          <option value="3px">3px</option>
                          <option value="from-font">From font</option>
                        </select>
                      </div>
                    </div>

                    {/* Opacity - full width */}
                    <div>
                      <s-text size="small">Opacity</s-text>
                      <select
                        value={globalSettings?.link_hover_opacity ?? 1}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, link_hover_opacity: parseFloat(e.target.value) })}
                        style={{ width: "100%" }}
                      >
                        <option value="1">100% (no fade)</option>
                        <option value="0.8">80%</option>
                        <option value="0.7">70%</option>
                        <option value="0.6">60%</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

              {/* Alignment Panel */}
              {showAlignmentPanel && (
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, background: "var(--p-color-bg-surface, #ffffff)", display: "grid", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <s-heading>Spacing & Alignment</s-heading>
                  <s-button variant="plain" onClick={() => setShowAlignmentPanel(false)}>Close</s-button>
                </div>

                {/* Messages Spacing & Alignment */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Messages Spacing & Alignment</s-heading>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <s-text size="small">Left padding</s-text>
                      <input
                        type="number"
                        min="0"
                        max="40"
                        value={globalSettings?.messages_padding_left ?? 8}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, messages_padding_left: safeParseNumber(e.target.value, 8, 0, 40) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Right padding</s-text>
                      <input
                        type="number"
                        min="0"
                        max="40"
                        value={globalSettings?.messages_padding_right ?? 12}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, messages_padding_right: safeParseNumber(e.target.value, 12, 0, 40) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Vertical padding</s-text>
                      <input
                        type="number"
                        min="0"
                        max="40"
                        value={globalSettings?.messages_padding_vertical ?? 10}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, messages_padding_vertical: safeParseNumber(e.target.value, 10, 0, 40) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Single icon gap</s-text>
                      <input
                        type="number"
                        min="0"
                        max="40"
                        value={globalSettings?.messages_single_icon_gap ?? 12}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, messages_single_icon_gap: safeParseNumber(e.target.value, 12, 0, 40) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>
                  <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 4 }}>
                    <s-text size="small" style={{ color: "#6b7280" }}><em>📌 Settings below only apply to the live storefront</em></s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                      <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                      <span style={{ fontSize: 12 }}>Negative margins pull elements closer together.</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <s-text size="small">Margin top</s-text>
                      <input
                        type="number"
                        value={globalSettings?.messages_margin_top ?? 0}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, messages_margin_top: Number(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Margin bottom</s-text>
                      <input
                        type="number"
                        value={globalSettings?.messages_margin_bottom ?? 0}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, messages_margin_bottom: Number(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Desktop alignment</s-text>
                      <select
                        value={globalSettings?.messages_alignment || "left"}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, messages_alignment: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                      </select>
                    </div>
                    <div>
                      <s-text size="small">Mobile alignment</s-text>
                      <select
                        value={globalSettings?.messages_alignment_mobile || "left"}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, messages_alignment_mobile: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* ETA Timeline Spacing & Alignment */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">ETA Timeline Spacing & Alignment</s-heading>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <s-text size="small">Horizontal padding</s-text>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={globalSettings?.eta_padding_horizontal ?? 8}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, eta_padding_horizontal: safeParseNumber(e.target.value, 8, 0, 20) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Vertical padding</s-text>
                      <input
                        type="number"
                        min="0"
                        max="40"
                        value={globalSettings?.eta_padding_vertical ?? 8}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, eta_padding_vertical: safeParseNumber(e.target.value, 8, 0, 40) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Gap: icon to label</s-text>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={globalSettings?.eta_gap_icon_label ?? 2}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, eta_gap_icon_label: safeParseNumber(e.target.value, 2, 0, 20) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Gap: label to date</s-text>
                      <input
                        type="number"
                        min="-3"
                        max="20"
                        value={globalSettings?.eta_gap_label_date ?? 0}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, eta_gap_label_date: safeParseNumber(e.target.value, 0, -3, 20) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>
                  <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 4 }}>
                    <s-text size="small" style={{ color: "#6b7280" }}><em>📌 Settings below only apply to the live storefront</em></s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                      <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                      <span style={{ fontSize: 12 }}>Negative margins pull elements closer together.</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <s-text size="small">Margin top</s-text>
                      <input
                        type="number"
                        value={globalSettings?.eta_margin_top ?? 0}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, eta_margin_top: Number(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Margin bottom</s-text>
                      <input
                        type="number"
                        value={globalSettings?.eta_margin_bottom ?? 0}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, eta_margin_bottom: Number(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Desktop alignment</s-text>
                      <select
                        value={globalSettings?.eta_alignment || "left"}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, eta_alignment: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                      </select>
                    </div>
                    <div>
                      <s-text size="small">Mobile alignment</s-text>
                      <select
                        value={globalSettings?.eta_alignment_mobile || "left"}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, eta_alignment_mobile: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Special Delivery Spacing & Alignment */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Special Delivery Spacing & Alignment</s-heading>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <s-text size="small">Left padding</s-text>
                      <input
                        type="number"
                        min="0"
                        max="40"
                        value={globalSettings?.special_delivery_padding_left ?? 8}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_padding_left: safeParseNumber(e.target.value, 8, 0, 40) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Right padding</s-text>
                      <input
                        type="number"
                        min="0"
                        max="40"
                        value={globalSettings?.special_delivery_padding_right ?? 12}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_padding_right: safeParseNumber(e.target.value, 12, 0, 40) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Vertical padding</s-text>
                      <input
                        type="number"
                        min="0"
                        max="40"
                        value={globalSettings?.special_delivery_padding_vertical ?? 10}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_padding_vertical: safeParseNumber(e.target.value, 10, 0, 40) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Header gap</s-text>
                      <input
                        type="number"
                        value={globalSettings?.special_delivery_header_gap ?? 4}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_header_gap: Number(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Line height</s-text>
                      <input
                        type="number"
                        min="1"
                        max="3"
                        step="0.1"
                        value={globalSettings?.special_delivery_line_height ?? 1.4}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_line_height: parseFloat(e.target.value) || 1.4 })}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>
                  <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 4 }}>
                    <s-text size="small" style={{ color: "#6b7280" }}><em>📌 Settings below only apply to the live storefront</em></s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                      <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                      <span style={{ fontSize: 12 }}>Negative margins pull elements closer together.</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <s-text size="small">Margin top</s-text>
                      <input
                        type="number"
                        value={globalSettings?.special_delivery_margin_top ?? 0}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_margin_top: Number(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Margin bottom</s-text>
                      <input
                        type="number"
                        value={globalSettings?.special_delivery_margin_bottom ?? 0}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_margin_bottom: Number(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <s-text size="small">Desktop alignment</s-text>
                      <select
                        value={globalSettings?.special_delivery_alignment || "left"}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_alignment: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                      </select>
                    </div>
                    <div>
                      <s-text size="small">Mobile alignment</s-text>
                      <select
                        value={globalSettings?.special_delivery_alignment_mobile || "left"}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, special_delivery_alignment_mobile: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Global Settings Panel */}
            {showGlobalSettingsPanel && (
              <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, background: "var(--p-color-bg-surface, #ffffff)", display: "grid", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <s-heading>Global Settings</s-heading>
                  <s-button variant="plain" onClick={() => setShowGlobalSettingsPanel(false)}>Close</s-button>
                </div>

                {/* Profiles Section */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)", minHeight: 130 }}>
                  <s-heading size="small">Profiles</s-heading>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                      type="text"
                      value={activeProfile?.name || ""}
                      onChange={(e) => renameProfile(e.target.value)}
                      placeholder="Profile name"
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderRadius: "4px",
                        border: "1px solid var(--p-color-border, #e5e7eb)",
                        fontSize: "14px",
                      }}
                    />
                    <div style={{ display: "flex", gap: 4 }}>
                      <s-button
                        onClick={addProfile}
                        disabled={profilesLocked}
                        title="Add new profile"
                      >
                        Add
                      </s-button>
                      <s-button
                        onClick={copyProfile}
                        disabled={profilesLocked}
                        title="Copy current profile"
                      >
                        Copy
                      </s-button>
                      <s-button
                        variant="plain"
                        tone="critical"
                        onClick={deleteProfileWithUndo}
                        disabled={profilesLocked || profiles.length <= 1}
                        title={profiles.length <= 1 ? "Cannot delete last profile" : "Delete current profile"}
                      >
                        Delete
                      </s-button>
                    </div>
                  </div>
                  {/* Lock button row - fixed height to prevent shift when undo appears */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 36 }}>
                    {lastDeletedProfile ? (
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 12px",
                        background: "var(--p-color-bg-caution-subdued, #fef3c7)",
                        borderRadius: 4,
                      }}>
                        <s-text>Profile "{lastDeletedProfile.profile.name}" deleted.</s-text>
                        <s-button size="small" onClick={undoDeleteProfile}>Undo</s-button>
                      </div>
                    ) : <div />}
                    <s-button
                      variant="plain"
                      onClick={() => setProfilesLocked(!profilesLocked)}
                      title={profilesLocked ? "Unlock to enable Add/Copy/Delete" : "Lock to prevent changes"}
                    >
                      {profilesLocked ? "🔒 Locked" : "🔓 Unlocked"}
                    </s-button>
                  </div>
                </div>

                {/* Preview Timezone */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Preview Timezone</s-heading>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Match this to your Shopify store timezone so the preview matches your live storefront.
                  </s-text>
                  <select
                    value={globalSettings?.preview_timezone || ""}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, preview_timezone: e.target.value })}
                    style={{ width: "100%" }}
                  >
                    <option value="">Browser default</option>
                    <optgroup label="UTC">
                      <option value="UTC">UTC</option>
                    </optgroup>
                    <optgroup label="Europe">
                      <option value="Europe/London">Europe/London (GMT+0/+1)</option>
                      <option value="Europe/Dublin">Europe/Dublin (GMT+0/+1)</option>
                      <option value="Europe/Paris">Europe/Paris (GMT+1/+2)</option>
                      <option value="Europe/Berlin">Europe/Berlin (GMT+1/+2)</option>
                      <option value="Europe/Amsterdam">Europe/Amsterdam (GMT+1/+2)</option>
                      <option value="Europe/Madrid">Europe/Madrid (GMT+1/+2)</option>
                      <option value="Europe/Rome">Europe/Rome (GMT+1/+2)</option>
                      <option value="Europe/Stockholm">Europe/Stockholm (GMT+1/+2)</option>
                      <option value="Europe/Helsinki">Europe/Helsinki (GMT+2/+3)</option>
                      <option value="Europe/Athens">Europe/Athens (GMT+2/+3)</option>
                      <option value="Europe/Moscow">Europe/Moscow (GMT+3)</option>
                    </optgroup>
                    <optgroup label="Americas">
                      <option value="America/New_York">America/New_York (GMT-5/-4)</option>
                      <option value="America/Chicago">America/Chicago (GMT-6/-5)</option>
                      <option value="America/Denver">America/Denver (GMT-7/-6)</option>
                      <option value="America/Los_Angeles">America/Los_Angeles (GMT-8/-7)</option>
                      <option value="America/Toronto">America/Toronto (GMT-5/-4)</option>
                      <option value="America/Vancouver">America/Vancouver (GMT-8/-7)</option>
                      <option value="America/Sao_Paulo">America/Sao_Paulo (GMT-3)</option>
                    </optgroup>
                    <optgroup label="Asia / Pacific">
                      <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
                      <option value="Asia/Kolkata">Asia/Kolkata (GMT+5:30)</option>
                      <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
                      <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
                      <option value="Asia/Shanghai">Asia/Shanghai (GMT+8)</option>
                      <option value="Asia/Hong_Kong">Asia/Hong_Kong (GMT+8)</option>
                    </optgroup>
                    <optgroup label="Oceania">
                      <option value="Australia/Sydney">Australia/Sydney (GMT+10/+11)</option>
                      <option value="Australia/Melbourne">Australia/Melbourne (GMT+10/+11)</option>
                      <option value="Australia/Perth">Australia/Perth (GMT+8)</option>
                      <option value="Pacific/Auckland">Pacific/Auckland (GMT+12/+13)</option>
                    </optgroup>
                    <optgroup label="Africa">
                      <option value="Africa/Johannesburg">Africa/Johannesburg (GMT+2)</option>
                      <option value="Africa/Lagos">Africa/Lagos (GMT+1)</option>
                    </optgroup>
                  </select>
                </div>

                {/* Cutoff Times */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Cutoff Times</s-heading>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Orders placed after cutoff time will be processed the next business day.
                  </s-text>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <label>
                      <s-text size="small">Weekday</s-text>
                      <input
                        type="time"
                        value={globalSettings?.cutoff_time || "14:00"}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, cutoff_time: e.target.value })}
                        style={{ width: "100%" }}
                      />
                    </label>
                    <label>
                      <s-text size="small">Saturday</s-text>
                      <input
                        type="time"
                        value={globalSettings?.cutoff_time_sat || ""}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, cutoff_time_sat: e.target.value })}
                        style={{ width: "100%" }}
                        placeholder="Same as weekday"
                      />
                    </label>
                    <label>
                      <s-text size="small">Sunday</s-text>
                      <input
                        type="time"
                        value={globalSettings?.cutoff_time_sun || ""}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, cutoff_time_sun: e.target.value })}
                        style={{ width: "100%" }}
                        placeholder="Same as weekday"
                      />
                    </label>
                  </div>
                </div>

                {/* Lead Time */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Lead Time</s-heading>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min="0"
                      max="30"
                      value={globalSettings?.lead_time ?? 0}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, lead_time: Number(e.target.value) || 0 })}
                      style={{ width: 80 }}
                    />
                    <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>business days before dispatch</s-text>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)" }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                    <span style={{ fontSize: 12 }}>Use 0 for same-day dispatch (before cutoff).</span>
                  </div>
                </div>

                {/* Closed Days */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Closed Days</s-heading>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Days your business does not process/ship orders
                  </s-text>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {[["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]].map(([key, label]) => {
                      const isSelected = (globalSettings?.closed_days || []).includes(key);
                      const wouldCloseAll = !isSelected && (globalSettings?.closed_days || []).length >= 6;
                      return (
                        <label key={key} style={{ display: "flex", gap: 6, alignItems: "center", opacity: wouldCloseAll ? 0.5 : 1 }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={wouldCloseAll}
                            onChange={() => toggleClosedDay(key)}
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                  {(globalSettings?.closed_days || []).length >= 6 && (
                    <div style={{ color: "var(--p-color-text-critical, #dc2626)", fontSize: 12 }}>
                      ⚠️ At least one day must remain open for dispatch.
                    </div>
                  )}
                </div>

                {/* Courier Non-Delivery Days */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Courier Non-Delivery Days</s-heading>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Days your courier does not deliver (used for ETA calculations)
                  </s-text>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {[["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]].map(([key, label]) => {
                      const isSelected = (globalSettings?.courier_no_delivery_days || []).includes(key);
                      const wouldBlockAll = !isSelected && (globalSettings?.courier_no_delivery_days || []).length >= 6;
                      return (
                        <label key={key} style={{ display: "flex", gap: 6, alignItems: "center", opacity: wouldBlockAll ? 0.5 : 1 }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={wouldBlockAll}
                            onChange={() => toggleCourierDay(key)}
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                  {(globalSettings?.courier_no_delivery_days || []).length >= 6 && (
                    <div style={{ color: "var(--p-color-text-critical, #dc2626)", fontSize: 12 }}>
                      ⚠️ At least one day must remain open for deliveries.
                    </div>
                  )}
                </div>

                {/* Bank Holidays */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Bank Holidays</s-heading>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Select your country to automatically skip bank holidays
                  </s-text>
                  <select
                    value={globalSettings?.bank_holiday_country || ""}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, bank_holiday_country: e.target.value })}
                    style={{ width: "100%" }}
                  >
                    <option value="">None (no bank holidays)</option>
                    {Object.entries(HOLIDAY_DEFINITIONS)
                      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                      .map(([code, { name }]) => (
                        <option key={code} value={code}>{name}</option>
                      ))}
                  </select>
                  {globalSettings?.bank_holiday_country && (
                    <div style={{ fontSize: 12, color: "var(--p-color-text-subdued, #6b7280)" }}>
                      Holidays for {new Date().getFullYear()}:{" "}
                      {getHolidaysForYear(globalSettings.bank_holiday_country, new Date().getFullYear())
                        .map(date => {
                          const d = new Date(date + "T00:00:00");
                          return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                        })
                        .join(", ")}
                    </div>
                  )}
                </div>

                {/* Custom Holidays */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface-secondary, #f9fafb)" }}>
                  <s-heading size="small">Custom Holidays</s-heading>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Add one-off holidays or non-dispatch days (e.g., company events, stocktake days)
                  </s-text>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: 12, alignItems: "end" }}>
                    <div>
                      <s-text size="small">Date</s-text>
                      <CustomDatePicker
                        value={newCustomHoliday}
                        onChange={setNewCustomHoliday}
                        placeholder="Select date"
                      />
                    </div>
                    <label>
                      <s-text size="small">Label (optional)</s-text>
                      <input
                        type="text"
                        value={newCustomHolidayLabel}
                        onChange={(e) => setNewCustomHolidayLabel(e.target.value)}
                        placeholder="e.g., Stocktake"
                        style={{ width: "100%" }}
                      />
                    </label>
                    <div>
                      <div style={{ height: 20 }} />
                      <s-button onClick={addCustomHoliday} disabled={!newCustomHoliday}>
                        Add
                      </s-button>
                    </div>
                  </div>
                  {(globalSettings?.custom_holidays || []).length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <s-text size="small" style={{ fontWeight: 500 }}>Your custom holidays:</s-text>
                      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                        {(globalSettings?.custom_holidays || [])
                          .filter((h) => h && typeof h.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.date))
                          .map((holiday) => {
                            const d = new Date(holiday.date + "T00:00:00");
                            const dateStr = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
                            const isPast = d < new Date(new Date().toDateString());
                            return (
                              <div
                                key={holiday.date}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  padding: "8px 12px",
                                  background: isPast ? "var(--p-color-bg-surface-secondary, #f9fafb)" : "var(--p-color-bg-success-subdued, #dcfce7)",
                                  borderRadius: 6,
                                  opacity: isPast ? 0.6 : 1,
                                }}
                              >
                                <div>
                                  <s-text size="small" style={{ fontWeight: 500 }}>{dateStr}</s-text>
                                  {holiday.label && (
                                    <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginLeft: 8 }}>
                                      - {holiday.label}
                                    </s-text>
                                  )}
                                  {isPast && (
                                    <s-text size="small" style={{ color: "var(--p-color-text-disabled, #9ca3af)", marginLeft: 8 }}>(past)</s-text>
                                  )}
                                </div>
                                <button
                                  onClick={() => removeCustomHoliday(holiday.date)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    color: "var(--p-color-text-critical, #dc2626)",
                                    fontSize: 14,
                                    padding: "4px 8px",
                                  }}
                                  title="Remove this holiday"
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

              {/* Rule-specific sections (only shown when a rule is selected AND no styling panel is open) */}
              {rule && !showTypographyPanel && !showAlignmentPanel && !showGlobalSettingsPanel && (
                <>
                  {/* Product Matching Section */}
                <div
                  style={{
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                    borderRadius: "8px",
                    background: "var(--p-color-bg-surface, #ffffff)",
                    overflow: "hidden",
                  }}
                >
                  {/* Collapsible Header */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedPanels.product_matching}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      background: !collapsedPanels.product_matching ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedPanels.product_matching ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                      borderRadius: "8px 8px 0 0",
                    }}
                    onClick={() => togglePanel('product_matching')}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        togglePanel('product_matching');
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                        {collapsedPanels.product_matching ? <ChevronRightIcon /> : <ChevronDownIcon />}
                      </span>
                      <s-heading>Product Matching</s-heading>
                    </div>
                  </div>

                  {/* Content - only show when not collapsed */}
                  {!collapsedPanels.product_matching && (
                    <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                      {!rule.match?.is_fallback && (<>
                      <label>
                    <s-text>Product tags (comma-separated, ANY tag matches)</s-text>
                    <input
                      ref={tagsInputRef}
                      value={tagsText}
                      onChange={(e) => setTagsText(e.target.value)}
                      onFocus={() => {
                        editingTagsRuleId.current = rule?.id;
                      }}
                      onBlur={() => {
                        const ruleId = editingTagsRuleId.current;
                        if (!ruleId) return;

                        const currentRules = rulesRef.current;
                        const ruleIndex = currentRules.findIndex((r) => r.id === ruleId);
                        if (ruleIndex < 0) {
                          editingTagsRuleId.current = null;
                          return; // Rule was deleted
                        }

                        const targetRule = currentRules[ruleIndex];
                        const tags = tagsText
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);

                        // Update display text to show trimmed version
                        setTagsText(tags.join(", "));

                        const next = [...currentRules];
                        next[ruleIndex] = {
                          ...targetRule,
                          match: { ...targetRule.match, tags },
                        };
                        setRules(next);
                        editingTagsRuleId.current = null;
                      }}
                      style={{ width: "100%" }}
                    />
                  </label>

                  <label>
                    <s-text>Product handles (comma-separated)</s-text>
                    <input
                      ref={handlesInputRef}
                      value={handlesText}
                      onChange={(e) => setHandlesText(e.target.value)}
                      onFocus={() => {
                        editingHandlesRuleId.current = rule?.id;
                      }}
                      onBlur={() => {
                        const ruleId = editingHandlesRuleId.current;
                        if (!ruleId) return;

                        const currentRules = rulesRef.current;
                        const ruleIndex = currentRules.findIndex((r) => r.id === ruleId);
                        if (ruleIndex < 0) {
                          editingHandlesRuleId.current = null;
                          return; // Rule was deleted
                        }

                        const targetRule = currentRules[ruleIndex];
                        const handles = handlesText
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);

                        // Update display text to show trimmed version
                        setHandlesText(handles.join(", "));

                        const next = [...currentRules];
                        next[ruleIndex] = {
                          ...targetRule,
                          match: { ...targetRule.match, product_handles: handles },
                        };
                        setRules(next);
                        editingHandlesRuleId.current = null;
                      }}
                      style={{ width: "100%" }}
                    />
                  </label>
                      </>)}

                      <label style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={rule.match?.is_fallback || false}
                          style={{ marginTop: 4 }}
                          onChange={(e) => {
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              match: { ...rule.match, is_fallback: e.target.checked },
                            };
                            setRules(next);
                          }}
                        />
                        <s-text>Fallback rule — used when no other rules apply.</s-text>
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: -8 }}>
                        <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                        <span style={{ fontSize: 12 }}>For best results, place fallback rules at the bottom of your rule list.</span>
                      </div>

                  <label>
                    <s-text>Product stock status</s-text>
                    <select
                      value={rule.match?.stock_status || "any"}
                      onChange={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          match: { ...rule.match, stock_status: e.target.value },
                        };
                        setRules(next);
                      }}
                      style={{ width: "100%" }}
                    >
                      <option value="any">Any (ignore stock)</option>
                      <option value="in_stock">In stock</option>
                      <option value="out_of_stock">Out of stock</option>
                      <option value="pre_order">Pre-order (available but zero inventory)</option>
                      <option value="mixed_stock">Mixed stock (variants have different statuses)</option>
                    </select>
                      </label>
                    </div>
                  )}
                </div>

                {/* Dispatch Settings Section */}
                <div
                  style={{
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                    borderRadius: "8px",
                    background: "var(--p-color-bg-surface, #ffffff)",
                    overflow: "hidden",
                  }}
                >
                  {/* Collapsible Header */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedPanels.dispatch_settings}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      background: !collapsedPanels.dispatch_settings ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedPanels.dispatch_settings ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                      borderRadius: "8px 8px 0 0",
                    }}
                    onClick={() => togglePanel('dispatch_settings')}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        togglePanel('dispatch_settings');
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                        {collapsedPanels.dispatch_settings ? <ChevronRightIcon /> : <ChevronDownIcon />}
                      </span>
                      <s-heading>Dispatch Settings</s-heading>
                    </div>
                  </div>

                  {/* Content - only show when not collapsed */}
                  {!collapsedPanels.dispatch_settings && (
                    <div style={{ padding: "16px", display: "grid", gap: 16 }}>

                      {/* ===== 1. CUTOFF TIMES ===== */}
                      <div>
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.override_cutoff_times}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, override_cutoff_times: e.target.checked },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Override global settings for Cutoff times</s-text>
                        </label>

                        {!rule.settings?.override_cutoff_times ? (
                          <div style={{ marginLeft: 24, marginTop: 4, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12 }}>
                            Using: <strong>{globalSettings?.cutoff_time || "14:00"}</strong>
                            {globalSettings?.cutoff_time_sat && <> (Sat: {globalSettings.cutoff_time_sat})</>}
                            {globalSettings?.cutoff_time_sun && <> (Sun: {globalSettings.cutoff_time_sun})</>}
                          </div>
                        ) : (
                          <div style={{ marginLeft: 24, marginTop: 8, display: "grid", gap: 8 }}>
                            <label>
                              <s-text>Cutoff time (shop timezone)</s-text>
                              <input
                                type="time"
                                value={rule.settings?.cutoff_time || globalSettings?.cutoff_time || "14:00"}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, cutoff_time: e.target.value },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              />
                              {!isHHMM(rule.settings?.cutoff_time || globalSettings?.cutoff_time || "14:00") && (
                                <s-text size="small" style={{ color: "var(--p-color-text-critical, #dc2626)" }}>
                                  Please use HH:MM (24-hour), e.g. 14:00
                                </s-text>
                              )}
                            </label>

                            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                              <label>
                                <s-text>Saturday cutoff (optional)</s-text>
                                <input
                                  type="time"
                                  value={rule.settings?.cutoff_time_sat || ""}
                                  onChange={(e) => {
                                    const next = [...rules];
                                    next[safeSelectedIndex] = {
                                      ...rule,
                                      settings: { ...rule.settings, cutoff_time_sat: e.target.value },
                                    };
                                    setRules(next);
                                  }}
                                  style={{ width: "100%" }}
                                />
                              </label>

                              <label>
                                <s-text>Sunday cutoff (optional)</s-text>
                                <input
                                  type="time"
                                  value={rule.settings?.cutoff_time_sun || ""}
                                  onChange={(e) => {
                                    const next = [...rules];
                                    next[safeSelectedIndex] = {
                                      ...rule,
                                      settings: { ...rule.settings, cutoff_time_sun: e.target.value },
                                    };
                                    setRules(next);
                                  }}
                                  style={{ width: "100%" }}
                                />
                              </label>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ===== 2. LEAD TIME ===== */}
                      <div>
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.override_lead_time}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, override_lead_time: e.target.checked },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Override global settings for Lead time</s-text>
                        </label>

                        {!rule.settings?.override_lead_time ? (
                          <div style={{ marginLeft: 24, marginTop: 4, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12 }}>
                            Using: <strong>{globalSettings?.lead_time ?? 0} days</strong>
                          </div>
                        ) : (
                          <div style={{ marginLeft: 24, marginTop: 8 }}>
                            <label>
                              <s-text>Lead time (business days)</s-text>
                              <input
                                type="number"
                                min="0"
                                max="30"
                                value={rule.settings?.lead_time ?? globalSettings?.lead_time ?? 0}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, lead_time: Number(e.target.value) || 0 },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              />
                            </label>
                          </div>
                        )}
                      </div>

                      {/* ===== 3. CLOSED DAYS ===== */}
                      <div>
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.override_closed_days}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, override_closed_days: e.target.checked },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Override global settings for Closed days</s-text>
                        </label>

                        {!rule.settings?.override_closed_days ? (
                          <div style={{ marginLeft: 24, marginTop: 4, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12 }}>
                            Using: <strong>{(globalSettings?.closed_days || []).length > 0
                              ? (globalSettings?.closed_days || []).map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")
                              : "None"}</strong>
                          </div>
                        ) : (
                          <div style={{ marginLeft: 24, marginTop: 8 }}>
                            <label>
                              <s-text>Closed days (no dispatch on these days)</s-text>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                                {(() => {
                                  const currentClosed = rule.settings?.closed_days ?? [];
                                  return [
                                    ["mon", "Mon"],
                                    ["tue", "Tue"],
                                    ["wed", "Wed"],
                                    ["thu", "Thu"],
                                    ["fri", "Fri"],
                                    ["sat", "Sat"],
                                    ["sun", "Sun"],
                                  ].map(([key, label]) => {
                                    const selected = currentClosed.includes(key);
                                    // Disable if this is the last open day
                                    const wouldCloseAll = !selected && currentClosed.length === 6;
                                    return (
                                      <label key={key} style={{ display: "flex", gap: 6, alignItems: "center", opacity: wouldCloseAll ? 0.5 : 1 }}>
                                        <input
                                          type="checkbox"
                                          checked={selected}
                                          disabled={wouldCloseAll}
                                          onChange={(e) => {
                                            const current = new Set(currentClosed);
                                            if (e.target.checked) current.add(key);
                                            else current.delete(key);

                                            const next = [...rules];
                                            next[safeSelectedIndex] = {
                                              ...rule,
                                              settings: { ...rule.settings, closed_days: Array.from(current) },
                                            };
                                            setRules(next);
                                          }}
                                        />
                                        <span>{label}</span>
                                      </label>
                                    );
                                  });
                                })()}
                              </div>
                              {(rule.settings?.closed_days ?? []).length === 6 && (
                                <div style={{ color: "var(--p-color-text-critical, #dc2626)", fontSize: 12, marginTop: 6 }}>
                                  ⚠️ At least one day must remain open for dispatch.
                                </div>
                              )}
                            </label>
                          </div>
                        )}
                      </div>

                      {/* ===== 4. COURIER NON-DELIVERY DAYS ===== */}
                      <div>
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.override_courier_no_delivery_days}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, override_courier_no_delivery_days: e.target.checked },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Override global settings for Courier non-delivery days</s-text>
                        </label>

                        {!rule.settings?.override_courier_no_delivery_days ? (
                          <div style={{ marginLeft: 24, marginTop: 4, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12 }}>
                            Using: <strong>{(globalSettings?.courier_no_delivery_days || ["sat", "sun"]).map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}</strong>
                          </div>
                        ) : (
                          <div style={{ marginLeft: 24, marginTop: 8 }}>
                            <label>
                              <s-text>Courier non-delivery days</s-text>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                                {[
                                  ["mon", "Mon"],
                                  ["tue", "Tue"],
                                  ["wed", "Wed"],
                                  ["thu", "Thu"],
                                  ["fri", "Fri"],
                                  ["sat", "Sat"],
                                  ["sun", "Sun"],
                                ].map(([key, label]) => {
                                  const currentCourierDays = rule.settings?.courier_no_delivery_days ?? globalSettings?.courier_no_delivery_days ?? ["sat", "sun"];
                                  const selected = currentCourierDays.includes(key);
                                  const wouldBlockAll = !selected && currentCourierDays.length >= 6;
                                  return (
                                    <label key={key} style={{ display: "flex", gap: 6, alignItems: "center", opacity: wouldBlockAll ? 0.5 : 1 }}>
                                      <input
                                        type="checkbox"
                                        checked={selected}
                                        disabled={wouldBlockAll}
                                        onChange={(e) => {
                                          const current = new Set(currentCourierDays);
                                          if (e.target.checked) {
                                            if (current.size >= 6) return;
                                            current.add(key);
                                          } else {
                                            current.delete(key);
                                          }

                                          const next = [...rules];
                                          next[safeSelectedIndex] = {
                                            ...rule,
                                            settings: { ...rule.settings, courier_no_delivery_days: Array.from(current) },
                                          };
                                          setRules(next);
                                        }}
                                      />
                                      <span>{label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                              {(rule.settings?.courier_no_delivery_days ?? globalSettings?.courier_no_delivery_days ?? ["sat", "sun"]).length === 6 && (
                                <div style={{ color: "var(--p-color-text-critical, #dc2626)", fontSize: 12, marginTop: 6 }}>
                                  ⚠️ At least one day must remain open for deliveries.
                                </div>
                              )}
                            </label>
                          </div>
                        )}
                      </div>

                    </div>
                  )}
                </div>

                {/* Messages Section */}
                <div
                  style={{
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                    borderRadius: "8px",
                    background: "var(--p-color-bg-surface, #ffffff)",
                    overflow: "hidden",
                    borderLeft: "1px solid var(--p-color-border, #e5e7eb)",
                  }}
                >
                  {/* Header with collapse toggle and enable toggle */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedPanels.countdown_messages}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: !collapsedPanels.countdown_messages ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedPanels.countdown_messages ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    onClick={() => togglePanel('countdown_messages')}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        togglePanel('countdown_messages');
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                        {collapsedPanels.countdown_messages ? <ChevronRightIcon /> : <ChevronDownIcon />}
                      </span>
                      <s-heading>Messages</s-heading>
                    </div>
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <s-text size="small">{rule.settings?.show_messages ? "Enabled" : "Disabled"}</s-text>
                      <input
                        type="checkbox"
                        checked={!!rule.settings?.show_messages}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: {
                              ...rule.settings,
                              show_messages: e.target.checked,
                            },
                          };
                          setRules(next);
                          // Auto-expand when enabled, auto-collapse when disabled
                          if (rule?.id) {
                            const newCollapsed = !e.target.checked;
                            setCollapsedPanels(prev => ({ ...prev, countdown_messages: newCollapsed }));
                            setCollapsedState(rule.id, 'countdown_messages', newCollapsed);
                          }
                        }}
                      />
                    </label>
                  </div>

                  {/* Content - only show when not collapsed */}
                  {!collapsedPanels.countdown_messages && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                    <div style={{ display: "grid", gap: 2, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        💡 Placeholders: &#123;countdown&#125;, &#123;arrival&#125;, &#123;express&#125;, &#123;threshold&#125;
                        <span title={"{countdown} = live countdown timer\n{arrival} = estimated delivery date\n{express} = next-day delivery date\n{threshold} = free delivery threshold"} style={{ cursor: "help" }}>ℹ️</span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        💡 Formatting: **bold**, [link](url), &#123;lb&#125;
                        <span title={"**text** = bold text\n[text](url) = clickable link\n{lb} = manual line break"} style={{ cursor: "help" }}>ℹ️</span>
                      </span>
                    </div>

                    <label>
                      <s-text>Message line 1</s-text>
                      <input
                        value={rule.settings?.message_line_1 || ""}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, message_line_1: e.target.value },
                          };
                          setRules(next);
                        }}
                        maxLength={100}
                        style={{ width: "100%" }}
                        placeholder='e.g. "**Free Delivery:** Ships Monday via Royal Mail"'
                      />
                    </label>

                    <label>
                      <s-text>Message line 2</s-text>
                      <input
                        value={rule.settings?.message_line_2 || ""}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, message_line_2: e.target.value },
                          };
                          setRules(next);
                        }}
                        maxLength={100}
                        style={{ width: "100%" }}
                        placeholder='e.g. "**Note:** Order within 2hrs for same-day dispatch"'
                      />
                    </label>

                    <label>
                      <s-text>Message line 3</s-text>
                      <input
                        value={rule.settings?.message_line_3 || ""}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, message_line_3: e.target.value },
                          };
                          setRules(next);
                        }}
                        maxLength={100}
                        style={{ width: "100%" }}
                        placeholder="Optional third line"
                      />
                    </label>

                    {/* Border Styling sub-section */}
                    <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 16, display: "grid", gap: 12 }}>
                      <s-heading>Border Styling</s-heading>

                      {/* Only show "Match ETA border" when ETA Timeline is enabled AND has border enabled */}
                      {rule.settings?.show_eta_timeline && (rule.settings?.eta_border_width ?? 0) > 0 && (
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.match_eta_border}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, match_eta_border: e.target.checked },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Match ETA timeline border</s-text>
                        </label>
                      )}

                      {/* Border settings - hide when Match ETA timeline border is checked */}
                      {!(rule.settings?.show_eta_timeline && rule.settings?.match_eta_border) && (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <label>
                              <s-text>Border thickness (px)</s-text>
                              <input
                                type="number"
                                min="0"
                                max="10"
                                value={String(rule.settings?.border_thickness ?? 0)}
                                onChange={(e) => {
                                  const n = Math.max(0, Number(e.target.value) || 0);
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: {
                                      ...rule.settings,
                                      border_thickness: Number.isFinite(n) ? n : 0,
                                    },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              />
                            </label>
                            <label>
                              <s-text>Border radius (px)</s-text>
                              <input
                                type="number"
                                min="0"
                                value={String(rule.settings?.border_radius ?? 8)}
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: {
                                      ...rule.settings,
                                      border_radius: Number.isFinite(n) ? n : 0,
                                    },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              />
                            </label>
                          </div>

                          <s-color-field
                            label="Border color"
                            placeholder="#e5e7eb"
                            value={rule.settings?.border_color || "#e5e7eb"}
                            onInput={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, border_color: e.target.value },
                              };
                              setRules(next);
                            }}
                          />
                        </>
                      )}

                      {/* Background color - always visible, independent of border */}
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <s-color-field
                            label="Background color"
                            placeholder="transparent"
                            value={rule.settings?.background_color || ""}
                            onInput={(e) => {
                              const val = e.detail?.value ?? e.target?.value ?? "";
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, background_color: val },
                              };
                              setRules(next);
                            }}
                            onChange={(e) => {
                              const val = e.detail?.value ?? e.target?.value ?? "";
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, background_color: val },
                              };
                              setRules(next);
                            }}
                          />
                        </div>
                        {rule.settings?.background_color && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, background_color: "" },
                              };
                              setRules(next);
                            }}
                            style={{
                              padding: "6px 10px",
                              fontSize: 12,
                              border: "1px solid var(--p-color-border, #e5e7eb)",
                              borderRadius: 4,
                              background: "var(--p-color-bg-surface, #fff)",
                              cursor: "pointer",
                              marginBottom: 4,
                            }}
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      {rule.settings?.show_eta_timeline && (
                        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.match_eta_width}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              const next = [...rules];
                              // Capture ETA width when enabling to avoid feedback loops
                              const capturedWidth = checked && etaTimelineRef.current
                                ? etaTimelineRef.current.offsetWidth
                                : rule.settings?._captured_eta_width;
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: {
                                  ...rule.settings,
                                  match_eta_width: checked,
                                  _captured_eta_width: capturedWidth,
                                },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Match ETA timeline width</s-text>
                        </label>
                      )}

                      {(!rule.settings?.show_eta_timeline || !rule.settings?.match_eta_width) && (
                        <label>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <s-text>Max width</s-text>
                            <span
                              title="Block won't shrink below text width.&#10;Use {lb} for manual line breaks."
                              style={{ cursor: "help", fontSize: 12, color: "var(--p-color-text-subdued)" }}
                            >ℹ️</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            value={String(rule.settings?.max_width ?? 600)}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: {
                                  ...rule.settings,
                                  max_width: Number.isFinite(n) ? n : 0,
                                },
                              };
                              setRules(next);
                            }}
                            style={{ width: "100%" }}
                          />
                          <div style={{ display: "grid", gap: 2, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12, marginTop: 4 }}>
                            <span>💡 Set to 0 for no maximum width (block sizes to fit content).</span>
                            <span>💡 Actual width may be limited by container.</span>
                          </div>
                        </label>
                      )}
                    </div>

                    {/* Text Styling sub-section */}
                    <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 16, display: "grid", gap: 12 }}>
                      <s-heading>Text Styling</s-heading>

                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={rule.settings?.override_global_text_styling === true}
                          onChange={(e) => {
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: { ...rule.settings, override_global_text_styling: e.target.checked },
                            };
                            setRules(next);
                          }}
                        />
                        <s-text>Use custom text styling for this rule</s-text>
                      </label>

                      {rule.settings?.override_global_text_styling === true && (
                      <div style={{ display: "grid", gap: 12 }}>
                        <s-color-field
                          label="Text color"
                          value={rule.settings?.text_color || "#374151"}
                          onInput={(e) => {
                            const val = e.target.value || e.detail?.value || "#374151";
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: { ...rule.settings, text_color: val },
                            };
                            setRules(next);
                          }}
                          onChange={(e) => {
                            const val = e.target.value || e.detail?.value || "#374151";
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: { ...rule.settings, text_color: val },
                            };
                            setRules(next);
                          }}
                        />

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          <label>
                            <s-text>Font size: {normalizeFontSize(rule.settings?.font_size, 16)}px</s-text>
                            <input
                              type="range"
                              min="10"
                              max="22"
                              step="1"
                              value={normalizeFontSize(rule.settings?.font_size, 16)}
                              onChange={(e) => {
                                const next = [...rules];
                                next[safeSelectedIndex] = {
                                  ...rule,
                                  settings: { ...rule.settings, font_size: parseInt(e.target.value) },
                                };
                                setRules(next);
                              }}
                              style={{ width: "100%" }}
                            />
                          </label>

                          <label>
                            <s-text>Font weight</s-text>
                            <select
                              value={rule.settings?.font_weight || "normal"}
                              onChange={(e) => {
                                const next = [...rules];
                                next[safeSelectedIndex] = {
                                  ...rule,
                                  settings: { ...rule.settings, font_weight: e.target.value },
                                };
                                setRules(next);
                              }}
                              style={{ width: "100%" }}
                            >
                              <option value="normal">Normal</option>
                              <option value="bold">Bold</option>
                            </select>
                          </label>
                        </div>
                      </div>
                      )}
                    </div>
                  </div>
                  )}
                </div>

                {/* Messages Icon Section */}
                <div
                  style={{
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                    borderRadius: "8px",
                    background: "var(--p-color-bg-surface, #ffffff)",
                    overflow: "hidden",
                    borderLeft: "1px solid var(--p-color-border, #e5e7eb)",
                  }}
                >
                  {/* Header with collapse toggle and enable toggle */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedPanels.countdown_icon}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: !collapsedPanels.countdown_icon ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedPanels.countdown_icon ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    onClick={() => togglePanel('countdown_icon')}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        togglePanel('countdown_icon');
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                        {collapsedPanels.countdown_icon ? <ChevronRightIcon /> : <ChevronDownIcon />}
                      </span>
                      <s-heading>Messages Icon</s-heading>
                    </div>
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <s-text size="small">{rule.settings?.show_icon !== false ? "Enabled" : "Disabled"}</s-text>
                      <input
                        type="checkbox"
                        checked={rule.settings?.show_icon !== false}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: {
                              ...rule.settings,
                              show_icon: e.target.checked,
                            },
                          };
                          setRules(next);
                          // Auto-expand when enabled, auto-collapse when disabled
                          if (rule?.id) {
                            const newCollapsed = !e.target.checked;
                            setCollapsedPanels(prev => ({ ...prev, countdown_icon: newCollapsed }));
                            setCollapsedState(rule.id, 'countdown_icon', newCollapsed);
                          }
                        }}
                      />
                    </label>
                  </div>

                  {/* Content - only show when not collapsed */}
                  {!collapsedPanels.countdown_icon && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                    <label>
                    <s-text>Icon</s-text>
                    <select
                      value={getEffectiveIcon(rule.settings?.icon, "truck")}
                      onChange={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          settings: { ...rule.settings, icon: e.target.value },
                        };
                        setRules(next);
                      }}
                      style={{ width: "100%" }}
                    >
                      <optgroup label="Preset Icons">
                        <option value="truck">Truck</option>
                        <option value="truck-v2">Truck v2</option>
                        <option value="clock">Clock</option>
                        <option value="home">Home</option>
                        <option value="pin">Pin</option>
                        <option value="pin-v2">Pin v2</option>
                        <option value="gift">Gift</option>
                        <option value="shopping-bag">Shopping Bag</option>
                        <option value="shopping-bag-v2">Shopping Bag v2</option>
                        <option value="shopping-cart">Shopping Cart</option>
                        <option value="shopping-cart-v2">Shopping Cart v2</option>
                        <option value="shopping-basket">Shopping Basket</option>
                        <option value="clipboard-document-check">Clipboard</option>
                        <option value="clipboard-v2">Clipboard v2</option>
                        <option value="bullet">Bullet</option>
                        <option value="checkmark">Checkmark (badge)</option>
                      </optgroup>
                      {configuredCustomIcons.length > 0 && (
                        <optgroup label="Custom Icons">
                          {configuredCustomIcons.map((icon) => (
                            <option key={icon.value} value={icon.value}>{icon.label}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </label>

                  {!getEffectiveIcon(rule.settings?.icon, "truck").startsWith("custom-") && (
                    <label>
                      <s-text>Icon style</s-text>
                      <select
                        value={rule.settings?.icon_style || "solid"}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, icon_style: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <option value="solid">Solid (filled)</option>
                        <option value="outline">Outline</option>
                      </select>
                    </label>
                  )}

                  <label>
                    <s-text>Icon layout</s-text>
                    <select
                      value={rule.settings?.icon_layout || "per-line"}
                      onChange={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          settings: { ...rule.settings, icon_layout: e.target.value },
                        };
                        setRules(next);
                      }}
                      style={{ width: "100%" }}
                    >
                      <option value="per-line">Icon on each line</option>
                      <option value="single">Single larger icon (left)</option>
                    </select>
                  </label>

                  {rule.settings?.icon_layout === "single" && (
                    <label>
                      <s-text>Icon size: {normalizeSingleIconSize(rule.settings?.single_icon_size, 36)}px</s-text>
                      <input
                        type="range"
                        min="20"
                        max="56"
                        step="4"
                        value={normalizeSingleIconSize(rule.settings?.single_icon_size, 36)}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, single_icon_size: parseInt(e.target.value) },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      />
                    </label>
                  )}

                  <s-color-field
                    label="Icon color"
                    placeholder="#111827"
                    value={rule.settings?.icon_color || "#111827"}
                    onInput={(e) => {
                      const next = [...rules];
                      next[safeSelectedIndex] = {
                        ...rule,
                        settings: { ...rule.settings, icon_color: e.target.value },
                      };
                      setRules(next);
                    }}
                  />
                  </div>
                  )}
                </div>

                {/* ETA Timeline Section */}
                <div
                  style={{
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                    borderRadius: "8px",
                    background: "var(--p-color-bg-surface, #ffffff)",
                    overflow: "hidden",
                    borderLeft: "1px solid var(--p-color-border, #e5e7eb)",
                  }}
                >
                  {/* Header with collapse toggle and enable toggle */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedPanels.eta_timeline}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: !collapsedPanels.eta_timeline ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedPanels.eta_timeline ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    onClick={() => togglePanel('eta_timeline')}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        togglePanel('eta_timeline');
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                        {collapsedPanels.eta_timeline ? <ChevronRightIcon /> : <ChevronDownIcon />}
                      </span>
                      <s-heading>ETA Timeline</s-heading>
                    </div>
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <s-text size="small">{rule.settings?.show_eta_timeline ? "Enabled" : "Disabled"}</s-text>
                      <input
                        type="checkbox"
                        checked={!!rule.settings?.show_eta_timeline}
                        onChange={(e) => {
                          const next = [...rules];
                          const isFirstActivation = e.target.checked && !rule.settings?.eta_timeline_initialized;

                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: {
                              ...rule.settings,
                              show_eta_timeline: e.target.checked,
                              // On first activation, inherit border settings from Messages
                              ...(isFirstActivation ? {
                                eta_timeline_initialized: true,
                                eta_border_width: rule.settings?.border_thickness ?? 0,
                                eta_border_radius: rule.settings?.border_radius ?? 8,
                                eta_border_color: rule.settings?.border_color || "#e5e7eb",
                              } : {}),
                            },
                          };
                          setRules(next);
                          // Auto-expand when enabled, auto-collapse when disabled
                          if (rule?.id) {
                            const newCollapsed = !e.target.checked;
                            setCollapsedPanels(prev => ({ ...prev, eta_timeline: newCollapsed }));
                            setCollapsedState(rule.id, 'eta_timeline', newCollapsed);
                          }
                        }}
                      />
                    </label>
                  </div>

                  {/* Content - only show when not collapsed */}
                  {!collapsedPanels.eta_timeline && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                    <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                      Timeline shows: Order date (today) → Shipping date (based on cutoff) → Delivery date range
                    </s-text>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label>
                      <s-text>Delivery: Min days (after shipping)</s-text>
                      <input
                        type="number"
                        min="0"
                        value={String(rule.settings?.eta_delivery_days_min ?? 3)}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_delivery_days_min: safeParseNumber(e.target.value, 3, 0) },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      />
                    </label>

                    <label>
                      <s-text>Delivery: Max days (after shipping)</s-text>
                      <input
                        type="number"
                        min="0"
                        value={String(rule.settings?.eta_delivery_days_max ?? 5)}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_delivery_days_max: safeParseNumber(e.target.value, 5, 0) },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      />
                    </label>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label>
                      <s-text>Connector style</s-text>
                      <select
                        value={rule.settings?.eta_connector_style || "arrows"}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_connector_style: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <option value="arrows">Arrows</option>
                        <option value="big-arrow">Single arrow</option>
                        <option value="line">Line</option>
                        {globalSettings?.custom_connector_svg && (
                          <option value="custom">Custom</option>
                        )}
                      </select>
                    </label>

                    <label>
                      <s-text>Connector alignment</s-text>
                      <select
                        value={rule.settings?.eta_connector_alignment || "center"}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_connector_alignment: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <option value="center">Center (full height)</option>
                        <option value="icon">Center (icon level)</option>
                      </select>
                    </label>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={rule.settings?.eta_connector_use_main_color !== false}
                      onChange={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          settings: {
                            ...rule.settings,
                            eta_connector_use_main_color: e.target.checked
                          },
                        };
                        setRules(next);
                      }}
                    />
                    <s-text>Connector uses main icon colour</s-text>
                  </label>

                  {rule.settings?.eta_connector_use_main_color === false && (
                    <s-color-field
                      label="Custom connector colour"
                      value={rule.settings?.eta_connector_color || "#111827"}
                      onInput={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          settings: { ...rule.settings, eta_connector_color: e.target.value || e.detail?.value },
                        };
                        setRules(next);
                      }}
                      onChange={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          settings: { ...rule.settings, eta_connector_color: e.target.value || e.detail?.value },
                        };
                        setRules(next);
                      }}
                    />
                  )}

                  <s-text style={{ fontWeight: 600, marginTop: 12 }}>Stage Labels</s-text>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <label>
                      <s-text size="small">Order</s-text>
                      <input
                        type="text"
                        value={rule.settings?.eta_label_order || "Ordered"}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_label_order: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                        placeholder="Ordered"
                        maxLength={10}
                      />
                    </label>
                    <label>
                      <s-text size="small">Shipping</s-text>
                      <input
                        type="text"
                        value={rule.settings?.eta_label_shipping || "Shipped"}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_label_shipping: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                        placeholder="Shipped"
                        maxLength={10}
                      />
                    </label>
                    <label>
                      <s-text size="small">Delivery</s-text>
                      <input
                        type="text"
                        value={rule.settings?.eta_label_delivery || "Delivered"}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_label_delivery: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                        placeholder="Delivered"
                        maxLength={10}
                      />
                    </label>
                  </div>

                  <s-text style={{ fontWeight: 600, marginTop: 12 }}>Stage Icons</s-text>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <label>
                      <s-text size="small">Order</s-text>
                      <select
                        value={getEffectiveIcon(rule.settings?.eta_order_icon, "clipboard-document-check")}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_order_icon: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <optgroup label="Preset">
                          <option value="truck">Truck</option>
                          <option value="truck-v2">Truck v2</option>
                          <option value="clock">Clock</option>
                          <option value="home">Home</option>
                          <option value="pin">Pin</option>
                          <option value="pin-v2">Pin v2</option>
                          <option value="gift">Gift</option>
                          <option value="shopping-bag">Shopping Bag</option>
                          <option value="shopping-bag-v2">Shopping Bag v2</option>
                          <option value="shopping-cart">Shopping Cart</option>
                          <option value="shopping-cart-v2">Shopping Cart v2</option>
                          <option value="shopping-basket">Shopping Basket</option>
                          <option value="clipboard-document-check">Clipboard</option>
                          <option value="clipboard-v2">Clipboard v2</option>
                          <option value="bullet">Bullet</option>
                          <option value="checkmark">Checkmark (badge)</option>
                        </optgroup>
                        {configuredCustomIcons.length > 0 && (
                          <optgroup label="Custom">
                            {configuredCustomIcons.map((icon) => (
                              <option key={icon.value} value={icon.value}>{icon.label}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>
                    <label>
                      <s-text size="small">Shipping</s-text>
                      <select
                        value={getEffectiveIcon(rule.settings?.eta_shipping_icon, "truck")}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_shipping_icon: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <optgroup label="Preset">
                          <option value="truck">Truck</option>
                          <option value="truck-v2">Truck v2</option>
                          <option value="clock">Clock</option>
                          <option value="home">Home</option>
                          <option value="pin">Pin</option>
                          <option value="pin-v2">Pin v2</option>
                          <option value="gift">Gift</option>
                          <option value="shopping-bag">Shopping Bag</option>
                          <option value="shopping-bag-v2">Shopping Bag v2</option>
                          <option value="shopping-cart">Shopping Cart</option>
                          <option value="shopping-cart-v2">Shopping Cart v2</option>
                          <option value="shopping-basket">Shopping Basket</option>
                          <option value="clipboard-document-check">Clipboard</option>
                          <option value="clipboard-v2">Clipboard v2</option>
                          <option value="bullet">Bullet</option>
                          <option value="checkmark">Checkmark (badge)</option>
                        </optgroup>
                        {configuredCustomIcons.length > 0 && (
                          <optgroup label="Custom">
                            {configuredCustomIcons.map((icon) => (
                              <option key={icon.value} value={icon.value}>{icon.label}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>
                    <label>
                      <s-text size="small">Delivery</s-text>
                      <select
                        value={getEffectiveIcon(rule.settings?.eta_delivery_icon, "home")}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_delivery_icon: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <optgroup label="Preset">
                          <option value="truck">Truck</option>
                          <option value="truck-v2">Truck v2</option>
                          <option value="clock">Clock</option>
                          <option value="home">Home</option>
                          <option value="pin">Pin</option>
                          <option value="pin-v2">Pin v2</option>
                          <option value="gift">Gift</option>
                          <option value="shopping-bag">Shopping Bag</option>
                          <option value="shopping-bag-v2">Shopping Bag v2</option>
                          <option value="shopping-cart">Shopping Cart</option>
                          <option value="shopping-cart-v2">Shopping Cart v2</option>
                          <option value="shopping-basket">Shopping Basket</option>
                          <option value="clipboard-document-check">Clipboard</option>
                          <option value="clipboard-v2">Clipboard v2</option>
                          <option value="bullet">Bullet</option>
                          <option value="checkmark">Checkmark (badge)</option>
                        </optgroup>
                        {configuredCustomIcons.length > 0 && (
                          <optgroup label="Custom">
                            {configuredCustomIcons.map((icon) => (
                              <option key={icon.value} value={icon.value}>{icon.label}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                    <label>
                      <s-text size="small">Order style</s-text>
                      <select
                        value={getEffectiveIcon(rule.settings?.eta_order_icon, "clipboard-document-check").startsWith("custom-") ? "n/a" : (rule.settings?.eta_order_icon_style || "solid")}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_order_icon_style: e.target.value },
                          };
                          setRules(next);
                        }}
                        disabled={getEffectiveIcon(rule.settings?.eta_order_icon, "clipboard-document-check").startsWith("custom-")}
                        style={{ width: "100%" }}
                      >
                        {getEffectiveIcon(rule.settings?.eta_order_icon, "clipboard-document-check").startsWith("custom-") ? (
                          <option value="n/a">N/A</option>
                        ) : (
                          <>
                            <option value="solid">Solid</option>
                            <option value="outline">Outline</option>
                          </>
                        )}
                      </select>
                    </label>
                    <label>
                      <s-text size="small">Shipping style</s-text>
                      <select
                        value={getEffectiveIcon(rule.settings?.eta_shipping_icon, "truck").startsWith("custom-") ? "n/a" : (rule.settings?.eta_shipping_icon_style || "solid")}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_shipping_icon_style: e.target.value },
                          };
                          setRules(next);
                        }}
                        disabled={getEffectiveIcon(rule.settings?.eta_shipping_icon, "truck").startsWith("custom-")}
                        style={{ width: "100%" }}
                      >
                        {getEffectiveIcon(rule.settings?.eta_shipping_icon, "truck").startsWith("custom-") ? (
                          <option value="n/a">N/A</option>
                        ) : (
                          <>
                            <option value="solid">Solid</option>
                            <option value="outline">Outline</option>
                          </>
                        )}
                      </select>
                    </label>
                    <label>
                      <s-text size="small">Delivery style</s-text>
                      <select
                        value={getEffectiveIcon(rule.settings?.eta_delivery_icon, "home").startsWith("custom-") ? "n/a" : (rule.settings?.eta_delivery_icon_style || "solid")}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_delivery_icon_style: e.target.value },
                          };
                          setRules(next);
                        }}
                        disabled={getEffectiveIcon(rule.settings?.eta_delivery_icon, "home").startsWith("custom-")}
                        style={{ width: "100%" }}
                      >
                        {getEffectiveIcon(rule.settings?.eta_delivery_icon, "home").startsWith("custom-") ? (
                          <option value="n/a">N/A</option>
                        ) : (
                          <>
                            <option value="solid">Solid</option>
                            <option value="outline">Outline</option>
                          </>
                        )}
                      </select>
                    </label>
                  </div>

                  <label style={{ marginTop: 12 }}>
                    <s-text>Icon size: {rule.settings?.eta_icon_size || 36}px</s-text>
                    <input
                      type="range"
                      min="20"
                      max="56"
                      step="4"
                      value={rule.settings?.eta_icon_size || 36}
                      onChange={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          settings: { ...rule.settings, eta_icon_size: parseInt(e.target.value) },
                        };
                        setRules(next);
                      }}
                      style={{ width: "100%" }}
                    />
                  </label>

                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={rule.settings?.eta_use_main_icon_color !== false}
                      onChange={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          settings: {
                            ...rule.settings,
                            eta_use_main_icon_color: e.target.checked
                          },
                        };
                        setRules(next);
                      }}
                    />
                    <s-text>Stage icons use main icon colour</s-text>
                  </label>

                  {rule.settings?.eta_use_main_icon_color === false && (
                    <s-color-field
                      label="Custom icon color"
                      value={rule.settings?.eta_color || "#111827"}
                      onInput={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          settings: { ...rule.settings, eta_color: e.target.value || e.detail?.value },
                        };
                        setRules(next);
                      }}
                      onChange={(e) => {
                        const next = [...rules];
                        next[safeSelectedIndex] = {
                          ...rule,
                          settings: { ...rule.settings, eta_color: e.target.value || e.detail?.value },
                        };
                        setRules(next);
                      }}
                    />
                  )}

                  {/* Border Styling sub-section */}
                  <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 16, display: "grid", gap: 12 }}>
                    <s-heading>Border Styling</s-heading>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label>
                      <s-text>Border thickness (px)</s-text>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={String(rule.settings?.eta_border_width ?? 0)}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_border_width: safeParseNumber(e.target.value, 0, 0) },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      />
                    </label>
                    <label>
                      <s-text>Border radius (px)</s-text>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={String(rule.settings?.eta_border_radius ?? 8)}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_border_radius: safeParseNumber(e.target.value, 8, 0, 50) },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      />
                    </label>
                  </div>

                  <s-color-field
                    label="Border color"
                    value={rule.settings?.eta_border_color || "#e5e7eb"}
                    onInput={(e) => {
                      const next = [...rules];
                      next[safeSelectedIndex] = {
                        ...rule,
                        settings: { ...rule.settings, eta_border_color: e.target.value },
                      };
                      setRules(next);
                    }}
                  />

                  {/* Background color - always visible, independent of border */}
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <s-color-field
                        label="Background color"
                        placeholder="transparent"
                        value={rule.settings?.eta_background_color || ""}
                        onInput={(e) => {
                          const val = e.detail?.value ?? e.target?.value ?? "";
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_background_color: val },
                          };
                          setRules(next);
                        }}
                        onChange={(e) => {
                          const val = e.detail?.value ?? e.target?.value ?? "";
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_background_color: val },
                          };
                          setRules(next);
                        }}
                      />
                    </div>
                    {rule.settings?.eta_background_color && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_background_color: "" },
                          };
                          setRules(next);
                        }}
                        style={{
                          padding: "6px 10px",
                          fontSize: 12,
                          border: "1px solid var(--p-color-border, #e5e7eb)",
                          borderRadius: 4,
                          background: "var(--p-color-bg-surface, #fff)",
                          cursor: "pointer",
                          marginBottom: 4,
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  </div>

                  {/* ETA Text Styling */}
                  <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", marginTop: 8, paddingTop: 12 }}>
                    <s-heading>Text Styling</s-heading>

                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={rule.settings?.override_eta_text_styling === true}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, override_eta_text_styling: e.target.checked },
                          };
                          setRules(next);
                        }}
                      />
                      <s-text>Use custom text styling for this rule</s-text>
                    </label>

                    {rule.settings?.override_eta_text_styling === true && (
                    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                      <div>
                        <s-text size="small" style={{ fontWeight: 600 }}>Labels (Ordered, Shipped, Delivered)</s-text>
                        <s-color-field
                          label="Label color"
                          value={rule.settings?.eta_label_color || "#374151"}
                          onInput={(e) => {
                            const val = e.target.value || e.detail?.value || "#374151";
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: { ...rule.settings, eta_label_color: val },
                            };
                            setRules(next);
                          }}
                          onChange={(e) => {
                            const val = e.target.value || e.detail?.value || "#374151";
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: { ...rule.settings, eta_label_color: val },
                            };
                            setRules(next);
                          }}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <label>
                          <s-text>Label font size: {normalizeEtaLabelFontSize(rule.settings?.eta_label_font_size, 12)}px</s-text>
                          <input
                            type="range"
                            min="10"
                            max="18"
                            step="1"
                            value={normalizeEtaLabelFontSize(rule.settings?.eta_label_font_size, 12)}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, eta_label_font_size: parseInt(e.target.value) },
                              };
                              setRules(next);
                            }}
                            style={{ width: "100%" }}
                          />
                        </label>
                        <label>
                          <s-text>Label font weight</s-text>
                          <select
                            value={rule.settings?.eta_label_font_weight || "semibold"}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, eta_label_font_weight: e.target.value },
                              };
                              setRules(next);
                            }}
                            style={{ width: "100%" }}
                          >
                            <option value="normal">Normal</option>
                            <option value="bold">Bold</option>
                          </select>
                        </label>
                      </div>

                      <div style={{ marginTop: 8 }}>
                        <s-text size="small" style={{ fontWeight: 600 }}>Dates (Jan 20, Jan 21-24)</s-text>
                        <s-color-field
                          label="Date color"
                          value={rule.settings?.eta_date_color || "#6b7280"}
                          onInput={(e) => {
                            const val = e.target.value || e.detail?.value || "#6b7280";
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: { ...rule.settings, eta_date_color: val },
                            };
                            setRules(next);
                          }}
                          onChange={(e) => {
                            const val = e.target.value || e.detail?.value || "#6b7280";
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: { ...rule.settings, eta_date_color: val },
                            };
                            setRules(next);
                          }}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <label>
                          <s-text>Date font size: {normalizeEtaDateFontSize(rule.settings?.eta_date_font_size, 11)}px</s-text>
                          <input
                            type="range"
                            min="10"
                            max="18"
                            step="1"
                            value={normalizeEtaDateFontSize(rule.settings?.eta_date_font_size, 11)}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, eta_date_font_size: parseInt(e.target.value) },
                              };
                              setRules(next);
                            }}
                            style={{ width: "100%" }}
                          />
                        </label>
                        <label>
                          <s-text>Date font weight</s-text>
                          <select
                            value={rule.settings?.eta_date_font_weight || "normal"}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, eta_date_font_weight: e.target.value },
                              };
                              setRules(next);
                            }}
                            style={{ width: "100%" }}
                          >
                            <option value="normal">Normal</option>
                            <option value="bold">Bold</option>
                          </select>
                        </label>
                      </div>
                    </div>
                    )}
                  </div>
                  </div>
                  )}
                </div>

                {/* Special Delivery Section */}
                <div
                  style={{
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                    borderRadius: "8px",
                    background: "var(--p-color-bg-surface, #ffffff)",
                    overflow: "hidden",
                    borderLeft: "1px solid var(--p-color-border, #e5e7eb)",
                  }}
                >
                  {/* Header with collapse toggle and enable toggle */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedPanels.special_delivery}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: !collapsedPanels.special_delivery ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedPanels.special_delivery ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    onClick={() => togglePanel('special_delivery')}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        togglePanel('special_delivery');
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                        {collapsedPanels.special_delivery ? <ChevronRightIcon /> : <ChevronDownIcon />}
                      </span>
                      <s-heading>Special Delivery</s-heading>
                    </div>
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <s-text size="small">{rule.settings?.show_special_delivery ? "Enabled" : "Disabled"}</s-text>
                      <input
                        type="checkbox"
                        checked={!!rule.settings?.show_special_delivery}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: {
                              ...rule.settings,
                              show_special_delivery: e.target.checked,
                            },
                          };
                          setRules(next);
                          // Auto-expand when enabled, auto-collapse when disabled
                          if (rule?.id) {
                            const newCollapsed = !e.target.checked;
                            setCollapsedPanels(prev => ({ ...prev, special_delivery: newCollapsed }));
                            setCollapsedState(rule.id, 'special_delivery', newCollapsed);
                          }
                        }}
                      />
                    </label>
                  </div>

                  {/* Content - only show when not collapsed */}
                  {!collapsedPanels.special_delivery && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                    <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                      Display special delivery information for large items, palletised shipments, etc.
                    </s-text>

                    {/* Header input (optional) */}
                    <label>
                      <s-text>Header (optional)</s-text>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                        <span style={{ fontSize: 12 }}>Formatting: **bold**, [link](url)</span>
                        <span title={"**text** = bold text\n[text](url) = clickable link"} style={{ cursor: "help", fontSize: 12 }}>ℹ️</span>
                      </div>
                      <input
                        type="text"
                        value={rule.settings?.special_delivery_header || ""}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, special_delivery_header: e.target.value },
                          };
                          setRules(next);
                        }}
                        maxLength={100}
                        style={{ width: "100%" }}
                        placeholder="e.g. Large Item Delivery"
                      />
                    </label>

                    {/* Message textarea */}
                    <label>
                      <s-text>Message</s-text>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                        <span style={{ fontSize: 12 }}>Formatting: **bold**, [link](url), {"{lb}"}</span>
                        <span title={"**text** = bold text\n[text](url) = clickable link\n{lb} = manual line break"} style={{ cursor: "help", fontSize: 12 }}>ℹ️</span>
                      </div>
                      <textarea
                        value={rule.settings?.special_delivery_message || ""}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, special_delivery_message: e.target.value },
                          };
                          setRules(next);
                        }}
                        maxLength={500}
                        rows={3}
                        style={{ width: "100%", resize: "vertical" }}
                        placeholder="e.g. **Large Item:** This product ships via pallet delivery.{lb}Please ensure access for delivery vehicle."
                      />
                    </label>

                    {/* Icon/Image section */}
                    <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", marginTop: 4, paddingTop: 12 }}>
                      <s-text variant="headingXs" style={{ marginBottom: 8, display: "block" }}>Icon (optional)</s-text>

                      {/* Icon selection dropdown - same options as Messages */}
                      <label style={{ display: "block", marginBottom: 8 }}>
                        <s-text>Select Icon</s-text>
                        <select
                          value={rule.settings?.special_delivery_icon || ""}
                          onChange={(e) => {
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: { ...rule.settings, special_delivery_icon: e.target.value },
                            };
                            setRules(next);
                          }}
                          style={{ width: "100%" }}
                        >
                          <option value="">None</option>
                          <optgroup label="Preset Icons">
                            <option value="truck">Truck</option>
                            <option value="truck-v2">Truck v2</option>
                            <option value="clock">Clock</option>
                            <option value="home">Home</option>
                            <option value="pin">Pin</option>
                            <option value="pin-v2">Pin v2</option>
                            <option value="gift">Gift</option>
                            <option value="shopping-bag">Shopping Bag</option>
                            <option value="shopping-bag-v2">Shopping Bag v2</option>
                            <option value="shopping-cart">Shopping Cart</option>
                            <option value="shopping-cart-v2">Shopping Cart v2</option>
                            <option value="shopping-basket">Shopping Basket</option>
                            <option value="clipboard-document-check">Clipboard</option>
                            <option value="clipboard-v2">Clipboard v2</option>
                            <option value="bullet">Bullet</option>
                            <option value="checkmark">Checkmark (badge)</option>
                          </optgroup>
                          {configuredCustomIcons.length > 0 && (
                            <optgroup label="Custom Icons">
                              {configuredCustomIcons.map((icon) => (
                                <option key={icon.value} value={icon.value}>{icon.label}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>

                      {/* Icon options - only show when icon is selected */}
                      {rule.settings?.special_delivery_icon && (
                        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                          {/* Icon style - only for preset icons */}
                          {!rule.settings.special_delivery_icon.startsWith("custom-") && (
                            <label>
                              <s-text>Icon style</s-text>
                              <select
                                value={rule.settings?.special_delivery_icon_style || "solid"}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_icon_style: e.target.value },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              >
                                <option value="solid">Solid (filled)</option>
                                <option value="outline">Outline</option>
                              </select>
                            </label>
                          )}

                          <label>
                            <s-text>Icon Size: {rule.settings?.special_delivery_icon_size || 24}px</s-text>
                            <input
                              type="range"
                              min="16"
                              max="96"
                              step="8"
                              value={rule.settings?.special_delivery_icon_size || 24}
                              onChange={(e) => {
                                const next = [...rules];
                                next[safeSelectedIndex] = {
                                  ...rule,
                                  settings: { ...rule.settings, special_delivery_icon_size: parseInt(e.target.value) },
                                };
                                setRules(next);
                              }}
                              style={{ width: "100%" }}
                            />
                          </label>

                          <div>
                            <label>
                              <s-text>Vertical alignment</s-text>
                              <select
                                value={rule.settings?.special_delivery_icon_alignment || "top"}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_icon_alignment: e.target.value },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              >
                                <option value="top">Top</option>
                                <option value="center">Center</option>
                                <option value="bottom">Bottom</option>
                              </select>
                            </label>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                              <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                              <span style={{ fontSize: 12 }}>Aligns the shorter element (icon or text) within the row</span>
                            </div>
                          </div>

                          {/* Icon color - for preset icons (always SVG) and custom SVG icons */}
                          {(() => {
                            const iconValue = rule.settings?.special_delivery_icon || "";
                            const isPreset = !iconValue.startsWith("custom-");
                            const isCustomSvg = iconValue.startsWith("custom-") && (() => {
                              const idx = parseInt(iconValue.split("-")[1]) - 1;
                              return globalSettings?.custom_icons?.[idx]?.svg;
                            })();
                            if (!isPreset && !isCustomSvg) return null;
                            return (
                              <>
                                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <input
                                    type="checkbox"
                                    checked={rule.settings?.special_delivery_use_main_icon_color !== false}
                                    onChange={(e) => {
                                      const next = [...rules];
                                      next[safeSelectedIndex] = {
                                        ...rule,
                                        settings: { ...rule.settings, special_delivery_use_main_icon_color: e.target.checked },
                                      };
                                      setRules(next);
                                    }}
                                  />
                                  <s-text>Use main icon color</s-text>
                                </label>
                                {rule.settings?.special_delivery_use_main_icon_color === false && (
                                  <s-color-field
                                    label="SVG icon color"
                                    value={rule.settings?.special_delivery_icon_color || "#111827"}
                                    onInput={(e) => {
                                      const val = e.detail?.value ?? e.target?.value ?? "#111827";
                                      const next = [...rules];
                                      next[safeSelectedIndex] = {
                                        ...rule,
                                        settings: { ...rule.settings, special_delivery_icon_color: val },
                                      };
                                      setRules(next);
                                    }}
                                    onChange={(e) => {
                                      const val = e.detail?.value ?? e.target?.value ?? "#111827";
                                      const next = [...rules];
                                      next[safeSelectedIndex] = {
                                        ...rule,
                                        settings: { ...rule.settings, special_delivery_icon_color: val },
                                      };
                                      setRules(next);
                                    }}
                                  />
                                )}
                              </>
                            );
                          })()}

                        </div>
                      )}
                    </div>

                    {/* Border Styling section */}
                    <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 16, display: "grid", gap: 12 }}>
                      <s-heading>Border Styling</s-heading>

                      {/* Match ETA timeline border - only when ETA enabled with border */}
                      {rule.settings?.show_eta_timeline && (rule.settings?.eta_border_width ?? 0) > 0 && (
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.special_delivery_match_eta_border}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, special_delivery_match_eta_border: e.target.checked },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Match ETA timeline border</s-text>
                        </label>
                      )}

                      {/* Border controls - show when not matching ETA border */}
                      {!rule.settings?.special_delivery_match_eta_border && (
                        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <label>
                              <s-text>Thickness (px)</s-text>
                              <input
                                type="number"
                                min="0"
                                max="10"
                                value={rule.settings?.special_delivery_border_thickness ?? 0}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_border_thickness: Number(e.target.value) },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              />
                            </label>
                            <label>
                              <s-text>Radius (px)</s-text>
                              <input
                                type="number"
                                min="0"
                                value={rule.settings?.special_delivery_border_radius ?? 8}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_border_radius: Number(e.target.value) || 0 },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              />
                            </label>
                          </div>
                          <s-color-field
                            label="Border color"
                            value={rule.settings?.special_delivery_border_color || "#e5e7eb"}
                            onInput={(e) => {
                              const val = e.detail?.value ?? e.target?.value ?? "#e5e7eb";
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, special_delivery_border_color: val },
                              };
                              setRules(next);
                            }}
                            onChange={(e) => {
                              const val = e.detail?.value ?? e.target?.value ?? "#e5e7eb";
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, special_delivery_border_color: val },
                              };
                              setRules(next);
                            }}
                          />
                        </div>
                      )}

                      {/* Background color - always visible, independent of border */}
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <s-color-field
                            label="Background color"
                            placeholder="transparent"
                            value={rule.settings?.special_delivery_background_color || ""}
                            onInput={(e) => {
                              const val = e.detail?.value ?? e.target?.value ?? "";
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, special_delivery_background_color: val },
                              };
                              setRules(next);
                            }}
                            onChange={(e) => {
                              const val = e.detail?.value ?? e.target?.value ?? "";
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, special_delivery_background_color: val },
                              };
                              setRules(next);
                            }}
                          />
                        </div>
                        {rule.settings?.special_delivery_background_color && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, special_delivery_background_color: "" },
                              };
                              setRules(next);
                            }}
                            style={{
                              padding: "6px 10px",
                              fontSize: 12,
                              border: "1px solid var(--p-color-border, #e5e7eb)",
                              borderRadius: 4,
                              background: "var(--p-color-bg-surface, #fff)",
                              cursor: "pointer",
                              marginBottom: 4,
                            }}
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      {/* Match ETA timeline width - only when ETA enabled */}
                      {rule.settings?.show_eta_timeline && (
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.special_delivery_match_eta_width}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              const next = [...rules];
                              // Capture ETA width when enabling to avoid feedback loops
                              const capturedWidth = checked && etaTimelineRef.current
                                ? etaTimelineRef.current.offsetWidth
                                : rule.settings?._captured_special_delivery_eta_width;
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: {
                                  ...rule.settings,
                                  special_delivery_match_eta_width: checked,
                                  _captured_special_delivery_eta_width: capturedWidth,
                                },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Match ETA timeline width</s-text>
                        </label>
                      )}

                      {/* Max width - only when not matching ETA width */}
                      {(!rule.settings?.show_eta_timeline || !rule.settings?.special_delivery_match_eta_width) && (
                        <label>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <s-text>Max width</s-text>
                            <span
                              title="Text wraps within this width."
                              style={{ cursor: "help", fontSize: 12, color: "var(--p-color-text-subdued)" }}
                            >ℹ️</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            value={rule.settings?.special_delivery_max_width ?? 600}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, special_delivery_max_width: Number(e.target.value) || 0 },
                              };
                              setRules(next);
                            }}
                            onBlur={(e) => {
                              const v = Number(e.target.value) || 0;
                              const clamped = v === 0 ? 0 : Math.max(200, v);
                              if (clamped !== v) {
                                const next = [...rules];
                                next[safeSelectedIndex] = {
                                  ...rule,
                                  settings: { ...rule.settings, special_delivery_max_width: clamped },
                                };
                                setRules(next);
                              }
                            }}
                            style={{ width: "100%" }}
                          />
                          <div style={{ display: "grid", gap: 2, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12, marginTop: 4 }}>
                            <span>💡 Set to 0 for no maximum width (block sizes to fit content).</span>
                            <span>💡 Actual width may be limited by container.</span>
                          </div>
                        </label>
                      )}
                    </div>

                    {/* Text Styling section */}
                    <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 16, display: "grid", gap: 12 }}>
                      <s-heading>Text Styling</s-heading>

                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={rule.settings?.special_delivery_override_global_text_styling === true}
                          onChange={(e) => {
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: {
                                ...rule.settings,
                                special_delivery_override_global_text_styling: e.target.checked,
                                special_delivery_override_global_header_styling: e.target.checked
                              },
                            };
                            setRules(next);
                          }}
                        />
                        <s-text>Use custom text styling for this rule</s-text>
                      </label>

                      {rule.settings?.special_delivery_override_global_text_styling === true && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginLeft: 24 }}>
                          {/* Header */}
                          <div style={{ display: "grid", gap: 8 }}>
                            <s-text size="small" style={{ fontWeight: 600 }}>Header (optional)</s-text>
                            <div>
                              <s-text size="small">Color</s-text>
                              <s-color-field
                                label=""
                                value={rule.settings?.special_delivery_header_color || "#111827"}
                                onInput={(e) => {
                                  const val = e.detail?.value ?? e.target?.value ?? "#111827";
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_header_color: val },
                                  };
                                  setRules(next);
                                }}
                                onChange={(e) => {
                                  const val = e.detail?.value ?? e.target?.value ?? "#111827";
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_header_color: val },
                                  };
                                  setRules(next);
                                }}
                              />
                            </div>
                            <div>
                              <s-text size="small">Font size ({normalizeFontSize(rule.settings?.special_delivery_header_font_size, 16)}px)</s-text>
                              <input
                                type="range"
                                min="12"
                                max="24"
                                step="1"
                                value={normalizeFontSize(rule.settings?.special_delivery_header_font_size, 16)}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_header_font_size: parseInt(e.target.value) },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              />
                            </div>
                            <div>
                              <s-text size="small">Font weight</s-text>
                              <select
                                value={rule.settings?.special_delivery_header_font_weight || "semibold"}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_header_font_weight: e.target.value },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              >
                                <option value="normal">Normal</option>
                                <option value="bold">Bold</option>
                              </select>
                            </div>
                          </div>
                          {/* Message */}
                          <div style={{ display: "grid", gap: 8 }}>
                            <s-text size="small" style={{ fontWeight: 600 }}>Message</s-text>
                            <div>
                              <s-text size="small">Color</s-text>
                              <s-color-field
                                label=""
                                value={rule.settings?.special_delivery_text_color || "#374151"}
                                onInput={(e) => {
                                  const val = e.detail?.value ?? e.target?.value ?? "#374151";
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_text_color: val },
                                  };
                                  setRules(next);
                                }}
                                onChange={(e) => {
                                  const val = e.detail?.value ?? e.target?.value ?? "#374151";
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_text_color: val },
                                  };
                                  setRules(next);
                                }}
                              />
                            </div>
                            <div>
                              <s-text size="small">Font size ({normalizeFontSize(rule.settings?.special_delivery_font_size, 16)}px)</s-text>
                              <input
                                type="range"
                                min="10"
                                max="22"
                                step="1"
                                value={normalizeFontSize(rule.settings?.special_delivery_font_size, 16)}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_font_size: parseInt(e.target.value) },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              />
                            </div>
                            <div>
                              <s-text size="small">Font weight</s-text>
                              <select
                                value={rule.settings?.special_delivery_font_weight || "normal"}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_font_weight: e.target.value },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%" }}
                              >
                                <option value="normal">Normal</option>
                                <option value="bold">Bold</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      )}

                      <label style={{ marginTop: 8 }}>
                        <s-text size="small">Text alignment</s-text>
                        <select
                          value={rule.settings?.special_delivery_text_alignment || "left"}
                          onChange={(e) => {
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              settings: { ...rule.settings, special_delivery_text_alignment: e.target.value },
                            };
                            setRules(next);
                          }}
                          style={{ width: "100%", marginTop: 4 }}
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  )}
                </div>

                {fetcher.data?.error && (
                  <s-text style={{ color: "var(--p-color-text-critical, #dc2626)" }}>
                    {fetcher.data.error}
                  </s-text>
                )}
              </>
              )}

              {/* No rule selected message (only when no styling panel is open) */}
              {!rule && !showTypographyPanel && !showAlignmentPanel && (
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, background: "var(--p-color-bg-surface, #ffffff)" }}>
                  <s-heading>No rule selected</s-heading>
                  <s-text>Add a rule to edit.</s-text>
                </div>
              )}
            </div>

            {/* RIGHT column: preview, rules list */}
            <div className="dib-right-column" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              {/* Preview */}
              {/* Load Google Font for preview if custom font is selected for messages */}
              {globalSettings?.use_theme_font === false &&
               globalSettings?.custom_font_family &&
               ["Assistant", "Roboto", "Open Sans", "Montserrat", "Poppins", "Lato", "Nunito Sans", "Source Sans Pro", "Oswald", "Raleway", "Inter"].some(gf => globalSettings.custom_font_family.includes(gf)) && (
                <link
                  href={`https://fonts.googleapis.com/css2?family=${(globalSettings.custom_font_family.match(/'([^']+)'/)?.[1] || globalSettings.custom_font_family).replace(/ /g, '+')}:wght@400;500;600;700&display=swap`}
                  rel="stylesheet"
                />
              )}
              {/* Load Google Font for ETA Timeline if custom font is selected */}
              {globalSettings?.eta_use_theme_font === false &&
               globalSettings?.eta_custom_font_family &&
               ["Assistant", "Roboto", "Open Sans", "Montserrat", "Poppins", "Lato", "Nunito Sans", "Source Sans Pro", "Oswald", "Raleway", "Inter"].some(gf => globalSettings.eta_custom_font_family.includes(gf)) && (
                <link
                  href={`https://fonts.googleapis.com/css2?family=${(globalSettings.eta_custom_font_family.match(/'([^']+)'/)?.[1] || globalSettings.eta_custom_font_family).replace(/ /g, '+')}:wght@400;500;600;700&display=swap`}
                  rel="stylesheet"
                />
              )}
              {/* Load Google Font for Special Delivery if custom font is selected */}
              {globalSettings?.special_delivery_use_theme_font === false &&
               globalSettings?.special_delivery_custom_font_family &&
               ["Assistant", "Roboto", "Open Sans", "Montserrat", "Poppins", "Lato", "Nunito Sans", "Source Sans Pro", "Oswald", "Raleway", "Inter"].some(gf => globalSettings.special_delivery_custom_font_family.includes(gf)) && (
                <link
                  href={`https://fonts.googleapis.com/css2?family=${(globalSettings.special_delivery_custom_font_family.match(/'([^']+)'/)?.[1] || globalSettings.special_delivery_custom_font_family).replace(/ /g, '+')}:wght@400;500;600;700&display=swap`}
                  rel="stylesheet"
                />
              )}
              {/* Load preview theme font if Messages, ETA Timeline, or Special Delivery is using theme font */}
              {(globalSettings?.use_theme_font !== false || globalSettings?.eta_use_theme_font !== false || globalSettings?.special_delivery_use_theme_font !== false) &&
               globalSettings?.eta_preview_theme_font &&
               globalSettings.eta_preview_theme_font.includes("'") && (
                <link
                  href={`https://fonts.googleapis.com/css2?family=${globalSettings.eta_preview_theme_font.match(/'([^']+)'/)?.[1]?.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`}
                  rel="stylesheet"
                />
              )}

              <div
                className="dib-preview-section"
                style={{
                  border: "1px solid var(--p-color-border, #e5e7eb)",
                  borderRadius: "8px",
                  padding: "16px",
                  background: "var(--p-color-bg-surface, #ffffff)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  overflow: "hidden",
                }}
              >
                <s-heading>Preview</s-heading>
                {/* Link hover styles for preview */}
                <style>{`
                  .dib-link-preview {
                    color: ${globalSettings?.link_color || "#2563eb"};
                    text-decoration: ${globalSettings?.link_decoration || "underline"};
                    transition: all 0.15s ease;
                  }
                  .dib-link-preview:hover {
                    color: ${globalSettings?.link_hover_color || "#1d4ed8"};
                    text-decoration: ${globalSettings?.link_hover_decoration || "underline"};
                    opacity: ${globalSettings?.link_hover_opacity ?? 1};
                  }
                `}</style>

                <div style={{ minHeight: 80, overflow: "hidden", overscrollBehavior: "contain", padding: "8px 0", minWidth: 0 }}>
                  <div
                    style={{
                      minHeight: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      justifyContent: "center",
                      gap: 12,
                    }}
                  >
                    {rule ? (
                      <div
                        style={{
                          display: "inline-grid",
                          gap: 12,
                          width: "100%",
                          maxWidth: "100%",
                          justifyItems: "start",
                          alignItems: "start",
                        }}
                      >
                        {/* Only show messages container if there's content */}
                        {(rule.settings?.show_messages !== false &&
                            (rule.settings?.message_line_1 || rule.settings?.message_line_2 || rule.settings?.message_line_3)) && (
                        <div
                          style={{
                            // Border: match ETA border or use direct thickness (0 = no border)
                            boxSizing: "border-box",
                            padding: `${globalSettings?.messages_padding_vertical ?? 10}px ${globalSettings?.messages_padding_right ?? 12}px ${globalSettings?.messages_padding_vertical ?? 10}px ${globalSettings?.messages_padding_left ?? 8}px`,
                            borderStyle: "solid",
                            borderWidth: (rule.settings?.show_eta_timeline && rule.settings?.match_eta_border)
                              ? Number(rule.settings?.eta_border_width ?? 1)
                              : Number(rule.settings?.border_thickness ?? 0),
                            borderColor: rule.settings?.show_eta_timeline && rule.settings?.match_eta_border
                              ? (rule.settings?.eta_border_color ?? "#e5e7eb")
                              : (rule.settings?.border_color ?? "#e5e7eb"),
                            borderRadius: Number(rule.settings?.show_eta_timeline && rule.settings?.match_eta_border
                              ? (rule.settings?.eta_border_radius ?? 8)
                              : (rule.settings?.border_radius ?? 8)),
                            backgroundColor: rule.settings?.background_color || "transparent",
                            // Width constraint: match ETA timeline width or use custom max_width
                            // Case 1: match_eta_width ON - force exact ETA width (content wraps)
                            // Case 2: max_width = 0 - fit to content
                            // Case 3: max_width > 0 - expand TO that width, but never smaller than content
                            ...(rule.settings?.match_eta_width && rule.settings?.show_eta_timeline && etaTimelineWidth > 0
                              ? {
                                  width: etaTimelineWidth,
                                  minWidth: etaTimelineWidth,
                                  maxWidth: etaTimelineWidth,
                                }
                              : rule.settings?.max_width && rule.settings.max_width > 0
                                ? { width: `min(${rule.settings.max_width}px, 100%)`, minWidth: "fit-content" }
                                : { width: "fit-content" }),
                            justifySelf: "start",
                            alignSelf: "start",
                            overflowWrap: "break-word",
                            display: rule.settings?.icon_layout === "single" ? "flex" : "grid",
                            gap: rule.settings?.icon_layout === "single"
                              ? (rule.settings?.show_icon !== false ? (globalSettings?.messages_single_icon_gap ?? 12) : 0)
                              : 6,
                            alignItems: rule.settings?.icon_layout === "single" ? "center" : "stretch",
                            fontSize: rule.settings?.override_global_text_styling
                              ? `${normalizeFontSize(rule.settings?.font_size, 16)}px`
                              : globalSettings?.use_theme_text_styling === false
                                ? `${normalizeFontSize(globalSettings?.font_size, 16)}px`
                                : `${Math.round((globalSettings?.eta_preview_font_size_scale || 100) * 1.2)}%`,
                            fontWeight: rule.settings?.override_global_text_styling
                              ? getTextFontWeight(rule.settings?.font_weight)
                              : globalSettings?.use_theme_text_styling === false
                                ? getTextFontWeight(globalSettings?.font_weight)
                                : globalSettings?.eta_preview_font_weight || "normal",
                            color: rule.settings?.override_global_text_styling
                              ? (rule.settings?.text_color || "#374151")
                              : globalSettings?.use_theme_text_styling === false
                                ? (globalSettings?.text_color || "#374151")
                                : "inherit",
                            fontFamily: globalSettings?.use_theme_font === false && globalSettings?.custom_font_family
                              ? globalSettings.custom_font_family
                              : globalSettings?.eta_preview_theme_font || "'Assistant', sans-serif",
                          }}
                        >
                          {rule.settings?.icon_layout === "single" && rule.settings?.show_icon !== false && (
                            <span
                              style={{
                                width: normalizeSingleIconSize(rule.settings?.single_icon_size, 36),
                                height: normalizeSingleIconSize(rule.settings?.single_icon_size, 36),
                                flexShrink: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: rule.settings?.icon_color ?? "#111827",
                                fontSize: normalizeSingleIconSize(rule.settings?.single_icon_size, 36),
                              }}
                              aria-hidden="true"
                            >
                              {(() => {
                                const effectiveIcon = getEffectiveIcon(rule.settings?.icon, "truck");
                                if (effectiveIcon.startsWith("custom-")) {
                                  const customIdx = parseInt(effectiveIcon.split("-")[1]) - 1;
                                  const customIcon = globalSettings?.custom_icons?.[customIdx];
                                  if (customIcon?.svg) {
                                    return (
                                      <span
                                        dangerouslySetInnerHTML={{ __html: customIcon.svg }}
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          maxWidth: "100%",
                                          maxHeight: "100%",
                                          display: "block",
                                        }}
                                      />
                                    );
                                  } else if (customIcon?.url) {
                                    return (
                                      <img
                                        src={customIcon.url}
                                        alt=""
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          maxWidth: "100%",
                                          maxHeight: "100%",
                                          objectFit: "contain",
                                          display: "block",
                                        }}
                                      />
                                    );
                                  }
                                  return null;
                                } else {
                                  const svg = getIconSvg(effectiveIcon, rule.settings?.icon_style || "solid");
                                  return svg ? (
                                    <span
                                      dangerouslySetInnerHTML={{ __html: svg }}
                                      style={{
                                        width: normalizeSingleIconSize(rule.settings?.single_icon_size, 36),
                                        height: normalizeSingleIconSize(rule.settings?.single_icon_size, 36),
                                        display: "block",
                                      }}
                                    />
                                  ) : null;
                                }
                              })()}
                              </span>
                            )}
                            <div style={{ display: "grid", gap: "0.35em", flex: 1 }}>
                              {rule.settings?.show_messages !== false ? (
                                <>
                                  {rule.settings?.message_line_1 && (
                                    <PreviewLine rule={rule} globalSettings={globalSettings}>
                                      {parseMarkdown(replaceDatePlaceholders(rule.settings.message_line_1, rule, globalSettings, shopCurrency, countdownText)).map((seg, i) =>
                                        renderSegment(seg, i, 'l1', globalSettings)
                                      )}
                                    </PreviewLine>
                                  )}

                                  {rule.settings?.message_line_2 && (
                                    <PreviewLine rule={rule} globalSettings={globalSettings}>
                                      {parseMarkdown(replaceDatePlaceholders(rule.settings.message_line_2, rule, globalSettings, shopCurrency, countdownText)).map((seg, i) =>
                                        renderSegment(seg, i, 'l2', globalSettings)
                                      )}
                                    </PreviewLine>
                                  )}

                                  {rule.settings?.message_line_3 && (
                                    <PreviewLine rule={rule} globalSettings={globalSettings}>
                                      {parseMarkdown(replaceDatePlaceholders(rule.settings.message_line_3, rule, globalSettings, shopCurrency, countdownText)).map((seg, i) =>
                                        renderSegment(seg, i, 'l3', globalSettings)
                                      )}
                                    </PreviewLine>
                                  )}
                                </>
                              ) : null}
                            </div>
                        </div>
                        )}

                        {/* ETA Timeline Preview - shown below messages when enabled */}
                        {rule.settings?.show_eta_timeline && (
                          <div ref={etaTimelineRef} style={{ display: "inline-block" }}>
                            <ETATimelinePreview rule={rule} globalSettings={globalSettings} />
                          </div>
                        )}

                        {/* Special Delivery Preview - shown below timeline when enabled */}
                        {rule.settings?.show_special_delivery && rule.settings?.special_delivery_message && (
                          <div style={{ width: "100%", maxWidth: "100%" }}>
                            {(() => {
                              const message = rule.settings.special_delivery_message || "";

                              // Get icon - preset or custom
                              const iconSelection = rule.settings.special_delivery_icon || "";
                              const iconStyle = rule.settings.special_delivery_icon_style || "solid";
                              const isPresetIcon = iconSelection && !iconSelection.startsWith("custom-");
                              const customIconIdx = iconSelection.startsWith("custom-") ? parseInt(iconSelection.split("-")[1]) - 1 : -1;
                              const customIcon = customIconIdx >= 0 ? (globalSettings?.custom_icons || [])[customIconIdx] : null;
                              const svgCode = isPresetIcon ? getIconSvg(iconSelection, iconStyle) : (customIcon?.svg || "");
                              const imageUrl = customIcon?.url || "";

                              const sizePx = rule.settings.special_delivery_icon_size || 24;
                              const iconColor = rule.settings.special_delivery_use_main_icon_color !== false
                                ? (rule.settings.icon_color || "#111827")
                                : (rule.settings.special_delivery_icon_color || "#111827");
                              const parsedMessage = parseMarkdown(message);

                              // Header styling
                              const header = rule.settings.special_delivery_header || "";
                              const parsedHeader = parseMarkdown(header);
                              const headerGap = globalSettings?.special_delivery_header_gap ?? 4;
                              const headerColor = rule.settings.special_delivery_override_global_header_styling
                                ? (rule.settings.special_delivery_header_color || "#111827")
                                : globalSettings?.special_delivery_header_use_theme_text_styling === false
                                  ? (globalSettings?.special_delivery_header_text_color || "#111827")
                                  : "inherit";
                              const headerFontSize = rule.settings.special_delivery_override_global_header_styling
                                ? `${normalizeFontSize(rule.settings.special_delivery_header_font_size, 16)}px`
                                : globalSettings?.special_delivery_header_use_theme_text_styling === false
                                  ? `${normalizeFontSize(globalSettings?.special_delivery_header_font_size, 16)}px`
                                  : "inherit";
                              const headerFontWeight = rule.settings.special_delivery_override_global_header_styling
                                ? getTextFontWeight(rule.settings.special_delivery_header_font_weight)
                                : globalSettings?.special_delivery_header_use_theme_text_styling === false
                                  ? getTextFontWeight(globalSettings?.special_delivery_header_font_weight)
                                  : globalSettings?.eta_preview_font_weight || "normal";

                              // Border styling
                              const showBorder = (rule.settings.special_delivery_border_thickness ?? 0) > 0 ||
                                (rule.settings.show_eta_timeline && rule.settings.special_delivery_match_eta_border);
                              const borderThickness = rule.settings.special_delivery_match_eta_border
                                ? (rule.settings.eta_border_width ?? 1)
                                : (rule.settings.special_delivery_border_thickness ?? 0);
                              const borderColor = rule.settings.special_delivery_match_eta_border
                                ? (rule.settings.eta_border_color ?? "#e5e7eb")
                                : (rule.settings.special_delivery_border_color ?? "#e5e7eb");
                              const borderRadius = rule.settings.special_delivery_match_eta_border
                                ? (rule.settings.eta_border_radius ?? 8)
                                : (rule.settings.special_delivery_border_radius ?? 8);
                              const backgroundColor = rule.settings.special_delivery_background_color || "";

                              // Width constraint: match ETA timeline width or use custom max_width
                              const matchEtaWidth = rule.settings.special_delivery_match_eta_width && rule.settings.show_eta_timeline && etaTimelineWidth > 0;
                              const sdMaxWidth = rule.settings.special_delivery_max_width;
                              // For special delivery: match ETA = exact width (with box-sizing), max_width > 0 = expand TO width, 0 = fit content
                              const widthStyle = matchEtaWidth
                                ? { width: etaTimelineWidth, minWidth: etaTimelineWidth, maxWidth: etaTimelineWidth, boxSizing: "border-box" }
                                : (sdMaxWidth > 0 ? { width: `min(${sdMaxWidth}px, 100%)` } : { width: "fit-content" });

                              // Text styling
                              const textColor = rule.settings.special_delivery_override_global_text_styling
                                ? (rule.settings.special_delivery_text_color || "#374151")
                                : globalSettings?.special_delivery_use_theme_text_styling === false
                                  ? (globalSettings?.special_delivery_text_color || "#374151")
                                  : "inherit";
                              const fontSize = rule.settings.special_delivery_override_global_text_styling
                                ? `${normalizeFontSize(rule.settings.special_delivery_font_size, 16)}px`
                                : globalSettings?.special_delivery_use_theme_text_styling === false
                                  ? `${normalizeFontSize(globalSettings?.special_delivery_font_size, 16)}px`
                                  : `${Math.round((globalSettings?.eta_preview_font_size_scale || 100) * 1.2)}%`;
                              const fontWeight = rule.settings.special_delivery_override_global_text_styling
                                ? getTextFontWeight(rule.settings.special_delivery_font_weight)
                                : globalSettings?.special_delivery_use_theme_text_styling === false
                                  ? getTextFontWeight(globalSettings?.special_delivery_font_weight)
                                  : globalSettings?.eta_preview_font_weight || "normal";
                              const fontFamily = globalSettings?.special_delivery_use_theme_font === false
                                ? (globalSettings?.special_delivery_custom_font_family || "inherit")
                                : globalSettings?.eta_preview_theme_font || "'Assistant', sans-serif";
                              const lineHeight = globalSettings?.special_delivery_line_height ?? 1.4;
                              const textAlignment = rule.settings.special_delivery_text_alignment || "left";

                              const iconAlignment = { top: "flex-start", center: "center", bottom: "flex-end" }[rule.settings.special_delivery_icon_alignment] || "flex-start";

                              // Spacing settings
                              const paddingL = globalSettings?.special_delivery_padding_left ?? 8;
                              const paddingR = globalSettings?.special_delivery_padding_right ?? 12;
                              const paddingV = globalSettings?.special_delivery_padding_vertical ?? 10;
                              const iconGap = globalSettings?.special_delivery_icon_gap ?? 12;

                              return (
                                <div style={{
                                  display: "inline-flex",
                                  alignItems: iconAlignment,
                                  gap: iconGap,
                                  boxSizing: "border-box",
                                  overflowWrap: "break-word",
                                  wordBreak: "break-word",
                                  padding: `${paddingV}px ${paddingR}px ${paddingV}px ${paddingL}px`,
                                  ...(showBorder ? {
                                    border: `${borderThickness}px solid ${borderColor}`,
                                    borderRadius: borderRadius,
                                  } : {}),
                                  ...(backgroundColor ? { backgroundColor, borderRadius: borderRadius } : {}),
                                  // Width constraint: match ETA or custom max_width
                                  ...widthStyle,
                                  color: textColor,
                                  fontSize,
                                  fontWeight,
                                  fontFamily,
                                  lineHeight,
                                }}>
                                  {/* SVG icon (inherits color) */}
                                  {svgCode && (
                                    <div
                                      style={{ width: sizePx, height: sizePx, flexShrink: 0, color: iconColor }}
                                      dangerouslySetInnerHTML={{ __html: svgCode }}
                                    />
                                  )}
                                  {/* Image URL (no color inheritance) */}
                                  {!svgCode && imageUrl && (
                                    <img
                                      src={imageUrl}
                                      alt=""
                                      style={{ width: sizePx, height: sizePx, flexShrink: 0, objectFit: "contain" }}
                                    />
                                  )}
                                  <div style={{ minWidth: 0, textAlign: textAlignment, display: "flex", flexDirection: "column", gap: header ? headerGap : 0 }}>
                                    {/* Header - only render if populated */}
                                    {header && (
                                      <div style={{
                                        color: headerColor,
                                        fontSize: headerFontSize,
                                        fontWeight: headerFontWeight,
                                      }}>
                                        {parsedHeader.map((seg, i) => renderSegment(seg, i, 'sph', globalSettings))}
                                      </div>
                                    )}
                                    {/* Message */}
                                    <div>
                                      {parsedMessage.map((seg, i) => renderSegment(seg, i, 'sp', globalSettings))}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    ) : (
                      <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                        Select a rule to see preview.
                      </s-text>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Storefront appearance may vary slightly based on theme settings.</span>
                </div>
              </div>

              {/* Rules list */}
              <div
                className="dib-rules-list"
                style={{
                  border: "1px solid var(--p-color-border, #e5e7eb)",
                  borderRadius: "8px",
                  background: "var(--p-color-bg-surface, #ffffff)",
                  overflow: "hidden",
                }}
              >
                {/* Fixed header */}
                <div
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--p-color-border, #e5e7eb)",
                    background: "var(--p-color-bg-surface, #ffffff)",
                  }}
                >
                  <s-heading>Rules (priority order)</s-heading>
                </div>

                {/* Scrollable content */}
                <div
                  className="dib-rules-list-content"
                  style={{
                    padding: "16px",
                    display: "grid",
                    gap: 10,
                  }}
                >
                {rules.length === 0 ? (
                  <s-text>No rules yet. Click &quot;Add rule&quot;.</s-text>
                ) : (
                  <div
                    role="listbox"
                    aria-label="Rules list"
                    tabIndex={0}
                    style={{
                      display: "grid",
                      gap: 6,
                      paddingRight: 4,
                    }}
                    onKeyDown={(e) => {
                      if (e.target.tagName === "INPUT") return; // Don't interfere with input navigation
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        flushPendingEdits();
                        setSelectedIndex(Math.min(rules.length - 1, safeSelectedIndex + 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        flushPendingEdits();
                        setSelectedIndex(Math.max(0, safeSelectedIndex - 1));
                      }
                    }}
                  >
                    {rules.map((r, idx) => {
                      const isSelected = idx === safeSelectedIndex;
                      const isValid = ruleHasMatch(r);

                      return (
                        <div
                          key={r.id}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={isSelected ? 0 : -1}
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            padding: "6px 8px",
                            borderWidth: 2,
                            borderStyle: "solid",
                            borderRadius: 8,
                            cursor: "pointer",
                            borderColor: isSelected
                              ? "var(--p-color-border-emphasis, #111827)"
                              : "var(--p-color-border, #e5e7eb)",
                            background: isSelected
                              ? "var(--p-color-bg-surface-active, #eef2ff)"
                              : "var(--p-color-bg-surface, #ffffff)",
                            opacity: 1,
                            outline: "none",
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.boxShadow = "0 0 0 2px var(--p-color-border-emphasis, #3b82f6)";
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.boxShadow = "none";
                          }}
                          onClick={() => {
                            flushPendingEdits();
                            setSelectedIndex(idx);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              if (e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON") {
                                e.preventDefault();
                                flushPendingEdits();
                                setSelectedIndex(idx);
                              }
                            }
                          }}
                        >
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={idx + 1}
                            aria-label={`Rule ${idx + 1} position, enter number to reorder`}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.target.select();
                            }}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (!isNaN(val)) {
                                const newPos = Math.max(0, Math.min(rules.length - 1, val - 1));
                                if (newPos !== idx) {
                                  moveRule(idx, newPos);
                                }
                              }
                            }}
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 4,
                              border: "1px solid var(--p-color-border, #e5e7eb)",
                              background: isSelected ? "var(--p-color-bg-surface-selected, #e0f2fe)" : "var(--p-color-bg-surface-secondary, #f9fafb)",
                              fontSize: 12,
                              fontWeight: 700,
                              textAlign: "center",
                              color: "var(--p-color-text, #374151)",
                              flexShrink: 0,
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                            <div style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}>
                              <span style={{ fontWeight: 700 }}>
                                {r.name || `Rule ${idx + 1}`}
                              </span>
                            </div>
                            {r.match?.stock_status && r.match.stock_status !== "any" && (
                              <div style={{ color: "var(--p-color-text-subdued, #6b7280)", fontSize: "11px" }}>
                                Stock: {r.match.stock_status.replace(/_/g, " ")}
                              </div>
                            )}
                            {!isValid && (
                              <div style={{ color: "var(--p-color-text-critical, #dc2626)", fontSize: "11px" }}>
                                ⚠ Missing product match
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <s-button
                              size="small"
                              variant="tertiary"
                              onClick={(e) => { e.stopPropagation(); moveRule(idx, idx - 1); }}
                              disabled={idx === 0}
                              title="Move up"
                            >
                              ↑
                            </s-button>
                            <s-button
                              size="small"
                              variant="tertiary"
                              onClick={(e) => { e.stopPropagation(); moveRule(idx, idx + 1); }}
                              disabled={idx === rules.length - 1}
                              title="Move down"
                            >
                              ↓
                            </s-button>
                            <s-button
                              size="small"
                              variant="tertiary"
                              onClick={(e) => { e.stopPropagation(); deleteRuleWithUndo(idx); }}
                              disabled={rules.length <= 1}
                              title="Delete rule"
                              onMouseEnter={() => setHoverDeleteIdx(idx)}
                              onMouseLeave={() => setHoverDeleteIdx(null)}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke={hoverDeleteIdx === idx ? "var(--p-color-icon-critical, #dc2626)" : "currentColor"}
                                strokeWidth="1.75"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                width="16"
                                height="16"
                                aria-hidden="true"
                                style={{ transition: "stroke 120ms ease" }}
                              >
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M19 6l-1 14H6L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                              </svg>
                            </s-button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {lastDeleted && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 12px",
                      background: "var(--p-color-bg-caution-subdued, #fef3c7)",
                      borderRadius: 4,
                    }}
                  >
                    <s-text>
                      Rule &quot;{lastDeleted.rule.name}&quot; deleted.
                    </s-text>
                    <s-button size="small" onClick={undoDelete}>
                      Undo
                    </s-button>
                  </div>
                )}
                </div>
              </div>
            </div>
          </div>
        </s-box>
      </s-section>
    </s-page>
    </>
  );
}

// ============================================================================
// ERROR BOUNDARY
// ============================================================================

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

// ============================================================================
// HEADERS EXPORT
// ============================================================================

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
