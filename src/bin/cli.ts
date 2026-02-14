#!/usr/bin/env node

/**
 * CLI Entry Point for mobilespec
 *
 * Usage:
 *   mobilespec validate [--specs-dir <path>]
 *   mobilespec mermaid [--specs-dir <path>]
 *   mobilespec i18n [--specs-dir <path>]
 */

import { fileURLToPath } from "url";
import path from "path";
import { validate } from "../validate.js";
import { generateMermaid } from "../generateMermaid.js";
import { generateI18n } from "../generateI18n.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Schema directory is always relative to this file
const SCHEMA_DIR = path.join(__dirname, "..", "..", "schema");

// Parse command line arguments
function parseArgs(): { command: string; specsDir: string } {
  const args = process.argv.slice(2);
  const command = args[0] || "validate";

  let specsDir = process.cwd();
  const specsDirIndex = args.indexOf("--specs-dir");
  if (specsDirIndex !== -1 && args[specsDirIndex + 1]) {
    specsDir = args[specsDirIndex + 1];
  }

  return { command, specsDir };
}

async function main() {
  try {
    const { command, specsDir } = parseArgs();
    const options = { specsDir, schemaDir: SCHEMA_DIR };

    switch (command) {
      case "validate": {
        const result = validate(options);
        if (result.errors.length > 0) {
          console.error("\n🔴 バリデーションエラー:");
          for (const err of result.errors) {
            console.error(`  ${err}`);
          }
          process.exit(1);
        }
        if (result.warnings.length > 0) {
          console.warn("\n⚠️  バリデーション警告:");
          for (const warn of result.warnings) {
            console.warn(`  ${warn}`);
          }
        }
        console.log(`\n✅ バリデーション成功`);
        console.log(`   screens: ${result.screens.size}`);
        console.log(`   transitions: ${result.transitions.length}`);
        console.log(`   ui actions: ${result.uiActions.length}`);
        console.log(`   state screens: ${result.stateScreens.size}`);
        break;
      }

      case "mermaid": {
        await generateMermaid(options);
        break;
      }

      case "i18n": {
        await generateI18n(options);
        break;
      }

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.error(
          "Usage: mobilespec [validate|mermaid|i18n] [--specs-dir <path>]",
        );
        process.exit(1);
    }
  } catch (error) {
    console.error(
      "❌ Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

main();
