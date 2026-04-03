const { test: base } = require('@playwright/test');
const path = require('path');

/**
 * Get caller information for logging
 */
function getCallerInfo() {
  const stack = new Error().stack;
  if (!stack) return { fileName: 'unknown', lineNumber: '?' };
  
  const stackLines = stack.split('\n');
  
  // Find the first line that's not from this fixtures file
  for (let i = 3; i < stackLines.length; i++) {
    const line = stackLines[i];
    if (!line.includes('fixtures.js') && line.includes('at ')) {
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
 * Dynamic wait fixture - a smarter alternative to waitForTimeout
 */
// @ts-ignore - Custom fixture extension
const test = base.extend({
  /**
   * Dynamic wait that polls for page stability
   */
  // @ts-ignore - Custom fixture
  dynamicWait: async ({ page }, use) => {
    const dynamicWait = async (/** @type {number} */ ms) => {
      const { fileName, lineNumber } = getCallerInfo();
      const originalWaitTime = ms || 1000;
      console.log(`[${fileName}:${lineNumber}] dynamicWait(${originalWaitTime}ms) - polling for element stability`);
      
      const startTime = Date.now();
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
            'a',        // Anchor (link)
            'button',   // Button
            'input',    // Input
            'textarea', // Textarea
            'select',   // Dropdown
            'ul',       // Unordered list
            'ol',       // Ordered list
            'img',      // Image
            'svg',      // SVG
            'div',      // Div
            'label'     // Label
          ];
          
          const counts = {};
          let total = 0;
          
          selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            let visibleCount = 0;
            
            elements.forEach(el => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              
              // Check if element is visible
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
          
          // Check if counts are stable (unchanged)
          if (JSON.stringify(currentCount) === JSON.stringify(previousCount)) {
            stableCount++;
            
            if (stableCount >= stabilityChecks) {
              // Page is stable - calculate difference
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
            // Count changed, reset stability counter
            stableCount = 0;
            previousCount = currentCount;
          }
        } catch (error) {
          // Ignore evaluation errors and continue polling
          stableCount = 0;
        }
      }
      
      // Max timeout reached without stability
      const actualTime = Date.now() - startTime;
      const difference = originalWaitTime - actualTime;
      const currentCount = await countVisibleElements();
      console.log(`[dynamicWait] ⚠ Max wait ${actualTime}ms reached without stability (${Math.abs(difference)}ms vs waitForTimeout(${originalWaitTime}ms)) - ${currentCount.total} visible elements`);
    };
    
    await use(dynamicWait);
  },
});

module.exports = { test };
