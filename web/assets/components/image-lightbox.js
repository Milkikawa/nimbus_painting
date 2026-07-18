const FOCUSABLE_SELECTOR =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

export class ImageLightbox {
  constructor({ ariaLabel = "图片预览" } = {}) {
    this.destroyed = false;
    this.generation = 0;
    this.trigger = null;
    this.image = null;

    this.overlay = document.createElement("div");
    this.overlay.className = "image-lightbox hidden";
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-hidden", "true");
    this.overlay.setAttribute("aria-label", ariaLabel);

    this.panel = document.createElement("div");
    this.panel.className = "image-lightbox-panel";

    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "button-secondary image-lightbox-close";
    this.closeButton.textContent = "关闭";

    this.imageHost = document.createElement("div");
    this.imageHost.className = "image-lightbox-host";

    this.panel.append(this.closeButton, this.imageHost);
    this.overlay.append(this.panel);
    document.body.append(this.overlay);

    this.handleKeydown = this.handleKeydown.bind(this);
    this.closeButton.addEventListener("click", () => this.close());
    this.overlay.addEventListener("click", (event) => {
      if (event.target === this.overlay) this.close();
    });
    document.addEventListener("keydown", this.handleKeydown);
  }

  get currentTrigger() {
    return this.trigger;
  }

  get isOpen() {
    return Boolean(
      !this.destroyed &&
        this.overlay &&
        !this.overlay.classList.contains("hidden")
    );
  }

  isTrigger(trigger) {
    return this.isOpen && this.trigger === trigger;
  }

  open({ src, trigger, alt = "图片大图", onError } = {}) {
    if (this.destroyed || !this.overlay?.isConnected) return false;

    const source = String(src ?? "").trim();
    if (!source) return false;

    this.close({ restoreFocus: false });
    const generation = ++this.generation;
    const image = document.createElement("img");
    image.className = "image-lightbox-image";
    image.alt = String(alt || "图片大图");

    this.trigger = trigger ?? null;
    this.image = image;
    this.imageHost.replaceChildren(image);

    image.addEventListener("error", () => {
      if (
        this.destroyed ||
        generation !== this.generation ||
        this.image !== image ||
        this.trigger !== trigger ||
        !image.isConnected
      )
        return;

      this.close({ restoreFocus: false });
      if (typeof onError === "function") onError({ src: source, trigger });
    });

    this.overlay.setAttribute("aria-hidden", "false");
    this.overlay.classList.remove("hidden");
    this.closeButton.focus();
    image.src = source;
    return true;
  }

  close({ restoreFocus = true } = {}) {
    if (this.destroyed || !this.overlay) return false;

    const wasOpen = this.isOpen;
    const trigger = this.trigger;
    const image = this.image;
    this.generation += 1;
    this.trigger = null;
    this.image = null;

    this.overlay.setAttribute("aria-hidden", "true");
    this.overlay.classList.add("hidden");

    if (image) {
      image.removeAttribute("src");
      image.remove();
    }
    this.imageHost?.replaceChildren();

    if (restoreFocus && trigger?.isConnected && !trigger.disabled) {
      trigger.focus();
    } else if (
      this.overlay.contains(document.activeElement) &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur();
    }

    return wasOpen;
  }

  destroy() {
    if (this.destroyed) return;

    this.close({ restoreFocus: false });
    document.removeEventListener("keydown", this.handleKeydown);
    this.overlay?.remove();

    this.destroyed = true;
    this.trigger = null;
    this.image = null;
    this.imageHost = null;
    this.closeButton = null;
    this.panel = null;
    this.overlay = null;
  }

  handleKeydown(event) {
    if (!this.isOpen) return;

    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key === "Tab") {
      this.trapFocus(event);
    }
  }

  trapFocus(event) {
    const focusable = Array.from(
      this.overlay.querySelectorAll(FOCUSABLE_SELECTOR)
    ).filter(
      (element) => !element.hidden && element.getClientRects().length > 0
    );

    event.preventDefault();
    if (!focusable.length) {
      this.closeButton?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeIndex = focusable.indexOf(document.activeElement);

    if (event.shiftKey) {
      if (activeIndex <= 0) last.focus();
      else focusable[activeIndex - 1].focus();
    } else if (activeIndex < 0 || activeIndex === focusable.length - 1) {
      first.focus();
    } else {
      focusable[activeIndex + 1].focus();
    }
  }
}
