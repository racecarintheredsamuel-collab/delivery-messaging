// ============================================================================
// IMPORTS
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { safeLogError, validateSettings } from "../utils/validation";
import {
  GET_SHOP_DELIVERY_DATA,
  GET_SHOP_ID,
  SET_METAFIELDS_MINIMAL,
  METAFIELD_NAMESPACE,
  CONFIG_KEY,
  SETTINGS_KEY,
  ICONS_KEY,
} from "../graphql/queries";

// ============================================================================
// LOADER - Fetch settings from Shopify metafields
// ============================================================================

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

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
    safeLogError("Failed to fetch settings", json.errors);
    throw new Error("Unable to load settings. Please refresh the page.");
  }

  const shopId = json?.data?.shop?.id;
  const settingsMf = json?.data?.shop?.settings;

  // Track whether we loaded with existing settings (for auto-save safeguard)
  const hasExistingSettings = !!settingsMf?.value && settingsMf.value !== "{}";

  return {
    settings: settingsMf?.value ?? "{}",
    shopId,
    hasExistingSettings,
  };
};

// ============================================================================
// ACTION - Save settings to Shopify metafields
// ============================================================================

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const settingsRaw = formData.get("settings");
  let shopId = formData.get("shopId");

  if (!settingsRaw || typeof settingsRaw !== "string" || !settingsRaw.trim()) {
    return { ok: false, error: "No data to save." };
  }

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

  if (!shopId) {
    const shopRes = await admin.graphql(GET_SHOP_ID);
    const shopJson = await shopRes.json();
    if (shopJson.errors) {
      return { ok: false, error: "Unable to save. Please try again." };
    }
    shopId = shopJson?.data?.shop?.id;
  }

  const setRes = await admin.graphql(SET_METAFIELDS_MINIMAL, {
    variables: {
      metafields: [{
        ownerId: shopId,
        namespace: METAFIELD_NAMESPACE,
        key: SETTINGS_KEY,
        type: "json",
        value: JSON.stringify(settingsValidation.data),
      }],
    },
  });

  const setJson = await setRes.json();
  if (setJson.errors) {
    return { ok: false, error: "Unable to save settings. Please try again." };
  }
  const errors = setJson?.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    return { ok: false, error: errors[0]?.message || "Unable to save. Please try again." };
  }

  return { ok: true };
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function FreeDeliveryPage() {
  const { settings: settingsRaw, shopId, hasExistingSettings } = useLoaderData();
  const fetcher = useFetcher();

  const [settings, setSettings] = useState(() => {
    try {
      return JSON.parse(settingsRaw);
    } catch {
      return {};
    }
  });

  // Track whether we loaded with existing settings (prevents overwriting with empty data)
  const [loadedWithData] = useState(hasExistingSettings);

  const [saveStatus, setSaveStatus] = useState("");

  // Exclusion rules state (migrate from legacy single rule if needed)
  const [exclusionRules, setExclusionRules] = useState(() => {
    if (settings.fd_exclusion_rules && settings.fd_exclusion_rules.length > 0) {
      return settings.fd_exclusion_rules;
    }
    // Migrate legacy single rule to array format
    const legacyTags = settings.fd_exclude_tags || [];
    const legacyHandles = settings.fd_exclude_handles || [];
    if (legacyTags.length > 0 || legacyHandles.length > 0) {
      return [{
        id: 'rule-1',
        tags: legacyTags,
        handles: legacyHandles,
        cart_message: settings.fd_message_excluded || '',
        announcement_message: settings.fd_announcement_excluded_message || '',
        announcement_duration: settings.fd_announcement_excluded_duration || 5,
      }];
    }
    return [];
  });
  const [expandedRules, setExpandedRules] = useState(() => new Set());
  const [lastDeletedExclusion, setLastDeletedExclusion] = useState(null);

  // Sync exclusion rules to settings
  useEffect(() => {
    setSettings(prev => ({ ...prev, fd_exclusion_rules: exclusionRules }));
  }, [exclusionRules]);

  // Legacy exclusion input text state (kept for backward compat during transition)
  const [excludeTagsText, setExcludeTagsText] = useState(() =>
    (settings.fd_exclude_tags || []).join(", ")
  );
  const [excludeHandlesText, setExcludeHandlesText] = useState(() =>
    (settings.fd_exclude_handles || []).join(", ")
  );

  // Auto-save refs
  const autoSaveTimerRef = useRef(null);
  const initialSettingsRef = useRef(JSON.stringify(settings));
  const prevFetcherStateRef = useRef(fetcher.state);
  const undoExclusionTimerRef = useRef(null);

  // Handle save responses
  useEffect(() => {
    const wasSubmitting = prevFetcherStateRef.current === "submitting" || prevFetcherStateRef.current === "loading";
    const isNowIdle = fetcher.state === "idle";
    prevFetcherStateRef.current = fetcher.state;

    if (!wasSubmitting || !isNowIdle) return;

    if (fetcher.data?.ok === true) {
      initialSettingsRef.current = JSON.stringify(settings);
      setSaveStatus("Saved!");
      const timer = setTimeout(() => setSaveStatus(""), 2000);
      return () => clearTimeout(timer);
    } else if (fetcher.data?.error) {
      setSaveStatus("Error: " + fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data, settings]);

  // Check if current settings appear to have meaningful data
  const settingsHaveData = () => {
    const hasThreshold = settings.fd_threshold && settings.fd_threshold > 0;
    const hasMessages = settings.fd_message_progress || settings.fd_message_reached;
    return hasThreshold || hasMessages;
  };

  // Safeguard: prevent saving empty settings if we loaded with existing data
  const shouldAllowSave = () => {
    if (loadedWithData && !settingsHaveData()) {
      console.warn("Blocked save: settings appear empty but we loaded with existing data");
      return false;
    }
    return true;
  };

  // Auto-save after 2 seconds of inactivity
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    const settingsChanged = JSON.stringify(settings) !== initialSettingsRef.current;
    if (!settingsChanged) return;
    if (fetcher.state !== "idle") return;

    autoSaveTimerRef.current = setTimeout(() => {
      // Safeguard: don't auto-save empty settings if we had data
      if (!shouldAllowSave()) {
        setSaveStatus("Save blocked: settings appear empty");
        return;
      }
      setSaveStatus("Saving...");
      fetcher.submit(
        { settings: JSON.stringify(settings), shopId },
        { method: "POST" }
      );
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [settings, shopId, fetcher.state]);

  // Cleanup undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoExclusionTimerRef.current) clearTimeout(undoExclusionTimerRef.current);
    };
  }, []);

  const handleSave = () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    // Safeguard: warn before saving empty settings if we had data
    if (loadedWithData && !settingsHaveData()) {
      if (!confirm("Settings appear empty. Are you sure you want to save? This may overwrite your existing settings.")) {
        return;
      }
    }

    setSaveStatus("Saving...");
    fetcher.submit(
      { settings: JSON.stringify(settings), shopId },
      { method: "POST" }
    );
  };

  // Delete exclusion with undo
  const deleteExclusionWithUndo = (ruleId, index) => {
    if (undoExclusionTimerRef.current) clearTimeout(undoExclusionTimerRef.current);
    const ruleToDelete = exclusionRules.find(r => r.id === ruleId);
    if (!ruleToDelete) return;
    setExclusionRules(prev => prev.filter(r => r.id !== ruleId));
    setLastDeletedExclusion({ rule: ruleToDelete, index });
    undoExclusionTimerRef.current = setTimeout(() => {
      setLastDeletedExclusion(null);
      undoExclusionTimerRef.current = null;
    }, 10000);
  };

  const undoDeleteExclusion = () => {
    if (!lastDeletedExclusion) return;
    if (undoExclusionTimerRef.current) clearTimeout(undoExclusionTimerRef.current);
    undoExclusionTimerRef.current = null;
    const insertAt = Math.max(0, Math.min(lastDeletedExclusion.index ?? 0, exclusionRules.length));
    const restored = [...exclusionRules];
    restored.splice(insertAt, 0, lastDeletedExclusion.rule);
    setExclusionRules(restored);
    setLastDeletedExclusion(null);
  };

  // Reusable save button with floppy disk indicator
  const SaveButtonRow = () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <s-button variant="primary" onClick={handleSave}>
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
    </div>
  );

  return (
    <s-page heading="Free Delivery">
      <s-layout style={{ maxWidth: 1000 }}>
        <div style={{ display: "grid", gap: 24 }}>
          {/* Top Save Button */}
          <SaveButtonRow />

          {/* Two-column layout for messaging sections */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* Left Column: Threshold + Free Delivery Messaging */}
            <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
              {/* Section 1: Threshold Amount */}
              <div
                style={{
                  border: "1px solid var(--p-color-border, #e5e7eb)",
                  borderRadius: "8px",
                  overflow: "hidden",
                  background: "var(--p-color-bg-surface, #ffffff)",
                  alignSelf: "start",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    padding: "12px 16px",
                    background: "var(--p-color-bg-surface-hover, #f8fafc)",
                    borderBottom: "1px solid var(--p-color-border, #e5e7eb)",
                  }}
                >
                  <s-text style={{ fontWeight: 600 }}>Threshold Amount</s-text>
                </div>
                {/* Content */}
                <div style={{ padding: "16px 16px 12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <s-text style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>£</s-text>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={(settings.fd_threshold || 0) / 100}
                      onChange={(e) => setSettings({ ...settings, fd_threshold: Math.round(parseFloat(e.target.value || 0) * 100) })}
                      style={{ width: 120 }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 8 }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                    <span style={{ fontSize: 12 }}>Customers spending this amount or more qualify for free delivery</span>
                  </div>
                </div>
              </div>

              {/* Section 2: Cart & Mini Cart Messaging */}
            <div
              style={{
                border: "1px solid var(--p-color-border, #e5e7eb)",
                borderRadius: "8px",
                overflow: "hidden",
                background: "var(--p-color-bg-surface, #ffffff)",
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--p-color-bg-surface-hover, #f8fafc)",
                  borderBottom: "1px solid var(--p-color-border, #e5e7eb)",
                }}
              >
                <s-text style={{ fontWeight: 600 }}>Cart & Mini Cart Messaging</s-text>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <s-text size="small">{settings.fd_enabled ? "Enabled" : "Disabled"}</s-text>
                  <input
                    type="checkbox"
                    checked={settings.fd_enabled || false}
                    onChange={(e) => setSettings({ ...settings, fd_enabled: e.target.checked })}
                  />
                </label>
              </div>

              {/* Content */}
              <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Display progress messages in the cart drawer and cart page
                  </s-text>

                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: -4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)" }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                    <span style={{ fontSize: 12 }}>Placeholders: {"{remaining}"}, {"{threshold}"}, {"{cart_total}"}</span>
                    <span
                      title="{remaining} = amount needed for free delivery&#10;{threshold} = total threshold amount&#10;{cart_total} = current cart value"
                      style={{ cursor: "help", fontSize: 12, color: "var(--p-color-text-subdued)" }}
                    >ℹ️</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)" }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                    <span style={{ fontSize: 12 }}>Formatting: **bold**</span>
                    <span
                      title="Use **double asterisks** for bold text"
                      style={{ cursor: "help", fontSize: 12, color: "var(--p-color-text-subdued)" }}
                    >ℹ️</span>
                  </div>
                </div>

              <label>
                <s-text>Progress message</s-text>
                <input
                  type="text"
                  value={settings.fd_message_progress || ""}
                  onChange={(e) => setSettings({ ...settings, fd_message_progress: e.target.value })}
                  placeholder="Spend {remaining} more for free delivery"
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>📝</span>
                  <span style={{ fontSize: 12 }}>Defaults to "Spend {"{remaining}"} more for free delivery"</span>
                </div>
              </label>

              <label>
                <s-text>Unlocked message</s-text>
                <input
                  type="text"
                  value={settings.fd_message_unlocked || ""}
                  onChange={(e) => setSettings({ ...settings, fd_message_unlocked: e.target.value })}
                  placeholder="You've unlocked free delivery!"
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>📝</span>
                  <span style={{ fontSize: 12 }}>Defaults to "You've unlocked free delivery!"</span>
                </div>
              </label>

              <label style={{ display: "block" }}>
                <s-text>Empty cart message</s-text>
                <input
                  type="text"
                  value={settings.fd_message_empty || ""}
                  onChange={(e) => setSettings({ ...settings, fd_message_empty: e.target.value })}
                  placeholder="Free delivery on orders over £50"
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>📝</span>
                  <span style={{ fontSize: 12 }}>Leave blank to hide when cart is empty</span>
                </div>
              </label>

              <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 4 }}>
                <s-text style={{ fontWeight: 600 }}>Styling</s-text>
              </div>

              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={settings.fd_show_progress_bar || false}
                  onChange={(e) => setSettings({ ...settings, fd_show_progress_bar: e.target.checked })}
                />
                <s-text>Show progress bar</s-text>
              </label>

                {settings.fd_show_progress_bar && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <s-color-field
                      label="Progress bar color"
                      value={settings.fd_progress_bar_color || "#22c55e"}
                      onInput={(e) => setSettings({ ...settings, fd_progress_bar_color: e.target.value })}
                    />
                    <s-color-field
                      label="Progress bar background"
                      value={settings.fd_progress_bar_bg || "#e5e7eb"}
                      onInput={(e) => setSettings({ ...settings, fd_progress_bar_bg: e.target.value })}
                    />
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <s-color-field
                    label="Block background color"
                    value={settings.fd_bar_bg_color || "#f9fafb"}
                    onInput={(e) => setSettings({ ...settings, fd_bar_bg_color: e.target.value })}
                  />
                  <s-color-field
                    label="Text color"
                    value={settings.fd_bar_text_color || "#374151"}
                    onInput={(e) => setSettings({ ...settings, fd_bar_text_color: e.target.value })}
                  />
                </div>
              </div>
            </div>

              {/* Section 3: Exclusions */}
              <div
                style={{
                  border: "1px solid var(--p-color-border, #e5e7eb)",
                  borderRadius: "8px",
                  overflow: "hidden",
                  background: "var(--p-color-bg-surface, #ffffff)",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    padding: "12px 16px",
                    background: "var(--p-color-bg-surface-hover, #f8fafc)",
                    borderBottom: "1px solid var(--p-color-border, #e5e7eb)",
                  }}
                >
                  <s-text style={{ fontWeight: 600 }}>Exclusions</s-text>
                </div>
                {/* Content */}
                <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Show different messages for specific product types. Use unique tags/handles per rule.
                  </s-text>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: -4 }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>📝</span>
                    <span style={{ fontSize: 12 }}>Leave messages blank to use default: "Some items in your cart aren't eligible for free delivery"</span>
                  </div>

                  {/* Exclusion Rules List */}
                  {exclusionRules.map((rule, index) => {
                    const isExpanded = expandedRules.has(rule.id);
                    const tagCount = (rule.tags || []).length;
                    const handleCount = (rule.handles || []).length;
                    const summary = [
                      tagCount > 0 ? `${tagCount} tag${tagCount > 1 ? 's' : ''}` : null,
                      handleCount > 0 ? `${handleCount} handle${handleCount > 1 ? 's' : ''}` : null,
                    ].filter(Boolean).join(' • ') || 'No conditions';

                    return (
                      <div
                        key={rule.id}
                        style={{
                          border: "1px solid var(--p-color-border, #e5e7eb)",
                          borderRadius: "6px",
                          overflow: "hidden",
                        }}
                      >
                        {/* Rule Header (Collapsed) */}
                        <div
                          style={{
                            padding: "10px 12px",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            background: "var(--p-color-bg-surface-hover, #f8fafc)",
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            setExpandedRules(prev => {
                              const next = new Set(prev);
                              if (next.has(rule.id)) next.delete(rule.id);
                              else next.add(rule.id);
                              return next;
                            });
                          }}
                        >
                          <span style={{ fontSize: 12, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
                          <s-text style={{ fontWeight: 500, flex: 1 }}>Exclusion {index + 1}</s-text>
                          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>{summary}</s-text>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteExclusionWithUndo(rule.id, index);
                            }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9ca3af' }}
                            title="Delete"
                          >×</button>
                        </div>

                        {/* Rule Content (Expanded) */}
                        {isExpanded && (
                          <div style={{ padding: "12px", display: "grid", gap: 10, borderTop: "1px solid var(--p-color-border, #e5e7eb)" }}>
                            <label style={{ display: "block" }}>
                              <s-text size="small">Tags (comma-separated)</s-text>
                              <input
                                type="text"
                                value={(rule.tags || []).join(", ")}
                                onChange={(e) => {
                                  const tags = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                                  setExclusionRules(prev => prev.map(r => r.id === rule.id ? { ...r, tags } : r));
                                }}
                                placeholder="e.g., bulky, oversized"
                                style={{ width: "100%" }}
                              />
                            </label>

                            <label style={{ display: "block" }}>
                              <s-text size="small">Handles (comma-separated)</s-text>
                              <input
                                type="text"
                                value={(rule.handles || []).join(", ")}
                                onChange={(e) => {
                                  const handles = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                                  setExclusionRules(prev => prev.map(r => r.id === rule.id ? { ...r, handles } : r));
                                }}
                                placeholder="e.g., large-pond-kit"
                                style={{ width: "100%" }}
                              />
                            </label>

                            <label style={{ display: "block" }}>
                              <s-text size="small">Cart message</s-text>
                              <input
                                type="text"
                                value={rule.cart_message || ""}
                                onChange={(e) => {
                                  setExclusionRules(prev => prev.map(r => r.id === rule.id ? { ...r, cart_message: e.target.value } : r));
                                }}
                                placeholder="Leave blank for default message"
                                style={{ width: "100%" }}
                              />
                            </label>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 75px", gap: 12, alignItems: "start" }}>
                              <label style={{ display: "block" }}>
                                <s-text size="small">Announcement message</s-text>
                                <input
                                  type="text"
                                  value={rule.announcement_message || ""}
                                  onChange={(e) => {
                                    setExclusionRules(prev => prev.map(r => r.id === rule.id ? { ...r, announcement_message: e.target.value } : r));
                                  }}
                                  placeholder="Leave blank for default message"
                                  style={{ width: "100%" }}
                                />
                              </label>
                              <label style={{ display: "block" }}>
                                <s-text size="small">Timer</s-text>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <input
                                    type="number"
                                    min="1"
                                    max="60"
                                    value={rule.announcement_duration ?? 5}
                                    onChange={(e) => {
                                      setExclusionRules(prev => prev.map(r => r.id === rule.id ? { ...r, announcement_duration: parseInt(e.target.value) || 5 } : r));
                                    }}
                                    style={{ width: "100%" }}
                                  />
                                  <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>s</span>
                                </div>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add Exclusion Button */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <s-button
                      disabled={exclusionRules.length >= 5}
                      onClick={() => {
                        const newId = `rule-${Date.now()}`;
                        setExclusionRules(prev => [...prev, {
                          id: newId,
                          tags: [],
                          handles: [],
                          cart_message: '',
                          announcement_message: '',
                          announcement_duration: 5,
                        }]);
                        setExpandedRules(prev => new Set([...prev, newId]));
                      }}
                    >
                      Add Exclusion
                    </s-button>
                    <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                      {exclusionRules.length} of 5
                    </s-text>
                  </div>

                  {/* Undo banner for deleted exclusion */}
                  {lastDeletedExclusion && (
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
                      <s-text>Exclusion deleted.</s-text>
                      <s-button size="small" onClick={undoDeleteExclusion}>Undo</s-button>
                    </div>
                  )}

                  {/* Multi-match fallback message - only show when 2+ rules */}
                  {exclusionRules.length >= 2 && (
                    <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 4 }}>
                      <label style={{ display: "block" }}>
                        <s-text size="small">Multi-match message</s-text>
                        <input
                          type="text"
                          value={settings.fd_exclusion_multi_match_message || ""}
                          onChange={(e) => setSettings({ ...settings, fd_exclusion_multi_match_message: e.target.value })}
                          placeholder="Leave blank for default message"
                          style={{ width: "100%" }}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                          <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                          <span style={{ fontSize: 12 }}>Shown when cart has products matching multiple exclusion rules</span>
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

          {/* Section 4: Announcement Bar */}
          <div
            style={{
              border: "1px solid var(--p-color-border, #e5e7eb)",
              borderRadius: "8px",
              overflow: "hidden",
              background: "var(--p-color-bg-surface, #ffffff)",
              alignSelf: "start",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--p-color-bg-surface-hover, #f8fafc)",
                borderBottom: "1px solid var(--p-color-border, #e5e7eb)",
              }}
            >
              <s-text style={{ fontWeight: 600 }}>Announcement Bar</s-text>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <s-text size="small">{settings.fd_show_announcement_bar ? "Enabled" : "Disabled"}</s-text>
                <input
                  type="checkbox"
                  checked={settings.fd_show_announcement_bar || false}
                  onChange={(e) => setSettings({ ...settings, fd_show_announcement_bar: e.target.checked })}
                />
              </label>
            </div>

            {/* Content */}
            <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                  Show a bar at the top of the page with free delivery progress. Messages cycle automatically based on their timer.
                </s-text>

                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: -4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)" }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                    <span style={{ fontSize: 12 }}>Placeholders: {"{remaining}"}, {"{threshold}"}</span>
                    <span
                      title="{remaining} = amount needed for free delivery&#10;{threshold} = total threshold amount"
                      style={{ cursor: "help", fontSize: 12, color: "var(--p-color-text-subdued)" }}
                    >ℹ️</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)" }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                    <span style={{ fontSize: 12 }}>Formatting: **bold**, [link](url)</span>
                    <span
                      title="Use **double asterisks** for bold text&#10;Use [text](url) for clickable links"
                      style={{ cursor: "help", fontSize: 12, color: "var(--p-color-text-subdued)" }}
                    >ℹ️</span>
                  </div>
                </div>

                {/* Progress message + timer */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 75px", gap: 16, alignItems: "start" }}>
                  <label style={{ display: "block" }}>
                    <s-text>Progress message</s-text>
                    <input
                      type="text"
                      value={settings.fd_announcement_progress_message || ""}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_progress_message: e.target.value })}
                      placeholder="Spend {remaining} more for free delivery"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <s-text>Timer</s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        min="0"
                        value={settings.fd_announcement_progress_duration ?? 5}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_progress_duration: parseInt(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                      <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>s</span>
                    </div>
                  </label>
                </div>

                {/* Unlocked message + timer */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 75px", gap: 16, alignItems: "start" }}>
                  <label style={{ display: "block" }}>
                    <s-text>Unlocked message</s-text>
                    <input
                      type="text"
                      value={settings.fd_announcement_unlocked_message || ""}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_unlocked_message: e.target.value })}
                      placeholder="You've unlocked free delivery!"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <s-text>Timer</s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        min="0"
                        value={settings.fd_announcement_unlocked_duration ?? 5}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_unlocked_duration: parseInt(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                      <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>s</span>
                    </div>
                  </label>
                </div>

                {/* Empty cart message + timer */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 75px", gap: 16, alignItems: "start" }}>
                  <label style={{ display: "block" }}>
                    <s-text>Empty cart message</s-text>
                    <input
                      type="text"
                      value={settings.fd_announcement_empty_message || ""}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_empty_message: e.target.value })}
                      placeholder="Free delivery on orders over £50"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <s-text>Timer</s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        min="0"
                        value={settings.fd_announcement_empty_duration ?? 5}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_empty_duration: parseInt(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                      <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>s</span>
                    </div>
                  </label>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: -8 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>📝</span>
                  <span style={{ fontSize: 12 }}>Defaults to "Free delivery on orders over {"{threshold}"}" if blank and no additional messages</span>
                </div>

                {/* Additional Messages Section */}
                <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 4 }}>
                  <s-text style={{ fontWeight: 600 }}>Additional Messages</s-text>
                  <div style={{ marginTop: 4, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12 }}>
                    <div style={{ marginBottom: 6 }}>Static messages that cycle alongside the free delivery message.</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ flexShrink: 0 }}>💡</span>
                      <span>Formatting: **bold**, [link](url)</span>
                      <span
                        title="Use **double asterisks** for bold text&#10;Use [text](url) for clickable links"
                        style={{ cursor: "help", color: "var(--p-color-text-subdued)" }}
                      >ℹ️</span>
                    </div>
                  </div>
                </div>

                {/* Additional message 1 + timer */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 75px", gap: 16, alignItems: "start" }}>
                  <label style={{ display: "block" }}>
                    <s-text>Additional message 1</s-text>
                    <input
                      type="text"
                      value={settings.fd_announcement_additional1_message || ""}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_additional1_message: e.target.value })}
                      placeholder="Free returns within 30 days"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <s-text>Timer</s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        min="0"
                        value={settings.fd_announcement_additional1_duration ?? 5}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_additional1_duration: parseInt(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                      <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>s</span>
                    </div>
                  </label>
                </div>

                {/* Additional message 2 + timer */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 75px", gap: 16, alignItems: "start" }}>
                  <label style={{ display: "block" }}>
                    <s-text>Additional message 2</s-text>
                    <input
                      type="text"
                      value={settings.fd_announcement_additional2_message || ""}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_additional2_message: e.target.value })}
                      placeholder="New arrivals every week"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <s-text>Timer</s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        min="0"
                        value={settings.fd_announcement_additional2_duration ?? 5}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_additional2_duration: parseInt(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                      <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>s</span>
                    </div>
                  </label>
                </div>

                {/* Styling Section */}
                <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 4 }}>
                  <s-text style={{ fontWeight: 600 }}>Styling</s-text>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <s-color-field
                    label="Background color"
                    value={settings.fd_announcement_bg_color || "#1f2937"}
                    onInput={(e) => setSettings({ ...settings, fd_announcement_bg_color: e.target.value })}
                  />
                  <s-color-field
                    label="Text color"
                    value={settings.fd_announcement_text_color || "#ffffff"}
                    onInput={(e) => setSettings({ ...settings, fd_announcement_text_color: e.target.value })}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label>
                    <s-text>Text size</s-text>
                    <select
                      value={settings.fd_announcement_text_size || "medium"}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_text_size: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="small">Small (12px)</option>
                      <option value="medium">Medium (14px)</option>
                      <option value="large">Large (16px)</option>
                    </select>
                  </label>
                  <label>
                    <s-text>Bar height</s-text>
                    <select
                      value={settings.fd_announcement_bar_height || "comfortable"}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_bar_height: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="compact">Compact</option>
                      <option value="standard">Standard</option>
                      <option value="comfortable">Comfortable</option>
                      <option value="spacious">Spacious</option>
                    </select>
                  </label>
                </div>

                <label style={{ display: "block" }}>
                  <s-text>Content max-width</s-text>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="number"
                      min="0"
                      value={settings.fd_announcement_content_max_width || ""}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_content_max_width: e.target.value ? parseInt(e.target.value) : null })}
                      placeholder="e.g. 1200"
                      style={{ width: "120px" }}
                    />
                    <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>px</span>
                  </div>
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: -8 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Aligns chevrons to page content width. Leave empty for full width.</span>
                </div>

                {/* Link Styling */}
                <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 8, display: "grid", gap: 12 }}>
                  <s-text style={{ fontWeight: 600 }}>Link Styling</s-text>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Style links created from [text](url) markdown.
                  </s-text>

                  {/* Color - full width */}
                  <div>
                    <s-text size="small">Color</s-text>
                    <s-color-field
                      label=""
                      value={settings.fd_announcement_link_color || "#ffffff"}
                      onInput={(e) => setSettings({ ...settings, fd_announcement_link_color: e.target.value })}
                    />
                  </div>

                  {/* Decoration + Thickness - 50% each */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <s-text size="small">Decoration</s-text>
                      <select
                        value={settings.fd_announcement_link_decoration || "underline"}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_link_decoration: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="underline">Underline</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                    <div>
                      <s-text size="small">Thickness</s-text>
                      <select
                        value={settings.fd_announcement_link_thickness || "1px"}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_link_thickness: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="1px">1px</option>
                        <option value="2px">2px</option>
                        <option value="3px">3px</option>
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
                        value={settings.fd_announcement_link_hover_color || "#e5e7eb"}
                        onInput={(e) => setSettings({ ...settings, fd_announcement_link_hover_color: e.target.value })}
                      />
                    </div>

                    {/* Hover Decoration + Thickness - 50% each */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <s-text size="small">Decoration</s-text>
                        <select
                          value={settings.fd_announcement_link_hover_decoration || "underline"}
                          onChange={(e) => setSettings({ ...settings, fd_announcement_link_hover_decoration: e.target.value })}
                          style={{ width: "100%" }}
                        >
                          <option value="underline">Underline</option>
                          <option value="none">None</option>
                        </select>
                      </div>
                      <div>
                        <s-text size="small">Thickness</s-text>
                        <select
                          value={settings.fd_announcement_link_hover_thickness || "2px"}
                          onChange={(e) => setSettings({ ...settings, fd_announcement_link_hover_thickness: e.target.value })}
                          style={{ width: "100%" }}
                        >
                          <option value="1px">1px</option>
                          <option value="2px">2px</option>
                          <option value="3px">3px</option>
                        </select>
                      </div>
                    </div>

                    {/* Opacity - full width */}
                    <div>
                      <s-text size="small">Opacity</s-text>
                      <select
                        value={settings.fd_announcement_link_hover_opacity ?? 1}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_link_hover_opacity: parseFloat(e.target.value) })}
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
            </div>
          </div>

          {/* Bottom Save Button */}
          <SaveButtonRow />
        </div>
      </s-layout>
    </s-page>
  );
}
