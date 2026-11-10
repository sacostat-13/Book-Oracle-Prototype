// src/lib/util/trackingAllowed.js
//
// The one answer to "may this browser be counted?", shared by every writer of
// visit statistics (anthologyInsights.js, funnel.js). False under Global
// Privacy Control or Do Not Track, and false whenever the check itself throws —
// not knowing is not consent.

/** @returns {boolean} true when the browser has not asked not to be counted */
export function trackingAllowed() {
  try {
    if (typeof navigator === 'undefined') return false;
    if (navigator.globalPrivacyControl) return false;
    const dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
    return !(dnt === '1' || dnt === 'yes');
  } catch { return false; }
}
