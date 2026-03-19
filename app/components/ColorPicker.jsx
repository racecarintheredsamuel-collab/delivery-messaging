import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker, HexColorInput } from "react-colorful";

export function ColorPicker({ color, onChange, compact = false, fallbackColor = null, fallbackLabel = null, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState({});
  const popoverRef = useRef(null);
  const containerRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        containerRef.current &&
        !containerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle opening and calculate position
  const handleOpen = () => {
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const popoverHeight = 220;
      const openUpward = spaceBelow < popoverHeight;

      setPopoverStyle({
        position: "fixed",
        left: rect.left,
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        zIndex: 99999,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        padding: 12,
      });
    }
    setIsOpen(!isOpen);
  };

  // Uppercase handler
  const handleChange = (newColor) => {
    onChange(newColor.toUpperCase());
  };

  return (
    <div style={{ position: "relative", minWidth: 0, width: compact ? 110 : 175 }}>
      {/* Input container with swatch inside */}
      <div
        ref={containerRef}
        style={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          maxWidth: "100%",
          border: "1px solid #888888",
          borderRadius: 7,
          padding: "5px 8px 5px 5px",
          gap: 8,
          background: disabled ? "#f3f4f6" : "#fff",
          opacity: disabled ? 0.5 : 1,
          pointerEvents: disabled ? "none" : "auto",
        }}
      >
        <button
          type="button"
          onClick={disabled ? undefined : handleOpen}
          disabled={disabled}
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            border: "none",
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)",
            backgroundColor: color || fallbackColor || "transparent",
            backgroundImage: !color && !fallbackColor ? "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)" : "none",
            backgroundSize: "8px 8px",
            backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
            cursor: disabled ? "not-allowed" : "pointer",
            flexShrink: 0,
            padding: 0,
          }}
        />
        {color ? (
          <HexColorInput
            color={color}
            onChange={handleChange}
            prefixed
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 13,
              fontFamily: "inherit",
              padding: 0,
              minWidth: 0,
              textTransform: "uppercase",
            }}
          />
        ) : (
          <span
            onClick={handleOpen}
            style={{
              flex: 1,
              fontSize: 13,
              fontFamily: "inherit",
              color: "#6b7280",
              cursor: "pointer",
            }}
          >
            {fallbackLabel || "Transparent"}
          </span>
        )}
      </div>

      {/* Popover with picker - rendered via portal to body */}
      {isOpen &&
        createPortal(
          <div ref={popoverRef} style={popoverStyle}>
            <HexColorPicker color={color} onChange={handleChange} />
          </div>,
          document.body
        )}
    </div>
  );
}
