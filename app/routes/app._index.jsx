import { useState, useEffect } from "react";
import { useLoaderData, useRouteError, useFetcher, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureDeliveryRulesDefinition } from "../models/deliveryRules.server";
import { newRuleId } from "../utils/idGenerators";
import { HOLIDAY_DEFINITIONS } from "../utils/holidays";
import { getIconSvg, generateIconsMetafield } from "../utils/icons";
import { ColorPicker } from "../components/ColorPicker";
import { FontSelector } from "../components/FontSelector";
import {
  GET_SHOP_DELIVERY_DATA,
  SET_METAFIELDS,
  SET_METAFIELDS_MINIMAL,
  METAFIELD_NAMESPACE,
  CONFIG_KEY,
  SETTINGS_KEY,
  ICONS_KEY,
} from "../graphql/queries";

// ============================================================================
// LOADER
// ============================================================================

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  // Ensure all metafield definitions exist (config, settings, icons)
  const defResult = await ensureDeliveryRulesDefinition(admin);
  console.log("[ICONS DEBUG - DASHBOARD] Definition result:", JSON.stringify(defResult));

  // Fetch current config, settings, and icons
  const res = await admin.graphql(GET_SHOP_DELIVERY_DATA, {
    variables: {
      namespace: METAFIELD_NAMESPACE,
      configKey: CONFIG_KEY,
      settingsKey: SETTINGS_KEY,
      iconsKey: ICONS_KEY,
    },
  });

  const json = await res.json();
  const shopId = json?.data?.shop?.id;
  const configMf = json?.data?.shop?.config;
  const settingsMf = json?.data?.shop?.settings;
  const iconsMf = json?.data?.shop?.icons;
  console.log("[ICONS DEBUG - DASHBOARD] iconsMf exists:", !!iconsMf?.value);

  // Always update icons metafield (ensures new icons are pushed after deploys)
  {
    console.log("[ICONS DEBUG - DASHBOARD] Updating icons metafield...");
    const iconsData = generateIconsMetafield();
    const iconsDataStr = JSON.stringify(iconsData);
    console.log("[ICONS DEBUG - DASHBOARD] Icons data size:", iconsDataStr.length, "bytes, keys:", Object.keys(iconsData).length);

    const setIconsRes = await admin.graphql(SET_METAFIELDS, {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: ICONS_KEY,
            type: "json",
            value: iconsDataStr,
          },
        ],
      },
    });

    const setIconsJson = await setIconsRes.json();
    console.log("[ICONS DEBUG - DASHBOARD] Mutation response:", JSON.stringify(setIconsJson));
    if (setIconsJson.errors) {
      console.error("[ICONS DEBUG - DASHBOARD] GraphQL errors:", setIconsJson.errors);
    }
    const iconsErrors = setIconsJson?.data?.metafieldsSet?.userErrors ?? [];
    if (iconsErrors.length) {
      console.error("[ICONS DEBUG - DASHBOARD] User errors:", iconsErrors);
    }
    if (!setIconsJson.errors && !iconsErrors.length) {
      console.log("[ICONS DEBUG - DASHBOARD] Icons metafield updated successfully!");
    }
  }

  let hasRules = false;
  let config = null;
  let settings = null;
  let ruleCount = 0;

  if (configMf?.value) {
    try {
      config = JSON.parse(configMf.value);
      // Check v2/v3 format for rules - only count LIVE profile's rules
      if ((config.version === 2 || config.version === 3) && config.profiles) {
        const liveProfile = config.profiles.find(p => p.id === config.liveProfileId) || config.profiles[0];
        ruleCount = liveProfile?.rules?.length || 0;
        hasRules = ruleCount > 0;
      } else if (config.rules) {
        ruleCount = config.rules.length;
        hasRules = ruleCount > 0;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  if (settingsMf?.value) {
    try {
      settings = JSON.parse(settingsMf.value);
    } catch (e) {
      // Ignore parse errors
    }
  }

  // Build bank holiday countries for dropdown
  const bankHolidayCountries = {};
  for (const [code, def] of Object.entries(HOLIDAY_DEFINITIONS)) {
    bankHolidayCountries[code] = { name: def.name };
  }

  return {
    shopDomain,
    shopId,
    hasRules,
    config,
    settings,
    ruleCount,
    bankHolidayCountries,
  };
};

// ============================================================================
// ACTION - Save wizard settings and rule
// ============================================================================

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const shopId = formData.get("shopId");
  const actionType = formData.get("action");

  if (actionType === "saveSettings") {
    // Save settings only
    const settingsData = JSON.parse(formData.get("settingsData"));

    const setRes = await admin.graphql(SET_METAFIELDS_MINIMAL, {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: SETTINGS_KEY,
            type: "json",
            value: JSON.stringify(settingsData),
          },
        ],
      },
    });

    const setJson = await setRes.json();
    if (setJson.errors) {
      return { ok: false, error: "Failed to save settings" };
    }

    return { ok: true, action: "saveSettings" };
  }

  if (actionType === "saveRule") {
    // Save rule only
    const ruleData = JSON.parse(formData.get("ruleData"));
    const existingConfig = formData.get("config");

    let config;
    try {
      config = existingConfig ? JSON.parse(existingConfig) : null;
    } catch (e) {
      config = null;
    }

    // Ensure v3 format (or accept v2 since migration handles it)
    if (!config || (config.version !== 2 && config.version !== 3)) {
      config = {
        version: 3,
        profiles: [{
          id: "default",
          name: "Default",
          rules: [],
          fd_threshold: 0,
          fd_exclusion_rules: [],
          fd_pricing_configs: [],
          fd_show_announcement_bar: false,
        }],
        activeProfileId: "default",
        liveProfileId: "default",
      };
    }

    // Add the new rule to the active profile
    const activeProfile = config.profiles.find(p => p.id === config.activeProfileId) || config.profiles[0];
    if (activeProfile) {
      activeProfile.rules.push(ruleData);
    }

    // Build metafields to save
    const metafields = [
      {
        ownerId: shopId,
        namespace: METAFIELD_NAMESPACE,
        key: CONFIG_KEY,
        type: "json",
        value: JSON.stringify(config),
      },
    ];

    // If applying border to global settings, merge with existing settings
    const globalBorderStr = formData.get("globalBorder");
    if (globalBorderStr) {
      const globalBorder = JSON.parse(globalBorderStr);
      // Fetch existing settings to merge
      const existingSettings = formData.get("existingSettings");
      let settingsData = {};
      try { settingsData = existingSettings ? JSON.parse(existingSettings) : {}; } catch (e) { settingsData = {}; }
      Object.assign(settingsData, globalBorder);
      metafields.push({
        ownerId: shopId,
        namespace: METAFIELD_NAMESPACE,
        key: SETTINGS_KEY,
        type: "json",
        value: JSON.stringify(settingsData),
      });
    }

    const setRes = await admin.graphql(SET_METAFIELDS_MINIMAL, {
      variables: { metafields },
    });

    const setJson = await setRes.json();
    if (setJson.errors) {
      return { ok: false, error: "Failed to save rule" };
    }

    return { ok: true, action: "saveRule" };
  }

  return { ok: false, error: "Unknown action" };
};

// ============================================================================
// COMPONENT
// ============================================================================

// Flip card component for retro clock-style stats using SVG digits
function FlipCard({ value, label }) {
  // Pad to 2 digits and split into individual digits
  const digits = String(value).padStart(2, "0").split("");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {digits.map((digit, index) => (
          <img
            key={index}
            src={`/images/flip/flip_${digit}.svg`}
            alt={digit}
            style={{ height: 72, width: "auto" }}
          />
        ))}
      </div>
      <span style={{ fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: "bold" }}>
        {label}
      </span>
    </div>
  );
}

// Message preview helper - renders message with placeholders and bold text
function WizardStageIcon({ icon, color }) {
  const c = color || "#111827";
  if (icon === "none") {
    return <span style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: "1px dashed #d1d5db", color: "#9ca3af", fontSize: 12 }}>—</span>;
  }
  return <span dangerouslySetInnerHTML={{ __html: getIconSvg(icon, "solid") || "" }} style={{ width: 36, height: 36, display: "block", color: c }} />;
}

function WizardConnector({ style: connStyle, color }) {
  const c = color || "#111827";
  if (connStyle === "line") return <span style={{ display: "block", width: 32, borderTop: `1.5px solid ${c}` }} />;
  if (connStyle === "big-arrow") return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={c} style={{ width: 20, height: 20 }}><path fillRule="evenodd" d="M16.72 7.72a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H3a.75.75 0 0 1 0-1.5h16.19l-2.47-2.47a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>;
  if (connStyle === "arrow-dot") return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill={c} style={{ width: 20, height: 20 }}><path d="M780-380q-31 0-56-17t-36-43H80v-80h608q11-26 36-43t56-17q42 0 71 29t29 71q0 42-29 71t-71 29Z" /></svg>;
  return <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke={c} style={{ width: 20, height: 20 }}><path strokeLinecap="round" strokeLinejoin="round" d="m5.25 4.5 7.5 7.5-7.5 7.5m6-15 7.5 7.5-7.5 7.5" /></svg>;
}

function MessagePreview({ text }) {
  if (!text) return null;

  // Replace placeholders with sample values
  let preview = text
    .replace(/\{countdown\}/g, "2h 34m")
    .replace(/\{arrival\}/g, "Wed, Feb 12")
    .replace(/\{express\}/g, "Thu, Feb 6")
    .replace(/\{lb\}/g, "<br/>");

  // Convert **bold** to <strong>
  preview = preview.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  return (
    <div
      style={{
        marginTop: "8px",
        padding: "8px 12px",
        background: "#f9fafb",
        borderRadius: "6px",
        fontSize: "14px",
        color: "#374151",
        wordBreak: "break-word",
        overflow: "hidden",
      }}
      dangerouslySetInnerHTML={{ __html: preview }}
    />
  );
}

// Setup step accordion component
function SetupStep({ step, isExpanded, isComplete, onToggle, onMarkComplete, onMarkIncomplete, onAction }) {
  const navigate = useNavigate();
  return (
    <div
      style={{
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      {/* Header row - clickable */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "16px",
          cursor: "pointer",
          background: isExpanded ? "#f9fafb" : "transparent",
          transition: "background 0.15s ease",
        }}
      >
        {/* Icon - checkmark for core steps, arrow for additional steps */}
        {step.isAdditional ? (
          <div
            style={{
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 12,
              flexShrink: 0,
              color: "#9ca3af",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        ) : (
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 12,
              flexShrink: 0,
              background: isComplete ? "#22c55e" : "transparent",
              border: isComplete ? "none" : "2px solid #d1d5db",
            }}
          >
            {isComplete && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        )}

        {/* Title */}
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 500, color: step.isAdditional ? "#374151" : (isComplete ? "#6b7280" : "#111827") }}>
            {step.title}
          </span>
        </div>

        {/* Chevron */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          style={{
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            color: "#9ca3af",
          }}
        >
          <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ padding: "0 16px 20px 52px" }}>
          {/* Description */}
          <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 16px 0" }}>
            {step.description}
          </p>

          {/* Video with steps */}
          {step.video && (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 8 }}>
                <video
                  controls
                  style={{ width: "50%", borderRadius: 8, border: "1px solid #e5e7eb" }}
                >
                  <source src={step.video} type="video/mp4" />
                </video>
                {step.videoSteps && (
                  <div style={{ flex: 1, fontSize: 13 }}>
                    <ol style={{ margin: 0, paddingLeft: 20 }}>
                      {step.videoSteps.map((stepText, stepIdx) => (
                        <li key={stepIdx} style={{ color: "#374151", marginBottom: 6 }}>
                          {stepText}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 16 }}>
                <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                <span style={{ fontSize: 12 }}>To watch fullscreen (recommended), click the Picture-in-Picture button on the video player, then click the fullscreen button on the pop-out window.</span>
              </div>
            </>
          )}

          {/* Images with steps or placeholder */}
          {step.images && step.images.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 16 }}>
              {(() => {
                let stepCounter = 1;
                return step.images.map((imgData, idx) => {
                  const img = typeof imgData === "string" ? { src: imgData } : imgData;
                  const startNum = stepCounter;
                  if (img.steps) stepCounter += img.steps.length;
                  return (
                    <div key={idx} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                      <img
                        src={img.src}
                        alt={`${step.title} - Part ${idx + 1}`}
                        onClick={() => step.onImageClick?.(img.src)}
                        style={{
                          width: "50%",
                          borderRadius: 8,
                          border: "1px solid #e5e7eb",
                          cursor: step.onImageClick ? "zoom-in" : "default",
                        }}
                      />
                      {img.steps && (
                        <div style={{ flex: 1, fontSize: 13 }}>
                          <ol start={startNum} style={{ margin: 0, paddingLeft: 20 }}>
                            {img.steps.map((stepText, stepIdx) => (
                              <li key={stepIdx} style={{ color: "#374151", marginBottom: 6 }}>
                                {stepText}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          ) : null}

          {/* Action buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {step.actionUrl ? (
              <a
                href={step.actionUrl}
                target={step.actionUrl.startsWith("/") ? "_self" : "_blank"}
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "8px 16px",
                  background: "#2563eb",
                  color: "white",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                {step.actionLabel}
              </a>
            ) : step.onAction ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAction();
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "8px 16px",
                  background: "#2563eb",
                  color: "white",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {step.actionLabel}
              </button>
            ) : null}

            {step.secondaryUrl && (
              <button
                onClick={() => navigate(step.secondaryUrl)}
                style={{
                  color: "#2563eb",
                  fontSize: 14,
                  textDecoration: "none",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {step.secondaryLabel}
              </button>
            )}

            {step.footerNote && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", width: "100%", marginTop: 4 }}>
                <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                <span style={{ fontSize: 12 }}>{step.footerNote}</span>
              </div>
            )}

            {!step.autoComplete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isComplete) {
                    onMarkIncomplete?.();
                  } else {
                    onMarkComplete();
                  }
                }}
                style={{
                  marginLeft: "auto",
                  color: "#6b7280",
                  fontSize: 13,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                {isComplete ? "Mark as Incomplete" : "Mark as Complete"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Icon options for the wizard dropdown
const WIZARD_ICON_OPTIONS = [
  { value: "truck", label: "Truck" },
  { value: "truck-v2", label: "Truck v2" },
  { value: "clock", label: "Clock" },
  { value: "pin", label: "Pin" },
  { value: "pin-v2", label: "Pin v2" },
  { value: "gift", label: "Gift" },
  { value: "checkmark", label: "Checkmark" },
  { value: "home", label: "Home" },
  { value: "shopping-bag", label: "Shopping Bag" },
  { value: "shopping-bag-v2", label: "Shopping Bag v2" },
  { value: "shopping-cart", label: "Shopping Cart" },
  { value: "shopping-cart-v2", label: "Shopping Cart v2" },
  { value: "shopping-basket", label: "Shopping Basket" },
  { value: "clipboard-document-check", label: "Clipboard" },
  { value: "clipboard-v2", label: "Clipboard v2" },
  { value: "bullet", label: "Bullet" },
];

export default function DashboardPage() {
  const { shopDomain, shopId, hasRules, config, settings, ruleCount, bankHolidayCountries } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  // Settings wizard state
  const [showSettingsWizard, setShowSettingsWizard] = useState(false);
  const [settingsStep, setSettingsStep] = useState(1);
  const [settingsData, setSettingsData] = useState({
    preview_timezone: settings?.preview_timezone || "",
    courier_delivery_days_min: settings?.courier_delivery_days_min ?? 3,
    courier_delivery_days_max: settings?.courier_delivery_days_max ?? 5,
    express_delivery_days_min: settings?.express_delivery_days_min ?? 1,
    express_delivery_days_max: settings?.express_delivery_days_max ?? 1,
    closed_days: settings?.closed_days || ["sat", "sun"],
    courier_no_delivery_days: settings?.courier_no_delivery_days || ["sat", "sun"],
    cutoff_time: settings?.cutoff_time || "14:00",
    lead_time: settings?.lead_time ?? 0,
    bank_holiday_country: settings?.bank_holiday_country || "",
    fd_threshold: settings?.fd_threshold ?? 0,
    preview_body_font: settings?.preview_body_font || "",
    preview_text_color: settings?.preview_text_color || "#000000",
    preview_bg_color: settings?.preview_bg_color || "#ffffff",
    main_icon_color: settings?.icon_color || "#111827",
  });

  // Rule wizard state
  const [showRuleWizard, setShowRuleWizard] = useState(false);
  const [ruleStep, setRuleStep] = useState(1);
  const [ruleData, setRuleData] = useState({
    // Step 1: Rule Name
    rule_name: "New Rule",
    // Step 2: Product Matching
    tags: "",
    stock_status: "any",
    // Step 3: Messages
    message_line_1: "Order within **{countdown}** for same-day dispatch",
    message_line_2: "Upgrade to express delivery & get it by **{express}**",
    // Step 4: Icon
    icon: "truck",
    icon_color: settings?.icon_color || "#111827",
    // Step 5: ETA Timeline Icons
    eta_order_icon: "shopping-bag",
    eta_shipping_icon: "truck",
    eta_delivery_icon: "pin",
    eta_connector_style: "double-chevron",
    // Step 6: Border Styling
    eta_border_width: 1,
    eta_border_radius: 8,
    eta_border_color: "#e5e7eb",
    background_color: "",
    border_apply_global: !hasRules,
  });
  const ruleTotalSteps = 6;

  // Setup guide state
  const [expandedStep, setExpandedStep] = useState(null);
  const [manualCompleted, setManualCompleted] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("dib_setup_completed");
        return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch (e) {
        return new Set();
      }
    }
    return new Set();
  });
  const [lightboxImage, setLightboxImage] = useState(null);
  const [isDismissed, setIsDismissed] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem("dib_setup_guide_dismissed") === "true";
      } catch (e) {
        return false;
      }
    }
    return false;
  });

  // Persist manual completed steps to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("dib_setup_completed", JSON.stringify([...manualCompleted]));
    }
  }, [manualCompleted]);

  // Persist dismissed state to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("dib_setup_guide_dismissed", isDismissed.toString());
    }
  }, [isDismissed]);

  const themeEditorUrl = shopDomain
    ? `https://${shopDomain}/admin/themes/current/editor?template=product`
    : "#";

  const freeDeliveryEditorUrl = shopDomain
    ? `https://${shopDomain}/admin/themes/current/editor?context=apps`
    : "#";

  const handleSettingsChange = (field, value) => {
    setSettingsData(prev => ({ ...prev, [field]: value }));
  };

  const openRuleWizard = () => {
    setRuleData(prev => ({ ...prev, icon_color: settings?.icon_color || settingsData.main_icon_color || "#111827" }));
    setRuleStep(1);
    setShowRuleWizard(true);
  };

  const handleRuleChange = (field, value) => {
    setRuleData(prev => ({ ...prev, [field]: value }));
  };

  const handleFinishSettingsWizard = () => {
    // Build global settings to save
    const newSettings = {
      ...(settings || {}),
      preview_timezone: settingsData.preview_timezone,
      courier_delivery_days_min: settingsData.courier_delivery_days_min,
      courier_delivery_days_max: settingsData.courier_delivery_days_max,
      express_delivery_days_min: settingsData.express_delivery_days_min,
      express_delivery_days_max: settingsData.express_delivery_days_max,
      closed_days: settingsData.closed_days,
      courier_no_delivery_days: settingsData.courier_no_delivery_days,
      cutoff_time: settingsData.cutoff_time,
      lead_time: settingsData.lead_time,
      bank_holiday_country: settingsData.bank_holiday_country,
      fd_threshold: settingsData.fd_threshold,
      preview_body_font: settingsData.preview_body_font,
      preview_text_color: settingsData.preview_text_color,
      preview_bg_color: settingsData.preview_bg_color,
      icon_color: settingsData.main_icon_color,
    };

    // Submit to action - save settings only
    fetcher.submit(
      {
        shopId,
        action: "saveSettings",
        settingsData: JSON.stringify(newSettings),
      },
      { method: "POST" }
    );
  };

  // Track created rule ID for navigation
  const [createdRuleId, setCreatedRuleId] = useState(null);

  const handleFinishRuleWizard = () => {
    // Generate rule ID and store it for navigation after save
    const ruleId = newRuleId();
    setCreatedRuleId(ruleId);

    // Build the rule object using wizard data
    const tags = ruleData.tags ? ruleData.tags.split(",").map(s => s.trim()).filter(Boolean) : [];
    const isFallback = tags.length === 0;

    const rule = {
      id: ruleId,
      name: ruleData.rule_name || (isFallback ? "Fallback Rule" : "New Rule"),
      match: {
        product_handles: [],
        tags: tags,
        stock_status: ruleData.stock_status || "any",
        is_fallback: isFallback,
      },
      settings: {
        // Collapsed states - all collapsed by default
        collapsed_product_matching: true,
        collapsed_dispatch_settings: true,
        collapsed_countdown_messages: true,
        collapsed_countdown_icon: true,
        collapsed_eta_timeline: true,

        // Messages from wizard
        show_messages: true,
        message_line_1: ruleData.message_line_1,
        message_line_2: ruleData.message_line_2,
        message_line_3: "",

        // Icon from wizard
        show_icon: true,
        icon: ruleData.icon,
        icon_style: "solid",
        icon_color: ruleData.icon_color,
        icon_layout: "per-line",
        single_icon_size: "medium",
        icon_vertical_align: "center",

        // Border - per-rule override if not applying to global
        show_border: ruleData.eta_border_width > 0,
        border_thickness: ruleData.eta_border_width,
        border_color: ruleData.eta_border_color,
        border_radius: ruleData.eta_border_radius,
        max_width: 0,
        background_color: ruleData.background_color,
        use_custom_border: !ruleData.border_apply_global,

        // Dispatch - use global settings
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

        // ETA Timeline - enabled with wizard settings
        show_eta_timeline: true,
        eta_left_padding: 0,
        eta_icon_size: 36,
        eta_connector_style: ruleData.eta_connector_style,
        eta_connector_color: ruleData.icon_color,
        eta_connector_use_main_color: true,
        eta_connector_alignment: "full",
        eta_color: ruleData.icon_color,
        eta_use_main_icon_color: true,
        show_eta_border: ruleData.eta_border_width > 0,
        eta_border_width: ruleData.eta_border_width,
        eta_border_color: ruleData.eta_border_color,
        eta_border_radius: ruleData.eta_border_radius,
        eta_background_color: ruleData.background_color,
        eta_use_custom_border: !ruleData.border_apply_global,

        // Special Delivery border - not enabled but border settings applied
        special_delivery_use_custom_border: !ruleData.border_apply_global,
        special_delivery_border_thickness: ruleData.eta_border_width,
        special_delivery_border_color: ruleData.eta_border_color,
        special_delivery_border_radius: ruleData.eta_border_radius,
        special_delivery_background_color: ruleData.background_color,
        eta_timeline_initialized: true,  // Wizard syncs both, so mark as initialized
        eta_order_icon: ruleData.eta_order_icon,
        eta_shipping_icon: ruleData.eta_shipping_icon,
        eta_delivery_icon: ruleData.eta_delivery_icon,
        eta_order_icon_style: "solid",
        eta_shipping_icon_style: "solid",
        eta_delivery_icon_style: "solid",
        eta_label_order: "Ordered",
        eta_label_shipping: "Shipped",
        eta_label_delivery: "Delivered",

        // Text styling - use defaults
        override_global_text_styling: false,
        text_color: "var(--p-color-text, #374151)",
        font_size: "medium",
        font_weight: "normal",

        // ETA text styling - use defaults
        override_eta_text_styling: false,
        eta_label_color: "var(--p-color-text, #374151)",
        eta_label_font_size: "small",
        eta_label_font_weight: "normal",
        eta_date_color: "var(--p-color-text-subdued, #6b7280)",
        eta_date_font_size: "xsmall",
        eta_date_font_weight: "normal",
      },
    };

    // Submit to action - save rule (and optionally global border settings)
    const submitData = {
      shopId,
      action: "saveRule",
      ruleData: JSON.stringify(rule),
      config: JSON.stringify(config),
    };
    if (ruleData.border_apply_global) {
      submitData.globalBorder = JSON.stringify({
        border_thickness: ruleData.eta_border_width,
        border_color: ruleData.eta_border_color,
        border_radius: ruleData.eta_border_radius,
        show_border: ruleData.eta_border_width > 0,
        global_background_color: ruleData.background_color,
      });
      submitData.existingSettings = JSON.stringify(settings || {});
    }
    fetcher.submit(submitData, { method: "POST" });
  };

  const settingsTotalSteps = 8;

  // Handle successful saves
  const [lastAction, setLastAction] = useState(null);

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.action !== lastAction) {
      if (fetcher.data.action === "saveSettings") {
        setLastAction("saveSettings");
        setSettingsStep(settingsTotalSteps + 1);
      } else if (fetcher.data.action === "saveRule") {
        setLastAction("saveRule");
        setRuleStep(ruleTotalSteps + 1);
      }
    }
  }, [fetcher.data]);

  return (
    <s-page heading="Dashboard">
      {/* Welcome Section with Stats */}
      <s-section>
        <s-box padding="large" background="subdued" borderRadius="large">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
            {/* Left: Welcome text */}
            <div style={{ flex: "1 1 300px" }}>
              <s-text variant="headingLg"><strong>Welcome to Delivery Messaging!</strong></s-text>
              <s-box paddingBlockStart="base">
                <s-text>
                  Display dynamic delivery information on your product pages to boost customer confidence
                  and increase conversions. Show countdown timers, estimated delivery dates, and shipping timelines.
                </s-text>
              </s-box>
            </div>
            {/* Right: Flip clock stats */}
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <FlipCard value={ruleCount} label="Rules Live" />
            </div>
          </div>
        </s-box>
      </s-section>

      {/* Setup Guide Accordion */}
      {!isDismissed ? (
        <s-section>
          <div
            style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div style={{ padding: "20px 20px 16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#111827" }}>Setup Guide</h2>
                  <p style={{ margin: "4px 0 0 0", fontSize: 14, color: "#6b7280" }}>
                    Get your delivery messages live on your store
                  </p>
                </div>
                <button
                  onClick={() => setIsDismissed(true)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 4,
                    color: "#9ca3af",
                  }}
                  title="Dismiss setup guide"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M5 5L15 15M5 15L15 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Progress bar - counts steps 1-4 (core setup) */}
              {(() => {
                const setupSteps = [
                  { id: "product_page", countsForProgress: true },
                  { id: "announcement_bar", countsForProgress: true },
                  { id: "configure_settings", countsForProgress: true },
                  { id: "create_rule", countsForProgress: false, autoComplete: hasRules },
                ];
                const progressSteps = setupSteps.filter(s => s.countsForProgress);
                const completedCount = progressSteps.filter(s => s.autoComplete || manualCompleted.has(s.id)).length;
                const totalRequired = progressSteps.length;
                const percent = totalRequired > 0 ? (completedCount / totalRequired) * 100 : 0;

                return (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: "#6b7280" }}>
                        {completedCount} of {totalRequired} steps completed
                      </span>
                    </div>
                    <div style={{ background: "#e5e7eb", borderRadius: 4, height: 8 }}>
                      <div
                        style={{
                          background: "#22c55e",
                          borderRadius: 4,
                          height: "100%",
                          width: `${percent}%`,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Info banner */}
            <div
              style={{
                padding: "12px 16px",
                background: "#eff6ff",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="8" cy="8" r="7" stroke="#3b82f6" strokeWidth="1.5"/>
                <path d="M8 7V11M8 5V5.5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: 13, color: "#1e40af" }}>
                Even if you don't use every block, each can be enabled or disabled directly in the app settings.
              </span>
            </div>

            {/* Steps */}
            <div style={{ borderTop: "1px solid #e5e7eb" }}>
              {/* Step 1: Product Page Setup */}
              <SetupStep
                step={{
                  id: "product_page",
                  title: "Product Page Setup",
                  description: "Add Delivery Messaging, ETA Timeline, or Special Delivery blocks to your product page template.",
                  actionLabel: "Open Theme Editor",
                  actionUrl: themeEditorUrl,
                  video: "/images/videos/product-page-setup.mp4",
                  videoSteps: [
                    "Edit Theme (open theme editor)",
                    "Open Default Product page",
                    "Expand the Product Information block",
                    "Add blocks — Delivery Messaging, ETA Timeline & Special Delivery",
                    "Position blocks as required (default positions shown)",
                    "Save",
                  ],
                }}
                isExpanded={expandedStep === "product_page"}
                isComplete={manualCompleted.has("product_page")}
                onToggle={() => setExpandedStep(expandedStep === "product_page" ? null : "product_page")}
                onMarkComplete={() => setManualCompleted(prev => new Set([...prev, "product_page"]))}
                onMarkIncomplete={() => setManualCompleted(prev => { const next = new Set(prev); next.delete("product_page"); return next; })}
              />

              {/* Step 2: Announcement Bar Setup */}
              <SetupStep
                step={{
                  id: "announcement_bar",
                  title: "Announcement Bar Setup",
                  description: "Add the Delivery Announcement block to your theme's header or announcement bar section.",
                  actionLabel: "Open Theme Editor",
                  actionUrl: shopDomain ? `https://${shopDomain}/admin/themes/current/editor` : "#",
                  video: "/images/videos/delivery-messaging-announcement.mp4",
                  videoSteps: [
                    "Edit Theme (open theme editor)",
                    "Disable Shopify Bar (theme built-in announcement bar)",
                    "Add Apps / Delivery Announcement (installs app bar)",
                    "Position App at top of header (moves app block above theme header)",
                    "Disable App options (turn off 'make section margins the same as theme' and 'reveal sections on scroll')",
                    "Save",
                  ],
                }}
                isExpanded={expandedStep === "announcement_bar"}
                isComplete={manualCompleted.has("announcement_bar")}
                onToggle={() => setExpandedStep(expandedStep === "announcement_bar" ? null : "announcement_bar")}
                onMarkComplete={() => setManualCompleted(prev => new Set([...prev, "announcement_bar"]))}
                onMarkIncomplete={() => setManualCompleted(prev => { const next = new Set(prev); next.delete("announcement_bar"); return next; })}
              />

              {/* Step 3: Configure Store Settings */}
              <SetupStep
                step={{
                  id: "configure_settings",
                  title: "Configure Store Settings",
                  description: "Configure your timezone, delivery windows, cutoff times, lead times, closed days, and bank holidays. These global settings apply to all rules and control how delivery dates, countdowns, and ETA timelines are calculated across your storefront. Use the Configure Settings wizard below to get started — you can always adjust these later in Global Settings.",
                  actionLabel: "Configure Settings",
                  onAction: () => setShowSettingsWizard(true),
                  secondaryLabel: "Go to Settings",
                  secondaryUrl: "/app/messages?openSettings=true",
                }}
                isExpanded={expandedStep === "configure_settings"}
                isComplete={manualCompleted.has("configure_settings")}
                onToggle={() => setExpandedStep(expandedStep === "configure_settings" ? null : "configure_settings")}
                onAction={() => setShowSettingsWizard(true)}
                onMarkComplete={() => setManualCompleted(prev => new Set([...prev, "configure_settings"]))}
                onMarkIncomplete={() => setManualCompleted(prev => { const next = new Set(prev); next.delete("configure_settings"); return next; })}
              />

              {/* Next Steps separator */}
              <div
                style={{
                  padding: "12px 16px",
                  background: "#f9fafb",
                  borderTop: "1px solid #e5e7eb",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Next Steps
                </span>
              </div>

              {/* Step 5: Create a Messages Rule */}
              <SetupStep
                step={{
                  id: "create_rule",
                  title: "Create a Messages Rule",
                  isAdditional: true,
                  description: "Rules determine what delivery information is shown for different products. Each rule can target specific products using tags or stock status, and display its own set of delivery messages, icons, and ETA timeline. Use the Create Rule wizard below to set up your first rule — it will guide you through product matching, messages, icons, and styling in a few quick steps.",
                  actionLabel: "Create Rule",
                  onAction: () => openRuleWizard(),
                  secondaryLabel: "Go to Messages Editor",
                  secondaryUrl: "/app/messages",
                  footerNote: "Rules are added to the currently active profile.",
                  autoComplete: true,
                }}
                isExpanded={expandedStep === "create_rule"}
                isComplete={hasRules}
                onToggle={() => setExpandedStep(expandedStep === "create_rule" ? null : "create_rule")}
                onAction={() => openRuleWizard()}
              />
            </div>
          </div>
        </s-section>
      ) : (
        <s-section>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <button
              onClick={() => setIsDismissed(false)}
              style={{
                background: "none",
                border: "none",
                color: "#2563eb",
                fontSize: 14,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Show Setup Guide
            </button>
          </div>
        </s-section>
      )}

      {/* Settings Wizard Modal */}
      {showSettingsWizard && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "600px",
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            {/* Wizard Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <s-text variant="headingMd">Configure Store Settings</s-text>
              <s-button size="small" onClick={() => setShowSettingsWizard(false)}>
                Close
              </s-button>
            </div>

            {/* Progress indicator */}
            {settingsStep <= settingsTotalSteps && (
            <div style={{ marginBottom: "24px" }}>
              <s-text variant="bodySm" tone="subdued">Step {settingsStep} of {settingsTotalSteps}</s-text>
              <div style={{ background: "#e5e7eb", borderRadius: "4px", height: "8px", marginTop: "8px" }}>
                <div
                  style={{
                    background: "#2563eb",
                    borderRadius: "4px",
                    height: "100%",
                    width: `${(settingsStep / settingsTotalSteps) * 100}%`,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
            )}

            {/* Step Content */}
            {/* Step 1: Preview Timezone */}
            {settingsStep === 1 && (
              <div>
                <s-text variant="headingMd">Preview Timezone</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">Match this to your Shopify store timezone so the preview matches your live storefront.</s-text>
                </s-box>
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Timezone</s-text>
                  </label>
                  <select
                    value={settingsData.preview_timezone}
                    onChange={(e) => handleSettingsChange("preview_timezone", e.target.value)}
                    style={{
                      width: "75%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
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
                </s-box>
              </div>
            )}

            {/* Step 2: Delivery Windows */}
            {settingsStep === 2 && (
              <div>
                <s-text variant="headingMd">Delivery Windows</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">Set the estimated delivery timeframes for standard and express shipping.</s-text>
                </s-box>

                {/* Courier Delivery Window */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Courier Delivery Window</s-text>
                  </label>
                  <s-text variant="bodySm" tone="subdued" style={{ marginBottom: "8px" }}>
                    Days from shipping to delivery (used by &#123;arrival&#125; and ETA Timeline)
                  </s-text>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: "8px" }}>
                    <label>
                      <s-text variant="bodySm">Min days</s-text>
                      <input
                        type="number"
                        min="0"
                        value={settingsData.courier_delivery_days_min}
                        onChange={(e) => {
                          const newMin = Math.max(0, parseInt(e.target.value) || 0);
                          handleSettingsChange("courier_delivery_days_min", newMin);
                          if (newMin > settingsData.courier_delivery_days_max) {
                            handleSettingsChange("courier_delivery_days_max", newMin);
                          }
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "13px",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                    <label>
                      <s-text variant="bodySm">Max days</s-text>
                      <input
                        type="number"
                        min="0"
                        value={settingsData.courier_delivery_days_max}
                        onChange={(e) => {
                          const newMax = Math.max(0, parseInt(e.target.value) || 0);
                          handleSettingsChange("courier_delivery_days_max", newMax);
                          if (newMax < settingsData.courier_delivery_days_min) {
                            handleSettingsChange("courier_delivery_days_min", newMax);
                          }
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "13px",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                  </div>
                </s-box>

                {/* Express Delivery Window */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Express Delivery Window</s-text>
                  </label>
                  <s-text variant="bodySm" tone="subdued" style={{ marginBottom: "8px" }}>
                    Days from shipping to express delivery (used by &#123;express&#125; placeholder)
                  </s-text>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: "8px" }}>
                    <label>
                      <s-text variant="bodySm">Min days</s-text>
                      <input
                        type="number"
                        min="1"
                        value={settingsData.express_delivery_days_min}
                        onChange={(e) => {
                          const newMin = Math.max(1, parseInt(e.target.value) || 1);
                          handleSettingsChange("express_delivery_days_min", newMin);
                          if (newMin > settingsData.express_delivery_days_max) {
                            handleSettingsChange("express_delivery_days_max", newMin);
                          }
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "13px",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                    <label>
                      <s-text variant="bodySm">Max days</s-text>
                      <input
                        type="number"
                        min="1"
                        value={settingsData.express_delivery_days_max}
                        onChange={(e) => {
                          const newMax = Math.max(1, parseInt(e.target.value) || 1);
                          handleSettingsChange("express_delivery_days_max", newMax);
                          if (newMax < settingsData.express_delivery_days_min) {
                            handleSettingsChange("express_delivery_days_min", newMax);
                          }
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "13px",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                  </div>
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0, lineHeight: "32px" }}>💡</span>
                  <span style={{ fontSize: 12, lineHeight: "16px" }}>Set both min and max to the same value for a single date.<br />Can be configured in Settings, or set per-rule in the Editor.</span>
                </div>
              </div>
            )}

            {/* Step 3: Business & Courier Days */}
            {settingsStep === 3 && (
              <div>
                <s-text variant="headingMd">Business & Courier Days</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">Configure which days your business operates and couriers deliver.</s-text>
                </s-box>

                {/* Closed Days */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Closed Days</s-text>
                  </label>
                  <s-text variant="bodySm" tone="subdued" style={{ marginBottom: "8px" }}>
                    Days your business does not process or ship orders
                  </s-text>
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "8px" }}>
                    {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(day => (
                      <label key={day} style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={settingsData.closed_days.includes(day)}
                          onChange={(e) => {
                            const newDays = e.target.checked
                              ? [...settingsData.closed_days, day]
                              : settingsData.closed_days.filter(d => d !== day);
                            handleSettingsChange("closed_days", newDays);
                          }}
                        />
                        <span style={{ fontSize: "14px" }}>{day.charAt(0).toUpperCase() + day.slice(1)}</span>
                      </label>
                    ))}
                  </div>
                </s-box>

                {/* Courier Non-Delivery Days */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Courier Non-Delivery Days</s-text>
                  </label>
                  <s-text variant="bodySm" tone="subdued" style={{ marginBottom: "8px" }}>
                    Days your courier does not deliver (used for ETA calculations)
                  </s-text>
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "8px" }}>
                    {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(day => (
                      <label key={day} style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={settingsData.courier_no_delivery_days.includes(day)}
                          onChange={(e) => {
                            const newDays = e.target.checked
                              ? [...settingsData.courier_no_delivery_days, day]
                              : settingsData.courier_no_delivery_days.filter(d => d !== day);
                            handleSettingsChange("courier_no_delivery_days", newDays);
                          }}
                        />
                        <span style={{ fontSize: "14px" }}>{day.charAt(0).toUpperCase() + day.slice(1)}</span>
                      </label>
                    ))}
                  </div>
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Can be configured in Settings, or set per-rule in the Editor.</span>
                </div>
              </div>
            )}

            {/* Step 4: Cutoff Time */}
            {settingsStep === 4 && (
              <div>
                <s-text variant="headingMd">Cutoff Time</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">Set the daily order cutoff for same-day dispatch.</s-text>
                </s-box>
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Default Cutoff Time</s-text>
                  </label>
                  <input
                    type="time"
                    value={settingsData.cutoff_time}
                    onChange={(e) => handleSettingsChange("cutoff_time", e.target.value)}
                    style={{
                      width: "75%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  />
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0, lineHeight: "32px" }}>💡</span>
                  <span style={{ fontSize: 12, lineHeight: "16px" }}>Different cutoff times for weekends.<br />Can be configured in Settings, or set per-rule in the Editor.</span>
                </div>
              </div>
            )}

            {/* Step 5: Lead Time */}
            {settingsStep === 5 && (
              <div>
                <s-text variant="headingMd">Lead Time</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">Add extra business days before dispatch to account for processing, handling, or manufacturing time.</s-text>
                </s-box>
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Lead Time (business days)</s-text>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={settingsData.lead_time}
                    onChange={(e) => handleSettingsChange("lead_time", Math.max(0, Math.min(30, parseInt(e.target.value) || 0)))}
                    style={{
                      width: "75%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  />
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0, lineHeight: "32px" }}>💡</span>
                  <span style={{ fontSize: 12, lineHeight: "16px" }}>Use 0 for same-day dispatch (before cutoff).<br />Can be configured in Settings, or set per-rule in the Editor.</span>
                </div>
              </div>
            )}

            {/* Step 6: Bank Holidays */}
            {settingsStep === 6 && (
              <div>
                <s-text variant="headingMd">Bank Holidays</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">Automatically exclude national holidays from dispatch and delivery.</s-text>
                </s-box>
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Country</s-text>
                  </label>
                  <select
                    value={settingsData.bank_holiday_country}
                    onChange={(e) => handleSettingsChange("bank_holiday_country", e.target.value)}
                    style={{
                      width: "75%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  >
                    <option value="">None (no bank holidays)</option>
                    {Object.entries(bankHolidayCountries)
                      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                      .map(([code, { name }]) => (
                        <option key={code} value={code}>{name}</option>
                      ))}
                  </select>
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Additional custom holidays can be added in Settings.</span>
                </div>
              </div>
            )}

            {/* Step 7: Free Delivery Threshold */}
            {settingsStep === 7 && (
              <div>
                <s-text variant="headingMd">Free Delivery Threshold</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">Set the minimum order value for free delivery. This is used by the announcement bar and pricing displays.</s-text>
                </s-box>
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Threshold Amount (£)</s-text>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={(settingsData.fd_threshold || 0) / 100}
                    onChange={(e) => handleSettingsChange("fd_threshold", Math.round(parseFloat(e.target.value || 0) * 100))}
                    style={{
                      width: "75%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  />
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0, lineHeight: "32px" }}>💡</span>
                  <span style={{ fontSize: 12, lineHeight: "16px" }}>Set to 0 to disable free delivery threshold features.<br />Can be configured in Free Delivery.</span>
                </div>
              </div>
            )}

            {/* Step 8: Theme Styling for Preview */}
            {settingsStep === 8 && (
              <div>
                <s-text variant="headingMd">Theme Styling for Preview</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">Match the admin preview to your Shopify theme so you can see how your blocks will look on your storefront.</s-text>
                </s-box>
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Store Font</s-text>
                  </label>
                  <FontSelector
                    value={settingsData.preview_body_font}
                    onChange={(font) => handleSettingsChange("preview_body_font", font)}
                    placeholder="Search fonts..."
                  />
                </s-box>
                <s-box paddingBlockStart="large">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", marginBottom: "8px" }}>
                        <s-text variant="bodySm">Theme Font Colour</s-text>
                      </label>
                      <ColorPicker
                        color={settingsData.preview_text_color}
                        onChange={(color) => handleSettingsChange("preview_text_color", color)}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "8px" }}>
                        <s-text variant="bodySm">Theme Background Colour</s-text>
                      </label>
                      <ColorPicker
                        color={settingsData.preview_bg_color}
                        onChange={(color) => handleSettingsChange("preview_bg_color", color)}
                      />
                    </div>
                  </div>
                </s-box>
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Main Theme Colour</s-text>
                  </label>
                  <ColorPicker
                    color={settingsData.main_icon_color}
                    onChange={(color) => handleSettingsChange("main_icon_color", color)}
                  />
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 8 }}>
                    <span style={{ fontSize: 12, flexShrink: 0, lineHeight: "32px" }}>💡</span>
                    <span style={{ fontSize: 12, lineHeight: "16px" }}>Applied to message icons, ETA timeline stages, connector, and special delivery icons.<br />Can be configured in Editor.</span>
                  </div>
                </s-box>
              </div>
            )}

            {/* Success Screen */}
            {settingsStep === settingsTotalSteps + 1 && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#16a34a", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <svg width="28" height="28" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#111827", marginBottom: 8 }}>Settings Saved</div>
                <div style={{ fontSize: 14, color: "#6b7280" }}>Your store settings have been saved successfully.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                  <button
                    onClick={() => { setShowSettingsWizard(false); setSettingsStep(1); }}
                    style={{
                      padding: "10px 16px",
                      background: "white",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      fontSize: 14,
                      cursor: "pointer",
                      color: "#111827",
                    }}
                  >
                    Back to Dashboard
                  </button>
                  <button
                    onClick={() => { setShowSettingsWizard(false); setSettingsStep(1); openRuleWizard(); }}
                    style={{
                      padding: "10px 16px",
                      background: "white",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      fontSize: 14,
                      cursor: "pointer",
                      color: "#111827",
                    }}
                  >
                    Create a Messages Rule
                  </button>
                  <button
                    onClick={() => { setShowSettingsWizard(false); setSettingsStep(1); navigate("/app/messages"); }}
                    style={{
                      padding: "10px 16px",
                      background: "white",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      fontSize: 14,
                      cursor: "pointer",
                      color: "#111827",
                    }}
                  >
                    Go to Messages Editor
                  </button>
                </div>
              </div>
            )}

            {/* Navigation buttons */}
            {settingsStep <= settingsTotalSteps && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #e5e7eb" }}>
              <s-button
                onClick={() => setSettingsStep(prev => prev - 1)}
                disabled={settingsStep === 1}
              >
                Back
              </s-button>
              {settingsStep < settingsTotalSteps ? (
                <s-button variant="primary" onClick={() => setSettingsStep(prev => prev + 1)}>
                  Next
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  onClick={handleFinishSettingsWizard}
                  disabled={fetcher.state === "submitting"}
                >
                  {fetcher.state === "submitting" ? "Saving..." : "Save Settings"}
                </s-button>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* Rule Wizard Modal */}
      {showRuleWizard && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "600px",
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
          >
            {/* Wizard Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <s-text variant="headingMd">Create a Rule</s-text>
              <s-button size="small" onClick={() => setShowRuleWizard(false)}>
                Close
              </s-button>
            </div>

            {/* Progress indicator */}
            {ruleStep <= ruleTotalSteps && (
            <div style={{ marginBottom: "24px" }}>
              <s-text variant="bodySm" tone="subdued">Step {ruleStep} of {ruleTotalSteps}</s-text>
              <div style={{ background: "#e5e7eb", borderRadius: "4px", height: "8px", marginTop: "8px" }}>
                <div
                  style={{
                    background: "#2563eb",
                    borderRadius: "4px",
                    height: "100%",
                    width: `${(ruleStep / ruleTotalSteps) * 100}%`,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
            )}

            {/* Step 1: Rule Name */}
            {ruleStep === 1 && (
              <div>
                <s-text variant="headingMd">Name Your Rule</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">
                    Give your rule a descriptive name to help identify it later.
                  </s-text>
                </s-box>

                {/* Rule Name */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Rule Name</s-text>
                  </label>
                  <input
                    type="text"
                    value={ruleData.rule_name}
                    onChange={(e) => handleRuleChange("rule_name", e.target.value)}
                    placeholder="e.g., Express Delivery, Standard Shipping"
                    style={{
                      width: "75%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  />
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>You can change this anytime in the Messages Editor.</span>
                </div>
              </div>
            )}

            {/* Step 2: Product Matching */}
            {ruleStep === 2 && (
              <div>
                <s-text variant="headingMd">Product Matching</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">
                    Configure which products this rule applies to.
                  </s-text>
                </s-box>

                {/* Product Tags */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Product tags (comma-separated)</s-text>
                  </label>
                  <input
                    type="text"
                    value={ruleData.tags}
                    onChange={(e) => handleRuleChange("tags", e.target.value)}
                    placeholder="e.g., express, same-day"
                    style={{
                      width: "75%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  />
                </s-box>

                {/* Stock Status */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Product stock status</s-text>
                  </label>
                  <select
                    value={ruleData.stock_status}
                    onChange={(e) => handleRuleChange("stock_status", e.target.value)}
                    style={{
                      width: "75%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  >
                    <option value="any">Any stock status</option>
                    <option value="in_stock">In stock only</option>
                    <option value="out_of_stock">Out of stock only</option>
                  </select>
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Leave tags empty to create a fallback rule that matches all products.</span>
                </div>
              </div>
            )}

            {/* Step 3: Messages */}
            {ruleStep === 3 && (
              <div>
                <s-text variant="headingMd">Delivery Messages</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">
                    Create messages to display on product pages. Use placeholders for dynamic content.
                  </s-text>
                </s-box>

                {/* Message Line 1 */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Message Line 1</s-text>
                  </label>
                  <input
                    type="text"
                    value={ruleData.message_line_1}
                    onChange={(e) => handleRuleChange("message_line_1", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                  <MessagePreview text={ruleData.message_line_1} />
                </s-box>

                {/* Message Line 2 */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Message Line 2</s-text>
                  </label>
                  <input
                    type="text"
                    value={ruleData.message_line_2}
                    onChange={(e) => handleRuleChange("message_line_2", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                  <MessagePreview text={ruleData.message_line_2} />
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Use {"{countdown}"} for live timer, {"{arrival}"} for delivery date, {"{express}"} for next-day date, **text** for bold.</span>
                </div>
              </div>
            )}

            {/* Step 4: Icon */}
            {ruleStep === 4 && (
              <div>
                <s-text variant="headingMd">Message Icon</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">
                    Choose an icon to display alongside your messages.
                  </s-text>
                </s-box>

                {/* Icon Preview */}
                <s-box paddingBlockStart="large">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "80px",
                      height: "80px",
                      background: "#f9fafb",
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    <span
                      dangerouslySetInnerHTML={{ __html: getIconSvg(ruleData.icon, "solid") || "" }}
                      style={{
                        width: "48px",
                        height: "48px",
                        display: "block",
                        color: ruleData.icon_color,
                      }}
                    />
                  </div>
                </s-box>

                {/* Icon Selection */}
                <s-box paddingBlockStart="large">
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <s-text variant="bodySm">Icon</s-text>
                  </label>
                  <select
                    value={ruleData.icon}
                    onChange={(e) => handleRuleChange("icon", e.target.value)}
                    style={{
                      width: "75%",
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  >
                    {WIZARD_ICON_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </s-box>

                {/* Icon Color */}
                <s-box paddingBlockStart="large">
                  <div>
                    <s-text size="small">Icon color</s-text>
                    <div style={{ marginTop: 4 }}>
                      <ColorPicker
                        color={ruleData.icon_color || "#111827"}
                        onChange={(color) => handleRuleChange("icon_color", color)}
                      />
                    </div>
                  </div>
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>This color will also be used for ETA timeline icons and connectors.</span>
                </div>
              </div>
            )}

            {/* Step 5: ETA Timeline Icons */}
            {ruleStep === 5 && (
              <div>
                <s-text variant="headingMd">ETA Timeline Icons</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">
                    Choose icons for each stage of the delivery timeline and a connector style.
                  </s-text>
                </s-box>

                {/* Icon + Connector Preview */}
                <s-box paddingBlockStart="large">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "16px", background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                    <WizardStageIcon icon={ruleData.eta_order_icon} color={ruleData.icon_color} />
                    <WizardConnector style={ruleData.eta_connector_style} color={ruleData.icon_color} />
                    <WizardStageIcon icon={ruleData.eta_shipping_icon} color={ruleData.icon_color} />
                    <WizardConnector style={ruleData.eta_connector_style} color={ruleData.icon_color} />
                    <WizardStageIcon icon={ruleData.eta_delivery_icon} color={ruleData.icon_color} />
                  </div>
                </s-box>

                {/* Stage Icons */}
                <s-box paddingBlockStart="large">
                  <div style={{ display: "flex", gap: "16px" }}>
                    <label style={{ flex: 1 }}>
                      <s-text variant="bodySm">Ordered</s-text>
                      <select
                        value={ruleData.eta_order_icon}
                        onChange={(e) => handleRuleChange("eta_order_icon", e.target.value)}
                        style={{ width: "100%", marginTop: 8, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                      >
                        <option value="none">None</option>
                        {WIZARD_ICON_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ flex: 1 }}>
                      <s-text variant="bodySm">Shipped</s-text>
                      <select
                        value={ruleData.eta_shipping_icon}
                        onChange={(e) => handleRuleChange("eta_shipping_icon", e.target.value)}
                        style={{ width: "100%", marginTop: 8, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                      >
                        <option value="none">None</option>
                        {WIZARD_ICON_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ flex: 1 }}>
                      <s-text variant="bodySm">Delivered</s-text>
                      <select
                        value={ruleData.eta_delivery_icon}
                        onChange={(e) => handleRuleChange("eta_delivery_icon", e.target.value)}
                        style={{ width: "100%", marginTop: 8, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                      >
                        <option value="none">None</option>
                        {WIZARD_ICON_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </s-box>

                {/* Connector Style */}
                <s-box paddingBlockStart="large">
                  <label>
                    <s-text variant="bodySm">Connector style</s-text>
                    <select
                      value={ruleData.eta_connector_style}
                      onChange={(e) => handleRuleChange("eta_connector_style", e.target.value)}
                      style={{ width: "75%", marginTop: 8, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, display: "block" }}
                    >
                      <option value="double-chevron">Chevrons</option>
                      <option value="big-arrow">Arrow</option>
                      <option value="line">Line</option>
                      <option value="arrow-dot">Line dot</option>
                    </select>
                  </label>
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Icons use the main icon color from Step 4. Can be configured in the Messages Editor.</span>
                </div>
              </div>
            )}

            {/* Step 6: Border Styling */}
            {ruleStep === 6 && (
              <div>
                <s-text variant="headingMd">Border & Background Styling</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">
                    Set the border and background for Messages, ETA Timeline, and Special Delivery blocks.
                  </s-text>
                </s-box>

                {/* Border Settings - Side by Side */}
                <s-box paddingBlockStart="large">
                  <div style={{ display: "flex", gap: "24px" }}>
                    <label style={{ flex: 1 }}>
                      <s-text variant="bodySm">Border thickness (px)</s-text>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={ruleData.eta_border_width}
                        onChange={(e) => handleRuleChange("eta_border_width", parseInt(e.target.value) || 0)}
                        style={{ width: "75%", marginTop: 8, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                      />
                    </label>
                    <label style={{ flex: 1 }}>
                      <s-text variant="bodySm">Border radius (px)</s-text>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        value={ruleData.eta_border_radius}
                        onChange={(e) => handleRuleChange("eta_border_radius", parseInt(e.target.value) || 0)}
                        style={{ width: "75%", marginTop: 8, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                      />
                    </label>
                  </div>
                </s-box>

                {/* Border Color & Background Color */}
                <s-box paddingBlockStart="large">
                  <div style={{ display: "flex", gap: 24 }}>
                    <div>
                      <s-text size="small">Border color</s-text>
                      <div style={{ marginTop: 4 }}>
                        <ColorPicker
                          color={ruleData.eta_border_color || "#e5e7eb"}
                          onChange={(color) => handleRuleChange("eta_border_color", color)}
                        />
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                      <div>
                        <s-text size="small">Background color</s-text>
                        <div style={{ marginTop: 4 }}>
                          <ColorPicker
                            color={ruleData.background_color || ""}
                            onChange={(color) => handleRuleChange("background_color", color)}
                          />
                        </div>
                      </div>
                      {ruleData.background_color && (
                        <button
                          type="button"
                          onClick={() => handleRuleChange("background_color", "")}
                          style={{
                            padding: "6px 10px",
                            fontSize: 12,
                            border: "1px solid #d1d5db",
                            borderRadius: 4,
                            background: "white",
                            cursor: "pointer",
                            marginBottom: 4,
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 16 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <span style={{ fontSize: 12 }}>Set border thickness to 0 for no border. These settings apply to Messages, ETA Timeline, and Special Delivery blocks.</span>
                </div>

                {/* Apply globally or per-rule */}
                <s-box paddingBlockStart="large">
                  <s-text variant="bodySm" style={{ marginBottom: 8, display: "block" }}>How should these border settings be applied?</s-text>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="border_scope"
                        checked={ruleData.border_apply_global}
                        onChange={() => handleRuleChange("border_apply_global", true)}
                        style={{ width: 16, height: 16, cursor: "pointer" }}
                      />
                      <span style={{ fontSize: 13 }}>Apply as default for all rules <span style={{ color: "#6b7280" }}>(saves to Global Settings)</span></span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="border_scope"
                        checked={!ruleData.border_apply_global}
                        onChange={() => handleRuleChange("border_apply_global", false)}
                        style={{ width: 16, height: 16, cursor: "pointer" }}
                      />
                      <span style={{ fontSize: 13 }}>Apply as per-rule override <span style={{ color: "#6b7280" }}>(this rule only)</span></span>
                    </label>
                  </div>
                </s-box>

              </div>
            )}

            {/* Success Screen */}
            {ruleStep === ruleTotalSteps + 1 && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#16a34a", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <svg width="28" height="28" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#111827", marginBottom: 8 }}>Rule Saved</div>
                <div style={{ fontSize: 14, color: "#6b7280" }}>Your rule has been created successfully.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                  <button
                    onClick={() => { if (createdRuleId) sessionStorage.setItem("dib_select_rule", createdRuleId); setShowRuleWizard(false); setRuleStep(1); navigate("/app/messages"); }}
                    style={{
                      padding: "10px 16px",
                      background: "white",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      fontSize: 14,
                      cursor: "pointer",
                      color: "#111827",
                    }}
                  >
                    Go to Messages Editor
                  </button>
                  <button
                    onClick={() => { setShowRuleWizard(false); setRuleStep(1); }}
                    style={{
                      padding: "10px 16px",
                      background: "white",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      fontSize: 14,
                      cursor: "pointer",
                      color: "#111827",
                    }}
                  >
                    Back to Dashboard
                  </button>
                </div>
              </div>
            )}

            {/* Navigation buttons */}
            {ruleStep <= ruleTotalSteps && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #e5e7eb" }}>
              <s-button
                onClick={() => setRuleStep(prev => prev - 1)}
                disabled={ruleStep === 1}
              >
                Back
              </s-button>
              {ruleStep < ruleTotalSteps ? (
                <s-button variant="primary" onClick={() => setRuleStep(prev => prev + 1)}>
                  Next
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  onClick={handleFinishRuleWizard}
                  disabled={fetcher.state === "submitting"}
                >
                  {fetcher.state === "submitting" ? "Creating..." : "Create Rule"}
                </s-button>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001,
            cursor: "zoom-out",
            padding: 24,
          }}
        >
          <img
            src={lightboxImage}
            alt="Enlarged view"
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              borderRadius: 8,
              boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
            }}
          />
        </div>
      )}

      {/* Contact Support */}
      <s-section>
        <div
          style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: "20px",
            textAlign: "center",
          }}
        >
          <h3 style={{ margin: "0 0 4px 0", fontSize: 16, fontWeight: 600, color: "#111827" }}>Need help?</h3>
          <p style={{ margin: "0 0 12px 0", fontSize: 14, color: "#6b7280" }}>
            Get in touch with our support team
          </p>
          <a
            href="mailto:support@delivery-messaging.app"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "8px 16px",
              background: "#2563eb",
              color: "white",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
              gap: 6,
            }}
          >
            ✉ Contact Support
          </a>
        </div>
      </s-section>
    </s-page>
  );
}

// ============================================================================
// ERROR BOUNDARY
// ============================================================================

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
