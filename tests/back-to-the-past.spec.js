const { test } = require('./fixtures');
const { expect } = require('@playwright/test');
const BackToThePastPage = require('./back-to-the-past.page');
const { patchPageAndLocators } = require('./console-logger');

// @ts-ignore - dynamicWait is a custom fixture
test('Back To The Past', async ({ page, dynamicWait }) => {
  test.setTimeout(60000); // 1 minute timeout
  
  // Setup console logger with monkey patching on the page instance
  patchPageAndLocators(page);
  
  const backToThePastPage = new BackToThePastPage(page, dynamicWait);

// Todo: Test must close random popup by clicking "Later" button

  // Step 1: Navigate to the website
  await backToThePastPage.goto();
    await page.waitForTimeout(1000);


  // Step 2: Show full screen
  await backToThePastPage.toggleSidebar();

  // Step 3: Click "Wait For Popup and Toast Message"
  await backToThePastPage.clickWaitWithPopupButton();

  // Validate the Syncing With Hill Valley Toast message - Fails here!!!
  await expect(await backToThePastPage.verifySyncingMessageVisible()).toBeVisible();

  // Step 4: Click 'Back to the Past' button
  await backToThePastPage.clickBackToThePastButton();

  // Verify the final message is visible
  await expect(await backToThePastPage.verifyConstructionMessageVisible()).toBeVisible();
});


