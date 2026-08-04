import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { cn } from "../../lib/utils.js";
import { Button } from "./button.jsx";

/**
 * Carousel — shadcn/ui's embla-backed carousel, adapted to this workspace.
 *
 * Kept from upstream so a contributor recognises it: the compound shape
 * (`Carousel` / `CarouselContent` / `CarouselItem` / `CarouselPrevious` /
 * `CarouselNext`), the `useCarousel` context, and the `opts` / `plugins` /
 * `setApi` props. Slide state lives in embla, not in React.
 *
 * Three deliberate divergences:
 *
 * 1. **No root arrow-key handler.** Upstream binds ArrowLeft/ArrowRight on the
 *    carousel root with `onKeyDownCapture`. The content region here routinely
 *    holds text fields, selects and radio groups whose own arrow behaviour must
 *    not be stolen — and stealing it also changes slides, which can discard
 *    what the user typed. Arrow keys live on `CarouselDots`, which behaves like
 *    a tablist, and nowhere else.
 * 2. **`CarouselDots`** has no upstream equivalent. It is a thin control built
 *    on embla's own `scrollSnapList` / `selectedScrollSnap` / `scrollTo`.
 * 3. **Drags that start on a control are ignored**, through embla's own
 *    `watchDrag` option — so dragging to place a caret in a text field, or
 *    anywhere inside a `[data-no-swipe]` subtree, never turns the page.
 *
 * Inactive slides stay mounted (embla lays them out in a translated track) but
 * are marked `aria-hidden` and `inert`, so nothing off-screen is reachable by
 * keyboard or screen reader. A consumer that must *unmount* a slide's contents
 * — anything holding a credential, say — should render it conditionally on the
 * selected index rather than relying on the carousel to do it.
 */
const CarouselContext = createContext(null);
const CarouselItemIndexContext = createContext(0);

// Anywhere a drag legitimately means something other than "turn the page":
// caret placement, text selection, range/radio interaction, or a subtree that
// has opted out wholesale.
const NO_DRAG_TARGETS =
  'input, textarea, select, button, a, [role="radiogroup"], [role="slider"], [contenteditable="true"], [data-no-swipe]';

function allowDragFromTarget(_api, event) {
  return !event?.target?.closest?.(NO_DRAG_TARGETS);
}

export function useCarousel() {
  const context = useContext(CarouselContext);
  if (!context) throw new Error("useCarousel must be used within a <Carousel />");
  return context;
}

export const Carousel = forwardRef(function Carousel(
  {
    className,
    children,
    orientation = "horizontal",
    opts,
    plugins,
    setApi,
    itemNoun = "Slide",
    ...props
  },
  ref,
) {
  const [carouselRef, api] = useEmblaCarousel(
    {
      axis: orientation === "horizontal" ? "x" : "y",
      watchDrag: allowDragFromTarget,
      ...opts,
    },
    plugins,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollSnaps, setScrollSnaps] = useState([]);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const onSelect = useCallback((emblaApi) => {
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, []);

  const onReInit = useCallback(
    (emblaApi) => {
      setScrollSnaps(emblaApi.scrollSnapList());
      onSelect(emblaApi);
    },
    [onSelect],
  );

  useEffect(() => {
    if (!api) return;
    setApi?.(api);
    onReInit(api);
    api.on("reInit", onReInit);
    api.on("select", onSelect);
    return () => {
      api.off("reInit", onReInit);
      api.off("select", onSelect);
    };
  }, [api, onReInit, onSelect, setApi]);

  const scrollPrev = useCallback(() => api?.scrollPrev(), [api]);
  const scrollNext = useCallback(() => api?.scrollNext(), [api]);
  const scrollTo = useCallback((index) => api?.scrollTo(index), [api]);

  return (
    <CarouselContext.Provider
      value={{
        carouselRef,
        api,
        orientation,
        itemNoun,
        selectedIndex,
        scrollSnaps,
        scrollPrev,
        scrollNext,
        scrollTo,
        canScrollPrev,
        canScrollNext,
      }}
    >
      <div
        ref={ref}
        role="region"
        aria-roledescription="carousel"
        data-slot="carousel"
        data-orientation={orientation}
        className={cn("relative", className)}
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  );
});

/**
 * `className` styles the track, matching upstream. The scroll viewport embla
 * owns takes `viewportClassName` — needed because a dialog's carousel viewport
 * is usually also its vertical scroll region.
 */
export const CarouselContent = forwardRef(function CarouselContent(
  { className, viewportClassName, children, ...props },
  ref,
) {
  const { carouselRef, orientation } = useCarousel();
  return (
    <div
      ref={carouselRef}
      data-slot="carousel-content"
      className={cn("overflow-x-hidden", viewportClassName)}
    >
      <div
        ref={ref}
        data-slot="carousel-track"
        className={cn(
          "flex items-start",
          orientation === "horizontal" ? "flex-row" : "flex-col",
          className,
        )}
        {...props}
      >
        <CarouselItems>{children}</CarouselItems>
      </div>
    </div>
  );
});

/**
 * Positions each child so `CarouselItem` can name its own index.
 *
 * `Children.toArray` rather than the raw children: consumers routinely mix a
 * mapped list with standalone items, which arrives as a nested array and would
 * otherwise be counted as one slide.
 */
function CarouselItems({ children }) {
  return Children.toArray(children)
    .filter(isValidElement)
    .map((child, index) => (
      <CarouselItemIndexContext.Provider
        // biome-ignore lint/suspicious/noArrayIndexKey: slide position is the identity
        key={child.key ?? index}
        value={index}
      >
        {child}
      </CarouselItemIndexContext.Provider>
    ));
}

export const CarouselItem = forwardRef(function CarouselItem({ className, ...props }, ref) {
  const { selectedIndex, scrollSnaps, itemNoun } = useCarousel();
  const itemIndex = useContext(CarouselItemIndexContext);
  const active = itemIndex === selectedIndex;

  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="slide"
      aria-label={`${itemNoun} ${itemIndex + 1} of ${scrollSnaps.length || 1}`}
      data-slot="carousel-item"
      data-active={active ? "true" : "false"}
      // Off-screen slides stay in the DOM for embla's track, so they leave the
      // accessibility tree and the tab order instead of sitting there as
      // invisible reachable content.
      aria-hidden={active ? undefined : "true"}
      inert={active ? undefined : true}
      className={cn("min-w-0 shrink-0 grow-0 basis-full", className)}
      {...props}
    />
  );
});

export const CarouselPrevious = forwardRef(function CarouselPrevious(
  { className, children, variant = "bordered", size = "sm", onClick, ...props },
  ref,
) {
  const { scrollPrev, canScrollPrev } = useCarousel();
  return (
    <Button
      ref={ref}
      type="button"
      data-slot="carousel-previous"
      variant={variant}
      size={size}
      prefixIcon={children === undefined ? ChevronLeft : undefined}
      disabled={!canScrollPrev}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        scrollPrev();
      }}
      className={cn(className)}
      {...props}
    >
      {children ?? "Back"}
    </Button>
  );
});

export const CarouselNext = forwardRef(function CarouselNext(
  { className, children, variant = "brand", size = "sm", onClick, ...props },
  ref,
) {
  const { scrollNext, canScrollNext } = useCarousel();
  return (
    <Button
      ref={ref}
      type="button"
      data-slot="carousel-next"
      variant={variant}
      size={size}
      suffixIcon={children === undefined ? ChevronRight : undefined}
      disabled={!canScrollNext}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        scrollNext();
      }}
      className={cn(className)}
      {...props}
    >
      {children ?? "Next"}
    </Button>
  );
});

export const CarouselDots = forwardRef(function CarouselDots(
  { className, getItemLabel, onKeyDown, ...props },
  ref,
) {
  const { selectedIndex, scrollSnaps, scrollTo, orientation, itemNoun } = useCarousel();
  const label =
    getItemLabel ??
    ((dotIndex, total) => `Go to ${itemNoun.toLowerCase()} ${dotIndex + 1} of ${total}`);

  // Arrow keys live here rather than on the carousel root: this is the control
  // that behaves like a tablist, and the content region must keep its own
  // arrow-key behaviour for text fields, selects and radio groups.
  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const prevKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    if (event.key === prevKey) {
      event.preventDefault();
      scrollTo(selectedIndex - 1);
    } else if (event.key === nextKey) {
      event.preventDefault();
      scrollTo(selectedIndex + 1);
    }
  };

  return (
    <div
      ref={ref}
      data-slot="carousel-dots"
      className={cn("flex items-center gap-0.5", className)}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {scrollSnaps.map((_snap, dotIndex) => {
        const active = dotIndex === selectedIndex;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: dot position is the identity
            key={dotIndex}
            type="button"
            data-slot="carousel-dot"
            data-state={active ? "active" : "inactive"}
            aria-label={label(dotIndex, scrollSnaps.length)}
            aria-current={active ? "step" : undefined}
            onClick={() => scrollTo(dotIndex)}
            // 40px tall so the target clears the touch floor without spreading
            // the dots apart; the ring is inset so it tracks the target rather
            // than drawing a circle around one dot.
            className="group inline-flex h-10 w-5 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {/* Every dot keeps the same circle. The current step is told by
                fill alone, so the row reads as positions rather than as a
                progress bar that grew a segment. */}
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full transition-colors duration-150 ease-out",
                active ? "bg-foreground" : "bg-hard group-hover:bg-muted-foreground/60",
              )}
            />
          </button>
        );
      })}
    </div>
  );
});
