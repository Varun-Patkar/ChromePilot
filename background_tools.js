// Tool handler implementations for background.js
// These will be appended to background.js

// Helper function to get active tab
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('No active tab found');
  }
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
    throw new Error('Cannot interact with internal browser pages');
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
      console.log('[BG:navigate] Navigating to:', request.url);
      await chrome.tabs.update(tab.id, { url: request.url });
      
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
      throw new Error(`Unknown navigation action: ${navAction}`);
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
      console.log('[BG:manageTabs] Opening new tab:', request.url);
      const newTab = await chrome.tabs.create({ url: request.url });
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
