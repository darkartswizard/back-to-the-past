class BackToThePastPage {
  /**
   * @param {any} page
   */
  constructor(page) {
    this.page = page;
    this.iframe = page.locator('iframe[name="contentWindow"]');
    
    // Buttons
    this.toggleSidebarButton = page.getByRole('button', { name: 'Toggle Sidebar' });
    
    // Text elements
    this.syncingMessage = 'Syncing With Hill Valley';
    this.constructionMessage = 'The construction of meaning';
  }

  async getContentFrame() {
    return await this.iframe.contentFrame();
  }

  async goto() {
    await this.page.goto('https://websim.com/@DarkArtsWizard/too-many-waits/80');
    
    // Wait for page load completion
    await this.page.waitForLoadState('domcontentloaded');
    
    // Additional wait for dynamic content - using dynamicWait
    await this.page.dynamicWait(1500);
    
    // Wait for iframe to be available
    await this.iframe.waitFor({ state: 'visible', timeout: 5000 });
  }

  async toggleSidebar() {
    
    await this.toggleSidebarButton.click();
    
    // Wait for animation to complete - using dynamicWait
    await this.page.dynamicWait(800);
  }

  async clickWaitWithPopupButton() {
    const frame = await this.getContentFrame();
    
    // Wait for frame to be fully loaded - using dynamicWait
    //await this.page.waitForTimeout(5000); //Drop in replacement
    await this.page.dynamicWait(5000);
    
    const button = frame.getByRole('button', { name: 'WAIT WITH POPUP AND TOAST' });

    
    await button.click();
    
    // Wait for popup/toast processing - using dynamicWait
    await this.page.dynamicWait(2000);
  }

  async verifySyncingMessageVisible() {
    const frame = await this.getContentFrame();
    
    // Dynamic wait with polling for toast message
    const message = frame.getByText(this.syncingMessage);
    
    // Additional stability wait - using dynamicWait
    await this.page.dynamicWait(500);
    
    return message;
  }

  async clickBackToThePastButton() {
    const frame = await this.getContentFrame();
    
    // Wait for any animations to settle
    await this.page.waitForTimeout(1000);
    
    const button = frame.getByRole('button', { name: 'BACK TO THE PAST' });
    
    // Ensure button is ready and stable
    await button.waitFor({ state: 'visible', timeout: 5000 });
    
    // Wait for button to be enabled
    await this.page.waitForTimeout(300);
    
    await button.click();
    
    // Wait for navigation/transition
    await this.page.waitForTimeout(1500);
  }

  async verifyConstructionMessageVisible() {
    const frame = await this.getContentFrame();
    
    // Wait for page transition to complete
    await this.page.waitForTimeout(800);
    
    const message = frame.getByText(this.constructionMessage);
    
    // Custom wait with retry logic
    let retries = 0;
    const maxRetries = 5;
    
    while (retries < maxRetries) {
      try {
        await message.waitFor({ state: 'visible', timeout: 2000 });
        break;
      } catch (error) {
        retries++;
        if (retries === maxRetries) throw error;
        await this.page.waitForTimeout(1000);
      }
    }
    
    // Final stability check
    await this.page.waitForTimeout(500);
    
    return message;
  }
}

module.exports = BackToThePastPage;
