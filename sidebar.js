// Sidebar JavaScript for ChromePilot
const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const resetBtn = document.getElementById('resetBtn');
const statusText = document.getElementById('statusText');
const statusBar = document.getElementById('statusBar');

const OLLAMA_URL = 'http://localhost:11434';
const ORCHESTRATOR_MODEL = 'qwen3-vl-32k:latest'; // Reasoning model for plan generation
const EXECUTOR_MODEL = 'llama3.1:8b'; // Fast execution model
const MAX_TOKENS = 32000; // Leave some buffer from 32K limit

let conversationHistory = [];
let isProcessing = false;
let includeScreenshot = true;
let currentPlan = null;
let currentPlanMessage = null;
let isAwaitingApproval = false;
let rejectionCount = 0;
let lastPromptData = null;
let retryCount = 0;
let failedStepIndex = -1;
let executionHistory = [];
let stopGenerationRequested = false;
let activeStreamPort = null;

// Available tools definition with input/output specs
const AVAILABLE_TOOLS = [
  {
    name: "click",
    description: "Click on any element on the page",
    inputs: ["selector", "clickType"],
    outputs: ["success", "elementText", "elementClicked"],
    inputDescription: "selector: CSS selector for element to click. clickType: (Optional) 'single' (default), 'double', or 'right'",
    outputDescription: "Returns success status, text content of clicked element, and element description"
  },
  {
    name: "type",
    description: "Type text into an input field, textarea, or contenteditable element",
    inputs: ["selector", "text", "mode", "submit"],
    outputs: ["success", "finalValue"],
    inputDescription: "selector: CSS selector for input element. text: Text to type. mode: (Optional) 'replace' (default) or 'append'. submit: (Optional) true to press Enter after typing",
    outputDescription: "Returns success status and final value of the input field"
  },
  {
    name: "select",
    description: "Select an option from a dropdown menu",
    inputs: ["selector", "option", "by"],
    outputs: ["success", "selectedValue", "selectedText"],
    inputDescription: "selector: CSS selector for select element. option: Value to select. by: (Optional) 'value' (default), 'text', or 'index'",
    outputDescription: "Returns success status, selected value, and visible text"
  },
  {
    name: "pressKey",
    description: "Simulate keyboard key presses (Enter, Tab, Escape, arrows, shortcuts, etc.)",
    inputs: ["key", "selector"],
    outputs: ["success", "keyPressed"],
    inputDescription: "key: Key name (Enter, Tab, Escape, ArrowUp, ArrowDown, PageUp, PageDown, etc.) or shortcut (Ctrl+A, Ctrl+F, etc.). selector: (Optional) Element to focus before pressing key",
    outputDescription: "Returns success status and the key that was pressed"
  },
  {
    name: "scroll",
    description: "Scroll the page or an element",
    inputs: ["target", "direction", "amount"],
    outputs: ["success", "scrollPosition"],
    inputDescription: "target: (Optional) CSS selector for element to scroll, or empty for page. direction: 'up', 'down', 'top', 'bottom', or 'toElement'. amount: (Optional) Pixels to scroll for up/down",
    outputDescription: "Returns success status and current scroll position"
  },
  {
    name: "navigate",
    description: "Navigate to a URL in the CURRENT tab, or use browser back/forward/reload. Does NOT open new tabs.",
    inputs: ["action", "url"],
    outputs: ["success", "currentUrl", "title"],
    inputDescription: "action: 'goto' (navigate current tab to URL), 'back', 'forward', or 'reload'. url: Required for 'goto' action. NOTE: To open a NEW tab, use manageTabs tool instead",
    outputDescription: "Returns success status, current URL, and page title"
  },
  {
    name: "manageTabs",
    description: "Open NEW browser tabs, close tabs, switch between tabs, or list all tabs. Use this to open new tabs.",
    inputs: ["action", "tabId", "url"],
    outputs: ["success", "tabs", "activeTabId"],
    inputDescription: "action: 'open' (new tab), 'close', 'switch', or 'list'. tabId: Required for close/switch. url: Required for open",
    outputDescription: "Returns success status, tab information, and active tab ID"
  },
  {
    name: "waitFor",
    description: "Wait for an element to appear, page to load, or network to be idle",
    inputs: ["waitType", "selector", "timeout"],
    outputs: ["success", "elementFound", "timeWaited"],
    inputDescription: "waitType: MUST be 'element' (wait for selector), 'navigation' (wait for page load), or 'networkIdle' (wait for network). selector: Required for 'element' type only. timeout: (Optional) Max wait time in ms, default 5000",
    outputDescription: "Returns success status, whether element was found, and time waited in milliseconds"
  },
  {
    name: "getSchema",
    description: "Get lightweight HTML structure/hierarchy showing all elements with their tag names, IDs, classes, and attributes. Use this FIRST to find selectors before using getHTML or interacting with elements.",
    inputs: ["selector"],
    outputs: ["schema", "success"],
    inputDescription: "selector: (Optional) CSS selector to get schema of specific element. If not provided, returns full page schema",
    outputDescription: "Returns element hierarchy with tag names, IDs, classes, and key attributes (no content, just structure)"
  },
  {
    name: "getHTML",
    description: "Gets the full HTML content of a specific element. Use AFTER getSchema to get content of identified element. Heavy operation - use sparingly.",
    inputs: ["selector"],
    outputs: ["html", "success"],
    inputDescription: "selector: CSS selector for specific element (REQUIRED - must be found from getSchema first). Never use without selector.",
    outputDescription: "Returns HTML content as string and success status"
  }
];

function generateToolsPrompt() {
  return AVAILABLE_TOOLS.map(tool => 
    `- ${tool.name}: ${tool.description}\n  Inputs: ${tool.inputs.join(', ')}\n  Outputs: ${tool.outputs.join(', ')}`
  ).join('\n');
}

// System prompt for agent mode
const ORCHESTRATOR_PROMPT = `You are ChromePilot. Create browser automation plans.

Tools: click, type, select, pressKey, scroll, navigate, manageTabs, waitFor, getSchema, getHTML

Output JSON: {"needs_steps": true/false, "steps": ["step 1", "step 2"], "message": "brief"}

CRITICAL RULES:
1. Pre-Check: If user says "open [site]" (no "new tab") and URL matches → needs_steps=false
2. Think briefly: simple tasks 1-2 sentences, never circle
3. Page Load: After "Open tab" or "Go to URL", NEXT step MUST be "Wait for page load"
4. Interactive Snapshot: getSchema returns simplified JSON array of interactive elements only
   Format: [{"id": 1, "type": "input", "role": "searchbox", "label": "Search", "placeholder": "..."}, ...]
5. Selectors: NEVER guess. Always getSchema FIRST, then reference "[from step X]" in action steps
6. Atomic: One action per step only
7. BE SPECIFIC: Include URLs, full text, and details in step descriptions
8. Submit: NEVER use "Press Enter". ALWAYS click the submit button from schema (role="button")
9. Final Step: ALWAYS end plan with "Wait for the page to load completely" after last action
10. Selector Pattern - REQUIRED: Reference previous schema step
   Example plan for "search YouTube for never gonna give you up":
   - "Open a new tab with URL https://www.youtube.com"
   - "Wait for the page to load completely"
   - "Get page schema to find interactive elements"
   - "Click the search input [from step 3]"
   - "Type 'never gonna give you up' into search [from step 3]"
   - "Click the search button [from step 3]"
   - "Wait for the page to load completely"
11. Known URLs: youtube.com, google.com, facebook.com, twitter.com, amazon.com`;

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

  // Load toggle state
  chrome.storage.local.get(['includeScreenshot'], (data) => {
    if (data.includeScreenshot !== undefined) {
      includeScreenshot = data.includeScreenshot;
      document.getElementById('toggleScreenshot').checked = includeScreenshot;
    }
  });

  // Create scroll-to-bottom button
  scrollToBottomBtn = document.createElement('button');
  scrollToBottomBtn.className = 'scroll-to-bottom-btn';
  scrollToBottomBtn.innerHTML = '↓';
  scrollToBottomBtn.style.display = 'none';
  scrollToBottomBtn.addEventListener('click', () => {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
  });
  document.querySelector('.container').appendChild(scrollToBottomBtn);

  // Add scroll listener to show/hide button
  chatContainer.addEventListener('scroll', () => {
    const isAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 50;
    scrollToBottomBtn.style.display = isAtBottom ? 'none' : 'flex';
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
        const modelNames = response.models.filter(m => m.includes('qwen') || m.includes('llama')).join(', ');
        updateStatus('Connected to Ollama (' + modelNames + ')', 'success');
      } else {
        updateStatus('Warning: Required models (qwen3-vl-32k, llama3.1:8b) not found in Ollama', 'error');
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

async function handleSendMessage(isCorrection = false) {
  const message = userInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  sendBtn.disabled = true;
  userInput.disabled = true;
  
  // Show stop button
  sendBtn.textContent = '⏹️ Stop';
  sendBtn.style.background = '#f44336';
  sendBtn.disabled = false;
  sendBtn.onclick = () => {
    stopGenerationRequested = true;
    if (activeStreamPort) {
      activeStreamPort.disconnect();
      activeStreamPort = null;
    }
    updateStatus('Generation stopped', 'error');
    resetUIAfterProcessing();
  };

  // Clear welcome message if present
  const welcomeMessage = chatContainer.querySelector('.welcome-message');
  if (welcomeMessage) {
    welcomeMessage.remove();
  }
  
  // Remove any retry/continue buttons from previous failed plans
  const existingButtons = chatContainer.querySelectorAll('.plan-btn-retry, .plan-btn-continue');
  existingButtons.forEach(btn => btn.remove());

  // Add user message to UI (no loader)
  addMessageToUI('user', message);
  userInput.value = '';
  autoResizeTextarea();

  try {
    let tabData = { screenshot: null, html: '', url: '', title: '' };
    
    // Only capture if screenshot is enabled and not a correction
    if (!isCorrection && includeScreenshot) {
      updateStatus('Capturing page...');
      tabData = await captureCurrentTab();
      
      if (tabData.error && includeScreenshot) {
        updateStatus('Warning: ' + tabData.error, 'error');
      }
    } else if (isCorrection && lastPromptData) {
      // Reuse previous capture data for corrections
      tabData = lastPromptData.tabData;
    }

    updateStatus('Generating plan...');

    // Prepare message for Ollama
    const { prompt, imageBase64 } = await prepareOllamaRequest(
      message, 
      tabData, 
      isCorrection
    );

    // Store for potential correction
    lastPromptData = { tabData, originalMessage: message };

    // Check token count estimate
    const estimatedTokens = estimateTokens(prompt, '');
    if (estimatedTokens > MAX_TOKENS) {
      throw new Error(`Request too large (estimated ${estimatedTokens} tokens). Try a shorter question or simpler page.`);
    }

    // Show thinking loader (will be removed when first chunk arrives)
    const thinkingLoader = showCenteredLoader('Thinking...');
    
    // Send to Ollama with streaming and get agent response
    const agentResponse = await streamOllamaResponse(prompt, imageBase64);

    // Parse and display agent response
    await handleAgentResponse(agentResponse);

    updateStatus('Ready');
    resetUIAfterProcessing();
  } catch (error) {
    console.error('Error:', error);
    
    addErrorToUI(error.message);
    updateStatus('Error: ' + error.message, 'error');
    
    resetUIAfterProcessing();
  }
}

function resetUIAfterProcessing() {
  isProcessing = false;
  sendBtn.disabled = false;
  userInput.disabled = false;
  sendBtn.textContent = 'Send';
  sendBtn.style.background = '';
  sendBtn.onclick = null;
  userInput.focus();
}

async function captureCurrentTab() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'captureTab' }, (response) => {
      resolve(response);
    });
  });
}

async function prepareOllamaRequest(userMessage, tabData, isCorrection = false) {
  // Build context info about CURRENT page only (not historical)
  // Only include URL and title - screenshot provides visual context
  let contextInfo = '';
  
  if (tabData && tabData.url) {
    contextInfo = `Current page: ${tabData.title}\nURL: ${tabData.url}`;
  } else if (tabData.title || tabData.url) {
    contextInfo = `Current page: ${tabData.title}\nURL: ${tabData.url}`;
  }
  
  // Get previous conversation messages (user prompts and bot responses only, no HTML/screenshots)
  // For 2nd prompt: Should have [user1, bot1] 
  // For 3rd prompt: Should have [user1, bot1, user2, bot2]
  // Keep last 4 messages (2 exchanges) to avoid token bloat
  const recentHistory = conversationHistory.slice(-4).filter(msg => 
    msg.role === 'user' || msg.role === 'assistant'
  );
  
  // Build conversation context string - only text messages, no embedded HTML/images
  let conversationContext = '';
  if (recentHistory.length > 0) {
    conversationContext = '\n\nPrevious conversation:\n';
    recentHistory.forEach(msg => {
      if (msg.role === 'user') {
        conversationContext += `User: ${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        // Only include message text, not plans/steps
        conversationContext += `Assistant: ${msg.content}\n`;
      }
    });
  }
  
  // Add correction context if applicable
  let correctionNote = '';
  if (isCorrection && currentPlan && currentPlanMessage) {
    correctionNote = `\n\nPrevious plan was rejected. Previous message: "${currentPlanMessage}"\nPrevious plan: ${JSON.stringify(currentPlan, null, 2)}\n\nUser's correction: ${userMessage}\n\nPlease create a NEW plan based on this correction.`;
  }
  
  // Build final prompt: System prompt + current context (HTML/screenshot) + previous messages + current question
  const prompt = contextInfo 
    ? `${ORCHESTRATOR_PROMPT}\n\n${contextInfo}${conversationContext}${correctionNote}\n\nUser question: ${isCorrection && lastPromptData ? lastPromptData.originalMessage : userMessage}`
    : `${ORCHESTRATOR_PROMPT}${conversationContext}${correctionNote}\n\nUser question: ${isCorrection && lastPromptData ? lastPromptData.originalMessage : userMessage}`;

  // Convert screenshot to base64 (remove data URL prefix) if enabled
  // Only the CURRENT screenshot is sent, not historical images
  console.log('[prepareOllamaRequest] includeScreenshot:', includeScreenshot, 'tabData.screenshot:', !!tabData.screenshot);
  const imageBase64 = (includeScreenshot && tabData.screenshot) 
    ? tabData.screenshot.split(',')[1] 
    : null;
  console.log('[prepareOllamaRequest] imageBase64:', !!imageBase64);

  return { prompt, imageBase64 };
}

function estimateTokens(prompt, html) {
  // Rough estimate: ~4 characters per token for text
  // Images are variable but we'll estimate ~1000 tokens for a typical screenshot
  const textTokens = (prompt.length + html.length) / 4;
  const imageTokens = 1500; // Conservative estimate
  return Math.ceil(textTokens + imageTokens);
}

async function handleAgentResponse(responseText) {
  try {
    // Clean response text - remove any trailing incomplete JSON
    let cleanText = responseText.trim();
    
    // If response doesn't end with }, it might be truncated
    if (!cleanText.endsWith('}')) {
      console.warn('[Agent Response] Response appears truncated, attempting to fix...');
      // Try to find the last complete JSON object
      const lastBrace = cleanText.lastIndexOf('}');
      if (lastBrace > 0) {
        cleanText = cleanText.substring(0, lastBrace + 1);
      }
    }
    
    // Parse JSON response
    const response = JSON.parse(cleanText);
    
    // Store current plan (use steps from new format)
    currentPlan = response.steps || [];
    currentPlanMessage = response.message || '';
    
    // Display assistant message
    const assistantMessageDiv = document.createElement('div');
    assistantMessageDiv.className = 'message assistant-message';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = marked.parse(response.message);
    
    assistantMessageDiv.appendChild(contentDiv);
    
    // If needs steps, show plan UI
    if (response.needs_steps && response.steps && response.steps.length > 0) {
      const planContainer = createPlanUI(response.steps);
      assistantMessageDiv.appendChild(planContainer);
      isAwaitingApproval = true;
    } else {
      // No plan needed, conversation continues normally
      isProcessing = false;
      sendBtn.disabled = false;
      userInput.disabled = false;
      userInput.focus();
    }
    
    chatContainer.appendChild(assistantMessageDiv);
    scrollToBottom();
    
    // Add to history - store only the message text, not steps/plans
    conversationHistory.push({
      role: 'assistant',
      content: response.message
    });
    
    saveConversationHistory();
  } catch (error) {
    console.error('Error parsing agent response:', error);
    console.error('Response text:', responseText);
    
    // More helpful error message
    if (responseText.length === 0) {
      throw new Error('No response received from AI. Please try again.');
    } else if (!responseText.trim().startsWith('{')) {
      throw new Error('AI response is not in JSON format. The model may have returned plain text instead.');
    } else {
      throw new Error('Failed to parse AI response. The response may be incomplete or malformed. This can happen if the AI thinks too long. Try a simpler question or disable "Show Thinking" if available.');
    }
  }
}

function createPlanUI(steps) {
  const container = document.createElement('div');
  container.className = 'plan-container';
  
  const header = document.createElement('div');
  header.className = 'plan-header';
  header.innerHTML = `
    <span class="plan-toggle expanded">▼</span>
    <span class="plan-title">Execution Plan</span>
    <span class="plan-status">Awaiting Approval</span>
  `;
  container.appendChild(header);
  
  const stepsContainer = document.createElement('div');
  stepsContainer.className = 'plan-steps expanded';
  
  steps.forEach((stepDescription, index) => {
    const stepDiv = document.createElement('div');
    stepDiv.className = 'plan-step';
    stepDiv.dataset.stepIndex = index;
    
    const stepNumber = document.createElement('span');
    stepNumber.className = 'plan-step-number';
    stepNumber.textContent = index + 1;
    
    const stepDescription_elem = document.createElement('span');
    stepDescription_elem.className = 'plan-step-description';
    stepDescription_elem.textContent = stepDescription;
    
    const stepStatus = document.createElement('span');
    stepStatus.className = 'plan-step-status';
    stepStatus.textContent = '⏳ Pending';
    
    const stepOutput = document.createElement('div');
    stepOutput.className = 'plan-step-output';
    stepOutput.style.display = 'none';
    
    stepDiv.appendChild(stepNumber);
    stepDiv.appendChild(stepDescription_elem);
    stepDiv.appendChild(stepStatus);
    stepDiv.appendChild(stepOutput);
    
    stepsContainer.appendChild(stepDiv);
  });
  
  // Add action buttons inside stepsContainer so they collapse
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'plan-actions';
  
  const approveBtn = document.createElement('button');
  approveBtn.className = 'plan-btn plan-btn-approve';
  approveBtn.innerHTML = '✓ Approve & Execute';
  approveBtn.onclick = () => handlePlanApproval(container);
  
  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'plan-btn plan-btn-reject';
  rejectBtn.innerHTML = '✗ Reject';
  rejectBtn.onclick = () => handlePlanRejection(container);
  
  actionsDiv.appendChild(rejectBtn);
  actionsDiv.appendChild(approveBtn);
  stepsContainer.appendChild(actionsDiv);
  
  container.appendChild(stepsContainer);
  
  // Make header collapsible - collapse steps and their details
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    const toggle = header.querySelector('.plan-toggle');
    if (stepsContainer.classList.contains('expanded')) {
      stepsContainer.classList.remove('expanded');
      toggle.textContent = '▶';
      toggle.classList.remove('expanded');
      // Also collapse all step outputs
      const allStepOutputs = stepsContainer.querySelectorAll('.plan-step-output');
      allStepOutputs.forEach(output => {
        output.style.display = 'none';
      });
    } else {
      stepsContainer.classList.add('expanded');
      toggle.textContent = '▼';
      toggle.classList.add('expanded');
    }
  });
  
  return container;
}

async function handlePlanApproval(planContainer, isRetry = false, resumeFromStep = 0) {
  // Disable buttons
  const buttons = planContainer.querySelectorAll('.plan-btn');
  buttons.forEach(btn => btn.disabled = true);
  
  // Remove any existing retry button
  const existingRetryBtn = planContainer.querySelector('.plan-btn-retry');
  if (existingRetryBtn) {
    existingRetryBtn.remove();
  }
  
  // Update overall status
  const planStatus = planContainer.querySelector('.plan-status');
  planStatus.textContent = isRetry ? 'Retrying...' : 'Executing...';
  planStatus.style.color = '#2196F3';
  
  updateStatus(isRetry ? 'Retrying from failed step...' : 'Executing plan...');
  
  try {
    // Start from specified step (for retry) or from beginning
    const startIndex = resumeFromStep;
    
    // Execute each step in the plan
    for (let i = startIndex; i < currentPlan.length; i++) {
      const stepDescription = currentPlan[i];
      const stepDiv = planContainer.querySelector(`[data-step-index="${i}"]`);
      const stepStatus = stepDiv.querySelector('.plan-step-status');
      const stepNumber = stepDiv.querySelector('.plan-step-number');
      const stepOutput = stepDiv.querySelector('.plan-step-output');
      
      // Mark as executing
      stepStatus.textContent = '⚙️ Executing...';
      stepStatus.style.color = '#2196F3';
      stepNumber.style.background = '#2196F3';
      stepDiv.style.borderLeftColor = '#2196F3';
      stepDiv.style.background = '#e3f2fd';
      
      updateStatus(`Executing step ${i + 1}/${currentPlan.length}...`);
      
      try {
        // Execute step with executor LLM
        const execution = await executeStep(stepDescription, i, executionHistory);
        
        // Add to execution history (or replace if retrying same step)
        if (executionHistory[i]) {
          executionHistory[i] = execution;
        } else {
          executionHistory.push(execution);
        }
        
        // Display output
        stepOutput.innerHTML = `
          <div><strong>Tool:</strong> ${execution.tool}</div>
          <div><strong>Inputs:</strong> ${JSON.stringify(execution.inputs, null, 2)}</div>
          <div><strong>Outputs:</strong> ${JSON.stringify(execution.outputs, null, 2)}</div>
        `;
        stepOutput.style.display = 'block';
        
        // Mark as completed
        stepStatus.textContent = '✓ Completed';
        stepStatus.style.color = '#4CAF50';
        stepNumber.style.background = '#4CAF50';
        stepDiv.style.borderLeftColor = '#4caf50';
        stepDiv.style.background = '#e8f5e9';
      } catch (error) {
        // Mark as failed - DO NOT retry automatically
        stepStatus.textContent = '✗ Failed';
        stepStatus.style.color = '#f44336';
        stepNumber.style.background = '#f44336';
        stepDiv.style.borderLeftColor = '#f44336';
        stepDiv.style.background = '#ffebee';
        
        stepOutput.innerHTML = `<div style="color: #f44336;"><strong>Error:</strong> ${error.message}</div>`;
        stepOutput.style.display = 'block';
        
        // Store failed step info
        failedStepIndex = i;
        
        // Stop execution immediately - DO NOT continue to next steps
        throw error;
      }
      
      // Small delay between steps
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // All steps completed successfully - now verify if task is actually done
    planStatus.textContent = 'Verifying...';
    planStatus.style.color = '#2196F3';
    updateStatus('Verifying task completion...');
    
    // Show evaluation loader
    const evalLoader = showCenteredLoader('Evaluating success...');
    
    try {
      // Capture current page state (ONLY screenshot, no HTML)
      const verificationData = await captureCurrentTab();
      
      // Verification prompt with title and URL context
      const verificationPrompt = `Did this task complete successfully: "${lastPromptData?.originalMessage || 'Unknown'}"

Page Title: ${verificationData.title || 'Unknown'}
URL: ${verificationData.url || 'Unknown'}

Look at the screenshot and determine if the user's request was accomplished.

Output JSON only:
{"task_completed": true/false, "message": "brief reason"}`;
      
      const verificationImageBase64 = verificationData.screenshot ? verificationData.screenshot.split(',')[1] : null;
      
      // Get verification response
      const verificationResponse = await streamOllamaResponse(verificationPrompt, verificationImageBase64);
      const verification = JSON.parse(verificationResponse);
      
      // Remove evaluation loader
      removeCenteredLoader();
      
      if (verification.task_completed) {
        planStatus.textContent = 'Completed ✓';
        planStatus.style.color = '#4CAF50';
        updateStatus('Task completed successfully!', 'success');
        
        // Add success message to chat
        const successDiv = document.createElement('div');
        successDiv.className = 'message assistant-message';
        successDiv.innerHTML = `<div class="message-content"><strong>✓ Task Verified:</strong> ${verification.message}</div>`;
        chatContainer.appendChild(successDiv);
      } else {
        planStatus.textContent = 'Completed but task not achieved';
        planStatus.style.color = '#FF9800';
        updateStatus('Plan executed but task may not be complete', 'error');
        
        // Add failure message to chat
        const failureDiv = document.createElement('div');
        failureDiv.className = 'message assistant-message';
        failureDiv.innerHTML = `<div class="message-content"><strong>⚠ Task Verification Failed:</strong> ${verification.message}<br><br>Please provide more details about what went wrong or how to correct the approach.</div>`;
        chatContainer.appendChild(failureDiv);
      }
    } catch (error) {
      console.error('Verification error:', error);
      removeCenteredLoader();
      planStatus.textContent = 'Completed (verification failed)';
      planStatus.style.color = '#4CAF50';
      updateStatus('Plan executed (could not verify)', 'success');
    }
    
    scrollToBottom();
    
    // Reset state
    isAwaitingApproval = false;
    rejectionCount = 0;
    retryCount = 0;
    failedStepIndex = -1;
    executionHistory = [];
    currentPlan = null;
    lastPromptData = null;
    
    // Re-enable input
    isProcessing = false;
    sendBtn.disabled = false;
    userInput.disabled = false;
    userInput.focus();
    
  } catch (error) {
    console.error('Error executing plan:', error);
    
    // Update overall status
    const planStatus = planContainer.querySelector('.plan-status');
    planStatus.textContent = 'Failed at step ' + (failedStepIndex + 1);
    planStatus.style.color = '#f44336';
    
    updateStatus('Plan failed at step ' + (failedStepIndex + 1), 'error');
    
    // Show retry button if retries remaining (max 2 retries)
    if (retryCount < 2) {
      const stepsContainer = planContainer.querySelector('.plan-steps');
      const retryBtn = document.createElement('button');
      retryBtn.className = 'plan-btn plan-btn-retry';
      retryBtn.style.background = '#FF9800';
      retryBtn.style.color = 'white';
      retryBtn.style.marginTop = '10px';
      retryBtn.innerHTML = `🔄 Retry Step ${failedStepIndex + 1} (${2 - retryCount} attempts left)`;
      retryBtn.onclick = () => {
        retryCount++;
        // Remove buttons after clicking
        retryBtn.remove();
        const continueBtn = stepsContainer.querySelector('.plan-btn-continue');
        if (continueBtn) continueBtn.remove();
        handlePlanApproval(planContainer, true, failedStepIndex);
      };
      stepsContainer.appendChild(retryBtn);
      
      // Also add option to continue with next prompt
      const continueBtn = document.createElement('button');
      continueBtn.className = 'plan-btn plan-btn-continue';
      continueBtn.style.background = '#607D8B';
      continueBtn.style.color = 'white';
      continueBtn.style.marginTop = '10px';
      continueBtn.innerHTML = '💬 Give New Instructions';
      continueBtn.onclick = () => {
        // Remove buttons
        retryBtn.remove();
        continueBtn.remove();
        // Reset retry state and allow new user input
        isAwaitingApproval = false;
        isProcessing = false;
        sendBtn.disabled = false;
        userInput.disabled = false;
        userInput.focus();
      };
      stepsContainer.appendChild(continueBtn);
    } else {
      // Max retries exceeded
      const stepsContainer = planContainer.querySelector('.plan-steps');
      const maxRetriesMsg = document.createElement('div');
      maxRetriesMsg.style.color = '#f44336';
      maxRetriesMsg.style.marginTop = '10px';
      maxRetriesMsg.style.padding = '10px';
      maxRetriesMsg.style.background = '#ffebee';
      maxRetriesMsg.style.borderRadius = '4px';
      maxRetriesMsg.innerHTML = '❌ Maximum retry attempts reached. Please provide new instructions.';
      stepsContainer.appendChild(maxRetriesMsg);
      
      // Allow new user input
      isAwaitingApproval = false;
      isProcessing = false;
      sendBtn.disabled = false;
      userInput.disabled = false;
      userInput.focus();
      
      // Reset retry state for next plan
      retryCount = 0;
      failedStepIndex = -1;
      executionHistory = [];
    }
    
    // Don't re-enable approval buttons - force user to retry or give new instructions
  }
}

async function handlePlanRejection(planContainer) {
  // Disable buttons
  const buttons = planContainer.querySelectorAll('.plan-btn');
  buttons.forEach(btn => btn.disabled = true);
  
  rejectionCount++;
  
  if (rejectionCount === 1) {
    // Add cosmetic bot message (not included in conversation history)
    const cosmeticMessageDiv = document.createElement('div');
    cosmeticMessageDiv.className = 'message assistant-message';
    cosmeticMessageDiv.style.opacity = '0.9';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = marked.parse("I understand the plan wasn't quite right. Could you let me know what I should do differently? I'll create a better plan based on your feedback.");
    
    cosmeticMessageDiv.appendChild(contentDiv);
    chatContainer.appendChild(cosmeticMessageDiv);
    scrollToBottom();
    // NOTE: This message is NOT added to conversationHistory - purely cosmetic
    
    // Re-enable input for correction
    isAwaitingApproval = false;
    isProcessing = false;
    sendBtn.disabled = false;
    userInput.disabled = false;
    userInput.placeholder = 'Tell me what to change...';
    userInput.focus();
    
    // Override send handler temporarily for correction
    const originalHandler = sendBtn.onclick;
    sendBtn.onclick = async () => {
      sendBtn.onclick = originalHandler;
      userInput.placeholder = 'Ask me anything about this page...';
      await handleSendMessage(true);
    };
    
  } else {
    // Second rejection: start fresh
    updateStatus('Plan rejected. Starting fresh...', 'success');
    
    isAwaitingApproval = false;
    rejectionCount = 0;
    currentPlan = null;
    lastPromptData = null;
    
    isProcessing = false;
    sendBtn.disabled = false;
    userInput.disabled = false;
    userInput.placeholder = 'Ask me anything about this page...';
    userInput.focus();
  }
}

// Execute a step using the executor LLM
async function executeStep(stepDescription, stepIndex, executionHistory) {
  console.log(`Executing step ${stepIndex + 1}:`, stepDescription);
  
  // Build context from previous executions
  let contextPrompt = 'Previous step outputs:\n';
  executionHistory.forEach((exec, i) => {
    contextPrompt += `Step ${i + 1}: ${exec.description}\n`;
    contextPrompt += `  Tool: ${exec.tool}\n`;
    contextPrompt += `  Inputs: ${JSON.stringify(exec.inputs)}\n`;
    
    // For schema outputs, show ALL elements (since we filtered to only meaningful ones)
    let outputsStr = JSON.stringify(exec.outputs);
    if (exec.tool === 'getSchema' && exec.outputs.schema && Array.isArray(exec.outputs.schema)) {
      // Show full schema - it's already filtered to ~100-150 meaningful elements
      outputsStr = JSON.stringify(exec.outputs);
    } else if (outputsStr.length > 2000) {
      outputsStr = outputsStr.substring(0, 2000) + '...[truncated]';
    }
    
    contextPrompt += `  Outputs: ${outputsStr}\n\n`;
  });
  
  if (executionHistory.length === 0) {
    contextPrompt = 'This is the first step (no previous outputs available).\n\n';
  }
  
  // Build compact tool list
  const toolsList = AVAILABLE_TOOLS.map(tool => 
    `${tool.name}(${tool.inputs.join(', ')})`
  ).join(', ');
  
  // Build executor prompt
  const executorPrompt = `You are a tool executor for browser automation. Your job is to translate a step description into a tool call.

Tools: ${toolsList}

OUTPUT FORMAT - Must follow exactly:
{"tool": "toolName", "inputs": {...}, "reasoning": "brief why"}

CRITICAL Rules for Finding Elements:
1. READ THE FULL STEP DESCRIPTION - Extract the KEY WORDS that describe the element
2. SEARCH through the schema for an element where label contains those key words
3. Use PARTIAL STRING MATCHING - "fullscreen button" matches label "Full screen keyboard shortcut f"
4. Match logic:
   - Step: "Click the fullscreen button" → Extract: "fullscreen" → Find: label contains "Full screen"
   - Step: "Click the video (Rick Astley...)" → Extract: "Rick Astley" → Find: label contains "Rick Astley"
   - Step: "Type into search input" → Extract: "search" → Find: role="combobox" AND label contains "Search"
5. ALWAYS search for partial matches in labels - don't require exact match
6. For click/type/select: MUST use a11yId from PREVIOUS getSchema output
7. NEVER guess a11yId values - scan through the FULL schema array to find the element with matching keywords
8. Use manageTabs for NEW tabs, navigate for URLs in current tab

Examples:
{"tool": "manageTabs", "inputs": {"action": "open", "url": "https://youtube.com"}, "reasoning": "Open new tab"}
{"tool": "getSchema", "inputs": {"selector": ""}, "reasoning": "Get page elements"}
{"tool": "click", "inputs": {"a11yId": 18}, "reasoning": "Click fullscreen - found id 18 with label containing 'Full screen'"}
{"tool": "type", "inputs": {"a11yId": 3, "text": "hello"}, "reasoning": "Type in search - found id 3 with label containing 'search'"}
{"tool": "waitFor", "inputs": {"waitType": "navigation", "timeout": 5000}, "reasoning": "Wait for page load"}

Respond only with valid JSON.

${contextPrompt}
Step: ${stepDescription}

Translate this step to a tool call. Output JSON only.`;

  try {
    // Call executor model (llama3.1:8b)
    const response = await chrome.runtime.sendMessage({
      action: 'executeWithModel',
      model: EXECUTOR_MODEL,
      prompt: executorPrompt
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Executor failed');
    }
    
    // Strip markdown code blocks and any preamble text
    let cleanResult = response.result.trim();
    
    // Remove markdown code blocks if present
    if (cleanResult.startsWith('```')) {
      cleanResult = cleanResult.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    
    // Remove any preamble text before the JSON (e.g., "Here is the...", "Sure...")
    const jsonStart = cleanResult.indexOf('{');
    if (jsonStart > 0) {
      console.warn('[Executor] Stripped preamble text before JSON');
      cleanResult = cleanResult.substring(jsonStart);
    }
    
    // Remove any text after the JSON
    const jsonEnd = cleanResult.lastIndexOf('}');
    if (jsonEnd > 0 && jsonEnd < cleanResult.length - 1) {
      console.warn('[Executor] Stripped text after JSON');
      cleanResult = cleanResult.substring(0, jsonEnd + 1);
    }
    
    const execution = JSON.parse(cleanResult);
    console.log('Executor decision:', execution);
    
    // Execute the actual tool
    const toolOutput = await executeToolCall(execution.tool, execution.inputs);
    
    return {
      description: stepDescription,
      tool: execution.tool,
      inputs: execution.inputs,
      outputs: toolOutput,
      reasoning: execution.reasoning
    };
    
  } catch (error) {
    console.error('Error in step execution:', error);
    throw error;
  }
}

// Actually execute the tool and return outputs
async function executeToolCall(toolName, inputs) {
  console.log(`[TOOL EXECUTION START] ${toolName}`, inputs);
  const startTime = Date.now();
  
  try {
    let result;
    
    switch (toolName) {
      case 'click':
        console.log(`[TOOL:click] Attempting to click element: a11yId=${inputs.a11yId} or selector=${inputs.selector}, type: ${inputs.clickType || 'single'}`);
        result = await chrome.runtime.sendMessage({
          action: 'executeClick',
          a11yId: inputs.a11yId,
          selector: inputs.selector,
          clickType: inputs.clickType || 'single'
        });
        console.log(`[TOOL:click] Result:`, result);
        if (!result.success) {
          console.error(`[TOOL:click] FAILED: ${result.error}`);
          throw new Error(result.error || 'Click action failed');
        }
        return result;
        
      case 'type':
        console.log(`[TOOL:type] Typing into element: a11yId=${inputs.a11yId} or selector=${inputs.selector}, text: ${inputs.text}`);
        result = await chrome.runtime.sendMessage({
          action: 'executeType',
          a11yId: inputs.a11yId,
          selector: inputs.selector,
          text: inputs.text,
          mode: inputs.mode || 'replace',
          submit: inputs.submit || false
        });
        console.log(`[TOOL:type] Result:`, result);
        if (!result.success) {
          console.error(`[TOOL:type] FAILED: ${result.error}`);
          throw new Error(result.error || 'Type action failed');
        }
        return result;
        
      case 'select':
        console.log(`[TOOL:select] Selecting from dropdown: ${inputs.selector}, option: ${inputs.option}, by: ${inputs.by || 'value'}`);
        result = await chrome.runtime.sendMessage({
          action: 'executeSelect',
          selector: inputs.selector,
          option: inputs.option,
          by: inputs.by || 'value'
        });
        console.log(`[TOOL:select] Result:`, result);
        if (!result.success) {
          console.error(`[TOOL:select] FAILED: ${result.error}`);
          throw new Error(result.error || 'Select action failed');
        }
        return result;
        
      case 'pressKey':
        console.log(`[TOOL:pressKey] Pressing key: ${inputs.key}, target: ${inputs.selector || 'page'}`);
        result = await chrome.runtime.sendMessage({
          action: 'executePressKey',
          key: inputs.key,
          selector: inputs.selector || null
        });
        console.log(`[TOOL:pressKey] Result:`, result);
        if (!result.success) {
          console.error(`[TOOL:pressKey] FAILED: ${result.error}`);
          throw new Error(result.error || 'Press key action failed');
        }
        return result;
        
      case 'scroll':
        console.log(`[TOOL:scroll] Scrolling - target: ${inputs.target || 'page'}, direction: ${inputs.direction}, amount: ${inputs.amount || 'auto'}`);
        result = await chrome.runtime.sendMessage({
          action: 'executeScroll',
          target: inputs.target || null,
          direction: inputs.direction,
          amount: inputs.amount || null
        });
        console.log(`[TOOL:scroll] Result:`, result);
        if (!result.success) {
          console.error(`[TOOL:scroll] FAILED: ${result.error}`);
          throw new Error(result.error || 'Scroll action failed');
        }
        return result;
        
      case 'navigate':
        console.log(`[TOOL:navigate] Navigation action: ${inputs.action}, url: ${inputs.url || 'N/A'}`);
        result = await chrome.runtime.sendMessage({
          action: 'executeNavigate',
          navAction: inputs.action,
          url: inputs.url || null
        });
        console.log(`[TOOL:navigate] Result:`, result);
        if (!result.success) {
          console.error(`[TOOL:navigate] FAILED: ${result.error}`);
          throw new Error(result.error || 'Navigation action failed');
        }
        return result;
        
      case 'manageTabs':
        console.log(`[TOOL:manageTabs] Tab action: ${inputs.action}, tabId: ${inputs.tabId || 'N/A'}, url: ${inputs.url || 'N/A'}`);
        result = await chrome.runtime.sendMessage({
          action: 'executeManageTabs',
          tabAction: inputs.action,
          tabId: inputs.tabId || null,
          url: inputs.url || null
        });
        console.log(`[TOOL:manageTabs] Result:`, result);
        if (!result.success) {
          console.error(`[TOOL:manageTabs] FAILED: ${result.error}`);
          throw new Error(result.error || 'Tab management action failed');
        }
        return result;
        
      case 'waitFor':
        console.log(`[TOOL:waitFor] Wait type: ${inputs.waitType}, selector: ${inputs.selector || 'N/A'}, timeout: ${inputs.timeout || 5000}ms`);
        result = await chrome.runtime.sendMessage({
          action: 'executeWaitFor',
          waitType: inputs.waitType,
          selector: inputs.selector || null,
          timeout: inputs.timeout || 5000
        });
        console.log(`[TOOL:waitFor] Result:`, result);
        if (!result.success) {
          console.error(`[TOOL:waitFor] FAILED: ${result.error}`);
          throw new Error(result.error || 'Wait action failed');
        }
        return result;
        
      case 'getSchema':
        console.log(`[TOOL:getSchema] Getting page schema - selector: ${inputs.selector || 'full page'}`);
        result = await chrome.runtime.sendMessage({
          action: 'getPageSchema',
          selector: inputs.selector || null
        });
        
        if (result.error) {
          console.error(`[TOOL:getSchema] FAILED: ${result.error}`);
          throw new Error(result.error);
        }
        
        console.log(`[TOOL:getSchema] Success - Schema length: ${result.schema?.length || 0} characters`);
        console.log(`[TOOL:getSchema] FULL SCHEMA:`, result.schema);
        return { 
          success: true, 
          schema: result.schema,
          description: inputs.selector ? `Schema of element: ${inputs.selector}` : 'Full page schema'
        };
        
      case 'getHTML':
        if (!inputs.selector) {
          throw new Error('getHTML requires a selector. Use getSchema first to find elements, then use getHTML with the specific selector.');
        }
        console.log(`[TOOL:getHTML] Getting HTML - selector: ${inputs.selector}`);
        result = await chrome.runtime.sendMessage({
          action: 'getHTMLContent',
          selector: inputs.selector
        });
        
        if (result.error) {
          console.error(`[TOOL:getHTML] FAILED: ${result.error}`);
          throw new Error(result.error);
        }
        
        console.log(`[TOOL:getHTML] Success - HTML length: ${result.html?.length || 0} characters`);
        return { 
          success: true, 
          html: result.html,
          description: `HTML of element: ${inputs.selector}`
        };
        
      default:
        const errorMsg = `Unknown tool: ${toolName}`;
        console.error(`[TOOL EXECUTION] ${errorMsg}`);
        throw new Error(errorMsg);
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[TOOL EXECUTION FAILED] ${toolName} after ${duration}ms:`, error);
    console.error(`[TOOL EXECUTION FAILED] Error details:`, error.message, error.stack);
    throw error;
  } finally {
    const duration = Date.now() - startTime;
    console.log(`[TOOL EXECUTION END] ${toolName} completed in ${duration}ms`);
  }
}

async function streamOllamaResponse(prompt, imageBase64) {
  // Reset stop flag
  stopGenerationRequested = false;
  
  // Create thinking section for debugging
  const thinkingSection = document.createElement('div');
  thinkingSection.className = 'thinking-section';
  thinkingSection.style.display = 'none';
  
  const thinkingHeader = document.createElement('div');
  thinkingHeader.className = 'thinking-header';
  thinkingHeader.innerHTML = `
    <span class="thinking-toggle expanded">▶</span>
    <span class="thinking-label">Reasoning...</span>
    <div class="thinking-spinner"></div>
  `;
  
  const thinkingContent = document.createElement('div');
  thinkingContent.className = 'thinking-content expanded';
  
  thinkingSection.appendChild(thinkingHeader);
  thinkingSection.appendChild(thinkingContent);

  let fullResponse = '';
  let thinkingText = '';
  let isThinking = false;
  let thinkingSectionCreated = false;
  let firstChunkReceived = false;

  return new Promise((resolve, reject) => {
    // Create a long-lived connection for streaming
    const port = chrome.runtime.connect({ name: 'ollama-stream' });
    activeStreamPort = port;
    
    port.onMessage.addListener((message) => {
      // Check if stop was requested
      if (stopGenerationRequested) {
        port.disconnect();
        activeStreamPort = null;
        if (thinkingSectionCreated) {
          thinkingSection.remove();
        }
        reject(new Error('Generation stopped by user'));
        return;
      }
      
      if (message.action === 'ollamaChunk') {
        // Remove thinking loader on first chunk
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          removeCenteredLoader();
        }
        
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
                if (!thinkingSectionCreated) {
                  chatContainer.appendChild(thinkingSection);
                  thinkingSectionCreated = true;
                }
              }
              thinkingText += thinkingChunk;
              // Render markdown in thinking content
              thinkingContent.innerHTML = marked.parse(thinkingText);
            }
            
            // Check for regular content (JSON response)
            const contentChunk = data.message?.content || data.response || '';
            if (contentChunk) {
              fullResponse += contentChunk;
            }
          } catch (e) {
            console.error('Error parsing JSON:', e, line);
          }
        }
      } else if (message.action === 'ollamaComplete') {
        port.disconnect();
        activeStreamPort = null;
        
        // Collapse thinking section
        if (thinkingSection.style.display !== 'none') {
          const spinner = thinkingHeader.querySelector('.thinking-spinner');
          if (spinner) spinner.remove();
          
          const label = thinkingHeader.querySelector('.thinking-label');
          if (label) label.textContent = 'View Reasoning';
          
          const toggle = thinkingHeader.querySelector('.thinking-toggle');
          if (toggle) toggle.classList.remove('expanded');
          thinkingContent.classList.remove('expanded');
          
          // Make it collapsible
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
        
        // Return the full response text for parsing
        resolve(fullResponse);
      } else if (message.action === 'ollamaError') {
        port.disconnect();
        if (thinkingSectionCreated) {
          thinkingSection.remove();
        }
        reject(new Error(message.error));
      }
    });

    port.onDisconnect.addListener(() => {
      activeStreamPort = null;
      if (chrome.runtime.lastError) {
        if (thinkingSectionCreated) {
          thinkingSection.remove();
        }
        reject(new Error('Connection lost: ' + chrome.runtime.lastError.message));
      }
    });

    // Send request to background worker
    port.postMessage({
      action: 'streamOllama',
      model: ORCHESTRATOR_MODEL,
      prompt: prompt,
      image: imageBase64
    });
  });
}



function addMessageToUI(role, content, showLoader = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}-message`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  // User messages as text, assistant messages as markdown
  if (role === 'user') {
    contentDiv.textContent = content;
    
    // Add loader if requested
    if (showLoader) {
      const loaderDiv = document.createElement('div');
      loaderDiv.className = 'loader-container';
      loaderDiv.innerHTML = `
        <div class="loader-spinner"></div>
        <span>Thinking...</span>
      `;
      contentDiv.appendChild(loaderDiv);
    }
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
  
  return messageDiv;
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

function showCenteredLoader(message) {
  const loader = document.createElement('div');
  loader.className = 'centered-loader';
  loader.innerHTML = `
    <div class="loader-spinner"></div>
    <div class="loader-text">${message}</div>
  `;
  chatContainer.appendChild(loader);
  scrollToBottom();
  return loader;
}

function removeCenteredLoader() {
  const loaders = chatContainer.querySelectorAll('.centered-loader');
  loaders.forEach(loader => loader.remove());
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
