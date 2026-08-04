import AutoHeight from "embla-carousel-auto-height";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import {
  Carousel,
  CarouselContent,
  CarouselDots,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "../../components/ui/carousel.jsx";
import { cn } from "../../lib/utils.js";
import { ConnectModelPanel } from "./ConnectModelPanel.jsx";
import { ONBOARDING_INTRO_STEPS } from "./onboarding-steps.jsx";

// The bordered button vocabulary from DESIGN.md: paper fill, hairline edge, ink
// glyph. Half of each disc hangs outside the dialog over the scrim, which is
// what gives the white fill its contrast; the shadow lifts the inner half off
// the tinted band.
//
// `md:h-11 md:w-11` holds the 44px target past the point where `icon-sm` would
// step down to 40px: a 1024px tablet is still a thumb.
const ARROW_CLASS =
  "pointer-events-auto border-hard shadow-subtle-md md:h-11 md:w-11 hover:bg-secondary";

export function OnboardingCarousel({
  variant = "first-run",
  modelSetup,
  role = "writer",
  send,
  className,
}) {
  // "manage" is a returning user asking for the key form. It shows that step
  // alone: no intro deck, no step dots inviting them into it, and no Back
  // control that would drop them into onboarding they did not ask for.
  const manage = variant === "manage";
  const introSteps = manage ? [] : ONBOARDING_INTRO_STEPS;
  const connectIndex = introSteps.length;

  // Upstream shadcn's `setApi` pattern: embla owns slide state, and the parts
  // of this dialog that differ per step read the selected index back from it.
  const [api, setApi] = useState(null);
  const [index, setIndex] = useState(0);
  const [providerId, setProviderId] = useState("");
  const atConnectStep = index === connectIndex;
  const atProviderList = atConnectStep && !providerId;
  const contentRef = useRef(null);
  const settled = useRef(false);

  // Auto height: without it the track is as tall as its tallest slide, so every
  // explainer would carry the connect step's height as dead space.
  const plugins = useMemo(() => [AutoHeight()], []);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => {
      const next = api.selectedScrollSnap();
      setIndex(next);
      // Leaving setup drops the provider choice with it, so returning starts at
      // the list rather than a half-filled key form.
      if (next !== connectIndex) setProviderId("");
    };
    onSelect();
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api, connectIndex]);

  // Embla's resize watcher only reacts to width changes, and this deck's slides
  // change *height*: the setup panel mounts with its step (see SECRET HYGIENE
  // below) and grows again when the key form replaces the provider list. Tell
  // embla to re-measure, keeping the step we are on, or auto-height keeps the
  // stale measurement: a slide that was empty when measured collapses to zero.
  useEffect(() => {
    if (!api) return;
    api.reInit({ startIndex: api.selectedScrollSnap() });
  }, [api, atConnectStep, providerId]);

  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    const active = contentRef.current?.querySelector(
      '[data-slot="carousel-item"][data-active="true"]',
    );
    active?.focus?.({ preventScroll: true });
  }, [index]);

  return (
    <Carousel
      setApi={setApi}
      plugins={plugins}
      itemNoun="Step"
      aria-label={manage ? "Connect a model" : "OpenCandle setup"}
      className={cn("grid min-h-0 grid-rows-[minmax(0,1fr)_auto]", className)}
    >
      {/* Row one, and the only box the arrows are positioned against, so they
          land on the middle of the artwork rather than of the whole dialog.
          `minmax(0,1fr)` on the column as well as the row: an implicit `auto`
          grid track sizes to max-content, and the max-content of embla's track
          is every slide laid end to end, which pushes the viewport wider than
          the dialog and lets the neighbouring slide show at the edge. */}
      <div className="relative grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        {/* This box, not the dialog frame, does all the clipping: it rounds the
            artwork into the dialog's top corners (11px, the frame's 12px less
            its 1px border) and it is where the dialog scrolls.

            The scroll lives here rather than on embla's viewport for a reason.
            Every slide stays in embla's track side by side, so the track's
            scroll height is the tallest slide's, not the visible one's. With
            `overflow-y-auto` on the viewport that showed a scrollbar on every
            slide shorter than the tallest, and the scrollbar then narrowed the
            viewport under embla and shifted the track left, cutting the first
            character off each row. Here the viewport clips instead, auto-height
            gives it exactly the active slide's height, and this box scrolls
            only when the window truly cannot fit that. */}
        <div
          className={cn(
            // A plain block, deliberately: as a grid item the viewport would be
            // squashed to the row height and clip its own slide instead of
            // handing the overflow up here to scroll.
            "min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain rounded-t-[11px]",
            manage && "rounded-b-[11px]",
          )}
        >
          <CarouselContent
            ref={contentRef}
            // `pan-y` keeps a vertical drag with the page rather than the pager.
            viewportClassName="touch-pan-y overflow-hidden"
            className="transition-[height] duration-200 ease-out"
          >
            {introSteps.map((step) => (
              <CarouselItem key={step.id} tabIndex={-1} className="focus-visible:outline-none">
                {/* Visual first and full-bleed, copy hugging it underneath on the
                  same left spine the connect step uses. */}
                <step.Visual />
                {/* A floor on the copy block so a two-line and a three-line body
                  produce the same dialog height: no resize between slides. The
                  floor and the padding both grow once the viewport can pay for
                  it, and a short window keeps the tight values and scrolls. */}
                <div
                  className={cn(
                    "grid content-start gap-2.5 px-7 pb-7 pt-6 sm:min-h-[172px] sm:gap-3 sm:px-8 sm:pb-9 sm:pt-7 [@media(min-height:880px)]:min-h-[188px] [@media(min-height:880px)]:pb-11 [@media(min-height:880px)]:pt-8",
                    step.centered && "justify-items-center text-center",
                  )}
                >
                  <h2 className="m-0 text-balance text-xl font-semibold tracking-tight text-foreground">
                    {step.title}
                  </h2>
                  <p className="m-0 max-w-[48ch] text-pretty text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </CarouselItem>
            ))}
            {/* SECRET HYGIENE - read before editing. Embla keeps every slide
              mounted in its translated track, so the key form no longer unmounts
              as a side effect of being off screen. This conditional is what
              discards a typed key: leaving the setup step unmounts
              ConnectModelPanel and its form state goes with it. Do not turn this
              into an always-mounted slide. */}
            <CarouselItem key="connect-model" tabIndex={-1} className="focus-visible:outline-none">
              {atConnectStep ? (
                <ConnectModelPanel
                  variant={variant}
                  modelSetup={modelSetup}
                  role={role}
                  send={send}
                  // "manage" has no footer to host a Back, so the key flow keeps
                  // its own by staying uncontrolled there.
                  selectedProviderId={manage ? undefined : providerId}
                  onSelectedProviderIdChange={setProviderId}
                />
              ) : null}
            </CarouselItem>
          </CarouselContent>
        </div>
        {/* Standard carousel arrows: one each side, vertically centred, each
            straddling the dialog's edge so half the disc sits on the scrim.
            They page the explainer deck only. The setup step is a form whose
            provider rows and key field run the full width, so arrows there
            would cover the controls and one stray click would discard a typed
            key; its Back lives in the footer instead.

            Hidden below `sm`. At 390px the card is 358px wide and the discs
            would sit on top of the body copy and the evidence rail at exactly
            their vertical midpoint, and half a disc would fall off the window
            besides. Shrinking them below the touch floor is not an option, so
            narrow screens page by swipe and by the dots, with Skip visible on
            every explainer as the always-present way forward. */}
        {atConnectStep ? null : (
          <div className="pointer-events-none absolute inset-y-0 -left-[22px] -right-[22px] z-20 hidden items-center justify-between sm:flex">
            {/* No dead disc on the opening slide: a greyed-out control laid
                over the artwork is noise, and this deck starts where it starts.
                The empty cell keeps Next on the right edge. */}
            {index > 0 ? (
              <CarouselPrevious
                aria-label="Previous step"
                variant="bordered"
                size="icon-sm"
                rounded="full"
                className={ARROW_CLASS}
              >
                <ChevronLeft />
              </CarouselPrevious>
            ) : (
              <span aria-hidden="true" />
            )}
            <CarouselNext
              aria-label="Next step"
              variant="bordered"
              size="icon-sm"
              rounded="full"
              className={ARROW_CLASS}
            >
              <ChevronRight />
            </CarouselNext>
          </div>
        )}
      </div>
      {manage ? null : (
        // Three fixed slots so the dots stay dead centre whatever flanks them:
        // Back at the left, position in the middle, Skip at the right. Nothing
        // in this bar moves the deck forward; the arrows own that.
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-border px-4 py-2.5 sm:px-5 sm:py-3 [@media(min-height:880px)]:py-4">
          <div className="flex min-w-0 justify-start">
            {/* One Back, always in the same place: out of the key form to the
                provider list, out of the list to the deck. */}
            {atConnectStep ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                prefixIcon={ChevronLeft}
                onClick={() =>
                  atProviderList ? api?.scrollTo(connectIndex - 1) : setProviderId("")
                }
              >
                Back
              </Button>
            ) : null}
          </div>
          <CarouselDots />
          <div className="flex min-w-0 justify-end">
            {atConnectStep ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => api?.scrollTo(connectIndex)}
              >
                Skip
              </Button>
            )}
          </div>
        </div>
      )}
    </Carousel>
  );
}
