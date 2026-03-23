export const HELP_SECTIONS = [
  {
    id: "global-settings",
    title: "Global Settings",
    children: [
      {
        id: "global-preview-timezone",
        title: "Preview Timezone",
        image: "/images/help/preview-timezone1.png",
        content: "The preview timezone controls which timezone is used when rendering placeholder values in the app preview. Set this to your shop's timezone so that countdown timers, shipping dates, and delivery dates in the preview match what your customers will see on the live storefront.",
      },
      {
        id: "global-delivery-windows",
        title: "Delivery Windows",
        image: "/images/help/delivery-windows1.png",
        content: "Delivery windows define how many business days your courier takes to deliver after dispatch. There are two separate windows:\n\n• Courier Delivery Window (min/max days) — used by the {arrival} placeholder and the ETA timeline delivery date. For example, min 3 / max 5 means the customer sees a delivery range like 'Mar 25-27'.\n\n• Express Delivery Window (min/max days) — used by the {express} placeholder. Typically set to 1/1 for next-day delivery, but can be a range if your express service varies.\n\nBoth windows count business days only — courier no-delivery days and holidays are skipped.",
      },
      {
        id: "global-cutoff",
        title: "Cutoff Times",
        image: "/images/help/cutoff1.png",
        content: "The cutoff time is the daily deadline for same-day dispatch. Before the cutoff, the {countdown} placeholder shows a live timer and {shipped} resolves to today's date. After the cutoff, countdown lines switch to the fallback message and {shipped} moves to the next available dispatch day.\n\nYou can set different cutoff times for Saturday and Sunday, or leave them blank to use the default. If a day is marked as closed, no cutoff applies — it's treated as past cutoff regardless.",
      },
      {
        id: "global-lead-time",
        title: "Lead Time",
        image: "/images/help/leadtimes1.png",
        content: "Lead time adds extra business days between order placement and dispatch. A lead time of 1 means orders are dispatched the next business day after the cutoff, rather than the same day. This is useful for products that require preparation, assembly, or processing time before they can be shipped. Lead time only counts business days — closed days and holidays are skipped.",
      },
      {
        id: "global-closed-courier",
        title: "Closed Days & Courier No-Delivery Days",
        image: "/images/help/closed-delivery1.png",
        content: "Closed days are days your business does not dispatch orders (e.g., Saturday and Sunday). These are skipped when calculating shipping dates — if today is Friday after cutoff, {shipped} jumps to Monday. Bank holidays and custom holidays are also taken into account.\n\nCourier no-delivery days are separate — these are days your courier does not deliver (typically weekends). They affect {arrival} and {express} date calculations and ETA timeline delivery dates, but not your dispatch/shipping date. For example, if your courier doesn't deliver on weekends, a Friday dispatch with 1-day delivery shows Monday as the arrival date.",
      },
      {
        id: "global-holidays",
        title: "Bank Holidays & Custom Holidays",
        image: "/images/help/holidays1.png",
        content: "Bank holidays can be enabled by selecting your country — holidays are automatically calculated each year. You can also add custom holiday dates for closures specific to your business (e.g., annual stocktake, staff training days). All holidays are treated the same as closed days for dispatch calculations and are skipped when calculating shipping and delivery dates.",
      },
    ],
  },
  {
    id: "global-styling",
    title: "Global Styling",
    children: [
      {
        id: "styling-preview",
        title: "Preview Theme Settings",
        image: "/images/help/preview1.png",
        content: "Match your admin preview to your Shopify theme — set the preview font, font size scale (80-130%), text colour, and background colour. These settings only affect how blocks appear in the app preview, not on the live storefront.",
      },
      {
        id: "styling-messages",
        title: "Messages Text Styling",
        image: "/images/help/messages-styling1.png",
        content: "Control the font, text colour, font size, and font weight for delivery message lines. Enable 'Match theme font' to inherit your Shopify theme's font, or choose a custom font family.\n\nEnable 'Match theme text styling' to inherit theme defaults, or disable it to set custom text colour, font size (10-22px), and font weight (normal/bold).\n\nCan be overridden per-rule — enable 'Use custom text styling' within a rule to set rule-specific colours, sizes, and weights.",
      },
      {
        id: "styling-eta",
        title: "ETA Timeline Text Styling",
        image: "/images/help/eta-styling1.png",
        content: "Labels (Ordered, Shipped, Delivered) and dates have separate styling controls. Each can have its own colour, font size (10-18px), and font weight.\n\nCan be overridden per-rule — enable 'Use custom ETA text styling' within a rule to set rule-specific label and date styles.",
      },
      {
        id: "styling-special",
        title: "Special Delivery Text Styling",
        image: "/images/help/special-styling1.png",
        content: "Header and message have independent styling. The header supports colour, font size (12-24px), and font weight. The message body supports the same controls with a slightly different size range (10-22px).\n\nCan be overridden per-rule — header and message styling have separate override toggles, so you can override one without the other.",
      },
      {
        id: "styling-borders",
        title: "Borders & Background",
        image: "/images/help/border-styling1.png",
        content: "Set a global border thickness (0-10px), radius (0-50px), border colour, and background colour that applies to Messages, ETA Timeline, and Special Delivery blocks.\n\nCan be overridden per-rule — enable 'Use custom border styling' within a rule to set rule-specific borders, radius, and background colours.",
      },
      {
        id: "styling-links",
        title: "Link Styling",
        image: "/images/help/link-styling1.png",
        content: "Control how links created with [text](url) in message lines appear. Set the link colour, underline decoration, and underline thickness for both default and hover states. Hover effects also support an opacity setting.\n\nAnnouncement bar links have their own separate styling — typically white text on dark backgrounds with independent hover controls.\n\nLink styling is global only and cannot be overridden per-rule.",
      },
    ],
  },
  {
    id: "global-alignment",
    title: "Global Alignment & Spacing",
    children: [
      {
        id: "alignment-messages",
        title: "Messages Spacing & Alignment",
        image: "/images/help/messages-align1.png",
        content: "Set left, right, and vertical padding inside the messages container. Control the gap between icon and text in single-icon mode. Top and bottom margins control spacing between the messages block and surrounding page content.\n\nAlignment can be set separately for desktop (left/center) and mobile (left/center). These settings are global and cannot be overridden per-rule.",
      },
      {
        id: "alignment-eta",
        title: "ETA Timeline Spacing & Alignment",
        image: "/images/help/eta-align1.png",
        content: "Set horizontal and vertical padding inside the ETA timeline container. Control the gaps between icons and labels, labels and dates, and between stages (horizontal gap supports negative values to pull stages closer together).\n\nTop and bottom margins control surrounding spacing. Desktop and mobile alignment can be set independently.",
      },
      {
        id: "alignment-special",
        title: "Special Delivery Spacing & Alignment",
        image: "/images/help/special-align1.png",
        content: "Set left, right, and vertical padding inside the special delivery container. Control the gap between header and message, icon and text, and the line height for message text.\n\nTop and bottom margins control surrounding spacing. Desktop and mobile alignment can be set independently.",
      },
    ],
  },
  {
    id: "profiles-rules",
    title: "Profiles & Rules",
    children: [
      {
        id: "profiles-overview",
        title: "Profiles",
        image: "/images/help/profile1.png",
        content: "Profiles let you maintain multiple sets of rules and switch between them. There are two key selectors: 'Live Profile' controls which profile your storefront displays to customers, and 'Editing' controls which profile you're currently working on. Both selectors appear at the top and bottom of the Messages Editor, and in the same positions on the Free Delivery page.\n\nTo manage profiles (create, duplicate, rename, or delete), open the Settings tab on the Messages Editor. Only one profile can be live at a time — when you switch it, all storefront blocks immediately start reading from the newly selected profile. This makes it easy to prepare seasonal messaging (e.g., Christmas delivery cut-offs) or test different configurations without affecting what customers see.",
      },
      {
        id: "rules-overview",
        title: "Rules",
        image: "/images/help/rules1.png",
        content: "Rules are the core of how delivery messaging works. Each rule defines what to show and which products it applies to. Rules are evaluated in order from top to bottom — the first rule that matches a product wins, and its settings are used for that product's delivery messaging, ETA timeline, and special delivery block.\n\nEvery profile needs at least one rule. A common pattern is to create specific rules for products that need unique messaging (e.g., made-to-order items with longer lead times, or bulky goods with pallet delivery), and then have a fallback rule at the bottom that catches everything else. You can reorder rules by dragging them, and duplicate existing rules to use as a starting point for new ones.",
      },
    ],
  },
  {
    id: "product-matching",
    title: "Product Matching",
    children: [
      {
        id: "product-matching-overview",
        title: "Overview",
        image: "/images/help/product-matching1.png",
        content: "Products are matched to rules using tags — this is the recommended approach for most setups. Simply add the same tag to all products that should share the same delivery messaging, then reference that tag in your rule. Product handles are available but best reserved for one-off exceptions or exclusions, not as a primary matching method. Fallback rules (which match all products) sit at the bottom of your rule list and catch anything not matched by a specific rule above.\n\nA powerful technique is to use the same tag across multiple rules with different stock status filters. For example, create one rule tagged 'standard' with stock status 'In Stock' showing 'Order today, dispatched tomorrow', and a second rule also tagged 'standard' but filtered to 'Pre-Order' showing 'Pre-order — expected dispatch in 2-3 weeks'. The same products automatically get different messaging depending on their current stock status, with no manual intervention needed. Stock status options are: In Stock, Out of Stock, Pre-Order, Mixed Stock, or Any.",
      },
    ],
  },
  {
    id: "dispatch",
    title: "Dispatch Settings (per rule overrides)",
    children: [
      {
        id: "dispatch-overview",
        title: "Overview",
        image: "/images/help/dispatch1.png",
        content: "Each rule can override specific global dispatch settings — cutoff times, delivery windows, lead time, closed days, and courier no-delivery days. This is useful when certain products have different dispatch schedules, ship via different couriers, or need longer preparation times.\n\nEnable the relevant override toggle within a rule's Dispatch Settings section to set rule-specific values. Any setting not overridden inherits from Global Settings.",
        link: { label: "See Global Settings for full details on each setting", anchor: "global-settings" },
      },
    ],
  },
  {
    id: "messages",
    title: "Messages & Message Icons",
    children: [
      {
        id: "messages-overview",
        title: "Overview",
        images: ["/images/help/messages1.png", "/images/help/messages2.png"],
        resultImage: "/images/help/messages-actual1.png",
        content: "Delivery Messages display dynamic delivery information on your product pages. Each rule can show up to 4 message lines with icons, countdown timers, estimated delivery dates, and more. Text styling, borders, background, max width, padding, and alignment can all be customised — these are covered in the Styling section. Per-rule style overrides are also available.",
      },
      {
        id: "messages-placeholders",
        title: "Placeholders",
        image: "/images/help/placeholders1.png",
        content: "Use placeholders in your message lines to display dynamic content:\n\n• {countdown} — Live countdown timer to your dispatch cutoff\n• {arrival} — Estimated delivery date range\n• {express} — Express delivery date range\n• {shipped} — Shipping/dispatch date\n• {threshold} — Free delivery threshold amount\n• {pricing:name} — Dynamic delivery pricing (configure in Free Delivery > Pricing Displays)\n• {lb} — Manual line break\n• **text** — Bold text\n• [text](url) — Clickable link",
      },
      {
        id: "messages-cutoff",
        title: "Cutoff Times & Fallback",
        image: "/images/help/cutoff-passed1.png",
        content: "When a message line uses {countdown} and the cutoff time passes, any line containing {countdown} is hidden entirely by default. To show a replacement message instead, set a Cutoff Fallback Message — for example, 'Order ships {shipped}'. Use {shipped} in the fallback to display the next shipping date.",
      },
      {
        id: "messages-icons",
        title: "Message Icons",
        images: ["/images/help/message-icons1.png", "/images/help/message-icons2.png"],
        content: "Each message line can display an icon to the left of the text. Choose from the preset icon library or your own custom SVGs (uploaded in the Icons page). There are two layout modes:\n\n• Per-line — each message line gets its own icon. You can set a different icon, style, and colour per line, or leave them to inherit the main icon.\n\n• Single icon — one icon is displayed once to the left of all message lines. Set the icon size and gap between the icon and the text.\n\nYou can also set the icon to 'None' on individual lines to hide it for that line only. The main icon colour is inherited from the rule's icon colour setting, but per-line colours can override this.",
      },
    ],
  },
  {
    id: "eta-timeline",
    title: "ETA Timeline",
    children: [
      {
        id: "eta-timeline-overview",
        title: "Overview",
        images: ["/images/help/eta-timeline1.png", "/images/help/eta-timeline2.png"],
        resultImage: "/images/help/eta-actual1.png",
        content: "The ETA Timeline shows a visual order → shipping → delivery progression with icons, labels, and calculated dates. Enable it per-rule in the Messages section.",
      },
      {
        id: "eta-labels",
        title: "Labels & Dates",
        image: "/images/help/eta-labels1.png",
        content: "Stage labels default to 'Ordered', 'Shipped', 'Delivered' but can be customised per-rule. Clear a label field to revert to the default. Dates are calculated automatically based on your dispatch settings.",
      },
      {
        id: "eta-icons",
        title: "Stage Icons",
        image: "/images/help/eta-stages1.png",
        content: "Each stage (Order, Shipping, Delivery) can have its own icon from the preset library, a custom icon, or 'None' to hide the icon entirely.",
      },
      {
        id: "eta-connectors",
        title: "Connectors",
        image: "/images/help/eta-connector1.png",
        content: "Connectors sit between the stages. Choose from line, double-chevron, big-arrow, arrow-dot, or a custom SVG. Alignment options: Center (full height), Center (icon level), or Custom position with a percentage-based vertical offset slider.",
      },
    ],
  },
  {
    id: "special-delivery",
    title: "Special Delivery",
    children: [
      {
        id: "special-delivery-overview",
        title: "Overview",
        images: ["/images/help/special1.png", "/images/help/special2.png"],
        resultImage: "/images/help/special-actual1.png",
        content: "Special Delivery is a separate block for products that need unique delivery messaging — e.g., palletised shipments, made-to-order items, or oversized goods. Enable it per-rule to show alongside or instead of standard delivery messages. It renders as its own block on the product page with an optional header, message body, and icon.",
      },
      {
        id: "special-delivery-content",
        title: "Header & Message",
        image: "/images/help/special-header1.png",
        content: "The header is optional — use it for a short label like 'Palletised Shipment' or 'Made to Order'. The message body supports {lb} for line breaks, **bold** text, and [link](url) formatting. This is where you describe the delivery method, expected timescales, or any special instructions the customer should know.\n\nBoth fields support per-rule customisation, so different products can show completely different special delivery information based on which rule they match.",
      },
      {
        id: "special-delivery-icon",
        title: "Icon & Styling",
        image: "/images/help/special-icon1.png",
        content: "Choose an icon from the preset library (Truck, Clock, Home, etc.) or use a custom SVG uploaded in the Icons page. Set the icon size (16-96px), vertical alignment (Top, Center, Bottom), and style (Solid or Outline for presets).\n\nBorder and text styling can be customised per-rule — override the global defaults with custom border thickness, radius, colours, background, and max width. Text colour, font size, and weight can be set independently for the header and message.",
      },
    ],
  },
  {
    id: "pricing-displays",
    title: "Pricing Displays",
    children: [
      {
        id: "pricing-displays-overview",
        title: "Overview",
        images: ["/images/help/pricing1.png", "/images/help/pricing2.png"],
        resultImage: "/images/help/pricing-actual1.png",
        content: "Pricing Displays let you show dynamic delivery pricing directly on product pages using the {pricing:name} placeholder in your message lines. Each pricing display has a name (used in the placeholder) — for example, creating a display called 'standard' means {pricing:standard} renders its pricing on the storefront. You can create up to 10 displays for different service levels and use them across different message lines or rules.",
      },
      {
        id: "pricing-levels",
        title: "Shipping Levels & Segments",
        image: "/images/help/shipping-levels1.png",
        content: "Each pricing display supports up to 3 shipping levels based on cart value thresholds. For example: Level 1 for carts under £20, Level 2 for £20-50, Level 3 for £50+. Each level shows different pricing.\n\nWithin each level, you define segments — each with a label (e.g., 'Standard', 'Express'), a cost, and optional delivery days. You can bold individual costs or days values, and choose divider characters (|, •, -, /, ›) between segments and before days.",
      },
      {
        id: "pricing-free-delivery",
        title: "Free Delivery Text & Cart Threshold",
        image: "/images/help/threshold1.png",
        content: "When a customer's cart meets your free delivery threshold, pricing can automatically switch to show a free delivery message. Enable the free delivery text option and customise the message — use {threshold} to display the qualifying amount (e.g., 'Free over {threshold}').\n\nThe Cart Threshold Message replaces the entire pricing line when the threshold is met. Leave it blank to use the default message. This is separate from the free delivery text within the pricing levels.",
      },
      {
        id: "pricing-loading",
        title: "Loading & Exclusions",
        image: "/images/help/loading1.png",
        content: "A loading placeholder is shown briefly while pricing is calculated — leave it blank for a skeleton shimmer animation instead of text.\n\nFor excluded products (matched by tag or handle in your exclusion rules), you can choose to either show a fallback message (e.g., 'Delivery calculated at checkout') or hide the delivery info entirely. When showing a message, you can enable subdued styling for a muted appearance.",
      },
    ],
  },
  {
    id: "announcement-bar",
    title: "Announcement Bar",
    children: [
      {
        id: "announcement-overview",
        title: "Overview",
        images: ["/images/help/announcement1.png", "/images/help/announcement2.png"],
        resultImages: ["/images/help/announcement-actual1.png", "/images/help/emailus-callus.png"],
        content: "Display a rotating announcement bar with progress messages ('Spend £X more for free delivery'), unlocked messages, and empty cart messages. Configure timers for each message type.",
      },
      {
        id: "announcement-messages",
        title: "Announcement Bar Messages",
        image: "/images/help/announce-messages1.png",
        content: "The announcement bar rotates between three message types based on the customer's cart:\n\n• Progress message — shown when the cart is below the free delivery threshold. Use {threshold} for the target amount and {remaining} for how much more they need to spend. A progress bar visually shows how close they are.\n\n• Unlocked message — shown when the cart meets or exceeds the free delivery threshold. Confirms free delivery has been unlocked.\n\n• Empty cart message — shown when the cart is empty. Use {threshold} to display the qualifying amount. Defaults to 'Free delivery on orders over {threshold}' if left blank and no additional messages are configured.\n\nEach message type has its own display timer controlling how long it shows before rotating to the next.",
      },
      {
        id: "announcement-additional",
        title: "Additional Messages",
        image: "/images/help/announce-additional1.png",
        content: "Add up to 3 custom rotating messages to the announcement bar alongside the delivery messages. These are great for promotions, return policies, or general store information — e.g., 'Free returns within 30 days' or 'New arrivals every week'.\n\nEach message has its own display timer (in seconds) controlling how long it shows before rotating to the next. Leave a message blank to skip that slot. Enable or disable all additional messages with the master toggle.",
      },
      {
        id: "announcement-utility",
        title: "Utility Links",
        image: "/images/help/announce-utility1.png",
        content: "Add left and right utility links to the announcement bar — e.g., 'Call us' with a tel: link, or 'Email us' with a mailto: link. Choose icons and labels for each.",
      },
      {
        id: "announcement-exclusions",
        title: "Exclusion Rules",
        image: "/images/help/announce-exclusions1.png",
        content: "Exclude specific products from free delivery by tag or handle. Each exclusion rule can have a custom announcement message. Leave the message blank for the default.",
      },
    ],
  },
  {
    id: "icons",
    title: "Custom Icons",
    children: [
      {
        id: "icons-overview",
        title: "Overview",
        image: "/images/help/icons1.png",
        content: "The app supports multiple icon types across delivery messages, ETA timeline, and the announcement bar. You can mix and match icon types within the same setup — for example, a preset icon on line 1 and a custom SVG on line 2.",
      },
      {
        id: "icons-preset",
        title: "Preset Icons",
        image: "/images/help/preset-icons1.png",
        content: "A built-in library of common delivery-related icons — Truck, Clock, Home, Pin, Gift, Shopping Bag, and more. Each preset icon supports Solid (filled) and Outline styles, and can be coloured using the icon colour picker.",
      },
      {
        id: "icons-emoji",
        title: "Emoji Icons",
        image: "/images/help/emojis1.png",
        content: "Use any emoji as a message line icon. Simply paste or type the emoji directly, or click any emoji in the picker to copy it. Emoji icons scale with the icon size setting and work across all browsers and devices.",
      },
      {
        id: "icons-custom-svg",
        title: "Custom SVG Uploads",
        image: "/images/help/custom-svg1.png",
        content: "Paste raw SVG code on the Icons page to create custom icons, ETA connectors, and utility link icons. Give each a name so it's easy to identify in the pickers. SVG icons support colour overrides — the app automatically replaces fill and stroke colours via the icon colour setting.\n\nCustom SVGs appear in icon picker dropdowns throughout the app:\n\n• Message line icons and Special Delivery icons\n• ETA timeline stage icons\n• ETA timeline connectors — use a custom SVG instead of the built-in styles (line, double-chevron, big-arrow, arrow-dot)\n• Announcement bar utility link icons — appear next to labels like 'Call us' or 'Email us'",
      },
      {
        id: "icons-custom-url",
        title: "Custom Icon URLs",
        image: "/images/help/custom-urls1.png",
        content: "Reference an external image by URL for use as an icon. This is useful for hosted brand assets or icons from a CDN. The image is rendered at the configured icon size. Note that URL-based icons don't support colour overrides like SVG icons do.",
      },
    ],
  },
];
