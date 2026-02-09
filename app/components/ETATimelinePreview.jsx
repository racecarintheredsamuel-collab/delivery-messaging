// ============================================================================
// ETA TIMELINE PREVIEW COMPONENT
// Renders an ETA timeline with stages (Ordered, Shipped, Delivered) and dates
// ============================================================================

import { getEtaIconPaths } from "../utils/icons";
import { normalizeEtaLabelFontSize, normalizeEtaDateFontSize } from "../utils/styling";

/**
 * Safely parse a HH:MM time string with validation
 * @param {string} timeStr - Time string to parse
 * @param {number} defaultHour - Default hour if parsing fails
 * @param {number} defaultMin - Default minute if parsing fails
 * @returns {{ hour: number, min: number }} - Parsed parts with defaults on failure
 */
function parseTimeString(timeStr, defaultHour = 14, defaultMin = 0) {
  if (typeof timeStr !== "string" || !timeStr) {
    return { hour: defaultHour, min: defaultMin };
  }
  const parts = timeStr.split(":");
  if (parts.length < 2) {
    return { hour: defaultHour, min: defaultMin };
  }
  const hour = parseInt(parts[0], 10);
  const min = parseInt(parts[1], 10);
  if (isNaN(hour) || isNaN(min)) {
    return { hour: defaultHour, min: defaultMin };
  }
  return { hour, min };
}

/**
 * ETATimelinePreview - Renders an ETA timeline with stages and calculated dates
 * @param {Object} props
 * @param {Object} props.rule - The rule object containing settings
 * @param {Object} props.globalSettings - Global settings for the app
 */
export function ETATimelinePreview({ rule, globalSettings }) {
  const iconPx = rule.settings?.eta_icon_size || 36;
  const mainIconColor = rule.settings?.icon_color || "#111827";
  // Use custom ETA color only if the "use main" flag is explicitly false
  const iconColor = rule.settings?.eta_use_main_icon_color === false
    ? (rule.settings?.eta_color || "#111827")
    : mainIconColor;
  const connectorStyle = rule.settings?.eta_connector_style || "arrows";
  const connectorAlignment = rule.settings?.eta_connector_alignment || "center";
  // Use custom connector color only if the "use main" flag is explicitly false
  const connectorColor = rule.settings?.eta_connector_use_main_color === false
    ? (rule.settings?.eta_connector_color || "#111827")
    : iconColor;
  const minDays = rule.settings?.eta_delivery_days_min ?? 3;
  const maxDays = rule.settings?.eta_delivery_days_max ?? 5;

  // ETA timeline always uses its own border settings
  // show_eta_border: undefined = true (default), false = hidden
  const showBorder = rule.settings?.show_eta_border !== false;
  const borderWidth = showBorder ? (rule.settings?.eta_border_width ?? 0) : 0;
  const borderColor = rule.settings?.eta_border_color || "#e5e7eb";
  const borderRadius = rule.settings?.eta_border_radius ?? 8;
  const backgroundColor = rule.settings?.eta_background_color || "";

  // Vertical spacing between elements (from global settings)
  const gapIconLabel = globalSettings?.eta_gap_icon_label ?? 2;
  const gapLabelDate = globalSettings?.eta_gap_label_date ?? 0;

  // Determine ETA font family from global settings
  let etaFontFamily = globalSettings?.eta_preview_theme_font || "inherit";
  if (globalSettings?.eta_use_theme_font === false) {
    if (globalSettings?.eta_match_messages_font && globalSettings?.custom_font_family) {
      etaFontFamily = globalSettings.custom_font_family;
    } else if (globalSettings?.eta_custom_font_family) {
      etaFontFamily = globalSettings.eta_custom_font_family;
    }
  }

  // Determine ETA text styling - per-rule override takes precedence
  // Use normalize functions to handle both string keywords and numeric px values
  const getEtaFontWeight = (weight) => {
    switch (weight) {
      case "normal": return 400;
      case "medium": return 500;
      case "bold": return 700;
      default: return 600; // semibold
    }
  };

  // Font size scale for theme preview (applies to all text uniformly)
  // Base multiplier of 1.2 to compensate for admin UI having smaller base font than typical storefronts
  const baseMultiplier = 1.2;
  const scaleValue = globalSettings?.eta_preview_font_size_scale
    ? Math.round(globalSettings.eta_preview_font_size_scale * baseMultiplier)
    : Math.round(100 * baseMultiplier);
  const fontSizeScale = `${scaleValue}%`;

  // Label styling (Ordered, Shipped, Delivered)
  // Use "normal" (400) as default weight to match typical theme defaults
  let etaLabelColor = "inherit";
  let etaLabelFontSize = fontSizeScale;
  let etaLabelFontWeight = "normal";

  // Date styling (Jan 20, Jan 21-24)
  let etaDateColor = "inherit";
  let etaDateFontSize = fontSizeScale;
  let etaDateFontWeight = "normal";

  if (rule.settings?.override_eta_text_styling) {
    // Per-rule override
    etaLabelColor = rule.settings?.eta_label_color || "#374151";
    etaLabelFontSize = normalizeEtaLabelFontSize(rule.settings?.eta_label_font_size, 12);
    etaLabelFontWeight = getEtaFontWeight(rule.settings?.eta_label_font_weight);
    etaDateColor = rule.settings?.eta_date_color || "#6b7280";
    etaDateFontSize = normalizeEtaDateFontSize(rule.settings?.eta_date_font_size, 11);
    etaDateFontWeight = getEtaFontWeight(rule.settings?.eta_date_font_weight);
  } else if (globalSettings?.eta_use_theme_text_styling === false) {
    // Global custom styling
    etaLabelColor = globalSettings?.eta_label_color || "#374151";
    etaLabelFontSize = normalizeEtaLabelFontSize(globalSettings?.eta_label_font_size, 12);
    etaLabelFontWeight = getEtaFontWeight(globalSettings?.eta_label_font_weight);
    etaDateColor = globalSettings?.eta_date_color || "#6b7280";
    etaDateFontSize = normalizeEtaDateFontSize(globalSettings?.eta_date_font_size, 11);
    etaDateFontWeight = getEtaFontWeight(globalSettings?.eta_date_font_weight);
  }

  // Calculate sample dates for preview
  // Takes cutoff time, closed days, bank holidays, and custom holidays into account
  const previewTz = globalSettings?.preview_timezone || "";
  const now = new Date();
  let today;
  if (previewTz) {
    // Build a Date whose local fields match the shop timezone
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: previewTz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const g = (t) => parts.find((p) => p.type === t)?.value;
    today = new Date(
      Number(g("year")), Number(g("month")) - 1, Number(g("day")),
      Number(g("hour")), Number(g("minute")), Number(g("second"))
    );
  } else {
    today = now;
  }
  const weekdayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayDayName = weekdayNames[today.getDay()];

  // Separate override flags for each dispatch setting type
  const useCutoffOverride = rule.settings?.override_cutoff_times;
  const useLeadTimeOverride = rule.settings?.override_lead_time;
  const useClosedDaysOverride = rule.settings?.override_closed_days;
  const useCourierOverride = rule.settings?.override_courier_no_delivery_days;

  // Get cutoff time - check for non-empty string
  let cutoffTime = globalSettings?.cutoff_time || "14:00";
  if (useCutoffOverride && rule.settings?.cutoff_time && rule.settings.cutoff_time.trim() !== "") {
    cutoffTime = rule.settings.cutoff_time;
  }

  // Handle Saturday/Sunday specific cutoffs
  if (todayDayName === "sat") {
    const satCutoff = useCutoffOverride ? rule.settings?.cutoff_time_sat : globalSettings?.cutoff_time_sat;
    if (satCutoff && satCutoff.trim() !== "") cutoffTime = satCutoff;
  } else if (todayDayName === "sun") {
    const sunCutoff = useCutoffOverride ? rule.settings?.cutoff_time_sun : globalSettings?.cutoff_time_sun;
    if (sunCutoff && sunCutoff.trim() !== "") cutoffTime = sunCutoff;
  }

  const { hour: cutoffHour, min: cutoffMin } = parseTimeString(cutoffTime);

  // Check if we're before cutoff today
  const cutoffToday = new Date(today);
  cutoffToday.setHours(cutoffHour, cutoffMin, 0, 0);
  const beforeCutoff = today.getTime() < cutoffToday.getTime();

  // Get closed days (days business doesn't ship)
  const closedDaysArr = useClosedDaysOverride
    ? (rule.settings?.closed_days || [])
    : (globalSettings?.closed_days || []);
  const closedDays = new Set(
    Array.isArray(closedDaysArr) ? closedDaysArr :
    (typeof closedDaysArr === 'string' ? closedDaysArr.split(',').map(d => d.trim().toLowerCase()) : [])
  );

  // Get lead time (business days before shipping)
  const leadTime = useLeadTimeOverride
    ? (rule.settings?.lead_time ?? globalSettings?.lead_time ?? 0)
    : (globalSettings?.lead_time ?? 0);

  // Bank holidays and custom holidays are global-only settings (no per-rule UI)
  const bankHolidayCountry = globalSettings?.bank_holiday_country || "";

  // Get custom holidays (stored as objects with date and label properties)
  const customHolidaysArr = globalSettings?.custom_holidays || [];
  const customHolidays = new Set(
    Array.isArray(customHolidaysArr)
      ? customHolidaysArr
          .map(h => {
            if (typeof h === 'string') return h;
            if (h && typeof h === 'object' && 'date' in h) return h.date;
            return null;
          })
          .filter(Boolean)
      : []
  );

  // Bank holidays calculation (matches storefront JS country codes)
  const getBankHolidays = (country, year) => {
    const formatDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
    const getNthWeekday = (y, month, weekday, n) => {
      if (n > 0) {
        const first = new Date(y, month, 1);
        let diff = (weekday - first.getDay() + 7) % 7;
        return new Date(y, month, 1 + diff + (n - 1) * 7);
      } else {
        const last = new Date(y, month + 1, 0);
        let diff = (last.getDay() - weekday + 7) % 7;
        return new Date(y, month + 1, -diff + (n + 1) * 7);
      }
    };

    // Easter calculation (Anonymous Gregorian algorithm)
    const getEaster = (y) => {
      const a = y % 19, b = Math.floor(y / 100), c = y % 100;
      const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
      const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
      const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
      const m = Math.floor((a + 11 * h + 22 * l) / 451);
      const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
      const day = ((h + l - 7 * m + 114) % 31) + 1;
      return new Date(y, month, day);
    };

    const easter = getEaster(year);

    // GB (United Kingdom) - used by settings page
    if (country === "GB") {
      const earlyMay = getNthWeekday(year, 4, 1, 1); // First Monday of May
      const springBank = getNthWeekday(year, 4, 1, -1); // Last Monday of May
      const summerBank = getNthWeekday(year, 7, 1, -1); // Last Monday of August
      return [
        `${year}-01-01`, formatDateStr(addDays(easter, -2)), formatDateStr(addDays(easter, 1)),
        formatDateStr(earlyMay), formatDateStr(springBank), formatDateStr(summerBank),
        `${year}-12-25`, `${year}-12-26`
      ];
    }
    if (country === "US") {
      const mlkDay = getNthWeekday(year, 0, 1, 3); // 3rd Monday of Jan
      const presidentsDay = getNthWeekday(year, 1, 1, 3); // 3rd Monday of Feb
      const memorialDay = getNthWeekday(year, 4, 1, -1); // Last Monday of May
      const laborDay = getNthWeekday(year, 8, 1, 1); // 1st Monday of Sep
      const columbusDay = getNthWeekday(year, 9, 1, 2); // 2nd Monday of Oct
      const thanksgiving = getNthWeekday(year, 10, 4, 4); // 4th Thursday of Nov
      return [
        `${year}-01-01`, formatDateStr(mlkDay), formatDateStr(presidentsDay),
        formatDateStr(memorialDay), `${year}-06-19`, `${year}-07-04`,
        formatDateStr(laborDay), formatDateStr(columbusDay), `${year}-11-11`,
        formatDateStr(thanksgiving), `${year}-12-25`
      ];
    }
    if (country === "AU") {
      let ausDay = new Date(year, 0, 26);
      if (ausDay.getDay() === 0) ausDay = new Date(year, 0, 27);
      else if (ausDay.getDay() === 6) ausDay = new Date(year, 0, 28);
      const queensBirthday = getNthWeekday(year, 5, 1, 2); // 2nd Monday of June
      return [
        `${year}-01-01`, formatDateStr(ausDay), formatDateStr(addDays(easter, -2)),
        formatDateStr(addDays(easter, 1)), `${year}-04-25`, formatDateStr(queensBirthday),
        `${year}-12-25`, `${year}-12-26`
      ];
    }
    if (country === "CA") {
      const familyDay = getNthWeekday(year, 1, 1, 3); // 3rd Monday of Feb
      let victoriaDay = new Date(year, 4, 24);
      while (victoriaDay.getDay() !== 1) victoriaDay = addDays(victoriaDay, -1);
      const civicHoliday = getNthWeekday(year, 7, 1, 1); // 1st Monday of Aug
      const labourDay = getNthWeekday(year, 8, 1, 1); // 1st Monday of Sep
      const thanksgiving = getNthWeekday(year, 9, 1, 2); // 2nd Monday of Oct
      return [
        `${year}-01-01`, formatDateStr(familyDay), formatDateStr(addDays(easter, -2)),
        formatDateStr(victoriaDay), `${year}-07-01`, formatDateStr(civicHoliday),
        formatDateStr(labourDay), formatDateStr(thanksgiving), `${year}-11-11`,
        `${year}-12-25`, `${year}-12-26`
      ];
    }
    if (country === "DE") {
      return [
        `${year}-01-01`, formatDateStr(addDays(easter, -2)), formatDateStr(addDays(easter, 1)),
        `${year}-05-01`, formatDateStr(addDays(easter, 39)), formatDateStr(addDays(easter, 50)),
        `${year}-10-03`, `${year}-12-25`, `${year}-12-26`
      ];
    }
    if (country === "FR") {
      return [
        `${year}-01-01`, formatDateStr(addDays(easter, 1)), `${year}-05-01`,
        `${year}-05-08`, formatDateStr(addDays(easter, 39)), formatDateStr(addDays(easter, 50)),
        `${year}-07-14`, `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`
      ];
    }
    if (country === "IE") {
      const mayBank = getNthWeekday(year, 4, 1, 1);
      const juneBank = getNthWeekday(year, 5, 1, 1);
      const augustBank = getNthWeekday(year, 7, 1, 1);
      const octoberBank = getNthWeekday(year, 9, 1, -1);
      return [
        `${year}-01-01`, `${year}-02-01`, `${year}-03-17`, formatDateStr(addDays(easter, 1)),
        formatDateStr(mayBank), formatDateStr(juneBank), formatDateStr(augustBank),
        formatDateStr(octoberBank), `${year}-12-25`, `${year}-12-26`
      ];
    }
    return [];
  };

  // Check if a date is a holiday
  const isHoliday = (date) => {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (customHolidays.has(dateStr)) return true;
    if (bankHolidayCountry) {
      const bankHolidays = getBankHolidays(bankHolidayCountry, date.getFullYear());
      if (bankHolidays.includes(dateStr)) return true;
    }
    return false;
  };

  const isTodayClosed = closedDays.has(todayDayName);
  const isTodayHoliday = isHoliday(today);

  // Determine shipping date
  let shippingDate;
  if (beforeCutoff && !isTodayClosed && !isTodayHoliday) {
    // Before cutoff, business is open, and not a holiday - ships today
    shippingDate = new Date(today);
  } else {
    // After cutoff, today is closed, or today is a holiday - find next open day
    shippingDate = new Date(today.getTime() + 86400000); // Start with tomorrow
    let attempts = 0;
    while (attempts < 14) {
      const dayName = weekdayNames[shippingDate.getDay()];
      if (!closedDays.has(dayName) && !isHoliday(shippingDate)) break;
      shippingDate = new Date(shippingDate.getTime() + 86400000);
      attempts++;
    }
  }

  // Apply lead time: add X business days to shipping date
  if (leadTime > 0) {
    let daysAdded = 0;
    let maxAttempts = 60;
    while (daysAdded < leadTime && maxAttempts > 0) {
      shippingDate = new Date(shippingDate.getTime() + 86400000);
      const dayName = weekdayNames[shippingDate.getDay()];
      if (!closedDays.has(dayName) && !isHoliday(shippingDate)) {
        daysAdded++;
      }
      maxAttempts--;
    }
  }

  // Courier non-delivery days - use rule override if enabled
  const courierNoDeliveryArr = useCourierOverride
    ? (rule.settings?.courier_no_delivery_days ?? globalSettings?.courier_no_delivery_days ?? ["sat", "sun"])
    : (globalSettings?.courier_no_delivery_days || ["sat", "sun"]);
  const courierNoDeliveryDays = new Set(
    Array.isArray(courierNoDeliveryArr) ? courierNoDeliveryArr :
    (typeof courierNoDeliveryArr === 'string' ? courierNoDeliveryArr.split(',').map(d => d.trim().toLowerCase()) : ["sat", "sun"])
  );

  // Calculate delivery date by adding business days (skipping courier no-delivery days AND holidays)
  const addDeliveryDays = (startDate, numDays) => {
    let currentDate = new Date(startDate.getTime());
    let daysAdded = 0;
    let maxAttempts = 60; // Safety limit

    while (daysAdded < numDays && maxAttempts > 0) {
      currentDate = new Date(currentDate.getTime() + 86400000); // Add 1 day
      const dayName = weekdayNames[currentDate.getDay()];
      // Skip courier no-delivery days AND holidays
      const isNoDeliveryDay = courierNoDeliveryDays.has(dayName);
      const isHolidayDay = isHoliday(currentDate);
      if (!isNoDeliveryDay && !isHolidayDay) {
        daysAdded++;
      }
      maxAttempts--;
    }
    return currentDate;
  };

  const deliveryMinDate = addDeliveryDays(shippingDate, minDays);
  const deliveryMaxDate = addDeliveryDays(shippingDate, maxDays);

  const formatDate = (date) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  };

  const deliveryDateStr = minDays === maxDays
    ? formatDate(deliveryMinDate)
    : deliveryMinDate.getMonth() === deliveryMaxDate.getMonth()
      ? `${formatDate(deliveryMinDate)}-${deliveryMaxDate.getDate()}`
      : `${formatDate(deliveryMinDate)}-${formatDate(deliveryMaxDate)}`;

  const Connector = () => {
    // When alignment is "icon", apply margin-top to center connector with icons
    const mtLine = connectorAlignment === "icon" ? iconPx / 2 - 1 : 0;
    const mtBigArrow = connectorAlignment === "icon" ? iconPx / 2 - 18 : 0;
    const mtArrows = connectorAlignment === "icon" ? iconPx / 2 - 8 : 0;

    if (connectorStyle === "line") {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 40px", marginTop: mtLine }}>
          <span style={{ display: "block", width: 40, borderTop: `1.5px solid ${connectorColor}` }} />
        </div>
      );
    }
    if (connectorStyle === "big-arrow") {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, color: connectorColor, marginTop: mtBigArrow }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 36, height: 36 }}>
            <path fillRule="evenodd" d="M16.72 7.72a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H3a.75.75 0 0 1 0-1.5h16.19l-2.47-2.47a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </div>
      );
    }
    if (connectorStyle === "custom" && globalSettings?.custom_connector_svg) {
      const mtCustom = connectorAlignment === "icon" ? iconPx / 2 - 18 : 0;
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: connectorColor, marginTop: mtCustom }}>
          <span
            style={{ width: 36, height: 36, display: "block" }}
            dangerouslySetInnerHTML={{ __html: globalSettings.custom_connector_svg }}
          />
        </div>
      );
    }
    return (
      <div style={{ display: "flex", gap: 0, margin: "0 -4px", marginTop: mtArrows }}>
        {[1, 2, 3].map((i) => (
          <svg key={i} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={connectorColor} style={{ width: 16, height: 16 }}>
            <path fillRule="evenodd" d="M16.28 11.47a.75.75 0 0 1 0 1.06l-7.5 7.5a.75.75 0 0 1-1.06-1.06L14.69 12 7.72 5.03a.75.75 0 0 1 1.06-1.06l7.5 7.5Z" clipRule="evenodd" />
          </svg>
        ))}
      </div>
    );
  };

  // Get effective icon (falls back to default if custom icon no longer configured)
  const getEffectiveIcon = (iconValue, defaultIcon) => {
    if (!iconValue) return defaultIcon;
    if (iconValue.startsWith("custom-")) {
      const customIdx = parseInt(iconValue.split("-")[1]) - 1;
      const customIcon = globalSettings?.custom_icons?.[customIdx];
      const isConfigured = customIcon?.svg || customIcon?.url;
      return isConfigured ? iconValue : defaultIcon;
    }
    return iconValue;
  };

  // Get icon name based on stage type
  const getStageIconName = (stageType) => {
    if (stageType === "order") return getEffectiveIcon(rule.settings?.eta_order_icon, "clipboard-document-check");
    if (stageType === "shipping") return getEffectiveIcon(rule.settings?.eta_shipping_icon, "truck");
    if (stageType === "delivery") return getEffectiveIcon(rule.settings?.eta_delivery_icon, "home");
    return "clipboard-document-check";
  };

  // Get icon style based on stage type
  const getStageIconStyle = (stageType) => {
    if (stageType === "order") return rule.settings?.eta_order_icon_style || "solid";
    if (stageType === "shipping") return rule.settings?.eta_shipping_icon_style || "solid";
    if (stageType === "delivery") return rule.settings?.eta_delivery_icon_style || "solid";
    return "solid";
  };

  const Stage = ({ label, date, icon, extraMarginRight = 0 }) => {
    const iconName = getStageIconName(icon);
    const iconStyle = getStageIconStyle(icon);

    // Check if this is a custom icon from global settings
    const isCustomIcon = iconName?.startsWith("custom-");
    let customIconContent = null;
    if (isCustomIcon) {
      const customIdx = parseInt(iconName.split("-")[1]) - 1;
      const customIcon = globalSettings?.custom_icons?.[customIdx];
      if (customIcon?.svg) {
        customIconContent = (
          <span
            dangerouslySetInnerHTML={{ __html: customIcon.svg }}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        );
      } else if (customIcon?.url) {
        customIconContent = (
          <img
            src={customIcon.url}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        );
      }
    }

    return (
      <div style={{ flex: 1, minWidth: 0, marginRight: extraMarginRight, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ width: iconPx, height: iconPx, marginBottom: gapIconLabel, color: iconColor }}>
          {isCustomIcon ? (
            customIconContent
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: "100%", height: "100%" }}>
              {getEtaIconPaths(iconName, iconStyle)}
            </svg>
          )}
        </div>
        <div style={{ fontSize: etaLabelFontSize, fontWeight: etaLabelFontWeight, lineHeight: 1, marginBottom: gapLabelDate, fontFamily: etaFontFamily, color: etaLabelColor }}>{label}</div>
        <div style={{ fontSize: etaDateFontSize, fontWeight: etaDateFontWeight, lineHeight: 1, color: etaDateColor, fontFamily: etaFontFamily, whiteSpace: "nowrap" }}>{date}</div>
      </div>
    );
  };

  // Horizontal gap between stages (from global settings)
  const horizontalGap = globalSettings?.eta_horizontal_gap ?? 12;
  const paddingHorizontal = globalSettings?.eta_padding_horizontal ?? 8;
  const paddingVertical = globalSettings?.eta_padding_vertical ?? 8;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: connectorAlignment === "icon" ? "flex-start" : "center",
        justifySelf: "start",
        gap: horizontalGap,
        maxWidth: "100%",
        padding: `${paddingVertical}px ${paddingHorizontal}px`,
        ...(borderWidth > 0 ? {
          border: `${borderWidth}px solid ${borderColor}`,
          borderRadius: borderRadius,
        } : {}),
        ...(backgroundColor ? { backgroundColor, borderRadius: borderRadius } : {}),
      }}
    >
      <Stage label={rule.settings?.eta_label_order || "Ordered"} date={formatDate(today)} icon="order" />
      <Connector />
      <Stage label={rule.settings?.eta_label_shipping || "Shipped"} date={formatDate(shippingDate)} icon="shipping" />
      <Connector />
      <Stage
        label={rule.settings?.eta_label_delivery || "Delivered"}
        date={deliveryDateStr}
        icon="delivery"
        extraMarginRight={minDays !== maxDays && deliveryMinDate.getMonth() !== deliveryMaxDate.getMonth() ? paddingHorizontal : 0}
      />
    </div>
  );
}
