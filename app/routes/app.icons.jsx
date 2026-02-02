// ============================================================================
// IMPORTS
// ============================================================================

import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { safeLogError, friendlyError, validateSettings } from "../utils/validation";
import { getIconSvg, PRESET_ICONS } from "../utils/icons";
import {
  GET_SHOP_DELIVERY_DATA,
  GET_SHOP_ID,
  SET_METAFIELDS_MINIMAL,
  METAFIELD_NAMESPACE,
  CONFIG_KEY,
  SETTINGS_KEY,
} from "../graphql/queries";

// ============================================================================
// DEFAULT CUSTOM ICONS
// ============================================================================

function defaultCustomIcons() {
  return [
    { name: "Custom 1", svg: "", url: "" },
    { name: "Custom 2", svg: "", url: "" },
    { name: "Custom 3", svg: "", url: "" },
    { name: "Custom 4", svg: "", url: "" },
    { name: "Custom 5", svg: "", url: "" },
    { name: "Custom 6", svg: "", url: "" },
  ];
}

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
      return { ok: false, error: friendlyError(shopJson.errors, "Unable to save. Please try again.") };
    }
    shopId = shopJson?.data?.shop?.id;
  }

  const setRes = await admin.graphql(SET_METAFIELDS_MINIMAL, {
    variables: {
      metafields: [
        {
          ownerId: shopId,
          namespace: METAFIELD_NAMESPACE,
          key: SETTINGS_KEY,
          type: "json",
          value: JSON.stringify(settingsValidation.data),
        },
      ],
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

export default function IconsPage() {
  const { settings: settingsRaw, shopId } = useLoaderData();
  const fetcher = useFetcher();

  const [settings, setSettings] = useState(() => {
    try {
      const parsed = JSON.parse(settingsRaw);
      // Ensure custom_icons array exists with 6 slots
      if (!parsed.custom_icons || parsed.custom_icons.length < 6) {
        parsed.custom_icons = defaultCustomIcons();
      }
      return parsed;
    } catch (error) {
      safeLogError("Failed to parse settings", error);
      return { custom_icons: defaultCustomIcons() };
    }
  });

  const [saveStatus, setSaveStatus] = useState("");
  const [hoverDeleteIdx, setHoverDeleteIdx] = useState(null); // Track which delete button is hovered

  // Handle save responses
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok === true) {
      setSaveStatus("Saved!");
      const timer = setTimeout(() => setSaveStatus(""), 2000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.state, fetcher.data]);

  const handleSave = () => {
    setSaveStatus("Saving...");
    fetcher.submit(
      { settings: JSON.stringify(settings), shopId },
      { method: "POST" }
    );
  };

  const updateCustomIcon = (index, field, value) => {
    const newIcons = [...settings.custom_icons];
    newIcons[index] = { ...newIcons[index], [field]: value };
    setSettings({ ...settings, custom_icons: newIcons });
  };

  const resetCustomIcon = (index) => {
    const newIcons = [...settings.custom_icons];
    newIcons[index] = { name: `Custom ${index + 1}`, svg: "", url: "" };
    setSettings({ ...settings, custom_icons: newIcons });
  };

  const resetConnector = () => {
    setSettings({ ...settings, custom_connector_svg: "" });
  };

  const customIcons = settings.custom_icons || defaultCustomIcons();

  return (
    <s-page heading="Icons">
      <div style={{ display: "grid", gap: 24, maxWidth: 800 }}>

        {/* Available Preset Icons */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Available Preset Icons</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 12, display: "block" }}>
            These icons are available in all icon dropdowns throughout the app
          </s-text>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
              gap: 12,
            }}
          >
            {PRESET_ICONS.map((icon) => (
              <div
                key={icon.value}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: 8,
                  borderRadius: 6,
                  background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    color: "#6b7280",
                  }}
                  dangerouslySetInnerHTML={{ __html: getIconSvg(icon.value, "solid") || "" }}
                />
                <span style={{ textAlign: "center", fontSize: "9px", color: "#6b7280", display: "block" }}>
                  {icon.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Emoji Reference */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Emoji Reference</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 12, display: "block" }}>
            Click any emoji to copy it, then paste into your message boxes
          </s-text>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["📦", "🚚", "✅", "⏰", "🏠", "📍", "🎁", "⭐", "💡", "🔥", "⚡", "✨", "🛒", "📬", "📮", "🚀", "💨", "🎯", "👍", "❤️"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(emoji);
                }}
                style={{
                  width: 40,
                  height: 40,
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  border: "1px solid var(--p-color-border, #e5e7eb)",
                  background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                  cursor: "pointer",
                }}
                title={`Click to copy ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Icon Resources */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <s-heading>Icon Resources</s-heading>
          <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, marginBottom: 12, display: "block" }}>
            These libraries use scalable SVGs with color inheritance. Click an icon to copy its SVG code.
          </s-text>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <a
              href="https://heroicons.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--p-color-border, #e5e7eb)",
                background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                color: "var(--p-color-text, #374151)",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              Heroicons
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style={{ opacity: 0.5 }}>
                <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
              </svg>
            </a>
            <a
              href="https://remixicon.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--p-color-border, #e5e7eb)",
                background: "var(--p-color-bg-surface-secondary, #f9fafb)",
                color: "var(--p-color-text, #374151)",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              Remix Icon
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style={{ opacity: 0.5 }}>
                <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
              </svg>
            </a>
          </div>
        </div>

        {/* Save Button */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <s-button variant="primary" onClick={handleSave}>
            Save Icons
          </s-button>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            color: "var(--p-color-text-success, #16a34a)",
            fontSize: "14px",
            fontWeight: 500,
            visibility: saveStatus === "Saved!" ? "visible" : "hidden",
            minWidth: 60,
          }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
            Saved
          </span>
          {fetcher.data?.error && (
            <s-text style={{ color: "var(--p-color-text-critical, #dc2626)" }}>
              {fetcher.data.error}
            </s-text>
          )}
        </div>

        {/* Custom SVG Icons (slots 1-3) */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            display: "grid",
            gap: 16,
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <div>
            <s-heading>Custom SVG Icons (Recommended)</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, display: "block" }}>
              Paste SVG code directly. These icons will inherit the icon color setting from each rule.
            </s-text>
          </div>

          {[0, 1, 2].map((index) => (
            <div
              key={index}
              style={{
                border: "1px solid var(--p-color-border, #e5e7eb)",
                borderRadius: 6,
                padding: 12,
                background: "var(--p-color-bg-surface-secondary, #f9fafb)",
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <s-text size="small">Name</s-text>
                    <button
                      type="button"
                      onClick={() => resetCustomIcon(index)}
                      onMouseEnter={() => setHoverDeleteIdx(`svg-${index}`)}
                      onMouseLeave={() => setHoverDeleteIdx(null)}
                      title="Clear this icon"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 4,
                        cursor: "pointer",
                        opacity: 0.6,
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={hoverDeleteIdx === `svg-${index}` ? "var(--p-color-icon-critical, #dc2626)" : "currentColor"}
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
                    </button>
                  </div>
                  <input
                    type="text"
                    value={customIcons[index]?.name || `Custom ${index + 1}`}
                    onChange={(e) => updateCustomIcon(index, "name", e.target.value)}
                    placeholder={`Custom ${index + 1}`}
                    style={{ width: "100%" }}
                  />
                </div>

                <label>
                  <s-text size="small">SVG Code</s-text>
                  <textarea
                    value={customIcons[index]?.svg || ""}
                    onChange={(e) => updateCustomIcon(index, "svg", e.target.value)}
                    placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...</svg>'
                    style={{
                      width: "100%",
                      minHeight: 80,
                      marginTop: 4,
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}
                  />
                </label>

                {/* Preview */}
                {customIcons[index]?.svg && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <s-text size="small">Preview:</s-text>
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        color: "#374151",
                      }}
                      dangerouslySetInnerHTML={{ __html: customIcons[index].svg }}
                    />
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        color: "#374151",
                      }}
                      dangerouslySetInnerHTML={{ __html: customIcons[index].svg }}
                    />
                    <span
                      style={{
                        width: 48,
                        height: 48,
                        color: "#374151",
                      }}
                      dangerouslySetInnerHTML={{ __html: customIcons[index].svg }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Custom Icon URLs (slots 4-6) */}
        <div
          style={{
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            padding: "16px",
            display: "grid",
            gap: 16,
            background: "var(--p-color-bg-surface, #ffffff)",
          }}
        >
          <div>
            <s-heading>Custom Icon URLs</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, display: "block" }}>
              Use URLs to hosted icon files. Note: URL icons will not inherit the icon color.
            </s-text>
          </div>

          {[3, 4, 5].map((index) => (
            <div
              key={index}
              style={{
                border: "1px solid var(--p-color-border, #e5e7eb)",
                borderRadius: 6,
                padding: 12,
                background: "var(--p-color-bg-surface-secondary, #f9fafb)",
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <s-text size="small">Name</s-text>
                    <button
                      type="button"
                      onClick={() => resetCustomIcon(index)}
                      onMouseEnter={() => setHoverDeleteIdx(`url-${index}`)}
                      onMouseLeave={() => setHoverDeleteIdx(null)}
                      title="Clear this icon"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 4,
                        cursor: "pointer",
                        opacity: 0.6,
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={hoverDeleteIdx === `url-${index}` ? "var(--p-color-icon-critical, #dc2626)" : "currentColor"}
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
                    </button>
                  </div>
                  <input
                    type="text"
                    value={customIcons[index]?.name || `Custom ${index + 1}`}
                    onChange={(e) => updateCustomIcon(index, "name", e.target.value)}
                    placeholder={`Custom ${index + 1}`}
                    style={{ width: "100%" }}
                  />
                </div>

                <label>
                  <s-text size="small">Icon URL</s-text>
                  <input
                    type="url"
                    value={customIcons[index]?.url || ""}
                    onChange={(e) => updateCustomIcon(index, "url", e.target.value)}
                    placeholder="https://example.com/icon.svg"
                    style={{ width: "100%", marginTop: 4 }}
                  />
                </label>

                {/* Preview */}
                {customIcons[index]?.url && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <s-text size="small">Preview:</s-text>
                    <img
                      src={customIcons[index].url}
                      alt=""
                      style={{ width: 24, height: 24, objectFit: "contain" }}
                    />
                    <img
                      src={customIcons[index].url}
                      alt=""
                      style={{ width: 32, height: 32, objectFit: "contain" }}
                    />
                    <img
                      src={customIcons[index].url}
                      alt=""
                      style={{ width: 48, height: 48, objectFit: "contain" }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Custom ETA Connector */}
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
          <div>
            <s-heading>Custom ETA Connector</s-heading>
            <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4, display: "block" }}>
              SVG code for a custom connector between ETA Timeline stages. Will inherit the connector color setting.
            </s-text>
          </div>

          <div
            style={{
              border: "1px solid var(--p-color-border, #e5e7eb)",
              borderRadius: 6,
              padding: 12,
              background: "var(--p-color-bg-surface-secondary, #f9fafb)",
            }}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <s-text size="small">Connector SVG Code</s-text>
                  <button
                    type="button"
                    onClick={resetConnector}
                    onMouseEnter={() => setHoverDeleteIdx("connector")}
                    onMouseLeave={() => setHoverDeleteIdx(null)}
                    title="Clear connector"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 4,
                      cursor: "pointer",
                      opacity: 0.6,
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={hoverDeleteIdx === "connector" ? "var(--p-color-icon-critical, #dc2626)" : "currentColor"}
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
                  </button>
                </div>
                <textarea
                  value={settings.custom_connector_svg || ""}
                  onChange={(e) => setSettings({ ...settings, custom_connector_svg: e.target.value })}
                  placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...</svg>'
                  style={{
                    width: "100%",
                    minHeight: 80,
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                />
              </div>

              {/* Preview - only show when SVG code is present */}
              {settings.custom_connector_svg?.trim() && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <s-text size="small">Preview:</s-text>
                  <span
                    style={{ width: 36, height: 36, color: "#374151" }}
                    dangerouslySetInnerHTML={{ __html: settings.custom_connector_svg }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Save Button (bottom) */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <s-button variant="primary" onClick={handleSave}>
            Save Icons
          </s-button>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            color: "var(--p-color-text-success, #16a34a)",
            fontSize: "14px",
            fontWeight: 500,
            visibility: saveStatus === "Saved!" ? "visible" : "hidden",
            minWidth: 60,
          }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
            Saved
          </span>
        </div>

      </div>
    </s-page>
  );
}

// ============================================================================
// ERROR BOUNDARY & HEADERS EXPORTS
// ============================================================================

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
