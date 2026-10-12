'use strict';
const { parentPort } = require('worker_threads');
const { LanguageService } = require('./language-service');
const service = new LanguageService();
parentPort.on('message', ({ id, method, request }) => {
  try { parentPort.postMessage({ id, value: service.run(method, request) }); }
  catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
