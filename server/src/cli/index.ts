#!/usr/bin/env node
import '../infrastructure/config/dotenv-bootstrap.js'; // FIRST: .env into process.env
import { runCli } from './cli.js';

process.exitCode = await runCli(process.argv.slice(2));
