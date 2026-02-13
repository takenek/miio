'use strict';

const path = require('path');

exports.command = 'tokens <command>';
exports.description = 'Manage tokens of devices';
exports.builder = function(yargs) { return yargs.commandDir(path.join(__dirname, 'tokens')); };
exports.handler = () => {};
