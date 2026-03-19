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
 * @param {number} props.lineNumber - The line number (1-4) for per-line icon support
 * @param {React.ReactNode} props.children - The message content to display
 */
export function PreviewLine({ rule, globalSettings, lineNumber, children }) {
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

  // Only use per-line overrides when the override checkbox is checked
  const usePerLineOverrides = rule.settings?.show_icon_per_line_overrides === true;

  // Check for per-line icon override, fall back to main icon
  const perLineIconKey = `icon_line_${lineNumber}`;
  const perLineIcon = usePerLineOverrides ? rule.settings?.[perLineIconKey] : null;
  const mainIcon = rule.settings?.icon;

  // "none" explicitly hides the icon (no space), different from "spacer" (keeps space)
  const hideIcon = perLineIcon === "none";
  const effectiveIcon = getEffectiveIcon(perLineIcon || mainIcon);

  // Check for per-line style override, fall back to main style
  const perLineStyleKey = `icon_line_${lineNumber}_style`;
  const perLineStyle = usePerLineOverrides ? rule.settings?.[perLineStyleKey] : null;
  const mainStyle = rule.settings?.icon_style || "solid";
  const effectiveStyle = perLineStyle || mainStyle;

  // Check for per-line color override, fall back to main color
  const perLineColorKey = `icon_line_${lineNumber}_color`;
  const perLineColor = usePerLineOverrides ? rule.settings?.[perLineColorKey] : null;
  const mainColor = rule.settings?.icon_color ?? "#111827";
  const effectiveColor = perLineColor || mainColor;

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
    <div style={{ display: "flex", alignItems: "center", gap: (showIcon && !isSingleLayout && !hideIcon) ? "0.5em" : 0 }}>
      {!isSingleLayout && showIcon && !hideIcon && (
        <span
          aria-hidden="true"
          style={{
            width: "1.3em",
            height: "1.3em",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: effectiveColor,
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
            getIconSvg(effectiveIcon, effectiveStyle) ? (
              <span
                dangerouslySetInnerHTML={{ __html: getIconSvg(effectiveIcon, effectiveStyle) }}
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
