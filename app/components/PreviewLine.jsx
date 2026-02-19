// ============================================================================
// PREVIEW LINE COMPONENT
// Renders a single delivery message line with optional icon
// ============================================================================

import { getIconSvg } from "../utils/icons";

/**
 * PreviewLine - Renders a message line with an optional leading icon
 * @param {Object} props
 * @param {Object} props.rule - The rule object containing settings
 * @param {Object} props.globalSettings - Global settings containing custom_icons
 * @param {React.ReactNode} props.children - The message content to display
 */
export function PreviewLine({ rule, globalSettings, children }) {
  const isSingleLayout = rule.settings?.icon_layout === "single";
  const showIcon = rule.settings?.show_icon !== false;

  // Get effective icon (falls back to "truck" if custom icon no longer configured)
  const getEffectiveIcon = (iconValue) => {
    if (!iconValue) return "truck";
    if (iconValue.startsWith("custom-")) {
      const customIdx = parseInt(iconValue.split("-")[1]) - 1;
      const customIcon = globalSettings?.custom_icons?.[customIdx];
      const isConfigured = customIcon?.svg || customIcon?.url;
      return isConfigured ? iconValue : "truck";
    }
    return iconValue;
  };

  const effectiveIcon = getEffectiveIcon(rule.settings?.icon);

  // Helper to render custom icon from global settings
  const renderCustomIcon = () => {
    if (!effectiveIcon.startsWith("custom-")) return null;
    const customIdx = parseInt(effectiveIcon.split("-")[1]) - 1;
    const customIcon = globalSettings?.custom_icons?.[customIdx];
    if (customIcon?.svg) {
      return (
        <span
          dangerouslySetInnerHTML={{ __html: customIcon.svg }}
          style={{
            width: "1.3em",
            height: "1.3em",
            maxWidth: "1.3em",
            maxHeight: "1.3em",
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
            width: "1.3em",
            height: "1.3em",
            maxWidth: "1.3em",
            maxHeight: "1.3em",
            objectFit: "contain",
            display: "block",
          }}
        />
      );
    }
    return null;
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: (showIcon && !isSingleLayout) ? "0.5em" : 0 }}>
      {!isSingleLayout && showIcon && (
        <span
          aria-hidden="true"
          style={{
            width: "1.3em",
            height: "1.3em",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: rule.settings?.icon_color ?? "#111827",
            flex: "0 0 auto",
            lineHeight: 1,
            overflow: "hidden",
            marginTop: "0.05em",
            transform: "none",
          }}
        >
          {effectiveIcon.startsWith("custom-") ? (
            renderCustomIcon()
          ) : (
            getIconSvg(effectiveIcon, rule.settings?.icon_style || "solid") ? (
              <span
                dangerouslySetInnerHTML={{ __html: getIconSvg(effectiveIcon, rule.settings?.icon_style || "solid") }}
                style={{
                  width: "1.3em",
                  height: "1.3em",
                  display: "block",
                }}
              />
            ) : null
          )}
        </span>
      )}

      <div style={{ lineHeight: 1.3 }}>{children}</div>
    </div>
  );
}
