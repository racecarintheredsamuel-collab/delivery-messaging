# 4. SPECIAL DELIVERY

## 4.1 UI/UX Risk Summary

### Most Likely to Break
- **Icon rendering** - Three types (preset, custom SVG, custom URL) with different rendering paths
- **Width matching** - "Match ETA width" depends on ETA Timeline being present; if absent, behavior undefined
- **Line break handling** - `{lb}` placeholder must be converted to `<br>` correctly
- **Link parsing** - Markdown `[text](url)` requires JS processing after render
- **Header/message gap** - Optional header affects layout; missing header should remove gap
- **Per-rule overrides** - Override flags must be enabled before override values take effect

### Theme-Dependent Risks
- **Font inheritance** - Block inherits theme text styling by default; custom fonts may clash
- **Icon scaling** - Large icons may overflow narrow product sections
- **Background contrast** - Default colors may not be readable on dark theme backgrounds
- **Container width** - Some themes constrain product sections, affecting block width
- **CSS specificity** - Theme styles may override block text styling

### Merchant Misconfiguration Risks
- **Show Special Delivery not enabled** - Block only displays when rule has `show_special_delivery = true`
- **Empty message** - If message field blank, nothing displays (fails safe but confusing)
- **Missing icon configuration** - Using "custom-1" without custom icon configured
- **Width matching without ETA** - Enabling "Match ETA width" when ETA Timeline not on page

---

## 4.2 Test Scope

### High Priority (Test Thoroughly)
- Rule matching (handle, tag, stock status, fallback)
- Show/hide toggle behavior
- Message display with line breaks `{lb}`
- Link parsing `[text](url)`
- Icon rendering (all 3 types: preset, custom SVG, custom URL)
- Header display (with and without)
- Responsive alignment (desktop vs mobile)
- Width matching with ETA Timeline

### Medium Priority
- Icon color customization (main color vs custom)
- Icon size and alignment
- Border/background styling
- Text styling (color, size, weight)
- Header styling (color, size, weight)
- Spacing controls (gaps, padding, margins)
- Custom fonts (theme, messages match, specific)

### Lower Priority
- Icon style variants (solid vs outline)
- Icon vertical alignment (top, center, bottom)
- Text alignment within container
- Max width constraints
- Line height adjustments

---

## 4.3 Theme Test Matrix

### Dawn (Shopify Reference Theme)

| Area | What to Verify | Risk Level |
|------|----------------|------------|
| Block placement | Appears correctly in product form | Low |
| Icon rendering | SVG icons display at correct size | Low |
| Text display | Message and header render correctly | Low |
| Font inheritance | Theme font applies when "Match theme font" checked | Low |
| Responsive | Mobile alignment switches correctly | Medium |
| Link styling | Links styled and clickable | Low |

### Warehouse (Commercial Theme)

| Area | What to Verify | Risk Level |
|------|----------------|------------|
| Product page layout | Block visible within complex product form | High |
| Container width | Block respects container constraints | Medium |
| Typography scale | Font sizes proportional to theme | Medium |
| CSS conflicts | Text styles not overridden by theme | Medium |
| Color scheme | Default colors readable on theme backgrounds | Medium |
| Width matching | Syncs with ETA Timeline correctly | Medium |

### Ride (Different Structure)

| Area | What to Verify | Risk Level |
|------|----------------|------------|
| Full-width layout | Block respects product section width | Medium |
| Variant selection | Stock status rules update on variant change | High |
| Animation | Fade-in doesn't clash with theme | Low |
| Touch targets | Icons adequate size on mobile | Low |
| Link interaction | Links work on touch devices | Low |

---

## 4.4 Test Scenarios

### Core Functional Tests

#### TC-SD-001: Rule Matching - Show Special Delivery
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create rule with `show_special_delivery = true` | Special Delivery displays for matching products |
| 2 | Set message text | Message displays in block |
| 3 | Visit matching product page | Block visible with icon and message |

#### TC-SD-002: Rule Matching - Hide Special Delivery
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create rule with `show_special_delivery = false` | Block hidden for matching products |
| 2 | Visit matching product page | Block not displayed |
| 3 | Other blocks (Messages, ETA) still show | Independent blocks |

#### TC-SD-003: Rule Matching - Fallback
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create fallback rule with `show_special_delivery = true` | Matches any unmatched product |
| 2 | Visit product matching specific rule | Specific rule settings used |
| 3 | Visit product not matching any rule | Fallback rule Special Delivery displays |

#### TC-SD-004: Empty Message
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enable `show_special_delivery = true` | Block enabled |
| 2 | Leave message field blank | No message content |
| 3 | Visit matching product | Block not rendered (fails safe) |

---

### Message Content Tests

#### TC-SD-005: Basic Message Display
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set message = "Free gift wrapping available" | Simple text |
| 2 | Visit matching product | Message displays correctly |
| 3 | Text styling applied | Color, size, weight correct |

#### TC-SD-006: Line Breaks
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set message = "Line 1{lb}Line 2{lb}Line 3" | Multiple lines |
| 2 | Visit matching product | Three separate lines display |
| 3 | `{lb}` replaced with `<br>` | Line breaks render correctly |

#### TC-SD-007: Markdown Links
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set message = "See our [gift guide](/collections/gifts)" | Internal link |
| 2 | Visit matching product | "gift guide" is clickable link |
| 3 | Click link | Navigates to /collections/gifts |

#### TC-SD-008: External Links
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set message = "Learn more at [Example](https://example.com)" | External link |
| 2 | Visit matching product | "Example" is clickable link |
| 3 | Link has `target="_blank"` | Opens in new tab |
| 4 | Link has `rel="noopener"` | Security attribute present |

#### TC-SD-009: Bold Text
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set message = "**Free** gift wrapping" | Bold text |
| 2 | Visit matching product | "Free" rendered in bold |
| 3 | Surrounding text normal weight | Only bold portion affected |

---

### Header Tests

#### TC-SD-010: Header Display
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set header = "Special Offer" | Header text |
| 2 | Set message = "Details here" | Message text |
| 3 | Visit matching product | Header above message with gap |

#### TC-SD-011: No Header
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Leave header blank | No header |
| 2 | Set message = "Details here" | Message only |
| 3 | Visit matching product | No header div, no gap |

#### TC-SD-012: Header Styling
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set header color, size, weight | Custom header styling |
| 2 | Different from message styling | Distinct appearance |
| 3 | Visit matching product | Header uses custom styles |

---

### Icon Tests

#### TC-SD-013: Preset Icon
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_icon = "gift"` | Gift icon selected |
| 2 | Visit matching product | Gift icon displays |
| 3 | Icon renders via `{% render 'icon' %}` | SVG icon correct |

#### TC-SD-014: Custom SVG Icon
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Configure custom icon #1 with SVG in global settings | Custom SVG saved |
| 2 | Set `special_delivery_icon = "custom-1"` | Reference custom icon |
| 3 | Visit matching product | Custom SVG renders inline |

#### TC-SD-015: Custom URL Icon
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Configure custom icon #2 with URL in global settings | Image URL saved |
| 2 | Set `special_delivery_icon = "custom-2"` | Reference custom icon |
| 3 | Visit matching product | `<img>` tag with URL renders |
| 4 | Image has `loading="lazy"` | Lazy loading enabled |

#### TC-SD-016: Icon Size
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_icon_size = 24` | Small icon |
| 2 | Set `special_delivery_icon_size = 48` | Large icon |
| 3 | Icons scale correctly | Width/height match setting |

#### TC-SD-017: Icon Color - Main
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_use_main_icon_color = true` | Use main icon color |
| 2 | Set main `icon_color = "#ff0000"` | Red color |
| 3 | Visit matching product | Icon displays in red |

#### TC-SD-018: Icon Color - Custom
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_use_main_icon_color = false` | Custom color mode |
| 2 | Set `special_delivery_icon_color = "#00ff00"` | Green color |
| 3 | Visit matching product | Icon displays in green |

#### TC-SD-019: Icon Vertical Alignment
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_icon_alignment = "top"` | Top aligned |
| 2 | Set `special_delivery_icon_alignment = "center"` | Center aligned |
| 3 | Set `special_delivery_icon_alignment = "bottom"` | Bottom aligned |
| 4 | Multi-line message shows difference | Alignment visible |

#### TC-SD-020: Icon Style
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_icon_style = "solid"` | Filled icon |
| 2 | Set `special_delivery_icon_style = "outline"` | Outline icon |
| 3 | Visit matching product | Style applied correctly |

#### TC-SD-021: Custom Icon Out of Bounds
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_icon = "custom-5"` | Reference non-existent icon |
| 2 | Only 2 custom icons configured | Icon index > array size |
| 3 | Visit matching product | No icon rendered (graceful fail) |

---

### Width Matching Tests

#### TC-SD-022: Match ETA Width - ETA Present
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enable `special_delivery_match_eta_width = true` | Width matching enabled |
| 2 | ETA Timeline on same page | Both blocks visible |
| 3 | Visit matching product | Special Delivery width matches ETA Timeline |

#### TC-SD-023: Match ETA Width - ETA Absent
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enable `special_delivery_match_eta_width = true` | Width matching enabled |
| 2 | ETA Timeline NOT on page | Only Special Delivery visible |
| 3 | Visit matching product | Block uses max-width setting instead |

#### TC-SD-024: Custom Max Width
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Disable width matching | Custom width mode |
| 2 | Set `special_delivery_max_width = 400` | 400px max |
| 3 | Visit matching product | Block constrained to 400px |

---

### Styling Tests

#### TC-SD-025: Border and Background
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enable `special_delivery_use_custom_border = true` | Border options active |
| 2 | Set border_thickness = 2, border_color = "#000" | 2px black border |
| 3 | Set background_color = "#f5f5f5" | Light gray background |
| 4 | Visit matching product | Bordered container with background |

#### TC-SD-026: Global Border Fallback
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Disable `special_delivery_use_custom_border` | Use global settings |
| 2 | Set global border settings | Border configured |
| 3 | Visit matching product | Global border applied |

#### TC-SD-027: Text Styling - Theme
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enable `special_delivery_use_theme_text_styling = true` | Theme styles |
| 2 | Visit matching product | Inherits theme font styling |

#### TC-SD-028: Text Styling - Custom
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enable `special_delivery_use_theme_text_styling = false` | Custom styles |
| 2 | Set text_color, font_size, font_weight | Custom values |
| 3 | Visit matching product | Custom styling applied |

#### TC-SD-029: Per-Rule Text Override
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enable `override_global_text_styling` on rule | Rule styling active |
| 2 | Set different colors/sizes on rule | Rule values |
| 3 | Global text styling ignored | Rule overrides apply |

---

### Layout Tests

#### TC-SD-030: Alignment - Desktop
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_alignment = "left"` | Block left-aligned |
| 2 | Set `special_delivery_alignment = "center"` | Block centered |
| 3 | Set `special_delivery_alignment = "right"` | Block right-aligned |

#### TC-SD-031: Alignment - Mobile
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_alignment_mobile = "center"` | Mobile centered |
| 2 | View on mobile viewport | Different from desktop alignment |
| 3 | Resize to desktop | Desktop alignment takes over |

#### TC-SD-032: Text Alignment Within Container
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_text_alignment = "left"` | Text left |
| 2 | Set `special_delivery_text_alignment = "center"` | Text centered |
| 3 | Distinct from block alignment | Container vs text |

#### TC-SD-033: Spacing Controls
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Adjust `special_delivery_icon_gap` | Space between icon and content |
| 2 | Adjust `special_delivery_header_gap` | Space between header and message |
| 3 | Adjust `special_delivery_padding_*` | Container padding changes |

#### TC-SD-034: Margins
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_margin_top = 20` | 20px above block |
| 2 | Set `special_delivery_margin_bottom = 20` | 20px below block |
| 3 | Visit matching product | Margins visible |

---

### Font Tests

#### TC-SD-035: Theme Font
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_use_theme_font = true` | Theme font applied |
| 2 | Visit matching product | Matches theme typography |

#### TC-SD-036: Custom Font
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_use_theme_font = false` | Custom font mode |
| 2 | Set `special_delivery_custom_font_family = "Inter"` | Inter font |
| 3 | Visit matching product | Google Font loads and renders |

#### TC-SD-037: Match Messages Font
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set `special_delivery_match_messages_font = true` | Uses messages font |
| 2 | Configure custom font on messages block | Font shared |
| 3 | Visit matching product | Same font as messages block |

---

### Edge Cases

#### TC-SD-038: No Rules Configured
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Delete all rules | No rules exist |
| 2 | Visit product page | Block not rendered |
| 3 | Check for console errors | No JS errors |

#### TC-SD-039: Theme Editor Mode
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open theme editor | Design mode active |
| 2 | Add Special Delivery block | Block added |
| 3 | View placeholder | Shows "Enable Show Special Delivery in rules" |

#### TC-SD-040: Fade-In Animation
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Visit matching product | Block loads |
| 2 | Observe initial state | Starts with opacity: 0 |
| 3 | JS adds `.is-ready` | Fades in over 400ms |

#### TC-SD-041: Stock Status - In Stock Only
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create rule with `stock_status = "in_stock"` | Only in-stock products |
| 2 | Set `show_special_delivery = true` | Special Delivery enabled |
| 3 | Visit in-stock product | Block displays |
| 4 | Visit out-of-stock product | Block hidden |

#### TC-SD-042: Link Styling
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Configure link colors in global settings | Link styling set |
| 2 | Add link in message | `[text](url)` |
| 3 | View link | Uses configured colors |
| 4 | Hover over link | Hover state applies |

---

## 4.5 Step-by-Step QA Checklist

### Pre-Test Setup
- [ ] Verify app is installed on development store(s)
- [ ] Configure at least one delivery rule with Special Delivery enabled
- [ ] Set message text with various content types
- [ ] Have test products ready (various tags, stock states)

### Basic Block Testing
- [ ] Create rule with product handle match and `show_special_delivery = true`
- [ ] Create rule with tag match and `show_special_delivery = true`
- [ ] Create fallback rule with `show_special_delivery = true`
- [ ] Test stock status conditions (in_stock, out_of_stock, pre_order)
- [ ] Verify message displays correctly
- [ ] Verify icon displays correctly

### Message Content Testing
- [ ] Test plain text message
- [ ] Test line breaks with `{lb}`
- [ ] Test markdown links `[text](url)`
- [ ] Test bold text with `**text**`
- [ ] Test combined formatting

### Header Testing
- [ ] Test with header text
- [ ] Test without header (blank)
- [ ] Test header styling options
- [ ] Verify header gap when present

### Icon Testing
- [ ] Test preset icon selection
- [ ] Test custom SVG icon
- [ ] Test custom URL icon
- [ ] Test icon size adjustment
- [ ] Test icon color (main vs custom)
- [ ] Test icon vertical alignment
- [ ] Test icon style (solid vs outline)

### Width Matching Testing
- [ ] Test with ETA Timeline present
- [ ] Test without ETA Timeline
- [ ] Test custom max width
- [ ] Verify resize behavior

### Styling Testing
- [ ] Test border settings
- [ ] Test background color
- [ ] Test text styling (color, size, weight)
- [ ] Test header styling (color, size, weight)
- [ ] Test per-rule styling override

### Layout Testing
- [ ] Test desktop alignment (left, center, right)
- [ ] Test mobile alignment
- [ ] Test text alignment within container
- [ ] Test spacing controls (gaps, padding)
- [ ] Test margins (top, bottom)

### Font Testing
- [ ] Test theme font inheritance
- [ ] Test custom font loading
- [ ] Test "Match messages font" option

### Dawn Theme Testing
- [ ] Block renders in product form
- [ ] Icons display correctly
- [ ] Links work correctly
- [ ] Mobile alignment works

### Warehouse Theme Testing
- [ ] Block visible in complex product form
- [ ] Container width respects constraints
- [ ] Typography scales correctly
- [ ] No CSS conflicts on text

### Ride Theme Testing
- [ ] Block respects product section width
- [ ] Variant selection updates stock rules
- [ ] Colors readable on theme background
- [ ] Touch targets adequate on mobile

### Final Checks
- [ ] No console errors
- [ ] No layout shifts on load
- [ ] Fade-in transition smooth
- [ ] Responsive behavior correct
- [ ] Performance acceptable
