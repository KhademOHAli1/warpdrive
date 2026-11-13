export function enableMappingReviewPopover(): () => void {
  const originalGetAnimations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });

  // jsdom applies the closed popover stylesheet even when the SDK opens the dialog.
  const style = document.createElement("style");
  style.textContent = "[popover][data-slot='dialog-content'] { display: block !important }";
  document.head.append(style);

  return () => {
    style.remove();
    if (originalGetAnimations) {
      Object.defineProperty(Element.prototype, "getAnimations", originalGetAnimations);
    } else {
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    }
  };
}
