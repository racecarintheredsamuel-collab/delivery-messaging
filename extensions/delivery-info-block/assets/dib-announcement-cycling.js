/**
 * Announcement Bar Message Cycling
 * Works with delivery-messaging.js to cycle through multiple messages
 */
(function() {
  'use strict';

  // Wait for DeliveryMessaging to be ready
  function waitForDM(callback, maxWait = 5000) {
    const start = Date.now();
    function check() {
      if (window.DeliveryMessaging && window.DeliveryMessaging._initialized) {
        callback();
      } else if (Date.now() - start < maxWait) {
        setTimeout(check, 50);
      }
    }
    check();
  }

  function init() {
    const targets = document.querySelectorAll('[data-dm-cycling]');
    targets.forEach(initCyclingTarget);
  }

  function initCyclingTarget(target) {
    // Parse durations from data attributes
    const progressDuration = parseInt(target.dataset.progressDuration, 10) || 5;
    const unlockedDuration = parseInt(target.dataset.unlockedDuration, 10) || 5;
    const emptyDuration = parseInt(target.dataset.emptyDuration, 10) || 5;
    const excludedDuration = parseInt(target.dataset.excludedDuration, 10) || 5;
    const additional1Message = target.dataset.additional1Message || '';
    const additional1Duration = parseInt(target.dataset.additional1Duration, 10) || 5;
    const additional2Message = target.dataset.additional2Message || '';
    const additional2Duration = parseInt(target.dataset.additional2Duration, 10) || 5;

    // State
    let currentIndex = 0;
    let cycleTimer = null;
    let countdownInterval = null;
    let messages = [];
    let lastCartState = null;

    // Get message element
    const messageEl = target.querySelector('[data-dm-message]');
    if (!messageEl) return;

    // Get chevrons
    const prevBtn = target.querySelector('.dib-fd-prev');
    const nextBtn = target.querySelector('.dib-fd-next');

    // Check if {countdown} placeholder would have a valid value
    function isCountdownActive(text) {
      if (!text || !text.includes('{countdown}')) return true; // No countdown = always active

      const configEl = target.querySelector('.dib-cycling-config');
      if (!configEl || !window.DIBCountdown) return false;

      const now = new Date();
      const result = window.DIBCountdown.computeCutoffForToday(configEl, now);
      return result.ok && result.cutoffUtcMs - now.getTime() > 0;
    }

    // Build messages array based on current state
    // Note: FD messages store templates (processed on display) to avoid caching stale threshold values
    function buildMessages() {
      const state = window.DeliveryMessaging.getState();
      const newMessages = [];

      // Determine which FD message to show based on cart state
      let fdTemplate = '';
      let fdDuration = 5;
      let fdType = 'progress';

      if (state.excluded) {
        fdTemplate = target.dataset.excludedMessage || '';
        fdDuration = excludedDuration;
        fdType = 'excluded';
      } else if (state.isEmpty) {
        fdTemplate = target.dataset.emptyMessage || '';
        fdDuration = emptyDuration;
        fdType = 'empty';
      } else if (state.unlocked) {
        fdTemplate = target.dataset.unlockedMessage || '';
        fdDuration = unlockedDuration;
        fdType = 'unlocked';
      } else {
        fdTemplate = target.dataset.progressMessage || '';
        fdDuration = progressDuration;
        fdType = 'progress';
      }

      // Store template for FD messages (processed on display)
      if (fdTemplate) {
        newMessages.push({ template: fdTemplate, duration: fdDuration, type: fdType, isFD: true });
      }

      // Additional messages - only include if countdown is active (or no countdown placeholder)
      if (additional1Message && isCountdownActive(additional1Message)) {
        newMessages.push({ text: additional1Message, duration: additional1Duration, type: 'additional1', isFD: false });
      }
      if (additional2Message && isCountdownActive(additional2Message)) {
        newMessages.push({ text: additional2Message, duration: additional2Duration, type: 'additional2', isFD: false });
      }

      return newMessages;
    }

    // Process FD template with current state values
    function processMessageText(msg) {
      if (!msg.isFD) {
        // Additional messages - process countdown placeholder
        return processCountdown(msg.text);
      }

      const state = window.DeliveryMessaging.getState();
      const dm = window.DeliveryMessaging;

      // Fallback: if state.threshold is 0, read directly from DOM
      // This handles race condition on first page load
      let threshold = state.threshold;
      if (threshold === 0) {
        const configEl = document.querySelector('[data-threshold]');
        if (configEl) {
          const parsed = parseInt(configEl.dataset.threshold, 10);
          if (!isNaN(parsed) && parsed > 0) {
            threshold = parsed;
          }
        }
      }

      const templateVars = {
        remaining: dm.formatMoney(state.remaining),
        threshold: dm.formatMoney(threshold),
        total: dm.formatMoney(state.cartTotal),
        cart_total: dm.formatMoney(state.cartTotal)
      };
      return processTemplate(msg.template, templateVars);
    }

    function processTemplate(template, values) {
      if (!template) return '';
      let result = template;
      for (const [key, value] of Object.entries(values)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      }
      return result;
    }

    // Normalize URL - prepend https:// to bare domains
    function normalizeUrl(url) {
      if (/^(https?:\/\/|\/)/i.test(url)) return url;
      if (url.includes('.') && /^[a-z0-9][-a-z0-9]*\./i.test(url)) return 'https://' + url;
      return null;
    }

    function parseMarkdown(text) {
      if (!text) return text;

      // Inject link styles once
      if (!document.getElementById('dib-fd-link-styles')) {
        const configEl = target.querySelector('.dib-cycling-config');
        const lc = configEl?.getAttribute('data-link-color') || '#ffffff';
        const ld = configEl?.getAttribute('data-link-decoration') || 'underline';
        const hc = configEl?.getAttribute('data-link-hover-color') || '#e5e7eb';
        const hd = configEl?.getAttribute('data-link-hover-decoration') || 'underline';
        const ho = configEl?.getAttribute('data-link-hover-opacity') || '1';
        const lt = configEl?.getAttribute('data-link-thickness') || '1px';
        const ht = configEl?.getAttribute('data-link-hover-thickness') || '2px';

        const s = document.createElement('style');
        s.id = 'dib-fd-link-styles';
        s.textContent = '.dib-fd-announcement .dib-fd-link{color:' + lc + ';text-decoration:' + ld + ';text-decoration-thickness:' + lt + ';transition:all .15s ease}.dib-fd-announcement .dib-fd-link:hover{color:' + hc + ';text-decoration:' + hd + ';text-decoration-thickness:' + ht + ';opacity:' + ho + '}';
        document.head.appendChild(s);
      }

      // 1. HTML-escape first (security)
      let result = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // 2. Process bold: **text** → <strong>text</strong>
      if (result.includes('**')) {
        result = result.split('**').map((part, i) => i % 2 === 1 ? '<strong>' + part + '</strong>' : part).join('');
      }
      // 3. Process links: [text](url) → <a href="url" class="dib-fd-link">text</a>
      if (result.includes('[')) {
        result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
          const decodedUrl = url.replace(/&amp;/g, '&');
          const finalUrl = normalizeUrl(decodedUrl);
          if (!finalUrl) return match;
          return '<a href="' + finalUrl + '" target="_blank" rel="noopener" class="dib-fd-link">' + linkText + '</a>';
        });
      }
      return result;
    }

    // Process {countdown} placeholder in additional messages
    function processCountdown(text) {
      if (!text || !text.includes('{countdown}')) return text;

      const configEl = target.querySelector('.dib-cycling-config');
      if (!configEl || !window.DIBCountdown) {
        return text.replace('{countdown}', '');
      }

      const now = new Date();
      const result = window.DIBCountdown.computeCutoffForToday(configEl, now);

      if (!result.ok || result.cutoffUtcMs - now.getTime() <= 0) {
        return text.replace('{countdown}', '');
      }

      const remainingMs = result.cutoffUtcMs - now.getTime();
      const timeStr = window.DIBCountdown.formatRemaining(remainingMs);
      return text.replace('{countdown}', timeStr);
    }

    function showMessage(index, skipCount = 0) {
      if (!messages[index]) return;

      // Prevent infinite loop if all messages are empty
      if (skipCount >= messages.length) return;

      const msg = messages[index];
      const text = processMessageText(msg);

      // If text is empty, skip to next message
      if (!text && messages.length > 1) {
        currentIndex = (currentIndex + 1) % messages.length;
        showMessage(currentIndex, skipCount + 1);
        return;
      }

      // Fade out, change, fade in
      messageEl.style.opacity = '0';
      setTimeout(() => {
        messageEl.innerHTML = parseMarkdown(text);
        messageEl.style.opacity = '1';
      }, 150);
    }

    function startCycle() {
      stopCycle();
      messages = buildMessages();

      // Update chevron visibility
      if (messages.length > 1) {
        target.classList.add('dib-fd-has-multiple');
      } else {
        target.classList.remove('dib-fd-has-multiple');
      }

      if (messages.length === 0) return;

      // Ensure index is valid
      if (currentIndex >= messages.length) {
        currentIndex = 0;
      }

      showMessage(currentIndex);
      scheduleNext();

      // Start countdown refresh interval if any message has {countdown}
      const hasCountdown = messages.some(m => !m.isFD && m.text && m.text.includes('{countdown}'));
      if (hasCountdown && !countdownInterval) {
        countdownInterval = setInterval(() => {
          const currentMsg = messages[currentIndex];
          if (currentMsg && !currentMsg.isFD && currentMsg.text && currentMsg.text.includes('{countdown}')) {
            // Refresh current message to update countdown (without fade)
            const text = processMessageText(currentMsg);
            messageEl.innerHTML = parseMarkdown(text);
          }
        }, 30000);
      }
    }

    function scheduleNext() {
      if (messages.length <= 1) return;

      const current = messages[currentIndex];
      if (!current || current.duration <= 0) return;

      cycleTimer = setTimeout(() => {
        currentIndex = (currentIndex + 1) % messages.length;
        showMessage(currentIndex);
        scheduleNext();
      }, current.duration * 1000);
    }

    function stopCycle() {
      if (cycleTimer) {
        clearTimeout(cycleTimer);
        cycleTimer = null;
      }
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }

    function goNext() {
      stopCycle();
      currentIndex = (currentIndex + 1) % messages.length;
      showMessage(currentIndex);
      scheduleNext();
    }

    function goPrev() {
      stopCycle();
      currentIndex = (currentIndex - 1 + messages.length) % messages.length;
      showMessage(currentIndex);
      scheduleNext();
    }

    function onCartUpdate(state) {
      // Check if cart state actually changed (not just a refresh)
      const cartStateKey = `${state.cartTotal}-${state.isEmpty}-${state.excluded}-${state.unlocked}`;

      if (lastCartState !== null && lastCartState !== cartStateKey) {
        // Cart changed - reset to FD message (index 0)
        stopCycle();
        currentIndex = 0;
        startCycle();
      } else if (lastCartState === null) {
        // First load
        startCycle();
      }

      lastCartState = cartStateKey;
    }

    // Set up chevron handlers
    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        goPrev();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        goNext();
      });
    }

    // Subscribe to cart state changes
    // Note: subscribe() immediately calls onCartUpdate which handles initial start
    window.DeliveryMessaging.subscribe(onCartUpdate);
  }

  // Initialize when ready
  waitForDM(init);

  // Re-init on page navigation (for SPAs)
  document.addEventListener('shopify:section:load', () => waitForDM(init));
})();
