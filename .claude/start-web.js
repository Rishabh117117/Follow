const path = require('path')
process.chdir(path.join(__dirname, '..', 'apps', 'web'))
require(path.join(__dirname, '..', 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next'))
