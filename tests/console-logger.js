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
    
    // Small initial wait
    await page.waitForTimeout(minWait);
    
    let previousCount = await countVisibleElements();
    let stableCount = 0;
    
    // Poll for element count stability
    while (Date.now() - startTime < maxWait) {
      await page.waitForTimeout(pollInterval);
      
      try {
        const currentCount = await countVisibleElements();
        
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
      } catch (error) {
        stableCount = 0;
      }
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
    // Skip logging for internal fixture calls
    if (fileName !== 'fixtures.js' && fileName !== 'console-logger.js') {
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
