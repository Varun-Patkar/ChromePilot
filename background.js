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
  } else if (request.action === 'getHTMLContent') {
    handleGetHTMLContent(request, sendResponse);
    return true;
  } else if (request.action === 'getPageSchema') {
    handleGetPageSchema(request, sendResponse);
    return true;
  } else if (request.action === 'executeClick') {
    handleExecuteClick(request, sendResponse);
    return true;
  } else if (request.action === 'executeType') {
    handleExecuteType(request, sendResponse);
    return true;
  } else if (request.action === 'executeSelect') {
    handleExecuteSelect(request, sendResponse);
    return true;
  } else if (request.action === 'executePressKey') {
    handleExecutePressKey(request, sendResponse);
    return true;
  } else if (request.action === 'executeScroll') {
    handleExecuteScroll(request, sendResponse);
    return true;
  } else if (request.action === 'executeNavigate') {
    handleExecuteNavigate(request, sendResponse);
    return true;
  } else if (request.action === 'executeManageTabs') {
    handleExecuteManageTabs(request, sendResponse);
    return true;
  } else if (request.action === 'executeWaitFor') {
    handleExecuteWaitFor(request, sendResponse);
    return true;
  } else if (request.action === 'checkOllama') {
    handleCheckOllama(sendResponse);
    return true;
  } else if (request.action === 'executeWithModel') {
    handleExecuteWithModel(request, sendResponse);
    return true;
  }
});

async function handleCheckOllama(sendResponse) {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (response.ok) {
      const data = await response.json();
      const hasOrchestrator = data.models.some(m => 
        m.name.includes('qwen2.5-vl') || 
        m.name.includes('qwen3-vl-32k') ||
        m.name === 'qwen3-vl-32k:latest'
      );
      const hasExecutor = data.models.some(m => 
        m.name.includes('llama3.1') || 
        m.name === 'llama3.1-8b-32k:latest'
      );
      sendResponse({ 
        connected: true, 
        hasModel: hasOrchestrator && hasExecutor,
        models: data.models.map(m => m.name),
        missingModels: [
          ...(!hasOrchestrator ? ['qwen3-vl-32k:latest'] : []),
          ...(!hasExecutor ? ['llama3.1-8b-32k:latest'] : [])
        ]
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
        num_ctx: 16384,  // Reduced from 32768 for faster processing
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

async function handleGetHTMLContent(request, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      sendResponse({ error: 'No active tab found' });
      return;
    }

    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
      sendResponse({ error: 'Cannot access internal browser pages' });
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      // Already injected
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const selector = request.selector;
    const response = await chrome.tabs.sendMessage(tab.id, { 
      action: selector ? 'getElementHTML' : 'getPageContent',
      selector: selector
    });
    
    if (response.error) {
      sendResponse({ error: response.error, success: false });
    } else {
      sendResponse({ html: response.html, success: true });
    }
  } catch (error) {
    console.error('Error getting HTML content:', error);
    sendResponse({ error: error.message, success: false });
  }
}

async function handleGetPageSchema(request, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true });
    const tab = tabs.find(t => 
      !t.url.startsWith('chrome://') && 
      !t.url.startsWith('chrome-extension://') && 
      !t.url.startsWith('edge://')
    );
    
    if (!tab) {
      sendResponse({ error: 'No active tab found' });
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      // Already injected
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const response = await chrome.tabs.sendMessage(tab.id, { 
      action: 'getPageSchema',
      selector: request.selector || null
    });
    
    if (response.error) {
      sendResponse({ error: response.error, success: false });
    } else {
      sendResponse({ schema: response.schema, success: true });
    }
  } catch (error) {
    console.error('Error getting page schema:', error);
    sendResponse({ error: error.message, success: false });
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

// Handle executor model calls (llama3.1-8b-32k:latest) for tool execution
async function handleExecuteWithModel(request, sendResponse) {
  const { model, prompt } = request;
  
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        format: 'json',  // Force JSON output
        options: {
          temperature: 0.3,  // Lower for more deterministic tool selection
          num_predict: 500   // Allow sufficient length for tool selection with reasoning
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }
    
    const data = await response.json();
    sendResponse({ 
      success: true, 
      result: data.response 
    });
    
  } catch (error) {
    console.error('Executor model error:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

// ===== TOOL HANDLER IMPLEMENTATIONS =====

// Helper function to normalize URLs (add https:// if missing)
function normalizeUrl(url) {
  if (!url) return url;
  
  // If already has protocol, return as-is
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
    return url;
  }
  
  // Add https:// prefix
  return 'https://' + url;
}

// Helper function to get active tab
async function getActiveTab() {
  // Don't use currentWindow: true because side panel is in a different window context
  const tabs = await chrome.tabs.query({ active: true });
  
  // Find the first active tab that's not a chrome:// or extension page
  const tab = tabs.find(t => 
    !t.url.startsWith('chrome://') && 
    !t.url.startsWith('chrome-extension://') && 
    !t.url.startsWith('edge://')
  );
  
  if (!tab) {
    throw new Error('No active tab found');
  }
  
  return tab;
}

// Helper function to ensure content script is injected
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (e) {
    // Already injected, ignore error
  }
}

// 1. Click Tool Handler
async function handleExecuteClick(request, sendResponse) {
  console.log('[BG:click] Starting click execution', request);
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'clickElement',
      a11yId: request.a11yId,
      selector: request.selector,
      clickType: request.clickType || 'single'
    });
    
    console.log('[BG:click] Content script response:', response);
    sendResponse(response);
  } catch (error) {
    console.error('[BG:click] ERROR:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      elementText: '',
      elementClicked: ''
    });
  }
}

// 2. Type Tool Handler
async function handleExecuteType(request, sendResponse) {
  console.log('[BG:type] Starting type execution', request);
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'typeText',
      a11yId: request.a11yId,
      selector: request.selector,
      text: request.text,
      mode: request.mode || 'replace',
      submit: request.submit || false
    });
    
    console.log('[BG:type] Content script response:', response);
    sendResponse(response);
  } catch (error) {
    console.error('[BG:type] ERROR:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      finalValue: ''
    });
  }
}

// 3. Select Tool Handler
async function handleExecuteSelect(request, sendResponse) {
  console.log('[BG:select] Starting select execution', request);
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'selectOption',
      selector: request.selector,
      option: request.option,
      by: request.by || 'value'
    });
    
    console.log('[BG:select] Content script response:', response);
    sendResponse(response);
  } catch (error) {
    console.error('[BG:select] ERROR:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      selectedValue: '',
      selectedText: ''
    });
  }
}

// 4. Press Key Tool Handler
async function handleExecutePressKey(request, sendResponse) {
  console.log('[BG:pressKey] Starting pressKey execution', request);
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'pressKey',
      key: request.key,
      selector: request.selector || null
    });
    
    console.log('[BG:pressKey] Content script response:', response);
    sendResponse(response);
  } catch (error) {
    console.error('[BG:pressKey] ERROR:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      keyPressed: ''
    });
  }
}

// 5. Scroll Tool Handler
async function handleExecuteScroll(request, sendResponse) {
  console.log('[BG:scroll] Starting scroll execution', request);
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'scrollPage',
      target: request.target || null,
      direction: request.direction,
      amount: request.amount || null
    });
    
    console.log('[BG:scroll] Content script response:', response);
    sendResponse(response);
  } catch (error) {
    console.error('[BG:scroll] ERROR:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      scrollPosition: 0
    });
  }
}

// 6. Navigate Tool Handler
async function handleExecuteNavigate(request, sendResponse) {
  console.log('[BG:navigate] Starting navigate execution', request);
  try {
    const tab = await getActiveTab();
    const navAction = request.navAction;
    
    if (navAction === 'goto') {
      if (!request.url) {
        throw new Error('URL is required for goto action');
      }
      const normalizedUrl = normalizeUrl(request.url);
      console.log('[BG:navigate] Navigating to:', normalizedUrl);
      await chrome.tabs.update(tab.id, { url: normalizedUrl });
      
      // Wait a bit for navigation to start
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const updatedTab = await chrome.tabs.get(tab.id);
      sendResponse({
        success: true,
        currentUrl: updatedTab.url,
        title: updatedTab.title || 'Loading...'
      });
      
    } else if (navAction === 'back') {
      console.log('[BG:navigate] Going back');
      await chrome.tabs.goBack(tab.id);
      await new Promise(resolve => setTimeout(resolve, 300));
      const updatedTab = await chrome.tabs.get(tab.id);
      sendResponse({
        success: true,
        currentUrl: updatedTab.url,
        title: updatedTab.title
      });
      
    } else if (navAction === 'forward') {
      console.log('[BG:navigate] Going forward');
      await chrome.tabs.goForward(tab.id);
      await new Promise(resolve => setTimeout(resolve, 300));
      const updatedTab = await chrome.tabs.get(tab.id);
      sendResponse({
        success: true,
        currentUrl: updatedTab.url,
        title: updatedTab.title
      });
      
    } else if (navAction === 'reload') {
      console.log('[BG:navigate] Reloading page');
      await chrome.tabs.reload(tab.id);
      await new Promise(resolve => setTimeout(resolve, 500));
      const updatedTab = await chrome.tabs.get(tab.id);
      sendResponse({
        success: true,
        currentUrl: updatedTab.url,
        title: updatedTab.title
      });
      
    } else {
      const errorMsg = navAction === 'open' 
        ? `Invalid action '${navAction}' for navigate tool. To open a NEW tab, use the 'manageTabs' tool with action 'open'. To navigate current tab, use action 'goto'.`
        : `Unknown navigation action: ${navAction}. Valid actions are: goto, back, forward, reload`;
      throw new Error(errorMsg);
    }
  } catch (error) {
    console.error('[BG:navigate] ERROR:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      currentUrl: '',
      title: ''
    });
  }
}

// 7. Manage Tabs Tool Handler
async function handleExecuteManageTabs(request, sendResponse) {
  console.log('[BG:manageTabs] Starting manageTabs execution', request);
  try {
    const tabAction = request.tabAction;
    
    if (tabAction === 'list') {
      console.log('[BG:manageTabs] Listing all tabs');
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const tabsInfo = tabs.map(t => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.active,
        index: t.index
      }));
      const activeTab = tabs.find(t => t.active);
      sendResponse({
        success: true,
        tabs: tabsInfo,
        activeTabId: activeTab ? activeTab.id : null
      });
      
    } else if (tabAction === 'open') {
      if (!request.url) {
        throw new Error('URL is required for open action');
      }
      const normalizedUrl = normalizeUrl(request.url);
      console.log('[BG:manageTabs] Opening new tab:', normalizedUrl);
      const newTab = await chrome.tabs.create({ url: normalizedUrl });
      sendResponse({
        success: true,
        tabs: [{ id: newTab.id, url: newTab.url, title: newTab.title }],
        activeTabId: newTab.id
      });
      
    } else if (tabAction === 'close') {
      if (!request.tabId) {
        throw new Error('tabId is required for close action');
      }
      console.log('[BG:manageTabs] Closing tab:', request.tabId);
      await chrome.tabs.remove(request.tabId);
      const remainingTabs = await chrome.tabs.query({ currentWindow: true });
      const activeTab = remainingTabs.find(t => t.active);
      sendResponse({
        success: true,
        tabs: remainingTabs.map(t => ({ id: t.id, url: t.url, title: t.title })),
        activeTabId: activeTab ? activeTab.id : null
      });
      
    } else if (tabAction === 'switch') {
      if (!request.tabId) {
        throw new Error('tabId is required for switch action');
      }
      console.log('[BG:manageTabs] Switching to tab:', request.tabId);
      await chrome.tabs.update(request.tabId, { active: true });
      const tab = await chrome.tabs.get(request.tabId);
      sendResponse({
        success: true,
        tabs: [{ id: tab.id, url: tab.url, title: tab.title, active: true }],
        activeTabId: tab.id
      });
      
    } else {
      throw new Error(`Unknown tab action: ${tabAction}`);
    }
  } catch (error) {
    console.error('[BG:manageTabs] ERROR:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      tabs: [],
      activeTabId: null
    });
  }
}

// 8. Wait For Tool Handler
async function handleExecuteWaitFor(request, sendResponse) {
  console.log('[BG:waitFor] Starting waitFor execution', request);
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'waitFor',
      waitType: request.waitType,
      selector: request.selector || null,
      timeout: request.timeout || 5000
    });
    
    console.log('[BG:waitFor] Content script response:', response);
    sendResponse(response);
  } catch (error) {
    console.error('[BG:waitFor] ERROR:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      elementFound: false,
      timeWaited: 0
    });
  }
}
