# ChromePilot

An AI-powered Chrome extension that can see and interact with web pages using Ollama's vision models.

## Features

- 🎯 **Visual AI Assistant**: Uses qwen3-vl-32k model to understand and analyze web pages
- 📸 **Screenshot Analysis**: Automatically captures and analyzes the current tab
- 🌐 **HTML Context**: Extracts simplified HTML structure for precise element targeting
- 💭 **Thinking Process**: Displays the model's reasoning in a collapsible section
- 🔄 **Streaming Responses**: Real-time streaming of AI responses
- 💾 **Conversation History**: Saves and restores chat history
- 🎨 **Clean UI**: Beautiful sidebar interface with smooth animations
- 🔐 **Privacy-Focused**: All processing happens locally through Ollama

## Prerequisites

1. **Ollama**: Install Ollama from [https://ollama.ai](https://ollama.ai)
2. **Vision Model**: Pull the qwen3-vl-32k model:
   ```bash
   ollama pull qwen3-vl-32k:latest
   ```
3. **Enable CORS**: Ollama must be started with CORS enabled for Chrome extensions:
   
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

1. Click the ChromePilot icon in your Chrome toolbar to open the sidebar
2. The extension will automatically:
   - Capture a screenshot of the current tab
   - Extract the visible HTML structure
   - Send both to the AI model
3. Ask questions about the page or request help navigating
4. View the AI's thinking process by clicking the "Thinking..." section
5. Click the reset button to start a new conversation

## Technical Details

### Token Management
- Maximum input: 32K tokens (including image)
- Automatic token estimation prevents truncation
- HTML is simplified and truncated to reduce token usage

### HTML Processing
The extension extracts only visible, relevant elements:
- Removes styling, scripts, and non-interactive elements
- Preserves IDs, classes, and semantic attributes
- Limits content to viewport-visible elements
- Maximum 8K characters of HTML

### Permissions
The extension requests these permissions for future features:
- `activeTab`: Capture screenshots and inject scripts
- `tabs`: Access tab information
- `scripting`: Execute content scripts
- `sidePanel`: Display the chat interface
- `storage`: Save conversation history
- `debugger`: Future mouse/keyboard control
- `<all_urls>`: Work on any webpage

## Future Enhancements

- Mouse and keyboard control
- Tab switching and management
- Form filling automation
- Multi-step task execution
- Custom actions and macros

## Troubleshooting

**"Cannot connect to Ollama" or "Failed to fetch"**
- Ensure Ollama is running with CORS enabled:
  - Windows: `set OLLAMA_ORIGINS=chrome-extension://* && ollama serve`
  - Use the `start-ollama-with-cors.bat` file provided
- Check that Ollama is accessible: Open `http://localhost:11434/api/tags` in your browser
- Restart Ollama if you forgot to set CORS initially

**"Model not found"**
- Pull the correct model: `ollama pull qwen3-vl-32k:latest`
- Verify with: `ollama list`

**"Request too large"**
- The page content exceeds 32K tokens
- Try asking a more specific question
- Navigate to a simpler page section

## License

MIT License - Feel free to modify and distribute

## Credits

- Built with Ollama for local AI processing
- Uses qwen3-vl-32k for vision and reasoning capabilities
