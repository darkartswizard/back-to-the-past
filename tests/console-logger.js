const path = require('path');

function getCallerInfo() {
  const stack = new Error().stack;
  if (!stack) return { fileName: 'unknown', lineNumber: '?' };
  
  const stackLines = stack.split('\n');
  
  // Find the first line that's not from this logger file
  for (let i = 3; i < stackLines.length; i++) {
    const line = stackLines[i];
    if (!line.includes('console-logger.js') && line.includes('at ')) {
      // Extract file and line number
      const match = line.match(/\((.+):(\d+):(\d+)\)/) || line.match(/at (.+):(\d+):(\d+)/);
      if (match) {
        const fullPath = match[1];
        const fileName = path.basename(fullPath);
        const lineNumber = match[2];
        return { fileName, lineNumber };
      }
    }
  }
  return { fileName: 'unknown', lineNumber: '?' };
}

/**
 * @param {any} page
 */
function patchPageAndLocators(page) {
  // Add dynamicWait method to page
  page.dynamicWait = async function(/** @type {number} */ ms) {
    const { fileName, lineNumber } = getCallerInfo();
    console.log(`[${fileName}:${lineNumber}] dynamicWait(${ms || 1000}ms) - polling for element stability`);
    
    const startTime = Date.now();
    const originalWaitTime = ms || 1000;
    const pollInterval = 333; // Check every 333ms
    const maxWait = Math.max(originalWaitTime * 2, 5000); // Max 2x original or 5 seconds
    const minWait = 100; // Minimum wait before checking
    const stabilityChecks = 3; // Number of consecutive stable checks required
    
    /**
     * Count visible elements on the page
     */
    const countVisibleElements = async () => {
      return await page.evaluate(() => {
        const selectors = [
          'a', 'button', 'input', 'textarea', 'select',
          'ul', 'ol', 'img', 'svg', 'div', 'label'
        ];
        
        /** @type {{ [key: string]: number }} */
        const counts = {};
        let total = 0;
        
        selectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          let visibleCount = 0;
          
          elements.forEach(el => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            
            if (style.display !== 'none' && 
                style.visibility !== 'hidden' && 
                style.opacity !== '0' &&
                rect.width > 0 && 
                rect.height > 0) {
              visibleCount++;
            }
          });
          
          counts[selector] = visibleCount;
          total += visibleCount;
        });
        
        return { counts, total };
      });
    };
    
    /**
     * Find spinner elements on the page and inside iframes
     */
    const findSpinners = async () => {
      // Find spinners in main page
      const mainSpinners = await page.locator('[class*="spinner"], [class*="loading"], [class*="loader"], [role="progressbar"], .fa-spinner, .fa-spin').all();
      
      // Find spinners inside contentWindow iframe
      const allSpinners = [...mainSpinners];
      try {
        const iframe = page.locator('iframe[name="contentWindow"]');
        const frame = await iframe.contentFrame();
        if (frame) {
          const frameSpinners = await frame.locator('.spinner, [class*="spinner"], [class*="loading"], [class*="loader"], [role="progressbar"]').all();
          allSpinners.push(...frameSpinners);
        }
      } catch (error) {
        // Iframe not available or no frame content
      }
      
      return allSpinners;
    };

    /**
     * Flash an element once (toggle outline)
     */
    const flashElement = async (/** @type {any} */ locator, /** @type {boolean} */ isRed) => {
      try {
        await locator.evaluate((/** @type {HTMLElement} */ el, /** @type {boolean} */ red) => {
          el.style.outline = red ? '3px solid red' : '3px solid yellow';
          el.style.outlineOffset = '2px';
        }, isRed);
      } catch (error) {
        // Spinner disappeared during flash
        console.log(`[dynamicWait] 🎯 Spinner disappeared`);
      }
    };

    // Small initial wait
    await page.waitForTimeout(minWait);
    
    let previousCount = await countVisibleElements();
    let stableCount = 0;
    let cycleCount = 0;
    let toastFound = false; // Track if toast was already found
    
    // Poll for element count stability
    while (Date.now() - startTime < maxWait) {
      try {
        // Check for toast messages FIRST - exit immediately if found for the first time
        try {
          const toastSelectors = [
            '[role="alert"]',
            '[role="status"]',
            '[aria-live]',
            '[class*="toast"]',
            '[class*="Toast"]',
            '[class*="notification"]',
            '[class*="alert"]',
            '[class*="message"]'
          ].join(', ');
          
          const mainToasts = await page.locator(toastSelectors).all();
          const frameToasts = [];
          
          // Also check iframe
          try {
            const iframe = page.locator('iframe[name="contentWindow"]');
            const frame = await iframe.contentFrame();
            if (frame) {
              const iframeToasts = await frame.locator(toastSelectors).all();
              frameToasts.push(...iframeToasts);
            }
          } catch (error) {
            // Iframe not available
          }
          
          const allToasts = [...mainToasts, ...frameToasts];
          
          // Filter out empty toasts - get text from visible toasts only
          let validToasts = [];
          for (const toast of allToasts) {
            try {
              const text = await toast.textContent();
              if (text && text.trim().length > 0) {
                validToasts.push({ locator: toast, text: text.trim() });
              }
            } catch (error) {
              // Ignore if can't get text
            }
          }
          
          const hasToast = validToasts.length > 0;
          
          if (hasToast && !toastFound) {
            // First time seeing toast - flash it and exit
            toastFound = true;
            
            console.log(`[dynamicWait] 🎉 Toast detected with text: "${validToasts[0].text}"`);
            
            // Flash the first toast
            try {
              await flashElement(validToasts[0].locator, true);
            } catch (error) {
              // Toast may have disappeared
            }
            
            const actualTime = Date.now() - startTime;
            const difference = originalWaitTime - actualTime;
            const currentCount = await countVisibleElements();
            
            if (difference > 0) {
              console.log(`[dynamicWait] 🎉 Toast detected after ${actualTime}ms (saved ${difference}ms vs waitForTimeout(${originalWaitTime}ms)) - ${currentCount.total} visible elements`);
            } else {
              console.log(`[dynamicWait] 🎉 Toast detected after ${actualTime}ms (${Math.abs(difference)}ms slower than waitForTimeout(${originalWaitTime}ms)) - ${currentCount.total} visible elements`);
            }
            return;
          } else if (!hasToast && toastFound) {
            // Toast disappeared - clear the flag
            toastFound = false;
            console.log(`[dynamicWait] 👋 Toast disappeared - continuing to wait for stability`);
          }
          // If hasToast && toastFound, ignore (toast still present but already handled)
        } catch (error) {
          // Ignore toast detection errors
        }
        
        // Check for spinners immediately (before waiting)
        let hasSpinner = false;
        try {
          const spinners = await findSpinners();
          if (spinners.length > 0) {
            hasSpinner = true;
            // Flash with alternating colors each cycle
            const isRed = cycleCount % 2 === 0;
            spinners.forEach((/** @type {any} */ spinner) => flashElement(spinner, isRed).catch(() => {}));
            // Reset stability count because page is still loading
            stableCount = 0;
          }
        } catch (error) {
          // Ignore spinner detection errors
        }
        
        // Check for "Later" button immediately
        try {
          // Check main page and iframe for Later button (by role and by id)
          const laterButtons = [];
          
          // Check by role (text "LATER")
          const mainLater = await page.getByRole('button', { name: /later/i }).all();
          laterButtons.push(...mainLater);
          
          // Check by id
          const mainLaterId = await page.locator('#popup-later').all();
          laterButtons.push(...mainLaterId);
          
          try {
            const iframe = page.locator('iframe[name="contentWindow"]');
            const frame = await iframe.contentFrame();
            if (frame) {
              const frameLater = await frame.getByRole('button', { name: /later/i }).all();
              laterButtons.push(...frameLater);
              
              const frameLaterId = await frame.locator('#popup-later').all();
              laterButtons.push(...frameLaterId);
            }
          } catch (error) {
            // Iframe not available
          }
          
          if (laterButtons.length > 0) {
            console.log(`[dynamicWait] 🔘 Found ${laterButtons.length} "Later" button(s) - clicking...`);
            // Click the first "Later" button found
            try {
              await laterButtons[0].click();
              console.log(`[dynamicWait] ✓ Clicked "Later" button`);
            } catch (error) {
              console.log(`[dynamicWait] ⚠ Failed to click "Later" button - may have disappeared`);
            }
          }
        } catch (error) {
          // Ignore later button detection errors
        }
        
        const currentCount = await countVisibleElements();
        
        // Only check stability if no spinner is present
        if (!hasSpinner) {
          if (JSON.stringify(currentCount) === JSON.stringify(previousCount)) {
            stableCount++;
            
            if (stableCount >= stabilityChecks) {
              const actualTime = Date.now() - startTime;
              const difference = originalWaitTime - actualTime;
              
              if (difference > 0) {
                console.log(`[dynamicWait] ✓ Stable after ${actualTime}ms (saved ${difference}ms vs waitForTimeout(${originalWaitTime}ms)) - ${currentCount.total} visible elements`);
              } else {
                console.log(`[dynamicWait] ✓ Stable after ${actualTime}ms (${Math.abs(difference)}ms slower than waitForTimeout(${originalWaitTime}ms)) - ${currentCount.total} visible elements`);
              }
              return;
            }
          } else {
            stableCount = 0;
            previousCount = currentCount;
          }
        } else {
          // Spinner present - update previous count but don't check stability
          previousCount = currentCount;
        }
      } catch (error) {
        stableCount = 0;
      }
      
      cycleCount++;
      await page.waitForTimeout(pollInterval);
    }
    
    const actualTime = Date.now() - startTime;
    const difference = originalWaitTime - actualTime;
    const currentCount = await countVisibleElements();
    console.log(`[dynamicWait] ⚠ Max wait ${actualTime}ms reached without stability (${Math.abs(difference)}ms vs waitForTimeout(${originalWaitTime}ms)) - ${currentCount.total} visible elements`);
  };

  // Monkey patch Page.waitForTimeout
  const originalWaitForTimeout = page.waitForTimeout;
  page.waitForTimeout = async function(/** @type {any} */ timeout) {
    const { fileName, lineNumber } = getCallerInfo();
    // Skip logging for internal fixture calls and internal polling (333ms from dynamicWait)
    if (fileName !== 'fixtures.js' && 
        fileName !== 'console-logger.js' && 
        fileName !== 'task_queues' &&
        timeout !== 333 && 
        timeout !== 100) {
      console.log(`[${fileName}:${lineNumber}] waitForTimeout(${timeout}ms)`);
    }
    return await originalWaitForTimeout.call(this, timeout);
  };

  // Monkey patch Page.waitForLoadState
  const originalWaitForLoadState = page.waitForLoadState;
  page.waitForLoadState = async function(/** @type {any} */ state, /** @type {any} */ options) {
    const { fileName, lineNumber } = getCallerInfo();
    // Skip logging for internal fixture calls
    if (fileName !== 'fixtures.js' && fileName !== 'console-logger.js') {
      console.log(`[${fileName}:${lineNumber}] waitForLoadState('${state || 'load'}')`);
    }
    return await originalWaitForLoadState.call(this, state, options);
  };

  // Store original locator method
  const originalLocator = page.locator;
  
  // Patch page.locator to return patched locators
  page.locator = function(/** @type {any[]} */ ...args) {
    const locator = originalLocator.call(this, ...args);
    patchLocator(locator);
    return locator;
  };

  // Patch getByRole and other getter methods
  const getterMethods = ['getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId', 'getByTitle'];
  getterMethods.forEach(method => {
    if (page[method]) {
      const original = page[method];
      page[method] = function(/** @type {any[]} */ ...args) {
        const locator = original.call(this, ...args);
        patchLocator(locator);
        return locator;
      };
    }
  });

  console.log('✓ Console logger activated for page instance');
}

/**
 * @param {any} locator
 */
function patchLocator(locator) {
  if (!locator || locator.__patched) return;
  
  // Mark as patched to avoid double-patching
  locator.__patched = true;

  // Monkey patch Locator.click
  const originalClick = locator.click;
  if (originalClick) {
    locator.click = async function(/** @type {any} */ options) {
      const { fileName, lineNumber } = getCallerInfo();
      let locatorDesc = 'locator';
      try {
        locatorDesc = this.toString();
      } catch (e) {
        // Ignore
      }
      console.log(`[${fileName}:${lineNumber}] click ${locatorDesc}`);
      return await originalClick.call(this, options);
    };
  }

  // Monkey patch Locator.waitFor
  const originalWaitFor = locator.waitFor;
  if (originalWaitFor) {
    locator.waitFor = async function(/** @type {any} */ options) {
      const { fileName, lineNumber } = getCallerInfo();
      const state = options?.state || 'visible';
      const timeout = options?.timeout || 'default';
      console.log(`[${fileName}:${lineNumber}] waitFor({state: '${state}', timeout: ${timeout}})`);
      return await originalWaitFor.call(this, options);
    };
  }

  // Patch methods that return new locators
  const chainMethods = ['locator', 'getByRole', 'getByText', 'getByLabel'];
  chainMethods.forEach(method => {
    if (locator[method]) {
      const original = locator[method];
      locator[method] = function(/** @type {any[]} */ ...args) {
        const newLocator = original.call(this, ...args);
        patchLocator(newLocator);
        return newLocator;
      };
    }
  });

  // Patch contentFrame for iframes
  if (locator.contentFrame) {
    const originalContentFrame = locator.contentFrame;
    locator.contentFrame = async function() {
      const frame = await originalContentFrame.call(this);
      if (frame) {
        patchFrame(frame);
      }
      return frame;
    };
  }
}

/**
 * @param {any} frame
 */
function patchFrame(frame) {
  if (!frame || frame.__patched) return;
  frame.__patched = true;

  // Patch frame getter methods
  const getterMethods = ['getByRole', 'getByText', 'getByLabel', 'locator'];
  getterMethods.forEach(method => {
    if (frame[method]) {
      const original = frame[method];
      frame[method] = function(/** @type {any[]} */ ...args) {
        const locator = original.call(this, ...args);
        patchLocator(locator);
        return locator;
      };
    }
  });
}

module.exports = { patchPageAndLocators };
