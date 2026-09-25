/**
 * Vercel serverless entry point for Aura Browser 2.0
 * Vercel will use this file as the API handler for all routes.
 */
'use strict';

const app = require('../server/index');

// Vercel expects a function or express app export
module.exports = app;
