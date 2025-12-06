# ChromePilot

An AI-powered browser automation agent using a two-LLM architecture: a reasoning model (qwen3-vl-32k) orchestrates tasks, while an executor model (llama3.1:8b) translates steps into tool calls with full context from previous actions.

## Version History

**v2 (Current)**: One-shot agent with plan-and-execute workflow
- Orchestrator creates a complete plan upfront based on screenshot
- Executor executes each step sequentially with context from previous steps
- User approves/rejects plans before execution
- Post-execution verification to confirm task completion

**v3 (Planned)**: True iterative agent with dynamic re-evaluation
- Agent iterates and adapts plan based on execution results
- Re-evaluates after each step and adjusts strategy if needed
- Asks user for clarification when encountering ambiguity
- Similar to GitHub Copilot's conversational debugging approach
- Handles unexpected page states and errors gracefully

## Architecture

ChromePilot uses a **dual-LLM system**:
- **Orchestrator** (qwen3-vl-32k): Vision-enabled reasoning model that sees your page and creates plain English step-by-step plans
- **Executor** (llama3.1:8b): Fast, lightweight model that translates each step into specific tool calls with access to previous step outputs

This architecture enables:
- Steps can reference previous outputs (e.g., "Click the first link from the search results")
- Reasoning model focuses on high-level planning without tool syntax
- Executor model has full context of execution history for each step

**→ See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed explanation with examples and flow diagrams**

## Features

- 🎯 **Visual AI Agent**: Sees and understands web pages using vision models
- 🔄 **Two-Stage Execution**: Orchestrator plans, executor executes with context
- 📸 **Screenshot Analysis**: Automatically captures and analyzes the current tab
- 🌐 **HTML Context**: Extracts complete page HTML structure
- 💭 **Reasoning Process**: View the orchestrator's step-by-step thinking
- 🔄 **Streaming Responses**: Real-time streaming of AI responses with markdown rendering
- 📊 **Execution Tracking**: See each step's status, inputs, and outputs
- ↕️ **Collapsible Plans**: Expand/collapse plan details and execution history
- 💾 **Conversation History**: Maintains context of last 4 messages
- 🎨 **Clean UI**: Beautiful sidebar interface with smooth animations
- 🔐 **Privacy-Focused**: All processing happens locally through Ollama
- 🎛️ **Context Controls**: Toggle screenshot and HTML context on/off

### Current Capabilities (v2)
- ✅ Multi-step task planning with plain English descriptions
- ✅ Context-aware execution (steps can use previous outputs)
- ✅ 10 comprehensive browser tools (click, type, select, pressKey, scroll, navigate, manageTabs, waitFor, getSchema, getHTML)
- ✅ Accessibility tree extraction with smart element filtering
- ✅ Visual execution feedback with status tracking
- ✅ Approve/reject workflow with plan correction support
- ✅ Post-execution verification with screenshot analysis
- ✅ One-shot planning: complete plan created upfront before execution

### Planned for v3 (Iterative Agent)
- 🔨 Dynamic re-planning based on execution results
- 🔨 Step-by-step evaluation and strategy adjustment
- 🔨 Conversational clarification requests to user
- 🔨 Error recovery with intelligent retry logic
- 🔨 Handling unexpected page states and navigation changes

## Prerequisites

1. **Ollama**: Install Ollama from [https://ollama.ai](https://ollama.ai)

2. **Orchestrator Model**: Create the qwen3-vl-32k model with extended context:
   
   First, pull the base model:
   ```bash
   ollama pull qwen3-vl:8b
   ```
   
   Create a file named `Modelfile` with this content:
   ```
   FROM qwen3-vl:8b
   PARAMETER num_ctx 32768
   ```
   
   Create the extended context model:
   ```bash
   ollama create qwen3-vl-32k -f Modelfile
   ```
   
   Verify it was created:
   ```bash
   ollama list
   ```

3. **Executor Model**: Pull the llama3.1:8b model for fast step execution:
   ```bash
   ollama pull llama3.1:8b
   ```

4. **Enable CORS**: Ollama must be started with CORS enabled for Chrome extensions:
   
   **Windows:**
   ```cmd
   set OLLAMA_ORIGINS=chrome-extension://*
   ollama serve
   ```
   Or simply run the provided batch file:
   ```cmd
   start-ollama-with-cors.bat
   ```
   
   **macOS/Linux:**
   ```bash
   OLLAMA_ORIGINS=chrome-extension://* ollama serve
   ```

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the ChromePilot folder
5. The ChromePilot icon should appear in your extensions toolbar

## Usage

1. **Start Ollama** with CORS enabled (see Prerequisites)
2. **Click the ChromePilot icon** in your Chrome toolbar to open the sidebar
3. The extension will automatically:
   - Capture a screenshot of the current tab
   - Extract the complete HTML structure (not just visible area)
   - Send both to the AI model
4. **Ask questions** about the page:
   - "What is this page about?"
   - "Where can I find the filters?"
   - "What options are available on this form?"
   - "Explain what I'm looking at"
5. **View reasoning**: Click "View Reasoning" to see the AI's step-by-step thinking
6. **Follow-up questions**: Ask related questions - the AI remembers the last 2 exchanges
7. **Toggle context**: Use the switches to enable/disable screenshot or HTML context
8. **Reset**: Click the reset button to start a fresh conversation

## Technical Details

### Token Management
- Maximum input: 32K tokens (including image)
- Automatic token estimation prevents truncation
- HTML is simplified and truncated to reduce token usage

### HTML Processing
The extension extracts all displayed elements from the page:
- Captures entire page HTML, not just viewport-visible elements
- Removes styling, scripts, SVGs, and non-interactive elements
- Preserves IDs, classes, semantic attributes, and ARIA labels
- Includes elements below the fold (scrolled out of view)
- Maximum 20K characters of HTML
- Skips CSS-hidden elements (display: none, visibility: hidden)

### Permissions
The extension requests these permissions for future features:
- `activeTab`: Capture screenshots and inject scripts
- `tabs`: Access tab information
- `scripting`: Execute content scripts
- `sidePanel`: Display the chat interface
- `storage`: Save conversation history
- `debugger`: Future mouse/keyboard control
- `<all_urls>`: Work on any webpage

## Future Enhancements (v3+)

Planned features for v3 (Iterative Agent):
- 🤖 **Dynamic Re-planning**: Adjust strategy based on execution outcomes
- 🔄 **Iterative Evaluation**: Re-evaluate after each step instead of one-shot planning
- 💬 **Conversational Clarification**: Ask user for input when encountering ambiguity
- 🛡️ **Adaptive Error Handling**: Recover from failures with alternative approaches
- 🎯 **Context-Aware Adaptation**: Handle unexpected page states intelligently

v2 provides one-shot plan-and-execute workflow. v3 will introduce true agentic behavior with iteration and dynamic adaptation.

## Troubleshooting

**"Cannot connect to Ollama" or "Failed to fetch"**
- Ensure Ollama is running with CORS enabled:
  - Windows: `set OLLAMA_ORIGINS=chrome-extension://* && ollama serve`
  - Use the `start-ollama-with-cors.bat` file provided
- Check that Ollama is accessible: Open `http://localhost:11434/api/tags` in your browser
- Restart Ollama if you forgot to set CORS initially

**"Model not found"**
- Make sure you created the qwen3-vl-32k model (see Prerequisites)
- First pull base model: `ollama pull qwen3-vl:8b`
- Then create extended model: `ollama create qwen3-vl-32k -f Modelfile`
- Verify with: `ollama list` (should show `qwen3-vl-32k:latest`)

**"Request too large"**
- The page content exceeds 32K tokens
- Try asking a more specific question
- Navigate to a simpler page section

## License

MIT License - Feel free to modify and distribute

## Credits

- Built with Ollama for local AI processing
- Uses qwen3-vl-32k for vision and reasoning capabilities
