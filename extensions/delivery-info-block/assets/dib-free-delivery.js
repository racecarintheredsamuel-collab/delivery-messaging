(function() {
  'use strict';
  // v453 - Cart page: shell visible immediately, message fades (no jerky layout)

  // Prevent double initialization
  if (window.__DIB_FD_INIT__) return;
  window.__DIB_FD_INIT__ = true;

  // Debounce timer for cart page updates (waits for Impulse to finish)
  let cartPageDebounceTimer = null;

  const debug = (...args) => {
    if (window.__DIB_DEBUG__) console.log('[DIB FD]', ...args);
  };

  // Cart page selectors (in priority order)
  const CART_PAGE_SELECTORS = [
    // Impulse cart page form (excludes drawer)
    '#CartPageForm',
    // Generic cart page form (excludes drawer forms)
    'form[action="/cart"]:not(.cart-drawer__form):not(#CartDrawer-Form)',
    // Theme-specific containers
    '.cart-page',  // Prestige theme
    '.cart__items',
    '.cart-items',
    'cart-items',
    '[data-cart-items]',
    '.cart-form',
    '#cart',
    '.cart',
    '[data-cart]',
    // Fallback
    'form[action="/cart"]'
  ];

  // Cart drawer selectors (in priority order)
  const CART_DRAWER_SELECTORS = [
    // Dawn theme specific
    'cart-drawer[open] .drawer__inner',
    'cart-drawer[open] cart-drawer-items',
    'cart-drawer[open]',
    // Generic cart drawer selectors
    'cart-drawer .drawer__inner',
    'cart-drawer .cart-drawer__inner',
    'cart-drawer',
    '.cart-drawer .drawer__inner',
    '.cart-drawer__inner',
    '.cart-drawer',
    '[data-cart-drawer] .drawer__inner',
    '[data-cart-drawer]',
    // Impulse theme (uses #CartDrawer, not cart-drawer element)
    '#CartDrawer',
    '[data-location="cart-drawer"]',
    '.drawer--right',
    // Other themes
    '.mini-cart__inner',
    '.mini-cart',
    '.drawer__cart',
    '.side-cart__inner',
    '.side-cart',
    '.ajaxcart__inner',
    '.ajaxcart',
    '.cart-popup__inner',
    '.cart-popup'
  ];

  // Track injected containers to avoid duplicates
  const injectedContainers = new WeakSet();

  // Guard against re-entrant calls from MutationObserver
  let isUpdatingBar = false;

  // Inject CSS to hide bar when cart is empty (multiple theme patterns)
  function injectEmptyCartCSS() {
    if (document.getElementById('dib-fd-empty-css')) return;
    const style = document.createElement('style');
    style.id = 'dib-fd-empty-css';
    style.textContent = `
      /* Dawn theme */
      cart-drawer.is-empty .dib-fd-bar,
      /* Common empty state classes */
      .cart-drawer.is-empty .dib-fd-bar,
      .cart-drawer--empty .dib-fd-bar,
      [data-cart-empty="true"] .dib-fd-bar,
      .drawer.is-empty .dib-fd-bar,
      /* Hide when empty content is shown */
      .drawer__inner-empty ~ .dib-fd-bar,
      .cart-drawer__empty-content ~ .dib-fd-bar {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
    debug('Injected empty cart CSS');
  }

  // Detect Maestrooo themes (Prestige, Warehouse) - they use aggressive DOM diffing
  function isMaestroooTheme() {
    // Prestige: uses slot attributes in cart-drawer
    if (document.querySelector('cart-drawer [slot="header"], cart-drawer [slot="footer"]')) {
      return 'prestige';
    }
    // Warehouse: body class contains warehouse--
    if (document.body.className.includes('warehouse--')) {
      return 'warehouse';
    }
    return false;
  }

  // Get config from the embed
  function getConfig() {
    const configEl = document.getElementById('dib-fd-config');
    if (!configEl) return null;

    return {
      showProgressBar: configEl.dataset.showProgressBar !== 'false',
      progressBarColor: configEl.dataset.progressBarColor || '#22c55e',
      progressBarBg: configEl.dataset.progressBarBg || '#e5e7eb',
      barBgColor: configEl.dataset.barBgColor || '#f9fafb',
      barTextColor: configEl.dataset.barTextColor || '#374151',
      barBorderWidth: configEl.dataset.barBorderWidth || '0',
      barBorderRadius: configEl.dataset.barBorderRadius || '8',
      barBorderColor: configEl.dataset.barBorderColor || '#e5e7eb'
    };
  }

  // Create the free delivery bar element with inline styles for reliability
  // initialContent: optional - if provided, use instead of skeleton (for re-injection)
  function createBarElement(config, initialContent) {
    const bar = document.createElement('div');
    bar.className = 'dib-fd-bar';
    bar.id = 'dib-fd-bar';  // Stable ID for DOM morphers
    bar.setAttribute('im-preserve', 'true');  // idiomorph preservation
    bar.setAttribute('data-morph-preserve', 'true');  // general morph preservation
    bar.setAttribute('data-dm-target', '');
    bar.setAttribute('data-dm-state', 'init');
    bar.setAttribute('data-dm-celebrated', '');
    // Inline styles to ensure rendering regardless of stylesheet loading
    // Shell (background + progress track) is always visible - only message content transitions
    bar.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 16px;
      background: ${config.barBgColor};
      border-radius: ${config.barBorderRadius}px;
      border: ${config.barBorderWidth}px solid ${config.barBorderColor};
      font-size: 14px;
      line-height: 1.4;
      z-index: 10;
      width: 100%;
      box-sizing: border-box;
    `.replace(/\s+/g, ' ');

    const message = document.createElement('div');
    message.className = 'dib-fd-message';
    message.setAttribute('data-dm-message', '');
    // Message starts visible; delivery-messaging.js handles all transitions
    message.style.cssText = `text-align: center; font-weight: 500; color: ${config.barTextColor}; min-height: 20px; opacity: 1; transition: opacity 150ms ease-in;`;
    // Use initial content if provided (re-injection), otherwise skeleton
    message.innerHTML = initialContent || '<div class="dib-fd-skeleton-text"></div>';
    bar.appendChild(message);

    if (config.showProgressBar) {
      // Calculate initial percent from current cart state to avoid 0% flash on re-injection
      let initialPercent = 0;
      if (window.DeliveryMessaging) {
        const dmState = window.DeliveryMessaging.getState();
        const dmConfig = window.DeliveryMessaging.getConfig();
        if (dmConfig.threshold > 0) {
          initialPercent = Math.min(100, (dmState.cartTotal / dmConfig.threshold) * 100);
        }
      }
      // Single element with gradient - no nested divs that can have height issues
      const progressBar = document.createElement('div');
      progressBar.className = 'dib-fd-progress';
      progressBar.setAttribute('data-dm-progress', '');
      progressBar.setAttribute('data-bg', config.progressBarBg);
      progressBar.setAttribute('data-fg', config.progressBarColor);
      progressBar.style.cssText = `
        display: block;
        width: 100%;
        height: 8px;
        border-radius: 4px;
        transition: background 0.3s;
        background: linear-gradient(to right, ${config.progressBarColor} ${initialPercent}%, ${config.progressBarBg} ${initialPercent}%);
      `.replace(/\s+/g, ' ');
      bar.appendChild(progressBar);
    }

    return bar;
  }

  // Find and inject into a container
  // initialContent: optional - if provided, bar starts with this content instead of skeleton
  function injectIntoContainer(container, position = 'prepend', initialContent = null) {
    if (!container) return false;

    const config = getConfig();
    if (!config) return false;

    // Maestrooo themes (Prestige, Warehouse) use DOM diffing - skip ALL injection
    const maestroooTheme = isMaestroooTheme();
    if (maestroooTheme) {
      debug(maestroooTheme + ' theme detected, skipping injection (DOM diffing incompatible)');
      return false;
    }

    // For drawers, check if bar already exists anywhere in the drawer
    const drawerRoot = container.closest('cart-drawer') || (container.matches && container.matches('cart-drawer') ? container : null);
    const checkContainer = drawerRoot || container;
    if (checkContainer.querySelector('.dib-fd-bar')) return false;

    // Create bar element
    const bar = createBarElement(config, initialContent);

    // For cart drawers, try theme-specific positioning first
    const isInDrawer = drawerRoot || container.matches('cart-drawer, .cart-drawer, [data-cart-drawer], #CartDrawer, .drawer--right');
    if (isInDrawer) {
      // Check if cart has items - hide bar if empty to prevent layout conflicts
      const hasItems = checkCartHasItems(checkContainer);
      if (!hasItems) {
        bar.style.display = 'none';
        debug('Cart empty, hiding bar');
      }

      // Center the bar with auto margins
      bar.style.width = 'calc(100% - 24px)';
      bar.style.margin = '0 auto 12px auto';

      const searchRoot = drawerRoot || container;

      // Impulse-specific: prepend inside .drawer__scrollable
      if (searchRoot.id === 'CartDrawer' || searchRoot.closest('#CartDrawer')) {
        const scrollable = searchRoot.querySelector('.drawer__scrollable');
        if (scrollable) {
          scrollable.insertBefore(bar, scrollable.firstChild);
          injectedContainers.add(searchRoot);
          debug('Injected bar (Impulse scrollable):', scrollable.className);
          setupBarObservers(bar, searchRoot, position);
          triggerUpdate();
          return true;
        }
      }

      // Try common header container selectors (most reliable)
      const headerSelectors = [
        '.drawer__header',
        '.cart-drawer__header',
        '[slot="header"]',  // Prestige theme
        '[class*="cart-drawer"] > header',
        '.cart-drawer header',
        '[class*="drawer"] > header',
        'header[class*="cart"]',
        'header[class*="drawer"]'
      ];
      for (const selector of headerSelectors) {
        const headerEl = searchRoot.querySelector(selector);
        if (headerEl) {
          headerEl.insertAdjacentElement('afterend', bar);
          injectedContainers.add(searchRoot);
          debug('Injected bar after header container:', selector);
          setupBarObservers(bar, searchRoot, position);
          triggerUpdate();
          return true;
        }
      }

      // Fallback: find heading by common cart text
      const cartHeadingTexts = ['your cart', 'cart', 'shopping cart', 'your bag', 'bag'];
      const headingTags = searchRoot.querySelectorAll('h1, h2, h3, h4, h5, h6, .h1, .h2, .h3, .h4, .h5, .h6, [class*="heading"], [class*="title"], .drawer__heading, .cart-drawer__heading');
      for (const el of headingTags) {
        const text = el.textContent?.trim().toLowerCase();
        if (text && cartHeadingTexts.some(t => text === t || text.startsWith(t))) {
          // Traverse up to find outermost flex container - ensures we insert BELOW the entire header
          let insertTarget = el;
          let current = el;
          while (current.parentElement && current.parentElement !== searchRoot) {
            const parentStyle = window.getComputedStyle(current.parentElement);
            const isFlexContainer = parentStyle.display === 'flex' || parentStyle.display === 'inline-flex';
            if (isFlexContainer) {
              // Parent is a flex container, so current element is a flex item
              // Move up to insert after the flex container instead
              insertTarget = current.parentElement;
              current = current.parentElement;
              debug('Found flex container, moving up:', insertTarget.className || insertTarget.tagName);
            } else {
              // Parent is not a flex container, we've exited flex nesting
              break;
            }
          }
          // Ensure proper block layout
          bar.style.width = 'calc(100% - 24px)';
          bar.style.margin = '0 auto 12px auto';
          insertTarget.insertAdjacentElement('afterend', bar);
          injectedContainers.add(searchRoot);
          debug('Injected bar after cart heading (universal):', text);
          setupBarObservers(bar, searchRoot, position);
          triggerUpdate();
          return true;
        }
      }

      // Fallback: use absolute positioning for unknown themes
      const containerStyle = window.getComputedStyle(container);
      if (containerStyle.position === 'static') {
        container.style.position = 'relative';
      }
      bar.style.position = 'absolute';
      bar.style.top = '0';
      bar.style.left = '0';
      bar.style.right = '0';
      const currentPadding = parseInt(containerStyle.paddingTop) || 0;
      if (currentPadding < 90) {
        container.style.paddingTop = '90px';
      }
      container.insertBefore(bar, container.firstChild);
      injectedContainers.add(container);
      debug('Injected bar (fallback absolute):', container.className || container.tagName);
    } else {
      // Cart page - shell visible immediately, message fades via delivery-messaging.js
      bar.style.margin = '12px 0';
      bar.classList.add('dib-fd-cart-page');
      if (position === 'prepend') {
        container.insertBefore(bar, container.firstChild);
      } else {
        container.appendChild(bar);
      }
      injectedContainers.add(container);
      debug('Injected bar into cart page:', container.className || container.tagName);
    }

    setupBarObservers(bar, container, position);
    triggerUpdate();
    return true;
  }

  // Set up observers for bar removal and drawer state
  function setupBarObservers(bar, container, position) {
    // Guard against invalid container (prevents MutationObserver error)
    if (!container || !container.nodeType) {
      debug('setupBarObservers: invalid container, skipping');
      return;
    }

    // Watch for the bar being removed (theme re-renders) and re-inject
    const barObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const removed of mutation.removedNodes) {
          if (removed === bar || (removed.nodeType === Node.ELEMENT_NODE && removed.contains && removed.contains(bar))) {
            barObserver.disconnect();

            // Check if container is still in the DOM - if not, find fresh container
            if (!document.body.contains(container)) {
              debug('Container detached from DOM, scanning for fresh container');
              setTimeout(scanAndInject, 100);
              return;
            }

            // Preserve state from old bar BEFORE checking isInDrawer
            const oldState = bar.dataset.dmState;
            const oldCelebrated = bar.dataset.dmCelebrated;

            // For CART PAGE bars (not drawers), don't re-inject here
            // Let cart:updated event + scanAndInject handle it after Impulse finishes Section Rendering
            const isInDrawer = container.closest('cart-drawer') || container.matches?.('cart-drawer') ||
                               container.closest('#CartDrawer') || container.id === 'CartDrawer';
            if (!isInDrawer) {
              debug('Cart page bar removed - waiting for cart:updated to re-inject');
              // Store state globally so it can be restored after re-injection
              // Also capture if celebration was interrupted (bar destroyed mid-animation)
              const celebrationInterrupted = window.__DIB_CELEBRATION_IN_PROGRESS__;
              window.__DIB_CART_PAGE_BAR_STATE__ = { oldState, oldCelebrated, celebrationInterrupted };
              window.__DIB_CELEBRATION_IN_PROGRESS__ = false;
              return;
            }

            // Don't re-inject if cart is empty - just let it stay removed
            const drawerRoot = container.closest('cart-drawer') || container;
            if (!checkCartHasItems(drawerRoot)) {
              debug('Cart empty, not re-injecting bar');
              return;
            }

            // Capture OLD content from the destroyed bar - this is what was VISIBLE
            const oldMessageEl = bar.querySelector('[data-dm-message]');
            const oldContent = oldMessageEl ? oldMessageEl.innerHTML : null;

            // Re-inject only if cart has items
            debug('Container still valid, re-injecting');

            // Use OLD content (what was visible) so animation can transition TO new content
            const hasRealContent = oldContent && !oldContent.includes('dib-fd-skeleton');
            debug('Using old content for re-injection:', hasRealContent ? 'yes' : 'no');

            // Pass old content so bar starts with it, then updateTarget will animate to new
            injectIntoContainer(container, position, hasRealContent ? oldContent : null);

            // Restore state to new bar - but only if state hasn't changed
            // This allows celebration to trigger on progress → unlocked transition
            const newBar = drawerRoot.querySelector('.dib-fd-bar');
            if (newBar && oldState) {
              const currentState = window.DeliveryMessaging ? window.DeliveryMessaging.getState() : null;
              const stateChanged = currentState && (oldState === 'progress' && currentState.unlocked);

              if (!stateChanged) {
                // State same - restore to prevent double-celebration
                newBar.dataset.dmState = oldState;
                newBar.dataset.dmCelebrated = oldCelebrated;
                debug('Restored bar state:', oldState, 'celebrated:', oldCelebrated);
              } else {
                // State changed (progress → unlocked) - SET progress state so celebration can trigger
                // updateTarget() checks wasProgress = (dmState === 'progress'), so we must set it
                newBar.dataset.dmState = 'progress';
                newBar.dataset.dmCelebrated = '';
                debug('State changed, set to progress for celebration');
              }
            }

            // Trigger update to refresh bar with current cart data
            // Note: Don't set __DIB_DRAWER_OPENING__ here - that flag is only for
            // drawer OPENING, not for normal cart updates. We want crossfade animations.
            debug('Re-injection complete, triggering update for fresh data');
            triggerUpdate();

            return;
          }
        }
      }
    });
    barObserver.observe(container, { childList: true, subtree: true });

    // Watch for drawer opening/closing - only control pointerEvents, let delivery-messaging.js handle opacity
    const cartDrawer = container.closest('cart-drawer') || document.querySelector('cart-drawer');
    if (cartDrawer) {
      const drawerObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'open') {
            if (cartDrawer.hasAttribute('open')) {
              debug('Drawer opening');
              bar.style.pointerEvents = '';
              // Trigger update to ensure message is visible
              if (window.DeliveryMessaging && window.DeliveryMessaging.forceUpdate) {
                window.DeliveryMessaging.forceUpdate();
              }
            } else {
              debug('Drawer closing');
              bar.style.pointerEvents = 'none';
            }
          }
        }
      });
      drawerObserver.observe(cartDrawer, { attributes: true, attributeFilter: ['open'] });
    }
  }

  // Trigger DeliveryMessaging to update the new target
  function triggerUpdate() {
    if (window.DeliveryMessaging) {
      // Skip if no bar exists on page (prevents animation error on detached element)
      if (!document.querySelector('.dib-fd-bar')) {
        debug('triggerUpdate skipped - no bar exists');
        return;
      }
      // Refresh to get fresh cart data
      if (window.DeliveryMessaging.refresh) {
        window.DeliveryMessaging.refresh();
      }
      // Multiple delayed forceUpdate calls to catch fresh data when it arrives
      [200, 400, 700].forEach(function(delay) {
        setTimeout(function() {
          if (window.DeliveryMessaging && window.DeliveryMessaging.forceUpdate) {
            window.DeliveryMessaging.forceUpdate();
          }
        }, delay);
      });
    }
  }

  // Debounced cart page update - waits for Impulse to finish ALL updates before triggering
  // This prevents early stale updates from blocking correct updates via "fade in progress"
  function debouncedCartPageUpdate() {
    if (cartPageDebounceTimer) clearTimeout(cartPageDebounceTimer);
    cartPageDebounceTimer = setTimeout(function() {
      debug('Debounced cart page update firing');
      scanAndInject();
      reattachCartPageObserver();
      if (document.querySelector('.dib-fd-bar')) {
        triggerUpdate();
      }
    }, 500);
  }

  // Find cart page container
  function findCartPageContainer() {
    // Only on /cart page
    if (!window.location.pathname.includes('/cart')) return null;

    // Maestrooo themes (Prestige, Warehouse) use DOM diffing - skip cart page injection
    const maestroooTheme = isMaestroooTheme();
    if (maestroooTheme) {
      debug(maestroooTheme + ' theme detected, skipping cart page injection (DOM diffing incompatible)');
      return null;
    }

    for (const selector of CART_PAGE_SELECTORS) {
      const container = document.querySelector(selector);
      // Skip if inside a drawer - we want the actual cart page, not drawer form
      if (container && !container.closest('cart-drawer, .cart-drawer, [data-cart-drawer]')) {
        debug('Found cart page container:', selector);
        return container;
      }
    }
    return null;
  }

  // Find cart drawer container (only when visible/open)
  function findCartDrawerContainer() {
    for (const selector of CART_DRAWER_SELECTORS) {
      const container = document.querySelector(selector);
      if (container && isVisible(container)) {
        debug('Found cart drawer container:', selector);
        return container;
      }
    }
    return null;
  }

  // Pre-inject into closed drawers to prevent layout shift when opening
  function preInjectIntoClosedDrawers() {
    const config = getConfig();
    if (!config) return;

    // Find cart-drawer even when closed (Dawn)
    const cartDrawer = document.querySelector('cart-drawer');
    if (cartDrawer && !cartDrawer.querySelector('.dib-fd-bar')) {
      debug('Pre-injecting into closed cart-drawer');
      injectIntoContainer(cartDrawer, 'prepend');
    }

    // Also check Impulse's #CartDrawer
    const impulseDrawer = document.getElementById('CartDrawer');
    if (impulseDrawer && !impulseDrawer.querySelector('.dib-fd-bar')) {
      debug('Pre-injecting into Impulse #CartDrawer');
      injectIntoContainer(impulseDrawer, 'prepend');
    }
  }

  // Check if element is visible
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);

    // Basic visibility checks
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    // Dawn's cart-drawer uses 'open' attribute when visible
    if (el.tagName === 'CART-DRAWER' || el.closest('cart-drawer')) {
      const drawer = el.tagName === 'CART-DRAWER' ? el : el.closest('cart-drawer');
      return drawer.hasAttribute('open') || drawer.classList.contains('is-open') || drawer.classList.contains('active');
    }

    // For fixed/absolute positioned elements, offsetParent is null but they can still be visible
    if (style.position === 'fixed' || style.position === 'absolute') {
      return true; // Already passed display/visibility checks above
    }

    return el.offsetParent !== null;
  }

  // Check if cart has items (for drawer visibility logic)
  function checkCartHasItems(container) {
    // Dawn: check cart-drawer-items for .cart-item elements
    const cartItems = container.querySelector('cart-drawer-items');
    if (cartItems) {
      return !!cartItems.querySelector('.cart-item, cart-item, [data-cart-item]');
    }
    // Fallback: check for any cart item indicators
    return !!container.querySelector('.cart-item, [data-cart-item], .cart__item');
  }

  // Update bar visibility based on cart state (called on cart changes)
  function updateBarVisibility() {
    if (isUpdatingBar) return;  // Prevent infinite loop from MutationObserver
    isUpdatingBar = true;

    try {
      document.querySelectorAll('.dib-fd-bar').forEach(function(bar) {
        const drawer = bar.closest('cart-drawer');
        if (!drawer) return; // Only for drawer bars

        const hasItems = checkCartHasItems(drawer);
        const wasHidden = bar.style.visibility === 'hidden';

        if (hasItems) {
          // If bar was hidden (empty cart) and now showing, re-inject for correct position
          // This ensures positioning logic runs with current DOM state (with items)
          if (wasHidden) {
            debug('Cart now has items, re-injecting bar for correct position');
            // Preserve state from old bar for animation continuity
            const oldState = bar.dataset.dmState;
            const oldCelebrated = bar.dataset.dmCelebrated;
            // Reset visibility styles before removing
            bar.style.visibility = '';
            bar.style.height = '';
            bar.style.overflow = '';
            bar.style.padding = '';
            bar.style.margin = '';
            bar.remove();
            injectIntoContainer(drawer, 'prepend');
            // Restore state to new bar so animations can trigger correctly
            const newBar = drawer.querySelector('.dib-fd-bar');
            if (newBar && oldState) {
              newBar.dataset.dmState = oldState;
              newBar.dataset.dmCelebrated = oldCelebrated;
              debug('Restored bar state:', oldState, 'celebrated:', oldCelebrated);
            }
            return;
          }
          // Otherwise just show
          bar.style.display = 'flex';
        } else {
          // Hide INSTANTLY with visibility (no render frame delay)
          // Using visibility + height collapse prevents any visual flash
          bar.style.visibility = 'hidden';
          bar.style.height = '0';
          bar.style.overflow = 'hidden';
          bar.style.padding = '0';
          bar.style.margin = '0';
        }
      });
    } finally {
      isUpdatingBar = false;
    }
  }

  // Scan and inject
  function scanAndInject() {
    const config = getConfig();
    if (!config) return;

    // Cart page
    const cartPage = findCartPageContainer();
    if (cartPage) {
      injectIntoContainer(cartPage, 'prepend');

      // Restore state from previous bar if available (for celebration continuity)
      if (window.__DIB_CART_PAGE_BAR_STATE__) {
        const { oldState, oldCelebrated, celebrationInterrupted } = window.__DIB_CART_PAGE_BAR_STATE__;
        const newBar = cartPage.querySelector('.dib-fd-bar');
        if (newBar) {
          const currentState = window.DeliveryMessaging ? window.DeliveryMessaging.getState() : null;
          // Trigger celebration if:
          // 1. Normal transition: was progress, now unlocked
          // 2. Interrupted celebration: celebration was running when bar was destroyed
          const shouldCelebrate = currentState && currentState.unlocked && (
            oldState === 'progress' ||
            celebrationInterrupted
          );

          if (shouldCelebrate) {
            newBar.dataset.dmState = 'progress';
            newBar.dataset.dmCelebrated = '';
            debug('Cart page bar: set to progress for celebration');
          } else if (oldState) {
            newBar.dataset.dmState = oldState;
            newBar.dataset.dmCelebrated = oldCelebrated || '';
            debug('Cart page bar: restored state', oldState);
          }
        }
        window.__DIB_CART_PAGE_BAR_STATE__ = null;
      }
    }

    // Cart drawer
    const cartDrawer = findCartDrawerContainer();
    if (cartDrawer) {
      injectIntoContainer(cartDrawer, 'prepend');
    }
  }

  // Watch for drawer opening
  function watchForDrawers() {
    // MutationObserver to detect drawer becoming visible
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;

      for (const mutation of mutations) {
        // Check for added nodes that might be drawers
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node;
              if (el.matches && (
                el.matches('cart-drawer, .cart-drawer, [data-cart-drawer], .mini-cart, .side-cart') ||
                el.querySelector && el.querySelector('cart-drawer, .cart-drawer, [data-cart-drawer], .mini-cart, .side-cart')
              )) {
                shouldScan = true;
                break;
              }
            }
          }
        }

        // Check for attribute changes (drawer opening via class/attribute toggle)
        if (mutation.type === 'attributes') {
          const el = mutation.target;
          // Dawn's cart-drawer gets 'open' attribute when opened
          if (el.tagName === 'CART-DRAWER' && mutation.attributeName === 'open' && el.hasAttribute('open')) {
            debug('Dawn cart-drawer opened');
            shouldScan = true;
          }
          // Generic drawer detection
          else if (el.matches && el.matches('cart-drawer, .cart-drawer, [data-cart-drawer], .mini-cart, .side-cart, [data-drawer]')) {
            shouldScan = true;
          }
        }

        if (shouldScan) break;
      }

      if (shouldScan) {
        // Debounce the scan
        clearTimeout(window.__DIB_FD_SCAN_TIMER__);
        window.__DIB_FD_SCAN_TIMER__ = setTimeout(scanAndInject, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'open', 'data-open', 'aria-hidden', 'style']
    });

    // Also listen for common cart drawer events
    const drawerEvents = [
      'cart:open',
      'cart:updated',
      'cart-drawer:open',
      'drawer:open',
      'ajaxCart:afterCartLoad',
      'cart:refresh',
      // Shopify/Dawn specific
      'theme:cart:refresh',
      'cart:item-added',
      'shopify:section:load'
    ];

    drawerEvents.forEach(eventName => {
      document.addEventListener(eventName, () => {
        debug('Event fired:', eventName);
        setTimeout(scanAndInject, 150);
        // For cart update events, also refresh bar content
        // NOTE: Removed cart:updated - it fires BEFORE server processes update, causing stale data
        // MutationObserver on #CartPageForm fires AFTER and has correct timing
        if (eventName === 'cart:refresh' || eventName === 'theme:cart:refresh') {
          triggerUpdate();
        }
      });
    });

    // Listen for Archetype ajaxProduct:added (Impulse, Motion, etc.)
    document.addEventListener('ajaxProduct:added', () => {
      debug('Archetype ajaxProduct:added event');
      setTimeout(scanAndInject, 300);
      triggerUpdate();
    });

    // Dawn's cart-drawer dispatches on itself when opened
    const cartDrawer = document.querySelector('cart-drawer');
    if (cartDrawer) {
      // Watch for the 'open' attribute being added
      const drawerObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'open' && cartDrawer.hasAttribute('open')) {
            debug('cart-drawer open attribute added');
            setTimeout(scanAndInject, 100);
          }
        }
      });
      drawerObserver.observe(cartDrawer, { attributes: true, attributeFilter: ['open'] });
      debug('Watching cart-drawer element directly');
    }

    // Click handler for cart icon/button
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target) return;

      const cartTrigger = target.closest(
        '[data-cart-trigger], .cart-icon-bubble, [href="/cart"], ' +
        '.header__icon--cart, .site-header__cart, .cart-link, ' +
        '[data-cart-toggle], .js-cart-trigger, .cart-button, ' +
        '[aria-controls*="cart"], [data-drawer-open="cart"]'
      );

      if (cartTrigger) {
        // Wait for drawer to open
        setTimeout(scanAndInject, 200);
        setTimeout(scanAndInject, 500);
      }

      // Dawn: Add to cart button click
      const addToCartBtn = target.closest(
        '[name="add"], [data-add-to-cart], .product-form__submit, ' +
        '.add-to-cart, button[type="submit"][name="add"], ' +
        '.shopify-payment-button button, .product__submit__add'
      );
      if (addToCartBtn) {
        debug('Add to cart button clicked');
        // Wait for cart drawer to open after add
        setTimeout(scanAndInject, 300);
        setTimeout(scanAndInject, 600);
        setTimeout(scanAndInject, 1000);
      }
    });

    // Listen for form submissions (add to cart)
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (form.action && form.action.includes('/cart/add')) {
        debug('Cart add form submitted');
        setTimeout(scanAndInject, 300);
        setTimeout(scanAndInject, 600);
        setTimeout(scanAndInject, 1000);
      }
    });

    // Intercept fetch for AJAX add to cart (Dawn uses fetch)
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const result = originalFetch.apply(this, args);
      const url = args[0];
      if (typeof url === 'string' && (url.includes('/cart/add') || url.includes('/cart/change'))) {
        debug('Fetch to cart detected:', url);
        result.then(() => {
          // Use debounced update to avoid early stale updates blocking correct ones
          debouncedCartPageUpdate();
        }).catch(() => {});
      }
      return result;
    };
    debug('Fetch interceptor installed');

    // Intercept XMLHttpRequest for AJAX cart updates (Impulse uses XHR)
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._dibUrl = url;
      return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      if (this._dibUrl && (this._dibUrl.includes('/cart/add') || this._dibUrl.includes('/cart/change'))) {
        this.addEventListener('load', function() {
          debug('XHR to cart detected:', this._dibUrl);
          // Use debounced update to avoid early stale updates blocking correct ones
          debouncedCartPageUpdate();
        });
      }
      return originalXHRSend.apply(this, args);
    };
    debug('XHR interceptor installed');
  }

  // Helper to set up MutationObserver on a cart container
  function setupCartObserver(container, label) {
    const observer = new MutationObserver(function(mutations) {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Skip if mutation involves our bar element (prevents infinite loop)
          let involvesBar = false;
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE &&
                (node.classList && node.classList.contains('dib-fd-bar') ||
                 node.querySelector && node.querySelector('.dib-fd-bar'))) {
              involvesBar = true;
              break;
            }
          }
          if (!involvesBar) {
            for (const node of mutation.removedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE &&
                  (node.classList && node.classList.contains('dib-fd-bar') ||
                   node.querySelector && node.querySelector('.dib-fd-bar'))) {
                involvesBar = true;
                break;
              }
            }
          }

          if (!involvesBar) {
            debug('Cart items changed in ' + label + ', scheduling debounced update');
            // Use debounced update - waits for Impulse to finish ALL updates
            // This prevents early stale updates from blocking correct ones via "fade in progress"
            debouncedCartPageUpdate();
          }
          break;
        }
      }
    });

    observer.observe(container, { childList: true, subtree: true });
    debug('Cart items observer installed for ' + label);
  }

  // Re-attach observer to cart page form (after Impulse replaces it via Section Rendering)
  function reattachCartPageObserver() {
    const cartPageForm = document.getElementById('CartPageForm');
    if (cartPageForm && !cartPageForm._dibObserverAttached) {
      setupCartObserver(cartPageForm, 'Impulse #CartPageForm');
      cartPageForm._dibObserverAttached = true;
      debug('Re-attached observer to new #CartPageForm');
    }
  }

  // Watch for cart item changes using MutationObserver for instant reaction
  function watchCartItems() {
    // Watch Dawn's cart-drawer
    const cartDrawer = document.querySelector('cart-drawer');
    if (cartDrawer) {
      setupCartObserver(cartDrawer, 'cart-drawer');
    }

    // Watch Impulse's #CartDrawer
    const impulseDrawer = document.getElementById('CartDrawer');
    if (impulseDrawer) {
      setupCartObserver(impulseDrawer, 'Impulse #CartDrawer');
    }

    // Watch Impulse's cart page form
    const cartPageForm = document.getElementById('CartPageForm');
    if (cartPageForm) {
      setupCartObserver(cartPageForm, 'Impulse #CartPageForm');
      cartPageForm._dibObserverAttached = true;
    }
  }

  // Initialize
  function init() {
    debug('Initializing');

    // Inject CSS to hide bar when cart is empty (prevents flash on last item removal)
    injectEmptyCartCSS();

    // Pre-inject into closed drawers for instant appearance when opened
    preInjectIntoClosedDrawers();

    // Initial scan (handles cart page and open drawers)
    scanAndInject();

    // Watch for drawer opens
    watchForDrawers();

    // Watch for cart item changes (instant reaction to DOM changes)
    watchCartItems();

    // Re-scan on navigation (SPA support)
    window.addEventListener('popstate', () => {
      setTimeout(scanAndInject, 100);
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
