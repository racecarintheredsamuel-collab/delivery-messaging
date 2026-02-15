// ============================================================================
// IMPORTS
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getHolidaysForYear, HOLIDAY_DEFINITIONS } from "../utils/holidays.js";
import { CustomDatePicker } from "../components/CustomDatePicker";
import { friendlyError, safeLogError, validateConfig, validateSettings } from "../utils/validation";
import {
  GET_SHOP_DELIVERY_DATA,
  GET_SHOP_ID,
  SET_METAFIELDS,
  SET_METAFIELDS_MINIMAL,
  DELETE_METAFIELDS,
  METAFIELD_NAMESPACE,
  CONFIG_KEY,
  SETTINGS_KEY,
  ICONS_KEY,
} from "../graphql/queries";
import { generateIconsMetafield } from "../utils/icons";

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

function defaultSettings() {
  return {
    // Preview timezone (IANA)
    preview_timezone: "",

    // Business hours
    cutoff_time: "14:00",
    cutoff_time_sat: "",
    cutoff_time_sun: "",
    lead_time: 0,

    // Closed days (business doesn't ship)
    closed_days: ["sat", "sun"],

    // Bank holidays
    bank_holiday_country: "",
    custom_holidays: [],

    // Courier settings (days couriers don't deliver)
    courier_no_delivery_days: ["sat", "sun"],

    // Typography - Messages font
    use_theme_font: true,
    custom_font_family: "",

    // Typography - Messages text styling
    use_theme_text_styling: true,
    text_color: "#374151",
    font_size: "medium",
    font_weight: "normal",

    // Typography - ETA Timeline font
    eta_use_theme_font: true,
    eta_match_messages_font: false,
    eta_custom_font_family: "",
    eta_preview_theme_font: "", // For previewing theme font in admin
    eta_preview_font_size_scale: "", // Font size scale for admin preview (80-130%)
    eta_preview_font_weight: "", // Font weight for admin preview

    // Typography - ETA Timeline text styling (Labels: Ordered, Shipped, Delivered)
    eta_use_theme_text_styling: true,
    eta_label_color: "#374151",
    eta_label_font_size: "small",
    eta_label_font_weight: "semibold",

    // Typography - ETA Timeline date styling (Dates: Jan 20, Jan 21-24)
    eta_date_color: "var(--p-color-text-subdued, #6b7280)",
    eta_date_font_size: "xsmall",
    eta_date_font_weight: "normal",

    // Typography - Special Delivery font
    special_delivery_use_theme_font: true,
    special_delivery_match_messages_font: false,
    special_delivery_custom_font_family: "",

    // Typography - Special Delivery text styling
    special_delivery_use_theme_text_styling: true,
    special_delivery_text_color: "#374151",
    special_delivery_font_size: "medium",
    special_delivery_font_weight: "normal",

    // Block spacing
    messages_margin_top: 0,
    messages_margin_bottom: 0,
    eta_margin_top: 0,
    eta_margin_bottom: 0,
    special_delivery_margin_top: 0,
    special_delivery_margin_bottom: 0,

    // Block alignment (desktop)
    messages_alignment: "left",
    eta_alignment: "left",
    special_delivery_alignment: "left",

    // Block alignment (mobile)
    messages_alignment_mobile: "left",
    eta_alignment_mobile: "left",
    special_delivery_alignment_mobile: "left",

    // Messages container padding
    messages_padding_left: 8,
    messages_padding_right: 12,
    messages_padding_vertical: 10,
    messages_single_icon_gap: 12,

    // Special Delivery spacing
    special_delivery_padding_left: 8,
    special_delivery_padding_right: 12,
    special_delivery_padding_vertical: 10,
    special_delivery_icon_gap: 12,

    // ETA Timeline vertical spacing
    eta_gap_icon_label: 2,
    eta_gap_label_date: 0,

    // Free Delivery Threshold
    fd_enabled: false,
    fd_threshold: 5000,  // In minor units (pence/cents) - £50.00
    fd_message_progress: "Spend {remaining} more for free delivery",
    fd_message_unlocked: "You've unlocked free delivery!",
    fd_message_empty: "",
    fd_show_progress_bar: false,
    fd_progress_bar_color: "#22c55e",
    fd_progress_bar_bg: "#e5e7eb",

    // Free Delivery Exclusions
    fd_exclude_tags: [],
    fd_exclude_handles: [],
    fd_message_excluded: "Free delivery not available for some items in your cart",
  };
}

// ============================================================================
// LOADER - Fetch settings from Shopify metafields
// ============================================================================

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Fetch both settings and config metafields
  const res = await admin.graphql(GET_SHOP_DELIVERY_DATA, {
    variables: {
      namespace: METAFIELD_NAMESPACE,
      configKey: CONFIG_KEY,
      settingsKey: SETTINGS_KEY,
    },
  });

  const json = await res.json();
  if (json.errors) {
    safeLogError("Failed to fetch settings", json.errors);
    throw new Error("Unable to load settings. Please refresh the page.");
  }
  const shopId = json?.data?.shop?.id;
  const settingsMf = json?.data?.shop?.settings;
  const configMf = json?.data?.shop?.config;

  // If no settings exist yet, create default settings and sync icons
  if (!settingsMf?.value) {
    const setRes = await admin.graphql(SET_METAFIELDS, {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: SETTINGS_KEY,
            type: "json",
            value: JSON.stringify(defaultSettings()),
          },
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: ICONS_KEY,
            type: "json",
            value: JSON.stringify(generateIconsMetafield()),
          },
        ],
      },
    });

    const setJson = await setRes.json();
    if (setJson.errors) {
      safeLogError("Failed to set default settings", setJson.errors);
      throw new Error("Unable to initialize settings. Please refresh the page.");
    }
    const errors = setJson?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) safeLogError("Failed to set default settings", errors);
  }

  // Build bank holidays object with country names for the UI
  const bankHolidayCountries = {};
  for (const [code, def] of Object.entries(HOLIDAY_DEFINITIONS)) {
    bankHolidayCountries[code] = { name: def.name };
  }

  return {
    settings: settingsMf?.value ?? JSON.stringify(defaultSettings()),
    config: configMf?.value ?? JSON.stringify({ version: 2, profiles: [{ id: "default", name: "Default", rules: [] }], activeProfileId: "default" }),
    bankHolidayCountries,
    shopId, // Pass to client for action
    isDev: process.env.NODE_ENV === "development",
  };
};

// ============================================================================
// ACTION - Save settings to Shopify metafields
// ============================================================================

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Handle dev reset (only in development mode)
  if (intent === "reset") {
    if (process.env.NODE_ENV !== "development") {
      return { ok: false, error: "Reset only available in development mode." };
    }

    const shopId = formData.get("shopId");
    if (!shopId) {
      return { ok: false, error: "Shop ID not provided." };
    }

    console.log("[DEV RESET] Deleting metafields for shop:", shopId);

    const metafieldsToDelete = [
      { ownerId: shopId, namespace: METAFIELD_NAMESPACE, key: CONFIG_KEY },
      { ownerId: shopId, namespace: METAFIELD_NAMESPACE, key: SETTINGS_KEY },
    ];

    try {
      const res = await admin.graphql(DELETE_METAFIELDS, {
        variables: { metafields: metafieldsToDelete },
      });
      const json = await res.json();

      if (json.errors) {
        console.log("[DEV RESET] GraphQL errors:", json.errors);
        return { ok: false, error: "Failed to delete metafields. Check console." };
      }

      const userErrors = json.data?.metafieldsDelete?.userErrors ?? [];
      if (userErrors.length > 0) {
        console.log("[DEV RESET] User errors:", userErrors);
        return { ok: false, error: userErrors[0].message };
      }

      const deletedMetafields = json.data?.metafieldsDelete?.deletedMetafields ?? [];
      console.log("[DEV RESET] Success - deleted metafields:", deletedMetafields.map(m => m.key));
      return { ok: true, reset: true };
    } catch (error) {
      safeLogError("Failed to reset metafields", error);
      return { ok: false, error: "Failed to reset. Please try again." };
    }
  }

  const settingsRaw = formData.get("settings");
  const configRaw = formData.get("config");
  let shopId = formData.get("shopId");

  const metafieldsToSave = [];

  // Parse and validate settings if provided
  if (settingsRaw && typeof settingsRaw === "string" && settingsRaw.trim()) {
    let parsedSettings;
    try {
      parsedSettings = JSON.parse(settingsRaw);
    } catch (error) {
      safeLogError("Failed to parse settings JSON", error);
      return { ok: false, error: "Settings must be valid JSON." };
    }
    const settingsValidation = validateSettings(parsedSettings);
    if (!settingsValidation.success) {
      safeLogError("Settings validation failed", new Error(settingsValidation.error));
      return { ok: false, error: "Invalid settings format. Please check your data and try again." };
    }
    metafieldsToSave.push({
      namespace: METAFIELD_NAMESPACE,
      key: SETTINGS_KEY,
      type: "json",
      value: JSON.stringify(settingsValidation.data),
    });
  }

  // Parse and validate config if provided
  if (configRaw && typeof configRaw === "string" && configRaw.trim()) {
    let parsedConfig;
    try {
      parsedConfig = JSON.parse(configRaw);
    } catch (error) {
      safeLogError("Failed to parse config JSON", error);
      return { ok: false, error: "Config must be valid JSON." };
    }
    const configValidation = validateConfig(parsedConfig);
    if (!configValidation.success) {
      safeLogError("Config validation failed", new Error(configValidation.error));
      return { ok: false, error: "Invalid configuration format. Please check your data and try again." };
    }
    metafieldsToSave.push({
      namespace: METAFIELD_NAMESPACE,
      key: CONFIG_KEY,
      type: "json",
      value: JSON.stringify(configValidation.data),
    });
  }

  // Always sync built-in icons to metafield (they're used by Liquid blocks)
  metafieldsToSave.push({
    namespace: METAFIELD_NAMESPACE,
    key: ICONS_KEY,
    type: "json",
    value: JSON.stringify(generateIconsMetafield()),
  });

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
    return { ok: false, error: friendlyError(setJson.errors, "Unable to save settings. Please try again.") };
  }
  const errors = setJson?.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    return { ok: false, error: friendlyError(errors, "Unable to save. Please check your settings and try again.") };
  }

  return { ok: true };
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SettingsPage() {
  const { settings: settingsRaw, config: configRaw, bankHolidayCountries, shopId, isDev } = useLoaderData();
  const fetcher = useFetcher();

  const [settings, setSettings] = useState(() => {
    try {
      return JSON.parse(settingsRaw);
    } catch (error) {
      safeLogError("Failed to parse settings, using defaults", error);
      return defaultSettings();
    }
  });

  // Profile management state
  const [config, setConfig] = useState(() => {
    try {
      return JSON.parse(configRaw);
    } catch (error) {
      safeLogError("Failed to parse config, using default profile", error);
      return { version: 2, profiles: [{ id: "default", name: "Default", rules: [] }], activeProfileId: "default" };
    }
  });
  const [profilesLocked, setProfilesLocked] = useState(true);
  const [lastDeletedProfile, setLastDeletedProfile] = useState(null);

  // Derived profile state
  const profiles = config?.profiles ?? [];
  const activeProfileId = config?.activeProfileId || profiles[0]?.id;
  const activeProfile = profiles.length > 0
    ? (profiles.find((p) => p.id === activeProfileId) || profiles[0])
    : null;

  const [saveStatus, setSaveStatus] = useState("");
  const [newCustomHoliday, setNewCustomHoliday] = useState("");
  const [newCustomHolidayLabel, setNewCustomHolidayLabel] = useState("");

  // Auto-save refs
  const autoSaveTimerRef = useRef(null);
  const initialSettingsRef = useRef(JSON.stringify(settings));
  const initialConfigRef = useRef(JSON.stringify(config));

  // Track previous fetcher state to detect save completion
  const prevFetcherStateRef = useRef(fetcher.state);

  // Handle save/reset responses - only when transitioning from loading to idle
  useEffect(() => {
    const wasSubmitting = prevFetcherStateRef.current === "submitting" || prevFetcherStateRef.current === "loading";
    const isNowIdle = fetcher.state === "idle";
    prevFetcherStateRef.current = fetcher.state;

    // Only process when we just finished a submission
    if (!wasSubmitting || !isNowIdle) return;

    if (fetcher.data?.reset === true) {
      if (fetcher.data?.ok === true) {
        window.location.reload();
      } else {
        alert("Reset failed: " + (fetcher.data?.error || "Unknown error"));
      }
      return;
    }
    if (fetcher.data?.ok === true) {
      // Update initial refs so we don't re-save the same data
      initialSettingsRef.current = JSON.stringify(settings);
      initialConfigRef.current = JSON.stringify(config);
      setSaveStatus("Saved!");
      const timer = setTimeout(() => setSaveStatus(""), 2000);
      return () => clearTimeout(timer);
    } else if (fetcher.data?.ok === false) {
      // Error occurred - reset status (error message shown separately)
      setSaveStatus("");
    } else {
      // Completed but no data (shouldn't happen, but fallback)
      setSaveStatus("");
    }
  }, [fetcher.state, fetcher.data, settings, config]);

  // Auto-save settings after 2 seconds of inactivity
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    const settingsChanged = JSON.stringify(settings) !== initialSettingsRef.current;
    const configChanged = JSON.stringify(config) !== initialConfigRef.current;

    // Don't auto-save if unchanged from initial load
    if (!settingsChanged && !configChanged) return;

    // Don't auto-save while already saving
    if (fetcher.state !== "idle") return;

    autoSaveTimerRef.current = setTimeout(() => {
      setSaveStatus("Saving...");
      // Submit both settings and config if either changed
      const submitData = { shopId };
      if (settingsChanged) submitData.settings = JSON.stringify(settings);
      if (configChanged) submitData.config = JSON.stringify(config);
      fetcher.submit(submitData, { method: "POST" });
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [settings, config, shopId, fetcher.state]);

  const handleSave = () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setSaveStatus("Saving...");
    const settingsChanged = JSON.stringify(settings) !== initialSettingsRef.current;
    const configChanged = JSON.stringify(config) !== initialConfigRef.current;
    const submitData = { shopId };
    if (settingsChanged) submitData.settings = JSON.stringify(settings);
    if (configChanged) submitData.config = JSON.stringify(config);
    fetcher.submit(submitData, { method: "POST" });
  };

  const setActiveProfileId = (id) => {
    const newConfig = { ...config, activeProfileId: id };
    setConfig(newConfig);
    // Auto-save will handle saving after 2 seconds
  };

  const addProfile = () => {
    const newId = `profile_${Date.now()}`;
    const newProfile = { id: newId, name: `Profile ${profiles.length + 1}`, rules: [] };
    const newProfiles = [...profiles, newProfile];
    const newConfig = { ...config, profiles: newProfiles, activeProfileId: newId };
    setConfig(newConfig);
    // Auto-save will handle saving after 2 seconds
  };

  const copyProfile = () => {
    if (!activeProfile) return;
    const newId = `profile_${Date.now()}`;
    const copiedProfile = {
      ...JSON.parse(JSON.stringify(activeProfile)),
      id: newId,
      name: `${activeProfile.name} (copy)`,
    };
    const newProfiles = [...profiles, copiedProfile];
    const newConfig = { ...config, profiles: newProfiles, activeProfileId: newId };
    setConfig(newConfig);
    // Auto-save will handle saving after 2 seconds
  };

  const deleteProfileWithUndo = () => {
    if (profiles.length <= 1 || !activeProfile) return;
    const idx = profiles.findIndex((p) => p.id === activeProfileId);
    setLastDeletedProfile({ profile: activeProfile, index: idx });
    const newProfiles = profiles.filter((p) => p.id !== activeProfileId);
    const newActiveId = newProfiles[Math.min(idx, newProfiles.length - 1)]?.id;
    const newConfig = { ...config, profiles: newProfiles, activeProfileId: newActiveId };
    setConfig(newConfig);
    // Auto-save will handle saving after 2 seconds
  };

  const undoDeleteProfile = () => {
    if (!lastDeletedProfile) return;
    const { profile, index } = lastDeletedProfile;
    const newProfiles = [...profiles];
    newProfiles.splice(index, 0, profile);
    const newConfig = { ...config, profiles: newProfiles, activeProfileId: profile.id };
    setConfig(newConfig);
    setLastDeletedProfile(null);
    // Auto-save will handle saving after 2 seconds
  };

  const renameProfile = (newName) => {
    const newProfiles = profiles.map((p) =>
      p.id === activeProfileId ? { ...p, name: newName } : p
    );
    const newConfig = { ...config, profiles: newProfiles };
    setConfig(newConfig);
    // Auto-save will handle saving after 2 seconds
  };

  const saveProfileName = () => {
    // Trigger manual save immediately
    handleSave();
  };

  const toggleClosedDay = (day) => {
    const current = new Set(settings.closed_days || []);
    if (current.has(day)) {
      current.delete(day);
    } else {
      // Prevent closing all 7 days
      if (current.size >= 6) return;
      current.add(day);
    }
    setSettings({ ...settings, closed_days: Array.from(current) });
  };

  const toggleCourierDay = (day) => {
    const current = new Set(settings.courier_no_delivery_days || []);
    if (current.has(day)) {
      current.delete(day);
    } else {
      // Prevent blocking all 7 days (courier must deliver at least one day)
      if (current.size >= 6) return;
      current.add(day);
    }
    setSettings({ ...settings, courier_no_delivery_days: Array.from(current) });
  };

  const addCustomHoliday = () => {
    if (!newCustomHoliday) return;
    const current = settings.custom_holidays || [];
    // Check if date already exists
    if (current.some(h => h.date === newCustomHoliday)) {
      alert("This date is already in your custom holidays list.");
      return;
    }
    const newHoliday = {
      date: newCustomHoliday,
      label: newCustomHolidayLabel || "Custom Holiday",
    };
    setSettings({
      ...settings,
      custom_holidays: [...current, newHoliday].sort((a, b) => a.date.localeCompare(b.date)),
    });
    setNewCustomHoliday("");
    setNewCustomHolidayLabel("");
  };

  const removeCustomHoliday = (dateToRemove) => {
    const current = settings.custom_holidays || [];
    setSettings({
      ...settings,
      custom_holidays: current.filter(h => h.date !== dateToRemove),
    });
  };

  // Get dynamically calculated holidays for display
  const currentYear = new Date().getFullYear();
  const selectedCountry = settings.bank_holiday_country;
  const calculatedHolidays = selectedCountry
    ? getHolidaysForYear(selectedCountry, currentYear)
    : [];

  return (
    <s-page heading="Settings">
      <s-layout style={{ maxWidth: 700 }}>
        <div style={{ display: "grid", gap: 24 }}>

        {/* Top Action Row: Save + Dev Reset */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <s-button variant="primary" onClick={() => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            handleSave();
          }}>
            Save
          </s-button>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            aria-hidden="true"
          >
            <g fill={saveStatus === "Saving..." ? "#22c55e" : "#9ca3af"} fillRule="evenodd" clipRule="evenodd">
              <path d="M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7.414A2 2 0 0 0 20.414 6L18 3.586A2 2 0 0 0 16.586 3zm3 11a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6H8zm1-7V5h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1" />
              <path d="M14 17h-4v-2h4z" />
            </g>
          </svg>
          {isDev && (
            <s-button
              variant="destructive"
              onClick={() => {
                if (window.confirm("⚠️ DEV RESET: Delete ALL config and settings metafields? This will reload the page.")) {
                  fetcher.submit(
                    { intent: "reset", shopId },
                    { method: "POST" }
                  );
                }
              }}
            >
              🧹 Dev Reset
            </s-button>
          )}
        </div>

        {/* Profile Management Section */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            display: "grid",
            gap: 12,
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Profile Management</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
            Manage delivery rule profiles. Each profile can have its own set of rules.
          </s-text>

          {/* Profile buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {profiles.map((p) => {
              const isActive = p.id === activeProfileId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveProfileId(p.id)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    border: "2px solid",
                    borderColor: isActive
                      ? "var(--p-color-border-emphasis, #111827)"
                      : "var(--p-color-border, #e5e7eb)",
                    background: isActive
                      ? "var(--p-color-bg-surface-active, #eef2ff)"
                      : "var(--p-color-bg-surface, #ffffff)",
                    cursor: "pointer",
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 14,
                    fontFamily: "inherit",
                    color: "inherit",
                  }}
                >
                  {p.name}
                </button>
              );
            })}
          </div>

          {/* Profile actions with lock */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setProfilesLocked(!profilesLocked)}
              title={profilesLocked ? "Unlock to edit profiles" : "Lock profile editing"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: profilesLocked ? "var(--p-color-border, #e5e7eb)" : "var(--p-color-border-caution, #f59e0b)",
                background: profilesLocked ? "var(--p-color-bg-surface, #ffffff)" : "var(--p-color-bg-caution-subdued, #fef3c7)",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
                color: "inherit",
              }}
            >
              <span style={{ fontSize: 14 }}>{profilesLocked ? "🔒" : "🔓"}</span>
              <span>{profilesLocked ? "Locked" : "Unlocked"}</span>
            </button>

            <s-button size="small" onClick={addProfile} disabled={profilesLocked}>
              Add profile
            </s-button>
            <s-button size="small" onClick={copyProfile} disabled={profilesLocked}>
              Copy profile
            </s-button>
            <s-button
              size="small"
              variant="tertiary"
              onClick={deleteProfileWithUndo}
              disabled={profilesLocked || profiles.length <= 1}
            >
              Delete profile
            </s-button>
          </div>

          {lastDeletedProfile && (
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
                Profile &quot;{lastDeletedProfile.profile.name}&quot; deleted.
              </s-text>
              <s-button size="small" onClick={undoDeleteProfile}>
                Undo
              </s-button>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <s-text-field
              label="Profile name"
              value={activeProfile?.name || ""}
              onInput={(e) => renameProfile(e.target.value)}
              onBlur={saveProfileName}
              style={{ flex: 1 }}
              disabled={profilesLocked}
            />
          </div>
        </div>

        {/* Business Hours Section */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            display: "grid",
            gap: 12,
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Business Hours</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
            Set your order cutoff times for same-day dispatch
          </s-text>

          <label>
            <s-text>Default cutoff time</s-text>
            <input
              type="time"
              value={settings.cutoff_time || "14:00"}
              onChange={(e) => setSettings({ ...settings, cutoff_time: e.target.value })}
              style={{ width: "100%" }}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <s-text>Saturday cutoff (optional)</s-text>
              <input
                type="time"
                value={settings.cutoff_time_sat || ""}
                onChange={(e) => setSettings({ ...settings, cutoff_time_sat: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>

            <label>
              <s-text>Sunday cutoff (optional)</s-text>
              <input
                type="time"
                value={settings.cutoff_time_sun || ""}
                onChange={(e) => setSettings({ ...settings, cutoff_time_sun: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
          </div>

          <label style={{ marginTop: 4 }}>
            <s-text>Lead time (business days)</s-text>
            <input
              type="number"
              min="0"
              max="30"
              value={settings.lead_time ?? 0}
              onChange={(e) => setSettings({ ...settings, lead_time: Number(e.target.value) || 0 })}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
              <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
              <span style={{ fontSize: 12 }}>Additional business days before shipping (use 0 for same-day shipping).</span>
            </div>
          </label>
        </div>

        {/* Preview Timezone Section */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            display: "grid",
            gap: 12,
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Preview Timezone</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
            Match this to your Shopify store timezone (Settings → Store details) so the admin preview matches your live storefront.
          </s-text>

          <label>
            <s-text>Timezone</s-text>
            <select
              value={settings.preview_timezone || ""}
              onChange={(e) => setSettings({ ...settings, preview_timezone: e.target.value })}
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
          </label>
        </div>

        {/* Closed Days Section */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            display: "grid",
            gap: 12,
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Closed Days</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
            Days your business does not process/ship orders
          </s-text>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              ["mon", "Mon"],
              ["tue", "Tue"],
              ["wed", "Wed"],
              ["thu", "Thu"],
              ["fri", "Fri"],
              ["sat", "Sat"],
              ["sun", "Sun"],
            ].map(([key, label]) => {
              const isSelected = (settings.closed_days || []).includes(key);
              const wouldCloseAll = !isSelected && (settings.closed_days || []).length >= 6;
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
          {(settings.closed_days || []).length >= 6 && (
            <div style={{ color: "var(--p-color-text-critical, #dc2626)", fontSize: 12 }}>
              ⚠️ At least one day must remain open for dispatch.
            </div>
          )}
        </div>

        {/* Courier Delivery Days Section */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            display: "grid",
            gap: 12,
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Courier Non-Delivery Days</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
            Days your courier does not deliver (used for ETA calculations)
          </s-text>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              ["mon", "Mon"],
              ["tue", "Tue"],
              ["wed", "Wed"],
              ["thu", "Thu"],
              ["fri", "Fri"],
              ["sat", "Sat"],
              ["sun", "Sun"],
            ].map(([key, label]) => {
              const selected = (settings.courier_no_delivery_days || []).includes(key);
              const wouldBlockAll = !selected && (settings.courier_no_delivery_days || []).length >= 6;
              return (
                <label key={key} style={{ display: "flex", gap: 6, alignItems: "center", opacity: wouldBlockAll ? 0.5 : 1 }}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={wouldBlockAll}
                    onChange={() => toggleCourierDay(key)}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
          {(settings.courier_no_delivery_days || []).length === 6 && (
            <div style={{ color: "var(--p-color-text-critical, #dc2626)", fontSize: 12, marginTop: 4 }}>
              ⚠️ At least one day must remain open for deliveries.
            </div>
          )}
        </div>

        {/* Bank Holidays Section */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            display: "grid",
            gap: 12,
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Bank Holidays</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
            Select your country to automatically skip bank holidays (calculated dynamically for any year)
          </s-text>

          <label>
            <s-text>Country</s-text>
            <select
              value={settings.bank_holiday_country || ""}
              onChange={(e) => setSettings({ ...settings, bank_holiday_country: e.target.value })}
              style={{ width: "100%" }}
            >
              <option value="">None (no bank holidays)</option>
              {Object.entries(bankHolidayCountries)
                .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                .map(([code, { name }]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
            </select>
          </label>

          {selectedCountry && calculatedHolidays.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                Holidays for {currentYear}:
              </s-text>
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--p-color-text-subdued, #6b7280)" }}>
                {calculatedHolidays
                  .map(date => {
                    const d = new Date(date + "T00:00:00");
                    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                  })
                  .join(", ")}
              </div>
            </div>
          )}
        </div>

        {/* Custom Holidays Section */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            display: "grid",
            gap: 12,
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Custom Holidays</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
            Add one-off holidays or non-dispatch days not in the standard bank holiday list (e.g., royal funerals, company events, stocktake days)
          </s-text>

          {/* Add new custom holiday form */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: 16, alignItems: "end" }}>
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
                placeholder="e.g., Royal Wedding"
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

          {/* List of custom holidays */}
          {(settings.custom_holidays || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <s-text size="small" style={{ fontWeight: 500 }}>
                Your custom holidays:
              </s-text>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {(settings.custom_holidays || [])
                  .filter((h) => h && typeof h.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.date))
                  .map((holiday) => {
                  const d = new Date(holiday.date + "T00:00:00");
                  const dateStr = d.toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  });
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
                        <s-text size="small" style={{ fontWeight: 500 }}>
                          {dateStr}
                        </s-text>
                        {holiday.label && (
                          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginLeft: 8 }}>
                            - {holiday.label}
                          </s-text>
                        )}
                        {isPast && (
                          <s-text size="small" style={{ color: "var(--p-color-text-disabled, #9ca3af)", marginLeft: 8 }}>
                            (past)
                          </s-text>
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
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(settings.custom_holidays || []).length === 0 && (
            <s-text size="small" style={{ color: "var(--p-color-text-disabled, #9ca3af)", fontStyle: "italic" }}>
              No custom holidays added yet.
            </s-text>
          )}
        </div>

        {/* Typography & Spacing Note */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Typography & Spacing</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 8, display: "block" }}>
            Typography, spacing, and alignment settings have moved to the Messages page for a better experience with live preview.
          </s-text>
          <s-text size="small" style={{ marginTop: 8, display: "block" }}>
            Go to <strong>Messages</strong> and click the <strong>Typography</strong> or <strong>Alignment</strong> buttons to adjust these settings while seeing changes in real-time.
          </s-text>
        </div>


        {/* Save Button */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <s-button variant="primary" onClick={() => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            handleSave();
          }}>
            Save
          </s-button>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            aria-hidden="true"
          >
            <g fill={saveStatus === "Saving..." ? "#22c55e" : "#9ca3af"} fillRule="evenodd" clipRule="evenodd">
              <path d="M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7.414A2 2 0 0 0 20.414 6L18 3.586A2 2 0 0 0 16.586 3zm3 11a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6H8zm1-7V5h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1" />
              <path d="M14 17h-4v-2h4z" />
            </g>
          </svg>
          {fetcher.data?.error && (
            <s-text style={{ color: "var(--p-color-text-critical, #dc2626)" }}>
              {fetcher.data.error}
            </s-text>
          )}
        </div>

        </div>
      </s-layout>
    </s-page>
  );
}

// ============================================================================
// ERROR BOUNDARY & HEADERS EXPORTS
// ============================================================================

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Holiday calculation functions are now in app/utils/holidays.js
// Import from there: import { getHolidaysForYear, HOLIDAY_DEFINITIONS } from "../utils/holidays.js"
