# ChromePilot Architecture

[← Back to README](README.md)

## Iterative Two-LLM System (v3)

ChromePilot v3 uses a dual-LLM architecture with a fully iterative execution model:

### Decision Agent: qwen3-vl-32k (Reasoning Model)
- **Role**: Iterative decision-making
- **Input**: Screenshot + Page context + User goal + Execution history
- **Output**: Single next action OR clarifying question OR completion message
- **Example Output**:
  ```json
  {
    "needs_action": true,
    "action": "Open a new tab with URL https://www.youtube.com",
    "reasoning": "Starting by navigating to YouTube as requested",
    "message": "Opening YouTube...",
    "ask_user": null
  }
  ```

### Executor: llama3.1-8b-32k:latest (Execution Model)
- **Role**: Translate single action into tool call
- **Input**: Action description + Execution history (previous inputs/outputs)
- **Output**: Tool name + Parameters
- **Example**:
  - Input: "Open a new tab with URL https://www.youtube.com"
  - Output: `{ "tool": "manageTabs", "inputs": {"action": "open", "url": "https://www.youtube.com"} }`

## Benefits of Iterative Architecture

### 1. Dynamic Adaptation
- No commitment to a fixed plan
- Each decision uses the most current information
- Can change strategy based on what actually happens

### 2. Error Recovery
- Failures are incorporated into next decision
- Agent can try alternative approaches
- No need to restart entire plan

### 3. User Collaboration
- Can ask clarifying questions mid-execution
- User can provide guidance at any point
- Natural conversational flow

### 4. Simpler Mental Model
- One action at a time, easy to understand
- Clear cause and effect
- Transparent decision-making process

### 5. Handles Uncertainty
- Doesn't need to predict all future states
- Responds to actual page states, not assumptions
- More robust to unexpected changes

## Execution Flow

```
User Request
    ↓
[Decision Agent: qwen3-vl-32k]
    ↓
Single Action Decision
    ↓
[Executor: llama3.1-8b-32k:latest] ← Previous action outputs
    ↓
Tool Call (name + params)
    ↓
Execute Tool
    ↓
Capture Result
    ↓
[Decision Agent: Re-evaluate]
    ↓
Next Action OR Ask User OR Complete
    ↓
Repeat until goal achieved
```

## Example: Iterative Task Execution

**User**: "Search for cats on YouTube"

### Iteration 1:
- **Decision Agent sees**: User request, current page
- **Decision**: "Open a new tab with URL https://www.youtube.com"
- **Executor translates**: `manageTabs(action: "open", url: "https://www.youtube.com")`
- **Result**: Tab opened, tabId returned

### Iteration 2:
- **Decision Agent sees**: User request, execution history (tab opened), current page screenshot
- **Decision**: "Wait for the page to load completely"
- **Executor translates**: `waitFor(waitType: "navigation")`
- **Result**: Page loaded successfully

### Iteration 3:
- **Decision Agent sees**: YouTube homepage screenshot
- **Decision**: "Get page schema to find interactive elements"
- **Executor translates**: `getSchema()`
- **Result**: Array of interactive elements including search box (id: 5)

### Iteration 4:
- **Decision Agent sees**: Schema with search box identified
- **Decision**: "Click the search input with id 5 from schema"
- **Executor translates**: `click(a11yId: 5)`
- **Result**: Search box focused

### Iteration 5:
- **Decision Agent sees**: Search box is now active
- **Decision**: "Type 'cats' into the search box"
- **Executor translates**: `type(a11yId: 5, text: "cats")`
- **Result**: Text entered

### Iteration 6:
- **Decision Agent sees**: Search text entered, schema includes search button
- **Decision**: "Click the search button with id 8 from schema"
- **Executor translates**: `click(a11yId: 8)`
- **Result**: Search submitted, navigation started

### Iteration 7:
- **Decision Agent sees**: Search results page loading
- **Decision**: "Wait for the page to load completely"
- **Executor translates**: `waitFor(waitType: "navigation")`
- **Result**: Search results displayed

### Iteration 8:
- **Decision Agent sees**: Search results for "cats" visible on screen
- **Decision**: Goal achieved!
- **Output**: 
  ```json
  {
    "needs_action": false,
    "message": "✓ I've successfully searched for cats on YouTube. The search results are now displayed.",
    "ask_user": null
  }
  ```

## Handling Clarification and Errors

### Asking for Clarification

When the agent encounters ambiguity, it asks the user:

**Example - Ambiguous Request**:
- **User**: "Click the button"
- **Agent sees**: Multiple buttons on page
- **Decision**:
  ```json
  {
    "needs_action": false,
    "message": "I see several buttons on this page.",
    "ask_user": "Which button would you like me to click? I can see: 'Submit', 'Cancel', 'Learn More', and 'Sign Up'."
  }
  ```

**Example - Missing Information**:
- **User**: "Fill out the form"
- **Agent sees**: Form with name, email, phone fields
- **Decision**:
  ```json
  {
    "needs_action": false,
    "message": "I found a form with several fields.",
    "ask_user": "What information should I enter in the form? I see fields for name, email, and phone number."
  }
  ```

### Handling Failures

When an action fails, the agent incorporates the failure into its next decision:

**Example - Element Not Found**:
- **Iteration N**: Try to click button with id 5
- **Result**: Error - element not found
- **Iteration N+1**:
  - **Decision Agent sees**: Previous action failed, current page state
  - **Decision**: "Get page schema again to find the current elements"
  - **Agent adapts**: Refreshes understanding of page, tries alternative approach

**Example - Navigation Error**:
- **Iteration N**: Navigate to URL
- **Result**: Error - page not found
- **Iteration N+1**:
  - **Decision Agent sees**: Navigation failed with 404 error
  - **Decision**:
    ```json
    {
      "needs_action": false,
      "message": "The URL couldn't be loaded (404 error).",
      "ask_user": "Would you like me to try a different URL or search for the site instead?"
    }
    ```

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
- **Description**: Click on buttons, links, or any interactive element using accessibility tree ID
- **Inputs**: 
  - `a11yId` (required): Accessibility tree element ID from getSchema output
  - `clickType` (optional): 'single' (default), 'double', or 'right'
- **Outputs**: `success`, `elementText`, `elementClicked`
- **Use Cases**: Click buttons, links, expand dropdowns, trigger UI actions
- **Note**: Must call getSchema first to get a11yId values

### 2. type - Type Text Into Fields
- **Description**: Enter text into input fields, textareas, or contenteditable elements
- **Inputs**:
  - `a11yId` (required): Accessibility tree element ID from getSchema output
  - `text` (required): Text to type
  - `mode` (optional): 'replace' (default) or 'append'
  - `submit` (optional): true to press Enter after typing
- **Outputs**: `success`, `finalValue`
- **Use Cases**: Fill forms, search bars, comment boxes, login fields
- **Note**: Must call getSchema first to get a11yId values

### 3. select - Choose Dropdown Option
- **Description**: Select an option from dropdown menus
- **Inputs**:
  - `a11yId` (required): Accessibility tree element ID from getSchema output
  - `option` (required): Value to select
  - `by` (optional): 'value' (default), 'text', or 'index'
- **Outputs**: `success`, `selectedValue`, `selectedText`
- **Use Cases**: Country selectors, filters, form dropdowns
- **Note**: Must call getSchema first to get a11yId values

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
  - `waitType` (required): 'time', 'element', 'navigation', or 'networkIdle'
  - `value` (required for 'time'): Milliseconds to wait
  - `selector` (required for 'element'): CSS selector to wait for
  - `timeout` (optional): Max wait time in ms (default 5000)
- **Outputs**: `success`, `elementFound`, `timeWaited`
- **Use Cases**: Handle dynamic content, wait for page loads, avoid race conditions, delay between actions

### 9. getSchema - Get Accessibility Tree
- **Description**: Extract the page's accessibility tree with interactive elements
- **Inputs**: None
- **Outputs**: `schema` (array of elements with id, type, role, label, placeholder, text, location)
- **Element Properties**:
  - `id`: Unique identifier (a11yId) used for click/type/select tools
  - `type`: HTML element type (button, input, a, etc.)
  - `role`: ARIA role or computed semantic role
  - `label`: Accessible name from aria-label, labels, or text content
  - `placeholder`: Placeholder text for inputs
  - `text`: Text content for links/buttons
  - `location`: Bounding box coordinates
- **Smart Filtering**: Only returns meaningful, identifiable interactive elements
  - Skips elements with no label, placeholder, or text
  - Reduces ~387 raw elements to ~100-150 actionable elements
  - Filters out decorative icons, structural divs, and noise
- **Use Cases**: 
  - REQUIRED before click/type/select to get a11yId values
  - Find buttons, links, inputs by their accessible labels
  - Understand page structure and available interactions
- **Example Output**:
  ```json
  {
    "success": true,
    "schema": [
      {"id": 1, "type": "input", "role": "combobox", "label": "Search", "placeholder": "Search YouTube"},
      {"id": 2, "type": "button", "role": "button", "label": "Search", "text": "Search"},
      {"id": 18, "type": "a", "role": "link", "label": "Rick Astley - Never Gonna Give You Up", "text": "Rick Astley - Never Gonna Give You Up"}
    ]
  }
  ```

### 10. getHTML - Extract HTML Content
- **Description**: Get HTML content of the entire page or specific elements
- **Inputs**:
  - `selector` (optional): CSS selector for specific element (empty = full page)
- **Outputs**: `html`, `success`
- **Use Cases**: Extract data, analyze page structure, scrape content

## Accessibility Tree System

ChromePilot uses an **accessibility tree extraction system** instead of raw DOM selectors:

### Why Accessibility Tree?
1. **Framework-Agnostic**: Works with React, Vue, Angular, etc. that obfuscate IDs/classes
2. **Semantic Understanding**: Uses ARIA roles and labels, matching how screen readers work
3. **Noise Reduction**: Filters out ~70% of elements, keeping only meaningful interactive items
4. **Stable Selection**: Based on accessible names, not fragile CSS selectors

### How It Works
1. **Extraction** (`content.js::extractAccessibilityTree()`):
   - Queries interactive elements: `button, a, input, textarea, select, [role], [onclick], [tabindex]`
   - Computes accessible name from: aria-label, aria-labelledby, label[for], placeholder, text content
   - Computes role from: ARIA roles or semantic HTML tags
   - **Critical Filter**: Skips elements with no label AND no placeholder
   - Tags each element with `data-agent-id` attribute in DOM
   - Returns array of ~100-150 meaningful elements

2. **Element Selection** (`content.js`):
   - Executor specifies `a11yId` from getSchema output
   - Content script finds element by `data-agent-id="{a11yId}"`
   - Fallback to in-memory `a11yTreeElements` map
   - Performs action on the matched element

3. **Smart Filtering Example**:
   ```
   Before filtering: 387 elements
   - Many with label: null (YouTube logo, decorative icons, structural divs)
   - Noise confuses executor's element selection
   
   After filtering: ~100-150 elements  
   - Only elements with label OR placeholder
   - All actionable, identifiable elements
   - Clear, unambiguous for executor to match
   ```

### Executor Element Matching
The executor uses **partial string matching** to find elements:
- Step: "Click the fullscreen button" → Extract: "fullscreen" → Find: label contains "Full screen"
- Step: "Type in search box" → Extract: "search" → Find: role="combobox" AND label contains "Search"
- Step: "Click Rick Astley video" → Extract: "Rick Astley" → Find: label contains "Rick Astley"

### Context Management
- **Screenshot Capture**: Re-captured before each decision iteration (if toggle enabled)
  - Sent to decision agent (vision model) for re-evaluation
  - NOT available as a tool since executor model is text-only
  - Ensures decisions are based on current page state
  
- **HTML Capture**: 
  - Can be obtained during execution via `getHTML` tool
  - Text-based, works with executor model
  - Can target specific elements with CSS selector
  
- **Execution History**: All previous actions and results are included in context
  - Decision agent sees: action description, tool used, success/failure, outputs
  - Enables learning from past attempts
  - Helps avoid repeating failed approaches

## Implementation Details

### sidebar.js (v3 Changes)
- `ORCHESTRATOR_PROMPT`: System prompt enforcing single-action decisions
- `handleAgentResponse()`: Processes iterative response (action, clarification, or completion)
- `executeIterativeAction()`: Executes single action and triggers next iteration
- `continueIteration()`: Re-evaluates situation and gets next decision
- `executeStep()`: Calls executor model to translate action to tool call
- `executeToolCall()`: Actually runs the tool

### background.js
- `handleStreamOllama()`: Streams decision agent responses
- `handleExecuteWithModel()`: Non-streaming executor calls

### UI (v3 Changes)
- Shows single action at a time with execution status
- Displays clarification questions when agent is uncertain
- Shows collapsible action details (inputs/outputs)
- Real-time status updates during iteration
- Stop button to halt iteration at any point
