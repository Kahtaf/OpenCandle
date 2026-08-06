import { Dialog, DialogContent } from "../../components/ui/dialog.jsx";
import { OnboardingCarousel } from "./OnboardingCarousel.jsx";

/**
 * Model setup, always presented as a standard modal dialog.
 *
 * - `variant="first-run"` opens the carousel on its first explainer step and
 *   auto-opens when setup is required. It is dismissible with Escape, the close
 *   control, or a click outside; drafting resumes once it is dismissed.
 * - `variant="manage"` opens straight on the connect step, because the user
 *   opened it deliberately from the composer.
 */
export function ModelSetupDialog({
  open,
  onOpenChange,
  variant = "manage",
  modelSetup,
  role = "writer",
  send,
}) {
  const firstRun = variant === "first-run";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ariaTitle={firstRun ? "Welcome to OpenCandle" : "Connect a model"}
        // `overflow-visible`: the pager arrows straddle the dialog's left and
        // right edges, so the frame cannot be what clips. The carousel keeps
        // its own clipping box inside, which is what rounds the artwork into
        // the top corners and crops each band.
        className="max-h-[calc(100dvh-32px)] max-w-[560px] grid-rows-[minmax(0,1fr)] overflow-visible"
        // Without this, Radix hands opening focus to the first tabbable
        // element (a step dot, or Skip), which draws a focus ring
        // on the progress row and starts the user on navigation rather than
        // content. Land on the active slide instead.
        onOpenAutoFocus={(event) => {
          const slide = event.currentTarget?.querySelector?.(
            '[data-slot="carousel-item"][data-active="true"]',
          );
          if (!slide) return;
          event.preventDefault();
          slide.focus({ preventScroll: true });
        }}
        // The first-run dialog opens on its own, so there is no trigger to
        // restore focus to. Hand focus to the composer instead: drafting is
        // the one thing the user can do before a model is connected.
        onCloseAutoFocus={
          firstRun
            ? (event) => {
                const composer = document.getElementById("chat-composer");
                if (!composer) return;
                event.preventDefault();
                composer.focus();
              }
            : undefined
        }
      >
        <OnboardingCarousel variant={variant} modelSetup={modelSetup} role={role} send={send} />
      </DialogContent>
    </Dialog>
  );
}
