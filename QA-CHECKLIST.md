# Delivery Info Block - QA Testing Checklist

## Part 1: Basic Date Calculations

### 1.1 Cutoff Time Logic
- [ ] **Before cutoff**: Shows "ships today" / same-day dispatch
- [ ] **After cutoff**: Shows next business day
- [ ] **Preview matches storefront** for cutoff behavior

### 1.2 Day-Specific Cutoff Times
- [ ] Saturday uses `cutoff_time_sat` when set
- [ ] Sunday uses `cutoff_time_sun` when set
- [ ] Falls back to main cutoff when day-specific not set

### 1.3 Closed Days (Your Dispatch Days)
- [ ] Orders on closed days skip to next open day
- [ ] Multiple consecutive closed days handled
- [ ] After cutoff + closed day tomorrow = correct skip

### 1.4 Courier No-Delivery Days
- [ ] Delivery dates skip no-delivery days (e.g., Sat/Sun)
- [ ] `{arrival}` date range avoids no-delivery days
- [ ] `{express}` (next-day) skips no-delivery days

### 1.5 Lead Time
- [ ] Lead time 0 = same-day shipping (before cutoff)
- [ ] Lead time 1+ = adds business days correctly
- [ ] Lead time skips closed days

---

## Part 2: Placeholder Testing

### 2.1 {arrival} Placeholder
- [ ] Shows date range (e.g., "Feb 5-7")
- [ ] Single date when min = max days
- [ ] Same month: "Feb 5-7" format
- [ ] Different months: "Feb 28-Mar 2" format

### 2.2 {express} Placeholder
- [ ] Shows single next-delivery date
- [ ] Skips courier no-delivery days
- [ ] Works alongside {arrival} in same message

### 2.3 {countdown} Placeholder
- [ ] **Preview**: Shows static "02h 14m"
- [ ] **Storefront**: Live countdown updates
- [ ] **After cutoff**: Line with {countdown} hides
- [ ] **Bold**: `**{countdown}**` renders bold

### 2.4 Bold Formatting (**)
- [ ] `**text**` renders as bold in preview
- [ ] `**text**` renders as bold on storefront
- [ ] Multiple bold sections in one line work
- [ ] Bold + placeholder combo: `**{countdown}**`

---

## Part 3: Preview vs Storefront Matching

### 3.1 Messages Block
- [ ] Message line 1 matches
- [ ] Message line 2 matches
- [ ] Message line 3 matches
- [ ] All placeholders replaced correctly

### 3.2 Border Styling
- [ ] Border shows when enabled
- [ ] Border thickness matches
- [ ] Border color matches
- [ ] Border radius matches

### 3.3 Text Styling
- [ ] Font size matches (when custom)
- [ ] Font weight matches
- [ ] Text color matches
- [ ] Theme styling inheritance works

### 3.4 Icon Display
- [ ] Icon shows/hides correctly
- [ ] Icon color matches
- [ ] Single icon layout works
- [ ] Per-line icon layout works

---

## Part 4: ETA Timeline

### 4.1 Basic Display
- [ ] Timeline shows when enabled
- [ ] 3 stages display (Order, Shipping, Delivery)
- [ ] Dates calculate correctly

### 4.2 Stage Dates
- [ ] Order date = today (or next ship day)
- [ ] Shipping date respects lead time
- [ ] Delivery date respects min/max days

### 4.3 Styling
- [ ] Colors apply correctly
- [ ] Scale/size works
- [ ] Border matching works (match_eta_border)
- [ ] Width matching works (match_eta_width)

---

## Part 5: Rule Matching

### 5.1 Product Matching
- [ ] Matches by product handle
- [ ] Matches by product tag
- [ ] Multiple products in one rule
- [ ] Multiple tags in one rule

### 5.2 Stock Status Matching
- [ ] "Any" matches all products
- [ ] "In Stock" matches available products
- [ ] "Out of Stock" matches unavailable
- [ ] "Pre-order" matches continue-selling items
- [ ] "Mixed Stock" matches multi-variant mixed

### 5.3 Priority Order
- [ ] First matching rule wins
- [ ] Fallback rule matches when no others do
- [ ] Rule reordering works correctly

---

## Part 6: Holidays & Special Dates

### 6.1 Custom Holidays
- [ ] Holiday dates skip for shipping
- [ ] Holiday dates skip for delivery
- [ ] Multiple holidays work

### 6.2 Bank Holidays (if enabled)
- [ ] Country-specific holidays load
- [ ] Shipping skips bank holidays
- [ ] Delivery calculation includes them

---

## Part 7: Override Settings

### 7.1 Cutoff Time Override
- [ ] Rule override takes precedence
- [ ] Global setting used when no override
- [ ] "Using: [time]" hint shows correctly

### 7.2 Lead Time Override
- [ ] Rule override works
- [ ] Shows inherited value when not overridden

### 7.3 Closed Days Override
- [ ] Rule can have different closed days
- [ ] Inherits from global when not set

### 7.4 Courier Days Override
- [ ] Rule can override courier no-delivery days
- [ ] Inherits correctly

---

## Part 8: Edge Cases

### 8.1 Timezone Handling
- [ ] Preview timezone setting works
- [ ] Storefront uses shop timezone
- [ ] Cutoff time respects timezone

### 8.2 Week Boundaries
- [ ] Friday before cutoff → correct delivery
- [ ] Friday after cutoff → Monday+ delivery
- [ ] Weekend handling correct

### 8.3 Month/Year Boundaries
- [ ] Dec 31 → Jan dates work
- [ ] Feb 28/29 handling (leap year)
- [ ] Cross-month ranges display correctly

---

## Quick Smoke Test

Run through these quickly to verify basic functionality:

1. [ ] Create rule with fallback, add message with `{arrival}`
2. [ ] Check preview shows date
3. [ ] Check storefront shows same date
4. [ ] Add `{countdown}` to message
5. [ ] Verify countdown ticks on storefront
6. [ ] Enable border, verify it shows
7. [ ] Enable ETA timeline, verify dates match
