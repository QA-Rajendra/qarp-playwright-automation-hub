/**
 * Configuration & Constants for Playwright Test Runner
 */
const APP_CONFIG = {
  // Default runner API base URL (can be customized via settings)
  apiBaseUrl: localStorage.getItem('pw_api_url') || 'http://127.0.0.1:9300',
  reportPort: 9320,
  allurePort: 9335,

  // Theme Metadata
  themes: {
    'dark':      { ico: '🌙', name: 'CYBER' },
    'light':     { ico: '☀️', name: 'LIGHT' },
    'cyberpunk': { ico: '⚡', name: 'NEON' },
    'synthwave': { ico: '👾', name: 'SYNTH' },
    'aurora':    { ico: '🌠', name: 'AURORA' },
    'matrix':    { ico: '🌲', name: 'MATRIX' },
    'crimson':   { ico: '🩸', name: 'CRIMSON' },
    'sunset':    { ico: '🌅', name: 'SUNSET' },
    'pastel':    { ico: '🍧', name: 'PASTEL' }
  },

  // CLI Execution Flags
  flags: [
    { label: '--workers=4', hint: 'Run 4 parallel worker threads' },
    { label: '--headed', hint: 'Show browser UI window' },
    { label: '--debug', hint: 'Playwright Inspector debugging' },
    { label: '--ui', hint: 'Playwright Interactive UI mode' },
    { label: '--reporter=html', hint: 'Generate HTML report' },
    { label: '--workers=2', hint: 'Run 2 parallel worker threads' },
    { label: '--workers=1', hint: 'Run serially (1 worker)' },
    { label: '--retries=2', hint: 'Retry failed tests up to 2 times' },
    { label: '--trace=on', hint: 'Record full execution trace' },
    { label: '--last-failed', hint: 'Re-run only failed tests from last run' }
  ],

  // Quick Tag Filter Presets
  tagPresets: [
    { label: '🌱 @sanity', tag: '@sanity', class: 'tag-sanity' },
    { label: '🛡️ @regression', tag: '@regression', class: 'tag-regression' },
    { label: '⚡ @bvt', tag: '@bvt', class: 'tag-bvt' },
    { label: '💨 @smoke', tag: '@smoke', class: 'tag-smoke' },
    { label: '🌐 @e2e', tag: '@e2e', class: 'tag-e2e' },
    { label: '🔗 @regression & @sanity', tag: '(?=.*@regression)(?=.*@sanity)', class: 'tag-combo' },
    { label: '🔀 @regression | @sanity', tag: '@regression|@sanity', class: 'tag-combo' },
    { label: '🔀 @sanity | @bvt', tag: '@sanity|@bvt', class: 'tag-combo' }
  ],

  // Standalone Mock Directory Structure (used when runner API server is offline)
  mockStructure: {
    tree: [
      {
        name: 'tests (root)',
        path: 'tests',
        files: [
          { name: '1_authentication.spec.js', path: 'tests/1_authentication.spec.js' },
          { name: '2_dashboard_metrics.spec.js', path: 'tests/2_dashboard_metrics.spec.js' }
        ],
        folders: [
          {
            name: 'Step16_ERPMaster',
            path: 'tests/Step16_ERPMaster',
            files: [
              { name: '1_programs.spec.js', path: 'tests/Step16_ERPMaster/1_programs.spec.js' },
              { name: '2_departments.spec.js', path: 'tests/Step16_ERPMaster/2_departments.spec.js' },
              { name: '3_courses_catalog.spec.js', path: 'tests/Step16_ERPMaster/3_courses_catalog.spec.js' },
              { name: '4_faculty_assignment.spec.js', path: 'tests/Step16_ERPMaster/4_faculty_assignment.spec.js' },
              { name: '5_student_enrollment.spec.js', path: 'tests/Step16_ERPMaster/5_student_enrollment.spec.js' }
            ],
            folders: [],
            totalFiles: 5
          },
          {
            name: '2ComputerWithVPN',
            path: 'tests/2ComputerWithVPN',
            files: [
              { name: '7_vpn_connection.spec.js', path: 'tests/2ComputerWithVPN/7_vpn_connection.spec.js' },
              { name: '8_finalcourses.spec.js', path: 'tests/2ComputerWithVPN/8_finalcourses.spec.js' },
              { name: '9_data_sync.spec.js', path: 'tests/2ComputerWithVPN/9_data_sync.spec.js' }
            ],
            folders: [],
            totalFiles: 3
          }
        ],
        totalFiles: 10
      },
      {
        name: 'e2e (root)',
        path: 'e2e',
        files: [
          { name: 'smoke.spec.ts', path: 'e2e/smoke.spec.ts' },
          { name: 'billing_checkout.spec.ts', path: 'e2e/billing_checkout.spec.ts' }
        ],
        folders: [
          {
            name: 'api_integration',
            path: 'e2e/api_integration',
            files: [
              { name: 'mongodb_crud.spec.ts', path: 'e2e/api_integration/mongodb_crud.spec.ts' },
              { name: 'session_token.spec.ts', path: 'e2e/api_integration/session_token.spec.ts' }
            ],
            folders: [],
            totalFiles: 2
          }
        ],
        totalFiles: 4
      }
    ],
    folders: ['tests', 'tests/Step16_ERPMaster', 'tests/2ComputerWithVPN', 'e2e', 'e2e/api_integration']
  },

  // Standalone Mock Configured Projects
  mockProjects: ['chromium', 'firefox', 'webkit', 'Mobile Chrome', 'Mobile Safari']
};
