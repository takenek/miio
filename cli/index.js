#!/usr/bin/env node
'use strict';

const path = require('path');
require('yargs')(process.argv.slice(2))
	.commandDir(path.join(__dirname, 'commands'))
	.recommendCommands()
	.demandCommand()
	.strict()
	.parse();
