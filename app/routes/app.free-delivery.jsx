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
    },
  });

  const json = await res.json();
  if (json.errors) {
    safeLogError("Failed to fetch settings", json.errors);
    throw new Error("Unable to load settings. Please refresh the page.");
  }

  const shopId = json?.data?.shop?.id;
  const settingsMf = json?.data?.shop?.settings;

  return {
    settings: settingsMf?.value ?? "{}",
    shopId,
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
  const { settings: settingsRaw, shopId } = useLoaderData();
  const fetcher = useFetcher();

  const [settings, setSettings] = useState(() => {
    try {
      return JSON.parse(settingsRaw);
    } catch {
      return {};
    }
  });

  const [saveStatus, setSaveStatus] = useState("");

  // Exclusion input text state
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

  // Auto-save after 2 seconds of inactivity
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    const settingsChanged = JSON.stringify(settings) !== initialSettingsRef.current;
    if (!settingsChanged) return;
    if (fetcher.state !== "idle") return;

    autoSaveTimerRef.current = setTimeout(() => {
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

  const handleSave = () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setSaveStatus("Saving...");
    fetcher.submit(
      { settings: JSON.stringify(settings), shopId },
      { method: "POST" }
    );
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

              {/* Section 2: Free Delivery Messaging */}
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
                <s-text style={{ fontWeight: 600 }}>Free Delivery Messaging</s-text>
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
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Use {"{remaining}"} for amount needed, {"{threshold}"} for total threshold, {"{cart_total}"} for current cart value</span>
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
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Shown when customer has reached the threshold</span>
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
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
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
                    Products matching these tags or handles will show the exclusion message instead
                  </s-text>

                <label style={{ display: "block" }}>
                  <s-text>Product tags (comma-separated)</s-text>
                  <input
                    type="text"
                    value={excludeTagsText}
                    onChange={(e) => setExcludeTagsText(e.target.value)}
                    onBlur={() => {
                      const tags = excludeTagsText.split(",").map(s => s.trim()).filter(Boolean);
                      setExcludeTagsText(tags.join(", "));
                      setSettings({ ...settings, fd_exclude_tags: tags });
                    }}
                    placeholder="e.g., no-free-delivery, oversized"
                    style={{ width: "100%" }}
                  />
                </label>

                <label style={{ display: "block" }}>
                  <s-text>Product handles (comma-separated)</s-text>
                  <input
                    type="text"
                    value={excludeHandlesText}
                    onChange={(e) => setExcludeHandlesText(e.target.value)}
                    onBlur={() => {
                      const handles = excludeHandlesText.split(",").map(s => s.trim()).filter(Boolean);
                      setExcludeHandlesText(handles.join(", "));
                      setSettings({ ...settings, fd_exclude_handles: handles });
                    }}
                    placeholder="e.g., large-pond-kit, bulky-item"
                    style={{ width: "100%" }}
                  />
                </label>

                <label>
                  <s-text>Exclusion message (Free Delivery Messaging)</s-text>
                  <input
                    type="text"
                    value={settings.fd_message_excluded || ""}
                    onChange={(e) => setSettings({ ...settings, fd_message_excluded: e.target.value })}
                    placeholder="Free delivery not available for some items in your cart"
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                    <span style={{ fontSize: 12 }}>Leave blank to hide messaging when excluded products are in cart</span>
                  </div>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 75px", gap: 16, alignItems: "start" }}>
                  <label style={{ display: "block" }}>
                    <s-text>Exclusion message (Announcement Bar)</s-text>
                    <input
                      type="text"
                      value={settings.fd_announcement_excluded_message || ""}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_excluded_message: e.target.value })}
                      placeholder="Free delivery not available for some items"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <s-text>Timer</s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        min="0"
                        value={settings.fd_announcement_excluded_duration ?? 5}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_excluded_duration: parseInt(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                      <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>s</span>
                    </div>
                  </label>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: -8 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Leave blank to hide bar when excluded products are in cart. Timer controls cycling duration.</span>
                </div>
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
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: -8 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Use {"{remaining}"} for amount needed, {"{threshold}"} for total threshold</span>
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
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Leave blank to hide bar when cart is empty</span>
                </div>

                {/* Additional Messages Section */}
                <div style={{ borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 12, marginTop: 4 }}>
                  <s-text style={{ fontWeight: 600 }}>Additional Messages</s-text>
                  <div style={{ marginTop: 4, color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12 }}>
                    <div style={{ marginBottom: 6 }}>Static messages that cycle alongside the free delivery message.</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ flexShrink: 0 }}>💡</span>
                      <span>Use {"{countdown}"} for a live countdown to cutoff time.</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span style={{ flexShrink: 0 }}>💡</span>
                      <span>Use **double asterisks** for <strong>bold text</strong>.</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span style={{ flexShrink: 0 }}>💡</span>
                      <span>Use [text](url) to add a clickable link.</span>
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
