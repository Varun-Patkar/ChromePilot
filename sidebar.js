// Sidebar JavaScript for ChromePilot
const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const resetBtn = document.getElementById('resetBtn');
const statusText = document.getElementById('statusText');
const statusBar = document.getElementById('statusBar');

const OLLAMA_URL = 'http://localhost:11434';
const MODEL_NAME = 'qwen3-vl-32k:latest';
const MAX_TOKENS = 32000; // Leave some buffer from 32K limit

let conversationHistory = [];
let isProcessing = false;
let includeScreenshot = true;
let includeHTML = true;

// System prompt
const SYSTEM_PROMPT = `You are ChromePilot, an AI assistant that can see and understand web pages. You have access to both a screenshot and the HTML structure of the current page. Your goal is to help users navigate, understand, and interact with web content as best as you can. Be helpful, accurate, and concise in your responses.`;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadConversationHistory();
  setupEventListeners();
  autoResizeTextarea();
  checkOllamaConnection();
});

function setupEventListeners() {
  sendBtn.addEventListener('click', handleSendMessage);
  resetBtn.addEventListener('click', handleReset);
  
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  userInput.addEventListener('input', autoResizeTextarea);

  // Toggle switches
  document.getElementById('toggleScreenshot').addEventListener('change', (e) => {
    includeScreenshot = e.target.checked;
    chrome.storage.local.set({ includeScreenshot });
  });

  document.getElementById('toggleHTML').addEventListener('change', (e) => {
    includeHTML = e.target.checked;
    chrome.storage.local.set({ includeHTML });
  });

  // Load toggle states
  chrome.storage.local.get(['includeScreenshot', 'includeHTML'], (data) => {
    if (data.includeScreenshot !== undefined) {
      includeScreenshot = data.includeScreenshot;
      document.getElementById('toggleScreenshot').checked = includeScreenshot;
    }
    if (data.includeHTML !== undefined) {
      includeHTML = data.includeHTML;
      document.getElementById('toggleHTML').checked = includeHTML;
    }
  });
}

function autoResizeTextarea() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
}

async function checkOllamaConnection() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'checkOllama' }, resolve);
    });
    
    if (response.connected) {
      if (response.hasModel) {
        updateStatus('Connected to Ollama (' + response.models.filter(m => m.includes('qwen')).join(', ') + ')', 'success');
      } else {
        updateStatus('Warning: qwen3-vl model not found in Ollama', 'error');
      }
    } else {
      updateStatus('Warning: Cannot connect to Ollama. Make sure it\'s running on localhost:11434', 'error');
    }
  } catch (error) {
    updateStatus('Warning: Cannot connect to Ollama. Make sure it\'s running on localhost:11434', 'error');
  }
}

function updateStatus(message, type = '') {
  statusText.textContent = message;
  statusBar.className = 'status-bar' + (type ? ' ' + type : '');
  
  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      if (statusText.textContent === message) {
        updateStatus('Ready');
      }
    }, 3000);
  }
}

async function handleSendMessage() {
  const message = userInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  sendBtn.disabled = true;
  userInput.disabled = true;

  // Clear welcome message if present
  const welcomeMessage = chatContainer.querySelector('.welcome-message');
  if (welcomeMessage) {
    welcomeMessage.remove();
  }

  // Add user message to UI
  addMessageToUI('user', message);
  userInput.value = '';
  autoResizeTextarea();

  try {
    let tabData = { screenshot: null, html: '', url: '', title: '' };
    
    // Only capture if at least one context option is enabled
    if (includeScreenshot || includeHTML) {
      updateStatus('Capturing page...');
      tabData = await captureCurrentTab();
      
      if (tabData.error && (includeScreenshot || includeHTML)) {
        // If capture failed but we needed it, show warning but continue
        updateStatus('Warning: ' + tabData.error, 'error');
      }
    }

    updateStatus('Sending to AI...');

    // Prepare message for Ollama
    const { prompt, imageBase64 } = await prepareOllamaRequest(message, tabData);

    // Check token count estimate
    const estimatedTokens = estimateTokens(prompt, includeHTML ? tabData.html : '');
    if (estimatedTokens > MAX_TOKENS) {
      throw new Error(`Request too large (estimated ${estimatedTokens} tokens). Try a shorter question or simpler page.`);
    }

    // Send to Ollama with streaming
    await streamOllamaResponse(prompt, imageBase64);

    updateStatus('Ready');
  } catch (error) {
    console.error('Error:', error);
    addErrorToUI(error.message);
    updateStatus('Error: ' + error.message, 'error');
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    userInput.disabled = false;
    userInput.focus();
    saveConversationHistory();
  }
}

async function captureCurrentTab() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'captureTab' }, (response) => {
      resolve(response);
    });
  });
}

async function prepareOllamaRequest(userMessage, tabData) {
  // Build context info about the page
  let contextInfo = '';
  
  if (includeHTML && tabData.html) {
    contextInfo = `Current page: ${tabData.title}\nURL: ${tabData.url}\n\nVisible HTML structure:\n${tabData.html}`;
  } else if (tabData.title || tabData.url) {
    contextInfo = `Current page: ${tabData.title}\nURL: ${tabData.url}`;
  }
  
  // Get last 4 messages (2 user + 2 assistant) for context
  const recentHistory = conversationHistory.slice(-4).filter(msg => 
    msg.role === 'user' || msg.role === 'assistant'
  );
  
  // Build conversation context string
  let conversationContext = '';
  if (recentHistory.length > 0) {
    conversationContext = '\n\nRecent conversation:\n';
    recentHistory.forEach(msg => {
      if (msg.role === 'user') {
        conversationContext += `User: ${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        conversationContext += `Assistant: ${msg.content}\n`;
      }
    });
  }
  
  const prompt = contextInfo 
    ? `${SYSTEM_PROMPT}\n\n${contextInfo}${conversationContext}\n\nUser question: ${userMessage}`
    : `${SYSTEM_PROMPT}${conversationContext}\n\nUser question: ${userMessage}`;

  // Convert screenshot to base64 (remove data URL prefix) if enabled
  // Only the current tab screenshot is sent, not historical images
  const imageBase64 = (includeScreenshot && tabData.screenshot) 
    ? tabData.screenshot.split(',')[1] 
    : null;

  return { prompt, imageBase64 };
}

function estimateTokens(prompt, html) {
  // Rough estimate: ~4 characters per token for text
  // Images are variable but we'll estimate ~1000 tokens for a typical screenshot
  const textTokens = (prompt.length + html.length) / 4;
  const imageTokens = 1500; // Conservative estimate
  return Math.ceil(textTokens + imageTokens);
}

async function streamOllamaResponse(prompt, imageBase64) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant-message';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  const thinkingSection = document.createElement('div');
  thinkingSection.className = 'thinking-section';
  thinkingSection.style.display = 'none';
  
  const thinkingHeader = document.createElement('div');
  thinkingHeader.className = 'thinking-header';
  thinkingHeader.innerHTML = `
    <span class="thinking-toggle expanded">▶</span>
    <span class="thinking-label">Thinking...</span>
    <div class="thinking-spinner"></div>
  `;
  
  const thinkingContent = document.createElement('div');
  thinkingContent.className = 'thinking-content expanded';
  
  thinkingSection.appendChild(thinkingHeader);
  thinkingSection.appendChild(thinkingContent);
  
  const responseDiv = document.createElement('div');
  responseDiv.className = 'response-text';
  
  messageDiv.appendChild(thinkingSection);
  messageDiv.appendChild(contentDiv);
  contentDiv.appendChild(responseDiv);
  
  chatContainer.appendChild(messageDiv);
  scrollToBottom();

  let fullResponse = '';
  let thinkingText = '';
  let isThinking = false;

  return new Promise((resolve, reject) => {
    // Create a long-lived connection for streaming
    const port = chrome.runtime.connect({ name: 'ollama-stream' });
    
    port.onMessage.addListener((message) => {
      if (message.action === 'ollamaChunk') {
        const lines = message.chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            // Check if there's thinking content
            const thinkingChunk = data.message?.thinking || '';
            if (thinkingChunk) {
              if (!isThinking) {
                isThinking = true;
                thinkingSection.style.display = 'block';
              }
              thinkingText += thinkingChunk;
              // Render markdown in thinking content
              thinkingContent.innerHTML = marked.parse(thinkingText);
              scrollToBottom();
            }
            
            // Check for regular content
            const contentChunk = data.message?.content || data.response || '';
            if (contentChunk) {
              // First time we get content, collapse thinking and update label
              if (isThinking && fullResponse === '') {
                const spinner = thinkingHeader.querySelector('.thinking-spinner');
                if (spinner) spinner.remove();
                
                // Change label to "View Reasoning" and collapse
                const label = thinkingHeader.querySelector('.thinking-label');
                if (label) label.textContent = 'View Reasoning';
                
                const toggle = thinkingHeader.querySelector('.thinking-toggle');
                if (toggle) toggle.classList.remove('expanded');
                thinkingContent.classList.remove('expanded');
                
                isThinking = false;
              }
              
              fullResponse += contentChunk;
              // Render markdown in real-time
              responseDiv.innerHTML = marked.parse(fullResponse);
              scrollToBottom();
            }
          } catch (e) {
            console.error('Error parsing JSON:', e, line);
          }
        }
      } else if (message.action === 'ollamaComplete') {
        port.disconnect();
        
        // Add to conversation history
        conversationHistory.push({
          role: 'assistant',
          content: fullResponse,
          thinking: thinkingText
        });

        // Make thinking section collapsible
        if (thinkingSection.style.display !== 'none') {
          thinkingHeader.style.cursor = 'pointer';
          thinkingHeader.addEventListener('click', () => {
            const toggle = thinkingHeader.querySelector('.thinking-toggle');
            const content = thinkingContent;
            
            if (content.classList.contains('expanded')) {
              content.classList.remove('expanded');
              toggle.classList.remove('expanded');
            } else {
              content.classList.add('expanded');
              toggle.classList.add('expanded');
            }
          });
        }
        
        resolve();
      } else if (message.action === 'ollamaError') {
        port.disconnect();
        contentDiv.remove();
        messageDiv.remove();
        reject(new Error(message.error));
      }
    });

    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        contentDiv.remove();
        messageDiv.remove();
        reject(new Error('Connection lost: ' + chrome.runtime.lastError.message));
      }
    });

    // Send request to background worker
    port.postMessage({
      action: 'streamOllama',
      model: MODEL_NAME,
      prompt: prompt,
      image: imageBase64
    });
  });
}



function addMessageToUI(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}-message`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  // User messages as text, assistant messages as markdown
  if (role === 'user') {
    contentDiv.textContent = content;
  } else {
    contentDiv.innerHTML = marked.parse(content);
  }
  
  messageDiv.appendChild(contentDiv);
  chatContainer.appendChild(messageDiv);
  
  scrollToBottom();

  // Add to conversation history
  if (role === 'user') {
    conversationHistory.push({ role, content });
  }
}

function addErrorToUI(errorMessage) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = `Error: ${errorMessage}`;
  chatContainer.appendChild(errorDiv);
  scrollToBottom();
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function handleReset() {
  if (isProcessing) return;
  
  if (confirm('Are you sure you want to reset the conversation?')) {
    conversationHistory = [];
    chatContainer.innerHTML = `
      <div class="welcome-message">
        <img src="icon.png" alt="ChromePilot" class="welcome-logo">
        <h2>Welcome to ChromePilot</h2>
        <p>I can see your screen and help you navigate the web. Ask me anything!</p>
      </div>
    `;
    saveConversationHistory();
    updateStatus('Conversation reset', 'success');
  }
}

function saveConversationHistory() {
  chrome.storage.local.set({ conversationHistory });
}

function loadConversationHistory() {
  chrome.storage.local.get('conversationHistory', (data) => {
    if (data.conversationHistory && data.conversationHistory.length > 0) {
      conversationHistory = data.conversationHistory;
      reconstructUI();
    }
  });
}

function reconstructUI() {
  const welcomeMessage = chatContainer.querySelector('.welcome-message');
  if (welcomeMessage) {
    welcomeMessage.remove();
  }

  conversationHistory.forEach((msg) => {
    if (msg.role === 'user') {
      addMessageToUI('user', msg.content);
    } else if (msg.role === 'assistant') {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message assistant-message';
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.innerHTML = marked.parse(msg.content);
      
      if (msg.thinking) {
        const thinkingSection = document.createElement('div');
        thinkingSection.className = 'thinking-section';
        
        const thinkingHeader = document.createElement('div');
        thinkingHeader.className = 'thinking-header';
        thinkingHeader.innerHTML = `
          <span class="thinking-toggle">▶</span>
          <span class="thinking-label">View Reasoning</span>
        `;
        
        const thinkingContent = document.createElement('div');
        thinkingContent.className = 'thinking-content';
        thinkingContent.innerHTML = marked.parse(msg.thinking);
        
        thinkingSection.appendChild(thinkingHeader);
        thinkingSection.appendChild(thinkingContent);
        
        thinkingHeader.style.cursor = 'pointer';
        thinkingHeader.addEventListener('click', () => {
          const toggle = thinkingHeader.querySelector('.thinking-toggle');
          
          if (thinkingContent.classList.contains('expanded')) {
            thinkingContent.classList.remove('expanded');
            toggle.classList.remove('expanded');
          } else {
            thinkingContent.classList.add('expanded');
            toggle.classList.add('expanded');
          }
        });
        
        messageDiv.appendChild(thinkingSection);
      }
      
      messageDiv.appendChild(contentDiv);
      chatContainer.appendChild(messageDiv);
    }
  });
  
  scrollToBottom();
}
