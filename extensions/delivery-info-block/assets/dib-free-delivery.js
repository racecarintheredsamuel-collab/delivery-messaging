(function() {
  'use strict';

  // Prevent double initialization
  if (window.__DIB_FD_INIT__) return;
  window.__DIB_FD_INIT__ = true;

  const debug = (...args) => {
    if (window.__DIB_DEBUG__) console.log('[DIB FD]', ...args);
  };

  // Theme-specific drawer configurations
  // Add more themes here as they are tested
  const THEME_DRAWER_CONFIGS = {
    'Dawn': {
      headingSelector: '.drawer__header',
      insertPosition: 'afterend'
    },
    'Craft': {
      headingSelector: '.drawer__header, [class*="cart-drawer"] > header, .cart-drawer header',
      insertPosition: 'afterend'
    }
  };

  function getThemeConfig() {
    const themeName = window.Shopify?.theme?.name;
    return themeName ? THEME_DRAWER_CONFIGS[themeName] : null;
  }

  // Cart page selectors (in priority order)
  const CART_PAGE_SELECTORS = [
    '.cart__items',
    '.cart-items',
    'cart-items',
    '[data-cart-items]',
    '.cart-form',
    '#cart',
    '.cart',
    '[data-cart]',
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

  // Get config from the embed
  function getConfig() {
    const configEl = document.getElementById('dib-fd-config');
    if (!configEl) return null;

    return {
      showProgressBar: configEl.dataset.showProgressBar !== 'false',
      progressBarColor: configEl.dataset.progressBarColor || '#22c55e',
      progressBarBg: configEl.dataset.progressBarBg || '#e5e7eb',
      barBgColor: configEl.dataset.barBgColor || '#f9fafb',
      barTextColor: configEl.dataset.barTextColor || '#374151'
    };
  }

  // Create the free delivery bar element with inline styles for reliability
  function createBarElement(config) {
    const bar = document.createElement('div');
    bar.className = 'dib-fd-bar';
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
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.4;
      z-index: 10;
      width: 100%;
      box-sizing: border-box;
    `.replace(/\s+/g, ' ');

    const message = document.createElement('div');
    message.className = 'dib-fd-message';
    message.setAttribute('data-dm-message', '');
    // Message starts hidden and fades in once content is ready
    message.style.cssText = `text-align: center; font-weight: 500; color: ${config.barTextColor}; min-height: 20px; opacity: 0; transition: opacity 400ms ease-in;`;
    message.innerHTML = '<div class="dib-fd-skeleton-text"></div>';
    bar.appendChild(message);

    if (config.showProgressBar) {
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
        background: linear-gradient(to right, ${config.progressBarColor} 0%, ${config.progressBarBg} 0%);
      `.replace(/\s+/g, ' ');
      bar.appendChild(progressBar);
    }

    return bar;
  }

  // Find and inject into a container
  function injectIntoContainer(container, position = 'prepend') {
    if (!container) return false;

    const config = getConfig();
    if (!config) return false;

    // For drawers, check if bar already exists anywhere in the drawer
    const drawerRoot = container.closest('cart-drawer') || (container.matches && container.matches('cart-drawer') ? container : null);
    const checkContainer = drawerRoot || container;
    if (checkContainer.querySelector('.dib-fd-bar')) return false;

    // Create bar element
    const bar = createBarElement(config);

    // For cart drawers, try theme-specific positioning first
    const isInDrawer = drawerRoot || container.matches('cart-drawer, .cart-drawer, [data-cart-drawer]');
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

      const themeConfig = getThemeConfig();
      const searchRoot = drawerRoot || container;

      // Try theme-specific heading injection
      if (themeConfig && themeConfig.headingSelector) {
        const headingEl = searchRoot.querySelector(themeConfig.headingSelector);
        if (headingEl) {
          headingEl.insertAdjacentElement(themeConfig.insertPosition || 'afterend', bar);
          injectedContainers.add(searchRoot);
          debug('Injected bar after heading (theme:', window.Shopify?.theme?.name, ')');
          setupBarObservers(bar, searchRoot, position);
          triggerUpdate();
          return true;
        }
      }

      // Universal fallback: find heading by common cart text
      const cartHeadingTexts = ['your cart', 'cart', 'shopping cart', 'your bag', 'bag'];
      const headingTags = searchRoot.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="heading"], [class*="title"], .drawer__heading, .cart-drawer__heading');
      for (const el of headingTags) {
        const text = el.textContent?.trim().toLowerCase();
        if (text && cartHeadingTexts.some(t => text === t || text.startsWith(t))) {
          // Check if heading is in a flex row - need to insert BELOW header container
          let insertTarget = el;
          const parent = el.parentElement;
          if (parent) {
            const parentStyle = window.getComputedStyle(parent);
            if (parentStyle.display === 'flex' && parentStyle.flexDirection === 'row') {
              // Parent contains heading + other elements (like close button)
              // Go UP one more level to find the actual header container
              const grandparent = parent.parentElement;
              if (grandparent && (
                grandparent.matches('.drawer__header, [class*="header"], header') ||
                grandparent.tagName === 'HEADER'
              )) {
                // Insert after the entire header section
                insertTarget = grandparent;
                debug('Found header container, inserting after it');
              } else {
                // Fallback: insert after the flex parent
                insertTarget = parent;
                debug('Heading in flex row, inserting after parent');
              }
              // When inserting after flex parent/grandparent, use calc width and auto margins
              bar.style.width = 'calc(100% - 24px)';
              bar.style.margin = '0 auto 12px auto';
            }
          }
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
      // Cart page - use normal flow with margin
      bar.style.margin = '12px 0';
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

            // Don't re-inject if cart is empty - just let it stay removed
            const drawerRoot = container.closest('cart-drawer') || container;
            if (!checkCartHasItems(drawerRoot)) {
              debug('Cart empty, not re-injecting bar');
              return;
            }

            // Preserve state from old bar for animation continuity
            const oldState = bar.dataset.dmState;
            const oldCelebrated = bar.dataset.dmCelebrated;

            // Re-inject only if cart has items
            debug('Container still valid, re-injecting');
            injectIntoContainer(container, position);

            // Restore state to new bar so animations can trigger correctly
            const newBar = drawerRoot.querySelector('.dib-fd-bar');
            if (newBar && oldState) {
              newBar.dataset.dmState = oldState;
              newBar.dataset.dmCelebrated = oldCelebrated;
              debug('Restored bar state:', oldState, 'celebrated:', oldCelebrated);
            }
            return;
          }
        }
      }
    });
    barObserver.observe(container, { childList: true, subtree: true });

    // Watch for drawer opening/closing
    const cartDrawer = container.closest('cart-drawer') || document.querySelector('cart-drawer');
    if (cartDrawer) {
      const drawerObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'open') {
            var msg = bar.querySelector('.dib-fd-message');
            if (cartDrawer.hasAttribute('open')) {
              debug('Drawer opening, showing message');
              if (msg) msg.style.opacity = '1';
              bar.style.pointerEvents = '';
            } else {
              debug('Drawer closing, fading message');
              if (msg) msg.style.opacity = '0';
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
      // Update immediately with current state for initial bar population
      if (window.DeliveryMessaging.forceUpdate) {
        window.DeliveryMessaging.forceUpdate();
      }
      // Also schedule a refresh to ensure fresh data
      if (window.DeliveryMessaging.refresh) {
        window.DeliveryMessaging.refresh();
      }
    }
    // Mark all bars as ready and fade in message content
    setTimeout(function() {
      document.querySelectorAll('.dib-fd-bar:not(.is-ready)').forEach(function(bar) {
        bar.classList.add('is-ready');
        var msg = bar.querySelector('.dib-fd-message');
        if (msg) msg.style.opacity = '1';
      });
    }, 50);
  }

  // Find cart page container
  function findCartPageContainer() {
    // Only on /cart page
    if (!window.location.pathname.includes('/cart')) return null;

    for (const selector of CART_PAGE_SELECTORS) {
      const container = document.querySelector(selector);
      if (container) {
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

    // Find cart-drawer even when closed
    const cartDrawer = document.querySelector('cart-drawer');
    if (cartDrawer && !cartDrawer.querySelector('.dib-fd-bar')) {
      debug('Pre-injecting into closed cart-drawer');
      injectIntoContainer(cartDrawer, 'prepend');
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
        const msg = bar.querySelector('.dib-fd-message');
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
          if (msg) msg.style.opacity = '1';
        } else {
          // Hide INSTANTLY with visibility (no render frame delay)
          // Using visibility + height collapse prevents any visual flash
          bar.style.visibility = 'hidden';
          bar.style.height = '0';
          bar.style.overflow = 'hidden';
          bar.style.padding = '0';
          bar.style.margin = '0';
          if (msg) msg.style.opacity = '0';
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
      });
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
          // MutationObserver handles visibility, just ensure bar exists
          setTimeout(scanAndInject, 300);
          setTimeout(scanAndInject, 600);
        }).catch(() => {});
      }
      return result;
    };
    debug('Fetch interceptor installed');
  }

  // Watch for cart item changes using MutationObserver for instant reaction
  function watchCartItems() {
    const cartDrawer = document.querySelector('cart-drawer');
    if (!cartDrawer) return;

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
            debug('Cart items changed, updating bar visibility');
            updateBarVisibility();
          }
          break;
        }
      }
    });

    // Observe the drawer for changes to its children (items added/removed)
    observer.observe(cartDrawer, {
      childList: true,
      subtree: true
    });

    debug('Cart items observer installed');
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
