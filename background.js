// Background service worker for ChromePilot
chrome.action.onClicked.addListener((tab) => {
  // Open the side panel when the extension icon is clicked
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Store active streaming connection
let streamingPort = null;

// Listen for long-lived connections
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ollama-stream') {
    streamingPort = port;
    
    port.onMessage.addListener((request) => {
      if (request.action === 'streamOllama') {
        handleStreamOllama(request, port);
      }
    });
    
    port.onDisconnect.addListener(() => {
      streamingPort = null;
    });
  }
});

// Listen for messages from the sidebar
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureTab') {
    handleCaptureTab(sendResponse);
    return true; // Keep the message channel open for async response
  } else if (request.action === 'checkOllama') {
    handleCheckOllama(sendResponse);
    return true;
  }
});

async function handleCheckOllama(sendResponse) {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (response.ok) {
      const data = await response.json();
      const hasModel = data.models.some(m => 
        m.name.includes('qwen2.5-vl') || 
        m.name.includes('qwen3-vl') ||
        m.name === 'qwen3-vl-32k:latest'
      );
      sendResponse({ 
        connected: true, 
        hasModel,
        models: data.models.map(m => m.name)
      });
    } else {
      sendResponse({ connected: true, hasModel: false });
    }
  } catch (error) {
    sendResponse({ connected: false, error: error.message });
  }
}

async function handleStreamOllama(request, port) {
  try {
    console.log('Starting Ollama request with model:', request.model);
    console.log('Prompt length:', request.prompt?.length || 0);
    console.log('Has image:', !!request.image);
    
    // Prepare messages array for chat endpoint
    const messages = [
      {
        role: 'user',
        content: request.prompt
      }
    ];

    // Add image if provided
    if (request.image) {
      messages[0].images = [request.image];
      console.log('Image size (chars):', request.image.length);
    }

    const requestBody = {
      model: request.model,
      messages: messages,
      stream: true,
      options: {
        temperature: 0.7,
        num_ctx: 32768
      }
    };

    console.log('Sending request to Ollama...');
    console.log('Request body size:', JSON.stringify(requestBody).length, 'bytes');
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout
    
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    });
    
    clearTimeout(timeoutId);
    console.log('Ollama response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      port.postMessage({
        action: 'ollamaError',
        error: `Ollama error: ${response.statusText} - ${errorText}`
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      
      // Send chunk back to sidebar via port
      if (port) {
        port.postMessage({
          action: 'ollamaChunk',
          chunk: chunk
        });
      }
    }

    if (port) {
      port.postMessage({
        action: 'ollamaComplete'
      });
    }

  } catch (error) {
    console.error('Ollama streaming error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    let errorMessage = error.message;
    if (error.message.includes('Failed to fetch')) {
      errorMessage = 'Cannot connect to Ollama. Make sure Ollama is running (ollama serve) and accessible at http://localhost:11434';
    }
    
    if (port) {
      port.postMessage({
        action: 'ollamaError',
        error: errorMessage
      });
    }
  }
}

async function handleCaptureTab(sendResponse) {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      sendResponse({ error: 'No active tab found' });
      return;
    }

    // Skip chrome:// and other internal pages
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
      sendResponse({ 
        error: 'Cannot capture internal browser pages',
        screenshot: null,
        html: '',
        url: tab.url,
        title: tab.title
      });
      return;
    }

    // Capture screenshot
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png'
    });

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (injectError) {
      // Content script might already be injected, that's okay
    }

    // Wait a bit for content script to initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Request HTML content from the content script
    let html = '';
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: 'getPageContent' 
      });
      html = response.html;
    } catch (msgError) {
      console.warn('Could not get HTML content:', msgError);
      // Continue without HTML if it fails
    }

    sendResponse({
      screenshot: screenshot,
      html: html,
      url: tab.url,
      title: tab.title
    });
  } catch (error) {
    console.error('Error capturing tab:', error);
    sendResponse({ error: error.message });
  }
}
