const path = require('path');
const { expect } = require('@playwright/test');

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
  // Store original methods before patching
  const originalWaitForLoadState = page.waitForLoadState;
  
  // Add dynamicWait method to page
  /**
   * @param {number} ms - Time to wait in milliseconds
   * @param {boolean} [noEarlyExit=false] - If true, wait full duration even if stable (for popup detection)
   */
  page.dynamicWait = async function(ms, noEarlyExit = false) {
    const { fileName, lineNumber } = getCallerInfo();
    const waitMode = noEarlyExit ? ' (full duration mode)' : '';
    console.log(`[${fileName}:${lineNumber}] dynamicWait(${ms || 1000}ms${waitMode}) - polling for element stability`);
    
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
      // Only look for actively spinning/loading elements, not static elements with "spinner" in class
      // Use more specific selectors: fa-spin (FontAwesome), role="progressbar", or elements with "loading" class
      const mainSpinners = await page.locator('.fa-spin, [role="progressbar"], [class*="loading"]:not(#global-spinner), [class*="loader"]:not(#global-spinner)').all();
      
      // Find spinners inside contentWindow iframe - but exclude static elements
      const allSpinners = [...mainSpinners];
      try {
        const iframe = page.locator('iframe[name="contentWindow"]');
        const frame = await iframe.contentFrame();
        if (frame) {
          // Only look for specific loading indicators in iframe, exclude generic .spinner class
          const frameSpinners = await frame.locator('.fa-spin, [role="progressbar"], [class*="loading"], [class*="loader"]').all();
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
    const flashElement = async (/** @type {any} */ locator, /** @type {string} */ color = 'yellow') => {
      try {
        await locator.evaluate((/** @type {HTMLElement} */ el, /** @type {string} */ outlineColor) => {
          el.style.outline = `3px solid ${outlineColor}`;
          el.style.outlineOffset = '2px';
        }, color);
      } catch (error) {
        // Element disappeared during flash
        console.log(`[dynamicWait] 🎯 Element disappeared during flash`);
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
            
            // Flash the first toast in green
            try {
              await flashElement(validToasts[0].locator, 'green');
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
            
            // Log which spinner element is being detected (only once every few cycles to avoid spam)
            if (cycleCount % 5 === 0) {
              try {
                const spinnerInfo = await spinners[0].evaluate((/** @type {HTMLElement} */ el) => {
                  return {
                    tagName: el.tagName,
                    className: el.className,
                    id: el.id,
                    role: el.getAttribute('role'),
                    text: el.textContent?.substring(0, 30)
                  };
                });
                console.log(`[dynamicWait] 🔍 Spinner detected: <${spinnerInfo.tagName}> class="${spinnerInfo.className}" id="${spinnerInfo.id}" role="${spinnerInfo.role}" text="${spinnerInfo.text}"`);
              } catch (e) {
                console.log(`[dynamicWait] 🔍 Spinner detected but couldn't get details`);
              }
            }
            
            // Flash with alternating colors each cycle (red/yellow)
            const color = cycleCount % 2 === 0 ? 'red' : 'yellow';
            spinners.forEach((/** @type {any} */ spinner) => flashElement(spinner, color).catch(() => {}));
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
          
          console.log(`[dynamicWait] 🔍 Checking for Later button... (cycle ${cycleCount})`);
          
          // Check by role (text "LATER")
          const mainLater = await page.getByRole('button', { name: /later/i }).all();
          if (mainLater.length > 0) {
            console.log(`[dynamicWait] 🔍 Found ${mainLater.length} Later button(s) on main page by role`);
          }
          laterButtons.push(...mainLater);
          
          // Check by text (more aggressive)
          const mainLaterText = await page.getByText(/^LATER$/i).all();
          if (mainLaterText.length > 0) {
            console.log(`[dynamicWait] 🔍 Found ${mainLaterText.length} Later element(s) on main page by text`);
          }
          laterButtons.push(...mainLaterText);
          
          // Check by id
          const mainLaterId = await page.locator('#popup-later').all();
          if (mainLaterId.length > 0) {
            console.log(`[dynamicWait] 🔍 Found ${mainLaterId.length} Later button(s) on main page by id`);
          }
          laterButtons.push(...mainLaterId);
          
          try {
            const iframe = page.locator('iframe[name="contentWindow"]');
            const frame = await iframe.contentFrame();
            if (frame) {
              const frameLater = await frame.getByRole('button', { name: /later/i }).all();
              if (frameLater.length > 0) {
                console.log(`[dynamicWait] 🔍 Found ${frameLater.length} Later button(s) in iframe by role`);
              }
              laterButtons.push(...frameLater);
              
              const frameLaterText = await frame.getByText(/^LATER$/i).all();
              if (frameLaterText.length > 0) {
                console.log(`[dynamicWait] 🔍 Found ${frameLaterText.length} Later element(s) in iframe by text`);
              }
              laterButtons.push(...frameLaterText);
              
              const frameLaterId = await frame.locator('#popup-later').all();
              if (frameLaterId.length > 0) {
                console.log(`[dynamicWait] 🔍 Found ${frameLaterId.length} Later button(s) in iframe by id`);
              }
              laterButtons.push(...frameLaterId);
            }
          } catch (iframeError) {
            console.log(`[dynamicWait] ⚠ Iframe access error: ${iframeError.message}`);
          }
          
          console.log(`[dynamicWait] 🔍 Total Later buttons/elements found: ${laterButtons.length}`);
          
          if (laterButtons.length > 0) {
            console.log(`[dynamicWait] 🔘 Found total ${laterButtons.length} "Later" button(s) - clicking first one...`);
            // Click the first "Later" button found
            try {
              await laterButtons[0].click();
              console.log(`[dynamicWait] ✓ Clicked "Later" button`);
              // Reset stability after clicking popup button
              stableCount = 0;
            } catch (clickError) {
              console.log(`[dynamicWait] ⚠ Failed to click "Later" button: ${clickError.message}`);
            }
          }
        } catch (error) {
          console.log(`[dynamicWait] ⚠ Later button detection error: ${error.message}`);
        }
        
        const currentCount = await countVisibleElements();
        
        // Log every cycle for debugging
        if (cycleCount % 3 === 0) {
          console.log(`[dynamicWait] Cycle ${cycleCount}: ${currentCount.total} elements, stable: ${stableCount}/${stabilityChecks}, spinner: ${hasSpinner}`);
        }
        
        // Only check stability if no spinner is present
        if (!hasSpinner) {
          if (JSON.stringify(currentCount) === JSON.stringify(previousCount)) {
            stableCount++;
            
            if (stableCount >= stabilityChecks && !noEarlyExit) {
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
            
            // Log what changed
            /** @type {string[]} */
            const changes = [];
            Object.keys(currentCount.counts).forEach(selector => {
              const prev = previousCount.counts[selector] || 0;
              const curr = currentCount.counts[selector];
              if (prev !== curr) {
                changes.push(`${selector}: ${prev}→${curr}`);
              }
            });
            
            console.log(`[dynamicWait] 🔄 Count changed: ${previousCount.total}→${currentCount.total} (${changes.join(', ')})`);
            previousCount = currentCount;
          }
        } else {
          // Spinner present - update previous count but don't check stability
          if (previousCount.total !== currentCount.total) {
            console.log(`[dynamicWait] ⏳ Spinner active, count: ${previousCount.total}→${currentCount.total}`);
          }
          previousCount = currentCount;
        }
      } catch (error) {
        stableCount = 0;
      }
      
      cycleCount++;
      await page.waitForTimeout(pollInterval);
    }
    
    // After loop ends, ensure page load states are complete
    try {
      //console.log(`[dynamicWait] ⏳ Waiting for load state 'load'...`);
      await originalWaitForLoadState.call(page, 'load');
      await originalWaitForLoadState.call(page, 'domcontentloaded');
      await originalWaitForLoadState.call(page, 'networkidle', { timeout: 5000 });
      //console.log(`[dynamicWait] ✓ Load state 'load' complete`);
    } catch (error) {
      //Eat the error
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
    
    // Add clickAdv - advanced click with dynamicWait before and after
    locator.clickAdv = async function(/** @type {any} */ options) {
      const { fileName, lineNumber } = getCallerInfo();
      let locatorDesc = 'locator';
      try {
        locatorDesc = this.toString();
      } catch (e) {
        // Ignore
      }
      
      console.log(`[${fileName}:${lineNumber}] clickAdv ${locatorDesc} - waiting before click...`);
      
      // Get page from locator
      const page = this.page();
      
      // Wait for stability before click
      await page.dynamicWait(1000);
      
      // Try to click with error handling
      try {
        console.log(`[${fileName}:${lineNumber}] clickAdv ${locatorDesc} - clicking...`);
        await originalClick.call(this, options);
        console.log(`[${fileName}:${lineNumber}] clickAdv ${locatorDesc} - click successful`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`[${fileName}:${lineNumber}] clickAdv ${locatorDesc} - ❌ Click failed: ${errorMsg}`);
        throw error;
      }
      
      // Wait for stability after click (longer to catch delayed popups, no early exit)
      console.log(`[${fileName}:${lineNumber}] clickAdv ${locatorDesc} - waiting after click...`);
      await page.dynamicWait(8000, true); // true = no early exit, wait full duration for popups
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

/**
 * Advanced expect wrapper that runs dynamicWait before assertion
 * This helps catch and clear popups/toasts before performing assertions
 * @param {any} locator - Playwright locator to assert on
 * @returns {Promise<any>} - Promise that resolves to the locator (use with expect)
 */
async function expectAdv(locator) {
  const { fileName, lineNumber } = getCallerInfo();
  
  try {
    // Get page from locator
    const page = locator.page();
    
    console.log(`[${fileName}:${lineNumber}] expectAdv - running dynamicWait to handle popups/toasts...`);
    
    // Run dynamicWait to allow popups/toasts to appear and be handled
    await page.dynamicWait(5000);
    
    console.log(`[${fileName}:${lineNumber}] expectAdv - returning locator for assertion...`);
  } catch (error) {
    console.log(`[${fileName}:${lineNumber}] expectAdv - warning: could not run dynamicWait`);
  }
  
  // Return the locator so it can be used with expect()
  return locator;
}

module.exports = { patchPageAndLocators, expectAdv };
