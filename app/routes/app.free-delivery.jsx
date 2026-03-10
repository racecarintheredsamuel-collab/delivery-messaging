// ============================================================================
// IMPORTS
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { safeLogError, validateSettings } from "../utils/validation";
import { generateIconsMetafield, getIconSvg, getConfiguredUtilityIcons, getUtilityIconSvg } from "../utils/icons";
import { ChevronDownIcon, ChevronRightIcon } from "../components/icons/ChevronIcons";
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

  // Generate icons metafield (ensures utility icons are synced)
  const iconsData = generateIconsMetafield();

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
        {
          ownerId: shopId,
          namespace: METAFIELD_NAMESPACE,
          key: ICONS_KEY,
          type: "json",
          value: JSON.stringify(iconsData),
        },
      ],
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
// LOCALSTORAGE HELPERS - Persist expanded state for pricing configs
// ============================================================================

const PRICING_EXPANDED_KEY = 'fd_pricing_expanded';
const PRICING_LEVELS_EXPANDED_KEY = 'fd_pricing_levels_expanded';

const getExpandedConfigs = () => {
  try {
    const stored = localStorage.getItem(PRICING_EXPANDED_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
};

const setExpandedConfigsStorage = (configIds) => {
  try {
    localStorage.setItem(PRICING_EXPANDED_KEY, JSON.stringify([...configIds]));
  } catch {}
};

const getExpandedLevels = () => {
  try {
    const stored = localStorage.getItem(PRICING_LEVELS_EXPANDED_KEY);
    if (!stored) return new Map();
    const obj = JSON.parse(stored);
    const map = new Map();
    for (const [key, arr] of Object.entries(obj)) {
      map.set(key, new Set(arr));
    }
    return map;
  } catch {
    return new Map();
  }
};

const setExpandedLevelsStorage = (levelsMap) => {
  try {
    const obj = {};
    for (const [key, set] of levelsMap) {
      obj[key] = [...set];
    }
    localStorage.setItem(PRICING_LEVELS_EXPANDED_KEY, JSON.stringify(obj));
  } catch {}
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

  // Pricing configurations state (with migration from flat to levels format)
  const [pricingConfigs, setPricingConfigs] = useState(() => {
    const configs = settings.fd_pricing_configs || [];
    // Migrate flat segments to levels format
    return configs.map(config => {
      if (config.levels && config.levels.length > 0) {
        return config; // Already in levels format
      }
      // Migrate legacy flat format to single level
      if (config.segments && config.segments.length > 0) {
        return {
          ...config,
          levels: [{
            threshold: null, // No threshold for single level
            segments: config.segments,
            free_text: config.free_text,
            divider: config.divider,
            days_divider: config.days_divider,
            show_days: config.show_days,
          }],
        };
      }
      // New config - initialize with empty level
      return {
        ...config,
        levels: [{
          threshold: null,
          segments: [{ label: '', cost: 0, days: '' }, { label: '', cost: 0, days: '' }],
          free_text: 'Free over {threshold}',
          divider: '|',
          days_divider: '•',
          show_days: true,
        }],
      };
    });
  });
  const [expandedPricingConfigs, setExpandedPricingConfigsRaw] = useState(() => getExpandedConfigs());
  const [expandedLevels, setExpandedLevelsRaw] = useState(() => getExpandedLevels()); // Map<configId, Set<levelIndex>>

  // Wrappers that also persist to localStorage
  const setExpandedPricingConfigs = (updater) => {
    setExpandedPricingConfigsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setExpandedConfigsStorage(next);
      return next;
    });
  };
  const setExpandedLevels = (updater) => {
    setExpandedLevelsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setExpandedLevelsStorage(next);
      return next;
    });
  };
  const [lastDeletedPricingConfig, setLastDeletedPricingConfig] = useState(null);
  const undoPricingConfigTimerRef = useRef(null);

  // Sync exclusion rules to settings (also clear legacy fields)
  useEffect(() => {
    setSettings(prev => ({
      ...prev,
      fd_exclusion_rules: exclusionRules,
      fd_exclude_tags: [],     // Clear legacy
      fd_exclude_handles: [],  // Clear legacy
    }));
  }, [exclusionRules]);

  // Sync pricing configs to settings
  useEffect(() => {
    setSettings(prev => ({ ...prev, fd_pricing_configs: pricingConfigs }));
  }, [pricingConfigs]);

  // Legacy exclusion input text state (kept for backward compat during transition)
  const [excludeTagsText, setExcludeTagsText] = useState(() =>
    (settings.fd_exclude_tags || []).join(", ")
  );
  const [excludeHandlesText, setExcludeHandlesText] = useState(() =>
    (settings.fd_exclude_handles || []).join(", ")
  );
  const [leftUtilHover, setLeftUtilHover] = useState(false);
  const [rightUtilHover, setRightUtilHover] = useState(false);

  // Announcement Bar collapsible panels
  const [collapsedAnnouncementPanels, setCollapsedAnnouncementPanels] = useState({
    additional_messages: true,
    utility_links: true,
    styling: true,
    link_styling: true,
    exclusions: true,
  });

  const toggleAnnouncementPanel = (section) => {
    setCollapsedAnnouncementPanels(prev => ({ ...prev, [section]: !prev[section] }));
  };

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
    const hasMessages = settings.fd_announcement_progress_message || settings.fd_announcement_unlocked_message;
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

  // Delete pricing config with undo
  const deletePricingConfigWithUndo = (configId, index) => {
    if (undoPricingConfigTimerRef.current) clearTimeout(undoPricingConfigTimerRef.current);
    const configToDelete = pricingConfigs.find(c => c.id === configId);
    if (!configToDelete) return;
    setPricingConfigs(prev => prev.filter(c => c.id !== configId));
    setLastDeletedPricingConfig({ config: configToDelete, index });
    undoPricingConfigTimerRef.current = setTimeout(() => {
      setLastDeletedPricingConfig(null);
      undoPricingConfigTimerRef.current = null;
    }, 10000);
  };

  const undoDeletePricingConfig = () => {
    if (!lastDeletedPricingConfig) return;
    if (undoPricingConfigTimerRef.current) clearTimeout(undoPricingConfigTimerRef.current);
    undoPricingConfigTimerRef.current = null;
    const insertAt = Math.max(0, Math.min(lastDeletedPricingConfig.index ?? 0, pricingConfigs.length));
    const restored = [...pricingConfigs];
    restored.splice(insertAt, 0, lastDeletedPricingConfig.config);
    setPricingConfigs(restored);
    setLastDeletedPricingConfig(null);
  };

  // Helper to render text with **bold** support as JSX
  const renderBoldText = (text) => {
    if (!text || !text.includes('**')) return text;
    const parts = text.split('**');
    return parts.map((part, i) =>
      i % 2 === 1 ? <strong key={i}>{part}</strong> : part
    );
  };

  // Helper to generate pricing preview (uses first level)
  const getPricingPreview = (config, levelIndex = 0) => {
    if (!config) return '';

    // Use level data if available, fall back to flat fields for legacy
    const level = config.levels?.[levelIndex] || {};
    const segments = level.segments || config.segments || [];
    const divider = level.divider || config.divider || '|';
    const daysDivider = level.days_divider || config.days_divider || '•';
    const showDays = level.show_days ?? config.show_days ?? true;
    const freeTextEnabled = level.free_text_enabled;
    const freeText = freeTextEnabled ? (level.free_text ?? config.free_text) : null;

    const parts = [];
    for (const segment of segments) {
      let part = segment.label || '';
      if (segment.cost != null && segment.cost > 0) {
        const costStr = `£${(segment.cost / 100).toFixed(2).replace(/\.00$/, '')}`;
        part += ` ${segment.cost_bold ? '**' + costStr + '**' : costStr}`;
      }
      if (showDays && segment.days) {
        const daysStr = segment.days;
        part += ` ${daysDivider} ${segment.days_bold ? '**' + daysStr + '**' : daysStr}`;
      }
      if (part.trim()) parts.push(part.trim());
    }

    if (freeText) {
      const text = freeText.replace('{threshold}', `£${((settings.fd_threshold || 0) / 100).toFixed(2).replace(/\.00$/, '')}`);
      parts.push(text);
    }

    const fullText = parts.join(` ${divider} `);
    return renderBoldText(fullText);
  };

  // Reusable save button with floppy disk indicator
  const SaveButtonRow = () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
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
      <s-button variant="primary" onClick={handleSave}>
        Save
      </s-button>
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
                <div style={{ padding: "16px", display: "grid", gap: 16 }}>
                  <div>
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
              </div>

              {/* Section 2: Delivery Pricing */}
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
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <s-text style={{ fontWeight: 600 }}>Delivery Pricing</s-text>
                  {pricingConfigs.length > 0 && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <s-button
                        size="small"
                        onClick={() => {
                          setExpandedPricingConfigs(new Set());
                          setExpandedLevels(new Map());
                        }}
                      >
                        Collapse all
                      </s-button>
                      <s-button
                        size="small"
                        onClick={() => {
                          const allConfigIds = new Set(pricingConfigs.map(c => c.id));
                          setExpandedPricingConfigs(allConfigIds);
                          // Expand all levels in all configs
                          const allLevels = new Map();
                          pricingConfigs.forEach(c => {
                            const levelCount = (c.levels || []).length;
                            if (levelCount > 0) {
                              allLevels.set(c.id, new Set([...Array(levelCount).keys()]));
                            }
                          });
                          setExpandedLevels(allLevels);
                        }}
                      >
                        Expand all
                      </s-button>
                    </div>
                  )}
                </div>
                {/* Content */}
                <div style={{ padding: "16px", display: "grid", gap: 16 }}>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block" }}>
                    Create named pricing displays for use in message lines
                  </s-text>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", marginBottom: 4, display: "block", marginTop: -8 }}>
                    Use Pricing Displays by pasting {"{pricing:"}<em>name</em>{"}"} into any Messages line on the Messages page.
                  </s-text>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: -4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)" }}>
                      <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                      <span style={{ fontSize: 12 }}>Placeholders: {"{threshold}"}</span>
                      <span
                        title="{threshold} = free delivery threshold amount&#10;Can only be used in the Free delivery text field"
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

                    {/* Pricing Configs List */}
                    {pricingConfigs.map((config, index) => {
                      const isExpanded = expandedPricingConfigs.has(config.id);
                      const segmentCount = (config.segments || []).length;

                      return (
                        <div
                          key={config.id}
                          style={{
                            border: "1px solid var(--p-color-border, #e5e7eb)",
                            borderRadius: "6px",
                            overflow: "hidden",
                            marginBottom: 8,
                          }}
                        >
                          {/* Config Header (Collapsed) */}
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
                              setExpandedPricingConfigs(prev => {
                                const next = new Set(prev);
                                if (next.has(config.id)) next.delete(config.id);
                                else next.add(config.id);
                                return next;
                              });
                            }}
                          >
                            <span style={{ fontSize: 12, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
                            <s-text style={{ fontWeight: 500, flex: 1 }}>{config.name || 'Unnamed'}</s-text>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deletePricingConfigWithUndo(config.id, index);
                              }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9ca3af' }}
                              title="Delete"
                            >×</button>
                          </div>

                          {/* Config Content (Expanded) */}
                          {isExpanded && (
                            <div style={{ padding: "12px", display: "grid", gap: 12, borderTop: "1px solid var(--p-color-border, #e5e7eb)" }}>
                              {/* Name input */}
                              <div style={{ display: "flex", alignItems: "end", gap: 16 }}>
                                <label style={{ display: "block", maxWidth: 160 }}>
                                  <s-text size="small">Name</s-text>
                                  <input
                                    type="text"
                                    value={config.name || ''}
                                    onChange={(e) => {
                                      const newName = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
                                      setPricingConfigs(prev => prev.map(c =>
                                        c.id === config.id ? { ...c, name: newName } : c
                                      ));
                                    }}
                                    placeholder="e.g. standard"
                                    style={{ width: "100%" }}
                                  />
                                </label>
                                <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)", paddingBottom: 8 }}>
                                  Use: {"{pricing:" + (config.name || 'name') + "}"}
                                </s-text>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: -4 }}>
                                <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                                <span style={{ fontSize: 12 }}>Shipping levels allow you to display different shipping prices based on cart totals</span>
                              </div>

                              {/* Shipping Levels */}
                              <div style={{ display: "grid", gap: 8 }}>
                                {(config.levels || []).map((level, levelIndex) => {
                                  const configLevels = expandedLevels.get(config.id) || new Set();
                                  const isLevelExpanded = configLevels.has(levelIndex);
                                  const prevThreshold = levelIndex > 0 ? (config.levels[levelIndex - 1]?.threshold || 0) : 0;

                                  return (
                                    <div
                                      key={levelIndex}
                                      style={{
                                        border: "1px solid var(--p-color-border, #e5e7eb)",
                                        borderRadius: 4,
                                        overflow: "hidden",
                                      }}
                                    >
                                      {/* Level Header */}
                                      <div
                                        style={{
                                          padding: "8px 10px",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 8,
                                          background: "var(--p-color-bg-surface-secondary, #f3f4f6)",
                                          cursor: "pointer",
                                        }}
                                        onClick={() => {
                                          setExpandedLevels(prev => {
                                            const next = new Map(prev);
                                            const levelSet = new Set(next.get(config.id) || []);
                                            if (levelSet.has(levelIndex)) levelSet.delete(levelIndex);
                                            else levelSet.add(levelIndex);
                                            next.set(config.id, levelSet);
                                            return next;
                                          });
                                        }}
                                      >
                                        <span style={{ fontSize: 10, transform: isLevelExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
                                        <s-text size="small" style={{ fontWeight: 500, flex: 1 }}>
                                          Shipping Level {levelIndex + 1}
                                          {levelIndex === 0 && level.threshold == null && config.levels.length === 1 && (
                                            <span style={{ fontWeight: 400, color: "var(--p-color-text-subdued)" }}> (all carts)</span>
                                          )}
                                          {levelIndex === 0 && level.threshold != null && (
                                            <span style={{ fontWeight: 400, color: "var(--p-color-text-subdued)" }}> (cart &lt; £{(level.threshold / 100).toFixed(2).replace(/\.00$/, '')})</span>
                                          )}
                                          {levelIndex > 0 && (
                                            <span style={{ fontWeight: 400, color: "var(--p-color-text-subdued)" }}>
                                              {" "}(£{(prevThreshold / 100).toFixed(2).replace(/\.00$/, '')}+{level.threshold != null ? ` to £${(level.threshold / 100).toFixed(2).replace(/\.00$/, '')}` : ''})
                                            </span>
                                          )}
                                        </s-text>
                                        {config.levels.length > 1 && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setPricingConfigs(prev => prev.map(c => {
                                                if (c.id !== config.id) return c;
                                                const newLevels = [...(c.levels || [])];
                                                newLevels.splice(levelIndex, 1);
                                                // Clean up thresholds after deletion
                                                if (newLevels.length === 1) {
                                                  // Only one level left - clear its threshold so it shows "(all carts)"
                                                  newLevels[0] = { ...newLevels[0], threshold: null };
                                                } else if (newLevels.length > 1) {
                                                  // Clear threshold on last level so it shows "(£X+)" not "(£X+ to £Y)"
                                                  const lastIdx = newLevels.length - 1;
                                                  newLevels[lastIdx] = { ...newLevels[lastIdx], threshold: null };
                                                }
                                                return { ...c, levels: newLevels };
                                              }));
                                            }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9ca3af', fontSize: 14 }}
                                            title="Remove level"
                                          >×</button>
                                        )}
                                      </div>

                                      {/* Level Content */}
                                      {isLevelExpanded && (
                                        <div style={{ padding: 10, display: "grid", gap: 10 }}>
                                          {/* Threshold */}
                                          {(config.levels.length > 1 || level.threshold != null) && (
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                              <s-text size="small">
                                                {levelIndex === 0 ? "Cart is less than" : `Cart is £${(prevThreshold / 100).toFixed(2).replace(/\.00$/, '')}+ and less than`}
                                              </s-text>
                                              <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                                                <span style={{ fontSize: 12 }}>£</span>
                                                <input
                                                  type="text"
                                                  inputMode="decimal"
                                                  value={level.threshold != null ? (level.threshold / 100) : ''}
                                                  onChange={(e) => {
                                                    const val = e.target.value.trim();
                                                    const newThreshold = val === '' ? null : Math.round(parseFloat(val || 0) * 100);
                                                    setPricingConfigs(prev => prev.map(c => {
                                                      if (c.id !== config.id) return c;
                                                      const newLevels = [...(c.levels || [])];
                                                      newLevels[levelIndex] = { ...newLevels[levelIndex], threshold: newThreshold };
                                                      return { ...c, levels: newLevels };
                                                    }));
                                                  }}
                                                  placeholder="no limit"
                                                  style={{ width: 70 }}
                                                />
                                              </div>
                                            </div>
                                          )}

                                          {/* Segments */}
                                          {[0, 1].map((segIndex) => {
                                            const segments = level.segments || [];
                                            const segment = segments[segIndex] || { label: '', cost: 0, days: '' };
                                            return (
                                              <div key={segIndex} style={{ display: "grid", gridTemplateColumns: "140px 99px 101px", gap: 18, alignItems: "end" }}>
                                                <label>
                                                  {segIndex === 0 && <s-text size="small">Labels</s-text>}
                                                  <input
                                                    type="text"
                                                    value={segment.label || ''}
                                                    onChange={(e) => {
                                                      setPricingConfigs(prev => prev.map(c => {
                                                        if (c.id !== config.id) return c;
                                                        const newLevels = [...(c.levels || [])];
                                                        const newSegments = [...(newLevels[levelIndex]?.segments || [])];
                                                        while (newSegments.length <= segIndex) newSegments.push({ label: '', cost: 0, days: '' });
                                                        newSegments[segIndex] = { ...newSegments[segIndex], label: e.target.value };
                                                        newLevels[levelIndex] = { ...newLevels[levelIndex], segments: newSegments };
                                                        return { ...c, levels: newLevels };
                                                      }));
                                                    }}
                                                    placeholder={segIndex === 0 ? "Standard" : "Express"}
                                                    style={{ width: "100%" }}
                                                  />
                                                </label>
                                                <label>
                                                  {segIndex === 0 && <s-text size="small">Cost</s-text>}
                                                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                                                    <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>£</span>
                                                    <input
                                                      type="text"
                                                      inputMode="decimal"
                                                      key={`${config.id}-${levelIndex}-${segIndex}-${segment.cost}`}
                                                      defaultValue={segment.cost ? (segment.cost / 100) : ''}
                                                      onBlur={(e) => {
                                                        const val = parseFloat(e.target.value || 0);
                                                        const pence = Math.round((isNaN(val) ? 0 : val) * 100);
                                                        setPricingConfigs(prev => prev.map(c => {
                                                          if (c.id !== config.id) return c;
                                                          const newLevels = [...(c.levels || [])];
                                                          const newSegments = [...(newLevels[levelIndex]?.segments || [])];
                                                          while (newSegments.length <= segIndex) newSegments.push({ label: '', cost: 0, days: '' });
                                                          newSegments[segIndex] = { ...newSegments[segIndex], cost: pence };
                                                          newLevels[levelIndex] = { ...newLevels[levelIndex], segments: newSegments };
                                                          return { ...c, levels: newLevels };
                                                        }));
                                                      }}
                                                      style={{ width: "100%" }}
                                                    />
                                                    <label title="Bold" style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                                                      <input
                                                        type="checkbox"
                                                        checked={segment.cost_bold || false}
                                                        onChange={(e) => {
                                                          setPricingConfigs(prev => prev.map(c => {
                                                            if (c.id !== config.id) return c;
                                                            const newLevels = [...(c.levels || [])];
                                                            const newSegments = [...(newLevels[levelIndex]?.segments || [])];
                                                            while (newSegments.length <= segIndex) newSegments.push({ label: '', cost: 0, days: '' });
                                                            newSegments[segIndex] = { ...newSegments[segIndex], cost_bold: e.target.checked };
                                                            newLevels[levelIndex] = { ...newLevels[levelIndex], segments: newSegments };
                                                            return { ...c, levels: newLevels };
                                                          }));
                                                        }}
                                                        style={{ width: 14, height: 14 }}
                                                      />
                                                      <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 2 }}>B</span>
                                                    </label>
                                                  </div>
                                                </label>
                                                <label>
                                                  {segIndex === 0 && <s-text size="small">Days</s-text>}
                                                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                                                    <input
                                                      type="text"
                                                      value={segment.days || ''}
                                                      onChange={(e) => {
                                                        setPricingConfigs(prev => prev.map(c => {
                                                          if (c.id !== config.id) return c;
                                                          const newLevels = [...(c.levels || [])];
                                                          const newSegments = [...(newLevels[levelIndex]?.segments || [])];
                                                          while (newSegments.length <= segIndex) newSegments.push({ label: '', cost: 0, days: '' });
                                                          newSegments[segIndex] = { ...newSegments[segIndex], days: e.target.value };
                                                          newLevels[levelIndex] = { ...newLevels[levelIndex], segments: newSegments };
                                                          return { ...c, levels: newLevels };
                                                        }));
                                                      }}
                                                      placeholder="2-3d"
                                                      style={{ width: "100%" }}
                                                    />
                                                    <label title="Bold" style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                                                      <input
                                                        type="checkbox"
                                                        checked={segment.days_bold || false}
                                                        onChange={(e) => {
                                                          setPricingConfigs(prev => prev.map(c => {
                                                            if (c.id !== config.id) return c;
                                                            const newLevels = [...(c.levels || [])];
                                                            const newSegments = [...(newLevels[levelIndex]?.segments || [])];
                                                            while (newSegments.length <= segIndex) newSegments.push({ label: '', cost: 0, days: '' });
                                                            newSegments[segIndex] = { ...newSegments[segIndex], days_bold: e.target.checked };
                                                            newLevels[levelIndex] = { ...newLevels[levelIndex], segments: newSegments };
                                                            return { ...c, levels: newLevels };
                                                          }));
                                                        }}
                                                        style={{ width: 14, height: 14 }}
                                                      />
                                                      <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 2 }}>B</span>
                                                    </label>
                                                  </div>
                                                </label>
                                              </div>
                                            );
                                          })}

                                          {/* Free delivery text */}
                                          <div style={{ maxWidth: 234 }}>
                                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <input
                                                type="checkbox"
                                                checked={level.free_text_enabled || false}
                                                onChange={(e) => {
                                                  setPricingConfigs(prev => prev.map(c => {
                                                    if (c.id !== config.id) return c;
                                                    const newLevels = [...(c.levels || [])];
                                                    newLevels[levelIndex] = { ...newLevels[levelIndex], free_text_enabled: e.target.checked };
                                                    return { ...c, levels: newLevels };
                                                  }));
                                                }}
                                              />
                                              <s-text size="small">Free delivery text</s-text>
                                            </label>
                                            {level.free_text_enabled && (
                                              <input
                                                type="text"
                                                value={level.free_text ?? 'Free over {threshold}'}
                                                onChange={(e) => {
                                                  setPricingConfigs(prev => prev.map(c => {
                                                    if (c.id !== config.id) return c;
                                                    const newLevels = [...(c.levels || [])];
                                                    newLevels[levelIndex] = { ...newLevels[levelIndex], free_text: e.target.value };
                                                    return { ...c, levels: newLevels };
                                                  }));
                                                }}
                                                placeholder="Free over {threshold}"
                                                style={{ width: "100%", marginTop: 4 }}
                                              />
                                            )}
                                          </div>

                                          {/* Dividers */}
                                          <div style={{ display: "flex", gap: 16 }}>
                                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <s-text size="small">Divider</s-text>
                                              <select
                                                value={level.divider ?? '|'}
                                                onChange={(e) => {
                                                  setPricingConfigs(prev => prev.map(c => {
                                                    if (c.id !== config.id) return c;
                                                    const newLevels = [...(c.levels || [])];
                                                    newLevels[levelIndex] = { ...newLevels[levelIndex], divider: e.target.value };
                                                    return { ...c, levels: newLevels };
                                                  }));
                                                }}
                                                style={{ width: 65 }}
                                              >
                                                <option value="">None</option>
                                                <option value="|">|</option>
                                                <option value="•">•</option>
                                                <option value="-">-</option>
                                                <option value="/">/ </option>
                                                <option value="›">›</option>
                                              </select>
                                            </label>
                                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <s-text size="small">Days divider</s-text>
                                              <select
                                                value={level.days_divider ?? '•'}
                                                onChange={(e) => {
                                                  setPricingConfigs(prev => prev.map(c => {
                                                    if (c.id !== config.id) return c;
                                                    const newLevels = [...(c.levels || [])];
                                                    newLevels[levelIndex] = { ...newLevels[levelIndex], days_divider: e.target.value };
                                                    return { ...c, levels: newLevels };
                                                  }));
                                                }}
                                                style={{ width: 65 }}
                                              >
                                                <option value="">None</option>
                                                <option value="•">•</option>
                                                <option value="|">|</option>
                                                <option value="-">-</option>
                                                <option value="/">/ </option>
                                                <option value="›">›</option>
                                              </select>
                                            </label>
                                          </div>

                                          {/* Show days checkbox */}
                                          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <input
                                              type="checkbox"
                                              checked={level.show_days ?? true}
                                              onChange={(e) => {
                                                setPricingConfigs(prev => prev.map(c => {
                                                  if (c.id !== config.id) return c;
                                                  const newLevels = [...(c.levels || [])];
                                                  newLevels[levelIndex] = { ...newLevels[levelIndex], show_days: e.target.checked };
                                                  return { ...c, levels: newLevels };
                                                }));
                                              }}
                                            />
                                            <s-text size="small">Show delivery days</s-text>
                                          </label>

                                          {/* Level Preview */}
                                          <div style={{ padding: 6, background: "var(--p-color-bg-surface-hover, #f8fafc)", borderRadius: 4, fontSize: 12 }}>
                                            {getPricingPreview(config, levelIndex) || <span style={{ color: "var(--p-color-text-subdued)" }}>Add segments to see preview</span>}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}

                                {/* Add Level button */}
                                {(config.levels || []).length < 3 && (
                                  <div style={{ textAlign: 'center' }}>
                                  <s-button
                                    onClick={() => {
                                      setPricingConfigs(prev => prev.map(c => {
                                        if (c.id !== config.id) return c;
                                        const newLevels = [...(c.levels || [])];
                                        // Set threshold on previous level if not set
                                        if (newLevels.length > 0 && newLevels[newLevels.length - 1].threshold == null) {
                                          newLevels[newLevels.length - 1] = { ...newLevels[newLevels.length - 1], threshold: 2000 }; // Default £20
                                        }
                                        newLevels.push({
                                          threshold: null,
                                          segments: [{ label: '', cost: 0, days: '' }, { label: '', cost: 0, days: '' }],
                                          free_text: '',
                                          divider: '|',
                                          days_divider: '•',
                                          show_days: true,
                                        });
                                        return { ...c, levels: newLevels };
                                      }));
                                      // Auto-expand the new level
                                      setExpandedLevels(prev => {
                                        const next = new Map(prev);
                                        const levelSet = new Set(next.get(config.id) || []);
                                        levelSet.add((config.levels || []).length);
                                        next.set(config.id, levelSet);
                                        return next;
                                      });
                                    }}
                                  >
                                    Add Shipping Level
                                  </s-button>
                                  </div>
                                )}

                                {/* Cart Threshold Message */}
                                <div style={{ marginTop: 16 }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <input
                                      type="checkbox"
                                      checked={config.threshold_message_enabled || false}
                                      onChange={e => {
                                        setPricingConfigs(prev => prev.map(c =>
                                          c.id === config.id
                                            ? { ...c, threshold_message_enabled: e.target.checked }
                                            : c
                                        ));
                                      }}
                                    />
                                    <s-text>Cart Threshold Message</s-text>
                                  </label>
                                  {config.threshold_message_enabled && (
                                    <label style={{ display: "block", marginTop: 8 }}>
                                      <input
                                        type="text"
                                        value={config.threshold_message ?? "You've unlocked free delivery!"}
                                        onChange={e => {
                                          setPricingConfigs(prev => prev.map(c =>
                                            c.id === config.id
                                              ? { ...c, threshold_message: e.target.value }
                                              : c
                                          ));
                                        }}
                                        placeholder="You've unlocked free delivery!"
                                        style={{ width: "100%" }}
                                        maxLength={150}
                                      />
                                    </label>
                                  )}
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                                    <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                                    <span style={{ fontSize: 12 }}>Displays in place of pricing line when free delivery threshold is met</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Undo deletion banner */}
                    {lastDeletedPricingConfig && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 12px",
                          background: "var(--p-color-bg-caution-subdued, #fef3c7)",
                          borderRadius: 4,
                          marginBottom: 8,
                        }}
                      >
                        <s-text>Pricing Display deleted.</s-text>
                        <s-button size="small" onClick={undoDeletePricingConfig}>Undo</s-button>
                      </div>
                    )}

                  {/* Add Pricing Display button */}
                  {pricingConfigs.length < 10 && (
                    <div style={{ textAlign: 'center' }}>
                    <s-button
                      onClick={() => {
                        const newId = `config-${Date.now()}`;
                        setPricingConfigs(prev => [...prev, {
                          id: newId,
                          name: '',
                          levels: [{
                            threshold: null,
                            segments: [{ label: '', cost: 0, days: '' }, { label: '', cost: 0, days: '' }],
                            free_text: 'Free over {threshold}',
                            divider: '|',
                            days_divider: '•',
                            show_days: true,
                          }],
                        }]);
                        setExpandedPricingConfigs(prev => new Set([...prev, newId]));
                        // Auto-expand the first level
                        setExpandedLevels(prev => {
                          const next = new Map(prev);
                          next.set(newId, new Set([0]));
                          return next;
                        });
                      }}
                    >
                      Add Pricing Display
                    </s-button>
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

                {/* Collapse/Expand All Buttons */}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <s-button size="small" onClick={() => setCollapsedAnnouncementPanels({
                    additional_messages: true, utility_links: true, styling: true, link_styling: true, exclusions: true
                  })}>Collapse all</s-button>
                  <s-button size="small" onClick={() => setCollapsedAnnouncementPanels({
                    additional_messages: false, utility_links: false, styling: false, link_styling: false, exclusions: false
                  })}>Expand all</s-button>
                </div>

                {/* Additional Messages Section */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, overflow: "hidden" }}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedAnnouncementPanels.additional_messages}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      background: !collapsedAnnouncementPanels.additional_messages ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedAnnouncementPanels.additional_messages ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    onClick={() => toggleAnnouncementPanel('additional_messages')}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAnnouncementPanel('additional_messages'); } }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                          {collapsedAnnouncementPanels.additional_messages ? <ChevronRightIcon /> : <ChevronDownIcon />}
                        </span>
                        <s-text style={{ fontWeight: 600 }}>Additional Messages</s-text>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        <s-text size="small">{settings.fd_additional_messages_enabled ? "Enabled" : "Disabled"}</s-text>
                        <input
                          type="checkbox"
                          checked={settings.fd_additional_messages_enabled || false}
                          onChange={(e) => setSettings({ ...settings, fd_additional_messages_enabled: e.target.checked })}
                        />
                      </label>
                    </div>
                  </div>
                  {!collapsedAnnouncementPanels.additional_messages && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                  <div style={{ color: "var(--p-color-text-subdued, #6b7280)", fontSize: 12 }}>
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

                {/* Additional message 3 + timer */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 75px", gap: 16, alignItems: "start" }}>
                  <label style={{ display: "block" }}>
                    <s-text>Additional message 3</s-text>
                    <input
                      type="text"
                      value={settings.fd_announcement_additional3_message || ""}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_additional3_message: e.target.value })}
                      placeholder="Shop our bestsellers"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <s-text>Timer</s-text>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        min="0"
                        value={settings.fd_announcement_additional3_duration ?? 5}
                        onChange={(e) => setSettings({ ...settings, fd_announcement_additional3_duration: parseInt(e.target.value) || 0 })}
                        style={{ width: "100%" }}
                      />
                      <span style={{ fontSize: 12, color: "var(--p-color-text-subdued)" }}>s</span>
                    </div>
                  </label>
                </div>
                  </div>
                  )}
                </div>

                {/* Utility Links Section */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, overflow: "hidden" }}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedAnnouncementPanels.utility_links}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      background: !collapsedAnnouncementPanels.utility_links ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedAnnouncementPanels.utility_links ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    onClick={() => toggleAnnouncementPanel('utility_links')}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAnnouncementPanel('utility_links'); } }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                          {collapsedAnnouncementPanels.utility_links ? <ChevronRightIcon /> : <ChevronDownIcon />}
                        </span>
                        <s-text style={{ fontWeight: 600 }}>Utility Links</s-text>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        <s-text size="small">{settings.fd_utility_links_enabled ? "Enabled" : "Disabled"}</s-text>
                        <input
                          type="checkbox"
                          checked={settings.fd_utility_links_enabled || false}
                          onChange={(e) => setSettings({ ...settings, fd_utility_links_enabled: e.target.checked })}
                        />
                      </label>
                    </div>
                  </div>
                  {!collapsedAnnouncementPanels.utility_links && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--p-color-text-subdued)", marginTop: -8 }}>
                    Add quick-access links on the left and right of the announcement bar
                  </div>

                {/* Left Utility Link */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label>
                    <s-text>Left icon</s-text>
                    <select
                      value={settings.fd_utility_left_icon || ""}
                      onChange={(e) => setSettings({ ...settings, fd_utility_left_icon: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="">None</option>
                      <option value="phone">Phone</option>
                      <option value="envelope">Email</option>
                      <option value="package-box">Track order</option>
                      <option value="chat">Chat</option>
                      {getConfiguredUtilityIcons(settings).map(icon => (
                        <option key={icon.value} value={icon.value}>{icon.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <s-text>Left label</s-text>
                    <input
                      type="text"
                      value={settings.fd_utility_left_label || ""}
                      onChange={(e) => setSettings({ ...settings, fd_utility_left_label: e.target.value.slice(0, 30) })}
                      placeholder="e.g. Call us"
                      maxLength={30}
                      style={{ width: "100%" }}
                    />
                  </label>
                </div>
                <label>
                  <s-text>Left URL</s-text>
                  <input
                    type="text"
                    value={settings.fd_utility_left_url || ""}
                    onChange={(e) => setSettings({ ...settings, fd_utility_left_url: e.target.value })}
                    placeholder="/pages/contact, tel:, mailto:"
                    style={{ width: "100%" }}
                  />
                  {/^https?:\/\//i.test(settings.fd_utility_left_url || "") && (
                    <span style={{ fontSize: 11, color: "#dc2626", marginTop: 2, display: "block" }}>External links not allowed. Use /pages/... or tel:/mailto:</span>
                  )}
                </label>
                {/* Left Preview */}
                {(settings.fd_utility_left_icon || settings.fd_utility_left_label) && (() => {
                  const hasLink = !!settings.fd_utility_left_url;
                  const useCustom = settings.fd_use_custom_link_styling;
                  const baseColor = hasLink ? (useCustom ? (settings.fd_announcement_link_color || "#ffffff") : (settings.link_color || "#2563eb")) : (settings.fd_announcement_text_color || "#ffffff");
                  const baseDecoration = hasLink ? (useCustom ? (settings.fd_announcement_link_decoration || "underline") : (settings.link_decoration || "underline")) : "none";
                  const baseThickness = useCustom ? (settings.fd_announcement_link_thickness || "1px") : (settings.link_thickness || "1px");
                  const hoverColor = useCustom ? (settings.fd_announcement_link_hover_color || "#e5e7eb") : (settings.link_hover_color || "#1d4ed8");
                  const hoverDecoration = useCustom ? (settings.fd_announcement_link_hover_decoration || "underline") : (settings.link_hover_decoration || "underline");
                  const hoverThickness = useCustom ? (settings.fd_announcement_link_hover_thickness || "2px") : (settings.link_hover_thickness || "2px");
                  const hoverOpacity = useCustom ? (settings.fd_announcement_link_hover_opacity ?? 1) : (settings.link_hover_opacity ?? 1);
                  const isHover = leftUtilHover && hasLink;
                  return (
                  <div style={{
                    padding: `${({ compact: 6, standard: 10, comfortable: 14, spacious: 18 }[settings.fd_announcement_bar_height] || 14)}px 16px`,
                    background: settings.fd_announcement_bg_color || "#1f2937",
                    borderRadius: 6,
                    marginTop: 8
                  }}>
                    <div
                      onMouseEnter={() => setLeftUtilHover(true)}
                      onMouseLeave={() => setLeftUtilHover(false)}
                      style={{ display: "inline-flex", alignItems: "center", color: isHover ? hoverColor : baseColor, fontSize: settings.fd_announcement_text_size || 14, textDecoration: isHover ? hoverDecoration : baseDecoration, textDecorationThickness: isHover ? hoverThickness : baseThickness, textUnderlineOffset: "2px", opacity: isHover ? hoverOpacity : 1, cursor: hasLink ? "pointer" : "default", transition: "color 0.15s, opacity 0.15s" }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {settings.fd_utility_left_icon && <span style={{ width: settings.fd_announcement_text_size || 14, height: settings.fd_announcement_text_size || 14 }} dangerouslySetInnerHTML={{ __html: getUtilityIconSvg(settings.fd_utility_left_icon, settings) || getIconSvg(settings.fd_utility_left_icon) || '' }} />}
                        {settings.fd_utility_left_label && <span>{settings.fd_utility_left_label}</span>}
                      </span>
                    </div>
                  </div>
                  );
                })()}

                {/* Right Utility Link */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                  <label>
                    <s-text>Right icon</s-text>
                    <select
                      value={settings.fd_utility_right_icon || ""}
                      onChange={(e) => setSettings({ ...settings, fd_utility_right_icon: e.target.value })}
                      style={{ width: "100%" }}
                    >
                      <option value="">None</option>
                      <option value="phone">Phone</option>
                      <option value="envelope">Email</option>
                      <option value="package-box">Track order</option>
                      <option value="chat">Chat</option>
                      {getConfiguredUtilityIcons(settings).map(icon => (
                        <option key={icon.value} value={icon.value}>{icon.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <s-text>Right label</s-text>
                    <input
                      type="text"
                      value={settings.fd_utility_right_label || ""}
                      onChange={(e) => setSettings({ ...settings, fd_utility_right_label: e.target.value.slice(0, 30) })}
                      placeholder="e.g. Track"
                      maxLength={30}
                      style={{ width: "100%" }}
                    />
                  </label>
                </div>
                <label>
                  <s-text>Right URL</s-text>
                  <input
                    type="text"
                    value={settings.fd_utility_right_url || ""}
                    onChange={(e) => setSettings({ ...settings, fd_utility_right_url: e.target.value })}
                    placeholder="/pages/tracking, tel:, mailto:"
                    style={{ width: "100%" }}
                  />
                  {/^https?:\/\//i.test(settings.fd_utility_right_url || "") && (
                    <span style={{ fontSize: 11, color: "#dc2626", marginTop: 2, display: "block" }}>External links not allowed. Use /pages/... or tel:/mailto:</span>
                  )}
                </label>
                {/* Right Preview */}
                {(settings.fd_utility_right_icon || settings.fd_utility_right_label) && (() => {
                  const hasLink = !!settings.fd_utility_right_url;
                  const useCustom = settings.fd_use_custom_link_styling;
                  const baseColor = hasLink ? (useCustom ? (settings.fd_announcement_link_color || "#ffffff") : (settings.link_color || "#2563eb")) : (settings.fd_announcement_text_color || "#ffffff");
                  const baseDecoration = hasLink ? (useCustom ? (settings.fd_announcement_link_decoration || "underline") : (settings.link_decoration || "underline")) : "none";
                  const baseThickness = useCustom ? (settings.fd_announcement_link_thickness || "1px") : (settings.link_thickness || "1px");
                  const hoverColor = useCustom ? (settings.fd_announcement_link_hover_color || "#e5e7eb") : (settings.link_hover_color || "#1d4ed8");
                  const hoverDecoration = useCustom ? (settings.fd_announcement_link_hover_decoration || "underline") : (settings.link_hover_decoration || "underline");
                  const hoverThickness = useCustom ? (settings.fd_announcement_link_hover_thickness || "2px") : (settings.link_hover_thickness || "2px");
                  const hoverOpacity = useCustom ? (settings.fd_announcement_link_hover_opacity ?? 1) : (settings.link_hover_opacity ?? 1);
                  const isHover = rightUtilHover && hasLink;
                  return (
                  <div style={{
                    padding: `${({ compact: 6, standard: 10, comfortable: 14, spacious: 18 }[settings.fd_announcement_bar_height] || 14)}px 16px`,
                    background: settings.fd_announcement_bg_color || "#1f2937",
                    borderRadius: 6,
                    marginTop: 8
                  }}>
                    <div
                      onMouseEnter={() => setRightUtilHover(true)}
                      onMouseLeave={() => setRightUtilHover(false)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: isHover ? hoverColor : baseColor, fontSize: settings.fd_announcement_text_size || 14, textDecoration: isHover ? hoverDecoration : baseDecoration, textDecorationThickness: isHover ? hoverThickness : baseThickness, textUnderlineOffset: "2px", opacity: isHover ? hoverOpacity : 1, cursor: hasLink ? "pointer" : "default", transition: "color 0.15s, opacity 0.15s" }}>
                        {settings.fd_utility_right_icon && <span style={{ width: settings.fd_announcement_text_size || 14, height: settings.fd_announcement_text_size || 14 }} dangerouslySetInnerHTML={{ __html: getUtilityIconSvg(settings.fd_utility_right_icon, settings) || getIconSvg(settings.fd_utility_right_icon) || '' }} />}
                        {settings.fd_utility_right_label && <span>{settings.fd_utility_right_label}</span>}
                      </span>
                    </div>
                  </div>
                  );
                })()}

                {/* Mobile Mode */}
                <label style={{ marginTop: 8 }}>
                  <s-text>Mobile behavior</s-text>
                  <select
                    value={settings.fd_utility_mobile_mode || "hide"}
                    onChange={(e) => setSettings({ ...settings, fd_utility_mobile_mode: e.target.value })}
                    style={{ width: "100%" }}
                  >
                    <option value="hide">Hide utility links</option>
                    <option value="icons">Show icons only</option>
                    <option value="icons_left">Both icons left</option>
                    <option value="icons_right">Both icons right</option>
                  </select>
                </label>
                  </div>
                  )}
                </div>

                {/* Styling Section */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, overflow: "hidden" }}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedAnnouncementPanels.styling}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      background: !collapsedAnnouncementPanels.styling ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedAnnouncementPanels.styling ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    onClick={() => toggleAnnouncementPanel('styling')}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAnnouncementPanel('styling'); } }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                        {collapsedAnnouncementPanels.styling ? <ChevronRightIcon /> : <ChevronDownIcon />}
                      </span>
                      <s-text style={{ fontWeight: 600 }}>Styling</s-text>
                    </div>
                  </div>
                  {!collapsedAnnouncementPanels.styling && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>

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
                    <s-text>Text size ({settings.fd_announcement_text_size || 14}px)</s-text>
                    <input
                      type="range"
                      min="12"
                      max="18"
                      step="1"
                      value={settings.fd_announcement_text_size || 14}
                      onChange={(e) => setSettings({ ...settings, fd_announcement_text_size: parseInt(e.target.value) })}
                      style={{ width: "100%" }}
                    />
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

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <s-text size="small">Chevron max-width ({settings.fd_announcement_content_max_width || 800}px)</s-text>
                    <span
                      title="Sets max width for the chevron/message area on desktop. Scales proportionally as screen shrinks."
                      style={{ cursor: "help", fontSize: 12, color: "var(--p-color-text-subdued)" }}
                    >ℹ️</span>
                  </div>
                  <input
                    type="range"
                    min="500"
                    max="800"
                    step="50"
                    value={settings.fd_announcement_content_max_width || 800}
                    onChange={(e) => setSettings({ ...settings, fd_announcement_content_max_width: parseInt(e.target.value) })}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <s-text size="small">Mobile chevron max-width ({settings.fd_announcement_content_max_width_mobile || 90}%)</s-text>
                    <span
                      title="Chevron/message width on mobile (under 768px). Increase if message wraps to two lines."
                      style={{ cursor: "help", fontSize: 12, color: "var(--p-color-text-subdued)" }}
                    >ℹ️</span>
                  </div>
                  <input
                    type="range"
                    min="60"
                    max="100"
                    step="5"
                    value={settings.fd_announcement_content_max_width_mobile || 90}
                    onChange={(e) => setSettings({ ...settings, fd_announcement_content_max_width_mobile: parseInt(e.target.value) })}
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--p-color-text-subdued, #6b7280)", marginTop: 4 }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>💡</span>
                    <span style={{ fontSize: 12 }}>When using mobile icons, keep below 90% to avoid overlap</span>
                  </div>
                </div>
                  </div>
                  )}
                </div>

                {/* Link Styling */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, overflow: "hidden" }}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedAnnouncementPanels.link_styling}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      background: !collapsedAnnouncementPanels.link_styling ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedAnnouncementPanels.link_styling ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    onClick={() => toggleAnnouncementPanel('link_styling')}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAnnouncementPanel('link_styling'); } }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                        {collapsedAnnouncementPanels.link_styling ? <ChevronRightIcon /> : <ChevronDownIcon />}
                      </span>
                      <s-text style={{ fontWeight: 600 }}>Link Styling</s-text>
                    </div>
                  </div>
                  {!collapsedAnnouncementPanels.link_styling && (
                  <div style={{ padding: "16px", display: "grid", gap: 12 }}>
                  <s-text size="small" style={{ color: "var(--p-color-text-subdued, #6b7280)" }}>
                    Style links created from [text](url) markdown.
                  </s-text>

                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={settings.fd_use_custom_link_styling || false}
                      onChange={(e) => setSettings({ ...settings, fd_use_custom_link_styling: e.target.checked })}
                    />
                    <s-text size="small">Use custom link styling</s-text>
                  </label>

                  {settings.fd_use_custom_link_styling && (
                    <>
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
                    </>
                  )}
                  </div>
                  )}
                </div>

                {/* Exclusions Section */}
                <div style={{ border: "1px solid var(--p-color-border, #e5e7eb)", borderRadius: 8, overflow: "hidden" }}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedAnnouncementPanels.exclusions}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      background: !collapsedAnnouncementPanels.exclusions ? "var(--p-color-bg-surface-hover, #f8fafc)" : "var(--p-color-bg-surface, #ffffff)",
                      borderBottom: !collapsedAnnouncementPanels.exclusions ? "1px solid var(--p-color-border, #e5e7eb)" : "none",
                      cursor: "pointer",
                      outline: "none",
                    }}
                    onClick={() => toggleAnnouncementPanel('exclusions')}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAnnouncementPanel('exclusions'); } }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--p-color-text-subdued, #6b7280)" }} aria-hidden="true">
                        {collapsedAnnouncementPanels.exclusions ? <ChevronRightIcon /> : <ChevronDownIcon />}
                      </span>
                      <s-text style={{ fontWeight: 600 }}>Exclusions</s-text>
                    </div>
                  </div>
                  {!collapsedAnnouncementPanels.exclusions && (
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
                  )}
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
