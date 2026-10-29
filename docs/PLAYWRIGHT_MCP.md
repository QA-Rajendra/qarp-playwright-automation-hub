# Getting Started with Playwright MCP

The Model Context Protocol (MCP) allows AI assistants (like Claude Desktop or Cursor) to directly interface with your Playwright test automation framework. 

This guide explains how to implement and connect the Playwright MCP Server into your daily AI workflow.

## 1. What is the Playwright MCP?

The Playwright MCP Server exposes your local Playwright environment to AI agents as a set of callable tools. Instead of the AI giving you terminal commands to run, the AI can directly:
- Read your `playwright.config.js`
- Discover test files and trace files
- Execute tests (`npx playwright test`)
- Read the test results and error stack traces
- Provide automated debugging for failed locators

## 2. Implementation in Claude Desktop

To connect the QARP Playwright MCP to Claude Desktop, you need to add the server to your Claude configuration file.

**Step 1:** Open your Claude Desktop configuration file:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

**Step 2:** Add the Playwright Hub server:

```json
{
  "mcpServers": {
    "playwright-automation-hub": {
      "command": "node",
      "args": [
        "E:/qa/qarp-playwright-automation-hub-main/runner-server.js"
      ]
    }
  }
}
```

**Step 3:** Restart Claude Desktop.
You will now see a **🔨 (Hammer)** icon in Claude, indicating that the Playwright tools are loaded!

## 3. Implementation in Cursor IDE

If you use Cursor as your code editor, you can add the Playwright MCP directly to your Agent.

1. Open Cursor Settings (`Ctrl + Shift + J` or `Cmd + Shift + J`)
2. Go to **Features** > **MCP Servers**
3. Click **+ Add New MCP Server**
4. Configure it as follows:
   - **Type:** `command`
   - **Name:** `playwright-hub`
   - **Command:** `node E:/qa/qarp-playwright-automation-hub-main/runner-server.js`
5. Click **Save** and wait for the green `Connected` dot.

## 4. How to use it in chat

Once implemented, you can ask your AI assistant questions like:
- *"Run the smoke tests and tell me if they pass."*
- *"Why did the login test fail? Read the error logs and suggest a fix."*
- *"Find all tests tagged with @regression and execute them."*
- *"Use analyze_javascript_application to inspect the app in dist."*
- *"Run the smoke tests across all configured browser projects."*
- *"Use get_project_analysis to report the frameworks, versions, and configuration paths in this project."*

The AI will autonomously call the MCP tools, run the tests, parse the JSON-RPC results, and give you the final answer!

## 5. Analyze JavaScript Applications with REA

The QARP MCP server includes an `analyze_javascript_application` tool for JavaScript app directories and Electron `.asar` bundles inside the active project root. It runs the pinned `rea-agents@6.7.0` CLI through npm. The first analysis may need internet access to download the package.

You can also use **REA JS Analyzer** in the QARP dashboard's left navigation. Enter a relative path such as `dist` or `release/app.asar`; paths outside the active project root are rejected. The dashboard launches this local analysis only from the local QARP page.

The `run_tests` MCP tool supports a `projects` array for selecting multiple configured browser projects. If neither `project` nor `projects` is supplied, Playwright runs all projects from the active project's config.

The `get_project_analysis` MCP tool provides a read-only inventory of the active project's folders, source-language counts, package manifests, recognized framework dependencies, declared versions, npm lockfile-resolved versions, and Playwright config/browser-project paths. The dashboard exposes the same scan under **Project Analyzer**. It skips dependency and generated-output directories and does not read source contents or environment secrets. Select the project you want to inspect as QARP's active project first.
