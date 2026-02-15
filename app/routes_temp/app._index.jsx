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
import { getSingleIconSize, getTextFontSize, getTextFontWeight } from "../utils/styling";
import { getIconSvg, getConfiguredCustomIcons } from "../utils/icons";
import { getHolidaysForYear } from "../utils/holidays";
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
    eta_match_messages_font: false,
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
  };
}

// ============================================================================
// LOADER - Fetch config and settings from Shopify metafields
// ============================================================================

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  // Pass shop domain for caching (skips API calls if recently verified)
  await ensureDeliveryRulesDefinition(admin, shopDomain);

  // Fetch both config and settings metafields
  const res = await admin.graphql(GET_SHOP_DELIVERY_DATA, {
    variables: {
      namespace: METAFIELD_NAMESPACE,
      configKey: CONFIG_KEY,
      settingsKey: SETTINGS_KEY,
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

  return {
    config: configMf?.value ?? JSON.stringify({ version: 1, rules: [] }),
    globalSettings,
    shopId, // Pass to client for action
    shopCurrency, // For preview formatting
  };
};

// ============================================================================
// ACTION - Save config to Shopify metafields
// ============================================================================

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const configRaw = formData.get("config");
  let shopId = formData.get("shopId");

  if (typeof configRaw !== "string" || !configRaw.trim()) {
    return { ok: false, error: "Config is empty." };
  }

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
  const validatedConfig = validation.data;

  // Use shopId from form data if provided, otherwise fetch (fallback for edge cases)
  if (!shopId) {
    const shopRes = await admin.graphql(GET_SHOP_ID);
    const shopJson = await shopRes.json();
    if (shopJson.errors) {
      return { ok: false, error: friendlyError(shopJson.errors, "Unable to save. Please try again or contact support if the issue persists.") };
    }
    shopId = shopJson?.data?.shop?.id;
  }

  const setRes = await admin.graphql(SET_METAFIELDS_MINIMAL, {
    variables: {
      metafields: [
        {
          ownerId: shopId,
          namespace: METAFIELD_NAMESPACE,
          key: CONFIG_KEY,
          type: "json",
          value: JSON.stringify(validatedConfig),
        },
      ],
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

// Parse **bold** markdown syntax into segments
function parseMarkdownBold(text) {
  if (!text) return [];
  const parts = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    parts.push({ text: match[1], bold: true });
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

// Replace {arrival}, {express}, and {countdown} placeholders with computed strings for preview
function replaceDatePlaceholders(text, rule, globalSettings, shopCurrency = 'GBP') {
  if (!text) return text;

  // Format currency helper
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: shopCurrency,
    }).format(amount);
  };

  // Handle free delivery placeholders
  if (text.includes('{threshold}')) {
    const thresholdAmount = (globalSettings?.fd_threshold || 5000) / 100;
    text = text.replace(/{threshold}/g, formatCurrency(thresholdAmount));
  }
  if (text.includes('{remaining}')) {
    text = text.replace(/{remaining}/g, formatCurrency(24.01));
  }
  if (text.includes('{cart_total}')) {
    text = text.replace(/{cart_total}/g, formatCurrency(25.99));
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
    // For preview, always show static placeholder (storefront has live updates)
    text = text.replace('{countdown}', '02h 14m');
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

  // Migrate old cart_message format (none/line1/line2/custom) to simple text
  if (settings.cart_message === "custom" && settings.cart_message_custom) {
    result.cart_message = settings.cart_message_custom;
  } else if (["none", "line1", "line2"].includes(settings.cart_message)) {
    result.cart_message = "";
  }
  delete result.cart_message_custom;

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
      show_border: false,
      border_thickness: 1,
      border_color: "#e5e7eb",
      border_radius: 8,
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

      // Cart message (text to show under items in cart, use {arrival} for delivery date)
      cart_message: "",

      // Special Delivery block
      show_special_delivery: false,
      special_delivery_message: "",
      special_delivery_icon_size: "medium",
      special_delivery_icon_color: "#111827",
      special_delivery_use_main_icon_color: true,
      // Special Delivery - Border Styling
      special_delivery_show_border: false,
      special_delivery_border_thickness: 1,
      special_delivery_border_color: "#e5e7eb",
      special_delivery_border_radius: 8,
      special_delivery_match_eta_border: false,
      special_delivery_match_eta_width: false,
      special_delivery_max_width: 600,
      // Special Delivery - Text Styling (per-rule override)
      special_delivery_override_global_text_styling: false,
      special_delivery_text_color: "#374151",
      special_delivery_font_size: "medium",
      special_delivery_font_weight: "normal",
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
  const { config, globalSettings, shopId, shopCurrency } = useLoaderData();

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
  // eslint-disable-next-line no-unused-vars
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
  const initialDraftRef = useRef(JSON.stringify(initialConfig));

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

  // Auto-save after 2 seconds of inactivity
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    // Don't auto-save if unchanged from initial load
    if (draft === initialDraftRef.current) return;

    // Don't auto-save while already saving
    if (fetcher.state !== "idle") return;

    autoSaveTimerRef.current = setTimeout(() => {
      fetcher.submit({ config: draft, shopId }, { method: "POST" });
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [draft, shopId, fetcher.state]);

  // Track previous fetcher state to detect save completion
  const prevFetcherStateRef = useRef(fetcher.state);

  // Update initial ref after successful save (so we don't re-save the same data)
  useEffect(() => {
    const wasSubmitting = prevFetcherStateRef.current === "submitting" || prevFetcherStateRef.current === "loading";
    const isNowIdle = fetcher.state === "idle";
    prevFetcherStateRef.current = fetcher.state;

    // Only process when we just finished a submission
    if (!wasSubmitting || !isNowIdle) return;

    if (fetcher.data?.ok === true) {
      initialDraftRef.current = draft;
    }
  }, [fetcher.state, fetcher.data, draft]);

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

  // Handle selectRule query parameter (from wizard redirect)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const selectRuleId = searchParams.get("selectRule");
    if (selectRuleId && rules.length > 0) {
      const ruleIndex = rules.findIndex(r => r.id === selectRuleId);
      if (ruleIndex !== -1) {
        setSelectedIndex(ruleIndex);
      }
      // Clear the param from URL after handling
      searchParams.delete("selectRule");
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

  // Profile management functions (UI not yet implemented)
  // eslint-disable-next-line no-unused-vars
  const addProfile = () => {
    const newProfile = defaultProfile(`Profile ${profiles.length + 1}`);
    setProfiles([...profiles, newProfile], newProfile.id);
  };

  // eslint-disable-next-line no-unused-vars
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

  // Profile management function (UI not yet implemented)
  // eslint-disable-next-line no-unused-vars
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

    // Auto-expire undo after 30s (longer for profiles since they contain multiple rules)
    undoProfileTimerRef.current = setTimeout(() => {
      setLastDeletedProfile(null);
      undoProfileTimerRef.current = null;
    }, 30000);
  };

  // Profile management function (UI not yet implemented)
  // eslint-disable-next-line no-unused-vars
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

  // Profile management function (UI not yet implemented)
  // eslint-disable-next-line no-unused-vars
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

    // auto-expire undo after 6s
    undoTimerRef.current = setTimeout(() => {
      setLastDeleted(null);
      undoTimerRef.current = null;
    }, 6000);
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
      <s-page heading="Editor">
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
                gap: 16,
                gridTemplateColumns: "1fr 1fr",
                alignItems: "start",
              }}
            >
            {/* Top action bar - spans both columns */}
            <div style={{
              gridColumn: "1 / -1",
              border: "1px solid var(--p-color-border, #e5e7eb)",
              borderRadius: "8px",
              padding: "16px",
              background: "var(--p-color-bg-surface, #ffffff)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
            }}>
              {/* Rule name input - LEFT */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: "400px" }}>
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
                    fontSize: "20px",
                    fontWeight: 600,
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                    borderRadius: "4px",
                    padding: "4px 8px",
                    width: "100%",
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
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  width="16"
                  height="16"
                  style={{ flexShrink: 0, opacity: 0.5 }}
                  aria-hidden="true"
                >
                  <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                  <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                </svg>
              </div>

              {/* Save button with floppy disk indicator - RIGHT */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                    fetcher.submit({ config: draft, shopId }, { method: "POST" });
                  }}
                >
                  Save
                </s-button>
              </div>
            </div>

            {/* Action row - spans both columns (NOT sticky) */}
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {/* Collapse/Expand buttons - LEFT (only when rule selected) */}
              {rule ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <s-button
                    onClick={() => {
                      if (!rule?.id) return;
                      const allCollapsed = {
                        product_matching: true,
                        dispatch_settings: true,
                        countdown_messages: true,
                        countdown_icon: true,
                        eta_timeline: true,
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
                      };
                      setCollapsedPanels(smartCollapse);
                      Object.entries(smartCollapse).forEach(([key, val]) => {
                        setCollapsedState(rule.id, key, val);
                      });
                    }}
                  >
                    Show enabled
                  </s-button>
                </div>
              ) : (
                <div />
              )}
              {/* Profile + Add rule + Copy rule - RIGHT */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                <s-button onClick={addRule}>
                  Add rule
                </s-button>
                <s-button onClick={duplicateRule}>
                  Copy rule
                </s-button>
              </div>
            </div>

            {/* LEFT column: editor (inputs, main work area) */}
            {rule ? (
              <div style={{ display: "grid", gap: 12 }}>

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

                      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={rule.match?.is_fallback || false}
                          onChange={(e) => {
                            const next = [...rules];
                            next[safeSelectedIndex] = {
                              ...rule,
                              match: { ...rule.match, is_fallback: e.target.checked },
                            };
                            setRules(next);
                          }}
                        />
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <s-text>Fallback rule — used when no other rules apply.</s-text>
                          <span style={{ fontSize: "11px", color: "var(--p-color-text-subdued, #6b7280)" }}>
                            For best results, place fallback rules at the bottom of your rule list.
                          </span>
                        </div>
                      </label>

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
                      <s-text size="small">{rule.settings?.show_messages ? "Enabled" : "Disabled"}</s-text>
                    </label>
                  </div>

                  {/* Content - only show when not collapsed */}
                  {!collapsedPanels.countdown_messages && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                    <div style={{ display: "grid", gap: 2, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12 }}>
                      <span>💡 Use &#123;countdown&#125; for live countdown timer.</span>
                      <span>💡 Use &#123;arrival&#125; for estimated delivery date.</span>
                      <span>💡 Use &#123;express&#125; for next-day delivery date.</span>
                      <span>💡 Use &#123;lb&#125; for manual line breaks.</span>
                      <span>💡 Use **double asterisks** for bold text.</span>
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

                    <label>
                      <s-text>Cart message</s-text>
                      <input
                        type="text"
                        value={rule.settings?.cart_message || ""}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, cart_message: e.target.value },
                          };
                          setRules(next);
                        }}
                        maxLength={100}
                        style={{ width: "100%" }}
                        placeholder="Shows under items in cart"
                      />
                    </label>

                    {/* Border Styling sub-section */}
                    <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 16, display: "grid", gap: 12 }}>
                      <s-heading>Border Styling</s-heading>

                      {/* Only show "Match ETA border" when ETA Timeline is enabled AND has border enabled */}
                      {rule.settings?.show_eta_timeline && rule.settings?.show_eta_border !== false && (
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

                      {/* Hide "Show border" when Match ETA timeline border is selected (and ETA has border) */}
                      {!(rule.settings?.show_eta_timeline && rule.settings?.show_eta_border !== false && rule.settings?.match_eta_border) && (
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.show_border}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, show_border: e.target.checked },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Show border</s-text>
                        </label>
                      )}

                      {(!rule.settings?.show_eta_timeline || rule.settings?.show_eta_border === false || !rule.settings?.match_eta_border) && rule.settings?.show_border && (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <label>
                              <s-text>Border thickness (px)</s-text>
                              <input
                                type="number"
                                min="1"
                                max="10"
                                value={String(rule.settings?.border_thickness ?? 1)}
                                onChange={(e) => {
                                  const n = Math.max(1, Number(e.target.value) || 1);
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: {
                                      ...rule.settings,
                                      border_thickness: Number.isFinite(n) ? n : 1,
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
                          <s-text>Max width</s-text>
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
                            <s-text>Font size</s-text>
                            <select
                              value={rule.settings?.font_size || "medium"}
                              onChange={(e) => {
                                const next = [...rules];
                                next[safeSelectedIndex] = {
                                  ...rule,
                                  settings: { ...rule.settings, font_size: e.target.value },
                                };
                                setRules(next);
                              }}
                              style={{ width: "100%" }}
                            >
                              <option value="xsmall">X-Small (12px)</option>
                              <option value="small">Small (14px)</option>
                              <option value="medium">Medium (16px)</option>
                              <option value="large">Large (18px)</option>
                              <option value="xlarge">X-Large (20px)</option>
                            </select>
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
                              <option value="medium">Medium</option>
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
                      <s-text size="small">{rule.settings?.show_icon !== false ? "Enabled" : "Disabled"}</s-text>
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
                        <option value="clock">Clock</option>
                        <option value="home">Home</option>
                        <option value="pin">Pin</option>
                        <option value="gift">Gift</option>
                        <option value="shopping-bag">Shopping bag</option>
                        <option value="shopping-cart">Shopping cart</option>
                        <option value="clipboard-document-check">Clipboard</option>
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

                  {rule.settings?.icon_layout !== "single" && (
                    <label>
                      <s-text>Icon vertical align</s-text>
                      <select
                        value={rule.settings?.icon_vertical_align || "top"}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, icon_vertical_align: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                      </select>
                    </label>
                  )}

                  {rule.settings?.icon_layout === "single" && (
                    <label>
                      <s-text>Single icon size</s-text>
                      <select
                        value={rule.settings?.single_icon_size || "medium"}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, single_icon_size: e.target.value },
                          };
                          setRules(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                        <option value="x-large">Extra Large</option>
                        <option value="xx-large">XX Large</option>
                      </select>
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
                                show_eta_border: rule.settings?.show_border !== false,
                                eta_border_width: rule.settings?.border_thickness ?? 1,
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
                      <s-text size="small">{rule.settings?.show_eta_timeline ? "Enabled" : "Disabled"}</s-text>
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
                          <option value="clock">Clock</option>
                          <option value="home">Home</option>
                          <option value="pin">Pin</option>
                          <option value="gift">Gift</option>
                          <option value="shopping-bag">Shopping bag</option>
                          <option value="shopping-cart">Shopping cart</option>
                          <option value="clipboard-document-check">Clipboard</option>
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
                          <option value="clock">Clock</option>
                          <option value="home">Home</option>
                          <option value="pin">Pin</option>
                          <option value="gift">Gift</option>
                          <option value="shopping-bag">Shopping bag</option>
                          <option value="shopping-cart">Shopping cart</option>
                          <option value="clipboard-document-check">Clipboard</option>
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
                          <option value="clock">Clock</option>
                          <option value="home">Home</option>
                          <option value="pin">Pin</option>
                          <option value="gift">Gift</option>
                          <option value="shopping-bag">Shopping bag</option>
                          <option value="shopping-cart">Shopping cart</option>
                          <option value="clipboard-document-check">Clipboard</option>
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

                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={rule.settings?.show_eta_border !== false}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, show_eta_border: e.target.checked },
                          };
                          setRules(next);
                        }}
                      />
                      <s-text>Show border</s-text>
                    </label>

                  {rule.settings?.show_eta_border !== false && (
                    <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label>
                      <s-text>Border thickness (px)</s-text>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={String(rule.settings?.eta_border_width ?? 1)}
                        onChange={(e) => {
                          const next = [...rules];
                          next[safeSelectedIndex] = {
                            ...rule,
                            settings: { ...rule.settings, eta_border_width: safeParseNumber(e.target.value, 1, 1) },
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
                    </>
                  )}
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
                          <s-text>Label font size</s-text>
                          <select
                            value={rule.settings?.eta_label_font_size || "small"}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, eta_label_font_size: e.target.value },
                              };
                              setRules(next);
                            }}
                            style={{ width: "100%" }}
                          >
                            <option value="xsmall">X-Small (11px)</option>
                            <option value="small">Small (12px)</option>
                            <option value="medium">Medium (14px)</option>
                          </select>
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
                            <option value="normal">Normal (400)</option>
                            <option value="medium">Medium (500)</option>
                            <option value="semibold">Semi-bold (600)</option>
                            <option value="bold">Bold (700)</option>
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
                          <s-text>Date font size</s-text>
                          <select
                            value={rule.settings?.eta_date_font_size || "xsmall"}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, eta_date_font_size: e.target.value },
                              };
                              setRules(next);
                            }}
                            style={{ width: "100%" }}
                          >
                            <option value="xxsmall">XX-Small (10px)</option>
                            <option value="xsmall">X-Small (11px)</option>
                            <option value="small">Small (12px)</option>
                          </select>
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
                            <option value="normal">Normal (400)</option>
                            <option value="medium">Medium (500)</option>
                            <option value="semibold">Semi-bold (600)</option>
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
                      <s-text size="small">{rule.settings?.show_special_delivery ? "Enabled" : "Disabled"}</s-text>
                    </label>
                  </div>

                  {/* Content - only show when not collapsed */}
                  {!collapsedPanels.special_delivery && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                    <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                      Display special delivery information for large items, palletised shipments, etc.
                    </s-text>

                    {/* Message textarea */}
                    <label>
                      <s-text>Message</s-text>
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
                    <div style={{ display: "grid", gap: 2, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 11 }}>
                      <span>Use **double asterisks** for bold text.</span>
                      <span>Use {"{lb}"} for line breaks.</span>
                    </div>

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
                            <option value="clock">Clock</option>
                            <option value="home">Home</option>
                            <option value="pin">Pin</option>
                            <option value="gift">Gift</option>
                            <option value="shopping-bag">Shopping bag</option>
                            <option value="shopping-cart">Shopping cart</option>
                            <option value="clipboard-document-check">Clipboard</option>
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
                                      const next = [...rules];
                                      next[safeSelectedIndex] = {
                                        ...rule,
                                        settings: { ...rule.settings, special_delivery_icon_color: e.target.value },
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
                      {rule.settings?.show_eta_timeline && rule.settings?.show_eta_border !== false && (
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

                      {/* Show border checkbox - hide when matching ETA */}
                      {!(rule.settings?.show_eta_timeline && rule.settings?.show_eta_border !== false && rule.settings?.special_delivery_match_eta_border) && (
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!rule.settings?.special_delivery_show_border}
                            onChange={(e) => {
                              const next = [...rules];
                              next[safeSelectedIndex] = {
                                ...rule,
                                settings: { ...rule.settings, special_delivery_show_border: e.target.checked },
                              };
                              setRules(next);
                            }}
                          />
                          <s-text>Show border</s-text>
                        </label>
                      )}

                      {/* Border controls - show when border enabled and not matching ETA */}
                      {rule.settings?.special_delivery_show_border && !rule.settings?.special_delivery_match_eta_border && (
                        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <label>
                              <s-text>Thickness (px)</s-text>
                              <input
                                type="number"
                                min="1"
                                max="10"
                                value={rule.settings?.special_delivery_border_thickness ?? 1}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_border_thickness: Number(e.target.value) || 1 },
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
                              const val = e.detail?.value || e.target?.value;
                              if (val) {
                                const next = [...rules];
                                next[safeSelectedIndex] = {
                                  ...rule,
                                  settings: { ...rule.settings, special_delivery_border_color: val },
                                };
                                setRules(next);
                              }
                            }}
                          />
                        </div>
                      )}

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
                          <s-text>Max width</s-text>
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
                              settings: { ...rule.settings, special_delivery_override_global_text_styling: e.target.checked },
                            };
                            setRules(next);
                          }}
                        />
                        <s-text>Use custom text styling for this rule</s-text>
                      </label>

                      {rule.settings?.special_delivery_override_global_text_styling === true && (
                        <div style={{ display: "grid", gap: 12 }}>
                          <s-color-field
                            label="Text color"
                            value={rule.settings?.special_delivery_text_color || "#374151"}
                            onInput={(e) => {
                              const val = e.detail?.value || e.target?.value;
                              if (val) {
                                const next = [...rules];
                                next[safeSelectedIndex] = {
                                  ...rule,
                                  settings: { ...rule.settings, special_delivery_text_color: val },
                                };
                                setRules(next);
                              }
                            }}
                          />
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <label>
                              <s-text>Font size</s-text>
                              <select
                                value={rule.settings?.special_delivery_font_size || "medium"}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[safeSelectedIndex] = {
                                    ...rule,
                                    settings: { ...rule.settings, special_delivery_font_size: e.target.value },
                                  };
                                  setRules(next);
                                }}
                                style={{ width: "100%", marginTop: 4 }}
                              >
                                <option value="xsmall">X-Small (12px)</option>
                                <option value="small">Small (14px)</option>
                                <option value="medium">Medium (16px)</option>
                                <option value="large">Large (18px)</option>
                                <option value="xlarge">X-Large (20px)</option>
                              </select>
                            </label>
                            <label>
                              <s-text>Font weight</s-text>
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
                                style={{ width: "100%", marginTop: 4 }}
                              >
                                <option value="normal">Normal (400)</option>
                                <option value="medium">Medium (500)</option>
                                <option value="semibold">Semi-bold (600)</option>
                                <option value="bold">Bold (700)</option>
                              </select>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                </div>

                {fetcher.data?.error && (
                  <s-text style={{ color: "var(--p-color-text-critical, #dc2626)" }}>
                    {fetcher.data.error}
                  </s-text>
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <s-heading>No rule selected</s-heading>
                <s-text>Add a rule to edit.</s-text>
              </div>
            )}

            {/* RIGHT column: preview, rules list */}
            <div className="dib-right-column" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              {/* Preview */}
              {/* Load Google Font for preview if custom font is selected for messages */}
              {globalSettings?.use_theme_font === false &&
               globalSettings?.custom_font_family &&
               globalSettings.custom_font_family.includes("'") &&
               !globalSettings.custom_font_family.includes("Times") &&
               !globalSettings.custom_font_family.includes("Courier") &&
               !globalSettings.custom_font_family.includes("Trebuchet") && (
                <link
                  href={`https://fonts.googleapis.com/css2?family=${globalSettings.custom_font_family.match(/'([^']+)'/)?.[1]?.replace(/ /g, '+')}:wght@400;500;600&display=swap`}
                  rel="stylesheet"
                />
              )}
              {/* Load Google Font for ETA Timeline if custom font is selected */}
              {globalSettings?.eta_use_theme_font === false &&
               !globalSettings?.eta_match_messages_font &&
               globalSettings?.eta_custom_font_family &&
               globalSettings.eta_custom_font_family.includes("'") &&
               !globalSettings.eta_custom_font_family.includes("Times") &&
               !globalSettings.eta_custom_font_family.includes("Courier") &&
               !globalSettings.eta_custom_font_family.includes("Trebuchet") && (
                <link
                  href={`https://fonts.googleapis.com/css2?family=${globalSettings.eta_custom_font_family.match(/'([^']+)'/)?.[1]?.replace(/ /g, '+')}:wght@400;500;600&display=swap`}
                  rel="stylesheet"
                />
              )}
              {/* Load preview theme font for ETA Timeline if using theme font */}
              {globalSettings?.eta_use_theme_font !== false &&
               globalSettings?.eta_preview_theme_font &&
               globalSettings.eta_preview_theme_font.includes("'") &&
               !globalSettings.eta_preview_theme_font.includes("Times") &&
               !globalSettings.eta_preview_theme_font.includes("Courier") &&
               !globalSettings.eta_preview_theme_font.includes("Trebuchet") && (
                <link
                  href={`https://fonts.googleapis.com/css2?family=${globalSettings.eta_preview_theme_font.match(/'([^']+)'/)?.[1]?.replace(/ /g, '+')}:wght@400;500;600&display=swap`}
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
                            // When match_eta_border is true, always show border (ignore show_border)
                            boxSizing: "border-box",
                            padding: (rule.settings?.show_eta_timeline && rule.settings?.match_eta_border) || rule.settings?.show_border ? "10px 12px" : 0,
                            borderStyle: "solid",
                            borderWidth: (rule.settings?.show_eta_timeline && rule.settings?.match_eta_border)
                              ? Number(rule.settings?.eta_border_width ?? 1)
                              : (rule.settings?.show_border
                                  ? Number(rule.settings?.border_thickness ?? 1)
                                  : 0),
                            borderColor: rule.settings?.show_eta_timeline && rule.settings?.match_eta_border
                              ? (rule.settings?.eta_border_color ?? "#e5e7eb")
                              : (rule.settings?.border_color ?? "#e5e7eb"),
                            borderRadius: Number(rule.settings?.show_eta_timeline && rule.settings?.match_eta_border
                              ? (rule.settings?.eta_border_radius ?? 8)
                              : (rule.settings?.border_radius ?? 8)),
                            // Width constraint: match ETA timeline width or use custom max_width
                            // Case 1: match_eta_width ON - force exact ETA width (content wraps)
                            // Case 2: max_width = 0 - fit to content
                            // Case 3: max_width > 0 - expand TO that width
                            ...(rule.settings?.match_eta_width && rule.settings?.show_eta_timeline && etaTimelineWidth > 0
                              ? {
                                  width: etaTimelineWidth,
                                  minWidth: etaTimelineWidth,
                                  maxWidth: etaTimelineWidth,
                                }
                              : rule.settings?.max_width && rule.settings.max_width > 0
                                ? { width: `min(${rule.settings.max_width}px, 100%)` }
                                : { width: "fit-content" }),
                            justifySelf: "start",
                            alignSelf: "start",
                            overflowWrap: "break-word",
                            display: rule.settings?.icon_layout === "single" ? "flex" : "grid",
                            gap: rule.settings?.icon_layout === "single"
                              ? (rule.settings?.show_icon !== false ? 12 : 0)
                              : 6,
                            alignItems: rule.settings?.icon_layout === "single" ? "center" : "stretch",
                            fontSize: rule.settings?.override_global_text_styling
                              ? getTextFontSize(rule.settings?.font_size)
                              : globalSettings?.use_theme_text_styling === false
                                ? getTextFontSize(globalSettings?.font_size)
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
                                width: getSingleIconSize(rule.settings?.single_icon_size),
                                height: getSingleIconSize(rule.settings?.single_icon_size),
                                flexShrink: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: rule.settings?.icon_color ?? "#111827",
                                fontSize: getSingleIconSize(rule.settings?.single_icon_size),
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
                                        width: getSingleIconSize(rule.settings?.single_icon_size),
                                        height: getSingleIconSize(rule.settings?.single_icon_size),
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
                                      {parseMarkdownBold(replaceDatePlaceholders(rule.settings.message_line_1, rule, globalSettings, shopCurrency)).map((seg, i) =>
                                        seg.bold ? <strong key={i}>{renderWithLineBreaks(seg.text, `l1-${i}`)}</strong> : <span key={i}>{renderWithLineBreaks(seg.text, `l1-${i}`)}</span>
                                      )}
                                    </PreviewLine>
                                  )}

                                  {rule.settings?.message_line_2 && (
                                    <PreviewLine rule={rule} globalSettings={globalSettings}>
                                      {parseMarkdownBold(replaceDatePlaceholders(rule.settings.message_line_2, rule, globalSettings, shopCurrency)).map((seg, i) =>
                                        seg.bold ? <strong key={i}>{renderWithLineBreaks(seg.text, `l2-${i}`)}</strong> : <span key={i}>{renderWithLineBreaks(seg.text, `l2-${i}`)}</span>
                                      )}
                                    </PreviewLine>
                                  )}

                                  {rule.settings?.message_line_3 && (
                                    <PreviewLine rule={rule} globalSettings={globalSettings}>
                                      {parseMarkdownBold(replaceDatePlaceholders(rule.settings.message_line_3, rule, globalSettings, shopCurrency)).map((seg, i) =>
                                        seg.bold ? <strong key={i}>{renderWithLineBreaks(seg.text, `l3-${i}`)}</strong> : <span key={i}>{renderWithLineBreaks(seg.text, `l3-${i}`)}</span>
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
                                ? (globalSettings?.icon_color || "#111827")
                                : (rule.settings.special_delivery_icon_color || "#111827");
                              const parsedMessage = parseMarkdownBold(message);

                              // Border styling
                              const showBorder = rule.settings.special_delivery_show_border ||
                                (rule.settings.show_eta_timeline && rule.settings.special_delivery_match_eta_border);
                              const borderThickness = rule.settings.special_delivery_match_eta_border
                                ? (rule.settings.eta_border_width ?? 1)
                                : (rule.settings.special_delivery_border_thickness ?? 1);
                              const borderColor = rule.settings.special_delivery_match_eta_border
                                ? (rule.settings.eta_border_color ?? "#e5e7eb")
                                : (rule.settings.special_delivery_border_color ?? "#e5e7eb");
                              const borderRadius = rule.settings.special_delivery_match_eta_border
                                ? (rule.settings.eta_border_radius ?? 8)
                                : (rule.settings.special_delivery_border_radius ?? 8);

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
                                ? getTextFontSize(rule.settings.special_delivery_font_size)
                                : globalSettings?.special_delivery_use_theme_text_styling === false
                                  ? getTextFontSize(globalSettings?.special_delivery_font_size)
                                  : "inherit";
                              const fontWeight = rule.settings.special_delivery_override_global_text_styling
                                ? getTextFontWeight(rule.settings.special_delivery_font_weight)
                                : globalSettings?.special_delivery_use_theme_text_styling === false
                                  ? getTextFontWeight(globalSettings?.special_delivery_font_weight)
                                  : "inherit";
                              const fontFamily = globalSettings?.special_delivery_use_theme_font === false
                                ? (globalSettings?.special_delivery_match_messages_font && globalSettings?.custom_font_family
                                    ? globalSettings.custom_font_family
                                    : globalSettings?.special_delivery_custom_font_family || "inherit")
                                : "inherit";

                              const iconAlignment = { top: "flex-start", center: "center", bottom: "flex-end" }[rule.settings.special_delivery_icon_alignment] || "flex-start";

                              return (
                                <div style={{
                                  display: "inline-flex",
                                  alignItems: iconAlignment,
                                  gap: 12,
                                  boxSizing: "border-box",
                                  overflowWrap: "break-word",
                                  wordBreak: "break-word",
                                  ...(showBorder ? {
                                    padding: "10px 12px",
                                    border: `${borderThickness}px solid ${borderColor}`,
                                    borderRadius: borderRadius,
                                  } : {}),
                                  // Width constraint: match ETA or custom max_width
                                  ...widthStyle,
                                  color: textColor,
                                  fontSize,
                                  fontWeight,
                                  fontFamily,
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
                                  <div style={{ minWidth: 0 }}>
                                    {parsedMessage.map((seg, i) => (
                                      seg.bold
                                        ? <strong key={i}>{renderWithLineBreaks(seg.text, `sp-${i}`)}</strong>
                                        : <span key={i}>{renderWithLineBreaks(seg.text, `sp-${i}`)}</span>
                                    ))}
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
                      justifyContent: "space-between",
                      padding: 10,
                      background: "var(--p-color-bg-caution-subdued, #fef3c7)",
                      borderRadius: 6,
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
