/**
 * CLI Command Registration Example
 * 
 * This file demonstrates how to register the stats command in the CLI.
 * 
 * Integration Point: src/adapters/cli/index.ts
 */

/**
 * Example CLI registration (pseudo-code):
 * 
 * Assuming the CLI uses a command framework like Commander.js or similar:
 */

/*
import { Command } from 'commander';
import { statsCommand } from './commands/stats.js';

const program = new Command();

// ... existing commands ...

program
  .command('stats')
  .description('Display token usage statistics')
  .option('--today', 'Show today\'s stats')
  .option('--week', 'Show last 7 days stats')
  .option('--month', 'Show last 30 days stats')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await statsCommand(options);
  });

program.parse();
*/

/**
 * Alternative: If using custom CLI router
 * 
 * Add to command registry:
 */

/*
const commands = {
  chat: chatCommand,
  ask: askCommand,
  stats: statsCommand,  // 🎯 Add this line
  // ... other commands
};

// Command dispatcher
const commandName = process.argv[2];
const command = commands[commandName];

if (command) {
  const options = parseOptions(process.argv.slice(3));
  await command(options);
} else {
  console.error(`Unknown command: ${commandName}`);
}
*/

/**
 * Usage Examples:
 * 
 * $ xuanji stats              # Today's stats (default)
 * $ xuanji stats --today      # Today's stats (explicit)
 * $ xuanji stats --week       # Last 7 days
 * $ xuanji stats --month      # Last 30 days
 * $ xuanji stats --json       # JSON output
 */

export {};
