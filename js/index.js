/**
 * Playwright Automation Hub - ES6 Module Entry Point
 * Use this file to import the Runner, API client, or Theme engine into other projects.
 * 
 * Example usage:
 *   import { PlaywrightAPI, APP_CONFIG } from './path/to/BestNodeJSProject/js/index.js';
 *   const api = new PlaywrightAPI();
 *   const result = await api.startRun('npx playwright test');
 */

// Export Global Config
export { APP_CONFIG };

// Export API Controller
export { PlaywrightAPI, api };

// Export Theme Engine
export { ThemeManager, theme };

// Export Utilities & Controllers
export { UI };
export { TestTree, testTree };
export { RunnerController, testRunner };
export { ResultsController, resultsCtrl };
export { HistoryController, historyCtrl };
