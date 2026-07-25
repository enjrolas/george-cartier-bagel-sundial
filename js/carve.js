// Roman-inscription conceit: replace every "u" with "v" in all visible text,
// including text added later (bagel names, the clock, readouts). Idempotent, so
// the MutationObserver it installs never loops. Included on every view.
(function () {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
  const vify = (s) => s.replace(/u/g, 'v').replace(/U/g, 'V');

  function process(node) {
    if (node.nodeType === 3) {                 // text node
      const v = vify(node.nodeValue);
      if (v !== node.nodeValue) node.nodeValue = v;
    } else if (node.nodeType === 1 && !SKIP.has(node.tagName) &&
               !(node.classList && node.classList.contains('no-carve'))) {
      for (let c = node.firstChild; c; c = c.nextSibling) process(c);
    }
  }

  function run() {
    process(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') process(m.target);
        else m.addedNodes.forEach(process);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
