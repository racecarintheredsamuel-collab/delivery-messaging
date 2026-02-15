// ============================================================================
// IMPORTS
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getHolidaysForYear, HOLIDAY_DEFINITIONS } from "../utils/holidays.js";
import { CustomDatePicker } from "../components/CustomDatePicker";
import { safeParseNumber, extractFontName, friendlyError, safeLogError, validateConfig, validateSettings } from "../utils/validation";
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

    // Block alignment
    messages_alignment: "left",
    eta_alignment: "left",
    special_delivery_alignment: "left",

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
            <div style={{ display: "grid", gap: 2, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12, marginTop: 4 }}>
              <span>💡 Additional business days before shipping (use 0 for same-day shipping).</span>
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

        {/* Typography Section */}
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
          <s-heading>Typography</s-heading>

          {/* Messages Font */}
          <div>
            <s-heading>Messages Font</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 8, display: "block" }}>
              Font family for message text
            </s-text>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.use_theme_font !== false}
                onChange={(e) => setSettings({ ...settings, use_theme_font: e.target.checked })}
              />
              <s-text>Use theme font (inherits from your Shopify theme)</s-text>
            </label>

          {!settings.use_theme_font && (
            <>
              <label>
                <s-text>Custom font family</s-text>
                <select
                  value={settings.custom_font_family || ""}
                  onChange={(e) => setSettings({ ...settings, custom_font_family: e.target.value })}
                  style={{ width: "100%", marginTop: 4 }}
                >
                  <option value="">— Select a font —</option>
                  <optgroup label="System Fonts">
                    <option value="Arial, sans-serif">Arial</option>
                    <option value="Helvetica, Arial, sans-serif">Helvetica</option>
                    <option value="Georgia, serif">Georgia</option>
                    <option value="'Times New Roman', Times, serif">Times New Roman</option>
                    <option value="Verdana, sans-serif">Verdana</option>
                    <option value="Tahoma, sans-serif">Tahoma</option>
                    <option value="'Trebuchet MS', sans-serif">Trebuchet MS</option>
                    <option value="'Courier New', monospace">Courier New</option>
                  </optgroup>
                  <optgroup label="Google Fonts">
                    <option value="'Assistant', sans-serif">Assistant (Dawn default)</option>
                    <option value="'Open Sans', sans-serif">Open Sans</option>
                    <option value="'Roboto', sans-serif">Roboto</option>
                    <option value="'Lato', sans-serif">Lato</option>
                    <option value="'Montserrat', sans-serif">Montserrat</option>
                    <option value="'Poppins', sans-serif">Poppins</option>
                    <option value="'Raleway', sans-serif">Raleway</option>
                  </optgroup>
                </select>
              </label>

              {/* Font Preview */}
              {settings.custom_font_family && (
                <>
                  {/* Load Google Font if selected */}
                  {settings.custom_font_family.includes("'") &&
                   !settings.custom_font_family.includes("Times") &&
                   !settings.custom_font_family.includes("Courier") &&
                   !settings.custom_font_family.includes("Trebuchet") && (
                    <link
                      href={`https://fonts.googleapis.com/css2?family=${extractFontName(settings.custom_font_family).replace(/ /g, '+')}:wght@400;500;600&display=swap`}
                      rel="stylesheet"
                    />
                  )}
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                      borderRadius: 6,
                      border: "1px solid var(--p-color-border, #e5e7eb)",
                    }}
                  >
                    <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block" }}>
                      Preview:
                    </s-text>
                    <div
                      style={{
                        fontFamily: settings.custom_font_family,
                        fontSize: 16,
                        lineHeight: 1.4,
                      }}
                    >
                      Order within 2h 14m for same-day dispatch
                    </div>
                  </div>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Google Fonts will be automatically loaded on your storefront
                  </s-text>
                </>
              )}
            </>
          )}

          </div>

          {/* Messages Text Styling */}
          <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", marginTop: 8, paddingTop: 12 }}>
            <s-heading>Messages Text Styling</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 8, display: "block" }}>
              Default text color, size, and weight (can be overridden per-rule)
            </s-text>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.use_theme_text_styling !== false}
                onChange={(e) => setSettings({ ...settings, use_theme_text_styling: e.target.checked })}
              />
              <s-text>Match theme text styling</s-text>
            </label>

            {settings.use_theme_text_styling === false && (
              <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                <s-color-field
                  label="Text color"
                  value={settings.text_color || "#374151"}
                  onInput={(e) => {
                    const val = e.detail?.value || e.target?.value;
                    if (val) setSettings({ ...settings, text_color: val });
                  }}
                  onChange={(e) => {
                    const val = e.detail?.value || e.target?.value;
                    if (val) setSettings({ ...settings, text_color: val });
                  }}
                />

                <label>
                  <s-text>Font size</s-text>
                  <select
                    value={settings.font_size || "medium"}
                    onChange={(e) => setSettings({ ...settings, font_size: e.target.value })}
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
                    value={settings.font_weight || "normal"}
                    onChange={(e) => setSettings({ ...settings, font_weight: e.target.value })}
                    style={{ width: "100%", marginTop: 4 }}
                  >
                    <option value="normal">Normal (400)</option>
                    <option value="medium">Medium (500)</option>
                    <option value="semibold">Semi-bold (600)</option>
                    <option value="bold">Bold (700)</option>
                  </select>
                </label>

                {/* Text Styling Preview */}
                <div
                  style={{
                    padding: "12px 16px",
                    background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                    borderRadius: 6,
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                  }}
                >
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block" }}>
                    Preview:
                  </s-text>
                  <div
                    style={{
                      fontFamily: settings.custom_font_family || "inherit",
                      color: settings.text_color || "#374151",
                      fontSize: settings.font_size === "xsmall" ? 12 : settings.font_size === "small" ? 14 : settings.font_size === "large" ? 18 : settings.font_size === "xlarge" ? 20 : 16,
                      fontWeight: settings.font_weight === "medium" ? 500 : settings.font_weight === "semibold" ? 600 : settings.font_weight === "bold" ? 700 : 400,
                      lineHeight: 1.4,
                    }}
                  >
                    Order within 2h 14m for same-day dispatch
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ETA Timeline Font */}
          <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", marginTop: 8, paddingTop: 12 }}>
            <s-heading>ETA Timeline Font</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 8, display: "block" }}>
              Font family for ETA Timeline text
            </s-text>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.eta_use_theme_font !== false}
                onChange={(e) => setSettings({ ...settings, eta_use_theme_font: e.target.checked, eta_match_messages_font: false })}
              />
              <s-text>Use theme font (inherits from your Shopify theme)</s-text>
            </label>


            {settings.eta_use_theme_font === false && (
              <>
                {/* Show "Match messages font" option only when messages has custom font */}
                {!settings.use_theme_font && settings.custom_font_family && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={settings.eta_match_messages_font === true}
                      onChange={(e) => setSettings({ ...settings, eta_match_messages_font: e.target.checked })}
                    />
                    <s-text>Match messages font ({extractFontName(settings.custom_font_family)})</s-text>
                  </label>
                )}

                {/* Only show font picker if not matching messages font */}
                {!settings.eta_match_messages_font && (
                  <>
                    <label style={{ marginTop: 8 }}>
                      <s-text>Custom font family</s-text>
                      <select
                        value={settings.eta_custom_font_family || ""}
                        onChange={(e) => setSettings({ ...settings, eta_custom_font_family: e.target.value })}
                        style={{ width: "100%", marginTop: 4 }}
                      >
                        <option value="">— Select a font —</option>
                        <optgroup label="System Fonts">
                          <option value="Arial, sans-serif">Arial</option>
                          <option value="Helvetica, Arial, sans-serif">Helvetica</option>
                          <option value="Georgia, serif">Georgia</option>
                          <option value="'Times New Roman', Times, serif">Times New Roman</option>
                          <option value="Verdana, sans-serif">Verdana</option>
                          <option value="Tahoma, sans-serif">Tahoma</option>
                          <option value="'Trebuchet MS', sans-serif">Trebuchet MS</option>
                          <option value="'Courier New', monospace">Courier New</option>
                        </optgroup>
                        <optgroup label="Google Fonts">
                          <option value="'Assistant', sans-serif">Assistant (Dawn default)</option>
                          <option value="'Open Sans', sans-serif">Open Sans</option>
                          <option value="'Roboto', sans-serif">Roboto</option>
                          <option value="'Lato', sans-serif">Lato</option>
                          <option value="'Montserrat', sans-serif">Montserrat</option>
                          <option value="'Poppins', sans-serif">Poppins</option>
                          <option value="'Raleway', sans-serif">Raleway</option>
                        </optgroup>
                      </select>
                    </label>

                    {/* ETA Font Preview */}
                    {settings.eta_custom_font_family && (
                      <>
                        {/* Load Google Font if selected */}
                        {settings.eta_custom_font_family.includes("'") &&
                         !settings.eta_custom_font_family.includes("Times") &&
                         !settings.eta_custom_font_family.includes("Courier") &&
                         !settings.eta_custom_font_family.includes("Trebuchet") && (
                          <link
                            href={`https://fonts.googleapis.com/css2?family=${extractFontName(settings.eta_custom_font_family).replace(/ /g, '+')}:wght@400;500;600&display=swap`}
                            rel="stylesheet"
                          />
                        )}
                        <div
                          style={{
                            padding: "12px 16px",
                            background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                            borderRadius: 6,
                            border: "1px solid var(--p-color-border, #e5e7eb)",
                            marginTop: 8,
                          }}
                        >
                          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block" }}>
                            Preview:
                          </s-text>
                          <div
                            style={{
                              fontFamily: settings.eta_custom_font_family,
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: 1.2,
                            }}
                          >
                            Ordered → Shipped → Delivered
                          </div>
                          <div
                            style={{
                              fontFamily: settings.eta_custom_font_family,
                              fontSize: 11,
                              color: "var(--p-color-text-subdued, #6b7280)",
                              marginTop: 2,
                            }}
                          >
                            Jan 20 → Jan 21 → Jan 24-26
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Preview when matching messages font */}
                {settings.eta_match_messages_font && settings.custom_font_family && (
                  <>
                    <div
                      style={{
                        padding: "12px 16px",
                        background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                        borderRadius: 6,
                        border: "1px solid var(--p-color-border, #e5e7eb)",
                        marginTop: 8,
                      }}
                    >
                      <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block" }}>
                        Preview (using messages font):
                      </s-text>
                      <div
                        style={{
                          fontFamily: settings.custom_font_family,
                          fontSize: 12,
                          fontWeight: 600,
                          lineHeight: 1.2,
                        }}
                      >
                        Ordered → Shipped → Delivered
                      </div>
                      <div
                        style={{
                          fontFamily: settings.custom_font_family,
                          fontSize: 11,
                          color: "var(--p-color-text-subdued, #6b7280)",
                          marginTop: 2,
                        }}
                      >
                        Jan 20 → Jan 21 → Jan 24-26
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* ETA Timeline Text Styling */}
          <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", marginTop: 8, paddingTop: 12 }}>
            <s-heading>ETA Timeline Text Styling</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 8, display: "block" }}>
              Default text styling for labels and dates (can be overridden per-rule)
            </s-text>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.eta_use_theme_text_styling !== false}
                onChange={(e) => setSettings({ ...settings, eta_use_theme_text_styling: e.target.checked })}
              />
              <s-text>Match theme text styling</s-text>
            </label>

            {settings.eta_use_theme_text_styling === false && (
              <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
                {/* Labels Section */}
                <div style={{ background: "var(--p-color-bg-surface-secondary, #f9fafb)", borderRadius: 6, padding: 12 }}>
                  <s-text style={{ fontWeight: 600, marginBottom: 8, display: "block" }}>Labels (Ordered, Shipped, Delivered)</s-text>
                  <div style={{ display: "grid", gap: 12 }}>
                    <s-color-field
                      label="Label color"
                      value={settings.eta_label_color || "#374151"}
                      onInput={(e) => {
                        const val = e.detail?.value || e.target?.value;
                        if (val) setSettings({ ...settings, eta_label_color: val });
                      }}
                      onChange={(e) => {
                        const val = e.detail?.value || e.target?.value;
                        if (val) setSettings({ ...settings, eta_label_color: val });
                      }}
                    />

                    <label>
                      <s-text>Label font size</s-text>
                      <select
                        value={settings.eta_label_font_size || "small"}
                        onChange={(e) => setSettings({ ...settings, eta_label_font_size: e.target.value })}
                        style={{ width: "100%", marginTop: 4 }}
                      >
                        <option value="xsmall">X-Small (11px)</option>
                        <option value="small">Small (12px)</option>
                        <option value="medium">Medium (14px)</option>
                      </select>
                    </label>

                    <label>
                      <s-text>Label font weight</s-text>
                      <select
                        value={settings.eta_label_font_weight || "semibold"}
                        onChange={(e) => setSettings({ ...settings, eta_label_font_weight: e.target.value })}
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

                {/* Dates Section */}
                <div style={{ background: "var(--p-color-bg-surface-secondary, #f9fafb)", borderRadius: 6, padding: 12 }}>
                  <s-text style={{ fontWeight: 600, marginBottom: 8, display: "block" }}>Dates (Jan 20, Jan 21-24)</s-text>
                  <div style={{ display: "grid", gap: 12 }}>
                    <s-color-field
                      label="Date color"
                      value={settings.eta_date_color || "#6b7280"}
                      onInput={(e) => {
                        const val = e.detail?.value || e.target?.value;
                        if (val) setSettings({ ...settings, eta_date_color: val });
                      }}
                      onChange={(e) => {
                        const val = e.detail?.value || e.target?.value;
                        if (val) setSettings({ ...settings, eta_date_color: val });
                      }}
                    />

                    <label>
                      <s-text>Date font size</s-text>
                      <select
                        value={settings.eta_date_font_size || "xsmall"}
                        onChange={(e) => setSettings({ ...settings, eta_date_font_size: e.target.value })}
                        style={{ width: "100%", marginTop: 4 }}
                      >
                        <option value="xxsmall">XX-Small (10px)</option>
                        <option value="xsmall">X-Small (11px)</option>
                        <option value="small">Small (12px)</option>
                      </select>
                    </label>

                    <label>
                      <s-text>Date font weight</s-text>
                      <select
                        value={settings.eta_date_font_weight || "normal"}
                        onChange={(e) => setSettings({ ...settings, eta_date_font_weight: e.target.value })}
                        style={{ width: "100%", marginTop: 4 }}
                      >
                        <option value="normal">Normal (400)</option>
                        <option value="medium">Medium (500)</option>
                        <option value="semibold">Semi-bold (600)</option>
                      </select>
                    </label>
                  </div>
                </div>

                {/* ETA Text Styling Preview */}
                <div
                  style={{
                    padding: "12px 16px",
                    background: "var(--p-color-bg-surface, #ffffff)",
                    borderRadius: 6,
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                  }}
                >
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block" }}>
                    Preview:
                  </s-text>
                  <div
                    style={{
                      fontFamily: settings.eta_use_theme_font === false
                        ? (settings.eta_match_messages_font ? settings.custom_font_family : settings.eta_custom_font_family) || "inherit"
                        : "inherit",
                      color: settings.eta_label_color || "#374151",
                      fontSize: settings.eta_label_font_size === "xsmall" ? 11 : settings.eta_label_font_size === "medium" ? 14 : 12,
                      fontWeight: settings.eta_label_font_weight === "normal" ? 400 : settings.eta_label_font_weight === "medium" ? 500 : settings.eta_label_font_weight === "bold" ? 700 : 600,
                      lineHeight: 1.2,
                    }}
                  >
                    Ordered → Shipped → Delivered
                  </div>
                  <div
                    style={{
                      fontFamily: settings.eta_use_theme_font === false
                        ? (settings.eta_match_messages_font ? settings.custom_font_family : settings.eta_custom_font_family) || "inherit"
                        : "inherit",
                      color: settings.eta_date_color || "#6b7280",
                      fontSize: settings.eta_date_font_size === "xxsmall" ? 10 : settings.eta_date_font_size === "small" ? 12 : 11,
                      fontWeight: settings.eta_date_font_weight === "normal" ? 400 : settings.eta_date_font_weight === "medium" ? 500 : 600,
                      marginTop: 2,
                    }}
                  >
                    Jan 20 → Jan 21 → Jan 24-26
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Special Delivery Font */}
          <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", marginTop: 8, paddingTop: 12 }}>
            <s-heading>Special Delivery Font</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 8, display: "block" }}>
              Font family for Special Delivery block text
            </s-text>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.special_delivery_use_theme_font !== false}
                onChange={(e) => setSettings({ ...settings, special_delivery_use_theme_font: e.target.checked, special_delivery_match_messages_font: false })}
              />
              <s-text>Use theme font (inherits from your Shopify theme)</s-text>
            </label>

            {settings.special_delivery_use_theme_font === false && (
              <>
                {/* Show "Match messages font" option only when messages has custom font */}
                {!settings.use_theme_font && settings.custom_font_family && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={settings.special_delivery_match_messages_font === true}
                      onChange={(e) => setSettings({ ...settings, special_delivery_match_messages_font: e.target.checked })}
                    />
                    <s-text>Match messages font ({extractFontName(settings.custom_font_family)})</s-text>
                  </label>
                )}

                {/* Only show font picker if not matching messages font */}
                {!settings.special_delivery_match_messages_font && (
                  <>
                    <label style={{ marginTop: 8 }}>
                      <s-text>Custom font family</s-text>
                      <select
                        value={settings.special_delivery_custom_font_family || ""}
                        onChange={(e) => setSettings({ ...settings, special_delivery_custom_font_family: e.target.value })}
                        style={{ width: "100%", marginTop: 4 }}
                      >
                        <option value="">— Select a font —</option>
                        <optgroup label="System Fonts">
                          <option value="Arial, sans-serif">Arial</option>
                          <option value="Helvetica, Arial, sans-serif">Helvetica</option>
                          <option value="Georgia, serif">Georgia</option>
                          <option value="'Times New Roman', Times, serif">Times New Roman</option>
                          <option value="Verdana, sans-serif">Verdana</option>
                          <option value="Tahoma, sans-serif">Tahoma</option>
                          <option value="'Trebuchet MS', sans-serif">Trebuchet MS</option>
                          <option value="'Courier New', monospace">Courier New</option>
                        </optgroup>
                        <optgroup label="Google Fonts">
                          <option value="'Assistant', sans-serif">Assistant (Dawn default)</option>
                          <option value="'Open Sans', sans-serif">Open Sans</option>
                          <option value="'Roboto', sans-serif">Roboto</option>
                          <option value="'Lato', sans-serif">Lato</option>
                          <option value="'Montserrat', sans-serif">Montserrat</option>
                          <option value="'Poppins', sans-serif">Poppins</option>
                          <option value="'Raleway', sans-serif">Raleway</option>
                        </optgroup>
                      </select>
                    </label>

                    {/* Special Delivery Font Preview */}
                    {settings.special_delivery_custom_font_family && (
                      <>
                        {/* Load Google Font if selected */}
                        {settings.special_delivery_custom_font_family.includes("'") &&
                         !settings.special_delivery_custom_font_family.includes("Times") &&
                         !settings.special_delivery_custom_font_family.includes("Courier") &&
                         !settings.special_delivery_custom_font_family.includes("Trebuchet") && (
                          <link
                            href={`https://fonts.googleapis.com/css2?family=${extractFontName(settings.special_delivery_custom_font_family).replace(/ /g, '+')}:wght@400;500;600&display=swap`}
                            rel="stylesheet"
                          />
                        )}
                        <div
                          style={{
                            padding: "12px 16px",
                            background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                            borderRadius: 6,
                            border: "1px solid var(--p-color-border, #e5e7eb)",
                            marginTop: 8,
                          }}
                        >
                          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block" }}>
                            Preview:
                          </s-text>
                          <div
                            style={{
                              fontFamily: settings.special_delivery_custom_font_family,
                              fontSize: 16,
                              lineHeight: 1.4,
                            }}
                          >
                            This product requires special delivery arrangements.
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Preview when matching messages font */}
                {settings.special_delivery_match_messages_font && settings.custom_font_family && (
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                      borderRadius: 6,
                      border: "1px solid var(--p-color-border, #e5e7eb)",
                      marginTop: 8,
                    }}
                  >
                    <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block" }}>
                      Preview (using messages font):
                    </s-text>
                    <div
                      style={{
                        fontFamily: settings.custom_font_family,
                        fontSize: 16,
                        lineHeight: 1.4,
                      }}
                    >
                      This product requires special delivery arrangements.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Special Delivery Text Styling */}
          <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", marginTop: 8, paddingTop: 12 }}>
            <s-heading>Special Delivery Text Styling</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 8, display: "block" }}>
              Default text color, size, and weight (can be overridden per-rule)
            </s-text>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={settings.special_delivery_use_theme_text_styling !== false}
                onChange={(e) => setSettings({ ...settings, special_delivery_use_theme_text_styling: e.target.checked })}
              />
              <s-text>Match theme text styling</s-text>
            </label>

            {settings.special_delivery_use_theme_text_styling === false && (
              <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                <s-color-field
                  label="Text color"
                  value={settings.special_delivery_text_color || "#374151"}
                  onInput={(e) => {
                    const val = e.detail?.value || e.target?.value;
                    if (val) setSettings({ ...settings, special_delivery_text_color: val });
                  }}
                  onChange={(e) => {
                    const val = e.detail?.value || e.target?.value;
                    if (val) setSettings({ ...settings, special_delivery_text_color: val });
                  }}
                />

                <label>
                  <s-text>Font size</s-text>
                  <select
                    value={settings.special_delivery_font_size || "medium"}
                    onChange={(e) => setSettings({ ...settings, special_delivery_font_size: e.target.value })}
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
                    value={settings.special_delivery_font_weight || "normal"}
                    onChange={(e) => setSettings({ ...settings, special_delivery_font_weight: e.target.value })}
                    style={{ width: "100%", marginTop: 4 }}
                  >
                    <option value="normal">Normal (400)</option>
                    <option value="medium">Medium (500)</option>
                    <option value="semibold">Semi-bold (600)</option>
                    <option value="bold">Bold (700)</option>
                  </select>
                </label>

                {/* Special Delivery Text Styling Preview */}
                <div
                  style={{
                    padding: "12px 16px",
                    background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                    borderRadius: 6,
                    border: "1px solid var(--p-color-border, #e5e7eb)",
                  }}
                >
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block" }}>
                    Preview:
                  </s-text>
                  <div
                    style={{
                      fontFamily: settings.special_delivery_use_theme_font === false
                        ? (settings.special_delivery_match_messages_font ? settings.custom_font_family : settings.special_delivery_custom_font_family) || "inherit"
                        : "inherit",
                      color: settings.special_delivery_text_color || "#374151",
                      fontSize: settings.special_delivery_font_size === "xsmall" ? 12 : settings.special_delivery_font_size === "small" ? 14 : settings.special_delivery_font_size === "large" ? 18 : settings.special_delivery_font_size === "xlarge" ? 20 : 16,
                      fontWeight: settings.special_delivery_font_weight === "medium" ? 500 : settings.special_delivery_font_weight === "semibold" ? 600 : settings.special_delivery_font_weight === "bold" ? 700 : 400,
                      lineHeight: 1.4,
                    }}
                  >
                    This product requires special delivery arrangements.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Theme Preview Settings */}
          <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", marginTop: 8, paddingTop: 12 }}>
            <s-heading>Theme Preview Settings</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 8, display: "block" }}>
              Configure how the Rules page preview appears when using theme styling
            </s-text>

            <label>
              <s-text>Theme font (for preview)</s-text>
              <select
                value={settings.eta_preview_theme_font || "'Assistant', sans-serif"}
                onChange={(e) => setSettings({ ...settings, eta_preview_theme_font: e.target.value })}
                style={{ width: "100%", marginTop: 4 }}
              >
                <optgroup label="Google Fonts">
                  <option value="'Assistant', sans-serif">Assistant (Dawn default)</option>
                  <option value="'Open Sans', sans-serif">Open Sans</option>
                  <option value="'Roboto', sans-serif">Roboto</option>
                  <option value="'Lato', sans-serif">Lato</option>
                  <option value="'Montserrat', sans-serif">Montserrat</option>
                  <option value="'Poppins', sans-serif">Poppins</option>
                  <option value="'Raleway', sans-serif">Raleway</option>
                  <option value="'DM Sans', sans-serif">DM Sans</option>
                  <option value="'Inter', sans-serif">Inter</option>
                  <option value="'Nunito', sans-serif">Nunito</option>
                  <option value="'Work Sans', sans-serif">Work Sans</option>
                </optgroup>
                <optgroup label="System Fonts">
                  <option value="system-ui, -apple-system, sans-serif">System Default</option>
                  <option value="Arial, sans-serif">Arial</option>
                  <option value="Helvetica, Arial, sans-serif">Helvetica</option>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="'Times New Roman', Times, serif">Times New Roman</option>
                </optgroup>
              </select>
            </label>

            <label style={{ marginTop: 12 }}>
              <s-text>Font size scale</s-text>
              <select
                value={settings.eta_preview_font_size_scale || ""}
                onChange={(e) => setSettings({ ...settings, eta_preview_font_size_scale: e.target.value })}
                style={{ width: "100%", marginTop: 4 }}
              >
                <option value="">100% (default)</option>
                <option value="80">80%</option>
                <option value="90">90%</option>
                <option value="100">100%</option>
                <option value="105">105%</option>
                <option value="110">110%</option>
                <option value="115">115%</option>
                <option value="120">120%</option>
                <option value="125">125%</option>
                <option value="130">130%</option>
              </select>
            </label>

            <label style={{ marginTop: 12 }}>
              <s-text>Font weight</s-text>
              <select
                value={settings.eta_preview_font_weight || ""}
                onChange={(e) => setSettings({ ...settings, eta_preview_font_weight: e.target.value })}
                style={{ width: "100%", marginTop: 4 }}
              >
                <option value="">Normal (default)</option>
                <option value="300">Light (300)</option>
                <option value="400">Normal (400)</option>
                <option value="500">Medium (500)</option>
                <option value="600">Semi-bold (600)</option>
                <option value="700">Bold (700)</option>
              </select>
            </label>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
              These settings help match the Rules page preview to your storefront. They do not affect your actual storefront.
            </s-text>
          </div>
        </div>

        {/* Block Spacing & Alignment */}
        <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 16, background: "var(--p-color-bg-surface, #ffffff)" }}>
          <s-heading>Block Spacing & Alignment</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
            Adjust margins and alignment for each block. Use negative margin values to pull blocks closer together.
          </s-text>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <s-text fontWeight="bold">Messages</s-text>
              <label>
                <s-text>Alignment</s-text>
                <select
                  value={settings.messages_alignment || "left"}
                  onChange={(e) => setSettings({ ...settings, messages_alignment: e.target.value })}
                  style={{ width: "100%", marginTop: 4 }}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                </select>
              </label>
              <label>
                <s-text>Top margin (px)</s-text>
                <input
                  type="number"
                  value={settings.messages_margin_top ?? 0}
                  onChange={(e) => setSettings({ ...settings, messages_margin_top: safeParseNumber(e.target.value, 0) })}
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                <s-text>Bottom margin (px)</s-text>
                <input
                  type="number"
                  value={settings.messages_margin_bottom ?? 0}
                  onChange={(e) => setSettings({ ...settings, messages_margin_bottom: safeParseNumber(e.target.value, 0) })}
                  style={{ width: "100%" }}
                />
              </label>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <s-text fontWeight="bold">ETA Timeline</s-text>
              <label>
                <s-text>Alignment</s-text>
                <select
                  value={settings.eta_alignment || "left"}
                  onChange={(e) => setSettings({ ...settings, eta_alignment: e.target.value })}
                  style={{ width: "100%", marginTop: 4 }}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                </select>
              </label>
              <label>
                <s-text>Top margin (px)</s-text>
                <input
                  type="number"
                  value={settings.eta_margin_top ?? 0}
                  onChange={(e) => setSettings({ ...settings, eta_margin_top: safeParseNumber(e.target.value, 0) })}
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                <s-text>Bottom margin (px)</s-text>
                <input
                  type="number"
                  value={settings.eta_margin_bottom ?? 0}
                  onChange={(e) => setSettings({ ...settings, eta_margin_bottom: safeParseNumber(e.target.value, 0) })}
                  style={{ width: "100%" }}
                />
              </label>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <s-text fontWeight="bold">Special Delivery</s-text>
              <label>
                <s-text>Alignment</s-text>
                <select
                  value={settings.special_delivery_alignment || "left"}
                  onChange={(e) => setSettings({ ...settings, special_delivery_alignment: e.target.value })}
                  style={{ width: "100%", marginTop: 4 }}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                </select>
              </label>
              <label>
                <s-text>Top margin (px)</s-text>
                <input
                  type="number"
                  value={settings.special_delivery_margin_top ?? 0}
                  onChange={(e) => setSettings({ ...settings, special_delivery_margin_top: safeParseNumber(e.target.value, 0) })}
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                <s-text>Bottom margin (px)</s-text>
                <input
                  type="number"
                  value={settings.special_delivery_margin_bottom ?? 0}
                  onChange={(e) => setSettings({ ...settings, special_delivery_margin_bottom: safeParseNumber(e.target.value, 0) })}
                  style={{ width: "100%" }}
                />
              </label>
            </div>
          </div>
        </div>

        {/* ETA Timeline Spacing */}
        <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, padding: 16, display: "grid", gap: 12, background: "var(--p-color-bg-surface, #ffffff)" }}>
          <s-heading>ETA Timeline Spacing</s-heading>
          <div>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
              Control the gaps between stages and elements in the ETA timeline.
            </s-text>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
              <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
              <span style={{ fontSize: 12 }}>Use a mix of horizontal gap and horizontal padding to control the overall length of the ETA Timeline.</span>
            </div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <label>
              <s-text>Horizontal gap between stages (px)</s-text>
              <input
                type="number"
                min="-20"
                max="40"
                value={settings.eta_horizontal_gap ?? 12}
                onChange={(e) => setSettings({ ...settings, eta_horizontal_gap: safeParseNumber(e.target.value, 12, -20, 40) })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <s-text>Horizontal padding (px)</s-text>
              <input
                type="number"
                min="0"
                max="40"
                value={settings.eta_padding_horizontal ?? 8}
                onChange={(e) => setSettings({ ...settings, eta_padding_horizontal: safeParseNumber(e.target.value, 8, 0, 40) })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <s-text>Vertical padding (px)</s-text>
              <input
                type="number"
                min="0"
                max="40"
                value={settings.eta_padding_vertical ?? 8}
                onChange={(e) => setSettings({ ...settings, eta_padding_vertical: safeParseNumber(e.target.value, 8, 0, 40) })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <s-text>Icon to label gap (px)</s-text>
              <input
                type="number"
                min="0"
                max="20"
                value={settings.eta_gap_icon_label ?? 2}
                onChange={(e) => setSettings({ ...settings, eta_gap_icon_label: safeParseNumber(e.target.value, 2, 0, 20) })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <s-text>Label to date gap (px)</s-text>
              <input
                type="number"
                min="0"
                max="20"
                value={settings.eta_gap_label_date ?? 0}
                onChange={(e) => setSettings({ ...settings, eta_gap_label_date: safeParseNumber(e.target.value, 0, 0, 20) })}
                style={{ width: "100%" }}
              />
            </label>
          </div>
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
