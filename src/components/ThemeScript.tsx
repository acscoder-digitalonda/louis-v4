/**
 * Applies the stored theme before first paint.
 *
 * Inline and synchronous on purpose: any later and a dark-mode user gets a flash of
 * paper. "System" writes no attribute at all, so the media query in the token sheet
 * decides — which is what makes all three states behave.
 */
const SCRIPT = `
(function () {
  try {
    var pref = localStorage.getItem('louis.theme') || 'system';
    var root = document.documentElement;
    if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
    else root.removeAttribute('data-theme');
  } catch (e) {}
})();
`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
}
