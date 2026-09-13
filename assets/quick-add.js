if (!customElements.get('quick-add-modal')) {
  customElements.define(
    'quick-add-modal',
    class QuickAddModal extends ModalDialog {
      constructor() {
        super();
        this.modalContent = this.querySelector('[id^="QuickAddInfo-"]');
        this.handleKeydown = this.handleKeydown.bind(this);
        this.addEventListener('keydown', this.handleKeydown);

        this.addEventListener('product-info:loaded', ({ target }) => {
          target.addPreProcessCallback(this.preprocessHTML.bind(this));
        });
      }

      handleKeydown(event) {
        if (event.key !== 'Escape' && event.code !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.hide();
      }

      hide(preventFocus = false) {
        this.cancelRequest();
        const cartNotification = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        if (cartNotification) cartNotification.setActiveElement(this.openedBy);
        this.modalContent.innerHTML = '';

        if (preventFocus) this.openedBy = null;
        super.hide();
      }

      show(opener) {
        document.querySelectorAll('quick-add-modal').forEach((modal) => {
          if (modal !== this) modal.cancelRequest?.();
        });
        this.cancelRequest();
        this.abortController = new AbortController();
        const abortController = this.abortController;
        this.loadingOpener = opener;
        opener.setAttribute('aria-disabled', true);
        opener.classList.add('loading');
        opener.querySelector('.loading__spinner').classList.remove('hidden');

        const productUrl = opener.getAttribute('data-product-url');

        fetch(productUrl, { signal: abortController.signal })
          .then((response) => {
            if (!response.ok) throw new Error('Quick add could not load this product.');
            return response.text();
          })
          .then((responseText) => {
            if (abortController.signal.aborted || this.abortController !== abortController) return;
            const responseHTML = new DOMParser().parseFromString(responseText, 'text/html');
            const productElement = responseHTML.querySelector('product-info');

            if (!productElement) throw new Error('Quick add could not load this product.');

            this.preprocessHTML(productElement);
            HTMLUpdateUtility.setInnerHTML(this.modalContent, productElement.outerHTML);

            if (window.Shopify && Shopify.PaymentButton) {
              Shopify.PaymentButton.init();
            }
            if (window.ProductModel) window.ProductModel.loadShopifyXR();

            this.modalContent.querySelector('product-component')?.dispatchViewEvent?.();

            super.show(opener);
          })
          .catch((error) => {
            if (error.name === 'AbortError' || abortController.signal.aborted || this.abortController !== abortController) return;
            this.showLoadError(productUrl);
            super.show(opener);
          })
          .finally(() => {
            if (this.abortController === abortController && this.loadingOpener === opener) this.resetLoadingState();
          });
      }

      cancelRequest() {
        this.abortController?.abort();
        this.abortController = null;
        this.resetLoadingState();
      }

      resetLoadingState() {
        if (!this.loadingOpener) return;
        this.loadingOpener.removeAttribute('aria-disabled');
        this.loadingOpener.classList.remove('loading');
        this.loadingOpener.querySelector('.loading__spinner')?.classList.add('hidden');
        this.loadingOpener = null;
      }

      showLoadError(productUrl) {
        this.modalContent.replaceChildren();
        const message = document.createElement('p');
        message.setAttribute('role', 'alert');
        message.textContent = this.dataset.errorMessage;
        const link = document.createElement('a');
        link.href = productUrl;
        link.textContent = this.dataset.viewDetailsLabel;
        this.modalContent.append(message, link);
      }

      preprocessHTML(productElement) {
        productElement.classList.forEach((classApplied) => {
          if (classApplied.startsWith('color-') || classApplied === 'gradient')
            this.modalContent.classList.add(classApplied);
        });
        this.preventDuplicatedIDs(productElement);
        this.removeDOMElements(productElement);
        this.removeGalleryListSemantic(productElement);
        this.updateImageSizes(productElement);
        this.preventVariantURLSwitching(productElement);
      }

      preventVariantURLSwitching(productElement) {
        productElement.setAttribute('data-update-url', 'false');
      }

      removeDOMElements(productElement) {
        const pickupAvailability = productElement.querySelector('pickup-availability');
        if (pickupAvailability) pickupAvailability.remove();

        const productModal = productElement.querySelector('product-modal');
        if (productModal) productModal.remove();

        const modalDialog = productElement.querySelectorAll('modal-dialog');
        if (modalDialog) modalDialog.forEach((modal) => modal.remove());
      }

      preventDuplicatedIDs(productElement) {
        const sectionId = productElement.dataset.section;

        const oldId = sectionId;
        const newId = `quickadd-${sectionId}`;
        productElement.innerHTML = productElement.innerHTML.replaceAll(oldId, newId);
        Array.from(productElement.attributes).forEach((attribute) => {
          if (attribute.value.includes(oldId)) {
            productElement.setAttribute(attribute.name, attribute.value.replace(oldId, newId));
          }
        });

        productElement.dataset.originalSection = sectionId;
      }

      removeGalleryListSemantic(productElement) {
        const galleryList = productElement.querySelector('[id^="Slider-Gallery"]');
        if (!galleryList) return;

        galleryList.setAttribute('role', 'presentation');
        galleryList.querySelectorAll('[id^="Slide-"]').forEach((li) => li.setAttribute('role', 'presentation'));
      }

      updateImageSizes(productElement) {
        const product = productElement.querySelector('.product');
        const desktopColumns = product?.classList.contains('product--columns');
        if (!desktopColumns) return;

        const mediaImages = product.querySelectorAll('.product__media img');
        if (!mediaImages.length) return;

        let mediaImageSizes =
          '(min-width: 1000px) 715px, (min-width: 750px) calc((100vw - 11.5rem) / 2), calc(100vw - 4rem)';

        if (product.classList.contains('product--medium')) {
          mediaImageSizes = mediaImageSizes.replace('715px', '605px');
        } else if (product.classList.contains('product--small')) {
          mediaImageSizes = mediaImageSizes.replace('715px', '495px');
        }

        mediaImages.forEach((img) => img.setAttribute('sizes', mediaImageSizes));
      }
    }
  );
}
