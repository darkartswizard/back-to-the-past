const { test, expect } = require('@playwright/test');

test('Back To The Past', async ({ page }) => {

// Navigate to the website
  await page.goto('https://websim.com/@DarkArtsWizard/too-many-waits/80');

 // Show full screen
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();

 // Click "Wait For Popup and Toast Message"
  await page.locator('iframe[name="contentWindow"]').contentFrame().getByRole('button', { name: 'WAIT WITH POPUP AND TOAST' }).click();

//Validate the Syncing With Hill Valley Toast message
  await expect(page.locator('iframe[name="contentWindow"]').contentFrame().getByText('Syncing With Hill Valley')).toBeVisible();

// Click Back to the Past button 
  await page.locator('iframe[name="contentWindow"]').contentFrame().getByRole('button', { name: 'BACK TO THE PAST' }).click();
    

//Verify the final message is visible
  await expect(page.locator('iframe[name="contentWindow"]').contentFrame().getByText('The construction of meaning')).toBeVisible();

});


