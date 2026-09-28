# 🎭 Complete Playwright Automation Framework
## Site: https://www.saucedemo.com | Built Step by Step (Code 1–13)

---

## 📁 Final Project Structure

```
myFramework/
├── .env
├── playwright.config.js
├── package.json
├── config/
│   └── env.js
├── pages/
│   ├── LoginPage.js
│   ├── ProductsPage.js
│   ├── CartPage.js
│   └── CheckoutPage.js
├── utils/
│   ├── WaitUtils.js
│   └── Logger.js
├── fixtures/
│   └── baseFixture.js
├── data/
│   └── testData.js
└── tests/
    ├── login/
    │   └── login.spec.js
    ├── products/
    │   └── products.spec.js
    ├── cart/
    │   └── cart.spec.js
    └── e2e/
        └── checkout.spec.js
```

---

## CODE 1 — Project Setup: `package.json` + `playwright.config.js`

### Step 1A — Terminal commands

```bash
mkdir myFramework
cd myFramework
npm init -y
npm install -D @playwright/test
npx playwright install
npm install dotenv
```

### Step 1B — `package.json`

```json
{
  "name": "my-playwright-framework",
  "version": "1.0.0",
  "description": "Playwright E2E automation framework for SauceDemo",
  "scripts": {
    "test":          "playwright test",
    "test:login":    "playwright test tests/login/",
    "test:products": "playwright test tests/products/",
    "test:cart":     "playwright test tests/cart/",
    "test:e2e":      "playwright test tests/e2e/",
    "test:headed":   "playwright test --headed",
    "test:debug":    "playwright test --debug",
    "report":        "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0"
  },
  "dependencies": {
    "dotenv": "^16.0.0"
  }
}
```

### Step 1C — `playwright.config.js`

```js
// playwright.config.js
const { defineConfig } = require('@playwright/test');
const dotenv = require('dotenv');
const path   = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

module.exports = defineConfig({

  testDir:      './tests',
  testMatch:    ['**/*.spec.js'],
  fullyParallel: false,
  workers:       1,

  timeout: 60_000,        // each test: 60s max
  expect:  { timeout: 8_000 },  // each expect: 8s max
  retries: 0,

  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL:    process.env.BASE_URL || 'https://www.saucedemo.com',
    headless:   true,
    viewport:   { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
    trace:      'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use:  { browserName: 'chromium' },
    },
  ],
});
```

---

## CODE 2 — Environment Config: `.env` + `config/env.js`

### Step 2A — `.env`

```env
BASE_URL=https://www.saucedemo.com
VALID_EMAIL=standard_user
VALID_PASSWORD=secret_sauce
LOCKED_USER=locked_out_user
LOCKED_PASSWORD=secret_sauce
PROBLEM_USER=problem_user
PROBLEM_PASSWORD=secret_sauce
TEST_ENV=dev
SLOWMO=0
```

### Step 2B — `config/env.js`

```js
// config/env.js
require('dotenv').config();

const ENV = process.env.TEST_ENV || 'dev';

const config = {
  dev: {
    baseURL:        process.env.BASE_URL        || 'https://www.saucedemo.com',
    validUser:      process.env.VALID_EMAIL     || 'standard_user',
    validPassword:  process.env.VALID_PASSWORD  || 'secret_sauce',
    lockedUser:     process.env.LOCKED_USER     || 'locked_out_user',
    lockedPassword: process.env.LOCKED_PASSWORD || 'secret_sauce',
    problemUser:    process.env.PROBLEM_USER    || 'problem_user',
  },
};

module.exports = { ...config[ENV], env: ENV };
```

---

## CODE 3 — Utils: `utils/WaitUtils.js` + `utils/Logger.js`

### Step 3A — `utils/WaitUtils.js`

```js
// utils/WaitUtils.js
class WaitUtils {

  // Wait until element is VISIBLE
  static async waitForVisible(locator, timeout = 10000) {
    await locator.first().waitFor({ state: 'visible', timeout });
  }

  // Wait until element is HIDDEN (loaders, overlays)
  static async waitForHidden(locator, timeout = 10000) {
    await locator.first().waitFor({ state: 'hidden', timeout });
  }

  // Wait for full page load
  static async waitForPageLoad(page, timeout = 15000) {
    await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
    await page.waitForLoadState('networkidle',      { timeout }).catch(() => {});
  }

  // Wait for URL to match a pattern
  static async waitForURL(page, pattern, timeout = 10000) {
    await page.waitForURL(pattern, { timeout });
  }

  // Fixed pause — use sparingly!
  static async pause(page, ms = 500) {
    await page.waitForTimeout(ms);
  }
}

module.exports = { WaitUtils };
```

### Step 3B — `utils/Logger.js`

```js
// utils/Logger.js
const fs   = require('fs');
const path = require('path');

const C = {
  Reset:   '\x1b[0m',
  Gray:    '\x1b[90m',
  Red:     '\x1b[31m',
  Green:   '\x1b[32m',
  Yellow:  '\x1b[33m',
  Cyan:    '\x1b[36m',
  Magenta: '\x1b[35m',
  Bold:    '\x1b[1m',
};

class Logger {
  constructor() {
    this.logsDir = path.resolve(process.cwd(), 'logs');
    this.logFile = path.join(this.logsDir, 'execution.log');
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  _ts() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  _log(badge, level, color, msg) {
    const ts = this._ts();
    console.log(`${C.Gray}[${ts}]${C.Reset} ${badge} ${color}${C.Bold}[${level}]${C.Reset} ${msg}`);
    try { fs.appendFileSync(this.logFile, `[${ts}] [${level}] ${msg}\n`); } catch (_) {}
  }

  info(msg)    { this._log('ℹ️ ', 'INFO',    C.Cyan,    msg); }
  success(msg) { this._log('✅', 'SUCCESS', C.Green,   msg); }
  step(msg)    { this._log('⌛', 'STEP',    C.Magenta, msg); }
  warn(msg)    { this._log('⚠️ ', 'WARN',    C.Yellow,  msg); }
  error(msg)   { this._log('❌', 'ERROR',   C.Red,     msg); }

  startGroup(title) {
    this.info(`\n${'─'.repeat(50)}\n🚀 ${title}\n${'─'.repeat(50)}`);
  }

  async attachToReport(testInfo) {
    if (!testInfo) return;
    try {
      if (fs.existsSync(this.logFile)) {
        await testInfo.attach('execution-log', {
          path: this.logFile, contentType: 'text/plain',
        });
      }
    } catch (_) {}
  }
}

const logger = new Logger();
module.exports = { logger, Logger };
```

---

## CODE 4 — Page Object: `pages/LoginPage.js`

```js
// pages/LoginPage.js
const { WaitUtils } = require('../utils/WaitUtils');
const { logger }    = require('../utils/Logger');

class LoginPage {
  constructor(page) {
    this.page = page;

    // LOCATORS
    this.usernameInput  = page.locator('#user-name');
    this.passwordInput  = page.locator('#password');
    this.loginButton    = page.locator('#login-button');
    this.errorMessage   = page.locator('[data-test="error"]');
    this.errorCloseBtn  = page.locator('.error-button');
    this.loginLogo      = page.locator('.login_logo');
    this.usernameList   = page.locator('.login_credentials');
  }

  // Navigate to login page
  async navigate(url = 'https://www.saucedemo.com') {
    logger.step(`Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await WaitUtils.waitForVisible(this.loginButton, 15000);
    logger.success('Login page loaded.');
  }

  // Fill username + password + click Login
  async login(username, password) {
    logger.step(`Logging in as: ${username}`);
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
    await WaitUtils.waitForPageLoad(this.page);
  }

  // Get error message text
  async getErrorMessage() {
    await WaitUtils.waitForVisible(this.errorMessage, 8000);
    const text = await this.errorMessage.textContent();
    return text.trim();
  }

  // Close error popup
  async closeError() {
    await this.errorCloseBtn.click();
  }

  // Check if logged in (on inventory page)
  async isLoggedIn() {
    return this.page.url().includes('/inventory');
  }
}

module.exports = { LoginPage };
```

---

## CODE 5 — Page Objects: `ProductsPage.js` + `CartPage.js`

### Step 5A — `pages/ProductsPage.js`

```js
// pages/ProductsPage.js
const { WaitUtils } = require('../utils/WaitUtils');
const { logger }    = require('../utils/Logger');

class ProductsPage {
  constructor(page) {
    this.page = page;

    // LOCATORS
    this.pageTitle        = page.locator('.title');
    this.productItems     = page.locator('.inventory_item');
    this.productNames     = page.locator('.inventory_item_name');
    this.productPrices    = page.locator('.inventory_item_price');
    this.cartIcon         = page.locator('.shopping_cart_link');
    this.cartBadge        = page.locator('.shopping_cart_badge');
    this.sortDropdown     = page.locator('[data-test="product_sort_container"]');
    this.burgerMenu       = page.locator('#react-burger-menu-btn');
    this.logoutLink       = page.locator('#logout_sidebar_link');
    this.productImages    = page.locator('.inventory_item_img img');
  }

  // Add product to cart by name
  async addToCartByName(productName) {
    logger.step(`Adding: "${productName}"`);
    const item   = this.page.locator('.inventory_item').filter({ hasText: productName });
    const addBtn = item.locator('[data-test^="add-to-cart"]');
    await WaitUtils.waitForVisible(addBtn);
    await addBtn.click();
    logger.success(`Added: "${productName}"`);
  }

  // Remove product from cart by name
  async removeFromCartByName(productName) {
    logger.step(`Removing: "${productName}"`);
    const item      = this.page.locator('.inventory_item').filter({ hasText: productName });
    const removeBtn = item.locator('[data-test^="remove"]');
    await removeBtn.click();
  }

  // Click cart icon → go to cart page
  async goToCart() {
    logger.step('Going to cart...');
    await this.cartIcon.click();
    await WaitUtils.waitForURL(this.page, /cart/);
  }

  // Get cart badge number
  async getCartCount() {
    const visible = await this.cartBadge.isVisible();
    if (!visible) return '0';
    return await this.cartBadge.textContent();
  }

  // Count of products on page
  async getProductCount() {
    return await this.productItems.count();
  }

  // All product names as array
  async getAllProductNames() {
    const names = await this.productNames.allTextContents();
    return names.map(n => n.trim());
  }

  // All product prices as numbers
  async getAllPrices() {
    const prices = await this.productPrices.allTextContents();
    return prices.map(p => parseFloat(p.replace('$', '')));
  }

  // Sort using dropdown
  async sortProducts(option) {
    logger.step(`Sorting by: ${option}`);
    await this.sortDropdown.selectOption(option);
    await WaitUtils.pause(this.page, 500);
  }

  // Open menu and logout
  async logout() {
    logger.step('Logging out...');
    await this.burgerMenu.click();
    await WaitUtils.waitForVisible(this.logoutLink);
    await this.logoutLink.click();
    await WaitUtils.waitForURL(this.page, /saucedemo\.com\/?$/);
    logger.success('Logged out.');
  }
}

module.exports = { ProductsPage };
```

### Step 5B — `pages/CartPage.js`

```js
// pages/CartPage.js
const { WaitUtils } = require('../utils/WaitUtils');
const { logger }    = require('../utils/Logger');

class CartPage {
  constructor(page) {
    this.page = page;

    // LOCATORS
    this.pageTitle       = page.locator('.title');
    this.cartItems       = page.locator('.cart_item');
    this.itemNames       = page.locator('.inventory_item_name');
    this.itemPrices      = page.locator('.inventory_item_price');
    this.continueShopBtn = page.locator('[data-test="continue-shopping"]');
    this.checkoutBtn     = page.locator('[data-test="checkout"]');
  }

  // Count of items in cart
  async getItemCount() {
    return await this.cartItems.count();
  }

  // All item names as array
  async getItemNames() {
    const names = await this.itemNames.allTextContents();
    return names.map(n => n.trim());
  }

  // All prices as numbers
  async getPrices() {
    const prices = await this.itemPrices.allTextContents();
    return prices.map(p => parseFloat(p.replace('$', '')));
  }

  // Remove item by name
  async removeItem(itemName) {
    logger.step(`Removing: "${itemName}"`);
    const item = this.page.locator('.cart_item').filter({ hasText: itemName });
    await item.locator('[data-test^="remove"]').click();
  }

  // Click Continue Shopping → back to products
  async continueShopping() {
    await this.continueShopBtn.click();
    await WaitUtils.waitForURL(this.page, /inventory/);
  }

  // Click Checkout → go to checkout form
  async proceedToCheckout() {
    logger.step('Proceeding to checkout...');
    await WaitUtils.waitForVisible(this.checkoutBtn);
    await this.checkoutBtn.click();
    await WaitUtils.waitForURL(this.page, /checkout-step-one/);
  }

  // Check if item exists in cart
  async hasItem(itemName) {
    const count = await this.page.locator('.cart_item').filter({ hasText: itemName }).count();
    return count > 0;
  }
}

module.exports = { CartPage };
```

---

## CODE 6 — Page Object: `pages/CheckoutPage.js`

```js
// pages/CheckoutPage.js
const { WaitUtils } = require('../utils/WaitUtils');
const { logger }    = require('../utils/Logger');

class CheckoutPage {
  constructor(page) {
    this.page = page;

    // STEP 1 LOCATORS
    this.firstNameInput  = page.locator('[data-test="firstName"]');
    this.lastNameInput   = page.locator('[data-test="lastName"]');
    this.postalCodeInput = page.locator('[data-test="postalCode"]');
    this.continueBtn     = page.locator('[data-test="continue"]');
    this.cancelBtn       = page.locator('[data-test="cancel"]');
    this.errorMessage    = page.locator('[data-test="error"]');

    // STEP 2 LOCATORS
    this.subtotalLabel   = page.locator('.summary_subtotal_label');
    this.taxLabel        = page.locator('.summary_tax_label');
    this.totalLabel      = page.locator('.summary_total_label');
    this.finishBtn       = page.locator('[data-test="finish"]');

    // CONFIRMATION LOCATORS
    this.thankYouHeader  = page.locator('.complete-header');
    this.backHomeBtn     = page.locator('[data-test="back-to-products"]');
  }

  // Fill checkout info form
  async fillCheckoutInfo(firstName, lastName, postalCode) {
    logger.step('Filling checkout info...');
    await WaitUtils.waitForVisible(this.firstNameInput);
    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    await this.postalCodeInput.fill(postalCode);
  }

  // Click Continue button
  async clickContinue() {
    await this.continueBtn.click();
    await WaitUtils.waitForPageLoad(this.page);
  }

  // Fill + Continue in one call
  async submitCheckoutInfo(firstName, lastName, postalCode) {
    await this.fillCheckoutInfo(firstName, lastName, postalCode);
    await this.clickContinue();
  }

  // Get error message text
  async getError() {
    await WaitUtils.waitForVisible(this.errorMessage, 5000);
    return (await this.errorMessage.textContent()).trim();
  }

  // Get subtotal ($)
  async getSubtotal() {
    const text = await this.subtotalLabel.textContent();
    return parseFloat(text.replace(/[^0-9.]/g, ''));
  }

  // Get tax ($)
  async getTax() {
    const text = await this.taxLabel.textContent();
    return parseFloat(text.replace(/[^0-9.]/g, ''));
  }

  // Get total ($)
  async getTotal() {
    const text = await this.totalLabel.textContent();
    return parseFloat(text.replace(/[^0-9.]/g, ''));
  }

  // Click Finish → place order
  async clickFinish() {
    logger.step('Clicking Finish...');
    await WaitUtils.waitForVisible(this.finishBtn);
    await this.finishBtn.click();
    await WaitUtils.waitForURL(this.page, /checkout-complete/);
    logger.success('Order placed!');
  }

  // Get "Thank you" confirmation text
  async getConfirmationHeader() {
    await WaitUtils.waitForVisible(this.thankYouHeader);
    return (await this.thankYouHeader.textContent()).trim();
  }

  // Click Back Home button
  async goBackHome() {
    await this.backHomeBtn.click();
    await WaitUtils.waitForURL(this.page, /inventory/);
  }
}

module.exports = { CheckoutPage };
```

---

## CODE 7 — Fixtures: `fixtures/baseFixture.js`

```js
// fixtures/baseFixture.js
const { test: base, expect } = require('@playwright/test');
const { LoginPage }          = require('../pages/LoginPage');
const { logger }             = require('../utils/Logger');
const config                 = require('../config/env');

const test = base.extend({

  // FIXTURE 1: logger — logs test start/end + attaches to report
  logger: async ({}, use, testInfo) => {
    logger.startGroup(testInfo.title);
    const start = Date.now();

    await use(logger);    // ← test runs here

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    if (testInfo.status === 'passed') {
      logger.success(`✅ PASSED: "${testInfo.title}" (${duration}s)`);
    } else {
      logger.error(`❌ FAILED: "${testInfo.title}" (${duration}s)`);
    }
    await logger.attachToReport(testInfo);
  },

  // FIXTURE 2: page — enhanced with logger
  page: async ({ page, logger }, use) => {
    logger.info(`Viewport: ${page.viewportSize()?.width}x${page.viewportSize()?.height}`);
    await use(page);
  },

  // FIXTURE 3: loggedInPage — auto-login before test!
  loggedInPage: async ({ page, logger }, use) => {
    logger.info('🔐 Auto-login starting...');
    const loginPage = new LoginPage(page);
    await loginPage.navigate(config.baseURL);
    await loginPage.login(config.validUser, config.validPassword);

    if (!page.url().includes('/inventory')) {
      throw new Error(`Login failed! URL: ${page.url()}`);
    }
    logger.success(`✅ Logged in as: ${config.validUser}`);

    await use(page);    // ← test runs with pre-logged-in page
  },

  // FIXTURE 4: autoWaitOnFailure — 3s pause after failure (auto)
  autoWaitOnFailure: [
    async ({}, use, testInfo) => {
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        logger.warn('Test failed — waiting 3s...');
        await new Promise(r => setTimeout(r, 3000));
      }
    },
    { auto: true },   // ← runs for EVERY test automatically
  ],
});

module.exports = { test, expect, logger };
```

---

## CODE 8 — Test Data: `data/testData.js`

```js
// data/testData.js

// LOGIN TEST DATA
const loginData = {

  // Valid users
  validUsers: [
    { username: 'standard_user',           password: 'secret_sauce' },
    { username: 'problem_user',            password: 'secret_sauce' },
    { username: 'performance_glitch_user', password: 'secret_sauce' },
  ],

  // Invalid users (negative tests)
  invalidUsers: [
    { id: 'TC-LGN-001', username: '',              password: '',             expectedError: 'Username is required' },
    { id: 'TC-LGN-002', username: 'standard_user', password: '',             expectedError: 'Password is required' },
    { id: 'TC-LGN-003', username: '',              password: 'secret_sauce', expectedError: 'Username is required' },
    { id: 'TC-LGN-004', username: 'wrong_user',    password: 'wrong_pass',   expectedError: 'Username and password do not match' },
    { id: 'TC-LGN-005', username: 'locked_out_user', password: 'secret_sauce', expectedError: 'Sorry, this user has been locked out' },
  ],
};

// PRODUCT TEST DATA
const productData = {
  allProducts: [
    'Sauce Labs Backpack',
    'Sauce Labs Bike Light',
    'Sauce Labs Bolt T-Shirt',
    'Sauce Labs Fleece Jacket',
    'Sauce Labs Onesie',
    'Test.allTheThings() T-Shirt (Red)',
  ],
  totalCount: 6,
  expectedPrices: {
    'Sauce Labs Backpack':     29.99,
    'Sauce Labs Bike Light':    9.99,
    'Sauce Labs Bolt T-Shirt': 15.99,
    'Sauce Labs Fleece Jacket':49.99,
    'Sauce Labs Onesie':        7.99,
    'Test.allTheThings() T-Shirt (Red)': 15.99,
  },
};

// CHECKOUT TEST DATA
const checkoutData = {
  validCustomer: {
    firstName:  'John',
    lastName:   'Doe',
    postalCode: '12345',
  },
  invalidCustomers: [
    { id: 'TC-CHK-001', firstName: '',     lastName: 'Doe', postalCode: '12345', error: 'First Name is required' },
    { id: 'TC-CHK-002', firstName: 'John', lastName: '',    postalCode: '12345', error: 'Last Name is required'  },
    { id: 'TC-CHK-003', firstName: 'John', lastName: 'Doe', postalCode: '',      error: 'Postal Code is required' },
  ],
};

module.exports = { loginData, productData, checkoutData };
```

---

## CODE 9 — Tests: `tests/login/login.spec.js` (15 Test Cases)

```js
// tests/login/login.spec.js
const { test, expect } = require('@playwright/test');
const { LoginPage }    = require('../../pages/LoginPage');
const { loginData }    = require('../../data/testData');
const config           = require('../../config/env');

test.describe('🔑 Login Module Tests', () => {

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate(config.baseURL);
  });

  // ── POSITIVE TESTS ───────────────────────────────────────────
  test.describe('✅ Positive Tests', () => {

    test('TC-LGN-P01 | Valid login redirects to products page', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.login(config.validUser, config.validPassword);
      await expect(page).toHaveURL(/inventory/);
      await expect(page.locator('.title')).toHaveText('Products');
    });

    test('TC-LGN-P02 | Login page shows accepted usernames', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await expect(loginPage.usernameList).toBeVisible();
      await expect(loginPage.usernameList).toContainText('standard_user');
    });

    test('TC-LGN-P03 | Logout returns to login page', async ({ page }) => {
      const { ProductsPage } = require('../../pages/ProductsPage');
      const loginPage    = new LoginPage(page);
      const productsPage = new ProductsPage(page);
      await loginPage.login(config.validUser, config.validPassword);
      await productsPage.logout();
      await expect(page).toHaveURL(/saucedemo\.com\/?$/);
      await expect(loginPage.loginButton).toBeVisible();
    });

    test('TC-LGN-P04 | Page title is "Swag Labs"', async ({ page }) => {
      await expect(page).toHaveTitle('Swag Labs');
    });

    test('TC-LGN-P05 | Login logo is visible', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await expect(loginPage.loginLogo).toBeVisible();
    });
  });

  // ── NEGATIVE TESTS (Data-Driven) ─────────────────────────────
  test.describe('❌ Negative Tests', () => {

    for (const data of loginData.invalidUsers) {
      test(`${data.id} | Error shown for: "${data.username || 'empty'}" / "${data.password || 'empty'}"`, async ({ page }) => {
        const loginPage = new LoginPage(page);
        await loginPage.login(data.username, data.password);
        const errorText = await loginPage.getErrorMessage();
        expect(errorText).toContain(data.expectedError);
      });
    }

    test('TC-LGN-N06 | Error message dismissed with X button', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.login('wrong', 'wrong');
      await expect(loginPage.errorMessage).toBeVisible();
      await loginPage.closeError();
      await expect(loginPage.errorMessage).not.toBeVisible();
    });

    test('TC-LGN-N07 | Error has "error" CSS class (red styling)', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.login('', '');
      await expect(loginPage.errorMessage).toHaveClass(/error/);
    });
  });

  // ── UI TESTS ─────────────────────────────────────────────────
  test.describe('🎨 UI Tests', () => {

    test('TC-LGN-UI01 | Username input is visible and enabled', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await expect(loginPage.usernameInput).toBeVisible();
      await expect(loginPage.usernameInput).toBeEnabled();
    });

    test('TC-LGN-UI02 | Password input is visible and enabled', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await expect(loginPage.passwordInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeEnabled();
    });

    test('TC-LGN-UI03 | Login button is visible and clickable', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await expect(loginPage.loginButton).toBeVisible();
      await expect(loginPage.loginButton).toBeEnabled();
    });

    test('TC-LGN-UI04 | Password field masks input (type=password)', async ({ page }) => {
      const loginPage = new LoginPage(page);
      const type = await loginPage.passwordInput.getAttribute('type');
      expect(type).toBe('password');
    });

    test('TC-LGN-UI05 | Username placeholder is "Username"', async ({ page }) => {
      const loginPage = new LoginPage(page);
      const ph = await loginPage.usernameInput.getAttribute('placeholder');
      expect(ph).toBe('Username');
    });
  });
});
```

---

## CODE 10 — Tests: `tests/products/products.spec.js` (15 Test Cases)

```js
// tests/products/products.spec.js
const { test, expect } = require('../../fixtures/baseFixture');
const { ProductsPage } = require('../../pages/ProductsPage');
const { productData }  = require('../../data/testData');

test.describe('🛍️ Products Page Tests', () => {

  // ── PRODUCT LISTING ───────────────────────────────────────────
  test.describe('📋 Product Listing', () => {

    test('TC-PRD-01 | Page shows exactly 6 products', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      expect(await p.getProductCount()).toBe(6);
    });

    test('TC-PRD-02 | All 6 product names are correct', async ({ loggedInPage }) => {
      const p     = new ProductsPage(loggedInPage);
      const names = await p.getAllProductNames();
      for (const name of productData.allProducts) {
        expect(names).toContain(name);
      }
    });

    test('TC-PRD-03 | Page title is "Products"', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await expect(p.pageTitle).toHaveText('Products');
    });

    test('TC-PRD-04 | All products have prices > 0', async ({ loggedInPage }) => {
      const p      = new ProductsPage(loggedInPage);
      const prices = await p.getAllPrices();
      expect(prices.length).toBe(6);
      for (const price of prices) { expect(price).toBeGreaterThan(0); }
    });

    test('TC-PRD-05 | All products have images', async ({ loggedInPage }) => {
      const p     = new ProductsPage(loggedInPage);
      const count = await p.productImages.count();
      expect(count).toBe(6);
    });
  });

  // ── ADD TO CART ───────────────────────────────────────────────
  test.describe('🛒 Add to Cart', () => {

    test('TC-PRD-06 | Adding 1 product → cart badge shows "1"', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      expect(await p.getCartCount()).toBe('1');
    });

    test('TC-PRD-07 | Adding 2 products → cart badge shows "2"', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.addToCartByName('Sauce Labs Bike Light');
      expect(await p.getCartCount()).toBe('2');
    });

    test('TC-PRD-08 | Add button becomes Remove after click', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      const item = loggedInPage.locator('.inventory_item').filter({ hasText: 'Sauce Labs Backpack' });
      await expect(item.locator('[data-test^="remove"]')).toBeVisible();
    });

    test('TC-PRD-09 | Removing added product hides cart badge', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.removeFromCartByName('Sauce Labs Backpack');
      await expect(loggedInPage.locator('.shopping_cart_badge')).not.toBeVisible();
    });

    test('TC-PRD-10 | Adding all 6 products → badge shows "6"', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      for (const name of productData.allProducts) { await p.addToCartByName(name); }
      expect(await p.getCartCount()).toBe('6');
    });
  });

  // ── SORTING ───────────────────────────────────────────────────
  test.describe('🔄 Sorting', () => {

    test('TC-PRD-11 | Sort A-Z → Backpack is first', async ({ loggedInPage }) => {
      const p     = new ProductsPage(loggedInPage);
      await p.sortProducts('az');
      const names = await p.getAllProductNames();
      expect(names[0]).toBe('Sauce Labs Backpack');
    });

    test('TC-PRD-12 | Sort Z-A → T-Shirt is first', async ({ loggedInPage }) => {
      const p     = new ProductsPage(loggedInPage);
      await p.sortProducts('za');
      const names = await p.getAllProductNames();
      expect(names[0]).toContain('Test.allTheThings');
    });

    test('TC-PRD-13 | Sort Price Low→High → cheapest ($7.99) first', async ({ loggedInPage }) => {
      const p      = new ProductsPage(loggedInPage);
      await p.sortProducts('lohi');
      const prices = await p.getAllPrices();
      expect(prices[0]).toBe(7.99);
    });

    test('TC-PRD-14 | Sort Price High→Low → most expensive ($49.99) first', async ({ loggedInPage }) => {
      const p      = new ProductsPage(loggedInPage);
      await p.sortProducts('hilo');
      const prices = await p.getAllPrices();
      expect(prices[0]).toBe(49.99);
    });

    test('TC-PRD-15 | Prices Low→High are in ascending order', async ({ loggedInPage }) => {
      const p      = new ProductsPage(loggedInPage);
      await p.sortProducts('lohi');
      const prices = await p.getAllPrices();
      for (let i = 0; i < prices.length - 1; i++) {
        expect(prices[i]).toBeLessThanOrEqual(prices[i + 1]);
      }
    });
  });
});
```

---

## CODE 11 — Tests: `tests/cart/cart.spec.js` (10 Test Cases)

```js
// tests/cart/cart.spec.js
const { test, expect } = require('../../fixtures/baseFixture');
const { ProductsPage } = require('../../pages/ProductsPage');
const { CartPage }     = require('../../pages/CartPage');

test.describe('🛒 Cart Page Tests', () => {

  // ── CART CONTENTS ─────────────────────────────────────────────
  test.describe('📦 Cart Contents', () => {

    test('TC-CRT-01 | Empty cart has 0 items', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.goToCart();
      const c = new CartPage(loggedInPage);
      expect(await c.getItemCount()).toBe(0);
    });

    test('TC-CRT-02 | Added product appears in cart', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.goToCart();
      const c = new CartPage(loggedInPage);
      expect(await c.hasItem('Sauce Labs Backpack')).toBe(true);
    });

    test('TC-CRT-03 | Two products appear in cart', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.addToCartByName('Sauce Labs Bike Light');
      await p.goToCart();
      const c = new CartPage(loggedInPage);
      expect(await c.getItemCount()).toBe(2);
    });

    test('TC-CRT-04 | Cart shows correct price ($29.99) for Backpack', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.goToCart();
      const c      = new CartPage(loggedInPage);
      const prices = await c.getPrices();
      expect(prices[0]).toBe(29.99);
    });

    test('TC-CRT-05 | Cart page title is "Your Cart"', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.goToCart();
      const c = new CartPage(loggedInPage);
      await expect(c.pageTitle).toHaveText('Your Cart');
    });

    test('TC-CRT-06 | Cart shows quantity "1" for each item', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.goToCart();
      const qty = loggedInPage.locator('.cart_quantity').first();
      await expect(qty).toHaveText('1');
    });
  });

  // ── REMOVE ITEMS ──────────────────────────────────────────────
  test.describe('🗑️ Remove Items', () => {

    test('TC-CRT-07 | Removing only item empties cart', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.goToCart();
      const c = new CartPage(loggedInPage);
      await c.removeItem('Sauce Labs Backpack');
      expect(await c.getItemCount()).toBe(0);
    });

    test('TC-CRT-08 | Removing one of two items leaves one', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.addToCartByName('Sauce Labs Bike Light');
      await p.goToCart();
      const c = new CartPage(loggedInPage);
      await c.removeItem('Sauce Labs Backpack');
      expect(await c.getItemCount()).toBe(1);
      expect(await c.hasItem('Sauce Labs Bike Light')).toBe(true);
    });
  });

  // ── NAVIGATION ────────────────────────────────────────────────
  test.describe('🔗 Navigation', () => {

    test('TC-CRT-09 | "Continue Shopping" returns to products', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.goToCart();
      const c = new CartPage(loggedInPage);
      await c.continueShopping();
      await expect(loggedInPage).toHaveURL(/inventory/);
    });

    test('TC-CRT-10 | "Checkout" navigates to checkout page', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.goToCart();
      const c = new CartPage(loggedInPage);
      await c.proceedToCheckout();
      await expect(loggedInPage).toHaveURL(/checkout-step-one/);
    });
  });
});
```

---

## CODE 12 — Tests: `tests/e2e/checkout.spec.js` (10 Test Cases)

```js
// tests/e2e/checkout.spec.js
const { test, expect } = require('../../fixtures/baseFixture');
const { ProductsPage } = require('../../pages/ProductsPage');
const { CartPage }     = require('../../pages/CartPage');
const { CheckoutPage } = require('../../pages/CheckoutPage');
const { checkoutData } = require('../../data/testData');

test.describe('🏁 E2E Checkout Flow', () => {

  // ── HAPPY PATH ────────────────────────────────────────────────
  test.describe('✅ Successful Order', () => {

    test('TC-E2E-01 | Buy 1 item end-to-end (Login→Cart→Checkout→Confirm)', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      const c = new CartPage(loggedInPage);
      const k = new CheckoutPage(loggedInPage);
      const { firstName, lastName, postalCode } = checkoutData.validCustomer;

      // Add → Cart → Checkout → Fill → Finish
      await p.addToCartByName('Sauce Labs Backpack');
      await p.goToCart();
      await c.proceedToCheckout();
      await k.submitCheckoutInfo(firstName, lastName, postalCode);

      // Verify math
      const subtotal = await k.getSubtotal();
      const tax      = await k.getTax();
      const total    = await k.getTotal();
      expect(subtotal).toBe(29.99);
      expect(total).toBeCloseTo(subtotal + tax, 2);

      await k.clickFinish();
      expect(await k.getConfirmationHeader()).toBe('Thank you for your order!');
    });

    test('TC-E2E-02 | Buy 2 items — subtotal is sum of both prices', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      const c = new CartPage(loggedInPage);
      const k = new CheckoutPage(loggedInPage);
      const { firstName, lastName, postalCode } = checkoutData.validCustomer;

      await p.addToCartByName('Sauce Labs Backpack');    // $29.99
      await p.addToCartByName('Sauce Labs Bike Light'); // $9.99
      await p.goToCart();
      await c.proceedToCheckout();
      await k.submitCheckoutInfo(firstName, lastName, postalCode);

      expect(await k.getSubtotal()).toBeCloseTo(39.98, 2);
      await k.clickFinish();
      expect(await k.getConfirmationHeader()).toBe('Thank you for your order!');
    });

    test('TC-E2E-03 | Back Home after order returns to products', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      const c = new CartPage(loggedInPage);
      const k = new CheckoutPage(loggedInPage);
      const { firstName, lastName, postalCode } = checkoutData.validCustomer;

      await p.addToCartByName('Sauce Labs Onesie');
      await p.goToCart();
      await c.proceedToCheckout();
      await k.submitCheckoutInfo(firstName, lastName, postalCode);
      await k.clickFinish();
      await k.goBackHome();
      await expect(loggedInPage).toHaveURL(/inventory/);
    });

    test('TC-E2E-04 | Confirmation page shows pony express image', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      const c = new CartPage(loggedInPage);
      const k = new CheckoutPage(loggedInPage);
      const { firstName, lastName, postalCode } = checkoutData.validCustomer;

      await p.addToCartByName('Sauce Labs Bolt T-Shirt');
      await p.goToCart();
      await c.proceedToCheckout();
      await k.submitCheckoutInfo(firstName, lastName, postalCode);
      await k.clickFinish();
      await expect(loggedInPage.locator('.pony_express')).toBeVisible();
    });
  });

  // ── VALIDATION ────────────────────────────────────────────────
  test.describe('❌ Checkout Validation', () => {

    // Helper: navigate to checkout step 1
    async function goToCheckoutStep1(page) {
      const p = new ProductsPage(page);
      const c = new CartPage(page);
      await p.addToCartByName('Sauce Labs Backpack');
      await p.goToCart();
      await c.proceedToCheckout();
    }

    // Data-driven: 3 invalid input cases
    for (const data of checkoutData.invalidCustomers) {
      test(`${data.id} | Error: "${data.error}"`, async ({ loggedInPage }) => {
        await goToCheckoutStep1(loggedInPage);
        const k = new CheckoutPage(loggedInPage);
        await k.fillCheckoutInfo(data.firstName, data.lastName, data.postalCode);
        await k.clickContinue();
        const errorText = await k.getError();
        expect(errorText).toContain(data.error);
      });
    }

    test('TC-CHK-04 | Cancel from checkout returns to cart', async ({ loggedInPage }) => {
      await goToCheckoutStep1(loggedInPage);
      const k = new CheckoutPage(loggedInPage);
      await k.cancelBtn.click();
      await expect(loggedInPage).toHaveURL(/cart/);
    });
  });

  // ── ORDER SUMMARY ─────────────────────────────────────────────
  test.describe('📊 Order Summary', () => {

    test('TC-SUM-01 | Summary shows correct product name', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      const c = new CartPage(loggedInPage);
      const k = new CheckoutPage(loggedInPage);
      const { firstName, lastName, postalCode } = checkoutData.validCustomer;

      await p.addToCartByName('Sauce Labs Fleece Jacket');
      await p.goToCart();
      await c.proceedToCheckout();
      await k.submitCheckoutInfo(firstName, lastName, postalCode);

      await expect(loggedInPage.locator('.inventory_item_name'))
        .toContainText('Sauce Labs Fleece Jacket');
    });

    test('TC-SUM-02 | Total = Subtotal + Tax (math verified)', async ({ loggedInPage }) => {
      const p = new ProductsPage(loggedInPage);
      const c = new CartPage(loggedInPage);
      const k = new CheckoutPage(loggedInPage);
      const { firstName, lastName, postalCode } = checkoutData.validCustomer;

      await p.addToCartByName('Sauce Labs Bolt T-Shirt');
      await p.goToCart();
      await c.proceedToCheckout();
      await k.submitCheckoutInfo(firstName, lastName, postalCode);

      const subtotal = await k.getSubtotal();
      const tax      = await k.getTax();
      const total    = await k.getTotal();
      expect(total).toBeCloseTo(subtotal + tax, 1);
    });
  });
});
```

---

## CODE 13 — Run Tests & View Reports

### Run Commands

```bash
# Run ALL 50 tests
npm test

# Run specific suite
npm run test:login       # 15 login tests
npm run test:products    # 15 product tests
npm run test:cart        # 10 cart tests
npm run test:e2e         # 10 E2E checkout tests

# Run with browser visible (headed)
npm run test:headed

# Run in debug mode (step-through)
npm run test:debug

# Run specific test by ID
npx playwright test -g "TC-E2E-01"
npx playwright test -g "TC-LGN-P01"

# Open HTML report
npm run report
```

---

### Expected Terminal Output

```
Running 50 tests using 1 worker

  ✓  TC-LGN-P01 | Valid login redirects to products page (3.2s)
  ✓  TC-LGN-P02 | Login page shows usernames (1.1s)
  ✓  TC-LGN-P03 | Logout returns to login page (4.5s)
  ✓  TC-LGN-P04 | Page title is "Swag Labs" (0.8s)
  ✓  TC-LGN-P05 | Login logo is visible (0.9s)
  ✓  TC-LGN-001 | Error: empty/empty (2.1s)
  ✓  TC-LGN-002 | Error: user/empty (1.8s)
  ✓  TC-LGN-003 | Error: empty/pass (1.9s)
  ✓  TC-LGN-004 | Error: wrong credentials (2.0s)
  ✓  TC-LGN-005 | Locked user error (2.2s)
  ✓  TC-LGN-N06 | Error closed by X button (1.5s)
  ✓  TC-LGN-N07 | Error has red class (1.2s)
  ✓  TC-LGN-UI01 | Username input visible (0.9s)
  ✓  TC-LGN-UI02 | Password input visible (0.9s)
  ✓  TC-LGN-UI03 | Login button enabled (0.9s)
  ✓  TC-PRD-01 | 6 products shown (2.1s)
  ...
  ✓  TC-E2E-01 | Full purchase end-to-end (8.4s)
  ✓  TC-E2E-02 | Two item purchase total correct (9.1s)
  ✓  TC-E2E-03 | Back Home after order (7.6s)

  50 passed  (2m 14s)
```

---

### Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot find module '../pages/LoginPage'` | Check file path spelling |
| `Timeout waiting for element` | Increase timeout or check selector |
| `Login failed! URL: ...` | Check `.env` credentials |
| Browser not found | Run `npx playwright install chromium` |
| Tests too slow | Set `SLOWMO=0` in `.env` |
| `require is not defined` | Use `require()` not `import` |

---

## 📊 Complete Test Coverage

| Suite | Test Cases | What's Covered |
|---|---|---|
| 🔑 Login | 15 | Positive, Negative (data-driven), UI |
| 🛍️ Products | 15 | Listing, Add/Remove, Sorting |
| 🛒 Cart | 10 | Contents, Remove, Navigation |
| 🏁 E2E Checkout | 10 | Happy path, Validation, Math |
| **TOTAL** | **50** | **Full workflow coverage** |

---

## 🏗️ Architecture at a Glance

```
.env  →  config/env.js  →  playwright.config.js
                                    ↓
              fixtures/baseFixture.js (loggedInPage, logger)
                                    ↓
         pages/LoginPage.js  →  tests/login/login.spec.js
         pages/ProductsPage.js → tests/products/products.spec.js
         pages/CartPage.js    → tests/cart/cart.spec.js
         pages/CheckoutPage.js → tests/e2e/checkout.spec.js
                                    ↓
utils/WaitUtils.js + utils/Logger.js  (shared by all pages)
data/testData.js                      (shared by all tests)
                                    ↓
         playwright-report/  (HTML report with screenshots)
         logs/execution.log  (full execution trail)
```
