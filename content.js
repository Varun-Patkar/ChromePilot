// Content script to extract simplified HTML from the current page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageContent') {
    const html = extractVisibleHTML();
    sendResponse({ html: html });
  }
  return true;
});

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
