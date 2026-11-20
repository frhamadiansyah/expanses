/**
 * How far down the window the page may draw anything that is read or pressed: in the Mac app, below the window's
 * title-bar strip (its hidden title still lies over the page, blurring it and taking its clicks, to drag the window),
 * which the web view reports as its safe-area top inset; 0 everywhere else. Read from the inset itself, through a probe,
 * so it is whatever the window really reports.
 */
export function windowTopInset(): number {
  if (typeof document === 'undefined' || !document.documentElement.classList.contains('mac-app')) return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px)';
  document.body.appendChild(probe);
  const inset = Number.parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return inset;
}
