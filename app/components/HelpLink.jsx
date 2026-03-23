import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { HELP_SECTIONS } from "../data/helpSections";

function findSection(anchor) {
  for (const section of HELP_SECTIONS) {
    if (section.id === anchor) return section;
    const child = section.children.find((c) => c.id === anchor);
    if (child) return section;
  }
  return null;
}

export function HelpLink({ anchor }) {
  const [open, setOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const navigate = useNavigate();

  const close = useCallback(() => {
    setOpen(false);
    setLightboxImage(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (lightboxImage) setLightboxImage(null);
        else close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, lightboxImage, close]);

  const section = open ? findSection(anchor) : null;

  return (
    <>
      <span
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title="Help"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: "50%",
          fontSize: 10,
          fontWeight: 700,
          background: "var(--p-color-bg-surface-hover, #f1f5f9)",
          color: "var(--p-color-text-subdued, #6b7280)",
          textDecoration: "none",
          flexShrink: 0,
          cursor: "pointer",
        }}
      >
        ?
      </span>

      {open && section && (
        <div
          onClick={close}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              maxWidth: 960,
              width: "100%",
              maxHeight: "80vh",
              overflow: "auto",
              boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, background: "white", zIndex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#111827" }}>
                {section.title}
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  onClick={() => { close(); navigate(`/app/help#${anchor}`); }}
                  style={{ fontSize: 13, color: "#2563eb", cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap" }}
                >
                  View full help page
                </span>
                <span
                  onClick={close}
                  style={{ fontSize: 18, color: "#9ca3af", cursor: "pointer", lineHeight: 1 }}
                >
                  ✕
                </span>
              </div>
            </div>

            {/* Content */}
            <div style={{ padding: "16px 20px 20px 20px", display: "grid", gap: 16 }}>
              {section.children.map((child, idx) => (
                <div key={child.id} style={idx < section.children.length - 1 ? { paddingBottom: 16, borderBottom: "1px solid #e5e7eb" } : undefined}>
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
                            onClick={() => setLightboxImage(src)}
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
                          <span onClick={() => { close(); navigate(`/app/help#${child.link.anchor}`); }} style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "#2563eb", cursor: "pointer" }}>
                            → {child.link.label}
                          </span>
                        )}
                        {(child.resultImage || child.resultImages) && (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, marginTop: 12 }}>
                            {(child.resultImages || [child.resultImage]).map((src, rIdx) => (
                              <img
                                key={rIdx}
                                src={src}
                                alt={`${child.title} result${child.resultImages ? ` ${rIdx + 1}` : ""}`}
                                onClick={() => setLightboxImage(src)}
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
                        <span onClick={() => { close(); navigate(`/app/help#${child.link.anchor}`); }} style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "#2563eb", cursor: "pointer" }}>
                          → {child.link.label}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
            zIndex: 1002,
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
    </>
  );
}
