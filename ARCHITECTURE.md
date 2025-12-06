# ChromePilot Architecture

[← Back to README](README.md)

## Two-LLM System

ChromePilot uses a dual-LLM architecture to separate high-level reasoning from low-level execution:

### Orchestrator: qwen3-vl-32k (Reasoning Model)
- **Role**: High-level task planning
- **Input**: Screenshot + HTML + User request
- **Output**: Array of plain English step descriptions
- **Example Output**:
  ```json
  {
    "needs_steps": true,
    "steps": [
      "Open a new tab with YouTube.com",
      "Click on the search box visible in the page",
      "Type 'cats' into the search box"
    ],
    "message": "I'll open YouTube and search for cats."
  }
  ```

### Executor: llama3.1:8b (Execution Model)
- **Role**: Translate steps into tool calls
- **Input**: Step description + Execution history (previous inputs/outputs)
- **Output**: Tool name + Parameters
- **Example**:
  - Input: "Click the first link from the search results"
  - Has access to: Previous step outputs showing search results
  - Output: `{ "tool": "clickElement", "inputs": { "selector": ".result:first-child a" } }`

## Benefits of This Architecture

### 1. Context Propagation
Steps can reference previous outputs:
- "Open the URL shown in the previous step"
- "Click the element that was highlighted"
- "Use the tab ID from step 1"

### 2. Separation of Concerns
- **Orchestrator**: Focuses on "what to do" without worrying about tool syntax
- **Executor**: Focuses on "how to do it" with full execution context

### 3. Flexibility
- Steps are human-readable plain English
- Easy to debug (see exactly what the orchestrator planned)
- Executor can adapt to different page states using execution history

### 4. Efficiency
- Orchestrator runs once with vision (expensive)
- Executor runs per-step without vision (fast, llama3.1:8b is lightweight)

## Execution Flow

```
User Request
    ↓
[Orchestrator: qwen3-vl-32k]
    ↓
Plain English Steps
    ↓
User Approves Plan
    ↓
For each step:
    ↓
[Executor: llama3.1:8b] ← Previous step outputs
    ↓
Tool Call (name + params)
    ↓
Execute Tool
    ↓
Store Output
    ↓
Next Step
```

## Example: Multi-Step Task

**User**: "Search for cats on Google"

### Orchestrator Output:
```json
{
  "needs_steps": true,
  "steps": [
    "Open a new tab with Google.com",
    "Click on the search input box",
    "Type 'cats' in the search box",
    "Click the search button or press Enter"
  ],
  "message": "I'll search for cats on Google for you."
}
```

### Execution:

**Step 1**: "Open a new tab with Google.com"
- Executor receives: No previous context
- Executor output: `{ "tool": "openTab", "inputs": { "url": "https://www.google.com" } }`
- Tool execution: Opens tab
- Stored output: `{ "tabId": 123, "url": "https://www.google.com" }`

**Step 2**: "Click on the search input box"
- Executor receives: Step 1 outputs (tabId: 123)
- Executor output: `{ "tool": "clickElement", "inputs": { "selector": "input[name='q']" } }`
- Tool execution: Clicks element
- Stored output: `{ "success": true, "elementText": "" }`

**Step 3**: "Type 'cats' in the search box"
- Executor receives: Step 1 & 2 outputs
- Executor can see the search box was successfully clicked
- And so on...

## Tool Definition Format

Tools are defined with input/output specifications:

```javascript
{
  name: "openTab",
  description: "Opens a new browser tab with the specified URL",
  inputs: ["url"],
  outputs: ["tabId", "url"],
  inputDescription: "url: The URL to open in the new tab",
  outputDescription: "Returns the tab ID and confirmed URL of the opened tab"
}
```

This allows:
- Orchestrator to understand what tools can do
- Executor to know what parameters are needed
- Executor to know what outputs will be available for next steps

## Available Tools

### 1. click - Click Any Element
- **Description**: Click on buttons, links, or any interactive element
- **Inputs**: 
  - `selector` (required): CSS selector for the element
  - `clickType` (optional): 'single' (default), 'double', or 'right'
- **Outputs**: `success`, `elementText`, `elementClicked`
- **Use Cases**: Click buttons, links, expand dropdowns, trigger UI actions

### 2. type - Type Text Into Fields
- **Description**: Enter text into input fields, textareas, or contenteditable elements
- **Inputs**:
  - `selector` (required): CSS selector for input element
  - `text` (required): Text to type
  - `mode` (optional): 'replace' (default) or 'append'
  - `submit` (optional): true to press Enter after typing
- **Outputs**: `success`, `finalValue`
- **Use Cases**: Fill forms, search bars, comment boxes, login fields

### 3. select - Choose Dropdown Option
- **Description**: Select an option from dropdown menus
- **Inputs**:
  - `selector` (required): CSS selector for select element
  - `option` (required): Value to select
  - `by` (optional): 'value' (default), 'text', or 'index'
- **Outputs**: `success`, `selectedValue`, `selectedText`
- **Use Cases**: Country selectors, filters, form dropdowns

### 4. pressKey - Keyboard Actions
- **Description**: Simulate keyboard key presses including shortcuts
- **Inputs**:
  - `key` (required): Key name (Enter, Tab, Escape, ArrowUp/Down, PageUp/Down, etc.) or shortcut (Ctrl+A, Ctrl+F)
  - `selector` (optional): Element to focus before pressing key
- **Outputs**: `success`, `keyPressed`
- **Use Cases**: Submit forms (Enter), navigate (Tab), close modals (Escape), shortcuts (Ctrl+F)

### 5. scroll - Scroll Page or Elements
- **Description**: Scroll the page or specific scrollable elements
- **Inputs**:
  - `target` (optional): CSS selector for element to scroll (empty = page)
  - `direction` (required): 'up', 'down', 'top', 'bottom', or 'toElement'
  - `amount` (optional): Pixels to scroll for up/down (default 500)
- **Outputs**: `success`, `scrollPosition`
- **Use Cases**: Load more content, scroll to sections, navigate long pages

### 6. navigate - Browser Navigation
- **Description**: Navigate to URLs or control browser history
- **Inputs**:
  - `action` (required): 'goto', 'back', 'forward', or 'reload'
  - `url` (required for 'goto'): URL to navigate to
- **Outputs**: `success`, `currentUrl`, `title`
- **Use Cases**: Open websites, go back/forward, refresh pages

### 7. manageTabs - Tab Management
- **Description**: Open, close, switch, or list browser tabs
- **Inputs**:
  - `action` (required): 'open', 'close', 'switch', or 'list'
  - `tabId` (required for close/switch): Tab ID
  - `url` (required for open): URL for new tab
- **Outputs**: `success`, `tabs`, `activeTabId`
- **Use Cases**: Multi-tab workflows, organize browsing, compare pages

### 8. waitFor - Wait for Conditions
- **Description**: Wait for elements to appear, page to load, or network to idle
- **Inputs**:
  - `waitType` (required): 'element', 'navigation', or 'networkIdle'
  - `selector` (required for 'element'): CSS selector to wait for
  - `timeout` (optional): Max wait time in ms (default 5000)
- **Outputs**: `success`, `elementFound`, `timeWaited`
- **Use Cases**: Handle dynamic content, wait for page loads, avoid race conditions

### 9. getHTML - Extract HTML Content
- **Description**: Get HTML content of the entire page or specific elements
- **Inputs**:
  - `selector` (optional): CSS selector for specific element (empty = full page)
- **Outputs**: `html`, `success`
- **Use Cases**: Extract data, analyze page structure, scrape content

### Context Management
- **Screenshot Capture**: Static capture at start of each message (if toggle enabled)
  - Captured once per user message and sent to orchestrator (vision model)
  - NOT available as a tool since executor model (llama3.1:8b) is text-only
  - Only the CURRENT screenshot is sent, not historical ones
  
- **HTML Capture**: 
  - Static capture at start if toggle enabled (sent to orchestrator)
  - Also available as `getHTML` tool during execution (text-based, works with executor)
  - Can target specific elements with CSS selector
  
- **No Redundancy**: Previous screenshots/HTML are NOT carried in conversation history

## Implementation Details

### sidebar.js
- `ORCHESTRATOR_PROMPT`: System prompt for plan generation
- `executeStep()`: Calls executor model with full history
- `executeToolCall()`: Actually runs the tool
- `handlePlanApproval()`: Manages execution loop with history tracking

### background.js
- `handleStreamOllama()`: Streams orchestrator responses
- `handleExecuteWithModel()`: Non-streaming executor calls

### UI
- Shows plain English steps (easy to understand)
- Displays execution status per step
- Shows tool calls and outputs after execution
- Collapsible for clean interface
