import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;

function sourceUnderTest(path) {
  if (process.env.TEST_SOURCE_REF) {
    return execFileSync('git', ['show', `${process.env.TEST_SOURCE_REF}:${path}`], { cwd: root, encoding: 'utf8' });
  }
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function loadElement(source, name, globals = {}) {
  const elements = new Map();
  class HTMLElement {}
  vm.runInNewContext(source, {
    HTMLElement,
    customElements: { get: (tag) => elements.get(tag), define: (tag, element) => elements.set(tag, element) },
    ...globals,
  });
  return elements.get(name);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
}

function makeOpener(productUrl) {
  const attributes = new Map([['data-product-url', productUrl]]);
  const classes = new Set();
  const spinnerClasses = new Set(['hidden']);
  return {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    querySelector: () => ({ classList: {
      add: (name) => spinnerClasses.add(name), remove: (name) => spinnerClasses.delete(name), contains: (name) => spinnerClasses.has(name),
    } }),
  };
}

function makeProductElement() {
  return {
    outerHTML: '<product-info></product-info>', classList: { forEach: () => {} }, dataset: { section: 'source-section' },
    innerHTML: '', attributes: [], setAttribute: () => {}, querySelector: () => null, querySelectorAll: () => [],
  };
}

function makeQuickAddHarness(source) {
  const requests = [];
  class ModalDialog {
    show(opener) { this.baseShowCalls = (this.baseShowCalls || 0) + 1; this.openedBy = opener; }
    hide() { this.baseHideCalls = (this.baseHideCalls || 0) + 1; }
  }
  const content = {
    children: [], innerHTML: 'initial', classList: { add: () => {} }, querySelector: () => null,
    replaceChildren() { this.children = []; this.innerHTML = ''; }, append(...nodes) { this.children.push(...nodes); },
  };
  let modal;
  const document = {
    querySelectorAll: (selector) => (selector === 'quick-add-modal' ? [modal] : []),
    querySelector: () => null,
    createElement: (tagName) => {
      const attributes = new Map();
      return { tagName, attributes, setAttribute: (name, value) => attributes.set(name, String(value)), textContent: '', href: '' };
    },
  };
  const QuickAddModal = loadElement(source, 'quick-add-modal', {
    AbortController, ModalDialog, document,
    DOMParser: class DOMParser { parseFromString() { return { querySelector: () => makeProductElement() }; } },
    HTMLUpdateUtility: { setInnerHTML: (destination, html) => { destination.innerHTML = html; } },
    fetch: (url, options) => { const request = deferred(); requests.push({ url, options, ...request }); return request.promise; },
    window: {},
  });
  modal = Object.create(QuickAddModal.prototype);
  modal.dataset = { errorMessage: 'Unable to load this product.', viewDetailsLabel: 'View product details' };
  modal.modalContent = content;
  return { modal, content, requests };
}

test('a stale quick-add response cannot open after a newer product request', async () => {
  const { modal, requests } = makeQuickAddHarness(sourceUnderTest('assets/quick-add.js'));
  const first = makeOpener('/products/first');
  const second = makeOpener('/products/second');
  modal.show(first);
  modal.show(second);
  requests[0].resolve({ ok: true, text: async () => '<product-info></product-info>' });
  await settle();
  assert.equal(modal.baseShowCalls || 0, 0);
  assert.equal(second.classList.contains('loading'), true);
  requests[1].resolve({ ok: true, text: async () => '<product-info></product-info>' });
  await settle();
  assert.equal(modal.baseShowCalls, 1);
  assert.equal(modal.openedBy, second);
});

test('an older request for the same opener cannot clear newer loading state', async () => {
  const { modal, requests } = makeQuickAddHarness(sourceUnderTest('assets/quick-add.js'));
  const opener = makeOpener('/products/current');
  modal.show(opener);
  modal.show(opener);
  requests[0].resolve({ ok: true, text: async () => '<product-info></product-info>' });
  await settle();
  assert.equal(opener.getAttribute('aria-disabled'), 'true');
  assert.equal(opener.classList.contains('loading'), true);
  requests[1].resolve({ ok: true, text: async () => '<product-info></product-info>' });
  await settle();
  assert.equal(opener.getAttribute('aria-disabled'), null);
  assert.equal(opener.classList.contains('loading'), false);
});

test('a quick-add fetch failure displays localized recovery content and resets its opener', async () => {
  const { modal, content, requests } = makeQuickAddHarness(sourceUnderTest('assets/quick-add.js'));
  const opener = makeOpener('/products/unavailable');
  modal.show(opener);
  requests[0].reject(new Error('Network offline'));
  await settle();
  assert.equal(modal.baseShowCalls, 1);
  assert.equal(content.children.length, 2);
  assert.equal(content.children[0].tagName, 'p');
  assert.equal(content.children[0].attributes.get('role'), 'alert');
  assert.equal(content.children[0].textContent, 'Unable to load this product.');
  assert.equal(content.children[1].href, '/products/unavailable');
  assert.equal(content.children[1].textContent, 'View product details');
  assert.equal(opener.getAttribute('aria-disabled'), null);
  assert.equal(opener.classList.contains('loading'), false);
});

test('closing a quick-add modal aborts the request and cannot reopen it', async () => {
  const { modal, content, requests } = makeQuickAddHarness(sourceUnderTest('assets/quick-add.js'));
  const opener = makeOpener('/products/close');
  modal.show(opener);
  modal.hide(true);
  requests[0].resolve({ ok: true, text: async () => '<product-info></product-info>' });
  await settle();
  assert.equal(modal.baseHideCalls, 1);
  assert.equal(modal.baseShowCalls || 0, 0);
  assert.equal(content.innerHTML, '');
  assert.equal(opener.classList.contains('loading'), false);
});

function makeProductInfo(source) {
  return loadElement(source, 'product-info', {
    AbortController, Event: class Event { constructor() {} }, window: { variantStrings: { soldOut: 'Sold out' } },
    document: { querySelectorAll: () => [] }, HTMLUpdateUtility: { viewTransition: () => {} },
    PUB_SUB_EVENTS: { variantChange: 'variant-change' }, publish: () => {},
  });
}

test('selecting a quick-add variant updates the submitted variant ID', () => {
  const input = { value: 'single', dispatchEvent: () => {} };
  const form = { querySelector: () => input };
  const ProductInfo = makeProductInfo(sourceUnderTest('assets/product-info.js'));
  const info = Object.create(ProductInfo.prototype);
  info.dataset = { section: 'quickadd-test' };
  info.getVariantSelects = () => null;
  info.getSelectedVariant = () => ({ id: 'pair', featured_media: null });
  info.updateOptionValues = () => {}; info.updateURL = () => {}; info.updateMedia = () => {}; info.updateQuantityRules = () => {};
  info.querySelector = (selector) => (selector === 'product-form' ? { toggleSubmitButton: () => {} } : null);
  info.querySelectorAll = () => [form];
  info.handleUpdateProductInfo('/products/test')({ getElementById: () => null, querySelector: () => null });
  assert.equal(input.value, 'pair');
});

test('variant updates refresh the selected submit price', () => {
  const ProductInfo = makeProductInfo(sourceUnderTest('assets/product-info.js'));
  const destinationPrice = { textContent: '$10.00' };
  const info = Object.create(ProductInfo.prototype);
  info.dataset = { section: 'quickadd-test' };
  info.getVariantSelects = () => null;
  info.getSelectedVariant = () => ({ id: 'pair', featured_media: null });
  info.updateOptionValues = () => {}; info.updateVariantInputs = () => {}; info.updateURL = () => {}; info.updateMedia = () => {}; info.updateQuantityRules = () => {};
  info.querySelector = (selector) => {
    if (selector === '[data-product-submit-price]') return destinationPrice;
    if (selector === 'product-form') return { toggleSubmitButton: () => {} };
    return null;
  };
  info.querySelectorAll = () => [];
  const html = {
    getElementById: () => null,
    querySelector: (selector) => (selector === '[data-product-submit-price]' ? { textContent: '$8.00' } : null),
  };
  info.handleUpdateProductInfo('/products/test')(html);
  assert.equal(destinationPrice.textContent, '$8.00');
});

function makeProductFormHarness(source) {
  const pending = [];
  let requests = 0;
  const attributes = new Map();
  const spinner = { classList: { remove: () => {}, add: () => {} } };
  const submitButton = {
    disabled: false, getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)), removeAttribute: (name) => attributes.delete(name),
    classList: { add: () => {}, remove: () => {} },
  };
  const ProductForm = loadElement(source, 'product-form', {
    FormData: class FormData { get(name) { return name === 'id' ? 'pair' : '1'; } append() {} },
    fetchConfig: () => ({ headers: {} }),
    fetch: () => { requests += 1; const request = deferred(); pending.push(request); return request.promise; },
    parseInt, routes: { cart_add_url: '/cart/add.js', cart_url: '/cart' },
    window: { routes: { cart_url: '/cart' }, cartStrings: { error: 'Cart unavailable' } },
    CartPerformance: { measureFromEvent: () => {} }, console: { error: () => {} },
  });
  const form = Object.create(ProductForm.prototype);
  form.cart = null; form.submitButton = submitButton; form.submitButtonText = { classList: { add: () => {} } };
  form.querySelector = () => spinner; form.handleErrorMessage = () => {}; form.createCartLinesUpdateEvent = () => null;
  form.resolveCartLinesUpdate = () => {}; form.dispatchCartErrorEvent = () => {};
  return { form, pending, requestCount: () => requests };
}

test('a quick-add form accepts a retry after both success and network failure', async () => {
  const { form, pending, requestCount } = makeProductFormHarness(sourceUnderTest('assets/product-form.js'));
  const event = { preventDefault: () => {} };
  form.onSubmitHandler(event);
  form.onSubmitHandler(event);
  assert.equal(requestCount(), 1);
  pending[0].resolve({ json: async () => ({}) });
  await settle();
  assert.equal(form.isSubmitting, false);
  form.onSubmitHandler(event);
  assert.equal(requestCount(), 2);
  pending[1].reject(new Error('Network offline'));
  await settle();
  assert.equal(form.isSubmitting, false);
  form.onSubmitHandler(event);
  assert.equal(requestCount(), 3);
});
