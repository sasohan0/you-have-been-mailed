/**
 * "You Have Been Mailed" - Gmail DOM Inspector
 */
(function() {
  'use strict';
  if (!window.location.hostname || !window.location.hostname.includes('mail.google.com')) return;
  console.log('[You Have Been Mailed] Content script initialized.');
})();
