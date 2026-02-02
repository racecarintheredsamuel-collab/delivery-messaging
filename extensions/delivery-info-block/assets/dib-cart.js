(() => {
  // Prevent double-init
  if (window.__DIB_CART_INIT__) return;
  window.__DIB_CART_INIT__ = true;

  // Debug logging - enable via window.__DIB_DEBUG__ = true in console
  const debug = (...args) => {
    if (window.__DIB_DEBUG__) console.log("[DIB Cart]", ...args);
  };

  debug("Script loaded");

  // Strip **bold** markdown syntax (we don't render bold in cart)
  function stripMarkdownBold(text) {
    if (!text) return text;
    return text.replace(/\*\*/g, "");
  }

  // Get rules from config
  function getRules() {
    const configEl = document.getElementById("dib-cart-config");
    if (!configEl) {
      debug("No config element found");
      return [];
    }

    const rawContent = configEl.textContent;

    try {
      const config = JSON.parse(rawContent);

      // Handle v2 format (profiles)
      if (config.version === 2 && config.profiles) {
        const activeProfileId = config.activeProfileId;
        const profile = config.profiles.find((p) => p.id === activeProfileId) || config.profiles[0];
        return profile?.rules || [];
      }

      // v1 format
      return config.rules || [];
    } catch (e) {
      console.error("[DIB Cart] Failed to parse config:", e);
      return [];
    }
  }

  // Find matching rule for a product
  function findMatchingRule(productHandle, productTags, rules) {
    for (const rule of rules) {
      const match = rule.match || {};
      const settings = rule.settings || {};

      // Skip rules without cart_message text
      if (!settings.cart_message) {
        continue;
      }

      let handleMatch = false;
      let tagMatch = false;

      // Check product handle
      if (match.product_handles && match.product_handles.length > 0) {
        if (match.product_handles.includes(productHandle)) {
          handleMatch = true;
        }
      }

      // Check product tags
      if (match.tags && match.tags.length > 0) {
        for (const tag of match.tags) {
          if (productTags.includes(tag)) {
            tagMatch = true;
            break;
          }
        }
      }

      // Fallback rules match any product
      const isFallback = match.is_fallback === true || match.is_fallback === "true";

      // If either matches (or fallback), return this rule
      if (isFallback || handleMatch || tagMatch) {
        return rule;
      }
    }
    return null;
  }

  // --- Business day helpers (mirrors dib-countdown.js logic) ---
  const weekdayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function splitDays(v) {
    if (!v) return new Set();
    return new Set(String(v).split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
  }

  function formatETADate(d) { return months[d.getMonth()] + " " + d.getDate(); }

  function addDeliveryDays(startDate, numDays, noDeliveryDays) {
    const noSet = noDeliveryDays || new Set(["sat", "sun"]);
    let cur = new Date(startDate.getTime());
    let added = 0;
    let max = 60;
    while (added < numDays && max > 0) {
      cur = new Date(cur.getTime() + 86400000);
      if (!noSet.has(weekdayNames[cur.getDay()])) added++;
      max--;
    }
    return cur;
  }

  function getShippingDate(noDeliveryDays, leadTime = 0) {
    // Simplified: assume next business day (no cutoff/timezone in cart context)
    const now = new Date();
    let candidate = new Date(now.getTime() + 86400000);
    const closedSet = noDeliveryDays || new Set();
    let attempts = 14;
    let shippingDate = null;
    while (attempts > 0) {
      if (!closedSet.has(weekdayNames[candidate.getDay()])) {
        shippingDate = candidate;
        break;
      }
      candidate = new Date(candidate.getTime() + 86400000);
      attempts--;
    }
    if (!shippingDate) shippingDate = new Date(now.getTime() + 86400000);

    // Apply lead time: add X business days
    if (leadTime > 0) {
      let daysAdded = 0;
      let maxAttempts = 60;
      while (daysAdded < leadTime && maxAttempts > 0) {
        shippingDate = new Date(shippingDate.getTime() + 86400000);
        if (!closedSet.has(weekdayNames[shippingDate.getDay()])) {
          daysAdded++;
        }
        maxAttempts--;
      }
    }

    return shippingDate;
  }

  // Get global settings from config for courier no-delivery days
  function getGlobalSettings() {
    const configEl = document.getElementById("dib-cart-config");
    if (!configEl) return {};
    try {
      const config = JSON.parse(configEl.textContent);
      if (config.version === 2 && config.profiles) {
        // Global settings not stored in profiles, check top-level
        return config.globalSettings || {};
      }
      return config.globalSettings || {};
    } catch { return {}; }
  }

  // Replace {arrival} and {express} placeholders with calculated delivery dates
  function replaceDatePlaceholders(text, settings) {
    if (!text) return text;
    if (!text.includes('{arrival}') && !text.includes('{express}')) return text;

    const gs = getGlobalSettings();
    // Check if rule overrides each setting separately
    const useLeadTimeOverride = settings.override_lead_time === true || settings.override_lead_time === 'true';
    const useCourierOverride = settings.override_courier_no_delivery_days === true || settings.override_courier_no_delivery_days === 'true';
    // Get courier no-delivery days - use rule override if set, otherwise global
    const courierNoDeliveryArr = useCourierOverride && settings.courier_no_delivery_days
      ? settings.courier_no_delivery_days
      : gs.courier_no_delivery_days;
    const courierNoDelivery = splitDays(
      Array.isArray(courierNoDeliveryArr) ? courierNoDeliveryArr.join(",") : (courierNoDeliveryArr || "sat,sun")
    );
    // Get lead time - use rule override if set, otherwise global
    const leadTime = useLeadTimeOverride
      ? (parseInt(settings.lead_time) || parseInt(gs.lead_time) || 0)
      : (parseInt(gs.lead_time) || 0);
    const shippingDate = getShippingDate(splitDays(
      Array.isArray(gs.closed_days) ? gs.closed_days.join(",") : (gs.closed_days || "")
    ), leadTime);

    if (text.includes('{arrival}')) {
      const deliveryMin = parseInt(settings.eta_delivery_days_min) || 3;
      const deliveryMax = parseInt(settings.eta_delivery_days_max) || 5;
      const minDate = addDeliveryDays(shippingDate, deliveryMin, courierNoDelivery);
      const maxDate = addDeliveryDays(shippingDate, deliveryMax, courierNoDelivery);
      let arrivalText;
      if (deliveryMin === deliveryMax) {
        arrivalText = formatETADate(minDate);
      } else if (minDate.getMonth() === maxDate.getMonth()) {
        arrivalText = formatETADate(minDate) + "-" + maxDate.getDate();
      } else {
        arrivalText = formatETADate(minDate) + "-" + formatETADate(maxDate);
      }
      text = text.replace('{arrival}', arrivalText);
    }

    if (text.includes('{express}')) {
      const expressDate = addDeliveryDays(shippingDate, 1, courierNoDelivery);
      text = text.replace('{express}', formatETADate(expressDate));
    }

    return text;
  }

  // Create message element
  function createMessageElement(text) {
    const div = document.createElement("div");
    div.className = "dib-cart-message";
    // Apply inline styles as fallback in case CSS doesn't load
    div.style.cssText = "color: #6b7280; font-size: 0.7em; font-weight: 600; margin-top: 4px; line-height: 1.4;";
    div.textContent = stripMarkdownBold(text);
    return div;
  }

  // Find cart line item containers - tries multiple common selectors
  // Includes selectors for both full-page carts and slide-out/drawer carts
  function findCartLineItems() {
    const selectors = [
      // Dawn and modern themes - full page cart
      'cart-items .cart-item',
      '.cart-items .cart-item',
      '[data-cart-item]',
      '.cart__item',
      '.cart-item',
      // Slide-out / drawer carts
      'cart-drawer .cart-item',
      '.cart-drawer .cart-item',
      '.drawer__cart .cart-item',
      '.cart-drawer-item',
      '.mini-cart .cart-item',
      '.mini-cart__item',
      '.ajaxcart__product',
      '.cart-drawer__item',
      '[data-cart-drawer] .cart-item',
      '[data-cart-drawer] [data-cart-item]',
      'cart-drawer-items .cart-item',
      // Older themes
      '.cart__row',
      '.cart-row',
      'tr.cart__row',
      // Generic table-based carts
      '.cart table tbody tr',
      '.cart-table tbody tr',
      // Line item wrappers
      '.line-item',
      '.cart-line-item',
      'line-item',
    ];

    const allItems = new Set();
    for (const selector of selectors) {
      const items = document.querySelectorAll(selector);
      items.forEach(item => allItems.add(item));
    }
    return Array.from(allItems);
  }

  // Extract product handle from a cart line item element
  function extractProductHandle(lineItem) {
    // Try data attribute
    const handle = lineItem.dataset.productHandle || lineItem.dataset.handle;
    if (handle) return handle;

    // Try finding a link to the product
    const productLink = lineItem.querySelector('a[href*="/products/"]');
    if (productLink) {
      const match = productLink.href.match(/\/products\/([^?#/]+)/);
      if (match) return match[1];
    }

    // Try finding product URL in various attributes
    const elementsWithHref = lineItem.querySelectorAll("[href]");
    for (const el of elementsWithHref) {
      const match = el.getAttribute("href")?.match(/\/products\/([^?#/]+)/);
      if (match) return match[1];
    }

    return null;
  }

  // Find where to inject the message within a line item
  function findInjectionPoint(lineItem) {
    const selectors = [
      ".cart-item__details",
      ".cart-item__info",
      ".cart__item-details",
      ".product-info",
      ".item-info",
      ".line-item__details",
      ".cart-item__content",
      ".cart-drawer-item__details",
      ".mini-cart__item-details",
      // For table-based carts
      "td.cart__meta",
      "td.product-details",
      "td:nth-child(2)",
    ];

    for (const selector of selectors) {
      const el = lineItem.querySelector(selector);
      if (el) return el;
    }

    // Fallback: just use the line item itself
    return lineItem;
  }

  // Cache for product tags to avoid repeated API calls
  const productTagsCache = {};

  // Fetch product tags
  async function fetchProductTags(handle) {
    if (productTagsCache[handle]) {
      return productTagsCache[handle];
    }

    try {
      const response = await fetch(`/products/${handle}.json`);
      if (!response.ok) return [];
      const data = await response.json();
      const tags = data.product?.tags?.split(", ") || [];
      productTagsCache[handle] = tags;
      return tags;
    } catch (e) {
      console.error("[DIB Cart] Failed to fetch product:", handle, e);
      return [];
    }
  }

  // Main injection function
  async function injectCartMessages() {
    const rules = getRules();
    if (rules.length === 0) return;

    // Check if any rules have cart_message enabled
    const hasCartRules = rules.some(
      (r) => r.settings?.cart_message && r.settings.cart_message !== "none"
    );
    if (!hasCartRules) return;

    const lineItems = findCartLineItems();
    if (lineItems.length === 0) return;

    debug("Found", lineItems.length, "cart line items");

    for (const lineItem of lineItems) {
      // Skip if already processed
      if (lineItem.dataset.dibProcessed) continue;
      lineItem.dataset.dibProcessed = "true";

      const handle = extractProductHandle(lineItem);
      if (!handle) continue;

      // Fetch product tags
      const tags = await fetchProductTags(handle);

      // Find matching rule
      const rule = findMatchingRule(handle, tags, rules);
      if (!rule) continue;

      // Get message text and replace {arrival} placeholder
      const settings = rule.settings || {};
      const messageText = settings.cart_message ? replaceDatePlaceholders(settings.cart_message, settings) : null;
      if (!messageText) continue;

      // Create and inject message
      const messageEl = createMessageElement(messageText);
      const injectionPoint = findInjectionPoint(lineItem);

      // Remove any existing message (in case of re-injection)
      const existing = lineItem.querySelector(".dib-cart-message");
      if (existing) existing.remove();

      injectionPoint.appendChild(messageEl);
      debug("Message injected for:", handle);
    }
  }

  // Run on page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectCartMessages);
  } else {
    injectCartMessages();
  }

  // Watch for cart updates (AJAX carts, slide-out carts, etc.)
  const observer = new MutationObserver((mutations) => {
    let shouldRerun = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // Check if any added nodes might be cart-related
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            // Check if it's a cart container or contains cart items
            if (
              el.matches?.('[data-cart], [data-cart-drawer], .cart, .cart-drawer, .mini-cart, cart-drawer, cart-items') ||
              el.querySelector?.('[data-cart-item], .cart-item, .cart__item, .line-item')
            ) {
              shouldRerun = true;
              break;
            }
          }
        }
      }
      if (shouldRerun) break;
    }
    if (shouldRerun) {
      // Debounce
      clearTimeout(window.__DIB_CART_DEBOUNCE__);
      window.__DIB_CART_DEBOUNCE__ = setTimeout(injectCartMessages, 150);
    }
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also listen for common cart drawer events
  document.addEventListener('cart:open', injectCartMessages);
  document.addEventListener('cart:updated', injectCartMessages);
  document.addEventListener('cart-drawer:open', injectCartMessages);

  // Handle Shopify's native cart drawer for Dawn theme
  document.addEventListener('click', (e) => {
    const cartTrigger = e.target.closest('[data-cart-trigger], .cart-icon-bubble, [href="/cart"]');
    if (cartTrigger) {
      // Delay to allow drawer to open
      setTimeout(injectCartMessages, 300);
    }
  });

  // Handle history navigation (back/forward buttons, client-side navigation)
  window.addEventListener('popstate', () => {
    setTimeout(injectCartMessages, 100);
  });

  // Some themes use custom events
  window.addEventListener('cart:refresh', injectCartMessages);
  window.addEventListener('ajaxCart:afterCartLoad', injectCartMessages);
})();
