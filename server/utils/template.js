/**
 * Aura Browser 2.0 — tiny dependency-free template engine for static pages.
 * Used only for the settings/help page shell. Zero user input is ever
 * interpolated with this (all values are server-side constants).
 */
'use strict';

function render(template, vars = {}) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    vars[key] !== undefined ? String(vars[key]) : match
  );
}

module.exports = { render };
