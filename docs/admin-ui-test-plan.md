# Admin UI Test Plan

## Test Environment
- **Dev server**: `npm run dev` or `shopify app dev`
- **Browser DevTools**: Network tab for save operations, Console for errors
- **Multiple browser tabs**: For testing concurrent edits

---

## 1. Rule Management

### 1.1 Rule Creation

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| RC-001 | Add first rule | Click "Add rule" when no rules exist | New rule created with default name "Rule 1" |
| RC-002 | Add subsequent rule | Click "Add rule" with existing rules | New rule added, auto-named "Rule 2", "Rule 3", etc. |
| RC-003 | Rule appears in list | Add rule | Rule visible in right panel list |
| RC-004 | Rule auto-selected | Add rule | New rule automatically selected for editing |
| RC-005 | Default values | Add rule | All settings have sensible defaults |

### 1.2 Rule Editing

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| RE-001 | Rename rule | Edit rule name input | Name updates in list immediately |
| RE-002 | Name character limit | Enter 23+ characters | Truncated at 22 characters |
| RE-003 | Edit product handle | Enter handle in Product Matching | Value saved |
| RE-004 | Edit product tags | Enter tags | Values saved, comma-separated |
| RE-005 | Toggle show_messages | Click toggle | Value persists after save |
| RE-006 | Edit message text | Type in message field | Text saved with formatting |
| RE-007 | Switch between rules | Click different rule in list | Editor loads selected rule's data |
| RE-008 | Unsaved indicator | Make changes | Auto-save triggers after 2s |

### 1.3 Rule Deletion

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| RD-001 | Delete rule | Click delete on rule | Confirmation prompt appears |
| RD-002 | Confirm delete | Click confirm | Rule removed from list |
| RD-003 | Cancel delete | Click cancel | Rule remains |
| RD-004 | Delete last rule | Delete only remaining rule | Empty state shown |
| RD-005 | Delete selected rule | Delete currently editing rule | Next rule auto-selected (or empty state) |

### 1.4 Rule Copy

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| CP-001 | Copy rule | Select rule, click "Copy rule" | New rule created with "[name] (copy)" |
| CP-002 | Copy preserves settings | Copy rule with custom settings | All settings duplicated |
| CP-003 | Copy unique ID | Copy rule | New rule has different ID |

---

## 2. Drag-and-Drop Reordering

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| DD-001 | Drag rule up | Drag rule 3 above rule 1 | Order updates: 3, 1, 2 |
| DD-002 | Drag rule down | Drag rule 1 below rule 3 | Order updates: 2, 3, 1 |
| DD-003 | Visual feedback | Start dragging | Drag handle visible, item lifted |
| DD-004 | Drop indicator | Drag over list | Drop position indicator shown |
| DD-005 | Cancel drag | Press Escape while dragging | Order unchanged |
| DD-006 | Order persists | Reorder, save, refresh | Order maintained |
| DD-007 | Priority correct | Reorder rules | First rule = highest priority |

---

## 3. Settings Save/Load

### 3.1 Auto-Save

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| AS-001 | Auto-save triggers | Make change, wait 2s | Save icon turns green briefly |
| AS-002 | Debounce works | Make rapid changes | Only one save after 2s idle |
| AS-003 | No save on no change | Load page, wait | No save triggered |

### 3.2 Manual Save

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| MS-001 | Save button works | Click Save | Data saved immediately |
| MS-002 | Save indicator | Click Save | Icon animates, "Saving..." state |
| MS-003 | Save success | Complete save | No error, data persisted |

### 3.3 Data Persistence

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| DP-001 | Rule data persists | Save, refresh page | All rule data intact |
| DP-002 | Global settings persist | Change styling, save, refresh | Styling settings intact |
| DP-003 | Profile selection persists | Switch profile, save, refresh | Same profile selected |
| DP-004 | Collapsed panels persist | Collapse panels, refresh | Same panels collapsed |

---

## 4. Validation

### 4.1 Required Fields

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| VR-001 | Empty rule name | Clear rule name | Default name or warning |
| VR-002 | No product match criteria | Leave handle/tags empty | Rule still saves (matches all) |

### 4.2 Invalid Inputs

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| VI-001 | Invalid hex color | Type "zzz" in color input | Rejected or corrected |
| VI-002 | Negative numbers | Enter -5 for padding | Corrected to 0 or minimum |
| VI-003 | Non-numeric in number field | Type "abc" in size field | Rejected |
| VI-004 | Oversized values | Enter 9999 for font size | Capped at maximum |

---

## 5. ColorPicker Component

### 5.1 Functionality

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| CP-001 | Open picker | Click color swatch | Popover opens |
| CP-002 | Close on outside click | Click outside popover | Popover closes |
| CP-003 | Select color via picker | Drag on color area | Color updates live |
| CP-004 | Select pure white | Drag to top-left corner | #FFFFFF selected |
| CP-005 | Select pure black | Drag to bottom-left corner | #000000 selected |
| CP-006 | Hex input | Type "FF5500" | Color updates to #FF5500 |
| CP-007 | Uppercase conversion | Type "ff5500" | Displays as #FF5500 |
| CP-008 | Invalid hex | Type "xyz" | Input rejected/ignored |

### 5.2 Positioning

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| CP-009 | Opens downward | Click picker near top of page | Popover opens below |
| CP-010 | Opens upward | Click picker near bottom | Popover opens above |
| CP-011 | Z-index correct | Open in scrollable container | Popover above all content |
| CP-012 | Scroll behavior | Open picker, scroll page | Popover stays with input |

### 5.3 All Locations (Messages Page)

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| CP-013 | Global Styling colors | Open Styling panel | All ColorPickers work |
| CP-014 | Icon color | Edit icon color | Picker works |
| CP-015 | Border color | Edit border color | Picker works |
| CP-016 | Text colors | Edit message/header colors | Picker works |
| CP-017 | Link colors | Edit link color/hover | Picker works |
| CP-018 | ETA Timeline colors | Edit stage colors | Picker works |
| CP-019 | Special Delivery colors | Edit SD colors | Picker works |

### 5.4 Free Delivery Page

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| CP-020 | Background color | Edit announcement bg | Picker works |
| CP-021 | Text color | Edit announcement text | Picker works |
| CP-022 | Link colors | Edit link styling | Picker works |

---

## 6. Data & Edge Cases

### 6.1 Many Rules (Performance)

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| EC-001 | 10 rules | Create 10 rules | UI responsive |
| EC-002 | 25 rules | Create 25 rules | Scrolling smooth |
| EC-003 | 50 rules | Create 50 rules | No lag when selecting |
| EC-004 | Drag with many rules | Reorder in 25+ rules | Drag responsive |

### 6.2 Long Content

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| EC-005 | Long rule name | Enter 22 chars | Truncates, no overflow |
| EC-006 | Long message | Enter 500+ char message | Textarea expands, saves OK |
| EC-007 | Many line breaks | Add 20+ {lb} in message | All render correctly |
| EC-008 | Long product handle | Enter very long handle | Saves, no truncation |

### 6.3 Special Characters

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| EC-009 | Quotes in message | Add "quoted text" | Saves and displays correctly |
| EC-010 | Single quotes | Add it's, don't | No JSON parsing issues |
| EC-011 | HTML entities | Add &amp; &lt; &gt; | Displayed as-is (not parsed) |
| EC-012 | Emoji | Add 🚚📦✅ | Emoji saved and displayed |
| EC-013 | Unicode | Add ñ, ü, 日本語 | Characters preserved |
| EC-014 | Backslash | Add C:\path | Saves correctly |
| EC-015 | Newlines | Paste multi-line text | Converted to {lb} or preserved |

### 6.4 Metafield Limits

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| EC-016 | Approach size limit | Create many rules with long messages | Save succeeds |
| EC-017 | Exceed limit | Create extreme amount of data | Error message shown |

> **Note**: Shopify metafield limit is ~512KB for JSON. Unlikely to hit in normal use.

---

## 7. Error Scenarios

### 7.1 Network Errors

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| NE-001 | Save during offline | Disable network, click Save | Error shown, no data loss |
| NE-002 | Auto-save offline | Disable network, make change | Retries or shows warning |
| NE-003 | Load page offline | Disable network, refresh | Error message, retry option |
| NE-004 | Slow network | Throttle to slow 3G | Save still completes |

> **How to test**: DevTools > Network > Offline or Slow 3G

### 7.2 Data Recovery

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| DR-001 | Corrupted JSON | Manually corrupt metafield via API | App loads with defaults, warns user |
| DR-002 | Missing config metafield | Delete metafield | App shows empty state, can create rules |
| DR-003 | Missing settings metafield | Delete settings metafield | App uses defaults |
| DR-004 | Version mismatch | Old config version | Migration runs automatically |

### 7.3 New Install vs Existing

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| NI-001 | Fresh install | Install app on new store | Empty state, Add Rule works |
| NI-002 | Existing data | Install on store with metafields | Data loaded correctly |

---

## 8. Multi-Store / Locale

### 8.1 Currency/Locale

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| ML-001 | USD store | Test on US store | Currency displays correctly in preview |
| ML-002 | GBP store | Test on UK store | £ symbol, correct formatting |
| ML-003 | EUR store | Test on EU store | € symbol, comma decimals |
| ML-004 | Date format | Check countdown messages | Dates respect locale |

### 8.2 Shopify Plans

| TC | Test | Steps | Expected |
|----|------|-------|----------|
| SP-001 | Basic plan | Test on Basic store | All features work |
| SP-002 | Plus plan | Test on Plus store | No regressions |

---

## 9. Browser/Device Testing

### 9.1 Browsers

| TC | Test | Browser | Expected |
|----|------|---------|----------|
| BR-001 | Chrome | Latest Chrome | Full functionality |
| BR-002 | Firefox | Latest Firefox | Full functionality |
| BR-003 | Safari | Latest Safari | Full functionality |
| BR-004 | Edge | Latest Edge | Full functionality |

### 9.2 Devices

| TC | Test | Device | Expected |
|----|------|--------|----------|
| DV-001 | Desktop 1920px | Desktop monitor | Normal layout |
| DV-002 | Laptop 1366px | Laptop screen | Layout adjusts |
| DV-003 | Tablet landscape | iPad | Usable, may need scroll |
| DV-004 | Tablet portrait | iPad portrait | Basic functionality |

> **Note**: Shopify admin is primarily desktop. Mobile admin has limited app support.

---

## 10. Quick Smoke Test Checklist

For rapid verification after changes:

- [ ] Page loads without console errors
- [ ] Add rule works
- [ ] Edit rule name works
- [ ] Drag-and-drop reorders
- [ ] Delete rule works
- [ ] Copy rule works
- [ ] ColorPicker opens and selects colors
- [ ] ColorPicker can select white (#FFFFFF)
- [ ] Save button saves
- [ ] Refresh preserves data
- [ ] Switch between Editor/Settings/Styling/Alignment works
- [ ] Collapse all/Expand all works
- [ ] Profile selectors on LEFT, Save on RIGHT
- [ ] No visual regressions

---

## Running Tests

```bash
# Start dev server
npm run dev

# Or with Shopify CLI
shopify app dev
```

Then navigate to:
- **Messages**: `/app/messages`
- **Free Delivery**: `/app/free-delivery`
- **Index**: `/app` (for app._index.jsx tests)
