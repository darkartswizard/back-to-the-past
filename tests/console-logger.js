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
  // Monkey patch Page.waitForTimeout
  const originalWaitForTimeout = page.waitForTimeout;
  page.waitForTimeout = async function(/** @type {any} */ timeout) {
    const { fileName, lineNumber } = getCallerInfo();
    console.log(`[${fileName}:${lineNumber}] waitForTimeout(${timeout}ms)`);
    return await originalWaitForTimeout.call(this, timeout);
  };

  // Monkey patch Page.waitForLoadState
  const originalWaitForLoadState = page.waitForLoadState;
  page.waitForLoadState = async function(/** @type {any} */ state, /** @type {any} */ options) {
    const { fileName, lineNumber } = getCallerInfo();
    console.log(`[${fileName}:${lineNumber}] waitForLoadState('${state || 'load'}')`);
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
      console.log(`[${fileName}:${lineNumber}] click() on ${locatorDesc}`);
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
