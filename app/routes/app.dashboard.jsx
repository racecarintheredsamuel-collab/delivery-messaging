import { useState, useEffect } from "react";
import { useLoaderData, useRouteError, useFetcher, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { newRuleId } from "../utils/idGenerators";
import { HOLIDAY_DEFINITIONS } from "../utils/holidays";
import { getIconSvg } from "../utils/icons";
import {
  GET_SHOP_DELIVERY_DATA,
  SET_METAFIELDS_MINIMAL,
  METAFIELD_NAMESPACE,
  CONFIG_KEY,
  SETTINGS_KEY,
} from "../graphql/queries";

// ============================================================================
// LOADER
// ============================================================================

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop;

  // Fetch current config to check if rules exist
  const res = await admin.graphql(GET_SHOP_DELIVERY_DATA, {
    variables: {
      namespace: METAFIELD_NAMESPACE,
      configKey: CONFIG_KEY,
      settingsKey: "delivery_rules_settings",
    },
  });

  const json = await res.json();
  const shopId = json?.data?.shop?.id;
  const configMf = json?.data?.shop?.config;
  const settingsMf = json?.data?.shop?.settings;

  let hasRules = false;
  let config = null;
  let settings = null;
  let ruleCount = 0;

  if (configMf?.value) {
    try {
      config = JSON.parse(configMf.value);
      // Check v2 format for rules
      if (config.version === 2 && config.profiles) {
        ruleCount = config.profiles.reduce((sum, p) => sum + (p.rules?.length || 0), 0);
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

    // Ensure v2 format
    if (!config || config.version !== 2) {
      config = {
        version: 2,
        profiles: [{
          id: "default",
          name: "Default",
          rules: [],
        }],
        activeProfileId: "default",
      };
    }

    // Add the new rule to the active profile
    const activeProfile = config.profiles.find(p => p.id === config.activeProfileId) || config.profiles[0];
    if (activeProfile) {
      activeProfile.rules.push(ruleData);
    }

    const setRes = await admin.graphql(SET_METAFIELDS_MINIMAL, {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: CONFIG_KEY,
            type: "json",
            value: JSON.stringify(config),
          },
        ],
      },
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
      }}
      dangerouslySetInnerHTML={{ __html: preview }}
    />
  );
}

// Setup step accordion component
function SetupStep({ step, isExpanded, isComplete, onToggle, onMarkComplete, onMarkIncomplete, onAction }) {
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
          ) : (
            <div
              style={{
                border: "2px dashed #d1d5db",
                borderRadius: 8,
                padding: "32px 16px",
                textAlign: "center",
                background: "#fafafa",
                marginBottom: 16,
              }}
            >
              <span style={{ fontSize: 24, display: "block", marginBottom: 8 }}>📷</span>
              <span style={{ color: "#9ca3af", fontSize: 13 }}>Screenshot Coming Soon</span>
            </div>
          )}

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
              <a
                href={step.secondaryUrl}
                style={{
                  color: "#2563eb",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                {step.secondaryLabel}
              </a>
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
    closed_days: settings?.closed_days || ["sat", "sun"],
    courier_no_delivery_days: settings?.courier_no_delivery_days || ["sat", "sun"],
    cutoff_time: settings?.cutoff_time || "14:00",
    bank_holiday_country: settings?.bank_holiday_country || "",
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
    icon_color: "#111827",
    // Step 5: ETA Timeline
    eta_delivery_days_min: 3,
    eta_delivery_days_max: 5,
    eta_border_width: 1,
    eta_border_radius: 8,
    eta_border_color: "#e5e7eb",
  });
  const ruleTotalSteps = 5;

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

  const handleRuleChange = (field, value) => {
    setRuleData(prev => ({ ...prev, [field]: value }));
  };

  const handleFinishSettingsWizard = () => {
    // Build global settings to save
    const newSettings = {
      ...(settings || {}),
      closed_days: settingsData.closed_days,
      courier_no_delivery_days: settingsData.courier_no_delivery_days,
      cutoff_time: settingsData.cutoff_time,
      bank_holiday_country: settingsData.bank_holiday_country,
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

        // Border defaults - match ETA timeline
        show_border: ruleData.eta_border_width > 0,
        border_thickness: ruleData.eta_border_width,
        border_color: ruleData.eta_border_color,
        border_radius: ruleData.eta_border_radius,
        max_width: 600,
        match_eta_border: true,
        match_eta_width: true,

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
        eta_connector_style: "arrows",
        eta_connector_color: ruleData.icon_color,
        eta_connector_use_main_color: true,
        eta_connector_alignment: "full",
        eta_color: ruleData.icon_color,
        eta_use_main_icon_color: true,
        show_eta_border: ruleData.eta_border_width > 0,
        eta_border_width: ruleData.eta_border_width,
        eta_border_color: ruleData.eta_border_color,
        eta_border_radius: ruleData.eta_border_radius,
        eta_delivery_days_min: ruleData.eta_delivery_days_min,
        eta_delivery_days_max: ruleData.eta_delivery_days_max,
        eta_timeline_initialized: true,  // Wizard syncs both, so mark as initialized
        eta_order_icon: "shopping-bag",
        eta_shipping_icon: "truck",
        eta_delivery_icon: "pin",
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
        eta_label_font_weight: "semibold",
        eta_date_color: "var(--p-color-text-subdued, #6b7280)",
        eta_date_font_size: "xsmall",
        eta_date_font_weight: "normal",
      },
    };

    // Submit to action - save rule only
    fetcher.submit(
      {
        shopId,
        action: "saveRule",
        ruleData: JSON.stringify(rule),
        config: JSON.stringify(config),
      },
      { method: "POST" }
    );
  };

  // Handle successful saves
  const [lastAction, setLastAction] = useState(null);

  if (fetcher.data?.ok && fetcher.data.action !== lastAction) {
    if (fetcher.data.action === "saveSettings") {
      setLastAction("saveSettings");
      setShowSettingsWizard(false);
      // Reload page to show updated settings
      window.location.reload();
    } else if (fetcher.data.action === "saveRule") {
      setLastAction("saveRule");
      // Navigate to editor with the newly created rule selected
      navigate(createdRuleId ? `/app?selectRule=${createdRuleId}` : "/app");
    }
  }

  const settingsTotalSteps = 3;

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
                  { id: "cart_messaging", countsForProgress: true },
                  { id: "announcement_bar", countsForProgress: true },
                  { id: "configure_settings", countsForProgress: true, autoComplete: !!settings?.cutoff_time },
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
                  images: [
                    {
                      src: "/images/setup/product-page-setup-1.png",
                      steps: [
                        "Expand the Product Information block",
                        "Select 'Add block', and one at a time add each of the Messages blocks (Delivery Messaging, ETA Timeline & Special Delivery)",
                      ],
                    },
                    {
                      src: "/images/setup/product-page-setup-2.png",
                      steps: [
                        "Drag the Delivery Messaging block to a suitable position",
                        "Drag the ETA Timeline block to a suitable position",
                        "Drag the Special Delivery block to a suitable position",
                      ],
                    },
                  ],
                  onImageClick: setLightboxImage,
                }}
                isExpanded={expandedStep === "product_page"}
                isComplete={manualCompleted.has("product_page")}
                onToggle={() => setExpandedStep(expandedStep === "product_page" ? null : "product_page")}
                onMarkComplete={() => setManualCompleted(prev => new Set([...prev, "product_page"]))}
                onMarkIncomplete={() => setManualCompleted(prev => { const next = new Set(prev); next.delete("product_page"); return next; })}
              />

              {/* Step 2: Cart Messaging Setup */}
              <SetupStep
                step={{
                  id: "cart_messaging",
                  title: "Cart Messaging Setup",
                  description: "Enable the Cart Messaging app embed to show free delivery progress in your cart drawer and cart page.",
                  actionLabel: "Open App Embeds",
                  actionUrl: freeDeliveryEditorUrl,
                  images: [
                    {
                      src: "/images/setup/cart-messaging-setup-1.png",
                      steps: [
                        "Select App Embeds from the left hand menu",
                        "Enable the Cart Messaging App Embed",
                      ],
                    },
                  ],
                  onImageClick: setLightboxImage,
                }}
                isExpanded={expandedStep === "cart_messaging"}
                isComplete={manualCompleted.has("cart_messaging")}
                onToggle={() => setExpandedStep(expandedStep === "cart_messaging" ? null : "cart_messaging")}
                onMarkComplete={() => setManualCompleted(prev => new Set([...prev, "cart_messaging"]))}
                onMarkIncomplete={() => setManualCompleted(prev => { const next = new Set(prev); next.delete("cart_messaging"); return next; })}
              />

              {/* Step 3: Announcement Bar Setup */}
              <SetupStep
                step={{
                  id: "announcement_bar",
                  title: "Announcement Bar Setup",
                  description: "Add the Delivery Announcement block to your theme's header or announcement bar section.",
                  actionLabel: "Open Theme Editor",
                  actionUrl: shopDomain ? `https://${shopDomain}/admin/themes/current/editor` : "#",
                  images: [
                    {
                      src: "/images/setup/announcement-bar-1.png",
                      steps: [
                        "Disable Shopify's built-in Announcement Bar",
                        "Click 'Add section'",
                        "Choose 'Delivery Announcement' from the Apps menu",
                      ],
                    },
                    {
                      src: "/images/setup/announcement-bar-2.png",
                      steps: [
                        "Drag the Apps block above the page header",
                        "Adjust margins to page or container width",
                        "Enable/disable 'Reveal sections on scroll' if available",
                      ],
                    },
                  ],
                  onImageClick: setLightboxImage,
                }}
                isExpanded={expandedStep === "announcement_bar"}
                isComplete={manualCompleted.has("announcement_bar")}
                onToggle={() => setExpandedStep(expandedStep === "announcement_bar" ? null : "announcement_bar")}
                onMarkComplete={() => setManualCompleted(prev => new Set([...prev, "announcement_bar"]))}
                onMarkIncomplete={() => setManualCompleted(prev => { const next = new Set(prev); next.delete("announcement_bar"); return next; })}
              />

              {/* Step 4: Configure Store Settings */}
              <SetupStep
                step={{
                  id: "configure_settings",
                  title: "Configure Store Settings",
                  description: "Set your business hours, cutoff times, and bank holidays. These settings apply to all rules.",
                  actionLabel: "Configure Settings",
                  onAction: () => setShowSettingsWizard(true),
                  secondaryLabel: "Go to Settings",
                  secondaryUrl: "/app?openSettings=true",
                  images: [
                    {
                      src: "/images/setup/settings-1.png",
                      steps: [
                        "Go into the Messages section of the app by pressing the Messages button in the main menu",
                        "Select Global Settings from the top menu, the Global Settings will appear in the editor window",
                      ],
                    },
                  ],
                  onImageClick: setLightboxImage,
                  autoComplete: true,
                }}
                isExpanded={expandedStep === "configure_settings"}
                isComplete={!!settings?.cutoff_time}
                onToggle={() => setExpandedStep(expandedStep === "configure_settings" ? null : "configure_settings")}
                onAction={() => setShowSettingsWizard(true)}
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
                  description: "Rules determine what delivery information is shown for different products. Create your first rule to get started.",
                  actionLabel: "Create Rule",
                  onAction: () => setShowRuleWizard(true),
                  secondaryLabel: "Go to Messages",
                  secondaryUrl: "/app",
                  images: [
                    {
                      src: "/images/setup/create-a-rule-1.png",
                      steps: [
                        "Go to the Messages section by clicking Messages in the main menu",
                        "Select Editor from the top menu (visible by default)",
                        "Rename your rule here",
                        "Use Editor blocks to match products and configure delivery messages",
                        "The preview updates live as you make changes (may vary based on theme)",
                        "Save your changes — auto-save triggers a few seconds after each edit",
                        "Add a new rule or duplicate an existing one",
                        "View rule priority order in the Rules panel",
                      ],
                    },
                  ],
                  onImageClick: setLightboxImage,
                  autoComplete: true,
                }}
                isExpanded={expandedStep === "create_rule"}
                isComplete={hasRules}
                onToggle={() => setExpandedStep(expandedStep === "create_rule" ? null : "create_rule")}
                onAction={() => setShowRuleWizard(true)}
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

            {/* Step Content */}
            {/* Step 1: Business & Courier Days */}
            {settingsStep === 1 && (
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
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "16px" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <s-text variant="bodySm" tone="subdued">
                    These can be customized for individual rules in the Editor.
                  </s-text>
                </div>
              </div>
            )}

            {/* Step 2: Cutoff Time */}
            {settingsStep === 2 && (
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

                {/* Info note */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "16px" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <s-text variant="bodySm" tone="subdued">
                    Different cutoff times for weekends can be configured in Settings, or set per-rule in the Editor.
                  </s-text>
                </div>
              </div>
            )}

            {/* Step 3: Bank Holidays */}
            {settingsStep === 3 && (
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
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "16px" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <s-text variant="bodySm" tone="subdued">
                    Additional custom holidays can be added in Settings.
                  </s-text>
                </div>
              </div>
            )}

            {/* Navigation buttons */}
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
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "16px" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <s-text variant="bodySm" tone="subdued">
                    You can change this anytime in the Editor.
                  </s-text>
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
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "16px" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <s-text variant="bodySm" tone="subdued">
                    Leave tags empty to create a fallback rule that matches all products.
                  </s-text>
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
                    }}
                  />
                  <MessagePreview text={ruleData.message_line_2} />
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "16px" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <s-text variant="bodySm" tone="subdued">
                    Use {"{countdown}"} for live timer, {"{arrival}"} for delivery date, {"{express}"} for next-day date, **text** for bold.
                  </s-text>
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
                  <s-color-field
                    label="Icon color"
                    placeholder="#111827"
                    value={ruleData.icon_color}
                    onInput={(e) => handleRuleChange("icon_color", e.target.value)}
                  />
                </s-box>

                {/* Info tooltip */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "16px" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <s-text variant="bodySm" tone="subdued">
                    This color will also be used for the ETA timeline icons and connectors.
                  </s-text>
                </div>
              </div>
            )}

            {/* Step 5: ETA Timeline */}
            {ruleStep === 5 && (
              <div>
                <s-text variant="headingMd">ETA Timeline</s-text>
                <s-box paddingBlockStart="base">
                  <s-text tone="subdued">
                    Configure the delivery timeline that shows order → shipped → delivered stages.
                  </s-text>
                </s-box>

                {/* Delivery Days - Side by Side */}
                <s-box paddingBlockStart="large">
                  <div style={{ display: "flex", gap: "24px" }}>
                    <label style={{ flex: 1 }}>
                      <s-text variant="bodySm">Min days (after shipping)</s-text>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={ruleData.eta_delivery_days_min}
                        onChange={(e) => handleRuleChange("eta_delivery_days_min", parseInt(e.target.value) || 1)}
                        style={{
                          width: "75%",
                          marginTop: "8px",
                          padding: "8px 12px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "14px",
                        }}
                      />
                    </label>
                    <label style={{ flex: 1 }}>
                      <s-text variant="bodySm">Max days (after shipping)</s-text>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={ruleData.eta_delivery_days_max}
                        onChange={(e) => handleRuleChange("eta_delivery_days_max", parseInt(e.target.value) || 1)}
                        style={{
                          width: "75%",
                          marginTop: "8px",
                          padding: "8px 12px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "14px",
                        }}
                      />
                    </label>
                  </div>
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
                        style={{
                          width: "75%",
                          marginTop: "8px",
                          padding: "8px 12px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "14px",
                        }}
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
                        style={{
                          width: "75%",
                          marginTop: "8px",
                          padding: "8px 12px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "14px",
                        }}
                      />
                    </label>
                  </div>
                </s-box>

                {/* Border Color */}
                <s-box paddingBlockStart="large">
                  <s-color-field
                    label="Border color"
                    placeholder="#e5e7eb"
                    value={ruleData.eta_border_color}
                    onInput={(e) => handleRuleChange("eta_border_color", e.target.value)}
                  />
                </s-box>

                {/* Info tooltips */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "16px" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <s-text variant="bodySm" tone="subdued">
                    Set border thickness to 0 for no border.
                  </s-text>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                  <s-text variant="bodySm" tone="subdued">
                    Message block border will match these settings (can be changed later in the Editor).
                  </s-text>
                </div>
              </div>
            )}

            {/* Navigation buttons */}
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

      {/* Already have rules? */}
      {hasRules && (
        <s-section>
          <s-box padding="base" background="success-subdued" borderRadius="base">
            <s-text>
              You already have rules set up! Visit the{" "}
              <s-link href="/app">Editor</s-link>
              {" "}to manage them.
            </s-text>
          </s-box>
        </s-section>
      )}
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
