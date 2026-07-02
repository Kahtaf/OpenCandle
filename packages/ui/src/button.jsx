import { Slot } from "@radix-ui/react-slot";
import { Children, cloneElement, isValidElement } from "react";
import { buttonVariants } from "./button-variants.js";
import { Tooltip } from "./tooltip.jsx";
import { cn } from "./utils.js";

export function Button({
  className,
  variant,
  size,
  rounded,
  asChild = false,
  icon: Icon,
  prefixIcon: PrefixIcon,
  suffixIcon: SuffixIcon,
  iconSize,
  tooltip,
  tooltipSide,
  children,
  style,
  ...props
}) {
  const Comp = asChild ? Slot : "button";
  const iconStyle = iconSize ? { "--button-icon-size": `${iconSize}px`, ...style } : style;
  if (asChild) {
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, rounded }), className)}
        style={iconStyle}
        {...props}
      >
        {children}
      </Comp>
    );
  }
  const button = (
    <Comp
      className={cn(buttonVariants({ variant, size, rounded }), className)}
      style={iconStyle}
      {...props}
    >
      {PrefixIcon ? (
        <PrefixIcon className="button-icon" aria-hidden="true" focusable="false" strokeWidth={2} />
      ) : null}
      {Icon ? (
        <Icon className="button-icon" aria-hidden="true" focusable="false" strokeWidth={2} />
      ) : (
        normalizeIconChildren(children)
      )}
      {SuffixIcon ? (
        <SuffixIcon className="button-icon" aria-hidden="true" focusable="false" strokeWidth={2} />
      ) : null}
    </Comp>
  );
  return tooltip ? (
    <Tooltip content={tooltip} side={tooltipSide}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

function normalizeIconChildren(children) {
  return Children.map(children, (child) => {
    if (!isValidElement(child) || !looksLikeIcon(child)) return child;
    return cloneElement(child, {
      "aria-hidden": child.props["aria-hidden"] ?? "true",
      className: cn("button-icon", child.props.className),
      focusable: child.props.focusable ?? "false",
      strokeWidth: child.props.strokeWidth ?? 2,
    });
  });
}

function looksLikeIcon(child) {
  return (
    typeof child.type !== "string" ||
    child.props?.size != null ||
    child.props?.strokeWidth != null ||
    child.props?.absoluteStrokeWidth != null
  );
}
