# ChromePilot v3.0

An AI-powered browser automation agent using a fully iterative architecture: the agent evaluates, decides, and executes one action at a time, continuously re-evaluating based on results.

## Version History

**v3 (Current)**: Fully iterative agent with dynamic decision-making
- Agent operates in a continuous iterate → decide → act → observe loop
- No upfront planning - decides only the single best next action at each moment
- Re-evaluates from scratch after every action using latest context
- Asks user for clarification when encountering ambiguity or uncertainty
- Adapts to unexpected page states and errors in real-time
- Handles failures gracefully by incorporating them into next decision

**v2 (Previous)**: One-shot agent with plan-and-execute workflow
- Orchestrator creates a complete plan upfront based on screenshot
- Executor executes each step sequentially with context from previous steps
- User approves/rejects plans before execution
- Post-execution verification to confirm task completion

## Architecture

ChromePilot uses a **dual-LLM iterative system**:
- **Decision Agent** (qwen3-vl-32k): Vision-enabled reasoning model that sees your page and decides the single next action
- **Executor** (llama3.1-8b-32k:latest): Fast, lightweight model that translates each action into specific tool calls

This architecture enables:
- **True Iteration**: Agent re-evaluates after each action, adjusting strategy based on results
- **No Planning**: Decisions are made one at a time, not committed upfront
- **Context Awareness**: Actions can reference previous execution outputs
- **Dynamic Adaptation**: Handles unexpected states by reassessing from scratch
- **User Interaction**: Asks clarifying questions when uncertain

**→ See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed explanation with examples and flow diagrams**

## Features

- 🎯 **Fully Iterative Agent**: Decides and executes one action at a time, adapting dynamically
- 👁️ **Visual AI Agent**: Sees and understands web pages using vision models
- 🔄 **Continuous Re-evaluation**: Reassesses situation after every action
- 💭 **Clarification Requests**: Asks user when encountering ambiguity
- 📸 **Screenshot Analysis**: Automatically captures and analyzes the current tab
- 🌐 **HTML Context**: Extracts complete page HTML structure
- 🔄 **Streaming Responses**: Real-time streaming of AI responses with markdown rendering
- 📊 **Execution Tracking**: See each action's status, inputs, and outputs
- 💾 **Conversation History**: Maintains context of recent exchanges
- 🎨 **Clean UI**: Beautiful sidebar interface with smooth animations
- 🔐 **Privacy-Focused**: All processing happens locally through Ollama
- 🎛️ **Context Controls**: Toggle screenshot context on/off

### Current Capabilities (v3)
- ✅ Iterative decision-making with single-action execution
- ✅ Dynamic re-evaluation after each action based on results
- ✅ Conversational clarification when uncertain
- ✅ Adaptive error handling and recovery
- ✅ Context-aware execution (actions use previous outputs)
- ✅ 10 comprehensive browser tools (click, type, select, pressKey, scroll, navigate, manageTabs, waitFor, getSchema, getHTML)
- ✅ Accessibility tree extraction with smart element filtering
- ✅ Visual execution feedback with status tracking
- ✅ Real-time adaptation to unexpected page states

## Prerequisites

1. **Ollama**: Install Ollama from [https://ollama.ai](https://ollama.ai)

2. **Orchestrator Model**: Create the qwen3-vl-32k model with extended context:
   
   First, pull the base model:
   ```bash
   ollama pull qwen3-vl:8b
   ```
   
   Create a file named `Modelfile1` with this content:
   ```
   FROM qwen3-vl:8b
   PARAMETER num_ctx 32768
   ```
   
   Create the extended context model:
   ```bash
   ollama create qwen3-vl-32k -f Modelfile1
   ```
   
   Verify it was created:
   ```bash
   ollama list
   ```

3. **Executor Model**: Create the llama3.1-32k model with extended context:
   
   First, pull the base model:
   ```bash
   ollama pull llama3.1-8b-32k:latest
   ```
   
   Create a file named `Modelfile2` with this content:
   ```
   FROM llama3.1-8b-32k:latest
   PARAMETER num_ctx 32768
   ```
   
   Create the extended context model:
   ```bash
   ollama create llama3.1-32k -f Modelfile2
   ```
   
   Verify it was created:
   ```bash
   ollama list
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
3. The extension will automatically capture a screenshot of the current tab
4. **Ask the agent to perform tasks**:
   - "Search YouTube for cats"
   - "Fill out this form with my name John Doe"
   - "Find and click the login button"
   - "Navigate to the settings page"
5. **Watch the agent work iteratively**:
   - Agent decides one action at a time
   - Executes the action
   - Observes the result
   - Re-evaluates and decides the next action
   - Continues until goal is achieved
6. **Answer clarifying questions** when the agent needs more information
7. **Stop anytime** by clicking the Stop button
8. **Toggle context**: Use the screenshot switch to enable/disable visual context
9. **Reset**: Click the reset button to start a fresh conversation

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

## Future Enhancements (v4+)

Potential features for future versions:
- 🤖 **Multi-Agent Collaboration**: Multiple specialized agents working together
- 🧠 **Learning from Experience**: Remember successful strategies across sessions
- 🔍 **Advanced Pattern Recognition**: Identify common UI patterns automatically
- 🛡️ **Enhanced Safety Checks**: Warn before potentially dangerous actions
- 🎯 **Goal Decomposition**: Better handling of complex multi-part goals
- 📊 **Performance Metrics**: Track and optimize execution efficiency

v3 provides fully iterative, adaptive browser automation. Future versions will build on this foundation with advanced capabilities.

## Troubleshooting

**"Cannot connect to Ollama" or "Failed to fetch"**
- Ensure Ollama is running with CORS enabled:
  - Windows: `set OLLAMA_ORIGINS=chrome-extension://* && ollama serve`
  - Use the `start-ollama-with-cors.bat` file provided
- Check that Ollama is accessible: Open `http://localhost:11434/api/tags` in your browser
- Restart Ollama if you forgot to set CORS initially

**"Model not found"**
- Make sure you created both models (see Prerequisites)
- Orchestrator: `ollama pull qwen3-vl:8b` then `ollama create qwen3-vl-32k -f Modelfile1`
- Executor: `ollama pull llama3.1-8b-32k:latest` then `ollama create llama3.1-32k -f Modelfile2`
- Verify with: `ollama list` (should show `qwen3-vl-32k:latest` and `llama3.1-32k:latest`)

**"Request too large"**
- The page content exceeds 32K tokens
- Try asking a more specific question
- Navigate to a simpler page section

## License

MIT License - Feel free to modify and distribute

## Credits

- Built with Ollama for local AI processing
- Uses qwen3-vl-32k for vision and reasoning capabilities
