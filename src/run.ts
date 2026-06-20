#!/usr/bin/env node
// Executable entry: reads the CodeGeneratorRequest from stdin and writes the
// response to stdout. Used both in dev (via tsx) and production (via dist).
import { runNodeJs } from "@bufbuild/protoplugin";
import { protocGenZod } from "./index.js";

runNodeJs(protocGenZod);
