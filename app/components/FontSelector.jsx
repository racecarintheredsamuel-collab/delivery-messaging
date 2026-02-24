// ============================================================================
// FONT SELECTOR COMPONENT
// A searchable dropdown for selecting Google Fonts with category sections
// ============================================================================

import { useState, useEffect, useRef, useMemo } from "react";
import googleFonts from "../data/googleFonts.json";

// Category display order and labels
const CATEGORY_ORDER = [
  { key: "popular", label: "Popular" },
  { key: "sans-serif", label: "Sans Serif" },
  { key: "serif", label: "Serif" },
  { key: "display", label: "Display" },
  { key: "handwriting", label: "Handwriting" },
  { key: "monospace", label: "Monospace" },
];

export function FontSelector({ value, onChange, placeholder = "Search fonts...", label }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Toggle category expansion (accordion - only one open at a time)
  const toggleCategory = (catKey, e) => {
    e.stopPropagation();
    const isCurrentlyOpen = expandedCategories.has(catKey);
    const headerEl = e.currentTarget;
    setExpandedCategories(prev => {
      // If already open, close it. Otherwise, open only this one.
      return prev.has(catKey) ? new Set() : new Set([catKey]);
    });
    // If opening (not closing), scroll header to top of dropdown
    if (!isCurrentlyOpen && listRef.current && headerEl) {
      setTimeout(() => {
        // Scroll within the dropdown container, not the page
        listRef.current.scrollTop = headerEl.offsetTop;
      }, 0);
    }
  };

  // Organize fonts by category
  const fontsByCategory = useMemo(() => {
    const result = {
      popular: googleFonts.filter(f => f.popular),
      "sans-serif": googleFonts.filter(f => !f.popular && f.category === "sans-serif"),
      serif: googleFonts.filter(f => !f.popular && f.category === "serif"),
      display: googleFonts.filter(f => !f.popular && f.category === "display"),
      handwriting: googleFonts.filter(f => !f.popular && f.category === "handwriting"),
      monospace: googleFonts.filter(f => !f.popular && f.category === "monospace"),
    };
    return result;
  }, []);

  // Filter fonts based on search query - flat list when searching
  const filteredFonts = useMemo(() => {
    if (!searchQuery) return null; // null = show categories
    return googleFonts
      .filter(font => font.family.toLowerCase().includes(searchQuery.toLowerCase()))
      .slice(0, 50);
  }, [searchQuery]);

  // Build flat list for keyboard navigation (only expanded categories when not searching)
  const flatList = useMemo(() => {
    if (filteredFonts) return filteredFonts;
    // When showing categories, only include fonts from expanded categories
    const list = [];
    CATEGORY_ORDER.forEach(cat => {
      if (expandedCategories.has(cat.key)) {
        const fonts = fontsByCategory[cat.key] || [];
        list.push(...fonts);
      }
    });
    return list;
  }, [filteredFonts, fontsByCategory, expandedCategories]);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Reset focused index when filtered results change
  useEffect(() => {
    setFocusedIndex(0);
  }, [searchQuery]);

  // Scroll focused item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const focusedEl = listRef.current.querySelector(`[data-index="${focusedIndex}"]`);
      if (focusedEl) {
        focusedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [focusedIndex, isOpen]);

  const handleSelect = (fontFamily) => {
    onChange(fontFamily);
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    const totalItems = flatList.length;

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery("");
        break;
      case "ArrowDown":
        e.preventDefault();
        if (totalItems > 0) {
          setFocusedIndex((i) => (i + 1) % totalItems);
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (totalItems > 0) {
          setFocusedIndex((i) => (i - 1 + totalItems) % totalItems);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (focusedIndex < flatList.length && flatList.length > 0) {
          handleSelect(flatList[focusedIndex].family);
        } else {
          // No match selected - just close without changing
          setIsOpen(false);
          setSearchQuery("");
        }
        break;
      default:
        break;
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange("");
    setSearchQuery("");
  };

  // Render a single font item
  const renderFontItem = (font, globalIndex) => (
    <div
      key={font.family}
      data-index={globalIndex}
      role="option"
      aria-selected={font.family === value}
      onClick={() => handleSelect(font.family)}
      style={{
        padding: "8px 12px",
        cursor: "pointer",
        background: focusedIndex === globalIndex ? "var(--p-color-bg-surface-hover, #f3f4f6)" : "transparent",
        borderLeft: font.family === value ? "3px solid var(--p-color-bg-fill-brand, #2563eb)" : "3px solid transparent",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
      onMouseEnter={() => setFocusedIndex(globalIndex)}
    >
      <span style={{ fontSize: "13px" }}>{font.family}</span>
      {filteredFonts && (
        <span style={{ fontSize: "10px", color: "var(--p-color-text-subdued, #9ca3af)" }}>
          {font.category}
        </span>
      )}
    </div>
  );

  // Render category section with collapsible header
  const renderCategorySection = (catKey, catLabel, fonts, startIndex) => {
    if (fonts.length === 0) return null;
    const isExpanded = expandedCategories.has(catKey);
    return (
      <div key={catKey}>
        <div
          onClick={(e) => toggleCategory(catKey, e)}
          style={{
            padding: "10px 12px",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--p-color-text-subdued, #6b7280)",
            background: "var(--p-color-bg-surface-secondary, #f9fafb)",
            borderBottom: "1px solid var(--p-color-border, #e5e7eb)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            userSelect: "none",
          }}
        >
          <span>{catLabel} ({fonts.length})</span>
          <span style={{ fontSize: "10px", color: "var(--p-color-text-subdued, #9ca3af)" }}>
            {isExpanded ? "▼" : "▶"}
          </span>
        </div>
        {isExpanded && fonts.map((font, idx) => renderFontItem(font, startIndex + idx))}
      </div>
    );
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {label && (
        <div style={{ marginBottom: 4, fontSize: "12px", color: "var(--p-color-text-subdued, #6b7280)" }}>
          {label}
        </div>
      )}

      {/* Input display */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: "1px solid var(--p-color-border, #d1d5db)",
          borderRadius: "6px",
          background: "var(--p-color-bg-surface, #ffffff)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? searchQuery : value || ""}
          onChange={(e) => {
            if (!isOpen) setIsOpen(true);
            setSearchQuery(e.target.value);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value || placeholder}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "none",
            outline: "none",
            fontSize: "14px",
            fontFamily: value ? `"${value}", sans-serif` : "inherit",
            background: "transparent",
          }}
          aria-label={label || placeholder}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? "font-selector-list" : undefined}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            style={{
              padding: "8px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--p-color-text-subdued, #6b7280)",
              fontSize: "16px",
              lineHeight: 1,
            }}
            aria-label="Clear selection"
          >
            ×
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          id="font-selector-list"
          role="listbox"
          ref={listRef}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "var(--p-color-bg-surface, #ffffff)",
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            boxShadow: "var(--p-shadow-300, 0 4px 6px -1px rgba(0,0,0,0.1))",
            zIndex: 100,
            maxHeight: "300px",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {/* Font list - either flat (when searching) or categorized */}
          {filteredFonts ? (
            // Flat search results
            filteredFonts.length === 0 ? (
              <div style={{ padding: "12px", color: "var(--p-color-text-subdued, #6b7280)", fontSize: "13px" }}>
                No fonts found matching "{searchQuery}"
              </div>
            ) : (
              filteredFonts.map((font, index) => renderFontItem(font, index))
            )
          ) : (
            // Categorized view (collapsed by default)
            (() => {
              let globalIndex = 0;
              return CATEGORY_ORDER.map(cat => {
                const fonts = fontsByCategory[cat.key] || [];
                const startIndex = globalIndex;
                // Only increment index for expanded categories
                if (expandedCategories.has(cat.key)) {
                  globalIndex += fonts.length;
                }
                return renderCategorySection(cat.key, cat.label, fonts, startIndex);
              });
            })()
          )}

          {/* Google Fonts link */}
          <a
            href="https://fonts.google.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              padding: "10px 12px",
              borderTop: "1px solid var(--p-color-border, #e5e7eb)",
              color: "var(--p-color-text-link, #2563eb)",
              fontSize: "12px",
              textDecoration: "none",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            Browse all fonts on Google Fonts →
          </a>
        </div>
      )}
    </div>
  );
}
