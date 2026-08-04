// Browser APIs jsdom does not implement, needed by DOM-dependent dependencies.
//
// Guarded so the file stays inert under the default `node` environment.
if (typeof window !== "undefined") {
  // embla-carousel evaluates responsive option breakpoints on activation, and
  // components check `prefers-reduced-motion`. Nothing can match in jsdom.
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
  // embla's resize and in-view watchers. jsdom never lays out, so there is
  // genuinely nothing for them to report.
  if (typeof window.ResizeObserver !== "function") {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof window.ResizeObserver;
  }
  if (typeof window.IntersectionObserver !== "function") {
    // Reports every observed target as in view, asynchronously, matching
    // jsdom's fiction that the whole document is on screen. Components that
    // defer work until visible (lazy sparklines) therefore still run, and
    // embla's in-view tracking sees the slides it expects.
    window.IntersectionObserver = class {
      root = null;
      rootMargin = "";
      thresholds = [];
      #callback: (entries: unknown[], observer: unknown) => void;
      constructor(callback: (entries: unknown[], observer: unknown) => void) {
        this.#callback = callback;
      }
      observe(target: Element) {
        queueMicrotask(() => {
          this.#callback(
            [{ isIntersecting: true, intersectionRatio: 1, target }],
            this as unknown as IntersectionObserver,
          );
        });
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof window.IntersectionObserver;
  }

  // jsdom reports every element's offset box as 0, which collapses a horizontal
  // carousel to a single scroll snap and would make slide navigation
  // untestable. Rather than mock the carousel engine away — which would leave
  // our own navigation, dot, focus and mount behaviour asserted against a fake —
  // emulate the one layout embla reads (`offsetLeft`/`offsetWidth`, see
  // embla-carousel's NodeRects): a horizontal track of equal, full-width slides.
  //
  // Scoped strictly to carousel subtrees; every other element keeps jsdom's
  // real geometry.
  const SLIDE_WIDTH = 400;
  const SLIDE_HEIGHT = 300;

  type Box = { left: number; top: number; width: number; height: number };

  const emulatedBox = (element: Element): Box | null => {
    if (element.matches?.('[data-slot="carousel-content"]')) {
      return { left: 0, top: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
    }
    if (element.matches?.('[data-slot="carousel-track"]')) {
      // The flex track fills the viewport; its slides overflow it. Embla reads
      // the track's own size as the view size, so it must NOT be the sum.
      return { left: 0, top: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
    }
    if (element.matches?.('[data-slot="carousel-item"]')) {
      const track = element.parentElement;
      const position = track ? [...track.children].indexOf(element) : 0;
      return { left: position * SLIDE_WIDTH, top: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
    }
    return null;
  };

  // jsdom returns "" from getComputedStyle for shorthand-derived box
  // properties it never resolves. embla reads the last slide's end margin with
  // parseFloat, and NaN there poisons its content-size maths. An unset margin
  // really is 0px, so this fills in the value jsdom omits rather than inventing
  // one.
  const nativeGetPropertyValue = CSSStyleDeclaration.prototype.getPropertyValue;
  CSSStyleDeclaration.prototype.getPropertyValue = function getPropertyValue(
    this: CSSStyleDeclaration,
    property: string,
  ) {
    const value = nativeGetPropertyValue.call(this, property);
    if (value === "" && /^(margin|padding|border)-/.test(property)) return "0px";
    return value;
  };

  for (const [property, read] of [
    ["offsetLeft", (box: Box) => box.left],
    ["offsetTop", (box: Box) => box.top],
    ["offsetWidth", (box: Box) => box.width],
    ["offsetHeight", (box: Box) => box.height],
    ["clientWidth", (box: Box) => box.width],
    ["clientHeight", (box: Box) => box.height],
  ] as const) {
    const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        const box = emulatedBox(this);
        if (box) return read(box);
        return native?.get?.call(this) ?? 0;
      },
    });
  }
}
