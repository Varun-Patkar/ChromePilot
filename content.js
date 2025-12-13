// Content script for browser automation tools
// Global store for accessibility tree elements (maps ID to actual DOM element)
let a11yTreeElements = {};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[CONTENT] Received action:', request.action, request);
  
  try {
    if (request.action === 'getPageContent') {
      const html = extractVisibleHTML();
      sendResponse({ html: html });
      
    } else if (request.action === 'getElementHTML') {
      const selector = request.selector;
      const element = document.querySelector(selector);
      if (!element) {
        console.error(`[CONTENT:getElementHTML] Element not found: ${selector}`);
        sendResponse({ error: `Element not found: ${selector}`, html: '' });
      } else {
        // Clone element to strip styling without modifying original
        const clone = element.cloneNode(true);
        
        // Remove style attributes and style tags
        function stripStyling(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            node.removeAttribute('style');
            node.removeAttribute('class'); // Remove classes as they reference external CSS
            
            // Recursively strip from children
            for (const child of node.children) {
              stripStyling(child);
            }
            
            // Remove style tags
            const styleTags = node.querySelectorAll('style');
            styleTags.forEach(tag => tag.remove());
          }
        }
        
        stripStyling(clone);
        const html = clone.outerHTML;
        console.log(`[CONTENT:getElementHTML] Success, clean HTML length: ${html.length}`);
        sendResponse({ html: html, success: true });
      }
      
    } else if (request.action === 'getPageSchema') {
      // Extract accessibility tree instead of DOM schema
      const tree = extractAccessibilityTree();
      
      // Store elements globally for later reference by ID
      a11yTreeElements = {};
      tree.forEach(node => {
        a11yTreeElements[node.id] = node._element;
      });
      
      // Remove _element from response (don't send DOM object to LLM)
      const treeForLLM = tree.map(node => {
        const { _element, ...rest } = node;
        return rest;
      });
      
      console.log(`[CONTENT:getPageSchema] Accessibility tree with ${tree.length} interactive elements`);
      console.log(`[CONTENT:getPageSchema] FULL TREE:`, treeForLLM);
      sendResponse({ schema: treeForLLM, success: true });
      
    } else if (request.action === 'clickElement') {
      handleClick(request, sendResponse);
      
    } else if (request.action === 'typeText') {
      handleType(request, sendResponse);
      
    } else if (request.action === 'selectOption') {
      handleSelect(request, sendResponse);
      
    } else if (request.action === 'pressKey') {
      handlePressKey(request, sendResponse);
      
    } else if (request.action === 'scrollPage') {
      handleScroll(request, sendResponse);
      
    } else if (request.action === 'waitFor') {
      handleWaitFor(request, sendResponse);
      return true; // Keep channel open for async
    }
  } catch (error) {
    console.error('[CONTENT] Error handling action:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true;
});

// 1. Click Handler
function handleClick(request, sendResponse) {
  console.log('[CONTENT:click] Starting click', request);
  try {
    // Support both accessibility tree IDs and CSS selectors
    let element;
    
    if (request.a11yId) {
      // Try data-agent-id attribute first (most reliable)
      element = document.querySelector(`[data-agent-id="${request.a11yId}"]`);
      
      // Fallback to stored element map
      if (!element) {
        element = a11yTreeElements[request.a11yId];
      }
      
      if (!element) {
        throw new Error(`Accessibility element not found: ID ${request.a11yId}`);
      }
    } else if (request.selector) {
      // Fallback to CSS selector
      element = document.querySelector(request.selector);
      if (!element) {
        throw new Error(`Element not found: ${request.selector}`);
      }
    } else {
      throw new Error('Neither a11yId nor selector provided');
    }
    
    console.log('[CONTENT:click] Element found:', element.tagName, element.getAttribute('data-agent-id'));
    
    // Scroll element into view first
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    const clickType = request.clickType || 'single';
    if (clickType === 'double') {
      element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    } else if (clickType === 'right') {
      element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
    } else {
      element.click();
    }
    
    const elementText = element.textContent?.trim() || element.value || '';
    const elementDesc = `${element.tagName}${element.id ? '#' + element.id : ''}${element.className ? '.' + element.className.split(' ')[0] : ''}`;
    
    console.log('[CONTENT:click] Click successful');
    sendResponse({ 
      success: true, 
      elementText: elementText.substring(0, 100),
      elementClicked: elementDesc
    });
  } catch (error) {
    console.error('[CONTENT:click] Error:', error);
    sendResponse({ success: false, error: error.message, elementText: '', elementClicked: '' });
  }
}

// 2. Type Handler
function handleType(request, sendResponse) {
  console.log('[CONTENT:type] Starting type', request);
  try {
    // Support both accessibility tree IDs and CSS selectors
    let element;
    
    if (request.a11yId) {
      // Try data-agent-id attribute first (most reliable)
      element = document.querySelector(`[data-agent-id="${request.a11yId}"]`);
      
      // Fallback to stored element map
      if (!element) {
        element = a11yTreeElements[request.a11yId];
      }
      
      if (!element) {
        throw new Error(`Accessibility element not found: ID ${request.a11yId}`);
      }
    } else if (request.selector) {
      element = document.querySelector(request.selector);
      if (!element) {
        throw new Error(`Element not found: ${request.selector}`);
      }
    } else {
      throw new Error('Neither a11yId nor selector provided');
    }
    
    console.log('[CONTENT:type] Element found:', element.tagName, element.type);
    
    // Focus the element
    element.focus();
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    const mode = request.mode || 'replace';
    
    if (mode === 'replace') {
      element.value = '';
      element.textContent = '';
    }
    
    // Type the text
    element.value = (mode === 'append' ? element.value : '') + request.text;
    
    // Trigger input events
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Submit if requested
    if (request.submit) {
      console.log('[CONTENT:type] Pressing Enter');
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
    
    console.log('[CONTENT:type] Type successful, final value:', element.value);
    sendResponse({ success: true, finalValue: element.value });
  } catch (error) {
    console.error('[CONTENT:type] Error:', error);
    sendResponse({ success: false, error: error.message, finalValue: '' });
  }
}

// 3. Select Handler
function handleSelect(request, sendResponse) {
  console.log('[CONTENT:select] Starting select', request);
  try {
    const element = document.querySelector(request.selector);
    if (!element) {
      throw new Error(`Element not found: ${request.selector}`);
    }
    
    if (element.tagName !== 'SELECT') {
      throw new Error(`Element is not a SELECT dropdown: ${element.tagName}`);
    }
    
    console.log('[CONTENT:select] Select element found with', element.options.length, 'options');
    
    const by = request.by || 'value';
    let optionFound = false;
    
    for (let i = 0; i < element.options.length; i++) {
      const option = element.options[i];
      if (by === 'index' && i === parseInt(request.option)) {
        element.selectedIndex = i;
        optionFound = true;
        break;
      } else if (by === 'text' && option.text === request.option) {
        element.selectedIndex = i;
        optionFound = true;
        break;
      } else if (by === 'value' && option.value === request.option) {
        element.selectedIndex = i;
        optionFound = true;
        break;
      }
    }
    
    if (!optionFound) {
      throw new Error(`Option not found: ${request.option} (by: ${by})`);
    }
    
    // Trigger change event
    element.dispatchEvent(new Event('change', { bubbles: true }));
    
    const selectedOption = element.options[element.selectedIndex];
    console.log('[CONTENT:select] Selected:', selectedOption.text, '=', selectedOption.value);
    
    sendResponse({ 
      success: true, 
      selectedValue: selectedOption.value,
      selectedText: selectedOption.text
    });
  } catch (error) {
    console.error('[CONTENT:select] Error:', error);
    sendResponse({ success: false, error: error.message, selectedValue: '', selectedText: '' });
  }
}

// 4. Press Key Handler
function handlePressKey(request, sendResponse) {
  console.log('[CONTENT:pressKey] Starting pressKey', request);
  try {
    let targetElement = document.activeElement;
    
    if (request.selector) {
      const element = document.querySelector(request.selector);
      if (!element) {
        throw new Error(`Element not found: ${request.selector}`);
      }
      element.focus();
      targetElement = element;
    }
    
    console.log('[CONTENT:pressKey] Target element:', targetElement.tagName);
    
    const key = request.key;
    const keyEvent = {
      bubbles: true,
      cancelable: true,
      view: window
    };
    
    // Handle special keys and shortcuts
    if (key.includes('+')) {
      // Keyboard shortcut like Ctrl+A, Ctrl+F
      const parts = key.split('+');
      const modifier = parts[0].toLowerCase();
      const mainKey = parts[1];
      
      if (modifier === 'ctrl' || modifier === 'control') {
        keyEvent.ctrlKey = true;
      } else if (modifier === 'alt') {
        keyEvent.altKey = true;
      } else if (modifier === 'shift') {
        keyEvent.shiftKey = true;
      } else if (modifier === 'meta' || modifier === 'cmd') {
        keyEvent.metaKey = true;
      }
      
      keyEvent.key = mainKey;
    } else {
      keyEvent.key = key;
    }
    
    console.log('[CONTENT:pressKey] Dispatching key:', keyEvent.key);
    
    targetElement.dispatchEvent(new KeyboardEvent('keydown', keyEvent));
    targetElement.dispatchEvent(new KeyboardEvent('keypress', keyEvent));
    targetElement.dispatchEvent(new KeyboardEvent('keyup', keyEvent));
    
    console.log('[CONTENT:pressKey] Key press successful');
    sendResponse({ success: true, keyPressed: key });
  } catch (error) {
    console.error('[CONTENT:pressKey] Error:', error);
    sendResponse({ success: false, error: error.message, keyPressed: '' });
  }
}

// 5. Scroll Handler
function handleScroll(request, sendResponse) {
  console.log('[CONTENT:scroll] Starting scroll', request);
  try {
    const direction = request.direction;
    const amount = request.amount || 500;
    
    if (request.target) {
      // Scroll specific element
      const element = document.querySelector(request.target);
      if (!element) {
        throw new Error(`Element not found: ${request.target}`);
      }
      
      console.log('[CONTENT:scroll] Scrolling element:', element.tagName);
      
      if (direction === 'top') {
        element.scrollTop = 0;
      } else if (direction === 'bottom') {
        element.scrollTop = element.scrollHeight;
      } else if (direction === 'up') {
        element.scrollTop -= amount;
      } else if (direction === 'down') {
        element.scrollTop += amount;
      } else if (direction === 'toElement') {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      sendResponse({ success: true, scrollPosition: element.scrollTop });
      
    } else {
      // Scroll page
      console.log('[CONTENT:scroll] Scrolling page');
      
      if (direction === 'top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (direction === 'bottom') {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      } else if (direction === 'up') {
        window.scrollBy({ top: -amount, behavior: 'smooth' });
      } else if (direction === 'down') {
        window.scrollBy({ top: amount, behavior: 'smooth' });
      }
      
      sendResponse({ success: true, scrollPosition: window.scrollY });
    }
    
    console.log('[CONTENT:scroll] Scroll successful');
  } catch (error) {
    console.error('[CONTENT:scroll] Error:', error);
    sendResponse({ success: false, error: error.message, scrollPosition: 0 });
  }
}

// 6. Wait For Handler
async function handleWaitFor(request, sendResponse) {
  console.log('[CONTENT:waitFor] Starting waitFor', request);
  const startTime = Date.now();
  const timeout = request.timeout || 5000;
  const waitType = request.waitType;
  
  try {
    if (waitType === 'element') {
      const selector = request.selector;
      if (!selector) {
        throw new Error('Selector required for element wait type');
      }
      
      console.log('[CONTENT:waitFor] Waiting for element:', selector);
      
      // Poll for element
      const checkElement = () => {
        const element = document.querySelector(selector);
        if (element) {
          const timeWaited = Date.now() - startTime;
          console.log('[CONTENT:waitFor] Element found after', timeWaited, 'ms');
          sendResponse({ success: true, elementFound: true, timeWaited });
          return true;
        }
        return false;
      };
      
      if (checkElement()) return;
      
      const interval = setInterval(() => {
        if (checkElement()) {
          clearInterval(interval);
        } else if (Date.now() - startTime >= timeout) {
          clearInterval(interval);
          console.error('[CONTENT:waitFor] Timeout waiting for element');
          sendResponse({ success: false, error: 'Timeout waiting for element', elementFound: false, timeWaited: timeout });
        }
      }, 100);
      
    } else if (waitType === 'navigation') {
      console.log('[CONTENT:waitFor] Waiting for navigation');
      // Wait for document ready state
      if (document.readyState === 'complete') {
        sendResponse({ success: true, elementFound: true, timeWaited: 0 });
      } else {
        document.addEventListener('readystatechange', () => {
          if (document.readyState === 'complete') {
            const timeWaited = Date.now() - startTime;
            console.log('[CONTENT:waitFor] Navigation complete after', timeWaited, 'ms');
            sendResponse({ success: true, elementFound: true, timeWaited });
          }
        });
        
        setTimeout(() => {
          console.error('[CONTENT:waitFor] Timeout waiting for navigation');
          sendResponse({ success: false, error: 'Timeout waiting for navigation', elementFound: false, timeWaited: timeout });
        }, timeout);
      }
      
    } else if (waitType === 'networkIdle') {
      console.log('[CONTENT:waitFor] Waiting for network idle');
      // Simple implementation: wait fixed time
      setTimeout(() => {
        const timeWaited = Date.now() - startTime;
        console.log('[CONTENT:waitFor] Network idle after', timeWaited, 'ms');
        sendResponse({ success: true, elementFound: true, timeWaited });
      }, 1000);
      
    } else {
      throw new Error(`Unknown wait type: ${waitType}`);
    }
    
  } catch (error) {
    console.error('[CONTENT:waitFor] Error:', error);
    sendResponse({ success: false, error: error.message, elementFound: false, timeWaited: 0 });
  }
}

function extractVisibleHTML() {
  // Get all visible elements
  const visibleElements = getVisibleElements(document.body);
  
  // Build simplified HTML
  const simplifiedHTML = buildSimplifiedHTML(visibleElements);
  
  return simplifiedHTML;
}

function isElementVisible(element) {
  // Check if element is visible on screen
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

  // Check if element is in viewport
  return (
    rect.top < viewportHeight &&
    rect.bottom > 0 &&
    rect.left < viewportWidth &&
    rect.right > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function getVisibleElements(root) {
  const visibleElements = [];
  const importantTags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SPAN', 'DIV', 'LABEL', 'FORM', 'NAV', 'HEADER', 'FOOTER', 'MAIN', 'SECTION', 'ARTICLE'];

  function traverse(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    // Skip script, style, noscript, and svg elements
    const tagName = node.tagName.toUpperCase();
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'IFRAME'].includes(tagName)) {
      return;
    }

    // Check if element is displayed (not hidden by CSS)
    const style = window.getComputedStyle(node);
    const isDisplayed = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';

    // Include all displayed elements, regardless of viewport position
    if (isDisplayed) {
      // Include important interactive or structural elements
      if (importantTags.includes(tagName) || node.hasAttribute('role') || node.hasAttribute('data-testid')) {
        visibleElements.push(node);
      }
    }

    // Traverse children
    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(root);
  return visibleElements;
}

function buildSimplifiedHTML(elements) {
  const simplified = [];
  
  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();
    const attributes = [];

    // Include only relevant attributes
    if (element.id) attributes.push(`id="${element.id}"`);
    if (element.className) attributes.push(`class="${element.className}"`);
    if (element.type) attributes.push(`type="${element.type}"`);
    if (element.name) attributes.push(`name="${element.name}"`);
    if (element.placeholder) attributes.push(`placeholder="${element.placeholder}"`);
    if (element.href) attributes.push(`href="${element.href}"`);
    if (element.src) attributes.push(`src="${element.src.substring(0, 100)}"`); // Truncate long URLs
    if (element.alt) attributes.push(`alt="${element.alt}"`);
    if (element.value) attributes.push(`value="${element.value}"`);
    if (element.getAttribute('role')) attributes.push(`role="${element.getAttribute('role')}"`);
    if (element.getAttribute('aria-label')) attributes.push(`aria-label="${element.getAttribute('aria-label')}"`);
    if (element.getAttribute('data-testid')) attributes.push(`data-testid="${element.getAttribute('data-testid')}"`);

    // Get text content (limited)
    let textContent = '';
    if (['INPUT', 'TEXTAREA', 'IMG', 'BR', 'HR'].indexOf(tagName.toUpperCase()) === -1) {
      // Get direct text content only (not from children)
      textContent = Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim())
        .join(' ')
        .substring(0, 150); // Limit text content
    }

    // Build element string
    const attrString = attributes.length > 0 ? ' ' + attributes.join(' ') : '';
    if (['INPUT', 'IMG', 'BR', 'HR'].indexOf(tagName.toUpperCase()) !== -1) {
      simplified.push(`<${tagName}${attrString}/>`);
    } else if (textContent) {
      simplified.push(`<${tagName}${attrString}>${textContent}</${tagName}>`);
    } else {
      simplified.push(`<${tagName}${attrString}></${tagName}>`);
    }
  }

  // Limit total size
  let result = simplified.join('\n');
  const maxLength = 20000; // Keep HTML under 20K characters (increased to capture more off-screen content)
  if (result.length > maxLength) {
    result = result.substring(0, maxLength) + '\n<!-- HTML truncated -->';
  }

  return result;
}

// ===== ACCESSIBILITY TREE EXTRACTION =====
// Extract semantic accessibility tree instead of relying on DOM selectors
// This works with obfuscated/framework-generated code

function computeRole(el) {
  // explicit ARIA role
  if (el.getAttribute("role")) return el.getAttribute("role");

  const tag = el.tagName.toLowerCase();

  // semantic tags
  const tagRoleMap = {
    "button": "button",
    "a": "link",
    "input": "textbox",
    "textarea": "textbox",
    "select": "combobox",
    "img": "img"
  };

  if (tagRoleMap[tag]) return tagRoleMap[tag];

  // input types
  if (tag === "input") {
    const t = el.type;
    if (t === "search") return "searchbox";
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    return "textbox";
  }

  return null;
}

function computeAccessibleName(el) {
  // aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  // aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.innerText.trim();
  }

  // <label for="">
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) return label.innerText.trim();
  }

  // placeholder for inputs
  const placeholder = el.getAttribute("placeholder");
  if (placeholder) return placeholder.trim();

  // title attribute
  const title = el.getAttribute("title");
  if (title) return title.trim();

  // name attribute for inputs (fallback)
  const name = el.getAttribute("name");
  if (name && el.tagName.toLowerCase() === 'input') {
    return name.trim();
  }

  // text content for buttons/links
  const role = computeRole(el);
  if (role === "button" || role === "link") {
    const t = el.innerText.trim();
    if (t) return t;
  }

  return null;
}

function computeBounds(el) {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function isInteractive(el) {
  const tag = el.tagName.toLowerCase();

  // Core interactive elements
  if (["button", "a", "input", "textarea", "select"].includes(tag)) return true;
  
  // Elements with ARIA roles
  if (el.getAttribute("role")) return true;
  
  // Elements with click handlers (divs/spans with onclick)
  if (el.onclick || el.getAttribute("onclick")) return true;
  
  // Focusable elements
  if (el.tabIndex >= 0) return true;

  return false;
}

function extractAccessibilityTree() {
  // First, clear any existing data-agent-id attributes
  document.querySelectorAll('[data-agent-id]').forEach(el => {
    el.removeAttribute('data-agent-id');
  });
  
  const elements = Array.from(document.querySelectorAll("*"));
  const nodes = [];
  let idCounter = 1;

  for (const el of elements) {
    if (!isInteractive(el)) continue;

    const role = computeRole(el);
    const name = computeAccessibleName(el);
    const bounds = computeBounds(el);
    
    // Only include if it has a role and is visible
    if (!role || (bounds.width === 0 || bounds.height === 0)) continue;

    // Get text content (for buttons/links)
    let textContent = null;
    if (role === 'button' || role === 'link') {
      textContent = el.innerText?.trim().substring(0, 50) || null;
    }
    
    // CRITICAL FILTER: Skip elements with no meaningful identification
    // This reduces noise from ~387 elements to ~100-150 meaningful ones
    const label = name || textContent || null;
    const placeholder = el.placeholder || null;
    
    // Special handling for important input types - always include search boxes and text inputs
    const tag = el.tagName.toLowerCase();
    const inputType = el.type ? el.type.toLowerCase() : '';
    const isImportantInput = (tag === 'input' && ['search', 'text', 'email', 'password', 'tel', 'url'].includes(inputType)) ||
                             tag === 'textarea' ||
                             (role === 'searchbox' || role === 'textbox' || role === 'combobox');
    
    const hasIdentification = label || placeholder || isImportantInput;
    
    if (!hasIdentification) {
      // Skip elements with no label, placeholder, or text
      // These are usually decorative/structural elements (logos, icons, containers)
      continue;
    }

    const agentId = idCounter++;
    
    // Tag element with data-agent-id for reliable selection
    el.setAttribute('data-agent-id', agentId);
    
    // Simplified output format for LLM
    const node = {
      id: agentId,
      type: el.tagName.toLowerCase(),
      role: role,
      label: label,
      placeholder: placeholder
    };
    
    // Add text for buttons/links if different from label
    if (textContent && textContent !== label) {
      node.text = textContent;
    }
    
    // Add location hint (approximate position)
    if (bounds.y < 100) {
      node.location = 'top';
    } else if (bounds.y > window.innerHeight - 100) {
      node.location = 'bottom';
    }
    
    nodes.push(node);
    
    // Also store element for later reference
    a11yTreeElements[agentId] = el;
  }

  return nodes;
}

// Generate lightweight element schema/hierarchy (DEPRECATED - kept for reference)
function generateElementSchema(element, depth = 0, maxDepth = 5) {
  if (depth > maxDepth) return '';
  
  const indent = '  '.repeat(depth);
  let schema = [];
  
  // Skip script, style, noscript, svg, template, and other non-interactive elements
  const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'DEFS', 'SYMBOL', 'USE', 'TEMPLATE', 'IRON-ICONSET-SVG', 'LINK', 'IFRAME', 'META'];
  const skipClasses = ['iron-iconset', 'ytd-icon-renderer', 'yt-icon', 'svg'];
  
  function shouldSkipElement(el) {
    // Skip by tag
    if (skipTags.includes(el.tagName)) return true;
    
    // Skip elements with skip classes
    const className = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';
    if (skipClasses.some(skip => className.includes(skip))) return true;
    
    // Skip empty decorative divs (no text, no interactive children)
    if (el.tagName === 'DIV' && !el.textContent.trim() && el.children.length === 0) return true;
    
    return false;
  }
  
  function processElement(el, currentDepth) {
    if (currentDepth > maxDepth) return;
    if (shouldSkipElement(el)) return;
    
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = el.className && typeof el.className === 'string' 
      ? el.classList.length > 0 ? `.${Array.from(el.classList).slice(0, 3).join('.')}` : '' 
      : '';
    
    // Key attributes
    const attrs = [];
    if (el.name) attrs.push(`name="${el.name}"`);
    if (el.type && el.tagName === 'INPUT') attrs.push(`type="${el.type}"`);
    if (el.placeholder) attrs.push(`placeholder="${el.placeholder.substring(0, 30)}"`);
    if (el.getAttribute('role')) attrs.push(`role="${el.getAttribute('role')}"`);
    if (el.getAttribute('aria-label')) attrs.push(`aria-label="${el.getAttribute('aria-label').substring(0, 30)}"`);
    if (el.href && el.tagName === 'A') attrs.push(`href="${el.href.substring(0, 50)}"`);
    
    const attrStr = attrs.length > 0 ? ` [${attrs.join(', ')}]` : '';
    
    // Direct text content (not from children)
    let text = '';
    const directText = Array.from(el.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.trim())
      .filter(t => t.length > 0)
      .join(' ')
      .trim();
    if (directText && directText.length > 0) {
      text = ` "${directText.substring(0, 40)}${directText.length > 40 ? '...' : ''}"`;
    }
    
    const prefix = '  '.repeat(currentDepth);
    schema.push(`${prefix}<${tag}${id}${classes}${attrStr}${text}>`);
    
    // Process children
    const children = Array.from(el.children).filter(child => !skipTags.includes(child.tagName));
    if (children.length > 0 && currentDepth < maxDepth) {
      children.forEach(child => processElement(child, currentDepth + 1));
    }
  }
  
  processElement(element, depth);
  
  let result = schema.join('\n');
  
  // Limit total size
  const maxLength = 15000;
  if (result.length > maxLength) {
    result = result.substring(0, maxLength) + '\n<!-- Schema truncated -->';
  }
  
  return result;
}
