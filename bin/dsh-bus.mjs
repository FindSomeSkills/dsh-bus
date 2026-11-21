#!/usr/bin/env node
// 入口：node bin/dsh-bus.mjs <命令>；也可 npm link 后直接 dsh-bus
import { main } from '../src/bus/cli.mjs';

process.exitCode = main(process.argv.slice(2));
