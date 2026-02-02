// ============================================================================
// CUSTOM DATE PICKER COMPONENT
// A reusable calendar-based date picker with click-outside-to-close behavior
// ============================================================================

import { useState, useEffect, useRef } from "react";

/**
 * Safely parse a YYYY-MM-DD date string with validation
 * @param {string} dateStr - Date string to parse
 * @returns {{ year: number, month: number, day: number } | null} - Parsed parts or null if invalid
 */
function parseDateString(dateStr) {
  if (typeof dateStr !== "string" || !dateStr) return null;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return { year, month: month - 1, day }; // month is 0-indexed
}

export function CustomDatePicker({ value, onChange, placeholder = "Select date" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedDay, setFocusedDay] = useState(null);
  const [viewDate, setViewDate] = useState(() => {
    const parsed = parseDateString(value);
    if (parsed) {
      return { year: parsed.year, month: parsed.month };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const calendarRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Focus management: set initial focused day when calendar opens
  useEffect(() => {
    if (isOpen) {
      const parsed = parseDateString(value);
      if (parsed && parsed.month === viewDate.month && parsed.year === viewDate.year) {
        setFocusedDay(parsed.day);
      } else {
        setFocusedDay(1);
      }
    } else {
      setFocusedDay(null);
    }
  }, [isOpen, value, viewDate.month, viewDate.year]);

  // Focus the focused day button when focusedDay changes
  useEffect(() => {
    if (isOpen && focusedDay && calendarRef.current) {
      const btn = calendarRef.current.querySelector(`[data-day="${focusedDay}"]`);
      if (btn) btn.focus();
    }
  }, [isOpen, focusedDay]);

  // Keyboard navigation for calendar
  const handleCalendarKeyDown = (e) => {
    const daysInCurrentMonth = getDaysInMonth(viewDate.year, viewDate.month);

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        inputRef.current?.focus();
        break;
      case "ArrowLeft":
        e.preventDefault();
        setFocusedDay((d) => (d > 1 ? d - 1 : d));
        break;
      case "ArrowRight":
        e.preventDefault();
        setFocusedDay((d) => (d < daysInCurrentMonth ? d + 1 : d));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedDay((d) => (d > 7 ? d - 7 : d));
        break;
      case "ArrowDown":
        e.preventDefault();
        setFocusedDay((d) => (d + 7 <= daysInCurrentMonth ? d + 7 : d));
        break;
      case "Enter":
      case " ":
        if (focusedDay) {
          e.preventDefault();
          handleDateSelect(focusedDay);
          inputRef.current?.focus();
        }
        break;
      default:
        break;
    }
  };

  // Handle input keyboard events
  const handleInputKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen(!isOpen);
    } else if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const handleDateSelect = (day) => {
    const y = viewDate.year;
    const m = String(viewDate.month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    onChange(`${y}-${m}-${d}`);
    setIsOpen(false);
  };

  const prevMonth = () => {
    setViewDate((v) => {
      if (v.month === 0) return { year: v.year - 1, month: 11 };
      return { ...v, month: v.month - 1 };
    });
  };

  const nextMonth = () => {
    setViewDate((v) => {
      if (v.month === 11) return { year: v.year + 1, month: 0 };
      return { ...v, month: v.month + 1 };
    });
  };

  const daysInMonth = getDaysInMonth(viewDate.year, viewDate.month);
  const firstDay = getFirstDayOfMonth(viewDate.year, viewDate.month);

  // Build calendar grid
  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarDays.push(d);
  }

  const displayValue = value
    ? new Date(value + "T00:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  const parsedValue = parseDateString(value);
  const selectedDay = parsedValue?.day ?? null;
  const selectedMonth = parsedValue?.month ?? null;
  const selectedYear = parsedValue?.year ?? null;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Input display - uses same native input as other fields */}
      <input
        ref={inputRef}
        type="text"
        readOnly
        role="combobox"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleInputKeyDown}
        value={displayValue}
        placeholder={placeholder}
        style={{ width: "100%", cursor: "pointer" }}
        aria-label={placeholder}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? "date-picker-calendar" : undefined}
      />

      {/* Calendar dropdown - opens upward (intentional - limited space below) */}
      {isOpen && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          id="date-picker-calendar"
          ref={calendarRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Choose date, ${monthNames[viewDate.month]} ${viewDate.year}`}
          tabIndex={-1}
          onKeyDown={handleCalendarKeyDown}
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: 4,
            background: "var(--p-color-bg-surface, #ffffff)",
            border: "1px solid var(--p-color-border, #e5e7eb)",
            borderRadius: "8px",
            boxShadow: "var(--p-shadow-300, 0 4px 6px -1px rgba(0,0,0,0.1))",
            zIndex: 100,
            padding: "12px",
            width: "280px",
          }}
        >
          {/* Month/Year header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <button
              onClick={prevMonth}
              aria-label="Previous month"
              type="button"
              style={{
                background: "none",
                border: "1px solid var(--p-color-border, #e5e7eb)",
                borderRadius: "4px",
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              ‹
            </button>
            <span style={{ fontWeight: 600, fontSize: "14px" }}>
              {monthNames[viewDate.month]} {viewDate.year}
            </span>
            <button
              onClick={nextMonth}
              aria-label="Next month"
              type="button"
              style={{
                background: "none",
                border: "1px solid var(--p-color-border, #e5e7eb)",
                borderRadius: "4px",
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              ›
            </button>
          </div>

          {/* Day names */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 2,
              marginBottom: 4,
            }}
          >
            {dayNames.map((day) => (
              <div
                key={day}
                style={{
                  textAlign: "center",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--p-color-text-subdued, #6b7280)",
                  padding: "4px 0",
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div
            role="grid"
            aria-label="Calendar"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 2,
              minHeight: 238, // Fixed height for 6 rows to prevent calendar size jumping
            }}
          >
            {calendarDays.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} role="gridcell" style={{ padding: "8px" }} />;
              }

              const isSelected =
                day === selectedDay &&
                viewDate.month === selectedMonth &&
                viewDate.year === selectedYear;

              const today = new Date();
              const isToday =
                day === today.getDate() &&
                viewDate.month === today.getMonth() &&
                viewDate.year === today.getFullYear();

              const fullDate = new Date(viewDate.year, viewDate.month, day);
              const dateLabel = fullDate.toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              });

              return (
                <button
                  key={day}
                  data-day={day}
                  role="gridcell"
                  aria-label={dateLabel}
                  aria-selected={isSelected}
                  tabIndex={focusedDay === day ? 0 : -1}
                  type="button"
                  onClick={() => handleDateSelect(day)}
                  style={{
                    padding: "8px",
                    border: isToday ? "1px solid var(--p-color-border-emphasis, #3b82f6)" : "1px solid transparent",
                    borderRadius: "4px",
                    background: isSelected ? "var(--p-color-bg-fill-brand, #2563eb)" : "transparent",
                    color: isSelected ? "var(--p-color-text-inverse, #ffffff)" : "var(--p-color-text, #374151)",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: isSelected || isToday ? 600 : 400,
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Clear button */}
          {value && (
            <div style={{ marginTop: 8, borderTop: "1px solid var(--p-color-border, #e5e7eb)", paddingTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setIsOpen(false);
                  inputRef.current?.focus();
                }}
                style={{
                  width: "100%",
                  padding: "6px",
                  background: "none",
                  border: "1px solid var(--p-color-border, #e5e7eb)",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "12px",
                  color: "var(--p-color-text-subdued, #6b7280)",
                }}
              >
                Clear date
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
