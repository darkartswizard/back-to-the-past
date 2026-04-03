# GitHub Copilot Instructions for Back to the Past Project

## Playwright Test Automation Guidelines

### Dynamic Wait Usage

**Always use `dynamicWait()` instead of `waitForTimeout()`**

- `dynamicWait()` is an intelligent wait that polls for page stability and exits early when stable
- It detects and handles spinners, toasts, and popups automatically
- Provides significant time savings over fixed waits

```javascript
// ❌ Don't use
await page.waitForTimeout(5000);

// ✅ Use instead
await page.dynamicWait(5000);
```

#### Hard-Coded Wait Convention

When a wait time is explicitly needed (not for stability), append `1` to the milliseconds value and provide a reason:

```javascript
// Signal this is intentional hard-coded wait
await page.dynamicWait(1001, false, 'Waiting for animation to complete');
await page.dynamicWait(2001, false, 'Server processing delay expected');
```

**Important:** If wait time ends with `1` but no reason is provided, a strong warning will be logged.

### Advanced Click Usage

**Always use `clickAdv()` instead of `click()` for interactive elements**

- `clickAdv()` automatically waits for stability before clicking
- Waits for popups/toasts after clicking (with full duration mode enabled)
- Provides better error handling and logging

```javascript
// ❌ Don't use
await button.click();
await page.waitForTimeout(5000);

// ✅ Use instead
await button.clickAdv();
```

The `clickAdv()` method handles:
- Pre-click stability wait (1000ms with early exit)
- Click action with error handling
- Post-click stability wait (8000ms full duration to catch delayed popups)
- Automatic "Later" button detection and dismissal

### Advanced Expect Usage

**Use `expectAdv()` for assertions that might have popups/toasts**

```javascript
// ✅ Handles popups before assertion
await expect(await expectAdv(locator)).toBeVisible();
```

The `expectAdv()` function:
- Runs `dynamicWait(5000)` before the assertion
- Allows time for popups/toasts to appear and be handled
- Returns the locator for use with standard Playwright expect

### Console Logger Activation

All tests should activate the console logger at the start:

```javascript
const { patchPageAndLocators, expectAdv } = require('./console-logger');

test('Test name', async ({ page }) => {
  patchPageAndLocators(page); // Activates dynamicWait, clickAdv, logging
  
  // Your test code here
});
```

### Features Provided by Console Logger

- **Element stability detection**: Polls for consistent element counts
- **Spinner detection**: Detects and highlights spinners (red/yellow flash)
- **Toast detection**: Detects and highlights toasts (green flash)
- **Popup auto-dismissal**: Automatically clicks "Later" buttons
- **File/line logging**: All waits and clicks show source location
- **Time savings reporting**: Shows time saved vs fixed waits

### Best Practices

1. Replace all `page.waitForTimeout()` with `page.dynamicWait()`
2. Replace all `locator.click()` with `locator.clickAdv()` for interactive elements
3. Use `expectAdv()` when assertions might be blocked by popups
4. Add reason parameter when using intentional hard-coded waits (ms ending in 1)
5. Let dynamicWait handle spinner detection instead of manual polling
