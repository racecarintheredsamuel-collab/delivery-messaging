# MASTER QA PLAN - Delivery Info Block

A comprehensive testing checklist for all app features, UI, preview accuracy, and storefront behavior.

---

## Part 1: Dashboard

### 1.1 Navigation & Layout
- [ ] All tiles display correctly
- [ ] Tile counts/stats are accurate
- [ ] Navigation to each page works
- [ ] Save status indicator works

### 1.2 Quick Access
- [ ] Links to Settings work
- [ ] Links to Messages work
- [ ] Links to Free Delivery work

---

## Part 2: Settings Page

### 2.1 Cutoff Times
- [ ] Main cutoff time saves correctly
- [ ] Saturday cutoff time saves (when different)
- [ ] Sunday cutoff time saves (when different)
- [ ] Time picker works correctly
- [ ] "Same as weekday" toggle works

### 2.2 Closed Days (Your Dispatch Days)
- [ ] Day checkboxes toggle correctly
- [ ] Multiple closed days can be selected
- [ ] Closed days affect date calculations
- [ ] Preview reflects closed days

### 2.3 Courier No-Delivery Days
- [ ] Day checkboxes toggle correctly
- [ ] Affects delivery date calculations
- [ ] Separate from closed days

### 2.4 Lead Time
- [ ] Slider/input works (0-7+ days)
- [ ] Lead time 0 = same-day dispatch
- [ ] Lead time adds business days correctly
- [ ] Skips closed days

### 2.5 Delivery Window (Min/Max Days)
- [ ] Min days setting works
- [ ] Max days setting works
- [ ] Range displays correctly in {arrival}

### 2.6 Timezone
- [ ] Timezone dropdown works
- [ ] Preview uses selected timezone
- [ ] Cutoff calculations respect timezone

### 2.7 Holidays
- [ ] Can add custom holidays
- [ ] Can remove holidays
- [ ] Holidays skip for shipping
- [ ] Holidays skip for delivery
- [ ] Bank holiday toggle (if available)

### 2.8 Icons
- [ ] Icon library displays
- [ ] Can select different icons
- [ ] Custom icon upload works
- [ ] Icons display in preview
- [ ] Icons display on storefront

---

## Part 3: Messages Page (Rules)

### 3.1 Rule Management
- [ ] Can create new rule
- [ ] Can delete rule
- [ ] Can reorder rules (drag/drop)
- [ ] Can duplicate rule
- [ ] First matching rule wins (priority)

### 3.2 Rule Matching Criteria
- [ ] Match by product handle
- [ ] Match by product tag
- [ ] Match by collection (if available)
- [ ] Stock status: Any
- [ ] Stock status: In Stock
- [ ] Stock status: Out of Stock
- [ ] Stock status: Pre-order
- [ ] Stock status: Mixed Stock
- [ ] Fallback rule (matches all)

### 3.3 Rule Overrides
- [ ] Cutoff time override works
- [ ] Lead time override works
- [ ] Closed days override works
- [ ] Courier days override works
- [ ] "Using: [value]" hints display correctly

### 3.4 Message Lines
- [ ] Line 1 editable
- [ ] Line 2 editable
- [ ] Line 3 editable
- [ ] Empty lines are hidden
- [ ] Can use different messages per line

### 3.5 Placeholders in Messages
- [ ] `{arrival}` - shows date range (e.g., "Feb 5-7")
- [ ] `{arrival}` - single date when min=max
- [ ] `{arrival}` - cross-month format ("Feb 28-Mar 2")
- [ ] `{express}` - shows next delivery date
- [ ] `{countdown}` - shows live countdown
- [ ] `{countdown}` - hides line after cutoff
- [ ] `{dispatch}` - shows dispatch date (if supported)

### 3.6 Text Formatting
- [ ] `**bold**` renders as bold in preview
- [ ] `**bold**` renders as bold on storefront
- [ ] Multiple bold sections work
- [ ] `[text](url)` renders as link
- [ ] Links are clickable on storefront

### 3.7 Preview Panel
- [ ] Preview updates live on changes
- [ ] Preview shows correct dates
- [ ] Preview shows correct styling
- [ ] Preview date picker works
- [ ] Preview matches storefront output

---

## Part 4: Messages Block Styling

### 4.1 Text Styling
- [ ] Font size slider works
- [ ] Font weight options work
- [ ] Text color picker works
- [ ] Line height/spacing works
- [ ] Theme font inheritance toggle

### 4.2 Icon Styling
- [ ] Show/hide icon toggle
- [ ] Icon size slider works
- [ ] Icon color picker works
- [ ] Single icon vs per-line icons
- [ ] Icon vertical alignment

### 4.3 Border Styling
- [ ] Show/hide border toggle
- [ ] Border thickness slider
- [ ] Border color picker
- [ ] Border radius slider
- [ ] Border appears on storefront

### 4.4 Layout & Spacing
- [ ] Padding controls work
- [ ] Message spacing (gap between lines)
- [ ] Alignment options (left/center/right)
- [ ] Mobile alignment option
- [ ] Container width options

---

## Part 5: ETA Timeline

### 5.1 Basic Display
- [ ] Enable/disable toggle works
- [ ] Shows 3 stages: Order, Shipping, Delivery
- [ ] Timeline renders correctly

### 5.2 Date Calculations
- [ ] Order date = today (or next ship day after cutoff)
- [ ] Shipping date respects lead time
- [ ] Delivery date shows range (min-max)
- [ ] Skips closed days correctly
- [ ] Skips courier no-delivery days

### 5.3 Styling Options
- [ ] Stage colors customizable
- [ ] Line/connector colors
- [ ] Scale/size slider works
- [ ] Match border setting works
- [ ] Match width setting works
- [ ] Font options work

### 5.4 Preview vs Storefront
- [ ] Preview dates match storefront
- [ ] Styling matches between both
- [ ] Responsive on mobile

---

## Part 6: Free Delivery Page

### 6.1 Threshold Amount
- [ ] Input accepts decimal values
- [ ] Saves in pence/cents correctly
- [ ] Displays with currency symbol
- [ ] Tooltip explains purpose

### 6.2 Free Delivery Messaging (Cart Block)
- [ ] Enable/disable toggle works
- [ ] Progress message with `{remaining}` works
- [ ] Progress message with `{threshold}` works
- [ ] Unlocked message displays when qualified
- [ ] Empty cart message (or hide when empty)

### 6.3 Progress Bar
- [ ] Enable/disable toggle works
- [ ] Bar fills based on cart progress
- [ ] Progress bar color customizable
- [ ] Background color customizable
- [ ] 100% when threshold reached

### 6.4 Announcement Bar - Basic
- [ ] Enable/disable toggle works
- [ ] Bar appears at top of page
- [ ] Background color works
- [ ] Text color works
- [ ] Chevron navigation works

### 6.5 Announcement Bar - Message Cycling
- [ ] Progress message cycles
- [ ] Unlocked message cycles
- [ ] Empty cart message cycles
- [ ] Timer duration per message works
- [ ] Smooth transitions between messages

### 6.6 Announcement Bar - Additional Messages
- [ ] Additional message 1 works
- [ ] Additional message 2 works
- [ ] Timer per additional message works
- [ ] Messages cycle with FD messages
- [ ] `{countdown}` placeholder works in additional messages
- [ ] **Message hides when countdown expired**
- [ ] `**bold**` formatting works
- [ ] `[link](url)` formatting works

### 6.7 Announcement Bar - Loading/Race Conditions
- [ ] **First load shows correct threshold (not £0)**
- [ ] Refresh shows correct values
- [ ] No flash of incorrect content
- [ ] Cart updates reflect immediately

### 6.8 Announcement Bar - Styling
- [ ] Max width setting works
- [ ] Chevron alignment setting works
- [ ] Text alignment works
- [ ] Mobile responsive

### 6.9 Exclusions
- [ ] Product tags exclusion works
- [ ] Product handles exclusion works
- [ ] Excluded message (FD Messaging) works
- [ ] Excluded message (Announcement Bar) works
- [ ] Timer for excluded message works
- [ ] Leave blank to hide bar when excluded

---

## Part 7: Special Delivery Block

### 7.1 Basic Display
- [ ] Block renders on product page
- [ ] Shows special delivery options
- [ ] Styling matches theme

### 7.2 Configuration
- [ ] Can set special delivery rules
- [ ] Icon displays correctly
- [ ] Custom messaging works

---

## Part 8: Storefront Blocks

### 8.1 delivery_messages.liquid
- [ ] Renders in product page
- [ ] Shows correct rule's messages
- [ ] Placeholders replaced correctly
- [ ] Styling applied correctly
- [ ] Icons display correctly

### 8.2 eta_timeline.liquid
- [ ] Renders when enabled
- [ ] Dates calculate correctly
- [ ] Styling matches settings
- [ ] Responsive on mobile

### 8.3 free_delivery_bar.liquid
- [ ] Renders in cart drawer/page
- [ ] Progress updates with cart
- [ ] Messages change at threshold
- [ ] Progress bar fills correctly

### 8.4 fd_announcement_bar.liquid
- [ ] Renders at page top
- [ ] Message cycling works
- [ ] Cart integration works
- [ ] Countdown updates live
- [ ] Chevrons work

### 8.5 special_delivery.liquid
- [ ] Renders correctly
- [ ] Shows appropriate messaging
- [ ] Styling works

---

## Part 9: Preview vs Storefront Accuracy

### 9.1 Messages Block
- [ ] Line 1 text matches
- [ ] Line 2 text matches
- [ ] Line 3 text matches
- [ ] Dates are identical
- [ ] Bold formatting matches
- [ ] Colors match
- [ ] Icon matches
- [ ] Border matches

### 9.2 ETA Timeline
- [ ] Order date matches
- [ ] Shipping date matches
- [ ] Delivery date matches
- [ ] Styling matches

### 9.3 Free Delivery
- [ ] Progress message matches
- [ ] Threshold displays correctly
- [ ] Progress bar matches

---

## Part 10: Edge Cases

### 10.1 Date Boundaries
- [ ] Friday after cutoff → Monday+ delivery
- [ ] Saturday/Sunday handling
- [ ] Month boundary (Jan 31 → Feb 1)
- [ ] Year boundary (Dec 31 → Jan 1)
- [ ] Leap year (Feb 28/29)

### 10.2 Multiple Closed Days
- [ ] Consecutive closed days skip correctly
- [ ] Holiday + weekend combination
- [ ] All week closed = error/warning?

### 10.3 Timezone Edge Cases
- [ ] Near-midnight orders
- [ ] Different user timezone
- [ ] DST transitions

### 10.4 Cart Edge Cases
- [ ] Empty cart → add item
- [ ] Remove all items
- [ ] Exactly at threshold
- [ ] Just below threshold
- [ ] Way over threshold
- [ ] Mixed excluded + normal products

### 10.5 Loading States
- [ ] First page load (cold cache)
- [ ] Refresh (warm cache)
- [ ] Navigate between pages
- [ ] Cart drawer open/close
- [ ] Multiple tabs open

### 10.6 Browser/Device
- [ ] Desktop Chrome
- [ ] Desktop Firefox
- [ ] Desktop Safari
- [ ] Mobile iOS Safari
- [ ] Mobile Android Chrome
- [ ] Tablet

---

## Quick Smoke Test

Fast check to verify core functionality:

1. [ ] Open app, navigate to each page
2. [ ] Create/edit a rule with `{arrival}` and `{countdown}`
3. [ ] Check preview shows dates
4. [ ] Check storefront shows same dates
5. [ ] Add item to cart, verify Free Delivery updates
6. [ ] Check announcement bar cycles messages
7. [ ] Verify countdown ticks down
8. [ ] Enable ETA timeline, verify dates match
9. [ ] Test on mobile device

---

## Test Completion Tracking

| Part | Section | Status |
|------|---------|--------|
| 1 | Dashboard | Not Started |
| 2 | Settings | Not Started |
| 3 | Messages (Rules) | Not Started |
| 4 | Messages Styling | Not Started |
| 5 | ETA Timeline | Not Started |
| 6 | Free Delivery | Not Started |
| 7 | Special Delivery | Not Started |
| 8 | Storefront Blocks | Not Started |
| 9 | Preview Accuracy | Not Started |
| 10 | Edge Cases | Not Started |

---

*Last Updated: February 2026*
