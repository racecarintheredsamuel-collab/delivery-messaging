import { useState, useEffect, useRef } from "react";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { HELP_SECTIONS } from "../data/helpSections";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

// ============================================================================
// HELP SECTION COMPONENT
// ============================================================================

function HelpSection({ section, expandedIds, onToggle, onImageClick, onExpandAndScroll }) {
  const isExpanded = expandedIds.has(section.id);

  return (
    <div id={section.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
      {/* Header */}
      <div
        onClick={() => onToggle(section.id)}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "16px",
          cursor: "pointer",
          background: isExpanded ? "#f9fafb" : "transparent",
          transition: "background 0.15s ease",
        }}
      >
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 500, color: "#111827" }}>
            {section.title}
          </span>
        </div>
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

      {/* Content */}
      {isExpanded && (
        <div style={{ padding: "0 24px 20px 24px", display: "grid", gap: 16 }}>
          {section.children.map((child, idx) => (
            <div key={child.id} id={child.id} style={idx < section.children.length - 1 ? { paddingBottom: 16, borderBottom: "1px solid #e5e7eb" } : undefined}>
              {!(child.image || child.images) && (
                <h3 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  {child.title}
                </h3>
              )}
              {(child.image || child.images) ? (
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 8 }}>
                  <div style={{ width: "50%", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
                    {(child.images || [child.image]).map((src, imgIdx) => (
                      <img
                        key={imgIdx}
                        src={src}
                        alt={`${child.title}${child.images ? ` ${imgIdx + 1}` : ""}`}
                        onClick={() => onImageClick?.(src)}
                        style={{ width: "100%", borderRadius: 8, border: "1px solid #e5e7eb", cursor: "zoom-in" }}
                      />
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 600, color: "#374151" }}>
                      {child.title}
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-line" }}>
                      {child.content}
                    </p>
                    {child.link && (
                      <a href={`#${child.link.anchor}`} onClick={(e) => { e.preventDefault(); onExpandAndScroll(child.link.anchor); }} style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "#2563eb", textDecoration: "none" }}>
                        → {child.link.label}
                      </a>
                    )}
                    {(child.resultImage || child.resultImages) && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, marginTop: 12 }}>
                        {(child.resultImages || [child.resultImage]).map((src, rIdx) => (
                          <img
                            key={rIdx}
                            src={src}
                            alt={`${child.title} result${child.resultImages ? ` ${rIdx + 1}` : ""}`}
                            onClick={() => onImageClick?.(src)}
                            style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid #e5e7eb", cursor: "zoom-in" }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-line" }}>
                    {child.content}
                  </p>
                  {child.link && (
                    <a href={`#${child.link.anchor}`} onClick={(e) => { e.preventDefault(); onExpandAndScroll(child.link.anchor); }} style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "#2563eb", textDecoration: "none" }}>
                      → {child.link.label}
                    </a>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HELP PAGE
// ============================================================================

export default function HelpPage() {
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [lightboxImage, setLightboxImage] = useState(null);
  const hasScrolled = useRef(false);

  // Handle anchor deep-linking
  useEffect(() => {
    if (hasScrolled.current) return;
    const hash = window.location.hash?.slice(1);
    if (!hash) return;

    // Find which top-level section contains this anchor
    for (const section of HELP_SECTIONS) {
      if (section.id === hash || section.children.some((c) => c.id === hash)) {
        setExpandedIds(new Set([section.id]));
        // Scroll after render
        setTimeout(() => {
          const el = document.getElementById(hash);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
        hasScrolled.current = true;
        return;
      }
    }
  }, []);

  const expandAndScroll = (anchor) => {
    // Find the parent section for this anchor and expand it
    for (const section of HELP_SECTIONS) {
      if (section.id === anchor || section.children.some((c) => c.id === anchor)) {
        setExpandedIds((prev) => new Set([...prev, section.id]));
        setTimeout(() => {
          const el = document.getElementById(anchor);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
        return;
      }
    }
  };

  const toggleSection = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedIds(new Set(HELP_SECTIONS.map((s) => s.id)));
  const collapseAll = () => setExpandedIds(new Set());

  return (
    <s-page heading="Help">
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
          <div style={{ padding: "20px 20px 16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#111827" }}>Help</h2>
              <p style={{ margin: "4px 0 0 0", fontSize: 14, color: "#6b7280" }}>
                Learn how to configure your delivery messaging app
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                onClick={expandAll}
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "white",
                  cursor: "pointer",
                  color: "#111827",
                }}
              >
                Expand all
              </button>
              <button
                onClick={collapseAll}
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "white",
                  cursor: "pointer",
                  color: "#111827",
                }}
              >
                Collapse all
              </button>
            </div>
          </div>

          {/* Sections */}
          <div style={{ borderTop: "1px solid #e5e7eb" }}>
            {HELP_SECTIONS.map((section) => (
              <HelpSection
                key={section.id}
                section={section}
                expandedIds={expandedIds}
                onToggle={toggleSection}
                onImageClick={setLightboxImage}
                onExpandAndScroll={expandAndScroll}
              />
            ))}
          </div>
        </div>
      </s-section>

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
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
