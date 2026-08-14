import { getCapabilitySchema, MACHINE_CONTRACT_IDENTIFIER, serializeBounded, DEFAULT_LIMITS } from "./contracts.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./package-metadata.js";

export async function runCli(argv: string[]): Promise<number> {
  const command = argv[0];

  if (command === undefined || command === "--help" || command === "-h") {
    printHelp();
    return command === undefined ? 1 : 0;
  }

  if (command === "--version") {
    console.log(getVersion());
    return 0;
  }

  if (command === "--contract") {
    console.log(
      serializeBounded(
        {
          identifier: MACHINE_CONTRACT_IDENTIFIER,
          package: { name: PACKAGE_NAME, version: PACKAGE_VERSION },
          capabilities: getCapabilitySchema().capabilities,
        },
        DEFAULT_LIMITS,
      ),
    );
    return 0;
  }

  console.error(`unknown command: ${command}`);
  printHelp();
  return 1;
}

function printHelp(): void {
  console.log(
    [
      "Usage: gh-makami <command> [options]",
      "",
      "Commands:",
      "  --help       Show this help",
      "  --version    Print the installed version",
      "  --contract   Print the versioned machine contract and capabilities as JSON",
    ].join("\n"),
  );
}

export function getVersion(): string {
  return PACKAGE_VERSION;
}
