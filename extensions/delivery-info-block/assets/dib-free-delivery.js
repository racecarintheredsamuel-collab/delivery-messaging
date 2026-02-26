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
      transition: opacity 0.15s ease-out;
      width: 100%;
      box-sizing: border-box;
    `.replace(/\s+/g, ' ');

    const message = document.createElement('div');
    message.className = 'dib-fd-message';
    message.setAttribute('data-dm-message', '');
    message.style.cssText = `text-align: center; font-weight: 500; color: ${config.barTextColor}; min-height: 20px; transition: opacity 0.15s ease-out;`;
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

    // Skip injection if drawer has no cart items (Dawn)
    if (drawerRoot) {
      // Check for cart items - Dawn uses cart-drawer-items with cart-item elements
      const cartItems = drawerRoot.querySelector('cart-drawer-items');
      const hasItems = cartItems && cartItems.querySelector('.cart-item, cart-item, [data-cart-item]');
      if (cartItems && !hasItems) {
        debug('Cart drawer has no items, skipping injection');
        return false;
      }
    }

    const bar = createBarElement(config);

    // For cart drawers, try theme-specific positioning first
    const isInDrawer = drawerRoot || container.matches('cart-drawer, .cart-drawer, [data-cart-drawer]');
    if (isInDrawer) {
      bar.style.margin = '0 12px 12px 12px';  // No top margin - drawer heading has its own padding

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
          // Check if heading is in a flex row - if so, insert after the parent container
          let insertTarget = el;
          const parent = el.parentElement;
          if (parent) {
            const parentStyle = window.getComputedStyle(parent);
            if (parentStyle.display === 'flex' && parentStyle.flexDirection === 'row') {
              insertTarget = parent;
              // When inserting after flex parent, use calc width and auto margins for centering
              bar.style.width = 'calc(100% - 24px)';
              bar.style.margin = '0 auto 12px auto';
              debug('Heading in flex row, inserting after parent instead');
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

            // Re-inject immediately (synchronously) to prevent blink
            debug('Container still valid, re-injecting');
            injectIntoContainer(container, position);
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
            if (cartDrawer.hasAttribute('open')) {
              debug('Drawer opening, showing bar');
              bar.style.opacity = '1';
              bar.style.pointerEvents = '';
            } else {
              debug('Drawer closing, fading bar');
              bar.style.opacity = '0';
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
      if (window.DeliveryMessaging.forceUpdate) {
        window.DeliveryMessaging.forceUpdate();
      } else if (window.DeliveryMessaging.refresh) {
        window.DeliveryMessaging.refresh();
      }
    }
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

  // Find cart drawer container
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
          setTimeout(scanAndInject, 300);
          setTimeout(scanAndInject, 600);
          setTimeout(scanAndInject, 1000);
        }).catch(() => {});
      }
      return result;
    };
    debug('Fetch interceptor installed');
  }

  // Initialize
  function init() {
    debug('Initializing');

    // Initial scan
    scanAndInject();

    // Watch for drawer opens
    watchForDrawers();

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
